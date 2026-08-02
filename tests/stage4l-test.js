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

function makeEl(id) {
  return {
    id:id, value:'', innerHTML:'', textContent:'', checked:false, src:'',
    style:{display:''}, children:[],
    appendChild:function(child){ this.children.push(child); },
    remove:function(){ this.removed=true; }
  };
}

function sandbox(overrides) {
  var els = {};
  [
    'om-list','om-plaque','om-logo-preview','om-societe-preview','om-chauffeur',
    'om-cin','om-permis','om-edit-id','om-form-title','om-date','om-heure',
    'om-date-arrivee','om-heure-arrivee','om-depart','om-arrivee','om-mission-type',
    'om-mission','om-addStamp','om-persons-body','om-preview','om-preview-modal'
  ].forEach(function(id){ els[id]=makeEl(id); });
  var state = {oms:[],vehicles:[],collabs:[],views:[],alerts:[],sidebar:0};
  var rows = [];
  var sb = {
    MYTHOS_PRINT_LOGO_SRC:'mythos.png', SDT_PRINT_LOGO_SRC:'sdt.png',
    document:{
      getElementById:function(id){ return els[id] || null; },
      querySelectorAll:function(sel){ return sel === '#om-persons-body tr' ? rows : []; },
      createElement:function(){
        var row=makeEl('');
        row.querySelector=function(sel){ return sel === 'input' ? {value:row.personName || ''} : null; };
        rows.push(row);
        return row;
      }
    },
    STORE:{
      oms:function(){return state.oms;}, saveOms:function(v){state.oms=v;},
      vehicules:function(){return state.vehicles;}, saveVehicules:function(v){state.vehicles=v;},
      collabs:function(){return state.collabs;}, saveCollabs:function(v){state.collabs=v;}
    },
    _els:els, _rows:rows, _state:state,
    esc:function(v){return String(v == null ? '' : v).replace(/</g,'&lt;');},
    cleanPrintText:function(v){return String(v || '');},
    formatDateLong:function(v){return 'LONG:'+String(v || '');},
    todayStr:function(){return '2026-08-02';},
    dateInputValue:function(offset){return 'DATE:'+offset;},
    getStampSVG:function(){return 'stamp.svg';},
    showView:function(v){state.views.push(v);},
    updateSidebarStats:function(){state.sidebar++;},
    alert:function(v){state.alerts.push(v);},
    confirm:function(){return true;},
    prompt:function(){return null;},
    console:{log:function(){},warn:function(){},error:function(){}},
    Date:Date, Array:Array, Object:Object, String:String, Number:Number,
    Math:Math, parseInt:parseInt, setTimeout:function(){}
  };
  Object.assign(sb, overrides || {});
  return vm.createContext(sb);
}

function load(sb, file) {
  vm.runInContext(fs.readFileSync(path.join(BASE, file), 'utf8'), sb);
}

console.log('\n1. Exported globals');
var s = sandbox(); load(s, 'js/shared/mission-orders.js');
[
  'renderOMList','ensureDefaultVehicules','renderOmVehiculeOptions','updateOmLogoPreview',
  'onOmVehiculeChange','addOmVehicule','initOMForm','setOmDateQuick','setOmTimeQuick',
  'applyOmMissionType','addOmPerson','getOMPersons','saveOM','editOM','deleteOM',
  'cancelOM','previewOM','closeOMPreview','buildOMHTML'
].forEach(function(name){ok(typeof s[name] === 'function', name+' is global');});
ok(vm.runInContext('stableOmPersonCount',s) === 0, 'person counter initialized');

console.log('\n2. Rendering and vehicles');
s.renderOMList();
ok(s._els['om-list'].innerHTML.indexOf('Aucun ordre') >= 0, 'empty state rendered');
s._state.oms=[{id:'o1',date:'2026-08-02',heure:'13:30',depart:'A < B',arrivee:'Tunis',persons:[{}]}];
s.renderOMList();
ok(s._els['om-list'].innerHTML.indexOf('A &lt; B') >= 0, 'mission route escaped');
ok(s._els['om-list'].innerHTML.indexOf('Nombre de personnes : 1') >= 0, 'person count rendered');
s._state.vehicles=[];
var vehicles=s.ensureDefaultVehicules();
ok(vehicles.length === 3, 'default vehicles created');
ok(vehicles.some(function(v){return v.plaque==='175-5401' && v.societe==='sdt';}), 'SDT vehicle created');
s._state.vehicles=[{id:'old',plaque:'OLD'}];
s.ensureDefaultVehicules();
ok(s._state.vehicles[0].societe === 'mythos', 'legacy vehicle company migrated');
s.renderOmVehiculeOptions('OLD');
ok(s._els['om-plaque'].innerHTML.indexOf('OLD') >= 0, 'vehicle options rendered');
ok(s._els['om-logo-preview'].src === 'mythos.png', 'company logo preview updated');
s._state.vehicles=[{plaque:'P1',chauffeur:'Driver',cin:'CIN',permis:'PER',societe:'mythos'},{plaque:'175-5401',societe:'sdt'}];
s._els['om-plaque'].value='P1'; s.onOmVehiculeChange();
ok(s._els['om-chauffeur'].value === 'Driver', 'driver synchronized');
ok(s._els['om-cin'].value === 'CIN' && s._els['om-permis'].value === 'PER', 'driver documents synchronized');

