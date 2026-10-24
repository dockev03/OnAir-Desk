import type { AutomationSource, RadiodjSettings, Settings, Track } from '@onair-desk/shared';
import type { AirStateStore } from '../air/state.js';
import type { AuditRepo } from '../db/audit.js';
import { RadiodjConnector } from './radiodj/connector.js';
import { MysqlRadiodjReader, type RadiodjReader } from './radiodj/reader.js';
import { SimulatorConnector } from './simulator.js';
import type { AutomationConnector, ConnectorContext } from './types.js';

/** Délai avant un nouvel essai après une erreur de connecteur. */
export const RETRY_MS = 30_000;
/** Mode dégradé : le titre reçu par signal reste affiché au plus 10 minutes. */
export const DEGRADED_MAX_MS = 10 * 60_000;

/** Ce dont les connecteurs ont besoin en dehors des paramètres (secrets, accès aux bases). */
export interface ConnectorDeps {
  /** RADIODJ_DB_PASSWORD ; null : variable absente. */
  radiodjPassword?: string | null;
  /** Ouverture de la base RadioDJ (remplacée dans les tests). */
  radiodjReader?: (settings: RadiodjSettings, password: string) => RadiodjReader;
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

/** Connecteurs disponibles, selon le paramètre « Source d'automation ». */
function createConnector(
  source: Exclude<AutomationSource, 'none'>,
  settings: Settings,
  deps: ConnectorDeps,
): AutomationConnector {
  switch (source) {
    case 'simulator':
      return new SimulatorConnector(settings.simulatorSpeed);
    case 'radiodj':
      return new RadiodjConnector(openRadiodj(settings.radiodj, deps), settings.timezone);
  }
}

/** Clé de configuration : le connecteur ne redémarre que si elle change. */
function configKey(settings: Settings): string {
  switch (settings.automationSource) {
    case 'simulator':
      return `simulator:${settings.simulatorSpeed}`;
    case 'radiodj':
      return `radiodj:${JSON.stringify(settings.radiodj)}:${settings.timezone}`;
    default:
      return settings.automationSource;
  }
}

/**
 * Fait tourner le connecteur choisi pour un studio et reporte ce qu'il transmet dans l'état
 * antenne. Une erreur de connecteur ne fait jamais tomber le serveur : état « erreur »
 * affiché, journalisé, puis nouvel essai.
 */
export class AutomationManager {
  private connector: AutomationConnector | null = null;
  private source: AutomationSource = 'none';
  private key = '';
  /** Incrémenté à chaque (re)démarrage : les appels d'un ancien connecteur sont ignorés. */
  private generation = 0;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private failing = false;
  /** Dernier signal reçu de l'automation (titre brut), pour le mode dégradé. */
  private lastSignal: { title: string; at: number } | null = null;

  constructor(
    private readonly studioId: number,
    private readonly air: AirStateStore,
    private readonly audit: AuditRepo,
    private readonly now: () => number = Date.now,
    private readonly deps: ConnectorDeps = {},
  ) {}

  /** Source d'automation en cours. */
  get currentSource(): AutomationSource {
    return this.source;
  }

  /** Base RadioDJ avec les accès du serveur (test de connexion, recherche de titres). */
  openRadiodj(settings: RadiodjSettings): RadiodjReader {
    return openRadiodj(settings, this.deps);
  }

  /** Applique les paramètres ; ne redémarre le connecteur que si sa configuration change. */
  apply(settings: Settings): void {
    const key = configKey(settings);
    if (key === this.key) return;
    this.key = key;
    this.halt();
    this.source = settings.automationSource;
    this.failing = false;
    this.lastSignal = null;
    if (settings.automationSource === 'none') {
      this.air.update(this.studioId, {
        nowPlaying: null,
        next: null,
        source: { id: 'none', state: 'stopped', updatedAt: null, error: null },
      });
      return;
    }
    const source = settings.automationSource;
    this.launch(() => createConnector(source, settings, this.deps));
  }

  /**
   * Signal entrant de l'automation (plugin RadioDJ) : un titre démarre. Transmis au connecteur
   * en marche ; s'il est en panne, le titre brut est affiché sans minutage (mode dégradé).
   * Ignoré si la source choisie n'est pas celle qui signale.
   */
  signal(source: AutomationSource, title: string): boolean {
    if (source !== this.source) return false;
    const at = this.now();
    this.lastSignal = { title, at };
    if (this.connector && !this.failing) this.connector.signal?.(at, title);
    else this.showDegraded();
    return true;
  }

  /** Mode dégradé : seul le nom du titre est connu (ni durée, ni heure de début). */
  private showDegraded(): void {
    const s = this.lastSignal;
    if (!s || !s.title || this.now() - s.at > DEGRADED_MAX_MS) return;
    const track: Track = {
      title: s.title,
      artist: '',
      durationMs: 0,
      startedAt: null,
      introMs: null,
      outroMs: null,
    };
    this.air.update(this.studioId, { nowPlaying: track, next: null });
  }

  stop(): void {
    this.halt();
    this.key = '';
  }

  private halt(): void {
    clearTimeout(this.retry);
    this.generation++;
    try {
      this.connector?.stop();
    } catch {
      // Un connecteur qui échoue à s'arrêter ne doit pas bloquer le suivant.
    }
    this.connector = null;
  }

  private launch(create: () => AutomationConnector): void {
    const generation = ++this.generation;
    const live = () => generation === this.generation;
    const ctx: ConnectorContext = {
      now: this.now,
      update: ({ nowPlaying, next }) => {
        if (!live()) return;
        if (this.failing) {
          this.failing = false;
          this.audit.write(
            { type: 'system' },
            'automation.recovered',
            { source: this.source },
            this.studioId,
          );
        }
        this.air.update(this.studioId, {
          nowPlaying,
          next,
          source: { id: this.source, state: 'ok', updatedAt: this.now(), error: null },
        });
      },
      fail: (error) => {
        if (live()) this.fail(create, error);
      },
    };
    this.air.update(this.studioId, {
      source: { id: this.source, state: 'stopped', updatedAt: null, error: null },
    });
    try {
      this.connector = create();
      const started = this.connector.start(ctx);
      if (started instanceof Promise) {
        started.catch((err: unknown) => ctx.fail(String((err as Error)?.message ?? err)));
      }
    } catch (err) {
      ctx.fail(String((err as Error)?.message ?? err));
    }
  }

  private fail(create: () => AutomationConnector, error: string): void {
    // Journalisé une fois par panne, pas à chaque nouvel essai.
    if (!this.failing) {
      this.failing = true;
      this.audit.write(
        { type: 'system' },
        'automation.error',
        { source: this.source, error },
        this.studioId,
      );
    }
    this.halt();
    this.air.update(this.studioId, {
      nowPlaying: null,
      next: null,
      source: { id: this.source, state: 'error', updatedAt: this.now(), error },
    });
    this.showDegraded();
    this.retry = setTimeout(() => this.launch(create), RETRY_MS);
    this.retry.unref?.();
  }
}
