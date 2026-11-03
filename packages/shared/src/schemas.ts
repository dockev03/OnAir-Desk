import { z } from 'zod';
import {
  AUTOMATION_SOURCES,
  CONNECTED_SOURCES,
  SIMULATOR_SPEED_MAX,
  type ConnectedSource,
} from './air.js';
import { cuesSchema, scriptDocSchema } from './content.js';
import { layoutSchema } from './layout.js';
import { regieSettingsSchema } from './regie.js';
import { endAfterStart, endTimeSchema, fixedTimesSchema, timeTrackingSchema } from './tracking.js';
import {
  airDateSchema,
  itemTagsSchema,
  itemTypesSchema,
  rundownNotesSchema,
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

/** Seuils de l'alerte de fin de titre (secondes) : « maintenant » plus court que « bientôt ». */
export const TRACK_ALERT_MAX_SECONDS = 120;
export const trackAlertSchema = z
  .object({
    soonSeconds: z.number().int().min(1).max(TRACK_ALERT_MAX_SECONDS),
    nowSeconds: z.number().int().min(1).max(TRACK_ALERT_MAX_SECONDS),
  })
  .strict()
  .refine((t) => t.nowSeconds < t.soonSeconds, 'track_alert_order');

/**
 * Accès à la base RadioDJ (lecture seule). Le mot de passe n'est jamais stocké ici : il vient
 * de la variable d'environnement RADIODJ_DB_PASSWORD.
 */
export const radiodjSettingsSchema = z
  .object({
    /** Nom DNS ou adresse IP du poste MariaDB ; vide : non configuré. */
    host: z
      .string()
      .trim()
      .max(253)
      .regex(/^$|^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$|^\[?[0-9A-Fa-f:.]+\]?$/, 'host'),
    port: z.number().int().min(1).max(65535),
    database: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_$]{1,64}$/, 'database'),
    user: z.string().trim().min(1).max(80),
  })
  .strict();

/** Retard du flux AzuraCast (secondes) : décalage appliqué à l'heure de début des titres. */
export const STREAM_DELAY_MAX_SECONDS = 30;

/**
 * Accès à AzuraCast (titre en cours / à venir, indicateur « en direct »). La clé API, si la
 * station en exige une, n'est jamais stockée ici : elle vient de AZURACAST_API_KEY.
 */
export const azuracastSettingsSchema = z
  .object({
    /** Adresse d'AzuraCast, en https:// uniquement ; vide : non configuré. */
    url: z
      .string()
      .trim()
      .max(200)
      .refine((v) => {
        if (v === '') return true;
        try {
          const u = new URL(v);
          return u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash;
        } catch {
          return false;
        }
      }, 'azuracast_url'),
    /** Nom court de la station (shortcode), ou son numéro. */
    station: z
      .string()
      .trim()
      .regex(/^$|^[A-Za-z0-9_-]{1,64}$/, 'azuracast_station'),
    streamDelaySeconds: z
      .number()
      .int()
      .min(-STREAM_DELAY_MAX_SECONDS)
      .max(STREAM_DELAY_MAX_SECONDS),
  })
  .strict();

/** Bascule forcée : automatique, direct, hors direct. */
export const AIR_FORCES = ['auto', 'live', 'offair'] as const;
export type AirForce = (typeof AIR_FORCES)[number];

/**
 * Mode d'antenne « direct / hors direct » : deux sources, l'une pour le direct, l'autre le
 * reste du temps. Désactivé : seule `automationSource` compte.
 */
export const airSwitchSchema = z
  .object({
    enabled: z.boolean(),
    liveSource: z.enum(CONNECTED_SOURCES),
    offAirSource: z.enum(CONNECTED_SOURCES),
    force: z.enum(AIR_FORCES),
  })
  .strict()
  .refine((s) => s.liveSource !== s.offAirSource, 'air_switch_same');

// ---- On Air, météo, liners (étape 9) ---------------------------------------------

