import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AirState, RadiodjSettings, ServerMessage, Settings } from '@onair-desk/shared';
import { AirStateStore } from '../src/air/state.js';
import {
  POLL_MS,
  RadiodjConnector,
  SIGNAL_WINDOW_MS,
  STALE_AFTER_MS,
} from '../src/connectors/radiodj/connector.js';
import {
  displayArtist,
  parseCueTimes,
  songTiming,
  toTrack,
} from '../src/connectors/radiodj/cues.js';
import { radiodjErrorCode } from '../src/connectors/radiodj/reader.js';
import { AutomationManager, DEGRADED_MAX_MS, RETRY_MS } from '../src/connectors/manager.js';
import type { AutomationUpdate, ConnectorContext } from '../src/connectors/types.js';
import { zonedToEpoch } from '../src/lib/time.js';
import { FakeReader, SANS_INTRO, SUMMERTIME } from './radiodj-fixtures.js';
import type { Hub } from '../src/ws/hub.js';

describe('repères RadioDJ', () => {
  it('lit les clés connues et ignore le reste', () => {
    expect(parseCueTimes('&sta=0.5&int=4&foo=2&xta=abc&end=&out=-1')).toEqual({
      sta: 0.5,
      int: 4,
    });
    expect(parseCueTimes(null)).toEqual({});
    expect(parseCueTimes('')).toEqual({});
  });

  it('durée jusqu’au point de mix, intro et outro relatives au début de lecture', () => {
    const t = songTiming(SUMMERTIME);
    expect(t.durationSec).toBeCloseTo(164.320793650794 - 0.33172335600907, 6);
    expect(t.introSec).toBeCloseTo(4.36934240362812 - 0.33172335600907, 6);
    expect(t.outroSec).toBeCloseTo(164.320793650794 - 161.413764172336, 6);
  });

  it('sans intro marquée : pas de talk-over ; sans repères : durée du fichier', () => {
    expect(songTiming(SANS_INTRO).introSec).toBeNull();
    expect(songTiming({ duration: 200, cueTimes: null })).toEqual({
      durationSec: 200,
      introSec: null,
      outroSec: null,
    });
    // Point de mix absent : fin de lecture.
    expect(songTiming({ duration: 200, cueTimes: '&sta=1&end=180' }).durationSec).toBe(179);
    // Repère hors du titre : ignoré.
    expect(songTiming({ duration: 200, cueTimes: '&sta=1&xta=100&int=150' }).introSec).toBeNull();
  });

  it('titre de l’état antenne : artistes associés, durées en ms', () => {
    const track = toTrack(SUMMERTIME, 1000);
    expect(track).toMatchObject({
      title: 'Summertime',
      artist: 'Adamé, Lili Poli',
      startedAt: 1000,
    });
    expect(track.durationMs).toBe(163989);
    expect(track.introMs).toBe(4038);
    expect(displayArtist(' A ;; B ')).toBe('A, B');
  });

  it('codes d’erreur stables', () => {
    expect(radiodjErrorCode({ code: 'ER_ACCESS_DENIED_ERROR' })).toBe('radiodj_access_denied');
    expect(radiodjErrorCode({ code: 'ECONNREFUSED' })).toBe('radiodj_unreachable');
    expect(radiodjErrorCode({ code: 'ER_NO_SUCH_TABLE' })).toBe('radiodj_bad_schema');
    expect(radiodjErrorCode(new Error('x'))).toBe('radiodj_error');
  });
});

describe('heure locale du PC RadioDJ', () => {
  it('convertit dans le fuseau de la station (heure d’été et d’hiver)', () => {
    expect(zonedToEpoch('2026-10-24 16:19:16', 'Europe/Paris')).toBe(
      Date.UTC(2026, 9, 24, 14, 19, 16),
    );
    expect(zonedToEpoch('2026-12-01 08:00:00', 'Europe/Paris')).toBe(
      Date.UTC(2026, 11, 1, 7, 0, 0),
    );
    expect(zonedToEpoch('2026-06-01 08:00:00', 'UTC')).toBe(Date.UTC(2026, 5, 1, 8, 0, 0));
    expect(zonedToEpoch('illisible', 'Europe/Paris')).toBeNull();
  });
});

