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

/** Adresse du logo de la station (change avec l'image : le navigateur peut la garder en cache). */
export const logoUrl = (s: Settings | null): string | null =>
  s?.logoHash ? `/api/station/logo?v=${s.logoHash}` : null;
