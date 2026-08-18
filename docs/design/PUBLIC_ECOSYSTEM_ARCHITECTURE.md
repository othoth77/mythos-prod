# MYTHOS Public Ecosystem Architecture

**Stage:** MYTHOS-DESIGN-1H
**Date:** 2026-08-18 UTC
**Status:** **DOCUMENTATION / ARCHITECTURE ONLY. Nothing implemented.** No project
website, CSS, asset, token or Command Center file was touched.

**Authority:** **A-001**–**A-006** (brand architecture, 1A), **A-009**–**A-019**
(master visual identity, 1C), **A-020** (O-A1 — Command Center placement),
**A-021** (O-A3 — colour usage policy). Completed inputs: 1D `COLOR_SYSTEM.md`
and `TYPOGRAPHY.md`, 1E `GRID_AND_SPACING.md` and `DESIGN_TOKENS.md`, 1F
`COMPONENT_SYSTEM.md`, 1G `RESPONSIVE_ACCESSIBILITY_MOTION.md`.

**No new visual decision is introduced.** This document describes *relationships*
— who endorses whom, what appears where, and which domain carries which identity.
Every colour, type, spacing, component and motion value stays exactly as already
approved or already recorded.

---

## 0. Labels

| Label | Meaning |
|---|---|
| **OWNER-APPROVED** | Appears in an owner-approved decision. Cited |
| **DERIVED** | Follows from approved decisions plus recorded evidence. **No new decision** |
| **PROPOSED** | A new decision recommended here. **Not approved.** Rejectable on its own |
| **OPEN** | No decision exists and none is made. Carries a reference |

**Project status vocabulary**, used strictly and only from evidence already in
`MYTHOS_PROJECT_DESIGN_MATRIX.md` and `MYTHOS_DESIGN_RECOVERY.md`:

| Status | Means |
|---|---|
| **LIVE** | A vhost or proxy serves it, per the recovered live-service map |
| **BUILT / EXISTING** | Code and assets exist in the repository or on the host, but nothing serves it |
| **PLANNED** | Named in an approved decision or a recorded plan; no code found |
| **FUTURE** | Anticipated by **A-004** as "future projects"; does not exist yet |
| **UNKNOWN** | Evidence is absent or contradictory. **Recorded as unknown, never guessed** |

---

## 1. The ecosystem as it actually is

**Evidence-based. No project is described as live unless the recovered
live-service map shows something serving it.**

### 1.1 Public projects — the eight named by the owner

| Project | Domain | Status | Evidence |
|---|---|---|---|
| **Uthina Chess** | `uthinachess.tn` | **LIVE** | static `/var/www/uthinachess`; brand kit implemented, 9 colours, 3 font stacks |
| **SsangYong.autos** | `ssangyong.autos` | **LIVE** | static `/var/www/ssangyong.autos`; logo present, **no charter** |
| **Fixpert** | `fixpert.tn` | **LIVE** | static `/var/www/fixpert.tn`; `styles.css` 11.7 KB; logo only, no charter |
| **Notre Jour** | `notrejour.tn` | **LIVE** | Laravel `/var/www/notrejour`; blueprint **uncommitted / deferred** |
| **Dar Hijama** | `darhijama.tn` | **LIVE** (proxied) | proxy `127.0.0.1:18081`; static vhost **disabled 2026-07-29**. Charter complete but **unimplemented** — **C-001 / O-002** |
| **AgriBee** | `agribee.tn` | **BUILT / EXISTING** | Files and logo exist; `index.html` + `recherche/` **uncommitted**; **no vhost** — **O-007** |
| **ID Auto** | `idauto.tn` | **BUILT / EXISTING** | Internal admin implemented; **no vhost** |
| **Mouain** | `mouain.tn` | **BUILT / EXISTING** | **1,787 unmerged lines**, invisible from `main`; **no vhost** — **O-006** |

