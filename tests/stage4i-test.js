// =====================================================
// MYTHOS OS — Stage 4I Test
// tests/stage4i-test.js
//
// Verifies Fournisseurs CRUD globals extracted into
// js/shared/fournisseurs.js behave identically to the
// original app.js implementation.
//
// Run with: node tests/stage4i-test.js
// =====================================================
'use strict';

var vm   = require('vm');
var fs   = require('fs');
var path = require('path');

var BASE  = path.join(__dirname, '..');
var _pass = 0, _fail = 0;

function ok(cond, label) {
  if (cond) { _pass++; console.log('  PASS ' + label); }
  else       { _fail++; console.log('  FAIL ' + label); }
}
function section(title) { console.log('\n' + title); }

function makeEl(id) {
  return {
    id: id, innerHTML: '', textContent: '', value: '',
    style: { display: '' },
    classList: { _c:[], add:function(c){if(this._c.indexOf(c)<0)this._c.push(c);}, remove:function(c){var i=this._c.indexOf(c);if(i>=0)this._c.splice(i,1);}, contains:function(c){return this._c.indexOf(c)>=0;} }
  };
}

function makeSandbox(overrides) {
  var els = {};
  var noop = function() {};
  function getEl(id) { return els[id] || null; }
  function ensureEl(id) { if (!els[id]) els[id] = makeEl(id); return els[id]; }

  [
    'fournisseurs-list',
    'fournisseur-modal',
    'fournisseur-edit-id',
    'fournisseur-nom', 'fournisseur-contact', 'fournisseur-immatricule',
    'fournisseur-adresse', 'fournisseur-specialite', 'fournisseur-notes',
    'fournisseur-search', 'fournisseur-filter-category'
  ].forEach(ensureEl);

  var sb = {
    document: {
      getElementById: function(id) { return getEl(id) || null; },
      querySelectorAll: function() { return []; },
      body: { appendChild: noop }, addEventListener: noop
    },
    window: { addEventListener: noop },
    location: { hash: '' },
    _els: els,
    console: { log: noop, warn: noop, error: noop },
    confirm: function() { return true; },
    alert:   noop,

    // Utils (from utils.js)
    esc: function(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); },

    // Default STORE
    STORE: {
      suppliers:     function() { return []; },
      saveSuppliers: function(d) { this._suppliers = d; },
      _suppliers: []
    },

    // JS globals
    Array:Array, Object:Object, String:String, Number:Number,
    Boolean:Boolean, Math:Math, JSON:JSON, Date:Date,
    Set:Set, Map:Map, Promise:Promise,
    Infinity:Infinity, undefined:undefined, parseFloat:parseFloat
  };

  Object.assign(sb, overrides || {});
  return vm.createContext(sb);
}

function load(sb, rel) {
  vm.runInContext(fs.readFileSync(path.join(BASE, rel), 'utf8'), sb);
}

// ═════════════════════════════════════════════════════════════════════
// SECTION 1: Globals exported by js/shared/fournisseurs.js
// ═════════════════════════════════════════════════════════════════════
section('1. Globals exported by js/shared/fournisseurs.js');

var sb1 = makeSandbox();
load(sb1, 'js/shared/fournisseurs.js');

ok(typeof sb1.fournisseurFilterCategory !== 'undefined', 'fournisseurFilterCategory is defined');
ok(sb1.fournisseurFilterCategory === 'all',              'fournisseurFilterCategory initial value is "all"');
ok(typeof sb1.fournisseurSearchQuery !== 'undefined',    'fournisseurSearchQuery is defined');
ok(sb1.fournisseurSearchQuery === '',                    'fournisseurSearchQuery initial value is ""');
ok(typeof sb1.renderFournisseurs === 'function',         'renderFournisseurs is a function');
ok(typeof sb1.getFournisseurCategoryStyle === 'function','getFournisseurCategoryStyle is a function');
ok(typeof sb1.getFournisseurCategoryIcon === 'function', 'getFournisseurCategoryIcon is a function');
ok(typeof sb1.setFournisseurSearch === 'function',       'setFournisseurSearch is a function');
ok(typeof sb1.setFournisseurFilterCategory === 'function','setFournisseurFilterCategory is a function');
ok(typeof sb1.resetFournisseurFilters === 'function',    'resetFournisseurFilters is a function');
ok(typeof sb1.openFournisseurModal === 'function',       'openFournisseurModal is a function');
ok(typeof sb1.closeFournisseurModal === 'function',      'closeFournisseurModal is a function');
ok(typeof sb1.saveFournisseur === 'function',            'saveFournisseur is a function');
ok(typeof sb1.deleteFournisseur === 'function',          'deleteFournisseur is a function');

