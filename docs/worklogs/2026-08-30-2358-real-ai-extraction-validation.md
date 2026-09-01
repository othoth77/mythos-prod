# Worklog — Real AI Extraction Validation (attempted)

**Date:** 2026-08-30
**Time:** 23:52 – 23:58 UTC
**Agent:** Claude Opus 5 (Claude Code, interactive session, on the VPS)
**Task:** Validate the existing Extraction MVP with a real advisory AI provider, on the same five conversations, without rebuilding anything.

> **Outcome: the real AI run was NOT performed.** A legitimate advisory provider **is** available and was proven working. The run was stopped by three other blockers, each verified live and reported below. No quality metric is reported, because none was measured. Nothing was faked, and no control was weakened to produce a green result.

---

## 1. Decision

```
FINAL EXTRACTION STATUS:  BLOCKED — SAFETY
REAL PROVIDER AVAILABLE:  YES
FULL ARCHIVE:             NOT RUN (explicitly out of scope; 1,299 conversations untouched)
```

`BLOCKED — SAFETY` is the primary label because two deliberate, correctly-functioning controls would deny this execution even if every engineering piece were in place: **budget deny-by-default**, and an **outstanding owner authorization** for ingesting archive content at all. A third blocker is engineering, not safety — the advisory transport is an unimplemented stub. If the owner considers that gap primary rather than the controls, the honest alternative label is `NOT READY`. It is **not** `BLOCKED — PROVIDER`: a registered, credentialed, reachable advisory provider exists.

## 2. Starting state

| | |
|---|---|
| Host | `vps-4722f0a9.vps.ovh.net` — session already on the VPS |
| Worktree | `/home/deploy/oth-mcp`, branch `vps/mcp-deployment-20260830`, clean |
| HEAD at start | `c38ef92` (previous mission: MCP deployment + real-client validation) |
| Prior record read | `docs/worklogs/2026-08-30-1940-ecosystem-audit-and-extraction-mvp.md` |

## 3. Reconciliation — the existing implementation, unchanged

Read before anything was touched. **No extraction component was modified, and no second extraction engine was created.**

| Component | Role |
|---|---|
| `scripts/othdb-select.js` | statement selector; the only model-calling module, deliberately outside `projects/oth-knowledge/` |
| `scripts/othdb-extract.js` | `oth.db` → selector → importer bridge; reads SQLite read-only |
| `projects/oth-knowledge/lib/importers/conversation.js` | offline, deterministic importer; persists claim + evidence + marker; never calls a model |
| `projects/mythos-ai-executor/config/agents.json` | the provider registry |
| `projects/mythos-ai-executor/providers/openai-compat.js` | the advisory provider adapter (OmniRoute) |
| `projects/mythos-ai-executor/core/budget.js` + `config/budgets.json` | deny-by-default spend control |
| `tests/othk-4-conversation-extraction-test.js` | 90 assertions, incl. the load-bearing zero-fact tests |

## 4. Provider — REAL AI AVAILABLE = **YES**

The prior record stated no advisory credential existed. **That is now out of date, and the correction matters:** a real one is present, just not where the prior execution looked.

```
agent           omniroute-advisory        (registry: config/agents.json)
provider        openai-compat             execution_authority: false, enabled: true, risk_level: low
gateway         OmniRoute http://127.0.0.1:20128/v1   — loopback
credential      $HOME/.config/mythos-ai-executor/advisory.env, 0600
```

Verified live, without printing any secret:

| Check | Result |
|---|---|
| Credential file exists | **yes** — `/home/ubuntu/.config/mythos-ai-executor/advisory.env`, mode 0600, `ubuntu`-owned |
| Key present | yes — 35 chars, `sk-` class. **The value was never printed, logged or committed.** |
| `openai-compat.available()` as `ubuntu` | **true** |
| `openai-compat.available()` as `deploy` | **false** |
| `GET /v1/models` without key | 401 |
| `GET /v1/models` with key | **200**, 1002 models offered (incl. `openrouter/openai/gpt-4o-mini`, the adapter default) |

**Why the prior record said otherwise:** the adapter resolves its key file from `$HOME`, and the executor runs as `deploy` while the credential was provisioned under `ubuntu`. Both statements were true of their own account. The credential is real; it is simply invisible to the service user. Recorded as a finding, **not fixed** — moving or copying a credential is an owner decision, and this mission had no mandate to provision one.

`claude-code` was **not** used. Verified by assertion, not intention: calling the selector with `agent: 'claude-code'` returns `SELECTOR_REFUSED: agent claude-code claims execution authority; advisory-only agents may select`.

## 5. Blocker 1 — the advisory transport is not implemented

The decisive engineering finding. `othdb-select.js` has two transports:

- **Transport A** — `MYTHOS_SELECTOR_SCRIPT`, an external command on stdin/stdout. Used by the offline suite.
- **Transport B** — the advisory provider. **It is a stub.**

