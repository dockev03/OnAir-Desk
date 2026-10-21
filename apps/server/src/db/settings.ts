import { settingsSchema, type Settings } from '@onair-desk/shared';
import type { Db } from './database.js';

export function defaultSettings(): Settings {
  const tz = process.env.TZ;
  return {
    stationName: 'OnAir-Desk',
    locale: 'fr',
    timezone: tz && settingsSchema.shape.timezone.safeParse(tz).success ? tz : 'Europe/Paris',
    timeFormat: '24h',
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
    const merged = { ...defaultSettings(), ...stored };
    const parsed = settingsSchema.safeParse(merged);
    return parsed.success ? parsed.data : defaultSettings();
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