// ═════════════════════════════════════════════════════════════════════
// SECTION 2: getFournisseurCategoryStyle
// ═════════════════════════════════════════════════════════════════════
section('2. getFournisseurCategoryStyle');

var sb2 = makeSandbox();
load(sb2, 'js/shared/fournisseurs.js');
var style2 = vm.runInContext("getFournisseurCategoryStyle('Logistique')", sb2);
ok(style2 && style2.icon === '🚚',                  'Logistique returns correct icon');
ok(style2 && typeof style2.color === 'string',       'Logistique returns a color string');
var styleUnknown = vm.runInContext("getFournisseurCategoryStyle('Inconnu')", sb2);
ok(styleUnknown && styleUnknown.icon === '📦',       'Unknown category returns default icon');

// ═════════════════════════════════════════════════════════════════════
// SECTION 3: getFournisseurCategoryIcon
// ═════════════════════════════════════════════════════════════════════
section('3. getFournisseurCategoryIcon');

var sb3 = makeSandbox();
load(sb3, 'js/shared/fournisseurs.js');
ok(vm.runInContext("getFournisseurCategoryIcon('Services')", sb3) === '💼',
  'getFournisseurCategoryIcon returns icon string for known category');
ok(vm.runInContext("getFournisseurCategoryIcon('Xyz')", sb3) === '📦',
  'getFournisseurCategoryIcon returns default for unknown category');

// ═════════════════════════════════════════════════════════════════════
// SECTION 4: renderFournisseurs — empty STORE
// ═════════════════════════════════════════════════════════════════════
section('4. renderFournisseurs — empty STORE');

var sb4 = makeSandbox();
load(sb4, 'js/shared/fournisseurs.js');
var threw4 = false;
try { vm.runInContext('renderFournisseurs()', sb4); } catch(e) { threw4=true; console.log('  ERROR: '+e.message); }
ok(!threw4, 'renderFournisseurs() with empty store does not throw');
ok(sb4._els['fournisseurs-list'].innerHTML.indexOf('Aucun') !== -1,
  'renderFournisseurs() shows empty-state with no fournisseurs');

// ═════════════════════════════════════════════════════════════════════
// SECTION 5: renderFournisseurs — with data
// ═════════════════════════════════════════════════════════════════════
section('5. renderFournisseurs — with data');

var sb5 = makeSandbox({
  STORE: {
    suppliers: function(){ return [
      { id:'f1', name:'Acme SARL', contact:'Ali', addr:'Tunis', category:'Logistique', notes:'' }
    ]; },
    saveSuppliers: function(d){ this._s=d; }
  }
});
load(sb5, 'js/shared/fournisseurs.js');
var threw5 = false;
try { vm.runInContext('renderFournisseurs()', sb5); } catch(e) { threw5=true; console.log('  ERROR 5: '+e.message); }
ok(!threw5, 'renderFournisseurs() with data does not throw');
ok(sb5._els['fournisseurs-list'].innerHTML.indexOf('Acme SARL') !== -1,
  'renderFournisseurs() renders supplier name');
ok(sb5._els['fournisseurs-list'].innerHTML.indexOf('table') !== -1,
  'renderFournisseurs() renders a table');

// ═════════════════════════════════════════════════════════════════════
// SECTION 6: renderFournisseurs — filter by search query
// ═════════════════════════════════════════════════════════════════════
section('6. renderFournisseurs — filter by search query');

