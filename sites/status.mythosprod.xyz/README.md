# status.mythosprod.xyz — MYTHOS Status Center

Status: **BUILT (STC-1, 2026-08-20), NOT DEPLOYED.** The DNS record now
EXISTS (`A 51.68.226.211`, verified live 2026-08-20); until the vhost +
certificate are installed the hostname falls into the VPS default-vhost
fallback and 301-redirects to `https://darhijama.tn/` (root cause:
`docs/audits/STATUS_CENTER_ROUTING_DIAGNOSIS_2026-08-20.md`). Deployment
follows `DEPLOYMENT.md` — strictly additive, no existing vhost touched.

Note: an earlier parallel branch (PR #56, STATUS-RT) shipped a
placeholder "provisioning page" for this hostname; that placeholder is
SUPERSEDED by this full implementation. Its diagnosis and runbook
hardening are merged here.

The single source of truth for the MYTHOS ecosystem: evidence-based
project status, per-track progress, blockers with unblock procedures,
owner actions, ordered next actions, an interactive timeline, a
do-not-reopen register, document reconciliation, and an immutable review
history with comparison.

## Surface classification (recorded tier decision)

This is a **product surface of Mythos OS** (the A-020 pattern —
*products are named, units are endorsed*), ordered by the owner to reuse
the canonical MYTHOS Design System (Master Order §11, 2026-08-20). It is
an operational surface, not a marketing page, so it ships
`robots.txt: Disallow /` and `<meta name="robots" content="noindex">`.
This entry satisfies the §13 rule ("no project is published without a
recorded tier").

## One-command deployment

For the KVM console (no long pastes), the entire runbook is automated
in one audited, idempotent script — run as root from the repository
checkout on the VPS:

```bash
sudo bash scripts/deploy-status-center.sh
```

It performs the full `DEPLOYMENT.md` sequence: preflight (DNS, clean
main checkout, expected files, no foreign vhost claim), content sync,
the additive nginx vhost (never touching dar-hijama-app or any other
site; certbot-managed files are never clobbered), `nginx -t` before any
reload, certbot (skipped if the certificate exists), the acceptance
smoke tests (200, no darhijama.tn in the chain, `/health`, robots,
data, fonts) and the regression checks (darhijama.tn, uthinachess.tn,
panel). It exits non-zero and says so plainly if ANY check fails —
"live" is only claimable when it prints `ALL CHECKS PASSED`.
Rollback: `sudo bash scripts/deploy-status-center.sh --rollback`.

## Architecture

- **Data model** — the page renders `data/current.json`, the latest
  immutable review snapshot. Nothing is hard-coded into the HTML.
- **Review engine** — `projects/status-center/` (repo root). A review is
  produced by `node projects/status-center/bin/review.js`, which
  reconciles read-only git facts, the curated evidence registry
  (`projects/status-center/data/registry.json`), the PR ledger and the
  repository snapshot, then writes:
  - `reviews/YYYY/YYYY-MM-DD-review-NNN.json` — immutable, never
    overwritten (the engine refuses);
  - `data/current.json`, `data/reviews-index.json`, `health.json`.
- **[REVIEW NOW]** in the UI re-fetches the latest published snapshot
  and shows the exact engine command. The browser is READ-ONLY by
  design: it can never execute repository, GitHub, deployment or VPS
  commands (Master Order §35).
- **Security** — all rendering is `textContent`/`createElement` (no
  `innerHTML`, no `eval`, no external requests). Verified by
  `tests/stc-1-status-center-test.js` §12 and a headless-browser check.
- **/health** — served from `health.json` via an exact-match nginx
  location (see `DEPLOYMENT.md`); explicit field allowlist, no secrets
  (the MOS-v2 M-07 pattern).

## Assets

`assets/tokens.css`, `assets/fonts.css`, `assets/fonts/*` and the brand
images are build-time copies of `assets/brand/*` and of
`sites/mythosprod.xyz/assets/*` (AUTO-1 masters, AUTO-3 tokens, AUTO-4
fonts). If the canonical sources change, re-copy — this directory is
what production serves, so it must be self-contained.
`assets/app.css` / `assets/app.js` are this surface's own code and
compose only from the token sheets. One 35° gesture per view (A-012):
the header carries it.

## Updating the Status Center

1. Update `projects/status-center/data/registry.json` with the new
   evidence (stage results, blockers, milestones). Refresh
   `pr-ledger.json` / `repo-snapshot.json` when GitHub access exists.
2. Run `node projects/status-center/bin/review.js`.
3. Run `node tests/stc-1-status-center-test.js`.
4. Commit (the new snapshot under `reviews/` is part of the commit) and
   deploy per `DEPLOYMENT.md` step 1.

Never edit or delete a historical snapshot under `reviews/` — the
engine refuses to overwrite them and the history is the point.
