# Live E2E through the real Fable 5.1 path

`live-e2e-fable.sh` runs ONE supervised task through the production chain
where Fable 5.1 actually executes:

```
Supervisor (VPS) → GitHub Issue (label task, Model: Fable 5.1) → VPS bridge
→ VPS executor → claude -p --model claude-fable-5-1 → executor-run check
→ commit on mythos/gh/gh-issue-N → governance relay push → Supervisor:
  GitHub delivery + measured files + file content + measured model → COMPLETED
```

## Why Fable is not on Haddad

`config/model-policy.json` maps `fable-5.1` to `claude-fable-5-1`, served by
the `claude-code` provider, which only the VPS executor runs. The Haddad
worker (`haddad-agent`) serves its local model (Qwen 2.5 7B). Until
2026-09-30 a Haddad task written `Model: Fable 5.1` ran Qwen under a Fable
label (live E2E #542). The Haddad bridge now refuses a named Claude model
(`MODEL_UNAVAILABLE`), and `config/supervisor-haddad.json` names none.

## Owner steps, in order

1. **Merge** the measured-outcome PR.
2. **VPS checkout**: fast-forward `/home/deploy/projects/mythos-prod` to
   `origin/main`. The bridge timer picks the new code up on its next tick.
3. **VPS executor**: restart `mythos-ai-executor.service` through your
   governed path. It is a HostOps-protected unit, and until it restarts it
   settles tasks with the OLD rules. The script refuses to run if the daemon
   started before the checkout moved.
4. **Run**:

   ```bash
   ssh deploy@51.68.226.211 "FIX_COMMIT=<merge sha> bash -s" < ops/live-e2e/live-e2e-fable.sh
   ```

   It prints preconditions, T1 submit, the watch log (about 5–40 min: Fable
   run + relay push every 5 min), the trace, and an evidence JSON. The exit
   code is `0` for COMPLETED and `2` for BLOCKED. The isolated store under
   `~/mythos-live-e2e/<stamp>/` keeps everything.

## What makes it pass, and nothing else can

| Gate | Measured by |
|---|---|
| file written, marker present | the executor re-runs `node scripts/mythos-assert-file.js <file> <marker>` in the worktree after Fable finishes, with an environment holding none of its secrets |
| real commit, in scope | `git diff <base>..HEAD` and `merge-base` in the worktree; any file outside the declared Scope → `OUT_OF_SCOPE` |
| report agrees | a claimed file git does not show, an invented commit, or a summary admitting failure → `EVIDENCE_CONTRADICTION` |
| Fable answered | `claude -p` `modelUsage`: the serving model must be `claude-fable-5-1`, else `MODEL_IDENTITY_MISMATCH` (executor and supervisor both) |
| remote delivery | the supervisor asks GitHub: the commit is on `mythos/gh/gh-issue-N`, the files between base and branch, and the file content at the verified head |

A failure at any gate is `BLOCKED` for a person, never `COMPLETED`: the E2E
config has no recovery, no Qwen and no OpenAI.

## Cleanup

The artifact lives only on the task branch `mythos/gh/gh-issue-N` (never
merged). After review, the Issue can be closed and the branch deleted.
