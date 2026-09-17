-- =============================================================================
-- MYTHOS WP — migration 0007: MYTHOS WP V2 — Central Control Center
-- projects/mythos-wp/database/migrations/0007_control_center.up.sql
--
-- Additive and idempotent. Turns the panel into the multi-project,
-- multi-WhatsApp, AI-enabled control platform:
--   1. users & RBAC in the database (owner|admin|manager|agent|viewer) with
--      project-level access (wp_user_projects); the 0600 users file remains
--      the bootstrap / break-glass source and is imported once.
--   2. WhatsApp business accounts + phone numbers as first-class entities;
--      wp_inboxes becomes the PROJECT ↔ PHONE NUMBER link (many-to-many:
--      one number may carry several logical inboxes = several projects).
--   3. routing rules gain entry-point ('keyword') and 'default' kinds so a
--      business number shared by several projects routes deterministically
--      (identity rule > sticky conversation > keyword > default > drop).
--   4. AI agents as platform entities (wp_agents) bound to projects and,
--      optionally, to one number (wp_project_agents); tools are named.
--   5. templates, integrations, automations (+ runs), health checks, notes.
--   6. handoff history carries direction and previous AI state.
-- No column ever holds a secret: credentials are referenced by the NAME of an
-- environment variable / file path variable, never by value.
-- =============================================================================

-- 1. users / RBAC -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wp_users (
    username      VARCHAR(32)  PRIMARY KEY,
    display_name  VARCHAR(120),
    role          VARCHAR(16)  NOT NULL DEFAULT 'viewer',          -- owner | admin | manager | agent | viewer
    scrypt        VARCHAR(256) NOT NULL,                            -- "N,r,p$salt$hash" (auth.js) — a hash, not a secret value
    status        VARCHAR(12)  NOT NULL DEFAULT 'active',          -- active | disabled
    all_projects  BOOLEAN      NOT NULL DEFAULT false,             -- owner/admin see everything regardless
    last_login_at TIMESTAMPTZ,
    created_by    VARCHAR(64),
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT wp_users_name_shape   CHECK (username ~ '^[a-z][a-z0-9._-]{1,31}$'),
    CONSTRAINT wp_users_role_domain  CHECK (role IN ('owner', 'admin', 'manager', 'agent', 'viewer')),
    CONSTRAINT wp_users_status_domain CHECK (status IN ('active', 'disabled'))
);
CREATE TABLE IF NOT EXISTS wp_user_projects (
    username    VARCHAR(32)  NOT NULL REFERENCES wp_users (username) ON DELETE CASCADE,
    project_id  VARCHAR(64)  NOT NULL REFERENCES wp_projects (id) ON DELETE CASCADE,
    role        VARCHAR(16),                                        -- optional per-project override (manager|agent|viewer)
    added_by    VARCHAR(64),
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (username, project_id),
    CONSTRAINT wp_user_projects_role_domain CHECK (role IS NULL OR role IN ('manager', 'agent', 'viewer'))
);

-- 2. projects: description + settings; catalogue columns become optional
ALTER TABLE wp_projects ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE wp_projects ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}'::jsonb;   -- { kitchen: '<integration key>', default_agent_id, timezone, … } non-secret
ALTER TABLE wp_projects DROP CONSTRAINT IF EXISTS wp_projects_catalog_required;                 -- WP no longer owns a catalogue: automotive projects read a Kitchen
ALTER TABLE wp_projects DROP CONSTRAINT IF EXISTS wp_projects_kind_domain;
ALTER TABLE wp_projects ADD CONSTRAINT wp_projects_kind_domain CHECK (kind IN ('automotive', 'service', 'internal', 'other'));

