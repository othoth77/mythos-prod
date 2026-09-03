# MYTHOS — Dagu as the Host Operations Layer: PoC and Integration Assessment

Stage **DAGU-HOSTOPS-0** (2026-09-03). Mission: determine whether Dagu can become the
*controlled* host-operations layer underneath the existing MYTHOS chain
(GitHub → Bridge → OTHMODE → Executor), so that "Deploy Evolution API" becomes a governed
TASK that validates, executes, verifies and reports — without turning Claude into a root
operator. Nothing in this stage replaces OTHMODE, the Executor, the Bridge, GitHub as
source of truth, the MCP ecosystem, Resource Guard or Model Selection.

Companion artefacts on this branch: `ops/dagu-poc/` (the exact PoC files that ran),
`ops/dagu-poc/hostops-allowlist.json` (declared operation policy) and
`tests/dagu-hostops-allowlist-test.js` (its invariants). The PoC itself lives outside the
repository at `/home/deploy/dagu-poc` and is fully removable (§12).

---

## 1. Host inspection (before any change)

| Item | Finding |
|---|---|
| OS / kernel | Ubuntu 26.04 LTS, kernel 7.0.0-30-generic, x86-64, 4 vCPU (Haswell) |
| RAM | 7 746 MiB total; **2 244–2 352 MiB available** at start; buff/cache ~2.6 GiB |
| Swap | 4 095 MiB (`/swapfile` + `/swapfile2`), **99.8 % used** — the documented healthy-at-high-swap state (see `docs/MYTHOS_RESOURCE_GUARD.md` §1) |
| PSI memory | `some avg60` 0.00–0.09, `full` 0.00 throughout |
| OOM kills | `oom_kill 1323`, **no change** during the whole stage |
| cgroup | v2 (`cgroup2fs`), systemd 259 |
| Docker | Engine 29.6.1, Compose v5.3.1, 26 running containers, 10 networks; socket `root:docker` 0660 |
| Public ports | 22, 80, 443, 6001-6002, 8000, 6082, 631 (cups). Everything MYTHOS is loopback-only |
| Resource Guard | `NORMAL`, `admit: true` (2 257 MiB, PSI 0.09) before, during and after |
| Existing Dagu | none (no binary, no unit, no container, no config) |
| Users | `root`, `ubuntu` (1000), `deploy` (1001), `mythosadmin` (1002) |
| sudo | `deploy`: `nginx -t`, `systemctl reload nginx`, `certbot` only. `ubuntu`: `mythos-logs` only. `mythosadmin`: `mythos-deploy`, nginx reload/status, certbot, `mythos-logs`. No blanket rule anywhere |
| `deploy` and Docker | `deploy` is in group `docker` — but **only interactive logins get it**. Every process under the deploy user manager (`user@1001.service`), including the live `mythos-ai-executor`, runs with groups `100 1001` and **cannot reach the Docker socket** (verified from `/proc/<pid>/status`) |
| Root from this execution path | The agent session runs as root, but the auto-mode permission layer refused writes to `/etc/systemd/system` and root-level installs. Root-level changes stay owner actions, exactly as in previous stages |
| Concurrent load | 13 Claude Code sessions resident (`session-*.scope` ≈ 1.9 GiB) — the known dominant consumer (`docs/MYTHOS_RESOURCE_GUARD.md` §6) |

No secret was read or printed; the only credential created is the PoC's own basic-auth
password, generated with `openssl rand -hex 24` into a 0600 file owned by `deploy`.

---

## 2. Dagu — what was investigated

