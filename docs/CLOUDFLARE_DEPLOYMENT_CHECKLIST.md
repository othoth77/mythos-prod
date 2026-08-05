# Mythos OS — Cloudflare Deployment Checklist

**Version:** 1.0 (INF-CF-0)
**Status:** Planning only — no deployment performed
**Date:** 2026-08-05

---

This checklist defines the infrastructure stages required to deploy the Cloudflare edge security architecture described in `docs/CLOUDFLARE_ARCHITECTURE.md`.

All stages must be executed sequentially. Each stage must be validated, documented, and pushed before the next begins.

---

## Stage INF-CF-0: Architecture and Documentation

**Status:** Complete (documentation phase)

### Prerequisites
- Approved Cloudflare architecture document.
- Repository branch for infrastructure documentation.
- Clear understanding of the existing VPS, Coolify, and Mythos OS architecture.

### Actions
- Create `docs/CLOUDFLARE_ARCHITECTURE.md`.
- Create `docs/CLOUDFLARE_DEPLOYMENT_CHECKLIST.md` (this document).
- Create `deploy/cloudflare/cloudflared.env.example`.
- Create `deploy/cloudflare/README.md`.
- Update `docs/ROADMAP.md` with Infrastructure and Cloudflare track.
- Update `docs/AI_HANDOVER.md`.

### Validation
- All files are valid UTF-8.
- No credentials, tokens, account IDs, or real configuration values committed.
- `git diff --check` passes with no whitespace errors.
- Branch pushed and remote HEAD verified.

### Rollback
- Revert the commit; delete the branch. No infrastructure was changed.

### Secrets Handling
- No secrets created, stored, or referenced in this stage.

### Completion Criteria
- [x] All files committed and pushed to `docs/cloudflare-foundation`.
- [x] Remote HEAD matches local commit.
- [x] Documentation is internally consistent and complete.
- [x] No real values committed.

---

## Stage INF-CF-1: Cloudflare Account and Domain Inventory

**Status:** Planned

### Prerequisites
- INF-CF-0 complete.
- Access to a Cloudflare account with sufficient permissions (Super Administrator or Administrator with Zone, DNS, Zero Trust, and SSL/TLS permissions).
- Authoritative list of domains to manage (primary: `mythosprod.xyz`; any additional domains for product subdomains).

### Actions
- Create or verify the Cloudflare account.
- Add `mythosprod.xyz` to Cloudflare (initiate zone addition; do not change nameservers yet).
- Record the Cloudflare-assigned nameserver pair.
- Inventory current DNS records at the existing DNS provider.
- Map each existing record to its Cloudflare equivalent (proxy or DNS-only).
- Identify records that must be migrated with zero downtime (email MX, verification TXT).
- Document the current registrar and verify registrar access credentials.

### Validation
- Cloudflare zone is visible in the dashboard.
- Nameserver pair is recorded.
- Current DNS record inventory is complete and matches the existing provider.
- Registrar access confirmed.

### Rollback
- Zone can be removed from Cloudflare dashboard before nameserver change.

### Secrets Handling
- Cloudflare account credentials must not be committed.
- Registrar credentials must not be committed.
- Any API tokens created during this stage must be stored only in Coolify encrypted environment variables or an approved secret manager.

### Completion Criteria
- [ ] Cloudflare account ready.
- [ ] Domain added (pre-nameserver-change).
- [ ] DNS inventory complete.
- [ ] Registrar access verified.
- [ ] No secrets committed.

---

## Stage INF-CF-2: DNS Migration and Verification

**Status:** Planned

### Prerequisites
- INF-CF-1 complete.
- DNS record inventory reviewed and approved.
- Migration window scheduled (low-traffic period recommended).
- TTL on existing records reduced to 300 seconds or lower (at least 24 hours before cutover for records with longer TTLs).

### Actions
- Change domain nameservers at the registrar to Cloudflare's assigned nameservers.
- Wait for propagation (monitor with `dig +trace` and public DNS checkers).
- Verify all migrated records resolve correctly through Cloudflare.
- Enable proxy (orange-cloud) for application hostnames.
- Verify DNS-only (grey-cloud) records for infrastructure that must bypass Cloudflare.
- Enable DNSSEC in Cloudflare (do not configure DS records at registrar yet — that is INF-CF-5).
- Monitor for DNS-related errors and user reports for at least 48 hours.

