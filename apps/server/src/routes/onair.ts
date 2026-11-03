import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  onAirRequestSchema,
  weatherSettingsSchema,
  type ConnectorTokenCreated,
  type ConnectorTokenStatus,
  type OnAirResponse,
  type WeatherTestResult,
} from '@onair-desk/shared';
import { requireAdmin, requireIdentity, studioOf } from '../auth/identity.js';
import { hashToken, randomToken } from '../auth/tokens.js';
import { weatherErrorCode } from '../connectors/weather/openmeteo.js';
import { forbidden } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { strictRateLimit, type RouteContext } from './context.js';

const weatherTestSchema = z.object({ weather: weatherSettingsSchema.optional() }).strict();

export function registerOnAirRoutes(app: FastifyInstance, ctx: RouteContext) {
  const { repos, config } = ctx;

  const tokenStatus = (): ConnectorTokenStatus => {
    const createdAt = repos.connectorTokens.createdAt('onair') ?? null;
    return { configured: createdAt !== null, createdAt, httpPort: config.connectorHttpPort };
  };

  // ---- Jeton du déclencheur On Air (Stream Deck, console, logiciel…) ------------------

  app.get('/api/settings/onair/token', async (req): Promise<ConnectorTokenStatus> => {
    requireAdmin(req);
    return tokenStatus();
  });

  app.post(
    '/api/settings/onair/token',
    { config: strictRateLimit },
    async (req): Promise<ConnectorTokenCreated> => {
      const admin = requireAdmin(req);
      const replaced = repos.connectorTokens.createdAt('onair') !== undefined;
      // Sans caractère à encoder : il peut figurer dans une adresse (appel simple).
      const token = randomToken(24);
      repos.connectorTokens.set('onair', hashToken(token));
      repos.audit.write({ type: 'user', id: admin.id }, 'connector.token_generated', {
        connector: 'onair',
        replaced,
      });
      return { status: tokenStatus(), token };
    },
  );

  // ---- Bouton manuel : comptes, et écran studio si les paramètres l'autorisent ---------

  app.post(
    '/api/studio/onair',
    { config: { deviceMayWrite: true, ...strictRateLimit } },
    async (req): Promise<OnAirResponse> => {
      const identity = requireIdentity(req);
      if (identity.kind === 'device' && !repos.settings.get().onAirKiosk) {
        throw forbidden('onair_kiosk_disabled');
      }
      const { state } = parse(onAirRequestSchema, req.body);
      const result = ctx.onAir.set(
        studioOf(identity),
        state,
        'manual',
        identity.kind === 'user'
          ? { type: 'user', id: identity.user.id }
          : { type: 'device', id: identity.device.id },
      );
      return { on: result.on, since: result.since };
    },
  );

  // ---- Météo : bouton « Tester » ---------------------------------------------------

  app.post(
    '/api/settings/weather/test',
    { config: strictRateLimit },
    async (req): Promise<WeatherTestResult> => {
      requireAdmin(req);
      // Paramètres saisis mais pas encore enregistrés, sinon ceux de la station.
      const body = parse(weatherTestSchema, req.body ?? {});
      const settings = repos.settings.get();
      const weather = body.weather ?? settings.weather;
      if (weather.provider === 'none') return { ok: false, error: 'weather_none', weather: null };
      try {
        const now = await ctx.weather.open(weather, settings.timezone).current();
        return { ok: true, error: null, weather: now };
      } catch (err) {
        const code = weatherErrorCode(err);
        req.log.warn({ code, err: (err as Error)?.message }, 'Test météo en échec.');
        return { ok: false, error: code, weather: null };
      }
    },
  );
}
