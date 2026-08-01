// =====================================================
// MYTHOS OS — Stage 4G Test
// tests/stage4g-test.js
//
// Verifies Clients CRUD globals extracted into
// js/shared/clients.js behave identically to the
// original app.js implementation.
//
// Run with: node tests/stage4g-test.js
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
    'clients-list',
    'cm-id','cm-contact','cm-name','cm-addr','cm-mf','cm-tel',
    'client-modal',
    'client-detail-name','client-detail-info-container',
    'client-detail-stats','client-detail-invoices'
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

    // App.js stubs used by showClientDetail
    previewInvoice: noop,
    editInvoice:    noop,

    // LOGGER — intentionally absent (tested with typeof guard)

    // Default STORE
    STORE: {
      clients:     function() { return []; },
      saveClients: function(d) { this._clients = d; },
      _clients: [],
      invoices:    function() { return []; }
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
// SECTION 1: Globals exported by js/shared/clients.js
// ═════════════════════════════════════════════════════════════════════
section('1. Globals exported by js/shared/clients.js');

var sb1 = makeSandbox();
load(sb1, 'js/shared/clients.js');

ok(typeof sb1.currentClientDetailId !== 'undefined', 'currentClientDetailId is defined');
ok(sb1.currentClientDetailId === '',                  'currentClientDetailId initial value is ""');
ok(typeof sb1.renderClients === 'function',           'renderClients is a function');
ok(typeof sb1.showClientDetail === 'function',        'showClientDetail is a function');
ok(typeof sb1.openClientModal === 'function',         'openClientModal is a function');
ok(typeof sb1.closeClientModal === 'function',        'closeClientModal is a function');
ok(typeof sb1.saveClient === 'function',              'saveClient is a function');
ok(typeof sb1.deleteClient === 'function',            'deleteClient is a function');

// ═════════════════════════════════════════════════════════════════════
// SECTION 2: renderClients — empty STORE
// ═════════════════════════════════════════════════════════════════════
section('2. renderClients — empty STORE');

var sb2 = makeSandbox();
load(sb2, 'js/shared/clients.js');
var threw2 = false;
try { vm.runInContext('renderClients()', sb2); } catch(e) { threw2=true; console.log('  ERROR: '+e.message); }
ok(!threw2, 'renderClients() with empty clients does not throw');
ok(sb2._els['clients-list'].innerHTML.indexOf('Aucun') !== -1,
  'renderClients() shows empty-state with no clients');

// ═════════════════════════════════════════════════════════════════════
// SECTION 3: renderClients — with data
// ═════════════════════════════════════════════════════════════════════
section('3. renderClients — with data');

var sb3 = makeSandbox({
  STORE: {
    clients: function(){ return [{ id:'c1', name:'Acme Corp', contact:'Alice', tel:'555', addr:'Paris', mf:'MF001' }]; },
    saveClients: function(d){ this._clients=d; },
    _clients: [],
    invoices: function(){ return []; }
  }
});
load(sb3, 'js/shared/clients.js');
var threw3 = false;
try { vm.runInContext('renderClients()', sb3); } catch(e) { threw3=true; console.log('  ERROR 3: '+e.message); }
ok(!threw3, 'renderClients() with data does not throw');
ok(sb3._els['clients-list'].innerHTML.indexOf('Acme Corp') !== -1,
  'renderClients() renders client name');
ok(sb3._els['clients-list'].innerHTML.indexOf('table') !== -1,
  'renderClients() renders a table');

// ═════════════════════════════════════════════════════════════════════
// SECTION 4: openClientModal — new client
// ═════════════════════════════════════════════════════════════════════
section('4. openClientModal — new client');

var sb4 = makeSandbox();
load(sb4, 'js/shared/clients.js');
vm.runInContext("openClientModal('')", sb4);
ok(sb4._els['client-modal'].style.display === 'flex', 'openClientModal() sets display flex');
ok(sb4._els['cm-id'].value === '',    'cm-id cleared for new client');
ok(sb4._els['cm-name'].value === '',  'cm-name cleared for new client');

// ═════════════════════════════════════════════════════════════════════
// SECTION 5: openClientModal — edit existing
// ═════════════════════════════════════════════════════════════════════
section('5. openClientModal — edit existing');

var sb5 = makeSandbox({
  STORE: {
    clients: function(){ return [{ id:'c1', name:'Test SA', contact:'Bob', addr:'Lyon', mf:'MF99', tel:'111' }]; },
    saveClients: function(d){ this._clients=d; },
    _clients: [], invoices: function(){ return []; }
  }
});
load(sb5, 'js/shared/clients.js');
vm.runInContext("openClientModal('c1')", sb5);
ok(sb5._els['cm-id'].value === 'c1',       'cm-id populated');
ok(sb5._els['cm-name'].value === 'Test SA', 'cm-name populated');
ok(sb5._els['cm-contact'].value === 'Bob', 'cm-contact populated');
ok(sb5._els['cm-tel'].value === '111',     'cm-tel populated');

// ═════════════════════════════════════════════════════════════════════
// SECTION 6: closeClientModal
// ═════════════════════════════════════════════════════════════════════
section('6. closeClientModal');

var sb6 = makeSandbox();
load(sb6, 'js/shared/clients.js');
vm.runInContext("openClientModal('')", sb6);
vm.runInContext('closeClientModal()', sb6);
ok(sb6._els['client-modal'].style.display === 'none', 'closeClientModal() sets display none');

// ═════════════════════════════════════════════════════════════════════
// SECTION 7: saveClient — create new
// ═════════════════════════════════════════════════════════════════════
section('7. saveClient — create new');

var saved7 = [];
var sb7 = makeSandbox({
  STORE: {
    clients: function(){ return saved7.slice(); },
    saveClients: function(d){ saved7=d; },
    invoices: function(){ return []; }
  }
});
load(sb7, 'js/shared/clients.js');
sb7._els['cm-id'].value = '';
sb7._els['cm-name'].value = 'New Corp';
sb7._els['cm-contact'].value = 'Jane';
sb7._els['cm-addr'].value = 'Tunis';
sb7._els['cm-mf'].value = 'MF123';
sb7._els['cm-tel'].value = '99999';
var threw7=false;
try { vm.runInContext('saveClient()', sb7); } catch(e){ threw7=true; console.log('  ERROR 7: '+e.message); }
ok(!threw7, 'saveClient() create does not throw');
ok(saved7.length === 1, 'saveClient() adds client to store');
ok(saved7[0].name === 'New Corp', 'saveClient() saves name');
ok(saved7[0].tel === '99999',    'saveClient() saves tel');
ok(typeof saved7[0].id === 'string' && saved7[0].id.length > 0, 'saveClient() generates id');

// ═════════════════════════════════════════════════════════════════════
// SECTION 8: saveClient — update existing
// ═════════════════════════════════════════════════════════════════════
section('8. saveClient — update existing');

var saved8 = [{ id:'c1', name:'Old Name', contact:'', addr:'', mf:'', tel:'' }];
var sb8 = makeSandbox({
  STORE: {
    clients: function(){ return saved8.slice(); },
    saveClients: function(d){ saved8=d; },
    invoices: function(){ return []; }
  }
});
load(sb8, 'js/shared/clients.js');
sb8._els['cm-id'].value = 'c1';
sb8._els['cm-name'].value = 'Updated Name';
sb8._els['cm-contact'].value = '';
sb8._els['cm-addr'].value = '';
sb8._els['cm-mf'].value = '';
sb8._els['cm-tel'].value = '';
vm.runInContext('saveClient()', sb8);
ok(saved8.length === 1, 'saveClient() update does not duplicate');
ok(saved8[0].name === 'Updated Name', 'saveClient() updates name');

// ═════════════════════════════════════════════════════════════════════
// SECTION 9: saveClient — LOGGER guard (LOGGER absent)
// ═════════════════════════════════════════════════════════════════════
section('9. saveClient — LOGGER guard when LOGGER absent');

var saved9 = [];
var sb9 = makeSandbox({
  STORE: {
    clients: function(){ return saved9.slice(); },
    saveClients: function(d){ saved9=d; },
    invoices: function(){ return []; }
  }
  // no LOGGER defined → typeof check should guard it
});
load(sb9, 'js/shared/clients.js');
sb9._els['cm-id'].value = '';
sb9._els['cm-name'].value = 'Safe';
sb9._els['cm-contact'].value=''; sb9._els['cm-addr'].value=''; sb9._els['cm-mf'].value=''; sb9._els['cm-tel'].value='';
var threw9=false;
try { vm.runInContext('saveClient()', sb9); } catch(e){ threw9=true; console.log('  ERROR 9: '+e.message); }
ok(!threw9, 'saveClient() does not throw when LOGGER is absent');

// ═════════════════════════════════════════════════════════════════════
// SECTION 10: deleteClient — confirmed
// ═════════════════════════════════════════════════════════════════════
section('10. deleteClient — confirmed');

var saved10 = [{ id:'c1', name:'A' }, { id:'c2', name:'B' }];
var sb10 = makeSandbox({
  STORE: {
    clients: function(){ return saved10.slice(); },
    saveClients: function(d){ saved10=d; },
    invoices: function(){ return []; }
  }
});
load(sb10, 'js/shared/clients.js');
var threw10=false;
try { vm.runInContext("deleteClient('c1')", sb10); } catch(e){ threw10=true; console.log('  ERROR 10: '+e.message); }
ok(!threw10, 'deleteClient() confirmed does not throw');
ok(saved10.length === 1, 'deleteClient() removes one entry');
ok(saved10[0].id === 'c2', 'deleteClient() removes the correct entry');

// ═════════════════════════════════════════════════════════════════════
// SECTION 11: deleteClient — cancelled
// ═════════════════════════════════════════════════════════════════════
section('11. deleteClient — cancelled');

var saved11 = [{ id:'c1', name:'A' }];
var sb11 = makeSandbox({
  confirm: function(){ return false; },
  STORE: {
    clients: function(){ return saved11.slice(); },
    saveClients: function(d){ saved11=d; },
    invoices: function(){ return []; }
  }
});
load(sb11, 'js/shared/clients.js');
vm.runInContext("deleteClient('c1')", sb11);
ok(saved11.length === 1, 'deleteClient() cancelled leaves store unchanged');

// ═════════════════════════════════════════════════════════════════════
// SECTION 12: showClientDetail — unknown id
// ═════════════════════════════════════════════════════════════════════
section('12. showClientDetail — unknown id');

var sb12 = makeSandbox();
load(sb12, 'js/shared/clients.js');
var threw12=false;
try { vm.runInContext("showClientDetail('unknown')", sb12); } catch(e){ threw12=true; console.log('  ERROR 12: '+e.message); }
ok(!threw12, 'showClientDetail() with unknown id does not throw');

// ═════════════════════════════════════════════════════════════════════
// SECTION 13: showClientDetail — known client, no invoices
// ═════════════════════════════════════════════════════════════════════
section('13. showClientDetail — known client, no invoices');

var sb13 = makeSandbox({
  STORE: {
    clients: function(){ return [{ id:'c1', name:'ACME', contact:'Alice', tel:'22', addr:'Paris', mf:'' }]; },
    saveClients: function(d){ this._c=d; },
    invoices: function(){ return []; }
  }
});
var showViewCalled13 = false;
sb13.showView = function(v){ showViewCalled13 = (v === 'client-detail'); };
load(sb13, 'js/shared/clients.js');
var threw13=false;
try { vm.runInContext("showClientDetail('c1')", sb13); } catch(e){ threw13=true; console.log('  ERROR 13: '+e.message); }
ok(!threw13, 'showClientDetail() with known client does not throw');
ok(sb13._els['client-detail-name'].textContent === 'ACME', 'showClientDetail() sets client name');
ok(showViewCalled13, 'showClientDetail() calls showView("client-detail")');
ok(vm.runInContext('currentClientDetailId', sb13) === 'c1', 'showClientDetail() sets currentClientDetailId');

// ═════════════════════════════════════════════════════════════════════
// SECTION 14: showClientDetail — client with invoices
// ═════════════════════════════════════════════════════════════════════
section('14. showClientDetail — client with invoices');

var sb14 = makeSandbox({
  STORE: {
    clients: function(){ return [{ id:'c1', name:'BigCo', contact:'', tel:'', addr:'', mf:'' }]; },
    saveClients: function(d){ this._c=d; },
    invoices: function(){ return [
      { id:'i1', clientId:'c1', clientName:'BigCo', num:'F001', date:'2026-01-01', ttc:1000, status:'paid' }
    ]; }
  }
});
load(sb14, 'js/shared/clients.js');
var threw14=false;
try { vm.runInContext("showClientDetail('c1')", sb14); } catch(e){ threw14=true; console.log('  ERROR 14: '+e.message); }
ok(!threw14, 'showClientDetail() with invoices does not throw');
ok(sb14._els['client-detail-invoices'].innerHTML.indexOf('F001') !== -1,
  'showClientDetail() renders invoice number');
ok(sb14._els['client-detail-stats'].innerHTML.indexOf('1') !== -1,
  'showClientDetail() stats show invoice count');

// ═════════════════════════════════════════════════════════════════════
// SECTION 15: Regression — full chain coexistence
// ═════════════════════════════════════════════════════════════════════
section('15. Regression — full shared modules chain coexist');

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

  ok(typeof sbR.showView === 'function',             'showView still present');
  ok(typeof sbR.renderCalendrier === 'function',     'renderCalendrier still present');
  ok(typeof sbR.updateDashboardStats === 'function', 'updateDashboardStats still present');
  ok(typeof sbR.renderNatures === 'function',        'renderNatures still present');
  ok(typeof sbR.renderClients === 'function',        'renderClients a function after chain load');
  ok(typeof sbR.saveClient === 'function',           'saveClient a function after chain load');
  ok(typeof sbR._storeSave === 'function',           '_storeSave still present');
  ok(sbR.currentClientDetailId === '',               'currentClientDetailId initialized to ""');
})();

// ═════════════════════════════════════════════════════════════════════
// Results
// ═════════════════════════════════════════════════════════════════════
console.log('\n' + (_fail === 0 ? '✓' : '✗') +
  ' ' + _pass + '/' + (_pass + _fail) + ' tests passed');
if (_fail > 0) process.exit(1);
