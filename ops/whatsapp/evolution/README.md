# MYTHOS WhatsApp production gateway — Evolution API runbook

Owner-operated provisioning of the one private WhatsApp gateway the MYTHOS
GitHub bridge notifies through (`docs/MYTHOS_BRIDGE_WHATSAPP_NOTIFY.md`).
Prepared for GitHub Issue #170; unblocks the rerun of #164.

> **Evolution API is being utilized.** Its Apache-2.0 licence addendum
> requires this visible notice for administrators. When the stack is live,
> repeat the notice in `docs/MYTHOS_BRIDGE_WHATSAPP_NOTIFY.md` §10 and the
> Status Center (`docs/MYTHOS_WHATSAPP_PROVIDER_STRATEGY.md` §7).

## 0. What is here and who runs it

| File | Purpose |
|---|---|
| `docker-compose.yml` | Evolution API + Postgres, loopback-only, memory/pid-capped, no Redis, no message persistence. Reads the two secrets from an env-file **outside Git**. |
| `bridge-dropin.conf.example` | The bridge's systemd drop-in with everything set **except** `ENABLED` — validates end to end while sending stays off. |
| `verify.js` | Read-only readiness check: bridge config, gateway reachability/version, instance pairing state, credential file mode, sending flag. Two GETs, never a POST, never prints the key. Guarded by `tests/whatsapp-gateway-verify-test.js`. |

Every step below is a **host operation performed by the owner** (or a
human they authorise), not by an agent: starting a stateful container on the
shared production VPS is Level 3 (AGENTS.md §25.3), the credential and
drop-in paths are outside any executor sandbox by design, and the QR scan
needs a physical phone. An agent's job ends at delivering and verifying
these files; that is what Issue #170's task delivered.

**Prerequisite gate** (`docs/MYTHOS_WHATSAPP_PROVIDER_STRATEGY.md` §6): this
host is shared with other tenants' live services and has been under swap
pressure (2026-09-04: MemAvailable 3.3 GB of 7.7 GB, swap 3.0/4.0 GB used —
better than the 0 MiB headroom measured on 09-02, still not comfortable).
The caps in the compose file bound the blast radius (≤ 1 GB for the stack)
but do not remove the decision: confirm the headroom right before `up`
(`free -m`) and be ready to `docker compose down` if `docker stats` shows
the caps being hit.

## 1. Private gateway shape (what this deploys)

```
127.0.0.1:8080  ──►  evolution-api   (mem 768m, pids 256)
                         │ compose network "evolution-private" (no published port)
                     evolution-postgres (mem 256m, pids 128)
```

- API published on loopback only. The bridge refuses a non-private host
  without `MYTHOS_BRIDGE_WHATSAPP_ALLOW_PUBLIC=1`, so this is enforced twice.
- No reverse proxy, no TLS, no public DNS — nothing to expose.
- Message bodies are not stored (`DATABASE_SAVE_DATA_*=false`); only the
  instance/session survives restarts (`evolution_instances`, `evolution_pgdata`).
- Redis omitted (`CACHE_LOCAL_ENABLED=true`): one instance, one recipient.

## 2. Credential — create once, store outside Git (as `deploy`)

```bash
install -m 700 -d ~/mythos-ai-executor/secrets
umask 077
# one 64-hex global API key, shared by the gateway and the bridge
openssl rand -hex 32 > ~/mythos-ai-executor/secrets/evolution.key
# compose env-file: the same key + an internal-only Postgres password
printf 'EVOLUTION_API_KEY=%s\nEVOLUTION_DB_PASSWORD=%s\n' \
  "$(cat ~/mythos-ai-executor/secrets/evolution.key)" "$(openssl rand -hex 24)" \
  > ~/mythos-ai-executor/secrets/evolution-compose.env
chmod 600 ~/mythos-ai-executor/secrets/evolution.key ~/mythos-ai-executor/secrets/evolution-compose.env
ls -l ~/mythos-ai-executor/secrets/      # both 0600, owner deploy
```

Never `cat` these files into a terminal that is being recorded, never paste
them into GitHub, OTHMODE, a report or a chat. Only their **existence and
mode** are ever reported.

## 3. Bring the stack up (owner, with the governance approval for a host deploy)

```bash
cd /home/deploy/projects/mythos-prod/ops/whatsapp/evolution      # the production checkout
docker manifest inspect evoapicloud/evolution-api:v2.3.7 >/dev/null && echo tag-ok
#   if the tag does not resolve, set EVOLUTION_IMAGE=<verified tag> in the env-file
#   (2.3.7 = last stable per WA-PROVIDER-2, 2026-09-04; not re-verified from the executor sandbox)
free -m                                                           # headroom check, see §0
docker compose --env-file ~/mythos-ai-executor/secrets/evolution-compose.env config --quiet && echo compose-ok
docker compose --env-file ~/mythos-ai-executor/secrets/evolution-compose.env up -d
docker compose --env-file ~/mythos-ai-executor/secrets/evolution-compose.env ps
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/      # 200 (or 401 without key) = reachable
ss -ltnp | grep 8080                                              # must show 127.0.0.1:8080 only
```

