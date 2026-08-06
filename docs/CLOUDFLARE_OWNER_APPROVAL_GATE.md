# Mythos OS — Cloudflare Owner Approval Gate

- **Stage:** INF-CF-2-PREP — Authoritative DNS Export Intake and Owner Approval Gate
- **Purpose:** Record, per domain, the owner's explicit approval status for each category of change INF-CF-2 and later stages would perform. This gate exists so that no domain is ever migrated, proxied, tunnelled, or DNSSEC-modified on the basis of inference from public data or from this repository's own risk analysis — only on the basis of an explicit, recorded owner decision.
- **Status:** All eight domains start `NOT_REQUESTED`. No domain may be marked `APPROVED_FOR_PREPARATION` or `APPROVED_FOR_MIGRATION` based on inference — only on a recorded decision from the actual domain owner.

## Allowed Approval Values

- `NOT_REQUESTED` — no approval has been asked for yet. This is the starting value for every domain and every approval field.
- `PENDING` — approval has been requested from the owner and is awaiting a decision.
- `APPROVED_FOR_PREPARATION` — the owner has approved collecting exports and preparing a migration plan for this domain, but has **not** approved executing any change yet.
- `APPROVED_FOR_MIGRATION` — the owner has explicitly approved executing the specific change (nameserver migration, DNSSEC operation, Cloudflare proxy, Tunnel, or Access, as applicable) for this domain.
- `REJECTED` — the owner has explicitly declined this change for this domain. Do not proceed, and do not re-request without a new, separate reason.
- `DEFERRED` — the owner has chosen to postpone a decision to a later, unspecified time. Treat identically to `NOT_REQUESTED` for the purpose of blocking any action, but retain the distinction for planning visibility.

No value other than these six may be used in this document or in `projects/infrastructure/cloudflare/zone-review-template.json`.

## Approval Gate Fields (per domain)

- **Domain**
- **Project**
- **Business owner** — who has final authority to accept business risk (email downtime, brand/customer impact) for this domain.
- **Technical owner** — who has final authority over the technical execution (DNS records, TLS, origin configuration).
- **Email active** — `yes` / `no` / `unknown`, pending confirmation via the intake in `docs/CLOUDFLARE_AUTHORITATIVE_EXPORT_INTAKE.md`.
- **Production criticality** — a short description of what breaks, and for whom, if this domain is unreachable.
- **Acceptable downtime** — the owner's stated tolerance, in explicit units (minutes/hours), not assumed.
- **Maintenance window** — the specific window, if any, the owner has approved for change execution on this domain.
- **Rollback decision authority** — who is authorised to invoke rollback if something goes wrong during a change to this domain.
- **DNSSEC approval** — approval value (see above) specifically for any DNSSEC-related operation on this domain.
- **Nameserver migration approval** — approval value specifically for changing this domain's nameservers.
- **Cloudflare proxy approval** — approval value specifically for enabling Cloudflare proxying (orange-cloud) on this domain's records.
- **Tunnel approval** — approval value specifically for routing this domain's traffic through a Cloudflare Tunnel.
- **Access approval** — approval value specifically for placing this domain (or a hostname under it) behind Cloudflare Access.
- **Owner signature/status** — free-text record of who signed off and how (e.g. "approved in writing by [role], see [reference]" — do not put personal contact details here; reference an out-of-repository record instead).
- **Approval timestamp (UTC)** — when the recorded approval (if any) was given.
- **Notes** — anything else relevant to this domain's approval state.

## Approval Table — All Eight Domains (Initial State)

