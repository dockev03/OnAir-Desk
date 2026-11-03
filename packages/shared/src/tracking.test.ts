import { describe, expect, it } from 'vitest';
import { createRundownSchema, settingsSchema } from './schemas.js';
import { createTemplateSchema } from './template.js';
import {
  backtime,
  balanceLevel,
  cuttableSeconds,
  currentPassage,
  driftLevel,
  endLevel,
  fixedTimeLevel,
  formatSigned,
  nextFixedTime,
  plannedBalance,
  rundownDrift,
  runPlannedStarts,
  runReport,
  sequenceLevel,
  sequenceTimer,
  type RunForReport,
} from './timing.js';
import { zonedToEpoch } from './time.js';
import {
  ALL_DAYS,
  ALL_HOURS,
  DEFAULT_FIXED_TIMES,
  DEFAULT_TIME_TRACKING,
  endAfterStart,
  fixedTimeSchema,
  fixedTimesSchema,
  timeTrackingSchema,
  type FixedTime,
  type RunItem,
  type RunState,
} from './tracking.js';

const TZ = 'Europe/Paris';
const at = (local: string) => zonedToEpoch(local, TZ)!;
const S = 1000;
const MIN = 60_000;

const fixed = (patch: Partial<FixedTime> = {}): FixedTime => ({
  id: 'flash',
  label: 'Flash infos',
  minute: 0,
  hours: [8, 12],
  days: ALL_DAYS,
  warnMinutes: 5,
  active: true,
  ...patch,
});

describe('horaires fixes', () => {
  it('valide un horaire', () => {
    expect(fixedTimeSchema.safeParse(fixed()).success).toBe(true);
    expect(fixedTimeSchema.safeParse(fixed({ hours: [] })).success).toBe(false);
    expect(fixedTimeSchema.safeParse(fixed({ hours: [8, 8] })).success).toBe(false);
    expect(fixedTimeSchema.safeParse(fixed({ hours: [24] })).success).toBe(false);
    expect(fixedTimeSchema.safeParse(fixed({ days: [0] })).success).toBe(false);
    expect(fixedTimeSchema.safeParse(fixed({ minute: 60 })).success).toBe(false);
    expect(fixedTimeSchema.safeParse(fixed({ warnMinutes: 31 })).success).toBe(false);
    expect(fixedTimeSchema.safeParse(fixed({ label: 'a\u0007' })).success).toBe(false);
    expect(fixedTimesSchema.safeParse([fixed(), fixed()]).success).toBe(false);
    expect(fixedTimesSchema.safeParse(DEFAULT_FIXED_TIMES).success).toBe(true);
    expect(DEFAULT_FIXED_TIMES.every((f) => !f.active)).toBe(true);
  });

  it('rien hors de la prévenance', () => {
    expect(nextFixedTime([fixed()], at('2026-11-03 07:54:59'), TZ)).toBeNull();
  });

  it('compte à rebours pendant la prévenance, puis « maintenant » 10 s', () => {
    const c = nextFixedTime([fixed()], at('2026-11-03 07:55:30'), TZ)!;
    expect(c.label).toBe('Flash infos');
    expect(c.at).toBe(at('2026-11-03 08:00:00'));
    expect(c.remainingMs).toBe(4 * MIN + 30 * S);
    expect(nextFixedTime([fixed()], at('2026-11-03 08:00:09'), TZ)!.remainingMs).toBe(-9 * S);
    expect(nextFixedTime([fixed()], at('2026-11-03 08:00:11'), TZ)).toBeNull();
  });

  it('heures, minute, jours, inactif', () => {
    expect(nextFixedTime([fixed()], at('2026-11-03 10:58:00'), TZ)).toBeNull();
    const half = fixed({ minute: 30, hours: ALL_HOURS });
    expect(nextFixedTime([half], at('2026-11-03 10:27:00'), TZ)!.at).toBe(
      at('2026-11-03 10:30:00'),
    );
    // 2026-11-03 est un mardi (2).
    expect(nextFixedTime([fixed({ days: [1] })], at('2026-11-03 07:58:00'), TZ)).toBeNull();
    expect(nextFixedTime([fixed({ days: [2] })], at('2026-11-03 07:58:00'), TZ)).not.toBeNull();
    expect(nextFixedTime([fixed({ active: false })], at('2026-11-03 07:58:00'), TZ)).toBeNull();
  });

  it('passage de minuit et horaire le plus proche', () => {
    const midnight = fixed({ id: 'm', hours: [0] });
    const c = nextFixedTime([midnight], at('2026-11-03 23:57:00'), TZ)!;
    expect(c.at).toBe(at('2026-11-04 00:00:00'));
    const top = fixed({ id: 'top', label: 'Top', hours: ALL_HOURS, warnMinutes: 10 });
    const quarter = fixed({ id: 'q', label: 'Quart', minute: 55, hours: [7], warnMinutes: 10 });
    expect(nextFixedTime([top, quarter], at('2026-11-03 07:52:00'), TZ)!.label).toBe('Quart');
  });

  it('changement d’heure : 8 h locale reste 8 h locale', () => {
    // Passage à l'heure d'hiver le 25 octobre 2026.
    const c = nextFixedTime([fixed()], at('2026-10-25 07:58:00'), TZ)!;
    expect(c.at).toBe(Date.UTC(2026, 9, 25, 7, 0, 0));
  });

  it('niveaux : orange à 1 min, rouge à 10 s', () => {
    expect(fixedTimeLevel(61 * S)).toBe('none');
    expect(fixedTimeLevel(60 * S)).toBe('soon');
    expect(fixedTimeLevel(10 * S)).toBe('now');
    expect(fixedTimeLevel(-5 * S)).toBe('now');
  });
});

