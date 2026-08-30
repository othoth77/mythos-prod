# Worklog — MYTHOS RECON + MCP Integration: Reconciliation Before Implementation

**Date:** 2026-08-30
**Time:** 20:00 – 20:55 UTC
**Agent:** Claude Opus 5 (Claude Code, interactive session)
**Task:** Reconcile the whole accessible ecosystem, then implement only what is genuinely missing
**Branch:** `vps/oth-mcp-20260830`
**OTHMODE:** activated (`activated: true`, verified via `othmode-cli.js activation`). Task record written to `projects/command-center/data/pending-task-imports/2026-08-30-mythos-recon-mcp-reconciliation.json` because OTHMODE write access requires a token this environment does not hold.

---

## 1. Mission

Turn existing work into one coherent, non-duplicated system. Reconcile first; build only what reconciliation proves absent.

## 2. Starting state

- `origin/main` at `7065265`; working branch `vps/oth-mcp-20260830`, nine commits ahead.
- Three `vps/*` branches existed: `preserve-20260830`, `extraction-mvp-20260830`, `oth-mcp-20260830`.
- Extraction MVP preserved and green (369 assertions) from the prior execution.

## 3. Discovered architecture

**The named MCP foundation (`3bbee990`, 2026-08-19) is real and integrated.** `lib/mcp-capabilities.js` (164 LOC) resolves which `server.tool` names a skill may use under a given execution profile, wired at `executor.js:169` and rendered into the skill prompt at `executor.js:267`. It is fail-closed: an `endpoint`/`url` key anywhere rejects the whole registry by presence, and the one declared server ships `enabled: false`. It is an authorization layer, not a protocol surface.

**MYTHOS RECON already exists.** `projects/status-center/lib/engine.js` `runReview()` is described in its own header as "the full reconciliation": `verifyEvidence()`, `reconcileDocuments()` (surfaces conflicts), `discoverRepositories()` (emits `NEW_DISCOVERY`, "nothing is silently classified"), `compareReviews()` across immutable append-only snapshots. It owns `DISCOVERY_CLASS` (7 values) and a 9-rung `MATURITY` ladder, and `model.js` states it is "READ-ONLY with respect to the rest of the repository: nothing in this module writes anywhere."

**An OTH MCP already existed on this branch**, committed concurrently with this session at `0b6b1d2`: `projects/oth-knowledge/service/othk-http.js`, `projects/oth-mcp/server.js` (7 tools), and two suites.

## 4. Reconciliation results

| Capability | Classification | Verdict |
|---|---|---|
| MCP capability authorization | DEPLOYED (in-executor) | **REUSE** — extended its config only |
| MYTHOS RECON | IMPLEMENTED | **REUSE** — not built |
| OTH Knowledge HTTP facade | IMPLEMENTED, NOT DEPLOYED | **CONSOLIDATE** — duplicate withdrawn |
| OTH MCP server | IMPLEMENTED, NOT DEPLOYED | **REUSE** |
| Status Center discovery feeder | **BROKEN** (stale, no writer) | **BUILD** |
| `oth-knowledge` capability declaration | **MISSING** | **BUILD** (config only) |
| Extraction MVP | IMPLEMENTED | REUSE, untouched |
| Memory / identity / governance / execution | DEPLOYED | REUSE, untouched |

**Three of four candidates were not built because they already existed.**

## 5. Decisions and reasoning

1. **Did not build MYTHOS RECON.** The Status Center review engine satisfies the entire specification — discover, collect evidence, compare, classify, surface conflicts, own nothing. Building a parallel component would have created a second reconciliation authority.
2. **Built only the feeder.** `data/repo-snapshot.json` is what `discoverRepositories()` compares against. Its own `capture_method` asked for a manual refresh, and no script performed one. Captured 2026-08-20, it had gone stale, so `NEW_DISCOVERY` could not fire for anything created since.
3. **Extended the existing capability registry rather than adding a second.** The `oth-knowledge` declaration carries no connection detail, because that registry rejects `endpoint`/`url` by design. It ships `enabled: false` and declares **no write tool**.
4. **Consolidated onto the pre-existing facade.** Mine and the existing one were functionally equivalent; the existing one is committed, better placed, and accompanied by an MCP server.
5. **Did not rewire `oth-mcp/server.js` to consult `lib/mcp-capabilities.js`.** They address different concerns — the registry governs which tools an executor *skill* may name; the server's `TOOLS` is the *client-facing* surface. Rewiring freshly written, tested code discovered late in the session was the riskier action. Recorded as an owner decision.

