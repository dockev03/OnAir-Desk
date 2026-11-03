import { readingSeconds } from './content.js';
import type { ItemTiming } from './rundown.js';
import { addDays, localDateIn, zonedToEpoch } from './time.js';
import {
  FIXED_NOW_SHOWN_MS,
  type FixedTime,
  type Passage,
  type ReportLine,
  type RunItem,
  type RunReport,
  type RunState,
  type TimeTrackingSettings,
} from './tracking.js';

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

// ---- Chronomètre micro ouvert ------------------------------------------------------

/** Après l'extinction, la dernière durée reste affichée, grisée, 10 secondes. */
export const MIC_LAST_SHOWN_MS = 10_000;

/** Ce qu'il faut de l'état On Air pour le chronomètre (voir OnAirState dans air.ts). */
export interface MicState {
  on: boolean;
  since: number | null;
  lastDurationMs: number | null;
}

/**
 * Chronomètre micro ouvert : temps écoulé depuis l'allumage ; après l'extinction, la dernière
 * durée pendant 10 s (`running` faux). Null : rien à afficher.
 */
export function micTimer(state: MicState, now: number): { ms: number; running: boolean } | null {
  if (state.since === null) return null;
  if (state.on) return { ms: Math.max(0, now - state.since), running: true };
  if (state.lastDurationMs === null || now - state.since > MIC_LAST_SHOWN_MS) return null;
  return { ms: state.lastDurationMs, running: false };
}

/** Durée écoulée affichée : m:ss, puis h:mm:ss au-delà d'une heure (secondes entières). */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

// ---- Suivi du temps (étape 11) -----------------------------------------------------

/** Compte à rebours vers le prochain horaire fixe. */
export interface FixedCountdown {
  id: string;
  label: string;
  /** Heure de l'horaire (horloge serveur, ms). */
  at: number;
  /** Temps restant (négatif pendant les 10 s « maintenant »). */
  remainingMs: number;
}

/**
 * Prochain horaire fixe actif dont la prévenance a commencé (ou passé depuis moins de 10 s,
 * « maintenant ») ; le plus proche l'emporte. Heures dans le fuseau de la station.
 */
export function nextFixedTime(
  fixedTimes: readonly FixedTime[],
  now: number,
  timezone: string,
): FixedCountdown | null {
  const today = localDateIn(now, timezone);
  let best: FixedCountdown | null = null;
  for (const f of fixedTimes) {
    if (!f.active) continue;
    for (const offset of [-1, 0, 1]) {
      const date = addDays(today, offset);
      const day = new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
      if (!f.days.includes(day)) continue;
      for (const hour of f.hours) {
        const pad = (n: number) => String(n).padStart(2, '0');
        const at = zonedToEpoch(`${date} ${pad(hour)}:${pad(f.minute)}:00`, timezone);
        if (at === null) continue;
        const remainingMs = at - now;
        if (remainingMs < -FIXED_NOW_SHOWN_MS || remainingMs > f.warnMinutes * 60_000) continue;
        if (!best || at < best.at) best = { id: f.id, label: f.label, at, remainingMs };
      }
    }
  }
  return best;
}

/** Niveau d'un horaire fixe : orange à 1 min, rouge à 10 s (puis « maintenant »). */
export function fixedTimeLevel(remainingMs: number): AlertLevel {
  return alertLevel(remainingMs, { soonSeconds: 60, nowSeconds: 10 });
}

/** Heure prévue de chaque élément d'un déroulé (horloge serveur, ms). */
export function runPlannedStarts(run: Pick<RunState, 'baseAt' | 'items'>): number[] {
  let t = run.baseAt;
  return run.items.map((item) => {
    const start = t;
    t += item.plannedSeconds * 1000;
    return start;
  });
}

/** Élément en cours : le dernier pointé (heure réelle la plus récente). */
export function currentPassage(run: Pick<RunState, 'passages'>): Passage | null {
  let last: Passage | null = null;
  for (const p of run.passages) if (!last || p.at >= last.at) last = p;
  return last;
}

/** Minuteur de séquence de l'élément en cours. */
export interface SequenceTimer {
  uid: string;
  elapsedMs: number;
  /** Reste (négatif en dépassement) ; null : élément sans durée prévue (chronomètre seul). */
  remainingMs: number | null;
  /** Élément pointé par l'automation (le bloc « Titre en cours » fait déjà ce travail). */
  automation: boolean;
}

