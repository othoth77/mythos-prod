# Report gh-issue-170 — BLOCKED

| Field | Value |
|---|---|
| Completed | 2026-09-04T21:08:10.628Z |
| Executor task | `t-20260904205253-8yl808` |
| OTHMODE task | `OTH-2026-00169` |
| Attempt | `gh-issue-170#1` |
| Action | implement (source explicit_current_issue, written "implement") |
| Profile | repo-write |
| Blocker | `PERMISSION_DENIED` The repo-write side of #170 is done and committed: ops/whatsapp/evolution/{docker-compose.yml (Evolution API + Postgres, API on 127.0.0.1 only, Postgres unpublished, mem/pid caps, key and DB password as required env-file variables), bridge-dropin.conf.example (all MYTHOS_BRIDGE_WHATSAPP_* set, one p |
| Runtime | `e3a19a3ad1c8` on `main` |
| Model | `claude-fable-5-1` (explicit:fable-5.1 (requested "fable-5.1")) |
| Branch | `mythos/gh/gh-issue-170` |
| Commits on origin | false |
| Git verified | false |

## Summary

The repo-write side of #170 is done and committed: ops/whatsapp/evolution/{docker-compose.yml (Evolution API + Postgres, API on 127.0.0.1 only, Postgres unpublished, mem/pid caps, key and DB password as required env-file variables), bridge-dropin.conf.example (all MYTHOS_BRIDGE_WHATSAPP_* set, one placeholder recipient, credential from the 0600 file, ENABLED deliberately absent), verify.js (read-only readiness verifier: bridge problems, key file mode, gateway version, instance connectionState, sending flag — two GETs, never a POST, never prints the key), README.md (owner runbook, activation as a separate approved step)}, tests/whatsapp-gateway-verify-test.js 24/0, and a WA-GATEWAY-PREP entry in docs/AI_HANDOVER.md with the measured host state. The task's validation requirements that need the host could not be met from this run and are blocked on the owner: starting the gateway is a Level 3 host deploy on the shared multi-tenant VPS and docker inspect/run require an approval this non-interactive session cannot obtain; ~/mythos-ai-executor/secrets/ and ~/.config/systemd/user/mythos-github-bridge.service.d/ are outside the session's allowlist (ls refused by the tool layer) and sudo is denied; QR pairing needs a human with the phone; no outbound network to re-verify the image tag. Host memory measured: MemAvailable 3298/7746 MiB, swap 3041/4095 MiB used (better than #146, still not the resolved state the gate asks for). notify-config unchanged (enabled false, 0 recipients, no credential). No message sent, no container started, no service restarted, no secret created or printed.

## Commits

- `e4fb2d99295c8ce1754fe6dd388cb3b0d41e1928` ops(whatsapp): owner-run provisioning kit for the private Evolution gateway (gh-issue-170) (awaiting relay)

## Files changed

- `ops/whatsapp/evolution/docker-compose.yml`
- `ops/whatsapp/evolution/bridge-dropin.conf.example`
- `ops/whatsapp/evolution/verify.js`
- `ops/whatsapp/evolution/README.md`
- `tests/whatsapp-gateway-verify-test.js`
- `docs/AI_HANDOVER.md`

## Tests

- tests/whatsapp-gateway-verify-test.js: 24 passed, 0 failed (loopback stub; 0 non-GET requests; apikey header correct on every GET; key absent from all output)
- node --check ops/whatsapp/evolution/verify.js: ok
- docker-compose.yml YAML parse (yaml module): ok — loopback publish, Postgres unpublished, caps, ${EVOLUTION_API_KEY=[REDACTED]]} interpolation confirmed; `docker compose config` not run (requires approval)
- mythos-github-bridge notify-config (read-only): enabled false, provider evolution, 0 recipients, credential absent — unchanged
- Gateway reachable from production: NOT MET (not deployable from this profile)
- Credential/config validated: NOT MET (path outside sandbox; creation scripted, verifier checks mode only)
- Test recipient configured: NOT MET (template placeholder for the owner)
- QR pairing complete / instance ready: NOT MET (human-only; verifier detects state open)
- No message sent without activation approval: MET (0 sends, 0 POSTs, ENABLED never set)

## Validation

- required checks: Gateway exists and is reachable from production.; Credential/config is present and validated without exposing secrets.; Test recipient is configured.; QR pairing is complete and instance is ready.; notify-config reports no blocking configuration problems.; No message is sent without explicit activation approval.
- remote head: e3a19a3ad1c8aa12ee91c41228c50c9841b0e2be
- report problems: none

## Problems

- PERMISSION_DENIED: The repo-write side of #170 is done and committed: ops/whatsapp/evolution/{docker-compose.yml (Evolution API + Postgres, API on 127.0.0.1 only, Postgres unpublished, mem/pid caps, key and DB password as required env-file variables), bridge-dropin.conf.example (all MYTHOS_BRIDGE_WHATSAPP_* set, one placeholder recipient, credential from the 0600 file, ENABLED deliberately absent), verify.js (read-only readiness verifier: bridge problems, key file mode, gateway version, instance connectionState, sending flag — two GETs, never a POST, never prints the key), README.md (owner runbook, activation as a separate approved step)}, tests/whatsapp-gateway-verify-test.js 24/0, and a WA-GATEWAY-PREP entry in docs/AI_HANDOVER.md with the measured host state. The task's validation requirements that need t

## Risks

- remote_head is the branch's current origin head (base e3a19a3); commit e4fb2d9 is delivered by mythos-git-push.timer, not verified on origin at report time
- evoapicloud/evolution-api:v2.3.7 tag not live-verified from this session (no network); runbook step 3 checks it with docker manifest inspect before up
- Stack capped at ~1 GB total vs vendor's 2 GB minimum; first `compose up` is the owner's smoke test, no agent has ever run it
- Healthcheck assumes wget in the Evolution image (node-alpine base); switch to node -e if the container reports unhealthy while answering
- Gate step 3 (measure footprint under caps for a week) still owed before activation; host swap is 74% used on a shared multi-tenant VPS
- Stray evolution-inspect container (state created) left untouched

## Next recommended action

Owner on the host, in ops/whatsapp/evolution/README.md order: §2 credential (0600, outside Git) → §3 docker compose --env-file up (host-deploy approval, free -m first) → §4 instance create + QR scan → connectionState open → §5 drop-in 20-whatsapp.conf with one MSISDN and ENABLED off, daemon-reload → §6 notify-config (problems []) + node ops/whatsapp/evolution/verify.js (READY_FOR_ACTIVATION_REVIEW) pasted as evidence; then §7 activation (ENABLED=1 + notify-test --confirm) = #164 rerun, only with the recorded activation approval
