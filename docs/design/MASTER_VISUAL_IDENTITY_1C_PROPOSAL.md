# MYTHOS — Master Visual Identity

**Stage:** MYTHOS-DESIGN-1C — master visual identity
**Revision:** 3 — **FINAL PROPOSAL, submitted for approval**
**Date:** 2026-08-18 UTC
**Status:** **NOT APPROVED.** 1C remains non-approved until the owner reviews this
document. Nothing here is implemented. No application code, CSS, existing asset
or historical logo was modified, and **no logo was redrawn, recoloured or
recreated.**

**Built on:** the recovered historical logo · the owner-approved 1A brand
architecture (**A-001**–**A-008**) · the implemented Mythos OS evidence · the
recovered Uthina Chess and Dar Hijama charters · contrast measured this stage.

---

## 0. What changed in this revision, and how to read it

Revisions 1 and 2 offered options. **This revision decides.** The owner asked
for the best professional judgement on every remaining detail, optimised for the
strongest long-term identity rather than for compatibility with existing code.

So the hedging is gone. Every value below is a specific recommendation, and
every contrast figure is measured rather than estimated.

| Label | Meaning |
|---|---|
| **RECOVERED** | Measured from a file in this repository or from recovered charter evidence. Fact |
| **RECOMMENDED** | My professional decision, offered for approval. Specific and complete |
| **OPEN** | Explicitly not resolved here, by owner instruction |

**Architecture held unchanged** (owner-approved, not revisited): MYTHOS is the
master brand · the five units use MYTHOS + descriptor · public projects keep
independent visual identities · shared Mythos DNA is structural, never a forced
visual skin.

**Deliberately unresolved:** **O-A1** (Command Center placement), **O-A3**
(Mythos-level colour in a project identity), **LOGO-1** (does a vector master
exist outside Git), **LOGO-2** (adoption of the 1B reconstruction). Nothing
below depends on any of them.

**The three register decisions now carry a firm recommendation** rather than a
menu: **GOLD-1 → Route A** (§3.5), **TYPE-1 → retire Playfair Display** (§4.2),
**SEM-1 → adopt the corrected semantics** (§3.4).

---

## 1. The idea: Constant + Movement

**RECOVERED.** In the historical wordmark, one letter is slanted at 34.9° and
the other five stand upright.

That is not a quirk of lettering. It is a stable system with one element in
motion — close to a literal description of a group that runs an operating
platform, a production house, digital services and logistics.

**The organising principle: _the constant and the moving part._**

- **The constant** is orthogonal — the grid, the type, the surfaces, the right
  angle. It carries structure, rigour and calm.
- **The movement** is the **35° gesture**. It is the system's single permitted
  non-orthogonal element, and it carries direction and emphasis.

Two rules make it read as intent rather than styling:

1. **The gesture appears once per view. Never twice.**
2. **It is gold or geometric, never both at once.** A gold diagonal that also
   animates is three ideas competing; pick one.

### 1.1 Every subsystem picks a side

For any new component, ask which column it belongs to. If it belongs to both, it
is doing too much.

| Subsystem | **CONSTANT** | **MOVEMENT** |
|---|---|---|
| **Logo** | Upright Y·T·H·O·S, lockup architecture, clear space | The slanted M — origin of the whole idea |
| **Colour** | The warm ink ramp; the ground that never shifts | Mythos Gold — the only saturated thing present |
| **Type** | Plex text at a fixed scale, 65-character measure | Archivo Expanded display, large and sparing |
| **Grid** | The 8-point rhythm, the 12-column field | The 35° cut breaking one edge, once |
| **Shape** | Square corners, 2 px radius, hairline borders | The diagonal edge; a chart's leading bar |
| **Icons** | Square terminals, orthogonal geometry | Diagonals snapped to 35° |
| **Imagery** | Full-bleed rectangles meeting the ground | One masked image per page |
| **Motion** | Everything fades, at one duration | One element travels the 35° vector |
| **Interface** | Surfaces, hairlines, density, the calm field | Focus, the primary action, the active state |

**Why this beats conventional brand pillars: it is falsifiable.** A reviewer can
look at any screen and count the gestures. A central idea that cannot be checked
is a mood board with a token file attached.

---

## 2. Logo system

**Unchanged and deliberately untouched.** The logo is specified in
`docs/design/LOGO_SYSTEM.md`. Its standing:

