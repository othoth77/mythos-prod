# Mythos OS — Cloudflare Domain Inventory

- **Stage:** INF-CF-1 — Cloudflare Account and Domain Inventory
- **Status:** Discovery complete for all 8 domains; stage as a whole is marked done in `docs/ROADMAP.md` only after Opus and Haiku validation both pass and the branch is pushed and remotely verified
- **Observation timestamp (UTC):** 2026-08-06T00:02:54Z (single observation window; individual queries completed within the same session, all within a few minutes of this timestamp)
- **Scope:** Public, non-invasive discovery of the eight domains authorised for this stage. No DNS, registrar, or Cloudflare account changes were made.
- **Methodology:** Public RDAP (`.xyz`, `.autos` via CentralNic RDAP), public ATI WHOIS (`.tn`, raw port-43 protocol), public DNS resolution via the Cloudflare `1.1.1.1` recursive resolver (both classic `nslookup` and DNS-over-HTTPS JSON), public HTTP/HTTPS status and redirect checks, public TLS certificate inspection (`openssl s_client`), and public certificate-transparency lookups (`crt.sh`). No control panel, registrar account, or Cloudflare account was accessed. No brute-force subdomain enumeration was performed.

## Limitations (read before using this document)

- **Public DNS queries do not reveal the complete private DNS zone.** A registrar or DNS-provider control panel may contain additional records — internal-only hostnames, disabled or parked records, records with restrictive ACLs, or records that have not propagated — that are invisible to public resolvers.
- **Absence from this inventory does not prove a record does not exist.** It only means public resolvers did not return it during this observation window.
- **Registrar and DNS-provider control panels must be compared manually against this inventory before INF-CF-2 begins.** This document is a starting point for that comparison, not a substitute for it.
- **Certificate-transparency (crt.sh) coverage is incomplete for this run.** `crt.sh` returned HTTP 502 (rate-limited/temporarily unavailable) for six of the eight domains after the first two queries succeeded. Subdomain discovery via CT should be re-run independently, outside a single rate-limited burst, before INF-CF-2.
- **DKIM was not evaluated by selector enumeration.** Brute-forcing DKIM selectors is out of scope for this read-only stage. Every domain's DKIM status is recorded as `UNKNOWN` — this is never to be read as "DKIM is disabled."
- **All WHOIS/RDAP registrant (owner) contact information has been redacted from this document and from the machine-readable inventory.** Only organisation-level and technical fields needed for infrastructure planning (registrar, nameservers, dates, DNSSEC state) are retained.
- **No domain in this document is marked ready for nameserver migration.** INF-CF-1 is inventory only; nameserver changes belong to INF-CF-2 and later, and only after this inventory has been reconciled with the actual provider control panels and the risks below have been resolved or explicitly accepted by the domain owner.

## Portfolio Summary

| Domain | Project | Registrar | DNS provider | DNSSEC | Web | Email | Migration readiness |
|---|---|---|---|---|---|---|---|
| agribee.tn | AgriBee | OVH | OVH (VERIFIED) | DISABLED | OK (no forced HTTPS) | SPF only, no DMARC | READY_FOR_CONTROL_PANEL_COMPARISON |
| darhijama.tn | Dar Hijama | OVH | OVH (VERIFIED) | DISABLED | OK, but serves as apparent default vhost for other domains on the shared IP | SPF only, no DMARC | READY_FOR_CONTROL_PANEL_COMPARISON |
| fixpert.tn | Fixpert | OVH | OVH (VERIFIED) | DISABLED | OK, consistent | SPF only, no DMARC | READY_FOR_CONTROL_PANEL_COMPARISON |
| idauto.tn | ID Auto | OVH | OVH (VERIFIED) | DISABLED | HTTPS refused on apex and www (no listener) | SPF only, no DMARC | NEEDS_DNS_REVIEW |
| mythosprod.xyz | Mythos OS / shared infrastructure | OVH sas | OVH (VERIFIED) | **ENABLED** | Broken — redirects to darhijama.tn on HTTP; HTTPS cert mismatch | SPF only, no DMARC | NEEDS_DNS_REVIEW |
| notrejour.tn | Notre Jour | OVH | OVH (VERIFIED) | DISABLED | OK, consistent; only domain with AAAA | SPF only, no DMARC | READY_FOR_CONTROL_PANEL_COMPARISON |
| ssangyong.autos | SsangYong Parts | OVH sas | OVH (VERIFIED) | **ENABLED** | OK, consistent | SPF only, no DMARC; unidentified TXT token | NEEDS_DNSSEC_REVIEW |
| uthinachess.tn | Uthina Chess | OVH | OVH (VERIFIED) | DISABLED | OK, consistent — **production** | SPF (softfail, inconsistent with rest of portfolio), no DMARC | READY_FOR_CONTROL_PANEL_COMPARISON |

