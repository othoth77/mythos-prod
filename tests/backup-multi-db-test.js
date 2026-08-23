'use strict';

// tests/backup-multi-db-test.js — regression suite for explicit multi-database
// backup coverage (docs/BACKUP_MULTI_DATABASE_DESIGN.md).
//
// The gate this suite exists to hold: ERP Stage 5 must not begin until
// mythos_erp is provably in the backup set and provably checked on verify.
// "Provably" means asserted here, not asserted in a document.
//
// Two layers are covered. The capture script (bash, root, docker) is checked
// statically for the properties that cannot be exercised without root and a
// live container — the same approach and the same limitation as
// backup-hardening-test.js. Everything downstream of the hand-off directory is
// exercised for real: real files, real hashes, real manifests, a fake adapter.

var fs = require('fs');
var os = require('os');
var path = require('path');
var crypto = require('crypto');

var OPS = path.join(__dirname, '..', 'projects', 'infrastructure', 'ops');
var tool = require(path.join(OPS, 'offhost-backup.js'));
var CAPTURE = fs.readFileSync(
  path.join(__dirname, '..', 'ops', 'backup', 'mythos-backup-capture.sh'), 'utf8');

var passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  PASS ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
}
function sha(b) { return crypto.createHash('sha256').update(b).digest('hex'); }

var TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-multidb-'));
process.on('exit', function () { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {} });

// ── Fixture: a hand-off directory exactly as the capture script leaves it ────
var SEQ = 0;
function makeHandoff(opts) {
  var o = opts || {};
  var dbs = o.databases || ['idauto', 'mythos_command_center', 'mythos_erp'];
  var ts = '20260823T120000Z';
  var root = path.join(TMP, 'set-' + (++SEQ));
  var dbDir = path.join(root, 'db');
  var mediaDir = path.join(root, 'media');
  fs.mkdirSync(dbDir, { recursive: true });
  fs.mkdirSync(path.join(mediaDir, 'media', 'aa', 'bb'), { recursive: true });

  // One media object, content-addressed by its own sha256.
  var body = Buffer.from('media-object-' + SEQ);
  var key = sha(body);
  var od = path.join(mediaDir, 'media', key.slice(0, 2), key.slice(2, 4));
  fs.mkdirSync(od, { recursive: true });
  fs.writeFileSync(path.join(od, key), body);
  fs.writeFileSync(path.join(mediaDir, 'checksums.sha256'),
    key + '  media/' + key.slice(0, 2) + '/' + key.slice(2, 4) + '/' + key + '\n');

  var entries = dbs.map(function (name) {
    var file = name + '-' + ts + '.dump';
    var buf = Buffer.from('PGDMP-fake-dump-for-' + name);
    fs.writeFileSync(path.join(dbDir, file), buf);
    return { name: name, dump_filename: file, dump_sha256: sha(buf), bytes: buf.length };
  });

  var globals = null;
  if (o.globals !== false) {
    var gfile = 'globals-' + ts + '.sql';
    var gbuf = Buffer.from('CREATE ROLE erp_app;\nGRANT INSERT, SELECT ON audit_log TO erp_app;\n');
    fs.writeFileSync(path.join(dbDir, gfile), gbuf);
    globals = { filename: gfile, sha256: sha(gbuf), includes_role_passwords: false };
  }

  var mm = {
    format_version: '1.0.0',
    created_at_utc: '2026-08-23T12:00:05.000Z',
    consistency: { state: 'CONSISTENT' },
    media: { file_count: 1 },
    database: {
      row_count: 1,
      distinct_object_keys: 1,
      dump_filename: entries[0].dump_filename,
      dump_sha256: entries[0].dump_sha256,
      dump_captured_at_utc: '2026-08-23T12:00:00.000Z'
    }
  };
  if (o.legacy !== true) {
    mm.databases = entries;
    mm.globals = globals;
  }
  if (o.mutateCaptureManifest) o.mutateCaptureManifest(mm, entries);
  fs.writeFileSync(path.join(mediaDir, 'manifest.json'), JSON.stringify(mm, null, 2));

  return { root: root, dbDir: dbDir, mediaDir: mediaDir, entries: entries, globals: globals };
}

function stageSet(h, name) {
  var dest = path.join(h.root, name || 'stage');
  return { dest: dest, result: tool.stage({ dbDir: h.dbDir, mediaDir: h.mediaDir, dest: dest, host: 'test-host' }) };
}

