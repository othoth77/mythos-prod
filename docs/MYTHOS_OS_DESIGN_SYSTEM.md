# MYTHOS OS Design System — audit and specification

**Stage:** MOS-1 — MYTHOS OS Command Center
**Date:** 2026-08-18 UTC
**Implements:** `projects/mythos-os-console/reference/web/mythos.css`
**Companions:** `docs/MYTHOS_DESIGN_DECISIONS.md` (register) · `docs/MYTHOS_DESIGN_RECOVERY.md` (evidence) · `docs/MYTHOS_DESIGN_STRATEGY.md` (baseline)

This document is the audit the Command Center was built from, and the
specification the shell now implements. It creates no new visual identity.

Every value is tagged:

| Tag | Meaning |
|---|---|
| **RECOVERED** | Present in the existing Mythos OS implementation. Copied, not chosen. |
| **DERIVED** | A scale fitted to values the implementation already uses. |
| **EXTENDED** | New, filling a gap the recovery audit names as absent. Marked so it is never mistaken for prior work. |

---

## 1. Audit — what already existed

Read before implementing: `AGENTS.md`, `docs/AI_HANDOVER.md`,
`docs/MYTHOS_DESIGN_DECISIONS.md`, `docs/MYTHOS_DESIGN_STRATEGY.md`,
`docs/MYTHOS_DESIGN_ROADMAP.md`, `docs/MYTHOS_DESIGN_RECOVERY.md`,
`docs/MYTHOS_COMMAND_CENTER_ARCHITECTURE.md`,
`docs/MYTHOS_CONTROL_CENTER_PRODUCT_SPEC.md`, `css/main.css`, `css/layout.css`,
`css/dashboard.css`, `css/professional.css`, `index.html`,
`projects/command-center/reference/web/`, `assets/logos/`.

`docs/design/` does not exist. The design documentation is the four
top-level `MYTHOS_DESIGN_*.md` files; that is what "read docs/design/"
resolves to in this repository, and it is recorded here so the next reader
does not go looking for a directory.

### 1.1 Existing design system

**One exists, and it is Mythos OS's own.** `css/main.css` declares a
20-token `:root` block — near-black stepped grounds, one gold accent, warm
off-white text, six semantic colours — used across 8 stylesheets and 72 JS
modules. It is decision **D-001**, status CONFIRMED, unchanged since the
initial import `d1a9d19` (2026-07-29). Only two commits in the entire
repository history have ever touched `css/` or `assets/`.

There is **no shared cross-project design system**. Four implemented
stylesheets use four unrelated palettes (C-004). None imports another.

### 1.2 Existing visual decisions

| Decision | Status |
|---|---|
| **D-001** Mythos OS dark-and-gold token system | CONFIRMED, implemented, unrevised |
| **D-011** `assets/logos/` is the canonical logo location | CONFIRMED |
| **D-010** Design QA by headless-browser verification | CONFIRMED as practice, applied once, never generalised (O-009) |
| **C-004** Four unarbitrated palettes across the portfolio | CONFLICTING, unresolved |
| **O-001** Brand independence vs Mythos consistency | OPEN, owner-only, blocks design-roadmap Stage 1 |
| **U-001** Why gold | UNKNOWN, unrecoverable |
| **U-003** Mythos master typography | UNKNOWN as a *written* decision |
| **U-004** Mythos spacing and grid | Absent everywhere |

### 1.3 Reusable components

`css/main.css` already contains a component vocabulary, undocumented but
consistent: `.nav-btn` with its inset gold rail, `.btn` / `.btn-gold` /
`.btn-outline` / `.btn-danger` / `.btn-sm`, `.entity-card` and
`.invoice-card` (one surface treatment under two names), `.entity-badge`
pills, `.detail-row` grids, `.page-header` / `.page-title`,
`.invoices-section-title` with its 3px gold rule, `label`, and
`css/dashboard.css`'s `.db-kpi-card`. All were carried into the shell.

### 1.4 Typography

