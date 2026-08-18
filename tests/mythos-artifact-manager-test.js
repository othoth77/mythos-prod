'use strict';
// =====================================================
// MYTHOS — artifact manager tests (capability AA)
// tests/mythos-artifact-manager-test.js
//
// Covers: content-addressed storage + dedup, provenance record fields,
// digest verification on retrieve, tamper detection, missing-blob
// handling, listing by task/kind, and the ARTIFACT_STORED/RETRIEVED
// event stream. Fixtures live under the home directory (never /tmp) and
// are removed at the end.
//
// Run with: node tests/mythos-artifact-manager-test.js
// =====================================================

var fs = require('fs');
var os = require('os');
var path = require('path');

var BASE = path.join(__dirname, '..');
var EXEC = path.join(BASE, 'projects', 'mythos-ai-executor');

var FIXTURES = path.join(os.homedir(), 'mythos-artifact-manager-test-' + process.pid);
fs.mkdirSync(FIXTURES, { recursive: true });
process.env.MYTHOS_EXECUTOR_HOME = path.join(FIXTURES, 'home');

var artifacts = require(path.join(EXEC, 'core', 'artifact-manager'));
var store = require(path.join(EXEC, 'core', 'store'));

var passed = 0, failed = 0, failures = [];
function ok(cond, name) {
  if (cond) passed++;
  else { failed++; failures.push(name); console.error('FAIL: ' + name); }
}

// --------------------------------------------------------------- 1-4. store
(function () {
  var e = artifacts.store(Buffer.from('hello mythos'), {
    task_id: 't-abc123-de45', kind: 'report', filename: 'r.txt',
    project: 'sandbox', produced_by: 'agent-x'
  });
  ok(e.entity_type === 'artifact' && e.status === 'STORED', 'store: creates a STORED artifact entity');
  ok(e.digest === artifacts.digestOf(Buffer.from('hello mythos')), 'store: digest is sha256 of the content');
  ok(fs.existsSync(e.path), 'store: the blob file exists on disk');
  ok(e.metadata.filename === 'r.txt' && e.metadata.produced_by === 'agent-x' && e.metadata.size_bytes === 12,
    'store: provenance metadata (filename, producer, size) is recorded');
})();

// -------------------------------------------------------------- 5-6. dedup
(function () {
  var a = artifacts.store('same content', { kind: 'dataset', task_id: 't-abc123-de45' });
  var b = artifacts.store('same content', { kind: 'dataset', task_id: 't-other0-9999' });
  ok(a.digest === b.digest && a.path === b.path, 'dedup: identical bytes share one blob path');
  ok(a.id !== b.id, 'dedup: each store() call still creates its own provenance record');
})();

// ---------------------------------------------------------- 7-9. retrieve
(function () {
  var stored = artifacts.store('round trip me', { kind: 'build' });
  var got = artifacts.retrieve(stored.id);
  ok(got.content.toString('utf8') === 'round trip me', 'retrieve: returns the original bytes');
  ok(got.entity.id === stored.id, 'retrieve: returns the matching provenance record');
  ok(artifacts.retrieve('a-nonexistent-0000') === null, 'retrieve: unknown id returns null, not a throw');
})();

// ------------------------------------------------------- 10-11. get (meta only)
(function () {
  var stored = artifacts.store('meta only', { kind: 'image' });
  var meta = artifacts.get(stored.id);
  ok(meta.id === stored.id && meta.kind === 'image', 'get: returns the provenance record without reading the blob');
  ok(artifacts.get('a-nonexistent-0000') === null, 'get: unknown id returns null');
})();

// --------------------------------------------------- 12-13. tamper detection
(function () {
  var stored = artifacts.store('trust me', { kind: 'report' });
  fs.writeFileSync(stored.path, 'tampered bytes');
  var threw = false;
  try { artifacts.retrieve(stored.id); } catch (e) {
    threw = /ARTIFACT_DIGEST_MISMATCH/.test(e.message);
  }
  ok(threw, 'retrieve: refuses content whose digest no longer matches the record');

  var stored2 = artifacts.store('will vanish', { kind: 'report' });
  fs.unlinkSync(stored2.path);
  var missingThrew = false;
  try { artifacts.retrieve(stored2.id); } catch (e) {
    missingThrew = /ARTIFACT_BLOB_MISSING/.test(e.message);
  }
  ok(missingThrew, 'retrieve: refuses when the recorded blob is gone from disk');
})();

// -------------------------------------------------------------- 14-16. listing
(function () {
  var taskId = 't-listing0-aaaa';
  artifacts.store('one', { kind: 'dataset', task_id: taskId });
  artifacts.store('two', { kind: 'image', task_id: taskId });
  artifacts.store('three', { kind: 'dataset', task_id: 't-other000-bbbb' });
  var byTask = artifacts.listByTask(taskId);
  ok(byTask.length === 2, 'listByTask: returns only artifacts for that task');
  var byKind = artifacts.listByKind('dataset').filter(function (a) { return a.task_id === taskId; });
  ok(byKind.length === 1 && byKind[0].kind === 'dataset', 'listByKind: filters by kind');
  ok(artifacts.list().length >= 3, 'list: returns all artifacts when unfiltered');
})();

// ------------------------------------------------------------ 17-18. events
(function () {
  var before = store.readEvents(null, 1000).length;
  var stored = artifacts.store('event check', { kind: 'report' });
  artifacts.retrieve(stored.id);
  var events = store.readEvents(null, 1000);
  ok(events.length === before + 2, 'events: store + retrieve each append exactly one event');
  var kinds = events.slice(-2).map(function (e) { return e.event_type; });
  ok(kinds[0] === 'ARTIFACT_STORED' && kinds[1] === 'ARTIFACT_RETRIEVED',
    'events: ARTIFACT_STORED then ARTIFACT_RETRIEVED are recorded in order');
})();

// --------------------------------------------------------- 19. bad digest
(function () {
  var threw = false;
  try { artifacts.blobPath('not-a-real-digest'); } catch (e) {
    threw = /INVALID_DIGEST/.test(e.message);
  }
  ok(threw, 'blobPath: rejects a non-sha256-shaped digest');
})();

// ============================================================================
fs.rmSync(FIXTURES, { recursive: true, force: true });
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failures.length) {
  console.log('Failures:\n  ' + failures.join('\n  '));
  process.exit(1);
}
process.exit(0);
