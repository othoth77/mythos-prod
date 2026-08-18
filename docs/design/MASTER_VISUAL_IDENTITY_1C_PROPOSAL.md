# MYTHOS — Master Visual Identity (Stage 1C proposal)

**Stage:** MYTHOS-DESIGN-1C — master visual identity
**Date:** 2026-08-18 UTC
**Revision:** 2 — refined 2026-08-18 after owner review of revision 1.
**Status:** **PROPOSAL. NOT APPROVED, not implemented, not a design system.**
Nothing here has been applied. No code, CSS, asset, logo or website was modified
to produce it, and **no logo was redrawn, recreated or recoloured.**

**What the owner review confirmed as the direction to refine around:** a
**dark-first** MYTHOS identity; **Constant + Movement** as the central visual
concept; the **35° gesture** derived from the historical M; **no arbitrary
five-colour system** for the five units; **independent visual identities** for
public projects; **measurable** accessibility; a **simplified token philosophy**;
**proper Arabic typography**. Everything else below remains a proposal.

**Design criterion, restated by the owner and applied throughout this revision:**
*do not optimise the identity merely to match existing Mythos OS code.* The
objective is the best coherent MYTHOS identity, judged on brand evidence,
accessibility measurement, professional system principles and future
scalability. Existing implementation inconsistencies may be corrected later.
**This changes one recommendation — see §3.4.**

**Built on:** the recovered historical logo · the **owner-approved** 1A brand
architecture (decisions A-001–A-008) · the implemented Mythos OS tokens · the
recovered Uthina Chess and Dar Hijama charters · the full decision register.

---

## 0. How to read this document

Every substantive statement carries one of three labels. They are not
decorative — they mark what you may rely on.

| Label | Meaning |
|---|---|
| **RECOVERED** | Measured or read from a file in this repository or from recovered charter evidence. Fact |
| **PROPOSED** | My professional recommendation. Reasoned, but a decision you have not yet taken |
| **OPEN DECISION** | Deliberately left to you. Never resolved here by inference |

### 0.1 Nothing in the review list has become a decision

The owner named seven items to keep as proposals. They are listed here so no
later reader can mistake a well-argued section for a settled one.

| Item | Where | Status after this revision |
|---|---|---|
| Gold system | §3.4 | **PROPOSED — OPEN (GOLD-1).** Recommendation *changed* this revision, still not a decision |
| Playfair Display removal | §4.2 | **PROPOSED — OPEN (TYPE-1)** |
| Final typography | §4.3 | **PROPOSED.** Faces, scale and weights all remain open |
| Semantic colour corrections | §3.3 | **PROPOSED — OPEN (SEM-1)** |
| Exact radius values | §6 | **PROPOSED.** The *argument* (low radius, from the mark) is the proposal; the numbers are illustrative |
| Exact transition durations | §10 | **PROPOSED.** The *count* (five, replacing eight ad-hoc) matters more than the millisecond values |
| Exact breakpoint system | §5 | **PROPOSED.** The *principle* (content behaviour, not devices) is the proposal; the pixel values are illustrative |

Where a section states a number, read it as *"a value of this kind, at roughly
this size"* unless it is labelled RECOVERED — in which case it is a measurement.

**Binding constraints respected throughout.** Per **A-007** the recovered
historical logo is the authoritative historical source and was **not** redrawn,
recoloured or recreated for this proposal. Per **A-008 / GOLD-1** the gold
question is **not** resolved below — it is measured and put to you as a choice.
**O-A1** and **O-A3** are untouched.

---

## 1. The idea

Everything below descends from one observation about the recovered mark.

> **RECOVERED.** In the historical wordmark, one letter is slanted at 34.9° and
> the other five stand upright.

That is not a quirk of lettering. It is a statement of structure: **a stable
system with one element in motion.** For a group that runs an operating
platform, a production house, digital services and logistics, it is close to a
literal description of the business.

**PROPOSED — the organising principle: _the constant and the moving part._**

- **The constant** is orthogonal: the grid, the type, the surfaces, the rules,
  the right angle. It carries structure, rigour and calm.
- **The moving part** is the **35° slant**. It is the system's single permitted
  non-orthogonal gesture, and it carries direction, momentum and emphasis.

The discipline that makes this work, and the reason it will not age into noise:

> **The 35° gesture appears once per view.** Never twice. Everything else is
> square.

This gives Mythos something most technology brands lack — a signature that is
*structural* rather than *decorative*, that survives being rendered in one
colour on a fax, and that a developer can implement as a variable. It also
resists the generic: it is derived from your own mark, so nobody else has it.

### 1.1 The spine — every subsystem serves one side or the other

