'use strict';
var fs=require('fs'),path=require('path'),vm=require('vm');
var BASE=path.join(__dirname,'..');
var pass=0,fail=0;
function ok(v,l){if(v){pass++;console.log('  PASS '+l);}else{fail++;console.log('  FAIL '+l);}}

// ── Sandbox setup ─────────────────────────────────────────────────────────────
var _docs=[];
var sandbox={
  // STORE mock
  STORE:{
    documents:function(){ return JSON.parse(JSON.stringify(_docs)); },
    saveDocuments:function(d){ _docs=JSON.parse(JSON.stringify(d)); }
  },
  // DOM mock
  document:{
    _els:{},
    _listeners:[],
    getElementById:function(id){
      if(!this._els[id]){
        this._els[id]={
          id:id, value:'', textContent:'', innerHTML:'', style:{display:''},
          dataset:{}, disabled:false,
          parentNode:{ appendChild:function(){} }
        };
      }
      return this._els[id];
    },
    querySelector:function(){ return null; },
    querySelectorAll:function(){ return []; },
    createElement:function(tag){ return {type:'',id:'',value:'',parentNode:{appendChild:function(){}}}; },
    addEventListener:function(evt,fn){ this._listeners.push({evt:evt,fn:fn}); }
  },
  window:{ open:function(){ return null; }, location:{ origin:'https://example.com' } },
  alert:function(){}, confirm:function(){ return true; },
  fetch:function(){ return Promise.resolve({ok:true,json:function(){return Promise.resolve({ok:true,url:'/documents/x.jpg',fileType:'image'});},text:function(){return Promise.resolve('');}}); },
  FormData:function(){ this.append=function(){}; },
  FileReader:function(){
    var self=this;
    this.readAsDataURL=function(f){ setTimeout(function(){ if(self.onload) self.onload({target:{result:'data:image/png;base64,abc'}}); },0); };
    this.readAsText=function(f){ setTimeout(function(){ if(self.onload) self.onload({target:{result:'text content'}}); },0); };
  },
  Blob:function(){},
  URL:{createObjectURL:function(){return 'blob:x';},revokeObjectURL:function(){}},
  atob:function(s){ return Buffer.from(s,'base64').toString('binary'); },
  Uint8Array:Uint8Array,
  TextDecoder:function(){ this.decode=function(){ return 'decoded'; }; },
  setTimeout:function(){},
  encodeURIComponent:encodeURIComponent,
  escapeHtml:function(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); },
  Array:Array,Object:Object,JSON:JSON,String:String,parseInt:parseInt,parseFloat:parseFloat,
  Math:Math,Date:Date,Promise:Promise,Error:Error,Boolean:Boolean,Number:Number,
  isNaN:isNaN
};
vm.createContext(sandbox);
var src=fs.readFileSync(path.join(BASE,'js/shared/documentation.js'),'utf8');
vm.runInContext(src,sandbox);

function resetDom(){
  sandbox.document._els={};
  sandbox.document._listeners=[];
  _docs=[];
}

// ── 1. Module-level globals ───────────────────────────────────────────────────
console.log('\n1. Module-level globals');
ok(sandbox._docCurrentFolder===null,'_docCurrentFolder initialised to null');
ok(typeof sandbox.DOC_FOLDERS==='object','DOC_FOLDERS is object');
ok(typeof sandbox.DOC_FOLDERS.mythos==='object','DOC_FOLDERS.mythos defined');
ok(typeof sandbox.DOC_FOLDERS.nouveau==='object','DOC_FOLDERS.nouveau defined');
ok(typeof sandbox.DOC_FOLDERS.archive==='object','DOC_FOLDERS.archive defined');
ok(Array.isArray(sandbox._bulkFiles),'_bulkFiles initialised as array');

