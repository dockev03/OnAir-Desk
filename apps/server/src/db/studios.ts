import type { Studio } from '@onair-desk/shared';
import type { Db } from './database.js';

/** Studio créé par la migration 6 : celui de tous les écrans et comptes tant qu'il est seul. */
export const DEFAULT_STUDIO_ID = 1;

/** Studios de la station (un seul pour l'instant, sans interface de gestion). */
export class StudioRepo {
  constructor(private readonly db: Db) {}

  list(): Studio[] {
    return this.db.prepare('SELECT id, name FROM studios ORDER BY id').all() as Studio[];
  }

  findById(id: number): Studio | undefined {
    return this.db.prepare('SELECT id, name FROM studios WHERE id = ?').get(id) as
      Studio | undefined;
  }
}
