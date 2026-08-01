// =====================================================
// MYTHOS OS — Stage 4J Test
// tests/stage4j-test.js
//
// Verifies Representations CRUD globals extracted into
// js/shared/representations.js behave identically to
// the original app.js implementation.
//
// Run with: node tests/stage4j-test.js
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
    options: [], selectedIndex: -1,
    classList: { _c:[], add:function(c){if(this._c.indexOf(c)<0)this._c.push(c);}, remove:function(c){var i=this._c.indexOf(c);if(i>=0)this._c.splice(i,1);}, contains:function(c){return this._c.indexOf(c)>=0;} },
    appendChild: function(child) { this._children = this._children || []; this._children.push(child); }
  };
}

function makeSandbox(overrides) {
  var els = {};
  var noop = function() {};
  function getEl(id) { return els[id] || null; }
  function ensureEl(id) { if (!els[id]) els[id] = makeEl(id); return els[id]; }

  [
    'representations-dashboard',
    'representation-modal',
    'rep-edit-id', 'rep-spectacle', 'rep-client-name', 'rep-director', 'rep-fee',
    'rep-client-id', 'rep-nature-lines'
  ].forEach(ensureEl);

  // mock window.open
  var _winOpened = null;
  var mockWin = {
    _writes: [],
    document: {
      write: function(s){ mockWin._writes.push(s); },
      close: noop
    },
    print: noop
  };

  var sb = {
    document: {
      getElementById: function(id) { return getEl(id) || null; },
      querySelectorAll: function(sel) {
        // support '#rep-nature-lines > div' → return children of rep-nature-lines
        if (sel === '#rep-nature-lines > div') {
          var parent = els['rep-nature-lines'];
          return (parent && parent._children) ? parent._children : [];
        }
        return [];
      },
      createElement: function(tag) {
        var el = { tagName: tag, id: '', style: { cssText: '' }, innerHTML: '',
          _children: [],
          appendChild: function(c){ this._children.push(c); },
          querySelector: function(s) {
            // find child by class selector
            for (var i = 0; i < this._children.length; i++) {
              var c = this._children[i];
              if (c && c.className && c.className.indexOf(s.replace('.','')) !== -1) return c;
            }
            return null;
          },
          remove: noop
        };
        return el;
      },
      body: { appendChild: noop }, addEventListener: noop
    },
    window: {
      addEventListener: noop,
      open: function() { return mockWin; }
    },
    _win: mockWin,
    location: { hash: '' },
    _els: els,
    console: { log: noop, warn: noop, error: noop },
    confirm: function() { return true; },
    alert: noop,
    setTimeout: function(fn) { /* don't call fn */ },

    // Utils
    esc:           function(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); },
    fmtMoney:      function(v) { return parseFloat(v||0).toFixed(3); },
    num:           function(v) { return Number(v||0); },
    formatDate:    function(s) { return String(s||''); },
    formatDateLong:function(s) { return String(s||''); },
    todayStr:      function() { return '2026-08-01'; },

    // Default STORE
    STORE: {
      representations:     function() { return []; },
      saveRepresentations: function(d) { this._reps = d; },
      _reps: [],
      clients:  function() { return []; },
      natures:  function() { return []; }
    },

    // JS globals
    Array:Array, Object:Object, String:String, Number:Number,
    Boolean:Boolean, Math:Math, JSON:JSON, Date:Date,
    Set:Set, Map:Map, Promise:Promise,
    Infinity:Infinity, undefined:undefined, parseFloat:parseFloat,
    parseInt:parseInt
  };

  Object.assign(sb, overrides || {});
  return vm.createContext(sb);
}

function load(sb, rel) {
  vm.runInContext(fs.readFileSync(path.join(BASE, rel), 'utf8'), sb);
}

// ═════════════════════════════════════════════════════════════════════
// SECTION 1: Globals exported by js/shared/representations.js
// ═════════════════════════════════════════════════════════════════════
section('1. Globals exported by js/shared/representations.js');

