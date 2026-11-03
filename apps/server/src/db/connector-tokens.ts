import type { Db } from './database.js';
import { nowIso } from '../lib/time.js';

/** Connecteurs entrants authentifiés par un jeton : plugin RadioDJ, déclencheur On Air. */
export type IncomingConnector = 'radiodj' | 'onair';

/**
 * Jetons des connecteurs entrants : un par connecteur, stocké haché, remplacé à chaque
 * régénération (l'ancien cesse aussitôt de fonctionner).
 */
export class ConnectorTokenRepo {
  constructor(private readonly db: Db) {}

  /** Date de création du jeton ; undefined s'il n'y en a pas. */
  createdAt(connector: IncomingConnector): string | undefined {
    const r = this.db
      .prepare('SELECT created_at FROM connector_tokens WHERE connector = ?')
      .get(connector) as { created_at: string } | undefined;
    return r?.created_at;
  }

  set(connector: IncomingConnector, tokenHash: string): void {
    this.db
      .prepare(
        `INSERT INTO connector_tokens (connector, token_hash, created_at) VALUES (?, ?, ?)
         ON CONFLICT (connector) DO UPDATE SET token_hash = excluded.token_hash,
                                               created_at = excluded.created_at`,
      )
      .run(connector, tokenHash, nowIso());
  }

  /** Vrai si le haché correspond au jeton du connecteur. */
  matches(connector: IncomingConnector, tokenHash: string): boolean {
    return (
      this.db
        .prepare('SELECT 1 FROM connector_tokens WHERE connector = ? AND token_hash = ?')
        .get(connector, tokenHash) !== undefined
    );
  }
}
