# Mythos Original Logo Recovery

**Stage:** MYTHOS-DESIGN-1B-PREP — original logo recovery (Stage 1, First Action)
**Date:** 2026-08-18 UTC
**Baseline:** branch `claude/mythos-master-brand-design-c3vy6b` @ `447026bb4051c802226d6c5238cf9eea3efd6fd4` (= `origin/main` at audit time)
**Nature:** recovery and documentation only. **No logo was designed, modified, moved, renamed, or overwritten.** No production file was touched.

This document is the canonical record of the original Mythos logo. Claims are
classified **VERIFIED** (confirmed directly from a file or commit in this
session), **DOCUMENTED** (recorded in a committed canonical document but not
re-verifiable from this environment), or **UNKNOWN**. Nothing is promoted
between classes.

---

## 1. Scope, method, and environment

Search performed in this session:

- **Working tree** at `447026b` — all tracked files, `git ls-files` filtered
  for every raster/vector format (`png`, `jpg`, `jpeg`, `svg`, `ico`, `webp`,
  `gif`, `pdf`).
- **Full Git history** — the session began on a shallow clone (50 commits);
  it was explicitly **unshallowed** (`git fetch --unshallow`) to 438 commits
  and 36 remote branches before any historical claim was made. All refs were
  searched for image additions, deletions, and modifications
  (`git log --all --diff-filter=A|DM`), and commit messages for logo-related
  work (`git log --all --grep`).
- **Application reference sites** — `index.html`, `manifest.json`,
  `js/app.js`, `js/app-fresh.js`, `js/shared/devis.js`, `css/*.css`
  (including embedded `data:image` URIs — all three are gold form-control
  chevrons, not logos).
- **Committed canonical records** — `docs/MYTHOS_DESIGN_RECOVERY.md`,
  `docs/MYTHOS_DESIGN_DECISIONS.md` (D-011), `docs/MYTHOS_PROJECT_DESIGN_MATRIX.md`,
  and the `09d5fe1` entry of `docs/AI_HANDOVER.md`, which carries the
  restore-time SHA-256 verification record.

**Environment limitation (stated plainly).** This session runs in an
ephemeral cloud container holding only the Git repository. The VPS
filesystem is **not reachable**: `/home/ubuntu/incoming/VPS_TRANSFER`,
`/var/www/*`, `/srv/mythos/*` and `/home/deploy/*` were checked and do not
exist here. Everything VPS-side in this document is therefore class
**DOCUMENTED**, cited from the committed records above, which themselves
recorded SHA-256 verification at the time the events happened. Nothing
VPS-side was re-hashed in this session.

`docs/MYTHOS_DESIGN_ARTIFACT_REGISTRY.md`, listed as a canonical input for
this program, **does not exist** at `447026b` (VERIFIED by `ls`/`git ls-files`).

## 2. The original logo — canonical identification

**VERIFIED.** The original Mythos identity is the **MYTHOS PROD lockup**, and
its highest-quality recovered rendition is:

```
assets/logos/logomythos.png
```

| Field | Value |
|---|---|
| Path | `assets/logos/logomythos.png` |
| Format | PNG, 8-bit RGBA, non-interlaced — **raster only** |
| Dimensions | **1672 × 941 px** |
| File size | 2,092,774 bytes |
| SHA-256 | `b7bd0ac185576a02238c5fb0b3b651e0b289e4276f32f27f1cbab78d205c6a76` |
| Git blob | `354e6bbbcd5ef053815e285684da678ed776ebbc` |
| Entered Git | commit `09d5fe1` — 2026-08-13 16:16:08 +0000, author Othman Haddad |
| Modified since | **Never.** Zero image files have ever been modified or deleted anywhere in the repository's history (VERIFIED, `--diff-filter=DM` empty across all 36 branches) |
| Transparency | **None.** Despite the RGBA channel, every pixel is fully opaque — solid black ground |
| Original / modified | Recovered copy of the historical source; SHA-256 confirmed against the `VPS_TRANSFER` package at restore time (DOCUMENTED, commit body of `09d5fe1`) |
| Creation date | **UNKNOWN.** Not recorded anywhere. The app's cache-buster `?v=20260626-devis-kacem` (`index.html:2198`) places the surrounding application era at June 2026; the file itself carries no provenance metadata that was recoverable |

