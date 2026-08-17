# Mythos — n8n Instance Strategy (MVP Reuse, Deferred Separation)

**Stage:** MYTHOS-N8N-STRATEGY-0 (owner decision recorded — **binding now**)
**Date:** 2026-08-17
**Status of this document:** Permanent architectural decision record. **No n8n runtime configuration, workflow, service, DNS record or SSANGYONG asset was changed by the stage that created it.**
**Baseline verified against:** commit `2075841` on `main`; local HEAD, `origin/main` and remote HEAD verified identical before the change.

This document is the authority on **which n8n installation Mythos uses and when a second one may exist**. It does not restate n8n's *role*, which is fixed separately and is not reopened here — see `docs/MYTHOS_AI_OPERATING_LAYER.md` §2.2 and `docs/MYTHOS_ORCHESTRATION_CORE.md` §10.

---

## 0. The decision

Owner instruction, recorded 2026-08-17:

### 0.1 Binding rules (now, for the MVP)

1. **The MYTHOS MVP uses the existing n8n installation:**

   ```text
   https://n8n.ssangyong.autos/
   ```

2. **No second n8n instance is created during the MVP.**

3. **Existing SSANGYONG workflows remain untouched and isolated.** They are not
   renamed, re-parented, edited, disabled, re-pointed, or migrated.

4. **MYTHOS workflows are added as a separate MYTHOS workflow group inside the
   existing installation** — additive only, never by modifying a SSANGYONG
   workflow.

5. **n8n is an automation / event adapter only.** Mythos Core remains the
   authoritative orchestration, state and policy layer.

6. **GitHub remains the source of truth** (`othoth77/mythos-prod` · `main`,
   per `AGENTS.md` §2.1). A workflow that exists only inside n8n is not
   delivered work.

7. **`/var/www/ssangyong.autos` and the existing SSANGYONG n8n workflows are
   out of scope of this decision** and must not be modified because of it.

### 0.2 Future target (recorded, NOT authorised, NOT started)

After the first **MYTHOS AI Operating Layer MVP is proven stable**, the MYTHOS
automation layer *may* be separated onto its own instance:

```text
FUTURE TARGET SPLIT (not authorised, not scheduled):

    n8n.ssangyong.autos    →  SSANGYONG automation
    n8n.mythosprod.xyz     →  MYTHOS AI Operating Layer automation
```

**This separation must not be implemented now unless the current MVP requires
it.** Like the repository migration gate (`docs/MYTHOS_REPOSITORY_MIGRATION.md`),
it is a recorded future direction, not an open work item. No agent, session,
workflow or automation may create `n8n.mythosprod.xyz`, provision a second n8n
instance, or reconfigure any service toward one, until this gate is closed by
explicit owner approval.

---

## 1. Rationale

| Reason | Detail |
|---|---|
| **Reuse verified infrastructure** | n8n 2.29.9 is already installed, already reachable over authenticated HTTPS, and already proven end-to-end by the Phase 1 executor chain. The MVP needs automation reach, not a new platform. |
| **Avoid duplicate n8n infrastructure** | A second instance doubles the credential surface, the upgrade burden, the backup surface and the failure modes, and creates two places where "which workflow is live?" can be answered differently — before there is anything to justify it. |
| **Preserve SSANGYONG isolation** | SSANGYONG automation is live production for a separate product. The isolation requirement is satisfied by *not touching those workflows*, which an additive workflow group achieves without a second host. |
| **Defer physical separation until the MVP is proven** | Separation is cheap to do later and expensive to undo early. Splitting hosts before the MVP's real workflow set, credential set and load profile are known would be a guess; splitting after is a migration with known inputs. |
| **Constrain the blast radius of the decision itself** | Reusing an existing installation changes nothing at runtime. Standing up a second one is a deployment, a DNS change and a TLS issuance — all `LEVEL_3_APPROVAL_REQUIRED` class work under `docs/AUTOMATION_APPROVAL_MATRIX.md`. |

---

## 2. What "a separate MYTHOS workflow group" means concretely

