# MYTHOS Responsive, Accessibility and Motion

**Stage:** MYTHOS-DESIGN-1G
**Date:** 2026-08-18 UTC
**Status:** **SPECIFICATION ONLY. Not implemented.** No application code, CSS,
asset or deployed surface was touched.

**Authority:** **A-009** (1C §5, §10, §11, §12), **A-010**, **A-012**, **A-016**,
**A-017**, **A-018**, **A-022**. Inputs: `GRID_AND_SPACING.md` and
`DESIGN_TOKENS.md` (1E), `COMPONENT_SYSTEM.md` (1F), `COLOR_SYSTEM.md` and
`TYPOGRAPHY.md` (1D).

**No breakpoint, duration, easing or colour value was invented.** Where the
approved system does not reach, the entry says so and names an open reference.
§4 is the complete register.

**Scope note:** the owner named this single file. The three placeholder names in
`docs/design/README.md` — `RESPONSIVE_SYSTEM.md`, `ACCESSIBILITY.md`,
`MOTION_SYSTEM.md` — are superseded by this document. **That index was outside
the files this instruction named and was deliberately left unedited.**

---

## 0. Labels

| Label | Meaning |
|---|---|
| **OWNER-APPROVED** | Appears in an owner-approved document. Cited |
| **DERIVED** | Computed from approved values. **No new decision** — arithmetic shown |
| **PROPOSED** | A new decision recommended here. **Not approved.** Rejectable on its own |
| **OPEN** | No decision exists and none is made. Carries a reference |

---

# PART 1 — RESPONSIVE

## 1.1 The four device classes against the five approved bands

The owner asked for four classes. The approved system has **five** bands, so the
mapping is stated rather than assumed — **DERIVED**:

| Class | Band(s) | Range | Grid columns | Gutter / margin |
|---|---|---|---|---|
| **Mobile** | `sm` | < 600 | 4 | 16 / 20 |
| **Tablet** | `md` + `lg` | 600–1239 | 8 | 20 / 48 |
| **Desktop** | `xl` | 1240–1919 | 12 | 24 / 80 |
| **Large desktop** | `2xl` | ≥ 1920 | 12 | 24 / 80 |

**Two honest consequences.**

- **Tablet spans two approved bands.** `md` and `lg` share a column count (8) and
  differ only in *region* count — two regions at `md`, three at `lg` with the
  persistent sidebar returning. So "tablet" is one grid with two layouts, not one
  layout — **DERIVED**.
- **Large desktop is not materially distinct — OPEN, GRID-1.** Every approved
  metric for `2xl` is identical to `xl`, and the content cap already stops the
  grid growing from **1440** — 480 px below the `2xl` boundary. The class the
  owner asked to define **has nothing of its own in the approved system**. It is
  not invented here.

## 1.2 Grid behaviour — DERIVED, measured in 1E

| Viewport | Class | Content | Column |
|---|---|---|---|
| 320 | Mobile | 280 | 58.00 |
| 360 | Mobile | 320 | 68.00 |
| 600 | Tablet | 504 | 45.50 |
| 904 | Tablet | 808 | 83.50 |
| 1240 | Desktop | 1080 | 68.00 |
| 1440 | Desktop | **1280 — capped** | 84.67 |
| 1920 | Large desktop | 1280 — capped | 84.67 |

**Columns are fractional at almost every viewport**, so they are expressed as
fractions and **never as fixed pixel widths** — a fixed-pixel column drifts up to
a pixel per column and visibly breaks a 12-column row.

## 1.3 The 320 px reflow — DERIVED, verified

WCAG 2.2 **1.4.10 Reflow** requires content at 320 CSS px with no two-dimensional
scrolling. At 320 the approved grid yields **content 280, column 58** — narrow but
positive. **The grid does not collapse at the floor.**

**320 px and 400 % zoom are the same requirement**, not two — see §2.11.

Binding at 320: single column; navigation is the full-screen overlay; tables are
cards; **wide content scrolls inside its own container and the page body never
scrolls sideways**; body text stays at 16 px.

## 1.4 The 1440 grid limit — DERIVED, and OPEN where it stops

Content caps at **1280**. From a 1440 viewport upward the grid stops growing and
the margins absorb everything else: 80 px each at 1440, 160 at 1600, 320 at 1920,
640 at 2560.

`1280 + 80 + 80 = 1440` **exactly**, which is why the approved "wide 1440"
container is ambiguous between a second content width and the outer frame of the
1280 container. **OPEN — GRID-1.** Until it is settled, no layout may assume
which of the two frames a full-bleed table, a dashboard or a modal.

