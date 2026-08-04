'use strict';
var vm=require('vm'),fs=require('fs'),path=require('path'),BASE=path.join(__dirname,'..'),pass=0,fail=0;
function ok(v,l){if(v){pass++;console.log('  PASS '+l);}else{fail++;console.log('  FAIL '+l);}}

function makeEl(id){return{id:id,value:'',textContent:'',innerHTML:'',_children:[],options:{length:0},style:{display:'',outline:'',opacity:''},appendChild:function(c){this._children.push(c);this.options.length++;}};}
function makeBtn(result){return{_result:result,style:{outline:'',opacity:''},getAttribute:function(k){return k==='data-result'?this._result:null;}};}
function makeTrBtn(num,nom,tel,date,heure){var tr={_data:{'data-num':num,'data-nom':nom,'data-tel':tel,'data-date':date,'data-heure':heure||''},getAttribute:function(k){return this._data[k]||'';}};var btn={closest:function(sel){return sel==='tr'?tr:null;}};return{btn:btn,tr:tr};}

function sandbox(overrides){
  var storage={},appels=[],validated=[];
  var elIds=['appel-tbody','appel-count','conformite-tbody','conformite-count',
    'inscriptions-tbody','inscriptions-count','dashboard-inscriptions-count',
    'settings-call-script','settings-sheet-url',
    'appel-fiche-id','appel-fiche-nom','appel-fiche-script',
    'appel-fiche-f-nom','appel-fiche-f-prenom','appel-fiche-f-ville',
    'appel-fiche-f-jour','appel-fiche-f-mois','appel-fiche-f-annee',
    'appel-fiche-f-niveau','appel-fiche-f-domaine','appel-fiche-f-note',
    'appel-fiche-result','appel-fiche-modal'];
  var els={};elIds.forEach(function(id){els[id]=makeEl(id);});
  var resultBtns=[makeBtn('Numéro injoignable'),makeBtn('Numéro faux'),makeBtn('Candidat sérieux'),makeBtn('Candidat fantaisiste')];
  var alertCalls=[],confirmRet=true,fetchCalled=0;
  var sb={
    document:{
      getElementById:function(id){return els[id]||null;},
      querySelectorAll:function(sel){if(sel==='.appel-result-btn')return resultBtns;return[];},
      createElement:function(tag){return makeEl(tag);}
    },
    STORE:{
      appels:function(){return appels;},saveAppels:function(v){appels=v;},
      validatedInscriptions:function(){return validated;},saveValidatedInscriptions:function(v){validated=v;}
    },
    _storeGet:function(key,def){return Object.prototype.hasOwnProperty.call(storage,key)?storage[key]:(def!==undefined?JSON.parse(def):undefined);},
    _storeSave:function(key,val){storage[key]=val;},
    fetch:function(){fetchCalled++;return Promise.resolve({json:function(){return Promise.resolve({rows:[]});}});},
    alert:function(m){alertCalls.push(m);},
    confirm:function(){return confirmRet;},
    setTimeout:function(){},
    _els:els,_resultBtns:resultBtns,_alertCalls:alertCalls,
    _getAppels:function(){return appels;},_setAppels:function(v){appels=v.slice();},
    _getValidated:function(){return validated;},_setValidated:function(v){validated=v.slice();},
    _storage:storage,_fetchCalled:function(){return fetchCalled;},_setConfirm:function(v){confirmRet=v;},
    Date:Date,Math:Math,Number:Number,String:String,Array:Array,Object:Object,
    JSON:JSON,Promise:Promise,parseInt:parseInt,parseFloat:parseFloat,
    console:{log:function(){},warn:function(){},error:function(){}}
  };
  Object.assign(sb,overrides||{});
  return vm.createContext(sb);
}
function load(s,f){vm.runInContext(fs.readFileSync(path.join(BASE,f),'utf8'),s);}