| Item | Fact (verified against the binary, not only the docs) |
|---|---|
| Version | **v2.16.2**, released 2026-09-02, tag `v2.16.2` |
| Source | `github.com/dagucloud/dagu` (the former `dagu-org/dagu` redirects there); docs `docs.dagu.sh`; MIT licence file shipped in the archive |
| Artefact | `dagu_2.16.2_linux_amd64.tar.gz`, sha256 `4e9e5132…d2156`, verified with the upstream `checksums.txt`; single static Go binary (163 MB on disk), no database |
| Install options | tarball binary (used), install script, Docker image, Homebrew. `dagu start-all` = server + scheduler (+ coordinator, disabled here) in one process; `DAGU_HEADLESS=true` drops the UI |
| Binding / auth | default `127.0.0.1:8080`; `auth.mode` `none` / `basic` / `builtin` (JWT + roles). **In the community build**: `basic` works; `builtin` roles, API keys, SSO and **audit logs are Pro-licence features** (`GET /api/v1/audit` → "Audit logs require a Dagu Pro license"; `GET /api/v1/api-keys` → "not available"). `license check` → *Community mode* |
| Authorization | `permissions.write_dags` / `permissions.run_dags` (global, not per-user in community). With `write_dags: false` the UI, API and MCP cannot create or edit DAGs — DAGs come only from files on disk |
| Workflow format | YAML; `type: chain|graph`; `steps[].run` (shell), `action:` built-ins (`docker.run`, `ssh.run`, `http.request`, `dag.run`, `human.task`, `harness.run` …); `retry_policy {limit, interval_sec, backoff}`; `continue_on`; `preconditions`; `handler_on {init,success,failure,abort,exit}`; `timeout_sec`; `queue`; `env`, `params`, `secrets` (env/file/Vault/cloud providers, masked in logs); `approval {prompt,input,required,rewind_to}` on any step |
| Approval semantics (important) | The step **runs its command first, then pauses** the DAG until `POST …/steps/{step}/approve` (with optional required inputs) or `…/reject`. The gate therefore belongs on a *plan/noop* step **before** the privileged step, never on the privileged step itself |
| Docker | `docker.run` and `container:` talk to the daemon **over the socket** (root-equivalent if granted). Exec-into-running-container mode exists |
| systemd / SSH | no native systemd action; `run:` + `systemctl` works with the rights the process has. `ssh.run` executor exists |
| Isolation | none of its own: steps run as the Dagu process user in the Dagu process cgroup. Isolation is whatever systemd/containers give the process |
| Retry / logs | per-step retry with backoff; run log + per-step `.out/.err` files under `paths.log_dir`; run status and node status over the API; event log (`/api/v1/event-logs`) in community |
| Scheduling | cron `schedule:`, queues with `max_concurrency` |
| MCP | built-in at `/mcp`, same auth as the API (401 unauthenticated — verified); tools `dagu_read`, `dagu_change`, `dagu_execute`, bounded by `write_dags`/`run_dags` |
| Resource footprint | 30–34 MiB RSS idle, 149 MiB peak with 7 concurrent runs, ≈30 MiB per CLI-driven run |
| Local service | yes — ran as a **deploy-user systemd unit** with `MemoryMax=256M`, `NoNewPrivileges=true`, `Restart=on-failure` |
| Privileged operations | Dagu has no privilege model of its own. Safe operation = unprivileged Dagu + an external, root-owned, argument-validating helper (§7) |

---

## 3. Architectural comparison