describe('paramètres du suivi du temps', () => {
  it('ordre des seuils', () => {
    expect(timeTrackingSchema.safeParse(DEFAULT_TIME_TRACKING).success).toBe(true);
    expect(
      timeTrackingSchema.safeParse({ ...DEFAULT_TIME_TRACKING, driftNowSeconds: 30 }).success,
    ).toBe(false);
    expect(
      timeTrackingSchema.safeParse({ ...DEFAULT_TIME_TRACKING, endNowMinutes: 5 }).success,
    ).toBe(false);
    expect(settingsSchema.shape.timeTracking).toBe(timeTrackingSchema);
  });
});

describe('heure de fin imposée', () => {
  const base = { ownerId: null, title: 'Matinale', airDate: '2026-11-03', startTime: '07:00' };
  it('facultative, après le début', () => {
    expect(createRundownSchema.parse(base).endTime).toBeNull();
    expect(createRundownSchema.parse({ ...base, endTime: '09:00' }).endTime).toBe('09:00:00');
    expect(createRundownSchema.safeParse({ ...base, endTime: '07:00' }).success).toBe(false);
    expect(createRundownSchema.safeParse({ ...base, endTime: '06:00' }).success).toBe(false);
    expect(endAfterStart('07:00:00', null)).toBe(true);
    expect(endAfterStart('07:00:00', '07:00:01')).toBe(true);
  });
  it('dans les modèles', () => {
    const t = { ownerId: null, title: 'Matinale', startTime: '07:00', days: [1] };
    expect(createTemplateSchema.parse(t).endTime).toBeNull();
    expect(createTemplateSchema.safeParse({ ...t, endTime: '06:59' }).success).toBe(false);
  });
  it('écart prévu et partie « à couper »', () => {
    expect(plannedBalance('07:00:00', null, 600)).toBeNull();
    expect(plannedBalance('07:00:00', '08:00:00', 3000)).toBe(600);
    expect(plannedBalance('07:00:00', '08:00:00', 3700)).toBe(-100);
    expect(
      cuttableSeconds([
        { durationSeconds: 60, cuttable: true },
        { durationSeconds: 30, cuttable: false },
        { durationSeconds: 45, cuttable: true },
      ]),
    ).toBe(105);
  });
});

const item = (uid: string, plannedSeconds: number, patch: Partial<RunItem> = {}): RunItem => ({
  uid,
  title: uid.toUpperCase(),
  typeId: 'chronique',
  artist: '',
  plannedSeconds,
  cuttable: false,
  ...patch,
});

const BASE = at('2026-11-03 07:00:00');

const run = (patch: Partial<RunState> = {}): RunState => ({
  id: 1,
  rundownId: 1,
  title: 'Matinale',
  rehearsal: false,
  startedAt: BASE,
  baseAt: BASE,
  endAt: null,
  items: [item('a', 60), item('b', 120), item('c', 0), item('d', 300, { cuttable: true })],
  passages: [],
  ...patch,
});

