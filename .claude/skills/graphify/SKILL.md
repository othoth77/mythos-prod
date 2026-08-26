---
name: graphify
description: OTHMODE Graphify — use the Graphify open-source tool (PyPI graphifyy) for code/project/knowledge/evolution relationship graphs instead of ever building a graph engine; local mode preferred, OTHMODE never depends on it for basic operation.
---

# graphify

## Scope note (MERGE resolution, 2026-08-26)

The Graphify project ships its own Claude skill, installed user-scope on the
production VPS (`~/.claude/skills/graphify`, via `graphify install --platform
claude`, package `graphifyy` 0.9.50, Apache-2.0). That vendor skill is the
IMPLEMENTATION — it builds and queries graphs. THIS repo-scope skill is the
POLICY layer only: it records the OTHMODE boundary rules below and defers all
execution to the vendor skill where installed. The shared name is deliberate
(same capability, two scopes); the overlap audit lives in
`docs/SKILLS_EVOLUTION.md`.

## What this skill does

Applies the approved Graphify decision (Open Source Registry record
"Graphify": `Graphify-Labs/graphify`, PyPI package **`graphifyy`**,
Apache-2.0/MIT dual license, verified 2026-08-26). **Do not build a graph
engine — ever.** When a task needs a relationship graph (codebase structure,
project dependencies, knowledge relationships, evolution lineage):

1. **Check availability:** `graphify --version` (installed per-host via
   `uv tool install graphifyy` or `pipx install graphifyy`). Installation is
   an operator step recorded in the registry with the pinned version.
2. **Build locally:** register with the assistant (`graphify install`), then
   `/graphify .` in the working repository. Graph construction is
   deterministic AST parsing — fully local, no LLM calls for code. Keep any
   doc/PDF semantic extraction pointed at approved providers only.
3. **Query the graph** for the task at hand instead of re-deriving structure
   by grepping, when the graph exists and is current.
4. **If Graphify is not installed** on the current host: say so, proceed
   without it (OTHMODE must never depend on Graphify for basic operation),
   and record the gap — do not hand-build a substitute graph system.

## Boundaries

Graphify is a separate reusable capability, not an OTHMODE component. Its
output is advisory context. Never commit generated graph databases into Git.

## Source

Classification: INTEGRATION — Graphify-Labs/graphify (Apache-2.0/MIT). See
`docs/SKILLS_SOURCES.md` and the Open Source Registry.
Version: 1.0.0 — see `docs/SKILLS_EVOLUTION.md`.
