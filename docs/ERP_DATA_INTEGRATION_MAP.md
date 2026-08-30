# Mythos ERP — data integration map

**Date:** 2026-08-23. **Status:** map complete; no import has been run, because
there is nothing on a server to import.

---

## 0. The finding that shapes every row below

Stage 1 established, and this stage re-verified, that **the legacy ERP has no
server-side data**:

- 0 PHP files referenced `mysqli`, `PDO` or `pg_connect`; there was never a
  database.
- Persistence was 28 `localStorage` call sites in the browser plus 7
  `fetch('api.php')` calls to a JSON file store at `appdata/`.
- `appdata/` has **never been committed** — zero commits in all of history —
  and does not exist on this host. Same for `documents/`.
- Re-checked today against the preserved tree: 73 `.js`, 14 `.svg`, 13 `.png`,
  10 `.css`, 8 `.woff2`, and exactly **one** `.json` — a 578-byte web app
  manifest. No CSV, no SQL, no data file of any kind.

**There is therefore no migration project attached to this ERP.** That is
unusually good news and it is also the single most important thing to state
plainly, because "migrate the ERP data" sounds like the hard part and it is not
a part of it at all.

### 0.1 The one place data could still exist

If anyone ever entered real records into the legacy ERP, those records are in
**that person's browser localStorage**, on their own machine. They are not on
this server, they are not in any backup, and they are not reachable from here.

This is not a gap to paper over:

- It cannot be discovered server-side. Someone has to ask the users.
- If such data exists, the only honest import path is an explicit, user-driven
  export: open the legacy shell (still preserved, still loopback-only), run an
  export that serialises localStorage to JSON, and feed that file to the
  importer described in §2.
- **Until a user says they have data, assume nobody does — but do not
  retire the legacy shell**, because retiring it destroys the only tool that
  can read those browsers.

---

## 1. Entity map

For each entity: where it lives now, what is authoritative, what the ERP's
canonical form is, how it would be imported, and what stops duplicates.

| Entity | Current source | Authoritative | Canonical ERP form | Import method | Duplicate prevention |
|---|---|---|---|---|---|
| Clients | none on server; possibly browser localStorage | the business, via export | `clients` | localStorage export → importer | `(tenant_id, legacy_id)` unique |
| Contacts | same | same | `contacts` (FK to client) | with clients | `(tenant_id, legacy_id)` |
| Suppliers | same | same | `suppliers` | with clients | `(tenant_id, legacy_id)` |
| Collaborators | same | same | `collaborators` | with clients | `(tenant_id, legacy_id)` |
| Projects | same | same | `projects` | after clients (FK) | `(tenant_id, legacy_id)`, `(tenant_id, reference)` |
| Contracts | same | same | `contracts` | after projects | `(tenant_id, legacy_id)` |
| Representations | same | same | `representations` | after projects | `(tenant_id, legacy_id)` |
| Appointments | same | same | `appointments` | after clients/projects | `(tenant_id, legacy_id)` |
| Quotes + lines | same | same | `quotes`, `quote_lines` | after clients | `(tenant_id, legacy_id)`, `(tenant_id, number)` |
| **Invoices + lines** | same | **the issued PDF/paper document** | `invoices`, `invoice_lines` | §2 — special rules | `(tenant_id, legacy_id)`, `(tenant_id, number)` |
| Payments | same | bank statement | `payments` | after invoices | `(tenant_id, legacy_id)` where present |
| Purchases | same | supplier invoice | `purchases` | after suppliers | `(tenant_id, legacy_id)` |
| Expenses | same | receipt | `expenses` | after categories | `(tenant_id, legacy_id)` |
| Bank accounts / entries | same | bank statement | `bank_accounts`, `bank_entries` | manual, low volume | `(tenant_id, legacy_id)` |
| Documents | `documents/` — **never existed on this host** | the file itself | `documents` + content-addressed blob | upload path only | `sha256` content address |
| Inventory | same | physical count | `inventory_items`, `inventory_movements` | manual, low volume | `(tenant_id, sku)` |
| Users | none | the people | `users` + `tenant_memberships` | created interactively | `email` unique globally |

`legacy_id` exists on every business table precisely so an import is
**re-runnable**: a second pass updates the row it created the first time
instead of inserting a twin. That is what makes an import safe to retry after
it fails halfway, which is the state most imports end up in at least once.

---

## 2. Invoices — the entity that deserves its own rules

Invoices are the records a business is legally and financially accountable for,
and the ones where a well-meaning import does the most damage.

**Rules:**

1. **The authoritative source is the issued document**, not any digital record.
   A localStorage row is a convenience copy of something a client already
   received.
2. **Never fabricate.** No inferred invoice, no reconstructed line, no
   "probably 19% VAT". A line whose amount cannot be evidenced is not imported;
   the invoice is flagged for a human.
3. **Imported invoices keep their original numbers**, and the tenant's
   `invoice_next_seq` is advanced past the highest imported number in the same
   transaction. Otherwise the first new invoice collides with an old one — and
   the tenant-scoped unique index would refuse it, which is the safe failure
   but a confusing one to debug at month end.
4. **Imported invoices arrive with their real status.** A paid invoice is
   imported as paid with its payments, or it is imported as a draft and someone
   re-enters the payment; it is never imported as "sent" and left to be chased.
5. **Totals are recomputed from lines on import** and compared against the
   stated total. A mismatch is a hard stop for that invoice, not a rounding
   nudge — the legacy system totalled in the browser, which is exactly the
   class of drift this check exists to find.
6. **Every imported invoice writes an audit row** recording the source file and
   its checksum, so the provenance of a financial record is answerable a year
   later.

---

## 3. Import mechanics (specified, not built)

The importer does not exist yet, deliberately: writing one before knowing
whether any data exists would be building for a hypothesis.

When it is built it must:

- Run inside one transaction per entity batch, with the tenant GUC set, so RLS
  places every row in the right company by construction.
- Be idempotent on `(tenant_id, legacy_id)` — `ON CONFLICT DO UPDATE`.
- Import in dependency order: natures/categories → clients → contacts →
  suppliers → collaborators → projects → contracts/representations →
  appointments → quotes → invoices → payments → purchases/expenses →
  inventory.
- **Refuse to run against a tenant that already has business rows** unless
  explicitly told to merge, so a second import into a live company is a
  decision rather than an accident.
- Produce a report: rows read, inserted, updated, skipped, and every rejection
  with its reason. An import that says only "done" is not auditable.

---

## 4. What is authoritative *after* the ERP goes live

Once a tenant is using the ERP, **the ERP is authoritative for everything in
§1** — with two standing exceptions, because they describe the outside world:

- **Payments** reconcile against the bank statement. The bank is right.
- **Inventory** reconciles against a physical count. The shelf is right.

Both are reconciliations, not syncs: the ERP records a correction with an audit
trail rather than being silently overwritten.
