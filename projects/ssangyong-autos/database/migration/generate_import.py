#!/usr/bin/env python3
# =============================================================================
# SSANGYONG.AUTOS Stage 4 — deterministic migration generator (DRY-RUN)
#
# STATUS: DRY-RUN TOOL — GENERATES SQL TEXT ONLY. NEVER CONNECTS TO ANY
# DATABASE. NEVER EXECUTES SQL. The generated import.sql is NOT EXECUTED and
# NOT DEPLOYED until an explicitly authorised Stage 5.
#
# Input  (migration/input/, produced by the validated Stage 2 read-only
#         dry-run of Google Sheet 1T0dyVeNrToy5bhLJ5Sh6_gM_WMAGJBS6s2VBzWa2Id0):
#   dryrun_products.csv        346 canonical products
#   dryrun_compatibility.csv   782 product-vehicle relationships
#   dryrun_images.csv          311 product images
#   stage2_models.csv           17 vehicle models   (Sheets `models` tab)
#   stage2_motorizations.csv    63 motorizations    (Sheets `motorizations` tab)
#
# Output (migration/):
#   import.sql       transaction-wrapped INSERTs for the 5 sya_ tables
#   validation.sql   read-only post-import assertions
#
# Determinism: identical input bytes always produce identical output bytes.
# Internal ids are assigned by sorting on each table's stable natural key
# (product_uid, model_url, motorisation_url, then derived orderings), never
# randomly. External identity is the site-native product_uid
# 'autopart.tn:<fiche-id>' — no invented SKUs, no random UUIDs.
#
# The script fails hard (non-zero exit, no output files) if any expected
# count, uniqueness, referential-integrity, CHECK-constraint or type
# simulation fails. It never silently discards a row.
# =============================================================================
import csv, json, re, sys, os
from decimal import Decimal, ROUND_HALF_UP

