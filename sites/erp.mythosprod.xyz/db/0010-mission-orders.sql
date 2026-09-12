-- 0010-mission-orders.sql — Phase 4 (P1 Mission Orders / "Ordres de Mission").
--
-- Discovery evidence (legacy repo root, js/shared/mission-orders.js +
-- index.html's #view-om-list/#view-om-new): the legacy "Ordre de Mission" is
-- a vehicle/driver dispatch sheet, NOT a client- or project-linked document.
-- It has no client_id, no project_id, no representation_id, no amount, no
-- approval workflow, no numbering scheme (legacy used `'om_' + Date.now()`
-- as its only identifier) — and none of those fields are invented here,
-- exactly matching what the legacy evidence supports and nothing more.
--
-- What it DOES carry, faithfully reproduced: a driver (name, CIN, driving
-- licence), a vehicle plate, a mission type (round trip / one way), a
-- mission description, departure/arrival locations and times, an optional
-- roster of passengers for a printed signature sheet, and whether to render
-- the tenant's stamp on the printout.
--
-- Architecture: a new dedicated table, not a repurposing of `projects` (the
-- `-- legacy mp_oms (ordres de mission)` comment on `projects` in schema.sql
-- is stale — the current `projects` schema has none of these fields and is
-- already a live, unrelated entity) and not an `agenda_events` row (its kind
-- enum is closed to event/task/reminder and its shape has no vehicle/driver/
-- passenger structure). `driver_id` optionally links to the existing
-- `collaborators` table (reuse, not a duplicate personnel entity) while
-- `driver_name`/`driver_cin`/`driver_license` are kept as plain fields on the
-- row — exactly as legacy stored them — since a mission's driver credentials
-- are a fact about that trip, not something that should force a hard
-- dependency on collaborator record hygiene. `passengers` is a small JSONB
-- roster (name only, no signature data stored) rather than a child table:
-- there is nothing to compute or query per passenger, only a list to print,
-- so a child table would be complexity without benefit — the same reasoning
-- 0008's own header used for not giving purchases a lines table.
--
-- Module: reuses the EXISTING 'production' module and its already-seeded
-- production.read/production.write permissions (production_user role
-- already holds both) — the same gate collaborators/representations already
-- share. No new tenant_modules key, no new permission, no new role.
--
-- No accounting effect, no invoice/payment link: this is an operational
-- document only, per Step 7's own instruction not to create accounting
-- entries merely because a document exists.

BEGIN;

CREATE TABLE mission_orders (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id          uuid NOT NULL REFERENCES tenants(id),
    driver_id          uuid REFERENCES collaborators(id),
    driver_name        text NOT NULL,
    driver_cin         text,
    driver_license     text,
    vehicle_plate      text NOT NULL,
    mission_type       text NOT NULL DEFAULT 'aller_retour',
    mission            text NOT NULL,
    departure_location text NOT NULL,
    arrival_location   text NOT NULL,
    starts_at          timestamptz NOT NULL,
    ends_at            timestamptz,
    add_stamp          boolean NOT NULL DEFAULT false,
    passengers         jsonb NOT NULL DEFAULT '[]'::jsonb,
    notes              text,
    created_by         uuid REFERENCES users(id),
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    deleted_at         timestamptz,
    CONSTRAINT mission_orders_type_known CHECK (mission_type IN ('aller_retour', 'aller_simple')),
    CONSTRAINT mission_orders_dates_ordered CHECK (ends_at IS NULL OR ends_at >= starts_at),
    CONSTRAINT mission_orders_passengers_is_array CHECK (jsonb_typeof(passengers) = 'array')
);

CREATE INDEX mission_orders_tenant_idx ON mission_orders (tenant_id);
CREATE INDEX mission_orders_starts_at_idx ON mission_orders (starts_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX mission_orders_driver_idx ON mission_orders (driver_id) WHERE driver_id IS NOT NULL;

ALTER TABLE mission_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON mission_orders
    USING (tenant_id = current_tenant())
    WITH CHECK (tenant_id = current_tenant());

CREATE TRIGGER mission_orders_set_updated_at BEFORE UPDATE ON mission_orders
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- The blanket "GRANT ... ON ALL TABLES IN SCHEMA public" in schema.sql only
-- covered tables that existed at the time it ran — every migration since
-- has granted its own new table explicitly (0004, 0006); this does the same.
-- Guarded exactly like 0004/0006: the throwaway test drills create erp_app
-- AFTER running migrations, so an unconditional GRANT here would fail in
-- rehearsal/CI even though it must run unconditionally-in-effect in
-- production, where the role already exists.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erp_app') THEN
    GRANT SELECT, INSERT, UPDATE ON mission_orders TO erp_app;
  END IF;
END $$;

COMMIT;
