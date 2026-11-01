import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  radiodjSettingsSchema,
  sourcesInUse,
  type ConnectorTokenCreated,
  type ConnectorTokenStatus,
  type RadiodjSong,
  type RadiodjTestResult,
} from '@onair-desk/shared';
import { requireAdmin, requireUser } from '../auth/identity.js';
import { hashToken, randomToken } from '../auth/tokens.js';
import { songTiming, displayArtist } from '../connectors/radiodj/cues.js';
import { radiodjErrorCode, type RadiodjReader } from '../connectors/radiodj/reader.js';
import { HttpError, badRequest } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { strictRateLimit, type RouteContext } from './context.js';

/** Nombre de résultats d'une recherche de titres. */
export const SONG_SEARCH_LIMIT = 20;

const songSearchSchema = z.object({ q: z.string().trim().min(2).max(100) });
const testBodySchema = z.object({ radiodj: radiodjSettingsSchema.optional() }).strict();

/** Erreur d'ouverture ou de requête → code stable (les codes de configuration passent tels quels). */
const errorCode = (err: unknown): string => {
  const message = (err as Error)?.message ?? '';
  return /^radiodj_[a-z_]+$/.test(message) ? message : radiodjErrorCode(err);
};

/** Ouvre la base, exécute, referme toujours. */
async function withReader<T>(open: () => RadiodjReader, run: (r: RadiodjReader) => Promise<T>) {
  const reader = open();
  try {
    return await run(reader);
  } finally {
    await reader.close().catch(() => undefined);
  }
}

export function registerRadiodjRoutes(app: FastifyInstance, ctx: RouteContext) {
  const { repos, config } = ctx;

  const tokenStatus = (): ConnectorTokenStatus => {
    const createdAt = repos.connectorTokens.createdAt('radiodj') ?? null;
    return { configured: createdAt !== null, createdAt, httpPort: config.connectorHttpPort };
  };

  // ---- Jeton du plugin (champ Password de RadioDJ) ---------------------------------

  app.get('/api/settings/radiodj/token', async (req): Promise<ConnectorTokenStatus> => {
    requireAdmin(req);
    return tokenStatus();
  });

  app.post(
    '/api/settings/radiodj/token',
    { config: strictRateLimit },
    async (req): Promise<ConnectorTokenCreated> => {
      const admin = requireAdmin(req);
      const replaced = repos.connectorTokens.createdAt('radiodj') !== undefined;
      // Jeton lisible et sans caractère à encoder : il est recopié dans RadioDJ.
      const token = randomToken(24);
      repos.connectorTokens.set('radiodj', hashToken(token));
      repos.audit.write({ type: 'user', id: admin.id }, 'connector.token_generated', {
        connector: 'radiodj',
        replaced,
      });
      return { status: tokenStatus(), token };
    },
  );

  // ---- Test de la connexion à la base -------------------------------------------------

  app.post(
    '/api/settings/radiodj/test',
    { config: strictRateLimit },
    async (req): Promise<RadiodjTestResult> => {
      requireAdmin(req);
      // Accès saisi mais pas encore enregistré, sinon celui des paramètres.
      const body = parse(testBodySchema, req.body ?? {});
      const settings = body.radiodj ?? repos.settings.get().radiodj;
      try {
        const songs = await withReader(
          () => ctx.automation.openRadiodj(settings),
          async (r) => {
            const n = await r.countSongs();
            // Les tables lues par le connecteur doivent exister.
            await r.current();
            await r.next();
            return n;
          },
        );
        return { ok: true, error: null, songs };
      } catch (err) {
        const code = errorCode(err);
        req.log.warn({ code, err: (err as Error)?.message }, 'Test de la base RadioDJ en échec.');
        return { ok: false, error: code, songs: null };
      }
    },
  );

  // ---- Bibliothèque RadioDJ : choix d'un titre dans un conducteur ---------------------

  app.get('/api/radiodj/songs', async (req): Promise<RadiodjSong[]> => {
    requireUser(req);
    const { q } = parse(songSearchSchema, req.query);
    const settings = repos.settings.get();
    if (!sourcesInUse(settings).includes('radiodj')) throw badRequest('radiodj_not_source');
    try {
      const rows = await withReader(
        () => ctx.automation.openRadiodj(settings.radiodj),
        (r) => r.searchSongs(q, SONG_SEARCH_LIMIT),
      );
      return rows.map((r) => ({
        id: r.id,
        artist: displayArtist(r.artist),
        title: r.title,
        durationMs: Math.round(songTiming(r).durationSec * 1000),
      }));
    } catch (err) {
      const code = errorCode(err);
      req.log.warn({ code, err: (err as Error)?.message }, 'Recherche RadioDJ en échec.');
      // La base RadioDJ (service tiers) ne répond pas comme attendu.
      throw new HttpError(502, code);
    }
  });
}