### Validation
- All expected records resolve correctly.
- TLSA/DANE records (if any) updated or removed before migration.
- Email delivery (MX, SPF, DKIM, DMARC) confirmed functional.
- No DNSSEC validation errors (DNSSEC not yet fully enabled — DS records deferred).
- Existing application services remain reachable.

### Rollback
- Revert nameservers to previous provider at the registrar.
- Wait for propagation (previous TTL applies).
- Verify previous provider serves correct records.

### Secrets Handling
- No new secrets generated during this stage.
- Nameserver change is a public DNS operation.

### Completion Criteria
- [ ] Nameservers changed at registrar.
- [ ] Propagation confirmed (24–48 hour monitoring window passed).
- [ ] All records verified.
- [ ] No service disruption.
- [ ] Rollback path documented and tested (nameserver reversion confirmed working).

---

## Stage INF-CF-3: Remotely Managed Tunnel in Coolify

**Status:** Planned

### Prerequisites
- INF-CF-2 complete.
- Coolify accessible and functional on the VPS.
- Cloudflare Zero Trust dashboard accessible.
- Domain zones active in Cloudflare.

### Actions
- In Cloudflare Zero Trust dashboard, create a remotely managed Tunnel.
- Record the Tunnel token (do not commit).
- Configure Tunnel ingress rules:
  - `app.mythosprod.xyz` → internal Coolify application service (HTTP).
  - `api.mythosprod.xyz` → internal API service (HTTP).
  - `watch.mythosprod.xyz` → Domain Watch interface.
  - `n8n.mythosprod.xyz` → n8n service (HTTP).
  - `coolify.mythosprod.xyz` → Coolify dashboard (HTTP).
  - `admin.mythosprod.xyz` → Admin panel (HTTP).
  - `files.mythosprod.xyz` → file service or R2 (HTTP).
  - Default catch-all: HTTP 404.
- Add the Tunnel token as an encrypted environment variable in Coolify.
- Deploy a `cloudflared` container in Coolify using the official `cloudflare/cloudflared` image, running `cloudflared tunnel run --token ${CLOUDFLARE_TUNNEL_TOKEN}`.
- Verify the Tunnel connects and shows as Healthy in the Zero Trust dashboard.
- Close all inbound ports on the VPS firewall that were previously used for public HTTP/HTTPS (ports 80, 443).
- Confirm application services are reachable only through Cloudflare Tunnel hostnames.

### Validation
- Tunnel status is Healthy in Cloudflare Zero Trust dashboard.
- All configured hostnames resolve and route correctly.
- VPS firewall has no public HTTP/HTTPS ports open.
- Direct VPS IP access returns no open port on 80/443.
- Application services function correctly through Tunnel.

### Rollback
- Stop the cloudflared container in Coolify.
- Reopen VPS firewall ports 80/443 if needed for fallback.
- Revert DNS records to point directly to VPS IP (DNS-only, not proxied) if emergency direct access is required.
- Delete the Tunnel from Cloudflare Zero Trust dashboard.
- Rotate the Tunnel token.

### Secrets Handling
- Tunnel token stored only in Coolify encrypted environment variables.
- Tunnel token must never be committed to the repository.
- If the token is ever exposed, rotate it immediately in Cloudflare Zero Trust.

### Completion Criteria
- [ ] Tunnel running in Coolify.
- [ ] All ingress rules configured and verified.
- [ ] VPS firewall confirmed closed on public HTTP/HTTPS ports.
- [ ] All services reachable through Tunnel.
- [ ] No secrets committed.

---

## Stage INF-CF-4: Cloudflare Access for Private Hostnames

**Status:** Planned

### Prerequisites
- INF-CF-3 complete.
- Cloudflare Zero Trust dashboard accessible.
- Identity provider configured (Google Workspace or approved IdP).
- List of approved identities/groups for each private hostname.

