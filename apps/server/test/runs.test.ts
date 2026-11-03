import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type RehearsalSummary,
  type Rundown,
  type RundownItemInput,
  type RundownReportView,
  type Template,
  type Track,
} from '@onair-desk/shared';
import type { App } from '../src/app.js';
import { openDatabase } from '../src/db/database.js';
import { migrations } from '../src/db/migrations.js';
import { client, cookieFrom, createTestApp, createUser, setupAdmin } from './helpers.js';

let built: App;
const S = 1000;
const MIN = 60_000;
/** 3 novembre 2026, 7 h à Paris (UTC+1). */
const SHOW = Date.UTC(2026, 10, 3, 6, 0, 0);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(SHOW - 5 * MIN);
});
afterEach(async () => {
  await built?.app.close();
  vi.useRealTimers();
});

const at = (ms: number) => vi.setSystemTime(ms);

const item = (uid: string, over: Partial<RundownItemInput> = {}): RundownItemInput => ({
  uid,
  typeId: 'chronique',
  title: `Élément ${uid}`,
  durationSeconds: 60,
  notes: '',
  scriptId: null,
  artist: '',
  year: null,
  introSeconds: null,
  tags: [],
  cuttable: false,
  ...over,
});

const ITEMS = [
  item('a'),
  item('b', { durationSeconds: 120 }),
  item('song', {
    typeId: 'titre',
    title: 'Été Indien',
    artist: 'Joe Dassin',
    durationSeconds: 180,
  }),
  item('d', { cuttable: true }),
];

async function start() {
  built = await createTestApp();
  const adminCookie = await setupAdmin(built);
  const admin = client(built.app, adminCookie);
  const jean = await createUser(built, adminCookie, 'jean');
  const paul = await createUser(built, adminCookie, 'paul');
  const zoe = await createUser(built, adminCookie, 'zoe');
  await admin('PATCH', `/api/users/${paul.id}`, { isDirector: true });
  const { token } = (await admin('POST', '/api/devices', { name: 'Afficheur' })).json();
  const kiosk = client(
    built.app,
    cookieFrom(await client(built.app)('POST', '/api/kiosk/pair', { token }), 'oad_device'),
  );
  const jeanApi = client(built.app, jean.cookie);
  const created = await jeanApi('POST', '/api/rundowns', {
    ownerId: jean.id,
    title: 'Matinale',
    airDate: '2026-11-03',
    startTime: '07:00',
    endTime: '07:10',
    items: ITEMS,
  });
  expect(created.statusCode, created.body).toBe(201);
  const rundown = created.json() as Rundown;
  return {
    admin,
    jean: { ...jean, api: jeanApi },
    paul: { ...paul, api: client(built.app, paul.cookie) },
    zoe: client(built.app, zoe.cookie),
    kiosk,
    rundown,
  };
}

const run = () => built.ctx.air.get(1).state.run;
const show = (kiosk: ReturnType<typeof client>, rundownId: number, itemUid: string) =>
  kiosk('POST', '/api/prompter', { rundownId, itemUid });
const actions = () =>
  (
    built.ctx.repos.db.prepare('SELECT action FROM audit_log ORDER BY id').all() as {
      action: string;
    }[]
  ).map((r) => r.action);

