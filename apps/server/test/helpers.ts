import type { LightMyRequestResponse } from 'fastify';
import { buildApp, type App } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openMemoryDatabase } from '../src/db/index.js';

export const ORIGIN = 'https://onair-desk.test';
export const ADMIN_PASSWORD = 'mot-de-passe-admin-solide';

export async function createTestApp(): Promise<App> {
  const config = loadConfig({
    NODE_ENV: 'test',
    PUBLIC_ORIGIN: ORIGIN,
    DATA_DIR: '/nonexistent',
    WEB_DIR: '/nonexistent',
  });
  const built = await buildApp({ config, db: openMemoryDatabase(), logger: false });
  built.ctx.setup.ensure(true);
  return built;
}

/** Extrait le cookie « nom=valeur » d'une réponse. */
export function cookieFrom(res: LightMyRequestResponse, name: string): string {
  const c = res.cookies.find((c) => c.name === name);
  if (!c) throw new Error(`Cookie ${name} absent`);
  return `${name}=${c.value}`;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Petit client : envoie l'en-tête Origin et le cookie fourni. */
export function client(app: App['app'], cookie?: string) {
  return (method: Method, url: string, payload?: unknown) =>
    app.inject({
      method,
      url,
      headers: { origin: ORIGIN, ...(cookie ? { cookie } : {}) },
      ...(payload !== undefined ? { payload: payload as object } : {}),
    });
}

/** Installation complète : renvoie le cookie de session de l'admin. */
export async function setupAdmin(built: App): Promise<string> {
  const code = built.ctx.setup.ensure(true)!;
  const res = await client(built.app)('POST', '/api/setup', {
    code,
    station: { stationName: 'Radio Test', locale: 'fr', timezone: 'Europe/Paris' },
    admin: { username: 'admin', displayName: 'Admin', password: ADMIN_PASSWORD },
  });
  if (res.statusCode !== 200) throw new Error(`setup: ${res.statusCode} ${res.body}`);
  return cookieFrom(res, 'oad_session');
}

export async function createUser(
  built: App,
  adminCookie: string,
  username: string,
  role: 'admin' | 'animateur' = 'animateur',
) {
  const password = `${username}-mot-de-passe`;
  const res = await client(built.app, adminCookie)('POST', '/api/users', {
    username,
    displayName: username,
    role,
    password,
  });
  if (res.statusCode !== 201) throw new Error(`createUser: ${res.statusCode} ${res.body}`);
  const login = await client(built.app)('POST', '/api/auth/login', { username, password });
  return { id: res.json().id as number, password, cookie: cookieFrom(login, 'oad_session') };
}
