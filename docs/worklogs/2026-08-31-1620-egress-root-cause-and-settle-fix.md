# Worklog — Egress root cause found; settle fixed; paid test NOT re-run

**Date:** 2026-08-31 · **Time:** 16:10 – 16:25 UTC
**Scope:** diagnose the egress failure, fix `settle`, re-run the one paid test.
**Outcome:** the settle defect is fixed and tested. **The paid test was not re-run**, because the egress fault requires an owner action I am not authorised to take, and re-running would have failed again and spent another cent.

## 1. Root cause of the egress failure — found, precise, and NOT a stopped service

`127.0.0.1:20132` is OmniRoute's **inspector MITM proxy**. It did not stop. It has never run here, deliberately:

> **OPERATIONS.md §9 — Invariants, do not change without approval**
> *"MITM/TLS interception off: `INSPECTOR_TLS_INTERCEPT`, `MITM_ROOT_CA_ENABLED`, `MITM_DISABLE_TLS_VERIFY`, `INSPECTOR_HTTP_PROXY_AUTOSTART` all disabled."*

Confirmed in the running container: `INSPECTOR_HTTP_PROXY_AUTOSTART=false`; only `20128` (API) and `20131` are listening inside it; `20132` is absent by design. **Starting it would breach a documented, approval-gated security invariant and switch on MITM interception. It was not started.**

The actual fault is a **contradiction between one account flag and that invariant**:

```
provider_connections
  id           dc1b3d72-…            provider  openrouter
  name         openrouter-primary    is_active 1
  proxy_enabled            = 1       ← the fault
  per_key_proxy_enabled    = 0
  updated_at   2026-08-29T07:33:24.586Z
```

With `proxy_enabled = 1`, that account's egress is routed through the inspector proxy — which the deployment guarantees will never be running. The account says "use the proxy"; the deployment says "the proxy never starts".

**Timeline.** `.env` and `compose.yaml` are unchanged since 2026-08-12, so the invariant was never touched. `data/storage.sqlite` was modified on 2026-08-28, leaving backups named `…bak-benchmark-20260828-195517` and `…bak-option1-20260828-203744`; the flag's own `updated_at` is 2026-08-29T07:33. The first `[ProxyFetch] … ECONNREFUSED 127.0.0.1:20132` in the container log is 2026-08-28T18:51. Non-streaming completions succeeded before that (last clean `[USAGE]` on 2026-08-16) and none has succeeded since. **A benchmark session left this flag on.**

Streaming still works — Codex's `/v1/responses` calls completed normally at 01:07 today — which is why the fault stayed invisible: only the non-streaming `chat/completions` path, which the extraction adapter uses, goes through ProxyFetch.

## 2. Why I did not fix it myself

The fix is one field: `proxy_enabled → 0` on that account. The system's own mechanism for it is the OmniRoute management surface, which requires a **management token** (a dashboard session). The internal-services API key is refused: `403 AUTH_001 Invalid management token`. I did not hunt for the dashboard credential and did not forge a session.

The only other route would be writing directly into the owner's live gateway database — outside the intended interface, on a service actively serving Codex, and squarely inside "do not change OmniRoute". **Not done.** The database was inspected on a temporary copy, which has been deleted; the original is untouched (`mtime 13:48`, unchanged).

**Owner action required:** in the OmniRoute dashboard, open the `openrouter-primary` connection and turn its proxy setting **off**. Nothing else needs to change. Since the proxy does not exist, disabling it cannot break anything — direct egress is already the path that works for streaming today.

## 3. Settle fixed — a status below 400 is not a completion

Yesterday's phantom charge is fixed at the cause. `settle` previously fired on `exit_code === 0`, which only proves the gateway answered below 400. It now requires **positive evidence** that tokens were consumed:

```
usage tokens > 0   OR   non-empty returned text     → settle
neither                                             → release + SELECTOR_NO_COMPLETION
```

So the exact shape the gateway returned yesterday — no error, no usage, no text — now releases the hold and costs nothing. A call that *is* evidenced but returns unusable text is still settled, because the money left before the text could be judged. `usage_tokens` is reported from the gateway and never invented.

`scripts/othdb-select.js` only. No change to the provider, the budget module, OmniRoute, Codex, or any existing DeepSeek configuration.

## 4. Tests

`othk-7` grew a section that replays the exact failure:

```
K1  a reply with no usage and no text is NOT a completion
K2  the reservation is RELEASED — a phantom call costs nothing
K3  nothing is settled, so the ledger keeps telling the truth
K4  whitespace-only text is not evidence either
K6  billed-but-unusable output is still refused …
K7  … and still SETTLED, because tokens were consumed
K8  reported usage with empty text counts as billed
K10 usage_tokens comes from the gateway, never invented
```

```
othk-7  51 passed (was 41) · othk-4  90 · othk-0  89 · othk-2w 42
budget-ledger 121 · ai-executor 264 · governance-invariant 99 · compression 16
────────────────────────────────────────────────────────────────
772 passed, 0 failed, 0 regressions
```

## 5. Budget

Unchanged this session — **nothing was spent**:

```
oth-extraction  limit 0.10  reserved 0  spent 0.01  remaining 0.09
```

The $0.01 is yesterday's phantom charge. It cannot be reversed: `settle` is final by design, and `release` on a settled entry is correctly refused. It over-records spend, so it can never cause an overspend — the ledger is one cent pessimistic, and the code that produced it is now fixed.

## 6. The paid test was not re-run — deliberately

The instruction was to stop rather than work around the problem or spend more. With `proxy_enabled` still `1`, a second call would take the same dead path, produce no completion, and — with the new logic — release cleanly while proving nothing. Spending to re-observe a known fault is not evidence.

**It will be run the moment the flag is off.** $0.09 remains, and one call needs about $0.01.

## 7. Not done

Five conversations not run · archive not processed · no proxy created · no MITM enabled · OmniRoute, Codex and OpenRouter configuration untouched · gateway database not written to · no test weakened.

## 8. Next action

1. **Owner:** turn the proxy setting off on `openrouter-primary` in the OmniRoute dashboard.
2. Then one call, same governed path, ≤ $0.01.
3. Then decide the per-account ledger question (`os.homedir()`-scoped) before any larger pilot.
