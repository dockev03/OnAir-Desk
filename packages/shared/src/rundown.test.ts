import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ITEM_TYPES,
  airDateSchema,
  itemColors,
  itemTypesSchema,
  parseItemDuration,
  rundownItemsSchema,
  startTimeSchema,
  type RundownItemInput,
} from './rundown.js';
import { itemSeconds, rundownSchedule, secondsToTime, timeToSeconds } from './timing.js';
import { createRundownSchema, prompterSendSchema } from './schemas.js';

const item = (over: Partial<RundownItemInput> = {}): RundownItemInput => ({
  uid: 'a1',
  typeId: 'jingle',
  title: 'Jingle ouverture',
  durationSeconds: 10,
  notes: '',
  scriptId: null,
  ...over,
});

describe('durées et heures de passage', () => {
  const script = { title: 'S', wordCount: 300, speedWpm: 150, cueSeconds: 12, deleted: false };

  it('durée manuelle prioritaire, sinon lecture + repères, sinon 0', () => {
    expect(itemSeconds({ durationSeconds: 90, script })).toBe(90);
    expect(itemSeconds({ durationSeconds: null, script })).toBe(132);
    expect(itemSeconds({ durationSeconds: null, script: null })).toBe(0);
  });

  it('calcule les heures de passage, la fin et le total', () => {
    const r = rundownSchedule('07:00:00', [
      { durationSeconds: 10 },
      { durationSeconds: null, script },
      { durationSeconds: 248 },
    ]);
    expect(r.starts.map(secondsToTime)).toEqual(['07:00:00', '07:00:10', '07:02:22']);
    expect(secondsToTime(r.end)).toBe('07:06:30');
    expect(r.total).toBe(390);
  });

  it('passe minuit sans erreur', () => {
    expect(secondsToTime(timeToSeconds('23:59:00') + 120)).toBe('00:01:00');
  });
});

describe('saisie d’une durée d’élément', () => {
  it('secondes, m:ss ou h:mm:ss ; vide = durée du script', () => {
    expect(parseItemDuration('')).toBeNull();
    expect(parseItemDuration('45')).toBe(45);
    expect(parseItemDuration('2:30')).toBe(150);
    expect(parseItemDuration('90:00')).toBe(5400);
    expect(parseItemDuration('1:05:00')).toBe(3900);
    for (const bad of ['2:5', '1:60', '4:00:01', 'abc', '-3', '1.5']) {
      expect(parseItemDuration(bad)).toBeUndefined();
    }
  });
});

describe('validation', () => {
  it('heure HH:MM ramenée à HH:MM:SS, heure invalide refusée', () => {
    expect(startTimeSchema.parse('07:30')).toBe('07:30:00');
    expect(startTimeSchema.parse('23:59:59')).toBe('23:59:59');
    for (const bad of ['24:00', '7:30', '07:60', 'midi']) {
      expect(startTimeSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('date réelle uniquement', () => {
    expect(airDateSchema.safeParse('2026-10-22').success).toBe(true);
    expect(airDateSchema.safeParse('2026-02-30').success).toBe(false);
    expect(airDateSchema.safeParse('22/10/2026').success).toBe(false);
  });

  it('éléments : identifiants uniques, durée bornée, notes limitées', () => {
    expect(rundownItemsSchema.safeParse([item(), item({ uid: 'b2' })]).success).toBe(true);
    expect(rundownItemsSchema.safeParse([item(), item()]).success).toBe(false);
    expect(rundownItemsSchema.safeParse([item({ durationSeconds: -1 })]).success).toBe(false);
    expect(rundownItemsSchema.safeParse([item({ notes: 'x'.repeat(501) })]).success).toBe(false);
    expect(rundownItemsSchema.safeParse([item({ uid: 'A B' })]).success).toBe(false);
  });

  it('conducteur complet', () => {
    const ok = createRundownSchema.safeParse({
      ownerId: null,
      title: 'La matinale',
      airDate: '2026-10-22',
      startTime: '07:00',
      items: [item()],
    });
    expect(ok.success).toBe(true);
  });

  it('types : identifiants uniques, au moins un, couleurs de la palette', () => {
    expect(itemTypesSchema.safeParse(DEFAULT_ITEM_TYPES).success).toBe(true);
    expect(itemTypesSchema.safeParse([]).success).toBe(false);
    const dup = [DEFAULT_ITEM_TYPES[0], DEFAULT_ITEM_TYPES[0]];
    expect(itemTypesSchema.safeParse(dup).success).toBe(false);
    const badColor = [{ id: 'x', label: 'X', color: '#FF0000' }];
    expect(itemTypesSchema.safeParse(badColor).success).toBe(false);
    expect(itemColors(DEFAULT_ITEM_TYPES, 'inconnu').bg).toBe('#3A3B3F');
  });

  it('écran studio : script seul ou élément de conducteur', () => {
    expect(prompterSendSchema.safeParse({ scriptId: null }).success).toBe(true);
    expect(prompterSendSchema.safeParse({ rundownId: 1, itemUid: 'a1' }).success).toBe(true);
    expect(prompterSendSchema.safeParse({ rundownId: 1 }).success).toBe(false);
    expect(prompterSendSchema.safeParse({ scriptId: 1, rundownId: 1, itemUid: 'a' }).success).toBe(
      false,
    );
  });
});
