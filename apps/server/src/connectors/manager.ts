import type {
  AirState,
  AutomationSource,
  AzuracastSettings,
  ConnectedSource,
  RadiodjSettings,
  Settings,
  SourceStatus,
  Track,
} from '@onair-desk/shared';
import type { AirStateStore } from '../air/state.js';
import type { AuditRepo } from '../db/audit.js';
import {
  azuracastConfigError,
  HttpsAzuracastClient,
  type AzuracastAccess,
  type AzuracastClient,
} from './azuracast/client.js';
import { AzuracastConnector } from './azuracast/connector.js';
import { RadiodjConnector } from './radiodj/connector.js';
import { MysqlRadiodjReader, type RadiodjReader } from './radiodj/reader.js';
import { SimulatorConnector } from './simulator.js';
import type { AutomationConnector, AutomationUpdate, ConnectorContext } from './types.js';

/** Délai avant un nouvel essai après une erreur de connecteur. */
export const RETRY_MS = 30_000;
/** Mode dégradé : le titre reçu par signal reste affiché au plus 10 minutes. */
export const DEGRADED_MAX_MS = 10 * 60_000;

/** Ce dont les connecteurs ont besoin en dehors des paramètres (secrets, accès aux sources). */
export interface ConnectorDeps {
  /** RADIODJ_DB_PASSWORD ; null : variable absente. */
  radiodjPassword?: string | null;
  /** Ouverture de la base RadioDJ (remplacée dans les tests). */
  radiodjReader?: (settings: RadiodjSettings, password: string) => RadiodjReader;
  /** AZURACAST_API_KEY ; null : aucune clé. */
  azuracastApiKey?: string | null;
  /** Contenu de AZURACAST_CA_FILE ; null : autorités publiques seulement. */
  azuracastCa?: string | null;
  /** Client AzuraCast (remplacé dans les tests). */
  azuracastClient?: (access: AzuracastAccess) => AzuracastClient;
}

/** Accès à la base RadioDJ incomplet : code d'erreur stable, ou null si tout est renseigné. */
export function radiodjConfigError(settings: RadiodjSettings, password: string | null | undefined) {
  if (!settings.host) return 'radiodj_not_configured';
  if (!password) return 'radiodj_no_password';
  return null;
}

/**
 * Ouvre la base RadioDJ (connecteur, test de connexion, recherche de titres). Lève une erreur
 * dont le message est un code stable si l'accès est incomplet.
 */
export function openRadiodj(settings: RadiodjSettings, deps: ConnectorDeps): RadiodjReader {
  const missing = radiodjConfigError(settings, deps.radiodjPassword);
  if (missing) throw new Error(missing);
  const open = deps.radiodjReader ?? ((s, p) => new MysqlRadiodjReader(s, p));
  return open(settings, deps.radiodjPassword!);
}

/**
 * Client AzuraCast (connecteur, test de connexion). Lève une erreur dont le message est un code
 * stable si l'accès est incomplet.
 */
export function openAzuracast(settings: AzuracastSettings, deps: ConnectorDeps): AzuracastClient {
  const missing = azuracastConfigError(settings);
  if (missing) throw new Error(missing);
  const access: AzuracastAccess = {
    url: settings.url,
    station: settings.station,
    apiKey: deps.azuracastApiKey ?? null,
    ca: deps.azuracastCa ?? null,
  };
  return deps.azuracastClient?.(access) ?? new HttpsAzuracastClient(access);
}

/** Connecteurs disponibles. */
function createConnector(
  source: ConnectedSource,
  settings: Settings,
  deps: ConnectorDeps,
): AutomationConnector {
  switch (source) {
    case 'simulator':
      return new SimulatorConnector(settings.simulatorSpeed);
    case 'radiodj':
      return new RadiodjConnector(openRadiodj(settings.radiodj, deps), settings.timezone);
    case 'azuracast':
      return new AzuracastConnector(
        openAzuracast(settings.azuracast, deps),
        settings.azuracast.station,
        settings.azuracast.streamDelaySeconds * 1000,
      );
  }
}

