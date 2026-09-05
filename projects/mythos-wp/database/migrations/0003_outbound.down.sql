DROP INDEX IF EXISTS wp_messages_client_ref_uidx;
ALTER TABLE wp_messages DROP CONSTRAINT IF EXISTS wp_messages_provider_id_req;
ALTER TABLE wp_messages ADD CONSTRAINT wp_messages_provider_id_req CHECK (direction = 'activity' OR provider_message_id IS NOT NULL);
ALTER TABLE wp_messages DROP COLUMN IF EXISTS client_ref;
ALTER TABLE wp_messages DROP COLUMN IF EXISTS attempts;
DELETE FROM wp_schema_migrations WHERE version = '0003_outbound';
