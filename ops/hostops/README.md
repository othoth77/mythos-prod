# ops/hostops — mythos-hostops v0.1 (READ-ONLY security boundary)

Stage **HOSTOPS-READONLY-0** (2026-09-03). The root-owned boundary between the future Dagu
host-operations layer and the host, per `docs/MYTHOS_DAGU_HOST_OPERATIONS.md` §7–§8 and the
Executor-facing contract in `docs/MYTHOS_HOSTOPS_INTERFACE.md`.

| File | Purpose |
|---|---|
| `mythos-hostops.js` | the helper — six READ verbs, structured JSON, fail-closed audit, no shell anywhere (`spawnSync` with argument arrays only) |
| `60-dagu-hostops` | the ONLY sudo grant for the `dagu` identity: the helper binary, nothing else |
| `install-hostops.sh` | owner installer (root): dagu user, helper 0700 root:root, allowlist copy, audit dir, sudoers rule |

Verbs (from `ops/dagu-poc/hostops-allowlist.json`, class READ only): `health`,
`docker-status`, `docker-logs`, `systemd-status`, `file-read`, `resource-guard`.
WRITE / RESTART / DEPLOY verbs are refused by name with their class; DESTRUCTIVE does not
exist. `file-read` additionally refuses secret-shaped filenames, non-regular files,
traversal and anything resolving outside `/home/deploy/{deployments,projects}`.

Audit: one JSONL event per invocation (including refusals) in
`/var/lib/mythos/hostops/audit.jsonl`; a successful operation whose audit record cannot be
written is withheld (exit 5). Task identity (`--task-id`, `--othmode-task`,
`--github-task`) is validated and recorded.

Tests: `node tests/mythos-hostops-test.js` (run as root for the live docker/systemd probes).
