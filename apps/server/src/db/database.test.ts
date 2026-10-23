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

describe('migration 5', () => {
  it('garde les conducteurs existants et interdit deux conducteurs par modèle et par date', () => {
    const v4 = openDatabase(dir, () => {}, migrations.slice(0, 4));
    v4.prepare(
      "INSERT INTO rundowns (title, air_date, start_time) VALUES ('Ancien', '2026-10-22', '07:00:00')",
    ).run();
    v4.close();

    const db = openDatabase(dir);
    expect(db.prepare('SELECT title, template_id FROM rundowns').all()).toEqual([
      { title: 'Ancien', template_id: null },
    ]);
    db.prepare(
      "INSERT INTO rundown_templates (title, start_time, days) VALUES ('Modèle', '07:00:00', 1)",
    ).run();
    const insert = db.prepare(
      `INSERT INTO rundowns (title, air_date, start_time, template_id, template_date)
       VALUES ('Généré', '2026-10-26', '07:00:00', 1, '2026-10-26')`,
    );
    insert.run();
    expect(() => insert.run()).toThrow(/UNIQUE/);
    db.close();
  });
});

describe('migration 6', () => {
  it('rattache écrans et prompteur au studio par défaut, complète le journal', () => {
    const v5 = openDatabase(dir, () => {}, migrations.slice(0, 5));
    v5.prepare(
      "INSERT INTO users (id, username, display_name, password_hash, role) VALUES (7, 'jean', 'Jean', 'x', 'animateur')",
    ).run();
    v5.prepare("INSERT INTO devices (id, name, token_hash) VALUES (3, 'Afficheur', 'h')").run();
    v5.prepare(
      "UPDATE prompter_state SET snapshot = '{\"id\":1}', sent_by_device = 3, item_uid = 'a' WHERE id = 1",
    ).run();
    const log = v5.prepare('INSERT INTO audit_log (actor_type, actor_id, action) VALUES (?, ?, ?)');
    log.run('user', 7, 'auth.login');
    log.run('user', 7, 'script.trashed');
    log.run('device', 3, 'prompter.sent');
    log.run('user', 7, 'settings.updated');
    v5.close();

    const db = openDatabase(dir);
    expect(db.prepare('SELECT id, name FROM studios').all()).toEqual([{ id: 1, name: 'Studio' }]);
    expect(db.prepare('SELECT studio_id FROM devices').get()).toEqual({ studio_id: 1 });
    expect(
      db.prepare('SELECT studio_id, snapshot, sent_by_device, item_uid FROM prompter_state').all(),
    ).toEqual([{ studio_id: 1, snapshot: '{"id":1}', sent_by_device: 3, item_uid: 'a' }]);
    expect(
      db.prepare('SELECT action, category, actor_name FROM audit_log ORDER BY id').all(),
    ).toEqual([
      { action: 'auth.login', category: 'securite', actor_name: 'Jean' },
      { action: 'script.trashed', category: 'contenu', actor_name: 'Jean' },
      { action: 'prompter.sent', category: 'antenne', actor_name: 'Afficheur' },
      { action: 'settings.updated', category: 'systeme', actor_name: 'Jean' },
    ]);
    db.close();
  });
});
