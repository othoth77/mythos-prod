-- MYTHOS WP — migration 0006: shared WhatsApp account routing & privacy guard (MYTHOS-COMMS-11)
-- Additive. One WhatsApp account = ONE provider instance = ONE session; an instance may now carry
-- several LOGICAL inboxes (one per project/service) when — and only when — it is declared `shared`.
-- The instance identifies the session, never the service: on a shared instance the sender's identity
-- and an explicit routing rule decide the inbox; no rule = DROP before any ledger row (default deny).

-- 1. account_mode: explicit, auditable opt-in. `shared` requires account_ref (no silent bypass).
ALTER TABLE wp_inboxes ADD COLUMN IF NOT EXISTS account_mode VARCHAR(16) NOT NULL DEFAULT 'dedicated';
ALTER TABLE wp_inboxes DROP CONSTRAINT IF EXISTS wp_inboxes_account_mode_domain;
ALTER TABLE wp_inboxes ADD CONSTRAINT wp_inboxes_account_mode_domain CHECK (account_mode IN ('dedicated', 'shared'));
ALTER TABLE wp_inboxes DROP CONSTRAINT IF EXISTS wp_inboxes_shared_needs_account;
ALTER TABLE wp_inboxes ADD CONSTRAINT wp_inboxes_shared_needs_account CHECK (account_mode <> 'shared' OR account_ref IS NOT NULL);
-- composite key so that routes are tied to (inbox, project, provider, instance) at schema level
ALTER TABLE wp_inboxes DROP CONSTRAINT IF EXISTS wp_inboxes_identity_key;
ALTER TABLE wp_inboxes ADD CONSTRAINT wp_inboxes_identity_key UNIQUE (id, project_id, provider, instance);
-- COMMS-1 forbade any inbox on the notification instance. Shared-account mode is the explicit exception:
-- the CHECK is replaced by trigger logic (below) that allows `mythos-bridge` ONLY in `shared` mode.
ALTER TABLE wp_inboxes DROP CONSTRAINT IF EXISTS wp_inboxes_not_bridge;
-- one (provider, instance) may now host several logical inboxes — but only shared ones; dedicated stays 1:1
ALTER TABLE wp_inboxes DROP CONSTRAINT IF EXISTS wp_inboxes_unique;
CREATE UNIQUE INDEX IF NOT EXISTS wp_inboxes_dedicated_uidx ON wp_inboxes (provider, instance) WHERE account_mode = 'dedicated';
CREATE INDEX IF NOT EXISTS wp_inboxes_instance_idx ON wp_inboxes (provider, instance);

-- 2. reserved-account guard, made explicit:
--    * reserved account_ref → allowed only with account_mode='shared' AND settings.allow_personal_account=true (audited)
--    * account_mode='shared' with NULL account_ref → refused (CHECK above; trigger message for clarity)
--    * instance 'mythos-bridge' → allowed only in shared mode
--    * a dedicated inbox may not coexist with other inboxes on the same instance (and vice versa)
CREATE OR REPLACE FUNCTION wp_inboxes_guard() RETURNS trigger AS $$
DECLARE reserved BOOLEAN; optin BOOLEAN; others INT;
BEGIN
  IF NEW.account_mode = 'shared' AND NEW.account_ref IS NULL THEN
    RAISE EXCEPTION 'wp_inboxes_shared_needs_account: a shared-account inbox requires account_ref' USING ERRCODE = '23514', CONSTRAINT = 'wp_inboxes_shared_needs_account';
  END IF;
  IF NEW.instance = 'mythos-bridge' AND NEW.account_mode <> 'shared' THEN
    RAISE EXCEPTION 'wp_inboxes_not_bridge: the notification instance can only host explicit shared-account inboxes' USING ERRCODE = '23514', CONSTRAINT = 'wp_inboxes_not_bridge';
  END IF;
  reserved := NEW.account_ref IS NOT NULL AND EXISTS (SELECT 1 FROM wp_reserved_accounts r WHERE r.account_ref = NEW.account_ref);
  optin := COALESCE((NEW.settings->>'allow_personal_account')::boolean, false);
  IF reserved AND NOT (NEW.account_mode = 'shared' AND optin) THEN
    RAISE EXCEPTION 'wp_inboxes_account_reserved: account is reserved for the MYTHOS notification channel (shared mode + allow_personal_account opt-in required)' USING ERRCODE = '23514', CONSTRAINT = 'wp_inboxes_account_reserved';
  END IF;
  SELECT count(*) INTO others FROM wp_inboxes i WHERE i.provider = NEW.provider AND i.instance = NEW.instance AND i.id IS DISTINCT FROM NEW.id;
  IF others > 0 AND (NEW.account_mode = 'dedicated' OR EXISTS (SELECT 1 FROM wp_inboxes i WHERE i.provider = NEW.provider AND i.instance = NEW.instance AND i.id IS DISTINCT FROM NEW.id AND i.account_mode = 'dedicated')) THEN
    RAISE EXCEPTION 'wp_inboxes_dedicated_uidx: a dedicated inbox owns its instance; several inboxes require account_mode=shared on all of them' USING ERRCODE = '23514', CONSTRAINT = 'wp_inboxes_dedicated_uidx';
  END IF;
  IF reserved AND (TG_OP = 'INSERT' OR OLD.account_mode IS DISTINCT FROM NEW.account_mode OR OLD.account_ref IS DISTINCT FROM NEW.account_ref OR COALESCE((OLD.settings->>'allow_personal_account')::boolean, false) IS DISTINCT FROM optin) THEN
    INSERT INTO wp_audit_events (actor, action, resource, record_id, project_id, next)
      VALUES ('db:wp_inboxes_guard', 'setting', 'inboxes', NEW.id::text, NEW.project_id,
              jsonb_build_object('shared_account_optin', true, 'instance', NEW.instance, 'account_ref_masked', '…' || right(NEW.account_ref, 4), 'account_mode', NEW.account_mode));
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS wp_inboxes_guard_trg ON wp_inboxes;
CREATE TRIGGER wp_inboxes_guard_trg BEFORE INSERT OR UPDATE OF account_ref, account_mode, settings, instance, provider ON wp_inboxes FOR EACH ROW EXECUTE FUNCTION wp_inboxes_guard();