var sb6 = makeSandbox({
  STORE: {
    suppliers: function(){ return [
      { id:'f1', name:'Alpha Corp', contact:'',   addr:'', category:'', notes:'' },
      { id:'f2', name:'Beta Ltd',   contact:'',   addr:'', category:'', notes:'' }
    ]; },
    saveSuppliers: function(d){ this._s=d; }
  }
});
load(sb6, 'js/shared/fournisseurs.js');
vm.runInContext("fournisseurSearchQuery = 'alpha'", sb6);
vm.runInContext('renderFournisseurs()', sb6);
ok(sb6._els['fournisseurs-list'].innerHTML.indexOf('Alpha Corp') !== -1,
  'renderFournisseurs() shows matching result');
ok(sb6._els['fournisseurs-list'].innerHTML.indexOf('Beta Ltd') === -1,
  'renderFournisseurs() hides non-matching result');

// ═════════════════════════════════════════════════════════════════════
// SECTION 7: renderFournisseurs — filter by category
// ═════════════════════════════════════════════════════════════════════
section('7. renderFournisseurs — filter by category');

var sb7 = makeSandbox({
  STORE: {
    suppliers: function(){ return [
      { id:'f1', name:'GazCo', contact:'', addr:'', category:'Gasoil', notes:'' },
      { id:'f2', name:'TechSA', contact:'', addr:'', category:'Services', notes:'' }
    ]; },
    saveSuppliers: function(d){ this._s=d; }
  }
});
load(sb7, 'js/shared/fournisseurs.js');
vm.runInContext("fournisseurFilterCategory = 'Gasoil'", sb7);
vm.runInContext('renderFournisseurs()', sb7);
ok(sb7._els['fournisseurs-list'].innerHTML.indexOf('GazCo') !== -1,
  'renderFournisseurs() shows category-matching result');
ok(sb7._els['fournisseurs-list'].innerHTML.indexOf('TechSA') === -1,
  'renderFournisseurs() hides non-matching category');

// ═════════════════════════════════════════════════════════════════════
// SECTION 8: setFournisseurSearch
// ═════════════════════════════════════════════════════════════════════
section('8. setFournisseurSearch');

var sb8 = makeSandbox();
load(sb8, 'js/shared/fournisseurs.js');
var threw8 = false;
try { vm.runInContext("setFournisseurSearch('test')", sb8); } catch(e) { threw8=true; }
ok(!threw8, 'setFournisseurSearch() does not throw');
ok(vm.runInContext('fournisseurSearchQuery', sb8) === 'test',
  'setFournisseurSearch() sets fournisseurSearchQuery');

// ═════════════════════════════════════════════════════════════════════
// SECTION 9: setFournisseurFilterCategory
// ═════════════════════════════════════════════════════════════════════
section('9. setFournisseurFilterCategory');

var sb9 = makeSandbox();
load(sb9, 'js/shared/fournisseurs.js');
vm.runInContext("setFournisseurFilterCategory('Banque')", sb9);
ok(vm.runInContext('fournisseurFilterCategory', sb9) === 'Banque',
  'setFournisseurFilterCategory() sets fournisseurFilterCategory');

// ═════════════════════════════════════════════════════════════════════
// SECTION 10: resetFournisseurFilters
// ═════════════════════════════════════════════════════════════════════
section('10. resetFournisseurFilters');

var sb10 = makeSandbox();
load(sb10, 'js/shared/fournisseurs.js');
vm.runInContext("fournisseurSearchQuery = 'xyz'", sb10);
vm.runInContext("fournisseurFilterCategory = 'Banque'", sb10);
vm.runInContext('resetFournisseurFilters()', sb10);
ok(vm.runInContext('fournisseurSearchQuery', sb10) === '',
  'resetFournisseurFilters() resets search query');
ok(vm.runInContext('fournisseurFilterCategory', sb10) === 'all',
  'resetFournisseurFilters() resets filter category');
ok(sb10._els['fournisseur-search'].value === '',
  'resetFournisseurFilters() resets search input element');
