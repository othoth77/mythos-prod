# Mythos OS — Cloudflare DNS Migration Matrix

- **Stage:** INF-CF-1 — Cloudflare Account and Domain Inventory
- **Observation timestamp (UTC):** 2026-08-06T00:02:54Z
- **Source:** Public DNS resolution (Cloudflare `1.1.1.1` / DNS-over-HTTPS), public RDAP/WHOIS, public TLS inspection. See `docs/CLOUDFLARE_DOMAIN_INVENTORY.md` for full methodology, per-domain detail, risks, and limitations. This document is the flat, consolidated migration-planning view of the same underlying observations.

**This matrix does not authorise any DNS change.** It is a planning reference for INF-CF-2. Every row with `requires_confirmation = true` in the machine-readable inventory (`projects/infrastructure/cloudflare/domain-inventory.json`) must be confirmed against the provider control panel before it is recreated in Cloudflare.

## Proposed Mode Legend

- `PROXIED` — candidate for Cloudflare's orange-cloud proxy (public HTTP/HTTPS hostnames only, subject to the origin-side caveats noted per domain).
- `DNS_ONLY` — must remain grey-cloud / unproxied in Cloudflare (mail, SPF/verification TXT records, and any non-HTTP record).
- `NOT_APPLICABLE` — not a proxy/DNS-only decision at all (NS, SOA, and records confirmed absent from the current zone).
- `NEEDS_CONFIRMATION` — cannot be classified from public evidence alone; requires the domain owner or a provider control-panel check before a mode is assigned.

## Migration Action Legend

- `RECREATE_EXACTLY` — value is fully known and safe to reproduce as-is in Cloudflare.
- `REVIEW_BEFORE_RECREATE` — value or purpose is not fully confirmed; a human must review before recreating.
- `KEEP_DNS_ONLY` — record must never be proxied (mail, verification, non-HTTP records).
- `PROXY_AFTER_VALIDATION` — candidate for Cloudflare proxying once the origin-side issue noted for that domain is resolved.
- `DO_NOT_MIGRATE` — not used in this matrix; no record in this portfolio was classified this way at this stage.
- `NOT_APPLICABLE` — no migration action applies (record confirmed absent from the current zone, or the row describes zone metadata such as SOA rather than a record to recreate).
- `UNKNOWN` — purpose or safe handling could not be determined from public sources alone (used only for NS, whose recreation approach depends on the chosen Cloudflare onboarding method, and for the one planned-but-not-yet-active repository-sourced hostname).

## Consolidated Matrix

