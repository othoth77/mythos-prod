# Mouain — Architecture

**Stage:** MOU-0 Foundation and Vision Registration
**Last updated:** 2026-08-07
**Repository:** othoth77/mythos-prod

---

## Important Notice

This document records **long-term architectural directions**, NOT immediate implementation commitments.

No architecture decisions are binding at MOU-0. These directions guide future discovery and design. Implementation architecture will be defined in MOU-2 after the Discovery Phase.

---

## 1. Teacher OS

The teacher's central workspace.

### Scope

- Classes and subjects management
- Curriculum navigation and interpretation
- Lesson planning (daily, weekly, unit-based)
- Exercise and worksheet generation
- Assessment creation and management
- Correction workflows
- Grading and competency tracking
- Educational document generation (lesson plans, worksheets, reports)
- Student monitoring and progress

### Principles

- Single workspace per teacher across all classes and subjects
- Curriculum-aware navigation (navigate by official curriculum structure, not by abstract topics)
- Teacher controls what is visible, shared, and stored
- Offline capability for core workflows

---

## 2. Curriculum Engine

Transform official curricula from static PDFs into structured educational knowledge.

### Conceptual Hierarchy

```
Education system (Tunisia)
→ Educational stage (Primary / Preparatory / Secondary)
→ Grade (1ère année, 2ème année, ...)
→ Subject (Arabic, Mathematics, Sciences, ...)
→ Domain (numbers, algebra, geometry, ...)
→ Unit (fractions, equations, ...)
→ Competency (solve linear equations, ...)
→ Learning objective (identify coefficients, ...)
→ Lesson (one instructional session)
→ Activity (specific exercise or task)
→ Assessment (evaluation aligned to competency)
```

### Design Intent

- Support multiple countries and curricula (Tunisia first)
- Curriculum structure is data, not hardcoded logic
- Learning objectives link to competencies, activities, and assessments
- AI recommendations anchored to specific curriculum nodes
- Curriculum data versioned (official updates must not silently change teacher plans)

### First Target

Tunisian official curriculum — Arabic and French versions.

---

## 3. Teacher Memory / Personalization

Each teacher should progressively have a personalized Mouain environment.

### What Mouain should learn

- Preparation style (detailed vs concise, structured vs narrative)
- Preferred document structures and templates
- Exercise style (multiple choice, open-ended, mixed)
- Assessment style (formative, summative, rubric-based)
- Level of detail in lesson plans
- Teaching workflow rhythm

### Architecture Constraints

Do NOT design as unrestricted AI memory:

- Explicit data ownership by the teacher
- Teacher can view, edit, and delete all personalization data
- Personalization never includes student-specific data
- Personalization data is separate from pedagogical content
- Export and deletion mechanisms designed from the start

---

## 4. Mouain Skills

Modular educational capabilities, each a composable Skill.

### Skill Architecture (Concept)

Each Skill:
- Has a defined input contract and output contract
- Can be specialized by subject, educational level, curriculum
- Can evolve independently
- May use shared AI infrastructure

### Example Skills (Future)

| Skill | Description |
|-------|-------------|
| Lesson Planning Skill | Generate structured lesson plans aligned to curriculum objectives |
| Exercise Generation Skill | Create exercises with varying difficulty, format, and approach |
| Assessment Builder Skill | Build assessments with competency mapping |
| Correction Assistant Skill | Assist with correction workflows, rubric application |
| Rubric Builder Skill | Create and manage assessment rubrics |
| Curriculum Mapping Skill | Navigate and visualize curriculum structure |
| Student Difficulty Analysis Skill | Identify patterns in student difficulties |
| Differentiated Instruction Skill | Adapt content for different student levels |
| Document Scanner/OCR Skill | Digitize educational documents |
| Educational Presentation Skill | Generate structured presentations |

### Skill Specialization

Skills should support specialization by:
- Subject (Arabic, Mathematics, Sciences, History, ...)
- Educational level (Primary, Preparatory, Secondary)
- Curriculum (Tunisia, future countries)
- Teacher preferences (personalized adaptation)

---

## 5. Educational AI Agents

Long-term architecture for specialized agents rather than a single generic chatbot.

### Future Agent Concepts

| Agent | Responsibility |
|-------|---------------|
| Teacher Agent | Teacher workspace assistant, workflow orchestration |
| Curriculum Agent | Curriculum structure, alignment, mapping |
| Assessment Agent | Assessment design, rubric management, competency linking |
| Student Progress Agent | Competency tracking, difficulty identification, remediation suggestions |
| Content Agent | Educational resource creation, adaptation, translation |
| Institution Agent | School-level analytics, reporting, administration |

### Agent Principles

- Agents are specialized, not generic
- Agents communicate through defined interfaces, not shared global state
- Agents defer to teacher for all pedagogical decisions
- Agent output is always reviewable

**Do NOT implement agents at MOU-0 or MOU-1.**

---

## 6. Student Intelligence

Associate assessment results with competencies and learning objectives rather than storing grades only.

### Future Capabilities

- Link every assessment item to a specific competency and learning objective
- Track competency progression over time
- Identify recurring difficulties at competency level
- Identify competency gaps
- Suggest remediation opportunities
- Generate competency-based reports (not just grade reports)

### Constraints

- Pedagogical decisions remain human-supervised
- Student data ownership and access strictly controlled
- No automated student profiling without explicit institutional consent
- Competency models validated by educators, not invented by AI

