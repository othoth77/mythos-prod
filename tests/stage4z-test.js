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
['editInvoice','deleteInvoice','editOm','deleteOm','cancelOM',
 'initApp','bootstrapStableApp','closeModalFromOutsideClick',
 'exportBackup','importBackup','renderBackupDashboard',
 'renderDocumentation'].forEach(function(n){
  ok(app.indexOf('function '+n+'(')>=0,n+' active function preserved in app.js');
});

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
