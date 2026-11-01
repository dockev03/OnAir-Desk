import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { azuracastSettingsSchema, type AzuracastTestResult } from '@onair-desk/shared';
import { requireAdmin } from '../auth/identity.js';
import { azuracastErrorCode } from '../connectors/azuracast/client.js';
import { matchesStation, parseNowPlaying, toUpdate } from '../connectors/azuracast/nowplaying.js';
import { parse } from '../lib/validate.js';
import { strictRateLimit, type RouteContext } from './context.js';

const testBodySchema = z.object({ azuracast: azuracastSettingsSchema.optional() }).strict();

/** Erreur d'ouverture ou de requête → code stable (les codes de configuration passent tels quels). */
const errorCode = (err: unknown): string => {
  const message = (err as Error)?.message ?? '';
  return /^azuracast_[a-z_]+$/.test(message) ? message : azuracastErrorCode(err);
};

export function registerAzuracastRoutes(app: FastifyInstance, ctx: RouteContext) {
  const { repos } = ctx;

  // « Tester la connexion » : nom de la station, titre en cours, et sort de la clé API.
  app.post(
    '/api/settings/azuracast/test',
    { config: strictRateLimit },
    async (req): Promise<AzuracastTestResult> => {
      requireAdmin(req);
      // Accès saisi mais pas encore enregistré, sinon celui des paramètres.
      const body = parse(testBodySchema, req.body ?? {});
      const settings = body.azuracast ?? repos.settings.get().azuracast;
      const keyConfigured = ctx.automation.azuracastKeyConfigured;
      const failed = (error: string): AzuracastTestResult => ({
        ok: false,
        error,
        auth: error === 'azuracast_unauthorized' ? (keyConfigured ? 'refused' : 'required') : null,
        keyConfigured,
        stationName: null,
        nowPlaying: null,
        live: null,
      });
      try {
        const raw = await ctx.automation.openAzuracast(settings).nowPlaying();
        const np = parseNowPlaying(raw);
        if (!np) return failed('azuracast_bad_response');
        if (!matchesStation(np, settings.station)) return failed('azuracast_station_unknown');
        const { nowPlaying, live } = toUpdate(np, 0);
        return {
          ok: true,
          error: null,
          auth: keyConfigured ? 'accepted' : 'none',
          keyConfigured,
          stationName: np.station?.name ?? null,
          nowPlaying: nowPlaying
            ? [nowPlaying.artist, nowPlaying.title].filter(Boolean).join(' - ')
            : null,
          live,
        };
      } catch (err) {
        const code = errorCode(err);
        // Le message technique ne contient jamais la clé (envoyée dans un en-tête seulement).
        req.log.warn({ code, err: (err as Error)?.message }, 'Test AzuraCast en échec.');
        return failed(code);
      }
    },
  );
}
