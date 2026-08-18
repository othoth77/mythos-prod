# MYTHOS OS Command Center — Architecture

**Stage:** MOS-1
**Code:** `projects/mythos-os-console/`
**Tests:** `tests/mos-1-console-test.js` — 286 assertions
**Domain:** `os.mythosprod.xyz` (DNS resolves; not yet deployed)
**Design:** `docs/MYTHOS_OS_DESIGN_SYSTEM.md`

---

## 1. What this is

The operator-facing console for Mythos OS: one screen that answers *what is
the control plane doing right now*. It is the implementation of Phase 8 of
`docs/MYTHOS_AI_ORCHESTRATOR_MASTER_VISION.md` (§AE, previously
"DESIGNED — no implementation") and the first built surface of
`docs/MYTHOS_CONTROL_CENTER_PRODUCT_SPEC.md`.

### 1.1 What it is not

- **Not a control surface.** It cannot start, stop, approve, cancel, retry
  or reconfigure anything. §4 explains why that is structural rather than a
  missing feature.
- **Not the command library.** `projects/command-center/` at
  `ordre.mythosprod.xyz` is a searchable library of *commands* — a
  different product with a different domain and its own palette. The name
  collision is unfortunate and is worth knowing about; nothing is shared.
- **Not multi-user.** There is no login, because there is nothing to
  authorise: the console reads, and nginx plus the loopback binding are the
  access boundary. A real per-user model waits for a real Mythos identity
  service.
- **Not a second copy of anything.** Every value shown is read live from the
  executor or its config files. The console stores nothing. The portfolio
  already has four divergent palettes because copies drift; this one keeps
  no copy to drift.

---

## 2. Why this shape

The repository contains three production HTTP services built the same way.
MOS-1 follows them rather than introducing a stack:

| Concern | Choice | Precedent |
|---|---|---|
| HTTP | node `http`, no framework | `idauto/reference/api.js` |
| Front end | vanilla JS, no build step | `command-center/reference/web/` |
| Dependencies | **none** | — |
| Tests | plain `node tests/<stage>-test.js` | every suite in `tests/` |
| Process | user-scope systemd on `deploy` | `mythos-command-center.service` |
| Ingress | nginx reverse proxy + certbot | `ordre.mythosprod.xyz` |
| Credentials | `EnvironmentFile` outside the worktree | `/home/deploy/deployments/*/.env` |

No build tooling, no runtime dependency, no `package.json`. `node
reference/server.js` is the whole deployment.

---

## 3. Data sources

Two, and only two.

**The executor HTTP API**, over loopback, bearer-token authenticated. The
token is read from the environment or an `EnvironmentFile` and never leaves
the server process — the browser receives data, never a credential, and the
test suite asserts the token appears in no response body.

| Console route | Executor route |
|---|---|
| `GET /api/health` | `GET /health` (unauthenticated) |
| `GET /api/missions` | `GET /tasks` |
| `GET /api/campaigns` | `GET /campaigns` |
| `GET /api/events?limit=` | `GET /events?limit=` (clamped to 500) |
| `GET /api/budget` | `GET /budget/<project>` per project |

**Executor configuration files**, read-only from disk. These registries have
no HTTP surface, so the console reads the same files the executor reads.

| Console route | File |
|---|---|
| `GET /api/agents` | `config/agents.json` |
| `GET /api/providers` | `config/router.json` + `config/agents.json` |
| `GET /api/roadmap` | `config/roadmap-state.json` |
| `GET /api/modules` | `reference/web/modules.js` |

### 3.1 Decisions worth knowing

**The provider view is derived, not stored.** `/api/providers` groups the
agent registry by `provider` at read time. A stored provider list would be
a second truth that drifts from what actually runs.

**The agent registry is projected through an allowlist,** not passed
through. `agents.json` is operator-edited, so a credential added to it one
day must not become a public field the next. Ten fields are served; an
unrecognised field is dropped silently, and the allowlist is asserted
against the real file by the test suite. Showing less than the file holds
is the safe direction.

**Budget has no list endpoint,** so the console reads the project list from
`config/projects.json` and queries each ledger. A project whose ledger
cannot be read is shown **as unreadable, in place** — never dropped from
the list, which would understate spend.

**`limit` is clamped before it reaches the control plane,** not after. An
operations console must not be usable as an amplifier against the service
it observes.

---

## 4. The read-only property

This is the console's central governance claim, so it is enforced in four
independent places rather than asserted once:

1. `server.js` answers **405 to every method but GET and HEAD**, before any
   route is consulted. No handler can accidentally become a write path.
2. `server.js` **contains no request-body reader**. There is no `readBody()`
   in the file to call.
