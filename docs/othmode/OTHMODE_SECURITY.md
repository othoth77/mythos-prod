# OTHMODE — Security Design

Phase 1 design. Current-state audit + target model. Nothing changed in this phase.
Master document: [OTHMODE_AUDIT_AND_DESIGN.md](OTHMODE_AUDIT_AND_DESIGN.md)

**بالعربية باختصار:** الوضع الأمني الحالي قوي أصلاً (مفاتيح وليس كلمات سرّ، صلاحيات محدودة جداً، منع حفظ أي أسرار داخل التطبيق). قاعدة ذهبية تبقى دائماً: الذكاء الاصطناعي لا يستطيع أبداً رفع صلاحياته بنفسه — أي تغيير خطير يحتاج موافقة إنسان.

---

## 1. Current security posture (audited, all verified in-repo)

| Area | Current state |
|---|---|
| Authentication (MCC) | Bearer tokens from env (`MCC_ADMIN_TOKENS`, server refuses to start without); reads are public on the origin, writes token-gated |
| Authorization | Token→role map (MCC); executor execution profiles → exact Claude tool permissions (`lib/policy.js`); `deploy` profile shipped **disabled**, enabling is an owner code decision, not a payload option |
| Secrets | Never in app data: env files 0600 outside repo; **secret-format write gate** (`secrets.js`) refuses credential-shaped content instead of warning; task envelopes refused if secret-shaped; shared redaction on all persisted output |
| Network | Services bind 127.0.0.1 (+ n8n Docker bridge only, for the executor); ufw scoping; nginx TLS fronting |
| Host | `NoNewPrivileges=true` on services; scoped sudo (`mythos-deploy` + nginx test/reload only); key-only SSH; root SSH unusable; audit log per deploy action |
| Knowledge boundary | Executor may only READ knowledge; fail-closed when store absent; ingestion operator-CLI-only |
| SQL | Parameterized only; search_path pinned; per-product schemas, one writer per schema |
| Command execution | **None**: no exec/eval/child_process in MCC runtime, asserted at source level by the test suite |
| CI/CD | VPS Final Gate; deploy path health-gated with automatic rollback |

No critical current-state findings. Two observations for implementation: (1) MCC reads are unauthenticated by design (acceptable for a command library; revisit for Memory/Evolution surfaces, which are more sensitive); (2) tokens live in browser localStorage (accepted trade-off today; document it).

## 2. Target model

### 2.1 Invariant

> **AI must never be able to elevate its own permissions.** Concretely: no OTHMODE API writable by an AI session may modify roles, tokens, execution profiles, provider execution authority, review-tier rules, or the OthMode switch. Those change only via owner-authenticated UI actions or reviewed Git changes.

### 2.2 Per-area requirements

| Area | Target |
|---|---|
| Authentication | Keep bearer-token model; add a distinct token per role; owner-only role for Settings/OthMode/Evolution approval |
| Authorization | Role matrix per module: viewer (read all non-sensitive), editor (library writes), operator (health/recovery records, history annotations), owner (settings, providers, evolution approvals). Default deny for new endpoints |
| Tool permissions | Stay in executor `tools.json`/`policy.js` (Git-reviewed); OTHMODE UI is read-only over them |
| Skill permissions | `mythos-skill-guard` decision vocabulary (ALLOW/DENY/REQUIRE_APPROVAL/READ_ONLY/DRY_RUN_ONLY) becomes the displayed permission model per skill |
| Project isolation | Per-schema DB isolation continues; OTHMODE reads cross-project metadata only |
| Provider isolation | Execution-authority line never crossed by fallback (existing router rule kept); advisory providers get no repo-write path |
| Secret isolation | Secret gate extended to every new write surface (memory notes, evolution evidence, registry entries, recovery records); UI shows credential *presence/health*, never values |
| External actions | OTHMODE itself performs none (no outbound calls in v1 except to local stores/services); anything external stays in Mythos OS / n8n |
| Evolution approval | Risk tiers per [OTHMODE_EVOLUTION.md](OTHMODE_EVOLUTION.md) §8; high tier = human approval before validation; approvals recorded with actor + ts + evidence |
| Auditability | Every write endpoint logs actor(role), action, target, ts; evolution store is append-only; deploy audit log continues; no log ever contains secret material (redaction shared lib) |

### 2.3 Threat notes for implementation review

- Stored commands/memory/evidence are attacker-influenceable *text* rendered to humans and consumed by AI: keep the no-execution rule absolute, escape all rendering, and treat store content as data, never instructions, in AI prompts (label injected context).
- The OthMode switch is instruction-layer: it must never be represented as a security control in docs or UI.
- New read surfaces (Memory, Evolution, History) may expose sensitive operational detail: they get at least viewer-token gating, unlike the public command library reads.
