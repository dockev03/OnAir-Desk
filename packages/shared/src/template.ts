import { z } from 'zod';
import { layoutSchema } from './layout.js';
import { airDateSchema, rundownItemsSchema, startTimeSchema } from './rundown.js';
import { addDays } from './time.js';

/**
 * Modèles d'émission récurrente : jours de diffusion, période de validité, exclusions, et
 * calcul des dates pour lesquelles créer les conducteurs. Utilisé par le serveur et l'interface.
 */

/** Jours de la semaine, numérotés comme ISO 8601 : 1 = lundi … 7 = dimanche. */
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const MAX_TEMPLATE_EXCLUSIONS = 100;
/** Période maximale d'une création de conducteurs : environ 3 mois. */
export const MAX_CREATE_DAYS = 92;

const DAY_MS = 24 * 60 * 60_000;

/** Nombre de jours entre deux dates AAAA-MM-JJ (to - from). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** Jour de la semaine d'une date AAAA-MM-JJ (1 = lundi … 7 = dimanche). */
export function weekdayOf(date: string): Weekday {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return (day === 0 ? 7 : day) as Weekday;
}

/** Jours cochés ↔ masque stocké en base (bit 0 = lundi). */
export const daysToMask = (days: readonly number[]): number =>
  days.reduce((mask, d) => mask | (1 << (d - 1)), 0);
export const maskToDays = (mask: number): Weekday[] =>
  WEEKDAYS.filter((d) => (mask & (1 << (d - 1))) !== 0);

// ---- Validation ------------------------------------------------------------------

export const templateTitleSchema = z.string().trim().min(1).max(120);

export const templateDaysSchema = z
  .array(z.number().int().min(1).max(7))
  .min(1)
  .max(7)
  .refine((days) => new Set(days).size === days.length, 'duplicate_day')
  .transform((days) => [...days].sort() as Weekday[]);

/** Date seule (début = fin) ou plage de dates sans émission. */
export const templateExclusionSchema = z
  .object({
    from: airDateSchema,
    to: airDateSchema,
    label: z.string().trim().max(80).default(''),
  })
  .strict()
  .refine((e) => e.from <= e.to, 'exclusion_range');
export type TemplateExclusion = z.output<typeof templateExclusionSchema>;

const templateFields = {
  title: templateTitleSchema,
  startTime: startTimeSchema,
  days: templateDaysSchema,
  /** Période de validité facultative (ex. saison septembre → juin). */
  validFrom: airDateSchema.nullable(),
  validUntil: airDateSchema.nullable(),
  /** Modèle suspendu : aucune création possible. */
  active: z.boolean(),
  exclusions: z.array(templateExclusionSchema).max(MAX_TEMPLATE_EXCLUSIONS),
  /** Disposition de l'écran studio, copiée dans les conducteurs créés ; null : par défaut. */
  layout: layoutSchema.nullable(),
  items: rundownItemsSchema,
};

const validPeriod = (v: { validFrom?: string | null; validUntil?: string | null }) =>
  !v.validFrom || !v.validUntil || v.validFrom <= v.validUntil;

export const createTemplateSchema = z
  .object({
    ownerId: z.number().int().positive().nullable(),
    title: templateFields.title,
    startTime: templateFields.startTime,
    days: templateFields.days,
    validFrom: templateFields.validFrom.default(null),
    validUntil: templateFields.validUntil.default(null),
    active: templateFields.active.default(true),
    exclusions: templateFields.exclusions.default([]),
    layout: templateFields.layout.default(null),
    items: templateFields.items.default([]),
  })
  .refine(validPeriod, { message: 'valid_period', path: ['validUntil'] });

export const updateTemplateSchema = z
  .object({
    /** Version connue du client : refus (409) si le modèle a changé entre-temps. */
    version: z.number().int().positive(),
    title: templateFields.title.optional(),
    startTime: templateFields.startTime.optional(),
    days: templateFields.days.optional(),
    validFrom: templateFields.validFrom.optional(),
    validUntil: templateFields.validUntil.optional(),
    active: templateFields.active.optional(),
    exclusions: templateFields.exclusions.optional(),
    layout: templateFields.layout.optional(),
    items: templateFields.items.optional(),
  })
  .refine((v) => Object.keys(v).length > 1, 'empty')
  .refine(validPeriod, { message: 'valid_period', path: ['validUntil'] });

export const duplicateTemplateSchema = z.object({
  ownerId: z.number().int().positive().nullable(),
  title: templateTitleSchema.optional(),
});

/** « Enregistrer comme modèle » depuis un conducteur. */
export const saveAsTemplateSchema = z.object({
  ownerId: z.number().int().positive().nullable(),
  title: templateTitleSchema.optional(),
  /** Par défaut : le jour de la semaine du conducteur. */
  days: templateDaysSchema.optional(),
});

/** Période de création des conducteurs : 3 mois au plus. */
export const createFromTemplateSchema = z
  .object({ from: airDateSchema, to: airDateSchema })
  .strict()
  .refine((p) => p.from <= p.to, { message: 'period', path: ['to'] })
  .refine((p) => daysBetween(p.from, p.to) < MAX_CREATE_DAYS, {
    message: 'period_too_long',
    path: ['to'],
  });

/** « Réappliquer le modèle » : version connue du conducteur. */
export const reapplyTemplateSchema = z.object({ version: z.number().int().positive() });

export type CreateTemplateInput = z.output<typeof createTemplateSchema>;
export type UpdateTemplateInput = z.output<typeof updateTemplateSchema>;
export type CreateFromTemplateInput = z.output<typeof createFromTemplateSchema>;

// ---- Dates de diffusion ------------------------------------------------------------

export interface TemplateRule {
  days: readonly number[];
  validFrom: string | null;
  validUntil: string | null;
  exclusions: readonly { from: string; to: string }[];
}

export type SkipReason = 'excluded' | 'outside';

/**
 * Jours de diffusion d'un modèle entre deux dates (incluses) : les jours cochés, moins ceux
 * hors de la période de validité ou exclus. Calcul sur des dates seules : le changement
 * d'heure n'a aucun effet.
 */
export function templateDates(
  rule: TemplateRule,
  from: string,
  to: string,
): { dates: string[]; skipped: { date: string; reason: SkipReason }[] } {
  const dates: string[] = [];
  const skipped: { date: string; reason: SkipReason }[] = [];
  const days = new Set(rule.days);
  for (let date = from; date <= to; date = addDays(date, 1)) {
    if (!days.has(weekdayOf(date))) continue;
    if ((rule.validFrom && date < rule.validFrom) || (rule.validUntil && date > rule.validUntil)) {
      skipped.push({ date, reason: 'outside' });
    } else if (rule.exclusions.some((e) => e.from <= date && date <= e.to)) {
      skipped.push({ date, reason: 'excluded' });
    } else {
      dates.push(date);
    }
  }
  return { dates, skipped };
}
