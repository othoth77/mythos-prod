# Mythos OS — Authoritative Exports (Local Intake Only)

**This directory is a local intake location. It is not a repository archive.**

## What This Directory Is For

This is where raw registrar and DNS-provider control-panel exports are placed **temporarily and locally** while preparing for INF-CF-2, per the procedure in `docs/CLOUDFLARE_AUTHORITATIVE_EXPORT_INTAKE.md`. Every file placed here except `README.md` and `.gitignore` is ignored by Git — see this directory's `.gitignore`.

## Rules

- **Raw provider exports must not be committed.** Zone files, CSV exports, JSON exports, and control-panel screenshots stay on the local machine that collected them. The `.gitignore` in this directory enforces this by default (deny-all except `.gitignore` and `README.md`), but do not rely on `.gitignore` alone — never run `git add -f` on anything in this directory.
- **Exports may contain verification values or infrastructure identifiers** (TXT verification tokens, internal hostnames, IP addresses, DS-record values, SOA contact addresses) that, while not necessarily secret in isolation, are not appropriate for a public or semi-public repository history without review.
- **Raw files require sanitization before any repository snapshot.** If a summary of an export needs to be committed, it must first be reduced to only what's needed for migration planning, with every value reviewed.
- **Personal registrar information must be removed** before anything derived from an export is committed — registrant names, addresses, phone numbers, personal email addresses, and any other WHOIS/RDAP-style personal data.
- **Secrets must be rotated if accidentally exposed.** If a credential, API key, or token ever ends up in a file in this directory (it should not, per the intake document — passwords, customer numbers, API keys, recovery codes, and payment information are explicitly out of scope for collection), rotate it at the source immediately. Deleting the local file is not sufficient once a secret has been generated or exposed.
- **Sanitized migration snapshots require separate review and approval** before they are added anywhere in this repository. Nothing in this directory is pre-approved for that purpose merely by existing here.
- **INF-CF-2 must not start from public DNS observations alone.** The whole purpose of this directory's contents is to close the gap between the public INF-CF-1 inventory (`docs/CLOUDFLARE_DOMAIN_INVENTORY.md`) and the actual authoritative provider configuration — see `docs/CLOUDFLARE_AUTHORITATIVE_EXPORT_INTAKE.md` for the full procedure and `docs/CLOUDFLARE_INF_CF2_ENTRY_CRITERIA.md` for what must be true before INF-CF-2 itself may begin.

## What Is Tracked in Git From This Directory

Only:

- `README.md` (this file)
- `.gitignore`

Everything else placed in this directory is local-only and excluded from version control by the accompanying `.gitignore`.
