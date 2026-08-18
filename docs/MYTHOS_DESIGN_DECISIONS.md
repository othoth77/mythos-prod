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

### C-005 — Control height 40 px vs touch minimum 44 px

| Field | Value |
|---|---|
| **Conflict** | Two **owner-approved** statements inside **A-009**. §7 sets control height at **36 px compact / 40 px comfortable**; §7 and §11 both require touch targets of **≥ 44 × 44 px at every breakpoint**. A 40 px control does not meet a 44 px minimum |
| **Evidence** | `MASTER_VISUAL_IDENTITY_1C_PROPOSAL.md` §7 (Button, Input, "Touch targets ≥ 44 × 44 px") and §11 ("Touch targets 44 × 44 minimum at every breakpoint — not only small ones") |
| **Found** | Stage **1E**, 2026-08-18, while deriving the size token family |
| **Resolutions available** | Grow the visual control height at coarse pointers, **or** extend the hit area beyond the visual box. **The approved text names neither** |
| **Status** | **CONFLICTING — not resolved.** Left for 1F or the owner. Resolving it inside a component is precisely the failure the token architecture exists to prevent |

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
| **O-009** | Adopt D-010 headless-browser design QA as a standard? | No | Proven once, never generalised |
| **O-010** | Adopt D-006 clear-space/minimum-size rules portfolio-wide? | No | Currently Dar Hijama only |

### 3.1 Open decisions carried forward after the 2026-08-18 owner approval

Recorded with the owner's own wording and IDs. **None of these may be resolved
by inference.**

| ID | Decision needed | Blocking? | Notes |
|---|---|---|---|
| ~~**O-A1**~~ | Classification of Mythos Command Center / `ordre.mythosprod.xyz` | — | **RESOLVED 2026-08-18 by A-020** — a product of **Mythos OS**, not a sixth unit. `MYTHOS → Mythos OS → Mythos Command Center → ordre.mythosprod.xyz`. No unit logo is created |
| ~~**O-A3**~~ | Whether and under what conditions a public project may use a Mythos-level colour | — | **RESOLVED 2026-08-18 by A-021** — permitted **only as a controlled ecosystem accent**, never replacing the project's primary colour, never automatic. **C-001** and **O-002** remain open: the policy is forward-looking and does not adjudicate the existing Dar Hijama deviation |
| ~~**GOLD-1**~~ | Which gold is the master? | — | **RESOLVED 2026-08-18 by A-013** — Mythos Gold `#D9A441`, with `#805C19` for gold text on light grounds |
| **LOGO-2** | Whether the vector reconstruction is adopted as the **production** master | Yes — it blocks monochrome, favicon, app icon, social avatar, print above 14 cm and all signage | **PROPOSED — AWAITING OWNER APPROVAL** (status set by the owner at the 2026-08-18 review hold). `docs/design/LOGO_SYSTEM.md` now carries the final logo system and a recommendation. **Central finding, measured:** the recovered raster is **insufficient as a production master** — `logomythos.png` has **0 non-opaque pixels** (ground baked in), **15,393 distinct colours** (cannot flatten to one ink), and a **142 mm** ceiling at 300 dpi. **Recommendation:** adopt a **two-master model** — the historical raster stays the authoritative record under **A-007**, unmodified; the reconstruction becomes the working production master, always described as a derivative. Three conditions attach, including that a later LOGO-1 find is diffed against it. **Adoption would not close LOGO-1, and would not authorise applying the mark anywhere** |
| **O-004b** | Whether and when Mythos Services, Digital and Logistique become operating brands | No | **A-002** fixes the roster; the evidence gap for these three is unchanged |
| ~~**TYPE-1**~~ | Retire Playfair Display from the master brand? | — | **RESOLVED 2026-08-18 by A-014** — retired from the master; master stack is Archivo Expanded + IBM Plex Sans / Sans Arabic / Mono |
| ~~**SEM-1**~~ | Adopt the corrected semantic palette? | — | **RESOLVED 2026-08-18 by A-015** — adopted, verified on all four surfaces |
| **MIG-1** | Align Mythos OS's implemented `--gold: #c9a84c` with the approved master `#D9A441` | Not yet | **NEW, from A-013.** A token-level change: one value. **Not actioned** — the 1C approval is specification-only. Belongs to an authorised implementation stage |
| **MIG-2** | Replace the 45 `Playfair Display` declarations in `css/*.css` | Not yet | **NEW, from A-014.** **Not actioned** — specification only |
| **MIG-3** | Apply the corrected semantic tokens and the new control-border tokens to the Mythos OS token block | Not yet | **NEW, from A-015 / A-016.** **Not actioned** — specification only. Closes three measured contrast failures and the missing 3 : 1 control boundary |
| **MIG-4** | Bring Mythos Command Center's palette (light `#f6f7f9` / indigo `#4f46e5`) into the Mythos system | Not yet | **NEW, from A-020.** As a Mythos OS product it should carry the Mythos OS visual language, not a third divergent one. **Not actioned** — the O-A1 approval is classification only and explicitly forbids touching Command Center code, CSS, assets, deployment or branding |
| **SEQ-1** | Sequential and diverging data scales for continuous data | No | **NEW, raised by 1D.** The eight-series categorical palette is approved; continuous scales were outside the 1C scope and must not be improvised (`docs/design/COLOR_SYSTEM.md` §5) |
| **TYPE-2** | Font subsets, shipped weight instances, and the font performance budget | No | **NEW, raised by 1D.** Outside the approved 1C scope (`docs/design/TYPOGRAPHY.md` §5) |

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

