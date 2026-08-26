# OTHMODE — Audit and Design (Phase 1)

**Date:** 2026-08-25 · **Repository:** `othoth77/mythos-prod` · **Phase:** AUDIT → ANALYZE → DESIGN → DOCUMENT → PREPARE
**Status of this phase:** design only. Nothing was implemented, migrated, deleted, or deployed.

Supporting documents (same directory):
[Architecture](OTHMODE_ARCHITECTURE.md) · [UI Design + Design System](OTHMODE_UI_DESIGN.md) · [Evolution](OTHMODE_EVOLUTION.md) · [Open Source](OTHMODE_OPEN_SOURCE.md) · [Security](OTHMODE_SECURITY.md) · [Roadmap](OTHMODE_IMPLEMENTATION_ROADMAP.md) · [Design preview](preview/index.html)

---

## A. Executive Summary

**English.** OTHMODE will transform the existing MYTHOS AI COMMAND CENTER (`projects/command-center`, live at `ordre.mythosprod.xyz`, internally "MCC-1", referred to as `ordre.mythos`) into `othmode.mythos`: the main control platform for Commands, Saved Commands, Skills, Tools, Accounts/Providers, Projects, Health, Status, Command History, Memory and Evolution. The audit found a **strong, reusable foundation**: MCC-1 is fully implemented (Node + PostgreSQL, 13 tables, 502-assertion test suite, deployed and health-checked), and most OTHMODE modules already exist in the repository as **backend capabilities without a unified UI** — provider registry and routing (mythos-ai-executor, mythos-orchestrator), knowledge/memory (oth-knowledge, activated on the VPS), health monitoring (status-center monitor + hub dashboard), project registry (projects/meta), and 20 Claude skills. What is genuinely **missing** is the Evolution layer (Genes, Capsules, Events, Signals, Selector), Graphify, Search First, a unified Command History, the OthMode ON/OFF switch, and one coherent UI that surfaces all of it. The recommendation is to **adapt MCC-1 as the OTHMODE shell** and connect the existing engines behind it, building new code only where nothing exists (Evolution Memory, Search First policy, registry surfaces). No existing production functionality needs to be deleted.

**العربية (شرح مبسّط).** الفكرة: عندنا اليوم تطبيق اسمه "مركز الأوامر" (ordre.mythos) — مكتبة منظمة للأوامر التقنية، تعمل فعلاً على الخادم. مشروع OTHMODE سيحوّل هذا التطبيق إلى منصّة تحكّم كاملة: الأوامر، المهارات، الأدوات، الحسابات ومزوّدو الذكاء الاصطناعي، المشاريع، صحة النظام، الحالة، سجلّ الأوامر، الذاكرة، والتطوّر المُراقَب. التدقيق أظهر أنّ أغلب القطع موجودة فعلاً في المستودع لكنها متفرّقة وبدون واجهة موحّدة. الأشياء الناقصة فعلاً هي: طبقة "التطوّر" (Evolution)، "البحث أولاً" (Search First)، سجلّ الأوامر الموحّد، وزرّ تشغيل/إيقاف OTHMODE. الخلاصة: لا نحتاج أن نهدم شيئاً — نعيد استعمال الموجود ونبني فقط الناقص. لم يُنفَّذ أي شيء في هذه المرحلة؛ هذه وثيقة تصميم فقط، والتنفيذ يبدأ بعد موافقتك.

---

## B. Current State (what actually exists)

### B.1 Repository facts (verified 2026-08-25)

