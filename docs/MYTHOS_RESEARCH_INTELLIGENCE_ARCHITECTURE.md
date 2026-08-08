# Mythos Research Intelligence — Architecture

**Stage:** RES-0 — Free-First Research Intelligence Foundation
**Status:** Draft architecture. No runtime implementation. No deployment.
**Date:** 2026-08-07

---

## Important Notice

This document records the **architectural design** for Mythos Research Intelligence. No component is implemented. No service is deployed. These are interface contracts and component specifications only.

---

## 1. Research Gateway

The central component that routes research requests through the appropriate provider strategy.

### Conceptual Interface

```
ResearchGateway
  ├── accept(researchRequest: ResearchRequest): Promise<ResearchResult>
  ├── cancel(runId: string): void
  └── status(runId: string): ResearchStatus
```

### ResearchRequest

```
ResearchRequest {
  researchId: string           // unique identifier for this research action
  runId: string                // unique run identifier for idempotency
  intent: ResearchIntent       // research.web | research.official | research.deep | research.market | research.technical
  query: string                // the actual search/retrieval query (already minimised/privacy-filtered)
  requiredFreshness: FreshnessClass  // STATIC | SLOW_CHANGING | CURRENT | HIGH_FRESHNESS
  language: string?            // preferred language for results
  domain: string?              // preferred domain filter for results
  maxResults: number           // maximum results to return (default: 10)
  maxCost: CostClass?          // maximum acceptable cost class (FREE | QUOTA | PREMIUM)
  cacheTTL: number?            // override default cache TTL in seconds
  sourcePreferences: string[] // preferred source domains (e.g., ['docs.python.org', 'github.com'])
  userReference: string?       // opaque user reference for audit (never PII)
  organisationReference: string? // opaque org reference for audit
}
```

### ResearchResult

```
ResearchResult {
  researchId: string
  runId: string
  status: ResultStatus          // SUCCESS | PARTIAL | TIMEOUT | ERROR
  results: ResearchSource[]     // ordered list of sources with evidence
  citations: Citation[]         // normalised citations
  metadata: ResearchMetadata    // timing, cost, provider, cache status
}
```

---

## 2. Source Strategy

```
SourceStrategy
  ├── determineProvider(researchRequest, budgetPolicy): ProviderPlan
  └── fallbackChain(primaryProvider): Provider[]
```

The Source Strategy component decides which provider(s) to use based on:

- The required freshness class
- The intent type (official source fetch vs general web vs deep research)
- The budget policy in effect (FREE_ONLY, FREE_PREFERRED, BALANCED, PREMIUM_ALLOWED)
- Provider availability and health
- Whether cached results are fresh enough

Provider order is defined by policy, not hardcoded:

```
TIER 0: Internal authoritative data
TIER 1: Official source fetcher
TIER 2: Private SearXNG
TIER 3: Free/quota API providers (Brave, Tavily)
TIER 4: Premium providers (Perplexity)
```

---

## 3. Provider Router

```
ProviderRouter
  ├── route(providerPlan: ProviderPlan): ProviderResult[]
  ├── health(): ProviderHealthStatus
  └── fallback(failedProvider: Provider, error: Error): Provider
```

Routes to the appropriate provider adapter based on the Source Strategy's plan. Handles provider failures transparently by switching to fallback providers.

---

## 4. Official Source Fetcher

```
OfficialSourceFetcher
  ├── fetch(sourceUrl: string, options: FetchOptions): FetchResult
  └── resolveOfficialSource(domain: string, intent: ResearchIntent): OfficialSource
```

Directly fetches content from known authoritative URLs. Used when the task identifies a specific official source rather than requiring a general web search.

Examples of official source domains:
- `docs.python.org`
- `developer.mozilla.org`
- `github.com/org/repo` (official repository)
- Government/manufacturer domains (whitelist-defined)
- Standards body domains

All fetching is subject to SSRF protection (see `docs/RESEARCH_SECURITY_AND_PRIVACY.md`).

---

## 5. SearXNG Adapter

```
SearXNGAdapter
  ├── search(query: string, options: SearchOptions): SearchResult[]
  └── health(): ProviderHealthStatus
```

Adapter for a self-hosted, private SearXNG instance.

Architecture target (future, RES-2):
```
Internet → SearXNG engines → SearXNG (private Mythos infra) → Research Gateway
```

SearXNG must NOT be exposed publicly. It is an internal Mythos service accessed only by the Research Gateway.

---

## 6. Provider Adapters (Tier 3, Tier 4)

