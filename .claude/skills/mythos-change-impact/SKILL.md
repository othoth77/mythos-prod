---
name: mythos-change-impact
description: Map a proposed change against Mythos's product/schema boundaries (one writer per noun, no cross-schema FKs, product-schema alignment) before the change is made.
---

# mythos-change-impact

## What this skill does

Before an implementation touches a database schema, checks the change against:
- MAD-1 (product-schema alignment) — does this change belong to the schema that already owns this data?
- MAD-3 (one writer per noun) — is another schema already the sole writer for this concept?
- MAD-4 (no cross-schema foreign keys) — is a proposed reference expressed as an opaque ref column with a source comment, not a real FK?

Flags a proposed change that would violate any of the above before it is written, rather than after review.

**Owns the pre-change boundary check; delegates actual migration authoring to `mythos-migration`** once a schema change is approved — see `docs/SKILLS_EVOLUTION.md` §6 for why these are two skills, not one.

## Governing documents

`docs/AUTOMOTIVE_ARCHITECTURE.md` (MAD-1 through MAD-8), `docs/MYTHOS_AI_MULTI_TENANCY.md` §4.

## Source

Classification: MYTHOS ORIGINAL — see `docs/SKILLS_SOURCES.md`.
Version: 1.0.1 — see `docs/SKILLS_EVOLUTION.md`.