**PROPOSED.** Constant + Movement is not a slogan attached to the identity; it
is the rule that decides each subsystem's behaviour. Refined this revision so
the concept is checkable rather than evocative: for any new component, ask which
column it belongs to. If it belongs to both, it is doing too much.

| Subsystem | **CONSTANT** — structure, calm, repetition | **MOVEMENT** — direction, emphasis, the one gesture |
|---|---|---|
| **Logo** | The upright Y·T·H·O·S, the lockup architecture, clear space | The slanted M — the origin of the entire idea |
| **Colour** | The warm ink ramp; the dark ground that never shifts | The gold — the only saturated thing on the page |
| **Typography** | Plex text at a fixed scale; the 65-character measure | Archivo Expanded display, used sparingly and large |
| **Grid** | The 8-point rhythm; the 12-column field | The 35° cut that breaks one edge, once |
| **Shape** | Square corners, 2 px radius, hairline borders | The diagonal edge; the leading rule on a chart |
| **Icons** | Square terminals, orthogonal geometry | Diagonals snapped to 35° |
| **Imagery** | Full-bleed rectangles meeting the ground | One masked image per page |
| **Motion** | Everything fades, at one duration | One element per view travels the 35° vector |
| **Interface** | Surfaces, hairlines, density, the calm field | Focus, the primary action, the active state |

Two rules make the system legible rather than busy:

1. **Movement is scarce.** One gesture per view. Scarcity is what makes it read
   as intent rather than as styling.
2. **Movement is always gold or always geometric, never both at once.** A gold
   diagonal that also animates is three ideas competing; pick one.

**Why this beats a conventional "brand pillars" approach:** it is falsifiable.
A reviewer can look at any screen and count the gestures. A design system whose
central idea cannot be checked is a mood board with a token file attached.

---

## 2. Logo system

**RECOVERED / already documented.** The logo work is complete as far as this
stage may take it and is specified in `docs/design/LOGO_SYSTEM.md`. Summary of
its standing:

- The historical logo is the **authoritative source** (**A-007**).
- The Stage 1B vector reconstruction is **PROPOSED and unapproved**. Its
  adoption is **LOGO-2**, which depends on **LOGO-1** (does a true vector master
  exist outside Git — pending task, blocked on environment access).
- The endorsement principle — master identity plus a one-word descriptor — **is**
  owner-approved (**A-003**).

**Nothing in this 1C proposal requires a new logo drawing.** Every system below
works with the historical mark, with the 1B reconstruction, or with a future
vector master recovered by LOGO-1. That is deliberate: the identity should not
be blocked on the logo question.

**PROPOSED — the one addition:** the 35° slant is promoted from a property of
the M to a **system constant**, `--angle-mythos: 35deg`. This is not a change to
the logo. It is the recognition that the logo already contains the system's
signature, and using it elsewhere is what turns a mark into an identity.

---

## 3. Colour system

### 3.1 What exists today

**RECOVERED — audited this stage.** The Mythos OS `:root` block, measured
against its own ground `#0e0e0e`:

| Token | Value | Contrast on `#0e0e0e` | Verdict as body text |
|---|---|---|---|
| `--text` | `#e8e4dc` | **15.22 : 1** | AAA — excellent, keep |
| `--gold` | `#c9a84c` | **8.45 : 1** | AAA — excellent on dark |
| `--gold-light` | `#e4c472` | 11.43 : 1 | AAA |
| `--green` | `#2ecc71` | 9.19 : 1 | AAA |
| `--blue` | `#5dade2` | 7.86 : 1 | AAA |
| `--today` | `#e67e22` | 6.78 : 1 | AA |
| `--purple` | `#9b59b6` | 4.14 : 1 | **fails body text** |
| `--danger` | `#c0392b` | 3.55 : 1 | **fails body text** |
| `--muted` | `#6b6860` | 3.47 : 1 | **fails body text** |
| `--past` | `#555555` | 2.59 : 1 | **fails everything** |

Two things follow. The dark-and-gold core is **genuinely good** and must be
kept. But **danger, muted and past — the colours that carry errors, secondary
text and disabled state — fail contrast**, and those are exactly the places
where failure costs a user the most.

**RECOVERED — the best existing idea.** Six semantic colours each pair a solid
with a **12 %-alpha `-dim` companion**, applied uniformly. This is the single
strongest piece of systematic design thinking in the whole portfolio. It should
be promoted from a convention to a rule.

### 3.2 The measured finding that shapes everything

**RECOVERED — measured this stage.** Every gold in the Mythos world fails on a
light ground:

| Gold | On ink `#0E0E0E` | On paper `#F5F3EF` |
|---|---|---|
| UI gold `#c9a84c` | 8.45 : 1 | **2.06 : 1** |
| Historical mid `#d9a441` | 8.58 : 1 | **2.03 : 1** |
| Historical light `#f8d276` | 13.30 : 1 | **1.31 : 1** |
| Historical dark `#ab7e2f` | 5.29 : 1 | 3.29 : 1 — large text only |

Holding the historical hue (39°) constant and sweeping lightness, the crossover
point where one value serves both grounds is around `#996E1F` — **4.12 : 1 on
paper and 4.23 : 1 on ink**, mediocre on both and beautiful on neither.

> **The conclusion is technical, not aesthetic: one gold cannot serve both
> grounds. The system needs a gold *per ground*.**

This is why the identity feels dark-native — because it is. The proposal below
accepts that instead of fighting it.

### 3.3 PROPOSED — the architecture

**Two grounds, both first-class.** Ink is the primary world (it is where the
logo lives and where Mythos OS already is). Paper is not an afterthought — it
is where documents, invoices, print and half the public web live.

**A warm neutral ramp, not grey.** Every neutral carries a slight warm bias
toward the gold, so the palette reads as chosen rather than defaulted. Twelve
steps, derived from the recovered `#0e0e0e` and `#e8e4dc`:

| Token | Value | Role |
|---|---|---|
| `ink-900` | `#0B0B0A` | deepest ground, full-bleed |
| `ink-850` | `#0E0E0D` | **primary dark ground** — recovered `--bg` |
| `ink-800` | `#161614` | raised surface — recovered `--surface` |
| `ink-750` | `#1D1D1B` | card — recovered `--card` |
| `ink-700` | `#2A2A27` | border on dark — recovered `--border` |
| `ink-600` | `#3A3934` | strong border, dividers |
| `ink-500` | `#55534B` | secondary text **on paper** (6.95 : 1) |
| `ink-400` | `#7A776C` | **non-text only** — disabled glyphs, hairlines (4.31 : 1) |
| `ink-300` | `#A8A498` | secondary text **on ink** (7.75 : 1) |
| `ink-200` | `#CFCBC0` | subtle text on ink, dividers on paper |
| `ink-100` | `#E8E4DC` | **primary text on ink** — recovered `--text`, 15.22 : 1 |
| `paper` | `#F5F3EF` | **primary light ground** |

The single most valuable fix here: **secondary text routes to `ink-300`
(7.75 : 1) instead of the recovered `--muted` (3.47 : 1)**, and `ink-400` is
demoted to non-text use. That closes the failure without changing the feel.

**Semantic colours, re-tuned to pass on both grounds** (PROPOSED):

| Role | On ink | Ratio | On paper | Ratio |
|---|---|---|---|---|
| success | `#4ADE80` | 11.08 : 1 | `#15803D` | 4.53 : 1 |
| warning | `#F0A342` | 9.22 : 1 | `#8A5A0B` | 5.34 : 1 |
| danger | `#F1706A` | 6.68 : 1 | `#B02A20` | 5.93 : 1 |
| info | `#7DC4EA` | 10.08 : 1 | `#1D6FA5` | 4.90 : 1 |
| accent-2 | `#B98BD0` | 7.05 : 1 | `#6D3F86` | 7.00 : 1 |

Each keeps a **12 %-alpha `-dim` companion**, preserving the recovered
convention exactly. The hues stay in the recovered family — this is a
correction, not a replacement.

**Data / visualisation palette** (PROPOSED): gold leads, then a sequence chosen
for hue separation *and* for distinguishability under the three common colour
vision deficiencies — `#C9A84C · #7DC4EA · #4ADE80 · #B98BD0 · #F0A342 ·
#6FB3A8 · #E8846F · #8E9BD4`. Categorical series never rely on hue alone;
shape or label carries the same information.

### 3.4 OPEN DECISION — GOLD-1

**Not resolved here.** Three coherent routes, with what each costs:

| Route | Master gold | What it means | Cost |
|---|---|---|---|
| **A — Heritage** | `#D9A441` (historical centre) | The brand returns to the logo's own gold. Also equals Uthina Chess Imperial Gold | Mythos OS's 252 token occurrences drift from the master until migrated |
| **B — Continuity** | `#c9a84c` (current UI gold) | The implemented value becomes the master; the historical gradient stays a historical artifact | Zero migration. The master brand's gold is then a value with **no recorded rationale** (U-001) |
| **C — Two-tier** | `#D9A441` identity · `#c9a84c` interface | Explicit domains: identity/print/signage vs product UI | Two values to govern; risk of drift if the boundary is not policed |

**PROPOSED recommendation — CHANGED in this revision.**

Revision 1 recommended **Route B** (continuity), and the reasoning leaned on
migration cost: 252 token occurrences already carry `#c9a84c`. The owner has
since stated the criterion plainly — *do not optimise the identity merely to
match existing Mythos OS code; implementation inconsistencies may be corrected
later.* That removes the main argument I had used, so the recommendation is
restated rather than quietly left standing.

