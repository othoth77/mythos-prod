# Mythos Design System — documentation index

**Status by document — they are not all the same.** `BRAND_ARCHITECTURE.md`
(**A-001**–**A-006**) and `MASTER_VISUAL_IDENTITY_1C_PROPOSAL.md`
(**A-009**–**A-019**) are **OWNER-APPROVED**. `COLOR_SYSTEM.md`,
`TYPOGRAPHY.md`, `GRID_AND_SPACING.md` and `DESIGN_TOKENS.md` are **canonical
specifications derived from that approval** — they introduce no new values.
`COMPONENT_SYSTEM.md`, `RESPONSIVE_ACCESSIBILITY_MOTION.md` and
`PUBLIC_ECOSYSTEM_ARCHITECTURE.md` are **specifications only**, and every line in
them is labelled **OWNER-APPROVED**, **DERIVED**, **PROPOSED**, **AUTO-\*** or
**OPEN** — because **thirteen of the twenty-one components have no approved base
specification**, and because the ecosystem architecture describes surfaces that
in several cases **do not exist yet**. `LOGO_SYSTEM.md`'s reconstruction is now
the **ADOPTED production master** (**AUTO-1**, delegated mandate, **NOT
owner-approved** — see `MYTHOS_DESIGN_DECISIONS.md` §0.5): the historical logo
remains the authoritative historical source regardless, and no redraw is
authorised (**A-007**).

**AUTO-\* is a distinct category from A-\*.** Introduced 2026-08-18 under an
explicit, dated delegation of authority the owner confirmed directly. Every
**AUTO-\*** decision is fully reversible, changes no live file, and can be
accepted, amended or reversed by a genuine owner review at zero cost. It is
never represented as an owner approval — see §0.5 for the full authority chain
and the six rules every AUTO-\* decision follows.

**Approval is not authorisation to implement.** Nothing in `docs/design/` is
implemented, applied to a project, or referenced by production. Four migrations
are recorded and **not actioned** — `MIG-1` the gold, `MIG-2` the Playfair
declarations, `MIG-3` the semantic and control-border tokens, `MIG-4` the
Mythos Command Center palette.

**Architecture decisions settled so far:** the three tiers and the five-unit
roster (**A-001**–**A-006**); **Mythos Command Center as a product of Mythos OS
rather than a sixth unit** (**A-020**, resolving **O-A1**) —
`MYTHOS → Mythos OS → Mythos Command Center → ordre.mythosprod.xyz`; and the
**control height and touch target are two different things** (**A-022**,
resolving **C-005**) — the visual box may stay 40 px, the hit box must reach
44 × 44, and the hit area may extend beyond the visual box; and the
**Mythos colour usage policy for public projects** (**A-021**, resolving
**O-A3**) — a Mythos-level colour is permitted **only as a controlled ecosystem
accent**, never replacing a project's primary colour and never automatically.

**Still open:** **LOGO-1** (does a vector master exist outside Git — narrowed
2026-08-18, one of three off-host repositories now searched with a genuine
negative, two remain blocked — **AUTO-1**) and **GRID-2** (68ch vs 65
characters — narrowed to a stated design intent, not fully closed, pending real
font metrics). Also open from the recovery era: **C-001** / **O-002**, the Dar
Hijama charter-versus-live-site conflict, which **A-021 does not adjudicate**.

**Resolved 2026-08-18 under the delegated mandate (AUTO-1 through AUTO-3):**
**LOGO-2** (adopted as production master, not owner-approved), **C-006**
(canonical system named — execution still deferred, see AUTO-2), ~~**C-005**~~
(resolved by **A-022**, owner-approved, unaffected), **GRID-1**, **GRID-3**,
**SURF-1**, **GOLD-2**, **GOLD-3**, **TOKEN-1**, **TOKEN-2**, **MOTION-1/2/3**,
**LINK-1**, **SHAPE-1**, **TYPE-2**, **TYPE-3**, **SPACE-1**, **A11Y-1/2**,
**SEQ-1**, **ECO-1/2/3**. Full statements and every value:
`../MYTHOS_DESIGN_DECISIONS.md` §0.5. Machine-readable tokens:
`../../assets/brand/tokens/tokens.css`.

**Raised by Stage 1H**, by describing the ecosystem against recorded evidence
rather than intent: **ECO-1** (the brand tree nests Command Center under Mythos
OS while the domains make them siblings), **ECO-2** (`panel.` and `tv.` are live
subdomains of the master domain with no place in the architecture) and **ECO-3**
(twelve projects exist outside the owner's list of eight, KnowledgeVault KMS
alone being 752 files). See §3.7.

**Raised by Stage 1G**, by computing the responsive and accessibility
consequences: **TYPE-3**, **SPACE-1**, **A11Y-1**, **A11Y-2**, **MOTION-2**,
**MOTION-3**. See §3.6.

**Raised by Stage 1F**, by specifying components against the approved rules:
**MOTION-1** (*"nothing loops, nothing autoplays"* versus the required loading
state — a spinner does both), **LINK-1** (the inline text link has no approved
colour, because gold is reserved and no other accent exists), **SHAPE-1** (a
switch needs a pill; `radius-pill` is approved for avatars and status dots only)
and **GOLD-3** (every select chevron in gold would break the one-gold-per-view
scarcity rule). See §3.5, and `COMPONENT_SYSTEM.md` §9 for the map of which
components each open item affects.

## Reading order

Start with the evidence, then the structure, then the mark.

