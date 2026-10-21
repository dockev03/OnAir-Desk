import type { FastifyInstance } from 'fastify';
import type { ClientMessage } from '@onair-desk/shared';
import { WS_CLOSE } from '@onair-desk/shared';
import type { Repos } from '../db/index.js';
import type { Library } from '../library.js';
import type { Hub } from './hub.js';

const MAX_MESSAGE_BYTES = 1024;

export function registerWsRoutes(
  app: FastifyInstance,
  repos: Repos,
  hub: Hub,
  library: Library,
  allowedOrigins: string[],
) {
  app.get('/api/ws', { websocket: true }, (socket, req) => {
    // Le navigateur envoie toujours Origin à l'ouverture d'un WebSocket : on refuse les autres sites.
    const origin = req.headers.origin;
    if (!origin || !allowedOrigins.includes(origin) || !req.identity) {
      socket.close(WS_CLOSE.unauthorized);
      return;
    }
    const client = hub.add(socket, req.identity);
    hub.send(client, {
      type: 'hello',
      serverTime: Date.now(),
      settings: repos.settings.get(),
      prompter: library.prompterState(),
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
      }
    });
  });
}
