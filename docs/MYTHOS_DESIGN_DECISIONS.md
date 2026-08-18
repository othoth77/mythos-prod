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
| **Notes** | The "unless explicitly approved later" clause is what keeps **O-A3** open: a project *may* one day use a Mythos-level colour, but only by explicit approval, never by drift or inference |

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
| **Status** | **OWNER-APPROVED as an instruction to leave open** — 2026-08-18 |
| **Tracked as** | **GOLD-1** (§3) |
| **Notes** | Directly connected to **C-003** (two golds, unexplained) and **U-001** (the rationale for `#c9a84c` was never recorded) |

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
| **O-A1** | Classification of Mythos Command Center / `ordre.mythosprod.xyz` within the Mythos architecture | Yes, for 1C and for the hub IA | Live, Mythos-level, **absent from the approved five-unit roster (A-002)**, and carrying a third divergent Mythos-level palette (light `#f6f7f9` / indigo `#4f46e5`). Cannot be absorbed silently |
| **O-A3** | **Whether and under what conditions a public project may use a Mythos-level colour in its own visual identity** | Yes, for any project-level design work | The owner's scoping, which is broader than the earlier draft framing of O-A3. Governs the exception clause in **A-006**. Related evidence: **C-001** (Dar Hijama's live site uses `#c9a84c` while its charter specifies green) and **O-002**, both of which remain open on their own terms |
| **GOLD-1** | Relationship between the historical Mythos logo gold gradient and the Mythos OS UI gold `#c9a84c` | Yes, for 1D colour | Measured evidence only: the historical logo's gold is a **gradient**, sampled roughly `#AB7E2F → #F8D276`, centred near `#D9A441`; the UI gold is the flat `#c9a84c`; Uthina Chess Imperial Gold is `#D9A441`. No document connects them. See **C-003**, **U-001** |
| **LOGO-2** | Whether the Stage 1B vector reconstruction is adopted as the master, once **LOGO-1** is settled | Yes, for 1C | The 1B masters are **PROPOSED**, never approved (**A-007**). Adoption is a separate decision from the architecture approved on 2026-08-18 |
| **O-004b** | Whether and when Mythos Services, Digital and Logistique become operating brands | No | **A-002** fixes the roster; the evidence gap for these three is unchanged |

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