var sb1 = makeSandbox();
load(sb1, 'js/shared/representations.js');

ok(typeof sb1.stableRepNatureRows !== 'undefined',      'stableRepNatureRows is defined');
ok(sb1.stableRepNatureRows === 0,                       'stableRepNatureRows initial value is 0');
ok(typeof sb1.renderRepresentations === 'function',     'renderRepresentations is a function');
ok(typeof sb1.showRepresentationDetail === 'function',  'showRepresentationDetail is a function');
ok(typeof sb1.openRepresentationModal === 'function',   'openRepresentationModal is a function');
ok(typeof sb1.closeRepresentationModal === 'function',  'closeRepresentationModal is a function');
ok(typeof sb1.fillRepresentationClients === 'function', 'fillRepresentationClients is a function');
ok(typeof sb1.syncRepresentationClient === 'function',  'syncRepresentationClient is a function');
ok(typeof sb1.addRepresentationNatureLine === 'function','addRepresentationNatureLine is a function');
ok(typeof sb1.saveRepresentation === 'function',        'saveRepresentation is a function');
ok(typeof sb1.deleteRepresentation === 'function',      'deleteRepresentation is a function');
ok(typeof sb1.printRepresentations === 'function',      'printRepresentations is a function');

// ═════════════════════════════════════════════════════════════════════
// SECTION 2: renderRepresentations — empty STORE
// ═════════════════════════════════════════════════════════════════════
section('2. renderRepresentations — empty STORE');

var sb2 = makeSandbox();
load(sb2, 'js/shared/representations.js');
var threw2 = false;
try { vm.runInContext('renderRepresentations()', sb2); } catch(e) { threw2=true; console.log('  ERROR: '+e.message); }
ok(!threw2, 'renderRepresentations() with empty store does not throw');
ok(sb2._els['representations-dashboard'].innerHTML.indexOf('Aucune') !== -1,
  'renderRepresentations() shows empty-state with no representations');

// ═════════════════════════════════════════════════════════════════════
// SECTION 3: renderRepresentations — with data
// ═════════════════════════════════════════════════════════════════════
section('3. renderRepresentations — with data');

var sb3 = makeSandbox({
  STORE: {
    representations: function(){ return [
      { id:'r1', spectacle:'Concert Jazz', clientName:'Ali Corp', director:'Bob', fee:5000, natureLines:[] }
    ]; },
    saveRepresentations: function(d){ this._r=d; },
    clients: function(){ return []; },
    natures: function(){ return []; }
  }
});
load(sb3, 'js/shared/representations.js');
var threw3 = false;
try { vm.runInContext('renderRepresentations()', sb3); } catch(e) { threw3=true; console.log('  ERROR 3: '+e.message); }
ok(!threw3, 'renderRepresentations() with data does not throw');
ok(sb3._els['representations-dashboard'].innerHTML.indexOf('Concert Jazz') !== -1,
  'renderRepresentations() renders spectacle name');
ok(sb3._els['representations-dashboard'].innerHTML.indexOf('table') !== -1,
  'renderRepresentations() renders a table');

// ═════════════════════════════════════════════════════════════════════
// SECTION 4: showRepresentationDetail — unknown id
// ═════════════════════════════════════════════════════════════════════
section('4. showRepresentationDetail — unknown id');

var sb4 = makeSandbox();
load(sb4, 'js/shared/representations.js');
var threw4 = false;
try { vm.runInContext("showRepresentationDetail('unknown')", sb4); } catch(e) { threw4=true; console.log('  ERROR 4: '+e.message); }
ok(!threw4, 'showRepresentationDetail() with unknown id does not throw');

// ═════════════════════════════════════════════════════════════════════
// SECTION 5: showRepresentationDetail — known representation
// ═════════════════════════════════════════════════════════════════════
section('5. showRepresentationDetail — known representation');