// ──────────────────────────────────────────────────────────
console.log('\n1. Globals exported');
var s=sandbox();load(s,'js/shared/inscriptions.js');
ok(typeof s.INSCRIPTIONS_SCRIPT_URL==='string'&&s.INSCRIPTIONS_SCRIPT_URL.indexOf('script.google.com')>=0,'INSCRIPTIONS_SCRIPT_URL is Google Apps Script URL');
['_escHtmlInsc','loadDashboardInscriptionsCount','_uclNum','_appUid','loadInscriptions',
 'validerToutesInscriptions','validerInscriptionRow','renderAppels','reinitialiserListes',
 'reafficherInscriptions','renderListeConforme','getCallScript','saveCallScript',
 'loadSettingsCallScript','saveCallScriptFromSettings','resetCallScriptToDefault',
 'getSheetWebhookUrl','saveSheetWebhookUrl','loadSettingsSheetUrl','saveSheetUrlFromSettings',
 'testSheetWebhookFromSettings','pushToGoogleSheet','_populateNaissanceSelects',
 'openAppelFicheModal','closeAppelFicheModal','setAppelResult','saveAppelFiche'
].forEach(function(n){ok(typeof s[n]==='function',n+' is function');});
ok(Array.isArray(s.MOIS_NOMS)&&s.MOIS_NOMS.length===12,'MOIS_NOMS has 12 months');
ok(s.MOIS_NOMS[0]==='Janvier'&&s.MOIS_NOMS[11]==='Décembre','MOIS_NOMS order correct');

// ──────────────────────────────────────────────────────────
console.log('\n2. Pure helpers');
ok(s._escHtmlInsc('<b>&"\'>')===('&lt;b&gt;&amp;&quot;&#39;&gt;'),'_escHtmlInsc escapes all special chars');
ok(s._escHtmlInsc(null)==='','_escHtmlInsc null returns empty string');
ok(s._escHtmlInsc(42)==='42','_escHtmlInsc coerces numbers');
ok(s._uclNum(0)==='UCL0001','_uclNum(0) is UCL0001');
ok(s._uclNum(9)==='UCL0010','_uclNum(9) is UCL0010');
ok(s._uclNum(999)==='UCL1000','_uclNum(999) is UCL1000');
var uid=s._appUid();ok(typeof uid==='string'&&uid.indexOf('app_')===0,'_appUid returns string starting with app_');
ok(s._appUid()!==s._appUid(),'_appUid returns unique values');

// ──────────────────────────────────────────────────────────
console.log('\n3. renderAppels');
var r3=sandbox();load(r3,'js/shared/inscriptions.js');
r3.renderAppels();ok(r3._els['appel-tbody'].innerHTML.indexOf('Aucun appel')>=0,'empty state renders Aucun appel');
ok(r3._els['appel-count'].textContent==='0','empty count set to 0');
r3._setAppels([{id:'a1',nom:'Dupont',prenom:'Jean',tel:'99887766',motif:'Inscription',date:'2026-08-01',statut:'À appeler',sourceNum:'UCL0001',createdAt:'2026-08-01T10:00:00Z'}]);
r3.renderAppels();
var html3=r3._els['appel-tbody'].innerHTML;
ok(html3.indexOf('Dupont')>=0,'appel name rendered');
ok(html3.indexOf('99887766')>=0,'appel tel rendered');
ok(r3._els['appel-count'].textContent==='1','count updated to 1');
r3._setAppels([{id:'a2',nom:'<Script>',tel:'0',statut:'Candidat sérieux',createdAt:'2026-08-01T00:00:00Z'}]);
r3.renderAppels();
ok(r3._els['appel-tbody'].innerHTML.indexOf('&lt;Script&gt;')>=0,'appel name escaped in renderAppels');
var r3b=sandbox();load(r3b,'js/shared/inscriptions.js');
r3b._setAppels([
  {id:'b1',nom:'Beta',sourceNum:'UCL0002',createdAt:'2026-08-01T00:00:00Z',statut:'À appeler'},
  {id:'b2',nom:'Alpha',sourceNum:'UCL0001',createdAt:'2026-08-01T00:00:00Z',statut:'À appeler'}
]);
r3b.renderAppels();
ok(r3b._els['appel-tbody'].innerHTML.indexOf('Alpha')<r3b._els['appel-tbody'].innerHTML.indexOf('Beta'),'renderAppels sorted by sourceNum ascending');

