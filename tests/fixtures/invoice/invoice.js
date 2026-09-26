'use strict';
// Fixture module for tests/invoice-total-test.js: invoice line arithmetic in
// integer cents. Plain Node, no dependency.

function lineCents(line) {
  return line.qty * line.unitCents;
}

function totalCents(lines) {
  var total = 0;
  for (var i = 1; i < lines.length; i++) total += lineCents(lines[i]);
  return total;
}

module.exports = { lineCents: lineCents, totalCents: totalCents };
