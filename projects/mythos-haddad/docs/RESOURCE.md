# Mythos Haddad V2.3 — resource awareness

> Companion to [AI_TEAM.md](AI_TEAM.md) (V2.1) and [DELEGATION.md](DELEGATION.md) (V2.2).
> This is the **resource-awareness half** of V2.3. What is NOT done is stated at the end.

## The question this answers

*Is there room on the GPU for another inference right now?* Before V2.3 the
resource guard could not answer it: it measures `MemAvailable`, PSI and
`oom_kill` and knows nothing about the GPU at all. It would happily admit a
second task on RAM alone while the inference runtime had no room.

## Why not the OS

`projects/mythos-haddad/bin/haddad-gpu-vram.py` exists and is reused by the
telemetry agent, so it was the obvious source. It is not used here, because
on this host it answers:

```json
{ "vram_total_mib": 6400.0, "vram_used_mib": 0.0, "vram_used_pct": 0.0 }
```

with a 3,883 MiB model demonstrably resident on the card. The OS-level Vulkan
budget query is unreliable on NVK/nouveau — `AI_RUNTIME.md` already records
this — and **a signal that reads 0 while the GPU is full is worse than no
signal**, because it turns a missing measurement into a confident wrong one.

## What is used instead

llama-server's own `/slots`, which is the runtime's accounting of its own
occupancy, read with the runtime key the provider already holds:

```
4 slots · is_processing per slot · n_ctx 8192
```

`lib/gpu-slots.js` shapes that into `{slots_total, slots_busy, slots_free,
n_ctx, kv_pool_tokens, task_kv_tokens}`, and returns **null** whenever it
cannot be answered honestly — no marker, no key, no runtime, an unparseable
reply. Null is absent, never zero.

## The trap: four slots is not four tasks

The runtime runs with `kv_unified = true`, so the four slots **share one KV
pool** of `--ctx-size` tokens. The 8,192 each slot advertises is the *same*
8,192, not four of them. Slot count is a ceiling, never a budget.

## Measured, and the measurement argues with the obvious answer

Real concurrent requests at the size of a real executor task prompt
(5,451 chars → 1,264 prompt tokens as this runtime counts them), live on
2026-09-23:

| concurrent | succeeded | wall clock | slots seen busy |
|---|---|---|---|
| 1 | 1/1 | 6,632 ms | 0/4 |
| 2 | 2/2 | 6,511 ms | 2/4 |
| 3 | 3/3 | 7,413 ms | 3/4 |

**Three concurrent tasks of that size demonstrably fit** — 3 × 1,264 = 3,792
of 8,192 — at a 12 % wall-clock cost. Concurrency is not limited to one by
the pool at typical size, and the earlier assumption that it was is wrong.

**It is limited by what a task may grow to.** A supervised task that enters
repair carries its brief and, on the last round, an escalated diagnosis:
measured up to ~6,400 prompt tokens across the V2.1 role runs. A task's size
is not knowable when it is admitted, `/slots` reports occupancy but **not** KV
tokens, and exhausting a *shared* pool mid-flight degrades every task in it
rather than only the newcomer.

So admission budgets against the **ceiling** a task may reach, not the size it
starts at:

```
capacity = min(slots_total, floor(kv_pool_tokens / task_kv_tokens))
         = min(4,          floor(8192 / 6400))            = 1
```

That is a deliberate choice of the conservative number over the demonstrated
one. Both are written down so the trade is visible rather than implied, and
`HADDAD_TASK_KV_TOKENS` is the knob if a future measurement justifies moving
it.

## The admission rule

`resourceGuard.admission(status, opts)` gained an optional
`opts.needs_gpu`. **Default false**, so every existing call site behaves
exactly as before and hosts with no GPU are unaffected.

The GPU rule only ever **adds** a denial:

| case | result |
|---|---|
| no `needs_gpu` | unchanged |
| `needs_gpu`, room available | admit, with the capacity recorded |
| `needs_gpu`, at capacity | **deny** `gpu_at_capacity`, carrying the numbers it decided on |
| `needs_gpu`, pool too small for one task | **deny** `kv_pool_too_small_for_one_task` |
| `needs_gpu`, signal unreadable | **admit** — absent is not zero, and telemetry we cannot read must not hold the queue shut |
| memory `CRITICAL` | **deny** `resource_pressure`, whatever the GPU says |

`in_flight` is the executor's own count of what it started, and it is trusted
over `slots_busy`: a task between model turns holds no slot but still owns
its share of the pool.

### And the executor actually asks

Worth separating, because the first version of this change did not. A rule
that `admission()` supports and **nobody passes** is dormant: the signal
existed, the tests passed, and the live path never consulted it. That is the
shape of a feature that looks done and is not.

