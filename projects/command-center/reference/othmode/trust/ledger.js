'use strict';
// =====================================================
// OTHMODE — trust attestation ledgers (SKILL-TRUST-0)
// projects/command-center/reference/othmode/trust/ledger.js
//
// Two Git-tracked JSON files, one schema (the executor's lib/skill-trust.js
// defines and validates it; this module only reads and writes it):
//
//   projects/command-center/data/skill-trust.json           (claude registry)
//   projects/mythos-ai-executor/config/skill-trust.json     (executor registry)
//
// GitHub is the source of truth: an attestation is a reviewed diff, not a
// runtime mutation, and the scanning history behind it is appended to the
// OTHMODE store (trust/records.jsonl — outside Git, append-only) so the
// ledger stays the CURRENT decision per skill and the store keeps every
// scan ever made.
//
// A ledger carries no secret and no scanned content: decisions, hashes,
// versions, timestamps, scanner summaries and finding LOCATIONS. The MCC
// secret gate (reference/secrets.js) is still run over the serialised file
// before every write — the same defence every OTHMODE write surface has.
// =====================================================

var fs = require('fs');
var path = require('path');
var secrets = require('../../secrets.js');
var subjects = require('./subjects.js');

function lib() { return subjects.executorLib(); }

function empty(policyVersion) {
  return { schema_version: lib().SCHEMA_VERSION, policy_version: policyVersion || null, generated_at: null,
    note: 'OTHMODE skill trust ledger — one CURRENT attestation per skill, bound to the skill content by sha256. Written only by projects/command-center/cli/skill-trust-cli.js after NVIDIA SkillSpector, Gitleaks and NVIDIA SkillEvaluator have scanned the exact bytes; verified by the executor (lib/skill-trust.js) before a skill may be selected or rendered. Edit by rescanning, never by hand.',
    skills: {} };
}

function load(registry) {
  var file = subjects.ledgerPath(registry);
  return lib().loadLedger(file);
}

// Reads the raw file for writing (preserving entries this run does not
// touch). A missing file starts an empty ledger; an INVALID file is not
// silently replaced — the caller must fix or delete it deliberately.
function loadForWrite(registry, policyVersion) {
  var file = subjects.ledgerPath(registry);
  var raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) {
    if (e.code === 'ENOENT') return { file: file, data: empty(policyVersion) };
    throw new Error('ledger ' + file + ' unreadable: ' + e.message);
  }
  var v = lib().validateLedgerObject(raw);
  if (!v.valid) throw new Error('ledger ' + file + ' invalid (' + v.reason + ') — repair or remove it deliberately before writing');
  return { file: file, data: raw };
}

function sortedObject(obj) {
  var out = {};
  Object.keys(obj).sort().forEach(function (k) { out[k] = obj[k]; });
  return out;
}

// upsert(registry, entry, policyVersion) → { file, entry }
function upsert(registry, entry, policyVersion) {
  var loaded = loadForWrite(registry, policyVersion);
  var data = loaded.data;
  data.policy_version = policyVersion;
  data.generated_at = new Date().toISOString();
  data.skills[entry.id] = entry;
  data.skills = sortedObject(data.skills);
  var text = JSON.stringify(data, null, 2) + '\n';
  var gate = secrets.scan({ ledger: text });
  if (gate.blocked) {
    var e = new Error('refused to write ledger: content matches a known credential format (' + gate.findings.map(function (f) { return f.kind || f.field || 'finding'; }).join(',') + ')');
    e.code = 'OTHMODE_TRUST_SECRET';
    throw e;
  }
  var v = lib().validateLedgerObject(data);
  if (!v.valid) throw new Error('refused to write an invalid ledger: ' + v.reason);
  fs.mkdirSync(path.dirname(loaded.file), { recursive: true });
  var tmp = loaded.file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, text, { encoding: 'utf8', mode: 420 /* 0644 */ });
  fs.renameSync(tmp, loaded.file);
  return { file: loaded.file, entry: entry };
}

module.exports = { empty: empty, load: load, loadForWrite: loadForWrite, upsert: upsert };
