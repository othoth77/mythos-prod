# OTH Knowledge — Operations Runbook

**Status:** CANONICAL — OTH-K2 (2026-08-19)
**Scope:** operating the knowledge layer (`projects/oth-knowledge/`) anywhere Node ≥ 18 exists. No service, port, daemon, or credential.

## 1. What is automatic vs. what needs a human

| Concern | Automatic | Operator action | Owner authorization |
|---|---|---|---|
| Validation, dedup, secret gate, provenance stamping | ✔ (every ingest) | — | — |
| Fixture/eval/test runs | ✔ (`node tests/othk-*.js`) | — | — |
| Real-data import (Takeout/Gemini/NotebookLM/Docs) | — | run CLI/importers on the machine holding the export | ✔ per source (private data) |
| Contacts content (beyond metadata) | — refused fail-closed | — | ✔ explicit policy reversal required |
| Persistent private store location | — | provision directory/storage | ✔ (decides where private knowledge lives — never Git) |
| VPS deployment | — | §6 package over verified owner channel | ✔ |
| Conflict resolution (ambiguous) | — never automatic | — | ✔ or documented rule |

## 2. Store operations

**Store root:** any directory (`data/` default; production: a persistent
private path, e.g. `/home/deploy/othk-store/` on the VPS — NEVER a Git
worktree, NEVER an ephemeral container layer).

- **Health check:** `node cli/othk-cli.js --store <root> validate` → exit 0 and `"ok": true`.
- **Stats/monitoring expectation:** `stats` record counts should only grow or stay equal; `validate` must stay ok; any `problems[]` entry is an incident.
- **Backup:** the store is two things — `records.jsonl` + `objects/` (+ `meta.json`). Backup = consistent copy of the root directory (no writer running): `tar czf othk-backup-<date>.tar.gz <root>`. Store backups outside the application host per AGENTS.md §16; contents are private data — encrypt at rest where the destination is shared.
- **Restore:** untar to a fresh root, then `validate` (hash-verifies every artifact object and referential integrity). A backup is valid only after a tested restore.
- **Rollback:** the log is append-only; a corrupted tail line can be truncated to the last valid line (validate afterwards). Records are never edited in place, so rollback of content = tombstone or supersede, both auditable.

## 3. Re-index / re-import / re-evaluation

- **Re-index:** indexes are built in memory at open — there is no on-disk index to corrupt. Re-index = reopen. If a real embedder is ever configured, re-indexing is reproducible from the stored records + recorded embedding model/version.
- **Source re-import:** re-running any importer over the same input is a no-op by construction (content addressing + deterministic ids); a changed input produces new artifacts alongside the preserved originals. Always re-run `validate` after a batch.
- **Evaluation:** `node eval/run-eval.js` (fixtures corpus, committed query set) — measured numbers only; `node eval/bench-store.js [N]` for store performance evidence.

## 4. Conflict resolution procedure

1. `findContradictions({state:'open'})` (service) or `othk-cli` search by the conflict relationship.
2. For each: inspect both records, their source classes, truth timestamps, confidences.
3. Documented automatic rule (safe to apply, always explicitly recorded): **a newer EXPLICIT owner-report statement supersedes an older lower-confidence statement** — resolve with `decided_by: "rule:newer-explicit-owner-statement"` and the winner id.
4. Everything else stays `open` until a human decides (`resolveConflict` with `decided_by`, rationale). Losing records remain readable forever.

## 5. Real-data import procedures (operator-executable)

On the machine holding the export (each needs owner authorization for the source):

```bash
node cli/othk-cli.js --store <root> import-takeout <extracted-takeout-dir>   # unzip first
node cli/othk-cli.js --store <root> import-gemini <gemini-export.json>
node cli/othk-cli.js --store <root> import-notebooklm <note.md>              # one note per file
node cli/othk-cli.js --store <root> import-contacts-metadata <contacts.csv> # aggregates only; content refused by policy
node cli/othk-cli.js --store <root> ingest <file> --class google-other      # generic documents (md/txt/json/html/csv)
```

After every batch: `validate`, then spot-search, then backup (§2).

**Known blocker (2026-08-19):** from the AI execution environment, Drive
content download is denied by session permission policy, and the VPS is
unreachable — real imports are operator-local actions for now
(`docs/OTH_K2_DATA_DISCOVERY.md`).

## 6. Deployment package (VPS, operator-executable)

AI-agent→VPS access: **NOT AVAILABLE** (re-verified 2026-08-19: TCP 22
unreachable, no client, no keys). The owner channel IS verified
(Windows→VPS SSH/SCP as `deploy`, ED25519; rsync on VPS only). Package:

```bash
# from the owner machine (rsync absent on Windows → scp/tar-over-ssh)
git clone https://github.com/othoth77/mythos-prod && cd mythos-prod   # or scp the checkout
scp -r projects/oth-knowledge deploy@51.68.226.211:/home/deploy/oth-knowledge
ssh deploy@51.68.226.211 'mkdir -p /home/deploy/othk-store && node /home/deploy/oth-knowledge/cli/othk-cli.js --store /home/deploy/othk-store seed /home/deploy/oth-knowledge/seeds/infrastructure-2026-08-19.json && node /home/deploy/oth-knowledge/cli/othk-cli.js --store /home/deploy/othk-store validate'
```

Verify: `validate` exits 0; `stats` shows the seed counts; a search for
"rsync windows" returns the infrastructure fact. Rollback: remove the
copied directory; the store root is untouched by code updates. Record
the deployed commit in `docs/AI_HANDOVER.md`.

## 7. Health checks and monitoring expectations

- `validate` exit 0 (integrity) — run after every import batch and in any scheduled check the host offers.
- `records.jsonl` size growth should correspond to imports; unexplained growth or shrinkage is an incident (the file must never shrink).
- Secret scan on any store that ever leaves the host: refusal patterns are enforced at ingest, but exported bundles should still be scanned before transfer.

## 8. Requirements ledger

- **Requires credentials:** nothing today (no embedder, no DB, no network).
- **Requires operator:** real imports (§5), deployment (§6), backups (§2).
- **Requires owner authorization:** each real private source; contacts content policy reversal; persistent private store location; any future embedding provider (credential + data egress decision).