| Fact | Value |
|---|---|
| Repository | `othoth77/mythos-prod` (GitHub, source of truth per AGENTS.md) |
| Local checkout | `C:\Users\Othman\Desktop\VPS\mythos-prod`, branch `main`, HEAD `3354a7e` |
| origin/main | **51 commits ahead** of the local checkout (through `afd266d`); this audit was performed against origin/main content |
| Local dirt | 2 modified files (`projects/mythos-ai-executor/config/knowledge.json`, `tests/othk-2w-executor-wiring-test.js`) — near-duplicates of content already merged on origin/main (OTHK live activation); safe to discard/fast-forward, decision left to owner |
| Duplicate clone | `mythos-prod-gate/` is a second full clone of the same repo in the workspace (DUPLICATED; presumably gate work) |
| Existing OTHMODE work | **NONE** — zero occurrences of "othmode" anywhere in the repository |
| Production host | OVH VPS `51.68.226.211`; deploy targets `os / panel / ordre / tv` via scoped `sudo mythos-deploy`; `status` PROTECTED (owner-only) |
| CI | `.github/workflows/vps-final-gate.yml` |
| Disk warning | Owner workstation `C:` at 98% (6.1 GB free) — constrains local build work |

### B.2 The two meanings of "ordre" (do not confuse)

1. **`ordre.mythos` = `projects/command-center` (MCC-1)** serving `ordre.mythosprod.xyz` — the Command Center this transformation targets. **In scope.**
2. **`js/ordres-mission.js` + mission-order features** in the legacy Mythos OS production ERP (root `index.html`, `js/`) — French "ordres de mission" for the production-management app. **Out of scope for OTHMODE; must not be touched.**

### B.3 Component inventory and classification

