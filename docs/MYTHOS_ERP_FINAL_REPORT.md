# Mythos ERP — final report

**Date:** 2026-08-23
**Branches:** `feat/erp-redesign` @ `b073989`, `feat/backup-multi-db` @ `709fd2d`
**Remote HEAD (main):** `92d83ab` — **neither branch is merged**

---

## FINAL VERDICT: BLOCKED

The ERP engine is built, tested and verified. It is **not in production**, and
it cannot be, because merging to `main` is denied by the environment's
permission classifier. That single authorization gates Stage 1B (install the
hardened backup, provision `mythos_erp`), Stage 7 (final backup verification)
and Stage 8 (controlled exposure).

Claiming anything else would misrepresent the state. Nothing here is
operational; everything here is ready.

**Existing Mythos production is unaffected and healthy** — verified below. No
ERP work degraded any other service.

---

## 1. Executive summary

The order was to complete the ERP as a multi-tenant platform. Auditing the
approved Stage 3/4 baseline against that brief found they were **incompatible**:
Stage 3 designed a single-tenant ERP — 34 tables, zero tenant columns,
`invoices.number` globally unique, roles granted globally.

That conflict was resolved before anything was provisioned, which is the whole
value of having caught it: retrofitting tenancy onto a populated ERP means
rewriting every table and every unique constraint while real invoices sit in
them. Nothing had been created yet, so it cost one migration instead of a
project.

Delivered: a multi-tenant ERP engine with database-enforced isolation, a
tenant-aware API boundary, 16 resource modules plus invoices, dashboard,
reports, settings, users and audit, and 256 assertions across four suites —
138 of them against real PostgreSQL over real HTTP with two tenants.

Also delivered, as the Stage 0 gate: explicit multi-database backup coverage,
which on audit revealed that **three production databases have never been
backed up at all**.

## 2. Final architecture

```
nginx (deny-all today)
   │
   ├── app/            static SPA shell, design system, hash router
   └── api/            Node + pg, no framework
         │
         ├── lib/pipeline.js   authenticate → resolve tenant → module gate →
         │                     authorize → validate → execute → audit
         ├── lib/db.js         tenant transactions; RLS GUC set per request
         ├── lib/resource.js   declarative CRUD; column allowlists
         ├── lib/auth|authz|audit|tokens|password|tenancy
         └── modules/          registry (16 resources), invoices, views
         │
         └── PostgreSQL 15 — mythos_erp
               38 tables · 29 with RLS · 30 policies · 6 roles · 31 permissions
```

2487 lines of API code, 993 lines of migrations. Dependencies: `pg`. Everything
else is Node builtins.

## 3. Multi-tenant architecture

**Shared schema + `tenant_id` + PostgreSQL Row-Level Security.** Chosen over
database-per-tenant (every tenant would need its own backup allowlist entry — a
tenant added without one is a tenant with no backup) and schema-per-tenant
(migrations multiply; `search_path` bugs are silent).

The decisive property is **fail-closed**:

```sql
CREATE POLICY tenant_isolation ON clients
  USING (tenant_id = current_tenant()) WITH CHECK (tenant_id = current_tenant());
```

With no tenant context, `current_tenant()` is NULL, every policy evaluates to
NULL, and **no rows are visible**. A forgotten tenant returns nothing rather
than everything. `WITH CHECK` closes the write side, so a forged `tenant_id` in
a request body is refused by PostgreSQL, not by a validator someone might skip.

`erp_app` owns nothing, so RLS applies to it in full. `erp_owner` owns the
tables and bypasses RLS by ownership — it is the migration and restore
identity and must never be the application's credential.

Uniqueness was re-scoped per tenant across 22 constraints. A global
`invoices.number` is both a functional bug and an information leak: Company B
cannot issue `2026-001` because Company A did, and the violation *tells* B that
someone already used it.

## 4. Central identity compatibility

```
MYTHOS ID → User ─┬─ Company A → roles/permissions
                  ├─ Company B → roles/permissions
                  └─ Company C → roles/permissions
```

- `users` stays global, with `identity_source` and a unique `external_subject`
  for a future provider. `password_hash` may be NULL for federated accounts —
  a case the schema already permitted.
- `tenant_memberships` joins user to company.
- `user_roles` is `(user_id, tenant_id, role_id)`, so one person can be admin
  in A and read-only in B. **Proven in the acceptance suite.**

**Not built:** the identity platform itself. No SSO, no token exchange, no
central directory. Building it now would be inventing requirements. What exists
is the shape that accepts it without a rewrite.

## 5. Modules implemented

