# OTHMODE — Implementation Roadmap

Phase 1 design — EXECUTED 2026-08-26 (owner implementation order). Phases 0-5 delivered plus the manual stage of Phase 6 and the skills/registry work of Phase 7; see [OTHMODE_FINAL_AUDIT.md](OTHMODE_FINAL_AUDIT.md) for the exact state of each item.
Master document: [OTHMODE_AUDIT_AND_DESIGN.md](OTHMODE_AUDIT_AND_DESIGN.md)

**بالعربية باختصار:** خطة التنفيذ مرتّبة على مراحل صغيرة، كل مرحلة تُختبر وتُوثَّق وتُغلق قبل التالية — نفس أسلوب العمل المعتمد في المستودع. قبل البدء نحتاج قراراتك المذكورة في آخر الوثيقة.

---

## Phase 0 — Baseline (prerequisite, ~small)
- Fast-forward local `main` to origin/main; resolve the 2 dirty files (superseded); confirm `mythos-prod-gate/` purpose.
- Freeze baseline SHA; run existing suites in the LF Linux container → recorded 0-failure floor.
- Owner decisions collected (§Open questions).

## Phase 1 — OTHMODE shell + identity
- Rebrand MCC web UI to OTHMODE (`--oth-*` tokens, wordmark, grouped sidebar per [OTHMODE_UI_DESIGN.md](OTHMODE_UI_DESIGN.md)).
- OthMode ON/OFF flag + Settings screen + consumption contract text in CLAUDE.md/executor prompt template.
- Ship Arabic locale (mechanism exists; reviewed translations required).
- Exit gate: MCC suite green + new shell tests; ordre target still healthy.

## Phase 2 — Registry read surfaces
- `/api/skills` (unified over `.claude/skills` + executor registry), `/api/tools`, `/api/providers` (non-secret), `/api/projects` (over `projects/meta`). Read-only.
- Screens 4–7. Exit gate: per-endpoint tests, no new writers introduced.

## Phase 3 — Command History + Health
- History aggregator over `mcc_usage_events` + executor events + orchestrator state; `/api/history`; screen 10.
- `/api/health` over monitor outputs + health.json + provider/tool probes; six-state model; recovery record table (DETECT→…→UPDATE STATUS); screens 8–9 (Status read-only embed).
- Exit gate: history fields complete (command/ts/duration/status/result/evidence/next action); Status Center untouched.

## Phase 4 — Memory UI
- `/api/memory/search` through the fail-closed knowledge-service boundary; screen 11; viewer-token gating.
- Exit gate: read-only proven (no ingestion path via HTTP), fail-closed behavior tested on store-absent host.

## Phase 5 — Evolution Memory (E0)
- Append-only evolution store (JSONL, outside Git) + genes/capsules file conventions + event model; read-only Evolution screen (all tabs render, mostly empty states); manual event recording CLI.
- Exit gate: append-only enforced by tests; store absent = fail-closed normal state.

## Phase 6 — Signals, Selector, Review, Validation (E1–E2)
- Simple detectors from History/Health; signal dispositions; Selector checklist; review tiers wired to governance-approve; validation runner over existing suites with PASS/FAIL records; rollback-point recording.
- Exit gate: one full evolution event traced end-to-end on a low-risk change, with human approval exercised on a high-tier dry run.

## Phase 7 — Search First + Graphify
- `search-first` skill + Open Source Registry (Settings); Graphify adoption for knowledge/project/evolution graphs; skills consolidation pass (Preflight, Postflight, Handoff, Status Sync as named skills — KEEP→EXTEND→MERGE first, Skill Creator only if something is genuinely new).
- Exit gate: registry populated with verified (not invented) data for every integrated project.

## Phase 8 — Hardening + closure
- Security review vs [OTHMODE_SECURITY.md](OTHMODE_SECURITY.md); role matrix enforced; full regression (0 new failures); docs sync (AI_HANDOVER, CHANGELOG, this folder); deploy per domain decision; final gate + handover entry.

## Testing strategy (applies to every phase)
- Every module ships a `tests/othmode-*-test.js` suite (pattern: existing per-stage suites); source-level no-exec assertions extended to all new code; suites runnable on the VPS and in the LF Linux container (never raw Windows CRLF checkouts); regression floor = all existing suites; UI states (empty/error/permission) covered by API-level tests + the visual-verify tooling already in `tools/`.

## Open questions for the owner (blocking Phase 1, not Phase 0)
1. **Domain:** keep `ordre.mythosprod.xyz` serving OTHMODE, or introduce an `othmode.` host (nginx + deploy target addition)?
2. **Local baseline:** approve fast-forward + discarding the 2 superseded dirty files?
3. **`mythos-prod-gate/`:** confirm purpose / whether to remove the local duplicate clone.
4. **Arabic review:** who reviews the Arabic translations before they ship?
5. **Evolution store location:** `/home/deploy/oth-evolution-store` (proposed, next to othk-store) — approve?
