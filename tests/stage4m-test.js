'use strict';

var vm=require('vm'), fs=require('fs'), path=require('path');
var BASE=path.join(__dirname,'..'), pass=0, fail=0;
function ok(v,l){if(v){pass++;console.log('  PASS '+l);}else{fail++;console.log('  FAIL '+l);}}
function el(id){return{id:id,value:'',innerHTML:'',textContent:'',checked:false,style:{display:''},children:[],appendChild:function(c){this.children.push(c);},remove:function(){this.removed=true;}};}
function row(desc,qty,pu,unit){
  var inputs=[{value:desc},{value:String(qty)},{value:String(pu)}], cell={textContent:''};
  return {inputs:inputs,select:{value:unit||'Forfait'},cell:cell,removed:false,
    querySelectorAll:function(s){return s==='input'?inputs:[];},
    querySelector:function(s){if(s==='select')return this.select;if(s==='.line-total')return cell;return null;},
    remove:function(){this.removed=true;}};
}
function sandbox(overrides){
  var ids=['invoice-list','edit-id','form-page-title','f-type','f-date','f-status','f-payment-mode','f-num-year','f-num-seq','f-num','f-num-preview','f-timbre-amount','f-client-select','f-client-name','f-client-addr','f-client-mf','lines-body','invoice-number-group','tva-row','timbre-row','total-label','f-tva','t-ht','t-tva','t-timbre','t-ttc','f-addStamp','invoice-preview','preview-modal'];
  var els={};ids.forEach(function(id){els[id]=el(id);});
  var rows=[], state={invoices:[],clients:[],views:[],alerts:[],sidebar:0,logs:[]};
  var sb={
    MYTHOS_PRINT_LOGO_SRC:'logo.png',
    document:{getElementById:function(id){return els[id]||null;},querySelectorAll:function(s){return s==='#lines-body tr'?rows:[];},createElement:function(){var r=row('',0,0);rows.push(r);return r;}},
    STORE:{invoices:function(){return state.invoices;},saveInvoices:function(v){state.invoices=v;},clients:function(){return state.clients;},saveClients:function(v){state.clients=v;}},
    LOGGER:{log:function(a,d){state.logs.push([a,d]);}},
    _els:els,_rows:rows,_state:state,
    esc:function(v){return String(v==null?'':v).replace(/</g,'&lt;');},num:function(v){return Number(v||0);},fmtMoney:function(v){return Number(v||0).toFixed(3);},
    formatDate:function(v){return String(v||'');},getInvoiceHT:function(i){return Number(i.ht||0);},getInvoiceTotal:function(i){return Number(i.ttc||0);},paymentModeLabel:function(v){return v||'';},numberToFrenchWords:function(v){return 'WORDS:'+v;},getStampSVG:function(){return 'stamp.svg';},todayStr:function(){return '2026-08-02';},
    updateInvoicePaymentModeVisibility:function(){state.paymentUpdates=(state.paymentUpdates||0)+1;},showView:function(v){state.views.push(v);},updateSidebarStats:function(){state.sidebar++;},alert:function(v){state.alerts.push(v);},confirm:function(){return true;},
    console:{log:function(){},warn:function(){},error:function(){}},Date:Date,Array:Array,Object:Object,String:String,Number:Number,Math:Math,parseInt:parseInt,Infinity:Infinity
  };
  Object.assign(sb,overrides||{});var __ctx=vm.createContext(sb);vm.runInContext(fs.readFileSync(path.join(BASE,'js/shared/financial-calc.js'),'utf8'),__ctx);return __ctx;
}
function load(sb,f){vm.runInContext(fs.readFileSync(path.join(BASE,f),'utf8'),sb);}

console.log('\n1. Exported globals');
var s=sandbox();load(s,'js/shared/invoices.js');
['renderList','nextInvoiceNum','splitInvoiceNum','initNewForm','handleInvoiceTypeChange','handleInvoiceYearChange','handleInvoiceDateChange','syncInvoiceNumberPreview','fillClientSelect','fillClientFromSelect','addLine','removeLine','getLines','calcTotals','saveInvoice','editInvoice','deleteInvoice','cancelForm','previewInvoice','closePreview','buildInvoiceHTML'].forEach(function(n){ok(typeof s[n]==='function',n+' is global');});
ok(vm.runInContext('stableLineCount',s)===0,'line counter initialized');

