import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createConnection, type Connection } from 'mysql2/promise';
import { MysqlRadiodjReader, radiodjErrorCode } from '../src/connectors/radiodj/reader.js';
import { toTrack } from '../src/connectors/radiodj/cues.js';

/**
 * Requêtes du connecteur RadioDJ contre un vrai MariaDB (job CI « mariadb »). En local, ces
 * tests ne tournent que si MARIADB_TEST_URL est défini, ex. :
 *   MARIADB_TEST_URL=mysql://utilisateur:motdepasse@127.0.0.1:3306/radiodj_test
 * La base indiquée est vidée et remplie avec un schéma réduit reproduisant celui de RadioDJ
 * (colonnes relevées sur RadioDJ 3.0.0.5, voir docs/cadrage-radiodj.md).
 */
const url = process.env.MARIADB_TEST_URL;

const SCHEMA = `
DROP TABLE IF EXISTS history, queuelist, songs;
CREATE TABLE songs (
  ID int(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
  path varchar(255) NOT NULL DEFAULT '',
  enabled int(1) NOT NULL DEFAULT 1,
  song_type tinyint(2) NOT NULL,
  artist varchar(250) NOT NULL,
  title varchar(250) NOT NULL,
  duration decimal(11,5) NOT NULL DEFAULT 0,
  cue_times varchar(255) NOT NULL DEFAULT '&sta=0',
  year varchar(4) NOT NULL DEFAULT '1900',
  KEY song_type (song_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE history (
  ID int(10) unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
  trackID int(10) unsigned NOT NULL,
  date_played datetime DEFAULT '2002-01-01 00:00:01',
  song_type tinyint(2) NOT NULL,
  id_subcat int(10) unsigned NOT NULL DEFAULT 0,
  id_genre int(10) unsigned NOT NULL DEFAULT 0,
  duration decimal(11,5) NOT NULL DEFAULT 0,
  artist varchar(200) NOT NULL,
  title varchar(200) NOT NULL,
  album varchar(200) NOT NULL DEFAULT '',
  KEY trackID (trackID), KEY date_played (date_played), KEY song_type (song_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE queuelist (
  ID int(10) unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
  songID int(11) NOT NULL,
  ETA datetime DEFAULT '2002-01-01 00:00:01',
  duration decimal(11,5) NOT NULL DEFAULT 0,
  artist varchar(200) NOT NULL,
  associated_artists varchar(250) NOT NULL DEFAULT '',
  title varchar(250) NOT NULL,
  album varchar(250) NOT NULL DEFAULT '',
  swID int(11) NOT NULL DEFAULT -1,
  swPlay decimal(11,5) NOT NULL DEFAULT 0,
  vtID int(11) NOT NULL DEFAULT -1,
  vtPlay decimal(11,5) NOT NULL DEFAULT 0,
  KEY songID (songID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
INSERT INTO songs (ID, song_type, artist, title, duration, cue_times) VALUES
  (1, 0, 'Adamé;Lili Poli', 'Summertime', 163.98907,
   '&sta=0.33172335600907&int=4.36934240362812&out=161.413764172336&xta=164.320793650794&end=164.615238095238&fin=0&fou=0.294444444444423'),
  (4, 0, 'Andéol', 'Los Angeles', 182.5, '&sta=0.5&xta=181&end=182'),
  (8, 0, 'Corneille;Vitaa', 'Ensemble', 183.82086, '&sta=0.2&xta=183&end=183.5'),
  (11, 0, 'EMA', 'Sans Permission', 139.15971, '&sta=0.1&xta=138.9&end=139.1'),
  (20, 0, '100% Fun', 'Taux_de_rire', 120, '&sta=0'),
  (50, 2, 'Station', 'Jingle Chanté 01', 6.2, '&sta=0&end=6.2'),
  (60, 4, 'Annonceur', 'Pub Summer', 30, '&sta=0&end=30');
UPDATE songs SET year = '2019' WHERE ID = 1;
INSERT INTO history (trackID, date_played, song_type, duration, artist, title) VALUES
  (1, '2026-10-24 16:19:16', 0, 163.98907, 'Adamé;Lili Poli', 'Summertime'),
  (50, '2026-10-24 16:19:16', 2, 6.2, 'Station', 'Jingle Chanté 01'),
  (4, '2026-10-24 16:20:01', 0, 182.5, 'Andéol', 'Los Angeles'),
  (50, '2026-10-24 16:20:01', 2, 6.2, 'Station', 'Jingle Chanté 01');
INSERT INTO queuelist (ID, songID, ETA, duration, artist, title, swID, swPlay, vtID, vtPlay) VALUES
  (2, 11, '2026-10-24 16:23:03', 139.15971, 'EMA', 'Sans Permission', -100, 0, 0, -100),
  (3, 8, '2026-10-24 16:25:22', 183.82086, 'Corneille;Vitaa', 'Ensemble', 50, -20, 0, -100);
`;

