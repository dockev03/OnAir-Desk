import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyWebsocket from '@fastify/websocket';
import { AirStateStore } from './air/state.js';
import type { Config } from './config.js';
import { AutomationManager, type ConnectorDeps } from './connectors/manager.js';
import { WeatherManager, type WeatherDeps } from './connectors/weather/manager.js';
import { DEFAULT_STUDIO_ID, createRepos, type Db } from './db/index.js';
import { registerIdentity, type Identity } from './auth/identity.js';
import { LoginThrottle } from './auth/throttle.js';
import { HttpError } from './lib/errors.js';
import { Library } from './library.js';
import { OnAirService } from './onair.js';
import { RegieService } from './regie.js';
import { Rundowns } from './rundowns.js';
import { SetupState } from './setup.js';
import { Templates } from './templates.js';
import { inlineScriptHashes, readIndexHtml, registerStatic } from './static.js';
import { Hub } from './ws/hub.js';
import { registerWsRoutes } from './ws/routes.js';
import type { RouteContext } from './routes/context.js';
import { registerAuditRoutes } from './routes/audit.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerAzuracastRoutes } from './routes/azuracast.js';
import { registerDeviceRoutes } from './routes/devices.js';
import { registerLibraryRoutes } from './routes/library.js';
import { registerOnAirRoutes } from './routes/onair.js';
import { registerRundownRoutes } from './routes/rundowns.js';
import { registerRadiodjRoutes } from './routes/radiodj.js';
import { registerRegieRoutes } from './routes/regie.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { registerSetupRoutes } from './routes/setup.js';
import { registerSystemRoutes } from './routes/system.js';
import { registerTemplateRoutes } from './routes/templates.js';
import { registerUserRoutes } from './routes/users.js';

export interface AppOptions {
  config: Config;
  db: Db;
  https?: { key: string; cert: string } | null;
  rootCaPem?: () => string | null;
  logger?: FastifyServerOptions['logger'];
  /** Accès aux sources des connecteurs (remplacés dans les tests). */
  connectorDeps?: ConnectorDeps;
  /** Fournisseur météo (remplacé dans les tests). */
  weatherDeps?: WeatherDeps;
}

export interface App {
  app: FastifyInstance;
  ctx: RouteContext;
}

const REDACTED_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'res.headers["set-cookie"]',
];

export async function buildApp(opts: AppOptions): Promise<App> {
  const { config, db } = opts;
  const app = Fastify({
    logger: opts.logger ?? { level: config.logLevel, redact: REDACTED_PATHS },
    ...(opts.https ? { https: opts.https } : {}),
    bodyLimit: 256 * 1024,
    trustProxy: false,
  }) as unknown as FastifyInstance;

  const repos = createRepos(db);
  const hub = new Hub();
  const library = new Library(repos, hub);
  const air = new AirStateStore(hub);
  const rundowns = new Rundowns(repos, library, air);
  const ctx: RouteContext = {
    config,
    repos,
    hub,
    library,
    rundowns,
    templates: new Templates(repos, library, rundowns),
    air,
    automation: new AutomationManager(DEFAULT_STUDIO_ID, air, repos.audit, Date.now, {
      radiodjPassword: config.radiodjDbPassword,
      azuracastApiKey: config.azuracastApiKey,
      azuracastCa: config.azuracastCa,
      ...opts.connectorDeps,
    }),
    onAir: new OnAirService(repos, air),
    regie: new RegieService(repos, air),
    weather: new WeatherManager(DEFAULT_STUDIO_ID, air, repos, Date.now, {
      openMeteoUrl: config.openMeteoUrl ?? undefined,
      ...opts.weatherDeps,
    }),
    throttle: new LoginThrottle(),
    setup: new SetupState(),
    rootCaPem: opts.rootCaPem ?? (() => null),
  };

  const indexHtml = readIndexHtml(config.webDir);
  await app.register(fastifyHelmet, {
    // Pas de HSTS : avec une autorité interne, un certificat non installé bloquerait l'accès.
    hsts: false,
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", ...(indexHtml ? inlineScriptHashes(indexHtml) : [])],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
  });
  await app.register(fastifyCookie);
  await app.register(fastifyRateLimit, { global: false });
  await app.register(fastifyWebsocket, { options: { maxPayload: 4096 } });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send({ error: err.code, message: err.message });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      const code = status === 429 ? 'too_many_requests' : 'bad_request';
      return reply.code(status).send({ error: code });
    }
    req.log.error(err);
    return reply.code(500).send({ error: 'internal_error' });
  });

  registerIdentity(app, repos, config.allowedOrigins);
  registerSystemRoutes(app, ctx);
  registerSetupRoutes(app, ctx);
  registerAuthRoutes(app, ctx);
  registerUserRoutes(app, ctx);
  registerDeviceRoutes(app, ctx);
  registerSettingsRoutes(app, ctx);
  registerRadiodjRoutes(app, ctx);
  registerAzuracastRoutes(app, ctx);
  registerOnAirRoutes(app, ctx);
  registerRegieRoutes(app, ctx);
  registerLibraryRoutes(app, ctx);
  registerRundownRoutes(app, ctx);
  registerTemplateRoutes(app, ctx);
  registerAuditRoutes(app, ctx);
  registerWsRoutes(app, ctx);
  await registerStatic(app, config.webDir, indexHtml);

  // Ménage périodique : sessions expirées, compteurs d'échecs, connexions devenues invalides.
  const sweep = setInterval(() => {
    repos.sessions.deleteExpired();
    ctx.throttle.prune();
    ctx.hub.revalidate((i: Identity) =>
      i.kind === 'user'
        ? repos.sessions.find(i.sessionIdHash) !== undefined
        : repos.devices.findById(i.device.id)?.revokedAt === null,
    );
  }, 60_000).unref();

  // Purge quotidienne : corbeille (30 jours) et journal d'audit (1 an).
  const purge = () => {
    const n = ctx.library.purgeTrash();
    if (n > 0) app.log.info(`Corbeille : ${n} élément(s) supprimé(s) définitivement.`);
    const old = repos.audit.purge();
    if (old > 0) app.log.info(`Journal : ${old} entrée(s) de plus d'un an supprimée(s).`);
  };
  purge();
  const purgeTimer = setInterval(purge, 24 * 60 * 60_000).unref();

  // Connecteur d'automation choisi dans les paramètres (aucun par défaut), voyant ON AIR
  // conservé en base, météo.
  const initial = repos.settings.get();
  ctx.automation.apply(initial);
  ctx.onAir.restore(DEFAULT_STUDIO_ID);
  ctx.regie.restore(DEFAULT_STUDIO_ID);
  ctx.weather.apply(initial);

  app.addHook('onClose', async () => {
    ctx.automation.stop();
    ctx.weather.stop();
    ctx.regie.stop();
    clearInterval(sweep);
    clearInterval(purgeTimer);
    ctx.hub.close();
  });

  return { app, ctx };
}
