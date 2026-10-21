import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { App } from '../src/app.js';
import { ADMIN_PASSWORD, client, cookieFrom, createTestApp } from './helpers.js';

let built: App;
beforeEach(async () => (built = await createTestApp()));
afterEach(() => built.app.close());

const body = (code: string) => ({
  code,
  station: { stationName: 'Radio Test', locale: 'fr', timezone: 'Europe/Paris' },
  admin: { username: 'Admin', displayName: 'Admin', password: ADMIN_PASSWORD },
});

describe('assistant de premier lancement', () => {
  it("signale qu'une installation est nécessaire", async () => {
    const res = await client(built.app)('GET', '/api/setup/status');
    expect(res.json()).toEqual({ needsSetup: true });
  });

  it('refuse un mauvais code', async () => {
    const res = await client(built.app)('POST', '/api/setup', body('AAAA-BBBB-CCCC'));
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('bad_setup_code');
  });

  it("crée l'admin, ouvre une session puis se ferme définitivement", async () => {
    const code = built.ctx.setup.ensure(true)!;
    // Le code est accepté sans tirets et en minuscules (recopie manuelle).
    const res = await client(built.app)(
      'POST',
      '/api/setup',
      body(code.replace(/-/g, '').toLowerCase()),
    );
    expect(res.statusCode).toBe(200);
    expect(res.json().user).toMatchObject({ username: 'admin', role: 'admin' });
    expect(res.json().user.passwordHash).toBeUndefined();

    const session = res.cookies.find((c) => c.name === 'oad_session')!;
    expect(session.httpOnly).toBe(true);
    expect(session.sameSite).toBe('Strict');

    const me = await client(built.app, cookieFrom(res, 'oad_session'))('GET', '/api/auth/me');
    expect(me.json()).toMatchObject({ kind: 'user', user: { username: 'admin' } });

    const settings = await client(built.app, cookieFrom(res, 'oad_session'))(
      'GET',
      '/api/settings',
    );
    expect(settings.json()).toMatchObject({ stationName: 'Radio Test', timezone: 'Europe/Paris' });

    const again = await client(built.app)('POST', '/api/setup', body(code));
    expect(again.statusCode).toBe(409);
    expect((await client(built.app)('GET', '/api/setup/status')).json()).toEqual({
      needsSetup: false,
    });
  });
});

describe('protection CSRF', () => {
  it('refuse une écriture sans en-tête Origin', async () => {
    const res = await built.app.inject({ method: 'POST', url: '/api/auth/login', payload: {} });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('bad_origin');
  });

  it('refuse une écriture depuis un autre site', async () => {
    const res = await built.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: 'https://evil.example' },
      payload: { username: 'admin', password: 'x' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('en-têtes de sécurité', () => {
  it('pose une politique CSP stricte', async () => {
    const res = await client(built.app)('GET', '/api/health');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it("renvoie 404 en JSON pour une route d'API inconnue", async () => {
    const res = await client(built.app)('GET', '/api/inconnue');
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not_found' });
  });
});
