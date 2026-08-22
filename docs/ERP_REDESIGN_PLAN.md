# Mythos ERP — restoration findings and redesign plan

**Staging location:** `/home/deploy/worktrees/erp-redesign` (branch `feat/erp-redesign`)
**Snapshot:** `/root/erp-preservation-snapshot-20260822T200408Z`
**Source commit:** `92d83abaac0eb894f81d7c7c115d81556bb40ffe`
**Status:** review pending — nothing deployed, nothing on `erp.mythosprod.xyz` changed.

---

## 1. Findings that change the brief

Three things the audit established that the plan has to be built around.

### 1.1 There is no older version to restore

The brief assumed a "previous ERP version" recoverable from backups or history.
There isn't one, and it isn't missing — **`main` already holds the fullest ERP
that has ever existed.**

| Commit | Date | `js/` | `shared/` | `plugins/` | `index.html` |
|---|---|---|---|---|---|
| **HEAD** | 2026-08-22 | 72 | 28 | 14 | **142,963 B** |
| `c2e2999` (MIG-3) | 2026-08-19 | 72 | 28 | 14 | 142,963 B |
| `641495e` (MIG-1) | 2026-08-19 | 72 | 28 | 14 | 142,423 B |
| `2dcbb99` | 2026-08-05 | 72 | 28 | 14 | 142,423 B |

57 commits touch the ERP core, back to *"feat: initial import of Mythos Prod"*.
The arc is a **refactor forward**, not a decline: domain extraction into
`js/shared/`, then MIG-1/2/3, the "Mythos Gold migration". Restoring an earlier
commit would move backwards.

**Consequence:** Phase 2 is satisfied by staging `HEAD`, which is what was done.
There is no archaeology to do.

### 1.2 There is no database, and never was

- **0** PHP files reference `mysqli`, `PDO` or `pg_connect`.
- **0** database config files exist (`google_config.php` is absent; only the
  `.example` is committed).
- Persistence is **28 `localStorage` call sites** in the browser plus **7
  `fetch('api.php')`** calls to a JSON file store at `DATA_DIR = __DIR__/appdata/`.
- **`appdata/` has never been committed** — 0 commits in all of history — and
  does not exist on this host. Same for `documents/`.

**Consequence:** there is no data migration, because there is no server-side
data. `data/` holds one 83-byte seed file. This is a green field for the storage
layer, which is unusually good news: the redesign can choose a real datastore
without a migration project attached.

### 1.3 The ERP is not in the backup

`MYTHOS_BACKUP_MEDIA_SOURCE` points at `idauto-media`; the backup captures the
IDAuto PostgreSQL database and its media. **The ERP is not in the backup set.**
Its durability today is git history alone — which is adequate for code and
inadequate the moment the redesign introduces real records.

**Consequence:** a storage decision (§5) creates a backup obligation. That
dependency is in the staging plan, not an afterthought.

---

## 2. Technology stack (as found)

| Layer | Current |
|---|---|
| Frontend | Vanilla ES modules, no framework, no build step |
| Shell | `js/core/` — `shell.js`, `router.js`, `platform.js`, `events.js`, `plugin-sdk.js` |
| Modules | `js/plugins/` — 7 modules × (`.plugin.js` manifest + `.runtime.js`) |
| Domains | `js/shared/` — 28 extracted domain modules |
| Styling | 8 hand-written stylesheets (`main`, `layout`, `forms`, `dashboard`, `calendrier`, `facture`, `print`, `professional`) |
| Server | 6 PHP endpoints, PHP 8.5 available, **not executed in production** |
| Storage | `localStorage` + JSON files under `appdata/` |
| Auth | `js/auth.js`, **client-side only**; 0 of 6 PHP files call `session_start()` |
| Assets | 43 files — 14 SVG, 13 PNG, 8 WOFF2 |

**The architecture is already modular.** There is a plugin SDK, a router, an
event bus and a manifest/runtime split. The redesign is a re-skin plus a
security and storage rebuild — **not** a rewrite. That is the single most
important estimate driver.

---

## 3. Modules found — and how they map to the target

The brief names 10 target modules. 28 domain modules already exist; the mapping
is mostly consolidation, not construction.

| Target module | Existing source | Gap |
|---|---|---|
| **Dashboard** | `dashboard`, `statistics-dashboard`, `dashboard.runtime.js` | re-skin only |
| **Clients** | `clients`, `contacts`, `representations` | consolidate 3 → 1 |
| **Projects** | `mission-orders`, `contracts`, `inscriptions` | consolidate + rename |
| **Production** | `production.runtime.js`, `spectacle-calculator`, `natures` | re-skin |
| **Planning** | `planning.runtime.js`, `calendar`, `rdvs`, `calendrier` | consolidate 4 → 1 |
| **Inventory** | — | **new build** |
| **Finance** | `invoices`, `devis`, `accounting-{bank,cash,expenses,overview,purchases,reports,suppliers,tva}`, `fournisseurs` | 10 modules → 1 with sub-views; largest surface |
| **Documents** | `documentation`, `camera`, `backup` | re-skin + storage rework |
| **Reports** | `accounting-reports`, `statistics-dashboard` | consolidate |
| **Settings** | `collaborateurs`, `natures`, `modal-entity-helpers` | consolidate + new roles/permissions UI |

**Data domains already modelled** (from `ALLOWED_KEYS`): invoices, devis,
contracts, clients, mission orders, collaborators, natures, RDVs,
representations, suppliers, purchases, expenses, expense categories, bank
entries, cash entries, appointments, documents, DAS documents, other documents,
backup versions — **20 domains**.

