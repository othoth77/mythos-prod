# MYTHOS Brand Architecture

**Stage:** MYTHOS-DESIGN-1A — brand architecture
**Date:** 2026-08-18 UTC
**Status:** **PROPOSAL — awaiting owner validation.** No production file implements
anything below. This document defines structure and rules; it applies none of them.
**Companions:** `docs/design/LOGO_SYSTEM.md` (the mark that carries this
architecture) · `docs/MYTHOS_DESIGN_RECOVERY.md` (evidence) ·
`docs/MYTHOS_DESIGN_DECISIONS.md` (decision register) ·
`docs/MYTHOS_PROJECT_DESIGN_MATRIX.md` (per-project state).

Two things are kept strictly apart throughout. **Owner direction** is what the
ecosystem is intended to become. **Evidence** is what the repository and VPS
actually contain today. Where they diverge, both are shown. Nothing intended is
written as though it already exists.

---

## 1. The starting position, stated plainly

The recovery audit found a **flat portfolio**, not a hierarchy. Nine live or
built products, each with its own domain and its own visual language, and
**nothing anywhere identifying any of them as belonging to Mythos** — no shared
header, no endorsement mark, no "a Mythos project" string in the tracked corpus.
The master domain `mythosprod.xyz` has no apex site at all.

So this stage is not documenting an architecture that exists. It is defining the
one the portfolio will be brought into, and naming honestly how far each part is
from it.

## 2. Three tiers

```
TIER 1   MYTHOS                        the master brand
         │
TIER 2   ├── Mythos OS                 endorsed business units —
         ├── Mythos Prod               they ARE Mythos, wearing its mark
         ├── Mythos Digital
         ├── Mythos Services
         └── Mythos Logistique
         │
TIER 3   └── AgriBee · Dar Hijama · Fixpert · ID Auto · Mouain ·
             Notre Jour · SsangYong.autos · Uthina Chess · future
                                       independent products —
                                       they BELONG TO Mythos without wearing it
```

The distinction between tier 2 and tier 3 is the whole architecture, and it is a
distinction of **kind, not of size**:

- A **business unit** is Mythos doing something. It has no separate identity to
  protect. It wears the Mythos mark and differs only by descriptor.
- A **project** is a product with its own market, its own audience and often its
  own customers. Uthina Chess sells to chess players; Dar Hijama to households
  seeking home care. Forcing the Mythos mark onto them would weaken both.

This is the direct application of the owner's principle: **one Mythos design
system, individual project personality.**

## 3. Tier 1 — MYTHOS, the master brand

MYTHOS is the master brand. **Not "Mythos Prod."**

`Mythos Prod` survives as the name of one business unit and as the historical
repository name (`othoth77/mythos-prod`, the initial-import commit subject
`d1a9d19`). It no longer controls the master identity.

The master brand owns: the wordmark, the M symbol, the construction grid, the
colour system, the typography, the spacing scale, the component principles, the
accessibility floor and the governance rules. Everything below inherits from it.

**Current state — EVIDENCE:** a wordmark exists (now as vector masters, Stage 1B,
pending validation). No apex site exists at `mythosprod.xyz`; only three
subdomains are served (`panel`, `tv` → Jellyfin, `ordre` → Command Center).

## 4. Tier 2 — endorsed business units

### 4.1 How a unit shows it is Mythos

Through the lockup defined in `docs/design/LOGO_SYSTEM.md` §6: the constant
MYTHOS wordmark over a single-word descriptor.

```
        MYTHOS
   ──  OS · PROD · DIGITAL · SERVICES · LOGISTIQUE  ──
```

This is not a new invention — it is the original MYTHOS / PROD lockup
generalised. That the original already had this shape is the strongest evidence
available that an endorsed structure was always the intent.

### 4.2 What a unit may vary, and what it may not

| May vary | May **not** vary |
|---|---|
| Its descriptor word | The wordmark, its geometry, its proportions |
| A secondary accent colour, drawn from the master palette | The master brand colours, type system or spacing scale |
| Imagery and art direction appropriate to its work | The component library, accessibility floor, responsive standards |
| Content personality and tone | Its right to a separate logo — **a unit never gets one** |
| Which parts of the UI it emphasises | The governance rules |

**A business unit never receives an independent logo.** Five unrelated logos is
precisely the outcome the owner directive forbids, and it is what the portfolio
already suffers from at tier 3 (four projects, four unrelated palettes, no
shared token).