/** Attend la fin des lectures en cours (promesses déjà résolues). */
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe('connecteur RadioDJ', () => {
  // 24/10/2026 16:20:00 à Paris (UTC+2).
  const T0 = Date.UTC(2026, 9, 24, 14, 20, 0);
  let now = T0;
  const updates: AutomationUpdate[] = [];
  const failures: string[] = [];
  const ctx: ConnectorContext = {
    now: () => now,
    update: (u) => updates.push(u),
    fail: (e) => failures.push(e),
  };

  beforeEach(() => {
    vi.useFakeTimers();
    now = T0;
    updates.length = 0;
    failures.length = 0;
  });
  afterEach(() => vi.useRealTimers());

  it('au démarrage : titre en cours (heure du PC RadioDJ), titre à venir', async () => {
    const db = new FakeReader();
    db.play(SANS_INTRO, '2026-10-24 16:19:16');
    db.queue = [SUMMERTIME];
    const c = new RadiodjConnector(db, 'Europe/Paris');
    await c.start(ctx);
    expect(updates).toHaveLength(1);
    expect(updates[0]!.nowPlaying).toMatchObject({
      title: 'Un Peu Plus Près Du Bonheur',
      startedAt: Date.UTC(2026, 9, 24, 14, 19, 16),
    });
    expect(updates[0]!.next).toMatchObject({ title: 'Summertime', startedAt: null });
    c.stop();
    expect(db.closed).toBe(true);
  });

  it('ignore les habillages (sweeper inscrit juste après le titre)', async () => {
    const db = new FakeReader();
    db.play(SUMMERTIME, '2026-10-24 16:19:16');
    db.play({ ...SANS_INTRO, title: 'Jingle Chanté 01' }, '2026-10-24 16:19:16', 2);
    const c = new RadiodjConnector(db, 'Europe/Paris');
    await c.start(ctx);
    expect(updates.at(-1)!.nowPlaying?.title).toBe('Summertime');
    c.stop();
  });

  it('signal : heure de réception comme heure de début, ligne écrite un peu après', async () => {
    const db = new FakeReader();
    db.play(SANS_INTRO, '2026-10-24 16:19:16');
    const c = new RadiodjConnector(db, 'Europe/Paris');
    await c.start(ctx);

    now = T0 + 5_000;
    const signalAt = now;
    c.signal(signalAt); // la ligne d'historique n'existe pas encore
    await flush();
    expect(updates).toHaveLength(1);

    now += 400;
    db.play(SUMMERTIME, '2026-10-24 16:20:06'); // horloge du PC RadioDJ en avance d'une seconde
    await vi.advanceTimersByTimeAsync(500);
    expect(updates.at(-1)!.nowPlaying).toMatchObject({ title: 'Summertime', startedAt: signalAt });
    c.stop();
  });

  it('signal trop ancien : heure du PC RadioDJ', async () => {
    const db = new FakeReader();
    const c = new RadiodjConnector(db, 'Europe/Paris');
    await c.start(ctx);
    c.signal(now);
    await flush();
    now += SIGNAL_WINDOW_MS + 1_000;
    db.play(SUMMERTIME, '2026-10-24 16:20:10');
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(updates.at(-1)!.nowPlaying?.startedAt).toBe(Date.UTC(2026, 9, 24, 14, 20, 10));
    c.stop();
  });

  it('relecture périodique : nouveau titre sans signal, file modifiée, rien si rien ne change', async () => {
    const db = new FakeReader();
    db.play(SANS_INTRO, '2026-10-24 16:19:16');
    const c = new RadiodjConnector(db, 'Europe/Paris');
    await c.start(ctx);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(updates).toHaveLength(1);

    db.queue = [SUMMERTIME];
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(updates).toHaveLength(2);
    expect(updates.at(-1)!.next?.title).toBe('Summertime');
    c.stop();
  });

  it('même titre rejoué : nouveau passage (nouvelle ligne d’historique)', async () => {
    const db = new FakeReader();
    db.play(SUMMERTIME, '2026-10-24 16:10:00');
    const c = new RadiodjConnector(db, 'Europe/Paris');
    await c.start(ctx);
    db.play(SUMMERTIME, '2026-10-24 16:19:58');
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(updates.at(-1)!.nowPlaying?.startedAt).toBe(Date.UTC(2026, 9, 24, 14, 19, 58));
    c.stop();
  });

  it('RadioDJ arrêté : le titre fini depuis plus de 30 s disparaît', async () => {
    const db = new FakeReader();
    db.play(SANS_INTRO, '2026-10-24 16:19:16');
    const c = new RadiodjConnector(db, 'Europe/Paris');
    await c.start(ctx);
    const track = updates[0]!.nowPlaying!;
    now = track.startedAt! + track.durationMs + STALE_AFTER_MS + 1;
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(updates.at(-1)!.nowPlaying).toBeNull();
    c.stop();
  });

  it('base en panne : échec signalé avec un code stable', async () => {
    const db = new FakeReader();
    db.failWith = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    const c = new RadiodjConnector(db, 'Europe/Paris');
    await c.start(ctx);
    expect(failures).toEqual(['radiodj_unreachable: connect ECONNREFUSED']);
    c.stop();
  });
});

