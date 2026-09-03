# MYTHOS — hostops interface contract (v0.1, READ-ONLY)

Stage **HOSTOPS-READONLY-0**. The contract the Executor's future `lib/hostops.js` +
`POST /hostops/run` will implement against the installed boundary. Nothing in this document
is live executor code yet — the Executor, OTHMODE, the Bridge, Resource Guard, MCP and all
policies are unchanged by this stage.

## The chain (unchanged from `docs/MYTHOS_DAGU_HOST_OPERATIONS.md` §9)

```
GitHub TASK → Bridge → OTHMODE → Executor → Governance → Resource Guard
      → hostops (this contract) → Dagu → host operation → verification → REPORT
```

In v0.1 the Dagu hop is optional: the boundary is complete without it (a DAG step simply
calls the same binary), so the contract is written against `mythos-hostops` directly.

## 1. Request

One structured operation per call. No command strings, ever.

```
sudo /usr/local/sbin/mythos-hostops <verb> [--<arg> <value>]...
     [--task-id <executor task>] [--othmode-task <OTH-…>] [--github-task <id>]
```

* `verb` — a helper verb from `hostops-allowlist.json` (or its `host.*` operation name).
* named arguments only; each must match its anchored allowlist pattern; unknown or
  duplicate flags are refused; values with shell metacharacters or whitespace are refused.
* task identity is optional, validated (`^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$`), and copied
  into the audit event and the response — propagation of GitHub/OTHMODE/executor ids costs
  three flags, nothing more.

## 2. Authorization

Layered; each layer refuses independently:

1. **sudoers** — only the `dagu` identity may reach the binary with root, and only this
   binary (`/etc/sudoers.d/60-dagu-hostops`). Root itself may call it directly (owner).
2. **caller check** — under sudo the helper accepts `SUDO_USER=dagu` only (exit 3).
3. **allowlist class** — the operation must exist and be class READ. WRITE/RESTART/DEPLOY
   verbs are refused *by name with their class* (exit 2, `OPERATION_NOT_READ`); v0.1 has no
   code path that executes them even if the allowlist file were edited.
4. **future (v0.2+)** — WRITE/RESTART verbs will additionally demand `--approval <id>`
   naming a GRANTED, unconsumed record under `/var/lib/mythos/governance/approvals/` with
   `action_class hostops:<operation>`; the record is the same one the executor policy
   engine issues today for CONTROLLED MCP tools. One approval model, two enforcement points.

## 3. Validation

In order, all fail-closed: verb known → class READ → flags well-formed, no duplicates →
every argument matches its allowlist regex → metacharacter net → per-verb hard rules
(`file-read`: normalized path, no `..`, realpath inside `/home/deploy/{deployments,projects}`,
regular file, size cap, secret-shaped basenames refused; `docker-logs`: line cap 9999).
The allowlist itself is refused unless the installed copy is root-owned and not
group/other-writable.

## 4. Execution

READ implementations only, absolute binary paths, `spawnSync` with argument arrays (no
shell interpretation anywhere), 10 s timeout, 1 MiB subprocess buffer, 512 KiB response
cap. `health` and `resource-guard` read `/proc` directly. `resource-guard` *observes*: it
reports live signals plus the guard's persisted level read-only and never advances the
guard's state machine — admission decisions stay with the Executor's own gate.

## 5. Result

Single JSON object on stdout, exit code is the outcome:

| exit | meaning | body |
|---|---|---|
| 0 | ok | `{ok:true, audit_id, operation, class:"READ", args, task, duration_ms, result}` |
| 2 | validation refused | `{ok:false, audit_id, error:{code, message}}` — codes `UNKNOWN_OPERATION`, `OPERATION_NOT_READ`, `ARG_UNKNOWN`, `ARG_INVALID`, `ARG_MISSING`, `PATH_REFUSED`, `ALLOWLIST_*` |
| 3 | caller refused | `CALLER_NOT_ALLOWED` |
| 4 | execution failed | `EXEC_FAILED` with a bounded stderr tail |
| 5 | audit unavailable | `AUDIT_UNAVAILABLE` — the operation succeeded but the result is withheld |

The Executor treats exit 2/3 as a policy outcome (task `BLOCKED`/`REJECTED` material,
never retried), exit 4 as a normal failure for the existing retry taxonomy, exit 5 as
`BLOCKED` (owner: audit store).

