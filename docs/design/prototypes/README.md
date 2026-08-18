# MYTHOS Design Prototypes — Stage 1I

**Status: PROTOTYPES. Not deployed. Not referenced by any application, build
step or production surface.** Generated under the delegated mandate
(`docs/MYTHOS_DESIGN_DECISIONS.md` §0.5) fulfilling item 5 of the mandate's
five-item continuation ("Complete 1I Design Prototypes"), matching the seven
areas the original programme brief named in its §23.

Each file is a **self-contained static HTML page**. Open any of them directly
in a browser — no build step, no server, no dependency beyond the two files
below and a Google Fonts CDN load (a stand-in only; see the note in each file).

## Dependencies

- `../../../assets/brand/tokens/tokens.css` — the canonical token system (AUTO-3)
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
- Not a font decision — Google Fonts is loaded as a prototype convenience only;
  `TYPOGRAPHY.md` requires self-hosting once real font files exist (**TYPE-2**).
- Not evidence that Mythos Digital, Services or Logistique exist as operating
  brands (**O-004**) — prototype 4 says so explicitly, in the page itself.

## Provenance

Every visual decision used here is either **owner-approved** (A-\*) or an
**AUTO-\*** decision made under the delegated mandate — nothing in these seven
files invents a new value. Where a prototype needed something no prior stage
had specified, it deliberately kept the omission visible (see prototype 3's
mission table, which shows a real, unresolved deployment blocker rather than
a fabricated "all green" state).
