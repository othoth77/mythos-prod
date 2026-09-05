#!/usr/bin/env bash
# customer-instance.sh — owner-run, idempotent: create (or verify) the CUSTOMER
# WhatsApp instance of one MYTHOS project on the existing private Evolution
# gateway and point its webhook at the MYTHOS Communication Receiver
# (projects/mythos-wp, POST /hooks/evolution on loopback).
#
#   ops/whatsapp/evolution/customer-instance.sh <instance>            # e.g. ssangyong-autos
#   ops/whatsapp/evolution/customer-instance.sh --verify <instance>   # read-only
#
# Environment (optional):
#   EVOLUTION_URL       default http://127.0.0.1:8080
#   EVOLUTION_HDR       file with "apikey: …" (default ~/mythos-ai-executor/secrets/evolution.hdr)
#   RECEIVER_URL        default http://127.0.0.1:8170/hooks/evolution
#   WEBHOOK_TOKEN_FILE  default /home/deploy/deployments/mythos-wp/webhook.token (0600)
#
# Refuses `mythos-bridge` (the notification instance) unconditionally. Never
# prints the API key, the webhook token, a QR or any base64. The webhook
# token travels to Evolution as a request HEADER (x-mythos-webhook-token),
# stored by Evolution in its private database, never in the URL.
set -euo pipefail
MODE=apply; if [ "${1:-}" = "--verify" ]; then MODE=verify; shift; fi
INSTANCE=${1:-}; [ -n "$INSTANCE" ] || { echo "usage: customer-instance.sh [--verify] <instance>" >&2; exit 2; }
[ "$INSTANCE" != "mythos-bridge" ] || { echo "refused: mythos-bridge is the notification instance, never a customer inbox" >&2; exit 3; }
[[ "$INSTANCE" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]] || { echo "refused: bad instance name" >&2; exit 2; }
URL=${EVOLUTION_URL:-http://127.0.0.1:8080}
HDR=${EVOLUTION_HDR:-$HOME/mythos-ai-executor/secrets/evolution.hdr}
RCV=${RECEIVER_URL:-http://127.0.0.1:8170/hooks/evolution}
TOKF=${WEBHOOK_TOKEN_FILE:-/home/deploy/deployments/mythos-wp/webhook.token}
[ -r "$HDR" ] || { echo "header file not readable: $HDR" >&2; exit 2; }
api() { curl -sS --max-time 15 -H @"$HDR" "$@"; }
js() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{let j;try{j=JSON.parse(s)}catch{console.log('non-json');return}$1})"; }

names=$(api "$URL/instance/fetchInstances" | js 'console.log(j.map(i=>i.name+":"+i.connectionStatus).join(" "))')
echo "instances: $names"
if [ "$MODE" = apply ]; then
  [ -r "$TOKF" ] || { echo "webhook token file not readable: $TOKF" >&2; exit 2; }
  if ! echo " $names " | grep -q " $INSTANCE:"; then
    api -H 'content-type: application/json' -X POST "$URL/instance/create" -d "{\"instanceName\":\"$INSTANCE\",\"integration\":\"WHATSAPP-BAILEYS\",\"qrcode\":false}" | js 'console.log("created:", j.instance&&j.instance.instanceName, "status:", j.instance&&j.instance.status)'
  else echo "instance exists: $INSTANCE"; fi
  BODY=$(node -e 'console.log(JSON.stringify({webhook:{enabled:true,url:process.argv[1],byEvents:false,base64:false,headers:{"x-mythos-webhook-token":require("fs").readFileSync(process.argv[2],"utf8").trim()},events:["MESSAGES_UPSERT","MESSAGES_UPDATE","CONNECTION_UPDATE"]}}))' "$RCV" "$TOKF")
  api -H 'content-type: application/json' -X POST "$URL/webhook/set/$INSTANCE" -d "$BODY" | js 'console.log("webhook set:", j.enabled===true ? "ok" : ("error: "+(j.message||j.error||"?")))'
fi
api "$URL/webhook/find/$INSTANCE" | js 'console.log("webhook:", JSON.stringify({enabled:j&&j.enabled, url:j&&j.url, base64:j&&j.webhookBase64, byEvents:j&&j.webhookByEvents, events:j&&j.events, header_token:!!(j&&j.headers&&j.headers["x-mythos-webhook-token"])}))'
api "$URL/instance/connectionState/$INSTANCE" | js 'console.log("state:", j.instance&&j.instance.state)'
echo "mythos-bridge webhook: $(api "$URL/webhook/find/mythos-bridge")   (must stay null)"