**RECOVERED, closing U-003 for Mythos OS specifically.** `index.html:19`
loads Playfair Display (400/700/800) and Inter (300–700) from Google Fonts.
`main.css` applies Playfair to `.logo h1`, `.page-title`, `.inv-num`,
`.inv-ttc`, `.entity-title` and `.client-stat-value`; Inter is the body
face at 14px.

U-003 records that no typography decision is *written down*. That remains
true. What this audit adds is that the implementation has been unambiguous
and stable for the product's whole history, so the faces are evidence even
though the rationale is not. **No typeface was chosen by this stage.**

### 1.5 Colours and tokens

All twenty D-001 tokens, copied verbatim. One inconsistency found and
recorded rather than silently corrected in the live app:

> **`--danger` has no `--danger-dim`.** Every other semantic colour pairs a
> solid with a 12%-alpha companion; `main.css` declares five `-dim` values,
> not six. The decision register describes the pairing as universal. The
> shell adds `--mythos-danger-dim: rgba(192,57,43,0.12)` to complete the
> convention **in the shell only**. `css/main.css` is not modified —
> retrofitting the live application is out of this stage's scope.

Also recovered: `main.css` reaches for `#ff8c82` and `#e74c3c` whenever
danger must be *read* rather than merely tinted, because `#c0392b` on
`#0e0e0e` is not legible body text. That practice is given a name
(`--mythos-danger-text`) rather than left as a scattered literal.

### 1.6 Layout and grid

**RECOVERED:** fixed 310px sidebar, `.main` offset by the same 310px,
40px page padding, `repeat(auto-fit, minmax(260px, 1fr))` card grids,
`grid-template-columns` detail rows that collapse in two steps.

**No spacing scale exists** (U-004). One was DERIVED — a 4px base fitted to
the values `main.css` already uses (6, 8, 10, 12, 14, 16, 18, 20, 22, 24,
40) rather than imposed over them.

### 1.7 Navigation

**RECOVERED, unchanged.** Sections as 10px uppercase 0.14em-tracked labels;
items as full-width buttons with a 22px glyph slot; hover adds gold-dim
plus a half-strength inset rail and a 1px lift; active adds gold text, the
full-strength rail and a 2px lift.

### 1.8 Surfaces and cards

**RECOVERED:** `linear-gradient(135deg, rgba(30,30,30,0.8),
rgba(20,20,20,0.6))`, `2px solid rgba(201,168,76,0.15)`, 12px radius,
`0 4px 16px rgba(0,0,0,0.3)`; clickable variants lift 4px and warm the
gradient toward gold.

### 1.9 Status and state patterns

**Partially recovered.** `main.css` has state colour (`.stat-chip .val.gold`
… `.purple`) and one true state pair (`.invoice-payment-badge.paid` /
`.pending`). There is no general status vocabulary. The MCC-1 architecture
(§7) contributes the rule that matters: a class must be **a colour and a
word**, never colour alone. §6 below defines the vocabulary.

### 1.10 Responsive rules

**The system's weakest area, as the design roadmap says (Stage 8,
"largest practical gap").** `main.css` breaks at 1100 / 900 / 760;
`layout.css` at 900 / 768 / 420; `professional.css` at 1024 / 900 / 768 /
720 / 600; `dashboard.css` at 768 / 700. Four files, nine widths, no
statement anywhere of which is the ladder.

Worse: **the 310px sidebar is `position: fixed` at every width and never
collapses.** The console adopts the `main.css` ladder (1100 / 900 / 760) as
the canonical one and EXTENDS it with an off-canvas drawer below 900px.
Confined to the console shell; the live application is untouched.

### 1.11 Existing design constraints

- `css/main.css` is load-bearing for the whole legacy application. Editing it
  is a behavioural change to production, not a design change (AGENTS.md §10).
- `projects/command-center/` is a **different product** — the command
  *library* at `ordre.mythosprod.xyz`, light/indigo `#4f46e5`. It is half of
  conflict C-004. Retrofitting it is design-roadmap Stage 3, which is blocked
  behind O-001. **Not touched.**
- The portfolio tracks **zero SVG and zero font files**. `assets/logos/` holds
  PNG only (D-011).
- Design-roadmap Stage 1 is BLOCKED on O-001 and explicitly "do not begin".

### 1.12 Does this stage touch O-001?

