# Mythos Research Intelligence — Roadmap

**Stage:** RES-0 — Free-First Research Intelligence Foundation
**Status:** RES-0 complete (documentation only). No later stage is authorised.
**Date:** 2026-08-07

---

## Important Notice

Mythos Research Intelligence is a **FUTURE PLATFORM CAPABILITY**. No runtime implementation has started.

No RES stage beyond RES-0 is authorised to begin implementation. The RES-1 entry gate must be satisfied before any runtime work begins.

---

## 1. Stage Naming Convention

Research Intelligence stages use the `RES-N` prefix:

| Stage | Description |
|-------|-------------|
| RES-0 | Free-First Research Intelligence Foundation |
| RES-1 | Research Gateway Core + Official Source Fetcher |
| RES-2 | Private SearXNG Deployment + Adapter |
| RES-3 | Source Trust + Citation + Research Cache |
| RES-4 | Optional Free-Quota Provider Adapters (Brave, Tavily) |
| RES-5 | Deep Research Orchestration + Optional Premium Provider (Perplexity) |
| RES-6 | Research Monitoring, Analytics and Optimisation |

Stage 0 is always documentation/specification. No runtime code, no database, no deployment.

---

## 2. RES-1 Entry Gate

Runtime Research implementation (RES-1) must NOT start until ALL of the following conditions are satisfied:

| # | Condition | Current Status |
|---|-----------|---------------|
| 1 | MPI-0 PR #4 (`feat/mythos-personal-intelligence`) has been merged to `main` | PENDING — PR #4 is OPEN / DRAFT |
| 2 | Current GitHub `main` is clean (no unmerged conflicting work) | OK |
| 3 | INF-OVH-API-0 has been completed OR owner explicitly re-prioritises | PENDING — INF-OVH-API-0 is next |
| 4 | No other major implementation stage is active | Must verify at RES-1 time |
| 5 | Owner explicitly authorises RES-1 | PENDING |
| 6 | VPS/Coolify capacity has been checked | Must verify at RES-1 time |
| 7 | Security model has been reviewed | Must verify at RES-1 time |
| 8 | Provider official documentation has been re-verified at implementation time | Must verify at RES-1 time (pricing, APIs, terms may have changed) |

**Do NOT auto-start RES-1 when conditions become true.** The entry gate identifies eligibility. Owner approval starts implementation.

---

## 3. Additional RES-2 Gate (SearXNG Deployment)

Before SearXNG can be deployed in RES-2, additionally require:

| # | Condition |
|---|-----------|
| 1 | VPS resource check (CPU, RAM, disk, network) |
| 2 | Persistent deployment plan (Coolify/Docker) |
| 3 | Backup plan (SearXNG config, not data) |
| 4 | Rollback plan |
| 5 | TLS / reverse proxy design |
| 6 | Private access decision (SearXNG must NOT be publicly exposed) |
| 7 | Rate-limit policy |
| 8 | Container/image version pinning |
| 9 | Health check design |
| 10 | Config backup strategy |

---

## 4. Stage Plan

| Stage | Description | Status | Dependencies |
|-------|-------------|--------|-------------|
| RES-0 | Free-First Research Intelligence Foundation — vision, architecture, provider strategy, security, trust model, roadmap, config templates | ✓ Done (2026-08-07) | — |
| RES-1 | Research Gateway Core + Official Source Fetcher — provider-neutral gateway, source strategy, provider router, official source fetcher with SSRF protection, redaction guard, audit skeleton, config loading | Planned | RES-1 entry gate satisfied |
| RES-2 | Private SearXNG Deployment + Adapter — Coolify/Docker deployment of private SearXNG, adapter implementation, health checks, engine configuration | Planned | RES-1 complete + RES-2 additional gate satisfied |
| RES-3 | Source Trust + Citation + Research Cache — trust scorer, freshness evaluator, citation normalizer, research cache with TTL-based expiry, cache key privacy | Planned | RES-2 complete |
| RES-4 | Optional Free-Quota Provider Adapters — Brave Search API adapter, Tavily API adapter, provider config, rate limit handling, quota tracking | Planned | RES-3 complete + provider re-evaluated |
| RES-5 | Deep Research Orchestration + Optional Premium Provider — multi-step research, Perplexity adapter (optional), deep research workflow, provider fallback chains | Planned | RES-4 complete |
| RES-6 | Research Monitoring, Analytics and Optimisation — research dashboard, cost analytics, provider performance, cache efficiency, query patterns | Planned | RES-5 complete |

---

## 5. Stage Details

### RES-0 — Free-First Research Intelligence Foundation ✓

**Status:** Complete (2026-08-07)

**Deliverables:**
- `projects/research-intelligence/README.md`
- `docs/MYTHOS_RESEARCH_INTELLIGENCE_VISION.md`
- `docs/MYTHOS_RESEARCH_INTELLIGENCE_ARCHITECTURE.md`
- `docs/RESEARCH_PROVIDER_STRATEGY.md`
- `docs/RESEARCH_SECURITY_AND_PRIVACY.md`
- `docs/RESEARCH_SOURCE_TRUST_AND_CITATIONS.md`
- `docs/RESEARCH_ROADMAP.md` — this file
- `projects/research-intelligence/config/research.example.json`
- `projects/research-intelligence/config/providers.example.json`
- `docs/ROADMAP.md` updated
- `docs/AI_HANDOVER.md` updated

