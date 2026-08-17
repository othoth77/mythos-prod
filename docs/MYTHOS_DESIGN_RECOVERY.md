# Mythos Design Recovery

**Stage:** MYTHOS-DESIGN-RECOVERY-0
**Audit date:** 2026-08-17 UTC
**Baseline:** `main` @ `fcd899b69ae5299d070266126abf2babb3e8ae1a` (= `origin/main` = verified remote HEAD)
**Nature:** recovery, audit and documentation only. **No design was created, changed, or implemented.**

Every claim below carries its evidence. Claims are classified **VERIFIED**
(directly confirmed from a file, commit, or running configuration), **INFERRED**
(strongly indicated by implementation but never explicitly written down), or
**UNKNOWN** (cannot be established from available evidence). Inference is never
promoted to a decision.

---

## 1. Audit date and scope

Audited on 2026-08-17 against `fcd899b`. Scope: the `mythos-prod` repository and
its Git history, the persistent VPS filesystem at targeted locations, the live
nginx configuration, and the preserved `VPS_TRANSFER` package. The filesystem
was **not** scanned indiscriminately; discovery was driven by the repository's
own registries, nginx vhosts, and Git history.

**Conversation content was not used as evidence.** Owner design direction stated
in conversation tells us what is wanted now; this document records only what the
repository and VPS actually contain.

## 2. Repositories inspected

| Repository / checkout | Path or remote | HEAD | Role | Evidence |
|---|---|---|---|---|
| `othoth77/mythos-prod` | `/home/deploy/projects/mythos-prod` | `fcd899b` | **Canonical.** Source of truth | `git remote -v`, `ls-remote` |
| `mythos-prod` clone | `/home/ubuntu/mythos-prod` | `3be0e0d` | Stale second checkout, **69 commits behind** | `git rev-parse`, `git rev-list --count` |
| `mythos-prod` clone | `/home/ubuntu/mythos-prod-push` | `3be0e0d` | Push-relay working clone | `git remote -v` |
| Autonomous-loop worktrees ×4 | `/home/ubuntu/mythos-ai-executor/worktrees/…` | `df6aa1e`, `6811c49`, `5f43db8`, `f433746` | Isolated mission branches `mythos/m-*` | `git worktree list` |
| 14 private off-host repos | `othoth77/{knowledgevault-kms, uthina-chess, ssangyong, mythos-prod-unversioned-snapshot, darhijama-site, karhmana, fixpert, nettoyage-photo-vps, mythos-app, agribee, chatrange, festival, oudhna-service, classepro}` | recorded per repo | Independent off-host protection for non-Git projects | `docs/OFFHOST_PROJECT_REGISTRY.md` |

**VERIFIED.** The 14 off-host repositories are recorded as private, each with a
commit equal to a verified remote HEAD, totalling 1,387 files / 129,179,836
bytes. **This audit did not contact them** — no credential for them exists on
this host. Their contents are taken from the committed registry, not re-verified.

**Branches:** 24 local, 0 tags. Four `mythos/m-*` loop branches plus
`docs/mouain-foundation`, `docs/cloudflare-foundation`, and four
`agent/mythos-multi-agent-orchestrator-0/*` branches carry commits not on `main`
(§12).

## 3. Projects discovered

Fifteen tracked project directories under `projects/`: `atelier-network`,
`automation`, `automotive`, `autovaleur`, `command-center`, `devx`, `idauto`,
`infrastructure`, `meta`, `mythos-ai-executor`, `mythos-core`,
`mythos-orchestrator`, `personal-intelligence`, `research-intelligence`,
`ssangyong-autos`.

**Projects discovered that were not in the ecosystem list given to this audit**
(all **VERIFIED** present in `VPS_TRANSFER` and/or `docs/OFFHOST_PROJECT_REGISTRY.md`):
`knowledgevault-kms` (752 files — the largest single body of work outside
mythos-prod), `karhmana`, `chatrange`, `classepro`, `oudhna-service`, `festival`,
`nettoyage-photo-vps`, `mythos-app`, `autovaleur`, `atelier-network`.

