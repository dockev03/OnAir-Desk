import type { FastifyInstance } from 'fastify';
import { changePasswordSchema, loginSchema, type Me } from '@onair-desk/shared';
import { clearAuthCookies, requireIdentity, requireUser } from '../auth/identity.js';
import { hashPassword, verifyDummy, verifyPassword } from '../auth/passwords.js';
import { HttpError, badRequest } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { toPublicUser } from '../db/index.js';
import { strictRateLimit, type RouteContext } from './context.js';
import { startSession } from './sessions.js';

export function registerAuthRoutes(app: FastifyInstance, ctx: RouteContext) {
  const { repos, throttle, hub, config } = ctx;

  app.post('/api/auth/login', { config: strictRateLimit }, async (req, reply) => {
    const { username, password } = parse(loginSchema, req.body);
    if (throttle.isLocked(username)) {
      throw new HttpError(429, 'too_many_attempts');
    }
    const user = repos.users.findByUsername(username);
    const ok = user
      ? user.isActive && (await verifyPassword(user.passwordHash, password))
      : await verifyDummy(password);
    if (!ok || !user) {
      throttle.fail(username);
      repos.audit.write({ type: 'anonymous' }, 'auth.login_failed', { username, ip: req.ip });
      throw new HttpError(401, 'bad_credentials');
    }
    throttle.succeed(username);
    startSession(repos, reply, user.id, config.secureCookies);
    repos.audit.write({ type: 'user', id: user.id }, 'auth.login', { ip: req.ip });
    return { user: toPublicUser(user) };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    if (req.identity?.kind === 'user') {
      repos.sessions.delete(req.identity.sessionIdHash);
      hub.disconnectSession(req.identity.sessionIdHash);
    }
    clearAuthCookies(reply, config.secureCookies);
    return reply.code(204).send();
  });

  app.get('/api/auth/me', async (req): Promise<Me> => {
    const identity = requireIdentity(req);
    return identity.kind === 'user'
      ? { kind: 'user', user: toPublicUser(identity.user) }
      : { kind: 'device', device: identity.device };
  });

  app.post('/api/auth/password', { config: strictRateLimit }, async (req, reply) => {
    const user = requireUser(req);
    const { currentPassword, newPassword } = parse(changePasswordSchema, req.body);
    if (!(await verifyPassword(user.passwordHash, currentPassword))) {
      throw badRequest('bad_current_password');
    }
    repos.users.update(user.id, { passwordHash: await hashPassword(newPassword) });
    // Les autres sessions du compte sont fermées ; la session en cours est conservée.
    const current = req.identity?.kind === 'user' ? req.identity.sessionIdHash : undefined;
    repos.sessions.deleteForUser(user.id, current);
    hub.disconnectUser(user.id, current);
    repos.audit.write({ type: 'user', id: user.id }, 'auth.password_changed');
    return reply.code(204).send();
  });
}