export function sequenceTimer(
  run: Pick<RunState, 'items' | 'passages'>,
  now: number,
): SequenceTimer | null {
  const p = currentPassage(run);
  const item = p && run.items.find((i) => i.uid === p.uid);
  if (!p || !item) return null;
  const elapsedMs = Math.max(0, now - p.at);
  return {
    uid: p.uid,
    elapsedMs,
    remainingMs: item.plannedSeconds > 0 ? item.plannedSeconds * 1000 - elapsedMs : null,
    automation: p.source === 'automation',
  };
}

/**
 * Avance / retard (ms ; positif = retard) : heure réelle de début de l'élément en cours moins
 * son heure prévue, plus son dépassement s'il dure déjà plus que prévu. Null : rien de pointé
 * (ou élément retiré du conducteur).
 */
export function rundownDrift(
  run: Pick<RunState, 'baseAt' | 'items' | 'passages'>,
  now: number,
): number | null {
  const p = currentPassage(run);
  if (!p) return null;
  const index = run.items.findIndex((i) => i.uid === p.uid);
  if (index === -1) return null;
  const planned = runPlannedStarts(run)[index]!;
  const overrun = Math.max(0, now - p.at - run.items[index]!.plannedSeconds * 1000);
  return p.at - planned + overrun;
}

/** Backtiming : temps restant avant la fin imposée et projection de la fin. */
export interface Backtime {
  endAt: number;
  /** Temps restant avant la fin imposée (négatif une fois dépassée). */
  remainingMs: number;
  /** Fin prévue : maintenant + reste de l'élément en cours + éléments suivants. */
  projectedEnd: number;
  /** Positif : temps à caser ; négatif : temps à couper. */
  balanceMs: number;
  /** Durée des éléments « à couper » pas encore passés. */
  cuttableMs: number;
  /** Couper les éléments marqués suffit à tenir la fin. */
  cutSuffices: boolean;
}

export function backtime(
  run: Pick<RunState, 'baseAt' | 'endAt' | 'items' | 'passages'>,
  now: number,
): Backtime | null {
  if (run.endAt === null) return null;
  const p = currentPassage(run);
  const index = p ? run.items.findIndex((i) => i.uid === p.uid) : -1;
  const passed = new Set(run.passages.map((x) => x.uid));
  let projectedEnd: number;
  let cuttableMs: number;
  if (!p || index === -1) {
    // Rien en cours (ou élément retiré) : tout ce qui n'est pas passé reste à faire.
    const rest = run.items.filter((i) => !passed.has(i.uid));
    projectedEnd =
      Math.max(now, p ? now : run.baseAt) +
      rest.reduce((sum, i) => sum + i.plannedSeconds * 1000, 0);
    cuttableMs = rest.filter((i) => i.cuttable).reduce((s, i) => s + i.plannedSeconds * 1000, 0);
  } else {
    const current = run.items[index]!;
    const left = Math.max(0, current.plannedSeconds * 1000 - (now - p.at));
    const after = run.items.slice(index + 1).filter((i) => !passed.has(i.uid));
    projectedEnd = now + left + after.reduce((sum, i) => sum + i.plannedSeconds * 1000, 0);
    cuttableMs = after.filter((i) => i.cuttable).reduce((s, i) => s + i.plannedSeconds * 1000, 0);
  }
  const balanceMs = run.endAt - projectedEnd;
  return {
    endAt: run.endAt,
    remainingMs: run.endAt - now,
    projectedEnd,
    balanceMs,
    cuttableMs,
    cutSuffices: balanceMs < 0 && cuttableMs > 0 && cuttableMs >= -balanceMs,
  };
}

/** Niveau du retard (l'avance n'est jamais une alerte). */
export function driftLevel(driftMs: number, s: TimeTrackingSettings): AlertLevel {
  if (driftMs >= s.driftNowSeconds * 1000) return 'now';
  if (driftMs >= s.driftSoonSeconds * 1000) return 'soon';
  return 'none';
}

/** Niveau du minuteur de séquence : orange en fin de séquence, rouge en dépassement. */
export function sequenceLevel(remainingMs: number | null, s: TimeTrackingSettings): AlertLevel {
  if (remainingMs === null) return 'none';
  if (remainingMs < 0) return 'now';
  return remainingMs <= s.sequenceSoonSeconds * 1000 ? 'soon' : 'none';
}

