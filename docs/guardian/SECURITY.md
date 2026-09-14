# MYTHOS Guardian — security review

Reviewed 2026-09-14 against the implementation in `ops/guardian/`.

## Identity and privileges

| Item | Decision |
|---|---|
| Service user | root. Required to read every process's fds and maps for in-use checks, to reach the deploy user manager (`systemctl --user -M deploy@`), the Docker socket and the `0700` deploy backup-health directory, and to remove root-owned caches. |
| Capabilities | Bounding set `CAP_DAC_OVERRIDE CAP_DAC_READ_SEARCH CAP_FOWNER CAP_SYS_PTRACE`. **Not** CAP_KILL (Guardian signals nothing), CAP_SYS_ADMIN, CAP_SETUID, CAP_NET_*. `NoNewPrivileges=yes`, no ambient capabilities. |
| CAP_SYS_PTRACE | used only by the kernel's permission check to *read* `/proc/<pid>/fd` and `maps` of other users; Guardian never attaches to a process. |
| sudo | none. No sudoers entry. |
| Code executed as root | only root-owned copies in `/usr/local/lib/mythos-guardian`, never the deploy-writable checkout (same model as the session guard). |

## Sandbox (`mythos-guardian.service`)

`ProtectSystem=strict`, `ProtectHome=read-only`, `PrivateDevices`, `ProtectKernelTunables/Modules/Logs`, `ProtectControlGroups`, `ProtectClock`, `ProtectHostname`, `RestrictNamespaces`, `RestrictRealtime`, `RestrictSUIDSGID`, `LockPersonality`, `SystemCallArchitectures=native`, `RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6`, `UMask=0077`, `MemoryMax=192M`, `CPUQuota=25%`, `TasksMax=32`.

Writable: the state directory, plus exactly the code-defined cleanup roots and `/var/log/journal`. `InaccessiblePaths` hides runner credentials, runner `_work`, and root/deploy `.ssh`, even though the runner root must be writable.

`PrivateTmp=no` is a conscious trade: the scratchpad target lives in host `/tmp/claude-0`. The target is verified by uid, age, symlink and protected-name checks.

The sandbox was validated before install by running the real dry-run under `systemd-run` with this exact property set.

## Threat review

| Threat | Mitigation |
|---|---|
| **Shell injection** | no shell anywhere; every command is `spawnSync(argv[])`. Command argv is hard-coded in `disk.js` / `services.js`. Unit names must match `^[A-Za-z0-9@:._-]+\.(service|timer|socket)$` and container names `^[A-Za-z0-9][A-Za-z0-9_.-]*$`. HTTP URLs must be loopback. Tests assert no `exec`/`shell:true` in any module. |
| **Config as an attack vector** | the override cannot add a path, a command, a non-loopback URL, or recovery for data-bearing/ERP units. An invalid override disables all actions. The override path is root-owned `/etc/mythos-guardian/`. |
| **Path traversal** | `path.normalize(p) === p` is required, so `..` is refused, and so is anything outside `ALLOWED_ROOTS`. |
| **Symlink attacks** | `realpath(p) === p` (no symlink component), the target itself must not be a symlink, the tree walk uses `lstat` and never follows links, and `rmSync` unlinks links without following them. Version-directory keep-sets come from `readlink`. If a symlink is unreadable, the whole target is refused. |
| **TOCTOU / races** | full re-verification (path, owner, in-use with a fresh `/proc` scan, mounts, protected names) immediately before each removal. The remaining window is milliseconds, on directories unprivileged users cannot reach or write: `/root/*` targets sit under `/root` (0700), `/root/.claude/remote/ccd-cli` is 0700, `/tmp/claude-0` is root 0700 (its `-root` child is 0755 but untraversable from outside), and the runner paths are owned by `mythos-runner`, the only other writer. Measured 2026-09-14. |
| **Secrets in logs** | incidents and public status pass through `redactDeep` (password/secret/token/api_key/authorization). Guardian never reads `.env`/credential files: they are protected names and `InaccessiblePaths`. Process cmdlines are truncated to 300 chars and appear only as top-RSS `comm` names in status. |
| **Environment variables** | the unit sets none. Children get a fixed minimal env (`PATH`, `LANG`, `HOME`). `MYTHOS_GUARDIAN=off` can only *disable*. |
| **Docker privileges** | the Docker socket is root-equivalent. Guardian uses exactly `docker inspect` (read) and two prune argv with `--filter until=168h` and without `-a`/`volume`/`system`, and only behind the `docker-cleanup` marker at disk ≥ HIGH. |
| **systemd privileges** | only `show`, `reset-failed` and `start`. Never `stop`, `restart`, `kill`, `mask` or `edit`. Start is limited to config entries with `recover: true`, gated by a marker, budgeted, and refused for ERP/DB/Docker by validation. |
| **Resource exhaustion of the host by Guardian** | `MemoryMax`, `CPUQuota`, `TasksMax`, a time-boxed tree walk (3 s / 8 s), a cap of 3 actions per tick, 360-min cleanup cooldown, and bounded incident rotation. |
| **Denial of protection** | a crash has no destructive fallback. The Status Center reports a silent Guardian as DOWN after 10 min. |
| **Public status exposure** | the file is root-only on disk. The Status Center publishes levels and triggers, which contain no secrets or paths beyond unit names and filesystem percentages. |

## Residual risks

- Root with DAC override inside an allowlisted root is still root: a logic bug in `verifyPath` would be serious. Mitigated by 60+ targeted tests, dry-run simulations on the real host, and staged enablement.
- `docker image prune` trusts Docker's own "dangling and unreferenced" definition.
- Guardian cannot stop the Desktop app from creating sessions; admission is advisory.