**Five live, three built but unserved.** Under **A-004** all eight remain
independently branded regardless of status.

### 1.2 Mythos platform and units

| Entity | Domain | Status | Evidence |
|---|---|---|---|
| **MYTHOS** (master) | `mythosprod.xyz` | **NOT SERVED** | **No apex vhost exists** — **O-003** |
| **Mythos OS** | `os.mythosprod.xyz` | **BUILT / EXISTING** | 252 tokens, 8 CSS, 72 JS. **DNS resolves; not deployed** (MOS-1.1, `MYTHOS_OS_CONSOLE_ARCHITECTURE.md` §6) |
| **Mythos Command Center** | `ordre.mythosprod.xyz` | **LIVE** | proxy `127.0.0.1:3021`, running from the repository checkout |
| **Mythos Prod** | — | **UNKNOWN** | Name only (`d1a9d19`). Name in use, nothing else |
| **Mythos Services** | — | **UNKNOWN** | **NO EVIDENCE of any kind** — **O-004** |
| **Mythos Digital** | — | **UNKNOWN** | **NO EVIDENCE of any kind** — **O-004** |
| **Mythos Logistique** | — | **UNKNOWN** | **NO EVIDENCE of any kind** — **O-004** |

**Stated plainly because it shapes everything below: the master brand has no
public surface at all, and three of the five approved units have zero recovered
evidence.** **A-002** fixes the roster as a matter of owner intent; it does not
create evidence, and **O-004** — whether those three are operating brands or
organisational labels — remains open.

---

## 2. Master brand presence — DERIVED from A-001

**A-001:** MYTHOS is the master brand; **MYTHOS PROD is not** the primary master
identity, though it may remain a business-unit name.

MYTHOS is present in the ecosystem in exactly three ways:

1. **As itself** — the hub at `mythosprod.xyz` (§9), which does not yet exist.
2. **As an endorsement** — a controlled mark on a surface that belongs to
   something else (§6).
3. **As inherited system** — accessibility, responsive, spacing, component,
   performance and governance standards (**A-005**), which carry **no visual
   signature at all**.

**The third is the one that matters most and is the least visible.** A public
project can be fully Mythos-standard while showing nothing of the Mythos skin —
that is **A-006** working as designed, not a failure of consistency.

---

## 3. The five-unit hierarchy — OWNER-APPROVED

```
MYTHOS
├── Mythos OS
├── Mythos Prod
├── Mythos Services
├── Mythos Digital
└── Mythos Logistique
```

**A-002** fixes this roster. **A-003** governs how a unit is expressed: the
**MYTHOS master identity plus a descriptor**, and **five unrelated independent
logos must not be created**.

**The descriptor is a slot, not a design** (LOGO-2 proposal, §5) — word count,
case, size, tracking, colour, position and rule geometry are fixed; **only the
word changes**. That is what allows five units without five identities.

**Constraint carried forward, unresolved:** the descriptor system lives inside
the LOGO-2 proposal, which is **`PROPOSED — AWAITING OWNER APPROVAL`** and gated
on **LOGO-1**. **1H does not adopt it** and does not depend on it — the hierarchy
above is an architecture, not a drawing.

---

## 4. Mythos OS and the Command Center — OWNER-APPROVED (A-020)

```
MYTHOS → Mythos OS → Mythos Command Center → ordre.mythosprod.xyz
```

**A-020, verbatim in effect:** the Command Center is a **product of Mythos OS**,
not a sixth unit. The five-unit roster is unchanged. **A-003 does not apply to
it** — it takes **no `MYTHOS / <descriptor>` lockup of its own**, because it is
not an endorsed unit. It is branded as what it is: a product surface of Mythos OS.

**The product tier — DERIVED.** A-020 creates a fourth level below the unit tier,
and the Command Center is its first occupant. Any future Mythos OS product
inherits the same rule: **a product is named and never endorsed**, because
endorsement is a unit-level device.

