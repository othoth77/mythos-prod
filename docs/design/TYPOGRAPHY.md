# MYTHOS Typography

**Stage:** MYTHOS-DESIGN-1D — typography
**Date:** 2026-08-18 UTC
**Status:** **CANONICAL SPECIFICATION**, derived entirely from the owner-approved
master visual identity. Not implemented.

**Authority:** **A-014** (master typography; Playfair Display removed),
**A-011**/**A-012** (Constant + Movement), **A-006** (project independence).
Source document: `MASTER_VISUAL_IDENTITY_1C_PROPOSAL.md` §4, approved at commit
`35a8f8a`.

**This document introduces no new decisions.** Where the approved specification
did not settle something, it is marked **OPEN**.

**Not implemented.** No application CSS or application code has been changed.
Real, self-hosted font files now exist at `assets/brand/fonts/` (OFL-1.1,
latin/arabic subsets, the weight instances the scale in §2 actually uses) as
a standalone, unwired specification artifact — see
`assets/brand/fonts/fonts.css`. It is not referenced by any HTML, project or
build step; wiring it in is a separate, future authorisation. Replacing the
45 existing `Playfair Display` declarations is tracked as **MIG-2** and
requires its own authorisation.

---

## 1. The stack

**A-014.** Playfair Display is removed from the MYTHOS master typography.

| Role | Face | Licence | Why |
|---|---|---|---|
| **Display** | **Archivo Expanded** (variable: width + weight) | OFL | Its extended geometric proportions echo the wordmark, so headlines read as related to the mark without being set in it. This is the typographic half of **Constant + Movement** — the display face is the *movement*, used large and sparingly |
| **Text / UI** | **IBM Plex Sans** (variable) | OFL | Engineered and neutral without being anonymous; holds at 11–14 px, which is where this interface actually lives. Not Inter, so not the default face everyone reaches for |
| **Arabic** | **IBM Plex Sans Arabic** | OFL | Designed as part of the same family — Arabic and Latin share proportions and colour |
| **Data / code** | **IBM Plex Mono** | OFL | Same family; tabular figures for financial and technical tables |

**Why one family across three scripts:** it is the difference between a brand
that is *bilingual* and one that is merely *translated*. All four faces are
open-licensed, variable and self-hostable — no licence cost at any scale, no
external dependency, no per-property negotiation as the group grows.

**Why Playfair had to go** (RECOVERED evidence, in order of severity):

1. **It has no Arabic.** For a group operating in Arabic, French and English, a
   master display face covering one script of three cannot hold.
2. **Its hairlines disappear where the interface lives.** The three most common
   sizes in `css/*.css` are 12 px, 11 px and 13 px.
3. **It signals the wrong category** — luxury-editorial, where Mythos is
   technical and industrial, and where the recovered wordmark is an extended
   geometric sans.

**Scope:** the master brand only. Playfair may remain in any public project whose
own identity calls for it — protected by **A-006**.

## 2. The scale

Ratio 1.25, base 16 px.

| Style | Size / line-height | Tracking | Face and weight |
|---|---|---|---|
| Display XL | 61 / 1.02 | −0.022em | Archivo Expanded 600 |
| Display L | 49 / 1.06 | −0.020em | Archivo Expanded 600 |
| H1 | 39 / 1.12 | −0.018em | Archivo Expanded 600 |
| H2 | 31 / 1.18 | −0.015em | Archivo Expanded 600 |
| H3 | 25 / 1.24 | −0.012em | Plex Sans 600 |
| H4 | 20 / 1.32 | −0.008em | Plex Sans 600 |
| Body L | 18 / 1.62 | 0 | Plex Sans 400 |
| Body | 16 / 1.62 | 0 | Plex Sans 400 |
| Body S | 14 / 1.56 | 0 | Plex Sans 400 |
| Caption | 13 / 1.46 | +0.005em | Plex Sans 400 |
| Label | 12 / 1.34 | +0.10em, uppercase | Plex Sans 500 |
| Data | 14 / 1.44 | 0, tabular figures | Plex Mono 400 |

**Rules.**

- Running text is capped near **65 characters**.
- Headings take `text-wrap: balance`.
- **Body text never renders below 16 px on any viewport.**
- Display styles scale fluidly with `clamp()` between the scale's stops; they
  never interpolate outside them.
- Only Archivo carries the display role. Setting a heading in Plex above H3, or
  body copy in Archivo, is out of system.

## 3. Arabic

**A-014.** Six binding rules. The first two are the ones most bilingual systems
get wrong; the third is a correctness requirement, not a preference.

1. **+6 % size** on every Arabic style. Arabic set at an identical size reads
   visually smaller than Latin.
2. **+0.15 line-height** on every Arabic style. Diacritics need vertical room.
3. **Letter-spacing is forced to `0`.** Tracking breaks Arabic joining. **No
   Arabic style may set tracking** — including the Label style, which carries
   +0.10em in Latin and must drop to 0 in Arabic.
4. **`lang` and `dir` are set per element, not per page**, so mixed Arabic and
   French content inside one block renders correctly in both directions.
5. **Logical CSS properties throughout** — `margin-inline-start`, never
   `margin-left`.
6. **Numerals:** Western Arabic numerals (0–9) by default across all three
   languages, because the same figures appear in invoices, tables and exports
   read by all three audiences.

**What does not mirror in RTL:** numbers, media controls, progress direction,
logos — **and the M's slant.** The slant direction is part of the mark's identity
and is fixed in both reading directions (**A-012**, **A-007**).

## 4. Typographic colour and hierarchy

Hierarchy is carried by **size and weight**, not by colour. Text colour comes
from the colour system (`COLOR_SYSTEM.md` §2) and has exactly three roles:

| Role | On ink | On paper |
|---|---|---|
| Primary text | `ink-100` — 15.23 : 1 | `paper-900` — 16.77 : 1 |
| Secondary text | `ink-300` — 7.75 : 1 (6.78 on a card) | `ink-500` — 6.95 : 1 |
| Disabled / non-text glyphs | `ink-400` — deliberately below body contrast | `paper-500` |

**Gold is never used to create hierarchy in running text.** It marks the primary
action, the active state, the focus ring and the single 35° gesture — nothing
else (`COLOR_SYSTEM.md` §3.2).

## 5. Loading and performance

- **Self-hosted**, subset per script, `font-display: swap`.
- Variable axes only where used: Archivo needs `wdth` and `wght`; requesting the
  full axis range when two instances are used is waste.
- Latin and Arabic subsets load independently — a French-only page must not
  download the Arabic face.
- Every family declares a real fallback stack. A silent fallback to a system
  face is a visual bug, not a graceful degradation.

**Self-hosted files now exist** (`assets/brand/fonts/`, unwired) at exactly
the weight instances the scale in §2 uses: Archivo 600 (wdth 125%), Plex Sans
400/500/600, Plex Sans Arabic 400/500/600, Plex Mono 400 — `latin` subset for
the first, third and fourth, `arabic` for Plex Sans Arabic. Total vendored
size: 284 KB across 8 files.

**OPEN — TYPE-2, narrowed but not closed:** the weight instances above are
derived directly from the already-approved scale, not a new decision. What
TYPE-2 still has not settled: whether additional subsets beyond latin/arabic
(e.g. `latin-ext` for French diacritics) are needed, and the KB performance
budget once real usage is measured against a live page. These remain outside
the approved 1C scope.

## 6. Open

| Ref | Question |
|---|---|
| **TYPE-2** | Narrowed: weight instances are now sourced and self-hosted. Still open — subset ranges beyond latin/arabic, and the font performance budget |
| **MIG-2** | Replacing the 45 `Playfair Display` declarations in `css/*.css`. **Not actioned** |
| **U-003** | The historical rationale for the Playfair + Inter pairing was never recorded, and retiring it does not recover it |

## 7. What this document did not do

- Did not change any application CSS or application code.
- Did not wire the self-hosted font files (`assets/brand/fonts/`) into any
  application, HTML file or build step — they exist as a standalone artifact.
- Did not introduce a typographic decision the owner has not approved — the
  vendored weight instances are read directly from the already-approved §2
  scale, not a new choice.
- Did not action MIG-2.
- Did not re-measure `GRID_AND_SPACING.md` §4.3 against the new files' real
  character-advance metrics — GRID-2 remains narrowed, not closed (see
  `docs/design/IMPLEMENTATION_READINESS_AUDIT.md` §2.2).
