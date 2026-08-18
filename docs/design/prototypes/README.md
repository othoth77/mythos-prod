# MYTHOS Design Prototypes — Stage 1I

**Status: PROTOTYPES. Not deployed. Not referenced by any application, build
step or production surface.** Generated under the delegated mandate
(`docs/MYTHOS_DESIGN_DECISIONS.md` §0.5) fulfilling item 5 of the mandate's
five-item continuation ("Complete 1I Design Prototypes"), matching the seven
areas the original programme brief named in its §23.

Each file is a **self-contained static HTML page**. Open any of them directly
in a browser — no build step, no server, no external network dependency for
six of the seven (prototype 5 keeps one CDN load for the *fictional
project's own* Playfair Display typeface, deliberately, since that face
belongs to the demonstration, not to Mythos — see its own note below).

## Dependencies

- `../../../assets/brand/tokens/tokens.css` — the canonical token system (AUTO-3)
- `../../../assets/brand/fonts/fonts.css` — real self-hosted Mythos fonts (**TYPE-2**, AUTO-4). Replaces an earlier Google Fonts CDN stand-in that, for prototypes 1/2/4/6/7, was requesting an invalid family name ("Archivo Expanded" is not a real Google Fonts family) and silently failing — every display heading in those five prototypes was rendering in the fallback stack, not the approved typeface, until this fix
- `../../../assets/brand/master/*.svg` — the adopted vector reconstruction (AUTO-1), inlined directly into each page rather than `<img>`-referenced, so `currentColor` correctly inherits the page's text colour

## The seven prototypes

| # | File | Demonstrates |
|---|---|---|
| 1 | `1-master-brand.html` | The wordmark, the gold and neutral palette, the type scale, the five-unit descriptor system, the 35° gesture used exactly once |
| 2 | `2-mythosprod-hub.html` | The `mythosprod.xyz` hub information architecture (1H §9) — units, projects, an evidence-based status ledger (not an assumption), the ecosystem-strip footer |
| 3 | `3-mythos-os.html` | A Mythos OS dashboard shell — **a new, standalone file, not a modification of `css/main.css` or any tracked application file** (see C-006, AUTO-2) |
| 4 | `4-business-unit-example.html` | The descriptor system applied to a named unit (Mythos Digital) — flagged explicitly that the unit itself has zero recovered evidence (O-004) |
| 5 | `5-public-project-example.html` | The **A-021 boundary** — a fictional project ("Loulou Studio") keeps its own logo, palette and primary action colour entirely; gold appears exactly once, in the ecosystem strip, never in the header or hero |
| 6 | `6-mobile-experience.html` | 320px reflow, the full-screen navigation overlay preserving the tier structure, 44×44 touch targets throughout |
| 7 | `7-component-showcase.html` | Buttons, inputs, cards, badges, switch and link, with the **A-022 hit-box expansion visualised** (dashed outline), disabled/error/loading states, MOTION-1's static-skeleton resolution |

## What these are not

- Not a claim that any of the seven areas is built, deployed, or ready to ship.
- Not a redesign of any real project's live site — `5-public-project-example.html`
  is explicitly fictional.
- Not a font decision beyond what **TYPE-2**/**AUTO-4** already closed —
  prototypes 1–4, 6, 7 now load the real self-hosted Mythos fonts;
  prototype 5's Playfair Display CDN load is the fictional project's own
  typeface choice, not a Mythos stand-in, and is intentionally unchanged.
- Not evidence that Mythos Digital, Services or Logistique exist as operating
  brands (**O-004**) — prototype 4 says so explicitly, in the page itself.

## Provenance

Every visual decision used here is either **owner-approved** (A-\*) or an
**AUTO-\*** decision made under the delegated mandate — nothing in these seven
files invents a new value. Where a prototype needed something no prior stage
had specified, it deliberately kept the omission visible (see prototype 3's
mission table, which shows a real, unresolved deployment blocker rather than
a fabricated "all green" state).
