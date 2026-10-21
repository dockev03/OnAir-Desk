import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Library, PrompterState, Script, ScriptDoc } from '@onair-desk/shared';
import type { App } from '../src/app.js';
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

const text = (t: string): ScriptDoc => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }],
});

async function newScript(
  cookie: string,
  ownerId: number | null,
  title = 'Lancement',
  body = 'Bonjour à tous',
) {
  const res = await client(built.app, cookie)('POST', '/api/scripts', {
    ownerId,
    title,
    content: text(body),
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as Script;
}

async function deviceCookie() {
  const { token } = (await client(built.app, admin)('POST', '/api/devices', { name: 'Pi' })).json();
  return cookieFrom(await client(built.app)('POST', '/api/kiosk/pair', { token }), 'oad_device');
}

describe('droits', () => {
  it('un animateur écrit chez lui et dans Commun', async () => {
    const own = await newScript(jean.cookie, jean.id);
    const common = await newScript(jean.cookie, null);
    expect(own.canWrite).toBe(true);
    expect(common.canWrite).toBe(true);
    expect(own.speedWpm).toBe(150);
    expect(own.wordCount).toBe(3);
  });

  it('un animateur lit chez un collègue mais ne peut ni y écrire ni le modifier', async () => {
    const s = await newScript(jean.cookie, jean.id);
    const asPaul = client(built.app, paul.cookie);
    const read = await asPaul('GET', `/api/scripts/${s.id}`);
    expect(read.statusCode).toBe(200);
    expect(read.json().canWrite).toBe(false);

    expect(
      (await asPaul('POST', '/api/scripts', { ownerId: jean.id, title: 'x' })).statusCode,
    ).toBe(403);
    expect(
      (await asPaul('PATCH', `/api/scripts/${s.id}`, { version: 1, title: 'pirate' })).statusCode,
    ).toBe(403);
    expect((await asPaul('DELETE', `/api/scripts/${s.id}`)).statusCode).toBe(403);
    expect((await asPaul('POST', '/api/folders', { ownerId: jean.id, name: 'x' })).statusCode).toBe(
      403,
    );
  });

  it('il peut dupliquer le script d’un collègue chez lui', async () => {
    const s = await newScript(jean.cookie, jean.id, 'Chronique');
    const res = await client(built.app, paul.cookie)('POST', `/api/scripts/${s.id}/duplicate`, {
      ownerId: paul.id,
      title: 'Chronique (copie)',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      ownerId: paul.id,
      title: 'Chronique (copie)',
      canWrite: true,
      wordCount: 3,
    });
  });

  it("l'admin écrit partout", async () => {
    const s = await newScript(jean.cookie, jean.id);
    const res = await client(built.app, admin)('PATCH', `/api/scripts/${s.id}`, {
      version: 1,
      title: 'Corrigé',
    });
    expect(res.statusCode).toBe(200);
  });

  it("l'écran studio lit tout mais n'écrit rien", async () => {
    const s = await newScript(jean.cookie, jean.id);
    const device = client(built.app, await deviceCookie());
    expect((await device('GET', '/api/library')).statusCode).toBe(200);
    expect((await device('GET', `/api/scripts/${s.id}`)).json().canWrite).toBe(false);
    expect((await device('POST', '/api/prompter', { scriptId: s.id })).statusCode).toBe(403);
    expect((await device('GET', '/api/trash')).statusCode).toBe(401);
  });

  it('la bibliothèque présente « moi », Commun, puis les collègues', async () => {
    const lib = (await client(built.app, jean.cookie)('GET', '/api/library')).json() as Library;
    expect(lib.owners[0]).toMatchObject({ id: jean.id, isMe: true, canWrite: true });
    expect(lib.owners[1]).toMatchObject({ id: null, canWrite: true });
    expect(lib.owners.find((o) => o.id === paul.id)).toMatchObject({ canWrite: false });
  });

  it('un compte qui possède des scripts ne peut pas être supprimé (seulement désactivé)', async () => {
    await newScript(jean.cookie, jean.id);
    const res = await client(built.app, admin)('DELETE', `/api/users/${jean.id}`);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('user_has_content');
  });
});

describe('contenu et enregistrement', () => {
  it('refuse un contenu hors liste blanche', async () => {
    const res = await client(built.app, jean.cookie)('POST', '/api/scripts', {
      ownerId: jean.id,
      title: 'x',
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'x',
                marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
              },
            ],
          },
        ],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('refuse une version périmée (modification simultanée)', async () => {
    const s = await newScript(jean.cookie, null);
    const ok = await client(built.app, paul.cookie)('PATCH', `/api/scripts/${s.id}`, {
      version: 1,
      content: text('Version de Paul'),
    });
    expect(ok.json().version).toBe(2);
    const stale = await client(built.app, jean.cookie)('PATCH', `/api/scripts/${s.id}`, {
      version: 1,
      content: text('Version de Jean'),
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toBe('version_conflict');
  });

  it('range un script dans un dossier du même propriétaire seulement', async () => {
    const folder = (
      await client(built.app, paul.cookie)('POST', '/api/folders', {
        ownerId: paul.id,
        name: 'Chroniques',
      })
    ).json();
    const res = await client(built.app, jean.cookie)('POST', '/api/scripts', {
      ownerId: jean.id,
      folderId: folder.id,
      title: 'x',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('bad_folder');
  });
});

describe('dossiers', () => {
  it('refuse les boucles et la suppression d’un dossier non vide', async () => {
    const c = client(built.app, jean.cookie);
    const a = (await c('POST', '/api/folders', { ownerId: jean.id, name: 'A' })).json();
    const b = (
      await c('POST', '/api/folders', { ownerId: jean.id, parentId: a.id, name: 'B' })
    ).json();
    expect((await c('PATCH', `/api/folders/${a.id}`, { parentId: b.id })).json().error).toBe(
      'folder_cycle',
    );
    expect((await c('DELETE', `/api/folders/${a.id}`)).statusCode).toBe(409);
    expect((await c('DELETE', `/api/folders/${b.id}`)).statusCode).toBe(204);
    expect((await c('DELETE', `/api/folders/${a.id}`)).statusCode).toBe(204);
  });

  it('limite la profondeur', async () => {
    const c = client(built.app, jean.cookie);
    let parentId: number | null = null;
    for (let i = 0; i < 6; i++) {
      parentId = (
        await c('POST', '/api/folders', { ownerId: jean.id, parentId, name: `N${i}` })
      ).json().id;
    }
    const res = await c('POST', '/api/folders', { ownerId: jean.id, parentId, name: 'trop' });
    expect(res.json().error).toBe('too_deep');
  });
});

describe('recherche', () => {
  it('trouve sans tenir compte des accents ni de la casse, et ignore la corbeille', async () => {
    const s = await newScript(
      jean.cookie,
      jean.id,
      'Bulletin',
      'La météo de Vichy sera ensoleillée',
    );
    await newScript(jean.cookie, jean.id, 'Autre', 'Rien à voir');
    const c = client(built.app, paul.cookie);
    const hits = (await c('GET', '/api/scripts?q=METEO vich')).json();
    expect(hits).toHaveLength(1);
    expect(hits[0].snippet).toContain('\u0002météo\u0003');

    await client(built.app, jean.cookie)('DELETE', `/api/scripts/${s.id}`);
    expect((await c('GET', '/api/scripts?q=meteo')).json()).toHaveLength(0);
  });

  it('résiste à une saisie piégée', async () => {
    const res = await client(built.app, jean.cookie)(
      'GET',
      `/api/scripts?q=${encodeURIComponent('" OR * NEAR( ')}`,
    );
    expect(res.statusCode).toBe(200);
  });
});

describe('corbeille', () => {
  it('restaure, supprime définitivement et respecte les droits', async () => {
    const a = await newScript(jean.cookie, jean.id, 'A');
    const b = await newScript(jean.cookie, jean.id, 'B');
    const c = client(built.app, jean.cookie);
    await c('DELETE', `/api/scripts/${a.id}`);
    await c('DELETE', `/api/scripts/${b.id}`);
    expect((await c('GET', `/api/scripts/${a.id}`)).statusCode).toBe(404);

    // Paul ne voit pas la corbeille de Jean.
    expect((await client(built.app, paul.cookie)('GET', '/api/trash')).json()).toHaveLength(0);
    expect(
      (await client(built.app, paul.cookie)('POST', `/api/trash/${a.id}/restore`)).statusCode,
    ).toBe(403);

    const trash = (await c('GET', '/api/trash')).json();
    expect(trash.map((t: { title: string }) => t.title).sort()).toEqual(['A', 'B']);
    expect((await c('POST', `/api/trash/${a.id}/restore`)).statusCode).toBe(200);
    expect((await c('GET', `/api/scripts/${a.id}`)).statusCode).toBe(200);
    expect((await c('DELETE', `/api/trash/${b.id}`)).statusCode).toBe(204);
    expect((await c('GET', '/api/trash')).json()).toHaveLength(0);
  });

  it('restaure à la racine si le dossier d’origine a été supprimé', async () => {
    const c = client(built.app, jean.cookie);
    const folder = (await c('POST', '/api/folders', { ownerId: jean.id, name: 'Temp' })).json();
    const s = (
      await c('POST', '/api/scripts', { ownerId: jean.id, folderId: folder.id, title: 'x' })
    ).json();
    await c('DELETE', `/api/scripts/${s.id}`);
    expect((await c('DELETE', `/api/folders/${folder.id}`)).statusCode).toBe(204);
    expect((await c('POST', `/api/trash/${s.id}/restore`)).json().folderId).toBeNull();
  });

  it('purge les scripts supprimés depuis plus de 30 jours', async () => {
    const s = await newScript(jean.cookie, jean.id);
    await client(built.app, jean.cookie)('DELETE', `/api/scripts/${s.id}`);
    const { scripts } = built.ctx.repos;
    expect(scripts.purgeTrash(Date.now() + 29 * 86_400_000)).toEqual([]);
    expect(scripts.purgeTrash(Date.now() + 31 * 86_400_000)).toEqual([s.id]);
    expect(scripts.findById(s.id)).toBeUndefined();
  });
});

describe('historique', () => {
  const save = (cookie: string, id: number, version: number, body: string) =>
    client(built.app, cookie)('PATCH', `/api/scripts/${id}`, { version, content: text(body) });

  it('conserve une version quand quelqu’un d’autre reprend le script, ou après 10 minutes', async () => {
    const s = await newScript(jean.cookie, null, 'Commun', 'v1');
    const revisions = async () =>
      (await client(built.app, jean.cookie)('GET', `/api/scripts/${s.id}/revisions`)).json();

    await save(jean.cookie, s.id, 1, 'v2 par Jean');
    expect(await revisions()).toHaveLength(0); // même auteur, moins de 10 min

    await save(paul.cookie, s.id, 2, 'v3 par Paul');
    expect(await revisions()).toHaveLength(1); // l'état de Jean est conservé

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 11 * 60_000);
    await save(paul.cookie, s.id, 3, 'v4 par Paul');
    const list = await revisions();
    expect(list).toHaveLength(2);
    expect(list[0].version).toBe(3);
  });

  it('restaure une version en conservant l’état actuel', async () => {
    const s = await newScript(jean.cookie, null, 'Commun', 'texte original');
    await save(paul.cookie, s.id, 1, 'texte modifié');
    const [rev] = (
      await client(built.app, jean.cookie)('GET', `/api/scripts/${s.id}/revisions`)
    ).json();
    const detail = (
      await client(built.app, jean.cookie)('GET', `/api/scripts/${s.id}/revisions/${rev.id}`)
    ).json();
    expect(detail.content).toEqual(text('texte original'));

    const restored = await client(built.app, jean.cookie)(
      'POST',
      `/api/scripts/${s.id}/revisions/${rev.id}/restore`,
      { version: 2 },
    );
    expect(restored.statusCode).toBe(200);
    expect(restored.json().content).toEqual(text('texte original'));
    const after = (
      await client(built.app, jean.cookie)('GET', `/api/scripts/${s.id}/revisions`)
    ).json();
    expect(after[0].version).toBe(2); // « texte modifié » est conservé
  });

  it('ne garde que les 20 dernières versions', async () => {
    const s = await newScript(jean.cookie, null, 'Commun', 'v1');
    const users = [jean.cookie, paul.cookie];
    for (let v = 1; v <= 24; v++) await save(users[v % 2]!, s.id, v, `version ${v + 1}`);
    const list = (
      await client(built.app, jean.cookie)('GET', `/api/scripts/${s.id}/revisions`)
    ).json();
    expect(list).toHaveLength(20);
  });
});

describe('prompteur', () => {
  const state = async () =>
    (await client(built.app, jean.cookie)('GET', '/api/prompter')).json() as PrompterState;

  it('affiche le script envoyé et suit ses modifications', async () => {
    const s = await newScript(jean.cookie, jean.id, 'Lancement', 'Bonjour');
    await client(built.app, paul.cookie)('POST', '/api/prompter', { scriptId: s.id });
    expect(await state()).toMatchObject({
      script: { id: s.id, title: 'Lancement' },
      deleted: false,
      sentByName: 'paul',
    });

    await client(built.app, jean.cookie)('PATCH', `/api/scripts/${s.id}`, {
      version: 1,
      title: 'Lancement v2',
    });
    expect((await state()).script?.title).toBe('Lancement v2');
  });

  it('garde le texte affiché quand le script part à la corbeille', async () => {
    const s = await newScript(jean.cookie, jean.id, 'Lancement', 'Bonjour');
    await client(built.app, jean.cookie)('POST', '/api/prompter', { scriptId: s.id });
    await client(built.app, jean.cookie)('DELETE', `/api/scripts/${s.id}`);
    expect(await state()).toMatchObject({ script: { title: 'Lancement' }, deleted: true });

    await client(built.app, jean.cookie)('POST', `/api/trash/${s.id}/restore`);
    expect((await state()).deleted).toBe(false);

    await client(built.app, jean.cookie)('DELETE', `/api/scripts/${s.id}`);
    await client(built.app, jean.cookie)('DELETE', `/api/trash/${s.id}`);
    expect(await state()).toMatchObject({ script: { title: 'Lancement' }, deleted: true });
  });

  it("vide l'écran avec null, et refuse un script en corbeille", async () => {
    const s = await newScript(jean.cookie, jean.id);
    await client(built.app, jean.cookie)('DELETE', `/api/scripts/${s.id}`);
    expect(
      (await client(built.app, jean.cookie)('POST', '/api/prompter', { scriptId: s.id }))
        .statusCode,
    ).toBe(404);
    await client(built.app, jean.cookie)('POST', '/api/prompter', { scriptId: null });
    expect((await state()).script).toBeNull();
  });
});

describe('paramètres de l’étape 2', () => {
  it('accepte une modification partielle et valide les repères', async () => {
    const c = client(built.app, admin);
    const ok = await c('PUT', '/api/settings', { defaultSpeedWpm: 170, prompterFontSize: 56 });
    expect(ok.json()).toMatchObject({
      defaultSpeedWpm: 170,
      prompterFontSize: 56,
      stationName: 'Radio Test',
    });
    const dup = await c('PUT', '/api/settings', {
      cues: [
        { id: 'a', label: 'A', color: '#FAC775' },
        { id: 'a', label: 'B', color: '#FAC775' },
      ],
    });
    expect(dup.statusCode).toBe(400);
    const s = await newScript(jean.cookie, jean.id);
    expect(s.speedWpm).toBe(170);
  });
});
