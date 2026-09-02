# Report gh-issue-100 — COMPLETED

| Field | Value |
|---|---|
| Completed | 2026-09-02T23:19:52.135Z |
| Executor task | `t-20260902225354-12dm0a` |
| OTHMODE task | `OTH-2026-00028` |
| Profile | repo-write |
| Branch | `mythos/gh/gh-issue-100` |
| Commits on origin | true |
| Git verified | true |

## Summary

Implemented the Claude model selection policy for Issue #100. New lib/model-policy.js + config/model-policy.json are the single decision point: an explicitly named model (Haiku/Sonnet/Opus/Fable 5, incl. aliases and full ids) is honoured exactly and never substituted; an absent model is scored from execution profile, task category, priority, instruction length, complexity/simplicity terms and constraint/test counts onto haiku (score<=1), opus (>=7) or sonnet; fable is auto_selectable:false everywhere and the three auto tiers are validated to name auto-selectable entries only. executor.createTask now resolves and persists model, model_selection_mode and model_selection_reason for every claude-code task (advisory providers keep their own model namespace untouched) and events model_selected with all signals; providers/claude-code.js now ALWAYS emits --model, so the CLI's ambient fable default can no longer run by omission. The intake path was extended end to end: `Model:`/`النموذج:` section and `model:<x>` label on an Issue, optional `model` on a control task, validated at the bridge where the creator can read the error, carried into executor.createTask, the report JSON/markdown and the OTHMODE evidence. Security shape kept: a task can only select a catalog key, never supply a string; every catalog id is re-validated as a bare token so nothing reaching argv can carry whitespace or look like a CLI flag; fallback_model passes the same allow-list; an invalid config falls back to a built-in policy rather than going dark (no policy would mean no --model). One deviation, flagged for the owner: `Model: Fable 5.1` is REFUSED by name because the installed Claude CLI 2.1.251 has no claude-fable-5-1 (its model catalog offers claude-fable-5 only) and substituting Fable 5 would break the never-substitute rule; the catalog carries fable-5.1 as enabled:false with that reason, so enabling it later is a config flip, no code change. Resource Guard was not touched (no conflict arose). Committed on mythos/gh/gh-issue-100 as 11fdcfc; not pushed and not merged — the governance relay has not yet delivered the branch, so origin still shows the base commit.

## Commits

- `11fdcfc05d5e3cbc6713ce274a589f1df5f871ec` feat(executor): explicit-or-scored Claude model selection, fable only on request (on origin)

## Files changed

- `projects/mythos-ai-executor/lib/model-policy.js`
- `projects/mythos-ai-executor/config/model-policy.json`
- `tests/model-selection-policy-test.js`
- `projects/mythos-ai-executor/executor.js`
- `projects/mythos-ai-executor/providers/claude-code.js`
- `projects/mythos-ai-executor/schemas/task.schema.json`
- `projects/mythos-ai-executor/bridge/github-bridge.js`
- `projects/mythos-ai-executor/bridge/github-issues.js`
- `projects/mythos-ai-executor/bridge/schemas/task.schema.json`
- `projects/mythos-ai-executor/bridge/README.md`
- `docs/MYTHOS_GITHUB_BRIDGE.md`
- `docs/MYTHOS_GITHUB_ISSUES.md`
- `docs/AI_HANDOVER.md`

## Tests

- node tests/model-selection-policy-test.js (new): 75 passed, 0 failed
- node tests/mythos-ai-executor-test.js: 265 passed, 0 failed
- node tests/mythos-github-bridge-test.js: 97 passed, 0 failed
- node tests/mythos-github-issues-test.js: 100 passed, 2 failed inside the executor service environment (both token-guard assertions, because MYTHOS_GITHUB_MCP_RW_TOKEN is exported there); re-run with that variable removed: 102 passed, 0 failed — pre-existing environment artefact, unrelated to this change
- node tests/mythos-core-wiring-test.js: 86 passed, 0 failed
- node tests/mythos-orchestration-core-test.js: 257 passed, 0 failed
- node tests/mythos-orchestrator-0-test.js: 156 passed, 0 failed
- node tests/mythos-n8n-bridge-test.js: 80 passed, 0 failed
- node tests/othk-2w-executor-wiring-test.js: 42 passed, 0 failed
- node tests/othmode-3-tasks-test.js: 94 passed, 0 failed
- node --check on all 6 changed/new JS files: OK; JSON.parse on all 3 changed/new schema+config files: OK
- node tests/core-test.js: FAILS AT LOAD with the known pre-existing '_memCache is not defined' (browser-app core, untouched by this change)
- node tests/mos-e2e-lifecycle-test.js: refuses to run on a host carrying the real mythos-prod checkout, by its own design — not executed

## Validation

- required checks: none
- remote head: 11fdcfc05d5e3cbc6713ce274a589f1df5f871ec
- report problems: none

## Problems

- none

## Risks

- Fable 5.1 cannot run on this host at all (the installed CLI has no such model id); the policy refuses it loudly instead of substituting Fable 5 — owner decision to flip enabled:true in config/model-policy.json once a CLI that accepts claude-fable-5-1 is installed
- The auto tier boundaries (fast<=1, deep>=7) and the term lists are judgement calls tuned against the bridge's own instruction template; a test pins that the template contributes no term hits, but real-world tasks may still deserve tuning — both live in config, no code change needed
- Model ids are pinned to the installed CLI 2.1.251 catalog (claude-haiku-4-5 / claude-sonnet-5 / claude-opus-5 / claude-fable-5); a CLI upgrade that retires an id would need a config update, and would surface as a failing run rather than a silent downgrade
- The model value now flows from an Issue body into the task record; it is constrained to catalog keys and bare-token ids, but it is one more creator-settable field on the control protocol
- A line reading exactly 'Model: <something unrecognised>' anywhere in an Issue body now rejects that Issue at intake (same trade-off the existing Action/Priority scalar keys already accept); the rejection comment names the accepted values
- The commit is local to the branch: origin/mythos/gh/gh-issue-100 was still at the base commit ~5 minutes after commit, so delivery by the governance relay is pending and unverified

## Next recommended action

Let the governance relay deliver mythos/gh/gh-issue-100 (11fdcfc) and verify origin shows it; then owner decides (a) whether to merge the branch to main and (b) whether to enable the fable-5.1 catalog entry once a Claude CLI accepting claude-fable-5-1 is installed. After the merge, the next GitHub task will show its chosen model and the reason in the created comment and the REPORT.
