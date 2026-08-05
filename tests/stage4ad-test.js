'use strict';
var vm=require('vm'),fs=require('fs'),path=require('path'),BASE=path.join(__dirname,'..'),pass=0,fail=0;
function ok(v,l){if(v){pass++;console.log('  PASS '+l);}else{fail++;console.log('  FAIL '+l);}}

// ── Shared sandbox helpers ────────────────────────────────────────────
var RESTORE_KEY_MAP_FIXTURE = {
  inscriptions: 'mp_inscriptions',
  contacts:     'mp_contacts',
  taches:       'mp_taches'
};

function makeSandbox(overrides) {
  var store = {};
  var alertLog = [];
  var confirmResult = true;
  var promptResult = 'test-version';
  var clickedLinks = [];
  var sb = {
    RESTORE_KEY_MAP: RESTORE_KEY_MAP_FIXTURE,
    localStorage: {
      _store: store,
      getItem: function(k) { return store[k] !== undefined ? store[k] : null; },
      setItem: function(k,v) { store[k] = v; },
      removeItem: function(k) { delete store[k]; }
    },
    document: {
      getElementById: function(id) {
        return { id:id, disabled:false, textContent:'', innerHTML:'', style:{} };
      },
      createElement: function(tag) {
        var el = { href:'', download:'', _clicked:false, click:function(){ clickedLinks.push(this.href||this.download); el._clicked=true; } };
        return el;
      }
    },
    URL: { createObjectURL:function(b){ return 'blob:mock'; }, revokeObjectURL:function(){} },
    Blob: function(parts, opts) { this.parts=parts; this.type=(opts||{}).type||''; },
    FileReader: function() {
      this.onload = null;
      this.readAsText = function(file) {
        if (this.onload) this.onload({ target: { result: file._content || '{}' } });
      };
    },
    fetch: function() { return Promise.resolve({ json:function(){ return Promise.resolve({ok:true}); } }); },
    alert: function(msg) { alertLog.push(msg); },
    confirm: function() { return confirmResult; },
    prompt: function() { return promptResult; },
    setTimeout: function() {},
    location: { reload: function(){} },
    todayStr: function() { return '2026-08-05'; },
    escapeHtml: function(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); },
    JSON: JSON,
    Date: Date,
    Object: Object,
    Array: Array,
    Math: Math,
    Number: Number,
    String: String,
    console: { log:function(){}, warn:function(){}, error:function(){} },
    _alertLog: alertLog,
    _clickedLinks: clickedLinks,
    _store: store,
    _setConfirm: function(v){ confirmResult=v; },
    _setPrompt: function(v){ promptResult=v; }
  };
  Object.assign(sb, overrides || {});
  return vm.createContext(sb);
}
function load(s,f){ vm.runInContext(fs.readFileSync(path.join(BASE,f),'utf8'),s); }

// ═══════════════════════════════════════════════════════════════════════
console.log('\n1. Globals exported');
var s1=makeSandbox();load(s1,'js/shared/backup.js');
ok(typeof s1._getAllData==='function','_getAllData is global function');
ok(typeof s1.exportBackup==='function','exportBackup is global function');
ok(typeof s1.importBackup==='function','importBackup is global function');
ok(typeof s1.createBackupVersion==='function','createBackupVersion is global function');
ok(typeof s1.exportVersionHistory==='function','exportVersionHistory is global function');
ok(typeof s1.pushAllToServer==='function','pushAllToServer is global function');
ok(typeof s1.renderBackupDashboard==='function','renderBackupDashboard is global function');
ok(typeof s1.runDiskCleanup==='function','runDiskCleanup is global function');
ok(typeof s1._restoreVersion==='function','_restoreVersion is global function');
ok(typeof s1._deleteVersion==='function','_deleteVersion is global function');
ok(typeof s1._restoreServerBackup==='function','_restoreServerBackup is global function');

// ═══════════════════════════════════════════════════════════════════════
console.log('\n2. _getAllData — reads from RESTORE_KEY_MAP');
var s2=makeSandbox();load(s2,'js/shared/backup.js');
s2.localStorage.setItem('mp_inscriptions', JSON.stringify([{id:1}]));
s2.localStorage.setItem('mp_contacts', JSON.stringify([{id:2},{id:3}]));
var d=s2._getAllData();
ok(typeof d==='object','_getAllData returns object');
ok(d.appName==='Mythos Prod','appName is Mythos Prod');
ok(d.version==='1.0','version is 1.0');
ok(typeof d.exportedAt==='string','exportedAt is string ISO date');
ok(Array.isArray(d.inscriptions),'inscriptions is array');
ok(d.inscriptions.length===1,'inscriptions has 1 item');
ok(Array.isArray(d.contacts),'contacts is array');
ok(d.contacts.length===2,'contacts has 2 items');

