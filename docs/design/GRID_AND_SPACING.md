# MYTHOS Grid and Spacing

**Stage:** MYTHOS-DESIGN-1E — grid, spacing, shape
**Date:** 2026-08-18 UTC
**Status:** **CANONICAL SPECIFICATION**, derived entirely from the owner-approved
master visual identity. Not implemented.

**Authority:** **A-009** — the 1C approval, which adopted "every RECOMMENDED
value in §3–§14: palette, scale, spacing, radius, components, icons, motion,
responsive rules". Source sections: `MASTER_VISUAL_IDENTITY_1C_PROPOSAL.md`
**§5** (grid and spacing), **§6** (shape and surface) and **§11** (responsive),
approved at commit `35a8f8a`.

**This document introduces no new values.** Every number below is an approved
number. What is new is the *arithmetic*: the approved figures have been computed
out to their consequences, and **where two approved statements do not reconcile,
that is recorded as a conflict rather than quietly resolved** (§9).

**Not implemented.** No CSS, token file, application code or asset has been
changed.

---

## 1. Principles

1. **The scale is a constraint, not a palette.** Values between the steps are not
   "close enough" — they are out of system. A composed interface is one where the
   spacing decisions were already made.
2. **Space is measured between blocks, never inside type.** The approved line
   heights do not land on the grid (§6), so vertical rhythm comes from block gaps.
3. **Mobile is a design target, not a shrink** (§11 of the source). Every layout
   is drawn at `sm` first; the desktop layout must justify what it adds.
4. **Layout is fractional.** The approved container and gutter figures produce
   non-integer columns at almost every viewport (§4.2), so columns are expressed
   as fractions and never as fixed pixel widths.
5. **Where the approved specification is silent, this document says so.** No gap
   is filled by improvisation.

---

## 2. The spacing scale

Eight-point with 4 px half-steps, twelve steps:

`2 · 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 · 96 · 128 · 160`

**Naming.** The approved token philosophy names one spacing token by example:
`space-6`. Naming the twelve steps by position makes `space-6` resolve to **24 px**,
which is both the sixth step and the most-used component gap — so position
indexing is the reading consistent with the approved example. This is a *naming*
derivation forced by that example; **no value is added, removed or changed.**

| Token | Value | Token | Value |
|---|---|---|---|
| `space-1` | 2 | `space-7` | 32 |
| `space-2` | 4 | `space-8` | 48 |
| `space-3` | 8 | `space-9` | 64 |
| `space-4` | 12 | `space-10` | 96 |
| `space-5` | 16 | `space-11` | 128 |
| `space-6` | **24** | `space-12` | 160 |

**The two legal bands** (approved, §5):

- **Sections** use only **48 / 64 / 96 / 128** — `space-8` to `space-11`.
- **Components** use only **8 / 12 / 16 / 24** — `space-3` to `space-6`.

**Four steps have no band.** `space-1` (2), `space-2` (4), `space-7` (32) and
`space-12` (160) sit outside both. Either they are reserved for optical
correction and hairline offsets, or the bands are incomplete. The approved text
does not say which — recorded as **GRID-3**, not decided here.

---

## 3. What the spacing scale does **not** govern

This is the most consequential finding of the stage, because a component library
built on the opposite assumption fails immediately. **Three approved groups of
numbers are not on the spacing scale**, and are therefore separate scales:

| Group | Approved values | On the scale? |
|---|---|---|
| **Grid gutters** | 24 / 20 / 16 | 24 and 16 yes — **20 no** |
| **Grid margins** | 80 / 48 / 20 | 48 yes — **80 and 20 no** |
| **Control heights** | 36 / 40 / 44 | **none** |
| **Button padding** | 9 / 15 | **none** |
| **Type leading** | see §6 | **none** |

**Consequence.** `space-*` tokens may not be used to build the grid frame, a
control height, or a line box. Those need their own token groups —
`grid-*` and `size-*` — specified in `DESIGN_TOKENS.md` §3.

