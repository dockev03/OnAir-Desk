import type { FastifyReply } from 'fastify';
import type { Repos } from '../db/index.js';
import { SESSION_COOKIE, SESSION_IDLE_MS, sessionCookieOptions } from '../auth/identity.js';
import { hashToken, randomToken } from '../auth/tokens.js';

/** Ouvre une session et pose le cookie correspondant. */
export function startSession(repos: Repos, reply: FastifyReply, userId: number, secure: boolean) {
  const sessionId = randomToken();
  repos.sessions.create(hashToken(sessionId), userId, Date.now() + SESSION_IDLE_MS);
  // Pas de maxAge : le cookie disparaît à la fermeture du navigateur, la session côté serveur
  // expire après 12 h d'inactivité.
  reply.setCookie(SESSION_COOKIE, sessionId, sessionCookieOptions(secure));
}
