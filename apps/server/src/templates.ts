import {
  templateDates,
  weekdayOf,
  type CreateFromTemplateInput,
  type CreateFromTemplateResult,
  type CreateTemplateInput,
  type Template,
  type TemplateSummary,
  type UpdateTemplateInput,
} from '@onair-desk/shared';
import type { Identity } from './auth/identity.js';
import type { Repos, TemplateRecord, User } from './db/index.js';
import { badRequest, conflict, notFound } from './lib/errors.js';
import { canWrite, type Library } from './library.js';
import { toItemInput, type Rundowns } from './rundowns.js';

/**
 * Modèles d'émission récurrente. Mêmes droits que les conducteurs : tout le monde lit, un
 * animateur modifie les siens et ceux de Commun, l'admin modifie tout. Les conducteurs ne
 * sont créés qu'à la demande de l'animateur, jamais automatiquement.
 */
export class Templates {
  constructor(
    private readonly repos: Repos,
    private readonly library: Library,
    private readonly rundowns: Rundowns,
  ) {}

  list(): TemplateSummary[] {
    return this.repos.templates.listSummaries();
  }

  /** Modèle hors corbeille, ou 404. */
  getLive(id: number): TemplateRecord {
    const t = this.repos.templates.findById(id);
    if (!t || t.deletedAt) throw notFound();
    return t;
  }

  toTemplate(record: TemplateRecord, identity: Identity): Template {
    const { deletedAt: _d, ...rest } = record;
    return {
      ...rest,
      canWrite: identity.kind === 'user' && canWrite(identity.user, record.ownerId),
    };
  }

  create(user: User, input: CreateTemplateInput): TemplateRecord {
    this.library.assertWrite(user, input.ownerId);
    this.rundowns.checkItems(input.items);
    const { items, ...header } = input;
    return this.repos.templates.create({ ...header, userId: user.id }, items);
  }

  save(user: User, id: number, input: UpdateTemplateInput): TemplateRecord {
    return this.repos.db.transaction(() => {
      const current = this.getLive(id);
      this.library.assertWrite(user, current.ownerId);
      if (input.version !== current.version) throw conflict('version_conflict');
      if (input.items) this.rundowns.checkItems(input.items, current);
      const { version: _v, ...patch } = input;
      const validFrom = patch.validFrom !== undefined ? patch.validFrom : current.validFrom;
      const validUntil = patch.validUntil !== undefined ? patch.validUntil : current.validUntil;
      if (validFrom && validUntil && validFrom > validUntil) throw badRequest('valid_period');
      return this.repos.templates.update(id, user.id, patch);
    })();
  }

  duplicate(
    user: User,
    id: number,
    input: { ownerId: number | null; title?: string | undefined },
  ): TemplateRecord {
    const source = this.getLive(id);
    this.library.assertWrite(user, input.ownerId);
    return this.repos.templates.create(
      {
        ownerId: input.ownerId,
        title: input.title ?? source.title,
        startTime: source.startTime,
        days: source.days,
        validFrom: source.validFrom,
        validUntil: source.validUntil,
        active: source.active,
        exclusions: source.exclusions,
        notes: source.notes,
        userId: user.id,
      },
      source.items.map(toItemInput),
    );
  }

  /** « Enregistrer comme modèle » : copie de l'heure de début et des éléments d'un conducteur. */
  fromRundown(
    user: User,
    rundownId: number,
    input: { ownerId: number | null; title?: string | undefined; days?: number[] | undefined },
  ): TemplateRecord {
    const source = this.rundowns.getLive(rundownId);
    this.library.assertWrite(user, input.ownerId);
    return this.repos.templates.create(
      {
        ownerId: input.ownerId,
        title: input.title ?? source.title,
        startTime: source.startTime,
        days: input.days ?? [weekdayOf(source.airDate)],
        validFrom: null,
        validUntil: null,
        active: true,
        exclusions: [],
        notes: source.notes,
        userId: user.id,
      },
      source.items.map(toItemInput),
    );
  }

  /**
   * « Créer les conducteurs » sur une période : un conducteur par jour de diffusion, hors
   * exclusions et hors période de validité. Une date déjà créée depuis ce modèle ne l'est
   * jamais une seconde fois, même si son conducteur a été déplacé ou mis à la corbeille.
   */
  createRundowns(
    user: User,
    id: number,
    period: CreateFromTemplateInput,
  ): CreateFromTemplateResult {
    return this.repos.db.transaction(() => {
      const template = this.getLive(id);
      this.library.assertWrite(user, template.ownerId);
      if (!template.active) throw conflict('template_suspended');
      const { dates, skipped } = templateDates(template, period.from, period.to);
      const done = this.repos.rundowns.templateDates(id);
      const items = template.items.map(toItemInput);
      const result: CreateFromTemplateResult = { created: [], existing: [], skipped };
      for (const date of dates) {
        if (done.has(date)) {
          result.existing.push(date);
          continue;
        }
        const rundown = this.repos.rundowns.create(
          {
            ownerId: template.ownerId,
            title: template.title,
            airDate: date,
            startTime: template.startTime,
            notes: template.notes,
            userId: user.id,
          },
          items,
          { templateId: id, templateDate: date },
        );
        result.created.push({ date, rundownId: rundown.id });
      }
      return result;
    })();
  }

  trash(user: User, id: number): void {
    const current = this.getLive(id);
    this.library.assertWrite(user, current.ownerId);
    // Les conducteurs déjà créés depuis ce modèle restent.
    this.repos.templates.trash(id, user.id);
  }

  restore(user: User, id: number): TemplateRecord {
    const t = this.repos.templates.findById(id);
    if (!t?.deletedAt) throw notFound();
    this.library.assertWrite(user, t.ownerId);
    this.repos.templates.restore(id);
    return this.repos.templates.findById(id)!;
  }

  deleteForever(user: User, id: number): void {
    const t = this.repos.templates.findById(id);
    if (!t?.deletedAt) throw notFound();
    this.library.assertWrite(user, t.ownerId);
    this.repos.templates.delete(id);
  }
}