## 6. Audit

One JSONL event per invocation — refusals included — appended to
`/var/lib/mythos/hostops/audit.jsonl` (0700 root dir, 0600 file):
`{ts, audit_id, caller:{uid,sudo_user}, verb, operation, class, args, task, outcome, exit, duration_ms}`.
The `audit_id` appears in every response, so the executor event log, the bridge REPORT and
the helper ledger join on it. **Fail closed:** a success that cannot be audited is not
returned. This ledger complements (never replaces) the executor `events.log` and the
governance `audit.log`.

## 7. Failure

* Validation/authz failures are deterministic and safe to surface verbatim to REPORT.
* `EXEC_FAILED` carries a bounded stderr tail; the operation is read-only so partial
  effects cannot exist.
* Helper crash = non-zero exit with no `ok:true` — callers must treat "no parseable
  `ok:true`" as failure (never parse stdout optimistically).
* Timeout (10 s) is an `EXEC_FAILED`.
* The helper is stateless between calls; there is nothing to recover.

## 8. What v0.1 deliberately does not do

No WRITE/RESTART/DEPLOY execution, no approval consumption, no Dagu API calls, no executor
route, no secrets handling of any kind (secret-shaped files are refused even inside the
approved trees). Those arrive only after this boundary is installed and owner-verified.

---

# HOSTOPS-1 addendum — the implemented Executor adapter (2026-09-03)

The contract above is now implemented by `projects/mythos-ai-executor/lib/hostops.js` and
two routes on the executor API (bearer-gated like every non-`/health` endpoint):

* `POST /hostops/run` — body is a closed field set
  `{operation, arguments, task_id, othmode_task_id, github_task_id, requested_by}`;
  anything else is refused. The response is the adapter's normalized result; the HTTP
  status comes from the outcome code (200 ok · 400 input/args · 403 class or caller ·
  404 unknown operation · 502 exec/malformed · 503 pressure/unavailable/audit · 504 timeout).
* `GET /hostops/registry` — the READ operations as declared by the allowlist. Metadata only.

Why a route at all: every execution profile denies `Bash(sudo:*)`, so an AI-spawned command
can never reach the helper — the daemon route is the only path from a task to the boundary,
exactly as `POST /mcp/invoke` is for MCP tools. The adapter decides in this order (asserted
by `tests/mythos-hostops-executor-test.js`):

```
closed fields → identity validation → allowlist lookup → class READ (governance as declared)
  → argument validation (+ path normal form) → Resource Guard admission (deferred, recorded,
  nothing spawned under CRITICAL) → spawnSync /usr/bin/sudo -n /usr/local/sbin/mythos-hostops
  <verb> <flag array> → verify single JSON body against the exit code → task record
```

Outcome normalization: helper exit 2 → `HOSTOPS_REFUSED` (policy outcome, never retried),
3 → `HOSTOPS_CALLER_REFUSED`, 4 → `HOSTOPS_EXEC_FAILED` (ordinary failure taxonomy),
5 → `HOSTOPS_AUDIT_UNAVAILABLE` (blocked material), spawn `ENOENT`/`sudo -n` refusal →
`HOSTOPS_UNAVAILABLE`, timeout → `HOSTOPS_TIMEOUT`, exit 0 without a parseable JSON body →
`HOSTOPS_MALFORMED` — never a silent success, and never any fallback to a shell, docker or
systemctl.

**Record.** With a `task_id`, every outcome (refusals and deferrals included) appends a
`hostops_invoked` event to the task's `events.log` and a bounded entry to the task file
`hostops.json` `{at, operation, outcome, code, audit_id, hostops_exit, othmode_task_id,
github_task_id, dagu_run_id, duration_ms}`. The bridge REPORT's `execution` block now
carries that list additively as `execution.hostops`, so GitHub REPORT ↔ executor events ↔
root-owned ledger all join on `audit_id`. `status.json` is never touched — `transition()`
remains the single status chokepoint.

