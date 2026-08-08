---
name: mythos-invoice-intelligence
description: Assist invoice/estimate handling across Mythos products (production app invoices, automotive workshop estimate.prepare / invoice.prepare capability contracts) without conflating financial-mutation actions with read-only drafting.
---

# mythos-invoice-intelligence

## What this skill does

Assists with invoice/estimate-shaped tasks across products, respecting:
- the existing production app's invoice conventions (`js/app.js` invoice functions, subject to the known `stableLineCount` collision documented in `docs/ROADMAP.md`),
- the `automotive_workshop` domain pack's `estimate.prepare`/`invoice.prepare` capability contracts (`docs/MYTHOS_DOMAIN_PACKS.md` §3), which remain `LEVEL_3_APPROVAL_REQUIRED` for any actual financial mutation regardless of how the draft was prepared.

Never treats drafting an estimate as equivalent to committing or sending one.

**Delegates document formatting to `mythos-document-intelligence`.** This skill owns invoice/estimate domain judgement (what belongs on the document, which capability contract applies); it does not own generic document layout/formatting — see `docs/SKILLS_EVOLUTION.md` §6.

## Source

Classification: MYTHOS ORIGINAL — see `docs/SKILLS_SOURCES.md`.
Version: 1.0.1 — see `docs/SKILLS_EVOLUTION.md`.
