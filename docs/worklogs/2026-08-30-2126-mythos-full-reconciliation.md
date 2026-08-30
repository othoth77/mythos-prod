# Worklog — MYTHOS Full Reconciliation

**Date:** 2026-08-30
**Time:** 21:00 – 21:30 UTC
**Agent:** Claude Opus 5 (Claude Code, interactive session)
**Branch:** `vps/oth-mcp-20260830`
**Mandate:** reconcile the whole ecosystem after concurrent work; execute only what is genuinely missing.
**OTHMODE:** activated. Task record: `projects/command-center/data/pending-task-imports/2026-08-30-mythos-recon-mcp-reconciliation.json` (written in the prior execution; OTHMODE write access needs a token this environment does not hold).

---

## 1. Starting state

Concurrent work had landed since the previous execution: a storage recovery, a new `main` commit, and — decisively — **a deployed knowledge facade**. Nothing could be assumed from the prior plan.

## 2. Repositories and branches examined

`othoth77/mythos-prod`. Branch ancestry computed pairwise rather than assumed:

| Branch | Ahead of `main` | Contained in | Verdict |
|---|---:|---|---|
| `origin/main` `30c7774` | — | `storage-recovery` | current trunk |
| `vps/storage-recovery-20260830` `20eecd7` | 1 | — | **unmerged**, = main + 1 |
| `vps/extraction-mvp-20260830` `0c3256b` | 3 | **`oth-mcp`** | superseded — already carried |
| `vps/oth-mcp-20260830` `f7f010e` | 11 | — | working branch |
| `vps/preserve-20260830` `7e01dea` | 15 | **nothing** | 🔴 **orphaned VPS lineage** |

**Unique work:** `preserve-20260830` is contained in no other branch and holds the VPS-only lineage (14 VPS commits + 1 preservation commit). `storage-recovery` holds 1 unique commit. `extraction-mvp` is fully absorbed into `oth-mcp` and needs no separate handling.

## 3. Divergence resolved

`docs/MYTHOS_SYSTEM_INDEX.md` had diverged across three lineages. I first suspected two independently-authored indexes; that was **wrong** — `git log` per-file proved both descend from `7065265`, so a 3-way merge was well-defined.

`git merge origin/main` into this branch: **clean, no conflicts**, +238 lines. Both contributions survive — main's §50–55 recon/continuity rules and this branch's reconciliation-engine and discovery-feeder sections. Index now 1468 lines.

Direction matters: main was merged **into** the feature branch. `main` was not touched, nothing was rebased, nothing force-pushed.

## 4. Components discovered — runtime overrides documentation

**The facade is DEPLOYED.** The index (mine included, minutes earlier) said "IMPLEMENTED, NOT DEPLOYED". The host says otherwise:

| | Verified |
|---|---|
| Unit | `oth-knowledge-http.service`, `deploy`-user unit, running |
| Path | `~/oth-mcp/projects/oth-knowledge/service/othk-http.js` (detached checkout at `0c5eb9a`, clean) |
| Bind | `127.0.0.1:8150` **only** |
| nginx | referenced by **no** vhost |
| External probe | port 8150 **unreachable from the internet** |
| Auth | `/health` → 200 by design; `/stats` → 401 |
| MCP server | **NOT deployed** — no unit, no unit file, no process |

I corrected the index against the host rather than leaving my own fresh error standing.

## 5. Duplicates discovered

None new. The duplicate facade created in the previous execution had already been withdrawn; exactly one facade exists in the repository. One authorization system: only `lib/mcp-capabilities.js` defines `validateRegistryObject` — `knowledge.js` and `skills.js` carry the same fail-closed *idiom* for their own configs, which is not a second registry.

## 6. Components reused / extended / built

**Reused unchanged:** Status Center review engine (the reconciliation layer), `lib/mcp-capabilities.js`, `knowledge-service.js`, `othk-http.js`, `oth-mcp/server.js`, the extraction MVP, memory/identity/governance/execution.

**Extended:** `docs/MYTHOS_SYSTEM_INDEX.md` — merged main's rules, corrected the facade status to runtime truth.

**Built:** nothing. Every candidate already existed.

## 7. Deployments

**None performed.** No service started, restarted or reconfigured; no vhost changed; no port opened.

## 8. Tests

```
othk-0 89 · othk-1 30 · othk-2 97 · othk-3 63 · othk-4 90
othk-5-http-facade 44 · othk-6-mcp-server 36
stc-1 73 · stc-2 86 · stc-ar 50
────────────────────────────────────────  658 passed, 0 failed
```

**Pre-existing failures (2), proven:** `mythos-ai-executor-test` (`TASK_SCHEMA_INVALID: root.working_directory`) and `mos-1-console-test` (`Cannot read properties of undefined (reading 'authenticated')`). Both produce byte-identical errors with every change of mine stashed. Windows path/environment issues; authoritative validation needs an LF clone on Linux.

