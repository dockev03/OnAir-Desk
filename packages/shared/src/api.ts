import type { AirMessage, AirSnapshot, Studio, WeatherNow } from './air.js';
import type { ScriptDoc } from './content.js';
import type { ItemScriptInfo } from './rundown.js';
import type { Layout } from './layout.js';
import type { Locale, Role, Settings } from './schemas.js';
import type { SkipReason, TemplateExclusion } from './template.js';

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
  /** Studio dont l'écran affiche l'état antenne et le prompteur. */
  studioId: number;
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

// ---- Connecteurs ---------------------------------------------------------------

/** État du jeton d'un connecteur entrant (plugin RadioDJ) et de l'écoute qui le reçoit. */
export interface ConnectorTokenStatus {
  /** Un jeton a été généré (il n'est jamais renvoyé ensuite). */
  configured: boolean;
  createdAt: string | null;
  /** Port HTTP dédié aux connecteurs (CONNECTOR_HTTP_PORT) ; null : écoute fermée. */
  httpPort: number | null;
}

/** Réponse à la génération d'un jeton de connecteur : montré une seule fois. */
export interface ConnectorTokenCreated {
  status: ConnectorTokenStatus;
  token: string;
}

/** Résultat du bouton « Tester la connexion » à la base RadioDJ. */
export interface RadiodjTestResult {
  ok: boolean;
  /** Code d'erreur stable (traduit côté interface) quand ok est faux. */
  error: string | null;
  /** Nombre de titres de la bibliothèque, pour confirmer la bonne base. */
  songs: number | null;
}

/** Un titre de la bibliothèque RadioDJ (choix d'un titre dans un conducteur). */
export interface RadiodjSong {
  id: number;
  artist: string;
  title: string;
  /** Année, si elle est renseignée dans RadioDJ. */
  year: number | null;
  /** Durée jusqu'au point de mix si les repères le donnent. */
  durationMs: number;
  /** Intro (repère « int »), si elle est marquée. */
  introMs: number | null;
}

/**
 * Résultat du bouton « Tester la connexion » à AzuraCast. `auth` : clé non nécessaire
 * (« none »), acceptée, refusée (clé fournie mais rejetée) ou requise (aucune clé fournie).
 */
export interface AzuracastTestResult {
  ok: boolean;
  /** Code d'erreur stable (traduit côté interface) quand ok est faux. */
  error: string | null;
  auth: 'none' | 'accepted' | 'refused' | 'required' | null;
  /** Une clé est fournie au serveur (AZURACAST_API_KEY) ; sa valeur n'est jamais renvoyée. */
  keyConfigured: boolean;
  stationName: string | null;
  /** Titre en cours (« Artiste - Titre »), pour confirmer la bonne station. */
  nowPlaying: string | null;
  live: boolean | null;
}

/** État On Air renvoyé par l'API (équipements, logiciels, bouton manuel). */
export interface OnAirResponse {
  on: boolean;
  /** Heure serveur (ms) du dernier passage ; null : jamais. */
  since: number | null;
}