// ──────────────────────────────────────────────────────────
console.log('\n4. renderListeConforme');
var r4=sandbox();load(r4,'js/shared/inscriptions.js');
r4.renderListeConforme();ok(r4._els['conformite-tbody'].innerHTML.indexOf('Aucun candidat')>=0,'empty conformite state');
r4._setAppels([
  {id:'c1',nom:'Candidat',statut:'Candidat sérieux',ville:'Tunis',niveau:'Avancé',domaine:'IT',createdAt:'2026-08-02T00:00:00Z'},
  {id:'c2',nom:'Exclu',statut:'À appeler',createdAt:'2026-08-01T00:00:00Z'}
]);
r4.renderListeConforme();
var html4=r4._els['conformite-tbody'].innerHTML;
ok(html4.indexOf('Candidat')>=0,'serious candidate rendered');
ok(html4.indexOf('Exclu')<0,'non-serious candidate excluded');
ok(r4._els['conformite-count'].textContent==='1','conformite count correct');

// ──────────────────────────────────────────────────────────
console.log('\n5. validerInscriptionRow');
var r5=sandbox();load(r5,'js/shared/inscriptions.js');
var mock5=makeTrBtn('UCL0001','Hamza','55443322','2026-08-01','10:30');
r5.validerInscriptionRow(mock5.btn);
ok(r5._getValidated().indexOf('UCL0001')>=0,'UCL0001 added to validated');
ok(r5._getAppels().length===1,'appel added after validation');
var ap5=r5._getAppels()[0];
ok(ap5.nom==='Hamza','validated appel has correct nom');
ok(ap5.tel==='55443322','validated appel has correct tel');
ok(ap5.statut==='À appeler','new validated appel starts as À appeler');
ok(ap5.sourceNum==='UCL0001','sourceNum preserved');
ok(typeof ap5.id==='string'&&ap5.id.indexOf('app_')===0,'appel id generated');
// second call with same num should not double-add to validated
r5.validerInscriptionRow(mock5.btn);
ok(r5._getValidated().filter(function(n){return n==='UCL0001';}).length===1,'validated deduplication preserved');

// ──────────────────────────────────────────────────────────
console.log('\n6. validerToutesInscriptions');
var r6=sandbox();load(r6,'js/shared/inscriptions.js');
// Mock tbody with querySelectorAll returning rows
var mockRows=[
  {_data:{'data-num':'UCL0001','data-nom':'Alpha','data-tel':'11','data-date':'2026-08-01','data-heure':'09:00'},getAttribute:function(k){return this._data[k]||'';}},
  {_data:{'data-num':'UCL0002','data-nom':'Beta','data-tel':'22','data-date':'2026-08-02','data-heure':'10:00'},getAttribute:function(k){return this._data[k]||'';}}
];
r6._els['inscriptions-tbody'].querySelectorAll=function(sel){return sel==='tr[data-num]'?mockRows:[];};
r6.validerToutesInscriptions();
ok(r6._getValidated().length===2,'validerToutesInscriptions marks all rows validated');
ok(r6._getAppels().length===2,'validerToutesInscriptions adds all to appels');
// confirm = false: nothing happens
var r6b=sandbox();load(r6b,'js/shared/inscriptions.js');
r6b._setConfirm(false);
r6b._els['inscriptions-tbody'].querySelectorAll=function(){return mockRows;};
r6b.validerToutesInscriptions();
ok(r6b._getValidated().length===0,'validerToutesInscriptions respects confirm=false');

// ──────────────────────────────────────────────────────────
console.log('\n7. Call-script settings');
var r7=sandbox();load(r7,'js/shared/inscriptions.js');
var def7=r7.getCallScript();ok(typeof def7==='string'&&def7.indexOf('Bonjour')>=0,'getCallScript returns default with Bonjour');
r7.saveCallScript('Mon script perso');
ok(r7.getCallScript()==='Mon script perso','saveCallScript and getCallScript round-trip');
r7.loadSettingsCallScript();
ok(r7._els['settings-call-script'].value==='Mon script perso','loadSettingsCallScript populates element');
r7._els['settings-call-script'].value='Nouveau texte';
r7.saveCallScriptFromSettings();
ok(r7.getCallScript()==='Nouveau texte','saveCallScriptFromSettings saves element value');
r7.saveCallScript('changed');
r7.resetCallScriptToDefault();
ok(r7.getCallScript()===def7,'resetCallScriptToDefault restores default script');
// missing element: no throw
ok((function(){try{var r=sandbox();load(r,'js/shared/inscriptions.js');r.loadSettingsCallScript();return true;}catch(e){return false;}})(),'loadSettingsCallScript with missing element does not throw');