Cross-portfolio observations:

- All eight domains are registered through **OVH** (registrar of record for the six `.tn` domains via ATI, and registrar-of-record "OVH sas" for the two gTLD domains `mythosprod.xyz` and `ssangyong.autos` via CentralNic RDAP) and use **OVH-operated authoritative nameservers** (`ns1.tn.ovh.net`/`dns1.tn.ovh.net` for the `.tn` domains, `ns109.ovh.net`/`dns109.ovh.net` for the two gTLDs). DNS provider classification is **VERIFIED** for all eight, not inferred.
- Six of the eight domains (`darhijama.tn`, `fixpert.tn`, `mythosprod.xyz`, `notrejour.tn`, `ssangyong.autos`, `uthinachess.tn`) resolve their apex `A` record to the same shared origin IP, `51.68.226.211`. `agribee.tn` resolves to a different IP (`51.91.236.255`), and `idauto.tn` resolves to a third, distinct IP (`213.186.33.5`).
- **Two domains — `mythosprod.xyz` and `ssangyong.autos` — already have DNSSEC ENABLED** at OVH (DS record present at the parent zone, confirmed via RDAP `secureDNS`). This is a critical finding for INF-CF-2/INF-CF-5 sequencing: a nameserver migration to Cloudflare must coordinate DS-record replacement with the cutover, or DNSSEC validation will break. The other six domains are explicitly `unsigned` per ATI WHOIS.
- **No domain in the portfolio publishes a DMARC record** (`_dmarc.<domain>` is `NXDOMAIN` for all eight). All eight publish an SPF `TXT` record; seven use a hardfail policy (`-all`) and one (`uthinachess.tn`) uses a softfail policy (`~all`).
- **No domain publishes a CAA record** — any publicly trusted CA can currently issue certificates for any of these domains.
- Every domain's TLS certificate (where reachable) is issued by **Let's Encrypt**, consistent with automated OVH/Coolify-managed certificate issuance.
- `coolify.mythosprod.xyz` is the only one of the seven administrative hostnames proposed in `docs/CLOUDFLARE_ARCHITECTURE.md` §3 that is **already live in public DNS** (resolves to the shared origin IP). The other six (`app.`, `api.`, `watch.`, `n8n.`, `admin.`, `files.`) do not yet resolve.

## Per-Domain Detail

### 1. agribee.tn — AgriBee

**Domain identity**
- Registry: ATI (.tn ccTLD) · Registrar: OVH (VERIFIED, via ATI WHOIS) · Status: Active · Creation: 2025-05-06 · Registrant: REDACTED — personal registrant information.

**Authoritative DNS**
- Nameservers: `ns1.tn.ovh.net`, `dns1.tn.ovh.net` · SOA primary: `dns1.tn.ovh.net` · SOA mailbox: `tech.ovh.net` · SOA serial: `2080395892` · DNS provider: **OVH (VERIFIED)**.

**DNSSEC**
- DS at parent: absent · State: **DISABLED** (ATI WHOIS reports `dnssec: unsigned`).

**Public DNS records**
- Apex `A`: `51.91.236.255`. `AAAA`: none. `www`: `CNAME` → `agribee.tn.` (canonical alias, the only domain in the portfolio using a real `www` CNAME rather than a duplicate `A` record). `MX`: `mx1`(1)/`mx2`(5)/`mx3`(100)`.mail.ovh.net`. `TXT`: `v=spf1 include:mx.ovh.com -all`. `CAA`: none. `NS`/`SOA`: as above.

**Email records**
- SPF: present, hardfail. DMARC: absent (`_dmarc.agribee.tn` is `NXDOMAIN`). MX provider: OVH. DKIM: `UNKNOWN` (no selector documented anywhere).

**HTTP/HTTPS behaviour**
- Apex HTTP: `200` (no redirect to HTTPS). Apex HTTPS: `200`, certificate `CN=agribee.tn`, Let's Encrypt, valid 2026-06-02 → 2026-08-31. `www` HTTP: `200`. `www` HTTPS: `200`. Apex and `www` behave consistently with each other, but the site is reachable in plaintext HTTP with no forced upgrade to HTTPS.

**Known subdomains and source**
- `www.agribee.tn` — PUBLIC DNS (CNAME) and CERTIFICATE TRANSPARENCY (crt.sh returned data for this domain only, confirming apex and `www`).

