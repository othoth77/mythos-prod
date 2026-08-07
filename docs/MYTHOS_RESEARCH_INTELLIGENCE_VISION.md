# Mythos Research Intelligence — Vision

**Stage:** RES-0 — Free-First Research Intelligence Foundation
**Status:** Strategic architecture direction. Documentation and config templates only. No production runtime, no deployment, no provider accounts.
**Date:** 2026-08-07
**Branch:** `docs/research-intelligence-foundation` (not merged to `main`)

---

## 1. The Strategic Direction

> **Mythos Research Intelligence is the free-first, provider-independent external research capability. It enables Mythos agents and users to retrieve fresh, citable external information safely — without locking the platform to any single search provider.**

Mythos must be able to answer questions that require current external information: what is the latest version of this API? what does the official documentation say? is this service currently experiencing an outage? what are the current pricing details for this provider? what are the requirements for deploying service X on platform Y?

This capability must be:

- **Free-first** — use internal, official, and free providers before incurring cost
- **Provider-independent** — Perplexity, Brave, Tavily, SearXNG are provider choices, not architectural constraints
- **Source-aware** — every retrieved fact carries provenance metadata
- **Privacy-aware** — external providers receive only the minimal query, never user PII or business data
- **Auditable** — meaningful research actions are logged

---

## 2. Why This Architecture Exists

Without a Research Intelligence layer, every Mythos AI feature that needs external information would independently call a search API — duplicating cost, leaking context differently in each integration, and creating silent provider lock-in.

A single Research Gateway ensures:

1. **One cost-control point** — the Budget Guard applies free-first logic exactly once
2. **One privacy boundary** — context minimisation/redaction happens before any external call
3. **One trust model** — source credibility scoring is consistent across the platform
4. **One cache** — duplicate research across users/sessions is deduplicated once
5. **One audit trail** — all external research is logged in one place

---

## 3. What Research Intelligence IS

- A provider-neutral gateway for retrieving external information
- A source-trust system that classifies and scores information provenance
- A freshness model that matches retrieval strategy to information volatility
- A privacy boundary that minimises context before external calls
- A cache layer that reduces cost and latency for repeat research
- An audit trail for external information retrieval
- A component of the shared platform, used by any Mythos agent or user

---

## 4. What Research Intelligence IS NOT

- A general-purpose web scraper
- A replacement for internal authoritative data
- A Perplexity wrapper
- A Brave Search wrapper
- A Tavily wrapper
- A SearXNG wrapper
- An AI reasoning engine
- A content summarisation engine (that's the reasoning model's job)
- A database of cached documents
- A crawling/indexing service

---

## 5. Free-First Principle

Mythos Research must never incur cost when a free or already-cached answer exists.

Decision logic:

1. **Existing fresh cache** → return cached result (no cost)
2. **Internal authoritative source** → query internal DB (no external cost)
3. **Direct official source** → fetch from official API/docs/repo (no search API cost)
4. **Private SearXNG** → self-hosted, no per-query API cost
5. **Free/free-quota API provider** → use before paid providers
6. **Premium research provider** → only when quality gain is meaningful AND user/policy permits it

"Free" means the query itself incurs no incremental monetary cost. Infrastructure costs (VPS, bandwidth) are considered separately.

---

## 6. Provider Independence

Mythos must NOT depend directly on Perplexity, Brave, Tavily, or any single search provider for core functionality.

```
WRONG:
  User → Perplexity/Claude
  User → Brave Search + Claude

RIGHT:
  User → Intent Architect → research.web → Research Gateway → Source Strategy → multiple providers
```

If a provider changes its API, pricing, or terms, Mythos should be able to route research through alternative providers without changing any consumer code.

---

## 7. Model Independence

Research retrieval and reasoning/generation must remain separate concerns:

```
Research tier:
  SearXNG / Official Source / Brave / Tavily
          ↓
  Evidence + Citations

Reasoning tier:
  Claude / GPT / DeepSeek / future model
          ↓
  Reasoned response
```

No user intelligence should become locked to one model provider.

A research query might retrieve evidence via SearXNG, then reason about it with Claude; or retrieve via an official source fetcher, then reason with DeepSeek. The retrieval layer does not know or care which model will reason about the results.

---

## 8. Integration with Personal Intelligence (MPI-0)

Personal Intelligence is the layer above Research Intelligence:

```
Personal Intelligence (MPI)
  → Intent Architect — "does this task need fresh external info?"
  → Context Assembler — "what minimal context is needed?"
  → Skill Router → research.web / research.official / research.deep
       ↓
Research Intelligence (RES)
  → Research Gateway — "where and how do I get this evidence?"
  → Source Strategy — "which provider(s) for this intent?"
  → Provider Router → SearXNG / Official Fetcher / Brave / Tavily
  → Source Trust + Freshness
  → Content Extraction + Citations
  → Research Cache
       ↓
Evidence package returned to Personal Intelligence
  → Context Compiler
  → Reasoning Model
```

Personal Intelligence owns the *what* and *for whom*. Research Intelligence owns the *how* of retrieval.

**MPI-0 is currently a Draft PR (#4, `feat/mythos-personal-intelligence`).** This Research foundation is designed for future integration with that layer but does not depend on MPI-0 being merged.

---

## 9. Capability Model

Research Intelligence exposes these future capabilities:

| Capability | Description |
|------------|-------------|
| `research.web` | General web research for current, public information |
| `research.official` | Targeted fetch from known official sources (API docs, mfr sites, govt) |
| `research.deep` | Multi-step deep research with provider orchestration |
| `research.market` | Market/pricing research with appropriate freshness requirements |
| `research.technical` | Technical documentation, changelogs, API references |

The Skill Router selects the capability. The Research Gateway selects the provider. Providers are NOT separate end-user capabilities.

---

## 10. What Success Looks Like

Mythos Research Intelligence is successful when:

- A Mythos agent can answer "what's the latest version of SearXNG?" without a Perplexity subscription
- Provider changes (new API, deprecated endpoint, different pricing) affect only one adapter, not every consumer
- A cached research result from 10 minutes ago is reused rather than re-queried
- No user PII or business data leaks to an external search provider
- Every external research action is logged with source trust metadata
- A teacher's lesson-planning research does not share context with an automotive workshop's parts search

---

## 11. Explicit Non-Goals

- Research Intelligence does NOT replace internal authoritative data
- Research Intelligence does NOT crawl the web independently
- Research Intelligence does NOT index documents
- Research Intelligence does NOT summarise or reason about content (that's the model's job)
- Research Intelligence does NOT require Perplexity
- Research Intelligence does NOT bypass the platform permission model