### Actions
- Create a Cloudflare Access application for each private hostname:
  - `api.mythosprod.xyz` (if classified as private)
  - `watch.mythosprod.xyz`
  - `n8n.mythosprod.xyz`
  - `coolify.mythosprod.xyz`
  - `admin.mythosprod.xyz`
- Configure deny-by-default access policies.
- Add allow rules for approved identity groups.
- Set session duration limits (24 hours maximum for admin hostnames).
- Enable Access audit logging.
- Verify that unauthenticated requests receive the Cloudflare Access login page.
- Verify that authenticated users from approved groups can access the service.
- Verify that authenticated users from non-approved groups are denied.

### Validation
- Each private hostname serves the Access login page for unauthenticated requests.
- Approved identities can authenticate and access the backend service.
- Non-approved identities are denied.
- Application-level authentication still functions behind Access.
- Session duration enforcement works (test by waiting for session expiry).

### Rollback
- Remove Access application from Cloudflare Zero Trust for the affected hostname.
- Hostname falls back to direct Tunnel routing (application auth still required).
- No DNS or Tunnel changes needed.

### Secrets Handling
- Identity provider client secret (if configured) stored only in Cloudflare Access settings or approved secret manager.
- No identity provider secrets committed.

### Completion Criteria
- [ ] Access applications created for all private hostnames.
- [ ] Deny-by-default policy confirmed.
- [ ] Approved identities can access; others denied.
- [ ] Session limits configured.
- [ ] Access audit logging enabled.

---

## Stage INF-CF-5: TLS, WAF, Rate Limiting and DNSSEC Hardening

**Status:** Planned

### Prerequisites
- INF-CF-4 complete.
- TLS certificate on the origin (VPS) valid and trusted (Cloudflare Origin CA or public CA).
- WAF and rate limiting rules documented and reviewed.

### Actions
- Set TLS encryption mode to Full (strict) in Cloudflare SSL/TLS settings.
- Verify that SSL Flexible is not in use on any hostname.
- Enable Cloudflare Managed Ruleset (WAF) on all hostnames.
- Create custom WAF rules for:
  - Admin and infrastructure hostnames: stricter rule set, block known attack patterns.
  - Public hostnames: standard managed ruleset plus custom rules for application-specific attack surfaces.
- Configure rate limiting rules:
  - Public login endpoints: strict per-IP rate limit.
  - API endpoints: per-IP and per-token rate limits.
  - Admin hostnames: stricter rate limits.
- Obtain DS-record values from Cloudflare DNSSEC settings.
- Configure DS records at the domain registrar.
- Wait for DS record propagation.
- Enable DNSSEC in Cloudflare.
- Verify DNSSEC chain of trust with external validators (DNSViz, `dig +dnssec`).

### Validation
- TLS mode is Full (strict); Flexible is absent.
- WAF: test with known-bad payloads; confirm blocking.
- Rate limiting: test with rapid requests from a single IP; confirm 429 responses.
- DNSSEC: DNSViz shows green (all checks pass); `dig +dnssec` shows `ad` flag.
- No false positives from WAF rules blocking legitimate traffic (monitor for at least 48 hours).

### Rollback
- TLS: revert to Full (not strict) temporarily if origin certificate validation fails.
- WAF: set rules to Log-only mode before disabling.
- Rate limiting: disable rules; application-level rate limiting remains.
- DNSSEC: remove DS records from registrar before disabling DNSSEC in Cloudflare.
- All rollback steps are non-disruptive and individually reversible.

### Secrets Handling
- No new secrets generated in this stage.
- DNSSEC DS records are public cryptographic values (not secrets).

### Completion Criteria
- [ ] TLS Full (strict) enforced.
- [ ] WAF enabled and tested on all hostnames.
- [ ] Rate limiting configured and tested.
- [ ] DNSSEC fully enabled and validated.
- [ ] 48-hour monitoring period passed with no false positives.

---

## Stage INF-CF-6: R2 and External Backup Integration

**Status:** Planned

### Prerequisites
- INF-CF-5 complete.
- R2 bucket names and access policies defined.
- External backup destination configured (independent of R2 and the VPS).