- **Naming namespace.** Every MYTHOS workflow is named `MYTHOS — <Name>`. The
  five workflows committed at `projects/mythos-ai-executor/n8n/` follow this
  today: `MYTHOS — Task Intake`, `MYTHOS — Execute Task`,
  `MYTHOS — Quota Watch`, `MYTHOS — Report`, `MYTHOS — Failure Handler`.
- **Definitions live in Git.** The workflow JSON is committed under
  `projects/mythos-ai-executor/n8n/`; n8n holds a copy, never the original.
- **Additive only.** A MYTHOS change never edits, disables or re-points a
  SSANGYONG workflow, and never alters shared instance settings to suit MYTHOS.
- **Credentials by reference.** MYTHOS workflows reference credentials by id.
  No credential value appears in a committed workflow, and MYTHOS never reads
  or reuses a SSANGYONG credential.
- **No shared state.** MYTHOS workflows hold no authoritative state
  (`docs/MYTHOS_AI_OPERATING_LAYER.md` §2.2) — so co-tenancy cannot make one
  product's automation the source of truth for the other's.
- **Import deactivates.** Importing a workflow into n8n leaves it inactive;
  activation is an explicit, separately recorded step, never assumed.

---

## 3. Current state at the time of this decision (from repository evidence)

Recorded from `docs/MYTHOS_AI_EXECUTOR_ARCHITECTURE.md` §2 (Phase 0 inventory)
and the committed tree — **not re-verified against the live host by this
documentation stage**:

| Item | State |
|---|---|
| n8n | 2.29.9, Docker (`/opt/n8n`), SQLite, bound to loopback `:5678`, public via nginx as `n8n.ssangyong.autos` |
| SSANGYONG workflows | 3 — untouched by every MYTHOS stage to date |
| MYTHOS workflows committed to Git | 5, at `projects/mythos-ai-executor/n8n/` |
| `n8n.mythosprod.xyz` | Does not exist. No DNS record, no instance, no configuration |

**Uncommitted at the time of writing:** two further MYTHOS workflow definitions
(`MYTHOS — Campaign Autopilot`, `MYTHOS — Goal Intake (Campaign)`) exist in the
working tree but are **not committed and not delivered**. They are named here
only so this record is not silently contradicted by the next session; per §0.1
rule 6 they are not part of the delivered workflow group until pushed.

---

## 4. What this decision forbids until the gate is closed

- Creating a second n8n instance, container, or stack, for any environment.
- Creating, requesting or configuring `n8n.mythosprod.xyz` (DNS, nginx vhost,
  TLS certificate, or reverse-proxy entry).
- Migrating, exporting-for-migration, or re-pointing MYTHOS workflows off
  `n8n.ssangyong.autos`.
- Modifying, disabling, renaming or re-pointing any SSANGYONG workflow.
- Modifying `/var/www/ssangyong.autos`.
- Changing shared n8n instance configuration (database, auth, resource limits,
  upgrade channel) on MYTHOS's behalf.

A change in any of the above is a separate, explicitly authorised stage — not a
side effect of MYTHOS MVP work.

---

## 5. Conditions for reopening the gate

The separation in §0.2 becomes eligible for consideration only when **all** of
the following hold, and even then requires explicit owner authorisation:

1. The first MYTHOS AI Operating Layer MVP is delivered and demonstrably stable.
2. A concrete driver exists and is written down — resource contention, an
   upgrade-cadence conflict, a credential-isolation requirement, a compliance
   boundary, or an availability requirement one instance cannot meet.
3. The MYTHOS workflow set, credential set and load profile are known well
   enough that the second instance is sized from evidence rather than guessed.
4. A migration plan exists covering DNS, TLS, credential re-provisioning,
   workflow cutover, rollback, and how SSANGYONG stays untouched throughout.

Until then, the correct answer to "should we stand up `n8n.mythosprod.xyz`?" is
**no**, and this document is the reason.

---

## 6. Status

**Binding.** MVP reuse of `n8n.ssangyong.autos` is in force. The separation to
`n8n.mythosprod.xyz` is **recorded, not authorised, not started**.

This document changed no application code, no n8n runtime configuration, no
workflow, and no service state.
