'use strict';
// =====================================================
// OTHMODE — unified read models over the existing registries
// projects/command-center/reference/othmode/registries.js
//
// ONE READ MODEL, ZERO NEW WRITERS. Skills live in `.claude/skills/` and
// the executor's `config/skills.json`; tools in `config/tools.json` and
// `config/mcp-capabilities.json`; providers in `config/agents.json` +
// `config/router.json`; projects in `projects/meta/*.json`. Those files
// stay authoritative and Git-reviewed — this module only renders them.
// Creating a third skills store or a second provider registry is exactly
// what the OTHMODE design forbids.
// =====================================================

var fs = require('fs');
var path = require('path');
var resolve = require('./resolve.js');

// ---------------------------------------------------------------------------
// Skills — .claude/skills/*/SKILL.md + executor config/skills.json
// ---------------------------------------------------------------------------

// Minimal front-matter reader: the Anthropic SKILL.md format starts with a
// `---` YAML block containing at least name + description. We extract only
// simple `key: value` lines — never a YAML engine, never executed.
function parseSkillFrontmatter(text) {
  var out = {};
  var lines = String(text).split('\n');
  if (lines[0] === undefined || lines[0].trim() !== '---') return out;
  for (var i = 1; i < lines.length && i < 60; i++) {
    var line = lines[i];
    if (line.trim() === '---') break;
    var m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

function listClaudeSkills() {
  var dir = resolve.repoPath('.claude', 'skills');
  return resolve.listDirs(dir).map(function (name) {
    var file = path.join(dir, name, 'SKILL.md');
    var res = resolve.readText(file);
    var meta = res.ok ? parseSkillFrontmatter(res.data) : {};
    var mtime = null;
    try { mtime = fs.statSync(file).mtime.toISOString(); } catch (e) { /* absent */ }
    return {
      id: meta.name || name,
      registry: 'claude',
      version: meta.version || null,
      status: 'ACTIVE',
      description: meta.description || null,
      source_path: '.claude/skills/' + name + '/SKILL.md',
      last_change: mtime,
      capabilities: null,
      profiles: null
    };
  });
}

function listExecutorSkills() {
  var res = resolve.cachedJson(resolve.repoPath('projects', 'mythos-ai-executor', 'config', 'skills.json'));
  if (!res.ok) return [];
  return Object.keys(res.data).map(function (key) {
    var s = res.data[key];
    return {
      id: s.id || key,
      registry: 'executor',
      version: s.version || null,
      status: s.enabled === false ? 'DISABLED' : 'ACTIVE',
      description: s.description || null,
      source_path: 'projects/mythos-ai-executor/config/skills.json#' + key,
      last_change: null,
      capabilities: s.required_capabilities || [],
      profiles: s.compatible_execution_profiles || []
    };
  });
}

function skills() {
  var all = listClaudeSkills().concat(listExecutorSkills());
  all.sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
  return { total: all.length, skills: all };
}

function skillDetail(id) {
  var claude = listClaudeSkills().filter(function (s) { return s.id === id; })[0];
  if (claude) {
    var body = resolve.readText(resolve.repoPath(claude.source_path));
    claude.body = body.ok ? body.data : null;
    return claude;
  }
  var exec = listExecutorSkills().filter(function (s) { return s.id === id; })[0];
  if (exec) {
    var instr = resolve.readText(resolve.repoPath('projects', 'mythos-ai-executor', 'skills', id + '.md'));
    exec.body = instr.ok ? instr.data : null;
    return exec;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tools — executor config/tools.json + config/mcp-capabilities.json
// ---------------------------------------------------------------------------

function tools() {
  var toolsRes = resolve.cachedJson(resolve.repoPath('projects', 'mythos-ai-executor', 'config', 'tools.json'));
  var mcpRes = resolve.cachedJson(resolve.repoPath('projects', 'mythos-ai-executor', 'config', 'mcp-capabilities.json'));
  var out = [];
  if (toolsRes.ok) {
    Object.keys(toolsRes.data).forEach(function (key) {
      var t = toolsRes.data[key];
      out.push({
        id: key,
        source: 'executor-tools',
        version: t.version || null,
        capabilities: t.capabilities || [],
        policy_class: t.policy_class || null,
        risk: t.risk || null,
        provider: t.provider || null
      });
    });
  }
  if (mcpRes.ok && mcpRes.data && typeof mcpRes.data === 'object') {
    // The MCP capability registry maps server → capability descriptors.
    Object.keys(mcpRes.data).forEach(function (server) {
      var entry = mcpRes.data[server];
      if (!entry || typeof entry !== 'object' || server === 'description') return;
      out.push({
        id: 'mcp:' + server,
        source: 'mcp-capabilities',
        version: null,
        capabilities: Array.isArray(entry.capabilities) ? entry.capabilities : [],
        policy_class: entry.policy_class || null,
        risk: entry.risk || null,
        provider: 'mcp'
      });
    });
  }
  return {
    total: out.length,
    tools: out,
    sources: {
      tools_json: toolsRes.ok ? 'loaded' : (toolsRes.reason || 'absent'),
      mcp_capabilities: mcpRes.ok ? 'loaded' : (mcpRes.reason || 'absent')
    }
  };
}

// ---------------------------------------------------------------------------
// Providers — executor config/agents.json + config/router.json.
// NON-SECRET ONLY: this read model carries registry facts (role, authority,
// enabled) and credential PRESENCE (a boolean derived from whether the
// provider's env file exists), never a credential value or path content.
// ---------------------------------------------------------------------------

var PROVIDER_ENV_FILES = {
  // Provider id → env file whose existence signals a configured credential.
  // Paths only; the file is never read, so no value can leak through here.
  'gemini-advisor': '.config/mythos-ai-executor/gemini.env',
  'claude-code': '.config/mythos-ai-executor/executor.env',
  'omniroute-advisory': '.config/mythos-ai-executor/executor.env'
};

// Tri-state on purpose: true (file exists), false (provably absent), null
// (unknowable — e.g. the env file lives in another user's home and this
// process may not look). Reporting "absent" for merely-unreadable would be
// a lie the UI then repeats; null renders as "not tracked".
function credentialPresence(file) {
  try { fs.statSync(file); return true; } catch (e) {
    return e.code === 'ENOENT' ? false : null;
  }
}

function providers() {
  var agentsRes = resolve.cachedJson(resolve.repoPath('projects', 'mythos-ai-executor', 'config', 'agents.json'));
  var routerRes = resolve.cachedJson(resolve.repoPath('projects', 'mythos-ai-executor', 'config', 'router.json'));
  var home = process.env.OTHMODE_PROVIDER_HOME || process.env.HOME || '/home/ubuntu';
  var list = [];
  if (agentsRes.ok) {
    Object.keys(agentsRes.data).forEach(function (key) {
      var a = agentsRes.data[key];
      var envFile = PROVIDER_ENV_FILES[key];
      list.push({
        id: key,
        provider: a.provider || key,
        primary: key === 'claude-code',
        execution_authority: a.execution_authority === true,
        role: a.execution_authority === true ? 'EXECUTION_AUTHORITY' : 'ADVISORY',
        enabled: a.enabled !== false,
        capabilities: a.capabilities || [],
        task_types: a.task_types || [],
        risk_level: a.risk_level || null,
        cost_tier: a.cost && a.cost.tier ? a.cost.tier : null,
        latency_class: a.latency && a.latency.class ? a.latency.class : null,
        credential_present: envFile ? credentialPresence(path.join(home, envFile)) : null,
        note: a.note || null
      });
    });
  }
  return {
    total: list.length,
    providers: list,
    routing: routerRes.ok ? {
      router_id: routerRes.data.router_id || null,
      fallback_enabled: !!(routerRes.data.fallback && routerRes.data.fallback.enabled),
      fallback_task_types: routerRes.data.fallback ? routerRes.data.fallback.allowed_task_types || [] : [],
      never_for_execution_authority: !!(routerRes.data.fallback && routerRes.data.fallback.never_for_execution_authority)
    } : null,
    sources: { agents_json: agentsRes.ok ? 'loaded' : (agentsRes.reason || 'absent') }
  };
}

// ---------------------------------------------------------------------------
// Projects — projects/meta/*.json (portfolio registry + ledger + lanes).
// ---------------------------------------------------------------------------

function projects() {
  var portfolioRes = resolve.cachedJson(resolve.repoPath('projects', 'meta', 'portfolio-registry.json'));
  var ledgerRes = resolve.cachedJson(resolve.repoPath('projects', 'meta', 'project-ledger.json'));
  var contextRes = resolve.cachedJson(resolve.repoPath('projects', 'meta', 'current-context.json'));

  // The ledger's latest stage per track gives "current task" reality;
  // the portfolio registry gives identity, status and dependencies.
  var latestStageByTrack = {};
  if (ledgerRes.ok && Array.isArray(ledgerRes.data.stages)) {
    ledgerRes.data.stages.forEach(function (s) {
      if (!s.track) return;
      var prev = latestStageByTrack[s.track];
      if (!prev || String(s.completed_at || '') >= String(prev.completed_at || '')) {
        latestStageByTrack[s.track] = s;
      }
    });
  }

  var out = [];
  if (portfolioRes.ok && Array.isArray(portfolioRes.data.tracks)) {
    portfolioRes.data.tracks.forEach(function (p) {
      var stage = latestStageByTrack[p.id] || null;
      out.push({
        id: p.id,
        name: p.name || p.id,
        category: p.category || null,
        repository: 'othoth77/mythos-prod',
        repository_paths: p.repository_paths || [],
        implementation_status: p.implementation_status || null,
        evidence_status: p.evidence_status || null,
        current_stage: p.current_stage || null,
        next_stage: p.next_stage || null,
        latest_ledger_stage: stage ? { id: stage.stage_id, title: stage.title, status: stage.status, completed_at: stage.completed_at || null } : null,
        dependencies: p.dependencies || []
      });
    });
  }
  return {
    total: out.length,
    projects: out,
    active_context: contextRes.ok ? contextRes.data : null,
    sources: {
      portfolio: portfolioRes.ok ? 'loaded' : (portfolioRes.reason || 'absent'),
      ledger: ledgerRes.ok ? 'loaded' : (ledgerRes.reason || 'absent')
    }
  };
}

module.exports = {
  skills: skills,
  skillDetail: skillDetail,
  tools: tools,
  providers: providers,
  projects: projects,
  parseSkillFrontmatter: parseSkillFrontmatter
};
