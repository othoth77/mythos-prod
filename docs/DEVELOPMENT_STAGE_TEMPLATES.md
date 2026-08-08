# Mythos — Development Stage Templates (DEVX-0)

**Machine-readable counterpart:** `projects/meta/stage-templates.json`

---

## 1. Purpose

Reduce future prompt size by encoding the recurring entry/closure checklist for each *kind* of stage once, as data — not as repeated prose in every owner instruction.

Templates are lookup tables, not scripts. `scripts/mythos-stage.js` reads the template matching a stage's `type` field (from `projects/meta/project-ledger.json`) to assemble a Stage Context.

## 2. Templates

| Template | Default risk lane | Typical stage examples |
|---|---|---|
| `DOCUMENTATION_STAGE` | FAST | RES-0, most `docs(...)` stages |
| `RUNTIME_STAGE` | STANDARD | Stage 4-series Mythos OS extractions, Stage 3D/3E |
| `INFRASTRUCTURE_STAGE` | HIGH_RISK | INF-CF-* Cloudflare stages |
| `CONNECTOR_STAGE` | STANDARD | INF-OVH-API-0 (read-only external connector) |
| `DATABASE_STAGE` | HIGH_RISK | IDA-2 (PostgreSQL core), any real migration execution |
| `SECURITY_STAGE` | HIGH_RISK | Guard/scope/permission reference fixes, isolation work |
| `RESEARCH_STAGE` | FAST | RES-0 and future documentation-only research stages |

Each template records: `entry_checks`, `risk_lane`, `context_sources`, `skill_categories`, `expected_artifacts`, `test_strategy`, `security_checks`, `documentation_updates`, `closure_checks`. See `projects/meta/stage-templates.json` for the full field content — it is not duplicated here to avoid drift between the human-readable and machine-readable copies.

## 3. Adding a stage type

A genuinely new stage type is added to `projects/meta/stage-templates.json` only when an existing template does not fit — the same "extend before create" discipline `docs/SKILLS_EVOLUTION.md` applies to Agent Development Skills applies here. `node scripts/project-intelligence.js validate` and `tests/devx-0-development-acceleration-test.js` both check that every template has all 9 required fields.