## 4. Previous design work recovered

### 4.1 Mythos OS application design system — VERIFIED, tracked, implemented

`css/main.css` defines **252 CSS custom-property occurrences** headed by a
complete dark-theme token block:

```
--bg #0e0e0e · --surface #161616 · --card #1d1d1d · --border #2a2a2a
--gold #c9a84c · --gold-light #e4c472 · --gold-dim rgba(201,168,76,0.12)
--text #e8e4dc · --muted #6b6860
--danger #c0392b · --green #2ecc71 · --blue #5dade2
--today #e67e22 · --past #555 · --purple #9b59b6   (each with a -dim variant)
```

Eight tracked stylesheets: `main.css`, `layout.css`, `dashboard.css`,
`forms.css`, `facture.css`, `calendrier.css`, `professional.css`, `print.css`.
72 tracked JS modules including a `js/core/` shell, router, plugin SDK and
service layer. **This is the only Mythos-branded design system that exists as
implemented, committed code.**

### 4.2 Uthina Chess brand kit — VERIFIED, complete, implemented, VPS-only

`VPS_TRANSFER/Uthina Chess/site/Uthina_Chess_Brand_Kit/CHARTE_GRAPHIQUE.md` is a
full graphic charter written in Arabic. It records:

- **Visual direction:** a luxury identity fusing Roman history, chess, theatrical
  lighting, black and gold, Roman stone and night sky.
- **Nine official colours:** Onyx Black `#050505`, Roman Night `#08111C`,
  Imperial Gold `#D9A441`, Deep Gold `#B8862B`, Soft Gold `#F2C86B`, Stone Ivory
  `#F7F0E3`, Marble Gray `#D8D0C2`, Antique Gray `#8B8377`, Panel Black `#0B0B0B`.
- **Typography:** Latin display Cinzel / Trajan Pro / Georgia; Arabic display
  Noto Kufi Arabic / Amiri / Cairo / Tahoma; body Inter / Segoe UI / Arial. The
  charter states explicitly that **no font files ship in the pack**.
- **Page structure:** Hero (logo, title, countdown, CTA) → Details (date, venue,
  tournament type) → Registration form (name, phone, email, club, category).

**Implementation confirmed.** `/var/www/uthinachess/0726/Uthina_Chess_Brand_Kit/assets/css/uthina-theme.css`
declares all nine colours as `--uc-*` custom properties and the exact three font
stacks, plus `--uc-radius-xl:28px`, `--uc-radius-md:14px` and
`--uc-shadow-gold:0 0 38px rgba(217,164,65,.32)`. The live `index.html` links
that theme. **This is the only project in the entire portfolio with a written
charter that is demonstrably implemented.**

### 4.3 Dar Hijama brand identity — VERIFIED as an artifact, NOT implemented

`VPS_TRANSFER/darhijama/assets/dar-hijama-piste1-charte-corrigee.txt` records a
complete identity, including a correction note (Arabic text converted to vector
outlines so `دار حجامة` renders without the font installed):

- **Concept:** fusion of a house and a hijama cup — home service, trust,
  traditional care, digital legibility.
- **Palette:** primary green `#16A34A`, turquoise accent `#14B8A6`, soft gray
  `#6B7280`, dark text `#2F3437`, white `#FFFFFF`, monochrome black `#111111`.
- **Typography:** Arabic Noto Sans Arabic / Cairo / IBM Plex Sans Arabic; Latin
  Inter / Manrope.
- **Clear-space rule:** minimum protection zone X around the logo, where X = the
  height of the cup's upper point.
- **Minimum sizes:** full logo 120 px screen / 25 mm print; icon alone 64 px
  screen / 12 mm print.