| Component | Where | Classification |
|---|---|---|
| Ordre / Command Center (MCC-1) | `projects/command-center/` — schema (13 `mcc_*` tables), API (25 routes), bearer auth, secret gate, `{{VAR}}` substitution, MAJOR.MINOR versioning, web UI (EN/FR live, AR architecture-ready), seed (24 commands), nginx+systemd deploy, 502-assertion suite | **IMPLEMENTED** (live) |
| Commands / Saved Commands | MCC-1 `mcc_commands`, `mcc_templates`, `mcc_workflows`, favorites, notes | **IMPLEMENTED** (as a library; never executes) |
| Command History | `mcc_usage_events` (copy/render events) + executor `events.log` + orchestrator task state — no unified model | **PARTIALLY IMPLEMENTED** |
| Skills (Claude) | 20 skills in `.claude/skills/mythos-*` (router, guard, evolution, superposer, context-assembler, intent-architect, safe-change, repo-guardian, doc-sync, project-context, project-history, test-intelligence, error-doctor, migration, change-impact, client-360, personal-learning, document/invoice/data-entry intelligence) | **IMPLEMENTED** (docs-as-skills; no registry UI) |
| Skills (executor) | `projects/mythos-ai-executor/skills/` + `config/skills.json` — 5 skills with capability/profile gating | **IMPLEMENTED** |
| Tools | `config/tools.json` (typed tool registry: git.read, filesystem.read, web.search… with policy_class/risk/schemas) + `config/mcp-capabilities.json` | **IMPLEMENTED** (registry; no UI) |
| Accounts / Providers | executor `config/agents.json` + `providers/` (claude-code = execution authority; openai-compat advisory via OmniRoute; gemini advisory, keyless; mock) + `config/router.json` (fallback never crosses execution authority) + orchestrator `providers/{claude,codex}.js` | **IMPLEMENTED** (provider-independent core exists; no UI) |
| Projects | `projects/meta/*.json` — portfolio-registry, project-ledger, development-lanes, stage-templates, test-impact-map, current-context, known-baselines, project-statistics | **IMPLEMENTED** (data files; no UI) |
| Health | origin/main: `projects/status-center/monitor/` (probe engine + systemd timer, DB blind-spot fixes, swap alerting) + `sites/mythosprod.xyz` Hub Dashboard (refuses stale snapshots) + `health.json` per site | **IMPLEMENTED** (recently; no OTHMODE integration) |
| Status | `projects/status-center/` STC-1/STC-2 + `sites/status.mythosprod.xyz` — fail-closed registry, append-only reviews, Arabic layer, live monitoring | **IMPLEMENTED** (owner-protected surface) |
| Memory / Knowledge | `projects/oth-knowledge/` (zero-dep JSONL store, provenance, trust model, dedup, temporal, search, CLI, eval) — **LIVE**: executor read-only boundary ACTIVATED at `/home/deploy/othk-store`; content canon in private repo `othoth77/oth-knowledge` | **IMPLEMENTED** (CLI-only; no UI) |
| Personal memory (MPI) | `projects/personal-intelligence/` — memory engine schema, ingestion, retrieval, context runtime | **IMPLEMENTED** (separate concern; keep separate) |
| Evolution / Genes / Capsules / Evolution Events / Signal Detection / Selector | nowhere | **MISSING** |
| Evolution-adjacent seeds | `mythos-skill-evolution` (skill lifecycle w/ review), `mythos-personal-learning` (observation→candidate→established→rule), status-center append-only reviews | **PARTIALLY IMPLEMENTED** (concepts only) |
| Review | status-center review engine (evidence-verified, append-only) + governance approve (`service/mythos-governance-approve.js`) | **PARTIALLY IMPLEMENTED** (repo/status reviews, not Evolution reviews) |
| Validation | 107+ test files in `tests/`; per-stage gates; MOS-v2 regression gate; VPS Final Gate CI | **IMPLEMENTED** (for existing systems) |
| Git / Rollback | `ops/vps-admin/mythos-deploy` (deploy → health → rollback-on-fail, `.lastgood` SHAs, audit log); orchestrator verifier re-derives claims from Git | **IMPLEMENTED** |
| Graphify | nowhere | **MISSING** |
| Search First | named once in `docs/AI_HANDOVER.md`; no policy, no implementation | **MISSING** |
| Handoff | `docs/AI_HANDOVER.md` discipline + `mythos-project-context` / `mythos-doc-sync` skills | **PARTIALLY IMPLEMENTED** (manual convention) |
| Preflight | AGENTS.md preflight discipline + `mythos-repo-guardian` + `mythos-deploy preflight` + `mythos-os-console/tools/host-preflight.sh` | **PARTIALLY IMPLEMENTED** (scattered) |
| Postflight | not named anywhere; partial behavior via `mythos-safe-change` + `mythos-doc-sync` | **MISSING** (as a named capability) |
| Status Sync | status-center engine reconciles, but manually triggered; registry hand-curated | **PARTIALLY IMPLEMENTED** |
| n8n / Mythos OS integration | 7 workflow JSONs in `projects/mythos-ai-executor/n8n/` (goal intake, task intake, execute, quota watch, failure handler, report, campaign autopilot); n8n runs in Docker on the VPS | **IMPLEMENTED** (boundary already respected) |
| Claude integration | executor headless `claude -p` w/ session resume; MOS Console (`os.mythosprod.xyz`) live chat console; orchestrator delegation | **IMPLEMENTED** |
| Legacy Mythos OS ERP | root `index.html`, `js/`, PHP endpoints, `sites/` | **IMPLEMENTED** (out of OTHMODE scope; static-preserved per origin/main ERP decision) |
| Frontend framework | none anywhere — plain HTML/CSS/JS everywhere | (fact, not a gap) |
| Database | PostgreSQL, one schema per product (`mcc`, MPI, automation control-plane, mythos-core identity) | **IMPLEMENTED** |

---

## C. Ordre Audit — component verdicts

Nothing is deleted or migrated in this phase; these are recommendations only.

