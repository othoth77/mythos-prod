# ops/dagu-poc — Dagu Host Control PoC (DAGU-HOSTOPS-0, 2026-09-03)

The exact files that ran on the VPS at `/home/deploy/dagu-poc` for the assessment recorded in
`docs/MYTHOS_DAGU_HOST_OPERATIONS.md`. Nothing here is a production unit.

| File | Purpose |
|---|---|
| `dagu-poc.service` | deploy-user systemd unit: loopback only, `MemoryMax=256M`, `NoNewPrivileges`, `Restart=on-failure` |
| `config.example.yaml` | Dagu 2.16.2 config used (password placeholder — the real one is a 0600 file, never committed) |
| `dags/t02…t11-*.yaml` | the harmless test workflows (read-only host, Docker inspect, bounded throwaway container, systemd status, expected failure, retry, MYTHOS health, approval gate) |
| `hostops-allowlist.json` | the declared operation allowlist (READ / WRITE / RESTART / DEPLOY; DESTRUCTIVE never) for the future `mythos-hostops` helper |

Invariants: `node tests/dagu-hostops-allowlist-test.js`.

Binary: `dagu_2.16.2_linux_amd64.tar.gz` from `github.com/dagucloud/dagu` (release
2026-09-02), sha256 `4e9e5132accc31ec07af98b1c038751b8c9ea77e4fda583d881e562af75d2156`,
verified against the upstream `checksums.txt`. The binary is not committed.
