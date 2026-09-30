# Mythos Haddad V2.4 — OTHKM, and why this host retrieves nothing

> Companion to [AI_TEAM.md](AI_TEAM.md), [DELEGATION.md](DELEGATION.md),
> [RESOURCE.md](RESOURCE.md), [CONSOLE.md](CONSOLE.md) and
> [UNATTENDED.md](UNATTENDED.md). The architecture of the store itself is
> `docs/PRIVATE_STORE_ARCHITECTURE.md` and
> `docs/OTH_KNOWLEDGE_INTEGRATION.md`; this document is only about what V2.4
> means **on Haddad**.

## The decision

**Ratified by the owner on 2026-09-23, option (a):**

> The canonical OTHKM store stays on the VPS. Haddad creates no local
> duplicate. Where the canonical store is unreachable from Haddad, the
> behaviour is **fail-closed / no-op**, explicitly and documented.

So V2.4 on this host is a **deliberate no-op with a correct, inert boundary**
— which the V2.4 exit gate already anticipated in its own words, "or the
stage is re-scoped honestly". This is that re-scope, made by the owner rather
than by an implementer.

## Why this was a decision and not a gap

The audit that preceded it (master plan §23) found **three** blockers, and
the missing store was the smallest:

1. `lib/knowledge.js` is required by **nothing** on any host — the
   integration does not exist on the VPS either.
2. `core/context.js` is reachable only through `core/orchestrator.js`, and
   core is off.
3. No store Haddad can reach.

**Blockers 1 and 2 survive either answer.** Provisioning a store on Haddad
would not have made V2.4 live; it would have added a second copy of private
knowledge and two truths to reconcile, and still retrieved nothing. That is
the whole argument for (a), and it is why the decision costs nothing to
implement: the correct behaviour was already the shipped behaviour.

## What (a) means mechanically

`projects/mythos-ai-executor/config/knowledge.json` names the canonical store
and has since the owner activated it on 2026-08-20:

```json
"store_root": "/home/deploy/othk-store"
```

On the VPS that path exists (0700, deploy-owned, outside Git). On Haddad it
does not, so `openKnowledge()` returns `{ enabled: false, reason: 'store_root
does not exist: /home/deploy/othk-store' }` and every read op is simply
absent. Nothing throws, nothing retries, nothing is created.

**One config, one answer to "where does knowledge live".** There is no
environment override of the store root, no default root, no auto-create path
in the read boundary. A store can only be created by a **write** path
(`projects/oth-knowledge/lib/store.js`, `_appendLine`), and the read facade
exposes only `READ_OPS` — a write-shaped operation on the service never
becomes reachable through it. No Haddad unit, timer or script references
`oth-knowledge` at all; the only service is `oth-knowledge-http.service`,
owned by `deploy` on the VPS.

Verified on this host on 2026-09-23: no `othk*` directory exists anywhere
under `/home/othman`, `/opt`, `/srv` or `/var/lib`; the boundary contains no
`mkdir`, no write/append/delete call and no env override; exactly one
`knowledge.json` exists in the tree.

## It is reportable, not merely off

Because "Haddad retrieves no knowledge" is true, intended and easy to mistake
for a fault, `bin/haddad-health.js` carries a `knowledge` check (#412). Live
on this node:

```
knowledge PASS | fail-closed: store_root does not exist: /home/deploy/othk-store
                — configured store is unreachable from this host, so no
                  knowledge is retrieved
```

**A layer that is off by design is a PASS, not a WARN.** A permanent yellow
for an architectural decision is a false alarm, and a check that cries wolf
on a correct configuration is one people stop reading. The machine-readable
truth travels in `data.available: false` without spending the alert. What is
**not** normal, and is a `FAIL`, is a config this host cannot honour: an
unparseable file or a non-absolute `store_root` means "we cannot tell what
was configured", which must never wear the same green as "no knowledge, as
configured".

## How the decision is kept, rather than just stated

A decision recorded only in prose drifts. Two suites now fail if it does.

**`tests/othk-2w-executor-wiring-test.js` §8 — the boundary is inert.**
Opening an absent store returns disabled **and leaves the filesystem exactly
as it found it**; five further opens still create nothing; a disabled layer
creates nothing; the boundary contains no `mkdir`, no write call, and no
environment override of the store root. That last group is a source
assertion on purpose — the behavioural checks prove today's code is inert,
and the source check fails the day somebody adds the mechanism, which is when
the decision would actually be lost.

**`tests/mythos-haddad-runtime-test.js` — the host-shaped half.** A duplicate
store does not arrive by accident; it arrives when someone edits the config
to point somewhere local. So: the `store_root` must remain
`/home/deploy/othk-store`, absolute and outside the repository, and **exactly
one** `knowledge.json` may exist in the tree.

Both were mutation-checked rather than assumed:

| Mutation | Result |
|---|---|
| boundary "helpfully" creates the store when missing | **8 failures** |
| an env override of the store root is added | **1 failure** |
| config repointed at a local `/home/othman/othk-store` | **1 failure** |
| a second `knowledge.json` appears in the tree | **1 failure** |

othk-2w **42 → 52**, Haddad runtime **34 → 36**, both 0 failing.

## The exit gate under (a)

| V2.4 gate item | Under decision (a) | Evidence |
|---|---|---|
| OTHKM read path live on Haddad with provenance and explicit `asOf` | **Re-scoped by the owner.** The boundary is present and correct; live retrieval on this host is out of scope by decision. `asOf` enforcement and provenance remain pinned where the layer is live | othk-2w §1–§7, 52/0 |
| memory written **only** from validated outcomes | **N/A on Haddad** — nothing is written here at all, because there is nothing to write to. The guarantee stands where the store lives | boundary exposes no write op |
| secret-shaped content refused (test, not assertion) | Held, and independent of this host | `memory.js` refusal, covered in the othk suites |
| context assembly provably within the 8192-token budget | **Held by a different mechanism than the gate names.** `core/context.js` is unreachable with core off; the budget that actually protects the 8192-token window is the provider's — `PROMPT_BUDGET_TOKENS` in `providers/haddad-agent.js`, with exchange-level compaction | V2.1, measured |
| measurable improvement on a repeat-task benchmark, **or the stage is re-scoped honestly** | **This document is that re-scope**, made by the owner | ratified 2026-09-23 |
| STD-1 / STD-2 / STD-3 | STD-1 full sweep, 0 new failures · STD-2 no second store, no second config, no new subsystem — the phase's deliverable is a *refusal* to build one · STD-3 the layer is read-only and fail-closed | see below |

## What is NOT done, and is not a defect

- **Haddad retrieves no knowledge.** By decision. If that should change, the
  question to answer first is not "where does the store go" but blockers 1
  and 2 — nothing requires `lib/knowledge.js` anywhere, and `core/context.js`
  is unreachable with core off.
- **No sync, because there is nothing to sync.** One store, one truth. This
  is the property option (b) would have had to solve and did not.
- **The VPS→Haddad direction stays closed.** Registering a VPS→Haddad SSH
  credential remains a separate, pending owner decision
  (`projects/status-center/haddad/README.md`); it is not required by (a), and
  (a) is in fact the reason it is not required.
