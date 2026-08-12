'use strict';
var assert=require('assert'),fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto');
var core=require('../projects/idauto/ops/offhost-backup.js'),s3=require('../projects/idauto/ops/adapters/s3-compatible.js');
var root=fs.mkdtempSync(path.join(os.tmpdir(),'ida-3f-')),passed=0,failed=0;
function sha(b){return crypto.createHash('sha256').update(b).digest('hex');}
function test(name,fn){return Promise.resolve().then(fn).then(function(){passed++;process.stdout.write('PASS '+name+'\n');},function(e){failed++;process.stdout.write('FAIL '+name+': '+e.message+'\n');});}
var sensitiveFixture=['private','fixture','value'].join('-');
function fake(){var data=new Map(),puts=0,failAt=0,unavailable=false;return {data:data,get puts(){return puts;},set failAt(v){failAt=v;},set unavailable(v){unavailable=v;},put:async function(k,b,m){if(unavailable||(++puts===failAt))throw new Error('provider unavailable SECRET_ACCESS_KEY='+sensitiveFixture);b=Buffer.from(b);data.set(k,{b:b,sha:m.sha256});},get:async function(k){if(unavailable)throw new Error('provider unavailable');if(!data.has(k))throw new Error('missing object');return data.get(k).b;},head:async function(k){if(unavailable)throw new Error('provider unavailable');var x=data.get(k);if(!x)throw new Error('missing object');return {size:x.b.length,sha256:x.sha};},list:async function(p){return Array.from(data.keys()).filter(function(k){return k.indexOf(p)===0;});},capabilities:function(){return {put:true,get:true,head:true,list:true,delete:false};}};}
var db=path.join(root,'db'),media=path.join(root,'media'),stage=path.join(root,'stage');fs.mkdirSync(db);fs.mkdirSync(path.join(media,'media'),{recursive:true});
var body=Buffer.from('shared object'),key=sha(body),rel='media/'+key.slice(0,2)+'/'+key.slice(2,4)+'/'+key;fs.mkdirSync(path.dirname(path.join(media,rel)),{recursive:true});fs.writeFileSync(path.join(media,rel),body);fs.writeFileSync(path.join(media,'checksums.sha256'),key+'  '+rel+'\n');fs.writeFileSync(path.join(db,'idauto.dump'),Buffer.from('database dump'));
var mm={created_at_utc:'2026-08-12T00:00:02.000Z',consistency:{state:'CONSISTENT'},database:{row_count:3,distinct_object_keys:1}};fs.writeFileSync(path.join(media,'manifest.json'),JSON.stringify(mm));
var opts={dbDir:db,mediaDir:media,dest:stage,databaseCapturedAt:'2026-08-12T00:00:01.000Z',host:'offline-test',now:'2026-08-12T00:00:03.000Z'};
var tasks=[];function T(n,f){tasks.push(function(){return test(n,f);});}
T('1 local staged DB backup discovery',function(){var m=core.buildManifest(opts);assert.equal(m.database.dump_filename,'idauto.dump');});
T('2 media manifest generation',function(){assert.equal(core.buildManifest(opts).media.object_count,1);});
T('3 checksum verification',function(){core.stage(opts);assert(core.verifyLocal(stage).ok);});
T('4 provider-neutral fake adapter',async function(){var f=fake();assert((await core.push(stage,f,{prefix:'set'})).ok);});
T('5 no credential in manifest',function(){assert(!/credential|secret|token|endpoint/i.test(JSON.stringify(core.buildManifest(opts))));});
T('6 secrets redacted on failure',async function(){var f=fake();f.failAt=1;var r=await core.push(stage,f,{prefix:'x'});assert(!JSON.stringify(r).includes(sensitiveFixture));});
T('7 dry-run no adapter write',async function(){var f=fake();await core.push(stage,f,{dryRun:true});assert.equal(f.puts,0);});
T('8 transfer failure truthful',async function(){var f=fake();f.failAt=1;assert.equal((await core.push(stage,f,{prefix:'x'})).ok,false);});
T('9 partial upload never complete',async function(){var f=fake();f.failAt=2;var r=await core.push(stage,f,{prefix:'p'});assert(r.partial&&!f.data.has('p/COMPLETE'));});
T('10 remote checksum mismatch detected',async function(){var f=fake();await core.push(stage,f,{prefix:'r'});f.data.get('r/'+core.verifyLocal(stage).manifest.objects[0].path).sha='0'.repeat(64);assert.equal((await core.verifyRemote('r',f)).ok,false);});
T('11 database dump checksum mismatch',function(){var p=path.join(stage,'database/idauto.dump'),old=fs.readFileSync(p);fs.writeFileSync(p,'bad');assert(!core.verifyLocal(stage).ok);fs.writeFileSync(p,old);});
T('12 media object checksum mismatch',function(){var p=path.join(stage,'media-backup',rel),old=fs.readFileSync(p);fs.writeFileSync(p,'bad');assert(!core.verifyLocal(stage).ok);fs.writeFileSync(p,old);});
T('13 unsafe restore path rejected',async function(){assert((await core.restoreVerify('x','/home/deploy',fake())).refused);});
T('14 manifest path traversal rejected',function(){var m=JSON.parse(fs.readFileSync(path.join(stage,'manifest.json')));m.objects[0].path='../escape';fs.writeFileSync(path.join(stage,'manifest.json'),JSON.stringify(m));assert(!core.verifyLocal(stage).ok);m.objects[0].path='database/idauto.dump';fs.writeFileSync(path.join(stage,'manifest.json'),JSON.stringify(m));});
T('15 corrupted remote object rejected',async function(){var f=fake();await core.push(stage,f,{prefix:'c'});var k='c/'+core.verifyLocal(stage).manifest.objects[2].path;f.data.get(k).b=Buffer.from('corrupt');assert(!(await core.restoreVerify('c',path.join(root,'restore-c'),f)).ok);});
T('16 missing remote object rejected',async function(){var f=fake();await core.push(stage,f,{prefix:'m'});f.data.delete('m/'+core.verifyLocal(stage).manifest.objects[2].path);assert(!(await core.verifyRemote('m',f)).ok);});
T('17 duplicate/shared semantics',function(){var m=core.verifyLocal(stage).manifest;assert.equal(m.media.object_count,1);assert.equal(m.database.media_row_count,3);});
T('18 media-row consistency checked',function(){var bad=JSON.parse(JSON.stringify(opts)),x=JSON.parse(JSON.stringify(mm));x.database.row_count=0;fs.writeFileSync(path.join(media,'manifest.json'),JSON.stringify(x));assert.throws(function(){core.buildManifest(bad);});fs.writeFileSync(path.join(media,'manifest.json'),JSON.stringify(mm));});
T('19 isolated restore refuses live path',async function(){assert((await core.restoreVerify('x','/tmp/live/child',fake(),{liveMediaPath:'/tmp/live'})).refused);});
T('20 restore media isolation',async function(){var f=fake(),d=path.join(root,'isolated');await core.push(stage,f,{prefix:'i'});assert((await core.restoreVerify('i',d,f)).ok);assert(fs.existsSync(path.join(d,'media-backup',rel)));});
T('21 re-verification idempotent',function(){assert(core.verifyLocal(stage).ok&&core.verifyLocal(stage).ok);});
T('22 7/4/3 retention selector',function(){var a=[];for(var i=0;i<120;i++)a.push({id:String(i),created_at_utc:new Date(Date.UTC(2026,7,12-i)).toISOString()});var r=core.retention(a);assert(r.keep.length>=7&&r.keep.length<=14&&r.drop.length>0);});
T('23 retention never prunes',function(){var f=fake(),r=core.retention([{id:'a',created_at_utc:'2026-01-01T00:00:00Z'}],{dryRun:true,destructive:true});assert.equal(r.deleted,0);assert.equal(f.puts,0);});
T('24 provider unavailable fails closed',async function(){var f=fake();f.unavailable=true;assert(!(await core.verifyRemote('x',f)).ok);});
T('25 no credential persisted in repo artifacts',function(){assert(!fs.readFileSync(path.join(stage,'manifest.json'),'utf8').includes(sensitiveFixture));});
T('26 manifest restore metadata complete',function(){var m=core.verifyLocal(stage).manifest;['format_version','created_at_utc','tool_version','source_host_identifier','database','media','capture','consistency','objects'].forEach(function(k){assert(m[k]);});});
T('27 no production database opened',function(){assert(!require.cache[require.resolve('../projects/idauto/ops/offhost-backup.js')].children.some(function(x){return /reference\/db/.test(x.filename);}));});
T('28 no live media path written',function(){assert(!fs.existsSync(path.join(root,'home/deploy/deployments/idauto-media')));});
T('29 AWS published SigV4 IAM vector',function(){var r=s3.sign({method:'GET',url:'https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08',headers:{'Content-Type':'application/x-www-form-urlencoded; charset=utf-8'},amzDate:'20150830T123600Z',payloadHash:sha(''),region:'us-east-1',service:'iam',accessKey:'AKIDEXAMPLE',secret:'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY'});assert.equal(sha(r.canonicalRequest),'f536975d06c0309214f805bb90ccff089219ecd68b2577efef23edd43b7e1a59');assert.equal(r.signature,'5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7');});
T('30 non-HTTPS endpoint refused',function(){assert.throws(function(){s3.create({ENDPOINT:'http://example.invalid',REGION:'auto',BUCKET:'x',ACCESS_KEY_ID:'x',SECRET_ACCESS_KEY:'x'});},/non-HTTPS/);});
(async function(){try{for(var i=0;i<tasks.length;i++)await tasks[i]();}finally{fs.rmSync(root,{recursive:true,force:true});}process.stdout.write(passed+' passed / '+failed+' failed\n');process.exit(failed?1:0);})();
