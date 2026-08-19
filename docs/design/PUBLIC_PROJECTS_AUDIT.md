# Mythos Public Projects Audit

**Produced by:** a specialist audit agent, under the delegated mandate, for
chief review.
**Date:** 2026-08-19 UTC
**Status:** **AUDIT ONLY — changes nothing.** No project, CSS, application,
asset, DNS or configuration file was touched. No POST/PUT/DELETE request was
made. This document authorises, recommends, or performs no implementation.

**Scope.** The eight independent public projects under **A-004**:
`agribee.tn`, `darhijama.tn`, `fixpert.tn`, `idauto.tn`, `mouain.tn`,
`notrejour.tn`, `ssangyong.autos`, `uthinachess.tn`. Per **A-004/A-006**, none
receives or is proposed to receive the Mythos visual skin.

**Evidence base.** `docs/MYTHOS_PROJECT_DESIGN_MATRIX.md` (2026-08-17,
`main`@`fcd899b`), `docs/design/PUBLIC_ECOSYSTEM_ARCHITECTURE.md` (2026-08-18),
`docs/design/MIGRATION_PLANS.md` (2026-08-18), `docs/MYTHOS_DESIGN_RECOVERY.md`
§4/§14, `docs/AI_HANDOVER.md` (2026-08-19), `projects/ssangyong-autos/`,
`git log --all`, plus a live HTTP check attempted against each domain today.

---

## 1. Live-check attempt — governs every "SEO basics" row below

**All eight checks failed identically, before reaching any host.** The
session's outbound egress proxy rejected the CONNECT tunnel to all eight
domains with `403` ("policy denial"), confirmed via the proxy's status
endpoint (`recentRelayFailures`, 2026-08-19T02:48:26–29Z). This is an
**organisation egress-policy denial**, not a DNS failure or timeout, and not
evidence about the sites themselves. Per the proxy's own guidance, a 403
policy denial is reported, not retried — each domain was attempted exactly
once.

**Consequence:** every status/SEO claim below is **in-repo evidence only**,
labelled **not independently re-verified today**. This is itself a
discrepancy to flag: **the mandate asked for a live reconciliation and the
environment could not perform one.** Resolution: re-run the same eight GETs
from a host whose egress policy permits these domains.

---

## 2. Summary table

| Project | Domain | Ledger status | Live check | Charter recovered | Migration plan | Risk |
|---|---|---|---|---|---|---|
| Uthina Chess | `uthinachess.tn` | **LIVE** | UNKNOWN (§1) | Yes — implemented (only such case) | Ecosystem strip only | Low |
| SsangYong.autos | `ssangyong.autos` | **LIVE** | UNKNOWN (§1) | No — logo only | Ecosystem strip only | Low |
| Fixpert | `fixpert.tn` | **LIVE** | UNKNOWN (§1) | No — logo only | Ecosystem strip only | Low |
| Notre Jour | `notrejour.tn` | **LIVE** | UNKNOWN (§1) | No — deferred/uncommitted | No action | None |
| Dar Hijama | `darhijama.tn` | **LIVE (proxied)** | UNKNOWN (§1) | Yes — complete, **not implemented**; live site conflicts with it (C-001) | Not this program's to write | Not rated |
| AgriBee | `agribee.tn` | **BUILT**, not served | UNKNOWN (§1) | No — logo only | No action pending O-007 | None |
| ID Auto | `idauto.tn` | **BUILT**, no vhost (canonical impl. now external — §9) | UNKNOWN (§1) | No | No action — internal admin only | None |
| Mouain | `mouain.tn` | **BUILT**, no vhost, 1,787 unmerged lines | UNKNOWN (§1) | No | No action pending O-006 | None |

**Reconciliation:** no ledger-vs-live discrepancy could be established either
way today — the live check never reached any host (§1). The one
**already-recorded** discrepancy in the evidence base is Dar Hijama's
charter-vs-deployed-site conflict (**C-001**) — not a new finding, carried
forward in §7.

---

## 3. Uthina Chess — `uthinachess.tn`

- **Ownership:** independent, A-004/A-006 — never receives the Mythos skin.
- **Status:** **LIVE** — static root `/var/www/uthinachess` (design matrix §8).
- **Design summary:** dark luxury identity — Onyx Black `#050505`, Roman
  Night `#08111C`, Imperial Gold `#D9A441`, Deep Gold `#B8862B`, Soft Gold
  `#F2C86B`, Stone Ivory `#F7F0E3`, Marble Gray `#D8D0C2`, Antique Gray
  `#8B8377`, Panel Black `#0B0B0B`. Latin display Cinzel/Trajan Pro/Georgia;
  Arabic display Noto Kufi Arabic/Amiri/Cairo/Tahoma; body Inter/Segoe
  UI/Arial (recovery doc §4.2).
- **Recovered charter:** `VPS_TRANSFER/Uthina Chess/site/
  Uthina_Chess_Brand_Kit/CHARTE_GRAPHIQUE.md` — the only charter in the
  portfolio confirmed implemented, matched byte-for-byte against the live
  `uthina-theme.css` (recovery doc §4.2). Untracked in `mythos-prod`.
