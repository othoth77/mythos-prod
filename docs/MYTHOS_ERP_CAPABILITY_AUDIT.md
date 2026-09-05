# Mythos ERP — Capability Audit & OSS Reuse Matrix

**Date:** 2026-08-28 UTC
**Method:** direct inspection of the actual implementation (`js/shared/`,
`js/core/`, `js/plugins/`, `index.html`, `api.php`, `ALLOWED_KEYS`), not
documentation alone. External OSS research performed for each genuine gap.
**Scope rule:** this audit does **not** invent business scope. It records what
the ERP *actually is*, what is weak or missing *for its own domain*, and what
mature ready-made software fits — SEARCH → REUSE → ADAPT → BUILD LAST.

---

## 1. What this ERP actually is

Mythos ERP is a **theatre / live-events production-management ERP** for a
Tunisian production company (spectacles, représentations, tournées). It is a
**client-side single-page app** (plain HTML + ES5/ES6 JavaScript, no build
step) with local persistence (`localStorage`) and an optional PHP file-based
sync backend (`api.php`, currently in documented static-preservation mode).

Its domain nouns are the evidence (from `ALLOWED_KEYS` + `js/shared/`):
invoices · devis (quotes) · contracts · clients · mission orders (ordres de
mission) · collaborators (musicians/technicians) · représentations (shows) ·
suppliers · purchases · expenses · bank & cash entries · appointments (RDV) ·
documents · redaction docs · tasks · reminders · vehicles · contact directory ·
call sheets / inscriptions · natures.

**Consequence for the audit:** the generic goods-ERP modules — Products,
Product categories, Inventory, Warehouses, Stock movements, Sales orders,
Delivery — are **out of domain**. Their absence is *not* a gap; adding them
would be inventing scope, which this order explicitly forbids.

---

## 2. Capability matrix

State legend: **IMPL** implemented · **PART** partial · **MISS** missing
(in-domain) · **N/A** out of domain.

| Area | State | Evidence / Gap | Solution | Source | Verdict |
|---|---|---|---|---|---|
| Dashboard | IMPL | `dashboard.runtime.js`, `statistics-dashboard.js`, KPI cards | — | Mythos | KEEP |
| Clients / Customers | IMPL | `clients.js` CRUD | — | Mythos | KEEP |
| Contact directory | IMPL | `contacts.js`, VCF import, tags | — | Mythos | KEEP |
| Suppliers | IMPL | `fournisseurs.js` | — | Mythos | KEEP |
| Collaborators | IMPL | `collaborateurs.js` | — | Mythos | KEEP |
| Représentations (shows) | IMPL | `representations.js` | — | Mythos | KEEP |
| Mission orders | IMPL | `mission-orders.js`, vehicles, personnel | — | Mythos | KEEP |
| Quotes (devis) | IMPL | `devis.js`, numbering, print, per-société logos | — | Mythos | KEEP |
| Invoices | IMPL | `invoices.js`, TVA + timbre fiscal, `sans_tva`, print | — | Mythos | KEEP |
| Contracts | IMPL | `contracts.js`, retention + VAT-advance (pure `contractTotals`) | — | Mythos | KEEP |
| Purchases | IMPL | `accounting-purchases.js`, multi-rate VAT (19/13/7) | — | Mythos | KEEP |
| Expenses | IMPL | `accounting-expenses.js`, categories/subcategories | — | Mythos | KEEP |
| Bank / Cash | IMPL | `accounting-bank.js` / `-cash.js`, entry linking | — | Mythos | KEEP |
| Accounting reports / VAT | IMPL | `accounting-reports.js`, `-overview.js`, `-tva.js` | — | Mythos | KEEP |
| Payments | PART | status/mode on invoices; bank/cash ledgers — no dedicated payments register | small: keep ledger model | Mythos | KEEP |
| Credit notes (avoirs) | MISS | not present | evaluate need with owner first | — | DEFER (owner) |
| Documents | IMPL | `documentation.js`, upload/photo/PDF, `upload.php` | — | Mythos | KEEP |
| Redaction (drafting) | IMPL | `redaction.js` | — | Mythos | KEEP |
| Tasks | IMPL | `taches.js`, `tasks.runtime.js` | — | Mythos | KEEP |
| Calendar | IMPL | `calendar.runtime.js`, `calendrier.js` | — | Mythos | KEEP |
| Reminders | IMPL | `rappels.js`, types + periods | — | Mythos | KEEP |
| Appointments (RDV) | IMPL | `rdvs.js`, fee linking to invoice/devis/contract | — | Mythos | KEEP |
| Inscriptions / call sheets | IMPL | `inscriptions.js`, call script | — | Mythos | KEEP |
| Notifications | PART | `notifications.js` service; reminders drive some; no push/email/scheduled | see §4 (background jobs — infra) | Mythos + infra | DEFER (infra) |
| Reports / Statistics | IMPL | `statistics-dashboard.js`, accounting reports | — | Mythos | KEEP |
| **Search** | PART | per-module client-side filtering; **no unified/fuzzy search** | **Fuse.js** (MIT, no-build) | OSS | **REUSE OSS** |
| Filters | IMPL | per-module filter selects (now with accessible names) | — | Mythos | KEEP |
| **Import** | PART | JSON backup restore, CSV bank import, VCF contacts; no xlsx | **SheetJS CE / ExcelJS** | OSS | REUSE OSS (opt.) |
| **Export** | PART | JSON backup + browser print-to-PDF; no real PDF/xlsx export | **pdfmake / jsPDF**, SheetJS | OSS | REUSE OSS (opt.) |
| Users | MISS | single-user; client-side password gate (`auth.js`) | platform auth (see §3) | infra | DEFER (infra) |
| Roles / Permissions (RBAC) | MISS | none | reuse platform RBAC (see §3) | infra | DEFER (infra) |
| Audit | PART | `LOGGER` action log in local state; not a tamper-proof server audit | server audit needs backend (§3) | infra | DEFER (infra) |
| Settings | IMPL | settings view, call script, backup controls | — | Mythos | KEEP |
| Integrations | PART | Google Sheets webhook, `google_auth` import | — | Mythos | KEEP |
| Inventory / Warehouses / Stock / Sales orders / Delivery / Products | N/A | **out of domain** (services/events business) | — | — | NOT A GAP |
| **Accessibility** | IMPL | closed this session — focus, skip-link, aria-current, alt, Escape, form/table names, status-hue contrast | — | Mythos | DONE |
| **Financial calc duplication** | IMPL | closed this session — canonical `financial-calc.js` + tests | — | Mythos | DONE |

