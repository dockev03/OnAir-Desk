import { afterEach, describe, expect, it } from 'vitest';
import type { AuditPage, AzuracastTestResult, Settings } from '@onair-desk/shared';
import type { App } from '../src/app.js';
import { AzuracastError, type AzuracastAccess } from '../src/connectors/azuracast/client.js';
import { client, createTestApp, createUser, setupAdmin } from './helpers.js';
import { LIVE, MemoryAzuracast, OFF_AIR } from './azuracast-fixtures.js';

const AZURACAST = { url: 'https://azuracast.test', station: 'vichyradio', streamDelaySeconds: 0 };

async function start(env: Record<string, string> = {}) {
  const fake = new MemoryAzuracast();
  const accesses: AzuracastAccess[] = [];
  const built = await createTestApp({
    env,
    connectorDeps: {
      azuracastClient: (access) => {
        accesses.push(access);
        return fake;
      },
    },
  });
  const admin = await setupAdmin(built);
  return { built, admin, fake, accesses };
}

let built: App | undefined;
afterEach(async () => {
  await built?.app.close();
  built = undefined;
});

const test = (api: ReturnType<typeof client>, body: object = { azuracast: AZURACAST }) =>
  api('POST', '/api/settings/azuracast/test', body).then((r) => r.json() as AzuracastTestResult);

describe('test de la connexion à AzuraCast', () => {
  it('station publique : nom, titre en cours, clé non nécessaire', async () => {
    const s = await start();
    built = s.built;
    const r = await test(client(built.app, s.admin));
    expect(r).toEqual({
      ok: true,
      error: null,
      auth: 'none',
      keyConfigured: false,
      stationName: 'Vichy Radio',
      nowPlaying: 'Desireless - Voyage voyage',
      live: false,
    });
    expect(s.accesses[0]).toMatchObject({
      url: AZURACAST.url,
      station: 'vichyradio',
      apiKey: null,
    });
  });

  it('clé requise, acceptée ou refusée ; jamais renvoyée', async () => {
    const s = await start({ AZURACAST_API_KEY: 'cle-tres-secrete' });
    built = s.built;
    const api = client(built.app, s.admin);
    s.fake.np = LIVE;
    const ok = await test(api);
    expect(ok).toMatchObject({ ok: true, auth: 'accepted', keyConfigured: true, live: true });
    expect(s.accesses.at(-1)?.apiKey).toBe('cle-tres-secrete');

    s.fake.error = new AzuracastError('azuracast_unauthorized', 'HTTP 403', 403);
    const refused = await test(api);
    expect(refused).toMatchObject({ ok: false, error: 'azuracast_unauthorized', auth: 'refused' });

    for (const res of [
      await api('GET', '/api/settings'),
      await api('GET', '/api/air'),
      await api('POST', '/api/settings/azuracast/test', { azuracast: AZURACAST }),
    ]) {
      expect(res.body).not.toContain('cle-tres-secrete');
    }
    const audit = (await api('GET', '/api/audit')).json() as AuditPage;
    expect(JSON.stringify(audit)).not.toContain('cle-tres-secrete');
  });

  it('sans clé, station protégée : clé requise ; accès incomplet : code explicite', async () => {
    const s = await start();
    built = s.built;
    const api = client(built.app, s.admin);
    s.fake.error = new AzuracastError('azuracast_unauthorized', 'HTTP 401', 401);
    expect(await test(api)).toMatchObject({ ok: false, auth: 'required' });

    const incomplete = await test(api, { azuracast: { ...AZURACAST, station: '' } });
    expect(incomplete).toMatchObject({ ok: false, error: 'azuracast_not_configured' });
  });

  it('réservé à l’admin', async () => {
    const s = await start();
    built = s.built;
    const jean = await createUser(built, s.admin, 'jean');
    const res = await client(built.app, jean.cookie)('POST', '/api/settings/azuracast/test', {});
    expect(res.statusCode).toBe(403);
  });
});

describe('paramètres AzuraCast et bascule', () => {
  it('adresse en https:// seulement, sources de la bascule différentes', async () => {
    const s = await start();
    built = s.built;
    const api = client(built.app, s.admin);
    for (const url of ['http://azuracast.test', 'ftp://x', 'https://user:pw@azuracast.test']) {
      const res = await api('PUT', '/api/settings', { azuracast: { ...AZURACAST, url } });
      expect(res.statusCode, url).toBe(400);
    }
    const same = await api('PUT', '/api/settings', {
      airSwitch: { enabled: true, liveSource: 'radiodj', offAirSource: 'radiodj', force: 'auto' },
    });
    expect(same.statusCode).toBe(400);
    const delay = await api('PUT', '/api/settings', {
      azuracast: { ...AZURACAST, streamDelaySeconds: 31 },
    });
    expect(delay.statusCode).toBe(400);
  });

  it('bascule activée : les deux sources tournent, le forçage est tracé au nom de l’admin', async () => {
    const s = await start();
    built = s.built;
    const api = client(built.app, s.admin);
    const airSwitch = {
      enabled: true,
      liveSource: 'simulator',
      offAirSource: 'azuracast',
      force: 'auto',
    } as const;
    // Titre en cours qui vient de commencer (sinon effacé comme trop ancien).
    s.fake.np = {
      ...OFF_AIR,
      now_playing: { ...OFF_AIR.now_playing, played_at: Math.floor(Date.now() / 1000) },
    };
    let res = await api('PUT', '/api/settings', { azuracast: AZURACAST, airSwitch });
    expect(res.statusCode, res.body).toBe(200);
    await new Promise((r) => setTimeout(r, 10));
    let air = built.ctx.air.get(1).state;
    expect(air.live).toMatchObject({ active: false, forced: false });
    expect(air.nowPlaying?.title).toBe('Voyage voyage');

    res = await api('PUT', '/api/settings', { airSwitch: { ...airSwitch, force: 'live' } });
    expect((res.json() as Settings).airSwitch.force).toBe('live');
    air = built.ctx.air.get(1).state;
    expect(air.live).toMatchObject({ active: true, forced: true });
    expect(air.source.id).toBe('simulator');

    const audit = (await api('GET', '/api/audit?category=antenne')).json() as AuditPage;
    const switched = audit.entries.find((e) => e.action === 'automation.switched');
    expect(switched).toMatchObject({
      actorType: 'user',
      actorName: 'Admin',
      details: { to: 'live', source: 'simulator', cause: 'forced' },
    });
    const changed = audit.entries.find((e) => e.action === 'automation.source_changed');
    expect(changed?.details).toMatchObject({ from: 'none', to: 'simulator+azuracast' });
  });
});
