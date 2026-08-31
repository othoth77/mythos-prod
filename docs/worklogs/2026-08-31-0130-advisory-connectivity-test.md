# Worklog — First real advisory connectivity test (FAILED — gateway egress down)

**Date:** 2026-08-31 · **Time:** 01:20 – 01:30 UTC
**Owner grant:** $0.10 · **Account:** `ubuntu` · **Scope:** exactly one connectivity call. The five conversations were **not** run; the archive was **not** touched.

## Result

```
CONNECTION:            FAILED — the request never reached OpenRouter
reserve → call → settle: EXECUTED in order (proven by ledger timestamps)
ACTUAL COST:           $0.00 — no tokens were consumed
LEDGER RECORDS:        $0.01 spent   ← over-recorded, see the defect below
DANGLING RESERVATION:  none
BUDGET USED:           $0.01 of $0.10 recorded; $0.00 real
```

**A financial condition failed, so execution stopped here as instructed. No retry was run.**

## Budget grant recorded

Added as a **separate** project rather than raising `mythos-prod`, which stays at zero: the grant authorises extraction selection and nothing else, and revoking it is one edit that cannot affect any other spend. All three scopes mirror the granted cap exactly; no sub-limit was invented.

```json
"oth-extraction": { "daily_limit": 0.10, "request_limit": 0.10, "mission_limit": 0.10 }
```

## What happened

The governed path ran end to end. The gateway accepted the request and routed it, but its egress proxy was down, so nothing reached the model.

Ledger entry `connectivity-test-20260831-01`:

```
reserved_at  2026-08-31T01:22:53.221Z
settled_at   2026-08-31T01:23:06.315Z     (13.1 s later)
status       SETTLED   amount 0.01   settled_amount 0.01
provider     openai-compat      agent  omniroute-advisory
```

OmniRoute log for the same request:

```
01:22:53.290  POST /v1/chat/completions | openrouter/deepseek/deepseek-v4-pro | 2 msgs
01:22:53.318  ROUTING  Provider: openrouter, Model: deepseek/deepseek-v4-pro
01:22:53.327  AUTH     Using openrouter account: dc1b3d72…
              [ProxyFetch] Undici dispatcher failed … ECONNREFUSED 127.0.0.1:20132
              [ProxyFetch] native fetch fallback ALSO failed … ECONNREFUSED 127.0.0.1:20132
```

**No `[USAGE]` line and no `[STREAM] … complete` line was emitted for this request.** The last successful upstream completion in the log is `01:07:43`, from an unrelated Codex session. Port `20132` is not listening. The model was never invoked, so OpenRouter billed nothing.

## Verified

| Check | Result |
|---|---|
| Model requested | `openrouter/deepseek/deepseek-v4-pro` — confirmed in the gateway's own routing line |
| Framing | `2 msgs` = the selector system prompt + one user prompt. The executor's `mythos_report` framing was correctly **not** used |
| Order | reserve (01:22:53.221) → call (01:22:53.290) → settle (01:23:06.315). Never out of order, never skipped |
| Reservation id | stable, single, reused by both reserve and settle |
| Dangling reservations | **none** — no `RESERVED` entry in any ledger, either account |
| Cap respected | $0.01 recorded against a $0.10 grant; `mythos-prod` still 0/0 |
| Codex / OpenRouter config | untouched |

## Defect found — settle is too trusting

`runProviderTransport()` settles when `exit_code === 0 && !parsed.is_error`, which only proves the gateway answered with a status below 400. It does **not** prove a completion happened. Here the gateway returned a non-error response carrying no completion, so the wiring settled $0.01 for a call that consumed nothing, and the selector then correctly refused the empty text.

The error direction is conservative — it over-records spend and therefore cannot cause an overspend — but it makes the ledger inaccurate, which is its own failure.

**Fix (NOT applied; execution stopped as instructed):** settle only on positive evidence of a completion — `usage` present, or non-empty `choices[0].message.content` — and `release` otherwise. That converts this exact case from a phantom $0.01 into a clean release. It needs one new branch and two assertions in `othk-7`.

## Second finding — the ledger is per-account

`core/budget.js` resolves its ledger under `store.root()`, which is `os.homedir()`-based:

```
deploy → /home/deploy/mythos-ai-executor/orchestration/budgets
ubuntu → /home/ubuntu/mythos-ai-executor/orchestration/budgets
```

The $0.10 cap is therefore enforced **per account**, not globally. Running extraction as `ubuntu` and again as `deploy` would give each its own fresh $0.10. This did not affect this test — one call, one account — but it must be settled before any larger pilot. It also explains why the ledger read empty from `deploy` immediately after the `ubuntu` run.

## Not done

Five conversations not run · archive not processed · no retry · no second paid call · Codex and OpenRouter configuration untouched · no production service changed.

## Next action (owner decision)

1. Bring the OmniRoute egress proxy on `127.0.0.1:20132` back up — this is why the test failed, and nothing else can be judged until it is up.
2. Approve the settle-evidence fix above.
3. Decide the per-account ledger question before any larger pilot.
4. Then repeat this same one-call test; $0.09 of the grant remains.