**Composition (VERIFIED by direct visual inspection):**

- Wordmark **MYTHOS** in a heavy, extended, geometric sans — rendered in
  polished metallic silver/chrome with a vertical gradient and a subtle 3-D
  bevel, on a pure black ground with a faint central glow.
- **The distinctive tilted M.** The M is *italic/slanted* while every other
  letter (Y·T·H·O·S) stands upright. Its strokes are heavy diagonals with
  sharp angular apexes; the left leg sweeps down as a long slash and the
  glyph reads almost as two joined slashes. This asymmetry — one slanted
  letter against an upright wordmark — is the identity's most recognizable
  feature and is the element Stage 1B must preserve.
- The O is fully circular; letter terminals are flat; overall width is
  extended.
- Descriptor **PROD** below, centered, in gold, widely letter-spaced, flanked
  by two horizontal gold spear/blade flourishes tapering outward.
- Sampled gold values are a gradient, not a flat: observed range roughly
  `#AB7E2F → #F8D276`, centered near `#D9A441`–`#DDAB4F`. Neither the
  Mythos OS UI gold `#c9a84c` nor the Uthina Imperial Gold `#D9A441` is a
  verbatim match, but the Uthina value sits inside the logo's gradient range.
  (Adds evidence to conflict **C-3** of `docs/MYTHOS_DESIGN_RECOVERY.md` —
  the two golds plausibly share this logo as an ancestor, still UNKNOWN.)

## 3. Every recovered version — complete inventory

**VERIFIED: exactly seven image files exist in the working tree, and the full
438-commit, 36-branch history contains no others** — only two commits ever
added images (`d1a9d19`, `09d5fe1`), and none ever deleted or modified one.

### 3.1 Mythos identity files (2)

| # | Path | Format | Dimensions | Bytes | SHA-256 | Git blob | Added | Classification |
|---|---|---|---|---|---|---|---|---|
| 1 | `assets/logos/logomythos.png` | PNG RGBA (opaque) | 1672 × 941 | 2,092,774 | `b7bd0ac1…205c6a76` | `354e6bb` | `09d5fe1` 2026-08-13 | **MYTHOS MASTER — dark.** Silver wordmark + gold PROD on black. Highest-quality historical source |
| 2 | `assets/logos/logo.png` | PNG RGBA (opaque) | 1111 × 328 | 267,467 | `426828f9…8eddba17d` | `44152e8` | `09d5fe1` 2026-08-13 | **MYTHOS VARIANT — light.** Same lockup geometry: near-black wordmark, gold PROD with thin flanking rules, **white** (not transparent) ground. Tight crop, no headroom |

Full SHA-256 values:

```
b7bd0ac185576a02238c5fb0b3b651e0b289e4276f32f27f1cbab78d205c6a76  assets/logos/logomythos.png
426828f9ca90418bdd17fb94bc112647b0fcaf56773678d857a1af8aeddba17d  assets/logos/logo.png
```

Both renditions share the same wordmark geometry (slanted M, upright YTHOS,
circular O, gold PROD descriptor). Which was derived from which is
**UNKNOWN** — no source file, no layered master, no generator metadata
survives in Git.

### 3.2 Non-Mythos files sharing the logo directories (5)

Recorded so no future session mistakes them for Mythos identity material:

| # | Path | Format | Dimensions | Bytes | SHA-256 (first 16) | Added | Classification |
|---|---|---|---|---|---|---|---|
| 3 | `assets/logos/logo-sdt.png` | PNG RGB | 2172 × 724 | 742,830 | `bcb4c3e9d0ef0b02` | `09d5fe1` | **NOT MYTHOS** — client logo, SDT (Société de distribution tunisienne), used by the devis/invoice module |
| 4 | `assets/logos/logo-kacem.png` | PNG RGB | 2172 × 724 | 1,093,191 | `191016ee2215b0ca` | `09d5fe1` | **NOT MYTHOS** — client logo, Kacem Aluminium (`js/shared/devis.js:6`) |
| 5 | `assets/logos/logo-uthina-chess.png` | **JPEG** (despite `.png` name) | 715 × 715 | 54,605 | `6edbfe967f498a21` | `d1a9d19` 2026-07-29 | **NOT MYTHOS** — Uthina Chess project logo (gold crown/circle on black) |
| 6 | `assets/icons/icon-192.png` | PNG RGBA | 192 × 192 | 18,118 | `e8643933f304d6a9` | `d1a9d19` | **NOT MYTHOS** — Uthina Chess-branded PWA icon |
| 7 | `assets/icons/icon-512.png` | PNG RGBA | 512 × 512 | 51,043 | `02d040b0c9f243a3` | `d1a9d19` | **NOT MYTHOS** — Uthina Chess-branded PWA icon |

