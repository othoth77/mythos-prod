# MYTHOS Logo System

**Stage:** MYTHOS-DESIGN-LOGO-2 — final logo system
**Date:** 2026-08-18 UTC
**Status:** **ADOPTED UNDER DELEGATED AUTONOMOUS MANDATE (AUTO-1) — NOT
OWNER-APPROVED.** The reconstruction is now the **production master**, per
`docs/MYTHOS_DESIGN_DECISIONS.md` **§0.5, AUTO-1**. This is **not** an owner
decision and must never be represented as one. **The historical logo was not
redrawn, recoloured or recreated** — only the reconstruction, already known and
already committed, changes status.

**History, preserved in full.** **Owner review, 2026-08-18** — the owner
reviewed this document, confirmed the two-master model, the descriptor system
and the three layout forms as understood, and **explicitly withheld approval**,
stating the gate: *"the reconstruction is not to become an **owner-approved**
production master while LOGO-1 remains open."* That instruction was followed in
full at the time, and nothing in it was violated by what came next: this
reconstruction has still never been approved by the owner. **Later the same
day**, the owner issued a separate, explicit instruction naming LOGO-2 for
autonomous resolution under a delegated mandate (`MYTHOS_DESIGN_DECISIONS.md`
§0.5). Under that later, more specific authority, **AUTO-1** adopts the
reconstruction as production master — not as owner-approved, and with LOGO-1
kept open and the reconciliation condition kept binding: any true original found
later is diffed against this reconstruction and reconciled, without exception.

**Supersedes:** the Stage 1B version of this document, which proposed the vector
reconstruction. That reconstruction is unchanged; what is new is the system
built around it and the recommendation on **LOGO-2**.

---

## 0. How to read this document

| Label | Meaning |
|---|---|
| **HISTORICAL / RECOVERED** | The artefact that actually exists, or a fact measured from it |
| **PROPOSED** | My recommendation, offered for decision. Not in force |
| **NOT APPROVED** | Explicitly awaiting an owner decision |

**Approved context this builds on:** MYTHOS is the master brand (**A-001**); the
five units use MYTHOS + descriptor and **never receive independent logos**
(**A-003**, **A-019**); public projects stay independently branded (**A-004**,
**A-006**, **A-021**); Mythos Command Center is a product of Mythos OS and is
**not** a sixth unit (**A-020**); **Mythos Gold is `#D9A441`** (**A-013**); the
historical logo remains unchanged and authoritative (**A-007**).

---

## 1. The central finding — stated plainly, because you asked

> **The recovered raster is not sufficient to serve as a production master.**

This is not a stylistic opinion. It is a measurement, and it is the single fact
that shapes every recommendation below.

**HISTORICAL / RECOVERED — measured this stage:**

| Property | `logomythos.png` | `logo.png` | Consequence |
|---|---|---|---|
| Dimensions | 1672 × 941 px | 1111 × 328 px | Fixed resolution; cannot scale up |
| Transparency | **0 non-opaque pixels** | **0 non-opaque pixels** | The ground is **baked in**. The mark cannot be placed on any surface other than the one already inside the file |
| Distinct colours | **15,393** | **10,549** | Continuous-tone metallic gradient. **Cannot be reduced to one colour** without redrawing |
| Max width at 300 dpi | **142 mm** | **94 mm** | Barely a business card. An A4 header fits; a roll-up banner, an exhibition stand, vehicle livery or signage does **not** |
| Max width at 150 dpi | 283 mm | 188 mm | Large-format reproduction is impossible |

**What this makes impossible with the raster alone:** monochrome reproduction,
one-colour print, embroidery, engraving, etching, stamping, fax and photocopy
legibility, a transparent favicon or app icon, a social avatar cut to a circle,
placement on any coloured or photographic ground, reversal, and any print or
signage wider than about 14 cm.

**What the raster remains excellent at, and must keep doing:** being the
**authoritative record of what the identity is**. Its proportions, its slanted M,
its letterform relationships and its gold are the reference every derivative is
measured against. **A-007** is correct and this proposal does not weaken it.

**The conclusion is therefore not "replace the historical logo".** It is that a
brand needs two different things from a logo, and one file cannot be both.

## 2. What LOGO-1 established

**HISTORICAL / RECOVERED.** The vector-source investigation (result **C**,
`docs/design-recovery/PENDING_VECTOR_SOURCE_TASK.md`) searched Git exhaustively —
438 commits, 36 branches — and this container's entire filesystem. **Exactly 14
vector blobs have ever existed in this repository, and all 14 are the Stage 1B
reconstruction.** No original vector master was found.

