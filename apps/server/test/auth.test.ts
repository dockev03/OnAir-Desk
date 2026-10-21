import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { App } from '../src/app.js';
import {
  ADMIN_PASSWORD,
  client,
  cookieFrom,
  createTestApp,
  createUser,
  setupAdmin,
} from './helpers.js';

let built: App;
let admin: string;
beforeEach(async () => {
  built = await createTestApp();
  admin = await setupAdmin(built);
});
afterEach(() => built.app.close());

describe('connexion', () => {
  it('accepte les bons identifiants, sans tenir compte de la casse du nom', async () => {
    const res = await client(built.app)('POST', '/api/auth/login', {
      username: 'ADMIN',
      password: ADMIN_PASSWORD,
    });
    expect(res.statusCode).toBe(200);
    expect(res.cookies.some((c) => c.name === 'oad_session')).toBe(true);
  });

  it('refuse un mauvais mot de passe ou un compte inconnu avec la même erreur', async () => {
    const bad = await client(built.app)('POST', '/api/auth/login', {
      username: 'admin',
      password: 'faux',
    });
    const unknown = await client(built.app)('POST', '/api/auth/login', {
      username: 'personne',
      password: 'faux',
    });
    expect(bad.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(bad.json()).toEqual(unknown.json());
  });

  it("bloque l'identifiant après 5 échecs, même avec le bon mot de passe", async () => {
    for (let i = 0; i < 5; i++) {
      await client(built.app)('POST', '/api/auth/login', { username: 'admin', password: 'faux' });
    }
    const res = await client(built.app)('POST', '/api/auth/login', {
      username: 'admin',
      password: ADMIN_PASSWORD,
    });
    expect(res.statusCode).toBe(429);
  });

  it('la déconnexion invalide la session côté serveur', async () => {
    await client(built.app, admin)('POST', '/api/auth/logout');
    const me = await client(built.app, admin)('GET', '/api/auth/me');
    expect(me.statusCode).toBe(401);
  });

  it('sans session, /me renvoie 401', async () => {
    expect((await client(built.app)('GET', '/api/auth/me')).statusCode).toBe(401);
  });
});

describe('changement de mot de passe', () => {
  it('exige le mot de passe actuel et ferme les autres sessions', async () => {
    const other = cookieFrom(
      await client(built.app)('POST', '/api/auth/login', {
        username: 'admin',
        password: ADMIN_PASSWORD,
      }),
      'oad_session',
    );
    const wrong = await client(built.app, admin)('POST', '/api/auth/password', {
      currentPassword: 'faux',
      newPassword: 'un-nouveau-mot-de-passe',
    });
    expect(wrong.statusCode).toBe(400);

    const ok = await client(built.app, admin)('POST', '/api/auth/password', {
      currentPassword: ADMIN_PASSWORD,
      newPassword: 'un-nouveau-mot-de-passe',
    });
    expect(ok.statusCode).toBe(204);
    expect((await client(built.app, admin)('GET', '/api/auth/me')).statusCode).toBe(200);
    expect((await client(built.app, other)('GET', '/api/auth/me')).statusCode).toBe(401);
  });
});

describe('gestion des comptes', () => {
  it("interdit l'administration à un animateur", async () => {
    const anim = await createUser(built, admin, 'jean');
    expect((await client(built.app, anim.cookie)('GET', '/api/users')).statusCode).toBe(403);
    expect((await client(built.app, anim.cookie)('PUT', '/api/settings', {})).statusCode).toBe(403);
  });

  it("refuse un nom d'utilisateur déjà pris", async () => {
    await createUser(built, admin, 'jean');
    const res = await client(built.app, admin)('POST', '/api/users', {
      username: 'JEAN',
      displayName: 'Jean bis',
      role: 'animateur',
      password: 'mot-de-passe-solide',
    });
    expect(res.statusCode).toBe(409);
  });

  it("protège le dernier admin et l'admin connecté", async () => {
    const me = (await client(built.app, admin)('GET', '/api/auth/me')).json().user.id;
    const demote = await client(built.app, admin)('PATCH', `/api/users/${me}`, {
      role: 'animateur',
    });
    expect(demote.statusCode).toBe(409);
    const del = await client(built.app, admin)('DELETE', `/api/users/${me}`);
    expect(del.statusCode).toBe(409);
  });

  it('désactiver un compte ferme ses sessions', async () => {
    const anim = await createUser(built, admin, 'jean');
    const res = await client(built.app, admin)('PATCH', `/api/users/${anim.id}`, {
      isActive: false,
    });
    expect(res.statusCode).toBe(200);
    expect((await client(built.app, anim.cookie)('GET', '/api/auth/me')).statusCode).toBe(401);
    const login = await client(built.app)('POST', '/api/auth/login', {
      username: 'jean',
      password: anim.password,
    });
    expect(login.statusCode).toBe(401);
  });

  it('ne renvoie jamais le haché du mot de passe', async () => {
    await createUser(built, admin, 'jean');
    const res = await client(built.app, admin)('GET', '/api/users');
    expect(res.body).not.toContain('argon2');
  });
});

describe('paramètres', () => {
  it('valide les valeurs et les enregistre', async () => {
    const bad = await client(built.app, admin)('PUT', '/api/settings', {
      stationName: 'Radio',
      locale: 'fr',
      timezone: 'Pas/Un_Fuseau',
      timeFormat: '24h',
    });
    expect(bad.statusCode).toBe(400);
    const ok = await client(built.app, admin)('PUT', '/api/settings', {
      stationName: 'Radio Vichy',
      locale: 'en',
      timezone: 'Europe/Paris',
      timeFormat: '24h',
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().stationName).toBe('Radio Vichy');
  });
});
