import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  CreateFromTemplateResult,
  Rundown,
  RundownItemInput,
  RundownList,
  Template,
  TemplateSummary,
  TrashItem,
} from '@onair-desk/shared';
import type { App } from '../src/app.js';
import { client, createTestApp, createUser, setupAdmin } from './helpers.js';

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
afterEach(() => built.app.close());

const item = (uid: string, over: Partial<RundownItemInput> = {}): RundownItemInput => ({
  uid,
  typeId: 'jingle',
  title: `Élément ${uid}`,
  durationSeconds: 10,
  notes: '',
  scriptId: null,
  ...over,
});

/** Modèle du lundi au vendredi, sans période ni exclusion. */
async function newTemplate(cookie: string, ownerId: number | null, over: object = {}) {
  const res = await client(built.app, cookie)('POST', '/api/templates', {
    ownerId,
    title: 'La matinale',
    startTime: '07:00',
    days: [1, 2, 3, 4, 5],
    items: [item('a'), item('b', { typeId: 'chronique', durationSeconds: 120 })],
    ...over,
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as Template;
}

async function createRundowns(cookie: string, id: number, from: string, to: string) {
  return client(built.app, cookie)('POST', `/api/templates/${id}/create-rundowns`, { from, to });
}

const rundownsOf = async (cookie: string) =>
  ((await client(built.app, cookie)('GET', '/api/rundowns')).json() as RundownList).rundowns;

describe('modèles : enregistrement', () => {
  it('crée, relit et enregistre un modèle avec contrôle de version', async () => {
    const t = await newTemplate(jean.cookie, jean.id, {
      exclusions: [{ from: '2026-11-11', to: '2026-11-11', label: 'Férié' }],
    });
    expect(t).toMatchObject({
      startTime: '07:00:00',
      days: [1, 2, 3, 4, 5],
      active: true,
      itemCount: 2,
      totalSeconds: 130,
      canWrite: true,
    });
    expect(t.exclusions).toEqual([{ from: '2026-11-11', to: '2026-11-11', label: 'Férié' }]);

    const c = client(built.app, jean.cookie);
    const saved = await c('PATCH', `/api/templates/${t.id}`, {
      version: t.version,
      days: [6],
      active: false,
      validFrom: '2026-09-01',
      validUntil: '2027-06-30',
    });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json()).toMatchObject({ days: [6], active: false, validUntil: '2027-06-30' });
    expect((saved.json() as Template).exclusions).toHaveLength(1);

    const stale = await c('PATCH', `/api/templates/${t.id}`, { version: t.version, title: 'x' });
    expect(stale.statusCode).toBe(409);
    const badPeriod = await c('PATCH', `/api/templates/${t.id}`, {
      version: t.version + 1,
      validFrom: '2027-07-01',
    });
    expect(badPeriod.json().error).toBe('valid_period');

    const list = (await c('GET', '/api/templates')).json() as TemplateSummary[];
    expect(list.map((x) => x.id)).toEqual([t.id]);
  });

  it('refuse un type d’élément inconnu', async () => {
    const res = await client(built.app, jean.cookie)('POST', '/api/templates', {
      ownerId: jean.id,
      title: 'X',
      startTime: '07:00',
      days: [1],
      items: [item('a', { typeId: 'inconnu' })],
    });
    expect(res.json().error).toBe('unknown_item_type');
  });

  it('droits : lecture pour tous, écriture sur les siens et Commun, admin partout', async () => {
    const t = await newTemplate(jean.cookie, jean.id);
    const common = await newTemplate(paul.cookie, null);
    const p = client(built.app, paul.cookie);

    const read = await p('GET', `/api/templates/${t.id}`);
    expect(read.statusCode).toBe(200);
    expect((read.json() as Template).canWrite).toBe(false);
    expect(
      (await p('PATCH', `/api/templates/${t.id}`, { version: 1, title: 'x' })).statusCode,
    ).toBe(403);
    expect((await createRundowns(paul.cookie, t.id, '2026-10-26', '2026-10-30')).statusCode).toBe(
      403,
    );
    expect((await p('DELETE', `/api/templates/${t.id}`)).statusCode).toBe(403);
    expect(
      (
        await p('POST', '/api/templates', {
          ownerId: jean.id,
          title: 'x',
          startTime: '07:00',
          days: [1],
        })
      ).statusCode,
    ).toBe(403);

    // Le modèle d'un collègue se duplique chez soi.
    const copy = await p('POST', `/api/templates/${t.id}/duplicate`, { ownerId: paul.id });
    expect(copy.statusCode).toBe(201);
    expect(copy.json()).toMatchObject({ ownerId: paul.id, days: [1, 2, 3, 4, 5], itemCount: 2 });

    const j = client(built.app, jean.cookie);
    expect(
      (await j('PATCH', `/api/templates/${common.id}`, { version: 1, title: 'Commun' })).statusCode,
    ).toBe(200);
    const a = client(built.app, admin);
    expect(
      (await a('PATCH', `/api/templates/${t.id}`, { version: 1, title: 'Admin' })).statusCode,
    ).toBe(200);
  });

  it('corbeille : restaurable, puis suppression définitive ; les conducteurs créés restent', async () => {
    const t = await newTemplate(jean.cookie, jean.id);
    await createRundowns(jean.cookie, t.id, '2026-10-26', '2026-10-27');
    const c = client(built.app, jean.cookie);

    expect((await c('DELETE', `/api/templates/${t.id}`)).statusCode).toBe(204);
    expect((await c('GET', `/api/templates/${t.id}`)).statusCode).toBe(404);
    const trash = (await c('GET', '/api/trash')).json() as TrashItem[];
    expect(trash).toContainEqual(
      expect.objectContaining({ kind: 'template', id: t.id, itemCount: 2 }),
    );
    // Paul ne voit pas la corbeille de Jean.
    expect(
      ((await client(built.app, paul.cookie)('GET', '/api/trash')).json() as TrashItem[]).some(
        (x) => x.kind === 'template',
      ),
    ).toBe(false);

    expect((await c('POST', `/api/trash/templates/${t.id}/restore`)).statusCode).toBe(200);
    expect((await c('DELETE', `/api/templates/${t.id}`)).statusCode).toBe(204);
    expect((await c('DELETE', `/api/trash/templates/${t.id}`)).statusCode).toBe(204);

    const rundowns = await rundownsOf(jean.cookie);
    expect(rundowns).toHaveLength(2);
    expect(rundowns.every((r) => r.templateId === null)).toBe(true);
  });

  it('supprimer un compte qui possède des modèles est refusé proprement', async () => {
    await newTemplate(jean.cookie, jean.id);
    const res = await client(built.app, admin)('DELETE', `/api/users/${jean.id}`);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('user_has_content');
  });
});

describe('modèles : création des conducteurs', () => {
  it('crée un conducteur par jour coché, hors exclusions et hors période', async () => {
    const t = await newTemplate(jean.cookie, jean.id, {
      validUntil: '2026-11-04',
      exclusions: [{ from: '2026-10-28', to: '2026-10-28' }],
    });
    // Du lundi 26 octobre au dimanche 8 novembre.
    const res = await createRundowns(jean.cookie, t.id, '2026-10-26', '2026-11-08');
    expect(res.statusCode, res.body).toBe(200);
    const r = res.json() as CreateFromTemplateResult;
    expect(r.created.map((c) => c.date)).toEqual([
      '2026-10-26',
      '2026-10-27',
      '2026-10-29',
      '2026-10-30',
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
    ]);
    expect(r.existing).toEqual([]);
    expect(r.skipped).toEqual([
      { date: '2026-10-28', reason: 'excluded' },
      { date: '2026-11-05', reason: 'outside' },
      { date: '2026-11-06', reason: 'outside' },
    ]);

    const created = await client(built.app, jean.cookie)(
      'GET',
      `/api/rundowns/${r.created[0]!.rundownId}`,
    );
    expect(created.json()).toMatchObject({
      ownerId: jean.id,
      title: 'La matinale',
      airDate: '2026-10-26',
      startTime: '07:00:00',
      templateId: t.id,
      template: { id: t.id, title: 'La matinale', deleted: false },
      totalSeconds: 130,
    });
  });

  it('idempotente : deux clics ne créent aucun doublon', async () => {
    const t = await newTemplate(jean.cookie, jean.id);
    await createRundowns(jean.cookie, t.id, '2026-10-26', '2026-10-28');
    const again = (await createRundowns(jean.cookie, t.id, '2026-10-26', '2026-10-30')).json();
    expect(again.created.map((c: { date: string }) => c.date)).toEqual([
      '2026-10-29',
      '2026-10-30',
    ]);
    expect(again.existing).toEqual(['2026-10-26', '2026-10-27', '2026-10-28']);
    expect(await rundownsOf(jean.cookie)).toHaveLength(5);
  });

  it('pas de résurrection après corbeille ou déplacement', async () => {
    const t = await newTemplate(jean.cookie, jean.id);
    const first = (
      await createRundowns(jean.cookie, t.id, '2026-10-26', '2026-10-27')
    ).json() as CreateFromTemplateResult;
    const c = client(built.app, jean.cookie);
    const [monday, tuesday] = first.created;
    await c('DELETE', `/api/rundowns/${monday!.rundownId}`);
    const moved = await c('PATCH', `/api/rundowns/${tuesday!.rundownId}`, {
      version: 1,
      airDate: '2026-10-31',
    });
    expect(moved.statusCode).toBe(200);

    const again = (await createRundowns(jean.cookie, t.id, '2026-10-26', '2026-10-27')).json();
    expect(again.created).toEqual([]);
    expect(again.existing).toEqual(['2026-10-26', '2026-10-27']);
  });

  it('modèle suspendu : rien n’est créé ; période trop longue refusée', async () => {
    const t = await newTemplate(jean.cookie, jean.id, { active: false });
    const res = await createRundowns(jean.cookie, t.id, '2026-10-26', '2026-10-30');
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('template_suspended');
    expect(await rundownsOf(jean.cookie)).toHaveLength(0);

    const active = await newTemplate(jean.cookie, jean.id);
    const long = await createRundowns(jean.cookie, active.id, '2026-10-26', '2027-02-01');
    expect(long.statusCode).toBe(400);
  });

  it('modèle modifié : seuls les nouveaux conducteurs changent ; « Réappliquer »', async () => {
    const t = await newTemplate(jean.cookie, jean.id);
    const first = (
      await createRundowns(jean.cookie, t.id, '2026-10-26', '2026-10-26')
    ).json() as CreateFromTemplateResult;
    const c = client(built.app, jean.cookie);
    await c('PATCH', `/api/templates/${t.id}`, {
      version: t.version,
      title: 'La nouvelle matinale',
      startTime: '06:30',
      items: [item('z', { durationSeconds: 60 })],
    });
    const next = (
      await createRundowns(jean.cookie, t.id, '2026-10-27', '2026-10-27')
    ).json() as CreateFromTemplateResult;

    const old = (await c('GET', `/api/rundowns/${first.created[0]!.rundownId}`)).json() as Rundown;
    expect(old).toMatchObject({ title: 'La matinale', startTime: '07:00:00', itemCount: 2 });
    const fresh = (await c('GET', `/api/rundowns/${next.created[0]!.rundownId}`)).json() as Rundown;
    expect(fresh).toMatchObject({ title: 'La nouvelle matinale', startTime: '06:30:00' });
    expect(fresh.items.map((i) => i.uid)).toEqual(['z']);

    const stale = await c('POST', `/api/rundowns/${old.id}/reapply-template`, { version: 99 });
    expect(stale.statusCode).toBe(409);
    const reapplied = await c('POST', `/api/rundowns/${old.id}/reapply-template`, {
      version: old.version,
    });
    expect(reapplied.statusCode, reapplied.body).toBe(200);
    expect(reapplied.json()).toMatchObject({
      title: 'La nouvelle matinale',
      airDate: '2026-10-26',
      startTime: '06:30:00',
      itemCount: 1,
    });

    // Un conducteur ordinaire n'a pas de modèle à réappliquer.
    const plain = await c('POST', '/api/rundowns', {
      ownerId: jean.id,
      title: 'Ordinaire',
      airDate: '2026-10-26',
      startTime: '09:00',
    });
    const none = await c('POST', `/api/rundowns/${plain.json().id}/reapply-template`, {
      version: 1,
    });
    expect(none.json().error).toBe('no_template');
  });

  it('« Enregistrer comme modèle » depuis un conducteur', async () => {
    const c = client(built.app, jean.cookie);
    const r = (
      await c('POST', '/api/rundowns', {
        ownerId: jean.id,
        title: 'Le magazine',
        airDate: '2026-10-22', // un jeudi
        startTime: '18:00',
        items: [item('a'), item('b')],
      })
    ).json() as Rundown;

    const res = await c('POST', `/api/rundowns/${r.id}/save-as-template`, { ownerId: jean.id });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({
      title: 'Le magazine',
      startTime: '18:00:00',
      days: [4],
      active: true,
      itemCount: 2,
    });
    // Conducteur d'un collègue : le modèle va chez soi, pas chez lui.
    const p = client(built.app, paul.cookie);
    expect(
      (await p('POST', `/api/rundowns/${r.id}/save-as-template`, { ownerId: jean.id })).statusCode,
    ).toBe(403);
    expect(
      (
        await p('POST', `/api/rundowns/${r.id}/save-as-template`, {
          ownerId: paul.id,
          days: [1, 4],
        })
      ).json(),
    ).toMatchObject({ ownerId: paul.id, days: [1, 4] });
  });
});

describe('dispositions de l’écran studio', () => {
  it('choisie sur le modèle, copiée dans les conducteurs créés, modifiable ensuite', async () => {
    const t = await newTemplate(jean.cookie, jean.id, { layout: 'interview' });
    expect(t.layout).toBe('interview');
    await createRundowns(jean.cookie, t.id, '2026-10-26', '2026-10-26');
    const [summary] = await rundownsOf(jean.cookie);
    expect(summary!.layout).toBe('interview');

    const api = client(built.app, jean.cookie);
    const rundown = (await api('GET', `/api/rundowns/${summary!.id}`)).json() as Rundown;
    const res = await api('PATCH', `/api/rundowns/${rundown.id}`, {
      version: rundown.version,
      layout: 'regie',
    });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as Rundown).layout).toBe('regie');
    // Retour à la disposition par défaut.
    const back = await api('PATCH', `/api/rundowns/${rundown.id}`, {
      version: rundown.version + 1,
      layout: null,
    });
    expect((back.json() as Rundown).layout).toBeNull();
    // Valeur inconnue refusée ; un modèle sans choix laisse null.
    expect(
      (await api('PATCH', `/api/rundowns/${rundown.id}`, { version: 3, layout: 'plein-ecran' }))
        .statusCode,
    ).toBe(400);
    expect((await newTemplate(jean.cookie, jean.id)).layout).toBeNull();
  });

  it('suit la duplication et l’enregistrement comme modèle', async () => {
    const api = client(built.app, jean.cookie);
    const created = await api('POST', '/api/rundowns', {
      ownerId: jean.id,
      title: 'Interview',
      airDate: '2026-11-02',
      startTime: '18:00',
      layout: 'interview',
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = (created.json() as Rundown).id;
    const copy = await api('POST', `/api/rundowns/${id}/duplicate`, {
      ownerId: jean.id,
      airDate: '2026-11-09',
    });
    expect((copy.json() as Rundown).layout).toBe('interview');
    const saved = await api('POST', `/api/rundowns/${id}/save-as-template`, { ownerId: jean.id });
    expect((saved.json() as Template).layout).toBe('interview');
  });
});
