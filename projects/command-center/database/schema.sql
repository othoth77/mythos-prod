-- =====================================================
-- MYTHOS AI COMMAND CENTER — database schema (stage MCC-1)
-- projects/command-center/database/schema.sql
--
-- Target: database `mythos_command_center`, schema `mcc`, owner role
-- `mythos_command_center_owner`. This mirrors the established repository
-- convention verified on the live server: ONE PostgreSQL server
-- (container `idauto-postgres`, 127.0.0.1:5432) hosting ONE database per
-- product with its own owner role (`idauto`/`idauto`,
-- `ssangyong_autos`/`ssangyong_autos_owner`). No cross-product schema is
-- referenced here and no foreign key crosses a product boundary.
--
-- Run as the owner role against the product database:
--   psql -U mythos_command_center_owner -d mythos_command_center -f schema.sql
--
-- IDEMPOTENT: every object uses IF NOT EXISTS or CREATE OR REPLACE, so the
-- file can be re-applied to an existing database without loss. It never
-- drops a table and never deletes a row.
--
-- SECURITY: no column here is intended to hold a credential. Secret-shaped
-- content is rejected at the API boundary (reference/secrets.js) before it
-- can reach `mcc_commands.body` or `mcc_notes.content`. See
-- docs/MYTHOS_COMMAND_CENTER_ARCHITECTURE.md §Security.
-- =====================================================

CREATE SCHEMA IF NOT EXISTS mcc;
SET search_path TO mcc, public;

-- ── Reference / taxonomy ────────────────────────────────────────────────
-- Dynamic by design: rows, not enum types, so a new category, tag or
-- project is added through the API without a code change or a migration.

