import type { TimeFormat } from './schemas.js';

/**
 * Décalage (ms) à ajouter à l'heure locale pour obtenir l'heure serveur,
 * en supposant un trajet aller-retour symétrique.
 */
export function clockOffset(t0: number, serverTime: number, t1: number): number {
  return serverTime - (t0 + t1) / 2;
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