| Module | State |
|---|---|
| M1 Dashboard | 7 aggregates, tenant-scoped |
| M2 Clients | clients, contacts |
| M3 Projects | projects, contracts |
| M4 Planning | appointments |
| M5 Production | representations, collaborators |
| M6 Finance | quotes, purchases, expenses, bank accounts |
| M7 Invoices | full — lines, VAT per line, payments, status, numbering |
| M8 Documents | list/read only — **upload not built** |
| M9 Reports | revenue, receivables, expenses |
| M10 Inventory | items, suppliers |
| M11 Settings | branding, invoice identity, module enablement |
| — Users, Audit | membership list, role assignment, audit read |

102 routes. Modules are enabled per tenant and enforced at the API: a tenant
without Reports gets **404 by URL**, not a hidden menu item.

**Invoices** carry the rules that matter: totals computed from lines and never
accepted from the client (the legacy ERP totalled in the browser, which is
where the reconciliation drift came from); numbers claimed with
`UPDATE ... RETURNING` inside the request transaction so concurrent creation
cannot collide; numbering per tenant; status follows payments, and a client
cannot declare an invoice paid; a paid invoice cannot be edited.

## 6. PostgreSQL architecture

38 base tables, 1 view, 29 RLS-enabled tables, 30 policies, 44 explicit
indexes, 22 `updated_at` triggers, money as `numeric(14,3)` throughout (the
dinar has 1000 millimes; float would be wrong in a way that only surfaces in
reconciliation). Nothing is ever hard-deleted — `deleted_at` retires a row, and
the application role has no `DELETE` on business tables.

Three migrations, checksummed by a runner that refuses a file edited after it
was applied and refuses a production connection string without an explicit
override.

## 7. Authentication

scrypt at OWASP parameters (N=2^17, r=8, p=1) — **a stated deviation** from the
designed Argon2id, because Argon2id needs a native module and every other piece
of Mythos server code runs on builtins alone. Hashes are self-describing,
`password_algo` records the KDF, and `needsRehash()` already drives transparent
upgrade, so switching later is a branch in `verify()`, not a redesign.

256-bit tokens stored as sha256; `__Host-` prefixed, Secure, HttpOnly,
SameSite cookies; CSRF on every unsafe verb; 8h idle / 12h absolute session
lifetimes; lockout after 5 failures, exponential and capped at 1h; IP
throttling; a 200 ms response floor closing the timing oracle that response
bodies alone leave open. No default password: the first super admin is created
interactively at a TTY, never from argv or the environment.

## 8. Authorization

6 roles, 31 permissions, resolved per `(user, tenant)`. Deny by default: an
unknown module or unmapped verb has no permission key and is refused — adding a
module without declaring its permissions fails closed, which is exactly how the
missing `invoices.*` keys were caught.

## 9. Audit log

29-action taxonomy enforced by a database CHECK. Append-only for the
application role, which holds INSERT and SELECT and neither UPDATE nor DELETE —
a compromised application cannot rewrite its own history. An unaudited state
change is not expressible: the pipeline runs unsafe verbs in a transaction and
throws if the handler returns no audit descriptor, so the audit row commits
with the change or neither does. Denials are audited too, including
cross-tenant attempts.

## 10. Backup architecture

`MYTHOS_BACKUP_DB_LIST` — an explicit allowlist, intersected with a root-side
`ALLOWED_DATABASES` constant (the config may be owned by `deploy`, which is not
in the docker group; without the constant, editing the config would make root
dump any database and hand it over). A listed-but-absent database fails the
run. Cluster globals via `pg_dumpall --globals-only --no-role-passwords`, with
the redaction verified rather than trusted.

**Audit finding, unrelated to the ERP and more serious than it:**
`mythos_command_center` (9.1 MB), `ssangyong_autos` (9.2 MB, 346 products) and
`mythos_command_center_test` have **never been backed up**. Only `idauto` was.
The capability to cover them now exists; adding them to the production config
is an operator decision and has not been made unilaterally.

## 11. R2 verification

Unchanged and still working — the adapter was not touched, so R2 compatibility
is preserved by construction. Verified read-only against the live remote with
the new code: the existing production set verifies (exit 0), and
`--require-database mythos_erp` correctly **fails** it (exit 2). That is the
gate working, and today's honest answer.

## 12. Restore drill

`ops/backup/restore-drill.sh` — 26/26. Real capture against a throwaway
PostgreSQL 15 → 3 dumps + globals → stage → verify → **source databases and
roles dropped** → restored: 34 tables, 28 permissions, 6 roles, 17 client rows
and the view all back, with `erp_app` able to append to `audit_log` and still
unable to rewrite it.

This proves restorability, which `restore-verify` never did — it checks bytes,
not loadability.

## 13. Security audit

