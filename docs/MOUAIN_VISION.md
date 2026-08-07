# Mouain — Vision

**Stage:** MOU-0 Foundation and Vision Registration
**Last updated:** 2026-08-07
**Repository:** othoth77/mythos-prod

---

## 1. Product Identity

### Official Name

**Mouain** — مُعين

From Arabic العَون والإعانة (help, assistance, support).

A teacher's assistant — not a teacher replacement.

### Positioning

**Mouain Education OS**

Mouain is an AI-powered education operating system that starts with teachers and can progressively become a complete digital education ecosystem.

### What Mouain IS

- An education operating system designed for and with educators
- An AI assistant that amplifies teacher capability
- A curriculum-aware platform that understands educational structure
- A persistent teacher workspace across classes, subjects, and time
- A system that adapts to teachers rather than forcing teachers to adapt to it

### What Mouain IS NOT

- A SaaS tool or lesson generator
- A generic teacher chatbot
- A wrapper around an LLM
- An AI that replaces pedagogical judgment
- A content marketplace (initially)
- A student-only platform
- An automated grading machine

---

## 2. Long-Term Vision

The long-term objective is to create an Education OS connecting:

```
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
→ AI educational intelligence
```

### Ecosystem Vision

```
                   ┌──────────────────────────────┐
                   │     Mouain Education OS       │
                   │                              │
   ┌─────────┐     │  ┌────────────────────────┐  │     ┌──────────────┐
   │ Teacher │────►│  │      Teacher OS         │  │◄────│  Institution │
   └─────────┘     │  └────────────────────────┘  │     └──────────────┘
                   │           │                   │
                   │           ▼                   │
   ┌─────────┐     │  ┌────────────────────────┐  │     ┌──────────┐
   │ Student │◄───►│  │    Mouain Classroom     │◄───►│  Parent  │
   └─────────┘     │  └────────────────────────┘  │     └──────────┘
                   │           │                   │
                   │  ┌────────┴────────┐          │
                   │  ▼                 ▼          │
                   │ Curriculum      Student       │
                   │ Engine          Intelligence  │
                   │                              │
                   └──────────────────────────────┘
```

---

## 3. Core Principle

**Mouain must be built WITH educators, not merely FOR educators.**

### Technology Layer (Mythos)

- Platform engineering
- AI infrastructure
- Automation
- Agents
- Workflows
- Data architecture
- Integrations
- Document generation
- Multimodal tools

### Pedagogical Layer (Educators)

- Pedagogy
- Curriculum interpretation
- Subject-specific logic
- Assessment methodology
- Classroom reality
- Teaching practices
- Learning progression
- Educational quality

### Decision Authority

The teacher remains the final pedagogical decision-maker.

- AI assists, prepares, analyses, and automates.
- AI does not replace pedagogical judgment.
- Every AI recommendation must be teacher-reviewable.
- No automated action that affects students without teacher confirmation.

---

## 4. Target Market

### First Target

**Tunisia** — Tunisian official curriculum, Arabic and French languages.

### Future Expansion

The architecture must eventually support multiple countries and curricula.

### Target Users (Phased)

| Phase | Users |
|-------|-------|
| Phase 1 | Teachers (individual, across subjects and levels) |
| Phase 2 | Students (assignments, resources, progress) |
| Phase 3 | Parents (controlled progress view) |
| Phase 4 | Institutions (school OS, B2B) |

---

## 5. Design Principles

1. **Teacher sovereignty** — the teacher controls pedagogical decisions
2. **Curriculum fidelity** — aligned with official curricula, not generic AI
3. **Subject-aware** — different subjects get different logic, not just different prompts
4. **Level-aware** — primary, secondary, and higher education differ fundamentally
5. **Privacy by design** — student data protection from architecture, not as afterthought
6. **Progressive intelligence** — the system learns teacher preferences over time
7. **Skill modularity** — capabilities as composable skills, not monolithic features
8. **Offline-capable** — teacher work should not require constant connectivity
9. **Multilingual** — Arabic-first for Tunisian context, French and English supported
10. **Accessible** — designed for real classroom conditions, not idealized tech environments

---

## 6. Product Versions (Future Concept)

| Version | Access | Key Capabilities |
|---------|--------|-----------------|
| Teacher (Mouain Teacher) | Individual teachers | Full Teacher OS, curriculum planning, AI assistance |
| Student (Mouain Classroom) | Students via teacher/institution | Assignments, resources, progress |
| Parent (Mouain Parent) | Parents via institution consent | Progress, attendance, teacher communications |
| Institution (Mouain School OS) | Schools, institutions | Teacher management, curriculum alignment, analytics |

---

## 7. What Success Looks Like

Mouain is successful when:

- A Tunisian teacher opens Mouain and it already speaks their curriculum
- Lesson preparation time is meaningfully reduced without quality compromise
- The AI adapts to the teacher's style, not vice versa
- Different subjects feel like different tools, not the same interface recoloured
- Student progress emerges from daily pedagogical work, not from extra data entry
- Privacy and safety are never sacrificed for convenience
- Educators feel the system was built for them, not imposed on them

---

## 8. Explicit Non-Goals

- Mouain does NOT replace teachers
- Mouain does NOT automate grading without teacher review
- Mouain does NOT make pedagogical decisions
- Mouain does NOT collect data without consent
- Mouain does NOT sell student data
- Mouain does NOT require constant internet connectivity
- Mouain does NOT treat all subjects identically
- Mouain is NOT a generic AI chat with educational prompts

---

## 9. Relationship to Mythos Ecosystem

Mouain is a separate product domain within the Mythos ecosystem, distinct from:

- Mythos OS (production management platform)
- Mythos Automotive (vehicle ecosystem)

Mouain shares:
- Mythos platform governance principles
- Repository infrastructure and conventions
- Security and privacy architecture standards
- Documentation and stage management methodology

Mouain does NOT depend on Mythos OS production code.

---

## 10. Founding Pedagogical Council

See `docs/MOUAIN_FOUNDING_PEDAGOGICAL_COUNCIL.md`.

Before Mouain implementation begins, a Founding Pedagogical Council shall be formed. The council's role is pedagogical co-design and validation — NOT software development. See the council charter for scope, composition, and activation criteria.