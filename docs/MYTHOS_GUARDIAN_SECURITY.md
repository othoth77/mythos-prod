# MYTHOS Guardian — security model

What stops Guardian doing damage, stated as measurements rather than
intentions. Every claim below has the command that produced it, so it can be
re-checked when systemd, the host or Guardian changes.

Measured 2026-09-17 on vps-4722f0a9, systemd 259, Guardian 0.1.0.

---

## 1. The threat model

Guardian runs unattended every two minutes as `deploy`, on a host carrying the
ERP, three production databases, the backup system and several live sites. It
reads process tables, systemd state, Docker state and several JSON files.

The things that would actually hurt, in order:

1. Guardian writes something outside its own state — a production file, a
   config, a backup record.
2. Guardian executes something — a restart, a kill, a prune, a delete.
3. Guardian is *induced* to do either by data it reads, since almost all of
   its input is attacker-influenced in principle (file contents, process
   command lines, container names, systemd output).
4. Guardian leaks what it reads.
5. Guardian becomes a load on a host that is already short of memory.

This document covers 1–4. Load is `D12` in the decisions document.

## 2. What is actually enforced

| # | Control | Enforced by | Measured? |
|---|---|---|---|
| 1 | No remediation code exists | absence + a CI grep gate | yes |
| 2 | Only read-only commands can run | `allowedCommand()` argv allowlist | yes |
| 3 | No write outside Guardian's state dir | `io.assertOwnState()` throws | yes |
| 4 | Ordinary file permissions | kernel DAC, `deploy` is unprivileged | yes |
| — | ~~Unit sandbox~~ | **inert in a user manager — see §5** | yes, and it fails |

### 2.1 No remediation code

`fs` and `child_process` are required by exactly one file, `ops/guardian/lib/io.js`.
Every other module takes the injected `io` or is pure; `levels.js`,
`classify.js` and `report.js` require nothing outside their own directory.

```bash
for f in ops/guardian/lib/*.js; do
  printf '%-16s %s\n' "$(basename "$f")" \
    "$(grep -oE "require\('(fs|child_process)'\)" "$f" | tr '\n' ' ')"
done
```

Expected: only `io.js` prints anything.

This is the property the whole design rests on — the write boundary and the
command allowlist are only boundaries while there is one way out of the
module. It is asserted by `tests/guardian-test.js` §3 and by the CI gate in
`.github/workflows/guardian-suite.yml`.

### 2.2 The command allowlist

`READ_COMMANDS` holds seven exact argv prefixes:

```
systemctl show          systemctl is-active      systemctl list-timers
systemctl --user show   systemctl --user is-active
docker inspect          docker system df
```

An argv that does not match a prefix **never reaches `spawnSync`**. It returns
`{refused: true, status: null}` before exec.

```bash
mythos-guardian selftest        # check: command-allowlist-enforced
```

Measured: `spawn(["systemctl","restart","nginx"])` → `refused before exec`.
The suite additionally rejects `systemctl stop`, `systemctl kill`,
`docker system prune`, `docker rm`, `docker volume prune`, `rm -rf /`,
`kill -9 1`, `pkill`, `git reset --hard` and `systemctl daemon-reload`.

Because matching is on an exact argv **prefix array** and never on a string,
there is no shell, no interpolation and no quoting to get wrong. Guardian
never builds a command from input.

### 2.3 The write boundary

Every write goes through `io.assertOwnState()`, which resolves the path and
throws unless it is the state directory or beneath it. It is not a convention
and not a check the caller can skip — the write helpers call it first and
return `false` when it throws.

`tests/guardian-test.js` §3 asserts refusal by name for:

```
/etc/passwd
<state>/../escape
/var/lib/mythos/pressure/resource-pressure.json
/home/deploy/projects/mythos-prod/ops/guardian/lib/engine.js
/home/deploy/mythos-backups/health/backup-health-db.json
/home/deploy/.ssh/id_ed25519
/home/deploy/.config/systemd/user/mythos-guardian.timer
/home/deploy/mythos-ai-executor/orchestration/resource-guard.json
/var/www/status.mythosprod.xyz/data/live-status.json
/home/deploy/.local/state/mythos-guardian-other/state.json
```

Those are chosen deliberately: they are the paths `deploy` *can* write and the
unit sandbox does *not* protect (§5), so this function is the only thing
standing between Guardian and them.

There is also no delete primitive at all. `io` exposes no `unlink`, `rm`,
`rmdir`, `chmod` or `chown`. The three `unlinkSync` calls inside `io.js` are
the atomic-write temp file and the lock sentinel, both derived from an
already-asserted path. Log rotation drops its oldest generation by *renaming
over it*, because adding a delete primitive for log rotation would have been a
poor trade.

### 2.4 Input is data, never instruction

Guardian parses JSON, `/proc` files, `systemctl show` output and
`docker inspect` output. None of it is evaluated, none of it becomes part of a
command, and none of it selects a code path by name.

- Levels from the Resource Guard publication are validated against a fixed
  list; anything else is `unknown_level`.
- The publication is opened with a size cap and must be a regular file.
- `readFileTail` reads a bounded tail and **refuses a symlink** (`O_NOFOLLOW`),
  so a planted symlink cannot redirect a read. The pre-Option-C session-guard
  runner *did* follow symlinks; that was fixed in #286 and the same discipline
  is applied here.
- Service and container identifiers come from the configuration, which is
  validated against a strict character set, never from the data.
- Configuration overrides that fail validation are **ignored**, not merged:
  Guardian keeps its built-in defaults and reports the rejection. A malicious
  or broken config cannot widen what Guardian does.

### 2.5 Disclosure

Guardian's report names running processes, unit states and paths. The state
directory is `0700`. The report is not published anywhere; the Status Center
probe reads it locally and republishes only a summary (Guardian state, host
level, domain count, report age) — no process names, no command lines.

## 3. Privilege

Guardian runs as `deploy` (uid 1001). Not root, and `install-guardian.sh`
refuses to run as root.

Everything it reads is either world-readable (`/proc`, the Option C
publication, the Status Center output) or already owned by `deploy` (the
backup health records, the executor state). Root would buy nothing and widen
the blast radius of a component whose entire job is to read.