// ═══════════════════════════════════════════════════════════════════════
console.log('\n3. _getAllData — bad JSON falls back to []');
var s3=makeSandbox();load(s3,'js/shared/backup.js');
s3.localStorage.setItem('mp_inscriptions','not-json');
var d3=s3._getAllData();
ok(Array.isArray(d3.inscriptions),'bad JSON falls back to array');
ok(d3.inscriptions.length===0,'bad JSON falls back to empty array');

// ═══════════════════════════════════════════════════════════════════════
console.log('\n4. exportBackup — triggers download');
var s4=makeSandbox();load(s4,'js/shared/backup.js');
s4.exportBackup();
ok(s4._clickedLinks.length===1,'exportBackup clicked anchor once');
ok(s4._clickedLinks[0].indexOf('mythos-backup')>=0||s4._clickedLinks[0]==='blob:mock','download link set');

// ═══════════════════════════════════════════════════════════════════════
console.log('\n5. exportVersionHistory — empty alert, no download');
var s5=makeSandbox();load(s5,'js/shared/backup.js');
s5.exportVersionHistory();
ok(s5._alertLog.length===1,'exportVersionHistory alerts when no versions');
ok(s5._alertLog[0].indexOf('sauvegarde')>=0||s5._alertLog[0].indexOf('version')>=0,'alert mentions versions');

// ═══════════════════════════════════════════════════════════════════════
console.log('\n6. exportVersionHistory — triggers download when versions exist');
var s6=makeSandbox();load(s6,'js/shared/backup.js');
s6.localStorage.setItem('mp_backup_versions', JSON.stringify([{id:'ver_1',label:'test',createdAt:'2026-01-01',data:{}}]));
s6.exportVersionHistory();
ok(s6._clickedLinks.length===1,'exportVersionHistory clicked anchor when versions exist');

// ═══════════════════════════════════════════════════════════════════════
console.log('\n7. createBackupVersion — saves version and calls renderBackupDashboard');
var s7=makeSandbox();
var renderCalled7=0;
load(s7,'js/shared/backup.js');
s7.renderBackupDashboard=function(){ renderCalled7++; };
s7._setPrompt('avant-test');
s7.createBackupVersion();
var saved=JSON.parse(s7.localStorage.getItem('mp_backup_versions')||'[]');
ok(saved.length===1,'createBackupVersion saves one version');
ok(saved[0].label==='avant-test','version label matches prompt');
ok(saved[0].id.indexOf('ver_')===0,'version id has ver_ prefix');
ok(renderCalled7===1,'createBackupVersion calls renderBackupDashboard');

// ═══════════════════════════════════════════════════════════════════════
console.log('\n8. createBackupVersion — aborts if prompt cancelled');
var s8=makeSandbox();
var renderCalled8=0;
load(s8,'js/shared/backup.js');
s8.renderBackupDashboard=function(){ renderCalled8++; };
s8._setPrompt(null);
s8.createBackupVersion();
var saved8=JSON.parse(s8.localStorage.getItem('mp_backup_versions')||'[]');
ok(saved8.length===0,'createBackupVersion aborts when prompt returns null');
ok(renderCalled8===0,'createBackupVersion does not call render when aborted');

// ═══════════════════════════════════════════════════════════════════════
console.log('\n9. createBackupVersion — caps at 20 versions');
var s9=makeSandbox();
load(s9,'js/shared/backup.js');
s9.renderBackupDashboard=function(){};
var existing=[];
for(var i=0;i<20;i++) existing.push({id:'ver_'+i,label:'v'+i,createdAt:'2026-01-01',data:{}});
s9.localStorage.setItem('mp_backup_versions',JSON.stringify(existing));
s9._setPrompt('new-ver');
s9.createBackupVersion();
var saved9=JSON.parse(s9.localStorage.getItem('mp_backup_versions')||'[]');
ok(saved9.length===20,'createBackupVersion keeps max 20 versions');
ok(saved9[0].label==='new-ver','newest version is first');

