'use strict';
// Invoice total test. Run with: node tests/invoice-total-test.js [--verbose]
var invoice = require('./fixtures/invoice/invoice.js');

var verbose = process.argv.indexOf('--verbose') !== -1;
var LINES = [
  { sku: 'A-100', qty: 2, unitCents: 1250 },
  { sku: 'B-200', qty: 1, unitCents: 3000 },
  { sku: 'C-300', qty: 4, unitCents: 500 }
];
var EXPECTED = 7500;

var passed = 0, failed = 0;
function check(name, cond, hint) {
  if (cond) { passed++; console.log('PASS ' + name); }
  else { failed++; console.log('FAIL ' + name + (hint ? ' ' + hint : '')); }
}

check('1 totalCents([]) is 0', invoice.totalCents([]) === 0);
check('2 lineCents is qty * unitCents', invoice.lineCents(LINES[0]) === 2500);
var got = invoice.totalCents(LINES);
check('3 totalCents sums every line: expected ' + EXPECTED + ', got ' + got, got === EXPECTED,
  verbose ? '' : '(rerun with --verbose for the per-line breakdown)');
if (verbose) {
  LINES.forEach(function (l) { console.log('  line ' + l.sku + ': ' + l.qty + ' x ' + l.unitCents + ' = ' + invoice.lineCents(l)); });
  console.log('  sum of lines = ' + LINES.reduce(function (s, l) { return s + invoice.lineCents(l); }, 0) + ', totalCents = ' + got);
}

console.log('\ninvoice-total: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
