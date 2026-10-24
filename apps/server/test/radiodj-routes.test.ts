import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type {
  AuditPage,
  ConnectorTokenCreated,
  ConnectorTokenStatus,
  RadiodjSong,
  RadiodjTestResult,
} from '@onair-desk/shared';
import type { App } from '../src/app.js';
import { INGEST_RATE_PER_MINUTE, buildIngestServer } from '../src/connectors/ingest.js';
import { client, createTestApp, createUser, setupAdmin } from './helpers.js';
import { FakeReader, SUMMERTIME } from './radiodj-fixtures.js';

const RADIODJ = { host: 'studio-pc.lan', port: 3306, database: 'radiodj', user: 'onairdesk' };

async function start(db = new FakeReader(), env: Record<string, string> = {}) {
  const opened: { host: string; password: string }[] = [];
  const built = await createTestApp({
    env: { RADIODJ_DB_PASSWORD: 'mot-de-passe-base', CONNECTOR_HTTP_PORT: '8081', ...env },
    connectorDeps: {
      radiodjReader: (s, password) => {
        opened.push({ host: s.host, password });
        return db;
      },
    },
  });
  const admin = await setupAdmin(built);
  return { built, admin, opened, db };
}

let built: App | undefined;
let ingest: FastifyInstance | undefined;
afterEach(async () => {
  await ingest?.close();
  await built?.app.close();
  ingest = built = undefined;
});

describe('jeton du plugin RadioDJ', () => {
  it('généré par l’admin, montré une fois, stocké haché, régénérable, tracé', async () => {
    const s = await start();
    built = s.built;
    const api = client(built.app, s.admin);

    const before = (await api('GET', '/api/settings/radiodj/token')).json() as ConnectorTokenStatus;
    expect(before).toEqual({ configured: false, createdAt: null, httpPort: 8081 });

    const first = (
      await api('POST', '/api/settings/radiodj/token')
    ).json() as ConnectorTokenCreated;
    expect(first.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(first.status.configured).toBe(true);
    const row = built.ctx.repos.db
      .prepare('SELECT token_hash FROM connector_tokens WHERE connector = ?')
      .get('radiodj') as { token_hash: string };
    expect(row.token_hash).not.toContain(first.token);
    const status = (await api('GET', '/api/settings/radiodj/token')).json();
    expect(JSON.stringify(status)).not.toContain(first.token);

    const second = (
      await api('POST', '/api/settings/radiodj/token')
    ).json() as ConnectorTokenCreated;
    expect(second.token).not.toBe(first.token);
    const audit = (await api('GET', '/api/audit?category=securite')).json() as AuditPage;
    const gen = audit.entries.filter((e) => e.action === 'connector.token_generated');
    expect(gen.map((e) => e.details)).toEqual([
      { connector: 'radiodj', replaced: true },
      { connector: 'radiodj', replaced: false },
    ]);
    expect(JSON.stringify(audit)).not.toContain(second.token);
  });

  it('réservé à l’admin', async () => {
    const s = await start();
    built = s.built;
    const anim = await createUser(built, s.admin, 'anim');
    expect(
      (await client(built.app, anim.cookie)('POST', '/api/settings/radiodj/token')).statusCode,
    ).toBe(403);
    expect(
      (await client(built.app, anim.cookie)('GET', '/api/settings/radiodj/token')).statusCode,
    ).toBe(403);
  });
});

describe('écoute dédiée aux connecteurs', () => {
  const form = (body: Record<string, string>) => ({
    method: 'POST' as const,
    url: '/api/connectors/radiodj',
    headers: { 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' },
    payload: new URLSearchParams(body).toString(),
  });

  async function withIngest() {
    const s = await start();
    built = s.built;
    const api = client(built.app, s.admin);
    const { token } = (
      await api('POST', '/api/settings/radiodj/token')
    ).json() as ConnectorTokenCreated;
    await api('PUT', '/api/settings', { automationSource: 'radiodj', radiodj: RADIODJ });
    ingest = await buildIngestServer({
      tokens: built.ctx.repos.connectorTokens,
      automation: built.ctx.automation,
    });
    return { ...s, token };
  }

  it('accepte le signal au bon jeton (format réel de RadioDJ) et relit la base', async () => {
    const { token, db } = await withIngest();
    const before = db.reads;
    db.play(SUMMERTIME, '2026-10-24 16:20:00');
    const res = await ingest!.inject(form({ xpwd: token, title: 'César - Libertà' }));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, accepted: true });
    await new Promise((r) => setTimeout(r, 20));
    expect(db.reads).toBeGreaterThan(before);
  });

  it('refuse un jeton absent ou faux, sans rien déclencher', async () => {
    const { db } = await withIngest();
    const before = db.reads;
    expect((await ingest!.inject(form({ title: 'A - B' }))).statusCode).toBe(401);
    expect((await ingest!.inject(form({ xpwd: 'faux', title: 'A - B' }))).statusCode).toBe(401);
    // Le jeton dans l'adresse ne compte pas.
    expect(
      (await ingest!.inject({ ...form({ title: 'A' }), url: '/api/connectors/radiodj?xpwd=x' }))
        .statusCode,
    ).toBe(401);
    expect(db.reads).toBe(before);
  });

  it('n’expose que la route du signal (ni interface, ni API, ni GET)', async () => {
    await withIngest();
    for (const url of [
      '/',
      '/api/settings',
      '/api/auth/me',
      '/studio',
      '/api/settings/radiodj/token',
    ]) {
      expect((await ingest!.inject({ method: 'GET', url })).statusCode).toBe(404);
    }
    expect(
      (await ingest!.inject({ method: 'GET', url: '/api/connectors/radiodj' })).statusCode,
    ).toBe(404);
    expect(
      (await ingest!.inject({ method: 'POST', url: '/api/auth/login', payload: {} })).statusCode,
    ).toBe(404);
  });

  it('limite le débit', async () => {
    const { token } = await withIngest();
    let last = 0;
    for (let i = 0; i <= INGEST_RATE_PER_MINUTE; i++) {
      last = (await ingest!.inject(form({ xpwd: token, title: 'A' }))).statusCode;
    }
    expect(last).toBe(429);
  });
});

