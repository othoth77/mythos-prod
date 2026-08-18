# MYTHOS Logo System

**Stage:** MYTHOS-DESIGN-1B — logo evolution
**Date:** 2026-08-18 UTC
**Status:** **PROPOSAL — awaiting owner validation.** Nothing in this document is
deployed, and no production file references any asset described here.
**Predecessor:** `docs/design-recovery/MYTHOS_ORIGINAL_LOGO_RECOVERY.md` (the
canonical record of the original logo, which this evolution is built from).

Governing principle, per owner directive: **evolution, not revolution.** Every
change below exists to make the recovered identity reproducible, scalable and
professional. Nothing was redesigned for novelty, and the original assets were
neither modified nor overwritten.

---

## 1. What was preserved, and why

The original is a raster lockup: **MYTHOS** in polished metallic silver over a
gold **PROD** descriptor flanked by tapered spear flourishes, on black. These
attributes were treated as the identity and carried forward unchanged in
character:

| Preserved attribute | Why it is identity, not decoration |
|---|---|
| **The tilted M** — slanted against an otherwise upright wordmark | The single most recognizable feature of the mark. Owner directive names it critical. Measured at 34.9° from vertical in the source |
| **Upright Y·T·H·O·S** | The asymmetry only reads because everything else stands upright. Slanting the rest would destroy the effect |
| **M integrated with YTHOS** | The lockup is one word. The M is never detached, and "OS" is never split off (owner directive §4) |
| **Extended geometric sans, flat terminals, circular O** | Establishes the technical, precise, engineered character |
| **Descriptor line beneath the wordmark** | The original MYTHOS / PROD architecture. This is what makes the master brand extensible — see §6 |
| **Tapered rules flanking the descriptor** | The spear flourishes, flattened to a reproducible form |
| **Gold as the descriptor colour** | Carried forward provisionally; the value itself is an OPEN decision — see §8 |

## 2. What was changed, and why

| Change | Reason |
|---|---|
| **Metallic gradient and bevel removed; the mark is now flat and single-colour** | The chrome treatment is the original's central technical liability. It cannot be reproduced in one colour, does not survive small sizes, fails in print and embroidery, and cannot be recoloured for context. A flat master reproduces everywhere; atmosphere belongs to the surface behind the logo, not inside it |
| **Raster → vector** | No vector master has ever existed (VERIFIED across 438 commits). Every downstream deliverable — favicon, app icon, print, signage — was blocked on this |
| **Black ground no longer baked in** | Both historical renditions have an opaque ground (the "dark" master is not transparent). The masters are now ground-independent and use `currentColor` where the host controls colour |
| **"PROD" demoted from the master to a business-unit descriptor** | Owner directive §1: the master brand is MYTHOS, not MYTHOS PROD. Mythos Prod survives as one endorsed unit among five |
| **M slant rationalized 34.9° → exactly 35.0°** | 34.9° is a measurement artifact of a raster, not a decision. An exact angle is reproducible, checkable, and can be reused as a system-wide motif |
| **Stroke weights unified** | The source varies by 1–2 px between letters — raster noise. Now exactly 260 units vertical, 210 horizontal |
| **O rebuilt as a true concentric ring** | The traced O is polygonal at the pixel level. A true geometric ring is what the original was drawn to be |

## 3. Construction grid

All geometry lives on a **1000-unit cap-height grid**, origin at the top-left of
the cap band, y increasing downward (SVG user space). Deriving every size from
cap height — rather than from an arbitrary artboard — is what lets the logo be
placed by optical size rather than by file dimensions.

| Constant | Value | Source |
|---|---|---|
| Cap height | 1000 | the unit of the system |
| M diagonal slant | 0.70 dx/dy = **35.0°** | measured 34.9°, rationalized |
| Vertical stem | 260 | measured 43 px at cap 166 px = 259 |
| Horizontal bar | 210 | measured; lighter than the stem by optical convention |
| Wordmark width | 6074 | **aspect ratio 6.074 : 1** |
| Letter gaps (M·Y, Y·T, T·H, H·O, O·S) | 60, 48, 72, 66, 54 | measured ink gaps, preserved — they are optically corrected, not uniform |

The gaps are deliberately unequal. Equalizing them would be a regression: the
wider T·H and H·O gaps compensate for the open counters of T and O, and that
optical correction is present in the original.