### 4.1 One thing A-020 settles in brand terms but not in URL terms — OPEN, ECO-1

The **brand** hierarchy nests the Command Center **under** Mythos OS. The
**domain** architecture is flat: `os.mythosprod.xyz` and `ordre.mythosprod.xyz`
are **sibling subdomains** of the same apex, so the URL says the two are peers
while the brand says one contains the other.

Both readings are defensible — a product may legitimately have its own hostname —
but **the approved text does not say which structure the address bar should
reflect**, and moving a live surface is not a design decision. **ECO-1**, not
resolved here. **The Command Center is live and is not to be touched.**

---

## 5. Public projects — OWNER-APPROVED (A-004, A-005, A-006)

| Rule | Source |
|---|---|
| The eight named projects **and future projects remain independently branded** | **A-004** |
| They **inherit shared Mythos standards** — accessibility, responsive principles, spacing principles, component principles, performance, governance | **A-005** |
| They do **not** automatically inherit the Mythos **visual skin** — logo, palette, imagery, personality and customer-facing identity stay independent | **A-006** |

**The single sentence that governs the boundary:** *projects inherit the system,
not the skin.*

**What "the system" now concretely means — DERIVED**, since 1D–1G have since been
written: the WCAG 2.2 AA floor with AAA body text; the **A-022** hit-box rule
(visual 40/36, hit box ≥ 44 × 44, expansion permitted); reduced-motion behaviour
(**A-018**); RTL and Arabic correctness rules; the six-state component
requirement; and the "colour never carries meaning alone" rule. **None of these
carries a Mythos colour, typeface or mark.** A project adopting all of them looks
exactly like itself.

---

## 6. Endorsement rules — DERIVED from A-003, A-004, A-006, A-021

**Endorsement is the only mechanism by which MYTHOS appears on a surface it does
not own.**

1. **Endorsement is a statement of ownership, not a style.** It says who is behind
   the project; it does not restyle the project.
2. **It occupies ecosystem zones only** — footer, legal, ownership and
   cross-product navigation (**A-021** rule 4).
3. **It never enters the project's own primary identity** — not the logo, not the
   header mark, not the primary action colour (**A-021** rules 1–3).
4. **It is never automatic** (**A-021** rule 7). A project receives it by
   decision.
5. **A unit is endorsed; a product is named.** The Command Center is named, not
   endorsed (**A-020**).
6. **Any exception affecting a project's primary identity requires explicit owner
   approval** (**A-021** rule 8).

**What endorsement looks like is not specified here** and cannot be: the mark it
would use is **LOGO-2**, which is `PROPOSED — AWAITING OWNER APPROVAL` and gated
on **LOGO-1**. **OPEN by dependency, not by omission.**

---

## 7. When MYTHOS appears, and when it must not

### 7.1 MYTHOS appears — DERIVED

| Context | Basis |
|---|---|
| The `mythosprod.xyz` hub and any project directory it carries | **A-001**, **A-021** rule 4 |
| Footer, legal, ownership and shared-legal areas of a public project | **A-021** rule 4 |
| Cross-product navigation between ecosystem surfaces | **A-021** rule 4 |
| Every Mythos-owned surface — Mythos OS, its products, unit-level material | **A-001**, **A-003**, **A-020** |
| Inside a project's own UI **only** where a documented functional or architectural reason exists | **A-021** rule 5 |

### 7.2 MYTHOS must NOT appear — DERIVED, and this list is binding

| Never | Basis |
|---|---|
| **As, beside, or blended into a public project's own logo** | **A-004**, **A-006**, **A-021** rule 2 |
| **As a public project's primary brand colour**, or replacing it | **A-021** rules 1 and 3 |
| **As a project's header or hero identity** — that space belongs to the project | **A-006** |
| **Automatically, on any project, for any reason** | **A-021** rule 7 |
| **In a way that makes the project read as a Mythos-branded product** | **A-021** rule 6 |
| **On a client's own material** produced by a project, where the client is the brand | **A-004**, **A-006** — DERIVED |
| **As a sixth unit lockup for the Command Center** | **A-020** |
| **As five independent unit logos** | **A-003** |

