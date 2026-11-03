import type { AirStateStore } from '../air/state.js';
import type { Config } from '../config.js';
import type { AutomationManager } from '../connectors/manager.js';
import type { Repos } from '../db/index.js';
import type { LoginThrottle } from '../auth/throttle.js';
import type { WeatherManager } from '../connectors/weather/manager.js';
import type { Library } from '../library.js';
import type { OnAirService } from '../onair.js';
import type { Rundowns } from '../rundowns.js';
import type { SetupState } from '../setup.js';
import type { Templates } from '../templates.js';
import type { Hub } from '../ws/hub.js';

/** Dépendances partagées par les routes. */
export interface RouteContext {
  config: Config;
  repos: Repos;
  hub: Hub;
  library: Library;
  rundowns: Rundowns;
  templates: Templates;
  air: AirStateStore;
  /** Connecteur d'automation du studio par défaut. */
  automation: AutomationManager;
  /** Voyant ON AIR des studios. */
  onAir: OnAirService;
  /** Météo du studio par défaut. */
  weather: WeatherManager;
  throttle: LoginThrottle;
  setup: SetupState;
  /** Certificat racine de l'autorité interne (PEM), s'il y en a une. */
  rootCaPem: () => string | null;
}

/** Limite de débit des routes sensibles (connexion, installation, appairage). */
export const strictRateLimit = { rateLimit: { max: 10, timeWindow: '1 minute' } };
