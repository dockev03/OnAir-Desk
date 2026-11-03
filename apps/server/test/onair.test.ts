import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type {
  AuditPage,
  ConnectorTokenCreated,
  ConnectorTokenStatus,
  OnAirResponse,
} from '@onair-desk/shared';
import type { App } from '../src/app.js';
import { INGEST_RATE_PER_MINUTE, buildIngestServer } from '../src/connectors/ingest.js';
import { openDatabase } from '../src/db/database.js';
import { migrations } from '../src/db/migrations.js';
import { createRepos } from '../src/db/index.js';
import { client, createTestApp, createUser, setupAdmin } from './helpers.js';

let built: App | undefined;
let ingest: FastifyInstance | undefined;
const logs: string[] = [];
afterEach(async () => {
  await ingest?.close();
  await built?.app.close();
  ingest = built = undefined;
  logs.length = 0;
});

/** Application, admin, jeton On Air et écoute dédiée (journal capturé). */
async function start() {
  built = await createTestApp({ env: { CONNECTOR_HTTP_PORT: '8081' } });
  const admin = await setupAdmin(built);
  const api = client(built.app, admin);
  const created = (await api('POST', '/api/settings/onair/token')).json() as ConnectorTokenCreated;
  ingest = await buildIngestServer({
    tokens: built.ctx.repos.connectorTokens,
    automation: built.ctx.automation,
    onAir: built.ctx.onAir,
    settings: built.ctx.repos.settings,
    logger: {
      level: 'info',
      stream: { write: (line: string) => void logs.push(line) },
    },
  });
  return { api, admin, token: created.token, created };
}

const post = (token: string | null, payload: unknown) =>
  ingest!.inject({
    method: 'POST',
    url: '/api/onair',
    headers: token ? { authorization: `Bearer ${token}` } : {},
    payload: payload as object,
  });

describe('service On Air', () => {
  it('allume, éteint, inverse ; même état sans effet ; durée gardée à l’extinction', async () => {
    built = await createTestApp();
    const svc = built.ctx.onAir;
    expect(svc.get(1)).toEqual({ on: false, since: null, source: null, lastDurationMs: null });
    const on = svc.set(1, 'on', 'http', null);
    expect(on).toMatchObject({ on: true, source: 'http', lastDurationMs: null });
    // Même état : ni l'heure, ni le journal ne changent.
    expect(svc.set(1, 'on', 'manual', null).since).toBe(on.since);
    const off = svc.set(1, 'toggle', 'manual', { type: 'user', id: 1 });
    expect(off.on).toBe(false);
    expect(off.lastDurationMs).toBeGreaterThanOrEqual(0);
    expect(built.ctx.air.get(1).state.onAir).toEqual(off);
    const actions = built.ctx.repos.db
      .prepare("SELECT details FROM audit_log WHERE action = 'onair.changed' ORDER BY id")
      .all() as { details: string }[];
    expect(actions.map((a) => JSON.parse(a.details).state)).toEqual(['on', 'off']);
  });
});

