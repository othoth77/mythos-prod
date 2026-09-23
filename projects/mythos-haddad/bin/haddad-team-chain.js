#!/usr/bin/env node
'use strict';
// =====================================================
// MYTHOS HADDAD V2.1 — live AI-team chain check (read-only)
// projects/mythos-haddad/bin/haddad-team-chain.js
//
// Prints what the REAL registry, router, review policy, role table, skill
// registry and provider grant answer on THIS host, right now. No fixtures,
// no injected probes, nothing written: it is the reproducible form of the
// evidence quoted in docs/AI_TEAM.md, so a reader can check the claim
// instead of trusting the table.
//
//   node projects/mythos-haddad/bin/haddad-team-chain.js          # human
//   node projects/mythos-haddad/bin/haddad-team-chain.js --json   # machine
//
// It creates no task and starts no work. The one side effect is that the
// agent registry probes availability, which for the Haddad worker means one
// bounded `curl` against the local runtime's public /health.
// =====================================================
var fs = require('fs');
var os = require('os');
var path = require('path');

var EXEC = path.join(__dirname, '..', '..', 'mythos-ai-executor');
// A store path is needed because the review policy appends an event line;
// point it at a scratch directory so a check never touches a real store.
var OWN_SCRATCH = !process.env.MYTHOS_TEAM_CHAIN_HOME;
process.env.MYTHOS_EXECUTOR_HOME = process.env.MYTHOS_TEAM_CHAIN_HOME ||
  path.join(os.tmpdir(), 'haddad-team-chain-' + process.pid);
// A diagnostic that leaves litter behind stops being run. Only ever removes
// the directory this process created for itself, never one it was handed.
process.on('exit', function () {
  if (!OWN_SCRATCH) return;
  try { fs.rmSync(process.env.MYTHOS_EXECUTOR_HOME, { recursive: true, force: true }); } catch (e) { /* best effort */ }
});

var agents = require(path.join(EXEC, 'core', 'agent-registry'));
var router = require(path.join(EXEC, 'core', 'provider-router'));
var validation = require(path.join(EXEC, 'core', 'validation'));
var roles = require(path.join(EXEC, 'lib', 'roles'));
var skills = require(path.join(EXEC, 'lib', 'skills'));
var policy = require(path.join(EXEC, 'lib', 'policy'));
var agent = require(path.join(EXEC, 'providers', 'haddad-agent'));

var TASK_TYPES = ['coding', 'testing', 'review', 'research'];
var EXECUTION_TYPES = ['coding', 'testing'];

function build() {
  var out = { measured_at: new Date().toISOString(), host: os.hostname() };

  out.agents = agents.discoverAgents().map(function (a) {
    return { name: a.name, provider: a.provider, available: a.available, detail: a.health_detail,
      execution_authority: a.execution_authority, risk: a.risk_level, cost: (a.cost || {}).tier };
  });

  out.selection = {};
  TASK_TYPES.forEach(function (t) {
    var req = { capabilities: [t === 'coding' ? 'coding' : t], task_type: t };
    if (EXECUTION_TYPES.indexOf(t) !== -1) req.require_execution_authority = true;
    out.selection[t] = agents.selectCandidates(req, { fresh: true }).map(function (c) { return c.name; });
  });

  out.routing = TASK_TYPES.map(function (t) {
    var r = router.route({ id: 'chain-' + t, project: 'mythos-haddad', task_type: t,
      capabilities_required: [t === 'coding' ? 'coding' : t] }, { fresh: true });
    return { task_type: t, action: r.action, agent: r.agent || null,
      authority: r.authority === undefined ? null : r.authority, reason: r.reason || null };
  });

  // A reviewer must never be the author, and must never review a SENSITIVE
  // change unless it declared that scope. The review function is a stub here
  // only so the selection runs; note that core/validation.js treats anything
  // that is not literally 'pass' as a reject, which is why this prints who
  // was selected rather than any verdict.
  var stub = function () { return { verdict: 'pass', findings: [] }; };
  function review(sensitive, author) {
    var r = validation.adversarialReview({ id: 'chain-review', project: 'mythos-haddad', agent_id: author, task_type: 'coding' },
      { summary: 'chain check' }, { review_fn: stub, sensitive: sensitive });
    return { performed: r.performed, reviewer: r.reviewer, verdict: r.verdict,
      refused: (r.refused_candidates || []) };
  }
  out.review = {
    standard_by_another_author: review(false, 'claude-code'),
    sensitive_by_another_author: review(true, 'claude-code'),
    its_own_work: review(false, 'haddad-qwen')
  };

  out.roles = roles.listForApi().map(function (r) {
    var sel = skills.selectSkill({ task_category: r.skill_category });
    var grant = policy.toolsForProfile(r.execution_profile);
    var schemas = agent.toolSchemas(grant);
    return { role: r.id, action: r.action, execution_profile: r.execution_profile, delivery: r.delivery,
      task_type: r.task_type, capabilities_required: r.capabilities_required,
      skill: sel.skill ? sel.skill.id + ' v' + sel.skill.version : null,
      skill_trust: sel.skill ? skills.trustStatus(sel.skill.id).status : null,
      tools_offered: schemas.map(function (s) { return s.function.name; }),
      can_write: schemas.some(function (s) { return s.function.name === 'write_file'; }) };
  });

  out.provider = { available_stat_only: agent.available(), probe: agent.probe(),
    health_url: agent.healthUrl(), context_window_tokens: agent.CONTEXT_WINDOW_TOKENS,
    prompt_budget_tokens: agent.PROMPT_BUDGET_TOKENS, max_tool_payload_chars: agent.MAX_TOOL_PAYLOAD_CHARS };
  return out;
}