| # | Document | What it settles |
|---|---|---|
| 0 | `../MYTHOS_DESIGN_RECOVERY.md` | What design work already existed, with evidence. **Read before anything else** |
| 0 | `../design-recovery/MYTHOS_ORIGINAL_LOGO_RECOVERY.md` | The canonical record of the original Mythos logo |
| 1 | `BRAND_ARCHITECTURE.md` | **OWNER-APPROVED.** The three tiers — master brand, endorsed units, independent projects — what each inherits, where Mythos Command Center sits (§4.4), and when a project may use a Mythos colour (§5.5) |
| 2 | `MASTER_VISUAL_IDENTITY_1C_PROPOSAL.md` | **OWNER-APPROVED.** The visual system: Constant + Movement, the 35° gesture, colour, type, spacing, shape, components, motion, responsive and accessibility |
| 3 | `COLOR_SYSTEM.md` | **Derived, canonical.** Mythos Gold `#D9A441`, the ink and paper ramps, semantics verified on four surfaces, focus and non-text boundaries |
| 4 | `TYPOGRAPHY.md` | **Derived, canonical.** Archivo Expanded + IBM Plex Sans / Sans Arabic / Mono, the scale, and the six binding Arabic rules |
| 5 | `GRID_AND_SPACING.md` | **Derived, canonical.** The 12-step spacing scale, the 4 / 8 / 12 grid with measured column widths, the five breakpoints, the radius scale — and the proof that **no baseline grid is possible** with the approved type scale |
| 6 | `DESIGN_TOKENS.md` | **Derived, canonical.** The three tiers, the naming grammar, and the **59-token semantic layer** measured against the approved 40–60 ceiling. **No token artifact was generated** — that is `TOKEN-1`, unauthorised |
| 7 | `COMPONENT_SYSTEM.md` | **SPECIFICATION.** Twenty-one components, each with structure, dimensions, tokens, six states, keyboard, touch, accessibility, responsive and reduced-motion behaviour. Carries **A-022**, which separates the visual box from the hit box |
| 8 | `RESPONSIVE_ACCESSIBILITY_MOTION.md` | **SPECIFICATION.** The four device classes against the five approved bands, the WCAG 2.2 floor, and the motion system. Records that **zoom moves the user down the same bands** — 200 % lands in tablet, 400 % in mobile — and that **no baseline grid is possible**. **MOTION-1 left OPEN by owner instruction** |
| 9 | `PUBLIC_ECOSYSTEM_ARCHITECTURE.md` | **ARCHITECTURE.** How MYTHOS relates to its units, its products and the independent public projects: endorsement rules, where MYTHOS may and may not appear, domain architecture, hub structure, onboarding and governance. Carries an **evidence-based status ledger** — five projects LIVE, three BUILT but unserved, and **the master brand with no public surface at all** |
| 10 | `LOGO_SYSTEM.md` | **ADOPTED — AUTO-1, not owner-approved.** The mark: what was preserved from the original, what changed and why, the construction grid, and the full master set. **LOGO-1** stays open and the reconciliation condition stays binding |
| 11 | `MYTHOS_DESIGN_SYSTEM.md` | **Consolidated reference.** Every canonical value from 1C–1I and AUTO-1–3 in one topic-ordered document — start here for "what do I build against," not the stage-by-stage history |
| 12 | `IMPLEMENTATION_READINESS_AUDIT.md` | **Finding, not a plan.** Nothing in this program has been implemented or verified in any running application. Five concrete prerequisites named, none satisfied |
| 13 | `MIGRATION_PLANS.md` | **Plans, not authorisation.** A calibrated plan per project and Mythos-owned surface — most reduce to "ecosystem strip only" or "no action" once **A-006** and the open evidence questions are respected |
| 14 | `prototypes/` | **Seven static HTML prototypes**, matching the original brief's §23. Not deployed |

## Companion records outside this directory

| Document | Role |
|---|---|
| `../MYTHOS_DESIGN_STRATEGY.md` | Strategic baseline extracted from existing work |
| `../MYTHOS_DESIGN_DECISIONS.md` | Decision register — **`A-*` owner-approved**, `D-*` recovered evidence, `O-*` open, `C-*` conflicting, `U-*` unknown |
| `../design-recovery/PENDING_VECTOR_SOURCE_TASK.md` | Pending investigation **LOGO-1** — does a vector master exist outside Git? |
| `../MYTHOS_PROJECT_DESIGN_MATRIX.md` | Per-project design state, cell by cell |
| `../MYTHOS_DESIGN_ROADMAP.md` | Sequence of design stages |
| `../../assets/brand/README.md` | Generated logo masters and how to rebuild them |

## Still to be written

`IMAGE_ART_DIRECTION.md` · `BUSINESS_UNITS.md` · `BRAND_GOVERNANCE.md`

**Superseded placeholder names.** `RESPONSIVE_SYSTEM.md`, `ACCESSIBILITY.md` and
`MOTION_SYSTEM.md` are all covered by the single `RESPONSIVE_ACCESSIBILITY_MOTION.md`,
as the owner named it at 1G. `PUBLIC_WEBSITES.md` is covered by
`PUBLIC_ECOSYSTEM_ARCHITECTURE.md`, as the owner named it at 1H.

Each of these has an approved source section in
`MASTER_VISUAL_IDENTITY_1C_PROPOSAL.md`, so writing them is derivation rather
than fresh decision-making.

These are listed so their absence is visible. An empty slot here means the
decision has **not** been made — never that it was made and left unwritten.

## Conventions

- Owner direction and recovered evidence are always kept apart. Intent is never
  written as though it were history.
- Open decisions are named with a reference and left open, rather than settled
  quietly inside a specification.
- Historical assets and charters are preserved. No recovered work is overwritten
  by a later stage.