### 4.3 The five units, against the evidence

| Unit | Owner direction | Evidence found | Honest state |
|---|---|---|---|
| **Mythos OS** | Platform / product | **VERIFIED extensively** — `docs/mythos-os-blueprint.md`, `docs/mythos-os-platform.md`, the implemented `css/` + `js/core/` system, 252 CSS custom properties | Real, mature, the only implemented design system in the portfolio |
| **Mythos Prod** | Production | **VERIFIED as a name only** — repository name, `d1a9d19` commit subject | Real as a name; no brand, no site, no design |
| **Mythos Digital** | Digital services | **NO EVIDENCE OF ANY KIND** | Owner direction only |
| **Mythos Services** | Services | **NO EVIDENCE OF ANY KIND** | Owner direction only |
| **Mythos Logistique** | Logistics | **NO EVIDENCE OF ANY KIND** | Owner direction only |

Three of five units exist today only as owner direction. The architecture is
built to hold them, and lockup masters exist for all five — but this document
does not claim they are businesses in operation, and no later stage should cite
it as though it did. This is open question **O-004** in the decision register.

### 4.4 Mythos Command Center — an unplaced product

`ordre.mythosprod.xyz` is **live** and serves the Mythos AI Command Center. It is
a Mythos-level product, it sits on a Mythos subdomain, and it is **absent from
the owner's five-unit list**. It also carries its own unrelated palette
(light ground `#f6f7f9`, indigo `#4f46e5`) — a third divergent Mythos-level
visual language alongside Mythos OS's dark-and-gold.

Left open deliberately, as **O-A1** (§9). The architecture cannot silently
absorb a live product; where Command Center sits — a product *of* Mythos OS, or
a unit in its own right — is an owner decision.

## 5. Tier 3 — public projects

### 5.1 The relationship rule

Projects inherit the **system**, not the **skin**.

| Shared with Mythos — non-negotiable | Independent to the project |
|---|---|
| Accessibility floor (contrast, keyboard, focus, touch targets, RTL) | Colour palette |
| Responsive standards and breakpoint behaviour | Imagery and art direction |
| Spacing and layout principles | Emotional tone |
| Component principles and interaction patterns | Project logo |
| Technical quality, performance budgets | Content hierarchy |
| Governance, review and QA process | Brand personality |

A visitor to `uthinachess.tn` should never be told what to feel about Mythos. A
developer moving between `uthinachess.tn` and `fixpert.tn` should find the same
spacing logic, the same focus behaviour and the same accessibility floor.

### 5.2 Where Mythos appears on a project

Three permitted places, and nowhere else:

1. A discreet endorsement in the footer — the M symbol or wordmark at small
   size, with a link.
2. The project's entry on the `mythosprod.xyz` hub.
3. Commercial and legal documents, where the operating entity is named.

Never in the project's header, never in its favicon, never co-locked with the
project's own logo.

### 5.3 Existing project identities are historical work and are preserved

Two projects have real, recovered brand charters. Neither may be overwritten by
this architecture:

- **Uthina Chess** — nine official colours, three font stacks, a documented page
  hierarchy, and a charter that is **demonstrably implemented** in
  `uthina-theme.css`. The only project in the portfolio where a written charter
  reached production. It is the portfolio's benchmark, not a candidate for
  replacement.
- **Dar Hijama** — a complete charter with a house-and-cup concept, a six-colour
  palette, clear-space and minimum-size rules, and fifteen asset files including
  the portfolio's only full SVG suite.

**Dar Hijama carries an unresolved conflict (C-1).** Its charter specifies green
`#16A34A` and turquoise `#14B8A6`; its live site uses cream tones plus
`#c9a84c` — **the Mythos OS gold** — and not one charter colour appears. This is
simultaneously the only real-world evidence that a Mythos-level colour was ever
applied across projects, and the clearest case of a project ignoring its own
charter. Which artifact is authoritative is **UNKNOWN** and is owner question
**O-002**. This document does not resolve it and must not be read as having
chosen the live site.

### 5.4 Project state at the time of writing

