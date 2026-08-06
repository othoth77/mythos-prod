# Mythos OS — Authoritative DNS Export Intake

- **Stage:** INF-CF-2-PREP — Authoritative DNS Export Intake and Owner Approval Gate
- **Status:** Preparation only. No provider login, no DNS change, no nameserver change, no Cloudflare account action, no deployment. This document defines what must be collected before INF-CF-2 can start; it does not itself contain any collected data.
- **Purpose:** Define exactly what authoritative, provider-sourced evidence is required — per domain — before any DNS migration decision is made, and how that evidence must be handled so it never enters Git in raw form.
- **Scope:** The eight domains listed below. Nothing else.
- **Explicit non-goals:** This stage does not migrate DNS, does not change nameservers, does not change any DNS record, does not enable or disable DNSSEC, does not add any domain to Cloudflare, does not create a Cloudflare zone, does not log in to OVH, ATI, Cloudflare, any registrar, or any mail provider, does not configure Cloudflare proxy, does not create a Tunnel, does not deploy `cloudflared`, does not configure Access/WAF/R2/Workers, does not modify runtime or database code, does not publish raw DNS exports, and does not start or mark INF-CF-2 complete.

## Authoritative Domains

1. `agribee.tn` — AgriBee
2. `darhijama.tn` — Dar Hijama
3. `fixpert.tn` — Fixpert
4. `idauto.tn` — ID Auto
5. `mythosprod.xyz` — Mythos OS / shared infrastructure
6. `notrejour.tn` — Notre Jour
7. `ssangyong.autos` — SsangYong Parts
8. `uthinachess.tn` — Uthina Chess

## Why Public DNS Is Insufficient

`docs/CLOUDFLARE_DOMAIN_INVENTORY.md` (INF-CF-1) was built entirely from **public** sources: public DNS resolution, public RDAP/WHOIS, public TLS inspection, public HTTP checks, and public certificate-transparency logs. That inventory explicitly states, and this document restates, that:

- public DNS queries cannot see the complete private zone — internal-only records, disabled/parked records, records with access restrictions, and anything not yet propagated are all invisible to public resolvers;
- absence of a record from the public inventory is not proof it doesn't exist in the authoritative zone;
- registrar-level and hosting-panel-level redirects can exist entirely outside the DNS zone and are invisible to any DNS query, public or authoritative;
- DNSSEC DS-record state at the parent (which the INF-CF-1 inventory did observe via RDAP) does not by itself tell you the DNSKEY state inside the provider's zone, or whether the two are currently consistent;
- email configuration details such as DKIM selectors cannot be safely discovered without either a documented selector or direct control-panel access — brute-forcing was correctly out of scope for INF-CF-1 and remains out of scope here.

**INF-CF-2 must not start from public DNS observations alone.** This document exists to close that gap safely, without ever committing the closing evidence itself to the repository.

## Required Control-Panel Exports

For every one of the eight domains, the domain owner (or someone with owner-authorised access) must pull the following directly from the OVH registrar control panel and the OVH DNS zone editor (or whichever control panel is authoritative for that domain at the time of export). Nothing below should be typed from memory or inferred — it must come from the live control panel.

### A. Registrar Information

- Registrar name (expected: OVH, per INF-CF-1 — confirm, do not assume).
- Current authoritative nameservers as shown by the registrar (not just as observed publicly).
- Domain status (active, locked, pending transfer, expired, etc.).
- Expiry date.
- Registrar lock status (transfer lock on/off).
- DNSSEC enabled/disabled state as shown by the registrar.
- Current DS records when visible in the registrar panel.
- Date and time of export (record this alongside every export).

**Do not collect:** account passwords, customer numbers, API keys, recovery codes, or payment information. None of this is needed for DNS migration planning, and none of it should ever be typed into any file destined for this repository.

### B. DNS Provider Export

Request the **complete authoritative DNS zone** in one of these forms — whichever the DNS provider's control panel offers:

- BIND zone file,
- text export,
- CSV export,
- JSON export,
- complete control-panel record export (screenshot of every record page is the last resort, not the first choice).

The export must include, for every record: name, type, value/target, TTL, priority (where applicable), proxy state (where applicable), the service or purpose of the record if known, and any provider-specific flags.

