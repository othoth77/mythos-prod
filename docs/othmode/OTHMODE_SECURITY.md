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

No critical current-state findings. Two observations for implementation: (1) MCC reads are unauthenticated by design (acceptable for a command library; revisit for Memory/Evolution surfaces, which are more sensitive); (2) ~~tokens live in browser localStorage~~ — **resolved 2026-08-26**: the UI token workflow was removed entirely (see §2.4).

### 2.4 Browser authentication (implemented 2026-08-26 — token-free UI)

The interface never asks for, sees, or stores a credential:

- **Sign-in**: the operator mints a one-time login link on the host (`othmode-cli.js login-link`, identity defaults to owner). The 256-bit code is single-use, expires in 15 minutes, and only its sha256 hash is persisted. `GET /auth/<code>` burns the code and sets a session cookie: `oth_session`, `HttpOnly; Secure; SameSite=Strict; Path=/`, 90-day TTL. Session ids are 256-bit random, stored server-side as sha256 hashes in `<store>/config/sessions.json` (0600, atomic writes, capped at 50 sessions, fail-closed without the store).
- **Requests**: the browser attaches the cookie itself; page JavaScript cannot read it (HttpOnly) and holds no secret. The legacy `mcc.token` localStorage key is scrubbed on boot.
- **CSRF**: a cookie is ambient authority, so cookie-authenticated non-GET requests must also prove same-origin (`Origin` matches Host, or `Sec-Fetch-Site: same-origin`) — enforced server-side in api.js, independent of browser SameSite behaviour. Bearer requests are exempt (explicit per-request credential).
- **Roles**: session identities flow through the identical role logic as bearer identities; owner-gated routes and HIGH-risk evolution approval are unchanged.
- **Sign-out**: `POST /api/othmode/logout` deletes the server-side session and expires the cookie; `othmode-cli.js revoke-sessions` revokes every session at once.
- **Bearer path preserved** for API/automation (`MCC_ADMIN_TOKENS`); timing-safe comparison unchanged. Constant-time hash comparison is used for codes and sessions too.

## 2. Target model

### 2.1 Invariant

> **AI must never be able to elevate its own permissions.** Concretely: no OTHMODE API writable by an AI session may modify roles, tokens, execution profiles, provider execution authority, or review-tier rules. Those change only via owner-authenticated UI actions or reviewed Git changes. (The former global OthMode switch is removed entirely — activation is per command via the standalone `othmode` keyword, which selects a control contract and grants no permission of any kind.)

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
- OTHMODE activation is instruction-layer (per-command keyword): it must never be represented as a security control in docs or UI, and the keyword must never influence authentication or authorization.
- New read surfaces (Memory, Evolution, History) may expose sensitive operational detail: they get at least viewer-token gating, unlike the public command library reads.