### Actions
- Create R2 buckets for:
  - Documents and attachments (`mythos-documents`)
  - Generated exports (`mythos-exports`)
  - Static assets (`mythos-static`) — optional
  - Encrypted backup copies (`mythos-backups`)
- Configure bucket-level CORS policies.
- Generate R2 API tokens with least-privilege access (read/write per bucket).
- Store R2 access keys in Coolify encrypted environment variables.
- Configure Mythos OS storage layer to use R2 for document uploads (future application stage).
- Configure backup pipeline:
  - Primary database backup: external backup destination (off-VPS, off-Cloudflare).
  - Encrypted copy: R2 (`mythos-backups` bucket).
  - Retention policy: documented and enforced at both destinations.
- Test restore from both R2 and external backup destination.
- Verify that R2 is not the only backup destination.

### Validation
- R2 buckets created and accessible with API tokens.
- CORS policies correct.
- Backup pipeline writes to both destinations.
- Restore from external backup: successful.
- Restore from R2 backup copy: successful.
- R2 access keys are not committed.

### Rollback
- R2: delete buckets (after confirming external backup exists).
- Backup pipeline: revert to previous backup configuration.
- No data loss: external backup remains available throughout.

### Secrets Handling
- R2 access key ID and secret access key stored only in Coolify encrypted environment variables.
- Never committed, never logged, never included in documentation.

### Completion Criteria
- [ ] R2 buckets created and configured.
- [ ] API tokens functional with least-privilege access.
- [ ] Backup pipeline verified.
- [ ] Restore from both destinations tested.
- [ ] No R2 credentials committed.

---

## Stage INF-CF-7: Monitoring, Rollback Test, Restore Test and Operational Handover

**Status:** Planned

### Prerequisites
- INF-CF-6 complete.
- All previous stages validated and stable.
- Operational runbook drafted.

### Actions
- Configure Cloudflare Logpush or analytics to an external monitoring destination.
- Configure Coolify health checks for the cloudflared container.
- Set up alerts for:
  - Tunnel disconnection or restart loops.
  - WAF/rate limiting anomaly spikes.
  - DNSSEC validation failures.
  - R2 access errors.
  - Backup pipeline failures.
- Execute a full rollback drill:
  - Stop the Tunnel.
  - Disable Access for one hostname.
  - Switch WAF rules to Log-only.
  - Verify application services remain functional at each step.
  - Restore all services to the operational state.
- Execute a full restore drill:
  - Restore PostgreSQL from external backup to a test instance.
  - Restore files from R2 backup copy.
  - Validate data integrity.
- Document the operational runbook.
- Hand over to operations team (or document for future operator).

### Validation
- All monitoring alerts trigger correctly (test each alert condition).
- Full rollback drill completes without data loss or extended downtime.
- Full restore drill completes with verified data integrity.
- Operational runbook is complete and reviewed.

### Rollback
- This is the rollback and restore validation stage; no further rollback is defined.

### Secrets Handling
- Monitoring destinations may require API keys — stored in Coolify encrypted environment variables only.
- No monitoring credentials committed.

### Completion Criteria
- [ ] Monitoring configured and alerting verified.
- [ ] Rollback drill completed successfully.
- [ ] Restore drill completed successfully.
- [ ] Operational runbook documented.
- [ ] All stages INF-CF-0 through INF-CF-7 validated end-to-end.

---

## Stage Summary

| Stage | Description | Status |
|---|---|---|
| INF-CF-0 | Architecture and documentation | ✓ Done (2026-08-05) |
| INF-CF-1 | Cloudflare account and domain inventory | Planned |
| INF-CF-2 | DNS migration and verification | Planned |
| INF-CF-3 | Remotely managed Tunnel in Coolify | Planned |
| INF-CF-4 | Cloudflare Access for private hostnames | Planned |
| INF-CF-5 | TLS, WAF, rate limiting and DNSSEC hardening | Planned |
| INF-CF-6 | R2 and external backup integration | Planned |
| INF-CF-7 | Monitoring, rollback test, restore test and operational handover | Planned |

---

**Next stage:** INF-CF-1 — Cloudflare account and domain inventory
