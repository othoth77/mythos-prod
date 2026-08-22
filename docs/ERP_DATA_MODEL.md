# Mythos ERP — Stage 3: data model, API boundary, storage and backup

**Stage 0 decision (approved):** PostgreSQL on the existing `idauto-postgres`.
**Status:** design only. **No database, role, table or row was created.** No data
migrated, no legacy file deleted, no PHP enabled, no nginx change.
**Schema proposal:** `sites/erp.mythosprod.xyz/db/schema.sql`
**Date:** 2026-08-22.

---

## 1. Target environment (measured, not assumed)

| Fact | Value | Consequence for the design |
|---|---|---|
| Server version | **PostgreSQL 15.18** (Alpine) | `gen_random_uuid()` is built in — no `pgcrypto` needed; identity columns and STORED generated columns available |
| Existing databases | `idauto`, `mythos_command_center`, `mythos_command_center_test`, `ssangyong_autos` | **Per-application databases are the established pattern.** A dedicated `mythos_erp` follows precedent |
| Extensions available | `citext`, `pg_trgm`, `pgcrypto`, `uuid-ossp` | `citext` for email, `pg_trgm` for name search; the other two unnecessary |
| Container memory | **384 MiB limit**, 28 MiB in use | Schema stays modest: no partitioning, no materialised views, 11 indexes total |
| Port | `127.0.0.1:5432`, loopback only | The ERP connects over loopback; the database is never publicly reachable |

**Placement: a separate `mythos_erp` database, not a schema inside `idauto`.**
It keeps grants, backup, restore and blast radius independent — and it matches
what the server already does for Command Center.

---

## 2. Data model

**31 tables.** Grounded in the 20 legacy collections (`ALLOWED_KEYS`) plus what
the modules actually carry — invoice records were found holding
`pu`/`qty`/`unit` per line, and `mf` (matricule fiscal) with TVA, which fixes
both the money type and the header/line split.

### 2.1 Groups and relationships

```
users ─┬─ user_roles ── roles ── role_permissions ── permissions
       └─ audit_log (append-only)

clients ─┬─ contacts
         ├─ projects ─┬─ contracts
         │            ├─ representations ── inscriptions ── contacts
         │            ├─ appointments
         │            └─ expenses
         ├─ quotes ── quote_lines
         └─ invoices ─┬─ invoice_lines
                      └─ payments
                       └─ (invoices.quote_id → quotes)

suppliers ── purchases          bank_accounts ── bank_entries
expense_categories ── expenses  cash_entries (standalone)
natures ── projects             collaborators → users

documents (metadata only) → clients, projects, users
inventory_items ── inventory_movements → projects, users
```

### 2.2 Decisions worth defending

**Money is `numeric(14,3)`, never float.** The domain is Tunisian — the records
carry `mf` and TVA, and the dinar subdivides into 1000 millimes. Floating point
would be wrong here in a way that only surfaces during reconciliation, which is
exactly where the legacy accounting modules already accumulate workarounds.

**Headers and lines are separate tables.** The legacy app stores lines inside
the invoice record and totals them in the browser. `quote_lines` and
`invoice_lines` carry `quantity`, `unit_price`, `vat_rate` and a **STORED
generated** `line_ht`, so a total is computed by the database from the same
numbers every time.

**Nothing is hard-deleted.** Every business table has `deleted_at`. The
application role is granted `SELECT, INSERT, UPDATE` and **not** `DELETE`. This
mirrors a property the system already has — the backup pipeline never deletes a
dump — and makes accidental destruction structurally difficult rather than
merely discouraged.

**`legacy_id` on every migrated table.** The current app generates ids with
`Date.now()` (38 call sites). Preserving them makes migration idempotent,
re-runnable and reversible, and lets old and new coexist during the port.

**`audit_log` is append-only**, with `actor_label` denormalised so the record
survives the user row being retired. Closes Stage 1 finding **M9**.

---

## 3. Migration strategy

**No data is migrated in Stage 3.** This is the plan, to be executed after
Stage 4 exists to authenticate it.

### 3.1 What there is to migrate

