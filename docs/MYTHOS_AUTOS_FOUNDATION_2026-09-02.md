# MYTHOS AUTOS — FOUNDATION PACKAGE (Phase 0 / Phase 1)

**Mission:** OTHMODE — MYTHOS AUTOMOTIVE ECOSYSTEM — FOUNDATION PHASE (read / audit / reconcile / architecture lock)
**Date:** 2026-09-02 (audit window 06:57–08:00 UTC)
**Host:** `vps-4722f0a9.vps.ovh.net` (51.68.226.211) — the MYTHOS VPS itself; every observation below was taken on the host, read-only unless stated in §A.
**Author identity:** Othman Haddad (repo identity, relay-pinned). Prepared by Claude Fable 5.1 under OTHMODE.

Evidence classes used throughout: **CONFIRMED** (observed on host or in Git), **INFERRED** (derived from confirmed facts), **UNKNOWN** (not verifiable from this host), **REQUIRES DECISION** (owner call).

Nothing in this package is product code. No production data, no SPY code, no n8n workflow, no database and no service configuration was modified. The only mutations of the mission are listed exhaustively in §A.6.

---

## A. Git Reconciliation Report

### A.1 Preflight (CONFIRMED)
| Check | Result |
|---|---|
| Concurrent agents | No other CCD session running (`list_sessions`: all `isRunning:false`). Two extra `ccd-cli --resume` processes existed but were idle resumes. No SSH `Accepted` in the last 30 min. No `git push/merge/rebase` process. |
| Who was pushing at 06:49 / 06:55 / 07:00 / 07:05 UTC | `mythos-git-push.timer` — the root-installed delivery relay (`/etc/systemd/system/mythos-git-push.service`, every 5 min + 30 s jitter, runs as `deploy` with `SupplementaryGroups=mythos-gov`). It is the process that fetches origin (explains `FETCH_HEAD` at 06:55) and is DENIED every run. Not an agent. |
| Remote | `origin = git@github.com:othoth77/mythos-prod.git`; `git ls-remote origin main` = `f4d5eb94…` = local `origin/main`. **No unexpected divergence.** |
| Hooks | `core.hooksPath` unset; no non-sample hooks in `.git/hooks`. The relay runs with `core.hooksPath=/var/empty`. |
| Worktrees | 13 pre-existing (`/home/deploy/oth-mcp`, `/home/deploy/worktrees/{backup-multi-db, erp-modernization (detached), erp-redesign, hub-dashboard (detached), mcp-ecosystem, mission-sec, mythos-gateway, mythos-vault, pr-backup-tests, pr-erp, pr-monitoring}`) — all left untouched. |
| Stash | `stash@{0}: On main: VPS-local-work-before-M12-sync-2026-08-19` (roadmap-state.json +166/−…, identity-contract.js) — **KEEP, not applied, not dropped.** |

### A.2 Baseline vs brief (CONFIRMED)
| Item | Brief said | Found |
|---|---|---|
| local main ahead of origin/main | ~32 | **32** (b7ea66a vs f4d5eb9), 0 behind |
| uncommitted files | 2 | **3**: `ops/backup/mythos-backup-capture.sh`, `projects/status-center/monitor/probes.json`, `sites/mythosprod.xyz/assets/dashboard.css` |
| SPY | in sync, clean | **CONFIRMED**: `master` = `origin/master` = 41b3e04, 0/0, clean tree. One nested worktree `.claude/worktrees/intelligent-vaughan-144202` on `claude/intelligent-vaughan-144202` at de7e8c0 — that commit is already in master (merged). |

### A.3 The decisive finding — nothing is lost on GitHub (CONFIRMED)
Every one of the 32 local-only commits is **already on origin** under the mission branch `origin/mythos/vault-architecture-20260901` (all 32), and the older ones additionally under `origin/vps/oth-mcp-20260830`, `origin/vps/extraction-mvp-20260830`, `origin/vps/mcp-deployment-20260830`, `origin/vps/extraction-real-ai-20260831`, `origin/vps/extraction-advisory-wiring-20260831`. Verified with `git branch -r --contains <sha>` for each of the 32.

Therefore GitHub already holds the work; what lags is only the **`main` ref**.

### A.4 Why `main` does not advance (CONFIRMED)
`/var/lib/mythos/governance/log/denied.log` (every 5 min): commit **`f5e503adeb4bfb4f3e80a3db07aace9b017b9ad8`** (`chore(budget): record the $0.10 extraction grant`) touches protected path `projects/mythos-ai-executor/config/budgets.json` with no approval. `main` is refused fast-forward by design (`/usr/local/bin/mythos-git-push`). Two other branches are also denied every run: `mythos/mcp-ecosystem-20260901` (d9e5c54 → `projects/mythos-vault/credential-inventory.json`; d287b97 → `projects/mythos-gateway/contextforge.env.example`) and `mythos/m-msy4a8iz-f2673d/tk-msy4a8j0-f1b3c5` (1e4a1ee → `agents.json`, `agent-registry.js`).

**Reconciliation cannot be completed by an agent.** It requires the owner, as root:
```
sudo mythos-governance-approve --commit f5e503adeb4bfb4f3e80a3db07aace9b017b9ad8 --by "Othman Haddad" --reason "budget grant record reviewed"
```
(`/usr/local/bin/mythos-governance-approve` exists; only root writes approvals.) Within ≤5 min the relay fast-forwards `origin/main` to the local tip (now 33 commits). No rebase, no force, no history rewrite needed — a pure fast-forward. **REQUIRES DECISION** (owner). The two other denied branches each need their own decision (approve, or leave undelivered).

### A.5 Post-approval exact equality check (to run by the owner or next session)
```
cd /home/deploy/projects/mythos-prod && sudo -u deploy git fetch origin && sudo -u deploy git rev-list --left-right --count main...origin/main   # expect "0 0"
```

### A.6 Exhaustive list of mutations performed by this mission
1. `git add <3 explicit paths>` + `git commit` on `main` in the shared checkout → **63aec2c** `chore(prod-truth): commit three deployed-but-uncommitted files`. File contents unchanged; services untouched (they read the same paths).
2. `git worktree add -b mythos/autos-foundation-20260902 /home/deploy/worktrees/autos-foundation main`.
3. This document (+ handover entry) committed on that branch. The relay evaluates only `main..tip` for a new branch, so it passes governance and is delivered to GitHub by the timer.
4. Scratch files under the session scratchpad (sitemap copies, n8n export without credential values) — outside every repo.

Operations **not** used: reset, clean, rebase, amend, squash, force push, stash pop/drop, checkout across dirty files, `git add .`, any DB write, any SPY change.

---

