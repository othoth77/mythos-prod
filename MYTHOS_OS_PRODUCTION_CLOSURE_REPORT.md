# MYTHOS OS — PRODUCTION CLOSURE REPORT

**Date:** 2026-08-21
**Order:** owner production-closure mission (Phases 1–9), following the post-audit execution phase (`MYTHOS_OS_POST_AUDIT_EXECUTION_REPORT.md`, branch head `d87b289`; PR #63 merged to `main` as `7fffa2f`).
**Author environment:** the same AI session that delivered the repository side. Per the mission's critical rules #1–#4, nothing below is claimed without evidence, and no check was fabricated.

---

## 12. Final declaration (stated first, because it governs everything below)

```
REPOSITORY:  CLOSED
HOST:        NOT CLOSED
PRODUCTION:  NOT VERIFIED
```

> **2026-08-22 amendment:** one row of this matrix has since moved on real host evidence — **OTH-KNOWLEDGE is now PRODUCTION VERIFIED (boundary scope)**: `othk-live-gate.js --require-live` returns **exit 0 / LIVE PASS (52/0)** on the VPS at `ef91aa0a…`, with the private store verified 0700/outside-Git/byte-identical across the read pass (§6.2.1). The three declarations above are **deliberately left unchanged** — the remaining closure steps (backup timers, monitor install, Status Center deployment, drift audit) were outside that mission's scope and remain un-run.

**MYTHOS OS is NOT declared Production Closed.** The mission's Phases 1–5 and 7–8 require root/deploy execution on the VPS or external HTTPS verification, and this session has **no such channel** (§3.1, re-verified).

**Progress since first issue — Step 0 is CLEARED (§3.5).** The runner-workspace blocker was repaired by the operator and proven by **VPS Final Gate run `32507658817` (SUCCESS, 17:20 UTC)**: checkout restored, **governance invariant 99/0 executed on the production host**, `deploy` confirmed outside the docker group, live governance key `root:mythos-gov 0640`, `mythos-gov` memberless, e2e host-refusal behaving as designed. That is real host evidence and it upgrades the **security-boundary** row of §9 to host-proven.

It does **not** flip HOST or PRODUCTION: the read-only gate cannot install a timer, restart the executor, or deploy a site. Scheduled backups, the live monitor, the executor restart + `--require-live`, the Status Center deployment and the on-host drift audit are all still un-run — so **HOST: NOT CLOSED · PRODUCTION: NOT VERIFIED** stand. The remaining sequence is §11 steps 1–6.

---

## 1. Executive status

- Everything repository-executable is done, tested, and pushed (post-audit execution phase: backups scheduler, STC-2 monitor, sync-audit tooling, OTH activation merge, hygiene — full evidence in `MYTHOS_OS_POST_AUDIT_EXECUTION_REPORT.md`).
- **No production mutation was performed in this mission** — none was possible, and none was faked.
- **New host evidence WAS obtained** via the sanctioned runner: the security-boundary smoke job passed on the real VPS (§6.2), and a **new on-host fault was discovered, reproduced, and root-caused** (§3.2) — the runner's git workspace was not writable by the runner identity, breaking the VPS Final Gate.
- **UPDATE 17:20 UTC — that blocker is now CLEARED (§3.5):** the operator ran the Step-0 repair; VPS Final Gate run **`32507658817` is SUCCESS** at `7fffa2f` with checkout restored, governance **99/0 on the host**, `deploy` confirmed **not** in the docker group, and the e2e host-refusal behaving as designed. **Steps 1–8 remain operator-gated** (root/deploy actions the read-only gate cannot perform).

## 2. Production commit

- **`main` (intended production revision): `7fffa2f`** (`Merge pull request #63 — OTH-KNOWLEDGE LIVE ACTIVATION`), verified == `origin/main` at report time.
- **Branch under PR #66:** `claude/mythos-3month-audit-2drfk0`, this report's commit (recorded in the PR; the delivering session verified remote HEAD after push).
- **Deployed revision on the VPS:** UNKNOWN from this session — last operator-verified state was the MOS-CONSOLE-LIVE era checkout; the runner reports the deploy checkout as "present (contents not readable from this identity by policy)". Determining it is Phase-1 step 1 for the operator (§11).

## 3. VPS changes made by this mission

**None.** Evidence of why:

### 3.1 Access-state re-verification (fresh, this session, 2026-08-21 ~12:34 UTC)
| Probe | Result |
|---|---|
| TCP/22 to 51.68.226.211 (`/dev/tcp` connect) | timeout, exit 124 |
| `ssh` binary / `~/.ssh` | absent / no keys |
| `curl https://status.mythosprod.xyz/` | `000` (egress proxy CONNECT 403) |

### 3.2 The one sanctioned host channel, exercised — and its new fault
- Dispatched the **VPS Final Gate** workflow (`workflow_dispatch`, ref `main` = `7fffa2f`) → **run 32482633989** on `mythos-vps-runner` (machine `vps-4722f0a9`).
- **Attempt 1 (12:35 UTC): FAILURE** in the gate job at `actions/checkout` — `error: insufficient permission for adding an object to repository database .git/objects` in `/opt/mythos-gh-runner/_work/mythos-prod/mythos-prod`, retried 3× internally, identical.
- **Attempt 2 (12:37 UTC, single controlled re-run): identical failure** — deterministic, not a flake.
- **Root cause:** on-host file-ownership fault in the runner's *disposable git workspace* — objects present in `.git/objects` that the `mythos-runner` identity cannot write alongside. **Not caused by `7fffa2f`**: the checkout never completed, so no repository code ran; run **#3 succeeded at 11:17 UTC** on the same workflow — the fault window is on-host, 11:18–12:35 UTC. The runner cannot self-heal (NoNewPrivileges, no sudo — by design), and `.github/workflows/**` is a governance-protected path this session must not amend on `main`.
- **Operator remediation (root):** now packaged precisely as `ops/runner/inspect-and-repair-workspace.sh` — read-only `inspect` first (ownership/ACLs/immutable attrs/df+inodes/foreign-owned entry list along the exact failing path), then `repair` (chowns **only** the listed foreign-owned entries — refuses to run when none exist; never a blind recursive chown) or `reset` (removes only the disposable `_work/mythos-prod`). Static contract pinned by `tests/runner-workspace-repair-test.js` **13/0**. Then re-dispatch the gate.

### 3.3 Repair-mission update (2026-08-21, ~13:13 UTC)
- The owner ordered Step-0 repair "using the existing sanctioned operator/root path". That path is the owner-workstation SSH (`mythosadmin`/`deploy`) — re-verified absent from this session (§3.1). **Root repair cannot be executed from here**; executing it any other way (e.g. amending the governance-protected workflow on `main`) is forbidden by the mission's own constraints and the repository's rules, and was not attempted.
- **Fresh dispatch to test current host state: run `32485711727` (13:13 UTC) — FAILURE, identical** (`insufficient permission … .git/objects`, EACCES ×3; smoke/security job again PASS). The fault persists un-repaired; three runs / five fetch-attempts now reproduce it byte-identically.
- Delivered instead: the exact Step-0 tool + procedure above (`ops/runner/README.md`), so the sanctioned root path can perform the inspection and the *minimal* correction the mission specifies. Steps 1–8 remain gated behind it; classifications in §12 unchanged.

### 3.4 Bootstrap deadlock and its resolution (2026-08-21, operator report)

**Observed:** the operator (root via the OVH VNC/KVM terminal) ran the Step-0 command from `/opt/mythos-gh-runner/_work/mythos-prod` and got `No such file or directory`. **Root cause of the deadlock:** the repair script exists only in commit `b3531dd` on the PR #66 branch — it is on **no** VPS checkout: not in the broken runner workspace (frozen pre-`7fffa2f`), not in the deploy checkout (behind `main`), and not even on `main` itself. Two additional precision notes: (a) the failing git repository is the **nested** path `/opt/mythos-gh-runner/_work/mythos-prod/mythos-prod` (workspace dir, then repo dir — per the Actions logs' "Working directory"); (b) the script was never expected in the workspace — but no reachable checkout had it either, which was this report's own gap.

**Sanctioned bootstrap (no governance bypass, no substitute implementation):** git's content-addressed delivery from the existing deploy clone — a fetch cannot be blocked by the broken workspace and `git show <commit>:<path>` needs no working tree at all. The extracted bytes are verifiable against the commit two independent ways:

- git blob id of `b3531dd:ops/runner/inspect-and-repair-workspace.sh` = **`48bf244899b98fac8dc7fcd0fd5030ab07e53558`**
- sha256 of the file bytes = **`70e3577b5f69535bcdefcf292723f855af5ce973d6122d458fe41bd1a6297946`** (4,821 bytes)

**Exact operator sequence (root, OVH VNC):**

```bash
# STEP 0A — state, read-only (note the NESTED repo path):
ls -ld /opt/mythos-gh-runner /opt/mythos-gh-runner/_work \
      /opt/mythos-gh-runner/_work/mythos-prod \
      /opt/mythos-gh-runner/_work/mythos-prod/mythos-prod/.git \
      /opt/mythos-gh-runner/_work/mythos-prod/mythos-prod/.git/objects
git -C /home/deploy/projects/mythos-prod -c safe.directory=/home/deploy/projects/mythos-prod \
    rev-parse HEAD && git -C /home/deploy/projects/mythos-prod -c safe.directory=/home/deploy/projects/mythos-prod status --short | head

# STEP 0B — obtain the exact committed tool via the existing delivery path:
su - deploy -c "git -C /home/deploy/projects/mythos-prod fetch origin claude/mythos-3month-audit-2drfk0"
git -C /home/deploy/projects/mythos-prod -c safe.directory=/home/deploy/projects/mythos-prod \
    show b3531dd:ops/runner/inspect-and-repair-workspace.sh > /root/inspect-and-repair-workspace.sh
chmod 700 /root/inspect-and-repair-workspace.sh
sha256sum /root/inspect-and-repair-workspace.sh
#   REQUIRED: 70e3577b5f69535bcdefcf292723f855af5ce973d6122d458fe41bd1a6297946 — STOP if different
git -C /home/deploy/projects/mythos-prod rev-parse b3531dd:ops/runner/inspect-and-repair-workspace.sh
#   REQUIRED: 48bf244899b98fac8dc7fcd0fd5030ab07e53558

# STEP 0C — read-only inspection (changes nothing):
bash /root/inspect-and-repair-workspace.sh

# STEP 0D — ONLY if 0C listed foreign-owned entries explaining the EACCES:
bash /root/inspect-and-repair-workspace.sh repair
bash /root/inspect-and-repair-workspace.sh          # re-inspect: foreign list must be empty

# STEP 0E — prove checkout: re-dispatch "VPS Final Gate" (Actions → Run workflow → main),
# or report "repaired" to the driving session — it dispatches and analyzes the run itself.
# Required: checkout SUCCESS · smoke/security PASS · gate SUCCESS. If checkout still fails: STOP.
```

The deploy fetch is the repository's normal delivery mechanism under deploy's existing credential; nothing is modified until `repair`, and `repair` remains bound to the diagnosed entries only. If the deploy-side fetch itself fails, STOP and report that exact error — do not improvise an alternate download path.

### 3.5 STEP 0 CLEARED — runner channel repaired and proven (2026-08-21, 17:20 UTC)

**The operator executed the Step-0 repair on the VPS and the blocker is gone.**
Proof: **VPS Final Gate run `32507658817` (run #6), dispatched 17:20:35 UTC at
`7fffa2f` — conclusion SUCCESS, both jobs green.** This is first-hand host
evidence, not a claim.

| Step-0E requirement | Result (run 32507658817) |
|---|---|
| **CHECKOUT** | **SUCCESS** — `git fetch … +7fffa2f…` → `+ 6669021...7fffa2f -> origin/main (forced update)`; checked out; `git log -1 --format=%H` = `7fffa2facd93bf2e02aee805e1c93ba93254c49a`. The EACCES on `.git/objects` is gone (it had reproduced identically across runs #4 ×2 and #5) |
| **SECURITY / SMOKE** | **PASS** — job `96851356223`, all steps green |
| **FINAL GATE** | **SUCCESS** — job `96851394780`, all 8 steps green |

**Host facts newly established by this run (read-only, first-hand):**

| Fact | Evidence line |
|---|---|
| Host / runner identity | `hostname: vps-4722f0a9`; `runner user: mythos-runner (mythos-runner)` — single group, no docker/sudo/mythos-gov |
| Node on host | `v22.22.1` |
| **deploy is NOT in the docker group** | baseline `deploy groups: deploy users` **and** dedicated check → `PASS: deploy is NOT in the docker group` (BLOCKER-DEPLOY-DOCKER-GROUP confirmed remediated live) |
| Group state | `docker:x:986:` and `mythos-gov:x:979:` — both with **no members** |
| Deploy checkout | `/home/deploy/projects/mythos-prod` **present** (contents not readable from the runner identity, by policy) |
| **Governance invariant suite ON THE HOST** | **99 passed, 0 failed** — incl. §11B `the LIVE key is root:mythos-gov 0640`, `mythos-gov has NO ordinary members`, `deploy is NOT a member of mythos-gov`; §11 the runner identity cannot read `/etc/mythos/governance.key`, cannot list the live approval store, cannot write into it |
| E2E lifecycle suite | `REFUSED: the registered mythos-prod checkout exists at /home/deploy/projects/mythos-prod` → **PASS(expected)** — the fail-closed design held, not overridden |

**No runner privilege escalation and no governance regression:** the runner
remains non-root, single-group, sudo-less; every governance isolation
assertion passed on the host itself.

**New finding (report-only step, does NOT affect the gate result):** the
workflow's "Knowledge configuration state" step reads
`./projects/oth-knowledge/config/knowledge.json`, but the activated executor
config lives at `projects/mythos-ai-executor/config/knowledge.json`. The step
therefore printed `knowledge config not present/parseable at this revision —
reported as-is` and told us nothing about activation. It is a `|| echo`
report-only step, so the gate is unaffected. **This is not evidence for or
against OTH Knowledge being live** — that still requires §11 step 2.
`.github/workflows/**` is a governance-protected path, so this session did not
amend it; correcting the path is a separate, reviewed change for the operator.

**What this does and does not close:** Step 0 (0A–0E) is **COMPLETE**. Steps
1–8 of the closure mission (checkout sync, executor restart + `--require-live`,
backup install, monitor install, Status Center deploy, drift audit, host
regression) remain **operator-gated**: they need root/deploy execution, and the
Final Gate is read-only by design — it can prove the channel and the security
boundary, it cannot install a timer, restart a service, or deploy a site.

## 4. Backup status

- **Repository-closed:** `ops/backup/` scheduler package (wraps the existing off-host tooling; daily backup, daily verify, monthly isolated restore test, health record) — suite **48/0** including a full offline backup→verify→restore-test cycle and corruption-detection proof.
- **Host-closed: NO.** `ops/backup/install.sh` requires root; not executed. No timer exists on the host yet; no scheduled backup has run; the health record does not exist yet. **Backups are NOT yet protected by automation** (critical rule 3 honored: not claimed).
- Last real off-host backup evidence remains the operator-verified 2026-08-14 generation (3/3 PASS) — now a week old.

## 5. Status Center status

- **Repository-closed:** STC-2 monitor + "Live services" UI (stc-2 **54/0**, stc-1 **73/0**).
- **Host-closed: NO.** `monitor/install.sh` not executed (root); no monitor timer runs; no `live-status.json` exists on the host.
- **Deployment: NOT PERFORMED.** The live site still serves the pre-STC-2 content (last operator deploy, review -003 era). External verification (Phases 5/8) impossible from this session (egress 403) and meaningless until the operator deploys — the per-service comparison table Phase 8 requires **cannot be honestly produced yet** and is therefore not produced.
- **LIVE monitoring is NOT claimed** (critical rule 2 honored). SYA API and database probes remain shipped `enabled:false` → NOT_MONITORED until the operator confirms real endpoints (critical rule + Phase 4 instruction honored in the shipped registry).

## 6. OTH Knowledge status

### 6.1 Repository
- Activation merged (`7fffa2f`); merged-tree validation recorded pre-merge (othk-0 **89/0** · othk-1 **30/0** · othk-2 **97/0** · othk-2w **42/0** · othk-3 **63/0** · executor **264/0** · governance **99/0** · MOS-v2 gate **SUCCESS**).
- Live-gate rehearsal (PR #64's `othk-live-gate.js` on the activated tree, this environment): **48/49** — sole failure `store_root does not exist: /home/deploy/othk-store`, the designed fail-closed off-host verdict.

### 6.2 Host
- **The production executor has NOT been restarted** (deploy-only action): the running service still predates `7fffa2f`, so the layer is effectively not yet live in production. `--require-live` has NOT been run on the host. **"OTH Knowledge active in production" is NOT claimed.**

#### 6.2.1 AMENDMENT — 2026-08-22: `--require-live` HAS now been run on the host, and it PASSES

The statement above is superseded for OTH-KNOWLEDGE. Executed directly on
the production VPS as `deploy` on `vps-4722f0a9`, repository at
`HEAD == origin/main == ef91aa0a7083b9869b293a53030ce40ade4ad5a2`:

```
$ node tests/othk-live-gate.js --require-live
  totals: 52 passed, 0 failed
  VERDICT: LIVE PASS
EXIT=0
```

Run twice (16:32 and 16:34 UTC), identical. Supporting first-hand evidence:

- **Store:** `/home/deploy/othk-store` `drwx------ deploy:deploy` (0700),
  `records.jsonl`/`meta.json` 0600, **outside the repository**, **not
  tracked by Git**, 38 written versions / **37 live records**, 0
  quarantined. sha256 `851a5226…d7ea` **byte-identical immediately before
  and after** the gate run — the read path cannot mutate production data.
- **Executor:** `mythos-ai-executor.service` is a **`systemctl --user`**
  unit, **active + enabled**, PID 1590, serving from this checkout on
  `127.0.0.1:8130`. §6.2's "has NOT been restarted / still predates" reading
  came from querying **system** scope, where the unit correctly reports
  `not-found`. It is a scope mismatch, not a dead service. HEAD was already
  the target commit, so no restart was required and none was performed.
- **On-host regression:** othk-0 **89/0** · othk-1 **30/0** · othk-2
  **97/0** · othk-2w **42/0** · othk-3 **63/0** · governance invariant
  **99/0** · vps-final-gate-knowledge **22/0** = **442 passed, 0 failed**.

**Scope limit — what this amendment does and does not claim.**
`projects/mythos-ai-executor/lib/knowledge.js` is required only by the
gate and the othk tests; `server.js`, `executor.js` and `core/*` contain no
call to `openKnowledge`. Production-verified here is the knowledge
**boundary** — fail-closed config validation, the frozen 11-op `READ_OPS`
allowlist, executor-side `asOf` guards, claim/quarantine annotation and
private-store separation — exercised against the **real** store.
**"OTH Knowledge is consumed by the running daemon's decision loop" is
still NOT claimed.**

Nothing was weakened to obtain this: no `sudo`, no unit-file change, no
permission relaxation, no application-code change, no store content
created or committed. Track B real data (`BLOCKER-OTHK-REAL-DATA`) remains
**OWNER_ACTION** — the store's classified records are `owner-report` only.

**Effect on §12:** the OTH-KNOWLEDGE row of the closure matrix moves to
**PRODUCTION VERIFIED (boundary scope)**. The document's overall
declaration is **unchanged** — backup timers, the Status Center
monitor/deployment and the on-host drift audit were outside this mission's
scope and were not run, so `HOST: NOT CLOSED` / `PRODUCTION: NOT VERIFIED`
still stand for MYTHOS OS as a whole.
- **What the host DID prove today** (runner smoke job, both attempts, PASS): runner is non-root with no docker/sudo/mythos-gov membership and no passwordless sudo; `governance.key` unreadable, approval store unlistable, `docker.sock` unreachable. The deny-path/security boundary shows **no regression** at the identity this session can exercise.

## 7. Production sync status

- **Not executed on the host** (Phase 6 requires the VPS). The tool (`scripts/production-sync-audit.sh`, suite 20/0, read-only contract pinned) is ready; its sandbox demonstration correctly detected this environment's drift, proving the detector detects.
- **Known, expected drift on the host right now** (to be confirmed by the operator run, not suppressed): deploy checkout behind `main`; stale executor/console processes (pre-`7fffa2f`); status webroot content older than repo; backup config/timers absent; monitor timer absent; plus the recorded deltas (MIG-1/2/3 rsync, hub apex, M-12, PR #58, SYA nginx drift).

## 8. Full test results (this session, tree = `d87b289` ∪ merged main `7fffa2f`)

| Gate | Result |
|---|---|
| othk-0 / 1 / 2 / 2w / 3 | **89/0 · 30/0 · 97/0 · 42/0 · 63/0** |
| mythos-governance-invariant (security) | **99/0** |
| stc-1 / stc-2 | **73/0 · 54/0** |
| backup-scheduler | **48/0** |
| production-sync-audit | **20/0** |
| mythos-ai-executor | **264/0** |
| MOS-v2 regression gate | **SUCCESS — 20/20 areas, 0 new failures** |
| VPS Final Gate (host) — runs #4/#5 | smoke job **PASS** (×3); gate job **FAILURE at checkout** — on-host workspace fault (§3.2), no suite ran on-host |
| **VPS Final Gate (host) — run `32507658817` (#6, after operator repair)** | **SUCCESS** — checkout restored; **governance invariant 99/0 executed on the VPS**; `deploy` NOT in docker group; e2e host-refusal PASS(expected) (§3.5) |

## 9. Evidence for every P0 closure

| P0 item | Repository-closed | Host-closed | Production-verified |
|---|---|---|---|
| Recurring off-host backups | ✔ `ops/backup/` + 48/0 (commit `d87b289`) | ✘ installer not run | ✘ no scheduled run has occurred |
| Real service monitoring | ✔ STC-2 + 54/0 (commit `d87b289`) | ✘ installer not run | ✘ no live snapshot exists |
| Runner channel to the host (Step 0) | ✔ repair tooling + 13/0 (`b3531dd`) | **✔ repaired by operator; gate SUCCESS run 32507658817** | **✔ checkout + suites proven on-host** |
| OTH Knowledge activation | ✔ merged `7fffa2f` + full gate battery | ✘ executor not restarted | ✘ `--require-live` not run on host |
| Status Center current content | ✔ repo content final | ✘ webroot stale | ✘ external check blocked + pointless pre-deploy |
| Security boundary (no regression) | ✔ governance 99/0 | **✔ governance 99/0 executed ON THE HOST (run 32507658817); runner smoke PASS ×3; deploy ∉ docker; live key root:mythos-gov 0640; mythos-gov memberless** | **✔ for the boundary itself** — deny-path, key isolation and approval-store isolation all proven on the production host |

## 10. Remaining limitations

1. ~~**P0-blocking:** the self-hosted runner workspace permission fault (§3.2).~~ **RESOLVED 17:20 UTC** by the operator's Step-0 repair — gate run `32507658817` SUCCESS (§3.5). The CI channel to the host is live again.
2. Everything in §4–§7 marked host-open (installers, restart, deploy, on-host audits) — **this is now the whole of the remaining work**.
2b. **Gate reporting defect (new, non-blocking):** the Final Gate's knowledge-config step reads `projects/oth-knowledge/config/knowledge.json` while the activated config is `projects/mythos-ai-executor/config/knowledge.json`, so that line reports nothing usable (§3.5). It is report-only (`|| echo`) and cannot fail the gate. Fixing it means editing a governance-protected workflow path — a separate reviewed change, deliberately not made here.
3. PR #64 open (docs-only conflict); PR #58 open (owner decision); PR #66 left **unmerged deliberately** (critical rule 9 — nothing in governance requires merging it to deploy, since deployment consumes `main` and the operator packages live on the PR branch until the owner merges).
4. Two probes shipped disabled pending endpoint confirmation; alerts recorded but not yet pushed to a phone/ntfy channel; the six `_memCache` known baselines and recorded undeployed deltas carry over unchanged.

## 11. Exact final system state + the operator sequence that closes it

**State now (17:20 UTC):** `main` = `7fffa2f` (intended production revision); PR #66 carries the operator packages and documentation; **the runner gate channel is REPAIRED and proven green on the host** (§3.5); the production services still run pre-`7fffa2f` code (executor not yet restarted); no automation timers installed; Status Center still serving the older content. Step 0 is done — the sequence below now starts at step 1.

**Operator sequence (in order; each step's verification named):**
```bash
# 0. DONE 2026-08-21 17:20 UTC — runner channel repaired by the operator;
#    VPS Final Gate run 32507658817 SUCCESS (checkout restored, governance 99/0 on-host).
# 1. Phase 1 — sync the deploy checkout (STOP first if worktree is dirty; document it):
sudo mythos-deploy preflight os && sudo mythos-deploy deploy os   # or git -C /home/deploy/projects/mythos-prod pull --ff-only
# 2. Phase 2 — executor live gate (as deploy):
systemctl --user restart mythos-ai-executor
node tests/othk-live-gate.js --require-live      # expect exit 0 "LIVE PASS"
# 3. Phase 3 — backups (root):
sudo bash ops/backup/install.sh && sudo systemctl start mythos-backup.service
journalctl -u mythos-backup.service -n 40        # then check backup-health.json status=ok
# 4. Phase 4 — monitor (root):
sudo bash projects/status-center/monitor/install.sh   # verifies first live-status.json itself
# 5. Phase 5 — status center content deploy (root):
sudo bash scripts/deploy-status-center.sh        # then browser-check the Live services section
# 6. Phase 6 — drift audit (as deploy):
bash scripts/production-sync-audit.sh            # expect NO DRIFT beyond §7's recorded deltas
```
When steps 0–6 pass with the named verifications, the three declarations in §12 flip to CLOSED / CLOSED / VERIFIED — and only then.

---

*Prepared under critical rules 1–10: no VPS completion claimed without VPS evidence; no LIVE monitoring claimed; backups not declared protected; no checks fabricated; nothing deleted or replaced; no parallel mechanisms; stopped at the failing phase with the exact error, diagnosis, and scoped remediation; PR #66 not merged; production not declared closed.*
