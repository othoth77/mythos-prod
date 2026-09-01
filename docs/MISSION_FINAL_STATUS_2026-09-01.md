# MYTHOS final completion mission — status 2026-09-01

This branch carries the work that governance permits delivering today. The full
narrative lives in `docs/AI_HANDOVER.md` on `main`, which is **committed but
undeliverable** until one owner-only approval exists (below).

## Delivered here

| Commit | What |
|---|---|
| `security:` | Coolify's public plaintext exposure closed via `DOCKER-USER`, persisted by a systemd unit; plus the security baseline report |
| `fix(erp):` | `GRANT DELETE ON invoice_lines` documented in `schema.sql` — without it the ERP cannot create an invoice at all |
| `fix(backup):` | the `mythos_erp` database-only backup pipeline made runnable; it had never taken a dump |

## Already on `origin/main`

`f4d5eb9` — the ERP divergence reconciliation. `main` had diverged 14/4 from
`origin/main`, which made the governance relay refuse **every** push as a
non-fast-forward. Merging forward preserved the approved new ERP engine
(`419b2dd`) and unblocked delivery.

## Held on local `main`, pending approval

- `19252ac` — MCP / Knowledge / Extraction merged into `main`
- `bddb5c0`, `f191de8` — handover Stages B and C

## The one blocker

`main` holds `f5e503a` ("record the $0.10 extraction grant"), which touches the
protected path `projects/mythos-ai-executor/config/budgets.json` with no valid
approval. The root-owned verifier refuses to deliver `main` until that exists,
and the approval tool refuses any automated decider by construction:

```
--by must name a HUMAN. An automated identity cannot approve a governance change.
```

Its header states *"A COMMIT MESSAGE IS NOT AN APPROVAL"* and *"CHAT IS NOT AN
APPROVAL"*. Forging a human name was not done.

**Owner action:**

```
sudo mythos-governance-approve --commit f5e503adeb4b \
  --by "<your name>" \
  --reason "Confirm the $0.10 oth-extraction budget grant for the DeepSeek V4 Pro extraction runs"

sudo systemctl start mythos-git-push.service
```

That single approval delivers `main` **and** unblocks the four remaining
extractions, which are otherwise fully prepared and validated.

## Spend

**No paid API call was made in this mission. $0.00.** The four remaining
extractions were deliberately not run, and `--dry-run` was not used on them
because the selector call precedes the dry-run branch and would have been a real
paid call.
