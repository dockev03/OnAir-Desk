import type { TimeFormat } from './schemas.js';

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