**LOGO-2 status is therefore `PROPOSED — AWAITING OWNER APPROVAL`**, and it may
not be moved to approved by inference, by a later stage needing it, or by the
absence of an objection. Only an explicit owner decision changes it. Until then
no logo is generated, no asset is created, and nothing is applied.

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
| **LOGO-1** | Does an original vector or layered master source exist outside Git? | Yes, for LOGO-2 | **STILL OPEN — searched 2026-08-18, result C (only vector derivative found), scope PARTIAL.** Exhaustive over Git history (438 commits, 36 branches — **exactly 14 vector blobs have ever existed, all of them the Stage 1B reconstruction**) and over this container's entire filesystem. **Three of four priority locations were unreachable** (the VPS filesystem does not exist in a cloud session) and **the fourth — the off-host snapshot repositories — was blocked by session permission policy, not by lack of account access.** No original, no master, nothing new discovered; equally, **no true negative established.** Full record: `docs/design-recovery/PENDING_VECTOR_SOURCE_TASK.md` |
| **LOGO-2** | Adoption of the vector reconstruction as the **production** master | **PROPOSED — AWAITING OWNER APPROVAL.** A full proposal was delivered 2026-08-18 (`docs/design/LOGO_SYSTEM.md`, commit `46915a0`) and **reviewed by the owner, who placed it on hold**: it is **not** to be converted into an owner-approved production master **while LOGO-1 remains open**. The 1C approval does not adopt it either — that specification is deliberately independent of which logo master is eventually chosen |

### 3.4 New open items raised by Stage 1E — grid, spacing, tokens

**Raised by derivation, not by opinion.** Stage 1E computed the approved figures
out to their consequences. Each item below is a place where the approved
specification is silent or self-inconsistent, found by arithmetic and recorded
rather than filled in.

| Ref | Question | Blocking? | Where it came from |
|---|---|---|---|
| **GRID-1** | Two container questions: `2xl` (≥ 1920) has no behaviour the approved text names that is not already true from a **1440** viewport, because the 1280 content cap binds 480 px earlier; and the 1440 "wide" container is ambiguous between a second content width and the outer frame of the 1280 container, since `1280 + 80 + 80 = 1440` exactly | No | `GRID_AND_SPACING.md` §4 |
| **GRID-2** | Prose measure is approved as **68ch** in 1C §5 and as **65 characters** in `TYPOGRAPHY.md` §2. Different units. `ch` is the advance of the digit *0*, so the two reconcile only against real font metrics — and **no font file exists in this repository** | No | `GRID_AND_SPACING.md` §4.3 |
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
**stylesheet** half is unchanged: no CSS in this repository has a spacing scale,
and **MIG-3** remains unactioned. U-004 is therefore narrowed, not closed, and
its original text above is left exactly as the recovery stage wrote it.

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
