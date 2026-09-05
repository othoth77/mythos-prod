#!/usr/bin/env bash
# qr-live.sh — render the Evolution instance's CURRENT QR in the terminal and
# keep it fresh, so the phone always scans a ref that the WhatsApp server still
# honours (refs rotate every 20–45 s; a relayed PNG is usually stale by the time
# it is scanned — see docs/MYTHOS_WHATSAPP_QR_PAIRING_DIAGNOSIS_2026-09-05.md).
#
# Owner-run, read-only towards the gateway: it only calls
#   GET /instance/connectionState/<instance>   and   GET /instance/connect/<instance>
# and never prints the API key, the header file, the QR text or the base64 PNG.
#
#   ops/whatsapp/evolution/qr-live.sh [instance]        # default: mythos-bridge
#   ops/whatsapp/evolution/qr-live.sh --check [instance] # one probe, no QR output
#
# Environment (all optional):
#   EVOLUTION_URL   gateway base URL            (default http://127.0.0.1:8080)
#   EVOLUTION_HDR   file holding "apikey: …"    (default ~/mythos-ai-executor/secrets/evolution.hdr)
#   QR_INTERVAL     seconds between refreshes   (default 8)
#   QR_MAX_SECONDS  give up after this long     (default 240 — one Evolution stream is ~210 s)
#   QR_PNG_DIR      also write <dir>/wa-qr.png (0600) for a phone that cannot read
#                   the terminal; delete it afterwards
set -euo pipefail

MODE=loop
if [ "${1:-}" = "--check" ]; then MODE=check; shift; fi
INSTANCE=${1:-mythos-bridge}
URL=${EVOLUTION_URL:-http://127.0.0.1:8080}
HDR=${EVOLUTION_HDR:-$HOME/mythos-ai-executor/secrets/evolution.hdr}
INTERVAL=${QR_INTERVAL:-8}
MAX=${QR_MAX_SECONDS:-240}
PNG_DIR=${QR_PNG_DIR:-}

[ -r "$HDR" ] || { echo "qr-live: header file not readable: $HDR (README §4 creates it)" >&2; exit 2; }
command -v qrencode >/dev/null || { echo "qr-live: qrencode not installed (apt-get install qrencode)" >&2; exit 2; }
command -v node >/dev/null || { echo "qr-live: node not found" >&2; exit 2; }

api() { curl -sS --max-time 10 -H @"$HDR" "$URL$1"; }

state() {
  api "/instance/connectionState/$INSTANCE" \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write(String((j.instance&&j.instance.state)||j.state||"unknown"))}catch{process.stdout.write("unparseable")}})'
}

# Prints the QR *text* (never the base64) on stdout; empty when none.
code() {
  api "/instance/connect/$INSTANCE" \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write(typeof j.code==="string"?j.code:"")}catch{process.stdout.write("")}})'
}

if [ "$MODE" = check ]; then
  st=$(state); c=$(code)
  echo "instance=$INSTANCE state=$st qr_text_length=${#c}"
  exit 0
fi

start=$(date +%s); last=""; n=0
while :; do
  st=$(state)
  if [ "$st" = open ]; then
    printf '\n\033[1mPAIRED\033[0m — %s is open (%s UTC)\n' "$INSTANCE" "$(date -u +%H:%M:%S)"
    [ -n "$PNG_DIR" ] && rm -f "$PNG_DIR/wa-qr.png"
    exit 0
  fi
  c=$(code)
  if [ -n "$c" ] && [ "$c" != "$last" ]; then
    last=$c; n=$((n+1)); got=$(date +%s)
    clear 2>/dev/null || printf '\033[2J\033[H'
    printf 'MYTHOS WhatsApp pairing — instance %s — state %s — QR #%d issued %s UTC\n' "$INSTANCE" "$st" "$n" "$(date -u +%H:%M:%S)"
    printf 'Scan NOW (WhatsApp → Linked devices → Link a device). Refreshes every %ss.\n\n' "$INTERVAL"
    printf '%s' "$c" | qrencode -t ANSIUTF8
    if [ -n "$PNG_DIR" ]; then
      ( umask 077; printf '%s' "$c" | qrencode -o "$PNG_DIR/wa-qr.png" -s 8 -m 2 )
    fi
  elif [ -z "$c" ]; then
    printf '\r%s UTC: no QR available yet (state %s)…' "$(date -u +%H:%M:%S)" "$st"
  else
    printf '\rQR #%d age %3ds — state %s   ' "$n" "$(( $(date +%s) - got ))" "$st"
  fi
  if [ $(( $(date +%s) - start )) -ge "$MAX" ]; then
    printf '\nqr-live: gave up after %ss without state=open (last state %s)\n' "$MAX" "$st"
    exit 1
  fi
  sleep "$INTERVAL"
done
