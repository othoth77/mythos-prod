# Mythos ERP — multi-tenant architecture

**Status:** design + implementation. Migration `schema-tenant.sql`.
**Date:** 2026-08-23.
**Companions:** `ERP_DATA_MODEL.md` (base schema), `ERP_AUTH_SECURITY_DESIGN.md`
(auth), `ERP_MIGRATION_PLAN.md` (deployment).

---

## 0. The conflict this document resolves

Stages 3 and 4 designed and built a **single-tenant** ERP: 34 tables, zero
tenant columns, `invoices.number` globally unique, roles assigned to a user
globally. The platform brief requires one ERP engine serving many companies
with mandatory isolation.

Those are not compatible, and the gap is not cosmetic. Retrofitting tenancy
onto a populated ERP means rewriting every table, every unique constraint and
every query while real invoices exist in it.

**Nothing has been provisioned yet, so this is the cheapest hour this change
will ever cost.** It is being made before `mythos_erp` exists rather than
after — which is the whole reason the backup gate came first.

---

## 1. Isolation model: shared schema + `tenant_id` + Row-Level Security

Three options were considered.

| Model | Isolation | Cost |
|---|---|---|
| Database per tenant | Strongest | Every tenant needs a backup allowlist entry, its own migration run and its own connection pool. Onboarding becomes an ops task. |
| Schema per tenant | Strong | Migrations multiply by tenant count; cross-tenant reporting becomes painful; `search_path` bugs are silent. |
| **Shared schema + RLS** | **Strong, enforced by the database** | One migration, one backup entry, one pool. Requires RLS to be right. |

**Chosen: shared schema with `tenant_id` and PostgreSQL Row-Level Security.**

The decisive argument is not convenience — it is *where the isolation lives*.
With application-level filtering, isolation is a `WHERE tenant_id = $1` that
every query must remember; one forgotten clause in one endpoint is a
cross-tenant breach, and it is invisible in review because the query looks
fine. With RLS, the database refuses to return another tenant's row even to a
query that forgot, even to SQL injection, even to a bug in the ORM-free
handcoded SQL this project uses.

The backup consequence matters too: database-per-tenant would mean the
allowlist built in the backup gate grows with every customer, and a tenant
added without a corresponding allowlist entry would be a tenant with no
backup. One database keeps that failure mode impossible.

### 1.1 The fail-closed property

```sql
CREATE FUNCTION current_tenant() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('mythos_erp.tenant_id', true), '')::uuid
$$;

CREATE POLICY tenant_isolation ON clients
  USING      (tenant_id = current_tenant())
  WITH CHECK (tenant_id = current_tenant());
```

If the application forgets to set the tenant, `current_tenant()` is NULL,
`tenant_id = NULL` evaluates to NULL, and **no rows are visible**. A forgotten
tenant context yields an empty result set, never someone else's data. The
dangerous direction is the one that fails.

`WITH CHECK` closes the write side: a row cannot be *inserted or updated* into
another tenant either, so a forged `tenant_id` in a request body is rejected by
PostgreSQL rather than by a validator someone might skip.

### 1.2 Who RLS applies to

RLS does not apply to a table's owner. That is deliberate here:

- `erp_owner` owns the tables and runs migrations and restores — it must see
  everything, or `pg_restore` could not work.
- `erp_app` owns nothing and holds only `SELECT, INSERT, UPDATE`, so **RLS
  applies to it in full**. The application never connects as `erp_owner`.

This is the same least-privilege split the backup drill already proved
survives a restore. It is asserted in tests, not assumed.

---

## 2. What carries a tenant, and what deliberately does not

**Tenant-scoped (24 business tables + `user_roles`):** natures,
expense_categories, clients, contacts, suppliers, collaborators, projects,
contracts, representations, inscriptions, appointments, quotes, quote_lines,
invoices, invoice_lines, payments, purchases, expenses, bank_accounts,
bank_entries, cash_entries, documents, inventory_items, inventory_movements.

**Global, and correctly so:**

| Table | Why it is not tenant-scoped |
|---|---|
| `users` | A person is one identity across companies — that is the whole point of §3 |
| `roles`, `permissions`, `role_permissions` | The permission *vocabulary* is the engine's, not a tenant's. A tenant grants roles; it does not invent permission keys |
| `sessions`, `login_attempts`, `password_reset_tokens` | Authentication happens before a tenant is chosen |
| `schema_migrations` | Engine state |

`audit_log` carries a **nullable** `tenant_id`: tenant actions record their
tenant, platform actions (a login, a failed password reset) legitimately have
none.

### 2.1 Uniqueness had to be re-scoped, or tenancy leaks through constraints

`invoices.number` was globally unique. In a multi-tenant system that is both a
functional bug and an information leak: Company B cannot issue invoice
`2026-001` because Company A did, and the constraint violation *tells* B that
someone else already used it.

Every such constraint is now scoped `(tenant_id, …)`: `invoices.number`,
`quotes.number`, `projects.reference`, `inventory_items.sku`, and `legacy_id`
on all 24 tables.

`documents.storage_key` stays **globally** unique — it is an opaque
content-addressed key generated by the platform, never a tenant-chosen name,
and global uniqueness is what makes the storage layer safe.

---

## 3. Central identity compatibility

The target model is one person, many companies:

```
MYTHOS ID → User ─┬─ Company A → roles/permissions
                  ├─ Company B → roles/permissions
                  └─ Company C → roles/permissions
```

The ERP is built to *accept* that without becoming it. Two pieces:

1. **`users.external_subject`** — a nullable, unique identifier from an
   external identity provider, with `users.identity_source` recording which
   (`local` today). When Mythos ID arrives, accounts link by subject instead of
   being recreated, and `password_hash` simply stays NULL for SSO users — a
   case `schema-auth.sql` already permits.
2. **`tenant_memberships`** — the join that makes a user a member of a tenant,
   and `user_roles` scoped by `(user_id, tenant_id, role_id)`. A user can be an
   admin of Company A and read-only in Company B, which a global `user_roles`
   could never express.

**Not built:** the identity platform itself — no cross-company SSO, no token
exchange, no central directory. Building it now would be inventing requirements.
What is built is the shape that accepts it without a rewrite.

---

## 4. Modularity and per-tenant customisation

`tenant_modules(tenant_id, module_key, enabled)` — a tenant sees Invoices only
if Invoices is enabled for it. Enforcement is in the API boundary, not the UI:
a disabled module returns 404 for every route under it, so hiding a nav item
is presentation and the refusal is the control.

`tenants` carries the customisation the brief requires — display name, legal
name, logo, brand colours, locale, currency, invoice numbering pattern and
next counter, tax identifiers — as columns and a `settings` JSONB for the long
tail.

**No Mythos branding is hard-coded in the ERP core.** Mythos Prod is a row in
`tenants`, seeded by migration like any other tenant would be. That is the test
of whether this is an engine or a product with extra tables: if removing the
Mythos row broke the ERP, it would be the latter.

---

## 5. Deliberate limits

- **Cross-tenant reporting is not supported** and should not be added casually
  — it means a query that legitimately sees several tenants, which is exactly
  the capability RLS exists to deny.
- **`erp_owner` bypasses RLS by ownership.** Anyone holding that credential
  sees every tenant. It is the migration and restore identity and must be
  treated as such: not in the application, not in a service unit body.
- **RLS is not a substitute for authorization.** It stops tenant A reading
  tenant B. It does nothing about a read-only user inside tenant A writing
  invoices — that remains the permission model's job.