// ──────────────────────────────────────────────────────────
console.log('\n8. Sheet-webhook settings');
var r8=sandbox();load(r8,'js/shared/inscriptions.js');
ok(r8.getSheetWebhookUrl()==='','getSheetWebhookUrl returns empty string by default');
r8.saveSheetWebhookUrl('https://script.google.com/test');
ok(r8.getSheetWebhookUrl()==='https://script.google.com/test','saveSheetWebhookUrl round-trip');
r8.loadSettingsSheetUrl();
ok(r8._els['settings-sheet-url'].value==='https://script.google.com/test','loadSettingsSheetUrl populates element');
r8._els['settings-sheet-url'].value='  https://trimmed.com  ';
r8.saveSheetUrlFromSettings();
ok(r8.getSheetWebhookUrl()==='https://trimmed.com','saveSheetUrlFromSettings trims whitespace');
// pushToGoogleSheet: with no url, no fetch
ok((function(){try{r8.saveSheetWebhookUrl('');r8.pushToGoogleSheet({nom:'Test'});return true;}catch(e){return false;}})(),'pushToGoogleSheet with empty url does not throw');

// ──────────────────────────────────────────────────────────
console.log('\n9. openAppelFicheModal / closeAppelFicheModal / setAppelResult');
var r9=sandbox();load(r9,'js/shared/inscriptions.js');
// Unknown id: early return, modal stays hidden
r9.openAppelFicheModal('unknown-id');
ok(r9._els['appel-fiche-modal'].style.display==='','openAppelFicheModal unknown id leaves modal hidden');
// Known id
r9._setAppels([{id:'m1',nom:'Sami',prenom:'Ben Ali',tel:'55001122',motif:'Test',date:'2026-08-01',statut:'À appeler',dateInscription:'2026-08-01',heureInscription:'09:00',note:''}]);
r9.openAppelFicheModal('m1');
ok(r9._els['appel-fiche-modal'].style.display==='flex','openAppelFicheModal opens modal for known id');
ok(r9._els['appel-fiche-nom'].textContent.indexOf('Sami')>=0,'openAppelFicheModal sets fiche-nom');
ok(r9._els['appel-fiche-id'].value==='m1','openAppelFicheModal sets fiche-id');
ok(r9._els['appel-fiche-f-nom'].value==='Sami','openAppelFicheModal populates nom field');
// closeAppelFicheModal
r9.closeAppelFicheModal();
ok(r9._els['appel-fiche-modal'].style.display==='none','closeAppelFicheModal hides modal');
// setAppelResult: sets value
var btn9=makeBtn('Candidat sérieux');
r9._els['appel-fiche-result'].value='';
r9.setAppelResult(btn9);
ok(r9._els['appel-fiche-result'].value==='Candidat sérieux','setAppelResult sets result value');
// re-click toggles off
r9.setAppelResult(btn9);
ok(r9._els['appel-fiche-result'].value==='','setAppelResult re-click clears result value');
// _populateNaissanceSelects: populates selects on first call, skips on second
var r9b=sandbox();load(r9b,'js/shared/inscriptions.js');
r9b._setAppels([{id:'p1',nom:'Pop',statut:'À appeler'}]);
r9b.openAppelFicheModal('p1');
var jourLen=r9b._els['appel-fiche-f-jour'].options.length;
ok(jourLen===31,'_populateNaissanceSelects adds 31 day options');
r9b._setAppels([{id:'p1',nom:'Pop',statut:'À appeler'}]);
r9b.openAppelFicheModal('p1');
ok(r9b._els['appel-fiche-f-jour'].options.length===31,'_populateNaissanceSelects skips if already populated');

