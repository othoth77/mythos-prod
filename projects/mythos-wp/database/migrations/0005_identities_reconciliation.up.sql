-- MYTHOS WP — migration 0005: provider contract & event ledger hardening (MYTHOS-COMMS-9, #222)
-- Additive. Existing contacts are preserved: every wa_id / lid becomes an identity row.

-- 1) Contact identities: a customer may carry several provider identifiers (phone, LID, BSUID, …)
CREATE TABLE IF NOT EXISTS wp_contact_identities (
    id            BIGSERIAL    PRIMARY KEY,
    project_id    VARCHAR(64)  NOT NULL REFERENCES wp_projects (id),
    contact_id    BIGINT       NOT NULL REFERENCES wp_contacts (id) ON DELETE CASCADE,
    kind          VARCHAR(16)  NOT NULL,                        -- phone | lid | bsuid | provider_user
    value         VARCHAR(128) NOT NULL,
    provider      VARCHAR(24),                                  -- provider that asserted it (NULL = manual/import)
    verified_at   TIMESTAMPTZ,                                  -- when a provider event confirmed it
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT wp_contact_identities_unique      UNIQUE (project_id, kind, value),
    CONSTRAINT wp_contact_identities_kind_domain CHECK (kind IN ('phone', 'lid', 'bsuid', 'provider_user')),
    CONSTRAINT wp_contact_identities_value_shape CHECK (value ~ '^[A-Za-z0-9._:@+-]{3,128}$')
);
CREATE INDEX IF NOT EXISTS wp_contact_identities_contact_idx ON wp_contact_identities (contact_id);

-- backfill from the phone-keyed model
INSERT INTO wp_contact_identities (project_id, contact_id, kind, value, provider, verified_at)
  SELECT project_id, id, 'phone', wa_id, 'evolution', COALESCE(last_inbound_at, created_at) FROM wp_contacts WHERE wa_id IS NOT NULL
  ON CONFLICT (project_id, kind, value) DO NOTHING;
INSERT INTO wp_contact_identities (project_id, contact_id, kind, value, provider, verified_at)
  SELECT project_id, id, 'lid', lid, 'evolution', COALESCE(last_inbound_at, created_at) FROM wp_contacts WHERE lid IS NOT NULL
  ON CONFLICT (project_id, kind, value) DO NOTHING;

-- 2) wa_id is no longer the sole identity: nullable, still unique when present (compatibility)
ALTER TABLE wp_contacts ALTER COLUMN wa_id DROP NOT NULL;
ALTER TABLE wp_contacts DROP CONSTRAINT IF EXISTS wp_contacts_unique;
CREATE UNIQUE INDEX IF NOT EXISTS wp_contacts_wa_id_uidx ON wp_contacts (project_id, wa_id) WHERE wa_id IS NOT NULL;
ALTER TABLE wp_contacts DROP CONSTRAINT IF EXISTS wp_contacts_wa_id_digits;
ALTER TABLE wp_contacts ADD CONSTRAINT wp_contacts_wa_id_digits CHECK (wa_id IS NULL OR wa_id ~ '^[0-9]{6,20}$');

-- 3) Ordering: provider timestamp first, created_at + id as deterministic tie-breakers
CREATE INDEX IF NOT EXISTS wp_messages_order_idx ON wp_messages (conversation_id, (COALESCE(provider_timestamp, created_at)), created_at, id);

-- 4) Provider-neutral event names in both ledgers (kind stays for compatibility)
ALTER TABLE wp_inbound_events ADD COLUMN IF NOT EXISTS event_name VARCHAR(48);
ALTER TABLE wp_conversation_events ADD COLUMN IF NOT EXISTS event_name VARCHAR(48);
UPDATE wp_conversation_events SET event_name = CASE kind
  WHEN 'message_in' THEN 'message.received' WHEN 'message_out' THEN 'message.sent' WHEN 'send_failed' THEN 'message.failed'
  WHEN 'note' THEN 'message.note' WHEN 'status' THEN 'conversation.updated' WHEN 'assigned' THEN 'conversation.assigned'
  WHEN 'tag' THEN 'conversation.updated' WHEN 'ai_run' THEN 'ai.run' WHEN 'ai_decision' THEN 'ai.decided' WHEN 'handoff' THEN 'handoff.created'
  ELSE 'conversation.updated' END WHERE event_name IS NULL;
UPDATE wp_inbound_events SET event_name = CASE
  WHEN status = 'persisted' AND reason LIKE 'CONNECTION:%' THEN 'inbox.status'
  WHEN status = 'persisted' AND reason LIKE 'STATUS:%' THEN 'message.status'
  WHEN status = 'persisted' THEN 'message.received'
  WHEN status = 'duplicate' THEN 'message.duplicate'
  WHEN status = 'dry_run' THEN 'message.dry_run'
  ELSE 'event.rejected' END WHERE event_name IS NULL;

-- 5) Delivery reconciliation + dead-letter replay + inbox heartbeat
ALTER TABLE wp_messages ADD COLUMN IF NOT EXISTS ack_alarm_at TIMESTAMPTZ;           -- set once when no acknowledgement arrived in time
ALTER TABLE wp_inbound_events ADD COLUMN IF NOT EXISTS replayed_at TIMESTAMPTZ;
ALTER TABLE wp_inbound_events ADD COLUMN IF NOT EXISTS replay_result VARCHAR(80);
ALTER TABLE wp_inbound_events ADD COLUMN IF NOT EXISTS replay_message_id BIGINT REFERENCES wp_messages (id);
ALTER TABLE wp_inboxes ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ;
ALTER TABLE wp_inboxes ADD COLUMN IF NOT EXISTS heartbeat_state VARCHAR(12) NOT NULL DEFAULT 'unknown';
ALTER TABLE wp_inboxes DROP CONSTRAINT IF EXISTS wp_inboxes_heartbeat_domain;
ALTER TABLE wp_inboxes ADD CONSTRAINT wp_inboxes_heartbeat_domain CHECK (heartbeat_state IN ('unknown', 'ok', 'stale', 'unreachable'));
INSERT INTO wp_schema_migrations (version) VALUES ('0005_identities_reconciliation') ON CONFLICT (version) DO NOTHING;