-- 3. routing rules (provider-neutral). A rule binds ONE sender identity on ONE instance to ONE logical inbox.
--    kind: allowlist = routes immediately; opt_in = pre-registered identity that becomes active on its first
--    inbound within the window (optionally requiring a token in the text — the token is never the only boundary).
CREATE TABLE IF NOT EXISTS wp_inbox_routes (
    id             BIGSERIAL    PRIMARY KEY,
    project_id     VARCHAR(64)  NOT NULL REFERENCES wp_projects (id),
    inbox_id       BIGINT       NOT NULL,
    provider       VARCHAR(24)  NOT NULL,
    instance       VARCHAR(64)  NOT NULL,
    kind           VARCHAR(16)  NOT NULL,                           -- allowlist | opt_in
    identity_kind  VARCHAR(16)  NOT NULL,                           -- phone | lid | bsuid | provider_user
    identity_value VARCHAR(128) NOT NULL,
    priority       INT          NOT NULL DEFAULT 100,               -- lower wins
    enabled        BOOLEAN      NOT NULL DEFAULT true,
    opt_in_code   VARCHAR(64),                                     -- optional second factor for opt_in
    expires_at     TIMESTAMPTZ,                                     -- opt_in window; NULL = no expiry
    activated_at   TIMESTAMPTZ,                                     -- first routed inbound (opt_in)
    note           VARCHAR(200),
    created_by     VARCHAR(64)  NOT NULL DEFAULT 'system',
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT wp_inbox_routes_inbox_fk       FOREIGN KEY (inbox_id, project_id, provider, instance) REFERENCES wp_inboxes (id, project_id, provider, instance) ON DELETE CASCADE,
    CONSTRAINT wp_inbox_routes_kind_domain    CHECK (kind IN ('allowlist', 'opt_in')),
    CONSTRAINT wp_inbox_routes_identity_domain CHECK (identity_kind IN ('phone', 'lid', 'bsuid', 'provider_user')),
    CONSTRAINT wp_inbox_routes_value_shape    CHECK (identity_value ~ '^[A-Za-z0-9:_.@+-]{3,128}$'),
    CONSTRAINT wp_inbox_routes_code_shape    CHECK (opt_in_code IS NULL OR opt_in_code ~ '^[A-Za-z0-9-]{6,64}$'),
    CONSTRAINT wp_inbox_routes_priority_range CHECK (priority BETWEEN 0 AND 10000),
    CONSTRAINT wp_inbox_routes_one_target     UNIQUE (provider, instance, identity_kind, identity_value)
);
CREATE INDEX IF NOT EXISTS wp_inbox_routes_lookup_idx ON wp_inbox_routes (provider, instance, identity_kind, identity_value) WHERE enabled;
-- the account owner and any reserved account can never be routed as a customer
CREATE OR REPLACE FUNCTION wp_inbox_routes_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.identity_kind = 'phone' AND (EXISTS (SELECT 1 FROM wp_reserved_accounts r WHERE r.account_ref = NEW.identity_value)
     OR EXISTS (SELECT 1 FROM wp_inboxes i WHERE i.id = NEW.inbox_id AND i.account_ref = NEW.identity_value)) THEN
    RAISE EXCEPTION 'wp_inbox_routes_owner_excluded: the account owner / a reserved account cannot be routed as a customer' USING ERRCODE = '23514', CONSTRAINT = 'wp_inbox_routes_owner_excluded';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS wp_inbox_routes_guard_trg ON wp_inbox_routes;
CREATE TRIGGER wp_inbox_routes_guard_trg BEFORE INSERT OR UPDATE ON wp_inbox_routes FOR EACH ROW EXECUTE FUNCTION wp_inbox_routes_guard();

-- 4. privacy-guard audit: NO content, NO identifiers. Hashes only (payload + salted identity), the decision and its reason.
CREATE TABLE IF NOT EXISTS wp_routing_drops (
    id              BIGSERIAL    PRIMARY KEY,
    at              TIMESTAMPTZ  NOT NULL DEFAULT now(),
    provider        VARCHAR(24)  NOT NULL,
    instance        VARCHAR(64)  NOT NULL,
    decision        VARCHAR(16)  NOT NULL,                          -- drop
    reason          VARCHAR(48)  NOT NULL,                          -- UNROUTED | OWNER_EXCLUDED | ROUTING_AMBIGUOUS | RULE_MALFORMED | …
    identity_sha256 CHAR(64),                                       -- sha256(kind ':' value ':' instance) — correlatable, not reversible
    payload_sha256  CHAR(64),
    CONSTRAINT wp_routing_drops_decision_domain CHECK (decision IN ('drop'))
);
CREATE INDEX IF NOT EXISTS wp_routing_drops_at_idx ON wp_routing_drops (at DESC);
INSERT INTO wp_schema_migrations (version) VALUES ('0006_shared_account_routing') ON CONFLICT (version) DO NOTHING;
