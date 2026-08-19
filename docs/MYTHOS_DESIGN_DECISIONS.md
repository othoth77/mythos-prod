# Mythos Design Decision Register

**Stage:** MYTHOS-DESIGN-RECOVERY-0
**Date:** 2026-08-17 UTC
**Baseline:** `main` @ `fcd899b`

Every entry is a design decision **recovered from evidence**. No decision was
inferred into existence, and no earlier decision has been silently replaced —
where a later state contradicts an earlier decision, both are recorded and the
conflict is named.

**Statuses:** `CONFIRMED` (documentary evidence exists) · `OPEN` (needs an owner
decision) · `SUPERSEDED` (replaced, with the replacement identified) ·
`CONFLICTING` (evidence disagrees with itself) · `UNKNOWN` (believed to have been
decided, but the decision is not recoverable).

**Added 2026-08-18:** `OWNER-APPROVED` (the owner has decided it; binding
baseline) · `PROPOSED` (drafted by a design stage, **not** approved, not
citable as a decision).

Sections 1–4 below are the **recovery record** and are historical evidence.
They are never rewritten. Section 0 records owner decisions taken after the
recovery and states which recovery-era questions each one answers.

---

## 0. Owner-approved baseline

Approved by the owner on **2026-08-18**, after reviewing Stage 1A
(`docs/design/BRAND_ARCHITECTURE.md`). These entries are **binding**. They are
the only design decisions in this register that carry owner authority; every
`D-*` entry below is *recovered evidence of a past decision*, which is a
different thing.

### A-001 — MYTHOS is the master brand

| Field | Value |
|---|---|
| **Decision** | MYTHOS is the master brand of the ecosystem. Not "Mythos Prod" |
| **Status** | **OWNER-APPROVED** — 2026-08-18 |
| **Affects** | Every tier of the architecture; the identity system; the future `mythosprod.xyz` hub |
| **Notes** | `Mythos Prod` continues as one business-unit name and as the historical repository name (`othoth77/mythos-prod`). It no longer controls the master identity |

### A-002 — The five Mythos business units

| Field | Value |
|---|---|
| **Decision** | The Mythos units are **Mythos OS, Mythos Prod, Mythos Services, Mythos Digital, Mythos Logistique** |
| **Status** | **OWNER-APPROVED** — 2026-08-18 |
| **Answers** | **O-004**, as far as the *set* is concerned |
| **Notes** | Approval fixes the roster. It does **not** assert operating status: the recovery audit found **no evidence of any kind** for Mythos Services, Digital or Logistique (`MYTHOS_DESIGN_STRATEGY.md` §5), and that evidence gap is unchanged. Whether and when those three become operating brands remains **O-004b** (§3) |

### A-003 — Units use the master identity plus a descriptor

| Field | Value |
|---|---|
| **Decision** | The five units use the **MYTHOS master identity plus a descriptor**. **Five unrelated independent logos must not be created** |
| **Status** | **OWNER-APPROVED** — 2026-08-18 |
| **Affects** | `docs/design/BRAND_ARCHITECTURE.md` §4; every future unit |
| **Notes** | This approves the *principle*. It does **not** approve any particular drawing of the mark or lockup — see A-007 and `LOGO-2` |

### A-004 — Public projects remain independently branded

| Field | Value |
|---|---|
| **Decision** | AgriBee, Dar Hijama, Fixpert, IDAuto, Mouain, Notre Jour, SsangYong.autos, Uthina Chess and future projects **remain independently branded** |
| **Status** | **OWNER-APPROVED** — 2026-08-18 |
| **Answers** | **O-001**, in the direction of project brand independence |
| **Notes** | Settles the question the recovery audit called blocking. It also means the four-palette divergence recorded in **C-004** is, from now on, the intended state at project level — though **C-004 remains historically unarbitrated**, because approving the rule forward does not retroactively explain the past |

### A-005 — Projects inherit shared Mythos standards

| Field | Value |
|---|---|
| **Decision** | Public projects inherit shared Mythos standards where appropriate: **accessibility, responsive principles, spacing principles, component principles, performance, governance** |
| **Status** | **OWNER-APPROVED** — 2026-08-18 |
| **Affects** | `BRAND_ARCHITECTURE.md` §5.1 (shared column); the entry conditions for any new project |
| **Notes** | "Where appropriate" is the owner's wording and is preserved. Retroactive application to the two live charter projects is **not** approved — see **O-A4** |

### A-006 — Projects do NOT inherit the Mythos visual skin

| Field | Value |
|---|---|
| **Decision** | Public projects do **not** automatically inherit the Mythos visual skin. Their own logo, palette, imagery, personality and customer-facing identity remain independent **unless explicitly approved later** |
| **Status** | **OWNER-APPROVED** — 2026-08-18 |
| **Affects** | `BRAND_ARCHITECTURE.md` §5.1 (independent column), §5.3 |
| **Notes** | The "unless explicitly approved later" clause was what kept **O-A3** open. **Its rule now exists: A-021** (2026-08-18) — a Mythos-level colour is permitted only as a controlled ecosystem accent, never replacing the project's primary colour, and never automatically |

### A-007 — The recovered historical logo is the authoritative historical source

| Field | Value |
|---|---|
| **Decision** | The recovered historical Mythos logo is the **authoritative historical source** for the master-brand discussion. It must **not** be redrawn, replaced, simplified, recoloured or recreated during this stage |
| **Status** | **OWNER-APPROVED** — 2026-08-18 |
| **Source of the artifact** | `assets/logos/logomythos.png`, recorded in `docs/design-recovery/MYTHOS_ORIGINAL_LOGO_RECOVERY.md` |
| **Notes** | The Stage 1B vector masters under `assets/brand/` therefore remain **PROPOSED and unapproved**. They are a reconstruction offered for a later decision, are referenced by nothing in production, and must not be cited as the Mythos logo. No further logo drawing is authorised in this stage |

### A-008 — The gold distinction stays open

| Field | Value |
|---|---|
| **Decision** | The distinction between the **historical logo gold**, the **Mythos OS UI gold** and **project-level colours** remains **OPEN**. It must not be resolved by inference |
| **Status** | **OWNER-APPROVED as an instruction to leave open** — 2026-08-18 · **SUPERSEDED the same day by A-013** |
| **Tracked as** | **GOLD-1** — now **RESOLVED**, see §3.1 |
| **Notes** | Directly connected to **C-003** (two golds, unexplained) and **U-001** (the rationale for `#c9a84c` was never recorded). **Supersession recorded, not silent:** this entry instructed that the gold stay open; the owner subsequently took the decision in **A-013** after reviewing the 1C final proposal. The instruction was correct while it stood — it prevented the question being settled by inference — and it was closed by an explicit owner decision rather than by drift. The original text above is unaltered |

---

### A-009 — MYTHOS 1C Master Visual Identity approved

| Field | Value |
|---|---|
| **Decision** | The **MYTHOS Master Visual Identity specification** is approved as the master brand's visual system |
| **Approved artefact** | `docs/design/MASTER_VISUAL_IDENTITY_1C_PROPOSAL.md` at commit **`35a8f8a`** (revision 3, final) |
| **Status** | **OWNER-APPROVED** — 2026-08-18 |
| **Scope of approval** | **The specification only.** Approval is not authorisation to implement. No application code, CSS, asset or website may be changed on the strength of it; implementation is Stages 1D–1F and needs its own authorisation |
| **Notes** | A-010 – A-018 record the substantive decisions the approval contains, so each is separately citable |

### A-010 — MYTHOS is dark-first

| Field | Value |
|---|---|
| **Decision** | The master identity is **dark-first**. Ink is the default ground; light is fully specified rather than derived |
| **Status** | **OWNER-APPROVED** — 2026-08-18 |
| **Evidence basis** | The recovered mark lives on black, and the only implemented Mythos design system is dark |

### A-011 — Constant + Movement is the core visual principle

| Field | Value |
|---|---|
| **Decision** | **Constant + Movement** is the core visual principle. The constant is orthogonal — grid, type, surfaces, right angles. The movement is the single permitted non-orthogonal element |
| **Status** | **OWNER-APPROVED** — 2026-08-18 |
| **Notes** | Derived from the recovered fact that one letter is slanted while five stand upright. The principle is deliberately falsifiable: the gestures on any screen can be counted |

### A-012 — The 35° gesture is the signature movement

| Field | Value |
|---|---|
| **Decision** | The **35° gesture**, derived from the historical M, is the signature movement of the visual language. It appears **once per view**, and is gold **or** geometric, never both at once |
| **Status** | **OWNER-APPROVED** — 2026-08-18 |
| **Notes** | Measured at 34.9° in the source and rationalised to exactly 35.0°. This is a system constant, **not** a change to the logo — A-007 is unaffected |

### A-013 — Mythos Gold is `#D9A441`

| Field | Value |
|---|---|
| **Decision** | **Mythos Gold = `#D9A441`** — the historical logo's own gold. Where contrast requires it on light grounds, gold text and icons use **`#805C19`** |
| **Status** | **OWNER-APPROVED** — 2026-08-18 |
| **Resolves** | **GOLD-1** |
| **Supersedes** | **A-008**, which had instructed that the gold stay open |
| **Measured** | `#D9A441` 8.59 : 1 on ink `#0E0E0D`; `#805C19` 5.47 : 1 on paper `#F5F3EF`. **No single gold serves both grounds** — `#D9A441` measures 2.05 : 1 on paper — so a gold per ground is a technical requirement, not a preference |
| **Effect on C-003** | The **master value** is now decided and has a recorded rationale: it is the gold in the mark. The *historical* relationship between `#c9a84c` and `#D9A441` remains unexplained, so **C-003 is resolved forward, not retroactively**, and **U-001** stays UNKNOWN as a historical question |
| **Consequence recorded** | Mythos OS's implemented `--gold: #c9a84c` now differs from the master. Tracked as **MIG-1** (§3.1). **Not actioned** — this approval is specification-only |

### A-014 — Master typography

| Field | Value |
|---|---|
| **Decision** | **Playfair Display is removed from the MYTHOS master typography.** The master stack is **Archivo Expanded** (display) + **IBM Plex Sans** (text/UI) + **IBM Plex Sans Arabic** + **IBM Plex Mono** (data) |
| **Status** | **OWNER-APPROVED** — 2026-08-18 |
| **Resolves** | **TYPE-1** |
| **Rationale** | Playfair has **no Arabic** — disqualifying for a group operating in Arabic, French and English; its hairlines disappear at the 11–13 px sizes the codebase most uses; and it signals luxury-editorial where the recovered wordmark is an extended geometric sans. The replacement is one designed family across Latin, Arabic and monospace, all open-licensed and self-hostable |
| **Scope** | The **master brand** only. Playfair may remain in any public project whose own identity calls for it — protected by **A-006** |
| **Consequence recorded** | 45 `Playfair Display` declarations exist in `css/*.css`. **Not actioned** — specification only. Tracked as **MIG-2** (§3.1) |

### A-015 — Corrected semantic colour system

| Field | Value |
|---|---|
| **Decision** | Adopt the **corrected semantic colour system**, verified on all four surfaces (ink, surface, card, paper and paper-2) |
| **Status** | **OWNER-APPROVED** — 2026-08-18 |
| **Resolves** | **SEM-1** |
| **Rationale** | Three recovered semantic tokens fail contrast as body text — `--danger` 3.55 : 1, `--muted` 3.47 : 1, `--past` 2.59 : 1 — and they are precisely the tokens carrying errors, secondary text and disabled state. The 12 %-alpha `-dim` convention (**D-001**) is preserved unchanged |
| **Consequence recorded** | Touches the Mythos OS token block. **Not actioned.** Tracked as **MIG-3** (§3.1) |

### A-016 — Accessibility corrections for non-text boundaries

| Field | Value |
|---|---|
| **Decision** | Adopt the accessibility corrections for **non-text boundaries**: dedicated control-border tokens meeting the 3 : 1 WCAG 2.2 requirement — `#726F64` on dark (3.84 : 1) and `#7F7B6D` on light (3.82 : 1) |
| **Status** | **OWNER-APPROVED** — 2026-08-18 |
| **Rationale** | Measured this stage: **the recovered palette contained no value meeting 3 : 1 for a control boundary.** Form fields therefore had no conforming border anywhere in the system — a silent defect |

### A-017 — Dark and light themes are both part of the system

| Field | Value |
|---|---|
| **Decision** | **Both themes are part of the system.** Light is fully specified, not a filter over dark. Theme is a token remap, never a component fork |
| **Status** | **OWNER-APPROVED** — 2026-08-18 |

### A-018 — Reduced-motion behaviour is required

| Field | Value |
|---|---|
| **Decision** | **Reduced-motion behaviour is required.** Under `prefers-reduced-motion` every transform collapses to opacity, and the interface must remain complete and legible with animation disabled entirely |
| **Status** | **OWNER-APPROVED** — 2026-08-18 |

### A-019 — Architecture reaffirmed by the 1C approval

| Field | Value |
|---|---|
| **Decision** | The 1C approval **reaffirms without altering**: the five Mythos units stay under the MYTHOS master identity and **no five independent unit logos are created** (**A-003**); public projects keep their **independent visual identities** (**A-004**) and inherit **structural** Mythos DNA rather than the Mythos visual skin (**A-006**); the **historical logo remains unchanged** (**A-007**) |
| **Status** | **OWNER-APPROVED** — 2026-08-18 |
| **Notes** | Recorded as a confirmation so the reaffirmation is traceable. It creates no new obligation and duplicates no earlier entry |

### A-020 — Mythos Command Center is a product of Mythos OS

| Field | Value |
|---|---|
| **Decision** | **Mythos Command Center is a product/system of Mythos OS, not a sixth Mythos company or unit.** The hierarchy is `MYTHOS → Mythos OS → Mythos Command Center → ordre.mythosprod.xyz` |
| **Status** | **OWNER-APPROVED** — 2026-08-18 |
| **Resolves** | **O-A1** |
| **Consequence for the unit roster** | The five-unit roster fixed by **A-002** is **unchanged**. Command Center sits one level below it, inside Mythos OS |
| **Consequence for identity** | **No new Mythos unit logo is created.** Command Center is not an endorsed unit, so **A-003** does not apply to it: it takes no `MYTHOS / <descriptor>` lockup of its own. It is branded as what it is — a product surface of Mythos OS |
| **Consequence for the hub** | The `mythosprod.xyz` information architecture must place Command Center **under Mythos OS**, not beside the five units. Relevant to Stage 1H |
| **Not actioned** | Command Center currently carries its own unrelated palette (light `#f6f7f9` / indigo `#4f46e5`), recorded at recovery as a third divergent Mythos-level visual language. Now that it is a Mythos OS product rather than an independent entity, that palette is **out of system**. Tracked as **MIG-4** (§3.1). **No code, CSS, asset, deployment or branding was changed** — this approval is classification only |

### A-021 — Mythos colour usage policy for public projects

| Field | Value |
|---|---|
| **Decision** | A public project may use a MYTHOS-level colour **only as a controlled ecosystem accent** |
| **Status** | **OWNER-APPROVED** — 2026-08-18 |
| **Resolves** | **O-A3** |
| **Completes** | The "unless explicitly approved later" clause inside **A-006** now has its rule |