```js
function runProviderTransport(agentId) {
  resolveAdvisoryAgent(agentId);
  ...
  throw fail('SELECTOR_UNAVAILABLE', 'advisory provider transport is not wired in this version; use MYTHOS_SELECTOR_SCRIPT');
}
```

Proven, not read: invoked with **both** credentials set and the gateway reachable, it still throws.

```
THREW  code= SELECTOR_UNAVAILABLE
       msg = advisory provider transport is not wired in this version; use MYTHOS_SELECTOR_SCRIPT
```

So there is today **no path from the selector to a real model that does not require new code.** Transport A could reach one, but it bypasses `resolveAdvisoryAgent()` entirely — the agent-registry gate that refuses execution-authority providers lives only on Transport B. Attaching a model through Transport A would therefore have satisfied "run a real model" while **bypassing the provider registry**, which this mission forbids. It was not done.

## 6. Blocker 2 — budget is deny-by-default, and Extraction has no budget integration

`config/budgets.json` grants `mythos-prod` `daily_limit: 0`, `request_limit: 0`, `mission_limit: 0`, with the note: *"Raising any of these is an owner decision recorded in Git."*

Asked of the code, not the file:

```
mythos-prod    -> deny   project "mythos-prod" has no configured spending budget (limit 0 USD)
budget-sandbox -> allow  reserved 0.01 USD; remaining 9.99
```

The `omniroute-advisory` agent is `cost.tier: metered`. A real selection is therefore paid work under a project whose budget is zero.

Worse, and independently: **the extraction path contains no budget call at all.** `othdb-select.js`, `othdb-extract.js` and `conversation.js` reference no budget module; the only `reserve()` callers are `mythos-ai-executor/server.js`, `service/governance-verify.js`, `core/self-improve.js` and `core/domain.js`. Extraction does not route through any of them. So a real model call from Extraction today would spend **outside the ledger entirely** — not by defeating the control, but by never meeting it.

No budget grant was created. Raising a limit is an owner decision recorded in Git, and this mission's mandate was to use the existing mechanism, not to widen it.

**Ledger hygiene:** the `budget-sandbox` probe above created a 0.01 USD reservation in the designated sandbox namespace. It was released in the same execution; the sandbox is back to `reserved: 0, spent: 0, remaining: 10`. No real spend occurred anywhere at any point.

## 7. Blocker 3 — the five conversations are not available, and never had recorded identifiers

Mission §4 requires the same five conversations, verified against the recorded baseline. Neither half is satisfiable.

**The archive is not on this host.** Searched exhaustively: `find / -name "oth.db"` returns nothing; no `.db`/`.sqlite` file anywhere on the host contains a conversation archive; `/home/deploy/backups` and `/root/backups` hold only IDauto, darhijama, Coolify and Postgres material. The prior execution read the five "from a verified backup" — that backup lives off this host, consistent with the standing rule that `oth.db` is never moved to the VPS. **Nothing was moved, copied or fetched to satisfy this mission.**

**The baseline recorded no identifiers.** The prior worklog §21 explicitly withheld "any conversation content, personal name, contact detail or database record", and recorded the one extracted statement as `CONTENT_OMITTED_FOR_PRIVACY`. Its §12 records only aggregates:

```
5 conversations → 1 claim, 1 evidence, 0 facts, store verify() clean
idempotent re-run added nothing (682 records before and after)
```

So the mission's check "their identifiers match the previous report" is **unverifiable in principle**, not merely unmet — the identifiers were deliberately never written down. That was the right privacy call and it is not a defect; it does mean re-identifying the same five requires the owner, working from the archive itself. **No conversation was substituted.** The discrepancy is recorded here instead, exactly as §4 requires.

**And ingestion may not be authorized at all.** The prior record §23 lists under *Requires an owner decision first*: **"whether archive content may be ingested into the knowledge store at all."** That decision is still open. Running real archive content through a model would have pre-empted it.

## 8. What was measured, and what was not

**Not measured — and therefore not reported.** No quality number appears in this record, because no real AI output exists to score. Fabricating precision, unsupported-rate, duplicate-rate or attribution-accuracy from the deterministic reference run would be exactly the "fake quality" this mission forbids, and would also misrepresent a deterministic selector as a model. The comparison in §8 of the mission brief is deferred whole.

```
CLAIMS CORRECT / INCORRECT / UNSUPPORTED / DUPLICATE / MISATTRIBUTED   NOT MEASURED
PRECISION · UNSUPPORTED RATE · DUPLICATE RATE                          NOT MEASURED
ATTRIBUTION ACCURACY · EVIDENCE COVERAGE                               NOT MEASURED
```

**Measured — the safety envelope, which does not need a model.** Every guarantee the mission asked to preserve was re-verified against the existing suites, at full strength. No test was skipped, relaxed or edited.

