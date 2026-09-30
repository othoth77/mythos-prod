# MYTHOS / FABLE — permission model (HostOps v0.2)

**Status:** designed, implemented and tested on branch `mythos/hostops-v02-permission-model-20260925`.
The code path was exercised live on the VPS through the owner path (see §8). The **root install of HostOps v0.2 is an
owner step** (§9): by this model's own rule, changing the gateway that controls FABLE is HIGHLY_SENSITIVE.

FABLE here means the autonomous execution layer: GitHub Issue → bridge → executor → headless Claude Code session
(`claude -p`, user `deploy`, execution profile from `lib/policy.js`, `NoNewPrivileges=true`). Everything that
session does to the host beyond its worktree goes through **HostOps**:

```
FABLE session ──node ops/hostops/hostops-client.js──▶ lib/hostops.js (catalog, attribution, task record)
   ──unix socket /run/mythos-hostops/hostops.sock (0660 root:mythos-hostops)──▶ root daemon (SO_PEERCRED: deploy|dagu|root)
   ──fixed argv, shell=False──▶ root helper /usr/local/sbin/mythos-hostops (catalog + tiers + HARD invariants + audit)
        ├─ root-scoped work: catalogued `systemctl <action> <system unit>`, `docker restart <container>`
        └─ deploy-scoped work ──systemd-run --user (uid deploy)──▶ user worker (drop-ins, systemctl --user, bridge tools)
   ──▶ verification ──▶ automatic rollback on failure ──▶ audit (intent BEFORE, result AFTER)
```

## 1. What blocked #477

1. **HostOps v0.1 was READ-only by construction.** `host.file.write` / `host.systemd.restart` were declared but refused
   by name (`OPERATION_NOT_READ`), no `daemon-reload` verb existed, and `file-read` could not even read
   `~/.config/systemd/user/…` (roots were `/home/deploy/{deployments,projects}` only). The "governance approval" those
   classes required (`docs/MYTHOS_HOSTOPS_INTERFACE.md` §2.4) was never built.
2. **The executor adapter refused every non-READ class** before the socket (`HOSTOPS_NOT_READ`).
3. The recipient lives only in the deploy drop-in `mythos-github-bridge.service.d/20-whatsapp.conf`, must be
   digits-only (the issue wrote `+216…`), and `notify-config` only sees it inside the unit's environment.

Nothing in the session's sandbox was the real wall for a *deploy-owned* file — `Bash(node:*)` already grants
deploy-level power. What was missing was a **sanctioned, validated, audited, reversible** path. That is what v0.2 adds.

## 2. The three tiers

| Tier | Autonomous | Where it is enforced | Examples |
|---|---|---|---|
| **A · NORMAL** | yes | execution profile (`lib/policy.js`) + HostOps READ class | edit/commit in the task worktree, run tests, `git` on the task branch (relay delivers), read-only host observation: `health`, `resource-guard`, `systemd-status`, `user-unit-status`, `docker-status/logs`, `file-read` (deploy trees, no secret names), `config-get` (masked), `change-list`, `catalog`, NORMAL tools (`bridge.notify-config`, `bridge.notify-status`) |
| **B · CONTROLLED** | yes, under policy | HostOps CONTROLLED class, root helper | `config-set` of catalogued keys (e.g. `bridge.whatsapp.to`), `user-daemon-reload`, `service-control` start/stop/restart of catalogued units, `docker-restart` of catalogued containers, CONTROLLED tools (`bridge.notify-test` 1/10 min with `--confirm yes`, `bridge.notify-flush`, `bridge.notify-breaker-reset`), `change-rollback` |
| **C · HIGHLY_SENSITIVE** | **never** | refused by HostOps (named list + OWNER/DESTRUCTIVE classes + HARD invariants); owner acts outside the system | auth system, SSH policy/keys, firewall, raw secrets (read/export/rotate), users & privileged groups, sudoers, root shell, disabling sandbox/audit/logging, deleting backups, irreversible data loss, **changing HostOps / its catalog / governance / relay / approvals**, Resource Guard thresholds, stopping Guardian/Session Guard/memwatch |

### What every CONTROLLED operation gets (catalog field → helper behaviour)

