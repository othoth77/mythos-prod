'use strict';
// =====================================================
// OTHMODE — trust subjects: what exactly is being attested (SKILL-TRUST-0)
// projects/command-center/reference/othmode/trust/subjects.js
//
// A subject is one skill as it exists on disk RIGHT NOW: its registry, its
// id, the path a scanner is pointed at, and the content hash the
// attestation is bound to. Both the writer (scan.js) and the read model
// (registries.js) resolve subjects through this one module, and the hash
// is computed by the executor's own lib/skill-trust.js — required BY PATH
// so the verifier and the writer can never disagree about what bytes mean.
//
// Two registries, two ledgers, one schema:
//   claude    .claude/skills/<id>/            → projects/command-center/data/skill-trust.json
//   executor  config/skills.json + skills/*.md → projects/mythos-ai-executor/config/skill-trust.json
// The executor ledger lives INSIDE the executor project because that is
// the trust boundary lib/skills.js is allowed to read; OTHMODE writes it,
// the executor only ever verifies it.
// =====================================================

var fs = require('fs');
var path = require('path');
var resolve = require('../resolve.js');

var REGISTRIES = ['claude', 'executor'];

function executorLib() {
  // Never cached at module load: tests repoint OTHMODE_REPO_ROOT.
  return require(resolve.repoPath('projects', 'mythos-ai-executor', 'lib', 'skill-trust.js'));
}

function ledgerPath(registry) {
  if (registry === 'claude') return process.env.SKILL_TRUST_CLAUDE_LEDGER || resolve.repoPath('projects', 'command-center', 'data', 'skill-trust.json');
  if (registry === 'executor') return process.env.SKILL_TRUST_EXECUTOR_LEDGER || resolve.repoPath('projects', 'mythos-ai-executor', 'config', 'skill-trust.json');
  throw new Error('unknown registry: ' + registry);
}

function claudeSkillsDir() { return resolve.repoPath('.claude', 'skills'); }
function executorDir() { return resolve.repoPath('projects', 'mythos-ai-executor'); }

// Same containment rule as the executor's readContainedBody: the resolved
// real path must sit inside the real skills dir, or the body is refused.
function readContained(dir, rel) {
  var realDir, real;
  try { realDir = fs.realpathSync(dir); } catch (e) { return null; }
  try { real = fs.realpathSync(path.join(realDir, rel)); } catch (e) { return null; }
  if (real !== realDir && real.indexOf(realDir + path.sep) !== 0) return null;
  try { return { body: fs.readFileSync(real), file: real }; } catch (e) { return null; }
}

function frontmatterVersion(dir) {
  var res = resolve.readText(path.join(dir, 'SKILL.md'));
  if (!res.ok) return null;
  var block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(res.data);
  if (!block) return null;
  var m = /^version:\s*(.+)$/m.exec(block[1]);
  return m ? m[1].trim() : null;
}

// subject(registry, id) → { ok, registry, id, target, kind, source_path,
//   version, content_sha256, reason }
// `target` is what the scanners receive (a directory for a Claude skill,
// the instruction FILE for an executor skill). A subject that cannot be
// hashed reports ok:false — it can be neither attested nor trusted.
function subject(registry, id) {
  if (REGISTRIES.indexOf(registry) === -1) return { ok: false, registry: registry, id: id, reason: 'unknown registry' };
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(id)) return { ok: false, registry: registry, id: id, reason: 'invalid skill id' };
  var lib = executorLib();
  if (registry === 'claude') {
    var dir = path.join(claudeSkillsDir(), id);
    var st;
    try { st = fs.lstatSync(dir); } catch (e) { return { ok: false, registry: registry, id: id, reason: 'skill directory absent' }; }
    if (!st.isDirectory()) return { ok: false, registry: registry, id: id, reason: 'skill path is not a directory' };
    var hash = lib.hashClaudeSkill(dir);
    if (!hash) return { ok: false, registry: registry, id: id, reason: 'skill directory unreadable' };
    return { ok: true, registry: 'claude', id: id, target: dir, kind: 'directory',
      source_path: '.claude/skills/' + id, version: frontmatterVersion(dir), content_sha256: hash, reason: null };
  }
  var reg = resolve.cachedJson(path.join(executorDir(), 'config', 'skills.json'));
  if (!reg.ok) return { ok: false, registry: registry, id: id, reason: 'executor skills.json ' + reg.reason };
  var def = reg.data && Object.prototype.hasOwnProperty.call(reg.data, id) ? reg.data[id] : null;
  if (!def || typeof def !== 'object') return { ok: false, registry: registry, id: id, reason: 'not in executor skills.json' };
  if (typeof def.instruction_source !== 'string' || path.isAbsolute(def.instruction_source) ||
      def.instruction_source.split(/[\\/]/).indexOf('..') !== -1) {
    return { ok: false, registry: registry, id: id, reason: 'instruction_source invalid' };
  }
  var read = readContained(path.join(executorDir(), 'skills'), def.instruction_source);
  if (!read) return { ok: false, registry: registry, id: id, reason: 'instruction file unreadable or escapes skills/' };
  var h = lib.hashExecutorSkill(def, read.body);
  return { ok: true, registry: 'executor', id: id, target: read.file, kind: 'file',
    source_path: 'projects/mythos-ai-executor/config/skills.json#' + id, version: def.version || null,
    content_sha256: h, reason: null, definition: def };
}

function listIds(registry) {
  if (registry === 'claude') return resolve.listDirs(claudeSkillsDir()).sort();
  var reg = resolve.cachedJson(path.join(executorDir(), 'config', 'skills.json'));
  return reg.ok && reg.data && typeof reg.data === 'object' ? Object.keys(reg.data).sort() : [];
}

module.exports = {
  REGISTRIES: REGISTRIES,
  executorLib: executorLib,
  ledgerPath: ledgerPath,
  subject: subject,
  listIds: listIds
};
