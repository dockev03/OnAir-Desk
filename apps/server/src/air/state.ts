import {
  emptyAirState,
  type AirMessage,
  type AirSnapshot,
  type AirState,
} from '@onair-desk/shared';
import type { Hub } from '../ws/hub.js';

/**
 * État antenne de chaque studio, en mémoire : il est reconstruit par les connecteurs au
 * démarrage. Chaque changement incrémente la version et n'envoie aux écrans du studio que
 * les champs réellement modifiés.
 */
export class AirStateStore {
  private readonly studios = new Map<number, AirSnapshot>();

  constructor(private readonly hub: Hub) {}

  get(studioId: number): AirSnapshot {
    let s = this.studios.get(studioId);
    if (!s) {
      s = { version: 1, state: emptyAirState() };
      this.studios.set(studioId, s);
    }
    return s;
  }

  /** Message d'état complet (connexion, ou version manquante côté écran). */
  full(studioId: number): AirMessage {
    const { version, state } = this.get(studioId);
    return { type: 'air', version, full: true, changes: state };
  }

  /** Applique des changements ; renvoie vrai si quelque chose a changé (et a été diffusé). */
  update(studioId: number, changes: Partial<AirState>): boolean {
    const current = this.get(studioId);
    const diff: Partial<AirState> = {};
    for (const [key, value] of Object.entries(changes) as [keyof AirState, unknown][]) {
      if (JSON.stringify(current.state[key]) !== JSON.stringify(value)) {
        (diff as Record<string, unknown>)[key] = value;
      }
    }
    if (Object.keys(diff).length === 0) return false;
    const next: AirSnapshot = {
      version: current.version + 1,
      state: { ...current.state, ...diff },
    };
    this.studios.set(studioId, next);
    this.hub.broadcastStudio(studioId, {
      type: 'air',
      version: next.version,
      full: false,
      changes: diff,
    });
    return true;
  }
}
