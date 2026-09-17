# MYTHOS WP V2.1 — Troubleshooting

Symptom → check → fix. Commands run as `deploy` with the env loaded (`set -a; . /home/deploy/deployments/mythos-wp/.env; set +a`) from the production app root. Database access: `docker exec -it idauto-postgres psql -U mythos_wp_owner -d mythos_wp` (no host `psql`). Logs: `journalctl --user -u mythos-wp.service -n 200 --no-pager`. Companion: `OPERATIONS.md`, `WHATSAPP_SETUP.md`, `ENVIRONMENT.md`, `DEPLOYMENT.md`.

## 1. Login and access

| Symptom | Check | Fix |
|---|---|---|
| 401 `invalid credentials` | `node bin/mythos-wp users list` — is the user there and `active`? was the password ≥ 12 chars? | `users add <name> <role>` (password on stdin) or `POST /api/users/:u/password` by an admin; a `disabled` DB row wins over the users file |
| 503 `authentication is not configured` | `check-env` → users file `NOT USABLE (insecure_mode | unreadable | invalid | no_users)` and `wp_users` empty | `chmod 600 users.json`; `set-password <users.json> <owner> owner`; then `users import` |
| 429 `too many failed attempts` | 10 failures / 15 min per socket address (loopback behind nginx = global) | wait 15 min or restart the unit (resets the throttle and every session) |
| Signed out unexpectedly | unit restarted (in-memory sessions) or 8 h absolute TTL | sign in again; raise `MYTHOS_WP_SESSION_TTL_MS` only with a reason |
| 403 `csrf` on a POST from a script | missing `X-Requested-With: MythosWP`, `Origin` not the vhost host, or `Sec-Fetch-Site` cross-site | add the header; call from the same origin |
| 403 `insufficient role` | route minimum in `SECURITY.md` §3; audit line `denied` in the journal | grant the role (admin; owner for owner) |
| Project not visible / 404 `unknown project` | `GET /api/session` → `projects` (null = all); `users grant` | grant the project or set `all_projects`; the user must sign in again (session refreshed on grant only while live) |
| Agent sees no conversations | `GET /api/comms/my-inboxes` → `scoped:true` | add / remove `wp_inbox_members` rows |

## 2. Numbers and receiver

| Symptom | Check | Fix |
|---|---|---|
| Sync → 412 `Evolution credential unavailable` | `check-env`; `ls -l $MYTHOS_WP_EVOLUTION_API_KEY_FILE` must be `-rw-------` deploy | create the 0600 key file, set the variable, restart |
| Sync → 502 `fetchInstances failed` | `curl -s -o /dev/null -w '%{http_code}' -H "apikey: $(cat <keyfile>)" http://127.0.0.1:8080/instance/fetchInstances` | Evolution container down / wrong key / wrong `MYTHOS_WP_EVOLUTION_BASE_URL` |
| Number not connected (`open`) | **Check** on the number row (`POST /api/whatsapp/numbers/:id/check`) → `state`; Evolution `connectionState`; Settings → System → Health `number:<instance>` | re-pair with `ops/whatsapp/evolution/qr-live.sh <instance>` (owner; scan a QR younger than 20 s) |
| WhatsApp table says *Not receiving* (`webhook_state missing / mismatch / disabled`) | Sync all detail: `webhook → host:port/path (expected 127.0.0.1:8170/hooks/evolution)`; `MYTHOS_WP_RECEIVER_URL` | owner re-runs `customer-instance.sh <instance>` (sets the per-instance webhook + header token); never edit `mythos-bridge` |
| Receiver answers 404 | `GET /api/comms/receiver` → `enabled:false` | `MYTHOS_WP_RECEIVER_ENABLED=1`, restart |
| Receiver answers 503 `receiver_not_configured` | `token_present:false`, `token_problem` (not set / must be 0600 / too short / unreadable) | fix `MYTHOS_WP_WEBHOOK_TOKEN_FILE` (0600, ≥ 16 chars); restart |
| Receiver answers 401 `unauthorized` | journal `receiver: unauthorized reason WEBHOOK_TOKEN_MISMATCH | MISSING` | the instance webhook carries another token → re-run `customer-instance.sh`; for `meta_cloud`: `SIGNATURE_MISMATCH` = wrong app secret file |
| Receiver answers 413 | body > `MYTHOS_WP_RECEIVER_MAX_BODY` | raise it (≤ 4 MiB) or keep `base64=false` on the instance webhook |
| 202 `INBOX_UNKNOWN` | the instance has no `wp_inboxes` row | link the number to a project (`WHATSAPP_SETUP.md` §3); the delivery is kept as a dead-letter → `comms replay` after linking |
| Message arrives but is not in the Inbox | `SELECT status, reason, event_name FROM wp_inbound_events ORDER BY id DESC LIMIT 20` | `dry_run` → switch **Receiving** (`inbound_enabled`) on for that project's link; `ignored` → own / group / status / self chat (by design); `duplicate` → already stored; `failed` → replay after fixing the cause |
| Meta webhook verification fails (403) | journal `verify_refused reason` (`VERIFY_TOKEN_NOT_CONFIGURED`, `HUB_MODE`, `VERIFY_TOKEN_MISMATCH`, `CHALLENGE_MISSING`) | create `MYTHOS_WP_META_VERIFY_TOKEN_FILE` (0600) with the token entered in the Meta app; re-subscribe |

