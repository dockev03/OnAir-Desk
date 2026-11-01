import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AirState, ServerMessage, Settings } from '@onair-desk/shared';
import { AirStateStore } from '../src/air/state.js';
import {
  HttpsAzuracastClient,
  azuracastErrorCode,
  type AzuracastAccess,
} from '../src/connectors/azuracast/client.js';
import {
  AzuracastConnector,
  POLL_MS,
  STALE_AFTER_MS,
} from '../src/connectors/azuracast/connector.js';
import {
  matchesStation,
  parseNowPlaying,
  ssePayloads,
  toUpdate,
} from '../src/connectors/azuracast/nowplaying.js';
import { AutomationManager, RETRY_MS } from '../src/connectors/manager.js';
import { SIMULATOR_PLAYLIST } from '../src/connectors/simulator.js';
import type { AutomationUpdate, ConnectorContext } from '../src/connectors/types.js';
import { defaultSettings } from '../src/db/settings.js';
import type { Hub } from '../src/ws/hub.js';
import { FakeAzuracastServer, LIVE, MemoryAzuracast, OFF_AIR } from './azuracast-fixtures.js';

const PLAYED_AT = OFF_AIR.now_playing.played_at * 1000;

describe('réponse « Now Playing » d’AzuraCast', () => {
  it('réponse réelle hors direct : titre en cours, titre à venir, retard du flux', () => {
    const np = parseNowPlaying([OFF_AIR])!;
    expect(matchesStation(np, 'vichyradio')).toBe(true);
    expect(matchesStation(np, '1')).toBe(true);
    expect(matchesStation(np, 'autre')).toBe(false);
    expect(toUpdate(np, 10_000)).toEqual({
      nowPlaying: {
        title: 'Voyage voyage',
        artist: 'Desireless',
        durationMs: 262_000,
        startedAt: PLAYED_AT + 10_000,
        introMs: null,
        outroMs: null,
      },
      next: {
        title: "Ella, elle l'a (Remasterisé en 2004)",
        artist: 'France Gall',
        durationMs: 291_408,
        startedAt: null,
        introMs: null,
        outroMs: null,
      },
      live: false,
    });
  });

  it('en direct : pas de titre à venir (file de l’AutoDJ), durée inconnue → sans minutage', () => {
    const u = toUpdate(parseNowPlaying(LIVE)!, 0);
    expect(u.live).toBe(true);
    expect(u.next).toBeNull();
    expect(u.nowPlaying).toMatchObject({
      title: 'Pour que tu m’aimes encore',
      artist: 'Céline Dion',
      durationMs: 0,
      startedAt: null,
    });
  });

  it('texte brut seul, station hors ligne, réponse illisible', () => {
    const textOnly = {
      ...OFF_AIR,
      now_playing: { ...OFF_AIR.now_playing, song: { text: 'Jingle station', title: '' } },
    };
    expect(toUpdate(parseNowPlaying(textOnly)!, 0).nowPlaying).toMatchObject({
      title: 'Jingle station',
      artist: '',
    });
    const offline = toUpdate(parseNowPlaying({ ...OFF_AIR, is_online: false })!, 0);
    expect(offline).toMatchObject({ nowPlaying: null, next: null });
    expect(parseNowPlaying({ now_playing: { played_at: 'hier' } })).toBeNull();
    expect(parseNowPlaying('<html>')).toBeNull();
    // Champs facultatifs absents : rien à afficher, sans erreur.
    expect(toUpdate(parseNowPlaying({})!, 0)).toEqual({
      nowPlaying: null,
      next: null,
      live: false,
    });
  });

  it('flux SSE : état initial à la connexion, puis publications', () => {
    expect(
      ssePayloads({
        connect: {
          client: 'x',
          subs: { 'station:vichyradio': { publications: [{ data: { np: OFF_AIR } }] } },
        },
      }),
    ).toEqual([OFF_AIR]);
    expect(ssePayloads({ connect: { data: [{ data: { np: LIVE } }] } })).toEqual([LIVE]);
    expect(ssePayloads({ pub: { data: { np: LIVE } } })).toEqual([LIVE]);
    // Connexion sans donnée, ping, message inconnu.
    expect(ssePayloads({ connect: { client: 'x', subs: { 'station:1': {} } } })).toEqual([]);
    expect(ssePayloads({})).toEqual([]);
    expect(ssePayloads(null)).toEqual([]);
  });
});