/** Clé de configuration d'une source : son connecteur ne redémarre que si elle change. */
function configKey(source: ConnectedSource, settings: Settings): string {
  switch (source) {
    case 'simulator':
      return `simulator:${settings.simulatorSpeed}`;
    case 'radiodj':
      return `radiodj:${JSON.stringify(settings.radiodj)}:${settings.timezone}`;
    case 'azuracast':
      return `azuracast:${JSON.stringify(settings.azuracast)}`;
  }
}

/** Ce qu'une source fournit au gestionnaire. */
interface SlotHost {
  studioId: number;
  audit: AuditRepo;
  now: () => number;
  /** Les données ou l'état de la source ont changé. */
  changed: () => void;
}

/**
 * Une source en service : son connecteur, son état, ses dernières données. Une erreur de
 * connecteur ne fait jamais tomber le serveur : état « erreur », journalisé, puis nouvel essai.
 */
class SourceSlot {
  status: SourceStatus;
  /** Dernières données reçues ; null avant la première ou après une panne. */
  data: AutomationUpdate | null = null;
  failing = false;
  private connector: AutomationConnector | null = null;
  /** Incrémenté à chaque (re)démarrage : les appels d'un ancien connecteur sont ignorés. */
  private generation = 0;
  private retry: ReturnType<typeof setTimeout> | undefined;
  /** Dernier signal reçu de l'automation (titre brut), pour le mode dégradé. */
  private lastSignal: { title: string; at: number } | null = null;

  constructor(
    readonly source: AutomationSource,
    /** Clé de configuration (voir configKey). */
    readonly key: string,
    private readonly create: () => AutomationConnector,
    private readonly host: SlotHost,
  ) {
    this.status = { id: source, state: 'stopped', updatedAt: null, error: null };
  }

  start(): void {
    const generation = ++this.generation;
    const live = () => generation === this.generation;
    const ctx: ConnectorContext = {
      now: this.host.now,
      update: (update) => {
        if (!live()) return;
        if (this.failing) {
          this.failing = false;
          this.host.audit.write(
            { type: 'system' },
            'automation.recovered',
            { source: this.source },
            this.host.studioId,
          );
        }
        this.data = update;
        this.status = { id: this.source, state: 'ok', updatedAt: this.host.now(), error: null };
        this.host.changed();
      },
      fail: (error) => {
        if (live()) this.fail(error);
      },
    };
    this.status = { id: this.source, state: 'stopped', updatedAt: null, error: null };
    this.host.changed();
    try {
      this.connector = this.create();
      const started = this.connector.start(ctx);
      if (started instanceof Promise) {
        started.catch((err: unknown) => ctx.fail(String((err as Error)?.message ?? err)));
      }
    } catch (err) {
      ctx.fail(String((err as Error)?.message ?? err));
    }
  }

  stop(): void {
    clearTimeout(this.retry);
    this.generation++;
    try {
      this.connector?.stop();
    } catch {
      // Un connecteur qui échoue à s'arrêter ne doit pas bloquer le suivant.
    }
    this.connector = null;
  }

  /**
   * Signal entrant (plugin RadioDJ) : transmis au connecteur en marche ; s'il est en panne, le
   * titre brut sera affiché sans minutage (mode dégradé).
   */
  signal(title: string): void {
    const at = this.host.now();
    this.lastSignal = { title, at };
    if (this.connector && !this.failing) this.connector.signal?.(at, title);
    else this.host.changed();
  }

  /** Mode dégradé : seul le nom du titre est connu (ni durée, ni heure de début). */
  degraded(): Track | null {
    const s = this.lastSignal;
    if (!this.failing || !s || !s.title || this.host.now() - s.at > DEGRADED_MAX_MS) return null;
    return {
      title: s.title,
      artist: '',
      durationMs: 0,
      startedAt: null,
      introMs: null,
      outroMs: null,
    };
  }

