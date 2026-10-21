import type { ScriptDoc } from './content.js';
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

// ---- Bibliothèque ------------------------------------------------------------

/** Un « dossier racine » de la bibliothèque : un compte, ou Commun (id null). */
export interface LibraryOwner {
  id: number | null;
  name: string;
  isMe: boolean;
  canWrite: boolean;
}

export interface PublicFolder {
  id: number;
  ownerId: number | null;
  parentId: number | null;
  name: string;
}

export interface ScriptSummary {
  id: number;
  ownerId: number | null;
  folderId: number | null;
  title: string;
  wordCount: number;
  speedWpm: number;
  updatedAt: string;
  updatedByName: string | null;
}

export interface Script extends ScriptSummary {
  content: ScriptDoc;
  version: number;
  canWrite: boolean;
}

export interface Library {
  owners: LibraryOwner[];
  folders: PublicFolder[];
  scripts: ScriptSummary[];
}

export interface SearchHit extends ScriptSummary {
  /** Extrait du texte ; les termes trouvés sont encadrés par \u0002 et \u0003. */
  snippet: string;
}

export interface TrashItem {
  id: number;
  ownerId: number | null;
  ownerName: string;
  title: string;
  wordCount: number;
  deletedAt: string;
  deletedByName: string | null;
  /** Date de suppression définitive automatique. */
  purgeAt: string;
}

export interface RevisionSummary {
  id: number;
  version: number;
  title: string;
  wordCount: number;
  savedAt: string;
  savedByName: string | null;
}

export interface Revision extends RevisionSummary {
  content: ScriptDoc;
}

// ---- Prompteur ------------------------------------------------------------------

export interface PrompterScript {
  id: number;
  title: string;
  content: ScriptDoc;
  speedWpm: number;
  version: number;
  /** Dossier du script (pour Précédent / Suivant) ; absent des copies antérieures à l'étape 3. */
  ownerId?: number | null;
  folderId?: number | null;
}

export interface PrompterState {
  /** Copie du script affiché (gardée même s'il est supprimé : jamais d'écran blanc). */
  script: PrompterScript | null;
  /** Le script affiché a été mis à la corbeille ou supprimé. */
  deleted: boolean;
  sentAt: string | null;
  sentByName: string | null;
}

/** Messages WebSocket serveur → client. */
export type ServerMessage =
  | { type: 'hello'; serverTime: number; settings: Settings; prompter: PrompterState }
  | { type: 'pong'; t0: number; serverTime: number }
  | { type: 'settings'; settings: Settings }
  | { type: 'prompter'; prompter: PrompterState };

/** Messages WebSocket client → serveur. */
export type ClientMessage = { type: 'ping'; t0: number };

/** Codes de fermeture WebSocket propres à l'application. */
export const WS_CLOSE = {
  unauthorized: 4401,
  revoked: 4403,
} as const;
