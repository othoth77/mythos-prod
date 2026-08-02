// =====================================================
// MYTHOS OS — Stage 4K Test
// tests/stage4k-test.js
//
// Verifies Contracts CRUD globals extracted into
// js/shared/contracts.js behave identically to
// the original app.js implementation.
//
// Run with: node tests/stage4k-test.js
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
    checked: false,
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
    'contracts-list',
    'contract-edit-id', 'contract-form-title', 'contract-date', 'contract-ref',
    'contract-client-name', 'contract-client-select', 'contract-details',
    'contract-amount', 'contract-retention-rate',
    'contract-vat-advance-enabled', 'contract-vat-advance-amount',
    'contract-status', 'contract-payment-mode',
    'contract-retention-amount', 'contract-tax-total', 'contract-net-amount',
    'contract-vat-advance-group'
  ].forEach(ensureEl);

  var sb = {
    document: {
      getElementById: function(id) { return getEl(id) || null; },
      querySelectorAll: function(sel) { return []; },
      createElement: function(tag) {
        var el = { tagName: tag, id: '', style: { cssText: '' }, innerHTML: '',
          _children: [],
          appendChild: function(c){ this._children.push(c); },
          querySelector: function(s) { return null; },
          remove: noop
        };
        return el;
      },
      body: { appendChild: noop }, addEventListener: noop
    },
    window: { addEventListener: noop, open: function(){ return { document:{write:noop,close:noop}, print:noop }; } },
    location: { hash: '' },
    _els: els,
    console: { log: noop, warn: noop, error: noop },
    confirm: function() { return true; },
    alert: noop,
    setTimeout: function(fn) { /* don't call fn */ },

    // Utils
    esc:        function(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); },
    fmtMoney:   function(v) { return parseFloat(v||0).toFixed(3); },
    num:        function(v) { return Number(v||0); },
    formatDate: function(s) { return String(s||''); },
    todayStr:   function() { return '2026-08-01'; },

    // Router stubs
    showView:          noop,
    updateSidebarStats: noop,

    // Default STORE
    STORE: {
      contracts:     function() { return []; },
      saveContracts: function(d) { this._c = d; },
      _c: [],
      clients:       function() { return []; },
      saveClients:   function(d) { this._cl = d; }
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
// SECTION 1: Globals exported by js/shared/contracts.js
// ═════════════════════════════════════════════════════════════════════
section('1. Globals exported by js/shared/contracts.js');

var sb1 = makeSandbox();
load(sb1, 'js/shared/contracts.js');

ok(typeof sb1.nextContractRef !== 'undefined',             'nextContractRef is defined');
ok(typeof sb1.contractTotals !== 'undefined',              'contractTotals is defined');
ok(typeof sb1.contractStatusLabel !== 'undefined',         'contractStatusLabel is defined');
ok(typeof sb1.fillContractClientSelect !== 'undefined',    'fillContractClientSelect is defined');
ok(typeof sb1.fillContractClientFromSelect !== 'undefined','fillContractClientFromSelect is defined');
ok(typeof sb1.toggleContractVatAdvance !== 'undefined',    'toggleContractVatAdvance is defined');
ok(typeof sb1.calcContractTotals !== 'undefined',          'calcContractTotals is defined');
ok(typeof sb1.renderContracts !== 'undefined',             'renderContracts is defined');
ok(typeof sb1.initContractForm !== 'undefined',            'initContractForm is defined');
ok(typeof sb1.saveContract !== 'undefined',                'saveContract is defined');
ok(typeof sb1.editContract !== 'undefined',                'editContract is defined');
ok(typeof sb1.deleteContract !== 'undefined',              'deleteContract is defined');
ok(typeof sb1.cancelContractForm !== 'undefined',          'cancelContractForm is defined');

// ═════════════════════════════════════════════════════════════════════
// SECTION 2: renderContracts — empty STORE
// ═════════════════════════════════════════════════════════════════════
section('2. renderContracts — empty STORE');

var sb2 = makeSandbox();
load(sb2, 'js/shared/contracts.js');
var threw2 = false;
try { vm.runInContext('renderContracts()', sb2); } catch(e) { threw2=true; console.log('  ERROR: '+e.message); }
ok(!threw2, 'renderContracts() with empty store does not throw');
ok(sb2._els['contracts-list'].innerHTML.indexOf('Aucun contrat') !== -1,
  'renderContracts() shows empty-state with no contracts');

// ═════════════════════════════════════════════════════════════════════
// SECTION 3: renderContracts — with data
// ═════════════════════════════════════════════════════════════════════
section('3. renderContracts — with data');

var sb3 = makeSandbox({
  STORE: {
    contracts: function(){ return [
      { id:'c1', ref:'CONT-2026-001', clientName:'Ali Corp', date:'2026-07-15',
        amount:5000, retentionRate:10, vatAdvanceEnabled:false, vatAdvanceAmount:0, status:'pending' }
    ]; },
    saveContracts: function(d){ this._c=d; },
    clients: function(){ return []; },
    saveClients: function(d){}
  }
});
load(sb3, 'js/shared/contracts.js');
var threw3 = false;
try { vm.runInContext('renderContracts()', sb3); } catch(e) { threw3=true; console.log('  ERROR 3: '+e.message); }
ok(!threw3, 'renderContracts() with data does not throw');
ok(sb3._els['contracts-list'].innerHTML.indexOf('CONT-2026-001') !== -1,
  'renderContracts() renders contract ref');
ok(sb3._els['contracts-list'].innerHTML.indexOf('Ali Corp') !== -1,
  'renderContracts() renders client name');

// ═════════════════════════════════════════════════════════════════════
// SECTION 4: nextContractRef
// ═════════════════════════════════════════════════════════════════════
section('4. nextContractRef');

var sb4 = makeSandbox({
  STORE: {
    contracts: function(){ return []; },
    saveContracts: function(d){},
    clients: function(){ return []; },
    saveClients: function(d){}
  }
});
load(sb4, 'js/shared/contracts.js');
var ref = vm.runInContext('nextContractRef(2026)', sb4);
ok(typeof ref === 'string' && ref.indexOf('CONT-2026-') === 0, 'nextContractRef() returns expected format');
ok(ref === 'CONT-2026-001', 'nextContractRef() returns 001 when store is empty');

// ═════════════════════════════════════════════════════════════════════
// SECTION 5: nextContractRef — with existing contracts
// ═════════════════════════════════════════════════════════════════════
section('5. nextContractRef — with existing contracts');

var sb5 = makeSandbox({
  STORE: {
    contracts: function(){ return [
      { ref:'CONT-2026-001' }, { ref:'CONT-2026-002' }, { ref:'CONT-2026-003' }
    ]; },
    saveContracts: function(d){},
    clients: function(){ return []; },
    saveClients: function(d){}
  }
});
load(sb5, 'js/shared/contracts.js');
var ref5 = vm.runInContext('nextContractRef(2026)', sb5);
ok(ref5 === 'CONT-2026-004', 'nextContractRef() increments correctly');

// ═════════════════════════════════════════════════════════════════════
// SECTION 6: contractTotals
// ═════════════════════════════════════════════════════════════════════
section('6. contractTotals');

var sb6 = makeSandbox();
load(sb6, 'js/shared/contracts.js');
var totals = vm.runInContext("contractTotals({ amount:1000, retentionRate:10, vatAdvanceEnabled:true, vatAdvanceAmount:50 })", sb6);
ok(totals.amount === 1000,  'contractTotals returns amount');
ok(totals.rate === 10,      'contractTotals returns rate');
ok(totals.retention === 100,'contractTotals calculates retention (1000×10÷100)');
ok(totals.vatAdvance === 50,'contractTotals returns vatAdvance');
ok(totals.taxes === 150,    'contractTotals calculates taxes (retenue + avance)');
ok(totals.net === 850,      'contractTotals calculates net (amount - taxes)');

// ═════════════════════════════════════════════════════════════════════
// SECTION 7: contractStatusLabel
// ═════════════════════════════════════════════════════════════════════
section('7. contractStatusLabel');

var sb7 = makeSandbox();
load(sb7, 'js/shared/contracts.js');
ok(vm.runInContext("contractStatusLabel('paid')", sb7) === 'Pay\u00e9',    'contractStatusLabel returns Payé for paid');
ok(vm.runInContext("contractStatusLabel('pending')", sb7) === 'Non pay\u00e9', 'contractStatusLabel returns Non payé for pending');
ok(vm.runInContext("contractStatusLabel('anything')", sb7) === 'Non pay\u00e9','contractStatusLabel returns Non payé for other');

// ═════════════════════════════════════════════════════════════════════
// SECTION 8: fillContractClientSelect
// ═════════════════════════════════════════════════════════════════════
section('8. fillContractClientSelect');

var sb8 = makeSandbox({
  STORE: {
    contracts: function(){ return []; },
    saveContracts: function(d){},
    clients: function(){ return [{ id:'c1', name:'Acme', contact:'' }, { id:'c2', name:'Beta', contact:'' }]; },
    saveClients: function(d){}
  }
});
load(sb8, 'js/shared/contracts.js');
var threw8 = false;
try { vm.runInContext('fillContractClientSelect()', sb8); } catch(e) { threw8=true; console.log('  ERROR 8: '+e.message); }
ok(!threw8, 'fillContractClientSelect() does not throw');
ok(sb8._els['contract-client-select'].innerHTML.indexOf('Acme') !== -1,
  'fillContractClientSelect() includes client name in options');
ok(sb8._els['contract-client-select'].innerHTML.indexOf('Beta') !== -1,
  'fillContractClientSelect() includes second client');

// ═════════════════════════════════════════════════════════════════════
// SECTION 9: fillContractClientFromSelect — match
// ═════════════════════════════════════════════════════════════════════
section('9. fillContractClientFromSelect — match');

var sb9 = makeSandbox({
  STORE: {
    contracts: function(){ return []; },
    saveContracts: function(d){},
    clients: function(){ return [{ id:'c1', name:'SynCo', contact:'Bob' }]; },
    saveClients: function(d){}
  }
});
load(sb9, 'js/shared/contracts.js');
sb9._els['contract-client-select'].value = 'c1';
var threw9 = false;
try { vm.runInContext('fillContractClientFromSelect()', sb9); } catch(e) { threw9=true; console.log('  ERROR 9: '+e.message); }
ok(!threw9, 'fillContractClientFromSelect() does not throw');
ok(sb9._els['contract-client-name'].value === 'SynCo',
  'fillContractClientFromSelect() sets client name');

// ═════════════════════════════════════════════════════════════════════
// SECTION 10: fillContractClientFromSelect — no match / empty
// ═════════════════════════════════════════════════════════════════════
section('10. fillContractClientFromSelect — no match');

var sb10 = makeSandbox();
load(sb10, 'js/shared/contracts.js');
sb10._els['contract-client-select'].value = 'nonexistent';
var threw10 = false;
try { vm.runInContext('fillContractClientFromSelect()', sb10); } catch(e) { threw10=true; }
ok(!threw10, 'fillContractClientFromSelect() with no match does not throw');

// ═════════════════════════════════════════════════════════════════════
// SECTION 11: toggleContractVatAdvance and calcContractTotals
// ═════════════════════════════════════════════════════════════════════
section('11. toggleContractVatAdvance and calcContractTotals');

var sb11 = makeSandbox();
load(sb11, 'js/shared/contracts.js');
sb11._els['contract-vat-advance-enabled'].checked = true;
sb11._els['contract-vat-advance-amount'].value = '100';
sb11._els['contract-amount'].value = '2000';
sb11._els['contract-retention-rate'].value = '5';
var threw11 = false;
try { vm.runInContext('toggleContractVatAdvance()', sb11); } catch(e) { threw11=true; console.log('  ERROR 11: '+e.message); }
ok(!threw11, 'toggleContractVatAdvance() does not throw');
ok(sb11._els['contract-vat-advance-group'].style.display === '',
  'toggleContractVatAdvance() shows vat advance group when enabled');
ok(sb11._els['contract-retention-amount'].value === '100.000',
  'calcContractTotals() sets retention amount');
ok(sb11._els['contract-tax-total'].value === '200.000',
  'calcContractTotals() sets tax total');
ok(sb11._els['contract-net-amount'].value === '1800.000',
  'calcContractTotals() sets net amount');

// ═════════════════════════════════════════════════════════════════════
// SECTION 12: toggleContractVatAdvance — disabled
// ═════════════════════════════════════════════════════════════════════
section('12. toggleContractVatAdvance — disabled');

var sb12 = makeSandbox();
load(sb12, 'js/shared/contracts.js');
sb12._els['contract-vat-advance-enabled'].checked = false;
vm.runInContext('toggleContractVatAdvance()', sb12);
ok(sb12._els['contract-vat-advance-group'].style.display === 'none',
  'toggleContractVatAdvance() hides vat advance group when disabled');

// ═════════════════════════════════════════════════════════════════════
// SECTION 13: initContractForm
// ═════════════════════════════════════════════════════════════════════
section('13. initContractForm');

var sb13 = makeSandbox();
load(sb13, 'js/shared/contracts.js');
var threw13 = false;
try { vm.runInContext('initContractForm()', sb13); } catch(e) { threw13=true; console.log('  ERROR 13: '+e.message); }
ok(!threw13, 'initContractForm() does not throw');
ok(sb13._els['contract-edit-id'].value === '', 'initContractForm() clears edit id');
ok(sb13._els['contract-form-title'].innerHTML.indexOf('Nouveau') !== -1,
  'initContractForm() sets title to Nouveau');
ok(sb13._els['contract-amount'].value == 0, 'initContractForm() sets amount to 0');
ok(sb13._els['contract-retention-rate'].value == 0, 'initContractForm() sets retention rate to 0');
ok(sb13._els['contract-status'].value === 'pending', 'initContractForm() sets status to pending');

// ═════════════════════════════════════════════════════════════════════
// SECTION 14: saveContract — create new
// ═════════════════════════════════════════════════════════════════════
section('14. saveContract — create new');

var saved14 = [];
var sb14 = makeSandbox({
  STORE: {
    contracts: function(){ return saved14.slice(); },
    saveContracts: function(d){ saved14=d; },
    clients: function(){ return []; },
    saveClients: function(d){ this._cl=d; }
  }
});
load(sb14, 'js/shared/contracts.js');
sb14._els['contract-edit-id'].value = '';
sb14._els['contract-client-name'].value = 'New Client';
sb14._els['contract-date'].value = '2026-08-01';
sb14._els['contract-ref'].value = 'CONT-2026-005';
sb14._els['contract-amount'].value = '5000';
sb14._els['contract-retention-rate'].value = '10';
sb14._els['contract-status'].value = 'pending';
sb14._els['contract-client-select'].value = '';
var threw14 = false;
try { vm.runInContext('saveContract()', sb14); } catch(e) { threw14=true; console.log('  ERROR 14: '+e.message); }
ok(!threw14, 'saveContract() create does not throw');
ok(saved14.length === 1, 'saveContract() adds contract to store');
ok(saved14[0].ref === 'CONT-2026-005', 'saveContract() saves ref');
ok(saved14[0].clientName === 'New Client', 'saveContract() saves client name');
ok(saved14[0].amount === 5000, 'saveContract() saves amount as number');
ok(typeof saved14[0].id === 'string' && saved14[0].id.length > 0, 'saveContract() generates id');

// ═════════════════════════════════════════════════════════════════════
// SECTION 15: saveContract — update existing
// ═════════════════════════════════════════════════════════════════════
section('15. saveContract — update existing');

var saved15 = [{ id:'c1', ref:'CONT-2026-001', clientName:'Old Co', date:'2026-07-01',
  amount:1000, retentionRate:5, vatAdvanceEnabled:false, vatAdvanceAmount:0, status:'pending',
  clientId:'', details:'', paymentMode:'Virement bancaire' }];
var sb15 = makeSandbox({
  STORE: {
    contracts: function(){ return saved15.slice(); },
    saveContracts: function(d){ saved15=d; },
    clients: function(){ return []; },
    saveClients: function(d){}
  }
});
load(sb15, 'js/shared/contracts.js');
sb15._els['contract-edit-id'].value = 'c1';
sb15._els['contract-client-name'].value = 'Updated Co';
sb15._els['contract-date'].value = '2026-08-01';
sb15._els['contract-ref'].value = 'CONT-2026-002';
sb15._els['contract-amount'].value = '2000';
sb15._els['contract-retention-rate'].value = '8';
sb15._els['contract-status'].value = 'paid';
sb15._els['contract-client-select'].value = '';
vm.runInContext('saveContract()', sb15);
ok(saved15.length === 1, 'saveContract() update does not duplicate');
ok(saved15[0].clientName === 'Updated Co', 'saveContract() updates client name');
ok(saved15[0].amount === 2000, 'saveContract() updates amount');
ok(saved15[0].status === 'paid', 'saveContract() updates status');

// ═════════════════════════════════════════════════════════════════════
// SECTION 16: saveContract — missing client name (guard)
// ═════════════════════════════════════════════════════════════════════
section('16. saveContract — missing client name or date');

var saved16 = [];
var alerted16 = false;
var sb16 = makeSandbox({
  STORE: {
    contracts: function(){ return saved16.slice(); },
    saveContracts: function(d){ saved16=d; },
    clients: function(){ return []; },
    saveClients: function(d){}
  },
  alert: function(msg) { alerted16=true; }
});
load(sb16, 'js/shared/contracts.js');
sb16._els['contract-edit-id'].value = '';
sb16._els['contract-client-name'].value = '';
sb16._els['contract-date'].value = '2026-08-01';
vm.runInContext('saveContract()', sb16);
ok(saved16.length === 0, 'saveContract() blocked — no client name');
ok(alerted16, 'saveContract() alerts when client missing');
alerted16 = false;
sb16._els['contract-client-name'].value = 'Client OK';
sb16._els['contract-date'].value = '';
vm.runInContext('saveContract()', sb16);
ok(saved16.length === 0, 'saveContract() blocked — no date');

// ═════════════════════════════════════════════════════════════════════
// SECTION 17: editContract — open edit form
// ═════════════════════════════════════════════════════════════════════
section('17. editContract — open edit form');

var sb17 = makeSandbox({
  STORE: {
    contracts: function(){ return [
      { id:'c1', ref:'CONT-2026-001', clientName:'EditCo', clientId:'cl1',
        date:'2026-07-15', details:'Test details', amount:3000, retentionRate:15,
        vatAdvanceEnabled:true, vatAdvanceAmount:200, status:'pending', paymentMode:'Virement bancaire' }
    ]; },
    saveContracts: function(d){},
    clients: function(){ return [{ id:'cl1', name:'EditCo', contact:'' }]; },
    saveClients: function(d){}
  }
});
load(sb17, 'js/shared/contracts.js');
var threw17 = false;
try { vm.runInContext("editContract('c1')", sb17); } catch(e) { threw17=true; console.log('  ERROR 17: '+e.message); }
ok(!threw17, 'editContract() does not throw');
ok(sb17._els['contract-edit-id'].value === 'c1', 'editContract() sets edit id');
ok(sb17._els['contract-form-title'].innerHTML.indexOf('Modifier') !== -1,
  'editContract() sets title to Modifier');
ok(sb17._els['contract-client-name'].value === 'EditCo', 'editContract() fills client name');
ok(sb17._els['contract-amount'].value == 3000, 'editContract() fills amount');
ok(sb17._els['contract-retention-rate'].value == 15, 'editContract() fills retention rate');
ok(sb17._els['contract-vat-advance-enabled'].checked === true, 'editContract() sets vat advance enabled');
ok(sb17._els['contract-vat-advance-amount'].value == 200, 'editContract() fills vat advance amount');
ok(sb17._els['contract-status'].value === 'pending', 'editContract() fills status');

// ═════════════════════════════════════════════════════════════════════
// SECTION 18: editContract — unknown id
// ═════════════════════════════════════════════════════════════════════
section('18. editContract — unknown id');

var sb18 = makeSandbox();
load(sb18, 'js/shared/contracts.js');
var threw18 = false;
try { vm.runInContext("editContract('unknown')", sb18); } catch(e) { threw18=true; console.log('  ERROR 18: '+e.message); }
ok(!threw18, 'editContract() with unknown id does not throw');

// ═════════════════════════════════════════════════════════════════════
// SECTION 19: deleteContract — confirmed
// ═════════════════════════════════════════════════════════════════════
section('19. deleteContract — confirmed');

var saved19 = [{ id:'c1', ref:'A' }, { id:'c2', ref:'B' }];
var sb19 = makeSandbox({
  STORE: {
    contracts: function(){ return saved19.slice(); },
    saveContracts: function(d){ saved19=d; },
    clients: function(){ return []; },
    saveClients: function(d){}
  }
});
load(sb19, 'js/shared/contracts.js');
var threw19 = false;
try { vm.runInContext("deleteContract('c1')", sb19); } catch(e) { threw19=true; console.log('  ERROR 19: '+e.message); }
ok(!threw19, 'deleteContract() confirmed does not throw');
ok(saved19.length === 1, 'deleteContract() removes one entry');
ok(saved19[0].id === 'c2', 'deleteContract() removes correct entry');

// ═════════════════════════════════════════════════════════════════════
// SECTION 20: deleteContract — cancelled
// ═════════════════════════════════════════════════════════════════════
section('20. deleteContract — cancelled');

var saved20 = [{ id:'c1', ref:'A' }];
var sb20 = makeSandbox({
  confirm: function(){ return false; },
  STORE: {
    contracts: function(){ return saved20.slice(); },
    saveContracts: function(d){ saved20=d; },
    clients: function(){ return []; },
    saveClients: function(d){}
  }
});
load(sb20, 'js/shared/contracts.js');
vm.runInContext("deleteContract('c1')", sb20);
ok(saved20.length === 1, 'deleteContract() cancelled leaves store unchanged');

// ═════════════════════════════════════════════════════════════════════
// SECTION 21: cancelContractForm
// ═════════════════════════════════════════════════════════════════════
section('21. cancelContractForm');

var sb21 = makeSandbox();
load(sb21, 'js/shared/contracts.js');
var threw21 = false;
try { vm.runInContext('cancelContractForm()', sb21); } catch(e) { threw21=true; console.log('  ERROR 21: '+e.message); }
ok(!threw21, 'cancelContractForm() does not throw');

// ═════════════════════════════════════════════════════════════════════
// SECTION 22: Regression — full shared modules chain coexist
// ═════════════════════════════════════════════════════════════════════
section('22. Regression — full shared modules chain coexist');

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
  load(sbR, 'js/shared/contracts.js');

  ok(typeof sbR.showView === 'function',                       'showView still present');
  ok(typeof sbR.renderCalendrier === 'function',               'renderCalendrier still present');
  ok(typeof sbR.updateDashboardStats === 'function',           'updateDashboardStats still present');
  ok(typeof sbR.renderNatures === 'function',                  'renderNatures still present');
  ok(typeof sbR.renderClients === 'function',                  'renderClients still present');
  ok(typeof sbR.renderCollaborateurs === 'function',           'renderCollaborateurs still present');
  ok(typeof sbR.renderFournisseurs === 'function',             'renderFournisseurs still present');
  ok(typeof sbR.renderRepresentations === 'function',          'renderRepresentations a function after chain load');
  ok(typeof sbR.renderContracts === 'function',                'renderContracts a function after chain load');
  ok(typeof sbR.saveContract === 'function',                   'saveContract a function after chain load');
  ok(typeof sbR.deleteContract === 'function',                 'deleteContract a function after chain load');
  ok(typeof sbR._storeSave === 'function',                     '_storeSave still present');
})();

// ═════════════════════════════════════════════════════════════════════
// Results
// ═════════════════════════════════════════════════════════════════════
console.log('\n' + (_fail === 0 ? '\u2713' : '\u2717') +
  ' ' + _pass + '/' + (_pass + _fail) + ' tests passed');
if (_fail > 0) process.exit(1);