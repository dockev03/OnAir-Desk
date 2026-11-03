import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { canDirect, type PublicDevice } from '@onair-desk/shared';
import { DEFAULT_STUDIO_ID, type Repos, type User } from '../db/index.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { hashToken } from './tokens.js';

export const SESSION_COOKIE = 'oad_session';
export const DEVICE_COOKIE = 'oad_device';

/** Durée d'inactivité au-delà de laquelle une session expire. */
export const SESSION_IDLE_MS = 12 * 60 * 60_000;
/** Durée de vie du cookie d'appareil (maximum accepté par Chromium : 400 jours). */
export const DEVICE_COOKIE_MAX_AGE_S = 400 * 24 * 60 * 60;
/** On ne réécrit la date de dernière activité qu'une fois par minute. */
const TOUCH_EVERY_MS = 60_000;

export type Identity =
  { kind: 'user'; user: User; sessionIdHash: string } | { kind: 'device'; device: PublicDevice };

declare module 'fastify' {
  interface FastifyRequest {
    identity: Identity | null;
  }
  interface FastifyContextConfig {
    /** Autorise un appareil kiosk à appeler cette route en écriture (appairage uniquement). */
    deviceMayWrite?: boolean;
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Résout l'identité à partir des cookies : un compte, un appareil kiosk, ou personne. */
export function resolveIdentity(
  repos: Repos,
  cookies: Record<string, string | undefined>,
): Identity | null {
  const sessionId = cookies[SESSION_COOKIE];
  if (sessionId) {
    const idHash = hashToken(sessionId);
    const session = repos.sessions.find(idHash);
    const now = Date.now();
    if (session && session.expires_at > now) {
      const user = repos.users.findById(session.user_id);
      if (user?.isActive) {
        if (now - session.last_seen_at > TOUCH_EVERY_MS) {
          repos.sessions.touch(idHash, now + SESSION_IDLE_MS);
        }
        return { kind: 'user', user, sessionIdHash: idHash };
      }
    }
  }
  const deviceToken = cookies[DEVICE_COOKIE];
  if (deviceToken) {
    const device = repos.devices.findActiveByTokenHash(hashToken(deviceToken));
    if (device) {
      const last = device.lastSeenAt ? Date.parse(device.lastSeenAt) : 0;
      if (Date.now() - last > TOUCH_EVERY_MS) repos.devices.touch(device.id);
      return { kind: 'device', device };
    }
  }
  return null;
}

/**
 * Installe la résolution d'identité et les garde-fous globaux :
 * - vérification de l'en-tête Origin sur toute requête qui modifie des données (anti-CSRF) ;
 * - un appareil kiosk est en lecture seule, quelle que soit la route.
 */
export function registerIdentity(app: FastifyInstance, repos: Repos, allowedOrigins: string[]) {
  app.decorateRequest('identity', null);

  app.addHook('onRequest', async (req) => {
    if (!SAFE_METHODS.has(req.method)) {
      const origin = req.headers.origin;
      if (!origin || !allowedOrigins.includes(origin)) throw forbidden('bad_origin');
    }
    req.identity = resolveIdentity(repos, req.cookies);
    if (
      req.identity?.kind === 'device' &&
      !SAFE_METHODS.has(req.method) &&
      !req.routeOptions.config.deviceMayWrite
    ) {
      throw forbidden('read_only_device');
    }
  });
}

export function requireUser(req: FastifyRequest): User {
  if (req.identity?.kind !== 'user') throw unauthorized();
  return req.identity.user;
}

export function requireAdmin(req: FastifyRequest): User {
  const user = requireUser(req);
  if (user.role !== 'admin') throw forbidden();
  return user;
}

/**
 * Régie (voir docs/plan-etape-10.md, décisions 1 à 3) : admin, ou compte avec le droit
 * « Réalisateur ». Le kiosk et un animateur sans ce droit sont refusés.
 */
export function requireDirector(req: FastifyRequest): User {
  if (req.identity?.kind === 'device') throw forbidden();
  const user = requireUser(req);
  if (!canDirect(user)) throw forbidden();
  return user;
}

/**
 * Studio d'une connexion : celui de l'écran kiosk, ou le studio par défaut pour un compte
 * (un seul studio pour l'instant ; le rattachement des comptes viendra avec la régie).
 */
export function studioOf(identity: Identity): number {
  return identity.kind === 'device' ? identity.device.studioId : DEFAULT_STUDIO_ID;
}

/** Compte ou appareil kiosk : lecture autorisée. */
export function requireIdentity(req: FastifyRequest): Identity {
  if (!req.identity) throw unauthorized();
  return req.identity;
}

export function sessionCookieOptions(secure: boolean) {
  return { path: '/', httpOnly: true, secure, sameSite: 'strict' as const };
}

export function clearAuthCookies(reply: FastifyReply, secure: boolean) {
  reply.clearCookie(SESSION_COOKIE, sessionCookieOptions(secure));
}
