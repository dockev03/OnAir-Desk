import type { FastifyInstance } from 'fastify';
import { notFound } from '../lib/errors.js';
import type { RouteContext } from './context.js';

export function registerSystemRoutes(app: FastifyInstance, ctx: RouteContext) {
  app.get('/api/health', { logLevel: 'warn' }, async () => {
    ctx.repos.db.prepare('SELECT 1').get();
    return { status: 'ok' };
  });

  // Certificat racine public de l'autorité interne, à installer sur le Pi et les postes.
  app.get('/api/tls/root-ca.crt', async (_req, reply) => {
    const pem = ctx.rootCaPem();
    if (!pem) throw notFound();
    return reply
      .header('content-type', 'application/x-x509-ca-cert')
      .header('content-disposition', 'attachment; filename="onair-desk-root-ca.crt"')
      .send(pem);
  });
}
