# ROOT CHROMIUM / noVNC REPAIR PLAN

**Target host:** Mythos VPS `51.68.226.211` (OVH, Ubuntu)
**Executor:** the **root** Claude session on the VPS (this document is the order).
**Plan authored:** owner Windows session, 2026-08-23. Nothing in this plan had been executed anywhere when it was written.
**Scope:** the remote graphical desktop stack only — X display, VNC server, `websockify`/noVNC on `127.0.0.1:6080`, window manager, and Chromium inside that desktop.

---

## 0. Hard guardrails — read before typing anything

These are refusals, not preferences. If a step appears to require one of these, **stop and report instead**.

1. **Do not touch production web serving.** No edits to `/etc/nginx/**`, no `systemctl restart nginx`, no certbot runs. `nginx -t` (read-only) is allowed only as a verification that you changed nothing.
2. **`status.mythosprod.xyz` is owner-controlled and PROTECTED.** Never redeploy, restart, or reconfigure anything serving it.
3. **Do not touch the deploy repo or its services.** `/home/deploy/projects/mythos-prod`, `mythos-os-console` (`127.0.0.1:8140`), `mythos-ai-executor` (`127.0.0.1:8130`), `mythos-git-push`, and the governance key are all out of scope. The desktop stack is independent of them.
4. **Never expose VNC or noVNC beyond loopback.** The correct listener is `127.0.0.1:6080` only. Do not bind `0.0.0.0`, do not open a firewall port, do not add an nginx vhost for noVNC. Access is via the owner's SSH tunnel (`-L 6081:127.0.0.1:6080`) and nothing else.
5. **No new users, no new SSH keys, no `authorized_keys` edits, no sshd config changes.**
6. **No password-free VNC.** If a VNC password file is missing, report it — do not start an open VNC server.
7. **No destructive deletes.** The only deletions permitted are the specific stale runtime artefacts named in §4 (X lock files, Chromium `Singleton*` files, dead sockets). Anything else: report, do not delete.
8. **No `apt upgrade`, no release upgrade, no snap refresh of unrelated packages.** A targeted `apt-get install` of a missing dependency named in §4 is permitted and must be reported.
9. **One change at a time, verify after each.** Do not batch fixes; the point of this plan is to know *which* fix worked.
10. **Everything you do goes in the report (§6)** — including anything you tried that failed.

---

## 1. Reference: what the stack is supposed to look like

Healthy end-to-end path:

```
Owner Windows PC
  └─ ssh -N -L 6081:127.0.0.1:6080 <user>@51.68.226.211
       └─ VPS 127.0.0.1:6080   websockify / noVNC  (HTTP + WS, loopback only)
            └─ VPS 127.0.0.1:590X   VNC server (x11vnc or Xtigervnc)
                 └─ X display :X    (Xvfb / Xtigervnc virtual framebuffer)
                      ├─ window manager (openbox / xfwm4 / fluxbox)
                      └─ Chromium window
```

Browser URL on the owner PC: `http://127.0.0.1:6081/vnc.html?autoconnect=true&resize=remote`

The four independent failure layers, in the order they must be tested:

| Layer | Symptom when it alone is broken |
|---|---|
| L1 X display | VNC may connect but everything downstream is dead; `xdpyinfo` fails |
| L2 VNC server | noVNC page loads, connection fails ("Failed to connect to server") |
| L3 websockify / noVNC | Tunnel connects but browser shows connection refused / no `vnc.html` |
| L4 WM / Chromium | Desktop appears but is grey/empty, or Chromium never appears or dies instantly |

---

## 2. Phase A — evidence collection (READ-ONLY; run all of it before any repair)

Run every command. Capture output verbatim. **Change nothing in this phase.**

