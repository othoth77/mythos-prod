'use strict';
// =====================================================
// Mythos AI Executor — skill trust attestation (SKILL-TRUST-0)
// projects/mythos-ai-executor/lib/skill-trust.js
//
// The VERIFIER half of the Security / Trust Gate. It answers one question
// for lib/skills.js: "is there a valid, content-bound ACCEPT attestation
// for this exact skill?" — and nothing else. It computes NO policy: the
// scanners (NVIDIA SkillSpector, Gitleaks, NVIDIA SkillEvaluator) run in
// the OTHMODE control plane (projects/command-center/reference/othmode/
// trust/), whose policy engine turns their results into one decision and
// writes the attestation ledger this module reads. The executor never
// spawns a scanner, never needs a network, never trusts a claim it cannot
// bind to bytes on disk.
//
// A ledger entry is bound to the skill by a content hash. Any change to
// the instruction body or to the registry entry — a new version, a new
// source, an edited file — changes the hash, and the attestation stops
// matching: the skill silently falls out of the executable set until it
// is rescanned. That is the RESCAN rule, enforced by arithmetic rather
// than by a scheduler.
//
// FAIL CLOSED, exactly like lib/skills.js: no ledger, an unreadable
// ledger, an entry with a different hash, a decision other than ACCEPT,
// an unsupported schema — every one of these is "not trusted". "No scan"
// is never "safe"; "scanner failed" is never "safe"; "unknown" is never
// "safe". The one and only bypass is the environment variable
// MYTHOS_SKILL_TRUST=off, which exists for the offline fixture suites
// (the same shape as MYTHOS_RESOURCE_GUARD=off) and is logged loudly.
//
// This file is shared BY PATH with the OTHMODE writer so both sides hash
// the same bytes the same way. Direction of dependency: OTHMODE → executor
// (the read model already reads executor config); never the reverse.
// =====================================================

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

var SCHEMA_VERSION = '1.0.0';
var DECISIONS = ['ACCEPT', 'REVIEW', 'BLOCK'];
var DEFAULT_LEDGER_PATH = path.join(__dirname, '..', 'config', 'skill-trust.json');

function sha256() {
  var h = crypto.createHash('sha256');
  for (var i = 0; i < arguments.length; i++) h.update(arguments[i]);
  return h.digest('hex');
}

// Canonical JSON: sorted keys at every depth, no whitespace. Two registry
// entries with the same meaning must hash identically.
function canonicalJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(function (k) {
      return JSON.stringify(k) + ':' + canonicalJson(value[k]);
    }).join(',') + '}';
  }
  return JSON.stringify(value === undefined ? null : value);
}

// Walks a directory deterministically (sorted, relative POSIX paths) and
// hashes every regular file's bytes together with its path. Symlinks are
// hashed by their TARGET STRING, never followed: a link that later points
// somewhere else is a different skill. `.git` is skipped (metadata, not
// skill content). Returns null when the directory cannot be read.
function hashDirectory(dir) {
  var files = [];
  function walk(rel) {
    var abs = path.join(dir, rel);
    var entries;
    try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch (e) { return false; }
    entries.sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (e.name === '.git') continue;
      var relPath = rel ? rel + '/' + e.name : e.name;
      if (e.isSymbolicLink()) {
        files.push({ path: relPath, kind: 'symlink', body: fs.readlinkSync(path.join(dir, relPath)) });
      } else if (e.isDirectory()) {
        if (walk(relPath) === false) return false;
      } else if (e.isFile()) {
        files.push({ path: relPath, kind: 'file', body: null });
      }
    }
    return true;
  }
  if (walk('') === false) return null;
  var h = crypto.createHash('sha256');
  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    h.update(f.kind + '\0' + f.path + '\0');
    if (f.kind === 'file') {
      var body;
      try { body = fs.readFileSync(path.join(dir, f.path)); } catch (e) { return null; }
      h.update(String(body.length) + '\0');
      h.update(body);
    } else {
      h.update(f.body + '\0');
    }
    h.update('\n');
  }
  return h.digest('hex');
}

