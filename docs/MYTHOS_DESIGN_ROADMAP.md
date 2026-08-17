# Mythos Design Roadmap

**Stage:** MYTHOS-DESIGN-RECOVERY-0
**Date:** 2026-08-17 UTC
**Baseline:** `main` @ `fcd899b`

A **design** roadmap only. Nothing here is implemented, authorised, or started.
Stage 0 is complete; **Stage 1 is not authorised to begin** and is blocked on an
owner decision.

Each stage states its entry condition honestly. Where the recovery audit changed
the shape of a stage, that is noted — the suggested outline has been adjusted to
match what the evidence actually shows.

---

## Adjustments made from recovered evidence

The audit changed four things about the suggested stage list:

1. **Stage 1 is blocked, not merely "next."** O-001 (brand independence vs Mythos
   consistency) must be decided by the owner first. Everything downstream inherits
   that answer.
2. **A new Stage 2.5 was inserted** — *Recover untracked design assets into Git*.
   The portfolio's only vector suite and its two written charters exist **only on
   the VPS**. Preserving them is cheap, urgent, and independent of every design
   decision. It should not wait behind a design system.
3. **Stage 8 (responsive) is raised in priority.** For a Tunisia-facing,
   mobile-dominant portfolio, having no responsive standard is the largest
   practical gap found. It is marked as promotable ahead of Stages 5–7.
4. **Stage 6 is conditional.** Three of the five named Mythos companies have
   **zero recovered evidence**. The stage cannot be scoped until O-004 says
   whether they are brands or organisational labels.

---

## STAGE 0 — Design recovery

**Status: COMPLETE (2026-08-17).**

Recovered: two written brand charters, one of them implemented; the Mythos OS
252-token system; four independent project palettes; 1,787 unmerged lines of
Mouain product documentation; a 2,241-file preserved transfer package; twelve
projects outside the supplied ecosystem list.

Deliverables: `MYTHOS_DESIGN_RECOVERY.md`, `MYTHOS_DESIGN_STRATEGY.md`,
`MYTHOS_DESIGN_DECISIONS.md`, `MYTHOS_PROJECT_DESIGN_MATRIX.md`, this file.

**No design was created or changed.**

---

## STAGE 1 — Mythos master brand architecture

**Status: BLOCKED — not authorised.**
**Entry condition: owner decides O-001.**

Until brand independence vs Mythos consistency is settled, a master architecture
cannot be specified without pre-empting the owner's decision. The evidence points
both ways: four projects use unrelated palettes (independence), yet the live Dar
Hijama site reaches for the Mythos gold `#c9a84c` over its own charter green
(consistency).

**Scope when unblocked:** define whether Mythos is a monolithic brand, a branded
house, or a house of brands; decide whether projects carry a Mythos endorsement
mark; resolve O-004 (do Services/Digital/Logistique exist as brands?).

**Do not begin this stage.**

---

## STAGE 2 — Mythos master visual identity

**Entry condition: Stage 1 complete.**

Mythos currently has a wordmark PNG and no specification. This stage would
produce what U-001 through U-004 record as missing: the rationale and definition
of the Mythos colour (the gold `#c9a84c` exists but its meaning is unrecorded),
a master typography decision, a spacing and grid scale, and logo usage rules.

**Reusable precedent already recovered:** D-006 (Dar Hijama clear-space and
minimum-size rules) and D-008 (the SVG + editable-SVG + PNG ladder + favicon) are
the portfolio's only asset standards. Both are directly promotable.

---

## STAGE 2.5 — Recover untracked design assets into Git

**Status: READY. Not blocked by any design decision.**
**Inserted by the recovery audit.**

The portfolio's most valuable design artifacts are untracked and exist in one
place only:

- Dar Hijama's 15-file vector suite — **the only real SVG set Mythos owns**
- `CHARTE_GRAPHIQUE.md` (Uthina) and `dar-hijama-piste1-charte-corrigee.txt` —
  **the only two written charters**
- `uthina-theme.css` — the only implemented charter
- NotreJour's 7 deferred design files (needs O-005 first)

`mythos-prod` tracks **zero SVG and zero fonts** today. This stage is
preservation, not design, and can proceed in parallel with Stage 1.

**Caution recorded:** `projects/ssangyong-autos/deploy/` remains untracked with
unresolved repo-vs-installed drift; that is a separate decision and must not be
swept into this stage.

---

## STAGE 3 — Shared Mythos design system

**Entry condition: Stages 1 and 2 complete.**

Would resolve C-004 — four palettes, two colour schemes, four radius scales,
three naming conventions, zero shared files.