var sb5 = makeSandbox({
  STORE: {
    representations: function(){ return [
      { id:'r1', spectacle:'Gala 2026', clientName:'Festival', director:'Pierre', fee:8000, natureLines:[] }
    ]; },
    saveRepresentations: function(d){ this._r=d; },
    clients: function(){ return []; },
    natures: function(){ return []; }
  }
});
load(sb5, 'js/shared/representations.js');
var threw5 = false;
try { vm.runInContext("showRepresentationDetail('r1')", sb5); } catch(e) { threw5=true; console.log('  ERROR 5: '+e.message); }
ok(!threw5, 'showRepresentationDetail() with known rep does not throw');
ok(sb5._els['representations-dashboard'].innerHTML.indexOf('Gala 2026') !== -1,
  'showRepresentationDetail() renders spectacle name');
ok(sb5._els['representations-dashboard'].innerHTML.indexOf('Pierre') !== -1,
  'showRepresentationDetail() renders director name');

// ═════════════════════════════════════════════════════════════════════
// SECTION 6: fillRepresentationClients
// ═════════════════════════════════════════════════════════════════════
section('6. fillRepresentationClients');

var sb6 = makeSandbox({
  STORE: {
    representations: function(){ return []; },
    saveRepresentations: function(d){},
    clients: function(){ return [{ id:'c1', name:'Acme', contact:'' }]; },
    natures: function(){ return []; }
  }
});
load(sb6, 'js/shared/representations.js');
var threw6 = false;
try { vm.runInContext('fillRepresentationClients()', sb6); } catch(e) { threw6=true; console.log('  ERROR 6: '+e.message); }
ok(!threw6, 'fillRepresentationClients() does not throw');
ok(sb6._els['rep-client-id'].innerHTML.indexOf('Acme') !== -1,
  'fillRepresentationClients() populates client select');

// ═════════════════════════════════════════════════════════════════════
// SECTION 7: syncRepresentationClient
// ═════════════════════════════════════════════════════════════════════
section('7. syncRepresentationClient');

var sb7 = makeSandbox({
  STORE: {
    representations: function(){ return []; },
    saveRepresentations: function(d){},
    clients: function(){ return [{ id:'c1', name:'SynCo', contact:'Bob' }]; },
    natures: function(){ return []; }
  }
});
load(sb7, 'js/shared/representations.js');
sb7._els['rep-client-id'].value = 'c1';
var threw7 = false;
try { vm.runInContext('syncRepresentationClient()', sb7); } catch(e) { threw7=true; console.log('  ERROR 7: '+e.message); }
ok(!threw7, 'syncRepresentationClient() does not throw');
ok(sb7._els['rep-client-name'].value === 'SynCo',
  'syncRepresentationClient() sets client name from STORE.clients');

// ═════════════════════════════════════════════════════════════════════
// SECTION 8: syncRepresentationClient — no match
// ═════════════════════════════════════════════════════════════════════
section('8. syncRepresentationClient — no match');

var sb8 = makeSandbox();
load(sb8, 'js/shared/representations.js');
sb8._els['rep-client-id'].value = 'nonexistent';
var threw8 = false;
try { vm.runInContext('syncRepresentationClient()', sb8); } catch(e) { threw8=true; }
ok(!threw8, 'syncRepresentationClient() with no match does not throw');

// ═════════════════════════════════════════════════════════════════════
// SECTION 9: openRepresentationModal — new
// ═════════════════════════════════════════════════════════════════════
section('9. openRepresentationModal — new representation');

var sb9 = makeSandbox({
  STORE: {
    representations: function(){ return []; },
    saveRepresentations: function(d){},
    clients: function(){ return []; },
    natures: function(){ return [
      { id:'n1', nom:'Chant' }
    ]; }
  }
});
load(sb9, 'js/shared/representations.js');
var threw9 = false;
try { vm.runInContext("openRepresentationModal('')", sb9); } catch(e) { threw9=true; console.log('  ERROR 9: '+e.message); }
ok(!threw9, 'openRepresentationModal() new does not throw');
ok(sb9._els['representation-modal'].style.display === 'flex',
  'openRepresentationModal() sets display flex');
