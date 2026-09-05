# MYTHOS Communication OS — Operations runbook

Companion to `docs/MYTHOS_COMMUNICATION_OS_ARCHITECTURE.md`. Owner/operator procedures only; nothing here is run by an agent on its own. Secrets never appear in commands or outputs.

## 1. Model in one paragraph

A **project** is a service (SSANGYONG.AUTOS, Dar Hijama, MYTHOS PROD, …) and the tenant of everything: contacts, conversations, messages, knowledge, products, stock, business rules, AI runs, handoffs, audit. `wp_projects.kind` says what the service is: `automotive` (parts catalogue connection required), `service` (no catalogue), `internal` (MYTHOS itself). An **inbox** is one provider instance of one project, linked to one WhatsApp **account** (`wp_inboxes.account_ref`, the business number). Rule: one account per inbox; a shared account is only possible for an inbox that sets `settings.allow_personal_account = true`, and the MYTHOS notification account (`wp_reserved_accounts`) can never be claimed by any inbox. `mythos-bridge` is the notification instance and is not an inbox (schema CHECK).

## 2. Onboard a new service

1. **Project row** — WhatsApp panel → Projects → new: `id` (e.g. `dar-hijama`), `kind` (`service` unless it has a parts catalogue), display name, currency. For `automotive`, set the catalogue connection variable NAME and schema (the variable itself lives in the panel's 0600 env file).
2. **Reserve the notification account once per host** (as deploy, with the panel env loaded): `node projects/mythos-wp/bin/mythos-wp reserve-account <notification number digits> "MYTHOS notification channel"`. This is what stops any inbox from claiming the `mythos-bridge` account.
3. **Provider instance** — `ops/whatsapp/evolution/customer-instance.sh <instance>` (instance = project id, or `<project>-<n>` for a second number). Creates the Evolution instance and its per-instance webhook to the loopback receiver with the header token. Refuses `mythos-bridge`.
4. **Inbox row** — WhatsApp → inboxes → new: project, provider `evolution`, instance, display name, `account_ref` = the digits of the phone that will be paired, leave every switch off. A refused save means the account is reserved (notification channel) or already used by another inbox.
5. **Pair** — in an SSH terminal: `sudo -u deploy -H bash /home/deploy/projects/mythos-prod/ops/whatsapp/evolution/qr-live.sh <instance>`; scan with **that service's** WhatsApp account while the QR age is under 20 s. The helper prints `PAIRED`; the receiver records `connection.update` and the inbox row shows `open`.
6. **Activate in steps** (owner switches on the inbox row): `inbound_enabled` → send one real text from another phone, check it in the Inbox; `outbound_enabled` → reply once from the Inbox, confirm on the phone; `settings.ai_suggest` → suggestions on every inbound (still human-sent); `settings.auto_reply` → only after COMMS-9 exists and the policy review passed.
7. **Agents** — WhatsApp → Inbox members: username (panel account), inbox, role `agent` / `lead` / `viewer`. A user with at least one membership sees only member inboxes in Inbox and Contacts; owners/operators without memberships see everything.

## 3. Add a second account to an existing service

Repeat steps 3–6 with a new instance name (`<project>-2`) and the new number. Contacts are shared across the project's inboxes (one customer = one contact per project); conversations are per inbox.

## 4. Internal inbox on a personal account (discouraged)

Only for `kind = internal`. Create the inbox with `settings.allow_personal_account = true`; the account may then be one already used elsewhere — but never the reserved notification account. Every chat of that account will flow into the panel.

## 5. Rollback

- Inbox: switch `inbound_enabled` / `outbound_enabled` off (row edit, immediate). Stronger: `customer-instance.sh --verify <instance>` to confirm, then in Evolution set the webhook `enabled=false` for that instance (owner; leaves `mythos-bridge` untouched).
- Receiver: remove `MYTHOS_WP_RECEIVER_ENABLED` from the panel env and restart `mythos-wp.service` → the route answers 404 for every instance.
- Schema: `mythos-wp migrate down <version>` (data in dropped objects is lost; `0004` down deletes non-automotive projects).
- Panel deploy: `git -C /home/deploy/worktrees/mythos-wp-main checkout --detach <previous main commit>` + restart.

## 6. Troubleshooting

| Symptom | Where to look | Likely cause |
|---|---|---|
| Phone says « impossible de connecter l'appareil » | age of the scanned QR | scanned a stale code; scan a fresh one from the terminal helper |
| Inbox row stays `closed` after `PAIRED` | `wp_inbound_events` for `CONNECTION:` rows; Evolution `webhook/find/<instance>` | webhook not set or token mismatch (401 in the panel log) |
| Messages missing from the Inbox | `wp_inbound_events.status` (`dry_run` = inbound switch off; `rejected INBOX_UNKNOWN` = no inbox row; `ignored` = own/group/status) | switch or row |
| Reply refused 412 | inbox `status` / `outbound_enabled` | inbox not open or replies not enabled |
| Reply refused 429 | `MYTHOS_WP_OUTBOUND_CAP_PER_HOUR` | per-conversation cap |
| Inbox save refused with `wp_inboxes_account_reserved` | `wp_reserved_accounts` | the account is the notification channel |
| Inbox save refused with `wp_inboxes_account_uidx` | other inboxes' `account_ref` | account already used; use a dedicated number |
| Agent sees nothing | `GET /api/comms/my-inboxes` | membership on another inbox; add or remove rows |

## 7. What is never done here

Pairing `mythos-bridge` to anything, enabling its webhook, editing its drop-in; Telegram changes; `LOG_BAILEYS=debug` in production; sending test messages from an agent session.

## 8. Reconciliation, heartbeat and replay (COMMS-9)

Run as deploy with the panel env loaded (`set -a; . /home/deploy/deployments/mythos-wp/.env; set +a`), from the main worktree:

```bash
node projects/mythos-wp/bin/mythos-wp comms reconcile --threshold-min 15   # alarms outbound rows without acknowledgement (no resend)
node projects/mythos-wp/bin/mythos-wp comms heartbeat                      # probes every inbox through its provider; records ok|stale|unreachable
node projects/mythos-wp/bin/mythos-wp comms replay-list                    # failed/rejected deliveries whose payload was kept
node projects/mythos-wp/bin/mythos-wp comms replay <event_id>              # dry-run: what would happen
node projects/mythos-wp/bin/mythos-wp comms replay <event_id> --apply      # re-ingest once; refused a second time
```

Scheduling (owner): the two probes are safe every 5–10 minutes from the deploy user's timer of choice once customer traffic exists; they change no provider state. Alarms and heartbeat changes appear as `delivery.alarm` / `inbox.heartbeat` events on the SSE feed and in the conversation journal.

## 9. Shared-account routing (COMMS-11)

Order of operations for a shared instance (never enable the instance webhook first):

1. `bin/mythos-wp comms route shared-inbox <project> --instance <instance> --account-ref <digits> --display-name "<name>"` — explicit, audited opt-in (refused unless the reserved-account rules are met).
2. `bin/mythos-wp comms route add <project> --inbox <id> --kind allowlist --identity phone:<digits>` for known customers, or `--kind opt_in --identity phone:<digits> [--code <CODE>] [--ttl-hours N]` for a customer who will write in (identity first; the code is a second factor only).
3. `bin/mythos-wp comms route list <project>`, `enable|disable <project> <rule_id>`, `drops [--limit N]` (hash-only records of what was dropped, with reason).
4. Only then may the owner enable the instance webhook (owner step) and, later, `inbound_enabled` on the logical inbox (dry-run until then).

API: `GET/POST /api/projects/<p>/comms/routes`, `POST …/routes/<id>/enable|disable` (owner), `GET /api/comms/routing-drops` (owner). Replay honours the same routing decision. Never create a route for the account owner or a reserved number (refused). Never pair the shared account to a second instance.
