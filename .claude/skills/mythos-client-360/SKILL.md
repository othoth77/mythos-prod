---
name: mythos-client-360
description: Compose a permission-respecting cross-product view of a client/entity, resolving EntityReferences from multiple product schemas without duplicating their data.
---

# mythos-client-360

## What this skill does

Given an `EntityReference` (`docs/MYTHOS_PERSONAL_INTELLIGENCE_ARCHITECTURE.md` §10), resolves a cross-product view (e.g. a workshop client's vehicle history via ID Auto plus their work orders via Atelier Network) by querying each owning schema through its existing boundary, never by copying or duplicating another schema's data into a new combined store.

Every resolution respects `organisationScope`/`permissionScope` on the reference — see `docs/MYTHOS_AI_MULTI_TENANCY.md` §2.

## Source

Classification: MYTHOS ORIGINAL — see `docs/SKILLS_SOURCES.md`.
