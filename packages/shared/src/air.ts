/**
 * État antenne : un objet par studio, versionné. À la connexion, l'écran reçoit l'état
 * complet ; ensuite, seulement les champs modifiés. Chaque nouvelle fonctionnalité (On Air,
 * météo, messages…) y ajoute ses champs sans toucher au transport.
 */

/** Sources d'automation disponibles. */
export const AUTOMATION_SOURCES = ['none', 'simulator', 'radiodj', 'azuracast'] as const;
export type AutomationSource = (typeof AUTOMATION_SOURCES)[number];
/** Sources réelles (tout sauf « aucune ») : celles que la bascule direct / hors direct accepte. */
export const CONNECTED_SOURCES = ['simulator', 'radiodj', 'azuracast'] as const;
export type ConnectedSource = (typeof CONNECTED_SOURCES)[number];

export const SIMULATOR_SPEED_MAX = 60;

/**
 * Un titre, tel que le décrit un connecteur d'automation. Un titre sans durée ni heure de
 * début (mode dégradé : seul son nom est connu) s'affiche sans temps restant ni alerte.
 */
export interface Track {
  title: string;
  artist: string;
  /** Durée jusqu'au départ du titre suivant (point de mix s'il est connu). */
  durationMs: number;
  /** Heure de début, horloge serveur (ms) ; null pour le titre à venir. */
  startedAt: number | null;
  /** Intro instrumentale et outro (durées depuis le début / avant la fin), si connues. */
  introMs: number | null;
  outroMs: number | null;
}

export type SourceState = 'stopped' | 'ok' | 'error';

export interface SourceStatus {
  id: AutomationSource;
  state: SourceState;
  /** Dernière information reçue du connecteur (horloge serveur, ms). */
  updatedAt: number | null;
  /** Message d'erreur technique (journalisé, affiché à l'admin). */
  error: string | null;
}

/**
 * Bascule direct / hors direct (voir docs/plan-etape-8.md, décisions 7 à 9) : quelle source est
 * à l'antenne, et pourquoi. Absent (null) en mode « source unique ».
 */
export interface LiveState {
  /** Vrai : la source du direct est à l'antenne. */
  active: boolean;
  /** Bascule forcée par l'admin (sinon automatique). */
  forced: boolean;
  /** État de chacune des deux sources. */
  liveSource: SourceStatus;
  offAirSource: SourceStatus;
}

export interface AirState {
  nowPlaying: Track | null;
  next: Track | null;
  /** Source dont les titres sont affichés. */
  source: SourceStatus;
  live: LiveState | null;
}

export interface Studio {
  id: number;
  name: string;
}

/** État antenne et sa version, tels que l'écran les garde. */
export interface AirSnapshot {
  version: number;
  state: AirState;
}

/** Message « air » : état complet (full) ou champs modifiés depuis la version précédente. */
export interface AirMessage {
  type: 'air';
  version: number;
  full: boolean;
  changes: Partial<AirState>;
}

export const emptyAirState = (source: AutomationSource = 'none'): AirState => ({
  nowPlaying: null,
  next: null,
  source: { id: source, state: 'stopped', updatedAt: null, error: null },
  live: null,
});

/**
 * Application d'un message « air » côté écran. Renvoie le nouvel état, ou « resync » si une
 * version manque (message perdu pendant une reconnexion) : il faut redemander l'état complet.
 */
export function applyAirMessage(
  current: AirSnapshot | null,
  msg: AirMessage,
): AirSnapshot | 'resync' {
  if (msg.full) return { version: msg.version, state: { ...emptyAirState(), ...msg.changes } };
  if (!current) return 'resync';
  if (msg.version <= current.version) return current;
  if (msg.version !== current.version + 1) return 'resync';
  return { version: msg.version, state: { ...current.state, ...msg.changes } };
}
