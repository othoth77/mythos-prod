# Report gh-issue-492 — BLOCKED

| Field | Value |
|---|---|
| Completed | 2026-09-26T17:51:58.634Z |
| Executor task | `t-20260926174805-4xnkdr` |
| OTHMODE task | `OTH-2026-01925` |
| Attempt | `gh-issue-492#1` |
| Action | test (source explicit_current_issue, written "test") |
| Profile | repo-test |
| Blocker | `HUMAN_APPROVAL` The objective asks to run 'the self-check command' with --mode=strict, but no such command exists at fe315aeb395e: repository search, the seed command library and OTHMODE Memory found nothing named self-check that accepts a strict mode. The closest artefacts were examined and ruled out: ops/hostops/ |
| Runtime | `b2487ee1a5ba` on `main` **RUNTIME_STALE_CHECKOUT** |
| Model | `claude-fable-5-1` (explicit:fable-5.1 (requested "fable-5.1")) |
| Branch | `mythos/gh/gh-issue-492` |
| Commits on origin | null |
| Git verified | null |

## Summary

The objective asks to run 'the self-check command' with --mode=strict, but no such command exists at fe315aeb395e: repository search, the seed command library and OTHMODE Memory found nothing named self-check that accepts a strict mode. The closest artefacts were examined and ruled out: ops/hostops/live-selftest.js accepts only --mode direct|socket, requires root and mutates host systemd (invoked with --mode=strict it exited 64 'run as root' before parsing the flag, and was not run further); the live OTHMODE command ai-self-check is an LLM advisory prompt with no mode option behind an API that needed approval to reach; the only 'strict mode' in the codebase is the bridge runtime gate MYTHOS_BRIDGE_STRICT_RUNTIME=1. The suite covering that gate, tests/mythos-github-bridge-test.js, was executed and passed 150/0. Reading the issue body via gh, listing origin/mythos/control and curl probes were denied (approval required), so a more specific command name could not be recovered. The worktree is clean and HEAD is unchanged; no files were modified and no commits were made, as the read-only constraint requires. OTHMODE task OTH-2026-01925 was advanced to phase VALIDATION with the evidence; its terminal status is left to the bridge.

## Commits

- none

## Files changed

- none

## Tests

- tests/mythos-github-bridge-test.js (covers MYTHOS_BRIDGE_STRICT_RUNTIME=1 strict mode): 150 passed, 0 failed
- ops/hostops/live-selftest.js --mode=strict: exit 64 'run as root' (refused before flag parsing; not run further, root-only and host-mutating)
- self-check --mode=strict (literal objective): NOT RUN — no such command exists in the repository
- git status --short after tests: clean, HEAD fe315aeb395e58b3cb8bfbaeb759e81ff833af38 unchanged
- check:status_completed: not satisfiable by this run — the objective's command does not exist; terminal status is set by the bridge
- check:tests_pass: bridge suite 150/0; the named self-check could not be run

## Validation

- required checks: The self-check should pass with the correct mode; Also show evidence that: The task should be marked as completed with a passing test; check:status_completed; check:tests_pass
- remote head: —
- report problems: none

## Problems

- HUMAN_APPROVAL: The objective asks to run 'the self-check command' with --mode=strict, but no such command exists at fe315aeb395e: repository search, the seed command library and OTHMODE Memory found nothing named self-check that accepts a strict mode. The closest artefacts were examined and ruled out: ops/hostops/live-selftest.js accepts only --mode direct|socket, requires root and mutates host systemd (invoked with --mode=strict it exited 64 'run as root' before parsing the flag, and was not run further); the live OTHMODE command ai-self-check is an LLM advisory prompt with no mode option behind an API that needed approval to reach; the only 'strict mode' in the codebase is the bridge runtime gate MYTHOS_BRIDGE_STRICT_RUNTIME=1. The suite covering that gate, tests/mythos-github-bridge-test.js, was execu

## Risks

- The GitHub issue body was not readable in this session (gh/control-branch/curl calls required approval), so if the issue names a specific command it was not seen here.
- If 'self-check' refers to the live OTHMODE ai-self-check command, it has no mode option and can only be run through the authenticated API on the host.

## Next recommended action

Issue author names the exact self-check command and its location (or confirms tests/mythos-github-bridge-test.js strict-mode coverage is the intended test); then re-dispatch gh-issue-492 as a read-only test run.
