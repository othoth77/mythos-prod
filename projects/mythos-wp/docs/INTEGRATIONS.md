# MYTHOS WP V2 — Integrations

`wp_integrations` is the registry of every external system the Control Center talks to. A row holds a non-secret location (loopback `http` or `https` only), the **name** of the environment variable that references a credential (a value or a 0600 file path), non-secret `config`, and the last probe result. Module `reference/integrations.js`; UI **Integrations**; routes `routes/platform.js`. Companion: `ENVIRONMENT.md`, `MCP.md`, `OPERATIONS.md` §3 (health).

## 1. Seeded rows (`integrations.ensureDefaults`, at every boot, only when the key is missing)

| Key | Kind | Base URL | Credential (env NAME) | Status | Purpose |
|---|---|---|---|---|---|
| `evolution` | `whatsapp_provider` | `http://127.0.0.1:8080` | `MYTHOS_WP_EVOLUTION_API_KEY_FILE` | enabled | production WhatsApp transport (unofficial); `config { provider:'evolution', official:false }` |
| `kitchen-mythos-auto` | `kitchen` | `http://127.0.0.1:3011` | — | enabled | Kitchen Mythos Auto (`projects/ssangyong-autos`), read-only, `config { contract:'1.3.0', read_only:true }` |
| `n8n` | `n8n` | `http://127.0.0.1:5678` | — | enabled | `config { webhook_base:'http://127.0.0.1:5678/webhook' }` |
| `meta-cloud-api` | `whatsapp_provider` | `https://graph.facebook.com` | `MYTHOS_WP_META_ACCESS_TOKEN_FILE` | **disabled** (until configured) | official WhatsApp Cloud API; `config { provider:'meta_cloud', official:true, graph_version:'v21.0' }` |
| `meta-whatsapp-business-mcp` | `mcp` | `https://mcp.facebook.com/whatsapp_business_tools` | — (`credentials_state missing`) | **disabled** | official Meta MCP for AI/developer operations; `config { transport:'streamable-http', auth:'oauth (Facebook Login for Business)', scopes:[business_management, whatsapp_business_management, whatsapp_business_messaging], tool_namespace:'whatsapp_biz_', tools:[…], purpose:'AI/developer operations only — never runtime customer messaging', docs }` — see `MCP.md` |
| `mythos-mcp` | `mcp` | `https://mythosprod.xyz/mcp` | — | enabled | MYTHOS MCP gateway (ContextForge, OAuth via Dex, owner identity) |
| `free-llm-pool` | `llm` | — | — | enabled | `config { registry:'projects/mythos-ai-executor/free-llm' }`; Groq active in production |
| `database` | `database` | — | — | enabled | `mythos_wp` itself |

Kinds: `whatsapp_provider | kitchen | n8n | mcp | api | project_system | database | llm`. A row may be platform-wide (`project_id NULL`) or scoped to one project.

## 2. API (`routes/platform.js`)

| Route | Role |
|---|---|
| `GET /api/integrations` | any → non-secret rows + `health_state`, `health_detail`, `credentials_state`, `last_ok_at`, `last_error`, `last_checked_at` |
| `POST /api/integrations` | admin (409 on a duplicate key) |
| `PATCH /api/integrations/:key` | admin |
| `DELETE /api/integrations/:key` | owner |
| `POST /api/integrations/:key/test` | admin → runs the probe now → `{ status, detail, checked_at }` and records it |

Validation (`integrations.validate`): key `^[a-z0-9][a-z0-9-]{1,62}$`; `base_url` http(s) only, plain http on loopback only, no user:pass in the URL, ≤ 255 chars; `credential_env` must be an env NAME (`^[A-Z][A-Z0-9_]{2,62}$`); `config` ≤ 16 KiB and refused when a key looks like `token|secret|password|api_key|credential`.

`credentials_state` = `present | missing | not_required | unknown`: computed from the presence of the variable and, for a path value, from the file existing with mode 0600 — the value is never read for this. The only time a credential is read is the Evolution probe, which sends it as the `apikey` header to the provider itself.