Fifteen asset files accompany it (vectorised SVGs, editable SVGs, PNG at
512/1024/2048, favicon 64, horizontal and monochrome variants), present both in
`VPS_TRANSFER/darhijama/assets/` and `/var/www/darhijama.tn/assets/`.

**Conflict — see §14.** The live `/var/www/darhijama.tn/index.html` does **not**
use this palette. Its dominant colours are a warm cream set (`#f5efe0`,
`#ede3cc`, `#e8dfc8`, `#e8c97a`, `#a89870`) plus `#c9a84c` — the Mythos OS gold —
and WhatsApp green `#25D366`/`#128C7E`. Not one of the six charter colours
appears.

### 4.4 Per-project stylesheets — VERIFIED, tracked, mutually unrelated

| Project | File | Scheme | Ground | Accent | Radius |
|---|---|---|---|---|---|
| Mythos OS | `css/main.css` | dark | `#0e0e0e` | gold `#c9a84c` | — |
| Command Center | `projects/command-center/reference/web/app.css` | light | `#f6f7f9` | indigo `#4f46e5` | `10px` |
| ID Auto | `projects/idauto/reference/admin.css` | dark | `#0b1220` | teal `#72d7c5` | `14px` |
| SsangYong | `projects/ssangyong-autos/reference/shop.css` | light | `#f5f6f8` | navy `#0d3b66` | `6px` |

**Four projects, four unrelated palettes, four radius scales, two colour
schemes.** No shared token file, no import relationship, no common variable
names. See §9 of `docs/MYTHOS_DESIGN_STRATEGY.md`.

### 4.5 Logo assets — VERIFIED

Tracked (7 files): `assets/logos/logomythos.png`, `logo.png`, `logo-sdt.png`,
`logo-kacem.png`, `logo-uthina-chess.png`, `assets/icons/icon-192.png`,
`icon-512.png`. Restored in commit `09d5fe1` (2026-08-13) after an audit found
the application referenced five logos of which only one existed; they were
recovered from `VPS_TRANSFER` with SHA-256 confirmation.

Untracked logo material exists for Dar Hijama (15 files, the only project with a
full SVG suite), AgriBee (`logo-agribee.png`), Fixpert (`logo-fixpert.png`),
Uthina Chess (`logo-luxe.png`, `logo-wide.png`, `logo-dossier.svg`, plus seven
partner logos).

**No SVG and no font file is tracked in `mythos-prod`.** VERIFIED by
`git ls-files` — 18 design-type files total, all PNG or CSS.

## 5. VPS-only artifacts

`/home/ubuntu/incoming/VPS_TRANSFER` — **2,241 files / 159,035,008 bytes**,
13 project directories, SHA-256 verified 2,241/2,241 per the committed record.
The repository's own handover states **829 files exist only there**.

| Artifact | Persistent path | Class |
|---|---|---|
| Uthina Chess brand kit + charter | `VPS_TRANSFER/Uthina Chess/site/Uthina_Chess_Brand_Kit/` | **UNTRACKED ON VPS** — canonical design work |
| Dar Hijama charter + 15 assets | `VPS_TRANSFER/darhijama/assets/` | **UNTRACKED ON VPS** — canonical design work |
| Uthina sponsorship dossier | `VPS_TRANSFER/Uthina Chess/Uthina_Chess_Dossier_Sponsoring_HTML/` | **UNTRACKED ON VPS** |
| NotreJour design/spec set (7 files) | `VPS_TRANSFER/Notrejour/…` — `notrejour_blueprint/docs/`, `Contenu/landing.txt`, `Prompts/PROMPT_MAITRE.txt`, `Technique/architecture.txt`, 2 mockup PNGs | **UNTRACKED ON VPS** — explicitly deferred, destination undecided |
| AgriBee site + logo | `VPS_TRANSFER/agribee/` | **UNTRACKED ON VPS** |
| Consolidation manifest | `VPS_TRANSFER/_MYTHOS_CONSOLIDATION/_MANIFEST.{md,json}` | **UNTRACKED ON VPS** — provenance record |
| `SKILL_MOTION (2).md` | `VPS_TRANSFER/SKILL_MOTION (2).md` | **DUPLICATE / NOT MYTHOS DESIGN** — see §7 |
| Live web roots | `/var/www/{darhijama.tn,fixpert.tn,notrejour,ssangyong.autos,uthinachess}` | **UNTRACKED ON VPS** — deployed, not in `mythos-prod` |