| Criterion | A — Executor drives host directly (today, `claude -p` with a profile) | **B — Executor → Dagu → helper** | C — Executor → custom Host Agent | D — Rundeck / Salt / Ansible |
|---|---|---|---|---|
| Security | The LLM composes shell; allow/deny lists are tool-level regexes | Steps are **pinned YAML on disk** (no runtime authoring), each privileged step routes through a validated helper; LLM never composes the privileged command | Same helper, but the agent itself is new code to secure | Large attack surface, own users/ACL, Java/Python daemons |
| Simplicity | already exists | one 30 MiB binary + YAML | new service to write and maintain | heavy |
| Maintainability | prompt-shaped; hard to review | reviewable DAG files in Git | ours to maintain forever | ecosystem, but foreign to MYTHOS conventions |
| Resource use | none extra | +30 MiB idle, +≈120 MiB under load | +20–50 MiB | Rundeck ≥ 1 GiB JVM; Salt master ≥ 200 MiB |
| Reliability | one process, no retries at step level | per-step retry, run history, survives restart (tested) | must be built | mature |
| Observability | executor events + Claude transcript | run/step status + logs via API, UI on loopback, event log | must be built | mature |
| Governance / approvals | executor policy engine only | executor policy engine **plus** an in-DAG gate that physically stops before the privileged step (tested) | executor policy engine only | own approval systems that bypass OTHMODE |
| Docker / systemd / files | LLM-composed commands | allowlisted verbs via helper; DAG never receives the socket | helper | agents on the host with broad rights |
| Rollback / failure isolation | manual | `handler_on.failure` + explicit rollback DAG; a failed step cannot run its dependants | must be built | mature but generic |
| Auditability | executor JSONL | executor JSONL + Dagu run records; **Dagu's own audit log is Pro-only** | executor JSONL | own |
| MYTHOS fit | is the status quo | additive layer; keeps Executor as the only trigger | duplicates what Dagu already does | second governance system — contradicts "GitHub + OTHMODE are the truth" |

**Assessment.** B is the smallest architecture that turns "host operation" from *LLM-written
shell* into *pinned, reviewable, retry-able, gate-able workflow*. A stays for repository
work. C only makes sense if the helper alone (no orchestrator) proves enough — and the helper
is required in B anyway, so B strictly contains C's value. D is rejected on footprint and on
introducing a second governance domain.

---

## 4. PoC — what actually ran

Location `/home/deploy/dagu-poc` (bin, etc/config.yaml 0600, dags/, data/, logs/). Service:
deploy-user unit `dagu-poc.service` (`ops/dagu-poc/dagu-poc.service`), loopback
`127.0.0.1:8095`, basic auth, `write_dags: false`, coordinator disabled, terminal disabled,
`MemoryMax=256M`, `NoNewPrivileges=true`. No existing container, network, unit, policy or
MYTHOS file was modified. No public exposure.

| Test | Result | Evidence |
|---|---|---|
| 1 Dagu starts | **PASS** | unit active, PID under `user@1001.service/app.slice`, 34 MiB, listens only on `127.0.0.1:8095`; `/api/v1/dags` → 401 without credentials (`/api/v1/health` is public by design) |
| 2 read-only command | **PASS** | `t02-readonly-host` succeeded (uname, uptime, free, df, id) |
| 3 inspect Docker, no change | **PASS (with a finding)** | from the user unit: *permission denied on docker.sock* — the deploy user manager has no `docker` group. Passed when root delegated **only** the `docker` group to one transient invocation (`systemd-run --uid=deploy -p SupplementaryGroups=docker … dagu start t03-docker-inspect`): version, `docker ps`, networks, ContextForge `running healthy` |
| 4 harmless Docker op | **PASS** | same delegation; `docker run --rm --pull=never --network none --memory 32m redis:7-alpine echo …`; verified the container was removed, none left behind |
| 5 systemd status | **PASS** | `systemctl is-active` on system units and (with `XDG_RUNTIME_DIR`) on the deploy user units — all `active`, unprivileged |
| 6 execution logs | **PASS** | per-run JSON log + per-step `.out`/`.err` under `logs/<dag>/<run>/`; retrievable through `GET …/log` and `GET …/steps/{step}/log` |
| 7 failure reported | **PASS** | `t07-expected-failure`: step exits 3 → run `failed`, dependant `never-runs` stayed `not_started`, `handler_on.failure` fired (its `.out` file carries the run id) |
| 8 retry | **PASS** | `t08-retry`: `retry_policy {limit 3, interval_sec 2}`; step failed twice (`retry_count: 2`) and succeeded on attempt 3; run `succeeded` |
| 9 restart / recovery | **PASS** | graceful `systemctl --user restart`: back in < 2 s, 11/11 run records intact. `SIGKILL` of the main PID: unit restarted itself (`NRestarts=1`), history intact |
| 10 MYTHOS unaffected | **PASS** | `t10-mythos-health` (executor `/health ok`, oth-knowledge ok, mcp-http ok, ContextForge `/health` 200, Resource Guard `NORMAL admit:true`) — run *through Dagu*; `docker ps` unchanged; no OOM kill |
| 11 approval gate (extra) | **PASS** | `t11-approval-gate`: run paused at `waiting` after the plan step; the gated step had no log until `POST …/steps/plan/approve` with the required input `approval_ref`; then `gated-restart` and `verify` ran and the input was visible as `$approval_ref` |

