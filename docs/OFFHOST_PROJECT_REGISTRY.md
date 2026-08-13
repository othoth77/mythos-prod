# Off-Host Project Registry

Canonical record of which VPS project directories have independent off-host
protection, and which do not. Maintained outside the individual project
repositories, in `mythos-prod`, so it survives the loss of any single project.

**Last updated:** 2026-08-13 · migration Phase 1
**Owner account:** `othoth77` · **Security scan:** PASS across all entries, no secrets recorded here

---

## PROTECTED — 11 private repositories created and remote-verified

All created `--private`. All remote `main` verified equal to local `HEAD`.
Each carries a project-specific `.gitignore` (counted in the file totals below).

| Project | VPS path | GitHub repository | Vis. | Commit | Files | Bytes | Sec | Tests | Status |
|---|---|---|---|---|---|---|---|---|---|
| knowledgevault-kms | `projects/knowledgevault-kms` | `othoth77/knowledgevault-kms` | private | `25a29561` | 753 | 4,337,768 | PASS | none runnable | **VERIFIED** |
| mythos-prod-unversioned snapshot | `projects/_snapshots` | `othoth77/mythos-prod-unversioned-snapshot` | private | `e1476576` | 127 | 1,136,364 | PASS | n/a | **VERIFIED** |
| darhijama-site | `projects/darhijama-site` | `othoth77/darhijama-site` | private | `9b2e810f` | 22 | 493,191 | PASS | n/a | **VERIFIED** |
| karhmana | `projects/karhmana` | `othoth77/karhmana` | private | `cf0aea87` | 16 | 525,892 | PASS | n/a | **VERIFIED** |
| nettoyage-photo-vps | `projects/nettoyage-photo-vps` | `othoth77/nettoyage-photo-vps` | private | `5a1fcd09` | 11 | 93,683 | PASS | n/a | **VERIFIED** |
| mythos-app | `projects/mythos-app` | `othoth77/mythos-app` | private | `ecf563f8` | 8 | 110,028 | PASS | none runnable | **VERIFIED** |
| agribee | `projects/agribee` | `othoth77/agribee` | private | `14435587` | 7 | 1,225,790 | PASS | n/a | **VERIFIED** |
| chatrange | `projects/chatrange` | `othoth77/chatrange` | private | `f949d48e` | 4 | 6,460,074 | PASS | n/a | **VERIFIED** |
| festival | `projects/festival` | `othoth77/festival` | private | `853c4e56` | 4 | 79,320 | PASS | n/a | **VERIFIED** |
| oudhna-service | `projects/oudhna-service` | `othoth77/oudhna-service` | private | `d043c9f3` | 3 | 66,269 | PASS | n/a | **VERIFIED** |
| classepro | `projects/classepro` | `othoth77/classepro` | private | `a76e4efa` | 2 | 470,300 | PASS | n/a | **VERIFIED** |
| **Total** | | **11 repositories** | | | **957** | **14,998,679** | | | |

957 tracked files = 946 project files + 11 generated `.gitignore` files.

**Verification method.** For every project the working tree was compared against
the Git index: file counts and byte totals match exactly and `git status` is
clean in all 11. Note that a naive `git ls-files | stat` undercounts, because
Git quotes non-ASCII paths — several projects hold Arabic filenames
(`فرص_حجامة_*.html`, `مهرجانات_تونس_*.html`, `فرص_نحل_*.html`,
`فرص_أوذنة_*.html`). The figures above were produced with `git ls-files -z`.

---

## BLOCKED — 3 projects, empty PUBLIC repositories already occupy the name

Not pushed. Pushing would publish the content, which this stage forbids; creating
a differently named private repository would duplicate the project. Both options
are excluded, so these await an owner decision.

