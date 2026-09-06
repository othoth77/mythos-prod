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
lib/delegate.js        the boundary: load / discover / lanes / resolve / dispatch
bin/mythos-delegate    operator CLI (status | discover | lanes | dispatch)
```

## Usage

```bash
node projects/mythos-delegate/bin/mythos-delegate status
node projects/mythos-delegate/bin/mythos-delegate discover
node projects/mythos-delegate/bin/mythos-delegate lanes --repo /path/to/repo
node projects/mythos-delegate/bin/mythos-delegate dispatch \
  --lane tests --repo /path/to/repo --brief brief.txt --timeout 45m
node tests/mythos-delegate-test.js     # 53 assertions, offline
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