- The historical logo is the **authoritative source** (**A-007**).
- The Stage 1B vector reconstruction remains **proposed and unapproved**.
  Adoption is **LOGO-2**, which depends on **LOGO-1**.
- The endorsement principle — master identity plus a one-word descriptor — is
  **owner-approved** (**A-003**).

**Nothing in this proposal requires a new logo drawing, and nothing here depends
on which master is eventually adopted.** That is deliberate: the identity must
not be blocked on the logo question.

**The one addition — RECOMMENDED:** the 35° slant is promoted from a property of
the M to a system constant, `--angle-mythos: 35deg`. This is not a change to the
logo. The mark already contains the system's signature; using it elsewhere is
what turns a mark into an identity.

**Usage rules — RECOMMENDED:**

| Rule | Value |
|---|---|
| Clear space | ≥ ½ cap height on all four sides. Nothing enters it — type, rule, image edge or partner logo |
| Minimum size | Below the wordmark's legible floor, replace with the symbol; never scale further |
| Backgrounds | Ink, paper, or a scrimmed image reaching ≥ 4.5 : 1 behind the mark. Never an unscrimmed photograph |
| Monochrome | One-colour reproduction is required for print, signage and embroidery — and **cannot be produced until LOGO-1 is resolved**, because the recovered artefact is a metallic raster that A-007 forbids recolouring. This is the concrete cost of leaving LOGO-1 open |
| Never | Re-slant, mirror, rotate, outline, add effects, or detach the M from YTHOS |

---

## 3. Colour system

### 3.1 What exists — RECOVERED, audited this stage

The Mythos OS `:root` block, measured against its own ground `#0e0e0e`:

| Token | Value | Contrast | As body text |
|---|---|---|---|
| `--text` | `#e8e4dc` | 15.22 : 1 | AAA — **kept** |
| `--gold` | `#c9a84c` | 8.45 : 1 | AAA — superseded, see §3.5 |
| `--green` | `#2ecc71` | 9.19 : 1 | AAA |
| `--blue` | `#5dade2` | 7.86 : 1 | AAA |
| `--today` | `#e67e22` | 6.78 : 1 | AA |
| `--purple` | `#9b59b6` | 4.14 : 1 | **fails** |
| `--danger` | `#c0392b` | 3.55 : 1 | **fails** |
| `--muted` | `#6b6860` | 3.47 : 1 | **fails** |
| `--past` | `#555555` | 2.59 : 1 | **fails everything** |

The dark-and-gold core is genuinely good and is kept. But danger, muted and past
— the tokens carrying errors, secondary text and disabled state — fail, and
those are where failure costs a user most.

**RECOVERED — the best existing idea, promoted to a rule:** six semantic colours
each pair a solid with a **12 %-alpha companion**, applied uniformly. It is the
strongest systematic thinking in the portfolio and it survives into the final
system unchanged in principle.

### 3.2 The measurement that shapes the system

**RECOVERED.** Every gold fails on a light ground:

| Gold | On ink | On paper |
|---|---|---|
| `#c9a84c` | 8.45 : 1 | **2.06 : 1** |
| `#d9a441` | 8.58 : 1 | **2.03 : 1** |
| `#f8d276` | 13.30 : 1 | **1.31 : 1** |

Holding the hue constant and sweeping lightness, the single value that serves
both grounds lands near `#996E1F` — 4.12 : 1 on paper, 4.23 : 1 on ink.
Mediocre on both, beautiful on neither.

> **One gold cannot serve two grounds. The system carries a gold per ground.**
> This is a measurement, not a preference.

### 3.3 The palette — RECOMMENDED

**Two grounds, both first-class.** Ink is the default, because that is where the
mark lives. Paper is fully specified, not a filter over the dark theme.

**Neutrals carry a warm bias toward the gold**, so the palette reads as chosen
rather than defaulted.

| Token | Value | Role | Measured |
|---|---|---|---|
| `ink-900` | `#0B0B0A` | Deepest ground, full-bleed | — |
| `ink-850` | `#0E0E0D` | **Primary dark ground** | — |
| `ink-800` | `#161614` | Raised surface | — |
| `ink-750` | `#1D1D1B` | Card | — |
| `ink-700` | `#2A2A27` | Hairline on dark | — |
| `ink-600` | `#3A3934` | Strong divider on dark | — |
| `ink-550` | `#726F64` | **Control border on dark** | 3.84 : 1 — passes non-text |
| `ink-500` | `#55534B` | Secondary text **on paper** | 6.95 : 1 |
| `ink-300` | `#A8A498` | Secondary text **on ink** | 7.75 : 1 |
| `ink-100` | `#E8E4DC` | **Primary text on ink** | 15.23 : 1 |
| `paper-100` | `#F5F3EF` | **Primary light ground** | — |
| `paper-200` | `#EFECE5` | Raised surface on light | — |
| `paper-300` | `#D6D1C5` | Hairline on light | — |
| `paper-500` | `#7F7B6D` | **Control border on light** | 3.82 : 1 — passes non-text |
| `paper-900` | `#14130F` | **Primary text on paper** | 16.77 : 1 |