// Hash of one executor runtime skill: the registry entry (canonical JSON)
// and the exact instruction bytes. `body` is a Buffer or string; null
// (unreadable instruction file) yields null — nothing to attest.
function hashExecutorSkill(def, body) {
  if (!def || typeof def !== 'object') return null;
  if (body === null || body === undefined) return null;
  return sha256(canonicalJson(def), '\0', Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8'));
}

// Hash of one Claude (development) skill directory: every file under it.
function hashClaudeSkill(dir) { return hashDirectory(dir); }

// --- Ledger -----------------------------------------------------------------

function emptyLedger(reason) {
  return { valid: false, reason: reason, schema_version: null, policy_version: null, skills: Object.create(null), file: null };
}

function validateLedgerObject(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { valid: false, reason: 'ledger root is not an object' };
  if (raw.schema_version !== SCHEMA_VERSION) return { valid: false, reason: 'ledger schema_version ' + raw.schema_version + ' unsupported (want ' + SCHEMA_VERSION + ')' };
  if (!raw.skills || typeof raw.skills !== 'object' || Array.isArray(raw.skills)) return { valid: false, reason: 'ledger.skills is not an object' };
  var skills = Object.create(null);
  var ids = Object.keys(raw.skills);
  for (var i = 0; i < ids.length; i++) {
    var id = ids[i];
    var e = raw.skills[id];
    if (!e || typeof e !== 'object') return { valid: false, reason: id + ': entry is not an object' };
    if (DECISIONS.indexOf(e.decision) === -1) return { valid: false, reason: id + ': decision must be one of ' + DECISIONS.join('/') };
    if (typeof e.content_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(e.content_sha256)) return { valid: false, reason: id + ': content_sha256 must be a sha256 hex' };
    if (typeof e.scanned_at !== 'string' || isNaN(Date.parse(e.scanned_at))) return { valid: false, reason: id + ': scanned_at must be an ISO timestamp' };
    if (typeof e.registry !== 'string') return { valid: false, reason: id + ': registry missing' };
    skills[id] = e;
  }
  return { valid: true, skills: skills, policy_version: typeof raw.policy_version === 'string' ? raw.policy_version : null };
}

// Never throws. An absent or malformed ledger is a reportable state — every
// skill then verifies as UNATTESTED, which is "not trusted", never a crash.
function loadLedger(ledgerPath) {
  ledgerPath = ledgerPath || DEFAULT_LEDGER_PATH;
  var raw;
  try { raw = JSON.parse(fs.readFileSync(ledgerPath, 'utf8')); }
  catch (e) { var r = emptyLedger('ledger unreadable or not valid JSON: ' + e.message); r.file = ledgerPath; return r; }
  var v = validateLedgerObject(raw);
  if (!v.valid) { var r2 = emptyLedger(v.reason); r2.file = ledgerPath; return r2; }
  return { valid: true, reason: null, schema_version: SCHEMA_VERSION, policy_version: v.policy_version, skills: v.skills, file: ledgerPath };
}

// --- Verification (pure) ----------------------------------------------------
//
// verify(ledger, { id, registry, content_sha256 }) →
//   { trusted: bool, status, reason, entry }
// status ∈ ACCEPT | REVIEW | BLOCK | UNATTESTED | STALE | LEDGER_INVALID | UNHASHABLE
// `trusted` is true ONLY for a matching ACCEPT. Everything else is false.
function verify(ledger, subject) {
  if (!subject || !subject.id) return { trusted: false, status: 'UNATTESTED', reason: 'no subject', entry: null };
  if (!ledger || !ledger.valid) {
    return { trusted: false, status: 'LEDGER_INVALID', reason: ledger && ledger.reason ? ledger.reason : 'no ledger', entry: null };
  }
  if (!subject.content_sha256) {
    return { trusted: false, status: 'UNHASHABLE', reason: 'skill content could not be hashed (instruction unreadable or refused)', entry: null };
  }
  var entry = ledger.skills[subject.id];
  if (!entry) return { trusted: false, status: 'UNATTESTED', reason: 'no attestation for ' + subject.id, entry: null };
  if (subject.registry && entry.registry !== subject.registry) {
    return { trusted: false, status: 'UNATTESTED', reason: 'attestation is for registry ' + entry.registry + ', not ' + subject.registry, entry: entry };
  }
  if (entry.content_sha256 !== subject.content_sha256) {
    return { trusted: false, status: 'STALE', reason: 'content changed since the scan (' + entry.scanned_at + ') — rescan required', entry: entry };
  }
  if (entry.decision !== 'ACCEPT') {
    return { trusted: false, status: entry.decision, reason: (entry.reasons && entry.reasons.length ? entry.reasons.join('; ') : 'policy decision ' + entry.decision), entry: entry };
  }
  return { trusted: true, status: 'ACCEPT', reason: null, entry: entry };
}

// The offline-suite bypass. Read at call time (not module load) so a test
// can set it before requiring lib/skills.js, and so production — where it
// is never set — evaluates the real ledger on every load.
function enforcementDisabled() {
  return String(process.env.MYTHOS_SKILL_TRUST || '').toLowerCase() === 'off';
}

module.exports = {
  SCHEMA_VERSION: SCHEMA_VERSION,
  DECISIONS: DECISIONS,
  DEFAULT_LEDGER_PATH: DEFAULT_LEDGER_PATH,
  canonicalJson: canonicalJson,
  hashDirectory: hashDirectory,
  hashClaudeSkill: hashClaudeSkill,
  hashExecutorSkill: hashExecutorSkill,
  validateLedgerObject: validateLedgerObject,
  loadLedger: loadLedger,
  verify: verify,
  enforcementDisabled: enforcementDisabled
};
