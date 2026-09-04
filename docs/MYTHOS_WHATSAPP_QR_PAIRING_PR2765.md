# WhatsApp QR pairing failure — root cause and the PR #2765 fix (2026-09-04)

Diagnosis/test record for the production Evolution gateway
(`ops/whatsapp/evolution`, image `evoapicloud/evolution-api:v2.3.7`). Nothing in
this document changed production; every test ran in a throwaway container.
Owner approval is required before §6 is executed.

## 1. Observed (production, 2026-09-04 22:40–22:58 UTC, container clock UTC-3)

Five identical cycles, `LOG_BAILEYS=debug`:

| offset | event |
|---|---|
| +0 s | `connected to WA` → `not logged in, attempting registration...` (QR flow) |
| +60 s | `timed out waiting for message` (msgId `…-7`; see §2.4) in 3 of 5 cycles |
| +90/150/180 s | server `<iq xmlns='urn:xmpp:ping'>` logged as *unhandled* |
| +210 s | `Connection Terminated by Server` (`CB:xmlstreamend`), reconnect |

Instance `mythos-bridge` stays `connecting`; `ownerJid` null. Never logged:
`pair success recv`, `pairing configured successfully`. The phone reports
"can't link device, try again".

## 2. Root cause

### 2.1 Upstream
Since 2026-07-28/29 WhatsApp sends, right after the phone scans the QR,

```xml
<notification from='@s.whatsapp.net' type='companion_reg_refresh' id='…' t='…'>
  <companion_reg_refresh/>
</notification>
```

