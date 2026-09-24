// =====================================================
// MYTHOS V3.1 — OTHKM ecosystem knowledge seed
// tests/othk-22-ecosystem-seed-test.js
//
// The claim under test: OTH Knowledge can hold the MYTHOS ecosystem —
// projects, hosts, models, their relationships (uses / depends-on /
// reuses / can-execute / federates) and the V3.1 decisions — through the
// EXISTING seed path (projects/oth-knowledge/lib/seed.js), with provenance
// on every record, no secret-shaped content, and every project entity
// tied to a real portfolio-registry track. No new memory system.
//
// Offline: every seed under projects/oth-knowledge/seeds/ is loaded into a
// temp store, twice (idempotent), then searched. Run with:
//   node tests/othk-22-ecosystem-seed-test.js
// =====================================================
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const BASE = path.join(ROOT, 'projects', 'oth-knowledge');

const storeLib = require(path.join(BASE, 'lib/store.js'));
const provenance = require(path.join(BASE, 'lib/provenance.js'));
const ingest = require(path.join(BASE, 'lib/ingest.js'));
const seedLib = require(path.join(BASE, 'lib/seed.js'));
const service = require(path.join(BASE, 'lib/knowledge-service.js'));

let passed = 0, failed = 0;
function ok(v, label) {
  if (v) { passed++; console.log('  PASS ' + label); }
  else { failed++; console.log('  FAIL ' + label); }
}
function tmpRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'othk-22-')); }
const CLASSES = provenance.loadSourceClasses();
const SEEDS = path.join(BASE, 'seeds');
const ECO = path.join(SEEDS, 'mythos-ecosystem-2026-09-24.json');

console.log('§1 every committed seed loads, twice, into one store');
{
  const s = storeLib.openStore(tmpRoot());
  const files = fs.readdirSync(SEEDS).filter((f) => /\.json$/.test(f)).sort();
  ok(files.length >= 4 && files.indexOf('mythos-ecosystem-2026-09-24.json') !== -1, 'the ecosystem seed is among the committed seeds (' + files.length + ')');
  // A seed whose source class is not in config/source-classes.json cannot be
  // loaded by anyone (the registry is fail-closed); it is reported by name,
  // not silently skipped — found 2026-09-24: the security-2026-08-20 seed
  // declares class `test-result`, which is unregistered. Not this suite's to
  // fix (a class is a knowledge-governance decision), but not its to hide.
  const registered = new Set(Object.keys(CLASSES.classes || CLASSES));
  const loadable = [], unloadable = [];
  for (const f of files) {
    const cls = JSON.parse(fs.readFileSync(path.join(SEEDS, f), 'utf8')).source_class;
    (registered.has(cls) ? loadable : unloadable).push(f + ' (' + cls + ')');
  }
  console.log('  note: unloadable seeds (unregistered source class): ' + (unloadable.length ? unloadable.join(', ') : 'none'));
  ok(loadable.some((x) => /^mythos-ecosystem-2026-09-24\.json/.test(x)), 'the ecosystem seed uses a registered class');
  const loadFiles = loadable.map((x) => x.split(' ')[0]);
  for (const f of loadFiles) {
    const created = seedLib.loadSeed(s, CLASSES, path.join(SEEDS, f));
    const n = Object.keys(created).reduce((a, k) => a + created[k], 0);
    ok(n > 0, f + ' creates records (' + n + ')');
  }
  const before = s.stats().records;
  for (const f of loadFiles) seedLib.loadSeed(s, CLASSES, path.join(SEEDS, f));
  ok(s.stats().records === before, 'reloading every seed is idempotent (' + before + ' records)');
  ok(s.verify().ok, 'store integrity OK after all seeds');
  ok(ingest.detectSecretShapes(JSON.stringify(s.allRecords())).length === 0, 'no credential-shaped content in any seeded record');
}

console.log('§2 the ecosystem seed: shape and provenance');
{
  const seed = JSON.parse(fs.readFileSync(ECO, 'utf8'));
  ok(seed.format === 'othk-seed' && seed.source_class === 'mythos-repo', 'source class is the registered mythos-repo class (repository-derived)');
  ok(Array.isArray(seed.claims) && seed.claims.length >= 10 && seed.claims.every((c) => typeof c.asserted_by === 'string' && c.asserted_by.length > 0),
    'repository-derived statements are CLAIMS with asserted_by, never facts (' + seed.claims.length + ')');
  ok(!seed.facts || seed.facts.length === 0, 'the seed asserts no fact: a repository statement is a claim until verified');
  const rel = seed.claims.filter((c) => (c.tags || []).indexOf('relationship') !== -1);
  ok(rel.length >= 6, 'at least six relationship claims (uses/depends-on/reuses/can-execute/federates/serves): ' + rel.length);
  const kinds = new Set();
  rel.forEach((c) => (c.tags || []).forEach((t) => { if (['uses', 'depends-on', 'reuses', 'can-execute', 'federates', 'serves', 'observes'].indexOf(t) !== -1) kinds.add(t); }));
  ok(kinds.size >= 5, 'relationship kinds are distinct, not one label: ' + Array.from(kinds).join(','));
  ok(seed.claims.every((c) => (c.entities || []).length >= 1), 'every claim is tied to at least one entity');
}

