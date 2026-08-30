# Mythos ERP — design system (Stage 2)

**Location:** `sites/erp.mythosprod.xyz/app/` (staging branch `feat/erp-redesign`)
**Scope:** client tier only. No PHP, no data, no endpoints, no nginx change, no production touch.
**Date:** 2026-08-22.

---

## 1. Analysis of the current UI

### 1.1 Styling debt, measured

| Metric | Legacy | New |
|---|---|---|
| Stylesheets | 8 files, **3,244 lines**, 144 KB | 1 file, 320 lines |
| Distinct hex colours | **63** | **0** |
| `rgba()` calls | **399** | **0** |
| CSS custom properties defined | 25 | reads 173 shared tokens |
| `!important` | **188** | **0** |
| Media queries | 19 (ad hoc) | 5 (one system) |

Four of the eight legacy stylesheets — `calendrier.css`, `facture.css`,
`forms.css`, `print.css` — are ~100-byte stubs whose own comments say the real
rules live in `main.css`. The system was intended and never built.

### 1.2 Three findings from reading the shell

**Stale branding.** `index.html`'s `<head>` is Uthina Chess PWA metadata —
title, description, favicon, `apple-mobile-web-app-title`. The application
underneath is Mythos Prod: 47 "Mythos Prod" hits across `js/`, against 7 for
Uthina, with 320 client, 68 facture and 35 spectacle references. The metadata
is leftover, not a different product.

**External font origin.** The shell still requests
`fonts.googleapis.com` / `fonts.gstatic.com` for Inter, immediately above a
comment stating that MIG-2 self-hosted the approved Mythos faces. There are
**0 `@font-face` rules** anywhere in `css/` — the self-hosted faces were never
wired in. Both a policy violation and a third-party dependency on every load.

**Inline event handlers.** Navigation is `onclick="showView(…)"`. The platform
CSP is `script-src 'self'`, which forbids inline handlers — the legacy shell
would not run under it unchanged.

### 1.3 Encoding

`index.html` uses CRLF terminators and is 143 KB on one nesting level; `grep`
treats it as binary without `-a`. Worth normalising during migration.

---

## 2. The design system

### 2.1 Tokens — shared, not copied-in-spirit

`assets/tokens.css` is a **byte-identical copy of the Hub's token file**
(173 tokens), and `assets/fonts.css` plus the 8 `.woff2` faces come from the
same place. This is the mechanism that prevents drift: the ERP and the Hub
cannot diverge visually while they read the same values. **A missing token is
added to the shared file, never invented locally.**

Both surfaces are dark-by-default with a `prefers-color-scheme: light`
override and explicit `[data-theme]` opt-outs — so they follow the viewer's
setting identically.

### 2.2 Rules the component layer keeps

- **No literal colour values.** Verified: 0 hex, 0 `rgba()` in `erp.css`.
- **No `!important`.** Verified: 0 declarations.
- **No inline styles carrying colour**, and no inline event handlers at all.
  Verified: 0 `on*=` attributes, 0 `<style>` blocks. The only inline styles are
  10 layout margins.
- **One 35° gesture per view** (A-012): the topbar rule. Nowhere else.
- **42 distinct tokens consumed, 0 unresolved.**

### 2.3 Typography, spacing, colour

Display face Archivo Expanded (`--mythos-font-display`) for headings and
numeric heroes; IBM Plex Sans for text; IBM Plex Mono for figures, references
and timestamps. All self-hosted, no external origin.

Spacing uses the `--mythos-space-*` scale exclusively. Radii use
`--mythos-radius-{control,card,pill}`. Semantic colour is
`success / warning / danger / info` with their `-dim` backgrounds, never a raw
value.

---

## 3. Component inventory

19 components, all token-driven.

| # | Component | Class | Variants / states |
|---|---|---|---|
| 1 | App shell | `.app` | 3 responsive layouts |
| 2 | Top bar | `.topbar` | carries the single 35° gesture |
| 3 | Module rail | `.rail` | full · icon-only · bottom bar |
| 4 | Rail item | `.rail a` | default · hover · `aria-current="page"` |
| 5 | View | `.view` | `data-active` toggled by the router |
| 6 | View header | `.view-head` | kicker · title · description |
| 7 | Grid | `.grid.cols-{2,3,4}` | auto-fit, min-width driven |
| 8 | Card | `.card` | with `.card-head` |
| 9 | Stat tile | `.card.stat` | label · value · sub |
| 10 | Badge | `.badge` | `ok · warn · danger · info · mock` |
| 11 | Button | `.btn` | `primary · secondary · ghost · danger`, `.btn-sm`, disabled |
| 12 | Field | `.field` | label · hint · error |
| 13 | Text input | `.input` | focus · disabled · `aria-invalid` |
| 14 | Select | `.select` | focus · disabled |
| 15 | Textarea | `.textarea` | resizable vertically |
| 16 | Field row | `.field-row` | responsive auto-fit |
| 17 | Data table | `.table-wrap` + `table.data` | sticky header, `.num` right-aligned mono, horizontal scroll |
| 18 | Empty state | `.empty` | says there is no data instead of faking it |
| 19 | Notice | `.notice` | inline explanation banner |