**Proposed Cloudflare classification**
- Apex `A`, `www` CNAME: `NEEDS_CONFIRMATION` (candidate `PROXIED` once HTTPS-only is enforced at origin). `MX`, `TXT`/SPF: `DNS_ONLY`. `NS`/`SOA`: `NOT_APPLICABLE`.

**Risks**
- No DMARC record. No forced HTTPS (plaintext access remains available on both apex and `www`).

**Unknowns**
- DKIM selector(s). Whether `51.91.236.255` is the same physical host as the shared cluster IP or a separate host.

**Required owner confirmation**
- Confirm whether HTTP should be redirected to HTTPS before or during migration. Confirm the `A`/`CNAME` pattern is intentional (it differs from every other domain in the portfolio).

**Readiness:** `READY_FOR_CONTROL_PANEL_COMPARISON`

---

### 2. darhijama.tn — Dar Hijama

**Domain identity**
- Registry: ATI (.tn ccTLD) · Registrar: OVH (VERIFIED) · Status: Active · Creation: 2026-06-18 · Registrant: REDACTED — personal registrant information.

**Authoritative DNS**
- Nameservers: `ns1.tn.ovh.net`, `dns1.tn.ovh.net` · SOA primary: `dns1.tn.ovh.net` · SOA mailbox: `tech.ovh.net` · SOA serial: `2081882914` · DNS provider: **OVH (VERIFIED)**.

**DNSSEC**
- DS at parent: absent · State: **DISABLED**.

**Public DNS records**
- Apex `A`: `51.68.226.211` (shared cluster IP). `AAAA`: none. `www`: `A` record, same IP (not a CNAME). `MX`: `mx1`(1)/`mx2`(5)/`mx3`(100)`.mail.ovh.net`. `TXT`: `v=spf1 include:mx.ovh.com -all`, and `"1|www.darhijama.tn"` (an OVH-generated internal marker of unconfirmed exact purpose, consistent across every `.tn` domain in this portfolio). `CAA`: none.

**Email records**
- SPF: present, hardfail. DMARC: absent. MX provider: OVH. DKIM: `UNKNOWN`.

**HTTP/HTTPS behaviour**
- Apex HTTP: `301` → `https://darhijama.tn/`. Apex HTTPS: `200`, certificate `CN=darhijama.tn`, Let's Encrypt, valid 2026-07-28 → 2026-10-26. `www` HTTP: `301` → `https://darhijama.tn/`. `www` HTTPS: `301` → `https://darhijama.tn/` (the `www` host is consolidated into the apex, not served separately).

**Known subdomains and source**
- `www.darhijama.tn` — PUBLIC DNS.

**Proposed Cloudflare classification**
- Apex/`www` `A`: `PROXIED` (candidate, pending origin-side confirmation). `MX`, SPF `TXT`: `DNS_ONLY`. The `"1|..."` marker TXT: `DNS_ONLY`, `REVIEW_BEFORE_RECREATE`.

**Risks**
- No DMARC record.
- **This domain's certificate and content are currently served as the apparent default vhost on the shared origin IP `51.68.226.211`.** During this observation, HTTP requests to `mythosprod.xyz` were redirected to `https://darhijama.tn/`. This must be resolved at the origin web server (vhost/SNI routing) before or during Cloudflare migration.

**Unknowns**
- DKIM selector(s). Exact purpose of the `"1|www.darhijama.tn"` TXT marker (appears to be an OVH hosting/redirection indicator, not independently confirmed via OVH documentation in this stage).

**Required owner confirmation**
- Confirm whether darhijama.tn being served as the default vhost for the shared IP is intentional, and if not, which domain should be the default/catch-all origin vhost before Cloudflare Tunnel routing (INF-CF-3) is configured.

**Readiness:** `READY_FOR_CONTROL_PANEL_COMPARISON`

---

### 3. fixpert.tn — Fixpert

**Domain identity**
- Registry: ATI (.tn ccTLD) · Registrar: OVH (VERIFIED) · Status: Active · Creation: 2026-07-15 · Registrant: REDACTED — personal registrant information.

**Authoritative DNS**
- Nameservers: `ns1.tn.ovh.net`, `dns1.tn.ovh.net` · SOA primary: `dns1.tn.ovh.net` · SOA mailbox: `tech.ovh.net` · SOA serial: `2084168973` · DNS provider: **OVH (VERIFIED)**.

**DNSSEC**
- DS at parent: absent · State: **DISABLED**.

**Public DNS records**
- Apex `A`: `51.68.226.211` (shared cluster IP). `AAAA`: none. `www`: `A` record, same IP. `MX`: `mx1`(1)/`mx2`(5)/`mx3`(100)`.mail.ovh.net`. `TXT`: SPF (`-all`) and the standard `"1|www.fixpert.tn"` OVH marker. `CAA`: none.

