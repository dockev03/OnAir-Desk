import {
  emptyRegieState,
  type DuplexLine,
  type RegieMessage,
  type RegieState,
} from '@onair-desk/shared';
import type { Db } from './database.js';

interface Row {
  message: string | null;
  duplex: string;
}

/**
 * Régie par studio : message affiché et lignes de duplex, conservés en base (un redémarrage du
 * serveur pendant l'émission ne les perd pas).
 */
export class RegieRepo {
  constructor(private readonly db: Db) {}

  get(studioId: number): RegieState {
    const r = this.db
      .prepare('SELECT message, duplex FROM studio_regie WHERE studio_id = ?')
      .get(studioId) as Row | undefined;
    if (!r) return emptyRegieState();
    try {
      return {
        message: r.message ? (JSON.parse(r.message) as RegieMessage) : null,
        duplex: JSON.parse(r.duplex) as DuplexLine[],
      };
    } catch {
      // Contenu illisible : la régie repart d'un état vide plutôt que de bloquer l'écran.
      return emptyRegieState();
    }
  }

  set(studioId: number, state: RegieState, now = Date.now()): void {
    this.db
      .prepare(
        `INSERT INTO studio_regie (studio_id, message, duplex, updated_at)
         VALUES (@studioId, @message, @duplex, @now)
         ON CONFLICT (studio_id) DO UPDATE SET message = excluded.message,
           duplex = excluded.duplex, updated_at = excluded.updated_at`,
      )
      .run({
        studioId,
        message: state.message ? JSON.stringify(state.message) : null,
        duplex: JSON.stringify(state.duplex),
        now,
      });
  }
}