ok(sb9._els['rep-edit-id'].value === '',
  'rep-edit-id cleared for new representation');

// ═════════════════════════════════════════════════════════════════════
// SECTION 10: openRepresentationModal — edit existing
// ═════════════════════════════════════════════════════════════════════
section('10. openRepresentationModal — edit existing');

var sb10 = makeSandbox({
  STORE: {
    representations: function(){ return [
      { id:'r1', spectacle:'Opera', clientName:'Tunisie Prod', clientId:'c1',
        director:'Ali', fee:3000, natureLines:[{ natureId:'n1', natureName:'Chant', displayName:'Chant' }] }
    ]; },
    saveRepresentations: function(d){},
    clients: function(){ return [{ id:'c1', name:'Tunisie Prod', contact:'' }]; },
    natures: function(){ return [{ id:'n1', nom:'Chant' }]; }
  }
});
load(sb10, 'js/shared/representations.js');
var threw10 = false;
try { vm.runInContext("openRepresentationModal('r1')", sb10); } catch(e) { threw10=true; console.log('  ERROR 10: '+e.message); }
ok(!threw10, 'openRepresentationModal() edit does not throw');
ok(sb10._els['rep-edit-id'].value === 'r1',    'rep-edit-id populated for edit');
ok(sb10._els['rep-spectacle'].value === 'Opera','rep-spectacle populated for edit');
ok(sb10._els['rep-fee'].value == 3000,          'rep-fee populated for edit');

// ═════════════════════════════════════════════════════════════════════
// SECTION 11: closeRepresentationModal
// ═════════════════════════════════════════════════════════════════════
section('11. closeRepresentationModal');

var sb11 = makeSandbox();
load(sb11, 'js/shared/representations.js');
vm.runInContext("openRepresentationModal('')", sb11);
vm.runInContext('closeRepresentationModal()', sb11);
ok(sb11._els['representation-modal'].style.display === 'none',
  'closeRepresentationModal() sets display none');

// ═════════════════════════════════════════════════════════════════════
// SECTION 12: addRepresentationNatureLine — increments stableRepNatureRows
// ═════════════════════════════════════════════════════════════════════
section('12. addRepresentationNatureLine');

var sb12 = makeSandbox({
  STORE: {
    representations: function(){ return []; },
    saveRepresentations: function(d){},
    clients: function(){ return []; },
    natures: function(){ return [{ id:'n1', nom:'Chant' }, { id:'n2', nom:'Danse' }]; }
  }
});
load(sb12, 'js/shared/representations.js');
ok(vm.runInContext('stableRepNatureRows', sb12) === 0, 'stableRepNatureRows starts at 0');
var threw12 = false;
try { vm.runInContext("addRepresentationNatureLine({})", sb12); } catch(e) { threw12=true; console.log('  ERROR 12: '+e.message); }
ok(!threw12, 'addRepresentationNatureLine() does not throw');
ok(vm.runInContext('stableRepNatureRows', sb12) === 1, 'stableRepNatureRows incremented to 1 after first line');
vm.runInContext("addRepresentationNatureLine({})", sb12);
ok(vm.runInContext('stableRepNatureRows', sb12) === 2, 'stableRepNatureRows incremented to 2 after second line');

// ═════════════════════════════════════════════════════════════════════
// SECTION 13: saveRepresentation — create new
// ═════════════════════════════════════════════════════════════════════
section('13. saveRepresentation — create new');