| Component | Verdict | Rationale |
|---|---|---|
| `database/schema.sql` (13 `mcc_*` tables) | **ADAPT** | Extend with OTHMODE registries (providers, projects, history, evolution memory). Keep the `mcc` schema and one-writer-per-schema rule; add new tables, never repurpose existing ones. |
| `reference/server.js`, `api.js`, `db.js` | **KEEP** (extend) | Sound zero-framework Node+pg pattern: loopback bind, parameterized SQL only, pinned search_path. New modules add routes, don't rewrite. |
| `reference/auth.js` (bearer roles) | **ADAPT** | Extend role model for new write surfaces (owner/editor/viewer → + operator). Same token mechanism. |
| `reference/secrets.js` (credential-format write gate) | **KEEP** | Cornerstone; must also gate every new OTHMODE write surface (memory notes, evolution evidence, registry entries). |
| `reference/variables.js` (`{{VAR}}`) | **KEEP** | Used as-is by Commands and future capsule/command templates. |
| `reference/versioning.js` (MAJOR.MINOR + snapshots) | **KEEP** | Reuse the pattern for skill/gene/capsule versioning. |
| `reference/web/` (app.js 1583 ln, app.css 761 ln, i18n.js, index.html) | **ADAPT** | Becomes the OTHMODE shell: rebrand, extend nav to modules, ship Arabic (i18n is architecture-ready with per-locale `dir`, fallback chain, and `name_ar` columns already through DB and API). |
| `seed/library.json` + `load.js` | **KEEP** | Idempotent, non-destructive; extend seed with OTHMODE registries later. |
| `deploy/nginx-ordre.mythosprod.xyz.conf` + user service | **ADAPT** | Same pattern; the domain decision (keep `ordre.` vs add `othmode.` host) is an owner decision — see Roadmap open questions. |
| `mcc_workflows` (documented command sequences) | **KEEP** | Documentation workflows, not execution — no conflict with n8n. Label clearly in the UI to preserve the boundary. |
| `mcc_usage_events` | **MERGE** | Into the unified Command History design (Architecture doc §3.9) as one event source among three. |
| README + `docs/MYTHOS_COMMAND_CENTER_ARCHITECTURE.md` | **ADAPT** | Update to the OTHMODE identity at implementation time. |
| MCC test suite (`tests/mcc-1-command-center-test.js`, 502 assertions) | **KEEP** (extend) | Includes source-level no-exec assertions; every new module must keep them green and add its own. |
| `js/ordres-mission.js` + legacy ERP "ordres" | **ARCHIVE** (out of scope) | Different product (mission orders in the ERP). Untouched by OTHMODE. |
| `mythos-prod-gate/` workspace clone | **UNKNOWN** | Plausibly a gate scratch clone; owner to confirm whether it can be removed locally. Not a repo artifact. |
| Local dirty files (2) | **REMOVE** (local only) | Superseded by origin/main; fast-forward local main after owner confirms. |

**REPLACE candidates (by approved open source):** none of the live Ordre runtime needs replacement. Replacement applies to *missing* pieces (Evolution format → GEP; Graphify → existing solution; Search First → existing project) — see [OTHMODE_OPEN_SOURCE.md](OTHMODE_OPEN_SOURCE.md).

---

## D. OTHMODE Gap Analysis

| OTHMODE module | State | Gap |
|---|---|---|
| Commands / Saved Commands | **Complete** (MCC-1) | Rebrand + minor extensions only |
| Command History | **Partial** | Unify `mcc_usage_events` + executor/orchestrator task events into one read model + UI |
| Skills | **Partial** | Two live registries (.claude 20 + executor 5) with no unified registry/UI; approved skills (Preflight, Postflight, Handoff, Status Sync, Search First, Graphify) mostly not first-class |
| Tools | **Partial** | Typed registry exists (executor); no UI, no health link |
| Accounts / Providers | **Partial** | Provider-independent core + router exist; no UI, no account/credential *status* surface (secret values stay outside app data — already true today) |
| Projects | **Partial** | Rich registry data in `projects/meta/`; no UI, not joined to health/status |
| Health | **Partial** | Monitor + hub exist; no OTHMODE view over tools/providers/skills/evolution components |
| Status | **Complete** (Status Center) | OTHMODE must *read* it, never duplicate it (execution truth stays in Status Center) |
| Memory | **Partial** | oth-knowledge live but CLI-only; OTHMODE needs a read-first UI within the existing fail-closed boundary |
| Evolution (Memory, Genes, Capsules, Events, Signals, Selector, Review, Validation, Rollback) | **Missing** | Entire layer; design in [OTHMODE_EVOLUTION.md](OTHMODE_EVOLUTION.md) |
| OthMode ON/OFF | **Missing** | Explicit mode flag consumed by Claude entry points |
| Search First | **Missing** | Policy + registry + skill |
| Graphify | **Missing** | Adopt existing solution (approved) |
| Preflight / Postflight | **Partial / Missing** | Consolidate into two named skills reusing existing checks |
| Handoff | **Partial** | Formalize the existing AI_HANDOVER discipline as a skill |
| Status Sync | **Partial** | Formalize; keep Status Center as the write authority |
| **Duplicate** | `mythos-prod-gate/` clone; two skill registries; three event stores for "what ran" | Consolidation targets, not deletions, in Phase 1 |
| **Incorrect** | None found — but the local checkout staleness (51 behind, dirty) would make any audit run from it misleading; sync before implementation |