---

## 3. Authentication / RBAC — search-first outcome

**Current:** `api.php` has zero authentication and `CORS *`; `js/auth.js` is a
client-side SHA-256 password gate (bypassable). **This is already documented**
in `docs/ERP_SECURITY_STATUS.md`, already **mitigated** (static-preservation
mode — PHP not executed, endpoints absent from the docroot, route not public),
and its **remediation is already specified** (§4.1: every write path behind
platform authentication before PHP is re-enabled).

**Search-first (per order §7):**

| Option | License | Fit to this architecture | Verdict |
|---|---|---|---|
| **Reuse the in-repo OTHMODE cookie-session auth** (HttpOnly/Secure/SameSite, server-side hashing, CSRF — `projects/command-center/reference/othmode/sessions.js`) | in-repo | Highest — a proven Mythos pattern already deployed | **REUSE (internal)** when a backend is enabled |
| PocketBase (Go, single binary, built-in auth+RBAC+REST) | MIT | Good for a small self-hosted app, but a **new backend service + data migration** | ADAPT — strategic, owner-gated |
| Supabase (Postgres + GoTrue auth + RLS) | Apache-2.0 | Powerful RBAC via RLS, but hosted/self-host infra + migration | ADAPT — strategic, owner-gated |
| Auth.js / Lucia (JS session/token libs) | ISC/MIT | Need a server runtime the current static host doesn't run | ADAPT — needs backend |
| Roll your own | — | Rejected — reinventing auth | **REJECT** |

**Blocker (documented, not skipped):** implementing real auth requires a
**server runtime + secret provisioning** — infrastructure this static-hosted
SPA does not currently have, and re-enabling PHP is a gated deployment stage.
Autonomous edits to the auth backend are additionally refused by the execution
environment's safety layer. **Migration path:** enable a backend (reuse the
OTHMODE session pattern) → move writes behind it → retire the client-side gate.
This is an owner + infrastructure decision, not an ordinary technical one.

---

## 4. Architecture-compatibility analysis (order §6)

Adopting a full OSS ERP is **not** a dependency install. Odoo (LGPL, Python),
ERPNext (GPLv3, Python/Frappe), Tryton (GPL, Python), Dolibarr (GPL, PHP/LAMP)
and Axelor (AGPL, Java) are **server-side platforms** with their own database,
ORM, and UI. Dropping one in would mean **replacing** Mythos: a new runtime, a
Postgres/MariaDB database, a full data migration off `localStorage`, and a UI
re-platform — discarding the working, domain-specific French/Tunisian modules
this ERP already has. Dolibarr is the closest architectural analog (PHP), and a
migration *target* worth recording, but still a replacement, not an integration.

