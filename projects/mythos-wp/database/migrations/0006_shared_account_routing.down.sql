-- MYTHOS WP — migration 0006 down: shared WhatsApp account routing (MYTHOS-COMMS-11)
-- Non-destructive for COMMS-1..9 data. Fails if shared inboxes exist (they would violate the restored 1:1 rule).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM wp_inboxes WHERE account_mode = 'shared') THEN
    RAISE EXCEPTION 'shared-account inboxes exist; remove them before rolling back 0006';
  END IF;
END $$;
DROP TABLE IF EXISTS wp_routing_drops;
DROP TRIGGER IF EXISTS wp_inbox_routes_guard_trg ON wp_inbox_routes;
DROP FUNCTION IF EXISTS wp_inbox_routes_guard();
DROP TABLE IF EXISTS wp_inbox_routes;
DROP TRIGGER IF EXISTS wp_inboxes_guard_trg ON wp_inboxes;
CREATE OR REPLACE FUNCTION wp_inboxes_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.account_ref IS NOT NULL AND EXISTS (SELECT 1 FROM wp_reserved_accounts r WHERE r.account_ref = NEW.account_ref) THEN
    RAISE EXCEPTION 'account is reserved for the MYTHOS notification channel' USING ERRCODE = '23514', CONSTRAINT = 'wp_inboxes_account_reserved';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER wp_inboxes_guard_trg BEFORE INSERT OR UPDATE OF account_ref ON wp_inboxes FOR EACH ROW EXECUTE FUNCTION wp_inboxes_guard();
DROP INDEX IF EXISTS wp_inboxes_dedicated_uidx;
DROP INDEX IF EXISTS wp_inboxes_instance_idx;
ALTER TABLE wp_inboxes ADD CONSTRAINT wp_inboxes_unique UNIQUE (provider, instance);
ALTER TABLE wp_inboxes ADD CONSTRAINT wp_inboxes_not_bridge CHECK (instance <> 'mythos-bridge');
ALTER TABLE wp_inboxes DROP CONSTRAINT IF EXISTS wp_inboxes_identity_key;
ALTER TABLE wp_inboxes DROP CONSTRAINT IF EXISTS wp_inboxes_shared_needs_account;
ALTER TABLE wp_inboxes DROP CONSTRAINT IF EXISTS wp_inboxes_account_mode_domain;
ALTER TABLE wp_inboxes DROP COLUMN IF EXISTS account_mode;
DELETE FROM wp_schema_migrations WHERE version = '0006_shared_account_routing';
