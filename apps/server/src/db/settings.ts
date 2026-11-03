import {
  DEFAULT_CUES,
  DEFAULT_ITEM_TAGS,
  DEFAULT_ITEM_TYPES,
  DEFAULT_SPEED_WPM,
  settingsSchema,
  type Settings,
} from '@onair-desk/shared';
import type { Db } from './database.js';
import { LogoRepo } from './logo.js';

export function defaultSettings(): Settings {
  const tz = process.env.TZ;
  return {
    stationName: 'OnAir-Desk',
    locale: 'fr',
    timezone: tz && settingsSchema.shape.timezone.safeParse(tz).success ? tz : 'Europe/Paris',
    timeFormat: '24h',
    defaultSpeedWpm: DEFAULT_SPEED_WPM,
    prompterFontSize: 48,
    cues: DEFAULT_CUES,
    itemTypes: DEFAULT_ITEM_TYPES,
    itemTags: DEFAULT_ITEM_TAGS,
    automationSource: 'none',
    simulatorSpeed: 1,
    radiodj: { host: '', port: 3306, database: 'radiodj', user: 'onairdesk' },
    trackAlert: { soonSeconds: 30, nowSeconds: 10 },
    azuracast: { url: '', station: '', streamDelaySeconds: 0 },
    airSwitch: { enabled: false, liveSource: 'radiodj', offAirSource: 'azuracast', force: 'auto' },
    defaultLayout: 'solo',
    burnInProtection: true,
    onAirKiosk: true,
    onAirSimpleCall: false,
    weather: { provider: 'none', city: '', latitude: 0, longitude: 0 },
    // Exemples à adapter par la station : inactifs tant qu'ils ne sont pas relus.
    liners: {
      items: [
        { id: 'station', text: 'Vous écoutez [nom de la station]', active: false },
        { id: 'frequence', text: 'Sur [fréquence] FM et sur Internet', active: false },
        { id: 'standard', text: 'Le standard : [numéro de téléphone]', active: false },
        { id: 'slogan', text: '[slogan de la station]', active: false },
      ],
      rotationSeconds: 20,
    },
    // Ordres rapides proposés à l'installation : inactifs tant que la station ne les a pas relus.
    regie: {
      messageTtlMinutes: 5,
      kioskSeen: true,
      orders: [
        { id: 'accelere', label: 'Accélère', urgent: false, active: false },
        { id: 'etire', label: 'Étire', urgent: false, active: false },
        { id: 'conclus', label: 'Conclus', urgent: true, active: false },
        { id: 'invite', label: 'Invité en ligne', urgent: false, active: false },
        { id: 'pub', label: 'Pub dans 1 min', urgent: false, active: false },
        { id: 'rends', label: "Rends l'antenne", urgent: true, active: false },
      ],
    },
    logoHash: null,
  };
}

/** Paramètres de la station, stockés clé par clé (valeur JSON). */
export class SettingsRepo {
  constructor(private readonly db: Db) {}

  get(): Settings {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as {
      key: string;
      value: string;
    }[];
    const stored: Record<string, unknown> = {};
    for (const r of rows) {
      try {
        stored[r.key] = JSON.parse(r.value);
      } catch {
        // Valeur illisible : on retombe sur la valeur par défaut.
      }
    }
    // Chaque valeur est vérifiée séparément : une valeur illisible ne fait perdre qu'elle-même.
    const result: Record<string, unknown> = { ...defaultSettings() };
    for (const [key, value] of Object.entries(stored)) {
      const field = settingsSchema.shape[key as keyof Settings];
      if (key !== 'logoHash' && field?.safeParse(value).success) result[key] = value;
    }
    // L'empreinte du logo vient de l'image elle-même.
    result.logoHash = new LogoRepo(this.db).hash();
    return result as Settings;
  }

  set(values: Partial<Omit<Settings, 'logoHash'>>): Settings {
    const stmt = this.db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
    );
    this.db.transaction(() => {
      for (const [key, value] of Object.entries(values)) {
        if (value !== undefined) stmt.run(key, JSON.stringify(value));
      }
    })();
    return this.get();
  }
}