## 4. Provenance chain

**DOCUMENTED**, from `09d5fe1`'s commit body and its `docs/AI_HANDOVER.md`
entry, corroborated by `docs/MYTHOS_DESIGN_RECOVERY.md` §4.5/§5:

1. **Origin:** the owner's PC consolidation target `C:\Users\Othman\Desktop\site`
   (per `VPS_TRANSFER/_MYTHOS_CONSOLIDATION/_MANIFEST.md`, VPS-only).
2. **Transfer:** the `VPS_TRANSFER` package — 2,241 files / 159,035,008 bytes,
   SHA-256 verified **2,241/2,241 PASS** against
   `VPS_TRANSFER_SHA256SUMS.txt` on receipt (2026-08-13).
3. **Integration:** the application referenced five logo assets from
   `js/app.js:5-7`, `js/app-fresh.js:5-6`, `js/shared/devis.js:6`, of which
   only one resolved. Four files (`logomythos.png`, `logo.png`,
   `logo-sdt.png`, `logo-kacem.png` — 4,196,262 bytes) were copied with
   `cp -n -p`; **post-copy SHA-256 of all four matched the transfer source
   exactly**. Asset resolution went 1-of-5 → 5-of-5.
4. **Commit:** `09d5fe189c4402c6ce4c0f64b606ffdf58a3396d`, 2026-08-13,
   pushed to `origin/main`.
5. **Since then:** untouched (VERIFIED — no later commit on any branch
   touches `assets/`).

The initial import `d1a9d19` (2026-07-29) carried only files 5–7 above; the
Mythos masters were absent from Git for the repository's first 15 days.

## 5. Highest-quality historical source — determination

**`assets/logos/logomythos.png` is the highest-quality recovered source** of
the original identity:

- Largest rendition of the complete lockup (1672 × 941 vs 1111 × 328).
- Richest rendering of the identity's intent (metallic treatment, gold
  descriptor, flourishes).
- SHA-256-anchored provenance back to the pre-repository historical package.

`assets/logos/logo.png` is the only other authentic rendition and is the
sole evidence of the light-background treatment (near-black lettering
retained, gold PROD retained, flourishes simplified to thin rules).

**No vector master exists anywhere in the repository or its history**
(VERIFIED — zero `.svg`/`.pdf`/`.ai`/`.eps` ever tracked). Whether a vector
or layered source survives off-Git is **UNKNOWN**; candidate locations that
this session could not open are listed in §7.

## 6. Current runtime usage — recorded findings (no action taken)

These are facts for Stage 1B/1C to weigh; nothing was changed:

- **The recovered master is unused at runtime.** `MYTHOS_LOGO_SRC`
  (`js/app.js:5`, `js/app-fresh.js:5`) points at `logomythos.png` but is
  **never consumed** by any code (VERIFIED by grep across `js/`).
- **The Mythos OS app currently wears Uthina Chess branding at every
  identity touchpoint:** favicon (`index.html:9`), apple-touch-icon
  (`index.html:15`), sidebar logo (`index.html:49`), dev logo preview
  (`index.html:284`), and both PWA manifest icons (`manifest.json:13,19`)
  all reference `logo-uthina-chess.png` / the Uthina icons.
- **Printed documents:** `index.html` loads `js/app.js` (not `app-fresh.js`),
  whose `MYTHOS_PRINT_LOGO_SRC = 'assets/logos/logo-uthina-chess.png'` feeds
  `js/shared/devis.js:11` — Mythos-issued devis/invoices currently print
  with the **Uthina Chess logo**. (`app-fresh.js` would print `logo.png`,
  the correct light Mythos variant, but is not the loaded entry file.)