```bash
# A1 — identity, uptime, resources
id; hostname; uptime
free -h
df -h / /tmp /var /dev/shm
dmesg -T 2>/dev/null | tail -40 | grep -iE 'oom|killed process' || echo "no OOM lines in tail"

# A2 — what is listening (the 6080 listener must be loopback-only)
ss -lntp | grep -E ':(6080|59[0-9][0-9]|60[0-9][0-9])' || echo "NO VNC/noVNC LISTENER"
ss -lntp | head -40

# A3 — processes of the stack
ps -eo pid,ppid,user,etime,rss,cmd --sort=-rss \
  | grep -iE 'websockify|novnc|x11vnc|Xtigervnc|Xvnc|Xvfb|openbox|xfwm|fluxbox|chrom' \
  | grep -v grep || echo "NO STACK PROCESSES"

# A4 — systemd units, system and per-user
systemctl list-units --all --no-pager | grep -iE 'vnc|novnc|websockify|xvfb|chrom' || echo "no system units matched"
ls -l /etc/systemd/system/ | grep -iE 'vnc|novnc|websockify|xvfb'
for u in root deploy ubuntu mythosadmin; do
  echo "--- user units: $u ---"
  systemctl --user -M "$u@" list-units --all --no-pager 2>/dev/null \
    | grep -iE 'vnc|novnc|websockify|xvfb|chrom' || echo "(no user manager / none matched)"
done

# A5 — installed pieces and where they live
command -v websockify x11vnc Xtigervnc Xvnc Xvfb openbox xfwm4 fluxbox chromium chromium-browser google-chrome 2>/dev/null
ls -ld /usr/share/novnc /opt/novnc /usr/share/webapps/novnc 2>/dev/null
snap list 2>/dev/null | grep -i chromium || echo "chromium not a snap"
dpkg -l 2>/dev/null | grep -iE 'novnc|websockify|x11vnc|tigervnc|xvfb|chromium' | awk '{print $1,$2,$3}'

# A6 — X displays and locks
ls -l /tmp/.X11-unix/ 2>/dev/null; ls -l /tmp/.X*-lock 2>/dev/null || echo "no X lock files"
ls -l /root/.vnc/ 2>/dev/null

# A7 — Chromium profile state (the root profile is the usual offender)
ls -la /root/.config/chromium/ 2>/dev/null | head -20
ls -l /root/.config/chromium/Singleton* 2>/dev/null || echo "no Singleton lock files"

# A8 — recent logs for the stack
journalctl --no-pager -n 120 -u 'x11vnc*' -u 'novnc*' -u 'websockify*' -u 'vncserver*' 2>/dev/null | tail -80
journalctl --no-pager --since '2 hours ago' 2>/dev/null | grep -iE 'vnc|websockify|chrom|Xvfb|segfault|oom' | tail -60
tail -40 /root/.vnc/*.log 2>/dev/null

# A9 — loopback reachability of noVNC (read-only probe)
curl -sS -o /dev/null -w 'novnc http_code=%{http_code}\n' --max-time 5 http://127.0.0.1:6080/vnc.html || echo "curl to 6080 FAILED"
```

**Checkpoint.** From A1–A9, write one sentence naming the *lowest broken layer* (L1→L4). Repair bottom-up: a Chromium fix applied while the X display is dead proves nothing.

Check A1 first for the two failures that masquerade as everything else:

- **Disk full** on `/`, `/tmp`, or `/var` → X, VNC, and Chromium all fail in confusing ways. Fix disk first (§4.0).
- **OOM kill** in `dmesg` → Chromium was killed, not misconfigured. That changes the fix (§4.5 g).

---

## 3. Phase B — triage table

| Evidence | Diagnosis | Go to |
|---|---|---|
| `df -h` shows ≥95% on `/`, `/var`, or `/tmp` | Disk exhaustion | §4.0 |
| No listener on 6080 at all (A2) | websockify/noVNC down | §4.3 |
| Listener on 6080 bound to `0.0.0.0` | **Security defect** — loopback violation | §4.3 + report as incident |
| 6080 listens, `curl` 200, but noVNC cannot connect | VNC server down or wrong port | §4.2 |
| VNC connects, screen grey/empty, no windows | window manager missing/dead | §4.4 |
| VNC connects, desktop present, no Chromium | Chromium not started or dying | §4.5 |
| Chromium starts then exits immediately as root | root sandbox / profile lock / `/dev/shm` | §4.5 |
| No `Xtigervnc`/`Xvfb` in A3 but X lock files present | stale X lock blocking start | §4.1 |
| `dmesg` shows OOM killing chrome | memory pressure | §4.5 g |
| Nothing of the stack is installed (A5 mostly empty) | stack was removed, not broken | **STOP — report.** Reinstalling a desktop stack on a production host is an owner decision. |

---

## 4. Phase C — repairs, bottom layer first

For every subsection: run the fix, immediately run its verify command, and move on only if it passed. Record both.

### 4.0 Disk exhaustion (only if A1 showed it)

```bash
du -xh --max-depth=1 / 2>/dev/null | sort -h | tail -15
journalctl --disk-usage
```

Permitted remedies, in this order, each reported:

```bash
journalctl --vacuum-time=7d
apt-get clean
find /tmp -type f -atime +7 -user root -delete
```

**Not permitted:** deleting anything under `/home/deploy`, `/var/www`, `/etc`, any database, or any log the owner has not agreed to lose.
Verify: `df -h /` shows headroom (target ≥2 GB free).

### 4.1 L1 — X display

Identify the intended display number from A6 (`/tmp/.X11-unix/X1` ⇒ `:1`).

Stale lock with no live process (confirm from A3 that no `Xtigervnc`/`Xvfb` is running for it):

```bash
DISP=1                                        # set from evidence, do not assume
fuser -v /tmp/.X${DISP}-lock 2>&1 || true     # must show NO process before deleting
rm -f /tmp/.X${DISP}-lock /tmp/.X11-unix/X${DISP}
```

Start the display via its unit if one exists (preferred):

```bash
systemctl start <the-unit-found-in-A4>
```

If there is no unit, start it the way this host already does it — match the command line recorded in A3/A8. Do not invent new flags.

Verify:

```bash
DISPLAY=:${DISP} xdpyinfo | head -5
```

### 4.2 L2 — VNC server

If a unit exists:

```bash
systemctl status <vnc-unit> --no-pager
systemctl restart <vnc-unit>
systemctl status <vnc-unit> --no-pager | head -15
```

If `x11vnc` runs ad-hoc, restart it against the existing display, mirroring the flags already in use (A3/A8). The non-negotiable parts are `-localhost` and an existing password file:

```bash
# illustrative — reuse the host's real invocation; keep -localhost and -rfbauth
x11vnc -display :1 -localhost -rfbauth /root/.vnc/passwd -forever -shared -bg -o /root/.vnc/x11vnc.log
```

If `/root/.vnc/passwd` is missing: **stop and report** (guardrail 6).

Verify:

```bash
ss -lntp | grep -E ':59[0-9][0-9]'      # must show 127.0.0.1, never 0.0.0.0
timeout 5 bash -c 'cat < /dev/null > /dev/tcp/127.0.0.1/5900' && echo "VNC port reachable"
```

### 4.3 L3 — websockify / noVNC

```bash
systemctl status <novnc-or-websockify-unit> --no-pager | head -20
systemctl restart <novnc-or-websockify-unit>
```

If it runs ad-hoc, restart it matching the recorded invocation; the shape must be:

```bash
# illustrative — websockify must listen on loopback only
websockify --web=/usr/share/novnc 127.0.0.1:6080 127.0.0.1:5900
```