Only **Inventory** is genuinely absent.

---

## 4. Security risks (must be closed before any exposure)

| # | Risk | Severity | Evidence |
|---|---|---|---|
| S1 | `upload.php` takes the stored extension from the **client-supplied filename**, gated only by a spoofable `Content-Type`. `x.php` as `application/pdf` writes executable code into the docroot | **Critical** | source read, 2026-08-22 |
| S2 | `api.php`, `upload.php`, `cleanup.php` have **zero authentication checks** — 16 write operations between them | **Critical** | 0 `session_start()` in 6 files |
| S3 | `api.php` prefix rule `mp_rdtpl_` / `mp_rdent_` admits `../`, giving traversal for `.json` writes | High | `str_starts_with` before path concat |
| S4 | Auth is client-side only — trivially bypassed by calling the endpoints directly | High | `js/auth.js` |
| S5 | No audit log of any state change | Medium | no logging in write paths |
| S6 | Uploads would land **inside** the docroot | High | `__DIR__/documents/` |
| S7 | ERP not covered by backup | Medium | backup config |

**Current exposure: none.** PHP is not executed, the `.php` files are not in the
docroot, every `.php` path returns 404, and the vhost is loopback-only. S1–S7
are properties of the code, latent until someone enables PHP.

---

## 5. Redesign plan

### 5.1 Architecture

```
                 mythosprod.xyz — Mythos Hub
                            │  (single sign-on attaches here)
                            ▼
                 erp.mythosprod.xyz — ERP module
        ┌───────────────────┼───────────────────┐
   presentation         application          storage
   Mythos tokens        module registry      real datastore
   responsive shell     roles/permissions    outside docroot
                        audit log
```

The ERP stays an **independent module** behind the Hub's access point, never an
independently reachable origin. Visual identity comes from the same
`assets/tokens.css` the Hub uses, so the two cannot drift.

### 5.2 Design program

- **Mythos identity:** adopt the Hub's token set — no literal colour values, one
  35° gesture per view, Archivo Expanded / IBM Plex, existing radius and spacing
  scales. The 8 legacy stylesheets collapse into a token-driven system.
- **Modern dashboard:** measured tiles, no decorative charts, honest empty
  states — the same rule the Hub follows: never render a value the system did
  not measure.
- **Responsive:** single-column ≤600px, the existing card grid above.
- **Clean navigation:** 10 modules in one persistent rail, replacing the current
  ad-hoc routing.
- **Modular architecture:** keep the plugin SDK; migrate 28 domains onto it
  rather than replacing it.
- **Roles / permissions / audit:** new, server-side, enforced at the endpoint —
  not in the UI.

### 5.3 Storage decision (blocking, needs your input)

Three options, in rising order of effort:

| Option | Fit | Cost |
|---|---|---|
| **A. Keep JSON files**, hardened, outside docroot | Preserves current behaviour exactly | Low; but no concurrency control, no query, and 20 domains of business records in flat files |
| **B. SQLite**, file-backed, outside docroot | Real transactions and queries, trivial backup (one file) | Medium; needs a data layer |
| **C. PostgreSQL** on the existing `idauto-postgres` | Matches platform direction; joins the existing backup path | Medium-high; new schema, but the backup problem solves itself |

**Recommendation: C**, because it inherits the verified backup and the database
probe already monitoring it. B is the pragmatic fallback if the ERP should stay
self-contained.

---

## 6. Estimated work stages

Each stage ends reviewable and reversible. Nothing reaches
`erp.mythosprod.xyz` before Stage 6.

| Stage | Work | Depends on |
|---|---|---|
| **0** | Storage decision (§5.3) — **your call, blocks 3 onward** | — |
| **1** | Security audit of all 6 PHP endpoints, line by line; written findings | — |
| **2** | Design system: port Hub tokens, collapse 8 stylesheets, build the shell and navigation | — |
| **3** | Storage layer + schema for the 20 domains; server-side validation on every write | 0 |
| **4** | AuthN/AuthZ: session handling, roles, permissions enforced at the endpoint; audit log | 3 |
| **5** | Module migration, in dependency order: Dashboard → Clients → Projects → Planning → Production → Finance (largest) → Documents → Reports → Settings → **Inventory (new)** | 2, 3, 4 |
| **6** | Hardening review, re-run the audit from Stage 1, staging verification behind the loopback guard | 5 |
| **7** | Backup integration — ERP records enter the R2 set with their own verification | 3, 6 |
| **8** | Controlled exposure: remove `deny all` only after 1–7 pass; add the `erp` probe to the Status Center at the same time | 6, 7 |

**Sequencing note:** Stage 4 must precede any endpoint being reachable, and
Stage 8 is the only stage that changes production. Stage 5's Finance module is
roughly a third of the total surface — 10 of the 28 existing domains.

---

## 7. What has been done so far

- Complete snapshot: `/root/erp-preservation-snapshot-20260822T200408Z`
  (4.9 MB archive, 131 files checksummed, commit recorded).
- Staging worktree at `/home/deploy/worktrees/erp-redesign`, branch
  `feat/erp-redesign`, byte-identical to the production source.
- **Production untouched:** `erp.mythosprod.xyz` still static, PHP still not
  executed, still loopback-only, certificate still valid.

Awaiting: the Stage 0 storage decision, and approval to begin Stage 1.