## 1.5 Typography scaling — PROPOSED, underlying question OPEN

**OWNER-APPROVED:** type scales fluidly with `clamp()` **between the scale's
stops**, never interpolating outside them, and **body never renders below 16 px**.

**What is not approved:** which stop is the floor for each style, and at which
viewports the clamp endpoints sit. Both are needed to write a single `clamp()`.
**OPEN — TYPE-3 (new).**

**PROPOSED, and rejectable on its own:** each display style floors at **the next
stop down**, with endpoints at **320** and **1240** — 1240 being where the grid
first reaches its full 12 columns.

| Style | Floor | Ceiling |
|---|---|---|
| Display XL | 49 | 61 |
| Display L | 39 | 49 |
| H1 | 31 | 39 |
| H2 | 25 | 31 |
| H3 | 20 | 25 |
| H4 | 18 | 20 |
| Body L / Body / Body S / Caption / Label / Data | **fixed, no fluid range** | — |

Body and below do not scale: the approved floor is 16 px and the approved
operational floor is 13 px, so a fluid body range would have nowhere to go
without breaking one of them — **DERIVED**.

**Arabic keeps its +6 % size and +0.15 line-height at every step of the range**
(**A-014**) — the multiplier applies to the clamped result, not to the ceiling.

## 1.6 Spacing across breakpoints — PROPOSED, underlying question OPEN

The approved bands — sections 48/64/96/128, components 8/12/16/24 — **do not vary
by breakpoint**, and the approved text gives no rule for whether they should.
A 128 px section gap on a 320 px phone is a quarter of the viewport height.
**OPEN — SPACE-1 (new).**

**PROPOSED:** section spacing steps **one band down at mobile** — 128 → 96,
96 → 64, 64 → 48, 48 → 48 — and component spacing does not change, because the
component band is already the small end of the scale. Not decided here.

## 1.7 Navigation transformation — OWNER-APPROVED

| Class | Behaviour |
|---|---|
| Mobile | **Full-screen overlay that preserves the three-tier structure.** The architecture must be legible on a phone |
| Tablet | Overlay at `md`; the persistent sidebar returns at `lg` |
| Desktop / Large desktop | Horizontal bar with the ecosystem panel exposing master brand, endorsed units and independent projects |

**The ecosystem panel is the one component that may not be simplified at mobile**
— it is where the approved brand architecture (**A-001**–**A-006**, **A-020**)
becomes visible. Active item: 2 px gold underline **plus** `aria-current`, never
colour alone.

## 1.8 Component transformations — DERIVED from 1F §8

| Component | Mobile | Tablet | Desktop / Large |
|---|---|---|---|
| Button | Full width when primary | Auto | Auto |
| Form | One column | One column | One column; two only above `lg` |
| Tabs | Horizontal scroll **inside the container** | Inline | Inline |
| Table | **Cards**, primary column as title | Cards at `md`, table at `lg` | Table |
| Modal | **Full screen** | Centred | Centred |
| Card | Full width | 2-up | 3-up or 4-up on 12 columns |
| Dropdown | Bottom sheet — **PROPOSED** | Anchored | Anchored |
| Sidebar | Sheet | Sheet at `md`, persistent at `lg` | Persistent |
| Images | 4:5 | 16:9 from `lg` | 16:9 |

**Tables** keep tabular figures and sticky headers at every size; below `md` the
primary column becomes the card title. **Forms** never go multi-column below
`lg`. **Modals** trap focus and return it at every size. **Cards** carry the
`surface-card` problem into light theme — **OPEN, SURF-1**.

## 1.9 Dense operational interfaces — DERIVED from A-022

Compact density reduces vertical padding one step, with **type never below 13 px
and hit boxes never below 44 × 44**.

**The binding number:** compact controls are 36 px, so they need **4 px of hit
expansion per side** and therefore **16 px (`space-5`) between neighbours** to
preserve the approved 8 px separation between *hit* boxes. **A dense row at
`space-3` (8) produces overlapping hit areas and is not permitted** — the densest
legal operational row is `space-5`, not the component band's smallest step.

Density is a property of the view, not of the component: one view does not mix
36 px and 40 px controls — **PROPOSED**.

---

# PART 2 — ACCESSIBILITY

## 2.1 The target — OWNER-APPROVED, with two exceptions stated

