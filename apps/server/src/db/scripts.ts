import type {
  RevisionSummary,
  ScriptDoc,
  ScriptSummary,
  SearchHit,
  TrashItem,
} from '@onair-desk/shared';
import type { Db } from './database.js';
import { nowIso } from '../lib/time.js';

export const TRASH_RETENTION_DAYS = 30;
export const REVISIONS_KEPT = 20;
const DAY_MS = 24 * 60 * 60_000;

interface ScriptRow {
  id: number;
  owner_id: number | null;
  folder_id: number | null;
  title: string;
  content: string;
  content_text: string;
  word_count: number;
  cue_seconds: number;
  speed_wpm: number;
  version: number;
  created_by: number | null;
  updated_by: number | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  updated_by_name: string | null;
}

export interface ScriptRecord extends ScriptSummary {
  content: ScriptDoc;
  contentText: string;
  version: number;
  createdAt: string;
  updatedBy: number | null;
  deletedAt: string | null;
}

const SELECT = `SELECT s.*, u.display_name AS updated_by_name
  FROM scripts s LEFT JOIN users u ON u.id = s.updated_by`;

const toSummary = (r: ScriptRow): ScriptSummary => ({
  id: r.id,
  ownerId: r.owner_id,
  folderId: r.folder_id,
  title: r.title,
  wordCount: r.word_count,
  cueSeconds: r.cue_seconds,
  speedWpm: r.speed_wpm,
  updatedAt: r.updated_at,
  updatedByName: r.updated_by_name,
});

const toRecord = (r: ScriptRow): ScriptRecord => ({
  ...toSummary(r),
  content: JSON.parse(r.content) as ScriptDoc,
  contentText: r.content_text,
  version: r.version,
  createdAt: r.created_at,
  updatedBy: r.updated_by,
  deletedAt: r.deleted_at,
});

/** Requête FTS5 sûre : chaque mot devient un préfixe entre guillemets (tous requis). */
export function ftsQuery(input: string): string | null {
  const words = input
    .normalize('NFC')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, 8);
  return words.length > 0 ? words.map((w) => `"${w.replace(/"/g, '""')}"*`).join(' ') : null;
}

export interface ScriptContentFields {
  title: string;
  content: ScriptDoc;
  contentText: string;
  wordCount: number;
  cueSeconds: number;
}

export class ScriptRepo {
  constructor(private readonly db: Db) {}

  /** Scripts hors corbeille, sans leur contenu. */
  listSummaries(): ScriptSummary[] {
    return (
      this.db
        .prepare(`${SELECT} WHERE s.deleted_at IS NULL ORDER BY s.title COLLATE NOCASE`)
        .all() as ScriptRow[]
    ).map(toSummary);
  }

  /** Script, corbeille comprise. */
  findById(id: number): ScriptRecord | undefined {
    const r = this.db.prepare(`${SELECT} WHERE s.id = ?`).get(id) as ScriptRow | undefined;
    return r && toRecord(r);
  }

  search(input: string, limit = 50): SearchHit[] {
    const q = ftsQuery(input);
    if (!q) return [];
    const rows = this.db
      .prepare(
        `SELECT s.*, u.display_name AS updated_by_name,
                snippet(scripts_fts, 1, char(2), char(3), '…', 16) AS snippet
           FROM scripts_fts f
           JOIN scripts s ON s.id = f.rowid
           LEFT JOIN users u ON u.id = s.updated_by
          WHERE scripts_fts MATCH ? AND s.deleted_at IS NULL
          ORDER BY rank
          LIMIT ?`,
      )
      .all(q, limit) as (ScriptRow & { snippet: string })[];
    return rows.map((r) => ({ ...toSummary(r), snippet: r.snippet }));
  }

  create(
    s: ScriptContentFields & {
      ownerId: number | null;
      folderId: number | null;
      speedWpm: number;
      userId: number;
    },
  ): ScriptRecord {
    const info = this.db
      .prepare(
        `INSERT INTO scripts (owner_id, folder_id, title, content, content_text, word_count,
                              cue_seconds, speed_wpm, created_by, updated_by)
         VALUES (@ownerId, @folderId, @title, @content, @contentText, @wordCount,
                 @cueSeconds, @speedWpm, @userId, @userId)`,
      )
      .run({ ...s, content: JSON.stringify(s.content) });
    return this.findById(Number(info.lastInsertRowid))!;
  }

  /** Enregistre et incrémente la version. */
  update(
    id: number,
    userId: number,
    patch: Partial<ScriptContentFields> & { speedWpm?: number; folderId?: number | null },
  ): ScriptRecord {
    const current = this.findById(id)!;
    const next = {
      id,
      userId,
      title: patch.title ?? current.title,
      content: JSON.stringify(patch.content ?? current.content),
      contentText: patch.contentText ?? current.contentText,
      wordCount: patch.wordCount ?? current.wordCount,
      cueSeconds: patch.cueSeconds ?? current.cueSeconds,
      speedWpm: patch.speedWpm ?? current.speedWpm,
      folderId: patch.folderId !== undefined ? patch.folderId : current.folderId,
      now: nowIso(),
    };
    this.db
      .prepare(
        `UPDATE scripts SET title = @title, content = @content, content_text = @contentText,
                word_count = @wordCount, cue_seconds = @cueSeconds, speed_wpm = @speedWpm, folder_id = @folderId,
                version = version + 1, updated_by = @userId, updated_at = @now
          WHERE id = @id`,
      )
      .run(next);
    return this.findById(id)!;
  }