**The recorded live deviation stays recorded and is not blessed here.** The
recovery audit found `darhijama.tn` serving cream tones plus **`#c9a84c`** with
**none of its six charter colours**. **A-021 is forward-looking and deliberately
does not adjudicate it** — **C-001** and **O-002** remain open, and **1H does not
touch them.**

---

## 8. Footer, legal and ecosystem navigation — PROPOSED structure, approved constraints

The **constraints** are approved (**A-021** rule 4). The **structure** below is
**PROPOSED** and rejectable on its own.

| Zone | Contents | Identity |
|---|---|---|
| **Project footer — project zone** | The project's own navigation, contact, social, legal text | **100 % the project's identity** |
| **Project footer — ecosystem strip** | *"A MYTHOS project"* or equivalent, plus a link to the hub | The one place a Mythos mark and Mythos Gold may appear on a public project |
| **Legal / ownership** | Company identification, ownership statements | Factual text; identity-neutral |
| **Cross-product navigation** | Links between ecosystem surfaces, where a user genuinely moves between them | Mythos-side furniture |

**Three rules — DERIVED from A-021 and the 1F/1G specifications:**

- The ecosystem strip is **one row, below the project's own footer content** —
  ownership is stated last, never first.
- Its link targets meet the **A-022** hit-box minimum and the 1G touch rules like
  any other control.
- **It is text-and-mark, never a colour wash.** Gold appearing there is the
  scarce accent (`COLOR_SYSTEM.md` §3.2), not a background.

**The exact mark used is OPEN by dependency on LOGO-2.**

---

## 9. `mythosprod.xyz` hub architecture — structure PROPOSED, existence OPEN

**The hub does not exist. There is no apex vhost** (`MYTHOS_PROJECT_DESIGN_MATRIX.md`
§8). Whether it should exist is **O-003**, open since the recovery stage, and 1H
does not resolve it.

**If built, its information architecture is fixed by A-020 — DERIVED**, since
the Command Center's placement is exactly what the hub's structure was waiting on:

```
mythosprod.xyz
├── MYTHOS — who this is
├── Units          → Mythos OS · Mythos Prod · Mythos Services · Mythos Digital · Mythos Logistique
│   └── Mythos OS  → its products, including Mythos Command Center
├── Projects       → the independent public projects, shown in their own identities
└── Legal / ownership
```

**Three structural rules — DERIVED:**

1. **The Command Center appears under Mythos OS, never beside the five units**
   (**A-020**). This is the concrete consequence the O-A1 decision was needed for.
2. **Projects are shown in their own identities** — a directory of independent
   brands, not a grid of Mythos-skinned tiles (**A-004**, **A-006**).
3. **Units and projects are visually distinct sections**, because they are
   different relationships: a unit *is* Mythos, a project *belongs to* Mythos.

**Unresolved and named:** whether the hub lists only the eight named projects or
also the twelve found outside that list (**ECO-3**, §13.2).

---

## 10. Project discovery and navigation — PROPOSED

- **Discovery flows one way by default:** the hub knows every project; a project
  need not know its siblings. Cross-links between unrelated public projects are
  not created merely because they share an owner.
- **A project links *up* to the hub** through the ecosystem strip (§8), never
  *across* to a competitor-adjacent sibling without a reason.
- **Cross-product navigation exists where a user genuinely moves between
  surfaces** — Mythos OS to Command Center is such a case; Fixpert to Uthina
  Chess is not.
- **Navigation into Mythos-owned surfaces preserves the three-tier structure at
  every breakpoint**, including the mobile overlay (**A-009**, 1F §4.1, 1G §1.7).

---

## 11. Cross-project identity boundaries — DERIVED

