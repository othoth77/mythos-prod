// ══════════════════════════════════════════════════════════════════════
// MYTHOS OS — Form accessibility service (progressive enhancement)
// js/core/services/a11y-forms.js
//
// Closes a WCAG 1.3.1 / 3.3.2 / 4.1.2 gap: across the app, form controls
// carry a *visible* <label> as a sibling inside their .form-group, but the
// label is not programmatically associated (no `for`, not wrapping). A
// screen reader therefore announces the field without its name.
//
// This service associates each visible label with its control at runtime —
// it sets `label.htmlFor` (the label text becomes the control's accessible
// name, the strongest fix) or, when no sibling label exists, falls back to
// the control's own placeholder as an aria-label. It is PURELY ADDITIVE:
// no layout, styling, value, or handler is touched; the only behavioural
// effect is the standard one — clicking a label now focuses its control.
//
// A MutationObserver extends the same treatment to controls rendered later
// by the runtime, so dynamically-built forms are covered too.
// ══════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  var SKIP_INPUT_TYPES = { hidden: 1, submit: 1, button: 1, image: 1 };
  var uid = 0;

  // Controls that carry no visible sibling label and no placeholder — mostly
  // toolbar filters, file inputs and split date pickers. A curated accessible
  // name (French, matching the UI) is applied by id. Extend as forms are added.
  var KNOWN_LABELS = {
    'f-tva': 'TVA (%)', 'f-timbre-amount': 'Timbre fiscal (TND)',
    'dev-tva-percent': 'TVA (%)', 'dev-timbre-amount': 'Timbre fiscal (TND)',
    'rdv-fee-invoice': 'Facture liée', 'rdv-fee-devis': 'Devis lié',
    'rdv-fee-contract': 'Contrat lié',
    'cal-type-filter': 'Filtrer par type', 'cal-collab-filter': 'Filtrer par collaborateur',
    'cal-status-filter': 'Filtrer par statut',
    'bank-import-file': 'Importer un relevé bancaire',
    'rc-file-input': 'Importer un fichier de contacts',
    'backup-file': 'Importer une sauvegarde', 'camera-mobile-input': 'Prendre une photo',
    'rc-table-sort-select': 'Trier les contacts', 'rc-table-filter-select': 'Filtrer les contacts',
    'rc-table-tag-filter': 'Filtrer par étiquette', 'rc-table-responsable-filter': 'Filtrer par responsable',
    'rc-sort-select': 'Trier', 'rc-filter-select': 'Filtrer',
    'rc-tag-filter': 'Filtrer par étiquette', 'rc-responsable-filter': 'Filtrer par responsable',
    'settings-call-script': "Script d'appel",
    'appel-fiche-f-jour': 'Jour', 'appel-fiche-f-mois': 'Mois', 'appel-fiche-f-annee': 'Année'
  };

  function needsName(el) {
    if (el.labels && el.labels.length) return false;          // for= / wrapping label
    if (el.closest('label')) return false;                     // wrapped
    if (el.getAttribute('aria-label') ||
        el.getAttribute('aria-labelledby') ||
        el.getAttribute('title')) return false;
    return true;
  }

  function labelControl(el) {
    if (el.tagName === 'INPUT') {
      var type = (el.getAttribute('type') || 'text').toLowerCase();
      if (SKIP_INPUT_TYPES[type]) return;
    }
    if (!needsName(el)) return;

    // The consistent markup is `.form-group > label + control`; fall back to
    // the immediate parent for the rare control outside a form-group.
    var group = el.closest('.form-group') || el.parentElement;
    var label = group ? group.querySelector('label') : null;

    if (label && !label.htmlFor) {
      if (!el.id) el.id = 'a11y-ctrl-' + (++uid);
      label.htmlFor = el.id;
      return;
    }
    // No free label available — a curated name, then the placeholder.
    if (el.id && KNOWN_LABELS[el.id]) {
      el.setAttribute('aria-label', KNOWN_LABELS[el.id]);
      return;
    }
    var ph = el.getAttribute('placeholder');
    if (ph) el.setAttribute('aria-label', ph);
  }

  function sweep(root) {
    if (!root || !root.querySelectorAll) return;
    var list = root.querySelectorAll('input, select, textarea');
    for (var i = 0; i < list.length; i++) labelControl(list[i]);
  }

  function watch() {
    if (!window.MutationObserver || !document.body) return;
    var obs = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var added = mutations[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var n = added[j];
          if (n.nodeType !== 1) continue;
          if (/^(INPUT|SELECT|TEXTAREA)$/.test(n.tagName)) labelControl(n);
          else sweep(n);
        }
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  function init() { sweep(document); watch(); }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Exposed so a view can re-run it explicitly after a large re-render.
  window.MythosA11yForms = { sweep: function () { sweep(document); } };
})();
