# MYTHOS Cybersecurity Master Plan

**Status:** PLANNED / DEFERRED — documentation only
**Scope:** OTH / MYTHOS ecosystem
**Execution:** Not started by this document

## Purpose

Create one authoritative security reference so cybersecurity findings, decisions, controls, hardening work, and validation are not scattered across unrelated reports.

## Standing Rules

1. Security hardening is a dedicated future mission.
2. Do not perform opportunistic hardening during unrelated executions.
3. Do not weaken fail-closed controls.
4. Do not expose a new public service for convenience.
5. Do not move sensitive personal data to public or unnecessary infrastructure.
6. Reuse and consolidate existing security controls before building new ones.
7. Record newly discovered risks without silently converting them into remediation work.
8. Never commit credentials, tokens, API keys, `.env` files, raw private exports, databases, or sensitive personal data.

## Security Domains

### 1. Governance and Trust Boundaries
- security decisions and deferred decisions
- least privilege
- fail-closed behavior
- execution versus advisory boundaries
- canonical sources of truth

### 2. Asset Inventory
- VPS and operating system
- domains and public services
- repositories and branches
- containers and images
- databases
- storage and backups
- execution environments

### 3. Network Security
- public IPv4/IPv6 exposure
- open ports
- firewall
- Docker networking
- internal versus public services
- management-plane exposure

Known items currently requiring future review: Coolify `8000`, `6001`, `6002`, and root desktop `6082`. No remediation is performed by this plan.

### 4. VPS / OS Security
- Ubuntu configuration
- kernel and packages
- users and groups
- root and sudo
- filesystem permissions
- systemd and scheduled jobs
- processes and services
- logging

### 5. SSH Security
- root access
- authentication methods
- SSH keys
- allowed users
- configuration
- brute-force controls
- session logging

### 6. Coolify / Reverse Proxy / TLS
- Coolify dashboard and API
- management interfaces
- nginx and reverse proxy configuration
- TLS and HTTP-to-HTTPS behavior
- CORS
- accidental public routes
- deployment credentials

### 7. Docker / Container Security
- privileged containers
- Linux capabilities
- host mounts
- Docker socket access
- exposed container ports
- image provenance
- stale or unsafe images
- container isolation

### 8. MCP Security
- transport
- authentication
- authorization
- tool exposure
- read/write boundaries
- capability registry
- tool injection
- isolation from Executor
- unauthorized operation rejection

### 9. OTH Knowledge / OTHMODE / Mythos OS
- service exposure
- authentication and authorization
- canonical knowledge boundary
- execution authority
- command and skill permissions
- escalation paths
- internal API boundaries

### 10. AI Security
- direct and indirect prompt injection
- tool injection
- agent privilege escalation
- memory poisoning
- knowledge poisoning
- cross-user data leakage
- unauthorized tool calls
- advisory/execution boundary bypass

### 11. Databases
- SQLite
- PostgreSQL
- MariaDB
- access controls
- credentials
- network exposure
- permissions
- encryption where appropriate
- backup and restore security

### 12. Personal and Sensitive Data
Protect:
- `oth.db`
- conversations
- contacts
- identities
- Course Intelligence data
- authenticated browser profiles
- private exports

These must never be uploaded to GitHub as raw data.

### 13. Secrets
Review, without exposing values:
- environment variables
- `.env` files
- API keys
- tokens
- SSH keys
- GitHub secrets
- deployment credentials
- secrets in logs or history

### 14. GitHub Security
- repository visibility
- branch protection
- collaborators and permissions
- deploy keys
- Actions and CI
- repository secrets
- webhooks
- accidental sensitive commits
- history exposure

### 15. N8N Security
- authentication
- webhooks
- credentials
- encryption configuration
- execution data
- filesystem access
- container permissions
- backup and restore

### 16. Backup Security
- `mythos_erp`
- N8N
- R2/off-host storage
- encryption
- retention
- integrity verification
- restore testing
- disaster recovery

The existing fail-closed backup behavior must be preserved. A backup failure must not be silenced by fabricating a database or weakening preflight controls.

### 17. Application Security
Review applicable applications for:
- authentication
- authorization
- IDOR
- injection
- SSRF
- path traversal
- command execution
- unsafe file upload
- CORS
- CSRF
- rate limiting
- error and information leakage

### 18. Supply Chain
- npm dependencies
- Python dependencies
- Docker images
- GitHub Actions
- third-party AI tooling
- abandoned or vulnerable dependencies
- package provenance

### 19. Logging / Monitoring
- sensitive-data leakage
- authentication events
- abnormal processes
- network anomalies
- filesystem anomalies
- alerting and retention

The previously fixed SPY file-descriptor/log-growth incident must remain part of regression awareness.

### 20. Incident Response
- detection
- containment
- evidence preservation
- recovery
- post-incident review
- credential rotation procedures

### 21. Disaster Recovery
- recovery objectives
- restore procedures
- off-host copies
- restore validation
- dependency mapping

## Current Known Security Register

| Item | Current classification | Treatment now |
|---|---|---|
| Coolify public HTTP on 8000 | Known risk | Deferred to full security mission |
| Root desktop on 6082 | Known risk | Deferred to full security mission |
| 6001 / 6002 exposure | Needs identification | No severity invented; defer |
| N8N off-host backup | Backup gap | Deferred to backup/security mission |
| `mythos_erp` backup failure | Fail-closed control state | Preserve; do not bypass |
| MCP authorization boundary | Control to preserve | Validate during MCP work; no redesign |
| OTH Knowledge facade | Loopback/authenticated boundary | Preserve and validate |
| SPY descriptor leak | Fixed and validated | Keep as regression reference |

## Future Mission Sequence

```text
FULL SECURITY RECON
        ↓
ASSET INVENTORY
        ↓
ATTACK SURFACE
        ↓
THREAT MODEL
        ↓
VULNERABILITY / CONFIGURATION AUDIT
        ↓
RISK CLASSIFICATION
        ↓
HARDENING PLAN
        ↓
SAFE HARDENING
        ↓
CONTROLLED VALIDATION
        ↓
REGRESSION TESTING
        ↓
RECOVERY / RESTORE VALIDATION
        ↓
FINAL SECURITY AUDIT
        ↓
GITHUB EXECUTION REPORT
```

## Evidence Standard

A finding should be supported by evidence. Classify findings as `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`, or `INFO` only when evidence supports the classification. Distinguish clearly between verified facts, hypotheses, accepted risks, deferred work, fixed findings, and validated controls.

## Execution Boundary

This file is a plan and knowledge base. It does not authorize security changes now. The future security mission must begin with a fresh reconnaissance against live systems and Git history, because current infrastructure can change before execution.

## GitHub Record Policy

Security plans and safe metadata may be stored in GitHub. Never store raw databases, private conversations, credentials, API keys, tokens, `.env` files, private exports, or other sensitive raw data.

The authoritative future security execution record belongs in `docs/worklogs/YYYY-MM-DD-HHMM-full-cybersecurity-audit.md`, with the System Index updated only from verified results.
