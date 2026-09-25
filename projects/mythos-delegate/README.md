# MYTHOS Delegate — the V1 delegation boundary

Stage: **MYTHOS-V1-DELEGATE** (2026-09-06).

MYTHOS does **not** implement delegation. [`amElnagdy/delegate-skills`](https://github.com/amElnagdy/delegate-skills)
(MIT) is the delegation layer: it owns lane resolution, the implementer CLI
invocation contract, the permission profiles, and the `delegate-relay.result.v1`
artifact. This project is the MYTHOS side of that boundary — nothing more.

```text
MYTHOS / OTHMODE          delegate-skills              implementer
   (control)        →      (delegation)         →      (execution)
```

## What this layer does

1. Loads a config-declared vendor root, **fail closed**.
2. Resolves a lane **through the vendor's own `lane.mjs`** — never by reading the
   lane file directly, so project-config trust (the approval-hash fail-closed
   path) stays the vendor's decision.
3. Invokes the vendor relay for that lane's implementer with an explicit
   `--out-dir` under the executor store, so every dispatch leaves a persistent,
   inspectable artifact directory.
4. Normalises `delegate-relay.result.v1` into `mythos.delegate.result.v1`.

## What it must never do

- Write lane configuration — `delegate-setup` owns that, behind its own explicit
  user-approval gate.
- Commit, push, or land. The relay never commits; the orchestrator lands.
- Invent a model, effort, or variant identifier.
- Carry a credential. The implementer CLIs authenticate themselves.

## Layout

```text
config/delegate.json   vendor root + artifact root wiring (closed field set)
config/targets.json    the CLOSED cross-repository allowlist (gh-issue-474)
lib/delegate.js        the boundary: load / discover / lanes / resolve / dispatch
lib/cross-repo.js      the cross-repository lane: authorize / resolve / verify / contract
bin/mythos-delegate    operator CLI (status | discover | lanes | dispatch
                                     | targets | authorization | workspace | contract)
```

## Usage

```bash
node projects/mythos-delegate/bin/mythos-delegate status
node projects/mythos-delegate/bin/mythos-delegate discover
node projects/mythos-delegate/bin/mythos-delegate lanes --repo /path/to/repo
node projects/mythos-delegate/bin/mythos-delegate dispatch \
  --lane tests --repo /path/to/repo --brief brief.txt --timeout 45m
node tests/mythos-delegate-test.js     # 68 assertions, offline
```

`dispatch` exits non-zero when the delegation was not successful, while the full
`mythos.delegate.result.v1` object still reaches stdout.

## The result contract

`mythos.delegate.result.v1` promotes what MYTHOS callers need and preserves the
raw vendor result verbatim under `vendor`. Two distinctions are load-bearing and
are covered by the suite:

- `touched_files: null` means **git could not report**; `[]` means git reported a
  **clean tree**. They are never collapsed together.
- `ok` is true only when the status is a terminal `completed` **and** the process
  exited zero. A terminal `completed` alone is a claim, not a success — and
  `touched_files` is the whole final tree, not attribution. Review the diff.

## Cross-repository delegation (gh-issue-474)

`lib/cross-repo.js` is the lane that lets the bridge delegate work to a
repository **other than** `othoth77/mythos-prod` — the blocker gh-issue-473
reported. It is a separate concern from the vendor boundary above and works on
a host where no implementer CLI is installed at all.

```bash
node projects/mythos-delegate/bin/mythos-delegate targets
node projects/mythos-delegate/bin/mythos-delegate authorization --repository othoth77/spy
node projects/mythos-delegate/bin/mythos-delegate workspace \
  --repository othoth77/spy --task <id> --action implement [--clone]
node projects/mythos-delegate/bin/mythos-delegate contract \
  --repository othoth77/spy --task <id> --action implement --accept "…" --test "…"
node tests/mythos-delegate-cross-repo-test.js   # 133 assertions, offline
```

Four guarantees, each refused rather than repaired:

1. **closed allowlist** — `config/targets.json` names `othoth77/spy` explicitly;
   no wildcard, no pattern, no environment variable adds a repository, and the
   control repository is refused as a target by construction;
2. **deterministic workspace** — `<workspaces_root>/<owner>__<repo>/<task-id>`,
   proven to be outside this repository, so target-repo files and control-repo
   files never share a tree;
3. **proven identity** — the checkout's own `origin` and toplevel must agree
   with the authorized target, on a fresh clone *and* on every reuse;
4. **`mythos.delegate.task.v1`** — a payload that states target, branch,
   workspace, action, profile, delivery, acceptance criteria and tests once, and
   where the action → profile map is *imported* from
   `bridge/action-resolution.js` rather than restated.

A target grants a **workspace**, never a profile, a model, a tool or a
permission. `push_enabled` is false for `othoth77/spy`: the lane installs a
no-push guard on the workspace remote and delivery is an owner step. The full
model, and the exact GitHub authorization path, are in
[`docs/MYTHOS_CROSS_REPO_DELEGATION.md`](../../docs/MYTHOS_CROSS_REPO_DELEGATION.md).

## Lane configuration

Lanes live outside this repository and are written **only** by `delegate-setup`
after explicit user approval:

| Scope | Path |
| --- | --- |
| Global | `~/.config/delegate-skills/config.json` |
| Project | `<git-root>/.delegate/config.json` (trusted only via an approval hash) |

Reinstalling or updating the vendor must not rewrite them.

## Vendor

Installed outside the repository at `/home/deploy/delegate-skills`, pinned at
`b781ee2` (2026-08-31). It is intentionally **not** vendored into Git: it is a
third-party MIT package with its own release history, and a copy inside this
repository would drift.