**On brand merit alone, the recommendation is now Route A — `#D9A441`, the
historical logo's own gold.**

The reasoning, in order of weight:

1. **It gives the master gold a recorded rationale.** The single most damning
   finding in the recovery audit is **U-001**: the defining colour of the
   product UI is a value whose meaning *is nowhere recorded*. A master brand
   whose primary colour cannot be explained is a liability that compounds — every
   future designer inherits an arbitrary constant. Route A ends that permanently:
   the gold is the gold in the mark. That is a sentence you can say to a client,
   a partner, or a new hire.
2. **It resolves a conflict instead of preserving it.** Conflict **C-003** — two
   unexplained golds — dissolves the moment the master value comes from the
   logo. Route B leaves C-003 open forever by ratifying the value that has no
   provenance.
3. **The measured cost of choosing it is close to zero.** `#c9a84c` and
   `#D9A441` differ by **0.13 : 1** in contrast on ink (8.45 vs 8.58) and are
   near-indistinguishable side by side. What changes is not how it looks; what
   changes is whether the brand can explain itself.
4. **Cross-portfolio coherence comes free.** `#D9A441` is also Uthina Chess's
   Imperial Gold — recovered evidence, already implemented and live. Route A
   turns an unexplained coincidence into a documented relationship.

**What Route A costs, stated honestly:** Mythos OS's implemented tokens then
differ from the master until migrated. That is a real migration, and it is
exactly the kind of correction the owner has said may happen later. It is also
a *token-level* change — one value, one search — not a redesign.

**Route C (two-tier)** remains available and is the pragmatic middle, but the
boundary between "identity gold" and "interface gold" is the kind of rule that
erodes without anyone deciding to erode it. I would not recommend governing two
golds unless a concrete need appears.

**This remains GOLD-1 and remains OPEN.** Nothing else in this proposal depends
on which route you take.

Whichever route wins, the ground-specific companion is required, not optional:
`gold-deep #8C651C` (**4.75 : 1** on paper) for gold text and icons on light
grounds. The bright gold remains permitted on paper for large non-text graphics.

---

## 4. Typography

### 4.1 What exists

**RECOVERED — counted this stage across `css/*.css`:** `Playfair Display`
appears in **45** declarations and `Inter` in **11**. So Mythos OS is, in
practice, a *Playfair Display display serif + Inter text* system — a real
typographic decision that was **never written down** (U-003).

**RECOVERED — the charters:** Uthina Chess uses Cinzel / Trajan with Noto Kufi
Arabic / Amiri / Cairo. Dar Hijama uses Noto Sans Arabic / Cairo / IBM Plex Sans
Arabic with Inter / Manrope. Neither ships font files.

### 4.2 The requirement

Arabic, French and English, RTL and LTR, bilingual layouts, dense data,
long-form documents, print, and small UI text — with licensing that costs
nothing to scale across nine-plus properties and self-hosting that removes an
external dependency.

**PROPOSED — the assessment that decides it:** Playfair Display is a
high-contrast fashion serif. It has no Arabic, and its thin strokes disappear at
the 11–13 px sizes this UI actually uses (**RECOVERED**: 12 px, 11 px and 13 px
are the three most common sizes in the codebase). It cannot carry a technical,
multilingual, international group. It should be retired from the master brand.

### 4.3 PROPOSED — the system

| Role | Face | Why |
|---|---|---|
| **Display** | **Archivo Expanded** (OFL, variable) | Its extended geometric proportions echo the wordmark directly. Headlines therefore look related to the logo without being set in it |
| **Text / UI** | **IBM Plex Sans** (OFL, variable) | Engineered, neutral without being anonymous, excellent at 11–14 px — the sizes actually in use. Not Inter, so not the default everyone reaches for |
| **Arabic** | **IBM Plex Sans Arabic** (OFL) | Designed as part of the same family. Arabic and Latin share proportions and colour — rare, and the difference between bilingual and merely translated. Already named in the Dar Hijama charter |
| **Data / code** | **IBM Plex Mono** (OFL) | Same family; tabular figures for financial and technical tables |

One designed family across Latin, Arabic and mono, plus a display face chosen to
relate to the mark. All open-source, all self-hostable, no licence cost at any
scale.

**Scale** (PROPOSED, 1.25 ratio, 16 px base):

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
| Label | 12 / 1.34 | **+0.10em**, uppercase | Plex 500 |
| Data | 14 / 1.44 | 0, tabular figures | Plex Mono 400 |