**The Dagu decision (mission HOSTOPS-1 architectural question).** Dagu is NOT in the READ
path. A single READ verb is one helper call; inserting Dagu would add a service credential,
a run lifecycle, ~100 ms→seconds of latency and a failure mode while enforcing nothing the
helper does not already enforce — the boundary, not the orchestrator, is the security
model. Dagu remains the orchestration layer for the future multi-step WRITE/DEPLOY
workflows (approval gates, per-step retries, rollback handlers), where `dagu_run_id` will
become real; until then it is carried as `null` by design. The Dagu PoC itself is untouched:
loopback `127.0.0.1:8095`, basic auth, MCP endpoint unused by agents.

**Activation (owner, superseded by HOSTOPS-2R below).** The live daemon runs from `main`
and gains the routes only after merge + executor restart. The original deploy→helper
activation step (`sudo bash ops/hostops/install-hostops.sh` installing
`/etc/sudoers.d/61-deploy-hostops`) never worked in production — see the addendum — and
that sudoers fragment no longer exists. Use the HOSTOPS-2R activation steps instead.

---

# HOSTOPS-2R addendum — the Unix socket boundary (2026-09-03, GitHub issue #130)

**The bug.** `mythos-ai-executor.service` runs with `NoNewPrivileges=true` — load-bearing,
never weakened (docs/MYTHOS_AI_EXECUTOR_ARCHITECTURE.md). Under that flag the kernel
ignores the setuid bit on `exec()` for every child of the hardened process, so the
HOSTOPS-1 boundary call — `spawnSync('/usr/bin/sudo', ['-n', HELPER, verb, ...])`, run
from *inside* the executor — could never actually reach root, no matter what sudoers
granted. In production this was silently non-functional: every real `/hostops/run` call
returned `HOSTOPS_UNAVAILABLE` ("a password is required"). `61-deploy-hostops` is deleted;
it never worked and cannot be made to work without weakening `NoNewPrivileges`, which is
not an option.

**The fix.** Move the privilege boundary out of the executor's process tree entirely.
Two new systemd units (`ops/hostops/mythos-hostops.socket` +
`ops/hostops/mythos-hostops.service`) run a small root daemon
(`ops/hostops/mythos-hostops-daemon.py`) started directly by systemd (PID 1) — never a
child of the hardened executor, so `NoNewPrivileges=true` on the executor is completely
unaffected by this change and remains exactly as before. The executor reaches
root-mediated state purely by *connecting to a local Unix socket*, which needs no
privilege escalation at all.

**Two independent identity gates**, neither of which trusts anything the client sends:

1. **Socket file permissions** — `/run/mythos-hostops/hostops.sock` is `0660 root:mythos-hostops`
   (`SocketUser=root SocketGroup=mythos-hostops SocketMode=0660` in the `.socket` unit).
   Only root and members of the `mythos-hostops` group — `deploy` (the Executor identity)
   and `dagu` — can even `connect()`.
2. **`SO_PEERCRED`** — the daemon additionally calls `getsockopt(SOL_SOCKET, SO_PEERCRED)`
   on every accepted connection and resolves the kernel-reported `uid` against `deploy`,
   `dagu` and `root` via `pwd.getpwuid`. There is no identity field anywhere in the request
   body; the request is `{verb, args, task_id, othmode_task_id, github_task_id}` only. A
   uid that resolves to neither is refused (`HOSTOPS_CALLER_REFUSED`) before the request is
   even parsed.

**The helper is unchanged and remains the sole authority.** The daemon does not
re-implement or duplicate any of the allowlist/class/argument/audit logic in
`mythos-hostops.js` — it invokes that SAME root-owned binary directly:
`subprocess.run(['/usr/local/sbin/mythos-hostops', verb, '--flag', 'value', ...],
shell=False, env={'PATH': ..., 'SUDO_USER': caller})`. `SUDO_USER` is the helper's
existing caller-boundary signal (`ALLOWED_SUDO_CALLERS = ['dagu', 'deploy']`, unchanged);
the helper does not care whether it was set by real `sudo` (dagu's still-installed manual
path, `60-dagu-hostops`) or by this daemon after its own peer-credential check. When the
peer is root, `SUDO_USER` is omitted, matching the helper's pre-existing "root may call it
directly" owner path.