## B. Repository State Report (CONFIRMED)
| Repo | Path | Branch | vs origin | Tree | Notes |
|---|---|---|---|---|---|
| mythos-prod | `/home/deploy/projects/mythos-prod` | main @ 63aec2c | ahead 33 / behind 0 (relay-blocked) | clean after 63aec2c | services ExecStart from this checkout (status-monitor, ssangyong-storefront, …) |
| mythos-prod (this mission) | `/home/deploy/worktrees/autos-foundation` | mythos/autos-foundation-20260902 | new | this doc | delivery path |
| spy | `/home/deploy/projects/spy` | master @ 41b3e04 | 0 / 0 | clean | `othoth77/spy` PRIVATE; 7,713 Python LOC in `spy/` (brief said ~5,800 — the difference is growth since that count); 9/9 test suites pass (run 2026-09-02 against scratch storage, see §Q) |
| idauto | `/home/deploy/projects/idauto` | main @ 65548ed | 0 / 0 | clean | `othoth77/idauto` PUBLIC; deployed unit ExecStarts from here |
| ssangyong (legacy plans + n8n exports) | `/home/deploy/projects/ssangyong` | main @ e347e76 | 0 / 0 | clean | `othoth77/ssangyong`; single "initial import" commit |
| oth-mcp | `/home/deploy/oth-mcp` (worktree of mythos-prod) | vps/extraction-advisory-wiring-20260831 @ d910dda | — | — | deployed OTH Knowledge HTTP + MCP run from here, not from `main` |

Legacy `/var/www/ssangyong.autos` (93 files, PHP + MariaDB) is **in no repository** (CONFIRMED by its own README in `projects/ssangyong-autos/README.md`). See §N.

---

## C. Classification of the 32 local-only commits (CONFIRMED)
All 32 are authored/committed by `Othman Haddad <othmanhaddad@gmail.com>`, 2026-08-30 → 2026-09-01. `git diff --diff-filter=D|R origin/main..main` → **zero deletions, zero renames**; every commit is additive or a small in-place fix. All are already on `origin/mythos/vault-architecture-20260901`.

| Group | Commits | Classification |
|---|---|---|
| OTH Knowledge features/fixes | 1b0e935, f586bd2, 4f54363 (promote-run), 78b1f42 (Unicode tokenizer) | KEEP |
| OTH MCP server/facade | 0b6b1d2, 0c5eb9a, c38ef92, 47f58d2, 395e966 | KEEP |
| Extraction advisory transport + budget | b39c2ad, 035ae78, **f5e503a** (protected `budgets.json`) | KEEP — f5e503a needs governance approval |
| Merges | 1736295, 19252ac | KEEP |
| Security | d72c090 (DOCKER-USER rule for Coolify :8000 + unit) | KEEP — live (rule present in `iptables -S DOCKER-USER`) |
| ERP | 6197ec6 (GRANT DELETE on invoice_lines, schema.sql) | KEEP |
| Backup | 66f43d5 (mythos-backup-capture-db.sh runnable) | KEEP — the ERP db backup succeeded 2026-09-02T04:06 |
| Docs / worklogs / handover | 0c3256b, 5148c9e, 5dbe30d, 0ffbaf8, 2e29378, 289accb, 50ac30e, 13234ce, b771202, d910dda, bddb5c0, f191de8, b65938f, dac12d8, b7ea66a | KEEP |

None is destructive; none touches SPY, IDAuto data, or the SsangYong catalog.

## D. Classification of the uncommitted files (3, not 2) (CONFIRMED)
| File | What | Evidence it is production truth | Class |
|---|---|---|---|
| `ops/backup/mythos-backup-capture.sh` | adds `MYTHOS_BACKUP_DB_NAME` so the daily dump targets `idauto_production` instead of the container's `$POSTGRES_DB` (IDA-SHIP-1) | md5 `03d93c1a…` identical to installed `/usr/local/sbin/mythos-backup-capture`; today's dump `idauto-20260902T033035Z.dump` exists | KEEP → committed (63aec2c) |
| `projects/status-center/monitor/probes.json` | +4 idauto.tn probes (site, public passport 404-is-healthy, auth wall 401-is-healthy, loopback :3001) | `mythos-status-monitor.service` runs `monitor.js` from this checkout and defaults `--config` to this path → the dirty file IS the live probe registry | KEEP → committed |
| `sites/mythosprod.xyz/assets/dashboard.css` | `.page-intro` horizontal padding | md5 `9c338adb…` identical to served `/var/www/mythosprod.xyz/assets/dashboard.css` | KEEP → committed |

Memory from 2026-08-31 listed `erp schema.sql` as dirty; it was committed since as 6197ec6.

---

## E. Existing-work preservation map
| Asset | Location | State | Class |
|---|---|---|---|
| IDAuto service + DB | `/home/deploy/projects/idauto`, PG `idauto_production` in container `idauto-postgres` (2 vehicles, 5 facts, 10 evidence, 1 org, 24 governorates, 37 audit rows) | live at idauto.tn → 127.0.0.1:3001 | KEEP (owner of Vehicle Instance) |
| SsangYong catalog (PG) | schema `ssangyong_autos.sya_*` in the same container: products 346, models 17, motorizations 63, compatibility 782, images 311 = **1,519 rows** | live via `store.ssangyong.autos` → 127.0.0.1:3011, GET-only | KEEP (seed of Vehicle Type + Product) — **not backed up** (§R) |
| Migration inputs | `projects/ssangyong-autos/database/migration/{input/*.csv, import.sql, generate_import.py, validation.sql}` | in Git | KEEP |
| Legacy PHP site + MariaDB | `/var/www/ssangyong.autos` (93 files), MariaDB `ssangyong_autos` (products 0, models 17, categories 12, subcategories 26) | serving `ssangyong.autos`; frozen by plan §21 | KEEP-FROZEN; **snapshot into a repo/tarball before any retirement** (§N) |
| n8n workflows | container `n8n-n8n-1` (10 workflows: 7 MYTHOS active, 3 SSANGYONG inactive) + JSON exports in `/home/deploy/projects/ssangyong/n8n/` and `projects/mythos-ai-executor/n8n/` | live | KEEP (§M) |
| n8n watchdog designs | `/home/deploy/projects/ssangyong/n8n/watchdog/*.json,*.md` (9 files) | in Git | KEEP |
| SsangYong scraper reports/plans | `/home/deploy/projects/ssangyong/{MYTHOS_SSANGYONG_DATA_MIGRATION_AND_RESUME_PLAN.md, N8N_TO_MARIADB_INTEGRATION_PLAN.md, n8n/*Report*}` | in Git | KEEP (design source for §I/§O) |
| Google Sheet `SSANGYONG_AUTOPART_REFERENCES` (6 tabs) | external (Google) | UNKNOWN current state; last documented snapshot 2026-07-13 | KEEP — take an immutable export (plan §1) |
| SPY | `/home/deploy/projects/spy` + `/home/deploy/deployments/spy/{venv,.env,var/spy.db}` | live, healthy | KEEP, unchanged |
| SPY monitor watchdog | `/home/deploy/spy-monitor/monitor.py` (+ `apply_correction_20260901.py`) | live user unit; **file is in no repository** | KEEP → copy into a repo later (§S) |
| OTH Knowledge store | `/home/deploy/othk-store` (224 records; 0 automotive) | live via :8150 | KEEP |
| Design-only automotive schemas | `projects/automotive` (31 tables), `projects/atelier-network` (24), `projects/autovaleur` (18) — never applied to any DB | Git | KEEP as design input; ADAPT (§F) |
| Design system | `assets/brand/tokens/tokens.css` ≡ `spy/web/assets/tokens.css` | live | KEEP |
| Fixpert | `/home/deploy/projects/fixpert` = static recruitment page + `submit.php` → Google Sheets; served at fixpert.tn | live | KEEP; not a workshop system |
| Governance relay / approvals | `/usr/local/bin/mythos-git-push`, `/var/lib/mythos/governance` | live | KEEP |