// ──────────────────────────────────────────────────────────
console.log('\n10. saveAppelFiche');
var r10=sandbox();load(r10,'js/shared/inscriptions.js');
// Unknown id: early return
r10._els['appel-fiche-id'].value='no-such-id';
ok((function(){try{r10.saveAppelFiche();return true;}catch(e){return false;}})(),'saveAppelFiche with unknown id does not throw');
// Known id: updates fields and statut
r10._setAppels([{id:'sf1',nom:'Old',tel:'00',statut:'À appeler'}]);
r10._els['appel-fiche-id'].value='sf1';
r10._els['appel-fiche-f-nom'].value='Nouveau';
r10._els['appel-fiche-f-prenom'].value='Prénom';
r10._els['appel-fiche-f-ville'].value='Tunis';
r10._els['appel-fiche-f-jour'].value='15';
r10._els['appel-fiche-f-mois'].value='Août';
r10._els['appel-fiche-f-annee'].value='2000';
r10._els['appel-fiche-f-niveau'].value='Avancé';
r10._els['appel-fiche-f-domaine'].value='IT';
r10._els['appel-fiche-f-note'].value='Bonne impression.';
r10._els['appel-fiche-result'].value='Candidat sérieux';
r10.saveAppelFiche();
var saved10=r10._getAppels().find(function(a){return a.id==='sf1';});
ok(saved10.nom==='Nouveau','saveAppelFiche updates nom');
ok(saved10.prenom==='Prénom','saveAppelFiche updates prenom');
ok(saved10.ville==='Tunis','saveAppelFiche updates ville');
ok(saved10.niveau==='Avancé','saveAppelFiche updates niveau');
ok(saved10.domaine==='IT','saveAppelFiche updates domaine');
ok(saved10.note==='Bonne impression.','saveAppelFiche updates note');
ok(saved10.statut==='Candidat sérieux','saveAppelFiche updates statut');
ok(saved10.dateNaissance==='15 Août 2000','saveAppelFiche computes dateNaissance');
ok(!isNaN(parseInt(saved10.age,10)),'saveAppelFiche computes numeric age');
ok(r10._els['appel-fiche-modal'].style.display==='none','saveAppelFiche closes modal');

// ──────────────────────────────────────────────────────────
console.log('\n11. Integration and exclusions');
var index=fs.readFileSync(path.join(BASE,'index.html'),'utf8');
var app=fs.readFileSync(path.join(BASE,'js/app.js'),'utf8');
var router=fs.readFileSync(path.join(BASE,'js/core/router.js'),'utf8');
var mod=fs.readFileSync(path.join(BASE,'js/shared/inscriptions.js'),'utf8');
ok(index.indexOf('js/shared/inscriptions.js')>index.indexOf('js/shared/statistics-dashboard.js'),'inscriptions script follows statistics-dashboard in index.html');
ok(index.indexOf('js/shared/inscriptions.js')<index.indexOf('js/taches.js'),'inscriptions script precedes taches.js in index.html');
ok((index.match(/inscriptions\.js/g)||[]).length===1,'inscriptions.js script tag appears exactly once');
['var INSCRIPTIONS_SCRIPT_URL','function loadInscriptions(','function renderAppels(',
 'function renderListeConforme(','function getCallScript(','function saveCallScript(',
 'function getSheetWebhookUrl(','function openAppelFicheModal(','function closeAppelFicheModal(',
 'function saveAppelFiche(','function validerToutesInscriptions(','function validerInscriptionRow('
].forEach(function(sym){ok(app.indexOf(sym)<0,sym+' removed from app.js');});
ok(app.indexOf('js/shared/inscriptions.js')>=0||app.indexOf('Stage 4AA')>=0||app.indexOf('Inscriptions / Appels workflow')>=0,'Stage 4AA ref comment present in app.js');
ok(router.indexOf('loadDashboardInscriptionsCount()')>=0,'router calls loadDashboardInscriptionsCount');
ok(router.indexOf('loadInscriptions()')>=0,'router calls loadInscriptions');
ok(router.indexOf('renderAppels()')>=0,'router calls renderAppels');
ok(router.indexOf('renderListeConforme()')>=0,'router calls renderListeConforme');
ok(mod.indexOf('MYTHOS PROD — INSCRIPTIONS')>=0,'module has canonical header comment');
var nc=require('child_process').spawnSync(process.execPath,['-c','js/shared/inscriptions.js'],{cwd:BASE});
ok(nc.status===0,'js/shared/inscriptions.js passes node -c syntax check');
var na=require('child_process').spawnSync(process.execPath,['-c','js/app.js'],{cwd:BASE});
ok(na.status===0,'js/app.js passes node -c syntax check after extraction');

console.log('\nStage 4AA: '+pass+' passed, '+fail+' failed');
if(fail)process.exit(1);
process.exit(0);
