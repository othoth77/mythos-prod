# Mythos — Free LLM Resources

**Stage:** FREE-LLM-0 (discovery/health/selection/fallback, PR #290) + FREE-LLM-1 (activation, this stage)
**Status:** Implemented AND scheduled — `mythos-free-llm-sync.timer` (daily) and `mythos-free-llm-health.timer` (every 30 min) are enabled and running on the VPS as the `deploy` user (see §10). No credential exists for any provider yet; the sync/health mechanism itself is fully live.
**Date:** 2026-09-14 (FREE-LLM-0), 2026-09-15 (FREE-LLM-1 activation)
**Source list:** [`raullenchai/free-llm-api-resources`](https://github.com/raullenchai/free-llm-api-resources) (a fork of `cheahjs/free-llm-api-resources`, which currently 404s under its original owner) — an auto-generated README of free/free-tier/trial LLM API providers.

---

## 1. What this is, in one paragraph

Othmode/Mythos already had a provider/adapter framework for external LLMs (`projects/mythos-ai-executor/providers/*.js`, `core/agent-registry.js`, `core/provider-router.js`, `lib/quota.js`) — built for exactly one paid advisory endpoint (OmniRoute) plus one architecturally-registered-but-unconfigured Gemini adapter. This stage adds a **catalog of free-tier LLM services**, discovered from the community-maintained resource list above, kept live with **health checks**, and made **selectable and fallback-capable** through the *existing* framework rather than a parallel one. The only new registered agent is a single meta-agent, `free-llm-pool`, so every existing selection/fallback/quota-classification/reputation mechanism in the executor applies to it unchanged.

## 2. Search First → Reuse → Adapt → Connect → Build Last

What was reused as-is (zero duplication):

| Existing piece | Reused for |
|---|---|
| `lib/quota.js` `classifyOutcome()` | Turning a provider's raw error text into quota / transient / blocked / permanent — the same categories every other provider in this executor uses. |
| `core/reputation.js` `recordOutcome()`/`stats()` | Per-provider historical success rate, evidence-gated (`MIN_EVIDENCE=5`), used as a selection tiebreak — keyed `free-llm:<provider-id>`. |
| `core/agent-registry.js` cost-tier ranking (`COST_RANK`) | `free` already ranks ahead of `subscription`/`metered` — the new `free-llm-pool` agent inherits this for free at the outer selection layer. |
| `providers/*.js` adapter contract (`{available, version, run, executionAuthority:false}`) | The new `providers/free-llm-pool.js` implements exactly this contract — no new abstraction. |
| Secrets-by-env-file convention (`~/.config/mythos-ai-executor/<name>.env`) | Generalised (`free-llm/secrets.js`) to one file per free provider under a `free-llm/` subfolder, same format, same "absence = unconfigured, never invented" rule as `providers/gemini.js`. |
| `bridge/github-issues.js`'s fetch → normalize → idempotent-store shape | Mirrored by `free-llm/sync.js` (fetch README → parse → overlay official docs → diff → write `catalog.json`). |

What is genuinely new (nothing in the repo did this): the parser for the upstream README, the per-service/per-model catalog, the health-check probe, and the selector's internal A→B→C loop across many *free* candidates (finer-grained than the outer agent-level fallback, which chooses between different *agents*, not between 26 services inside one agent).

## 3. Data flow

```
raullenchai/free-llm-api-resources (README.md, upstream)
        │  bin/free-llm-sync.js  (fetch → parser.js → overlay official-overrides.json → diff)
        ▼
free-llm/catalog.json                      ← committed, versioned, like config/agents.json
        │
        │  free-llm/registry.js  (health probe via adapter.js, reuses lib/quota.js)
        ▼
$MYTHOS_EXECUTOR_HOME/free-llm/health.json  ← runtime state, never Git (core/store.js convention)
        │
        │  free-llm/selector.js  (rank candidates, try A → B → C, reuses core/reputation.js)
        ▼
providers/free-llm-pool.js  ("free-llm-pool" agent in config/agents.json)
        │
        ▼
core/agent-registry.js → core/provider-router.js → orchestrator (UNCHANGED)
```

## 4. Files

```
projects/mythos-ai-executor/
  free-llm/
    parser.js               pure function: README markdown -> {free:[...], trial:[...]}
    sync.js                  fetch + overlay + diff + write catalog.json
    official-overrides.json  curated, live-verified official docs/privacy/terms links (point 6)
    endpoints.json           live-verified OpenAI-compatible base_url per WIRED provider
    secrets.js               per-provider credential loader (~/.config/mythos-ai-executor/free-llm/<id>.env)
    adapter.js               generic OpenAI-compatible chat/completions call (transport-injectable)
    registry.js              catalog+health merge, statusFromOutcome(), checkProviderHealth/checkAllHealth, listEntries
    selector.js              selectCandidates() + complete() (the A -> B -> C fallback loop)
    catalog.json             committed snapshot (26 providers / 205 models at last sync)
    bin/
      free-llm-sync.js       CLI: refresh catalog.json, print the diff
      free-llm-health.js     CLI: probe one or every provider, print status
      free-llm-status.js     CLI: print (or --json) the full service/model registry
  providers/
    free-llm-pool.js         the one new registered agent adapter (delegates to selector.js)
  core/agent-registry.js     +1 defaultProbe() branch for provider === 'free-llm-pool'
  executor.js                +1 PROVIDERS map entry
  config/agents.json         +1 agent definition ("free-llm-pool")
tests/
  free-llm-parser-test.js
  free-llm-registry-test.js
  free-llm-selector-test.js
  free-llm-pool-provider-test.js
  fixtures/free-llm-api-resources-readme.md   (offline fixture, so parser tests never touch the network)
```

## 5. The service registry (point 3 of the brief)

`free-llm/registry.js`'s `listEntries()` returns one row per **{service, model}** pair with exactly the requested fields:

| Field | Source |
|---|---|
| service name | `catalog.json` (parsed from the README's `### [Name](homepage)` heading) |
| model | `catalog.json` model entry; `model_id`/`model_id_confidence` distinguish a catalog-*confirmed* API slug (`link_derived`/`literal_text`) from a display-only name (`unconfirmed`, never sent to a real API) |
| service type (modality) | heuristically tagged (`chat`/`speech-to-text`/`text-to-speech`/`embedding`/`moderation`/`vision`/`reranking`) — labelled non-authoritative in `parser.js` |
| free / free-tier / trial | `access_type` (`free_tier` for the README's "Free Providers" section, `trial` for "Providers with trial credits") |
| usage limits | `limits_text` (model-level if the source gave one, else the service-level line) |
| service status | `health.status` — `active`\|`degraded`\|`unavailable`\|`quota_exhausted`\|`expired`\|`invalid_credentials`\|`unconfigured`\|`unknown` |
| last check | `health.last_checked` |
| response speed | `health.latency_ms` (measured on the last probe/attempt) |
| service URL | `homepage` |
| requirements (signup/phone/etc.) | `requirements` (`signup` always; `phone_verification`, `data_training_opt_in`, `payment_method` detected from the source text) |
| data usage policy | `data_policy_note` (free-text, from the source) **overridden by** `official.privacy_url`/`official.terms_url` when a curated entry exists in `official-overrides.json` — point 6 of the brief: official docs outrank the community list |

`node projects/mythos-ai-executor/free-llm/bin/free-llm-status.js [--json] [--wired-only]` prints this table.

## 6. Status vocabulary and failure classification (points 5, 9)

`registry.statusFromOutcome()` classifies every call outcome using `lib/quota.js`'s existing `classifyOutcome()` — the exact same regex tables the executor already trusts for Claude/OmniRoute/every other provider:

- clean success → `active`
- `lib/quota.js` category `quota` (e.g. "usage limit reached") → `quota_exhausted`
- category `transient` (e.g. 503, rate-limit, network error) → `degraded`
- HTTP 401/403 → `invalid_credentials` (V2: the key was rejected — actionable "API key invalid", never confused with an outage; the selector never offers it)
- HTTP 404 → `expired` (the specific `:free` model slug most likely rotated out — the source README explicitly warns free models churn)
- category `permission`/`governance`/`human`/`permanent` (invalid key, billing, etc.) → `unavailable`

Two additional honest states exist for when no live attempt has even been made: `unconfigured` (not wired, or wired but no credential file yet) and `unknown` (wired and keyed, but either never probed or the catalog names no *confirmed* model id safe to call).

## 7. Selection and fallback (points 7, 8)

`selector.selectCandidates(requirements)`:

1. Filters `registry.listEntries()` to rows that are `wired`, have a **confirmed** `model_id` (never a guessed one), match the requested modality, have a credential configured, and are not `unavailable`/`unconfigured`/`expired`.
2. Collapses to **one candidate per provider** (never per model) — several providers explicitly share one quota across their whole model list, so retrying five sibling models is retrying the same exhausted bucket five times, not five independent attempts.
3. Ranks: health status (`active` > `degraded`/`unknown` > `quota_exhausted`) → historical success rate (`core/reputation.js`, only once `MIN_EVIDENCE` outcomes exist) → measured latency → deterministic id order.

`selector.complete(prompt, opts)` tries the ranked list **in order**, A → B → C, recording health + reputation after every attempt (success or failure), and **never rejects** — a total wipeout across every free candidate resolves `{ ok:false, reason:'ALL_CANDIDATES_FAILED', attempts:[...] }`. `providers/free-llm-pool.js` turns that into a normal `FAILED`-shaped outcome for the executor, which can then fall back to a *different agent* entirely through the pre-existing `core/provider-router.js` — one free provider's outage, or the whole pool's outage, never stops Othmode.

## 8. Secrets (point 10)

Never taken from the upstream list. One file per provider, exactly the `providers/gemini.js` discipline generalised:

```
~/.config/mythos-ai-executor/free-llm/<provider-id>.env
  MYTHOS_FREE_LLM_<PROVIDER_ID>_API_KEY=...
```

Absence is reported as `unconfigured`, never invented — this is true today for all 26 catalog providers; the owner must create a key file before any of them can be selected for a real call. `MYTHOS_FREE_LLM_KEY_DIR` overrides the directory (tests use this).

## 9. Extending — a new provider without redesign (point 12)

- **Catalog-only** (discoverable, health-checkable as `unconfigured`/`unknown`, shows in `bin/free-llm-status.js`): nothing to do — the next `bin/free-llm-sync.js` run picks it up automatically from the upstream README.
- **Wired for live calls**, if it speaks plain OpenAI-compatible `/chat/completions`: add one entry to `free-llm/endpoints.json` (`base_url`, `wired: true`, plus how you verified it) and create the owner's key file. No code change.
- **Wired, but a different request shape** (Cloudflare Workers AI's account-scoped path, Cohere's native v1, Google's native REST): write one small dedicated adapter file mirroring `providers/gemini.js` next to `providers/openai-compat.js` — the established pattern for a provider that doesn't fit the generic shape. `endpoints.json`/`adapter.js` are the seam; `registry.js`/`selector.js` never need to change.
- **Official docs entry**: add one entry to `official-overrides.json` (`docs_url`/`privacy_url`/`terms_url`) — always wins over whatever the community README says for that field.

## 10. Scheduling (FREE-LLM-1, 2026-09-15)

Both jobs are installed and enabled as `deploy` systemd **user** units — exactly the `mythos-github-bridge.service`/`.timer` convention (source under `free-llm/systemd/`, installed to `~/.config/systemd/user/`, `systemctl --user enable --now`):

- **`mythos-free-llm-sync.timer`** — `OnCalendar=*-*-* 04:15:00 UTC`, `RandomizedDelaySec=600`, `Persistent=true` (mirrors `mythos-backup.timer`'s daily pattern). Refreshes `catalog.json` in place in the live checkout once a day.
- **`mythos-free-llm-health.timer`** — `OnBootSec=5min`, `OnUnitActiveSec=30min` (mirrors `mythos-status-monitor.timer`'s repeat-interval pattern). Probes every wired+keyed provider once per tick — a zero-network no-op today, since no provider has a credential yet.

Both are `Type=oneshot`, driven by their timer, in a **separate process** from `mythos-ai-executor.service` — a sync/health failure (e.g. GitHub or a provider unreachable) exits non-zero and is visible via `systemctl --user status`, and never touches, restarts, or blocks the executor daemon. Install/rollback commands are in each `.service` file's header comment.

**Operational note:** the sync timer writes `catalog.json` directly into the live `/home/deploy/projects/mythos-prod` checkout — it does not commit or push. This mirrors the repo's existing "the live checkout may run slightly ahead of the last commit" pattern (see `docs/AI_HANDOVER.md`'s dirty-tree entries); an operator/session periodically commits the accumulated drift, same as the Status Center's `repo-snapshot.json` refresh.

## 11. What this stage deliberately does NOT do

- **No credential exists.** Every one of the 26 catalog providers reports `unconfigured` on this host today. This is correct, not a bug — nothing invents a key. §12 names the exact file to create for Groq.
- **Cloudflare Workers AI, Cohere's native API, Google AI Studio's native REST, and every "trial credit" provider except the nine listed in `endpoints.json`** are catalog-only today (§9 explains exactly how to wire one in).
- **No change to `providers/openai-compat.js`, `core/provider-router.js`, `lib/quota.js`, or any pre-existing agent's behaviour.** `tests/free-llm-pool-provider-test.js` asserts the three pre-existing agents are untouched, and the full `mythos-ai-executor-test.js` (390/0) and `mythos-governance-invariant-test.js` (111/0, run as `deploy`) suites were re-verified green after every edit in both stages.

## 12. Activating a provider — Groq, as the worked example

1. Create `~/.config/mythos-ai-executor/free-llm/groq.env` (mode 0600) containing exactly:
   ```
   MYTHOS_FREE_LLM_GROQ_API_KEY=<the real key>
   ```
   The directory (`~/.config/mythos-ai-executor/free-llm/`, mode 0700) already exists on the VPS, empty, ready for this file.
2. Nothing else changes — `endpoints.json` already wires Groq (`https://api.groq.com/openai/v1`, live-verified), and the catalog already carries a confirmed chat model (`groq/compound`). The next health-check tick (≤30 min) or `node bin/free-llm-health.js groq` picks the key up automatically.
3. Verify: `node bin/free-llm-status.js --json | node -e "process.stdin.pipe(require('fs').createWriteStream('/dev/stdout'))"` or simply re-run `bin/free-llm-health.js groq` and check `status: "active"`.

The same three steps apply to any of the other 8 already-wired providers (openrouter, cerebras, mistral-la-plateforme, nvidia-nim, huggingface-inference-providers, fireworks, sambanova-cloud, cohere) — only the filename changes.

## 13. Tests

```
node tests/free-llm-parser-test.js           # 30/0 — offline, fixed README fixture (incl. "a docs deep link is never a model slug")
node tests/free-llm-registry-test.js         # 28/0 — health state machine + the reliability matrix: timeout, 401 invalid key, 403, 500, garbage body, recovery
node tests/free-llm-selector-test.js         # 9/0  — quota -> transient -> success fallback, offline
node tests/free-llm-pool-provider-test.js    # 12/0 — agent-registry/executor.js wiring, offline
node tests/free-llm-groq-activation-test.js  # 11/0 — the real catalog/endpoints, Groq selected first, Groq quota -> fallback to the next provider
node tests/mythos-ai-executor-test.js        # 392/0 — includes /route: the pool is routable for advisory read-only work, never for repo-write
node tests/othmode-2-platform-test.js        # 172/0 — OTHMODE's providers read model folds the pool in (presence-only, no paths, no values)
```

The executor suite pins `MYTHOS_FREE_LLM_KEY_DIR` to an empty fixture directory (OTHMODE V1, 2026-09-16): without that, a host that holds a real free-provider key makes `free-llm-pool` available, it ranks first for advisory work (free tier), and the suite's `/route` assertions silently change meaning — which is exactly what happened on the VPS the moment the Groq key was placed (390/0 → 387/3). The same class of fix as `MYTHOS_ADVISORY_KEY_FILE` there.

All five isolate `MYTHOS_EXECUTOR_HOME` (core/reputation.js's store) and `MYTHOS_FREE_LLM_KEY_DIR` to a per-run temp directory under the home directory — never `/tmp`, never the real `~/mythos-ai-executor/orchestration/` or `~/.config/mythos-ai-executor/free-llm/` paths. The first three tests originally did NOT isolate `MYTHOS_EXECUTOR_HOME` and were found, live on this VPS during FREE-LLM-1 activation, to have written fake `free-llm:*` evidence into the real production reputation store; this was corrected and the contaminated file was retired (renamed aside, not deleted) rather than silently left in place.

No test makes a real network call; every HTTP interaction is injected (`opts.transport`), the same discipline `providers/openai-compat.js` and `personal-intelligence/runtime/openrouter-provider.js` already use.
