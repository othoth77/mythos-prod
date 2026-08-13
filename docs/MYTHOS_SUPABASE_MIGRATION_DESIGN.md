# Mythos — Supabase / PostgreSQL Migration Design

**Status: DESIGN ONLY.** Nothing was installed, created, configured or migrated.
Written 2026-08-13 against checkpoint `95d3b3a4c664ebe10c99dd569481bc34ffabc171`.

**This document does not restate the `mythos_intelligence` schema.** That design
is already ratified and lives in:

- `projects/personal-intelligence/database/control-plane-schema.sql` — 15 `pi_` tables (MPI-0, ratified)
- `projects/personal-intelligence/database/memory-engine-schema.sql` — 5-table delta (MPI-2, draft, **not applied**)
- `docs/MYTHOS_MEMORY_ENGINE_ARCHITECTURE.md` — storage decision, boundary, retrieval contract, backup gate
- `docs/MYTHOS_PERSONAL_INTELLIGENCE_ARCHITECTURE.md`, `docs/MYTHOS_CONTEXT_ARCHITECTURE.md`, `docs/MYTHOS_USER_MEMORY_POLICY.md`

Duplicating those here would create two sources of truth for one schema. This
document adds only what they do not cover: **whether Supabase fits, and how a
migration would be staged.**

---

## 1. Current PostgreSQL inventory (verified, not inferred)

| | `idauto-postgres` | `coolify-db` |
|---|---|---|
| Image / version | `postgres:15-alpine` · **15.18** | `postgres:15-alpine` · **15.18** |
| Databases | `idauto`, `postgres` | `coolify`, `postgres` |
| Schemas | 1 — `public` | 1 — `public` |
| Tables | **24** | **66** |
| Rows | **2,551** (stable) | 21 (**volatile** — `sessions` churns; not an invariant) |
| Size | 11 MB | 24 MB |
| Extensions installed | **`plpgsql` 1.0 only** | **`plpgsql` 1.0 only** |
| Login roles | `idauto` | `coolify` |
| Volume | `idauto-postgres-data` | `coolify-db` |
| Application | ID Auto | Coolify control plane |
| Classification | **production** | **production** (infrastructure) |

**No other PostgreSQL instance exists.** Also present and in scope for security
but not for this migration: MySQL 8.4 `darhijama_prod` (39 InnoDB tables,
1.48 MB, production) and its staging twin, plus six Redis containers (transient).

`mythos_intelligence` — **database 0, schema 0, `pi_` tables 0** on both
instances. It has never been created.

---

## 2. `mythos_intelligence` — already designed, not restated

The ratified decisions, carried forward unchanged:

- **A schema, not a separate database.** MPI-0 chose the schema boundary; a second database adds a pool, backup target and restore procedure against a failure mode the boundary already contains.
- **No cross-schema foreign keys.** Isolation, independent migrations, own ownership and grants, selectable backup.
- **`pgvector` deferred and forbidden at v1.** Relational + native full-text search, chosen because it is deterministic and therefore testable.
- **No external model provider.**
- **Separation from `idauto`:** different schema, different owner role, and — critically — **the ID Auto dumps do not contain it.** Any `mythos_intelligence` backup is a separate target with its own `pg_dump --schema=mythos_intelligence`.
- **Separation from `coolify-db`:** unrelated concern entirely; Coolify holds deployment topology and must never host application data.

**Still blocked on owner decisions D1–D5** (raw third-party personal data; whether MPI may originate entities; where memory *content* lives; disputed-fact resolution; where MPI backups go). MPI-2A cannot start until D1, D2 and D3 are answered.

## 3. `pi_*` — 20 tables already specified

**Existing data:** none. Zero `pi_` tables exist anywhere.
**Planned migration data:** none — nothing is being moved into `pi_*`; it is new application data by construction.
**New application data:** all of it, written by MPI capture/retrieval once MPI-2A lands.