| Domain | Name | Type | Public value summary | Current purpose | Proposed mode | Migration action | Verification required |
|---|---|---|---|---|---|---|---|
| agribee.tn | agribee.tn | NS | ns1.tn.ovh.net, dns1.tn.ovh.net | Authoritative nameservers (OVH) | NOT_APPLICABLE | UNKNOWN | Yes |
| agribee.tn | agribee.tn | SOA | dns1.tn.ovh.net / tech.ovh.net, serial 2080395892 | Zone metadata | NOT_APPLICABLE | UNKNOWN | No |
| agribee.tn | agribee.tn | A | 51.91.236.255 | Apex web origin (distinct IP from shared cluster) | NEEDS_CONFIRMATION | REVIEW_BEFORE_RECREATE | Yes |
| agribee.tn | www.agribee.tn | CNAME | → agribee.tn. | www alias (only true CNAME `www` in the portfolio) | NEEDS_CONFIRMATION | REVIEW_BEFORE_RECREATE | Yes |
| agribee.tn | agribee.tn | MX | 1 mx1, 5 mx2, 100 mx3 (mail.ovh.net) | Inbound mail routing | DNS_ONLY | RECREATE_EXACTLY | No |
| agribee.tn | agribee.tn | TXT | v=spf1 include:mx.ovh.com -all | SPF (hardfail) | DNS_ONLY | RECREATE_EXACTLY | No |
| agribee.tn | agribee.tn | CAA | (none present) | — | NOT_APPLICABLE | NOT_APPLICABLE | No |
| agribee.tn | _dmarc.agribee.tn | TXT | absent (NXDOMAIN) | No DMARC policy published | NOT_APPLICABLE | NOT_APPLICABLE | Yes — recommend creating one, independent of migration |
| darhijama.tn | darhijama.tn | NS | ns1.tn.ovh.net, dns1.tn.ovh.net | Authoritative nameservers (OVH) | NOT_APPLICABLE | UNKNOWN | Yes |
| darhijama.tn | darhijama.tn | SOA | dns1.tn.ovh.net / tech.ovh.net, serial 2081882914 | Zone metadata | NOT_APPLICABLE | UNKNOWN | No |
| darhijama.tn | darhijama.tn | A | 51.68.226.211 (shared cluster IP) | Apex web origin — apparent default vhost for the shared IP | PROXIED | PROXY_AFTER_VALIDATION | Yes |
| darhijama.tn | www.darhijama.tn | A | 51.68.226.211 (not a CNAME) | www origin, consolidated into apex on HTTPS | PROXIED | PROXY_AFTER_VALIDATION | Yes |
| darhijama.tn | darhijama.tn | MX | 1 mx1, 5 mx2, 100 mx3 (mail.ovh.net) | Inbound mail routing | DNS_ONLY | RECREATE_EXACTLY | No |
| darhijama.tn | darhijama.tn | TXT | v=spf1 include:mx.ovh.com -all | SPF (hardfail) | DNS_ONLY | RECREATE_EXACTLY | No |
| darhijama.tn | darhijama.tn | TXT | "1\|www.darhijama.tn" (OVH internal marker) | Unconfirmed — likely OVH hosting/redirect indicator | DNS_ONLY | REVIEW_BEFORE_RECREATE | Yes |
| darhijama.tn | darhijama.tn | CAA | (none present) | — | NOT_APPLICABLE | NOT_APPLICABLE | No |
| darhijama.tn | _dmarc.darhijama.tn | TXT | absent (NXDOMAIN) | No DMARC policy published | NOT_APPLICABLE | NOT_APPLICABLE | Yes |
| fixpert.tn | fixpert.tn | NS | ns1.tn.ovh.net, dns1.tn.ovh.net | Authoritative nameservers (OVH) | NOT_APPLICABLE | UNKNOWN | Yes |
| fixpert.tn | fixpert.tn | SOA | dns1.tn.ovh.net / tech.ovh.net, serial 2084168973 | Zone metadata | NOT_APPLICABLE | UNKNOWN | No |
| fixpert.tn | fixpert.tn | A | 51.68.226.211 (shared cluster IP) | Apex web origin | PROXIED | PROXY_AFTER_VALIDATION | Yes |
| fixpert.tn | www.fixpert.tn | A | 51.68.226.211 (not a CNAME) | www origin, served independently with its own cert | PROXIED | PROXY_AFTER_VALIDATION | Yes |
| fixpert.tn | fixpert.tn | MX | 1 mx1, 5 mx2, 100 mx3 (mail.ovh.net) | Inbound mail routing | DNS_ONLY | RECREATE_EXACTLY | No |
| fixpert.tn | fixpert.tn | TXT | v=spf1 include:mx.ovh.com -all | SPF (hardfail) | DNS_ONLY | RECREATE_EXACTLY | No |
| fixpert.tn | fixpert.tn | TXT | "1\|www.fixpert.tn" (OVH internal marker) | Unconfirmed | DNS_ONLY | REVIEW_BEFORE_RECREATE | Yes |
| fixpert.tn | fixpert.tn | CAA | (none present) | — | NOT_APPLICABLE | NOT_APPLICABLE | No |
| fixpert.tn | _dmarc.fixpert.tn | TXT | absent (NXDOMAIN) | No DMARC policy published | NOT_APPLICABLE | NOT_APPLICABLE | Yes |
| idauto.tn | idauto.tn | NS | ns1.tn.ovh.net, dns1.tn.ovh.net | Authoritative nameservers (OVH) | NOT_APPLICABLE | UNKNOWN | Yes |
| idauto.tn | idauto.tn | SOA | dns1.tn.ovh.net / tech.ovh.net, serial 2085924436 | Zone metadata | NOT_APPLICABLE | UNKNOWN | No |
| idauto.tn | idauto.tn | A | 213.186.33.5 (distinct origin IP) | Apex web origin — **no HTTPS listener** | NEEDS_CONFIRMATION | REVIEW_BEFORE_RECREATE | Yes |
| idauto.tn | www.idauto.tn | A | 213.186.33.5 (not a CNAME) | www origin — **no HTTPS listener** | NEEDS_CONFIRMATION | REVIEW_BEFORE_RECREATE | Yes |
| idauto.tn | idauto.tn | MX | 1 mx1, 5 mx2, 100 mx3 (mail.ovh.net) | Inbound mail routing | DNS_ONLY | RECREATE_EXACTLY | No |
| idauto.tn | idauto.tn | TXT | v=spf1 include:mx.ovh.com -all | SPF (hardfail) | DNS_ONLY | RECREATE_EXACTLY | No |
| idauto.tn | idauto.tn | TXT | "1\|www.idauto.tn" (OVH internal marker) | Unconfirmed | DNS_ONLY | REVIEW_BEFORE_RECREATE | Yes |
| idauto.tn | idauto.tn | CAA | (none present) | — | NOT_APPLICABLE | NOT_APPLICABLE | No |
| idauto.tn | _dmarc.idauto.tn | TXT | absent (NXDOMAIN) | No DMARC policy published | NOT_APPLICABLE | NOT_APPLICABLE | Yes |
| idauto.tn | staging.idauto.tn | A/CNAME | not resolving (NXDOMAIN); referenced only in `docs/AUTOMOTIVE_ARCHITECTURE.md` | Planned staging split, not yet active | NEEDS_CONFIRMATION | UNKNOWN | Yes |
| mythosprod.xyz | mythosprod.xyz | NS | ns109.ovh.net, dns109.ovh.net | Authoritative nameservers (OVH) | NOT_APPLICABLE | UNKNOWN | Yes |
| mythosprod.xyz | mythosprod.xyz | SOA | dns109.ovh.net / tech.ovh.net, serial 2084664233 | Zone metadata | NOT_APPLICABLE | UNKNOWN | No |
| mythosprod.xyz | mythosprod.xyz | A | 51.68.226.211 (shared cluster IP) | Apex web origin — **HTTP redirects to darhijama.tn; HTTPS cert mismatch** | PROXIED | REVIEW_BEFORE_RECREATE | Yes |
| mythosprod.xyz | www.mythosprod.xyz | A | 51.68.226.211 (not a CNAME) | www origin — same broken routing as apex | PROXIED | REVIEW_BEFORE_RECREATE | Yes |
| mythosprod.xyz | coolify.mythosprod.xyz | A | 51.68.226.211 (shared cluster IP) | **Active** administrative hostname (Coolify dashboard) | NEEDS_CONFIRMATION | REVIEW_BEFORE_RECREATE | Yes — must gain Cloudflare Access before/at proxy time |
| mythosprod.xyz | mythosprod.xyz | MX | 1 mx1, 5 mx2, 100 mx3 (mail.ovh.net) | Inbound mail routing | DNS_ONLY | RECREATE_EXACTLY | No |
| mythosprod.xyz | mythosprod.xyz | TXT | v=spf1 include:mx.ovh.com -all | SPF (hardfail) | DNS_ONLY | RECREATE_EXACTLY | No |
| mythosprod.xyz | mythosprod.xyz | TXT | "1\|www.mythosprod.xyz" (OVH internal marker) | Unconfirmed | DNS_ONLY | REVIEW_BEFORE_RECREATE | Yes |
| mythosprod.xyz | mythosprod.xyz | CAA | (none present) | — | NOT_APPLICABLE | NOT_APPLICABLE | No |
| mythosprod.xyz | mythosprod.xyz | DS (parent) | keyTag 57275, algorithm 8, digestType 2 | **DNSSEC currently ENABLED and signed by OVH** | NOT_APPLICABLE | REVIEW_BEFORE_RECREATE | Yes — coordinate with DS-record cutover, see INF-CF-5 |
| mythosprod.xyz | _dmarc.mythosprod.xyz | TXT | absent (NXDOMAIN) | No DMARC policy published | NOT_APPLICABLE | NOT_APPLICABLE | Yes |
| mythosprod.xyz | app.mythosprod.xyz | A | not resolving (NXDOMAIN); proposed in `docs/CLOUDFLARE_ARCHITECTURE.md` | Planned public application hostname | NEEDS_CONFIRMATION | UNKNOWN | Yes — at creation time |
| mythosprod.xyz | api.mythosprod.xyz | A | not resolving (NXDOMAIN); proposed | Planned API hostname (public or private, TBD) | NEEDS_CONFIRMATION | UNKNOWN | Yes — at creation time |
| mythosprod.xyz | watch.mythosprod.xyz | A | not resolving (NXDOMAIN); proposed | Planned Domain Watch interface | NEEDS_CONFIRMATION | UNKNOWN | Yes — at creation time |
| mythosprod.xyz | n8n.mythosprod.xyz | A | not resolving (NXDOMAIN); proposed | Planned n8n service | NEEDS_CONFIRMATION | UNKNOWN | Yes — at creation time |
| mythosprod.xyz | admin.mythosprod.xyz | A | not resolving (NXDOMAIN); proposed | Planned admin panel | NEEDS_CONFIRMATION | UNKNOWN | Yes — at creation time |
| mythosprod.xyz | files.mythosprod.xyz | A | not resolving (NXDOMAIN); proposed | Planned file service / R2 front | NEEDS_CONFIRMATION | UNKNOWN | Yes — at creation time |
| notrejour.tn | notrejour.tn | NS | ns1.tn.ovh.net, dns1.tn.ovh.net | Authoritative nameservers (OVH) | NOT_APPLICABLE | UNKNOWN | Yes |
| notrejour.tn | notrejour.tn | SOA | dns1.tn.ovh.net / tech.ovh.net, serial 2084451926 | Zone metadata | NOT_APPLICABLE | UNKNOWN | No |
| notrejour.tn | notrejour.tn | A | 51.68.226.211 (shared cluster IP) | Apex web origin | PROXIED | PROXY_AFTER_VALIDATION | Yes |
| notrejour.tn | notrejour.tn | AAAA | 2001:41d0:367:338::1 | Apex web origin, IPv6 — only domain in portfolio with AAAA | PROXIED | REVIEW_BEFORE_RECREATE | Yes — must move together with A |
| notrejour.tn | www.notrejour.tn | A | 51.68.226.211 (not a CNAME) | www origin | PROXIED | PROXY_AFTER_VALIDATION | Yes |
| notrejour.tn | notrejour.tn | MX | 1 mx1, 5 mx2, 100 mx3 (mail.ovh.net) | Inbound mail routing | DNS_ONLY | RECREATE_EXACTLY | No |
| notrejour.tn | notrejour.tn | TXT | v=spf1 include:mx.ovh.com -all | SPF (hardfail) | DNS_ONLY | RECREATE_EXACTLY | No |
| notrejour.tn | notrejour.tn | TXT | "1\|www.notrejour.tn" (OVH internal marker) | Unconfirmed | DNS_ONLY | REVIEW_BEFORE_RECREATE | Yes |
| notrejour.tn | notrejour.tn | CAA | (none present) | — | NOT_APPLICABLE | NOT_APPLICABLE | No |
| notrejour.tn | _dmarc.notrejour.tn | TXT | absent (NXDOMAIN) | No DMARC policy published | NOT_APPLICABLE | NOT_APPLICABLE | Yes |
| ssangyong.autos | ssangyong.autos | NS | ns109.ovh.net, dns109.ovh.net | Authoritative nameservers (OVH) | NOT_APPLICABLE | UNKNOWN | Yes |
| ssangyong.autos | ssangyong.autos | SOA | dns109.ovh.net / tech.ovh.net, serial 2083953307 | Zone metadata | NOT_APPLICABLE | UNKNOWN | No |
| ssangyong.autos | ssangyong.autos | A | 51.68.226.211 (shared cluster IP) | Apex web origin | PROXIED | PROXY_AFTER_VALIDATION | Yes |
| ssangyong.autos | www.ssangyong.autos | A | 51.68.226.211 (not a CNAME) | www origin | PROXIED | PROXY_AFTER_VALIDATION | Yes |
| ssangyong.autos | ssangyong.autos | MX | 1 mx1, 5 mx2, 100 mx3 (mail.ovh.net) | Inbound mail routing | DNS_ONLY | RECREATE_EXACTLY | No |
| ssangyong.autos | ssangyong.autos | TXT | v=spf1 include:mx.ovh.com -all | SPF (hardfail) | DNS_ONLY | RECREATE_EXACTLY | No |
| ssangyong.autos | ssangyong.autos | TXT | "1\|www.ssangyong.autos" (OVH internal marker) | Unconfirmed | DNS_ONLY | REVIEW_BEFORE_RECREATE | Yes |
| ssangyong.autos | ssangyong.autos | TXT | "12372381081992d8ae412947bfae0c8c6f961ed6" (full 40-character record value reproduced as-is; not a secret, see Notes below) | **Unidentified verification-style token** | DNS_ONLY | REVIEW_BEFORE_RECREATE | Yes — do not discard without confirming dependency |
| ssangyong.autos | ssangyong.autos | CAA | (none present) | — | NOT_APPLICABLE | NOT_APPLICABLE | No |
| ssangyong.autos | ssangyong.autos | DS (parent) | keyTag 28532, algorithm 8, digestType 2 | **DNSSEC currently ENABLED and signed by OVH** | NOT_APPLICABLE | REVIEW_BEFORE_RECREATE | Yes — coordinate with DS-record cutover, see INF-CF-5 |
| ssangyong.autos | _dmarc.ssangyong.autos | TXT | absent (NXDOMAIN) | No DMARC policy published | NOT_APPLICABLE | NOT_APPLICABLE | Yes |
| uthinachess.tn | uthinachess.tn | NS | ns1.tn.ovh.net, dns1.tn.ovh.net | Authoritative nameservers (OVH) | NOT_APPLICABLE | UNKNOWN | Yes |
| uthinachess.tn | uthinachess.tn | SOA | dns1.tn.ovh.net / tech.ovh.net, serial 2082607515 | Zone metadata | NOT_APPLICABLE | UNKNOWN | No |
| uthinachess.tn | uthinachess.tn | A | 51.68.226.211 (shared cluster IP) | Apex web origin — **live production application** | PROXIED | REVIEW_BEFORE_RECREATE | Yes — requires separate production-migration authorisation |
| uthinachess.tn | www.uthinachess.tn | A | 51.68.226.211 (not a CNAME) | www origin — production | PROXIED | REVIEW_BEFORE_RECREATE | Yes — same as apex |
| uthinachess.tn | uthinachess.tn | MX | 1 mx0, 5 mx1, 50 mx2, 100 mx3 (mail.ovh.net) — four-record set, differs from the rest of the portfolio | Inbound mail routing | DNS_ONLY | RECREATE_EXACTLY | No — but must reproduce the exact four-record shape |
| uthinachess.tn | uthinachess.tn | TXT | v=spf1 include:mx.ovh.com ~all (softfail — differs from the rest of the portfolio) | SPF (softfail) | DNS_ONLY | RECREATE_EXACTLY | Yes — confirm softfail is intentional |
| uthinachess.tn | uthinachess.tn | TXT | "1\|www.uthinachess.tn" (OVH internal marker) | Unconfirmed | DNS_ONLY | REVIEW_BEFORE_RECREATE | Yes |
| uthinachess.tn | uthinachess.tn | CAA | (none present) | — | NOT_APPLICABLE | NOT_APPLICABLE | No |
| uthinachess.tn | _dmarc.uthinachess.tn | TXT | absent (NXDOMAIN) | No DMARC policy published | NOT_APPLICABLE | NOT_APPLICABLE | Yes |

