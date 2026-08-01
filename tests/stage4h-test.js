// =====================================================
// MYTHOS OS — Stage 4H Test
// tests/stage4h-test.js
//
// Verifies Collaborateurs CRUD globals extracted into
// js/shared/collaborateurs.js behave identically to the
// original app.js implementation.
//
// Run with: node tests/stage4h-test.js
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
    'collaborateurs-list',
    'collab-edit-id','collab-nom','collab-role','collab-contact','collab-notes',
    'collab-modal',
    'collab-detail-name','collab-detail-info-container',
    'collab-detail-stats','collab-detail-oms'
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

    // Utils (from utils.js)
    esc:        function(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); },
    escapeHtml: function(s) { return String(s == null ? '' : s); },
    money:      function(v) { return parseFloat(v||0).toFixed(3); },
    formatDate: function(s) { return String(s||''); },

    // Router (from router.js)
    showView: noop,

    // App.js stubs used by showCollabDetail
    previewOM: noop,
    editOM:    noop,

    // Default STORE
    STORE: {
      collabs:     function() { return []; },
      saveCollabs: function(d) { this._collabs = d; },
      _collabs: [],
      oms:         function() { return []; }
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
// SECTION 1: Globals exported by js/shared/collaborateurs.js
// ═════════════════════════════════════════════════════════════════════
section('1. Globals exported by js/shared/collaborateurs.js');

var sb1 = makeSandbox();
load(sb1, 'js/shared/collaborateurs.js');

ok(typeof sb1.currentCollabDetailId !== 'undefined', 'currentCollabDetailId is defined');
ok(sb1.currentCollabDetailId === '',                  'currentCollabDetailId initial value is ""');
ok(typeof sb1.renderCollaborateurs === 'function',    'renderCollaborateurs is a function');
ok(typeof sb1.showCollabDetail === 'function',        'showCollabDetail is a function');
ok(typeof sb1.openCollabModal === 'function',         'openCollabModal is a function');
ok(typeof sb1.closeCollabModal === 'function',        'closeCollabModal is a function');
ok(typeof sb1.saveCollab === 'function',              'saveCollab is a function');
ok(typeof sb1.deleteCollab === 'function',            'deleteCollab is a function');

// ═════════════════════════════════════════════════════════════════════
// SECTION 2: renderCollaborateurs — empty STORE
// ═════════════════════════════════════════════════════════════════════
section('2. renderCollaborateurs — empty STORE');

var sb2 = makeSandbox();
load(sb2, 'js/shared/collaborateurs.js');
var threw2 = false;
try { vm.runInContext('renderCollaborateurs()', sb2); } catch(e) { threw2=true; console.log('  ERROR: '+e.message); }
ok(!threw2, 'renderCollaborateurs() with empty collabs does not throw');
ok(sb2._els['collaborateurs-list'].innerHTML.indexOf('Aucun') !== -1,
  'renderCollaborateurs() shows empty-state with no collabs');

// ═════════════════════════════════════════════════════════════════════
// SECTION 3: renderCollaborateurs — with data
// ═════════════════════════════════════════════════════════════════════
section('3. renderCollaborateurs — with data');

var sb3 = makeSandbox({
  STORE: {
    collabs: function(){ return [{ id:'col1', nom:'Ahmed', role:'Chauffeur', contact:'555', notes:'' }]; },
    saveCollabs: function(d){ this._collabs=d; },
    _collabs: [],
    oms: function(){ return []; }
  }
});
load(sb3, 'js/shared/collaborateurs.js');
var threw3 = false;
try { vm.runInContext('renderCollaborateurs()', sb3); } catch(e) { threw3=true; console.log('  ERROR 3: '+e.message); }
ok(!threw3, 'renderCollaborateurs() with data does not throw');
ok(sb3._els['collaborateurs-list'].innerHTML.indexOf('Ahmed') !== -1,
  'renderCollaborateurs() renders collab name');
ok(sb3._els['collaborateurs-list'].innerHTML.indexOf('table') !== -1,
  'renderCollaborateurs() renders a table');

// ═════════════════════════════════════════════════════════════════════
// SECTION 4: openCollabModal — new collab
// ═════════════════════════════════════════════════════════════════════
section('4. openCollabModal — new collab');

var sb4 = makeSandbox();
load(sb4, 'js/shared/collaborateurs.js');
vm.runInContext("openCollabModal('')", sb4);
ok(sb4._els['collab-modal'].style.display === 'flex', 'openCollabModal() sets display flex');
ok(sb4._els['collab-edit-id'].value === '',  'collab-edit-id cleared for new collab');
ok(sb4._els['collab-nom'].value === '',      'collab-nom cleared for new collab');

// ═════════════════════════════════════════════════════════════════════
// SECTION 5: openCollabModal — edit existing
// ═════════════════════════════════════════════════════════════════════
section('5. openCollabModal — edit existing');

var sb5 = makeSandbox({
  STORE: {
    collabs: function(){ return [{ id:'col1', nom:'Sami', role:'Livreur', contact:'777', notes:'Note1' }]; },
    saveCollabs: function(d){ this._collabs=d; },
    _collabs: [], oms: function(){ return []; }
  }
});
load(sb5, 'js/shared/collaborateurs.js');
vm.runInContext("openCollabModal('col1')", sb5);
ok(sb5._els['collab-edit-id'].value === 'col1', 'collab-edit-id populated');
ok(sb5._els['collab-nom'].value === 'Sami',     'collab-nom populated');
ok(sb5._els['collab-role'].value === 'Livreur', 'collab-role populated');
ok(sb5._els['collab-contact'].value === '777',  'collab-contact populated');

// ═════════════════════════════════════════════════════════════════════
// SECTION 6: closeCollabModal
// ═════════════════════════════════════════════════════════════════════
section('6. closeCollabModal');

var sb6 = makeSandbox();
load(sb6, 'js/shared/collaborateurs.js');
vm.runInContext("openCollabModal('')", sb6);
vm.runInContext('closeCollabModal()', sb6);
ok(sb6._els['collab-modal'].style.display === 'none', 'closeCollabModal() sets display none');

// ═════════════════════════════════════════════════════════════════════
// SECTION 7: saveCollab — create new
// ═════════════════════════════════════════════════════════════════════
section('7. saveCollab — create new');

var saved7 = [];
var sb7 = makeSandbox({
  STORE: {
    collabs: function(){ return saved7.slice(); },
    saveCollabs: function(d){ saved7=d; },
    oms: function(){ return []; }
  }
});
load(sb7, 'js/shared/collaborateurs.js');
sb7._els['collab-edit-id'].value = '';
sb7._els['collab-nom'].value = 'Khalil';
sb7._els['collab-role'].value = 'Technicien';
sb7._els['collab-contact'].value = '22222';
sb7._els['collab-notes'].value = 'Expert';
var threw7=false;
try { vm.runInContext('saveCollab()', sb7); } catch(e){ threw7=true; console.log('  ERROR 7: '+e.message); }
ok(!threw7, 'saveCollab() create does not throw');
ok(saved7.length === 1, 'saveCollab() adds collab to store');
ok(saved7[0].nom === 'Khalil', 'saveCollab() saves nom');
ok(saved7[0].role === 'Technicien', 'saveCollab() saves role');
ok(typeof saved7[0].id === 'string' && saved7[0].id.length > 0, 'saveCollab() generates id');

// ═════════════════════════════════════════════════════════════════════
// SECTION 8: saveCollab — update existing
// ═════════════════════════════════════════════════════════════════════
section('8. saveCollab — update existing');

var saved8 = [{ id:'col1', nom:'Old Name', role:'', contact:'', notes:'' }];
var sb8 = makeSandbox({
  STORE: {
    collabs: function(){ return saved8.slice(); },
    saveCollabs: function(d){ saved8=d; },
    oms: function(){ return []; }
  }
});
load(sb8, 'js/shared/collaborateurs.js');
sb8._els['collab-edit-id'].value = 'col1';
sb8._els['collab-nom'].value = 'New Name';
sb8._els['collab-role'].value = '';
sb8._els['collab-contact'].value = '';
sb8._els['collab-notes'].value = '';
vm.runInContext('saveCollab()', sb8);
ok(saved8.length === 1, 'saveCollab() update does not duplicate');
ok(saved8[0].nom === 'New Name', 'saveCollab() updates nom');

// ═════════════════════════════════════════════════════════════════════
// SECTION 9: deleteCollab — confirmed
// ═════════════════════════════════════════════════════════════════════
section('9. deleteCollab — confirmed');

var saved9 = [{ id:'col1', nom:'A' }, { id:'col2', nom:'B' }];
var sb9 = makeSandbox({
  STORE: {
    collabs: function(){ return saved9.slice(); },
    saveCollabs: function(d){ saved9=d; },
    oms: function(){ return []; }
  }
});
load(sb9, 'js/shared/collaborateurs.js');
var threw9=false;
try { vm.runInContext("deleteCollab('col1')", sb9); } catch(e){ threw9=true; console.log('  ERROR 9: '+e.message); }
ok(!threw9, 'deleteCollab() confirmed does not throw');
ok(saved9.length === 1, 'deleteCollab() removes one entry');
ok(saved9[0].id === 'col2', 'deleteCollab() removes the correct entry');

// ═════════════════════════════════════════════════════════════════════
// SECTION 10: deleteCollab — cancelled
// ═════════════════════════════════════════════════════════════════════
section('10. deleteCollab — cancelled');

var saved10 = [{ id:'col1', nom:'A' }];
var sb10 = makeSandbox({
  confirm: function(){ return false; },
  STORE: {
    collabs: function(){ return saved10.slice(); },
    saveCollabs: function(d){ saved10=d; },
    oms: function(){ return []; }
  }
});
load(sb10, 'js/shared/collaborateurs.js');
vm.runInContext("deleteCollab('col1')", sb10);
ok(saved10.length === 1, 'deleteCollab() cancelled leaves store unchanged');

// ═════════════════════════════════════════════════════════════════════
// SECTION 11: showCollabDetail — unknown id
// ═════════════════════════════════════════════════════════════════════
section('11. showCollabDetail — unknown id');

var sb11 = makeSandbox();
load(sb11, 'js/shared/collaborateurs.js');
var threw11=false;
try { vm.runInContext("showCollabDetail('unknown')", sb11); } catch(e){ threw11=true; console.log('  ERROR 11: '+e.message); }
ok(!threw11, 'showCollabDetail() with unknown id does not throw');

// ═════════════════════════════════════════════════════════════════════
// SECTION 12: showCollabDetail — known collab, no oms
// ═════════════════════════════════════════════════════════════════════
section('12. showCollabDetail — known collab, no oms');

var sb12 = makeSandbox({
  STORE: {
    collabs: function(){ return [{ id:'col1', nom:'Tarek', role:'Livreur', contact:'111', notes:'' }]; },
    saveCollabs: function(d){ this._c=d; },
    oms: function(){ return []; }
  }
});
var showViewCalled12 = false;
sb12.showView = function(v){ showViewCalled12 = (v === 'collab-detail'); };
load(sb12, 'js/shared/collaborateurs.js');
var threw12=false;
try { vm.runInContext("showCollabDetail('col1')", sb12); } catch(e){ threw12=true; console.log('  ERROR 12: '+e.message); }
ok(!threw12, 'showCollabDetail() with known collab does not throw');
ok(sb12._els['collab-detail-name'].textContent === 'Tarek', 'showCollabDetail() sets collab name');
ok(showViewCalled12, 'showCollabDetail() calls showView("collab-detail")');
ok(vm.runInContext('currentCollabDetailId', sb12) === 'col1', 'showCollabDetail() sets currentCollabDetailId');
ok(sb12._els['collab-detail-oms'].innerHTML.indexOf('Aucun') !== -1,
  'showCollabDetail() shows empty state for oms when none');

// ═════════════════════════════════════════════════════════════════════
// SECTION 13: showCollabDetail — known collab with oms
// ═════════════════════════════════════════════════════════════════════
section('13. showCollabDetail — known collab with oms');

var sb13 = makeSandbox({
  STORE: {
    collabs: function(){ return [{ id:'col1', nom:'Ahmed', role:'Chauffeur', contact:'', notes:'' }]; },
    saveCollabs: function(d){ this._c=d; },
    oms: function(){ return [
      { id:'om1', chauffeur:'Ahmed', depart:'Tunis', arrivee:'Sfax', date:'2026-01-15', distance:270 }
    ]; }
  }
});
load(sb13, 'js/shared/collaborateurs.js');
var threw13=false;
try { vm.runInContext("showCollabDetail('col1')", sb13); } catch(e){ threw13=true; console.log('  ERROR 13: '+e.message); }
ok(!threw13, 'showCollabDetail() with oms does not throw');
ok(sb13._els['collab-detail-oms'].innerHTML.indexOf('om1') !== -1,
  'showCollabDetail() renders om id');
ok(sb13._els['collab-detail-stats'].innerHTML.indexOf('270') !== -1,
  'showCollabDetail() stats show total distance');

// ═════════════════════════════════════════════════════════════════════
// SECTION 14: Regression — full shared modules chain coexist
// ═════════════════════════════════════════════════════════════════════
section('14. Regression — full shared modules chain coexist');

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

  ok(typeof sbR.showView === 'function',                  'showView still present');
  ok(typeof sbR.renderCalendrier === 'function',          'renderCalendrier still present');
  ok(typeof sbR.updateDashboardStats === 'function',      'updateDashboardStats still present');
  ok(typeof sbR.renderNatures === 'function',             'renderNatures still present');
  ok(typeof sbR.renderClients === 'function',             'renderClients still present');
  ok(typeof sbR.renderCollaborateurs === 'function',      'renderCollaborateurs a function after chain load');
  ok(typeof sbR.saveCollab === 'function',                'saveCollab a function after chain load');
  ok(typeof sbR._storeSave === 'function',                '_storeSave still present');
  ok(sbR.currentCollabDetailId === '',                    'currentCollabDetailId initialized to ""');
  ok(typeof sbR.STORE.saveCollabs === 'function',         'STORE.saveCollabs present');
})();

// ═════════════════════════════════════════════════════════════════════
// Results
// ═════════════════════════════════════════════════════════════════════
console.log('\n' + (_fail === 0 ? '✓' : '✗') +
  ' ' + _pass + '/' + (_pass + _fail) + ' tests passed');
if (_fail > 0) process.exit(1);
