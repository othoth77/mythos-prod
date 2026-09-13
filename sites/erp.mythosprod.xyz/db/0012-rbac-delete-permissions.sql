-- 0012-rbac-delete-permissions.sql — Phase 6 (P0 RBAC hardening).
--
-- Two permission keys that authz.js's deny-by-default map has never had a
-- row for. The generic route loop registers DELETE /collaborators/:id,
-- /representations/:id, /inventory_items/:id and /suppliers/:id, and
-- authz.authorize() refuses every one of them unconditionally
-- ('no_permission_mapping') — for super_admin too — writing a
-- permission.denied audit row each time. Mission orders (0010) declined to
-- expose a retire route for the same reason and documented it. This
-- migration adds the two keys, granted exactly like every other *.delete
-- key in the catalogue (schema-auth.sql: super_admin and admin only), and
-- api/lib/authz.js maps DELETE to them for the production and inventory
-- modules.
--
-- The rank cap on POST /users/roles is code, not schema (api/modules/views.js
-- assignRole) — no permission row changes: admin keeps users.manage and
-- still lacks roles.manage, exactly as schema-auth.sql intends; the cap is
-- what makes that intent hold.
--
-- Additive and idempotent (ON CONFLICT). Reversible: DELETE the two
-- permissions (role_permissions cascades) and drop the two REQUIRE entries.

BEGIN;

INSERT INTO permissions (key, label) VALUES
  ('production.delete', 'Retire production records'),
  ('inventory.delete',  'Retire inventory records')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.key IN ('super_admin', 'admin')
  AND p.key IN ('production.delete', 'inventory.delete')
ON CONFLICT DO NOTHING;

COMMIT;
