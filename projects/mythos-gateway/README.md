# MYTHOS Gateway

One HTTPS door in front of the MCP servers MYTHOS already runs.

```
ChatGPT ─┐
         ├── HTTPS ──▶ nginx /gateway/ ──▶ ContextForge ──┬──▶ MYTHOS MCP  (existing, read-only)
Claude ──┘            (apex certificate)   (loopback)     └──▶ GitHub MCP  (official, write-capable)
```

## What this is not

Not a new MCP server. Not a replacement for OTH MCP, OTHMODE, the Executor,
Governance or the Budget ledger. It federates; it does not reimplement. Every
tool it serves is produced by a server that already existed, and the answer is
returned unmodified.

**The existing stdio path is untouched.** `ssh deploy@host
/home/deploy/deployments/oth-mcp/oth-mcp-stdio.sh` remains the supported
standalone route and does not pass through any of this. If the gateway is
stopped, removed or fails, that path still works — which is the point of
keeping it.

## The three parts

| Part | Where | What it does |
|---|---|---|
| `mcp-http-bridge.js` | host, systemd `mythos-mcp-http`, `127.0.0.1:8160` + `10.0.60.1:8160` | Speaks MCP Streamable HTTP; relays to the existing stdio server |
| ContextForge | container `mythos-contextforge`, `127.0.0.1:4444` | Federation, authentication, per-client credentials, audit |
| GitHub MCP | container `mythos-github-mcp-rw`, `10.0.60.3:8082` | The official server, write-capable, no port published |

### Why a bridge, and why it is not a second MCP

ContextForge federates peers over HTTP. OTH MCP speaks stdio and must keep
speaking stdio. The gap is transport only, so the bridge is transport only: it
**declares no tool, defines no schema, reaches no upstream and holds no
authority**. `tests/gateway-boundary-test.js` §1 asserts that as data — if the
bridge ever names a MYTHOS tool, the suite fails.

The official `mcpgateway.translate` was the obvious alternative. It is a Python
module inside the gateway image, so reaching a host-side node process from it
means either installing the full FastAPI dependency tree on the host or handing
an SSH key to a container. Both add credential surface to solve a transport
problem. The bridge is ~200 dependency-free lines under the same account,
launching the same script.

### Why a path and not a subdomain

`mythosprod.xyz` is served by OVH DNS and **no OVH API credential exists on
this host**, so creating `mcp.mythosprod.xyz` is an owner action. A path on an
existing certificate is not. ContextForge is told `APP_ROOT_PATH=/gateway` so
it builds its own URLs correctly behind the prefix.

If the owner later adds the DNS record, moving to a dedicated vhost is a
certbot run and a one-line change to `APP_ROOT_PATH`.

## Layout

```
repository (source of truth)
  projects/mythos-gateway/mcp-http-bridge.js         the transport
  projects/mythos-gateway/docker-compose.yml         the topology
  projects/mythos-gateway/contextforge.env.example   every variable, no value
  projects/mythos-gateway/nginx/gateway-location.conf
  projects/mythos-gateway/systemd/mythos-mcp-http.service
  tests/gateway-boundary-test.js                     the boundaries, as data

host (secrets, never committed)
  /home/deploy/deployments/mythos-gateway/contextforge.env   0600 deploy
  /home/deploy/deployments/mythos-gateway/mcp-http.env       0600 deploy
  /home/deploy/deployments/mythos-gateway/data/mcp.db        the whole state
```

## Security posture

- **No public port.** ContextForge binds loopback; the GitHub MCP container
  publishes nothing at all. nginx is the only route in.
- **No docker socket.** A container that can reach the daemon socket is root on
  the host. Neither container can.
- **No root.** ContextForge runs as uid 10001, both containers drop every
  capability, the bridge unit runs as `deploy` under `ProtectSystem=strict`.
- **Admin surfaces off, twice.** `MCPGATEWAY_UI_ENABLED=false` and
  `MCPGATEWAY_ADMIN_API_ENABLED=false` in the gateway; `/gateway/admin` returns
  404 at nginx regardless.
- **SSRF protection on, one network allowed.** Private destinations are blocked
  except `10.0.60.0/24` — the gateway's own network. The databases, the other
  containers and the cloud metadata endpoint are not reachable from a URL
  registered in the gateway.
- **Credentials never reach a client.** ChatGPT and Claude authenticate with
  their own gateway credential. The GitHub credential and the bridge credential
  live server-side; no client ever sees either.
- **Image pinned by digest.** `latest` is a moving tag and this is production.

## Two operational facts worth knowing

**Migrations must run once, single-process.** ContextForge auto-detects nine
gunicorn workers on this host and they race their own Alembic migration,
leaving `id_new` half-applied and the container in a boot loop. Run
`python3 -m mcpgateway.bootstrap_db` in a one-shot container **before** the
first `compose up`, and keep `GUNICORN_WORKERS=2`.

