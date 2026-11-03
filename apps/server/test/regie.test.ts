import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  REGIE_SEND_PER_MINUTE,
  type DuplexLine,
  type LogbookView,
  type PrompterState,
  type PublicUser,
  type RegieMessage,
  type Rundown,
  type RundownItemInput,
} from '@onair-desk/shared';
import type { App } from '../src/app.js';
import { openDatabase } from '../src/db/database.js';
import { migrations } from '../src/db/migrations.js';
import { createRepos } from '../src/db/index.js';
import { client, cookieFrom, createTestApp, createUser, setupAdmin } from './helpers.js';

let built: App;
afterEach(async () => {
  await built?.app.close();
});

const item = (uid: string, over: Partial<RundownItemInput> = {}): RundownItemInput => ({
  uid,
  typeId: 'jingle',
  title: `Élément ${uid}`,
  durationSeconds: 60,
  notes: '',
  scriptId: null,
  artist: '',
  year: null,
  introSeconds: null,
  tags: [],
  cuttable: false,
  ...over,
});

/** Admin, animateur sans le droit, réalisateur, écran studio appairé. */
async function start() {
  built = await createTestApp();
  const admin = await setupAdmin(built);
  const jean = await createUser(built, admin, 'jean');
  const paul = await createUser(built, admin, 'paul');
  const promoted = await client(built.app, admin)('PATCH', `/api/users/${paul.id}`, {
    isDirector: true,
  });
  expect(promoted.statusCode, promoted.body).toBe(200);
  const { token } = (
    await client(built.app, admin)('POST', '/api/devices', { name: 'Afficheur' })
  ).json();
  const kiosk = cookieFrom(
    await client(built.app)('POST', '/api/kiosk/pair', { token }),
    'oad_device',
  );
  return {
    admin: client(built.app, admin),
    jean: { ...jean, api: client(built.app, jean.cookie) },
    paul: { ...paul, api: client(built.app, paul.cookie) },
    kiosk: client(built.app, kiosk),
  };
}

const regie = () => built.ctx.air.get(1).state.regie;

const enableOrders = (api: ReturnType<typeof client>) =>
  api('PUT', '/api/settings', {
    regie: {
      messageTtlMinutes: 5,
      kioskSeen: true,
      orders: [
        { id: 'conclus', label: 'Conclus', urgent: true, active: true },
        { id: 'etire', label: 'Étire', urgent: false, active: false },
      ],
    },
  });

describe('droit « Réalisateur »', () => {
  it('case sur le compte, cumulable avec animateur, tracée avec ancien et nouvel état', async () => {
    const { admin, paul } = await start();
    const users = (await admin('GET', '/api/users')).json() as PublicUser[];
    expect(users.find((u) => u.id === paul.id)).toMatchObject({
      role: 'animateur',
      isDirector: true,
    });
    const me = (await paul.api('GET', '/api/auth/me')).json();
    expect(me.user.isDirector).toBe(true);
    const row = built.ctx.repos.db
      .prepare("SELECT details FROM audit_log WHERE action = 'user.updated' ORDER BY id DESC")
      .get() as { details: string };
    expect(JSON.parse(row.details)).toMatchObject({ isDirector: { from: false, to: true } });
  });

  it('chaque route de la régie refuse kiosk, animateur sans le droit, et personne', async () => {
    const { jean, kiosk } = await start();
    built.ctx.regie.addDuplex(1, built.ctx.repos.users.findById(1)!, 'Moulins');
    const lineId = regie().duplex[0]!.id;
    const routes: [Parameters<typeof jean.api>[0], string, unknown?][] = [
      ['POST', '/api/regie/message', { text: 'x', urgent: false }],
      ['DELETE', '/api/regie/message'],
      ['POST', '/api/regie/order/conclus'],
      ['POST', '/api/regie/liner/station'],
      ['POST', '/api/regie/duplex', { name: 'X' }],
      ['PATCH', `/api/regie/duplex/${lineId}`, { state: 'ready' }],
      ['DELETE', `/api/regie/duplex/${lineId}`],
      ['DELETE', '/api/regie/duplex'],
      ['POST', '/api/regie/logbook', { text: 'x' }],
      ['GET', '/api/regie/logbook?rundownId=1'],
    ];
    const anonymous = client(built.app);
    for (const [method, url, body] of routes) {
      expect((await jean.api(method, url, body)).statusCode, `${method} ${url}`).toBe(403);
      expect((await kiosk(method, url, body)).statusCode, `${method} ${url}`).toBe(403);
      expect((await anonymous(method, url, body)).statusCode, `${method} ${url}`).toBe(401);
    }
    expect(regie().message).toBeNull();
    expect(regie().duplex[0]!.state).toBe('waiting');
  });

  it('compte désactivé : plus aucun envoi', async () => {
    const { admin, paul } = await start();
    await admin('PATCH', `/api/users/${paul.id}`, { isActive: false });
    const res = await paul.api('POST', '/api/regie/message', { text: 'x', urgent: false });
    expect(res.statusCode).toBe(401);
  });
});

