# Mythos ERP — migration plan

**Status:** written, **not executed.** No `mythos_erp` database, no role, no
table, no row exists in production. Nothing in this document has been run.
**Date:** 2026-08-22.
**Companion:** `ERP_AUTH_SECURITY_DESIGN.md` §9 (implementation),
`ERP_DATA_MODEL.md` (schema), `ERP_REDESIGN_PLAN.md` (findings).

---

## 0. Two different things called "migration"

They are unrelated and only one of them is real work.

| | What it means | Status |
|---|---|---|
| **Schema migration** | Creating `mythos_erp` and applying `schema.sql` + `schema-auth.sql` | Planned below. Not run. |
| **Legacy data migration** | Moving existing ERP business data into it | **There is nothing to move.** |

**There is no legacy data.** Stage 1 established (`ERP_REDESIGN_PLAN.md` §1.2)
that the ERP never had a database: its PHP endpoints read and wrote JSON files,
and no client, project, invoice or document row exists anywhere. The 127
preserved files are the application, not its data.

This is worth stating plainly because "migrate the ERP data" sounds like the
hard part of this project and it is not a part of it at all. What Stage 5 will
migrate is *modules* — porting each screen onto the authenticated API — not
records.

---

## 1. Blocking prerequisite: the backup does not cover a new database

`/usr/local/sbin/mythos-backup-capture` dumps exactly one database:

```sh
pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc      # line 247
```

`$POSTGRES_DB` is the `idauto-postgres` container's own default. **A
`mythos_erp` database created on that container would not be in any backup.**

Creating a database the backup does not know about means creating data that
silently is not protected — and the way you find out is when you need it. So:

> **Do not run §3 until the capture binary dumps `mythos_erp` as well.**

