# Haddad — Architecture Reuse Status

> **Last verified: 2026-09-22**
>
> This file is the short navigation point for the current Haddad architecture/reuse position.
> It records only the **new findings from the 2026-09-22 read-only architecture audit**.
> Existing Haddad findings remain in the existing Haddad/Executor PRs and handover documents.

## Current position

**Haddad is not a second Executor architecture. It reuses the existing Mythos Executor and GitHub Bridge.**

The audit traced the deployed entrypoints:

- `projects/mythos-haddad/systemd/mythos-haddad-worker.service`
  → `bin/mythos-ai-executor serve`
- `mythos-haddad-bridge.service`
  → `bin/mythos-github-bridge tick`

The Haddad separation is provided by its worker environment/namespace rather than by a separate Executor implementation, including the Haddad label/prefix/control namespace and separate `MYTHOS_EXECUTOR_HOME`.

## Measured architecture size

The read-only audit measured:

- `projects/mythos-ai-executor`: approximately **17.7k lines** across core/lib/providers
- `bridge/`: approximately **5.1k lines**
- **207 test files**

This confirms that the existing Executor/Bridge surface is already substantial and reusable; a parallel Haddad engine would duplicate existing infrastructure.

## Reuse-audit result

The audit classified the remaining Haddad gaps as:

**8 integration / wiring items — not new subsystems.**

The existing repository already records the specific known gaps and decisions. Do not rebuild those components.

## What to read next

1. **This file** — quick architecture/reuse position.
2. **`STATUS.md`** — overall Haddad implementation and verification status.
3. **`docs/AI_HANDOVER.md`** — detailed chronological handover/evidence.
4. **Haddad PRs / Executor PRs** — implementation-level evidence and merge state.
5. **Issue #386** — audit record containing only the new repository facts recorded here.

## Audit boundary

The architecture audit was **READ-ONLY**:

- no source modification
- no commit/push/merge
- no install
- no restart
- no configuration change

No implementation status is inferred from the audit beyond the evidence recorded above.
