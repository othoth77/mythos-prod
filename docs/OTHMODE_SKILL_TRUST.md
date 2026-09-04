# OTHMODE — Skill & MCP Security / Trust Gate (SKILL-TRUST-0)

**Stage:** SKILL-TRUST-0 · **Date:** 2026-09-04 · **Branch:** `mythos/skill-trust-gate-20260904`
**Principle:** SEARCH → REUSE → ADAPT → TEST → BUILD ONLY WHAT IS MISSING.

```text
No scan          ≠ safe
Scanner failure  ≠ safe
Unknown          → REVIEW
DO_NOT_INSTALL   → BLOCK
```

**بالعربية باختصار:** لا تصل أي Skill إلى التنفيذ قبل أن تفحصها الأدوات الجاهزة (SkillSpector، Gitleaks، SkillEvaluator) وتقول سياسة OTHMODE ACCEPT. النتيجة تُربط بمحتوى الـ Skill عبر sha256: أي تغيير يُبطلها ويستوجب إعادة الفحص. الفشل في الفحص = منع، والنتيجة غير المفهومة = مراجعة.

---

## 1. Where the gate sits (found by search, not assumed)

OTHMODE runs inside `projects/command-center` (the same Node process on 127.0.0.1:3021 serves `ordre` and `othmode`). Its skills layer is a **read model with zero writers** (`reference/othmode/registries.js`) over two authoritative, Git-reviewed registries:

| Registry | Source | Consumer | Where the gate acts |
|---|---|---|---|
| `claude` | `.claude/skills/<id>/` (26 dev skills) | Claude Code sessions (read the directory) | trust status shown per skill; `verify` fails on BLOCK |
| `executor` | `projects/mythos-ai-executor/config/skills.json` + `skills/*.md` (5 runtime skills) | `executor.js createTask/buildPrompt` via `lib/skills.js` | **enforced**: a skill without a content-bound ACCEPT attestation is never selected or rendered |

There is no runtime installer: a skill arrives as a reviewed Git diff. The lifecycle therefore is

```text
DISCOVER   registries (existing)          FETCH      Git diff (existing)
NORMALIZE  subjects.js — target + sha256   SCAN       SkillSpector · Gitleaks · SkillEvaluator Tier 1
EVALUATE   normalize.js — one shape        POLICY     policy.js — ACCEPT / REVIEW / BLOCK
ATTEST     ledger (Git) + store history    REGISTRY   read model shows trust; executor verifies
EXECUTION  lib/skills.js — trusted only
```

MCP is a **separate layer** over the estate's own measurement (`projects/mythos-gateway/bin/mcp-registry-check` snapshot + permission matrix), sharing only the policy engine and the decision vocabulary (§6).

## 2. Search First — what was evaluated (live-verified 2026-09-04)

