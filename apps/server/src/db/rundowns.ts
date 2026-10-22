import {
  rundownSchedule,
  type RundownItem,
  type RundownItemInput,
  type RundownSummary,
  type TrashItem,
} from '@onair-desk/shared';
import type { Db } from './database.js';
import { TRASH_RETENTION_DAYS } from './scripts.js';
import { nowIso } from '../lib/time.js';

const DAY_MS = 24 * 60 * 60_000;

interface RundownRow {
  id: number;
  owner_id: number | null;
  title: string;
  air_date: string;
  start_time: string;
  version: number;
  updated_by: number | null;
  updated_at: string;
  deleted_at: string | null;
  updated_by_name: string | null;
}

interface ItemRow {
  rundown_id: number;
  uid: string;
  type_id: string;
  title: string;
  duration_seconds: number | null;
  notes: string;
  script_id: number | null;
  script_title: string | null;
  word_count: number | null;
  speed_wpm: number | null;
  cue_seconds: number | null;
  script_deleted_at: string | null;
}

export interface RundownRecord extends RundownSummary {
  items: RundownItem[];
  version: number;
  updatedBy: number | null;
  deletedAt: string | null;
}

export interface RundownHeader {
  title: string;
  airDate: string;
  startTime: string;
}

const SELECT = `SELECT r.*, u.display_name AS updated_by_name
  FROM rundowns r LEFT JOIN users u ON u.id = r.updated_by`;

const SELECT_ITEMS = `SELECT i.*, s.title AS script_title, s.word_count, s.speed_wpm,
       s.cue_seconds, s.deleted_at AS script_deleted_at
  FROM rundown_items i LEFT JOIN scripts s ON s.id = i.script_id`;

const toItem = (r: ItemRow): RundownItem => ({
  uid: r.uid,
  typeId: r.type_id,
  title: r.title,
  durationSeconds: r.duration_seconds,
  notes: r.notes,
  scriptId: r.script_id,
  script:
    r.script_id !== null && r.script_title !== null
      ? {
          title: r.script_title,
          wordCount: r.word_count!,
          speedWpm: r.speed_wpm!,
          cueSeconds: r.cue_seconds!,
          deleted: r.script_deleted_at !== null,
        }
      : null,
});

function toRecord(r: RundownRow, items: RundownItem[]): RundownRecord {
  return {
    id: r.id,
    ownerId: r.owner_id,
    title: r.title,
    airDate: r.air_date,
    startTime: r.start_time,
    itemCount: items.length,
    totalSeconds: rundownSchedule(r.start_time, items).total,
    updatedAt: r.updated_at,
    updatedByName: r.updated_by_name,
    items,
    version: r.version,
    updatedBy: r.updated_by,
    deletedAt: r.deleted_at,
  };
}

const toSummary = ({ items: _i, version: _v, updatedBy: _u, deletedAt: _d, ...s }: RundownRecord) =>
  s;

/** Conducteurs et leurs éléments. */
export class RundownRepo {
  constructor(private readonly db: Db) {}

  private itemsOf(rundownIds: number[]): Map<number, RundownItem[]> {
    const map = new Map<number, RundownItem[]>(rundownIds.map((id) => [id, []]));
    if (rundownIds.length === 0) return map;
    const rows = this.db
      .prepare(
        `${SELECT_ITEMS} WHERE i.rundown_id IN (SELECT value FROM json_each(?))
          ORDER BY i.rundown_id, i.position`,
      )
      .all(JSON.stringify(rundownIds)) as ItemRow[];
    for (const r of rows) map.get(r.rundown_id)?.push(toItem(r));
    return map;
  }

  /** Conducteurs hors corbeille, par date puis heure de début. */
  listSummaries(): RundownSummary[] {
    const rows = this.db
      .prepare(`${SELECT} WHERE r.deleted_at IS NULL ORDER BY r.air_date, r.start_time`)
      .all() as RundownRow[];
    const items = this.itemsOf(rows.map((r) => r.id));
    return rows.map((r) => toSummary(toRecord(r, items.get(r.id)!)));
  }

  /** Conducteur, corbeille comprise. */
  findById(id: number): RundownRecord | undefined {
    const r = this.db.prepare(`${SELECT} WHERE r.id = ?`).get(id) as RundownRow | undefined;
    return r && toRecord(r, this.itemsOf([id]).get(id)!);
  }

  /** Conducteurs (hors corbeille) qui contiennent ce script. */
  idsUsingScript(scriptId: number): number[] {
    return (
      this.db
        .prepare(
          `SELECT DISTINCT i.rundown_id AS id FROM rundown_items i
             JOIN rundowns r ON r.id = i.rundown_id
            WHERE i.script_id = ? AND r.deleted_at IS NULL`,
        )
        .all(scriptId) as { id: number }[]
    ).map((r) => r.id);
  }