  /** Titre en cours et à venir à afficher pour cette source. */
  shown(): { nowPlaying: Track | null; next: Track | null } {
    if (this.failing) return { nowPlaying: this.degraded(), next: null };
    return { nowPlaying: this.data?.nowPlaying ?? null, next: this.data?.next ?? null };
  }

  private fail(error: string): void {
    // Journalisé une fois par panne, pas à chaque nouvel essai.
    if (!this.failing) {
      this.failing = true;
      this.host.audit.write(
        { type: 'system' },
        'automation.error',
        { source: this.source, error },
        this.host.studioId,
      );
    }
    this.stop();
    this.data = null;
    this.status = { id: this.source, state: 'error', updatedAt: this.host.now(), error };
    this.host.changed();
    this.retry = setTimeout(() => this.start(), RETRY_MS);
    this.retry.unref?.();
  }
}

type Role = 'main' | 'live' | 'offair';

/** Auteur d'une bascule forcée (modification des paramètres). */
export type SwitchActor = { type: 'user'; id: number };

/**
 * Fait tourner les connecteurs d'un studio et reporte ce qu'ils transmettent dans l'état
 * antenne. Deux modes (voir docs/plan-etape-8.md, décisions 7 à 9) : une source unique, ou
 * une source pour le direct et une autre hors direct, qui tournent en même temps ; la bascule
 * est automatique (indicateur « en direct » de la source hors direct, ex. AzuraCast) ou forcée.
 */
export class AutomationManager {
  private readonly slots = new Map<Role, SourceSlot>();
  private switching = false;
  private force: Settings['airSwitch']['force'] = 'auto';
  private source: AutomationSource = 'none';
  /** Côté à l'antenne en mode bascule ; null : pas encore déterminé (rien à journaliser). */
  private activeLive: boolean | null = null;
  /** Auteur de la prochaine bascule (forçage par un admin), le temps d'une recomposition. */
  private actor: SwitchActor | null = null;
  /** Pas de recomposition pendant la mise en place de plusieurs sources. */
  private applying = false;

  constructor(
    private readonly studioId: number,
    private readonly air: AirStateStore,
    private readonly audit: AuditRepo,
    private readonly now: () => number = Date.now,
    private readonly deps: ConnectorDeps = {},
  ) {}

  /** Source dont les titres sont affichés. */
  get currentSource(): AutomationSource {
    return this.source;
  }

  /** Base RadioDJ avec les accès du serveur (test de connexion, recherche de titres). */
  openRadiodj(settings: RadiodjSettings): RadiodjReader {
    return openRadiodj(settings, this.deps);
  }

  /** Client AzuraCast avec les secrets du serveur (test de connexion). */
  openAzuracast(settings: AzuracastSettings): AzuracastClient {
    return openAzuracast(settings, this.deps);
  }

  /** Une clé API AzuraCast est fournie au serveur (sa valeur n'est jamais exposée). */
  get azuracastKeyConfigured(): boolean {
    return Boolean(this.deps.azuracastApiKey);
  }

  /**
   * Applique les paramètres. Une source ne redémarre que si sa configuration change ; changer
   * seulement le forçage bascule sans rien redémarrer (`actor` : l'admin qui l'a demandé).
   */
  apply(settings: Settings, actor?: SwitchActor): void {
    const sw = settings.airSwitch;
    const desired = new Map<Role, ConnectedSource>(
      sw.enabled
        ? [
            ['live', sw.liveSource],
            ['offair', sw.offAirSource],
          ]
        : settings.automationSource === 'none'
          ? []
          : [['main', settings.automationSource]],
    );
    if (sw.enabled !== this.switching) this.activeLive = null;
    this.switching = sw.enabled;
    const forceChanged = sw.enabled && this.force !== sw.force;
    this.force = sw.force;

    const started: SourceSlot[] = [];
    this.applying = true;
    for (const [role, slot] of this.slots) {
      const source = desired.get(role);
      if (source && slot.key === configKey(source, settings)) continue;
      slot.stop();
      this.slots.delete(role);
    }
    for (const [role, source] of desired) {
      if (this.slots.has(role)) continue;
      const slot = this.newSlot(source, configKey(source, settings), () =>
        createConnector(source, settings, this.deps),
      );
      this.slots.set(role, slot);
      started.push(slot);
    }
    for (const slot of started) slot.start();
    this.applying = false;
    if (forceChanged && actor) this.actor = actor;
    this.compose();
    this.actor = null;
  }