**Nothing was deleted, modified, moved, or renamed.**

`_MANIFEST.md` (2026-08-13) records a non-destructive consolidation: 3,109 file
instances analysed, 1,564 distinct by SHA-256, 959 consolidated, 322 already
canonical in Git, **0 originals deleted**, 65 excluded as sensitive.

## 6. Git history findings

203 commits match the design-term search. The genuinely design-bearing ones:

| Commit | Date | What it actually contains | Status |
|---|---|---|---|
| `d1a9d19` | 2026-07-29 | **Initial import of Mythos Prod** — 42 files, 19,584 insertions. Origin of `css/`, `js/`, `assets/`, `index.html`, `manifest.json` | Foundational |
| `09d5fe1` | 2026-08-13 | Restored four referenced logo assets from `VPS_TRANSFER`; 1-of-5 asset references had resolved before it | Current |
| `9763241` | — | SYA-SHOP-1 storefront consuming the catalog API — origin of `shop.css`/`shop.html` | Current |
| `1bcba2c` | — | **Three layout defects fixed**, found by headless-browser review | Current |
| `00a70b2` | — | SYA-SHOP-1b stage record — headless-browser visual verification | Current |
| `dae9f35` | 2026-08-17 | MCC-1 Command Center — origin of `app.css` (761 lines), `app.js` (1,566), `i18n.js` (464) | Current |

**Only two commits in the entire history touch `css/` or `assets/`:** `d1a9d19`
and `09d5fe1`. **VERIFIED** by `git log --all -- css/ assets/`. The Mythos OS
visual layer has not been revised since its initial import.

## 7. Previous Claude design work

**VERIFIED.** Claude-authored stage records, architecture documents and handovers
are extensive — 125 tracked files under `docs/`, and `Co-Authored-By: Claude` on
commits including `09d5fe1` and `b54b4f6`. `VPS_TRANSFER/Mythos/CLAUDE.md` and
`AGENTS.md` are recorded as byte-identical to their repository counterparts.

**However: no Claude-authored *design* specification was found.** The recovered
Claude corpus is architecture, governance, orchestration, data and process
documentation. There is no visual-identity document, no design-system
specification, no UI design brief, and no design prompt authored for Mythos.

`VPS_TRANSFER/SKILL_MOTION (2).md` is **not Mythos design work**: it is a copy of
a generic third-party motion-design skill for the Higgsfield connector, identical
in kind to the `motion-design` skill available in the standard skill catalogue.
It contains no Mythos-specific decision. Classified **DUPLICATE / NOT MYTHOS
DESIGN** so a future session does not mistake it for a recovered motion system.

NotreJour's `Prompts/PROMPT_MAITRE.txt` and `Contenu/landing.txt` are the closest
thing to recovered design prompts, and they belong to NotreJour, not to Mythos.

## 8. Existing prototypes

| Prototype | Location | State |
|---|---|---|
| Uthina Chess site (multiple generations) | `/var/www/uthinachess/`, `0726/`, `0726/uthina chess site/`, `0726/Prod/`, `site f/` | At least five parallel copies — VERIFIED, dates 2026-06-29 → 2026-07-06 |
| SsangYong storefront | `/var/www/ssangyong.autos/` (92 files) + tracked `reference/shop.html` | Two independent implementations |
| Dar Hijama static site | `/var/www/darhijama.tn/index.html` (56,045 bytes, single file) | Live vhost **disabled**; a proxied app serves the domain instead |
| Fixpert site | `/var/www/fixpert.tn/` (22 files, `styles.css` 11,711 bytes) | Live |
| NotreJour | `/var/www/notrejour/` — Laravel + Vite, 19,254 files, 323 MB | Live |
| AgriBee | `VPS_TRANSFER/agribee/` | **No vhost — not served** |