**The hard boundary:** a project's logo, palette, typography, imagery and
personality are **its own** (**A-004**, **A-006**). Nothing in 1C–1G overrides
that, and the approved master typography and palette apply to **the master brand
and its units**, not to the projects (**A-014** scope note).

**What crosses the boundary:** the standards in **A-005**, and nothing else.

**What crosses only by decision:** a Mythos-level colour, as a controlled
ecosystem accent, under all eight **A-021** rules.

**What never crosses:** the mark, the primary-colour role, the header identity —
§7.2.

**Between two projects the boundary is total.** Uthina Chess's nine colours and
three font stacks have no bearing on Fixpert, and vice versa. **C-004** — four
unarbitrated palettes across the portfolio — records that this divergence was
never arbitrated; **A-004** now makes it the *intended* state at project level,
which is a different claim from saying each palette was individually chosen.

---

## 12. Domain architecture

### 12.1 Recorded state — evidence, not plan

| Domain | Serving | Status |
|---|---|---|
| `mythosprod.xyz` | **none** | **NOT SERVED** — no apex vhost (**O-003**) |
| `os.mythosprod.xyz` | not deployed; **DNS resolves** | **BUILT / EXISTING** |
| `ordre.mythosprod.xyz` | proxy `127.0.0.1:3021` | **LIVE** — Command Center |
| `panel.mythosprod.xyz` | proxy `127.0.0.1:8000` | **LIVE** — **unclassified (ECO-2)** |
| `tv.mythosprod.xyz` | proxy `127.0.0.1:8096` (Jellyfin) | **LIVE** — **unclassified (ECO-2)** |
| `uthinachess.tn` · `ssangyong.autos` · `fixpert.tn` · `notrejour.tn` · `darhijama.tn` | static or proxy | **LIVE** |
| `n8n.ssangyong.autos` | n8n container | **LIVE** — automation, not a brand surface |
| `agribee.tn` · `idauto.tn` · `mouain.tn` | **none** | **BUILT / EXISTING**, unserved |

### 12.2 Two things the evidence shows that the approved architecture does not cover

**OPEN — ECO-2.** `panel.mythosprod.xyz` and `tv.mythosprod.xyz` are **live
subdomains of the master domain** with **no place anywhere in the approved brand
architecture**. One is a control panel; the other is a Jellyfin media server —
third-party software on a Mythos hostname. They are neither units (**A-002**),
nor products of a unit (**A-020**), nor independent projects (**A-004**).
Whether they are Mythos-branded surfaces, internal infrastructure that should
never carry the brand, or out of scope entirely, **is undecided.** Not resolved
here, and **nothing was changed on either host.**

**OPEN — ECO-3.** Twelve further projects were recovered **outside** the owner's
eight-project list, all VERIFIED present — including **KnowledgeVault KMS at 752
distinct files, the largest body of design work outside the eight**, plus
Karhmana, Chatrange, ClassePro, Oudhna Service, Festival, Nettoyage Photo VPS,
Mythos App, Atelier Network, AutoValeur, Personal Intelligence and Research
Intelligence. **A-004 names eight projects "and future projects".** Whether these
twelve are ecosystem projects, internal tooling, or archive is **undecided**, and
it determines what the hub in §9 lists. Not resolved here.

### 12.3 Domain rules — DERIVED, for surfaces that do not yet exist

- **Mythos-owned surfaces live under `mythosprod.xyz`.** Units and products take
  subdomains; the apex belongs to the master brand.
- **Public projects keep their own apex domains.** A project is not moved under
  the Mythos domain to signal ownership — the ecosystem strip does that
  (**A-004**, **A-006**).
- **A domain never implies an identity.** `ordre.mythosprod.xyz` carrying the
  Command Center does not make it a unit — **A-020** already settled that, and
  §4.1 records that the address bar and the brand tree do not currently agree.

---

## 13. Future-project onboarding — PROPOSED