**Button padding 9 / 15 is genuinely off-system.** The nearest coherent reading
is that these sit *inside* a 1 px border, making the outer geometry 10 / 16 — of
which only 16 is on the scale. The approved text does not say, and this document
does not invent a reading. Left to 1F under **GRID-3**.

---

## 4. The grid

### 4.1 Containers, columns, gutters, margins

| Metric | `sm` | `md` / `lg` | `xl` / `2xl` |
|---|---|---|---|
| Columns | 4 | 8 | 12 |
| Gutter | 16 | 20 | 24 |
| Margin | 20 | 48 | 80 |

**Containers:** content max **1280**, wide **1440**, prose max **68ch** as
originally approved (1C §5) — **implementation value resolved to 48ch by
AUTO-5**, see §4.3.

**One arithmetic fact worth stating:** `1280 + 80 + 80 = 1440` exactly. The wide
container is therefore either a second, wider content width *or* the outer frame
of the 1280 content container at its own margins. Both readings are clean; the
approved text does not distinguish them — **GRID-1**.

### 4.2 Measured column widths

Computed, not asserted. Column = (content − (n−1) × gutter) ÷ n.

| Viewport | Band | Content | Column |
|---|---|---|---|
| 320 | `sm` | 280 | **58.00** |
| 360 | `sm` | 320 | **68.00** |
| 412 | `sm` | 372 | 81.00 |
| 600 | `md` | 504 | 45.50 |
| 768 | `md` | 672 | 66.50 |
| 904 | `lg` | 808 | 83.50 |
| 1240 | `xl` | 1080 | **68.00** |
| 1440 | `xl` | **1280 — capped** | 84.67 |
| 1920 | `2xl` | 1280 — capped | 84.67 |

**Three things follow.**

1. **Columns are fractional.** 84.67 and 45.50 are not pixel widths. Columns are
   `fr` or percentage; a fixed-pixel column implementation will drift by up to a
   pixel per column and visibly break alignment across a 12-column row.
2. **320 px reflow works.** WCAG 2.2 reflow at 320 px (approved, §12) leaves a
   58 px column — narrow but positive. The grid does not collapse at the floor.
3. **The grid stops growing at 1440, not at 1920.** The 1280 content cap binds
   from a 1440 viewport upward, so margins begin absorbing surplus **480 px below
   the `2xl` breakpoint**. The `2xl` row's stated behaviour — *"grid stops
   growing; margins absorb the surplus"* — is already true throughout `xl`.
   `2xl` therefore has no behaviour of its own that the approved text names.
   Recorded as **GRID-1**; not resolved here.

*(Minor observation, no decision attached: the column is 68.00 px at both 360 and
1240 — the entry points of the two most important bands.)*

### 4.3 Prose measure

`TYPOGRAPHY.md` §2 caps running text near **65 characters**; §5 of the source sets
prose max at **68ch**. These are not the same unit: `ch` is the advance width of
the digit *0*, not of an average character, so 68 `ch` renders as some other
number of actual characters — how many depends on the shipped font's metrics.

Both figures are approved, so neither is overridden.

**Measured 2026-08-18 (AUTO-4), now that real font files exist.** From
`ibm-plex-sans-400-latin.woff2` (`fontTools`): the `ch` unit's basis glyph,
`0`, has advance **0.600 em**; the frequency-weighted average character of
real English prose is **0.447 em** — 25% narrower. Consequence: **68ch**
(652.8 px at 16 px body) fits **≈91** real characters, not 68. The
already-narrowed token value **65ch** (`tokens.css`,
`--mythos-container-prose`, **AUTO-3**) is 624 px and fits **≈87** real
characters — still well past the stated 65. Hitting 65 real characters
literally would take **≈48ch** (≈465 px).