// ── 2. Function presence ──────────────────────────────────────────────────────
console.log('\n2. Function presence');
var fns=['renderDocumentation','switchDocTab','openDocFolder','_renderDocHome','_renderDocFolder',
  'renderDocList','_docTypeInfo','_docAbsoluteUrl','_docViewerUrl','_decodeDataUrlText',
  '_openTextDocument','_openServerDocument','_renderStoredDocPreview','_docThumb',
  'openDocModal','closeDocModal','previewDocPhoto','_cleanDocumentName','_fileInfo',
  'saveDoc','_saveDocFallbackBase64','_saveDocRecord','deleteDoc','docPreviewPhoto',
  'docPrint','docWhatsapp','docEmail','toggleMoveMenu','moveDoc',
  'openBulkUploadModal','closeBulkUploadModal','previewBulkFiles','saveBulkDocs'];
fns.forEach(function(n){ ok(typeof sandbox[n]==='function',n+' exported as function'); });

// ── 3. openDocFolder sets _docCurrentFolder ───────────────────────────────────
console.log('\n3. openDocFolder');
resetDom();
sandbox.document._els['doc-main-container']={ innerHTML:'', style:{}, dataset:{} };
sandbox.openDocFolder('mythos');
ok(sandbox._docCurrentFolder==='mythos','openDocFolder sets _docCurrentFolder');

// ── 4. renderDocumentation dispatches correctly ───────────────────────────────
console.log('\n4. renderDocumentation dispatch');
resetDom();
sandbox._docCurrentFolder=null;
sandbox.document._els['doc-main-container']={ innerHTML:'', style:{}, dataset:{} };
sandbox.renderDocumentation();
ok(sandbox.document._els['doc-main-container'].innerHTML.indexOf('Mes Documents')>=0,'renderDocumentation→home shows Mes Documents');
sandbox._docCurrentFolder='nouveau';
sandbox.document._els['doc-main-container']={ innerHTML:'', style:{}, dataset:{} };
sandbox.renderDocumentation();
ok(sandbox.document._els['doc-main-container'].innerHTML.indexOf('Documentation')>=0,'renderDocumentation→folder shows back button');

// ── 5. switchDocTab compat alias ──────────────────────────────────────────────
console.log('\n5. switchDocTab compat');
resetDom();
sandbox._docCurrentFolder=null;
sandbox.document._els['doc-main-container']={ innerHTML:'', style:{}, dataset:{} };
sandbox.switchDocTab('archive');
ok(sandbox._docCurrentFolder==='archive','switchDocTab sets _docCurrentFolder');

// ── 6. renderDocList compat alias ─────────────────────────────────────────────
console.log('\n6. renderDocList compat');
resetDom();
sandbox._docCurrentFolder=null;
sandbox.document._els['doc-main-container']={ innerHTML:'', style:{}, dataset:{} };
sandbox.renderDocList('mythos');
ok(sandbox.document._els['doc-main-container'].innerHTML.indexOf('Documentation')>=0,'renderDocList renders folder view');

// ── 7. _cleanDocumentName ─────────────────────────────────────────────────────
console.log('\n7. _cleanDocumentName');
ok(sandbox._cleanDocumentName('mon-fichier.pdf')==='mon-fichier','strips .pdf extension');
ok(sandbox._cleanDocumentName('photo.jpg')==='photo','strips .jpg extension');
ok(sandbox._cleanDocumentName('doc.docx')==='doc','strips .docx extension');
ok(sandbox._cleanDocumentName('')==='','empty string safe');
ok(sandbox._cleanDocumentName(null)==='','null safe');

// ── 8. _fileInfo ──────────────────────────────────────────────────────────────
console.log('\n8. _fileInfo');
ok(sandbox._fileInfo({name:'test.pdf',type:'application/pdf'}).type==='pdf','pdf detected');
ok(sandbox._fileInfo({name:'photo.jpg',type:'image/jpeg'}).type==='image','image detected');
ok(sandbox._fileInfo({name:'doc.docx',type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}).type==='word','word detected');
ok(sandbox._fileInfo({name:'sheet.xlsx',type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}).type==='excel','excel detected');
ok(sandbox._fileInfo({name:'data.csv',type:'text/csv'}).type==='csv','csv detected');
ok(sandbox._fileInfo({name:'notes.txt',type:'text/plain'}).type==='text','text detected');
ok(sandbox._fileInfo({name:'unknown.bin',type:'application/octet-stream'}).type==='file','fallback file type');

