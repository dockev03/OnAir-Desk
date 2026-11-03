import type { Locale, PublicUser, Role } from '@onair-desk/shared';
import type { Db } from './database.js';
import { nowIso } from '../lib/time.js';

interface UserRow {
  id: number;
  username: string;
  display_name: string;
  password_hash: string;
  role: Role;
  is_director: 0 | 1;
  locale: Locale;
  is_active: 0 | 1;
  created_at: string;
}

export interface User extends PublicUser {
  passwordHash: string;
}

const toUser = (r: UserRow): User => ({
  id: r.id,
  username: r.username,
  displayName: r.display_name,
  passwordHash: r.password_hash,
  role: r.role,
  isDirector: r.is_director === 1,
  locale: r.locale,
  isActive: r.is_active === 1,
  createdAt: r.created_at,
});

export const toPublicUser = ({ passwordHash: _, ...u }: User): PublicUser => u;

export class UserRepo {
  constructor(private readonly db: Db) {}

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  }

  countActiveAdmins(): number {
    const sql = "SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND is_active = 1";
    return (this.db.prepare(sql).get() as { n: number }).n;
  }

  list(): User[] {
    return (this.db.prepare('SELECT * FROM users ORDER BY display_name').all() as UserRow[]).map(
      toUser,
    );
  }

  findById(id: number): User | undefined {
    const r = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
    return r && toUser(r);
  }

  findByUsername(username: string): User | undefined {
    const r = this.db.prepare('SELECT * FROM users WHERE username = ?').get(username) as
      UserRow | undefined;
    return r && toUser(r);
  }

  create(u: {
    username: string;
    displayName: string;
    passwordHash: string;
    role: Role;
    isDirector?: boolean;
    locale: Locale;
  }): User {
    const info = this.db
      .prepare(
        `INSERT INTO users (username, display_name, password_hash, role, is_director, locale)
         VALUES (@username, @displayName, @passwordHash, @role, @isDirector, @locale)`,
      )
      .run({ ...u, isDirector: u.isDirector ? 1 : 0 });
    return this.findById(Number(info.lastInsertRowid))!;
  }

  update(
    id: number,
    patch: Partial<{
      displayName: string;
      passwordHash: string;
      role: Role;
      isDirector: boolean;
      locale: Locale;
      isActive: boolean;
    }>,
  ): User | undefined {
    const columns: Record<string, string> = {
      displayName: 'display_name',
      passwordHash: 'password_hash',
      role: 'role',
      isDirector: 'is_director',
      locale: 'locale',
      isActive: 'is_active',
    };
    const sets: string[] = [];
    const values: Record<string, unknown> = { id, updatedAt: nowIso() };
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || !columns[key]) continue;
      sets.push(`${columns[key]} = @${key}`);
      values[key] = typeof value === 'boolean' ? Number(value) : value;
    }
    if (sets.length > 0) {
      this.db
        .prepare(`UPDATE users SET ${sets.join(', ')}, updated_at = @updatedAt WHERE id = @id`)
        .run(values);
    }
    return this.findById(id);
  }

  /** Vrai si le compte possède dossiers, scripts, conducteurs ou modèles (corbeille comprise). */
  hasContent(id: number): boolean {
    const row = this.db
      .prepare(
        `SELECT EXISTS (SELECT 1 FROM scripts WHERE owner_id = @id)
             OR EXISTS (SELECT 1 FROM folders WHERE owner_id = @id)
             OR EXISTS (SELECT 1 FROM rundowns WHERE owner_id = @id)
             OR EXISTS (SELECT 1 FROM rundown_templates WHERE owner_id = @id) AS n`,
      )
      .get({ id }) as { n: number };
    return row.n === 1;
  }

  delete(id: number): void {
    this.db.prepare('DELETE FROM users WHERE id = ?').run(id);
  }
}
