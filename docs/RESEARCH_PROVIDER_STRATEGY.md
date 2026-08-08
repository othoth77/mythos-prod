# Mythos Research Intelligence — Provider Strategy

**Stage:** RES-0 — Free-First Research Intelligence Foundation
**Status:** Provider analysis and strategy. No provider accounts. No API keys. No contracts.
**Date:** 2026-08-07

---

## 1. Provider Strategy

Mythos Research Intelligence is designed around provider independence. No single provider is required for core functionality. The architecture supports multiple providers behind a unified Research Gateway.

### Provider Selection Order (Free-First)

```
1. Existing fresh cache           (no external call, no cost)
2. Internal authoritative data    (Mythos DBs, org docs — no external cost)
3. Official source fetcher        (direct fetch from known authoritative URLs)
4. Private SearXNG                (self-hosted, no per-query API cost)
5. Brave Search API / Tavily API  (free/free-quota tier)
6. Perplexity                     (premium, optional)
```

---

## 2. Tier 0 — Internal Authoritative Data

**Classification:** AUTHORITATIVE
**Provider:** Mythos internal databases
**Status:** Runtime concept — not Research Intelligence responsibility
**Self-hosted:** Yes (existing Mythos infrastructure)
**Privacy class:** INTERNAL
**Supports search:** No (structured queries)
**Supports URL fetch:** No
**Supports deep research:** No
**Supports citations:** N/A
**Requires secret:** No external credentials
**Cost:** Included in existing infrastructure

Internal authoritative data includes Mythos databases, organisation databases, approved internal documents, and user-authorised private sources. Research Intelligence may receive pre-resolved internal facts from other platform components but does not directly query all internal databases.

External search must never silently override internal authoritative facts.

---

## 3. Tier 1 — Official Source Fetcher

**Classification:** OFFICIAL
**Provider:** Direct fetch from known authoritative URLs
**Status:** PLANNED — architecture spec only (RES-1)
**Self-hosted:** Yes (Mythos infrastructure)
**Privacy class:** PRIVATE (outbound connection only, no third-party provider)
**Supports search:** No (targeted fetch from known sources)
**Supports URL fetch:** Yes
**Supports deep research:** No
**Supports citations:** Yes
**Requires secret:** No
**Cost:** Included in existing infrastructure

The Official Source Fetcher directly retrieves content from pre-approved authoritative domains. It does not perform general web search. It is used when the task identifies a specific official source (e.g., "fetch the SearXNG installation docs from docs.searxng.org").

**SSRF protection is mandatory.** See `docs/RESEARCH_SECURITY_AND_PRIVACY.md` §"SSRF Protection".

Domain whitelist is configurable per organisation and environment.

---

## 4. Tier 2 — SearXNG

**Classification:** FREE_SELF_HOSTED
**Provider:** SearXNG (self-hosted)
**Status:** PLANNED — architecture spec only (RES-2)
**Self-hosted:** Yes
**Privacy class:** PRIVATE
**Supports search:** Yes (general web, configurable engines)
**Supports URL fetch:** Via search results
**Supports deep research:** Via multiple queries
**Supports citations:** Yes (URL, title, engine)
**Supports JSON output:** Yes (`format=json`)
**Requires secret:** No (internal service)
**Cost:** Infrastructure only (VPS CPU/RAM/bandwidth)

### SearXNG Overview

SearXNG is a free, open-source, self-hosted metasearch engine that aggregates results from multiple search engines without tracking users. It is the ideal primary web-search provider for Mythos because:

- Zero per-query cost
- Full privacy control (no external tracking of Mythos queries)
- Configurable engine selection
- JSON API output
- Self-hosted on Mythos infrastructure

### Official Documentation

- Main site: `https://docs.searxng.org/`
- Admin docs: `https://docs.searxng.org/admin/`
- Installation (Docker): `https://docs.searxng.org/admin/installation-docker.html`
- API/search: `https://docs.searxng.org/dev/search_api.html`
- Settings reference: `https://docs.searxng.org/admin/settings/`
- Engine configuration: `https://docs.searxng.org/admin/engines/`

### Self-Hosting Requirements (from Official Docs)

Verified at: 2026-08-07
Official source: `https://docs.searxng.org/admin/installation-docker.html`
Subject to change — re-verify before RES-2.

**Docker deployment is the recommended method:**

```yaml
# Conceptual — not a deployment instruction
services:
  searxng:
    image: searxng/searxng:latest
    ports:
      - "8080:8080"
    volumes:
      - ./searxng:/etc/searxng
    environment:
      - SEARXNG_BASE_URL=https://searxng.internal.mythos
```

### Future Deployment Considerations (RES-2)

| Concern | Consideration |
|---------|---------------|
| CPU | Depends on query volume and engine count |
| RAM | 512MB-1GB minimum recommended |
| Disk | Settings + cache; modest requirements |
| Network | Outbound to search engines; inbound from Research Gateway only |
| Reverse proxy | Required for TLS termination |
| Access control | Private only; not exposed to internet |
| Rate limiting | Per-service, not per-user (internal only) |
| Health checks | `/healthz` or `/config` endpoint |
| Logging | stdout; capture via container logging |
| Config backup | `settings.yml`, `limiter.toml`, `uwsgi.ini` |
| Upgrade strategy | Pin image tag; test before production upgrade |
| Rollback | Previous image tag + config backup |
| Security updates | Monitor SearXNG releases; apply promptly |

**Do NOT deploy SearXNG in RES-0.**

---

## 5. Tier 3 — Brave Search API

