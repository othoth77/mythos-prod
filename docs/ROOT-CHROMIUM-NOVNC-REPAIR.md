# ROOT CHROME / noVNC REPAIR RUNBOOK

**Target host:** Mythos VPS `51.68.226.211` (OVH, Ubuntu)
**Executor:** the **root** Claude session on the VPS (this document is the order).
**Originally authored:** owner Windows session, 2026-08-23, before anything had run anywhere.
**Reconciled with the real environment:** 2026-08-24, owner Windows session. Nothing was executed on the VPS to produce this revision.
**Scope:** the remote graphical desktop stack only — X display `:5`, the VNC server behind it, `websockify`/noVNC on loopback, the XFCE session, and **Google Chrome** inside that desktop.

---

## 0. Status of this revision — read first

The first version of this runbook was written blind and assumed a generic **Chromium on `:1` with a `/root/.config/chromium` profile**. That is **not** this host. The environment below is the confirmed one and supersedes every earlier reference:

| Item | Earlier assumption (wrong) | **Actual environment** |
|---|---|---|
| Browser | Chromium (deb or snap) | **Google Chrome Stable**, installed from the official `.deb` (`/usr/bin/google-chrome-stable`) |
| Profile dir | `/root/.config/chromium` | **`/root/.mythos-browser`** |
| X display | `:1` | **`:5`** |
| Desktop | openbox / fluxbox / xfwm4 (unknown) | **XFCE** (`xfce4`, `xfce4-goodies`, `xfwm4`, `dbus-x11`) |
| Access | noVNC on `127.0.0.1:6080`, tunnel `6081` | **noVNC on loopback; the root desktop is reached through `VPS-Root-Tunnel.bat`: `-L 6082:127.0.0.1:6082`** (the `deploy` desktop uses `6081` — a different desktop; do not cross them) |
| Launcher | ad-hoc `chromium` command line | **`/usr/local/bin/mythos-browser`** (+ `mythos-browser.desktop`) |

**Still outstanding for the next revision:** the root session's own report, `/root/mythos-root-chromium-novnc-REPORT.txt`, has **not** been folded into this document — it is not readable from the owner PC (root SSH rejects the owner's keys with `Permission denied (publickey)`), and nothing was run on the VPS to retrieve it. Everything below is therefore written as *instructions to verify and repair*, never as a claim about what already happened. Do not read any section as a record of completed work.

Known-good local artefacts that came out of the root session and match the table above (kept on the owner PC, summarised here so the root session can compare them against what is actually installed):

- `install-root-gui-chrome.sh` — installs XFCE + X11 helpers + Chrome dependencies, then Google Chrome Stable from `dl.google.com`, and writes an early launcher `/usr/local/bin/mythos-chrome` targeting `DISPLAY=:5`, `XAUTHORITY=/root/.Xauthority`.
- `mythos-vnc-browser-repair.sh` — the later, fuller version: adds `xdotool`/`wmctrl`, wraps Chrome in `dbus-run-session`, adds `--disable-software-rasterizer` and `--disable-features=UseOzonePlatform`, and installs the launcher as **`/usr/local/bin/mythos-browser`**.

Both scripts as distributed used a **`/tmp/mythos-chrome`** profile. The live profile is **`/root/.mythos-browser`**. If the on-host launcher still points at `/tmp/mythos-chrome`, that mismatch is itself a defect: a `/tmp` profile can be reaped and does not survive a reboot. Correcting it is permitted and must be reported (§4.5 h).

---

## 1. Hard guardrails — refusals, not preferences

If a step appears to require one of these, **stop and report instead**.