WA Web answers it by regenerating its **ADV secret key** (the 4th field of the
QR payload) and re-rendering the QR. A client that only acks keeps offering a
QR whose secret the server has retired → the phone's link attempt is rejected,
`pair-success` never arrives, the ref pool drains, the server closes the stream.
Tracked as [WhiskeySockets/Baileys#2737](https://github.com/WhiskeySockets/Baileys/issues/2737)
(reproduced independently in whatsmeow). Fix:
[PR #2765](https://github.com/WhiskeySockets/Baileys/pull/2765), head
`4f263f0`, author doryani-ai, opened 2026-08-10, **open / not merged** as of
2026-09-04; one third-party confirmation of a successful real pairing (ayusc,
2026-08-10). No Baileys release contains it (latest: v7.0.0-rc14 and v6.7.24,
both 2026-07-29).

### 2.2 What the fix does (exact change)
`src/Socket/socket.ts` + new helpers in `src/Utils/companion-reg-client-utils.ts`:
1. registers `ws.on('CB:notification,type:companion_reg_refresh', …)`;
2. the handler requires a `companion_reg_refresh` or `pair-device-rotate-qr`
   child, does nothing if `creds.me` is already set, otherwise sets
   `creds.advSecretKey = randomBytes(32).toString('base64')`, emits
   `creds.update`, and re-renders the **current** QR ref (no ref consumed);
3. the QR render reads `creds.advSecretKey` at render time instead of
   capturing it once when `pair-device` arrives.
The ack path is unchanged (the generic notification handler already acks).

### 2.3 Applicability to Evolution v2.3.7
- Bundled Baileys: `baileys@7.0.0-rc.9` (`/evolution/node_modules/baileys`,
  ESM `lib/*.js`). The `latest` tag on this host is the same 2.3.7 / rc.9.
- rc.9 has **no** `companion_reg_refresh` handling (grep = 0) → affected.
- rc.9 acks pre-login notifications correctly (its `sendMessageAck` only
  dereferences `creds.me` for `message` stanzas), so the companion fix
  [PR #2749](https://github.com/WhiskeySockets/Baileys/pull/2749) is **not**
  needed for rc.9. Verified in the harness trace: `sent ack` for the stanza.
- rc.9 emits the pre-rc10 QR string `ref,noise,identity,adv`. v6.7.24
  (2026-07-29) still emits the same string, so the QR format is not the
  blocker; the port keeps rc.9's format and does not import rc10's
  `buildPairingQRData`.
- Port: `ops/whatsapp/evolution/patches/baileys-7.0.0-rc.9-pr2765/`
  (`pr2765-rc9-port.patch`, 2 files: `Socket/socket.js` modified,
  `Utils/companion-reg-refresh.js` new). Upstream diff kept alongside.

### 2.4 Non-causal noise worth knowing
- The `-7` query timing out at +60 s and the unhandled server pings are
  rc.9 behaviour independent of the scan (the isolated harness shows the same
  server ping). The +210 s "Terminated by Server" is the server giving up on
  the unauthenticated stream, not a reaction to the scan.

## 3. Test environment (isolated, no production path)
`ops/whatsapp/evolution/harness/run.sh <baseline|patched> <mock|live>`:
`docker run --rm --memory 256m --read-only … --entrypoint node
evoapicloud/evolution-api:v2.3.7 harness.mjs` — the exact production image,
node 24.11.1 and dependencies; the original or patched `lib/` bind-mounted
read-only; file auth state under `harness/out/`; **no Evolution API, no
Postgres, no bridge, no webhook, no message**. Browser string, WA web version
(`2.3000.1046865705`), `qrTimeout` 45 s and `keepAliveIntervalMs` 30 s mirror
production. On success the harness reconnects once (WA's 515 restart), then
calls `logout()` so no linked device remains.

## 4. Results — mock (stanza from #2737 injected after the first QR)

| variant | QRs emitted | adv secret rotated | verdict |
|---|---|---|---|
| baseline rc.9 | 1 | no | `NO_ROTATION` (stanza acked, then ignored) |
| patched rc.9 | 2 (same ref, new adv) | yes (`creds.update`) | `ROTATED_AND_REFRESHED` |

## 5. Results — live (owner scan required)
See §5 addendum at the end of this file (filled in from `harness/out/patched-live.events.jsonl`).

## 6. Minimal production implementation plan (needs owner approval)
1. Merge this branch (`mythos/wa-baileys-pr2765-20260904`) so the patch files
   exist in `/home/deploy/projects/mythos-prod/ops/whatsapp/evolution/`.
2. As `deploy`, from that directory:
   ```bash
   docker compose --env-file ~/mythos-ai-executor/secrets/evolution-compose.env \
     -f docker-compose.yml -f docker-compose.pr2765.override.yml config --quiet && echo ok
   docker compose --env-file ~/mythos-ai-executor/secrets/evolution-compose.env \
     -f docker-compose.yml -f docker-compose.pr2765.override.yml up -d evolution-api
   ```
   The override bind-mounts two files read-only over the bundled lib. The
   image is untouched. **Only `evolution-api` is re-created** (one container
   restart; Postgres, bridge, executor untouched). This is a Level 3 host op
   → governance approval + `chgrp mythos-gov` on the approval file.
3. Re-pair: `GET /instance/connect/mythos-bridge` → scan → expect
   `connectionState` = `open` (README §4).
4. Verification output to expect in `docker logs evolution-api`:
   `rotated the adv secret the server asked to retire; re-rendering the pairing QR`
   → `pair success recv` → `pairing configured successfully, expect to restart
   the connection...` → `opened connection to WA`.
5. Rollback: run step 2's `up -d` **without** the override file (or
   `git checkout` the compose dir): the container is re-created from the
   pristine image. Pairing state lives in the volumes and is unaffected.
6. Retire the override when Evolution ships a Baileys that contains #2765
   (or when #2765 lands and Evolution bumps past rc14).

## 7. If the live test fails
Next evidence-based candidates, in order: (a) capture the exact post-scan
stanza sequence from `harness/out/patched-live.log.jsonl` (`recv xml`) and
compare with #2737/#2765 comments; (b) test the PR head build (`npm i
github:WhiskeySockets/Baileys#4f263f0`) in the harness to exclude a port
error; (c) the WAHA / wa-evolution candidates already verified in
`MYTHOS_WHATSAPP_PROVIDER_STRATEGY.md` §3, which use a different protocol stack.

## 5 (addendum). Live scan #1 — patched rc.9, 2026-09-04 23:06–23:17 UTC — FAILED, and it is NOT the #2737 pattern

Phone: « Impossible de connecter l'appareil — Veuillez réessayer plus tard ».
Full Baileys trace (`harness/out/patched-live.scan1.log.jsonl`), three
connections of 210 s each, complete server→client stanza list:

| stanza | count | note |
|---|---|---|
| `<iq type='set' xmlns='md'><pair-device>` (6 refs) | 1 per connection | QR flow start |
| `<iq type='result'>` to our `w:p` ping | 6 per connection | keepalive OK |
| `<iq type='get' xmlns='urn:xmpp:ping'>` from server | 1 per connection | |
| `<xmlstreamend/>` | at +210 s (7th ping unanswered) | server drops the unauthenticated stream |
| **`<notification …>` of any type** | **0** | |
| `pair-success` | 0 | |

- `companion_reg_refresh` was **not received**. The patched handler therefore
  never ran (no `creds.update`, adv tail `KRzmwwk=` unchanged on all 15 QRs).
  The port is not at fault and nothing in this run exercises PR #2765, so a
  PR-head (4f263f0) build to rule out a port error is not warranted yet.
- Production is consistent: with `LOG_BAILEYS=debug`, `sent ack` (logged for
  every notification, pre-login included) appears **0 times** across all owner
  scans. The `…-7` timeout in production is now identified: it is the 7th
  keepalive ping, unanswered because the server ends the stream at +210 s.
- Upstream #2737 is different: there the server *does* react to the scan
  (with `companion_reg_refresh`). Here the server never learns of the scan,
  i.e. the phone rejected the QR locally (or the scanned ref was stale — the
  PNG sent through chat was QR #1 of connection 1, rotated after 45 s, its
  stream closed at 23:09:50; scan time unknown).

**Next evidence-based candidate: the QR payload format.** rc.9 encodes
`ref,noise,identity,adv`. Baileys ≥ rc10 ("NEW QR CODE FORMAT", 2026-05-06)
and current whatsmeow (`pair.go`) encode
`https://wa.me/settings/linked_devices#ref,noise,identity,adv,<platformId>`
(Chrome = 1). Variant `newqr` = PR #2765 port + that payload
(`patches/baileys-7.0.0-rc.9-pr2765-newqr/`). Live scan #2 uses it, with a
QR scanned within its 45 s window; result recorded below.

## 8. Live scan #2 (variant `newqr`, 23:19–23:33 UTC) — FAILED, same phone message

Frame-level inventory of the whole run (`harness/out/newqr-live.log.jsonl`,
4 connections × 210 s): server→client frames = 4 × `pair-device` (698 B),
24 × ping results, 20 × server `urn:xmpp:ping`, 4 × `<xmlstreamend/>`
(23 B). **Every received byte is accounted for; no frame of any other kind
arrived in any connection.** The adv secret never rotated (`v9B40l0=` on all
20 QRs) because nothing triggered the handler.

## 9. Classification (as of 2026-09-04 23:40 UTC)

### Confirmed
- C1. Evolution v2.3.7 bundles Baileys 7.0.0-rc.9, which has no
  `companion_reg_refresh` handler; PR #2765 (head 4f263f0) is the upstream
  fix and my port of it onto rc.9 is functionally identical to the PR head
  built from source (mock: both `ROTATED_AND_REFRESHED`; rc.9 baseline
  `NO_ROTATION`).
- C2. On this host, in production **and** in three isolated harness runs
  (rc.9 patched, rc.9 patched + rc10 QR payload, PR head), the WhatsApp
  server sent **no frame at all** to the companion after the owner's scans
  (production: 0 × `sent ack` under `LOG_BAILEYS=debug`; harness: byte-level
  inventory above). `pair-success` never arrived.
- C3. The upstream reports are a *different* observable: in #2737,
  whatsmeow #1177, whatsapp-mcp #205 and amarula #85 the companion receives
  `companion_reg_refresh` **at the exact scan moment**, and the phone says
  "Couldn't link device — try connection again" / "Check your connection".
  Here the phone says « Impossible de connecter l'appareil — Veuillez
  réessayer plus tard » ("try again later") and the companion hears nothing.
- C4. The `…-7` timeout and the +210 s "Connection Terminated by Server" in
  production are the 7th keepalive ping and the server's unauthenticated-
  stream limit; they are not scan reactions.

### Disproven
- D1. "PR #2765 alone makes pairing complete here" — not sufficient: the
  handler is never reached because the stanza it handles never arrives
  (scan #1, scan #2, and the PR head build).
- D2. "The QR payload format (rc.9's `ref,noise,identity,adv`) is the cause"
  — variant `newqr` with the rc10/whatsmeow payload fails identically, and
  #2737 already documented whatsmeow failing with that payload.
- D3. "A port error" — the PR head built from 4f263f0 reproduces the port's
  behaviour exactly in the mock; no port-specific code is on the path.
- D4. "PR #2749 is needed on rc.9" — rc.9's ack path is already null-safe
  for notifications (verified: `sent ack` logged in the mock runs).

### Not established (no evidence either way — the only remaining unknowns)
- U1. **Scan timing.** Both harness QRs went through chat as PNGs; each ref
  belongs to one 210 s stream. A scan after the stream closed produces exactly
  this signature (phone error, companion hears nothing) and is indistinguishable
  from a server-side refusal. Scan #3 (PR head, one ref held for 200 s, wall-
  clock window announced) is designed to remove this unknown.
- U2. **Account-side state.** WhatsApp's "try again later" wording is the one
  it uses for a temporary refusal (repeated failed link attempts, or the
  4-linked-device limit). The owner can check *Linked devices* for stale
  "MYTHOS bridge" / "Chrome" entries and the device count; no agent can.

### Exact next candidate (evidence-driven, not a new hypothesis)
1. Scan #3: PR head, QR held for 200 s, scanned inside the announced window.
   - If `companion_reg_refresh` arrives → our case *is* #2737 and the PR path
     is validated or refuted on the spot (handler → `pair-success` or not).
   - If still no frame → the phone/server refuses before contacting the
     companion: check U2 (Linked devices count/stale entries), wait out the
     cooldown, retry once from the owner's own terminal
     (`QR_TTY=1 QR_TIMEOUT=200000 ./run.sh prhead live`).
2. Only after a harness pairing succeeds is a production change justified.

### Known-good implementation in September 2026 (item 11)
No released package pairs by QR after the 2026-07-28 server change:
Baileys rc14 / 6.7.24 (2026-07-29) and master `0af2386` (2026-08-04) have no
handler; whatsmeow `main` at `28bfe53` (2026-09-04) has no
`companion_reg_refresh` case (issue #1177 closed *not planned*), so WAHA-GOWS
and every whatsmeow-based bridge share the gap; Evolution 2.4.0-rc2
(2026-05-17, bundles rc13) predates the change. The only live-confirmed
combination is rc14 + #2749 + #2765 (ayusc 2026-08-10; vendored the same way
by Otiosun/sla #111 on 2026-08-30) — i.e. exactly the `prhead` build under
test. If scan #3 shows the stanza never arrives here, no implementation is
"known good" for this account until U1/U2 are resolved.

### Production change justified?
**No.** Nothing has paired in isolation yet; the override stays unapplied.

## 10. Live scan #3 — exact PR head (rc14 + 4f263f0), 23:37:30–23:48:06 UTC — INCONCLUSIVE / pairing not established

Three connections, one ref held for 200 s each. Server→client frames for the
whole run: 3 × `pair-device`, 18 × ping results, 14 × server `urn:xmpp:ping`,
3 × `<xmlstreamend/>` at +210 s. `companion_reg_refresh`: **not received**.
`pair-success`: **not received**. Open connection: **no**. Adv secret unchanged
(`VHOH3yg=`), no `creds.update`, no ack sent. The stream closed without any
scan-related event in all three connections. Whether a scan reached the
server inside the window cannot be determined from the companion side.
Test stopped; no further scan or retry started. Production change: not justified.
