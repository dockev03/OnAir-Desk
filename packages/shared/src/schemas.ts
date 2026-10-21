import { z } from 'zod';

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

export const settingsSchema = z.object({
  stationName: z.string().trim().min(1).max(80),
  locale: localeSchema,
  timezone: timezoneSchema,
  timeFormat: timeFormatSchema,
});

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

export type Locale = z.infer<typeof localeSchema>;
export type Role = z.infer<typeof roleSchema>;
export type TimeFormat = z.infer<typeof timeFormatSchema>;
export type Settings = z.infer<typeof settingsSchema>;
export type SetupInput = z.infer<typeof setupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
