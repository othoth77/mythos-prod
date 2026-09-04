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