**No, and the reasoning is worth stating.** O-001 asks whether *other
Mythos projects* should carry Mythos branding or keep independent
identities. The Command Center is not another project — it is a new
surface of Mythos OS itself, whose identity is already CONFIRMED as D-001.
Extending Mythos OS with its own established system pre-empts nothing.

The owner's instruction — "the Dashboard is an extension of the existing
MYTHOS identity, not a new product identity" — is consistent with that
reading, and no cross-project decision was made here.

---

## 2. Token specification

Implemented in `projects/mythos-os-console/reference/web/mythos.css`. Every
token is namespaced `--mythos-*` so the shell and `css/main.css` can coexist
on one page without collision.

### 2.1 Colour — RECOVERED

| Token | Value | Role |
|---|---|---|
| `--mythos-bg` | `#0e0e0e` | page ground |
| `--mythos-surface` | `#161616` | sidebar, fixed chrome |
| `--mythos-card` | `#1d1d1d` | raised surface |
| `--mythos-border` | `#2a2a2a` | neutral hairline |
| `--mythos-gold` | `#c9a84c` | the accent |
| `--mythos-gold-light` | `#e4c472` | accent text on dark |
| `--mythos-gold-dim` | `rgba(201,168,76,0.12)` | accent ground |
| `--mythos-gold-line` / `-line-2` | `…0.15` / `…0.22` | gold hairlines |
| `--mythos-text` | `#e8e4dc` | body text |
| `--mythos-muted` | `#6b6860` | secondary text |
| `--mythos-danger` … `--mythos-purple-dim` | as `main.css` | six semantic pairs |

**EXTENDED:** `--mythos-danger-dim`, `--mythos-danger-text` (§1.5).

### 2.2 Typography — RECOVERED

```
--mythos-font-display: 'Playfair Display', Georgia, 'Times New Roman', serif
--mythos-font-ui:      'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif
--mythos-font-mono:    ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace   ← EXTENDED
```

The mono stack has no precedent and is EXTENDED: an operations console
shows task ids, commit hashes and log lines, and Inter's digits are
proportional. Both recovered faces carry full local fallbacks — D-002
establishes that a font pack may not ship, so no layout depends on the
webfont arriving.

### 2.3 Scales

Type — DERIVED from observed sizes: 9 · 10 · 11 · 12 · 13 · **14 (base)** ·
16 · 18 · 20 · 24 · 26 · 32.

Spacing — DERIVED, first in the portfolio: 4 · 6 · 8 · 12 · 16 · 20 · 24 ·
32 · 40.

Radius — RECOVERED: 5 · 6 · 8 · 12 · 16 · 999.

Elevation — RECOVERED verbatim: `0 2px 8px rgba(0,0,0,.3)` ·
`0 4px 16px rgba(0,0,0,.3)` · `0 8px 32px rgba(0,0,0,.4)` ·
`0 8px 28px rgba(201,168,76,.20)`.

### 2.4 Motion — RECOVERED

```
--mythos-ease-overshoot: cubic-bezier(0.34, 1.56, 0.64, 1)
--mythos-dur-fast: 0.15s     --mythos-dur-base: 0.3s
```

Design-roadmap Stage 9 records "no motion system exists". That is true of
the *documentation*. The implementation has used exactly two durations and
one overshoot easing consistently since `d1a9d19`. Naming a recurring idiom
is not authoring a motion system, and Stage 9 remains open.

---

## 3. Layout and grid

| Property | Value | Tag |
|---|---|---|
| Sidebar | 310px, fixed, full height | RECOVERED |
| Main offset | 310px inline-start | RECOVERED |
| Page padding | 40px, 24px below 760px | RECOVERED |
| Card grid | `auto-fit, minmax(260px, 1fr)` | RECOVERED |
| KPI grid | `auto-fit, minmax(190px, 1fr)` | DERIVED from `.db-kpi-card` |
| Row grid | 4 columns → 2 at 1100 → 1 at 900 | RECOVERED |

