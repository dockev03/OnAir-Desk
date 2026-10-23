import { createHash } from 'node:crypto';
import type { Db } from './database.js';

export interface Logo {
  data: Buffer;
  mime: string;
  hash: string;
  updatedAt: string;
}

/** Logo de la station : une seule image, stockée dans la base (un seul fichier à sauvegarder). */
export class LogoRepo {
  constructor(private readonly db: Db) {}

  get(): Logo | undefined {
    const r = this.db
      .prepare('SELECT data, mime, hash, updated_at FROM station_logo WHERE id = 1')
      .get() as { data: Buffer; mime: string; hash: string; updated_at: string } | undefined;
    return r && { data: r.data, mime: r.mime, hash: r.hash, updatedAt: r.updated_at };
  }

  /** Empreinte du logo (pour le cache des navigateurs), sans lire l'image. */
  hash(): string | null {
    const r = this.db.prepare('SELECT hash FROM station_logo WHERE id = 1').get() as
      { hash: string } | undefined;
    return r?.hash ?? null;
  }

  set(data: Buffer, mime: string): string {
    const hash = createHash('sha256').update(data).digest('hex').slice(0, 16);
    this.db
      .prepare(
        `INSERT INTO station_logo (id, data, mime, hash) VALUES (1, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET data = excluded.data, mime = excluded.mime,
           hash = excluded.hash, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
      )
      .run(data, mime, hash);
    return hash;
  }

  clear(): void {
    this.db.prepare('DELETE FROM station_logo WHERE id = 1').run();
  }
}