## 3. Routing (shared numbers)

| Symptom | Check | Fix |
|---|---|---|
| Message dropped, nothing stored | WhatsApp → Advanced → Routing rules → **Recent routing drops** (`GET /api/whatsapp/routing-drops`, admin) or `comms route drops` → `reason` | see the reason rows below; then **Simulate routing** (`POST /api/whatsapp/routing/simulate`) with the same sender/text until `routed:true` |
| reason `UNROUTED` | no matching identity / keyword / default rule on the instance | add an `allowlist` rule for the identity, a `keyword`, or a `default` (not on a personal number) |
| reason `ROUTING_AMBIGUOUS` | a `dedicated` inbox coexists with others on the instance | unlink the dedicated inbox (needs 0 conversations) and relink as `shared` |
| reason `OWNER_EXCLUDED` | sender = the number's own `account_ref` or a reserved account | by design; the owner's phone replies are never customers |
| reason `IDENTITY_MISSING` | provider event without a phone / LID identity | inspect `wp_inbound_events` for the instance; unresolved-LID senders are refused by name |
| reason `RULE_MALFORMED` / `RULE_EXPIRED` / `TOKEN_REQUIRED` | `comms route list <project>` (kind, identity_kind, expires_at, code_required) | disable the malformed rule and add a correct one; extend `--ttl-hours`; the customer must include the opt-in code |
| 412 "routing rules apply to shared-account inboxes only" | the inbox is `dedicated` | rules are not needed on a dedicated inbox |
| 412 "a personal number routes by identity only" | `wp_phone_numbers.is_personal` or reserved `account_ref` | add identity rules; keyword/default are refused by the privacy guard (COMMS-11) |
| 409 "this instance already has a default route" / "this keyword already routes" | unique `(provider, instance, identity_kind, identity_value)` | disable / delete the existing rule first |
| Customer keeps landing in the wrong project | `wp_conversations.routed_by = 'sticky'` | resolve the live conversation, add an `allowlist` rule for the identity to the right inbox |
| 412 `wp_inboxes_account_reserved` on link | the digits are the notification account | only `shared` + `allow_personal_account:true` (explicit, audited); never for customer traffic |

## 4. Replies and AI

| Symptom | Check | Fix |
|---|---|---|
| Reply 412 `replies are not enabled for this inbox` / `inbox is not connected (closed)` | Project → WhatsApp: the **Replies** switch (`outbound_enabled`), the connection badge (`status`) | switch Replies on; re-pair the number if `closed` |
| Reply 429 | per-conversation cap `MYTHOS_WP_OUTBOUND_CAP_PER_HOUR` (30) | wait; raise with a reason |
| Reply `failed` with `TRANSPORT:` / `HTTP 401` | Evolution reachability / key file; `POST …/messages/:mid/retry` (≤ 5 attempts) | fix the provider; retry |
| Sent but never `delivered` | `comms reconcile` stamps `delivery.alarm` after 15 min; Evolution `messages.update` events reaching the receiver? | check webhook events include `MESSAGES_UPDATE`; number online on the phone |
| **AI not answering** (no suggestion) | first **Project → AI**: is an Agent chosen, is the Mode Off, is the Status Disabled? then the number link's **AI** switch (Project → WhatsApp, or WhatsApp → number → More) — off = `ai_mode off`; then the conversation: **Handled by** Human (no run while a human holds it) or an open handoff; then `GET /api/projects/:p/ai` (`mode`, `status`), `GET /api/ai/status` → `agents.active`, `llm.configured`; journal `ai.refused` | choose an agent and set the Mode to Suggest or Auto on Project → AI; switch AI on for the number link; **Hand back to AI**. Precedence agent → project → number link, restrict only (`AI_AGENTS.md` §2): a level set to Off cannot be overridden from below |
| AI suggests instead of sending although the agent is Auto | `GET /api/projects/:p/ai` → `mode` = `suggest`: the project Mode or the number link's `ai_mode` is `suggest` | set Project → AI → Mode to Auto (or `inherit` through `PUT /api/projects/:p/ai`), and the link's `ai_mode` to `inherit` |
| AI suggests but never sends (auto mode) | gates: `confidence ≥ confidence_min`, inbox open + `outbound_enabled`, `handler = ai`, no open handoff, `max_replies_per_hour`; `wp_ai_runs.policy_result` | lower `confidence_min` only with a reason; fix the gate that fails |
| LLM engine falls back to templates | `wp_ai_runs.policy_result` / run `reason`: `FACT_GUARD_VIOLATION`, `MALFORMED_JSON`, `TOOL_ROUNDS_EXCEEDED`, `ALL_CANDIDATES_FAILED`, `NO_CANDIDATE_AVAILABLE`, `KEY_UNAVAILABLE`, `QUOTA` | by design for the guard; for pool errors check `GET /api/ai/status` providers (`credential_present`, `health`) and the free-LLM key directory |
| Tool answers `KITCHEN_NOT_CONFIGURED` / no Catalogue tab | the project Type is Service or Internal, or `settings.kitchen` was cleared (Project → Advanced); integration row `kitchen-mythos-auto` enabled (Settings → Integrations → Kitchen Mythos Auto) | set the Type to Auto (Overview → Edit) or `settings.kitchen` through `/api/r/projects/:id`; enable the row |
| Tool answers `TOOL_NOT_ALLOWED` | `agent.tools` | add the tool id to the agent (admin) |
| Handoff button does nothing / 404 | `routes/whatsapp.js` mounted? (`GET /api/meta` version) | V2 routes are concatenated in `api.js`; redeploy if the module is missing |

