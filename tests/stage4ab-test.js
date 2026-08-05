'use strict';
var vm=require('vm'),fs=require('fs'),path=require('path'),BASE=path.join(__dirname,'..'),pass=0,fail=0;
function ok(v,l){if(v){pass++;console.log('  PASS '+l);}else{fail++;console.log('  FAIL '+l);}}

function makeEl(id){return{id:id,value:'',textContent:'',innerHTML:'',style:{display:'',color:'',borderColor:'',background:'',outline:'',opacity:'',borderStyle:''},_children:[],options:{length:0},appendChild:function(c){this._children.push(c);this.options.length++;},removeChild:function(){},$click:function(){}};}

function sandbox(overrides){
  var contacts=[],imports=[];
  var markDeletedCalls=[],syncCalls=[],showViewCalls=[],alertCalls=[];
  var confirmRet=true;
  var elIds=[
    'repertoire-contacts-tbody','repertoire-contacts-count','repertoire-contacts-info',
    'repertoire-contacts-search','repertoire-imports-history','repertoire-duplicates-banner',
    'rc-sort-select','rc-filter-select','rc-tag-filter','rc-responsable-filter',
    'rc-table-sort-select','rc-table-filter-select','rc-table-tag-filter','rc-table-responsable-filter',
    'rc-panel-repertoire','rc-panel-annuaire','rc-tab-btn-repertoire','rc-tab-btn-annuaire',
    'rc-tab-count-repertoire','btn-rc-show-all',
    'contacts-directory-grid','rc-annuaire-stats','rc-annuaire-counts',
    'contact-fiche-header','contact-fiche-body',
    'cf-history-type','cf-history-note','cf-history-outcome',
    'rc-file-input'
  ];
  var els={};elIds.forEach(function(id){els[id]=makeEl(id);});
  var bodyEl={appendChild:function(){},removeChild:function(){}};
  var sb={
    document:{
      getElementById:function(id){return els[id]||null;},
      querySelectorAll:function(){return[];},
      createElement:function(tag){return makeEl(tag);},
      body:bodyEl,
      addEventListener:function(){}
    },
    STORE:{
      repertoireContacts:function(){return contacts;},
      saveRepertoireContacts:function(v){contacts=v;},
      repertoireImports:function(){return imports;},
      saveRepertoireImports:function(v){imports=v;}
    },
    esc:function(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');},
    _markDeleted:function(store,id){markDeletedCalls.push({store:store,id:id});},
    syncFromServer:function(cb){syncCalls.push(cb);if(typeof cb==='function')cb();},
    showView:function(v){showViewCalls.push(v);},
    alert:function(m){alertCalls.push(m);},
    confirm:function(){return confirmRet;},
    fetch:function(){return Promise.resolve({json:function(){return Promise.resolve({ok:false});}});},
    setTimeout:function(){},clearTimeout:function(){},
    URL:{createObjectURL:function(){return'blob:mock';},revokeObjectURL:function(){}},
    Blob:function(data,opts){this.data=data;this.opts=opts;},
    URLSearchParams:function(s){var self=this;this._p={};String(s||'').replace(/^\?/,'').split('&').forEach(function(pair){var kv=pair.split('=');if(kv[0])self._p[decodeURIComponent(kv[0])]=decodeURIComponent(kv[1]||'');});this.get=function(k){return this._p[k]||null;};this.delete=function(k){delete this._p[k];};this.toString=function(){return Object.keys(self._p).map(function(k){return k+'='+self._p[k];}).join('&');};},
    window:{location:{href:'',search:'',pathname:'/',hash:''},history:{replaceState:function(){}},ContactsManager:undefined},
    navigator:{},
    Date:Date,Math:Math,Number:Number,String:String,Array:Array,Object:Object,
    JSON:JSON,Promise:Promise,parseInt:parseInt,parseFloat:parseFloat,isNaN:isNaN,
    encodeURIComponent:encodeURIComponent,decodeURIComponent:decodeURIComponent,
    console:{log:function(){},warn:function(){},error:function(){}},
    _els:els,
    _contacts:function(){return contacts;},_setContacts:function(v){contacts=v.slice();},
    _imports:function(){return imports;},_setImports:function(v){imports=v.slice();},
    _markDeletedCalls:markDeletedCalls,_showViewCalls:showViewCalls,_alertCalls:alertCalls,
    _setConfirm:function(v){confirmRet=v;}
  };
  Object.assign(sb,overrides||{});
  return vm.createContext(sb);
}
function load(s,f){vm.runInContext(fs.readFileSync(path.join(BASE,f),'utf8'),s);}

// ──────────────────────────────────────────────────────────
console.log('\n1. Globals exported');
var s1=sandbox();load(s1,'js/shared/contacts.js');
ok(s1._rcFilterBatchId===null,'_rcFilterBatchId initial value is null');
ok(s1._rcActiveTab==='repertoire','_rcActiveTab initial value is repertoire');
ok(s1.currentContactFicheId===null,'currentContactFicheId initial value is null');
ok(typeof s1.RC_HISTORY_TYPES==='object'&&s1.RC_HISTORY_TYPES!==null,'RC_HISTORY_TYPES is object');
ok(Object.keys(s1.RC_HISTORY_TYPES).length===4,'RC_HISTORY_TYPES has 4 keys');
ok('call' in s1.RC_HISTORY_TYPES&&'whatsapp' in s1.RC_HISTORY_TYPES&&'email' in s1.RC_HISTORY_TYPES&&'note' in s1.RC_HISTORY_TYPES,'RC_HISTORY_TYPES has call/whatsapp/email/note keys');
ok(typeof s1.RC_OUTCOMES==='object'&&s1.RC_OUTCOMES!==null,'RC_OUTCOMES is object');
ok(Object.keys(s1.RC_OUTCOMES).length===4,'RC_OUTCOMES has 4 keys');
ok('interested' in s1.RC_OUTCOMES&&'refused' in s1.RC_OUTCOMES&&'no_answer' in s1.RC_OUTCOMES&&'callback' in s1.RC_OUTCOMES,'RC_OUTCOMES has correct keys');
ok(Array.isArray(s1.RC_NOTE_TEMPLATES),'RC_NOTE_TEMPLATES is array');
ok(s1.RC_NOTE_TEMPLATES.length===4,'RC_NOTE_TEMPLATES has 4 items');
ok(typeof s1._rcDebouncedRenderRepertoire==='function','_rcDebouncedRenderRepertoire is function (load-time closure)');
ok(typeof s1._rcDebouncedRenderAnnuaire==='function','_rcDebouncedRenderAnnuaire is function (load-time closure)');
[
  '_rcDebounce','_rcInfo','_rcFormatDateTime','_rcInitials','_rcCleanPhone','_rcWhatsappNumber',
  '_rcContactStatus','_rcFollowUpBucket','_rcFollowUpBadge','_rcStripPhoneSpaces',
  '_vcUnescape','_parseVCardFile','_rcMaxNumero','_rcBackfillNumeros',
  'importPhoneContacts','startGoogleContactsImport','_checkGoogleImportToken',
  'triggerContactsFileImport','handleContactsFileImport',
  'renderRepertoireImportsHistory','deleteRepertoireImport','updateRepertoireImportLabel',
  'setRepertoireContactsFilter','addRepertoireContactRow','updateRepertoireContactField',
  'deleteRepertoireContact','_rcDetectDuplicateGroups','_rcRenderDuplicatesBanner',
  '_rcMergeGroupInList','mergeDuplicateGroup','mergeAllDuplicateGroups',
  'renderRepertoireContactsPage','setContactsTab','rcSearchInputChanged',
  'logContactHistory','setLastCallOutcome','_rcAfterContactsMutation',
  '_rcLastHistoryEntry','_rcLastCallEntry','_rcGetFilteredSortedContacts',
  '_rcGetFilteredSortedContactsForTable','_rcResetTableFilters','_rcPopulateDynamicFilters',
  '_rcComputeStats','_rcRenderStats','renderContactsDirectory','exportContactsDirectoryCSV',
  'openContactFiche','renderContactFiche','_rcToggleOutcomeSelect','_rcFillHistoryNote',
  '_rcRenderHistoryTimeline','addManualContactHistory','updateRepertoireContactTags'
].forEach(function(n){ok(typeof s1[n]==='function',n+' is function');});

// ──────────────────────────────────────────────────────────
console.log('\n2. Pure helpers');
var s2=sandbox();load(s2,'js/shared/contacts.js');
var dbFn=s2._rcDebounce(function(){},100);ok(typeof dbFn==='function','_rcDebounce returns a function');
ok(s2._rcCleanPhone('+216 22 333')==='+21622333','_rcCleanPhone strips spaces/dashes, keeps +');
ok(s2._rcCleanPhone('22 333-444')==='22333444','_rcCleanPhone strips all non-digit/+ chars');
ok(s2._rcCleanPhone(null)==='','_rcCleanPhone(null) returns empty string');
ok(s2._rcWhatsappNumber('+216 22 333')==='21622333','_rcWhatsappNumber strips all non-digits including +');
ok(s2._rcWhatsappNumber('22 333 444')==='22333444','_rcWhatsappNumber strips spaces');
ok(s2._rcFormatDateTime('')==='','_rcFormatDateTime empty string returns empty');
ok(s2._rcFormatDateTime(null)==='','_rcFormatDateTime null returns empty');
var fmtResult=s2._rcFormatDateTime('2026-08-05T10:30:00Z');ok(typeof fmtResult==='string'&&fmtResult.indexOf('à')>=0,'_rcFormatDateTime ISO string returns formatted string with à');
ok(s2._vcUnescape('abc\\nxyz')==='abc xyz','_vcUnescape replaces \\n with space');
ok(s2._vcUnescape('a\\,b')==='a,b','_vcUnescape replaces \\, with comma');
ok(s2._rcInitials({prenom:'Jean',nom:'Dupont'})==='JD','_rcInitials returns correct initials');
ok(s2._rcInitials({prenom:'',nom:''})==='?','_rcInitials empty contact returns ?');
ok(s2._rcContactStatus({}).cls==='cc-status-never','_rcContactStatus no history returns never');
ok(s2._rcFollowUpBucket({nextFollowUp:null})===null,'_rcFollowUpBucket null nextFollowUp returns null');

// ──────────────────────────────────────────────────────────
console.log('\n3. addRepertoireContactRow');
var s3=sandbox();load(s3,'js/shared/contacts.js');
s3.addRepertoireContactRow();
var c3=s3._contacts();
ok(c3.length===1,'addRepertoireContactRow adds one contact to store');
ok(typeof c3[0].id==='string'&&c3[0].id.indexOf('rc_')===0,'new contact id starts with rc_');
ok(c3[0].numero==='0001','first contact gets numero 0001');
ok(c3[0].importBatchId===null,'new manual contact has importBatchId null');
// Add second row — numero increments
s3.addRepertoireContactRow();
ok(s3._contacts()[1].numero==='0002','second contact gets numero 0002');

// ──────────────────────────────────────────────────────────
console.log('\n4. updateRepertoireContactField');
var s4=sandbox();load(s4,'js/shared/contacts.js');
s4._setContacts([{id:'c4a',nom:'OldName',tel1:'',tel2:'',updatedAt:'',importBatchId:null}]);
s4.updateRepertoireContactField('c4a','nom','NewName');
ok(s4._contacts()[0].nom==='NewName','updateRepertoireContactField updates nom field');
s4.updateRepertoireContactField('c4a','tel1','22 333 444');
ok(s4._contacts()[0].tel1==='22333444','updateRepertoireContactField strips spaces from tel1');
// Unknown id: no throw, list unchanged length
var prevLen=s4._contacts().length;
ok((function(){try{s4.updateRepertoireContactField('unknown','nom','X');return true;}catch(e){return false;}}()),'updateRepertoireContactField unknown id does not throw');
ok(s4._contacts().length===prevLen,'updateRepertoireContactField unknown id does not add entries');

// ──────────────────────────────────────────────────────────
console.log('\n5. deleteRepertoireContact');
var s5=sandbox();load(s5,'js/shared/contacts.js');
s5._setContacts([{id:'d1',nom:'Alpha',importBatchId:null},{id:'d2',nom:'Beta',importBatchId:null}]);
s5.deleteRepertoireContact('d1');
ok(s5._contacts().length===1,'deleteRepertoireContact removes contact on confirm');
ok(s5._contacts()[0].id==='d2','correct contact removed');
ok(s5._markDeletedCalls.length===1&&s5._markDeletedCalls[0].id==='d1','_markDeleted called with correct id');
// confirm = false: no deletion
var s5b=sandbox();load(s5b,'js/shared/contacts.js');
s5b._setContacts([{id:'e1',nom:'Test',importBatchId:null}]);
s5b._setConfirm(false);
s5b.deleteRepertoireContact('e1');
ok(s5b._contacts().length===1,'deleteRepertoireContact does nothing on confirm=false');

// ──────────────────────────────────────────────────────────
console.log('\n6. setRepertoireContactsFilter');
var s6=sandbox();load(s6,'js/shared/contacts.js');
s6.setRepertoireContactsFilter('batch_123');
ok(s6._rcFilterBatchId==='batch_123','setRepertoireContactsFilter sets _rcFilterBatchId');
s6.setRepertoireContactsFilter(null);
ok(s6._rcFilterBatchId===null,'setRepertoireContactsFilter null clears filter');
// With DOM element present — renderRepertoireContactsPage is invoked: tbody exists so no early return
ok((function(){try{s6.setRepertoireContactsFilter('batch_xyz');return true;}catch(e){return false;}}()),'setRepertoireContactsFilter with DOM mock does not throw');

// ──────────────────────────────────────────────────────────
console.log('\n7. logContactHistory / setLastCallOutcome');
var s7=sandbox();load(s7,'js/shared/contacts.js');
s7._setContacts([{id:'h1',nom:'Sami',historique:[],importBatchId:null}]);
s7.logContactHistory('h1','call','Premier appel','interested');
var c7=s7._contacts()[0];
ok(Array.isArray(c7.historique)&&c7.historique.length===1,'logContactHistory adds entry to historique');
ok(c7.historique[0].type==='call','history entry has correct type');
ok(c7.historique[0].outcome==='interested','history entry has correct outcome');
ok(typeof c7.historique[0].id==='string'&&c7.historique[0].id.indexOf('h_')===0,'history entry id starts with h_');
// second log: prepended
s7.logContactHistory('h1','note','Rappel','');
ok(s7._contacts()[0].historique.length===2,'second logContactHistory adds second entry');
ok(s7._contacts()[0].historique[0].type==='note','most recent entry is first');
// setLastCallOutcome
s7.setLastCallOutcome('h1','no_answer');
var lastCall7=s7._contacts()[0].historique.find(function(h){return h.type==='call';});
ok(lastCall7&&lastCall7.outcome==='no_answer','setLastCallOutcome updates last call entry outcome');
// Unknown id: no throw
ok((function(){try{s7.logContactHistory('unknown','call','x','');return true;}catch(e){return false;}}()),'logContactHistory unknown id does not throw');
ok((function(){try{s7.setLastCallOutcome('unknown','callback');return true;}catch(e){return false;}}()),'setLastCallOutcome unknown id does not throw');

// ──────────────────────────────────────────────────────────
console.log('\n8. updateRepertoireContactTags');
var s8=sandbox();load(s8,'js/shared/contacts.js');
s8._setContacts([{id:'t1',nom:'Leila',tags:[],importBatchId:null}]);
s8.updateRepertoireContactTags('t1','client, vip, suivi');
var tags8=s8._contacts()[0].tags;
ok(Array.isArray(tags8),'updateRepertoireContactTags stores tags as array');
ok(tags8.length===3,'tags array has correct count');
ok(tags8[0]==='client'&&tags8[1]==='vip'&&tags8[2]==='suivi','tags trimmed and split correctly');
// empty string: empty array
s8.updateRepertoireContactTags('t1','');
ok(s8._contacts()[0].tags.length===0,'updateRepertoireContactTags empty string gives empty array');

// ──────────────────────────────────────────────────────────
console.log('\n9. renderRepertoireContactsPage with mock DOM');
// Missing tbody: early return, no throw
var s9a=sandbox({document:{getElementById:function(){return null;},querySelectorAll:function(){return[];},createElement:function(t){return makeEl(t);},body:{appendChild:function(){},removeChild:function(){}},addEventListener:function(){}}});
load(s9a,'js/shared/contacts.js');
ok((function(){try{s9a.renderRepertoireContactsPage();return true;}catch(e){return false;}}()),'renderRepertoireContactsPage with missing tbody does not throw');
// With tbody: empty contacts renders empty state
var s9b=sandbox();load(s9b,'js/shared/contacts.js');
s9b.renderRepertoireContactsPage();
ok(s9b._els['repertoire-contacts-tbody'].innerHTML.indexOf('Aucun contact')>=0,'renderRepertoireContactsPage empty state shows Aucun contact');
// Count element updated
ok(s9b._els['repertoire-contacts-count'].innerHTML.indexOf('0')>=0,'repertoire-contacts-count updated on render');
// With one contact: contact nom appears in innerHTML
var s9c=sandbox();load(s9c,'js/shared/contacts.js');
s9c._setContacts([{id:'x1',nom:'Amine',prenom:'Ben',numero:'0001',tel1:'22333444',tel2:'',adresse:'',ville:'',gouvernorat:'',pays:'',email:'',metier:'',domaine:'',note:'',tags:[],responsable:'',nextFollowUp:'',historique:[],importBatchId:null,updatedAt:'2026-08-05T00:00:00Z'}]);
s9c.renderRepertoireContactsPage();
ok(s9c._els['repertoire-contacts-tbody'].innerHTML.indexOf('Amine')>=0,'renderRepertoireContactsPage renders contact nom');
// _rcFilterBatchId filter: contact excluded when batch doesn't match
var s9d=sandbox();load(s9d,'js/shared/contacts.js');
s9d._setContacts([{id:'f1',nom:'Filtré',prenom:'',numero:'0001',tel1:'',tel2:'',adresse:'',ville:'',gouvernorat:'',pays:'',email:'',metier:'',domaine:'',note:'',tags:[],responsable:'',nextFollowUp:'',historique:[],importBatchId:'batch_A',updatedAt:'2026-08-05T00:00:00Z'}]);
s9d._rcFilterBatchId='batch_B';
s9d.renderRepertoireContactsPage();
ok(s9d._els['repertoire-contacts-tbody'].innerHTML.indexOf('Filtré')<0,'renderRepertoireContactsPage respects _rcFilterBatchId filter');

// ──────────────────────────────────────────────────────────
console.log('\n10. renderContactsDirectory');
// Missing grid: early return
var s10a=sandbox({document:{getElementById:function(){return null;},querySelectorAll:function(){return[];},createElement:function(t){return makeEl(t);},body:{appendChild:function(){},removeChild:function(){}},addEventListener:function(){}}});
load(s10a,'js/shared/contacts.js');
ok((function(){try{s10a.renderContactsDirectory();return true;}catch(e){return false;}}()),'renderContactsDirectory with missing grid does not throw');
// Empty contacts: empty state
var s10b=sandbox();load(s10b,'js/shared/contacts.js');
s10b.renderContactsDirectory();
ok(s10b._els['contacts-directory-grid'].innerHTML.indexOf('Aucun contact')>=0,'renderContactsDirectory empty state shows Aucun contact');
// One contact: appears in grid
var s10c=sandbox();load(s10c,'js/shared/contacts.js');
s10c._setContacts([{id:'d1',nom:'Karim',prenom:'Ben',numero:'0001',tel1:'+21622111',tel2:'',adresse:'',ville:'Tunis',gouvernorat:'',pays:'',email:'',metier:'',domaine:'',note:'',tags:[],responsable:'',nextFollowUp:'',historique:[],importBatchId:null,updatedAt:'2026-08-05T00:00:00Z'}]);
s10c.renderContactsDirectory();
ok(s10c._els['contacts-directory-grid'].innerHTML.indexOf('Karim')>=0,'renderContactsDirectory renders contact name');
// openContactFiche sets currentContactFicheId and calls showView
var s10d=sandbox();load(s10d,'js/shared/contacts.js');
s10d.openContactFiche('id_abc');
ok(s10d.currentContactFicheId==='id_abc','openContactFiche sets currentContactFicheId');
ok(s10d._showViewCalls.indexOf('contact-fiche')>=0,'openContactFiche calls showView with contact-fiche');

// ──────────────────────────────────────────────────────────
console.log('\n11. Integration');
var appSrc=fs.readFileSync(path.join(BASE,'js/app.js'),'utf8');
var routerSrc=fs.readFileSync(path.join(BASE,'js/core/router.js'),'utf8');
var modSrc=fs.readFileSync(path.join(BASE,'js/shared/contacts.js'),'utf8');
var indexSrc=fs.readFileSync(path.join(BASE,'index.html'),'utf8');
// contacts.js has canonical header
ok(modSrc.indexOf('MYTHOS PROD — CONTACTS')>=0,'contacts.js has MYTHOS PROD — CONTACTS header');
// _rcActiveTab appears exactly once at declaration in contacts.js (the var declaration)
var rcActiveTabCount=(modSrc.match(/var _rcActiveTab\s*=/g)||[]).length;
ok(rcActiveTabCount===1,'var _rcActiveTab declared exactly once in contacts.js');
// Stage 4AB ref comment in app.js
ok(appSrc.indexOf('Stage 4AB')>=0||appSrc.indexOf('contacts.js')>=0,'Stage 4AB ref comment present in app.js');
// Function definitions removed from app.js
['function renderRepertoireContactsPage(','function renderContactFiche(','function renderContactsDirectory(',
 'function addRepertoireContactRow(','function updateRepertoireContactField(','function deleteRepertoireContact(',
 'function logContactHistory(','function setLastCallOutcome(','function updateRepertoireContactTags(',
 'function exportContactsDirectoryCSV(','function openContactFiche(','function mergeDuplicateGroup(',
 'function mergeAllDuplicateGroups(','function setContactsTab('
].forEach(function(sym){ok(appSrc.indexOf(sym)<0,sym+' removed from app.js');});
// State var declarations removed from app.js
ok(appSrc.indexOf('var _rcFilterBatchId')<0,'var _rcFilterBatchId removed from app.js');
ok(appSrc.indexOf('var _rcActiveTab')<0,'var _rcActiveTab removed from app.js');
ok(appSrc.indexOf('var currentContactFicheId')<0,'var currentContactFicheId removed from app.js');
// Router still calls the contacts renderers
ok(routerSrc.indexOf('renderRepertoireContactsPage()')>=0,'router still calls renderRepertoireContactsPage');
ok(routerSrc.indexOf('renderContactFiche()')>=0,'router still calls renderContactFiche');
// index.html: contacts.js is before taches.js (if present)
var contactsIdx=indexSrc.indexOf('contacts.js');
var tachesIdx=indexSrc.indexOf('js/taches.js');
if(contactsIdx>=0&&tachesIdx>=0){ok(contactsIdx<tachesIdx,'contacts.js script tag precedes taches.js in index.html');}
else{ok(true,'contacts.js not yet in index.html — ordering check skipped');}
// Syntax checks
var nc=require('child_process').spawnSync(process.execPath,['-c','js/shared/contacts.js'],{cwd:BASE});
ok(nc.status===0,'js/shared/contacts.js passes node -c syntax check');
var na=require('child_process').spawnSync(process.execPath,['-c','js/app.js'],{cwd:BASE});
ok(na.status===0,'js/app.js passes node -c syntax check after extraction');

console.log('\nStage 4AB: '+pass+' passed, '+fail+' failed');
if(fail)process.exit(1);
process.exit(0);