## 9. Existing branding

**VERIFIED as existing:** Mythos wordmark PNG (`assets/logos/logomythos.png`),
app icons at 192/512, and the Mythos OS dark-and-gold token set.

**UNKNOWN:** every other attribute of the Mythos master brand. There is no
Mythos colour specification document, no typography specification, no logo usage
rule, no clear-space rule, no vector master, and no statement of what the gold
`#c9a84c` signifies or where it came from. The gold exists as a CSS value; its
rationale is nowhere recorded.

## 10. Existing UI systems

One implemented system (Mythos OS `css/` + `js/core/`), three independent
project stylesheets, one implemented external brand kit (Uthina Chess). No shared
component library, no design-token package, no cross-project import.

**INFERRED, not decided:** the repeated pattern of `:root` custom properties in
all four stylesheets suggests a shared convention *of technique*. No document
mandates it and the variable names do not agree (`--bg`/`--text` vs `--ink`/
`--ground` vs `--uc-*`).

## 11. Existing UX decisions

**VERIFIED and documented:** only the Uthina Chess page hierarchy (§4.2). The
SsangYong storefront's information architecture is **VERIFIED as implemented**
(catalogue → category → product, plus `garantie`, `cgv`, `confidentialite`,
`a-propos`, `boutique`, `pro/`) but was never written down as a UX decision.

**Recovered as a corrected outcome, not a decision:** commit `1bcba2c` fixed
three layout defects found by headless-browser review — evidence that
**responsive verification was performed at least once**, on one project.

Everything else is **UNKNOWN**. No navigation specification, user-flow document,
mobile-behaviour rule, or accessibility statement exists for any project.

## 12. Abandoned and incomplete work

| Item | Evidence | State |
|---|---|---|
| **Mouain (Education OS)** | Branch `docs/mouain-foundation` @ `8e50293`, **1,787 insertions across 8 files** — `MOUAIN_VISION.md` (223), `MOUAIN_ARCHITECTURE.md` (368), `MOUAIN_PEDAGOGY.md` (271), `MOUAIN_ROADMAP.md` (364), `MOUAIN_FOUNDING_PEDAGOGICAL_COUNCIL.md` (278), `projects/mouain/README.md` (151) | **UNMERGED — invisible from `main`.** `git grep -i mouain HEAD` returns nothing. The single largest body of unmerged product work found |
| `docs/cloudflare-foundation` | 1 commit ahead of `main` | Unmerged; Cloudflare docs otherwise present on `main` |
| `agent/mythos-multi-agent-orchestrator-0/*` ×4 | 1 commit each ahead | Unmerged agent branches, 2026-08-12 |
| `darhijama.tn` static vhost | `sites-enabled/darhijama.tn.disabled-20260729-171012` | **Deliberately disabled 2026-07-29**; superseded by the `dar-hijama-app` proxy to `127.0.0.1:18081` |
| `uthinachess.bak.1782747890` | `sites-available/` | Backup vhost retained |
| Duplicate Uthina site generations | Five parallel copies under `/var/www/uthinachess/` | Superseded but preserved |
| 975 deferred transfer files | Handover record | Awaiting owner destination decision since 2026-08-13 |

## 13. Missing design work

**VERIFIED absent** — searched and not found:

- No Mythos master brand specification, visual identity, or logo usage rules.
- No shared design system, token package, or component library.
- **No `mythosprod.xyz` apex site.** Only three subdomain vhosts exist:
  `panel` → `127.0.0.1:8000`, `tv` → `127.0.0.1:8096` (Jellyfin),
  `ordre` → `127.0.0.1:3021` (Command Center). The master domain serves nothing.
