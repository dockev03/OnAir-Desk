/**
 * Météo : pictogrammes et fraîcheur de la donnée (voir docs/plan-etape-9.md, décisions 10
 * et 11). Fonctions pures, utilisées par le serveur et par l'écran studio.
 */

/** Pictogrammes servis avec l'interface (aucune ressource externe). */
export const WEATHER_ICONS = [
  'clear',
  'clear-night',
  'partly',
  'partly-night',
  'cloudy',
  'fog',
  'drizzle',
  'rain',
  'snow',
  'showers',
  'storm',
] as const;
export type WeatherIcon = (typeof WEATHER_ICONS)[number];

/** Libellé court d'un temps (clé de traduction `weather.<libellé>`). */
export const WEATHER_LABELS = [
  'clear',
  'partly',
  'cloudy',
  'fog',
  'drizzle',
  'rain',
  'snow',
  'showers',
  'storm',
] as const;
export type WeatherLabel = (typeof WEATHER_LABELS)[number];

/** Code météo WMO (Open-Meteo) → libellé ; code inconnu : nuageux. */
export function weatherLabel(code: number): WeatherLabel {
  if (code === 0) return 'clear';
  if (code === 1 || code === 2) return 'partly';
  if (code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 57) return 'drizzle';
  if ((code >= 61 && code <= 67) || code === 80 || code === 81 || code === 82) {
    return code >= 80 ? 'showers' : 'rain';
  }
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95 && code <= 99) return 'storm';
  return 'cloudy';
}

/** Pictogramme d'un temps, de jour ou de nuit. */
export function weatherIcon(code: number, isDay: boolean): WeatherIcon {
  const label = weatherLabel(code);
  if (!isDay && label === 'clear') return 'clear-night';
  if (!isDay && label === 'partly') return 'partly-night';
  return label;
}

/** Au-delà, la météo est affichée avec son heure. */
export const WEATHER_STALE_MS = 45 * 60_000;
/** Au-delà, elle n'est plus affichée (donnée trop ancienne). */
export const WEATHER_MAX_AGE_MS = 6 * 3600_000;

export type WeatherFreshness = 'fresh' | 'stale' | 'expired';

/** Fraîcheur d'une valeur obtenue à `updatedAt` (heure serveur, ms). */
export function weatherFreshness(updatedAt: number | null, now: number): WeatherFreshness {
  if (updatedAt === null) return 'expired';
  const age = now - updatedAt;
  if (age > WEATHER_MAX_AGE_MS) return 'expired';
  return age > WEATHER_STALE_MS ? 'stale' : 'fresh';
}

/** Température affichée : arrondie au degré, sans « -0 ». */
export function formatTemperature(celsius: number): string {
  const n = Math.round(celsius);
  return `${n === 0 ? 0 : n} °C`;
}
