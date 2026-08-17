# Mythos Project Design Matrix

**Stage:** MYTHOS-DESIGN-RECOVERY-0
**Date:** 2026-08-17 UTC
**Baseline:** `main` @ `fcd899b`

Evidence-only. Every cell reflects something read from a file, a commit, or the
live nginx configuration. Empty findings are recorded as **MISSING**, never
softened.

**Legend:** `COMPLETE` · `PARTIAL` · `IMPLEMENTED` (built, not documented) ·
`PLANNED` · `UNCOMMITTED` (exists on VPS only) · `MISSING` · `UNKNOWN`

---

## 1. Master matrix — public projects

| Project | Domain | Served | Brand | UX | UI | Mobile | Components | Motion | Documentation | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| **Uthina Chess** | `uthinachess.tn` | **live** | COMPLETE (9 colours, 3 font stacks) | COMPLETE (documented hierarchy) | IMPLEMENTED | PARTIAL (`clamp()` only) | MISSING | MISSING | COMPLETE (charter, UNCOMMITTED) | **Strongest in portfolio** |
| **SsangYong** | `ssangyong.autos` | **live** | PARTIAL (logo, no charter) | IMPLEMENTED (never written) | IMPLEMENTED ×2 | UNKNOWN (3 defects fixed) | MISSING | MISSING | PARTIAL (stage records) | Mature build, no brand doc |
| **Dar Hijama** | `darhijama.tn` | **live** (proxied) | COMPLETE but **UNIMPLEMENTED** | MISSING | IMPLEMENTED (ignores charter) | UNKNOWN | MISSING | MISSING | COMPLETE (charter, UNCOMMITTED) | **Conflicted** — C-001 |
| **Fixpert** | `fixpert.tn` | **live** | PARTIAL (logo only) | MISSING | IMPLEMENTED (`styles.css` 11.7 KB) | UNKNOWN | MISSING | MISSING | MISSING | Built, undocumented |
| **NotreJour** | `notrejour.tn` | **live** | UNKNOWN | UNCOMMITTED (blueprint deferred) | IMPLEMENTED (Laravel + Vite) | UNKNOWN | UNKNOWN | MISSING | UNCOMMITTED (7 files, unplaced) | Largest app; design deferred |
| **AgriBee** | `agribee.tn` | **NOT SERVED** | PARTIAL (logo only) | MISSING | UNCOMMITTED (`index.html` + `recherche/`) | UNKNOWN | MISSING | MISSING | MISSING | Files exist, no vhost |
| **ID Auto** | `idauto.tn` | **NOT SERVED** | MISSING | MISSING | IMPLEMENTED (internal admin only) | PARTIAL (one breakpoint) | MISSING | MISSING | PARTIAL (architecture docs) | No public site exists |
| **Mouain** | `mouain.tn` | **NOT SERVED** | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | **UNMERGED** (1,787 lines) | Docs invisible from `main` |

## 2. Master matrix — Mythos platform and companies

| Entity | Domain | Served | Brand | UX | UI | Documentation | Status |
|---|---|---|---|---|---|---|---|
| **Mythos (master)** | `mythosprod.xyz` | **NO APEX VHOST** | PARTIAL (wordmark PNG only) | MISSING | MISSING | MISSING | **No public presence** |
| **Mythos OS** | — (internal) | n/a | PARTIAL (tokens, no spec) | PARTIAL | **IMPLEMENTED** (252 tokens, 8 CSS, 72 JS) | MISSING (design), extensive (architecture) | Only mature design system |
| **Mythos Command Center** | `ordre.mythosprod.xyz` | **live** | MISSING | IMPLEMENTED | IMPLEMENTED (light/indigo) | PARTIAL (architecture) | Newest; own palette |
| **Mythos Prod** | — | n/a | UNKNOWN | MISSING | MISSING | Name only (`d1a9d19`) | Name in use, nothing else |
| **Mythos Services** | — | no | **MISSING** | MISSING | MISSING | **NO EVIDENCE** | Not found anywhere |
| **Mythos Digital** | — | no | **MISSING** | MISSING | MISSING | **NO EVIDENCE** | Not found anywhere |
| **Mythos Logistique** | — | no | **MISSING** | MISSING | MISSING | **NO EVIDENCE** | Not found anywhere |

**Subdomains that do exist:** `panel.mythosprod.xyz` → `127.0.0.1:8000`;
`tv.mythosprod.xyz` → `127.0.0.1:8096` (Jellyfin); `ordre.mythosprod.xyz` →
`127.0.0.1:3021` (Command Center). **No apex vhost for `mythosprod.xyz`.**

## 3. Confirmed vs intended architecture

| Layer | Intended | Confirmed by evidence | Gap |
|---|---|---|---|
| Mythos master brand | Parent identity over all | Wordmark PNG; no spec, no apex site | **Entire layer missing** |
| Five Mythos companies | OS · Prod · Services · Digital · Logistique | OS verified; Prod is a name; **three have zero evidence** | 3 of 5 unevidenced |
| Public projects under Mythos | 8 domains sharing a parent | 5 live, 3 not served; **no project shows any Mythos mark** | No visible parent–child link |
| Shared design system | Common DNA across projects | 4 unrelated palettes; no shared file | **Does not exist** |

**The flat-portfolio finding.** Nothing in any deployed site, stylesheet, or
tracked document identifies a project as belonging to Mythos. There is no shared
header, no endorsement mark, and no "a Mythos project" string in the corpus. The
hierarchy is intended, not implemented.

## 4. Design tokens actually implemented