describe('déroulé', () => {
  it('heures prévues et élément en cours', () => {
    expect(runPlannedStarts(run())).toEqual([BASE, BASE + 60 * S, BASE + 180 * S, BASE + 180 * S]);
    expect(currentPassage(run())).toBeNull();
    const r = run({
      passages: [
        { uid: 'b', at: BASE + 70 * S, source: 'screen' },
        { uid: 'a', at: BASE, source: 'screen' },
      ],
    });
    expect(currentPassage(r)!.uid).toBe('b');
  });

  it('minuteur de séquence : reste, dépassement, sans durée, automation', () => {
    const r = run({ passages: [{ uid: 'a', at: BASE, source: 'screen' }] });
    expect(sequenceTimer(r, BASE + 15 * S)).toEqual({
      uid: 'a',
      elapsedMs: 15 * S,
      remainingMs: 45 * S,
      automation: false,
    });
    expect(sequenceTimer(r, BASE + 72 * S)!.remainingMs).toBe(-12 * S);
    const c = run({ passages: [{ uid: 'c', at: BASE, source: 'automation' }] });
    expect(sequenceTimer(c, BASE + 5 * S)).toMatchObject({ remainingMs: null, automation: true });
    expect(sequenceTimer(run(), BASE)).toBeNull();
    // Élément retiré du conducteur : plus de minuteur.
    const gone = run({ passages: [{ uid: 'zz', at: BASE, source: 'screen' }] });
    expect(sequenceTimer(gone, BASE)).toBeNull();
  });

  it('niveaux du minuteur', () => {
    const s = DEFAULT_TIME_TRACKING;
    expect(sequenceLevel(null, s)).toBe('none');
    expect(sequenceLevel(16 * S, s)).toBe('none');
    expect(sequenceLevel(15 * S, s)).toBe('soon');
    expect(sequenceLevel(-1, s)).toBe('now');
  });

  it('avance / retard : début décalé, puis dépassement en cours', () => {
    // b prévu à +60 s, commencé à +80 s : 20 s de retard.
    const r = run({
      passages: [
        { uid: 'a', at: BASE, source: 'screen' },
        { uid: 'b', at: BASE + 80 * S, source: 'screen' },
      ],
    });
    expect(rundownDrift(r, BASE + 100 * S)).toBe(20 * S);
    // b dure 120 s ; à +230 s, il déborde de 30 s : 50 s de retard.
    expect(rundownDrift(r, BASE + 230 * S)).toBe(50 * S);
    // Avance : b commencé à +40 s.
    const early = run({ passages: [{ uid: 'b', at: BASE + 40 * S, source: 'screen' }] });
    expect(rundownDrift(early, BASE + 50 * S)).toBe(-20 * S);
    expect(rundownDrift(run(), BASE)).toBeNull();
  });

  it('élément sauté : le retard se calcule sur l’élément en cours', () => {
    const r = run({
      passages: [
        { uid: 'a', at: BASE, source: 'screen' },
        { uid: 'd', at: BASE + 170 * S, source: 'screen' },
      ],
    });
    expect(rundownDrift(r, BASE + 171 * S)).toBe(-10 * S);
  });

  it('modification en direct : les heures prévues suivent le conducteur actuel', () => {
    const r = run({
      items: [item('a', 60), item('x', 30), item('b', 120)],
      passages: [{ uid: 'b', at: BASE + 90 * S, source: 'screen' }],
    });
    expect(rundownDrift(r, BASE + 90 * S)).toBe(0);
  });

  it('niveaux du retard (l’avance n’est jamais une alerte)', () => {
    const s = DEFAULT_TIME_TRACKING;
    expect(driftLevel(-600 * S, s)).toBe('none');
    expect(driftLevel(29 * S, s)).toBe('none');
    expect(driftLevel(30 * S, s)).toBe('soon');
    expect(driftLevel(120 * S, s)).toBe('now');
  });

  it('format signé', () => {
    expect(formatSigned(80 * S)).toBe('+1:20');
    expect(formatSigned(-45 * S)).toBe('−0:45');
    expect(formatSigned(0)).toBe('+0:00');
  });
});