Ratified (15, `control-plane-schema.sql`): `pi_users`, `pi_organisations`, `pi_sessions`, `pi_domains`, `pi_domain_capabilities`, `pi_user_domain_access`, `pi_capability_runtime_status`, `pi_context_packages`, `pi_guard_decisions`, `pi_feedback_events`, `pi_memory_records`, `pi_learned_preferences`, `pi_preference_audit`, `pi_entity_references`, `pi_knowledge_sources`.

Draft delta (5, `memory-engine-schema.sql`, **not applied**): `pi_memory_provenance`, `pi_memory_conflicts`, `pi_memory_tombstones`, `pi_memory_tags`, `pi_memory_events`.

The boundaries are settled. **No new table is proposed here** — proposing more before D1/D2 are answered would prejudge exactly the decisions those gates protect.

---

## 4. Supabase compatibility — the finding that shapes everything

### The blocking technical fact

The running image is stock `postgres:15-alpine`. Supabase's platform services depend on extensions that **are not present and not obtainable** in it:

| Extension | Purpose | Available here? |
|---|---|---|
| `pgjwt` | JWT signing for GoTrue/PostgREST | **NO** |
| `pg_graphql` | GraphQL endpoint | **NO** |
| `pgsodium` | Transparent column encryption | **NO** |
| `supabase_vault` | Secret storage | **NO** |
| `vector` | Embeddings | **NO** (also *deliberately deferred* by MPI-2) |
| `pg_net`, `pg_cron`, `pgaudit` | Async HTTP, scheduling, audit | **NO** |
| `pgcrypto`, `uuid-ossp`, `pg_stat_statements` | — | available, not installed |

**Adopting Supabase therefore means replacing the PostgreSQL image with `supabase/postgres`** — that is a production database migration with downtime, not a configuration change. PostgreSQL 15.18 is version-compatible with Supabase's 15.x line, so the *data* moves cleanly; the *platform* does not bolt on.

### The disk fact

Self-hosted Supabase is roughly ten containers (db, auth, rest, realtime, storage, imgproxy, meta, functions, analytics, kong). The VPS has **4.6 GB free at 94%**, with Docker images already at 17.27 GB. **There is not room to self-host Supabase today.** Reclaiming image space is possible but must not be assumed.

### What Supabase would actually give this platform

Honestly assessed, most of it duplicates something Mythos already has or has deliberately rejected:

| Supabase capability | Fit |
|---|---|
| **Auth (GoTrue)** | **The one genuine gap.** IDA-2E is BLOCKED precisely because "no Mythos identity service exists". GoTrue would fill it |
| PostgREST auto-API | **Conflicts.** Mythos routes through capability contracts and a permission guard; a table-level auto-API bypasses `pi_guard_decisions` |
| Row Level Security | Useful and adoptable **independently of Supabase** — plain PostgreSQL RLS |
| Realtime | No current requirement |
| Storage | Object storage is genuinely needed — but for **backups**, and that need is provider-neutral |
| Edge Functions | No current requirement |
| `pgvector` | **Explicitly forbidden at v1** by the ratified design |

**Recommendation: do not adopt Supabase as a platform.** Take the two pieces that are real needs — an identity service and RLS — and evaluate them on their own merits. RLS needs no Supabase at all. Identity can be evaluated against GoTrue standalone, Keycloak, Authentik or Zitadel without importing nine other services, an image replacement and a GraphQL surface nobody asked for.

If Supabase is nonetheless chosen, **Supabase Cloud is the wrong shape here**: it moves `idauto` personal data off-premises to a third party while no backup, no restore test and no data-processing decision exist. Self-hosting is the only variant compatible with the current governance, and it is disk-blocked.

### Migration risks

1. Image replacement on a production database — downtime, and rollback needs a verified dump *that we cannot yet store off-host*.
2. PostgREST auto-API silently bypassing the capability/permission model.
3. `pgsodium`/`vault` introducing a second secret store beside the approved one.
4. GoTrue owning `auth.users` creates a second identity source unless `pi_users` is explicitly subordinated to it.
5. `vector` becoming available makes it tempting, re-opening a closed decision.

