'use strict';
// =====================================================
// A11Y-FORMS — form-control accessible names (WCAG 1.3.1 / 3.3.2 / 4.1.2)
// tests/a11y-forms-test.js
//
// The app's form controls carried visible <label>s that were not
// programmatically associated (no `for`, not wrapping), so a screen reader
// announced fields without their names. js/core/services/a11y-forms.js
// associates each visible label with its control at runtime, with a curated
// name map and a placeholder fallback for the few controls that have no
// sibling label. Browser audit (headless Chromium) confirmed 183/183 controls
// gain an accessible name; this test guards the mechanism at the source level.
//
// Run with: node tests/a11y-forms-test.js
// =====================================================

var fs = require('fs');
var path = require('path');
var BASE = path.join(__dirname, '..');
var pass = 0, fail = 0;
function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }

var svcPath = path.join(BASE, 'js', 'core', 'services', 'a11y-forms.js');
ok(fs.existsSync(svcPath), 'the form-accessibility service exists');
var svc = fs.readFileSync(svcPath, 'utf8');

console.log('\n1. The labeller associates visible labels with controls');
ok(/label\.htmlFor\s*=\s*el\.id/.test(svc), 'it sets label.htmlFor to associate the visible label');
ok(/el\.labels\s*&&\s*el\.labels\.length/.test(svc), 'it skips controls that already have an accessible name');
ok(/closest\('label'\)/.test(svc), 'it recognises wrapping labels');
ok(/getAttribute\('placeholder'\)/.test(svc) && /setAttribute\('aria-label'/.test(svc),
   'it falls back to the placeholder as an aria-label');

console.log('\n2. Curated names cover the label-less controls');
ok(/KNOWN_LABELS/.test(svc), 'a curated id -> name map exists for filters/file-inputs/date-parts');
['cal-type-filter', 'bank-import-file', 'appel-fiche-f-jour', 'rc-table-sort-select'].forEach(function (id) {
  ok(new RegExp("'" + id + "'\\s*:").test(svc), 'KNOWN_LABELS covers ' + id);
});

console.log('\n3. Dynamically-rendered controls are covered too');
ok(/MutationObserver/.test(svc), 'a MutationObserver labels controls added after load');

console.log('\n4. The service is registered in the app shell');
var html = fs.readFileSync(path.join(BASE, 'index.html'), 'utf8');
ok(/<script src="js\/core\/services\/a11y-forms\.js/.test(html), 'index.html loads the service');
ok(html.indexOf('js/core/services/a11y-forms.js') > html.indexOf('js/core/services/dialogs.js'),
   'it loads within the core services block');

console.log('\n5. The one id-less filter carries an explicit aria-label');
ok(/<select class="cal-filter" aria-label="[^"]+" onchange="setComptaExpenseFilter/.test(html),
   'the compta expense filter has an accessible name in markup');

console.log('\nA11Y-FORMS: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