**The stdio server exits when its stdin closes.** `projects/oth-mcp/server.js`
calls `process.exit(0)` on stdin `end`, which kills in-flight tool calls. A
real client holds stdin open, and so does the bridge — but a probe that pipes
its requests and closes will see `initialize` and `tools/list` answer and every
tool call vanish. That is the probe's bug, not the server's.

## Rollback

The gateway adds; it does not modify. Removing it restores the previous state
exactly:

```bash
cd /home/deploy/deployments/mythos-gateway && docker compose down
systemctl disable --now mythos-mcp-http.service
# remove the /gateway/ block from /etc/nginx/sites-available/mythosprod.xyz
nginx -t && systemctl reload nginx
```

The existing `mythos-github-mcp` (read-only, `127.0.0.1:8082`), the stdio
launcher, OTHMODE, the Executor, Governance, the Budget ledger and every
production service are untouched by all four commands.

## Registry, permissions, check (MCP-ECOSYSTEM-1, 2026-09-02)

The gateway federates; three small files beside it say **what exists, what is
allowed, and what is actually up** — for every MCP server in the estate, not
only the ones ContextForge serves.

| File | What it is | Who reads it |
|---|---|---|
| `registry/mcp-registry.json` | the estate MCP registry — every server, its purpose, direction, transport, auth REQUIREMENT, declared tools, enabled state, consumers. Metadata only; credentials by Vault reference (`cred_…`) | `lib/mcp-registry.js` (fail-closed loader), OTHMODE `registries.js`, the executor's `lib/mcp-invoke.js`, `bin/mcp-registry-check` |
| `registry/mcp-permissions.json` | the permission matrix — subject × capability → `ALLOW` / `CONTROLLED` / `RESTRICTED` / `DENY`, plus the tool-class table that maps `server.tool` onto capabilities. `destructive` is `DENY` by hard floor; an unnamed tool is denied | `lib/mcp-policy.js` (`authorize`), the executor before every call, the check to flag exposed-but-denied tools, OTHMODE for its `authorized` flag |
| `bin/mcp-registry-check` | measures every registered server with a real handshake and writes the snapshot `deployments/mythos-gateway/mcp-registry-status.json` — `ONLINE` / `DEGRADED` / `OFFLINE` / `UNAUTHORIZED` / `ERROR`, declared-vs-discovered drift, policy and credential findings. A `--server` run merges into the snapshot; the snapshot never carries a credential | OTHMODE (`/api/othmode/mcp`, and the `available` / `healthy` flags in `/api/othmode/tools`), the executor (`GET /mcp/registry`), humans |

**Registration is a claim; the check is the measurement.** OTHMODE shows five
states per tool and never conflates them: *registered* (named in a registry),
*available* (discovered on a live server at the last check), *healthy* (that
server was `ONLINE`), *authorized* (the matrix answers for the reading
subject), *executable* (all four, and no credential the reader would have to
hold). Absent snapshot ⇒ the measured three are `null`, not green.

**Running the check.** `bin/mcp-registry-check.sh` exports exactly three names
from the 0600 env files (bridge bearer, gateway admin email and password),
execs the checker, and writes the snapshot. As `deploy`:

```bash
/home/deploy/deployments/mythos-gateway/mcp-registry-check.sh            # whole estate
/home/deploy/deployments/mythos-gateway/mcp-registry-check.sh --server contextforge
```

`systemd/mythos-mcp-registry-check.{service,timer}` run it every five
minutes. Installing them is a root action (`install` into
`/etc/systemd/system`, `daemon-reload`, `enable --now …timer`); until
`main` carries `projects/mythos-gateway`, point the unit at the checkout that
does with a drop-in `Environment=MYTHOS_MCP_REGISTRY_CHECK=<path>`.

**Executing through the gateway as a client** needs an *issued* gateway
token (`cred_contextforge_executor_client` in the Vault inventory). The
platform-admin credential verifies the gateway; it is never used as a client
identity, and `lib/mcp-registry.js` refuses a registry that makes them the
same reference.

**The client.** `lib/mcp-client.js` is the transport half of the OTH MCP
decision: dependency-free JSON-RPC over stdio or Streamable HTTP (JSON and SSE
answers), every wait and every body bounded, holding no policy and logging
nothing. The governed use of it lives in the executor —
`projects/mythos-ai-executor/lib/mcp-invoke.js`, exposed as
`POST /mcp/invoke` — because the executor is MYTHOS' only execution engine.

`tests/mcp-ecosystem-test.js` drives all of it against fixtures (167
assertions); `tests/gateway-boundary-test.js` is unchanged and still pins the
bridge as a pure transport.
