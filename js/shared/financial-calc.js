// ══════════════════════════════════════════════════════════════════════
// MYTHOS OS — Canonical financial calculations
// js/shared/financial-calc.js
//
// Single source of truth for the money maths that was duplicated across the
// invoice and devis modules (each computed VAT and the Tunisian timbre
// fiscal inline, three copies of the same formula). Pure functions, no DOM,
// unit-tested — mirroring the existing pure `contractTotals()` convention in
// js/shared/contracts.js.
//
// Behaviour is preserved exactly: callers still read their own inputs from
// the DOM (including their own empty-field defaults) and pass resolved
// numbers here; this module only does the arithmetic.
// ══════════════════════════════════════════════════════════════════════

(function (global) {
  'use strict';

  function n(v) {
    var x = parseFloat(v);
    return isNaN(x) ? 0 : x;
  }

  // Invoice / devis totals (Tunisian VAT + timbre fiscal):
  //   tvaAmt = ht * tvaRate% ; ttc = ht + tvaAmt + timbre
  // The caller resolves VAT-exempt / empty-field cases and passes the final
  // numbers (e.g. rate 0 and timbre 0 for a "sans TVA" invoice).
  function vatTotals(ht, tvaRatePct, timbre) {
    ht = n(ht);
    var rate = n(tvaRatePct);
    var stamp = n(timbre);
    var tvaAmt = ht * rate / 100;
    return {
      ht: ht,
      tvaRate: rate,
      tvaAmt: tvaAmt,
      timbre: stamp,
      ttc: ht + tvaAmt + stamp
    };
  }

  // Sum of a document's per-line amounts (qty * unit price).
  function linesSubtotal(lines) {
    if (!Array.isArray(lines)) return 0;
    return lines.reduce(function (sum, l) {
      return sum + n(l && l.qty) * n(l && l.pu);
    }, 0);
  }

  global.MythosFinance = {
    n: n,
    vatTotals: vatTotals,
    linesSubtotal: linesSubtotal
  };
})(typeof window !== 'undefined' ? window : this);
