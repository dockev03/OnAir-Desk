import type { Library, LibraryOwner, PublicFolder } from '@onair-desk/shared';
import { t } from './i18n/index.svelte.js';

/** Clé d'URL d'un propriétaire : identifiant du compte, ou « common ». */
export const ownerKey = (id: number | null): string => (id === null ? 'common' : String(id));

export function parseOwnerKey(key: string | null): number | null | undefined {
  if (key === null) return undefined;
  if (key === 'common') return null;
  const n = Number(key);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export const ownerName = (o: Pick<LibraryOwner, 'id' | 'name'>): string =>
  o.id === null ? t('library.common') : o.name;

export interface FolderNode extends PublicFolder {
  depth: number;
}

/** Dossiers d'un propriétaire, à plat et dans l'ordre de l'arborescence (avec leur niveau). */
export function folderTree(lib: Library, ownerId: number | null): FolderNode[] {
  const out: FolderNode[] = [];
  const walk = (parentId: number | null, depth: number) => {
    for (const f of lib.folders) {
      if (f.ownerId === ownerId && f.parentId === parentId) {
        out.push({ ...f, depth });
        walk(f.id, depth + 1);
      }
    }
  };
  walk(null, 0);
  return out;
}

/** Chemin d'un dossier, de la racine jusqu'à lui. */
export function folderPath(lib: Library, folderId: number | null): PublicFolder[] {
  const path: PublicFolder[] = [];
  for (let id = folderId; id !== null;) {
    const f = lib.folders.find((x) => x.id === id);
    if (!f) break;
    path.unshift(f);
    id = f.parentId;
  }
  return path;
}

export const formatDate = (iso: string, locale: string) =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