1. **Do not touch production web serving.** No edits to `/etc/nginx/**`, no `systemctl restart nginx`, no certbot runs. `nginx -t` (read-only) is allowed only as proof you changed nothing.
2. **`status.mythosprod.xyz` is owner-controlled and PROTECTED.** Never redeploy, restart, or reconfigure anything serving it.
3. **Do not touch the deploy repo or its services.** `/home/deploy/projects/mythos-prod`, `mythos-os-console` (`127.0.0.1:8140`), `mythos-ai-executor` (`127.0.0.1:8130`), `mythos-git-push`, and the governance key are out of scope. So is the **`deploy` user's own desktop on `6081`** — this order concerns the **root desktop on `6082`** only.
4. **Never expose VNC or noVNC beyond loopback.** The correct listeners are `127.0.0.1` only. Do not bind `0.0.0.0`, do not open a firewall port, do not add an nginx vhost for noVNC. Access is the owner's SSH tunnel and nothing else.
5. **No new users, no new SSH keys, no `authorized_keys` edits, no sshd config changes.**
6. **No password-free VNC.** If the VNC password file is missing, report it — do not start an open VNC server.
7. **No destructive deletes.** The only deletions permitted are the specific stale runtime artefacts named in §4 (X lock files, Chrome `Singleton*` files, dead sockets). Anything else: report, do not delete.
8. **No `apt upgrade`, no release upgrade, no snap refresh.** A targeted `apt-get install` of a dependency named in §4 is permitted and must be reported.
9. **One change at a time, verify after each.** The point of this order is to know *which* fix worked.
10. **Everything you do goes in the report (§7)** — including anything you tried that failed.
11. **Never edit this file from the VPS.** The runbook is owner-maintained in `othoth77/mythos-prod`. Report upward; do not push.

---

## 2. Reference: what the stack is supposed to look like

```
Owner Windows PC
  └─ VPS-Root-Tunnel.bat:  ssh -N -L 6082:127.0.0.1:6082 root@51.68.226.211
       └─ VPS 127.0.0.1:6082   websockify / noVNC  (HTTP + WS, loopback only)
            └─ VPS 127.0.0.1:590X   VNC server bound to display :5
                 └─ X display :5     (Xvfb or Xtigervnc; XAUTHORITY=/root/.Xauthority)
                      ├─ XFCE session  (xfce4-session / xfwm4, dbus-x11)
                      └─ Google Chrome  (/usr/local/bin/mythos-browser -> google-chrome-stable,
                                         profile /root/.mythos-browser)
```

Browser URL on the owner PC: `http://127.0.0.1:6082/vnc.html?autoconnect=true&resize=remote`

Display `:5` maps to VNC port `5905` under the usual `5900 + N` convention — **verify, do not assume**; this host has been non-standard before.

The failure layers, in the order they must be tested:

| Layer | Symptom when it alone is broken |
|---|---|
| L1 X display `:5` | `xdpyinfo -display :5` fails; everything downstream is dead |
| L2 VNC server | noVNC page loads, connection fails ("Failed to connect to server") |
| L3 websockify / noVNC | Tunnel connects but the browser shows connection refused / no `vnc.html` |
| L4a XFCE session | Desktop appears but is grey/empty, or windows have no decorations |
| L4b Google Chrome | Desktop present, but Chrome never appears, dies instantly, or runs with no visible window |

**L4b is the layer the owner is blocked on.** Chrome being *installed and running* is not the goal; a **visible, usable Chrome window on `:5`** is. Treat "the process exists" as failure until §5 item 3 passes.

---

## 3. Phase A — evidence collection (READ-ONLY; run all of it before any repair)

Run every command. Capture output verbatim. **Change nothing in this phase.**