**Arabic compensation** (PROPOSED, and the detail most bilingual systems get
wrong): Arabic set at an identical size reads visually smaller and its
diacritics need vertical room. Every Arabic style therefore takes **+6 % size
and +0.15 line-height**, and **letter-spacing is forced to 0** — tracking breaks
Arabic joining and is a correctness bug, not a style choice.

Running text is capped near **65 characters**. Headlines take
`text-wrap: balance`.

---

## 5. Grid and spacing

**RECOVERED:** the codebase has **six ad-hoc breakpoints** (700, 720, 760, 768,
900, 1100 px). There is no scale of any kind.

**PROPOSED — an 8-point system with 4 px half-steps:**

`2 · 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 · 96 · 128 · 160`

Section rhythm uses only 48 / 64 / 96 / 128. Component padding uses only
8 / 12 / 16 / 24. Nothing else is legal — that constraint is what makes a
system feel composed rather than assembled.

**Breakpoints defined by content behaviour, not devices** (PROPOSED):

| Name | Range | What changes |
|---|---|---|
| `sm` | < 600 | Single column. Navigation collapses. Tables become cards |
| `md` | 600–903 | Two columns. Sidebars become sheets |
| `lg` | 904–1239 | Three columns. Persistent sidebar returns |
| `xl` | 1240–1919 | Full 12-column grid at max content width |
| `2xl` | ≥ 1920 | Grid stops growing; margins absorb the surplus |

**Containers:** content max **1280**, wide **1440**, prose max **68ch**.
12 / 8 / 4 columns with 24 / 20 / 16 gutters and 80 / 48 / 20 margins.

---

## 6. Shapes and surfaces

**RECOVERED:** the codebase contains **twelve different `border-radius` values**
(2, 6, 7, 8, 10, 12, 14, 16, 20, 50 %, 99, 999 px). There is no shape language.

**PROPOSED — a four-step radius scale, argued from the mark itself:** the
wordmark has **flat terminals and sharp corners**, so the identity argues for
*low* radius. This also puts distance between Mythos and the softly-rounded look
that every AI-generated interface currently shares.

| Token | Value | Applies to |
|---|---|---|
| `radius-0` | 0 | Tables, data cells, full-bleed media, the 35° cut |
| `radius-1` | **2 px** | The workhorse — inputs, buttons, chips, small cards |
| `radius-2` | 6 px | Cards, panels, menus |
| `radius-3` | 12 px | Modals, sheets, app tiles |
| `radius-full` | 999 px | Avatars and status dots **only** |

**Elevation by surface, not by shadow** (PROPOSED, extending the recovered
convention): depth is expressed by stepping `ink-850 → ink-800 → ink-750` with a
1 px `ink-700` hairline. Drop shadows are reserved for things that genuinely
float above the page — menus, modals, toasts — and never used to decorate a
static card. This is already how Mythos OS behaves; it is being made a rule.

**The signature shape:** a **35° cut** on one edge of one element per view —
a section divider, an image mask, a hero corner, a chart's leading bar. Never
two.

---

## 7. Iconography

**RECOVERED:** none exists. The only vector artwork in the CSS is three inline
gold chevrons for form controls.

**PROPOSED:**

- **24 px grid**, 2 px stroke, **square terminals and square joins** — matching
  the wordmark's flat terminals, and a deliberate departure from the rounded
  caps used by almost every icon library.
- Sizes 16 / 20 / 24 / 32; stroke stays 2 px at 24 and below, 2.5 px at 32.
- Corner radius inside icons: 1 px maximum. Geometry is built from circles,
  squares and 45°/35° lines.
- **Any diagonal in an icon snaps to 35°** where the geometry allows — that is
  what makes the set unmistakably Mythos rather than generic.
- Two weights only: regular, and filled for selected states.
- Icons never carry meaning alone; every icon-only control needs an accessible
  name.

---

## 8. Imagery and art direction

**RECOVERED:** no imagery direction exists anywhere in the portfolio.

**PROPOSED — the subject is the work.** Real production, real workshops, real
machines, real people working in Tunisia. Not stock offices, not handshakes, not
laptops on white desks. This is the cheapest and most durable way for a group
whose business is *making things* to look unlike a software startup.

- **Treatment:** deep blacks that meet `ink-850` so images can bleed into the
  ground; warm-neutral grade consistent with the palette; high micro-contrast;
  no heavy filters, no duotone gimmicks.
- **Ratios:** 16:9 (hero), 3:2 (editorial), 4:5 (portrait, mobile), 1:1 (grid).
- **Overlay rule:** text over an image always sits on a scrim reaching **at
  least 4.5 : 1** against the text — measured, not eyeballed.
- **The signature:** one image per page may take the **35° mask**.
- **Illustration:** used only for explaining systems and processes — flat,
  two-colour, built from the icon geometry. Never decorative spot art.