| Project | Domain | Served | Own identity | Note |
|---|---|---|---|---|
| Uthina Chess | `uthinachess.tn` | live | **Complete and implemented** | Portfolio benchmark |
| SsangYong | `ssangyong.autos` | live | Partial — logo, no charter | Mature build; **out of scope, do not touch** |
| Dar Hijama | `darhijama.tn` | live (proxied) | Complete but unimplemented | Conflict C-1 / O-002 |
| Fixpert | `fixpert.tn` | live | Partial — logo only | Built, undocumented |
| Notre Jour | `notrejour.tn` | live | Unknown | 7 design files deferred since 2026-08-13 (O-005) |
| AgriBee | `agribee.tn` | **not served** | Partial — logo only | No vhost (O-007) |
| ID Auto | `idauto.tn` | **not served** | Missing | Internal admin UI only |
| Mouain | `mouain.tn` | **not served** | Missing | 1,787 lines of vision/pedagogy on an **unmerged branch**, invisible from `main` (O-006) |

## 6. Naming rules

Binding, per owner directive:

1. **MYTHOS is one word.** Never split as M + YTHOS, never with the final OS
   detached, never restyled to avoid the apparent repetition in "Mythos OS".
2. The platform is **Mythos OS** in prose. "OS" is a product descriptor, not a
   second logo inserted into the wordmark.
3. In the lockup the descriptor is **one word** — `MYTHOS` over `OS`. Never
   "MYTHOS OS" set as a descriptor, which would repeat the dominant element.
4. Units are written **Mythos <Unit>** in prose (Mythos Prod, Mythos Digital).
5. Projects are written under their **own** names. Never "Mythos AgriBee".
6. Capitalisation: `MYTHOS` in the mark, `Mythos` in running text.

## 7. Adding something new

The architecture only earns its keep if new entities need no redesign.

**A new business unit** needs: a one-word descriptor, a generated lockup
(`build-masters.py`, one line), and an optional secondary accent from the master
palette. **No new logo, no new type system, no new spacing scale.**

**A new project** needs: its own name, palette, logo and tone; and it inherits
the accessibility floor, responsive standards, spacing principles, component
principles and QA process unchanged. Before launch it must satisfy the shared
column of §5.1 — that is the entry condition, not a later cleanup.

**The test this architecture must pass:** adding a tenth project or a sixth unit
changes a configuration entry and adds content. It never triggers a redesign of
the hub, the system or any sibling.

## 8. What `mythosprod.xyz` must therefore be

Not a company landing page — an **ecosystem hub**, whose information
architecture is the direct expression of §2: the master brand, then the units,
then the projects.

Its structure must let a project be added without touching the design of any
other project or of the hub itself. Detailed IA belongs to sub-stage **1H**;
what is fixed here is only that the hub's structure follows the three tiers.

**Current state:** no apex vhost exists. The hub does not exist in any form.

## 9. Open decisions this stage does NOT settle

Named so no later stage mistakes silence for a decision.

| Ref | Question | Why it is not settled here |
|---|---|---|
| **O-A1** | Where does Mythos Command Center sit — a product of Mythos OS, or a sixth unit? | It is live, Mythos-level, absent from the owner's list, and carries a third divergent palette. Owner decision |
| **O-A2** | Do the three evidence-free units become real brands, and in what order? | Register **O-004**. The architecture holds them; it cannot conjure them |
| **O-A3** | Is Dar Hijama's charter or its live site authoritative? | Register **O-002** / conflict **C-1**. Resolving it also decides whether Mythos-level colour may reach a project's own palette — a precedent, not a detail |
| **O-A4** | Do the two recovered charters (Uthina, Dar Hijama) adopt the shared floor of §5.1 retroactively? | Touching live sites is out of scope for a design stage. Registers **O-009**, **O-010** |
| **O-A5** | Does Mouain's unmerged branch merge before it is placed in the architecture? | Register **O-006**. It is listed above because the owner named it, but it is invisible from `main` |
| **O-A6** | What endorsement appears in a project footer — symbol, wordmark, or a line of text? | Depends on the master colour and type decisions still open in 1D |

## 10. What this stage did not do

- Did not modify any project, site, stylesheet or asset.
- Did not resolve C-1, and did not declare either Dar Hijama artifact authoritative.
- Did not touch `projects/ssangyong-autos/deploy/`, MCC-1, or any running service.
- Did not merge, move or alter the Mouain branch.
- Did not create the `mythosprod.xyz` hub or any vhost.
- Did not apply endorsement to any project.
