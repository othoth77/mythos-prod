# Worklog — Ecosystem Audit, VPS-Only Work Preservation, and Conversation Extraction MVP

**Date:** 2026-08-30
**Time:** 15:44 – 19:40 UTC (single continuous execution)
**Agent:** Claude Opus 5 (Claude Code, interactive session)
**Task:** Independent ecosystem audit → preservation of unprotected work → extraction MVP for archive → knowledge

> **Scope note.** This is the public execution record. It states what happened, what changed and what was verified. A small number of security findings are recorded here by severity and location-class only; their exploitable specifics were deliberately withheld from this public repository and are listed in §"Withheld from this record" for routing to the private governance surface.

---

## 1. Mission

Answer one question with evidence rather than documentation: **what does the OTH / MYTHOS ecosystem actually have today?** Then protect whatever that audit found to be unprotected, and build the smallest layer that lets the archive become knowledge.

## 2. Starting state

- `origin/main` at `8842ee5` (`docs: add MYTHOS system inventory and reuse index`), later advanced by the owner to `7065265`.
- Local clone at `fbba31f`, 2 commits behind `origin/main`.
- 25 repositories on the account; `mythos-prod` public, the rest private.
- VPS `vps-4722f0a9` reachable on two SSH channels.
- No prior verified execution record for this work.

## 3. Objective

1. Independent audit — GitHub, local machine, VPS, live domains, Claude/AI, MCP, n8n, security.
2. Protect anything irreplaceable that the audit found unprotected.
3. Determine canonical ownership per capability.
4. Design and implement the minimum archive → knowledge extraction layer.
5. Record the result durably.

## 4. Decisions made, and why

| # | Decision | Reasoning |
|---|---|---|
| 1 | Treat the System Index as a **baseline**, not truth | Runtime evidence outranks documentation (index §2 says so itself) |
| 2 | Clone repositories locally instead of using the GitHub code-search API | Search API rate limit exhausted after ~25 queries; local clones are complete and reproducible |
| 3 | Protect `oth.db` **before** any further work | It was the only populated store in the ecosystem and had no second copy |
| 4 | Build the preservation commit with a **temporary git index** rather than `git checkout -b` | Production services execute from the VPS worktree; a branch switch would move `HEAD` on a live host. Plumbing left `HEAD`, the working tree and `refs/heads/main` untouched |
| 5 | Put the statement selector **outside** `projects/oth-knowledge/` | Every `lib/` module there is offline and deterministic; a model call would break that and make the suites non-deterministic |
| 6 | Use the existing `claim` record kind for candidates | The `KINDS` enum is closed; `claim` already means "asserted, not verified". No new record kind, no new store |
| 7 | Idempotency via a `derived` extraction marker | Its id is deterministic on (derivation, document), so the check is free and needs no change to `extract.js` |
| 8 | Register three new source classes rather than reuse `external-provider` | That class is `metadata-only`, and `ingest.js` refuses content ingestion for it. Its own note prescribes registering a dedicated class first |
| 9 | **Stop** at the real-AI validation phase | The only Claude provider carries `execution_authority: true`; the established pattern (`core/decompose.js`) refuses execution-authority providers for model-output work, and no advisory credential exists. Proceeding would have meant inventing an unauthorised path |
| 10 | Reuse `docs/worklogs/` for this record instead of a new repository | An established `YYYY-MM-DD-HHMM-slug.md` convention already exists here; a parallel repo would fragment the history |

## 5. Work performed

**Audit (15:44 – 18:50 UTC)** — seven successive read-only audits covering the ecosystem, VPS infrastructure, VPS-only ERP work, the backup failure, source-of-truth ownership, and memory/identity consolidation. All findings evidence-classed VERIFIED / PARTIALLY VERIFIED / UNKNOWN.

**Preservation (17:20 UTC)** — three uncommitted working-tree files on the production VPS, existing nowhere else, committed and pushed.

**Implementation (19:00 – 19:40 UTC)** — the conversation extraction MVP, then the zero-render fix found by running it.

## 6. Files created

| Path | Purpose |
|---|---|
| `projects/oth-knowledge/lib/importers/conversation.js` | Offline, deterministic candidate importer. Persists claim + evidence + extraction marker. Never calls a model |
| `scripts/othdb-select.js` | Statement selector. Advisory-only provider, bounded output, field whitelist, fail-closed |
| `scripts/othdb-extract.js` | `oth.db` → selector → importer bridge. Reads SQLite read-only via built-in `node:sqlite` |
| `tests/othk-4-conversation-extraction-test.js` | 90 offline assertions, synthetic fixtures, stub transports |
| `docs/worklogs/2026-08-30-1940-ecosystem-audit-and-extraction-mvp.md` | This record |

