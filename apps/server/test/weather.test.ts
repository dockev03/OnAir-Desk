import http from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerMessage, Settings, WeatherNow, WeatherTestResult } from '@onair-desk/shared';
import { AirStateStore } from '../src/air/state.js';
import {
  WEATHER_POLL_MS,
  WEATHER_RETRY_MS,
  WeatherManager,
} from '../src/connectors/weather/manager.js';
import {
  OpenMeteoConnector,
  WeatherError,
  parseOpenMeteo,
  weatherErrorCode,
  type WeatherConnector,
} from '../src/connectors/weather/openmeteo.js';
import { createRepos, openMemoryDatabase } from '../src/db/index.js';
import { defaultSettings } from '../src/db/settings.js';
import type { Hub } from '../src/ws/hub.js';
import { client, createTestApp, setupAdmin } from './helpers.js';

/** Réponse d'Open-Meteo (forme documentée), pour Vichy. */
const RESPONSE = {
  latitude: 46.12,
  longitude: 3.42,
  timezone: 'Europe/Paris',
  current_units: { temperature_2m: '°C' },
  current: { time: '2026-11-03T14:00', temperature_2m: 12.4, weather_code: 2, is_day: 1 },
  daily: {
    time: ['2026-11-03'],
    temperature_2m_max: [14.1],
    temperature_2m_min: [6.3],
  },
};
const VICHY = { provider: 'openmeteo' as const, city: 'Vichy', latitude: 46.13, longitude: 3.43 };

describe('Open-Meteo', () => {
  it('lit la réponse : température, code, jour, extrêmes du jour', () => {
    expect(parseOpenMeteo(RESPONSE, 'Vichy')).toEqual({
      city: 'Vichy',
      temperature: 12.4,
      code: 2,
      isDay: true,
      min: 6.3,
      max: 14.1,
    });
    const night = { ...RESPONSE, current: { ...RESPONSE.current, is_day: 0 }, daily: undefined };
    expect(parseOpenMeteo(night, 'Vichy')).toMatchObject({ isDay: false, min: null, max: null });
    expect(parseOpenMeteo({ current: { temperature_2m: 'chaud' } }, 'Vichy')).toBeNull();
    expect(parseOpenMeteo('<html>', 'Vichy')).toBeNull();
  });

  describe('contre un faux serveur', () => {
    let server: http.Server;
    let base = '';
    let status = 200;
    let body: unknown = RESPONSE;
    let lastUrl = '';
    beforeEach(async () => {
      status = 200;
      body = RESPONSE;
      server = http.createServer((req, res) => {
        lastUrl = req.url ?? '';
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(typeof body === 'string' ? body : JSON.stringify(body));
      });
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    });
    afterEach(() => new Promise<void>((r) => server.close(() => r())));

    it('demande la météo actuelle et les extrêmes du jour, dans le fuseau de la station', async () => {
      const now = await new OpenMeteoConnector(VICHY, 'Europe/Paris', base).current();
      expect(now.temperature).toBe(12.4);
      const q = new URL(lastUrl, base);
      expect(q.pathname).toBe('/v1/forecast');
      expect(q.searchParams.get('latitude')).toBe('46.13');
      expect(q.searchParams.get('timezone')).toBe('Europe/Paris');
      expect(q.searchParams.get('current')).toContain('weather_code');
    });

    it('erreurs : HTTP, réponse illisible, serveur injoignable', async () => {
      const c = new OpenMeteoConnector(VICHY, 'UTC', base);
      status = 500;
      expect(weatherErrorCode(await c.current().catch((e: unknown) => e))).toBe('weather_http');
      status = 200;
      body = 'pas du json';
      expect(weatherErrorCode(await c.current().catch((e: unknown) => e))).toBe(
        'weather_bad_response',
      );
      const down = new OpenMeteoConnector(VICHY, 'UTC', 'http://127.0.0.1:1');
      expect(weatherErrorCode(await down.current().catch((e: unknown) => e))).toBe(
        'weather_unreachable',
      );
    });
  });
});

