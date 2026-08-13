# Off-Host Project Registry

Canonical record of which VPS project directories have independent off-host
protection, and which do not. Maintained outside the individual project
repositories, in `mythos-prod`, so it survives the loss of any single project.

**Last updated:** 2026-08-13 · migration Phase 1 · **COMPLETE**
**Owner account:** `othoth77` · **Security scan:** PASS across all entries, no secrets recorded here

---

## PROTECTED — 14 of 14 non-Git projects, all private, all remote-verified

Every repository is **private**. Every remote `main` was read back from the
GitHub API (`repos/othoth77/<repo>/git/ref/heads/main`) and confirmed equal to
the local `HEAD`. Every working tree is clean and matches its index exactly.
Each project carries a tailored `.gitignore` (included in the file counts).

| Project | VPS path | GitHub repository | Vis. | Commit = verified remote HEAD | Files | Bytes | Sec | Tests | Status |
|---|---|---|---|---|---|---|---|---|---|
| knowledgevault-kms | `projects/knowledgevault-kms` | `othoth77/knowledgevault-kms` | private | `25a2956198fa7e95c87d4a608cf973b54b7dd1ab` | 753 | 4,337,768 | PASS | none runnable | **VERIFIED** |
| uthina-chess | `projects/uthina-chess` | `othoth77/uthina-chess` | private | `c8c33eaeda42364be516a08d7014d2a4c3d259f3` | 221 | 102,652,256 | PASS | none runnable | **VERIFIED** |
| ssangyong | `projects/ssangyong` | `othoth77/ssangyong` | private | `e347e765e524e0452104cab29addf2967bd9a8bf` | 196 | 11,431,685 | PASS | none runnable | **VERIFIED** |
| mythos-prod-unversioned snapshot | `projects/_snapshots` | `othoth77/mythos-prod-unversioned-snapshot` | private | `e147657693c587615d85b344b5d92dbd59bd0cae` | 127 | 1,136,364 | PASS | n/a | **VERIFIED** |
| darhijama-site | `projects/darhijama-site` | `othoth77/darhijama-site` | private | `9b2e810f9f4f9cfda871c0f275173d466b51d3a5` | 22 | 493,191 | PASS | n/a | **VERIFIED** |
| karhmana | `projects/karhmana` | `othoth77/karhmana` | private | `cf0aea87c072d0695dd79cd27f4618798e614564` | 16 | 525,892 | PASS | n/a | **VERIFIED** |
| fixpert | `projects/fixpert` | `othoth77/fixpert` | private | `a2ccf8348cbcf5e626cf22d8d16b3a0a02020bc4` | 13 | 97,216 | PASS | n/a | **VERIFIED** |
| nettoyage-photo-vps | `projects/nettoyage-photo-vps` | `othoth77/nettoyage-photo-vps` | private | `5a1fcd09a40ad9858e95f81bbab1ae54bdb22829` | 11 | 93,683 | PASS | n/a | **VERIFIED** |
| mythos-app | `projects/mythos-app` | `othoth77/mythos-app` | private | `ecf563f809ff0081c7064a61da391a45f10dda8c` | 8 | 110,028 | PASS | none runnable | **VERIFIED** |
| agribee | `projects/agribee` | `othoth77/agribee` | private | `144355874c801046bdad71a3fe5160c85e20c58c` | 7 | 1,225,790 | PASS | n/a | **VERIFIED** |
| chatrange | `projects/chatrange` | `othoth77/chatrange` | private | `f949d48e476a3312881e754b2a3b1ec04fedbff8` | 4 | 6,460,074 | PASS | n/a | **VERIFIED** |
| festival | `projects/festival` | `othoth77/festival` | private | `853c4e568934282bfcbb1e8b85828c071aa19489` | 4 | 79,320 | PASS | n/a | **VERIFIED** |
| oudhna-service | `projects/oudhna-service` | `othoth77/oudhna-service` | private | `d043c9f33d872d541a1a1c8b883c65b3f25a46b6` | 3 | 66,269 | PASS | n/a | **VERIFIED** |
| classepro | `projects/classepro` | `othoth77/classepro` | private | `a76e4efaea5f857c6ea084c94fdf776a596e32b7` | 2 | 470,300 | PASS | n/a | **VERIFIED** |
| **Total** | | **14 repositories** | **all private** | | **1,387** | **129,179,836** | | | |

1,387 tracked files = **1,373 project files + 14 generated `.gitignore` files**.
129,179,836 bytes = 129,175,505 project bytes + 4,331 bytes of `.gitignore`.

### Repositories reused rather than duplicated

Three empty **public** placeholders (0 KB, created 2026-07-29, never pushed to)
already held these names. On owner authorisation they were switched to private
and reused, so no duplicate repository was created:

- `othoth77/uthinachess` → switched to private, then **renamed to `uthina-chess`**
  to match the VPS directory and the hyphenated convention used throughout.
  GitHub keeps a redirect from the old name.
- `othoth77/ssangyong` → switched to private, reused.
- `othoth77/fixpert` → switched to private, reused.

Nothing was overwritten and no push was forced; each repository received a
single initial commit onto an empty `main`.

### Verification note worth keeping

A naive `git ls-files | stat` **undercounts bytes**, because Git quotes non-ASCII
paths and several of these projects hold Arabic filenames (`فرص_حجامة_*.html`,
`مهرجانات_تونس_*.html`, `فرص_نحل_*.html`, `فرص_أوذنة_*.html`). An early pass
reported `oudhna-service` at 276 bytes — the `.gitignore` alone. All figures here
were produced with `git ls-files -z`; use `-z` for any future accounting.

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

### Visibility observation — still open

`mythos-prod` and `darhijama` remain **PUBLIC**. `darhijama` is a deployed Laravel
application, and `mythos-prod` carries detailed migration and infrastructure
documentation in `docs/AI_HANDOVER.md`. No credentials are in either — verified
repeatedly — but the operational detail (paths, container names, database names,
the existence and location of withheld sensitive files) is world-readable. This
is an inherited default, not a recorded decision. `telegram-bot` is also public.

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
| **Protected off-host** | **1,373 (100%)** | **129,175,505 (100%)** |
| Still unprotected | 0 | 0 |

**The entire non-Git project corpus now has an independent off-host copy.**
What remains unprotected is the database tier and the VPS_TRANSFER-only material,
both of which are Phase 2 scope.
