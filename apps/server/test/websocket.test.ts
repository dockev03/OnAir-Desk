import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { ServerMessage } from '@onair-desk/shared';
import type { App } from '../src/app.js';
import { ORIGIN, client, cookieFrom, createTestApp, setupAdmin } from './helpers.js';

let built: App;
let url: string;
beforeEach(async () => {
  built = await createTestApp();
  await built.app.listen({ host: '127.0.0.1', port: 0 });
  const addr = built.app.server.address() as { port: number };
  url = `ws://127.0.0.1:${addr.port}/api/ws`;
});
afterEach(() => built.app.close());

function connect(cookie?: string, origin = ORIGIN) {
  const ws = new WebSocket(url, { headers: { origin, ...(cookie ? { cookie } : {}) } });
  const messages: ServerMessage[] = [];
  const waiters: (() => void)[] = [];
  ws.on('message', (d) => {
    messages.push(JSON.parse(d.toString()) as ServerMessage);
    waiters.splice(0).forEach((w) => w());
  });
  const next = async (type: ServerMessage['type']) => {
    for (;;) {
      const m = messages.find((m) => m.type === type);
      if (m) return m;
      await new Promise<void>((r) => waiters.push(r));
    }
  };
  const closed = new Promise<number>((r) => ws.on('close', (code) => r(code)));
  return { ws, next, closed };
}

async function deviceCookie(admin: string) {
  const { device, token } = (
    await client(built.app, admin)('POST', '/api/devices', { name: 'Pi' })
  ).json();
  const res = await client(built.app)('POST', '/api/kiosk/pair', { token });
  return { id: device.id as number, cookie: cookieFrom(res, 'oad_device') };
}

describe('WebSocket', () => {
  it('refuse une connexion sans identité', async () => {
    const { closed } = connect();
    expect(await closed).toBe(4401);
  });

  it('refuse une connexion depuis une autre origine', async () => {
    const admin = await setupAdmin(built);
    const { closed } = connect(admin, 'https://evil.example');
    expect(await closed).toBe(4401);
  });

  it("envoie l'heure serveur et les paramètres, et répond aux pings", async () => {
    const admin = await setupAdmin(built);
    const device = await deviceCookie(admin);
    const c = connect(device.cookie);
    const hello = await c.next('hello');
    expect(hello).toMatchObject({ type: 'hello', settings: { stationName: 'Radio Test' } });
    if (hello.type === 'hello') expect(Math.abs(hello.serverTime - Date.now())).toBeLessThan(5000);

    c.ws.send(JSON.stringify({ type: 'ping', t0: 123 }));
    expect(await c.next('pong')).toMatchObject({ type: 'pong', t0: 123 });
    c.ws.close();
  });

  it('pousse les nouveaux paramètres et coupe un appareil révoqué', async () => {
    const admin = await setupAdmin(built);
    const device = await deviceCookie(admin);
    const c = connect(device.cookie);
    await c.next('hello');

    await client(built.app, admin)('PUT', '/api/settings', {
      stationName: 'Nouveau nom',
      locale: 'fr',
      timezone: 'Europe/Paris',
      timeFormat: '24h',
    });
    expect(await c.next('settings')).toMatchObject({ settings: { stationName: 'Nouveau nom' } });

    await client(built.app, admin)('POST', `/api/devices/${device.id}/revoke`);
    expect(await c.closed).toBe(4403);
  });

  it('pousse le script envoyé au prompteur', async () => {
    const admin = await setupAdmin(built);
    const device = await deviceCookie(admin);
    const c = connect(device.cookie);
    const hello = await c.next('hello');
    expect(hello).toMatchObject({ prompter: { script: null } });

    const script = (
      await client(built.app, admin)('POST', '/api/scripts', { ownerId: null, title: 'Flash' })
    ).json();
    await client(built.app, admin)('POST', '/api/prompter', { scriptId: script.id });
    expect(await c.next('prompter')).toMatchObject({
      prompter: { script: { id: script.id, title: 'Flash' }, deleted: false },
    });
    c.ws.close();
  });

  it('reste en lecture : un message d’écriture (régie) est ignoré', async () => {
    const admin = await setupAdmin(built);
    const c = connect(admin);
    await c.next('hello');
    for (const msg of [
      { type: 'regie.message', text: 'Conclus', urgent: true },
      { type: 'duplex.update', id: 'x', state: 'onair' },
      { type: 'prompter', scriptId: 1 },
    ]) {
      c.ws.send(JSON.stringify(msg));
    }
    // La connexion reste ouverte et répond toujours ; rien n'a changé.
    c.ws.send(JSON.stringify({ type: 'ping', t0: 7 }));
    expect(await c.next('pong')).toMatchObject({ t0: 7 });
    expect(built.ctx.air.get(1).state.regie).toEqual({ message: null, duplex: [] });
    c.ws.close();
  });
});
