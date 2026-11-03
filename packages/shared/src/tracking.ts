import { z } from 'zod';
import type { AuditEntry } from './audit.js';

/**
 * Suivi du temps (voir docs/plan-etape-11.md) : horaires fixes, seuils, heure de fin imposée,
 * déroulés (heures réelles de passage) et répétitions. Schémas et types communs au serveur et
 * aux écrans ; les calculs purs sont dans timing.ts.
 */

export const MAX_FIXED_TIMES = 20;
export const FIXED_TIME_LABEL_MAX = 40;
export const FIXED_WARN_MIN_MINUTES = 1;
export const FIXED_WARN_MAX_MINUTES = 30;
/** « Flash infos maintenant » reste affiché 10 secondes après l'heure. */
export const FIXED_NOW_SHOWN_MS = 10_000;
/** Un déroulé d'antenne se clôt seul 30 minutes après la fin de l'émission. */
export const RUN_CLOSE_AFTER_MS = 30 * 60_000;
/** Une répétition s'arrête seule au bout de 4 heures. */
export const REHEARSAL_MAX_MS = 4 * 60 * 60_000;
/** Répétitions conservées par conducteur. */
export const REHEARSALS_KEPT = 5;

const fixedIdSchema = z.string().regex(/^[a-z0-9-]{1,36}$/);

const uniqueInts = (min: number, max: number) =>
  z
    .array(z.number().int().min(min).max(max))
    .min(1)
    .max(max - min + 1)
    .refine((l) => new Set(l).size === l.length, 'duplicate');

/** Horaire fixe de la station : « Flash infos » à 7 h, 8 h, 12 h et 18 h, minute 0… */
export const fixedTimeSchema = z
  .object({
    id: fixedIdSchema,
    label: z
      .string()
      .trim()
      .min(1)
      .max(FIXED_TIME_LABEL_MAX)
      // eslint-disable-next-line no-control-regex
      .refine((v) => !/[\u0000-\u001f\u007f]/.test(v), 'control_char'),
    minute: z.number().int().min(0).max(59),
    /** Heures concernées (0 à 23), dans le fuseau de la station. */
    hours: uniqueInts(0, 23),
    /** Jours de la semaine, 1 = lundi … 7 = dimanche. */
    days: uniqueInts(1, 7),
    /** Prévenance : le compte à rebours apparaît ce nombre de minutes avant l'heure. */
    warnMinutes: z.number().int().min(FIXED_WARN_MIN_MINUTES).max(FIXED_WARN_MAX_MINUTES),
    active: z.boolean(),
  })
  .strict();
export type FixedTime = z.infer<typeof fixedTimeSchema>;

export const fixedTimesSchema = z
  .array(fixedTimeSchema)
  .max(MAX_FIXED_TIMES)
  .refine((l) => new Set(l.map((f) => f.id)).size === l.length, 'duplicate_fixed_time');

export const ALL_HOURS = Array.from({ length: 24 }, (_, h) => h);
export const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];

/** Seuils du suivi du temps (code couleur unique : orange = bientôt, rouge = maintenant). */
export const timeTrackingSchema = z
  .object({
    /** Retard affiché en orange à partir de… (secondes). */
    driftSoonSeconds: z.number().int().min(5).max(600),
    /** Retard affiché en rouge à partir de… (secondes). */
    driftNowSeconds: z.number().int().min(10).max(1800),
    /** Écart en dessous duquel on affiche « À l'heure » (secondes). */
    onTimeSeconds: z.number().int().min(0).max(60),
    /** Fin de séquence : orange dans les N dernières secondes. */
    sequenceSoonSeconds: z.number().int().min(1).max(120),
    /** Fin imposée : orange / rouge à N minutes de la fin. */
    endSoonMinutes: z.number().int().min(1).max(60),
    endNowMinutes: z.number().int().min(1).max(30),
    /** Répétition lancée / arrêtée depuis l'écran studio. */
    kioskRehearsal: z.boolean(),
  })
  .strict()
  .refine((t) => t.driftNowSeconds > t.driftSoonSeconds, 'drift_order')
  .refine((t) => t.endNowMinutes < t.endSoonMinutes, 'end_alert_order');
export type TimeTrackingSettings = z.infer<typeof timeTrackingSchema>;

export const DEFAULT_TIME_TRACKING: TimeTrackingSettings = {
  driftSoonSeconds: 30,
  driftNowSeconds: 120,
  onTimeSeconds: 5,
  sequenceSoonSeconds: 15,
  endSoonMinutes: 5,
  endNowMinutes: 1,
  kioskRehearsal: true,
};