This is the same principle that produced Option C (#286): rather than widening
the root session guard's `CAP_KILL`-only sandbox to read the executor's
private state, the executor publishes a two-field file. Neither component
gained access; a narrow explicit channel was created instead.

```bash
# the session guard still cannot read what it should not:
setpriv --bounding-set=-all,+kill --inh-caps=-all --reuid=0 --regid=0 \
        --clear-groups head -c1 /home/deploy/mythos-ai-executor/orchestration/resource-guard.json
# -> Permission denied  (correct)
setpriv --bounding-set=-all,+kill --inh-caps=-all --reuid=0 --regid=0 \
        --clear-groups head -c1 /var/lib/mythos/pressure/resource-pressure.json
# -> readable  (intended)
```

## 4. Denial of service against Guardian itself

- **Bounded reads.** The memwatch log is read with `readFileTail` at 4 KiB, not
  slurped. The publication is capped. `spawn` has a 15–20 s timeout and a
  4 MiB output cap.
- **Bounded work.** Collection stops at a 45 s wall-clock budget; unreached
  domains become `unknown`, which means partial host level and degraded
  Guardian rather than a tick that never returns. See `D13`.
- **Bounded state.** Rotation keeps `keep` generations of at most `max_bytes`.
- **Bounded memory.** `MemoryMax=192M`, `OOMScoreAdjust=200` — Guardian is
  chosen by the OOM killer before any production service.
- **Mutual exclusion.** One lock; a live tick that finds it held skips. A dry
  run never takes it, so investigating an incident cannot block the tick
  recording it.
- **Crash isolation.** Every collector is wrapped; a throwing collector becomes
  an `unknown` domain and a finding. `tests/guardian-test.js` §11 drives ticks
  with an io whose reads throw, whose `readdir` throws, whose `statfs` throws,
  whose `spawn` throws, times out, or returns garbage.

## 5. The control that does not work

**`ProtectSystem=strict`, `ProtectHome`, `ReadOnlyPaths` and `ReadWritePaths`
are inert in this systemd user manager.** The unit declares them; they are not
applied.

Reproduce:

```bash
export XDG_RUNTIME_DIR=/run/user/1001

# A user unit with ProtectSystem=strict writes a path it should not:
systemd-run --user --wait --collect --quiet -p ProtectSystem=strict \
  /bin/bash -c 'touch /var/lib/mythos/guardian/PROBE'
ls /var/lib/mythos/guardian/PROBE     # -> exists

# The mount table inside the sandbox is identical to the host's:
systemd-run --user --wait --collect --quiet -p ProtectSystem=strict \
  -p StandardOutput=file:/tmp/p1 /bin/bash -c 'wc -l < /proc/self/mountinfo'
wc -l < /proc/self/mountinfo
cat /tmp/p1                            # -> same number (90 on this host)

# ProtectHome does not protect the user's own home either:
systemd-run --user --wait --collect --quiet \
  -p ProtectSystem=strict -p ProtectHome=read-only \
  /bin/bash -c 'touch /home/deploy/PROBE'
ls /home/deploy/PROBE                  # -> exists
```

**Why.** Every one of those directives is implemented with mount namespaces. A
systemd *user* manager on this host cannot create one, so it applies none of
them — and reports nothing. `systemctl --user show mythos-guardian.service -p
ProtectSystem` faithfully prints `strict` on a unit where the directive has no
effect.

**Why it matters.** The paths the sandbox was supposed to protect are exactly
the ones worth protecting: the production checkout, `~deploy/mythos-backups`,
`~/.ssh`, the executor's state, the Status Center output. All are writable by
`deploy` and none are protected by the unit. Only §2.3 stands between Guardian
and them, which is why §2.3 is tested against those paths by name.

**Why the directives are kept.** They cost nothing, they are correct if
Guardian is ever run as a system unit, and removing them would make a future
system-unit deployment silently less safe. They are documented here as
declared-but-inert rather than deleted.

**What was removed.** `ProtectKernelTunables`, `ProtectKernelModules` and
`ProtectControlGroups` each imply a `CapabilityBoundingSet` change, which an
unprivileged user manager cannot perform. With them set the unit failed at
step `CAPABILITIES` with status `218` before `ExecStart` was reached — the
service never ran at all. They were also pointless: a uid-1001 process has no
capabilities to drop.

## 6. If Guardian is ever given remediation

Not in this version. When it is, the controls above define what has to change
and what must not:

- The `READ_COMMANDS` allowlist must not be widened. A mutating action belongs
  in a **separate**, separately-gated allowlist with its own per-action
  preconditions, protected-resource checks, cooldowns and audit record.
- `io.assertOwnState()` must keep covering every write that is not an explicit,
  individually-reviewed action.
- The CI gate greps the observe-only modules for remediation primitives. It
  should fail, loudly, and a PR that changes it should say why.
- Because the unit sandbox is inert (§5), a remediation build gets **no**
  kernel backstop on this host. Every guard must be in code, and a system-unit
  deployment should be reconsidered at that point — there, the sandbox would
  actually work.

## 7. Re-running the whole security check

```bash
mythos-guardian selftest         # 9 checks, on the host
node tests/guardian-test.js      # §3 is the boundary; §11 is failure safety
mythos-guardian validate         # effective policy, override rejection
```

The CI workflow runs all three plus the remediation-primitive grep on every PR
touching `ops/guardian/**`.
