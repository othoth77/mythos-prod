# MYTHOS WP V2 — Security

Companion: `ARCHITECTURE.md`, `ENVIRONMENT.md`, `WHATSAPP_SETUP.md` §5–6, `MCP.md`, `OPERATIONS.md`. Repo-level principles: `docs/MYTHOS_COMMUNICATION_OS_ARCHITECTURE.md` §5.

## 1. Network surface

- The process binds `127.0.0.1:8170` only; `server.js` exits with code 2 on any other `MYTHOS_WP_BIND`.
- nginx `wp.mythosprod.xyz` (certbot TLS, HSTS) is the only public surface; `robots.txt` disallows all.
- Outbound connections: PostgreSQL (loopback), Evolution API (loopback :8080), Kitchen (loopback :3011), n8n (loopback :5678), Graph API (https, only when the Cloud API is configured), free-LLM providers (https, through the pool adapter), MCP reachability probes (https GET). `integrations.js` and `kitchen.js` refuse plain `http` off loopback.

## 2. Authentication and sessions (`auth.js`, `users.js`)

- Accounts: `wp_users` (scrypt hash `N,r,p$salt$hash`, status active / disabled) checked first; the 0600 users file `MYTHOS_WP_USERS_FILE` second (bootstrap / break-glass; a file with a group/other permission bit is refused). Passwords ≥ 12 chars. A disabled DB user is refused even if the file still lists the name.
- Constant-time verification (`timingSafeEqual`); an unknown username still costs one scrypt against a decoy.
- Login throttle: 10 failures per socket address per 15 min → 429 (behind nginx the address is loopback, so effectively global).
- Sessions: server-side, in memory, **8 h absolute** (`MYTHOS_WP_SESSION_TTL_MS`), ceiling 256, cookie `mythos_wp_session` `HttpOnly; SameSite=Strict; Secure; Path=/`. A restart signs everyone out. `GET /api/session` shows the current one; `POST /api/logout` destroys it.
- Every request except `/login`, its assets, `/healthz`, `/hooks/*` and `POST /api/login` requires a live session.

## 3. Authorisation

`ROLES = ['viewer', 'agent', 'manager', 'admin', 'owner']` with ranks 1–5. Legacy `operator` (users file) = `manager`; a route declared `'operator'` requires `agent`. `hasRole(session, required)` is rank-based; the UI only hides what the server already refuses (403 `insufficient role`, logged with the actor).

| Action | Minimum role |
|---|---|
| read conversations, contacts, numbers (masked), agents, dashboard | viewer (`any`) |
| work a conversation: reply, notes, tags, handoff, suggest / decide, mark read | agent |
| integrations list, health center, WhatsApp accounts, routing simulate, number check, health run, templates create/edit, agent test, notes delete (or author) | manager |
| numbers, accounts, links, inbox switches, routing rules, integrations, automations, agents config, Meta/MCP config, users' passwords & project grants, projects | admin |
| delete accounts / numbers / agents / integrations, create an owner, reset an owner password | owner |

Project access: owner/admin, `all_projects` users and file logins see every project; others only `wp_user_projects` (`projects: [ids]` in the session, refreshed by `setSessionProjects`). `api-util.projectFrom()` returns 404 for a project the caller cannot see. Inbox memberships (`wp_inbox_members`) narrow visibility further inside a project. Full phone digits (`phone_ref`, contact `phone`) are returned to admin+ only; everyone else sees `***` + last digits.

## 4. CSRF and headers

