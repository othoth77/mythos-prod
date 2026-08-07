# Mythos — Project Status

**Stage:** MPI-0-FINALIZATION
**Generated:** 2026-08-06
**Purpose:** Quick "where are we now" snapshot. Full detail lives in `docs/AI_HANDOVER.md` (stage semantics), `docs/ROADMAP.md` (intentions), `docs/history/DAILY_HISTORY.md` (day-by-day), and `docs/PROJECT_STATISTICS.md` (numbers).

---

## Current Source of Truth

- **Current `main` HEAD (before this finalisation stage merges):** `909ced531dab7095cc6511efd6e646ba4befa07c`
- **Active PRs:** #4 — "Mythos Personal Intelligence & Skills Platform — MPI-0 Foundation" (`feat/mythos-personal-intelligence` → `main`), open/draft as of this document's generation; being finalised in this same stage.
- **Current major active stage:** MPI-0-FINALIZATION (documentation/governance/tests only — no runtime stage active).
- **Last completed stage on `main`:** AUT-0 — Mythos Automation-First Master Foundation.

---

## Platform Tracks

| Track | Status | Last Completed Stage | Current / Next Stage | Blocker |
|---|---|---|---|---|
| Mythos OS Runtime | ACTIVE | Stage 3D — Planning Runtime | Stage 3E — Calendar Runtime | None — not started, awaiting authorisation |
| Automation | FOUNDATION | AUT-0 | INF-OVH-API-0 — OVH Read-Only Connector | None — not started, awaiting authorisation |
| Infrastructure / Cloudflare / OVH | FOUNDATION | INF-CF-2-PREP | INF-CF-2 — DNS migration and verification | **Blocked**: per-domain authoritative registrar/DNS-provider exports + owner approval required (`docs/CLOUDFLARE_INF_CF2_ENTRY_CRITERIA.md`) |
| Personal Intelligence | FOUNDATION | MPI-0 (pending merge via PR #4) | MPI-1 — Context Assembler + Context Compiler | None — not started, awaiting authorisation |
| Mythos Automotive (umbrella) | FOUNDATION | MAE-0 | MAE-1 | **Blocked** on IDA-2 |
| ID Auto | FOUNDATION | IDA-1 | IDA-2 — PostgreSQL Core, API and Manual Capture MVP | None — next authorised Automotive implementation stage |
| Atelier Network | FOUNDATION | ATN-0 | ATN-1 | **Blocked** — after IDA-2 |
| AutoValeur | FOUNDATION | AVA-0 | AVA-1 — Public Calculator MVP | Depends on IDA-2 providing the PostgreSQL cluster |

**One-major-stage rule in force** (`docs/ROADMAP.md`): only one major implementation stage may be active across the whole repository at a time, unless explicitly authorised otherwise. As of this document, **no major implementation stage is active** — every track above is at a documentation/foundation boundary, each with its own next stage named but not started.

---

## Owner-Direction Portfolio (kept separate from implementation status above)

See `docs/MYTHOS_PORTFOLIO_REGISTRY.md` for the complete, evidence-classified list. Summary: Fixpert, Parts Network, and SsangYong Parts are **OWNER_DIRECTION** (no runtime code in this repository); Education and Automotive-Workshop domain packs are **REPOSITORY_VERIFIED capability contracts with zero runtime**; Production/Creative/Events, Business/Administrative, Mobility & Logistics, and Health & Wellness are **FUTURE_CONCEPT** (Health & Wellness explicitly deferred); Agri & Community is **OWNER_DIRECTION** (a real owned domain, `agribee.tn`, but no product code).

**Do not read this table as a product roadmap of implemented features.** It is a map of strategic direction versus actual repository evidence.

---

## Owner-Selected Next Execution Priority

**INF-OVH-API-0 — OVHcloud Read-Only Connector.** Recorded by explicit owner instruction as the next priority to *execute* once authorised, ahead of MPI-1 or Stage 3E, because the immediate operational objective is replacing the manual OVH/domain/DNS inventory workflow (already partially performed manually in INF-CF-1) with a secure, automated, read-only collection process. **This is a priority record only — INF-OVH-API-0 is not started by this document or by MPI-0-FINALIZATION.**

---

## Status

This document is regenerated when a tracked stage actually completes or a track's status changes — not on every commit. See `docs/history/README.md` for the full maintenance principle shared across the project-intelligence document set.
