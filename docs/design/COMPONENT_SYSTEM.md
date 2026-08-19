# MYTHOS Component System

**Stage:** MYTHOS-DESIGN-1F — component system
**Date:** 2026-08-18 UTC
**Status:** **SPECIFICATION ONLY. Not implemented.** No component code, stylesheet,
token artifact, Storybook or implementation asset was created.

**Authority:** **A-009** (the 1C identity) and **A-022** (the C-005 resolution,
owner instruction 2026-08-18). Inputs: `MASTER_VISUAL_IDENTITY_1C_PROPOSAL.md` §7
and §8, `COLOR_SYSTEM.md`, `TYPOGRAPHY.md`, `GRID_AND_SPACING.md`,
`DESIGN_TOKENS.md`.

**No unresolved value was invented.** Where the approved system does not contain
enough information, the component entry says so and names the open reference.
§9 lists every place an open item bites.

---

## 0. How to read the labels

Every specification below carries exactly one of these:

| Label | Meaning |
|---|---|
| **OWNER-APPROVED** | The value appears in an owner-approved document. Cited |
| **DERIVED** | Computed from approved values or rules. **No new decision** — the arithmetic is shown where it matters |
| **PROPOSED** | A new decision this document recommends. **Not approved.** May be rejected without affecting anything marked OWNER-APPROVED or DERIVED |
| **OPEN** | No decision exists and none is made here. Carries a reference |

Eight of the twenty-one components have an approved base specification. **Thirteen
do not** — 1C §7 specified Button, Input, Card, Navigation, Table, Modal,
Chip/status and Toast, and nothing else. For those thirteen, everything is
DERIVED or PROPOSED, and that is stated at the top of each entry.

---

## 1. A-022 — the C-005 resolution

**OWNER-APPROVED, 2026-08-18.** The conflict recorded as **C-005** — a 40 px
comfortable control height against a 44 × 44 px touch minimum — is resolved as:

> - Visual control height **may remain 40 px**.
> - Interactive hit area **must be at least 44 × 44 px**.
> - The hit area **may extend beyond the visual control box** where necessary.
> - **Do not force every visual component to become 44 px high.**

**The visual box and the hit box are now two different things**, and every entry
below states both.

### 1.1 What the resolution costs in geometry — DERIVED

| Visual height | Expansion per side | Minimum gap between adjacent visual boxes |
|---|---|---|
| 40 (comfortable) | **2 px** | **12 px** — `space-4` |
| 36 (compact) | **4 px** | **16 px** — `space-5` |

The approved rule is 8 px *separation between targets* (1C §7). Targets are now
hit boxes, not visual boxes, so the visual gap must absorb both expansions:
40 px controls need `40 + 2 + 2 = 44` and a visual gap of `8 + 2 + 2 = 12`;
36 px controls need `36 + 4 + 4 = 44` and a visual gap of `8 + 4 + 4 = 16`.
**Both land on the spacing scale** — `space-4` and `space-5` — so the resolution
does not push component layout off-system.

**Binding consequence:** a dense row of 36 px controls spaced at `space-3` (8)
produces **overlapping hit areas**. Compact density therefore requires `space-5`
between adjacent interactive elements, not the component band's smallest step.

### 1.2 Where expansion is and is not needed — DERIVED

- **Not needed** where the visual box is already ≥ 44 in that axis — a
  full-width button, a table row, a card that is itself the target.
- **Needed** on icon-only controls (40 × 40 and 36 × 36 visual), switches,
  checkboxes, radios, close buttons, pagination items, and inline text links on
  touch.
- **Never** by adding margin — margin moves the layout. Expansion is a
  transparent hit region around the visual box, so the composition is unchanged.

---

## 2. Universal rules — OWNER-APPROVED

These hold for every component below and are not repeated in each entry.

1. **Six states or it is unfinished:** default, hover, active, focus-visible,
   disabled, loading. A component missing one is not done (1C §7).
2. **Focus is never removed.** 2 px `focus-ring` at 2 px offset — `gold-500` on
   ink (8.59 : 1), `gold-800` on paper (5.47 : 1). Both exceed the 3 : 1 that
   WCAG 2.2 requires (**A-016**).
3. **Hit area ≥ 44 × 44 at every breakpoint** (**A-022**), 8 px separation
   between hit boxes.