describe('messages et ordres', () => {
  it('envoi, remplacement, effacement ; journal', async () => {
    const { paul } = await start();
    const sent = await paul.api('POST', '/api/regie/message', { text: 'Accélère', urgent: false });
    expect(sent.statusCode, sent.body).toBe(200);
    const first = sent.json() as RegieMessage;
    expect(first).toMatchObject({ kind: 'message', text: 'Accélère', byName: 'paul' });
    expect(first.expiresAt - first.sentAt).toBe(5 * 60_000);
    expect(regie().message?.id).toBe(first.id);

    const second = (
      await paul.api('POST', '/api/regie/message', { text: 'Conclus', urgent: true })
    ).json() as RegieMessage;
    expect(regie().message).toMatchObject({ id: second.id, urgent: true });

    expect((await paul.api('DELETE', '/api/regie/message')).statusCode).toBe(204);
    expect(regie().message).toBeNull();
    // Rien à effacer : sans effet, rien au journal.
    expect((await paul.api('DELETE', '/api/regie/message')).statusCode).toBe(204);

    const actions = built.ctx.repos.db
      .prepare("SELECT action FROM audit_log WHERE category = 'regie' ORDER BY id")
      .all() as { action: string }[];
    expect(actions.map((a) => a.action)).toEqual([
      'regie.message_sent',
      'regie.message_sent',
      'regie.message_cleared',
    ]);
  });

  it('texte invalide refusé (vide, trop long, caractère de contrôle)', async () => {
    const { paul } = await start();
    for (const text of ['', 'x'.repeat(201), 'a\nb']) {
      const res = await paul.api('POST', '/api/regie/message', { text, urgent: false });
      expect(res.statusCode).toBe(400);
    }
  });

  it('ordre rapide actif seulement ; carte de liner active seulement', async () => {
    const { admin, paul } = await start();
    expect((await enableOrders(admin)).statusCode).toBe(200);
    const order = await paul.api('POST', '/api/regie/order/conclus');
    expect(order.json()).toMatchObject({ kind: 'order', text: 'Conclus', urgent: true });
    expect((await paul.api('POST', '/api/regie/order/etire')).statusCode).toBe(404);
    expect((await paul.api('POST', '/api/regie/liner/station')).statusCode).toBe(404);
    await admin('PUT', '/api/settings', {
      liners: {
        items: [{ id: 'station', text: 'Vous écoutez Radio Test', active: true }],
        rotationSeconds: 20,
      },
    });
    const liner = await paul.api('POST', '/api/regie/liner/station');
    expect(liner.json()).toMatchObject({ kind: 'liner', text: 'Vous écoutez Radio Test' });
    const row = built.ctx.repos.db
      .prepare("SELECT action, details FROM audit_log WHERE category = 'regie' ORDER BY id")
      .all() as { action: string; details: string }[];
    expect(row.map((r) => r.action)).toEqual(['regie.order_sent', 'regie.order_sent']);
    expect(JSON.parse(row[0]!.details)).toMatchObject({ ref: 'conclus' });
  });

  it('expiration : le message disparaît de l’état antenne', async () => {
    let now = 1_000_000;
    built = await createTestApp();
    const admin = await setupAdmin(built);
    const user = built.ctx.repos.users.findByUsername('admin')!;
    void admin;
    const { RegieService } = await import('../src/regie.js');
    const svc = new RegieService(built.ctx.repos, built.ctx.air, () => now);
    svc.send(1, user, { kind: 'message', text: 'x', urgent: false });
    expect(regie().message).not.toBeNull();
    // Redémarrage après l'expiration : le message n'est pas réaffiché.
    now += 6 * 60_000;
    svc.restore(1);
    expect(regie().message).toBeNull();
    svc.stop();
  });

  it('accusé « Vu » : écran studio seulement, une fois, désactivable', async () => {
    const { admin, paul, jean, kiosk } = await start();
    const m = (
      await paul.api('POST', '/api/regie/message', { text: 'Pub dans 1 min', urgent: false })
    ).json() as RegieMessage;
    expect((await jean.api('POST', '/api/studio/regie/seen', { id: m.id })).statusCode).toBe(403);
    expect((await kiosk('POST', '/api/studio/regie/seen', { id: 'autre' })).statusCode).toBe(404);
    const seen = await kiosk('POST', '/api/studio/regie/seen', { id: m.id });
    expect(seen.statusCode, seen.body).toBe(200);
    const at = (seen.json() as RegieMessage).seenAt;
    expect(at).not.toBeNull();
    expect(
      ((await kiosk('POST', '/api/studio/regie/seen', { id: m.id })).json() as RegieMessage).seenAt,
    ).toBe(at);
    const entry = built.ctx.repos.db
      .prepare("SELECT actor_type, actor_name FROM audit_log WHERE action = 'regie.message_seen'")
      .all() as { actor_type: string; actor_name: string }[];
    expect(entry).toEqual([{ actor_type: 'device', actor_name: 'Afficheur' }]);

    await admin('PUT', '/api/settings', {
      regie: { messageTtlMinutes: 5, kioskSeen: false, orders: [] },
    });
    const m2 = (
      await paul.api('POST', '/api/regie/message', { text: 'Encore', urgent: false })
    ).json() as RegieMessage;
    const refused = await kiosk('POST', '/api/studio/regie/seen', { id: m2.id });
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({ error: 'regie_seen_disabled' });
  });

  it(`débit : ${REGIE_SEND_PER_MINUTE} envois par minute et par compte`, async () => {
    const { paul, admin } = await start();
    for (let i = 0; i < REGIE_SEND_PER_MINUTE; i++) {
      const res = await paul.api('POST', '/api/regie/message', { text: `m${i}`, urgent: false });
      expect(res.statusCode).toBe(200);
    }
    const over = await paul.api('POST', '/api/regie/message', { text: 'trop', urgent: false });
    expect(over.statusCode).toBe(429);
    expect(over.json()).toMatchObject({ error: 'rate_limited' });
    // Un autre compte n'est pas concerné.
    expect(
      (await admin('POST', '/api/regie/message', { text: 'ok', urgent: false })).statusCode,
    ).toBe(200);
  });
});

