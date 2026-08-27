# IDauto — Finalization Audit (2026-08-26)

**Ordered by:** owner (OTHMODE ordre d'exécution final — "terminer IDauto de bout en bout").
**Performed from:** `othoth77/mythos-prod`, branch `claude/idauto-finalization-9866s0`, in a
remote execution container. **Read-only toward `othoth77/idauto`** — this session's GitHub
credentials cover `othoth77/mythos-prod` only; the canonical IDauto repository was cloned
anonymously (it is public) and audited by real execution, but nothing could be pushed to it
and no PR there could be merged from here.

**Method:** SEARCH FIRST honoured — nothing was built. Every claim below was re-derived from
the actual repositories and from live test execution in a fresh environment (clean clone,
`npm install` from the published lockfile, fresh PostgreSQL 16.13 database, schema +
migrations + synthetic seed), not from prior documentation.

---

## 1. Where IDauto actually is

IDauto does **not** live in this repository. It was extracted on 2026-08-18 to the canonical
repository **https://github.com/othoth77/idauto** and the duplicated tree here was removed by
IDA-DECOUPLE-4 on 2026-08-19 (`docs/IDAUTO_STANDALONE_MIGRATION.md`). Mythos consumes only
the digest-pinned protocol vocabularies at `projects/mythos-core/contracts/idauto/`.

State of `othoth77/idauto` at audit time:

| Ref | Commit | State |
|---|---|---|
| `main` | `0044d57` | Contains merged PRs #1–#5: migrated baseline, protocol vocabularies, IDA-4 readiness audit, IDA-4 gate-free foundation (IVID library, passport assembly, threat model), gate-closure (legal matrix L01–L16 + readiness recheck) |
| `ida4-option-c` (PR #6 — **MERGED 2026-08-26**, `33557f0`; state below is as audited on the open branch) | `615f11a` | Option C implementation: IVID issuance, `GET /public/passport/:ivid` (IVID-only, no plate path, no PII), authenticated `GET /api/passport/:ivid`, rate-limit bucket + kill-switch, SQL `access_scope='public'` defense-in-depth, fact-key deny-list. Opus review APPROVE-WITH-FINDINGS with all 11 findings fixed on the branch; revised A5-PLATE owner ruling implemented. `main` is fully contained in it — **no merge conflict** |

## 2. Test verification — executed first-hand (2026-08-26)

Fresh PostgreSQL 16.13, `database/schema.sql` + `ida-3a-ingestion-schema.sql` + synthetic
seed applied clean; media root fresh.

**`main` @ `0044d57` — 15 suites, 812 assertions, 0 failures:**
ida-2a 44 · ida-2c 26 · ida-2d 39 · ida-2f 32 · ida-2g 17 · ida-2h 37 · ida-3a 47 ·
ida-3b 67 · ida-3c 63 · ida-3d 73 · ida-3e 48 · ida-3f 35 · ida4-foundation 130 ·
storage-ops 73 · identity-conformance 81.

**`ida4-option-c` @ `615f11a` (+ its `ida4-option-c-ivid.sql` migration) — 16 suites,
941 assertions, 0 failures:** the 15 above (ida-3d rises to 74) + ida4-option-c 128.

**Mythos-prod side, same session:** `mythos-identity-core-0-contract` **157/0** against the
pinned artifacts; othk-0 **89/0** · othk-1 **30/0** · othk-2 **97/0** · othk-2w **42/0** ·
othk-3 **63/0**; **MOS-v2 regression gate PASS**. Protocol pins verified **byte-identical**
(sha256) between `projects/mythos-core/contracts/idauto/` and the artifacts on both idauto
refs.

## 3. OTH-K2 — the ordre's named priority

The ordre names "Executor-side knowledge-service wiring" as the last open Track A item.
**That premise is stale.** OTH-K2 (PR #43), OTH-K2-W executor wiring (PR #44) and OTH-K3
were completed 2026-08-19, and the on-host live gate passed on the production VPS on
2026-08-22 (`othk-live-gate --require-live` → LIVE PASS 52/0, handover OTHK-PROD-VERIFIED).
Re-verified green in this session (suites above). **Nothing repository-executable remains
on Track A.** Track B (real owner-data imports) is OWNER-BLOCKED: it needs owner exports
and private-store provisioning (`docs/OTH_TRACK_B_READINESS.md`), which no repository work
can substitute.

## 4. Dependency & license inventory (idauto)

Root license: **Apache-2.0**. Runtime dependency tree = `pg` + 13 transitives, from the
published lockfile:

| package | version | license | class | direct |
|---|---|---|---|---|
| pg | 8.23.0 | MIT | Preferred | direct |
| pg-cloudflare 1.4.0 · pg-connection-string 2.14.0 · pg-pool 3.14.0 · pg-protocol 1.16.0 · pg-types 2.2.0 · pgpass 1.0.5 · postgres-array 2.0.0 · postgres-bytea 1.0.1 · postgres-date 1.0.7 · postgres-interval 1.2.0 · xtend 4.0.2 | — | MIT | Preferred | transitive |
| pg-int8 1.0.1 · split2 4.2.0 | — | ISC | Preferred | transitive |

No GPL/AGPL/SSPL/BSL, no review-required license, no unmaintained package in the tree. No
new dependency was needed or introduced. Cryptography: none hand-rolled — IVID check symbols
are a Crockford base32 checksum (pinned vectors, independently reimplemented in tests), not
a security primitive; real authentication is deliberately deferred to IDA-7 on W3C DID/VC
standards rather than built ad hoc (see §6).

## 5. IDA-4 gates — recomputed on real state

From `docs/IDA4_READINESS_AUDIT.md` on `ida4-option-c`, re-checked against the code:

| Gate | Status | Evidence |
|---|---|---|
| A — Real authentication | **BLOCKED → IDA-7** | No user table, no credential store by design; admin bearer stub is test-guarded as "not authentication". A5 owner decision **DECIDED**: Option C (zero-account surface) approved |
| B — Legal review | **BLOCKED (external)** | L01–L16 all **OPEN** in `IDA4_LEGAL_GATE_MATRIX.md`; zero legal evidence on file; counsel package ready (`IDA4_LEGAL_REVIEW_PACKAGE.md`) |
| Citizen-facing write path | **NOT STARTED (by rule)** | Requires A + B; prohibited until then |
| QR / IVID public resolution | **IMPLEMENTED — PR #6 merged 2026-08-26; deployed per IDA-SHIP-1** *(updated 2026-08-27)* | 128/0 suite; IVID-only, plate never resolvable anonymously |
| Ownership transfer / fraud controls | **NOT STARTED** | Later IDA stages |
| Erasure / tombstone | **SPECIFIED, not implemented** | Recorded in legal package |
| Audit trail | **DONE** (write API) | ida-2d 39/0 atomic audit logging |
| Backup | **DONE** *(updated 2026-08-27)* | Off-host backup code + gate 35/0 (R2/SigV4); **restore proven on the host 2026-08-26 18:55 UTC** (mythos-prod `4d71bee`): 73/73 objects sha256-verified, `idauto` dump byte-identical to source; `BLOCKER-BACKUP-RESTORE-UNPROVEN` closed on evidence |
| Public API | **NOT DEPLOYED** | `PUBLIC_ENDPOINT_READY_TO_IMPLEMENT = NO` |

`CITIZEN_FACING_IDA4_READY` = **NO** — unchanged, and correctly so: it is gated on legal
evidence and pre-public review, not on engineering volume.

## 6. FINAL AUDIT (per the ordre's §13 grid)

| Item | Verdict | Evidence |
|---|---|---|
| CORE | **DONE** | IDA-0…IDA-3F merged on idauto `main`; 812/0 clean-clone |
| IDENTITY | **DONE** (boundary) | identity-conformance 81/0; pins byte-identical; mythos contract 157/0 |
| IVID | **DONE on PR #6** | ivid.js pinned vectors + issuance + migration; foundation 130/0, option-c 128/0 |
| PROTOCOL | **DONE** | vocabularies v1 published + digest-pinned both sides |
| DATABASE | **DONE** (schema/migrations/constraints, verified by clean apply) — IVID migration applies clean |
| KNOWLEDGE SERVICE | **DONE** (OTH-K1..K3, production live gate 52/0) — Track B OWNER-BLOCKED |
| EXECUTOR | **DONE** | othk-2w 42/0; fail-closed config, read-only allowlist |
| OTHMODE | **DONE** | per-command activation live (PRs #85–#87); suites green |
| AUTHENTICATION | **BLOCKED → IDA-7** | deliberate: W3C DID/VC primitives; no homemade crypto; Option C removes the account requirement for the approved public sub-surface |
| SECURITY | **PARTIAL** | threat model + Opus review + deny-list/rate-limit/kill-switch on PR #6; no SBOM/CI vulnerability scanning in idauto yet (1 direct dep, all-MIT/ISC tree audited manually this session) |
| BACKUP | **DONE** *(updated 2026-08-27)* | code + off-host gate green; **restore proven on the host** — mythos-prod `4d71bee` (2026-08-26 18:55 UTC, after this audit's first pass): `mythos-backup-run.sh restore-test` as deploy, exit 0, 73/73 objects sha256-verified incl. the `idauto` PostgreSQL dump byte-identical to source. BLOCKER-BACKUP-RESTORE-UNPROVEN closed on evidence |
| API | **DONE for the authorised scope** *(updated 2026-08-27)* | IDA-2C/2D + private ingest + public passport surface — PR #6 merged; citizen UI shipped (PR #7, IDA-SHIP-1); V1 personal keyless surface merged (PR #9, 2026-08-27) |
| TESTS | **DONE** | 941/0 on PR #6 head; 0 unexplained skips; vacuity-guarded (§4 vacuity gap closed by 350792b; fixture-emptiness guards present) |
| MOS-v2 | **PASS** | this session |
| IDA-4 | **PARTIAL** | gate-free foundation + Option C implemented; citizen-facing NO |
| LEGAL GATES | **BLOCKED (external)** | L01–L16 OPEN; owner/counsel action |
| PRODUCTION READINESS | **NOT READY** | nothing deployed (IDauto); restore now proven (`4d71bee`); deployment authorization still an owner gate |

## 7. Category separation (ordre §16)

- **ENGINEERING COMPLETE** — **YES for the authorised scope** *(updated 2026-08-27)*:
  PR #6 was merged on 2026-08-26 (`33557f0`), followed by the citizen Design System UI
  (PR #7), the production runbook (PR #8, IDA-SHIP-1) and the owner-ordered V1 personal
  keyless surface (PR #9, merged 2026-08-27 — 17 suites / 1293 / 0, browser QA 64/0).
- **PRODUCTION READY** — **NO**: no IDauto deployment, no SBOM/vuln CI; the restore test
  is now proven (`4d71bee`, 2026-08-27 update) and no longer blocks.
- **CITIZEN-FACING READY** — **NO**: legal gates L06/L07/L09/L16 (and 12 more) OPEN;
  pre-public review not performed. This is a legal/owner boundary, not an engineering one.

## 8. Remaining blockers — every one external to this session

1. ~~Merge idauto PR #6~~ — **CLOSED**: merged 2026-08-26 (`33557f0`), followed by
   PRs #7/#8/#9 (citizen UI, ship runbook, V1 personal keyless surface).
2. **Legal review** — counsel answers L01–L16 from the prepared package (blocks any
   citizen-facing surface; four items block IDA-4 directly).
3. ~~Host restore test~~ — **CLOSED 2026-08-26** on the host (mythos-prod `4d71bee`): real
   restoration succeeded and was independently checksum-verified.
4. **OTH Track B** — owner data exports + private-store provisioning.
5. **Deployment authorization** — IDA-2 Phase B / Option C deployment is explicitly not
   authorised; owner decision.
6. *(Recommended, small)* add SBOM + `npm audit`/osv CI to idauto — ~half a day, can ride
   the next idauto PR.

**Estimated remaining engineering time** (excluding legal/owner wait): merge + post-merge
regression ~1h · SBOM/vuln CI ~0.5d · deployment of the approved Option C surface once
authorised ~1–2d incl. smoke tests and restore proof.

## 9. OTHMODE contract note

This command ran under OTHMODE (keyword present). Off-host, the OTHMODE evolution API and
Memory endpoints are not reachable without production credentials, so no evolution event
could be recorded from this container; this audit document is the durable outcome record
instead. Search First verdict for the entire ordre: **REUSE/CONNECT — nothing built**; no
new dependency introduced anywhere.