-- 3. WhatsApp business accounts and phone numbers ------------------------------
CREATE TABLE IF NOT EXISTS wp_wa_accounts (
    id             BIGSERIAL    PRIMARY KEY,
    provider       VARCHAR(24)  NOT NULL DEFAULT 'evolution',      -- evolution | meta_cloud
    external_ref   VARCHAR(64),                                     -- Meta Business / WABA id (not a secret) or 'evolution:<host>'
    display_name   VARCHAR(120) NOT NULL,
    business_name  VARCHAR(120),
    status         VARCHAR(16)  NOT NULL DEFAULT 'active',         -- active | disabled
    meta           JSONB        NOT NULL DEFAULT '{}'::jsonb,      -- non-secret facts (verification status, tier…)
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT wp_wa_accounts_provider_domain CHECK (provider IN ('evolution', 'meta_cloud')),
    CONSTRAINT wp_wa_accounts_status_domain   CHECK (status IN ('active', 'disabled')),
    CONSTRAINT wp_wa_accounts_unique          UNIQUE (provider, external_ref)
);
CREATE TABLE IF NOT EXISTS wp_phone_numbers (
    id               BIGSERIAL    PRIMARY KEY,
    account_id       BIGINT       REFERENCES wp_wa_accounts (id) ON DELETE SET NULL,
    provider         VARCHAR(24)  NOT NULL DEFAULT 'evolution',
    instance         VARCHAR(64)  NOT NULL,                         -- Evolution instance name / Cloud API phone_number_id
    phone_ref        VARCHAR(32),                                   -- digits of the business number (customers write to it; not a secret)
    display_name     VARCHAR(120) NOT NULL,
    status           VARCHAR(16)  NOT NULL DEFAULT 'unknown',       -- unknown | inactive | pairing | open | closed | error
    is_personal      BOOLEAN      NOT NULL DEFAULT false,           -- personal / notification account: identity-only routing, no keyword, no default
    health_state     VARCHAR(16)  NOT NULL DEFAULT 'unknown',       -- ok | warning | error | disconnected | unknown
    health_detail    VARCHAR(200),
    last_health_at   TIMESTAMPTZ,
    webhook_state    VARCHAR(16)  NOT NULL DEFAULT 'unknown',       -- ok | missing | mismatch | disabled | unknown
    webhook_detail   VARCHAR(200),
    last_event_at    TIMESTAMPTZ,
    settings         JSONB        NOT NULL DEFAULT '{}'::jsonb,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT wp_phone_numbers_unique          UNIQUE (provider, instance),
    CONSTRAINT wp_phone_numbers_provider_domain CHECK (provider IN ('evolution', 'meta_cloud')),
    CONSTRAINT wp_phone_numbers_instance_shape  CHECK (instance ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
    CONSTRAINT wp_phone_numbers_phone_shape     CHECK (phone_ref IS NULL OR phone_ref ~ '^[0-9]{6,32}$'),
    CONSTRAINT wp_phone_numbers_status_domain   CHECK (status IN ('unknown', 'inactive', 'pairing', 'open', 'closed', 'error')),
    CONSTRAINT wp_phone_numbers_health_domain   CHECK (health_state IN ('ok', 'warning', 'error', 'disconnected', 'unknown')),
    CONSTRAINT wp_phone_numbers_webhook_domain  CHECK (webhook_state IN ('ok', 'missing', 'mismatch', 'disabled', 'unknown'))
);
-- wp_inboxes = PROJECT ↔ PHONE NUMBER link (+ per-link switches). Backfill one number per distinct (provider, instance).
ALTER TABLE wp_inboxes ADD COLUMN IF NOT EXISTS phone_number_id BIGINT REFERENCES wp_phone_numbers (id);
INSERT INTO wp_phone_numbers (provider, instance, phone_ref, display_name, status, is_personal)
  SELECT DISTINCT ON (i.provider, i.instance) i.provider, i.instance, i.account_ref, i.display_name,
         CASE WHEN i.status IN ('inactive','pairing','open','closed','error') THEN i.status ELSE 'unknown' END,
         EXISTS (SELECT 1 FROM wp_reserved_accounts r WHERE r.account_ref = i.account_ref)
  FROM wp_inboxes i ORDER BY i.provider, i.instance, i.id
  ON CONFLICT (provider, instance) DO NOTHING;
UPDATE wp_inboxes i SET phone_number_id = p.id FROM wp_phone_numbers p WHERE p.provider = i.provider AND p.instance = i.instance AND i.phone_number_id IS NULL;
CREATE INDEX IF NOT EXISTS wp_inboxes_phone_idx ON wp_inboxes (phone_number_id);
-- inbox-level agent binding lives in wp_project_agents (below); keep a default per inbox for routing display
ALTER TABLE wp_inboxes ADD COLUMN IF NOT EXISTS ai_mode VARCHAR(12) NOT NULL DEFAULT 'inherit';   -- inherit | off | suggest | auto
ALTER TABLE wp_inboxes DROP CONSTRAINT IF EXISTS wp_inboxes_ai_mode_domain;
ALTER TABLE wp_inboxes ADD CONSTRAINT wp_inboxes_ai_mode_domain CHECK (ai_mode IN ('inherit', 'off', 'suggest', 'auto'));

-- 4. routing: entry-point and default rules ------------------------------------
ALTER TABLE wp_inbox_routes DROP CONSTRAINT IF EXISTS wp_inbox_routes_kind_domain;
ALTER TABLE wp_inbox_routes ADD CONSTRAINT wp_inbox_routes_kind_domain CHECK (kind IN ('allowlist', 'opt_in', 'keyword', 'default'));
ALTER TABLE wp_inbox_routes DROP CONSTRAINT IF EXISTS wp_inbox_routes_identity_domain;
ALTER TABLE wp_inbox_routes ADD CONSTRAINT wp_inbox_routes_identity_domain CHECK (identity_kind IN ('phone', 'lid', 'bsuid', 'provider_user', 'entry', 'any'));
ALTER TABLE wp_inbox_routes DROP CONSTRAINT IF EXISTS wp_inbox_routes_value_shape;
ALTER TABLE wp_inbox_routes ADD CONSTRAINT wp_inbox_routes_value_shape CHECK (identity_value ~ '^[A-Za-z0-9:_.@+*#-]{1,128}$');
-- routing decision on the conversation (auditable): mode + rule at open time
ALTER TABLE wp_conversations ADD COLUMN IF NOT EXISTS routed_by VARCHAR(16);                 -- dedicated | rule | sticky | keyword | default | manual
ALTER TABLE wp_conversations ADD COLUMN IF NOT EXISTS route_rule_id BIGINT;
ALTER TABLE wp_conversations ADD COLUMN IF NOT EXISTS handler VARCHAR(8) NOT NULL DEFAULT 'ai';   -- ai | human  (who currently answers)
ALTER TABLE wp_conversations DROP CONSTRAINT IF EXISTS wp_conversations_handler_domain;
ALTER TABLE wp_conversations ADD CONSTRAINT wp_conversations_handler_domain CHECK (handler IN ('ai', 'human'));
ALTER TABLE wp_conversations ADD COLUMN IF NOT EXISTS agent_id BIGINT;                        -- AI agent serving this conversation (FK below)

-- 5. AI agents -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wp_agents (
    id             BIGSERIAL    PRIMARY KEY,
    slug           VARCHAR(64)  NOT NULL UNIQUE,
    name           VARCHAR(120) NOT NULL,
    description    TEXT,
    status         VARCHAR(12)  NOT NULL DEFAULT 'active',         -- active | paused | archived
    mode           VARCHAR(12)  NOT NULL DEFAULT 'suggest',        -- off | suggest | auto   (auto = policy-gated automatic replies)
    engine         VARCHAR(16)  NOT NULL DEFAULT 'engine-173',     -- engine-173 (deterministic, no network) | llm (free-LLM pool + tools, fact-guarded)
    model          VARCHAR(64),                                    -- preferred model id (llm engine); NULL = pool default
    system_prompt  TEXT,                                           -- persona / instructions (llm engine); never a credential
    language       CHAR(2)      NOT NULL DEFAULT 'fr',
    tools          TEXT[]       NOT NULL DEFAULT '{}',              -- tool ids from the registry (kitchen.search, kitchen.quote, knowledge.lookup, handoff.request, …)
    knowledge      BOOLEAN      NOT NULL DEFAULT true,             -- may use wp_knowledge (allowed_for_auto_reply) of the project
    confidence_min NUMERIC(4,3) NOT NULL DEFAULT 0.800,            -- auto mode: below this → suggest only
    settings       JSONB        NOT NULL DEFAULT '{}'::jsonb,      -- { max_replies_per_hour, greeting, handoff_keywords[] … }
    created_by     VARCHAR(64),
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT wp_agents_slug_shape      CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
    CONSTRAINT wp_agents_status_domain   CHECK (status IN ('active', 'paused', 'archived')),
    CONSTRAINT wp_agents_mode_domain     CHECK (mode IN ('off', 'suggest', 'auto')),
    CONSTRAINT wp_agents_engine_domain   CHECK (engine IN ('engine-173', 'llm')),
    CONSTRAINT wp_agents_language_domain CHECK (language IN ('fr', 'ar', 'en')),
    CONSTRAINT wp_agents_confidence      CHECK (confidence_min >= 0 AND confidence_min <= 1)
);
CREATE TABLE IF NOT EXISTS wp_project_agents (
    id          BIGSERIAL    PRIMARY KEY,
    agent_id    BIGINT       NOT NULL REFERENCES wp_agents (id) ON DELETE CASCADE,
    project_id  VARCHAR(64)  NOT NULL REFERENCES wp_projects (id) ON DELETE CASCADE,
    inbox_id    BIGINT       REFERENCES wp_inboxes (id) ON DELETE CASCADE,   -- NULL = every number of the project
    priority    INT          NOT NULL DEFAULT 100,                            -- lower wins
    enabled     BOOLEAN      NOT NULL DEFAULT true,
    added_by    VARCHAR(64),
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS wp_project_agents_uidx ON wp_project_agents (agent_id, project_id, COALESCE(inbox_id, 0));
CREATE INDEX IF NOT EXISTS wp_project_agents_project_idx ON wp_project_agents (project_id, priority);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wp_conversations_agent_fk') THEN
    ALTER TABLE wp_conversations ADD CONSTRAINT wp_conversations_agent_fk FOREIGN KEY (agent_id) REFERENCES wp_agents (id) ON DELETE SET NULL;
  END IF;
END $$;
ALTER TABLE wp_ai_runs ADD COLUMN IF NOT EXISTS agent_id BIGINT REFERENCES wp_agents (id) ON DELETE SET NULL;
ALTER TABLE wp_ai_runs ADD COLUMN IF NOT EXISTS tools_used JSONB;                              -- [{ tool, ok, ms }] names only
ALTER TABLE wp_ai_runs DROP CONSTRAINT IF EXISTS wp_ai_runs_kind_domain;
ALTER TABLE wp_ai_runs ADD CONSTRAINT wp_ai_runs_kind_domain CHECK (kind IN ('suggest', 'auto_reply', 'classify', 'transcribe', 'vision', 'summarize', 'test'));

-- 6. handoff history: direction + previous state --------------------------------
ALTER TABLE wp_handoffs ADD COLUMN IF NOT EXISTS direction VARCHAR(16) NOT NULL DEFAULT 'ai_to_human';   -- ai_to_human | human_to_ai
ALTER TABLE wp_handoffs ADD COLUMN IF NOT EXISTS taken_by VARCHAR(64);
ALTER TABLE wp_handoffs ADD COLUMN IF NOT EXISTS taken_at TIMESTAMPTZ;
ALTER TABLE wp_handoffs ADD COLUMN IF NOT EXISTS previous_state JSONB;                        -- { handler, agent_id, status, last_intent, last_run_id }
ALTER TABLE wp_handoffs DROP CONSTRAINT IF EXISTS wp_handoffs_direction_domain;
ALTER TABLE wp_handoffs ADD CONSTRAINT wp_handoffs_direction_domain CHECK (direction IN ('ai_to_human', 'human_to_ai'));

-- 7. templates ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wp_templates (
    id                   BIGSERIAL    PRIMARY KEY,
    project_id           VARCHAR(64)  REFERENCES wp_projects (id) ON DELETE CASCADE,   -- NULL = shared across projects
    phone_number_id      BIGINT       REFERENCES wp_phone_numbers (id) ON DELETE SET NULL,
    name                 VARCHAR(120) NOT NULL,
    language             VARCHAR(8)   NOT NULL DEFAULT 'fr',
    category             VARCHAR(16)  NOT NULL DEFAULT 'UTILITY',   -- MARKETING | UTILITY | AUTHENTICATION
    status               VARCHAR(12)  NOT NULL DEFAULT 'draft',     -- draft | pending | approved | rejected | paused
    header               VARCHAR(200),
    body                 TEXT         NOT NULL,
    footer               VARCHAR(200),
    variables            JSONB        NOT NULL DEFAULT '[]'::jsonb, -- [{ name, example }]
    buttons              JSONB        NOT NULL DEFAULT '[]'::jsonb,
    provider             VARCHAR(24),                               -- meta_cloud when synced; NULL = local (text sent verbatim by unofficial providers)
    provider_template_id VARCHAR(64),
    rejection_reason     VARCHAR(400),
    last_synced_at       TIMESTAMPTZ,
    created_by           VARCHAR(64),
    updated_by           VARCHAR(64),
    created_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT wp_templates_name_shape      CHECK (name ~ '^[a-z0-9_]{1,120}$'),
    CONSTRAINT wp_templates_category_domain CHECK (category IN ('MARKETING', 'UTILITY', 'AUTHENTICATION')),
    CONSTRAINT wp_templates_status_domain   CHECK (status IN ('draft', 'pending', 'approved', 'rejected', 'paused')),
    CONSTRAINT wp_templates_body_not_blank  CHECK (length(trim(body)) > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS wp_templates_uidx ON wp_templates (COALESCE(project_id, ''), name, language);

-- 8. integrations + health checks ------------------------------------------------
CREATE TABLE IF NOT EXISTS wp_integrations (
    id               BIGSERIAL    PRIMARY KEY,
    key              VARCHAR(64)  NOT NULL UNIQUE,                 -- 'evolution', 'kitchen-mythos-auto', 'n8n', 'meta-cloud-api', 'meta-whatsapp-business-mcp', 'mythos-mcp', …
    kind             VARCHAR(24)  NOT NULL,                        -- whatsapp_provider | kitchen | n8n | mcp | api | project_system | database
    name             VARCHAR(120) NOT NULL,
    project_id       VARCHAR(64)  REFERENCES wp_projects (id) ON DELETE SET NULL,   -- NULL = platform-wide
    base_url         VARCHAR(255),                                 -- non-secret location (loopback or https)
    credential_env   VARCHAR(64),                                  -- NAME of the env var holding the credential / credential file path — never the value
    config           JSONB        NOT NULL DEFAULT '{}'::jsonb,    -- non-secret configuration (endpoints, scopes, tool namespace…)
    status           VARCHAR(12)  NOT NULL DEFAULT 'enabled',      -- enabled | disabled
    health_state     VARCHAR(16)  NOT NULL DEFAULT 'unknown',      -- ok | warning | error | disconnected | unknown
    health_detail    VARCHAR(300),
    credentials_state VARCHAR(16) NOT NULL DEFAULT 'unknown',      -- present | missing | not_required | unknown
    last_ok_at       TIMESTAMPTZ,
    last_error       VARCHAR(300),
    last_checked_at  TIMESTAMPTZ,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT wp_integrations_key_shape     CHECK (key ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
    CONSTRAINT wp_integrations_kind_domain   CHECK (kind IN ('whatsapp_provider', 'kitchen', 'n8n', 'mcp', 'api', 'project_system', 'database', 'llm')),
    CONSTRAINT wp_integrations_status_domain CHECK (status IN ('enabled', 'disabled')),
    CONSTRAINT wp_integrations_health_domain CHECK (health_state IN ('ok', 'warning', 'error', 'disconnected', 'unknown')),
    CONSTRAINT wp_integrations_cred_domain   CHECK (credentials_state IN ('present', 'missing', 'not_required', 'unknown')),
    CONSTRAINT wp_integrations_env_shape     CHECK (credential_env IS NULL OR credential_env ~ '^[A-Z][A-Z0-9_]{2,62}$')
);
CREATE TABLE IF NOT EXISTS wp_health_checks (
    id           BIGSERIAL    PRIMARY KEY,
    component    VARCHAR(64)  NOT NULL,                            -- 'database', 'whatsapp:evolution', 'number:<instance>', 'integration:<key>', 'ai', 'receiver', 'backend'
    status       VARCHAR(16)  NOT NULL,                            -- ok | warning | error | disconnected
    detail       JSONB        NOT NULL DEFAULT '{}'::jsonb,        -- non-secret facts (latency, version, reason)
    duration_ms  INTEGER,
    checked_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT wp_health_checks_status_domain CHECK (status IN ('ok', 'warning', 'error', 'disconnected'))
);
CREATE INDEX IF NOT EXISTS wp_health_checks_component_idx ON wp_health_checks (component, checked_at DESC);
CREATE INDEX IF NOT EXISTS wp_health_checks_at_idx ON wp_health_checks (checked_at DESC);

-- 9. automations ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wp_automations (
    id          BIGSERIAL    PRIMARY KEY,
    project_id  VARCHAR(64)  REFERENCES wp_projects (id) ON DELETE CASCADE,   -- NULL = every project
    name        VARCHAR(120) NOT NULL,
    trigger     VARCHAR(32)  NOT NULL,                             -- conversation.created | message.received | conversation.inactive | handoff.requested
    conditions  JSONB        NOT NULL DEFAULT '{}'::jsonb,         -- { keywords: [], inbox_id, handler, status, inactive_minutes }
    actions     JSONB        NOT NULL DEFAULT '[]'::jsonb,         -- [{ type: assign_agent|assign_user|tag|set_status|handoff|ai_suggest|ai_reply|n8n_webhook|note, … }]
    enabled     BOOLEAN      NOT NULL DEFAULT true,
    position    INT          NOT NULL DEFAULT 100,
    created_by  VARCHAR(64),
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT wp_automations_trigger_domain CHECK (trigger IN ('conversation.created', 'message.received', 'conversation.inactive', 'handoff.requested'))
);
CREATE TABLE IF NOT EXISTS wp_automation_runs (
    id               BIGSERIAL    PRIMARY KEY,
    automation_id    BIGINT       REFERENCES wp_automations (id) ON DELETE SET NULL,
    project_id       VARCHAR(64),
    conversation_id  BIGINT,
    trigger          VARCHAR(32)  NOT NULL,
    result           VARCHAR(12)  NOT NULL,                        -- ok | skipped | error
    detail           JSONB        NOT NULL DEFAULT '{}'::jsonb,    -- actions executed, reasons — no message text
    at               TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT wp_automation_runs_result_domain CHECK (result IN ('ok', 'skipped', 'error'))
);
CREATE INDEX IF NOT EXISTS wp_automation_runs_at_idx ON wp_automation_runs (at DESC);
CREATE INDEX IF NOT EXISTS wp_automation_runs_conv_idx ON wp_automation_runs (conversation_id);

-- 10. internal notes (contacts, projects; conversation notes stay activity messages) ------
CREATE TABLE IF NOT EXISTS wp_notes (
    id           BIGSERIAL    PRIMARY KEY,
    project_id   VARCHAR(64)  REFERENCES wp_projects (id) ON DELETE CASCADE,
    target_kind  VARCHAR(16)  NOT NULL,                            -- contact | conversation | project
    target_id    VARCHAR(64)  NOT NULL,
    author       VARCHAR(64)  NOT NULL,
    body         TEXT         NOT NULL,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT wp_notes_kind_domain CHECK (target_kind IN ('contact', 'conversation', 'project')),
    CONSTRAINT wp_notes_body        CHECK (length(trim(body)) > 0 AND length(body) <= 8000)
);
CREATE INDEX IF NOT EXISTS wp_notes_target_idx ON wp_notes (target_kind, target_id, created_at DESC);

-- 11. audit: wider action vocabulary is enforced in code (audit.js ACTIONS); column stays VARCHAR(24)
INSERT INTO wp_schema_migrations (version) VALUES ('0007_control_center') ON CONFLICT (version) DO NOTHING;