describe('heure de fin imposée', () => {
  it('enregistrée, modifiable, refusée avant le début, reprise par duplication', async () => {
    const { jean, rundown } = await start();
    expect(rundown.endTime).toBe('07:10:00');
    const bad = await jean.api('PATCH', `/api/rundowns/${rundown.id}`, {
      version: rundown.version,
      startTime: '07:30',
    });
    expect(bad.json()).toEqual({ error: 'end_before_start', message: expect.any(String) });
    const cleared = await jean.api('PATCH', `/api/rundowns/${rundown.id}`, {
      version: rundown.version,
      endTime: null,
    });
    expect((cleared.json() as Rundown).endTime).toBeNull();
    const copy = await jean.api('POST', `/api/rundowns/${rundown.id}/duplicate`, {
      ownerId: jean.id,
      airDate: '2026-11-04',
    });
    expect((copy.json() as Rundown).endTime).toBeNull();
  });

  it('modèles : enregistrée, copiée dans les conducteurs créés', async () => {
    const { jean, rundown } = await start();
    const tpl = (
      await jean.api('POST', `/api/rundowns/${rundown.id}/save-as-template`, { ownerId: jean.id })
    ).json() as Template;
    expect(tpl.endTime).toBe('07:10:00');
    const bad = await jean.api('PATCH', `/api/templates/${tpl.id}`, {
      version: tpl.version,
      endTime: '06:00',
    });
    expect(bad.statusCode).toBe(400);
    const res = await jean.api('POST', `/api/templates/${tpl.id}/create-rundowns`, {
      from: '2026-11-10',
      to: '2026-11-10',
    });
    const id = res.json().created[0].rundownId as number;
    expect(((await jean.api('GET', `/api/rundowns/${id}`)).json() as Rundown).endTime).toBe(
      '07:10:00',
    );
  });
});

