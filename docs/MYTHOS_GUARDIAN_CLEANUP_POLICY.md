# MYTHOS Guardian — cleanup policy

What Guardian may remove, what it may never remove, and the rule that decides
anything not yet listed.

Version 1.0.0, 2026-09-17.

---

## 1. The rule

> Guardian may remove **derived data**, by a named command, after proving the
> removal is worth making. It may not remove **anything chosen by path**.

Derived data is data that can be reproduced from something else that still
exists: a package cache reproduced by downloading again, a build cache
reproduced by building again. Losing it costs time. Losing anything else costs
something that cannot be recreated.

This is why Guardian still has **no delete primitive**. `io` exposes no
`unlink`, `rm`, `rmdir`, `chmod` or `chown`. Disk remediation is done with
allowlisted commands that are themselves incapable of touching a file
Guardian names. A future action that needs real deletion is a separate,
reviewable change, and §5 says what it would have to bring.

## 2. What Guardian may remove today

| Action | Removes | Reproduced by | Measured here |
|---|---|---|---|
| `ACTION_CLEAR_NPM_CACHE` | `~/.npm/_cacache` | the next `npm install` re-downloads | 162 MiB |
| `ACTION_PRUNE_DOCKER_BUILD_CACHE` | build cache older than 168 h | the next build rebuilds those layers | 3.5 GB |

Both are gated at disk `HIGH` (85 %) or above, both have a cooldown and a
daily ceiling, and both verify their own effect afterwards.

`docker builder prune` is pinned with `--filter until=168h` so a week of
recent cache survives — a cold cache on every build is a real cost, and the
point is to reclaim the stale part, not all of it.

## 3. What Guardian may never remove

Not at any level, under any configuration, with every flag enabled.

**Never, by category**

- backups of any kind, local or remote, fresh or stale
- databases, database volumes, database dumps
- credentials, keys, `.env` files, tokens, `~/.ssh`
- git repositories, worktrees, checkouts
- production Docker volumes, containers or images
- anything under the production checkout
- any file whose path Guardian was told about by the data it read

**Never, by command**

```
docker system prune          docker system prune -a
docker volume prune          docker image prune -a
docker rm / rmi              rm / rm -rf
chmod / chown                git clean / git reset --hard
```

None of these is in `ACTION_COMMANDS`. `allowedAction()` refuses them, and
the self-test asserts the refusal on the host it runs on.

`PROTECTED` refuses by substring — `mythos-backups`, `backup-health`, `.ssh`,
`id_ed25519`, `.env`, `secrets`, `credential`, `postgres`, `mysql`,
`mariadb`, `erp`, `.git`, `mythos-prod`, `idauto`, `piece`, `ssangyong`,
`dar-hijama` — and by unit name for thirteen units. It is checked at gate 6,
before the command allowlist is consulted.

## 4. The procedure, every time

Guardian implements this order and cannot skip a step:

1. **CHECK** — is disk actually at or above the threshold? (`statfs`, not an
   estimate.)
2. **PROVE UNUSED** — the action's precondition establishes there is enough to
   reclaim to be worth doing. Below the floor (64 MiB of npm cache, 1 GB of
   build cache) it declines and says so, rather than running for nothing.
3. **RECORD** — the audit record is written with the state *before*, the exact
   argv, and what undoing it costs.
4. **CLEAN** — one action per tick, at most.
5. **VERIFY** — the action re-measures and records whether the number actually
   moved.

A step that fails stops the action. A verification that fails is recorded as
`verified: false` and surfaces as a `WARNING` finding — Guardian does not
retry to make the number look right.

## 5. What is deliberately NOT automated

**`~/.vscode-server` — 1.4 GB on this host.** Old editor server versions
accumulate and are genuinely stale. Reclaiming them means deleting
directories chosen by path, which needs a real delete primitive.

That is not a small addition. It would mean:

- a path allowlist with an anchored root, resolved and re-checked after
  symlink resolution;
- a denylist check on the resolved path, not the supplied one;
- proof that no running process holds the directory;
- a keep-newest rule so the active version is never a candidate;
- and a test suite that attacks all of the above.

Worth doing, and worth doing on its own, where it can be reviewed as the
security change it is rather than as a disk tidy-up.

**The journal — 411 MB.** Root-owned. Guardian is unprivileged and has no
sudo. `journalctl --vacuum-*` is an operator action, and `SystemMaxUse=` in
`journald.conf` is the right fix rather than a recurring cleanup.

**Snap cache, apt cache, `/var/log` archives, the GitHub runner's `_work`.**
All root-owned, all outside Guardian's reach by design. Listing them here is
deliberate: the reason they are not automated is a permission boundary that
should stay where it is.

**Docker images and volumes — 2.7 GB and 930 MB reclaimable.** Guardian
*reports* them under `disk_growth_sources` and will never remove them. An
image may be the only copy of something not in a registry; a volume is data by
definition. The 2026-09-13 cleanup took this host from 93 % to 60 % in
owner-gated steps with a verified R2 copy of everything removed first, and
that remains the standard for these two.

## 6. When Guardian reports disk pressure and can do nothing

This is the expected case at `WARNING`, and it is not a failure. The finding
names where the growth is, from `docker system df`, and the operator decides.

The runbook's disk section carries the standing constraints: no broad prune,
every candidate needs a verified copy first, and nothing is deleted because
it is merely large.

## 7. Changing this policy

Adding an action means adding a static entry to `ops/guardian/lib/actions.js`
with a precondition, a cooldown, a daily ceiling, a reversibility statement, a
protected-resource list and a verification. There is no runtime path.

Adding a **command** means adding an argv prefix to `ACTION_COMMANDS` in
`io.js`. That is the moment to ask whether the command can be made to touch
something it should not when given a different argument — because the
allowlist matches a prefix, and the arguments after it come from the action.
Every current entry either takes no target (`npm cache clean --force`), pins
its own filter (`docker builder prune --force --filter`), or has its target
checked against `PROTECTED` first (`systemctl --user restart`).

The CI workflow greps the observe-only modules for remediation primitives. A
PR that has to change that gate is a PR that is doing something worth reading
carefully.