- State-changing requests must carry `X-Requested-With: MythosWP`; when `Origin` / `Sec-Fetch-Site` are present they must be same-origin (`csrf_header_missing`, `csrf_origin_mismatch`, `csrf_cross_site` → 403). Login is exempt from the header only.
- JSON bodies ≤ 256 KiB, `Content-Type: application/json` required (415 / 400 / 413).
- Headers on every response: `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: data:; font-src 'self'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, COOP / CORP `same-origin`, `Permissions-Policy` (camera, microphone, geolocation off), `Cache-Control: no-store` on the API. No inline script or style anywhere; the check pipeline fails on an inline handler or a literal colour.

## 5. Webhooks (`comms/receiver.js`)

| Provider | Verification |
|---|---|
| Evolution (unsigned) | shared token from the 0600 file `MYTHOS_WP_WEBHOOK_TOKEN_FILE` (≥ 16 chars), `?token=` or `x-mythos-webhook-token`, constant-time compare **before** the body is read; missing file → 503; mismatch → 401 |
| WhatsApp Cloud API (signed) | `X-Hub-Signature-256 = sha256=HMAC(app secret, raw body)` constant-time compare after the body is read; subscription `GET hub.mode=subscribe` + `hub.verify_token` (0600 file) → `hub.challenge` as text, else 403 |

Body limit `MYTHOS_WP_RECEIVER_MAX_BODY` (default 512 KiB; 413 closes the connection). Route absent (404) unless `MYTHOS_WP_RECEIVER_ENABLED=1`. Exactly-once ingestion: unique `(inbox_id, provider_message_id)` → replays answer `duplicate`; outbound idempotency by `(conversation_id, client_ref)`.

## 6. Privacy guard on shared and personal numbers

Routing runs before any ledger row; an unrouted message on a shared number leaves only hashes (`wp_routing_drops`: `identity_sha256 = sha256(kind:value:instance)`, `payload_sha256`) — the hash is personal data (enumerable phone space) and is never returned by the API. Personal numbers route by identity only (no keyword, no default, no sticky). Rejected deliveries on an instance that hosts a shared inbox keep **no** payload. Details: `WHATSAPP_SETUP.md` §5.

## 7. Secrets

- **None in the database**: every credential is referenced by the NAME of an env variable / file-path variable (`wp_integrations.credential_env`; the hidden legacy column `wp_projects.catalog_dsn_env` followed the same rule and is read by nothing since V2.1); JSON `config` / `settings` refuse credential-shaped keys; the schema test enforces "no secret column".
- **None in logs**: every log value passes `projects/mythos-orchestrator/lib/redact.js`; provider errors are scrubbed (`[A-Za-z0-9._-]{20,}` → `…`); provider payloads are stored minus `apikey|token|authorization|mediaKey|fileEncSha256|url|directPath|thumbnails|base64` (Evolution) / `access_token|secret|url|sha256` (Meta).
- **None in the audit**: `audit.clean()` drops keys matching `password|passwd|secret|token|api_?key|credential|scrypt|dsn|connection`, redacts strings, bounds documents (2000 chars / 16 KiB).
- **Read at call time only**: Evolution key, Meta token / secret / verify token, LLM keys (`secrets.loadKey`) — never cached in a module variable beyond the call, never returned.
- Files must be 0600 (`users.json`, `webhook.token`, `MYTHOS_WP_*_FILE`); a looser mode makes the panel treat the credential as absent.
- `LOG_BAILEYS=debug` on the Evolution side leaks Signal private keys — never in production.

## 8. AI safety

- Customer text is data: quoted between markers, declared untrusted in the system prompt, parsed by the #173 intent parser — nothing in it can change rules, tools or permissions (test-enforced with an injection message).
- Tool registry is read-only and per-agent allow-listed server side (`TOOL_NOT_ALLOWED`); no tool crosses a project or a conversation boundary; every call is timed out.
- Fact guard on every LLM reply (`projects/automotive/comms/lib/ai` `factGuard`): unverified price / stock / delivery / compatibility / order claims are rejected and the deterministic engine-173 path answers instead.
- Auto mode is gated (confidence, inbox open + outbound enabled, handler `ai`, no open handoff, hourly cap); a conversation flagged for a human gets no run (412, journaled `ai.refused`).

## 9. Audit log

`wp_audit_events`: actor (username or `system:<component>` / `db:wp_inboxes_guard` / `cli:<user>`), role, action (`create update delete login login_failed logout status setting upsert simulate send handoff route run sync test execute check import link unlink`), resource, record id, project, changed fields, previous / next (redacted), request id, client. Readable at Settings → System → Audit (`#/audit` redirects there; per project under Project → Advanced → Audit) and `GET /api/audit/:resource/:id`; a failed audit write never undoes the business mutation and is reported as `audited:false`.

## 10. Process hardening

Unit: `NoNewPrivileges`, `PrivateTmp`, `ProtectSystem=strict`, `ProtectHome=read-only`, empty `ReadWritePaths` (writes go to PostgreSQL only), syscall filter, `RestrictAddressFamilies`, `MemoryMax=256M`, `OOMScoreAdjust=0`. The process runs as `deploy`, never root.