---

## 5. Staged migration plan — no command below has been executed

| Stage | Source | Destination | Tool | Validation | Rollback |
|---|---|---|---|---|---|
| **A — schema preparation** | `control-plane-schema.sql` + delta | scratch PG 15 container | `psql -f` into throwaway instance | schema applies clean; parens balanced; no `ALTER`/`DROP` on existing objects; 20 `pi_` tables present | discard the container — production never touched |
| **B — non-sensitive development data** | synthetic fixtures only | scratch instance | fixture loader | retrieval contract honoured; permission filter precedes ranking; deterministic ordering | truncate scratch |
| **C — application integration** | MPI-1 context runtime | scratch instance | app config pointing at scratch | targeted suites green; `loadAllUserMemory()` still absent | revert config; no data moved |
| **D — production migration** | scratch-validated schema | `idauto-postgres`, new schema `mythos_intelligence` | `psql -f` as a dedicated owner role | schema created; **zero** change to the 24 `idauto` tables / 2,551 rows | `DROP SCHEMA mythos_intelligence CASCADE` — safe *only* because no other schema references it (no cross-schema FKs) |
| **E — validation** | production | — | `pg_dump --schema=mythos_intelligence` + restore into scratch | round-trip restores; counts match; `idauto` untouched | none required (read-only) |
| **F — rollback** | verified off-host dump | scratch, then production | `pg_restore` | restored counts match the dump's manifest | **requires C-gate below** |

**Stage D must not run before the backup gate closes.** Stages A, B and C touch nothing but a throwaway container and can proceed at any time — they are the productive work available today.

---

## 6. Security classification

| Data | Location | Class | May enter GitHub? |
|---|---|---|---|
| `idauto` observations, vehicles, plates, submissions, audit log | `idauto-postgres` | **Personal / third-party** | **NEVER** |
| `darhijama_prod` application data | MySQL 8.4 | **Client business data** | **NEVER** |
| Coolify deployment topology | `coolify-db` | **Infrastructure** | **NEVER** (reveals architecture) |
| OAuth client secrets | PC only — 2 files, excluded at source | **Secret** | **NEVER** |
| CIN, RIB, client records, live data backup | 18 files, `VPS_TRANSFER` only | **Personal / financial** | **NEVER** |
| Application secrets, `.env` real values | env vars / Coolify | **Secret** | **NEVER** |
| `mythos_intelligence` future content | not yet created | **Personal, incl. third parties** | **NEVER** |
| Schema DDL, architecture docs, `.env.example` templates | repository | Design | yes — already there |
| The 14 migrated project repos | GitHub | Source/design | yes — **private**, verified secret-free |

**Rule:** nothing that is a *row* ever enters Git. Schemas and design do; data does not. `.env.example` files are safe only while every value is a placeholder — verified true today.

---

## 7. Backup gate — binding

**SUPABASE / `mythos_intelligence` PRODUCTION MIGRATION (Stage D and later) MUST NOT START until all five hold:**

| | Condition | Status 2026-08-13 |
|---|---|---|
| **A** | Off-host backup exists | **BLOCKED** — no destination; Coolify `s3_storages` 0 rows; no client, no credentials |
| **B** | SHA-256 verification passes | **PASS locally** — both dumps verified; unproven across a transfer |
| **C** | Restore-from-**off-host** test passes | **BLOCKED** — local restore PASS; off-host round-trip never run |
| **D** | PC-DECOMMISSION-GATE closed | **OPEN** — G1/G2/G9 need PC-side data |
| **E** | Final VPS project inventory reconciled | **PASS** — 14 projects, 1,387 tracked files, all private and remote-verified |

Two of five pass. **A and C are one input away** (an object-storage account, bucket, scoped key). **D needs the `pc-audit.ps1` output.**

Stage D creates the first durable personal-data store this platform has ever had. Doing that before a restore-from-off-host test has ever succeeded would be the single riskiest step in the whole programme.