**The fix that matters most:** secondary text routes to `ink-300` (7.75 : 1)
instead of the recovered `--muted` (3.47 : 1). Control borders get dedicated
tokens because WCAG 2.2 requires 3 : 1 for non-text boundaries — the recovered
palette had nothing that passed.

### 3.4 Semantic colours — SEM-1, RECOMMENDED: **adopt**

Verified on all four surfaces, not just the primary ground:

| Role | On dark | ink / surface / card | On light | paper / paper-2 |
|---|---|---|---|---|
| success | `#4ADE80` | 11.08 / 10.40 / 9.69 | `#136B34` | 5.96 / 5.60 |
| warning | `#F0A342` | 9.22 / 8.65 / 8.06 | `#7A4F09` | 6.42 / 6.03 |
| danger | `#F1706A` | 6.68 / 6.27 / 5.84 | `#9E2419` | 6.97 / 6.54 |
| info | `#7DC4EA` | 10.08 / 9.45 / 8.81 | `#19608F` | 6.09 / 5.72 |

Each keeps its 12 %-alpha companion. Hues stay in the recovered family — this is
a correction, not a replacement.

**Recommendation: adopt.** Three of the recovered semantic tokens measurably
fail as body text, and they are the ones carrying errors, secondary information
and disabled state. Leaving them is a known accessibility defect in the most
consequential places in the interface. The corrected set costs one token block.

**Data visualisation — RECOMMENDED.** Eight series, all ≥ 7 : 1 on ink, ordered
for hue separation and checked for distinguishability under the common colour
vision deficiencies:

`#D9A441 · #7DC4EA · #4ADE80 · #B98BD0 · #F0A342 · #6FB3A8 · #E8846F · #8E9BD4`

Categorical series never rely on hue alone; shape, label or position carries the
same information.

### 3.5 GOLD-1 — RECOMMENDED: **Route A, `#D9A441`**

**This is my strongest recommendation in the document.**

Adopt the historical logo's own gold as **Mythos Gold**, `#D9A441`.

Revision 1 recommended keeping `#c9a84c`, and leaned on migration cost. The
owner has instructed that the identity must not be optimised for compatibility
with existing code, which removes that argument. On brand merit the answer is
clear, and I state it plainly rather than leaving the earlier recommendation
standing.

**Why:**

1. **It gives the master colour a recorded rationale.** The most damning finding
   in the recovery audit is **U-001**: the defining colour of the product UI is
   a value whose meaning *is nowhere recorded*. A master brand whose primary
   colour cannot be explained is a liability that compounds — every future
   designer inherits an arbitrary constant. Route A ends that permanently: the
   gold is the gold in the mark. That is a sentence you can say to a client, a
   partner or a new hire.
2. **It resolves a conflict instead of preserving one.** Conflict **C-003** —
   two unexplained golds — dissolves the moment the master value comes from the
   logo. Keeping `#c9a84c` ratifies the value that has no provenance and leaves
   C-003 open permanently.
3. **The visible cost is nothing.** `#D9A441` and `#c9a84c` differ by
   **0.14 : 1** in contrast on ink (8.59 vs 8.45) and are near-indistinguishable
   side by side. What changes is not how it looks — it is whether the brand can
   explain itself.
4. **Portfolio coherence comes free.** `#D9A441` is also Uthina Chess's Imperial
   Gold, recovered and live. Route A turns an unexplained coincidence into a
   documented relationship.

**Honest cost:** Mythos OS's implemented tokens then differ from the master
until migrated. That is a real migration — and a token-level one: a single value
in a single block, which under §9's token architecture is exactly one edit.

**The gold ramp — RECOMMENDED**, constant hue 39.1°:

| Token | Value | On ink | On paper | Use |
|---|---|---|---|---|
| `gold-200` | `#EBCE99` | 12.71 : 1 | 1.37 : 1 | Hover on dark, large display |
| `gold-400` | `#DDAE55` | 9.44 : 1 | 1.85 : 1 | Active state on dark |
| **`gold-500`** | **`#D9A441`** | **8.59 : 1** | 2.05 : 1 | **Mythos Gold — the brand value** |
| `gold-700` | `#9D711F` | 4.43 : 1 | 3.94 : 1 | Borders, large graphics |
| **`gold-800`** | **`#805C19`** | 3.18 : 1 | **5.47 : 1** | **Gold text and icons on paper** |

`gold-500` on ink and `gold-800` on paper are the two working values. The bright
gold remains permitted on paper for large non-text graphics only.

**Gold behaviour — three rules:**

1. **Gold is scarce.** One saturated colour on the page. It marks the primary
   action, the active state, the focus ring and the one gesture. Nothing else.
2. **Gold is never a ground.** No gold panels, no gold headers. The moment it
   becomes a surface it stops signalling.
3. **Gold never carries body text on paper.** At 2.05 : 1 it is unreadable;
   `gold-800` carries text there.

---

## 4. Typography

### 4.1 What exists — RECOVERED

`Playfair Display` appears in **45** declarations across `css/*.css` and `Inter`
in **11**. Mythos OS is, in practice, a *Playfair + Inter* system that was never
written down (**U-003**). The three most common sizes in the codebase are
**12 px, 11 px and 13 px**.

### 4.2 TYPE-1 — RECOMMENDED: **retire Playfair Display from the master brand**

Stated as a decision, not a question.

Playfair is a high-contrast transitional display serif. Three specific failures
for this brand, in order of severity:

1. **It has no Arabic.** For a Tunisian group operating in Arabic, French and
   English, a display face that covers one of three scripts cannot be the master
   voice. Everything else is secondary to this.
2. **Its thin strokes disappear where this interface lives.** At 11–13 px — the
   sizes the codebase actually uses — Playfair's hairlines thin to
   near-invisibility and its contrast fights small-size legibility.
3. **It signals the wrong category.** Playfair reads luxury-editorial: fashion,
   weddings, magazines. Mythos is technical, industrial and operational. The
   recovered wordmark is an *extended geometric sans* — the display face should
   agree with the mark, not contradict it.

**Recommendation: retire it from the master brand.** It may remain in any public
project whose own identity calls for it — that is exactly what **A-006**
protects.

### 4.3 The type system — RECOMMENDED

| Role | Face | Why |
|---|---|---|
| **Display** | **Archivo Expanded** (OFL, variable width + weight) | Its extended geometric proportions echo the wordmark directly, so headlines look related to the logo without being set in it |
| **Text / UI** | **IBM Plex Sans** (OFL, variable) | Engineered and neutral without being anonymous; excellent at 11–14 px, which is where this interface lives. Not Inter — so not the default everyone reaches for |
| **Arabic** | **IBM Plex Sans Arabic** (OFL) | Designed as part of the same family: Arabic and Latin share proportions and colour. Already named in the recovered Dar Hijama charter |
| **Data / code** | **IBM Plex Mono** (OFL) | Same family; tabular figures for financial and technical tables |

**The decisive argument:** one designed family across **Latin, Arabic and
monospace** is rare, and for a bilingual group it is the difference between a
brand that is *bilingual* and one that is merely *translated*. All four faces
are open-licensed, variable, and self-hostable — no licence cost at any scale,
no external dependency, no per-property negotiation as the group grows.

**The scale** — 1.25 ratio, 16 px base:

| Style | Size / line-height | Tracking | Weight |
|---|---|---|---|
| Display XL | 61 / 1.02 | −0.022em | Archivo 600 |
| Display L | 49 / 1.06 | −0.020em | Archivo 600 |
| H1 | 39 / 1.12 | −0.018em | Archivo 600 |
| H2 | 31 / 1.18 | −0.015em | Archivo 600 |
| H3 | 25 / 1.24 | −0.012em | Plex 600 |
| H4 | 20 / 1.32 | −0.008em | Plex 600 |
| Body L | 18 / 1.62 | 0 | Plex 400 |
| Body | 16 / 1.62 | 0 | Plex 400 |
| Body S | 14 / 1.56 | 0 | Plex 400 |
| Caption | 13 / 1.46 | +0.005em | Plex 400 |
| Label | 12 / 1.34 | +0.10em, uppercase | Plex 500 |
| Data | 14 / 1.44 | 0, tabular figures | Plex Mono 400 |