| Requirement | Implementation |
|---|---|
| operation ID | catalog `operations` key (`host.config.set`, …) + helper verb; every call gets an `audit_id` |
| allowed arguments | anchored per-argument regex, then a metacharacter/whitespace net; per-target catalogs (`services`, `containers`, `config_keys` with `item_pattern`/`max_items`, `tools` with FIXED argv) |
| risk level | `class` → `tier`; a tool call's effective tier is the tool's tier |
| approval requirement | NORMAL: none · CONTROLLED: policy (catalog + HARD invariants + gates below) · HIGHLY_SENSITIVE: owner, never executed |
| timeout | per operation `timeout_ms` (≤ 60 s); daemon ceiling 90 s; adapter/client 100 s |
| audit record | `phase: intent` appended BEFORE execution — if it cannot be written nothing runs (exit 5); `phase: result` after; refusals audited with task identity; masked values only |
| idempotency | `idempotent` flag; `config-set` same value → `unchanged` (no write); `stop` of a stopped unit → `unchanged`; rollback of a rolled-back change → `unchanged` |
| rollback | `config-set`: backup record (root 0600, `changes/<id>.json`) BEFORE a compare-and-swap write; verification failure → automatic restore + reload + re-verify; afterwards `change-rollback --change <id>` (refuses if a later change exists). `stop` names its inverse. Restarts are self-healing. |
| gates | owner kill switch `/etc/mythos/hostops-controlled.disabled`; attribution (`--task-id`/`--github-task`/`--othmode-task`) required from deploy/dagu; Resource Guard CRITICAL defers (recovery ops exempt); single-writer lock; 120/h global + per-tool rate limits |

## 3. Fail-closed rules

Unknown operation, unknown/duplicate/missing argument, pattern mismatch, metacharacter, uncatalogued target,
catalog not root-owned / not JSON / not schema 0.2 (`ALLOWLIST_SCHEMA`), ambiguous drop-in (0 or >1 matching
lines — HostOps never adds directives), drop-in missing, drop-in not owned by deploy, drop-in holding an inline secret,
symlinked target, stale compare-and-swap, unwritable ledger/backup/rate state, lock held, rate exceeded, kill switch,
worker identity mismatch → **refused, nothing executed**. A success that cannot be audited is withheld.

## 4. HARD invariants (in code — a catalog edit cannot relax them)

`ops/hostops/mythos-hostops.js` `HARD`:

- protected units never controlled: HostOps itself, relay, governance, session guard, memwatch, docker firewall,
  executor, command center, bridge **service**, MCP HTTP, runner, haddad ingest, contextforge, ssh, docker, containerd,
  dbus, polkit, `systemd-*`, `user@*`, firewall units, nginx, cron, rsyslog, auditd, apparmor, fail2ban;
- never **stopped**: Guardian, backups/restore tests, status monitor, the bridge timer (start/restart only);
- never reconfigured: executor, HostOps, relay, governance, guards, runner, ssh, docker, nginx, `user@`;
- config env names must be `MYTHOS_*`, never secret-shaped (`TOKEN|SECRET|PASSW|CREDENTIAL|PRIVATE|API_KEY|…`), never a
  security toggle (`GUARD|GOVERN|POLICY|HOSTOPS|APPROV|AUDIT|SANDBOX|ALLOW_PUBLIC|ALLOWED_USER|PRIVILEG|SUDO|ROOT`);
- drop-in names `^[0-9a-z][a-z0-9-]{0,40}\.conf$`, path built from catalog data only; only one existing
  `Environment=KEY=` line is ever rewritten;
- data/identity containers (`postgres|mysql|mariadb|redis|mongo|dex|auth|contextforge|vault|registry`) never restarted;
- tool binaries must sit under `/home/deploy/projects/mythos-prod/`, argv fixed in the catalog;
- raw secret env values are never handed to a tool (only `*_FILE` paths);
- the user worker refuses to run as root.

## 5. Least privilege — who touches what

- **Root never writes into a directory deploy controls.** Drop-in reads/writes, `systemctl --user` and bridge tools run
  in the user worker, started through deploy's own user manager (`systemd-run --user --pipe --wait`,
  `NoNewPrivileges=yes`, `MemoryMax=256M`) with deploy's uid. The root daemon keeps `ProtectHome=read-only`; its only
  writable path stays `/var/lib/mythos/hostops`. Symlink/TOCTOU escalation is structurally absent (and the worker
  refuses symlinks and does compare-and-swap anyway).
