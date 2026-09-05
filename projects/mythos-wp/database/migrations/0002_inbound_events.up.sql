-- MYTHOS WP — migration 0002: receiver ledger (MYTHOS-COMMS-2, #202)
-- One row per webhook delivery the receiver looked at: idempotency trail,
-- replay source and dead-letter. `payload` is kept ONLY for failed/rejected
-- deliveries, already stripped of credentials and media keys; successful
-- deliveries keep just the hash (the message row holds the redacted raw).
CREATE TABLE IF NOT EXISTS wp_inbound_events (
    id                   BIGSERIAL    PRIMARY KEY,
    provider             VARCHAR(24)  NOT NULL DEFAULT 'evolution',
    instance             VARCHAR(64),
    inbox_id             BIGINT       REFERENCES wp_inboxes (id),
    event                VARCHAR(48)  NOT NULL,
    provider_message_id  VARCHAR(128),
    status               VARCHAR(12)  NOT NULL,                      -- persisted | duplicate | dry_run | ignored | rejected | failed
    reason               VARCHAR(80),
    message_id           BIGINT       REFERENCES wp_messages (id),
    payload_sha256       CHAR(64),
    payload              JSONB,                                      -- dead-letter copy (redacted) for rejected/failed only
    attempts             INTEGER      NOT NULL DEFAULT 1,
    received_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    processed_at         TIMESTAMPTZ,
    CONSTRAINT wp_inbound_events_status_domain CHECK (status IN ('persisted', 'duplicate', 'dry_run', 'ignored', 'rejected', 'failed'))
);
CREATE INDEX IF NOT EXISTS wp_inbound_events_instance_idx ON wp_inbound_events (instance, received_at DESC);
CREATE INDEX IF NOT EXISTS wp_inbound_events_status_idx   ON wp_inbound_events (status, received_at DESC) WHERE status IN ('failed', 'rejected');
INSERT INTO wp_schema_migrations (version) VALUES ('0002_inbound_events') ON CONFLICT (version) DO NOTHING;