4. **Status is form plus colour** — a chip, a stripe, a dot or a leading rule
   beside the 12 %-alpha ground. **Colour alone never conveys state.**
5. **Controls say what happens.** The button reads `Publish`; the toast that
   follows reads `Published`.
6. **Errors explain the fix**, are linked programmatically to their field, and
   are never colour-only.
7. **Empty and error states are designed**, never a bare string.
8. **Components consume semantic tokens only** — never `gold-500`, never a raw
   value (`DESIGN_TOKENS.md` §1, rule 2).
9. **Theme is a token remap.** No component branches on theme (rule 4).
10. **Reduced motion:** under `prefers-reduced-motion` every transform collapses
    to opacity and all durations resolve to `motion-micro` (**A-018**). **The
    interface must remain complete and legible with animation disabled
    entirely.**
11. **RTL:** logical properties throughout; `lang` and `dir` per element. What
    does not mirror: numbers, media controls, progress direction, logos — **and
    the M's slant** (**A-012**).
12. **Density:** *comfortable* for content, *compact* for operational views,
    reducing vertical padding one step — never type below 13 px, never hit boxes
    below 44 px.

### 2.1 The state matrix — DERIVED

One mapping, used by every component. Only the deltas appear in each entry.

| State | Ground | Text | Border | Motion |
|---|---|---|---|---|
| default | per component | `text-primary` | `border-control` | — |
| hover | one surface step up, or `accent-hover` | unchanged | unchanged | `motion-micro` |
| active | `accent-active` or one step down | unchanged | unchanged | `motion-micro` |
| focus-visible | unchanged | unchanged | **plus** `focus-ring` 2 px at 2 px offset | none |
| disabled | unchanged | `text-disabled` | `border-hairline` | none |
| error | unchanged | unchanged | `danger` | none |
| loading | unchanged | unchanged | unchanged | **OPEN — MOTION-1** |

**Hover is never the only signal for anything** — it does not exist on touch.

**GOLD-2 — RESOLVED, AUTO-3.** `accent-hover` (`#5a4011`) and `accent-active`
(`#6b4d15`) now have light-theme values, both darkening from `gold-800` rather
than lightening (lightening fails AA immediately; darkening only ever raises
contrast — verified 8.71:1 / 7.02:1). Not owner-approved; see
`../MYTHOS_DESIGN_DECISIONS.md` §0.5.

**OPEN — MOTION-1** (new, §10): the approved motion rules state *"nothing loops,
nothing autoplays"* (1C §10), and the approved state list requires a **loading**
state. A spinner loops and autoplays. **The loading state cannot be specified
without resolving this**, so it is left open in every entry.

---

## 3. Form controls

### 3.1 Button — base OWNER-APPROVED

| Aspect | Specification |
|---|---|
| **Visual height** | 40 comfortable / 36 compact — **OWNER-APPROVED** (1C §7) |
| **Hit box** | ≥ 44 × 44, expansion 2 px (40) or 4 px (36) per side — **A-022** |
| **Padding** | 9 vertical / 15 inline — **OWNER-APPROVED**, and **off the spacing scale (GRID-3)** |
| **Why 9 works** | Body S is 14 / 1.56 = **21.84 px**; `9 + 21.84 + 9 = 39.84 ≈ 40`. The approved padding is what produces the approved height — **DERIVED**. The compact height needs 7 px, which the approved text does not state: **OPEN, GRID-3** |
| **Radius** | `radius-control` (2) — **OWNER-APPROVED** |
| **Type** | Body S, Plex Sans. Sentence case — **DERIVED** from the height arithmetic above |
| **Primary** | `accent` ground, `text-on-accent` label — 8.59 : 1 dark, 5.47 : 1 light — **OWNER-APPROVED** |
| **Secondary** | transparent, `border-control`, `text-primary` — **OWNER-APPROVED** |
| **Ghost** | text only, no border — **OWNER-APPROVED** |
| **States** | hover `accent-hover`, active `accent-active` — **dark only, light OPEN (GOLD-2)** |
| **Keyboard** | `Enter` and `Space` activate. Tab-reachable. Never `tabindex` > 0 |
| **Accessibility** | Real `<button>`. Icon-only buttons carry an accessible name. Disabled uses `disabled` plus a non-colour cue |
| **Responsive** | Full-width at `sm` where it is the primary action; auto width from `md` |
| **Loading** | **OPEN — MOTION-1** |