describe('backtiming', () => {
  const END = BASE + 600 * S;

  it('sans fin imposée : rien', () => {
    expect(backtime(run(), BASE)).toBeNull();
  });

  it('avant le premier élément : tout reste à faire', () => {
    const bt = backtime(run({ endAt: END }), BASE - 60 * S)!;
    expect(bt.projectedEnd).toBe(BASE + 480 * S);
    expect(bt.balanceMs).toBe(120 * S);
    expect(bt.remainingMs).toBe(660 * S);
    expect(bt.cutSuffices).toBe(false);
  });

  it('à caser, puis à couper et « couper les éléments marqués suffit »', () => {
    const r = run({
      endAt: END,
      passages: [{ uid: 'b', at: BASE + 60 * S, source: 'screen' }],
    });
    // À +100 s : reste 80 s de b, puis c (0) et d (300) → fin prévue +480 s, 120 s à caser.
    expect(backtime(r, BASE + 100 * S)!.balanceMs).toBe(120 * S);
    // b déborde jusqu'à +400 s : fin prévue +700 s, 100 s à couper, d (300 s) est « à couper ».
    const late = backtime(r, BASE + 400 * S)!;
    expect(late.balanceMs).toBe(-100 * S);
    expect(late.cuttableMs).toBe(300 * S);
    expect(late.cutSuffices).toBe(true);
  });

  it('les éléments déjà passés ne comptent plus', () => {
    const r = run({
      endAt: END,
      passages: [
        { uid: 'd', at: BASE, source: 'screen' },
        { uid: 'a', at: BASE + 300 * S, source: 'screen' },
      ],
    });
    // a (60 s) puis b et c : 120 s + 0 s ; d déjà passé.
    expect(backtime(r, BASE + 300 * S)!.projectedEnd).toBe(BASE + 480 * S);
  });

  it('niveaux', () => {
    const s = DEFAULT_TIME_TRACKING;
    expect(endLevel(6 * MIN, s)).toBe('none');
    expect(endLevel(5 * MIN, s)).toBe('soon');
    expect(endLevel(60 * S, s)).toBe('now');
    const base = {
      endAt: 0,
      projectedEnd: 0,
      cuttableMs: 0,
      cutSuffices: false,
    };
    expect(balanceLevel({ ...base, balanceMs: 1, remainingMs: 0 }, s)).toBe('none');
    expect(balanceLevel({ ...base, balanceMs: -1, remainingMs: 10 * MIN }, s)).toBe('soon');
    expect(balanceLevel({ ...base, balanceMs: -1, remainingMs: 4 * MIN }, s)).toBe('now');
  });
});

describe('bilan d’émission', () => {
  const report = (patch: Partial<RunForReport> = {}) =>
    runReport({
      id: 7,
      rehearsal: false,
      startedAt: BASE,
      baseAt: BASE,
      endAt: BASE + 600 * S,
      endedAt: BASE + 900 * S,
      lastEnd: BASE + 500 * S,
      items: [item('a', 60), item('b', 120), item('c', 30), item('n', 45)],
      removed: [item('r', 20), item('never', 10)],
      initialUids: ['a', 'b', 'c', 'r', 'never'],
      passages: [
        { uid: 'a', at: BASE + 10 * S, source: 'screen' },
        { uid: 'r', at: BASE + 75 * S, source: 'screen' },
        { uid: 'b', at: BASE + 90 * S, source: 'automation' },
        { uid: 'n', at: BASE + 300 * S, source: 'screen' },
      ],
      ...patch,
    });

  it('prévu / réel / durées', () => {
    const r = report();
    expect(r.plannedEnd).toBe(BASE + 255 * S);
    expect(r.actualEnd).toBe(BASE + 500 * S);
    expect(r.imposedEnd).toBe(BASE + 600 * S);
    const [a, b, c, n, removed] = r.lines;
    expect(a).toMatchObject({ plannedAt: BASE, actualAt: BASE + 10 * S, actualSeconds: 65 });
    expect(b).toMatchObject({ actualSeconds: 210, source: 'automation', added: false });
    expect(c).toMatchObject({ actualAt: null, actualSeconds: null, source: null });
    // n : ajouté en direct, dernier élément jusqu'à la sortie de l'écran.
    expect(n).toMatchObject({ added: true, actualSeconds: 200 });
    // r : retiré après son passage ; « never » (jamais passé) n'apparaît pas.
    expect(removed).toMatchObject({ uid: 'r', removed: true, plannedAt: null, actualSeconds: 15 });
    expect(r.lines).toHaveLength(5);
  });

  it('déroulé en cours : durée du dernier élément inconnue', () => {
    const r = report({ endedAt: null, lastEnd: null });
    expect(r.lines.find((l) => l.uid === 'n')!.actualSeconds).toBeNull();
    expect(r.actualEnd).toBeNull();
  });
});
