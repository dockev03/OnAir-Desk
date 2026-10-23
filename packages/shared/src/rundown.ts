import { z } from 'zod';

/**
 * Conducteurs : types d'éléments (paramétrables), validation des éléments et saisie des
 * durées (les calculs de temps sont dans timing.ts). Utilisé par le serveur et l'interface.
 */

/** Couleurs de fond autorisées pour un type d'élément, avec la couleur de texte associée. */
export const ITEM_COLORS = {
  '#2C2C2A': '#D3D1C7',
  '#3A3B3F': '#E4E4E7',
  '#085041': '#E1F5EE',
  '#0C447C': '#E6F1FB',
  '#3C3489': '#EEEDFE',
  '#633806': '#FAEEDA',
  '#712B13': '#FAECE7',
  '#6B1A2E': '#FBE7EC',
  '#3B4A12': '#EEF5DC',
} as const;
export type ItemColor = keyof typeof ITEM_COLORS;
const ITEM_COLOR_LIST = Object.keys(ITEM_COLORS) as [ItemColor, ...ItemColor[]];

export const MAX_ITEM_TYPES = 20;
export const MAX_RUNDOWN_ITEMS = 200;
/** Durée maximale d'un élément : 4 heures. */
export const MAX_ITEM_SECONDS = 4 * 3600;
export const MAX_ITEM_NOTES = 500;

const typeIdSchema = z.string().regex(/^[a-z0-9-]{1,32}$/);

export const itemTypeSchema = z
  .object({
    id: typeIdSchema,
    label: z.string().trim().min(1).max(40),
    color: z.enum(ITEM_COLOR_LIST),
  })
  .strict();
export type ItemType = z.infer<typeof itemTypeSchema>;

export const itemTypesSchema = z
  .array(itemTypeSchema)
  .min(1)
  .max(MAX_ITEM_TYPES)
  .refine((types) => new Set(types.map((t) => t.id)).size === types.length, 'duplicate_type');

export const DEFAULT_ITEM_TYPES: ItemType[] = [
  { id: 'jingle', label: 'Jingle', color: '#2C2C2A' },
  { id: 'chronique', label: 'Chronique', color: '#085041' },
  { id: 'titre', label: 'Titre', color: '#0C447C' },
  { id: 'meteo', label: 'Météo', color: '#3C3489' },
  { id: 'pub', label: 'Pub', color: '#633806' },
  { id: 'interview', label: 'Interview', color: '#712B13' },
  { id: 'flash', label: 'Flash infos', color: '#6B1A2E' },
  { id: 'autre', label: 'Autre', color: '#3A3B3F' },
];

/** Couleurs d'affichage d'un type ; type inconnu (retiré des paramètres) : gris neutre. */
export function itemColors(types: ItemType[], typeId: string): { bg: string; fg: string } {
  const bg = types.find((t) => t.id === typeId)?.color ?? '#3A3B3F';
  return { bg, fg: ITEM_COLORS[bg] };
}

// ---- Validation ------------------------------------------------------------------

/** Identifiant stable d'un élément, généré par le client (survit aux réordonnancements). */
export const itemUidSchema = z.string().regex(/^[a-z0-9-]{1,36}$/);

export const rundownItemInputSchema = z
  .object({
    uid: itemUidSchema,
    typeId: typeIdSchema,
    title: z.string().trim().min(1).max(120),
    /** Durée saisie à la main ; null : calculée depuis le script attaché. */
    durationSeconds: z.number().int().min(0).max(MAX_ITEM_SECONDS).nullable(),
    notes: z.string().max(MAX_ITEM_NOTES),
    scriptId: z.number().int().positive().nullable(),
  })
  .strict();
export type RundownItemInput = z.infer<typeof rundownItemInputSchema>;

export const rundownItemsSchema = z
  .array(rundownItemInputSchema)
  .max(MAX_RUNDOWN_ITEMS)
  .refine((items) => new Set(items.map((i) => i.uid)).size === items.length, 'duplicate_item');

export const airDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((d) => {
    const date = new Date(`${d}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === d;
  }, 'date');

/** Heure de début : HH:MM ou HH:MM:SS, ramenée à HH:MM:SS. */
export const startTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/)
  .transform((t) => (t.length === 5 ? `${t}:00` : t));

// ---- Durées ----------------------------------------------------------------------

/** Informations du script attaché utiles au calcul (sans son contenu). */
export interface ItemScriptInfo {
  title: string;
  wordCount: number;
  speedWpm: number;
  cueSeconds: number;
  /** Script mis à la corbeille. */
  deleted: boolean;
}

export interface ItemTiming {
  durationSeconds: number | null;
  script?: ItemScriptInfo | null;
}

/**
 * Lecture d'une durée d'élément saisie : « 45 » (secondes), « 2:30 » ou « 1:05:00 ».
 * Vide → null (durée du script) ; invalide ou au-delà de 4 h → undefined.
 */
export function parseItemDuration(input: string): number | null | undefined {
  const v = input.trim();
  if (v === '') return null;
  const m = /^(?:(\d{1,2}):([0-5]\d):([0-5]\d)|(\d{1,3}):([0-5]\d)|(\d{1,5}))$/.exec(v);
  if (!m) return undefined;
  const total =
    m[1] !== undefined
      ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
      : m[4] !== undefined
        ? Number(m[4]) * 60 + Number(m[5])
        : Number(m[6]);
  return total <= MAX_ITEM_SECONDS ? total : undefined;
}
