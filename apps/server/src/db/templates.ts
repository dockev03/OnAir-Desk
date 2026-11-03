import {
  daysToMask,
  maskToDays,
  rundownSchedule,
  type Layout,
  type RundownItem,
  type RundownItemInput,
  type TemplateExclusion,
  type TemplateSummary,
  type TrashItem,
} from '@onair-desk/shared';
import type { Db } from './database.js';
import { readItems, writeItems } from './rundowns.js';
import { TRASH_RETENTION_DAYS } from './scripts.js';
import { nowIso } from '../lib/time.js';

const DAY_MS = 24 * 60 * 60_000;

interface TemplateRow {
  id: number;
  owner_id: number | null;
  title: string;
  start_time: string;
  end_time: string | null;
  days: number;
  valid_from: string | null;
  valid_until: string | null;
  active: number;
  notes: string;
  layout: Layout | null;
  version: number;
  updated_by: number | null;
  updated_at: string;
  deleted_at: string | null;
  updated_by_name: string | null;
}

export interface TemplateRecord extends TemplateSummary {
  exclusions: TemplateExclusion[];
  notes: string;
  items: RundownItem[];
  version: number;
  deletedAt: string | null;
}

/** En-tête d'un modèle (tout sauf les éléments). */
export interface TemplateHeader {
  title: string;
  startTime: string;
  /** Heure de fin imposée, copiée dans les conducteurs créés ; null : aucune. */
  endTime: string | null;
  days: number[];
  validFrom: string | null;
  validUntil: string | null;
  active: boolean;
  exclusions: TemplateExclusion[];
  notes: string;
  /** Disposition de l'écran studio ; null : celle des paramètres. */
  layout: Layout | null;
}

const SELECT = `SELECT t.*, u.display_name AS updated_by_name
  FROM rundown_templates t LEFT JOIN users u ON u.id = t.updated_by`;

/** Modèles d'émission récurrente, leurs éléments et leurs exclusions. */
export class TemplateRepo {
  constructor(private readonly db: Db) {}

  private exclusionsOf(id: number): TemplateExclusion[] {
    return this.db
      .prepare(
        `SELECT start_date AS "from", end_date AS "to", label
           FROM rundown_template_exclusions WHERE template_id = ? ORDER BY start_date, id`,
      )
      .all(id) as TemplateExclusion[];
  }

  private toRecord(r: TemplateRow, items: RundownItem[], exclusions: TemplateExclusion[]) {
    return {
      id: r.id,
      ownerId: r.owner_id,
      title: r.title,
      startTime: r.start_time,
      endTime: r.end_time,
      days: maskToDays(r.days),
      validFrom: r.valid_from,
      validUntil: r.valid_until,
      active: r.active === 1,
      layout: r.layout,
      itemCount: items.length,
      totalSeconds: rundownSchedule(r.start_time, items).total,
      updatedAt: r.updated_at,
      updatedByName: r.updated_by_name,
      exclusions,
      notes: r.notes,
      items,
      version: r.version,
      deletedAt: r.deleted_at,
    } satisfies TemplateRecord;
  }

  /** Modèles hors corbeille, par titre. */
  listSummaries(): TemplateSummary[] {
    const rows = this.db
      .prepare(`${SELECT} WHERE t.deleted_at IS NULL ORDER BY t.title COLLATE NOCASE, t.id`)
      .all() as TemplateRow[];
    const items = readItems(
      this.db,
      'rundown_template_items',
      'template_id',
      rows.map((r) => r.id),
    );
    return rows.map((r) => {
      const {
        exclusions: _e,
        notes: _n,
        items: _i,
        version: _v,
        deletedAt: _d,
        ...summary
      } = this.toRecord(r, items.get(r.id)!, []);
      return summary;
    });
  }

  /** Modèle, corbeille comprise. */
  findById(id: number): TemplateRecord | undefined {
    const r = this.db.prepare(`${SELECT} WHERE t.id = ?`).get(id) as TemplateRow | undefined;
    if (!r) return undefined;
    const items = readItems(this.db, 'rundown_template_items', 'template_id', [id]).get(id)!;
    return this.toRecord(r, items, this.exclusionsOf(id));
  }

