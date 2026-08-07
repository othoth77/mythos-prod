# Mythos Personal Intelligence Vision

**Stage:** MPI-0 — Personal Intelligence Foundation
**Status:** Strategic architecture direction. Documentation, contracts, and reference/test code only. No production runtime change, no database deployment, no live chatbot.
**Date:** 2026-08-06
**Branch:** `feat/mythos-personal-intelligence` (not merged to `main`)

---

## 1. The Strategic Direction

> **Mythos is not building a collection of isolated chatbots. Mythos is building one shared Personal Intelligence Platform.**
> One shared intelligence platform, personalised per user and organisation through layered context, memory, skills and permissions — not one static chatbot for everyone.

Every chatbot instance a Mythos user experiences is produced, at request time, from:

```
Shared Mythos Intelligence
  + Domain Pack
  + Organisation Context
  + Role & Permissions
  + User Intelligence
  + Relevant Memory
  + Current Session
```

The same architecture must support one teacher and thousands of different teachers; one workshop and thousands of different workshops; multiple users within each organisation, each with different roles and preferences; and future professional verticals beyond education and automotive workshops — without ever copying application code per customer.

---

## 2. Why This Architecture Exists

Mythos already runs distinct products for distinct professional domains — a chess-club production app, automotive/ID Auto/Atelier Network/AutoValeur, and the Cloudflare/Automation infrastructure track. As Mythos adds AI assistance to these products, the naive path is tempting and wrong: give every customer their own chatbot prompt, their own copied skill tree, their own bespoke integration. That path does not scale, cannot be maintained, leaks intelligence improvements unevenly across customers, and — critically — has no structural way to keep one customer's data out of another's context.

The alternative this document commits Mythos to is a **layered, shared-core, personalised-edge** architecture: one platform, one set of domain skills per profession, and a context pipeline that assembles the right slice of organisation and user intelligence for each request — never more than what's needed, never leaking across tenants.

---

## 3. Teacher Example

**Teacher A** (mathematics, Organisation "École X") and **Teacher B** (French literature, Organisation "École Y") both use the same `education` domain pack — the same shared skill definitions for `assessment.prepare`, `content.adapt_difficulty`, `answer_key.generate`, and so on. What differs is not the code, but the context assembled around it:

- **Domain** tells the platform what an assessment, a lesson, and a class *are*, in general.
- **Organisation** tells it École X's terminology, grading conventions, and communication rules — distinct from École Y's.
- **User Intelligence** tells it Teacher A prefers concise answer keys and usually sets homework slightly easier than the previous week's — a pattern Teacher B does not share.
- **Session** tells it what Teacher A is asking for *right now*: "اعمللي devoir كيف المرة الي فاتت اما اسهل" (make me a homework like last time's but easier).

Teacher A and Teacher B never see each other's classes, documents, or learned preferences. Neither their organisation, if different, sees the other's policies.

---

## 4. Workshop Example

**Workshop Fixpert** and a second, unrelated workshop both use the same `automotive_workshop` domain pack — the same shared `estimate.prepare`, `diagnostic.summary`, `vehicle.lookup` capability contracts, integrated with the existing ID Auto vehicle-identity layer and Atelier Network workshop registry (`docs/ATELIER_NETWORK_ARCHITECTURE.md`, `docs/IDAUTO_ARCHITECTURE.md`) rather than duplicating them.

What differs, again, is context: Fixpert's pricing policy, service catalogue, opening hours, and customer-communication style are organisation-scoped; a technician's habit of always producing an estimate immediately after a diagnostic is user-scoped workflow memory; and "حضّرلي devis للكوراندو الي دخلت صباح" (prepare an estimate for the Korando that came in this morning) resolves — subject to permission — to a specific vehicle check-in, client, and work order inside that one workshop's data, never another's.

---

## 5. The Multi-User, Multi-Organisation, Multi-Profession Model

Four independent axes of variation must be representable simultaneously, without collapsing into each other:

- **Multi-user**: two users in the *same* organisation, doing the *same* job, may still have different working preferences, recent context, and (where legitimately different) permissions.
- **Multi-organisation**: two organisations in the *same* domain operate under different rules, terminology, and policy — Workshop A is not Workshop B; École X is not École Y.
- **Multi-profession (domain)**: teaching and vehicle-workshop work share almost nothing at the domain-knowledge level, but share everything at the platform level (permissions, memory policy, audit, context assembly, model routing).
- **Multi-tenant isolation**: none of the above axes may ever leak into another instance of itself. See `docs/MYTHOS_AI_MULTI_TENANCY.md`.

---

## 6. The Shared Skill Model

A domain capability (e.g. `education.assessment.create` or `estimate.prepare`) is written **once**. It is never physically copied per user or per organisation. What varies per invocation is the **context package** assembled for it — see `docs/MYTHOS_CONTEXT_ARCHITECTURE.md` — and, where applicable, an **organisation configuration overlay** and a **user preference overlay**, applied by configuration, not by source-code duplication. See `docs/SKILLS_ARCHITECTURE.md` §"Skill Overrides" for the layered-configuration model this implies.

---

## 7. Personal Intelligence, Organisation Intelligence, Domain Intelligence

Three distinct kinds of "what does the AI know" must never be flattened into one blob:

- **Domain Intelligence** — professional-baseline knowledge shared by every organisation and user in that profession (what a lesson is; what a work order is). See `docs/MYTHOS_DOMAIN_PACKS.md`.
- **Organisation Intelligence** — how *this* organisation runs the domain (this workshop's prices; this school's grading scale). See `docs/MYTHOS_PERSONAL_INTELLIGENCE_ARCHITECTURE.md` §"Organisation Profile".
- **User Intelligence** — how *this* person, specifically, tends to work and prefers to be answered. See the same document, §"User Profile". User Intelligence is explicitly **not** a role and **never** grants permission — see §9 below and `docs/MYTHOS_PERSONAL_INTELLIGENCE_ARCHITECTURE.md` §"User ≠ Role".

---

## 8. Memory and Learning

Not every conversation becomes memory, and not every learned pattern applies beyond the user who produced it. Mythos separates memory by purpose (working preferences, workflow memory, domain context, organisation knowledge, task history, decision memory, ephemeral session memory — `docs/MYTHOS_USER_MEMORY_POLICY.md`) and scopes every learned item (session → user → organisation → domain → global, with organisation/domain/global promotion requiring explicit governance — `docs/MYTHOS_PERSONAL_INTELLIGENCE_ARCHITECTURE.md` §"Learning Scope and Confidence"). A preference learned from Teacher A must never automatically affect Teacher B.

---

## 9. Permission Separation

**A user preference never bypasses permissions or security.** Role and permission enforcement happens at the application/data layer, independent of and prior to any AI personalisation, exactly as `docs/AUTOMATION_APPROVAL_MATRIX.md` already establishes for the Automation platform: learning may never grant access, and personalisation may never elevate an automation level. The precedence order is documented in `docs/MYTHOS_PERSONAL_INTELLIGENCE_ARCHITECTURE.md` §"Precedence Rules".

---

## 10. Chatbot Architecture

Every personal-chatbot request passes through the same pipeline — authenticated user → organisation → role/permissions → domain → user intelligence → relevant memory → session → intent normalisation → skill routing → superposition → guard → execution → response → learning signal. See `docs/MYTHOS_CHATBOT_ARCHITECTURE.md` for the full pipeline and `docs/MYTHOS_CONTEXT_ARCHITECTURE.md` for how the context injected at each step is selected, not dumped.

---

## 11. Context Compiler and Provider Independence

Application-level personal and organisation intelligence is never stored in a provider-specific prompt file. A model-neutral **Context Package** is compiled from intent, profiles, memory, and permissions, and only then adapted per model provider (Claude, Codex, or a future provider) — see `docs/MODEL_ROUTING_ARCHITECTURE.md`. Switching or adding a model provider must never require rewriting personal or organisation intelligence.

---

## 12. Privacy

Data minimisation is structural, not aspirational: identifiers and references are preferred over raw sensitive content in any assembled context; queries enforcing user/organisation/permission scope live in the application/data layer, never only in a prompt; and every persistent intelligence record — user, organisation, memory — is scoped and tested for isolation. See `docs/MYTHOS_AI_MULTI_TENANCY.md`.

---

## 13. Future Commercial Value

This architecture is the foundation for **Mythos AI Platform**: education products, automotive products, production products, administrative products, and future verticals, each contributing a domain pack; each organisation contributing configuration and knowledge; each user contributing contextual personal intelligence — all sharing one platform core. Teachers and workshops are the first two reference verticals, not the limit of the design. See `docs/SKILLS_ROADMAP.md` §"Rollout Roadmap" for the staged path from this foundation to pilot verticals.

---

## 14. Product Principle

> **Shared capabilities, isolated intelligence.**

**Share:** code, domain skills, generic AI infrastructure, orchestration, model adapters.
**Isolate:** organisation data, user data, memory, permissions, business rules, personal preferences, private knowledge.

---

## 15. Status of This Stage (MPI-0)

MPI-0 is documentation, application-level contracts, a small illustrative reference implementation, and test fixtures — **not** a deployed runtime, not a live chatbot, not a database migration, and not a change to the production PHP/JS application. See `docs/AI_HANDOVER.md` for the verified state of what was actually implemented versus what remains documented-only, and `docs/SKILLS_ROADMAP.md` for the staged path (MPI-0 through MPI-10) this foundation opens.