function fakeAdapter() {
  var data = new Map();
  return {
    data: data,
    put: async function (k, b, m) { data.set(k, { b: Buffer.from(b), sha: m.sha256 }); },
    get: async function (k) { if (!data.has(k)) throw new Error('missing object'); return data.get(k).b; },
    head: async function (k) {
      var x = data.get(k);
      if (!x) throw new Error('missing object');
      return { size: x.b.length, sha256: x.sha };
    },
    list: async function (p) { return Array.from(data.keys()).filter(function (k) { return k.indexOf(p) === 0; }); }
  };
}

(async function () {

// ── §1 capture script: the allowlist is explicit and validated ──────────────
console.log('§1 capture script — database selection');
check('an allowlist config key exists', /MYTHOS_BACKUP_DB_LIST/.test(CAPTURE));
check('the allowlist key is registered as a recognised config key',
  /CONFIG_KEYS="[^"]*MYTHOS_BACKUP_DB_LIST/.test(CAPTURE.replace(/\\\n/g, '')));
check('database names are charset-validated before use',
  /unacceptable database name in the allowlist/.test(CAPTURE));
check('a name starting with a digit is refused',
  /database name must not start with a digit/.test(CAPTURE));
check('duplicates are refused', /database listed twice in the allowlist/.test(CAPTURE));
check('a listed-but-absent database FAILS the run',
  /allowlisted database does not exist in/.test(CAPTURE));
check('the database name is passed as an argument, never interpolated into the container shell',
  /pg_dump -U "\$POSTGRES_USER" -d "\$1" -Fc' _ "\$db"/.test(CAPTURE));
check('table data is dumped per allowlisted database, never cluster-wide',
  /for db in "\$\{DB_LIST\[@\]\}"; do/.test(CAPTURE));
check('unset allowlist still falls back to the container POSTGRES_DB (compatibility)',
  /POSTGRES_DB:-/.test(CAPTURE) && /no MYTHOS_BACKUP_DB_LIST and the container exposes no POSTGRES_DB/.test(CAPTURE));
check('every dump is still validated with pg_restore --list',
  /pg_restore --list > \/dev\/null/.test(CAPTURE));
check('an empty dump is still refused', /pg_dump produced an empty dump for/.test(CAPTURE));

console.log('\n§2 capture script — globals and credential safety');
// Assertions here inspect the INVOCATION lines. Matching the bare flag name
// anywhere in the file would also match the error message that mentions it —
// a test asserting its own vocabulary rather than the code's behaviour.
var dumpallCalls = CAPTURE.split('\n').filter(function (l) { return /'pg_dumpall\b/.test(l); });
check('pg_dumpall is invoked exactly once', dumpallCalls.length === 1, String(dumpallCalls.length));
check('no blind "dump every database": the only pg_dumpall is --globals-only',
  dumpallCalls.every(function (l) { return /--globals-only/.test(l); }));
check('cluster globals are captured', /pg_dumpall -U "\$POSTGRES_USER" --globals-only/.test(CAPTURE));
check('role passwords are excluded on the invocation itself, not merely mentioned',
  dumpallCalls.every(function (l) { return /--no-role-passwords/.test(l); }));
check('the redaction is verified, not assumed',
  /globals dump contains password material despite --no-role-passwords/.test(CAPTURE));
check('empty globals are refused', /pg_dumpall produced empty globals/.test(CAPTURE));
check('globals without role definitions are refused',
  /globals dump contains no role definitions/.test(CAPTURE));
check('the capture still never reads a remote credential',
  !/AWS_|R2_|SECRET|ACCESS_KEY/.test(CAPTURE.replace(/credential/g, '')));
check('hand-off count is computed from the allowlist size',
  /EXPECTED_IN_DB_DIR=\$\(\( \$\{#DB_FILES\[@\]\} \+ 1 \)\)/.test(CAPTURE));
check('a wrong hand-off count actually fails the run',
  /\|\|\s*fail "dump hand-off directory must hold exactly \$EXPECTED_IN_DB_DIR files/.test(CAPTURE));
check('capture order is asserted against the newest database artefact',
  /NEWEST_DB_AT/.test(CAPTURE));

// ── §3 requirement 1 + 2: existing databases AND mythos_erp are included ────
console.log('\n§3 set contents');
var h = makeHandoff();
var st = stageSet(h);
check('staging succeeds with several databases', st.result.ok === true, JSON.stringify(st.result.problems));
var m = st.result.manifest;
check('idauto is in the set', tool.hasDatabase(m, 'idauto'));
check('mythos_command_center is in the set', tool.hasDatabase(m, 'mythos_command_center'));
check('mythos_erp is in the set', tool.hasDatabase(m, 'mythos_erp'));
check('every declared database has a real object on disk',
  m.databases.every(function (d) { return fs.existsSync(path.join(st.dest, 'database', d.dump_filename)); }));
check('the globals are in the set', !!m.globals && fs.existsSync(path.join(st.dest, 'database', m.globals.filename)));
check('the set records that globals carry no role passwords', m.globals.includes_role_passwords === false);

// ── §4 requirement 3: nothing rides along uninvited ─────────────────────────
console.log('\n§4 no accidental inclusion');
check('only the declared databases appear', m.databases.length === 3);
var dbObjects = m.objects.filter(function (o) { return o.path.indexOf('database/') === 0; });
check('database objects == declared dumps + globals', dbObjects.length === 4, String(dbObjects.length));
check('no unrelated database is present',
  !tool.hasDatabase(m, 'ssangyong_autos') && !tool.hasDatabase(m, 'postgres') &&
  !tool.hasDatabase(m, 'mythos_command_center_test'));

var stray = makeHandoff();
fs.writeFileSync(path.join(stray.dbDir, 'leftover-20260101T000000Z.dump'), Buffer.from('stale'));
var strayErr = null;
try { stageSet(stray, 'stage-stray'); } catch (e) { strayErr = e.message; }
check('an undeclared file in the hand-off directory is refused, not swept in',
  /undeclared file in database hand-off/.test(strayErr || ''), strayErr || 'no error raised');

var missing = makeHandoff();
fs.unlinkSync(path.join(missing.dbDir, missing.entries[2].dump_filename));
var missErr = null;
try { stageSet(missing, 'stage-missing'); } catch (e) { missErr = e.message; }
check('a declared database with no file is refused at staging',
  /declared database dump missing from hand-off/.test(missErr || ''), missErr || 'no error raised');

var noGlobals = makeHandoff();
fs.unlinkSync(path.join(noGlobals.dbDir, noGlobals.globals.filename));
var ngErr = null;
try { stageSet(noGlobals, 'stage-noglobals'); } catch (e) { ngErr = e.message; }
check('declared globals with no file are refused at staging',
  /declared globals dump missing from hand-off/.test(ngErr || ''), ngErr || 'no error raised');

// ── §5 requirement 4: archive integrity ────────────────────────────────────
console.log('\n§5 archive integrity');
check('the primary dump is still objects[0]',
  m.objects[0].path === 'database/' + m.database.dump_filename);
check('the media manifest is still objects[1]', m.objects[1].path === 'media-backup/manifest.json');
check('format_version is unchanged, so sets already in R2 stay readable',
  m.format_version === tool.FORMAT_VERSION && m.format_version === '1.0.0');
check('verify-local passes on the staged set', tool.verifyLocal(st.dest).ok === true);

var tampered = stageSet(makeHandoff(), 'stage-tamper');
var victim = path.join(tampered.dest, 'database', tampered.result.manifest.databases[2].dump_filename);
fs.writeFileSync(victim, Buffer.from('CORRUPTED'));
var tv = tool.verifyLocal(tampered.dest);
check('corrupting the mythos_erp dump fails verification', tv.ok === false);
check('the failure names a checksum mismatch',
  tv.problems.some(function (x) { return /checksum mismatch/.test(x); }), JSON.stringify(tv.problems));

var lied = stageSet(makeHandoff(), 'stage-lie');
var lm = JSON.parse(fs.readFileSync(path.join(lied.dest, 'manifest.json'), 'utf8'));
lm.databases.push({ name: 'mythos_erp_phantom', dump_filename: 'phantom.dump', dump_sha256: sha(Buffer.from('x')), size: 1 });
fs.writeFileSync(path.join(lied.dest, 'manifest.json'), JSON.stringify(lm, null, 2));
var lv = tool.verifyLocal(lied.dest);
check('a manifest claiming a database it does not carry fails verification', lv.ok === false);
check('the failure names the phantom database',
  lv.problems.some(function (x) { return /declared database not in set: mythos_erp_phantom/.test(x); }),
  JSON.stringify(lv.problems));

var gl = stageSet(makeHandoff(), 'stage-globals');
fs.writeFileSync(path.join(gl.dest, 'database', gl.result.manifest.globals.filename), Buffer.from('TAMPERED'));
check('corrupting the globals fails verification', tool.verifyLocal(gl.dest).ok === false);

// The checks above are all caught by the generic object loop. These three
// falsify the databases[]/globals blocks ALONE, leaving objects[] internally
// consistent — the only thing that can catch them is the cross-check between
// the two, which is the point of having databases[] at all.
function relabel(dest, mutate) {
  var f = path.join(dest, 'manifest.json');
  var j = JSON.parse(fs.readFileSync(f, 'utf8'));
  mutate(j);
  fs.writeFileSync(f, JSON.stringify(j, null, 2));
  return tool.verifyLocal(dest);
}
var xs = stageSet(makeHandoff(), 'stage-xcheck');
var xr = relabel(xs.dest, function (j) { j.databases[2].dump_sha256 = sha(Buffer.from('lie')); });
check('databases[] claiming a checksum objects[] disagrees with fails', xr.ok === false);
check('the failure names a declared-database checksum mismatch',
  xr.problems.some(function (x) { return /declared database checksum mismatch/.test(x); }),
  JSON.stringify(xr.problems));

var gs = stageSet(makeHandoff(), 'stage-gcheck');
var gr = relabel(gs.dest, function (j) { j.globals.sha256 = sha(Buffer.from('lie')); });
check('globals claiming a checksum objects[] disagrees with fails', gr.ok === false);
check('the failure names a globals checksum mismatch',
  gr.problems.some(function (x) { return /globals checksum mismatch/.test(x); }), JSON.stringify(gr.problems));

var ps = stageSet(makeHandoff(), 'stage-primary');
var pr2 = relabel(ps.dest, function (j) { j.database.dump_filename = j.databases[1].dump_filename; });
check('a set whose declared primary is not objects[0] fails verification', pr2.ok === false);
check('the failure names the primary position',
  pr2.problems.some(function (x) { return /primary database dump is not objects\[0\]/.test(x); }),
  JSON.stringify(pr2.problems));

// ── §6 requirement 5: verification detects a missing ERP database ──────────
console.log('\n§6 required-database enforcement');
check('requiring a database that is present passes',
  tool.verifyLocal(st.dest, { requireDatabase: ['mythos_erp'] }).ok === true);
var noErp = stageSet(makeHandoff({ databases: ['idauto', 'mythos_command_center'] }), 'stage-noerp');
check('the ERP-less set is internally valid', tool.verifyLocal(noErp.dest).ok === true);
var demand = tool.verifyLocal(noErp.dest, { requireDatabase: ['mythos_erp'] });
check('requiring mythos_erp on a set without it FAILS', demand.ok === false);
check('the failure names the absent database',
  demand.problems.some(function (x) { return /required database absent from set: mythos_erp/.test(x); }),
  JSON.stringify(demand.problems));
check('several databases can be required at once',
  tool.verifyLocal(st.dest, { requireDatabase: ['idauto', 'mythos_erp'] }).ok === true);
check('requiring one present and one absent still fails',
  tool.verifyLocal(st.dest, { requireDatabase: ['idauto', 'nonexistent_db'] }).ok === false);
check('the CLI exposes a repeatable --require-database flag',
  /--require-database/.test(fs.readFileSync(path.join(OPS, 'offhost-backup.js'), 'utf8')));

// ── §7 requirement 6: R2 verification still works ──────────────────────────
console.log('\n§7 R2 push and remote verification');
var ad = fakeAdapter();
var pr = await tool.push(st.dest, ad, { prefix: 'mythos-test' });
check('push succeeds with a multi-database set', pr.ok === true, JSON.stringify(pr.problems));
check('every object was uploaded', pr.uploaded === m.objects.length, pr.uploaded + ' of ' + m.objects.length);
check('the mythos_erp dump reached the remote',
  ad.data.has('mythos-test/database/' + m.databases[2].dump_filename));
check('the globals reached the remote', ad.data.has('mythos-test/database/' + m.globals.filename));
check('COMPLETE is written last', Array.from(ad.data.keys()).pop() === 'mythos-test/COMPLETE');

var vr = await tool.verifyRemote('mythos-test', ad);
check('verify-remote passes', vr.ok === true, JSON.stringify(vr.problems));
check('verify-remote reports the databases it saw',
  vr.databases.join(',') === 'idauto,mythos_command_center,mythos_erp', String(vr.databases));
check('verify-remote with --require-database mythos_erp passes',
  (await tool.verifyRemote('mythos-test', ad, { requireDatabase: ['mythos_erp'] })).ok === true);

var ad2 = fakeAdapter();
var noErpStage = noErp.dest;
await tool.push(noErpStage, ad2, { prefix: 'mythos-noerp' });
var vr2 = await tool.verifyRemote('mythos-noerp', ad2, { requireDatabase: ['mythos_erp'] });
check('verify-remote FAILS when the remote set has no mythos_erp', vr2.ok === false);
check('the remote failure names the absent database',
  vr2.problems.some(function (x) { return /required database absent from remote set: mythos_erp/.test(x); }),
  JSON.stringify(vr2.problems));

var ad3 = fakeAdapter();
await tool.push(st.dest, ad3, { prefix: 'mythos-corrupt' });
var kErp = 'mythos-corrupt/database/' + m.databases[2].dump_filename;
ad3.data.set(kErp, { b: Buffer.from('CORRUPT'), sha: ad3.data.get(kErp).sha });
var vr3 = await tool.verifyRemote('mythos-corrupt', ad3);
check('a corrupted remote ERP dump fails remote verification', vr3.ok === false);

// ── §8 restore-verify end to end ───────────────────────────────────────────
console.log('\n§8 restore-verify');
var rdest = path.join(TMP, 'restore-dest');
var rr = await tool.restoreVerify('mythos-test', rdest, ad, {});
check('restore-verify succeeds', rr.ok === true, JSON.stringify(rr.problems));
check('the mythos_erp dump was restored to disk',
  fs.existsSync(path.join(rdest, 'database', m.databases[2].dump_filename)));
check('the globals were restored to disk',
  fs.existsSync(path.join(rdest, 'database', m.globals.filename)));
check('restored bytes match the source dump',
  fs.readFileSync(path.join(rdest, 'database', m.databases[2].dump_filename)).equals(
    fs.readFileSync(path.join(h.dbDir, h.entries[2].dump_filename))));
var rr2 = await tool.restoreVerify('mythos-noerp', path.join(TMP, 'restore-noerp'), ad2,
  { requireDatabase: ['mythos_erp'] });
check('restore-verify refuses a set missing a required database', rr2.ok === false);
check('restore-verify still refuses an unsafe destination',
  (await tool.restoreVerify('mythos-test', '/home/deploy', ad, {})).refused === true);

// ── §9 backward compatibility with single-database sets ────────────────────
console.log('\n§9 backward compatibility');
var legacy = makeHandoff({ databases: ['idauto'], globals: false, legacy: true });
var ls = stageSet(legacy, 'stage-legacy');
check('a legacy single-dump hand-off still stages', ls.result.ok === true, JSON.stringify(ls.result.problems));
check('a legacy set still verifies', tool.verifyLocal(ls.dest).ok === true);
check('a legacy set carries no databases[] claim',
  !ls.result.manifest.databases || ls.result.manifest.databases.length === 1);
check('a legacy set still has format_version 1.0.0', ls.result.manifest.format_version === '1.0.0');
var legacyTwo = makeHandoff({ databases: ['idauto', 'other'], legacy: true });
var ltErr = null;
try { stageSet(legacyTwo, 'stage-legacy2'); } catch (e) { ltErr = e.message; }
check('a legacy hand-off with two files is still refused (original contract held)',
  /database dump discovery failed/.test(ltErr || ''), ltErr || 'no error raised');
var adL = fakeAdapter();
check('a legacy set still pushes to R2', (await tool.push(ls.dest, adL, { prefix: 'legacy' })).ok === true);
check('a legacy set still verifies remotely', (await tool.verifyRemote('legacy', adL)).ok === true);
check('requiring a database of a legacy set fails cleanly rather than crashing',
  (await tool.verifyRemote('legacy', adL, { requireDatabase: ['mythos_erp'] })).ok === false);

// ── §10 manifest regeneration keeps databases[] honest ─────────────────────
console.log('\n§10 manifest regeneration');
var rg = stageSet(makeHandoff(), 'stage-regen');
var target = path.join(rg.dest, 'database', rg.result.manifest.databases[2].dump_filename);
fs.writeFileSync(target, Buffer.from('LEGITIMATELY-DIFFERENT'));
var regen = tool.regenerate(rg.dest, false);
check('regenerate refreshes the databases[] checksum', regen.databases[2].dump_sha256 === sha(fs.readFileSync(target)));
check('the regenerated set verifies', tool.verifyLocal(rg.dest).ok === true);
check('regenerate keeps the globals checksum in step',
  regen.globals.sha256 === sha(fs.readFileSync(path.join(rg.dest, 'database', regen.globals.filename))));

console.log('\nbackup-multi-db: ' + passed + ' passed, ' + failed + ' failed');
process.exitCode = failed ? 1 : 0;

})().catch(function (e) { console.error('SUITE CRASHED: ' + e.stack); process.exitCode = 1; });
