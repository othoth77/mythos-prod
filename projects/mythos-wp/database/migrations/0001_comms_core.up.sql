-- =============================================================================
-- MYTHOS WP — migration 0001: Communication Core foundation (MYTHOS-COMMS-1, #197)
-- projects/mythos-wp/database/migrations/0001_comms_core.up.sql
--
-- Adds the conversational model of the MYTHOS Communication OS (Issue #196,
-- Option D) to the panel database. Everything is additive and idempotent.
--
-- Ownership: every row belongs to ONE wp_projects row (project_id). An inbox
-- is one provider instance (Evolution instance name) of one project; the
-- notification instance `mythos-bridge` is never an inbox (enforced by CHECK).
--
-- Privacy rules (schema.sql "Design rules" extended):
--   - no provider secret, token, session or key column exists anywhere;
--   - the only WhatsApp identifiers stored are the customer's digits (wa_id),
--     the WhatsApp LID when the provider sends one, and provider message ids;
--   - media BYTES are never stored in the database: wp_message_attachments
--     holds metadata and a storage reference only;
--   - wp_messages.raw is the provider payload MINUS credentials (the receiver
--     strips `apikey`/`token`-shaped keys before insert; the test enforces it);
--   - retention: wp_messages.redacted_at marks a purged body (text and raw are
--     nulled, the row and its metadata stay so counters and analytics
--     reconcile). Retention windows are business rules
--     (wp_business_rules key `comms.retention`), applied by an owner-run job —
--     never automatically deleted by the receiver.
-- =============================================================================

CREATE TABLE IF NOT EXISTS wp_schema_migrations (
    version     VARCHAR(64)  PRIMARY KEY,
    applied_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- One provider instance of one project ("inbox" in Chatwoot's sense).
CREATE TABLE IF NOT EXISTS wp_inboxes (
    id               BIGSERIAL    PRIMARY KEY,
    project_id       VARCHAR(64)  NOT NULL REFERENCES wp_projects (id),
    provider         VARCHAR(24)  NOT NULL DEFAULT 'evolution',      -- evolution | meta_cloud (future)
    instance         VARCHAR(64)  NOT NULL,                          -- provider instance name (Evolution) / phone number id (Cloud API)
    display_name     VARCHAR(120) NOT NULL,
    phone_masked     VARCHAR(32),                                    -- '***' + last digits of the business number, display only
    status           VARCHAR(16)  NOT NULL DEFAULT 'inactive',       -- inactive | pairing | open | closed | error
    inbound_enabled  BOOLEAN      NOT NULL DEFAULT false,            -- receiver persists traffic for this inbox
    outbound_enabled BOOLEAN      NOT NULL DEFAULT false,            -- human replies may be sent from this inbox
    last_event_at    TIMESTAMPTZ,
    last_error       VARCHAR(200),
    settings         JSONB        NOT NULL DEFAULT '{}'::jsonb,      -- non-secret provider settings (events subscribed, media policy)
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT wp_inboxes_unique          UNIQUE (provider, instance),
    CONSTRAINT wp_inboxes_provider_domain CHECK (provider IN ('evolution', 'meta_cloud')),
    CONSTRAINT wp_inboxes_status_domain   CHECK (status IN ('inactive', 'pairing', 'open', 'closed', 'error')),
    CONSTRAINT wp_inboxes_not_bridge      CHECK (instance <> 'mythos-bridge')
);
CREATE INDEX IF NOT EXISTS wp_inboxes_project_idx ON wp_inboxes (project_id);

CREATE TABLE IF NOT EXISTS wp_contacts (
    id               BIGSERIAL    PRIMARY KEY,
    project_id       VARCHAR(64)  NOT NULL REFERENCES wp_projects (id),
    wa_id            VARCHAR(20)  NOT NULL,                          -- customer MSISDN, digits only
    lid              VARCHAR(32),                                    -- WhatsApp LID when known (digits)
    display_name     VARCHAR(120),                                   -- pushName as last seen; editable
    language         CHAR(2),
    status           VARCHAR(16)  NOT NULL DEFAULT 'active',         -- active | blocked | merged
    merged_into_id   BIGINT       REFERENCES wp_contacts (id),
    source           VARCHAR(24)  NOT NULL DEFAULT 'inbound',        -- inbound | manual | import
    notes            TEXT,
    memory           JSONB        NOT NULL DEFAULT '{}'::jsonb,      -- structured customer context (vehicle, preferences) — never free-form secrets
    first_seen_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    last_seen_at     TIMESTAMPTZ,
    last_inbound_at  TIMESTAMPTZ,
    last_outbound_at TIMESTAMPTZ,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT wp_contacts_unique         UNIQUE (project_id, wa_id),
    CONSTRAINT wp_contacts_wa_id_digits   CHECK (wa_id ~ '^[0-9]{6,20}$'),
    CONSTRAINT wp_contacts_lid_digits     CHECK (lid IS NULL OR lid ~ '^[0-9]{6,32}$'),
    CONSTRAINT wp_contacts_status_domain  CHECK (status IN ('active', 'blocked', 'merged')),
    CONSTRAINT wp_contacts_language       CHECK (language IS NULL OR language IN ('fr', 'ar', 'en'))
);
CREATE INDEX IF NOT EXISTS wp_contacts_project_seen_idx ON wp_contacts (project_id, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS wp_contacts_lid_idx ON wp_contacts (project_id, lid) WHERE lid IS NOT NULL;

CREATE TABLE IF NOT EXISTS wp_conversations (
    id               BIGSERIAL    PRIMARY KEY,
    project_id       VARCHAR(64)  NOT NULL REFERENCES wp_projects (id),
    inbox_id         BIGINT       NOT NULL REFERENCES wp_inboxes (id),
    contact_id       BIGINT       NOT NULL REFERENCES wp_contacts (id),
    provider_chat_id VARCHAR(64)  NOT NULL,                          -- remoteJid digits (1:1 chat); groups are refused upstream
    status           VARCHAR(20)  NOT NULL DEFAULT 'open',           -- open | pending | waiting_customer | needs_human | resolved | archived
    priority         SMALLINT     NOT NULL DEFAULT 0,                -- 0 normal … 3 urgent
    assigned_to      VARCHAR(64),                                    -- panel username
    team             VARCHAR(64),
    unread_count     INTEGER      NOT NULL DEFAULT 0,
    language         CHAR(2),
    last_intent      VARCHAR(40),
    summary          TEXT,                                           -- short operator/AI summary, never the full transcript
    last_message_at  TIMESTAMPTZ,
    last_inbound_at  TIMESTAMPTZ,
    last_outbound_at TIMESTAMPTZ,
    first_reply_at   TIMESTAMPTZ,
    waiting_since    TIMESTAMPTZ,
    resolved_at      TIMESTAMPTZ,
    resolved_by      VARCHAR(64),
    metadata         JSONB        NOT NULL DEFAULT '{}'::jsonb,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT wp_conversations_status_domain CHECK (status IN ('open', 'pending', 'waiting_customer', 'needs_human', 'resolved', 'archived')),
    CONSTRAINT wp_conversations_priority      CHECK (priority BETWEEN 0 AND 3),
    CONSTRAINT wp_conversations_unread        CHECK (unread_count >= 0),
    CONSTRAINT wp_conversations_language      CHECK (language IS NULL OR language IN ('fr', 'ar', 'en'))
);
-- at most ONE live conversation per contact and inbox (Chatwoot pattern: resolve to start another)
CREATE UNIQUE INDEX IF NOT EXISTS wp_conversations_live_uidx ON wp_conversations (inbox_id, contact_id)
    WHERE status NOT IN ('resolved', 'archived');
CREATE INDEX IF NOT EXISTS wp_conversations_inbox_list_idx ON wp_conversations (project_id, status, last_message_at DESC);
CREATE INDEX IF NOT EXISTS wp_conversations_contact_idx    ON wp_conversations (contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS wp_conversations_assignee_idx   ON wp_conversations (project_id, assigned_to) WHERE assigned_to IS NOT NULL;

CREATE TABLE IF NOT EXISTS wp_messages (
    id                   BIGSERIAL    PRIMARY KEY,
    project_id           VARCHAR(64)  NOT NULL REFERENCES wp_projects (id),
    conversation_id      BIGINT       NOT NULL REFERENCES wp_conversations (id),
    contact_id           BIGINT       NOT NULL REFERENCES wp_contacts (id),
    inbox_id             BIGINT       NOT NULL REFERENCES wp_inboxes (id),
    direction            VARCHAR(8)   NOT NULL,                      -- in | out | activity
    provider             VARCHAR(24)  NOT NULL DEFAULT 'evolution',
    provider_message_id  VARCHAR(128),                               -- WhatsApp key.id; NULL only for activity rows
    message_type         VARCHAR(16)  NOT NULL DEFAULT 'text',       -- text | image | audio | video | document | sticker | location | contact | reaction | other
    text                 TEXT,                                       -- message body (or caption); NULL after retention purge
    quoted_provider_message_id VARCHAR(128),
    sender_kind          VARCHAR(12)  NOT NULL,                      -- customer | user | ai | system
    sender_ref           VARCHAR(64),                                -- panel username, 'ai:<run id>' or component name
    status               VARCHAR(12)  NOT NULL DEFAULT 'received',   -- received | queued | sent | delivered | read | failed
    error                VARCHAR(200),
    provider_timestamp   TIMESTAMPTZ,                                -- messageTimestamp as sent by the provider
    raw                  JSONB,                                      -- provider payload WITHOUT credentials; NULL after purge
    ai_run_id            BIGINT,                                     -- set on outbound rows produced from a suggestion (FK added below)
    redacted_at          TIMESTAMPTZ,                                -- retention purge marker
    created_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT wp_messages_direction_domain CHECK (direction IN ('in', 'out', 'activity')),
    CONSTRAINT wp_messages_type_domain      CHECK (message_type IN ('text', 'image', 'audio', 'video', 'document', 'sticker', 'location', 'contact', 'reaction', 'other')),
    CONSTRAINT wp_messages_sender_domain    CHECK (sender_kind IN ('customer', 'user', 'ai', 'system')),
    CONSTRAINT wp_messages_status_domain    CHECK (status IN ('received', 'queued', 'sent', 'delivered', 'read', 'failed')),
    CONSTRAINT wp_messages_provider_id_req  CHECK (direction = 'activity' OR provider_message_id IS NOT NULL)
);
-- exactly-once persistence: one provider message id per inbox
CREATE UNIQUE INDEX IF NOT EXISTS wp_messages_provider_uidx ON wp_messages (inbox_id, provider_message_id)
    WHERE provider_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS wp_messages_timeline_idx ON wp_messages (conversation_id, created_at, id);
CREATE INDEX IF NOT EXISTS wp_messages_project_idx  ON wp_messages (project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS wp_message_attachments (
    id                 BIGSERIAL    PRIMARY KEY,
    message_id         BIGINT       NOT NULL REFERENCES wp_messages (id) ON DELETE CASCADE,
    kind               VARCHAR(16)  NOT NULL,                        -- image | audio | video | document | sticker
    mime_type          VARCHAR(120),
    size_bytes         BIGINT,
    sha256             CHAR(64),
    file_name          VARCHAR(255),
    storage_ref        VARCHAR(255),                                 -- opaque reference into the controlled media store (never a public URL)
    status             VARCHAR(12)  NOT NULL DEFAULT 'pending',      -- pending | stored | failed | purged
    scan_status        VARCHAR(12)  NOT NULL DEFAULT 'none',         -- none | clean | rejected
    transcript         TEXT,                                         -- voice → text (Phase 13)
    extracted_text     TEXT,                                         -- document → text (Phase 13)
    vision_summary     JSONB,                                        -- image → structured facts (Phase 13)
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT wp_attachments_kind_domain   CHECK (kind IN ('image', 'audio', 'video', 'document', 'sticker')),
    CONSTRAINT wp_attachments_status_domain CHECK (status IN ('pending', 'stored', 'failed', 'purged')),
    CONSTRAINT wp_attachments_scan_domain   CHECK (scan_status IN ('none', 'clean', 'rejected')),
    CONSTRAINT wp_attachments_size          CHECK (size_bytes IS NULL OR size_bytes >= 0)
);
CREATE INDEX IF NOT EXISTS wp_attachments_message_idx ON wp_message_attachments (message_id);

-- Append-only journal: assignment, status, tags, AI decisions, handoffs, sends.
CREATE TABLE IF NOT EXISTS wp_conversation_events (
    id               BIGSERIAL    PRIMARY KEY,
    project_id       VARCHAR(64)  NOT NULL REFERENCES wp_projects (id),
    conversation_id  BIGINT       NOT NULL REFERENCES wp_conversations (id),
    at               TIMESTAMPTZ  NOT NULL DEFAULT now(),
    kind             VARCHAR(32)  NOT NULL,                          -- message_in | message_out | status | assigned | tag | ai_run | handoff | note | send_failed | …
    actor            VARCHAR(64)  NOT NULL,                          -- username, 'ai', 'receiver', 'system:<component>'
    payload          JSONB        NOT NULL DEFAULT '{}'::jsonb       -- redacted before write; never message bodies of other conversations
);
CREATE INDEX IF NOT EXISTS wp_conv_events_conv_idx    ON wp_conversation_events (conversation_id, at);
CREATE INDEX IF NOT EXISTS wp_conv_events_project_idx ON wp_conversation_events (project_id, kind, at DESC);

CREATE TABLE IF NOT EXISTS wp_tags (
    id           BIGSERIAL    PRIMARY KEY,
    project_id   VARCHAR(64)  NOT NULL REFERENCES wp_projects (id),
    name         VARCHAR(48)  NOT NULL,
    color        VARCHAR(7),                                         -- #rrggbb
    applies_to   VARCHAR(12)  NOT NULL DEFAULT 'both',               -- contact | conversation | both
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT wp_tags_unique        UNIQUE (project_id, name),
    CONSTRAINT wp_tags_name_shape    CHECK (name ~ '^[a-z0-9][a-z0-9_.-]{0,47}$'),
    CONSTRAINT wp_tags_color_shape   CHECK (color IS NULL OR color ~ '^#[0-9a-fA-F]{6}$'),
    CONSTRAINT wp_tags_applies_domain CHECK (applies_to IN ('contact', 'conversation', 'both'))
);
CREATE TABLE IF NOT EXISTS wp_contact_tags (
    contact_id   BIGINT       NOT NULL REFERENCES wp_contacts (id) ON DELETE CASCADE,
    tag_id       BIGINT       NOT NULL REFERENCES wp_tags (id) ON DELETE CASCADE,
    added_by     VARCHAR(64)  NOT NULL,
    added_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (contact_id, tag_id)
);
CREATE TABLE IF NOT EXISTS wp_conversation_tags (
    conversation_id BIGINT     NOT NULL REFERENCES wp_conversations (id) ON DELETE CASCADE,
    tag_id          BIGINT     NOT NULL REFERENCES wp_tags (id) ON DELETE CASCADE,
    added_by        VARCHAR(64) NOT NULL,
    added_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (conversation_id, tag_id)
);

-- One AI execution over one inbound message. Stores DECISIONS and metrics,
-- never the raw prompt (prompt_version + prompt_hash identify the versioned
-- template in Git) and never a credential.
CREATE TABLE IF NOT EXISTS wp_ai_runs (
    id               BIGSERIAL    PRIMARY KEY,
    project_id       VARCHAR(64)  NOT NULL REFERENCES wp_projects (id),
    conversation_id  BIGINT       NOT NULL REFERENCES wp_conversations (id),
    message_id       BIGINT       REFERENCES wp_messages (id),        -- the inbound message that triggered the run
    kind             VARCHAR(16)  NOT NULL DEFAULT 'suggest',        -- suggest | auto_reply | classify | transcribe | vision | summarize
    model            VARCHAR(64),
    prompt_version   VARCHAR(32),
    prompt_hash      CHAR(64),
    inputs_hash      CHAR(64),
    facts_used       JSONB,                                          -- ids/names of verified facts the ports returned (never the prompt text)
    intent           VARCHAR(40),
    language         CHAR(2),
    confidence       NUMERIC(4,3),
    decision         VARCHAR(16)  NOT NULL DEFAULT 'none',           -- none | suggest | auto_reply | handoff
    policy_result    JSONB,                                          -- gates evaluated and their outcome
    status           VARCHAR(12)  NOT NULL DEFAULT 'ok',             -- ok | error | skipped
    error            VARCHAR(200),
    latency_ms       INTEGER,
    input_tokens     INTEGER,
    output_tokens    INTEGER,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT wp_ai_runs_kind_domain     CHECK (kind IN ('suggest', 'auto_reply', 'classify', 'transcribe', 'vision', 'summarize')),
    CONSTRAINT wp_ai_runs_decision_domain CHECK (decision IN ('none', 'suggest', 'auto_reply', 'handoff')),
    CONSTRAINT wp_ai_runs_status_domain   CHECK (status IN ('ok', 'error', 'skipped')),
    CONSTRAINT wp_ai_runs_confidence      CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
    CONSTRAINT wp_ai_runs_language        CHECK (language IS NULL OR language IN ('fr', 'ar', 'en'))
);
CREATE INDEX IF NOT EXISTS wp_ai_runs_conv_idx    ON wp_ai_runs (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS wp_ai_runs_project_idx ON wp_ai_runs (project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS wp_ai_suggestions (
    id               BIGSERIAL    PRIMARY KEY,
    run_id           BIGINT       NOT NULL REFERENCES wp_ai_runs (id) ON DELETE CASCADE,
    conversation_id  BIGINT       NOT NULL REFERENCES wp_conversations (id),
    rank             SMALLINT     NOT NULL DEFAULT 1,
    text             TEXT         NOT NULL,
    status           VARCHAR(12)  NOT NULL DEFAULT 'proposed',       -- proposed | accepted | edited | rejected | sent | expired
    decided_by       VARCHAR(64),
    decided_at       TIMESTAMPTZ,
    edited_text      TEXT,
    sent_message_id  BIGINT       REFERENCES wp_messages (id),
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT wp_ai_suggestions_status_domain CHECK (status IN ('proposed', 'accepted', 'edited', 'rejected', 'sent', 'expired')),
    CONSTRAINT wp_ai_suggestions_rank          CHECK (rank >= 1)
);
CREATE INDEX IF NOT EXISTS wp_ai_suggestions_conv_idx ON wp_ai_suggestions (conversation_id, status, created_at DESC);

-- late FK: outbound message ← the run that produced it
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wp_messages_ai_run_fk') THEN
    ALTER TABLE wp_messages ADD CONSTRAINT wp_messages_ai_run_fk FOREIGN KEY (ai_run_id) REFERENCES wp_ai_runs (id);
  END IF;
END $$;

-- existing handoff queue ← the conversation it belongs to (nullable: manual entries keep working)
ALTER TABLE wp_handoffs ADD COLUMN IF NOT EXISTS conversation_id BIGINT REFERENCES wp_conversations (id);
CREATE INDEX IF NOT EXISTS wp_handoffs_conversation_idx ON wp_handoffs (conversation_id) WHERE conversation_id IS NOT NULL;

INSERT INTO wp_schema_migrations (version) VALUES ('0001_comms_core') ON CONFLICT (version) DO NOTHING;