```bash
# A1 — identity, uptime, resources
id; hostname; uptime
free -h
df -h / /tmp /var /dev/shm
dmesg -T 2>/dev/null | tail -40 | grep -iE 'oom|killed process' || echo "no OOM lines in tail"

# A2 — what is listening (every VNC/noVNC listener must be loopback-only)
ss -lntp | grep -E ':(608[0-9]|59[0-9][0-9])' || echo "NO VNC/noVNC LISTENER"
ss -lntp | head -40

# A3 — processes of the stack
ps -eo pid,ppid,user,etime,rss,cmd --sort=-rss \
  | grep -iE 'websockify|novnc|x11vnc|Xtigervnc|Xvnc|Xvfb|xfce|xfwm|chrome' \
  | grep -v grep || echo "NO STACK PROCESSES"

# A4 — systemd units
systemctl list-units --all --no-pager | grep -iE 'vnc|novnc|websockify|xvfb|xfce|chrome' || echo "no system units matched"
ls -l /etc/systemd/system/ | grep -iE 'vnc|novnc|websockify|xvfb|mythos'

# A5 — installed pieces and where they live
command -v google-chrome-stable websockify x11vnc Xtigervnc Xvnc Xvfb xfwm4 xfce4-session xdotool wmctrl 2>/dev/null
google-chrome-stable --version 2>/dev/null || echo "CHROME NOT INSTALLED"
ls -l /usr/local/bin/mythos-browser /usr/local/bin/mythos-chrome 2>/dev/null
cat /usr/local/bin/mythos-browser 2>/dev/null
ls -ld /usr/share/novnc /opt/novnc 2>/dev/null
dpkg -l 2>/dev/null | grep -iE 'novnc|websockify|x11vnc|tigervnc|xvfb|xfce4|google-chrome' | awk '{print $1,$2,$3}'

# A6 — X display :5, its lock, and root's X authority
ls -l /tmp/.X11-unix/ 2>/dev/null; ls -l /tmp/.X*-lock 2>/dev/null || echo "no X lock files"
ls -l /root/.Xauthority /root/.vnc/ 2>/dev/null
DISPLAY=:5 XAUTHORITY=/root/.Xauthority xdpyinfo 2>&1 | head -5

# A7 — the real Chrome profile
ls -la /root/.mythos-browser/ 2>/dev/null | head -20
ls -l /root/.mythos-browser/Singleton* 2>/dev/null || echo "no Singleton lock files"
ls -ld /tmp/mythos-chrome 2>/dev/null && echo "NOTE: stale /tmp profile still present"
tail -40 /tmp/mythos-chrome.log 2>/dev/null

# A8 — recent logs for the stack
journalctl --no-pager -n 120 -u 'x11vnc*' -u 'novnc*' -u 'websockify*' -u 'vncserver*' 2>/dev/null | tail -80
journalctl --no-pager --since '2 hours ago' 2>/dev/null | grep -iE 'vnc|websockify|chrome|Xvfb|xfce|segfault|oom' | tail -60
tail -40 /root/.vnc/*.log 2>/dev/null

# A9 — loopback reachability of noVNC (read-only probe; check the root desktop first)
for p in 6082 6081 6080; do
  curl -sS -o /dev/null -w "novnc :$p http_code=%{http_code}\n" --max-time 5 "http://127.0.0.1:$p/vnc.html" \
    || echo "curl to $p FAILED"
done

# A10 — what is actually on the :5 screen right now (the decisive test for L4b)
DISPLAY=:5 XAUTHORITY=/root/.Xauthority wmctrl -l 2>&1 || echo "wmctrl unavailable or no WM"
DISPLAY=:5 XAUTHORITY=/root/.Xauthority xdotool search --onlyvisible --class chrome 2>&1 | head
```

**Checkpoint.** From A1–A10, write one sentence naming the *lowest broken layer* (L1 → L4b). Repair bottom-up: a Chrome fix applied while `:5` is dead proves nothing.

Check A1 first for the two failures that masquerade as everything else:

- **Disk full** on `/`, `/tmp`, or `/var` → X, VNC, and Chrome all fail confusingly. Fix disk first (§4.0).
- **OOM kill** in `dmesg` → Chrome was killed, not misconfigured. That changes the fix (§4.5 g).

---

## 4. Phase B — triage table, then repairs