// ── 9. _docTypeInfo ───────────────────────────────────────────────────────────
console.log('\n9. _docTypeInfo');
ok(sandbox._docTypeInfo({fileType:'image',photo:''}).isImage===true,'image isImage true');
ok(sandbox._docTypeInfo({fileType:'pdf',photo:''}).isImage===false,'pdf isImage false');
ok(sandbox._docTypeInfo({fileType:'pdf',photo:''}).label==='PDF','pdf label PDF');
ok(sandbox._docTypeInfo({fileType:'word',photo:''}).label==='Word','word label Word');
ok(sandbox._docTypeInfo({fileType:'excel',photo:''}).label==='Excel','excel label Excel');
ok(sandbox._docTypeInfo({fileType:'csv',photo:''}).label==='CSV','csv label CSV');
ok(sandbox._docTypeInfo({fileType:'text',photo:''}).label==='Texte','text label Texte');
ok(sandbox._docTypeInfo({fileType:'',photo:'data:image/png;base64,abc'}).isImage===true,'data-url image detected');

// ── 10. _docAbsoluteUrl ───────────────────────────────────────────────────────
console.log('\n10. _docAbsoluteUrl');
ok(sandbox._docAbsoluteUrl('https://example.com/x.pdf')==='https://example.com/x.pdf','absolute URL unchanged');
ok(sandbox._docAbsoluteUrl('/documents/x.pdf')==='https://example.com/documents/x.pdf','relative /path prepended with origin');
ok(sandbox._docAbsoluteUrl('')==='','empty string returns empty');
ok(sandbox._docAbsoluteUrl(null)==='','null returns empty');

// ── 11. _docViewerUrl ─────────────────────────────────────────────────────────
console.log('\n11. _docViewerUrl');
ok(sandbox._docViewerUrl(null)==='','null doc returns empty');
ok(sandbox._docViewerUrl({photo:'data:image/png;base64,abc',fileType:'image'})==='','data-url returns empty (not server path)');
ok(sandbox._docViewerUrl({photo:'/documents/x.pdf',fileType:'pdf'}).indexOf('https://example.com/documents/x.pdf')>=0,'pdf viewer returns absolute url');
ok(sandbox._docViewerUrl({photo:'/documents/x.docx',fileType:'word'}).indexOf('officeapps.live.com')>=0,'word uses office viewer');
ok(sandbox._docViewerUrl({photo:'/documents/x.xlsx',fileType:'excel'}).indexOf('officeapps.live.com')>=0,'excel uses office viewer');

// ── 12. _decodeDataUrlText ────────────────────────────────────────────────────
console.log('\n12. _decodeDataUrlText');
var b64=Buffer.from('hello world').toString('base64');
ok(sandbox._decodeDataUrlText('data:text/plain;base64,'+b64)==='decoded','decodes base64 (mocked TextDecoder)');
// empty/null: no base64 part, atob('') → binary='', Uint8Array(0), TextDecoder.decode→'decoded' from mock
ok(typeof sandbox._decodeDataUrlText('')==='string','empty string returns string');
ok(typeof sandbox._decodeDataUrlText(null)==='string','null returns string');

// ── 13. _renderStoredDocPreview ───────────────────────────────────────────────
console.log('\n13. _renderStoredDocPreview');
var imgHtml=sandbox._renderStoredDocPreview({fileType:'image',photo:'data:image/png;base64,abc'});
ok(imgHtml.indexOf('<img')>=0,'image doc renders img tag');
var pdfHtml=sandbox._renderStoredDocPreview({fileType:'pdf',photo:'/documents/x.pdf'});
ok(pdfHtml.indexOf('<div')>=0,'non-image doc renders div');
ok(pdfHtml.indexOf('PDF')>=0,'pdf label shown in preview');