---

## 7. Mouain Classroom

Future student environment.

### Scope

- Assignments and exercises (teacher-assigned)
- Interactive learning activities
- Teacher-shared resources
- Progress dashboards (student view)
- Submission workflows

### Constraints

- Student access is teacher-facilitated, not direct registration
- No social features without explicit pedagogical purpose
- Student experience appropriate to age and educational level

---

## 8. Parent Layer

Controlled parent access to appropriate information.

### Scope

- Student progress (teacher-approved view)
- Attendance information
- Assignment status
- Teacher communications (authorised channels)

### Constraints

- Parent access is institution-gated and teacher-controlled
- Parents see what educators decide they should see
- No direct parent-teacher chat without institutional framework
- Data minimization: parents see summaries, not raw assessment data

---

## 9. Institution / School OS

Future B2B layer for educational institutions.

### Scope

- Teacher and class management
- Curriculum alignment tracking
- Assessment oversight
- Educational analytics (anonymized, aggregated)
- Administrative workflows

### Constraints

- Institution access does not override teacher pedagogical autonomy
- Aggregated data, not individual teacher surveillance
- Separate from teacher personal workspace

---

## 10. Modern Learning Technology

The architecture should remain compatible with evolving educational technology.

### Potential Technologies

- Interactive educational content (H5P-compatible or equivalent)
- Simulations (science, mathematics)
- Educational visualization
- Formative assessment engines
- Adaptive learning pathways
- Multimedia educational workflows
- OCR for educational documents
- Image/audio/video in educational workflows
- Lightweight educational games

### Technology Principle

Technology must solve a pedagogical problem rather than exist for novelty. Every technology choice must be justified by a validated teacher need.

---

## 11. Platform Direction

Long-term possibilities:

- **Teacher product** — individual teacher workspace (Phase 1)
- **Student product** — student interface (Phase 2)
- **Parent product** — parent portal (Phase 3)
- **Institution product** — school OS (Phase 4)
- **Educational marketplace** — skill and resource sharing (future)
- **API / platform layer** — third-party educational integrations (future)
- **Country-specific curriculum packages** — curriculum data as products (future)

---

## 12. Privacy and Safety Architecture

Because Mouain may eventually process student data, privacy and security are architectural requirements from day one.

### Future Implementation Must Consider

- **Data minimization** — collect only what is pedagogically necessary
- **Role-based access** — teacher, student, parent, administrator, super-admin
- **Tenant isolation** — school/institution data strictly separated
- **Explicit teacher/institution control** — educators control what happens with their data
- **Auditability** — all access to student data is logged
- **Encryption** — data at rest and in transit
- **Deletion and export** — teachers and institutions can delete and export
- **Student privacy** — student data treated as sensitive by default
- **Parental/institutional permissions** — where applicable by law and context
- **Separation between AI context and permanent records** — AI training context is not permanent storage

### Legal Compliance (Future)

- Tunisian data protection law (INPDP)
- GDPR-equivalent standards for future expansion
- Educational data regulations specific to target countries

**Do NOT build these systems at MOU-0. Record them as architectural constraints.**

---

## 13. Architecture Decisions

### MOU-AD-1 (Provisional)

**Mouain is a separate product domain from Mythos OS.**

Mouain does not share the Mythos OS production management codebase or data model. It shares repository infrastructure, documentation conventions, and platform governance principles only.

### MOU-AD-2 (Provisional)

**Curriculum structure is data, not code.**

Official curricula are modelled as structured data. No hardcoded curriculum logic. Curriculum data is versioned and updatable independently of application code.

### MOU-AD-3 (Provisional)

**Teacher is the canonical pedagogical authority.**

AI assists, suggests, prepares, and analyses. The teacher makes all pedagogical decisions. No automated action affecting students without teacher confirmation.

### MOU-AD-4 (Provisional)

**Skills are modular and composable.**

Educational capabilities are organized as Skills with defined contracts. Skills can be specialized, composed, and evolved independently.

### MOU-AD-5 (Provisional)

**Privacy is architectural, not retrofitted.**

Student data protection, consent mechanisms, access control, and audit are designed from the data model up, not added after implementation.

### MOU-AD-6 (Provisional)

**Mouain is multilingual at the data level.**

Arabic, French, and English content is stored as structured data, not as UI translations. Curriculum, pedagogical content, and generated materials respect language context.

---

## 14. Technology Stack (Not Decided)

Technology decisions are deferred to MOU-2 (Architecture and Platform Setup) after the Discovery Phase. Candidates include:

- **Backend:** Undecided (PostgreSQL is the Mythos ecosystem standard)
- **AI platform:** Undecided (model-agnostic design preferred)
- **Frontend:** Undecided (align with Mythos ecosystem standards at decision time)
- **Deployment:** Coolify (consistent with Mythos ecosystem)
- **Storage:** Persistent database + object storage (consistent with Mythos ecosystem)

---

## 15. Non-Goals (Architecture)

- Mouain does NOT replicate Mythos OS production management features
- Mouain does NOT use the same data model as Mythos OS (different domain)
- Mouain does NOT implement a generic AI chatbot
- Mouain does NOT invent curriculum — it interprets official curricula
- Mouain does NOT replace student information systems (SIS)
- Mouain does NOT become a content marketplace in initial phases