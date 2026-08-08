# Mythos Research Intelligence — Source Trust and Citations

**Stage:** RES-0 — Free-First Research Intelligence Foundation
**Status:** Trust model and citation specification. No runtime implementation.
**Date:** 2026-08-07

---

## 1. Source Trust Model

Every research result carries a trust classification independent of which provider retrieved it. Trust is assigned by the Source Trust Scorer — not by the search provider.

### Trust Classes

| Class | Description | Examples |
|-------|-------------|----------|
| AUTHORITATIVE | Official provider, government, manufacturer, standards body, official repository | `docs.python.org`, `github.com/kubernetes/kubernetes`, `iso.org`, government domains, manufacturer official sites |
| HIGH | Recognised academic institution, established professional organisation, high-quality specialised publication | IEEE, ACM, established peer-reviewed journals, major industry standards bodies |
| MEDIUM | Reputable technical site, industry publication with editorial standards | Well-known tech publications, industry analysis firms with track records |
| COMMUNITY | Forum, community discussion, social/community source, user-generated content | Stack Overflow, GitHub issues/discussions, Reddit, forums, wikis |
| UNKNOWN | Unverified source, first-seen domain, no established reputation | Unknown domains, personal blogs without track record, unverified sources |

### Trust Scoring

```
TrustScore (0.0 - 1.0) =
  baseClassScore (from trust class)
  + domainReputation
  + publisherReputation
  - freshnessPenalty (if outdated for required freshness)
  + verificationBonus (if independently verified)
```

- **AUTHORITATIVE** sources never receive a trust score below 0.8
- **UNKNOWN** sources never receive a trust score above 0.3
- Community sources are not inherently untrustworthy — they are classified appropriately for their domain
- Trust score is NOT domain popularity or PageRank

### What Trust Score IS NOT

- NOT domain popularity / traffic
- NOT SEO ranking
- NOT provider-specific ranking
- NOT a judgement of content accuracy (that's the reasoning model's job)
- NOT static — trust can be updated as domains are re-evaluated

---

## 2. Source Metadata

Every retrieved source carries:

```
ResearchSource {
  sourceId: string
  title: string
  url: string                    // canonical URL
  retrievedUrl: string           // URL actually fetched (may differ after redirects)
  sourceType: SourceType         // OFFICIAL_DOC | ACADEMIC_PAPER | TECH_BLOG | FORUM | NEWS | etc.
  publisher: string?             // identified publisher/organisation
  canonicalUrl: string?          // canonical URL if different
  publishedAt: string?           // ISO-8601
  updatedAt: string?             // ISO-8601
  retrievedAt: string            // ISO-8601
  trustClass: TrustClass
  trustScore: number             // 0.0 - 1.0
  freshnessResult: FreshnessResult
  excerpt: string?               // relevant excerpt
  provider: string               // which provider retrieved this
  providerRawMetadata: object?   // provider-specific metadata (optional)
}
```

---

## 3. Freshness Model

Different research tasks require different levels of freshness. Not all searches need real-time results.

### Freshness Classes

| Class | Typical Use | Example Queries | Default Cache TTL |
|-------|-------------|-----------------|-------------------|
| STATIC | Standards, historic definitions, fundamental concepts | "HTTP/1.1 specification", "TCP protocol definition" | 30 days |
| SLOW_CHANGING | Product documentation, organisational guidance | "SearXNG installation guide", "PostgreSQL configuration best practices" | 7 days |
| CURRENT | Pricing, API features, active service status, version-dependent docs | "Current Brave Search API free quota", "Latest SearXNG release version" | 6 hours |
| HIGH_FRESHNESS | Breaking incidents, outages, rapidly changing information | "Is service X currently experiencing an outage?", "Latest security advisory for..." | 15 minutes |

### Freshness Assignment

The Intent Architect or Research Gateway assigns `requiredFreshness` based on:
- The type of question being asked
- Whether the task involves pricing, versions, or status
- Whether cached results could be misleading if stale

---

## 4. Citation Format

All research results produce normalised citations regardless of provider.

### Citation Structure

```
Citation {
  citationId: string
  title: string
  url: string                    // canonical URL
  retrievedUrl: string           // URL actually fetched
  sourceType: SourceType
  publisher: string?
  publishedAt: string?           // ISO-8601 when available
  updatedAt: string?             // ISO-8601 when available
  retrievedAt: string            // ISO-8601
  trustClass: TrustClass
  trustScore: number
  freshnessClass: FreshnessClass
  excerpt: string?               // relevant excerpt, not full content
  provider: string               // which provider retrieved this
}
```

### Citation Deduplication

Multiple providers may retrieve the same source. The Citation Normalizer deduplicates by:
1. Normalised URL (canonical form, stripped tracking params)
2. Same title + same domain (fuzzy match)
3. Prefer the version with more metadata (e.g., published date, publisher)

The deduplicated result retains the first provider that retrieved it and notes if multiple providers confirmed the same source.

---

## 5. Source Type Classification

| Source Type | Description | Default Trust Class |
|-------------|-------------|---------------------|
| OFFICIAL_DOC | Official documentation from the product/technology owner | AUTHORITATIVE |
| OFFICIAL_REPO | Official source code repository | AUTHORITATIVE |
| GOVERNMENT | Government website, official publication | AUTHORITATIVE |
| STANDARD | Standards body publication (ISO, W3C, IETF, etc.) | AUTHORITATIVE |
| MANUFACTURER | Manufacturer official site or documentation | AUTHORITATIVE |
| ACADEMIC_PAPER | Peer-reviewed academic publication | HIGH |
| PROFESSIONAL_ORG | Established professional organisation publication | HIGH |
| INDUSTRY_PUB | Industry publication with editorial standards | MEDIUM |
| TECH_BLOG | Technical blog with known publisher | MEDIUM |
| NEWS | News article from recognised outlet | MEDIUM |
| FORUM | Community forum discussion | COMMUNITY |
| Q_A | Q&A platform (Stack Overflow, etc.) | COMMUNITY |
| WIKI | Community wiki | COMMUNITY |
| SOCIAL | Social media content | COMMUNITY |
| PERSONAL_BLOG | Personal blog without established track record | UNKNOWN |
| UNKNOWN | Unclassifiable source | UNKNOWN |

---

## 6. Trust Model Governance

- The authoritative domain whitelist is configurable per organisation in future stages
- Trust class assignments may be reviewed and updated
- A domain that is AUTHORITATIVE for one purpose (e.g., official API docs) may be COMMUNITY for another (e.g., its community forum on the same domain) — trust is URL-path-aware
- Trust model updates require audited changes, not runtime learning

---

## 7. Non-Goals

- Trust scoring does NOT evaluate content accuracy
- Citation does NOT replace the reasoning model's judgment about source quality
- Freshness is a retrieval concern, not an accuracy concern — a fresh result may be wrong; a stale result may still be correct
- Source trust metadata is advisory for the reasoning model, not prescriptive