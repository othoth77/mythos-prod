# Mythos OS — Cloudflare Edge Security Architecture

**Version:** 1.0 (INF-CF-0)
**Status:** Proposal — documentation only; no deployment performed
**Date:** 2026-08-05

---

## 1. Approved Architecture

```
Users (browser / API client / Telegram)
    │
    ▼
Cloudflare (edge and security gateway)
    ├── DNS
    ├── TLS termination
    ├── CDN (static asset caching)
    ├── DDoS protection (Layer 3/4/7)
    ├── WAF (managed ruleset + custom rules)
    ├── Rate Limiting
    └── Cloudflare Access (identity-aware proxy for private hostnames)
        │
        ▼ (Cloudflare Tunnel — outbound-only, encrypted, no open ports)
    OVH VPS
        │
        ▼
    Coolify (deployment orchestrator)
        ├── Mythos OS application services
        ├── Product services (ID Auto, Atelier Network, AutoValeur, etc.)
        ├── cloudflared container (remotely managed Tunnel)
        ├── PostgreSQL (persistent database)
        ├── Background jobs (Domain Watch WHOIS, scheduled tasks)
        └── Object storage (R2 via Cloudflare API)
```

---

## 2. Architecture Decisions

### 2.1 Unified Edge Gateway

Cloudflare is the unified edge and security gateway for all Mythos-hosted services. Every inbound request passes through Cloudflare before reaching the VPS.

### 2.2 Cloudflare Is Not a Replacement

Cloudflare does not replace:
- OVH VPS (compute and persistent state)
- Coolify (deployment orchestrator)
- PostgreSQL (relational database)
- Background workers and cron-like scheduled jobs
- Application-level authentication, authorisation, or role-based access control (RBAC)
- Backup strategy and external backup destinations

### 2.3 Cloudflare Tunnel (Preferred Ingress)

- A remotely managed Cloudflare Tunnel runs as a `cloudflared` container inside Coolify.
- The Tunnel uses **outbound-only** connectivity — it establishes a persistent connection to Cloudflare's edge. No inbound port is opened on the VPS firewall.
- Application container ports **must not** be exposed publicly when the Tunnel is the approved ingress path.
- Tunnel configuration is managed through the Cloudflare Zero Trust dashboard (remotely managed), not through a local `config.yml` that must be kept in sync.

### 2.4 Cloudflare Access for Administrative Hostnames

- Administrative hostnames (Coolify dashboard, admin panels, n8n, internal APIs) must be protected by Cloudflare Access with **deny-by-default** policies.
- Access policies use identity providers (Google Workspace, GitHub, or equivalent).
- Application-level authentication remains **mandatory** behind Cloudflare Access — Access is a defence-in-depth layer, not a replacement for app auth.

### 2.5 Public Applications

Public-facing applications remain publicly reachable but are protected by:
- WAF managed ruleset
- Custom rate limiting rules
- Application-level controls (authentication, rate limiting, input validation)

### 2.6 TLS Policy

- **SSL Flexible is prohibited.** All traffic between Cloudflare and the origin must be encrypted.
- Direct HTTPS origins must use **Full (strict)** mode — Cloudflare validates the origin certificate against a trusted CA.
- Origin certificates for Full (strict) must be issued by a publicly trusted CA or by Cloudflare Origin CA.
- Tunnel routes using local HTTP between cloudflared and the application container do not require an origin TLS certificate (the Tunnel-to-Cloudflare leg is already encrypted).
- Self-signed origin certificates require separate explicit approval and handling; they are not the approved default for direct HTTPS origins.

### 2.7 WAF and Rate Limiting

- WAF and Cloudflare rate limiting are **layered controls**. They do not replace application-level rate limiting.
- Application-level rate limiting remains required inside Mythos OS for per-tenant, per-endpoint, and per-user throttling.
- Cloudflare rate limiting provides coarse-grained protection at the edge (requests per IP, per path, per hostname).

### 2.8 DNSSEC

- DNSSEC is enabled **only after** a controlled DNS migration to Cloudflare and DS-record verification at the registrar.
- DS-record values must be obtained from the Cloudflare dashboard, verified against the published DS-set, and configured at the domain registrar before DNSSEC is considered operational.

### 2.9 R2 Object Storage