**Scarcity binds the button, not just the colour** (`COLOR_SYSTEM.md` §3.2): one
gold element per view. **A view with two primary buttons is wrong by the colour
rule**, not merely by taste.

### 3.2 Input — base OWNER-APPROVED

| Aspect | Specification |
|---|---|
| **Visual height** | 40 — **OWNER-APPROVED**. Hit box ≥ 44 via 2 px expansion — **A-022** |
| **Radius** | `radius-control` (2) — **OWNER-APPROVED** |
| **Border** | `border-control` — `ink-550` dark (3.84 / 3.60 / 3.36), `paper-500` light (3.82 / 3.59). All pass 3 : 1 — **OWNER-APPROVED** |
| **Padding inline** | 12 — `space-4` — **PROPOSED** (the approved text fixes height and border, not inline padding) |
| **Label** | **Visible and persistent. Placeholder is never a label** — **OWNER-APPROVED** |
| **Type** | Body (16) — never below 16 px, which also prevents iOS zoom-on-focus — **OWNER-APPROVED** via TYPOGRAPHY §2 |
| **Error** | `danger` border **plus** a message **plus** `aria-describedby`. Never colour alone |
| **Help text** | Body S, `text-secondary`. **Measure: `container-prose` (48ch) — RESOLVED, GRID-2/AUTO-5** |
| **Keyboard** | Focus ring on `:focus-visible`. Error message announced via `aria-live="polite"` |
| **Responsive** | Full width at `sm`; field groups collapse to one column below `md` |

### 3.3 Select — **no approved base**

Everything here is DERIVED or PROPOSED.

- **Geometry:** identical to Input — **DERIVED** (same height, radius, border,
  hit-box rule).
- **Indicator:** chevron on the approved icon grid — 24 px, 2 px stroke, **square
  terminals and joins**, internal radius ≤ 1 px — **DERIVED** from 1C §8.
- **Chevron colour:** **RESOLVED — GOLD-3, AUTO-3.** Chevrons take
  `text-secondary`; gold stays with the primary action, as this section
  originally proposed. Not owner-approved; see `../MYTHOS_DESIGN_DECISIONS.md`
  §0.5.
- **Native first** — a native `<select>` at `sm`, because it inherits the
  platform picker and its own hit target — **PROPOSED**.
- **Custom listbox**, if used: `role="listbox"`, `aria-expanded`, roving
  `tabindex`, `Home`/`End`/type-ahead, `Esc` closes and returns focus.
- **Surface of the open list:** `surface` dark — **light OPEN (SURF-1)**; shadow
  **OPEN (SURF-1)**.

### 3.4 Checkbox — **no approved base**

- **Visual box:** 20 × 20, `radius-control` (2), `border-control` — **PROPOSED**
  (20 is off the spacing scale; the approved system has no control-box size).
- **Hit box:** ≥ 44 × 44 — 12 px expansion per side — **A-022, DERIVED**.
- **Checked:** `accent` fill, `text-on-accent` glyph. Light hover/active **OPEN
  (GOLD-2)**.
- **Indeterminate:** a 2 px bar, same colours — **PROPOSED**.
- **Label:** clickable, Body, `text-primary`, gap `space-3` (8) — **PROPOSED**.
- **Keyboard:** `Space` toggles. **Accessibility:** real `<input type=checkbox>`;
  group in a `fieldset` with a `legend`; the glyph is never the only signal —
  the label states the state in text where meaning depends on it.

### 3.5 Radio — **no approved base**

As Checkbox, with two differences, both **PROPOSED**: the visual box is a circle
(the one place a round control is unambiguous), and selection is a filled inner
dot at `accent`. **Keyboard:** arrow keys move *and* select within the group;
Tab enters and leaves the group as one stop. Groups always sit in a `fieldset`.

### 3.6 Switch — **no approved base, and it hits an approved rule**

- **OPEN — SHAPE-1 (new, §10).** A switch track is conventionally a pill, but
  `radius-pill` is approved for **avatars and status dots only** (1C §6). The
  component the owner asked for and the approved radius rule do not fit.
  **PROPOSED: a rectangular switch at `radius-control` (2)**, which is also the
  reading most consistent with a wordmark built on flat terminals — but this is a
  new decision and is **not** made here.
