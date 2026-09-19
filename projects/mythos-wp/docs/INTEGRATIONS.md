# MYTHOS WP V2.1 — Integrations

`wp_integrations` is the registry of every external system the Control Center talks to. A row holds a non-secret location (loopback `http` or `https` only), the **name** of the environment variable that references a credential (a value or a 0600 file path), non-secret `config`, and the last probe result. Module `reference/integrations.js`; routes `routes/platform.js`; UI **Settings → Integrations**. Companion: `ENVIRONMENT.md`, `MCP.md`, `OPERATIONS.md` §3 (health).

## 1. Settings → Integrations (the cards)

Five cards, each **Name · Status · Configure**, built from the rows by kind:

| Card | Rows shown (by kind / key) | Status badge | Actions |
|---|---|---|---|
| **Meta / WhatsApp** | every `whatsapp_provider` row: `evolution` (production), `meta-cloud-api` (disabled until configured) | Off (row disabled) · Connected (probe ok) · Not reachable (error / disconnected) · Not configured (credential missing) | **Test** (admin, runs the probe now), **Configure** (admin) |
| **Kitchen Mythos Auto** | kind `kitchen` (`kitchen-mythos-auto`) | same | Test, Configure |
| **n8n** | kind `n8n` | same | Test, Configure |
| **AI provider** | kind `llm` (`free-llm-pool`) | same | Test, Configure |
| **Meta WhatsApp MCP** | kind `mcp` whose key contains `whatsapp` (`meta-whatsapp-business-mcp`) | the MCP panel: **Status** (row status + reachable / unreachable / not probed) · **Last check** · **Connect** (the owner OAuth step and the `claude mcp add …` command) · **Probe** (admin) · **Meta docs**; endpoint, transport, auth, scopes and the tool list only under the card's **Advanced** fold — `MCP.md` | Configure (admin) |

Each row line shows the host of `base_url` and "checked … ago". A card whose kind has no row says *Not registered on this server*.

**Advanced** (fold under the cards): **New integration** (admin) and the technical cards of every other row (`mythos-mcp`, `database`, project-scoped or custom rows) with key, kind, project chip, host, credentials state + env NAME, last check, last error, and **Test · Details · Edit** (Details opens the drawer with the non-secret `config`; **Delete** is owner-only, inside the drawer).

The same panel appears on **Project → Advanced → Technical integrations** (rows of that project plus platform-wide ones, technical cards only). Nothing on either page ever displays a credential value — only whether the named variable / file is present.

## 2. Seeded rows (`integrations.ensureDefaults`, at every boot, only when the key is missing)

| Key | Kind | Base URL | Credential (env NAME) | Status | Purpose |
|---|---|---|---|---|---|
| `evolution` | `whatsapp_provider` | `http://127.0.0.1:8080` | `MYTHOS_WP_EVOLUTION_API_KEY_FILE` | enabled | production WhatsApp transport (unofficial); `config { provider:'evolution', official:false }` |
| `kitchen-mythos-auto` | `kitchen` | `http://127.0.0.1:3011` | — | enabled | Kitchen Mythos Auto (`projects/ssangyong-autos`), read-only, `config { contract:'1.3.0', read_only:true }` |
| `n8n` | `n8n` | `http://127.0.0.1:5678` | — | enabled | `config { webhook_base:'http://127.0.0.1:5678/webhook' }` |
| `meta-cloud-api` | `whatsapp_provider` | `https://graph.facebook.com` | `MYTHOS_WP_META_ACCESS_TOKEN_FILE` | **disabled** (until configured) | official WhatsApp Cloud API; `config { provider:'meta_cloud', official:true, graph_version:'v21.0' }` |
| `meta-whatsapp-business-mcp` | `mcp` | `https://mcp.facebook.com/whatsapp_business_tools` | — (`credentials_state missing`) | **disabled** | official Meta MCP for AI/developer operations; `config { transport:'streamable-http', auth:'oauth (Facebook Login for Business)', scopes:[business_management, whatsapp_business_management, whatsapp_business_messaging], tool_namespace:'whatsapp_biz_', tools:[…], purpose:'AI/developer operations only — never runtime customer messaging', docs }` — see `MCP.md` |
| `mythos-mcp` | `mcp` | `https://mythosprod.xyz/mcp` | — | enabled | MYTHOS MCP gateway (ContextForge, OAuth via Dex, owner identity); shown under Advanced |
| `free-llm-pool` | `llm` | — | — | enabled | `config { registry:'projects/mythos-ai-executor/free-llm' }`; Groq active in production |
| `database` | `database` | — | — | enabled | `mythos_wp` itself; shown under Advanced |