| Domain | Project | Business owner | Technical owner | Email active | Production criticality | Acceptable downtime | Maintenance window | Rollback decision authority | DNSSEC approval | Nameserver migration approval | Cloudflare proxy approval | Tunnel approval | Access approval | Owner signature/status | Approval timestamp (UTC) | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| agribee.tn | AgriBee | UNKNOWN | UNKNOWN | unknown | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | NOT_REQUESTED | NOT_REQUESTED | NOT_REQUESTED | NOT_REQUESTED | NOT_REQUESTED | NOT_REQUESTED | — | Awaiting intake per `docs/CLOUDFLARE_AUTHORITATIVE_EXPORT_INTAKE.md` |
| darhijama.tn | Dar Hijama | UNKNOWN | UNKNOWN | unknown | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | NOT_REQUESTED | NOT_REQUESTED | NOT_REQUESTED | NOT_REQUESTED | NOT_REQUESTED | NOT_REQUESTED | — | Also confirm default-vhost role (INF-CF-1 finding) before approval is sought |
| fixpert.tn | Fixpert | UNKNOWN | UNKNOWN | unknown | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | NOT_REQUESTED | NOT_REQUESTED | NOT_REQUESTED | NOT_REQUESTED | NOT_REQUESTED | NOT_REQUESTED | — | Confirm operational authority given external-system boundary (Fixpert/Atelier Network) before naming a technical owner |
| idauto.tn | ID Auto | UNKNOWN | UNKNOWN | unknown | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | NOT_REQUESTED | NOT_REQUESTED | NOT_REQUESTED | NOT_REQUESTED | NOT_REQUESTED | NOT_REQUESTED | — | No working HTTPS origin (INF-CF-1) — Cloudflare proxy approval must not be sought until an HTTPS plan exists |
| mythosprod.xyz | Mythos OS / shared infrastructure | UNKNOWN | UNKNOWN | unknown | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | NOT_REQUESTED | NOT_REQUESTED | NOT_REQUESTED | NOT_REQUESTED | NOT_REQUESTED | NOT_REQUESTED | — | DNSSEC already enabled; broken redirect/HTTPS must be investigated before any approval is requested |
| notrejour.tn | Notre Jour | UNKNOWN | UNKNOWN | unknown | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | NOT_REQUESTED | NOT_REQUESTED | NOT_REQUESTED | NOT_REQUESTED | NOT_REQUESTED | NOT_REQUESTED | — | Only domain with public AAAA — keep A/AAAA approvals linked |
| ssangyong.autos | SsangYong Parts | UNKNOWN | UNKNOWN | unknown | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | NOT_REQUESTED | NOT_REQUESTED | NOT_REQUESTED | NOT_REQUESTED | NOT_REQUESTED | NOT_REQUESTED | — | DNSSEC already enabled — mandatory coordination; unidentified TXT token purpose must be confirmed first |
| uthinachess.tn | Uthina Chess | UNKNOWN | UNKNOWN | unknown | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | NOT_REQUESTED | NOT_REQUESTED | NOT_REQUESTED | NOT_REQUESTED | NOT_REQUESTED | NOT_REQUESTED | — | **Live production domain.** Requires a separate, explicit authorisation and a dedicated maintenance window beyond the standard process used for the other seven domains |

Every `UNKNOWN` and every `NOT_REQUESTED` value above is a starting placeholder. None of them may be changed based on inference, assumption, or convenience — only on an actual, recorded decision or a confirmed fact obtained through the intake procedure in `docs/CLOUDFLARE_AUTHORITATIVE_EXPORT_INTAKE.md`.

## How This Gate Is Used

1. A domain's approval fields remain `NOT_REQUESTED` until the corresponding intake checklist in `docs/CLOUDFLARE_AUTHORITATIVE_EXPORT_INTAKE.md` has produced enough sanitized, reviewed evidence to ask the owner a specific, informed question (e.g. "Do you approve enabling Cloudflare proxy for `www.notrejour.tn` once its origin export has been reviewed?").
2. Each approval field is independent — a domain can be `APPROVED_FOR_PREPARATION` while every specific action approval (DNSSEC, nameserver, proxy, Tunnel, Access) remains `NOT_REQUESTED` or `PENDING`.
3. `APPROVED_FOR_MIGRATION` for the nameserver migration approval field is the specific signal `docs/CLOUDFLARE_INF_CF2_ENTRY_CRITERIA.md` requires before INF-CF-2 may begin for that domain.
4. Approval is granted per domain and per action. Granting one domain's nameserver migration approval does not imply anything about any other domain, and granting proxy approval does not imply DNSSEC, Tunnel, or Access approval.
5. This document itself does not perform or authorise any action — it only records status. Updating a value in this table from `NOT_REQUESTED` to anything else requires a real, external decision by the named owner; it is not a task an automated stage may perform on its own judgement.
