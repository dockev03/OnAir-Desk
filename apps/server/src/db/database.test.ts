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

describe('migration 4', () => {
  it('remplit la durée des repères des scripts existants', () => {
    const v3 = openDatabase(dir, () => {}, migrations.slice(0, 3));
    const content = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'cue', attrs: { cueId: 'jingle', label: 'JINGLE', seconds: 12 } },
            { type: 'text', text: 'seconds' },
            { type: 'cue', attrs: { cueId: 'son', label: 'SON', seconds: 30 } },
            { type: 'cue', attrs: { cueId: 'pause', label: 'PAUSE' } },
          ],
        },
      ],
    });
    const insert = v3.prepare('INSERT INTO scripts (title, content, speed_wpm) VALUES (?, ?, 150)');
    insert.run('Avec repères', content);
    insert.run('Sans repère', '{"type":"doc","content":[{"type":"paragraph"}]}');
    v3.close();

    const db = openDatabase(dir);
    expect(db.prepare('SELECT title, cue_seconds FROM scripts ORDER BY id').all()).toEqual([
      { title: 'Avec repères', cue_seconds: 42 },
      { title: 'Sans repère', cue_seconds: 0 },
    ]);
    db.close();
  });
});