```
BraveAdapter implements ResearchProvider
TavilyAdapter implements ResearchProvider
PerplexityAdapter implements ResearchProvider
```

Each adapter:
- Converts the Research Gateway's provider-neutral query format to the provider's API format
- Handles authentication (API key from secure config — never hardcoded)
- Respects rate limits and quotas
- Normalises results into the standard `ResearchSource` format
- Reports errors in a provider-neutral way

Providers are interchangeable behind the `ResearchProvider` interface.

---

## 7. Source Trust Scorer

```
SourceTrustScorer
  ├── score(source: ResearchSource): TrustScore
  └── classify(domain: string, publisher: string): TrustClass
```

Evaluates source credibility based on:

- **Domain classification**: known authoritative domains, known high-quality domains
- **Publisher**: recognised institutions, professional organisations
- **Source type**: official documentation, academic publication, industry publication, community
- **Verification status**: independently verified, unverified
- **Not domain popularity**: trust is not a function of traffic

Trust classes:

| Class | Description | Example |
|-------|-------------|---------|
| AUTHORITATIVE | Official provider, government, mfr, standards body, official repo | `docs.python.org`, `github.com/kubernetes/kubernetes` |
| HIGH | Recognised academic institution, established professional org, high-quality specialised publication | IEEE, ACM, established industry pubs |
| MEDIUM | Reputable technical site, industry publication | Well-known tech blogs, industry analyses |
| COMMUNITY | Forum, community discussion, social/community source | Stack Overflow, Reddit, forums |
| UNKNOWN | Unverified source | Unknown domains, first-seen sources |

---

## 8. Freshness Evaluator

```
FreshnessEvaluator
  ├── evaluate(source: ResearchSource, requiredFreshness: FreshnessClass): FreshnessResult
  └── isFreshEnough(result: FreshnessResult, required: FreshnessClass): boolean
```

Different tasks need different freshness:

| Freshness Class | Typical Use | Example |
|-----------------|-------------|---------|
| STATIC | Standards, historic definitions | HTTP spec, TCP protocol definition |
| SLOW_CHANGING | Product documentation, organisational guidance | SearXNG installation guide |
| CURRENT | Pricing, API features, active service status | Current Brave Search API free quota |
| HIGH_FRESHNESS | Breaking incidents, outages, rapidly changing info | Service outage status, breaking news |

The Intent Architect or Research Gateway may set `requiredFreshness`. Search should prefer evidence appropriate to that requirement. Not all searches need real-time results.

---

## 9. Content Extractor

```
ContentExtractor
  ├── extract(source: ResearchSource): ExtractedContent
  └── sanitize(rawHtml: string): SafeContent
```

Extracts meaningful text content from retrieved sources. Handles:
- HTML sanitisation (no browser JavaScript execution)
- Main content extraction (boilerplate removal)
- Encoding normalisation
- Truncation at configurable limits

---

## 10. Citation Normalizer

```
CitationNormalizer
  ├── normalize(source: ResearchSource): Citation
  └── deduplicate(citations: Citation[]): Citation[]
```

Produces consistent citation metadata regardless of which provider retrieved the source:

```
Citation {
  citationId: string
  title: string
  url: string              // canonical URL
  retrievedUrl: string     // URL actually fetched (may differ after redirects)
  sourceType: SourceType   // OFFICIAL_DOC | ACADEMIC | BLOG | FORUM | etc.
  publisher: string?
  publishedAt: string?     // ISO-8601
  updatedAt: string?       // ISO-8601
  retrievedAt: string      // ISO-8601
  trustClass: TrustClass
  trustScore: number       // 0.0 - 1.0
  freshnessResult: FreshnessResult
  excerpt: string?         // relevant excerpt, not full content
  provider: string         // which provider retrieved this
}
```

---

## 11. Research Cache

```
ResearchCache
  ├── get(key: CacheKey): ResearchResult?
  ├── put(key: CacheKey, result: ResearchResult, ttl: number): void
  └── invalidate(key: CacheKey): void
```

Reduces cost, latency, and provider usage by caching research results.

Cache key components:
- Normalised query (case-folded, punctuation-normalised)
- Provider-independent intent
- Freshness requirement
- Language
- Domain filter
- Safe search settings

Cache key must NOT include:
- User identifiers (PII)
- Organisation-specific context
- Session identifiers that could link to a specific user