**New regressions: 0.**

## 9. Security findings

| Sev | Finding |
|---|---|
| **HIGH** | Coolify management UI reachable from the internet on port 8000 over **plain HTTP**, serving a login redirect. Management credentials would cross the network unencrypted. |
| **HIGH** | Root desktop reachable on port 6082. Authentication is enforced (401 over TLS), but the surface is a root desktop. |
| **MEDIUM** | Ports 6001 (200) and 6002 (404) bound to `0.0.0.0` and publicly reachable; services not identified from the `deploy` channel. |
| **MEDIUM** | ERP docroot still deliberately gated while its own config comments assert a stale "no DNS record" premise. |
| **INFO** | Knowledge facade (8150) and executor (8130) confirmed **not** reachable externally — correctly loopback-only. |
| **INFO** | Nothing in this execution opened a network surface. |

No credential value was read, printed or written at any point.

## 10. Backup findings

| Chain | State |
|---|---|
| Files/media (`mythos`) | ✅ `status: ok`, last success `2026-08-30T15:01:10Z`, 0 consecutive failures |
| Database (`mythos-erp/daily`) | 🔴 `status: fail`, exit 2, **`last_success_at: ""`** — never succeeded |
| n8n | 🔴 **no backup at all** — no n8n directory under `~/mythos-backups` |

**The named `MYTHOS_BACKUP_STAGE_ROOT` failure does not exist.** Both stage roots are present:

- `mythos-backups/staging` — exists, 18 entries
- `mythos-backups/erp-staging` — exists, **0 entries**

The empty ERP staging directory is a *symptom*, not a cause. The chain fails earlier, at capture (`mythos-backup-capture-db`, exit 1), because the target database `mythos_erp` has not been provisioned — off-host coverage is a documented hard gate that must exist *before* that database is created. Nothing is staged, so nothing is pushed, so `verify-remote` gets a 404 that the S3 adapter reports as `missing object`. **This is fail-closed behaviour working, not a defect.** It was not weakened, and no database was created to silence it.

## 11. VPS state

Storage recovery confirmed: **44 GB used of 72 GB, 61%, 29 GB free**; inodes 11%. Journal capped at 224 MB against a 500 MB ceiling; `logrotate` `maxsize` and `journald` `SystemMaxUse=500M` / `SystemKeepFree=2G` both in place.

Swap remains 2.0/2.0 GB, but `vmstat` shows **si=0 so=0** — historical cold pages, not active pressure. **No further cleanup performed**: no new waste item was proven, so none was invented.

Three failed units persist, unchanged: `mythos-backup-capture-db`, `mythos-backup-db-verify`, `mythos-git-push`.

## 12. Decisions

1. **Merged `main` into the feature branch** — standard, non-destructive, resolved a real 3-way index divergence cleanly.
2. **Corrected the index against the host** — the facade is deployed; documentation that contradicts runtime is wrong, including my own from minutes earlier.
3. **Built nothing.** Every candidate component already existed.
4. **Did not touch the backup chains.** The db chain is correctly fail-closed on an unprovisioned database.
5. **Did not perform further cleanup.** Storage is healthy and no new waste was proven.
6. **Did not rewire `oth-mcp/server.js` to `mcp-capabilities.js`** — different concerns (client-facing surface vs skill authorization); still an owner decision.
7. **Did not merge anything into `main`**, and did not resolve the VPS divergence — both are owner decisions with real consequences.

## 13. Unresolved

- `vps/preserve-20260830` (15 commits) is contained in no other branch — the VPS lineage remains unmerged.
- `vps/storage-recovery-20260830` (1 commit) unmerged.
- VPS repo 14 ahead / 4 behind with 3 uncommitted files; `mythos-git-push` still denied every ~5 minutes on the same governance DENY (`1e4a1ee`, protected paths) plus the divergence.
- `othoth77/spy` still awaits classification as `NEW_DISCOVERY`.
- `mythos_erp` unprovisioned; n8n unbacked-up.
- Coolify plain-HTTP exposure; ports 6001/6002 unidentified.
- MCP server never exercised against a real client (none available here).
- Extraction still has no advisory provider; `claude-code` was **not** used, per the execution/advisory boundary.

## 14. Final architecture

One reconciliation engine (Status Center). One capability authorization system (`mcp-capabilities.js`). One knowledge facade — **deployed, loopback-only, token-gated, no write path**. One MCP server — implemented, not deployed. One extraction pipeline — claims only, zero facts. One private archive (`oth.db`), untouched and never a GitHub artifact.

## 15. Next action

Owner decisions, in order of consequence: put Coolify behind TLS or close 8000 · decide the VPS divergence and the governance approval · merge or retire `preserve` and `storage-recovery` · classify `spy` · provision an advisory credential so extraction can be validated for real.
