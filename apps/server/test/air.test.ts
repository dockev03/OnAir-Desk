import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import type {
  AirMessage,
  AirSnapshot,
  AuditPage,
  ServerMessage,
  Settings,
} from '@onair-desk/shared';
import type { App } from '../src/app.js';
import { AirStateStore } from '../src/air/state.js';
import { AutomationManager, RETRY_MS } from '../src/connectors/manager.js';
import { SIMULATOR_PLAYLIST } from '../src/connectors/simulator.js';
import type { AutomationConnector, ConnectorContext } from '../src/connectors/types.js';
import type { Hub } from '../src/ws/hub.js';
import { ORIGIN, client, cookieFrom, createTestApp, setupAdmin } from './helpers.js';

/** Hub factice : garde les messages diffusés, par studio. */
function fakeHub() {
  const sent: { studioId: number; msg: ServerMessage }[] = [];
  const hub = {
    broadcastStudio: (studioId: number, msg: ServerMessage) => sent.push({ studioId, msg }),
  } as unknown as Hub;
  return { hub, sent };
}

const auditStub = () => {
  const writes: string[] = [];
  return { audit: { write: (_a: unknown, action: string) => writes.push(action) }, writes };
};

const settings = (over: Partial<Settings> = {}) =>
  ({ automationSource: 'simulator', simulatorSpeed: 10, ...over }) as Settings;

describe('état antenne central', () => {
  it('versionne et ne diffuse que les champs modifiés, studio par studio', () => {
    const { hub, sent } = fakeHub();
    const air = new AirStateStore(hub);
    expect(air.get(1).version).toBe(1);

    const source = { id: 'simulator' as const, state: 'ok' as const, updatedAt: 5, error: null };
    expect(air.update(1, { nowPlaying: null, source })).toBe(true);
    expect(air.get(1).version).toBe(2);
    // nowPlaying était déjà null : seul source part.
    expect(sent).toEqual([
      { studioId: 1, msg: { type: 'air', version: 2, full: false, changes: { source } } },
    ]);

    // Rien de changé : ni nouvelle version, ni diffusion.
    expect(air.update(1, { source: { ...source } })).toBe(false);
    expect(air.get(1).version).toBe(2);

    // Studio 2 indépendant.
    air.update(2, { source });
    expect(air.get(2).version).toBe(2);
    expect(sent.at(-1)!.studioId).toBe(2);
    expect(air.full(1)).toMatchObject({ type: 'air', version: 2, full: true });
  });
});

describe('connecteurs d’automation', () => {
  beforeEach(() => vi.useFakeTimers({ now: Date.UTC(2026, 9, 23, 8, 0, 0) }));
  afterEach(() => vi.useRealTimers());

  it('simulateur : titre en cours, titre à venir, enchaînement sans dérive', () => {
    const { hub } = fakeHub();
    const air = new AirStateStore(hub);
    const { audit } = auditStub();
    const manager = new AutomationManager(1, air, audit as never);
    const t0 = Date.now();
    manager.apply(settings());

    let s = air.get(1).state;
    expect(s.source).toMatchObject({ id: 'simulator', state: 'ok' });
    expect(s.nowPlaying).toMatchObject({
      title: SIMULATOR_PLAYLIST[0].title,
      startedAt: t0,
      durationMs: SIMULATOR_PLAYLIST[0].duration * 100,
    });
    expect(s.next).toMatchObject({ title: SIMULATOR_PLAYLIST[1].title, startedAt: null });

    vi.advanceTimersByTime(SIMULATOR_PLAYLIST[0].duration * 100);
    s = air.get(1).state;
    expect(s.nowPlaying).toMatchObject({
      title: SIMULATOR_PLAYLIST[1].title,
      startedAt: t0 + SIMULATOR_PLAYLIST[0].duration * 100,
    });

    // Même configuration : pas de redémarrage. Source « aucune » : tout s'efface.
    const version = air.get(1).version;
    manager.apply(settings());
    expect(air.get(1).version).toBe(version);
    manager.apply(settings({ automationSource: 'none' }));
    s = air.get(1).state;
    expect(s).toMatchObject({ nowPlaying: null, next: null, source: { id: 'none' } });
    // Plus aucun changement ensuite (le simulateur est bien arrêté).
    const after = air.get(1).version;
    vi.advanceTimersByTime(3600_000);
    expect(air.get(1).version).toBe(after);
    manager.stop();
  });

  it('connecteur en erreur : état « erreur », journalisé une fois, nouvel essai', () => {
    const { hub } = fakeHub();
    const air = new AirStateStore(hub);
    const { audit, writes } = auditStub();
    let attempts = 0;
    const flaky: AutomationConnector = {
      start(ctx: ConnectorContext) {
        attempts++;
        if (attempts < 3) throw new Error('base injoignable');
        ctx.update({ nowPlaying: null, next: null });
      },
      stop() {},
    };
    const manager = new AutomationManager(1, air, audit as never);
    // Accès au lancement interne pour injecter un faux connecteur.
    (manager as unknown as { launch(c: () => AutomationConnector): void }).launch(() => flaky);

    expect(air.get(1).state.source).toMatchObject({ state: 'error', error: 'base injoignable' });
    vi.advanceTimersByTime(RETRY_MS);
    expect(attempts).toBe(2);
    expect(writes).toEqual(['automation.error']);
    vi.advanceTimersByTime(RETRY_MS);
    expect(air.get(1).state.source.state).toBe('ok');
    expect(writes).toEqual(['automation.error', 'automation.recovered']);
    manager.stop();
  });
});