`guardGate(status, task)` is now task-aware. When the task's provider is the
local Qwen runner it asks the GPU question; for any other provider, or with
no task, it is byte-for-byte the previous behaviour. `tick()` asks about the
task at the head of the queue — the one that would actually start — and
`dispatchTask()` about the task it is dispatching.

## The scheduler half: a lease held around a TURN, not around a task

The signal above tells admission whether the card is free. It cannot by
itself overlap anything, and the reason is a single line: `gpu_in_flight`
was `runningCount()`, the number of RUNNING tasks. A task counts as running
for its whole life — including the minutes it spends in validation, the
declared checks in their sandbox, the workspace snapshot and the delivery
commit, **none of which touch the GPU**. With capacity 1 that made "one task
at a time" and "one inference at a time" the same sentence, and a second
task was refused admission while the card sat idle.

A lease separates them. It is taken around a model turn and released the
moment the model answers:

```
task A:  [prompt]--GPU--[validate][checks][git]          lease released here
task B:            waits ----------[prompt]--GPU--...    lease acquired here
```

GPU work stays strictly serialised, which is what the KV budget requires;
everything that is not GPU work overlaps freely.

### Counting is not serialising — and a live run proved it

The first version recorded the lease and stopped nobody. Two tasks run
against the real runtime showed the flaw immediately: **maximum concurrent
leases observed = 2**, not 1. Admission gates a task *once*, at its start;
nothing then coordinates the turns it takes minutes later. An overlap design
that only counts is an overlap design that does not serialise.

So the turn now **waits** for a free card — `acquireWhenFree()` — bounded
three ways, because a turn that waits forever is worse than one that is
refused:

- the task's **own deadline**, so waiting can never outlast the work;
- a **TTL** on every lease, swept lazily, so a provider that dies mid-turn
  cannot wedge the card shut for the life of the daemon;
- **re-entry is not a second claim**, so a repair round returning to the
  model cannot deadlock against itself.

A task that never gets the card inside its deadline fails with
`HADDAD_AGENT_GPU_BUSY` — named, not silent. Grants are in no particular
order: this is mutual exclusion, not fairness. Calling it a queue would be
claiming a scheduler this does not build.

It is **in-process on purpose**. `bin/mythos-ai-executor serve` runs the
server and the executor in one process and the provider's `run()` is called
there, so a module-level registry is a valid central gate for every
inference this executor starts. It is not a cross-process lock and does not
pretend to be — which is why the KV budget, not this, remains the real
ceiling.

### Measured live, two supervised tasks, real runtime

Both tasks seeded with the same broken fixture and run concurrently through
the real provider against the real model, with the lease sampled every
150 ms:

| | |
|---|---|
| `overlap-A` | validated, 17 tool calls, 0 GPU waits, 84 s |
| `overlap-B` | validated, 14 tool calls, **1 GPU wait**, 148 s |
| **max concurrent GPU leases** | **1** |
| card utilisation | 100 % (no idle gap between turns) |
| wall clock, both tasks | **148 s** |
| sum if run back to back | 232 s |
| **saved by overlapping** | **84 s (36 %)** |

Three things are worth reading off that table. The maximum is **1**, so GPU
work is genuinely serialised rather than merely counted — which is what the
first version failed. `overlap-B` recorded a `gpu_wait` in its tool trace,
so the waiting path is not theoretical: a turn really did block until the
other task released the card. And the 36 % is the whole point of the stage —
that is one task's validation, declared checks and git running during the
other's model turns, on a machine that can only ever run one inference at a
time.

The saving is bounded by how much of a task is *not* inference. These tasks
spend most of their time in model turns, so 36 % is near the ceiling for this
shape of work, not a floor to extrapolate from.

## What V2.3 does NOT do

Stated plainly rather than left to be discovered.

- **`MYTHOS_MAX_PARALLEL` is still 1 on this host.** The mechanism now
  permits overlap, but raising the number is an operational change to
  `worker.env`, not a repo change, and it should follow a measurement of
  *full* supervised tasks overlapping in production rather than this
  demonstration. The lease makes it safe to raise; it does not raise it.
- **Grants are unordered.** Under sustained contention a turn could in
  principle wait while later arrivals are served. With capacity 1 and two
  tasks this is not observable, and fixing it means building the queue this
  deliberately is not.
- **No second concurrent supervised task has been run end to end.** What was
  measured is concurrent *inference* at task-prompt size, not two full
  supervised tasks with their sandboxes, validators and deliveries.
- **The denial has not been observed live.** With capacity 1 and
  `MYTHOS_MAX_PARALLEL=1`, the executor never tries to start a second GPU
  task, so `gpu_at_capacity` is proven by test rather than by a run. It
  becomes reachable the moment either number moves.

`tests/mythos-haddad-gpu-admission-test.js` — 24 assertions, every reading
injected.