console.log('\n2. Rendering and numbering');
s.renderList();ok(s._els['invoice-list'].innerHTML.indexOf('Aucune facture')>=0,'empty state rendered');
s._state.invoices=[{id:'i1',num:'001/2026',date:'2026-08-02',clientName:'A < B',ttc:120,status:'paid',paymentMode:'virement'}];s.renderList();
ok(s._els['invoice-list'].innerHTML.indexOf('A &lt; B')>=0,'invoice client escaped');ok(s._els['invoice-list'].innerHTML.indexOf('001/2026')>=0,'invoice number rendered');
ok(s.nextInvoiceNum(2026)==='002/2026','next invoice number calculated');s._state.invoices=[];ok(s.nextInvoiceNum(2026)==='001/2026','first invoice number calculated');
var split=s.splitInvoiceNum('007/2025');ok(split.seq==='007'&&split.year==='2025','invoice number split');ok(s.splitInvoiceNum('bad').seq==='','invalid number handled');

console.log('\n3. Form and clients');
s._els['f-type'].value='sans_tva';s.handleInvoiceTypeChange();ok(s._els['invoice-number-group'].style.display==='none','number hidden without VAT');ok(s._els['total-label'].textContent==='Total','total label adjusted');
s._els['f-type'].value='tva';s.handleInvoiceTypeChange();ok(s._els['tva-row'].style.display==='','VAT row shown');
s._els['f-num-year'].value='2026';s._els['f-num-seq'].value='8';s.syncInvoiceNumberPreview();ok(s._els['f-num'].value==='008/2026','number preview normalized');
s._els['f-date'].value='2025-04-03';s.handleInvoiceDateChange();ok(s._els['f-num-year'].value==='2025','date updates invoice year');
s._state.clients=[{id:'c1',name:'Client <One>',addr:'Addr',mf:'MF'}];s.fillClientSelect();ok(s._els['f-client-select'].innerHTML.indexOf('Client &lt;One>')>=0,'client option escaped');
s._els['f-client-select'].value='c1';s.fillClientFromSelect();ok(s._els['f-client-name'].value==='Client <One>','client name filled');ok(s._els['f-client-mf'].value==='MF','client tax id filled');

console.log('\n4. Lines and totals');
s._rows.length=0;var r=row('Service',2,50,'Forfait');s._rows.push(r);var lines=s.getLines();ok(lines.length===1&&lines[0].qty===2&&lines[0].pu===50,'invoice lines read');
s._els['f-type'].value='tva';s._els['f-tva'].value='10';s._els['f-timbre-amount'].value='1';s.calcTotals();ok(r.cell.textContent==='100.000','line total calculated');ok(s._els['t-ttc'].textContent==='111.000','invoice total calculated');
s._els['f-type'].value='sans_tva';s.calcTotals();ok(s._els['t-ttc'].textContent==='100.000','taxes omitted without VAT');
s._rows.length=0;vm.runInContext('stableLineCount=0',s);s.addLine('Added',1,3,'Km');ok(vm.runInContext('stableLineCount',s)===1,'addLine increments counter');ok(s._els['lines-body'].children.length===1,'line appended');
s._els['removable']=el('removable');s.document.getElementById=function(id){return s._els[id]||null;};s.removeLine('removable');ok(s._els.removable.removed,'line removed');
s._state.invoices=[];s.initNewForm();ok(s._els['f-date'].value==='2026-08-02','new form date initialized');ok(s._els['f-status'].value==='pending','new form status initialized');ok(s._state.paymentUpdates>0,'payment visibility refreshed');

