# MYTHOS Design System — Consolidated Reference

**Stage:** MYTHOS-DESIGN-CONSOLIDATION, mandate item 6
**Date:** 2026-08-18 UTC
**Status:** **REFERENCE ONLY. Not implemented, not deployed.** This document
introduces nothing new — every value here is either **owner-approved** (A-\*)
or an **AUTO-\*** decision under the delegated mandate
(`MYTHOS_DESIGN_DECISIONS.md` §0.5). It exists because a reader implementing
against this system should not have to read nine documents in stage order to
find one number.

**How to use this document.** Each section states the canonical value compactly
and points to the source document for full derivation and rationale. **The
source documents remain authoritative for reasoning; this document is
authoritative for the value itself**, since it is the one place every value was
checked against every other for the purpose of this consolidation.

**Machine-readable form:** `assets/brand/tokens/tokens.css` — the same values,
as CSS custom properties, `--mythos-*` prefixed. New, standalone, unwired.

---

## 0. What is owner-approved vs. delegated

| Label | Meaning | Where |
|---|---|---|
| **A-001 – A-022** | Owner reviewed and approved directly | `MYTHOS_DESIGN_DECISIONS.md` §0 |
| **AUTO-1 – AUTO-3** | Decided under an explicit, dated delegation of authority the owner confirmed 2026-08-18. **Never an owner approval.** Fully reversible | `MYTHOS_DESIGN_DECISIONS.md` §0.5 |
| **D-\*** | Recovered evidence of a past decision — historical fact, not owner intent for the future | §1 |
| **O-\* / C-\* / U-\*** | Open, conflicting, or unrecoverable — listed in §9 below, not resolved by this document | §3, §4 |

**A reader who only needs "what do I build against" can stop at §1–§8 below.**
A reader who needs to know *why*, or whether something is still contested,
needs §9 and the source documents.

---

## 1. Identity

- **Master brand:** MYTHOS, not "MYTHOS PROD" (**A-001**).
- **Concept:** Constant + Movement — five upright letters, one slanted (the M,
  at **35°**, measured 34.9° and rationalised to exactly 35.0°). The slant does
  not mirror in RTL (**A-012**); neither does the matching motion vector
  (**MOTION-2**, AUTO-3).
- **The 35° gesture appears once per view**, shared as one budget across the
  static shape-cut and the motion-vector uses (**MOTION-3**, AUTO-3) —
  falsifiable: count the gestures on any screen.
- **Production master:** the vector reconstruction, **adopted AUTO-1** — not
  owner-approved. Historical raster (`assets/logos/logomythos.png`,
  `logo.png`) remains the frozen historical master under **A-007**, untouched.
  Three conditions bind the adoption: never modify the raster; always describe
  the reconstruction as a derivative; reconcile against any true original
  **LOGO-1** later finds.
