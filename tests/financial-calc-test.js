'use strict';
// =====================================================
// FINANCIAL-CALC — canonical money maths (js/shared/financial-calc.js)
// tests/financial-calc-test.js
//
// The invoice/devis VAT + timbre formula was duplicated in three inline
// copies (invoices.js calcTotals + saveInvoice, devis.js calcDevisTotals).
// It now lives once in MythosFinance.vatTotals. These characterization tests
// pin the exact outputs the stage4m/stage4o DOM tests already rely on
// (ht 100, VAT 10%, timbre 1 -> ttc 111), plus edge cases, so the shared
// function cannot silently drift.
//
// Run with: node tests/financial-calc-test.js
// =====================================================

var fs = require('fs');
var path = require('path');
var vm = require('vm');
var BASE = path.join(__dirname, '..');
var pass = 0, fail = 0;
function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }
function eq(a, b, l) { ok(a === b, l + ' (got ' + JSON.stringify(a) + ')'); }

// Load the module in a bare context, exactly as the browser would.
var ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(BASE, 'js/shared/financial-calc.js'), 'utf8'), ctx);
var F = ctx.MythosFinance;

console.log('\n1. The module exposes the canonical API');
ok(F && typeof F.vatTotals === 'function', 'MythosFinance.vatTotals exists');
ok(typeof F.linesSubtotal === 'function' && typeof F.n === 'function', 'linesSubtotal and n exist');

console.log('\n2. vatTotals — the exact behaviour the stage tests pin');
var t = F.vatTotals(100, 10, 1);
eq(t.ht, 100, 'ht preserved');
eq(t.tvaAmt, 10, 'VAT = ht * rate% (100 * 10% = 10)');
eq(t.timbre, 1, 'timbre preserved');
eq(t.ttc, 111, 'ttc = ht + VAT + timbre = 111');

console.log('\n3. VAT-exempt (rate 0, timbre 0) -> ttc == ht');
var s = F.vatTotals(100, 0, 0);
eq(s.tvaAmt, 0, 'no VAT');
eq(s.ttc, 100, 'ttc equals ht when exempt');

console.log('\n4. Fractional maths (Tunisian 3-decimal money)');
var d = F.vatTotals(250.5, 7, 1);
ok(Math.abs(d.tvaAmt - 17.535) < 1e-9, 'VAT 7% of 250.5 = 17.535');
ok(Math.abs(d.ttc - 269.035) < 1e-9, 'ttc = 250.5 + 17.535 + 1 = 269.035');

console.log('\n5. Robust coercion (empty / non-numeric inputs)');
var z = F.vatTotals('', '', '');
eq(z.ttc, 0, 'empty strings coerce to 0');
var g = F.vatTotals('abc', 'x', 'y');
eq(g.ttc, 0, 'garbage coerces to 0, never NaN');
ok(F.n(NaN) === 0 && F.n(undefined) === 0 && F.n(null) === 0, 'n() maps NaN/undefined/null to 0');

console.log('\n6. linesSubtotal — sum of qty * pu');
eq(F.linesSubtotal([{ qty: 2, pu: 50 }, { qty: 1, pu: 3 }]), 103, '2*50 + 1*3 = 103');
eq(F.linesSubtotal([]), 0, 'empty list -> 0');
eq(F.linesSubtotal(null), 0, 'non-array -> 0, no throw');

console.log('\nFINANCIAL-CALC: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
