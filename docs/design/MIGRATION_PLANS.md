# MYTHOS Migration Plans

**Stage:** mandate item 8
**Date:** 2026-08-18 UTC
**Status:** **PLANS ONLY. Nothing in this document is executed.** No project,
CSS, application or asset file is touched by writing these plans down.

**Scope.** A plan for every project and surface named in this program's
evidence base: the eight public projects, Mythos OS, Mythos Command Center,
and the four named migrations (MIG-1–4). **Plans are sequenced by actual risk
and dependency, not by a fixed order** — see `IMPLEMENTATION_READINESS_AUDIT.md`
§5 for the cross-cutting prerequisites every plan below assumes.

**What a plan is, here.** For each target: current state (from the
evidence-based ledger already recorded), what migrating would mean concretely,
what it depends on, and an honest risk rating. **None of these is
authorised for execution by being written down.**

---

## 1. Mythos-owned surfaces

### 1.1 Mythos OS (`css/main.css` and the application it styles)

| | |
|---|---|
| **Current state** | Implemented, internal, not deployed publicly. Source of the recovered `--c9a84c` gold (**D-001**), Playfair Display (**MIG-2**'s target), and the `--muted` 3.47:1 contrast failure **A-015** corrected in specification |
| **What migration means** | `MIG-1` (gold to `#D9A441`), `MIG-2` (Playfair replacement), `MIG-3` (semantic/control-border token alignment) all land here |
| **Visual-regression tooling** | **Built and pilot-verified, AUTO-6** — `tools/visual-verify.js` (repo root) drives the real application locally, zero real data or credentials, cannot target production. See `MIG_EXECUTION_MAPPING.md` for the pilot result and the real, re-measured scope of MIG-1 (42 occurrences, 12 files — not 1) and MIG-2 (93 occurrences, 14 files — not 45). Coverage gap named honestly: the pilot's three views don't reach the accounting/fournisseurs modules where most of the JS-literal occurrences concentrate |
| **Blocked on** | Not tooling any more. What remains: executing the full multi-file change (39 JS/HTML literal sites for MIG-1 alone) correctly and re-verifying it, including the accounting views the current pilot doesn't reach — real work, not a missing capability. Still the **highest-risk target in the whole program** — it is the file every other document in this project measured contrast *from*, and it is genuinely live production (`uthinachess.tn`) |
| **Risk** | High. Silent regression would affect whatever currently consumes this file. Mitigated, not eliminated, by AUTO-6's tooling |
| **Recommended order** | Last, after every other migration has proven the process on lower-risk targets |

### 1.2 Mythos OS Console / Command Center (`projects/mythos-os-console/`)

| | |
|---|---|
| **Current state** | Built, tested (322/322 at the time; MOS-3C brought the suite to 419/158/257), **not deployed** — blocked at a confirmed `deploy`-user privilege boundary (MOS-1.6/1.7), re-confirmed by MOS-3 PRODUCTION ACTIVATION from a session with real host access; unrelated to design readiness |
| **What migration means** | `MIG-4` — reconciling `mythos.css`'s `--mythos-*` values with the canonical spec (the exact conflict **C-006**/**AUTO-2** named) |
| **Blocked on** | The same visual-regression gap as 1.1, though at **smaller scope** — this file has its own isolated test suite (`tests/mos-1-console-test.js`) and its own headless-browser tool (`projects/mythos-os-console/tools/visual-verify.js`, distinct from the repo-root `tools/visual-verify.js` AUTO-6 added for Mythos Prod), unlike `css/main.css` |
| **Risk** | Medium — real, but bounded by existing tooling that already covers this specific file |
| **Recommended order** | **First** among the two Mythos-owned CSS targets — it is the one this program already has verification tooling for |

### 1.3 `mythosprod.xyz` (the hub)

| | |
|---|---|
| **Current state** | **Does not exist.** No apex vhost (**O-003**) |
| **What migration means** | Not a migration — a **new build**, following `PUBLIC_ECOSYSTEM_ARCHITECTURE.md` §9's structure and the 1I prototype (`2-mythosprod-hub.html`) as a starting point |
| **Blocked on** | **O-003** itself — whether the owner wants this built at all is still an open question this program has never been asked to resolve |
| **Risk** | Low, once authorised — greenfield, nothing to regress against |
| **Recommended order** | Independent of the others; could run in parallel with any migration since it has no existing consumer to conflict with |

---

## 2. Public projects — plan calibrated to actual state

**Every plan below respects A-004/A-006: a project's own logo, palette and
primary identity are never migrated.** What could migrate, for any of these,
is limited to the **ecosystem-strip footer** (A-021) and the **shared
standards** (A-005 — accessibility, responsive, spacing principles) — never
the visual skin.

| Project | Status | Plan | Risk |
|---|---|---|---|
| **Uthina Chess** | Live | **Ecosystem strip only**, if the owner wants MYTHOS attribution visible. No skin change | Low |
| **SsangYong.autos** | Live, no charter | **Ecosystem strip only**. No charter exists to migrate | Low |
| **Fixpert** | Live, logo only | **Ecosystem strip only** | Low |
| **Notre Jour** | Live, blueprint deferred | **No action** — its own design work is uncommitted/deferred; not this program's decision to complete | None |
| **Dar Hijama** | Live, proxied, **charter unimplemented (C-001/O-002)** | **Not this program's plan to write.** C-001 is a real conflict between the project's own charter and its live site — adjudicating it is a project-level decision, not a system migration |
| **AgriBee** | Built, unserved (**O-007**) | **No action** until **O-007** (is it intended to be served) is answered | None |
| **ID Auto** | Built, unserved | **No action** — internal admin only, no public surface to migrate | None |
| **Mouain** | Built, unserved, 1,787 unmerged lines (**O-006**) | **No action** until **O-006** (merge the lines?) is answered — migrating a design system onto uncommitted work is premature |

**The honest pattern:** five of eight plans reduce to "ecosystem strip only, if
wanted" or "no action" — because **A-006 already forbids the skin migration**
that would be the interesting part, and the three unserved projects have open
factual questions (**O-006/007**) that come before any design question.

---

## 3. Internal infrastructure and out-of-scope surfaces

| Surface | Plan |
|---|---|
| `panel.mythosprod.xyz`, `tv.mythosprod.xyz` | **No migration** — classified internal infrastructure (**ECO-2**, AUTO-3), carries no Mythos branding by design, nothing to align |
| The twelve projects outside the owner's list (**ECO-3**) | **No migration** — classified internal tooling/archive, no public surface exists to carry a design system |

---

## 4. Sequencing summary

```
Can start now (no CSS/application-file prerequisite):
  → mythosprod.xyz hub (if O-003 authorises building it at all)
  → Ecosystem-strip footers on any live project the owner wants attributed

Tooling gap closed for Mythos Prod (AUTO-6) — execution itself still pending:
  → Mythos OS Console reconciliation (MIG-4) — smaller scope, existing tooling
  → css/main.css reconciliation (MIG-1/2/3) — largest scope; tooling now
    exists and one layer is pilot-verified (see `MIG_EXECUTION_MAPPING.md`),
    but the real scope is 42 (MIG-1) and 93 (MIG-2) occurrences across 12
    and 14 files respectively — not the 1-value/45-declaration estimates
    this document previously carried — so execution is real, multi-file
    work, not a missing capability any more

Needs an evidence question answered first, not a design decision:
  → AgriBee   (O-007: is it meant to be served?)
  → Mouain    (O-006: merge the 1,787 lines?)
  → Dar Hijama (O-002: which artifact is authoritative?)

No action contemplated:
  → Notre Jour, ID Auto, panel./tv., the twelve extra projects
```

**Nothing in this document is a commitment to execute any of the above.** It
is the honest shape of the work, so that whichever piece is authorised next —
by the owner or under a future delegated mandate — starts from a real map
rather than a guess.
