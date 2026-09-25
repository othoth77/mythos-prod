# ops/hostops — mythos-hostops v0.2 (controlled privileged gateway)

v0.1 (HOSTOPS-READONLY-0, 2026-09-03) was a READ-only boundary. **v0.2** (2026-09-25) adds the CONTROLLED tier so
FABLE can manage catalogued host state autonomously, while HIGHLY_SENSITIVE operations stay owner-only.
Model: `docs/MYTHOS_PERMISSION_MODEL.md` · contract: `docs/MYTHOS_HOSTOPS_INTERFACE.md` (v0.2 addendum).

| File | Installed as | Purpose |
|---|---|---|
| `mythos-hostops.js` | `/usr/local/sbin/mythos-hostops` (0700 root) | the helper: catalog, tiers, HARD invariants, gates, intent/result audit, backups, verification, rollback; root-scoped `systemctl`/`docker restart` only |
| `mythos-hostops-user-worker.js` | `/usr/local/lib/mythos-hostops/user-worker.js` (0755 root) | deploy-scoped execution (drop-ins, `systemctl --user`, bridge tools), launched via `systemd-run --user` as deploy; refuses root |
| `mythos-hostops-daemon.py` + `.socket`/`.service` | `/usr/local/sbin/mythos-hostops-daemon`, `/etc/systemd/system/` | root socket daemon (SO_PEERCRED: deploy/dagu/root), fixed argv, 90 s ceiling; `ProtectHome=read-only` unchanged |
| `../dagu-poc/hostops-allowlist.json` | `/etc/mythos/hostops-allowlist.json` (0644 root) | the catalog (schema 0.2): operations, services, containers, config_keys, tools, highly_sensitive_operations |
| `hostops-client.js` | — (run from the checkout) | the FABLE/operator client, through the executor adapter `lib/hostops.js` |
| `live-selftest.js` | — | real-host self-test: `--mode direct` (before install), `--mode socket` (after install, FABLE path) |
| `60-dagu-hostops` | `/etc/sudoers.d/` | dagu's manual sudo rule (the helper only) |
| `install-hostops.sh` | — | owner installer (root); restarts `user@<uid>` only if the manager lacks the group |

```bash
node ops/hostops/hostops-client.js catalog
node ops/hostops/hostops-client.js config-get --key bridge.whatsapp.to                       # masked
node ops/hostops/hostops-client.js config-set --key bridge.whatsapp.to --value +216XXXXXXXX --task-id <id>
node ops/hostops/hostops-client.js change-rollback --change <audit_id> --task-id <id>
node ops/hostops/hostops-client.js service-control --unit spy.service --action restart --task-id <id>
node ops/hostops/hostops-client.js tool-run --tool bridge.notify-test --confirm yes --task-id <id>
```

Owner kill switch (disables every CONTROLLED operation, READ keeps working): `sudo touch /etc/mythos/hostops-controlled.disabled`.
Ledger: `/var/lib/mythos/hostops/audit.jsonl` (intent + result, masked); backups: `/var/lib/mythos/hostops/changes/`.

Tests: `node tests/mythos-hostops-controlled-test.js` (root proves the privilege drop), `tests/dagu-hostops-allowlist-test.js`,
`tests/mythos-hostops-test.js`, `tests/mythos-hostops-executor-test.js`, `tests/mythos-hostops-daemon-test.js`,
`tests/mythos-hostops-group-refresh-test.js`; live: `sudo node ops/hostops/live-selftest.js --mode direct|socket`.