/** Niveau du temps restant avant la fin imposée. */
export function endLevel(remainingMs: number, s: TimeTrackingSettings): AlertLevel {
  if (remainingMs <= s.endNowMinutes * 60_000) return 'now';
  if (remainingMs <= s.endSoonMinutes * 60_000) return 'soon';
  return 'none';
}

/** Niveau de « à couper » : orange, rouge à l'approche de la fin ; « à caser » : neutre. */
export function balanceLevel(bt: Backtime, s: TimeTrackingSettings): AlertLevel {
  if (bt.balanceMs >= 0) return 'none';
  return bt.remainingMs <= s.endSoonMinutes * 60_000 ? 'now' : 'soon';
}

/** Durée signée : « +1:20 », « −0:45 » (signe moins typographique). */
export function formatSigned(ms: number): string {
  const sign = ms < 0 ? '−' : '+';
  return `${sign}${formatElapsed(Math.abs(Math.round(ms / 1000) * 1000))}`;
}

/** Ce qu'il faut d'un déroulé (enregistré) pour en faire le bilan. */
export interface RunForReport {
  id: number;
  rehearsal: boolean;
  startedAt: number;
  baseAt: number;
  endAt: number | null;
  endedAt: number | null;
  /** Le dernier élément s'arrête ici : sortie de l'écran du conducteur, ou fin du déroulé. */
  lastEnd: number | null;
  items: RunItem[];
  /** Éléments retirés du conducteur après leur passage. */
  removed: RunItem[];
  /** Éléments présents au début du déroulé (les autres ont été ajoutés en direct). */
  initialUids: string[];
  passages: Passage[];
}

/**
 * Bilan d'émission : heure prévue / réelle et durée prévue / réelle de chaque élément. La
 * durée réelle d'un élément va jusqu'au passage suivant (le dernier, jusqu'à `lastEnd`).
 */
export function runReport(run: RunForReport): RunReport {
  const starts = runPlannedStarts(run);
  const sorted = [...run.passages].sort((a, b) => a.at - b.at);
  const byUid = new Map(sorted.map((p, i) => [p.uid, i]));
  const initial = new Set(run.initialUids);
  const actual = (uid: string) => {
    const i = byUid.get(uid);
    if (i === undefined) return { at: null, seconds: null, source: null };
    const p = sorted[i]!;
    const end = sorted[i + 1]?.at ?? run.lastEnd;
    return {
      at: p.at,
      seconds: end === null ? null : Math.max(0, Math.round((end - p.at) / 1000)),
      source: p.source,
    };
  };
  const line = (item: RunItem, plannedAt: number | null, removed: boolean): ReportLine => {
    const a = actual(item.uid);
    return {
      uid: item.uid,
      title: item.title,
      typeId: item.typeId,
      artist: item.artist,
      plannedAt,
      actualAt: a.at,
      plannedSeconds: item.plannedSeconds,
      actualSeconds: a.seconds,
      source: a.source,
      added: !initial.has(item.uid),
      removed,
      cuttable: item.cuttable,
    };
  };
  const total = run.items.reduce((s, i) => s + i.plannedSeconds * 1000, 0);
  return {
    runId: run.id,
    rehearsal: run.rehearsal,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    plannedStart: run.baseAt,
    plannedEnd: run.baseAt + total,
    actualEnd: run.lastEnd,
    imposedEnd: run.endAt,
    lines: [
      ...run.items.map((item, i) => line(item, starts[i]!, false)),
      ...run.removed.filter((r) => byUid.has(r.uid)).map((item) => line(item, null, true)),
    ],
  };
}

/** Écart de durée d'un conducteur avec sa fin imposée (secondes ; positif : à caser). */
export function plannedBalance(startTime: string, endTime: string | null, total: number) {
  if (endTime === null) return null;
  return timeToSeconds(endTime) - timeToSeconds(startTime) - total;
}

/** Durée totale de la partie « à couper » d'un conducteur (secondes). */
export function cuttableSeconds(items: (ItemTiming & { cuttable?: boolean })[]): number {
  return items.filter((i) => i.cuttable).reduce((s, i) => s + itemSeconds(i), 0);
}