Evidence to record (non-secret): `docker compose ps` output, the `ss` line,
`docker stats --no-stream evolution-api evolution-postgres`.

## 4. Create the instance and pair by QR (owner, physical phone)

Requests carry the key as a header read from the file — the key never lands
in shell history. `curl -H @file` reads a header line from a file:

```bash
printf 'apikey: %s\n' "$(cat ~/mythos-ai-executor/secrets/evolution.key)" > ~/mythos-ai-executor/secrets/evolution.hdr
chmod 600 ~/mythos-ai-executor/secrets/evolution.hdr

# create the instance the bridge will use (name must match the drop-in)
curl -s -H @"$HOME/mythos-ai-executor/secrets/evolution.hdr" -H 'content-type: application/json' \
  -X POST http://127.0.0.1:8080/instance/create \
  -d '{"instanceName":"mythos-bridge","integration":"WHATSAPP-BAILEYS","qrcode":true}' \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(JSON.stringify({instance:j.instance&&j.instance.instanceName,status:j.instance&&j.instance.status,qr:!!(j.qrcode&&j.qrcode.base64)}))})'

# fetch the QR (base64 PNG) and render it locally — do NOT paste it anywhere public
curl -s -H @"$HOME/mythos-ai-executor/secrets/evolution.hdr" http://127.0.0.1:8080/instance/connect/mythos-bridge \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);require("fs").writeFileSync("/tmp/wa-qr.png",Buffer.from(String(j.base64||"").replace(/^data:image\/png;base64,/,""),"base64"));console.log("QR written to /tmp/wa-qr.png; scan within 60 s, then rm it")})'
```

Scan `/tmp/wa-qr.png` with WhatsApp → *Linked devices* on the phone that
owns the sending number, then delete the file. The QR expires; re-run the
`connect` call to get a fresh one (`QRCODE_LIMIT=30` attempts).

Confirm pairing:

```bash
curl -s -H @"$HOME/mythos-ai-executor/secrets/evolution.hdr" http://127.0.0.1:8080/instance/connectionState/mythos-bridge
#   {"instance":{"instanceName":"mythos-bridge","state":"open"}}   ← "open" = paired and ready
```

## 5. Configure the bridge — sending stays OFF

```bash
install -d ~/.config/systemd/user/mythos-github-bridge.service.d
cp /home/deploy/projects/mythos-prod/ops/whatsapp/evolution/bridge-dropin.conf.example \
   ~/.config/systemd/user/mythos-github-bridge.service.d/20-whatsapp.conf
$EDITOR ~/.config/systemd/user/mythos-github-bridge.service.d/20-whatsapp.conf
#   set MYTHOS_BRIDGE_WHATSAPP_TO to the ONE designated test recipient (digits only, e.g. 216XXXXXXXX)
#   leave the ENABLED line commented
systemctl --user daemon-reload
systemctl --user show mythos-github-bridge.service -p Environment | tr ' ' '\n' | grep -c MYTHOS_BRIDGE_WHATSAPP_   # 5 variables, no ENABLED
```

`daemon-reload` only re-reads unit files; the oneshot bridge picks the new
environment up on its next timer tick. **No restart of any running service
is needed for this step**, so the "no production restart" constraint of
#170 holds.

## 6. Verify — no message is sent by any of this

```bash
cd /home/deploy/projects/mythos-prod
set -a; . <(sed -n 's/^Environment=//p' ~/.config/systemd/user/mythos-github-bridge.service.d/20-whatsapp.conf | sed "s|%h|$HOME|"); set +a
node projects/mythos-ai-executor/bin/mythos-github-bridge notify-config   # enabled:false, credential_present:true, recipients_configured:1, problems: []
node ops/whatsapp/evolution/verify.js                                     # verdict: READY_FOR_ACTIVATION_REVIEW, exit 0
```

`verify.js` output is safe to paste into the Issue / the OTHMODE task as
evidence: it holds booleans, counts, the version, the state and the file
mode — never a value.

## 7. Activation — a separate, explicitly approved step (not part of #170)

Only with the recorded activation approval:

1. uncomment `Environment=MYTHOS_BRIDGE_WHATSAPP_ENABLED=1` in the drop-in,
   `systemctl --user daemon-reload`;
2. `node ops/whatsapp/evolution/verify.js` → `READY_AND_SENDING_ENABLED`;
3. the single controlled real message, human-invoked:
   `node projects/mythos-ai-executor/bin/mythos-github-bridge notify-test --confirm`
   (`docs/MYTHOS_BRIDGE_WHATSAPP_NOTIFY.md` §7.1) — this is #164's rerun.

Rollback at any point: remove/comment the `ENABLED` line + `daemon-reload`
(sending off, nothing else changes); `docker compose down` stops the
gateway (volumes keep the pairing); `docker compose down -v` forgets the
pairing and requires a new QR scan.