**Email records**
- SPF: present, hardfail. DMARC: absent. MX provider: OVH. DKIM: `UNKNOWN`.

**HTTP/HTTPS behaviour**
- Apex HTTP: `301` → `https://fixpert.tn/`. Apex HTTPS: `200`, certificate `CN=fixpert.tn`, Let's Encrypt, valid 2026-07-16 → 2026-10-14. `www` HTTP: `301` → `https://www.fixpert.tn/`. `www` HTTPS: `200` (unlike `darhijama.tn`, the `www` host here is served on its own, not consolidated into the apex). Apex and `www` behave consistently and each has its own matching certificate.

**Known subdomains and source**
- `www.fixpert.tn` — PUBLIC DNS.

**Proposed Cloudflare classification**
- Apex/`www` `A`: `PROXIED` (candidate, pending origin-side confirmation). `MX`, SPF `TXT`: `DNS_ONLY`. Marker `TXT`: `DNS_ONLY`, `REVIEW_BEFORE_RECREATE`.

**Risks**
- No DMARC record.
- `docs/IDAUTO_FIXPERT_INTEGRATION.md` and the Automotive documentation set describe Fixpert as an external, separately operated workshop system and the first Atelier Network pilot. DNS control for `fixpert.tn` must be reconciled with that operational boundary — this repository does not claim to operate the Fixpert application, only to potentially manage its DNS/edge layer.

**Unknowns**
- DKIM selector(s). Whether the Fixpert application server is the same physical host as the shared cluster IP or a distinct system reachable via vhost on the same IP.

**Required owner confirmation**
- Confirm who has operational authority over `fixpert.tn` DNS changes before INF-CF-2, given the external-system boundary documented for Fixpert.

**Readiness:** `READY_FOR_CONTROL_PANEL_COMPARISON`

---

### 4. idauto.tn — ID Auto

**Domain identity**
- Registry: ATI (.tn ccTLD) · Registrar: OVH (VERIFIED) · Status: Active · Creation: 2026-08-05 (registered the day before this observation) · Registrant: REDACTED — personal registrant information.

**Authoritative DNS**
- Nameservers: `ns1.tn.ovh.net`, `dns1.tn.ovh.net` · SOA primary: `dns1.tn.ovh.net` · SOA mailbox: `tech.ovh.net` · SOA serial: `2085924436` · DNS provider: **OVH (VERIFIED)**.

**DNSSEC**
- DS at parent: absent · State: **DISABLED**.

**Public DNS records**
- Apex `A`: `213.186.33.5` — a **distinct origin IP**, not the shared `51.68.226.211` cluster used by six of the other seven domains. `AAAA`: none. `www`: `A` record, same distinct IP. `MX`: `mx1`(1)/`mx2`(5)/`mx3`(100)`.mail.ovh.net`. `TXT`: SPF (`-all`) and the standard `"1|www.idauto.tn"` OVH marker. `CAA`: none.

**Email records**
- SPF: present, hardfail. DMARC: absent. MX provider: OVH. DKIM: `UNKNOWN`.

**HTTP/HTTPS behaviour**
- Apex HTTP: `302` → `http://www.idauto.tn/` (redirects, but stays on plaintext HTTP — does not upgrade to HTTPS). Apex HTTPS: connection **refused** on TCP port 443 (no HTTPS listener at all). `www` HTTP: `200`. `www` HTTPS: connection **refused**, same as apex. **idauto.tn currently has no working HTTPS on either host.**

**Known subdomains and source**
- `www.idauto.tn` — PUBLIC DNS (HTTP only).
- `staging.idauto.tn` — REPOSITORY (`docs/AUTOMOTIVE_ARCHITECTURE.md` §"Clear production/staging separation"). Does **not** currently resolve (`NXDOMAIN`) — this is a planned, not active, hostname; its presence in this document is not proof it is live.