/** Demande de passage On Air : allumer, éteindre, ou inverser (bouton unique). */
export const ON_AIR_REQUESTS = ['on', 'off', 'toggle'] as const;
export type OnAirRequest = (typeof ON_AIR_REQUESTS)[number];
export const onAirRequestSchema = z.object({ state: z.enum(ON_AIR_REQUESTS) }).strict();

export const WEATHER_PROVIDERS = ['none', 'openmeteo'] as const;
export type WeatherProvider = (typeof WEATHER_PROVIDERS)[number];

/** Météo : fournisseur, ville affichée et coordonnées (rien de propre à une station). */
export const weatherSettingsSchema = z
  .object({
    provider: z.enum(WEATHER_PROVIDERS),
    city: z.string().trim().max(80),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  })
  .strict()
  .refine((w) => w.provider === 'none' || w.city.length > 0, 'weather_city');

export const MAX_LINERS = 30;
export const LINER_MAX_LENGTH = 200;
export const LINER_ROTATION_MIN = 10;
export const LINER_ROTATION_MAX = 120;

/** Carte de liner : phrase d'identification à dire (nom, fréquence, standard, slogan…). */
export const linerSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{1,36}$/),
    text: z.string().trim().min(1).max(LINER_MAX_LENGTH),
    active: z.boolean(),
  })
  .strict();

export const linersSettingsSchema = z
  .object({
    items: z
      .array(linerSchema)
      .max(MAX_LINERS)
      .refine((l) => new Set(l.map((x) => x.id)).size === l.length, 'duplicate_liner'),
    /** Durée d'affichage de chaque carte sur l'écran studio (secondes). */
    rotationSeconds: z.number().int().min(LINER_ROTATION_MIN).max(LINER_ROTATION_MAX),
  })
  .strict();

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
  /** Étiquettes posées sur les éléments de conducteur (FR, Pépite…). */
  itemTags: itemTagsSchema,
  /** Source d'automation du studio (titre en cours / à venir). */
  automationSource: z.enum(AUTOMATION_SOURCES),
  /** Simulateur : accélération des durées (1 = temps réel), pour les démonstrations. */
  simulatorSpeed: z.number().int().min(1).max(SIMULATOR_SPEED_MAX),
  /** RadioDJ : accès à sa base (titre en cours, à venir, repères). */
  radiodj: radiodjSettingsSchema,
  /** Seuils de l'alerte de fin de titre sur l'écran studio. */
  trackAlert: trackAlertSchema,
  /** AzuraCast : adresse, station, retard du flux. */
  azuracast: azuracastSettingsSchema,
  /** Bascule direct / hors direct entre deux sources. */
  airSwitch: airSwitchSchema,
  /** Disposition de l'écran studio hors émission et pour les conducteurs sans choix. */
  defaultLayout: layoutSchema,
  /** Protection contre l'usure de l'écran (léger décalage périodique des éléments fixes). */
  burnInProtection: z.boolean(),
  /** Bouton On Air (appui long) sur l'écran studio. */
  onAirKiosk: z.boolean(),
  /** Appel simple de l'API On Air (jeton dans l'adresse), pour les déclencheurs limités. */
  onAirSimpleCall: z.boolean(),
  /** Météo affichée sur l'écran studio. */
  weather: weatherSettingsSchema,
  /** Cartes de liners. */
  liners: linersSettingsSchema,
  /** Régie : durée de vie des messages, accusé « Vu », ordres rapides. */
  regie: regieSettingsSchema,
  /** Horaires fixes (flash infos, top horaire…) : compte à rebours sur l'écran studio. */
  fixedTimes: fixedTimesSchema,
  /** Suivi du temps : seuils d'alerte, répétition depuis l'écran studio. */
  timeTracking: timeTrackingSchema,
  /**
   * Empreinte du logo de la station (null : aucun logo). Lecture seule : calculée par le
   * serveur, modifiée par l'envoi du logo, sert à recharger l'image quand elle change.
   */
  logoHash: z
    .string()
    .regex(/^[a-f0-9]{16}$/)
    .nullable(),
});

