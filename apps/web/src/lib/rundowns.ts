import type { RundownSummary } from '@onair-desk/shared';

export { addDays } from '@onair-desk/shared';

/** Identifiant stable d'un nouvel élément de conducteur. */
export function newItemUid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  // Repli hors contexte sécurisé (HTTP en développement).
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Date de diffusion AAAA-MM-JJ affichée selon la langue (ex. « jeu. 22 oct. 2026 »). */
export function formatAirDate(airDate: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${airDate}T00:00:00Z`));
}

/** HH:MM:SS → HH:MM (les secondes ne servent qu'au calcul). */
export const shortTime = (t: string): string => t.slice(0, 5);

/**
 * Tri d'affichage : ceux du jour, puis à venir (du plus proche au plus lointain), puis
 * passés (du plus récent au plus ancien).
 */
export function groupByDate(rundowns: RundownSummary[], today: string) {
  const byStart = (a: RundownSummary, b: RundownSummary) =>
    a.airDate.localeCompare(b.airDate) || a.startTime.localeCompare(b.startTime);
  return {
    today: rundowns.filter((r) => r.airDate === today).sort(byStart),
    upcoming: rundowns.filter((r) => r.airDate > today).sort(byStart),
    past: rundowns.filter((r) => r.airDate < today).sort((a, b) => byStart(b, a)),
  };
}

/** Ce qui est affiché dans la zone principale de l'écran studio. */
export type StudioView = 'today' | 'scripts' | 'rundowns' | 'rundown';