describe('duplex', () => {
  it('création (6 au plus), états, suppression, tout effacer ; journal', async () => {
    const { paul } = await start();
    const created = await paul.api('POST', '/api/regie/duplex', { name: 'Correspondant Moulins' });
    expect(created.statusCode).toBe(201);
    const line = created.json() as DuplexLine;
    expect(line.state).toBe('waiting');
    const ready = await paul.api('PATCH', `/api/regie/duplex/${line.id}`, { state: 'ready' });
    expect((ready.json() as DuplexLine).state).toBe('ready');
    expect(
      (await paul.api('PATCH', `/api/regie/duplex/${line.id}`, { state: 'live' })).statusCode,
    ).toBe(400);
    for (let i = 0; i < 5; i++)
      await paul.api('POST', '/api/regie/duplex', { name: `Invité ${i}` });
    const seventh = await paul.api('POST', '/api/regie/duplex', { name: 'De trop' });
    expect(seventh.statusCode).toBe(409);
    expect(seventh.json()).toMatchObject({ error: 'duplex_limit' });
    expect((await paul.api('DELETE', `/api/regie/duplex/${line.id}`)).statusCode).toBe(204);
    expect(regie().duplex).toHaveLength(5);
    expect((await paul.api('DELETE', '/api/regie/duplex')).statusCode).toBe(204);
    expect(regie().duplex).toEqual([]);
    const details = (
      built.ctx.repos.db
        .prepare("SELECT details FROM audit_log WHERE action = 'duplex.changed' ORDER BY id")
        .all() as { details: string }[]
    ).map((r) => JSON.parse(r.details).action);
    expect(details).toEqual([
      'created',
      'updated',
      'created',
      'created',
      'created',
      'created',
      'created',
      'removed',
      'cleared',
    ]);
  });

  it('message et duplex conservés en base ; migration 11 : comptes sans le droit', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'regie-db-'));
    try {
      let db = openDatabase(dir, () => {}, migrations.slice(0, 10));
      db.prepare(
        "INSERT INTO users (username, display_name, password_hash, role) VALUES ('a', 'A', 'h', 'animateur')",
      ).run();
      db.close();
      db = openDatabase(dir);
      const repos = createRepos(db);
      expect(repos.users.findByUsername('a')?.isDirector).toBe(false);
      const line = { id: 'd1', name: 'Moulins', state: 'onair' as const, changedAt: 1 };
      repos.regie.set(1, { message: null, duplex: [line] });
      db.close();
      db = openDatabase(dir);
      expect(createRepos(db).regie.get(1)).toEqual({ message: null, duplex: [line] });
      db.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('conducteur modifié en direct', () => {
  async function onAirRundown(api: ReturnType<typeof client>, ownerId: number) {
    const res = await api('POST', '/api/rundowns', {
      ownerId,
      title: 'La matinale',
      airDate: '2026-10-22',
      startTime: '07:00',
      items: [item('a'), item('b'), item('c')],
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json() as Rundown;
  }

  it('réalisateur : éléments du conducteur suivi seulement ; signalé à l’écran ; tracé', async () => {
    const { jean, paul, kiosk } = await start();
    const r = await onAirRundown(jean.api, jean.id);
    // Pas encore à l'antenne : refusé.
    const before = await paul.api('PATCH', `/api/rundowns/${r.id}`, {
      version: r.version,
      items: [item('a')],
    });
    expect(before.statusCode).toBe(403);
    expect(((await paul.api('GET', `/api/rundowns/${r.id}`)).json() as Rundown).liveEdit).toBe(
      false,
    );

    await kiosk('POST', '/api/prompter', { rundownId: r.id, itemUid: 'a' });
    expect(((await paul.api('GET', `/api/rundowns/${r.id}`)).json() as Rundown).liveEdit).toBe(
      true,
    );
    expect(((await jean.api('GET', `/api/rundowns/${r.id}`)).json() as Rundown).liveEdit).toBe(
      false,
    );

    // Seulement les éléments.
    const title = await paul.api('PATCH', `/api/rundowns/${r.id}`, {
      version: r.version,
      title: 'Autre',
    });
    expect(title.statusCode).toBe(403);
    expect(title.json()).toMatchObject({ error: 'live_edit_items_only' });

    const saved = await paul.api('PATCH', `/api/rundowns/${r.id}`, {
      version: r.version,
      items: [item('a'), item('c'), item('b', { durationSeconds: 90 }), item('d')],
    });
    expect(saved.statusCode, saved.body).toBe(200);
    const prompter = (await kiosk('GET', '/api/prompter')).json() as PrompterState;
    expect(prompter.rundown?.items.map((i) => i.uid)).toEqual(['a', 'c', 'b', 'd']);
    expect(built.ctx.air.get(1).state.liveChange).toMatchObject({
      rundownId: r.id,
      byName: 'paul',
      added: ['d'],
      changed: ['b'],
      removed: 0,
    });
    const audit = built.ctx.repos.db
      .prepare("SELECT details FROM audit_log WHERE action = 'rundown.live_edited'")
      .all() as { details: string }[];
    expect(audit).toHaveLength(1);
    expect(JSON.parse(audit[0]!.details)).toMatchObject({
      added: ['Élément d'],
      title: 'La matinale',
    });

    // Conflit de version : celui qui enregistre en second recharge.
    const stale = await paul.api('PATCH', `/api/rundowns/${r.id}`, {
      version: r.version,
      items: [item('a')],
    });
    expect(stale.statusCode).toBe(409);

    // Un autre conducteur suivi : le précédent n'est plus modifiable par la régie.
    const other = await onAirRundown(jean.api, jean.id);
    await kiosk('POST', '/api/prompter', { rundownId: other.id, itemUid: 'a' });
    const current = (await paul.api('GET', `/api/rundowns/${r.id}`)).json() as Rundown;
    const after = await paul.api('PATCH', `/api/rundowns/${r.id}`, {
      version: current.version,
      items: [item('a')],
    });
    expect(after.statusCode).toBe(403);
  });

  it('modification par le propriétaire : signalée à l’écran, non tracée', async () => {
    const { jean, jean: owner, kiosk } = await start();
    const r = await onAirRundown(jean.api, owner.id);
    await kiosk('POST', '/api/prompter', { rundownId: r.id, itemUid: 'a' });
    await jean.api('PATCH', `/api/rundowns/${r.id}`, { version: r.version, items: [item('a')] });
    expect(built.ctx.air.get(1).state.liveChange).toMatchObject({ byName: 'jean', removed: 2 });
    const n = built.ctx.repos.db
      .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'rundown.live_edited'")
      .get() as { n: number };
    expect(n.n).toBe(0);
  });
});

describe('conducteur à l’antenne d’après ses heures', () => {
  it('émission en cours, non suivie à l’écran : modifiable par la régie, signalée', async () => {
    const { jean, paul } = await start();
    const local = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Europe/Paris',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(Date.now() - 5 * 60_000));
    const [airDate, startTime] = local.split(' ') as [string, string];
    const r = (
      await jean.api('POST', '/api/rundowns', {
        ownerId: jean.id,
        title: 'En cours',
        airDate,
        startTime,
        items: [item('a', { durationSeconds: 3600 })],
      })
    ).json() as Rundown;
    expect(((await paul.api('GET', `/api/rundowns/${r.id}`)).json() as Rundown).liveEdit).toBe(
      true,
    );
    const saved = await paul.api('PATCH', `/api/rundowns/${r.id}`, {
      version: r.version,
      items: [item('a', { durationSeconds: 3600 }), item('b')],
    });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(built.ctx.air.get(1).state.liveChange).toMatchObject({ rundownId: r.id, added: ['b'] });
  });
});

describe('main courante', () => {
  it('notes (heure corrigée bornée), vue filtrée par conducteur et fenêtre', async () => {
    const { jean, paul, kiosk } = await start();
    // Émission en cours : maintenant, à l'heure de la station.
    const local = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Europe/Paris',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(Date.now() - 5 * 60_000));
    const [airDate, startTime] = local.split(' ') as [string, string];
    const r = (
      await jean.api('POST', '/api/rundowns', {
        ownerId: jean.id,
        title: 'Le direct',
        airDate,
        startTime,
        items: [item('a')],
      })
    ).json() as Rundown;
    await kiosk('POST', '/api/prompter', { rundownId: r.id, itemUid: 'a' });
    await paul.api('POST', '/api/regie/message', { text: 'Accélère', urgent: false });

    const note = await paul.api('POST', '/api/regie/logbook', { text: 'Coupure du duplex' });
    expect(note.statusCode, note.body).toBe(201);
    const backdated = await paul.api('POST', '/api/regie/logbook', {
      text: 'Invité en retard',
      at: Date.now() - 60 * 60_000,
    });
    expect(backdated.statusCode).toBe(201);
    const tooOld = await paul.api('POST', '/api/regie/logbook', {
      text: 'Trop ancien',
      at: Date.now() - 3 * 60 * 60_000,
    });
    expect(tooOld.statusCode).toBe(400);
    expect(tooOld.json()).toMatchObject({ error: 'note_time' });

    const view = (
      await paul.api('GET', `/api/regie/logbook?rundownId=${r.id}`)
    ).json() as LogbookView;
    expect(view.rundown.title).toBe('Le direct');
    const actions = view.entries.map((e) => e.action);
    // La note datée d'il y a une heure passe en tête (avant la fenêtre, mais rattachée).
    expect(actions[0]).toBe('logbook.note');
    expect(view.entries[0]!.details).toMatchObject({ text: 'Invité en retard' });
    expect(actions).toContain('prompter.sent');
    expect(actions).toContain('regie.message_sent');
    // Aucune entrée hors des catégories régie et antenne.
    expect(view.entries.every((e) => e.category === 'regie' || e.category === 'antenne')).toBe(
      true,
    );
    expect((await paul.api('GET', '/api/regie/logbook?rundownId=9999')).statusCode).toBe(404);
  });
});