3. `upstream.js` **exposes GET only**. There is no method parameter.
4. `tests/mos-1-console-test.js` asserts all three **at source level**, in
   the same style MCC-1 uses to assert that it cannot execute a stored
   command. Adding a write surface fails the suite rather than shipping
   quietly.

**Why it matters.** Approvals, cancellation and campaign control are
governed actions. `AGENTS.md` §25.3 places LEVEL_3 actions behind explicit
owner approval that never executes automatically, and
`docs/MYTHOS_COMMAND_CENTER_ARCHITECTURE.md` §10 records that the approval
gate "is not optional and is not a prompt the system can answer itself".
Putting an approve button on a public domain would move that gate onto a
web surface. It stays where governance put it: the owner-operated CLI at
`projects/mythos-ai-executor/service/mythos-governance-approve.js`.

The console's job is to make it **obvious that a decision is waiting**, and
gold — the Mythos accent, reserved for exactly this — is how it does that.

---

## 5. Security model

| Control | Where |
|---|---|
| GET/HEAD only, refused before routing | `server.js` |
| No request body reader anywhere | `server.js` |
| No execution path (`exec`/`spawn`/`eval`/`Function`) | asserted at source level by the suite |
| Static files from an explicit whitelist, never a resolved path | `server.js` `STATIC` |
| XSS | the client never touches `innerHTML`/`outerHTML`/`insertAdjacentHTML`; all text goes through `textContent` |
| No inline script or inline style in the shell | asserted by the suite |
| Token confinement | read server-side; asserted absent from every response |
| Agent-registry field allowlist | `upstream.js` `AGENT_FIELDS` |
| Error opacity | upstream failures are reported as a class; no syscall, address or driver text reaches the client |
| Response ceiling | 4 MB from upstream |
| Loopback binding | `127.0.0.1` only; nginx is the sole public path |
| Transport headers | nosniff, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, COOP, CORP, `Cache-Control: no-store` |

### 5.1 The CSP font exception, stated plainly

```
default-src 'self'; script-src 'self';
style-src 'self' https://fonts.googleapis.com;
font-src  'self' https://fonts.gstatic.com;
img-src 'self' data:; connect-src 'self';
form-action 'none'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'
```

`script-src` and `object-src` are as strict as the sibling command-library
service. `style-src` and `font-src` are **wider**, and the reason is
recorded rather than buried: the Mythos OS brand system is set in Playfair
Display and Inter, which the production application loads from Google Fonts
(`index.html:19`). Serving the console in a different typeface to keep a
tighter CSP would break the one thing this stage exists to preserve.

The exposure is bounded — two font hosts, no script origin added — and
`mythos.css` carries full local fallback stacks, so a blocked font request
costs the typeface and nothing else. **Self-hosting the two families
removes the exception entirely** and is recorded as follow-up work in
`docs/MYTHOS_OS_DESIGN_SYSTEM.md` §12.

### 5.2 Why this service starts without a token

The sibling command-library service **refuses to start** without
`MCC_ADMIN_TOKENS`, because starting without auth would expose its write
surface. This one has no write surface, so starting without a token exposes
nothing. It comes up and reports `token_provisioned: false`, and every data
read returns `502 upstream_unauthorized` with a stated reason.

A console that starts and says what is wrong is more useful to an operator
than a unit that will not start. The asymmetry is deliberate, and it is
recorded in the systemd unit as well as here.

---

## 6. Failure semantics

The single most important interface rule:

> **An empty result and an unreadable one must never look alike.**

| Condition | HTTP | `error` | Rendered |
|---|---|---|---|
| Plane answered, nothing to show | 200 | — | `◌ No missions` |
| Plane not answering | 503 | `upstream_unreachable` | `⚠ Control plane unreachable` — "this is not an empty result; the current state is unknown" |
| Plane refused the token | 502 | `upstream_unauthorized` | `⚠ Console is not authorised` |
| Plane errored | 502 | `upstream_error` | `⚠ Read failed` |
| Config file unreadable | 503 | `config_unreadable` | `⚠ Read failed` |

No failure response carries a `data` field, so a client cannot mistake one
for a result. Config-backed modules (Agents, Providers, Roadmap) keep
working when the HTTP plane is down — a partially visible console is more
useful than a blank one, and the connection strip states which half is out.

---

## 7. Interface

Desktop-first, responsive to a phone, dark and gold — the Mythos OS system,
specified in `docs/MYTHOS_OS_DESIGN_SYSTEM.md`. No theme switch: Mythos OS
is a dark product (D-001) and offering a light mode would invent a visual
decision nobody made.

**Localisation.** English only, and honestly so. All inline-axis CSS uses
logical properties, so `dir="rtl"` is a one-attribute change when a locale
is added — but shipping a half-translated UI would be worse than English,
the same judgement MCC-1 made about Arabic.

**Modules.** Fourteen registered, eight built. The six planned modules show
what would back them (§9). Nothing renders invented data.