## Notes on Long/Sensitive TXT Values

- No TXT value observed in this portfolio was long enough or sensitive enough to require abbreviation with a fingerprint/hash — all TXT values (SPF strings, the recurring OVH `"1|www.<domain>"` marker, and the single unidentified token on `ssangyong.autos`) are short, already public, and reproduced here in full because they contain no secret material. If a future observation of these zones reveals a long TXT value (for example a DKIM public key, a large multi-part verification string, or a bulk-signed token), it must be abbreviated in documentation and a fingerprint/hash stored instead of the full value, per the standing rule for this document.
- The `ssangyong.autos` unidentified token is a 40-character hexadecimal string with the general shape of a domain-verification token used by various third-party platforms. It has been reproduced here in full because it is a public DNS TXT record value (not a secret) and is short enough to require no abbreviation, but its purpose is unconfirmed and it is flagged `REVIEW_BEFORE_RECREATE`.

## Records Explicitly Not Migrated in This Stage

No record in this portfolio has been marked `DO_NOT_MIGRATE`. Every record observed is either a candidate for `DNS_ONLY` recreation (mail/SPF/verification records) or requires explicit confirmation (`REVIEW_BEFORE_RECREATE` / `NEEDS_CONFIRMATION`) before a migration decision is made. `NS` and `SOA` records are `NOT_APPLICABLE` for migration classification — they describe the current zone, not a record to be recreated inside Cloudflare (Cloudflare assigns its own NS pair upon zone creation, and SOA is generated automatically by Cloudflare's authoritative DNS).