**But no true negative was established either:** three of four priority
locations were unreachable and the fourth was blocked by session policy. So
**LOGO-1 remains OPEN**, and §10 says what happens if an original later surfaces.

## 3. PROPOSED — the two-master model

The proposal that follows from §1 and §2:

```
HISTORICAL MASTER            assets/logos/logomythos.png · logo.png
  authoritative record   ·   never modified, never replaced, never recoloured
  the reference          ·   frozen, archival, cited by every derivative
        │
        │  measured from, never overwritten
        ▼
PRODUCTION MASTER            the vector reconstruction
  the working artwork    ·   what actually gets placed on screens and paper
  reproducible           ·   one colour, any size, any ground, any medium
```

**This is the answer to LOGO-2.** The historical raster is not demoted and not
replaced — it is promoted to what it is genuinely good at, the record. A second,
explicitly derivative artefact does the reproduction work the raster cannot do.

**Why this is honest rather than convenient:** the production master is
**openly a derivative**. It is measured from the raster, its provenance is
documented, it is regenerated from code rather than hand-kept, and if a true
original ever surfaces it is diffed against it (§10). At no point is a
reconstruction presented as the original.

## 4. The MYTHOS master logo

**HISTORICAL / RECOVERED — the identity, unchanged:** the wordmark **MYTHOS**,
one word, with the **M slanted** against five upright letters, extended
geometric proportions, flat terminals, a circular O, and a gold descriptor line
beneath.

**PROPOSED — the production geometry**, measured from the raster at cap height
166 px and rebuilt on a 1000-unit cap grid:

| Constant | Value | Origin |
|---|---|---|
| Cap height | 1000 | the unit of the system |
| M slant | 0.70 dx/dy = **35.0°** | measured 34.9°, rationalised |
| Vertical stem | 260 | measured 43 px at cap 166 |
| Horizontal bar | 210 | measured; optically lighter than the stem |
| Wordmark width | 6074 | **aspect ratio 6.074 : 1** |
| Letter gaps M·Y · Y·T · T·H · H·O · O·S | 60 · 48 · 72 · 66 · 54 | measured ink gaps, **deliberately unequal** |

The gaps stay uneven on purpose: the wider T·H and H·O gaps compensate for the
open counters of T and O. That optical correction is present in the original and
equalising it would be a regression dressed as tidiness.

**The M is protected geometry.** Its three diagonals share one slope; its right
stem is exactly vertical; its centre wedge descends to a point on the baseline
while the outer legs terminate flat.

1. The slope **0.70 is fixed**. Never re-slant, italicise or "correct" it.
2. The M is **never separated** from YTHOS in the primary logo.
3. The M may be used **alone as a symbol** — an extension of the identity, never
   a replacement for the wordmark.
4. Never mirror, rotate, outline or add effects to the M.
5. **The slant does not mirror in RTL.** It is fixed in both reading directions.

## 5. PROPOSED — how five descriptors attach without five identities

This is the question the architecture lives or dies on, and the answer is
structural rather than stylistic:

> **The descriptor is a slot, not a design.**

Everything about the descriptor is fixed by the system. **The only thing that
varies between units is the word itself.**

| Property | Fixed value | Why it is fixed |
|---|---|---|
| Word | **One word, always** | `OS` · `PROD` · `SERVICES` · `DIGITAL` · `LOGISTIQUE`. Never "MYTHOS OS" as a descriptor — that repeats the dominant element |
| Case | Uppercase | Matches the wordmark |
| Size | **15 % of MYTHOS cap height** | A unit can never make its descriptor louder |
| Tracking | **0.42 em** | Wide enough to read as a label, not a second wordmark |
| Colour | **Mythos Gold `#D9A441`** for the rules; descriptor takes the wordmark's own colour | One gold across all five (**A-013**) |
| Position | Centred, **21 % of cap height below the baseline** | Identical for every unit |
| Flanking rules | Two tapered gold rules, thickness 0.085 em, starting clear of the text and running to the wordmark's optical edge | The evolved form of the original's spear flourishes |

**Because every one of those is fixed, swapping the word changes nothing else.**
Five units produce five lockups that are visibly the same object with a
different label — which is precisely the opposite of five identities.

**What a unit may never have:** its own mark, its own wordmark, its own
typeface, its own colour, its own descriptor styling, or a descriptor of more
than one word. Confirmed by **A-003** and **A-019**; **A-020** additionally
places Command Center *below* Mythos OS, so it takes **no lockup of its own**.

## 6. PROPOSED — the six lockups

