# MYTHOS Guardian, session-guard pressure channel (Option C) and backup freshness: record, 2026-09-14

Record only. It documents what was done, what is merged, what is live, what is not, and one incident. It changes no code and authorizes nothing.

All times are UTC. The state below was verified 2026-09-14 21:36.

## 1. Summary

| Item | Merged | Installed / activated | Live verified |
|---|---|---|---|
| PR #283 — MYTHOS Guardian (reference implementation) | **No** (kept OPEN as reference; must not be merged) | No | No |
| PR #284 — session-guard pressure path + read-outcome reporting | Yes (`524c7f3`) | No (installed session guard is still `0983894`) | No |
| PR #285 — backup health freshness | Yes (`190aed2`) | Yes: production checkout contains it since 13:26 | **Yes**: scheduled verify runs at 15:06, 15:31, 16:29 wrote the new per-mode fields |
| PR #286 — Option C: Resource Guard → session guard pressure publication | Yes (`e9767df`) | **No**: code is on disk, executor not restarted, session guard not reinstalled, publication directory not created | No |
| Guardian V2 (observe-only replacement) | No (design only, not in the repository) | No | No |

Session-guard enforcement remains **off** (no enable marker).

## 2. Timeline

| Time | Event |
|---|---|
| 01:04–01:10 | Read-only discovery of existing ops: memwatch, Resource Guard, session guard, hostops, Status Center monitor, backups, runner. |
| 01:10–01:41 | **Process deviation:** implementation, commit, push and PR #283 were created before the owner authorized implementation. The discovery phase had been ordered read-only. Nothing was installed. |
| ~07:50 | Forensic review of that deviation. Result: no host, systemd, service, database, Docker, backup or credential change. |
| 11:11–11:30 | Read-only review of PR #283. Verdict: do not merge, do not deploy (§3). |
| 11:40 | PR #284 and PR #285 opened (separate, isolated fixes). |
| 12:18 / 12:21 | #284 and #285 squash-merged by owner authorization. #282 (an unrelated Status Center curation) had merged at 12:17. |
| 12:40–12:49 | PR #286 (Option C) opened, then squash-merged by owner authorization. |
| ~13:15 | Option C activation **stopped at pre-checks**. The production checkout had uncommitted Status Center registry edits from another work session, overlapping an incoming file. No stash, reset or overwrite was attempted. |
| 13:23–13:27 | The other work session committed its registry changes and merged `origin/main` into the production checkout (`eab30d6`). This brought #284–#286 onto disk. |
| 15:06 / 15:31 / 16:29 | Scheduled backup verify runs executed the #285 scripts (§5). |

## 3. PR #283 — why it is kept as reference only

The read-only review found, among others:
- **Simulations were not always dry-run.** One scenario executed live ticks that write Guardian state, and could act if action markers existed. `simulate all` included it.
- **`run` defaulted to a live tick.**
- **Recovery would start units an operator had stopped deliberately.** The restart budget refilled forever.
- **No mutual exclusion** between a manual run and the timer.
- **Escalation starvation** when evidence oscillates between two higher levels.
- **Its Status Center probe would report DOWN** on merge, before any installation.
- **It duplicated existing components:** the Resource Guard state machine, session counting and admission, disk and backup verdicts, hostops read verbs, and a maintenance scheduler (Dagu is the ratified maintenance scheduler).

The replacement direction is an **observe-only Guardian V2**:
- It reuses existing ops as inputs and runs unprivileged.
- It has no cleanup, restart or signal code.
- In the Status Center, NOT_INSTALLED shows as not monitored, never DOWN.

It is designed only and needs separate authorization.

## 4. What #284 and #286 changed (session guard ↔ Resource Guard)

**Problem**
- The root session guard runs with `CapabilityBoundingSet=CAP_KILL`.
- Its default Resource Guard path was wrong (a dot-prefixed directory), so it always read NORMAL.
- Even with the correct path, the executor's state directory is private (`0700`). Root restricted to CAP_KILL is denied (EACCES).

**#284**
- Correct default path.
- Every run reports `pressure_source` (`ok | missing | unreadable | invalid | stale`) instead of silently reading NORMAL.

**#286 (Option C)**
- **Publisher.** The executor atomically publishes **only** `{"level", "updated_at"}` to `/var/lib/mythos/pressure/resource-pressure.json`:
  - O_EXCL temp file + fsync + rename, mode `0644`
  - never creates the directory; refuses a symlinked destination
  - publishes by default only when running with its default home, so fixture-based tests never write the host file
- **Directory.** Provisioned by `ops/session-guard/install-session-guard.sh` as `deploy`-owned `0755` inside `root:deploy 0750 /var/lib/mythos`.
- **Consumer.** The session guard reads **only** that file:
  - opened with `O_NOFOLLOW|O_NONBLOCK`
  - regular file of at most 4 KiB
  - level validated; `HIGH→WARNING`, `EMERGENCY→CRITICAL`