describe('WebSocket et paramètres', () => {
  let built: App;
  let url: string;
  beforeEach(async () => {
    built = await createTestApp();
    await built.app.listen({ host: '127.0.0.1', port: 0 });
    url = `ws://127.0.0.1:${(built.app.server.address() as { port: number }).port}/api/ws`;
  });
  afterEach(() => built.app.close());

  function connect(cookie: string) {
    const ws = new WebSocket(url, { headers: { origin: ORIGIN, cookie } });
    const messages: ServerMessage[] = [];
    let wake: () => void = () => {};
    ws.on('message', (d) => {
      messages.push(JSON.parse(d.toString()) as ServerMessage);
      wake();
    });
    const until = async (pred: (m: ServerMessage) => boolean) => {
      for (;;) {
        const m = messages.find(pred);
        if (m) return m;
        await new Promise<void>((r) => (wake = r));
      }
    };
    return { ws, messages, until };
  }

  it('hello avec studio et état complet, différentiels, resynchronisation', async () => {
    const admin = await setupAdmin(built);
    const { token } = (
      await client(built.app, admin)('POST', '/api/devices', { name: 'Pi' })
    ).json();
    const device = cookieFrom(
      await client(built.app)('POST', '/api/kiosk/pair', { token }),
      'oad_device',
    );
    const c = connect(device);
    const hello = await c.until((m) => m.type === 'hello');
    expect(hello).toMatchObject({
      studio: { id: 1, name: 'Studio' },
      air: { state: { nowPlaying: null, source: { id: 'none' } } },
    });
    const v0 = (hello as { air: AirSnapshot }).air.version;

    // L'admin choisit le simulateur : l'écran reçoit le différentiel.
    const res = await client(built.app, admin)('PUT', '/api/settings', {
      automationSource: 'simulator',
      simulatorSpeed: 60,
    });
    expect((res.json() as Settings).automationSource).toBe('simulator');
    const diff = (await c.until(
      (m) => m.type === 'air' && !m.full && m.changes.nowPlaying != null,
    )) as AirMessage;
    expect(diff.version).toBeGreaterThan(v0);
    expect(diff.changes.nowPlaying!.title).toBe(SIMULATOR_PLAYLIST[0].title);

    // Demande d'état complet, limitée à une par seconde.
    c.ws.send(JSON.stringify({ type: 'air.sync' }));
    c.ws.send(JSON.stringify({ type: 'air.sync' }));
    const full = (await c.until((m) => m.type === 'air' && m.full)) as AirMessage;
    expect(full.changes.source).toMatchObject({ id: 'simulator', state: 'ok' });
    await new Promise((r) => setTimeout(r, 100));
    expect(c.messages.filter((m) => m.type === 'air' && m.full)).toHaveLength(1);

    // État consultable pour la page Paramètres.
    const snap = (await client(built.app, admin)('GET', '/api/air')).json() as AirSnapshot;
    expect(snap.state.source.state).toBe('ok');

    // Changement de source journalisé.
    const page = (
      await client(built.app, admin)('GET', '/api/audit?category=antenne')
    ).json() as AuditPage;
    expect(page.entries[0]).toMatchObject({
      action: 'automation.source_changed',
      actorName: 'Admin',
      studioId: 1,
      details: { from: 'none', to: 'simulator', speed: 60 },
    });
    c.ws.close();
  });

  it('prompteur et état antenne isolés par studio', async () => {
    const admin = await setupAdmin(built);
    const { db } = built.ctx.repos;
    db.prepare("INSERT INTO studios (id, name) VALUES (2, 'Studio 2')").run();
    const { device, token } = (
      await client(built.app, admin)('POST', '/api/devices', { name: 'Pi 2' })
    ).json();
    db.prepare('UPDATE devices SET studio_id = 2 WHERE id = ?').run(device.id);
    const kiosk2 = cookieFrom(
      await client(built.app)('POST', '/api/kiosk/pair', { token }),
      'oad_device',
    );
    const c = connect(kiosk2);
    expect(await c.until((m) => m.type === 'hello')).toMatchObject({ studio: { id: 2 } });

    const s = (
      await client(built.app, admin)('POST', '/api/scripts', { ownerId: null, title: 'Flash' })
    ).json();
    // Le poste (studio par défaut) affiche un script : l'écran du studio 2 n'est pas touché.
    await client(built.app, admin)('POST', '/api/prompter', { scriptId: s.id });
    const p2 = (await client(built.app, kiosk2)('GET', '/api/prompter')).json();
    expect(p2.script).toBeNull();
    const p1 = (await client(built.app, admin)('GET', '/api/prompter')).json();
    expect(p1.script.title).toBe('Flash');

    // Le simulateur tourne pour le studio par défaut seulement.
    await client(built.app, admin)('PUT', '/api/settings', { automationSource: 'simulator' });
    await new Promise((r) => setTimeout(r, 100));
    expect(c.messages.some((m) => m.type === 'air' || m.type === 'prompter')).toBe(false);
    c.ws.close();
  });
});
