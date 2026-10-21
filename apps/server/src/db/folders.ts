import type { PublicFolder } from '@onair-desk/shared';
import type { Db } from './database.js';
import { nowIso } from '../lib/time.js';

interface FolderRow {
  id: number;
  owner_id: number | null;
  parent_id: number | null;
  name: string;
}

const toFolder = (r: FolderRow): PublicFolder => ({
  id: r.id,
  ownerId: r.owner_id,
  parentId: r.parent_id,
  name: r.name,
});

export class FolderRepo {
  constructor(private readonly db: Db) {}

  list(): PublicFolder[] {
    return (
      this.db.prepare('SELECT * FROM folders ORDER BY name COLLATE NOCASE').all() as FolderRow[]
    ).map(toFolder);
  }

  findById(id: number): PublicFolder | undefined {
    const r = this.db.prepare('SELECT * FROM folders WHERE id = ?').get(id) as
      FolderRow | undefined;
    return r && toFolder(r);
  }

  create(ownerId: number | null, parentId: number | null, name: string): PublicFolder {
    const info = this.db
      .prepare('INSERT INTO folders (owner_id, parent_id, name) VALUES (?, ?, ?)')
      .run(ownerId, parentId, name);
    return this.findById(Number(info.lastInsertRowid))!;
  }

  update(id: number, patch: { name?: string; parentId?: number | null }): PublicFolder | undefined {
    const current = this.findById(id);
    if (!current) return undefined;
    this.db
      .prepare('UPDATE folders SET name = ?, parent_id = ?, updated_at = ? WHERE id = ?')
      .run(
        patch.name ?? current.name,
        patch.parentId !== undefined ? patch.parentId : current.parentId,
        nowIso(),
        id,
      );
    return this.findById(id);
  }

  /** Profondeur d'un dossier (1 = à la racine). */
  depth(id: number): number {
    let d = 0;
    for (let f = this.findById(id); f; f = f.parentId ? this.findById(f.parentId) : undefined) d++;
    return d;
  }

  /** Vrai si `candidate` est `id` lui-même ou l'un de ses sous-dossiers. */
  isSelfOrDescendant(id: number, candidate: number): boolean {
    for (
      let f = this.findById(candidate);
      f;
      f = f.parentId ? this.findById(f.parentId) : undefined
    ) {
      if (f.id === id) return true;
    }
    return false;
  }

  /** Hauteur du sous-arbre (1 = dossier sans sous-dossier). */
  subtreeHeight(id: number): number {
    const children = this.db.prepare('SELECT id FROM folders WHERE parent_id = ?').all(id) as {
      id: number;
    }[];
    return 1 + Math.max(0, ...children.map((c) => this.subtreeHeight(c.id)));
  }

  /** Vide = ni sous-dossier, ni script hors corbeille. */
  isEmpty(id: number): boolean {
    const row = this.db
      .prepare(
        `SELECT EXISTS (SELECT 1 FROM folders WHERE parent_id = @id)
             OR EXISTS (SELECT 1 FROM scripts WHERE folder_id = @id AND deleted_at IS NULL) AS n`,
      )
      .get({ id }) as { n: number };
    return row.n === 0;
  }

  delete(id: number): void {
    this.db.prepare('DELETE FROM folders WHERE id = ?').run(id);
  }
}
