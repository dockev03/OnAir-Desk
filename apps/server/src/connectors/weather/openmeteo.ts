import { z } from 'zod';
import type { WeatherNow, WeatherSettings } from '@onair-desk/shared';

/** Délai d'une requête à Open-Meteo. */
export const REQUEST_TIMEOUT_MS = 10_000;

/** Ce que le gestionnaire attend d'un fournisseur météo (Open-Meteo, Météo-France plus tard…). */
export interface WeatherConnector {
  /** Météo actuelle ; lève une erreur dont le message commence par un code stable. */
  current(): Promise<WeatherNow>;
}

/** Erreur dont le code est stable (traduit côté interface). */
export class WeatherError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Réponse d'Open-Meteo : seuls les champs utiles sont lus. */
const responseSchema = z.object({
  current: z.object({
    temperature_2m: z.number(),
    weather_code: z.number().int(),
    is_day: z.number().int().optional(),
  }),
  daily: z
    .object({
      temperature_2m_max: z.array(z.number().nullable()).optional(),
      temperature_2m_min: z.array(z.number().nullable()).optional(),
    })
    .optional(),
});

/** Réponse d'Open-Meteo → météo affichée ; null si elle n'a pas la forme attendue. */
export function parseOpenMeteo(raw: unknown, city: string): WeatherNow | null {
  const r = responseSchema.safeParse(raw);
  if (!r.success) return null;
  const { current, daily } = r.data;
  return {
    city,
    temperature: current.temperature_2m,
    code: current.weather_code,
    isDay: current.is_day !== 0,
    min: daily?.temperature_2m_min?.[0] ?? null,
    max: daily?.temperature_2m_max?.[0] ?? null,
  };
}

/**
 * Open-Meteo (gratuit, sans clé, licence CC BY 4.0 : attribution affichée dans l'interface).
 * Interrogé par le serveur seulement : l'afficheur n'a pas besoin d'Internet.
 */
export class OpenMeteoConnector implements WeatherConnector {
  constructor(
    private readonly settings: WeatherSettings,
    /** Fuseau de la station : minimale et maximale du jour local. */
    private readonly timezone: string,
    /** Adresse de l'API (OPEN_METEO_URL, pour les tests). */
    private readonly baseUrl: string,
  ) {}

  /** Adresse de la requête : température, code météo, jour / nuit, extrêmes du jour. */
  url(): string {
    const q = new URLSearchParams({
      latitude: String(this.settings.latitude),
      longitude: String(this.settings.longitude),
      current: 'temperature_2m,weather_code,is_day',
      daily: 'temperature_2m_max,temperature_2m_min',
      timezone: this.timezone,
      forecast_days: '1',
    });
    return `${this.baseUrl.replace(/\/+$/, '')}/v1/forecast?${q}`;
  }

  async current(): Promise<WeatherNow> {
    let res: Response;
    try {
      res = await fetch(this.url(), {
        headers: { accept: 'application/json', 'user-agent': 'OnAir-Desk' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw new WeatherError('weather_unreachable', (err as Error)?.message ?? String(err));
    }
    if (!res.ok) throw new WeatherError('weather_http', `HTTP ${res.status}`);
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new WeatherError('weather_bad_response', 'invalid JSON');
    }
    const now = parseOpenMeteo(body, this.settings.city);
    if (!now) throw new WeatherError('weather_bad_response', 'unexpected data');
    return now;
  }
}

/** Erreur → code stable. */
export const weatherErrorCode = (err: unknown): string =>
  err instanceof WeatherError ? err.code : 'weather_error';
