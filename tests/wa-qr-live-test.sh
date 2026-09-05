#!/usr/bin/env bash
# Offline test for ops/whatsapp/evolution/qr-live.sh against a fake gateway.
# Asserts: (1) --check reports state + QR length without leaking the key or the
# QR text; (2) the loop renders a QR, then exits 0 once the fake reports "open";
# (3) the key and the base64 never appear in any output; (4) a missing header
# file fails closed with exit 2.
set -euo pipefail
HERE=$(cd "$(dirname "$0")/.." && pwd)
S=$HERE/ops/whatsapp/evolution/qr-live.sh
T=$(mktemp -d); trap 'rm -rf "$T"; kill $SRV 2>/dev/null || true' EXIT
KEY=TESTKEY-do-not-leak-1234567890
printf 'apikey: %s\n' "$KEY" > "$T/hdr"; chmod 600 "$T/hdr"
QR='2@FAKEREF/abc,noisePubFake=,identityPubFake=,advSecretFake='
B64='iVBORw0KGgoFAKEBASE64PAYLOAD'
cat > "$T/srv.py" <<PY
import http.server, json, os, sys, time
KEY=os.environ["KEY"]; QR=os.environ["QR"]; B64=os.environ["B64"]
T0=time.time(); OPEN_AFTER=float(os.environ.get("OPEN_AFTER","2"))
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self,*a): pass
    def do_GET(self):
        if self.headers.get("apikey")!=KEY:
            self.send_response(401); self.end_headers(); return
        if self.path.startswith("/instance/connectionState/"):
            st="open" if time.time()-T0>OPEN_AFTER else "connecting"
            body={"instance":{"instanceName":"x","state":st}}
        elif self.path.startswith("/instance/connect/"):
            body={"pairingCode":None,"code":QR,"base64":"data:image/png;base64,"+B64,"count":1}
        else:
            self.send_response(404); self.end_headers(); return
        b=json.dumps(body).encode(); self.send_response(200)
        self.send_header("content-type","application/json"); self.send_header("content-length",str(len(b)))
        self.end_headers(); self.wfile.write(b)
http.server.HTTPServer(("127.0.0.1",int(sys.argv[1])),H).serve_forever()
PY
PORT=$((20000 + RANDOM % 20000))
KEY=$KEY QR=$QR B64=$B64 OPEN_AFTER=3 python3 "$T/srv.py" "$PORT" & SRV=$!
for i in $(seq 1 50); do curl -s -o /dev/null "http://127.0.0.1:$PORT/" && break; sleep 0.1; done
pass=0; fail=0
ok(){ pass=$((pass+1)); echo "ok   - $1"; }; bad(){ fail=$((fail+1)); echo "FAIL - $1"; }

out=$(EVOLUTION_URL=http://127.0.0.1:$PORT EVOLUTION_HDR=$T/hdr "$S" --check demo 2>&1)
[[ "$out" == "instance=demo state=connecting qr_text_length=${#QR}" ]] && ok "--check reports state and QR length" || bad "--check output: $out"

set +e; out=$(EVOLUTION_URL=http://127.0.0.1:$PORT EVOLUTION_HDR=$T/hdr QR_INTERVAL=1 QR_MAX_SECONDS=20 QR_PNG_DIR=$T TERM=dumb "$S" demo 2>&1); rc=$?; set -e
[ $rc -eq 0 ] && ok "loop exits 0 once the instance is open" || bad "loop rc=$rc: $(printf '%s' "$out" | tail -c 300)"
grep -q 'QR #1 issued' <<<"$out" && ok "loop rendered the first QR" || bad "no QR banner"
grep -q 'PAIRED' <<<"$out" && ok "loop announced PAIRED" || bad "no PAIRED line"
[ ! -e "$T/wa-qr.png" ] && ok "PNG removed after pairing" || bad "PNG left behind"
! grep -q "$KEY" <<<"$out" && ok "API key never printed" || bad "API key leaked"
! grep -q "$B64" <<<"$out" && ok "base64 never printed" || bad "base64 leaked"

set +e; out=$(EVOLUTION_HDR=$T/missing "$S" --check demo 2>&1); rc=$?; set -e
[ $rc -eq 2 ] && ok "missing header file fails closed (exit 2)" || bad "missing header rc=$rc"

echo "wa-qr-live: $pass passed, $fail failed"; [ $fail -eq 0 ]