/** Résultat du bouton « Tester » de la météo. */
export interface WeatherTestResult {
  ok: boolean;
  /** Code d'erreur stable (traduit côté interface) quand ok est faux. */
  error: string | null;
  weather: WeatherNow | null;
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
  /** Durée cumulée des repères (jingles, sons…), en secondes. */
  cueSeconds: number;
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
  kind: 'script' | 'rundown' | 'template';
  id: number;
  ownerId: number | null;
  ownerName: string;
  title: string;
  /** Script : nombre de mots ; conducteur ou modèle : nombre d'éléments. */
  wordCount?: number;
  itemCount?: number;
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

// ---- Conducteurs -----------------------------------------------------------------

export interface RundownSummary {
  id: number;
  ownerId: number | null;
  title: string;
  /** Date de diffusion AAAA-MM-JJ. */
  airDate: string;
  /** Heure de début HH:MM:SS. */
  startTime: string;
  itemCount: number;
  /** Durée totale prévue, en secondes. */
  totalSeconds: number;
  updatedAt: string;
  updatedByName: string | null;
  /** Modèle d'origine (conducteur créé depuis un modèle), sinon null. */
  templateId: number | null;
  /** Disposition de l'écran studio ; null : celle des paramètres. */
  layout: Layout | null;
}

export interface RundownItem {
  uid: string;
  typeId: string;
  title: string;
  /** Durée saisie à la main ; null : calculée depuis le script. */
  durationSeconds: number | null;
  notes: string;
  scriptId: number | null;
  /** Script attaché (sans son contenu) ; null si aucun ou supprimé définitivement. */
  script: ItemScriptInfo | null;
  /** Titre musical : artiste (vide sinon), année, intro (talk-up) en secondes. */
  artist: string;
  year: number | null;
  introSeconds: number | null;
  /** Étiquettes (identifiants des paramètres). */
  tags: string[];
  /** À couper si l'émission déborde. */
  cuttable: boolean;
}

export interface Rundown extends RundownSummary {
  /** Notes générales (consignes, règles de jeu). */
  notes: string;
  items: RundownItem[];
  version: number;
  canWrite: boolean;
  /** Modèle d'origine, s'il existe encore (null s'il a été supprimé définitivement). */
  template: { id: number; title: string; deleted: boolean } | null;
}

// ---- Modèles d'émission récurrente -------------------------------------------------

export interface TemplateSummary {
  id: number;
  ownerId: number | null;
  title: string;
  startTime: string;
  /** Jours de diffusion, 1 = lundi … 7 = dimanche. */
  days: number[];
  validFrom: string | null;
  validUntil: string | null;
  active: boolean;
  /** Disposition de l'écran studio, copiée dans les conducteurs créés. */
  layout: Layout | null;
  itemCount: number;
  totalSeconds: number;
  updatedAt: string;
  updatedByName: string | null;
}

export interface Template extends TemplateSummary {
  exclusions: TemplateExclusion[];
  notes: string;
  items: RundownItem[];
  version: number;
  canWrite: boolean;
}

/** Résumé de « Créer les conducteurs ». */
export interface CreateFromTemplateResult {
  created: { date: string; rundownId: number }[];
  /** Dates déjà créées depuis ce modèle (même supprimées ou déplacées depuis). */
  existing: string[];
  skipped: { date: string; reason: SkipReason }[];
}

export interface RundownList {
  /** Date du jour dans le fuseau de la station (AAAA-MM-JJ). */
  today: string;
  rundowns: RundownSummary[];
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

/** Conducteur affiché sur l'écran studio (copie, sans le contenu des scripts). */
export interface PrompterRundown {
  id: number;
  ownerId: number | null;
  title: string;
  airDate: string;
  startTime: string;
  /** Disposition de l'écran studio ; absente des copies antérieures à l'étape 8. */
  layout?: Layout | null;
  items: RundownItem[];
}

export interface PrompterState {
  /** Copie du script affiché (gardée même s'il est supprimé : jamais d'écran blanc). */
  script: PrompterScript | null;
  /** Conducteur suivi, et élément en cours ; null si un script seul est affiché. */
  rundown: PrompterRundown | null;
  itemUid: string | null;
  /** Le script affiché a été mis à la corbeille ou supprimé. */
  deleted: boolean;
  sentAt: string | null;
  sentByName: string | null;
}

/** Messages WebSocket serveur → client. */
export type ServerMessage =
  | {
      type: 'hello';
      serverTime: number;
      settings: Settings;
      prompter: PrompterState;
      studio: Studio;
      air: AirSnapshot;
    }
  | { type: 'pong'; t0: number; serverTime: number }
  | { type: 'settings'; settings: Settings }
  | { type: 'prompter'; prompter: PrompterState }
  | AirMessage;

/** Messages WebSocket client → serveur. */
export type ClientMessage =
  | { type: 'ping'; t0: number }
  /** Demande de l'état antenne complet (version manquante). */
  | { type: 'air.sync' };

/** Codes de fermeture WebSocket propres à l'application. */
export const WS_CLOSE = {
  unauthorized: 4401,
  revoked: 4403,
} as const;