| Project | File | Scheme | Ground | Accent | Text | Radius | Tracked |
|---|---|---|---|---|---|---|---|
| Mythos OS | `css/main.css` | dark | `#0e0e0e`/`#161616`/`#1d1d1d` | gold `#c9a84c` | `#e8e4dc` | — | **yes** |
| Command Center | `projects/command-center/reference/web/app.css` | light | `#f6f7f9`/`#ffffff` | indigo `#4f46e5` | `#14181f` | `10px`/`6px` | **yes** |
| ID Auto | `projects/idauto/reference/admin.css` | dark | `#0b1220` | teal `#72d7c5` | `#e8eef9` | `14px` | **yes** |
| SsangYong | `projects/ssangyong-autos/reference/shop.css` | light | `#f5f6f8`/`#fff` | navy `#0d3b66` | `#14181d` | `6px` | **yes** |
| Uthina Chess | `/var/www/uthinachess/.../uthina-theme.css` | dark | `#050505`/`#08111C` | gold `#D9A441` | `#F7F0E3` | `28px`/`14px` | **no — VPS only** |

Four tracked, one deployed-only. **No two share a variable name.**

## 5. Assets

| Project | Logo | Vector | Variants | Icons | Fonts | Location |
|---|---|---|---|---|---|---|
| Mythos | `logomythos.png` | **no** | no | 192/512 | no | **tracked** `assets/` |
| Dar Hijama | yes | **yes — 7 SVG** | principal, horizontal, icon, mono ×2, editable ×4 | favicon 64 | no | VPS only |
| Uthina Chess | yes | `logo-dossier.svg` | luxe, wide, dossier + 7 partner logos | no | **none shipped** | VPS only |
| SsangYong | `logo.png` | `og-default.svg` | no | no | no | VPS only |
| Fixpert | `logo-fixpert.png` | no | no | no | `assets/fonts/` present | VPS only |
| AgriBee | `logo-agribee.png` | no | no | no | no | VPS only |
| Others | `logo-sdt.png`, `logo-kacem.png`, `logo-uthina-chess.png` | no | no | no | no | **tracked** |

**`mythos-prod` tracks 18 design-type files — all PNG or CSS. Zero SVG, zero
fonts.** Dar Hijama holds the portfolio's only real vector suite, and it is
untracked.

## 6. Cross-cutting gaps

| Capability | Any project? | Notes |
|---|---|---|
| Responsive standard | **No** | One breakpoint (ID Auto `520px`), one `clamp()`, three fixed defects. **Largest gap** for a mobile-dominant market |
| Motion system | **No** | Zero animation/transition/hover conventions anywhere |
| Accessibility standard | **No** | One focus ring (ID Auto); four `color-scheme` declarations. Contrast not measured |
| Component library | **No** | Every project re-solves buttons, cards, forms |
| Spacing / grid | **No** | No scale in any document or stylesheet |
| Type scale | **No** | Two charters name typefaces; no project defines a scale |
| Performance budget | **No** | 2.4 MB and 1.75 MB uncompressed PNGs in live roots |
| Clear-space rules | **1 of 8** | Dar Hijama only (D-006) |
| Design QA method | **1 of 8** | SsangYong headless-browser review (D-010) |

## 7. Projects discovered outside the supplied ecosystem list

All **VERIFIED** present, none in the eight-domain list given to this audit.

| Project | Evidence | Design state |
|---|---|---|
| **KnowledgeVault KMS** | Off-host repo, 753 files; `VPS_TRANSFER/Mythos/KnowledgeVaultKMS/` | **752 distinct files — largest body of work outside `mythos-prod`.** Architecture/ADR docs; design UNKNOWN |
| Karhmana | Off-host repo (16 files); transfer (15) | Windows automation scripts; no design |
| Chatrange | Off-host repo (4 files) | 3 loose images only |
| ClassePro | Off-host repo (2 files) | 1 generated image |
| Oudhna Service | Off-host repo (3 files) | 2 Arabic HTML listings |
| Festival | Off-host repo (4 files) | UNKNOWN |
| Nettoyage Photo VPS | Off-host repo (11 files) | UNKNOWN |
| Mythos App | Off-host repo (8 files) | UNKNOWN — distinct from Mythos OS |
| Atelier Network | `projects/atelier-network` + 3 tracked docs | Spec only, no UI |
| AutoValeur | `projects/autovaleur` + 3 tracked docs | Spec only, no UI |
| Personal Intelligence | `projects/personal-intelligence` | Runtime; no UI |
| Research Intelligence | `projects/research-intelligence` | Runtime; no UI |

**The eight-domain list understates the portfolio by at least twelve projects.**

## 8. Live-service map

| Domain | Backend | Notes |
|---|---|---|
| `ssangyong.autos` | static `/var/www/ssangyong.autos` | live |
| `n8n.ssangyong.autos` | n8n container | automation |
| `uthinachess` | static `/var/www/uthinachess` | live; brand kit implemented |
| `fixpert.tn` | static `/var/www/fixpert.tn` | live |
| `notrejour.tn` | Laravel `/var/www/notrejour` | live |
| `darhijama.tn` | proxy `127.0.0.1:18081` | live; **static vhost disabled 2026-07-29** |
| `ordre.mythosprod.xyz` | proxy `127.0.0.1:3021` | Command Center, **running from the repo checkout** |
| `panel.mythosprod.xyz` | proxy `127.0.0.1:8000` | |
| `tv.mythosprod.xyz` | proxy `127.0.0.1:8096` | Jellyfin |
| `mythosprod.xyz` | **none** | **no apex vhost** |
| `agribee.tn` · `idauto.tn` · `mouain.tn` | **none** | no vhost |
