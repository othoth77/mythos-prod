# Mythos Portfolio Registry

**Stage:** MPI-0-FINALIZATION
**Status:** Registry document. Machine-readable counterpart: `projects/meta/portfolio-registry.json`.
**Date:** 2026-08-06

---

## 1. Purpose

A single place for any future session (human or AI) to understand the whole Mythos ecosystem's actual state without re-scanning every past conversation or every doc. Every entry is classified by **evidence status** so that owner strategic direction is never confused with what the repository actually contains.

## 2. Evidence Status (mandatory distinction)

- **REPOSITORY_VERIFIED** — the repository contains documentation and/or code for this track. This does **not** mean the track is production-deployed — see `implementation_status` for that.
- **OWNER_DIRECTION** — explicitly named as future Mythos direction (by the owner, in a task prompt or elsewhere), but not yet built in this repository.
- **FUTURE_CONCEPT** — an idea not yet authorised for implementation; may not even have a name settled.

## 3. Implementation Status

`ACTIVE` (in production use) · `FOUNDATION` (architecture/docs/draft schema exist, no deployment) · `PLANNED` (named, not started) · `BLOCKED` (entry criteria unmet) · `CONCEPT` (specification only, or capability contract with zero runtime) · `UNKNOWN`.

**A `FOUNDATION` or `CONCEPT` classification is never upgraded to imply production readiness.** No percentage in this document or `docs/PROJECT_STATISTICS.md` should be read as "Mythos is X% complete" — see that document's scoping rules.

---

## 4. Platform Core

| Track | Evidence | Status | Current | Next |
|---|---|---|---|---|
| Mythos OS | REPOSITORY_VERIFIED | FOUNDATION | Stage 4AG + RUNTIME-DUPLICATE-CLEANUP-0 complete (corrected 2026-08-10, `MYTHOS-STAGE-RECONCILIATION-0` — this row originally said "Stage 3D complete / Stage 3E next," stale since Stage 3E through 4AG had already been complete since 2026-07-30/2026-08-05) | None currently authorised |
| Mythos Automation & Operations | REPOSITORY_VERIFIED | FOUNDATION | AUT-0 complete | INF-OVH-API-0 |
| Mythos Control Center | REPOSITORY_VERIFIED | CONCEPT | — | Not yet assigned a stage |
| Mythos Personal Intelligence & Skills Platform | REPOSITORY_VERIFIED (branch) | FOUNDATION | MPI-0 complete (PR #4) | MPI-1 |

## 5. Automotive

| Track | Evidence | Status | Current | Next |
|---|---|---|---|---|
| Mythos Automotive (umbrella) | REPOSITORY_VERIFIED | FOUNDATION | MAE-0 complete | MAE-1 (blocked on IDA-2) |
| ID Auto | REPOSITORY_VERIFIED | FOUNDATION | IDA-1 complete | IDA-2 |
| Atelier Network | REPOSITORY_VERIFIED | FOUNDATION | ATN-0 complete | ATN-1 (after IDA-2) |
| Fixpert (workshop pilot) | **OWNER_DIRECTION** | UNKNOWN | — | — |
| AutoCheck Standard | REPOSITORY_VERIFIED (doc only) | CONCEPT | — | — |
| Parts Network | **OWNER_DIRECTION** | CONCEPT | — | — |
| SsangYong Parts | **OWNER_DIRECTION** | BLOCKED | — | — |
| AutoValeur | REPOSITORY_VERIFIED | FOUNDATION | AVA-0 complete | AVA-1 |

**No Fixpert, Parts Network, or SsangYong Parts runtime code exists in this repository.** `docs/AUTOMOTIVE_PRODUCT_PORTFOLIO.md` states this explicitly for each. They remain owner-direction/external until repository evidence exists.

## 6. Education

| Track | Evidence | Status | Notes |
|---|---|---|---|
| Education Domain Pack | REPOSITORY_VERIFIED (branch, capability contract only) | CONCEPT | 10 capabilities defined, explicitly "no runtime support yet". Next: MPI-5. |

## 7. Production / Creative / Events

| Track | Evidence | Status | Notes |
|---|---|---|---|
| Production / Creative / Events vertical | **FUTURE_CONCEPT** | CONCEPT | No dedicated docs. Not to be confused with the existing Mythos OS **production runtime module** (`js/plugins/production.runtime.js`, Stage 3G complete) — that module is part of Mythos OS itself, not this future vertical. |

## 8. Business / Administrative / Digital Services

| Track | Evidence | Status | Notes |
|---|---|---|---|
| Business / Administrative / Digital Services | **FUTURE_CONCEPT** | CONCEPT | Only named as example domain ids ("accounting", "administration") in `docs/MYTHOS_DOMAIN_PACKS.md`; no dedicated document. |

## 9. Infrastructure

| Track | Evidence | Status | Current | Next |
|---|---|---|---|---|
| Cloudflare Edge Security | REPOSITORY_VERIFIED | FOUNDATION | INF-CF-2-PREP complete | INF-CF-2 (blocked) |
| OVHcloud / Coolify / n8n / GitHub connectors | **OWNER_DIRECTION** | PLANNED | — | INF-OVH-API-0 |

## 10. Future Portfolio Directions (owner-direction / future-concept only)

| Track | Evidence | Notes |
|---|---|---|
| Mobility & Logistics | **FUTURE_CONCEPT** | Named only under "Long-Range Optional Extensions" in `docs/AUTOMOTIVE_PRODUCT_PORTFOLIO.md`; explicitly not an authorised implementation stage. |
| Agri & Community | **OWNER_DIRECTION** | `agribee.tn` is a genuinely owned, DNS-inventoried domain (project label "AgriBee") — but zero product documentation and zero code exist. |
| Health & Wellness | **FUTURE_CONCEPT** | Explicitly deferred: `docs/MYTHOS_DOMAIN_PACKS.md` states "only if legally appropriate in a future stage; not defined here." |

---

## 11. How This Registry Is Maintained

Updated only when portfolio state actually changes (a track's evidence or implementation status changes, a new track is authorised, or a stage completes) — not on every commit. See `docs/PROJECT_HISTORY.md` §"Maintenance Principle" for the same rule applied to the broader history system, and `.claude/skills/mythos-skill-evolution/SKILL.md` for how skill-registry consistency (a related but distinct registry) is maintained.

`projects/meta/portfolio-registry.json` is the canonical machine-readable source; this document is generated from, and must stay consistent with, that file's `tracks` array. Validate with `node scripts/project-intelligence.js validate`.
