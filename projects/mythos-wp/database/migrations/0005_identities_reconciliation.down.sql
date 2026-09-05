ALTER TABLE wp_inboxes DROP CONSTRAINT IF EXISTS wp_inboxes_heartbeat_domain;
ALTER TABLE wp_inboxes DROP COLUMN IF EXISTS heartbeat_state;
ALTER TABLE wp_inboxes DROP COLUMN IF EXISTS last_heartbeat_at;
ALTER TABLE wp_inbound_events DROP COLUMN IF EXISTS replay_message_id;
ALTER TABLE wp_inbound_events DROP COLUMN IF EXISTS replay_result;
ALTER TABLE wp_inbound_events DROP COLUMN IF EXISTS replayed_at;
ALTER TABLE wp_messages DROP COLUMN IF EXISTS ack_alarm_at;
ALTER TABLE wp_conversation_events DROP COLUMN IF EXISTS event_name;
ALTER TABLE wp_inbound_events DROP COLUMN IF EXISTS event_name;
DROP INDEX IF EXISTS wp_messages_order_idx;
-- contacts without a phone cannot exist under the 0001 rules: give them a placeholder derived from their id (non-destructive)
UPDATE wp_contacts SET wa_id = lpad(id::text, 6, '0') WHERE wa_id IS NULL;
ALTER TABLE wp_contacts DROP CONSTRAINT IF EXISTS wp_contacts_wa_id_digits;
ALTER TABLE wp_contacts ADD CONSTRAINT wp_contacts_wa_id_digits CHECK (wa_id ~ '^[0-9]{6,20}$');
DROP INDEX IF EXISTS wp_contacts_wa_id_uidx;
ALTER TABLE wp_contacts ADD CONSTRAINT wp_contacts_unique UNIQUE (project_id, wa_id);
ALTER TABLE wp_contacts ALTER COLUMN wa_id SET NOT NULL;
DROP TABLE IF EXISTS wp_contact_identities;
DELETE FROM wp_schema_migrations WHERE version = '0005_identities_reconciliation';