## 3. Probes (`integrations.probe`, 4 s timeout, loopback http or https only)

| Kind | Probe | ok | warning | error / disconnected |
|---|---|---|---|---|
| `whatsapp_provider` (evolution) | `GET /instance/fetchInstances` with the key | 2xx → `{ instances, open, latency_ms }` | — | 401/403 `UNAUTHORIZED`; unreachable → `disconnected` |
| `whatsapp_provider` (meta_cloud) | generic GET of the base | any < 400 or 401/403/405 | 4xx | 5xx |
| `kitchen` | `GET /api/health` | 2xx with `status:'ok'` or `counts` → `{ status, counts, read_only, latency_ms }` | — | other |
| `n8n` | `GET /healthz` | 2xx | other HTTP | unreachable |
| `mcp` | GET of the endpoint | **any HTTP answer** (401/405/406 included) = reachable | non-loopback plain http (not probed) | unreachable |
| `llm` | `free-llm/registry.listEntries()` | ≥ 1 wired provider with a key → `{ providers, wired, with_key, keyed_ids }` | none keyed (`NO_PROVIDER_KEY`) / registry unavailable | — |
| `database` | `SELECT 1` | latency | — | query failed |
| other | generic GET | see meta_cloud row | | |

`integrations.record()` writes `health_state`, `health_detail` (≤ 300 chars), `last_checked_at`, `last_ok_at`, `last_error`, `credentials_state`. The health center (`health.js`) runs every enabled row on its schedule and maps them to components `whatsapp:<key>`, `kitchen:<key>`, `ai`, `integration:<key>` (`OPERATIONS.md` §3).

## 4. n8n

n8n runs on `127.0.0.1:5678` (workflows: MYTHOS task intake / execute / report / quota, SSANGYONG scrapers). WP integrates it in two ways:

1. the `n8n` integration row — health probe on `/healthz`, `config.webhook_base` (default `http://127.0.0.1:5678/webhook`);
2. the automation action `n8n_webhook { path, include_text? }` (`automations.js`): `POST <config.webhook_base>/<path>` (fallback `<base_url>/webhook/<path>`) with JSON `{ event, project_id, conversation_id, contact_masked, intent }`, 5 s timeout; the message text (≤ 4000 chars) is included **only** when `include_text === true`.

WP never reads n8n credentials; a workflow that must call back into WP uses the session-less receiver (webhooks) or a panel account through the API.

## 5. Kitchen

The `kitchen-mythos-auto` row is what `kitchen.js#forProject` resolves for a project whose `settings.kitchen` names it (default for `automotive`). Change `base_url` here to point automotive projects at another Kitchen; set the row `disabled` to make every Kitchen consumer degrade (`{ configured:false }`, `KITCHEN_NOT_CONFIGURED`). Read-only by construction: the client has no method that writes. Contract 1.3.0 routes: `ARCHITECTURE.md` §6.

## 6. Free-LLM pool

The `free-llm-pool` row only records the pool registry path and the probe result. Keys live in the pool's key directory (`MYTHOS_FREE_LLM_KEY_DIR`) and are read by `projects/mythos-ai-executor/free-llm/secrets.loadKey` at call time; WP shows `credential_present` per provider (`GET /api/ai/status`) and never the key. Provider selection: `selector.selectCandidates({ modality:'chat' })`; an agent's `model` (`provider/model` or model id) is preferred when wired and keyed.

## 7. MCP servers

`meta-whatsapp-business-mcp` and `mythos-mcp` are **reachability records** for the health center; WP implements no MCP client and invokes no tool at runtime. What each one is, is not, and the owner OAuth step: `MCP.md`.

## 8. Adding an integration

`POST /api/integrations { key, kind, name, base_url, credential_env?, config?, status?, project_id? }`. Put the credential in the 0600 env (a value) or a 0600 file and name that variable in `credential_env`; then `POST /api/integrations/:key/test`. Rows of kind `api` / `project_system` get the generic GET probe.
