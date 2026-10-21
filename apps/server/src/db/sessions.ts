import type { Db } from './database.js';

export interface SessionRow {
  id_hash: string;
  user_id: number;
  expires_at: number;
  last_seen_at: number;
}

export class SessionRepo {
  constructor(private readonly db: Db) {}

  create(idHash: string, userId: number, expiresAt: number): void {
    this.db
      .prepare(
        'INSERT INTO sessions (id_hash, user_id, expires_at, last_seen_at) VALUES (?, ?, ?, ?)',
      )
      .run(idHash, userId, expiresAt, Date.now());
  }

  find(idHash: string): SessionRow | undefined {
    return this.db.prepare('SELECT * FROM sessions WHERE id_hash = ?').get(idHash) as
      SessionRow | undefined;
  }

  touch(idHash: string, expiresAt: number): void {
    this.db
      .prepare('UPDATE sessions SET expires_at = ?, last_seen_at = ? WHERE id_hash = ?')
      .run(expiresAt, Date.now(), idHash);
  }

  delete(idHash: string): void {
    this.db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(idHash);
  }

  /** Supprime les sessions d'un compte, sauf éventuellement la session en cours. */
  deleteForUser(userId: number, exceptIdHash?: string): void {
    this.db
      .prepare('DELETE FROM sessions WHERE user_id = ? AND id_hash IS NOT ?')
      .run(userId, exceptIdHash ?? null);
  }

  deleteExpired(): number {
    return this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now()).changes;
  }
}
