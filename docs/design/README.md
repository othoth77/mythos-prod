# Mythos Design System — documentation index

**Status by document — they are not all the same.** `BRAND_ARCHITECTURE.md`
(**A-001**–**A-006**) and `MASTER_VISUAL_IDENTITY_1C_PROPOSAL.md`
(**A-009**–**A-019**) are **OWNER-APPROVED**. `COLOR_SYSTEM.md`,
`TYPOGRAPHY.md`, `GRID_AND_SPACING.md` and `DESIGN_TOKENS.md` are **canonical
specifications derived from that approval** — they introduce no new values. `LOGO_SYSTEM.md` remains **PROPOSED and not
approved**: the historical logo is still the authoritative source, no redraw is
authorised (**A-007**), and adoption of the vector reconstruction is **LOGO-2**.

**Approval is not authorisation to implement.** Nothing in `docs/design/` is
implemented, applied to a project, or referenced by production. Four migrations
are recorded and **not actioned** — `MIG-1` the gold, `MIG-2` the Playfair
declarations, `MIG-3` the semantic and control-border tokens, `MIG-4` the
Mythos Command Center palette.

**Architecture decisions settled so far:** the three tiers and the five-unit
roster (**A-001**–**A-006**); **Mythos Command Center as a product of Mythos OS
rather than a sixth unit** (**A-020**, resolving **O-A1**) —
`MYTHOS → Mythos OS → Mythos Command Center → ordre.mythosprod.xyz`; and the
**Mythos colour usage policy for public projects** (**A-021**, resolving
**O-A3**) — a Mythos-level colour is permitted **only as a controlled ecosystem
accent**, never replacing a project's primary colour and never automatically.

**Still open:** **LOGO-1** (does a vector master exist outside Git — searched,
result C, blocked on off-host access) and **LOGO-2** (adoption of the Stage 1B
reconstruction — a full proposal was delivered and the owner **placed it on
hold** pending LOGO-1). Also open from the recovery era: **C-001** / **O-002**,
the Dar Hijama charter-versus-live-site conflict, which **A-021 does not
adjudicate**.

**Raised by Stage 1E**, by computing the approved figures out to their
consequences: **C-005** (a 40 px control height cannot meet a 44 px touch
minimum — two approved statements in conflict), **GRID-1/2/3**, **SURF-1**,
**GOLD-2**, **TOKEN-1/2**. None blocks 1F; each is a decision 1F would otherwise
make by accident. Full statements in `../MYTHOS_DESIGN_DECISIONS.md` §3.4.

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
| 7 | `LOGO_SYSTEM.md` | **PROPOSED — AWAITING OWNER APPROVAL.** The mark: what was preserved from the original, what changed and why, the construction grid, and the full master set. Held pending **LOGO-1** |

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

`COMPONENT_SYSTEM.md` · `MOTION_SYSTEM.md` · `RESPONSIVE_SYSTEM.md` · `ACCESSIBILITY.md` ·
`IMAGE_ART_DIRECTION.md` · `BUSINESS_UNITS.md` · `PUBLIC_WEBSITES.md` ·
`BRAND_GOVERNANCE.md`

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