**Proposed Cloudflare classification**
- Apex/`www` `A`: `NEEDS_CONFIRMATION` — cannot be safely marked `PROXIED` while the origin has no working HTTPS listener (Cloudflare's Full/Full(strict) modes require a valid origin certificate, and Flexible SSL is prohibited by `docs/CLOUDFLARE_ARCHITECTURE.md`). `MX`, SPF `TXT`: `DNS_ONLY`. Marker `TXT`: `DNS_ONLY`, `REVIEW_BEFORE_RECREATE`.

**Risks**
- **No working HTTPS on apex or `www`.** This must be fixed at the origin (deploy/enable a TLS listener and a valid certificate) before or during Cloudflare cutover — proxying a broken origin through Cloudflare does not fix the underlying gap, and Flexible SSL is not an approved workaround.
- Distinct origin IP from the shared cluster — confirm this is the intended, current ID Auto origin (e.g. the eventual IDA-2 PostgreSQL/API host) and not a stale or unrelated placeholder.
- Domain was registered only one day before this observation; DNS/web configuration may still be actively changing.
- No DMARC record.

**Unknowns**
- DKIM selector(s). Whether `213.186.33.5` is intended to become the ID Auto IDA-2 application host.

**Required owner confirmation**
- Confirm the intended origin host and HTTPS plan for `idauto.tn` before including it in any Cloudflare Tunnel routing (INF-CF-3).

**Readiness:** `NEEDS_DNS_REVIEW`

---

### 5. mythosprod.xyz — Mythos OS / shared infrastructure

**Domain identity**
- Registry: CentralNic (.xyz gTLD, via RDAP) · Registrar: OVH sas (VERIFIED) · Status: `client transfer prohibited`, `client delete prohibited` · Registration: 2026-06-02 · Expiry: 2027-06-02 · Last changed: 2026-07-01 · Registrant: REDACTED — personal registrant information (RDAP entities for this domain exposed only the registrar entity; no registrant vCard was returned, so no registrant redaction was required for this specific domain, but the general redaction policy still applies to this document).

**Authoritative DNS**
- Nameservers: `ns109.ovh.net`, `dns109.ovh.net` · SOA primary: `dns109.ovh.net` · SOA mailbox: `tech.ovh.net` · SOA serial: `2084664233` · DNS provider: **OVH (VERIFIED)**.

**DNSSEC**
- DS at parent: **present** (`keyTag 57275`, `algorithm 8`, `digestType 2`, confirmed via RDAP `secureDNS.delegationSigned = true`). State: **ENABLED**. This state is derived from the DS record at the parent zone via RDAP, not inferred from DNSKEY visibility alone.

**Public DNS records**
- Apex `A`: `51.68.226.211` (shared cluster IP). `AAAA`: none. `www`: `A` record, same IP. `coolify.mythosprod.xyz`: `A`, same IP — **active** administrative hostname. `MX`: `mx1`(1)/`mx2`(5)/`mx3`(100)`.mail.ovh.net`. `TXT`: SPF (`-all`) and the standard `"1|www.mythosprod.xyz"` OVH marker. `CAA`: none.

**Email records**
- SPF: present, hardfail. DMARC: absent. MX provider: OVH. DKIM: `UNKNOWN`.

**HTTP/HTTPS behaviour**
- Apex HTTP: `301` → `https://darhijama.tn/` — **redirects to a different domain entirely**, not to `mythosprod.xyz`'s own HTTPS. Apex HTTPS: connection fails with a TLS SNI/certificate mismatch (`SEC_E_WRONG_PRINCIPAL` — the certificate presented does not match `mythosprod.xyz`). `www` HTTP: `301` → `https://darhijama.tn/`, same issue. `www` HTTPS: same certificate mismatch failure. **`mythosprod.xyz` currently has no working web presence under its own name.**

**Known subdomains and source**
- `coolify.mythosprod.xyz` — PUBLIC DNS, **active**, resolves to the shared cluster IP. This is the only one of the seven administrative hostnames proposed in `docs/CLOUDFLARE_ARCHITECTURE.md` §3 that is currently live.
- `app.mythosprod.xyz`, `api.mythosprod.xyz`, `watch.mythosprod.xyz`, `n8n.mythosprod.xyz`, `admin.mythosprod.xyz`, `files.mythosprod.xyz` — REPOSITORY (`docs/CLOUDFLARE_ARCHITECTURE.md` §3, `docs/CLOUDFLARE_DEPLOYMENT_CHECKLIST.md` INF-CF-3). None currently resolve (`NXDOMAIN`) — all six are proposals, not active DNS.

**Proposed Cloudflare classification**
- Apex/`www` `A`: `PROXIED` (candidate — but see risks; the origin routing must be fixed first, independent of Cloudflare). `coolify.mythosprod.xyz`: `NEEDS_CONFIRMATION` — this is an administrative hostname and must be protected by Cloudflare Access (INF-CF-4) before or immediately upon proxying, never exposed publicly without Access. `MX`, SPF `TXT`: `DNS_ONLY`. Marker `TXT`: `DNS_ONLY`, `REVIEW_BEFORE_RECREATE`. Proposed-but-not-yet-created hostnames (`app.`, `api.`, `watch.`, `n8n.`, `admin.`, `files.`): `NEEDS_CONFIRMATION` — they do not resolve today, so there is nothing to migrate yet, and each must be classified per `docs/CLOUDFLARE_ARCHITECTURE.md` §3 at creation time.

**Risks**
- **Highest-priority finding in this inventory.** `mythosprod.xyz` — the umbrella domain for this repository's own infrastructure — has no working web presence: HTTP redirects to a different domain (`darhijama.tn`), and HTTPS fails outright due to a certificate/SNI mismatch. This must be diagnosed and fixed at the origin (Coolify/vhost routing on the shared IP) before or during any Cloudflare migration. Cloudflare proxying does not fix a broken origin, and Full (strict) mode — the only approved TLS mode per `docs/CLOUDFLARE_ARCHITECTURE.md` §2.6 — requires a valid, matching origin certificate that does not currently exist for this hostname.
- **DNSSEC is currently ENABLED and signed by OVH.** A nameserver migration to Cloudflare (INF-CF-2) must coordinate DS-record replacement with the cutover window. Switching nameservers to Cloudflare while the old OVH DS record remains published at the registrar will break DNSSEC validation for this domain. This must be planned explicitly, following the DNSSEC sequencing already defined for INF-CF-5 in `docs/CLOUDFLARE_DEPLOYMENT_CHECKLIST.md` — do not attempt this cutover casually or as an afterthought during INF-CF-2.
- `coolify.mythosprod.xyz` is an already-active, presumably administrative, production DNS record and must be protected by Cloudflare Access before or immediately upon proxying.
- No DMARC record.

**Unknowns**
- Root cause of the `darhijama.tn` redirect — most likely a default/catch-all vhost on the shared origin, not confirmed without provider/control-panel access.
- DKIM selector(s).
- Timing: whether the six proposed administrative hostnames are intended to be created before, during, or after INF-CF-2/INF-CF-3.

**Required owner confirmation**
- Confirm and fix the origin vhost/certificate routing for `mythosprod.xyz` before this domain is included in any Cloudflare Tunnel routing.
- Confirm the DNSSEC cutover plan (DS-record coordination) before any nameserver change.
- Confirm `coolify.mythosprod.xyz` is intentionally public-DNS-visible today and whether it currently has any access control at the origin.

**Readiness:** `NEEDS_DNS_REVIEW`

---

### 6. notrejour.tn — Notre Jour

**Domain identity**
- Registry: ATI (.tn ccTLD) · Registrar: OVH (VERIFIED) · Status: Active · Creation: 2026-07-14 · Registrant: REDACTED — personal registrant information.

**Authoritative DNS**
- Nameservers: `ns1.tn.ovh.net`, `dns1.tn.ovh.net` · SOA primary: `dns1.tn.ovh.net` · SOA mailbox: `tech.ovh.net` · SOA serial: `2084451926` · DNS provider: **OVH (VERIFIED)**.

**DNSSEC**
- DS at parent: absent · State: **DISABLED**.

**Public DNS records**
- Apex `A`: `51.68.226.211` (shared cluster IP). Apex `AAAA`: `2001:41d0:367:338::1` — **the only domain in this portfolio with a public IPv6 record**. `www`: `A` record, same IPv4. `MX`: `mx1`(1)/`mx2`(5)/`mx3`(100)`.mail.ovh.net`. `TXT`: SPF (`-all`) and the standard `"1|www.notrejour.tn"` OVH marker. `CAA`: none.

**Email records**
- SPF: present, hardfail. DMARC: absent. MX provider: OVH. DKIM: `UNKNOWN`.

**HTTP/HTTPS behaviour**
- Apex HTTP: `301` → `https://notrejour.tn/`. Apex HTTPS: `200`, certificate `CN=notrejour.tn`, Let's Encrypt, valid 2026-07-19 → 2026-10-17. `www` HTTP: `301` → `https://www.notrejour.tn/`. `www` HTTPS: `200`. Consistent behaviour between apex and `www`, each with a matching certificate.

**Known subdomains and source**
- `www.notrejour.tn` — PUBLIC DNS.

**Proposed Cloudflare classification**
- Apex/`www` `A`: `PROXIED` (candidate, pending origin-side confirmation). Apex `AAAA`: `PROXIED` (candidate) — must be migrated together with the `A` record to avoid IPv4/IPv6 behavioural divergence if proxying is enabled. `MX`, SPF `TXT`: `DNS_ONLY`. Marker `TXT`: `DNS_ONLY`, `REVIEW_BEFORE_RECREATE`.

**Risks**
- No DMARC record.
- Only domain with a public `AAAA` — if Cloudflare proxying is enabled for this hostname, both `A` and `AAAA` must be migrated and kept consistent.
- Repository memory (outside this document) notes a prior PSR-4 casing bug (`database`/`Database`) affecting Windows-local vs Linux-VPS deployment for this project. Not a DNS issue, but relevant context for whoever compares this domain's control panel before migration.

**Unknowns**
- DKIM selector(s). Whether the IPv6 host is the same physical origin as the shared IPv4 cluster or a separate path.

**Required owner confirmation**
- Confirm whether IPv6 reachability must be preserved through Cloudflare (Cloudflare proxies both A and AAAA to the same anycast edge regardless, but the origin-side IPv6 path should be confirmed as still required).

**Readiness:** `READY_FOR_CONTROL_PANEL_COMPARISON`

---

### 7. ssangyong.autos — SsangYong Parts

**Domain identity**
- Registry: CentralNic (.autos gTLD, via RDAP) · Registrar: OVH sas (VERIFIED) · Status: `server transfer prohibited`, `client transfer prohibited`, `client delete prohibited` · Registration: 2026-06-13 · Expiry: 2027-06-13 · Last changed: 2026-07-01 · Registrant: REDACTED — personal registrant information (no registrant vCard exposed via RDAP for this domain; general redaction policy still applies).

**Authoritative DNS**
- Nameservers: `ns109.ovh.net`, `dns109.ovh.net` · SOA primary: `dns109.ovh.net` · SOA mailbox: `tech.ovh.net` · SOA serial: `2083953307` · DNS provider: **OVH (VERIFIED)**.

**DNSSEC**
- DS at parent: **present** (`keyTag 28532`, `algorithm 8`, `digestType 2`, confirmed via RDAP `secureDNS.delegationSigned = true`). State: **ENABLED**.

**Public DNS records**
- Apex `A`: `51.68.226.211` (shared cluster IP). `AAAA`: none. `www`: `A` record, same IP. `MX`: `mx1`(1)/`mx2`(5)/`mx3`(100)`.mail.ovh.net`. `TXT`: SPF (`-all`), the standard `"1|www.ssangyong.autos"` OVH marker, **and** an additional unidentified 40-character token (`12372381081992d8ae412947bfae0c8c6f961ed6`) with no documented purpose. `CAA`: none.

**Email records**
- SPF: present, hardfail. DMARC: absent. MX provider: OVH. DKIM: `UNKNOWN`.

**HTTP/HTTPS behaviour**
- Apex HTTP: `301` → `https://ssangyong.autos/`. Apex HTTPS: `200`, certificate `CN=ssangyong.autos`, Let's Encrypt, valid 2026-07-08 → 2026-10-06. `www` HTTP: `301` → `https://www.ssangyong.autos/`. `www` HTTPS: `200`. Consistent behaviour, each with a matching certificate.

**Known subdomains and source**
- `www.ssangyong.autos` — PUBLIC DNS.

**Proposed Cloudflare classification**
- Apex/`www` `A`: `PROXIED` (candidate, pending origin-side confirmation, and pending DNSSEC cutover coordination — see risks). `MX`, SPF `TXT`: `DNS_ONLY`. Marker `TXT` and unidentified verification token: `DNS_ONLY`, `REVIEW_BEFORE_RECREATE` — do not discard the unidentified token without owner confirmation.

**Risks**
- **DNSSEC is currently ENABLED and signed by OVH**, identical in nature to the `mythosprod.xyz` finding above — the same DS-record/nameserver-cutover coordination requirement applies. Do not switch nameservers to Cloudflare while the OVH DS record remains published at the registrar.
- An unidentified 40-character `TXT` token is present at the apex. This has the shape of a third-party site-verification token (e.g. a search console, analytics, or marketing-tool verification string). Its owner and purpose are not confirmed in this stage — do not remove it during migration without confirming what depends on it, since removing an active third-party verification token could silently break that integration.
- No DMARC record.
- `docs/AUTOMOTIVE_*` classifies `ssangyong.autos` as an external system outside this repository's runtime — DNS control must be reconciled with that boundary before migration.

**Unknowns**
- DKIM selector(s). Purpose and owner of the unidentified verification-style TXT token.

**Required owner confirmation**
- Identify the purpose of the unidentified TXT token before migration.
- Confirm the DNSSEC cutover plan (DS-record coordination) before any nameserver change, same as `mythosprod.xyz`.

**Readiness:** `NEEDS_DNSSEC_REVIEW`

---

### 8. uthinachess.tn — Uthina Chess

**Domain identity**
- Registry: ATI (.tn ccTLD) · Registrar: OVH (VERIFIED) · Status: Active · Creation: 2026-06-24 · Registrant: REDACTED — personal registrant information.

**Authoritative DNS**
- Nameservers: `ns1.tn.ovh.net`, `dns1.tn.ovh.net` · SOA primary: `dns1.tn.ovh.net` · SOA mailbox: `tech.ovh.net` · SOA serial: `2082607515` · DNS provider: **OVH (VERIFIED)**.

**DNSSEC**
- DS at parent: absent · State: **DISABLED**.

**Public DNS records**
- Apex `A`: `51.68.226.211` (shared cluster IP) — this is the domain hosting the live **production** Mythos OS application referenced throughout this repository (production path `/var/www/uthinachess/0726/Prod/`). `AAAA`: none. `www`: `A` record, same IP. `MX`: a **four-record** set — `mx0`(1)/`mx1`(5)/`mx2`(50)/`mx3`(100)`.mail.ovh.net` — different in shape from the three-record set (`mx1`/`mx2`/`mx3` at priorities 1/5/100) used by every other domain in the portfolio, consistent with a different OVH mail plan tier. `TXT`: SPF using **softfail** (`~all`, unlike the hardfail `-all` used by all seven other domains) and the standard `"1|www.uthinachess.tn"` OVH marker. `CAA`: none.

**Email records**
- SPF: present, **softfail** (`~all`) — inconsistent with the rest of the portfolio. DMARC: absent. MX provider: OVH (distinct four-record plan). DKIM: `UNKNOWN`.

**HTTP/HTTPS behaviour**
- Apex HTTP: `301` → `https://uthinachess.tn/`. Apex HTTPS: `200`, certificate `CN=uthinachess.tn`, Let's Encrypt, valid 2026-06-29 → 2026-09-27. `www` HTTP: `301` → `https://www.uthinachess.tn/`. `www` HTTPS: `200`. Consistent behaviour, each with a matching certificate.

**Known subdomains and source**
- `www.uthinachess.tn` — PUBLIC DNS.

**Proposed Cloudflare classification**
- Apex/`www` `A`: `PROXIED` (candidate — but see risks; this is the highest-blast-radius domain in the portfolio). `MX`: `DNS_ONLY`, `RECREATE_EXACTLY` — the four-record set must be reproduced exactly, not assumed identical to the other domains' three-record pattern. SPF `TXT`: `DNS_ONLY`. Marker `TXT`: `DNS_ONLY`, `REVIEW_BEFORE_RECREATE`.

**Risks**
- **This domain hosts the live production Mythos OS application.** It carries the highest blast radius of any domain in this portfolio. Do not include `uthinachess.tn` in any DNS or nameserver change until an explicit, separately authorised production-migration plan and rollback path exist — beyond the standard sequence used for the other, lower-risk domains in this portfolio.
- SPF softfail (`~all`) instead of hardfail (`-all`) — inconsistent with the rest of the portfolio; confirm whether this is intentional (e.g. tied to a specific mail-sending pattern) before recreating during migration.
- MX record shape (four records, distinct priority spacing) differs from the rest of the portfolio and must be reproduced exactly.
- No DMARC record.

**Unknowns**
- DKIM selector(s). Whether the SPF softfail policy is deliberate.

**Required owner confirmation**
- Explicit, separate sign-off required before this domain is included in any nameserver or DNS change, given its production status. This confirmation is additional to, not a substitute for, the standard INF-CF-2 review applied to the rest of the portfolio.

**Readiness:** `READY_FOR_CONTROL_PANEL_COMPARISON`

---

## Summary of Cross-Cutting Risks Requiring Owner Confirmation Before INF-CF-2

1. **mythosprod.xyz has no working web presence** (wrong-domain HTTP redirect, HTTPS certificate mismatch) — must be fixed at the origin before or during Cloudflare migration.
2. **DNSSEC is already ENABLED on `mythosprod.xyz` and `ssangyong.autos`** — nameserver cutover for these two domains requires coordinated DS-record replacement, not a simple nameserver swap.
3. **`idauto.tn` has no working HTTPS at all** on either apex or `www` — origin TLS must be established before this domain can be proxied under Cloudflare's Full (strict) policy.
4. **`uthinachess.tn` is the live production application** and requires separate, explicit migration authorisation beyond the standard review applied to the rest of the portfolio.
5. **No domain in the portfolio has DMARC.** This is a portfolio-wide email-authentication gap, independent of the Cloudflare migration itself, and should be raised with the domain owner regardless of migration timing.
6. **An unidentified verification token exists on `ssangyong.autos`** and must not be discarded without confirming what depends on it.
7. **Certificate-transparency subdomain discovery is incomplete** for six of the eight domains due to `crt.sh` rate-limiting during this observation window — re-run independently before treating subdomain discovery as complete.

No domain in this document is marked ready for nameserver migration. INF-CF-2 begins only after this inventory is reconciled with the provider control panels and every item above is resolved or explicitly accepted by the domain owner.
