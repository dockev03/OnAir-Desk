import type { TimeFormat } from './schemas.js';

/**
 * Date AAAA-MM-JJ décalée d'un nombre de jours. Ici (et non avec les modèles) pour que l'écran
 * studio l'utilise sans charger les schémas de validation.
 */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Heure HH:MM:SS dans le fuseau de la station. */
export function formatClock(date: Date, timezone: string, format: TimeFormat): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: format === '24h' ? 'h23' : 'h12',
  }).format(date);
}

/** Décalage (ms) du fuseau `timezone` à l'instant `epoch` : heure locale − heure UTC. */
function timezoneOffset(epoch: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(epoch));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const local = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return local - Math.floor(epoch / 1000) * 1000;
}

/**
 * Heure locale « AAAA-MM-JJ HH:MM:SS » d'un fuseau donné → millisecondes UTC.
 * Null si la chaîne est illisible. Pendant l'heure répétée du passage à l'heure d'hiver,
 * le résultat peut être décalé d'une heure (l'heure locale seule ne permet pas de trancher).
 */
export function zonedToEpoch(local: string, timezone: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(local);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  if (Number.isNaN(wall)) return null;
  // Deux passes : le décalage dépend de l'instant, lui-même calculé avec le décalage.
  let epoch = wall - timezoneOffset(wall, timezone);
  epoch = wall - timezoneOffset(epoch, timezone);
  return epoch;
}

/** Date locale AAAA-MM-JJ d'un instant dans le fuseau de la station. */
export function localDateIn(epoch: number, timezone: string): string {
  // en-CA formate les dates en AAAA-MM-JJ.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(epoch));
}