**PROPOSED — AI-generated imagery governance**, stated plainly because the
absence of a rule is how brands get into trouble:

1. Permitted for abstract texture, backgrounds and non-representational
   material.
2. **Never** for depicting real people, real clients, real facilities, real
   products, or anything a viewer would reasonably read as documentary.
3. Any AI-generated asset is labelled as such in its source filename and in the
   asset register.
4. Never used to fabricate evidence of work, capability or scale.

---

## 8b. Design-token philosophy

**PROPOSED — philosophy only. No token file was written; that is Stage 1E.**

The owner named a *simplified* token philosophy as something to keep, so the
proposal states the philosophy and deliberately stops short of the inventory.

**Three tiers, and nothing may skip a tier.**

```
GLOBAL      raw values, named for what they are        gold-500, ink-850, space-6
   ↓        (a component may never reference these)
SEMANTIC    named for what they mean                   text-primary, ground, accent,
   ↓        (this is the layer designers argue about)   border-subtle, focus-ring
COMPONENT   named for where they act                   button-bg, card-border
```

Five rules, chosen because each one prevents a specific failure this repository
already demonstrates:

1. **No hardcoded visual values in components.** The recovered codebase has
   twelve radius values and eight durations precisely because nothing forced a
   scale (**RECOVERED**).
2. **Components consume semantic tokens, never global ones.** A button asking
   for `gold-500` locks the brand's colour into the button; a button asking for
   `accent` survives GOLD-1 being decided either way. This is what makes an
   *open* decision safe to leave open.
3. **Every token has exactly one reason to change.** If two things must always
   move together they are one token; if they may diverge they were always two.
4. **Theme is a token remap, never a component fork.** Dark and light differ by
   the values behind the same semantic names — no `.dark-button`.
5. **The set stays small enough to hold in your head.** A semantic layer of
   roughly 40–60 tokens is a system; 300 is a dictionary nobody reads.

**The test:** deciding GOLD-1 should change **one global value** and nothing
else. If it would require touching components, the token architecture is wrong.

---

## 9. UI language

**PROPOSED**, extending what Mythos OS already does well:

- **Dark-first, light-complete.** Ink is the default; paper is fully specified,
  not a filter over the dark theme.
- **Two densities.** *Comfortable* for content and marketing; *compact* for
  data-dense operational views, reducing vertical padding one step on the
  spacing scale — never reducing type below 13 px or targets below 44 px.
- **Status is form plus colour.** A chip, a severity stripe or a leading rule
  carries state alongside the `-dim` background — never colour alone.
- **The `-dim` rule** (RECOVERED, promoted): every semantic colour has a
  12 %-alpha companion for backgrounds. Solid for the mark, dim for the field.
- **Focus is never removed:** 2 px gold outline, 2 px offset, measured at
  8.45 : 1 on ink and 4.75 : 1 on paper — both above the 3 : 1 that WCAG 2.2
  requires.
- **Controls say what happens.** A button reads `Publish`; the toast that
  follows reads `Published`. Errors state what went wrong and how to fix it.
- **Empty and error states are designed**, not left to a bare string — they are
  where a product feels finished or unfinished.

---

## 10. Motion

**RECOVERED:** eight ad-hoc transition durations exist (.1, .12, .15, .2, .22,
.25, .28, .3 s), `.15s` being the most common. No easing system.

**PROPOSED — five durations, three easings:**

| Token | Duration | Use |
|---|---|---|
| `motion-micro` | 120 ms | Hover, focus, checkbox — anything under the pointer |
| `motion-base` | 180 ms | Standard state change. Nearest to the recovered `.15s` |
| `motion-enter` | 240 ms | Elements arriving |
| `motion-overlay` | 320 ms | Modals, sheets, drawers |
| `motion-page` | 480 ms | Route transitions, orchestrated sequences only |

Easing: `enter cubic-bezier(0.2, 0, 0, 1)` · `exit cubic-bezier(0.4, 0, 1, 1)` ·
`move cubic-bezier(0.4, 0, 0.2, 1)`. No springs, no bounce — they read as
playful, and this brand is not.

**The signature (PROPOSED):** elements enter by travelling **along the 35°
vector** — roughly 10 px up-and-right, decelerating, with a fade. Not straight
up. One element per view does this; everything else simply fades. It is a small
thing that makes a page feel authored rather than assembled.

**Rules:** motion must communicate a state change, a hierarchy or a continuity —
never decoration. Nothing loops. Nothing autoplays. Under
`prefers-reduced-motion`, all transforms collapse to opacity and durations drop
to `motion-micro`; **the interface must remain fully legible and complete with
animation disabled**, which is also the owner's stated requirement.

