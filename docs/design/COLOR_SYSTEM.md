# MYTHOS Colour System

**Stage:** MYTHOS-DESIGN-1D — colour
**Date:** 2026-08-18 UTC
**Status:** **CANONICAL SPECIFICATION**, derived entirely from the owner-approved
master visual identity. Not implemented.

**Authority:** every value here is fixed by an owner decision —
**A-013** (Mythos Gold), **A-015** (semantic colours), **A-016** (non-text
boundaries), **A-010** (dark-first), **A-017** (both themes). Source document:
`MASTER_VISUAL_IDENTITY_1C_PROPOSAL.md` §3, approved at commit `35a8f8a`.

**This document introduces no new decisions.** It restates the approved system in
implementable form and records every contrast figure measured. Where the approved
specification did not settle something, it is marked **OPEN** rather than filled in.

**Not implemented.** No CSS, token file, application code or asset has been
changed. Applying this system to Mythos OS is tracked as **MIG-1** and **MIG-3**
and requires its own authorisation.

---

## 1. Principles

1. **Dark-first, light-complete** (**A-010**, **A-017**). Ink is the default
   ground because that is where the mark lives. Paper is fully specified, never a
   filter over the dark theme.
2. **Theme is a token remap, never a component fork.** The same semantic name
   resolves to a different value per theme. No `.dark-` variants.
3. **Gold is scarce.** One saturated colour on the page: primary action, active
   state, focus ring, and the single 35° gesture. Nothing else.
4. **Contrast is measured, not assumed.** Every pairing below was computed. A
   value that has not been measured against its ground may not be used.
5. **Colour never carries meaning alone.** Every semantic state pairs colour with
   form — a chip, a dot, a stripe or a label.

## 2. Neutrals — the ink and paper ramps

Neutrals carry a slight warm bias toward the gold, so the palette reads as chosen
rather than defaulted. Ratios are against the ground named in the Role column.

| Token | Value | Role | Measured |
|---|---|---|---|
| `ink-900` | `#0B0B0A` | Deepest ground, full-bleed sections | — |
| `ink-850` | `#0E0E0D` | **Primary dark ground** | — |
| `ink-800` | `#161614` | Raised surface | — |
| `ink-750` | `#1D1D1B` | Card | — |
| `ink-700` | `#2A2A27` | Hairline border on dark | — |
| `ink-600` | `#3A3934` | Strong divider on dark | — |
| `ink-550` | `#726F64` | **Control border on dark** | ink 3.84 · surface 3.60 · card 3.36 — all pass 3 : 1 |
| `ink-500` | `#55534B` | Secondary text **on paper** | paper 6.95 · paper-2 6.53 — AA |
| `ink-400` | `#7A776C` | **Non-text only** — disabled glyphs, decorative hairlines | 4.31 on ink — below AA for body text by design |
| `ink-300` | `#A8A498` | Secondary text **on ink** | ink 7.75 AAA · surface 7.27 AAA · **card 6.78 AA** |
| `ink-200` | `#CFCBC0` | Subtle text on ink; dividers on paper | — |
| `ink-100` | `#E8E4DC` | **Primary text on ink** | ink 15.23 · surface 14.29 · card 13.32 — AAA throughout |
| `paper-100` | `#F5F3EF` | **Primary light ground** | — |
| `paper-200` | `#EFECE5` | Raised surface on light | — |
| `paper-300` | `#D6D1C5` | Hairline border on light | — |
| `paper-500` | `#7F7B6D` | **Control border on light** | paper 3.82 · paper-2 3.59 — both pass 3 : 1 |
| `paper-900` | `#14130F` | **Primary text on paper** | paper 16.77 · paper-2 15.75 — AAA |

**Two honest notes.**

- `ink-300` reaches AAA on the ground and the raised surface but **AA (6.78) on
  the card**. Secondary text on a card is therefore AA, not AAA. Stated rather
  than rounded up.
- `ink-400` deliberately **fails** body-text contrast. It exists for disabled
  glyphs and decorative hairlines only. Routing secondary text here is the exact
  defect **A-015** corrects — the recovered `--muted` sat at 3.47 : 1.

## 3. Mythos Gold

**A-013.** Mythos Gold is **`#D9A441`** — the gold in the historical mark. It is
the only saturated colour in the system.

| Token | Value | On ink | On paper | Use |
|---|---|---|---|---|
| `gold-200` | `#EBCE99` | 12.71 | 1.37 | Hover on dark; large display graphics |
| `gold-400` | `#DDAE55` | 9.44 | 1.85 | Active/pressed on dark |
| **`gold-500`** | **`#D9A441`** | **8.59** | 2.05 | **Mythos Gold — the brand value.** Ink contexts |
| `gold-700` | `#9D711F` | 4.43 | 3.94 | Borders and large graphics on light |
| **`gold-800`** | **`#805C19`** | 3.18 | **5.47** | **Gold text and icons on light grounds** |

**Verified across surfaces:** `gold-500` measures ink 8.59 · surface 8.06 · card
7.51 — AAA on all three. `gold-800` measures paper 5.47 · paper-2 5.14 — AA on
both.

### 3.1 The rule that produced two golds

**No single gold serves both grounds.** `#D9A441` is 8.59 : 1 on ink and
**2.05 : 1 on paper**. Holding the hue constant and sweeping lightness, the one
value that serves both lands near `#996E1F` — 4.12 on paper, 4.23 on ink:
mediocre on each and good on neither. A gold per ground is therefore a technical
requirement, not a stylistic choice.

