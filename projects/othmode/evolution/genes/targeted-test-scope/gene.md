# Gene: targeted-test-scope (validation-rule v1.0)

**Rule.** For any change: (1) select the targeted suites from the change's
paths (projects/meta/test-impact-map.json is the mapping); (2) establish the
BASELINE failure count before the change — a failure that predates the change
is reported, never blamed on it; (3) run the full suite only when the change
crosses module boundaries or touches shared code; (4) report exact counts.
0 new failures is the regression floor.

**Why.** Full-suite-always wastes cycles and hides which change broke what;
targeted-only without a baseline blames innocent changes for pre-existing
failures. The two together keep validation honest and fast.

**بالعربية:** قبل أي تغيير نقيس خطّ الأساس للاختبارات، ثم نشغّل الاختبارات
المستهدفة أولاً، ولا نشغّل كل الاختبارات إلا عند الحاجة. القاعدة: صفر إخفاقات
جديدة.