ok(sb10._els['fournisseur-filter-category'].value === 'all',
  'resetFournisseurFilters() resets category select element');

// ═════════════════════════════════════════════════════════════════════
// SECTION 11: openFournisseurModal — missing modal (DOM safety)
// ═════════════════════════════════════════════════════════════════════
section('11. openFournisseurModal — missing modal DOM safety');

var sb11 = makeSandbox();
// Remove fournisseur-modal from the context so getElementById returns null
sb11.document.getElementById = function(id) { return id === 'fournisseur-modal' ? null : sb11._els[id] || null; };
load(sb11, 'js/shared/fournisseurs.js');
var threw11 = false;
try { vm.runInContext("openFournisseurModal('')", sb11); } catch(e) { threw11=true; console.log('  ERROR 11: '+e.message); }
ok(!threw11, 'openFournisseurModal() handles missing modal without throwing');

// ═════════════════════════════════════════════════════════════════════
// SECTION 12: openFournisseurModal — new fournisseur
// ═════════════════════════════════════════════════════════════════════
section('12. openFournisseurModal — new fournisseur');

var sb12 = makeSandbox();
load(sb12, 'js/shared/fournisseurs.js');
vm.runInContext("openFournisseurModal('')", sb12);
ok(sb12._els['fournisseur-modal'].style.display === 'flex', 'openFournisseurModal() sets display flex');
ok(sb12._els['fournisseur-edit-id'].value === '',           'fournisseur-edit-id cleared for new');
ok(sb12._els['fournisseur-nom'].value === '',               'fournisseur-nom cleared for new');

// ═════════════════════════════════════════════════════════════════════
// SECTION 13: openFournisseurModal — edit existing
// ═════════════════════════════════════════════════════════════════════
section('13. openFournisseurModal — edit existing');

var sb13 = makeSandbox({
  STORE: {
    suppliers: function(){ return [
      { id:'f1', name:'Omega', contact:'Bob', immatricule:'IM01', addr:'Sfax', category:'Services', notes:'Note' }
    ]; },
    saveSuppliers: function(d){ this._s=d; }
  }
});
load(sb13, 'js/shared/fournisseurs.js');
vm.runInContext("openFournisseurModal('f1')", sb13);
ok(sb13._els['fournisseur-edit-id'].value === 'f1',      'fournisseur-edit-id populated');
ok(sb13._els['fournisseur-nom'].value === 'Omega',       'fournisseur-nom populated');
ok(sb13._els['fournisseur-contact'].value === 'Bob',     'fournisseur-contact populated');
ok(sb13._els['fournisseur-specialite'].value === 'Services', 'fournisseur-specialite populated');

// ═════════════════════════════════════════════════════════════════════
// SECTION 14: closeFournisseurModal
// ═════════════════════════════════════════════════════════════════════
section('14. closeFournisseurModal');

var sb14 = makeSandbox();
load(sb14, 'js/shared/fournisseurs.js');
vm.runInContext("openFournisseurModal('')", sb14);
vm.runInContext('closeFournisseurModal()', sb14);
ok(sb14._els['fournisseur-modal'].style.display === 'none', 'closeFournisseurModal() sets display none');

// ═════════════════════════════════════════════════════════════════════
// SECTION 15: saveFournisseur — name validation guard
// ═════════════════════════════════════════════════════════════════════
section('15. saveFournisseur — empty name validation');

var saved15 = [];
var sb15 = makeSandbox({
  STORE: {
    suppliers: function(){ return saved15.slice(); },
    saveSuppliers: function(d){ saved15=d; }
  }
});
load(sb15, 'js/shared/fournisseurs.js');
sb15._els['fournisseur-edit-id'].value = '';
sb15._els['fournisseur-nom'].value = '';  // empty name
sb15._els['fournisseur-contact'].value = '';
sb15._els['fournisseur-immatricule'].value = '';
sb15._els['fournisseur-adresse'].value = '';
sb15._els['fournisseur-specialite'].value = '';
sb15._els['fournisseur-notes'].value = '';
var threw15 = false;
try { vm.runInContext('saveFournisseur()', sb15); } catch(e) { threw15=true; }
ok(!threw15, 'saveFournisseur() with empty name does not throw');
ok(saved15.length === 0, 'saveFournisseur() with empty name does not save');

