import {
  AUDIT_ACTIONS,
  AUDIT_PAGE_SIZE,
  AUDIT_RETENTION_DAYS,
  type AuditAction,
  type AuditEntry,
  type AuditPage,
  type AuditQuery,
} from '@onair-desk/shared';
import type { Db } from './database.js';

export type Actor =
  | { type: 'user'; id: number }
  | { type: 'device'; id: number }
  | { type: 'system' }
  | { type: 'anonymous' };

const DAY_MS = 24 * 60 * 60_000;

interface Row {
  id: number;
  at: string;
  category: AuditEntry['category'];
  action: string;
  actor_type: AuditEntry['actorType'];
  actor_id: number | null;
  actor_name: string | null;
  studio_id: number | null;
  details: string | null;
}

const toEntry = (r: Row): AuditEntry => {
  let details: Record<string, unknown> | null = null;
  try {
    details = r.details ? (JSON.parse(r.details) as Record<string, unknown>) : null;
  } catch {
    // Détails illisibles : l'entrée reste affichée sans eux.
  }
  return {
    id: r.id,
    at: r.at,
    category: r.category,
    action: r.action,
    actorType: r.actor_type,
    actorId: r.actor_id,
    actorName: r.actor_name,
    studioId: r.studio_id,
    details,
  };
};

/**
 * Journal des actions (qui, quoi, quand), commun à toute l'application : sécurité, contenus,
 * antenne… Ne jamais y écrire de mot de passe ni de jeton.
 */
export class AuditRepo {
  constructor(private readonly db: Db) {}

  write(
    actor: Actor,
    action: AuditAction,
    details?: Record<string, unknown>,
    studioId: number | null = null,
  ): void {
    // Nom figé au moment de l'action : lisible même si le compte est renommé ou supprimé.
    const name =
      actor.type === 'user'
        ? (this.db.prepare('SELECT display_name AS n FROM users WHERE id = ?').get(actor.id) as
            { n: string } | undefined)
        : actor.type === 'device'
          ? (this.db.prepare('SELECT name AS n FROM devices WHERE id = ?').get(actor.id) as
              { n: string } | undefined)
          : undefined;
    this.db
      .prepare(
        `INSERT INTO audit_log (actor_type, actor_id, actor_name, action, category, studio_id,
                                details)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        actor.type,
        'id' in actor ? actor.id : null,
        name?.n ?? null,
        action,
        AUDIT_ACTIONS[action],
        studioId,
        details ? JSON.stringify(details) : null,
      );
  }

  /** Entrées les plus récentes d'abord, filtrées et paginées. */
  list(query: AuditQuery): AuditPage {
    const where: string[] = [];
    const params: Record<string, unknown> = {};
    if (query.category) {
      where.push('category = @category');
      params.category = query.category;
    }
    if (query.actorId) {
      where.push("actor_type = 'user' AND actor_id = @actorId");
      params.actorId = query.actorId;
    }
    // Dates ISO : la comparaison de chaînes suit l'ordre chronologique.
    if (query.from) {
      where.push('at >= @from');
      params.from = `${query.from}T00:00:00.000Z`;
    }
    if (query.to) {
      where.push('at < @to');
      params.to = new Date(Date.parse(`${query.to}T00:00:00Z`) + DAY_MS).toISOString();
    }
    const filter = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const { total } = this.db
      .prepare(`SELECT COUNT(*) AS total FROM audit_log ${filter}`)
      .get(params) as { total: number };
    const rows = this.db
      .prepare(
        `SELECT * FROM audit_log ${filter} ORDER BY at DESC, id DESC LIMIT @limit OFFSET @offset`,
      )
      .all({
        ...params,
        limit: AUDIT_PAGE_SIZE,
        offset: (query.page - 1) * AUDIT_PAGE_SIZE,
      }) as Row[];
    return { entries: rows.map(toEntry), total, page: query.page, pageSize: AUDIT_PAGE_SIZE };
  }

  /**
   * Main courante d'une émission (vue du journal) : entrées « régie » et « antenne » du studio
   * dans la fenêtre donnée, plus les notes rattachées au conducteur, dans l'ordre chronologique
   * (une note datée après coup se place à son heure corrigée).
   */
  logbook(studioId: number, rundownId: number, from: number, to: number): AuditEntry[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM audit_log
          WHERE (category IN ('regie', 'antenne') AND studio_id = @studioId
                 AND at >= @from AND at < @to)
             OR (action = 'logbook.note' AND json_extract(details, '$.rundownId') = @rundownId)
          ORDER BY at, id
          LIMIT 2000`,
      )
      .all({
        studioId,
        rundownId,
        from: new Date(from).toISOString(),
        to: new Date(to).toISOString(),
      }) as Row[];
    const when = (e: AuditEntry) =>
      typeof e.details?.noteAt === 'number' ? e.details.noteAt : Date.parse(e.at);
    return rows.map(toEntry).sort((a, b) => when(a) - when(b) || a.id - b.id);
  }

  /** Supprime les entrées de plus d'un an ; renvoie leur nombre. */
  purge(now = Date.now()): number {
    const limit = new Date(now - AUDIT_RETENTION_DAYS * DAY_MS).toISOString();
    return this.db.prepare('DELETE FROM audit_log WHERE at < ?').run(limit).changes;
  }
}
