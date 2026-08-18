'use strict';
// =====================================================
// MYTHOS — Roadmap capability K (Tool Registry) per-track precursor tests
// tests/aut-tool-registry-k-catalogue-test.js
//
// Verifies projects/automation/reference/tool-registry-catalogue.js: the
// per-track (automation) Tool Registry view composed from the existing
// connector_catalogue in projects/automation/config/automation.example.json
// plus a per-capability schema map. Deterministic, offline, no network call,
// no credential. Never enables a connector, grants a capability, or changes
// a permission — read-only over the committed catalogue.
//
// Run with: node tests/aut-tool-registry-k-catalogue-test.js
// =====================================================

var fs = require('fs');
var path = require('path');
var BASE = path.join(__dirname, '..');
var pass = 0, fail = 0;
function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }

var MODULE_PATH = path.join(BASE, 'projects', 'automation', 'reference', 'tool-registry-catalogue.js');
var CATALOGUE_PATH = path.join(BASE, 'projects', 'automation', 'config', 'automation.example.json');
var reg = require(MODULE_PATH);

// ─────────────────────────────────────────────────────────────────────────
console.log('\n1. MODULE EXPORTS THE EXPECTED CONTRACT');
(function () {
  ok(typeof reg.loadCatalogue === 'function', 'exports loadCatalogue');
  ok(typeof reg.validateToolCatalogueEntry === 'function', 'exports validateToolCatalogueEntry');
  ok(typeof reg.assertLeastPrivilege === 'function', 'exports assertLeastPrivilege');
  ok(Array.isArray(reg.RISK_LEVELS) && reg.RISK_LEVELS.indexOf('LOW') !== -1 && reg.RISK_LEVELS.indexOf('HIGH') !== -1, 'exports RISK_LEVELS including LOW and HIGH');
  ok(Array.isArray(reg.COST_CLASSES) && reg.COST_CLASSES.length > 0, 'exports a non-empty COST_CLASSES list');
  ok(reg.RISK_BY_PERMISSION.READ_ONLY === 'LOW' && reg.RISK_BY_PERMISSION.WRITE_SCOPED === 'HIGH', 'RISK_BY_PERMISSION maps READ_ONLY->LOW, WRITE_SCOPED->HIGH');
  ok(reg.MUTATING_CAPABILITY_PATTERN instanceof RegExp, 'exports MUTATING_CAPABILITY_PATTERN as a RegExp');
  ok(typeof reg.CAPABILITY_SCHEMAS === 'object' && Object.keys(reg.CAPABILITY_SCHEMAS).length > 0, 'exports a non-empty CAPABILITY_SCHEMAS map');
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n2. loadCatalogue() SUCCEEDS AGAINST THE REAL COMMITTED CATALOGUE');
(function () {
  var tools;
  var threw = false;
  try { tools = reg.loadCatalogue(); } catch (e) { threw = true; console.log('    ' + e.message); }
  ok(!threw, 'loadCatalogue() does not throw against the committed automation.example.json');
  ok(Array.isArray(tools) && tools.length > 0, 'loadCatalogue() returns a non-empty tool list');
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n3. EVERY REAL CONNECTOR CARRIES ALL TOOL REGISTRY FIELDS (name, capability, permission, cost, risk, schema)');
(function () {
  var tools = reg.loadCatalogue();
  var allValid = tools.every(function (t) {
    return t.connector_id && t.provider && t.permission && t.risk_level && t.cost_class &&
      Array.isArray(t.capabilities) && t.capabilities.length > 0 &&
      t.capabilities.every(function (c) { return c.name && c.schema && c.schema.input && c.schema.output; });
  });
  ok(allValid, 'every connector in the real catalogue resolves connector_id/provider/permission/risk_level/cost_class and a schema for every declared capability');
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n4. risk_level IS MECHANICALLY CONSISTENT WITH permission FOR EVERY REAL CONNECTOR');
(function () {
  var tools = reg.loadCatalogue();
  var consistent = tools.every(function (t) { return t.risk_level === reg.RISK_BY_PERMISSION[t.permission]; });
  ok(consistent, 'every real connector\'s risk_level matches RISK_BY_PERMISSION[permission] — no hand-tuned drift');
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n5. NO READ_ONLY CONNECTOR IN THE REAL CATALOGUE DECLARES A MUTATION-SHAPED CAPABILITY');
(function () {
  var tools = reg.loadCatalogue();
  var readOnly = tools.filter(function (t) { return t.permission === 'READ_ONLY'; });
  ok(readOnly.length > 0, 'the real catalogue has at least one READ_ONLY connector to check');
  var clean = readOnly.every(function (t) {
    return t.capabilities.every(function (c) { return !reg.MUTATING_CAPABILITY_PATTERN.test(c.name); });
  });
  ok(clean, 'no READ_ONLY connector in the real catalogue exposes a capability matching the mutation-shaped pattern');
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n6. GOVERNANCE-CRITICAL FIELDS FOR backup_storage_readonly ARE UNCHANGED (exact-set regression guard)');
(function () {
  var tools = reg.loadCatalogue();
  var backup = tools.find(function (t) { return t.connector_id === 'backup_storage_readonly'; });
  ok(!!backup, 'backup_storage_readonly is present in the loaded catalogue');
  ok(backup.permission === 'READ_ONLY', 'backup_storage_readonly permission is still exactly READ_ONLY');
  ok(backup.enabled === true, 'backup_storage_readonly enabled is still exactly true (O-BACKUP-6, untouched by this stage)');
  ok(backup.secret_reference_id === 'secref-r2-backup', 'backup_storage_readonly secret_reference_id is still exactly secref-r2-backup');
  var capNames = backup.capabilities.map(function (c) { return c.name; }).sort();
  ok(JSON.stringify(capNames) === JSON.stringify(['backup.list', 'backup.verify']), 'backup_storage_readonly capabilities are still exactly {backup.list, backup.verify} — no broadening');
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n7. assertLeastPrivilege REJECTS A READ_ONLY ENTRY WITH A MUTATION-SHAPED CAPABILITY (never-seen name, pattern-based)');
(function () {
  var crafted = {
    connector_id: 'test_connector', provider: 'Test', permission: 'READ_ONLY',
    risk_level: 'LOW', cost_class: 'UNMEASURED_NO_LIVE_CALLS',
    capabilities: ['tenant_billing_profile.mutate']
  };
  var threw = false;
  try { reg.assertLeastPrivilege(crafted); } catch (e) { threw = /mutation-shaped/.test(e.message); }
  ok(threw, 'a READ_ONLY entry declaring a never-before-seen mutation-shaped capability is rejected by pattern, not an allowlist');
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n8. assertLeastPrivilege REJECTS risk_level/permission DRIFT');
(function () {
  var crafted = {
    connector_id: 'test_connector', provider: 'Test', permission: 'WRITE_SCOPED',
    risk_level: 'LOW', cost_class: 'UNMEASURED_NO_LIVE_CALLS',
    capabilities: ['widget.write']
  };
  var threw = false;
  try { reg.assertLeastPrivilege(crafted); } catch (e) { threw = /requires HIGH/.test(e.message); }
  ok(threw, 'a WRITE_SCOPED entry hand-tuned to risk_level LOW is rejected — risk cannot be downgraded independently of permission');
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n9. validateToolCatalogueEntry REJECTS MISSING REQUIRED FIELDS');
(function () {
  var cases = [
    { entry: { provider: 'Test', permission: 'READ_ONLY', risk_level: 'LOW', cost_class: 'UNMEASURED_NO_LIVE_CALLS', capabilities: ['api.read'] }, label: 'missing connector_id' },
    { entry: { connector_id: 'x', provider: 'Test', permission: 'READ_ONLY', risk_level: 'LOW', cost_class: 'UNMEASURED_NO_LIVE_CALLS', capabilities: [] }, label: 'empty capabilities array' },
    { entry: { connector_id: 'x', provider: 'Test', permission: 'READ_ONLY', risk_level: 'NOT_A_LEVEL', cost_class: 'UNMEASURED_NO_LIVE_CALLS', capabilities: ['api.read'] }, label: 'unknown risk_level' },
    { entry: { connector_id: 'x', provider: 'Test', permission: 'READ_ONLY', risk_level: 'LOW', cost_class: 'NOT_A_CLASS', capabilities: ['api.read'] }, label: 'unknown cost_class' },
    { entry: { connector_id: 'x', provider: 'Test', permission: 'READ_ONLY', risk_level: 'LOW', cost_class: 'UNMEASURED_NO_LIVE_CALLS', capabilities: ['made.up.capability'] }, label: 'capability with no registered schema' }
  ];
  cases.forEach(function (c) {
    var threw = false;
    try { reg.validateToolCatalogueEntry(c.entry); } catch (e) { threw = true; }
    ok(threw, 'validateToolCatalogueEntry rejects: ' + c.label);
  });
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n10. validateToolCatalogueEntry ACCEPTS A WELL-FORMED ENTRY');
(function () {
  var entry = {
    connector_id: 'x', provider: 'Test', permission: 'READ_ONLY',
    risk_level: 'LOW', cost_class: 'UNMEASURED_NO_LIVE_CALLS', capabilities: ['api.read']
  };
  var threw = false;
  try { reg.validateToolCatalogueEntry(entry); } catch (e) { threw = true; }
  ok(!threw, 'a well-formed entry passes validateToolCatalogueEntry');
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n11. THE JSON CATALOGUE ITSELF STILL VALIDATES AS JSON AND KEEPS least_privilege_rule');
(function () {
  var raw = JSON.parse(fs.readFileSync(CATALOGUE_PATH, 'utf8'));
  ok(!!raw.connector_catalogue, 'connector_catalogue key is present');
  ok(typeof raw.connector_catalogue.least_privilege_rule === 'string', 'least_privilege_rule note is preserved');
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n12. NO NETWORK OR CREDENTIAL DEPENDENCY IS INTRODUCED');
(function () {
  var src = fs.readFileSync(MODULE_PATH, 'utf8');
  var networkClean = src.indexOf('http') === -1 && src.indexOf('fetch(') === -1 && src.indexOf("require('http") === -1;
  var credentialPatterns = [/apiToken/i, /apiKey\s*[:=]/i, /password\s*[:=]/i, /process\.env\./];
  var credentialClean = credentialPatterns.every(function (re) { return !re.test(src); });
  ok(networkClean, 'tool-registry-catalogue.js never performs or references a network call');
  ok(credentialClean, 'tool-registry-catalogue.js never reads an environment variable or references a credential-shaped field name');
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n13. THE MODULE NEVER MUTATES THE CATALOGUE FILE (read-only over config)');
(function () {
  var src = fs.readFileSync(MODULE_PATH, 'utf8');
  var writeFree = src.indexOf('writeFileSync') === -1 && src.indexOf('appendFileSync') === -1 && src.indexOf('unlinkSync') === -1;
  ok(writeFree, 'tool-registry-catalogue.js contains no filesystem write call');
})();

console.log('\nRoadmap capability K (Tool Registry) automation-track precursor: ' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
process.exit(0);
