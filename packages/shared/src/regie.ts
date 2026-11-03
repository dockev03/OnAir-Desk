import { z } from 'zod';
import type { RundownItemInput } from './rundown.js';

/**
 * Régie (voir docs/plan-etape-10.md) : messages et ordres envoyés à l'écran studio, état des
 * duplex, modifications du conducteur en direct, main courante. Schémas et calculs purs,
 * communs au serveur et aux écrans.
 */

export const REGIE_MESSAGE_MAX = 200;
export const MAX_QUICK_ORDERS = 24;
export const QUICK_ORDER_LABEL_MAX = 40;
export const MAX_DUPLEX_LINES = 6;
export const DUPLEX_NAME_MAX = 40;
export const LOGBOOK_NOTE_MAX = 300;
/** Une note peut être datée jusqu'à 2 heures en arrière (« c'était à 14:05 »). */
export const LOGBOOK_BACKDATE_MAX_MS = 2 * 60 * 60_000;
export const MESSAGE_TTL_MIN_MINUTES = 1;
export const MESSAGE_TTL_MAX_MINUTES = 30;
/** Un message urgent occupe plus de place pendant 5 secondes. */
export const URGENT_EXPAND_MS = 5_000;
/** Les éléments modifiés en direct restent soulignés 10 secondes. */
export const LIVE_CHANGE_HIGHLIGHT_MS = 10_000;
/** Fenêtre de la main courante autour d'une émission. */
export const LOGBOOK_BEFORE_MS = 15 * 60_000;
export const LOGBOOK_AFTER_MS = 30 * 60_000;
/** Limites d'envoi par compte et par minute. */
export const REGIE_SEND_PER_MINUTE = 20;
export const LOGBOOK_NOTES_PER_MINUTE = 30;

/** Origine d'un message affiché : saisi, ordre rapide, carte de liner. */
export const REGIE_KINDS = ['message', 'order', 'liner'] as const;
export type RegieKind = (typeof REGIE_KINDS)[number];

/** États d'une ligne de duplex (aucun n'utilise l'orange ou le rouge des alertes). */
export const DUPLEX_STATES = ['waiting', 'ready', 'onair', 'cut'] as const;
export type DuplexState = (typeof DUPLEX_STATES)[number];

const regieIdSchema = z.string().regex(/^[a-z0-9-]{1,36}$/);

/** Texte brut sur une ligne : ni balise interprétée, ni caractère de contrôle. */
const plainText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    // eslint-disable-next-line no-control-regex
    .refine((v) => !/[\u0000-\u001f\u007f]/.test(v), 'control_char');

export const regieMessageSchema = z
  .object({ text: plainText(REGIE_MESSAGE_MAX), urgent: z.boolean() })
  .strict();
export type RegieMessageInput = z.infer<typeof regieMessageSchema>;

export const quickOrderSchema = z
  .object({
    id: regieIdSchema,
    label: plainText(QUICK_ORDER_LABEL_MAX),
    urgent: z.boolean(),
    active: z.boolean(),
  })
  .strict();
export type QuickOrder = z.infer<typeof quickOrderSchema>;

export const regieSettingsSchema = z
  .object({
    /** Durée de vie d'un message sur l'écran studio (minutes). */
    messageTtlMinutes: z.number().int().min(MESSAGE_TTL_MIN_MINUTES).max(MESSAGE_TTL_MAX_MINUTES),
    /** L'écran studio peut marquer un message « vu ». */
    kioskSeen: z.boolean(),
    orders: z
      .array(quickOrderSchema)
      .max(MAX_QUICK_ORDERS)
      .refine((l) => new Set(l.map((o) => o.id)).size === l.length, 'duplicate_order'),
  })
  .strict();
export type RegieSettings = z.infer<typeof regieSettingsSchema>;

export const duplexCreateSchema = z.object({ name: plainText(DUPLEX_NAME_MAX) }).strict();
export const duplexUpdateSchema = z
  .object({ name: plainText(DUPLEX_NAME_MAX).optional(), state: z.enum(DUPLEX_STATES).optional() })
  .strict()
  .refine((v) => v.name !== undefined || v.state !== undefined, 'empty');
export const regieIdParamSchema = z.object({ id: regieIdSchema }).strict();
export const regieSeenSchema = z.object({ id: regieIdSchema }).strict();

export const logbookNoteSchema = z
  .object({
    text: plainText(LOGBOOK_NOTE_MAX),
    /** Heure corrigée (horloge serveur, ms) ; absente : maintenant. */
    at: z.number().int().positive().optional(),
  })
  .strict();
export type LogbookNoteInput = z.infer<typeof logbookNoteSchema>;

export const logbookQuerySchema = z
  .object({ rundownId: z.coerce.number().int().positive() })
  .strict();

/** Message affiché dans la zone régie de l'écran studio. */
export interface RegieMessage {
  id: string;
  kind: RegieKind;
  text: string;
  urgent: boolean;
  /** Horloge serveur (ms). */
  sentAt: number;
  byName: string | null;
  expiresAt: number;
  /** Marqué « vu » depuis l'écran studio (horloge serveur, ms). */
  seenAt: number | null;
}