describe('gestionnaire et source RadioDJ', () => {
  const RADIODJ: RadiodjSettings = {
    host: 'radiodj.lan',
    port: 3306,
    database: 'radiodj',
    user: 'onairdesk',
  };
  const settings = (over: Partial<Settings> = {}) =>
    ({
      automationSource: 'radiodj',
      simulatorSpeed: 1,
      timezone: 'Europe/Paris',
      radiodj: RADIODJ,
      ...over,
    }) as Settings;

  const setup = (db: FakeReader, password: string | null = 'secret') => {
    const sent: ServerMessage[] = [];
    const hub = {
      broadcastStudio: (_id: number, m: ServerMessage) => sent.push(m),
    } as unknown as Hub;
    const air = new AirStateStore(hub);
    const writes: string[] = [];
    const audit = { write: (_a: unknown, action: string) => writes.push(action) };
    const opened: string[] = [];
    const manager = new AutomationManager(1, air, audit as never, Date.now, {
      radiodjPassword: password,
      radiodjReader: (s, p) => {
        opened.push(`${s.host}:${p}`);
        return db;
      },
    });
    const state = (): AirState => air.get(1).state;
    return { manager, state, writes, opened };
  };

  beforeEach(() => vi.useFakeTimers({ now: Date.UTC(2026, 9, 24, 14, 20, 0) }));
  afterEach(() => vi.useRealTimers());

  it('mot de passe absent ou hôte vide : erreur explicite, sans ouvrir la base', () => {
    const db = new FakeReader();
    const a = setup(db, null);
    a.manager.apply(settings());
    expect(a.state().source).toMatchObject({
      id: 'radiodj',
      state: 'error',
      error: 'radiodj_no_password',
    });
    expect(a.opened).toEqual([]);
    a.manager.stop();

    const b = setup(db);
    b.manager.apply(settings({ radiodj: { ...RADIODJ, host: '' } }));
    expect(b.state().source.error).toBe('radiodj_not_configured');
    b.manager.stop();
  });

  it('redémarre seulement si l’accès ou le fuseau change', async () => {
    const db = new FakeReader();
    const { manager, opened } = setup(db);
    manager.apply(settings());
    manager.apply(settings({ simulatorSpeed: 30 }));
    expect(opened).toHaveLength(1);
    manager.apply(settings({ radiodj: { ...RADIODJ, port: 3307 } }));
    manager.apply(settings({ timezone: 'UTC' }));
    expect(opened).toHaveLength(3);
    manager.stop();
  });

  it('signal ignoré si RadioDJ n’est pas la source choisie', () => {
    const { manager } = setup(new FakeReader());
    manager.apply(settings({ automationSource: 'none' }));
    expect(manager.signal('radiodj', 'A - B')).toBe(false);
    manager.stop();
  });

  it('mode dégradé : base en panne, le titre signalé s’affiche sans minutage', async () => {
    const db = new FakeReader();
    db.failWith = Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
    const { manager, state, writes } = setup(db);
    manager.apply(settings());
    await vi.advanceTimersByTimeAsync(0);
    expect(state().source.state).toBe('error');
    expect(writes).toEqual(['automation.error']);

    expect(manager.signal('radiodj', 'César - Libertà')).toBe(true);
    expect(state().nowPlaying).toEqual({
      title: 'César - Libertà',
      artist: '',
      durationMs: 0,
      startedAt: null,
      introMs: null,
      outroMs: null,
    });

    // Nouvel essai toujours en panne : le titre signalé reste affiché.
    await vi.advanceTimersByTimeAsync(RETRY_MS);
    expect(state().nowPlaying?.title).toBe('César - Libertà');

    // Au-delà de 10 minutes sans nouveau signal, il n'est plus affiché.
    await vi.advanceTimersByTimeAsync(DEGRADED_MAX_MS);
    expect(state().nowPlaying).toBeNull();

    // Retour de la base : données complètes.
    db.failWith = null;
    db.play(SUMMERTIME, '2026-10-24 16:30:00');
    await vi.advanceTimersByTimeAsync(RETRY_MS);
    expect(state().source.state).toBe('ok');
    expect(state().nowPlaying?.title).toBe('Summertime');
    expect(writes).toEqual(['automation.error', 'automation.recovered']);
    manager.stop();
  });

  it('signal transmis au connecteur en marche', async () => {
    const db = new FakeReader();
    db.play(SANS_INTRO, '2026-10-24 16:19:16');
    const { manager, state } = setup(db);
    manager.apply(settings());
    await vi.advanceTimersByTimeAsync(0);
    const before = db.reads;
    db.play(SUMMERTIME, '2026-10-24 16:20:00');
    manager.signal('radiodj', 'Adamé;Lili Poli - Summertime');
    await vi.advanceTimersByTimeAsync(0);
    expect(db.reads).toBeGreaterThan(before);
    expect(state().nowPlaying).toMatchObject({ title: 'Summertime', startedAt: Date.now() });
    manager.stop();
  });
});