  create(
    header: TemplateHeader & { ownerId: number | null; userId: number },
    items: RundownItemInput[],
  ): TemplateRecord {
    return this.db.transaction(() => {
      const info = this.db
        .prepare(
          `INSERT INTO rundown_templates (owner_id, title, start_time, end_time, days,
                                          valid_from, valid_until, active, notes, layout,
                                          created_by, updated_by)
           VALUES (@ownerId, @title, @startTime, @endTime, @days, @validFrom, @validUntil,
                   @active, @notes, @layout, @userId, @userId)`,
        )
        .run({
          ownerId: header.ownerId,
          title: header.title,
          startTime: header.startTime,
          endTime: header.endTime,
          days: daysToMask(header.days),
          validFrom: header.validFrom,
          validUntil: header.validUntil,
          active: header.active ? 1 : 0,
          notes: header.notes,
          layout: header.layout,
          userId: header.userId,
        });
      const id = Number(info.lastInsertRowid);
      this.writeExclusions(id, header.exclusions);
      writeItems(this.db, 'rundown_template_items', 'template_id', id, items);
      return this.findById(id)!;
    })();
  }

  /** Enregistre l'en-tête et/ou la liste complète des éléments, et incrémente la version. */
  update(
    id: number,
    userId: number,
    patch: Partial<TemplateHeader> & { items?: RundownItemInput[] | undefined },
  ): TemplateRecord {
    return this.db.transaction(() => {
      const current = this.findById(id)!;
      const next = { ...current, ...stripUndefined(patch) };
      this.db
        .prepare(
          `UPDATE rundown_templates
              SET title = @title, start_time = @startTime, end_time = @endTime, days = @days,
                  valid_from = @validFrom, valid_until = @validUntil, active = @active,
                  notes = @notes, layout = @layout, version = version + 1, updated_by = @userId,
                  updated_at = @now
            WHERE id = @id`,
        )
        .run({
          id,
          userId,
          title: next.title,
          startTime: next.startTime,
          endTime: next.endTime,
          days: daysToMask(next.days),
          validFrom: next.validFrom,
          validUntil: next.validUntil,
          active: next.active ? 1 : 0,
          notes: next.notes,
          layout: next.layout,
          now: nowIso(),
        });
      if (patch.exclusions) this.writeExclusions(id, patch.exclusions);
      if (patch.items)
        writeItems(this.db, 'rundown_template_items', 'template_id', id, patch.items);
      return this.findById(id)!;
    })();
  }

  private writeExclusions(id: number, exclusions: TemplateExclusion[]): void {
    this.db.prepare('DELETE FROM rundown_template_exclusions WHERE template_id = ?').run(id);
    const insert = this.db.prepare(
      `INSERT INTO rundown_template_exclusions (template_id, start_date, end_date, label)
       VALUES (?, ?, ?, ?)`,
    );
    for (const e of exclusions) insert.run(id, e.from, e.to, e.label);
  }

  // ---- Corbeille ----------------------------------------------------------------

  trash(id: number, userId: number): void {
    this.db
      .prepare(
        `UPDATE rundown_templates SET deleted_at = ?, deleted_by = ?
          WHERE id = ? AND deleted_at IS NULL`,
      )
      .run(nowIso(), userId, id);
  }

  restore(id: number): void {
    this.db
      .prepare('UPDATE rundown_templates SET deleted_at = NULL, deleted_by = NULL WHERE id = ?')
      .run(id);
  }

  listTrash(): TrashItem[] {
    const rows = this.db
      .prepare(
        `SELECT t.id, t.owner_id, t.title, t.deleted_at,
                (SELECT COUNT(*) FROM rundown_template_items i WHERE i.template_id = t.id)
                  AS item_count,
                COALESCE(o.display_name, '') AS owner_name, d.display_name AS deleted_by_name
           FROM rundown_templates t
           LEFT JOIN users o ON o.id = t.owner_id
           LEFT JOIN users d ON d.id = t.deleted_by
          WHERE t.deleted_at IS NOT NULL
          ORDER BY t.deleted_at DESC`,
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
      kind: 'template' as const,
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

  /**
   * Suppression définitive : éléments et exclusions partent avec (cascade) ; les conducteurs
   * créés depuis ce modèle restent, sans lien.
   */
  delete(id: number): void {
    this.db.prepare('DELETE FROM rundown_templates WHERE id = ?').run(id);
  }

  /** Supprime définitivement les modèles en corbeille depuis plus de 30 jours. */
  purgeTrash(now = Date.now()): number[] {
    const limit = new Date(now - TRASH_RETENTION_DAYS * DAY_MS).toISOString();
    const ids = (
      this.db
        .prepare('SELECT id FROM rundown_templates WHERE deleted_at IS NOT NULL AND deleted_at < ?')
        .all(limit) as { id: number }[]
    ).map((r) => r.id);
    const del = this.db.prepare('DELETE FROM rundown_templates WHERE id = ?');
    this.db.transaction(() => ids.forEach((id) => del.run(id)))();
    return ids;
  }
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
