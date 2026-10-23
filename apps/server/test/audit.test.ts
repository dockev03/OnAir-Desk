import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AuditPage } from '@onair-desk/shared';
import type { App } from '../src/app.js';
import { client, createTestApp, createUser, setupAdmin } from './helpers.js';

let built: App;
let admin: string;
beforeEach(async () => {
  built = await createTestApp();
  admin = await setupAdmin(built);
});
afterEach(() => built.app.close());

const audit = async (query = '') =>
  (await client(built.app, admin)('GET', `/api/audit${query}`)).json() as AuditPage;

describe('journal d’audit', () => {
  it('admin seul ; catégories, nom figé de l’auteur, filtres', async () => {
    const jean = await createUser(built, admin, 'jean');
    expect((await client(built.app, jean.cookie)('GET', '/api/audit')).statusCode).toBe(403);
    expect((await client(built.app)('GET', '/api/audit')).statusCode).toBe(401);

    await client(built.app, jean.cookie)('POST', '/api/scripts', { ownerId: jean.id, title: 'S' });
    const script = (await client(built.app, jean.cookie)('GET', '/api/library')).json().scripts[0];
    await client(built.app, jean.cookie)('DELETE', `/api/scripts/${script.id}`);

    // Jean est renommé : l'entrée garde le nom d'origine.
    await client(built.app, admin)('PATCH', `/api/users/${jean.id}`, { displayName: 'Jean R.' });

    const all = await audit();
    expect(all.total).toBeGreaterThanOrEqual(5);
    expect(all.entries[0]!.action).toBe('user.updated'); // le plus récent d'abord
    const trashed = all.entries.find((e) => e.action === 'script.trashed')!;
    expect(trashed).toMatchObject({ category: 'contenu', actorName: 'jean', actorId: jean.id });

    const security = await audit('?category=securite');
    expect(security.entries.every((e) => e.category === 'securite')).toBe(true);
    expect(security.entries.map((e) => e.action)).toContain('auth.login');

    const byJean = await audit(`?actorId=${jean.id}`);
    expect(byJean.entries.map((e) => e.action).sort()).toEqual(['auth.login', 'script.trashed']);

    expect((await audit('?from=2000-01-01&to=2000-12-31')).total).toBe(0);
    const today = new Date().toISOString().slice(0, 10);
    expect((await audit(`?from=${today}&to=${today}`)).total).toBe(all.total);

    const bad = await client(built.app, admin)('GET', '/api/audit?category=x');
    expect(bad.statusCode).toBe(400);
  });

  it('pagination par 50, plus récents d’abord', async () => {
    const repo = built.ctx.repos.audit;
    for (let i = 0; i < 60; i++) repo.write({ type: 'system' }, 'automation.error', { i });
    const p1 = await audit('?category=antenne');
    const p2 = await audit('?category=antenne&page=2');
    expect(p1).toMatchObject({ total: 60, page: 1, pageSize: 50 });
    expect(p1.entries).toHaveLength(50);
    expect(p2.entries).toHaveLength(10);
    expect(p1.entries[0]!.details).toEqual({ i: 59 });
    expect(p2.entries.at(-1)!.details).toEqual({ i: 0 });
  });

  it('purge des entrées de plus d’un an', () => {
    const { db, audit: repo } = built.ctx.repos;
    repo.write({ type: 'system' }, 'automation.error');
    db.prepare(
      "UPDATE audit_log SET at = '2024-01-01T00:00:00.000Z' WHERE action = 'automation.error'",
    ).run();
    repo.write({ type: 'system' }, 'automation.recovered');
    expect(repo.purge(Date.UTC(2025, 6, 1))).toBe(1);
    expect(
      db.prepare("SELECT action FROM audit_log WHERE action LIKE 'automation.%'").all(),
    ).toEqual([{ action: 'automation.recovered' }]);
  });
});