  create(
    header: RundownHeader & { ownerId: number | null; userId: number },
    items: RundownItemInput[],
  ): RundownRecord {
    return this.db.transaction(() => {
      const info = this.db
        .prepare(
          `INSERT INTO rundowns (owner_id, title, air_date, start_time, created_by, updated_by)
           VALUES (@ownerId, @title, @airDate, @startTime, @userId, @userId)`,
        )
        .run(header);
      const id = Number(info.lastInsertRowid);
      this.writeItems(id, items);
      return this.findById(id)!;
    })();
  }

  /** Enregistre l'en-tête et/ou la liste complète des éléments, et incrémente la version. */
  update(
    id: number,
    userId: number,
    patch: Partial<RundownHeader> & { items?: RundownItemInput[] },
  ): RundownRecord {
    return this.db.transaction(() => {
      const current = this.findById(id)!;
      this.db
        .prepare(
          `UPDATE rundowns SET title = @title, air_date = @airDate, start_time = @startTime,
                  version = version + 1, updated_by = @userId, updated_at = @now
            WHERE id = @id`,
        )
        .run({
          id,
          userId,
          title: patch.title ?? current.title,
          airDate: patch.airDate ?? current.airDate,
          startTime: patch.startTime ?? current.startTime,
          now: nowIso(),
        });
      if (patch.items) this.writeItems(id, patch.items);
      return this.findById(id)!;
    })();
  }

  private writeItems(rundownId: number, items: RundownItemInput[]): void {
    this.db.prepare('DELETE FROM rundown_items WHERE rundown_id = ?').run(rundownId);
    const insert = this.db.prepare(
      `INSERT INTO rundown_items (rundown_id, uid, position, type_id, title, duration_seconds,
                                  notes, script_id)
       VALUES (@rundownId, @uid, @position, @typeId, @title, @durationSeconds, @notes, @scriptId)`,
    );
    items.forEach((item, position) => insert.run({ ...item, rundownId, position }));
  }

  // ---- Corbeille ----------------------------------------------------------------

  trash(id: number, userId: number): void {
    this.db
      .prepare(
        'UPDATE rundowns SET deleted_at = ?, deleted_by = ? WHERE id = ? AND deleted_at IS NULL',
      )
      .run(nowIso(), userId, id);
  }

  restore(id: number): void {
    this.db
      .prepare('UPDATE rundowns SET deleted_at = NULL, deleted_by = NULL WHERE id = ?')
      .run(id);
  }

  listTrash(): TrashItem[] {
    const rows = this.db
      .prepare(
        `SELECT r.id, r.owner_id, r.title, r.deleted_at,
                (SELECT COUNT(*) FROM rundown_items i WHERE i.rundown_id = r.id) AS item_count,
                COALESCE(o.display_name, '') AS owner_name, d.display_name AS deleted_by_name
           FROM rundowns r
           LEFT JOIN users o ON o.id = r.owner_id
           LEFT JOIN users d ON d.id = r.deleted_by
          WHERE r.deleted_at IS NOT NULL
          ORDER BY r.deleted_at DESC`,
      )
      .all() as {
      id: number;
      owner_id: number | null;
      title: string;
      item_count: number;
      deleted_at: string;
      owner_name: string;
      deleted_by_name: string | null;
    }[];
    return rows.map((r) => ({
      kind: 'rundown' as const,
      id: r.id,
      ownerId: r.owner_id,
      ownerName: r.owner_name,
      title: r.title,
      itemCount: r.item_count,
      deletedAt: r.deleted_at,
      deletedByName: r.deleted_by_name,
      purgeAt: new Date(Date.parse(r.deleted_at) + TRASH_RETENTION_DAYS * DAY_MS).toISOString(),
    }));
  }

  /** Suppression définitive (les éléments partent avec, par cascade). */
  delete(id: number): void {
    this.db.prepare('DELETE FROM rundowns WHERE id = ?').run(id);
  }

  /** Supprime définitivement les conducteurs en corbeille depuis plus de 30 jours. */
  purgeTrash(now = Date.now()): number[] {
    const limit = new Date(now - TRASH_RETENTION_DAYS * DAY_MS).toISOString();
    const ids = (
      this.db
        .prepare('SELECT id FROM rundowns WHERE deleted_at IS NOT NULL AND deleted_at < ?')
        .all(limit) as { id: number }[]
    ).map((r) => r.id);
    const del = this.db.prepare('DELETE FROM rundowns WHERE id = ?');
    this.db.transaction(() => ids.forEach((id) => del.run(id)))();
    return ids;
  }
}
