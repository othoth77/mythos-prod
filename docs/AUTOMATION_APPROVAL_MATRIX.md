# Mythos Automation & Operations — Approval Matrix

**Stage:** AUT-0 — Automation-First Master Foundation
**Status:** Governance document only. No automation runs yet.
**Date:** 2026-08-06

---

## 1. Purpose

This document is the permanent reference for which actions always require explicit, non-inferred human approval before execution (`LEVEL_3_APPROVAL_REQUIRED`, see `docs/AUTOMATION_ARCHITECTURE.md` §2), and which routine, low-risk actions are eligible to eventually reach full automation (`LEVEL_4_FULL_AUTOMATIC`).

---

## 2. Permanent LEVEL_3 Boundaries

The following actions **always remain `LEVEL_3_APPROVAL_REQUIRED`**, regardless of how mature the surrounding automation becomes, **unless a future, explicit governance amendment says otherwise** (see `docs/AUTOMATION_GOVERNANCE.md` §5 for the amendment process):

1. Domain nameserver changes
2. DNSSEC or DS-record changes
3. Production DNS record deletion
4. Production database destructive migration
5. Production database deletion
6. Production data overwrite
7. Deletion of backups
8. Disabling backups
9. Secret or credential exposure
10. Privilege escalation
11. Changing Super Admin access
12. Production firewall or network-access changes
13. Sending or transferring money
14. Issuing refunds
15. Contractual acceptance
16. Public publication of sensitive or regulated data
17. Production shutdown
18. Irreversible external-provider actions

These items are drafted in `projects/automation/config/automation.example.json` §`approval_rules.separation_of_duties_required_for`, and every `aut_approval_policies` row governing one of them must have `is_permanent_boundary = TRUE` and `allow_self_approval = FALSE`.

### Direct precedent already in force

Items 1–2 above are not new to this stage — they are the exact concerns already governed operationally in `docs/CLOUDFLARE_DEPLOYMENT_CHECKLIST.md` (DNSSEC sequencing, DS-record coordination) and `docs/CLOUDFLARE_INF_CF2_ENTRY_CRITERIA.md` (nameserver migration approval, per domain). This matrix generalises that existing, working discipline into the platform-wide model rather than inventing a new one.

---

## 3. Routine Examples Eligible for Eventual LEVEL_4

The following are examples of **low-risk, routine** operations that may, after an explicit approved policy exists for each (see `docs/AUTOMATION_ARCHITECTURE.md` §2 `LEVEL_4_FULL_AUTOMATIC` requirements), eventually run without per-run approval:

- Health checks
- Certificate-expiry monitoring
- Read-only inventory
- Backup generation
- Backup integrity checks
- Approved restore tests in isolated (non-production) environments
- Log rotation
- Temporary-file cleanup
- Notifications
- Non-destructive reports
- Staging deployments after tests
- Production deployment — **only** after a separately approved release policy exists; production deployment itself is not blanket-`LEVEL_4`-eligible merely because it appears in this list

**None of the above is `LEVEL_4` today.** This section documents eligibility, not current status. Every connector and feature flag in `projects/automation/config/automation.example.json` is `false`/disabled as of AUT-0.

---

## 4. How to Read This Matrix

- Section 2 is a **floor**, not a ceiling — additional actions may be added to it by any future stage without a governance amendment (adding caution is always permitted; removing it is not).
- Section 3 is a **candidate list**, not a grant — an item appearing there does not mean it is `LEVEL_4` today, or that it will ever become `LEVEL_4` without its own explicit approved policy.
- No workflow definition may claim an automation level inconsistent with this matrix. A `GATE_CHECK` step must reject a mismatch (see `docs/AUTOMATION_ARCHITECTURE.md` §3).

---

## 5. Status

Governance document only. No policy in this matrix has been operationalised — `projects/automation/database/control-plane-schema.sql` is undeployed, and no `aut_approval_policies` row exists in a live database.
