import type { Config } from '../config.js';
import type { Repos } from '../db/index.js';
import type { LoginThrottle } from '../auth/throttle.js';
import type { Library } from '../library.js';
import type { SetupState } from '../setup.js';
import type { Hub } from '../ws/hub.js';

/** Dépendances partagées par les routes. */
export interface RouteContext {
  config: Config;
  repos: Repos;
  hub: Hub;
  library: Library;
  throttle: LoginThrottle;
  setup: SetupState;
  /** Certificat racine de l'autorité interne (PEM), s'il y en a une. */
  rootCaPem: () => string | null;
}

/** Limite de débit des routes sensibles (connexion, installation, appairage). */
export const strictRateLimit = { rateLimit: { max: 10, timeWindow: '1 minute' } };
