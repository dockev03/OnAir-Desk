import type { Settings, WeatherSettings, WeatherState } from '@onair-desk/shared';
import type { AirStateStore } from '../../air/state.js';
import type { Repos } from '../../db/index.js';
import { OpenMeteoConnector, weatherErrorCode, type WeatherConnector } from './openmeteo.js';

/** Relecture de la météo : toutes les 20 minutes. */
export const WEATHER_POLL_MS = 20 * 60_000;
/** Après une panne, nouvel essai plus tôt. */
export const WEATHER_RETRY_MS = 5 * 60_000;
export const DEFAULT_OPEN_METEO_URL = 'https://api.open-meteo.com';

export interface WeatherDeps {
  /** Adresse de l'API Open-Meteo (OPEN_METEO_URL, pour les tests). */
  openMeteoUrl?: string;
  /** Fournisseur (remplacé dans les tests). */
  connector?: (settings: WeatherSettings, timezone: string) => WeatherConnector;
}

/**
 * Météo du studio (voir docs/plan-etape-9.md, décisions 8 à 10) : interrogée par le serveur,
 * diffusée dans l'état antenne. En cas de panne, la dernière valeur reste (avec son heure,
 * l'écran juge de sa fraîcheur) ; panne et retour sont journalisés une fois.
 */
export class WeatherManager {
  private key = '';
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private failing = false;
  private state: WeatherState | null = null;
  private connector: WeatherConnector | null = null;
  private location = '';

  constructor(
    private readonly studioId: number,
    private readonly air: AirStateStore,
    private readonly repos: Pick<Repos, 'audit' | 'weatherCache'>,
    private readonly now: () => number = Date.now,
    private readonly deps: WeatherDeps = {},
  ) {}

  /** Fournisseur pour ces paramètres (relecture, bouton « Tester »). */
  open(settings: WeatherSettings, timezone: string): WeatherConnector {
    return (
      this.deps.connector?.(settings, timezone) ??
      new OpenMeteoConnector(settings, timezone, this.deps.openMeteoUrl ?? DEFAULT_OPEN_METEO_URL)
    );
  }

  /** Applique les paramètres ; ne relance l'interrogation que si la météo ou le fuseau change. */
  apply(settings: Settings): void {
    const w = settings.weather;
    const key = `${JSON.stringify(w)}:${settings.timezone}`;
    if (key === this.key) return;
    this.key = key;
    this.stop();
    if (w.provider === 'none') {
      this.state = null;
      this.air.update(this.studioId, { weather: null });
      return;
    }
    this.connector = this.open(w, settings.timezone);
    this.location = `${w.provider}:${w.latitude}:${w.longitude}`;
    // Dernière valeur connue pour ce lieu : affichée tout de suite, même après un redémarrage.
    const cached = this.repos.weatherCache.get(this.location);
    this.state = {
      now: cached ? { ...cached.now, city: w.city } : null,
      updatedAt: cached?.updatedAt ?? null,
      state: 'stopped',
      error: null,
    };
    this.air.update(this.studioId, { weather: this.state });
    void this.refresh(this.generation);
  }

  stop(): void {
    this.generation++;
    clearTimeout(this.timer);
    this.connector = null;
  }

  private schedule(generation: number, delay: number): void {
    this.timer = setTimeout(() => void this.refresh(generation), delay);
    this.timer.unref?.();
  }

  private async refresh(generation: number): Promise<void> {
    const connector = this.connector;
    if (!connector || generation !== this.generation) return;
    try {
      const now = await connector.current();
      if (generation !== this.generation) return;
      const at = this.now();
      this.repos.weatherCache.set(this.location, now, at);
      if (this.failing) {
        this.failing = false;
        this.repos.audit.write({ type: 'system' }, 'weather.recovered', {}, this.studioId);
      }
      this.state = { now, updatedAt: at, state: 'ok', error: null };
      this.schedule(generation, WEATHER_POLL_MS);
    } catch (err) {
      if (generation !== this.generation) return;
      const error = `${weatherErrorCode(err)}: ${(err as Error)?.message ?? String(err)}`;
      if (!this.failing) {
        this.failing = true;
        this.repos.audit.write({ type: 'system' }, 'weather.error', { error }, this.studioId);
      }
      // La dernière valeur reste : l'écran l'affiche avec son heure, puis plus du tout.
      this.state = { ...(this.state ?? { now: null, updatedAt: null }), state: 'error', error };
      this.schedule(generation, WEATHER_RETRY_MS);
    }
    this.air.update(this.studioId, { weather: this.state });
  }
}
