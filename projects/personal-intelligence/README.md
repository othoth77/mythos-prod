# Mythos Personal Intelligence & Skills Platform

**Product key:** `mythos_intelligence`
**Stage:** MPI-0 — Personal Intelligence Foundation
**Status:** Documentation, contracts, illustrative reference implementation, draft schema, and tests only. Not deployed. No production runtime change.

## What This Is

The application-level foundation for Mythos's shared, per-user, per-organisation, per-profession AI personalisation architecture — see `docs/MYTHOS_PERSONAL_INTELLIGENCE_VISION.md` for the strategic direction and `docs/MYTHOS_PERSONAL_INTELLIGENCE_ARCHITECTURE.md` for the full layered contract set (Global Intelligence → Domain → Organisation → User → Session → Intent → Skill Router → Superposer → Guard → Execution → Learning).

## Repository Layout

```
projects/personal-intelligence/
├── README.md                                — this file
├── config/
│   └── personal-intelligence.example.json   — draft configuration (no secrets, no real users)
├── database/
│   └── control-plane-schema.sql             — draft PostgreSQL schema (NOT DEPLOYED)
└── reference/
    ├── scope.js               — scope precedence + isolation helpers
    ├── context-assembler.js   — REQUIRED/USEFUL/IRRELEVANT/FORBIDDEN context selection
    ├── learning-engine.js     — observation → candidate → established → explicit rule
    ├── guard.js                — permission decision (ALLOW/DENY/REQUIRE_APPROVAL/READ_ONLY/DRY_RUN_ONLY)
    └── intent-router.js         — illustrative multilingual intent + domain routing stub
```

The `reference/` modules are **illustrative, in-memory, dependency-free implementations** of the contracts documented in `docs/`. They exist to make the architecture testable (`tests/mpi-0-personal-intelligence-test.js`) and to give future implementation stages (MPI-1 onward, see `docs/SKILLS_ROADMAP.md`) a concrete starting shape — they are not wired into the production PHP/JS application and are not a persistence layer.

## Related Documentation

| Document | Covers |
|---|---|
| `docs/MYTHOS_PERSONAL_INTELLIGENCE_VISION.md` | Strategic direction, teacher/workshop examples, product principle |
| `docs/MYTHOS_PERSONAL_INTELLIGENCE_ARCHITECTURE.md` | Layer hierarchy, all profile contracts, precedence rules |
| `docs/MYTHOS_USER_MEMORY_POLICY.md` | Memory types, learning pipeline, scope/confidence, write policy |
| `docs/MYTHOS_CONTEXT_ARCHITECTURE.md` | Context Assembler, Context Compiler, retrieval interface |
| `docs/MYTHOS_DOMAIN_PACKS.md` | `education` and `automotive_workshop` domain pack capability contracts |
| `docs/MYTHOS_AI_MULTI_TENANCY.md` | Mandatory isolation requirements |
| `docs/MYTHOS_CHATBOT_ARCHITECTURE.md` | End-to-end chatbot request pipeline |
| `docs/SKILLS_ARCHITECTURE.md` | Agent-development vs. runtime skills, shared-skill model |
| `docs/SKILLS_SUPERPOSER.md` | Skill composition contract |
| `docs/SKILLS_SECURITY.md` | Hard security requirements |
| `docs/SKILLS_SOURCES.md` | Upstream/wrapper/original classification |
| `docs/SKILLS_ROADMAP.md` | MPI-0 through MPI-10 stage sequence |
| `docs/MODEL_ROUTING_ARCHITECTURE.md` | Provider-neutral model routing |

## Status of This Stage (MPI-0)

- Documentation, architecture, application-level contracts, an illustrative in-memory reference implementation, and test fixtures only.
- No database installed, migrated, or executed — `database/control-plane-schema.sql` is a draft specification.
- No runtime JS/HTML/PHP/CSS in the production application changed.
- No credential, secret, or real personal data anywhere in this directory.
- Not merged to `main` — developed on `feat/mythos-personal-intelligence`.

## Next Stage

**MPI-1 — Context Assembler + Context Compiler** (runtime implementation) is the next Personal Intelligence stage, not started by MPI-0. See `docs/SKILLS_ROADMAP.md`.