Cloudflare R2 may store:
- Uploaded documents and attachments
- Generated exports (PDFs, CSVs, reports)
- Static assets (images, CSS, JS if served from R2)
- Encrypted backup copies

R2 constraints:
- R2 must **never** be the only backup destination.
- Production backups must also exist in an external, independent location.
- R2 access keys must reside only in Coolify encrypted environment variables or an approved secret manager.

### 2.10 Cloudflare Workers

- Cloudflare Workers are reserved for **small, bounded, stateless edge functions** (e.g., URL rewriting, header injection, lightweight redirects, A/B routing).
- Mythos OS business logic, PostgreSQL queries, and long-running jobs remain on the VPS.
- Workers must not contain database credentials, application secrets, or business logic that belongs on the VPS.

### 2.11 Domain Watch

- The Domain Watch HTTP interface may pass through Cloudflare (WAF, rate limiting, TLS).
- WHOIS checks run on the VPS as an architectural choice for scheduling, retries, logging, persistence, and operational control.
- Default Domain Watch schedule:
  - Normal domains: once every 24 hours.
  - Low-priority domains: once every 7 days.
  - Availability results must be confirmed a second time before a notification is sent (double-check to avoid false positives).
  - Notifications delivered through Telegram bot and/or email.

---

## 3. Proposed Hostname Classes

These hostnames are **proposals** — they require explicit confirmation before DNS records are created.

| Hostname | Classification | Required Controls |
|---|---|---|
| `app.mythosprod.xyz` | **Public** | WAF, rate limiting, application auth, CDN |
| `api.mythosprod.xyz` | **Private** (proposal) or **Public** (conditional) | If private: Cloudflare Access, deny-by-default. If public: WAF, rate limiting, API key auth, CORS policy |
| `watch.mythosprod.xyz` | **Private** | Cloudflare Access, deny-by-default, WAF |
| `n8n.mythosprod.xyz` | **Private** | Cloudflare Access, deny-by-default, WAF |
| `coolify.mythosprod.xyz` | **Private** | Cloudflare Access, deny-by-default, WAF, strict IP allowlist supplement recommended |
| `admin.mythosprod.xyz` | **Private** | Cloudflare Access, deny-by-default, WAF, application auth, audit log |
| `files.mythosprod.xyz` | **Public** (read) / **Private** (write) | R2 or Tunnel-backed, WAF, rate limiting, signed URLs for private objects |

### 3.1 Classification Definitions

- **Public**: Reachable from any IP. Protected by WAF, rate limiting, and application auth where applicable. No Cloudflare Access gate.
- **Private**: Reachable only by authenticated identities (Cloudflare Access). Access policy: deny-by-default, allow only approved identity groups.
- **Conditional**: Classification depends on the final deployment model. `api.mythosprod.xyz` may be public if it serves a documented public API with per-key auth and rate limiting, or private if it serves internal services only.

### 3.2 Unmatched Routes

Any hostname or path not explicitly configured in Cloudflare Tunnel ingress rules must return **HTTP 404** (or be dropped at the Tunnel level). Unmatched requests must never fall through to an unintended backend.

---

## 4. Operational Policies

### 4.1 DNS Proxy

- Application hostnames (app, api, watch, n8n, coolify, admin, files) use **proxied** (orange-cloud) DNS records so traffic passes through Cloudflare's edge.
- DNS-only (grey-cloud) records may be used for:
  - Infrastructure that must bypass Cloudflare (e.g., direct SSH access to the VPS, if required for emergency access).
  - TXT, MX, and verification records that must not be proxied.
- Origin server IP addresses must never appear in proxied A/AAAA record answers visible to external resolvers.

### 4.2 Origin IP Protection

- The VPS public IP must not appear in any proxied DNS record answer.
- Direct origin access (bypassing Cloudflare) must be restricted via VPS firewall to known administrative IPs only.
- Default-deny firewall inbound policy on the VPS; allow only:
  - Cloudflare IP ranges (for Tunnel validation, if direct origin is ever needed during migration).
  - Administrative SSH from known IPs.
  - Required outbound services (NTP, DNS, package mirrors, API calls).

### 4.3 Tunnel Secret Management