describe('client HTTPS d’AzuraCast (faux serveur)', () => {
  let server: FakeAzuracastServer;
  beforeEach(async () => (server = await FakeAzuracastServer.start()));
  afterEach(async () => await server.close());

  const access = (over: Partial<AzuracastAccess> = {}): AzuracastAccess => ({
    url: server.url,
    station: 'vichyradio',
    apiKey: null,
    ca: server.ca,
    ...over,
  });

  it('lit l’état avec le certificat fourni ; aucune clé envoyée sans AZURACAST_API_KEY', async () => {
    const np = await new HttpsAzuracastClient(access()).nowPlaying();
    expect(parseNowPlaying(np)?.now_playing?.song.title).toBe('Voyage voyage');
    expect(server.requests).toEqual([{ path: '/api/nowplaying/vichyradio', key: null }]);
  });

  it('certificat inconnu : refusé, et la clé n’est jamais envoyée', async () => {
    const err = await new HttpsAzuracastClient(access({ ca: null, apiKey: 'cle-secrete' }))
      .nowPlaying()
      .catch((e: unknown) => e);
    expect(azuracastErrorCode(err)).toBe('azuracast_tls');
    expect(String((err as Error).message)).not.toContain('cle-secrete');
    expect(server.requests).toEqual([]);
  });

  it('clé API dans l’en-tête, jamais dans l’adresse ; 401 / 403 / 404 → codes stables', async () => {
    await new HttpsAzuracastClient(access({ apiKey: 'cle-secrete' })).nowPlaying();
    expect(server.requests[0]).toEqual({ path: '/api/nowplaying/vichyradio', key: 'cle-secrete' });

    for (const [status, code] of [
      [401, 'azuracast_unauthorized'],
      [403, 'azuracast_unauthorized'],
      [404, 'azuracast_station_unknown'],
      [500, 'azuracast_http'],
    ] as const) {
      server.status = status;
      const err = await new HttpsAzuracastClient(access({ apiKey: 'cle-secrete' }))
        .nowPlaying()
        .catch((e: unknown) => e);
      expect(azuracastErrorCode(err)).toBe(code);
      expect(String((err as Error).message)).not.toContain('cle-secrete');
    }
  });

  it('serveur injoignable : code stable', async () => {
    const port = server.port;
    await server.close();
    const err = await new HttpsAzuracastClient({ ...access(), url: `https://127.0.0.1:${port}` })
      .nowPlaying()
      .catch((e: unknown) => e);
    expect(azuracastErrorCode(err)).toBe('azuracast_unreachable');
    server = await FakeAzuracastServer.start();
  });

  it('flux SSE : état initial puis publication, avec la clé dans l’en-tête', async () => {
    const received: unknown[] = [];
    const client = new HttpsAzuracastClient(access({ apiKey: 'cle-secrete' }));
    const stop = client.subscribe((m) => received.push(...ssePayloads(m)));
    await vi.waitFor(() => expect(received).toHaveLength(1));
    server.publish(LIVE);
    await vi.waitFor(() => expect(received).toHaveLength(2));
    expect(received[1]).toEqual(LIVE);
    stop();
    expect(server.requests[0]).toEqual({ path: '/api/live/nowplaying/sse', key: 'cle-secrete' });
  });
});

