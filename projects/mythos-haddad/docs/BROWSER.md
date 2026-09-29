# MYTHOS HADDAD — Obscura browser runtime and the governed browser chain

> Status 2026-09-29 (final integration pass, branch `mythos-haddad/obscura-final`): BrowserAdapter/server
> **1.1.0** — Playwright fallback on ANY engine failure (open, operation, attempt deadline), classified
> machine-readable failures, one bounded interaction (`click`, capability `browser.interact`), fail-closed
> browser reports, identical clean page text on both engines. Everything measured live on Haddad in §2c.
> **Still owner-gated:** the skill-trust attestation of `executor:browser-research` (Gate 3, PR #519 §9d) —
> until it exists the executor's skill selection withholds every browser capability from a live task
> (worker log: `skill browser-research UNTRUSTED (UNATTESTED)`), so a GitHub-Issue task cannot yet reach the
> browser; and the `browser.interact` grant is an owner decision on the PR. Architecture per the owner's
> order of 2026-09-27, which supersedes the V3.1 entry "Jev, Browser Use, … NOT NEEDED / INCOMPATIBLE"
> ([V3_1.md](V3_1.md) §2).

## 1. Architecture (fixed)

```
Mythos OS → Master Task → governed MCP browser invocation → BrowserAdapter
   → ObscuraBackend PRIMARY → Obscura CDP → 127.0.0.1:9222
   → PlaywrightBackend FALLBACK (open failure, operation failure, or attempt deadline; never for policy/input)
```

Playwright ALSO connects to Obscura itself over CDP (`chromium.connectOverCDP('http://127.0.0.1:9222',
{ headers: { Authorization: 'Bearer …' } })`) — measured in §2c and part of `browser-smoke.js --full`. The
adapter's primary path uses its own dependency-free CDP client (`lib/cdp-client.js`) so the primary never
depends on Playwright being installed; Playwright-over-CDP is verified as a working second client.

Implementation: `projects/mythos-browser-mcp/` (server, adapter, backends, URL gate, launcher, smoke,
webinar preflight) and the wiring in `projects/mythos-ai-executor/providers/haddad-agent.js`
(capability-backed tools `browser_navigate`, `browser_extract`, `browser_screenshot`, dispatched
through `lib/mcp-invoke.js`). Read `projects/mythos-browser-mcp/README.md` first.

## 2. Measured state of Haddad (2026-09-28 12:40–13:30 UTC, FABLE 5.1 completion pass, all measured live)

| Item | Measured |
|---|---|
| Obscura v0.2.3 | `~/.local/opt/obscura-test/obscura` (`--version` → `obscura 0.2.3`); tarball sha256 `1534d1e6…482a9eec` unchanged. Found at 12:00 UTC running **by hand** from a shell (`./obscura serve --host 127.0.0.1 --port 9222`, 17 h old, no unit) with the token in its environment |
| Unit | **`obscura.service` installed, enabled, active** (`~/.config/systemd/user/obscura.service`, §3): `EnvironmentFile=%h/.config/obscura/cdp.env`, `ExecStart=… serve --host 127.0.0.1 --port 9222`, `Restart=on-failure`, `MemoryMax=1500M`, `NoNewPrivileges`, `PrivateTmp`. The hand-started process was stopped and the unit took the port at 12:41:27 UTC |
| Restart / crash recovery | `systemctl --user restart` → active, new PID; `kill -9 <MainPID>` → active again within 9 s, `NRestarts=1`, bearer probe 200 afterwards; `browser-smoke.js https://example.com/` through the restarted unit: status/navigate/extract/screenshot all OK on backend `obscura` |
| Listener | `127.0.0.1:9222` only (`ss -ltnp`), owner `obscura`, no `:9223` |
| Auth | `/json/version` unauthenticated → **401**; with the bearer from `cdp.env` → **200** `Chrome/145.0.0.0`, CDP 1.3. The token in `cdp.env` is byte-identical (sha256) to the one the hand-started process carried, so nothing was rotated |
| Token files | `~/.config/obscura/cdp.env` 0600 (`OBSCURA_CDP_TOKEN` only). The earlier `~/.config/obscura/cdp-token` (0600) still exists with the same value; `/tmp/obscura-token` (empty) and `/tmp/obscura-token.env` (no `OBSCURA_CDP_TOKEN` line) are stray leftovers of the 09-27 sessions — owner cleanup, nothing reads them |
| Launcher | `~/.local/bin/mythos-browser-mcp.sh` installed from `mythos-haddad/browser-closeout`; over stdio through it: `initialize` → `mythos-browser-mcp`, `tools/list` → 3, `extract h1 https://example.com/` → `"Example Domain"` backend `obscura`; with `OBSCURA_CDP_URL=http://127.0.0.1:9` in the caller's environment the same call answers backend `playwright`, `fallback_reason: OBSCURA_UNREACHABLE` |
| Playwright fallback | **AVAILABLE.** playwright-core 1.63.0 at `~/.local/opt/obscura-test/playwright-test/node_modules/playwright-core`, Chromium 153.0.8010.12 (`~/.cache/ms-playwright/chromium-1243`). The six missing host libraries (`libatk-1.0.so.0, libatk-bridge-2.0.so.0, libcups.so.2, libasound.so.2, libXdamage.so.1, libatspi.so.0`) plus their three transitive ones (`libavahi-common.so.3, libavahi-client.so.3, libXRes.so.1`) were **downloaded from the Ubuntu archive (`apt-get download`, 956 kB) and extracted with `dpkg-deb -x` into `~/.local/lib/mythos-playwright-deps`** (2.9 MB) — no `sudo`, no system package installed or changed. `ldd chrome` under that `LD_LIBRARY_PATH`: **0 not found**. Standalone launch + `https://example.com/` → title `Example Domain`. Configured for the launcher in `~/.config/mythos-browser/env` (§4b) |
| Health | `haddad-health.js` (branch `mythos-haddad/v100-closeout`) gained the `browser` check: unit active, loopback bind, 401/200, token-file rules, launcher present, fallback launchability (module + `ldd` clean) → **PASS** live; 18 checks, the live timer (main) still reports 17 |
| Live checkout `~/projects/mythos-prod` | Returned to **`main` @ `7e918141`, clean** at 12:14 UTC (the 09-27 local branch `mythos-haddad/obscura-browser-runtime` is preserved locally at `9aaa7f2d` = `3e53145a` + a WIP commit of its uncommitted edits; not pushed, not for merge — its `haddad-bridge-instance-setup.sh` edit sets `MYTHOS_BRIDGE_TASK_WORKTREES` to the task STORE, which is wrong). Worker restarted at an idle queue: `/health.code_identity` = `7e918141 main verified`. MERGED == RUNNING again |
| Permission matrix | `projects/mythos-gateway/registry/mcp-permissions.json` **still has no `browser.read`** — writing the grant was refused to this session by the permission layer ("Permission Grant"). Governed invoke through the SHIPPED matrix therefore answers `MCP_DENIED` (asserted by `tests/mythos-browser-governed-test.js`) |
| Skill trust | `skill-trust-cli.js scan executor:browser-research` on Haddad → **BLOCK** on all three scanners: `binary not found` (skillspector, gitleaks, skillevaluator live on the VPS; every existing attestation is `scanned_by: operator:deploy`). Ledger change reverted; the scan is a VPS owner step |

### 2b. Live E2E, pre-merge, isolated store (2026-09-28 13:0x UTC)

`agent.run()` of the REAL `providers/haddad-agent.js` from the PR branch, REAL Qwen (llama-server :8600,
`qwen2.5-7b-instruct-q4_k_m`), governed invoke with a **test-fixture** permission matrix (the shipped one +
`browser.read`, exactly what `tests/mythos-browser-governed-test.js` builds), the estate registry's
`browser-mcp` entry pointed at the INSTALLED launcher, an isolated `MYTHOS_EXECUTOR_HOME` and audit file.
Nothing production was touched.

| Run | Result |
|---|---|
| Obscura primary | **COMPLETED in 35.7 s**, `validation.passed: true`, `repair_rounds: 0`. Qwen called `browser_extract https://example.com/` (9 governed invokes — it repeated the call several times before settling, the runner's identical-call note notwithstanding), then reported `mythos_report … status completed … "backend 'obscura' … extracted text … 'Example Domain'"`. Audit: 9 records `server: browser-mcp`, `capability: browser.read`, `decision: ALLOW`. Token absent from audit, events and output |
| Playwright fallback (primary unreachable) | Governance/MCP chain **PASS**: 32 governed invokes, all ALLOW, every page served by Playwright; **task-level FAIL**: 194 s, 3 executions, `repair_rounds: 2`, no valid report — the 7B model kept re-issuing `browser_extract` (each ~3 s through Playwright vs ~0.5 s through Obscura) until the tool-call budget was spent. Known limit: the fallback carries the browser; whether Qwen converges is the task-shape question recorded in V3.2 (`outcomes`) |

### 2c. Final integration pass, 2026-09-29 (all measured live on Haddad)

Live checkout `~/projects/mythos-prod` = `main` @ `1a63bc3c` (= origin/main), worker `code_identity 1a63bc3c`
(restarted 09:29:23Z by the owner's fast-forward). Resources before any test: 7.2 GiB RAM / 4.3 GiB available,
disk 35 % (61 GB free), load 0.3, 12 CPUs; listeners `127.0.0.1:9222` (obscura), `:8130` (worker), `:8600`
(llama-server), `:8160` (MCP HTTP) — nothing new was installed, no unit was added or changed.

| Invariant | Measured |
|---|---|
| Binary / version | `~/.local/opt/obscura-test/obscura` mode 755, `obscura 0.2.3`, sha256 `ca649bbd…3e34d`; `obscura.service` active, `MemoryMax=1500M`, peak 83 MB |
| Auth | `/json/version` no token **401**, wrong token **401**, `?token=` query **401**, bearer **200** `Chrome/145.0.0.0` CDP 1.3; `cdp.env` 0600 with `OBSCURA_CDP_TOKEN` only (64 hex) |
| CDP | page created (`/json/new`), navigate, `Runtime.evaluate`, `Page.captureScreenshot`, `Input.dispatchMouseEvent`, lifecycle events; `/json/list` shows no page left open after the full smoke (1 → 1) |
| Playwright → Obscura over CDP | playwright-core 1.63.0 `connectOverCDP` with the bearer: connected (`145.0.0.0`), page, `goto` 200, title `Example Domain`, DOM text, screenshot 46 662 B, **click → `https://www.iana.org/help/example-domains`**, clean disconnect |
| Smoke | `browser-smoke.js https://example.com/ --full --require-backend obscura` → **PASS**: auth, playwright_over_cdp, status, navigate 241 ms, extract 233 ms, screenshot 444 ms, click 3.5 s (`url_changed: true`), no_leaked_pages |
| Page text | Obscura's `innerText` is `textContent` (example.com's body text began with its CSS). `lib/page-text.js` now serves both engines: example.com 905 chars and a Wikipedia article 29 869 chars, **identical on obscura and playwright** |
| Failure matrix (adapter, live) | invalid token → `playwright` (`OBSCURA_UNAUTHORIZED` 401); CDP port down → `playwright` (`OBSCURA_UNREACHABLE`); dead host → `NAVIGATE_FAILED` class `target` after both engines; bad selector → `CLICK_TARGET_NOT_FOUND` class `input`, **tried once**; private literal → `URL_POLICY` before any engine; slow page past a 4–6 s attempt deadline → `BROWSER_TIMEOUT` on both; **Obscura SIGKILLed 1.5 s into a navigation → `CDP_CLOSED` → the SAME call served by `playwright` in 5.3 s**; systemd restarted Obscura (`NRestarts` 2) and the next call was `obscura` again |
| Playwright guard | `https://localtest.me/` (resolves to 127.0.0.1): Obscura refused it, the fallback guard refused it too (`URL_POLICY … URL_PRIVATE_ADDRESS_RESOLVED`) — before 1.1.0 the fallback would have fetched it |
| Health | `HADDAD_HEALTH_ONLY=browser` on the branch → **PASS** (unit, loopback, 401/200, launcher, fallback AVAILABLE) |

**Real-Qwen E2E on the Haddad execution path** (isolated store; REAL `providers/haddad-agent.js` of the branch,
REAL llama-server Qwen 2.5 7B, REAL governed invoke with the SHIPPED registry + permission matrix of the branch,
REAL installed launcher `~/.local/bin/mythos-browser-mcp.sh` running the branch's server, REAL Obscura/Chromium).
`task.mcp_capabilities` is set to what the trust gate resolves for `browser-research` once attested — the one
step that is not live (Gate 3). Each outcome was rendered by the REAL bridge `reportBody()` and read back by the
REAL Supervisor parsers (`supervisor/bridge.js bridgeMarker`, `supervisor/qwen.js summarySection`).

| Scenario | Result |
|---|---|
| A — Obscura primary, `browser_click` example.com → `a` | **COMPLETED 33.6 s**, 0 repair rounds, 3 governed clicks, every result `backend: obscura`, `url_changed: true`, `final_url` iana.org; audit `click browser.interact ALLOW OK` ×3; bridge report `COMPLETED`, Supervisor marker status `COMPLETED` (valid), Summary section present, no `[object Object]`; token absent from output and audit |
| B — Obscura unreachable (`OBSCURA_CDP_URL=:9229`) | run 1: chain PASS (29 governed clicks, all `backend: playwright`, `fallback_reason: obscura unavailable: OBSCURA_UNREACHABLE`), task **FAILED** at the 600 s deadline — Qwen drifted to clicking on the landing page and never settled (the 7B convergence limit recorded in §2b); run 2: **COMPLETED 47 s**, 3 clicks, all `playwright`; Supervisor marker `COMPLETED`. Both runs recorded |
| C — both engines down (fallback env file absent) | every call answered `BROWSER_NO_BACKEND` class `backend` with both attempts; Qwen's `completed` claim was **rejected** each round; the run settled **BLOCKED** (81.7 s, 2 repair rounds) — Supervisor marker `BLOCKED` (valid). Before 1.1.0 this exact case reported `completed` |

**Regression (full sweep, 230 suites, baseline origin/main `1a63bc3c` vs branch):** identical exit codes on
all 230 (43 non-zero on both — the host baseline: VPS-only HostOps, WP comms without a DB, ERP/stage suites
without their deps, `invoice-total`); identical pass counts on every suite except the two browser suites, which
grew: `mythos-browser-mcp-test` 21 → 31, `mythos-browser-governed-test` 12 → 15. Executor 395/0, Supervisor
221/0, supervised loop 51/0, mcp-ecosystem 168/0, governance-invariant 111/0, gateway-boundary 37/0, stc-1 81/0.

## 3. Install (isolated, user-space, loopback only) — AS INSTALLED on Haddad (2026-09-28)

```bash
mkdir -p ~/.local/opt/obscura-test && cd ~/.local/opt/obscura-test
# the v0.2.3 tarball is already here; otherwise:
# curl -fsSLO https://github.com/h4ckf0r0day/obscura/releases/download/v0.2.3/obscura-x86_64-linux.tar.gz
tar xzf obscura-x86_64-linux.tar.gz && ./obscura --version        # expect 0.2.3
install -m 700 -d ~/.config/obscura
( umask 077; printf 'OBSCURA_CDP_TOKEN=%s\n' "$(openssl rand -hex 32)" > ~/.config/obscura/cdp.env )   # never echo it
install -m 755 ~/projects/mythos-prod/projects/mythos-browser-mcp/bin/mythos-browser-mcp.sh ~/.local/bin/mythos-browser-mcp.sh
cat > ~/.config/systemd/user/obscura.service <<'UNIT'
[Unit]
Description=MYTHOS Haddad — Obscura headless browser runtime (loopback CDP :9222, bearer)
After=network.target
[Service]
Type=simple
EnvironmentFile=%h/.config/obscura/cdp.env
WorkingDirectory=%h/.local/opt/obscura-test
ExecStart=%h/.local/opt/obscura-test/obscura serve --host 127.0.0.1 --port 9222
Restart=on-failure
RestartSec=5
TimeoutStopSec=20
MemoryMax=1500M
NoNewPrivileges=true
PrivateTmp=true
[Install]
WantedBy=default.target
UNIT
systemctl --user daemon-reload && systemctl --user enable --now obscura.service
```

Never: `--allow-private-network`, `OBSCURA_ALLOW_PRIVATE_NETWORK`, a `0.0.0.0` bind, a token shorter
than 32 bytes. `cdp.env` carries `OBSCURA_CDP_TOKEN` and at most a loopback `OBSCURA_CDP_URL`; the health
check FAILs anything else in it.

## 4. Verification list (the gate) — ON Haddad

```bash
set -a; . ~/.config/obscura/cdp.env; set +a           # token in this shell only
~/.local/opt/obscura-test/obscura --version            # binary + version
systemctl --user is-active obscura.service             # process
ss -ltnp | grep ':9222'                                # listener: 127.0.0.1:9222 ONLY
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:9222/json/version                 # unauthenticated: expect 401/403
curl -s -H "Authorization: Bearer $OBSCURA_CDP_TOKEN" http://127.0.0.1:9222/json/version | head -c 200   # authenticated: product/version
set -a; . ~/.config/mythos-browser/env; set +a     # MYTHOS_PLAYWRIGHT_MODULE for the Playwright-over-CDP step
cd ~/projects/mythos-prod && node projects/mythos-browser-mcp/bin/browser-smoke.js https://example.com/ --full --require-backend obscura   # auth 401/401/200, Playwright over CDP, navigate, extract, screenshot, click, no leaked page
node tests/mythos-browser-mcp-test.js && node tests/mythos-browser-governed-test.js                        # the suites on the target hardware
HADDAD_HEALTH_ONLY=browser node projects/mythos-haddad/bin/haddad-health.js --json --no-log               # the health check alone
```

`browser-smoke.js` exit 0 = navigate, extract and screenshot passed through **the real Obscura**; its
`status.fallback` line records the exact Playwright reason. Measured 2026-09-28: `AVAILABLE` (§4b).

### 4b. Playwright fallback without root

Haddad has no non-interactive `sudo`. Chromium's missing host libraries are ordinary Ubuntu packages, so
they were fetched and unpacked into user space — reversible with one `rm -r`, and no system file changed:

```bash
D=$(mktemp -d) && cd "$D" && apt-get download libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libasound2t64 libxdamage1 libatspi2.0-0t64 libavahi-common3 libavahi-client3 libxres1
L=~/.local/lib/mythos-playwright-deps; mkdir -p "$L/x"; for f in "$D"/*.deb; do dpkg-deb -x "$f" "$L/x"; done
LD_LIBRARY_PATH="$L/x/usr/lib/x86_64-linux-gnu" ldd ~/.cache/ms-playwright/chromium-*/chrome-linux64/chrome | grep -c 'not found'   # expect 0
cat > ~/.config/mythos-browser/env <<EOF
MYTHOS_PLAYWRIGHT_MODULE=$HOME/.local/opt/obscura-test/playwright-test/node_modules/playwright-core
LD_LIBRARY_PATH=$L/x/usr/lib/x86_64-linux-gnu
EOF
```

The launcher sources `~/.config/mythos-browser/env` (no secret, not mode-checked, refused if it names any
`OBSCURA_*` key) before the 0600 token file, so the server process — and only it — sees the fallback
configuration. When the owner installs the six packages system-wide the file becomes unnecessary; keep
the `MYTHOS_PLAYWRIGHT_MODULE` line until playwright-core is a project dependency.

## 5. Owner steps that gate a live Master Task (state 2026-09-29)

1. ~~Permission matrix `browser.read`~~ — **DONE** (#518, merged `1a63bc3c`).
2. **Decide `browser.interact`** — the `click` tool's grant (ALLOW executor, DENY every other subject) ships on
   the obscura-final PR. It widens Gate 2's read-only surface to one action on a page; the owner approves it
   by merging, or asks for the click commit to be dropped (the rest of the PR stands without it).
3. **Merge the obscura-final PR, then fast-forward the live checkout and restart the worker at an idle queue**:
   `git -C ~/projects/mythos-prod pull --ff-only && systemctl --user restart mythos-haddad-worker.service`.
4. **Skill trust (Gate 3) — AFTER step 3**, because the PR changes the `browser-research` content (version
   1.1.0, `browser.click`) and an attestation of the old content would be STALE: PR #519 §9d option 1 (reproduce
   the attested SkillEvaluator 0.2.1 toolchain, commit `73b27dad`) or option 2 (a reviewed policy for 0.3.0's
   `AGENT_EVAL`), then `node projects/command-center/cli/skill-trust-cli.js scan executor:browser-research`,
   commit `projects/mythos-ai-executor/config/skill-trust.json`, merge, fast-forward, restart the worker.
5. File the E2E Issue (label `mythos:haddad`, `Action: investigate`): "Click the first link on
   https://example.com/ through the browser and report backend, final URL and title". Expected: the §2c
   scenario A result through the bridge. Evidence: `events.log` (`mcp_invoke`), `mcp-audit.jsonl`
   (`browser.interact`), the report comment.

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
