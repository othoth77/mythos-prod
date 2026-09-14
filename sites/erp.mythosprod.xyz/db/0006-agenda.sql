-- 0006-agenda.sql — Agenda module (Phase 10): events, tasks and reminders,
-- tenant-scoped, optionally linked to a client/project/prospect/invoice/quote.
--
-- One table with a `kind` discriminator rather than three: an event, a task
-- and a reminder are the same shape (a title, a time, an optional link, an
-- assignee) with different defaults, and a shared table means one calendar
-- query answers "what is on my agenda" instead of a UNION of three.
--
-- Links are real foreign keys (not a polymorphic pair), so referential
-- integrity is enforced by PostgreSQL, not by application code remembering to
-- check. Applied by api/migrations/migrate.js as erp_owner after 0005.
BEGIN;

CREATE TABLE IF NOT EXISTS agenda_events (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    legacy_id    text,
    kind         text NOT NULL DEFAULT 'event',       -- event | task | reminder
    title        text NOT NULL,
    description  text,
    starts_at    timestamptz NOT NULL,
    ends_at      timestamptz,
    all_day      boolean NOT NULL DEFAULT false,
    location     text,
    status       text NOT NULL DEFAULT 'scheduled',   -- scheduled | done | cancelled
    priority     text NOT NULL DEFAULT 'normal',       -- low | normal | high
    -- Optional links to the resource this item is about. Real FKs: a deleted
    -- client, project, prospect, invoice or quote is impossible to point at,
    -- and dropping one clears the link rather than orphaning the agenda item.
    client_id    uuid REFERENCES clients(id)   ON DELETE SET NULL,
    project_id   uuid REFERENCES projects(id)  ON DELETE SET NULL,
    prospect_id  uuid REFERENCES prospects(id) ON DELETE SET NULL,
    invoice_id   uuid REFERENCES invoices(id)  ON DELETE SET NULL,
    quote_id     uuid REFERENCES quotes(id)    ON DELETE SET NULL,
    assigned_to  uuid REFERENCES users(id),
    remind_at    timestamptz,
    created_by   uuid REFERENCES users(id),
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    deleted_at   timestamptz,
    CONSTRAINT agenda_kind_known     CHECK (kind IN ('event','task','reminder')),
    CONSTRAINT agenda_status_known   CHECK (status IN ('scheduled','done','cancelled')),
    CONSTRAINT agenda_priority_known CHECK (priority IN ('low','normal','high')),
    CONSTRAINT agenda_span           CHECK (ends_at IS NULL OR ends_at >= starts_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS agenda_events_tenant_legacy_key ON agenda_events (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS agenda_events_tenant_idx    ON agenda_events (tenant_id);
CREATE INDEX IF NOT EXISTS agenda_events_starts_idx    ON agenda_events (tenant_id, starts_at);
CREATE INDEX IF NOT EXISTS agenda_events_kind_status_idx ON agenda_events (tenant_id, kind, status);
CREATE INDEX IF NOT EXISTS agenda_events_client_idx    ON agenda_events (client_id);
CREATE INDEX IF NOT EXISTS agenda_events_project_idx   ON agenda_events (project_id);
CREATE INDEX IF NOT EXISTS agenda_events_prospect_idx  ON agenda_events (prospect_id);
CREATE INDEX IF NOT EXISTS agenda_events_invoice_idx   ON agenda_events (invoice_id);
CREATE INDEX IF NOT EXISTS agenda_events_quote_idx     ON agenda_events (quote_id);
CREATE INDEX IF NOT EXISTS agenda_events_assigned_idx  ON agenda_events (tenant_id, assigned_to);
CREATE INDEX IF NOT EXISTS agenda_events_title_trgm    ON agenda_events USING gin (title gin_trgm_ops);

DROP TRIGGER IF EXISTS agenda_events_set_updated_at ON agenda_events;
CREATE TRIGGER agenda_events_set_updated_at BEFORE UPDATE ON agenda_events
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE agenda_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON agenda_events;
CREATE POLICY tenant_isolation ON agenda_events
    USING (tenant_id = current_tenant()) WITH CHECK (tenant_id = current_tenant());

-- Module key: extend the closed vocabulary, enable for every existing tenant.
ALTER TABLE tenant_modules DROP CONSTRAINT IF EXISTS tenant_module_known;
ALTER TABLE tenant_modules ADD CONSTRAINT tenant_module_known CHECK (module_key IN (
    'dashboard','clients','prospects','projects','planning','production','finance',
    'invoices','accounting','agenda','documents','reports','inventory','settings','users','audit'));
INSERT INTO tenant_modules (tenant_id, module_key, enabled)
SELECT id, 'agenda', true FROM tenants ON CONFLICT (tenant_id, module_key) DO NOTHING;

INSERT INTO permissions (key, label) VALUES
  ('agenda.read',   'View the agenda'),
  ('agenda.write',  'Create/edit events, tasks and reminders'),
  ('agenda.delete', 'Retire agenda items')
ON CONFLICT (key) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE (r.key = 'super_admin'    AND p.key LIKE 'agenda.%')
   OR (r.key = 'admin'          AND p.key LIKE 'agenda.%')
   OR (r.key = 'manager'        AND p.key IN ('agenda.read','agenda.write'))
   OR (r.key = 'production_user' AND p.key IN ('agenda.read','agenda.write'))
   OR (r.key = 'finance_user'   AND p.key = 'agenda.read')
   OR (r.key = 'read_only'      AND p.key = 'agenda.read')
ON CONFLICT DO NOTHING;

-- Application role: no DELETE — retirement is deleted_at, same rule as every
-- other business table.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erp_app') THEN
    GRANT SELECT, INSERT, UPDATE ON agenda_events TO erp_app;
  END IF;
END $$;

COMMIT;