If A2 showed it bound to `0.0.0.0`, rebind to `127.0.0.1` (edit the unit's `ExecStart` or the launch script; a `systemctl daemon-reload` is expected) and record it as a **security finding** — it means the desktop was reachable from the internet.

Verify:

```bash
ss -lntp | grep ':6080'                                                    # 127.0.0.1:6080 only
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:6080/vnc.html   # expect 200
```

### 4.4 L4a — window manager (grey/empty desktop)

```bash
pgrep -a openbox || pgrep -a xfwm4 || pgrep -a fluxbox || echo "NO WM RUNNING"
DISPLAY=:1 openbox --replace &      # or the WM this host actually uses (A5)
sleep 2; pgrep -a openbox
```

If no WM is installed at all, a targeted install is permitted and must be reported:

```bash
apt-get install -y openbox
```

Verify: on reconnect the desktop responds to a right-click menu and new windows get decorations.

### 4.5 L4b — Chromium

Work through these in order; stop at the first that fixes it.

**(a) Stale singleton lock** — the classic "Chromium won't start after a crash":

```bash
pgrep -a chrom || echo "no chromium running"      # must be empty before removing locks
rm -f /root/.config/chromium/Singleton{Lock,Socket,Cookie}
```

**(b) Zombie/orphaned processes holding the profile:**

```bash
pkill -TERM -f chromium; sleep 3; pgrep -a chrom || echo "clean"
# only if still stuck:
pkill -KILL -f chromium
```

**(c) Launch correctly for a root X session.** Chromium refuses to run as root without an explicit flag, and the default `/dev/shm` sizing breaks it:

```bash
DISPLAY=:1 chromium \
  --no-sandbox \
  --disable-gpu \
  --disable-dev-shm-usage \
  --user-data-dir=/root/.config/chromium \
  --start-maximized \
  about:blank >/tmp/chromium-repair.log 2>&1 &
sleep 5; pgrep -a chrom | head; tail -20 /tmp/chromium-repair.log
```

On `--no-sandbox`: it is required to run Chromium as root and it removes a real security layer. It is acceptable **only** because this desktop is loopback-only and reached through an SSH tunnel. Never pair it with exposing 6080, and state it in the report. If the host has a dedicated non-root desktop user, running Chromium as that user with the sandbox intact is strictly better — recommend it in §6; do not create such a user yourself (guardrail 5).

**(d) `/dev/shm` too small** (A1). If `/dev/shm` is under ~256 MB, `--disable-dev-shm-usage` above is the mitigation. Do not remount `/dev/shm` or edit `/etc/fstab` — report it.

**(e) Missing shared libraries:**

```bash
ldd "$(command -v chromium || command -v chromium-browser)" 2>/dev/null | grep 'not found'
```

Install only the specific missing packages, and report each.

**(f) Snap Chromium.** If A5 showed Chromium is a snap, snap confinement plus a root X session is a known-bad combination — the snap cannot always see root's X authority. Symptom: "cannot open display" despite a healthy `:1`. Try:

```bash
XAUTHORITY=/root/.Xauthority DISPLAY=:1 chromium --no-sandbox about:blank
```

If it still fails, **report**. Switching Chromium from snap to deb is an owner decision, not a repair.

**(g) Memory.** If `dmesg` showed an OOM kill, Chromium is not misconfigured — the box is out of RAM. Report free/total and what else was resident. Do not add swap or change limits without owner approval.

---

## 5. Phase D — end-to-end verification (all must pass)

```bash
# 1. X alive
DISPLAY=:1 xdpyinfo | head -3
# 2. window manager alive
pgrep -a openbox || pgrep -a xfwm4 || pgrep -a fluxbox
# 3. Chromium alive with a window
pgrep -a chrom | head -3
DISPLAY=:1 xdotool search --onlyvisible --class chrom 2>/dev/null | head -3 || echo "(xdotool absent — verify visually)"
# 4. VNC loopback-only
ss -lntp | grep -E ':59[0-9][0-9]'
# 5. noVNC loopback-only and serving
ss -lntp | grep ':6080'
curl -sS -o /dev/null -w 'vnc.html=%{http_code}\n' http://127.0.0.1:6080/vnc.html
# 6. nothing production was touched
systemctl is-active nginx
ls -l --time-style=long-iso /etc/nginx/sites-available/ | head -20   # mtimes must predate this session
```

Owner-side confirmation (run by the owner on the Windows PC, not by you): `Ouvrir_noVNC_Quotidien_DEPLOY.bat` → `http://127.0.0.1:6081/vnc.html?autoconnect=true&resize=remote` shows the desktop with a live Chromium window.

**Persistence check:** if the fix was manual rather than a unit restart, state plainly that it will not survive a reboot and recommend the unit change — do not write new systemd units under this order.

---

## 6. Phase E — required report (post back to the owner session)

```
ROOT CHROMIUM/noVNC REPAIR — REPORT
Date/time (UTC):
Host / user:

1.  LOWEST BROKEN LAYER FOUND: (L1 X | L2 VNC | L3 websockify | L4 WM/Chromium | none)
2.  ROOT CAUSE, one sentence:
3.  EVIDENCE (the 3–6 decisive lines from Phase A):
4.  CHANGES MADE — exhaustive, one line each (command → result), or "none":
5.  FILES CREATED, MODIFIED, OR DELETED — exhaustive:
6.  PACKAGES INSTALLED — exhaustive:
7.  SERVICES RESTARTED — exhaustive:
8.  VERIFICATION (§5 items 1–6, pass/fail each):
9.  LOOPBACK-ONLY CONFIRMED (ss output for 5900 and 6080):
10. PRODUCTION UNTOUCHED CONFIRMED (nginx active; sites-available mtimes unchanged; deploy repo untouched):
11. SECURITY FINDINGS (0.0.0.0 binding? --no-sandbox in use? missing VNC password?):
12. SURVIVES REBOOT? (yes / no — and why)
13. STILL OPEN / OWNER DECISIONS NEEDED:
```

**Stop-and-ask conditions** — halt and report rather than improvising if: the stack is not installed; the VNC password file is missing; the fix would require touching nginx, the deploy repo, sshd, users, or keys; the host is out of memory or disk in a way §4.0 cannot safely resolve; or two full passes of §4 leave the same layer broken.
