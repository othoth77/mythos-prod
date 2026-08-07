# Mythos Research Intelligence

**Product:** Mythos Research Intelligence
**Product key:** `mythos_research`
**Platform:** Mythos ecosystem
**Repository:** othoth77/mythos-prod (`projects/research-intelligence/`, `docs/RESEARCH_*.md`, `docs/MYTHOS_RESEARCH_INTELLIGENCE_*.md`)
**Current stage:** RES-0 — Free-First Research Intelligence Foundation (2026-08-07)
**Status:** Documentation only — no implementation, no deployment, no provider accounts, no databases

---

## Purpose

Mythos Research Intelligence is the free-first, provider-independent external research capability for the Mythos platform. It enables AI agents and users to retrieve fresh, citable external information safely — without coupling the platform to any single search provider.

Core principles:

- **Free-first** — internal sources, official sources, and free providers before paid ones
- **Provider-independent** — no hard dependency on Perplexity, Brave, Tavily, or any single API
- **Source-aware** — every retrieved result carries trust, freshness, and provenance metadata
- **Privacy-aware** — minimal external context; redaction before external requests
- **Auditable** — all meaningful research actions are logged
- **Cache-aware** — reuse recent results to reduce cost and latency
- **Security-gated** — strict SSRF protection for URL fetching
- **Model-independent** — research retrieval is separate from reasoning/generation

---

## Architecture Summary

```
User / Agent
    ↓
Intent Architect (Personal Intelligence layer)
    ↓
Skill Router → research.web / research.official / research.deep
    ↓
Research Gateway
    ↓
Source Strategy
    ├── Official Source Fetcher (TIER 1)
    ├── SearXNG Adapter (TIER 2)
    ├── Brave/Tavily Adapters (TIER 3)
    └── Perplexity Adapter (TIER 4)
    ↓
Source Trust + Freshness Evaluator
    ↓
Content Extractor + Citation Normalizer
    ↓
Research Cache
    ↓
Context Compiler → Reasoning Model
```

Research provider ≠ Reasoning model. Research data ≠ Mythos internal authoritative data.

---

## Provider Tiers

| Tier | Provider | Classification | Status in RES-0 |
|------|----------|---------------|-----------------|
| TIER 0 | Internal authoritative data (Mythos DBs, org docs) | AUTHORITATIVE | Runtime concept — no code |
| TIER 1 | Official source fetcher (API docs, govt, mfr, repos) | OFFICIAL | Spec only |
| TIER 2 | SearXNG (self-hosted) | FREE_SELF_HOSTED | Architecture spec only |
| TIER 3 | Brave Search API, Tavily API | FREE_QUOTA | Provider strategy only |
| TIER 4 | Perplexity (optional premium) | PREMIUM | Optional — not required |

---

## Repository Layout

```
projects/research-intelligence/
├── README.md
└── config/
    ├── research.example.json
    └── providers.example.json

docs/
├── MYTHOS_RESEARCH_INTELLIGENCE_VISION.md
├── MYTHOS_RESEARCH_INTELLIGENCE_ARCHITECTURE.md
├── RESEARCH_PROVIDER_STRATEGY.md
├── RESEARCH_SECURITY_AND_PRIVACY.md
├── RESEARCH_SOURCE_TRUST_AND_CITATIONS.md
└── RESEARCH_ROADMAP.md
```

---

## Relationship to Personal Intelligence (MPI-0)

Personal Intelligence determines *what* to retrieve and *for whom*. Research Intelligence determines *how* to retrieve it safely.

```
Personal Intelligence (MPI)
     ↓
research.web capability
     ↓
Research Gateway (RES)
```

These are different layers. See `docs/MYTHOS_RESEARCH_INTELLIGENCE_VISION.md` for the full integration model.

**MPI-0 status:** PENDING MERGE (PR #4, branch `feat/mythos-personal-intelligence`, commit `d0a4cbb`). This Research foundation references MPI-0 architecture but does not depend on it being merged.

---

## Relationship to Automation

Automation & Operations handles deployment, health checks, and provider monitoring. Research Intelligence handles search, retrieval, and source quality. Do not mix them.

---

## Data Status

**No real data is ingested in RES-0.**

- No SearXNG installed
- No provider accounts created
- No API keys provisioned
- No research cache database
- No audit database
- No services deployed
- All config flags: `false` / `NOT_DEPLOYED`

---

## Next Stage

**RES-1 — Research Gateway Core + Official Source Fetcher** — NOT AUTHORISED. Requires RES-1 entry gate satisfied (see `docs/RESEARCH_ROADMAP.md`).