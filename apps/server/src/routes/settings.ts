import type { FastifyInstance } from 'fastify';
import { settingsSchema } from '@onair-desk/shared';
import { requireAdmin, requireIdentity } from '../auth/identity.js';
import { parse } from '../lib/validate.js';
import type { RouteContext } from './context.js';

export function registerSettingsRoutes(app: FastifyInstance, ctx: RouteContext) {
  const { repos, hub } = ctx;

  app.get('/api/settings', async (req) => {
    requireIdentity(req);
    return repos.settings.get();
  });

  app.put('/api/settings', async (req) => {
    const admin = requireAdmin(req);
    const values = parse(settingsSchema, req.body);
    const settings = repos.settings.set(values);
    hub.broadcastSettings(settings);
    repos.audit.write({ type: 'user', id: admin.id }, 'settings.updated', {
      fields: Object.keys(values),
    });
    return settings;
  });
}