`tests/erp-security-test.js`, 59 assertions: SQL injection through search, sort
and filter; mass assignment of `tenant_id`, `id`, `storage_key`; IDOR (a
foreign row is 404, indistinguishable from a random uuid); session replay after
logout; forged session and CSRF tokens; privilege escalation; oversized and
malformed bodies; response headers; error-message leakage; database least
privilege.

**12 injected security defects, 12 caught** — after two fixes: the suite did
not test tenant forging at all (it was relying on the acceptance suite for the
single most important control), and the first `tenant_id` mutation was inert
because `pick()` already strips undeclared fields.

Open: no upload path, no MFA, `erp_owner` bypasses RLS by ownership.

## 14. Monitoring

**Not done.** The ERP probe is not in `probes.json`, because there is nothing
running to probe. It must be added before Stage 8 — the order requires the
probe active *before* exposure, and that ordering is correct.

## 15. Production deployment

**Not performed.** No `mythos_erp` database, no `erp_*` roles, no service unit,
no nginx change. The API has never been started outside a test.

## 16. URLs

| URL | Status |
|---|---|
| mythosprod.xyz | 200 |
| os.mythosprod.xyz | 302 |
| ordre.mythosprod.xyz | 200 |
| status.mythosprod.xyz | 200 |
| erp.mythosprod.xyz | **403 — deny-all intact, as required** |

nginx active, **0 failed units**, backup timer active, memory 65%, swap 1325 MB,
disk 74%.

## 17. Tests

| Suite | Assertions | Kind |
|---|---|---|
| `erp-acceptance-test.js` | 79 | real PostgreSQL + HTTP, two tenants |
| `erp-security-test.js` | 59 | real PostgreSQL + HTTP, attack cases |
| `erp-4-auth-test.js` | 118 | unit, injected fakes |
| `backup-multi-db-test.js` | 90 | unit + static |
| `restore-drill.sh` | 26 | real containers, end to end |
| **Total** | **372** | |

Mutation-verified: 34/34 (auth), 23/23 (backup), 12/12 (security).
Pre-existing backup suites: 421 assertions, all still passing.

## 18. Git commits

`feat/erp-redesign`: `b073989`, `907b901`, `329f58b`, `6b1dad1`, `c08d3c1`,
`c588fa2`, `a67522b`, `e223376`, `96804ff`
`feat/backup-multi-db`: `709fd2d`, `4568395`

## 19. Remote HEAD

- `origin/main` — `92d83abaac0eb894f81d7c7c115d81556bb40ffe` (unchanged)
- `origin/feat/erp-redesign` — `b0739895e1fd27887370630b1b087313b5e26a0a`
- `origin/feat/backup-multi-db` — `709fd2df618f6b8e4c6bd861df3fefe76943a953`

All work is pushed. Nothing exists only on the VPS.

## 20. Rollback procedure

Nothing to roll back — `main` is untouched and no production change was made.

- **Backup:** don't install. The binary is byte-identical
  (`1c3dfaa6…`), the config unmodified, the timer active.
- **ERP:** no database, no roles, no service, no nginx change.
- **If merged and later regretted:** `git revert 709fd2d 4568395` and reinstall
  from `ops/backup/install.sh`. The manifest change is additive and
  `FORMAT_VERSION` did not move, so sets written by the new code remain
  readable by the old.

## 21. Known limitations

1. **Not deployed.** Blocked on merge authorization.
2. **Document upload not implemented** — the generic create route for
   `documents` is deliberately unmounted rather than able to insert a row
   pointing at no blob.
3. **Frontend not wired to the API.** `app/` is still the Stage 2 mock shell.
4. **No MFA flow** (schema and taxonomy ready).
5. **No ERP monitoring probe** — required before Stage 8.
6. **Three production databases still unprotected** pending an operator
   decision on the allowlist.
7. **Legacy browser data unreachable.** If anyone entered real records into the
   legacy ERP, they are in that person's `localStorage`. Do not retire the
   legacy shell — it is the only tool that can read them.
8. **No importer.** Specified in `ERP_DATA_INTEGRATION_MAP.md`, not built,
   because building one before knowing whether data exists is building for a
   hypothesis.

## 22. Future roadmap

1. Authorize the merge; install the backup; decide on the three unprotected
   databases.
2. Provision `mythos_erp`, add it to the allowlist **in the same maintenance
   step**, and run a verified backup before any real data is entered.
3. Wire the frontend to the API; build the upload path with content-addressed
   storage outside the docroot.
4. Add the ERP probe to the Status Center.
5. Stage 8: controlled exposure, external verification, regression check.
6. Then: MFA, the importer if any user reports data, and a second tenant to
   exercise the engine as a platform rather than a product.