// ═════════════════════════════════════════════════════════════════════
// SECTION 16: saveFournisseur — create new
// ═════════════════════════════════════════════════════════════════════
section('16. saveFournisseur — create new');

var saved16 = [];
var sb16 = makeSandbox({
  STORE: {
    suppliers: function(){ return saved16.slice(); },
    saveSuppliers: function(d){ saved16=d; }
  }
});
load(sb16, 'js/shared/fournisseurs.js');
sb16._els['fournisseur-edit-id'].value = '';
sb16._els['fournisseur-nom'].value = 'Soleil SA';
sb16._els['fournisseur-contact'].value = 'Ahmed';
sb16._els['fournisseur-immatricule'].value = 'IM99';
sb16._els['fournisseur-adresse'].value = 'Tunis';
sb16._els['fournisseur-specialite'].value = 'Logistique';
sb16._els['fournisseur-notes'].value = 'Note1';
var threw16 = false;
try { vm.runInContext('saveFournisseur()', sb16); } catch(e) { threw16=true; console.log('  ERROR 16: '+e.message); }
ok(!threw16, 'saveFournisseur() create does not throw');
ok(saved16.length === 1, 'saveFournisseur() adds supplier to store');
ok(saved16[0].name === 'Soleil SA',     'saveFournisseur() saves name');
ok(saved16[0].category === 'Logistique','saveFournisseur() saves category');
ok(typeof saved16[0].id === 'string' && saved16[0].id.length > 0, 'saveFournisseur() generates id');

// ═════════════════════════════════════════════════════════════════════
// SECTION 17: saveFournisseur — update existing
// ═════════════════════════════════════════════════════════════════════
section('17. saveFournisseur — update existing');

var saved17 = [{ id:'f1', name:'Old Name', contact:'', immatricule:'', addr:'', category:'', notes:'' }];
var sb17 = makeSandbox({
  STORE: {
    suppliers: function(){ return saved17.slice(); },
    saveSuppliers: function(d){ saved17=d; }
  }
});
load(sb17, 'js/shared/fournisseurs.js');
sb17._els['fournisseur-edit-id'].value = 'f1';
sb17._els['fournisseur-nom'].value = 'New Name';
sb17._els['fournisseur-contact'].value = '';
sb17._els['fournisseur-immatricule'].value = '';
sb17._els['fournisseur-adresse'].value = '';
sb17._els['fournisseur-specialite'].value = '';
sb17._els['fournisseur-notes'].value = '';
vm.runInContext('saveFournisseur()', sb17);
ok(saved17.length === 1, 'saveFournisseur() update does not duplicate');
ok(saved17[0].name === 'New Name', 'saveFournisseur() updates name');

// ═════════════════════════════════════════════════════════════════════
// SECTION 18: deleteFournisseur — confirmed
// ═════════════════════════════════════════════════════════════════════
section('18. deleteFournisseur — confirmed');

var saved18 = [{ id:'f1', name:'A' }, { id:'f2', name:'B' }];
var sb18 = makeSandbox({
  STORE: {
    suppliers: function(){ return saved18.slice(); },
    saveSuppliers: function(d){ saved18=d; }
  }
});
load(sb18, 'js/shared/fournisseurs.js');
var threw18 = false;
try { vm.runInContext("deleteFournisseur('f1')", sb18); } catch(e) { threw18=true; console.log('  ERROR 18: '+e.message); }
ok(!threw18, 'deleteFournisseur() confirmed does not throw');
ok(saved18.length === 1, 'deleteFournisseur() removes one entry');
ok(saved18[0].id === 'f2', 'deleteFournisseur() removes the correct entry');

// ═════════════════════════════════════════════════════════════════════
// SECTION 19: deleteFournisseur — cancelled
// ═════════════════════════════════════════════════════════════════════
section('19. deleteFournisseur — cancelled');