Almost nothing on this host, which makes the first migration a rehearsal rather
than a risk:

- `appdata/` — the server-side JSON store — **has never been committed and does
  not exist here**. 0 records.
- `data/` holds one 83-byte seed file.
- Real records, if any exist, live in **browser `localStorage`** on whichever
  machines used the app (28 call sites), and in `appdata/` on any host that ran
  it. Neither is reachable from here.

**Implication:** the migration tool must accept an **exported JSON bundle**
rather than assume a server-side source. The legacy app already has an
export/backup module (`js/shared/backup.js`, `mp_backup_versions`) that
produces exactly such a bundle — that is the input format.

### 3.2 Phases

| # | Phase | Detail |
|---|---|---|
| M-1 | **Validate the schema in a throwaway container** | `docker run --rm postgres:15-alpine`, apply `schema.sql`, confirm it applies clean and rolls back. **Must not be the production container.** |
| M-2 | **Provision** | Create `mythos_erp`, `erp_owner`, `erp_app` with the grants in the DDL footer. Owner runs migrations; app never owns objects |
| M-3 | **Importer, dry-run only** | Reads an exported bundle, validates against the schema, reports counts and rejects per collection. Writes nothing |
| M-4 | **Import into a scratch database** | Same bundle, real writes, into `mythos_erp_import_test`. Reconcile counts collection by collection |
| M-5 | **Reconciliation report** | Per collection: source count, imported count, rejected count with reasons. **A non-zero unexplained delta blocks the migration** |
| M-6 | **Production import** | Only after M-5 is clean and Stage 4 authentication is in place. Idempotent on `legacy_id`, so a re-run corrects rather than duplicates |
| M-7 | **Dual-read window** | New modules read PostgreSQL; the legacy app keeps its own store untouched. No cutover until every module is ported |

### 3.3 Rollback

The legacy store is never modified, so rollback is *stop using the new one*.
`DROP DATABASE mythos_erp` restores the prior state exactly. That is the whole
procedure — which is the point of not migrating in place.

---

## 4. API boundary

**One authenticated boundary, not sixteen ad-hoc endpoints.** Stage 1 found 16
endpoints, 15 requiring nothing at all; most of the findings exist *because*
every endpoint is its own boundary.

```
browser ──HTTPS──▶ /api/v1/*  ──▶ [ session → permission → validate → repository ] ──▶ PostgreSQL
                       │                                                    │
                       └── audit_log ◀─────────────────────────────────────┘
```

**Shape:** `/api/v1/<resource>` with REST verbs, JSON in and out.

Four rules the boundary enforces before any handler runs:

1. **Authenticate.** No session, no handler. Default deny.
2. **Authorise.** Permission key per resource+verb (`invoices.write`), checked
   server-side. Never in the UI.
3. **Validate.** Typed schema per endpoint. Reject unknown fields rather than
   ignoring them.
4. **Audit.** Every state change writes `audit_log` in the same transaction as
   the change — so an unaudited write is impossible, not merely discouraged.

**Collection names become values, not paths.** This is the structural fix for
Stage 1 **H3**: `data_write()` built a filesystem path from a client-supplied
key, and `mp_rdtpl_../../…` passed the guard. In the new boundary a resource
name selects a repository; there is no path to traverse. The vulnerability class
disappears rather than being filtered.

**CORS:** same-origin only. `Access-Control-Allow-Origin: *` is not carried
forward (Stage 1 **H6**).

---

## 5. Storage strategy

### 5.1 Structured data

PostgreSQL, `mythos_erp`, over loopback. Connection credentials live in a
`0600` file owned by the application user, outside the repository and outside
the docroot — the same pattern the backup system already uses for its R2
credential.

### 5.2 Documents — outside the docroot, always

The database stores **metadata only**: `storage_key` (opaque, server-generated),
`original_name` (display only, never a path), server-determined `mime_type`,
`byte_size`, and `sha256`.

```
/var/lib/mythos-erp/documents/<aa>/<bb>/<sha256>     ← outside every docroot
```

Content-addressed, mirroring the IDAuto media layout the backup system already
understands. Rules:

