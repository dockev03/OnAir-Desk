import {
  addDays,
  endAfterStart,
  canDirect,
  diffRundownItems,
  showInProgress,
  type LiveChange,
  type CreateRundownInput,
  type Rundown,
  type RundownItem,
  type RundownItemInput,
  type RundownList,
  type UpdateRundownInput,
} from '@onair-desk/shared';
import type { AirStateStore } from './air/state.js';
import type { Identity } from './auth/identity.js';
import { DEFAULT_STUDIO_ID, type Repos, type RundownRecord, type User } from './db/index.js';
import { badRequest, conflict, forbidden, notFound } from './lib/errors.js';
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
    private readonly air: AirStateStore,
    private readonly now: () => number = Date.now,
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
    const user = identity.kind === 'user' ? identity.user : null;
    return {
      ...rest,
      canWrite: !!user && canWrite(user, record.ownerId),
      liveEdit: !!user && !canWrite(user, record.ownerId) && this.liveEditable(user, record.id),
      template: template
        ? { id: template.id, title: template.title, deleted: template.deletedAt !== null }
        : null,
    };
  }

  /**
   * Types et étiquettes connus des paramètres, scripts existants et hors corbeille. Ce qui
   * était déjà dans le conducteur reste accepté (type ou étiquette retiré des paramètres,
   * script mis à la corbeille depuis) : un conducteur ancien doit toujours pouvoir être
   * enregistré.
   */
  checkItems(items: RundownItemInput[], current?: { items: RundownItemInput[] }): void {
    const settings = this.repos.settings.get();
    const types = new Set(settings.itemTypes.map((t) => t.id));
    const tags = new Set(settings.itemTags.map((t) => t.id));
    const keptTypes = new Set(current?.items.map((i) => i.typeId));
    const keptTags = new Set(current?.items.flatMap((i) => i.tags));
    const keptScripts = new Set(current?.items.map((i) => i.scriptId));
    for (const item of items) {
      if (!types.has(item.typeId) && !keptTypes.has(item.typeId)) {
        throw badRequest('unknown_item_type');
      }
      if (item.tags.some((tag) => !tags.has(tag) && !keptTags.has(tag))) {
        throw badRequest('unknown_item_tag');
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
        endTime: input.endTime,
        notes: input.notes,
        layout: input.layout ?? null,
        userId: user.id,
      },
      items,
    );
  }

  /**
   * Conducteur modifié en direct (voir docs/plan-etape-10.md, décision 14) : un réalisateur
   * peut modifier les éléments du conducteur suivi sur un écran studio, quel qu'en soit le
   * propriétaire.
   */
  liveEditable(user: User, id: number): boolean {
    return canDirect(user) && this.onAirStudios(id).length > 0;
  }

  /**
   * Studios où ce conducteur est « à l'antenne » : suivi sur l'écran studio, ou émission en
   * cours d'après ses heures (l'animateur peut être revenu à la liste des éléments).
   */
  onAirStudios(id: number): number[] {
    const following = this.library.studiosFollowing(id);
    if (following.length > 0) return following;
    const tz = this.repos.settings.get().timezone;
    const today = todayIn(tz, new Date(this.now()));
    const nearby = this.repos.rundowns
      .listSummaries()
      .filter((r) => r.airDate >= addDays(today, -1) && r.airDate <= today);
    return showInProgress(nearby, this.now(), tz)?.id === id ? [DEFAULT_STUDIO_ID] : [];
  }

  save(user: User, id: number, input: UpdateRundownInput): RundownRecord {
    let before: RundownRecord | undefined;
    const updated = this.repos.db.transaction(() => {
      const current = this.getLive(id);
      before = current;
      if (!canWrite(user, current.ownerId)) {
        if (!this.liveEditable(user, id)) this.library.assertWrite(user, current.ownerId);
        // En direct, le réalisateur ne touche qu'aux éléments (ni titre, ni date, ni heure…).
        if (Object.keys(input).some((k) => k !== 'version' && k !== 'items')) {
          throw forbidden('live_edit_items_only');
        }
      }
      if (input.version !== current.version) throw conflict('version_conflict');
      if (input.items) this.checkItems(input.items, current);
      const startTime = input.startTime ?? current.startTime;
      const endTime = input.endTime !== undefined ? input.endTime : current.endTime;
      if (!endAfterStart(startTime, endTime)) throw badRequest('end_before_start');
      const { version: _v, ...patch } = input;
      return this.repos.rundowns.update(id, user.id, patch);
    })();
    this.library.rundownRefresh(id);
    const change = this.signalLiveChange(user, before!, updated);
    // Modification d'un conducteur à l'antenne par la régie : tracée (décision 17).
    if (change && canDirect(user) && user.id !== updated.ownerId) {
      const titles = (uids: string[]) =>
        uids.map((uid) => updated.items.find((i) => i.uid === uid)?.title ?? uid);
      this.repos.audit.write(
        { type: 'user', id: user.id },
        'rundown.live_edited',
        {
          rundownId: id,
          title: updated.title,
          added: titles(change.added),
          changed: titles(change.changed),
          moved: titles(change.moved),
          removed: change.removed,
        },
        this.onAirStudios(id)[0] ?? null,
      );
    }
    return updated;
  }

  /**
   * Conducteur à l'antenne modifié (par la régie ou son propriétaire) : les éléments ajoutés,
   * modifiés ou déplacés sont soulignés quelques secondes sur l'écran studio (décision 16).
   */
  private signalLiveChange(
    user: User,
    before: RundownRecord,
    after: RundownRecord,
  ): LiveChange | null {
    const studios = this.onAirStudios(after.id);
    if (studios.length === 0) return null;
    const diff = diffRundownItems(before.items, after.items);
    if (!diff) return null;
    const change: LiveChange = {
      rundownId: after.id,
      at: this.now(),
      byName: user.displayName,
      ...diff,
    };
    for (const studioId of studios) this.air.update(studioId, { liveChange: change });
    return change;
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
        endTime: source.endTime,
        notes: source.notes,
        layout: source.layout,
        userId: user.id,
      },
      source.items.map(toItemInput),
    );
  }

  /**
   * « Réappliquer le modèle » : le conducteur reprend le titre, l'heure de début, les notes,
   * la disposition et les éléments de son modèle d'origine ; sa date ne change pas.
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
        endTime: template.endTime,
        notes: template.notes,
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
