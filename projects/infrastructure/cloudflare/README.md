# Mythos OS — Infrastructure / Cloudflare Domain Inventory

**Stage:** INF-CF-1 — Cloudflare Account and Domain Inventory
**Status:** Read-only inventory. No DNS, registrar, or Cloudflare account changes performed.

## Purpose

This directory holds the machine-readable domain inventory produced for INF-CF-1, alongside its human-readable companions in `docs/`:

- `domain-inventory.json` (this directory) — machine-readable inventory of the eight authorised Mythos-portfolio domains.
- `docs/CLOUDFLARE_DOMAIN_INVENTORY.md` — the same inventory in narrative/tabular form, with full per-domain detail, risks, unknowns, and required owner confirmations.
- `docs/CLOUDFLARE_DNS_MIGRATION_MATRIX.md` — a flat, consolidated record-by-record migration-planning matrix across all eight domains.

The eight authorised domains are: `agribee.tn`, `darhijama.tn`, `fixpert.tn`, `idauto.tn`, `mythosprod.xyz`, `notrejour.tn`, `ssangyong.autos`, `uthinachess.tn`.

## Public-Source Limitations

Every record in this inventory was obtained from **public** sources only: public DNS resolution (Cloudflare `1.1.1.1` and DNS-over-HTTPS), public RDAP (`.xyz`, `.autos`) and ATI WHOIS (`.tn`), public TLS certificate inspection, public HTTP/HTTPS status checks, and public certificate-transparency logs (`crt.sh`).

**This is not a complete zone export.** Public DNS queries cannot see:

- internal-only or split-horizon records,
- disabled, parked, or not-yet-propagated records,
- records with any form of access restriction at the provider,
- the complete history of a zone.

Absence of a record from this inventory is not proof that the record does not exist in the authoritative zone. Certificate-transparency coverage in particular was incomplete for six of the eight domains during the observation window (`crt.sh` rate-limited/unavailable) and should be re-run independently before relying on it for subdomain completeness.

## How to Refresh These Observations

Re-run the same read-only discovery methods documented in `docs/CLOUDFLARE_DOMAIN_INVENTORY.md` (RDAP/WHOIS, public DNS resolution, TLS inspection, HTTP status checks, certificate transparency) for the eight authorised domains, and regenerate `domain-inventory.json` and the two companion Markdown documents. Always:

- record a fresh `generated_at_utc` / observation timestamp,
- redact any personal WHOIS/RDAP registrant data before committing,
- respect public-service rate limits (do not burst-query `crt.sh` or any RDAP/WHOIS service),
- never use this refresh process to log in to any registrar, DNS provider, or Cloudflare account,
- never brute-force subdomains or enumerate DKIM selectors,
- treat a refreshed inventory as a new observation, not an edit of history — note what changed since the previous observation in the commit message.

## Prohibitions for This Stage (INF-CF-1)

- Do **not** treat this inventory, or any refreshed version of it, as a complete authoritative zone export. It is a public-source cross-check, not a substitute for a provider control-panel export.
- Do **not** change DNS records, nameservers, or any Cloudflare zone/account setting during this stage or while refreshing this inventory.
- Do **not** log in to any registrar, DNS provider, or Cloudflare account to produce or refresh this inventory — all data collection is public and unauthenticated.
- Do **not** store credentials, API tokens, account IDs, or any secret material in this directory or in the generated inventory files.
- Do **not** store personal WHOIS/RDAP registrant data (name, address, phone, email) in any file in this directory — redact it before committing.

## Prerequisites for INF-CF-2

Before INF-CF-2 (DNS migration and verification) begins:

1. **Export the authoritative zone from the current provider (OVH) for each of the eight domains**, using OVH's own control panel or API, before any nameserver migration. This inventory is a public cross-check to compare against that export — it is explicitly not a substitute for it, since public discovery cannot see the complete private zone.
2. Reconcile every `REVIEW_BEFORE_RECREATE` and `NEEDS_CONFIRMATION` item listed in `docs/CLOUDFLARE_DNS_MIGRATION_MATRIX.md` and `domain-inventory.json` against that authoritative export and against the domain owner's knowledge.
3. Resolve or explicitly accept, per domain, every risk listed in `docs/CLOUDFLARE_DOMAIN_INVENTORY.md` — in particular: the broken web presence on `mythosprod.xyz`, the already-enabled DNSSEC on `mythosprod.xyz` and `ssangyong.autos`, the missing HTTPS listener on `idauto.tn`, and the separate production-migration authorisation required for `uthinachess.tn`.
4. Obtain explicit owner sign-off before including `uthinachess.tn` (the live production domain) in any DNS or nameserver change.

INF-CF-2 does not begin as part of this stage or this task.