describe('gestionnaire météo', () => {
  beforeEach(() => vi.useFakeTimers({ now: Date.UTC(2026, 10, 3, 13, 0, 0) }));
  afterEach(() => vi.useRealTimers());

  /** Fournisseur réglable : valeur, ou panne. */
  class FakeWeather implements WeatherConnector {
    calls = 0;
    error: Error | null = null;
    temperature = 12;
    current(): Promise<WeatherNow> {
      this.calls++;
      if (this.error) return Promise.reject(this.error);
      return Promise.resolve({
        city: 'Vichy',
        temperature: this.temperature,
        code: 3,
        isDay: true,
        min: 5,
        max: 14,
      });
    }
  }

  const setup = (db = openMemoryDatabase()) => {
    const hub = { broadcastStudio: (_: number, _m: ServerMessage) => {} } as unknown as Hub;
    const air = new AirStateStore(hub);
    const repos = createRepos(db);
    const fake = new FakeWeather();
    const manager = new WeatherManager(1, air, repos, Date.now, { connector: () => fake });
    const settings = (over: Partial<Settings['weather']> = {}): Settings => ({
      ...defaultSettings(),
      weather: { ...VICHY, ...over },
    });
    const actions = () =>
      (
        db.prepare("SELECT action FROM audit_log WHERE action LIKE 'weather.%'").all() as {
          action: string;
        }[]
      ).map((r) => r.action);
    return { air, manager, fake, settings, actions, db };
  };

  it('interroge au démarrage puis toutes les 20 minutes', async () => {
    const { air, manager, fake, settings } = setup();
    manager.apply(settings());
    await vi.advanceTimersByTimeAsync(0);
    expect(air.get(1).state.weather).toMatchObject({
      state: 'ok',
      now: { temperature: 12, city: 'Vichy' },
      updatedAt: Date.now(),
    });
    fake.temperature = 9;
    await vi.advanceTimersByTimeAsync(WEATHER_POLL_MS);
    expect(fake.calls).toBe(2);
    expect(air.get(1).state.weather?.now?.temperature).toBe(9);
    // Mêmes paramètres : rien n'est relancé.
    manager.apply(settings());
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.calls).toBe(2);
    manager.stop();
  });

  it('panne : dernière valeur gardée, journal une fois, nouvel essai plus tôt, retour', async () => {
    const { air, manager, fake, settings, actions } = setup();
    manager.apply(settings());
    await vi.advanceTimersByTimeAsync(0);
    const updatedAt = air.get(1).state.weather?.updatedAt;
    fake.error = new WeatherError('weather_unreachable', 'timeout');
    await vi.advanceTimersByTimeAsync(WEATHER_POLL_MS);
    let w = air.get(1).state.weather!;
    expect(w).toMatchObject({ state: 'error', now: { temperature: 12 }, updatedAt });
    expect(w.error).toMatch(/^weather_unreachable/);
    await vi.advanceTimersByTimeAsync(WEATHER_RETRY_MS);
    expect(fake.calls).toBe(3);
    expect(actions()).toEqual(['weather.error']);
    fake.error = null;
    await vi.advanceTimersByTimeAsync(WEATHER_RETRY_MS);
    w = air.get(1).state.weather!;
    expect(w.state).toBe('ok');
    expect(actions()).toEqual(['weather.error', 'weather.recovered']);
    manager.stop();
  });

  it('dernière valeur conservée en base, pour le même lieu seulement ; aucun fournisseur', async () => {
    const db = openMemoryDatabase();
    const first = setup(db);
    first.manager.apply(first.settings());
    await vi.advanceTimersByTimeAsync(0);
    first.manager.stop();

    // Redémarrage, Internet coupé : la dernière valeur s'affiche tout de suite.
    const second = setup(db);
    second.fake.error = new Error('down');
    second.manager.apply(second.settings({ city: 'Vichy (03)' }));
    expect(second.air.get(1).state.weather).toMatchObject({
      now: { temperature: 12, city: 'Vichy (03)' },
    });
    // Autre lieu : rien de conservé.
    second.manager.apply(second.settings({ latitude: 45.77 }));
    expect(second.air.get(1).state.weather?.now).toBeNull();
    second.manager.apply(second.settings({ provider: 'none', city: '' }));
    expect(second.air.get(1).state.weather).toBeNull();
    second.manager.stop();
  });
});

describe('paramètres et bouton « Tester »', () => {
  it('test avec les paramètres saisis ; ville obligatoire ; coordonnées bornées', async () => {
    const fake: WeatherConnector = {
      current: () =>
        Promise.resolve({ city: 'Vichy', temperature: 3, code: 0, isDay: false, min: 1, max: 8 }),
    };
    const built = await createTestApp({ weatherDeps: { connector: () => fake } });
    try {
      const api = client(built.app, await setupAdmin(built));
      let r = (await api('POST', '/api/settings/weather/test', {})).json() as WeatherTestResult;
      expect(r).toEqual({ ok: false, error: 'weather_none', weather: null });
      r = (
        await api('POST', '/api/settings/weather/test', { weather: VICHY })
      ).json() as WeatherTestResult;
      expect(r).toMatchObject({ ok: true, weather: { temperature: 3 } });
      for (const weather of [
        { ...VICHY, city: '' },
        { ...VICHY, latitude: 91 },
        { ...VICHY, longitude: -181 },
      ]) {
        expect((await api('PUT', '/api/settings', { weather })).statusCode).toBe(400);
      }
      expect((await api('PUT', '/api/settings', { weather: VICHY })).statusCode).toBe(200);
      await new Promise((r) => setTimeout(r, 10));
      expect(built.ctx.air.get(1).state.weather).toMatchObject({ state: 'ok' });
    } finally {
      await built.app.close();
    }
  });
});