---

## 8. Scalability

`reference/web/modules.js` is the contract. One registry entry plus one
render function adds a module; the sidebar, router, page chrome and empty
states all follow automatically, and `mythos.css` is not touched. A module
with no renderer routes to the not-built surface, so a registry entry can
never be a broken route. See `docs/MYTHOS_OS_DESIGN_SYSTEM.md` §9.

---

## 9. Deliberately not implemented

| Module | Why, and what would back it |
|---|---|
| **Memory** | `projects/personal-intelligence` exposes no read API to this host. Needs an MPI retrieval endpoint. |
| **Governance** | `service/governance-verify.js` + `config/policy.json` are CLI-only. Needs a read endpoint; the CLI is authoritative. |
| **Approvals** | `service/mythos-governance-approve.js` is an owner-operated CLI **by design** (§4). A read-only pending list is possible; the decision surface is not. |
| **Secrets** | `aut_secret_references` (metadata only) is drafted in `projects/automation/database/control-plane-schema.sql` and not deployed. |
| **Sandbox** | `core/worktrees.js` does not report worktree lifecycle over HTTP. |
| **Settings** | Editing configuration is a write surface, excluded by §4. |

Nothing here pretends to be a feature in progress. Each entry names its
blocker.

---

## 10. Deployment

```
DNS  os.mythosprod.xyz  →  51.68.226.211        ← RESOLVES (corrected 2026-08-18)
  ↓
nginx  /etc/nginx/sites-enabled/os.mythosprod.xyz
  ↓  proxy_pass
127.0.0.1:8140   node  reference/server.js
  ↓  systemd --user (deploy), lingering enabled
127.0.0.1:8130   mythos-ai-executor  (read-only, bearer token)
```

- vhost source of truth: `deploy/nginx-os.mythosprod.xyz.conf`. certbot
  rewrites the installed copy when the certificate is issued; do not
  hand-write the 443 block.

### 10.0 A correction, recorded rather than quietly fixed

MOS-1 reported that `os.mythosprod.xyz` had no DNS record and named
creating one as the blocking owner action. **That was wrong.** The name
resolves to `51.68.226.211`, and two fabricated subdomains of
`mythosprod.xyz` return NXDOMAIN from the same resolver, so it is a real
record rather than a wildcard.

The claim was carried over from
`projects/command-center/deploy/nginx-ordre.mythosprod.xyz.conf`, whose
DNS prerequisite genuinely was unmet at the time it was written. It was
never checked by resolving the name. An unverified precondition copied
from a neighbouring document is exactly the failure `AGENTS.md` §2 is
about — *never rely exclusively on conversation summaries or an earlier
session* — and it is why
`projects/mythos-os-console/tools/host-preflight.sh` now exists: it
checks every precondition against the host instead of against a document,
and refuses to pass if one is missing.

**What this does not change:** the console is still not deployed, and this
session still cannot deploy it (§10.3).

### 10.2 Deployment runbook

Run on the VPS as `deploy`, in order. Nothing here is destructive; every
step is reversible and each one is checked before the next.

```bash
# 0. Preflight. Read-only; installs and starts nothing.
bash projects/mythos-os-console/tools/host-preflight.sh

# 1. Tests, on the host that will run it.
node tests/mos-1-console-test.js            # expect: 322 passed, 0 failed

# 2. Credentials. Outside the worktree, 0600, never echoed.
install -d -m 700 /home/deploy/deployments/mythos-os-console
printf 'MOS_EXECUTOR_TOKEN=%s\n' "$(read -rs T; echo "$T")" \
  > /home/deploy/deployments/mythos-os-console/.env
chmod 600 /home/deploy/deployments/mythos-os-console/.env

# 3. The service, before nginx — so the vhost never proxies to nothing.
mkdir -p ~/.config/systemd/user
cp projects/mythos-os-console/deploy/mythos-os-console.user.service \
   ~/.config/systemd/user/mythos-os-console.service
systemctl --user daemon-reload
systemctl --user enable --now mythos-os-console
systemctl --user status mythos-os-console --no-pager

# 4. Smoke-test on loopback before exposing anything publicly.
curl -fsS http://127.0.0.1:8140/api/health | head -20
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8140/
curl -fsS -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:8140/   # expect 405
```

Steps 5–7 need root, which `deploy` does not have for file writes — its
sudo grant is exactly `nginx -t`, `systemctl reload nginx` and `certbot`.