Nothing production was stopped, restarted or modified. ContextForge, OTHMODE, the Executor,
the Bridge, the MCP bridge, Docker and all containers were untouched.

---

## 5. Resource impact

| Moment | MemAvailable | Swap used | PSI some/60 | oom_kill | Dagu RSS |
|---|---|---|---|---|---|
| before install | 2 244–2 352 MiB | 4 085–4 095 MiB | 0.00–0.07 | 1323 | — |
| Dagu idle | 2 257 MiB | 4 095 | 0.09 | 1323 | 34 MiB |
| 7 runs in parallel | 2 005 MiB | 4 095 | 0.02 | 1323 | **149 MiB peak** (cgroup peak) |
| after tests, idle | 2 014 MiB | 4 094 | 0.00 | 1323 | 30 MiB |

Resource Guard stayed `NORMAL` / `admit: true` throughout. The ~230 MiB drop in available
memory is host drift (13 resident agent sessions, ContextForge, OmniRoute); Dagu's own
contribution is bounded by its cgroup and never exceeded 149 MiB. Safe.

---

## 6. Security findings that shape the design

1. **Dagu is only as safe as the identity it runs under.** It has no sandbox. A Dagu with the
   Docker socket is root. A Dagu with `sudo` is root. The PoC therefore runs it with
   *nothing*: deploy user unit, `NoNewPrivileges`, no `docker` group — and this was
   *proven* by the socket refusal in test 3.
2. **User units cannot gain groups.** `SupplementaryGroups=` needs `CAP_SETGID`, which the
   deploy user manager lacks. Docker or root access can only be delegated by a **system**
   unit or a **root-owned helper** — both owner-installed. This is a feature: the boundary
   cannot be crossed from an agent session.
3. **Audit is Pro-only.** Community Dagu keeps run records and an event log but no
   actor-attributed audit trail. MYTHOS must keep its own audit (it already does:
   executor events JSONL, governance `audit.log`, MCP audit) and treat Dagu's records as
   evidence, not as the ledger.
4. **`write_dags: false` is the key control.** With it, the API, UI and MCP can only *run*
   what is on disk. DAG files become code: reviewed in Git, delivered by the relay, owned by
   root or read-only to the Dagu user in production.
5. **Approval gates are real but placement matters** (§2). The privileged step must
   *depend on* a gated plan step. Approval identity in community Dagu is the shared basic
   credential — the MYTHOS approval id must be carried as a required input and verified by
   the helper against `/var/lib/mythos/governance/approvals/` before it acts.
6. **The helper, not Dagu, is the trust boundary** — same pattern as `mythos-logs` and
   `mythos-deploy` already on this host: root-owned 0755, fixed verbs, every argument
   validated by anchored regex, `--no-pager`, absolute paths, no user-supplied path to any
   subprocess.

---

## 7. Privilege model (proposed; nothing installed)

```
Claude / Fable  ──(no host rights; repo + loopback HTTP only)──▶  Executor
Executor        ──(bearer, loopback, run_dags only)────────────▶  Dagu (user `dagu`, no groups, NoNewPrivileges)
Dagu step       ──(sudo NOPASSWD, one binary, fixed verbs)─────▶  /usr/local/sbin/mythos-hostops
mythos-hostops  ──(validates verb+args against hostops-allowlist.json, checks approval file)──▶ docker / systemctl / files
```

