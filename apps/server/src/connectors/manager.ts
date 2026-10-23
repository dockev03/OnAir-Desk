import type { AutomationSource, Settings } from '@onair-desk/shared';
import type { AirStateStore } from '../air/state.js';
import type { AuditRepo } from '../db/audit.js';
import { SimulatorConnector } from './simulator.js';
import type { AutomationConnector, ConnectorContext } from './types.js';

/** Délai avant un nouvel essai après une erreur de connecteur. */
export const RETRY_MS = 30_000;

/** Connecteurs disponibles, selon le paramètre « Source d'automation ». */
const FACTORIES: Record<Exclude<AutomationSource, 'none'>, (s: Settings) => AutomationConnector> = {
  simulator: (s) => new SimulatorConnector(s.simulatorSpeed),
};

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

  constructor(
    private readonly studioId: number,
    private readonly air: AirStateStore,
    private readonly audit: AuditRepo,
    private readonly now: () => number = Date.now,
  ) {}

  /** Applique les paramètres ; ne redémarre le connecteur que si sa configuration change. */
  apply(settings: Settings): void {
    const key = `${settings.automationSource}:${settings.simulatorSpeed}`;
    if (key === this.key) return;
    this.key = key;
    this.halt();
    this.source = settings.automationSource;
    this.failing = false;
    if (settings.automationSource === 'none') {
      this.air.update(this.studioId, {
        nowPlaying: null,
        next: null,
        source: { id: 'none', state: 'stopped', updatedAt: null, error: null },
      });
      return;
    }
    const factory = FACTORIES[settings.automationSource];
    this.launch(() => factory(settings));
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
    this.retry = setTimeout(() => this.launch(create), RETRY_MS);
    this.retry.unref?.();
  }
}
