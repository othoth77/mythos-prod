# MYTHOS Design Tokens

**Stage:** MYTHOS-DESIGN-1E — token architecture
**Date:** 2026-08-18 UTC
**Status:** **CANONICAL SPECIFICATION**, derived entirely from the owner-approved
master visual identity. **No token artifact was generated** — see §8.

**Authority:** **A-009** — the 1C approval. Source section:
`MASTER_VISUAL_IDENTITY_1C_PROPOSAL.md` **§9** (token philosophy), approved at
commit `35a8f8a`, which states plainly: *"Philosophy only; the token file is
Stage 1E."* Values come from `COLOR_SYSTEM.md` (**A-013**, **A-015**, **A-016**),
`TYPOGRAPHY.md` (**A-014**) and `GRID_AND_SPACING.md`.

**This document introduces no new values.** It introduces **structure** — the
naming grammar and the semantic set — which is what a token stage is for. Every
structural choice this document makes rather than inherits is **marked as such**
so the owner can reject it individually.

**Not implemented.** No CSS, token file, application code or asset has been
changed. Applying tokens to Mythos OS remains **MIG-3**, unactioned.

---

## 1. The three tiers

Approved, unchanged:

```
GLOBAL      raw values, named for what they are      gold-500, ink-850, space-6
   ↓        a component may never reference these
SEMANTIC    named for what they mean                 text-primary, ground, accent,
   ↓        the layer designers argue about          border-subtle, focus-ring
COMPONENT   named for where they act                 button-bg, card-border
```

**The five rules** (approved §9), each preventing a failure this repository
already demonstrates:

1. **No hardcoded visual values in components.** Twelve radius values and eight
   durations exist in the codebase precisely because nothing forced a scale.
2. **Components consume semantic tokens, never global ones.**
3. **Every token has exactly one reason to change.**
4. **Theme is a token remap, never a component fork.** No `.dark-button`.
5. **The semantic layer stays at roughly 40–60 tokens** — a system, not a
   dictionary nobody reads.

**Rule 5 is measured in §5: the semantic layer specified here is 59 tokens.**

---

## 2. Naming grammar

Derived strictly from the four examples the approved text gives — `gold-500`,
`ink-850`, `space-6`, `text-primary`, `border-subtle`, `focus-ring`, `button-bg`,
`card-border`:

| Tier | Shape | Reading |
|---|---|---|
| GLOBAL | `<family>-<step>` | The family is a material (`gold`, `ink`, `paper`, `space`, `radius`). The step is a position on its scale, never a description |
| SEMANTIC | `<role>` or `<role>-<variant>` | The role is what it means (`ground`, `accent`, `text-primary`). The variant is a state or intensity (`-hover`, `-dim`) |
| COMPONENT | `<component>-<part>` | `button-bg`, `card-border`. The component name comes first, always |

**Numeric steps ascend with lightness in the neutral ramps** (`ink-100` is the
lightest ink, `ink-900` the darkest ground) and **with saturation weight in the
golds** (`gold-200` lightest through `gold-800` darkest). This is the convention
the approved palette already follows; it is recorded here because a token file
that broke it would be silently confusing.

**OPEN — TOKEN-2:** whether tokens carry a namespace prefix (`--mythos-accent`
vs `--accent`). The approved examples show none, but they are illustrative rather
than literal, and a shared ecosystem with independently branded public projects
(**A-006**) is exactly the situation where a prefix earns its keep. Not decided
here.

---

## 3. The GLOBAL tier

Global tokens are **not** listed again in this document where a canonical source
already holds them. Duplication is how token systems drift.

| Family | Count | Canonical source |
|---|---|---|
| `ink-*`, `paper-*` | 17 | `COLOR_SYSTEM.md` §2 |
| `gold-*` | 5 | `COLOR_SYSTEM.md` §3 |
| semantic hues + `-dim` | 8 + 5 | `COLOR_SYSTEM.md` §4, §4.1 |
| chart series | 8 | `COLOR_SYSTEM.md` §5 |
| type scale, faces, Arabic rules | 12 styles | `TYPOGRAPHY.md` §2, §3 |
| `space-1` … `space-12` | 12 | `GRID_AND_SPACING.md` §2 |
| `radius-0` … `radius-full` | 5 | `GRID_AND_SPACING.md` §7 |
| `motion-*`, easings | 5 + 3 | 1C §10 |

### 3.1 Two global families this stage had to name

`GRID_AND_SPACING.md` §3 establishes that grid metrics and control heights are
**not** on the spacing scale. They therefore need families of their own, or the
component library will try to build them from `space-*` and fail:

| Token | Values | Source |
|---|---|---|
| `grid-columns-{sm,md,lg}` | 4 / 8 / 12 | 1C §5 |
| `grid-gutter-{sm,md,lg}` | 16 / 20 / 24 | 1C §5 |
| `grid-margin-{sm,md,lg}` | 20 / 48 / 80 | 1C §5 |
| `container-content` | 1280 | 1C §5 |
| `container-wide` | 1440 | 1C §5 — reading ambiguous, **GRID-1** |
| `container-prose` | 68ch | 1C §5 — unit unreconciled, **GRID-2** |
| `size-control-compact` | 36 | 1C §7 |
| `size-control-comfortable` | 40 | 1C §7 |
| `size-touch-min` | 44 | 1C §7, §11 — conflicts with the above, **C-005** |

