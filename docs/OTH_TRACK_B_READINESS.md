# OTH Knowledge — Track B Real-Data Ingestion Readiness

**Status:** CANONICAL — OTH-K3 mission record (2026-08-19)
**Meaning of this document:** the complete real-data ingestion path is
**engineered and fixture-validated**; **real-data validation is
OWNER-BLOCKED** because no authorized owner export exists on any
authorized surface (`docs/OTH_K2_DATA_DISCOVERY.md`). Nothing here
claims real-data validation. Fixture-validated ≠ real-data-validated.

## 1. Source status matrix

| Source | Importer | Fixture validation | Real-data validation |
|---|---|---|---|
| Google Takeout | `lib/importers/takeout.js` (`import-takeout`) | COMPLETE (othk-2) | **OWNER-BLOCKED** — no export exists |
| Gemini export | `lib/importers/gemini.js` (`import-gemini`) | COMPLETE (othk-2) | **OWNER-BLOCKED** — no export exists |
| NotebookLM export | `lib/importers/notebooklm.js` (`import-notebooklm`) | COMPLETE (othk-2) | **OWNER-BLOCKED** — no export exists |
| Google Contacts | `lib/importers/contacts.js` (`import-contacts-metadata`) | COMPLETE (othk-2) | **OWNER-BLOCKED** — real CSVs exist in owner Drive but content transfer from AI sessions is policy-denied; import is operator-local; **content beyond metadata additionally requires an explicit owner policy reversal** (architecture §6.2) |

Each source is an independent source class (`config/source-classes.json`);
artifacts are never merged across classes; Google Contacts is an
independent source, never folded into Takeout even when a Takeout archive
contains a contacts folder (distinct class + policy).

## 2. Per-source contract

Common to all four (enforced in code, tested in
`tests/othk-2-importers-test.js`, 87/0):

- **Source identity:** registered source class + per-import collection;
  `ensureSource` guarantees a source record exists on every path.
- **Provenance:** mandatory on every record — source_class,
  source_reference, captured_at (import time), observed_at (truth time
  from the entry itself, never the import time), parser_version +
  normalizer_version, assertion_class (OBSERVED/EXTRACTED/DERIVED/INFERRED).
- **Timestamps:** truth time ≠ ingest time everywhere; entries without a
  usable truth timestamp are skipped with a reason (never fabricated).
- **Deduplication:** content addressing dedups identical bytes by
  construction; shingle-Jaccard near-dup linking (≥0.95 duplicate_of,
  ≥0.80 possible_duplicate_of) — link-only, never merge/delete; the same
  bytes arriving from a second source produce an `also_present_in`
  relationship, preserving both provenances.
- **Unsupported fields/types:** skipped with a typed reason in the
  import report (`skipped[]`), never silently dropped.
- **Error handling:** malformed shape / non-JSON / bad CSV / oversized
  (>25MB) / over-deep JSON / invalid UTF-8 → typed refusal BEFORE any
  store write.
- **Quarantine:** provenance-audit failures quarantine via a new tagged
  version (idempotent, history intact); quarantined items surface only
  with their state.
- **Re-import/idempotency:** deterministic ids + content addressing make
  re-running an importer over the same input a no-op; changed input adds
  new artifacts alongside preserved originals (tested).
- **Secret gate:** credential-shaped content refused with a typed error;
  only the refusal observation is stored.

Source-specific:

- **Takeout:** directory walk (symlink-refusing), activity entries →
  EXTRACTED `event`s with entry truth time; unsupported file types
  skipped with reason.
- **Gemini:** conversations → events; a conversation without
  `create_time` is skipped, not fabricated; wrong top-level shape
  refused before any write.
- **NotebookLM:** key points → `claim`s `asserted_by: notebooklm:*` —
  model output never becomes fact; claims evidenced to the note
  document with cited sources preserved.
- **Contacts:** **metadata-only** — hashes/counts/column names; zero
  third-party PII persisted, proven by a store-wide assertion; oversized
  CSV refused.

## 3. What unblocks Track B (owner procedure, ready to execute)

| # | Owner/operator action | Then |
|---|---|---|
| 1 | Produce exports: Takeout archive, Gemini export JSON, NotebookLM notes, Contacts CSV (each individually authorized) | — |
| 2 | Ratify the private store location (`docs/PRIVATE_STORE_ARCHITECTURE.md` §1) and provision it (`umask 077; mkdir -p`) | — |
| 3 | On the machine holding the exports, run the §5 import commands of `docs/OTH_KNOWLEDGE_OPERATIONS.md` per source | `validate` after each batch |
| 4 | Record the real-data gate measurements (Phase-8 metrics: source records, imported, rejected, quarantined, duplicates, conflicts, provenance/timestamp coverage, errors — all printed by the import reports + `stats` + `audit`) | re-run one importer to verify idempotent re-import (counts unchanged) |
| 5 | Backup + off-host pull per `docs/PRIVATE_STORE_ARCHITECTURE.md` §6 | restore-verify §7 |

No step requires new code. Every metric in step 4 is emitted by the
existing import reports and `audit()`/`stats()`; no measurement
infrastructure is missing.