Kinds: `whatsapp_provider | kitchen | n8n | mcp | api | project_system | database | llm`. A row may be platform-wide (`project_id NULL`) or scoped to one project.

## 3. API (`routes/platform.js`)

| Route | Role |
|---|---|
| `GET /api/integrations` | any → non-secret rows + `health_state`, `health_detail`, `credentials_state`, `last_ok_at`, `last_error`, `last_checked_at` |
| `POST /api/integrations` | admin (409 on a duplicate key) |
| `PATCH /api/integrations/:key` | admin (the **Configure** / **Edit** dialog) |
| `DELETE /api/integrations/:key` | owner |
| `POST /api/integrations/:key/test` | admin → runs the probe now → `{ status, detail, checked_at }` and records it (the **Test** button) |

Validation (`integrations.validate`): key `^[a-z0-9][a-z0-9-]{1,62}$`; `base_url` http(s) only, plain http on loopback only, no user:pass in the URL, ≤ 255 chars; `credential_env` must be an env NAME (`^[A-Z][A-Z0-9_]{2,62}$`); `config` ≤ 16 KiB and refused when a key looks like `token|secret|password|api_key|credential`. The Configure dialog says it in one line: *never paste a secret here, only the NAME of the variable that holds it*.

`credentials_state` = `present | missing | not_required | unknown`: computed from the presence of the variable and, for a path value, from the file existing with mode 0600 — the value is never read for this. The only time a credential is read is the Evolution probe, which sends it as the `apikey` header to the provider itself.

## 4. Probes (`integrations.probe`, 4 s timeout, loopback http or https only)

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

`integrations.record()` writes `health_state`, `health_detail` (≤ 300 chars), `last_checked_at`, `last_ok_at`, `last_error`, `credentials_state`. The health center (`health.js`, Settings → System → Health) runs every enabled row on its schedule and maps them to components `whatsapp:<key>`, `kitchen:<key>`, `ai`, `integration:<key>` (`OPERATIONS.md` §3).

## 5. n8n

n8n runs on `127.0.0.1:5678` (workflows: MYTHOS task intake / execute / report / quota, SSANGYONG scrapers). WP integrates it in two ways:

1. the `n8n` integration row — health probe on `/healthz`, `config.webhook_base` (default `http://127.0.0.1:5678/webhook`);
2. the automation action `n8n_webhook { path, include_text? }` (`automations.js`, Settings → Automations): `POST <config.webhook_base>/<path>` (fallback `<base_url>/webhook/<path>`) with JSON `{ event, project_id, conversation_id, contact_masked, intent }`, 5 s timeout; the message text (≤ 4000 chars) is included **only** when `include_text === true`.

WP never reads n8n credentials; a workflow that must call back into WP uses the session-less receiver (webhooks) or a panel account through the API.

## 6. Kitchen

The `kitchen-mythos-auto` row is what `kitchen.js#forProject` resolves for a project whose `settings.kitchen` names it (set automatically for projects created as **Auto**). Change `base_url` here to point Auto projects at another Kitchen; set the row `disabled` to make every Kitchen consumer degrade (`{ configured:false }`, `KITCHEN_NOT_CONFIGURED`, the Catalogue tab shows *not configured*). Read-only by construction: the client has no method that writes. Contract 1.3.0 routes: `ARCHITECTURE.md` §6.

## 7. Free-LLM pool (the AI provider card)

The `free-llm-pool` row only records the pool registry path and the probe result. Keys live in the pool's key directory (`MYTHOS_FREE_LLM_KEY_DIR`) and are read by `projects/mythos-ai-executor/free-llm/secrets.loadKey` at call time; WP shows `credential_present` per provider (`GET /api/ai/status`) and never the key. Provider selection: `selector.selectCandidates({ modality:'chat' })`; an agent's `model` (`provider/model` or model id) is preferred when wired and keyed.

## 8. MCP servers

`meta-whatsapp-business-mcp` (its own card) and `mythos-mcp` (under Advanced) are **reachability records** for the health center; WP implements no MCP client and invokes no tool at runtime. What each one is, is not, and the owner OAuth step: `MCP.md`.

## 9. Adding an integration

Settings → Integrations → Advanced → **New integration**, or `POST /api/integrations { key, kind, name, base_url, credential_env?, config?, status?, project_id? }`. Put the credential in the 0600 env (a value) or a 0600 file and name that variable in `credential_env`; then **Test** (`POST /api/integrations/:key/test`). Rows of kind `api` / `project_system` get the generic GET probe and appear under Advanced.