- **SEO basics:** UNKNOWN — proxy blocked (§1).
- **Deployment:** static, VPS-only, untracked here.
- **Migration risk:** ecosystem strip only, if attribution is wanted. Low.
- **Rollback:** the live theme file is not tracked here, so `git revert`
  reverts nothing on the host.

## 4. SsangYong.autos — `ssangyong.autos`

- **Ownership:** independent, A-004/A-006.
- **Status:** **LIVE** — static root `/var/www/ssangyong.autos`; also a live
  shop surface (`SYA-SHOP-1`) and `n8n.ssangyong.autos` (automation, not a
  brand surface).
- **Design summary:** light scheme, ground `#f5f6f8`/`#fff`, navy accent
  `#0d3b66`, text `#14181d`, 6px radius. Reference implementation tracked at
  `projects/ssangyong-autos/reference/` (`shop.css`, `shop.html`,
  `shop-ui.js`, `api.js`, `db.js`) — the only one of the eight with source
  tracked in `mythos-prod`.
- **Recovered charter:** none — logo and an OG SVG only.
- **SEO basics:** UNKNOWN — proxy blocked (§1).
- **Deployment:** mature build (three defects previously fixed, commit
  `1bcba2c`), no brand documentation.
- **Migration risk:** ecosystem strip only; no charter to migrate against. Low.
- **Rollback:** standard `git revert` on the tracked `projects/ssangyong-autos/`
  tree; the deployed VPS root is separate and untracked.

## 5. Fixpert — `fixpert.tn`

- **Ownership:** independent, A-004/A-006.
- **Status:** **LIVE** — static root `/var/www/fixpert.tn`; `styles.css` 11.7 KB.
- **Design summary:** UNKNOWN palette — none recovered. Logo only
  (`logo-fixpert.png`); a VPS `assets/fonts/` directory exists with no
  recorded typeface names.
- **Recovered charter:** none — documentation column is MISSING entirely.
- **SEO basics:** UNKNOWN — proxy blocked (§1).
- **Deployment:** built, live, the weakest-documented of the five live
  projects.
- **Migration risk:** ecosystem strip only. Low.
- **Rollback:** VPS-only file, not tracked here; no in-repo revert path.

## 6. Notre Jour — `notrejour.tn`

- **Ownership:** independent, A-004/A-006.
- **Status:** **LIVE** — Laravel + Vite app at `/var/www/notrejour`, the
  largest application in the public portfolio; design work deferred.
- **Design summary:** UNKNOWN — seven design/spec files exist but are
  explicitly deferred, uncommitted, destination-undecided
  (`VPS_TRANSFER/Notrejour/.../{Prompts,Contenu,Technique}/`).
- **Recovered charter:** none formalised; closest artifacts are
  project-owned prompts, not a Mythos-authored brief.
- **SEO basics:** UNKNOWN — proxy blocked (§1).
- **Deployment:** live; own design work explicitly not this program's to
  complete.
- **Migration risk:** **No action** — its design work is deferred, not this
  program's decision. None.
- **Rollback:** N/A — no change proposed.

## 7. Dar Hijama — `darhijama.tn`

- **Ownership:** independent, A-004/A-006.
- **Status:** **LIVE (proxied)** — active proxy `127.0.0.1:18081`; the
  static vhost carrying the brand assets was **disabled 2026-07-29**
  (design matrix §8; recovery doc §14 C-5).
- **Design summary — standing, already-recorded discrepancy:** charter
  specifies green `#16A34A`, turquoise `#14B8A6`, soft gray `#6B7280`, dark
  text `#2F3437`, white, monochrome black. The **live site** instead uses
  cream tones (`#f5efe0`, `#ede3cc`, `#e8dfc8`, `#e8c97a`, `#a89870`) plus
  `#c9a84c` (Mythos OS legacy gold) and WhatsApp green (`#25D366`/`#128C7E`).
  **Zero charter colours appear on the deployed page** (recovery doc §4.3,
  §14 C-1). Which is authoritative is **UNKNOWN** (`C-001`/`O-002`, open,
  not adjudicated here).
- **Recovered charter:** `VPS_TRANSFER/darhijama/assets/
  dar-hijama-piste1-charte-corrigee.txt` — complete (house + hijama-cup
  concept; Arabic Noto Sans Arabic/Cairo/IBM Plex Sans Arabic, Latin
  Inter/Manrope; clear-space and minimum-size rules). 15 asset files — the
  **only full SVG vector suite in the portfolio**, untracked. "Piste1"
  naming implies a rejected alternative not recovered anywhere (`C-2`).
- **SEO basics:** UNKNOWN — proxy blocked (§1).
- **Deployment:** live via proxy; brand assets exist but are not what users see.
- **Migration risk:** **"Not this program's plan to write."** C-001 is a
  real conflict between charter and live site; adjudicating it is a
  project-level decision. Not rated, deliberately.
- **Rollback:** N/A — no change proposed; conflict predates this audit.

## 8. AgriBee — `agribee.tn`