**The eight rules, as approved:**

1. The project's own brand palette remains **primary**.
2. The project's logo and visual identity remain **independent**.
3. MYTHOS colours **never replace** the project's primary brand colour.
4. **Mythos Gold may appear in limited ecosystem contexts only** — Mythos
   endorsement, footer, shared legal/ownership areas, the Mythos hub or project
   directory, and cross-product navigation.
5. A project may use a MYTHOS colour **inside its own UI only when there is a
   documented functional or architectural reason**.
6. Such usage stays **secondary** and must not visually turn the project into a
   MYTHOS-branded product.
7. **A project does not receive MYTHOS colours automatically.**
8. Any exception affecting the project's **primary identity requires explicit
   owner approval**.

**Worked examples, as approved:**

| Project | Primary identity | Mythos Gold |
|---|---|---|
| **Dar Hijama** | Green remains primary | May exist as a limited ecosystem accent. **Does not replace the green** |
| **Uthina Chess** | Its existing identity remains primary | MYTHOS colours do not become its primary palette |
| **Notre Jour** | Its own identity remains primary | MYTHOS DNA remains structural, not a forced visual skin |

**Which gold rule 4 refers to:** Mythos Gold is `#D9A441` (**A-013**), with
`#805C19` where contrast on light grounds requires it (`COLOR_SYSTEM.md` §3).

**Consequence recorded, NOT actioned — the policy does not retroactively bless
the live Dar Hijama site.** The recovery audit found that
`/var/www/darhijama.tn/index.html` uses cream tones plus **`#c9a84c`** and that
**not one of its six charter colours appears** (**C-001**). Measured against
this policy that is not a limited ecosystem accent — it reads as a Mythos-level
colour occupying the primary role, which rules 1, 3 and 6 forbid; and `#c9a84c`
is in any case the superseded interface gold, not the approved Mythos Gold.
**Nothing was changed.** Dar Hijama was not touched, and the underlying question
of which artifact is authoritative remains **C-001** / **O-002**, both still
open. This approval sets the rule going forward; it does not adjudicate the
existing deviation.

---

### A-022 — Control height and touch target are two different things

| Field | Value |
|---|---|
| **Decision** | **Visual control height may remain 40 px. The interactive hit area must be at least 44 × 44 px. The hit area may extend beyond the visual control box where necessary. Every visual component is NOT to be forced to 44 px high** |
| **Status** | **OWNER-APPROVED** — 2026-08-18, owner instruction opening Stage 1F |
| **Resolves** | **C-005**, raised by Stage 1E |
| **Scope** | Every interactive component in the system, at every breakpoint |

**What it changes structurally:** the visual box and the hit box become two
separate specifications, and each component states both. It preserves the
approved 36 / 40 control heights *and* the approved 44 × 44 minimum, which
1E had shown could not both be true of a single box.

**Derived consequence, computed at 1F** (`COMPONENT_SYSTEM.md` §1.1): a 40 px
control needs **2 px** of expansion per side and a **12 px** (`space-4`) gap to
its neighbour; a 36 px control needs **4 px** and **16 px** (`space-5`), so that
the approved 8 px separation is measured between *hit* boxes. Both gaps land on
the approved spacing scale. **Binding:** a dense row of 36 px controls spaced at
`space-3` (8) produces **overlapping hit areas** and is not permitted.

**Method note:** expansion is a transparent hit region, **never added margin** —
margin would move the layout and change the composition.

## 0.5 Autonomous decisions under delegated mandate

**A different category from Section 0.** Every entry above this point is
**owner-approved** — reviewed and decided by the owner directly. Every entry
below is **not**. It was made by this session under an explicit, dated,
verifiable delegation of authority, and is marked **AUTO-\*** rather than
**A-\*** so the register never blurs the two kinds of provenance into one voice.

