import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import fastifyRateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import { ON_AIR_REQUESTS, onAirRequestSchema, type OnAirResponse } from '@onair-desk/shared';
import { hashToken } from '../auth/tokens.js';
import type { ConnectorTokenRepo } from '../db/connector-tokens.js';
import { DEFAULT_STUDIO_ID } from '../db/studios.js';
import type { SettingsRepo } from '../db/settings.js';
import type { OnAirService } from '../onair.js';
import type { AutomationManager } from './manager.js';

/** Débit maximal par adresse : RadioDJ envoie une requête par titre ; boutons On Air. */
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
  onAir: OnAirService;
  settings: SettingsRepo;
  logger?: FastifyServerOptions['logger'];
}

/** Jeton On Air reçu dans l'en-tête `Authorization: Bearer …`. */
function bearer(header: string | undefined): string | null {
  const m = /^Bearer\s+(\S{1,200})$/i.exec(header ?? '');
  return m ? m[1]! : null;
}

/**
 * Écoute HTTP dédiée aux connecteurs entrants (CONNECTOR_HTTP_PORT), séparée du serveur
 * principal : RadioDJ refuse le certificat HTTPS interne. Elle n'expose que la route du
 * signal RadioDJ : ni interface, ni session, ni cookie. La requête n'est qu'un signal
 * (« relis la base ») : une requête falsifiée ne provoque qu'une relecture.
 */
export async function buildIngestServer(deps: IngestDeps): Promise<FastifyInstance> {
  const app = Fastify({
    // Jamais la requête complète au journal : l'appel simple porte le jeton dans l'adresse.
    logger: deps.logger
      ? {
          ...(typeof deps.logger === 'object' ? deps.logger : {}),
          serializers: {
            req: (req: { method: string; url: string }) => ({
              method: req.method,
              url: req.url.split('?')[0],
            }),
          },
        }
      : false,
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

  // ---- On Air : Stream Deck, console, logiciel… (voir docs/plan-etape-9.md, décisions 2 à 4)

  const onAirState = (): OnAirResponse => {
    const s = deps.onAir.get(DEFAULT_STUDIO_ID);
    return { on: s.on, since: s.since };
  };
  const onAirAllowed = (token: string | null) =>
    token !== null && deps.tokens.matches('onair', hashToken(token));

  app.get('/api/onair', async (req, reply) => {
    if (!onAirAllowed(bearer(req.headers.authorization))) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    return onAirState();
  });

  app.post('/api/onair', async (req, reply) => {
    if (!onAirAllowed(bearer(req.headers.authorization))) {
      req.log.warn('Requête On Air refusée : jeton absent ou invalide.');
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const parsed = onAirRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' });
    deps.onAir.set(DEFAULT_STUDIO_ID, parsed.data.state, 'http', null);
    return onAirState();
  });

  // Appel simple (adresse seule, jeton dans l'adresse) : désactivé par défaut (décision 4 bis).
  const simpleSchema = z.object({ action: z.enum(ON_AIR_REQUESTS) });
  const tokenQuery = z.object({ token: z.string().min(1).max(200) });
  app.get('/api/onair/:action', async (req, reply) => {
    const action = simpleSchema.safeParse(req.params);
    if (!action.success) return reply.code(404).send({ error: 'not_found' });
    if (!deps.settings.get().onAirSimpleCall) {
      return reply.code(403).send({ error: 'onair_simple_call_disabled' });
    }
    const query = tokenQuery.safeParse(req.query);
    if (!query.success || !onAirAllowed(query.data.token)) {
      req.log.warn('Appel simple On Air refusé : jeton absent ou invalide.');
      return reply.code(401).send({ error: 'unauthorized' });
    }
    deps.onAir.set(DEFAULT_STUDIO_ID, action.data.action, 'http', null);
    return onAirState();
  });

  return app;
}