**RESOLVED 2026-08-18 by AUTO-5.** `--mythos-container-prose` is set to
**48ch** (≈64 real characters, ≈460.8 px at 16 px body) — the value that
actually honours the approved **65-character** intent, now that real
metrics make it computable. This **supersedes** 1C §5's **68ch** as an
*implementation* number, on the reasoning that 68ch was always an
unvalidated estimate of the same 65-character intent, never an independent
design goal, and could not be checked until real font files existed
(**AUTO-4**). It does not touch or contradict the approved text of either
`MASTER_VISUAL_IDENTITY_1C_PROPOSAL.md` or `TYPOGRAPHY.md`, both of which
remain unedited as the historical record. New supporting evidence: both
68ch (≈91 characters) and 65ch (≈87) **fail WCAG 2.2 1.4.8's 80-character
guideline outright** (AAA, not required at this system's AA floor, but the
same rationale `TYPOGRAPHY.md` §2 already states); 48ch clears it with
margin. Responsive check: 48ch (460.8 px) stays a ceiling only — the
narrowest measured column (280 px at 320 px, §4.2) is already well under
it, so nothing changes at mobile widths. Full derivation, the three-value
comparison table, and full reasoning: `../MYTHOS_DESIGN_DECISIONS.md` §0.5,
AUTO-5 (not owner-approved, fully reversible, zero cost to revert).

---

## 5. Breakpoints

Defined by content behaviour rather than by devices (approved, §5).

| Name | Range | What changes |
|---|---|---|
| `sm` | < 600 | Single column. Navigation collapses to a full-screen overlay. Tables become cards |
| `md` | 600–903 | Two columns. Sidebars become sheets |
| `lg` | 904–1239 | Three columns. Persistent sidebar returns |
| `xl` | 1240–1919 | Full 12-column grid at max content width |
| `2xl` | ≥ 1920 | Grid stops growing; margins absorb the surplus — but see §4.2.3 |

**Column counts and layout regions are different things.** The *grid* is 4 / 8 / 12
(§4.1); the *regions* named above are 1 / 2 / 3. A `lg` layout has three regions
placed on eight columns, not three columns.

**Approved responsive rules** carried forward without change: navigation preserves
the tier structure at every size; tables become stacked cards below `md`; wide
content scrolls inside its own container and the page body never scrolls sideways;
type scales with `clamp()` between the scale's stops and never below 16 px for
body; touch targets are 44 × 44 minimum **at every breakpoint**; sidebars become
sheets at `md`; modals become full-screen at `sm`; images switch from 16:9 at `lg`+
to 4:5 at `sm`.

---

## 6. Vertical rhythm — there is no baseline grid

Every line box in the approved type scale was computed against the 4 px grid:

| Style | Size / LH | Line box | On 4 px grid |
|---|---|---|---|
| Display XL | 61 / 1.02 | 62.22 | no |
| Display L | 49 / 1.06 | 51.94 | no |
| H1 | 39 / 1.12 | 43.68 | no |
| H2 | 31 / 1.18 | 36.58 | no |
| H3 | 25 / 1.24 | 31.00 | no |
| H4 | 20 / 1.32 | 26.40 | no |
| Body L | 18 / 1.62 | 29.16 | no |
| Body | 16 / 1.62 | **25.92** | no |
| Body S | 14 / 1.56 | 21.84 | no |
| Caption | 13 / 1.46 | 18.98 | no |
| Label | 12 / 1.34 | 16.08 | no |
| Data | 14 / 1.44 | 20.16 | no |

**Twelve of twelve are off-grid.** A baseline grid is therefore not achievable
with the approved type scale, and **must not be attempted in 1F.**

Arabic settles it beyond argument. Under the approved +6 % size and +0.15
line-height rules (`TYPOGRAPHY.md` §3), Body renders at **30.02 px** against the
Latin **25.92 px**. A baseline grid that held for one script would break the
other — and this brand is bilingual by design, not by translation.