// ═══════════════════════════════════════════════════════════════════════
console.log('\n10. importBackup — restores recognized keys');
var s10=makeSandbox();
var renderCalled10=0;
load(s10,'js/shared/backup.js');
s10.renderBackupDashboard=function(){ renderCalled10++; };
var fakeFile={_content:JSON.stringify({inscriptions:[{id:99}],contacts:[{id:88}]}), name:'test.json'};
s10.importBackup({target:{files:[fakeFile],value:''}});
var restoredInsc=JSON.parse(s10.localStorage.getItem('mp_inscriptions')||'[]');
ok(restoredInsc.length===1,'importBackup restored inscriptions');
ok(restoredInsc[0].id===99,'importBackup restored correct inscription id');
ok(renderCalled10===1,'importBackup calls renderBackupDashboard');
ok(s10._alertLog.some(function(a){ return a.indexOf('succès')>=0||a.indexOf('success')>=0||a.indexOf('collection')>=0; }),'importBackup alerts success');

// ═══════════════════════════════════════════════════════════════════════
console.log('\n11. importBackup — alerts on no recognized keys');
var s11=makeSandbox();load(s11,'js/shared/backup.js');
s11.renderBackupDashboard=function(){};
s11.importBackup({target:{files:[{_content:'{"unknown_key":[1,2,3]}',name:'bad.json'}],value:''}});
ok(s11._alertLog.some(function(a){ return a.indexOf('invalide')>=0||a.indexOf('aucune')>=0||a.indexOf('invalid')>=0; }),'importBackup alerts on no recognized keys');

// ═══════════════════════════════════════════════════════════════════════
console.log('\n12. importBackup — alerts on parse error');
var s12=makeSandbox();load(s12,'js/shared/backup.js');
s12.renderBackupDashboard=function(){};
s12.importBackup({target:{files:[{_content:'not-json', name:'err.json'}],value:''}});
ok(s12._alertLog.some(function(a){ return a.indexOf('Erreur')>=0||a.indexOf('lecture')>=0; }),'importBackup alerts on parse error');

// ═══════════════════════════════════════════════════════════════════════
console.log('\n13. importBackup — no files early return');
var s13=makeSandbox();load(s13,'js/shared/backup.js');
var rendered13=0;
s13.renderBackupDashboard=function(){ rendered13++; };
s13.importBackup({target:{files:[],value:''}});
ok(rendered13===0,'importBackup returns early when no files');

// ═══════════════════════════════════════════════════════════════════════
console.log('\n14. _restoreVersion — restores data');
var s14=makeSandbox();
load(s14,'js/shared/backup.js');
s14.renderBackupDashboard=function(){};
var verData={inscriptions:[{id:77}],contacts:[]};
s14.localStorage.setItem('mp_backup_versions',JSON.stringify([{id:'ver_abc',label:'restore-test',data:verData}]));
s14._setConfirm(true);
s14._restoreVersion('ver_abc');
var restored=JSON.parse(s14.localStorage.getItem('mp_inscriptions')||'[]');
ok(restored.length===1,'_restoreVersion restores inscriptions');
ok(restored[0].id===77,'_restoreVersion restores correct id');

// ═══════════════════════════════════════════════════════════════════════
console.log('\n15. _restoreVersion — aborts when confirm cancelled');
var s15=makeSandbox();
load(s15,'js/shared/backup.js');
s15.renderBackupDashboard=function(){};
s15.localStorage.setItem('mp_backup_versions',JSON.stringify([{id:'ver_x',label:'cancel-test',data:{inscriptions:[{id:55}]}}]));
s15._setConfirm(false);
s15._restoreVersion('ver_x');
var notRestored=s15.localStorage.getItem('mp_inscriptions');
ok(!notRestored,'_restoreVersion aborts when confirm false');

// ═══════════════════════════════════════════════════════════════════════
console.log('\n16. _restoreVersion — unknown id returns without effect');
var s16=makeSandbox();load(s16,'js/shared/backup.js');
var rendered16=0;
s16.renderBackupDashboard=function(){ rendered16++; };
s16.localStorage.setItem('mp_backup_versions','[]');
s16._restoreVersion('ver_nonexistent');
ok(rendered16===0,'_restoreVersion does nothing for unknown id');

// ═══════════════════════════════════════════════════════════════════════
console.log('\n17. _deleteVersion — removes version');
var s17=makeSandbox();load(s17,'js/shared/backup.js');
s17.renderBackupDashboard=function(){};
s17._setConfirm(true);
s17.localStorage.setItem('mp_backup_versions',JSON.stringify([{id:'ver_del',label:'todel'},{id:'ver_keep',label:'keep'}]));
s17._deleteVersion('ver_del');
var after=JSON.parse(s17.localStorage.getItem('mp_backup_versions'));
ok(after.length===1,'_deleteVersion removes one version');
ok(after[0].id==='ver_keep','_deleteVersion keeps the right version');

