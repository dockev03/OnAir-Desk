import { zonedToEpoch } from './time.js';

/**
 * Écran de veille hors émission (voir docs/plan-etape-8.md, décisions 10 et 11) : calculs
 * purs, à partir des conducteurs et de l'heure serveur.
 */

/** Marge avant le début et après la fin calculée d'un conducteur : l'émission est « en cours ». */
export const STANDBY_MARGIN_MS = 10 * 60_000;
/** Un clic sur la veille la quitte pour 10 minutes (préparer une émission). */
export const STANDBY_DISMISS_MS = 10 * 60_000;

/** Ce qu'il faut d'un conducteur pour situer l'émission dans le temps. */
export interface ShowSlot {
  airDate: string;
  startTime: string;
  totalSeconds: number;
}

/** Début et fin calculée d'une émission (horloge serveur, ms) ; null si la date est illisible. */
export function showWindow(
  show: ShowSlot,
  timezone: string,
): { start: number; end: number } | null {
  const start = zonedToEpoch(`${show.airDate} ${show.startTime}`, timezone);
  if (start === null) return null;
  return { start, end: start + show.totalSeconds * 1000 };
}

/** Émission en cours : début − marge ≤ maintenant ≤ fin + marge. La plus tôt commencée gagne. */
export function showInProgress<T extends ShowSlot>(
  shows: readonly T[],
  now: number,
  timezone: string,
  marginMs = STANDBY_MARGIN_MS,
): T | null {
  let found: { show: T; start: number } | null = null;
  for (const show of shows) {
    const w = showWindow(show, timezone);
    if (!w || now < w.start - marginMs || now > w.end + marginMs) continue;
    if (!found || w.start < found.start) found = { show, start: w.start };
  }
  return found?.show ?? null;
}

/** Prochaine émission : celle qui commence le plus tôt après maintenant. */
export function nextShow<T extends ShowSlot>(
  shows: readonly T[],
  now: number,
  timezone: string,
): { show: T; startsAt: number } | null {
  let found: { show: T; startsAt: number } | null = null;
  for (const show of shows) {
    const w = showWindow(show, timezone);
    if (!w || w.start <= now) continue;
    if (!found || w.start < found.startsAt) found = { show, startsAt: w.start };
  }
  return found;
}

/** Veille affichée : aucune émission en cours, antenne hors direct et micro fermé. */
export function standbyActive<T extends ShowSlot>(
  shows: readonly T[],
  now: number,
  timezone: string,
  live: boolean,
  onAir = false,
): boolean {
  return !live && !onAir && showInProgress(shows, now, timezone) === null;
}