A new project entering the ecosystem answers five questions, **in this order**:

1. **Which tier?** Unit (**A-002** — a change to the roster, owner-only), product
   of a unit (**A-020** pattern), or independent public project (**A-004**).
2. **What is its own identity?** For an independent project this is decided by the
   project, not inherited (**A-006**). **A project with no identity of its own
   does not get the Mythos skin as a substitute** — it gets an identity.
3. **Which standards does it inherit?** All of **A-005**: accessibility,
   responsive, spacing, component, performance, governance. **Not optional.**
4. **Does it carry endorsement?** Footer and legal zones by default; anything
   further is a decision (**A-021** rules 4, 7, 8).
5. **What is recorded?** A register entry stating the tier, the identity owner and
   the endorsement level, before the project is published.

**Two entry rules — PROPOSED:**

- **No project is published without a recorded tier.** An unclassified live
  surface is exactly the state **ECO-2** describes, and it is avoidable.
- **Inheriting the standards is a condition of entry; inheriting the skin is
  never automatic** (**A-005** vs **A-006**).

---

## 14. Brand governance — PROPOSED, built on the approved record

**Who decides what:**

| Decision | Owner |
|---|---|
| The unit roster, the master identity, endorsement policy, any exception to a project's primary identity | **The owner only** — **A-002**, **A-021** rule 8 |
| A project's own identity | The project |
| The shared standards | The design system; binding on all — **A-005** |
| Tier placement of a new surface | The owner, before publication (§13) |

**How decisions are recorded — the discipline already in use, stated so it
survives:**

- **`A-*` owner-approved · `D-*` recovered evidence · `O-*` open · `C-*`
  conflicting · `U-*` unknown · `MIG-*` migrations.** Owner direction and
  recovered evidence are never merged into one voice.
- **Open items stay open until an explicit decision closes them.** Not by
  inference, not by a later stage needing them, not by absence of objection.
- **A superseded decision is marked superseded with its original text intact** —
  as **A-008** was by **A-013**.
- **Approval is not authorisation to implement.** Every migration is recorded
  separately and actioned separately.

---

## 15. C-006 — an implementation reconciliation issue, deliberately not resolved

**Two token systems now exist in this repository**, and **1H merges neither,
renames neither, and chooses no winner.**

| | Implemented (MOS-1, on `main`) | Approved specification (1C / 1E) |
|---|---|---|
| Where | `projects/mythos-os-console/reference/web/mythos.css` | `DESIGN_TOKENS.md`, `GRID_AND_SPACING.md` |
| Spacing | 4 · 6 · 8 · 12 · 16 · 20 · 24 · 32 · 40 | 2 · 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 · 96 · 128 · 160 |
| Radius | 5 · 6 · 8 · 12 · 16 · 999 | 0 · **2** · 6 · 12 · 999 |
| Accent | `#c9a84c` — legacy gold (**U-001**) | `#D9A441` — Mythos Gold (**A-013**) |

**The sharp edge:** `--mythos-sp-6` is **20 px** and `space-6` is **24 px**;
`--mythos-radius-sm` is **6 px** and the approved workhorse `radius-1` is **2 px**.
Similar names, different values.

**Why this is an ecosystem question and not only a CSS question — DERIVED.** Under
**A-005** public projects inherit *the standards*. If two systems both answer to
the name "Mythos", **a project cannot know which standard it is inheriting.**
That is the ecosystem cost of C-006, and it is the reason the reconciliation
matters beyond Mythos OS.

**Status: OPEN.** It belongs to a later **implementation** stage, alongside
**MIG-1** (gold) and **MIG-3** (semantic and control-border tokens), both still
unactioned. **D-012 stands and the approved 1C/1E specifications stand.**
**TOKEN-2** — whether tokens carry a namespace prefix — has precedent now but no
decision.

---

## 16. Open register — updated, AUTO-3, 2026-08-18

### 16.1 New, raised by 1H — all three resolved