- The stored filename is **never** derived from client input — closes **C1**.
- Files live outside any web root and are served by an authenticated handler
  that sets `Content-Disposition: attachment` and a non-executable type —
  closes **H5**.
- Extension and type are determined by **server-side content inspection**, with
  an allow-list. The client's `Content-Type` is treated as a hint, never a gate.
- The directory is not writable by any web-server process.

---

## 6. Backup integration

Today the ERP is **not in the backup** — its durability is git history, which
covers code and not records. Introducing a datastore creates the obligation.

Choosing `idauto-postgres` makes this mostly free: the capture step already
runs `pg_dump -Fc` inside that container, validates with `pg_restore --list`,
records a SHA256, and hands off to the verified R2 pipeline.

| # | Step | Change |
|---|---|---|
| B1 | Extend capture to dump `mythos_erp` alongside `idauto` | additive; the hardened `mythos-backup-capture.sh` gains a second database, same validation path |
| B2 | Add the document store to the media set | `/var/lib/mythos-erp/documents` is content-addressed, exactly the shape the media capture already handles |
| B3 | Extend `verify-remote` to assert both dumps and the document set | verification must cover what it claims |
| B4 | Add an ERP restore rehearsal to `mythos-restore-test.timer` | a backup that has never been restored is a hypothesis |
| B5 | Surface ERP backup state in the Status Center | one probe, so a silent ERP backup failure is impossible |

**Constraint carried from PR #75:** any change to `ops/backup/` must keep the
hardening — config parsed not sourced, paths allowlisted per variable, staging
root-owned, manifest JSON-escaped — and must be re-verified by
`tests/backup-hardening-test.js`, whose 66 checks are mutation-tested.

---

## 7. Security model preparation

Mapping every Stage 1 finding to the structure that removes it. **Stage 3
prepares; Stage 4 enforces.**

| Finding | Removed by | Where |
|---|---|---|
| **C1** upload extension from client filename | server-side inspection + allow-list + opaque `storage_key` | §5.2 |
| **C2** no authentication | authenticate-then-authorise at one boundary, default deny | §4 |
| **H3** path traversal via collection key | collection names are values, not paths | §4 |
| **H4** committed shared secret | no shared secrets; admin actions are permissions | §4, `roles` |
| **H5** uploads inside docroot | `/var/lib/mythos-erp/documents`, authenticated handler | §5.2 |
| **H6** wildcard CORS | same-origin only | §4 |
| **M7** OAuth without `state` | rebuilt as an optional adapter, off by default, `state` validated | Stage 5 |
| **M8** token in URL | one-time POST body or short-lived cookie | Stage 5 |
| **M9** no audit log | `audit_log`, append-only, written in the same transaction | §2.2 |
| **M10** unconfirmed mass restore | restore is a permissioned action that snapshots first | §4, `roles` |

**Database-level defences**, independent of application correctness:

- `erp_app` has **no `DELETE`** on business tables and **no `UPDATE`/`DELETE`**
  on `audit_log`. Even a fully compromised application cannot silently erase
  history.
- `erp_app` **owns nothing** and cannot alter structure. Migrations run as
  `erp_owner`.
- `REVOKE ALL ON SCHEMA public FROM PUBLIC`.
- Loopback-only listener; no network exposure to add.

---

## 8. Stage 3 conclusion

Delivered: a 31-table schema proposal grounded in the measured environment and
the real legacy record shapes, a migration strategy that treats the first import
as a rehearsal, a single authenticated API boundary that removes an entire
vulnerability class structurally, a document store outside every docroot, a
backup integration plan that reuses the already-hardened pipeline, and a
finding-by-finding security map.

**Not done, deliberately:** no database created, no role created, no DDL
executed, no data migrated, no legacy file touched, no PHP enabled, no nginx
change, no production alteration.

**One honest gap:** the DDL has been statically reviewed — 31 tables, 34 foreign
keys, no forward references, every extension declared — but **not executed**.
Validating it against a throwaway `postgres:15-alpine` container is M-1, and it
should be the first act of Stage 3 implementation rather than something assumed
to work. I did not run it against the production container, because that would
have meant executing DDL against a live Mythos service.