---

## 11. Responsive principles

**PROPOSED:**

- **Mobile is a design target, not a shrink.** Every layout is drawn at `sm`
  first, and the desktop layout must justify what it adds.
- **Navigation:** `xl` horizontal bar with an ecosystem panel exposing the three
  tiers; `sm` full-screen overlay that **preserves the same tier structure** —
  the architecture must be legible on a phone.
- **Tables** become stacked cards below `md`, with the primary column as the
  card title. Wide content always scrolls inside its own container; the page
  body never scrolls sideways.
- **Type** scales fluidly with `clamp()` between the scale's defined stops —
  never below 16 px for body on any viewport.
- **Touch** targets 44 × 44 minimum with 8 px separation, on every breakpoint —
  not only the small ones.
- **Sidebars** become sheets at `md`, and modals become full-screen at `sm`.

---

## 12. Accessibility

**PROPOSED — WCAG 2.2 AA as the floor, AAA for body text where achievable.**
Accessibility is part of the system, not a review step; the palette in §3 was
*derived* from contrast measurement rather than checked afterwards.

- **Contrast:** body text AAA on ink (15.22 : 1) and AA+ on paper. Every
  semantic colour measured on both grounds (§3.3). Non-text UI and focus
  indicators ≥ 3 : 1.
- **Keyboard:** every interactive element reachable and operable; visible focus
  always; skip links; focus trapped in modals and returned on close; no
  keyboard traps.
- **Screen readers:** semantic HTML first; landmarks; one `h1`; accessible names
  on all icon-only controls; live regions for async status.
- **RTL:** CSS logical properties throughout — never `left`/`right`. Layout
  mirrors; **numbers, media controls, logos and the M's slant do not mirror.**
  The slant direction is part of the mark's identity and is fixed in both
  directions.
- **Bilingual:** correct `lang` and `dir` per element, not per page, so mixed
  Arabic/French content reads correctly.
- **Forms:** visible persistent labels (never placeholder-as-label), errors
  linked programmatically to their field, error text never colour-only.
- **Motion:** `prefers-reduced-motion` honoured system-wide.
- **Also supported:** `forced-colors` mode, 200 % zoom without loss of content,
  and 320 px reflow.

---

## 13. MYTHOS and its five units

**Owner-approved (A-003):** units use the master identity plus a descriptor;
five unrelated logos must not be created.

**PROPOSED — and this is the opinionated call in the document: give the units
no colour of their own, in v1.**

The instinct is to hand each unit an accent — OS blue, Logistique green, and so
on. I recommend against it. Five accents is precisely how a young master brand
dissolves into five weak ones, and Mythos does not yet have the recognition to
spend. Recognition compounds fastest when every unit reinforces the same gold.

Units therefore differ by exactly four things:

| Dimension | How it varies |
|---|---|
| **Descriptor** | The one word in the lockup |
| **Imagery** | Its own subject matter — machines, screens, vehicles, workshops |
| **Density and component emphasis** | OS is data-dense; Prod is image-led; Logistique is table-led |
| **Content personality** | Tone of voice within one brand voice |

Everything else — mark, gold, type, grid, spacing, radius, icons, motion,
accessibility — is identical and non-negotiable.

### 13.1 How each unit actually differs — the six expressions

**PROPOSED.** If units share the mark, the gold, the type and the grid, the
question a reviewer will rightly ask is: *then what makes Mythos Logistique feel
different from Mythos Digital?* The answer is that differentiation moves from
**colour** to **structure, subject and density** — which is both more durable
and harder to counterfeit than a hue.

| | Descriptor | Subject of imagery | Density | Dominant component | Reads as |
|---|---|---|---|---|---|
| **MYTHOS** | *(none — the master)* | The group, its people, its scale | Comfortable | Editorial section, full-bleed image | Authority. The parent |
| **Mythos OS** | `OS` | Screens, data, systems in use | **Compact** | Table, panel, command surface | Precision. The instrument |
| **Mythos Prod** | `PROD` | Production, sets, crews, machines at work | Comfortable, **image-led** | Full-bleed media, project card | Craft. The maker |
| **Mythos Services** | `SERVICES` | People, workshops, hands, delivery | Comfortable | Service card, process step | Reliability. The promise |
| **Mythos Digital** | `DIGITAL` | Interfaces, motion, built work | Comfortable | Case study, before/after | Capability. The proof |
| **Mythos Logistique** | `LOGISTIQUE` | Vehicles, routes, warehouses, movement | **Compact** | Table, status chip, timeline | Certainty. The operation |

Two units run **compact** density (OS, Logistique) because both are operational
and data-dense; the other four run comfortable. That single variable does more
perceptual work than five accent colours would, and it is *derived from what the
unit actually does* rather than assigned arbitrarily.

