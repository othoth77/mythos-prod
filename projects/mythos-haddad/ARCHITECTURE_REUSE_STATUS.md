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

## Reuse outcome — MYTHOS HADDAD live console (2026-09-22)

The first of the eight wiring items delivered. It confirms the position above: the gap was a
**connection**, not a subsystem.

**Reused unmodified:** the executor and its `lib/state.js` (task vocabulary, store layout,
`effectiveStatus`) · the health timer and its `mythos-haddad-health/1` report ·
`bin/haddad-gpu-vram.py` · the llama-server on `127.0.0.1:8600` · systemd as the scheduler ·
the Status Center docroot, vhost, TLS and `/data/` no-cache rule · STC-2's atomic-write and
append-only-history idiom · the site's tokens, pills, cards, tables and Arabic layer.

**Added — and this is the whole of it:** one collector/signer on the node (it schedules
nothing), one loopback receiver on the VPS, one shared contract module, one page.

**Refused, by name:** a queue, a scheduler, an executor, a provider, a second state machine,
a monitoring stack, an MCP server, a database, an event system, a resource monitor, a
notification channel, a UI framework.

**Two reuse decisions worth recording:**

- **The Haddad MCP was NOT used as the transport**, although it already exposes
  `haddad_health` with exactly the right data. It is stdio-over-SSH, so a VPS client would
  need the VPS→Haddad credential that does not exist — reaching it would have meant creating
  the inbound path the V1 scope forbids. The MCP remains the interface for interactive
  sessions; telemetry is the interface for continuous observation. Both read the same files.
- **The STC-2 monitor was NOT extended** with a Haddad probe. It polls, and nothing on the
  VPS can reach Haddad to poll. Inverting the direction was the only design that needed no
  new access at all.

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