describe('déroulé d’antenne', () => {
  it('démarre à l’affichage pendant l’émission ; préparation comptée à l’heure de début', async () => {
    const { kiosk, rundown } = await start();
    // 20 min avant : hors fenêtre, rien.
    at(SHOW - 20 * MIN);
    await show(kiosk, rundown.id, 'a');
    expect(run()).toBeNull();
    // 5 min avant : déroulé démarré, élément compté à 7 h ; seul le dernier affiché compte.
    at(SHOW - 5 * MIN);
    await show(kiosk, rundown.id, 'a');
    at(SHOW - 4 * MIN);
    await show(kiosk, rundown.id, 'b');
    expect(run()).toMatchObject({
      rundownId: rundown.id,
      rehearsal: false,
      baseAt: SHOW,
      endAt: SHOW + 10 * MIN,
      passages: [{ uid: 'b', at: SHOW, source: 'screen' }],
    });
    expect(actions()).toContain('run.started');
  });

  it('pointe le premier passage seulement ; sortie puis retour', async () => {
    const { kiosk, rundown } = await start();
    at(SHOW + 10 * S);
    await show(kiosk, rundown.id, 'a');
    at(SHOW + 80 * S);
    await show(kiosk, rundown.id, 'b');
    // Retour sur « a » (relire) : pas de nouveau passage.
    at(SHOW + 90 * S);
    await show(kiosk, rundown.id, 'a');
    expect(run()!.passages).toEqual([
      { uid: 'a', at: SHOW + 10 * S, source: 'screen' },
      { uid: 'b', at: SHOW + 80 * S, source: 'screen' },
    ]);
    at(SHOW + 100 * S);
    await kiosk('POST', '/api/prompter', { scriptId: null });
    const id = run()!.id;
    expect(built.ctx.repos.runs.findById(id)!.leftAt).toBe(SHOW + 100 * S);
    at(SHOW + 110 * S);
    await show(kiosk, rundown.id, 'song');
    expect(built.ctx.repos.runs.findById(id)!.leftAt).toBeNull();
  });

  it('pointe un titre musical lancé par l’automation (artiste + titre, sans accents)', async () => {
    const { kiosk, rundown } = await start();
    at(SHOW + 5 * S);
    await show(kiosk, rundown.id, 'a');
    const track: Track = {
      title: 'ete indien',
      artist: 'JOE  DASSIN',
      durationMs: 180_000,
      startedAt: SHOW + 70 * S,
      introMs: null,
      outroMs: null,
    };
    at(SHOW + 71 * S);
    built.ctx.air.update(1, { nowPlaying: track });
    expect(run()!.passages.at(-1)).toEqual({
      uid: 'song',
      at: SHOW + 70 * S,
      source: 'automation',
    });
    // Le prompteur n'a pas bougé.
    expect(built.ctx.repos.prompter.get(1).itemUid).toBe('a');
  });

  it('bascule active : seul le direct pointe', async () => {
    const { admin, kiosk, rundown } = await start();
    await admin('PUT', '/api/settings', {
      airSwitch: { enabled: true, liveSource: 'radiodj', offAirSource: 'azuracast', force: 'auto' },
    });
    at(SHOW + 5 * S);
    await show(kiosk, rundown.id, 'a');
    built.ctx.air.update(1, {
      live: null,
      nowPlaying: {
        title: 'Été Indien',
        artist: 'Joe Dassin',
        durationMs: 1,
        startedAt: SHOW + 6 * S,
        introMs: null,
        outroMs: null,
      },
    });
    expect(run()!.passages.map((p) => p.uid)).toEqual(['a']);
  });

  it('modification en direct : éléments, retirés gardés pour le bilan', async () => {
    const { kiosk, jean, rundown } = await start();
    at(SHOW + 5 * S);
    await show(kiosk, rundown.id, 'a');
    at(SHOW + 60 * S);
    await show(kiosk, rundown.id, 'b');
    const saved = await jean.api('PATCH', `/api/rundowns/${rundown.id}`, {
      version: rundown.version,
      items: [ITEMS[1], item('new', { durationSeconds: 30 }), ITEMS[2], ITEMS[3]],
    });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(run()!.items.map((i) => i.uid)).toEqual(['b', 'new', 'song', 'd']);
    const rec = built.ctx.repos.runs.findById(run()!.id)!;
    expect(rec.snapshot.removed.map((i) => i.uid)).toEqual(['a']);
  });

  it('un autre conducteur démarre : le précédent est clos, et ne se rouvre pas', async () => {
    const { kiosk, jean, rundown } = await start();
    at(SHOW + 5 * S);
    await show(kiosk, rundown.id, 'a');
    const first = run()!.id;
    const other = (
      await jean.api('POST', '/api/rundowns', {
        ownerId: jean.id,
        title: 'Journal',
        airDate: '2026-11-03',
        startTime: '07:05',
        items: [item('j')],
      })
    ).json() as Rundown;
    at(SHOW + 5 * MIN);
    await show(kiosk, other.id, 'j');
    expect(run()!.rundownId).toBe(other.id);
    expect(built.ctx.repos.runs.findById(first)!.endedAt).toBe(SHOW + 5 * MIN);
    // Retour sur le premier conducteur : son déroulé est clos, il ne repart pas.
    at(SHOW + 6 * MIN);
    await show(kiosk, rundown.id, 'b');
    expect(run()!.rundownId).toBe(other.id);
  });

  it('clôture automatique 30 min après la fin', async () => {
    const { kiosk, rundown } = await start();
    at(SHOW + 5 * S);
    await show(kiosk, rundown.id, 'a');
    at(SHOW + 39 * MIN);
    built.ctx.runs.tick();
    expect(run()).not.toBeNull();
    at(SHOW + 41 * MIN);
    built.ctx.runs.tick();
    expect(run()).toBeNull();
    expect(actions()).toContain('run.closed');
  });

  it('« Clore l’émission » : propriétaire, réalisateur, admin ; pas un collègue', async () => {
    const { kiosk, admin, zoe, rundown } = await start();
    at(SHOW + 5 * S);
    await show(kiosk, rundown.id, 'a');
    const id = run()!.id;
    expect((await zoe('POST', `/api/runs/${id}/close`)).statusCode).toBe(403);
    expect((await kiosk('POST', `/api/runs/${id}/close`)).statusCode).toBe(403);
    expect((await admin('POST', `/api/runs/${id}/close`)).statusCode).toBe(204);
    expect(run()).toBeNull();
    expect((await admin('POST', `/api/runs/${id}/close`)).json().error).toBe('run_closed');
  });
});