**Structural choice, flagged for approval:** grid tokens are consumed directly by
the **layout primitive**, not through the semantic tier. Rule 2 says components
consume semantic tokens; a layout frame is the thing components sit *in* rather
than a component, so routing 9 grid values through 9 semantic aliases would add
names without adding meaning and would push the semantic layer past the 60-token
ceiling. **This is this document's decision, not the owner's**, and it is the one
place where the tier discipline is deliberately relaxed. It can be reversed at the
cost of nine semantic tokens.

---

## 4. The SEMANTIC tier

The layer components actually consume. **Every value is inherited; nothing here is
a new colour, size or duration.**

### 4.1 Ground and surface — 4

| Token | Dark | Light |
|---|---|---|
| `ground` | `ink-850` | `paper-100` |
| `ground-deep` | `ink-900` | **OPEN — SURF-1** |
| `surface` | `ink-800` | `paper-200` |
| `surface-card` | `ink-750` | **OPEN — SURF-1** |

The light ramp has two steps to the dark ramp's four. The two empty cells are
left empty rather than guessed.

### 4.2 Text — 5

| Token | Dark | Light | Measured |
|---|---|---|---|
| `text-primary` | `ink-100` | `paper-900` | 15.23 · 16.77 — AAA |
| `text-secondary` | `ink-300` | `ink-500` | 7.75 (6.78 on a card) · 6.95 — AA/AAA |
| `text-disabled` | `ink-400` | `paper-500` | below body contrast **by design** |
| `text-on-accent` | `ink-850` on `gold-500` | `paper-100` on `gold-800` | 8.59 · 5.47 |
| `text-inverse` | `paper-900` | `ink-100` | for blocks that invert their ground |

### 4.3 Border and focus — 4

| Token | Dark | Light |
|---|---|---|
| `border-hairline` | `ink-700` | `paper-300` |
| `border-control` | `ink-550` — 3.84 / 3.60 / 3.36 | `paper-500` — 3.82 / 3.59 |
| `border-strong` | `ink-600` | **OPEN — SURF-1** |
| `focus-ring` | `gold-500` — 8.59 | `gold-800` — 5.47 |

**Focus is never removed** (**A-016**). Both focus values exceed the 3 : 1 that
WCAG 2.2 requires for non-text UI.

### 4.4 Accent — 4

| Token | Dark | Light |
|---|---|---|
| `accent` | `gold-500` | `gold-800` |
| `accent-hover` | `gold-200` | **OPEN — GOLD-2** |
| `accent-active` | `gold-400` | **OPEN — GOLD-2** |
| `accent-dim` | `gold-dim` (12 % alpha) | `gold-dim` |

**GOLD-2:** the approved palette designates two golds for light grounds —
`gold-700` for borders and large graphics, `gold-800` for text. Neither is
designated as a light-theme *hover* or *active* state, and `gold-700` measures
3.94 on paper, which is below AA for text. The light interaction states are
therefore genuinely unspecified. Not invented here.

### 4.5 Status — 8

`success` · `success-dim` · `warning` · `warning-dim` · `danger` · `danger-dim` ·
`info` · `info-dim`. Values per theme in `COLOR_SYSTEM.md` §4, all verified on
four surfaces. **Solid for the mark, dim for the field** — and status is always
**form plus colour**, never colour alone.

### 4.6 Spacing — 8

| Token | Value | | Token | Value |
|---|---|---|---|---|
| `space-section-sm` | 48 | | `space-component-xs` | 8 |
| `space-section-md` | 64 | | `space-component-sm` | 12 |
| `space-section-lg` | 96 | | `space-component-md` | 16 |
| `space-section-xl` | 128 | | `space-component-lg` | 24 |

These are the two legal bands, and nothing else. A component reaching past
`space-component-lg` is asking for a section gap and is wrong.

### 4.7 Radius — 5

`radius-none` 0 · `radius-control` 2 · `radius-card` 6 · `radius-overlay` 12 ·
`radius-pill` 999.

`radius-control` is the workhorse. `radius-pill` is for avatars and status dots
**only** — it is not a button style.

### 4.8 Size — 3

`size-control-compact` 36 · `size-control-comfortable` 40 · `size-touch-min` 44.

**These three cannot all be satisfied at once (C-005).** Recorded, not resolved.

### 4.9 Motion — 8

`motion-micro` 120 · `motion-base` 180 · `motion-enter` 240 · `motion-overlay` 320 ·
`motion-page` 480 · `ease-enter` `cubic-bezier(0.2,0,0,1)` · `ease-exit`
`cubic-bezier(0.4,0,1,1)` · `ease-move` `cubic-bezier(0.4,0,0.2,1)`.