---

## F. MYTHOS ecosystem architecture (LOCKED for Phase 1)
```
MYTHOS
├── OTH ─── Automotive Knowledge Graph        (owner: OTH Knowledge; today: 0 automotive records)
├── MYTHOS AUTOS ─ autos.mythosprod.xyz        (does not exist yet; PostgreSQL, Next.js/TS/Prisma/Zod)
│     ├── IDAuto integration (Vehicle Instance via IVID — consumed, never duplicated)
│     ├── Vehicle Type catalog (owned here)
│     ├── Part / Reference / Product / Supplier Offer / Price (owned here — Reference Authority)
│     ├── Customer 360 · Orders · Procurement · Delivery (owned here)
│     ├── Review Center (human-in-loop)
│     └── Storefront APIs → piece.autos · ssangyong.autos · casse.autos
└── SPY ─── spy.mythosprod.xyz (market sensor; observes; owns nothing commercial)
```
Runtime placement (CONFIRMED constraints): one VPS, 7.7 GB RAM with **≈3.1 GB available** at audit time, 22 GB free disk, PostgreSQL 15 in `idauto-postgres` (7 databases). The prior automotive docs decided "one shared cluster, logically separated by schema" (`AUTOMOTIVE_ARCHITECTURE.md:44`). **Decision for AUTOS:** its own **database** `mythos_autos` in the existing cluster (not a schema inside `idauto_production`, not a new cluster) — separate DB satisfies "no shared table ownership" without new infrastructure. SPY keeps SQLite; there is **no shared database** between SPY and AUTOS.

Superseded prior decisions (REQUIRES DECISION to amend the docs; this package records the intent):
1. `AUTOMOTIVE_DATA_GOVERNANCE.md:346-359` "ID Auto is the authoritative source for the vehicle taxonomy … embedded in `idauto_vehicles`" → superseded by §H (Vehicle Type is an AUTOS catalog identity; IDAuto keeps only instance summary fields).
2. `AUTOMOTIVE_DATA_GOVERNANCE.md:98-100, 204` "part_id … Parts-Network-defined" → superseded by §I (Reference Authority = MYTHOS AUTOS; "Parts Network" is a module of AUTOS, not an external owner).
3. `AUTOMOTIVE_INTEGRATION_CONTRACTS.md:23` "never scraping" → stays true **for AUTOS** (AUTOS never crawls); SPY's crawling is governed by its own legal register (§T). AUTOS consumes SPY only through I1–I5.

## G. System ownership matrix
| Data / concept | Owner (writes) | Readers | Never |
|---|---|---|---|
| Vehicle Instance (IVID, VIN fact, plate, facts, evidence, trust, merge/split, org scopes) | **IDAuto** | AUTOS (via HTTP, service token per org), Fixpert | SPY; AUTOS must not store VIN beyond an IVID pointer |
| Vehicle Type (make/model/generation/motorization/years/fuel/power) | **AUTOS** | storefronts, OTH (as knowledge), SPY (only as an opaque label if ever) | IDAuto as authority |
| Part (generic component), Reference (OEM/manufacturer/aftermarket/supplier/alias, canonical form), Product, Compatibility (Product/Reference ↔ Vehicle Type) | **AUTOS** (Reference Authority) | storefronts, OTH | SPY |
| Supplier, Supplier Offer, purchase price, cost, margin, selling price | **AUTOS** | — | SPY (never sent) |
| Customer 360, requests, quotes, orders, procurement, delivery, payments, complaints | **AUTOS** | — | SPY, OTH |
| Used-part inventory (Casse), donor vehicles | **AUTOS** (Casse module) | casse.autos | — |
| Market observations (competitor, source, observation, event, evidence, price seen, availability seen, keyword trends) | **SPY** | AUTOS via I1–I5 | AUTOS writing into spy.db |
| Automotive knowledge (systems/subsystems, repair/diagnostic knowledge, relationships, claims with provenance) | **OTH Knowledge** | AUTOS, Fixpert | a second graph inside AUTOS |
| Orchestration / enrichment jobs (deep extraction, scheduled sync) | **n8n** (adapter only; no authoritative state) | — | n8n as a data store |
| Design tokens | mythos-prod `assets/brand/tokens` | all | per-app forks |

## H. Vehicle Type vs Vehicle Instance (LOCKED)
**Vehicle Instance** = a real vehicle. Identity = **IVID** (`ivid:1:<16 Crockford>:<2 check>`, 80 random bits, never derived from VIN/plate/owner — CONFIRMED `idauto/reference/ivid.js`). IDAuto rows carry `make, model, variant, year, body_type, fuel_type, category_code` as free-text summary (no taxonomy table — CONFIRMED). VIN is a `mythos_private` fact, never public.

**Vehicle Type** = a catalog identity in AUTOS: `vehicle_type(id, make, model, generation/code, motorization, year_from, year_to, fuel, power_kw/hp, body, source_refs[])`. Seed: the 17 models + 63 motorizations already in `ssangyong_autos.sya_vehicle_models / sya_vehicle_motorizations` (with `motorisation_url` provenance to autopart.tn) — CONFIRMED.

Bridge: `vehicle_instance_type_link(ivid, vehicle_type_id, confidence, method, evidence, resolved_at)` lives in **AUTOS** (never in IDAuto, never in SPY). Resolution = AUTOS resolver: IDAuto summary fields (+ optional VIN decode via an adapter, §P) → candidate Vehicle Types → Review Center if confidence < threshold.

Flow: Carte Grise / VIN → IDAuto → IVID → AUTOS link → Vehicle Type → Parts/Compatibility; Fixpert / Auto Valeur / Casse / History hang off the IVID. **Do not** use IVID as the catalog key; **do not** create a VIN registry in AUTOS; **do not** send IVIDs to SPY.

## I. Part / Reference / Product model (LOCKED)
```
Reference ──(identifies)──▶ Part ──(realised by)──▶ Product ──▶ Supplier Offer ──▶ Purchase Price ──▶ Selling Price
   ▲                                                   │
   └── aliases / cross-refs (OEM, manufacturer, aftermarket, supplier)      └── compatibility ──▶ Vehicle Type
```
Tables (PostgreSQL, Prisma): `part`, `reference(id, raw, canonical, kind{oem,manufacturer,aftermarket,supplier,alias}, brand, part_id, provenance)`, `reference_link(a, b, relation{equivalent,supersedes,pair}, confidence, provenance)`, `product(id, product_uid, brand, primary_reference_id, part_id, title, specs jsonb, status, provenance)`, `product_vehicle_compatibility(product_id, vehicle_type_id, provenance)`, `supplier`, `supplier_offer(product_id|reference_id, supplier_id, purchase_price, currency, availability, eta, observed_at)`, `price_policy` (global → category → brand → product → manual override), `selling_price`.

