import type { WebSocket } from 'ws';
import { WS_CLOSE, type ServerMessage, type Settings } from '@onair-desk/shared';
import type { Identity } from '../auth/identity.js';

interface Client {
  socket: WebSocket;
  identity: Identity;
  alive: boolean;
}

/** Connexions WebSocket ouvertes (écran studio, postes animateurs). */
export class Hub {
  private readonly clients = new Set<Client>();
  private heartbeat?: NodeJS.Timeout;

  constructor(private readonly heartbeatMs = 30_000) {}

  add(socket: WebSocket, identity: Identity): Client {
    const client: Client = { socket, identity, alive: true };
    this.clients.add(client);
    socket.on('pong', () => (client.alive = true));
    socket.on('close', () => this.clients.delete(client));
    socket.on('error', () => socket.terminate());
    this.heartbeat ??= setInterval(() => this.checkAlive(), this.heartbeatMs).unref();
    return client;
  }

  get size(): number {
    return this.clients.size;
  }

  send(client: Client, msg: ServerMessage): void {
    if (client.socket.readyState === client.socket.OPEN) client.socket.send(JSON.stringify(msg));
  }

  broadcastSettings(settings: Settings): void {
    for (const c of this.clients) this.send(c, { type: 'settings', settings });
  }

  /** Ferme les connexions qui correspondent au filtre (révocation, déconnexion…). */
  disconnect(match: (identity: Identity) => boolean, code: number = WS_CLOSE.unauthorized): void {
    for (const c of this.clients) {
      if (match(c.identity)) c.socket.close(code);
    }
  }

  disconnectDevice(deviceId: number): void {
    this.disconnect((i) => i.kind === 'device' && i.device.id === deviceId, WS_CLOSE.revoked);
  }

  disconnectUser(userId: number, exceptSessionIdHash?: string): void {
    this.disconnect(
      (i) => i.kind === 'user' && i.user.id === userId && i.sessionIdHash !== exceptSessionIdHash,
    );
  }

  disconnectSession(sessionIdHash: string): void {
    this.disconnect((i) => i.kind === 'user' && i.sessionIdHash === sessionIdHash);
  }

  /** Revalide périodiquement les identités (session expirée, appareil révoqué hors API…). */
  revalidate(isStillValid: (identity: Identity) => boolean): void {
    this.disconnect((i) => !isStillValid(i));
  }

  close(): void {
    clearInterval(this.heartbeat);
    for (const c of this.clients) c.socket.terminate();
    this.clients.clear();
  }

  private checkAlive(): void {
    for (const c of this.clients) {
      if (!c.alive) {
        c.socket.terminate();
        continue;
      }
      c.alive = false;
      c.socket.ping();
    }
  }
}