| Evidence | Diagnosis | Go to |
|---|---|---|
| `df -h` shows ≥95% on `/`, `/var`, or `/tmp` | Disk exhaustion | §4.0 |
| No noVNC listener at all (A2/A9) | websockify/noVNC down | §4.3 |
| Any VNC/noVNC listener bound to `0.0.0.0` | **Security defect** — loopback violation | §4.3 + report as incident |
| noVNC answers 200 but cannot connect | VNC server down or pointed at the wrong display | §4.2 |
| `xdpyinfo -display :5` fails (A6) | X display `:5` down | §4.1 |
| VNC connects, screen grey/empty, no decorations | XFCE session / `xfwm4` not running | §4.4 |
| Desktop present, `pgrep chrome` empty | Chrome not started or dying at launch | §4.5 a–e |
| `pgrep chrome` non-empty but A10 shows **no visible window** | Chrome alive but unmapped / on the wrong display | §4.5 f |
| Chrome starts then exits immediately as root | root sandbox / profile lock / `/dev/shm` | §4.5 a, c, d |
| Launcher still points at `/tmp/mythos-chrome` | profile drift from `/root/.mythos-browser` | §4.5 h |
| `dmesg` shows OOM killing chrome | memory pressure | §4.5 g |
| Nothing of the stack is installed (A5 mostly empty) | stack was removed, not broken | **STOP — report.** Reinstalling a desktop stack on a production host is an owner decision. |

For every subsection below: run the fix, immediately run its verify command, and move on only if it passed. Record both.

### 4.0 Disk exhaustion (only if A1 showed it)

```bash
du -xh --max-depth=1 / 2>/dev/null | sort -h | tail -15
journalctl --disk-usage
```

Permitted remedies, in order, each reported:

```bash
journalctl --vacuum-time=7d
apt-get clean
find /tmp -type f -atime +7 -user root -delete
```

**Not permitted:** deleting anything under `/home/deploy`, `/var/www`, `/etc`, any database, or any log the owner has not agreed to lose.
Verify: `df -h /` shows ≥2 GB free.

### 4.1 L1 — X display `:5`

Stale lock with no live process (confirm from A3 that no `Xvfb`/`Xtigervnc` owns `:5`):

```bash
fuser -v /tmp/.X5-lock 2>&1 || true      # must show NO process before deleting
rm -f /tmp/.X5-lock /tmp/.X11-unix/X5
```

Start the display via its unit if one exists (preferred):

```bash
systemctl start <the-unit-found-in-A4>
```

If there is no unit, start it the way this host already does — match the command line recorded in A3/A8. Do not invent flags, and do not renumber the display: **`:5` is the number the launcher, the VNC server, and the tunnel all agree on.**

Verify:

```bash
DISPLAY=:5 XAUTHORITY=/root/.Xauthority xdpyinfo | head -5
```

### 4.2 L2 — VNC server

```bash
systemctl status <vnc-unit> --no-pager | head -20
systemctl restart <vnc-unit>
systemctl status <vnc-unit> --no-pager | head -15
```

If `x11vnc` runs ad-hoc, restart it against `:5`, mirroring the flags already in use (A3/A8). The non-negotiable parts are `-localhost` and an existing password file:

```bash
# illustrative — reuse the host's real invocation; keep -localhost and -rfbauth
x11vnc -display :5 -auth /root/.Xauthority -localhost -rfbauth /root/.vnc/passwd \
       -forever -shared -bg -o /root/.vnc/x11vnc.log
```

If the VNC password file is missing: **stop and report** (guardrail 6).

Verify:

```bash
ss -lntp | grep -E ':59[0-9][0-9]'      # must show 127.0.0.1, never 0.0.0.0
timeout 5 bash -c 'cat < /dev/null > /dev/tcp/127.0.0.1/5905' && echo "VNC port reachable"
```

### 4.3 L3 — websockify / noVNC (root desktop = 6082)

```bash
systemctl status <novnc-or-websockify-unit> --no-pager | head -20
systemctl restart <novnc-or-websockify-unit>
```

If it runs ad-hoc, restart it matching the recorded invocation; the shape must be:

```bash
# illustrative — websockify must listen on loopback only, and point at :5's VNC port
websockify --web=/usr/share/novnc 127.0.0.1:6082 127.0.0.1:5905
```