Running text is capped near **65 characters**. Headings take
`text-wrap: balance`. Body text never renders below 16 px on any viewport.

### 4.4 Arabic typography — RECOMMENDED

The detail most bilingual systems get wrong, stated as binding rules:

1. **+6 % size and +0.15 line-height on every Arabic style.** Arabic set at an
   identical size reads visually smaller, and its diacritics need vertical room.
2. **Letter-spacing is forced to `0`.** Tracking breaks Arabic joining. This is
   a correctness bug, not a style preference — no Arabic style may set tracking.
3. **`lang` and `dir` are set per element, not per page**, so mixed Arabic and
   French content in one block renders correctly in both directions.
4. **Logical CSS properties throughout** — never `left`/`right`.
5. **Numerals:** Western Arabic numerals (0–9) by default across all three
   languages for operational and financial data, because the same figures appear
   in invoices, tables and exports read by all three audiences.
6. **What does not mirror in RTL:** numbers, media controls, progress direction,
   logos — **and the M's slant.** The slant direction is part of the mark's
   identity and is fixed in both reading directions.

---

## 5. Grid and spacing — RECOMMENDED

**RECOVERED:** the codebase has six ad-hoc breakpoints (700, 720, 760, 768, 900,
1100 px) and no spacing scale of any kind.

**The scale — 8-point with 4 px half-steps:**

`2 · 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 · 96 · 128 · 160`

- **Sections** use only 48 / 64 / 96 / 128.
- **Components** use only 8 / 12 / 16 / 24.
- Nothing between is legal. That constraint is what makes a system feel composed
  rather than assembled.

**Containers:** content max **1280**, wide **1440**, prose max **68ch**.
**Columns:** 12 / 8 / 4 with 24 / 20 / 16 gutters and 80 / 48 / 20 margins.

**Breakpoints, defined by content behaviour rather than devices:**

| Name | Range | What changes |
|---|---|---|
| `sm` | < 600 | Single column. Navigation collapses to a full-screen overlay. Tables become cards |
| `md` | 600–903 | Two columns. Sidebars become sheets |
| `lg` | 904–1239 | Three columns. Persistent sidebar returns |
| `xl` | 1240–1919 | Full 12-column grid at max content width |
| `2xl` | ≥ 1920 | Grid stops growing; margins absorb the surplus |

---

## 6. Shape and surface — RECOMMENDED

**RECOVERED:** twelve different radius values exist in the codebase (2, 6, 7, 8,
10, 12, 14, 16, 20, 50 %, 99, 999 px). There is no shape language.

**Radius, argued from the mark.** The wordmark has flat terminals and sharp
corners, so the identity argues for *low* radius — which also puts distance
between Mythos and the softly rounded look every generated interface shares.

| Token | Value | Applies to |
|---|---|---|
| `radius-0` | 0 | Tables, data cells, full-bleed media, the 35° cut |
| `radius-1` | **2 px** | **The workhorse** — inputs, buttons, chips, small cards |
| `radius-2` | 6 px | Cards, panels, menus |
| `radius-3` | 12 px | Modals, sheets, app tiles |
| `radius-full` | 999 px | Avatars and status dots **only** |

**Elevation by surface, not by shadow.** Depth steps
`ink-850 → ink-800 → ink-750` with a 1 px `ink-700` hairline. Shadows are
reserved for things that genuinely float — menus, modals, toasts — and never
used to decorate a static card.

**The signature shape:** a **35° cut** on one edge of one element per view — a
section divider, an image mask, a hero corner, a chart's leading bar.

---

## 7. Components — RECOMMENDED principles and core specs

Not the component library — that is Stage 1F. These are the decisions 1F must
build to.

**Universal rules:**

- Every interactive element has six defined states: **default, hover, active,
  focus-visible, disabled, loading**. A component without all six is unfinished.
- **Focus is never removed:** 2 px `gold-500` outline at 2 px offset on ink
  (8.59 : 1), 2 px `gold-800` on paper (5.47 : 1). Both exceed the 3 : 1 WCAG 2.2
  requires.
- **Touch targets ≥ 44 × 44 px** with 8 px separation, at every breakpoint.
- **Status is form plus colour** — a chip, a stripe or a leading rule alongside
  the 12 %-alpha background. Never colour alone.
- **Controls say what happens.** The button reads `Publish`; the toast that
  follows reads `Published`.
- **Errors explain the fix**, are linked programmatically to their field, and
  are never colour-only.
