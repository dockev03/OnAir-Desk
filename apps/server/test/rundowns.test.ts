import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  PrompterState,
  Rundown,
  RundownItemInput,
  RundownList,
  Script,
  ScriptDoc,
  TrashItem,
} from '@onair-desk/shared';
import type { App } from '../src/app.js';
import { todayIn } from '../src/rundowns.js';
import { client, cookieFrom, createTestApp, createUser, setupAdmin } from './helpers.js';

let built: App;
let admin: string;
let jean: { id: number; cookie: string };
let paul: { id: number; cookie: string };

beforeEach(async () => {
  built = await createTestApp();
  admin = await setupAdmin(built);
  jean = await createUser(built, admin, 'jean');
  paul = await createUser(built, admin, 'paul');
});
afterEach(() => {
  vi.useRealTimers();
  return built.app.close();
});

const doc = (words: number, cueSeconds?: number): ScriptDoc => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: Array.from({ length: words }, () => 'mot').join(' ') },
        ...(cueSeconds
          ? [
              {
                type: 'cue' as const,
                attrs: { cueId: 'jingle', label: 'JINGLE', seconds: cueSeconds },
              },
            ]
          : []),
      ],
    },
  ],
});

async function newScript(cookie: string, ownerId: number | null, words = 150, cue?: number) {
  const res = await client(built.app, cookie)('POST', '/api/scripts', {
    ownerId,
    title: 'Lancement',
    content: doc(words, cue),
    speedWpm: 150,
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as Script;
}

const item = (uid: string, over: Partial<RundownItemInput> = {}): RundownItemInput => ({
  uid,
  typeId: 'jingle',
  title: `Élément ${uid}`,
  durationSeconds: 10,
  notes: '',
  scriptId: null,
  artist: '',
  year: null,
  introSeconds: null,
  tags: [],
  cuttable: false,
  ...over,
});

async function newRundown(cookie: string, ownerId: number | null, items: RundownItemInput[] = []) {
  const res = await client(built.app, cookie)('POST', '/api/rundowns', {
    ownerId,
    title: 'La matinale',
    airDate: '2026-10-22',
    startTime: '07:00',
    items,
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as Rundown;
}

async function deviceCookie() {
  const { token } = (await client(built.app, admin)('POST', '/api/devices', { name: 'Pi' })).json();
  return cookieFrom(await client(built.app)('POST', '/api/kiosk/pair', { token }), 'oad_device');
}

const state = async () =>
  (await client(built.app, admin)('GET', '/api/prompter')).json() as PrompterState;

describe('conducteurs : contenu et durées', () => {
  it('calcule les durées depuis les scripts (lecture + repères) et les heures', async () => {
    const s = await newScript(jean.cookie, jean.id, 150, 12);
    expect(s.cueSeconds).toBe(12);
    const r = await newRundown(jean.cookie, jean.id, [
      item('a'),
      item('b', { typeId: 'chronique', durationSeconds: null, scriptId: s.id }),
      item('c', { typeId: 'titre', durationSeconds: 248 }),
    ]);
    expect(r.startTime).toBe('07:00:00');
    expect(r.items.map((i) => i.uid)).toEqual(['a', 'b', 'c']);
    expect(r.items[1]!.script).toMatchObject({ title: 'Lancement', cueSeconds: 12 });
    // 10 + (150 mots à 150 mots/min = 60 s + 12 s de jingle) + 248
    expect(r.totalSeconds).toBe(330);
    expect(r.canWrite).toBe(true);
  });

  it('enregistre la liste complète dans le nouvel ordre, avec contrôle de version', async () => {
    const r = await newRundown(jean.cookie, jean.id, [item('a'), item('b'), item('c')]);
    const c = client(built.app, jean.cookie);
    const saved = await c('PATCH', `/api/rundowns/${r.id}`, {
      version: r.version,
      items: [item('c'), item('a')],
    });
    expect(saved.statusCode, saved.body).toBe(200);
    expect((saved.json() as Rundown).items.map((i) => i.uid)).toEqual(['c', 'a']);

    const stale = await c('PATCH', `/api/rundowns/${r.id}`, { version: r.version, title: 'x' });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toBe('version_conflict');
  });

  it('refuse un type inconnu, un script inexistant ou en corbeille', async () => {
    const c = client(built.app, jean.cookie);
    const base = { ownerId: jean.id, title: 'T', airDate: '2026-10-22', startTime: '07:00' };
    const badType = await c('POST', '/api/rundowns', {
      ...base,
      items: [item('a', { typeId: 'x' })],
    });
    expect(badType.json().error).toBe('unknown_item_type');
    const badScript = await c('POST', '/api/rundowns', {
      ...base,
      items: [item('a', { scriptId: 9999 })],
    });
    expect(badScript.json().error).toBe('unknown_script');
    const s = await newScript(jean.cookie, jean.id);
    await c('DELETE', `/api/scripts/${s.id}`);
    const trashed = await c('POST', '/api/rundowns', {
      ...base,
      items: [item('a', { scriptId: s.id })],
    });
    expect(trashed.json().error).toBe('unknown_script');
  });

  it('un conducteur ancien reste enregistrable (type retiré, script mis à la corbeille)', async () => {
    const s = await newScript(jean.cookie, jean.id);
    const r = await newRundown(jean.cookie, jean.id, [
      item('a', { typeId: 'meteo', scriptId: s.id }),
    ]);
    await client(built.app, admin)('PUT', '/api/settings', {
      itemTypes: [{ id: 'jingle', label: 'Jingle', color: '#2C2C2A' }],
    });
    await client(built.app, jean.cookie)('DELETE', `/api/scripts/${s.id}`);
    const res = await client(built.app, jean.cookie)('PATCH', `/api/rundowns/${r.id}`, {
      version: r.version,
      items: [item('a', { typeId: 'meteo', scriptId: s.id }), item('b')],
    });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as Rundown).items[0]!.script?.deleted).toBe(true);
  });

  it('script supprimé définitivement : l’élément reste, sans script', async () => {
    const s = await newScript(jean.cookie, jean.id);
    const r = await newRundown(jean.cookie, jean.id, [item('a', { scriptId: s.id })]);
    const c = client(built.app, jean.cookie);
    await c('DELETE', `/api/scripts/${s.id}`);
    await c('DELETE', `/api/trash/${s.id}`);
    const after = (await c('GET', `/api/rundowns/${r.id}`)).json() as Rundown;
    expect(after.items[0]).toMatchObject({ uid: 'a', scriptId: null, script: null });
  });
});

describe('conducteurs : détails des éléments et notes générales', () => {
  it('enregistre artiste, année, intro, étiquettes, élément à couper et notes', async () => {
    const r = await newRundown(jean.cookie, jean.id, [item('a')]);
    // Champs facultatifs à la création : valeurs par défaut.
    expect(r.notes).toBe('');
    expect(r.items[0]).toMatchObject({
      artist: '',
      year: null,
      introSeconds: null,
      tags: [],
      cuttable: false,
    });
    const res = await client(built.app, jean.cookie)('PATCH', `/api/rundowns/${r.id}`, {
      version: r.version,
      notes: 'Prises d’antenne entre 45 s et 1 min.',
      items: [
        item('a', {
          title: 'One More Time',
          artist: 'Daft Punk',
          year: 2000,
          introSeconds: 12,
          tags: ['fr'],
          cuttable: true,
        }),
      ],
    });
    expect(res.statusCode, res.body).toBe(200);
    const saved = (await client(built.app, jean.cookie)('GET', `/api/rundowns/${r.id}`)).json();
    expect(saved.notes).toBe('Prises d’antenne entre 45 s et 1 min.');
    expect(saved.items[0]).toMatchObject({
      artist: 'Daft Punk',
      year: 2000,
      introSeconds: 12,
      tags: ['fr'],
      cuttable: true,
    });
  });

  it('refuse une étiquette inconnue ; une étiquette retirée depuis reste acceptée', async () => {
    const c = client(built.app, jean.cookie);
    const base = { ownerId: jean.id, title: 'T', airDate: '2026-10-22', startTime: '07:00' };
    const bad = await c('POST', '/api/rundowns', { ...base, items: [item('a', { tags: ['x'] })] });
    expect(bad.json().error).toBe('unknown_item_tag');

    const r = await newRundown(jean.cookie, jean.id, [item('a', { tags: ['fr'] })]);
    await client(built.app, admin)('PUT', '/api/settings', { itemTags: [] });
    const kept = await c('PATCH', `/api/rundowns/${r.id}`, {
      version: r.version,
      items: [item('a', { tags: ['fr'] }), item('b')],
    });
    expect(kept.statusCode, kept.body).toBe(200);
  });

  it('la duplication reprend les détails et les notes', async () => {
    const c = client(built.app, jean.cookie);
    const r = await newRundown(jean.cookie, jean.id, [
      item('a', { artist: 'Gala', cuttable: true }),
    ]);
    await c('PATCH', `/api/rundowns/${r.id}`, { version: r.version, notes: 'Règles' });
    const copy = await c('POST', `/api/rundowns/${r.id}/duplicate`, {
      ownerId: jean.id,
      airDate: '2026-10-29',
    });
    expect(copy.statusCode, copy.body).toBe(201);
    expect(copy.json()).toMatchObject({ notes: 'Règles' });
    expect(copy.json().items[0]).toMatchObject({ artist: 'Gala', cuttable: true });
  });

  it('copie de l’écran studio antérieure aux détails : champs complétés', async () => {
    const r = await newRundown(jean.cookie, jean.id, [item('a')]);
    await client(built.app, jean.cookie)('POST', '/api/prompter', {
      rundownId: r.id,
      itemUid: 'a',
    });
    const old = {
      id: r.id,
      ownerId: jean.id,
      title: r.title,
      airDate: r.airDate,
      startTime: r.startTime,
      items: [
        {
          uid: 'a',
          typeId: 'jingle',
          title: 'Ancien',
          durationSeconds: 10,
          notes: '',
          scriptId: null,
          script: null,
        },
      ],
    };
    built.ctx.repos.db
      .prepare('UPDATE prompter_state SET rundown_snapshot = ?')
      .run(JSON.stringify(old));
    expect((await state()).rundown?.items[0]).toMatchObject({
      title: 'Ancien',
      artist: '',
      year: null,
      introSeconds: null,
      tags: [],
      cuttable: false,
    });
  });
});

describe('conducteurs : droits', () => {
  it('un animateur lit chez un collègue sans pouvoir modifier', async () => {
    const r = await newRundown(jean.cookie, jean.id, [item('a')]);
    const asPaul = client(built.app, paul.cookie);
    const read = await asPaul('GET', `/api/rundowns/${r.id}`);
    expect(read.json().canWrite).toBe(false);
    expect(
      (await asPaul('PATCH', `/api/rundowns/${r.id}`, { version: 1, title: 'pirate' })).statusCode,
    ).toBe(403);
    expect((await asPaul('DELETE', `/api/rundowns/${r.id}`)).statusCode).toBe(403);
    expect(
      (
        await asPaul('POST', '/api/rundowns', {
          ownerId: jean.id,
          title: 'x',
          airDate: '2026-10-22',
          startTime: '07:00',
        })
      ).statusCode,
    ).toBe(403);
    // Commun : tout le monde écrit ; l'admin écrit partout.
    expect((await newRundown(paul.cookie, null)).canWrite).toBe(true);
    const asAdmin = await client(built.app, admin)('PATCH', `/api/rundowns/${r.id}`, {
      version: r.version,
      title: 'Corrigé',
    });
    expect(asAdmin.statusCode).toBe(200);
  });

  it('l’écran studio lit mais ne modifie pas', async () => {
    const r = await newRundown(jean.cookie, jean.id, [item('a')]);
    const pi = client(built.app, await deviceCookie());
    expect((await pi('GET', '/api/rundowns')).statusCode).toBe(200);
    expect((await pi('GET', `/api/rundowns/${r.id}`)).json().canWrite).toBe(false);
    expect(
      (await pi('PATCH', `/api/rundowns/${r.id}`, { version: 1, title: 'x' })).statusCode,
    ).toBe(403);
    expect((await pi('POST', `/api/rundowns/${r.id}/duplicate`, {})).statusCode).toBe(403);
  });
});

describe('conducteurs : liste, duplication, corbeille', () => {
  it('liste triée par date et heure, avec la date du jour de la station', async () => {
    const c = client(built.app, jean.cookie);
    for (const [airDate, startTime] of [
      ['2026-10-23', '07:00'],
      ['2026-10-22', '18:00'],
      ['2026-10-22', '07:00'],
    ]) {
      await c('POST', '/api/rundowns', { ownerId: jean.id, title: airDate, airDate, startTime });
    }
    const list = (await c('GET', '/api/rundowns')).json() as RundownList;
    expect(list.rundowns.map((r) => `${r.airDate} ${r.startTime}`)).toEqual([
      '2026-10-22 07:00:00',
      '2026-10-22 18:00:00',
      '2026-10-23 07:00:00',
    ]);
    expect(list.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('date du jour dans le fuseau de la station', () => {
    // 23 h 30 UTC le 21 : déjà le 22 à Paris (UTC+2), encore le 21 à New York.
    const at = new Date('2026-10-21T23:30:00Z');
    expect(todayIn('Europe/Paris', at)).toBe('2026-10-22');
    expect(todayIn('America/New_York', at)).toBe('2026-10-21');
  });

  it('duplique à une autre date avec les mêmes scripts, chez soi', async () => {
    const s = await newScript(jean.cookie, jean.id);
    const r = await newRundown(jean.cookie, jean.id, [item('a', { scriptId: s.id }), item('b')]);
    const res = await client(built.app, paul.cookie)('POST', `/api/rundowns/${r.id}/duplicate`, {
      ownerId: paul.id,
      airDate: '2026-10-29',
    });
    expect(res.statusCode, res.body).toBe(201);
    const copy = res.json() as Rundown;
    expect(copy).toMatchObject({ ownerId: paul.id, airDate: '2026-10-29', title: 'La matinale' });
    expect(copy.items.map((i) => [i.uid, i.scriptId])).toEqual([
      ['a', s.id],
      ['b', null],
    ]);
  });

  it('corbeille : liste commune, restauration, suppression définitive, purge à 30 jours', async () => {
    const r = await newRundown(jean.cookie, jean.id, [item('a')]);
    const c = client(built.app, jean.cookie);
    expect((await c('DELETE', `/api/rundowns/${r.id}`)).statusCode).toBe(204);
    expect((await c('GET', `/api/rundowns/${r.id}`)).statusCode).toBe(404);
    const trash = (await c('GET', '/api/trash')).json() as TrashItem[];
    expect(trash).toMatchObject([{ kind: 'rundown', id: r.id, itemCount: 1 }]);
    expect((await client(built.app, paul.cookie)('GET', '/api/trash')).json()).toEqual([]);

    expect((await c('POST', `/api/trash/rundowns/${r.id}/restore`)).statusCode).toBe(200);
    expect((await c('GET', `/api/rundowns/${r.id}`)).statusCode).toBe(200);

    await c('DELETE', `/api/rundowns/${r.id}`);
    expect((await c('DELETE', `/api/trash/rundowns/${r.id}`)).statusCode).toBe(204);
    expect(built.ctx.repos.rundowns.findById(r.id)).toBeUndefined();

    const old = await newRundown(jean.cookie, jean.id);
    await c('DELETE', `/api/rundowns/${old.id}`);
    expect(built.ctx.repos.rundowns.purgeTrash(Date.now() + 31 * 24 * 3600_000)).toEqual([old.id]);
  });
});

describe('conducteurs : écran studio', () => {
  it('l’afficheur choisit un élément ; le script de l’élément est affiché', async () => {
    const s = await newScript(jean.cookie, jean.id);
    const r = await newRundown(jean.cookie, jean.id, [
      item('a'),
      item('b', { scriptId: s.id, durationSeconds: null }),
    ]);
    const pi = client(built.app, await deviceCookie());
    const res = await pi('POST', '/api/prompter', { rundownId: r.id, itemUid: 'b' });
    expect(res.statusCode, res.body).toBe(200);
    expect(await state()).toMatchObject({
      script: { id: s.id },
      rundown: { id: r.id, title: 'La matinale' },
      itemUid: 'b',
      sentByName: 'Pi',
    });

    // Élément sans script : carte seule, le conducteur reste suivi.
    await pi('POST', '/api/prompter', { rundownId: r.id, itemUid: 'a' });
    expect(await state()).toMatchObject({ script: null, itemUid: 'a', rundown: { id: r.id } });

    expect(
      (await pi('POST', '/api/prompter', { rundownId: r.id, itemUid: 'zz' })).json(),
    ).toMatchObject({
      error: 'unknown_item',
    });
    expect((await pi('POST', '/api/prompter', { rundownId: 999, itemUid: 'a' })).statusCode).toBe(
      404,
    );
  });

  it('un script seul remet le conducteur à zéro', async () => {
    const s = await newScript(jean.cookie, jean.id);
    const r = await newRundown(jean.cookie, jean.id, [item('a')]);
    const c = client(built.app, jean.cookie);
    await c('POST', '/api/prompter', { rundownId: r.id, itemUid: 'a' });
    await c('POST', '/api/prompter', { scriptId: s.id });
    expect(await state()).toMatchObject({ script: { id: s.id }, rundown: null, itemUid: null });
  });

  it('le conducteur suivi se met à jour (édition, script modifié, corbeille)', async () => {
    const s = await newScript(jean.cookie, jean.id, 150);
    const r = await newRundown(jean.cookie, jean.id, [
      item('a', { scriptId: s.id, durationSeconds: null }),
    ]);
    const c = client(built.app, jean.cookie);
    await c('POST', '/api/prompter', { rundownId: r.id, itemUid: 'a' });

    await c('PATCH', `/api/rundowns/${r.id}`, {
      version: r.version,
      items: [item('a', { scriptId: s.id, durationSeconds: null }), item('n')],
    });
    expect((await state()).rundown?.items.map((i) => i.uid)).toEqual(['a', 'n']);

    await c('PATCH', `/api/scripts/${s.id}`, { version: s.version, content: doc(300, 5) });
    const after = await state();
    expect(after.rundown?.items[0]!.script).toMatchObject({ wordCount: 300, cueSeconds: 5 });
    expect(after.script?.version).toBe(s.version + 1);

    // Corbeille : la copie reste affichée (jamais d'écran blanc).
    await c('DELETE', `/api/rundowns/${r.id}`);
    expect((await state()).rundown?.id).toBe(r.id);
  });
});