Accessibility built in: skip link, `.sr-only`, visible `:focus-visible` ring,
44px minimum touch targets, `aria-current` on the active module, an
`aria-live` region announcing route changes, `prefers-reduced-motion`
honoured, and a print stylesheet.

---

## 4. Frontend structure

```
sites/erp.mythosprod.xyz/app/
├── index.html              shell + 10 module views (generated, not hand-edited)
└── assets/
    ├── tokens.css          173 tokens — byte-identical to the Hub
    ├── fonts.css           self-hosted faces
    ├── fonts/*.woff2       8 faces
    ├── erp.css             320-line component layer
    ├── erp.js              hash router, no inline handlers, no data access
    └── mythos-favicon.svg
```

**14 files, 324 KB**, of which 300 KB is fonts.

`index.html` is produced by a generator so the ten module views stay
structurally identical and cannot drift through hand-editing.

### 4.1 Module structure

All ten modules exist as views with a consistent skeleton — view header,
filter card with search and status, and a data table whose body is an honest
empty state:

Dashboard · Clients · Projects · Planning · Production · Finance · Documents ·
Reports · Settings · Inventory

**Nothing is connected.** Every control that would perform a real operation
carries `data-stage3`; `erp.js` disables them and sets a title explaining they
arrive with Stage 3 (data) and Stage 4 (auth). The dashboard's four stat tiles
render `—`, not invented numbers — the same rule the Hub follows: never
display a value the system has not measured.

### 4.2 Router

Hash-based, 10 registered modules, unknown routes fall back to the dashboard.
Verified 6/6 including case-insensitivity and a traversal-shaped hash
(`#/../etc` → `dashboard`).

---

## 5. Mockups

Rendered headlessly at `/home/deploy/erp-mockups/` (not committed):

| File | View |
|---|---|
| `erp-dashboard.png` | dashboard, 1440×1000, light |
| `erp-dashboard-dark.png` | dashboard, dark — matches Hub identity |
| `erp-finance.png` | finance module |
| `erp-clients.png` | clients module |
| `erp-mobile.png` | dashboard at 430px |

---

## 6. Migration plan

Legacy and new coexist: the new app is a **separate directory**, so nothing in
the legacy tree is modified or removed at any point.

| Step | Action | Risk |
|---|---|---|
| M1 | Normalise `index.html` to LF; correct the Uthina Chess metadata to Mythos ERP | none — metadata only |
| M2 | Remove the Google Fonts links; rely on the self-hosted faces already present | none — removes a dependency |
| M3 | Replace `onclick="showView(…)"` with delegated listeners so the shell is CSP-compatible | low |
| M4 | Port one module end-to-end (**Clients**, the smallest consolidation: 3 → 1) as the pattern | low |
| M5 | Port the remaining modules in dependency order, ending with **Finance** (10 → 1, ~⅓ of the surface) | medium |
| M6 | Delete the 4 stub stylesheets; fold `dashboard.css`, `layout.css`, `main.css`, `professional.css` into the token layer as each module lands | low, incremental |
| M7 | Retire the legacy shell only when every module is ported and reviewed | — |

**Sequencing constraint:** M4 onward should not begin before Stage 3 (storage)
and Stage 4 (auth), because a ported module with no authenticated API to call
would either sit inert or tempt someone to wire it to the current unauthenticated
endpoints. The design system delivered here is what M1–M3 need, and those three
are safe to do now.

---

## 7. Stage 2 conclusion

Delivered: token-driven design system sharing the Hub's exact identity, 19
components, a responsive shell with three layouts, a CSP-compatible router, and
ten module views as honest structure.

Not delivered, deliberately: any data access, any endpoint, any auth, any
change to the legacy ERP, and any production change. PHP remains disabled, the
ERP route remains loopback-only, nginx is untouched.

Stage 3 (storage) still needs the Stage 0 decision — PostgreSQL on the existing
`idauto-postgres` remains the recommendation, because it removes the traversal
class found in Stage 1 outright and brings the ERP into the verified R2 backup.
