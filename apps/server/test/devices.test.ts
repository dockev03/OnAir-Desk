import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { App } from '../src/app.js';
import { client, cookieFrom, createTestApp, setupAdmin } from './helpers.js';

let built: App;
let admin: string;
beforeEach(async () => {
  built = await createTestApp();
  admin = await setupAdmin(built);
});
afterEach(() => built.app.close());

async function createDevice(name = 'Pi studio 1') {
  const res = await client(built.app, admin)('POST', '/api/devices', { name });
  expect(res.statusCode).toBe(201);
  return res.json() as { device: { id: number }; token: string };
}

async function pair(token: string) {
  return client(built.app)('POST', '/api/kiosk/pair', { token });
}

describe('appareils kiosk', () => {
  it('le jeton est montré une seule fois et stocké haché', async () => {
    const { token } = await createDevice();
    const list = await client(built.app, admin)('GET', '/api/devices');
    expect(list.body).not.toContain(token);
    const row = built.ctx.repos.db.prepare('SELECT token_hash FROM devices').get() as {
      token_hash: string;
    };
    expect(row.token_hash).not.toBe(token);
  });

  it("l'appairage pose un cookie d'appareil httpOnly", async () => {
    const { token } = await createDevice();
    const res = await pair(token);
    expect(res.statusCode).toBe(200);
    const c = res.cookies.find((c) => c.name === 'oad_device')!;
    expect(c.httpOnly).toBe(true);
    expect(c.maxAge).toBeGreaterThan(0);
    const me = await client(built.app, cookieFrom(res, 'oad_device'))('GET', '/api/auth/me');
    expect(me.json()).toMatchObject({ kind: 'device', device: { name: 'Pi studio 1' } });
  });

  it('refuse un jeton inconnu', async () => {
    const res = await pair('x'.repeat(43));
    expect(res.statusCode).toBe(401);
  });

  it('un appareil peut lire mais jamais écrire, quelle que soit la route', async () => {
    const { token } = await createDevice();
    const device = cookieFrom(await pair(token), 'oad_device');
    const c = client(built.app, device);
    expect((await c('GET', '/api/settings')).statusCode).toBe(200);
    for (const [method, url] of [
      ['PUT', '/api/settings'],
      ['POST', '/api/users'],
      ['POST', '/api/devices'],
      ['POST', '/api/auth/password'],
    ] as const) {
      const res = await c(method, url, {});
      expect(res.statusCode, `${method} ${url}`).toBe(403);
      expect(res.json().error).toBe('read_only_device');
    }
    expect((await c('GET', '/api/users')).statusCode).toBe(401);
  });

  it('la révocation coupe immédiatement l’accès', async () => {
    const { device, token } = await createDevice();
    const cookie = cookieFrom(await pair(token), 'oad_device');
    await client(built.app, admin)('POST', `/api/devices/${device.id}/revoke`);
    expect((await client(built.app, cookie)('GET', '/api/auth/me')).statusCode).toBe(401);
    expect((await pair(token)).statusCode).toBe(401);
  });

  it("la régénération invalide l'ancien jeton et réactive l'appareil", async () => {
    const { device, token } = await createDevice();
    await client(built.app, admin)('POST', `/api/devices/${device.id}/revoke`);
    const regen = await client(built.app, admin)('POST', `/api/devices/${device.id}/regenerate`);
    expect(regen.statusCode).toBe(200);
    const fresh = regen.json().token as string;
    expect(fresh).not.toBe(token);
    expect((await pair(token)).statusCode).toBe(401);
    expect((await pair(fresh)).statusCode).toBe(200);
  });
});
