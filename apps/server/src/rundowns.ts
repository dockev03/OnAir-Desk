import type {
  CreateRundownInput,
  Rundown,
  RundownItem,
  RundownItemInput,
  RundownList,
  UpdateRundownInput,
} from '@onair-desk/shared';
import type { Identity } from './auth/identity.js';
import type { Repos, RundownRecord, User } from './db/index.js';
import { badRequest, conflict, notFound } from './lib/errors.js';
import { canWrite, type Library } from './library.js';

/** Élément tel qu'enregistré (sans les infos du script attaché). */
export const toItemInput = ({ script: _s, ...item }: RundownItem): RundownItemInput => item;

/** Date du jour (AAAA-MM-JJ) dans le fuseau de la station. */
export function todayIn(timezone: string, now = new Date()): string {
  // en-CA formate les dates en AAAA-MM-JJ.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * Conducteurs. Mêmes droits que les scripts : tout le monde lit, un animateur modifie les
 * siens et ceux de Commun, l'admin modifie tout.
 */
export class Rundowns {
  constructor(
    private readonly repos: Repos,
    private readonly library: Library,
  ) {}

  list(): RundownList {
    return {
      today: todayIn(this.repos.settings.get().timezone),
      rundowns: this.repos.rundowns.listSummaries(),
    };
  }

  /** Conducteur hors corbeille, ou 404. */
  getLive(id: number): RundownRecord {
    const r = this.repos.rundowns.findById(id);
    if (!r || r.deletedAt) throw notFound();
    return r;
  }

  toRundown(record: RundownRecord, identity: Identity): Rundown {
    const { updatedBy: _u, deletedAt: _d, ...rest } = record;
    const template =
      record.templateId === null ? undefined : this.repos.templates.findById(record.templateId);
    return {
      ...rest,
      canWrite: identity.kind === 'user' && canWrite(identity.user, record.ownerId),
      template: template
        ? { id: template.id, title: template.title, deleted: template.deletedAt !== null }
        : null,
    };
  }

  /**
   * Types connus des paramètres, scripts existants et hors corbeille. Ce qui était déjà dans
   * le conducteur reste accepté (type retiré des paramètres, script mis à la corbeille depuis) :
   * un conducteur ancien doit toujours pouvoir être enregistré.
   */
  checkItems(items: RundownItemInput[], current?: { items: RundownItemInput[] }): void {
    const types = new Set(this.repos.settings.get().itemTypes.map((t) => t.id));
    const keptTypes = new Set(current?.items.map((i) => i.typeId));
    const keptScripts = new Set(current?.items.map((i) => i.scriptId));
    for (const item of items) {
      if (!types.has(item.typeId) && !keptTypes.has(item.typeId)) {
        throw badRequest('unknown_item_type');
      }
      if (item.scriptId !== null && !keptScripts.has(item.scriptId)) {
        const script = this.repos.scripts.findById(item.scriptId);
        if (!script || script.deletedAt) throw badRequest('unknown_script');
      }
    }
  }

  create(user: User, input: CreateRundownInput): RundownRecord {
    this.library.assertWrite(user, input.ownerId);
    const items = input.items ?? [];
    this.checkItems(items);
    return this.repos.rundowns.create(
      {
        ownerId: input.ownerId,
        title: input.title,
        airDate: input.airDate,
        startTime: input.startTime,
        layout: input.layout ?? null,
        userId: user.id,
      },
      items,
    );
  }

  save(user: User, id: number, input: UpdateRundownInput): RundownRecord {
    const updated = this.repos.db.transaction(() => {
      const current = this.getLive(id);
      this.library.assertWrite(user, current.ownerId);
      if (input.version !== current.version) throw conflict('version_conflict');
      if (input.items) this.checkItems(input.items, current);
      const { version: _v, ...patch } = input;
      return this.repos.rundowns.update(id, user.id, patch);
    })();
    this.library.rundownRefresh(id);
    return updated;
  }

  /** Copie à une autre date (émission récurrente), avec les mêmes scripts attachés. */
  duplicate(
    user: User,
    id: number,
    input: { ownerId: number | null; airDate: string; title?: string | undefined },
  ): RundownRecord {
    const source = this.getLive(id);
    this.library.assertWrite(user, input.ownerId);
    return this.repos.rundowns.create(
      {
        ownerId: input.ownerId,
        title: input.title ?? source.title,
        airDate: input.airDate,
        startTime: source.startTime,
        layout: source.layout,
        userId: user.id,
      },
      source.items.map(toItemInput),
    );
  }

  /**
   * « Réappliquer le modèle » : le conducteur reprend le titre, l'heure de début, la
   * disposition et les éléments de son modèle d'origine ; sa date ne change pas.
   */
  reapplyTemplate(user: User, id: number, version: number): RundownRecord {
    const updated = this.repos.db.transaction(() => {
      const current = this.getLive(id);
      this.library.assertWrite(user, current.ownerId);
      if (version !== current.version) throw conflict('version_conflict');
      const template =
        current.templateId === null ? undefined : this.repos.templates.findById(current.templateId);
      if (!template || template.deletedAt) throw badRequest('no_template');
      return this.repos.rundowns.update(id, user.id, {
        title: template.title,
        startTime: template.startTime,
        layout: template.layout,
        items: template.items.map(toItemInput),
      });
    })();
    this.library.rundownRefresh(id);
    return updated;
  }

  trash(user: User, id: number): void {
    const current = this.getLive(id);
    this.library.assertWrite(user, current.ownerId);
    // Conducteur suivi sur l'écran studio : sa copie reste affichée (jamais d'écran blanc).
    this.repos.rundowns.trash(id, user.id);
  }

  restore(user: User, id: number): RundownRecord {
    const r = this.repos.rundowns.findById(id);
    if (!r?.deletedAt) throw notFound();
    this.library.assertWrite(user, r.ownerId);
    this.repos.rundowns.restore(id);
    return this.repos.rundowns.findById(id)!;
  }

  deleteForever(user: User, id: number): void {
    const r = this.repos.rundowns.findById(id);
    if (!r?.deletedAt) throw notFound();
    this.library.assertWrite(user, r.ownerId);
    this.repos.rundowns.delete(id);
  }
}