**WCAG 2.2 AA is the floor; AAA for body text**, achieved on ink (15.23 : 1) and
on paper (16.77 : 1).

**Where the system exceeds AA — DERIVED:**

- **Target size.** 24 × 24 is the AA requirement (2.5.8); **44 × 44 is the AAA
  level** (2.5.5). **A-022 requires 44 × 44**, which is **3.36 × the AA minimum
  in area**. The system meets AAA on target size.
- **Focus appearance.** Both focus values exceed the 3 : 1 non-text minimum —
  8.59 : 1 on ink, 5.47 : 1 on paper.

**Where it does not reach AAA — stated, not rounded up:**

- **`text-secondary` on a card is 6.78 : 1 — AA, not AAA.** Secondary text on a
  card is therefore AA.

## 2.2 Colour contrast — OWNER-APPROVED, measured

Every value was computed in 1D against all four surfaces. Binding rules:
`ink-400` and `paper-500` are **non-text only**; control boundaries use
`border-control` (3.84 / 3.82); hairlines below 3 : 1 are permitted **only where
they carry no meaning**; and **colour never carries meaning alone** — every
semantic state pairs a colour with a dot, chip, stripe or label.

**OPEN — GOLD-2:** hover and active gold have **no light-theme value**, so every
hover and active state in the system is measured on dark and unmeasured on light.

## 2.3 Focus — OWNER-APPROVED (A-016)

2 px `focus-ring` at 2 px offset, `gold-500` on ink and `gold-800` on paper.
**Focus is never removed.** Focus is **never animated** — a focus indicator that
fades in is late, and a keyboard user moving quickly outruns it — **DERIVED**
from the reduced-motion rule and the "motion communicates, never decorates" rule.

## 2.4 Keyboard — OWNER-APPROVED

Everything reachable and operable; visible focus always; skip links; focus
trapped in modals and **returned to the trigger on close**; no keyboard traps.
Tab order follows visual order and `tabindex` is never positive.

Composite widgets follow their roles — **DERIVED** and specified per component in
1F: arrows within tabs, radio groups, menus and listboxes; `Home`/`End` where a
list has ends; `Esc` closes any overlay; `Space` toggles, `Enter` activates.

## 2.5 Screen readers, semantic HTML and labels — OWNER-APPROVED

Semantic HTML first; landmarks; **one `h1`**; accessible names on every icon-only
control; live regions for async status. Labels are **visible and persistent**;
**a placeholder is never a label**. `aria-current` carries the active state that
the gold underline only depicts.

## 2.6 Errors — OWNER-APPROVED

Errors **explain the fix**, are linked programmatically to their field, and are
**never colour-only**. Form submission failure moves focus to an error summary
that links to each field — **DERIVED** in 1F, not to the first field silently.

## 2.7 Disabled states — partially OPEN

**OWNER-APPROVED:** `text-disabled` (`ink-400` / `paper-500`) sits deliberately
below body contrast. WCAG exempts disabled controls from contrast, so this is
conformant.

**OPEN — A11Y-2 (new).** The universal rule is *colour never carries meaning
alone*, and disabled is a meaning. **The approved system specifies no non-colour
channel for it** — no hatch, no icon, no text convention. A disabled control is
currently distinguished by contrast alone, which is exactly what the rule
forbids elsewhere. Not resolved here.

**Binding regardless:** a disabled control keeps its accessible name, is
programmatically disabled rather than merely styled, and **an explanation is
available for why** where the reason is not obvious.

## 2.8 Touch targets — OWNER-APPROVED (A-022)

> Visual control height may remain **40 px comfortable / 36 px compact**.
> Interactive hit area is **minimum 44 × 44 px**, and may extend beyond the
> visual control box. **No component is forced to 44 px high.**

**Derived geometry, carried from 1F §1.1:**

| Visual height | Expansion per side | Minimum gap between visual boxes |
|---|---|---|
| 40 | 2 px | **12 px** — `space-4` |
| 36 | 4 px | **16 px** — `space-5` |

Expansion is a **transparent hit region, never added margin** — margin moves the
layout. 44 × 44 holds **at every breakpoint**, not only at mobile.

## 2.9 Reduced motion — OWNER-APPROVED (A-018)

Under `prefers-reduced-motion` every transform collapses to opacity and every
duration resolves to `motion-micro`. **The interface must remain complete and
legible with animation disabled entirely** — which is also the test that decides
MOTION-1 (§3.4).

## 2.10 RTL and Arabic — OWNER-APPROVED, with one new question

