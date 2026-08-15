# Mythos OS — Infrastructure / Coolify Environment Registry

**Stage:** INF-DEPLOY-AUTO-0 — GitHub → Coolify Staging Delivery Foundation
**Status:** Read-only identity registry. No deployment performed, no Coolify resource created or modified, no credential created or read.

## Purpose

`environments.json` is the repository's declaration of **which Coolify environment is the authorised Mythos staging target**, and which environments must never be one.

It exists because `aut_environments` (`projects/automation/database/control-plane-schema.sql`) is a **draft, undeployed** schema — there is no live automation database to hold the record. This file mirrors that table's column shape exactly, following the precedent set by `projects/infrastructure/cloudflare/domain-inventory.json`: a committed, machine-readable, non-secret record of observed infrastructure identity.

## What is and is not in this file

**Present:** project name, environment name, environment UUID, `is_production`, `enabled`, `risk_class`, observed application counts, and the bound application (currently `null`).

**Absent, permanently:** API tokens, passwords, connection strings, private keys, or any other credential. Coolify UUIDs are opaque resource identifiers — the same class of value `aut_environments.environment_id` is documented to hold ("stable opaque external id") — and grant no access on their own. Adding a credential-bearing field to this file violates `docs/AUTOMATION_SECURITY_AND_SECRETS.md` §4 and must be rejected in review.

## How it was observed

A read-only `SELECT` of identity columns from the Coolify control-plane database: project name, environment name and UUID, application UUID/name/status, and per-environment resource counts. No write, no deployment API call, and no credential value was read or printed.

## This file authorises nothing

It records identity. It does not enable a connector, set a feature flag, grant a capability, or approve a deployment. The `staging-deployment-executor.js` gates are unchanged and still apply in full — in particular the **two-source proof**: the declared record here must be corroborated by the platform's own reported environment at deployment time, and any disagreement is a refusal. Editing `environment_key` or `is_production` here cannot make a production environment deployable.

## Current state (INF-DEPLOY-AUTO-0)

| Project | Environment | `is_production` | Applications | Deployment target? |
|---|---|---|---|---|
| darhijama | **staging** | `false` | **0** | authorised environment, but **no application exists in it yet** |
| darhijama | production | `true` | 1 | never — excluded on two grounds |
| notrejour | production | `true` | 1 | never — unrelated project, out of scope |

The staging environment is real and independent (it is not a relabelled production environment), but it is **empty**. Creating an application inside it is an operator action outside this stage's scope, so no deployment target exists yet and `bound_application_id` remains `null`.