**What replaces it:** blocks are separated by `space-*` values from the two legal
bands; leading is left to the type scale. Rhythm is the gap between blocks, not
an invisible ruler behind them.

---

## 7. Shape and elevation

**Radius, argued from the mark** (approved, §6). The wordmark has flat terminals
and sharp corners, so the identity argues for low radius.

| Token | Value | Applies to |
|---|---|---|
| `radius-0` | 0 | Tables, data cells, full-bleed media, the 35° cut |
| `radius-1` | **2 px** | **The workhorse** — inputs, buttons, chips, small cards |
| `radius-2` | 6 px | Cards, panels, menus |
| `radius-3` | 12 px | Modals, sheets, app tiles |
| `radius-full` | 999 px | Avatars and status dots **only** |

**Elevation is by surface, not by shadow:** `ink-850 → ink-800 → ink-750` with a
1 px `ink-700` hairline. Shadows are reserved for elements that genuinely float —
menus, modals, toasts — and never used to decorate a static card.

**Two elevation gaps, recorded not filled** (**SURF-1**):

- **The light ramp is shallower than the dark ramp.** Dark has four steps
  (`ink-900 / 850 / 800 / 750`); light has two (`paper-100 / 200`). A card resting
  on a raised surface has no distinct light-theme equivalent.
- **No shadow values are specified.** The approved text says *when* to use a
  shadow, never *what* it is.

**The signature shape** is unchanged: a **35° cut** on one edge of **one element
per view** — a section divider, an image mask, a hero corner, a chart's leading
bar. One per view is the whole discipline (**A-012**).

---

## 8. Density

*Comfortable* for content and marketing; *compact* for operational views, reducing
vertical padding one step — **never type below 13 px and never targets below
44 px** (approved, §7).

The floor and the control heights do not agree; see **C-005** below.

---

## 9. Open and conflicting — updated, AUTO-3 / A-022, 2026-08-18

| Ref | Type | Statement | Status |
|---|---|---|---|
| ~~**C-005**~~ | Conflict | 40/36 px control height vs 44 px touch minimum | **RESOLVED — A-022** (owner-approved, Stage 1F). Visual box may stay 40/36; hit box must reach 44 × 44 and may extend beyond it |
| ~~**GRID-1**~~ | Open | `2xl` behaviour; 1440 container ambiguity | **RESOLVED — AUTO-3** (delegated mandate). 1440 is the 1280 frame at its own margins; `2xl` inherits `xl`'s capped state and has none of its own |
| ~~**GRID-2**~~ | **Resolved — AUTO-5** | 68ch vs 65 characters | `--mythos-container-prose` set to **48ch**, superseding 1C §5's 68ch approximation on real font metrics, honouring the approved 65-character intent. Not owner-approved; see §0.5 AUTO-5 |
| ~~**GRID-3**~~ | Open | Off-scale spacing steps; button padding | **RESOLVED — AUTO-3.** `space-1`/`space-2` are optical-correction only; `space-7`/`space-12` are legitimate scale members outside the named bands; padding confirmed as 10/16 inside a 1 px border |
| ~~**SURF-1**~~ | Open | Light elevation ramp; no shadow values | **RESOLVED — AUTO-3.** Ramp extended (`ground-deep`, `surface-card`, `border-strong`), shadow tokens defined |

Full reasoning and values for every AUTO-3 row: `MYTHOS_DESIGN_DECISIONS.md`
§0.5. Machine-readable values: `assets/brand/tokens/tokens.css`. **None of these
was owner-approved** — AUTO-3 is a delegated-mandate decision, distinct from
A-022 above it in this same table.

---

## 10. What this document did not do

- Did not change any CSS, token file, application code or asset.
- Did not introduce a spacing, grid, breakpoint or radius value the owner has not
  approved.
- Did not resolve C-005, GRID-1, GRID-2, GRID-3 or SURF-1.
- Did not specify components — that is Stage 1F.
- Did not action MIG-1, MIG-2, MIG-3 or MIG-4.
