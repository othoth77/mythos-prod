# Mythos — Project Status

**Stage:** AUT-CONNECTOR-SHARED-HELPERS-0 — pending merge
**Generated:** 2026-08-06 · **Updated:** 2026-08-08 (AUT-CONNECTOR-SHARED-HELPERS-0 in progress)
**Purpose:** Quick "where are we now" snapshot. Full detail lives in `docs/AI_HANDOVER.md` (stage semantics), `docs/ROADMAP.md` (intentions), `docs/history/DAILY_HISTORY.md` (day-by-day), and `docs/PROJECT_STATISTICS.md` (numbers).

---

## Current Source of Truth

- **Current `main` HEAD (before AUT-CONNECTOR-SHARED-HELPERS-0 merges):** `39a3a6fc57167054e98f5d6d3971db821abf6b7d`
- **PRs:** #4-#9 all MERGED. AUT-CONNECTOR-SHARED-HELPERS-0 PR pending as of this document's generation.
- **Current major active stage:** AUT-CONNECTOR-SHARED-HELPERS-0 — Shared Read-Only Connector Foundation Cleanup, on `refactor/automation-connector-shared-helpers`.
- **Last completed stage on `main`:** RUNTIME-DUPLICATE-CLEANUP-0 — Canonical Runtime Function Ownership + Stage 4Z Repair (merged via PR #9) — fixed a real production bug where `js/shared/invoices.js` never actually loaded due to a `stableLineCount` redeclaration collision with `mission-orders.js`; `editInvoice`/`deleteInvoice` are now canonically owned by `invoices.js`. Preceded by INF-CF-AUTO-0 (PR #8), preceded by RES-0 (PR #5).

---

## Platform Tracks

| Track | Status | Last Completed Stage | Current / Next Stage | Blocker |
|---|---|---|---|---|
| Mythos OS Runtime | ACTIVE | Stage 3D — Planning Runtime | Stage 3E — Calendar Runtime | None — not started, awaiting authorisation |
| Automation | FOUNDATION | INF-CF-AUTO-0 (PR #8) — AUT-CONNECTOR-SHARED-HELPERS-0 pending merge (code-quality cleanup, no behaviour change) | INF-DNS-AUTO-1 — DNS Snapshot, Comparison and Drift Detection | None — not started, awaiting authorisation |
| Infrastructure / Cloudflare / OVH | FOUNDATION | INF-CF-2-PREP | INF-CF-2 — DNS migration and verification | **Blocked**: per-domain authoritative registrar/DNS-provider exports + owner approval required (`docs/CLOUDFLARE_INF_CF2_ENTRY_CRITERIA.md`) |
| Personal Intelligence | FOUNDATION | MPI-0-FINALIZATION (merged via PR #4, 2026-08-07) | MPI-1 — Context Assembler + Context Compiler | None — not started, awaiting authorisation |
| Research Intelligence | FOUNDATION | RES-0 (merged via PR #5, 2026-08-08) | RES-1 — first runtime implementation | None recorded — **NOT STARTED, NOT AUTHORISED** |
| Development Acceleration | FOUNDATION | DEVX-0 (merged via PR #6, 2026-08-07) | DEVX-1 — Dependency/Impact Graph + Automated PR Review | None — not started, awaiting authorisation |
| Mythos Automotive (umbrella) | FOUNDATION | MAE-0 | MAE-1 | **Blocked** on IDA-2 |
| ID Auto | FOUNDATION | IDA-1 | IDA-2 — PostgreSQL Core, API and Manual Capture MVP | None — next authorised Automotive implementation stage |
| Atelier Network | FOUNDATION | ATN-0 | ATN-1 | **Blocked** — after IDA-2 |
| AutoValeur | FOUNDATION | AVA-0 | AVA-1 — Public Calculator MVP | Depends on IDA-2 providing the PostgreSQL cluster |

**One-major-stage rule in force** (`docs/ROADMAP.md`): only one major implementation stage may be active across the whole repository at a time, unless explicitly authorised otherwise. As of this document, **AUT-CONNECTOR-SHARED-HELPERS-0 is the one active stage** (owner-authorised) — every other track remains at its documentation/foundation boundary, each with its own next stage named but not started.

---

## Owner-Direction Portfolio (kept separate from implementation status above)

See `docs/MYTHOS_PORTFOLIO_REGISTRY.md` for the complete, evidence-classified list. Summary: Fixpert, Parts Network, and SsangYong Parts are **OWNER_DIRECTION** (no runtime code in this repository); Education and Automotive-Workshop domain packs are **REPOSITORY_VERIFIED capability contracts with zero runtime**; Production/Creative/Events, Business/Administrative, Mobility & Logistics, and Health & Wellness are **FUTURE_CONCEPT** (Health & Wellness explicitly deferred); Agri & Community is **OWNER_DIRECTION** (a real owned domain, `agribee.tn`, but no product code).

**Do not read this table as a product roadmap of implemented features.** It is a map of strategic direction versus actual repository evidence.

---

## Owner-Selected Next Execution Priority

**INF-OVH-API-0 — OVHcloud Read-Only Connector — COMPLETE AND MERGED** (PR #7). **RES-0 — Mythos Research Intelligence Foundation — COMPLETE AND MERGED** (PR #5). **INF-CF-AUTO-0 — Cloudflare Read-Only Connector — COMPLETE AND MERGED** (PR #8, reference implementation only, no live Cloudflare credential). **AUT-CONNECTOR-SHARED-HELPERS-0 — Shared Read-Only Connector Foundation Cleanup — IN PROGRESS**, pending its own PR/merge, code-quality only, no behaviour change. **No new owner-selected next execution priority has been recorded as of this document.** MPI-1, Stage 3E, RES-1, INF-DNS-AUTO-1, IDA-2, ATN-1, and AVA-1 all remain not started and not newly prioritised by these stages.

---

## Status

This document is regenerated when a tracked stage actually completes or a track's status changes — not on every commit. See `docs/history/README.md` for the full maintenance principle shared across the project-intelligence document set.