All inline-axis rules use logical properties (`margin-inline`,
`inset-inline`, `border-inline`, `text-align: start`). Both recovered brand
charters specify paired Arabic/Latin type stacks and MCC-1 ships a 464-line
`i18n.js`, so RTL is a live requirement in this portfolio, not a
hypothetical. `dir="rtl"` is a one-attribute change.

---

## 4. Navigation

RECOVERED verbatim (§1.7), plus one EXTENDED behaviour: a registered module
that is **not built** appears dimmed with a `SOON` tag. It is never hidden.
Hiding an unbuilt module makes the system's shape undiscoverable and turns
the registry into private knowledge.

---

## 5. Surfaces

RECOVERED (§1.8). Composition rule for every future module:
`console.css` and any successor **must contain no colour literal** —
neither hex nor `rgb()`/`rgba()`. If a surface needs a colour the token set
does not have, the token set is incomplete and gains a token. This is
enforced by `tests/mos-1-console-test.js`, and it is the mechanism that
stops a fifth palette from accumulating the way the first four did.

---

## 6. Status and state vocabulary — NEW

The one genuinely new design decision in this stage, recorded as **D-013**
in the register. It assigns operational meaning to the existing palette; it
introduces no colour.

| Class | Colour | Means | Executor states |
|---|---|---|---|
| `is-attention` | **gold** | the owner is being waited on | `WAITING_FOR_APPROVAL`, `BLOCKED`, `NEEDS_HUMAN`, `APPROVAL_REQUIRED` |
| `is-running` | blue | in flight | `RUNNING`, `DISPATCHED`, `IN_PROGRESS` |
| `is-ok` | green | finished well | `COMPLETED`, `SUCCEEDED`, `IMPLEMENTED`, `DONE` |
| `is-error` | danger | finished badly | `FAILED`, `ERROR`, `BASELINE_MISMATCH` |
| `is-waiting` | orange (`--today`) | paused by a limit, will resume itself | `WAITING_FOR_QUOTA`, `WAITING_RETRY`, `INTERRUPTED` |
| `is-planned` | purple | declared, not started | `QUEUED`, `PLANNED`, `DRAFT`, `PENDING` |
| `is-inert` | past grey | over, no outcome to report | `CANCELLED`, `SKIPPED`, `ARCHIVED` |

**Gold is reserved for owner attention and used for nothing else.** A gold
pill anywhere on the screen means exactly one thing. U-001 records that the
*rationale* for the Mythos gold is unrecoverable; this does not recover it,
but it gives the accent a defined operational job in this surface.

Every badge renders **a colour and a word** — MCC-1 §7's rule, applied to
operational state.

### 6.1 Whole-surface states

An operations console is unreachable far more often than it is empty, and
the two must never look alike:

| State | When | Rendered as |
|---|---|---|
| Empty | the plane answered, and the answer is nothing | `◌ No missions` — a fact |
| Unreachable | the plane did not answer | `⚠ Control plane unreachable` + "this is not an empty result — the current state is unknown" |
| Unauthorised | the plane refused the token | `⚠ Console is not authorised` |
| Not built | the module is registered, not implemented | `◌ Not built` + the named data source that would back it |

**An operator who cannot distinguish "nothing is running" from "I cannot
see what is running" has been misinformed by the console.** This is the
console's single most important interface rule.

---

## 7. Responsive rules

Ladder ADOPTED from `css/main.css`, the D-001 source file.

| Width | Behaviour |
|---|---|
| > 1100px | full four-column rows |
| ≤ 1100px | rows fold to two columns |
| ≤ 900px | **sidebar becomes an off-canvas drawer** (EXTENDED); rows single-column; page title 32→24px |
| ≤ 760px | page padding 40→24px; all grids single-column |

The other three stylesheets' six additional breakpoints are **not**
reconciled here. That is design-roadmap Stage 8 and it affects live
services.

`prefers-reduced-motion: reduce` is honoured — EXTENDED; the recovery audit
records no reduced-motion handling anywhere in the portfolio.

---

## 8. Accessibility

The strategy document records accessibility as VERIFIED ABSENT
portfolio-wide, with ID Auto's focus ring the only positive. EXTENDED for
this surface:

- A visible focus ring on every interactive control, in the Mythos palette
  (`--mythos-focus-ring`), applied through `:focus-visible`.
