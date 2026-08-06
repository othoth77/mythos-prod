# Mythos OS — INF-CF-2 Entry Criteria

- **Stage:** INF-CF-2-PREP — Authoritative DNS Export Intake and Owner Approval Gate
- **Purpose:** Define the mandatory criteria that must be satisfied, **per domain**, before INF-CF-2 (DNS migration and verification) may begin for that domain. This document is the entry gate; it does not itself perform, schedule, or authorise migration.
- **Status:** INF-CF-2 is **not started** for any domain. This document defines what "not blocked" means — it does not assert that any domain currently meets it.

## Mandatory Criteria (all applicable criteria must pass, per domain, before INF-CF-2 starts for that domain)

1. **Complete authoritative DNS export for the selected domain** — collected per `docs/CLOUDFLARE_AUTHORITATIVE_EXPORT_INTAKE.md`, stored only locally under `projects/infrastructure/cloudflare/authoritative-exports/` (never committed in raw form).
2. **Registrar access verified by the owner** — the owner (or an owner-authorised operator) has confirmed direct access to the registrar control panel for this domain, independent of any AI-driven process.
3. **Email configuration verified** — MX, SPF, DKIM, and DMARC state confirmed against the authoritative export, resolving every `UNKNOWN`/absent finding INF-CF-1 recorded for this domain.
4. **Current redirect rules identified** — registrar-level, hosting-panel-level, and web-server-level redirects documented, including apex↔`www` behaviour, so that no redirect is silently lost or altered during migration.
5. **DNSSEC state verified** — DS records, DNSKEY state, and registrar-reported DNSSEC status confirmed against the authoritative export, cross-checked against the INF-CF-1 RDAP-derived finding for this domain.
6. **DS sequencing reviewed** — for any domain with DNSSEC currently enabled (per INF-CF-1: `mythosprod.xyz`, `ssangyong.autos` — re-verify for all eight), a specific, reviewed plan for DS-record handling during nameserver cutover exists and has been checked against `docs/CLOUDFLARE_DEPLOYMENT_CHECKLIST.md` INF-CF-5.
7. **Cloudflare zone prepared but nameservers unchanged** — a Cloudflare zone may be created and its record set populated in preparation, but the domain's authoritative nameservers at the registrar must remain unchanged until every other criterion below is also satisfied and the owner has given nameserver migration approval.
8. **Record-by-record comparison completed** — the authoritative export has been compared line-by-line against the corresponding INF-CF-1 entries in `docs/CLOUDFLARE_DOMAIN_INVENTORY.md` and `docs/CLOUDFLARE_DNS_MIGRATION_MATRIX.md`, and every discrepancy has been resolved or explicitly accepted.
9. **Proxy/DNS-only classification approved** — the `PROXIED` / `DNS_ONLY` / `NOT_APPLICABLE` / `NEEDS_CONFIRMATION` classification for every record has been finalised (no record remains `NEEDS_CONFIRMATION`) and approved by the owner.
10. **Rollback configuration documented** — a specific, domain-scoped rollback path exists, consistent with the rollback safety language already established in `docs/CLOUDFLARE_DEPLOYMENT_CHECKLIST.md` (restricted, time-bounded fallbacks only — no unconditional port reopening, unproxied DNS, Access removal on administrative hostnames, or TLS downgrade).
11. **Owner approval recorded** — `docs/CLOUDFLARE_OWNER_APPROVAL_GATE.md` shows `APPROVED_FOR_MIGRATION` for the nameserver migration approval field for this domain, recorded from an actual owner decision, not inferred.
12. **Maintenance window approved** — a specific window has been agreed and recorded in the owner approval gate for this domain, sized to its acceptable-downtime tolerance.
13. **Origin and certificate plan approved** — for domains where INF-CF-1 found a broken or missing origin HTTPS configuration (`mythosprod.xyz`'s redirect/certificate mismatch, `idauto.tn`'s missing HTTPS listener), a concrete, reviewed fix plan exists and has been validated before this criterion can pass — Cloudflare's mandatory Full (strict) TLS mode (Flexible SSL is prohibited, per `docs/CLOUDFLARE_ARCHITECTURE.md` §2.6) cannot be satisfied by a broken origin.
14. **No unresolved critical unknown** — every item flagged as a risk in `docs/CLOUDFLARE_DOMAIN_INVENTORY.md` for this domain has been resolved or explicitly accepted by the owner, and no `UNKNOWN` remains on a field that materially affects migration safety (email routing, DNSSEC state, TLS state).
15. **Backups or configuration snapshots available** — a current configuration snapshot of the domain's DNS/origin/TLS state exists (beyond the public INF-CF-1 observation) so that a rollback has something concrete to restore to.

## Per-Domain Notes

- **mythosprod.xyz:** criterion 13 cannot pass until the incorrect HTTP redirect to `darhijama.tn` and the HTTPS certificate/SNI mismatch are diagnosed and fixed at the origin. Criterion 6 applies given DNSSEC is already enabled.
- **idauto.tn:** criterion 13 cannot pass until a working HTTPS listener exists and has been validated on both apex and `www`.
- **ssangyong.autos:** criterion 6 applies given DNSSEC is already enabled; criterion 14 additionally requires the unidentified verification-style TXT token's purpose and owner to be confirmed.
- **uthinachess.tn:** in addition to every criterion above, this domain requires a **separate, explicit user authorisation and a dedicated maintenance window** before INF-CF-2 may begin for it, given its status as the live production Mythos OS application. Satisfying criteria 1–15 alone is not sufficient for this domain.

## Approval Is Per Domain

Approval, and therefore INF-CF-2 entry, is evaluated **per domain**, not for the portfolio as a whole. Not all eight domains must migrate simultaneously, and in fact they should not: **domains should be migrated one at a time unless explicitly authorised otherwise** by the owner. A domain satisfying all criteria above does not put any other domain closer to satisfying its own criteria.

## What This Document Does Not Do

This document does not perform, schedule, or pre-authorise any migration. It does not create a Cloudflare account or zone. It does not change any DNS record or nameserver. It does not resolve any of the criteria above on its own — every criterion requires either owner action, authoritative-provider evidence, or a concrete fix at the origin, none of which this document can substitute for.
