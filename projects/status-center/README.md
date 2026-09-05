# Mythos Status Center — review engine

Stage: **STC-1** (2026-08-20). Surface: `sites/status.mythosprod.xyz/`
(see its README for the product description and tier record).

## Layout

```
lib/model.js      fixed vocabularies, stable-ID rules, fail-closed registry validation
lib/gitfacts.js   read-only git fact collection (allowlisted subcommands only)
lib/engine.js     review reconciliation, evidence verification, comparison,
                  repository discovery, immutable snapshot persistence
bin/review.js     CLI — the [REVIEW NOW] engine
data/registry.json       curated evidence-based inventory (the human/AI-maintained layer)
data/pr-ledger.json      GitHub PR snapshot (refresh when API access exists)
data/repo-snapshot.json  account repository snapshot (drives NEW_DISCOVERY detection)
```

## Running a review

```bash
node projects/status-center/bin/review.js            # reconcile + persist
node projects/status-center/bin/review.js --dry-run  # reconcile only
node tests/stc-1-status-center-test.js               # suite (73 assertions)
```

Outputs land in `sites/status.mythosprod.xyz/`:
immutable `reviews/YYYY/…-review-NNN.json`, `data/current.json`,
`data/reviews-index.json`, `health.json`.

## Rules

- The engine is **read-only** over the repository (git subcommand
  allowlist; no network; no credentials). Sources it cannot check are
  emitted `RECORDED` or `NOT_VERIFIED` — never silently complete.
- Percentages are **calculated from stage lists or absent**
  (`NOT_CALCULABLE`). No number is ever invented, and no single global
  completion percentage exists anywhere in the model.
- Snapshots are **append-only**; the engine refuses to overwrite one.
- A repository present in the account snapshot but absent from the
  classified registry surfaces as `NEW_DISCOVERY` — classification is a
  curation act, never automatic.
- The registry is the curation layer: update it with evidence when
  stages complete, then run a review. An invalid registry fails the
  review closed (`STC_REGISTRY_INVALID`).
- **Discovery is scheduled, curation is not.** The maintenance DAG
  `ops/dagu/maintenance/status-center-review.yaml` runs
  `ops/dagu/bin/mythos-status-center-check` daily: a dry-run review
  (`bin/review.js --dry-run --json`, writes nothing) plus a comparison of
  the served `health.json` with the repository's. Exit 3 = attention: a
  `NEW_DISCOVERY` to classify and/or a stale site to publish with
  `scripts/deploy-status-center.sh` (root). It never persists a review and
  never publishes (`tests/status-center-check-test.js`).
