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

The notification topic is a capability secret — possessing it is enough to
publish to it. It lives only in `~/.config/mythos-orchestrator/notify.env`
(mode 600, one file per user) and must never be committed, printed or pasted
into a task.

To rotate it, edit that file. Nothing in the repository changes — which is the
point of keeping it out of Git. Every notification wrapper on this host reads
that config rather than hard-coding a topic, so a rotation is a single edit per
user.

### Topic rotation, 2026-08-12

An earlier topic was written into a handover entry and therefore reached
committed Git history. It has been **revoked** and replaced with a freshly
generated 256-bit random topic.

- **Git history was NOT rewritten.** Rewriting shared history is forbidden
  (AGENTS.md §17), and it would not have helped: anything already pushed must
  be assumed captured. Revocation, not erasure, is the correct remedy for a
  leaked capability.
- The **old topic is obsolete** — publishing to it reaches nobody who matters,
  and nothing on this host references it any more.
- The **current topic is local-only**: user-local config, mode 600, absent from
  the repository, from Git history, and from every runtime log.

Neither value appears in this document, and neither should ever be written into
one. If a topic is ever exposed again, rotate rather than attempting to scrub
history.

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

---

## 10. OpenAI advisor (reasoning, planning, review)

The advisor asks OpenAI one question and returns a structured answer. It is
**advisory only**: it never dispatches a task, never touches Git, never
changes a routing decision and has no tools, shell or working directory.
It is not a worker provider — `runner.PROVIDERS` is still exactly `codex` and
`claude`, and the router is unchanged.

| Piece | Where |
|---|---|
| Code | `advisor.js`, `providers/openai.js` |
| Answer contract | `schemas/advice.schema.json` (also sent to OpenAI as a strict `json_schema`) |
| System prompt | `templates/advisor-system.md` |
| Models, limits, on/off switch | `config/openai.json` — no secrets |
| Credential | `~/.config/mythos-orchestrator/openai.env` for `deploy`, mode 600, one line `OPENAI_API_KEY=<set by owner>` |
| Recorded answers | `<orchestrator home>/advice/<advice-id>.json`, mode 600 |

**Shipped disabled.** `config/openai.json` has `"enabled": false`; while it
does, `advise` returns `disabled` and sends nothing. Enabling is a separate,
owner-approved change to that one field. Rolling back is the same edit.

The shipped switch is **authoritative**: it is read from the
`config/openai.json` next to `advisor.js`, at a path no caller can change.
A caller's `opts.config` / `opts.configPath` may adjust other settings but
can only turn the advisor **off**, never on (effective = shipped `enabled`
AND caller `enabled`). An unreadable or malformed shipped file counts as
disabled. `doctor` reports the same effective value.

A request:

```json
{ "advice_id": "review-pr-0001", "role": "review",
  "question": "Is this change safe to merge?",
  "context": "<diff or issue text>",
  "subject_risk_class": "CODE_IMPLEMENTATION" }
```

```bash
node scripts/mythos-orchestrate.js advise request.json --dry-run
```

```bash
node scripts/mythos-orchestrate.js advise request.json
```

`--dry-run` prints the exact request body (never the key) and sends nothing.
Exit codes: `0` completed or dry-run · `1` usage · `2` rejected · `3`
disabled or blocked · `4` failed.

Guarantees, each covered by `tests/mythos-orchestrator-openai-test.js`:

- **Key handling.** Read from the key file at call time, used for one
  `Authorization` header, never returned, logged, recorded or put in an
  error. Only OpenAI's error `type` and `code` are kept — an OpenAI 401
  message echoes part of the key, so it is discarded.
- **Secret gate.** A question or context containing a credential pattern is
  refused before anything is sent. The gate is `lib/redact.js` (shared with
  the task gate, unchanged) plus advisor-only patterns in `advisor.js`:
  `Bearer` tokens, `Authorization: Basic` headers, Telegram bot tokens,
  Stripe `sk_`/`rk_` live/test keys, bare 40-character AWS secret keys,
  passwords stated in prose, and bare hex tokens of 32+ characters. Git
  SHA-1s (exactly 40 hex) and labelled digests (`sha256:…`, `checksum …`)
  are deliberately allowed, so ordinary GitHub context still passes. The
  gate is pattern-based: never pass raw environment or log dumps.
- **Untrusted context is fenced per call.** The context sits between
  `BEGIN`/`END` lines carrying a fresh 128-bit random marker, so text inside
  it cannot close the fence early.
- **Never a false success.** HTTP errors, timeouts, truncated or refused
  answers, prose instead of JSON, and schema-invalid or over-long advice all
  end `failed`, and a failed answer writes no record. If a VALID answer
  cannot be recorded (`RECORD_WRITE_FAILED: <code>`), the outcome is
  `failed` but still carries the answer, so a paid answer is never silently
  lost; `advise()` never rejects.
- **Risk floor.** `suggested_risk_class` is accepted only when it is at least
  as strict as `subject_risk_class` (approval-only > judgement >
  implementation). Advice can send work towards a human, never away from one.
- **No retries, bounded output, hard deadline.** One request per call;
  `max_output_tokens` comes from the role's config. `timeout_seconds` is a
  HARD total deadline from the start of the call — a slow-drip response
  cannot extend it — and a connection that closes before the full body
  arrives fails as `RESPONSE_TRUNCATED` at once.
- **Upstream retention off.** Every request sets `store: false`.
- **Context is not recorded.** The record keeps the question, the advice,
  usage and cost, plus the context's length and SHA-256 — not the context.

Cost is reported as tokens. It is also reported in USD once `price_per_mtok`
is filled in `config/openai.json` from OpenAI's pricing page, keyed by model:
`{ "<model>": { "input": <usd per 1M>, "output": <usd per 1M> } }`.

`doctor` shows the advisor's state — enabled flag, model per role, and the
key file's presence and mode by `stat()` only (the file is never opened).

| Symptom | Cause | Action |
|---|---|---|
| `disabled` / `ADVISOR_DISABLED` | shipped default | enabling is an owner decision |
| `blocked` / `PROVIDER_UNAVAILABLE` | key file missing or empty for this user | check `doctor`; the owner writes the key file |
| `failed` / `HTTP_401` | key revoked or wrong | owner rotates the key file |
| `failed` / `INCOMPLETE` (`max_output_tokens`) | answer truncated | raise that role's `max_output_tokens` in config |
| `rejected` / `SECRET_IN_REQUEST` | credential in question or context | remove it; never send secrets to the advisor |
| `failed` / `TIMEOUT` | hard deadline (`timeout_seconds`) passed | retry later; raise `timeout_seconds` only with a reason |
| `failed` / `NETWORK_ERROR` (`RESPONSE_TRUNCATED`) | connection closed mid-response | retry; nothing was recorded |
| `failed` / `RECORD_WRITE_FAILED` | advice store not writable | the answer is in the outcome; fix the store permissions |