  // ---- Corbeille ----------------------------------------------------------------

  trash(id: number, userId: number): void {
    this.db
      .prepare(
        'UPDATE scripts SET deleted_at = ?, deleted_by = ? WHERE id = ? AND deleted_at IS NULL',
      )
      .run(nowIso(), userId, id);
  }

  restore(id: number): void {
    this.db.prepare('UPDATE scripts SET deleted_at = NULL, deleted_by = NULL WHERE id = ?').run(id);
  }

  listTrash(): TrashItem[] {
    const rows = this.db
      .prepare(
        `SELECT s.id, s.owner_id, s.title, s.word_count, s.deleted_at,
                COALESCE(o.display_name, '') AS owner_name, d.display_name AS deleted_by_name
           FROM scripts s
           LEFT JOIN users o ON o.id = s.owner_id
           LEFT JOIN users d ON d.id = s.deleted_by
          WHERE s.deleted_at IS NOT NULL
          ORDER BY s.deleted_at DESC`,
      )
      .all() as {
      id: number;
      owner_id: number | null;
      title: string;
      word_count: number;
      deleted_at: string;
      owner_name: string;
      deleted_by_name: string | null;
    }[];
    return rows.map((r) => ({
      kind: 'script' as const,
      id: r.id,
      ownerId: r.owner_id,
      ownerName: r.owner_name,
      title: r.title,
      wordCount: r.word_count,
      deletedAt: r.deleted_at,
      deletedByName: r.deleted_by_name,
      purgeAt: new Date(Date.parse(r.deleted_at) + TRASH_RETENTION_DAYS * DAY_MS).toISOString(),
    }));
  }

  /** Suppression définitive (l'historique part avec, par cascade). */
  delete(id: number): void {
    this.db.prepare('DELETE FROM scripts WHERE id = ?').run(id);
  }

  /** Supprime définitivement les scripts en corbeille depuis plus de 30 jours. */
  purgeTrash(now = Date.now()): number[] {
    const limit = new Date(now - TRASH_RETENTION_DAYS * DAY_MS).toISOString();
    const ids = (
      this.db
        .prepare('SELECT id FROM scripts WHERE deleted_at IS NOT NULL AND deleted_at < ?')
        .all(limit) as {
        id: number;
      }[]
    ).map((r) => r.id);
    const del = this.db.prepare('DELETE FROM scripts WHERE id = ?');
    this.db.transaction(() => ids.forEach((id) => del.run(id)))();
    return ids;
  }

  // ---- Historique ---------------------------------------------------------------

  lastRevisionAt(scriptId: number): string | undefined {
    const r = this.db
      .prepare('SELECT saved_at FROM script_revisions WHERE script_id = ? ORDER BY id DESC LIMIT 1')
      .get(scriptId) as { saved_at: string } | undefined;
    return r?.saved_at;
  }

  /** Conserve l'état actuel du script comme version, puis ne garde que les 20 dernières. */
  snapshot(script: ScriptRecord, savedBy: number | null): void {
    this.db
      .prepare(
        `INSERT INTO script_revisions (script_id, version, title, content, word_count, saved_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        script.id,
        script.version,
        script.title,
        JSON.stringify(script.content),
        script.wordCount,
        savedBy,
      );
    this.db
      .prepare(
        `DELETE FROM script_revisions WHERE script_id = ? AND id NOT IN (
           SELECT id FROM script_revisions WHERE script_id = ? ORDER BY id DESC LIMIT ?)`,
      )
      .run(script.id, script.id, REVISIONS_KEPT);
  }

  listRevisions(scriptId: number): RevisionSummary[] {
    const rows = this.db
      .prepare(
        `SELECT r.id, r.version, r.title, r.word_count, r.saved_at, u.display_name AS saved_by_name
           FROM script_revisions r LEFT JOIN users u ON u.id = r.saved_by
          WHERE r.script_id = ? ORDER BY r.id DESC`,
      )
      .all(scriptId) as {
      id: number;
      version: number;
      title: string;
      word_count: number;
      saved_at: string;
      saved_by_name: string | null;
    }[];
    return rows.map((r) => ({
      id: r.id,
      version: r.version,
      title: r.title,
      wordCount: r.word_count,
      savedAt: r.saved_at,
      savedByName: r.saved_by_name,
    }));
  }

  findRevision(scriptId: number, revisionId: number) {
    const r = this.db
      .prepare(
        `SELECT r.*, u.display_name AS saved_by_name
           FROM script_revisions r LEFT JOIN users u ON u.id = r.saved_by
          WHERE r.script_id = ? AND r.id = ?`,
      )
      .get(scriptId, revisionId) as
      | {
          id: number;
          version: number;
          title: string;
          content: string;
          word_count: number;
          saved_at: string;
          saved_by_name: string | null;
        }
      | undefined;
    return (
      r && {
        id: r.id,
        version: r.version,
        title: r.title,
        content: JSON.parse(r.content) as ScriptDoc,
        wordCount: r.word_count,
        savedAt: r.saved_at,
        savedByName: r.saved_by_name,
      }
    );
  }
}
