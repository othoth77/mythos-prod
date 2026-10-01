# OOM kill priority — the deploy user manager

**Owner action. Not installed by any agent — the permission layer refuses
writes under `/etc/systemd` from a session, correctly.**

## The gap

The 2026-09-01 remediation put `OOMScoreAdjust=0` on the eight production
services under `deploy` (`~deploy/.config/systemd/user/*.service.d/oom.conf`).
It did not touch the **manager** those services hang from: `user@1001.service`
keeps upstream's `OOMScoreAdjust=100`, which adds roughly 10 % of host RAM to
its badness. On 2026-09-01 22:16:42 UTC the kernel therefore chose the 3 MB
manager over 250 MB agent sessions at 0, and systemd SIGKILLed every unit
below it. `user@.service` has `Restart=no`; production stayed down until
`systemctl start user@1001.service` was run by hand at 23:05.

## Install

```bash
sudo install -d -m 0755 /etc/systemd/system/user@1001.service.d
sudo install -m 0644 ops/oom/user@1001.service.d/oom.conf /etc/systemd/system/user@1001.service.d/oom.conf
sudo systemctl daemon-reload
systemctl show user@1001.service -p OOMScoreAdjust     # expect 0
```

The running manager picks the value up on its next start; no restart is
required to install it, and none should be forced while production is up.

## Diagnose a recurrence in ten seconds

```bash
systemctl is-active user@1001.service          # failed ⇒ everything below is down
ss -ltn | grep -E ':(3021|8130|8150|3001)\b'    # OTHMODE, executor, knowledge, idauto
journalctl -u user@1001.service -n 20 --no-pager | grep -i oom
```

Recovery is `systemctl start user@1001.service`. Nothing else is needed:
`default.target.wants` restarts all eight services.

## What this does not fix

The pressure itself: on 2026-09-01, eighteen root agent sessions held ~3.5 GB
in one session scope with swap at 100 %. See
`/root/mythos-oom-remediation-20260901/README.md` and the memory telemetry at
`/opt/mythos-memwatch/memwatch.log`.

## Memory ceilings — `ops/oom/memory/` (2026-09-18)

`oom.conf` decides **who** the kernel kills. The `memory.conf` drop-ins in
`ops/oom/memory/<unit>.service.d/` bound **how much** each deploy Node unit
may take, so a leak ends as a cgroup-local OOM (plus `Restart=on-failure`)
instead of host-wide pressure. They sit beside `oom.conf` in
`~deploy/.config/systemd/user/<unit>.service.d/` and are INSTALLED + LIVE
since 2026-09-18.

| unit | MemoryHigh | MemoryMax | Node old-space |
|---|---|---|---|
| idauto-api, mythos-command-center, mythos-os-console, ssangyong-storefront | 192M | 256M | 128 MB |
| oth-knowledge-http | 256M | 384M | 256 MB |
| mythos-ai-executor | 1536M | 2G | — (inherited by its `claude -p` children) |
| erp-api / mythos-wp / piece-autos | (unit file) | 384M / 256M / 300M (unit file) | 256 / 128 / 160 MB |

Old-space is sized so V8's total heap (old-space + ~48 MB young generation,
measured: 128 → 176 MB, 160 → 208 MB, 256 → 304 MB) plus native memory stays
under `MemoryMax`, so V8 aborts with a clean heap-OOM before the cgroup
SIGKILLs. New Node units must ship both `oom.conf` and `memory.conf`.

Install (as deploy): copy the directory, `systemctl --user daemon-reload`
(applies the cgroup caps live), then restart the unit (applies NODE_OPTIONS).
Rollback: remove the file, daemon-reload, restart.

Full record: `docs/audits/VPS_MEMORY_PROTECTION_2026-09-18.md`.
