# Mythos — Project Statistics

**Stage:** MPI-0-FINALIZATION — COMPLETE AND MERGED
**Generated:** 2026-08-06 · **Updated:** 2026-08-07 (post-merge)
**Machine-readable counterpart:** `projects/meta/project-statistics.json`

---

## Scoping Rules (read first)

Every statistic below has an explicit `scope` and `source`. **None of them is a "Mythos is X% complete" product-completion estimate.** Where a percentage/ratio is shown, it is a **ROADMAP STAGE RATIO** for one specific track only (completed stages ÷ total defined stages in that track's roadmap document) — never a claim about production readiness. Raw counts are always given alongside any ratio.

This document also maintains the mandatory distinction from Phase 20: `architecture_defined` ≠ `reference_implemented` ≠ `runtime_implemented` ≠ `production_deployed` ≠ `externally_connected`. A "FOUNDATION COMPLETE" stage is not "PRODUCTION READY" — see §6.

---

## 1. Repository

| Statistic | Value | Source |
|---|---|---|
| Total commits on `main` (tracked history window) | 140 | `git log main --oneline \| wc -l` |
| MPI-0 branch commits ahead of `main` | 0 (fully merged) | `git log main..feat/mythos-personal-intelligence --oneline` |
| Merged Pull Requests | 4 (#1, #2, #3, #4) | `gh pr list --state merged` |
| Open Pull Requests | 0 | `gh pr list --state open` |

## 2. Stages

| Statistic | Value | Source |
|---|---|---|
| Stages recorded in the project ledger | 14 | `projects/meta/project-ledger.json` |
| Completed (`DONE`) | 14 | same |
| Done, pending merge (`DONE_PENDING_MERGE`) | 0 | same |
| In progress (`IN_PROGRESS`) | 0 | same |
| Blocked | 0 stages formally blocked; 2 **next** stages blocked (MAE-1 on IDA-2, INF-CF-2 on owner approval) | `docs/ROADMAP.md`, `docs/CLOUDFLARE_INF_CF2_ENTRY_CRITERIA.md` |
| Planned (named next-stage, not started) | 6 (Stage 3E, IDA-2, ATN-1, AVA-1, MPI-1, INF-OVH-API-0) | `docs/ROADMAP.md` |

**Personal Intelligence roadmap stage ratio:** 1/11 — completed MPI stages (MPI-0) ÷ total defined MPI stages (MPI-0 through MPI-10). **ROADMAP STAGE RATIO, NOT PRODUCT COMPLETION ESTIMATE.**

**Automation roadmap stage ratio:** 1/10 — completed Automation stages (AUT-0) ÷ total defined Automation stages (AUT-0 + 9 `INF-*-AUTO-*`/`OPS-AUTO-*` stages). **ROADMAP STAGE RATIO, NOT PRODUCT COMPLETION ESTIMATE.**

## 3. Tests

| Suite | Result | Notes |
|---|---|---|
| `tests/mpi-0-personal-intelligence-test.js` | **63/63** | Grew from 47 (initial PR #4 push) to 63 during this finalisation stage's Opus-review-driven fixes. |
| `tests/stage4z-test.js` | **44/44** | Regression check, unaffected by this stage. |
| `tests/stage3d-test.js` (base commit `909ced5`) | **104/110** | Run in an isolated `git worktree` at the base commit. |
| `tests/stage3d-test.js` (branch `feat/mythos-personal-intelligence`) | **104/110** | Identical failure set to base. |
| New regressions introduced by MPI-0 / MPI-0-FINALIZATION | **0** | Base and branch produce the exact same 6 failing suites. |

**Known baseline failures (not MPI-0 regressions):** `stage3c`, `stage3b`, `stage3a5` (partial), `stage3a`, `stage2d`, `stage1c-part1` (subprocess errors) — the `_memCache` core failure cascade, present on `main` before this stage and unchanged by it. See `.claude/skills/mythos-error-doctor/SKILL.md` for the authoritative lookup list.

## 4. Skills

| Statistic | Value |
|---|---|
| Total Agent Skills | **20** |
| Upstream originals | 0 |
| Mythos wrappers | 0 |
| Mythos originals | 20 |
| Active | 20 |
| Deprecated | 0 |
| Extended this stage | 11 |
| New this stage | 2 (`mythos-skill-evolution`, `mythos-project-history`) |
| Registry ↔ directory consistency | Confirmed exact match — no orphaned registry entries, no unregistered directories |

No skill was replaced by an upstream equivalent — see `docs/SKILLS_SOURCES.md` §1 for why (no suitable authoritative upstream identified for repository-governance-specific or Mythos-domain-specific concerns).

## 5. Draft Database Schemas

| Schema | Table count | Deployed |
|---|---|---|
| `mythos_automotive` (`projects/automotive/`) | 31 | No |
| `atelier_network` (`projects/atelier-network/`) | 24 | No |
| `autovaleur` (`projects/autovaleur/`) | 18 | No |
| `idauto` (`projects/idauto/`) | 22 | No |
| `mythos_automation` (`projects/automation/`) | 24 | No |
| `mythos_intelligence` (`projects/personal-intelligence/`) | 15 | No |

**Zero of the 6 draft schemas is deployed.** Every file's header states this explicitly.

## 6. Architecture Maturity Distinction (mandatory — do not collapse these)

| Track | architecture_defined | reference_implemented | runtime_implemented | production_deployed | externally_connected |
|---|---|---|---|---|---|
| Mythos OS | ✓ | — | ✓ | **✓** | — |
| Mythos Automation & Operations | ✓ | — | — | — | — |
| Mythos Control Center | ✓ | — | — | — | — |
| Personal Intelligence | ✓ | **✓** | — | — | — |
| Mythos Automotive / ID Auto / Atelier Network / AutoValeur | ✓ | — | — | — | — |
| Infrastructure / Cloudflare | ✓ | — | — | — | — |

**Only Mythos OS is `production_deployed`** — the original chess-club application. Personal Intelligence is the only other track with a `reference_implemented` (illustrative, in-memory, non-persistent) layer. Every other track stops at `architecture_defined`. A "FOUNDATION" or "FOUNDATION complete" status in `docs/PROJECT_STATUS.md` never implies anything past `architecture_defined` unless this table says otherwise.

## 7. Infrastructure Connectors

| Statistic | Value |
|---|---|
| Documented connector definitions (`projects/automation/config/automation.example.json`) | 20 |
| Implemented | 0 |
| Enabled | 0 |
| Connector-dependent stages currently blocked | 1 (INF-CF-2, pending per-domain owner approval) |

## 8. Portfolio (see `docs/MYTHOS_PORTFOLIO_REGISTRY.md` for detail)

| Evidence status | Track count |
|---|---|
| REPOSITORY_VERIFIED | 12 |
| OWNER_DIRECTION | 5 |
| FUTURE_CONCEPT | 4 |
| **Total tracks recorded** | **21** |

---

## Status

Regenerated from `projects/meta/project-statistics.json` — validate with `node scripts/project-intelligence.js stats`. Statistics are recalculated when tracked evidence changes (a stage completes, a schema changes, a skill is added), not on every commit.