## 5. Kitchen and integrations

| Symptom | Check | Fix |
|---|---|---|
| Project → Catalogue shows *unreachable* (`{ ok:false, kind: UNREACHABLE }`) | `curl -s http://127.0.0.1:3011/api/health`; `ss -ltnp | grep 3011`; health `kitchen:kitchen-mythos-auto` | start / restart the Kitchen service (`projects/ssangyong-autos`, owner); WP degrades, it does not cache |
| `TIMEOUT` | Kitchen slower than 3 s (host load, MemoryMax on the Kitchen unit) | check the host (`free -m`, journal of the Kitchen unit) |
| `BAD_STATUS 404` on vehicle-brands / quotes / part-categories | older Kitchen (contract < 1.1 / 1.2) | expected: the client degrades to empty data; upgrade the Kitchen to 1.3.0 |
| `BAD_PAYLOAD` | Kitchen answered non-JSON or an unexpected shape | Kitchen release regression; compare `/api/health` |
| Settings → Integrations card says *Not configured* (`credentials_state missing`) | variable unset, or the file is not 0600 / not a file | create the 0600 file, set the NAME in `credential_env` (Configure), restart |
| `integration:n8n` warning `HTTP_…` | `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:5678/healthz` | n8n container / reverse-proxy |
| `integration:mythos-mcp` disconnected | `curl -sI https://mythosprod.xyz/mcp` (any status = reachable) | gateway / nginx on the host |
| `ai` warning `NO_PROVIDER_KEY` | free-LLM key directory; `GET /api/ai/status` | provision a provider key in the pool (owner); Groq is the active provider today |
| Probe warning `NOT_LOOPBACK_NOT_PROBED` | integration `base_url` is plain http off loopback | use https, or the loopback address |

## 6. Migrations and database

| Symptom | Check | Fix |
|---|---|---|
| `migrate up` fails, "migration file missing" | `ls database/migrations/` in the production checkout | the checkout is not at the V2 ref; `v2-rollout.sh --ref …` |
| `migrate up` fails with a constraint error | the up file runs in one transaction → nothing applied; message names the constraint | fix the offending rows (e.g. an `inboxes` row with a status outside the domain), re-run |
| `migrate down 0007_control_center` refused "migration not applied" | `migrate status` | nothing to do |
| Boot log `boot: integrations reason relation "wp_integrations" does not exist` | 0007 not applied | `migrate up`, restart |
| `wp_inboxes_guard` errors on link (`wp_inboxes_shared_needs_account`, `wp_inboxes_dedicated_uidx`, `wp_inboxes_not_bridge`) | the DB trigger text is returned as the 412 detail | follow the message: shared needs `account_ref`; all links on an instance must be shared; `mythos-bridge` only shared |
| `wp_inbox_routes_owner_excluded` | routing a reserved / owner number as a customer | not allowed |
| Server refuses to start: `missing environment: MYTHOS_WP_DB_…` | `check-env` | complete the env |
| Project created but the number / agent was not attached (toast warning) | the `warnings[]` of `POST /api/projects`: unknown number, 409 (a dedicated link exists on that number), agent archived … | link it from Project → WhatsApp (shared if the number already serves a project) or bind it on Project → AI; the project itself is fine |
| `pg` module missing after rollout | `ls node_modules/pg` in the production checkout | `v2-rollout.sh` copies it from the wp-v2 worktree; or `npm ci --omit=dev` as deploy |

