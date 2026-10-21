import type { Db } from './database.js';

export type Actor =
  | { type: 'user'; id: number }
  | { type: 'device'; id: number }
  | { type: 'system' }
  | { type: 'anonymous' };

/** Journal des actions sensibles. Ne jamais y écrire de mot de passe ni de jeton. */
export class AuditRepo {
  constructor(private readonly db: Db) {}

  write(actor: Actor, action: string, details?: Record<string, unknown>): void {
    this.db
      .prepare('INSERT INTO audit_log (actor_type, actor_id, action, details) VALUES (?, ?, ?, ?)')
      .run(
        actor.type,
        'id' in actor ? actor.id : null,
        action,
        details ? JSON.stringify(details) : null,
      );
  }
}