**Genuine reusable material already exists** and should be the starting point
rather than a fresh invention: the `-dim` / `-soft` semantic-pairing convention
(independently arrived at twice), `:root` custom properties as the token
mechanism (all four stylesheets), Inter as body typeface (four projects), and
paired Arabic/Latin type stacks (both charters).

**Constraint:** this stage must decide what happens to the four existing
palettes. Retrofitting them is a breaking change to live services.

---

## STAGE 4 — `mythosprod.xyz` public hub

**Entry condition: Stages 1–2 complete; O-003 decided.**

**No apex vhost exists.** Only `panel`, `tv` and `ordre` subdomains are served.
The master domain currently shows nothing.

---

## STAGE 5 — Mythos OS public identity and UI

**Entry condition: Stages 2–3 complete.**

Mythos OS has the portfolio's only mature design system — and no design
documentation whatsoever. Its visual layer has not been revised since the initial
import `d1a9d19` (2026-07-29); only two commits in the entire history have ever
touched `css/` or `assets/`.

This stage would document what exists before changing anything.

---

## STAGE 6 — Mythos company websites

**Status: CONDITIONAL — cannot be scoped yet.**
**Entry condition: O-004 decided.**

Mythos OS is verified. Mythos Prod exists as a name only. **Mythos Services,
Mythos Digital and Mythos Logistique have zero recovered evidence** — no
document, directory, domain, asset, or commit. Whether they are brands to design
or organisational labels is unknown, and the stage's size depends entirely on
that answer.

---

## STAGE 7 — Public project websites

**Entry condition: Stages 1–3 complete.**

Per-project state and priority, from the matrix:

| Project | Need |
|---|---|
| Dar Hijama | **Resolve C-001 first** — charter and live site disagree completely |
| AgriBee | Files and logo exist; **no vhost** — decide O-007 |
| ID Auto | No public site exists at all |
| Mouain | **Merge O-006 first**; 1,787 lines are invisible from `main` |
| Fixpert | Built, entirely undocumented |
| SsangYong | Mature build, no brand documentation |
| NotreJour | Largest app; 7 design files still unplaced (O-005) |
| Uthina Chess | **Strongest in portfolio.** Needs only O-008 (five parallel copies) |

---

## STAGE 8 — Responsive and mobile standardisation

**Status: PROMOTABLE — recommended ahead of Stages 5–7.**

The largest practical gap found. Recovered evidence totals one breakpoint
(ID Auto `520px`), one `clamp()` (Uthina), and three layout defects found and
fixed once on SsangYong. There is no breakpoint set, no mobile-first statement,
and no device matrix anywhere.

For a Tunisia-facing portfolio where mobile dominates, this affects every live
site today — unlike Stages 5–7, which affect sites not yet built.

**Recommendation:** promote ahead of Stages 5–7 once Stage 3 defines tokens.

---

## STAGE 9 — Motion system

**Entry condition: Stage 3 complete.**

Nothing exists. No animation, transition, hover, scroll, or micro-interaction
convention in any project.

**Recorded so it is not mistaken for prior work:** `VPS_TRANSFER/SKILL_MOTION (2).md`
is a generic third-party motion-design skill for a video connector. It is **not**
Mythos design work and contains no Mythos decision.

The only recovered motion-adjacent token is Uthina's
`--uc-shadow-gold: 0 0 38px rgba(217,164,65,.32)`.

---

## STAGE 10 — Future project onboarding

**Entry condition: Stages 1–3 complete.**

Nothing describes how a new project should be onboarded. Every project to date
appears designed independently from scratch — which is consistent with the
four-palette outcome and, if left unaddressed, guarantees a fifth palette.

**Also promotable:** D-010 (headless-browser visual verification) is the
portfolio's only proven design-QA method, applied once and never generalised
(O-009).

---

## Dependency summary

```
STAGE 0 ✅ complete
    │
    ├─── STAGE 2.5  ready now, independent of every design decision
    │
    └─── O-001 (owner) ──► STAGE 1 ──► STAGE 2 ──► STAGE 3 ──┬─► STAGE 8  ◄── promotable
                                          │                   ├─► STAGE 5
                                          ├─► STAGE 4 (O-003) ├─► STAGE 7 (O-005..O-008)
                                          └─► STAGE 6 (O-004) ├─► STAGE 9
                                                              └─► STAGE 10
```

**Only two things can proceed without an owner decision: Stage 2.5, and merging
Mouain (O-006). Everything else waits on O-001.**

**Stage 1 is not authorised. Do not begin it.**