| Ref | Statement | Adopted (**AUTO-3**, delegated mandate, not owner-approved) |
|---|---|---|
| ~~**ECO-1**~~ | Brand hierarchy nests Command Center under Mythos OS; domain architecture makes `os.`/`ordre.` siblings | **DNS stays as-is.** Brand hierarchy is expressed in navigation/breadcrumb UI only, never in the URL — renesting a live service is real infrastructure risk for a purely representational question |
| ~~**ECO-2**~~ | `panel.`/`tv.` have no place in the approved architecture | **Classified as internal infrastructure.** Carry no Mythos branding, mark, gold or design-system styling of any kind — neither units, products, nor projects |
| ~~**ECO-3**~~ | Twelve projects exist outside the owner's list | **Classified as internal tooling/archive.** None has any recorded public domain or vhost, live or planned, unlike the eight named projects — they do not appear in a future hub |

Full reasoning: `MYTHOS_DESIGN_DECISIONS.md` §0.5, AUTO-3.

### 16.2 Carried — most resolved by AUTO-1/AUTO-2/AUTO-3, listed by name so a later reader finds each

| Ref | Status |
|---|---|
| **C-006** | Canonical system named (**AUTO-2**); reconciliation execution still not actioned — full-application visual regression this session cannot run |
| **LOGO-1** | Still OPEN, **narrowed** (**AUTO-1**) — one of three off-host repositories searched, negative; two remain blocked |
| **LOGO-2** | **RESOLVED — AUTO-1.** Adopted as production master, not owner-approved |
| **GRID-1**, **GRID-3**, **SURF-1**, **GOLD-2**, **GOLD-3**, **TOKEN-1**, **TOKEN-2**, **MOTION-1**, **MOTION-2**, **MOTION-3**, **LINK-1**, **SHAPE-1**, **TYPE-3**, **SPACE-1**, **A11Y-1**, **A11Y-2**, **SEQ-1** | **RESOLVED — AUTO-3.** Full values and reasoning per item: `MYTHOS_DESIGN_DECISIONS.md` §0.5 |
| **GRID-2** | **RESOLVED — AUTO-5.** `container-prose` set to 48ch, superseding the 68ch approximation on real font metrics; not owner-approved |
| **TYPE-2** | **RESOLVED — AUTO-4.** Real self-hosted WOFF2 files, real weight instances and measured performance budget — no longer provisional |
| **C-001** / **O-002** | Untouched. A real-world project conflict, not a system rule a sweep can resolve |

Also carried from the recovery era and untouched: **O-003** (apex site) ·
**O-004** (do Mythos Services, Digital and Logistique exist as brands?) ·
**O-006** (Mouain's 1,787 unmerged lines) · **O-007** (is AgriBee intended to be
served?) · **C-004** (four unarbitrated palettes) · **U-001** (why `#c9a84c`) ·
**MIG-1**–**MIG-4**. All are evidence or infrastructure questions, not design
questions a decision sweep can answer.

**None was resolved, narrowed by inference, or given a value.**

---

## 17. What this document did not do

- Did not implement anything, modify a project website, CSS, asset, token or the
  Command Center.
- Did not migrate tokens or resolve **C-006** — §15 records it as a later
  implementation-stage reconciliation.
- Did not introduce a new visual decision. No colour, type, spacing, component or
  motion value was added or changed.
- Did not reinterpret or expand **A-021** — the eight rules are used exactly as
  approved.
- Did not claim any project is live beyond what the recovered live-service map
  shows, and did not resolve **O-003**, **O-004**, **O-006**, **O-007**,
  **C-001** or **O-002**.
- Did not adopt LOGO-2 by inference: the endorsement mark and the descriptor
  lockup remain **PROPOSED — AWAITING OWNER APPROVAL**, gated on **LOGO-1**.
- Did not adopt any PROPOSED item in §8, §10, §13 or §14 — each needs owner
  approval individually.