That is a change to a hardened, reviewed, installed root binary
(PR #75) and therefore its own reviewed change with its own tests — not a line
edited in place during a deployment. Scope of that change:

1. Enumerate databases to dump instead of assuming one.
2. Emit one `-Fc` dump per database, each with its own name and size assertion.
3. Extend `tests/backup-hardening-test.js` to assert both dumps are produced and
   that an empty dump still fails the run.
4. Verify a restore of `mythos_erp` into a throwaway container before relying on
   it — an untested restore is a hope, not a backup.

**This is the gate for the whole plan.** Everything below assumes it is done.

---

## 2. Preconditions

- [ ] §1 complete: backup covers `mythos_erp`, restore verified.
- [ ] Stage 4 implementation reviewed and approved (this is the current gate).
- [ ] `npm install` decision made — `pg` is the only dependency and it is not
      installed on this host today.
- [ ] KDF decision confirmed: scrypt as implemented, or Argon2id if you want the
      native dependency (`ERP_AUTH_SECURITY_DESIGN.md` §9.1).
- [ ] Credentials generated and placed in a `0600` root-owned file. Not in
      shell history, not in the repository, not in a systemd unit body.

Unchanged throughout: PHP stays disabled, nginx keeps `deny all`, ERP stays
loopback-only. **Nothing in this plan exposes `erp.mythosprod.xyz`.**

---

## 3. Provisioning (run once, as the database owner)

Two roles, because the application must not be able to change structure. This
closes the "application is superuser" failure mode before it can be introduced.

```sql
CREATE ROLE erp_owner LOGIN PASSWORD :'owner_pw';
CREATE ROLE erp_app   LOGIN PASSWORD :'app_pw';
CREATE DATABASE mythos_erp OWNER erp_owner;
```

`CREATE DATABASE` cannot run inside a transaction block — it is a separate
statement, not part of the migration file. Then, connected to `mythos_erp`:

```sql
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO erp_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO erp_app;
-- deliberately no DELETE: retirement is deleted_at
GRANT DELETE ON invoice_lines TO erp_app;      -- the ONE exception: lines are replaced wholesale (see schema.sql, 6197ec6)
REVOKE UPDATE, DELETE ON audit_log FROM erp_app;
GRANT INSERT, SELECT ON audit_log TO erp_app;
REVOKE INSERT, UPDATE ON schema_migrations FROM erp_app;   -- only the migration runner (owner) writes the ledger
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO erp_app;
```

The `audit_log` grants are the point: the application can append history and
read it, and **cannot rewrite it.** A compromised application that can edit its
own audit trail has no audit trail.

Extensions `citext` and `pg_trgm` are created by `schema.sql` and require
superuser or `rds_superuser`-equivalent — so §4 runs as `erp_owner` on a
database where those extensions are permitted, which was verified in the
throwaway PG15 instance during Stage 3.

---

## 4. Applying the schema

```sh
cd sites/erp.mythosprod.xyz/api
ERP_DATABASE_URL='postgres://erp_owner:...@127.0.0.1:5432/mythos_erp' \
  node migrations/migrate.js --dry-run     # prints what it would apply
ERP_DATABASE_URL='...' node migrations/migrate.js
```

Applied in order, once each, checksummed:

| Order | File | Contents |
|---|---|---|
| 1 | `db/schema.sql` | 31 tables, 34 FKs, 39 explicit indexes, 22 `updated_at` triggers |
| 2 | `db/schema-auth.sql` | 3 tables, 5 indexes, 1 view, 7 user columns, 6 roles, 28 permissions |
| 3 | `db/schema-tenant.sql` | tenants, tenant_modules, tenant_memberships; `tenant_id` on 24 business tables + `user_roles`; uniqueness re-scoped per tenant; RLS on 29 tables with 30 policies; 3 invoice permissions; tenant #1 seeded |

The runner records a sha256 per file in `schema_migrations`. **A file edited
after being applied is an error, not a silent skip** — the fix is a new
migration, never an edit to an applied one.

The runner also **refuses a connection string pointing at `idauto`,
`mythos_command_center` or `ssangyong`** unless `ERP_ALLOW_PRODUCTION=1`. The
ERP migrates into its own database; an accidental `-f` into an existing one is
exactly the mistake worth making impossible.

### Verification (do not skip)

```sql
-- 38 = 37 from the three schema files + schema_migrations, created by the runner
SELECT count(*) FROM information_schema.tables
  WHERE table_schema='public' AND table_type='BASE TABLE';   -- 38
SELECT count(*) FROM information_schema.views
  WHERE table_schema='public';                               -- 1 (user_effective_permissions)
SELECT count(*) FROM pg_tables WHERE schemaname='public' AND rowsecurity;  -- 37  (29 + prospects + 6 accounting + agenda_events)
SELECT count(*) FROM pg_policies WHERE schemaname='public';               -- 38  (30 + prospects + 6 accounting + agenda_events)
SELECT count(*) FROM roles;        -- 6
SELECT count(*) FROM permissions;  -- 42  (28 + 3 invoices.* + 4 prospects.* (0004) + 4 accounting.* (0005) + 3 agenda.* (0006))
SELECT count(*) FROM tenants;      -- 1   (Mythos Prod, tenant #1)
SELECT count(*) FROM users;        -- 0  ← there must be no seeded account
```

**And the isolation check, which matters more than the counts.** Connected as
`erp_app` with no tenant context:

```sql
SELECT count(*) FROM clients;   -- must be 0, even when rows exist
```

A non-zero answer here means RLS is not applying to the application role —
usually because it was granted ownership — and provisioning must stop.

That last one is the security assertion, not a sanity check. **A fresh ERP has
zero users.** If it has one, something seeded a default account and the
deployment is compromised before it started.

---

## 5. Bootstrapping the first administrator

```sh
node bin/create-super-admin.js      # interactive, at a TTY, once
```

There is no default password and no seeded account. The script refuses to run
when stdin is not a TTY, refuses to create a second `super_admin`, disables
terminal echo, and never accepts the password from `argv` (visible in `ps`) or
from the environment. The password is hashed before insert, and the bootstrap
`user.created` audit row commits in the same transaction as the user.

After this, accounts are created through the authenticated API under
`users.manage`, where it is audited.

---

## 6. Rollback

Rollback is `DROP DATABASE mythos_erp;` plus dropping the two roles. That is
genuinely all of it, and it is safe **only** because of §0: there is no legacy
data, so nothing is lost that did not originate in this database.

This stops being true the moment the first real record is entered. From that
point rollback means restore-from-backup, which is why §1 is a blocker and not
a nice-to-have.

Nothing in this plan touches `idauto`, `mythos_command_center`, the Hub, the
monitor, R2, or nginx. A failed migration leaves the ERP exactly as it is
today: static, loopback-only, 403 in public.

---

## 7. What happens after (Stage 5 — not approved)

Module migration ports each of the 10 module views onto the authenticated API,
one at a time, each ending with its permission boundary asserted in tests. The
order follows dependency, not visual appeal: clients → projects → planning →
production → inventory → documents → finance → reports → settings → users.

**Not to be started until Stage 4 implementation is approved.** A module ported
before the API exists would be wired to the Stage 1 endpoints — the 16 that
required nothing — which is the precise outcome Stage 4 exists to prevent.