function connectionOptions(raw: string) {
  const u = new URL(raw);
  return {
    host: u.hostname,
    port: Number(u.port || 3306),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ''),
  };
}

describe.skipIf(!url)('lecture de la base RadioDJ (MariaDB réel)', () => {
  const opts = url ? connectionOptions(url) : null;
  let admin: Connection;
  let reader: MysqlRadiodjReader;

  beforeAll(async () => {
    admin = await createConnection({ ...opts!, multipleStatements: true, charset: 'utf8mb4' });
    await admin.query(SCHEMA);
    const { password, ...settings } = opts!;
    reader = new MysqlRadiodjReader(settings, password);
  });

  afterAll(async () => {
    await reader?.close();
    await admin?.query('DROP TABLE IF EXISTS history, queuelist, songs');
    await admin?.end();
  });

  it('titre en cours : dernière ligne de l’historique hors habillages, avec ses repères', async () => {
    const row = await reader.current();
    expect(row).toMatchObject({
      trackId: 4,
      title: 'Los Angeles',
      artist: 'Andéol',
      songType: 0,
      datePlayed: '2026-10-24 16:20:01',
      cueTimes: '&sta=0.5&xta=181&end=182',
    });
    expect(row!.id).toBe(3);
    expect(toTrack(row!, 0).durationMs).toBe(180_500);
  });

  it('titre à venir : première ligne de la file, dans l’ordre', async () => {
    const next = await reader.next();
    expect(next).toMatchObject({ title: 'Sans Permission', artist: 'EMA', duration: 139.15971 });
    expect(next!.cueTimes).toBe('&sta=0.1&xta=138.9&end=139.1');
  });

  it('file vide, historique vide : rien', async () => {
    await admin.query('DELETE FROM queuelist');
    expect(await reader.next()).toBeNull();
    await admin.query('DELETE FROM history');
    expect(await reader.current()).toBeNull();
  });

  it('bibliothèque : comptage, recherche dans la musique seule, jokers neutralisés', async () => {
    expect(await reader.countSongs()).toBe(7);
    const summer = await reader.searchSongs('summer', 20);
    // La pub « Pub Summer » n'est pas de la musique.
    expect(summer.map((s) => s.id)).toEqual([1]);
    expect(summer[0]).toMatchObject({
      artist: 'Adamé;Lili Poli',
      title: 'Summertime',
      year: '2019',
    });
    // Année non renseignée : défaut de RadioDJ.
    expect((await reader.searchSongs('andéol', 20))[0]?.year).toBe('1900');
    // « _ » et « % » sont cherchés tels quels.
    expect((await reader.searchSongs('x_de', 20)).map((s) => s.id)).toEqual([20]);
    expect((await reader.searchSongs('100%', 20)).map((s) => s.id)).toEqual([20]);
    expect(await reader.searchSongs('%', 20)).toHaveLength(1);
    // Accents : interclassement de la base.
    expect((await reader.searchSongs('andéol', 20)).map((s) => s.id)).toEqual([4]);
    expect(await reader.searchSongs('e', 2)).toHaveLength(2);
  });

  it('mauvais mot de passe : code stable', async () => {
    const { password: _, ...settings } = opts!;
    const bad = new MysqlRadiodjReader(settings, 'pas-le-bon-mot-de-passe');
    const err = await bad.countSongs().catch((e: unknown) => e);
    expect(radiodjErrorCode(err)).toBe('radiodj_access_denied');
    await bad.close();
  });

  it('base inexistante et tables absentes : codes stables', async () => {
    const { password, ...settings } = opts!;
    const missing = new MysqlRadiodjReader({ ...settings, database: 'base_absente_oad' }, password);
    const err = await missing.countSongs().catch((e: unknown) => e);
    // Selon les droits du compte : base inconnue ou accès refusé.
    expect(['radiodj_bad_database', 'radiodj_access_denied']).toContain(radiodjErrorCode(err));
    await missing.close();

    await admin.query('DROP TABLE queuelist');
    const noTable = await reader.next().catch((e: unknown) => e);
    expect(radiodjErrorCode(noTable)).toBe('radiodj_bad_schema');
  });
});