Record types that must be captured if present (this list is broader than what INF-CF-1's public inventory could see):

`A`, `AAAA`, `CNAME`, `MX`, `TXT`, `SPF` (where represented as its own record type by the provider, separate from `TXT`), `DKIM`, `DMARC`, `CAA`, `SRV`, `NS`, `DS`, `TLSA`, `PTR` references when relevant, domain-verification records, ACME challenge records, and any redirect configured outside DNS (registrar-level or hosting-panel-level forwarding).

### C. Email Configuration

For every domain, record:

- whether email is active at all,
- inbound mail provider,
- outbound mail provider,
- MX records (cross-check against the INF-CF-1 public observation — all eight domains showed `mx1`/`mx2`/`mx3.mail.ovh.net` except `uthinachess.tn`, which showed a distinct four-record `mx0`–`mx3` set; confirm this against the authoritative export),
- SPF record (INF-CF-1 observed `-all` hardfail on seven domains and `~all` softfail on `uthinachess.tn` — confirm which is intended),
- DKIM selector(s) — INF-CF-1 could not determine these publicly; this is the primary place that gap gets closed,
- DMARC record — INF-CF-1 found none published on any of the eight domains; record whether one exists in the authoritative zone that simply wasn't publicly visible, or whether it genuinely does not exist,
- mail-related CNAME records (autoconfig, autodiscover, webmail),
- webmail hostname,
- autoconfig/autodiscover records,
- forwarding or catch-all configuration,
- whether email interruption is acceptable for this domain during migration.

**Do not collect:** mailbox passwords or message contents. Only the DNS/routing configuration of email is in scope.

### D. Web and Infrastructure Ownership

For every hostname record observed (apex, `www`, and any other active hostname such as `coolify.mythosprod.xyz`), record:

- intended application,
- current hosting provider,
- current origin target,
- production / staging / development status,
- public / private / admin classification,
- whether downtime is acceptable for this hostname,
- whether Cloudflare proxy is intended for this hostname,
- whether Cloudflare Access is required for this hostname,
- owner approval status for this specific hostname (see `docs/CLOUDFLARE_OWNER_APPROVAL_GATE.md`).

### E. DNSSEC Safety

INF-CF-1 found DNSSEC **already ENABLED** (DS record present at the parent zone via RDAP) on `mythosprod.xyz` and `ssangyong.autos`, and disabled on the other six domains per ATI WHOIS. For any domain with active DNSSEC — today that means `mythosprod.xyz` and `ssangyong.autos`, but re-verify for all eight, since state can change — record:

- current DS values as shown by the registrar,
- registrar-reported DNSSEC state,
- DNS provider's DNSKEY state,
- planned sequencing for any future nameserver change (this document does not define that sequencing — see `docs/CLOUDFLARE_DEPLOYMENT_CHECKLIST.md` INF-CF-5 and the DNSSEC coordination notes already present there),
- named rollback owner for the DNSSEC portion of any future change,
- explicit confirmation that DS records will **not** be changed prematurely, independent of and before any nameserver cutover is actually authorised.

**No DNSSEC operation is performed in this stage.** This section exists purely to make sure the evidence needed to sequence it safely later is collected now.

### F. Redirects and Certificates

Because HTTP redirects and certificate management can exist entirely outside the DNS zone, collect separately:

- registrar-level redirects,
- hosting-panel redirects,
- web-server redirects,
- apex-to-`www` behaviour,
- `www`-to-apex behaviour,
- current TLS certificate provider,
- certificate expiry,
- certificate renewal method.

This is directly relevant to two INF-CF-1 findings: `mythosprod.xyz`'s HTTP requests currently redirect to `darhijama.tn` with a mismatched HTTPS certificate, and `idauto.tn` has no working HTTPS listener at all. Both need their authoritative, control-panel-level redirect/certificate configuration captured before any migration decision, not just the public symptom already documented in INF-CF-1.

## Owner Approval Required

No domain's export is complete without the corresponding entry in `docs/CLOUDFLARE_OWNER_APPROVAL_GATE.md` being updated from `NOT_REQUESTED`. Evidence collection and owner approval are two separate, both-required steps — collecting the export does not itself constitute approval to migrate.

## Data-Handling Policy

- Raw provider exports (zone files, CSVs, JSON exports, screenshots) must be stored **locally only**, in `projects/infrastructure/cloudflare/authoritative-exports/` on the machine doing the collection. That directory is `.gitignore`d by default — see `projects/infrastructure/cloudflare/authoritative-exports/README.md` and its `.gitignore`.
- Raw exports must **never** be committed to this repository.
- Before any sanitized summary of an export is committed, remove: personal registrant information, any credential or token that appears in an export, any customer/account number, and anything not needed for migration planning.
- If a secret or credential is ever accidentally exposed in an export (even locally), rotate it — do not merely delete the file.
- A sanitized migration snapshot derived from an export requires separate review and approval before it is added to the repository; this intake document does not pre-authorise that addition.

## Submission Procedure

1. For the domain being prepared, collect sections A–F above directly from the registrar and DNS provider control panels.
2. Save the raw export locally under `projects/infrastructure/cloudflare/authoritative-exports/` (ignored by Git — see that directory's README).
3. Compare the raw export against the corresponding domain entry in `docs/CLOUDFLARE_DOMAIN_INVENTORY.md` and `docs/CLOUDFLARE_DNS_MIGRATION_MATRIX.md` (INF-CF-1). Note every discrepancy.
4. Update the domain's checklist below to reflect what has actually been received and verified — check only items that are genuinely done.
5. Update the domain's row in `projects/infrastructure/cloudflare/zone-review-template.json` (or a working copy of it) with sanitized status values only — never with raw record values or credentials.
6. Update `docs/CLOUDFLARE_OWNER_APPROVAL_GATE.md` for the domain once the owner has actually reviewed the sanitized comparison.
7. Do not proceed to INF-CF-2 for that domain until `docs/CLOUDFLARE_INF_CF2_ENTRY_CRITERIA.md` is satisfied for it.

## Validation Procedure

Before treating any domain as ready for INF-CF-2 review:

- Confirm the raw export's nameservers match what INF-CF-1 observed publicly (or explain the discrepancy).
- Confirm every MX, SPF, DMARC, and DKIM finding against the raw export — INF-CF-1 could not see DKIM or DMARC and used `UNKNOWN`/`absent` accordingly; this step is what resolves those unknowns.
- Confirm the DNSSEC state (DS presence, DNSKEY presence) matches the INF-CF-1 RDAP-derived finding.
- Confirm redirect and certificate behaviour matches or explains the INF-CF-1 HTTP/HTTPS findings, especially for `mythosprod.xyz` and `idauto.tn`.
- Confirm no raw export file has been staged or committed (`git status --short` inside `projects/infrastructure/cloudflare/authoritative-exports/` must show nothing beyond `README.md` and `.gitignore`).

## Exit Criteria (for this document, per domain)

A domain's checklist below may be considered fully satisfied only when every item in it is checked, the sanitized comparison has been recorded, and `docs/CLOUDFLARE_OWNER_APPROVAL_GATE.md` shows an approval value other than `NOT_REQUESTED` for that domain. Satisfying this checklist does not by itself authorise migration — see `docs/CLOUDFLARE_INF_CF2_ENTRY_CRITERIA.md` for the full entry gate.

## INF-CF-2 Entry Gate

INF-CF-2 remains blocked, for every domain, until `docs/CLOUDFLARE_INF_CF2_ENTRY_CRITERIA.md` is satisfied for that domain. Approval is per domain — not all eight domains need to reach this state simultaneously, and domains should be migrated one at a time unless explicitly authorised otherwise by the owner.

---

## Per-Domain Checklists

Every checklist item below starts unchecked. Check an item only after the corresponding evidence has actually been collected and verified — never check an item speculatively or by inference from the public INF-CF-1 inventory alone.

### 1. agribee.tn — AgriBee

- [ ] Registrar export received
- [ ] Authoritative DNS export received
- [ ] Nameservers verified
- [ ] DNSSEC verified
- [ ] Email configuration verified
- [ ] Web redirects verified
- [ ] TLS configuration verified
- [ ] Production criticality recorded
- [ ] Migration owner named
- [ ] Rollback owner named
- [ ] Migration approval received
- [ ] Export reviewed and sanitized
- [ ] Comparison against INF-CF-1 completed

### 2. darhijama.tn — Dar Hijama

- [ ] Registrar export received
- [ ] Authoritative DNS export received
- [ ] Nameservers verified
- [ ] DNSSEC verified
- [ ] Email configuration verified
- [ ] Web redirects verified
- [ ] TLS configuration verified
- [ ] Production criticality recorded
- [ ] Migration owner named
- [ ] Rollback owner named
- [ ] Migration approval received
- [ ] Export reviewed and sanitized
- [ ] Comparison against INF-CF-1 completed

**Note:** INF-CF-1 found this domain's certificate/content apparently served as the default vhost on the shared origin IP (`mythosprod.xyz` HTTP requests were observed redirecting here). Confirm at the origin, via this domain's own control-panel export, whether that default-vhost behaviour is intentional before treating this domain's own migration as routine.

### 3. fixpert.tn — Fixpert

- [ ] Registrar export received
- [ ] Authoritative DNS export received
- [ ] Nameservers verified
- [ ] DNSSEC verified
- [ ] Email configuration verified
- [ ] Web redirects verified
- [ ] TLS configuration verified
- [ ] Production criticality recorded
- [ ] Migration owner named
- [ ] Rollback owner named
- [ ] Migration approval received
- [ ] Export reviewed and sanitized
- [ ] Comparison against INF-CF-1 completed

**Note:** Fixpert is documented elsewhere in this repository (`docs/IDAUTO_FIXPERT_INTEGRATION.md`, Automotive docs) as an externally operated workshop system and the first Atelier Network pilot. Confirm who holds operational authority over `fixpert.tn` DNS before naming a migration owner.

### 4. idauto.tn — ID Auto

- [ ] Registrar export received
- [ ] Authoritative DNS export received
- [ ] Nameservers verified
- [ ] DNSSEC verified
- [ ] Email configuration verified
- [ ] Web redirects verified
- [ ] TLS configuration verified
- [ ] Production criticality recorded
- [ ] Migration owner named
- [ ] Rollback owner named
- [ ] Migration approval received
- [ ] Export reviewed and sanitized
- [ ] Comparison against INF-CF-1 completed

**⚠ WARNING — idauto.tn:** INF-CF-1 found no working HTTPS listener on either the apex or `www` host (TCP connection refused on port 443). **HTTPS must be designed and validated before `idauto.tn` is considered production-ready**, and before it is proxied through Cloudflare under the mandatory Full (strict) policy (Flexible SSL is prohibited — `docs/CLOUDFLARE_ARCHITECTURE.md` §2.6). Do not treat this domain as migration-ready until an origin HTTPS plan exists and has been validated.

### 5. mythosprod.xyz — Mythos OS / shared infrastructure

- [ ] Registrar export received
- [ ] Authoritative DNS export received
- [ ] Nameservers verified
- [ ] DNSSEC verified
- [ ] Email configuration verified
- [ ] Web redirects verified
- [ ] TLS configuration verified
- [ ] Production criticality recorded
- [ ] Migration owner named
- [ ] Rollback owner named
- [ ] Migration approval received
- [ ] Export reviewed and sanitized
- [ ] Comparison against INF-CF-1 completed

**⚠ WARNING — mythosprod.xyz:** INF-CF-1 found that HTTP requests to this domain's apex and `www` redirect to `https://darhijama.tn/` — a different domain entirely — and that HTTPS fails outright with a certificate/SNI mismatch. **Investigate and fix this incorrect redirect and HTTPS mismatch before migration.** This domain also already has DNSSEC enabled at the registrar (DS record present at the parent zone) — DS-record sequencing must be planned before any nameserver change, per the DNSSEC coordination notes in `docs/CLOUDFLARE_DEPLOYMENT_CHECKLIST.md`.

### 6. notrejour.tn — Notre Jour

- [ ] Registrar export received
- [ ] Authoritative DNS export received
- [ ] Nameservers verified
- [ ] DNSSEC verified
- [ ] Email configuration verified
- [ ] Web redirects verified
- [ ] TLS configuration verified
- [ ] Production criticality recorded
- [ ] Migration owner named
- [ ] Rollback owner named
- [ ] Migration approval received
- [ ] Export reviewed and sanitized
- [ ] Comparison against INF-CF-1 completed

**Note:** INF-CF-1 found this is the only domain in the portfolio with a public `AAAA` (IPv6) record. If this domain is proxied through Cloudflare, `A` and `AAAA` must be migrated together and kept consistent.

### 7. ssangyong.autos — SsangYong Parts

- [ ] Registrar export received
- [ ] Authoritative DNS export received
- [ ] Nameservers verified
- [ ] DNSSEC verified
- [ ] Email configuration verified
- [ ] Web redirects verified
- [ ] TLS configuration verified
- [ ] Production criticality recorded
- [ ] Migration owner named
- [ ] Rollback owner named
- [ ] Migration approval received
- [ ] Export reviewed and sanitized
- [ ] Comparison against INF-CF-1 completed

**⚠ WARNING — ssangyong.autos:** This domain already has DNSSEC enabled at the registrar (DS record present at the parent zone), the same condition as `mythosprod.xyz`. **DNSSEC coordination is mandatory** — do not switch nameservers to Cloudflare while the current OVH DS record remains published at the registrar. This domain also carries an unidentified 40-character verification-style TXT token (found in INF-CF-1) whose purpose must be confirmed with the domain owner before migration — do not discard it without confirming what depends on it.

### 8. uthinachess.tn — Uthina Chess

- [ ] Registrar export received
- [ ] Authoritative DNS export received
- [ ] Nameservers verified
- [ ] DNSSEC verified
- [ ] Email configuration verified
- [ ] Web redirects verified
- [ ] TLS configuration verified
- [ ] Production criticality recorded
- [ ] Migration owner named
- [ ] Rollback owner named
- [ ] Migration approval received
- [ ] Export reviewed and sanitized
- [ ] Comparison against INF-CF-1 completed

**⚠ WARNING — uthinachess.tn:** This domain hosts the live **production** Mythos OS application (production path `/var/www/uthinachess/0726/Prod/`, referenced throughout this repository). **Production migration requires a separate, explicit user authorisation and a dedicated maintenance window**, beyond the standard checklist applied to the other seven domains. Do not include this domain in any nameserver or DNS change on the basis of this checklist alone, no matter how complete it appears.