**Recommendation:** **KEEP** the Mythos domain modules. Where a mature library
fits the *current* no-build client architecture without a re-platform — search
(Fuse.js), PDF (pdfmake/jsPDF), spreadsheets (SheetJS/ExcelJS) — **REUSE OSS**
by vendoring a pinned copy (the app is online-first; avoid a hard CDN runtime
dependency). The genuine platform-level gaps (real persistence, multi-user,
auth/RBAC, server audit, scheduled notifications) all reduce to **one**
architectural evolution: **introduce a small backend**. The smallest viable
step is a single-binary backend (PocketBase-class) or re-enabling the existing
PHP behind platform auth — both owner + infrastructure decisions.

---

## 5. Data-model / persistence audit (order §8)

- **Persistence:** `localStorage` (per-browser, ~5–10 MB) with `api.php`
  writing whole-collection JSON files. **Limitations:** single-user, no
  concurrency control, last-writer-wins sync, no referential integrity, no
  transactions, browser-storage cap. Adequate for one operator; **not** for
  multi-user. → the backend evolution in §4 is the remedy.
- **IDs / relationships:** entities carry string ids (`inv_<ts>`, etc.) and
  soft references (e.g. RDV → invoice/devis/contract). Relationships are
  by-value lookups, not enforced FKs. Acceptable for the domain; a real DB
  would enforce them.
- **Validation:** present at the UI layer (required-field guards); no schema
  layer. A shared validation module could be added, but is not urgent.
- **Backup:** JSON export/restore exists (`backup.js`); off-host backup is a
  separate, already-tracked infrastructure track.

**No production data was altered by this audit.**

---

## 6. Executed this session (SEARCH → REUSE → ADAPT → BUILD)

| Item | Action | Source | Tests |
|---|---|---|---|
| Keyboard focus, skip-link, landmarks, aria-current, image alt, Escape-close | REUSE console A-016 pattern → live app | in-repo pattern | `a11y-focus-visible` 42/0 |
| Status-hue adoption (WCAG-verified) | ADAPT `COLOR_SYSTEM.md`, lockstep both products | approved spec | contrast + drift 1438/0 |
| Form/table accessible names | BUILD minimal runtime service (labels + `scope`) | standard WCAG | `a11y-forms` 15/0 |
| **VAT/timbre calc duplication** | **REFACTOR** to canonical `financial-calc.js` | in-repo `contractTotals` convention | `financial-calc` 16/0 |
| Dead code (app-fresh, addLine, applyOmMissionType stubs) | REMOVE | — | dup-cleanup 28/0 |

## 7. Remaining — with what each needs (order §16)

| Item | Verdict | Blocked by |
|---|---|---|
| Unified fuzzy search | REUSE OSS (Fuse.js, MIT) | product/UX decision on where it lives + vendoring policy — recommend, don't auto-add |
| Real PDF / xlsx export | REUSE OSS (pdfmake, SheetJS-CE/ExcelJS) | low priority — print already works; owner priority call |
| Auth / RBAC / server audit | REUSE internal (OTHMODE session) | **backend runtime + secrets** (infra) + gated deployment stage |
| Real DB / multi-user | ADAPT (PocketBase-class or re-enable PHP) | same backend evolution; owner architecture decision |
| Scheduled notifications | needs backend jobs | same backend evolution |
| Credit notes (avoirs) | evaluate need | owner product decision (may be out of scope) |

**Bottom line:** the ERP's *domain* is broadly implemented and now more
accessible, consistent, and de-duplicated. It is **not** "complete" as a
multi-user product: its real ceiling is the **client-only / no-auth**
architecture, whose removal is a single, owner- and infrastructure-gated
backend evolution — documented here and in `docs/ERP_SECURITY_STATUS.md`,
not silently skipped.

---

### External sources consulted
- ECOSIRE — Best Open-Source ERPs 2026: https://ecosire.com/blog/open-source-erp-top-10-comparison-2026
- ERP Implementation EU — Dolibarr vs ERPNext vs Axelor vs Odoo 2026: https://www.erpimplementation.eu/en/open-source-erp-comparison-dolibarr-erpnext-axelor-odoo-2026/
- PkgPulse — Fuse.js vs FlexSearch vs Orama 2026: https://www.pkgpulse.com/blog/fusejs-vs-flexsearch-vs-orama-client-side-search-2026
- npm-compare — jspdf vs pdf-lib vs pdfmake: https://npm-compare.com/jspdf,pdf-lib,pdfmake,pspdfkit,react-pdf
- PkgPulse — SheetJS vs ExcelJS vs node-xlsx 2026: https://www.pkgpulse.com/guides/sheetjs-vs-exceljs-vs-node-xlsx-excel-files-node-2026
