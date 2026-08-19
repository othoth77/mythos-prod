# OTH Knowledge — Private Persistent Store Architecture

**Status:** CANONICAL — OTH-K3 (2026-08-19)
**Scope:** where the production OTH Knowledge store lives, how it is
protected, backed up, restored, and migrated. Provisioning itself is an
**owner/operator action** and is **NOT performed by this document or by
any AI session** — this is the architecture the operator executes.

Companion documents: `docs/OTH_KNOWLEDGE_ARCHITECTURE.md` (store format),
`docs/OTH_KNOWLEDGE_OPERATIONS.md` (procedures),
`docs/OTH_KNOWLEDGE_INTEGRATION.md` (the read-only consumer contract).

---

## 1. Location contract

The private store is the directory tree defined in the architecture §5
(`records.jsonl` + `objects/` + `meta.json`). Its location obeys, in
order of force:

1. **Never inside Git.** Not in any clone, worktree, or path under a
   repository root. Enforced in code: the executor consumer
   (`projects/mythos-ai-executor/lib/knowledge.js`) refuses any
   `store_root` that resolves inside the repository, refuses relative
   paths, and fails the WHOLE layer closed on violation.
2. **Never inside `projects/oth-knowledge/`.** The in-repo `data/`
   default exists for fixtures/tests only; a production store there is a
   contract violation even though that path is git-ignored.
3. **Never in an ephemeral container layer.** The store must survive
   redeploys and container recreation (AGENTS.md §3, §15).
4. **Persistent, private, single-writer.** One operator-controlled
   directory on persistent storage.

**Canonical production location (owner decision pending — OWNER-BLOCKED):**

```
/home/deploy/othk-store/            # VPS 51.68.226.211, user deploy
```

This path satisfies all four rules and sits on the VPS's persistent
filesystem. Until the owner ratifies it (or names another persistent
private path), the executor config `config/knowledge.json` ships
`enabled:false, store_root:null` — the activation act IS the owner's
provisioning decision.

## 2. Configuration and fail-closed activation

- Activation is exactly: operator provisions the directory, then sets an
  **absolute, out-of-repo** `store_root` and `enabled:true` in
  `projects/mythos-ai-executor/config/knowledge.json`.
- The config accepts only `enabled`, `store_root`, `description`.
  Endpoint-, URL-, key-, token-, secret-, password-, credential-shaped
  keys anywhere in the document are rejected by design — the store is a
  local path, and anything credential-shaped appearing in its config is
  an accident the validation exists to catch.
- Any validation defect disables the whole knowledge layer (never a
  partial read). A disabled layer is a normal, reportable state.
- The knowledge layer itself needs **no credentials**: no database, no
  network, no SaaS. There is nothing secret to configure, which is the
  strongest secret-handling posture available.

## 3. Ownership and permissions

- **Owner:** the `deploy` service user (uid on the VPS), the same
  account the verified Windows→VPS channel lands on.
- **Mode:** `0700` on the store root; files created `0600`
  (`umask 077` in any operator shell/procedure that writes the store).
  No group or world access: the store contains private knowledge.
- **Single writer:** only operator-invoked CLI/importer processes write
  (append-only). The AI Operating Layer consumes read-only through the
  service facade and can never write (operation allowlist, proven by
  `tests/othk-2w-executor-wiring-test.js` against a deliberately
  widened service).
- No web server, daemon, or port ever serves the store directory.

## 4. Secret handling

- Secrets never enter the store: the ingest credential-shape gate
  refuses key/token/private-key-shaped content with a typed error and
  stores only a refusal observation (kind of match, never the match) —
  tested in `tests/othk-2-importers-test.js`.
- The store path config carries no secrets (§2).
- Backups inherit the store's privacy class: they are private data and
  are encrypted whenever they leave the VPS (§6).

## 5. Integrity verification

- `node cli/othk-cli.js --store <root> validate` hash-verifies every
  artifact object (content addressing) and referential integrity; exit 0
  + `"ok": true` is the health criterion.
- `records.jsonl` must never shrink (append-only). Size shrinkage or
  unexplained growth is an incident (operations doc §7).
- After every import batch and every restore: `validate`, then a spot
  search, then backup.

## 6. Backup strategy

- **Unit of backup:** the whole store root, copied consistently (no
  writer running): `tar czf othk-backup-<UTC date>.tar.gz <root>`.
- **Cadence:** after every real import batch, and at minimum weekly
  while the store changes; a store with no writes since the last backup
  needs no new backup (append-only makes this checkable by file size +
  record count).
