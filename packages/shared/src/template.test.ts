import { describe, expect, it } from 'vitest';
import { addDays } from './time.js';
import {
  createFromTemplateSchema,
  createTemplateSchema,
  daysToMask,
  maskToDays,
  templateDates,
  templateExclusionSchema,
  updateTemplateSchema,
  weekdayOf,
} from './template.js';

const rule = (over: Partial<Parameters<typeof templateDates>[0]> = {}) => ({
  days: [1, 3, 5],
  validFrom: null,
  validUntil: null,
  exclusions: [],
  ...over,
});

describe('dates de diffusion d’un modèle', () => {
  it('jours de la semaine (lundi = 1, dimanche = 7)', () => {
    expect(weekdayOf('2026-10-19')).toBe(1);
    expect(weekdayOf('2026-10-25')).toBe(7);
    expect(maskToDays(daysToMask([7, 1, 3]))).toEqual([1, 3, 7]);
  });

  it('ne garde que les jours cochés', () => {
    const r = templateDates(rule(), '2026-10-19', '2026-10-25');
    expect(r.dates).toEqual(['2026-10-19', '2026-10-21', '2026-10-23']);
    expect(r.skipped).toEqual([]);
  });

  it('respecte la période de validité', () => {
    const r = templateDates(
      rule({ validFrom: '2026-10-21', validUntil: '2026-10-22' }),
      '2026-10-19',
      '2026-10-25',
    );
    expect(r.dates).toEqual(['2026-10-21']);
    expect(r.skipped).toEqual([
      { date: '2026-10-19', reason: 'outside' },
      { date: '2026-10-23', reason: 'outside' },
    ]);
  });

  it('respecte les exclusions (date seule ou plage)', () => {
    const r = templateDates(
      rule({
        exclusions: [
          { from: '2026-11-11', to: '2026-11-11' },
          { from: '2026-11-16', to: '2026-11-20' },
        ],
      }),
      '2026-11-09',
      '2026-11-23',
    );
    expect(r.dates).toEqual(['2026-11-09', '2026-11-13', '2026-11-23']);
    expect(r.skipped.map((s) => s.reason)).toEqual(Array(4).fill('excluded'));
  });

  it('traverse le changement d’heure et les fins de mois', () => {
    // Passage à l'heure d'hiver le 25 octobre 2026 ; fin de février d'une année non bissextile.
    expect(templateDates(rule({ days: [7, 1] }), '2026-10-24', '2026-10-27').dates).toEqual([
      '2026-10-25',
      '2026-10-26',
    ]);
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    const all = templateDates(rule({ days: [1, 2, 3, 4, 5, 6, 7] }), '2026-01-01', '2026-12-31');
    expect(all.dates).toHaveLength(365);
  });
});

describe('validation des modèles', () => {
  const base = { ownerId: null, title: 'La matinale', startTime: '07:00', days: [1, 2] };

  it('valeurs par défaut : actif, sans période ni exclusion ni élément', () => {
    const r = createTemplateSchema.parse(base);
    expect(r).toMatchObject({ active: true, validFrom: null, exclusions: [], items: [] });
    expect(r.startTime).toBe('07:00:00');
  });

  it('au moins un jour coché, sans doublon', () => {
    expect(createTemplateSchema.safeParse({ ...base, days: [] }).success).toBe(false);
    expect(createTemplateSchema.safeParse({ ...base, days: [1, 1] }).success).toBe(false);
    expect(createTemplateSchema.safeParse({ ...base, days: [8] }).success).toBe(false);
  });

  it('période et exclusions cohérentes', () => {
    const period = { ...base, validFrom: '2026-09-01', validUntil: '2026-06-30' };
    expect(createTemplateSchema.safeParse(period).success).toBe(false);
    expect(
      templateExclusionSchema.safeParse({ from: '2026-11-02', to: '2026-11-01' }).success,
    ).toBe(false);
    const tooMany = Array(101).fill({ from: '2026-11-01', to: '2026-11-01' });
    expect(createTemplateSchema.safeParse({ ...base, exclusions: tooMany }).success).toBe(false);
  });

  it('enregistrement : version et au moins un champ', () => {
    expect(updateTemplateSchema.safeParse({ version: 1 }).success).toBe(false);
    expect(updateTemplateSchema.safeParse({ version: 1, active: false }).success).toBe(true);
  });

  it('période de création : 3 mois au plus, dans l’ordre', () => {
    const ok = { from: '2026-10-26', to: '2027-01-25' };
    expect(createFromTemplateSchema.safeParse(ok).success).toBe(true);
    expect(createFromTemplateSchema.safeParse({ ...ok, to: '2027-01-26' }).success).toBe(false);
    expect(createFromTemplateSchema.safeParse({ from: ok.to, to: ok.from }).success).toBe(false);
  });
});