Canonicalisation (single function, single place, tested): uppercase → Unicode NFKC → strip spaces/hyphens/dots/slashes → keep original `raw` → store `canonical` + `canonical_compact`; aliases kept as rows, never overwritten; provenance mandatory.

Seed data (CONFIRMED): 346 products with `canonical_reference` (all), `oem_reference` (50), `pair_reference` (13), 42 brands, 782 compatibility rows, prices in TND (3 decimals — SPY's `parse_price_localised` lesson applies), all with `product_url`, `collected_at`, `last_checked_at`.

Search order (locked): exact reference → canonical reference → cross-reference/equivalent → exact Vehicle Type compatibility → product/supplier text → fuzzy (`pg_trgm`). PostgreSQL only (GIN on canonical, trigram, tsvector fr/ar); no OpenSearch.

`product_uid` keeps the namespace form `autopart.tn:<fiche-id>` — it is the existing bridge to SPY (§J).

## J. SPY ↔ MYTHOS AUTOS integration contract (I1–I5)
Ground truth of what SPY can give today (CONFIRMED from `spy.db` and code):
- `observation` rows, `entity_type ∈ {page, product, content, ad}`, `natural_key` = store SKU or canonical URL (per-source, not cross-source), `payload_json`.
- **Product payload** (catalogue engine): `name, url, sku, brand, price, currency, availability, image, source_strategy, offer{}, offer_active, canonical_url` — 153 product rows, all with a price, across autopart.tn (36), allopiece.tn (59), essidpiecesauto (49), topparts (9).
- **Sitemap/content payload**: `url, kind, lastmod, published_at, source_document` — 45,000 autopart.tn URLs (source 34) + 105 Mosaïque FM news. **No price, no title, no reference** in these rows.
- `event` rows (71): `CONTENT_ADDED/REMOVED/CHANGED`, with `evidence_json`, `importance`, `confidence`, `occurred_at/recorded_at`, `supersedes`, `event_correction`.
- No OEM/part-reference concept anywhere (grep-confirmed). No cross-source identity. No retention sweeper (config value unused).

Contract (transport = HTTPS JSON from SPY's authenticated API, Bearer token held by AUTOS; AUTOS pulls; SPY never calls AUTOS; no shared DB; no SPY row IDs stored as foreign keys in AUTOS — only `(source_url, natural_key, observed_at)` tuples plus a content hash):

| Interface | Direction | Payload (from SPY) | AUTOS obligation | Status |
|---|---|---|---|---|
| **I1 MARKET PRICE** | SPY → AUTOS | `{competitor_domain, source_url, natural_key, name, sku_raw, brand_raw, price, currency, availability, observed_first, observed_last, content_hash, evidence_url}` | Resolve `sku_raw`/URL → Reference/Product in AUTOS (Reference Authority); store as `market_price_observation` with provenance; never treat as a selling price | Data exists today (153 rows). API endpoint for this shape: **to build in SPY later** (not in this mission); interim = read via existing `/api/competitors/{id}/products` |
| **I2 REFERENCE OBSERVATION / RESOLUTION** | SPY → AUTOS (observation), AUTOS-internal (resolution) | `{sku_raw, brand_raw, source_url, fiche_id?}`; for autopart.tn the URL pattern `/fiche/<category>/<brand>-<brandId>/<ref-slug>-<ficheId>.html` yields `fiche_id` → `product_uid = autopart.tn:<fiche_id>` | AUTOS resolves to canonical Reference; unresolved → Review Center; SPY never learns the result | Bridge CONFIRMED: **333/346** catalog products join the 53,164-URL frontier (279 via sitemap-1, 54 via sitemap-2, 13 unjoined) |
| **I3 EVENT STREAM** | SPY → AUTOS | `{event_id, type, competitor, source_url, occurred_at, recorded_at, importance, confidence, evidence_json, supersedes, corrected:boolean}` | Map to AUTOS events `PRICE_CHANGED` (competitor), `OFFER_FOUND`; honour `event_correction` (retract, never delete) | `/api/events` exists (401 without auth — CONFIRMED) |
| **I4 CRAWL / SOURCE BOUNDARY** | AUTOS → SPY (request only) | AUTOS may *ask* for a source to be added/paused via SPY's write API under its own token; SPY owns the decision, robots handling, politeness, legal register | AUTOS must keep working when any SPY source is paused/deleted (competitor deletion cascades all its observations — CONFIRMED `spy/deletion.py`) | Existing `/api/sources/*` |
| **I5 DEMAND SIGNAL** | SPY → AUTOS | `keyword_snapshot{keyword, geo=TN, trend, delta_pct, collected_at}` (32 rows today, Google Trends via trendspy) | Advisory only; feeds sourcing priority, never pricing automatically | Exists (`/api/market`) |

Data that must never cross into SPY: customers, orders, IVIDs/VINs, supplier identities, purchase prices, costs, margins, stock, selling-price logic.

## K. OTH integration contract
- OTH Knowledge today: 224 records (`/home/deploy/othk-store`: 3 source, 7 entity, 7 observation, 12 fact, 65 evidence, 1 event, 5 artifact, 5 document, 57 chunk, 57 claim, 5 derived). A hybrid search for automotive terms returns unrelated claims (top hit: bee-keeping). **Automotive corpus: ZERO** (CONFIRMED).
- Primitives to reuse, not re-create: `source`, `entity`, `observation`, `fact`, `evidence`, `claim`, `derived`, provenance envelope, append-only JSONL + content-addressed objects, HTTP facade `:8150` (token), MCP server over SSH stdio.
- Contract: AUTOS **reads** OTH through the facade (search/get by id) for repair/diagnostic/system knowledge and cross-reference *claims*; AUTOS **writes nothing** into OTH directly. Promotion of AUTOS-derived knowledge into OTH goes through OTH's operator-only `promote-run`. OTH never becomes the catalog; AUTOS never becomes the graph. No graph database anywhere.
- Ownership of "Automotive Knowledge Graph": OTH, populated in Phase 14, from AUTOS canonical data (Vehicle Types, Parts, References, Compatibility as entities/relationships) + licensed/permitted repair knowledge only.

## L. SPY data model overview (CONFIRMED, `spy/schema.sql` v2)
`competitor(10)` → `source(30; kind WEBSITE/CATALOG/SITEMAP; engine watch/catalogue/sitemap/shopify/meta_ads; interval ≥15 min)` → `observation(45,273; UNIQUE(source_id, entity_type, natural_key); status active/updated/inactive/delisted; first_seen never moves)` → `event(71; UNIQUE(fingerprint); occurred_at/recorded_at; evidence_json; supersedes)` + `event_correction(5)`, `run(236)`, `snapshot(15; 16 KB on disk index, 8.1 MB files)`, `discovery(34)`, `keyword_snapshot(32)`, `reach_enrichment(65; Exa MCP; only event titles leave the host)`, `meta`. SQLite WAL, `quick_check = ok`, 40.05 MB. Competitors: 8 of 10 Tunisian automotive (autopart.tn, topparts.tn, essidpiecesauto.com, spab.tn, **cassemarket.com**, skapra.tn, ad-tunisie.com, allopiece.tn) + Mosaïque FM + tunisianet.

The 45,000 rows are a **URL frontier** (status all `active`, payload = url/lastmod only), ingested in one run on 2026-09-01 (`run.items_seen` 136,707 that day). They are not 45,000 understood products.

## M. n8n preservation / migration map (CONFIRMED via `n8n list:workflow` + export; credential values never read)
| Workflow (id) | Active | Trigger | Source → Destination | Depends on | Class |
|---|---|---|---|---|---|
| SSANGYONG_AUTOPART_SCRAPER (5XjFDKukrN8CfCS0), 59 nodes | no (last edit 2026-07-15) | cron 03:30 Tunis + manual | autopart.tn brand → models → motorisations → categories → product lists → **fiche pages** (title, reference, brand, price, availability, specs regex, images) → **Google Sheets** (6 tabs); hash-based upsert; 3–5 s jitter, 5-min pause per 100 pages | Google Sheets OAuth credential; sheet document id is a **placeholder** in this copy | **ADAPT** — the only fiche-depth extractor; retarget destination from Sheets to AUTOS staging (plan §18 "Safe n8n transition") |
| SSANGYONG_AUTOPART_SCRAPER – Auto Restart (BsKCDv1VQwBEkXqj) | no | error trigger → wait → re-run | — | parent | KEEP (restart pattern) |
| SSANGYONG_PROCESS_MODEL (H1HQRNqCEGHZMDI6), 49 nodes | no (2026-07-16) | executed by another workflow (per-model sub-workflow, memory-safe) | same as above per model → Google Sheets (real document id present) | googleSheetsOAuth2Api | **ADAPT** (preferred runner shape) |
| MYTHOS — Task Intake / Execute Task / Report / Goal Intake / Quota Watch / Campaign Autopilot / Failure Handler (7) | yes | webhooks + 10-min schedules | ↔ AI Executor `172.18.0.1:8130` (httpHeaderAuth) | executor token | KEEP (unrelated to AUTOS; do not touch) |

Failure mode today: SsangYong workflows are simply off; nothing breaks. Restart behaviour: `Auto Restart` re-invokes on error. Data quality: warnings for missing reference/price recorded to a `logs` tab. Output format: sheet rows (schema documented in `N8N_TO_MARIADB_INTEGRATION_PLAN.md §1.1`). Interpretation locked: **SPY = breadth/discovery (frontier, prices seen, events); n8n = depth/enrichment (fiche extraction into AUTOS staging); AUTOS = canonical.** Nothing deleted; `n8n.ssangyong.autos` vhost (nginx → 127.0.0.1:5678, answers 200; auth = n8n's own login, no nginx auth — UNKNOWN whether 2FA) stays.

## N. SsangYong catalog preservation map
| Item | Where | Count | Class |
|---|---|---|---|
| PostgreSQL catalog `ssangyong_autos.sya_products/_vehicle_models/_vehicle_motorizations/_product_vehicle_compatibility/_product_images` | container `idauto-postgres`, role `ssangyong_autos_owner`, 9.1 MB | 346 / 17 / 63 / 782 / 311 | KEEP; becomes the first AUTOS seed via a **copy** (never a move) |
| Storefront + GET API | `projects/ssangyong-autos/reference/*`, user unit `ssangyong-storefront.service` → :3011, vhost `store.ssangyong.autos` | — | KEEP until Phase 10 replaces it behind the same domain |
| Migration artefacts | `projects/ssangyong-autos/database/migration/` (CSV 347/783/312/18/64 lines, import.sql, validation.sql 18/18) | — | KEEP |
| Legacy PHP site | `/var/www/ssangyong.autos` (index, boutique, produit*, `api/catalog.php`, `pro/*.php`) | 93 files | KEEP-FROZEN; **not in Git — snapshot required** (REQUIRES DECISION on retirement, separate from this mission) |
| Legacy MariaDB `ssangyong_autos` | local mariadb :3306 | products 0, models 17, categories 12, subcategories 26, customer_requests 0 | KEEP-FROZEN (taxonomy only) |
| Scraper/watchdog/plans | `/home/deploy/projects/ssangyong/{n8n,MYTHOS_SSANGYONG_DATA_MIGRATION_AND_RESUME_PLAN.md,N8N_TO_MARIADB_INTEGRATION_PLAN.md}` | 20 + 2 files | KEEP |
| Google Sheet | external | UNKNOWN | export snapshot (plan §1) |
| autopart.tn boundary | `sitemap.xml` (index) → `sitemap-products-1.xml` (**45,000 URLs**) + `sitemap-products-2.xml` (**8,164 URLs**, zero overlap, fiche ids up to 90,471) = **53,164** product URLs, all `<lastmod>2026-08-30`; no category/brand/image/page sitemaps (404) | read-only probe 2026-09-02 | SPY registers only `-1`. Registering `-2` is a SPY *configuration* change (a new source row), deferred to Phase 6 — **not done in this mission** |

Facts to stop repeating: 45,000 ≠ 53,164 ≠ "catalog"; the legacy MariaDB site has 0 products; the two "ssangyong_autos" databases are different systems.

## O. Data provenance model (LOCKED)
Every externally-sourced row in AUTOS carries: `source_id` (registry row: key, type, trust_level 1–5, legal_status, contract_ref — reuse the draft `mythos_automotive_data_sources` shape), `source_url`, `source_natural_key`, `collected_at`, `updated_at`, `method` (sitemap|catalogue|fiche-extract|manual|api|import), `confidence` 0–1, `evidence_ref` (content hash or snapshot ref), `raw_ref` (immutable raw payload in a staging table / object storage). Raw is never overwritten; canonical rows reference raw; corrections are new rows (SPY's `event_correction` and IDAuto's fact supersession are the precedents). Three provenance vocabularies already exist (IDAuto facts/evidence, SPY evidence_json, OTH provenance envelope) — AUTOS adopts the **OTH envelope field names** for interoperability and maps the others.

## P. Build / Buy / Reuse matrix
Researched 2026-09-02 (web + GitHub API; "pushed" = last push date). UNKNOWN is stated where a primary page could not be verified. Full notes with source links: session scratch `bbr-research.md` (not committed).

| Candidate | What it is | Maturity | Licence / data rights | Cost / limits | TN fit (EU+KR, FR) | Verdict |
|---|---|---|---|---|---|---|
| FAPI Catalog OpenAPI (`fapi-dev/catalog-openapi`) | Apache-2.0 OpenAPI spec + MCP for fapi.iisis.ru, a Russian TecDoc-derived cross-ref/applicability reseller | pushed 2026-05, 0★ | spec Apache-2.0; data proprietary, RU ToS | demo key; production by e-mail | TecDoc-derived (likely EU/KR), RU-only site | **ADAPT the spec shape** (manufacturers / article / analogList / catalogDt) as our `CrossReferenceProvider` port; **REJECT the service** (unverified legality) |
| AutoTraQ | electronic-lock / refrigeration monitoring product line — not automotive parts | — | — | — | none | **REJECT** (mis-identified) |
| "Auto Parts E-Store" repos | student e-commerce demos (static / PHP+MySQL) | 2015–2023, ≤2★ | none / Apache-2.0 | — | no fitment, no i18n | **REJECT** |
| FitSpec | no such fitment product (name collides with a Haskell test tool) | — | — | — | none | **REJECT** (mis-identified) |
| Toyota Catalog API | official = TMNA developer portal (login-gated, 403); unofficial = toyotaepc.com EPC mirror ($99–199/mo) | official UNKNOWN | mirror provenance/ToS UNKNOWN | $99/mo 50k req | Toyota only | **REJECT for now** |
| `catamc90/auto-parts-catalog` | Symfony starter over AutoPartsAPI (RapidAPI TecDoc-alternative) | pushed 2026-06, 0★, no LICENSE | unlicensed code; upstream rights UNKNOWN | free 100/mo … $299/mo 1M | claims EU | **REJECT** repo; upstream only for a sandboxed trial |
| NHTSA vPIC | US DOT VIN decoder + downloadable PostgreSQL dump (69 MB, PG17+, v4.08 2026-08-15) | mature, government | US open data | rate-controlled API; DB has no limits | WMI/manufacturer decode works for KR/EU; model/engine data US-only | **REUSE** the PG dump as WMI/manufacturer seed + US fallback behind IDAuto; never the primary decoder |
| Wheel-Size API | commercial wheel/tyre fitment | live | proprietary; no resale/extraction | sandbox 300/day; $450–2,000/yr | Tunisia in NADM region | **BUY (Basic) only if wheels/tyres enter scope**; else defer |
| TecDoc / TecAlliance | EU aftermarket standard: KType tree, applicability, OE cross-refs, FR | mature; TecAlliance Africa (Casablanca); **WDATABASE = official Tunisian reseller** (quote only) | proprietary; % turnover + minimum | not public | best EU/KR/FR; SsangYong present | **BUY LATER** — request the WDATABASE quote now; model Vehicle Type / Article / criteria to TecDoc-compatible shapes so the licence becomes a data import. Grey-market TecDoc APIs (FAPI, AutoPartsAPI, Apify, RapidAPI) → REJECT for production |
| `lifeofcapo/car-api` (npm `auto-parts-db`) | 142 brands / 2,379 models with generations / 1,530 part names, JSON/TS | v3.0.0 2026-08-11, 24★ | MIT | — | includes SsangYong, Hyundai, Kia, Peugeot, Renault, Citroën, Dacia, VW, Fiat, Seat, Skoda, Chery, BYD; EN only; no engine granularity; provenance unstated | **REUSE as bootstrap seed** for Vehicle Type + Part taxonomy, verified per brand |
| back4app / `plowman/open-vehicle-db` / KBA HSN-TSN / ADAC | US or DE datasets | various | CC0 / none / UNKNOWN / paid | — | US or DE only | **REJECT** |
| CarQuery API | legacy make/model API | domain now redirects to an unrelated login; support "Account Suspended" (2026-09-02) | proprietary | — | — | **REJECT** (dead) |
| Auto-Data.net API | tech-spec DB (350+ brands) | live | proprietary, quote, own-sites-only | quote | broad EU/KR | **DEFER** (`VehicleSpecProvider` later) |
| WMI lists (Wikibooks CC BY-SA; vPIC DecodeWMI) | WMI → manufacturer/country (~1,500 codes incl. KMH/KNA/KPT, VF1/VF3/VF7, WVW) | maintained | CC BY-SA / US open | — | good | **REUSE** as IDAuto-side seed (drop the unlicensed `WALL-E/vin-decoder`) |
| Workshop OSS: GarageBuddy (MIT, .NET, stale), Torqvoice (ELv2, TS, 2026-09), carcareco (AGPL, .NET+Next) | garage management | — | licence / stack mismatch | — | i18n UNKNOWN | **REJECT** (watch Torqvoice); **BUILD** a thin work-order entity for Fixpert |
| Odoo CE `repair` + `fleet` | ERP modules, FR/AR locales | 18.0 | LGPL-3 | free | good | **ADAPT only if the whole ERP is wanted**; otherwise BUILD |
| Medusa | Node/TS headless commerce on PostgreSQL; ships a system (COD-like) payment provider | v2.19 2026-08, 36k★ | MIT core | free | TND ok | **ADAPT candidate, but BUILD recommended**: a WhatsApp → order → COD flow needs ~1 week of Prisma `Customer/Order/OrderLine`; re-evaluate Medusa only if self-service checkout/promotions/multi-warehouse become required |
| Vendure (GPL-3/commercial), Saleor (BSD, Python), Akeneo PIM (OSL-3, PHP) | commerce / PIM | active | copyleft or second runtime | free | — | **REJECT** |
| n8n (existing, Sustainable Use License: internal use OK) | orchestration | 2.36.9 | internal use OK, no resale | — | — | **REUSE** |
| changedetection.io (Apache-2.0), Crawlee / Scrapy | monitoring / crawler frameworks | active | permissive | — | — | **REJECT** as new components — SPY already covers this (and SPY's own BUILD_VS_REUSE already rejected changedetection.io) |
| Existing IDAuto · SsangYong catalog · SPY · n8n workflows · OTH Knowledge | in-house | live | ours | — | — | **REUSE** (see §E, §G) |

**Overall:** BUILD the core (Vehicle Type, Reference/Part/Product, Compatibility, Supplier Offer, Order) in Next.js/Prisma/PostgreSQL behind provider ports (`VinDecodeProvider`, `CrossReferenceProvider`, `VehicleSpecProvider`, `MarketObservationProvider` = SPY); REUSE IDAuto, the 346-product catalog, SPY, n8n, vPIC's PG dump and the MIT/CC seeds; BUY TecDoc through WDATABASE when revenue justifies it; REJECT the mis-identified candidates, grey-market TecDoc resellers, US/DE-only datasets and licence-incompatible platforms.

## Q. Security findings (CONFIRMED unless noted)
1. **fail2ban inactive** while sshd on 0.0.0.0:22 receives continuous credential-stuffing (journal 06:40–06:42 shows ≥10 attempts/min). Key-only auth is assumed but not verified here (UNKNOWN). Recommend enabling fail2ban (owner/root).
2. **Coolify realtime ports 6001/6002 are published on 0.0.0.0** by Docker; the DOCKER-USER rule from d72c090 drops only new connections to :8000. UNKNOWN whether 6001/6002 are intentionally public. REQUIRES DECISION.
3. SPY: loopback bind, TLS via certbot, HSTS/nosniff/DENY headers, `robots.txt` = Disallow all, `/api/*` 401 without session/Bearer, single admin token in a 0600 env file, SSRF double validation, `MemoryDenyWriteExecute`, `MemoryMax=512M`. Token-less mode would disable auth — token is set (CONFIRMED by 401). OK.
4. IDAuto: only `/public/passport/:ivid` and `/public/plates/:plate` unauthenticated; VIN deny-listed by policy artifact; 30 req/min hashed-IP buckets; org isolation returns 404. OK.
5. n8n reachable at `n8n.ssangyong.autos` (200) behind n8n's own login only. UNKNOWN: 2FA, version age ("release older than 6 weeks" warning). Recommend owner review.
6. Governance: relay is root-owned, identity-pinned, fast-forward-only; approvals root-only. OK. Denied branches accumulate silently (every 5 min) — add a status-center probe for `denied.log` growth (design, not done).
7. Secrets: none printed by this mission; `.env` files were read for key names only.
8. Capacity: 358 MB free / 3.1 GB available RAM; the OOM episode of 2026-08-31 is documented (OOMScoreAdjust drop-ins present). A Next.js + Prisma AUTOS process must be budgeted (`MemoryMax`) before deployment.
9. deploy's sudo is exactly `nginx -t`, `systemctl reload nginx`, `certbot` — good; all AUTOS units must follow the user-unit precedent.

SPY tests: 9/9 suites pass (`tests/test_*.py` executed 2026-09-02 as deploy with `SPY_DATA_DIR/DB_PATH/SNAPSHOT_DIR` pointed at scratch storage; production `spy.db` untouched). `pytest` is not installed in the venv; suites are plain scripts.

## R. Backup / recovery findings
| Store | Backed up? | Evidence | RPO today |
|---|---|---|---|
| `idauto_production` (PG) | **yes** daily 03:30 (`mythos-backup.timer`, in-container `pg_dump -Fc`, off-host push, monthly restore test) | `db-dumps/idauto-20260902T033035Z.dump`, `health/backup-health.json` ok | ≤24 h |
| `mythos_erp` (PG) | **yes** daily 04:06 (`mythos-backup-db.timer`) | `erp-db-dumps/mythos_erp-20260902T040642Z.dump`, health ok | ≤24 h |
| **`ssangyong_autos` (PG, 1,519 rows — irreplaceable without re-scraping)** | **NO** — no backup script references it | grep of `ops/backup/*` empty | ∞ |
| `mythos_command_center`, `idauto` (dev), `postgres` | NO | — | — |
| **SPY `spy.db`** (40 MB, WAL) + `snapshots/` (8.1 MB) | **NO scheduled backup.** One manual copy `mythos-backups/spy-db-20260901T100736Z/` (38 MB, includes `-wal`/`-shm`, i.e. a raw file copy, not an API backup) | — | ∞ |
| OTH store `/home/deploy/othk-store` | NO scheduled backup found (an `othmode-store` dir exists in `mythos-backups`, dated 08-26) | — | UNKNOWN |
| `/var/www/ssangyong.autos` + MariaDB | NO | — | ∞ |

Growth correction: spy.db is **40 MB total**, not "+40 MB/day". The 45,000-row jump was a one-shot sitemap ingest on 2026-09-01; steady state from the 09-01 copy (38 MB) to now (40 MB) is **≈1–2 MB/day (INFERRED)**. Observations are upserted by natural key, so re-runs do not add rows. Disk: 22 GB free.

Safe backup plan (no production change; to be installed by root/owner as a new unit, not by editing SPY):
1. Nightly, as `deploy`, `python3 -c "import sqlite3; src=sqlite3.connect('file:.../spy.db?mode=ro', uri=True); dst=sqlite3.connect('.../spy-YYYYmmddTHHMMSSZ.db'); src.backup(dst)"` (online, consistent, WAL-safe) → `/home/deploy/mythos-backups/spy-db/`, then `sha256sum`, then `PRAGMA integrity_check` on the copy; keep 14 daily + 8 weekly; include in the existing off-host push set. Snapshots dir: `tar` weekly.
2. Add `ssangyong_autos` (and `mythos_command_center`) to the `mythos-backup-db` capture (the script already accepts `MYTHOS_BACKUP_DB_NAME`; the multi-db branch `feat/backup-multi-db` exists — review before installing).
3. Tarball `/var/www/ssangyong.autos` + `mysqldump ssangyong_autos` once into `mythos-backups/legacy-ssangyong/` and commit the site files to a repo (owner decision on which).
4. Document restore: SPY = stop unit, copy `.db` back, start; PG = `pg_restore` into the same container (runbook exists for idauto).
RTO target for SPY: < 30 min (single file). RPO target: 24 h.

## S. systemd / watchdog remediation plan
Brief claimed the watchdog is detached and may not survive reboot. **Outdated (CONFIRMED):**
- `spy.service` and `spy-monitor.service` are **user units** of `deploy` (`~/.config/systemd/user/`), both `enabled` (symlinks in `default.target.wants`), both `active` (spy since 02:02 UTC, monitor since 00:58 UTC), `loginctl` Linger=yes → they survive logout/SSH and **reboot**. `After=network-online.target`, `StartLimitIntervalSec=300/Burst=5`, `Restart=on-failure`, hardened, `MemoryMax` 512M/128M, `OOMScoreAdjust=0` drop-ins.
- Health: `/api/health` proxied; status-center probes cover SPY (UNKNOWN whether the monitor unit itself is probed).
Remaining risks and the exact plan (no change made):
1. `/home/deploy/spy-monitor/monitor.py` and `apply_correction_20260901.py` exist **only** on this host. → Copy them into a repo (`spy/deploy/` would modify the SPY repo; alternative: `mythos-prod/ops/spy-monitor/`) — REQUIRES DECISION which repo; then install from the repo path exactly as `spy.user.service` documents.
2. `monitor.log` is unbounded (56 KB after 1 day). → add `logrotate` for `/home/deploy/spy-monitor/*.log` or switch to journal (`StandardOutput=journal`).
3. `spy-monitor.service` has `After=spy.service` but no `Wants=`; acceptable (read-only observer).
4. User units are invisible to `systemctl` as root; ops tooling must use `sudo -u deploy XDG_RUNTIME_DIR=/run/user/1001 systemctl --user …` (documented here).
5. Reboot drill: none recorded. → schedule one owner-run reboot test after the SPY backup (§R) exists.

## T. Legal / data-source risk register
| # | Risk | Evidence | Severity | Mitigation / decision |
|---|---|---|---|---|
| L1 | **autopart.tn robots.txt states: automated collection of catalogue, pricing and vehicle-compatibility data is prohibited without prior written authorisation** (FR+EN, advisory; enforcement "in nginx UA map"). | fetched 2026-09-02 | **HIGH** | The n8n depth scraper (inactive) collected exactly that data (346 products + fitment) in July 2026; SPY's catalogue engine holds 36 autopart.tn products with prices; SPY's sitemap source uses the advertised sitemap. **REQUIRES DECISION:** (a) request written authorisation from AutoPart Tunisie before any re-activation of fiche-depth extraction; (b) until then keep n8n SsangYong workflows inactive, keep existing data internal (no republication of their text/images), and limit SPY on autopart.tn to sitemap discovery + homepage watch. UNKNOWN: robots.txt content in July 2026. |
| L2 | Crawl-delay: autopart.tn asks 5 s; SPY jitter is 3–5 s and does not read `crawl_delay` | `spy/config.py`, `spy/fetch.py` (no `crawl_delay`) | LOW | SPY change deferred (not in this mission); note for SPY maintainers. |
| L3 | Other 9 monitored domains' robots/ToS not audited here | — | UNKNOWN | Phase 6 task: per-source legal row in SPY's source registry. |
| L4 | Identification: SPY UA `Mozilla/5.0 (compatible; SPY/1.0; +https://spy.mythosprod.xyz/about)`; `/about` answers 200 | CONFIRMED | OK | keep |
| L5 | Retention: SPY has no enforced retention (config unused); snapshots/events kept forever | code | LOW | policy row per source; sweeper later |
| L6 | Personal data: SPY stores business data + public news headlines; hashed IPs in IDAuto; Reach sends only event titles to Exa | CONFIRMED | LOW | keep; never add customer data to SPY (§J) |
| L7 | Source opt-out / stop: pausing a source or deleting a competitor cascades in SPY; AUTOS holds copies with provenance so it keeps working | CONFIRMED | OK | I4 rule |
| L8 | Technical diagrams / OEM EPC data | none present | — | only under licence (Phase 14) |
| L9 | Prior docs' "never scraping" rule vs SPY reality | `AUTOMOTIVE_INTEGRATION_CONTRACTS.md:23` | MEDIUM | §F.3 amendment REQUIRES DECISION |
| L10 | Republishing competitor prices publicly | — | MEDIUM | market prices are internal decision support only (I1); storefronts show AUTOS selling prices only |

## U. Implementation roadmap (dependency-adjusted)
Ordering changes vs the suggested list: **backup of irreplaceable stores moves before everything** (Phase 0b), **SPY integration (I1/I2) moves right after Part/Reference** because the 333/346 bridge and the 53k frontier are the cheapest catalog growth path, and **piece.autos DNS/TLS is a lead-time item started in Phase 2** (both `.autos` domains still point at OVH parking 213.186.33.5; `autos.mythosprod.xyz` has no DNS record).

| Phase | Scope | Exit evidence |
|---|---|---|
| 0a Git/source of truth | owner approves f5e503a; relay fast-forwards `main`; decide the 2 other denied branches; keep stash | `main...origin/main` = 0 0 |
| 0b Durability | SPY nightly API backup; add `ssangyong_autos` to db backup; snapshot legacy site + MariaDB; export Google Sheet | backups listed + one restore drill |
| 1 Architecture lock | this document merged; amend the 3 superseded doc statements; owner decisions §T-L1, §Q-2 | doc commits on main |
| 2 AUTOS foundation | repo dir `projects/mythos-autos` (Next.js/TS/Prisma/Zod), DB `mythos_autos` in the existing cluster with its own role, user unit + `MemoryMax`, loopback + nginx vhost `autos.mythosprod.xyz` (DNS first), auth = single operator token like SPY; source registry + provenance tables first | health probe green in status-center |
| 3 Vehicle Type + IDAuto | `vehicle_type` seeded from the 17 models/63 motorizations; IDAuto read client (service token, `passport:read`, `vehicle:read`); `vehicle_instance_type_link` + resolver + Review Center queue | one real IVID resolved to a Vehicle Type |
| 4 Part/Reference/Product | canonicaliser + tables + import of the 346 products/782 compat as a copy with provenance; reference aliases from `oem_reference`/`pair_reference` | 346 products searchable by canonical ref |
| 5 Search | PostgreSQL ordered search (§I) + storefront-neutral JSON API | acceptance queries |
| 6 SPY integration | AUTOS puller for I1/I3/I5 using existing endpoints; I2 resolver over autopart URLs; register `sitemap-products-2.xml` as a SPY source (SPY config, owner-approved); legal rows per source | market_price_observation rows linked to Products |
| 7 Suppliers/sourcing/pricing | supplier, supplier_offer, price_policy hierarchy, selling_price | one priced offer path end-to-end |
| 8 Orders/procurement/delivery | request → quote → order (COD) → purchase → receive → ship → deliver; WhatsApp as channel (manual first) | one order lifecycle |
| 9 piece.autos | storefront on AUTOS API (all brands), WhatsApp CTA, DNS/TLS moved | live |
| 10 ssangyong.autos | `store.ssangyong.autos` switched to AUTOS API behind the same domain; legacy retirement is a separate owner order | live, legacy frozen |
| 11 Casse | donor vehicle (IVID) → dismantle → used part → inventory/photos/condition/price → publish on casse.autos (own stock only; black/gold/white) | first used part published |
| 12 Fixpert | real workshop MVP on IDAuto + AUTOS (job card, parts consumed) — not the recruitment page | — |
| 13 Auto Valeur | valuation on Vehicle Type + Instance facts + I1 market signals | — |
| 14 Advanced | OTH automotive graph population, n8n deep-extraction under authorisation, automation rules, technical explorer under licence | — |

## V. Phase 0 / Phase 1 acceptance criteria
Phase 0 (this mission) — checked:
- [x] GitHub confirmed as Source of Truth (all 32 commits present on origin branches; `origin/main` unchanged)
- [ ] mythos-prod `main` reconciled — **BLOCKED on owner approval of f5e503a** (mechanism verified; fast-forward only)
- [x] no work lost · [x] no history rewritten · [x] no unsafe Git op · [x] working tree state explicitly known (clean after 63aec2c)
- [x] 32 commits classified · [x] uncommitted files classified (3) · [x] SPY unchanged · [x] SPY healthy (units active, 9/9 tests, quick_check ok)
- [x] n8n assets preserved · [x] SsangYong assets preserved
- [x] Vehicle Type defined · [x] Vehicle Instance ownership defined (IDAuto) · [x] Reference Authority defined (AUTOS) · [x] Part/Product relationship defined
- [x] SPY boundary · [x] OTH boundary · [x] data ownership · [x] provenance defined
- [x] Build/Buy/Reuse researched (§P) · [x] legal risks documented · [x] backup risks documented · [x] watchdog risks documented
- [x] implementation sequence documented · [x] no premature product coding

Phase 1 exits when: the three doc amendments (§F) are committed; owner decisions L1, Q-2, §S-1 recorded; Phase 0b backups exist with one restore drill; `main` equals `origin/main`.

## W. Explicit list of things NOT to build yet
microservices · Kubernetes · Redis · OpenSearch/Elasticsearch · a graph DB · a second VIN/identity system · a vehicle taxonomy inside IDAuto or SPY · reference matching inside SPY · a SPY→AUTOS shared database · customer/order/margin data in SPY · Casse third-party marketplace · online checkout/payment gateway · mobile app · AI agents for pricing/sourcing decisions · an event bus (a table + rules suffices) · a new n8n instance (`n8n.mythosprod.xyz` is forbidden by `MYTHOS_N8N_STRATEGY.md`) · a SPY redesign (tokens are already canonical) · re-activation of the autopart.tn depth scraper before written authorisation · registering `sitemap-products-2.xml` from this mission · retirement of the legacy ssangyong.autos site · any AUTOS table for technical diagrams without a licence.

---
*Evidence trail: `docs/AI_HANDOVER.md` entry "MYTHOS-AUTOS-FOUNDATION-0 (2026-09-02)"; scratch artefacts (sitemaps, n8n export without secrets) were session-local and not committed.*
