# projects/devx — Mythos Development Acceleration

This directory holds developer-tooling-only artifacts for the DEVX product track (repository orchestration, stage automation, development workflow acceleration). It contains **no product runtime code** and is never reachable by end-user Mythos chatbot instances.

## What lives here vs. elsewhere

| Concern | Location |
|---|---|
| Stage Runner CLI | `scripts/mythos-stage.js` |
| Governance metadata (ledger, statistics, portfolio, current-context, known-baselines, test-impact-map, development-lanes, stage-templates) | `projects/meta/` |
| Deterministic validation tool | `scripts/project-intelligence.js` |
| Agent Development Skills | `.claude/skills/` |
| DEVX architecture/workflow docs | `docs/DEVELOPMENT_ACCELERATION_ARCHITECTURE.md`, `docs/DEVELOPMENT_WORKFLOW.md`, `docs/DEVELOPMENT_TEST_INTELLIGENCE.md`, `docs/DEVELOPMENT_STAGE_TEMPLATES.md` |

This directory is intentionally minimal in DEVX-0 — it exists as the named home for this product track per `docs/ROADMAP.md`, not as a place to duplicate content that already lives in `scripts/` or `projects/meta/`.

## Stage

DEVX-0 — Development Acceleration MVP. See `docs/DEVELOPMENT_ACCELERATION_ARCHITECTURE.md` for the full design and `docs/DEVELOPMENT_WORKFLOW.md` for the short-command contract this stage establishes.