- Root itself runs only catalogued `systemctl <start|stop|restart> <system unit>` and `docker restart <container>`.
- **Raw secrets are never in FABLE's environment.** `providers/claude-code.js` used `env: process.env`, handing every
  session `MYTHOS_EXECUTOR_TOKEN` (the executor API bearer — enough to resolve campaign approvals, i.e. approve its own
  work), `MYTHOS_GITHUB_MCP_RW_TOKEN`, `MYTHOS_MCP_HTTP_TOKEN` and `MYTHOS_CONTEXTFORGE_EXECUTOR_TOKEN`. v0.2 scrubs
  secret-shaped variables (the CLI's own login variables excepted).

## 6. Findings that remain OPEN (owner decisions)

| # | Finding | Why it matters | Owner action |
|---|---|---|---|
| F1 | **deploy's user manager carries the `docker` group** (`Groups: 100 986 1001 1003` on `user@1001` since the 2026-09-18 reboot; verified: a deploy user-manager process gets `HTTP 200` from `/var/run/docker.sock`). The executor and every FABLE session inherit it. | Docker-socket access is root-equivalent; `NoNewPrivileges` does not stop it. The "no root for Claude" rule is not currently true. | Remove `deploy` from `docker` and restart `user@1001` in a maintenance window (restarts all deploy services). Anything deploy legitimately needs docker for goes through HostOps (`docker-status`, `docker-logs`, `docker-restart`); Guardian's `docker builder prune` needs a HostOps entry first. HIGHLY_SENSITIVE (user/group change). |
| F2 | Token **files** stay readable by the deploy uid (`~/.config/mythos-ai-executor/executor.env`, `~/deployments/mythos-gateway/*.env`). | The env scrub removes the trivial path; a session running as deploy can still read the files. | Run AI sessions under a separate unprivileged uid without read access to deploy's secrets (design change). |
| F3 | The executor's CONTROLLED-MCP approval store `~/mythos-ai-executor/orchestration/approvals/` is deploy-writable, and `decideApproval` accepts any non-empty `decidedBy`. | A deploy process can mint its own MCP approvals. | Move approvals to a root-verified store (as `mythos-governance-approve` does). Touches governance-protected `core/policy-engine.js` / `core/store.js`. |
| F4 | Task ids on socket calls are **self-asserted**. | Attribution, not authorization. v0.2 records `task_verified` (task_id resolves to a RUNNING executor task, checked root-side) and requires attribution for CONTROLLED. | None required; noted. |
| F5 | `/etc/sudoers.d/61-deploy-hostops` still exists (docs say removed). It lets an interactive deploy login `sudo` the helper — same policy as the socket (`SUDO_USER=deploy`), so no extra power. | Hygiene. | Remove when convenient (sudoers change = owner). |

## 7. Extending the model

Adding capability = adding **data** to the catalog, never code: a unit to `services.user|system` with its allowed
actions, a container to `containers`, a key to `config_keys` (unit, drop-in, env, `item_pattern`, `max_items`, mask,
`verify_tool`), a tool to `tools` (fixed bin + argv, tier, rate limit, confirm). The HARD invariants and the
allowlist test (`tests/dagu-hostops-allowlist-test.js`) keep any addition inside the model. Installing a catalog
change on the host is an owner step (HIGHLY_SENSITIVE: `host.policy.change`) — FABLE can **propose** permissions in a
PR, never grant them to itself.

## 8. Tests

| Suite | What it proves |
|---|---|
| `tests/mythos-hostops-controlled-test.js` | 37 checks (35 as deploy + 2 root-only): #477 flow, idempotency, rollback + conflict, automatic rollback (verify tool / failed reload), validation + injection, fail-closed, HIGHLY_SENSITIVE + OWNER refusals, tampered catalog vs HARD invariants, inline secret, kill switch, Resource Guard, lock, confirm + rate limit, services/containers, privilege drop (uid deploy, **no supplementary groups**), symlink swap, CAS, no shell, session env scrub |
| `tests/dagu-hostops-allowlist-test.js` | catalog invariants (tiers, per-op metadata, anchored patterns, protected targets, key/tool rules, HS list) |
| `tests/mythos-hostops-test.js` | v0.1 READ properties unchanged; OWNER verbs refused; retired verbs unknown |
| `tests/mythos-hostops-executor-test.js` | adapter tier gate, attribution, timeouts, delegated admission |
| `tests/mythos-hostops-daemon-test.js`, `tests/mythos-hostops-group-refresh-test.js` | daemon identity gate; installer refresh is skipped when the manager already has the group |
| `ops/hostops/live-selftest.js --mode direct` | **real host**: production code path through real `systemd --user` + `systemd-run --user`, masked READ of the live bridge recipient, real `notify-config`, the #477 flow on a scratch replica of the live drop-in with byte-exact rollback, refusals, ledger — live drop-in untouched |
| `ops/hostops/live-selftest.js --mode socket` | the same **through the real FABLE path** (deploy → client → socket → daemon → installed helper) — run after install |

## 9. Owner steps

1. **Install HostOps v0.2** (HIGHLY_SENSITIVE by §2): from a checkout of this branch/merge,
   `sudo bash ops/hostops/install-hostops.sh` — installs helper, worker, daemon, units, catalog; no `user@` restart when
   the group is already present; `try-restart mythos-hostops.service`. Verify: `sudo node ops/hostops/live-selftest.js
   --mode socket`. **Rollback:** re-run the installer from `origin/main` at 88de5f48 (v0.1 files), then
   `sudo rm -rf /usr/local/lib/mythos-hostops`. Emergency stop without uninstalling: `sudo touch
   /etc/mythos/hostops-controlled.disabled`.
2. **#477** then becomes a FABLE task: add `rerun` to the Issue; the session runs
   `hostops-client.js config-set --key bridge.whatsapp.to --value +216… --github-task gh-issue-477 --task-id <id>`
   (reload + `notify-config` verification + rollback are automatic) and one
   `tool-run --tool bridge.notify-test --confirm yes`.
3. F1–F5 above.
