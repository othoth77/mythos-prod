# MYTHOS WP V2 — MCP servers

Two MCP servers appear in the Control Center. Both are **integration records with a reachability probe**; WP contains no MCP client, invokes no MCP tool at runtime, and never sends a customer message through an MCP. Companion: `INTEGRATIONS.md`, `WHATSAPP_SETUP.md` §7, `SECURITY.md`.

## 1. Meta — WhatsApp Business Tools MCP (official, beta)

| | |
|---|---|
| Endpoint | `https://mcp.facebook.com/whatsapp_business_tools` |
| Transport | Streamable HTTP |
| Status | beta (launched 2026-09-15) |
| Auth | OAuth via **Facebook Login for Business**; scopes `business_management`, `whatsapp_business_management`, `whatsapp_business_messaging` |
| Tools | namespace `whatsapp_biz_*` (businesses, accounts, phone numbers, add / verify / register phone number, list / get / create / update / delete template, send message, configure webhooks, subscribe webhook, configure payments, verify business, system-user token). The seeded row lists the names read from the documentation page on 2026-09-17 (18 names); nothing is invented to reach a count |
| Docs | https://developers.facebook.com/documentation/mcp/whatsapp-business-tools-mcp |
| Integration row | `meta-whatsapp-business-mcp` (kind `mcp`, status `disabled`, `credentials_state missing`) |
| Panel surface | `GET /api/whatsapp/mcp` (any) → `comms/meta-mcp.js#describe()` (`endpoint, transport, status:'beta', auth, scopes, tool_namespace, tools, tools_documented, docs, claude_code_command, purpose, owner_step, reachable, probed_at, http_status`) + the integration row; `POST /api/whatsapp/mcp/probe` (admin) → HTTPS GET of the endpoint, any HTTP status (401/405 included) = reachable, recorded as health component `integration:meta-whatsapp-business-mcp`. UI: WhatsApp → MCP |

### What it is

An **AI / developer operations tool** for the Meta side of a WhatsApp Business setup: creating and verifying phone numbers, registering them on the Cloud API, managing message templates, configuring and testing webhooks, troubleshooting. It is meant to be used from an AI coding session (Claude Code) by the owner, with the owner's Facebook Business identity.

### What it is NOT

- **Not the production messaging path.** Customer messages flow Evolution API (today) or WhatsApp Cloud API (`meta_cloud`, when configured) → receiver → routing → core → outbound. `whatsapp_biz_send_message` is a developer test tool; WP never calls it and no automation, agent or template action reaches it.
- **Not a credential holder.** No token, no OAuth grant, no session of this MCP is stored in WP, in its env, or in the database.
- **Not required** for Evolution-based operation; useful only when moving a number to the official Cloud API.

### Connecting it — owner OAuth step

```bash
claude mcp add --transport http whatsapp_business_tools https://mcp.facebook.com/whatsapp_business_tools
# then inside the Claude Code session:
/mcp        # authenticate: Facebook Login for Business, grant the three scopes
```

Use it from that session for the Meta-side steps of `WHATSAPP_SETUP.md` §7 (phone verification, Cloud API registration, template submission, webhook subscription to `https://wp.mythosprod.xyz/hooks/meta_cloud`). What WP needs afterwards is only: the three 0600 files (`MYTHOS_WP_META_*_FILE`), the `phone_number_id` (as the number's `instance`) and the WABA id (as the account's `external_ref`). Never paste a token into the panel, an integration `config`, a ticket or a commit.

Least privilege: grant the OAuth scopes to the owner's identity only; do not create a system-user token for WP unless the Cloud API is being activated, and then store it only in the 0600 file named by `MYTHOS_WP_META_ACCESS_TOKEN_FILE`.

## 2. MYTHOS MCP (ContextForge gateway)

| | |
|---|---|
| Endpoint | `https://mythosprod.xyz/mcp` |
| Transport | Streamable HTTP |
| Auth | OAuth through the mcp-auth-proxy + Dex (one owner identity); the owner password login is the manual step |
| Integration row | `mythos-mcp` (kind `mcp`, enabled) — probed by the health center as `integration:mythos-mcp` (any HTTP answer = reachable) |
| Purpose | the group's MCP gateway for Claude Web / Claude Code sessions (knowledge, project context, system health, execution status …) |

WP does not call it. The row exists so that the Health center shows whether the gateway answers, alongside the other MYTHOS surfaces.

## 3. Rules for any MCP in this panel

1. A `wp_integrations` row of kind `mcp` records endpoint, transport, auth kind, scopes and tool names — **never** a token (`config` refuses credential-shaped keys).
2. The only network access WP performs against an MCP endpoint is an unauthenticated HTTPS `GET` for reachability.
3. Tool invocation is an owner act in an interactive session, under the owner's identity, with the minimum scopes; it is never scripted from WP, an automation or an agent.
4. Anything an MCP produces that WP needs (ids, template names, webhook status) is entered as non-secret data through the panel or the CLI.
