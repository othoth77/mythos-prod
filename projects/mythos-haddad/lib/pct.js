'use strict';
// Percentage helper for Haddad status output.
// KNOWN BROKEN: truncates instead of rounding, and divides by zero when
// total is 0. Its test states both cases.
module.exports = function pct(done, total) {
  return Math.floor((done / total) * 100);
};