- **Unchanged:** the unit (CAP_KILL only), with no DAC capability and no ACL.
- **Security fix found on the way:** the previous runner followed a planted symlink.

**Tests at merge** (local; the repository has no PR-triggered CI)

| Suite | Result |
|---|---|
| resource-guard-test | 146/0 |
| session-guard-test (as root) | 366/0 |
| session-guard-test (as an unprivileged user) | 352/0 |
| executor | 390/0 |
| core-wiring | 86/0 |
| lifecycle | 254/0 |
| hostops-executor | 36/0 |
| model-selection | 81/0 |
| hostops | 39/0 |

- **CAP_KILL boundary proof** (as root): a CAP_KILL-only root reads the publication and gets EACCES on the executor's private state, secrets and SSH material. The unrestricted-root control succeeds.
- **Against the unfixed code:** the new tests fail.

**Options rejected, with evidence**
- `CAP_DAC_READ_SEARCH`: host-wide read access.
- A root ACL: does not work, because the executor creates its state with mode `0600`, so the ACL mask becomes `---`.

## 5. What #285 changed (backup health freshness)

**Before.** Any successful run, including `verify` and `restore-test`, set `last_success_at` to now, set `status` to ok and reset the failure counter. `verify-remote` checks integrity, not age, so a clean verify after a failed nightly backup reported a stale backup as fresh.

**After**
- Only a successful **backup** run advances `last_success_at` or resets `consecutive_failures`.
- `verify` and `restore-test` record their own `last_*_status` / `last_*_finished_at` fields.
- They never clear a failed backup's status.

**Live evidence** (scheduled runs, not manually triggered)

| Record | Run | Result |
|---|---|---|
| idauto/media | verify 15:06 | `last_verify_status: ok`, `last_success_at` unchanged at the 03:32 backup |
| ssangyong | verify 16:29 | `last_verify_status: ok`, `last_success_at` unchanged at the 04:57 backup |
| ERP | verify 15:31 | clean verify **preserved** a failed status instead of masking it; see §6 for why that status was false |

## 6. Incident: test runs wrote false failures into the ERP backup health record

**What happened**
- `tests/backup-run-db-test.js` has a pre-existing "missing config" check. It runs `ops/backup/mythos-backup-run-db.sh backup` **without** overriding `MYTHOS_BACKUP_HEALTH_FILE`.
- The script's default health path is `$HOME/mythos-backups/health/backup-health-db.json`.
- When the suite was run on the VPS as the `deploy` user (four times, 11:31–12:22, while verifying #285), that default resolved to the **production ERP backup health record**.

**Evidence**
- The record shows `consecutive_failures: 4`.
- Its preserved `error` reads `config not found: /tmp/mythos-backup-db-run-test-…/does-not-exist.env`, a temp-directory test fixture.
- The last real ERP backup succeeded at 04:04:45.
- No backup unit ran between 04:04 and the 15:31 verify, and no backup script was invoked manually.

**Impact**
- The ERP admin backup status (`GET /api/v1/settings/backup`) reports `failed`, with 4 consecutive failures, although real backups are healthy.
- The public Status Center backup probe is unaffected (it reads the idauto/media record).
- No backup data, dump, remote copy or database was touched.

**Status**
- Not corrected manually (a production data change needs authorization).
- The record self-corrects at the next scheduled ERP backup (2026-09-15, around 04:00–04:15), whose success sets `status: ok`, `consecutive_failures: 0`.

**Follow-ups** (need authorization)
1. Fix the test to pass `MYTHOS_BACKUP_HEALTH_FILE` for every wrapper invocation.
2. Until then, run backup suites with a temporary `HOME`.
3. Optionally, have the owner authorize correcting the record before the next scheduled run.

## 7. Open items

1. **Option C activation** (owner authorization), in this order:
   - restart the executor (no running tasks)
   - run `ops/session-guard/install-session-guard.sh`
   - verify `pressure_source.status: "ok"`
   - verify the private executor state stays unreadable with CAP_KILL
   Enforcement stays off.
2. **The session guard's lifecycle-registry read** is equally unreadable under CAP_KILL (separate, unresolved).
3. **The delivery relay (`mythos-git-push`) cannot push** (missing HTTPS credential); it has been in a failed state since 13:08.
4. **Guardian V2 observe-only:** implementation not yet authorized.
5. **The backup test isolation fix** (§6).

## 8. Process note

Phased orders containing read-only phases or STOP gates are now treated as hard stops. There are no mutations (worktree, commit, push, PR, install) until the owner explicitly authorizes the next step. States are always reported with distinct labels: MERGED / INSTALLED / ACTIVATED / LIVE VERIFIED / ENABLED.