Logical properties throughout; `lang` and `dir` **per element**, not per page, so
mixed Arabic and French inside one block renders correctly. Arabic carries +6 %
size and +0.15 line-height, and **letter-spacing is forced to 0** — including the
Label style, which drops its +0.10em. Western Arabic numerals across all three
languages.

**Does not mirror:** numbers, media controls, progress direction, logos — **and
the M's slant** (**A-012**).

**OPEN — MOTION-2 (new).** The M's slant does not mirror, and the 35° motion
vector is *the same angle as the mark*. But direction of travel is a layout
property: a gesture that travels up-and-right in LTR either keeps its absolute
direction in RTL (identity preserved, layout logic broken) or mirrors to
up-and-left (layout correct, the angle now the mark's mirror image). **The
approved text settles the mark and says nothing about the vector.** Not resolved
here.

## 2.11 Zoom and text resizing — DERIVED, computed

**Zoom does not create a special mode — it moves the user down the same bands.**
From a 1280 physical viewport:

| Zoom | Effective CSS width | Lands in |
|---|---|---|
| 100 % | 1280 | Desktop (`xl`) |
| 150 % | 853 | Tablet (`md`) |
| 200 % | **640** | **Tablet (`md`)** |
| 300 % | 427 | Mobile (`sm`) |
| 400 % | **320** | **Mobile (`sm`)** |

**Two consequences that change how the classes are treated:**

1. **The tablet layout is the desktop-at-200 %-zoom layout.** A low-vision desktop
   user at 200 % sees the tablet composition. It cannot be a degraded middle
   state; it must be complete.
2. **The 320 px reflow requirement and 400 % zoom are the same test**, so §1.3 and
   1.4.10 are satisfied together, not separately.

**Text spacing (WCAG 1.4.12) — a real reflow risk, measured.** The criterion is
that content must not break when a user forces line-height to 1.5, letter-spacing
to 0.12em, word-spacing to 0.16em and paragraph spacing to 2×.

**Nine of the twelve approved styles have a default line-height below 1.5** — all
six display and heading styles, plus Caption (1.46), Label (1.34) and Data
(1.44). Only Body L, Body and Body S (1.62 / 1.62 / 1.56) already clear it.
Forcing Display XL from 1.02 to 1.5 grows its line box by **47 %**.

**Binding consequence — DERIVED:** no fixed-height container may wrap a heading,
a label or a data cell, and no component may clip on vertical overflow. This is
not a defect in the scale — tight display leading is correct — it is a constraint
on every container the scale sits in.

**Also required:** 200 % zoom without loss of content or function, and text
resize to 200 % independent of zoom.

## 2.12 Forced colors — approved as a requirement, unspecified as a design

**OWNER-APPROVED:** `forced-colors` mode is honoured.

**OPEN — A11Y-1 (new).** In forced-colors the system's palette is replaced by the
user's. **Gold is the system's only emphasis channel** — primary action, active
state, focus ring and the 35° gesture all carry it. When it is overridden:

- Status **survives**, because the approved rule already pairs every state with a
  dot, chip or stripe.
- **The primary-versus-secondary button distinction does not.** A gold-ground
  primary and a bordered secondary both resolve to system button colours.

**The approved system provides no non-colour channel for emphasis**, only for
status. What distinguishes the primary action when colour is not available is
undecided. Not resolved here.

---

# PART 3 — MOTION

## 3.1 Philosophy — OWNER-APPROVED

Motion communicates **a state change, a hierarchy or a continuity — never
decoration**. No springs, no bounce: they read as playful and this brand is not.
**Nothing loops, nothing autoplays.**

This is the motion half of **Constant + Movement** (**A-011**): the system holds
still, and one thing moves.

## 3.2 Durations and easing — OWNER-APPROVED

| Token | Duration | Use |
|---|---|---|
| `motion-micro` | 120 ms | Hover, focus, checkbox — anything under the pointer |
| `motion-base` | 180 ms | Standard state change |
| `motion-enter` | 240 ms | Elements arriving |
| `motion-overlay` | 320 ms | Modals, sheets, drawers |
| `motion-page` | 480 ms | Route transitions and orchestrated sequences only |

**Easing:** enter `cubic-bezier(0.2, 0, 0, 1)` · exit `cubic-bezier(0.4, 0, 1, 1)`
· move `cubic-bezier(0.4, 0, 0.2, 1)`.

## 3.3 Per-interaction — DERIVED

| Interaction | Duration | Easing | Notes |
|---|---|---|---|
| Hover | `motion-micro` | move | **Never the only signal** — hover does not exist on touch |
| Focus | **none** | — | Instant. A focus ring that fades is late (§2.3) |
| Press / active | `motion-micro` | move | Colour only; the control does not move under the finger |
| Dropdown, tooltip | `motion-enter` | enter | Fade plus a small offset; **shadow OPEN, SURF-1** |
| Modal, sheet | `motion-overlay` | enter | Vertical, **not** the 35° vector — a modal is not the view's gesture |
| Navigation overlay | `motion-overlay` | enter | The tier structure is present on the first frame, not assembled |
| Tabs, table sort | `motion-base` | move | The content changes; the frame does not |
| Toast | `motion-enter` | enter | **Enters along the 35° vector** — OWNER-APPROVED |
| Route change | `motion-page` | move | Orchestrated sequences only |
| Loading | — | — | **OPEN — MOTION-1** |

## 3.4 MOTION-1 — stated, not resolved

**The contradiction, in the approved text's own words:**

> *"Nothing loops, nothing autoplays."* — 1C §10
> Every interactive element has six states: default, hover, active,
> focus-visible, disabled, **loading**. — 1C §7

**A spinner loops and autoplays. Both statements are owner-approved.** This
document does not resolve it.

**Three routes, none chosen:**

| Route | What it means | Cost |
|---|---|---|
| **1 — Determinate only** | Progress is shown only where completion is measurable | Indeterminate waits have no indicator at all |
| **2 — Static skeletons** | Layout-shaped placeholders, **no shimmer** — a shimmer loops | No motion signal that work is in progress |
| **3 — Explicit exception** | The no-loop rule gains a carve-out for busy indicators | The one absolute motion rule stops being absolute |

**PROPOSED, and left OPEN as the owner instructed: routes 1 and 2 together** —
determinate progress where measurable, static skeletons elsewhere. The deciding
argument is not aesthetic: **A-018 requires the interface to stay legible with
animation disabled entirely**, and routes 1 and 2 satisfy that unchanged, while
route 3 needs a second, non-animated fallback anyway. **This is a recommendation,
not a decision.**

**Binding regardless of the route — DERIVED:**

- A control in its loading state **keeps its size** — no layout shift.
- It keeps its accessible name and sets `aria-busy`.
- It is **not** removed from the tab order while busy; it is disabled with the
  reason available.
- Completion is announced politely, not assertively.
- Under `prefers-reduced-motion` the loading state must remain **perceivable
  without animation** — a test route 3 fails on its own.

## 3.5 The 35° gesture — OWNER-APPROVED, with one new question

**A-012.** 35° is the signature, measured at 34.9° in the mark and rationalised
to exactly 35.0°. It appears **once per view** and is the only permitted
non-orthogonal element.

**Rarity is the whole discipline.** The rule is falsifiable on purpose: a
reviewer can count the gestures on any screen. **If two things move along 35° in
one view, one of them is wrong.**

**Derived from 1F:** a toast's 35° entrance **consumes the view's motion
gesture**. If a view already animates an element along 35°, the toast fades
instead.

**OPEN — MOTION-3 (new).** The approved text carries the gesture twice — as a
**shape** (a 35° cut on one element per view, §6) and as a **motion** (one
element per view travelling along 35°, §10). Whether these are **one budget or
two** is not stated. A hero with a 35° cut *and* a toast entering at 35° is
either compliant or a double gesture, depending on a reading the approved text
does not supply. Not resolved here.

**OPEN — MOTION-2:** whether the vector mirrors in RTL (§2.10).

## 3.6 Reduced motion — OWNER-APPROVED (A-018)

Every transform collapses to opacity; every duration resolves to `motion-micro`;
**the 35° gesture does not travel — it appears.** Nothing that carries meaning is
lost, because under the approved philosophy motion never carried meaning alone.

---

# PART 4 — OPEN REGISTER

## 4.1 New, raised by 1G — all six resolved, AUTO-3, 2026-08-18

| Ref | Statement | Adopted (**AUTO-3**, delegated mandate, not owner-approved) |
|---|---|---|
| ~~**TYPE-3**~~ | `clamp()` floor stop and endpoints unspecified | **Floor at the next stop down; endpoints 320 and 1240.** Adopted exactly as recommended |
| ~~**SPACE-1**~~ | Spacing bands do not vary by breakpoint | **Section spacing steps one band down at mobile; component spacing unchanged.** Adopted exactly as recommended |
| ~~**A11Y-1**~~ | Forced-colors overrides gold, the only emphasis channel; primary/secondary distinction lost | **`border-style` distinction** — primary solid, secondary dashed. Border style, not colour, survives `forced-colors`. Flagged honestly as a genuine judgement call, not a derivation |
| ~~**A11Y-2**~~ | Disabled has no non-colour channel | **The `disabled`/`aria-disabled` attribute is the non-colour channel** (screen-reader-detectable), plus `cursor: not-allowed` |
| ~~**MOTION-2**~~ | Does the 35° motion vector mirror in RTL? | **No — same absolute travel direction in both directions**, matching A-012's own reasoning for the mark's slant |
| ~~**MOTION-3**~~ | Do the shape-cut and motion-vector share one per-view budget? | **Yes, one shared budget** — two 35° gestures in one view is a doubled gesture, not two separate allowances |

## 4.2 Carried, and updated where AUTO-3 or A-022 resolved them

| Ref | Where it bit in 1G | Status |
|---|---|---|
| ~~**GRID-1**~~ | §1.1 — the "large desktop" class had nothing of its own | **RESOLVED — AUTO-3.** 1440 is the 1280 frame at its own margins; `2xl` inherits `xl`'s capped state |
| ~~**GRID-2**~~ | Prose measure — 68ch versus 65 characters | **RESOLVED — AUTO-5.** `container-prose` set to 48ch, superseding the 68ch approximation on real font metrics; not owner-approved |
| ~~**GRID-3**~~ | Off-scale values and the four spacing steps with no band | **RESOLVED — AUTO-3.** Roles clarified; button padding confirmed |
| ~~**SURF-1**~~ | §1.8, §3.3 — cards in light theme, no shadow value | **RESOLVED — AUTO-3.** Ramp extended, shadows defined |
| ~~**GOLD-2**~~ | §2.2 — every hover/active state unmeasured on light | **RESOLVED — AUTO-3.** Both darken from `gold-800`, verified against AA |
| ~~**GOLD-3**~~ | Select chevrons versus the one-gold-per-view rule | **RESOLVED — AUTO-3.** `text-secondary` |
| ~~**TOKEN-1 / TOKEN-2**~~ | No token artifact existed; names unprefixed provisionally | **RESOLVED — AUTO-3.** `assets/brand/tokens/tokens.css`, `--mythos-*` prefix |
| ~~**MOTION-1**~~ | §3.4 — stated in full and deliberately left open | **RESOLVED — AUTO-3.** Static skeletons and determinate progress adopted |
| ~~**LINK-1**~~ | The inline text link had no approved colour | **RESOLVED — AUTO-3.** Underline in `text-primary` |
| ~~**SHAPE-1**~~ | The switch versus `radius-pill` | **RESOLVED — AUTO-3.** Rectangular, `radius-control` |
| **LOGO-1** | — | **Still OPEN, narrowed** — see AUTO-1. One of three off-host repositories searched (negative); two remain blocked |
| **LOGO-2** | — | **RESOLVED — AUTO-1.** Adopted as production master, **not owner-approved** |
| **C-001 / O-002** | Dar Hijama charter versus live site | **Untouched.** A real-world project conflict, not a system rule a sweep can resolve |

**Full reasoning and every value: `MYTHOS_DESIGN_DECISIONS.md` §0.5, AUTO-1
through AUTO-3.** Nothing above was resolved by silent inference — every row
that changed cites the register entry that changed it, and every entry there is
explicitly marked as delegated-mandate authority, never owner approval.

---

## 5. What this document did not do

- Did not implement anything: no application code, CSS, token file, component
  code, asset or deployment.
- Did not invent a breakpoint, duration, easing curve or colour value.
- Did not resolve MOTION-1 — the owner's instruction was to document the
  exception as PROPOSED and leave it OPEN, and that is what §3.4 does.
- Did not resolve GRID-1/2/3, SURF-1, GOLD-2/3, TOKEN-1/2, LINK-1, SHAPE-1,
  LOGO-1, LOGO-2, C-001 or O-002.
- Did not adopt any PROPOSED value — each needs owner approval individually.
- Did not edit `docs/design/README.md`, which still lists the three superseded
  placeholder filenames. **Flagged, deliberately not changed** — outside the
  files this instruction named.
- Did not action MIG-1, MIG-2, MIG-3 or MIG-4.
