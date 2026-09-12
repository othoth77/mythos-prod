# MYTHOS AUTO — Kitchen cross-repository baseline

**Established:** 2026-09-08, from live systems and working trees — not from documentation about them.
**Method:** three isolated clones under `/root/workspaces/`, one per repository. No two repositories share a working directory, and no session shares a checkout.

---

## 1. Repository state at baseline

| Repository | Workspace | Branch | HEAD | Tree | Remote |
|---|---|---|---|---|---|
| `othoth77/mythos-prod` | `/root/workspaces/kitchen` | `feature/kitchen-contract-hardening-20260908` (from `main`) | `fd4f569` | clean | github.com/othoth77/mythos-prod |
| `othoth77/ssangyong` | `/root/workspaces/ssangyong` | `main` | `966250c` | clean | github.com/othoth77/ssangyong |
| `othoth77/piece.autos` | `/root/workspaces/piece-autos` | `audit/piece-autos-foundation-20260907` | `7ab0ed7` | clean | github.com/othoth77/piece.autos |

The production checkout `/home/deploy/projects/mythos-prod` (`main`, `fd4f569`, 4 untracked audit files) was **read, never written**. The Kitchen workspace is a `--no-hardlinks` clone of it, so nothing in this work can reach the running service's files.

## 2. Where the Kitchen actually is

**`mythos-prod:projects/ssangyong-autos/`** — and nowhere else.

| | |
|---|---|
| Process | `node reference/api.js`, PID 688564, cwd `/home/deploy/projects/mythos-prod` |
| Bind | `127.0.0.1:3011` |
| Public | `https://store.ssangyong.autos` → 3011; `/api/` carries `limit_except GET HEAD { deny all; }` |
| Data | PostgreSQL 15 `ssangyong_autos`, schema `ssangyong_autos`, role `ssangyong_autos_owner`, **inside the `idauto-postgres` container** |
| Tables | 5 `sya_*` + 7 indexes on `sya_products` |
| Volume | 346 products · 17 vehicle models · 63 motorizations · **782 fitment rows** · 311 images |
| Size | `sya_products` **688 kB**; largest table `sya_product_vehicle_compatibility` 360 kB |
| Writes | Impossible — `default_transaction_read_only=on` per connection |

`projects/automotive/` is the **governance** layer: an ownership matrix with, by its own README, *"no deployment, no real data, all feature flags false"*. It constrains; it serves nothing.

`projects/automotive/comms/` is real code (WhatsApp/CRM routing) and already names `piece.autos` at CRM inbox 2. Chatwoot is selected, **not deployed** (host RAM).

## 3. Consumers

| Consumer | Reaches the Kitchen by | Routes used | State |
|---|---|---|---|
| **SsangYong storefront** | in-process — `shop.html` + `shop-ui.js` served by the same Node process | `/api/health`, `/api/vehicle-models`, `/api/brands`, `/api/products` | **LIVE** |
| **Piece.Autos** | HTTP, `PIECE_KITCHEN_BASE_URL` | all six SYA-API-1 routes | built, live-verified, **not deployed** (DNS on OVH parking) |
| **Casse.Autos** | — | — | not built; must stay a sibling, not a mode |

`othoth77/ssangyong` the repository is **documentation and history**, not code of record: its `site/autocare-shop-tn` cannot build (`prisma/schema.prisma` absent, never committed) and is a car-care shop with no vehicle, motorisation or fitment.

## 4. Ownership

Per `docs/AUTOMOTIVE_DATA_GOVERNANCE.md` §1.5, Parts Network owns part identity, references, fitment, brands, categories, suppliers, stock, prices, availability, images, **and parts orders and fulfilment**.

The deployed Kitchen implements the first eight and **none of the last two**. A storefront therefore owns its channel order provisionally, records that as provisional, and shapes it for handover.

## 5. The governance contradiction, still open

`AUTOMOTIVE_DATA_GOVERNANCE.md` §8: *"ID Auto is the authoritative source for the vehicle taxonomy … no other product maintains a competing vehicle taxonomy."*

Re-verified 2026-09-08: `projects/idauto/database/schema.sql` has **25 tables and no taxonomy**. `idauto_vehicles` is a registry of observed physical vehicles — `internal_ref`, plate linkage, `observation_count`, `fiche_status` — whose `make`/`model`/`variant` are free-text `VARCHAR(80)`. The document concedes the taxonomy API is *"part of the IDA-2 scope"*, i.e. unbuilt.

**The only make→model→generation→motorisation→year taxonomy in the estate is the Kitchen's** (`sya_vehicle_models` + `sya_vehicle_motorizations`). A storefront consuming it is therefore *obeying* the no-competing-taxonomy rule. The document is stale; correcting it is an owner/governance action, not something an implementer should silently do.

## 6. Gap status after this work

| Gap | Status |
|---|---|
| **KG-1** vehicle-brand facet and filter | **CLOSED** — `/api/vehicle-brands`, `?brand_car=` on products and models |
| **KG-3** batched quotes | **CLOSED** — `/api/quotes`, measured 14.4× faster than N product calls |
| **KG-2** part categories | **OWNER DECISION** — the 390 slugs are a frontier measurement, not a catalog dimension |
| **KG-4** orders / customers | **OPEN** — out of scope for a read API |
| **KG-5** stock quantity | **NOT A GAP TO CLOSE** — no quantity exists; inventing one would be worse |
| **KG-6** search | **DEFERRED WITH MEASUREMENT** — 688 kB table, 1.7 ms seq scan |
| **KG-7** pagination | **DEFERRED WITH MEASUREMENT** — total order, 1.9 ms deepest page |
| **KG-8** single-brand data | **OWNER-GATED (O8)** — architecture is ready, data is not authorised |

## 7. Risks

1. **O8 is unresolved and gates the product.** `autopart.tn/robots.txt` prohibits automated collection of catalogue, pricing and vehicle-compatibility data without written authorisation. Every row in the Kitchen came from there. Nothing in this work collected anything.
2. **SYA-API-2 is not deployed.** The live service still runs SYA-API-1. Restarting `ssangyong-storefront` is an owner/operator step.
3. **`ssangyong_autos` is absent from the scheduled backup set** (one manual dump, 2026-09-02) — pre-existing, unchanged by this work, still worth closing.
4. **A 60-second `Cache-Control` applies to `/api/quotes`.** Consumers revalidating a cart must send `no-store`; Piece.Autos does.
5. **Two sessions previously collided in one checkout.** Mitigated structurally here: one workspace per repository.