/** Horaires proposés à l'installation : inactifs tant que la station ne les a pas relus. */
export const DEFAULT_FIXED_TIMES: FixedTime[] = [
  {
    id: 'top',
    label: 'Top horaire',
    minute: 0,
    hours: ALL_HOURS,
    days: ALL_DAYS,
    warnMinutes: 5,
    active: false,
  },
  {
    id: 'flash',
    label: 'Flash infos',
    minute: 0,
    hours: [7, 8, 12, 18],
    days: ALL_DAYS,
    warnMinutes: 5,
    active: false,
  },
];

// ---- Heure de fin imposée ---------------------------------------------------------

/** Heure de fin imposée : HH:MM ou HH:MM:SS, ramenée à HH:MM:SS ; null : aucune. */
export const endTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/)
  .transform((t) => (t.length === 5 ? `${t}:00` : t))
  .nullable();

/** Fin imposée valable : après l'heure de début, le même jour. */
export function endAfterStart(startTime: string, endTime: string | null): boolean {
  // Même format HH:MM:SS des deux côtés : l'ordre alphabétique est l'ordre des heures.
  return endTime === null || endTime > startTime;
}

// ---- Déroulés -----------------------------------------------------------------------

/** Origine du pointage d'un élément. */
export const PASSAGE_SOURCES = ['screen', 'automation'] as const;
export type PassageSource = (typeof PASSAGE_SOURCES)[number];

/** Élément tel que figé dans un déroulé (sans le texte). */
export interface RunItem {
  uid: string;
  title: string;
  typeId: string;
  artist: string;
  /** Durée prévue (secondes). */
  plannedSeconds: number;
  cuttable: boolean;
}

/** Heure réelle de début d'un élément (horloge serveur, ms). */
export interface Passage {
  uid: string;
  at: number;
  source: PassageSource;
}

/**
 * Déroulé en cours, dans l'état antenne : de quoi calculer, sur l'écran, le minuteur de
 * séquence, l'avance / retard et le backtiming.
 */
export interface RunState {
  id: number;
  rundownId: number;
  title: string;
  rehearsal: boolean;
  /** Début du déroulé (horloge serveur, ms). */
  startedAt: number;
  /** Heure de référence : début prévu de l'émission, ou lancement de la répétition. */
  baseAt: number;
  /** Fin imposée (horloge serveur, ms), décalée comme l'heure de référence ; null : aucune. */
  endAt: number | null;
  /** Éléments du conducteur actuel. */
  items: RunItem[];
  /** Éléments pointés, dans l'ordre de leur heure réelle (un seul passage par élément). */
  passages: Passage[];
}

/** Ligne du bilan d'émission. */
export interface ReportLine {
  uid: string;
  title: string;
  typeId: string;
  artist: string;
  /** Heures prévue et réelle (horloge serveur, ms) ; réelle null : non pointé. */
  plannedAt: number | null;
  actualAt: number | null;
  /** Durées prévue et réelle (secondes). */
  plannedSeconds: number;
  actualSeconds: number | null;
  source: PassageSource | null;
  /** Ajouté pendant l'émission, ou retiré du conducteur après son passage. */
  added: boolean;
  removed: boolean;
  cuttable: boolean;
}

export interface RunReport {
  runId: number;
  rehearsal: boolean;
  startedAt: number;
  endedAt: number | null;
  /** Début prévu et fins prévue / réelle / imposée (horloge serveur, ms). */
  plannedStart: number;
  plannedEnd: number;
  actualEnd: number | null;
  imposedEnd: number | null;
  lines: ReportLine[];
}

/** Répétition terminée : durées mesurées (secondes). */
export interface RehearsalSummary {
  runId: number;
  startedAt: number;
  endedAt: number | null;
  totalSeconds: number;
  items: { uid: string; title: string; plannedSeconds: number; measuredSeconds: number | null }[];
}

/** Bilan d'un conducteur : déroulé d'antenne (s'il existe) et main courante. */
export interface RundownReportView {
  rundown: {
    id: number;
    title: string;
    airDate: string;
    startTime: string;
    endTime: string | null;
  };
  report: RunReport | null;
  /** Déroulé encore en cours (bilan pas encore figé). */
  active: boolean;
  canClose: boolean;
  /** Main courante de l'émission (étape 10), jointe au bilan. */
  logbook: AuditEntry[];
}

export const rehearsalStartSchema = z.object({ rundownId: z.number().int().positive() }).strict();