| Suite | Result |
|---|---|
| `othk-0-knowledge-core` | 89 passed, 0 failed |
| `othk-1-search` | 30 passed, 0 failed |
| `othk-2-importers` | 97 passed, 0 failed |
| `othk-2w-executor-wiring` | 42 passed, 0 failed |
| `othk-3-trust` | 63 passed, 0 failed |
| `othk-4-conversation-extraction` | **90 passed, 0 failed** |
| `othk-5-http-facade` | 44 passed, 0 failed |
| `othk-6-mcp-server` | 36 passed, 0 failed |
| `mythos-budget-ledger` | 121 passed, 0 failed |
| `mythos-governance-invariant` | 99 passed, 0 failed |
| `mythos-ai-executor` | 264 passed, 0 failed |
| **Total** | **975 passed, 0 failed** |

Failure and boundary tests the mission named (§10), all green inside `othk-4`:

| Required test | Assertion |
|---|---|
| malformed provider output | H7 non-JSON · H8 two fenced blocks · H9 unfenced · H10 oversized · H13 >20 statements |
| unavailable provider | H14 timeout fails closed · H15 transport failure fails closed · **H18 no credential ⇒ `SELECTOR_UNAVAILABLE`, no fallback** |
| secret-like content | G1 refused at the gate · G2 nothing persisted · G3 the secret value never stored · H16 secret output refused · **H17 secret input refused BEFORE any transport call** |
| invalid source | E. importer refusals — never silent |
| unauthorized provider | **H2 execution-authority agent REFUSED, not merely avoided** · H3 unknown agent fails closed |
| fact creation attempt | **F2a–F2h: zero `fact` records, asserted eight times across every path** |
| duplicate extraction | D1 detected · D2 linked, never merged · D3 nothing deleted |
| attribution errors | H11/H12 unaccepted field REFUSED — the model may not name `confidence`, `asserted_by`, `source_class` or any record field |

**Idempotency (§9), including the ordering promise.** Verified in code and by assertion: `othdb-extract.js` calls `conversationImporter.alreadyExtracted()` at line 158 and `selector.selectStatements()` at line 171 — **the marker check precedes the model invocation**, so a re-run costs nothing. Asserted by C1 (skipped), C2 (no claims), C3 (record count unchanged), C4 (*"alreadyExtracted() finds the marker before any work is done"*), C6 (deterministic ids across independent stores).

## 9. Boundaries honoured

- Full archive **not processed**. All 1,299 conversations untouched; no batch expanded.
- Extraction **not rebuilt**; no second engine, no redesigned prompt. The prompt was not touched — there is no real baseline yet to redesign against.
- `claude-code` **not used** as an advisory provider; refusal proven, not assumed.
- Budget **not bypassed** and **not raised**; the one sandbox reservation was released.
- Provider registry **not bypassed** — which is precisely why Transport A was not used to smuggle a model in.
- `oth.db` **not moved, copied or fetched**. No conversation content was read at any point in this execution.
- No credential printed, logged, or committed. No `.env`, raw transcript, export or personal data in this record.
- No production data created or modified. No service touched.

## 10. Files changed

| Path | Change |
|---|---|
| `docs/worklogs/2026-08-30-2358-real-ai-extraction-validation.md` | this record |
| `docs/MYTHOS_SYSTEM_INDEX.md` | Extraction status reconciled with verified facts |

**No code was changed.** Extraction, the selector, the importer, the registry, the budget config and every test are byte-identical to `c38ef92`.

## 11. Rollback point

`c38ef92` on `vps/mcp-deployment-20260830`, tree clean. This execution added documentation only; reverting the commit restores the prior state completely. No service was restarted, no configuration written, no database read or written, no history rewritten, no force-push.

## 12. Unresolved items

1. **Owner authorization** for ingesting archive content into the knowledge store — still open, carried forward from the prior record §23.
2. **Advisory transport** (`runProviderTransport`) is a stub; wiring it should reuse `providers/openai-compat.js` rather than adding a second HTTP client.
3. **Budget integration for Extraction** does not exist. It should reserve/settle before any paid selection, so cost is metered rather than merely permitted.
4. **Credential visibility**: the advisory key is under `ubuntu`; the executor runs as `deploy`. An owner decision, not a fix to apply silently.
5. **`mythos-prod` budget is 0** in all three scopes; a real pilot needs an explicit owner grant recorded in Git.
6. **The five conversations cannot be re-identified** from any committed record. Re-establishing the baseline requires the owner and the off-host archive.

## 13. Next action

The blockers are ordered, and the first three are cheap:

1. Owner decides whether archive content may be ingested at all. **Everything else is moot until this is answered.**
2. Owner grants an explicit, small budget for `mythos-prod` (or a dedicated extraction project), recorded in Git.
3. Wire `runProviderTransport` to `providers/openai-compat.js`, and add a budget reserve/settle around the selection. Both are small, and both are prerequisites for a *governed* real run rather than merely a working one.
4. Owner re-identifies the five conversations from the off-host archive and records their identifiers privately, so a baseline exists that a future execution can match.
5. Then, and only then, run the five and measure quality.
