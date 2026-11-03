import type { WeatherNow } from '@onair-desk/shared';
import type { Db } from './database.js';

/** Dernière météo obtenue, pour un lieu donné (fournisseur et coordonnées). */
export class WeatherCacheRepo {
  constructor(private readonly db: Db) {}

  /** Valeur conservée pour ce lieu ; undefined si aucune ou pour un autre lieu. */
  get(location: string): { now: WeatherNow; updatedAt: number } | undefined {
    const r = this.db
      .prepare('SELECT location, data, updated_at FROM weather_cache WHERE id = 1')
      .get() as { location: string; data: string; updated_at: number } | undefined;
    if (!r || r.location !== location) return undefined;
    try {
      return { now: JSON.parse(r.data) as WeatherNow, updatedAt: r.updated_at };
    } catch {
      return undefined;
    }
  }

  set(location: string, now: WeatherNow, updatedAt: number): void {
    this.db
      .prepare(
        `INSERT INTO weather_cache (id, location, data, updated_at) VALUES (1, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET location = excluded.location, data = excluded.data,
           updated_at = excluded.updated_at`,
      )
      .run(location, JSON.stringify(now), updatedAt);
  }
}
