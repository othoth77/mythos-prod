# Mythos Orchestrator

Provider-neutral delegation runtime. Claude orchestrates; a worker provider
(today Codex) implements; Git is the source of truth for whether anything
actually happened.

```text
Claude → task.json → provider → result.json → Git → Claude verifies → report
```

## Why it exists

Claude is good at architecture, review and judgement; a coding worker is good
at bulk implementation. Before this stage, moving work between them meant the
user copying messages by hand. This runtime removes that step without removing
accountability: Claude still decides what to delegate and still has to prove the
result against the repository before calling anything complete.

## Layout

| Path | Role |
|---|---|
| `orchestrator.js` | Public API — `delegate` / `status` / `inspect` / `cancelSafe` / `doctor` |
| `router.js` | Deterministic work-class → provider + execution-level lookup |
| `runner.js` | One task end to end: validate → preflight → launch → capture result |
| `verifier.js` | Re-derives every claim from Git; the provider's report is only a claim |
| `providers/codex.js` | Real `codex exec` adapter (verified against codex-cli 0.147.0) |
| `providers/claude.js` | Retains judgement work in the orchestrating session — never spawns a second Claude |
| `schemas/task.schema.json` | Strict task contract; carries no credentials |
| `schemas/result.schema.json` | Strict result contract; also passed to `codex exec --output-schema` |
| `templates/codex-task.md` | Prompt rendered for a delegated worker |
| `lib/` | `schema` (dependency-free validator), `git`, `store`, `redact` |
| `notify.sh` | Best-effort ntfy notifications; always exits 0 |
| `state/` | Placeholder only — real runtime state lives outside the repository |

## Runtime state

Source lives in Git. Runtime state does **not**:

```text
/home/deploy/mythos-orchestrator/tasks/<task-id>/
    task.json  prompt.md  stdout.log  stderr.log  result.json  status.json
```

Owned by `deploy`, mode `600`/`700`, never under `/tmp`. Override with
`MYTHOS_ORCHESTRATOR_HOME` (tests do this; production should not).

## Usage

```bash
node scripts/mythos-orchestrate.js delegate <task.json>
```

Exit codes are meaningful: `0` verified · `1` usage · `2` rejected · `3` blocked
· `4` failed · `5` approval required · `6` verification failed.

See [`docs/MYTHOS_ORCHESTRATOR_ARCHITECTURE.md`](../../docs/MYTHOS_ORCHESTRATOR_ARCHITECTURE.md)
for the model and [`docs/MYTHOS_ORCHESTRATOR_RUNBOOK.md`](../../docs/MYTHOS_ORCHESTRATOR_RUNBOOK.md)
for day-to-day operation.

## Invariants

These are enforced in code and covered by `tests/mythos-orchestrator-0-test.js`:

- A missing, malformed or unverifiable result is **never** success. Provider
  exit code `0` only means the CLI ran.
- Two writers never enter the same worktree; a branch checked out elsewhere is
  a hard blocker.
- Level 3 work (deployment, DNS, destructive DB, auth, secrets, high-risk infra)
  never executes automatically.
- Tasks carry no credentials, and everything written to disk is redacted.
- Notification failure is warning-only and cannot change a task's status.
- Cancellation is cooperative — `SIGTERM` only, never a force-kill.

## Adding a provider

Implement `version` / `available` / `buildArgs` / `renderPrompt` / `run` in
`providers/<name>.js`, register it in `runner.PROVIDERS`, and add the name to
the `assigned_provider` enum in the task schema. No other file should need to
change — provider-specific logic must not leak into `router.js`, `runner.js` or
`verifier.js`.
