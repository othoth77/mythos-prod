# Worklog — Extraction wired to DeepSeek V4 Pro through the existing advisory provider

**Date:** 2026-08-31 · **Time:** 00:05 – 00:20 UTC
**Task:** wire the existing Extraction MVP to the already-configured DeepSeek V4 Pro via OpenRouter/OmniRoute, with `reserve → AI call → settle` budget protection. Tests only; the five conversations were **not** run and the archive was **not** touched.

## What was reused, not created

No new provider, no second HTTP client, no new credential path, no change to any existing DeepSeek configuration.

| Reused as-is | Role in the wiring |
|---|---|
| `projects/mythos-ai-executor/providers/openai-compat.js` | the advisory adapter — owns endpoint, key file, timeout, response shape; `executionAuthority: false` permanently |
| `projects/mythos-ai-executor/core/budget.js` | `reserve` / `settle` / `release` |
| `config/agents.json` → `omniroute-advisory` | the registry entry the selector already resolved |
| `resolveAdvisoryAgent()` | guarantee 1 (execution authority refused), unchanged |
| OmniRoute `127.0.0.1:20128/v1` | untouched |
| `~/.codex/omni*.config.toml`, `codex-omni` | **untouched — not used as a path** |

## Files changed (3 + 1 new)

**`scripts/othdb-select.js`** — `runProviderTransport()` was a stub that threw unconditionally. It now calls the existing adapter, wrapped in budget:

```
reserve  →  AI call  →  settle     the call completed and billed
reserve  →  AI call  →  release    the call never billed
```

The synchronous `selectStatements()` keeps its exact contract and **never spends**: it serves `MYTHOS_SELECTOR_SCRIPT` only and refuses the provider by name. An HTTP call cannot be synchronous, and returning a Promise there would have turned a throwing contract into a resolving one — a caller's `try/catch` would silently stop seeing refusals. The governed path is the new `selectStatementsAsync()`. Every gate is shared between the two by construction (`prepareSelection` / `finishSelection`), so a guarantee cannot apply to one and not the other.

This also makes `othk-4` H18 host-independent: it previously depended on whether the current account could read a credential.

**`projects/mythos-ai-executor/providers/openai-compat.js`** — one optional `opts.systemPrompt`, default unchanged and asserted unchanged (`othk-7` J3). Necessary: the executor's default framing asks the model to end with a `mythos_report` fenced block, while the selector contract is *exactly one* fenced block. Two conflicting instructions would have made the reply non-deterministic and refused at random. Every existing caller passes nothing and keeps the old string.

**`scripts/othdb-extract.js`** — `main()` is now async and awaits `selectStatementsAsync`. The reservation id is derived from the conversation id, so retrying one conversation reuses one reservation and can never be billed twice — the same stability rule the extraction marker already follows. New report totals: `advisory_calls_settled`, `spend_settled_usd`, `budget_denied`.

**`tests/othk-7-advisory-transport-test.js`** — new, 41 assertions, injected provider and injected budget. No network, no real money reachable.

## Model

`openrouter/deepseek/deepseek-v4-pro` — the same id already reachable through OmniRoute (the `oth-coding` alias). Named as a constant in the selector rather than read from any other tool's configuration, so nothing else has to change and nothing else breaks if it moves. Overridable via `MYTHOS_SELECTOR_MODEL`.

## Fail-closed behaviour proven

| Branch | Result |
|---|---|
| budget denies | typed refusal, **provider never called**, no reservation created |
| cost estimate missing or negative | refused before any network activity — an unknown cost is never zero |
| reservation id missing or unsafe | refused |
| provider call fails / adapter throws | **released**, never left dangling, never settled |
| call completed but output malformed | **settled** — the money left before the text could be judged — then refused |
| secret-shaped input | refused before any transport call; budget never even asked |
| secret-shaped output | refused; the call still billed, so it is still settled |
| `agent: claude-code` | `SELECTOR_REFUSED` on the async path too |
| model names `confidence` | `SELECTOR_REFUSED` — it still cannot widen its own trust |

## Live preflight — real modules, no fake, no spend

Run as the account that can read the advisory credential, with the real budget module and the real adapter:

```
code = SELECTOR_BUDGET_DENIED
msg  = budget refused this selection for project "mythos-prod":
       project "mythos-prod" has no configured spending budget (limit 0 USD)
```

Ledgers after: `mythos-prod {limit 0, reserved 0, spent 0, entries 0}` · `budget-sandbox {limit 10, reserved 0, spent 0}`. **No reservation leaked, no call made, nothing spent.**

## Tests

```
othk-0  89 · othk-1  30 · othk-2  97 · othk-2w 42 · othk-3  63 · othk-4  90
othk-5  44 · othk-6  36 · othk-7  41 (new)
budget-ledger 121 · governance-invariant 99 · ai-executor 264
core-wiring 86 · compression-pipeline 16 · unattended-policy 53
──────────────────────────────────────────────────────────────
TOTAL 1171 passed, 0 failed, 0 regressions
```

No test was skipped, relaxed or edited to make this green.

## Still missing — the one thing that blocks a real call

**An explicit budget grant for `mythos-prod` (or a dedicated extraction project), recorded in Git.** `config/budgets.json` states the rule itself: *"Raising any of these is an owner decision recorded in Git."* It was not raised here.

`budget-sandbox` was deliberately not used: its own note says the only tools reachable under it are mock/sandbox tools and no real payment method is ever attached, so billing a real DeepSeek call to it would misuse the namespace and make the ledger lie.

Two smaller items the owner should decide with it:

1. **Cost per selection.** The wiring refuses to guess. A grant should come with a per-request estimate (`MYTHOS_SELECTOR_COST_ESTIMATE_USD`), because the gateway returns token usage but no price, so `settle` currently settles at the reserved estimate.
2. **Account.** The advisory credential is under `ubuntu`; the adapter resolves its key file from `$HOME`. Extraction must run as an account that can read it.

## Not done, deliberately

Five conversations not run · archive not processed · no Gemini · `codex-omni` not used as a path · no production service touched · no existing DeepSeek configuration changed.