## 7. Files changed

| Path | Change |
|---|---|
| `projects/oth-knowledge/config/source-classes.json` | +3 classes (`claude`, `deepseek`, `chatgpt`), each `policy: content` |
| `projects/oth-knowledge/config/trust-model.json` | +3 tiers, each `model-output` |

Changed together deliberately: `trust.js` closes both ways and refuses the whole model if the two files disagree.

## 8. Files removed or archived

None. Nothing was deleted at any point in this execution.

## 9. Components reused

`ingest.ingestArtifact` (chunking, secret gates, policy refusal) · `ingest.detectSecretShapes` (the selector's pre-check uses the same detector as the ingest gate, so they cannot disagree) · `extract.addClaim / addEvidence / addDerived` · `ids.recordId` · `provenance.buildProvenance / ensureSource` · `trust.js` · `dedup.js` · `store.js` · `config/agents.json` · the `core/decompose.js` **pattern** (its three guarantees transcribed) · the `importers/notebooklm.js` **pattern** (end-to-end importer shape) · the unmerged `scripts/memory-ingest.js` **pattern** (idempotency-by-marker, error isolation, report shape) · the `othk-2` test harness conventions.

## 10. Existing components modified

Only the two configuration files in §7. No existing module, provider, service, unit, probe or policy was modified.

## 11. External projects / libraries adopted

**None.** `oth-knowledge` remains dependency-free; SQLite access uses Node's built-in `node:sqlite` (experimental API, no package added).

## 12. Tests executed and results

```
othk-0-knowledge-core-test              89 passed, 0 failed
othk-1-search-test                      30 passed, 0 failed
othk-2-importers-test                   97 passed, 0 failed
othk-3-trust-test                       63 passed, 0 failed
othk-4-conversation-extraction-test     90 passed, 0 failed   (new)
────────────────────────────────────────────────────────────
TOTAL                                  369 passed, 0 failed
```

Pre-existing suites were green before and after every change. The load-bearing assertion — **zero `fact` records created by the extractor** — is enforced eight times in the suite, recomputed from the store in every bridge report, and confirmed on a live trial store.

Live exercise: five real archived conversations, read from a verified backup, into a temporary store. Result: 1 claim, 1 evidence, **0 facts**, store `verify()` clean, idempotent re-run added nothing (682 records before and after).

## 13. Security findings

Recorded by severity and class. Exploitable specifics withheld — see §21.

| Severity | Finding | State |
|---|---|---|
| CRITICAL | The ecosystem's only populated data store had no second copy | **Resolved** — verified backup taken, §15 |
| HIGH | Unique work existed only in a production working tree | **Resolved** — preserved to GitHub, §17 |
| HIGH | An unauthenticated write surface exists behind a server-level deny; its stated exposure premise was found to be stale | Open — owner action |
| HIGH | A privileged remote-desktop surface is reachable on a public port | Open — owner action |
| HIGH | Host memory pressure: swap fully consumed; no OOM kills yet | Open — recorded, not fixed |
| MEDIUM | Several production databases have no evidenced backup pipeline | Open |
| MEDIUM | A plaintext credential export exists on the local desktop | Open — owner action |
| MEDIUM | Monitoring reports the backup system healthy while a second, unwatched chain is failing | Open — one-line probe fix identified |

**Controls confirmed working:** restricted `sudo` allowlist for the admin account · deploy account excluded from the container group · budget deny-by-default · fail-closed MCP capability registry that rejects endpoint/credential-shaped keys by presence · knowledge store write-restricted to the operator CLI · secrets refused rather than redacted at ingestion · owner-only approval for high-risk evolution · fast-forward-only delivery relay · append-only off-host backup that scheduled jobs cannot delete from.

## 14. Backup state

- **File/media chain:** healthy. Last verified success 2026-08-30 15:01 UTC, 0 consecutive failures; monthly restore-into-throwaway test passed 2026-08-27.
- **Database chain:** failing, and **correctly so**. Root cause established: its target database has not been provisioned yet, because off-host backup coverage is a documented hard gate that must exist *before* that database is created. The pipeline fails closed at its own preflight; nothing is lost, and no production data sits behind the failure.
- **Verified live:** the file chain dumps the *production* database, not the development one — proven from dump header metadata, not from configuration alone.

## 15. Data integrity state

- Protected archive: SHA-256 verified identical to source, byte-for-byte compare clean, SQLite `integrity_check` / `quick_check` / `foreign_key_check` all clean on both copies, page arithmetic matches file size exactly. Re-verified at 19:40 UTC: **OK**.
- The archive was opened **read-only** throughout this execution and was never written.
- Identity resolution inside the archive was examined and found sound: unique record fingerprints across all person rows, organisation deduplication by normalised name with no duplicates present, and ambiguous pairs flagged for human review rather than auto-merged.

## 16. Git state

| Ref | SHA | Note |
|---|---|---|
| `origin/main` | `7065265` | **unchanged by this execution** |
| `origin/feat/erp-redesign` | `6499146` | **unchanged by this execution** |
| `origin/vps/preserve-20260830` | `7e01dea` | VPS-only working-tree work |
| `origin/vps/extraction-mvp-20260830` | `f586bd2` | MVP `1b0e935` + zero-render fix `f586bd2` |

Both branches were created as new refs and pushed without force. No history was rewritten. Nothing was merged.

**Open, unchanged:** the production VPS clone remains 14 ahead / 3 behind its origin, and the delivery relay continues to refuse the divergence. That refusal is the safety mechanism working; the work behind it is now preserved, so it is a delivery backlog rather than a data-loss risk. A governance denial on one commit also remains unresolved pending owner approval.

## 17. Risks discovered

1. The only populated data store had no second copy.
2. Unique work existed solely in a production working tree.
3. A pipeline could retire a conversation permanently on a non-result.
4. Backup monitoring was blind to one of its two chains.
5. Production configuration had drifted ahead of Git for three days.
6. Identity has no deployed canonical owner; the only store holding real identity data is an archive.
7. Two distinct systems both use the word "task" with different lifecycles and no join key.
8. Three competing implementations of the same business subsystem exist, none deployed.

## 18. Risks resolved

1. Archive protected, verified, and integrity-checked (§15).
2. VPS-only work preserved to GitHub and verified remotely (§16).
3. Zero-render defect fixed, guarded in two independent places, 11 regression assertions, verified on the conversation that exposed it.
5. Production drift closed — the live fix is now committed and pushed.

## 19. Unresolved items

- Git divergence between the production clone and `origin/main` (owner decision).
- Governance denial on one protected-path commit (owner approval).
- Database backup chain intentionally failing until its target is provisioned.
- Backup monitoring blind spot (fix identified, not applied).
- Identity ownership undecided.
- "Task" naming collision unresolved.
- Which of three business-subsystem implementations is canonical.
- Host memory and disk pressure.
- The extraction selector has never run against a real model.

## 20. UNKNOWN items

- Live automation workflow inventory — data directory not readable from the available account.
- Contents and consumer of one production database engine — no credentials used, by choice.
- Database list inside the container — deploy account deliberately excluded from the container group.
- Cause of a root-owned file appearing inside the deploy worktree.
- Whether two private stores are inside the off-host backup manifest (staged locally; remote inclusion unconfirmed).
- Whether the conversation-export adapter for one provider works against a real export — never validated.

## 21. Withheld from this record

This repository is public. The following were deliberately **not** written here, and should be routed to the private governance surface (Status Center blockers / owner channel) rather than to a public file:

- Exact host paths, ports and service names for the two HIGH exposure findings.
- The object-storage account-identifying endpoint.
- Any credential, key-file path with a value, token, cookie or session identifier.
- Any conversation content, personal name, contact detail or database record.
- The single extracted candidate's statement text — recorded as CONTENT_OMITTED_FOR_PRIVACY.

No credential or private value was read into any report at any point; environment files were inspected key-name-only through redaction.

## 22. Final system state

- Ecosystem audited with evidence; the System Index was independently reconciled by the owner mid-execution and now carries evidence classes.
- The irreplaceable archive is protected and verified.
- All previously unprotected work exists on GitHub.
- The extraction MVP exists, is tested (369 assertions), and has been exercised on real data into a temporary store.
- **Nothing in production was modified.** No deployment, no service restart, no configuration change, no database write, no merge to `main`.

## 23. Next execution state

Begin by reading this record and the two branches it names.

**Ready to proceed without further investigation:**
1. Provision an **advisory** credential (not the execution-authority provider) so the selector can run for real, then re-run the same five conversations and compare against the recorded baseline.
2. Apply the one-line monitoring probe fix for the unwatched backup chain.
3. Decide the Git divergence and the pending governance approval.

**Requires an owner decision first:** identity ownership · which business-subsystem implementation is canonical · whether archive content may be ingested into the knowledge store at all · whether the undeployed intelligence subsystem is ever deployed.

**Must not be repeated:** re-auditing what this record already establishes · rebuilding any capability listed in §9 as reused · treating the System Index as runtime truth · scaling extraction past five conversations before a human has read what a real model selects.