HERE = os.path.dirname(os.path.abspath(__file__))
INP = os.path.join(HERE, 'input')
EXPECTED = {'products': 346, 'compatibility': 782, 'images': 311}
ISO_TS = re.compile(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$')
DATE_LIKE = re.compile(r'^\d{4}-\d{2}-\d{2}')
MOT_SLUG = re.compile(r'/([^/]+?)-(\d+)\.html$')
errors, warnings = [], []

def fail(msg): errors.append(msg)

def rows(name):
    with open(os.path.join(INP, name), newline='') as f:
        return list(csv.DictReader(f))

def q(v):
    """SQL string literal (standard_conforming_strings)."""
    if v is None: return 'NULL'
    return "'" + str(v).replace("'", "''") + "'"

def qn(v):  # nullable text: '' -> NULL
    return 'NULL' if v in (None, '') else q(v)

def qi(v):  # nullable integer
    if v in (None, ''): return 'NULL'
    f = float(v)
    if f != int(f): fail(f'non-integer year value: {v!r}')
    return str(int(f))

def qts(v, field):
    if v in (None, ''): fail(f'missing timestamp in {field}'); return 'NULL'
    s = str(v)
    if not ISO_TS.match(s): fail(f'invalid timestamp {s!r} in {field}'); return 'NULL'
    if not (s.endswith('Z') or re.search(r'[+-]\d{2}:?\d{2}$', s)):
        s += 'Z'  # Sheets-exported datetimes are UTC-naive; make UTC explicit
    return q(s) + '::timestamptz'

def qprice(v):
    p = Decimal(str(v)).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    if not (Decimal('0') < p < Decimal('1000000')): fail(f'price out of NUMERIC(8,2)/CHECK range: {v}')
    return str(p)

def qjsonb(v, field):
    if v in (None, ''): return 'NULL'
    try:
        json.loads(v)
    except Exception:
        fail(f'invalid JSON in {field}: {v[:60]!r}'); return 'NULL'
    return q(v) + '::jsonb'

def maxlen(v, n, field):
    if v and len(str(v)) > n: fail(f'{field} exceeds VARCHAR({n}): {str(v)[:40]!r}…')

def split_model(label):
    m = re.match(r'^(.*?)\s*\(([^)]+)\)$', label)
    return (m.group(1), m.group(2)) if m else (label, None)

def decode_mot(label, url):
    """Repair date-coerced motorisation labels from the URL slug (Stage 2 rule)."""
    if not DATE_LIKE.match(label): return label
    m = MOT_SLUG.search(url)
    d = re.fullmatch(r'(\d)-(\d)', m.group(1)) if m else None
    if not d: fail(f'motorisation date-coerced and slug undecodable: {label!r} {url}'); return label
    return f'{d.group(1)}.{d.group(2)}'

# ---- load ------------------------------------------------------------------
P, C, I = rows('dryrun_products.csv'), rows('dryrun_compatibility.csv'), rows('dryrun_images.csv')
M, T = rows('stage2_models.csv'), rows('stage2_motorizations.csv')

# ---- vehicle models (deterministic ids by model_url) -----------------------
models, seen_url, seen_ident = [], set(), set()
for r in sorted(M, key=lambda r: r['model_url']):
    if r['model_url'] in seen_url: fail(f'duplicate model_url {r["model_url"]}'); continue
    seen_url.add(r['model_url'])
    name, gen = split_model(r['model'])
    ident = (r['source'], r['brand_car'], name, gen)
    if ident in seen_ident: fail(f'duplicate model identity {ident}')
    seen_ident.add(ident)
    models.append(dict(id=len(models)+1, source=r['source'], brand_car=r['brand_car'], label=r['model'],
                       model_name=name, generation_code=gen, model_url=r['model_url'],
                       year_from=r['year_from'], year_to=r['year_to'], collected_at=r['collected_at']))
model_by_label = {m['label']: m for m in models}

# ---- motorizations (deterministic ids by motorisation_url) -----------------
motors, seen = [], set()
for r in sorted(T, key=lambda r: r['motorisation_url']):
    if r['motorisation_url'] in seen: fail(f'duplicate motorisation_url {r["motorisation_url"]}'); continue
    seen.add(r['motorisation_url'])
    mdl = model_by_label.get(r['model'])
    if not mdl: fail(f'motorization references unknown model {r["model"]!r}'); continue
    label = decode_mot(r['motorisation'], r['motorisation_url'])
    maxlen(label, 64, 'motorisation'); maxlen(r['power'], 64, 'power'); maxlen(r['fuel'], 32, 'fuel')
    motors.append(dict(id=len(motors)+1, model_id=mdl['id'], motorisation=label,
                       motorisation_url=r['motorisation_url'], year_from=r['year_from'],
                       year_to=r['year_to'], power=r['power'], fuel=r['fuel'], collected_at=r['collected_at']))
motor_by_suffix = {MOT_SLUG.search(m['motorisation_url']).group(0): m for m in motors}

# ---- products (deterministic ids by product_uid) ---------------------------
products, seen_uid, seen_purl, seen_biz = [], set(), set(), set()
for r in sorted(P, key=lambda r: r['canonical_product_id']):
    uid = r['canonical_product_id']
    if uid in seen_uid: fail(f'duplicate product_uid {uid}')
    if r['product_url'] in seen_purl: fail(f'duplicate product_url {r["product_url"]}')
    biz = (r['source'], r['product_brand'], r['canonical_reference'])
    if biz in seen_biz: fail(f'duplicate business identity {biz}')
    seen_uid.add(uid); seen_purl.add(r['product_url']); seen_biz.add(biz)
    for f, n in [('canonical_product_id', 64), ('source', 64), ('product_brand', 128),
                 ('canonical_reference', 64), ('pair_reference', 64), ('availability', 32), ('status', 16)]:
        maxlen(r[f] if f in r else None, n, f)
    for f in ['source', 'product_brand', 'canonical_reference', 'product_title', 'availability',
              'price_tnd', 'currency', 'product_url', 'status', 'collected_at', 'last_checked_at']:
        if r[f] in (None, ''): fail(f'required field {f} empty for {uid}')
    if r['status'] not in ('active', 'updated', 'inactive', 'delisted'): fail(f'status CHECK would fail: {r["status"]!r}')
    if r['availability'] not in ('En Stock', 'Sur Commande', 'Indisponible'): fail(f'availability CHECK would fail: {r["availability"]!r}')
    if not re.fullmatch(r'[A-Z]{3}', r['currency']): fail(f'currency CHECK would fail: {r["currency"]!r}')
    if not r['product_url'].startswith('https://'): fail(f'product_url CHECK would fail: {uid}')
    if r['last_checked_at'] < r['collected_at']: fail(f'last_checked_at < collected_at for {uid}')
    products.append(dict(id=len(products)+1, **r))
prod_by_uid = {p['canonical_product_id']: p for p in products}

# ---- compatibility ---------------------------------------------------------
compat, seen_key, unresolved_motor = [], set(), 0
for r in C:
    p = prod_by_uid.get(r['canonical_product_id'])
    if not p: fail(f'compatibility orphan product {r["canonical_product_id"]}'); continue
    mdl = model_by_label.get(r['model'])
    if not mdl: fail(f'compatibility orphan model {r["model"]!r}'); continue
    exp_gen = mdl['generation_code'] or ''
    if r['generation'] != exp_gen: fail(f'generation mismatch {r["generation"]!r} vs model {r["model"]!r}')
    label = r['motorisation']
    if DATE_LIKE.match(label): fail(f'date-coerced motorisation reached Stage 4: {label!r}')
    maxlen(label, 64, 'compat motorisation')
    sfx = MOT_SLUG.search(r['category_url'])
    motor = motor_by_suffix.get(sfx.group(0)) if sfx else None
    if motor is None:
        unresolved_motor += 1  # kept with NULL FK, never discarded
    elif motor['motorisation'] != label:
        fail(f'motorization label mismatch: compat {label!r} vs tab {motor["motorisation"]!r} ({r["category_url"]})')
    key = (p['id'], mdl['id'], label, r['year_from'] or None, r['year_to'] or None)
    if key in seen_key: fail(f'duplicate compatibility key {key}')
    seen_key.add(key)
    compat.append(dict(product_id=p['id'], model_id=mdl['id'],
                       motor_id=motor['id'] if motor else None, motorisation=label,
                       year_from=r['year_from'], year_to=r['year_to'], category_url=r['category_url']))
compat.sort(key=lambda c: (c['product_id'], c['model_id'], c['motorisation'],
                           c['year_from'] or '', c['year_to'] or '', c['category_url']))
for i, c in enumerate(compat): c['id'] = i + 1

# ---- images ----------------------------------------------------------------
images, seen_img = [], set()
for r in I:
    p = prod_by_uid.get(r['canonical_product_id'])
    if not p: fail(f'image orphan product {r["canonical_product_id"]}'); continue
    k = (p['id'], r['image_url'])
    if k in seen_img: fail(f'duplicate product/image {k}')
    seen_img.add(k)
    if not r['image_url'].startswith('https://'): fail(f'image_url CHECK would fail: {r["image_url"]}')
    if int(r['position']) < 1: fail(f'position CHECK would fail: {r}')
    maxlen(r['image_filename'], 255, 'image_filename')
    images.append(dict(product_id=p['id'], image_url=r['image_url'], image_alt=r['image_alt'],
                       image_filename=r['image_filename'], position=int(r['position'])))
images.sort(key=lambda i: (i['product_id'], i['position'], i['image_url']))
for i, im in enumerate(images): im['id'] = i + 1

# ---- expected counts (STOP on mismatch) ------------------------------------
for name, got in [('products', len(products)), ('compatibility', len(compat)), ('images', len(images))]:
    if got != EXPECTED[name]: fail(f'COUNT MISMATCH: {name} expected {EXPECTED[name]}, got {got}')

report = dict(products=len(products), models=len(models), motorizations=len(motors),
              compatibility=len(compat), images=len(images),
              compat_with_motor_fk=sum(1 for c in compat if c['motor_id']),
              compat_motor_fk_null=unresolved_motor,
              products_without_images=len(products) - len({i['product_id'] for i in images}),
              errors=errors, warnings=warnings)
print(json.dumps(report, indent=1))
if errors:
    print(f'\nFAILED — {len(errors)} error(s); no SQL written.', file=sys.stderr)
    sys.exit(1)

# ---- emit import.sql -------------------------------------------------------
o = []
o.append(f"""-- =============================================================================
-- SSANGYONG.AUTOS Stage 4 — data import (DRY-RUN ARTIFACT)
--
-- STATUS: DRY-RUN — NOT EXECUTED — NOT DEPLOYED.
-- Generated deterministically by generate_import.py from the validated
-- Stage 2 dataset (migration/input/). No database connection was used to
-- produce this file. Executing it is Stage 5 work and requires explicit
-- owner authorisation plus prior creation of the ssangyong_autos schema
-- from projects/ssangyong-autos/database/schema.sql.
--
-- Row counts: products {len(products)} · vehicle_models {len(models)} · vehicle_motorizations {len(motors)}
--             · compatibility {len(compat)} · images {len(images)}
-- Internal ids are explicit and deterministic (sorted natural keys); the
-- sequences are realigned with setval() at the end of the transaction.
-- =============================================================================
BEGIN;
-- SET LOCAL search_path TO ssangyong_autos;  -- enable in Stage 5 once the schema exists
""")
o.append('INSERT INTO sya_vehicle_models (id, source, brand_car, model_name, generation_code, model_url, year_from, year_to, collected_at) VALUES')
o.append(',\n'.join(f"  ({m['id']}, {q(m['source'])}, {q(m['brand_car'])}, {q(m['model_name'])}, {qn(m['generation_code'])}, {q(m['model_url'])}, {qi(m['year_from'])}, {qi(m['year_to'])}, {qts(m['collected_at'],'models.collected_at')})" for m in models) + ';\n')
o.append('INSERT INTO sya_vehicle_motorizations (id, vehicle_model_id, motorisation, motorisation_url, year_from, year_to, power, fuel, collected_at) VALUES')
o.append(',\n'.join(f"  ({m['id']}, {m['model_id']}, {q(m['motorisation'])}, {q(m['motorisation_url'])}, {qi(m['year_from'])}, {qi(m['year_to'])}, {qn(m['power'])}, {qn(m['fuel'])}, {qts(m['collected_at'],'motorizations.collected_at')})" for m in motors) + ';\n')
o.append('INSERT INTO sya_products (id, product_uid, source, product_brand, canonical_reference, product_title, oem_reference, pair_reference, criteria_text, technical_specs, availability, price_tnd, currency, delivery_note, product_url, status, collected_at, last_checked_at) VALUES')
o.append(',\n'.join(f"  ({p['id']}, {q(p['canonical_product_id'])}, {q(p['source'])}, {q(p['product_brand'])}, {q(p['canonical_reference'])}, {q(p['product_title'])}, {qn(p['oem_reference'])}, {qn(p['pair_reference'])}, {qn(p['criteria_text'])}, {qjsonb(p['technical_specs_json'],'technical_specs_json')}, {q(p['availability'])}, {qprice(p['price_tnd'])}, {q(p['currency'])}, {qn(p['delivery_note'])}, {q(p['product_url'])}, {q(p['status'])}, {qts(p['collected_at'],'collected_at')}, {qts(p['last_checked_at'],'last_checked_at')})" for p in products) + ';\n')
o.append('INSERT INTO sya_product_vehicle_compatibility (id, product_id, vehicle_model_id, vehicle_motorization_id, motorisation, year_from, year_to, category_url) VALUES')
o.append(',\n'.join(f"  ({c['id']}, {c['product_id']}, {c['model_id']}, {c['motor_id'] if c['motor_id'] else 'NULL'}, {q(c['motorisation'])}, {qi(c['year_from'])}, {qi(c['year_to'])}, {q(c['category_url'])})" for c in compat) + ';\n')
o.append('INSERT INTO sya_product_images (id, product_id, image_url, image_alt, image_filename, position) VALUES')
o.append(',\n'.join(f"  ({im['id']}, {im['product_id']}, {q(im['image_url'])}, {qn(im['image_alt'])}, {qn(im['image_filename'])}, {im['position']})" for im in images) + ';\n')
o.append(f"""SELECT setval('sya_vehicle_models_id_seq', {len(models)}, true);
SELECT setval('sya_vehicle_motorizations_id_seq', {len(motors)}, true);
SELECT setval('sya_products_id_seq', {len(products)}, true);
SELECT setval('sya_product_vehicle_compatibility_id_seq', {len(compat)}, true);
SELECT setval('sya_product_images_id_seq', {len(images)}, true);

COMMIT;
-- After import, run validation.sql (read-only) and require every check to pass.
""")
with open(os.path.join(HERE, 'import.sql'), 'w') as f:
    f.write('\n'.join(o))

# ---- emit validation.sql ---------------------------------------------------
with open(os.path.join(HERE, 'validation.sql'), 'w') as f:
    f.write(f"""-- =============================================================================
-- SSANGYONG.AUTOS Stage 4 — post-import validation (READ-ONLY)
-- STATUS: DRY-RUN ARTIFACT — NOT EXECUTED — NOT DEPLOYED.
-- Every query must return the expected value; any deviation aborts Stage 5.
-- =============================================================================
SELECT 'products'            AS check, count(*) = {len(products)} AS pass FROM sya_products
UNION ALL SELECT 'vehicle_models',       count(*) = {len(models)}  FROM sya_vehicle_models
UNION ALL SELECT 'vehicle_motorizations',count(*) = {len(motors)}  FROM sya_vehicle_motorizations
UNION ALL SELECT 'compatibility',        count(*) = {len(compat)}  FROM sya_product_vehicle_compatibility
UNION ALL SELECT 'images',               count(*) = {len(images)}  FROM sya_product_images
UNION ALL SELECT 'compat_motor_fk_set',  count(*) = {report['compat_with_motor_fk']} FROM sya_product_vehicle_compatibility WHERE vehicle_motorization_id IS NOT NULL
UNION ALL SELECT 'dup_product_url',      count(*) = 0 FROM (SELECT product_url FROM sya_products GROUP BY 1 HAVING count(*) > 1) d
UNION ALL SELECT 'dup_business_identity',count(*) = 0 FROM (SELECT source, product_brand, canonical_reference FROM sya_products GROUP BY 1,2,3 HAVING count(*) > 1) d
UNION ALL SELECT 'dup_compatibility',    count(*) = 0 FROM (SELECT product_id, vehicle_model_id, motorisation, year_from, year_to FROM sya_product_vehicle_compatibility GROUP BY 1,2,3,4,5 HAVING count(*) > 1) d
UNION ALL SELECT 'dup_product_image',    count(*) = 0 FROM (SELECT product_id, image_url FROM sya_product_images GROUP BY 1,2 HAVING count(*) > 1) d
UNION ALL SELECT 'orphan_compat_product',count(*) = 0 FROM sya_product_vehicle_compatibility c LEFT JOIN sya_products p ON p.id = c.product_id WHERE p.id IS NULL
UNION ALL SELECT 'orphan_compat_model',  count(*) = 0 FROM sya_product_vehicle_compatibility c LEFT JOIN sya_vehicle_models m ON m.id = c.vehicle_model_id WHERE m.id IS NULL
UNION ALL SELECT 'orphan_compat_motor',  count(*) = 0 FROM sya_product_vehicle_compatibility c LEFT JOIN sya_vehicle_motorizations t ON t.id = c.vehicle_motorization_id WHERE c.vehicle_motorization_id IS NOT NULL AND t.id IS NULL
UNION ALL SELECT 'orphan_image_product', count(*) = 0 FROM sya_product_images i LEFT JOIN sya_products p ON p.id = i.product_id WHERE p.id IS NULL
UNION ALL SELECT 'orphan_motor_model',   count(*) = 0 FROM sya_vehicle_motorizations t LEFT JOIN sya_vehicle_models m ON m.id = t.vehicle_model_id WHERE m.id IS NULL
UNION ALL SELECT 'products_without_images', count(*) = {report['products_without_images']} FROM sya_products p WHERE NOT EXISTS (SELECT 1 FROM sya_product_images i WHERE i.product_id = p.id)
UNION ALL SELECT 'datelike_motorisation', count(*) = 0 FROM sya_product_vehicle_compatibility WHERE motorisation ~ '^\\d{{4}}-\\d{{2}}-\\d{{2}}'
UNION ALL SELECT 'price_range',          bool_and(price_tnd BETWEEN 10.40 AND 1885.50) FROM sya_products;
""")
print('\nWROTE import.sql and validation.sql')