describe('bilan d’émission', () => {
  it('prévu / réel, figé après la clôture, main courante jointe', async () => {
    const { kiosk, jean, paul, rundown } = await start();
    at(SHOW + 10 * S);
    await show(kiosk, rundown.id, 'a');
    at(SHOW + 90 * S);
    await show(kiosk, rundown.id, 'b');
    await paul.api('POST', '/api/regie/logbook', { text: 'Invité en retard' });
    at(SHOW + 300 * S);
    await kiosk('POST', '/api/prompter', { scriptId: null });
    at(SHOW + 400 * S);
    expect((await paul.api('POST', `/api/runs/${run()!.id}/close`)).statusCode).toBe(204);
    // Conducteur modifié après coup : le bilan ne bouge pas.
    await jean.api('PATCH', `/api/rundowns/${rundown.id}`, {
      version: rundown.version,
      items: [item('zz')],
    });
    const view = (
      await jean.api('GET', `/api/rundowns/${rundown.id}/report`)
    ).json() as RundownReportView;
    expect(view.active).toBe(false);
    expect(view.canClose).toBe(false);
    const lines = view.report!.lines;
    expect(lines.map((l) => l.uid)).toEqual(['a', 'b', 'song', 'd']);
    expect(lines[0]).toMatchObject({ plannedAt: SHOW, actualAt: SHOW + 10 * S, actualSeconds: 80 });
    // b : jusqu'à la sortie de l'écran.
    expect(lines[1]).toMatchObject({ actualSeconds: 210 });
    expect(lines[2]).toMatchObject({ actualAt: null });
    expect(view.report!.imposedEnd).toBe(SHOW + 10 * MIN);
    // Le journal est daté par SQLite (horloge réelle, non simulée ici) : la note rattachée au
    // conducteur est jointe quelle que soit son heure.
    expect(view.logbook.map((e) => e.action)).toContain('logbook.note');
  });

  it('jamais passé : pas de bilan ; écran studio refusé', async () => {
    const { jean, kiosk, rundown } = await start();
    const view = (
      await jean.api('GET', `/api/rundowns/${rundown.id}/report`)
    ).json() as RundownReportView;
    expect(view.report).toBeNull();
    expect((await kiosk('GET', `/api/rundowns/${rundown.id}/report`)).statusCode).toBe(401);
  });
});