describe('connecteur AzuraCast', () => {
  beforeEach(() => vi.useFakeTimers({ now: PLAYED_AT + 60_000 }));
  afterEach(() => vi.useRealTimers());

  const context = () => {
    const updates: AutomationUpdate[] = [];
    const failures: string[] = [];
    const ctx: ConnectorContext = {
      now: Date.now,
      update: (u) => updates.push(u),
      fail: (e) => failures.push(e),
    };
    return { ctx, updates, failures };
  };

  it('relecture au démarrage, flux SSE ensuite, relecture toutes les 30 s', async () => {
    const client = new MemoryAzuracast();
    const { ctx, updates, failures } = context();
    const c = new AzuracastConnector(client, 'vichyradio', 0);
    await c.start(ctx);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ live: false, nowPlaying: { title: 'Voyage voyage' } });
    expect(client.subscribers).toBe(1);

    client.publish(LIVE);
    expect(updates.at(-1)).toMatchObject({ live: true, next: null });
    // Même état relu : rien n'est retransmis.
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(client.reads).toBe(2);
    expect(updates).toHaveLength(2);
    // Publication d'une autre station : ignorée.
    client.publish({ ...OFF_AIR, station: { ...OFF_AIR.station, shortcode: 'autre', id: 2 } });
    expect(updates).toHaveLength(2);
    expect(failures).toEqual([]);

    c.stop();
    expect(client.subscribers).toBe(0);
  });

  it('relecture en échec : panne signalée avec son code ; flux muet : pas une panne', async () => {
    const client = new MemoryAzuracast();
    client.error = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    const { ctx, failures } = context();
    const c = new AzuracastConnector(client, 'vichyradio', 0);
    await c.start(ctx);
    expect(failures).toEqual(['azuracast_unreachable: connect ECONNREFUSED']);
    c.stop();

    const ok = new MemoryAzuracast();
    ok.np = { unexpected: true, now_playing: 'x' };
    const second = context();
    const c2 = new AzuracastConnector(ok, 'vichyradio', 0);
    await c2.start(second.ctx);
    expect(second.failures[0]).toMatch(/^azuracast_bad_response/);
    c2.stop();
  });

  it('titre fini depuis plus de 2 minutes sans nouvelle donnée : effacé', async () => {
    const client = new MemoryAzuracast();
    const { ctx, updates } = context();
    const c = new AzuracastConnector(client, 'vichyradio', 0);
    await c.start(ctx);
    expect(updates.at(-1)?.nowPlaying).not.toBeNull();
    const end = PLAYED_AT + OFF_AIR.now_playing.duration * 1000;
    await vi.advanceTimersByTimeAsync(end + STALE_AFTER_MS + POLL_MS - Date.now());
    expect(updates.at(-1)?.nowPlaying).toBeNull();
    c.stop();
  });
});