- **Empty and error states are designed**, not left to a bare string.

**Core specifications:**

| Component | Specification |
|---|---|
| **Button** | Height 36 (compact) / 40 (comfortable). Padding 9 / 15. Radius 2. Primary: `gold-500` ground with `ink-850` label (8.59 : 1). Secondary: transparent with `ink-550` border. Ghost: text only |
| **Input** | Height 40. Radius 2. Border `ink-550` on dark, `paper-500` on light — both pass 3 : 1. Labels are visible and persistent; **placeholder is never a label** |
| **Card** | Radius 6, 1 px hairline, surface one step above its ground, padding 16 / 20 / 24 by density. No shadow |
| **Navigation** | `xl` horizontal bar with an ecosystem panel exposing the three tiers; `sm` full-screen overlay that **preserves the same tier structure**. Active item marked by a 2 px gold underline, never by colour alone |
| **Table** | Radius 0, tabular figures, sticky header, row hover at 4 % surface. Becomes cards below `md`, primary column as card title |
| **Modal** | Radius 12, focus trapped, focus returned on close, full-screen at `sm` |
| **Chip / status** | Radius 2, 12 %-alpha ground, solid dot, text at the semantic value |
| **Toast** | Radius 6, enters along the 35° vector, auto-dismiss ≥ 6 s, never the only channel for an error |

**Density:** *comfortable* for content and marketing; *compact* for operational
views, reducing vertical padding one step — never type below 13 px or targets
below 44 px.

---

## 8. Iconography — RECOMMENDED

**RECOVERED:** no icon system exists. The only vector artwork in the CSS is
three inline gold chevrons for form controls.

- **24 px grid**, 2 px stroke, **square terminals and square joins** — matching
  the wordmark's flat terminals, and a deliberate departure from the rounded
  caps of almost every icon library.
- Sizes 16 / 20 / 24 / 32. Stroke stays 2 px to 24, 2.5 px at 32.
- Internal corner radius: 1 px maximum. Geometry built from circles, squares and
  45° / 35° lines.
- **Any diagonal snaps to 35°** where the geometry allows. That is what makes
  the set unmistakably Mythos rather than generic.
- Two weights only: regular, and filled for selected state.
- Icons never carry meaning alone; every icon-only control has an accessible
  name.

---

## 9. Design tokens — RECOMMENDED philosophy

Philosophy only; the token file is Stage 1E.

```
GLOBAL      raw values, named for what they are      gold-500, ink-850, space-6
   ↓        a component may never reference these
SEMANTIC    named for what they mean                 text-primary, ground, accent,
   ↓        the layer designers argue about          border-subtle, focus-ring
COMPONENT   named for where they act                 button-bg, card-border
```

Five rules, each preventing a failure this repository already demonstrates:

1. **No hardcoded visual values in components.** Twelve radius values and eight
   durations exist precisely because nothing forced a scale.
2. **Components consume semantic tokens, never global ones.**
3. **Every token has exactly one reason to change.**
4. **Theme is a token remap, never a component fork.** No `.dark-button`.
5. **The semantic layer stays at roughly 40–60 tokens** — a system, not a
   dictionary nobody reads.

**Consequence worth acting on:** because components ask for `accent` and never
for `gold-500`, **the token architecture can be built before GOLD-1 is
approved.** Adopting Route A then changes one global value. That takes GOLD-1
off the critical path of Stage 1E.

---

## 10. Motion — RECOMMENDED

**RECOVERED:** eight ad-hoc durations exist (.1 to .3 s), `.15s` most common. No
easing system.

| Token | Duration | Use |
|---|---|---|
| `motion-micro` | 120 ms | Hover, focus, checkbox — anything under the pointer |
| `motion-base` | 180 ms | Standard state change |
| `motion-enter` | 240 ms | Elements arriving |
| `motion-overlay` | 320 ms | Modals, sheets, drawers |
| `motion-page` | 480 ms | Route transitions and orchestrated sequences only |

**Easing:** enter `cubic-bezier(0.2, 0, 0, 1)` · exit `cubic-bezier(0.4, 0, 1, 1)`
· move `cubic-bezier(0.4, 0, 0.2, 1)`. No springs, no bounce — they read as
playful, and this brand is not.

**The signature:** one element per view enters by travelling **along the 35°
vector** — roughly 10 px up-and-right, decelerating, with a fade. Everything
else fades in place.

