/**
 * Migrations SQL, appliquées dans l'ordre. Le numéro de la dernière migration appliquée
 * est stocké dans PRAGMA user_version. Ne jamais modifier une migration déjà livrée :
 * en ajouter une nouvelle.
 */
const NOW = "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))";

export const migrations: string[] = [
  /* 1 — socle : comptes, sessions, appareils kiosk, paramètres, journal */ `
  CREATE TABLE users (
    id            INTEGER PRIMARY KEY,
    username      TEXT    NOT NULL UNIQUE,
    display_name  TEXT    NOT NULL,
    password_hash TEXT    NOT NULL,
    role          TEXT    NOT NULL CHECK (role IN ('admin', 'animateur')),
    locale        TEXT    NOT NULL DEFAULT 'fr' CHECK (locale IN ('fr', 'en')),
    is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at    TEXT    NOT NULL DEFAULT ${NOW},
    updated_at    TEXT    NOT NULL DEFAULT ${NOW}
  );

  CREATE TABLE sessions (
    id_hash      TEXT    PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at   TEXT    NOT NULL DEFAULT ${NOW},
    expires_at   INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
  );
  CREATE INDEX sessions_user_id ON sessions (user_id);

  CREATE TABLE devices (
    id           INTEGER PRIMARY KEY,
    name         TEXT    NOT NULL,
    token_hash   TEXT    NOT NULL UNIQUE,
    created_at   TEXT    NOT NULL DEFAULT ${NOW},
    last_seen_at TEXT,
    revoked_at   TEXT
  );

  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE audit_log (
    id         INTEGER PRIMARY KEY,
    at         TEXT    NOT NULL DEFAULT ${NOW},
    actor_type TEXT    NOT NULL CHECK (actor_type IN ('user', 'device', 'system', 'anonymous')),
    actor_id   INTEGER,
    action     TEXT    NOT NULL,
    details    TEXT
  );
  CREATE INDEX audit_log_at ON audit_log (at);
  `,

  /* 2 — scripts : dossiers, scripts, historique, recherche plein texte, prompteur */ `
  CREATE TABLE folders (
    id         INTEGER PRIMARY KEY,
    owner_id   INTEGER REFERENCES users (id) ON DELETE RESTRICT,
    parent_id  INTEGER REFERENCES folders (id) ON DELETE RESTRICT,
    name       TEXT    NOT NULL,
    created_at TEXT    NOT NULL DEFAULT ${NOW},
    updated_at TEXT    NOT NULL DEFAULT ${NOW}
  );
  CREATE INDEX folders_owner_parent ON folders (owner_id, parent_id);

  CREATE TABLE scripts (
    id           INTEGER PRIMARY KEY,
    owner_id     INTEGER REFERENCES users (id) ON DELETE RESTRICT,
    folder_id    INTEGER REFERENCES folders (id) ON DELETE SET NULL,
    title        TEXT    NOT NULL,
    content      TEXT    NOT NULL,
    content_text TEXT    NOT NULL DEFAULT '',
    word_count   INTEGER NOT NULL DEFAULT 0,
    speed_wpm    INTEGER NOT NULL,
    version      INTEGER NOT NULL DEFAULT 1,
    created_by   INTEGER REFERENCES users (id) ON DELETE SET NULL,
    updated_by   INTEGER REFERENCES users (id) ON DELETE SET NULL,
    created_at   TEXT    NOT NULL DEFAULT ${NOW},
    updated_at   TEXT    NOT NULL DEFAULT ${NOW},
    deleted_at   TEXT,
    deleted_by   INTEGER REFERENCES users (id) ON DELETE SET NULL
  );
  CREATE INDEX scripts_owner_folder ON scripts (owner_id, folder_id);
  CREATE INDEX scripts_deleted_at ON scripts (deleted_at);

  CREATE TABLE script_revisions (
    id         INTEGER PRIMARY KEY,
    script_id  INTEGER NOT NULL REFERENCES scripts (id) ON DELETE CASCADE,
    version    INTEGER NOT NULL,
    title      TEXT    NOT NULL,
    content    TEXT    NOT NULL,
    word_count INTEGER NOT NULL,
    saved_by   INTEGER REFERENCES users (id) ON DELETE SET NULL,
    saved_at   TEXT    NOT NULL DEFAULT ${NOW}
  );
  CREATE INDEX script_revisions_script ON script_revisions (script_id, id);

  -- Recherche plein texte, insensible à la casse et aux accents.
  CREATE VIRTUAL TABLE scripts_fts USING fts5 (
    title, content_text,
    content = 'scripts', content_rowid = 'id',
    tokenize = 'unicode61 remove_diacritics 2'
  );
  CREATE TRIGGER scripts_fts_insert AFTER INSERT ON scripts BEGIN
    INSERT INTO scripts_fts (rowid, title, content_text) VALUES (new.id, new.title, new.content_text);
  END;
  CREATE TRIGGER scripts_fts_delete AFTER DELETE ON scripts BEGIN
    INSERT INTO scripts_fts (scripts_fts, rowid, title, content_text)
      VALUES ('delete', old.id, old.title, old.content_text);
  END;
  CREATE TRIGGER scripts_fts_update AFTER UPDATE OF title, content_text ON scripts BEGIN
    INSERT INTO scripts_fts (scripts_fts, rowid, title, content_text)
      VALUES ('delete', old.id, old.title, old.content_text);
    INSERT INTO scripts_fts (rowid, title, content_text) VALUES (new.id, new.title, new.content_text);
  END;

  -- Script affiché sur l'écran studio (une seule ligne). La copie (snapshot) permet de
  -- continuer à l'afficher même s'il est supprimé.
  CREATE TABLE prompter_state (
    id        INTEGER PRIMARY KEY CHECK (id = 1),
    script_id INTEGER REFERENCES scripts (id) ON DELETE SET NULL,
    snapshot  TEXT,
    deleted   INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
    sent_by   INTEGER REFERENCES users (id) ON DELETE SET NULL,
    sent_at   TEXT
  );
  INSERT INTO prompter_state (id) VALUES (1);
  `,
  /* 3 — écran studio : un écran kiosk peut choisir le script affiché */ `
  ALTER TABLE prompter_state ADD COLUMN sent_by_device INTEGER REFERENCES devices (id) ON DELETE SET NULL;
  `,
  /* 4 — conducteurs ; durée des repères des scripts */ `
  -- Durée cumulée des repères (jingles, sons…). Seuls les repères portent une clé
  -- « seconds » dans le contenu : les scripts existants sont remplis directement.
  ALTER TABLE scripts ADD COLUMN cue_seconds INTEGER NOT NULL DEFAULT 0;
  UPDATE scripts SET cue_seconds = COALESCE(
    (SELECT SUM(j.value) FROM json_tree(scripts.content) j
      WHERE j.key = 'seconds' AND j.type = 'integer'), 0);

  CREATE TABLE rundowns (
    id         INTEGER PRIMARY KEY,
    owner_id   INTEGER REFERENCES users (id) ON DELETE RESTRICT,
    title      TEXT    NOT NULL,
    air_date   TEXT    NOT NULL,
    start_time TEXT    NOT NULL,
    version    INTEGER NOT NULL DEFAULT 1,
    created_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
    updated_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
    created_at TEXT    NOT NULL DEFAULT ${NOW},
    updated_at TEXT    NOT NULL DEFAULT ${NOW},
    deleted_at TEXT,
    deleted_by INTEGER REFERENCES users (id) ON DELETE SET NULL
  );
  CREATE INDEX rundowns_air_date ON rundowns (air_date);
  CREATE INDEX rundowns_deleted_at ON rundowns (deleted_at);

  -- Éléments d'un conducteur, dans l'ordre de « position ». L'uid est stable : il survit
  -- aux réordonnancements et sert à désigner l'élément affiché sur l'écran studio.
  CREATE TABLE rundown_items (
    rundown_id       INTEGER NOT NULL REFERENCES rundowns (id) ON DELETE CASCADE,
    uid              TEXT    NOT NULL,
    position         INTEGER NOT NULL,
    type_id          TEXT    NOT NULL,
    title            TEXT    NOT NULL,
    duration_seconds INTEGER,
    notes            TEXT    NOT NULL DEFAULT '',
    script_id        INTEGER REFERENCES scripts (id) ON DELETE SET NULL,
    PRIMARY KEY (rundown_id, uid)
  );
  CREATE INDEX rundown_items_script ON rundown_items (script_id);

  -- Écran studio : conducteur suivi et élément en cours (copie du conducteur, sans le
  -- contenu des scripts, pour ne jamais afficher d'écran blanc).
  ALTER TABLE prompter_state ADD COLUMN rundown_id INTEGER REFERENCES rundowns (id) ON DELETE SET NULL;
  ALTER TABLE prompter_state ADD COLUMN item_uid TEXT;
  ALTER TABLE prompter_state ADD COLUMN rundown_snapshot TEXT;
  `,
];
