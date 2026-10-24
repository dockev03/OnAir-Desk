import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import fastifyRateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import { hashToken } from '../auth/tokens.js';
import type { ConnectorTokenRepo } from '../db/connector-tokens.js';
import type { AutomationManager } from './manager.js';

/** Débit maximal par adresse : RadioDJ envoie une requête par titre. */
export const INGEST_RATE_PER_MINUTE = 60;

/**
 * Corps envoyé par le plugin « Metadata Export » de RadioDJ, Custom Data vide :
 * `xpwd=<jeton>&title=<Artiste - Titre>` (formulaire encodé). Voir docs/cadrage-radiodj.md.
 */
const radiodjSignalSchema = z.object({
  xpwd: z.string().min(1).max(200),
  title: z.string().trim().max(500).default(''),
});

export interface IngestDeps {
  tokens: ConnectorTokenRepo;
  automation: AutomationManager;
  logger?: FastifyServerOptions['logger'];
}

/**
 * Écoute HTTP dédiée aux connecteurs entrants (CONNECTOR_HTTP_PORT), séparée du serveur
 * principal : RadioDJ refuse le certificat HTTPS interne. Elle n'expose que la route du
 * signal RadioDJ : ni interface, ni session, ni cookie. La requête n'est qu'un signal
 * (« relis la base ») : une requête falsifiée ne provoque qu'une relecture.
 */
export async function buildIngestServer(deps: IngestDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: deps.logger ?? false,
    bodyLimit: 4 * 1024,
    trustProxy: false,
  }) as unknown as FastifyInstance;

  await app.register(fastifyRateLimit, { max: INGEST_RATE_PER_MINUTE, timeWindow: '1 minute' });

  // Formulaire encodé, lu sans dépendance supplémentaire.
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_req, body, done) => done(null, Object.fromEntries(new URLSearchParams(body as string))),
  );

  app.setErrorHandler((err, _req, reply) => {
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 429) return reply.code(429).send({ error: 'too_many_requests' });
    if (status && status >= 400 && status < 500)
      return reply.code(status).send({ error: 'bad_request' });
    app.log.error(err);
    return reply.code(500).send({ error: 'internal_error' });
  });

  app.post('/api/connectors/radiodj', async (req, reply) => {
    const parsed = radiodjSignalSchema.safeParse(req.body ?? {});
    if (!parsed.success || !deps.tokens.matches('radiodj', hashToken(parsed.data.xpwd))) {
      // Jamais le jeton reçu dans le journal.
      req.log.warn('Signal RadioDJ refusé : jeton absent ou invalide.');
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const accepted = deps.automation.signal('radiodj', parsed.data.title);
    return reply.code(200).send({ ok: true, accepted });
  });

  return app;
}