function setForm(sb,id){sb._els['edit-id'].value=id||'';sb._els['f-type'].value='tva';sb._els['f-client-name'].value='New Client';sb._els['f-client-addr'].value='Addr';sb._els['f-client-mf'].value='MF';sb._els['f-date'].value='2026-08-03';sb._els['f-status'].value='paid';sb._els['f-payment-mode'].value='cash';sb._els['f-num'].value='001/2026';sb._els['f-tva'].value='10';sb._els['f-timbre-amount'].value='1';sb._rows.length=0;sb._rows.push(row('Service',2,50,'Forfait'));}
console.log('\n5. CRUD and preview');
var c=sandbox();load(c,'js/shared/invoices.js');setForm(c);c.saveInvoice();ok(c._state.invoices.length===1,'invoice created');ok(c._state.invoices[0].ttc===111,'invoice totals persisted');ok(c._state.invoices[0].paymentMode==='cash','paid mode persisted');ok(c._state.clients.length===1,'new client created');ok(c._state.logs[0][0]==='SAVE_INVOICE','save logged');ok(c._state.views.pop()==='list','save returns to list');
var id=c._state.invoices[0].id;setForm(c,id);c._els['f-client-name'].value='New Client';c._rows[0].inputs[2].value='100';c.saveInvoice();ok(c._state.invoices.length===1&&c._state.invoices[0].ht===200,'invoice updated');ok(c._state.clients.length===1,'client not duplicated');
c.editInvoice(id);ok(c._state.views.pop()==='new','edit opens form');ok(c._els['edit-id'].value===id,'edit populates identifier');ok(c._els['f-client-name'].value==='New Client','edit populates client');
c._els['f-addStamp'].checked=true;c.previewInvoice(id);ok(c._els['preview-modal'].style.display==='flex','preview opened');ok(c._els['invoice-preview'].innerHTML.indexOf('FACTURE')>=0,'invoice HTML built');c.closePreview();ok(c._els['preview-modal'].style.display==='none','preview closed');
c.deleteInvoice(id);ok(c._state.invoices.length===0,'invoice deleted');ok(c._state.logs.some(function(x){return x[0]==='DELETE_INVOICE';}),'delete logged');ok(c._state.sidebar===1,'delete refreshes sidebar');c.cancelForm();ok(c._state.views.pop()==='list','cancel returns to list');
var guard=sandbox();load(guard,'js/shared/invoices.js');setForm(guard);guard._els['f-client-name'].value='';guard.saveInvoice();ok(guard._state.alerts.length===1&&guard._state.invoices.length===0,'required fields validated');
var empty=sandbox();load(empty,'js/shared/invoices.js');setForm(empty);empty._rows.length=0;empty.saveInvoice();ok(empty._state.alerts.length===1&&empty._state.invoices.length===0,'at least one line required');
var cancelled=sandbox({confirm:function(){return false;}});load(cancelled,'js/shared/invoices.js');cancelled._state.invoices=[{id:'keep'}];cancelled.deleteInvoice('keep');ok(cancelled._state.invoices.length===1,'cancelled delete preserves invoice');
var sans=sandbox();load(sans,'js/shared/invoices.js');sans._state.invoices=[{id:'s',type:'sans_tva'}];sans.previewInvoice('s');ok(sans._els['preview-modal'].style.display!=='flex','non-VAT invoice is not previewed');

console.log('\n6. Integration');
var html=fs.readFileSync(path.join(BASE,'index.html'),'utf8'),app=fs.readFileSync(path.join(BASE,'js/app.js'),'utf8');
ok(html.indexOf('js/shared/invoices.js')>html.indexOf('js/shared/mission-orders.js'),'invoice script follows mission orders');ok(html.indexOf('js/shared/invoices.js')<html.indexOf('js/taches.js'),'invoice script precedes tasks');
ok((app.match(/function renderList\(/g)||[]).length===0,'renderList removed from app.js');ok((app.match(/function saveInvoice\(/g)||[]).length===0,'saveInvoice removed from app.js');ok((app.match(/function buildInvoiceHTML\(/g)||[]).length===0,'buildInvoiceHTML removed from app.js');ok((app.match(/function printModal\(/g)||[]).length===1,'generic printModal remains in app.js');ok((app.match(/function nextDevisNum\(/g)||[]).length===0,'Devis numbering extracted by Stage 4O');

console.log('\nStage 4M: '+pass+' passed, '+fail+' failed');if(fail)process.exit(1);