- **Geometry:** track 40 × 20 (visual), thumb 16 × 16, travel 20 — **PROPOSED**.
- **Hit box:** ≥ 44 × 44 — **A-022**.
- **Semantics:** `role="switch"` with `aria-checked`. `Space` toggles.
- **State is never the thumb position alone** — an adjacent text state or an
  `accent` track fill carries it too (universal rule 4).
- **Motion:** thumb travel at `motion-micro`; under reduced motion the thumb
  moves without transition, and the control stays fully legible.

### 3.7 Form — **no approved base**

- **One column.** Multi-column forms break at `sm` and are not used below `lg` —
  **DERIVED** from the approved responsive rules.
- **Vertical rhythm:** `space-6` (24) between fields, `space-8` (48) between
  groups — **DERIVED**, both inside the approved legal bands.
- **Interactive spacing floor:** `space-4` (12) comfortable, `space-5` (16)
  compact, so hit areas keep their 8 px separation — **A-022, DERIVED (§1.1)**.
- **Labels above fields**, always visible. **Required** is marked in text, not by
  an asterisk alone.
- **Errors:** summary at the top linking to each field, plus per-field messages.
  Focus moves to the summary on failed submit, not to the first field silently.
- **Submit:** one primary action. Loading state **OPEN — MOTION-1**.
- **Measure of help and error text: `container-prose` (48ch) — RESOLVED, GRID-2/AUTO-5.**

---

## 4. Navigation

### 4.1 Navigation — base OWNER-APPROVED

| Aspect | Specification |
|---|---|
| **`xl`** | Horizontal bar with an ecosystem panel exposing **the three tiers** — **OWNER-APPROVED** |
| **`sm`** | Full-screen overlay that **preserves the same tier structure** — the architecture must be legible on a phone — **OWNER-APPROVED** |
| **Active item** | 2 px gold underline — **never colour alone** — **OWNER-APPROVED** |
| **Item hit box** | ≥ 44 × 44 — **A-022** |
| **Keyboard** | Tab order follows visual order. The overlay traps focus and returns it to the trigger on close. `Esc` closes |
| **Accessibility** | `<nav>` with a label, `aria-current="page"` on the active item — the underline is decoration, `aria-current` is the fact |
| **Motion** | Overlay at `motion-overlay` (320); reduced motion → opacity only |

**The ecosystem panel is where the brand architecture becomes visible**
(**A-001**–**A-006**, **A-020**): master brand, endorsed units, independent
projects. It is the one component that must not be simplified at `sm`.

### 4.2 Tabs — **no approved base**

**DERIVED from Navigation's active marker**, which is the point: tabs are not a
new visual language.

- Active tab: 2 px `accent` underline plus `text-primary`; inactive
  `text-secondary` — **DERIVED**. Light hover/active **OPEN (GOLD-2)**.
- Visual height 40, hit box ≥ 44 — **A-022**.
- `role="tablist"` / `tab` / `tabpanel`; arrow keys move between tabs,
  `Home`/`End` jump, the panel is the next tab stop.
- **Responsive:** tabs scroll horizontally inside their own container at `sm` —
  **the page body never scrolls sideways** (approved responsive rule). They do
  **not** silently become a select.

### 4.3 Pagination — **no approved base**

- Items are 40 × 40 visual, ≥ 44 hit, `space-4` (12) apart — **A-022, DERIVED**.
- Current page: `accent` underline plus `aria-current="page"` — **DERIVED**.
  **A gold-filled square is not permitted**: gold is never a ground
  (`COLOR_SYSTEM.md` §3.2 rule 2).
- **`sm`:** previous / next plus a `Page 3 of 12` label rather than a number
  strip — **PROPOSED**.

### 4.4 Dropdown / menu — **no approved base**

- Surface `surface`, `radius-card` (6), `border-hairline` — **DERIVED**.
- **Shadow: RESOLVED — SURF-1, AUTO-3.** `shadow-floating` (a menu is one of
  the three things the approved system says genuinely floats).
- **Light surface: RESOLVED — SURF-1, AUTO-3.** `surface-card` now has a
  light value (`#e9e5dd`). Not owner-approved; see
  `../MYTHOS_DESIGN_DECISIONS.md` §0.5.