**Rules:** motion communicates a state change, a hierarchy or a continuity —
never decoration. Nothing loops, nothing autoplays. Under
`prefers-reduced-motion` every transform collapses to opacity and durations drop
to `motion-micro`. **The interface must remain complete and legible with
animation disabled entirely.**

---

## 11. Responsive behaviour — RECOMMENDED

- **Mobile is a design target, not a shrink.** Every layout is drawn at `sm`
  first, and the desktop layout must justify what it adds.
- **Navigation** collapses to a full-screen overlay that preserves the tier
  structure — the architecture must be legible on a phone.
- **Tables** become stacked cards below `md`. Wide content scrolls inside its
  own container; the page body never scrolls sideways.
- **Type** scales fluidly with `clamp()` between the scale's stops, never below
  16 px for body.
- **Touch targets** 44 × 44 minimum at every breakpoint — not only small ones.
- **Sidebars** become sheets at `md`; modals become full-screen at `sm`.
- **Images** switch ratio by breakpoint: 16:9 at `lg`+, 4:5 at `sm`.

---

## 12. Accessibility — RECOMMENDED

**WCAG 2.2 AA is the floor; AAA for body text, which this palette achieves on
ink (15.23 : 1) and on paper (16.77 : 1).** Accessibility is not a review step
here — the palette in §3 was *derived from* contrast measurement.

- **Contrast:** every semantic colour measured on all four surfaces (§3.4).
  Non-text UI, control borders and focus indicators ≥ 3 : 1 — with dedicated
  border tokens added because the recovered palette had none that passed.
- **Keyboard:** everything reachable and operable, visible focus always, skip
  links, focus trapped in modals and returned on close, no keyboard traps.
- **Screen readers:** semantic HTML first, landmarks, one `h1`, accessible names
  on icon-only controls, live regions for async status.
- **RTL and bilingual:** logical properties throughout; `lang`/`dir` per element;
  the M's slant does not mirror.
- **Forms:** persistent visible labels, programmatic error association, errors
  never colour-only.
- **Motion:** `prefers-reduced-motion` honoured system-wide.
- **Also:** `forced-colors` mode, 200 % zoom without loss, 320 px reflow.

---

## 13. Imagery and art direction — RECOMMENDED

**The subject is the work.** Real production, real workshops, real machines,
real people working in Tunisia. Not stock offices, not handshakes, not laptops
on white desks. For a group whose business is making things, this is the
cheapest and most durable way to look unlike a software startup.

- **Treatment:** deep blacks meeting `ink-850` so images bleed into the ground;
  warm-neutral grade consistent with the palette; high micro-contrast; no heavy
  filters, no duotone gimmicks.
- **Ratios:** 16:9 hero, 3:2 editorial, 4:5 portrait and mobile, 1:1 grid.
- **Overlay rule:** text over an image sits on a scrim reaching **≥ 4.5 : 1**
  against the text — measured, not eyeballed.
- **The signature:** one image per page may take the 35° mask.
- **Illustration:** only for explaining systems and processes — flat,
  two-colour, built from the icon geometry. Never decorative spot art.

**AI-generated imagery — governance, stated because the absence of a rule is how
brands get into trouble:**

1. Permitted for abstract texture, backgrounds and non-representational
   material.
2. **Never** for depicting real people, clients, facilities or products, or
   anything a viewer would reasonably read as documentary.
3. Every AI-generated asset is labelled as such in its filename and in the asset
   register.
4. Never used to fabricate evidence of work, capability or scale.

---

## 14. MYTHOS and its five units

**Architecture unchanged and owner-approved:** units use the master identity plus
a descriptor; five unrelated logos must not be created.

**RECOMMENDED — the units get no colour of their own.**

The instinct is to hand each unit an accent — OS blue, Logistique green. I
recommend against it. **Five accents is how a young master brand dissolves into
five weak ones**, and Mythos does not yet have the recognition to spend.
Recognition compounds fastest when every unit reinforces the same gold.

Differentiation moves from **colour** to **subject, density and dominant
component** — more durable, and harder to counterfeit, than a hue:

