# Mouain — مُعين

**Umbrella name:** Mouain Education OS
**Positioning:** Mouain — نظام تشغيل تعليمي بالذكاء الاصطناعي
**Arabic:** مُعين — من العَون والإعانة
**Platform:** Mythos ecosystem
**Repository:** othoth77/mythos-prod (`projects/mouain/`, `docs/MOUAIN_*.md`)
**Current stage:** MOU-0 — Foundation and Vision Registration (2026-08-07)
**Status:** Documentation only — no implementation, no deployment, no real data

---

## Purpose

Mouain is an AI-powered education operating system that starts with teachers and can progressively become a complete digital education ecosystem.

Mouain is NOT:
- a SaaS tool,
- a lesson generator,
- a generic teacher chatbot,
- or a wrapper around an LLM.

Mouain's long-term objective is to create an Education OS connecting:

Teacher
→ Curriculum
→ Lesson planning
→ Educational resources
→ Exercises
→ Assessments
→ Correction
→ Competencies
→ Student progress
→ Classroom
→ Parents
→ Educational institution
→ AI educational intelligence.

---

## Core Principle

**Mouain must be built WITH educators, not merely FOR educators.**

| Layer | Who |
|-------|-----|
| Platform engineering, AI infrastructure, automation, agents, workflows, data architecture, integrations, document generation, multimodal tools | Technology (Mythos) |
| Pedagogy, curriculum interpretation, subject-specific logic, assessment methodology, classroom reality, teaching practices, learning progression, educational quality | Educators |

The teacher remains the final pedagogical decision-maker. AI assists, prepares, analyses, and automates. AI does not replace pedagogical judgment.

---

## Product Principle

"Mouain adapts to the teacher; the teacher should not have to adapt to the AI."

Different subjects and educational levels must eventually be able to use different pedagogical logic. An Arabic teacher, mathematics teacher, primary teacher, and secondary teacher must not simply receive the same generic AI behaviour with different prompts.

---

## Founding Pedagogical Council

See `docs/MOUAIN_FOUNDING_PEDAGOGICAL_COUNCIL.md` for the full charter.

المجلس التربوي المؤسس لـ Mouain

A future council of selected early educators from different disciplines and educational levels whose role is to co-design and validate pedagogical workflows, curriculum structures, teacher workflows, assessment models, educational AI behaviour, modern teaching techniques, subject-specific requirements, and classroom usability.

---

## Architectural Directions

See `docs/MOUAIN_ARCHITECTURE.md` for the full reference. Eleven long-term architectural directions are documented:

1. Teacher OS — central workspace
2. Curriculum Engine — structured educational knowledge from official curricula
3. Teacher Memory / Personalization — with explicit privacy, control, and deletion
4. Mouain Skills — modular educational skill architecture
5. Educational AI Agents — specialized agents, not one generic chatbot
6. Student Intelligence — competency-based assessment linking
7. Mouain Classroom — future student environment
8. Parent Layer — controlled access
9. Institution / School OS — future B2B layer
10. Modern Learning Technology — compatible architecture
11. Platform Direction — multi-product roadmap

These are long-term architectural directions, NOT immediate implementation commitments.

---

## Privacy and Safety

Because Mouain may eventually process student data, privacy and security are architectural requirements from day one.

See `docs/MOUAIN_ARCHITECTURE.md` for the full privacy/safety architecture constraints.

---

## Roadmap

Mouain is a FUTURE STRATEGIC PROJECT. Implementation has not started. See `docs/MOUAIN_ROADMAP.md` for the full stage plan with explicit readiness gates.

**MOU-0 is the current stage: Foundation and Vision Registration.**

Implementation is activated only when readiness gates are satisfied and when doing so will not destabilize the current Mythos OS roadmap.

---

## Repository Layout

```
projects/mouain/
└── README.md                                  ← this file

docs/
├── MOUAIN_VISION.md                           ← full vision and positioning
├── MOUAIN_ARCHITECTURE.md                     ← architectural directions and privacy/safety constraints
├── MOUAIN_ROADMAP.md                          ← stage plan and readiness gates
├── MOUAIN_PEDAGOGY.md                         ← pedagogical model and design principles
└── MOUAIN_FOUNDING_PEDAGOGICAL_COUNCIL.md     ← council charter
```

---

## Data Status

**No real data is ingested in MOU-0.**

- No PostgreSQL installed for Mouain
- No services deployed
- No teacher data
- No student data
- No curriculum data
- All feature flags: not yet defined

---

## Relationship to Current Mythos OS Roadmap

Mouain is a separate product domain (Education), not a dependency blocker for the current Mythos OS (Production Management) or Mythos Automotive tracks.

No current Mythos OS stage is blocked on Mouain. Mouain implementation is deferred until its readiness gates are satisfied.

---

## Next Stage

**MOU-1 — Discovery Phase** — involves real teachers, determines highest-cost tasks, validates actual workflows, and freezes the MVP scope.

MOU-1 is NOT authorised to start. It requires MOU-0 registration + all readiness gates satisfied + explicit authorisation.