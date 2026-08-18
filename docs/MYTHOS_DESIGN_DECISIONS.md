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
| **O-009** | Adopt D-010 headless-browser design QA as a standard? | No | Proven **twice**: SsangYong (3 defects) and MOS-1 (3 defects, incl. a mobile drawer that could not be opened). Recommended for adoption |
| **O-010** | Adopt D-006 clear-space/minimum-size rules portfolio-wide? | No | Currently Dar Hijama only |

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