console.log('\n3. Form helpers');
s._els['om-mission-type'].value='aller_simple'; s.applyOmMissionType();
ok(s._els['om-mission'].value.indexOf('transport du groupe') >= 0, 'mission type applied');
s.setOmDateQuick(2); ok(s._els['om-date'].value === 'DATE:2', 'quick date applied');
s.setOmTimeQuick('09:15'); ok(s._els['om-heure'].value === '09:15', 'quick time applied');
s._rows.length=0; vm.runInContext('stableOmPersonCount=0',s); s.addOmPerson('Ali');
ok(vm.runInContext('stableOmPersonCount',s) === 1, 'person counter incremented');
ok(s._els['om-persons-body'].children.length === 1, 'person row appended');
s.initOMForm();
ok(s._els['om-date'].value === '2026-08-02', 'form date initialized');
ok(s._els['om-chauffeur'].value === 'Othman Haddad', 'default driver initialized');
ok(vm.runInContext('stableOmPersonCount',s) === 11, 'eleven default person rows created');

function setForm(sb,id) {
  sb._els['om-edit-id'].value=id||''; sb._els['om-plaque'].value='P2';
  sb._els['om-chauffeur'].value='New Driver'; sb._els['om-cin'].value='1';
  sb._els['om-permis'].value='2'; sb._els['om-date'].value='2026-08-03';
  sb._els['om-heure'].value='10:00'; sb._els['om-date-arrivee'].value='';
  sb._els['om-heure-arrivee'].value=''; sb._els['om-depart'].value='A';
  sb._els['om-arrivee'].value='B'; sb._els['om-mission-type'].value='aller_retour';
  sb._els['om-mission'].value='Mission'; sb._els['om-addStamp'].checked=true;
}

console.log('\n4. CRUD');
var c=sandbox(); load(c,'js/shared/mission-orders.js'); c._state.vehicles=[{plaque:'175-5401',societe:'sdt'}]; setForm(c);
c.saveOM();
ok(c._state.oms.length === 1, 'mission order created');
ok(c._state.collabs.length === 1 && c._state.collabs[0].role === 'Chauffeur', 'driver collaborator created');
ok(c._state.vehicles.some(function(v){return v.plaque==='P2';}), 'vehicle created from mission');
ok(c._state.views.pop() === 'om-list', 'save returns to list');
var id=c._state.oms[0].id; setForm(c,id); c._els['om-arrivee'].value='C'; c.saveOM();
ok(c._state.oms.length === 1 && c._state.oms[0].arrivee === 'C', 'mission order updated');
ok(c._state.collabs.length === 1, 'existing collaborator not duplicated');
c.editOM(id);
ok(c._state.views.pop() === 'om-new', 'edit opens form');
ok(c._els['om-edit-id'].value === id, 'edit populates identifier');
c.previewOM(id);
ok(c._els['om-preview-modal'].style.display === 'flex', 'preview opened');
ok(c._els['om-preview'].innerHTML.indexOf('ORDRE DE MISSION') >= 0, 'preview HTML built');
c.closeOMPreview(); ok(c._els['om-preview-modal'].style.display === 'none', 'preview closed');
c.deleteOM(id); ok(c._state.oms.length === 0, 'mission order deleted');
ok(c._state.sidebar === 1, 'delete refreshes sidebar');
c.cancelOM(); ok(c._state.views.pop() === 'om-list', 'cancel returns to list');

var guard=sandbox(); load(guard,'js/shared/mission-orders.js'); setForm(guard); guard._els['om-chauffeur'].value=''; guard.saveOM();
ok(guard._state.alerts.length === 1 && guard._state.oms.length === 0, 'required fields validated');
var cancelled=sandbox({confirm:function(){return false;}}); load(cancelled,'js/shared/mission-orders.js'); cancelled._state.oms=[{id:'keep'}]; cancelled.deleteOM('keep');
ok(cancelled._state.oms.length === 1, 'cancelled delete preserves mission');

console.log('\n5. Integration');
var html=fs.readFileSync(path.join(BASE,'index.html'),'utf8');
ok(html.indexOf('js/shared/mission-orders.js') > html.indexOf('js/shared/contracts.js'), 'mission orders script follows shared dependencies');
var app=fs.readFileSync(path.join(BASE,'js/app.js'),'utf8');
ok((app.match(/function renderOMList/g)||[]).length === 0, 'renderOMList removed from app.js');
ok((app.match(/function saveOM/g)||[]).length === 0, 'saveOM removed from app.js');
ok((app.match(/function buildOMHTML/g)||[]).length === 0, 'buildOMHTML removed from app.js');
ok(typeof c.previewOM === 'function' && typeof c.editOM === 'function', 'collaborateur compatibility globals preserved');

console.log('\nStage 4L: '+pass+' passed, '+fail+' failed');
if(fail) process.exit(1);
