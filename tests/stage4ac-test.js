'use strict';
var vm=require('vm'),fs=require('fs'),path=require('path'),BASE=path.join(__dirname,'..'),pass=0,fail=0;
function ok(v,l){if(v){pass++;console.log('  PASS '+l);}else{fail++;console.log('  FAIL '+l);}}

function makeSelect(id){
  var opts=[];
  return{id:id,value:'0',_opts:opts,options:{get length(){return opts.length;}},
    onchange:null,
    add:function(o){opts.push(o);},
    get value(){return this._value||'0';},
    set value(v){this._value=v;}
  };
}
function makeEl(id){return{id:id,textContent:'',innerHTML:'',value:'',style:{}};}
function Option(label,val){this.text=label;this.value=val;}

function sandbox(overrides){
  var selActors=makeSelect('spectacle-actors');
  var selDistance=makeSelect('spectacle-distance');
  var elAmount=makeEl('spectacle-amount');
  var elNote=makeEl('spectacle-selection-text');
  var els={'spectacle-actors':selActors,'spectacle-distance':selDistance,'spectacle-amount':elAmount,'spectacle-selection-text':elNote};
  var sb={
    document:{getElementById:function(id){return els[id]||null;}},
    Option:Option,
    parseInt:parseInt,
    Number:Number,String:String,Array:Array,Object:Object,Math:Math,
    console:{log:function(){},warn:function(){},error:function(){}},
    _els:els
  };
  Object.assign(sb,overrides||{});
  return vm.createContext(sb);
}
function load(s,f){vm.runInContext(fs.readFileSync(path.join(BASE,f),'utf8'),s);}

console.log('\n1. Globals exported');
var s=sandbox();load(s,'js/shared/spectacle-calculator.js');
ok(typeof s.initSpectacleCalculator==='function','initSpectacleCalculator is global function');

console.log('\n2. Missing DOM — early return');
var missing=sandbox();missing.document.getElementById=function(){return null;};
load(missing,'js/shared/spectacle-calculator.js');
ok((function(){try{missing.initSpectacleCalculator();return true;}catch(e){return false;}})(),'initSpectacleCalculator with missing selects does not throw');

console.log('\n3. Select population');
var s3=sandbox();load(s3,'js/shared/spectacle-calculator.js');
s3.initSpectacleCalculator();
ok(s3._els['spectacle-actors'].options.length===8,'8 actor rows populated');
ok(s3._els['spectacle-distance'].options.length===6,'6 distance columns populated');
ok(s3._els['spectacle-actors']._opts[0].text.indexOf('1 ou 2')>=0,'first actor row label correct');
ok(s3._els['spectacle-distance']._opts[5].text.indexOf('401')>=0,'last distance label mentions 401');

console.log('\n4. Calculation — default (row 0, col 0)');
var s4=sandbox();load(s4,'js/shared/spectacle-calculator.js');
s4.initSpectacleCalculator();
ok(parseInt(s4._els['spectacle-amount'].textContent.replace(/[^0-9]/g,''),10)===1500,'default calc: 1-2 actors, 0-50km = 1500 TND');
ok(s4._els['spectacle-selection-text'].textContent.indexOf('00 à 50')>=0,'note contains distance label');
ok(s4._els['spectacle-selection-text'].textContent.indexOf('1 ou 2')>=0,'note contains actor label');

console.log('\n5. Calculation — row 7, col 5 (maximum)');
var s5=sandbox();load(s5,'js/shared/spectacle-calculator.js');
s5.initSpectacleCalculator();
s5._els['spectacle-actors']._value='7';
s5._els['spectacle-distance']._value='5';
if(s5._els['spectacle-actors'].onchange) s5._els['spectacle-actors'].onchange();
ok(parseInt(s5._els['spectacle-amount'].textContent.replace(/[^0-9]/g,''),10)===8500,'max calc: 21+ actors, 401km+ = 8500 TND');
ok(s5._els['spectacle-selection-text'].textContent.indexOf('401')>=0,'max note contains 401');
ok(s5._els['spectacle-selection-text'].textContent.indexOf('21')>=0,'max note mentions 21');

console.log('\n6. Repeated init skips select repopulation');
var s6=sandbox();load(s6,'js/shared/spectacle-calculator.js');
s6.initSpectacleCalculator();
var countAfterFirst=s6._els['spectacle-actors'].options.length;
s6.initSpectacleCalculator();
ok(s6._els['spectacle-actors'].options.length===countAfterFirst,'second initSpectacleCalculator call does not re-add options');

console.log('\n7. onchange handler wired');
var s7=sandbox();load(s7,'js/shared/spectacle-calculator.js');
s7.initSpectacleCalculator();
ok(typeof s7._els['spectacle-actors'].onchange==='function','selActors.onchange wired after init');
ok(typeof s7._els['spectacle-distance'].onchange==='function','selDistance.onchange wired after init');

console.log('\n8. Integration and exclusions');
var index=fs.readFileSync(path.join(BASE,'index.html'),'utf8');
var app=fs.readFileSync(path.join(BASE,'js/app.js'),'utf8');
var mod=fs.readFileSync(path.join(BASE,'js/shared/spectacle-calculator.js'),'utf8');
var router=fs.readFileSync(path.join(BASE,'js/core/router.js'),'utf8');
ok(index.indexOf('js/shared/spectacle-calculator.js')>index.indexOf('js/shared/contacts.js'),'spectacle-calculator script follows contacts in index.html');
ok(index.indexOf('js/shared/spectacle-calculator.js')<index.indexOf('js/taches.js'),'spectacle-calculator precedes taches.js');
ok(app.indexOf('function initSpectacleCalculator(')<0,'initSpectacleCalculator removed from app.js');
ok(app.indexOf('js/shared/spectacle-calculator.js')>=0||app.indexOf('Spectacle Calculator')>=0,'Stage 4AC ref comment present in app.js');
ok(mod.indexOf('MYTHOS PROD')>=0,'module has canonical header comment');
ok(router.indexOf("initSpectacleCalculator()")>=0,'router still calls initSpectacleCalculator');
ok((mod.match(/function initSpectacleCalculator\(/g)||[]).length===1,'initSpectacleCalculator defined exactly once in module');
var nc=require('child_process').spawnSync(process.execPath,['-c','js/shared/spectacle-calculator.js'],{cwd:BASE});
ok(nc.status===0,'js/shared/spectacle-calculator.js passes node -c');
var na=require('child_process').spawnSync(process.execPath,['-c','js/app.js'],{cwd:BASE});
ok(na.status===0,'js/app.js passes node -c after Stage 4AC extraction');

console.log('\nStage 4AC: '+pass+' passed, '+fail+' failed');
if(fail)process.exit(1);
process.exit(0);
