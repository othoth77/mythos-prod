-- MYTHOS WP — migration 0003: human outbound (MYTHOS-COMMS-5, #209)
-- client_ref = idempotency key chosen by the sender (UI/API); one per conversation.
ALTER TABLE wp_messages ADD COLUMN IF NOT EXISTS client_ref VARCHAR(64);
CREATE UNIQUE INDEX IF NOT EXISTS wp_messages_client_ref_uidx ON wp_messages (conversation_id, client_ref) WHERE client_ref IS NOT NULL;
ALTER TABLE wp_messages ADD COLUMN IF NOT EXISTS attempts SMALLINT NOT NULL DEFAULT 0;
-- outbound rows are created before the provider assigns an id: only INBOUND rows must carry one
ALTER TABLE wp_messages DROP CONSTRAINT IF EXISTS wp_messages_provider_id_req;
ALTER TABLE wp_messages ADD CONSTRAINT wp_messages_provider_id_req CHECK (direction <> 'in' OR provider_message_id IS NOT NULL);
INSERT INTO wp_schema_migrations (version) VALUES ('0003_outbound') ON CONFLICT (version) DO NOTHING;