- Item hit box ≥ 44, full-width targets, `space-3` (8) inline padding.
- `role="menu"`, arrow keys, `Esc` closes and returns focus to the trigger,
  first item focused on open.
- Enters at `motion-enter` (240); reduced motion → opacity.

---

## 5. Containers and overlays

### 5.1 Card — base OWNER-APPROVED

| Aspect | Specification |
|---|---|
| **Radius** | `radius-card` (6) — **OWNER-APPROVED** |
| **Border** | 1 px hairline — **OWNER-APPROVED** |
| **Ground** | one surface step above its own ground — **OWNER-APPROVED** |
| **Padding** | 16 / 20 / 24 by density — **OWNER-APPROVED**. Note **20 is off the spacing scale (GRID-3)** |
| **Shadow** | **none** — elevation is by surface — **OWNER-APPROVED** |
| **Light theme** | **RESOLVED — SURF-1, AUTO-3.** `surface-card` now has a light value (`#e9e5dd`); the light ramp is extended to match the dark ramp's steps. Not owner-approved |
| **Text contrast** | `text-secondary` on a card is **6.78 : 1 — AA, not AAA**. Stated, not rounded up |
| **Interactive cards** | The whole card is the hit box; it contains **one** primary action, never nested buttons that compete with the card's own target |
| **Measure** | Body text inside a card: `container-prose` (48ch) — **RESOLVED, GRID-2/AUTO-5** |

### 5.2 Modal — base OWNER-APPROVED

- `radius-overlay` (12), focus trapped, focus returned on close, **full-screen at
  `sm`** — all **OWNER-APPROVED**.
- `Esc` closes. Background scroll locked. `role="dialog"`, `aria-modal="true"`,
  labelled by its title.
- **Shadow: RESOLVED — SURF-1, AUTO-3.** `shadow-overlay`.
- **Max width: RESOLVED — GRID-1, AUTO-3.** 1440 is the 1280 content
  container's own frame at its own margins, not a second width — so an
  overlay sized to either reading is the same box. Not owner-approved; see
  `../MYTHOS_DESIGN_DECISIONS.md` §0.5.
- Enters at `motion-overlay` (320) along the vertical, **not** the 35° vector —
  the signature belongs to one element per view and a modal is not it.
- Reduced motion → opacity only; the modal still opens, closes and traps focus.

### 5.3 Tooltip — **no approved base**

- Caption (13) on `surface`, `radius-control` (2), `space-3` (8) padding —
  **PROPOSED**.
- **Shadow: RESOLVED — SURF-1, AUTO-3** (`shadow-floating`). **Max width:
  `container-prose` (48ch) — RESOLVED, GRID-2/AUTO-5.**
- **Never the only channel for information** — universal rule 4 applied: a
  tooltip supplements, it does not carry.
- **Touch has no hover**, so a tooltip must also be reachable by focus, and any
  content that matters on touch belongs in visible text — **DERIVED**.
- `aria-describedby`; dismissible with `Esc` (WCAG 2.2 content-on-hover).

---

## 6. Feedback and data

### 6.1 Badge / chip / status — base OWNER-APPROVED

- Approved: `radius-control` (2), **12 %-alpha ground**, solid dot, text at the
  semantic value.
- **Box: PROPOSED** — height 24 (`space-6`), inline padding 8 (`space-3`), gap 4
  (`space-2`) between dot and label. The approved text fixes the colour treatment
  and the shape, **not** the box.
- **Badge is a chip variant**, not a separate component — **PROPOSED**, so that
  one visual language covers both.
- Non-interactive by default: **no 44 px requirement** unless it is a control.
  A removable chip's remove target is a control and **does** need 44.
- **Status is form plus colour** — the dot is not decoration, it is the
  non-colour channel.

### 6.2 Alert — **no approved base**

- **DERIVED from the approved `-dim` convention**: 12 %-alpha semantic ground, a
  leading 2 px stripe at the solid semantic value, `radius-card` (6), padding
  `space-5` (16).
- Icon from the approved 24 px grid; **the icon differs per severity**, so
  severity survives without colour.
- `role="alert"` for errors (assertive), `role="status"` for information
  (polite).
- Dismissible alerts keep a ≥ 44 hit box on the close control — **A-022**.
- **Errors explain the fix** (universal rule 6). An alert that only says
  *"Something went wrong"* is not a designed error state.

### 6.3 Toast — base OWNER-APPROVED

