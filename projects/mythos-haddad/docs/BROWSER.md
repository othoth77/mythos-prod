# MYTHOS HADDAD — Obscura browser runtime and the governed browser chain

> Status 2026-09-27: **code merged-ready on `mythos/browser-obscura-20260927`**; runtime on Haddad **NOT
> installed as a service** (owner-gated, see §4); permission-matrix classification and skill-trust
> attestation **owner steps** (§5). Architecture per the owner's order of 2026-09-27, which supersedes
> the V3.1 entry "Jev, Browser Use, … NOT NEEDED / INCOMPATIBLE" ([V3_1.md](V3_1.md) §2).

## 1. Architecture (fixed)

```
Mythos OS → Master Task → governed MCP browser invocation → BrowserAdapter
   → ObscuraBackend PRIMARY → Obscura CDP → 127.0.0.1:9222
   → PlaywrightBackend FALLBACK
```

Implementation: `projects/mythos-browser-mcp/` (server, adapter, backends, URL gate, launcher, smoke,
webinar preflight) and the wiring in `projects/mythos-ai-executor/providers/haddad-agent.js`
(capability-backed tools `browser_navigate`, `browser_extract`, `browser_screenshot`, dispatched
through `lib/mcp-invoke.js`). Read `projects/mythos-browser-mcp/README.md` first.

## 2. Measured state of Haddad (2026-09-27, read-only inspection by a Haddad session)

| Item | Measured |
|---|---|
| Obscura v0.2.3 tarball | present on disk under `~/.local/opt`, digest matches the GitHub release asset `obscura-x86_64-linux.tar.gz` |
| Process / listener on :9222 | **none** at inspection time (an earlier ad-hoc run today left a pass report and was stopped; the 18:02 health snapshot still listed a :9222 listener) |
| User unit / `~/.config/obscura` / token | **none** |
| Playwright fallback | **BLOCKED**: the bundled Chromium is missing six host shared libraries; installing them is a system-package step nobody has taken |
| Live checkout `~/projects/mythos-prod` | **switched off `main`** to a local branch `mythos-haddad/obscura-browser-runtime` with uncommitted edits by another session today. Bridge and health timers load code from that checkout every tick; the worker still runs the last `main` it loaded (health 17/17). This violates the "never switch branches on the live checkout" rule and must be returned to `main` (owner decision on when) |
| Node / Claude Code | v22.22.1 / 2.1.278 authenticated (health) |

Why the VPS cannot do this itself: the tailnet ACL admits only `mythos-vps → haddad:443`; SSH times
out; the Haddad executor's `repo-read` profile cannot write, and the Haddad desktop session declined
to install a runtime without the owner's own order in that session.

## 3. Install (isolated, user-space, loopback only) — run ON Haddad as `othman`

```bash
mkdir -p ~/.local/opt/obscura-test && cd ~/.local/opt/obscura-test
# the v0.2.3 tarball is already here; otherwise:
# curl -fsSLO https://github.com/h4ckf0r0day/obscura/releases/download/v0.2.3/obscura-x86_64-linux.tar.gz
tar xzf obscura-x86_64-linux.tar.gz && ./obscura --version        # expect 0.2.3
install -m 700 -d ~/.config/obscura
( umask 077; printf 'OBSCURA_CDP_TOKEN=%s\n' "$(openssl rand -hex 32)" > ~/.config/obscura/cdp.env )   # never echo it
install -m 755 ~/projects/mythos-prod/projects/mythos-browser-mcp/bin/mythos-browser-mcp.sh ~/.local/bin/mythos-browser-mcp.sh
cat > ~/.config/systemd/user/obscura-test.service <<'UNIT'
[Unit]
Description=Obscura headless browser runtime (loopback CDP for the MYTHOS governed browser)
[Service]
EnvironmentFile=%h/.config/obscura/cdp.env
ExecStart=%h/.local/opt/obscura-test/obscura serve --port 9222
Restart=on-failure
RestartSec=5
MemoryMax=1500M
NoNewPrivileges=true
PrivateTmp=true
[Install]
WantedBy=default.target
UNIT
systemctl --user daemon-reload && systemctl --user enable --now obscura-test.service
```

Never: `--allow-private-network`, `OBSCURA_ALLOW_PRIVATE_NETWORK`, a `0.0.0.0` bind, a token shorter
than 32 bytes (Obscura refuses non-loopback binds without one; we never bind non-loopback at all).

## 4. Verification list (the gate) — ON Haddad

```bash
set -a; . ~/.config/obscura/cdp.env; set +a           # token in this shell only
~/.local/opt/obscura-test/obscura --version            # binary + version
systemctl --user is-active obscura-test.service        # process
ss -ltnp | grep ':9222'                                # listener: 127.0.0.1:9222 ONLY
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:9222/json/version                 # unauthenticated: expect 401/403
curl -s -H "Authorization: Bearer $OBSCURA_CDP_TOKEN" http://127.0.0.1:9222/json/version | head -c 200   # authenticated: product/version
cd ~/projects/mythos-prod && node projects/mythos-browser-mcp/bin/browser-smoke.js https://example.com/   # CDP, launch, navigate, extract, screenshot, cleanup
node tests/mythos-browser-mcp-test.js && node tests/mythos-browser-governed-test.js                        # the suites on the target hardware
```

`browser-smoke.js` exit 0 = navigate, extract and screenshot passed through **the real Obscura**; its
`status.fallback` line records the exact Playwright reason (expected BLOCKED here until the six host
libraries are installed as system packages).

## 5. Owner steps that gate a live Master Task

1. Permission matrix: add `browser.read` + the `browser-mcp` tool class + the `executor` grant to
   `projects/mythos-gateway/registry/mcp-permissions.json` (exact snippet in the browser README).
2. Skill trust: `node projects/command-center/cli/skill-trust-cli.js scan executor:browser-research`, commit the ledger.
3. Merge the PR, then on Haddad `git -C ~/projects/mythos-prod checkout main && git pull --ff-only`, restart
   `mythos-haddad-worker.service` at an idle queue (MERGED ≠ RUNNING, [V3_1.md](V3_1.md)).
4. Install the launcher and the unit (§3), run the gate (§4).
5. File the E2E Issue: label `mythos:haddad`, `Action: investigate`, objective "Read the h1 of
   https://example.com/ through the browser and report backend, title and text". Evidence is the task's
   `events.log` (`mcp_invoke`), `mcp-audit.jsonl` (`server: browser-mcp`, `capability: browser.read`) and the
   report's tool trace.

## 6. Webinar recording — safe test first

`node projects/mythos-browser-mcp/bin/webinar-preflight.js --url <webinar url> --seconds 10 --display :99 --pulse-sink mythos_rec`

Steps 1–5 prove the page (session wall? loads? `<video>`? media ready?). Steps 6–9 prove the **capture
layer**: `ffmpeg` x11grab of a visible browser on a display + a PulseAudio/PipeWire monitor source. Obscura
cannot deliver audio (headless engine, no audio device) and CDP screencasts carry none, so "the browser
navigated" is not "the webinar was recorded". Measured on the VPS on 2026-09-27: ffmpeg/ffprobe present,
synthetic 3 s recording produced (h264 + aac, duration 3.02 s), step 6 correctly FAIL because no display
and no audio sink exist there. On Haddad the same command with a real display (`Xvfb :99` or the desktop)
and a null-sink monitor is the test to run before the event; a webinar behind a login is an owner
session step (step 2 will say so).
