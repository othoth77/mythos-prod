# Worklog — MCP budget surface; the proven paid run recorded and preserved

**Date:** 2026-08-31 · **Time:** 23:20 – 23:55 UTC
**Scope:** continue the MCP implementation from the verified state; record the successful paid extraction; add the one missing governance read.
**Outcome:** `budget_status` implemented and tested (othk-6 36 → 52). The proven paid run is now recorded in Git and preserved off `/tmp`. **No paid API call was made.**

---

## 1. Starting state, verified first-hand

| | |
|---|---|
| Worktree | `/home/deploy/oth-mcp` (the authoritative MCP worktree) |
| Branch | `vps/extraction-advisory-wiring-20260831` |
| HEAD | `035ae78`, tree clean |
| Remote | `origin/vps/extraction-advisory-wiring-20260831` = `035ae78` — **0 ahead, 0 behind, no divergence** |
| vs `main` | 11 ahead, 1 behind (feature branch; `projects/oth-mcp` is not on `main`) |
| Upstreams | knowledge :8150 · OTHMODE :3021 · executor :8130 · OmniRoute :20128 — all listening |

## 2. Git was wrong about the most important fact

The last commit's worklog (`035ae78`) states the paid test **was not re-run** and that egress was blocked by `proxy_enabled = 1`. That is no longer true: the owner cleared the flag, and the run succeeded. Git — the source of truth — carried the opposite of reality, and nothing in the repository recorded the one execution that proves the whole path.

Recovered from the host, not assumed:

```
source_id     23a12fd2-eb75-4b86-9e48-7ee2704ccf31
provider      openrouter/deepseek/deepseek-v4-pro   (transport: provider, agent: omniroute-advisory)
usage         prompt 1232 · completion 1913 · reasoning 1756 · total 3145
result        3 claims · 3 evidence · 0 facts        (facts_created: 0 — extraction never creates a fact)
spend         $0.01 reserved and SETTLED, settled_at 2026-08-31T21:26:10.198Z
```

The run report is now committed as evidence at
`docs/evidence/2026-08-31-extraction-run-23a12fd2-report.json`. It carries ids,
counts, usage and spend only — **no conversation content and no credential**;
it was scanned before committing.

**Budget position, read from the ledger rather than restated:**

```
oth-extraction  limit 0.10  ·  3 entries, all SETTLED at $0.01  ·  spent 0.03  ·  remaining 0.07
```

Two of the three are the earlier connectivity tests; the third is this run. This
matches the owner's stated remaining balance exactly.

## 3. Work preserved off `/tmp`

The successful run wrote its store to `/tmp/othk-extraction-run-20260831` — a
throwaway root, and the only copy of a paid result. Copied to a durable,
same-account path and verified byte-identical (`diff -r` clean):

```
/home/ubuntu/othk-extraction-runs/20260831-23a12fd2/
    report.json · meta.json · records.jsonl · objects/sha256/50/507d95ef…
```

The `/tmp` original was left in place rather than deleted — the mission requires
that completed work not live **only** in `/tmp`, which is now satisfied, and
deletion is irreversible.

**The extracted claims were NOT promoted into the canonical store**
(`/home/deploy/othk-store`, which the facade and therefore the MCP serve).
Promotion is *curation*, and curation is deliberately operator-only through
`othk-cli`; doing it here would have routed around a gate this server exists to
respect. Consequence, stated plainly: **the 3 claims are not yet reachable
through `knowledge_search`.** That is an owner decision, not an omission to fix
silently.

## 4. What the MCP already did, and was not rebuilt

`projects/oth-mcp/server.js` was found **complete and verified**, not
half-built: 7 read-only tools, JSON-RPC 2.0 over stdio, deployed via
`/home/deploy/deployments/oth-mcp/oth-mcp-stdio.sh`, and validated on
2026-08-30 by the official MCP Inspector against live upstreams, with every
write-shaped and unknown-operation attempt denied. Nothing in it was rewritten.

`lib/mcp-capabilities.js` was again left unwired — it governs the *outbound*
direction, and the separation is intentional (`docs/MYTHOS_SYSTEM_INDEX.md`
§11).

## 5. The one thing genuinely missing — budget had no MCP surface

Of the mandatory MYTHOS invariants, budget was the only one with no read tool.
A client could see tasks (`execution_status`) and reports
(`execution_report`) but could not see whether spend was inside its limit —
so the gate every paid action must pass was invisible to the interface that
exists to make MYTHOS legible.

It needed no new subsystem. The executor **already serves** the read:

```
GET /budget/<project>[/history|/reservations]     server.js:587
  "Read-only budget inspection. No mutation route exists: limits change
   only through a reviewed commit to config/budgets.json."
```

`budget_status` is therefore a routing extension of the existing `TOOLS`
array over the existing `upstreamGet` — no second tally, no new provider
abstraction, no duplicate budget implementation, no new verb. Verified live
(loopback, free): the route answers 200 authenticated and **401
unauthenticated**.

Two honesty properties were built in deliberately:

- **`configured: false` is a real answer.** No grant means every spend request
  is denied. A client must be able to distinguish that from "the tool could not
  find out", so an unreachable executor returns an explicit error naming the
  owner and **no spend position at all** — a budget read that invents headroom
  is the dangerous failure, and H3 asserts it cannot happen.
- **The reading is scoped to the ledger the answering executor owns** (§7).
  The tool reports that executor's truth rather than a merged figure it would
  have to invent.

Input grammar mirrors the executor's own `^[a-z0-9][a-z0-9-]{1,63}$` rather
than loosening it, which makes traversal unrepresentable: no dot and no slash
can appear in a project name this server will accept.

## 6. Tests — all targeted, none paid

```
othk-6-mcp-server                52 passed, 0 failed   (was 36 — +16 new)
othk-0-knowledge-core            89 · othk-1-search            30
othk-2-importers                 97 · othk-2w-executor-wiring  42
othk-3-trust                     63 · othk-4-conversation-extraction 90
othk-5-http-facade               44 · othk-7-advisory-transport 51
mythos-budget-ledger            121 · mythos-ai-executor       264
governance-invariant             99
──────────────────────────────────────────────────────────────────
1042 passed, 0 failed, 0 regressions
```

New in othk-6:

```
G1  budget_status is advertised to clients
G2  the executor's budget position is returned end to end
G3  the executor's own route is called, with GET
G4  an unconfigured project reports deny-by-default rather than an absence
G5  view=history reaches the history route
G6  view=reservations reaches the reservations route
G7  a traversal-shaped project is refused before any upstream call
G8  nothing traversal-shaped ever reached the executor
G9  an unaccepted view is refused
G10 a missing project is an explicit error
G11 the executor's project grammar is mirrored, not loosened
G12 a budget reading never carries the executor token
G13 budget_status issues no verb but GET
H1  an unavailable executor is an explicit error
H2  the error names the owning system
H3  no spend position is invented when the ledger cannot be read
```

Section G drives a **stub** executor rather than the live one, so the positive
path is proven without depending on any project's real ledger. The load-bearing
W section still passes unchanged: no tool name implies a write, no mutating
verb appears in the source, and a `tools/call` changes no knowledge record.

## 7. Finding — budget truth is fragmented, and the deployed executor cannot see the grant

Recorded, **not fixed**: both halves are owner decisions.

`GET /budget/oth-extraction` on the running executor returns:

```
limit 0 · spent 0 · remaining 0 · configured: false · entry_count 0
```

while the real ledger holds `$0.03` settled against a `$0.10` limit. Two
independent causes, each verified:

1. **Ledger scope.** `lib/state.js:38` roots the ledger at
   `path.join(os.homedir(), 'mythos-ai-executor')`. The extraction ran as
   `ubuntu`; the executor daemon runs as `deploy`. The entries are in
   `/home/ubuntu/…/budgets/`, which the daemon never reads. This is the
   `os.homedir()`-scoped ledger question the previous worklog left open (§8.3).
2. **Config scope.** The daemon executes from
   `/home/deploy/projects/mythos-prod/…`, a worktree tracking `main`. The
   `oth-extraction` grant lives in `config/budgets.json` on **this branch**,
   which is not merged. The daemon therefore has no grant for the project and
   would **deny** a spend request for it.

Cause 2 is fail-closed and safe — the daemon refuses rather than over-permits.
Cause 1 is the real hazard: a per-account ledger means a cumulative limit is
only cumulative *within one POSIX account*. **It cannot cause an overspend
today**, because the account that holds the grant is the account that holds the
entries, but it must be settled before any larger pilot. `budget_status`
surfaces this rather than papering over it — which is precisely why the tool
states its scope in its own description.

## 8. Not done, deliberately

- **No paid API call.** Nothing was spent this session; the ledger is unchanged.
- Four remaining conversations not run · the 1306-conversation archive not processed.
- `/tmp/oth.db` read-only and untouched (`mtime` unchanged).
- OmniRoute, Codex, OpenRouter and DeepSeek configuration untouched; no proxy created, no MITM enabled, gateway database not written to.
- Canonical knowledge store not written to; no claim promoted (§3).
- Budget module, provider, extractor and selector unchanged — the diff is the MCP tool, its tests and documentation.
- No `.env`, Docker, nginx, systemd, database or production change. No secret committed.
- The unrelated infrastructure findings (Git/VPS divergence, Coolify, PostgreSQL trust, duplicate worktrees, backups) were left alone by instruction; none blocked this work.

## 9. Next stage

1. **Owner decision:** settle the `os.homedir()`-scoped ledger (§7.1) — a single shared `MYTHOS_EXECUTOR_HOME` for governed spend, or an explicit per-account model. Required before any larger extraction pilot.
2. **Owner decision:** merge this branch to `main` so the deployed executor carries the `oth-extraction` grant (§7.2) and `projects/oth-mcp` stops being worktree-dependent.
3. **Owner decision:** curate the 3 proven claims into the canonical store via `othk-cli`, which makes them reachable through `knowledge_search` and completes Extraction → Knowledge → MCP end to end.
4. Only then: the remaining four conversations, ~$0.01 each against the $0.07 remaining.
