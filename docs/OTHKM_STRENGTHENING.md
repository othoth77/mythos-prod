# OTHKM Strengthening — execution log

Branch: `feat/othkm-strengthening` (isolated clone; not pushed to origin — no operator credentials in this session).
Scope: strengthen OTH-K in place. No production touched, no deploy, no migration of the live store.
Invariants held throughout: append-only, mandatory provenance, trust-aware, claims≠facts, supersession, conflicts, tombstones, deterministic engine (no LLM in the truth path), one-writer-per-noun, secret/PII gate.

> Note: this dedicated log replaces per-phase edits to the 320 KB `docs/AI_HANDOVER.md` (which is production handover history); it keeps the strengthening work legible in one place.

## Baseline (Phase 0)
Full existing OTHK suite green: othk-0 (89), othk-1 (30), othk-2 (97), othk-3 (63), othk-4 (90), othk-5 (44), othk-6 (58), othk-8 (45), othk-9 (36) = **552 assertions, 0 fail**. main @ bd6640a.

## Phase log

| Phase(s) | What changed | Tests | Commit |
|---|---|---|---|
| 1 Protect core · 2 Namespaces | `lib/namespace.js` (global/personal/projects/<slug>); optional `namespace` on records (absent=global); search namespace isolation; invariant regression tests | othk-10: 23/23 | baa80fb |
| 4 Bi-temporal | optional `valid_from`/`valid_to` (event time); derived `expiredAt` (transaction time); `validAt`/`validAndKnownAt`; `suggestValidTo` (invalidate-don't-delete, pure) | othk-12: 17/17 | (this) |