**Classification:** FREE_QUOTA
**Provider:** Brave Software (`api.search.brave.com`)
**Status:** UNVERIFIED — provider strategy only
**Self-hosted:** No
**Privacy class:** EXTERNAL_PROVIDER
**Supports search:** Yes
**Supports URL fetch:** Via search results
**Supports deep research:** Limited
**Supports citations:** Yes
**Requires secret:** Yes (API key)
**Current status:** Provider not yet evaluated with real API key

### Official Documentation

- API docs: `https://api.search.brave.com/app/documentation`
- Pricing: `https://brave.com/search/api/`

### Pricing Reference (CURRENT_REFERENCE_ONLY — SUBJECT_TO_CHANGE)

Verified at: 2026-08-07
Official source: `https://brave.com/search/api/`
**Subject to change — re-verify before RES-4.**

Free tier: up to 2,000 queries/month
Paid tiers: beyond free quota

### Architecture Notes

- REST API with JSON responses
- Supports web, news, image, and video search
- Returns structured results with URL, title, description
- Requires API key via header

### Usage in Mythos

Brave Search API is a TIER 3 fallback — used only when free providers (SearXNG, official sources) are insufficient for the task. It should be configured as optional and never required for core functionality.

---

## 6. Tier 3 — Tavily API

**Classification:** FREE_QUOTA
**Provider:** Tavily (`api.tavily.com`)
**Status:** UNVERIFIED — provider strategy only
**Self-hosted:** No
**Privacy class:** EXTERNAL_PROVIDER
**Supports search:** Yes (AI-optimised)
**Supports URL fetch:** Yes (content extraction included)
**Supports deep research:** Yes (multi-step)
**Supports citations:** Yes
**Requires secret:** Yes (API key)
**Current status:** Provider not yet evaluated with real API key

### Official Documentation

- API docs: `https://docs.tavily.com/`
- Pricing: `https://tavily.com/#pricing`

### Pricing Reference (CURRENT_REFERENCE_ONLY — SUBJECT_TO_CHANGE)

Verified at: 2026-08-07
Official source: `https://tavily.com/#pricing`
**Subject to change — re-verify before RES-4.**

Free tier: up to 1,000 API calls/month
Paid tiers: beyond free quota

### Architecture Notes

- REST API
- AI-optimised search with content extraction
- Returns structured results with extracted content
- Supports domain filtering and search depth control

### Usage in Mythos

Tavily is a TIER 3 fallback alongside Brave. Its AI-optimised output may be particularly useful for tasks where extracted content (not just URLs and snippets) is valuable.

---

## 7. Tier 4 — Perplexity

**Classification:** PREMIUM
**Provider:** Perplexity AI (`api.perplexity.ai`)
**Status:** OPTIONAL — provider strategy only
**Self-hosted:** No
**Privacy class:** EXTERNAL_PROVIDER
**Supports search:** Yes (AI-augmented)
**Supports URL fetch:** Via search results
**Supports deep research:** Yes (Pro Search)
**Supports citations:** Yes
**Requires secret:** Yes (API key)
**Current status:** Provider not yet evaluated; not required for any Mythos core functionality

### Official Documentation

- API docs: `https://docs.perplexity.ai/`
- Pricing: `https://docs.perplexity.ai/guides/pricing`

### Pricing Reference (CURRENT_REFERENCE_ONLY — SUBJECT_TO_CHANGE)

Verified at: 2026-08-07
Official source: `https://docs.perplexity.ai/guides/pricing`
**Subject to change — re-verify before RES-5.**

Pay-per-use model. No persistent free tier for API access.

### Usage in Mythos

Perplexity is a TIER 4 premium option. It must be:

- **Optional** — no Mythos core functionality may require it
- **Budget-gated** — only when budget policy permits
- **Justified** — only when quality gain over free providers is meaningful
- **Never the default** — SearXNG is the default for generic web search

---

## 8. Provider Summary

| Provider | Tier | Type | Self-Hosted | Per-Query Cost | Requires Secret | Status |
|----------|------|------|-------------|----------------|-----------------|--------|
| Internal DBs | 0 | AUTHORITATIVE | Yes | None | No | Runtime concept |
| Official Fetcher | 1 | OFFICIAL | Yes | None | No | PLANNED (RES-1) |
| SearXNG | 2 | FREE_SELF_HOSTED | Yes | None | No | PLANNED (RES-2) |
| Brave Search | 3 | FREE_QUOTA | No | None (up to quota) | Yes (API key) | UNVERIFIED |
| Tavily | 3 | FREE_QUOTA | No | None (up to quota) | Yes (API key) | UNVERIFIED |
| Perplexity | 4 | PREMIUM | No | Pay-per-use | Yes (API key) | OPTIONAL |

---

## 9. Provider Decision Matrix

For a given research task, the provider is selected by:

1. **Intent type** — `research.official` → Official Source Fetcher; `research.web` → SearXNG or fallback
2. **Freshness requirement** — HIGH_FRESHNESS may bypass cache; STATIC may prefer cached
3. **Budget policy** — FREE_ONLY eliminates Tier 3/4; FREE_PREFERRED tries free first
4. **Provider health** — unavailable providers are skipped transparently
5. **Source preferences** — caller-specified preferred domains may route to specific provider

---

## 10. Non-Goals

- This strategy does NOT commit Mythos to any specific provider contract
- No API keys have been provisioned
- Pricing references are current-as-of-documentation only and may change
- Community/Reddit sources were not used as authoritative evidence
- Tier 3/4 providers are evaluated directionally, not exhaustively tested