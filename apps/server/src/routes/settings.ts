import type { FastifyInstance } from 'fastify';
import {
  MAX_LOGO_BYTES,
  logoUploadSchema,
  settingsSchema,
  settingsUpdateSchema,
  type AirSnapshot,
  type Settings,
} from '@onair-desk/shared';
import { requireAdmin, requireIdentity, studioOf } from '../auth/identity.js';
import { DEFAULT_STUDIO_ID } from '../db/index.js';
import { badRequest, notFound } from '../lib/errors.js';
import { detectImageType } from '../lib/image.js';
import { parse } from '../lib/validate.js';
import type { RouteContext } from './context.js';

/** Logo de 3 Mo encodé en base64 (+ un tiers), plus l'enveloppe JSON. */
const LOGO_BODY_LIMIT = 4.5 * 1024 * 1024;

export function registerSettingsRoutes(app: FastifyInstance, ctx: RouteContext) {
  const { repos, hub } = ctx;

  app.get('/api/settings', async (req) => {
    requireIdentity(req);
    return repos.settings.get();
  });

  app.put('/api/settings', async (req) => {
    const admin = requireAdmin(req);
    const values = parse(settingsUpdateSchema, req.body);
    // Contrôle de l'ensemble après fusion (ex. cohérence des repères).
    parse(settingsSchema, { ...repos.settings.get(), ...values });
    const before = repos.settings.get();
    const settings = repos.settings.set(values);
    hub.broadcastSettings(settings);
    repos.audit.write({ type: 'user', id: admin.id }, 'settings.updated', {
      fields: Object.keys(values),
    });
    if (
      settings.automationSource !== before.automationSource ||
      settings.simulatorSpeed !== before.simulatorSpeed
    ) {
      repos.audit.write(
        { type: 'user', id: admin.id },
        'automation.source_changed',
        {
          from: before.automationSource,
          to: settings.automationSource,
          speed: settings.simulatorSpeed,
        },
        DEFAULT_STUDIO_ID,
      );
      ctx.automation.apply(settings);
    }
    return settings;
  });

  // État antenne du studio de l'appelant (état du connecteur pour la page Paramètres).
  app.get('/api/air', async (req): Promise<AirSnapshot> => {
    return ctx.air.get(studioOf(requireIdentity(req)));
  });

  // ---- Logo de la station ----------------------------------------------------------

  app.put('/api/settings/logo', { bodyLimit: LOGO_BODY_LIMIT }, async (req): Promise<Settings> => {
    const admin = requireAdmin(req);
    const { data } = parse(logoUploadSchema, req.body);
    const bytes = Buffer.from(data, 'base64');
    if (bytes.length > MAX_LOGO_BYTES) throw badRequest('logo_too_large');
    const mime = detectImageType(bytes);
    if (!mime) throw badRequest('logo_type');
    const hash = repos.logo.set(bytes, mime);
    const settings = repos.settings.get();
    hub.broadcastSettings(settings);
    repos.audit.write({ type: 'user', id: admin.id }, 'logo.updated', {
      type: mime,
      bytes: bytes.length,
      hash,
    });
    return settings;
  });

  app.delete('/api/settings/logo', async (req): Promise<Settings> => {
    const admin = requireAdmin(req);
    repos.logo.clear();
    const settings = repos.settings.get();
    hub.broadcastSettings(settings);
    repos.audit.write({ type: 'user', id: admin.id }, 'logo.removed');
    return settings;
  });

  // Public : affiché sur la page de connexion et l'écran studio. Avec ?v=<empreinte> (lien
  // fourni par les paramètres), l'image peut rester en cache : le lien change avec elle.
  app.get('/api/station/logo', async (req, reply) => {
    const logo = repos.logo.get();
    if (!logo) throw notFound();
    const etag = `"${logo.hash}"`;
    const { v } = req.query as { v?: unknown };
    reply
      .header('etag', etag)
      .header('x-content-type-options', 'nosniff')
      .header(
        'cache-control',
        v === logo.hash ? 'public, max-age=31536000, immutable' : 'no-cache',
      );
    if (req.headers['if-none-match'] === etag) return reply.code(304).send();
    return reply.type(logo.mime).send(logo.data);
  });
}
