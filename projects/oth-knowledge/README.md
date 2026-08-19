# oth-knowledge — knowledge operating layer (implementation)

Provider-agnostic knowledge operating layer for the Mythos ecosystem.
Canonical architecture and decisions: `docs/OTH_KNOWLEDGE_ARCHITECTURE.md`.
The engineering-memory *content* canon remains the standalone private
repository `othoth77/oth-knowledge` (see `/oth-knowledge/README.md`).

Zero dependencies, plain Node ≥ 18. No network, no database, no daemon.

## Layout

```
lib/            model, ids, store (append-only JSONL + content-addressed objects),
                provenance, normalize, ingest, extract, conflict, search, seed, api,
                dedup, temporal, audit, knowledge-service (AI-layer boundary)
lib/importers/  takeout, gemini, notebooklm, contacts (metadata-only) — versioned parsers
config/         source-classes.json — closed source-class registry with per-class policy
cli/            othk-cli.js — ingest / import-* / seed / search / export / validate / stats
seeds/          reviewed structured knowledge (infrastructure verification 2026-08-19)
fixtures/       synthetic test/eval corpus (no real personal data)
eval/           reproducible retrieval evaluation set + runner + store benchmark
data/           default store root at runtime — never committed
```

Related canon: `docs/OTH_KNOWLEDGE_ARCHITECTURE.md` (model + decisions),
`docs/OTH_KNOWLEDGE_INTEGRATION.md` (AI Operating Layer boundary),
`docs/OTH_KNOWLEDGE_OPERATIONS.md` (backup/restore/import/deploy),
`docs/OTH_K2_DATA_DISCOVERY.md` (real-data evidence table).

## Quick start

```bash
node cli/othk-cli.js --store /path/to/kb seed seeds/infrastructure-2026-08-19.json
node cli/othk-cli.js --store /path/to/kb ingest notes.md --class manual
node cli/othk-cli.js --store /path/to/kb search "rsync windows" --mode hybrid --kind fact
node cli/othk-cli.js --store /path/to/kb validate
node eval/run-eval.js          # measured retrieval quality report
```

## Tests

```bash
node tests/othk-0-knowledge-core-test.js   # model/store/provenance/ingest/conflicts/seed
node tests/othk-1-search-test.js           # retrieval + measured evaluation thresholds
```

## Guarantees

- Originals preserved: artifacts are content-addressed and never modified.
- Provenance mandatory on every knowledge-bearing record; hits carry it.
- Contradictions never silently overwrite — explicit conflict records with
  resolution state; corrections are new versions, history stays readable.
- Credential-shaped content is refused at ingest (pattern name recorded,
  content never stored). Do not point the CLI at secret material.
- `google-contacts` and unclassified external providers are
  `metadata-only` (fail-closed) pending explicit owner decisions.