- `#view` is focused on route change for screen-reader announcement, and is
  explicitly excluded from the ring — it is a focus *target*, not a control.
- Every status is a colour **and** a word.
- Reduced motion honoured.
- The nav drawer has `aria-expanded`, `aria-controls`, and closes on `Escape`.
- Decorative glyphs are `aria-hidden`; the toggle carries a visually-hidden label.

**Contrast was not measured by this stage and no claim is made about it** —
the same honesty the recovery audit applied. Measuring the D-001 palette is
recorded as follow-up work.

---

## 9. Scalability contract

The shell is driven entirely by
`projects/mythos-os-console/reference/web/modules.js`. Adding a MYTHOS OS
module is:

1. one entry in `MODULES` — `id`, `label`, `icon`, `section`, `state`, `source`, `summary`;
2. one render function in `app.js`, keyed by the same `id`.

It never means touching the sidebar, the router, the page chrome, the empty
states, or `mythos.css`. A module with no renderer routes automatically to
the honest not-built surface, so a registry entry can never be a broken
route. The registry is also served at `GET /api/modules`, so what exists and
what is built is machine-readable rather than scraped from the page.

`source` is required for **planned** modules too. The registry therefore
doubles as the answer to "what would it take to build this?" — for
`memory`, `governance`, `approvals`, `secrets`, `sandbox` and `settings`,
the entry names the file or schema that would back it and why it is not
wired yet.

---

## 10. Design QA method — D-010, generalised

`docs/MYTHOS_DESIGN_DECISIONS.md` D-010 records headless-browser visual
verification as the portfolio's only proven design-QA method: applied once
to SsangYong, where it found three real layout defects, and never
generalised (O-009).

**MOS-1 applies it, and it earned its place immediately.** Three defects
were found in the rendered page that source review had not:

1. **The mobile nav drawer could not be opened.** `.mythos-nav-toggle`'s
   base `display: none` lives in `console.css`; the reveal was written in
   `mythos.css`'s 900px block. `console.css` loads second, and a media
   query grants no extra specificity, so the base rule won at every width.
2. **Two dead `style=""` attributes** in `app.js` tripped the console's own
   `style-src` CSP on every page load.
3. **The "last read" timestamp never rendered** — it read `r.data.at`, but
   `at` sits on the response envelope, not inside `data`.

None is visible by reading the CSS or the JS. All three are obvious in a
browser. The verification harness checks, across 1440 / 1100 / 390 px and
nine routes: horizontal overflow, empty renders, page and console errors,
failed requests, drawer behaviour, and the **computed** brand values —
asserting that the rendered `background-color` really is `rgb(14,14,14)`,
the title really is Playfair Display, the active nav item really is
`rgb(201,168,76)`, and the sidebar really is 310px.

**Recommendation: adopt D-010 as standard (closes O-009).** That remains an
owner decision; MOS-1 is the second data point in its favour.

---

## 11. What this stage did not do

- Did **not** modify `css/main.css`, `css/layout.css`, `css/dashboard.css`,
  `css/professional.css`, `index.html`, or any application JS.
- Did **not** retrofit `projects/command-center/` — C-004 remains open.
- Did **not** resolve O-001, O-003, C-004 or U-001.
- Did **not** begin design-roadmap Stage 1, which is unauthorised.
- Did **not** choose a typeface, a palette, or a visual direction.
- Did **not** add any SVG or font file to the repository.
- Did **not** deploy, create DNS, request a certificate, or touch governance.

---

## 12. Recorded follow-ups

| # | Item | Owner decision needed? |
|---|---|---|
| 1 | `--danger-dim` missing from `css/main.css` | No — a change to the live app, needs its own stage |
| 2 | Nine breakpoints across four stylesheets | No — design-roadmap Stage 8 |
| 3 | Contrast of the D-001 palette never measured | No |
| 4 | Self-host Playfair Display + Inter to remove the CSP font exception | No |
| 5 | Adopt D-010 headless verification as standard (O-009) | **Yes** |
| 6 | `os.mythosprod.xyz` DNS A record | **Yes — LEVEL_3, blocks deployment** |