```bash
# 5. vhost (root)
cp projects/mythos-os-console/deploy/nginx-os.mythosprod.xyz.conf \
   /etc/nginx/sites-available/os.mythosprod.xyz
ln -s /etc/nginx/sites-available/os.mythosprod.xyz /etc/nginx/sites-enabled/

# 6. Validate and reload. `nginx -t` first, always — a bad config would
#    take the six neighbouring sites down with it.
sudo nginx -t && sudo systemctl reload nginx

# 7. TLS. Dry run first, exactly as MCC-1 did for ordre.mythosprod.xyz.
sudo certbot --nginx -d os.mythosprod.xyz --dry-run
sudo certbot --nginx -d os.mythosprod.xyz
```

```bash
# 8. Post-deploy verification.
bash projects/mythos-os-console/tools/host-preflight.sh   # expect 0 blocking
curl -fsS https://os.mythosprod.xyz/api/health
curl -sS -o /dev/null -w '%{http_code}\n' -X POST https://os.mythosprod.xyz/   # expect 405
for h in ordre panel tv; do curl -sS -o /dev/null -w "$h %{http_code}\n" "https://$h.mythosprod.xyz/"; done
```

**Rollback**, at any point, in one step each: `systemctl --user disable
--now mythos-os-console`; `rm /etc/nginx/sites-enabled/os.mythosprod.xyz
&& sudo nginx -t && sudo systemctl reload nginx`. The console has no
database and writes nothing, so there is no data to unwind.

### 10.3 Why this session cannot run any of it

Not a permission question — a location one. This session runs in an
ephemeral remote container, not on the VPS: `/home/deploy`, `/etc/nginx`
and `/srv/mythos` do not exist here. The environment's network policy also
refuses the production hosts outright (`x-deny-reason: host_not_allowed`
from the agent proxy, for `os.mythosprod.xyz` and the confirmed-live
`ordre.mythosprod.xyz` alike), so the host cannot even be inspected from
here, let alone changed.

Everything that can be prepared off-host has been: the runbook above, the
preflight script, the vhost, the unit, and a suite that passes.
- unit source of truth: `deploy/mythos-os-console.user.service`. The three
  hardening directives that cannot work under a user manager on this host
  are omitted deliberately, for the reasons recorded in
  `docs/MYTHOS_COMMAND_CENTER_ARCHITECTURE.md` §11.1.

### 10.1 Environment

| Variable | Default | Purpose |
|---|---|---|
| `MOS_PORT` | `8140` | listen port |
| `MOS_BIND` | `127.0.0.1` | listen address |
| `MOS_EXECUTOR_URL` | `http://127.0.0.1:8130` | control plane |
| `MOS_EXECUTOR_TOKEN` | — | bearer token |
| `MOS_EXECUTOR_TOKEN_FILE` | — | file holding `MYTHOS_EXECUTOR_TOKEN=…` |
| `MOS_EXECUTOR_CONFIG_DIR` | `../../mythos-ai-executor/config` | registry files |
| `MOS_UPSTREAM_TIMEOUT_MS` | `8000` | upstream timeout |

No variable holds a secret except the token, which is never logged and
never serialised into a response.

---

## 11. Testing

`tests/mos-1-console-test.js` — **286 assertions**, deterministic, offline,
no database, no executor, no AI quota. A stub control plane stands in for
the executor.

Four groups:

1. **Design-system fidelity.** Every D-001 colour is read out of
   `css/main.css` at test time and matched against `mythos.css`. The values
   are not retyped into the test, so if the product stylesheet ever changes,
   the suite reports that the console has drifted from the brand system —
   the alarm the recovery audit says this portfolio has never had. Also
   asserts the recovered typography, the recovered component idioms, and
   that the composition layer contains **no colour literal at all**.
2. **The read-only property, at source level** (§4), plus the XSS and
   no-execution guarantees.
3. **The module registry** — the owner's fourteen modules, unique route
   segments, a named data source for every module including planned ones,
   a renderer for every live module, and **no renderer for any planned
   one**, so a planned module cannot quietly start showing data.
4. **HTTP behaviour**, including the failure cases: no token, unreachable
   plane, method refusal, path traversal, limit clamping, and the assertion
   that the token appears in no response body and no error detail.

```bash
node tests/mos-1-console-test.js
```

### 11.1 Visual verification

Applies **D-010**, the portfolio's only proven design-QA method. Three
defects were found in the rendered page that source review had not — the
mobile drawer could not be opened, two dead `style=""` attributes tripped
the console's own CSP, and the timestamp read the wrong envelope field. All
three are detailed in `docs/MYTHOS_OS_DESIGN_SYSTEM.md` §10.

The harness drives headless Chromium across 1440 / 1100 / 390 px and nine
routes, checking horizontal overflow, empty renders, page and console
errors, drawer behaviour, and the **computed** brand values. It is not
committed: it depends on a browser that is not a project dependency, and
the repository has no browser-test runner. The method, its findings and its
assertions are recorded so the next stage can rerun it.

**Recommendation: adopt D-010 as standard (O-009).** Owner decision.
MOS-1 is the second data point in its favour.