## 6. Work performed

**Created:** `scripts/status-snapshot.js` — writes one file, in the schema the engine already reads, from the authorized `gh` session. `--dry-run` supported; run dry first.

**Modified:** `config/mcp-capabilities.json` (+`oth-knowledge`, 9 read tools, disabled) · `data/repo-snapshot.json` (2026-08-20 → 2026-08-30, 23 → 24 repositories) · `docs/MYTHOS_SYSTEM_INDEX.md` (recorded the reconciliation engine and its feeder).

**Withdrawn as duplicates:** `scripts/othk-serve.js`, `tests/othk-5-facade-test.js`.

## 7. Reused components

Status Center review engine, `model.js` vocabularies and probe model · `lib/mcp-capabilities.js` authorization · `lib/knowledge-service.js` read boundary · the existing `othk-http.js` facade and `oth-mcp/server.js` · the `gh` authorized session · existing test harness conventions.

## 8. Recovered historical work

`3bbee990` — the M-12 governed MCP capability foundation was located, read, and confirmed live in the executor rather than treated as historical. Its config was extended instead of being replaced.

## 9. Tests

```
othk-0  89 | othk-1  30 | othk-2  97 | othk-3  63 | othk-4  90
othk-5-http-facade  44 | othk-6-mcp-server  36        = 449 passed, 0 failed
stc-1  73 | stc-2  86 | stc-ar  50                    = 209 passed, 0 failed
```

Registry fail-closed re-verified: adding a `url` key is *"rejected by design"*; an unknown tool field is rejected by name.

Feeder effect verified: the review engine dry-run now reports **"New repo discoveries: 1"** — previously impossible.

**Known environment failures, not regressions:** `tests/mythos-ai-executor-test.js` (`TASK_SCHEMA_INVALID: root.working_directory`) and `tests/mos-1-console-test.js` fail **identically with this change reverted**. Both are Windows path/environment issues; authoritative validation requires an LF clone on Linux.

## 10. Security review

No credential created, read or written. The new script reads GitHub through the already-authorized `gh` session and stores no token. The capability declaration contains no endpoint, and the registry rejects one by construction. No write tool was declared. No network surface was opened; nothing was deployed. The task record and this worklog were scanned for credentials, emails, IPs and bearer tokens — zero hits.

## 11. Deployment

**IMPLEMENTED BUT NOT DEPLOYED.** No service started, restarted or reconfigured; no production file touched; `origin/main` and `origin/feat/erp-redesign` unchanged; no force-push, no history rewrite, no merge to `main`.

## 12. Risks

**Discovered and resolved:** the discovery feeder was dark, so the reconciliation engine could not see new repositories — fixed and verified. A duplicate facade was written before branch state was re-checked — withdrawn, with the cause recorded.

**Unresolved:** `othoth77/spy` now surfaces as `NEW_DISCOVERY` and needs owner classification · `oth-mcp/server.js` does not consult `lib/mcp-capabilities.js` · the `oth-knowledge` declaration is disabled pending deployment · two suites cannot be validated on Windows.

## 13. UNKNOWN

Whether the concurrent `vps/oth-mcp-20260830` work has additional intent not visible in its commits · whether the MCP server has been exercised against a real client · live n8n workflow inventory (unchanged, still unreadable from this account).

## 14. Final state

One reconciliation engine, one capability authorization system, one knowledge facade, one MCP server, one extraction pipeline. The recon engine can now see the account. Nothing was duplicated into production, and the one duplicate created during this work was withdrawn before commit.

## 15. Next state

Owner decisions: classify `othoth77/spy` · decide whether the MCP server should consult the capability registry · enable the `oth-knowledge` declaration when the facade deploys. Then: run the Status Center review non-dry to persist a snapshot recording the discovery, and validate the two Windows-blocked suites on an LF Linux clone.

**Must not be repeated:** rebuilding recon, the knowledge facade, the MCP server, or the capability registry — all four exist and are named here.
