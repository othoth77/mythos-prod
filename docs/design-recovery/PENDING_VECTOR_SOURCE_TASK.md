# LOGO-1 — Mythos original logo: vector / master source investigation

**Tracked as:** **LOGO-1** in `docs/MYTHOS_DESIGN_DECISIONS.md` §3.1
**Raised by:** `docs/design-recovery/MYTHOS_ORIGINAL_LOGO_RECOVERY.md` §7
**Task recorded:** 2026-08-18 · **Search performed:** 2026-08-18 UTC
**Search environment:** ephemeral cloud container, session
`claude/mythos-master-brand-design-c3vy6b` @ `00a9192`
**Nature:** **READ-ONLY.** No file was created, modified, moved, renamed or
deleted. No logo was drawn, recreated or recoloured. No sensitive material was
opened, copied, staged or committed.

**RESULT: C — ONLY VECTOR DERIVATIVE FOUND**, over a **partial** search scope.
**LOGO-1 remains OPEN.** See §5 for why the classification cannot yet be D.

---

## 1. The question

**Does an original vector or layered master source of the Mythos logo exist
outside the current Git history?** A question of fact, not of design.

## 2. What was searched, and what could not be

| # | Priority location | Reachable? | Outcome |
|---|---|---|---|
| **1** | `/home/ubuntu/incoming/VPS_TRANSFER/Mythos/` | **NO** | Path does not exist in this environment. `/home/ubuntu/incoming` itself is absent; `/home/ubuntu` contains only default shell dotfiles |
| **2** | `MythosProd-unversioned` snapshot | **NO** | Exists only inside location 1 (unreachable) and as the off-host repo in location 3 (blocked) |
| **3** | Off-host Mythos snapshot repositories | **NO — BLOCKED BY SESSION POLICY** | The repositories are **visible and the account has access** (§3), but both routes to read them were denied by this session's permission classifier. Not retried, not worked around |
| **4** | Other persistent VPS locations named by the recovery documents | **NO** | `/var/www`, `/srv/mythos`, `/srv/mythos/worktrees`, `/home/deploy`, `/home/deploy/projects`, `/home/ubuntu/mythos-prod`, `/home/ubuntu/mythos-ai-executor`, `VPS_TRANSFER_SHA256SUMS.txt` — every one verified absent |

**Mounted volumes checked:** `/dev/vda` (root), `/dev/vdc` (`/opt/claude-code`),
`/dev/vdd` (`/opt/env-runner`). No external or attached volume holds project
data; `/mnt/attach` is empty and `/mnt/skills`, `/mnt/user-data` hold only
harness material.

### 2.1 What *was* searched, exhaustively

| Scope | Method | Coverage |
|---|---|---|
| **Entire reachable filesystem** | `find /` across all mounted volumes for `svg · ai · eps · pdf · psd · sketch · fig · cdr · xcf · indd · afdesign`, excluding only system, language-toolchain and package trees that cannot hold Mythos artwork | Complete |
| **Entire reachable filesystem, by name** | `find /` for any file or directory matching `*mythos* · *logo* · *brand* · *identity*` (case-insensitive) | Complete |
| **Complete Git history** | `git rev-list --all --objects` — every object reachable from **every ref**: 438 commits, 36 branches | Complete |

## 3. Off-host repositories — access status

Listing the account's repositories succeeded and confirms all three exist and
are accessible to the account:

| Repository | Visibility | Last push |
|---|---|---|
| `othoth77/mythos-prod-unversioned-snapshot` | private | 2026-08-13 |
| `othoth77/mythos-app` | private | 2026-08-13 |
| `othoth77/mythos-os` | private | 2026-08-17 |

**Neither route to their contents was permitted in this session.** Attaching the
snapshot repository was denied by the session's permission classifier, and so
was a direct read of the remote. Both denials were accepted; **no attempt was
made to work around them.**

This is a **policy limitation of the search environment, not a finding about the
repositories.** Nothing may be concluded about whether they contain a vector
master — they were not looked at.

## 4. Candidates found

**Fourteen vector files exist in scope. All fourteen are the Stage 1B
reconstruction, and none is an original or a master.**

| Path | Type | Size | Modified | SHA-256 (first 16) |
|---|---|---|---|---|
| `assets/brand/master/mythos-wordmark.svg` | SVG | 1,482 B | 2026-08-18 | `73cc208cdcb3a190…` |
| `assets/brand/master/mythos-wordmark-ink.svg` | SVG | 1,452 B | 2026-08-18 | `8a31b24bb094c144…` |
| `assets/brand/master/mythos-wordmark-reversed.svg` | SVG | 1,474 B | 2026-08-18 | `c82422b2a116882f…` |
| `assets/brand/master/mythos-symbol-m.svg` | SVG | 281 B | 2026-08-18 | `f0ef5d77423cfd65…` |
| `assets/brand/master/mythos-symbol-m-ink.svg` | SVG | 276 B | 2026-08-18 | `05794d410a906af2…` |
| `assets/brand/master/mythos-symbol-m-reversed.svg` | SVG | 298 B | 2026-08-18 | `d65939e2433de02a…` |
| `assets/brand/master/mythos-lockup-os.svg` | SVG | 1,802 B | 2026-08-18 | `b0e490762e100abe…` |
| `assets/brand/master/mythos-lockup-prod.svg` | SVG | 1,808 B | 2026-08-18 | `222b8a0d31d613b5…` |
| `assets/brand/master/mythos-lockup-digital.svg` | SVG | 1,817 B | 2026-08-18 | `508b38e7c6f41872…` |
| `assets/brand/master/mythos-lockup-services.svg` | SVG | 1,820 B | 2026-08-18 | `9ec7d66acb54dbde…` |
| `assets/brand/master/mythos-lockup-logistique.svg` | SVG | 1,826 B | 2026-08-18 | `0155ecdeaf35baa8…` |
| `assets/brand/master/mythos-appicon-dark.svg` | SVG | 396 B | 2026-08-18 | `8c1b81d4879ee886…` |
| `assets/brand/master/mythos-appicon-light.svg` | SVG | 412 B | 2026-08-18 | `1e9fa084162f88a6…` |
| `assets/brand/master/mythos-favicon.svg` | SVG | 365 B | 2026-08-18 | `d4c7a152c99d2d4a…` |

