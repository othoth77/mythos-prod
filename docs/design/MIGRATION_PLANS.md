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
| **Current state** | Implemented, internal, not deployed publicly. **MIG-1 executed AUTO-7** — see below. Playfair Display (**MIG-2**'s target, not executed) and the `--muted` 3.47:1 contrast failure **A-015** (**MIG-3**, not executed) remain |
| **What migration means** | ~~`MIG-1` (gold to `#D9A441`)~~ **done**. `MIG-2` (Playfair replacement), `MIG-3` (semantic/control-border token alignment) still land here |
| **Visual-regression tooling** | **Built, pilot-verified (AUTO-6) and used for a real execution (AUTO-7)** — `tools/visual-verify.js` (repo root) drives the real application locally, zero real data or credentials, cannot target production; extended with a `sv:<view>` mode reaching the accounting/comptabilité modules directly through the real router. See `MIG_EXECUTION_MAPPING.md` |
| **MIG-1 — DONE, AUTO-7** | All 331 real occurrences (16 files — larger than either the original "1 value" or AUTO-6's own "42/12" estimate) substituted to the approved values, verified across 16 real application views including every accounting module, zero remaining trace, two real bugs (CRLF corruption, an orphaned DOM selector) caught and fixed before commit. **Committed to `main`, not deployed** — production is a separate host reached only by manual operator `rsync`, untouched |
| **MIG-2 — attempted, rolled back, AUTO-8** | 93/93 occurrences substitute cleanly, Arabic confirmed unaffected, but real visual regression found a genuine KPI-card text-wrap issue (`.compta-kpi`/`.stat-value`) Archivo Expanded's wider metrics cause. Rolled back rather than patched with an unauthorised resize decision. Blocked on a real design question, not tooling or scope. See `MIG_EXECUTION_MAPPING.md` §3a |
| **MIG-3 — partially executed, AUTO-9** | `--muted` (73 occurrences) and `--danger` (2) corrected and applied, verified across 17 real views (0.73–1.46% diff, MIG-1's low-risk range). `--past` and the control-border token (A-016) deliberately left open — no approved target for the former, too broad a blast radius for the latter. See `MIG_EXECUTION_MAPPING.md` §4 |
| **MIG-4 — checked, left BLOCKED, AUTO-9** | Not attempted. MCC-1 (Command Center) is confirmed live, deployed, serving real public traffic (`ordre.mythosprod.xyz`) — not a reference/stub. A-020's approval is classification only; a standing instruction never to touch MCC-1 applies. See `MIG_EXECUTION_MAPPING.md` §5a |
| **Risk** | High for MIG-2/3, same reasoning as MIG-1 before AUTO-7. MIG-1 itself: risk realized and mitigated, not merely reduced — real execution, real verification, real rollback path (`git revert`) |
| **Recommended order** | Last, after every other migration has proven the process on lower-risk targets |

### 1.2 Mythos OS Console (`projects/mythos-os-console/`) — the C-006 reconciliation, distinct from MIG-4

**Correction, AUTO-9.** This section's heading previously named "Command
Center" alongside the console and called this reconciliation `MIG-4` —
both wrong. `MIG-4` is Command Center's own palette migration (§1.3
below); the console's `--mythos-*` reconciliation (**C-006**/**AUTO-2**)
was never assigned its own `MIG-N` number in the register. Corrected here
rather than silently, per this document's own standing discipline.

| | |
|---|---|
| **Current state** | Built, tested (322/322 at the time; MOS-3C brought the suite to 419/158/257), **not deployed** — blocked at a confirmed `deploy`-user privilege boundary (MOS-1.6/1.7), re-confirmed by MOS-3 PRODUCTION ACTIVATION from a session with real host access; unrelated to design readiness |
| **What migration means** | Reconciling `mythos.css`'s `--mythos-*` values with the canonical spec (the exact conflict **C-006**/**AUTO-2** named) — not itself numbered `MIG-N` |
| **EXECUTED — AUTO-10, 2026-08-19** | All drift-governed values reconciled (5 tokens, their derived tokens, 32 hardcoded rgba literals). The suite's own drift rule had correctly turned `main` red (414/419) when MIG-1/MIG-3 migrated `css/main.css` — this reconciliation restored **419/419**, with computed-style verification against a live browser and a 1.26% before/after visual diff confined to gold chrome. Console typography (Playfair/Inter) deliberately untouched — follows MIG-2's resolution |
| **Risk** | Realized and closed for the colour system; remaining console typography risk is bounded by the same suite |
| **Order** | Done first among the Mythos-owned CSS targets, exactly as this table recommended |

### 1.3 Command Center (`projects/command-center/`) — `MIG-4`, checked and left BLOCKED

| | |
|---|---|
| **Current state** | **Confirmed live, deployed, serving real public traffic** at `ordre.mythosprod.xyz` — real DNS, a real TLS certificate, a real PostgreSQL database, running from the live checkout under a `deploy`-owned systemd unit. Not a reference/stub the way the console's pilot target is |
| **What migration means** | Bringing Command Center's own palette (light `#f6f7f9` / indigo `#4f46e5`) into the Mythos OS visual language, now that **A-020** classifies it as a Mythos OS product rather than an independent entity |
| **Blocked on** | Three convergent facts, **AUTO-9**: (1) A-020's own text — "this approval is classification only... no code, CSS, asset, deployment or branding was changed" — never authorised implementation. (2) A standing, unrevoked instruction never to touch MCC-1. (3) MCC-1 is genuinely live production, not a safe local pilot target the way Mythos Prod or the console are |
| **Risk** | Not assessed — deliberately. No file under `projects/command-center/` was read or touched to reach the block decision |
| **Recommended order** | Not scheduled. Requires an owner decision to lift the standing MCC-1 constraint before any further step, including safety assessment, is appropriate |

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

Executed, AUTO-7/8/9 — updated 2026-08-19:
  → MIG-1 (gold): DONE. 331 occurrences, 16 files, verified, committed to
    main, not deployed.
  → MIG-2 (Playfair): ATTEMPTED, ROLLED BACK. 93/93 substituted cleanly,
    but real visual regression found a KPI-card text-wrap issue; reverted
    rather than shipped with an unauthorised resize fix.
  → MIG-3 (semantic tokens): PARTIAL. --muted/--danger corrected and
    applied; --past and the control-border token left open, no approved
    target / too broad a blast radius respectively.
  → MIG-4 (Command Center): CHECKED, BLOCKED. MCC-1 confirmed live
    production, a standing constraint against touching it applies, A-020
    authorises no implementation. Not attempted.
  → Mythos OS Console reconciliation (C-006, not itself numbered):
    EXECUTED, AUTO-10 (2026-08-19). mythos.css reconciled to the canonical
    values (drift-test-enforced, 419/419 green — main had been red 414/419
    since AUTO-7/9, an honest miss those passes' entries did not catch).
    Console typography (Playfair/Inter) intentionally not touched — it
    follows MIG-2's resolution.

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
