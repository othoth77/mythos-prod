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
var trust = require('./trust/index.js');

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

// SKILL-TRUST-0: every skill row carries its trust status, computed the
// same way the executor computes it (content hash vs. the Git ledger). The
// read model still writes nothing — the ledgers are written by the
// operator CLI after a scan, and reviewed as a diff like any other change.
function withTrust(rows) {
  var ledgers = trust.loadLedgers();
  rows.forEach(function (s) {
    var dirName = s.registry === 'claude' ? s.source_path.split('/')[2] : s.id;
    s.trust = trust.skillTrust(s.registry, dirName, ledgers);
    if (s.registry === 'executor' && s.status === 'ACTIVE' && !s.trust.trusted) s.status = 'UNTRUSTED';
  });
  return rows;
}

function skills() {
  var all = withTrust(listClaudeSkills().concat(listExecutorSkills()));
  all.sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
  return { total: all.length, skills: all, trust_summary: trust.summarise(all), trust_policy: trust.policyInfo() };
}

function skillDetail(id) {
  var claude = withTrust(listClaudeSkills()).filter(function (s) { return s.id === id; })[0];
  if (claude) {
    var body = resolve.readText(resolve.repoPath(claude.source_path));
    claude.body = body.ok ? body.data : null;
    return claude;
  }
  var exec = withTrust(listExecutorSkills()).filter(function (s) { return s.id === id; })[0];
  if (exec) {
    var instr = resolve.readText(resolve.repoPath('projects', 'mythos-ai-executor', 'skills', id + '.md'));
    exec.body = instr.ok ? instr.data : null;
    return exec;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tools — executor config/tools.json + config/mcp-capabilities.json
// (outbound governance, shape {servers:{name:{enabled,tools,…}}}) + the
// estate MCP registry (projects/mythos-gateway/registry/mcp-registry.json)
// joined with the latest MEASURED snapshot written by
// projects/mythos-gateway/bin/mcp-registry-check.
//
// Five states, never conflated (MCP-ECOSYSTEM-1):
//   registered   named in a registry file
//   available    the last check discovered the tool on a live server
//   healthy      that server's last measured status was ONLINE
//   authorized   the permission matrix answers ALLOW/CONTROLLED for the
//                `othmode` subject — the read model's own row, not anyone
//                else's; the executor computes its own before acting
//   executable   all four, and the server needs no credential this read
//                model would have to hold (it holds none)
// Absent snapshot ⇒ the three measured flags are null ("not tracked"),
// the same tri-state rule credential_present follows below.
// ---------------------------------------------------------------------------

function mcpStatusFile() {
  return process.env.OTHMODE_MCP_STATUS_FILE || '/home/deploy/deployments/mythos-gateway/mcp-registry-status.json';
}

// The gateway's own loaders are the single validator of these files. They
// are required by path (not duplicated) and their absence on an older
// checkout is a reportable state, not a crash.
function gatewayLib(name) {
  try { return require(resolve.repoPath('projects', 'mythos-gateway', 'lib', name + '.js')); }
  catch (e) { return null; }
}

function mcpView() {
  var regLib = gatewayLib('mcp-registry');
  var polLib = gatewayLib('mcp-policy');
  var sources = { mcp_registry: 'absent', mcp_permissions: 'absent', mcp_status: 'absent' };
  if (!regLib || !polLib) {
    sources.mcp_registry = 'gateway libraries absent on this checkout';
    return { total: 0, servers: [], checked_at: null, sources: sources };
  }
  var registry = regLib.loadRegistry(resolve.repoPath('projects', 'mythos-gateway', 'registry', 'mcp-registry.json'));
  var perms = polLib.loadPermissions(resolve.repoPath('projects', 'mythos-gateway', 'registry', 'mcp-permissions.json'));
  sources.mcp_registry = registry.valid ? 'loaded' : ('invalid: ' + registry.reason);
  sources.mcp_permissions = perms.valid ? 'loaded' : ('invalid: ' + perms.reason);
  var snap = resolve.cachedJson(mcpStatusFile());
  var snapshot = snap.ok && snap.data && snap.data.servers ? snap.data : null;
  sources.mcp_status = snapshot ? 'loaded' : (snap.reason || 'absent');
  var servers = [];
  if (registry.valid) {
    Object.keys(registry.servers).forEach(function (name) {
      var s = registry.servers[name];
      var m = snapshot && snapshot.servers[name] ? snapshot.servers[name] : null;
      var healthy = m ? m.status === 'ONLINE' : null;
      var needsHeldCredential = !!(s.auth && s.auth.required && s.auth.scheme !== 'host-access');
      var tools = regLib.declaredTools(registry.servers, name).map(function (t) {
        var d = polLib.authorize(perms.valid ? perms.policy : null, { subject: 'othmode', server: name, tool: t });
        var available = m ? m.tools_discovered.indexOf(t) !== -1 : null;
        var authorized = d.decision === 'ALLOW' || d.decision === 'CONTROLLED';
        var executable = (available === null || healthy === null) ? null
          : (s.enabled && available && healthy && authorized && !needsHeldCredential);
        return { name: t, capability: d.capability, decision: d.decision, requires_approval: d.requires_approval,
          registered: true, available: available, healthy: healthy, authorized: authorized, executable: executable };
      });
      // SKILL-TRUST-0: the MCP trust layer's decision for this server, from
      // the same measurement (policy in data/skill-trust-policy.json).
      var trustDecision = trust.mcpTrust(name, s, m, snapshot ? { generated_at: snapshot.generated_at, checker_version: snapshot.checker_version || snapshot.version || null } : null);
      servers.push({
        name: name, purpose: s.purpose, direction: s.direction, transport: s.transport.kind, version: s.version || null,
        trust: { decision: trustDecision.decision, reasons: trustDecision.reasons },
        enabled: s.enabled, enabled_note: s.enabled_note || null, write_capable: s.write_capable, public: s.public === true,
        auth_required: !!(s.auth && s.auth.required), auth_scheme: s.auth ? s.auth.scheme : null,
        credential_ref: s.auth && s.auth.credential ? s.auth.credential : null,
        relays: s.relays || null, peers: s.peers || [], consumers: s.consumers,
        governed_by_capabilities: s.outbound_capability_server || null,
        status: m ? m.status : null, reachable: m ? m.reachable : null,
        tools_discovered: m ? m.tools_discovered.length : null,
        drift: m ? m.drift : null, findings: m ? (m.policy_findings || []).concat(m.credential_findings || []) : null,
        tools: tools
      });
    });
  }
  var trustSummary = {};
  servers.forEach(function (srv) { trustSummary[srv.trust.decision] = (trustSummary[srv.trust.decision] || 0) + 1; });
  return { total: servers.length, servers: servers, checked_at: snapshot ? snapshot.generated_at : null,
    checked_ok: snapshot ? snapshot.ok === true : null, sources: sources, trust_summary: trustSummary };
}

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
  // The outbound capability registry is {servers:{<server>:{enabled,
  // description, tools:{<tool>:{description}}, required_execution_profiles}}}
  // — lib/mcp-capabilities.js validates it; this only renders it.
  var mcpServers = mcpRes.ok && mcpRes.data && mcpRes.data.servers && typeof mcpRes.data.servers === 'object'
    ? mcpRes.data.servers : null;
  if (mcpServers) {
    Object.keys(mcpServers).forEach(function (server) {
      var entry = mcpServers[server];
      if (!entry || typeof entry !== 'object') return;
      out.push({
        id: 'mcp:' + server,
        source: 'mcp-capabilities',
        direction: 'outbound',
        version: null,
        capabilities: entry.tools && typeof entry.tools === 'object' ? Object.keys(entry.tools) : [],
        policy_class: null,
        risk: null,
        provider: 'mcp',
        enabled: entry.enabled === true,
        required_execution_profiles: Array.isArray(entry.required_execution_profiles) ? entry.required_execution_profiles : []
      });
    });
  }
  var mcp = mcpView();
  mcp.servers.forEach(function (srv) {
    srv.tools.forEach(function (t) {
      out.push({
        id: srv.name + '.' + t.name,
        source: 'mcp-registry',
        direction: srv.direction,
        version: srv.version,
        capabilities: t.capability ? [t.capability] : [],
        policy_class: t.decision,
        risk: srv.write_capable ? 'high' : 'low',
        provider: 'mcp',
        server: srv.name,
        enabled: srv.enabled,
        registered: t.registered,
        available: t.available,
        healthy: t.healthy,
        authorized: t.authorized,
        executable: t.executable
      });
    });
  });
  return {
    total: out.length,
    tools: out,
    sources: {
      tools_json: toolsRes.ok ? 'loaded' : (toolsRes.reason || 'absent'),
      mcp_capabilities: mcpServers ? 'loaded' : (mcpRes.ok ? 'unexpected shape' : (mcpRes.reason || 'absent')),
      mcp_registry: mcp.sources.mcp_registry,
      mcp_status: mcp.sources.mcp_status
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
  mcp: mcpView,
  providers: providers,
  projects: projects,
  parseSkillFrontmatter: parseSkillFrontmatter
};