**No implementation.** No code. No deployment. No provider accounts. No API keys.

---

### RES-1 — Research Gateway Core + Official Source Fetcher (Planned)

**Prerequisites:** RES-1 entry gate satisfied

**Objective:** Build the provider-neutral Research Gateway and Official Source Fetcher.

**Scope:**
- Research Gateway interface
- Source Strategy implementation
- Provider Router skeleton
- Official Source Fetcher with SSRF protection
- Redaction Guard
- Research Audit skeleton
- Research Budget Guard (config-driven)
- Config loading from environment
- Unit and integration tests

**Explicitly NOT in RES-1:**
- Any search provider adapter (SearXNG, Brave, Tavily, Perplexity)
- Research cache
- Source trust scoring
- Deep research orchestration
- Production deployment to end users

---

### RES-2 — Private SearXNG Deployment + Adapter (Planned)

**Prerequisites:** RES-1 complete + RES-2 additional gate

**Objective:** Deploy private SearXNG and build the adapter.

**Scope:**
- Coolify/Docker SearXNG deployment
- Reverse proxy and TLS configuration
- Private access enforcement
- SearXNG adapter implementation
- Engine configuration (appropriate engines for Mythos needs)
- JSON search API integration
- Health checks
- Rate limiting
- Configuration backup

---

### RES-3 — Source Trust + Citation + Research Cache (Planned)

**Prerequisites:** RES-2 complete

**Objective:** Implement source trust scoring, citation normalisation, and research caching.

**Scope:**
- Source Trust Scorer implementation
- Freshness Evaluator implementation
- Citation Normalizer implementation
- Research Cache with TTL-based expiry
- Cache key privacy enforcement
- Authoritative domain configuration

---

### RES-4 — Optional Free-Quota Provider Adapters (Planned)

**Prerequisites:** RES-3 complete + provider docs re-verified

**Objective:** Add Brave Search and Tavily adapters as optional fallback providers.

**Scope:**
- Brave Search API adapter
- Tavily API adapter
- Provider configuration
- Rate limit and quota tracking
- Provider health monitoring

---

### RES-5 — Deep Research Orchestration + Optional Premium (Planned)

**Prerequisites:** RES-4 complete

**Objective:** Multi-step deep research and optional Perplexity adapter.

**Scope:**
- Multi-step research orchestration
- Perplexity adapter (optional, behind budget guard)
- Provider fallback chains
- Deep research workflow

---

### RES-6 — Research Monitoring, Analytics and Optimisation (Planned)

**Prerequisites:** RES-5 complete

**Objective:** Operational visibility and optimisation.

**Scope:**
- Research dashboard
- Cost analytics
- Provider performance monitoring
- Cache efficiency metrics
- Query pattern analysis

---

## 6. Dependency Map

```
RES-1 Entry Gate
  ├── MPI-0 merged
  ├── INF-OVH-API-0 complete OR re-prioritised
  └── Owner authorisation
        │
        ▼
    [RES-1: Research Gateway Core]
        │
        ▼
    RES-2 Gate (VPS, TLS, backup plan)
        │
        ▼
    [RES-2: SearXNG Deployment]
        │
        ▼
    [RES-3: Trust + Citation + Cache]
        │
        ▼
    [RES-4: Brave + Tavily Adapters]
        │
        ▼
    [RES-5: Deep Research + Perplexity]
        │
        ▼
    [RES-6: Monitoring + Analytics]
```

---

## 7. Current State Summary

| Item | Status |
|------|--------|
| RES-0 Foundation | ✓ Complete (docs only) |
| MPI-0 PR #4 | PENDING MERGE (Draft PR) |
| INF-OVH-API-0 | PENDING — next Automation stage |
| RES-1 Entry Gate | ◇ NOT SATISFIED |
| RES-1 | ◇ NOT AUTHORISED |
| RES-2 through RES-6 | ◇ NOT AUTHORISED |
| SearXNG deployed | NO |
| Provider API keys | NONE |

---

## 8. Relationship to Current Mythos Priorities

Research Intelligence is a platform capability that does not alter the current priority order:

1. Mythos OS: complete through Stage 4AG + RUNTIME-DUPLICATE-CLEANUP-0 (corrected 2026-08-10, `MYTHOS-STAGE-RECONCILIATION-0` — this line originally read "Stage 3E → 3F → 3G," stale since all three were already complete since 2026-07-30); no further Mythos OS Runtime stage currently authorised
2. ID Auto: IDA-2 (Phase A complete 2026-08-10; Phase B not started)
3. Atelier Network: ATN-1
4. AutoValeur: AVA-1
5. Automation: INF-OVH-API-0 (next)
6. Research Intelligence: RES-0 complete — **RES-1 NOT AUTHORISED**

Research Intelligence implementation is deferred until its entry gate is satisfied and no other major implementation stage is active.