- `radius-card` (6), **enters along the 35° vector**, auto-dismiss ≥ 6 s, and
  **never the only channel for an error** — all **OWNER-APPROVED**.
- **The 35° entrance consumes the view's one motion gesture** (**A-012**) —
  **DERIVED**. If a view already animates an element along 35°, the toast fades.
- Reduced motion → fade only, no travel.
- **Shadow: RESOLVED — SURF-1, AUTO-3** (`shadow-floating`). Not owner-approved.
- `aria-live="polite"`; errors additionally persist somewhere non-transient.

### 6.4 Table — base OWNER-APPROVED

- `radius-none` (0), **tabular figures** (Plex Mono, Data style), sticky header,
  row hover at 4 % surface, **becomes cards below `md` with the primary column as
  the card title** — all **OWNER-APPROVED**.
- **The 4 % hover value is outside the token system** — the `-dim` convention is
  12 %. Recorded under **SURF-1**.
- Row hit box: a row that is a link needs ≥ 44 height — satisfied by any
  comfortable row — **DERIVED**.
- Sortable headers are `<button>`s inside `<th>` with `aria-sort`.
- Wide tables scroll **inside their own container**; the page body never scrolls
  sideways — **OWNER-APPROVED**.
- Numeric columns right-align; Western Arabic numerals in all three languages
  (**A-014**, TYPOGRAPHY §3 rule 6).

### 6.5 Link — **no approved base, and it has no approved colour**

**OPEN — LINK-1 (new, §10).** Two approved rules together leave the inline text
link unspecified:

- `COLOR_SYSTEM.md` §3.2 — gold marks the primary action, the active state, the
  focus ring and the 35° gesture, **"nothing else"**.
- `TYPOGRAPHY.md` §4 — hierarchy is carried by size and weight, **"gold is never
  used to create hierarchy in running text"**.

So an inline link may not be gold, and no other accent colour exists in the
system. **PROPOSED: links are underlined in `text-primary`**, with the underline
thickening on hover — colour never distinguishes them, which also makes them
robust for colour-vision deficiency. **Not decided here.**

- Focus ring as universal rule 2. Touch: ≥ 44 px hit area, achieved by line
  height plus expansion — **A-022**.
- External links state that they are external in text or by an icon **with an
  accessible name** — never by colour.

---

## 7. Loading, empty and error states

**OWNER-APPROVED principle:** *"Empty and error states are designed, not left to
a bare string."* (1C §7)

### 7.1 Loading — **OPEN, MOTION-1**

The approved motion rules say **"nothing loops, nothing autoplays"** (1C §10),
and the approved state list requires a **loading** state on every interactive
element. A spinner does both. **This document does not resolve it.**

Three routes exist, none chosen:

1. **Determinate progress only** — no indeterminate indicator anywhere.
2. **Static skeletons** — layout-shaped placeholders with **no shimmer**, since
   a shimmer loops.
3. **An explicit exception** to the no-loop rule for busy indicators only.

**What is already binding regardless of the route** — **DERIVED**: a control in
its loading state stays the same size (no layout shift), keeps its accessible
name, sets `aria-busy`, and announces completion politely. Under reduced motion
the loading state must still be perceivable **without animation**, which routes 1
and 2 satisfy and route 3 does not.

### 7.2 Empty — DERIVED

Structure: heading (H4), one sentence of body, **one primary action**, optional
24 px icon. Vertical rhythm `space-6` (24) between elements, `space-8` (48)
above and below the block. Never centred text longer than two lines. An empty
state that offers no action is a dead end and is not a designed state.

### 7.3 Error — DERIVED

Same structure as Empty, plus: what failed, **what the reader can do**, and a
retry action. `role="alert"`. Severity is carried by the icon and the leading
stripe as well as by colour. A page-level error keeps the navigation reachable —
the reader must be able to leave.

---

## 8. Responsive and density summary — DERIVED

| Component | `sm` | `md` | `lg` / `xl` |
|---|---|---|---|
| Button | Full width when primary | Auto | Auto |
| Form | One column | One column | One column; two only above `lg` |
| Navigation | Full-screen overlay, tiers preserved | Overlay | Horizontal bar with ecosystem panel |
| Tabs | Horizontal scroll in container | Inline | Inline |
| Table | Cards, primary column as title | Cards | Table |
| Modal | Full screen | Centred | Centred |
| Card | Full width | 2-up | 3-up or 4-up on 12 columns |
| Dropdown | Bottom sheet — **PROPOSED** | Anchored | Anchored |

