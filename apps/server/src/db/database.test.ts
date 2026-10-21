import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from './database.js';
import { migrations } from './migrations.js';

let dir: string;
beforeEach(() => (dir = fs.mkdtempSync(path.join(os.tmpdir(), 'onair-db-'))));
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('openDatabase', () => {
  it('crée la base, lisible par le seul propriétaire', () => {
    openDatabase(dir).close();
    const stat = fs.statSync(path.join(dir, 'onair-desk.db'));
    expect(stat.mode & 0o077).toBe(0);
  });

  it('sauvegarde la base avant une migration et conserve les données', () => {
    const db = openDatabase(dir);
    db.prepare("INSERT INTO settings (key, value) VALUES ('stationName', '\"Radio\"')").run();
    db.close();

    const next = [...migrations, 'CREATE TABLE demo (id INTEGER PRIMARY KEY);'];
    const migrated = openDatabase(dir, () => {}, next);
    expect(migrated.pragma('user_version', { simple: true })).toBe(next.length);
    expect(migrated.prepare('SELECT value FROM settings').get()).toEqual({ value: '"Radio"' });
    migrated.close();

    const backups = fs.readdirSync(path.join(dir, 'backups'));
    expect(backups).toHaveLength(1);
    expect(backups[0]).toMatch(new RegExp(`^onair-desk-v${migrations.length}-.*\\.db$`));
  });

  it("refuse une base plus récente que l'application", () => {
    openDatabase(dir, () => {}, [...migrations, 'SELECT 1;']).close();
    expect(() => openDatabase(dir)).toThrow(/plus récente/);
  });
});
