import type { FastifyInstance } from 'fastify';
import { setupSchema, type SetupStatus } from '@onair-desk/shared';
import { hashPassword } from '../auth/passwords.js';
import { conflict, forbidden } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { strictRateLimit, type RouteContext } from './context.js';
import { startSession } from './sessions.js';
import { toPublicUser } from '../db/index.js';

export function registerSetupRoutes(app: FastifyInstance, ctx: RouteContext) {
  const { repos, setup } = ctx;

  app.get('/api/setup/status', async (): Promise<SetupStatus> => ({
    needsSetup: repos.users.count() === 0,
  }));

  app.post('/api/setup', { config: strictRateLimit }, async (req, reply) => {
    if (repos.users.count() > 0) throw conflict('already_set_up');
    const input = parse(setupSchema, req.body);
    if (!setup.check(input.code)) {
      repos.audit.write({ type: 'anonymous' }, 'setup.bad_code', { ip: req.ip });
      throw forbidden('bad_setup_code');
    }
    const passwordHash = await hashPassword(input.admin.password);

    // Transaction : si deux installations arrivent en même temps, une seule réussit.
    const user = repos.db.transaction(() => {
      if (repos.users.count() > 0) throw conflict('already_set_up');
      const created = repos.users.create({
        username: input.admin.username,
        displayName: input.admin.displayName,
        passwordHash,
        role: 'admin',
        locale: input.station.locale,
      });
      repos.settings.set({ ...input.station });
      repos.audit.write({ type: 'user', id: created.id }, 'setup.completed');
      return created;
    })();

    setup.complete();
    startSession(repos, reply, user.id, ctx.config.secureCookies);
    return { user: toPublicUser(user) };
  });
}
