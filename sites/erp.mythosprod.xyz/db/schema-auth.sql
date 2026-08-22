-- Mythos ERP — Stage 4: authentication, authorization and audit additions
--
-- STATUS: PROPOSAL. Not applied to production. Extends db/schema.sql, which
-- already defines users, roles, permissions, role_permissions, user_roles and
-- audit_log. This file adds what a real login flow needs and seeds the role
-- model.
--
-- Design note that shapes everything below: sessions are SERVER-SIDE and
-- opaque, not JWTs. A JWT cannot be revoked before it expires without keeping
-- server state anyway, and this application has exactly one backend and one
-- database — so the stateless argument buys nothing and costs immediate
-- logout, immediate role changes and immediate lockout. Opaque tokens in a
-- table give all three for the price of one indexed lookup.

BEGIN;

-- ── users: columns the login flow needs ─────────────────────────────────────
ALTER TABLE users
  ADD COLUMN password_algo        text,          -- 'argon2id'; NULL while SSO-only
  ADD COLUMN password_changed_at  timestamptz,
  ADD COLUMN must_change_password boolean NOT NULL DEFAULT false,
  ADD COLUMN failed_attempts      integer NOT NULL DEFAULT 0,
  ADD COLUMN locked_until         timestamptz,
  ADD COLUMN mfa_secret           text,          -- TOTP, encrypted at rest by the app
  ADD COLUMN mfa_enabled          boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT users_algo_known
      CHECK (password_algo IS NULL OR password_algo IN ('argon2id')),
  -- A password hash without a recorded algorithm is unverifiable later.
  ADD CONSTRAINT users_hash_needs_algo
      CHECK ((password_hash IS NULL) = (password_algo IS NULL));

-- ── sessions ────────────────────────────────────────────────────────────────
-- token_hash, never the token. A database dump must not yield live sessions,
-- which is the same reason password_hash exists.
CREATE TABLE sessions (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash     char(64) NOT NULL UNIQUE,      -- sha256 of a 256-bit random token
    csrf_hash      char(64) NOT NULL,             -- sha256 of the double-submit token
    issued_at      timestamptz NOT NULL DEFAULT now(),
    last_seen_at   timestamptz NOT NULL DEFAULT now(),
    idle_expires_at     timestamptz NOT NULL,
    absolute_expires_at timestamptz NOT NULL,
    revoked_at     timestamptz,
    revoked_reason text,                          -- logout | rotated | admin | password_change
    ip             inet,
    user_agent     text,
    CONSTRAINT sessions_expiry_ordered CHECK (absolute_expires_at >= idle_expires_at)
);
CREATE INDEX sessions_user_idx   ON sessions (user_id);
CREATE INDEX sessions_live_idx   ON sessions (idle_expires_at) WHERE revoked_at IS NULL;

-- ── login attempts — the rate-limit and lockout substrate ──────────────────
-- Recorded for successes as well as failures: "who logged in, from where" is
-- an audit question, and a table that only holds failures cannot answer it.
CREATE TABLE login_attempts (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    attempted_at  timestamptz NOT NULL DEFAULT now(),
    email_tried   citext NOT NULL,                -- recorded even if no such user
    user_id       uuid REFERENCES users(id),      -- NULL when the email is unknown
    ip            inet,
    user_agent    text,
    outcome       text NOT NULL,
    CONSTRAINT login_outcome_known CHECK (outcome IN
      ('success','bad_password','unknown_user','locked','rate_limited','mfa_failed','inactive'))
);
CREATE INDEX login_attempts_email_time_idx ON login_attempts (email_tried, attempted_at DESC);
CREATE INDEX login_attempts_ip_time_idx    ON login_attempts (ip, attempted_at DESC);

-- ── password reset ──────────────────────────────────────────────────────────
-- Single use, short lived, hashed at rest. consumed_at makes replay visible
-- rather than merely impossible.
CREATE TABLE password_reset_tokens (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash   char(64) NOT NULL UNIQUE,
    issued_at    timestamptz NOT NULL DEFAULT now(),
    expires_at   timestamptz NOT NULL,
    consumed_at  timestamptz,
    issued_ip    inet,
    CONSTRAINT reset_expiry_after_issue CHECK (expires_at > issued_at)
);
CREATE INDEX password_reset_user_idx ON password_reset_tokens (user_id);