Full checksums of the two representative files:

```
73cc208cdcb3a1906219de00277118a3e4439c359287be1d439b93309509bead  mythos-wordmark.svg
f0ef5d77423cfd651dd6bd4bd3ac984c030ba4fbfce3e65fe325c1d755fcb6f3  mythos-symbol-m.svg
```

### 4.1 Assessment of each candidate — identical for all fourteen

| Question | Answer |
|---|---|
| Genuinely the Mythos logo? | **Yes** — they render the MYTHOS wordmark and the M symbol |
| Vector / editable? | **Yes** — SVG path data |
| Original or master? | **NO.** They are generated by `assets/brand/source/build-masters.py` from measurements taken off the raster `logomythos.png`. Introduced by commit `4a3c077` on 2026-08-18 — **six days after** the raster originals entered Git, and in this design programme, not in the brand's history |
| Derivative or export? | **Derivative.** A reconstruction, twice removed from any original artwork |
| Equivalent already in GitHub? | **Yes — they *are* the GitHub copy.** They are not a discovery |

### 4.2 Vector artwork in the whole of Git history

`git rev-list --all --objects` over all 438 commits and 36 branches returns
**exactly 14 vector blobs — the 14 above.** No `.svg`, `.ai`, `.eps`, `.pdf`,
`.psd`, `.sketch`, `.fig`, `.cdr` or `.xcf` file has ever existed on any branch
of this repository at any point in its history, other than the Stage 1B
reconstruction.

The two raster originals are unchanged and were re-verified during this search:

```
b7bd0ac185576a02238c5fb0b3b651e0b289e4276f32f27f1cbab78d205c6a76  assets/logos/logomythos.png
426828f9ca90418bdd17fb94bc112647b0fcaf56773678d857a1af8aeddba17d  assets/logos/logo.png
```

## 5. Classification

**C — ONLY VECTOR DERIVATIVE FOUND.**

Chosen over **D** for a precise reason: vector artwork of the Mythos logo *does*
exist in scope, so a flat "no vector source found" would be inaccurate. But the
distinction that matters is recorded plainly:

> **The only vector artwork found is the Stage 1B reconstruction. It was already
> known, already committed, and is explicitly not an original. Nothing new was
> discovered.**

**This is not a negative result over the intended scope.** Three of the four
priority locations were unreachable and the fourth was blocked by session
policy, so the search covered **Git history and this container only**. A true
negative — the finding that would justify adopting the reconstruction as the
master — has **not** been established.

**LOGO-1 therefore remains OPEN.**

## 6. Sensitive-material handling

`MythosProd-unversioned` is recorded as containing a company RIB, a national
identity number (CIN), embedded client records and a live data backup.

**No sensitive material was reached, opened, read, copied, staged or committed**
— the locations holding it were never accessible in this session. The
constraint was not tested, because the opportunity to violate it never arose.
It remains binding on any future session that does gain access: search those
trees **by filename and format only**.

## 7. Limitations

1. **Three of four priority locations were unreachable** — the VPS filesystem
   does not exist in this environment.
2. **The off-host repositories were blocked by session permission policy**, not
   by lack of account access. The account can reach all three.
3. **The owner's PC** (`C:\Users\Othman\Desktop\site`, the consolidation target)
   was not contacted, per standing rule.
4. This search is **exhaustive for Git history and for this container**, and
   **empty for everything else**. It does not narrow the probability that a
   vector master exists off-host; it simply did not look there.

## 8. Recommended next action

**One of two, both cheap:**

- **Preferred — grant this session read access to the three off-host
  repositories.** They are the highest-value unsearched location, the account
  already has access, and only the session's permission policy blocks it. A
  filename-and-format search of 127 + 8 files would close LOGO-1 in minutes.
- **Or — run this same task from a VPS-capable session**, which reaches priority
  locations 1, 2 and 4 directly.

**Until LOGO-1 closes, two things stay true and should not be forgotten:**

- **LOGO-2 cannot be decided.** Adopting the reconstruction as the master is
  only justifiable once the search for an original is genuinely exhausted.
- **No monochrome master can be produced**, because the recovered artefact is a
  metallic raster that **A-007** forbids recolouring. This is the concrete,
  recurring cost of the open decision.