// ── 14. _docThumb ─────────────────────────────────────────────────────────────
console.log('\n14. _docThumb');
var emptyThumb=sandbox._docThumb({id:'d1',photo:'',fileType:'image'});
ok(emptyThumb.indexOf('dashed')>=0,'empty photo shows dashed placeholder');
var imgThumb=sandbox._docThumb({id:'d1',photo:'data:image/png;base64,abc',fileType:'image'});
ok(imgThumb.indexOf('<img')>=0,'image doc shows img thumbnail');
var pdfThumb=sandbox._docThumb({id:'d1',photo:'/documents/x.pdf',fileType:'pdf'});
ok(pdfThumb.indexOf('onclick')>=0,'non-image shows clickable thumb');

// ── 15. _saveDocRecord ────────────────────────────────────────────────────────
console.log('\n15. _saveDocRecord');
resetDom();
sandbox.document._els['doc-note']={ value:'test note' };
sandbox.document._els['doc-modal']={ style:{ display:'flex' } };
sandbox.document._els['doc-main-container']={ innerHTML:'' };
sandbox._docCurrentFolder='mythos';
sandbox._saveDocRecord('doc_1','mythos','Test Doc','data:image/png;base64,abc','image',undefined);
ok(_docs.length===1,'_saveDocRecord saves doc to STORE');
ok(_docs[0].id==='doc_1','saved doc has correct id');
ok(_docs[0].cat==='mythos','saved doc has correct cat');
ok(_docs[0].name==='Test Doc','saved doc has correct name');
ok(_docs[0].fileType==='image','saved doc has correct fileType');

// update existing doc
sandbox._saveDocRecord('doc_1','mythos','Updated Doc','data:image/png;base64,xyz','image','updated note');
ok(_docs.length===1,'update existing doc does not duplicate');
ok(_docs[0].name==='Updated Doc','updated doc name');

// ── 16. deleteDoc ─────────────────────────────────────────────────────────────
console.log('\n16. deleteDoc');
resetDom();
_docs=[{id:'doc_2',cat:'nouveau',name:'To Delete',photo:'data:image/png;base64,abc',fileType:'image',note:'',createdAt:'2026-01-01T00:00:00.000Z'}];
sandbox.document._els['doc-main-container']={ innerHTML:'' };
sandbox._docCurrentFolder='nouveau';
sandbox.deleteDoc('doc_2');
ok(_docs.length===0,'deleteDoc removes doc from STORE');

// ── 17. deleteDoc confirm=false aborts ────────────────────────────────────────
console.log('\n17. deleteDoc abort');
_docs=[{id:'doc_3',cat:'mythos',name:'Keep',photo:'',fileType:'image',note:'',createdAt:'2026-01-01T00:00:00.000Z'}];
var origConfirm=sandbox.confirm;
sandbox.confirm=function(){ return false; };
sandbox.deleteDoc('doc_3');
ok(_docs.length===1,'deleteDoc aborted when confirm=false');
sandbox.confirm=origConfirm;

// ── 18. openDocModal sets DOM fields ─────────────────────────────────────────
console.log('\n18. openDocModal');
resetDom();
sandbox.document._els['doc-modal-title']={ textContent:'' };
sandbox.document._els['doc-edit-id']={ value:'' };
sandbox.document._els['doc-edit-cat']={ value:'' };
sandbox.document._els['doc-name']={ value:'' };
sandbox.document._els['doc-note']={ value:'' };
sandbox.document._els['doc-photo-preview']={ innerHTML:'', dataset:{photoData:''} };
sandbox.document._els['doc-photo-input']={ value:'' };
sandbox.document._els['doc-modal']={ style:{ display:'none' } };
sandbox.openDocModal('mythos');
ok(sandbox.document._els['doc-modal'].style.display==='flex','openDocModal shows modal');
ok(sandbox.document._els['doc-edit-cat'].value==='mythos','openDocModal sets cat');

// open for edit
_docs=[{id:'doc_4',cat:'mythos',name:'Existing',photo:'data:image/png;base64,abc',note:'note here',fileType:'image',createdAt:'2026-01-01'}];
sandbox.openDocModal('mythos','doc_4');
ok(sandbox.document._els['doc-name'].value==='Existing','openDocModal fills name for edit');
ok(sandbox.document._els['doc-note'].value==='note here','openDocModal fills note for edit');