* **Identity**: a dedicated system user `dagu` (no `docker`, no `sudo` beyond the one rule),
  system unit `dagu.service` with the PoC's hardening (`ProtectSystem=strict`,
  `ProtectHome=read-only`, `ReadWritePaths=/var/lib/dagu`, `MemoryMax=256M`,
  `OOMScoreAdjust=300`), loopback only, headless (UI optional through the OS console proxy).
* **The one sudo rule** (owner-installed, `/etc/sudoers.d/60-dagu-hostops`):
  `dagu ALL=(root) NOPASSWD: /usr/local/sbin/mythos-hostops` — *never* `ALL`, never
  `docker`, never `systemctl` directly.
* **Helper verbs** = the `helper` field of `ops/dagu-poc/hostops-allowlist.json`. READ verbs
  run without approval. WRITE/RESTART verbs require `--approval <id>` naming a GRANTED,
  unconsumed record in `/var/lib/mythos/governance/approvals/` whose `action_class` is
  `hostops:<operation>` (the same mechanism `mcp-invoke.js` uses for CONTROLLED tools).
  DEPLOY verbs additionally require the owner approval kind. DESTRUCTIVE verbs do not exist.
* **Docker socket**: only the helper touches it (as root). Documented consequence: whoever
  can edit the helper or its allowlist is root — both are governance-protected paths and
  root-owned; the `dagu` user can read neither `/etc/mythos/governance.key` nor the helper
  source.
* **Rollback of the model**: delete the sudoers line and the unit; nothing else holds rights.

---

## 8. Operation allowlist (declared in `ops/dagu-poc/hostops-allowlist.json`)

| Operation | Class | Approval | Helper verb | Arguments (anchored regex) |
|---|---|---|---|---|
| `host.health.check` | READ | none | `health` | — |
| `host.docker.status` | READ | none | `docker-status` | container name |
| `host.docker.logs` | READ | none | `docker-logs` | container, lines ≤ 9999 |
| `host.systemd.status` | READ | none | `systemd-status` | `*.service|*.timer` |
| `host.file.read` | READ | none | `file-read` | under `/home/deploy/{deployments,projects}` only |
| `host.resource.guard` | READ | none | `resource-guard` | — |
| `host.file.write` | WRITE | governance | `file-write` | under `/home/deploy/deployments/<project>/` only |
| `host.docker.restart` | RESTART | governance | `docker-restart` | `mythos-poc-*` / `evolution-*` only |
| `host.systemd.restart` | RESTART | governance | `systemd-restart` | `dagu-poc` / `evolution-*` units only |
| `host.docker.deploy` | DEPLOY | owner | `compose-up` | pinned project dir under `/home/deploy/deployments/` |
| `host.docker.rollback` | DEPLOY | owner | `compose-rollback` | same |

**Never executable through this path** (`denied_forever`): `rm -rf`, `docker system prune`,
volume/network removal, database drops, disk formatting, firewall flush, arbitrary root shell,
SSH/user/credential changes, Resource Guard thresholds, disabling governance, and restart of
ContextForge, the Executor, OTHMODE, the relay, the MCP bridge, docker, nginx, ssh or
`user@1001`. `tests/dagu-hostops-allowlist-test.js` asserts these invariants (7/0).

Enforcement, in order: (1) the DAG file cannot be authored at runtime (`write_dags: false`);
(2) the step can only call the helper (the `dagu` user has no other rights); (3) the helper
refuses any verb/argument not in the allowlist; (4) WRITE/RESTART/DEPLOY need an approval
record the helper verifies; (5) the Dagu approval gate physically holds the run before the
privileged step; (6) everything is logged on both sides.

---

## 9. MYTHOS integration design (nothing implemented in production)

