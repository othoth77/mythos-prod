# MPI Memory Ingestion Roadmap — PROPOSED

**Status:** PROPOSED — planning result only. Nothing here is authorised; every real batch still requires its own §24(5) owner order + same-session backup (`MPI_2H_INGESTION_SPECIFICATION.md` §24–§25, §32–§33).
**Date:** 2026-08-15 · **Basis:** read-only inventory of the repository and VPS knowledge surfaces. No data was ingested, no records or objects created.

## 0. Governing principle — what does NOT become memory

Git is the source of truth (AGENTS §2) and documents are not memory (memory policy §6: no raw transcripts/documents). MPI holds **distilled durable facts, preferences, and decisions** — by pointer discipline (D2), never copies of what a product or the repository already owns. The 104 docs, 323 commits, and the 725 KB handover are therefore **sources to distil and point at**, not content to copy in. Anything violating this is marked *excluded* below.

## 1. Source inventory and classification

| # | Source | Type (policy §1) | First-party | MPI carrier | Under current O-2H-1? | Needs per-batch §24(5)? | ~Candidates | Sensitive-data concerns |
|---|---|---|---|---|---|---|---|---|
| 1 | **Owner working preferences** (owner-authored; 1 exists: batch-2h-001) | **A** | Yes | `pi_memory_records` (note) | **YES** — exactly what O-2H-1 authorises | Yes | 5–15 (owner-dependent) | None if owner-curated; credential gate active |
| 2 | **Ratified owner decisions** — D1–D5, O-2H-1…6, F14-A…D, gate closures (all verbatim in docs) | **F** | Yes (owner decisions) | `pi_memory_records` (explicit_instruction), `source_reference` → doc §-pointer | **YES** — owner re-enters each via CLI; the text is already owner-authored | Yes | ~15–20 | None — already public in the repo |
| 3 | **Project milestones / stage history** — `AI_HANDOVER.md` (161 stage sections), `docs/history/DAILY_HISTORY.md` (day ledger, conflict-honest), git log (323 commits) | **E/F** | Yes | `pi_memory_events` (MILESTONE / PROJECT_STATE / DECISION) | **PARTIAL** — a small owner-curated set typed as notes qualifies; **bulk derivation does not** (not "entered by me"; importer-class work, post-2H §15) | Yes | 10–30 curated; hundreds if bulk (**not proposed**) | Low; avoid third-party names per D1 |
| 4 | **Architecture/product documentation** (104 files in `docs/`) | — | Yes (project-owned) | `pi_knowledge_sources` **pointer registry only** | **NO** — not a memory class; registry path is unimplemented and unauthorised | n/a | 0 memories (≤104 pointers, future) | Content stays in Git either way |
| 5 | **Business/project notes outside docs/** | A/F | — | — | — | — | **0 found** (`data/` holds app fixtures only); owner would author new ones as source 1 | — |
| 6 | **Structured data** (`agent-skills-registry.json`, product schemas) | — | Product-owned | opaque refs only (D2) | **NO** — registry/product data, never duplicated into MPI | n/a | 0 | n/a |
| 7 | **idauto / darhijama / coolify production data** | — | — | — | **NEVER** — architecture §20.7: "never migrates into MPI" | n/a | 0 | Excluded by ratified decision |

## 2. Technical gaps surfaced by this planning (no action taken)

1. **`pi_memory_events` ingestion is not implemented** — the CLI/ingestion module creates memory records + provenance only. Milestone/decision *events* (source 3) need a separately-authorised CLI/module extension before any event batch.
2. **`pi_knowledge_sources` registration** (source 4) has no implemented or specified path — its own small spec + authorisation if ever wanted.
3. **Bulk derivation from history** would be importer-class work (§15: designed for, not implemented; post-2H) and would additionally require an O-2H-1 revision. Not proposed.

## 3. Recommended ingestion order — PROPOSED, NOT EXECUTED

| Order | Batch (each needs its own §24(5) order + same-session backup) | Content | Why this order |
|---|---|---|---|
| 1 | **batch-2h-002** — owner working preferences | 5–10 owner-typed Type-A notes | Highest personalisation value, lowest risk, zero new machinery, purest O-2H-1 fit |
| 2 | **batch-2h-003** — ratified decisions | ~15 Type-F explicit_instruction entries, each with `source_reference` pointing at its doc section | Makes the decision corpus retrievable without duplicating doc text beyond the ≤512-char summary |
| 3 | **batch-2h-004+** — curated milestones | 10–30 owner-selected milestones | **Blocked on gap 1** (events ingestion) — implement first, separately authorised |
| — | Knowledge-source pointers · bulk history · any importer | — | Each needs its own spec/decision stage; none proposed now |

## 4. Standing constraints on every batch above

O-2H-1 source types `explicit_instruction`/`note` only · owner-entered via the operator CLI · first-party only, no third-party names (D1) · content through D3 · same-session backup (O-2H-6a) · fresh scope-bound owner order naming the batch (§24(5)) · erasure per ratified F14 (suppression) · keep-everything retention (O-2H-3) until decided otherwise.
