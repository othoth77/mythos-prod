# Isolated QR-pairing harness (no Evolution API, no DB, no message)

Runs `harness.mjs` inside a throwaway container from the production image so
the Baileys build under test is byte-identical to what Evolution v2.3.7 ships.

Layout expected by `run.sh` (one directory above `harness/`):

```
<root>/baileys-lib-orig/      # docker cp evolution-api:/evolution/node_modules/baileys/lib
<root>/baileys-lib-patched/   # the same + patches/baileys-7.0.0-rc.9-pr2765 applied
<root>/harness/{harness.mjs,run.sh,out/}
```

```bash
docker cp evolution-api:/evolution/node_modules/baileys/lib <root>/baileys-lib-orig
cp -a <root>/baileys-lib-orig <root>/baileys-lib-patched
(cd <root> && patch -p1 -d baileys-lib-patched < patches/baileys-7.0.0-rc.9-pr2765/pr2765-rc9-port.patch)

./run.sh baseline mock     # expect verdict NO_ROTATION
./run.sh patched  mock     # expect verdict ROTATED_AND_REFRESHED
WA_VERSION=2.3000.1046865705 QR_TTY=1 ./run.sh patched live   # prints the QR in the terminal; scan it
```

Live mode writes `out/qr-<variant>.png` (mode 0600), logs every
`<notification>` it receives, reconnects once after WhatsApp's 515 restart and
then **logs the test device out** so nothing stays linked. Events:
`out/<variant>-live.events.jsonl`; full Baileys trace: `out/<variant>-live.log.jsonl`.
Delete `out/` afterwards (it holds the test key material).
