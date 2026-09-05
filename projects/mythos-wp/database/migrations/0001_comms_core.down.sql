-- MYTHOS WP — migration 0001 rollback (reverse order; drops ONLY what 0001 created)
ALTER TABLE wp_handoffs DROP COLUMN IF EXISTS conversation_id;
ALTER TABLE wp_messages DROP CONSTRAINT IF EXISTS wp_messages_ai_run_fk;
DROP TABLE IF EXISTS wp_ai_suggestions;
DROP TABLE IF EXISTS wp_ai_runs;
DROP TABLE IF EXISTS wp_conversation_tags;
DROP TABLE IF EXISTS wp_contact_tags;
DROP TABLE IF EXISTS wp_tags;
DROP TABLE IF EXISTS wp_conversation_events;
DROP TABLE IF EXISTS wp_message_attachments;
DROP TABLE IF EXISTS wp_messages;
DROP TABLE IF EXISTS wp_conversations;
DROP TABLE IF EXISTS wp_contacts;
DROP TABLE IF EXISTS wp_inboxes;
DELETE FROM wp_schema_migrations WHERE version = '0001_comms_core';