Expiry classes:
- `STATIC` — long TTL (weeks+)
- `LONG` — hours to days
- `MEDIUM` — minutes to hours
- `SHORT` — seconds to minutes
- `NO_CACHE` — never cache (sensitive/private research)

Sensitive or private research defaults to `NO_CACHE` or a tightly scoped private cache.

---

## 12. Redaction Guard

```
RedactionGuard
  ├── sanitize(context: RawContext): MinimizedContext
  └── validate(query: string): ValidationResult
```

Ensures that external providers receive only the minimal query. Before any external research call:

1. Minimise context to only what is needed for this specific query
2. Redact any PII, business data, or internal identifiers
3. Classify the sanitised query as safe for external transmission
4. Validate that no unexpected patterns remain

See `docs/RESEARCH_SECURITY_AND_PRIVACY.md` §"Context Minimisation" for detailed rules.

---

## 13. Research Audit

```
ResearchAudit
  ├── log(action: ResearchAction): void
  └── query(filters: AuditFilter): AuditRecord[]
```

Logs meaningful research actions without storing unnecessary private data:

```
ResearchAction {
  researchId: string
  runId: string
  userReference: string?     // opaque, never PII
  organisationReference: string?
  intent: ResearchIntent
  provider: string
  queryHash: string           // SHA-256 of normalised query (not raw query)
  sourcesCount: number
  authoritativeSourcesCount: number
  startedAt: ISO-8601
  completedAt: ISO-8601
  cacheStatus: CacheStatus    // HIT | MISS | BYPASSED
  resultStatus: ResultStatus
  errorClass: string?
  costClass: CostClass
  citationCount: number
}
```

Never store raw private prompts or full query text unnecessarily. The query hash enables deduplication without storing sensitive query content.

---

## 14. Research Budget Guard

```
ResearchBudgetGuard
  ├── allow(researchRequest: ResearchRequest, budgetPolicy: BudgetPolicy): boolean
  └── estimateCost(researchRequest: ResearchRequest): CostEstimate
```

Enforces the free-first budget policy.

Budget modes:

| Mode | Description |
|------|-------------|
| FREE_ONLY | Only free providers (official sources, SearXNG). No API quota usage. |
| FREE_PREFERRED | Try free first; use quota providers only if free is insufficient. |
| BALANCED | Use appropriate provider for the task class; premium only when justified. |
| PREMIUM_ALLOWED | Any provider permitted within budget caps. |

The Budget Guard may:
- Reject a premium provider request in FREE_ONLY mode
- Route to a free alternative when premium is not justified
- Enforce per-session or per-period cost caps

---

## 15. Provider-Neutral Research Source

```
ResearchSource {
  sourceId: string
  title: string
  url: string
  snippet: string
  publishedDate: string?
  trustClass: TrustClass
  trustScore: number
  provider: string           // which provider retrieved this
  providerRawMetadata: object? // provider-specific metadata (optional)
  retrievedAt: string
}
```

Every research result, regardless of which provider retrieved it, is normalised into this format. This enables provider switching without changing consumer code.

---

## 16. Architecture Decisions

### RES-AD-1 (Provisional)

**Research provider ≠ Reasoning model.**

Research retrieval and reasoning/generation are separate concerns with separate architectural layers.

### RES-AD-2 (Provisional)

**Free-first provider order is policy, not hardcoded.**

The Source Strategy selects providers based on configurable budget policy, not hardcoded fallback chains.

### RES-AD-3 (Provisional)

**`research.web` is the capability; providers are implementation details.**

Consumers request `research.web` or `research.official`. The Research Gateway selects the provider. There is no `perplexity-search` skill or `brave-search` skill as separate end-user capabilities.

### RES-AD-4 (Provisional)

**Privacy boundary is before any external call.**

Context minimisation and redaction happen at the Research Gateway level, before any provider adapter receives data.

### RES-AD-5 (Provisional)

**SSRF protection is mandatory for any URL fetching.**

Any component that fetches external URLs must enforce strict network access controls.

### RES-AD-6 (Provisional)

**Cache keys exclude user identity.**

Research cache is content-addressable by query characteristics only. It must not embed user identifiers that could leak across users.

### RES-AD-7 (Provisional)

**Provider credentials are never in source code.**

API keys, tokens, and provider credentials are injected at deployment time via environment variables or approved secret manager. No provider example config contains real credentials.

### RES-AD-8 (Provisional)

**Personal Intelligence and Research Intelligence are separate layers.**

MPI owns *what* to retrieve and *for whom*. RES owns *how* to retrieve it safely. Do not merge their responsibilities.