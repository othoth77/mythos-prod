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
