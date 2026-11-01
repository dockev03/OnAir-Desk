import type { Track } from '@onair-desk/shared';

/**
 * Repères RadioDJ (`songs.cue_times`) : « &sta=0.33&int=4.37&out=161.41&xta=164.32&end=164.62… »,
 * en secondes depuis le début du fichier. Voir docs/cadrage-radiodj.md.
 *  - sta : début de lecture (cue in) ;
 *  - int : fin de l'intro (talk-over) ;
 *  - out : début de l'outro ;
 *  - xta : point de mix, le titre suivant démarre ;
 *  - end : fin de lecture (cue out).
 */
export type CuePoints = Partial<Record<'sta' | 'int' | 'out' | 'xta' | 'end', number>>;

const KEYS = new Set(['sta', 'int', 'out', 'xta', 'end']);

/** Analyse de la chaîne de repères ; clés inconnues et valeurs invalides ignorées. */
export function parseCueTimes(raw: string | null | undefined): CuePoints {
  const cues: CuePoints = {};
  if (!raw) return cues;
  for (const pair of raw.split('&')) {
    const [key, value] = pair.split('=');
    if (!key || value === undefined || !KEYS.has(key)) continue;
    const n = Number(value);
    if (value.trim() !== '' && Number.isFinite(n) && n >= 0) {
      cues[key as keyof CuePoints] = n;
    }
  }
  return cues;
}

/** Ligne de la base décrivant un titre (historique ou file d'attente). */
export interface SongRow {
  artist: string;
  title: string;
  /** Durée du fichier en secondes (`duration`). */
  duration: number;
  cueTimes: string | null;
}

/** RadioDJ sépare les artistes associés par « ; ». */
export const displayArtist = (artist: string): string =>
  artist
    .split(';')
    .map((a) => a.trim())
    .filter(Boolean)
    .join(', ');

/**
 * Durées d'un titre selon ses repères, en secondes relatives au début de lecture (sta) :
 *  - durée = jusqu'au point de mix (xta), à défaut jusqu'à la fin (end), à défaut le fichier ;
 *  - intro = jusqu'à int, si le repère est dans le titre ;
 *  - outro = de out jusqu'à la fin retenue, si le repère est dans le titre.
 */
export function songTiming(row: Pick<SongRow, 'duration' | 'cueTimes'>): {
  durationSec: number;
  introSec: number | null;
  outroSec: number | null;
} {
  const cues = parseCueTimes(row.cueTimes);
  const sta = cues.sta ?? 0;
  const stop = [cues.xta, cues.end].find((v) => v !== undefined && v > sta);
  const fileDuration = Number.isFinite(row.duration) && row.duration > 0 ? row.duration : 0;
  const durationSec = stop !== undefined ? stop - sta : Math.max(0, fileDuration - sta);
  const inside = (v: number | undefined): v is number =>
    v !== undefined && v > sta && v < sta + durationSec;
  return {
    durationSec,
    introSec: inside(cues.int) ? cues.int - sta : null,
    outroSec: inside(cues.out) ? sta + durationSec - cues.out : null,
  };
}

/**
 * Année d'un titre (`songs.year`, texte) : null si vide, illisible, hors bornes, ou égale à
 * 1900, valeur par défaut de RadioDJ pour « non renseignée ».
 */
export function songYear(raw: string | null | undefined): number | null {
  const v = raw?.trim() ?? '';
  if (!/^\d{4}$/.test(v)) return null;
  const year = Number(v);
  return year > 1900 && year <= 2999 ? year : null;
}

const ms = (seconds: number) => Math.round(seconds * 1000);

/** Titre de l'état antenne à partir d'une ligne de la base. */
export function toTrack(row: SongRow, startedAt: number | null): Track {
  const t = songTiming(row);
  return {
    title: row.title,
    artist: displayArtist(row.artist),
    durationMs: ms(t.durationSec),
    startedAt,
    introMs: t.introSec === null ? null : ms(t.introSec),
    outroMs: t.outroSec === null ? null : ms(t.outroSec),
  };
}