## E. Architecture — current vs target

See [OTHMODE_ARCHITECTURE.md](OTHMODE_ARCHITECTURE.md). Summary: the current architecture is a set of correct, independent engines (MCC, executor, orchestrator, oth-knowledge, status-center, meta) with no shared control surface. Target: OTHMODE = MCC-1 shell + read-mostly connectors to existing engines + new Evolution Memory + explicit boundaries (Mythos OS/n8n = execution; Status Center = execution truth; EvoMap = fully out; Claude = provider, primary but swappable).

## F. Product Architecture — all modules

Documented per module in [OTHMODE_ARCHITECTURE.md](OTHMODE_ARCHITECTURE.md) §3 (data owner, read/write paths, UI surface, states).

## G. Evolution Architecture

Documented in [OTHMODE_EVOLUTION.md](OTHMODE_EVOLUTION.md): Evolution Memory from day one (append-only JSONL, oth-knowledge store pattern), Genes (small typed units), Capsules (validated packages), Events (full trace: trigger→signal→candidate→selection→review→validation→result→evidence→version→rollback point), Signal Detection (observe-only first), Selector (KEEP > EXTEND > MERGE > REPLACE > DEPRECATE > CREATE bias), risk-tiered Review (high risk = human approval, mirroring the existing governance-approve pattern), PASS/FAIL Validation, Git as the only rollback mechanism (mirroring `mythos-deploy` lastgood semantics). No EvoMap dependency. No uncontrolled self-modification — enforced by the same principle already live in the executor (AI cannot grant itself the deploy profile).

## H. External Open Source Map

Documented in [OTHMODE_OPEN_SOURCE.md](OTHMODE_OPEN_SOURCE.md): Evolver (architecture reference, not absorbed), GEP (Evolution format), Evolver Claude Code Plugin (integration patterns), Graphify (use as-is), Search-First (basis of the policy), Anthropic Skills + Skill Creator (official structure), Handoff pattern (evaluate against the existing AI_HANDOVER discipline), n8n (stays in the Mythos OS layer). None of these are vendored in the repo today; registry fields are marked TO-VERIFY where data was not observable locally — nothing invented.

## I. UI/UX and J. Design System

Documented in [OTHMODE_UI_DESIGN.md](OTHMODE_UI_DESIGN.md) with the full screen inventory (21 mandated sections consolidated into 12 actual screens), all mandated states (empty/loading/error/success/permission/provider-failure/tool-failure/evolution-failure/responsive), and the target design system derived from the existing MCC token set (light+dark, indigo accent) promoted to `--oth-*` tokens with Arabic/RTL rules. A static, non-functional visual preview is at [preview/index.html](preview/index.html).

## K. Security

Documented in [OTHMODE_SECURITY.md](OTHMODE_SECURITY.md). Current posture is strong (bearer auth, secret write-gate, loopback binds, NoNewPrivileges, scoped sudo, key-only SSH, fail-closed knowledge boundary). Target adds: role split for new write surfaces, evolution approval gates, per-module permission matrix, audit-trail continuity. Standing invariant kept: **AI can never elevate its own permissions.**

## L. Testing

Current: 107+ Node test files, per-stage suites, regression gates, CI Final Gate; MCC alone has 502 assertions incl. no-exec source assertions. Target strategy (per module) in [OTHMODE_IMPLEMENTATION_ROADMAP.md](OTHMODE_IMPLEMENTATION_ROADMAP.md) §7: every new module ships with its own suite in `tests/`, Windows runs happen on an LF clone in a Linux container (known CRLF false-failure gotcha), and the existing suites are the regression floor — the 0-new-failures rule continues.

