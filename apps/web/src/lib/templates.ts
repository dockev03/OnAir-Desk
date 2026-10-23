import { WEEKDAYS, addDays, weekdayOf } from '@onair-desk/shared';

/** Nom court d'un jour (1 = lundi … 7 = dimanche) selon la langue : « lun. », « Mon »… */
export function weekdayName(day: number, locale: string): string {
  // Le 5 janvier 2026 est un lundi.
  return new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(
    new Date(Date.UTC(2026, 0, 4 + day)),
  );
}

/** Jours de diffusion affichés : « lun. → ven. » pour une suite, sinon la liste. */
export function formatDays(days: number[], locale: string): string {
  const sorted = [...days].sort();
  const consecutive = sorted.every((d, i) => i === 0 || d === sorted[i - 1]! + 1);
  if (sorted.length >= 3 && consecutive) {
    return `${weekdayName(sorted[0]!, locale)} → ${weekdayName(sorted.at(-1)!, locale)}`;
  }
  return sorted.map((d) => weekdayName(d, locale)).join(', ');
}

/** Période proposée pour « Créer les conducteurs » : la semaine suivante, du lundi au dimanche. */
export function nextWeek(today: string): { from: string; to: string } {
  const from = addDays(today, 8 - weekdayOf(today));
  return { from, to: addDays(from, 6) };
}

export { WEEKDAYS };
