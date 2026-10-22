import { z } from 'zod';
import { cuesSchema, scriptDocSchema } from './content.js';
import {
  airDateSchema,
  itemTypesSchema,
  itemUidSchema,
  rundownItemsSchema,
  startTimeSchema,
} from './rundown.js';

export const LOCALES = ['fr', 'en'] as const;
export const ROLES = ['admin', 'animateur'] as const;
export const TIME_FORMATS = ['24h', '12h'] as const;

export const PASSWORD_MIN_LENGTH = 12;

/** Vrai si le fuseau horaire IANA est connu du moteur JavaScript. */
export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const localeSchema = z.enum(LOCALES);
export const roleSchema = z.enum(ROLES);
export const timeFormatSchema = z.enum(TIME_FORMATS);

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,32}$/, 'username');

export const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(256);
export const displayNameSchema = z.string().trim().min(1).max(64);
export const timezoneSchema = z.string().min(1).max(64).refine(isValidTimezone, 'timezone');

export const SPEED_WPM_MIN = 60;
export const SPEED_WPM_MAX = 400;
export const DEFAULT_SPEED_WPM = 150;
export const PROMPTER_FONT_MIN = 24;
export const PROMPTER_FONT_MAX = 120;

export const speedWpmSchema = z.number().int().min(SPEED_WPM_MIN).max(SPEED_WPM_MAX);

export const settingsSchema = z.object({
  stationName: z.string().trim().min(1).max(80),
  locale: localeSchema,
  timezone: timezoneSchema,
  timeFormat: timeFormatSchema,
  /** Vitesse de lecture proposée pour un nouveau script (mots/minute). */
  defaultSpeedWpm: speedWpmSchema,
  /** Taille du texte sur l'écran studio (px). */
  prompterFontSize: z.number().int().min(PROMPTER_FONT_MIN).max(PROMPTER_FONT_MAX),
  /** Repères insérables dans les scripts. */
  cues: cuesSchema,
  /** Types d'éléments de conducteur et leurs couleurs. */
  itemTypes: itemTypesSchema,
});

/** Modification des paramètres : seuls les champs fournis changent. */
export const settingsUpdateSchema = settingsSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'empty');

export const setupSchema = z.object({
  code: z.string().trim().min(1).max(64),
  station: settingsSchema.pick({ stationName: true, locale: true, timezone: true }),
  admin: z.object({
    username: usernameSchema,
    displayName: displayNameSchema,
    password: passwordSchema,
  }),
});

export const loginSchema = z.object({
  username: z.string().trim().toLowerCase().min(1).max(64),
  password: z.string().min(1).max(256),
});

export const createUserSchema = z.object({
  username: usernameSchema,
  displayName: displayNameSchema,
  role: roleSchema,
  locale: localeSchema.optional(),
  password: passwordSchema,
});

export const updateUserSchema = z
  .object({
    displayName: displayNameSchema,
    role: roleSchema,
    locale: localeSchema,
    isActive: z.boolean(),
    password: passwordSchema,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'empty');

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: passwordSchema,
});

export const deviceNameSchema = z.object({ name: z.string().trim().min(1).max(64) });

export const pairDeviceSchema = z.object({ token: z.string().min(20).max(200) });

export const idParamSchema = z.object({ id: z.coerce.number().int().positive() });
export const revisionParamSchema = z.object({
  id: z.coerce.number().int().positive(),
  revisionId: z.coerce.number().int().positive(),
});

// ---- Bibliothèque : dossiers et scripts --------------------------------------

/** Propriétaire : un compte, ou null pour le dossier Commun. */
export const ownerIdSchema = z.number().int().positive().nullable();
const folderRefSchema = z.number().int().positive().nullable();

export const folderNameSchema = z.string().trim().min(1).max(80);
export const scriptTitleSchema = z.string().trim().min(1).max(120);

export const createFolderSchema = z.object({
  ownerId: ownerIdSchema,
  parentId: folderRefSchema.optional(),
  name: folderNameSchema,
});

export const updateFolderSchema = z
  .object({ name: folderNameSchema, parentId: folderRefSchema })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'empty');

export const createScriptSchema = z.object({
  ownerId: ownerIdSchema,
  folderId: folderRefSchema.optional(),
  title: scriptTitleSchema,
  content: scriptDocSchema.optional(),
  speedWpm: speedWpmSchema.optional(),
});

export const updateScriptSchema = z
  .object({
    /** Version connue du client : refus (409) si le script a changé entre-temps. */
    version: z.number().int().positive(),
    title: scriptTitleSchema.optional(),
    content: scriptDocSchema.optional(),
    speedWpm: speedWpmSchema.optional(),
    folderId: folderRefSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 1, 'empty');

export const duplicateScriptSchema = z.object({
  ownerId: ownerIdSchema,
  folderId: folderRefSchema.optional(),
  title: scriptTitleSchema.optional(),
});

export const searchQuerySchema = z.object({ q: z.string().trim().max(100).default('') });

export const restoreRevisionSchema = z.object({ version: z.number().int().positive() });

// ---- Conducteurs -----------------------------------------------------------------

export const rundownTitleSchema = z.string().trim().min(1).max(120);

export const createRundownSchema = z.object({
  ownerId: ownerIdSchema,
  title: rundownTitleSchema,
  airDate: airDateSchema,
  startTime: startTimeSchema,
  items: rundownItemsSchema.optional(),
});

export const updateRundownSchema = z
  .object({
    /** Version connue du client : refus (409) si le conducteur a changé entre-temps. */
    version: z.number().int().positive(),
    title: rundownTitleSchema.optional(),
    airDate: airDateSchema.optional(),
    startTime: startTimeSchema.optional(),
    items: rundownItemsSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 1, 'empty');

export const duplicateRundownSchema = z.object({
  ownerId: ownerIdSchema,
  airDate: airDateSchema,
  title: rundownTitleSchema.optional(),
});

/**
 * Choix de l'affichage de l'écran studio : un script seul, un élément de conducteur, ou
 * rien (scriptId null).
 */
export const prompterSendSchema = z.union([
  z.object({ scriptId: z.number().int().positive().nullable() }).strict(),
  z.object({ rundownId: z.number().int().positive(), itemUid: itemUidSchema }).strict(),
]);

export type Locale = z.infer<typeof localeSchema>;
export type Role = z.infer<typeof roleSchema>;
export type TimeFormat = z.infer<typeof timeFormatSchema>;
export type Settings = z.infer<typeof settingsSchema>;
export type SetupInput = z.infer<typeof setupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type SettingsUpdate = z.infer<typeof settingsUpdateSchema>;
export type CreateScriptInput = z.infer<typeof createScriptSchema>;
export type UpdateScriptInput = z.infer<typeof updateScriptSchema>;
export type CreateRundownInput = z.infer<typeof createRundownSchema>;
export type UpdateRundownInput = z.infer<typeof updateRundownSchema>;
export type PrompterSendInput = z.infer<typeof prompterSendSchema>;