  /**
   * Signal entrant de l'automation (plugin RadioDJ) : un titre démarre. Transmis à la source
   * concernée, à l'antenne ou non. Ignoré si elle n'est pas en service.
   */
  signal(source: AutomationSource, title: string): boolean {
    let found = false;
    for (const slot of this.slots.values()) {
      if (slot.source !== source) continue;
      found = true;
      slot.signal(title);
    }
    return found;
  }

  stop(): void {
    for (const slot of this.slots.values()) slot.stop();
    this.slots.clear();
    this.switching = false;
    this.activeLive = null;
  }

  private newSlot(source: AutomationSource, key: string, create: () => AutomationConnector) {
    return new SourceSlot(source, key, create, {
      studioId: this.studioId,
      audit: this.audit,
      now: this.now,
      changed: () => {
        if (!this.applying) this.compose();
      },
    });
  }

  /** Source unique lancée avec un connecteur donné (tests). */
  private launch(create: () => AutomationConnector): void {
    this.stop();
    const slot = this.newSlot(this.source, 'custom', create);
    this.slots.set('main', slot);
    slot.start();
  }

  /** Recalcule l'état antenne à partir des sources. */
  private compose(): void {
    if (!this.switching) {
      const slot = this.slots.get('main');
      this.source = slot?.source ?? 'none';
      if (!slot) {
        this.air.update(this.studioId, {
          nowPlaying: null,
          next: null,
          source: { id: 'none', state: 'stopped', updatedAt: null, error: null },
          live: null,
        });
        return;
      }
      this.air.update(this.studioId, { ...slot.shown(), source: slot.status, live: null });
      return;
    }

    const live = this.slots.get('live');
    const offAir = this.slots.get('offair');
    if (!live || !offAir) return;
    // Indicateur de la source hors direct ; tant qu'elle ne répond pas, on reste où l'on est.
    const reported = offAir.failing || !offAir.data ? undefined : offAir.data.live;
    const auto = reported ?? this.activeLive ?? false;
    const active = this.force === 'live' ? true : this.force === 'offair' ? false : auto;
    const slot = active ? live : offAir;

    let shown = slot.shown();
    // Secours : source du direct en panne, on affiche ce que la source hors direct reçoit
    // (métadonnées envoyées par l'encodeur du direct), à défaut le titre signalé.
    if (active && live.failing) {
      const relay = offAir.failing ? null : (offAir.data?.nowPlaying ?? null);
      shown = { nowPlaying: relay ?? live.degraded(), next: null };
    }

    if (this.activeLive !== null && this.activeLive !== active) {
      this.audit.write(
        this.actor ?? { type: 'system' },
        'automation.switched',
        {
          to: active ? 'live' : 'offair',
          source: slot.source,
          cause: this.force === 'auto' ? 'auto' : 'forced',
        },
        this.studioId,
      );
    }
    this.activeLive = active;
    this.source = slot.source;

    const state: Partial<AirState> = {
      ...shown,
      source: slot.status,
      live: {
        active,
        forced: this.force !== 'auto',
        liveSource: live.status,
        offAirSource: offAir.status,
      },
    };
    this.air.update(this.studioId, state);
  }
}
