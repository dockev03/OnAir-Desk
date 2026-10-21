import type { FastifyInstance } from 'fastify';
import {
  deviceNameSchema,
  idParamSchema,
  pairDeviceSchema,
  type DeviceWithToken,
} from '@onair-desk/shared';
import {
  DEVICE_COOKIE,
  DEVICE_COOKIE_MAX_AGE_S,
  requireAdmin,
  sessionCookieOptions,
} from '../auth/identity.js';
import { hashToken, randomToken } from '../auth/tokens.js';
import { HttpError, notFound } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { strictRateLimit, type RouteContext } from './context.js';

export function registerDeviceRoutes(app: FastifyInstance, ctx: RouteContext) {
  const { repos, hub, config } = ctx;

  app.get('/api/devices', async (req) => {
    requireAdmin(req);
    return repos.devices.list();
  });

  app.post('/api/devices', async (req, reply) => {
    const admin = requireAdmin(req);
    const { name } = parse(deviceNameSchema, req.body);
    const token = randomToken();
    const device = repos.devices.create(name, hashToken(token));
    repos.audit.write({ type: 'user', id: admin.id }, 'device.created', { deviceId: device.id });
    const body: DeviceWithToken = { device, token };
    return reply.code(201).send(body);
  });

  app.post('/api/devices/:id/regenerate', async (req): Promise<DeviceWithToken> => {
    const admin = requireAdmin(req);
    const { id } = parse(idParamSchema, req.params);
    if (!repos.devices.findById(id)) throw notFound();
    const token = randomToken();
    const device = repos.devices.replaceToken(id, hashToken(token))!;
    hub.disconnectDevice(id);
    repos.audit.write({ type: 'user', id: admin.id }, 'device.regenerated', { deviceId: id });
    return { device, token };
  });

  app.post('/api/devices/:id/revoke', async (req) => {
    const admin = requireAdmin(req);
    const { id } = parse(idParamSchema, req.params);
    const device = repos.devices.revoke(id);
    if (!device) throw notFound();
    hub.disconnectDevice(id);
    repos.audit.write({ type: 'user', id: admin.id }, 'device.revoked', { deviceId: id });
    return device;
  });

  app.delete('/api/devices/:id', async (req, reply) => {
    const admin = requireAdmin(req);
    const { id } = parse(idParamSchema, req.params);
    if (!repos.devices.findById(id)) throw notFound();
    hub.disconnectDevice(id);
    repos.devices.delete(id);
    repos.audit.write({ type: 'user', id: admin.id }, 'device.deleted', { deviceId: id });
    return reply.code(204).send();
  });

  // Appairage du kiosk : le jeton (lu dans le # de l'URL) est échangé contre un cookie httpOnly.
  app.post(
    '/api/kiosk/pair',
    { config: { ...strictRateLimit, deviceMayWrite: true } },
    async (req, reply) => {
      const { token } = parse(pairDeviceSchema, req.body);
      const device = repos.devices.findActiveByTokenHash(hashToken(token));
      if (!device) {
        repos.audit.write({ type: 'anonymous' }, 'device.pair_failed', { ip: req.ip });
        throw new HttpError(401, 'bad_device_token');
      }
      repos.devices.touch(device.id);
      repos.audit.write({ type: 'device', id: device.id }, 'device.paired', { ip: req.ip });
      reply.setCookie(DEVICE_COOKIE, token, {
        ...sessionCookieOptions(config.secureCookies),
        maxAge: DEVICE_COOKIE_MAX_AGE_S,
      });
      return { device };
    },
  );
}