Under `prefers-reduced-motion` every transform collapses to opacity and all
durations resolve to `motion-micro` (**A-018**). **This is a token remap, not a
component fork** — which is rule 4 doing real work.

### 4.10 Elevation — 2

`shadow-floating` (menus, toasts) · `shadow-overlay` (modals, sheets).

**Both are slots with no values.** The approved specification says when a shadow
is permitted and never what it is — **SURF-1**.

### 4.11 Data visualisation — 8

`chart-1` … `chart-8`, in the approved order, all ≥ 7 : 1 on ink. Gold leads the
sequence. Series never rely on hue alone.

**OPEN — SEQ-1** (carried from `COLOR_SYSTEM.md` §5): sequential and diverging
scales for continuous data are not specified and must not be improvised.

---

## 5. Rule 5, measured

| Group | Tokens |
|---|---|
| Ground and surface | 4 |
| Text | 5 |
| Border and focus | 4 |
| Accent | 4 |
| Status | 8 |
| Spacing | 8 |
| Radius | 5 |
| Size | 3 |
| Motion | 8 |
| Elevation | 2 |
| Data visualisation | 8 |
| **Total** | **59** |

**Inside the approved 40–60 band, with one token of headroom.** That is worth
stating rather than celebrating: **1F cannot add semantic tokens freely.** A new
semantic name must displace an existing one or justify raising the ceiling, and
the ceiling is an approved constraint. Component-tier tokens are unlimited — that
is where component-specific naming belongs.

---

## 6. The COMPONENT tier

**Not specified here.** Component tokens are named for *where they act*
(`button-bg`, `card-border`), so they cannot be written before the component set
exists — that is **Stage 1F**.

What 1F inherits as binding:

- A component token resolves to a **semantic** token, never to a global one and
  never to a raw value.
- Every interactive element has six states — **default, hover, active,
  focus-visible, disabled, loading** — and a component without all six is
  unfinished.
- Theme is handled entirely at the semantic tier. **No component may branch on
  theme.**
- The six conflicts and gaps in §9 must be resolved *explicitly* by 1F or the
  owner. Resolving one by picking a value inside a component is the exact failure
  this architecture exists to prevent.

---

## 7. Theming

One remap, at one tier:

```
:root                          → semantic names resolve to the dark ramp
[data-theme="light"]           → the same names resolve to the paper ramp
@media (prefers-color-scheme)  → default follows the system when unset
```

**Dark-first, light-complete** (**A-010**, **A-017**). Light is fully specified,
never a filter over dark. No component, and no component token, changes.

---

## 8. What was **not** produced, and why

**No `tokens.css`, `tokens.json` or any other token artifact was written.**

The approved 1C text authorises the token *architecture* at 1E, and this document
is that architecture. Generating a real artifact is a different act: it puts CSS
custom properties or a JSON build input into the repository, which every recent
owner instruction has excluded — *no code changes, no CSS changes, no asset
changes*. It is also the point at which the unresolved items in §9 would have to
be given values, because a file cannot contain an empty cell the way a
specification can.

Recorded as **TOKEN-1**: generating the token artifact requires explicit owner
authorisation, and should follow the resolution of **C-005**, **SURF-1** and
**GOLD-2** rather than precede it.

**One consequence of the architecture, re-checked and still true:** because
components ask for `accent` and never for `gold-500`, the token structure did not
need GOLD-1 settled to be designed. GOLD-1 *was* settled (**A-013**), so this is
now only a robustness property — but it is the property that will absorb the next
brand-level colour decision without touching a component.

---

## 9. Open

| Ref | Statement |
|---|---|
| **C-005** | 40 px comfortable control height vs 44 px touch minimum — two approved statements that cannot both hold |
| **TOKEN-1** | Generating an actual token artifact is **not authorised** and should follow C-005 / SURF-1 / GOLD-2 |
| **TOKEN-2** | Namespace prefix on token names (`--mythos-accent` vs `--accent`) |
| **SURF-1** | Light elevation ramp has 2 steps to dark's 4; no shadow values specified |
| **GOLD-2** | Light-theme gold hover and active states are unspecified |
| **SEQ-1** | Sequential and diverging data scales (carried from `COLOR_SYSTEM.md` §5) |
| **GRID-1 / 2 / 3** | Container, measure and scale-band questions — see `GRID_AND_SPACING.md` §9 |
| **MIG-1 / MIG-3** | Aligning implemented Mythos OS tokens with this system. **Not actioned** |

---

## 10. What this document did not do

- Did not write a token file, stylesheet, build input or any other artifact.
- Did not change any CSS, application code or asset.
- Did not introduce a colour, size, spacing, radius or duration value the owner
  has not approved.
- Did not resolve C-005, SURF-1, GOLD-2, SEQ-1, TOKEN-2 or any GRID item.
- Did not specify components — that is Stage 1F.
- Did not action MIG-1, MIG-2, MIG-3 or MIG-4.