- **Integrity hash:** record `sha256sum` of every backup archive next to
  it (`.sha256` file); verify before any restore and after any transfer.
- **Off-host destination:** per AGENTS.md §16 backups live outside the
  application host. The verified transfer channel today is
  **owner Windows ⇄ VPS SCP** — the operator pulls
  `othk-backup-*.tar.gz` + `.sha256` to owner-controlled storage.
  Off-host automation (e.g. object storage) is a future owner decision;
  until then the documented manual pull IS the off-host step.
- **Encryption:** any backup that leaves the VPS or lands on shared
  storage is encrypted at rest. Standard tool available on both ends of
  the verified channel: `openssl enc -aes-256-cbc -pbkdf2` or `age`;
  the passphrase/key lives in the operator's password manager — never in
  the repository, never in the store, never in a config file.
- **Retention:** keep at least the last 7 batch backups and one
  known-good monthly archive; delete older backups only by explicit
  operator action (never automated deletion — AGENTS.md §16).

## 7. Restore strategy

1. Verify archive hash against its `.sha256`.
2. Untar to a **fresh** directory (never over a live store).
3. `validate` the restored root (must exit 0).
4. Spot-search a known record.
5. Only then repoint config/procedures at the restored root.

A backup is valid only after a tested restore (AGENTS.md §16). The
restore test is operator-executable on the VPS or any machine with
Node ≥ 18; a live VPS round trip is **OWNER-BLOCKED** until the owner
runs it over the verified channel (this cannot be validated from the AI
execution environment, and unit tests do not count as backup
validation).

## 8. Disaster recovery

| Loss | Recovery |
|---|---|
| Corrupted log tail (partial write) | truncate `records.jsonl` to last valid line, `validate`; append-only means no earlier data is at risk |
| Store directory lost | restore latest backup (§7); re-import any batches after the backup from their original exports (importers are idempotent — re-import is safe by construction) |
| VPS lost | provision replacement host, install Node ≥ 18, copy `projects/oth-knowledge/` from GitHub, restore backup from owner-held off-host copy |
| Backup passphrase lost | unencrypted on-VPS copies (if VPS alive) or re-import from original exports; record this risk in the operator's key-management practice |
| Original exports lost AND store lost AND backups lost | unrecoverable — which is why off-host backup (§6) and retained original exports are both required |

Recovery point objective: last backup + re-importable exports (i.e. zero
knowledge loss while original exports are retained). Recovery time: the
restore procedure is minutes; host reprovisioning dominates.

## 9. Migration strategy

- **Store format:** the JSONL log is the durable interchange format;
  `export`/re-`seed` round-trips losslessly (tested). A future
  PostgreSQL/object-store backend is additive behind the same `store.js`
  interface, with the migration triggers and requirements recorded in
  `docs/OTH_KNOWLEDGE_ARCHITECTURE.md` §12a (measured, not assumed).
- **Location move:** stop writers → final backup → restore-to-new-root
  procedure (§7) → repoint config → `validate`. The store carries no
  absolute paths internally, so relocation is content-neutral.
- **Format version:** `meta.json` carries the store format version; any
  future format change ships a deterministic, tested migration that
  preserves content hashes, provenance, and version history.

## 10. Operational procedure (condensed)

```bash
# provision (operator, on VPS, once — OWNER decision on location)
umask 077 && mkdir -p /home/deploy/othk-store

# import batch (operator, per authorized source)
node cli/othk-cli.js --store /home/deploy/othk-store import-takeout <dir>
node cli/othk-cli.js --store /home/deploy/othk-store validate

# backup + hash (operator, after every batch)
tar czf othk-backup-$(date -u +%Y%m%d).tar.gz -C /home/deploy othk-store
sha256sum othk-backup-*.tar.gz > othk-backup-$(date -u +%Y%m%d).tar.gz.sha256

# encrypt + pull off-host (owner Windows, verified SCP channel)
# (encrypt on VPS first; passphrase from operator password manager)
```

Scripted forms of these steps live in `projects/oth-knowledge/ops/`
(see the operations runbook §2/§6).

## 11. Status ledger

| Item | State |
|---|---|
| Architecture, contracts, fail-closed config | COMPLETE (this document + code) |
| In-repo store prevention | VERIFIED (executor config validation + tests) |
| Secret gate | VERIFIED (othk-2 suite) |
| Production directory provisioning | OWNER-BLOCKED — owner ratifies location, operator runs §10 |
| Live backup/restore round trip | OWNER-BLOCKED — operator executes §6–§7 over the verified channel |
| Off-host automated backup destination | OWNER-BLOCKED — owner decision (manual SCP pull is the interim documented path) |