If A2 showed any listener on `0.0.0.0`, rebind to `127.0.0.1` (edit the unit's `ExecStart` or the launch script; `systemctl daemon-reload` expected) and record it as a **security finding** — it means the desktop was reachable from the internet.

**Do not touch the `deploy` desktop's listener on 6081.**

Verify:

```bash
ss -lntp | grep ':6082'                                                    # 127.0.0.1:6082 only
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:6082/vnc.html   # expect 200
```

### 4.4 L4a — XFCE session (grey/empty desktop)

```bash
pgrep -a xfwm4 || pgrep -a xfce4-session || echo "NO XFCE RUNNING"
```

Start the session against `:5` with a D-Bus bus present — XFCE without `dbus-x11` is the classic grey-screen cause:

```bash
DISPLAY=:5 XAUTHORITY=/root/.Xauthority XDG_RUNTIME_DIR=/tmp/runtime-root \
  dbus-run-session -- xfce4-session >/tmp/xfce-session.log 2>&1 &
sleep 3; pgrep -a xfwm4; tail -20 /tmp/xfce-session.log
```

If only the window manager is missing while the rest of the session lives:

```bash
DISPLAY=:5 XAUTHORITY=/root/.Xauthority xfwm4 --replace &
sleep 2; pgrep -a xfwm4
```

A targeted install is permitted and must be reported:

```bash
apt-get install -y xfce4 xfce4-goodies dbus-x11
```

Verify: right-click on the desktop opens the XFCE menu, and new windows get title bars.

### 4.5 L4b — Google Chrome

Work through these in order; stop at the first that fixes it, and re-run §5 item 3 after each — **"Chrome is running" is not the success condition; "Chrome has a visible window on `:5`" is.**

**(a) Stale singleton lock in the real profile:**

```bash
pgrep -a chrome || echo "no chrome running"      # must be empty before removing locks
rm -f /root/.mythos-browser/Singleton{Lock,Socket,Cookie}
```

**(b) Zombie/orphaned processes holding the profile:**

```bash
pkill -TERM -f google-chrome-stable; sleep 3; pgrep -a chrome || echo "clean"
# only if still stuck:
pkill -KILL -f google-chrome-stable
```

**(c) Launch through the supported launcher, not by hand.** The launcher exists so that display, X authority, D-Bus session, runtime dir, and profile are set consistently:

```bash
DISPLAY=:5 XAUTHORITY=/root/.Xauthority /usr/local/bin/mythos-browser about:blank
sleep 5
pgrep -a chrome | head
tail -30 /tmp/mythos-chrome.log
DISPLAY=:5 XAUTHORITY=/root/.Xauthority wmctrl -l
```

The launcher's Chrome invocation must be equivalent to:

```bash
dbus-run-session -- /usr/bin/google-chrome-stable \
  --no-sandbox --disable-gpu --disable-software-rasterizer \
  --disable-dev-shm-usage --disable-features=UseOzonePlatform \
  --user-data-dir=/root/.mythos-browser --start-maximized "$@"
```

On `--no-sandbox`: it is required to run Chrome as root and it removes a real security layer. It is acceptable **only** because this desktop is loopback-only and reached through an SSH tunnel. Never pair it with exposing 6082, and state it in the report. Running the browser as a dedicated non-root desktop user with the sandbox intact is strictly better — recommend it in §7; do not create such a user yourself (guardrail 5).

**(d) `/dev/shm` too small** (A1). Under ~256 MB, `--disable-dev-shm-usage` is the mitigation and is already in the launcher. Do not remount `/dev/shm` or edit `/etc/fstab` — report it.

**(e) Missing shared libraries:**

```bash
ldd /usr/bin/google-chrome-stable 2>/dev/null | grep 'not found'
```

Install only the specific missing packages (this host has needed `libnss3 libgbm1 libgtk-3-0 libxss1 libxtst6 libxrandr2 libasound2t64`), and report each.

**(f) Running but invisible.** If `pgrep chrome` is non-empty while A10 shows no window, the process is alive but its window was never mapped, or it attached to a different display. Check in order:

```bash
# 1. Which display did the running Chrome actually get?
tr '\0' '\n' < /proc/$(pgrep -f 'google-chrome-stable' | head -1)/environ | grep -E '^(DISPLAY|XAUTHORITY|XDG_RUNTIME_DIR)='
# 2. Did it fail to open the display at all?
grep -iE 'cannot open display|Missing X server|Gtk|Xlib' /tmp/mythos-chrome.log | tail -20
# 3. Is there a window that simply is not raised?
DISPLAY=:5 XAUTHORITY=/root/.Xauthority wmctrl -l
DISPLAY=:5 XAUTHORITY=/root/.Xauthority wmctrl -a "Google Chrome"
# 4. Is a WM present to map it at all? (no WM => windows can stay unmapped/undecorated)
pgrep -a xfwm4 || echo "NO WM — go back to §4.4 first"
```

If the running process shows a display other than `:5`, or an empty `XAUTHORITY`, kill it (b) and relaunch via (c) with both variables set explicitly. If it shows `:5` correctly and `wmctrl -l` still lists nothing once the WM is confirmed up, **report** — do not start layering on more flags.

**(g) Memory.** If `dmesg` showed an OOM kill, Chrome is not misconfigured — the box is out of RAM. Report free/total and what else was resident. Do not add swap or change limits without owner approval.

**(h) Profile drift (`/tmp/mythos-chrome` → `/root/.mythos-browser`).** If `/usr/local/bin/mythos-browser` still hard-codes `/tmp/mythos-chrome`, correct it — a `/tmp` profile is reaped by tmp cleaners and lost on reboot, which reproduces the "Chrome starts fresh / won't start" symptom indefinitely:

```bash
cp -a /usr/local/bin/mythos-browser /root/mythos-browser.bak.$(date +%Y%m%d%H%M%S)   # rollback copy
sed -i 's#/tmp/mythos-chrome#/root/.mythos-browser#g' /usr/local/bin/mythos-browser
mkdir -p /root/.mythos-browser && chmod 700 /root/.mythos-browser
grep -n 'mythos-browser\|mythos-chrome' /usr/local/bin/mythos-browser
```

Report the change and the backup path. Do **not** delete `/tmp/mythos-chrome` in the same step — leave it until the new profile is proven (§5), then report it as a cleanup candidate for the owner.

---

## 5. Phase C — end-to-end verification (all must pass)

```bash
# 1. X alive on :5
DISPLAY=:5 XAUTHORITY=/root/.Xauthority xdpyinfo | head -3
# 2. XFCE alive
pgrep -a xfwm4; pgrep -a xfce4-session
# 3. Chrome alive WITH A VISIBLE WINDOW  (this is the acceptance test)
pgrep -a chrome | head -3
DISPLAY=:5 XAUTHORITY=/root/.Xauthority wmctrl -l | grep -i 'chrome'
# 4. VNC loopback-only
ss -lntp | grep -E ':59[0-9][0-9]'
# 5. noVNC loopback-only and serving on the root desktop port
ss -lntp | grep ':6082'
curl -sS -o /dev/null -w 'vnc.html=%{http_code}\n' http://127.0.0.1:6082/vnc.html
# 6. the persistent profile is the one in use
grep -o '/root/.mythos-browser' /usr/local/bin/mythos-browser | head -1
ls -ld /root/.mythos-browser
# 7. nothing production was touched
systemctl is-active nginx
ls -l --time-style=long-iso /etc/nginx/sites-available/ | head -20   # mtimes must predate this session
ss -lntp | grep -E ':(8130|8140|6081)'                              # deploy-side listeners unchanged
```

Owner-side confirmation (run by the owner on the Windows PC, not by you): `vps mythos\VPS-Root-Tunnel.bat` → `http://127.0.0.1:6082/vnc.html?autoconnect=true&resize=remote` shows the XFCE desktop with a live, interactive Google Chrome window.

**Persistence check:** if the fix was manual rather than a unit restart, state plainly that it will not survive a reboot and recommend the unit change — do not write new systemd units under this order.

---

## 6. Rollback

Every change in §4 is reversible, and the rollback for each is fixed in advance. Roll back if a step leaves the stack *worse* than the state recorded in Phase A, and report it.

| Change | Rollback |
|---|---|
| Removed X lock `/tmp/.X5-lock` (§4.1) | None needed — it is a lock, not data; recreated when `:5` starts. |
| Restarted a systemd unit (§4.1–4.3) | `systemctl restart <unit>` again; if it now fails, put `systemctl status <unit>` verbatim in the report. No unit files were edited, so there is nothing to revert. |
| Rebound a listener from `0.0.0.0` to `127.0.0.1` (§4.3) | **Do not roll back.** Loopback-only is the required state (guardrail 4). |
| Started XFCE / `xfwm4` manually (§4.4) | `pkill xfce4-session` / `pkill xfwm4` returns the desktop to its previous (broken) state. |
| Removed Chrome `Singleton*` files (§4.5 a) | None needed — crash residue, regenerated on next launch. |
| Killed Chrome processes (§4.5 b) | Relaunch via `/usr/local/bin/mythos-browser`. |
| Edited the launcher profile path (§4.5 h) | `cp -a /root/mythos-browser.bak.<timestamp> /usr/local/bin/mythos-browser && chmod +x /usr/local/bin/mythos-browser` |
| Installed a package (§4.4, §4.5 e) | Report it; **do not** `apt-get remove` on a production host without owner approval — an unnecessary package is harmless, a botched removal is not. |
| Disk cleanup (§4.0) | Not reversible. That is why only the three named commands are permitted. |

If two full passes of §4 leave the same layer broken, **stop and report** rather than escalating.

---

## 7. Phase D — required report

Write it to `/root/mythos-root-chromium-novnc-REPORT.txt` **and paste it into the owner session** — the owner PC cannot read root-owned files on the VPS (root SSH rejects the owner's keys), so a file on disk alone reaches no one.

```
ROOT CHROME/noVNC REPAIR — REPORT
Date/time (UTC):
Host / user:

1.  LOWEST BROKEN LAYER FOUND: (L1 X:5 | L2 VNC | L3 websockify | L4a XFCE | L4b Chrome | none)
2.  ROOT CAUSE, one sentence:
3.  EVIDENCE (the 3–6 decisive lines from Phase A):
4.  CHANGES MADE — exhaustive, one line each (command -> result), or "none":
5.  FILES CREATED, MODIFIED, OR DELETED — exhaustive (include launcher backups):
6.  PACKAGES INSTALLED — exhaustive:
7.  SERVICES RESTARTED — exhaustive:
8.  VERIFICATION (§5 items 1–7, pass/fail each):
9.  CHROME VISIBLE IN noVNC? (yes/no — the wmctrl line proving it):
10. PROFILE IN USE (/root/.mythos-browser confirmed? launcher path corrected?):
11. LOOPBACK-ONLY CONFIRMED (ss output for the VNC port and 6082):
12. PRODUCTION UNTOUCHED CONFIRMED (nginx active; sites-available mtimes unchanged; 6081/8130/8140 unchanged):
13. SECURITY FINDINGS (0.0.0.0 binding? --no-sandbox in use? missing VNC password?):
14. SURVIVES REBOOT? (yes / no — and why)
15. ROLLBACKS PERFORMED (§6), if any:
16. STILL OPEN / OWNER DECISIONS NEEDED:
```

**Stop-and-ask conditions** — halt and report rather than improvising if: the stack is not installed; the VNC password file is missing; the fix would require touching nginx, the deploy repo, the deploy desktop, sshd, users, or keys; the host is out of memory or disk in a way §4.0 cannot safely resolve; or two full passes of §4 leave the same layer broken.