| Project | Verified state | Provides | Decision | Why |
|---|---|---|---|---|
| **NVIDIA/SkillSpector v2.11.0** | Apache-2.0 · 16k★ · pushed 2026-09-01 · Python 3.12–3.14 · not on PyPI (`uv tool install git+…@v2.11.0`) | static scan of a skill dir / `.md` / zip / Git URL: prompt injection, anti-refusal, exfiltration, privilege escalation, MCP tool-poisoning patterns, YARA, OSV lookups; JSON/SARIF; `risk_assessment{score,severity,recommendation}`; exit 0/1/2; baseline suppression; MCP server | **REUSED** (primary security scanner, `--no-llm`) | exactly the scanner the mandate names; stable machine contract; no key needed for static mode |
| **NVIDIA/SkillEvaluator 0.2.1** | Apache-2.0 · pushed 2026-09-03 · Python 3.12–3.13 (uv provisions 3.13) · `[security]` extra = Bandit + pip-audit | Tier 1 keyless gates: schema, PII, license, unicode smuggling, quality, script lint; `security` (wraps SkillSpector), `code-integrity` (Semgrep + Bandit + **Gitleaks**); JSON report with `overall_status`, `incomplete_scans`, per-validator findings | **REUSED — Tier 1 only** (`--checks schema,pii,license,unicode,quality,lint`) | the Quality Gate the mandate lists, off the shelf. Tier 2 needs an embeddings provider; Tier 3 needs agent credentials + Docker/sandbox → deferred |
| **Gitleaks 8.30.1** | MIT · Go binary 8 MB · sha256-verified from GitHub Releases | `gitleaks dir <path> --report-format json` (array of findings, `Fingerprint`, `RuleID`) · exit 0 clean / `--exit-code 9` leaks | **REUSED** (direct; also what SkillEvaluator's secrets check runs) | the secret scanner; run directly so the secrets verdict never depends on Semgrep being present |
| **Semgrep 1.176.0** | LGPL-2.1 · 70 MB wheel · several hundred MB RSS at run time | code SAST inside SkillEvaluator's `code-integrity` | **DEFERRED on this host** | VPS measured ~1 GB free with swap 4095/4095 full; SkillEvaluator marks the whole `code-integrity` check INCOMPLETE without it. Turn on by installing `uv tool install semgrep` and adding `code-integrity` to `skillevaluator.checks` — no code change |
| **rhilgenkamp/mcp-scan** | 0★ · last push 2026-02-05 · a fork of Invariant's mcp-scan | — | **REJECTED** | stale fork; upstream moved |
| **snyk/agent-scan** (was invariantlabs-ai/mcp-scan; PyPI `mcp-scan` now redirects to `snyk-agent-scan` 0.6.2) | Apache-2.0 · 3k★ · active | MCP server + skill scanning, tool poisoning, toxic flows, proxy | **REJECTED for now** | README §"how it works": sends tool names/descriptions and **skill content to the Snyk analysis API**, requires `SNYK_TOKEN` + account. Violates the no-egress rule of this gate |
| **npm `mcp-scan` 2.0.10** (Abanoub-Rodolf) | MIT · active · `--offline` mode | scans AI-client MCP config files (17 clients) for secrets, prompt injection in tool metadata, supply chain, typosquatting | **DEFERRED** | our MCP surface is an estate registry + live handshake snapshot, not a client config; the gap it would close (prompt injection *inside tool descriptions*) is recorded as the next phase (§9) |
| **RudrenduPaul/skillguard 0.2.4** | Apache-2.0 · 1★ · single maintainer · Node + Python ports · `scan-set` cross-skill privilege chaining | SG01–SG10 rule packs, JSON/SARIF, MCP tool | **EVALUATED — DEFERRED** | immature; SkillSpector covers the single-skill surface. Revisit if cross-skill chaining becomes a requirement |

Registry records: `projects/command-center/data/open-source-registry.json` (served at `/api/othmode/oss-registry`).

## 3. What was built (adapter only)

| File | Role | Lines |
|---|---|---|
| `projects/mythos-ai-executor/lib/skill-trust.js` | **verifier**: canonical hashing (dir / registry-entry+body), ledger schema, `verify()` — no policy, no scanner, no network | ~190 |
| `projects/mythos-ai-executor/lib/skills.js` (edit) | the **gate**: `usable = enabled ∧ trusted`; `getSkill`/`selectSkill`/`renderSkillSection` refuse untrusted skills; `trust` in `listForApi`; bypass only via `MYTHOS_SKILL_TRUST=off` (logged) | +70 |
| `reference/othmode/trust/normalize.js` | scanner JSON → one internal shape; drops `Secret`/`Match`/`line_content` | ~200 |
| `reference/othmode/trust/policy.js` | deterministic decision engine + policy validator with hard invariants | ~230 |
| `reference/othmode/trust/subjects.js` | resolves a skill to (target, content sha256, version) | ~110 |
| `reference/othmode/trust/ledger.js` | Git ledgers, atomic write, MCC secret gate on every write | ~90 |
| `reference/othmode/trust/mcp.js`, `index.js` | MCP layer over the registry-check snapshot; trust read model | ~120 |
| `reference/othmode/registries.js`, `routes.js`, `store.js` (edits) | trust rows on skills/MCP; `GET /api/othmode/trust`; `trust` history stream | +60 |
| `projects/command-center/cli/lib/skill-trust-scan.js` | the **only** process that spawns a scanner (minimal env, timeouts, `--no-llm`) — outside `reference/othmode/` because that directory is exec-free by test | ~230 |
| `projects/command-center/cli/skill-trust-cli.js` | `scan · rescan · status · verify · mcp · policy · tools` | ~150 |
| `data/skill-trust-policy.json`, `data/skillspector-baseline.json` | the configurable policy; the Git-reviewed triage of accepted findings | data |
| `tests/skill-trust-test.js` | 130 checks, offline, fake scanners + optional real-scanner section | ~400 |

Nothing custom was written for prompt-injection detection, secret detection, static analysis, MCP poisoning, SARIF, or evaluation.

## 4. Normalised result and decision

Every scanner result becomes:

```json
{ "scanner": "skillspector", "version": "2.11.0", "status": "ok | failed | unknown",
  "summary": { "risk_score": 0, "severity": "LOW", "recommendation": "SAFE", "max_issue_severity": "NONE", "completeness": "complete", "partial_reasons": [] },
  "findings": [ { "id": "P1", "category": "Prompt Injection", "severity": "HIGH", "file": "SKILL.md", "line": 3 } ] }
```

`policy.js` folds the results with **most-restrictive-wins**:

| Evidence | Decision (default policy) |
|---|---|
| required scanner missing / crashed / timed out / exit-error | **BLOCK** (`scanner_failure`; may be REVIEW, never ACCEPT) |
| report unparseable or off-contract | **REVIEW** (`unknown_result`; never ACCEPT) |
| SkillSpector `DO_NOT_INSTALL` | **BLOCK** (invariant, not configurable) |
| SkillSpector `CAUTION` with issues, or any MEDIUM/LOW issue | REVIEW |
| SkillSpector `CAUTION`, score 0, no issues, analysis partial **only** for `reference_unresolved`, no uninspected file | ACCEPT (`clean_caution_is_accept`) — SkillSpector reports CAUTION whenever prose mentions a local path it cannot resolve |
| any Gitleaks finding | **BLOCK** |
| SkillEvaluator PII / UNICODE / SECURITY critical-high | **BLOCK**; medium-low → REVIEW |
| SkillEvaluator `incomplete_scans` (e.g. Semgrep absent when `code-integrity` is requested) | REVIEW |
| SCHEMA / LICENSE / QUALITY / SCRIPT_LINT | advisory (recorded; SCHEMA/LICENSE critical → REVIEW). MYTHOS ORIGINAL skills carry no `metadata.author`, which the external profile rates HIGH — a publication convention, not a security signal |
| a finding category the policy never named | REVIEW |

REVIEW → ACCEPT for a SkillSpector finding has exactly one path: SkillSpector's own **baseline** (`data/skillspector-baseline.json`, generated by `skillspector baseline <target> --no-llm --reason …`), a Git-reviewed diff whose fingerprint stops matching when the flagged line changes. Four entries exist today, each a false positive whose cited line says the *opposite* of what the rule matched (e.g. `generic.md`: "Never claim Git completion **without checking** the remote head"). They are marked *pending owner review*.

## 5. Attestation ledgers and rescan

Two Git-tracked files, one schema (`lib/skill-trust.js` validates it):

```text
projects/command-center/data/skill-trust.json            claude registry
projects/mythos-ai-executor/config/skill-trust.json      executor registry (the executor's own trust boundary)
```

Each entry: `registry · source_path · version · content_sha256 · decision · reasons · scanned_at · scanned_by · policy_version · scanners{name:{version,status,summary}} · findings[≤50, locations only]`.

**Rescan is arithmetic, not a scheduler.** The executor recomputes the sha256 of the registry entry + instruction bytes at load and compares it with the ledger: a new version, a new source, an edited file, a widened `allowed_mcp_servers` — anything — yields STALE and the skill drops out of the executable set until `skill-trust-cli.js rescan` (or `scan`) re-attests. A scanner upgrade is visible in `status` (recorded versions) and re-attested with `scan --all`; a policy change bumps `policy_version` and is recorded on every new entry. Every scan is also appended to the OTHMODE store stream `trust/records.jsonl` (outside Git, append-only) — the history behind the current decision.

Trust states as reported (`status`, API, executor log): `ACCEPT · REVIEW · BLOCK · UNATTESTED · STALE · LEDGER_INVALID · UNHASHABLE · BYPASS` (test-only).

## 6. MCP layer

`reference/othmode/trust/mcp.js` reads one server's registry entry and its `mcp-registry-check` measurement (`status`, `drift`, `policy_findings`, `credential_findings`, `checked_at`) and applies `policy.mcp`:

| Measurement | Decision |
|---|---|
| ONLINE, no drift, no findings, snapshot < 48 h | ACCEPT |
| DEGRADED / OFFLINE / UNAUTHORIZED / ERROR / unknown status | REVIEW |
| no measurement, or snapshot older than 48 h, or server disabled | REVIEW |
| permission-matrix finding, undeclared tool exposed (drift `extra` — the tool-poisoning shape a registry can see), declared tool missing | REVIEW |
| credential finding | **BLOCK** |

Surfaced per server in `GET /api/othmode/mcp` (`trust`) and `GET /api/othmode/trust`; `skill-trust-cli.js mcp`. Live on this host today: 4 ACCEPT, 2 REVIEW (both disabled servers).

## 7. Operations

```bash
# once per host (deploy user; isolated tool environments, ~350 MB)
curl -LsSf https://astral.sh/uv/install.sh | sh
uv tool install --python 3.14 'skillspector @ git+https://github.com/NVIDIA/SkillSpector.git@v2.11.0'
uv tool install --python 3.13 'skillevaluator[security] @ git+https://github.com/NVIDIA/SkillEvaluator.git'
# gitleaks: release tarball + checksum → ~/.local/bin/gitleaks (see ops note in AI_HANDOVER)

cd /home/deploy/projects/mythos-prod
node projects/command-center/cli/skill-trust-cli.js tools     # which binaries resolve
node projects/command-center/cli/skill-trust-cli.js status    # trust row per skill
node projects/command-center/cli/skill-trust-cli.js scan claude:<id> | executor:<id> | --all [--dry-run]
node projects/command-center/cli/skill-trust-cli.js rescan    # STALE / UNATTESTED only
node projects/command-center/cli/skill-trust-cli.js verify    # CI gate: exit 1 on BLOCK or an enabled-but-untrusted executor skill
node projects/command-center/cli/skill-trust-cli.js mcp
```

Scanners receive a minimal environment (`PATH, HOME, LANG, TMPDIR`) — never the operator's tokens; SkillSpector runs `--no-llm` (nothing leaves the host; no provider key). A full scan of 31 skills takes ~5 min on the VPS; run it under `systemd-run -p MemoryMax=…` while the host's swap remains exhausted. The executor reads the ledger at start-up: after an attestation lands on `main`, restart `mythos-ai-executor` for it to take effect (the same trust boundary as `skills.json` itself).

CI: `node tests/skill-trust-test.js` is offline; `skill-trust-cli.js verify` is the merge gate. `.github/workflows/` is governance-protected, so wiring it into `vps-final-gate.yml` is an owner step (§9).

## 8. Tests — `tests/skill-trust-test.js` (130/0)

policy validation and invariants · adapters (no content copied) · the full decision matrix · content hashing (edit, add, symlink target, registry version bump, MCP widening) · verify semantics (ACCEPT/STALE/REVIEW/BLOCK/UNATTESTED/UNHASHABLE/LEDGER_INVALID) · the pipeline with fake scanners: **safe → ACCEPT · malicious → BLOCK · leaked token → BLOCK with no value persisted · CAUTION → REVIEW · garbage output → REVIEW · exit 2 → BLOCK · timeout → BLOCK (bounded) · missing binary → BLOCK · PII → BLOCK · Unicode smuggling → BLOCK · incomplete evidence → REVIEW · dry run writes nothing** · ledger secret gate + invalid-file protection · the executor gate end to end (no ledger → nothing selectable; ACCEPT → selectable; edit → STALE → generic fallback with reason; rescan restores; version bump → STALE; explicit BYPASS) · read model + `GET /api/othmode/trust` + "no HTTP write path" · MCP matrix incl. undeclared-tool (poisoning shape), credential → BLOCK, stale snapshot, no policy → BLOCK · **real scanners** (when installed): clean → ACCEPT, prompt-injection+exfiltration → `DO_NOT_INSTALL` → BLOCK, GitHub PAT → `github-pat` → BLOCK, token absent from the attestation.

Regression on this tree: `othmode-2` 147/0, `othmode-3` 94/0, `mcp-ecosystem` 168/0, `mythos-ai-executor` (gate bypassed for its fixture registries) — see AI_HANDOVER for counts.

## 9. Next phase (not built, by design)

1. **Owner review of `data/skillspector-baseline.json`** (4 entries) and of the two ledgers — they are the security decision, delivered as a diff.
2. **CI wiring**: `verify` + the offline suite in `.github/workflows/vps-final-gate.yml` (protected path → owner approval).
3. **Semgrep** when the host has memory headroom: install, add `code-integrity` to `skillevaluator.checks`.
4. **MCP tool-description scanning**: the registry check records tool *names*; prompt injection inside tool *descriptions* needs the descriptions in the snapshot and a scanner over them (SkillSpector TP1–TP3 operate on manifests; npm `mcp-scan` on client configs). Design first; no data egress.
5. **SkillEvaluator Tier 2/3** only if a provider/sandbox budget is approved.
6. **Executor restart** after the ledgers reach `main` (per-SHA approval per the autopilot rules).
