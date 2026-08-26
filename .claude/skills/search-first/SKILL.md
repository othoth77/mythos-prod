---
name: search-first
description: OTHMODE Search First — before building any new capability, search existing sources in order (this repo → Mythos components → Anthropic Skills → MCP → GitHub/OSS → PyPI/npm → n8n → APIs/templates), record an Adopt/Extend/Compose/Connect/Build verdict with evidence in the Open Source Registry; Build requires proof nothing suitable exists.
---

# search-first

## What this skill does

The fundamental OTHMODE policy: **SEARCH → REUSE → ADAPT → CONNECT → BUILD
LAST.** Adapted from the MIT-licensed `shimo4228/search-first` agent skill
(see the Open Source Registry record), extended with the Connect verdict and
the registry recording step the OTHMODE mandate requires.

**Before building ANY new capability, run this sequence:**

1. **State the need** in one sentence. If you cannot, the need is not ready.
2. **Search, in order, recording each query and best candidate:**
   1. this repository (existing code, `projects/*`, `tools/`, `scripts/`)
   2. existing Mythos components and installed tools/skills
   3. Anthropic Skills
   4. MCP servers/registry
   5. GitHub / open source
   6. PyPI / npm
   7. the n8n ecosystem (execution belongs to Mythos OS)
   8. existing APIs and templates
3. **Evaluate candidates** on fit, license, maintenance, security surface and
   dependency weight — described in words and evidence, never fake numeric
   scores.
4. **Record a verdict:** `Adopt` (use as-is) · `Extend` (grow an existing
   capability) · `Compose` (combine existing pieces) · `Connect` (integrate
   an external solution behind a thin adapter) · `Build` (last resort).
   **Build requires explicit written evidence that nothing suitable was
   found.**
5. **Record the run** in the Open Source Registry
   (`projects/command-center/data/open-source-registry.json`): candidate,
   source, license, maintenance, security, dependencies, verdict, evidence.
   License is verified BEFORE a record may become INTEGRATED. REJECTED
   records are kept — they prevent re-evaluating dead ends.
6. **Feed the Selector:** a found solution biases REPLACE/EXTEND over CREATE
   in any related evolution event (`docs/othmode/OTHMODE_EVOLUTION.md` §7).

## Boundaries

Never add a package because it is popular or because a registry was named in
the request. Add only what closes an actual gap, and never introduce
GPL-family code into incompatible components (the @evomap/evolver record is
the standing example).

## Source

Classification: ADAPTED — from shimo4228/search-first (MIT), extended per the
OTHMODE mandate. See `docs/SKILLS_SOURCES.md`.
Version: 1.0.0 — see `docs/SKILLS_EVOLUTION.md`.
