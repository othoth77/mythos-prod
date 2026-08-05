'use strict';
var vm = require('vm');
var fs = require('fs');
var path = require('path');
var BASE = path.join(__dirname, '..');
var pass = 0, fail = 0;

function ok(value, label) {
  if (value) { pass++; console.log('  PASS ' + label); }
  else { fail++; console.log('  FAIL ' + label); }
}

// ── Sandbox helpers (mirrors stage4l-test.js pattern) ───────────────────────
function makeEl(id) {
  return {
    id: id, value: '', innerHTML: '', textContent: '', checked: false, src: '',
    style: {display: ''}, children: [],
    appendChild: function(child) { this.children.push(child); },
    remove: function() { this.removed = true; }
  };
}

function makeSandbox(overrides) {
  var els = {};
  [
    'om-list','om-plaque','om-logo-preview','om-societe-preview','om-chauffeur',
    'om-cin','om-permis','om-edit-id','om-form-title','om-date','om-heure',
    'om-date-arrivee','om-heure-arrivee','om-depart','om-arrivee','om-mission-type',
    'om-mission','om-addStamp','om-persons-body','om-preview','om-preview-modal'
  ].forEach(function(id) { els[id] = makeEl(id); });
  var state = {oms: [], vehicles: [], collabs: [], views: [], alerts: [], sidebar: 0};
  var rows = [];
  var sb = {
    MYTHOS_PRINT_LOGO_SRC: 'mythos.png', SDT_PRINT_LOGO_SRC: 'sdt.png',
    document: {
      getElementById: function(id) { return els[id] || null; },
      querySelectorAll: function(sel) { return sel === '#om-persons-body tr' ? rows : []; },
      createElement: function() {
        var row = makeEl('');
        row.querySelector = function(sel) { return sel === 'input' ? {value: row.personName || ''} : null; };
        rows.push(row);
        return row;
      }
    },
    STORE: {
      oms: function() { return state.oms; }, saveOms: function(v) { state.oms = v; },
      vehicules: function() { return state.vehicles; }, saveVehicules: function(v) { state.vehicles = v; },
      collabs: function() { return state.collabs; }, saveCollabs: function(v) { state.collabs = v; }
    },
    _els: els, _rows: rows, _state: state,
    esc: function(v) { return String(v == null ? '' : v).replace(/</g, '&lt;'); },
    cleanPrintText: function(v) { return String(v || ''); },
    formatDateLong: function(v) { return 'LONG:' + String(v || ''); },
    todayStr: function() { return '2026-08-05'; },
    dateInputValue: function(offset) { return 'DATE:' + offset; },
    getStampSVG: function() { return 'stamp.svg'; },
    showView: function(v) { state.views.push(v); },
    updateSidebarStats: function() { state.sidebar++; },
    alert: function(v) { state.alerts.push(v); },
    confirm: function() { return true; },
    prompt: function() { return null; },
    console: {log: function() {}, warn: function() {}, error: function() {}},
    Date: Date, Array: Array, Object: Object, String: String, Number: Number,
    Math: Math, parseInt: parseInt, setTimeout: function() {}
  };
  Object.assign(sb, overrides || {});
  return vm.createContext(sb);
}

function load(sb, file) {
  vm.runInContext(fs.readFileSync(path.join(BASE, file), 'utf8'), sb);
}

// ── Read source files ────────────────────────────────────────────────────────
var app = fs.readFileSync(path.join(BASE, 'js/app.js'), 'utf8');
var moSrc = fs.readFileSync(path.join(BASE, 'js/shared/mission-orders.js'), 'utf8');
var index = fs.readFileSync(path.join(BASE, 'index.html'), 'utf8');

// ── 1. Structural: deleted duplicates absent from app.js ─────────────────────
console.log('\n1. Structural: deleted duplicates absent from app.js');
['populateOmList','addOmPerson','editOm','deleteOm','cancelOM'].forEach(function(n) {
  ok(app.indexOf('function ' + n + '(') < 0, n + ' removed from app.js (Stage 4AG)');
});

// ── 2. Structural: canonical OM functions present in mission-orders.js ────────
console.log('\n2. Structural: canonical OM functions in mission-orders.js');
['renderOMList','addOmPerson','editOM','deleteOM','cancelOM'].forEach(function(n) {
  ok(moSrc.indexOf('function ' + n + '(') >= 0, n + ' canonical in mission-orders.js');
});

// ── 3. Structural: blocked invoice functions remain in app.js ─────────────────
console.log('\n3. Structural: blocked invoice functions remain in app.js (BLOCKED pending stableLineCount fix)');
['editInvoice','deleteInvoice','populateInvoiceList'].forEach(function(n) {
  ok(app.indexOf('function ' + n + '(') >= 0, n + ' still in app.js (BLOCKED)');
});

// ── 4. Structural: removePersonRow still in app.js ────────────────────────────
console.log('\n4. Structural: removePersonRow preserved in app.js');
ok(app.indexOf('function removePersonRow(') >= 0, 'removePersonRow still in app.js');

// ── 5. Structural: index.html loading order ───────────────────────────────────
console.log('\n5. Structural: index.html script loading order');
var appPos = index.indexOf('js/app.js');
var moPos = index.indexOf('js/shared/mission-orders.js');
ok(appPos >= 0, 'app.js present in index.html');
ok(moPos >= 0, 'mission-orders.js present in index.html');
ok(appPos < moPos, 'app.js loaded before mission-orders.js');
ok((index.match(/js\/shared\/mission-orders\.js/g) || []).length === 1, 'mission-orders.js script tag present exactly once');
ok(index.indexOf('js/app-fresh.js') < 0, 'app-fresh.js NOT referenced in index.html (dead file)');

