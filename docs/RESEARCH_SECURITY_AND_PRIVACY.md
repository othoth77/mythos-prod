# Mythos Research Intelligence — Security and Privacy

**Stage:** RES-0 — Free-First Research Intelligence Foundation
**Status:** Security architecture specification. No runtime implementation.
**Date:** 2026-08-07

---

## 1. Context Minimisation

Before any external research request leaves Mythos infrastructure, context must be minimised. External providers receive only the query needed to fulfil the research intent — never the full conversation context, user profile, organisation data, or internal records.

### Before External Transmission

```
Full context (internal)
    ↓
Context Assembler
    ↓
Minimise: extract only the research question
    ↓
Redact: remove PII, identifiers, internal data
    ↓
Classify: is this safe for external transmission?
    ↓
Research Gateway → external provider
```

### Redaction Rules

Always remove before external transmission:

| Category | Examples |
|----------|----------|
| Personal identifiers | Names, emails, phone numbers, addresses |
| Customer records | Client names, vehicle registration numbers, phone numbers |
| Business data | Invoice numbers, amounts, client lists |
| Internal identifiers | User IDs, organisation IDs, session tokens |
| Private documents | Full document content, internal reports |
| Organisation secrets | API credentials, internal URLs, private IPs |
| Location data | Precise GPS coordinates, home addresses |

### Query Transformation Examples

| Internal Context (NEVER sent externally) | Transformed Query (SAFE to send) |
|-------------------------------------------|----------------------------------|
| "Client Ahmed with phone +216-XX-XXX-XXX has a 2022 Korando that needs..." | "Search official technical bulletins for 2022 SsangYong Korando diesel engine common issues" |
| "Teacher Amina at École X needs lesson plans for..." | "Search official Tunisian mathematics curriculum for 2ème année secondaire algebra unit" |
| "Our organisation's internal policy document says..." | "Search industry standards for..." |

---

## 2. SSRF Protection (Future URL Fetching)

Any component that fetches external URLs (Official Source Fetcher, Content Extractor) must enforce strict Server-Side Request Forgery (SSRF) protection.

### Blocked Destinations

Must reject connections to:

| Category | Addresses |
|----------|-----------|
| Localhost IPv4 | `127.0.0.0/8` |
| Localhost IPv6 | `::1` |
| Private IPv4 | `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` |
| Link-local | `169.254.0.0/16` |
| Cloud metadata | `169.254.169.254` (AWS, GCP, Azure, OVH, etc.) |
| Docker networks | `172.17.0.0/16` (default), any custom Docker bridge |
| Internal VPS services | Any internal service IP/hostname |

### Blocked Schemes

| Scheme | Allowed? |
|--------|----------|
| `https://` | YES (primary) |
| `http://` | Conditional — only where explicitly permitted by policy |
| `file://` | NO |
| `ftp://` | NO |
| `gopher://` | NO |
| `data:` | NO |
| `javascript:` | NO |
| `dict://` | NO |

### Fetch Constraints

| Constraint | Requirement |
|------------|-------------|
| DNS rebinding protection | Resolve hostname once; validate resolved IP against blocked ranges |
| Redirect limit | Maximum 5 redirects |
| Redirect host revalidation | Re-validate host on each redirect — reject if blocked |
| Response size limit | Configurable maximum (e.g., 10 MB) |
| Content-type validation | Only expected types (text/html, application/json, text/plain) |
| Timeout | Configurable per request (default 30s) |
| Abort | All fetches must be abortable |
| HTML sanitisation | Strip scripts, iframes, event handlers before storage |
| No browser JS execution | Content extraction is server-side; no JavaScript evaluation |
| No credential forwarding | External requests use fresh connections; no user cookies or auth |
| Safe User-Agent | Identify as Mythos Research (not impersonating a browser) |
| Audit metadata | Log source URL, response status, size, timing per fetch |

---

## 3. Provider Credential Security

### Credential Storage

- API keys and provider credentials are NEVER stored in source code
- NEVER committed to the repository
- NEVER in example config files
- NEVER in documentation
- Injected at deployment time via environment variables or approved Mythos secret manager

### Credential Access

- Only the Research Gateway (and Automation for health checks) may access provider credentials
- Credentials are scoped to the minimum required permissions
- Provider-specific credentials are never shared across providers

---

## 4. Research Cache Security

### Cache Key Privacy

Cache keys must NOT include:
- User identifiers (PII)
- Organisation-specific context
- Session identifiers
- IP addresses
- Any data that could link a cached result to a specific user

Cache keys MAY include:
- Normalised query text (after redaction check)
- Provider-independent intent
- Freshness requirement class
- Language
- Domain filter
- Safe search settings

### Cache Isolation

- Sensitive/private research defaults to `NO_CACHE`
- Per-organisation private cache may be considered in future stages — but cache isolation must be cryptographically enforced, not policy-enforced
- Never allow cross-organisation cache access

---

## 5. Audit Privacy

### What to Log

- Research action metadata (timing, provider, status)
- Query hash (SHA-256) — enables deduplication without storing query text
- Source count and authoritative source count
- Cache status
- Cost class
- Error class (if any)

### What NOT to Log

- Raw query text (hash only)
- Full result content
- User PII
- Organisation private data
- IP addresses of internal services

---

## 6. Data Minimisation

- Collect only what is pedagogically/operationally necessary
- Research results are evidence for reasoning, not permanent records
- Cached results have expiration; no indefinite storage of external content
- User may request deletion of research history (future)

---

## 7. Tenant Isolation

When Research Intelligence is used in multi-tenant contexts:

- One organisation's research cache must never be accessible to another organisation
- Research queries from one organisation must never include context from another
- Audit logs must respect tenant boundaries
- Budget tracking must be per-organisation where applicable

---

## 8. Future Legal Compliance

When Research Intelligence enters production use:

- Tunisian data protection law (INPDP) applies
- GDPR-equivalent standards for any European users
- Provider terms of service must be reviewed for each active provider
- Data processing agreements may be required for external providers (Tier 3/4)

---

## 9. Security Architecture Decisions

### RES-SEC-1

**External context is always minimised before transmission.**

No external provider receives full conversation context, user profile, or organisation data.

### RES-SEC-2

**SSRF protection is mandatory, not optional.**

Any component that fetches external URLs enforces network access controls. No exceptions.

### RES-SEC-3

**Provider credentials are never in source code or repository.**

API keys are injected at deployment time only.

### RES-SEC-4

**Research cache keys exclude user identity.**

Cache is content-addressable by query characteristics only.

### RES-SEC-5

**Audit logs use query hashes, not raw queries.**

Prevents sensitive query content from being stored in audit records.