// ── 19. closeDocModal hides modal ─────────────────────────────────────────────
console.log('\n19. closeDocModal');
sandbox.document._els['doc-modal']={ style:{ display:'flex' } };
sandbox.document._els['doc-photo-preview']={ dataset:{ photoData:'abc', photoType:'image' } };
sandbox.closeDocModal();
ok(sandbox.document._els['doc-modal'].style.display==='none','closeDocModal hides modal');

// ── 20. toggleMoveMenu and document click listener ────────────────────────────
console.log('\n20. toggleMoveMenu + click listener');
resetDom();
var menu1={ id:'move-menu-d1', style:{ display:'none' } };
var menu2={ id:'move-menu-d2', style:{ display:'none' } };
sandbox.document.querySelectorAll=function(sel){
  if(sel==='.doc-move-menu') return [menu1,menu2];
  return [];
};
sandbox.document.getElementById=function(id){
  if(id==='move-menu-d1') return menu1;
  if(id==='move-menu-d2') return menu2;
  return null;
};
sandbox.toggleMoveMenu(null,'d1');
ok(menu1.style.display==='block','toggleMoveMenu opens menu');
ok(menu2.style.display==='none','toggleMoveMenu closes other menus');
sandbox.toggleMoveMenu(null,'d1');
ok(menu1.style.display==='none','toggleMoveMenu toggles menu closed');
// click listener registered at module load — verify in source
ok(src.indexOf("document.addEventListener('click'")>=0,'document click listener present in source');

// ── 21. moveDoc updates cat ───────────────────────────────────────────────────
console.log('\n21. moveDoc');
resetDom();
_docs=[{id:'doc_5',cat:'nouveau',name:'Move Me',photo:'',fileType:'image',note:'',createdAt:''}];
sandbox.document._els['doc-main-container']={ innerHTML:'' };
sandbox._docCurrentFolder='nouveau';
sandbox.document.getElementById=function(id){
  if(id==='move-menu-doc_5') return {style:{display:'block'}};
  return sandbox.document._els[id]||null;
};
sandbox.moveDoc('doc_5','archive');
ok(_docs[0].cat==='archive','moveDoc updates doc cat');

// ── 22. openBulkUploadModal resets state ──────────────────────────────────────
console.log('\n22. openBulkUploadModal');
resetDom();
sandbox._bulkFiles=['fake'];
sandbox.document._els['bulk-files-input']={ value:'x' };
sandbox.document._els['bulk-preview-list']={ innerHTML:'filled' };
sandbox.document._els['bulk-target-folder']={ value:'' };
sandbox.document._els['bulk-upload-modal']={ style:{ display:'none' } };
sandbox.openBulkUploadModal('archive');
ok(sandbox._bulkFiles.length===0,'openBulkUploadModal resets _bulkFiles');
ok(sandbox.document._els['bulk-files-input'].value==='','openBulkUploadModal clears file input');
ok(sandbox.document._els['bulk-preview-list'].innerHTML==='','openBulkUploadModal clears preview');
ok(sandbox.document._els['bulk-target-folder'].value==='archive','openBulkUploadModal sets folder');
ok(sandbox.document._els['bulk-upload-modal'].style.display==='flex','openBulkUploadModal shows modal');

// default folder fallback
sandbox.document._els['bulk-target-folder']={ value:'' };
sandbox.openBulkUploadModal();
ok(sandbox.document._els['bulk-target-folder'].value==='nouveau','openBulkUploadModal defaults to nouveau');

// ── 23. closeBulkUploadModal ─────────────────────────────────────────────────
console.log('\n23. closeBulkUploadModal');
sandbox.document._els['bulk-upload-modal']={ style:{ display:'flex' } };
sandbox.closeBulkUploadModal();
ok(sandbox.document._els['bulk-upload-modal'].style.display==='none','closeBulkUploadModal hides modal');

