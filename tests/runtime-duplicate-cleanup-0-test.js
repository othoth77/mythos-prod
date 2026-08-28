'use strict';
// RUNTIME-DUPLICATE-CLEANUP-0 — Canonical runtime function ownership regression.
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var cp = require('child_process');
var BASE = path.join(__dirname, '..');
var pass = 0, fail = 0;

function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }

function countFunctionDefs(src, name) {
  // Counts real function declarations only; a leading '//' on the same
  // line before the match is treated as a comment, not a definition.
  var re = new RegExp('function\\s+' + name + '\\s*\\(', 'g');
  var count = 0, m;
  while ((m = re.exec(src)) !== null) {
    var lineStart = src.lastIndexOf('\n', m.index) + 1;
    var linePrefix = src.slice(lineStart, m.index);
    if (linePrefix.trim().indexOf('//') === 0) continue;
    count++;
  }
  return count;
}

var app = fs.readFileSync(path.join(BASE, 'js/app.js'), 'utf8');
var invoicesSrc = fs.readFileSync(path.join(BASE, 'js/shared/invoices.js'), 'utf8');
var moSrc = fs.readFileSync(path.join(BASE, 'js/shared/mission-orders.js'), 'utf8');
var index = fs.readFileSync(path.join(BASE, 'index.html'), 'utf8');
var appFreshPath = path.join(BASE, 'js/app-fresh.js');

console.log('\n1-4. Invoice ownership: exactly one behavioral owner, and it is js/shared/invoices.js');
ok(countFunctionDefs(app, 'editInvoice') === 0, 'app.js has zero editInvoice definitions');
ok(countFunctionDefs(app, 'deleteInvoice') === 0, 'app.js has zero deleteInvoice definitions');
ok(countFunctionDefs(invoicesSrc, 'editInvoice') === 1, 'invoices.js has exactly one editInvoice definition');
ok(countFunctionDefs(invoicesSrc, 'deleteInvoice') === 1, 'invoices.js has exactly one deleteInvoice definition');
ok(countFunctionDefs(app, 'addLine') === 0, 'app.js has zero addLine definitions (the dead "Fonctionnalité en développement" stub is removed)');
ok(countFunctionDefs(invoicesSrc, 'addLine') === 1, 'invoices.js has exactly one addLine definition');

console.log('\n5-6. Mission-order ownership: canonical in mission-orders.js');
ok(countFunctionDefs(app, 'addOmPerson') === 0, 'app.js has zero addOmPerson definitions');
ok(countFunctionDefs(app, 'cancelOM') === 0, 'app.js has zero cancelOM definitions');
ok(countFunctionDefs(moSrc, 'addOmPerson') === 1, 'mission-orders.js has exactly one addOmPerson definition');
ok(countFunctionDefs(moSrc, 'cancelOM') === 1, 'mission-orders.js has exactly one cancelOM definition');

console.log('\n7. Comments do not count as active definitions');
ok(app.indexOf('editInvoice, deleteInvoice') >= 0, 'app.js carries an ownership comment, not a reimplementation');
ok(countFunctionDefs('// function editInvoice(fake) {}', 'editInvoice') === 0, 'countFunctionDefs ignores commented-out definitions (self-check)');

console.log('\n8. Inactive app-fresh.js is excluded from active-runtime uniqueness (only if not loaded)');
var appFreshLoaded = index.indexOf('js/app-fresh.js') >= 0;
ok(appFreshLoaded === false, 'app-fresh.js is not referenced by index.html (dead file)');
if (!appFreshLoaded && fs.existsSync(appFreshPath)) {
  console.log('  INFO app-fresh.js exists on disk but is inactive — correctly excluded from ownership checks');
}

console.log('\n9. index.html loads the canonical shared modules, in the order the runtime depends on');
var appPos = index.indexOf('js/app.js');
var moPos = index.indexOf('js/shared/mission-orders.js');
var invPos = index.indexOf('js/shared/invoices.js');
ok(appPos >= 0 && moPos >= 0 && invPos >= 0, 'app.js, mission-orders.js, and invoices.js are all referenced in index.html');
ok(appPos < moPos && moPos < invPos, 'load order is app.js -> mission-orders.js -> invoices.js, matching declared dependency');
ok((index.match(/js\/shared\/invoices\.js/g) || []).length === 1, 'invoices.js script tag present exactly once');
ok((index.match(/js\/shared\/mission-orders\.js/g) || []).length === 1, 'mission-orders.js script tag present exactly once');

