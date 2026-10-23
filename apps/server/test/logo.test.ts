import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MAX_LOGO_BYTES, type Settings } from '@onair-desk/shared';
import type { App } from '../src/app.js';
import { client, createTestApp, createUser, setupAdmin } from './helpers.js';

let built: App;
let admin: string;

beforeEach(async () => {
  built = await createTestApp();
  admin = await setupAdmin(built);
});
afterEach(() => built.app.close());

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 1),
]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

const upload = (cookie: string, data: Buffer) =>
  client(built.app, cookie)('PUT', '/api/settings/logo', { data: data.toString('base64') });

describe('logo de la station', () => {
  it('admin seul ; servi sans connexion avec le bon type et le cache', async () => {
    const jean = await createUser(built, admin, 'jean');
    expect((await upload(jean.cookie, PNG)).statusCode).toBe(403);

    const res = await upload(admin, PNG);
    expect(res.statusCode, res.body).toBe(200);
    const { logoHash } = res.json() as Settings;
    expect(logoHash).toMatch(/^[a-f0-9]{16}$/);

    // Lecture publique (page de connexion, écran studio).
    const anon = await built.app.inject({ method: 'GET', url: '/api/station/logo' });
    expect(anon.statusCode).toBe(200);
    expect(anon.headers['content-type']).toBe('image/png');
    expect(anon.headers['x-content-type-options']).toBe('nosniff');
    expect(anon.headers['cache-control']).toBe('no-cache');
    expect(anon.rawPayload.equals(PNG)).toBe(true);

    const versioned = await built.app.inject({ url: `/api/station/logo?v=${logoHash}` });
    expect(versioned.headers['cache-control']).toContain('immutable');
    const again = await built.app.inject({
      url: '/api/station/logo',
      headers: { 'if-none-match': `"${logoHash}"` },
    });
    expect(again.statusCode).toBe(304);

    // L'empreinte est diffusée avec les paramètres, qui ne permettent pas de la modifier.
    const c = client(built.app, admin);
    expect(((await c('GET', '/api/settings')).json() as Settings).logoHash).toBe(logoHash);
    const put = await c('PUT', '/api/settings', { stationName: 'Radio', logoHash: 'a'.repeat(16) });
    expect((put.json() as Settings).logoHash).toBe(logoHash);

    // Remplacement par un WebP, puis retrait.
    const webp = await upload(admin, WEBP);
    expect((webp.json() as Settings).logoHash).not.toBe(logoHash);
    expect((await built.app.inject({ url: '/api/station/logo' })).headers['content-type']).toBe(
      'image/webp',
    );
    expect(((await c('DELETE', '/api/settings/logo')).json() as Settings).logoHash).toBeNull();
    expect((await built.app.inject({ url: '/api/station/logo' })).statusCode).toBe(404);

    const audit = built.ctx.repos.db
      .prepare("SELECT action FROM audit_log WHERE action LIKE 'logo.%' ORDER BY id")
      .all();
    expect(audit).toEqual([
      { action: 'logo.updated' },
      { action: 'logo.updated' },
      { action: 'logo.removed' },
    ]);
  });

  it('refuse le SVG, un faux PNG et un fichier trop gros', async () => {
    expect((await upload(admin, SVG)).json().error).toBe('logo_type');
    const fake = Buffer.from('ceci n’est pas une image, malgré son nom logo.png');
    expect((await upload(admin, fake)).json().error).toBe('logo_type');

    const big = Buffer.concat([PNG, Buffer.alloc(MAX_LOGO_BYTES)]);
    const res = await upload(admin, big);
    expect(res.statusCode).toBe(400);
    // Exactement 3 Mo : accepté (la limite de taille de requête est relevée pour cette route).
    const max = Buffer.concat([PNG, Buffer.alloc(MAX_LOGO_BYTES - PNG.length)]);
    expect((await upload(admin, max)).statusCode).toBe(200);
    await client(built.app, admin)('DELETE', '/api/settings/logo');

    const notBase64 = await client(built.app, admin)('PUT', '/api/settings/logo', {
      data: '<svg>',
    });
    expect(notBase64.json().error).toBe('invalid_input');
    expect((await built.app.inject({ url: '/api/station/logo' })).statusCode).toBe(404);
  });
});
