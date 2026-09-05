# MYTHOS WhatsApp — QR pairing failure: diagnosis of 2026-09-05

Scope: Evolution API `v2.3.7` (Baileys `7.0.0-rc.9`, Node 24.11.1), instance
`mythos-bridge`, owner phone WhatsApp Android `2.26.33.76`. Continues the
2026-09-04 work on branch `mythos/wa-baileys-pr2765-20260904`
(`docs/MYTHOS_WHATSAPP_QR_PAIRING_PR2765.md` there, not on `main`).
Nothing in production was changed by this diagnosis.

## 1. Baseline (read-only, 12:26 UTC)

| Item | Value |
|---|---|
| Production checkout | `40e7705` = `origin/main`; one uncommitted file: `ops/whatsapp/evolution/docker-compose.yml` (`LOG_LEVEL` → `ERROR,WARN,INFO,DEBUG`, `LOG_BAILEYS` → `debug`). This is the deliberate diagnostic setting from 2026-09-04 22:39; the running container was started with it (22:40 UTC). Kept as is. |
| Containers | `evolution-api` healthy, 0 restarts since 22:40 UTC; `evolution-postgres` healthy. A stray `evolution-inspect` container (image `:latest`, created 2026-09-03, never started) exists — harmless, not ours to delete here. |
| Versions | Evolution 2.3.7, Baileys 7.0.0-rc.9, WA Web version fetched live per connection (`2.3000.10468…`, changes hour to hour → `fetchLatestWaWebVersion`, so "stale version" is excluded). |
| Instance | `connecting`, integration `WHATSAPP-BAILEYS`, no owner JID, one `Session` row (1250-byte creds), `Setting` all false. Identity key unchanged across all 20 registrations in the log. |
| Registration | `browser = ["MYTHOS bridge","Chrome",<kernel>]` → platform `WEB`, `webSubPlatform WEB_BROWSER` (still valid; only `WIN32` was retired — Baileys PR #2741), `DeviceProps.os "MYTHOS bridge"`, `platformType CHROME`. |
| Log signature (24 h) | 19 × `connected to WA` → `not logged in, attempting registration…` → 56 server pings → `Connection Terminated by Server` (428) at +210 s; 2 × `Log out instance` when `QRCODE_LIMIT=30` is hit. **Zero** frames other than pings: no `pair-success`, no `notification` of any type, no `sent ack`. |

## 2. Upstream research (primary sources, 2026-09-05)

| Source | Finding |
|---|---|
| WhiskeySockets/Baileys releases | Last: `v7.0.0-rc14` and `v6.7.24`, both 2026-07-29. `master` = `0af2386` (2026-08-04). No release since. |
| Baileys #2737 (open, 5 comments, last 2026-08-24) | `companion_reg_refresh` unhandled. Its signature is **a notification arriving at scan time** + phone text "try connection again". Ours: no frame at all + "try again later". Not our case (established 2026-09-04, re-confirmed today). |
| Baileys PR #2765 (open, head `4f263f0`, stale) | Still unmerged; harness build of it failed identically yesterday. |
| Baileys #2689 / #2696 (closed unmerged), whatsmeow `b572e5b` (2026-06-30), WAHA 2026.7.1, OpenWA #560 | WhatsApp is rolling out **mandatory passkey (WebAuthn) verification** for device linking on some accounts (from ~2026-06-29, phased). whatsmeow/WAHA-GOWS implement it (`passkey_prologue_request` → user signs a challenge on the `web.whatsapp.com` origin); **no Baileys release has any passkey code** (rc.9: 0 hits). In that flow the companion *does* receive a notification after the scan, and the phone shows "Continue on your other device" / "Create a passkey…" — again not the observed "no frame + try again later". Kept as a secondary hypothesis. |
| Baileys #2782 (2026-08-26) | Business accounts reject platform `ANDROID`; `WEB` + `WEB_BROWSER` (ours) is accepted. |
| Community signal | Issues since 2026-07-28: Baileys 34 total, Evolution 38 total, mautrix-whatsapp 8 (none about QR login), WAHA none about QR. Only two lonely Evolution reports match our phone text (#2679 Aug-06, #2696 Aug-17, both 0 comments). If QR pairing were broken for all Baileys/whatsmeow clients the trackers would be flooded. **QR pairing works in general in Sept 2026 on rc.9, rc14 and whatsmeow.** |
| whatsmeow `qrchan.go` (working reference client) | Emits a new QR **every 20 s** (first one 60 s), i.e. mirrors the official web client's rotation. rc.9 via Evolution rotates every 45 s (`qrTimeout: 45e3`); the 2026-09-04 scan #3 deliberately held one ref for 200 s. |

## 3. Root-cause classification

**Primary: I/H — scan timing (stale QR ref), a delivery-path problem, not a code bug.**
Evidence:
1. Every scan so far was of a **relayed snapshot**: production QRs were fetched by an agent (`GET /instance/connect/mythos-bridge` → base64 → PNG → chat), the harness QRs were PNGs sent through chat, and README §4 itself writes `/tmp/wa-qr.png` on the VPS for the owner to copy off. The reference client rotates refs every 20 s; a ref older than its server-side lifetime yields exactly this signature — the phone's lookup fails immediately ("Couldn't link device — try again later") and the server has no reason to contact the companion (no frame).
2. All code-level variants (rc.9, rc.9 + #2765 port, rc.9 + new QR payload, rc14 + #2765 head) fail identically → the common factor is the scan path, not the library.
3. Registration payload, WA Web version and sub-platform are all current and identical in shape to what works for the rest of the Evolution/Baileys user base today.

**Secondary (only if a correctly timed scan still fails): C/B — account in the mandatory-passkey rollout, unsupported by Baileys.** Discriminator: the companion would then receive a `passkey_prologue_request` notification after the scan (visible at `LOG_BAILEYS=debug`), and the phone would offer to create/use a passkey rather than fail instantly. Owner can pre-check: WhatsApp → Settings → Account → Passkeys, and whether the recent Firefox link asked for fingerprint/face.

**Tertiary: G — account-side cooldown after many failed link attempts** (WhatsApp's "try again later" wording is also its cooldown text). Discriminator: a fresh, correctly timed scan still fails *and* no notification arrives; resolves by itself after hours.

Excluded with evidence: A (Evolution bug: registration/QR path is stock and works elsewhere), D (stale auth: fresh identity, no prior pairing ever completed), E (device identification: `WEB_BROWSER` valid; Firefox proves the account can link), F (network: handshake, registration and pings all succeed for 210 s per stream), stale WA Web version (fetched live).

## 4. Fix delivered here (no production change)

`ops/whatsapp/evolution/qr-live.sh` — owner-run, read-only towards the gateway.
It polls the **production** instance every 8 s, renders the *current* QR text
in the terminal with `qrencode` (already installed on the VPS), refreshes
whenever the ref rotates, shows the age of the displayed QR, and exits 0 as
soon as `connectionState` is `open`. It never prints the API key, the header
file, the QR text or the base64. `--check` is a one-shot probe for tests and
for agents (prints state and QR length only). Test:
`tests/wa-qr-live-test.sh` (8/8, offline fake gateway).

### Owner procedure (one properly timed scan, ~2 minutes)
```bash
ssh root@<vps>                                   # any terminal that shows Unicode blocks
sudo -u deploy -H bash /home/deploy/projects/mythos-prod/ops/whatsapp/evolution/qr-live.sh
```
Then on the phone: WhatsApp → Linked devices → Link a device → scan the QR **while
the "age" counter is below 20 s**. Outcomes:
- `PAIRED` printed → done; continue with README §5 (bridge drop-in, `notify-test --confirm`).
- Phone offers a passkey / "Continue on your other device" → secondary hypothesis confirmed; the
  fix is an engine that implements passkey pairing (WAHA-GOWS is the verified candidate in
  `docs/MYTHOS_WHATSAPP_PROVIDER_STRATEGY.md`), not an Evolution/Baileys upgrade.
- Same instant failure with a <20 s-old QR → check Linked devices count/stale entries, wait out
  a possible cooldown (≥ 6 h without any further attempt), retry once; if it still fails, run the
  scan with `LOG_BAILEYS=debug` (already on) and read `docker logs evolution-api` for any
  `notification` frame — that frame, or its absence, decides between B/C and G.

## 5. What was NOT done, and why
- No Evolution image change: 2.3.7 is the latest stable (2.4.0-rc2 bundles rc13 and predates every relevant upstream change); no released Baileys or whatsmeow package would change the observed behaviour.
- No session/instance deletion: the identity has never paired; deleting it removes nothing that the server knows about.
- No QR was rendered or relayed from this session; no message was sent; the bridge stays with sending OFF.