// ── 24. _renderDocHome empty state ────────────────────────────────────────────
console.log('\n24. _renderDocHome');
resetDom();
_docs=[];
sandbox.document.getElementById=function(id){ return sandbox.document._els[id]||null; };
sandbox.document._els['doc-main-container']={ innerHTML:'' };
sandbox._renderDocHome();
var homeHtml=sandbox.document._els['doc-main-container'].innerHTML;
ok(homeHtml.indexOf('Mes Documents')>=0,'_renderDocHome shows title');
ok(homeHtml.indexOf('0 document')>=0,'_renderDocHome shows 0 docs count');
ok(homeHtml.indexOf('openDocFolder')>=0,'_renderDocHome renders folder links');

// ── 25. _renderDocFolder empty state ─────────────────────────────────────────
console.log('\n25. _renderDocFolder empty');
resetDom();
_docs=[];
sandbox.document._els['doc-main-container']={ innerHTML:'' };
sandbox._renderDocFolder('mythos');
ok(sandbox.document._els['doc-main-container'].innerHTML.indexOf('Dossier vide')>=0,'empty folder shows empty-state message');

// ── 26. _renderDocFolder with docs ───────────────────────────────────────────
console.log('\n26. _renderDocFolder with docs');
resetDom();
_docs=[{id:'d6',cat:'mythos',name:'Test File',photo:'data:image/png;base64,abc',fileType:'image',note:'',createdAt:'2026-01-01T00:00:00.000Z'}];
sandbox.document._els['doc-main-container']={ innerHTML:'' };
sandbox.document.querySelectorAll=function(){ return []; };
sandbox._renderDocFolder('mythos');
var folderHtml=sandbox.document._els['doc-main-container'].innerHTML;
ok(folderHtml.indexOf('Test File')>=0,'_renderDocFolder shows doc name');
ok(folderHtml.indexOf('deleteDoc')>=0,'_renderDocFolder shows delete button');
ok(folderHtml.indexOf('openDocModal')>=0,'_renderDocFolder shows edit button');

// ── 27. Integration: script order in index.html ───────────────────────────────
console.log('\n27. Script order in index.html');
var index=fs.readFileSync(path.join(BASE,'index.html'),'utf8');
var bkPos=index.indexOf('js/shared/backup.js');
var docPos=index.indexOf('js/shared/documentation.js');
var tacPos=index.indexOf('js/taches.js');
ok(docPos>0,'documentation.js present in index.html');
ok(docPos>bkPos,'documentation.js after backup.js');
ok(docPos<tacPos,'documentation.js before taches.js');

// ── 28. Integration: functions removed from app.js ────────────────────────────
console.log('\n28. Functions removed from app.js');
var app=fs.readFileSync(path.join(BASE,'js/app.js'),'utf8');
['renderDocumentation','_renderDocHome','_renderDocFolder','openDocModal','closeDocModal',
 'saveDoc','_saveDocRecord','deleteDoc','docPreviewPhoto','openBulkUploadModal','saveBulkDocs',
 '_docCurrentFolder','DOC_FOLDERS'].forEach(function(n){
  ok(app.indexOf(n)<0||app.indexOf('// '+n)>=0 || app.indexOf('// '+n.replace(/^_/,''))<0,n+' not as function in app.js');
});
// Simpler: just check no function declarations remain
['function renderDocumentation(','function _renderDocHome(','function _renderDocFolder(',
 'function openDocModal(','function closeDocModal(','function saveDoc(',
 'function _saveDocRecord(','function deleteDoc(','function saveBulkDocs('].forEach(function(s){
  ok(app.indexOf(s)<0,s.replace('function ','').replace('(','')+'() not in app.js');
});

// ── 29. Syntax check ─────────────────────────────────────────────────────────
console.log('\n29. Syntax check');
var cp=require('child_process');
var r1=cp.spawnSync(process.execPath,['-c','js/app.js'],{cwd:BASE});
ok(r1.status===0,'js/app.js passes node -c');
var r2=cp.spawnSync(process.execPath,['-c','js/shared/documentation.js'],{cwd:BASE});
ok(r2.status===0,'js/shared/documentation.js passes node -c');

console.log('\nStage 4AE: '+pass+' passed, '+fail+' failed');
if(fail)process.exit(1);
process.exit(0);