## M. Implementation Gap (exact work remaining)

1. OTHMODE shell: rebrand MCC web UI, module navigation, OthMode ON/OFF flag + consumption contract.
2. Ship Arabic in i18n (mechanism exists; needs reviewed translations).
3. Registry read surfaces: Providers, Tools, Skills (unified over both registries), Projects (over `projects/meta`).
4. Unified Command History read model + API + UI.
5. Health view: consume monitor/hub outputs; add tool/provider/skill/evolution component states + recovery workflow (DETECT→NOTIFY→SEARCH→COMPARE→SELECT→REPLACE→TEST→UPDATE STATUS).
6. Memory UI over oth-knowledge (read-first, within the fail-closed boundary; ingestion stays on operator CLI).
7. Evolution Memory store + Events/Genes/Capsules data model + read UI (observe-only first).
8. Signal Detection (phase 2+), Selector, Review, Validation runner integration.
9. Skills consolidation: Preflight, Postflight, Handoff, Status Sync, Search First as named skills (KEEP→EXTEND→MERGE first).
10. Search First policy + open-source registry.
11. Graphify adoption.
12. Security extensions (roles, evolution approval), tests per module, deployment config (domain decision).

## N. Implementation Roadmap

Ordered phases in [OTHMODE_IMPLEMENTATION_ROADMAP.md](OTHMODE_IMPLEMENTATION_ROADMAP.md): 0 sync/baseline → 1 shell+identity → 2 registries → 3 history+health → 4 memory UI → 5 evolution memory → 6 signals/selector/review → 7 search-first + graphify → 8 hardening/closure.

---

## OTHMODE AUDIT STATUS

```text
OTHMODE AUDIT STATUS

Repository Audit: PASS
Ordre Audit: PASS
Architecture Review: PASS
Product Design: PASS
UI/UX Design: PASS
Design System: PASS
Evolution Design: PASS
Security Review: PASS
Testing Review: PASS

Current Implementation:
- MCC-1 (ordre.mythos) fully implemented and live at ordre.mythosprod.xyz.
- Provider/tool/skill/project/health/status/memory engines all exist in-repo,
  correct and tested, but disconnected and UI-less.
- No OTHMODE code exists yet. No Evolution layer exists yet.

Approved Target:
- othmode.mythos: MCC-1 adapted as the shell; existing engines connected
  read-first; Evolution Memory from first implementation; Claude primary,
  provider-independent; OthMode ON/OFF; Mythos OS / n8n / Status Center /
  EvoMap boundaries enforced.

Missing:
- Evolution layer (Memory, Genes, Capsules, Events, Signals, Selector,
  Review, Validation UI), Graphify, Search First, unified Command History,
  OthMode switch, registry UIs, shipped Arabic.

Risks:
- Local checkout 51 commits behind origin/main with 2 dirty files —
  implementation must start from a synced baseline.
- Owner workstation C: at 98% (6.1 GB free) — local validation constrained;
  prefer container/VPS validation (existing rule).
- Two skill registries and three event stores invite duplication if not
  consolidated behind one read model.
- Domain decision (keep ordre.mythosprod.xyz vs new othmode host) undecided.
- External projects (Evolver, GEP, Graphify, Search-First) not vendored:
  versions/licenses must be verified at integration time (nothing invented).

Implementation Roadmap:
Phase 0 sync/baseline → 1 shell + identity + Arabic → 2 registries
(providers/tools/skills/projects) → 3 history + health → 4 memory UI →
5 evolution memory (observe-only) → 6 signals/selector/review/validation →
7 search-first + graphify → 8 security hardening, tests, closure gate.

Critical Blockers:
- None technical. Owner decisions required before implementation:
  (1) domain/branding cutover, (2) local baseline fast-forward,
  (3) confirmation of mythos-prod-gate clone purpose,
  (4) Arabic translation review resource.
```