var saved13 = [];
var sb13 = makeSandbox({
  STORE: {
    representations: function(){ return saved13.slice(); },
    saveRepresentations: function(d){ saved13=d; },
    clients: function(){ return []; },
    natures: function(){ return []; }
  }
});
load(sb13, 'js/shared/representations.js');
sb13._els['rep-edit-id'].value = '';
sb13._els['rep-spectacle'].value = 'Nouveau Concert';
sb13._els['rep-client-id'].value = '';
sb13._els['rep-client-name'].value = 'Sponsor';
sb13._els['rep-director'].value = 'Karim';
sb13._els['rep-fee'].value = '2500';
var threw13 = false;
try { vm.runInContext('saveRepresentation()', sb13); } catch(e) { threw13=true; console.log('  ERROR 13: '+e.message); }
ok(!threw13, 'saveRepresentation() create does not throw');
ok(saved13.length === 1, 'saveRepresentation() adds representation to store');
ok(saved13[0].spectacle === 'Nouveau Concert', 'saveRepresentation() saves spectacle');
ok(saved13[0].fee === 2500, 'saveRepresentation() saves fee as number');
ok(typeof saved13[0].id === 'string' && saved13[0].id.length > 0, 'saveRepresentation() generates id');

// ═════════════════════════════════════════════════════════════════════
// SECTION 14: saveRepresentation — update existing
// ═════════════════════════════════════════════════════════════════════
section('14. saveRepresentation — update existing');

var saved14 = [{ id:'r1', spectacle:'Old Show', clientId:'', clientName:'', director:'', fee:0, date:'', notes:'', natureLines:[] }];
var sb14 = makeSandbox({
  STORE: {
    representations: function(){ return saved14.slice(); },
    saveRepresentations: function(d){ saved14=d; },
    clients: function(){ return []; },
    natures: function(){ return []; }
  }
});
load(sb14, 'js/shared/representations.js');
sb14._els['rep-edit-id'].value = 'r1';
sb14._els['rep-spectacle'].value = 'Updated Show';
sb14._els['rep-client-id'].value = '';
sb14._els['rep-client-name'].value = '';
sb14._els['rep-director'].value = '';
sb14._els['rep-fee'].value = '0';
vm.runInContext('saveRepresentation()', sb14);
ok(saved14.length === 1, 'saveRepresentation() update does not duplicate');
ok(saved14[0].spectacle === 'Updated Show', 'saveRepresentation() updates spectacle');

// ═════════════════════════════════════════════════════════════════════
// SECTION 15: deleteRepresentation — confirmed
// ═════════════════════════════════════════════════════════════════════
section('15. deleteRepresentation — confirmed');

var saved15 = [{ id:'r1', spectacle:'A' }, { id:'r2', spectacle:'B' }];
var sb15 = makeSandbox({
  STORE: {
    representations: function(){ return saved15.slice(); },
    saveRepresentations: function(d){ saved15=d; },
    clients: function(){ return []; },
    natures: function(){ return []; }
  }
});
load(sb15, 'js/shared/representations.js');
var threw15 = false;
try { vm.runInContext("deleteRepresentation('r1')", sb15); } catch(e) { threw15=true; console.log('  ERROR 15: '+e.message); }
ok(!threw15, 'deleteRepresentation() confirmed does not throw');
ok(saved15.length === 1, 'deleteRepresentation() removes one entry');
ok(saved15[0].id === 'r2', 'deleteRepresentation() removes correct entry');

// ═════════════════════════════════════════════════════════════════════
// SECTION 16: deleteRepresentation — cancelled
// ═════════════════════════════════════════════════════════════════════
section('16. deleteRepresentation — cancelled');

var saved16 = [{ id:'r1', spectacle:'A' }];
var sb16 = makeSandbox({
  confirm: function(){ return false; },
  STORE: {
    representations: function(){ return saved16.slice(); },
    saveRepresentations: function(d){ saved16=d; },
    clients: function(){ return []; },
    natures: function(){ return []; }
  }
});
load(sb16, 'js/shared/representations.js');
vm.runInContext("deleteRepresentation('r1')", sb16);
ok(saved16.length === 1, 'deleteRepresentation() cancelled leaves store unchanged');