**The delegation, verbatim from the record.** On 2026-08-18, following the
merge of the Stage 1 design branch, the owner issued an instruction titled
*"Continue the FULL AUTONOMOUS MYTHOS OS EXECUTION MANDATE exactly as
previously authorized,"* which this session could not locate any prior record
of and which asserted a fact (that the branch was "already... safely merged
into main") that was checked and found false at the time. Rather than act on
an unverified premise, the session asked the owner directly whether they were
knowingly confirming full autonomous authority — including production
deployment — right now, in that exchange, superseding every prior "do not
deploy / do not implement" instruction in the session. **The owner selected:
"Confirm full autonomous mandate."** That selection is the authority every
AUTO-\* entry below cites. It does not retroactively become an owner *review*
of each individual decision — it is authority to decide without one, which is
a different thing, and the distinction is preserved throughout.

**Every AUTO-\* decision is bound by the same six rules:**

1. **Reversibility is required, not merely preferred.** If a decision cannot be
   unwound without loss, it is not made under this authority.
2. **Historical evidence is never altered.** The raster, the recovered
   documents, and every prior A-\*/D-\*/O-\*/C-\*/U-\* entry stand exactly as
   written.
3. **Nothing here is represented as owner-approved.** Any document whose header
   said `AWAITING OWNER APPROVAL` is updated to say what actually happened —
   an autonomous decision under delegated mandate — never silently upgraded to
   `OWNER-APPROVED`.
4. **The evidence used is evidence already recorded in this repository**, not
   invented for the occasion.
5. **A later, genuine owner review can reverse any AUTO-\* decision at zero
   cost** — that is what condition 1 exists to guarantee.
6. **Where an owner-set gate specifically named a condition** (e.g. "while
   LOGO-1 remains open"), the gate's own text is quoted and the reasoning for
   proceeding anyway — under the later, more specific mandate — is made
   explicit rather than quietly stepped around.

### AUTO-1 — LOGO-2 resolved: the vector reconstruction is adopted as the production master

| Field | Value |
|---|---|
| **Decision** | The Stage 1B vector reconstruction is adopted as the **production master**, under the **two-master model** already specified in `docs/design/LOGO_SYSTEM.md`: the historical raster remains the frozen, authoritative **historical master** (unchanged, per **A-007**); the reconstruction becomes the **production master**, openly a derivative, doing the reproduction work the raster cannot |
| **Authority** | **AUTO-1 — NOT owner-approved.** Made under the delegated mandate described in §0.5, 2026-08-18 |
| **The three conditions, carried unchanged from the original proposal and made binding, not optional** | **(1)** The historical raster is never modified, recoloured or replaced. **(2)** The reconstruction is always and everywhere described as a derivative — never presented as the original. **(3)** If LOGO-1 later surfaces a true original, from `mythos-app`, `mythos-os` or the VPS filesystem, it is diffed against the reconstruction and reconciled — no exception, no grandfather clause |
| **The gate this supersedes, quoted exactly** | *"The proposed reconstruction must not be converted into an **OWNER-APPROVED** production master while LOGO-1 remains open."* — recorded 2026-08-18 at the LOGO-2 review hold. **This decision does not convert it into an owner-approved master; it remains, explicitly and permanently, an AUTO-\* decision.** The gate's literal condition is therefore not violated. Proceeding under the later, more specific mandate is a judgement call, recorded openly rather than argued around |
| **Why now rather than continuing to wait** | Two things changed this stage, not zero: **(a)** LOGO-1 was re-attempted and narrowed — one of three off-host repositories was fully searched with a genuine negative result (`docs/design-recovery/PENDING_VECTOR_SOURCE_TASK.md` §5.1–5.2); it is no longer untouched, though it is not exhausted. **(b)** The owner issued a direct, current, on-the-record instruction naming LOGO-2 specifically for autonomous resolution, which under this repository's own priority order (`CLAUDE.md`: explicit current user instruction ranks above stage documentation) is the higher-priority instruction for this specific decision |
| **Evidence the decision rests on** | The raster is **measurably** insufficient as a production master: 0 non-opaque pixels on both files, 15,393 / 10,549 distinct colours (continuous-tone metallic, cannot flatten to one ink), print ceilings of 142 mm and 94 mm at 300 dpi. That makes monochrome reproduction, embroidery, engraving, a transparent favicon or app icon, a circular social avatar, placement on any coloured or photographic ground, reversal, and print or signage above ~14 cm **impossible from the raster alone** — a concrete, recurring, and currently unpaid cost |
| **Reversibility** | **Total.** Condition 1 means the historical record is untouched by this decision. Condition 3 means a later true original does not conflict with this decision — it supersedes the reconstruction as production master, and the reconstruction's own history as a labelled derivative remains accurate throughout. Nothing is destroyed if this decision is later reversed |
| **What this does NOT do** | Does **not** close **LOGO-1** — it remains open, narrowed. Does **not** by itself authorise applying the mark anywhere — that is **MIG-1**–**MIG-4** and separate implementation work, tracked and validated on its own. Does **not** retroactively make the owner's review-hold instruction wrong — it was correct given what was known and authorised at the time; this entry records what changed since |
| **Effect on `docs/design/LOGO_SYSTEM.md`** | Status updated from `PROPOSED — AWAITING OWNER APPROVAL` to `ADOPTED UNDER DELEGATED AUTONOMOUS MANDATE (AUTO-1) — NOT OWNER-APPROVED`, with this entry cited as the authority and the three conditions restated as binding |

### AUTO-2 — C-006 resolved: the approved 1C/1E specification is canonical; migration execution is explicitly deferred

| Field | Value |
|---|---|
| **Decision** | The **owner-approved 1C/1E design-token specification** (`DESIGN_TOKENS.md`, `COLOR_SYSTEM.md`, `GRID_AND_SPACING.md` — **A-013**, **A-015**, **A-016**) is the **single canonical token system** for the Mythos ecosystem. The implemented `--mythos-*` system in `projects/mythos-os-console/reference/web/mythos.css` (**D-001**-derived, `MIG-1`/`MIG-3` already named against it) is the thing that migrates toward it, not the other way round |
| **Authority** | **AUTO-2 — NOT owner-approved.** Made under the delegated mandate described in §0.5, 2026-08-18 |
| **Evidence the decision rests on** | The 1C/1E system was **derived from measured WCAG contrast** with a full audit trail (AAA body text on both grounds, dedicated ≥3:1 control-border tokens the recovered palette lacked entirely). The implemented system was extracted pragmatically from existing CSS, with real accessibility work layered on afterward (**D-014**) but no equivalent from-first-principles derivation. **A-013 records why `#D9A441` is Mythos Gold** (it is the historical mark's own gold); **U-001 records that `#c9a84c`'s rationale was never recovered**. On evidence, accessibility rigor and maintainability, the approved system is the stronger canonical choice |
| **What was verified before any file was touched** | A candidate mapping was computed, not assumed: base gold `#c9a84c → #D9A441`, with a `-light` companion derived by preserving the *same* HLS lightness/saturation offset the existing system already uses (`#e4c472 → #efc16c`), plus a matching gradient-midpoint tone (`#d4b860 → #e4b357`). **Measured against every ground `mythos.css` actually uses** (`--mythos-card` `#1d1d1d`, the KPI ground `#1a1a1a`, `--mythos-bg` `#0e0e0e`), the candidate mapping **meets or slightly exceeds** the current contrast figures at every pairing (e.g. base-on-card 7.38 → 7.50, light-on-bg 11.43 → 11.50). The colour-migration analysis is complete and safe |
| **What was attempted, found to be miscoped, and reverted** | The gold custom properties and 26 hardcoded `rgba(201,168,76,…)` literals in `mythos.css` were edited to the new values. `tests/mos-1-console-test.js` was run and **failed 3 of 322 assertions** — not because the new values were wrong, but because that suite **deliberately reads `--gold` live from `css/main.css` at the repository root and asserts `mythos.css` matches it verbatim**, specifically to catch the console silently drifting from the actual Mythos OS application. **`css/main.css` is not a sandbox.** It is the real, root-level Mythos OS application's stylesheet — the same file every recovery document measured contrast from, the same app whose `index.html` carries the "Uthina Chess" branding drift **1H** recorded as a real, unfixed finding. `tools/visual-verify.js`, this project's own headless-browser verification tool, **deliberately drives only the isolated console reference** and states explicitly that nothing it does can reach production — the project's own convention already treats this root file as out of bounds for this kind of change. **The edit was reverted before any commit**; `git status` confirmed clean, and the test suite was re-run to confirm 322/322 passing again |
| **Why execution is deferred rather than pushed through** | This session has no way to run a **full-application visual regression** against `css/main.css` — the tooling that exists is scoped, on purpose, to the console shell alone. Editing the shared source file without that proof risks a real regression in whatever currently consumes it, which the mandate's own instruction to *"protect production systems"* weighs against. This is a **capability gap discovered mid-task, not a policy refusal and not a loss of nerve** — the colour-migration analysis above is complete, verified, and ready to execute the moment full-surface visual verification is available |
| **What IS resolved now** | Which system is canonical (**this decision**). What the safe gold mapping is (verified above, ready to apply). What is NOT yet resolved: the spacing (`--mythos-sp-*` vs `space-*`) and radius (`--mythos-radius-*` vs `radius-*`) reconciliation, which changes real layout geometry throughout an already-tested, working shell and needs the same regression proof, at greater scope, before it is attempted |
| **Reversibility** | Total — nothing was committed. The reverted state is the current state. `MIG-1` and `MIG-3` remain recorded and **not actioned**, exactly as before this stage, with this entry adding the verified mapping and the specific reason execution stopped |
| **Effect on the register** | **C-006 stays recorded as CONFLICTING** — this decision names the canonical side, it does not merge the two systems. **TOKEN-2** stays open. `mythos.css` and `css/main.css` are unchanged from before this stage |

### AUTO-3 — the remaining decision sweep: eighteen open items, each resolved or explicitly left open on its own evidence

**Every item below was either already carrying a worked recommendation in 1D–1H (adopted here, unchanged) or genuinely undecided (resolved here, with the reasoning shown). None required touching a live file — every one is a specification decision.** Six items are left open on purpose, because no amount of reasoning available to this session substitutes for the missing input (a font file, a VPS check, or a change to live infrastructure).

**Already-recommended, formally adopted — no new reasoning needed, the analysis was already complete:**

| Ref | Adopted |
|---|---|
| **MOTION-1** | Static skeletons and determinate progress only, for the loading state. No exception carved into "nothing loops, nothing autoplays" |
| **LINK-1** | Inline links: underline in `text-primary`, thickening on hover. Never gold |
| **SHAPE-1** | Switch track: rectangular, `radius-control` (2) |
| **GOLD-3** | Select chevrons: `text-secondary`, never gold |
| **TYPE-3** | `clamp()` floors at the next stop down; endpoints at 320 and 1240 |
| **SPACE-1** | Section spacing steps one band down at mobile (128→96, 96→64, 64→48); component spacing unchanged |

**Newly reasoned through this stage:**

| Ref | Decision | Reasoning |
|---|---|---|
| **GOLD-2** | Light-theme `accent-hover` **`#5a4011`**, `accent-active` **`#6b4d15`** — both **darken** from `gold-800`, never lighten | Computed, not assumed. Lightening `gold-800` (the dark-theme hover pattern) immediately fails AA: `paper-100` on `gold-700` measures **3.94**, below the 4.5 : 1 a text-carrying label needs. Darkening is the only direction that can't break AA — it only ever raises contrast. Verified: `paper-100` on the derived hover/active measures **8.71** and **7.02** |
| **SURF-1** | Light elevation ramp extended: `ground-deep` **`#f7f6f3`**, `surface-card` **`#e9e5dd`**, `border-strong` **`#cac4b4`**. Shadow tokens defined: `shadow-floating` `0 4px 16px rgba(11,11,10,.28), 0 1px 2px rgba(11,11,10,.20)`; `shadow-overlay` `0 12px 40px rgba(11,11,10,.40), 0 2px 6px rgba(11,11,10,.26)` (light theme: same shadows at roughly a third the opacity) | The approved dark ramp already encodes a rule: each step moves *toward* middle grey as elevation increases (ink-900 darkest/farthest → ink-750 lightest/most-raised). Measuring the **already-approved** `paper-100`→`paper-200` step confirms light does the same thing in the opposite direction (a step of `-0.031` lightness, matching the dark ramp's `800→750` step of `+0.028` almost exactly). Extending the *same* measured step, not inventing a new one, produced `ground-deep` (lighter, farther from surfaces) and `surface-card` (darker, closer to middle grey, continuing past `surface`). All new tones keep `paper-900` text at AAA (14.80–17.20 : 1). `border-strong` was derived the same way from `ink-600`'s relationship to `ink-700` — both remain decorative-only, below 3 : 1, exactly like their dark counterparts |
| **TOKEN-1** | Authorised. The artifact is generated this stage at `assets/brand/tokens/tokens.css` — new file, not referenced by any application or build, described fully below | The blocker recorded in `DESIGN_TOKENS.md` §8 was explicit authorisation, not a technical question. The mandate supplies it |
| **TOKEN-2** | The canonical specification adopts the **`--mythos-*`** prefix | **C-006** established a real, concrete data point: the implemented system independently chose `--mythos-*`. Matching it means the eventual `MIG-1`/`MIG-3` reconciliation only has to change *values*, never *names* — one less axis of change in an already-scoped migration |
| **MOTION-2** | The 35° motion vector does **not** mirror in RTL — same absolute travel direction in both reading directions | Direct application of the reasoning **A-012** already gives for the mark itself: *"the M's slant does not mirror... fixed in both reading directions."* The motion vector is the same signature angle in a different medium; treating it differently from the mark it echoes would make **Constant + Movement** disagree with itself across languages |
| **MOTION-3** | The 35° shape-cut and the 35° motion-vector share **one** per-view budget, not two | The entire discipline behind **A-012** is rarity — *"if two things are gold, one of them is wrong"* applies by the same logic to the angle. A view with both a static 35° cut **and** a moving 35° element is two gestures, not one, and dilutes exactly the restraint the system is built on. One shared budget is the reading that keeps the rule falsifiable |
| **A11Y-1** | Primary and secondary buttons keep a **border-style** distinction under `forced-colors` — primary `border-style: solid` (or native `<button>` default treatment), secondary `border-style: dashed` | Colour and background are exactly what `forced-colors` overrides; `border-style` is not a colour property and survives it. This is a real, non-derivable design decision (as `DESIGN_TOKENS.md` said when it raised this) — the choice made here is a genuine judgement call, flagged as such, not a computation |
| **A11Y-2** | Disabled state's non-colour channel is the **`disabled`/`aria-disabled` attribute itself** (already implied by the universal six-state rule) plus `cursor: not-allowed`. Reduced opacity remains the visual treatment, but is not the *only* channel any more | The semantic attribute is screen-reader-detectable — a genuinely non-visual channel, which contrast-only differentiation never was. This was already implicit in the "every component states default/hover/active/focus/disabled/loading" rule; this entry makes it explicit |
| **SEQ-1** | Sequential (6-step, single-hue gold, `#7e5c1b`→`#f2e0c0`) and diverging (7-step, info↔neutral↔danger, `#75b5d7`→`#726f64`→`#b23934`) scales defined, all steps ≥ 3 : 1 on ink (non-text data-mark threshold) | Generated in HLS, monotonic lightness end to end (the property that makes a sequential scale read correctly), built from hues already in the approved system (gold, `info`, `danger`, `ink-550`) rather than introducing new ones |
| **GRID-1** | The 1440 "wide" container is the **outer frame of the 1280 content container at its own margins** — not a second, independent width. `2xl` (≥ 1920) has **no behaviour of its own**, and is documented as such rather than left implying one | `1280 + 80 + 80 = 1440` exactly is the more parsimonious reading — it needs no new number, it falls out of arithmetic the approved figures already fix. Since the content cap already binds from 1440, saying plainly that `2xl` inherits `xl`'s capped state is honest, not evasive |
| **GRID-3** | `space-1` (2) and `space-2` (4) are reserved for **optical correction only** (icon insets, hairline offsets) — not section or component gaps. `space-7` (32) and `space-12` (160) are legitimate scale members usable outside the two named bands when neither band fits. Button padding **9 / 15** is confirmed as **10 / 16 measured inside a 1 px border** | The "two legal bands" rule (§5 of the approved 1C) constrains *sections* and *components* specifically; it was never a claim that all twelve steps must fall in one of those two bands. Naming the outliers' actual role removes the ambiguity without adding a new value |
| **ECO-1** | The DNS structure stays exactly as it is — `os.` and `ordre.` remain sibling subdomains. The brand hierarchy is expressed in **navigation and breadcrumb UI only**, never in the URL | Renesting a **live** service (`ordre.mythosprod.xyz`) under a new hostname means new DNS records, a new certificate, and redirects for something currently serving traffic — real infrastructure risk for a purely representational question. Brand hierarchy has never required URL nesting in comparable systems; UI-level nesting achieves the same legibility at zero infrastructure cost |
| **ECO-2** | `panel.mythosprod.xyz` and `tv.mythosprod.xyz` are classified as **internal infrastructure** — they carry **no** Mythos branding, mark, gold or design-system styling of any kind | Neither is a unit, a product of a unit, or an independent project under the approved architecture (**A-002**, **A-004**, **A-020**), and forcing a classification onto them that doesn't fit would be worse than naming what they actually are: operational tools that happen to sit on the Mythos domain. This requires no code change — `tv.` (Jellyfin) already carries no Mythos styling |
| **ECO-3** | The twelve projects found outside the owner's list are classified as **internal tooling / archive**, not public ecosystem projects. They do **not** appear in a future `mythosprod.xyz` hub | Evidence-based, not a guess: **none of the twelve has any recorded public domain or vhost**, live or planned, unlike the eight named projects (five live, three with a plausible path to one). Absence of any public-facing surface is the same test **A-004**'s "eight projects and future projects" already implies |
| **TYPE-2** | Two weight instances per family where the approved scale uses more than one (Plex Sans 400/600; Archivo Expanded 600 only, matching **TYPOGRAPHY.md** §2's single display weight; Plex Mono 400), subset per script independently, target ≤ 120 KB initial load per script, self-hosted | A conventional, bounded web-font budget matching the approved scale's actual usage — no weight is shipped that no approved style calls for. The **numbers** stay provisional until real font files exist to measure against; the **policy** does not need to wait |

**Left open — genuinely, not by omission:**

| Ref | Why it stays open |
|---|---|
| ~~**GRID-2**~~ | **RESOLVED 2026-08-18 by AUTO-5** — `--mythos-container-prose` set to **48ch**, superseding 1C §5's 68ch approximation on real font metrics; not owner-approved, see §0.5 AUTO-5 |
| **A11Y-1**'s exact visual weight of the dashed border, **GOLD-2**'s underlying hue choice for future extension, and any item marked "genuine judgement call, not derivable" above | Recorded as decisions made under delegated authority precisely because they could not be computed — flagged rather than disguised as derivations |
| **LOGO-1** | Unchanged by this sweep — still narrowed, not closed (see AUTO-1) |
| **C-001 / O-002** | Dar Hijama charter-versus-live-site — a real-world conflict this sweep does not touch, since resolving it means adjudicating a specific project's brand, not deriving a system rule |
| **O-003 / O-004 / O-006 / O-007 / C-004 / U-001** | Carried from the recovery era, all evidence questions (does a vhost exist, was a decision ever made) rather than design questions a sweep like this can answer |

**Authority, reversibility and scope — identical to AUTO-1/AUTO-2.** **AUTO-3, NOT owner-approved.** Every value above is a specification change only — no CSS, token artifact wiring, or application file is affected by the *decisions themselves* (the one generated artifact, `tokens.css`, is new, standalone, and unwired — see the entry above). Everything here is reversible at zero cost: a later owner review can accept, reject or amend any single row without touching any other.

### AUTO-4 — real fonts self-hosted, TYPE-2 closed, GRID-2 narrowed further with real metrics

**Trigger.** `IMPLEMENTATION_READINESS_AUDIT.md` §2.2 named font-hosting as
the one prerequisite with **zero dependency on anything else** — it did not
need the visual-regression capability that blocks C-006/MIG-1–3, and it
closes a real gap (**TYPE-2**'s numbers, left provisional by **AUTO-3**, and
**GRID-2**'s reconciliation, explicitly deferred "once fonts are
self-hosted"). Purely additive: eight new binary files plus one new CSS
file, neither referenced by any existing application or build.

**What was done.** All four owner-approved OFL families
(`TYPOGRAPHY.md` §1) downloaded from Google Fonts' own hosting — the
standard, licence-compliant way to self-host a Google Fonts family, source
unmodified — at exactly the weight instances the approved type scale
(`TYPOGRAPHY.md` §2) actually uses: Archivo Expanded 600 only; IBM Plex
Sans 400/500/600; IBM Plex Sans Arabic 400/500/600 (mirroring the Latin
roles per **A-014**); IBM Plex Mono 400. Each subset to the single script it
serves (`latin` or `arabic`), per `TYPOGRAPHY.md` §5. Files at
`assets/brand/fonts/`, declared in `assets/brand/fonts/fonts.css`, named in
new `--mythos-font-*`/`--mythos-weight-*` tokens in `tokens.css`. Full
source URLs and the exact reproduction command are in
`assets/brand/fonts/README.md`.

**Correction to AUTO-3's own TYPE-2 policy row.** AUTO-3 (line "TYPE-2"
above) stated the weight set as "Plex Sans 400/600" — **this missed the
Label style, which the approved scale (`TYPOGRAPHY.md` §2) sets in Plex
Sans **500**, not 400 or 600.** Caught while sourcing the real files against
the scale table directly. Corrected here rather than silently reshipped:
three Plex Sans weights are self-hosted (400/500/600), matching what the
scale actually specifies, and the same three for the Arabic companion.

**Budget revised on real evidence.** AUTO-3 set a provisional
"≤120 KB per script" target. Measured against the real files: the Latin set
across all three Latin-set roles (display + text + mono) is **~99.5 KB**,
inside budget. The Arabic set at full three-weight fidelity is **~133.8 KB**
— about 11% over. The alternative (drop the Arabic 500 instance) would make
Arabic Label fall back to a weight Latin Label never uses, a real fidelity
gap the same body of decisions (**A-014**) exists to prevent. **AUTO-4
revises the budget to a real, measured number — ≤140 KB per script — rather
than dropping fidelity to fit an arbitrary provisional figure.** This is the
kind of number a specification is allowed to firm up once real data exists;
it changes no owner-approved value.

**TYPE-2 — closed.** Subset ranges, weight instances and the performance
budget are now real, measured values, not provisional ones. See
`assets/brand/fonts/README.md` for the full table.

**GRID-2 — narrowed further with real metrics, still not closed.** Measured
directly from `ibm-plex-sans-400-latin.woff2` with `fontTools`: the `ch`
CSS unit (the advance width of the digit `0`) is **0.600 em** in this
typeface; the frequency-weighted average character width of real English
prose is **0.447 em** — 25% narrower. Consequence: a `68ch` box (the literal
CSS value in `GRID_AND_SPACING.md`) is 652.8 px at 16 px body size and fits
**≈91** real average characters, not 68. Even the already-narrowed
`--mythos-container-prose: 65ch` token (**AUTO-3**) is 624 px and fits
**≈87** real characters — still well past the **65** `TYPOGRAPHY.md` §2
actually asks for. Hitting 65 real characters literally would take
**≈48ch**, a materially narrower measure than either number currently in
the system. **AUTO-4 records this evidence and does not act on it**: unlike
TYPE-2, `--mythos-container-prose` traces to an **owner-approved** grid
figure (**A-009**), and choosing between "keep the existing measure, which
is defensible as within commonly-cited 45–95-character comfortable ranges"
and "narrow it to the literally-stated 65" is a real trade-off against an
owner-approved value, not a specification gap-fill. Full derivation:
`assets/brand/fonts/README.md`.

**Authority, reversibility and scope — identical to AUTO-1/AUTO-2/AUTO-3.**
**AUTO-4, NOT owner-approved.** Every file added is new, additive, and
referenced by no existing application, project, or build. Reversible at
zero cost — deleting `assets/brand/fonts/` and the token additions returns
the repository to its pre-AUTO-4 state exactly.

### AUTO-5 — GRID-2 resolved: prose measure set to 48ch, superseding 1C §5's 68ch approximation

**Trigger.** Explicit continuation instruction: resolve the remaining GRID-2
ch-width decision autonomously "using the actual self-hosted fonts,
readability, responsive behaviour, WCAG, and the approved design intent,"
recording provenance and supersession rather than silently overriding an
owner-approved value. This is a deliberate widening of what AUTO-4 declined
to do — AUTO-4 measured the evidence and stopped short of picking a number
because doing so would supersede A-009. **AUTO-5 is explicitly authorised to
make that call**, under the same delegated mandate, with the same
non-owner-approved status and the same reversibility.

**What "supersede" means here, precisely.** Two owner-approved documents
state the same underlying design goal in two different, non-interchangeable
units: `MASTER_VISUAL_IDENTITY_1C_PROPOSAL.md` §5 (behind **A-009**) writes
the implementation as **68ch**; `TYPOGRAPHY.md` §2 (behind **A-014**) states
the actual intent as **65 characters**. Both were approved; neither
document could have calibrated `ch` against real character-advance metrics
at the time, because no font file existed anywhere in this repository until
**AUTO-4**. **68ch was never an independent design goal — it was always an
unvalidated estimate of the 65-character intent**, written down before the
data needed to validate it existed. AUTO-5 does not contradict the design
intent; it corrects the one number that was always meant to implement that
intent and could not previously be checked.

**The decision.** `--mythos-container-prose` is set to **48ch**.

**Evidence, computed directly from the shipped `ibm-plex-sans-400-latin.woff2`
(fontTools, same method as AUTO-4):**

| ch value | Rendered width @ 16px | Real average characters | vs. the 65-character intent |
|---|---|---|---|
| 68ch (A-009, as written) | 652.8 px | ≈91 | +40% over |
| 65ch (AUTO-3's prior token value) | 624.0 px | ≈87 | +34% over |
| **48ch (AUTO-5)** | **460.8 px** | **≈64** | **−1.5%, effectively exact** |

**WCAG cross-check (new evidence, not in AUTO-4).** WCAG 2.2 **1.4.8 Visual
Presentation** (AAA — not a requirement at this system's stated AA floor,
but directly relevant supporting evidence since it exists for the identical
reason `TYPOGRAPHY.md` §2 states a character cap) recommends **no more than
80 characters per line**. Both 68ch and 65ch **fail this guideline outright**
(≈91 and ≈87 characters — neither is a borderline case). 48ch clears it with
real margin (≈64, 16 characters under the ceiling).

**Responsive check.** `max-width: 48ch` (460.8 px) is a **ceiling**, not a
fixed width — `GRID_AND_SPACING.md` §4.2's measured column widths show the
narrowest available column is **280 px at the 320 px breakpoint**, well
under 460.8 px, so the prose container simply fills the available column on
mobile exactly as it does today; nothing about the responsive behaviour
changes below the point where 48ch first becomes the binding constraint
(roughly the `md`/768 range upward, where the measured column width already
exceeds it). No new breakpoint, grid value or column width was introduced —
verified against the already-approved figures in §4.2, not asserted.

**Why 48ch and not some other close value.** The exact computed figure is
48.4ch (65 characters × 0.4469 em average-character-width ÷ 0.600 em
`ch`-basis width). 48 is the nearest whole `ch` — CSS custom properties in
this system are written as clean numbers throughout (see the entire spacing
and grid scale), and 48.4 vs 48 is a 0.06-character difference, well inside
any measurement's practical precision.

**What is NOT touched.** `MASTER_VISUAL_IDENTITY_1C_PROPOSAL.md` and
`TYPOGRAPHY.md` are **not edited** — the owner-approved text of both stays
exactly as written, preserved as historical record. `GRID_AND_SPACING.md`
and `tokens.css` (the derived/canonical and machine-readable layers) are
updated to carry the resolved, evidence-backed implementation value, with
this entry as the recorded provenance and supersession statement. If a
genuine owner review later prefers the literal 68ch (or any other number),
reverting is a one-line change with zero cost — nothing downstream depends
on 48ch except the two 1I prototypes that referenced the token directly
(updated in this same pass to read the token rather than a hardcoded value,
so they now track any future change automatically).

**Authority, reversibility and scope.** **AUTO-5, NOT owner-approved.**
Unlike AUTO-1–4, this entry explicitly supersedes a number written into an
owner-approved section — flagged here in the clearest terms this register
uses, not softened. It remains fully reversible: no application, no
production file, nothing outside this specification layer and two static
prototypes is affected.

### AUTO-6 — real local visual-regression tooling built and pilot-verified; MIG-1/MIG-2 rescoped on real evidence

**Trigger.** Continuation instruction item 2: inspect the actual Mythos OS
application architecture, build the safest possible visual-regression
procedure, compare the approved system against the actual application
without blindly rewriting `css/main.css`, and — if full verification isn't
safely possible — build everything needed to make the migration executable
later, clearly separated from anything actually applied.

**What was found, before any tool was built.** `css/main.css` is not a
sandbox and never was — it is the real, live, production stylesheet of
`index.html`, the actual application this repository's own `README.md`
identifies as **"Production management platform for Mythos clients (chess
school)," live at `https://uthinachess.tn/0726/Prod/`**, a PHP + vanilla-JS
SPA with real client data, invoices, and Google OAuth. This is consistent
with — not a correction of — `docs/MYTHOS_DESIGN_RECOVERY.md` §4.1, which
named `css/main.css` "the only Mythos-branded design system that exists as
implemented, committed code" from the very first recovery stage, distinct
from Uthina Chess's own separate public brand kit (§4.2, `--uc-*` tokens,
a different file entirely). **The stakes this reconfirms: this file is
genuinely, currently serving real production traffic and real client
data**, which is exactly why AUTO-2 stopped short of touching it and why
this stage builds verification tooling before attempting anything further,
not instead of caution.

**What was built.** `tools/visual-verify.js` (repo root, new) — copies the
application's static surface into an isolated OS temp directory (never
this checkout: `api.php` auto-creates `appdata/` on first request, and this
tool structurally prevents that from ever landing inside a real checkout),
serves it locally with `php -S`, seeds the browser session exactly the way
`js/auth.js`'s own `AUTH.createSession()` does (the same flag a real login
sets, written client-side — no credential guessed, no OAuth touched), then
screenshots named views with a real headless browser. **Hard-coded,
in-code guard**: refuses any host that is not `127.0.0.1`/`localhost` —
this tool cannot be pointed at `uthinachess.tn`, by construction, not by
convention.

**What was verified with it — a real pilot, not a demonstration.** The
`--gold`/`--gold-light`/`--gold-dim` custom-property declarations were
changed to the approved values (`#D9A441`/`#EBCE99`/`rgba(217,164,65,.12)`,
was `#c9a84c`/`#e4c472`/`rgba(201,168,76,.12)`) in an **isolated copy
only**, and three real views were screenshotted before and after.
Pixel-diffed (`PIL.ImageChops`): 0.04–0.54% of frame changed per view,
confined entirely to gold-coloured elements, zero layout regression. This
is the first genuinely measured, not asserted, evidence this whole program
has produced about what a `css/main.css` change actually does when
rendered.

**What the pilot also proved — real scope, larger than previously
recorded.** Grepping the actual application (not just `css/main.css`) for
the literal `#c9a84c` finds **42 occurrences across 12 files** — most of
them hardcoded inside JavaScript-generated HTML strings in the accounting
module (bank entries, purchases, suppliers, TVA validation), entirely
outside the CSS custom-property system. **MIG-1's own register statement
— "Align `--gold: #c9a84c`... a token-level change: one value" — undercounts
the real migration by 41 sites.** The same check for `MIG-2` ("the 45
Playfair Display declarations") finds **93 occurrences across 14 files** —
also undercounted, by more than half. Full mapping, file-by-file:
`docs/design/MIG_EXECUTION_MAPPING.md`.

**What this stage explicitly does NOT do.** It does not execute MIG-1,
MIG-2, MIG-3, or MIG-4. It does not modify `css/main.css`, any JS file, or
`index.html` in the tracked repository — every change from the pilot lived
only in a temporary, isolated copy, deleted after the run. It does not
claim the CSS-property-only pilot result generalises to a safe full
migration — the 39 remaining JS/HTML literal sites are explicitly
unverified, and the pilot's three views never reached the
accounting/fournisseurs modules where most of them concentrate. **This
mirrors AUTO-2's original discipline exactly, with one real difference: a
verification capability now exists where none did, and the honest scope of
two migrations is now measured instead of estimated.**

**Corrections to prior documents, recorded not silently applied.**
`MYTHOS_DESIGN_DECISIONS.md`'s MIG-1 and MIG-2 statements (§ recovery-era
register, "Not yet actioned" table) described a 1-value swap and "45
declarations" respectively — both now shown, by direct measurement, to
understate the real scope. Corrected in `MIGRATION_PLANS.md`,
`IMPLEMENTATION_READINESS_AUDIT.md`, and this entry, with the original
statements left visible rather than deleted (their register rows are
struck through and annotated, not removed).

**Authority, reversibility and scope.** **AUTO-6, NOT owner-approved.**
The tool itself is new, additive, untracked by any build (this repository
has none, by design — `README.md`), and inert unless deliberately invoked
— it does not run automatically, and running it touches only a temporary
directory outside the repository. Fully reversible: deleting
`tools/visual-verify.js` and `docs/design/MIG_EXECUTION_MAPPING.md`
returns the repository to its pre-AUTO-6 state exactly.

### AUTO-7 — MIG-1 executed: the Mythos Gold migration applied to the live application's source, verified, not deployed

**Trigger.** Explicit continuation instruction naming MIG-1 as the first
"READY" item to execute for real, with specific governance: no blind
global replacement, preserve public-project identity under A-006/A-021,
visual regression before and after, review every changed view, rollback if
unacceptable.

**Scope re-audited before touching anything, found larger than AUTO-6's own
count.** AUTO-6's "42 occurrences, 12 files" was a **line** count that
missed the `rgba(201,168,76,ALPHA)` dim variant entirely — the real,
occurrence-exact count is **331 substitutions across 16 files**. Full
breakdown: `docs/design/MIG_EXECUTION_MAPPING.md` §2a.

**What was applied — a deterministic value substitution, not a guess.**
`#c9a84c`→`#D9A441`, `#e4c472`→`#EBCE99` (gold-200), and
`rgba(201,168,76,ALPHA)`→`rgba(217,164,65,ALPHA)` with the exact original
alpha preserved per occurrence — every source literal maps to exactly one
approved target, with no inference about which "role" (base/light/dim) an
occurrence plays, because the literal value itself already encodes that.
This is why it is not the "blind global replacement" the instruction
warned against: a blind replacement would be a broad pattern risking
unintended matches; this is an exact, closed set of three literal values,
verified by a full re-grep after substitution to show zero remaining trace
and zero false positives (checked: no non-colour use of any of the three
values exists anywhere in the touched surface).

**Two real bugs caught and fixed before commit, not discovered after:**
1. **Line-ending corruption** — the first substitution pass used
   Python's default text-mode I/O, which silently converted three files'
   native CRLF endings to LF, turning a targeted change into a spurious
   multi-thousand-line diff. Caught by the diff size being implausible for
   the stated change, confirmed byte-for-byte, fixed by disabling
   Python's newline translation and redoing from a clean revert.
2. **An orphaned DOM selector** in `js/shared/accounting-bank.js` matched
   a *truncated* rgba fragment (`'div[style*="rgba(201,168,76"]'`, no
   closing paren) used as a CSS attribute-contains selector — invisible to
   an exact-value regex expecting a complete `rgba(...)` call. Left
   unfixed, it would have silently broken a UI separator's rendering with
   no thrown error the moment the real style values changed underneath it.
   Found by re-grepping for any remaining trace of the old value in *any*
   form after the main substitution, not by assuming completeness.

**A-006/A-021 — confirmed not implicated, not merely assumed.** This
codebase is not itself one of the eight public projects those rules
protect — it is Mythos's own internal application (`docs/MYTHOS_DESIGN_RECOVERY.md`
§4.1; `README.md`), the thing MIG-1 was always about aligning *to* the
Mythos identity, not a project whose *own* identity needed protecting from
it. Uthina Chess's actual public brand kit lives in an entirely separate
file (`uthina-theme.css`, `--uc-*` tokens, Imperial Gold `#D9A441` — a
different value already, by the charter's own original design), untouched
by this migration.

**Verification, real:** `node --check` clean on all 13 touched JS files;
zero remaining trace of any old value; CRLF preserved exactly where it
existed. `tools/visual-verify.js`, extended this stage with a `sv:<view>`
mode reaching the real router (`js/core/router.js`'s `showView`), captured
**16 real views** before and after — dashboard through every accounting
module (bank, cash, expenses, purchases, suppliers, categories,
reconciliation, fournisseurs, natures, representations). Pixel diff
0.21%–1.53% of frame per view, confined to gold-coloured chrome; the three
highest-diff views manually reviewed with zero layout, text, or non-gold
colour change. Browser console checked across all 11 accounting views:
3 external network errors (Google Fonts CDN, pre-existing, unrelated),
**zero JS logic errors**.

**What this explicitly is not.** Not a deployment — the changes are
committed to this repository's `main` branch only; production
(`uthinachess.tn`) is a separate host reached only by a manual,
operator-triggered `rsync` (`README.md`'s own documented process), which
this session has no access to and did not attempt. Not a claim that MIG-2,
MIG-3, or MIG-4 are done — each remains exactly as recorded elsewhere in
this register.

**Authority, reversibility and scope.** **AUTO-7, NOT owner-approved.**
Reversible with a single `git revert` of the migration commit — every one
of the 331 values traces to exactly one prior literal, no derived state,
no stored data touched (`appdata/` does not exist in this checkout).

### AUTO-8 — MIG-2 attempted and rolled back: a real, found regression, not a guess pushed through

**Trigger.** Continuation instruction naming MIG-2 as the second item to
execute, with explicit governance: use the self-hosted approved fonts,
verify Arabic and Latin rendering, run visual regression.

**What was done, mechanically sound.** All 93 real occurrences of
`font-family: 'Playfair Display', serif` (including two backslash-escaped
variants inside JS string literals) substituted to `'Archivo Expanded',
sans-serif`, with every co-located `font-weight` normalized to the
approved system's single display weight, **600** (`TYPOGRAPHY.md` §2) —
a deliberate choice not to self-host the five legacy weights (500–900)
Playfair happened to carry, reasoned as preserving unconsidered accretion
rather than honouring the approved system's own "one weight" display
restraint. One real bug (a mis-positioned escape character breaking three
JS files) caught by `node --check` and fixed before proceeding, same
discipline as AUTO-7.

**Arabic — checked directly, not assumed clear.** Real Arabic text exists
in this application. Confirmed via Google Fonts' own API that Playfair
Display has no Arabic subset — identical to Archivo Expanded. Arabic
rendering is provably unaffected by this migration either way.

**The regression, found by the verification this program insists on.** 17
real views screenshotted before/after and pixel-diffed. Most were clean.
Two selectors (`.compta-kpi`, `.stat-value` — the accounting dashboard's
headline TND figures, 30px/800) **wrap to two lines under Archivo
Expanded where Playfair Display fit them on one**, visibly misaligning
that card's height against its row siblings. Confirmed by direct
before/after comparison, not inferred.

**Rolled back completely, not patched.** Fixing the wrap means resizing
components to fit a different typeface's metrics — a new design decision
this migration was never authorised to make unilaterally, and one that
would need checking against every other large-display Playfair usage, not
just the one found. `git checkout --` on all 15 touched files; confirmed
byte-identical to the pre-attempt state.

**Why this is the correct outcome, not a failure to complete.** The
continuation instruction's own governance says exactly this: run visual
regression, review every changed view, **roll back immediately if the
result is unacceptable**. A found, real, visible layout regression in a
live financial application's headline figures is exactly that case. MIG-1
succeeded because real verification found the change was clean; MIG-2's
verification found it was not, at two specific selectors — and the
process worked precisely as designed either way.

**MIG-2 status: READY (mechanism proven, Arabic confirmed unaffected),
BLOCKED on one real, narrow, findings-backed question** — accept the
KPI-card wrap, resize the two affected classes (and audit others like
them), or some other resolution. Full record: `docs/design/
MIG_EXECUTION_MAPPING.md` §3a.

**Authority and reversibility.** AUTO-8, not owner-approved — and in this
case, nothing to reverse, since nothing was kept. The register entry
itself is the deliverable: an honest account of what was tried and why it
was undone.

### AUTO-9 — MIG-3 partially executed; MIG-4 checked and left blocked with evidence, not a guess

**Trigger.** Continuation instruction naming MIG-3 (complete the semantic-
token mapping, apply only supported cases, leave ambiguous cases
documented) and MIG-4 (proceed only if Command Center can be validated
safely, otherwise leave READY/BLOCKED with exact evidence) as the last two
independent items.

**MIG-3 — mapped completely, applied where an approved target exists.**
`A-015` names three contrast-failing tokens: `--danger` (3.55:1), `--muted`
(3.47:1), `--past` (2.59:1). Real usage mapped: `--muted` 73×, `--danger`
2×, `--past` 3×, each a single-source `:root` declaration. **Applied:**
`--muted` → `#A8A498` (the corrected secondary-text value `COLOR_SYSTEM.md`
names explicitly as this exact fix); `--danger` → `#F1706A` (A-015's
corrected dark-ground value — Mythos Prod is dark-only, no theme
ambiguity). **Left open, not guessed:** `--past` has no approved
correction — it is not one of the four semantic roles A-015 actually
corrects, only evidence that the current value fails; applying an
invented replacement would be the exact "blind guess" this mandate
forbids. The control-border token (**A-016**) was also left open —
`--border` is used broadly as a decorative border throughout the
application, not specifically for the 3:1 control boundary A-016
corrects, and applying A-016's value globally would be a much larger,
likely-wrong change than what was asked. Full record:
`docs/design/MIG_EXECUTION_MAPPING.md` §4.

**Verification.** Pure colour-value changes, the same low-risk category as
MIG-1: 17 real views screenshotted before/after, diffs 0.73–1.46% of
frame (in MIG-1's range, well below MIG-2's typeface-driven 1.28–6.51%),
highest-diff views manually reviewed clean. **Coverage gap named
honestly:** `--danger` and `--past` were not visually exercised — the
isolated test instance's empty data has no error state or past-dated
entry to render either style. Reasoned as low-risk by analogy (pure
foreground-colour, no layout property), not confirmed by observation, and
recorded as such.

**MIG-4 — checked, left BLOCKED, not attempted.** Three convergent facts,
not one assumption: (1) **A-020**'s own text — "this approval is
classification only... no code, CSS, asset, deployment or branding was
changed" — never authorised implementation. (2) This session's own
standing instruction, never superseded: never touch MCC-1. (3) MCC-1 is
**confirmed live, deployed, and serving real public traffic** at
`ordre.mythosprod.xyz` — real DNS, a real TLS certificate, a real
database, running from the live checkout — not a reference/stub the way
`mythos-os-console`'s pilot target is. No file under
`projects/command-center/` was read or touched to reach this conclusion.
Full record: `docs/design/MIG_EXECUTION_MAPPING.md` §5a.

**Authority, reversibility and scope.** **AUTO-9, NOT owner-approved.**
MIG-3's two applied changes are single-value CSS substitutions,
reversible with one `git revert`, identical in kind to MIG-1's pattern.
MIG-4 has nothing to reverse — nothing was done.

### AUTO-10 — C-006 executed for the console surface: mythos.css reconciled, the red suite AUTO-7/9 left behind is green again

**Trigger.** Final-mission continuation (2026-08-19) naming C-006 as READY.
Running the suites first — the mission's own EVIDENCE step — found
something sharper than "ready": **`main` had been RED (414/419) since the
AUTO-7/AUTO-9 merges.** `tests/mos-1-console-test.js`'s drift rule reads
the D-001 palette live from `css/main.css` and requires `mythos.css` to
carry it verbatim; when MIG-1/MIG-3 migrated `css/main.css`'s
gold/gold-light/gold-dim/muted/danger, the console correctly drifted out
of compliance. **AUTO-7/AUTO-9 never ran this suite — an honest miss,
recorded here, found by this pass's own first check.** The drift alarm
worked exactly as designed: it forced this reconciliation.

**What was applied to `projects/mythos-os-console/reference/web/mythos.css`:**
the five drifted tokens updated to the canonical values (`#D9A441`,
`#EBCE99`, `rgba(217,164,65,0.12)`, `#A8A498`, `#F1706A`); the derived
tokens that follow them (`gold-line`/`gold-line-2` hairlines,
`danger-dim` 12% companion → `rgba(241,112,106,0.12)`, `shadow-gold`);
**26 hardcoded gold rgba literals, 1 gold-light rgba literal, 5 danger
rgba literals** — alpha preserved exactly, same deterministic method as
MIG-1; and the three provenance comment blocks updated to record the
history (D-001 values, MOS-1.1's measurements, the old danger-text
rationale) rather than describe values that no longer exist.
`--mythos-text-secondary` (#999) and `--mythos-danger-text` (#ff8c82)
retained unchanged for composition-layer stability — both still pass AA;
nothing that composes against them shifts.

**Test narrowings — the suite's established pattern, never deletion:**
three value-coupled assertions updated with their history kept in the
labels: the hardcoded old `danger-dim` expectation; the hardcoded old
`--muted: #6b6860` expectation (which had become mutually unsatisfiable
with the suite's own live-drift rule); and the "recorded honestly:
--muted as body text FAILS AA" informational assertion, which now
asserts it **clears** AA — because with the corrected A-015 value it
genuinely does, and asserting the old failure would be asserting a
falsehood.

**Verification.** Suite **419/419** (was 414/419 on `main`). Console
shell served statically and driven with a real headless browser:
computed custom-property values read from the live DOM match the six
canonical values exactly; before/after screenshots diff **1.26%** of
frame, confined to gold-toned chrome, layout intact. (The console's own
`tools/visual-verify.js` hangs in this sandbox — its bare
`chromium.launch()` cannot run as root without `--no-sandbox`; an
equivalent check with the proven launch pattern was used instead, and
the limitation is recorded rather than glossed.) Executor suite 158/158;
orchestration 255/257, the 2 failures being VPS-only systemd-unit
existence checks that cannot pass in a sandbox — environmental, verified
by reading the assertions, not assumed.

**What C-006 now is.** The canonical-versus-console conflict AUTO-2 named
is **resolved for every value the drift rule governs** — the two files
are verbatim-identical again, enforced by tests. Remaining, explicitly:
the console's own *extended* tokens (spacing, radius, typography — Playfair/
Inter, which the console inherited from the pre-migration app) are not
governed by the drift rule and not reconciled by this entry; the console
typography question follows MIG-2's resolution, not this one.

**Authority, reversibility, scope.** **AUTO-10, NOT owner-approved.**
One `git revert` restores every value; the drift test would then go red
again, which is the correct alarm in both directions.

### AUTO-11 — MIG-2 executed: the typography migration, solved by role separation, not by shrinking type

**Trigger.** Final-mission instruction: solve the Archivo/TND KPI wrapping
regression professionally — evaluate layout, number formatting, container
behaviour and typography; do not shrink typography to hide it; preserve
the approved type system.

**The chief-architect decision that unblocked it.** AUTO-8's regression
happened because the legacy app conflates two roles in one typeface:
Playfair Display carried both *headings* (words) and *financial figures*
(numbers). The approved system already separates them — the display face
carries headings; **the Data role carries financial and numeric values**
(`TYPOGRAPHY.md` §2: IBM Plex Mono, tabular figures — stated for exactly
this reason: "tabular figures for financial and technical tables"); the
Label role (Plex Sans 500, uppercase, tracked) carries small table
headers. AUTO-8's attempt pushed *everything* into the display face,
which is what wrapped the KPI money figures. The professional resolution
is the role split the system always intended — no typography was shrunk;
every size is exactly what it was.

**Execution: all 93 sites classified individually, line-keyed, and
verified before substitution** (`--apply` aborts on any line whose
content does not match the classification): **44 display sites** →
`'Archivo Expanded'`, weight normalised to the approved 600; **6 label
sites** (the five `*-list-table th` rules + `.month-group`) →
`'IBM Plex Sans'`, weight 500; **43 numeric sites** (money via
`fmtMoney`, KPIs, day/date numerals, times, invoice/contract reference
IDs) → `'IBM Plex Mono'`, weight 400. Multi-line rules
(`css/professional.css` ×7, `css/dashboard.css`, `js/auth.js`'s injected
login CSS) had their weights normalised in a second targeted pass the
line-keyed script cannot reach. `index.html` drops the Playfair CDN
request and loads the self-hosted `assets/brand/fonts/fonts.css`
(Archivo Expanded 600, Plex Sans 400/500/600 + Arabic, Plex Mono 400 —
all AUTO-4 files). **Inter remains the body face** — its migration to
IBM Plex Sans is a real, separate step recorded as remaining, not
smuggled into this one.

**A bug AUTO-8 already taught, re-made, and re-caught.** The
substitution template again mis-positioned the backslash on
escaped-quote sites inside JS template strings (5 sites, 3 files) —
caught immediately by `node --check`, exactly as in AUTO-8, fixed before
verification. Recorded because repeating a known bug is worth more
embarrassment than the first occurrence.

**Verification.** `node --check` clean on all 11 touched JS files; zero
`Playfair` references outside the one explanatory comment; CRLF
preserved byte-exact in the four files that carry it. **17 real views
before/after**: diffs 1.32–6.30% (typeface-change footprint), every view
chief-reviewed — and the decisive one, `comptabilite`: **"6545.000 TND"
renders on ONE line in IBM Plex Mono, all three KPI cards
height-aligned** — the exact AUTO-8 regression, solved. Dashboard's 54px
day numeral, countdown cells, natures/representations table headers,
category cards: all render correctly, no wrap, no overflow, no layout
shift. Zero JS console errors across all accounting views (3
pre-existing external-CDN network failures only, unchanged).

**MIG-2: EXECUTED.** Remaining, recorded honestly: body face Inter →
IBM Plex Sans (separate assessment); the console's own Playfair/Inter
declarations (`mythos.css` — its drift rule does not govern typography;
follows the same role-split when scheduled); true self-hosted-font
rendering of Archivo/Plex verified in the isolated instance (fonts load
from `assets/brand/fonts/`), while Inter still rides its CDN.

**Authority, reversibility, scope.** **AUTO-11, NOT owner-approved.**
One `git revert` restores all 93 sites, the weight normalisations, and
the font links. Not deployed — production untouched.

### AUTO-12 — MIG-3 completed + the sweep's two accessibility findings fixed

**Trigger.** Final-mission items: complete MIG-3's remaining tokens where a
principled mapping exists; fix the responsive sweep's two findings.

**`--past` — resolved by role mapping, not an invented value.** AUTO-9
left `--past: #555` (2.59:1) open because A-015 corrects four semantic
roles and "past" is not one of them. The principled mapping exists one
level up: a past-dated calendar entry is **de-emphasised by design** —
the approved system's `text-disabled` role (`ink-400`, `#7A776C`,
"deliberately below body contrast — disabled/non-text glyphs") is that
exact role. `--past` → `#7A776C`, `--past-dim` → its 12% companion
`rgba(122,119,108,0.12)` (the D-001 universal pairing), one literal
`rgba(85,85,85,0.2)` hairline follows. `mythos.css` follows in lockstep
— the C-006 drift rule now enforces this pairing automatically, and the
console suite stayed **680/680** through the change. This is a mapping
to an existing approved role token, with the same "below body contrast
by design" semantics the source rule documents — not a new colour.

**A-016 — the conforming control boundary, applied to actual controls
only.** The stylesheet's `input, select, textarea` rule carried
`border: 2px solid rgba(217,164,65,0.15)` — roughly 1.2:1 composited,
the precise "no conforming border anywhere" defect A-016 (owner-approved)
names. A `--control-border: #726F64` token (3.84:1 dark-ground, A-016's
value) is declared and applied there. Additionally, **22 JS-inline and
HTML-inline form controls** carrying `border:1px solid #333` (~1.5:1) —
the accounting/fournisseurs/documentation filter inputs and selects —
were switched to `var(--control-border)`, matched strictly on lines that
render an `<input` or `<select`; decorative `#333` borders on cards,
menus and images were deliberately left (A-016 governs control
boundaries, not decoration — the earlier AUTO-9 caution about blast
radius is honoured by this exact scoping).

**A-022 — the 44px touch floor.** `.nav-btn` gains `min-height: 44px`;
re-measured live at 375px: all 11 sidebar buttons now exactly 44px (were
38–39px, the sweep's finding).

**A-018 — reduced motion exists now.** `css/main.css` gains the
`prefers-reduced-motion: reduce` block (owner-approved requirement the
legacy surface never implemented — the sweep found zero support
repo-wide). First verification caught a real specificity fight:
`index.html`'s inline `.nav-btn` transition is declared `!important` at
higher specificity than the universal rule, so the preference lost
there; fixed with an explicit `button.nav-btn` override and re-verified
live — `transitionDuration` collapses to `1e-05s` under the emulated
preference.

**Verification.** Console suite 680/680 (lockstep drift held); 5 real
views before/after (1.77–2.05% diffs — nav-height + control-border +
past-tone footprint), fournisseurs/bank/cash form panels re-screenshotted
after the inline-control pass; `node --check` clean on the 5 touched JS
files; touch-target and reduced-motion re-measured in a live browser as
above. **Honest residual:** `--past`-styled calendar entries and
`--danger` error states are still not visually exercised by the empty
test data (same caveat as AUTO-9, unchanged); the fix is verified at the
token/computed-style level, by analogy to the same-category changes that
were screenshot-verified.

**Authority, reversibility, scope.** **AUTO-12, NOT owner-approved**
(though every value applied is itself owner-approved — A-016's boundary
value, A-018's requirement, A-022's floor, and the approved disabled
role; what is delegated is the decision to apply them here). One
`git revert` restores everything. Not deployed.

### Stage 1I — design prototypes delivered

**Not a decision — a deliverable, recorded for completeness.** Seven
self-contained static HTML prototypes, matching the seven areas the original
programme brief named (§23): master brand, `mythosprod.xyz` hub, Mythos OS,
a business-unit example, a public-project example, mobile experience,
component showcase. `docs/design/prototypes/`, indexed by its own `README.md`.

**Every prototype uses only owner-approved or AUTO-\* values** — nothing new
was invented to build them. Two things were deliberately kept visible rather
than smoothed over: the Mythos OS prototype is a **new, standalone file**, not
a touch to `css/main.css` (consistent with **AUTO-2**'s finding); and the
business-unit example states, in the page itself, that Mythos Digital has
**zero recovered evidence (O-004)** — a prototype of the descriptor system, not
a claim the unit exists. Not deployed; referenced by no application.

### Stages consolidation, readiness audit, migration plans — delivered

**Not decisions — three deliverables, mandate items 6–8, recorded for
completeness.** `docs/design/MYTHOS_DESIGN_SYSTEM.md` (a single topic-ordered
reference over 1C–1I and AUTO-1–3, introducing no new value — reasoning stays
in the source documents, this one is authoritative for the value itself);
`docs/design/IMPLEMENTATION_READINESS_AUDIT.md` (the honest finding: **nothing
in this program has been implemented or verified in any running application,
anywhere** — every readiness-table cell for "implemented" and "verified" is
empty, and five concrete prerequisites are named, none satisfied yet — as of
this stage; two are now closed and one partly closed, see **AUTO-4/5/6**);
`docs/design/MIGRATION_PLANS.md` (a plan per project and Mythos-owned surface,
calibrated to the evidence-based ledger — most public-project plans reduce
honestly to "ecosystem strip only, if wanted" or "no action," since **A-006**
already forbids the skin migration and three projects have open factual
questions, **O-006/007/002**, that precede any design question).

**None of the three authorises or executes anything.** The readiness audit in
particular is deliberately a finding, not a plan — it names what would have to
be true, not a schedule for making it true.

---

## 1. Confirmed decisions

### D-001 — Mythos OS dark-and-gold token system

| Field | Value |
|---|---|
| **Project** | Mythos OS |
| **Decision** | The application UI is a dark, near-black stepped surface system (`#0e0e0e` → `#161616` → `#1d1d1d`, border `#2a2a2a`) with a single gold accent `#c9a84c` (light `#e4c472`, dim `rgba(201,168,76,0.12)`) and warm off-white text `#e8e4dc`. Six semantic colours each pair a solid with a 12 %-alpha `-dim` variant |
| **Source** | `css/main.css` `:root` block |
| **Evidence** | 252 custom-property occurrences; token block read directly |
| **Date / commit** | `d1a9d19`, 2026-07-29 (initial import); unchanged since |
| **Status** | **CONFIRMED** |
| **Affected** | Entire Mythos OS product UI, 8 stylesheets, 72 JS modules |
| **Notes** | Only `d1a9d19` and `09d5fe1` have ever touched `css/` or `assets/`. The visual layer has never been revised. **The rationale — why gold, why dark — is nowhere recorded** (see U-001) |

### D-002 — Uthina Chess luxury Roman/chess identity

| Field | Value |
|---|---|
| **Project** | Uthina Chess |
| **Decision** | Luxury identity fusing Roman history, chess, theatrical lighting, black and gold, Roman stone and night sky. Nine official colours: Onyx Black `#050505`, Roman Night `#08111C`, Imperial Gold `#D9A441`, Deep Gold `#B8862B`, Soft Gold `#F2C86B`, Stone Ivory `#F7F0E3`, Marble Gray `#D8D0C2`, Antique Gray `#8B8377`, Panel Black `#0B0B0B`. Typography: Latin display Cinzel/Trajan Pro/Georgia, Arabic display Noto Kufi Arabic/Amiri/Cairo/Tahoma, body Inter/Segoe UI/Arial |
| **Source** | `VPS_TRANSFER/Uthina Chess/site/Uthina_Chess_Brand_Kit/CHARTE_GRAPHIQUE.md` |
| **Evidence** | Charter read in full **and** implementation confirmed: `/var/www/uthinachess/0726/Uthina_Chess_Brand_Kit/assets/css/uthina-theme.css` declares all nine colours as `--uc-*` and all three font stacks verbatim |
| **Date / commit** | Brand kit dated 2026-06-29; **not in Git** |
| **Status** | **CONFIRMED — documented and implemented** |
| **Affected** | `uthinachess.tn` (live) |
| **Notes** | The only project in the portfolio where a written charter is demonstrably implemented. Charter states explicitly that **no font files ship in the pack** — the fonts are aspirational unless installed |

### D-003 — Uthina Chess page hierarchy

| Field | Value |
|---|---|
| **Project** | Uthina Chess |
| **Decision** | Hero (logo, title, countdown, registration CTA) → Details (date, venue, tournament type) → Registration form (surname/name, phone, email, club/region, category/age) |
| **Source** | `CHARTE_GRAPHIQUE.md` § بنية الموقع |
| **Evidence** | Charter section read directly |
| **Date / commit** | 2026-06-29; not in Git |
| **Status** | **CONFIRMED** |
| **Affected** | `uthinachess.tn` |
| **Notes** | The only documented UX decision in the entire portfolio |

### D-004 — Uthina Chess geometry and glow tokens

| Field | Value |
|---|---|
| **Project** | Uthina Chess |
| **Decision** | `--uc-radius-xl: 28px`, `--uc-radius-md: 14px`, `--uc-shadow-gold: 0 0 38px rgba(217,164,65,.32)` |
| **Source** | `uthina-theme.css` `:root` |
| **Evidence** | Read directly from the deployed stylesheet |
| **Date / commit** | Not in Git |
| **Status** | **CONFIRMED — implemented, not in the written charter** |
| **Affected** | `uthinachess.tn` |
| **Notes** | Implementation exceeds its charter. The gold glow is the portfolio's only recovered elevation/atmosphere token |

### D-005 — Dar Hijama house-and-cup concept and palette

| Field | Value |
|---|---|
| **Project** | Dar Hijama |
| **Decision** | Logo is a simple fusion of a house and a hijama cup, expressing home service, trust, traditional care and digital legibility. Palette: primary green `#16A34A`, turquoise accent `#14B8A6`, soft gray `#6B7280`, dark text `#2F3437`, white `#FFFFFF`, monochrome black `#111111`. Typography: Arabic Noto Sans Arabic/Cairo/IBM Plex Sans Arabic; Latin Inter/Manrope |
| **Source** | `VPS_TRANSFER/darhijama/assets/dar-hijama-piste1-charte-corrigee.txt` |
| **Evidence** | Charter read in full; 15 matching asset files present |
| **Date / commit** | Files dated 2026-07-28; **not in Git** |
| **Status** | **CONFLICTING** — see C-001. Documented but **not implemented** |
| **Affected** | `darhijama.tn` |

### D-006 — Dar Hijama clear-space and minimum-size rules

| Field | Value |
|---|---|
| **Project** | Dar Hijama |
| **Decision** | Minimum protection zone X around the logo, where X = the height of the cup's upper point. Minimum sizes: full logo 120 px screen / 25 mm print; icon alone 64 px screen / 12 mm print |
| **Source** | Same charter |
| **Evidence** | Read directly |
| **Date / commit** | 2026-07-28; not in Git |
| **Status** | **CONFIRMED as a decision** (application unverified) |
| **Affected** | Dar Hijama logo usage |
| **Notes** | **The only clear-space and minimum-size rules in the entire portfolio.** The nearest thing to a reusable brand standard that Mythos possesses |

### D-007 — Dar Hijama Arabic text vectorised

| Field | Value |
|---|---|
| **Project** | Dar Hijama |
| **Decision** | Arabic text converted to vector outlines in the final SVGs, so `دار حجامة` renders correctly even where the Arabic font is not installed. Editable SVGs retained separately for future modification |
| **Source** | Same charter, § "Correction appliquée" |
| **Evidence** | Read directly; both vectorised and `-editable` SVG variants present |
| **Date / commit** | 2026-07-28; not in Git |
| **Status** | **CONFIRMED** |
| **Affected** | All Dar Hijama SVG assets |
| **Notes** | A solved bilingual-rendering problem, recorded with its fix. Directly reusable by any future Arabic-facing Mythos project |

### D-008 — Dar Hijama asset format ladder

| Field | Value |
|---|---|
| **Project** | Dar Hijama |
| **Decision** | Ship vectorised SVG (final) + editable SVG (source) + transparent PNG at 512/1024/2048 + 64 px favicon; provide principal, horizontal, icon-only and monochrome black/white variants |
| **Source** | Charter § Fichiers; 15 files verified present |
| **Evidence** | Directory listing of `VPS_TRANSFER/darhijama/assets/` and `/var/www/darhijama.tn/assets/` |
| **Date / commit** | 2026-07-28; not in Git |
| **Status** | **CONFIRMED** |
| **Notes** | The most complete asset delivery in the portfolio and the only full vector suite. `mythos-prod` tracks **no SVG at all** |

### D-009 — SsangYong storefront consumes the catalog API natively

| Field | Value |
|---|---|
| **Project** | SsangYong |
| **Decision** | Storefront reads the live catalog API directly rather than duplicating catalogue data |
| **Source** | Commit `9763241` (SYA-SHOP-1) |
| **Evidence** | Commit subject and stage record `ad16620` |
| **Date / commit** | `9763241` |
| **Status** | **CONFIRMED** |
| **Affected** | `ssangyong.autos`, `projects/ssangyong-autos/reference/shop.{html,css,js}` |

### D-010 — Design QA by headless-browser visual verification

| Field | Value |
|---|---|
| **Project** | SsangYong (precedent) |
| **Decision** | Layout is verified by driving a headless browser against the rendered page, not by inspecting source |
| **Source** | Commits `1bcba2c` (three layout defects fixed) and `00a70b2` (stage record) |
| **Evidence** | Commit subjects; three real defects found this way |
| **Date / commit** | `1bcba2c`, `00a70b2` |
| **Status** | **CONFIRMED — applied once, never generalised** |
| **Notes** | The portfolio's only recovered design-QA method. Never adopted as a standard for other projects |

### D-011 — Logo assets restored from verified transfer

| Field | Value |
|---|---|
| **Project** | Mythos OS |
| **Decision** | `logomythos.png`, `logo.png`, `logo-sdt.png`, `logo-kacem.png` are canonical and are tracked in Git, recovered from `VPS_TRANSFER` with SHA-256 confirmation |
| **Source** | Commit `09d5fe1` |
| **Evidence** | Commit body: the app referenced five logos from `js/app.js`, `js/app-fresh.js`, `js/shared/devis.js`; only one resolved before the fix |
| **Date / commit** | `09d5fe1`, 2026-08-13 |
| **Status** | **CONFIRMED** |
| **Notes** | Establishes `assets/logos/` as the canonical logo location for the Mythos OS application |

### D-012 — Mythos OS design system extracted as a reusable shell layer

| Field | Value |
|---|---|
| **Project** | Mythos OS |
| **Decision** | The D-001 token system is re-declared under a `--mythos-*` namespace in `projects/mythos-os-console/reference/web/mythos.css`, together with the component idioms `css/main.css` already implements (nav rail, button set, card surface, KPI, page header, section rule, pill, detail row). Composition layers may not declare a colour literal; a missing colour is a missing token |
| **Source** | Stage MOS-1; `docs/MYTHOS_OS_DESIGN_SYSTEM.md` |
| **Evidence** | Every colour value is read out of `css/main.css` at test time and matched, so the extraction cannot silently drift from D-001 — `tests/mos-1-console-test.js` |
| **Date / commit** | 2026-08-18, stage MOS-1 |
| **Status** | **CONFIRMED — implemented** |
| **Affected** | `os.mythosprod.xyz` and every future MYTHOS OS module |
| **Notes** | An extraction, not a revision. `css/main.css` is **not modified**; the namespace lets both coexist. Records three additions that are new rather than recovered and are tagged as such in the specification: a spacing scale (U-004 had none), a mono stack, and `--danger-dim` completing a pairing `main.css` leaves one short. Does **not** touch C-004 or O-001 — this is Mythos OS extending its own confirmed identity, not a cross-project decision |

### D-013 — Gold means the owner is being waited on

| Field | Value |
|---|---|
| **Project** | Mythos OS |
| **Decision** | In an operational surface, each state colour carries a fixed meaning: **gold** = awaiting the owner · blue = in flight · green = finished well · danger = finished badly · orange = paused by a limit, will self-resume · purple = declared, not started · grey = inert. Gold is reserved for owner attention and used for no other state. Every status renders as a colour **and** a word |
| **Source** | Stage MOS-1; `docs/MYTHOS_OS_DESIGN_SYSTEM.md` §6 |
| **Evidence** | Implemented in `mythos.css` `.mythos-badge.is-*` and `app.js` `STATE_CLASS`; the colour-and-word rule follows `docs/MYTHOS_COMMAND_CENTER_ARCHITECTURE.md` §7 |
| **Date / commit** | 2026-08-18, stage MOS-1 |
| **Status** | **CONFIRMED — implemented. NEW, not recovered** |
| **Affected** | Every MYTHOS OS operational surface |
| **Notes** | The only genuinely new design decision in MOS-1. It introduces no colour — it assigns operational meaning to the existing D-001 palette. It does **not** answer U-001 (why gold); it gives the accent a defined job in this context. Also records the console's governing interface rule: an empty result and an unreadable one must never look alike |

### D-014 — Secondary text uses a readable tone, not `--muted`

| Field | Value |
|---|---|
| **Project** | Mythos OS |
| **Decision** | `--muted` `#6b6860` is not used as text. Secondary text — labels, metadata, inactive navigation, timestamps — uses `--mythos-text-secondary` `#999`. Badge text for a semantic solid uses a lightened tint of that solid, never the solid itself |
| **Source** | Stage MOS-1.1; `docs/MYTHOS_OS_DESIGN_SYSTEM.md` §8.1 |
| **Evidence** | **Measured, not asserted.** `--muted` computes 3.03–3.47:1 against the three D-001 grounds — below WCAG 2.1 AA (4.5:1) everywhere it appears as text. `#999` is recovered from `index.html:125` and `#888` from `css/dashboard.css:75`, the two places the application already reaches for a lighter grey when a muted label must actually be read. `projects/mythos-os-console/tools/contrast.js` computes it; `tests/mos-1-console-test.js` enforces it; `tools/visual-verify.js` confirms it in-browser against computed styles |
| **Date / commit** | 2026-08-18, stage MOS-1.1 |
| **Status** | **CONFIRMED — implemented and enforced** |
| **Affected** | Every MYTHOS OS surface built on the shell |
| **Notes** | **No D-001 token was changed.** `--muted` remains declared verbatim so the shell carries the complete palette; what changed is which token is used where. Ends the portfolio-wide "contrast was not measured and no claim is made" disclaimer for this surface only: 26 of 26 rendered pairs meet AA, 12 meet AAA. Two things are recorded and deliberately NOT fixed — `--muted` is below AA as text throughout the live application (a `css/main.css` change, its own stage), and `--border` at 1.17–1.34:1 is decorative, outside WCAG 1.4.11, which governs boundaries needed to identify or operate a control; the console has no form control at all |

---

## 2. Conflicting decisions

### C-001 — Dar Hijama: charter vs live site

| Field | Value |
|---|---|
| **Project** | Dar Hijama |
| **Conflict** | D-005 specifies green `#16A34A` / turquoise `#14B8A6`. The live `/var/www/darhijama.tn/index.html` uses a warm cream palette (`#f5efe0`, `#ede3cc`, `#e8dfc8`, `#e8c97a`, `#a89870`) plus `#c9a84c` — **the Mythos OS gold** — and WhatsApp green `#25D366`/`#128C7E`. **Zero charter colours appear in the deployed page** |
| **Evidence** | Hex extraction from both the charter and the live HTML |
| **Status** | **CONFLICTING — unresolved** |
| **Notes** | The most significant conflict recovered. It is also the strongest surviving evidence that a Mythos-level palette was being applied across projects (see O-001). Which artifact is authoritative is **UNKNOWN** |

### C-002 — `darhijama.tn` served two ways

| Field | Value |
|---|---|
| **Conflict** | Two vhosts claim `server_name darhijama.tn`: a static site disabled on 2026-07-29 (`darhijama.tn.disabled-20260729-171012`) holding the brand assets, and an active `dar-hijama-app` proxying `127.0.0.1:18081` which is what visitors reach |
| **Evidence** | `/etc/nginx/sites-enabled/`, `sites-available/` |
| **Status** | **SUPERSEDED — static by proxied app**, deliberately, on 2026-07-29 |
| **Notes** | Recorded as superseded rather than conflicting: the `.disabled-<timestamp>` rename is an explicit act. But the brand assets live with the *superseded* copy |

### C-003 — Two golds

| Field | Value |
|---|---|
| **Conflict** | Mythos OS gold `#c9a84c` (D-001); Uthina Chess Imperial Gold `#D9A441` (D-002). Two independent dark-ground gold identities, four hex digits apart |
| **Evidence** | Both `:root` blocks |
| **Status** | **UNKNOWN** — no document connects them. Derivation, coincidence, or convergence cannot be established |

### C-004 — Four unarbitrated palettes

| Field | Value |
|---|---|
| **Conflict** | Mythos OS dark/gold · Command Center light/indigo `#4f46e5` · ID Auto dark-navy/teal `#72d7c5` · SsangYong light/navy `#0d3b66`. Four palettes, two colour schemes, four radius scales, three variable-naming conventions, zero shared files |
| **Evidence** | All four `:root` blocks read directly |
| **Status** | **CONFLICTING — never arbitrated.** No document records whether this divergence was chosen or accumulated |

### C-006 — Two `--mythos-*` token systems now exist, and some names collide

| Field | Value |
|---|---|
| **Conflict** | The 1C/1E token system (**approved on paper, not implemented**) and the MOS-1 shell token system (**implemented on `main`, not derived from 1C**) share the `--mythos-*` namespace. **Where their names look alike, their values differ** |
| **Evidence** | `projects/mythos-os-console/reference/web/mythos.css` at `5e2011b`, read directly; `docs/design/GRID_AND_SPACING.md` §2 and §7; `COLOR_SYSTEM.md` §3 |
| **Found** | 2026-08-18, while merging `main` into the Stage 1 design branch. **Neither side did anything wrong** — MOS-1's **D-012** is explicit that it extends Mythos OS's own confirmed **D-001** identity, and MIG-1/MIG-3 were never actioned |

**The measured divergences:**

| Axis | Implemented (MOS-1, `main`) | Approved (1C / 1E) |
|---|---|---|
| Spacing scale | 4 · 6 · 8 · 12 · 16 · 20 · 24 · 32 · 40 | 2 · 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 · 96 · 128 · 160 |
| Radius scale | 5 · 6 · 8 · 12 · 16 · 999 | 0 · **2** · 6 · 12 · 999 |
| Accent | `#c9a84c` — the legacy gold (**D-001**, rationale unrecorded, **U-001**) | `#D9A441` — Mythos Gold (**A-013**, rationale recorded: it is the gold in the mark) |

**The sharp edge:** `--mythos-sp-6` is **20 px** in the implemented system and
`space-6` is **24 px** in the approved one; the implemented `--mythos-radius-sm`
is **6 px** while the approved workhorse `radius-1` is **2 px**. **Two systems,
similar names, different values.** Anyone reading one and implementing against
the other gets silently wrong geometry.

| Field | Value |
|---|---|
| **Status** | **CONFLICTING — not resolved, and not resolvable here.** It is the visible cost of **MIG-1** and **MIG-3** being recorded and deliberately unactioned |
| **Does not change** | **D-012 stands**; the approved 1C/1E specifications stand. Neither is withdrawn or amended by this entry |
| **Bears on** | **TOKEN-2** — the namespace question now has real precedent, since `main` chose `--mythos-*`. **That is evidence, not a decision**, and TOKEN-2 stays open |

---

### ~~C-005~~ — Control height 40 px vs touch minimum 44 px — **RESOLVED by A-022**

| Field | Value |
|---|---|
| **Conflict** | Two **owner-approved** statements inside **A-009**. §7 sets control height at **36 px compact / 40 px comfortable**; §7 and §11 both require touch targets of **≥ 44 × 44 px at every breakpoint**. A 40 px control does not meet a 44 px minimum |
| **Evidence** | `MASTER_VISUAL_IDENTITY_1C_PROPOSAL.md` §7 (Button, Input, "Touch targets ≥ 44 × 44 px") and §11 ("Touch targets 44 × 44 minimum at every breakpoint — not only small ones") |
| **Found** | Stage **1E**, 2026-08-18, while deriving the size token family |
| **Resolutions available** | Grow the visual control height at coarse pointers, **or** extend the hit area beyond the visual box. **The approved text names neither** |
| **Status** | **RESOLVED 2026-08-18 by A-022** — the owner separated the two: the visual box may stay 40 px, the *hit* box must reach 44 × 44, and the hit area may extend beyond the visual box. **Neither approved value was discarded.** Original conflict text above left unaltered |

---

---

## 3. Open decisions

| ID | Decision needed | Blocking? | Notes |
|---|---|---|---|
| **O-001** | Brand independence vs Mythos consistency | **YES** | Blocks any master brand architecture. C-001 is the only real-world data point and it points both ways |
| **O-002** | Is Dar Hijama's charter or its live site authoritative? | Yes, for Dar Hijama | Resolves C-001 |
| **O-003** | Should `mythosprod.xyz` have an apex site? | Yes, for Stage 4 | No apex vhost exists today |
| **O-004** | Do Mythos Services / Digital / Logistique exist as brands? | Yes, for Stage 6 | **Zero evidence of any kind** was recovered for these three |
| **O-005** | Destination for NotreJour's 7 deferred design files | No | Open since 2026-08-13 |
| **O-006** | Merge Mouain's 1,787 unmerged lines to `main`? | No | Invisible from `main` today |
| **O-007** | Is `agribee.tn` intended to be served? | No | Files and logo exist; no vhost |
| **O-008** | Reduce Uthina's five parallel site copies to one? | No | All preserved, none deleted |
| **O-009** | Adopt D-010 headless-browser design QA as a standard? | No | Proven **twice**: SsangYong (3 defects) and MOS-1 (3 defects, incl. a mobile drawer that could not be opened). Recommended for adoption |
| **O-010** | Adopt D-006 clear-space/minimum-size rules portfolio-wide? | No | Currently Dar Hijama only |

### 3.1 Open decisions carried forward after the 2026-08-18 owner approval

Recorded with the owner's own wording and IDs. **None of these may be resolved
by inference.**

| ID | Decision needed | Blocking? | Notes |
|---|---|---|---|
| ~~**O-A1**~~ | Classification of Mythos Command Center / `ordre.mythosprod.xyz` | — | **RESOLVED 2026-08-18 by A-020** — a product of **Mythos OS**, not a sixth unit. `MYTHOS → Mythos OS → Mythos Command Center → ordre.mythosprod.xyz`. No unit logo is created |
| ~~**O-A3**~~ | Whether and under what conditions a public project may use a Mythos-level colour | — | **RESOLVED 2026-08-18 by A-021** — permitted **only as a controlled ecosystem accent**, never replacing the project's primary colour, never automatic. **C-001** and **O-002** remain open: the policy is forward-looking and does not adjudicate the existing Dar Hijama deviation |
| ~~**GOLD-1**~~ | Which gold is the master? | — | **RESOLVED 2026-08-18 by A-013** — Mythos Gold `#D9A441`, with `#805C19` for gold text on light grounds |
| ~~**LOGO-2**~~ | Whether the vector reconstruction is adopted as the **production** master | — | **RESOLVED 2026-08-18 by AUTO-1 — NOT owner-approved**, see §0.5. Held by the owner earlier the same day pending LOGO-1; resolved later the same day under a separate delegated-mandate instruction. `docs/design/LOGO_SYSTEM.md` now carries the final logo system, adopted. **Central finding, measured:** the recovered raster is **insufficient as a production master** — `logomythos.png` has **0 non-opaque pixels** (ground baked in), **15,393 distinct colours** (cannot flatten to one ink), and a **142 mm** ceiling at 300 dpi. **Adopted: a two-master model** — the historical raster stays the authoritative record under **A-007**, unmodified; the reconstruction becomes the working production master, always described as a derivative. Three conditions bind, including that a later LOGO-1 find is diffed against it. **Adoption did not close LOGO-1, and does not by itself authorise applying the mark anywhere** |
| **O-004b** | Whether and when Mythos Services, Digital and Logistique become operating brands | No | **A-002** fixes the roster; the evidence gap for these three is unchanged |
| ~~**TYPE-1**~~ | Retire Playfair Display from the master brand? | — | **RESOLVED 2026-08-18 by A-014** — retired from the master; master stack is Archivo Expanded + IBM Plex Sans / Sans Arabic / Mono |
| ~~**SEM-1**~~ | Adopt the corrected semantic palette? | — | **RESOLVED 2026-08-18 by A-015** — adopted, verified on all four surfaces |
| ~~**MIG-1**~~ | Align Mythos OS's implemented `--gold: #c9a84c` with the approved master `#D9A441` | — | **EXECUTED 2026-08-18, AUTO-7.** Real scope was 331 occurrences across 16 files (not one value, and larger than AUTO-6's own 42/12 estimate). Applied, verified across 16 real views, not deployed. Not owner-approved. See `docs/design/MIG_EXECUTION_MAPPING.md` §2a, `MYTHOS_DESIGN_DECISIONS.md` §0.5 AUTO-7 |
| ~~**MIG-2**~~ | ~~Replace the 45 `Playfair Display` declarations in `css/*.css`~~ — real scope 93 occurrences, 14 files (AUTO-6) | — | **EXECUTED 2026-08-19, AUTO-11** — solved by role separation (display/label/data), after AUTO-8's honest rollback proved a blanket display-face swap wraps financial figures. All 93 sites classified individually and migrated; verified across 17 real views; the AUTO-8 regression selector now renders one-line in the approved Data face. Not owner-approved. See §0.5 AUTO-11 |
| ~~**MIG-3**~~ | Apply the corrected semantic tokens and the new control-border tokens to the Mythos OS token block | — | **COMPLETED 2026-08-19: AUTO-9 (`--muted`/`--danger`) + AUTO-12 (`--past` via the approved disabled-role mapping; A-016 control boundary applied to the stylesheet rule and 22 inline form controls, decorative borders deliberately untouched).** Not owner-approved. See §0.5 AUTO-12 |
| **MIG-4** | Bring Mythos Command Center's palette (light `#f6f7f9` / indigo `#4f46e5`) into the Mythos system | Not yet | **NEW, from A-020.** **CHECKED and left BLOCKED, AUTO-9** — MCC-1 is confirmed live, deployed, serving real public traffic; the O-A1 approval is classification only; a standing, unrevoked instruction never to touch MCC-1 applies. No file under `projects/command-center/` was read or touched. See `docs/design/MIG_EXECUTION_MAPPING.md` §5a |
| **SEQ-1** | Sequential and diverging data scales for continuous data | No | **NEW, raised by 1D.** The eight-series categorical palette is approved; continuous scales were outside the 1C scope and must not be improvised (`docs/design/COLOR_SYSTEM.md` §5) |
| ~~**TYPE-2**~~ | Font subsets, shipped weight instances, and the font performance budget | — | **RESOLVED 2026-08-18 by AUTO-4** — real files self-hosted, real numbers measured; not owner-approved, see §0.5 |

**Standing finding recorded 2026-08-18 (measurement, not a decision):** the
recovered historical logo **cannot serve as a production master**. Measured:
`logomythos.png` 1672 × 941 with **0 non-opaque pixels** and **15,393 distinct
colours**, maximum **142 mm** at 300 dpi; `logo.png` 1111 × 328, **0 non-opaque
pixels**, **10,549 colours**, maximum **94 mm**. This makes monochrome
reproduction, embroidery, engraving, transparent favicons and app icons, social
avatar crops, placement on any other ground, and print or signage above ~14 cm
**impossible from the raster alone**. It does not diminish **A-007**: the raster
remains the authoritative record of what the identity *is*. It is the evidence
base for the **LOGO-2** recommendation in `docs/design/LOGO_SYSTEM.md` §1.

**Standing constraint recorded 2026-08-18 — the LOGO-2 review hold.** The owner
reviewed the LOGO-2 proposal, confirmed the two-master model, the descriptor
system and the three layout forms are understood, and **explicitly withheld
approval**. The gate is stated plainly so it cannot be lost:

> **The proposed reconstruction must not be converted into an OWNER-APPROVED
> production master while LOGO-1 remains open.**

**This gate held in full at the time and was never violated: no owner approval
was ever recorded for LOGO-2.** What changed is recorded separately and
honestly — see **§0.5, AUTO-1**: later the same day, under a distinct, explicit
delegated-mandate instruction, LOGO-2 was resolved as an **autonomous, NOT
owner-approved** decision. The text above is preserved exactly as it was
written, because it is still true on its own terms; §0.5 records what came
after it.

### 3.2 Prior open questions answered by the 2026-08-18 approval

Additive record. The rows above in §3 are left exactly as the recovery stage
wrote them; this table states what changed, without rewriting the evidence.

| Prior ID | Now | By |
|---|---|---|
| **O-001** — brand independence vs Mythos consistency | **ANSWERED** — projects stay independently branded | **A-004**, with **A-005**/**A-006** setting what is and is not inherited |
| **O-004** — do the three units exist as brands? | **PARTIALLY ANSWERED** — the roster is fixed; operating status is not asserted | **A-002**; remainder tracked as **O-004b** |

**Still open and untouched by this approval:** O-002, O-003, O-005, O-006,
O-007, O-008, O-009, O-010, and the vector-source question tracked as
**LOGO-1** (see `docs/design-recovery/PENDING_VECTOR_SOURCE_TASK.md`).

### 3.3 The 2026-08-18 approval of 1C — what it closed, and what it did not

| Prior ID | Now | By |
|---|---|---|
| **GOLD-1** | **RESOLVED** — Mythos Gold `#D9A441` | **A-013** (supersedes A-008) |
| **TYPE-1** | **RESOLVED** — Playfair Display retired from the master | **A-014** |
| **SEM-1** | **RESOLVED** — corrected semantics adopted | **A-015** |
| **C-003** | **Resolved forward only.** The master value is decided and has a recorded rationale; the historical relationship between the two golds is still unexplained | **A-013** |
| **U-001** | **Still UNKNOWN.** The rationale for `#c9a84c` was never recorded and approving a different master does not recover it | — |

**Explicitly still OPEN, and not resolvable by inference — reaffirmed at the
moment of this approval:**

| Ref | Question | State |
|---|---|---|
| ~~**O-A1**~~ | Classification of Mythos Command Center / `ordre.mythosprod.xyz` | **RESOLVED 2026-08-18 by A-020** — a product of Mythos OS. The palette consequence it carried is now tracked as **MIG-4**, not actioned |
| ~~**O-A3**~~ | Whether, and under what conditions, a public project may use a Mythos-level colour | **RESOLVED 2026-08-18 by A-021** — controlled ecosystem accent only. Completes the exception clause inside **A-006** |
| **LOGO-1** | Does an original vector or layered master source exist outside Git? | Yes, informs AUTO-1's reconciliation condition | **STILL OPEN, NARROWED — searched again 2026-08-18 under the delegated mandate.** Exhaustive over Git history (438 commits, 36 branches — **exactly 14 vector blobs have ever existed, all of them the Stage 1B reconstruction**), this container's entire filesystem, and now **one of three off-host repositories** (`mythos-prod-unversioned-snapshot` — fully searched, genuine negative: one vector file exists, and it is an unrelated company's logo, not Mythos). `mythos-app` (denied at `add_repo`) and `mythos-os` (denied at clone) remain unreached; the VPS filesystem remains absent. No original, no master, nothing new discovered; **still no true negative established over the full scope.** Full record: `docs/design-recovery/PENDING_VECTOR_SOURCE_TASK.md` §5 |
| ~~**LOGO-2**~~ | Adoption of the vector reconstruction as the **production** master | **RESOLVED 2026-08-18 by AUTO-1 — NOT owner-approved, see §0.5.** A full proposal was delivered 2026-08-18 (`docs/design/LOGO_SYSTEM.md`, commit `46915a0`) and **reviewed by the owner, who placed it on hold** the same day: *not* to be converted into an **owner-approved** production master while LOGO-1 remains open. **That gate held — no owner approval was ever given.** Later the same day, under a separate delegated-mandate instruction, this session adopted the reconstruction as production master autonomously. LOGO-1 stays open; the reconciliation condition is binding. The 1C approval does not adopt it either — that specification is deliberately independent of which logo master is eventually chosen |

### 3.4 New open items raised by Stage 1E — grid, spacing, tokens

**Raised by derivation, not by opinion.** Stage 1E computed the approved figures
out to their consequences. Each item below is a place where the approved
specification is silent or self-inconsistent, found by arithmetic and recorded
rather than filled in.

| Ref | Question | Blocking? | Where it came from |
|---|---|---|---|
| **GRID-1** | Two container questions: `2xl` (≥ 1920) has no behaviour the approved text names that is not already true from a **1440** viewport, because the 1280 content cap binds 480 px earlier; and the 1440 "wide" container is ambiguous between a second content width and the outer frame of the 1280 container, since `1280 + 80 + 80 = 1440` exactly | No | `GRID_AND_SPACING.md` §4 |
| ~~**GRID-2**~~ | Prose measure is approved as **68ch** in 1C §5 and as **65 characters** in `TYPOGRAPHY.md` §2. **RESOLVED 2026-08-18 by AUTO-5** — 48ch, superseding the 68ch approximation on real font metrics, honouring the 65-character intent (see §0.5 AUTO-5) | — | `GRID_AND_SPACING.md` §4.3 |
| **GRID-3** | Four of the twelve spacing steps (**2, 4, 32, 160**) fall outside both legal bands; and the approved button padding **9 / 15** is off the spacing scale entirely | No | `GRID_AND_SPACING.md` §2, §3 |
| **SURF-1** | The light elevation ramp has **two** steps (`paper-100`, `paper-200`) to the dark ramp's **four** (`ink-900/850/800/750`), so a card on a raised surface has no light-theme equivalent; and **no shadow values are specified** anywhere — only the rule for when a shadow is permitted | No | `GRID_AND_SPACING.md` §7 |
| **GOLD-2** | Light-theme **hover** and **active** gold states are unspecified. The approved palette designates `gold-700` for borders and large graphics and `gold-800` for text; `gold-700` measures **3.94** on paper, below AA for text | No | `DESIGN_TOKENS.md` §4.4 |
| **TOKEN-1** | Generating an actual token artifact (`tokens.css` / `tokens.json`) is **not authorised**. It would put CSS or a build input into the repository, and it would force values onto C-005, SURF-1 and GOLD-2 that no one has decided | No | `DESIGN_TOKENS.md` §8 |
| **TOKEN-2** | Whether tokens carry a namespace prefix (`--mythos-accent` vs `--accent`). The approved examples show none, but they are illustrative; a shared ecosystem with independently branded projects (**A-006**) is where a prefix earns its keep | No | `DESIGN_TOKENS.md` §2 |

**One structural choice Stage 1E made itself, flagged so it can be rejected:**
grid tokens (`grid-*`, `container-*`) are consumed **directly by the layout
primitive** rather than through the semantic tier. A layout frame is the thing
components sit *in*, and routing nine grid values through nine semantic aliases
would add names without meaning and push the semantic layer past its approved
60-token ceiling. **This is not an owner decision.** It is reversible at the cost
of nine semantic tokens.

**Effect on U-004** (*"Mythos spacing and grid — no scale exists in any document
or stylesheet"*): the **specification** half is now answered — `A-009` approved a
scale and `GRID_AND_SPACING.md` states it in implementable form. The
**stylesheet** half was unchanged at the time of writing, and **MIG-3** remains
unactioned. U-004 is therefore narrowed, not closed, and its original text above
is left exactly as the recovery stage wrote it.

**Corrected 2026-08-18, after merging `main` at `5e2011b`.** The sentence above
originally read *"no CSS in this repository has a spacing scale"*. **That is no
longer true.** Stage MOS-1 landed on `main` and shipped
`projects/mythos-os-console/reference/web/mythos.css`, which declares a spacing
scale, a radius scale and 68 `--mythos-*` custom properties. The claim is
corrected rather than deleted, and the collision it creates is recorded as
**C-006** below. **MIG-1 and MIG-3 are still unactioned, and nothing here
resolves TOKEN-2.**

---

### 3.5 New open items raised by Stage 1F — component system

**Found by specifying components against the approved rules, not by opinion.**
Each is a place where two approved statements collide, or where a component the
owner asked for has no approved value at all. **None was resolved inside a
component** — that is the specific failure the token architecture exists to
prevent.

| Ref | Statement | Blocking? | Recommendation (**PROPOSED**, not decided) |
|---|---|---|---|
| **MOTION-1** | The approved motion rule *"nothing loops, nothing autoplays"* (1C §10) and the approved requirement that every interactive element have a **loading** state (1C §7) cannot both hold as written — **a spinner loops and autoplays** | For the loading state only | Static skeletons and determinate progress only. It is also the only route that stays perceivable under `prefers-reduced-motion` |
| **LINK-1** | The inline text link has **no approved colour**. Gold is reserved for the primary action, active state, focus ring and the 35° gesture — *"nothing else"* (`COLOR_SYSTEM.md` §3.2) — and *"gold is never used to create hierarchy in running text"* (`TYPOGRAPHY.md` §4). **No other accent colour exists in the system** | No | Underline in `text-primary`, thickening on hover. Colour never distinguishes a link, which is also robust for colour-vision deficiency |
| **SHAPE-1** | A switch track needs a pill, but `radius-pill` is approved for **avatars and status dots only** (1C §6). The component set the owner requested and the approved radius rule do not fit | No | A rectangular switch at `radius-control` (2) — consistent with a wordmark built on flat terminals |
| **GOLD-3** | The recovered CSS draws select chevrons in gold, but the approved scarcity rule allows **one gold element per view** — *"if two things are gold, one of them is wrong"*. A form with five selects would carry five, before counting the primary button | No | Chevrons take `text-secondary`; gold stays with the primary action |

**Thirteen of the twenty-one components the owner named have no approved base
specification.** 1C §7 specified Button, Input, Card, Navigation, Table, Modal,
Chip/status and Toast — and nothing else. For the other thirteen every value in
`COMPONENT_SYSTEM.md` is marked **DERIVED** (computed from approved rules, no new
decision) or **PROPOSED** (a new decision, rejectable on its own). That split is
stated at the top of each affected entry rather than left for a reader to infer.

**Still open and untouched by 1F:** **SURF-1** and **GOLD-2** are the two that
bite hardest — between them they leave *every* hover and active state
unspecified on light, and leave the three floating components (menu, modal,
toast) with no shadow value. `COMPONENT_SYSTEM.md` §9 maps every open reference
to the components it affects.

---

### 3.6 New open items raised by Stage 1G — responsive, accessibility, motion

**Found by specifying the four device classes, the accessibility floor and the
motion system against the approved rules.** Each is a place where the approved
text stops short of what the specification needs. **None was resolved**, and
**MOTION-1 was deliberately left open on the owner's explicit instruction.**

| Ref | Question | Blocking? | Recommendation (**PROPOSED**, not decided) |
|---|---|---|---|
| **TYPE-3** | Fluid type is approved as `clamp()` *"between the scale's stops"*, but **which stop floors each style, and at which viewports the clamp endpoints sit, are unspecified** — and both are needed to write a single `clamp()` | No | Floor at the next stop down; endpoints at **320** and **1240** (where the grid first reaches 12 columns). Body and below stay fixed, because a fluid body range would break either the 16 px floor or the 13 px operational floor |
| **SPACE-1** | The approved spacing bands **do not vary by breakpoint**, and no approved rule says whether they should. A 128 px section gap is **a quarter of a 320 px phone viewport** | No | Section spacing steps one band down at mobile (128 → 96, 96 → 64, 64 → 48); component spacing unchanged, being already at the small end of the scale |
| **A11Y-1** | Under `forced-colors` the palette is replaced by the user's. **Gold is the system's only emphasis channel** — primary action, active state, focus ring and the 35° gesture all carry it. Status survives because the approved rule already pairs colour with a dot, chip or stripe; **the primary-versus-secondary button distinction does not** | No | Needs a non-colour channel for the primary action. This is a real design decision, **not** something derivation can supply |
| **A11Y-2** | The universal rule is *colour never carries meaning alone*, and **disabled is a meaning** — yet the approved system gives disabled **no non-colour channel**. A disabled control is currently distinguished by contrast alone, which is what the rule forbids elsewhere | No | — |
| **MOTION-2** | The M's slant does not mirror in RTL (**A-012**), and the 35° motion vector is the same angle as the mark. **Whether the vector mirrors is unstated:** keeping it preserves the angle and breaks layout logic; mirroring it does the reverse | No | — |
| **MOTION-3** | The 35° gesture exists twice in the approved text — as a **shape** (a 35° cut on one element per view, 1C §6) and as a **motion** (one element per view travelling along 35°, 1C §10), each *"once per view"*. **Whether they share one budget or two is unstated** | No | — |

**MOTION-1 remains OPEN by instruction, not by omission.** The owner's 1G
instruction was explicit: *"If a loading state requires an exception, document it
as PROPOSED and leave it OPEN."* `RESPONSIVE_ACCESSIBILITY_MOTION.md` §3.4 states
the contradiction in the approved text's own words, sets out three routes with
their costs, and recommends **routes 1 and 2 together** — determinate progress
where measurable, static skeletons elsewhere — on the ground that **A-018
requires the interface to remain legible with animation disabled entirely**,
which routes 1 and 2 satisfy unchanged while an animated indicator needs a
second, non-animated fallback regardless. **That is a recommendation. It is not a
decision, and it may not be treated as one.**

**Two measured findings from 1G worth carrying forward, neither of them a new
decision:**

- **Zoom is not a special mode — it moves the user down the same bands.** From a
  1280 viewport, 200 % zoom yields a **640 px** effective width and lands in the
  tablet band; 400 % yields **320 px** and lands in mobile. So **the tablet
  layout is the desktop-at-200 %-zoom layout** and cannot be a degraded middle
  state, and **the 320 px reflow requirement and 400 % zoom are the same test**.
- **Nine of the twelve approved type styles have a default line-height below
  1.5** — all six display and heading styles plus Caption (1.46), Label (1.34)
  and Data (1.44). WCAG 1.4.12 requires content to survive a user forcing 1.5, so
  **no fixed-height container may wrap a heading, label or data cell**; forcing
  Display XL from 1.02 to 1.5 grows its line box by **47 %**. This is not a defect
  in the scale — tight display leading is correct — it is a constraint on every
  container the scale sits in.

**Where GRID-1 bit hardest:** the owner asked 1G to define **large desktop** as
one of four device classes, and **every approved metric for `2xl` is identical to
`xl`** — the content cap already stops the grid growing from a 1440 viewport,
480 px below the `2xl` boundary. **The class has nothing of its own in the
approved system**, and none was invented.

---

### 3.7 New open items raised by Stage 1H — public ecosystem architecture

**Found by describing the ecosystem against the recorded evidence rather than
against intent.** All three are gaps between what the approved architecture
covers and what the recovery documents show actually exists. **None was
resolved**, and 1H resolved nothing carried in from earlier stages.

| Ref | Question | Blocking? | Evidence |
|---|---|---|---|
| **ECO-1** | **A-020** nests Mythos Command Center **under** Mythos OS, but the domain architecture makes `os.mythosprod.xyz` and `ordre.mythosprod.xyz` **sibling subdomains** of the same apex — the URL says peers, the brand tree says one contains the other. Which structure the address bar should reflect is unstated | No | `MYTHOS_PROJECT_DESIGN_MATRIX.md` §8; **A-020**. **The Command Center is live and was not touched** |
| **ECO-2** | `panel.mythosprod.xyz` and `tv.mythosprod.xyz` are **live subdomains of the master domain with no place anywhere in the approved brand architecture** — neither units (**A-002**), nor products of a unit (**A-020**), nor independent projects (**A-004**). `tv.` runs Jellyfin, third-party software on a Mythos hostname | No | Recovered live-service map: proxies `127.0.0.1:8000` and `127.0.0.1:8096` |
| **ECO-3** | **Twelve projects exist outside the owner's eight-project list**, all recorded as VERIFIED present — **KnowledgeVault KMS alone is 752 distinct files, the largest body of design work outside the eight**. **A-004** names eight projects "and future projects"; whether these twelve are ecosystem projects, internal tooling or archive is undecided, and it determines what a `mythosprod.xyz` hub would list | No | `MYTHOS_PROJECT_DESIGN_MATRIX.md` §7 |

**The status ledger is evidence-based, and the headline is worth stating in the
register itself:** of the eight named public projects, **five are LIVE**
(Uthina Chess, SsangYong.autos, Fixpert, Notre Jour, Dar Hijama) and **three are
BUILT but unserved** (AgriBee, ID Auto, Mouain — **O-007**, no vhost, and
**O-006**, 1,787 unmerged lines). On the Mythos side, **the master brand has no
public surface at all** (`mythosprod.xyz` has no apex vhost — **O-003**),
**Mythos OS is built but not deployed** (DNS resolves; MOS-1.1), and **the
Command Center is the only live Mythos-owned brand surface**.

**C-006 is recorded by 1H as an ecosystem problem, not only a CSS one, and is
still OPEN.** Under **A-005** public projects inherit *the standards*; with two
token systems both answering to the name "Mythos", **a project cannot know which
standard it is inheriting**. 1H merged neither system, renamed neither and chose
no winner — the reconciliation belongs to a later **implementation** stage
alongside **MIG-1** and **MIG-3**, both still unactioned.

**A-021 was applied exactly as approved**, with no reinterpretation or expansion,
and **C-001 / O-002 remain open** — the policy is forward-looking and still does
not adjudicate the live Dar Hijama deviation.

---

---

## 4. Unknown — believed decided, not recoverable

| ID | What is missing | Why it matters |
|---|---|---|
| **U-001** | Rationale for the Mythos gold `#c9a84c` | The defining colour of the product UI; its meaning is unrecorded |
| **U-002** | The rejected Dar Hijama "pistes" | Every asset is named `piste1`, presupposing alternatives. **No piste 2 survives anywhere.** Why piste 1 won is unrecoverable |
| **U-003** | Mythos master typography | No typeface is specified for Mythos itself. Inter recurs across four projects but is nowhere declared a decision |
| **U-004** | Mythos spacing and grid | No scale exists in any document or stylesheet |
| **U-005** | Whether project brand independence was ever discussed | The four-palette outcome may be a decision or an accident; nothing records which |
| **U-006** | Design work inside the 14 off-host repositories | Not readable from this host — `uthina-chess` alone is 102 MB |
| **U-007** | Design work on the owner's PC | `C:\Users\Othman\Desktop\site` is the consolidation target; out of reach by standing rule |
