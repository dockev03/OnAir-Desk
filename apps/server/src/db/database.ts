import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { migrations } from './migrations.js';

export type Db = Database.Database;

const BACKUPS_KEPT = 5;

/** Ouvre (ou crée) la base SQLite et applique les migrations en attente. */
export function openDatabase(
  dataDir: string,
  log: (msg: string) => void = () => {},
  list: string[] = migrations,
): Db {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'onair-desk.db');
  const existed = fs.existsSync(file);
  const db = new Database(file);
  // La base contient les hachés des mots de passe : lisible par le seul compte du serveur.
  if (!existed) fs.chmodSync(file, 0o600);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  const current = db.pragma('user_version', { simple: true }) as number;
  if (current > list.length) {
    db.close();
    throw new Error(
      `La base (version ${current}) est plus récente que l'application (version ${list.length}).`,
    );
  }
  if (current < list.length) {
    if (existed && current > 0) backupBeforeMigration(db, dataDir, current, log);
    migrate(db, current, list);
    log(`Base migrée de la version ${current} à la version ${list.length}.`);
  }
  return db;
}

/** Base en mémoire, pour les tests. */
export function openMemoryDatabase(): Db {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db, 0);
  return db;
}

function migrate(db: Db, from: number, list: string[] = migrations): void {
  for (let i = from; i < list.length; i++) {
    db.transaction(() => {
      db.exec(list[i]!);
      db.pragma(`user_version = ${i + 1}`);
    })();
  }
}

function backupBeforeMigration(db: Db, dataDir: string, version: number, log: (m: string) => void) {
  const dir = path.join(dataDir, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(dir, `onair-desk-v${version}-${stamp}.db`);
  // VACUUM INTO produit une copie cohérente, même en mode WAL.
  db.prepare('VACUUM INTO ?').run(target);
  log(`Sauvegarde avant migration : ${target}`);

  const old = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith('onair-desk-') && f.endsWith('.db'))
    .sort()
    .slice(0, -BACKUPS_KEPT);
  for (const f of old) fs.rmSync(path.join(dir, f));
}