| # | Entity | Descriptor | Lockup |
|---|---|---|---|
| 1 | **MYTHOS** | *(none)* | The bare wordmark. The master brand |
| 2 | **Mythos OS** | `OS` | MYTHOS over OS |
| 3 | **Mythos Prod** | `PROD` | MYTHOS over PROD |
| 4 | **Mythos Services** | `SERVICES` | MYTHOS over SERVICES |
| 5 | **Mythos Digital** | `DIGITAL` | MYTHOS over DIGITAL |
| 6 | **Mythos Logistique** | `LOGISTIQUE` | MYTHOS over LOGISTIQUE |

**Three layout forms** — the same lockup, arranged for the space available:

| Form | Construction | Use |
|---|---|---|
| **Stacked** (primary) | Descriptor centred beneath the wordmark, flanking rules | Default. Hero, print, formal documents, signage |
| **Horizontal** | Wordmark, a **1 px gold hairline divider at 60 % cap height**, then the descriptor set at the same 15 % size and 0.42 em tracking, optically centred on the wordmark's cap band | Headers, narrow bands, email signatures, letterhead rules — anywhere vertical space is scarce |
| **Compact** | The **M symbol** plus the descriptor, no wordmark | Tight UI, app bars, favicons with a unit context, dense navigation |

The horizontal and compact forms are **specifications, not files** — no asset
was generated for them, in keeping with the instruction not to add production
assets.

## 7. PROPOSED — the asset set

Existing reconstruction files, unchanged and still **NOT APPROVED**:

| Master | File |
|---|---|
| Primary wordmark | `mythos-wordmark.svg` — uses `currentColor`, so one file serves both grounds |
| Fixed-colour variants | `mythos-wordmark-ink.svg` · `-reversed.svg` |
| Symbol | `mythos-symbol-m.svg` · `-ink` · `-reversed` |
| Unit lockups | `mythos-lockup-{os,prod,digital,services,logistique}.svg` |
| App icon | `mythos-appicon-{dark,light}.svg` |
| Favicon | `mythos-favicon.svg` |

**Still to be produced if LOGO-2 is approved** — named so the gap is visible:
horizontal lockups (×6), compact lockups (×6), a monochrome one-colour master,
a print-ready master with outlined descriptor type, and social avatar crops.
**None exists today.**

## 8. PROPOSED — usage rules

### 8.1 Dark background
The default, and where the identity is native. Wordmark in `ink-100 #E8E4DC`
or the reconstruction's `currentColor`. Mythos Gold `#D9A441` for the descriptor
rules — measured **8.59 : 1** on the Mythos ground. Never place the mark on a
dark photograph without a scrim reaching at least 4.5 : 1.

### 8.2 Light background
Fully supported, not an afterthought. Wordmark in `paper-900 #14130F`. **The
gold changes value**: descriptor rules use `gold-800 #805C19` (5.47 : 1 on
paper), because `#D9A441` measures only **2.05 : 1** there. This is a
measurement, not a preference — one gold cannot serve both grounds.

### 8.3 Monochrome
**Required for print, signage, embroidery, engraving and stamping — and
impossible from the historical raster** (§1). One-colour reproduction uses a
single flat ink for the entire lockup, rules included; the gold becomes the same
ink. **This artwork does not exist yet** and is the clearest single argument for
resolving LOGO-2.

### 8.4 Small sizes
**Verified by rendering at real pixel sizes:** the wordmark holds to **90 px
wide**; the symbol holds to **32 px**. Below 90 px the wordmark is **replaced by
the symbol**, never scaled further. Below 32 px no Mythos mark is used at all.

### 8.5 Favicon and app icon
Symbol only — the wordmark is illegible at these sizes. Favicon: square tile,
mark at **58 %** of tile height, because browser chrome renders it tiny. App
icon: rounded tile, mark at **46 %**. Both need transparency or a deliberate
tile colour, which the raster cannot provide.

### 8.6 Social media
Avatar: the **symbol** on a solid Mythos ground, safe inside a circular crop —
never the wordmark, which platforms will clip. Cover and banner: the stacked or
horizontal lockup with full clear space. Never the raster with its baked ground
composited onto a platform's own background.

### 8.7 Documents
Letterhead and reports: horizontal lockup, top-left, at a size giving the
wordmark at least 35 mm. Invoices and quotations: horizontal lockup with the
issuing unit's descriptor. **The descriptor identifies the issuing entity** —
this is where the lockup system earns its keep commercially.

### 8.8 Print
Vector only. Minimum reproduction width **25 mm** for the wordmark, **8 mm** for
the symbol. One-colour jobs use §8.3. **The historical raster must never be sent
to print above 142 mm at 300 dpi**, which in practice means it should not be
sent to print at all.