-- ── audit_log: make the Stage 4 event taxonomy enforceable ─────────────────
ALTER TABLE audit_log DROP CONSTRAINT audit_action_known;
ALTER TABLE audit_log ADD CONSTRAINT audit_action_known CHECK (action IN (
    'login.success','login.failure','logout','session.revoked',
    'password.reset_requested','password.reset_completed','password.changed',
    'mfa.enabled','mfa.disabled',
    'record.created','record.updated','record.deleted','record.restored',
    'permission.denied','role.assigned','role.revoked',
    'user.created','user.disabled','user.enabled',
    'export','backup.created','backup.restored'
));

-- ── Role model ──────────────────────────────────────────────────────────────
INSERT INTO roles (key, label) VALUES
  ('super_admin',     'Super Admin'),
  ('admin',           'Admin'),
  ('manager',         'Manager'),
  ('production_user', 'Production User'),
  ('finance_user',    'Finance User'),
  ('read_only',       'Read Only User');

-- Permission keys are <module>.<action>. read/write/delete are business
-- verbs; `manage` is the administrative verb (configuration, assignment).
INSERT INTO permissions (key, label) VALUES
  ('dashboard.read','View dashboard'),
  ('clients.read','View clients'),      ('clients.write','Create/edit clients'),      ('clients.delete','Retire clients'),
  ('projects.read','View projects'),    ('projects.write','Create/edit projects'),    ('projects.delete','Retire projects'),
  ('planning.read','View planning'),    ('planning.write','Create/edit planning'),
  ('production.read','View production'),('production.write','Create/edit production'),
  ('finance.read','View finance'),      ('finance.write','Create/edit finance'),      ('finance.delete','Retire finance records'),
  ('documents.read','View documents'),  ('documents.write','Upload documents'),       ('documents.delete','Retire documents'),
  ('reports.read','View reports'),      ('reports.export','Export reports'),
  ('inventory.read','View inventory'),  ('inventory.write','Adjust inventory'),
  ('settings.read','View settings'),    ('settings.manage','Change settings'),
  ('users.read','View users'),          ('users.manage','Create/disable users'),
  ('roles.manage','Assign roles'),
  ('audit.read','Read the audit log'),
  ('backup.manage','Create/restore backups');

-- super_admin: everything, including role assignment and backup restore.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p WHERE r.key='super_admin';

-- admin: all business modules and settings, but NOT roles.manage and NOT
-- backup.manage. An admin who can grant themselves super_admin is a super
-- admin with extra steps; separating them is what makes the tier meaningful.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.key='admin' AND p.key NOT IN ('roles.manage','backup.manage');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.key='manager' AND p.key IN (
  'dashboard.read',
  'clients.read','clients.write',
  'projects.read','projects.write',
  'planning.read','planning.write',
  'production.read','production.write',
  'documents.read','documents.write',
  'inventory.read',
  'finance.read','reports.read');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.key='production_user' AND p.key IN (
  'dashboard.read',
  'production.read','production.write',
  'planning.read','planning.write',
  'inventory.read','inventory.write',
  'clients.read','documents.read');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.key='finance_user' AND p.key IN (
  'dashboard.read',
  'finance.read','finance.write',
  'reports.read','reports.export',
  'clients.read','projects.read','documents.read');

-- read_only: every .read, and nothing else. Deliberately excludes audit.read
-- and settings.read — who may inspect the audit trail is itself privileged.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.key='read_only' AND p.key LIKE '%.read'
  AND p.key NOT IN ('audit.read','settings.read','users.read');

-- ── Effective-permission view: one place the API asks "may they?" ──────────
CREATE VIEW user_effective_permissions AS
SELECT u.id AS user_id, p.key AS permission_key
FROM users u
JOIN user_roles ur       ON ur.user_id = u.id
JOIN role_permissions rp ON rp.role_id = ur.role_id
JOIN permissions p       ON p.id = rp.permission_id
WHERE u.deleted_at IS NULL AND u.is_active;

COMMIT;
