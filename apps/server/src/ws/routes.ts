import type { FastifyInstance } from 'fastify';
import type { ClientMessage } from '@onair-desk/shared';
import { WS_CLOSE } from '@onair-desk/shared';
import { studioOf } from '../auth/identity.js';
import type { RouteContext } from '../routes/context.js';

const MAX_MESSAGE_BYTES = 1024;
/** Une demande d'état complet par seconde au plus et par connexion. */
const SYNC_INTERVAL_MS = 1000;

export function registerWsRoutes(app: FastifyInstance, ctx: RouteContext) {
  const { repos, hub, library, air, config } = ctx;

  app.get('/api/ws', { websocket: true }, (socket, req) => {
    // Le navigateur envoie toujours Origin à l'ouverture d'un WebSocket : on refuse les autres sites.
    const origin = req.headers.origin;
    if (!origin || !config.allowedOrigins.includes(origin) || !req.identity) {
      socket.close(WS_CLOSE.unauthorized);
      return;
    }
    const studioId = studioOf(req.identity);
    const client = hub.add(socket, req.identity, studioId);
    const studio = repos.studios.findById(studioId) ?? { id: studioId, name: '' };
    hub.send(client, {
      type: 'hello',
      serverTime: Date.now(),
      settings: repos.settings.get(),
      prompter: library.prompterState(studioId),
      studio,
      air: air.get(studioId),
    });

    socket.on('message', (raw: Buffer, isBinary: boolean) => {
      if (isBinary || raw.length > MAX_MESSAGE_BYTES) return;
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString('utf8')) as ClientMessage;
      } catch {
        return;
      }
      if (msg?.type === 'ping' && Number.isFinite(msg.t0)) {
        hub.send(client, { type: 'pong', t0: msg.t0, serverTime: Date.now() });
      } else if (msg?.type === 'air.sync') {
        const now = Date.now();
        if (now - client.lastSync < SYNC_INTERVAL_MS) return;
        client.lastSync = now;
        hub.send(client, air.full(studioId));
      }
    });
  });
}
