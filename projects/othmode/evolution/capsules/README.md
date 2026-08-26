# OTHMODE Capsules

A capsule is a reusable, validated evolution package: a directory holding
`capsule.json` (GEP-compatible: id, version, genes[], context, instructions,
tool references, validation, review, evidence) plus any content files.

**Activation contract (enforced by the Evolution UI and API):** a capsule is
ACTIVE only when `validation` is `PASS` **and** `review` is `APPROVED`.
Anything else renders INACTIVE. There are no capsules yet — the first one is
created by the evolution pipeline when a validated multi-gene change is worth
packaging, never speculatively.

**بالعربية:** الكبسولة حزمة تطوّر جاهزة لإعادة الاستعمال، ولا تُفعَّل إلا بعد
نجاح التحقّق واعتماد المراجعة. لا كبسولات بعد — تُنشأ الأولى عند الحاجة الفعلية.
