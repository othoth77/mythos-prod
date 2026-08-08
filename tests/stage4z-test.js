'use strict';
var fs=require('fs'),path=require('path'),BASE=path.join(__dirname,'..'),pass=0,fail=0;
function ok(v,l){if(v){pass++;console.log('  PASS '+l);}else{fail++;console.log('  FAIL '+l);}}

var app=fs.readFileSync(path.join(BASE,'js/app.js'),'utf8');
var index=fs.readFileSync(path.join(BASE,'index.html'),'utf8');

console.log('\n1. Dead code removal — renderEntityPage');
ok(app.indexOf('function renderEntityPage(')<0,'renderEntityPage removed from app.js');
ok(app.indexOf('Stage 4Z')>=0,'Stage 4Z removal marker present');

console.log('\n2. Stage 4 extraction boundary completeness — functions gone from app.js');
['renderStatistique','fillModalFields','saveModalEntity',
 'renderSuppliersPage','calculateFromTTC',
 'renderNatures','renderClients','renderCollaborateurs',
 'renderFournisseurs','renderRepresentations',
 'renderInvoiceList','renderDevisList',
 'renderContracts','renderRdvs','renderMissionOrders',
 'renderAccountingOverview','renderBankLedger','renderCashLedger',
 'renderExpensesPage','renderPurchasesPage'].forEach(function(n){
  ok(app.indexOf('function '+n+'(')<0,n+' not re-introduced in app.js');
});

console.log('\n3. Surviving active functions still in app.js');
['initApp','bootstrapStableApp','closeModalFromOutsideClick'].forEach(function(n){
  ok(app.indexOf('function '+n+'(')>=0,n+' active function preserved in app.js');
});
ok(app.indexOf('function cancelOM(')<0,'cancelOM removed from app.js (Stage 4AG)');
ok(app.indexOf('function editOm(')<0,'editOm removed from app.js (Stage 4AG)');
ok(app.indexOf('function deleteOm(')<0,'deleteOm removed from app.js (Stage 4AG)');
ok(app.indexOf('function addOmPerson(')<0,'addOmPerson absent from app.js');
var moSrc=fs.readFileSync(path.join(BASE,'js/shared/mission-orders.js'),'utf8');
ok(moSrc.indexOf('function cancelOM(')>=0,'cancelOM canonical in mission-orders.js');
ok(moSrc.indexOf('function addOmPerson(')>=0,'addOmPerson canonical in mission-orders.js');

console.log('\n3b. Runtime duplicate cleanup (RUNTIME-DUPLICATE-CLEANUP-0): invoice ownership');
ok(app.indexOf('function editInvoice(')<0,'editInvoice removed from app.js (RUNTIME-DUPLICATE-CLEANUP-0)');
ok(app.indexOf('function deleteInvoice(')<0,'deleteInvoice removed from app.js (RUNTIME-DUPLICATE-CLEANUP-0)');
var invSrc=fs.readFileSync(path.join(BASE,'js/shared/invoices.js'),'utf8');
ok(invSrc.indexOf('function editInvoice(')>=0,'editInvoice canonical in invoices.js');
ok(invSrc.indexOf('function deleteInvoice(')>=0,'deleteInvoice canonical in invoices.js');
ok(moSrc.indexOf('let stableLineCount')<0,'stale stableLineCount declaration removed from mission-orders.js');
// exportBackup, importBackup, renderBackupDashboard moved to js/shared/backup.js in Stage 4AD
var backup=fs.readFileSync(path.join(BASE,'js/shared/backup.js'),'utf8');
ok(backup.indexOf('function exportBackup(')>=0,'exportBackup present in backup.js (Stage 4AD)');
ok(backup.indexOf('function importBackup(')>=0,'importBackup present in backup.js (Stage 4AD)');
ok(backup.indexOf('function renderBackupDashboard(')>=0,'renderBackupDashboard present in backup.js (Stage 4AD)');
// renderDocumentation, saveDoc, deleteDoc etc. moved to js/shared/documentation.js in Stage 4AE
var doc=fs.readFileSync(path.join(BASE,'js/shared/documentation.js'),'utf8');
ok(doc.indexOf('function renderDocumentation(')>=0,'renderDocumentation present in documentation.js (Stage 4AE)');
ok(doc.indexOf('function saveDoc(')>=0,'saveDoc present in documentation.js (Stage 4AE)');
ok(doc.indexOf('function deleteDoc(')>=0,'deleteDoc present in documentation.js (Stage 4AE)');

console.log('\n4. STORE definition preserved');
ok(app.indexOf('const STORE = {')>=0,'STORE object defined in app.js');
ok(app.indexOf('saveInvoices')>=0,'STORE.saveInvoices preserved');
ok(app.indexOf('saveRepresentations')>=0,'STORE.saveRepresentations preserved');

console.log('\n5. index.html script order unaffected');
ok(index.indexOf('js/shared/statistics-dashboard.js')>index.indexOf('js/shared/accounting-overview.js'),'script order unchanged');
ok(index.indexOf('js/shared/modal-entity-helpers.js')>0,'helper script still present');

console.log('\n6. Syntax check (no parse errors)');
var node_c=require('child_process').spawnSync(process.execPath,['-c','js/app.js'],{cwd:BASE});
ok(node_c.status===0,'js/app.js passes node -c syntax check');

console.log('\nStage 4Z: '+pass+' passed, '+fail+' failed');
if(fail)process.exit(1);
process.exit(0);