Touch targets stay ≥ 44 × 44 **at every breakpoint**, not only at `sm`
(**A-022**, 1C §11).

---

## 9. Where each open item bites

This is the map 1G needed at the time. **All seven rows below are now
RESOLVED — AUTO-3, except GRID-2 (AUTO-5)** — kept here rather than deleted
so the map of which components each item touched stays on record. None of
these is owner-approved; full statements: `../MYTHOS_DESIGN_DECISIONS.md`
§0.5.

| Ref | Components affected | What is missing |
|---|---|---|
| ~~**SURF-1**~~ | Card, Dropdown, Modal, Tooltip, Toast, Select listbox, Table | **RESOLVED — AUTO-3.** Light ramp extended (`surface-card`, `border-strong` now have light values); `shadow-floating`/`shadow-overlay` defined for the three floating components. Table row hover unaffected |
| ~~**GOLD-2**~~ | Button, Checkbox, Radio, Switch, Tabs, Pagination, Link, state matrix §2.1 | **RESOLVED — AUTO-3.** Light-theme hover/active gold defined, both darkening from `gold-800` |
| ~~**GRID-1**~~ | Modal, page shell, Table full-bleed | **RESOLVED — AUTO-3.** 1440 is the 1280 container's own frame at its own margins, not a second width |
| ~~**GRID-2**~~ | Card body, Alert, Tooltip, Form help and error text | **RESOLVED — AUTO-5.** `container-prose` is 48ch |
| ~~**GRID-3**~~ | Button padding 9 / 15, Card padding 20, Checkbox box 20, Switch track 20 | **RESOLVED — AUTO-3.** Off-scale values confirmed as optical-correction/legitimate-outlier roles, not errors |
| ~~**TOKEN-1**~~ | All | **RESOLVED — AUTO-3.** `assets/brand/tokens/tokens.css` generated (new, unwired) |
| ~~**TOKEN-2**~~ | All | **RESOLVED — AUTO-3.** `--mythos-*` namespace adopted, matching C-006's real-world precedent |

---

## 10. New items raised by 1F — all four resolved, AUTO-3, 2026-08-18

| Ref | Statement | Adopted (**AUTO-3**, delegated mandate, not owner-approved) |
|---|---|---|
| ~~**MOTION-1**~~ | *"Nothing loops, nothing autoplays"* vs the required loading state | **Static skeletons and determinate progress only.** Adopted exactly as recommended |
| ~~**LINK-1**~~ | The inline text link has no approved colour | **Underline in `text-primary`, thickening on hover.** Adopted exactly as recommended |
| ~~**SHAPE-1**~~ | A switch track needs a pill; `radius-pill` is avatars/status-dots only | **Rectangular switch at `radius-control` (2).** Adopted exactly as recommended |
| ~~**GOLD-3**~~ | Select chevrons in gold breaks the scarcity rule | **Chevrons take `text-secondary`.** Adopted exactly as recommended |

**These were not resolved by inference or by a later stage needing them** — the
recommendation each already carried was reviewed, found sound, and formally
adopted under the delegated mandate recorded at `MYTHOS_DESIGN_DECISIONS.md`
§0.5, **AUTO-3**. The distinction the original text drew still matters: this is
not the token architecture quietly settling a value inside a component
(`DESIGN_TOKENS.md` §6) — it is an explicit, dated, reversible decision, on the
record as not owner-approved.

---

## 11. What this document did not do

- Did not create component code, CSS, `tokens.css`, `tokens.json`, Storybook,
  React components or any implementation asset.
- Did not modify application code, CSS, an existing asset or a deployed site.
- Did not resolve SURF-1, GOLD-2, GOLD-3, GRID-1, GRID-2, GRID-3, TOKEN-1,
  TOKEN-2, MOTION-1, LINK-1 or SHAPE-1.
- Did not adopt any PROPOSED value — those need owner approval, individually.
- Did not touch the logo system: **LOGO-2 remains PROPOSED — AWAITING OWNER
  APPROVAL**, gated on **LOGO-1**.
- Did not action MIG-1, MIG-2, MIG-3 or MIG-4.