**Canonical geometry lives in code**, not in a binary: `assets/brand/source/mythos-logo-geometry.py`.
Every master is generated from it by `assets/brand/source/build-masters.py`, so
the system cannot drift between files.

## 4. The M — protected geometry

The M is defined by twelve points. Its three diagonals share one slope (0.70),
its right stem is exactly vertical, and its centre wedge descends to a point on
the baseline while the outer legs terminate flat.

Rules:

1. The slope 0.70 is **fixed**. Never re-slant, italicize, or "correct" it.
2. The M is never separated from YTHOS in the primary logo.
3. The M may be used alone **as a symbol** (§5) — an extension of the identity,
   never a replacement for the wordmark.
4. Never mirror, rotate, or outline the M.

## 5. The system

| Master | File | Use |
|---|---|---|
| Primary wordmark | `mythos-wordmark.svg` | The master brand. Default in all contexts |
| Ink / reversed | `mythos-wordmark-ink.svg`, `-reversed.svg` | Fixed-colour variants for contexts without `currentColor` |
| Business-unit lockups | `mythos-lockup-{os,prod,digital,services,logistique}.svg` | Wordmark + descriptor + gold rules |
| Symbol | `mythos-symbol-m*.svg` | Square contexts, avatars, watermarks, favicons |
| App icon | `mythos-appicon-{dark,light}.svg` | Rounded tile, mark at 46 % of tile height |
| Favicon | `mythos-favicon.svg` | Square tile, mark at 58 % — larger because browser chrome renders it tiny |

**Verified rendering** (rendered and inspected at real pixel sizes, this stage):
the wordmark holds to **90 px wide**; the symbol holds to **32 px**. Below
90 px the wordmark must be replaced by the symbol, not scaled further.

## 6. Brand architecture in the logo

The original already solved the extensibility problem — MYTHOS over a descriptor —
and the evolution simply generalizes it:

```
        MYTHOS                    ← master brand, constant
   ──   OS / PROD / DIGITAL  ──   ← descriptor, the only variable part
        SERVICES / LOGISTIQUE
```

The descriptor is a single word. It is never "MYTHOS OS" — that would duplicate
the word MYTHOS, which is already the dominant element. Spoken and written in
prose the unit is still "Mythos OS"; the lockup renders it as MYTHOS / OS.

This is what makes the system scale to units and projects that do not exist yet
without redrawing anything.

## 7. Clear space and minimum sizes

- **Clear space:** on all four sides, not less than the **cap height of the M
  divided by 2** (500 units). Nothing — type, rule, image edge, or partner
  logo — enters that zone.
- **Minimum sizes:** wordmark **90 px** wide on screen / 25 mm in print;
  symbol **32 px** / 8 mm.
- **Never** place the wordmark on a photograph without a solid or scrimmed
  ground behind it; the flat master has no built-in separation, by design.

## 8. Open decisions carried into 1C / 1D

These are named rather than silently settled:

- **O-L1 — the gold value.** The lockup rules currently use `#C9A84C`, the
  Mythos OS UI gold, as a placeholder. The original logo's gold is a *gradient*
  sampled at roughly `#AB7E2F → #F8D276`, centred near `#D9A441`. Whether the
  master gold becomes the UI gold, the logo's centre value, or a new value is a
  **Stage 1D colour decision** and is deliberately not made here.
- **O-L2 — descriptor typeface.** The lockups set the descriptor in Inter with
  a fallback stack, as a stand-in. The real typography decision is Stage 1D;
  when it lands, the descriptor must be converted to outlines in the masters so
  the lockups carry no font dependency.
- **O-L3 — the ink and paper values.** `#0E0E0E` and `#F5F3EF` are taken from
  the existing Mythos OS tokens as a reasonable default, pending 1D.
- **O-L4 — vector provenance.** A layered or vector original may still exist
  off-Git (see the recovery record §7). If one is found, this reconstruction
  must be diffed against it before the masters are declared final.

## 9. What this stage did NOT do

- Did not modify, move, rename, or overwrite any file under `assets/logos/` or
  `assets/icons/`.
- Did not change any production stylesheet, page, favicon, or manifest.
- Did not fix the recorded defect that Mythos OS currently ships Uthina Chess
  branding on its favicon, sidebar, manifest icons and printed devis. That is a
  real finding from the recovery stage, it is deliberately left alone here, and
  it becomes actionable only once these masters are validated.
- Did not apply the identity to any project, prototype, or site.