// ═════════════════════════════════════════════════════════════════════
// SECTION 17: printRepresentations
// ═════════════════════════════════════════════════════════════════════
section('17. printRepresentations');

var sb17 = makeSandbox({
  STORE: {
    representations: function(){ return [
      { id:'r1', spectacle:'Show A', clientName:'Client X', date:'2026-07-01', fee:1000, natureLines:[] }
    ]; },
    saveRepresentations: function(d){},
    clients: function(){ return []; },
    natures: function(){ return []; }
  }
});
load(sb17, 'js/shared/representations.js');
var threw17 = false;
try { vm.runInContext('printRepresentations()', sb17); } catch(e) { threw17=true; console.log('  ERROR 17: '+e.message); }
ok(!threw17, 'printRepresentations() does not throw');
var writes17 = sb17._win._writes.join('');
ok(writes17.indexOf('Show A') !== -1, 'printRepresentations() writes spectacle name');
ok(writes17.indexOf('Client X') !== -1, 'printRepresentations() writes client name');
ok(writes17.indexOf('1000') !== -1, 'printRepresentations() writes fee total');

// ═════════════════════════════════════════════════════════════════════
// SECTION 18: stableRepNatureRows resets in openRepresentationModal
// ═════════════════════════════════════════════════════════════════════
section('18. stableRepNatureRows resets to 0 in openRepresentationModal');

var sb18 = makeSandbox({
  STORE: {
    representations: function(){ return []; },
    saveRepresentations: function(d){},
    clients: function(){ return []; },
    natures: function(){ return []; }
  }
});
load(sb18, 'js/shared/representations.js');
// After reset to 0, addRepresentationNatureLine is called once for the default empty line
// so stableRepNatureRows ends at 1, not 0.
vm.runInContext('stableRepNatureRows = 5', sb18);
vm.runInContext("openRepresentationModal('')", sb18);
ok(vm.runInContext('stableRepNatureRows', sb18) === 1,
  'openRepresentationModal() resets stableRepNatureRows (ends at 1 after default line added)');

// ═════════════════════════════════════════════════════════════════════
// SECTION 19: Regression — full shared modules chain coexist
// ═════════════════════════════════════════════════════════════════════
section('19. Regression — full shared modules chain coexist');

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
    todayStr: function(){ return '2026-08-01'; },
    fmtMoney: function(v){ return String(v); },
    formatDateLong: function(s){ return String(s||''); },
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
  load(sbR, 'js/shared/representations.js');

  ok(typeof sbR.showView === 'function',                       'showView still present');
  ok(typeof sbR.renderCalendrier === 'function',               'renderCalendrier still present');
  ok(typeof sbR.updateDashboardStats === 'function',           'updateDashboardStats still present');
  ok(typeof sbR.renderNatures === 'function',                  'renderNatures still present');
  ok(typeof sbR.renderClients === 'function',                  'renderClients still present');
  ok(typeof sbR.renderCollaborateurs === 'function',           'renderCollaborateurs still present');
  ok(typeof sbR.renderFournisseurs === 'function',             'renderFournisseurs still present');
  ok(typeof sbR.renderRepresentations === 'function',          'renderRepresentations a function after chain load');
  ok(typeof sbR.saveRepresentation === 'function',             'saveRepresentation a function after chain load');
  ok(typeof sbR.printRepresentations === 'function',           'printRepresentations a function after chain load');
  ok(typeof sbR._storeSave === 'function',                     '_storeSave still present');
  ok(sbR.stableRepNatureRows === 0,                            'stableRepNatureRows initialized to 0');
})();

// ═════════════════════════════════════════════════════════════════════
// Results
// ═════════════════════════════════════════════════════════════════════
console.log('\n' + (_fail === 0 ? '✓' : '✗') +
  ' ' + _pass + '/' + (_pass + _fail) + ' tests passed');
if (_fail > 0) process.exit(1);
