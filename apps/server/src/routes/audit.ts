import type { FastifyInstance } from 'fastify';
import { auditQuerySchema, type AuditPage } from '@onair-desk/shared';
import { requireAdmin } from '../auth/identity.js';
import { parse } from '../lib/validate.js';
import type { RouteContext } from './context.js';

export function registerAuditRoutes(app: FastifyInstance, ctx: RouteContext) {
  // Journal : lecture seule, réservée à l'admin (il contient adresses IP et noms de comptes).
  app.get('/api/audit', async (req): Promise<AuditPage> => {
    requireAdmin(req);
    return ctx.repos.audit.list(parse(auditQuerySchema, req.query));
  });
}
