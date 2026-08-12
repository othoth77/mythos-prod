# Mythos Orchestrator — Runbook

Operational guide for `MYTHOS-MULTI-AGENT-ORCHESTRATOR-0`. For the model behind
it see [`MYTHOS_ORCHESTRATOR_ARCHITECTURE.md`](MYTHOS_ORCHESTRATOR_ARCHITECTURE.md).

All commands run as `deploy`:

```bash
sudo -u deploy -H bash -lc 'cd /home/deploy/projects/mythos-prod && <command>'
```

---

## 1. Daily user workflow

1. Open Claude Code.
2. Say: **`Continue Mythos.`**
3. Read the single consolidated report Claude returns.

That is the whole workflow. Claude reads GitHub and `docs/AI_HANDOVER.md`,
identifies the next authorised stage, decides whether to implement it itself or
delegate it, runs the delegation, verifies the result against Git, and reports
once. You are asked for a decision only when a real blocker or a level 3
approval appears.

You should never need to copy text between Claude and Codex.

---

## 2. How Claude delegates

Claude does this automatically; it is documented here so the behaviour is
auditable.

1. Classify the work (`risk_class`) and route it.
2. If the decision is `USER_APPROVAL_REQUIRED` — stop and ask the user.
3. Create an isolated worktree and branch for the task:

```bash
git worktree add -b agent/<stage-lowercase>/<task-id-short> \
  /home/deploy/projects/worktrees/<task-id-short> <baseline-sha>
```

4. Write the task envelope and dispatch it:

```bash
node scripts/mythos-orchestrate.js delegate /path/to/task.json
```

5. Read the structured result, then verify it independently against Git.
6. Report one consolidated outcome.

Useful pre-dispatch checks:

```bash
node scripts/mythos-orchestrate.js validate /path/to/task.json
```

```bash
node scripts/mythos-orchestrate.js route /path/to/task.json
```

`--dry-run` prepares the task directory and prompt, and reports the exact
provider command, without launching anything.

### Exit codes

| Code | Meaning | What Claude does |
|---|---|---|
| 0 | verified | continue |
| 1 | usage error | fix the invocation |
| 2 | rejected (schema, secret, provider mismatch) | fix the task |
| 3 | blocked by a safety or Git gate | resolve the blocker; never force past it |
| 4 | provider ran, task failed | inspect logs, decide |
| 5 | user approval required | stop and ask the user |
| 6 | verification against Git failed | never report complete |

---

## 3. Inspect status

All tasks:

```bash
node scripts/mythos-orchestrate.js status
```

One task:

```bash
node scripts/mythos-orchestrate.js status <task-id>
```

Full detail including redacted log tails:

```bash
node scripts/mythos-orchestrate.js inspect <task-id> --lines 80
```

States: `running` · `completed` · `blocked` · `failed` · `cancelled` ·
`orphaned` (status said running, process is gone) · `unknown`.

Environment and provider check:

```bash
node scripts/mythos-orchestrate.js doctor
```

---

## 4. Recover an interrupted task

A disconnected terminal does **not** mean the task failed. Check the recorded
state first:

```bash
node scripts/mythos-orchestrate.js status <task-id>
```

- **`running`** — the process is alive; leave it alone.
- **`orphaned`** — the process is gone without writing a result. Nothing was
  marked complete (a missing result is never success). Inspect the logs, then
  re-dispatch a fresh task against the current baseline.
- **`completed`** — re-verify before trusting it:

```bash
node scripts/mythos-orchestrate.js verify <task-dir>/task.json <task-dir>/result.json
```

To stop a running task cooperatively:

```bash
node scripts/mythos-orchestrate.js cancel-safe <task-id>
```

This sends `SIGTERM` only. There is no force-kill: never `kill -9` a task
mid-commit, and never delete another agent's worktree to unblock yourself.

After any interruption, confirm the worktree is clean and on the expected
branch before reusing it.

---

## 5. Approval-required situations

When routing returns `USER_APPROVAL_REQUIRED`, or a worker reports
`status: blocked` with `blocked_reason: approval_required`, the orchestrator
stops. It does not answer approval prompts on the worker's behalf and does not
bypass the approval mechanism.

Claude reports: what was requested, why it is level 3, what it would do, and
what it needs from you. Execution resumes only after you explicitly authorise
it.

Level 3 always includes: production deployment · DNS/firewall changes ·
destructive database operations · data or backup deletion · credential rotation
· authentication configuration · repository permission changes · Docker group
membership · Jellyfin · stopping unrelated production services.

---

## 6. Logs

```text
/home/deploy/mythos-orchestrator/tasks/<task-id>/
    task.json    the dispatched envelope
    prompt.md    the rendered worker prompt
    stdout.log   worker stdout (redacted)
    stderr.log   worker stderr (redacted)
    result.json  the structured result
    status.json  provider, branch, baseline, pid, timings, exit code
```

Notification outcomes: `/home/deploy/mythos-orchestrator/logs/notify.log`
(event, stage and outcome only).

Owned by `deploy`, mode `600`/`700`, outside the Git tree and outside `/tmp`, so
they survive logout and reboot.

---

## 7. Security

Never recorded: bearer tokens · database passwords · API keys · the ntfy topic ·
full environment dumps · any credential. Everything written to disk passes
through `lib/redact.js`, and a task containing a credential pattern is refused
before dispatch.

The notification topic is a capability secret. It lives only in
`~/.config/mythos-orchestrator/notify.env` (mode 600) and must never be
committed, printed or pasted into a task.

To rotate it, edit that file. No repository change is required — which is the
point of keeping it out of Git.

---

## 8. Upgrading the provider adapters

Both CLIs are moving targets, so re-verify rather than assume:

```bash
codex --version && codex exec --help
```

```bash
claude --version
```

If the invocation contract changed, update **only**
`projects/mythos-orchestrator/providers/<name>.js` — `buildArgs()` is kept pure
precisely so it can be asserted without executing anything — then:

```bash
node tests/mythos-orchestrator-0-test.js
```

Re-run one harmless end-to-end delegation before trusting the new adapter.

The result schema doubles as the `codex exec --output-schema` input, so it must
stay within the structured-output subset: all properties required,
`additionalProperties: false`, nullability via type unions, no `pattern` or
`minLength`. Put stricter checks in `verifier.js`, not in that schema.

---

## 9. Troubleshooting

| Symptom | Cause | Action |
|---|---|---|
| `BASELINE_MISMATCH` | worktree HEAD moved past the declared baseline | rebuild the task against the current HEAD |
| `DIRTY_WORKTREE` | another task owns that worktree | use a different worktree; never clean someone else's |
| `BRANCH_COLLISION` | branch checked out in another worktree | pick a new `agent/...` branch |
| `MISSING_RESULT` | worker exited without a structured result | inspect `stderr.log`; re-dispatch |
| `INVALID_RESULT` | result failed the contract | usually a worker error; inspect and re-dispatch |
| `PROVIDER_UNAVAILABLE` | CLI missing or not authenticated for `deploy` | run `doctor`; check `~/.codex/auth.json` exists for `deploy` |
| `verification_failed` | Git disagrees with the worker's claims | **never** report complete; read `verification.failures` |
| notify `send-failed-nonfatal` | notification endpoint unreachable | ignore; it cannot affect task status |