- **Ownership:** independent, A-004/A-006.
- **Status:** **BUILT / EXISTING**, not served — files (`index.html` +
  `recherche/`) exist, **uncommitted**; no vhost (**O-007** open: is it
  meant to be served?).
- **Design summary:** logo only (`logo-agribee.png`); no palette recovered.
- **Recovered charter:** none beyond the logo file.
- **SEO basics:** UNKNOWN — proxy blocked (§1); also moot, no vhost exists.
- **Deployment:** built, unserved.
- **Migration risk:** **No action** until **O-007** answered. None.
- **Rollback:** N/A — nothing deployed.

## 9. ID Auto — `idauto.tn`

- **Ownership:** independent, A-004/A-006. **Implementation-location note:**
  the recovery evidence (2026-08-17) describes `projects/idauto/` in this
  repo as the reference implementation. Git history since (`231ff82`,
  `chore(idauto): remove legacy implementation from mythos-prod`) shows that
  tree was **removed from `mythos-prod` on 2026-08-19**; `docs/AI_HANDOVER.md`
  records `othoth77/idauto` as the sole canonical implementation, fully
  merged (`91131eb`), zero remaining runtime references here. This changes
  nothing about `idauto.tn`'s public-domain status.
- **Status (pre-move design matrix):** **BUILT / EXISTING** — internal admin
  only; **no public vhost** for `idauto.tn`. The post-move handover confirms
  the public surface remains not ready: `CITIZEN_FACING_IDA4_READY = NO`,
  `PUBLIC_ENDPOINT_READY_TO_IMPLEMENT = NO`, gated on 16 open legal items and
  three owner-only gates (B1/B2/B3, A5).
- **Design summary:** the now-removed in-repo reference used dark ground
  `#0b1220`, teal accent `#72d7c5`, text `#e8eef9`, 14px radius, and one
  responsive breakpoint (520px) — historical evidence about the removed
  tree, not a claim about `othoth77/idauto`'s current state (out of scope).
- **Recovered charter:** none.
- **SEO basics:** UNKNOWN — proxy blocked (§1); also moot, no vhost exists.
- **Deployment:** internal admin implemented historically; no public
  surface; canonical source now external.
- **Migration risk:** **No action** — internal admin only, no public
  surface to migrate. None.
- **Rollback:** N/A here — nothing public in `mythos-prod` to roll back; any
  rollback of the `othoth77/idauto` decoupling is out of this audit's scope.

## 10. Mouain — `mouain.tn`

- **Ownership:** independent, A-004/A-006.
- **Status:** **BUILT / EXISTING**, not served — **1,787 unmerged lines** on
  branch `docs/mouain-foundation`, invisible from `main`; no vhost
  (**O-006** open: merge the lines?).
- **Design summary:** UNKNOWN — every design column (brand, UX, UI, mobile,
  components, motion, documentation) reads MISSING; work not visible from
  `main`.
- **Recovered charter:** none.
- **SEO basics:** UNKNOWN — proxy blocked (§1); also moot, no vhost exists.
- **Deployment:** unmerged, unserved.
- **Migration risk:** **No action** until **O-006** answered — migrating a
  design system onto uncommitted work is premature. None.
- **Rollback:** N/A — nothing merged or deployed.

---

## 11. Additional public-facing projects beyond the eight

No project beyond the named eight was found with any recorded **public**
domain or vhost, live or planned. `PUBLIC_ECOSYSTEM_ARCHITECTURE.md` §12.2
and the design matrix §7 record **twelve further projects** discovered in
repo/off-host evidence — KnowledgeVault KMS (752 files, the largest body of
design work outside the eight), Karhmana, Chatrange, ClassePro, Oudhna
Service, Festival, Nettoyage Photo VPS, Mythos App, Atelier Network,
AutoValeur, Personal Intelligence, Research Intelligence. These are formally
classified **internal tooling/archive** (**AUTO-3**, `ECO-3`): none carries
a recorded public domain or vhost; they do not appear in any future project
hub and are not audited individually here.

Two further live `mythosprod.xyz` subdomains — `panel.mythosprod.xyz`
(`127.0.0.1:8000`) and `tv.mythosprod.xyz` (Jellyfin, `127.0.0.1:8096`) —
are classified **internal infrastructure** (**ECO-2**), carry no Mythos
branding by design, and are not public projects in the A-004 sense; noted
for completeness only.

---

## 12. What this audit did not do

- Did not independently confirm any domain's live status, TLS, title, meta
  description, `lang`, or viewport meta — the live check failed uniformly at
  the egress-proxy layer before reaching any host (§1).
- Did not propose, imply, or recommend applying Mythos branding, palette,
  typography, or skin to any of the eight projects — forbidden by
  **A-006**/**A-021**.
- Did not adjudicate Dar Hijama's C-001, AgriBee's O-007, or Mouain's O-006
  — each stays open.
- Did not touch or change any project file, CSS asset, DNS record, or vhost.
- Did not treat `projects/idauto/`'s removal as a statement about
  `idauto.tn`'s public reachability — that remains no vhost, per the last
  direct evidence.