The 35° gesture appears in all six, but on different objects: a section divider
for the master, a chart's leading bar in OS, an image mask in Prod, a timeline
head in Logistique. **Same gesture, different carrier** — this is what a family
resemblance looks like when it is designed rather than painted on.

### 13.2 A public project carrying Mythos DNA without the Mythos skin

**PROPOSED — the clearest way to explain A-004 and A-006 to anyone.**

Take the strongest recovered example, **Uthina Chess** — the one project in the
portfolio whose written charter is demonstrably implemented (**RECOVERED**):
nine official colours led by Imperial Gold `#D9A441`, Cinzel/Trajan display,
Noto Kufi Arabic, a documented Hero → Details → Registration hierarchy.

| Stays entirely the project's own | Inherited from Mythos, invisibly |
|---|---|
| Imperial Gold and the nine-colour palette | The accessibility floor — contrast measured, not assumed |
| Cinzel / Trajan / Noto Kufi Arabic | Focus behaviour and keyboard operability |
| The chess-and-Roman visual world | Responsive breakpoints defined by content |
| Its own logo and favicon | The spacing rhythm and component principles |
| Its tone, imagery and page hierarchy | Performance budget and QA process |
| Its customer relationship | Governance: how a change gets reviewed |

**The test of whether this is working:** a visitor to `uthinachess.tn` should
never be told what to feel about Mythos — and a developer moving between
`uthinachess.tn` and `fixpert.tn` should find the same focus ring behaviour, the
same spacing logic and the same accessibility floor.

**Mythos DNA is a floor, not a look.** That distinction is the whole of A-006,
and it is why a project can be visually independent and still unmistakably well
made. The only visible Mythos presence is a discreet footer endorsement — and
even its form is **O-A6**, still open.

**Governed extension path:** if a real business need for unit accents appears
(for example two units sharing a screen and needing to be told apart at a
glance), they are introduced as a governed extension — one accent per unit drawn
from the §3.3 data palette, permitted **only** for charts, chips and 1 px rules,
and **never** for a header, a logo lock-up or a page ground. That constraint is
what would keep an extension from becoming a re-skin.

**Public projects** keep their own identities entirely, per the approved
**A-004** and **A-006**. Whether a project may ever use a Mythos-level colour is
**O-A3** and remains **OPEN DECISION** — nothing above assumes an answer.

---

## 14. Open decisions — unchanged by this proposal

| Ref | Question | State |
|---|---|---|
| **GOLD-1** | Historical logo gold vs Mythos OS UI gold | **OPEN.** §3.4 measures the routes. Recommendation **changed this revision** to Route A on brand merit, after the owner removed migration cost as a criterion. It does not decide |
| **O-A1** | Classification of Mythos Command Center | **OPEN.** Untouched. Note only that its indigo `#4f46e5` is outside the palette above, so its placement has a visual consequence |
| **O-A3** | May a public project use a Mythos-level colour? | **OPEN.** Untouched |
| **LOGO-1** | Does a vector master exist outside Git? | **OPEN.** Pending task, blocked on environment access |
| **LOGO-2** | Adoption of the 1B reconstruction | **OPEN.** Depends on LOGO-1 |
| **New — TYPE-1** | Retire Playfair Display from the master brand? | **PROPOSED** in §4.2, requires your decision — it affects 45 existing declarations |
| **New — SEM-1** | Adopt the re-tuned semantic palette? | **PROPOSED** in §3.3. Fixes three measured contrast failures; touches the Mythos OS token block |

---

## 15. What this proposal is not

- **Not a design system.** No token file, no component library, no stylesheet was
  written. Those are 1D–1F, and only on your approval.
- **Not implemented.** No code, CSS, asset, logo or website was modified. The
  historical logos are untouched.
- **Not a logo change.** Per **A-007**, nothing was redrawn, recoloured or
  recreated.
- **Not a decision on GOLD-1, O-A1 or O-A3.**

**1C remains NON-APPROVED after this revision.** Nothing above was converted
into a decision, and the seven review items listed in §0.1 all remain proposals.

**Suggested sequence if you approve the direction:** settle GOLD-1, TYPE-1 and
SEM-1 → **1D** writes `COLOR_SYSTEM.md` and `TYPOGRAPHY.md` → **1E** the token
architecture and grid → **1F** the component system. O-A1 should be settled
before 1H, because the hub's information architecture depends on it.

**One sequencing note worth acting on early:** §8b's second rule — components
consume semantic tokens, never global ones — means the token architecture can be
built **before** GOLD-1 is settled. Deciding the gold then changes one value.
That removes GOLD-1 from the critical path of 1E, so an open decision need not
hold up the work.