describe('test de connexion et recherche dans la bibliothèque RadioDJ', () => {
  it('test : accès saisi, mot de passe de l’environnement, jamais renvoyé', async () => {
    const s = await start();
    built = s.built;
    const api = client(built.app, s.admin);
    const ok = (
      await api('POST', '/api/settings/radiodj/test', { radiodj: RADIODJ })
    ).json() as RadiodjTestResult;
    expect(ok).toEqual({ ok: true, error: null, songs: 49 });
    expect(s.opened).toEqual([{ host: 'studio-pc.lan', password: 'mot-de-passe-base' }]);
    expect(s.db.closed).toBe(true);

    s.db.failWith = Object.assign(new Error('Access denied'), { code: 'ER_ACCESS_DENIED_ERROR' });
    const ko = (await api('POST', '/api/settings/radiodj/test', { radiodj: RADIODJ })).json();
    expect(ko).toEqual({ ok: false, error: 'radiodj_access_denied', songs: null });

    // Accès non renseigné dans les paramètres.
    const empty = (await api('POST', '/api/settings/radiodj/test', {})).json();
    expect(empty.error).toBe('radiodj_not_configured');
    const settings = (await api('GET', '/api/settings')).json();
    expect(JSON.stringify(settings)).not.toContain('mot-de-passe-base');
  });

  it('test : mot de passe absent de l’environnement', async () => {
    const s = await start(new FakeReader(), { RADIODJ_DB_PASSWORD: '' });
    built = s.built;
    const r = (
      await client(built.app, s.admin)('POST', '/api/settings/radiodj/test', { radiodj: RADIODJ })
    ).json();
    expect(r.error).toBe('radiodj_no_password');
    expect(s.opened).toEqual([]);
  });

  it('recherche : animateur, titres musicaux, durée jusqu’au point de mix', async () => {
    const db = new FakeReader();
    db.library = [{ ...SUMMERTIME, id: 1 }];
    const s = await start(db);
    built = s.built;
    const anim = await createUser(built, s.admin, 'anim');
    const search = (q: string) =>
      client(built!.app, anim.cookie)('GET', `/api/radiodj/songs?q=${encodeURIComponent(q)}`);

    expect((await search('Summer')).json()).toEqual({
      error: 'radiodj_not_source',
      message: 'radiodj_not_source',
    });
    await client(built.app, s.admin)('PUT', '/api/settings', {
      automationSource: 'radiodj',
      radiodj: RADIODJ,
    });

    const songs = (await search('Summer')).json() as RadiodjSong[];
    expect(songs).toEqual([
      { id: 1, artist: 'Adamé, Lili Poli', title: 'Summertime', durationMs: 163989 },
    ]);
    expect(db.searches.at(-1)).toEqual({ query: 'Summer', limit: 20 });
    expect((await search('S')).statusCode).toBe(400);

    db.failWith = Object.assign(new Error('down'), { code: 'ECONNREFUSED' });
    const down = await search('Summer');
    expect(down.statusCode).toBe(502);
    expect(down.json().error).toBe('radiodj_unreachable');
  });
});

describe('paramètres de l’étape 7', () => {
  it('seuils d’alerte et accès RadioDJ validés, diffusés sans secret', async () => {
    const s = await start();
    built = s.built;
    const api = client(built.app, s.admin);
    const bad = await api('PUT', '/api/settings', {
      trackAlert: { soonSeconds: 10, nowSeconds: 10 },
    });
    expect(bad.statusCode).toBe(400);
    const badHost = await api('PUT', '/api/settings', { radiodj: { ...RADIODJ, host: 'a b' } });
    expect(badHost.statusCode).toBe(400);
    const ok = await api('PUT', '/api/settings', {
      trackAlert: { soonSeconds: 20, nowSeconds: 5 },
      radiodj: RADIODJ,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({
      trackAlert: { soonSeconds: 20, nowSeconds: 5 },
      radiodj: RADIODJ,
    });
    expect(ok.body).not.toContain('mot-de-passe-base');
  });
});
