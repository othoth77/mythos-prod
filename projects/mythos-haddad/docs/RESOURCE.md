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

## What V2.3 does NOT do

Stated plainly rather than left to be discovered.

- **`MYTHOS_MAX_PARALLEL` is unchanged at 1.** The measurement says the
  budgeted capacity for GPU work is 1, so there is nothing to raise.
- **Non-GPU work is not yet overlapped.** The plan's other half — letting
  validation, declared checks, git and snapshots of one task run while
  another occupies the GPU — is a scheduler change and is not in this
  document. The signal this adds is the prerequisite for it.
- **No second concurrent supervised task has been run end to end.** What was
  measured is concurrent *inference* at task-prompt size, not two full
  supervised tasks with their sandboxes, validators and deliveries.

`tests/mythos-haddad-gpu-admission-test.js` — 24 assertions, every reading
injected.