- **Architecture:** three tiers — master brand → five endorsed units (descriptor
  slot, never an independent logo, **A-003**) → independent public projects
  (own identity, inherit the system not the skin, **A-004**/**A-006**).
  Mythos Command Center is a **product of Mythos OS**, not a sixth unit
  (**A-020**).

Full detail: `BRAND_ARCHITECTURE.md`, `MASTER_VISUAL_IDENTITY_1C_PROPOSAL.md`,
`LOGO_SYSTEM.md`, `PUBLIC_ECOSYSTEM_ARCHITECTURE.md`.

---

## 2. Colour

| Role | Dark | Light | Measured |
|---|---|---|---|
| Ground | `ink-850` `#0E0E0D` | `paper-100` `#F5F3EF` | — |
| Ground-deep | `ink-900` `#0B0B0A` | `paper-050` `#F7F6F3` (AUTO-3) | — |
| Surface | `ink-800` `#161614` | `paper-200` `#EFECE5` | — |
| Surface-card | `ink-750` `#1D1D1B` | `paper-250` `#E9E5DD` (AUTO-3) | — |
| Text primary | `ink-100` `#E8E4DC` | `paper-900` `#14130F` | 15.23 / 16.77 — AAA |
| Text secondary | `ink-300` `#A8A498` | `ink-500` `#55534B` | 7.75 (6.78 on card) / 6.95 |
| Accent (base) | `gold-500` `#D9A441` | `gold-800` `#805C19` | 8.59 / 5.47 |
| Accent hover | `gold-200` `#EBCE99` | `gold-900` `#5A4011` (AUTO-3, **darkens**) | — / 8.71 |
| Accent active | `gold-400` `#DDAE55` | `gold-850` `#6B4D15` (AUTO-3, **darkens**) | — / 7.02 |
| Border control | `ink-550` `#726F64` | `paper-500` `#7F7B6D` | 3.84 / 3.82 — both ≥3:1 |
| Border strong (decorative) | `ink-600` `#3A3934` | `paper-strong` `#CAC4B4` (AUTO-3) | — |
| Focus ring | `gold-500` | `gold-800` | 8.59 / 5.47 |
| Link | `text-primary` — **never gold** (LINK-1, AUTO-3) | | |

**Semantic:** success `#4ADE80`/`#136B34`, warning `#F0A342`/`#7A4F09`, danger
`#F1706A`/`#9E2419`, info `#7DC4EA`/`#19608F`, each with a 12%-alpha `-dim`
companion. Status is always **form plus colour** — never colour alone.

**Data visualisation:** 8-series categorical (gold leads), plus a 6-step
sequential and 7-step diverging scale, both new AUTO-3 (SEQ-1), every step
≥3:1 on ink.

**Scarcity rule:** one gold element per view. Never a ground. Never body text
on paper (use `gold-800`, not `gold-500`, there).

Full detail: `COLOR_SYSTEM.md`. Corrections this consolidation caught in the
source doc: none — values cross-checked clean against `tokens.css`.

---

## 3. Typography

- **Display:** Archivo Expanded 600 only (single weight, per approved scale).
- **Text/UI:** IBM Plex Sans 400/500/600 (500 is Label — corrected AUTO-4,
  AUTO-3's policy row had missed it).
- **Arabic:** IBM Plex Sans Arabic — **+6% size, +0.15 line-height, tracking
  forced to 0** on every style, including Label.
- **Data/code:** IBM Plex Mono 400.
- **Scale:** ratio 1.25, base 16px, 12 styles from Display XL (61/1.02) to
  Label (12/1.34). **Body never below 16px on any viewport.**
- **Fluid type:** `clamp()` floors at the next scale stop down; endpoints 320
  and 1240 (**TYPE-3**, AUTO-3). Body and below stay fixed.
- **Prose measure:** 65 characters is the design intent; 68ch an
  approximation. Real font metrics now measured (**GRID-2**, narrowed
  further by **AUTO-4** — neither number actually renders 65 real
  characters; still not closed, see the register).
- **Fonts:** self-hosted, real WOFF2 files, `assets/brand/fonts/` (**TYPE-2**,
  **AUTO-4** — closed). Latin ≈99.5KB, Arabic ≈133.8KB per script
  (revised budget ≤140KB/script — see `assets/brand/fonts/README.md`).

Full detail: `TYPOGRAPHY.md`.

---

## 4. Grid and spacing

- **Scale:** `2 · 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 · 96 · 128 · 160`.
  `space-1`/`space-2` are optical-correction only; `space-7`/`space-12` are
  legitimate scale members outside the two named bands (**GRID-3**, AUTO-3).
  Sections use `48–128`; components use `8–24`.
- **Grid:** 4 columns / 16px gutter / 20px margin below 600px; 8 columns /
  20px gutter / 48px margin 600–1239px; 12 columns / 24px gutter / 80px margin
  ≥1240px.
- **Containers:** content 1280px; wide 1440px is the **1280 frame at its own
  margins**, not a second width (**GRID-1**, AUTO-3). `2xl` (≥1920) has no
  behaviour of its own — the grid already stops growing at 1440.
- **Radius:** `0` (none) · `2px` (control, the workhorse) · `6px` (card) ·
  `12px` (overlay) · `999px` (pill — **avatars and status dots only**;
  **SHAPE-1** confirms even a switch does not get a pill).
- **Elevation:** by surface step, not shadow, for static content. Shadow
  tokens now defined for what genuinely floats (**SURF-1**, AUTO-3):
  `shadow-floating` and `shadow-overlay`, dark and light variants both
  specified.
- **Breakpoints** are behavioural, not device-named: `sm <600`, `md 600–903`,
  `lg 904–1239`, `xl 1240–1919`, `2xl ≥1920`.

Full detail: `GRID_AND_SPACING.md`, `DESIGN_TOKENS.md`.

---

## 5. Components

**Universal rules:** six states (default/hover/active/focus-visible/
disabled/loading) or a component is unfinished; focus never removed; status is
form plus colour; **hit area ≥44×44 at every breakpoint even when the visual
box stays 40px comfortable / 36px compact** (**A-022** — the visual box and the
hit box are two different specifications; expansion is a transparent hit
region, never added margin).

| Component | Key spec |
|---|---|
| Button | 40/36 height, `radius-control`, primary = accent ground + `text-on-accent` |
| Input | 40 height, `border-control`, label always visible, never a placeholder-only label |
| Select | Native at `sm`; chevron takes `text-secondary`, never gold (**GOLD-3**, AUTO-3) |
| Switch | Rectangular, `radius-control` — not a pill (**SHAPE-1**, AUTO-3) |
| Card | `radius-card`, one surface step up, no shadow |
| Modal/overlay | `radius-overlay`, focus trapped and returned, full-screen at `sm` |
| Toast | Enters along the 35° vector — consumes the view's one gesture budget |
| Loading | **Static skeleton, determinate progress only — no spinner** (**MOTION-1**, AUTO-3); resolves the "nothing loops" vs "loading state required" conflict |
| Link | Underline in `text-primary`, thickens on hover — never gold (**LINK-1**, AUTO-3) |
| Disabled | `disabled`/`aria-disabled` attribute is the non-colour channel, plus `cursor: not-allowed` (**A11Y-2**, AUTO-3) |
| Forced-colors | Primary/secondary distinguished by `border-style` (solid/dashed), since colour is overridden and border-style is not (**A11Y-1**, AUTO-3 — flagged as judgement, not derivation) |

Full detail: `COMPONENT_SYSTEM.md`.

---

## 6. Responsive, accessibility, motion

- **WCAG 2.2 AA floor, AAA body text** (achieved: 15.23 on ink, 16.77 on paper).
- **A-022 exceeds the AA target-size requirement (24×24) by 3.36× in area** —
  the system is AAA on touch target size.
- **Zoom is not a special mode.** 200% lands in the tablet band, 400% in
  mobile — the tablet layout is the desktop-at-200%-zoom layout and must be
  complete, not degraded.
- **No baseline grid is possible or attempted** — 12 of 12 type styles are
  off the 4px grid; Arabic's own line-height diverges further. Rhythm is
  block-gap based.
- **Reduced motion:** transforms collapse to opacity, durations resolve to
  `motion-micro` (120ms) — **not zero**. The interface stays complete and
  legible with animation off entirely.
- **RTL:** logical properties throughout; numbers, media controls, the M's
  slant and the 35° motion vector all keep the same absolute direction in
  both reading directions.

Full detail: `RESPONSIVE_ACCESSIBILITY_MOTION.md`.

---

## 7. Ecosystem

- **DNS stays flat** — Command Center (`ordre.mythosprod.xyz`) and Mythos OS
  (`os.mythosprod.xyz`) remain sibling subdomains; brand hierarchy is
  expressed in navigation UI only, never the URL (**ECO-1**, AUTO-3).
- **`panel.`/`tv.` are internal infrastructure** — no Mythos branding of any
  kind (**ECO-2**, AUTO-3).
- **The twelve projects outside the owner's list of eight are internal
  tooling/archive** — none has a public serving surface, so none appears in a
  future hub (**ECO-3**, AUTO-3).
- **A-021, the colour-usage boundary, verbatim:** a project's own brand stays
  primary; its logo stays independent; Mythos colours never replace the
  primary; gold appears only in ecosystem contexts (footer, legal, hub,
  cross-product nav); any use inside the project's own UI needs a documented
  functional reason and stays secondary; nothing is automatic; any exception
  to primary identity needs explicit owner approval.

Full detail: `PUBLIC_ECOSYSTEM_ARCHITECTURE.md`.

---

## 8. Token artifact and naming

- **Namespace:** `--mythos-*` (**TOKEN-2**, AUTO-3 — matches the real
  precedent the implemented Mythos OS system already set).
- **Artifact:** `assets/brand/tokens/tokens.css` (**TOKEN-1**, AUTO-3) — new,
  standalone, three-tier (global → semantic → component-consumed), dark
  default with a `[data-theme="light"]` remap and a `prefers-color-scheme`
  fallback.
- **This is a specification, not an implementation.** Wiring it into any
  application is a separate, future authorisation.

---

## 9. What is still genuinely open

**Blocked on evidence this repository does not have:**

| Ref | Blocked on |
|---|---|
| **LOGO-1** | Two of three off-host repositories still unreachable (`mythos-app` denied at `add_repo`; `mythos-os` denied at clone); VPS filesystem absent. One of three fully searched — genuine negative |
| **GRID-2** | Real font-metrics now measured (**AUTO-4**); what remains is an owner call between the literal 65-character target (≈48ch) and the existing owner-approved grid measure — not evidence this repository lacks |
| **O-003/004/006/007** | Whether a vhost exists or was ever intended — facts, not designs |

**Blocked on real-world adjudication, not derivable from the system:**

| Ref | Why |
|---|---|
| **C-001 / O-002** | Dar Hijama's live site uses none of its own six charter colours — a specific project's brand conflict, not a system rule |
| **C-004** | Four historically unarbitrated project palettes — whether the divergence was chosen or accidental is unrecoverable, not undecidable |

**Blocked on implementation capability this session verified it does not
have:**

| Ref | Why |
|---|---|
| **C-006 / MIG-1 / MIG-3** | Canonical system named (**AUTO-2**), but reconciling the implemented `--mythos-*` values against it requires full-application visual regression against `css/main.css`, the real Mythos OS stylesheet — this session has tooling scoped only to the isolated console shell |
| **MIG-2 / MIG-4** | Playfair replacement and the Command Center palette — same category, not yet attempted |

**Nothing above was resolved by this consolidation.** Consolidating did not
change a single value — it is a reading aid, not a decision.