function human(o) {
  var L = [];
  L.push('MYTHOS HADDAD — AI team chain, measured on ' + o.host + ' at ' + o.measured_at);
  L.push('');
  L.push('AGENTS (availability is probed, never assumed)');
  o.agents.forEach(function (a) {
    L.push('  ' + a.name.padEnd(20) + (a.available ? 'available  ' : 'UNAVAILABLE') +
      '  ' + String(a.detail).padEnd(28) + ' authority=' + a.execution_authority + ' risk=' + a.risk + ' cost=' + a.cost);
  });
  L.push('');
  L.push('SELECTION by capability');
  Object.keys(o.selection).forEach(function (t) { L.push('  ' + t.padEnd(10) + '→ ' + (o.selection[t].join(', ') || '(none)')); });
  L.push('');
  L.push('ROUTING');
  o.routing.forEach(function (r) {
    L.push('  ' + r.task_type.padEnd(10) + '→ ' + r.action + (r.agent ? ' ' + r.agent : '') +
      (r.authority === null ? '' : ' (authority ' + r.authority + ')') + (r.reason ? ' — ' + r.reason : ''));
  });
  L.push('');
  L.push('REVIEW eligibility');
  L.push('  standard, another author  → performed=' + o.review.standard_by_another_author.performed +
    ' reviewer=' + o.review.standard_by_another_author.reviewer);
  L.push('  SENSITIVE, another author → performed=' + o.review.sensitive_by_another_author.performed +
    ' ' + o.review.sensitive_by_another_author.verdict +
    (o.review.sensitive_by_another_author.refused.length ? ' refused=' + o.review.sensitive_by_another_author.refused.join(',') : ''));
  // What matters here is WHO, not the verdict: the author must be excluded.
  L.push('  its own work              → performed=' + o.review.its_own_work.performed +
    ' reviewer=' + o.review.its_own_work.reviewer +
    (o.review.its_own_work.reviewer === 'haddad-qwen' ? '   *** AUTHOR REVIEWED ITSELF ***' : '  (author excluded)'));
  L.push('');
  L.push('ROLES (profile is derived from the action, never stored on the role)');
  o.roles.forEach(function (r) {
    L.push('  ' + r.role.padEnd(11) + r.action.padEnd(12) + r.execution_profile.padEnd(11) +
      r.delivery.padEnd(8) + String(r.skill).padEnd(22) + String(r.skill_trust).padEnd(8) +
      (r.can_write ? 'MAY WRITE  ' : 'read-only  ') + r.tools_offered.join(','));
  });
  L.push('');
  L.push('PROVIDER  probe=' + o.provider.probe + '  window=' + o.provider.context_window_tokens +
    '  prompt budget=' + o.provider.prompt_budget_tokens + '  per-call payload=' + o.provider.max_tool_payload_chars + ' chars');
  return L.join('\n');
}

var data = build();
console.log(process.argv.indexOf('--json') !== -1 ? JSON.stringify(data, null, 2) : human(data));
