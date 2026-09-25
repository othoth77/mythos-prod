# Start gates

A start gate is a predecessor the bridge **proves itself** before it claims a
task. It extends the one existing primitive, `depends_on`: an entry
`gate-<name>` is resolved by `../start-gates.js` against `gate-<name>.json` in
this directory, instead of against the control store's tasks.

Use a gate when a predecessor is not a task in this bridge's own store: work
closed by another bridge instance, merged by a director, or an owner step on
the host. Text in an Issue ("do not start before …") is never evaluated.

## Manifest

```jsonc
{
  "gate": "gate-<name>",            // = file name without .json
  "project": "mythos-prod",         // only a bridge serving this project may open it
  "applies_to": ["gh-issue-461"],   // optional: existing (immutable) tasks it gates — add-only
  "requirements": [
    { "id": "R1", "evidence": [
      { "type": "commit_on_main", "commit": "<full sha>" },
      { "type": "file_on_main", "path": "docs/x.md", "contains": ["exact text"] },
      { "type": "probe", "probe": "<name>", "args": {}, "timeout_ms": 180000 }
    ] }
  ]
}
```

A hold (`"hold": true`, no requirements) never opens by itself; it is released
by a reviewed change that removes the task from `applies_to`.

- **commit_on_main**: the commit exists and is an ancestor of `origin/main` in the shared checkout.
- **file_on_main**: the file on `origin/main` contains every string.
- **probe**: `probes/<name>.js` is run as a child process with the JSON `args`. It must be read-only, exit 0 and print `{"ok":true,...}` as its last line.

Every failure is **fail-closed**: an unknown gate, a manifest that is invalid,
unparsable or for another project, a hold, a git error, or a probe that times
out, crashes or prints anything else. Each one leaves the task `PENDING`, with
the first unproven requirement in the `gate_wait` log line. Task ids starting
with `gate-` are refused, so no task can stand in for a gate.

Why `applies_to` exists: a task file is a snapshot. Editing the Issue never
changes it, and a rerun of a still-`PENDING` task is deferred. So the only way
to put a predecessor in front of an already-queued task without rewriting
bridge state is an owner-reviewed manifest. It can only add a dependency.

## Current gates

| Gate | Gates | Proof |
|---|---|---|
| `gate-v32-residuals` | `gh-issue-461` (V3.2.5) | R1: the live read-only probe `othk-v32-closeout` (store valid, ≥40 typed relationships, every committed seed ingested with identical ids, search claim, oth-knowledge-http healthy, 36 projects served). R2–R5: the commits and artifacts `projects/mythos-haddad/docs/V3_2.md` §11 cites for each residual. |
| `gate-owner-hold` | `gh-issue-196`, `gh-issue-389` | Hold. These tasks were queued before the push-guard repair and do not start just because claims work again. |
