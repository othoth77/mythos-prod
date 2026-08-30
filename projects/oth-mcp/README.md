# OTH MCP

The controlled **read** interface over existing MYTHOS capabilities.

```
AI client (ChatGPT / Claude / other)
        │  JSON-RPC 2.0 over stdio
        ▼
     OTH MCP            ← holds no data, no state, no authority of its own
        │
        ├── OTH Knowledge  (via the read-only HTTP facade, :8150)
        ├── OTHMODE        (control-plane read model, :3021)
        ├── Mythos AI Executor (execution truth, :8130)
        └── Status Center  (observability)
```

## What it is not

Not a database. Not a memory engine. Not an identity system. Not an executor.
Not a replacement for OTHMODE or Mythos OS. Not a second knowledge engine.

It stores nothing. Every tool resolves to a system that already owns the data,
over an interface that already exists. **If a tool cannot name the system it
routes to, it does not belong here.**

## Tools (7, all read-only)

| Tool | Owner | Returns |
|---|---|---|
| `knowledge_search` | OTH Knowledge | curated knowledge with provenance |
| `knowledge_get` | OTH Knowledge | one record + provenance / evidence / history |
| `project_context` | `projects/meta` via OTHMODE | portfolio, status, current stage |
| `capability_registry` | OTHMODE unified read model | skills · tools · providers |
| `execution_status` | Mythos AI Executor | tasks, or one task |
| `execution_report` | Mythos AI Executor | a completed task's structured report |
| `system_health` | Status Center | live estate health |

## The write boundary

**Version 1 is read-only. There is no tool that writes and no code path that
could** — the only upstream verb in `server.js` is `GET`, asserted by
`tests/othk-6-mcp-server-test.js` §W.

That is not a limitation to be removed casually. Execution, curation and
evolution each already have a gate:

- **execution** — executor policy engine + `core/budget.js` (deny-by-default)
- **curation** — `othk-cli`, operator-only; a report is a claim until a human
  curates it
- **evolution** — OTHMODE `evolution.addStage`, HIGH-risk approval is
  owner-identity only

A future write increment must route **through** those gates, never around
them. Adding a tool that bypasses one would defeat the reason this server is
thin.

## Semantic contract given to every client

The `initialize` response states it, so a client cannot miss it:

> Knowledge search returns **CLAIMS as claims** — a claim is asserted, never
> established. Execution reports are claims about what happened. Nothing here
> writes.

## Configuration

Each upstream is reached with **its own** token, from the environment. Nothing
is committed. An upstream without a token is reported as unavailable — a tool
never degrades into a guess.

```
OTH_MCP_KNOWLEDGE_URL     default http://127.0.0.1:8150
OTH_MCP_KNOWLEDGE_TOKEN   required for knowledge_* tools
OTH_MCP_OTHMODE_URL       default http://127.0.0.1:3021
OTH_MCP_OTHMODE_TOKEN     required for project_context, capability_registry
OTH_MCP_EXECUTOR_URL      default http://127.0.0.1:8130
OTH_MCP_EXECUTOR_TOKEN    required for execution_*
OTH_MCP_STATUS_URL        default https://status.mythosprod.xyz (public)
```

## Running it

Every upstream binds loopback on the VPS, and this server speaks stdio, so the
client runs it **over SSH** — no new public port, no new attack surface:

```json
{
  "mcpServers": {
    "oth": {
      "command": "ssh",
      "args": ["deploy@51.68.226.211",
               "/home/deploy/deployments/oth-mcp/oth-mcp-stdio.sh"]
    }
  }
}
```

Tokens live in the `deploy` environment on the host, never in the client
config.

### Why a launcher and not `node server.js`

`ssh host command` runs a **non-interactive** shell, so `~/.bashrc` returns
before exporting anything — the per-upstream tokens would never reach the
process, and every credentialed tool would report its upstream unavailable.
`deployments/oth-mcp/oth-mcp-stdio.sh` sources them from a 0600 env file
beside it and `exec`s the server on the same stdio. It opens no port and
grants no authority; it is the same runtime-config pattern the
`oth-knowledge-http` deployment already uses.

### Deployed paths (verified 2026-08-30)

| | Path |
|---|---|
| Server | `/home/deploy/oth-mcp/projects/oth-mcp/server.js` |
| Launcher | `/home/deploy/deployments/oth-mcp/oth-mcp-stdio.sh` (0750, `deploy`) |
| Environment | `/home/deploy/deployments/oth-mcp/.env` (0600, `deploy`, never committed) |

The server lives in the `/home/deploy/oth-mcp` worktree, which is checked out
at the branch that carries it — the same worktree the running
`oth-knowledge-http.service` executes from. It is **not** under
`/home/deploy/projects/mythos-prod`: that worktree tracks `main`, which does
not carry `projects/oth-mcp`. Pointing a client there yields "Cannot find
module".

## Why no `@modelcontextprotocol/sdk`

Measured on 2026-08-30, not assumed:

| | Official SDK | This implementation |
|---|---|---|
| Packages installed | **91** | **0** |
| `node_modules` | **24 MB** | — |
| Pulls in | express, hono, cors, jose, eventsource, pkce-challenge, ajv, zod, … | — |
| Protocol surface actually used | `initialize`, `tools/list`, `tools/call` | the same three |

The SDK is mature, official and MIT — it was evaluated seriously, not
dismissed. The decision against it rests on proportion: its HTTP/OAuth/SSE
half exists for transports this server does not use, and 91 transitive
packages is a real supply-chain surface for a component sitting in front of
personal knowledge, in a repository whose `oth-knowledge` and
`mythos-ai-executor` cores carry **no dependencies at all**.

Newline-delimited JSON-RPC 2.0 over stdio is small and stable. It is
implemented here in one dependency-free file and verified by a suite that
drives it as a real client would.

**Revisit this** if the server ever needs HTTP/SSE transport, OAuth, or
resource subscriptions — at that point the SDK earns its footprint and the
decision should flip.

## Tests

```bash
node tests/othk-5-http-facade-test.js   # the OTH Knowledge facade  (44)
node tests/othk-6-mcp-server-test.js    # this server, over stdio   (36)
```