**Wire protocol** (private, same host, `AF_UNIX` only — not a public API). One
newline-terminated JSON object each direction, then the daemon closes the connection:
```
request  {"verb": str, "args": {str:str}, "task_id": str|null,
          "othmode_task_id": str|null, "github_task_id": str|null}
response {"status": int, "stdout": str, "stderr": str}      — the helper ran; its own
                                                                exit code / stdout / stderr,
                                                                verified exactly as before
        | {"error": {"code": str, "message": str}}           — the boundary itself refused
                                                                or could not answer
```
`lib/hostops.js`'s outcome-normalization logic is unchanged: it still checks `body.ok`,
requires a non-empty `audit_id` on success, and maps helper exit codes 2/3/4/5 to
`HOSTOPS_REFUSED`/`HOSTOPS_CALLER_REFUSED`/`HOSTOPS_EXEC_FAILED`/`HOSTOPS_AUDIT_UNAVAILABLE`
— only how the raw `{status, stdout, stderr}` triple is obtained changed, from a
`spawnSync` return value to a socket round trip. `invoke()` now returns a **Promise**
(a socket call is inherently async); `server.js`'s `/hostops/run` route awaits it the same
way it already awaited `mcpInvoke.invoke()`.

**Failure semantics, preserved.** Socket missing or nothing listening (`ENOENT`/
`ECONNREFUSED`) → `HOSTOPS_UNAVAILABLE`, exactly like "sudoers not installed" before.
Client-side round-trip timeout (20 s, unchanged) → `HOSTOPS_TIMEOUT`. Helper exit 0 with
unparseable stdout → `HOSTOPS_MALFORMED`. Helper success without a non-empty `audit_id` →
`HOSTOPS_MALFORMED` (PR #127 hardening, unchanged). The daemon's own `SO_PEERCRED`
rejection maps to `HOSTOPS_CALLER_REFUSED` — the same code the helper's own exit-3 refusal
already produced, since both mean "this caller is not authorized," just at different
layers. Resource Guard admission still happens before the socket is touched at all — the
adapter's governance order (closed fields → identity → allowlist → class READ → argument
validation → Resource Guard → the boundary) is untouched.

**Why Python for the daemon, in an otherwise all-Node ops/ tree.** `SO_PEERCRED` has no
public Node.js API without a native addon; adding a compiled dependency to a root-owned
security boundary — or reaching for network package installation from an autonomous
session — was rejected. Python's stdlib `socket` module supports `SO_PEERCRED` directly on
Linux; the daemon is ~250 lines of stdlib-only Python with no third-party dependency at
all. It still invokes the unmodified Node helper as a subprocess, `shell=False`, fixed argv.

**Dagu.** Still not in the READ path (HOSTOPS-1 decision, unchanged) — nothing calls the
socket on Dagu's behalf. `dagu` is included in the `mythos-hostops` group and the daemon's
allowed-uid set from day one anyway, so the boundary needs no further change on the day
Dagu graduates into an automated caller.

**Activation (owner, in order).**
1. Merge this branch through review.
2. `sudo bash ops/hostops/install-hostops.sh` from the merged checkout — reinstalls the
   helper (unchanged), creates the `mythos-hostops` group, adds `deploy` and `dagu` to it,
   installs `/usr/local/sbin/mythos-hostops-daemon` (0700 root:root), installs
   `mythos-hostops.socket` + `mythos-hostops.service` to `/etc/systemd/system/`, and runs
   `systemctl enable --now mythos-hostops.socket` (the service starts on first connection).
3. `deploy`'s new group membership needs a fresh login session (or restart the executor's
   user manager) to take effect: `systemctl --user restart mythos-ai-executor` after the
   `deploy` shell/session that owns it has picked up the new group, or reboot if unsure.
4. Restart `mythos-ai-executor` (deploy user unit) so the daemon serves the routes.
5. Verify: `curl -s -H "Authorization: Bearer $T" -X POST http://127.0.0.1:8130/hostops/run -d '{"operation":"health"}'`
   returns `ok:true` with an audit id; `journalctl -u mythos-hostops -n 50` shows the
   daemon started and the SO_PEERCRED-verified connection; `sudo -u dagu sudo
   /usr/local/sbin/mythos-hostops health` still answers directly (dagu's manual path,
   unchanged). If the hardened service unit fails to start, `journalctl -u mythos-hostops`
   will show which `ProtectSystem=strict`/`ReadWritePaths=` directive needs loosening —
   the failure mode is the daemon not starting, which the executor already reports as the
   pre-existing, tested `HOSTOPS_UNAVAILABLE` outcome, never a fallback to sudo or a shell.