### 8.9 Digital interfaces
`currentColor` wherever the host controls colour, so the mark inherits the
theme rather than fighting it. In a Mythos OS interface the mark sits in the
sidebar or header at a fixed optical size and does not scale with content.

### 8.10 Horizontal and compact layouts
Per §6. Horizontal for headers and bands; compact for dense UI. **Never squash
the stacked lockup to fit a horizontal space** — that is what the horizontal
form exists to prevent.

### 8.11 Clear space and prohibitions

**Clear space:** not less than **half the cap height** on all four sides.
Nothing enters it — type, rule, image edge or partner logo.

**Never:** re-slant, mirror, rotate or outline the M · detach the M from YTHOS ·
split "OS" from the wordmark · recolour the wordmark outside the approved
values · use a descriptor of more than one word · give a unit its own mark or
colour · place the mark on an unscrimmed photograph · stretch, condense or skew
the lockup · add shadows, bevels, glows or gradients to the flat master ·
reproduce the historical raster above its measured limits.

## 9. Two things this proposal deliberately does not do

1. **It does not replace the historical logo.** `logomythos.png` and `logo.png`
   are untouched, byte-identical, and remain the authoritative record under
   **A-007**. The production master is a documented derivative that cites them.
2. **It does not add production assets.** No file was created, and the
   horizontal, compact and monochrome forms are specified in §6 and §8.3 rather
   than generated.

## 10. LOGO-2 — the recommendation, and what happened to it

**RESOLVED — AUTO-1, 2026-08-18. Not owner-approved.** This section originally
read "PROPOSED, NOT APPROVED" and made the recommendation below. The owner
reviewed it the same day and placed it on hold pending LOGO-1. Later the same
day, under a separate, explicit delegated-mandate instruction, this session
adopted the recommendation exactly as written below — same three conditions,
same reasoning, unchanged. See `MYTHOS_DESIGN_DECISIONS.md` §0.5, **AUTO-1**,
for the full authority chain. The recommendation text is left as originally
written, since it is what was adopted:

**Adopt the vector reconstruction as the PRODUCTION master, with the historical
raster retained permanently as the HISTORICAL master.**

**Why now rather than waiting:**

- **The cost of waiting is concrete and recurring.** With no production master
  there is no monochrome artwork, no favicon, no app icon, no social avatar, no
  print above 14 cm and no signage. Every one of those is blocked today.
- **LOGO-1's remaining scope is unlikely to change the answer.** The searchable
  scope was exhausted; what remains unsearched is a 127-file and an 8-file
  snapshot plus a stale working copy. If a layered original were routine to
  find, it would have been in Git.
- **The decision is cheap to reverse.** The geometry lives in code and is
  regenerated, not hand-kept. If an original surfaces, the diff is mechanical.

**Three conditions attach to the recommendation:**

1. **The historical raster is never modified, replaced or recoloured** — the
   production master cites it, and the recovery record stays canonical.
2. **The reconstruction is always described as a derivative**, never as the
   original, in every document and asset register.
3. **If LOGO-1 later finds a true original, the reconstruction is diffed against
   it and reconciled** before any further work builds on it. Adopting a
   production master now does not close LOGO-1.

**If you prefer not to adopt it**, the honest alternative is to commission a
vector master drawn afresh by a designer working from the raster — which
produces the same class of artefact, a derivative, at greater cost and with less
traceability than geometry kept in code.

**What this resolution authorises:** producing the missing artwork named in §7
as the production specification. It does **not** authorise applying the mark
anywhere — that remains a separate implementation decision, and MIG-1 to MIG-4
stay unactioned.

## 11. Status summary

| Item | Status |
|---|---|
| Historical raster as the authoritative record | **HISTORICAL / RECOVERED**, protected by **A-007** — unchanged by AUTO-1 |
| Raster as a production master | **Insufficient** — measured, §1 |
| Two-master model | **ADOPTED — AUTO-1** (delegated mandate, not owner-approved) |
| Geometry, descriptor system, six lockups | **ADOPTED — AUTO-1** as the production specification. Not yet applied anywhere — that is separate implementation work |
| Usage rules §8 | **ADOPTED — AUTO-1** |
| Adoption of the reconstruction as production master (**LOGO-2**) | **RESOLVED — AUTO-1, 2026-08-18.** Owner reviewed and held on 2026-08-18; resolved under a later, separate delegated-mandate instruction the same day. **Not owner-approved.** See `MYTHOS_DESIGN_DECISIONS.md` §0.5 |
| **LOGO-1** | **Still OPEN, narrowed** — one of three off-host repositories searched (negative), two remain blocked. **AUTO-1's reconciliation condition stays binding**: a true original found later is diffed against the reconstruction and reconciled |
