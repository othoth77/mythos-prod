# Mythos — Development Test Intelligence (DEVX-0)

**Machine-readable counterparts:** `projects/meta/test-impact-map.json`, `projects/meta/known-baselines.json`

---

## 1. Purpose

Turn "which tests should I run for this change?" into a lookup instead of a judgement call repeated every stage.

## 2. Test Impact Map

`projects/meta/test-impact-map.json` maps a changed file's path prefix to:

- `track` — which product/platform track owns this path,
- `targeted_tests` — the minimum test commands that cover it,
- `risk_lane` — FAST / STANDARD / HIGH_RISK (see `projects/meta/development-lanes.json`),
- `baseline_id` (optional) — a known-baseline entry to compare against instead of assuming any failure is new.

Rules are checked in array order; the first matching `path_prefix` wins per file. A change set touching multiple prefixes accumulates the **union** of matched `targeted_tests` and takes the **highest-risk** matched lane — a lane never silently downgrades because one file in the set happened to be low-risk.

A changed file matching **no** rule falls back to the `fallback` entry: `FULL_SUITE_REQUIRED` at `HIGH_RISK`. Unknown paths never silently run nothing.

## 3. Known Baseline Registry

`projects/meta/known-baselines.json` records only **independently verified** pre-existing test failures — currently the Stage 3D suite's 104/110 result with its six known `_memCache`-cascade failures (`stage3c`, `stage3b`, `stage3a5` partial, `stage3a`, `stage2d`, `stage1c-part1`).

**A new regression must never become a baseline automatically.** Promoting or changing a `known-baselines.json` entry requires a reviewed Git change to that file — never a runtime auto-write by any tool, including `scripts/mythos-stage.js`.

To confirm a failure is a known baseline rather than a new regression, compare against an isolated `git worktree` checkout of the base commit — never assume identical counts mean identical causes without checking. See `.claude/skills/mythos-error-doctor/SKILL.md` for the authoritative lookup list this registry mirrors.

## 4. Test strategy by risk lane

| Lane | Strategy |
|---|---|
| FAST | `node scripts/project-intelligence.js validate` plus JSON/Markdown validation where relevant. No product suite required unless test-impact-map-referenced paths are touched. |
| STANDARD | Targeted tests for the affected module and its direct callers, per the test impact map. Full suite only if targeted tests reveal broader regression risk. |
| HIGH_RISK | Full relevant regression suite plus explicit owner review. `close --apply` is refused for this lane regardless of test outcome — see `projects/meta/development-lanes.json`. |

## 5. Reuse, not duplication

This document and its JSON counterparts do not replace `scripts/project-intelligence.js`'s own validation of `projects/meta/project-ledger.json`, `projects/meta/project-statistics.json`, or `docs/history/DAILY_HISTORY.md` — `scripts/mythos-stage.js` shells out to `scripts/project-intelligence.js` for those checks rather than re-implementing them.
