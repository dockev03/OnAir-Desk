import type { Settings } from '@onair-desk/shared';
import { api } from './api.js';

let current = $state<Settings | null>(null);
let pending: Promise<Settings> | null = null;

/** Paramètres de la station (repères, vitesse par défaut…), chargés une fois puis mis en cache. */
export const stationSettings = {
  get value() {
    return current;
  },
  load(force = false): Promise<Settings> {
    if (current && !force) return Promise.resolve(current);
    pending ??= api<Settings>('GET', '/api/settings')
      .then((s) => (current = s))
      .finally(() => (pending = null));
    return pending;
  },
  set(s: Settings) {
    current = s;
  },
};
