import { readingSeconds } from './content.js';
import type { ItemTiming } from './rundown.js';

/**
 * Calculs de temps, en fonctions pures : utilisés par le serveur, l'interface et l'écran
 * studio, jamais dupliqués. Les heures « absolues » sont en millisecondes de l'horloge
 * serveur (l'écran applique son décalage avant d'appeler ces fonctions).
 */

// ---- Horloge ----------------------------------------------------------------------

/**
 * Décalage (ms) à ajouter à l'heure locale pour obtenir l'heure serveur,
 * en supposant un trajet aller-retour symétrique.
 */
export function clockOffset(t0: number, serverTime: number, t1: number): number {
  return serverTime - (t0 + t1) / 2;
}

// ---- Conducteur : durées et heures de passage --------------------------------------

/** Durée d'un élément : saisie à la main, sinon lecture du script + durées des repères. */
export function itemSeconds(item: ItemTiming): number {
  if (item.durationSeconds !== null) return item.durationSeconds;
  const s = item.script;
  return s ? readingSeconds(s.wordCount, s.speedWpm) + s.cueSeconds : 0;
}

/** « HH:MM:SS » → secondes depuis minuit. */
export function timeToSeconds(t: string): number {
  const [h = 0, m = 0, s = 0] = t.split(':').map(Number);
  return h * 3600 + m * 60 + s;
}

/** Secondes depuis minuit → « HH:MM:SS » (au-delà de minuit, on repart de 00:00:00). */
export function secondsToTime(total: number): string {
  const s = ((Math.round(total) % 86400) + 86400) % 86400;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/**
 * Heure de passage de chaque élément (secondes depuis minuit), position depuis le début de
 * l'émission (« +12:30 »), fin du conducteur et durée totale.
 */
export function rundownSchedule(
  startTime: string,
  items: ItemTiming[],
): { starts: number[]; offsets: number[]; end: number; total: number } {
  const start = timeToSeconds(startTime);
  const starts: number[] = [];
  const offsets: number[] = [];
  let t = start;
  for (const item of items) {
    starts.push(t);
    offsets.push(t - start);
    t += itemSeconds(item);
  }
  return { starts, offsets, end: t, total: t - start };
}

// ---- Titre en cours / à venir ------------------------------------------------------

/** Ce qu'il faut d'un titre pour les calculs (voir Track dans air.ts). */
export interface TrackTiming {
  durationMs: number;
  /** Heure de début (horloge serveur, ms) ; null pour un titre pas encore lancé. */
  startedAt: number | null;
  /** Durée de l'intro instrumentale (talk-over), si elle est connue. */
  introMs?: number | null;
}

/** Temps écoulé depuis le début du titre, borné à sa durée. */
export function trackElapsed(track: TrackTiming, now: number): number {
  if (track.startedAt === null) return 0;
  return Math.min(track.durationMs, Math.max(0, now - track.startedAt));
}

/** Temps restant avant la fin du titre (jamais négatif). */
export function trackRemaining(track: TrackTiming, now: number): number {
  return track.durationMs - trackElapsed(track, now);
}

/** Avancement du titre, de 0 à 1. */
export function trackProgress(track: TrackTiming, now: number): number {
  return track.durationMs > 0 ? trackElapsed(track, now) / track.durationMs : 0;
}

/**
 * Vrai si le titre a une heure de début et une durée : temps restant, progression et alerte
 * ont un sens. Faux en mode dégradé (seul le nom du titre est connu).
 */
export function isTimed(track: TrackTiming): boolean {
  return track.startedAt !== null && track.durationMs > 0;
}

/**
 * Heure de démarrage du titre suivant : heure actuelle + temps restant du titre en cours.
 * La durée d'un titre s'arrêtant au point de mix quand il est connu, un enchaînement en fondu
 * est pris en compte. Null si aucun titre minuté n'est en cours.
 */
export function nextStartAt(current: TrackTiming | null, now: number): number | null {
  if (!current || !isTimed(current)) return null;
  return now + trackRemaining(current, now);
}

/** Temps d'intro restant (parler jusqu'au chant) ; null si l'intro n'est pas connue. */
export function introRemaining(track: TrackTiming, now: number): number | null {
  if (track.introMs === null || track.introMs === undefined) return null;
  return Math.max(0, track.introMs - trackElapsed(track, now));
}

export type AlertLevel = 'none' | 'soon' | 'now';

/** Seuils de l'alerte de fin de titre (secondes), paramétrables par la station. */
export interface AlertThresholds {
  soonSeconds: number;
  nowSeconds: number;
}

/** Niveau d'alerte de fin du titre en cours ; jamais d'alerte sans titre minuté. */
export function trackAlertLevel(
  track: TrackTiming | null,
  now: number,
  thresholds: AlertThresholds,
): AlertLevel {
  if (!track || !isTimed(track)) return 'none';
  return alertLevel(trackRemaining(track, now), thresholds);
}

/**
 * Niveau d'alerte d'un compte à rebours, selon le code couleur unique de l'écran :
 * orange = bientôt, rouge = maintenant. Seuils en secondes, bornes incluses.
 */
export function alertLevel(remainingMs: number, thresholds: AlertThresholds): AlertLevel {
  if (remainingMs <= thresholds.nowSeconds * 1000) return 'now';
  if (remainingMs <= thresholds.soonSeconds * 1000) return 'soon';
  return 'none';
}

/** Compte à rebours affiché (m:ss), arrondi à la seconde supérieure : « 0:01 » jusqu'au bout. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
