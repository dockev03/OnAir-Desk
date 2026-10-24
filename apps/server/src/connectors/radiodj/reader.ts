import { createPool, type Pool, type PoolOptions, type RowDataPacket } from 'mysql2/promise';
import type { RadiodjSettings } from '@onair-desk/shared';
import type { SongRow } from './cues.js';

/** Types de piste RadioDJ joués par-dessus un titre (habillages) : jamais « titre en cours ». */
export const OVERLAY_TYPES = [2, 3] as const; // 2 Sweeper, 3 Voiceover
/** Type de piste « musique » (choix d'un titre dans un conducteur). */
export const MUSIC_TYPE = 0;

/** Dernier titre joué, d'après `history`. */
export interface HistoryRow extends SongRow {
  /** `history.ID` : change à chaque nouveau passage, même d'un titre déjà joué. */
  id: number;
  trackId: number;
  /** `date_played`, heure locale du PC RadioDJ (« AAAA-MM-JJ HH:MM:SS »). */
  datePlayed: string;
  songType: number;
}

/** Titre de la bibliothèque (`songs`). */
export interface LibraryRow extends SongRow {
  id: number;
}

/**
 * Lecture de la base RadioDJ, en lecture seule. Interface séparée de l'implémentation MariaDB
 * pour tester le connecteur sans base.
 */
export interface RadiodjReader {
  /** Titre en cours : dernière ligne de l'historique qui n'est pas un habillage. */
  current(): Promise<HistoryRow | null>;
  /** Premier titre de la file d'attente. */
  next(): Promise<SongRow | null>;
  /** Nombre de titres de la bibliothèque (test de connexion). */
  countSongs(): Promise<number>;
  /** Recherche de titres musicaux par artiste ou titre. */
  searchSongs(query: string, limit: number): Promise<LibraryRow[]>;
  close(): Promise<void>;
}

/** Échappe les jokers de LIKE (%, _ et le caractère d'échappement). */
const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

const toSong = (r: RowDataPacket): SongRow => ({
  artist: String(r.artist ?? ''),
  title: String(r.title ?? ''),
  duration: Number(r.duration ?? 0),
  cueTimes: r.cue_times === null || r.cue_times === undefined ? null : String(r.cue_times),
});

const OVERLAYS = OVERLAY_TYPES.join(', ');

/**
 * Lecture de la base RadioDJ (MariaDB / MySQL) avec un petit lot de connexions. Uniquement
 * des SELECT ; le compte prévu par la station n'a de toute façon que ce droit.
 */
export class MysqlRadiodjReader implements RadiodjReader {
  private readonly pool: Pool;

  constructor(settings: RadiodjSettings, password: string, extra: Partial<PoolOptions> = {}) {
    this.pool = createPool({
      host: settings.host,
      port: settings.port,
      user: settings.user,
      password,
      database: settings.database,
      connectionLimit: 2,
      connectTimeout: 5_000,
      // Dates rendues telles quelles : elles sont à l'heure du PC RadioDJ (fuseau de la station).
      dateStrings: true,
      multipleStatements: false,
      charset: 'utf8mb4',
      ...extra,
    });
  }

  async current(): Promise<HistoryRow | null> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT h.ID AS id, h.trackID AS trackId, h.date_played AS datePlayed,
              h.song_type AS songType, h.duration, h.artist, h.title, s.cue_times
         FROM history h LEFT JOIN songs s ON s.ID = h.trackID
        WHERE h.song_type NOT IN (${OVERLAYS})
        ORDER BY h.ID DESC LIMIT 1`,
    );
    const r = rows[0];
    if (!r) return null;
    return {
      ...toSong(r),
      id: Number(r.id),
      trackId: Number(r.trackId),
      datePlayed: String(r.datePlayed ?? ''),
      songType: Number(r.songType),
    };
  }

  async next(): Promise<SongRow | null> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT q.duration, q.artist, q.title, s.cue_times
         FROM queuelist q LEFT JOIN songs s ON s.ID = q.songID
        WHERE s.song_type IS NULL OR s.song_type NOT IN (${OVERLAYS})
        ORDER BY q.ID LIMIT 1`,
    );
    return rows[0] ? toSong(rows[0]) : null;
  }

  async countSongs(): Promise<number> {
    const [rows] = await this.pool.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM songs');
    return Number(rows[0]?.n ?? 0);
  }

  async searchSongs(query: string, limit: number): Promise<LibraryRow[]> {
    const pattern = likePattern(query);
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT ID AS id, artist, title, duration, cue_times
         FROM songs
        WHERE song_type = ? AND (artist LIKE ? OR title LIKE ?)
        ORDER BY artist, title LIMIT ?`,
      [MUSIC_TYPE, pattern, pattern, limit],
    );
    return rows.map((r) => ({ ...toSong(r), id: Number(r.id) }));
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

/**
 * Code d'erreur stable (traduit dans l'interface) à partir d'une erreur MariaDB / réseau.
 * Le message technique, lui, est journalisé.
 */
export function radiodjErrorCode(err: unknown): string {
  const code = (err as { code?: string })?.code;
  switch (code) {
    case 'ER_ACCESS_DENIED_ERROR':
    case 'ER_DBACCESS_DENIED_ERROR':
    case 'ER_TABLEACCESS_DENIED_ERROR':
      return 'radiodj_access_denied';
    case 'ER_BAD_DB_ERROR':
      return 'radiodj_bad_database';
    case 'ER_NO_SUCH_TABLE':
    case 'ER_BAD_FIELD_ERROR':
      return 'radiodj_bad_schema';
    case 'ECONNREFUSED':
    case 'ETIMEDOUT':
    case 'ENOTFOUND':
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
    case 'EAI_AGAIN':
    case 'PROTOCOL_CONNECTION_LOST':
      return 'radiodj_unreachable';
    default:
      return 'radiodj_error';
  }
}
