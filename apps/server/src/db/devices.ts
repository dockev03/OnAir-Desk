import type { PublicDevice } from '@onair-desk/shared';
import type { Db } from './database.js';
import { nowIso } from '../lib/time.js';

interface DeviceRow {
  id: number;
  name: string;
  token_hash: string;
  created_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
}

const toDevice = (r: DeviceRow): PublicDevice => ({
  id: r.id,
  name: r.name,
  createdAt: r.created_at,
  lastSeenAt: r.last_seen_at,
  revokedAt: r.revoked_at,
});

export class DeviceRepo {
  constructor(private readonly db: Db) {}

  list(): PublicDevice[] {
    return (this.db.prepare('SELECT * FROM devices ORDER BY name').all() as DeviceRow[]).map(
      toDevice,
    );
  }

  findById(id: number): PublicDevice | undefined {
    const r = this.db.prepare('SELECT * FROM devices WHERE id = ?').get(id) as
      DeviceRow | undefined;
    return r && toDevice(r);
  }

  /** Appareil actif (non révoqué) correspondant au haché du jeton. */
  findActiveByTokenHash(tokenHash: string): PublicDevice | undefined {
    const r = this.db
      .prepare('SELECT * FROM devices WHERE token_hash = ? AND revoked_at IS NULL')
      .get(tokenHash) as DeviceRow | undefined;
    return r && toDevice(r);
  }

  create(name: string, tokenHash: string): PublicDevice {
    const info = this.db
      .prepare('INSERT INTO devices (name, token_hash) VALUES (?, ?)')
      .run(name, tokenHash);
    return this.findById(Number(info.lastInsertRowid))!;
  }

  /** Remplace le jeton (l'ancien devient inutilisable) et réactive l'appareil. */
  replaceToken(id: number, tokenHash: string): PublicDevice | undefined {
    this.db
      .prepare('UPDATE devices SET token_hash = ?, revoked_at = NULL WHERE id = ?')
      .run(tokenHash, id);
    return this.findById(id);
  }

  revoke(id: number): PublicDevice | undefined {
    this.db
      .prepare('UPDATE devices SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL')
      .run(nowIso(), id);
    return this.findById(id);
  }

  touch(id: number): void {
    this.db.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').run(nowIso(), id);
  }

  delete(id: number): void {
    this.db.prepare('DELETE FROM devices WHERE id = ?').run(id);
  }
}