var saved19 = [{ id:'f1', name:'A' }];
var sb19 = makeSandbox({
  confirm: function(){ return false; },
  STORE: {
    suppliers: function(){ return saved19.slice(); },
    saveSuppliers: function(d){ saved19=d; }
  }
});
load(sb19, 'js/shared/fournisseurs.js');
vm.runInContext("deleteFournisseur('f1')", sb19);
ok(saved19.length === 1, 'deleteFournisseur() cancelled leaves store unchanged');

// ═════════════════════════════════════════════════════════════════════
// SECTION 20: Regression — full shared modules chain coexist
// ═════════════════════════════════════════════════════════════════════
section('20. Regression — full shared modules chain coexist');

(function() {
  var sbR = makeSandbox({
    fetch: function(){ return Promise.resolve({ ok:true, json:function(){ return Promise.resolve({}); } }); },
    navigator: { onLine:true, sendBeacon:function(){ return true; } },
    localStorage: (function(){
      var _ls={};
      return {
        getItem:function(k){ return Object.prototype.hasOwnProperty.call(_ls,k)?_ls[k]:null; },
        setItem:function(k,v){ _ls[k]=String(v); },
        removeItem:function(k){ delete _ls[k]; },
        length:0, key:function(){ return null; }
      };
    })(),
    Blob: function(){ return {}; },
    AbortController: typeof AbortController !== 'undefined' ? AbortController
      : function(){ this.signal={}; this.abort=function(){}; },
    setInterval:function(){ return 1; }, clearInterval:function(){},
    setTimeout:function(){ return 1; }, clearTimeout:function(){},
    encodeURIComponent: encodeURIComponent,
    Uint8Array: Uint8Array,
    Option: function(text,value){ this.text=text; this.value=value; },
    normalizeRdv: function(r){ return r; },
    todayStr: function(){ return new Date().toISOString().slice(0,10); },
    fmtMoney: function(v){ return String(v); },
    getInvoiceTotal: function(){ return 0; },
    num: function(v){ return Number(v||0); }
  });

  load(sbR, 'js/core/storage.js');
  load(sbR, 'js/core/sync.js');
  load(sbR, 'js/core/router.js');
  load(sbR, 'js/shared/calendar.js');
  load(sbR, 'js/shared/dashboard.js');
  load(sbR, 'js/shared/natures.js');
  load(sbR, 'js/shared/clients.js');
  load(sbR, 'js/shared/collaborateurs.js');
  load(sbR, 'js/shared/fournisseurs.js');

  ok(typeof sbR.showView === 'function',                    'showView still present');
  ok(typeof sbR.renderCalendrier === 'function',            'renderCalendrier still present');
  ok(typeof sbR.updateDashboardStats === 'function',        'updateDashboardStats still present');
  ok(typeof sbR.renderNatures === 'function',               'renderNatures still present');
  ok(typeof sbR.renderClients === 'function',               'renderClients still present');
  ok(typeof sbR.renderCollaborateurs === 'function',        'renderCollaborateurs still present');
  ok(typeof sbR.renderFournisseurs === 'function',          'renderFournisseurs a function after chain load');
  ok(typeof sbR.getFournisseurCategoryStyle === 'function', 'getFournisseurCategoryStyle a function after chain load');
  ok(typeof sbR.saveFournisseur === 'function',             'saveFournisseur a function after chain load');
  ok(typeof sbR._storeSave === 'function',                  '_storeSave still present');
  ok(sbR.fournisseurFilterCategory === 'all',               'fournisseurFilterCategory initialized to "all"');
  ok(sbR.fournisseurSearchQuery === '',                      'fournisseurSearchQuery initialized to ""');
})();

// ═════════════════════════════════════════════════════════════════════
// Results
// ═════════════════════════════════════════════════════════════════════
console.log('\n' + (_fail === 0 ? '✓' : '✗') +
  ' ' + _pass + '/' + (_pass + _fail) + ' tests passed');
if (_fail > 0) process.exit(1);
