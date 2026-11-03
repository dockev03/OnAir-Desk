import type { OnAirRequest, OnAirSource, OnAirState } from '@onair-desk/shared';
import type { AirStateStore } from './air/state.js';
import type { Repos } from './db/index.js';

/** Auteur d'un passage : compte, écran studio, ou équipement / logiciel (jeton On Air). */
export type OnAirActor = { type: 'user'; id: number } | { type: 'device'; id: number } | null;

/**
 * Voyant ON AIR (voir docs/plan-etape-9.md, décisions 1 à 7) : un état par studio, conservé en
 * base et reporté dans l'état antenne. La dernière action l'emporte, d'où qu'elle vienne.
 */
export class OnAirService {
  constructor(
    private readonly repos: Repos,
    private readonly air: AirStateStore,
    private readonly now: () => number = Date.now,
  ) {}

  /** Reporte l'état conservé dans l'état antenne (démarrage du serveur). */
  restore(studioId: number): void {
    this.air.update(studioId, { onAir: this.repos.onAir.get(studioId) });
  }

  get(studioId: number): OnAirState {
    return this.repos.onAir.get(studioId);
  }

  /**
   * Allume, éteint ou inverse. Un état déjà atteint ne change rien (ni l'heure du passage, ni
   * le journal). Renvoie l'état obtenu.
   */
  set(studioId: number, request: OnAirRequest, source: OnAirSource, actor: OnAirActor): OnAirState {
    const current = this.repos.onAir.get(studioId);
    const on = request === 'toggle' ? !current.on : request === 'on';
    if (on === current.on) return current;
    const at = this.now();
    const next: OnAirState = {
      on,
      since: at,
      source,
      lastDurationMs:
        !on && current.since !== null ? Math.max(0, at - current.since) : current.lastDurationMs,
    };
    this.repos.onAir.set(studioId, next);
    this.repos.audit.write(
      actor ?? { type: 'system' },
      'onair.changed',
      {
        state: on ? 'on' : 'off',
        source,
        ...(next.lastDurationMs !== null && !on ? { durationMs: next.lastDurationMs } : {}),
      },
      studioId,
    );
    this.air.update(studioId, { onAir: next });
    return next;
  }
}