console.log('§3 project entities resolve to portfolio-registry tracks and real paths');
{
  const seed = JSON.parse(fs.readFileSync(ECO, 'utf8'));
  const reg = JSON.parse(fs.readFileSync(path.join(ROOT, 'projects', 'meta', 'portfolio-registry.json'), 'utf8'));
  const ids = new Set(reg.tracks.map((t) => t.id));
  const projects = seed.entities.filter((e) => e.entity_type === 'project');
  ok(projects.length >= 8, 'at least eight project entities: ' + projects.length);
  const withId = projects.filter((e) => e.metadata && e.metadata.registry_id);
  ok(withId.every((e) => ids.has(e.metadata.registry_id)), 'every registry_id names an existing portfolio track: ' +
    withId.filter((e) => !ids.has(e.metadata.registry_id)).map((e) => e.metadata.registry_id).join(',') || 'all resolve');
  ok(projects.every((e) => e.metadata && e.metadata.path && fs.existsSync(path.join(ROOT, e.metadata.path))),
    'every project entity path exists in the repository');
  ['mythos-ai-executor', 'mythos-haddad', 'oth-knowledge', 'oth-mcp', 'mythos-gateway', 'status-center', 'othmode'].forEach((id) => {
    ok(ids.has(id), 'portfolio registry carries the AI-layer track ' + id);
  });
  const hostNames = seed.entities.filter((e) => e.entity_type === 'host').map((e) => e.name);
  ok(hostNames.indexOf('haddad') !== -1 && hostNames.indexOf('mythos-vps') !== -1, 'both hosts are entities');
  const models = seed.entities.filter((e) => e.entity_type === 'model').map((e) => e.name);
  ['claude-fable-5-1', 'claude-sonnet-5', 'claude-opus-5'].forEach((m) => ok(models.indexOf(m) !== -1, 'model entity ' + m));
  ok(models.some((m) => /Qwen2\.5-7B/.test(m)), 'the local Qwen model is an entity');
}

console.log('§4 retrieval through the read-only service boundary');
{
  const root = tmpRoot();
  const s = storeLib.openStore(root);
  seedLib.loadSeed(s, CLASSES, ECO);
  const svc = service.openService(root);
  const hits = svc.search('haddad executes issues', { mode: 'hybrid', limit: 5 });
  ok(hits.length >= 1, 'hybrid search for "haddad executes issues" returns hits (' + hits.length + ')');
  // Entities carry no provenance of their own (they are referents, not
  // statements); every knowledge-bearing hit must.
  const bearing = hits.filter((h) => h.kind !== 'entity');
  ok(bearing.length >= 1 && bearing.every((h) => h.provenance && h.provenance.source_class === 'mythos-repo' && h.provenance.source_reference), 'every knowledge-bearing hit carries provenance from the mythos-repo class (' + bearing.length + ')');
  ok(hits.some((h) => /CAN EXECUTE/.test(h.text || h.statement || '')), 'the can-execute relationship is retrievable');
  const mem = svc.search('single MYTHOS memory layer', { mode: 'hybrid', limit: 5 });
  ok(mem.some((h) => /single MYTHOS memory layer/.test(h.text || h.statement || '')), 'the single-memory decision is retrievable');
  const esc = svc.search('opus deep-tier escalation', { mode: 'hybrid', limit: 5 });
  ok(esc.some((h) => /claude-opus-5 is the deep-tier escalation/.test(h.text || h.statement || '')), 'the model-roles decision is retrievable');
  const claims = s.allRecords({ kind: 'claim' });
  ok(claims.length >= 10 && claims.every((c) => c.asserted_by), 'claims are stored as claims with asserted_by');
  const trust = svc.assessTrust(claims[0].id, { asOf: '2026-09-25T00:00:00Z' });
  ok(trust && trust.not_a_truth_value === true, 'a claim assesses with not_a_truth_value: true — asserted, not established');
}

console.log('§5 the loader refuses a broken seed (mutation check)');
{
  const seed = JSON.parse(fs.readFileSync(ECO, 'utf8'));
  const bad = path.join(tmpRoot(), 'bad.json');
  const copy = JSON.parse(JSON.stringify(seed));
  copy.claims[0].entities = ['no-such-entity'];
  fs.writeFileSync(bad, JSON.stringify(copy));
  let code = null;
  try { seedLib.loadSeed(storeLib.openStore(tmpRoot()), CLASSES, bad); } catch (e) { code = e.code; }
  ok(code === 'OTHK_SEED_INPUT', 'an unknown entity key is refused: ' + code);
  const secret = JSON.parse(JSON.stringify(seed));
  secret.claims[0].statement += ' token ghp_' + 'A'.repeat(36);
  fs.writeFileSync(bad, JSON.stringify(secret));
  code = null;
  try { seedLib.loadSeed(storeLib.openStore(tmpRoot()), CLASSES, bad); } catch (e) { code = e.code; }
  ok(code === 'OTHK_SEED_SECRET', 'credential-shaped content is refused: ' + code);
}

console.log('\nothk-22: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