- No favicon, app icon, small-size, monochrome, reversed, or transparent
  variant of the Mythos logo exists anywhere in Git.

## 7. Variants known to exist but NOT recoverable from this environment

All **DOCUMENTED**, none re-verified here; **none may be overwritten** when
they become reachable:

| Location | What it may hold | Evidence |
|---|---|---|
| `VPS_TRANSFER/Mythos/…` (VPS) | The transfer-side originals of the four restored logos (byte-identical by restore-time SHA); older PC-snapshot copies of `icon-192/512.png` that **differ** from the tracked ones (preserved unoverwritten as conflict class C) | `09d5fe1` handover entry |
| `VPS_TRANSFER/Mythos/MythosProd-unversioned/` (VPS) | 143-file snapshot of this application under an earlier branding; 94 transferred files are byte-identical to repo files under other paths (28 in `Mythos/www`) — may contain logo copies. **Also holds sensitive files (RIB, CIN, client data) — must never reach GitHub** | `09d5fe1` handover entry; `docs/OFFHOST_PROJECT_REGISTRY.md` |
| `othoth77/mythos-prod-unversioned-snapshot` (private off-host repo, 127 files) | Same snapshot class, off-host | `docs/OFFHOST_PROJECT_REGISTRY.md` |
| `othoth77/mythos-app` (private off-host repo, 8 files) | Possible app-era assets | `docs/OFFHOST_PROJECT_REGISTRY.md` |
| Owner's PC (`C:\Users\Othman\Desktop\site`) | Possible original/layered/vector source and creation-date metadata | `_MANIFEST.md` (VPS-only), `docs/MYTHOS_DESIGN_RECOVERY.md` §16.3 |

A vector hunt through the VPS `VPS_TRANSFER/Mythos/` tree and the two
off-host snapshot repositories is the single highest-value recovery action
remaining, and it requires an environment with VPS access and/or off-host
credentials — this session had neither.

## 8. Evidence-backed observations for Stage 1B (analysis, not design)

Recorded per the program's §6 analysis checklist; no evolution was designed:

- **M geometry:** slanted/italic against an otherwise upright wordmark;
  heavy diagonal strokes; sharp apexes; long left-leg sweep. This is the
  protected element (owner directive: evolution, not revolution).
- **Wordmark geometry:** extended geometric sans, flat terminals, circular O,
  generous but not exaggerated tracking; M sits integrated with YTHOS — the
  lockup never separates M from YTHOS, and nothing in either rendition
  detaches "OS".
- **Lockup:** MYTHOS (dominant) over PROD (small, gold, wide-tracked,
  flanked). PROD functions as a replaceable descriptor line — structural
  evidence that a MYTHOS master with unit descriptors is an evolution, not a
  break.
- **Scalability liabilities (facts):** raster-only; metallic gradient and
  bevel will not survive small sizes or single-color reproduction; the dark
  master has no transparency, so it cannot be composited; the light variant's
  white ground is likewise baked in; no favicon-scale artwork exists.
- **Small-size rendering, print quality, kerning verdicts:** deferred to 1B —
  they require the vector hunt (§7) to be resolved first or they would be
  judged against a lossy raster.

## 9. Recovery limitations

1. VPS filesystem unreachable (§1) — every VPS-side claim is DOCUMENTED, not
   re-verified.
2. The 14 off-host private repositories were not opened (no credential in
   this environment).
3. The owner's PC was not contacted (standing rule).
4. Creation date, author/tool, and any rejected alternatives of the original
   logo are UNKNOWN — no metadata or design-decision record survives in Git.
5. This inventory is exhaustive **for the Git repository only**; it is
   explicitly not claimed exhaustive for the VPS or off-host locations in §7.

## 10. Status

- Original logo located, identified, and canonically recorded: **done**.
- Original sources modified: **none**.
- New design created: **none** (not authorized in this action).
- Next authorized step per the program: **1B — LOGO EVOLUTION**, ideally
  preceded by the §7 vector hunt from a VPS-capable session.