| Project | VPS path | Files | Bytes | Existing repo | Vis. | Empty? | Status |
|---|---|---|---|---|---|---|---|
| uthina-chess | `projects/uthina-chess` | 220 | 102,651,946 | `othoth77/uthinachess` | **PUBLIC** | yes, 0 KB | **BLOCKED** |
| ssangyong | `projects/ssangyong` | 195 | 11,431,295 | `othoth77/ssangyong` | **PUBLIC** | yes, 0 KB | **BLOCKED** |
| fixpert | `projects/fixpert` | 12 | 96,906 | `othoth77/fixpert` | **PUBLIC** | yes, 0 KB | **BLOCKED** |
| **Total** | | **427** | **114,180,147** | | | | |

All three are unused placeholders created 2026-07-29 with zero content. They are
*not* canonical remotes — nothing has ever been pushed to them.

**Recommended resolution:** switch each to private, then push. This exposes
nothing (they are empty), moves in the safer direction, and preserves the
existing names. It was not done here because changing the visibility of an
existing repository is an account-settings change that needs explicit
authorisation.

Note `uthina-chess` (VPS directory) vs `uthinachess` (repository) — same project,
different spelling. Pick one before pushing.

---

## PRE-EXISTING Git-backed projects — unchanged by this stage

| Project | VPS path | Repository | Vis. | HEAD | Note |
|---|---|---|---|---|---|
| mythos-prod | `projects/mythos-prod` | `othoth77/mythos-prod` | **PUBLIC** | see AI_HANDOVER | Platform repository |
| darhijama | `projects/darhijama` | `othoth77/darhijama` | **PUBLIC** | `0aea9267` | Canonical NotreJour application, branch `release/darhijama-1.0.3` |
| notrejour | `projects/mythos/notrejour` | `othoth77/notrejour` | private | `e8fbf52c` local | Remote `52e7b2fd`, **15 commits ahead**; local checkout stale |

### NotreJour relationship — documented only, nothing changed

`othoth77/darhijama` is the canonical NotreJour application: the migrated PC copy
matched it **550/550 files with zero differences**, and both repositories contain
the same Laravel package `notrejour/notre-jour`. `othoth77/notrejour` is a
**separate and actively maintained** repository whose remote is 15 commits ahead
of the local checkout. A third private repository, `othoth77/notre-jour`, also
exists.

Neither repository was archived, deleted, merged, overwritten or pushed to. No
new NotreJour repository was created. Whether these are intentionally parallel
(white-label per client) or an unintended fork is an open owner question.

### Visibility observation

`mythos-prod` and `darhijama` are **PUBLIC**. `darhijama` is a deployed Laravel
application, and `mythos-prod` now carries detailed migration and infrastructure
documentation in `docs/AI_HANDOVER.md`. No credentials are in either — that has
been verified repeatedly — but the operational detail (paths, container names,
database names, the existence and location of withheld sensitive files) is
world-readable. Worth a deliberate decision rather than an inherited default.

---

## NOT PROTECTED — deliberately excluded

| Item | Location | Reason |
|---|---|---|
| 18 sensitive files | `VPS_TRANSFER/Mythos/MythosProd-unversioned/` | Company RIB, a national ID (CIN), embedded client records, and a 2.8 MB live data backup. **Must never reach GitHub, private or otherwise.** Awaiting the sensitive-data policy decision |
| 7 NotreJour design files | `VPS_TRANSFER/Notrejour/` | Unique, unresolved destination |
| 16 unmapped files | `VPS_TRANSFER/` | No established project owner |
| `idauto` PostgreSQL (11 MB) | `idauto-postgres` container | Real personal data — needs an encrypted database backup, not Git |
| `coolify-db` PostgreSQL | `coolify-db` container | Deployment metadata — needs an encrypted database backup |
| VPS_TRANSFER (2,241 files) | `/home/ubuntu/incoming/` | Migration safety copy, retained until the decommission gate |

---

## Coverage

| | Files | Bytes |
|---|---|---|
| Non-Git corpus at stage start | 1,373 | 129,175,505 |
| **Now protected off-host** | **946** *(69%)* | **14,995,358** *(12%)* |
| Still unprotected (3 blocked projects) | 427 | 114,180,147 |

The byte share is low because `uthina-chess` alone holds 102 MB of image assets.
By project count the majority is protected; by volume most still depends on a
single decision.