describe('répétition', () => {
  it('lancée depuis l’écran studio : premier élément affiché, heures depuis le lancement', async () => {
    const { kiosk, rundown } = await start();
    at(SHOW - 3 * 60 * MIN);
    const res = await kiosk('POST', '/api/rehearsal', { rundownId: rundown.id });
    expect(res.statusCode, res.body).toBe(201);
    expect(built.ctx.repos.prompter.get(1)).toMatchObject({ rundownId: rundown.id, itemUid: 'a' });
    const now = SHOW - 3 * 60 * MIN;
    expect(run()).toMatchObject({
      rehearsal: true,
      baseAt: now,
      endAt: now + 10 * MIN,
      passages: [{ uid: 'a', at: now, source: 'screen' }],
    });
    // Le On Air n'est pas touché ; aucun pointage par l'automation.
    expect(built.ctx.air.get(1).state.onAir.on).toBe(false);
    built.ctx.air.update(1, {
      nowPlaying: {
        title: 'Été Indien',
        artist: 'Joe Dassin',
        durationMs: 1,
        startedAt: now,
        introMs: null,
        outroMs: null,
      },
    });
    expect(run()!.passages).toHaveLength(1);
    at(now + 70 * S);
    await show(kiosk, rundown.id, 'b');
    at(now + 200 * S);
    expect((await kiosk('DELETE', '/api/rehearsal')).statusCode).toBe(204);
    expect(run()).toBeNull();
  });

  it('durées mesurées, 5 dernières conservées, absente du bilan et de la main courante', async () => {
    const { kiosk, jean, rundown } = await start();
    let now = SHOW - 3 * 60 * MIN;
    for (let n = 0; n < 6; n++) {
      at(now);
      await kiosk('POST', '/api/rehearsal', { rundownId: rundown.id });
      at(now + 70 * S);
      await show(kiosk, rundown.id, 'b');
      at(now + 100 * S);
      await kiosk('DELETE', '/api/rehearsal');
      now += 5 * MIN;
    }
    const list = (
      await jean.api('GET', `/api/rundowns/${rundown.id}/rehearsals`)
    ).json() as RehearsalSummary[];
    expect(list).toHaveLength(5);
    expect(list[0]!.items.slice(0, 2)).toEqual([
      { uid: 'a', title: 'Élément a', plannedSeconds: 60, measuredSeconds: 70 },
      { uid: 'b', title: 'Élément b', plannedSeconds: 120, measuredSeconds: 30 },
    ]);
    const view = (
      await jean.api('GET', `/api/rundowns/${rundown.id}/report`)
    ).json() as RundownReportView;
    expect(view.report).toBeNull();
    const logbook = built.ctx.repos.audit.logbook(1, rundown.id, 0, Date.now() + MIN);
    expect(logbook.some((e) => e.action.startsWith('rehearsal.'))).toBe(false);
  });

  it('refusée pendant une émission, On Air allumé ; arrêtée à l’allumage du On Air', async () => {
    const { kiosk, jean, rundown } = await start();
    at(SHOW + MIN);
    expect((await kiosk('POST', '/api/rehearsal', { rundownId: rundown.id })).json().error).toBe(
      'rehearsal_on_air',
    );
    at(SHOW - 3 * 60 * MIN);
    built.ctx.onAir.set(1, 'on', 'manual', null);
    expect((await jean.api('POST', '/api/rehearsal', { rundownId: rundown.id })).statusCode).toBe(
      409,
    );
    built.ctx.onAir.set(1, 'off', 'manual', null);
    expect((await jean.api('POST', '/api/rehearsal', { rundownId: rundown.id })).statusCode).toBe(
      201,
    );
    built.ctx.onAir.set(1, 'on', 'manual', null);
    expect(run()).toBeNull();
  });

  it('arrêtée quand une émission commence ; écran studio désactivable', async () => {
    const { admin, kiosk, jean, rundown } = await start();
    at(SHOW - 60 * MIN);
    await jean.api('POST', '/api/rehearsal', { rundownId: rundown.id });
    at(SHOW - 9 * MIN);
    built.ctx.runs.tick();
    expect(run()).toBeNull();
    at(SHOW - 3 * 60 * MIN);
    const settings = (await admin('GET', '/api/settings')).json();
    await admin('PUT', '/api/settings', {
      timeTracking: { ...settings.timeTracking, kioskRehearsal: false },
    });
    expect((await kiosk('POST', '/api/rehearsal', { rundownId: rundown.id })).json().error).toBe(
      'rehearsal_kiosk_disabled',
    );
    expect((await jean.api('POST', '/api/rehearsal', { rundownId: rundown.id })).statusCode).toBe(
      201,
    );
  });
});

describe('migration 12', () => {
  it('conducteurs et modèles existants sans fin imposée', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oad-m12-'));
    const db = openDatabase(dir, () => {}, migrations.slice(0, 11));
    db.prepare(
      `INSERT INTO rundowns (owner_id, title, air_date, start_time) VALUES (NULL, 'Ancien', '2026-01-01', '07:00:00')`,
    ).run();
    db.close();
    const after = openDatabase(dir);
    expect(after.prepare('SELECT end_time FROM rundowns').get()).toEqual({ end_time: null });
    expect(after.prepare('SELECT COUNT(*) AS n FROM rundown_runs').get()).toEqual({ n: 0 });
    after.close();
    fs.rmSync(dir, { recursive: true });
  });
});
