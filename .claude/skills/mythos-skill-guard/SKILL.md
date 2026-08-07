---
name: mythos-skill-guard
description: Evaluate the permission/automation-level decision (ALLOW/DENY/REQUIRE_APPROVAL/READ_ONLY/DRY_RUN_ONLY) for a proposed skill invocation, before execution, using the existing Mythos permission model — never learning or personalisation.
---

# mythos-skill-guard

## What this skill does

Evaluates: user, role, organisation, domain, skill, action, resource, automation level, data classification, and returns one of `ALLOW | DENY | REQUIRE_APPROVAL | READ_ONLY | DRY_RUN_ONLY`.

**Learning and personalisation may never alter this decision upward.** A learned preference can only request a more restrictive outcome (e.g. asking for `DRY_RUN_ONLY` out of personal caution); it can never turn a `DENY` into an `ALLOW`.

Reuses the automation-level and permanent-approval-boundary model already established for the Automation platform — see `docs/AUTOMATION_APPROVAL_MATRIX.md` — rather than defining a parallel security model.

## Governing documents

`docs/MYTHOS_PERSONAL_INTELLIGENCE_ARCHITECTURE.md` §11, `docs/SKILLS_SECURITY.md`.

Reference implementation (illustrative, not production): `projects/personal-intelligence/reference/guard.js`.

## Source

Classification: MYTHOS ORIGINAL — see `docs/SKILLS_SOURCES.md`.