export interface DuplexLine {
  id: string;
  name: string;
  state: DuplexState;
  changedAt: number;
}

export interface RegieState {
  message: RegieMessage | null;
  duplex: DuplexLine[];
}

export const emptyRegieState = (): RegieState => ({ message: null, duplex: [] });

/** Message encore à afficher (pas expiré). */
export function activeMessage(regie: RegieState | undefined, now: number): RegieMessage | null {
  const m = regie?.message;
  return m && now < m.expiresAt ? m : null;
}

/** Le message urgent est en phase « agrandie » (5 premières secondes). */
export function urgentExpanded(message: RegieMessage | null, now: number): boolean {
  return message !== null && message.urgent && now - message.sentAt < URGENT_EXPAND_MS;
}

/**
 * Zone régie affichée : toujours dans la disposition « régie » ; ailleurs, seulement quand il
 * y a quelque chose à montrer (message, duplex, modification récente du conducteur).
 */
export function regieZoneVisible(
  reserved: boolean,
  regie: RegieState | undefined,
  now: number,
  recentChange = false,
): boolean {
  return (
    reserved ||
    activeMessage(regie, now) !== null ||
    (regie?.duplex.length ?? 0) > 0 ||
    recentChange
  );
}

// ---- Conducteur modifié en direct ------------------------------------------------------

/** Ce qui a changé dans le conducteur suivi, pour le souligner sur l'écran studio. */
export interface LiveChange {
  rundownId: number;
  /** Horloge serveur (ms). */
  at: number;
  byName: string | null;
  added: string[];
  changed: string[];
  moved: string[];
  removed: number;
}

type ComparableItem = Pick<
  RundownItemInput,
  | 'uid'
  | 'typeId'
  | 'title'
  | 'durationSeconds'
  | 'notes'
  | 'scriptId'
  | 'artist'
  | 'year'
  | 'introSeconds'
  | 'tags'
  | 'cuttable'
>;

const signature = (i: ComparableItem) =>
  JSON.stringify([
    i.typeId,
    i.title,
    i.durationSeconds,
    i.notes,
    i.scriptId,
    i.artist,
    i.year,
    i.introSeconds,
    i.tags,
    i.cuttable,
  ]);

/** Indices (dans `seq`) d'une plus longue sous-suite croissante. */
function longestIncreasing(seq: number[]): Set<number> {
  const len = seq.map(() => 1);
  const prev = seq.map(() => -1);
  let best = -1;
  for (let i = 0; i < seq.length; i++) {
    for (let j = 0; j < i; j++) {
      if (seq[j]! < seq[i]! && len[j]! + 1 > len[i]!) {
        len[i] = len[j]! + 1;
        prev[i] = j;
      }
    }
    if (best === -1 || len[i]! > len[best]!) best = i;
  }
  const keep = new Set<number>();
  for (let i = best; i !== -1; i = prev[i]!) keep.add(i);
  return keep;
}

/**
 * Compare deux versions des éléments d'un conducteur : ajoutés, modifiés, déplacés (le moins
 * possible : ceux hors de la plus longue suite restée dans l'ordre), nombre de supprimés.
 * Null si rien n'a changé.
 */
export function diffRundownItems(
  before: readonly ComparableItem[],
  after: readonly ComparableItem[],
): Pick<LiveChange, 'added' | 'changed' | 'moved' | 'removed'> | null {
  const old = new Map(before.map((item, index) => [item.uid, { item, index }]));
  const kept = new Set(after.map((i) => i.uid));
  const added: string[] = [];
  const changed: string[] = [];
  const common: { uid: string; oldIndex: number }[] = [];
  for (const item of after) {
    const o = old.get(item.uid);
    if (!o) {
      added.push(item.uid);
      continue;
    }
    if (signature(o.item) !== signature(item)) changed.push(item.uid);
    common.push({ uid: item.uid, oldIndex: o.index });
  }
  const inOrder = longestIncreasing(common.map((c) => c.oldIndex));
  const moved = common.filter((_, i) => !inOrder.has(i)).map((c) => c.uid);
  const removed = before.filter((i) => !kept.has(i.uid)).length;
  if (added.length + changed.length + moved.length + removed === 0) return null;
  return { added, changed, moved, removed };
}

/** Modification encore à souligner sur l'écran studio (conducteur affiché, moins de 10 s). */
export function liveChangeActive(
  change: LiveChange | null | undefined,
  rundownId: number | null | undefined,
  now: number,
): boolean {
  return !!change && change.rundownId === rundownId && now - change.at < LIVE_CHANGE_HIGHLIGHT_MS;
}

/** Fenêtre de la main courante d'une émission : début − 15 min → fin calculée + 30 min. */
export function logbookWindow(window: { start: number; end: number }): {
  from: number;
  to: number;
} {
  return { from: window.start - LOGBOOK_BEFORE_MS, to: window.end + LOGBOOK_AFTER_MS };
}