// ── 6. Syntax checks ─────────────────────────────────────────────────────────
console.log('\n6. Syntax checks');
var cp = require('child_process');
ok(cp.spawnSync(process.execPath, ['-c', 'js/app.js'], {cwd: BASE}).status === 0, 'app.js passes node -c');
ok(cp.spawnSync(process.execPath, ['-c', 'js/shared/invoices.js'], {cwd: BASE}).status === 0, 'invoices.js passes node -c');
ok(cp.spawnSync(process.execPath, ['-c', 'js/shared/mission-orders.js'], {cwd: BASE}).status === 0, 'mission-orders.js passes node -c');

// ── 7. Behavioral: addOmPerson accepts a name argument ───────────────────────
console.log('\n7. Behavioral: addOmPerson accepts a name argument');
var s7 = makeSandbox(); load(s7, 'js/shared/mission-orders.js');
vm.runInContext('stableOmPersonCount=0', s7); s7._rows.length = 0;
s7.addOmPerson('Karim Ben Ali');
ok(vm.runInContext('stableOmPersonCount', s7) === 1, 'addOmPerson increments person counter');
ok(s7._els['om-persons-body'].children.length === 1, 'addOmPerson appends a row to persons body');
// Row should encode the name
var addedRow = s7._els['om-persons-body'].children[0];
ok(addedRow !== undefined, 'addOmPerson created a row element');

// ── 8. Behavioral: editOM in mission-orders.js loads OM data ─────────────────
console.log('\n8. Behavioral: editOM loads OM data correctly');
var s8 = makeSandbox(); load(s8, 'js/shared/mission-orders.js');
s8._state.oms = [{id:'om-1', plaque:'P1', chauffeur:'Ali', cin:'111', permis:'222',
  date:'2026-08-01', heure:'09:00', dateArrivee:'', heureArrivee:'',
  depart:'Tunis', arrivee:'Sousse', missionType:'aller_retour',
  mission:'Transport aller-retour', addStamp:true, persons:[{nom:'Person A'}]}];
s8._state.vehicles = [{plaque:'P1', societe:'mythos', chauffeur:'Ali', cin:'111', permis:'222'}];
s8.editOM('om-1');
ok(s8._state.views[s8._state.views.length-1] === 'om-new', 'editOM navigates to om-new view');
ok(s8._els['om-edit-id'].value === 'om-1', 'editOM sets edit id');
ok(s8._els['om-chauffeur'].value === 'Ali', 'editOM populates chauffeur');
ok(s8._els['om-depart'].value === 'Tunis', 'editOM populates depart');
ok(s8._els['om-arrivee'].value === 'Sousse', 'editOM populates arrivee');

// ── 9. Behavioral: deleteOM removes the correct OM ────────────────────────────
console.log('\n9. Behavioral: deleteOM removes the correct OM');
var s9 = makeSandbox(); load(s9, 'js/shared/mission-orders.js');
s9._state.oms = [{id:'keep-me', date:'2026-08-01', depart:'A', arrivee:'B', persons:[]},
                 {id:'del-me', date:'2026-08-02', depart:'C', arrivee:'D', persons:[]}];
s9.deleteOM('del-me');
ok(s9._state.oms.length === 1, 'deleteOM reduces OM count by one');
ok(s9._state.oms[0].id === 'keep-me', 'deleteOM removes the correct OM');
ok(s9._state.sidebar === 1, 'deleteOM refreshes sidebar stats');

// ── 10. Behavioral: cancelOM calls showView(om-list) ─────────────────────────
console.log('\n10. Behavioral: cancelOM calls showView');
var s10 = makeSandbox(); load(s10, 'js/shared/mission-orders.js');
s10.cancelOM();
ok(s10._state.views[s10._state.views.length-1] === 'om-list', 'cancelOM navigates to om-list');

// ── 11. Behavioral: renderOMList resolves correctly ───────────────────────────
console.log('\n11. Behavioral: renderOMList resolves correctly');
var s11 = makeSandbox(); load(s11, 'js/shared/mission-orders.js');
s11.renderOMList();
ok(s11._els['om-list'].innerHTML.indexOf('Aucun') >= 0, 'renderOMList shows empty state when no OMs');
s11._state.oms = [{id:'o1', date:'2026-08-01', heure:'10:00', depart:'Tunis', arrivee:'Sfax', persons:[{nom:'A'},{nom:'B'}]}];
s11.renderOMList();
ok(s11._els['om-list'].innerHTML.indexOf('Tunis') >= 0, 'renderOMList renders OM departure');
ok(s11._els['om-list'].innerHTML.indexOf('Nombre de personnes : 2') >= 0, 'renderOMList renders person count');

// ── 12. Stage 4Z regression ───────────────────────────────────────────────────
console.log('\n12. Stage 4Z regression');
ok(app.indexOf('function editInvoice(') >= 0, 'editInvoice still present in app.js (BLOCKED)');
ok(app.indexOf('function deleteInvoice(') >= 0, 'deleteInvoice still present in app.js (BLOCKED)');
ok(app.indexOf('function cancelOM(') < 0, 'cancelOM absent from app.js');
ok(app.indexOf('function editOm(') < 0, 'editOm absent from app.js');
ok(app.indexOf('function deleteOm(') < 0, 'deleteOm absent from app.js');

console.log('\nStage 4AG: ' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
process.exit(0);