/**
 * Sources d'automation en service : les deux sources de la bascule si elle est active, sinon la
 * source unique (aucune si « aucune »).
 */
export function sourcesInUse(
  settings: Pick<Settings, 'automationSource' | 'airSwitch'>,
): ConnectedSource[] {
  if (settings.airSwitch.enabled) {
    return [settings.airSwitch.liveSource, settings.airSwitch.offAirSource];
  }
  return settings.automationSource === 'none' ? [] : [settings.automationSource];
}

/** Modification des paramètres : seuls les champs fournis changent. */
export const settingsUpdateSchema = settingsSchema
  .omit({ logoHash: true })
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

/** Logo de la station : PNG, JPEG ou WebP (type vérifié sur le contenu), 3 Mo au plus. */
export const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const MAX_LOGO_BYTES = 3 * 1024 * 1024;
export const logoUploadSchema = z
  .object({
    /** Contenu du fichier, encodé en base64. */
    data: z
      .string()
      .min(4)
      .max(Math.ceil(MAX_LOGO_BYTES / 3) * 4)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/),
  })
  .strict();

export const loginSchema = z.object({
  username: z.string().trim().toLowerCase().min(1).max(64),
  password: z.string().min(1).max(256),
});

export const createUserSchema = z.object({
  username: usernameSchema,
  displayName: displayNameSchema,
  role: roleSchema,
  /** Droit « Réalisateur » (régie), cumulable avec le rôle. */
  isDirector: z.boolean().optional(),
  locale: localeSchema.optional(),
  password: passwordSchema,
});

export const updateUserSchema = z
  .object({
    displayName: displayNameSchema,
    role: roleSchema,
    isDirector: z.boolean(),
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

export const createRundownSchema = z
  .object({
    ownerId: ownerIdSchema,
    title: rundownTitleSchema,
    airDate: airDateSchema,
    startTime: startTimeSchema,
    /** Heure de fin imposée (backtiming) ; null : aucune. */
    endTime: endTimeSchema.default(null),
    notes: rundownNotesSchema.default(''),
    /** Disposition de l'écran studio ; null : celle des paramètres. */
    layout: layoutSchema.nullable().optional(),
    items: rundownItemsSchema.optional(),
  })
  .refine((v) => endAfterStart(v.startTime, v.endTime), {
    message: 'end_before_start',
    path: ['endTime'],
  });

export const updateRundownSchema = z
  .object({
    /** Version connue du client : refus (409) si le conducteur a changé entre-temps. */
    version: z.number().int().positive(),
    title: rundownTitleSchema.optional(),
    airDate: airDateSchema.optional(),
    startTime: startTimeSchema.optional(),
    endTime: endTimeSchema.optional(),
    notes: rundownNotesSchema.optional(),
    layout: layoutSchema.nullable().optional(),
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
export type RadiodjSettings = z.infer<typeof radiodjSettingsSchema>;
export type TrackAlertSettings = z.infer<typeof trackAlertSchema>;
export type AzuracastSettings = z.infer<typeof azuracastSettingsSchema>;
export type AirSwitchSettings = z.infer<typeof airSwitchSchema>;
export type WeatherSettings = z.infer<typeof weatherSettingsSchema>;
export type Liner = z.infer<typeof linerSchema>;
export type LinersSettings = z.infer<typeof linersSettingsSchema>;
export type SetupInput = z.infer<typeof setupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type SettingsUpdate = z.infer<typeof settingsUpdateSchema>;
export type CreateScriptInput = z.infer<typeof createScriptSchema>;
export type UpdateScriptInput = z.infer<typeof updateScriptSchema>;
export type CreateRundownInput = z.output<typeof createRundownSchema>;
export type UpdateRundownInput = z.infer<typeof updateRundownSchema>;
export type PrompterSendInput = z.infer<typeof prompterSendSchema>;
