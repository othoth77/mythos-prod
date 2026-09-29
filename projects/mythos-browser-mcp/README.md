# MYTHOS Browser MCP — governed browser capabilities

> Owner architecture (2026-09-27), superseding the V3.1 "browser NOT NEEDED / INCOMPATIBLE" line:
>
> `Mythos OS → Master Task → governed MCP browser invocation → BrowserAdapter → ObscuraBackend PRIMARY → Obscura CDP 127.0.0.1:9222`, with `PlaywrightBackend` as FALLBACK.
>
> Not reopenable here. This project is the implementation of that line.

## What it is

A dependency-free stdio MCP server (`server.js`, 1.1.0) exposing exactly four tools — three reads,
`navigate`, `extract`, `screenshot`, and one bounded interaction, `click` (owner order 2026-09-29) —
over a `BrowserAdapter` that picks the backend:

| Layer | File | Role |
|---|---|---|
| MCP server | `server.js` | JSON-RPC 2.0 over stdio (initialize, tools/list, tools/call, ping), same shape as `projects/oth-mcp/server.js`; one browser session per call; every error is redacted |
| Adapter | `lib/browser-adapter.js` | policy `primary=obscura, fallback=playwright`; the fallback serves the call when the primary cannot open, **fails during the operation, or exceeds the attempt deadline** (`MYTHOS_BROWSER_ATTEMPT_TIMEOUT_MS`, 40 s) — never for a `policy` or `input` failure; every result names its `backend`, `fallback_reason` and each attempt; a fallback that cannot launch is reported **BLOCKED with the exact reason**, never a phantom PASS |
| Failure classes | `classify()` | every error is `policy` (URL refused, before or after a click, or the engine's own private-address refusal), `input` (bad selector), `target` (the site failed on every engine → `NAVIGATE_FAILED`), `timeout` (`BROWSER_TIMEOUT`) or `backend` (`BROWSER_NO_BACKEND` = no engine could open, `BROWSER_BACKEND_FAILED`); the tool error carries `code`, `class` and `attempts[{backend, stage, class, reason}]` |
| Page text | `lib/page-text.js` | ONE in-page extraction for both engines: Obscura 0.2.3's `innerText` is `textContent` (CSS rules and markup whitespace), so text mode reads a clone without script/style/noscript/template/svg and normalizes whitespace — the same page gives the same text on either backend (measured: 905 / 29 869 chars identical) |
| URL gate | `lib/url-policy.js` | http(s) only, no embedded credentials, no loopback / private / link-local / CGNAT / multicast literals (IPv4 + IPv6 incl. mapped), no `.local`/`.internal`/single-label names; `MYTHOS_BROWSER_ALLOWED_HOSTS` narrows, `MYTHOS_BROWSER_DENIED_HOSTS` always wins |
| Primary | `lib/obscura-backend.js` | CDP over a per-page WebSocket (`/json/new` → page ws, or Target domain when absent); bearer from `OBSCURA_CDP_TOKEN`; endpoint must be loopback; page closed on every path |
| Fallback | `lib/playwright-backend.js` | resolves `MYTHOS_PLAYWRIGHT_MODULE`, `playwright`, `playwright-core`; launches headless Chromium; reports `PLAYWRIGHT_UNAVAILABLE` / `PLAYWRIGHT_LAUNCH_FAILED` with the host's reason; **guards every request** (URL policy + DNS: a host resolving to a private address is refused) because Chromium, unlike Obscura, has no SSRF block of its own |
| CDP client | `lib/cdp-client.js`, `lib/ws-min.js` | request ids, timeouts, events; RFC 6455 client with custom headers (the WHATWG `WebSocket` cannot send a bearer) |
| Launcher | `bin/mythos-browser-mcp.sh` | installed as `~/.local/bin/mythos-browser-mcp.sh` on the browser host; loads the 0600 token file into the server process only |
| Smoke | `bin/browser-smoke.js [url]` | status + navigate + extract + screenshot on the host, JSON verdict, exit 0 only on PASS |
| Webinar | `bin/webinar-preflight.js --url …` | the SAFE TEST for a recording (see below) |

No arbitrary CDP is reachable through any of this: the tool surface is the boundary. There is no
evaluate, type, fill, cookie or download tool; `click` takes a URL and a CSS selector and nothing
else, lets the navigation it starts finish, and re-checks the landing URL against the URL policy
(`URL_POLICY_AFTER_CLICK` returns nothing from a refused page). It is classified apart from the reads:
capability `browser.interact` in the permission matrix (ALLOW executor, DENY every other subject),
`browser.click` on the executor side. The governed invoke refuses any tool name the registry does not
declare (`MCP_TOOL_UNREGISTERED`).

## How a task reaches it (the governed chain)

```
GitHub Issue (label mythos:haddad, Action: investigate|review|test|document|implement)
  → bridge → executor.createTask  → skill selection (task_category / keyword) → browser-research skill
  → resolveCapabilities(skill ∩ config/mcp-capabilities.json ∩ execution_profile) → task.mcp_capabilities = [browser.navigate, browser.extract, browser.screenshot]
  → providers/haddad-agent.js offers browser_navigate / browser_extract / browser_screenshot ONLY for the resolved capabilities
  → lib/mcp-invoke.js: estate registry (browser-mcp) → permission matrix (browser.read) → capability gate (task.mcp_capabilities) → declared tools → audit (0600 jsonl, redacted) → task event mcp_invoke
  → /home/othman/.local/bin/mythos-browser-mcp.sh → server.js → BrowserAdapter → ObscuraBackend → Obscura CDP (127.0.0.1:9222, bearer) → page
```

Registered in three places, the same three every outbound MCP server uses:

- `projects/mythos-ai-executor/config/mcp-capabilities.json` — server `browser` (tools navigate/extract/screenshot; profiles repo-read, repo-write, repo-test)
- `projects/mythos-ai-executor/config/skills.json` — skill `browser-research` (`allowed_mcp_servers: ["browser"]`), instructions in `skills/browser-research.md`
- `projects/mythos-gateway/registry/mcp-registry.json` — server `browser-mcp` (outbound, stdio, `outbound_capability_server: "browser"`, `write_capable: false`)

**Two owner steps remain before a live task can use it** (both are governance surfaces this
implementation deliberately does not write for itself):

1. **Permission matrix** — `projects/mythos-gateway/registry/mcp-permissions.json`: add capability
   `browser.read` (ALLOW), tool class `{ "server": "browser-mcp", "tools": ["navigate","extract","screenshot"], "capability": "browser.read" }`
   and the grant `browser.read: ALLOW` on the `executor` subject (DENY on the others). Until then the
   governed invoke answers `MCP_DENIED` for browser-mcp (asserted in `tests/mythos-browser-governed-test.js`).
2. **Skill trust** — `node projects/command-center/cli/skill-trust-cli.js scan executor:browser-research`
   (SkillSpector + Gitleaks + SkillEvaluator), then commit the updated `config/skill-trust.json`. Until then
   the skill is UNATTESTED and selection falls back to `generic` with no browser capability.

## Runtime on the browser host (Haddad)

See `projects/mythos-haddad/docs/BROWSER.md` for the install, the user unit, the verification list and
the measured state. In short: `~/.local/opt/obscura-test/obscura serve --host 127.0.0.1 --port 9222` as the
user unit `obscura.service`, token in `~/.config/obscura/cdp.env` (0600, `OBSCURA_CDP_TOKEN` only), never
`--allow-private-network`, never `0.0.0.0`.

**Fallback configuration (no secret):** the launcher also sources `~/.config/mythos-browser/env` — before the
token file, and refused (exit 78) if it names any `OBSCURA_*` key — for `MYTHOS_PLAYWRIGHT_MODULE` (the
playwright-core module to resolve when it is not a project dependency) and `LD_LIBRARY_PATH` (user-space
copies of Chromium's host libraries on a host without root). Measured on Haddad 2026-09-28: with the
primary unreachable the same `extract` call answers `backend: playwright` (BROWSER.md §4b).

## Webinar recording — the honest answer

`bin/webinar-preflight.js` runs the ten-step SAFE TEST (open URL, session state, page loads, video
element, media availability, short test recording, file, duration > 0, a/v streams, cleanup) and prints
one JSON verdict. Steps 1–5 go through the BrowserAdapter. Steps 6–9 exercise the **capture layer**,
which is *not* the browser adapter: Obscura is a headless engine with no display and no audio device,
and CDP screencasts carry no audio, so browser navigation is not recording. The correct layer is
`ffmpeg` capturing a **visible** browser (x11grab of a display + a PulseAudio/PipeWire monitor
source). The preflight records from that layer when `--display` and `--pulse-sink` exist, and records
from a synthetic source otherwise — marking step 6 FAIL with the exact missing piece, so the gap is
found before the event, not during it.

## Tests

- `node tests/mythos-browser-mcp-test.js` — URL policy, ObscuraBackend over a real WebSocket to a fake bearer-protected CDP (`tests/support/fake-cdp-server.js`), Target-domain path, Playwright honesty, adapter policy/fallback (open failure, operation failure, hang → deadline, dropped socket), failure classification, the engine's private-address refusal never retried, click (landing re-check, bad selector not retried), the Playwright request guard (DNS stubbed), page-text normalization, stdio protocol, machine-readable tool errors, redaction (31 checks, mutation-checked).
- `node tests/mythos-browser-governed-test.js` — the whole governed chain offline: capability resolution, tool offer, direct governed invoke through the real launcher→server→CDP path, click through the SHIPPED matrix (`browser.interact` audited; refused to a read-only task), every refusal (no capability, undeclared tool, private URL), the shipped matrix per subject, the haddad-agent E2E with an injected model, **fail-closed** (both engines down + a model claiming `completed` → the run ends `blocked`), and the secret boundary (15 checks, mutation-checked).
- On the host: `node projects/mythos-browser-mcp/bin/browser-smoke.js https://example.com/ --full --require-backend obscura` — auth 401/401/200, Playwright `connectOverCDP` to Obscura (page, navigate, DOM, click, screenshot, disconnect), adapter navigate/extract/screenshot/click, no page left open.
- `node tests/mcp-ecosystem-test.js` §A now expects seven registered servers.