describe('route On Air (écoute dédiée aux connecteurs)', () => {
  it('jeton généré par l’admin, montré une fois, haché ; jamais renvoyé ensuite', async () => {
    const { api, created, token } = await start();
    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(created.status).toMatchObject({ configured: true, httpPort: 8081 });
    const status = (await api('GET', '/api/settings/onair/token')).json() as ConnectorTokenStatus;
    expect(JSON.stringify(status)).not.toContain(token);
    const row = built!.ctx.repos.db
      .prepare("SELECT token_hash FROM connector_tokens WHERE connector = 'onair'")
      .get() as { token_hash: string };
    expect(row.token_hash).not.toContain(token);
  });

  it('on / off / toggle et lecture de l’état, au bon jeton seulement', async () => {
    const { token } = await start();
    expect((await post(null, { state: 'on' })).statusCode).toBe(401);
    expect((await post('faux', { state: 'on' })).statusCode).toBe(401);
    expect(built!.ctx.onAir.get(1).on).toBe(false);

    let res = await post(token, { state: 'toggle' });
    expect(res.statusCode).toBe(200);
    expect((res.json() as OnAirResponse).on).toBe(true);
    res = await ingest!.inject({
      method: 'GET',
      url: '/api/onair',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.json()).toMatchObject({ on: true });
    expect((await ingest!.inject({ method: 'GET', url: '/api/onair' })).statusCode).toBe(401);

    res = await post(token, { state: 'off' });
    expect((res.json() as OnAirResponse).on).toBe(false);
    // Corps strict : ni autre valeur, ni champ en plus, ni format libre.
    for (const payload of [{ state: '1' }, { state: 'on', x: 1 }, {}, { state: true }]) {
      expect((await post(token, payload)).statusCode).toBe(400);
    }
    expect(built!.ctx.air.get(1).state.onAir.source).toBe('http');
  });

  it('appel simple : refusé par défaut, accepté une fois activé ; adresse jamais journalisée', async () => {
    const { api, token } = await start();
    const simple = (action: string, t = token) =>
      ingest!.inject({ method: 'GET', url: `/api/onair/${action}?token=${t}` });
    expect((await simple('toggle')).statusCode).toBe(403);

    await api('PUT', '/api/settings', { onAirSimpleCall: true });
    expect((await simple('toggle', 'faux')).statusCode).toBe(401);
    let res = await simple('on');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ on: true });
    res = await simple('toggle');
    expect(res.json()).toMatchObject({ on: false });
    expect((await simple('allumer')).statusCode).toBe(404);
    expect(logs.join('\n')).not.toContain(token);
    expect(logs.join('\n')).toContain('/api/onair/toggle');
  });

  it('limite le débit', async () => {
    const { token } = await start();
    let last = 0;
    for (let i = 0; i <= INGEST_RATE_PER_MINUTE; i++) {
      last = (await post(token, { state: 'toggle' })).statusCode;
    }
    expect(last).toBe(429);
  });
});

describe('bouton manuel', () => {
  it('compte connecté et écran studio (désactivable), tracés au nom de l’auteur', async () => {
    const { api, admin } = await start();
    const jean = await createUser(built!, admin, 'jean');
    const res = await client(built!.app, jean.cookie)('POST', '/api/studio/onair', {
      state: 'toggle',
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as OnAirResponse).on).toBe(true);

    // Écran studio appairé.
    const device = (await api('POST', '/api/devices', { name: 'Afficheur' })).json() as {
      token: string;
    };
    const pair = await client(built!.app)('POST', '/api/kiosk/pair', { token: device.token });
    const cookie = pair.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    const kiosk = client(built!.app, cookie);
    expect((await kiosk('POST', '/api/studio/onair', { state: 'off' })).statusCode).toBe(200);
    expect(built!.ctx.onAir.get(1)).toMatchObject({ on: false, source: 'manual' });

    await api('PUT', '/api/settings', { onAirKiosk: false });
    const refused = await kiosk('POST', '/api/studio/onair', { state: 'on' });
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({ error: 'onair_kiosk_disabled' });
    // Le kiosk reste en lecture seule ailleurs.
    expect((await kiosk('PUT', '/api/settings', { onAirKiosk: true })).statusCode).toBe(403);

    const audit = (await api('GET', '/api/audit?category=antenne')).json() as AuditPage;
    const changes = audit.entries.filter((e) => e.action === 'onair.changed');
    expect(changes.map((e) => [e.actorType, e.actorName])).toEqual([
      ['device', 'Afficheur'],
      ['user', 'jean'],
    ]);
  });
});

describe('conservation en base', () => {
  it('l’état survit à un redémarrage ; migration 10 : jeton RadioDJ conservé', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'onair-db-'));
    try {
      // Base à la version 9 avec un jeton RadioDJ, puis migration 10.
      let db = openDatabase(dir, () => {}, migrations.slice(0, 9));
      db.prepare(
        "INSERT INTO connector_tokens (connector, token_hash) VALUES ('radiodj', 'h')",
      ).run();
      db.close();
      db = openDatabase(dir);
      const repos = createRepos(db);
      expect(repos.connectorTokens.matches('radiodj', 'h')).toBe(true);
      repos.connectorTokens.set('onair', 'o');
      repos.onAir.set(1, { on: true, since: 42, source: 'http', lastDurationMs: null });
      db.close();
      db = openDatabase(dir);
      expect(createRepos(db).onAir.get(1)).toEqual({
        on: true,
        since: 42,
        source: 'http',
        lastDurationMs: null,
      });
      db.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
