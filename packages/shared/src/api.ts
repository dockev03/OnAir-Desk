import type { Locale, Role, Settings } from './schemas.js';

export interface PublicUser {
  id: number;
  username: string;
  displayName: string;
  role: Role;
  locale: Locale;
  isActive: boolean;
  createdAt: string;
}

export interface PublicDevice {
  id: number;
  name: string;
  createdAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
}

/** Réponse de GET /api/auth/me : soit un compte, soit un appareil kiosk. */
export type Me = { kind: 'user'; user: PublicUser } | { kind: 'device'; device: PublicDevice };

export interface SetupStatus {
  needsSetup: boolean;
}

/** Réponse à la création ou à la régénération d'un appareil : le jeton n'est montré qu'une fois. */
export interface DeviceWithToken {
  device: PublicDevice;
  token: string;
}

export interface ApiError {
  error: string;
  message?: string;
}

/** Messages WebSocket serveur → client. */
export type ServerMessage =
  | { type: 'hello'; serverTime: number; settings: Settings }
  | { type: 'pong'; t0: number; serverTime: number }
  | { type: 'settings'; settings: Settings };

/** Messages WebSocket client → serveur. */
export type ClientMessage = { type: 'ping'; t0: number };

/** Codes de fermeture WebSocket propres à l'application. */
export const WS_CLOSE = {
  unauthorized: 4401,
  revoked: 4403,
} as const;
