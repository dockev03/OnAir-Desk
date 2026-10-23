/**
 * État antenne : un objet par studio, versionné. À la connexion, l'écran reçoit l'état
 * complet ; ensuite, seulement les champs modifiés. Chaque nouvelle fonctionnalité (On Air,
 * météo, messages…) y ajoute ses champs sans toucher au transport.
 */

/** Sources d'automation disponibles (RadioDJ et AzuraCast s'ajouteront à la liste). */
export const AUTOMATION_SOURCES = ['none', 'simulator'] as const;
export type AutomationSource = (typeof AUTOMATION_SOURCES)[number];

export const SIMULATOR_SPEED_MAX = 60;

/** Un titre, tel que le décrit un connecteur d'automation. */
export interface Track {
  title: string;
  artist: string;
  durationMs: number;
  /** Heure de début, horloge serveur (ms) ; null pour le titre à venir. */
  startedAt: number | null;
  /** Intro instrumentale et outro, si le connecteur les connaît. */
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

export interface AirState {
  nowPlaying: Track | null;
  next: Track | null;
  source: SourceStatus;
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
