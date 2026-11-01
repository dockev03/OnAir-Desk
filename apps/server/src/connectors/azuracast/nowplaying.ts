import { z } from 'zod';
import type { Track } from '@onair-desk/shared';

/**
 * Réponse « Now Playing » d'AzuraCast (GET /api/nowplaying/<station>, et chaque publication du
 * flux SSE). Schéma tolérant : seuls les champs utiles sont lus, les autres sont ignorés.
 */
const songSchema = z.object({
  text: z.string().nullish(),
  artist: z.string().nullish(),
  title: z.string().nullish(),
});

const nowPlayingSchema = z.object({
  station: z
    .object({
      id: z.number().nullish(),
      name: z.string().nullish(),
      shortcode: z.string().nullish(),
    })
    .nullish(),
  live: z
    .object({
      is_live: z.boolean(),
      streamer_name: z.string().nullish(),
    })
    .nullish(),
  now_playing: z
    .object({
      /** Heure de début, secondes Unix (horloge du serveur AzuraCast). */
      played_at: z.number(),
      /** Durée en secondes ; 0 pour un direct (inconnue). */
      duration: z.number().nullish(),
      song: songSchema,
    })
    .nullish(),
  playing_next: z
    .object({
      duration: z.number().nullish(),
      song: songSchema,
    })
    .nullish(),
  is_online: z.boolean().nullish(),
});

export type NowPlayingData = z.infer<typeof nowPlayingSchema>;

/** Données lues ; null si la réponse n'a pas la forme attendue. */
export function parseNowPlaying(raw: unknown): NowPlayingData | null {
  // La liste de toutes les stations (GET /api/nowplaying) est un tableau.
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = nowPlayingSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Vrai si les données concernent la station choisie (nom court ou numéro). */
export function matchesStation(np: NowPlayingData, station: string): boolean {
  const s = np.station;
  if (!s) return true;
  return (
    s.shortcode === station || (s.id !== null && s.id !== undefined && String(s.id) === station)
  );
}

type Song = z.infer<typeof songSchema>;

/** Un titre AzuraCast → Track ; titre et artiste séparés, à défaut le texte brut en titre. */
export function songTrack(
  song: Song,
  durationSeconds: number | null | undefined,
  startedAt: number | null,
): Track | null {
  const title = song.title?.trim() ?? '';
  const text = song.text?.trim() ?? '';
  if (!title && !text) return null;
  const seconds =
    typeof durationSeconds === 'number' && Number.isFinite(durationSeconds) && durationSeconds > 0
      ? durationSeconds
      : 0;
  return {
    title: title || text,
    artist: title ? (song.artist?.trim() ?? '') : '',
    durationMs: Math.round(seconds * 1000),
    // Sans durée (direct), pas d'heure de début : affiché sans minutage (mode dégradé).
    startedAt: seconds > 0 ? startedAt : null,
    // Aucun repère intro / outro dans l'API d'AzuraCast.
    introMs: null,
    outroMs: null,
  };
}

/**
 * Ce que le connecteur transmet : titre en cours (heure de début + retard du flux), titre à
 * venir seulement hors direct (en direct, c'est la file de l'AutoDJ, pas ce qui passera),
 * indicateur « en direct ».
 */
export function toUpdate(
  np: NowPlayingData,
  delayMs: number,
): { nowPlaying: Track | null; next: Track | null; live: boolean } {
  const live = np.live?.is_live === true;
  const online = np.is_online !== false;
  const current = online ? np.now_playing : null;
  const next = online && !live ? np.playing_next : null;
  return {
    nowPlaying: current
      ? songTrack(current.song, current.duration, current.played_at * 1000 + delayMs)
      : null,
    next: next ? songTrack(next.song, next.duration, null) : null,
    live,
  };
}

/**
 * Données « Now Playing » contenues dans un message du flux SSE (Centrifugo) : état initial à
 * la connexion (`connect`), puis une publication (`pub`) à chaque changement.
 */
export function ssePayloads(message: unknown): unknown[] {
  if (!message || typeof message !== 'object') return [];
  const m = message as Record<string, unknown>;
  const np = (row: unknown): unknown =>
    row && typeof row === 'object' ? (row as { data?: { np?: unknown } }).data?.np : undefined;
  const out: unknown[] = [];
  if (m.connect && typeof m.connect === 'object') {
    const c = m.connect as { data?: unknown; subs?: Record<string, { publications?: unknown }> };
    // Ancien format : données initiales dans connect.data.
    if (Array.isArray(c.data)) out.push(...c.data.map(np));
    for (const sub of Object.values(c.subs ?? {})) {
      if (Array.isArray(sub?.publications)) out.push(...sub.publications.map(np));
    }
  }
  if (m.pub) out.push(np(m.pub));
  return out.filter((v) => v !== undefined && v !== null);
}