// ═══════════════════════════════════════════════════════════════════════
console.log('\n18. _deleteVersion — aborts when confirm false');
var s18=makeSandbox();load(s18,'js/shared/backup.js');
s18.renderBackupDashboard=function(){};
s18._setConfirm(false);
s18.localStorage.setItem('mp_backup_versions',JSON.stringify([{id:'ver_safe',label:'safe'}]));
s18._deleteVersion('ver_safe');
var after18=JSON.parse(s18.localStorage.getItem('mp_backup_versions'));
ok(after18.length===1,'_deleteVersion aborts when confirm false');

// ═══════════════════════════════════════════════════════════════════════
console.log('\n19. renderBackupDashboard — early return when no element');
var s19=makeSandbox({document:{getElementById:function(){ return null; }}});
load(s19,'js/shared/backup.js');
ok((function(){ try{ s19.renderBackupDashboard(); return true; }catch(e){ return false; }})(),'renderBackupDashboard with null el does not throw');

// ═══════════════════════════════════════════════════════════════════════
console.log('\n20. renderBackupDashboard — sets innerHTML');
var s20=makeSandbox();
var dashEl={innerHTML:''};
s20.document.getElementById=function(id){ return id==='backup-dashboard'?dashEl:{id:id,innerHTML:'',style:{}}; };
s20.fetch=function(){ return Promise.resolve({json:function(){ return Promise.resolve({ok:false}); }}); };
load(s20,'js/shared/backup.js');
s20.renderBackupDashboard();
ok(dashEl.innerHTML.length>0,'renderBackupDashboard sets innerHTML');
ok(dashEl.innerHTML.indexOf('stat-section-card')>=0,'renderBackupDashboard uses stat-section-card');

// ═══════════════════════════════════════════════════════════════════════
console.log('\n21. Integration and exclusions');
var index=fs.readFileSync(path.join(BASE,'index.html'),'utf8');
var app=fs.readFileSync(path.join(BASE,'js/app.js'),'utf8');
var mod=fs.readFileSync(path.join(BASE,'js/shared/backup.js'),'utf8');
var router=fs.readFileSync(path.join(BASE,'js/core/router.js'),'utf8');

ok(index.indexOf('js/shared/backup.js')>index.indexOf('js/shared/spectacle-calculator.js'),'backup.js script follows spectacle-calculator.js in index.html');
ok(index.indexOf('js/shared/backup.js')<index.indexOf('js/taches.js'),'backup.js script precedes taches.js');
ok(app.indexOf('function _getAllData(')<0,'_getAllData removed from app.js');
ok(app.indexOf('function exportBackup(')<0,'exportBackup removed from app.js');
ok(app.indexOf('function importBackup(')<0,'importBackup removed from app.js');
ok(app.indexOf('function createBackupVersion(')<0,'createBackupVersion removed from app.js');
ok(app.indexOf('function exportVersionHistory(')<0,'exportVersionHistory removed from app.js');
ok(app.indexOf('function pushAllToServer(')<0,'pushAllToServer removed from app.js');
ok(app.indexOf('function renderBackupDashboard(')<0,'renderBackupDashboard removed from app.js');
ok(app.indexOf('function runDiskCleanup(')<0,'runDiskCleanup removed from app.js');
ok(app.indexOf('function _restoreVersion(')<0,'_restoreVersion removed from app.js');
ok(app.indexOf('function _deleteVersion(')<0,'_deleteVersion removed from app.js');
ok(app.indexOf('function _restoreServerBackup(')<0,'_restoreServerBackup removed from app.js');
ok(app.indexOf('js/shared/backup.js')>=0||app.indexOf('Backup/Export/Restore')>=0,'Stage 4AD ref comment present in app.js');
ok(mod.indexOf('MYTHOS PROD')>=0,'module has canonical header comment');
ok(router.indexOf('renderBackupDashboard()')>=0,'router still calls renderBackupDashboard');
ok((mod.match(/function renderBackupDashboard\(/g)||[]).length===1,'renderBackupDashboard defined exactly once in module');
ok((mod.match(/function _getAllData\(/g)||[]).length===1,'_getAllData defined exactly once in module');
var nc=require('child_process').spawnSync(process.execPath,['-c','js/shared/backup.js'],{cwd:BASE});
ok(nc.status===0,'js/shared/backup.js passes node -c');
var na=require('child_process').spawnSync(process.execPath,['-c','js/app.js'],{cwd:BASE});
ok(na.status===0,'js/app.js passes node -c after Stage 4AD extraction');

// ═══════════════════════════════════════════════════════════════════════
console.log('\nStage 4AD: '+pass+' passed, '+fail+' failed');
if(fail)process.exit(1);
process.exit(0);
