import { DEFAULT_CUES, DEFAULT_SPEED_WPM, settingsSchema, type Settings } from '@onair-desk/shared';
import type { Db } from './database.js';

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
      if (field?.safeParse(value).success) result[key] = value;
    }
    return result as Settings;
  }

  set(values: Partial<Settings>): Settings {
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