describe('bascule direct / hors direct', () => {
  beforeEach(() => vi.useFakeTimers({ now: PLAYED_AT + 60_000 }));
  afterEach(() => vi.useRealTimers());

  const settings = (over: Partial<Settings['airSwitch']> = {}, rest: Partial<Settings> = {}) => ({
    ...defaultSettings(),
    simulatorSpeed: 10,
    azuracast: { url: 'https://azuracast.test', station: 'vichyradio', streamDelaySeconds: 0 },
    airSwitch: {
      enabled: true,
      liveSource: 'simulator' as const,
      offAirSource: 'azuracast' as const,
      force: 'auto' as const,
      ...over,
    },
    ...rest,
  });

  const setup = () => {
    const sent: ServerMessage[] = [];
    const hub = {
      broadcastStudio: (_: number, m: ServerMessage) => sent.push(m),
    } as unknown as Hub;
    const air = new AirStateStore(hub);
    const writes: { actor: unknown; action: string; details: unknown }[] = [];
    const audit = {
      write: (actor: unknown, action: string, details: unknown) =>
        writes.push({ actor, action, details }),
    };
    const azuracast = new MemoryAzuracast();
    const manager = new AutomationManager(1, air, audit as never, Date.now, {
      azuracastClient: () => azuracast,
      radiodjPassword: null,
    });
    const state = (): AirState => air.get(1).state;
    return { manager, state, writes, azuracast };
  };

  it('automatique : AzuraCast hors direct, le direct dès que le DJ se connecte', async () => {
    const { manager, state, writes, azuracast } = setup();
    manager.apply(settings());
    await vi.advanceTimersByTimeAsync(0);
    expect(state().nowPlaying?.title).toBe('Voyage voyage');
    expect(state().source).toMatchObject({ id: 'azuracast', state: 'ok' });
    expect(state().live).toMatchObject({
      active: false,
      forced: false,
      liveSource: { id: 'simulator', state: 'ok' },
      offAirSource: { id: 'azuracast', state: 'ok' },
    });
    expect(manager.currentSource).toBe('azuracast');

    azuracast.publish(LIVE);
    expect(state().live?.active).toBe(true);
    expect(state().source.id).toBe('simulator');
    expect(state().nowPlaying?.title).toBe(SIMULATOR_PLAYLIST[0].title);
    expect(writes.filter((w) => w.action === 'automation.switched')).toEqual([
      {
        actor: { type: 'system' },
        action: 'automation.switched',
        details: { to: 'live', source: 'simulator', cause: 'auto' },
      },
    ]);

    azuracast.publish(OFF_AIR);
    expect(state().live?.active).toBe(false);
    expect(state().nowPlaying?.title).toBe('Voyage voyage');
    manager.stop();
  });

  it('forçage par l’admin : bascule aussitôt, sans redémarrer les sources, au nom de l’admin', async () => {
    const { manager, state, writes, azuracast } = setup();
    manager.apply(settings());
    await vi.advanceTimersByTimeAsync(0);
    const reads = azuracast.reads;
    manager.apply(settings({ force: 'live' }), { type: 'user', id: 7 });
    expect(state().live).toMatchObject({ active: true, forced: true });
    expect(azuracast.reads).toBe(reads);
    expect(writes.at(-1)).toEqual({
      actor: { type: 'user', id: 7 },
      action: 'automation.switched',
      details: { to: 'live', source: 'simulator', cause: 'forced' },
    });
    // Forcé hors direct : l'indicateur d'AzuraCast est ignoré.
    manager.apply(settings({ force: 'offair' }), { type: 'user', id: 7 });
    azuracast.publish(LIVE);
    expect(state().live?.active).toBe(false);
    expect(state().nowPlaying?.title).toBe('Pour que tu m’aimes encore');
    manager.stop();
  });

  it('AzuraCast en panne pendant le direct : on reste en direct', async () => {
    const { manager, state, azuracast } = setup();
    manager.apply(settings());
    await vi.advanceTimersByTimeAsync(0);
    azuracast.publish(LIVE);
    expect(state().live?.active).toBe(true);
    azuracast.error = new Error('timeout');
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(state().live?.offAirSource.state).toBe('error');
    expect(state().live?.active).toBe(true);
    expect(state().source.id).toBe('simulator');
    expect(SIMULATOR_PLAYLIST.map((t) => t.title)).toContain(state().nowPlaying?.title);
    manager.stop();
  });

  it('secours : RadioDJ en panne pendant le direct, titre relayé par AzuraCast', async () => {
    const { manager, state, azuracast } = setup();
    manager.apply(settings({ liveSource: 'radiodj' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(state().live?.liveSource).toMatchObject({
      state: 'error',
      error: 'radiodj_not_configured',
    });
    azuracast.publish(LIVE);
    expect(state().live?.active).toBe(true);
    expect(state().source.id).toBe('radiodj');
    expect(state().nowPlaying).toMatchObject({
      title: 'Pour que tu m’aimes encore',
      startedAt: null,
    });
    expect(state().next).toBeNull();

    // Le signal RadioDJ est transmis, que RadioDJ soit à l'antenne ou non.
    expect(manager.signal('radiodj', 'A - B')).toBe(true);
    expect(manager.signal('simulator', 'A - B')).toBe(false);
    await vi.advanceTimersByTimeAsync(RETRY_MS);
    manager.stop();
  });

  it('source unique ↔ bascule : les connecteurs suivent', async () => {
    const { manager, state, azuracast } = setup();
    manager.apply(settings({ enabled: false }, { automationSource: 'azuracast' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(state().live).toBeNull();
    expect(state().nowPlaying?.title).toBe('Voyage voyage');
    expect(azuracast.subscribers).toBe(1);

    manager.apply(settings({ enabled: false }, { automationSource: 'none' }));
    expect(state()).toMatchObject({ nowPlaying: null, live: null, source: { id: 'none' } });
    expect(azuracast.subscribers).toBe(0);
    manager.stop();
  });

  it('AzuraCast non configuré : erreur explicite', () => {
    const { manager, state } = setup();
    manager.apply({
      ...settings({ enabled: false }, { automationSource: 'azuracast' }),
      azuracast: { url: '', station: '', streamDelaySeconds: 0 },
    });
    expect(state().source).toMatchObject({ state: 'error', error: 'azuracast_not_configured' });
    manager.stop();
  });
});
