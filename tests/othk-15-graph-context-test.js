// =====================================================
// OTHKM strengthening — P14 graph · P15 context builder
// tests/othk-15-graph-context-test.js  (synthetic fixtures)
// =====================================================
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const BASE = path.join(__dirname, '..', 'projects', 'oth-knowledge');
const storeLib = require(path.join(BASE, 'lib/store.js'));
const extract = require(path.join(BASE, 'lib/extract.js'));
const provenance = require(path.join(BASE, 'lib/provenance.js'));
const dedup = require(path.join(BASE, 'lib/dedup.js'));
const graph = require(path.join(BASE, 'lib/graph.js'));
const context = require(path.join(BASE, 'lib/context.js'));

let passed = 0, failed = 0;
function ok(v, label) { if (v) { passed++; console.log('  PASS ' + label); } else { failed++; console.log('  FAIL ' + label); } }
function tmpRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'othk-test-')); }
const CLASSES = provenance.loadSourceClasses();
function prov(sc) { return { source_class: sc || 'manual', source_collection: 'c', source_reference: (sc || 'manual') + '/c/x', captured_at: '2022-01-01T00:00:00Z' }; }

// ---- P14 graph ----
(function graphTests() {
  const s = storeLib.openStore(tmpRoot());
  const e1 = extract.addEntity(s, { entity_type: 'person', name: 'othman' }).id;
  const e2 = extract.addEntity(s, { entity_type: 'person', name: 'othman haddad' }).id; // alias
  const proj = extract.addEntity(s, { entity_type: 'project', name: 'idauto' }).id;
  extract.addRelationship(s, { rel_type: 'works_on', from_id: e1, to_id: proj });
  // alias link (same normalized-ish name differs, so add explicit alias candidate)
  dedup.linkEntityAliases(s, [{ a: e1, b: e2, normalized_name: 'othman' }]);
  extract.addClaim(s, CLASSES, { statement: 'othman prefers dark mode', asserted_by: 'x', prov: prov(), entity_ids: [e1] });
  extract.addClaim(s, CLASSES, { statement: 'othman haddad owns idauto', asserted_by: 'x', prov: prov(), entity_ids: [e2] });

  const adj = graph.buildAdjacency(s);
  ok(graph.neighbors(s, e1, { adjacency: adj, relTypes: ['works_on'] }).some((n) => n.id === proj), 'P14: neighbors finds works_on edge');
  const aliases = graph.resolveAliases(s, e1, { adjacency: adj });
  ok(aliases.has(e2), 'P14: resolveAliases follows same_as_candidate');
  const mentions = graph.entityMentions(s, e1);
  ok(mentions.length === 2, 'P14: entityMentions follows aliases (both claims about othman/othman-haddad)');
  const reach = graph.walk(s, [e1], { adjacency: adj, depth: 2, maxNodes: 50 });
  ok(reach.has(proj) && reach.has(e2), 'P14: bounded walk reaches related nodes');
})();

// ---- P15 context builder ----
(function contextTests() {
  const s = storeLib.openStore(tmpRoot());
  const car = extract.addEntity(s, { entity_type: 'vehicle', name: 'rexton' }).id;
  // project-namespaced facts
  extract.addClaim(s, CLASSES, { statement: 'rexton battery is 12V AGM', asserted_by: 'x', prov: prov('mythos-repo'), entity_ids: [car], namespace: 'projects/idauto' });
  extract.addClaim(s, CLASSES, { statement: 'rexton oil filter part number is OF123', asserted_by: 'x', prov: prov('deepseek'), entity_ids: [car], namespace: 'projects/idauto' });
  // a global + a personal record that must NOT leak into the project context
  extract.addClaim(s, CLASSES, { statement: 'rexton is a popular SUV globally', asserted_by: 'x', prov: prov(), entity_ids: [car], namespace: 'global' });
  extract.addClaim(s, CLASSES, { statement: 'owner dislikes rexton color', asserted_by: 'x', prov: prov(), entity_ids: [car], namespace: 'personal' });

  const ctx = context.buildContext(s, { namespace: 'projects/idauto', query: 'rexton battery', entityId: car, asOf: '2023-01-01T00:00:00Z', budget: 5, trustAware: true });
  ok(ctx.namespace === 'projects/idauto' && ctx.as_of === '2023-01-01T00:00:00Z', 'P15: context carries namespace + as_of');
  ok(ctx.items.length > 0 && ctx.items.every((i) => i.namespace === 'projects/idauto'), 'P15: context is namespace-isolated (no global/personal leak)');
  ok(ctx.items.every((i) => i.provenance && i.provenance.source_class), 'P15: every context item carries provenance (traceable)');
  ok(ctx.item_count <= 5, 'P15: context respects the budget (not a memory dump)');
  // trust-aware: the repository-verified battery fact should outrank the model-output filter claim on a battery query
  ok(ctx.items[0].text.indexOf('battery') !== -1, 'P15: trust + relevance surface the authoritative battery fact first');
})();

console.log('othk-15: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