console.log('\n10. Stage 4Z no longer requires legacy app.js invoice duplicates');
var stage4z = fs.readFileSync(path.join(BASE, 'tests/stage4z-test.js'), 'utf8');
ok(stage4z.indexOf("'editInvoice','deleteInvoice',\n 'initApp'") < 0, 'Stage 4Z no longer lists editInvoice/deleteInvoice as required in app.js');
ok(stage4z.indexOf('RUNTIME-DUPLICATE-CLEANUP-0') >= 0, 'Stage 4Z carries the RUNTIME-DUPLICATE-CLEANUP-0 correction marker');

console.log('\n11. Root-cause regression: mission-orders.js + invoices.js load together in one shared global scope');
// This is the actual bug this stage fixes: a stray `let stableLineCount = 0;`
// in mission-orders.js collided with `var stableLineCount = 0;` in invoices.js,
// throwing a SyntaxError that silently discarded the entire invoices.js script
// at runtime (app.js -> mission-orders.js -> invoices.js share one global
// lexical scope in the browser: classic scripts, no `defer`, no modules).
// Static string checks above cannot catch this class of bug; only actually
// loading both files into one shared context can.
ok(moSrc.indexOf('let stableLineCount') < 0, 'mission-orders.js no longer declares the stray stableLineCount');
(function () {
  function stub() {}
  var elStub = { value: '', innerHTML: '', style: {}, checked: false, classList: { add: stub, remove: stub }, appendChild: stub, children: [] };
  var sandbox = {
    document: {
      getElementById: function () { return elStub; },
      querySelectorAll: function () { return []; },
      createElement: function () { return Object.assign({}, elStub); }
    },
    STORE: { invoices: function () { return []; }, oms: function () { return []; }, saveInvoices: stub, saveOms: stub },
    MYTHOS_PRINT_LOGO_SRC: 'x', SDT_PRINT_LOGO_SRC: 'y',
    esc: function (v) { return String(v); }, showView: stub, updateSidebarStats: stub,
    todayStr: function () { return '2026-08-08'; }, dateInputValue: function () { return ''; },
    console: { log: stub, warn: stub, error: stub },
    Date: Date, Array: Array, Object: Object, String: String, Number: Number, Math: Math,
    parseInt: parseInt, setTimeout: stub, alert: stub, confirm: function () { return true; }, prompt: function () { return null; }
  };
  var ctx = vm.createContext(sandbox);
  try {
    vm.runInContext(moSrc, ctx, { filename: 'js/shared/mission-orders.js' });
    vm.runInContext(invoicesSrc, ctx, { filename: 'js/shared/invoices.js' });
    ok(true, 'mission-orders.js and invoices.js load together without a redeclaration collision');
    ok(typeof vm.runInContext('editInvoice', ctx) === 'function', 'editInvoice is defined and callable after shared-context load');
    ok(typeof vm.runInContext('addOmPerson', ctx) === 'function', 'addOmPerson is defined and callable after shared-context load');
  } catch (e) {
    ok(false, 'mission-orders.js and invoices.js load together without a redeclaration collision (' + e.name + ': ' + e.message + ')');
  }
})();

console.log('\n12. Syntax checks');
ok(cp.spawnSync(process.execPath, ['-c', 'js/app.js'], { cwd: BASE }).status === 0, 'app.js passes node -c');
ok(cp.spawnSync(process.execPath, ['-c', 'js/shared/invoices.js'], { cwd: BASE }).status === 0, 'invoices.js passes node -c');
ok(cp.spawnSync(process.execPath, ['-c', 'js/shared/mission-orders.js'], { cwd: BASE }).status === 0, 'mission-orders.js passes node -c');

console.log('\nRUNTIME-DUPLICATE-CLEANUP-0: ' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
process.exit(0);
