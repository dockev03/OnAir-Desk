import type { OnAirSource, OnAirState } from '@onair-desk/shared';
import type { Db } from './database.js';

interface OnAirRow {
  on_air: number;
  since: number | null;
  source: OnAirSource | null;
  last_duration_ms: number | null;
}

/** État du voyant ON AIR par studio, conservé en base (un redémarrage ne l'éteint pas). */
export class OnAirRepo {
  constructor(private readonly db: Db) {}

  get(studioId: number): OnAirState {
    const r = this.db
      .prepare(
        'SELECT on_air, since, source, last_duration_ms FROM onair_state WHERE studio_id = ?',
      )
      .get(studioId) as OnAirRow | undefined;
    if (!r) return { on: false, since: null, source: null, lastDurationMs: null };
    return {
      on: r.on_air === 1,
      since: r.since,
      source: r.source,
      lastDurationMs: r.last_duration_ms,
    };
  }

  set(studioId: number, state: OnAirState): void {
    this.db
      .prepare(
        `INSERT INTO onair_state (studio_id, on_air, since, source, last_duration_ms)
         VALUES (@studioId, @on, @since, @source, @last)
         ON CONFLICT (studio_id) DO UPDATE SET on_air = excluded.on_air, since = excluded.since,
           source = excluded.source, last_duration_ms = excluded.last_duration_ms`,
      )
      .run({
        studioId,
        on: state.on ? 1 : 0,
        since: state.since,
        source: state.source,
        last: state.lastDurationMs,
      });
  }
}