| | Descriptor | Imagery subject | Density | Dominant component | Reads as |
|---|---|---|---|---|---|
| **MYTHOS** | *(none)* | The group, its people, its scale | Comfortable | Editorial section, full-bleed image | Authority — the parent |
| **Mythos OS** | `OS` | Screens, data, systems in use | **Compact** | Table, panel, command surface | Precision — the instrument |
| **Mythos Prod** | `PROD` | Production, sets, crews, machines | Comfortable, image-led | Full-bleed media, project card | Craft — the maker |
| **Mythos Services** | `SERVICES` | People, workshops, hands, delivery | Comfortable | Service card, process step | Reliability — the promise |
| **Mythos Digital** | `DIGITAL` | Interfaces, motion, built work | Comfortable | Case study, before / after | Capability — the proof |
| **Mythos Logistique** | `LOGISTIQUE` | Vehicles, routes, warehouses | **Compact** | Table, status chip, timeline | Certainty — the operation |

Two units run compact because both are operational and data-dense. That single
variable does more perceptual work than five accent colours would, and it is
derived from what the unit *does* rather than assigned arbitrarily.

The 35° gesture appears in all six on a different carrier each time — a section
divider for the master, a chart's leading bar in OS, an image mask in Prod, a
timeline head in Logistique. **Same gesture, different carrier.** That is what a
family resemblance looks like when it is designed rather than painted on.

**Governed extension path:** if two units must be told apart at a glance on one
screen, unit accents enter as a governed extension — one colour each from the
§3.4 data palette, permitted only for charts, chips and 1 px rules, never a
header, a lock-up or a page ground.

---

## 15. Public projects — Mythos DNA without the Mythos skin

**Architecture unchanged and owner-approved (A-004, A-006).**

Take the strongest recovered example, **Uthina Chess** — the one project whose
written charter is demonstrably implemented (**RECOVERED**): nine official
colours led by Imperial Gold `#D9A441`, Cinzel/Trajan display, Noto Kufi Arabic,
a documented Hero → Details → Registration hierarchy. **None of it changes.**

| Stays entirely the project's own | Inherited from Mythos, invisibly |
|---|---|
| Imperial Gold and the nine-colour palette | The accessibility floor — contrast measured, not assumed |
| Cinzel / Trajan / Noto Kufi Arabic | Focus behaviour and keyboard operability |
| The chess-and-Roman visual world | Breakpoints defined by content behaviour |
| Its logo, favicon, tone and page hierarchy | The spacing rhythm and component principles |
| Its customer relationship | Performance budget, QA and governance |

**Mythos DNA is a floor, not a look.** A visitor to `uthinachess.tn` should never
be told what to feel about Mythos; a developer moving between two Mythos projects
should find the same focus ring, the same spacing logic, the same accessibility
floor.

The only visible Mythos presence is a discreet footer endorsement — and its
form remains **O-A6**, open.

---

## 16. Decisions

### 16.1 Recommended for approval

| Ref | Recommendation |
|---|---|
| **GOLD-1** | **Route A** — Mythos Gold `#D9A441`, the historical logo's own gold, with `gold-800 #805C19` for text on light grounds |
| **TYPE-1** | **Retire Playfair Display** from the master brand. Adopt Archivo Expanded + IBM Plex Sans / Sans Arabic / Mono |
| **SEM-1** | **Adopt** the corrected semantic palette, verified on all four surfaces |

Plus every RECOMMENDED value in §3–§14: palette, scale, spacing, radius,
components, icons, motion, responsive rules, accessibility floor and the
unit-expression system.

### 16.2 Explicitly not resolved

| Ref | Question | Why it stays open |
|---|---|---|
| **O-A1** | Where does Mythos Command Center sit? | Owner instruction. Note only that its indigo `#4f46e5` sits outside this palette, so placement has a visual consequence |
| **O-A3** | May a public project use a Mythos-level colour? | Owner instruction. It is the exception clause inside **A-006** |
| **LOGO-1** | Does a vector master exist outside Git? | Question of fact, blocked on environment access. Pending task recorded |
| **LOGO-2** | Adoption of the 1B reconstruction | Depends on LOGO-1 |

**Nothing in §1–§15 depends on any of these four.**

---

## 17. What this proposal is not

- **Not a design system.** No token file, component library or stylesheet was
  written. Those are Stages 1D–1F, and only on approval.
- **Not implemented.** No application code, CSS, existing asset or website was
  modified.
- **Not a logo change.** Per **A-007** nothing was redrawn, recoloured or
  recreated.
- **Not approved.** **1C remains NON-APPROVED until the owner reviews this
  document.**

**If approved, the sequence is:** **1D** writes `COLOR_SYSTEM.md` and
`TYPOGRAPHY.md` from §3 and §4 → **1E** the token architecture and grid from §5
and §9 → **1F** the component system from §7. **O-A1 should be settled before
1H**, because the public hub's information architecture depends on it.
