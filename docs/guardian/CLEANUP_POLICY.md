# MYTHOS Guardian — safe cleanup policy

Cleanup is **defined in code** (`ops/guardian/lib/disk.js`, `TARGETS`). Configuration can only switch an id off, raise its minimum level or lengthen its age. Nothing runs without the matching marker in `/var/lib/mythos-guardian/enable/`, and nothing runs below disk HIGH.

## Allowlist

| Id | What | Min level | Age | Marker | Why it is safe |
|---|---|---|---|---|---|
| npm-cache-root | `/root/.npm/_cacache` | HIGH | — | disk-cleanup | npm's content-addressed cache, regenerated on demand, equivalent to `npm cache clean --force` |
| runner-diag-old | `/opt/mythos-gh-runner/_diag/<Name>_<date>-utc.log` | HIGH | 14 d | disk-cleanup | runner diagnostic logs (1 400+ from the 08-29..09-13 session-conflict loop) |
| runner-old-versions | `/opt/mythos-gh-runner/{bin,externals}.X.Y.Z` not targeted by the `bin`/`externals` symlinks | HIGH | — | disk-cleanup | superseded runner builds; refuses entirely if either symlink is unreadable |
| vscode-server-old | `/root/.vscode-server/cli/servers/Stable-<sha>` except the newest | HIGH | — | disk-cleanup | superseded VS Code server builds, only if no process maps them |
| docker-build-cache | `docker builder prune -f --filter until=168h` | HIGH | 7 d | docker-cleanup | build cache (2.07 GB, 0 active at discovery); images, containers and volumes are untouched |
| ccd-cli-old-versions | `/root/.claude/remote/ccd-cli/X.Y.Z` except the newest | CRITICAL | — | disk-cleanup | old agent CLI binaries; **any version a running session executes is protected** (2.1.266 was, at discovery) |
| claude-scratch-old | `/tmp/claude-0/-root/<session-uuid>` | CRITICAL | 7 d (newest file) | disk-cleanup | agent scratchpads; refused if they contain a repo, a dump or a secret-shaped name |
| docker-dangling-images | `docker image prune -f --filter until=168h` (no `-a`) | CRITICAL | 7 d | docker-cleanup | only untagged images no container references; the untagged-but-in-use images (idauto-postgres, omniroute, dex, mcp-auth-proxy) are referenced and kept by Docker itself |
| journal-vacuum | `journalctl --vacuum-size=300M` | EMERGENCY | — | disk-emergency | the journal is capped at 500 M already; this buys ~200 M only in an emergency, **after** capturing kernel OOM lines into the incident |

Deliberately **not** on the list, although the order named them as candidates:
- snap cache: snapd hard-links it into its revisions and prunes it itself.
- anonymous Docker volumes: all 9 volumes were linked at discovery. A "proven-unused" volume cannot be proven by a timer, so volume removal stays a human decision.
- app logs inside Docker volumes (dar-hijama laravel.log): that is the application's volume.
- worktrees and clones: never automatic.
- `/var/log` rotated archives: logrotate owns them.

## The 10-step verification (every path, every time, and again right before removal)

1. **Path**: normalised, inside `ALLOWED_ROOTS`, not the root itself, `realpath == path` (no symlink component), not a symlink.
2. **Owner**: uid equals the target's expected owner (root, or `mythos-runner` for runner paths).
3. **Not active**: no `/proc/*/exe`, `cwd`, `root`, open fd or memory mapping inside the path.
4. **Not mounted**: no mount point at or under the path.
5. **Not production**: not under `PROTECTED_PREFIXES` (`/etc`, `/usr`, `/var/lib/docker`, `/var/lib/containerd`, `/var/backups`, `/var/www`, `/var/lib/mythos*`, `/home/deploy/{projects,deployments,worktrees,mythos-backups,backups}`, `/root/backups`, `.ssh`, `/root/.config`, `/root/.claude/projects`, runner `_work`/credentials).
6. **Not backup or secret**: no entry anywhere in the tree matches `PROTECTED_NAME_RE` (`.git`, `.env*`, `.ssh`, `id_rsa*`, `*.pem|key|p12|pfx|kdbx`, `*credential*`, `*secret*`, `*backup*`, `*.sql|dump[.gz|.zst]`). A tree too large to scan within its budget is refused unless the target is opaque by definition (package caches, binaries).
7. **Size recorded** (bounded walk).
8. **Reason recorded** (the target's reason string).
9. **Removed** with `fs.rmSync` (does not follow symlinks inside the tree), after a fresh re-run of steps 1–6.
10. **Result recorded**: removed or not, bytes, error, plus disk free before and after for commands, in `incidents.jsonl`.

## Never automatically deleted

Git repositories · active worktrees · production databases · production Docker volumes · current backups · backup repositories · credentials · `.env` files · SSH material · active deployment artifacts · user documents.

## Seeing what would happen

```bash
mythos-guardian simulate disk-high        # HIGH targets against the real host, dry-run
mythos-guardian simulate disk-emergency   # everything, dry-run
mythos-guardian simulate disk-high --json # full path lists with failed checks
```