The Executor stays the single execution engine. Dagu is a *capability* the Executor calls,
exactly like `lib/mcp-invoke.js` calls MCP servers. Proposed: `lib/hostops.js` +
`POST /hostops/run` on the executor API, following the 8-gate order of `mcp-invoke.js`.

| # | Question | Answer |
|---|---|---|
| 1 | How OTHMODE submits an operation | OTHMODE does not talk to Dagu. An OTHMODE Task with `requested_action: hostops` (new action → profile `hostops`, mapped in `bridge/action-resolution.js PROFILE_BY_ACTION`) is queued in the Executor like any task. OTHMODE keeps the Task record and the Command History |
| 2 | How the Executor invokes Dagu | `lib/hostops.js run({task, operation, params})`: registry check (operation ∈ allowlist) → class → approval requirement → Resource Guard gate → `POST http://127.0.0.1:<port>/api/v1/dags/<dag>/start` with bearer from the executor env (by reference, never in the task) → poll `GET /dag-runs/{name}/{id}` → collect step logs → verify step → structured result |
| 3 | Task identity propagation | Dagu params `MYTHOS_TASK_ID`, `MYTHOS_ATTEMPT_ID`, `MYTHOS_REQUESTED_BY`; also CLI-style labels (`task=<id>`) so the Dagu UI and history filter by task |
| 4 | GitHub TASK id | `GITHUB_TASK_ID` param = the bridge task id (`control/tasks/<id>.json`) or the Issue number (`gh-issue-<n>`), copied from the executor task's `stage` (`github:<id>`) |
| 5 | OTHMODE task id | `OTHMODE_TASK_ID` param (`OTH-2026-000xx`) from the bridge claim (`exec.othmode_task_id`) |
| 6 | Dagu execution id | the `dagRunId` returned by `/start` is appended to the executor task's `events.log` as `hostops_started {dag, dag_run_id}` and stored in `status.hostops[]`; the run's `log` path is recorded with it |
| 7 | Logs ↔ TASK | executor stores `{dag_run_id, log_path, step_logs[]}`; the bridge REPORT `execution.hostops` block carries the same, so the GitHub report links to the Dagu run; OTHMODE Task `evidence` section names the run id |
| 8 | Results → Executor | `hostops.js` returns `{status: succeeded|failed|waiting|rejected, steps[], outputs, verification}`; a `failed` or `rejected` run is a task outcome, never a crash; a `waiting` run (approval pending) transitions the task to `BLOCKED` with `HUMAN_APPROVAL` (existing classification in `lib/quota.js`) |
| 9 | REPORT generation | unchanged: the provider/Executor emits the `mythos_report` JSON; `lib/report.js` gains an optional `hostops` section; the bridge writes `control/reports/<id>.json` including `execution.hostops` |
| 10 | Failures | Dagu run `failed` → executor `FAILED` with `last_failure.category = permanent` unless the failing step is tagged transient (exit-code map) → `WAITING_RETRY` via the existing backoff |
| 11 | Retries | two levels, deliberately separate: **step retries inside Dagu** (`retry_policy`) for transient host errors; **task retries in the Executor** (`RETRY_POLICY`) for the whole operation. A DAG is written idempotent so the executor may re-run it |
| 12 | Approval gates | executor policy engine `requestApproval → decideApproval` produces the record (as for CONTROLLED MCP tools). The Executor passes the approval id as the DAG's required input when it starts (or approves) the gated plan step; the helper re-verifies the record and consumes it. Two independent checks, one record |
| 13 | Resource Guard admission | `hostops.run` is an **admission**: it calls `guardGate()` first and returns `dispatch_deferred / resource_pressure` under `CRITICAL`, exactly like `dispatchTask()` |
| 14 | Dagu cannot bypass Resource Guard | (a) no `schedule:` field is allowed in host DAGs (a repo test scans `ops/dagu/dags/`); (b) `write_dags: false`; (c) the Dagu credential exists only in the executor env and the owner's shell; (d) queue `max_concurrency: 1`; (e) every DAG's first step is `host.resource.guard` with a precondition `admit == true` — a second, in-DAG gate |
| 15 | Secrets | Dagu config 0600 under the `dagu` user; the executor holds `MYTHOS_DAGU_TOKEN` by `EnvironmentFile=` reference (same as `mcp-http.conf`); DAG files contain no secret (registry check reuses `lib/mcp-registry.js`'s secret-shape refusal); the helper reads project secrets itself as root from 0600 files and passes none to Dagu; Dagu log masking on for any `secrets:` block |
| 16 | Audit | three ledgers already exist and are reused: executor `events.log` (every hostops call and outcome), governance `/var/lib/mythos/governance/audit.log` (approval consume, written by the helper through `mythos-governance-approve`'s library), Dagu run records (evidence). Dagu Pro audit is *not* required |
| 17 | Rollback | every DEPLOY DAG has `handler_on.failure` → `host.docker.rollback` (compose down of the *new* project only, never volumes) and a manually runnable `<name>-rollback` DAG; the executor records `rollback_executed` |
| 18 | Restart / recovery | Dagu: `Restart=on-failure` (tested), run records on disk survive; a run interrupted mid-way is reported `failed` and the executor's interrupted-recovery path re-evaluates. Executor: unchanged tick recovery. Helper: idempotent verbs |

Execution chain, concretely:

```
GitHub TASK / Issue ─▶ Bridge ─▶ OTHMODE Task ─▶ Executor (createTask: requested_action=hostops → profile hostops)
   ─▶ policy: operation ∈ allowlist? class? approval needed? ─▶ requestApproval (WRITE+)  ─▶ owner decides
   ─▶ Resource Guard admission ─▶ POST /dags/<dag>/start {MYTHOS_TASK_ID, GITHUB_TASK_ID, OTHMODE_TASK_ID, APPROVAL_ID}
   ─▶ Dagu: step 1 resource-guard precondition ─▶ plan (approval gate) ─▶ helper verbs ─▶ verify step
   ─▶ Executor polls, stores dag_run_id + logs ─▶ mythos_report ─▶ control/reports/<id>.json ─▶ GitHub
```

---

## 10. Evolution API use case (design only — NOT deployed)

Task text: *"Deploy Evolution API for MYTHOS WhatsApp Bridge"*. Bridge → OTHMODE → Executor
resolves `requested_action: hostops`, operation `host.docker.deploy`, class DEPLOY → owner
approval requested. On GRANT, Resource Guard admits, the Executor starts
`ops/dagu/dags/evolution-deploy.yaml` (illustrative — not on this branch's PoC instance):

```yaml
description: "Deploy Evolution API (WhatsApp) for the MYTHOS WhatsApp Bridge — isolated project, no message is sent"
type: chain
params:
  - MYTHOS_TASK_ID: ""
  - GITHUB_TASK_ID: ""
  - OTHMODE_TASK_ID: ""
  - APPROVAL_ID: ""
env:
  - PROJECT=/home/deploy/deployments/evolution-api
steps:
  - name: resource-guard
    run: sudo /usr/local/sbin/mythos-hostops resource-guard
    output: GUARD
    preconditions:
      - condition: "${GUARD}"
        expected: "re:.*\"admit\": *true.*"
  - name: plan
    run: sudo /usr/local/sbin/mythos-hostops compose-plan --project "$PROJECT"   # read-only: prints what would change
    approval:
      prompt: "Owner approval for host.docker.deploy evolution-api (approval id required)"
      input: [approval_ref]
      required: [approval_ref]
  - name: network
    run: sudo /usr/local/sbin/mythos-hostops compose-up --project "$PROJECT" --service network --approval "$approval_ref"
  - name: postgres
    run: sudo /usr/local/sbin/mythos-hostops compose-up --project "$PROJECT" --service evolution-postgres --approval "$approval_ref"
  - name: redis
    run: sudo /usr/local/sbin/mythos-hostops compose-up --project "$PROJECT" --service evolution-redis --approval "$approval_ref"
  - name: evolution
    run: sudo /usr/local/sbin/mythos-hostops compose-up --project "$PROJECT" --service evolution-api --approval "$approval_ref"
  - name: health
    retry_policy: { limit: 10, interval_sec: 6 }
    run: sudo /usr/local/sbin/mythos-hostops docker-status --container evolution-api | grep -q healthy
  - name: verify-api
    run: curl -sf -m 5 http://127.0.0.1:8080/ | grep -q '"status":200'   # loopback only; no instance, no message
  - name: report
    run: sudo /usr/local/sbin/mythos-hostops docker-status --container evolution-api
handler_on:
  failure:
    run: sudo /usr/local/sbin/mythos-hostops compose-rollback --project "$PROJECT" --approval "$approval_ref"
```

Boundaries: the compose project is pinned on disk under governance; ports loopback-only; no
WhatsApp instance is created, no message sent; AUTOS-0, SPY and n8n are not referenced.
The Executor's result → `mythos_report` → `control/reports/<id>.json` → GitHub.

---

## 11. Honest limits and risks

* **Dagu Pro gates audit/RBAC/API keys.** Community = one shared credential + global
  permissions. Acceptable only because the Executor is the sole client and MYTHOS keeps
  its own ledgers. If per-user attribution inside Dagu is wanted, that is a licence decision.
* **The helper is the real work.** Without `mythos-hostops` (root-owned, owner-installed,
  governance-protected), Dagu adds orchestration but no privilege boundary. Everything
  privileged in §7–§10 depends on it.
* **Owner-installed pieces**: `dagu` system user, system unit, sudoers line, helper. None can
  be installed from an agent session (verified again this stage).
* **Two approval surfaces** (executor record + Dagu gate) must stay one record; the helper's
  re-verification is what keeps them consistent.
* **Basic-auth credential lives on disk** (0600). Rotation = rewrite file, restart Dagu and
  the Executor.
* **Host memory** remains dominated by resident agent sessions; Dagu's +30–150 MiB is
  within the Resource Guard margins but the host has no headroom to spare. The PoC unit's
  `MemoryMax=256M` must be kept in production.
* The `/api/v1/health` endpoint is unauthenticated (upstream design); loopback-only binding
  makes that harmless here.

---

## 12. Operate / remove the PoC

```bash
# status (as deploy)
systemctl --user status dagu-poc.service
curl -s -u mythos-poc:<password from etc/config.yaml> http://127.0.0.1:8095/api/v1/dag-runs?limit=20

# run a test DAG from the CLI (same data dir as the server)
/home/deploy/dagu-poc/bin/dagu start -c /home/deploy/dagu-poc/etc/config.yaml t02-readonly-host

# remove everything (no other file on the host belongs to the PoC)
systemctl --user disable --now dagu-poc.service
rm ~/.config/systemd/user/dagu-poc.service && systemctl --user daemon-reload
rm -rf /home/deploy/dagu-poc
```

---

## 13. Decision

**RECOMMEND — as the orchestration half of the host-operations layer, conditional on the
helper.** Dagu v2.16.2 community satisfies every functional test (start, read-only, Docker
inspect and bounded run under delegated rights, systemd status, logs, failure, retry, restart
recovery, approval gate) at ≈30 MiB idle without touching MYTHOS. It does **not** provide the
privilege boundary; that boundary is the root-owned `mythos-hostops` helper with the
allowlist on this branch, and no production integration should start before the helper
exists and is governance-protected.

**Exactly one next step:** owner review of this document and, if agreed, an owner-installed
`mythos-hostops` helper skeleton implementing the six READ verbs of §8 (no WRITE/RESTART/DEPLOY
yet) plus the `dagu` system user and unit — after which the Executor's `hostops` capability
can be built against a real boundary.
