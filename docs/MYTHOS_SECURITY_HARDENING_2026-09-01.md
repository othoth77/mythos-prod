# MYTHOS security baseline — 2026-09-01 hardening pass

Every item below was inspected first, changed by the smallest safe edit,
validated, tested against production behaviour, and recorded with rollback.
Nothing was changed blindly and no service was restarted unnecessarily.

## 1. Coolify admin UI publicly reachable over plaintext — FIXED

### What was exposed

`coolify` published `0.0.0.0:8000 -> 8080/tcp`. Docker installs its DNAT and
FORWARD rules **ahead of ufw**, and the `DOCKER-USER` chain — the one chain
Docker guarantees it will not overwrite — was **empty**. So the published port
was reachable from the internet even though `8000/tcp` is **not** in ufw's
allow list. ufw's own rules said the port should be closed; Docker overrode
that intent silently.

Evidence, measured rather than assumed. From a container on the bridge network
(the same FORWARD path external traffic takes):

```
before:  container -> 51.68.226.211:8000/api/health = 200
```

An unauthenticated HTTP 200 from the Coolify admin surface, over cleartext.

`iptables -t nat -L DOCKER` showed the asymmetry precisely — almost every other
published service DNATs only for destination `127.0.0.1` (postgres 5432, n8n
5678, OmniRoute 20128, jellyfin 8096), while `8000`, `6001` and `6002` DNAT for
`0.0.0.0/0`.

### Why the fix is safe

`panel.mythosprod.xyz` **already** proxies `127.0.0.1:8000` with a Let's Encrypt
certificate. The raw public bind was therefore redundant *and* a plaintext
bypass of that TLS front. Closing it removes no access that MYTHOS needs.

Host-originated traffic (nginx -> `127.0.0.1:8000`) is routed through `OUTPUT`
and **never traverses `FORWARD`**, so anything arriving in `DOCKER-USER` for
original destination port 8000 is by definition not the host. Dropping it
cannot affect the TLS front.

### The change

`/usr/local/sbin/mythos-docker-firewall` (root, 0755), run by
`mythos-docker-firewall.service` (`After=docker.service`, enabled). Idempotent —
it checks with `iptables -C` before inserting.

```
iptables -I DOCKER-USER 1 -p tcp -m conntrack --ctstate NEW \
  --ctorigdstport 8000 -j DROP
```

Matching on `--ctorigdstport` rather than the container IP means the rule keeps
working when Docker reassigns `10.0.1.5`.

### Validation

```
after:   container -> 51.68.226.211:8000/api/health = 000   (blocked)
         curl 127.0.0.1:8000/api/health              = 200   (nginx upstream OK)
         curl https://panel.mythosprod.xyz/api/health = 200   (owner access OK)
         docker inspect coolify -> running / healthy
```

Zero downtime: **no container was restarted.** Rollback:
`iptables-restore < /var/log/mythos-mission/iptables-before-20260901.rules`,
or `systemctl disable --now mythos-docker-firewall`.

## 2. Private conversation archive world-readable in /tmp — FIXED

`/tmp/oth.db` — the OTH.DB archive, **1306 conversations** of private content
and the irreplaceable source for the remaining extractions — was `root:root
0644`: world-readable on a host that currently has several concurrent agent
sessions, and on a path that does not survive a reboot.

- Preserved to `/home/ubuntu/othk-archive/oth.db`, `ubuntu:ubuntu 0600`,
  verified **byte-identical** (`sha256 0dea76b4f2804abb…`) and
  `pragma integrity_check = ok`, 1306 conversations readable.
- The `/tmp` original was **not deleted** (irreversible, and another session may
  reference it) but its mode was reduced `0644 -> 0640 root:ubuntu`, removing
  world read while keeping the extraction identity's access.

Rollback: `chmod 0644 /tmp/oth.db && chgrp root /tmp/oth.db`.

## 3. PostgreSQL `trust` — INSPECTED, deliberately NOT changed

`idauto-postgres` `pg_hba.conf` carries the stock postgres-image defaults:

```
local   all all                  trust
host    all all 127.0.0.1/32     trust
host    all all ::1/128          trust
host    all all all              scram-sha-256
```

The `trust` lines look alarming but scope to **the container's own loopback**,
not the host's. Verified empirically rather than argued:

```
host -> 127.0.0.1:5432 (published)      -> "no password supplied"  (scram applies)
another container -> 10.0.4.1:5432      -> timeout (not reachable at all)
```

The port is published on host loopback only, so external connections match the
final `scram-sha-256` rule.

**It is also load-bearing.** `ops/backup/mythos-backup-capture.sh` runs
`docker exec … pg_dump -U "$POSTGRES_USER"` and `psql -U "$POSTGRES_USER"`
**in-container with no `PGPASSWORD`**. Requiring a password on the local socket
would break the production backup pipeline. Changing it would have been exactly
the blind security change that does more harm than the risk it removes.

Verdict: **not an exposure.** Left as is, with the reason recorded.

## 4. Docker socket — INSPECTED, already sound

- `getent group docker` -> **empty**; `deploy` is not a member.
- No Docker TCP socket: nothing listening on 2375/2376.
- `/var/run/docker.sock` is `root:docker 0660`.
- Exactly one container mounts it: `coolify-sentinel`, Coolify's monitoring
  agent, which requires it to function.

No change. Removing sentinel's mount would break Coolify.

## 5. Remaining exposure, recorded not silently accepted

`coolify-realtime` publishes `0.0.0.0:6001-6002`, reachable externally over
**plaintext**:

```
6001 -> 200      6002 -> 404 (responding)
```

Unlike 8000, these **are** explicitly allowed in ufw (`6001/tcp`, `6002/tcp`,
`Anywhere`), so this is deliberate operator configuration, and the Coolify UI
opens these websockets directly from the browser. Binding them to loopback
without first proxying them through nginx **would break the Coolify UI**, so it
was not done as part of a minimal-change pass.

Recommended follow-up (needs a Coolify config change and a UI test, not a
firewall edit): proxy 6001/6002 through `panel.mythosprod.xyz` with TLS and
rebind them to `127.0.0.1`.

`cupsd` listens on `0.0.0.0:631` but is a **host** process, so ufw's
`default deny incoming` does apply — verified blocked (`631 -> 000`).

## 6. Privilege note — `deploy` sudo and the governance key

`deploy` sudo scope is narrow: `nginx -t`, `systemctl reload nginx`, `certbot`.

`governance-verify.js` states its own residual risk: passwordless sudo held by
the mission identity defeats the key isolation. `certbot` accepts
`--deploy-hook`, which runs an arbitrary command as root — so the current scope
is, in principle, a path to `/etc/mythos/governance.key`.

**Not changed in this pass**: narrowing it risks breaking certificate renewal
for every vhost on the box, which is a production-availability decision, not a
mechanical fix. Recorded here so it is a known, owner-visible condition rather
than an unexamined one.