### 3.2 Gold usage rules

1. **Scarce.** One gold element per view carries emphasis. If two things are
   gold, one of them is wrong.
2. **Never a ground.** No gold panels, headers or page fills. The moment gold
   becomes a surface it stops signalling.
3. **Never body text on paper.** `gold-500` is 2.05 : 1 there. Text uses
   `gold-800`; the bright gold is permitted on light only for large non-text
   graphics.
4. **Button labels on gold:** `ink-850` on `gold-500` measures **8.59 : 1**;
   `paper-100` on `gold-800` measures **5.47 : 1**. Both pass.

## 4. Semantic colours

**A-015.** Verified on all four surfaces, not only the primary ground.

| Role | On dark | ink / surface / card | On light | paper / paper-2 |
|---|---|---|---|---|
| success | `#4ADE80` | 11.08 / 10.40 / 9.69 | `#136B34` | 5.96 / 5.60 |
| warning | `#F0A342` | 9.22 / 8.65 / 8.06 | `#7A4F09` | 6.42 / 6.03 |
| danger | `#F1706A` | 6.68 / 6.27 / 5.84 | `#9E2419` | 6.97 / 6.54 |
| info | `#7DC4EA` | 10.08 / 9.45 / 8.81 | `#19608F` | 6.09 / 5.72 |

**What this corrects (RECOVERED, measured):** `--danger` 3.55 : 1, `--muted`
3.47 : 1 and `--past` 2.59 : 1 all failed as body text — the tokens carrying
errors, secondary information and disabled state. The corrected hues stay in the
recovered family; this is a correction, not a replacement.

### 4.1 The `-dim` companion rule

**Preserved from D-001 and promoted to a system rule.** Every semantic colour has
a **12 %-alpha companion** for backgrounds:

```
--success-dim: rgba(74, 222, 128, 0.12)
--warning-dim: rgba(240, 163, 66, 0.12)
--danger-dim:  rgba(241, 112, 106, 0.12)
--info-dim:    rgba(125, 196, 234, 0.12)
--gold-dim:    rgba(217, 164, 65, 0.12)
```

Solid for the mark, dim for the field. This convention is the strongest piece of
systematic thinking recovered from the existing codebase and it survives intact.

**Status is form plus colour.** A `-dim` background always accompanies a dot, a
chip outline or a leading stripe. Colour alone never conveys state.

## 5. Data visualisation

Eight series, all ≥ 7 : 1 on ink, ordered for hue separation and checked for
distinguishability under the common colour vision deficiencies.

| # | Value | On ink | | # | Value | On ink |
|---|---|---|---|---|---|---|
| 1 | `#D9A441` | 8.59 | | 5 | `#F0A342` | 9.22 |
| 2 | `#7DC4EA` | 10.08 | | 6 | `#6FB3A8` | 7.99 |
| 3 | `#4ADE80` | 11.08 | | 7 | `#E8846F` | 7.32 |
| 4 | `#B98BD0` | 7.05 | | 8 | `#8E9BD4` | 7.16 |

Gold leads the sequence. Categorical series never rely on hue alone — shape,
label or position carries the same information.

**OPEN:** sequential and diverging scales for continuous data are not specified.
They were outside the approved 1C scope and must not be improvised.

## 6. Focus and non-text boundaries

**A-016.** WCAG 2.2 requires 3 : 1 for non-text UI. The recovered palette
contained **no value that met it for a control boundary** — form fields had no
conforming border anywhere in the system.

| Element | Dark | Light |
|---|---|---|
| Focus ring, 2 px at 2 px offset | `gold-500` — ink 8.59, surface 8.06 | `gold-800` — paper 5.47 |
| Control border (input, select, checkbox) | `ink-550` — 3.84 / 3.60 / 3.36 | `paper-500` — 3.82 / 3.59 |
| Hairline (decorative, non-meaning) | `ink-700` | `paper-300` |

**Focus is never removed.** Hairlines below 3 : 1 are permitted only where they
carry no meaning; anything that defines an interactive boundary uses the control
border token.

## 7. Applying the system

**Elevation is by surface, not by shadow:** `ink-850 → ink-800 → ink-750` with a
1 px `ink-700` hairline. Shadows are reserved for elements that genuinely float —
menus, modals, toasts.

**Token layering** (**A-009** §9): components consume *semantic* names
(`text-primary`, `ground`, `accent`, `border-subtle`, `focus-ring`), never raw
values. A component asking for `gold-500` would lock the brand colour into the
component; one asking for `accent` survives any future change to the gold.

## 8. Open

| Ref | Question |
|---|---|
| **O-A1** | Mythos Command Center's indigo `#4f46e5` sits outside this palette. Its classification is unresolved, and resolving it has a visible colour consequence |
| **O-A3** | Whether, and under what conditions, a public project may use a Mythos-level colour in its own identity |
| **New — SEQ-1** | Sequential and diverging data scales (§5) |
| **MIG-1 / MIG-3** | Aligning the implemented Mythos OS tokens with this system. **Not actioned** — requires its own authorisation |

## 9. What this document did not do

- Did not change any CSS, token file, application code or asset.
- Did not introduce a colour decision that the owner has not approved.
- Did not resolve O-A1 or O-A3.
- Did not action MIG-1 or MIG-3.
