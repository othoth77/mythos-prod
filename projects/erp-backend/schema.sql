-- ══════════════════════════════════════════════════════════════════════
-- Mythos ERP secure backend — schema (portable: SQLite reference / MariaDB)
-- projects/erp-backend/schema.sql
--
-- Normalised identity/authz/audit tables. Business data is kept in the
-- `collections` table as authenticated, versioned, audited JSON documents —
-- a compatibility-oriented secure replacement for api.php's file store, so
-- the existing frontend + business logic transition without a rewrite
-- (per DEPLOYMENT §15). Per-entity normalisation is a later migration phase.
--
-- Types are chosen to work on both SQLite and MySQL/MariaDB. Booleans are
-- INTEGER 0/1; timestamps are ISO-8601 TEXT (UTC), set by the application.
-- ══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  username       TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  display_name   TEXT,
  active         INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS roles (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  name  TEXT NOT NULL UNIQUE          -- 'admin' | 'editor' | 'viewer'
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id  INTEGER NOT NULL,
  role_id  INTEGER NOT NULL,
  PRIMARY KEY (user_id, role_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
);

-- Server-side sessions. Only the sha-256 HASH of the session id is stored
-- (the plaintext lives only in the client cookie), mirroring the OTHMODE
-- session model. csrf_token is session-bound for the double-submit check.
CREATE TABLE IF NOT EXISTS sessions (
  id_hash     TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL,
  csrf_token  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  last_seen   TEXT NOT NULL,
  ip          TEXT,
  user_agent  TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Business data: one row per collection (mp_invoices, mp_devis, …).
-- `version` drives optimistic concurrency; `data` is a JSON array/object.
CREATE TABLE IF NOT EXISTS collections (
  key         TEXT PRIMARY KEY,
  data        TEXT NOT NULL DEFAULT '[]',
  version     INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL,
  updated_by  INTEGER,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
);

-- Secure document metadata. Files live OUTSIDE the web root; only the
-- server-generated stored_name is ever used to build a path.
CREATE TABLE IF NOT EXISTS documents (
  id           TEXT PRIMARY KEY,          -- server-generated random id
  orig_name    TEXT,                       -- client name, for display only
  stored_name  TEXT NOT NULL,             -- <id>.<ext>, ext from magic bytes
  mime         TEXT NOT NULL,             -- server-detected MIME
  size         INTEGER NOT NULL,
  category     TEXT,
  uploaded_by  INTEGER,
  uploaded_at  TEXT NOT NULL,
  FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
);

-- Append-only audit trail. No API path updates or deletes rows here.
CREATE TABLE IF NOT EXISTS audit_log (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  ts             TEXT NOT NULL,
  actor_user_id  INTEGER,
  actor_username TEXT,
  action         TEXT NOT NULL,           -- login|logout|write|upload|user.create|…
  resource       TEXT,                    -- e.g. collection key, 'session', 'document'
  resource_id    TEXT,
  meta           TEXT,                     -- JSON
  ip             TEXT
);

-- Login throttling (OWASP: slow down credential stuffing).
CREATE TABLE IF NOT EXISTS login_attempts (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  username  TEXT,
  ip        TEXT,
  ts        TEXT NOT NULL,
  ok        INTEGER NOT NULL DEFAULT 0
);

-- Schema versioning (§16): every applied migration recorded, so the schema
-- state is reproducible and never depends on a hand-edited production DB.
CREATE TABLE IF NOT EXISTS schema_migrations (
  version     TEXT PRIMARY KEY,
  applied_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user   ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_ts        ON audit_log(ts);
CREATE INDEX IF NOT EXISTS idx_attempts_lookup ON login_attempts(username, ip, ts);