## 7. Process, memory, host

| Symptom | Check | Fix |
|---|---|---|
| Unit restarts in a loop (`status=2`) | journal first lines: bind refused / missing env | `MYTHOS_WP_BIND` loopback only; env complete |
| Killed with `oom-kill` / `MemoryMax` reached | `systemctl --user status mythos-wp` → `Memory:`; health `backend.rss_mb`; `journalctl -k | grep -i oom` | the unit caps at 256 MiB (`MemoryHigh` 200). Reduce concurrent health probes (`MYTHOS_WP_HEALTH_INTERVAL_MS`), check for a runaway SSE client count, then raise `MemoryMax` in a drop-in only with the host headroom verified (`free -m`; the VPS has an OOM history and every deploy unit runs at `OOMScoreAdjust=0`) |
| Old bookmark (`#/ai`, `#/health`, `#/integrations`, `#/automations`, `#/audit`) lands somewhere else | expected: V2.1 redirects them to Project → AI / Settings → System / Settings → Integrations / Settings → Automations / Settings → System → Audit | update the bookmark |
| `/healthz` ok but the UI is blank | browser console: CSP violation | no inline script/style is allowed; a modified `index.html` with inline code will not run — revert |
| nginx 502 | `curl -s http://127.0.0.1:8170/healthz`; unit active? | restart the unit; `nginx -t` |
| nginx 413 | body > `client_max_body_size 512k` | the API caps at 256 KiB anyway; the receiver limit is separate |
| Sessions vanish after a deploy | in-memory sessions | expected; announce restarts |
| Time drift in `checked_at` / `at` | container vs host clock | `timedatectl`; PostgreSQL runs in the container |

## 8. Where to look, in order

1. **Settings → System → Health** (last known state of every component) → **Run checks**.
2. `journalctl --user -u mythos-wp.service` (JSON lines with `request_id`, `receiver:` and `boot:` keys).
3. `wp_inbound_events` (deliveries), `wp_routing_drops` (refused routing), `wp_conversation_events` (journal), `wp_ai_runs` (AI decisions), `wp_automation_runs`, `wp_audit_events` (who changed what).
4. WhatsApp → Advanced → Receiver and providers (`GET /api/comms/providers`, `GET /api/comms/receiver`), `GET /api/ai/status`, `GET /api/projects/:p/ai`, Settings → Integrations (`GET /api/integrations`).
5. The providers themselves: Evolution (`:8080`), Kitchen (`:3011`), n8n (`:5678`), the free-LLM pool.

## WhatsApp connection states (what the four words mean)

The panel never shows a raw provider state. `numbers.connectionOf()` derives one of four words from the
number's last known **device status** and the result of the last **check**, and the detail behind the badge
says what to do:

| Badge | Meaning | What to do |
|---|---|---|
| **Connected** | the WhatsApp session is open | nothing |
| **Action required** | never paired (no digits yet), pairing in progress, or never checked | scan the QR code from the phone (`ops/whatsapp/evolution/qr-live.sh <instance>`) |
| **Disconnected** | it was paired and the session closed | re-pair the number from the phone |
| **Error** | the last check could not reach the WhatsApp gateway | check Evolution (`docker ps`, `systemctl --user status mythos-wp`), then press **Check**; the device status shown before the failure is kept |

**A check that fails is never written as a device status.** A gateway timeout sets `health_state = 'error'`
and leaves `wp_phone_numbers.status` untouched, so a slow host cannot make a healthy number look broken
(incident of 2026-09-17 22:07 UTC: a probe timeout under host load wrote `status = 'error'` on both numbers
and the dashboard read "WhatsApp 0 / 2" with ERROR on four project rows while the session was open).

**Project links follow their number.** Every successful check propagates the device status to the
`wp_inboxes` rows of that number, so a link created during an outage cannot keep a stale `error` that would
block replies for that project (`numbers.syncInboxStatus`).

| Symptom | Check | Fix |
|---|---|---|
| Dashboard shows `Error` on every number | `GET /api/health/center` → `whatsapp:evolution` | the gateway is unreachable: `docker ps \| grep evolution-api`; the numbers keep their last known status and recover at the next successful check |
| A number says `Action required` | `wp_phone_numbers.phone_ref` empty = never paired | pair it from the phone; the panel cannot pair a number for you |
| A project cannot send although the number is connected | `SELECT status FROM wp_inboxes WHERE project_id = …` | press **Check** on the number (WhatsApp → Numbers); the link follows the number |
| Database errors under heavy host load | `MYTHOS_WP_DB_CONNECT_TIMEOUT_MS` (default 5000) | raise it in the env file when the host runs other heavy work |