- No site or vhost for `agribee.tn`, `idauto.tn`, or `mouain.tn`.
- No SVG or font file tracked anywhere in `mythos-prod`.
- No accessibility specification, no motion specification, no responsive
  standard, no performance budget — for any project.
- No design documentation for Mythos OS itself beyond the CSS.

## 14. Conflicting design decisions

**C-1 — Dar Hijama charter vs live site. VERIFIED conflict.** The charter
specifies green `#16A34A` / turquoise `#14B8A6`. The live site uses cream and
`#c9a84c`. Zero charter colours appear in the deployed page. Which is
authoritative is **UNKNOWN** — the charter is dated by its `piste1` naming as a
selected route, but the site may postdate it.

**C-2 — "piste 1" implies rejected alternatives. VERIFIED partial.** Every Dar
Hijama asset is named `dar-hijama-piste1-*`. A "piste 1" presupposes a piste 2
and possibly 3. **No other piste survives anywhere on the VPS or in Git.** The
alternatives and the reason piste 1 won are **NOT RECOVERED**.

**C-3 — Two golds. VERIFIED.** Mythos OS uses `#c9a84c`; Uthina Chess Imperial
Gold is `#D9A441`. Both are dark-ground gold identities. Whether Uthina derives
from Mythos, Mythos from Uthina, or the resemblance is coincidental is
**UNKNOWN** — no document connects them.

**C-4 — Four palettes, no arbitration.** §4.4. Nothing records whether project
brand independence was a decision or an accident.

**C-5 — `darhijama.tn` served two ways.** A disabled static vhost and an active
proxy vhost both claim `server_name darhijama.tn`. The static site holds the
brand assets; the proxied app is what visitors reach.

## 15. Important recovery paths

Preserve these. Several hold the only copy of their content.

```
/home/ubuntu/incoming/VPS_TRANSFER/                                   2,241 files, 159,035,008 bytes
  └ Uthina Chess/site/Uthina_Chess_Brand_Kit/CHARTE_GRAPHIQUE.md      only written charter, implemented
  └ darhijama/assets/dar-hijama-piste1-charte-corrigee.txt            only written charter, not implemented
  └ darhijama/assets/*.svg                                            only tracked-quality vector suite (15 files)
  └ Notrejour/NotreJour_MVP_Evolutif/{Prompts,Contenu,Technique}/     7 deferred design/spec files
  └ _MYTHOS_CONSOLIDATION/_MANIFEST.json                              provenance for 1,564 distinct files
/var/www/uthinachess/0726/Uthina_Chess_Brand_Kit/assets/css/uthina-theme.css   the implemented charter
/var/www/{darhijama.tn,fixpert.tn,notrejour,ssangyong.autos,uthinachess}/      live, untracked
git branch docs/mouain-foundation                                     1,787 lines unmerged
```

## 16. Recovery limitations

Stated plainly, so nothing here is read as more complete than it is.

1. **The 14 off-host repositories were not opened.** No credential for them
   exists on this host. Their contents are reported from the committed registry.
   Design work may exist in them — `uthina-chess` alone is 102 MB — and this
   audit cannot see it.
2. **`/home/deploy/` is not readable** by the audit's shell beyond the repository
   itself. Deployment-side artifacts under that home were not enumerable.
3. **The owner's PC was not contacted**, per standing rule. `C:\Users\Othman\Desktop\site`
   is referenced by `_MANIFEST.md` as the consolidation target and is out of reach.
4. **`node_modules` and vendor trees were excluded.** NotreJour's 19,254 files
   were inventoried at directory level only.
5. **Four concurrent sessions and an active autonomous loop** were running during
   this audit; `main` advanced five times across the wider task. Findings are a
   snapshot at `fcd899b`.
6. **No design decision was reconstructed by inference.** Where the "why" was not
   written down — the Mythos gold, the piste-1 selection, the four-palette
   divergence — it is recorded as UNKNOWN rather than guessed.