- Cloudflare Tunnel tokens and credentials must reside only in Coolify encrypted environment variables or an approved external secret manager.
- Tunnel tokens must **never** be committed to the repository, stored in plaintext configuration files, logged, or included in documentation.
- `cloudflared.env.example` contains **variable names only** — placeholder values only. The real values are injected at deploy time.

### 4.4 Cloudflare Access

- Access policies follow deny-by-default.
- Identity provider integration uses Google Workspace or an equivalent OIDC/SAML IdP.
- Session duration is limited (recommended: 24 hours maximum for administrative hostnames).
- Access audit logs are retained per Cloudflare's retention policy.

### 4.5 WAF and Rate Limiting

- Cloudflare Managed Ruleset: enabled on all hostnames.
- Custom WAF rules: defined per hostname class (stricter for admin/coolify, standard for public app).
- Rate limiting rules:
  - Public hostnames: per-IP rate limits on sensitive endpoints (login, API write).
  - Private hostnames: stricter per-identity limits.
  - Rate limit responses: HTTP 429 with Retry-After header.
- WAF and rate limiting rules are defined during INF-CF-5; not configured in this stage.

### 4.6 DNSSEC Migration

- DNSSEC is a separate, controlled operation (INF-CF-5).
- Before enabling: DNS zone must be fully migrated to Cloudflare, all records verified, propagation confirmed.
- DS-record values from Cloudflare must be configured at the domain registrar.
- Post-enablement: verify DNSSEC validation with external tools (DNSViz, dig +dnssec).
- Rollback: remove DS records at registrar before disabling DNSSEC in Cloudflare.

### 4.7 R2 Storage and Backup

- R2 buckets are created during INF-CF-6.
- Bucket-level CORS and access policies are defined per use case.
- Encrypted backup copies stored in R2 are encrypted client-side before upload.
- R2 lifecycle rules (if used) must not delete objects needed for compliance or audit.
- R2 is a secondary store; primary database backups exist externally.

### 4.8 Rollback Policy

- Every infrastructure stage must have a documented rollback path.
- DNS changes: revert to previous nameservers or record values; TTL must be short during migration windows.
- Tunnel: stop the cloudflared container; confirm origin ports are not exposed.
- Access policies: disable Access for the affected hostname (falls back to direct Tunnel routing with app auth only).
- WAF/rate limiting: switch to Log-only mode before disabling; revert to previous rule set.
- R2: restore from external backup; do not rely on R2 as the only backup.
- DNSSEC: remove DS records at registrar before disabling in Cloudflare.

### 4.9 Monitoring

- Cloudflare dashboard analytics for traffic, threats, and Tunnel health.
- Tunnel health: Coolify monitors the cloudflared container; alert on restart loops or disconnection.
- WAF and rate limiting events: log to Cloudflare Logpush (requires a paid plan tier that includes Logpush) or, if unavailable on the active plan, the Cloudflare dashboard/GraphQL analytics API.
- Origin health: independent VPS monitoring (Coolify health checks, PostgreSQL connectivity).
- Domain Watch: monitor job completion, failure rate, and notification delivery.
- Cloudflare feature availability (Logpush, WAF custom rule counts, rate-limiting rule counts, Access seat counts, DNSSEC) varies by plan tier — verify against the active plan before relying on any of the above.

### 4.10 Secrets That Must Never Be Committed

The following values must never appear in the repository, Git history, documentation, or deployment templates:

- Cloudflare API tokens and API keys
- Cloudflare Tunnel tokens (`CLOUDFLARE_TUNNEL_TOKEN`)
- Cloudflare Account ID (where used as an authentication secret)
- Cloudflare Access identity provider client secrets
- R2 access key ID and secret access key
- Origin CA certificates and private keys
- DNS zone transfer keys or TSIG secrets
- Any TLS private key material

If any of these values appear during a diff review, the commit must be blocked and the value rotated.

---

## 5. Document Status

This document defines the **approved architecture** for Cloudflare integration. It is documentation only. No DNS records, Tunnel configuration, Access policies, WAF rules, or R2 buckets have been created.

The deployment stages are defined in `docs/CLOUDFLARE_DEPLOYMENT_CHECKLIST.md`.

---

**Next stage:** INF-CF-1 — Cloudflare account and domain inventory
