import type { Me, PublicUser } from '@onair-desk/shared';
import { api, ApiRequestError } from './api.js';
import { i18n } from './i18n/index.svelte.js';

/** Compte connecté (null si personne, ou si c'est un appareil kiosk). */
let user = $state<PublicUser | null>(null);

export const session = {
  get user() {
    return user;
  },
  set(u: PublicUser | null) {
    user = u;
    if (u) i18n.set(u.locale);
  },
};

/** Recharge l'identité courante ; renvoie null si non connecté. */
export async function loadMe(): Promise<Me | null> {
  try {
    const me = await api<Me>('GET', '/api/auth/me');
    session.set(me.kind === 'user' ? me.user : null);
    return me;
  } catch (e) {
    if (e instanceof ApiRequestError && e.status === 401) {
      session.set(null);
      return null;
    }
    throw e;
  }
}

export async function logout(): Promise<void> {
  await api('POST', '/api/auth/logout').catch(() => {});
  session.set(null);
}