CREATE TABLE IF NOT EXISTS mcc_categories (
  id           bigserial PRIMARY KEY,
  slug         text NOT NULL UNIQUE,
  name_en      text NOT NULL,
  name_fr      text NOT NULL,
  name_ar      text,                       -- Arabic-ready: nullable until translated
  description  text NOT NULL DEFAULT '',
  color        text NOT NULL DEFAULT 'slate',
  sort_order   integer NOT NULL DEFAULT 1000,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mcc_projects (
  id           bigserial PRIMARY KEY,
  slug         text NOT NULL UNIQUE,
  name         text NOT NULL,
  description  text NOT NULL DEFAULT '',
  sort_order   integer NOT NULL DEFAULT 1000,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mcc_tags (
  id           bigserial PRIMARY KEY,
  slug         text NOT NULL UNIQUE,
  label        text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ── Commands ────────────────────────────────────────────────────────────
-- `body` holds the command text VERBATIM. Nothing in this application ever
-- executes it: there is no shell, no exec, no eval anywhere in the runtime.
-- It is a library, not an execution engine (owner requirement §14).

CREATE TABLE IF NOT EXISTS mcc_commands (
  id              bigserial PRIMARY KEY,
  slug            text NOT NULL UNIQUE,
  title           text NOT NULL,
  category_id     bigint REFERENCES mcc_categories(id) ON DELETE SET NULL,
  project_id      bigint REFERENCES mcc_projects(id)   ON DELETE SET NULL,
  description     text NOT NULL DEFAULT '',
  body            text NOT NULL,
  explanation     text NOT NULL DEFAULT '',
  when_to_use     text NOT NULL DEFAULT '',
  best_practices  text NOT NULL DEFAULT '',
  warnings        text NOT NULL DEFAULT '',
  difficulty      text NOT NULL DEFAULT 'INTERMEDIATE'
                    CHECK (difficulty IN ('BEGINNER', 'INTERMEDIATE', 'ADVANCED')),
  safety_level    text NOT NULL DEFAULT 'SAFE'
                    CHECK (safety_level IN ('SAFE', 'READ_ONLY', 'WRITE', 'PRODUCTION', 'DESTRUCTIVE')),
  status          text NOT NULL DEFAULT 'ACTIVE'
                    CHECK (status IN ('ACTIVE', 'ARCHIVED', 'DRAFT')),
  version         text NOT NULL DEFAULT '1.0',
  author          text NOT NULL DEFAULT '',
  source          text NOT NULL DEFAULT '',
  -- Declared placeholders: [{"name":"REPOSITORY","label":"...","default":"..."}]
  -- Placeholders are also discovered from {{NAME}} occurrences in `body`;
  -- this column only carries labels and defaults for them.
  variables       jsonb NOT NULL DEFAULT '[]'::jsonb,
  usage_count     integer NOT NULL DEFAULT 0 CHECK (usage_count >= 0),
  last_used_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Full-text search vector. `simple` (not `english`) is deliberate: the
-- library is French/English today and Arabic-ready, and `simple` stems
-- nothing, so no language's tokens are mangled. Weighted so a title match
-- outranks a body match. Replacing this with an external search engine
-- later means replacing this column and the /api/commands query — no other
-- part of the application reads it.
ALTER TABLE mcc_commands
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(description, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(when_to_use, '')), 'C') ||
    setweight(to_tsvector('simple', coalesce(explanation, '')), 'C') ||
    setweight(to_tsvector('simple', coalesce(body, '')), 'D')
  ) STORED;

-- Accent-folded, lower-cased copy of the searchable text, for the partial
-- and accent-insensitive matching that `search_vector` cannot do.
--
-- WHY `translate` AND NOT THE `unaccent` EXTENSION: a generated column
-- requires an IMMUTABLE expression, and `unaccent()` is only STABLE (it
-- reads a dictionary file), so using it here would need a hand-written
-- IMMUTABLE wrapper plus a superuser CREATE EXTENSION on a database shared
-- with two other products. `translate` and `lower` are both IMMUTABLE and
-- built in. The character list covers French, which with English is what
-- this library actually holds; Arabic needs no folding of this kind, and
-- its text passes through untouched.
--
-- Without this, a French search for "deploiement" finds nothing while the
-- library is full of "Déploiement" — observed directly during MCC-1
-- verification, which is why the column exists.
ALTER TABLE mcc_commands
  ADD COLUMN IF NOT EXISTS search_text text
  GENERATED ALWAYS AS (
    translate(
      lower(
        coalesce(title, '') || ' ' || coalesce(description, '') || ' ' ||
        coalesce(when_to_use, '') || ' ' || coalesce(explanation, '') || ' ' ||
        coalesce(best_practices, '') || ' ' || coalesce(warnings, '') || ' ' ||
        coalesce(body, '')
      ),
      'àáâãäåçèéêëìíîïñòóôõöùúûüýÿœæ',
      'aaaaaaceeeeiiiinooooouuuuyyoa'
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS mcc_commands_search_idx   ON mcc_commands USING gin (search_vector);
CREATE INDEX IF NOT EXISTS mcc_commands_status_idx   ON mcc_commands (status);
CREATE INDEX IF NOT EXISTS mcc_commands_category_idx ON mcc_commands (category_id);
CREATE INDEX IF NOT EXISTS mcc_commands_project_idx  ON mcc_commands (project_id);
CREATE INDEX IF NOT EXISTS mcc_commands_usage_idx    ON mcc_commands (usage_count DESC);
CREATE INDEX IF NOT EXISTS mcc_commands_lastused_idx ON mcc_commands (last_used_at DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS mcc_command_tags (
  command_id  bigint NOT NULL REFERENCES mcc_commands(id) ON DELETE CASCADE,
  tag_id      bigint NOT NULL REFERENCES mcc_tags(id)     ON DELETE CASCADE,
  PRIMARY KEY (command_id, tag_id)
);
CREATE INDEX IF NOT EXISTS mcc_command_tags_tag_idx ON mcc_command_tags (tag_id);

-- Directed relations. RELATED is written in both directions by the API so
-- the graph reads the same from either end; NEXT/PREVIOUS stay directed and
-- are what a workflow chain is built from.
CREATE TABLE IF NOT EXISTS mcc_command_relations (
  command_id          bigint NOT NULL REFERENCES mcc_commands(id) ON DELETE CASCADE,
  related_command_id  bigint NOT NULL REFERENCES mcc_commands(id) ON DELETE CASCADE,
  relation_type       text NOT NULL DEFAULT 'RELATED'
                        CHECK (relation_type IN ('RELATED', 'NEXT', 'PREVIOUS')),
  PRIMARY KEY (command_id, related_command_id, relation_type),
  CHECK (command_id <> related_command_id)
);
CREATE INDEX IF NOT EXISTS mcc_command_relations_rel_idx ON mcc_command_relations (related_command_id);

-- ── Versioning (owner requirement §30) ──────────────────────────────────
-- Append-only. Every save writes the PREVIOUS state here before the row is
-- overwritten, so history is never lost and a command can be inspected at
-- any past version. Nothing in the application deletes from this table.

CREATE TABLE IF NOT EXISTS mcc_command_versions (
  id          bigserial PRIMARY KEY,
  command_id  bigint NOT NULL REFERENCES mcc_commands(id) ON DELETE CASCADE,
  version     text NOT NULL,
  snapshot    jsonb NOT NULL,
  change_note text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mcc_command_versions_cmd_idx ON mcc_command_versions (command_id, created_at DESC);

-- ── Favourites ──────────────────────────────────────────────────────────
-- A table rather than a boolean column, because the owner asked for custom
-- ordering (§9) and because a future multi-user build adds a user_id column
-- here without touching mcc_commands.

CREATE TABLE IF NOT EXISTS mcc_favorites (
  command_id  bigint PRIMARY KEY REFERENCES mcc_commands(id) ON DELETE CASCADE,
  rank        integer NOT NULL DEFAULT 1000,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── Usage events ────────────────────────────────────────────────────────
-- Append-only event log. mcc_commands.usage_count is a denormalised
-- counter for fast sorting; this table is the auditable source that the
-- today/week/month leaderboards are computed from (§8).

CREATE TABLE IF NOT EXISTS mcc_usage_events (
  id          bigserial PRIMARY KEY,
  command_id  bigint NOT NULL REFERENCES mcc_commands(id) ON DELETE CASCADE,
  event_type  text NOT NULL DEFAULT 'COPY'
                CHECK (event_type IN ('COPY', 'OPEN', 'USE', 'CUSTOMIZE')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  source      text NOT NULL DEFAULT 'web'
);
CREATE INDEX IF NOT EXISTS mcc_usage_events_cmd_idx  ON mcc_usage_events (command_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS mcc_usage_events_time_idx ON mcc_usage_events (occurred_at DESC);

-- ── Notes (§10) ─────────────────────────────────────────────────────────
-- One table, scoped by `scope` + the matching nullable FK, so a note can
-- attach to a command, a category, a project or a workflow — or to nothing
-- (a general note) — without four near-identical tables.
-- `content` is stored as raw text; the future Markdown renderer is a
-- presentation change only, no schema change.

CREATE TABLE IF NOT EXISTS mcc_notes (
  id           bigserial PRIMARY KEY,
  title        text NOT NULL,
  content      text NOT NULL DEFAULT '',
  scope        text NOT NULL DEFAULT 'GENERAL'
                 CHECK (scope IN ('GENERAL', 'COMMAND', 'CATEGORY', 'PROJECT', 'WORKFLOW')),
  command_id   bigint REFERENCES mcc_commands(id)   ON DELETE CASCADE,
  category_id  bigint REFERENCES mcc_categories(id) ON DELETE SET NULL,
  project_id   bigint REFERENCES mcc_projects(id)   ON DELETE SET NULL,
  workflow_id  bigint,   -- FK added after mcc_workflows exists (below)
  tags         text[] NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  -- The scope must agree with which FK is populated. Without this a note
  -- could claim COMMAND scope while pointing at nothing, and the command
  -- detail page would silently lose it.
  CONSTRAINT mcc_notes_scope_target CHECK (
    (scope = 'GENERAL')
    OR (scope = 'COMMAND'  AND command_id  IS NOT NULL)
    OR (scope = 'CATEGORY' AND category_id IS NOT NULL)
    OR (scope = 'PROJECT'  AND project_id  IS NOT NULL)
    OR (scope = 'WORKFLOW' AND workflow_id IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS mcc_notes_command_idx ON mcc_notes (command_id);
CREATE INDEX IF NOT EXISTS mcc_notes_scope_idx   ON mcc_notes (scope);

-- ── Templates (§16 — V2 surface, schema present in V1) ──────────────────

CREATE TABLE IF NOT EXISTS mcc_templates (
  id           bigserial PRIMARY KEY,
  slug         text NOT NULL UNIQUE,
  title        text NOT NULL,
  description  text NOT NULL DEFAULT '',
  body         text NOT NULL,
  category_id  bigint REFERENCES mcc_categories(id) ON DELETE SET NULL,
  variables    jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- ── Workflows / command chains (§18 — V2 surface, schema present in V1) ─
-- The application displays a workflow step by step. It NEVER runs one.

CREATE TABLE IF NOT EXISTS mcc_workflows (
  id           bigserial PRIMARY KEY,
  slug         text NOT NULL UNIQUE,
  title        text NOT NULL,
  description  text NOT NULL DEFAULT '',
  project_id   bigint REFERENCES mcc_projects(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mcc_workflow_commands (
  workflow_id  bigint NOT NULL REFERENCES mcc_workflows(id) ON DELETE CASCADE,
  command_id   bigint NOT NULL REFERENCES mcc_commands(id)  ON DELETE CASCADE,
  position     integer NOT NULL,
  note         text NOT NULL DEFAULT '',
  PRIMARY KEY (workflow_id, position)
);
CREATE INDEX IF NOT EXISTS mcc_workflow_commands_cmd_idx ON mcc_workflow_commands (command_id);

-- mcc_notes.workflow_id could not be declared as a FK above because
-- mcc_workflows did not exist yet. Add it now, idempotently.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mcc_notes_workflow_id_fkey'
  ) THEN
    ALTER TABLE mcc_notes
      ADD CONSTRAINT mcc_notes_workflow_id_fkey
      FOREIGN KEY (workflow_id) REFERENCES mcc_workflows(id) ON DELETE SET NULL;
  END IF;
END $$;
