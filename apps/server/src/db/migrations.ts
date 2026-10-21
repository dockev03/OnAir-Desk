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
];
