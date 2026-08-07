---
name: mythos-migration
description: Plan PostgreSQL migrations for a Mythos product schema consistent with this repository's existing draft-schema conventions — draft-only unless explicitly authorised to deploy.
---

# mythos-migration

## What this skill does

When a database schema change is needed, follows the pattern already established across `projects/*/database/control-plane-schema.sql`:
- BIGSERIAL internal PK + stable opaque external id column,
- TIMESTAMPTZ (UTC) timestamps,
- no cross-schema foreign keys — opaque ref columns with a source comment instead,
- no secret-value columns,
- no raw PII columns,
- header comment stating exact table count and DRAFT/NOT DEPLOYED status until explicit authorisation exists to provision it.

**Never executes a migration or installs a database without explicit authorisation for that specific stage** — see AGENTS.md §41/§51 equivalents in `docs/AUTOMATION_ARCHITECTURE.md` and this repository's repeated "draft only, not deployed" convention.

## Source

Classification: MYTHOS ORIGINAL — see `docs/SKILLS_SOURCES.md`.
