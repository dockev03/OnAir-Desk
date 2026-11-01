import type { Track } from '@onair-desk/shared';

/** Ce qu'un connecteur transmet au cœur à chaque changement. */
export interface AutomationUpdate {
  nowPlaying: Track | null;
  next: Track | null;
  /**
   * La source indique que l'antenne est en direct (AzuraCast : un DJ / streamer est connecté).
   * Absent : la source ne le sait pas. Sert à la bascule automatique direct / hors direct.
   */
  live?: boolean;
}

/** Ce que le cœur fournit à un connecteur. */
export interface ConnectorContext {
  /** Heure serveur (ms) : toutes les heures de début transmises doivent l'utiliser. */
  now(): number;
  /** Titre en cours et titre à venir. */
  update(update: AutomationUpdate): void;
  /** La source est illisible (message technique) : le cœur affiche l'erreur et réessaie. */
  fail(error: string): void;
}

/**
 * Contrat commun des connecteurs d'automation (RadioDJ, AzuraCast, simulateur…). Le cœur ne
 * connaît que lui : il calcule seul temps restant et heure de démarrage du titre suivant.
 * Un connecteur ne doit jamais lever d'exception hors de start : il appelle fail.
 */
export interface AutomationConnector {
  start(ctx: ConnectorContext): void | Promise<void>;
  /** Arrêt propre : plus aucun appel au contexte ensuite. */
  stop(): void;
  /**
   * Signal entrant de l'automation (« un titre démarre »), reçu à l'heure serveur indiquée,
   * avec le nom brut transmis (« Artiste - Titre », éventuellement vide).
   * Facultatif : seuls les connecteurs alimentés par un signal (RadioDJ) l'implémentent.
   */
  signal?(receivedAt: number, title: string): void;
}
