'use strict';
// =====================================================
// Mythos AI Executor — internal HTTP API
// projects/mythos-ai-executor/server.js
//
// The surface n8n talks to (mission §11–12). Binds ONLY to internal
// addresses — loopback plus the Docker bridge gateway that the n8n
// container can reach — and never to a public interface. Every endpoint
// except /health requires a bearer token loaded from a 0600 env file
// outside Git; comparison is constant-time.
//
//   GET  /health                    no auth; liveness + component checks
//   POST /tasks                     create + enqueue a task
//   GET  /tasks                     list summaries (?status=X filters)
//   GET  /tasks/<id>                status + checkpoint
//   GET  /tasks/<id>/report         structured + rendered report
//   POST /tasks/<id>/resume         force a resume attempt now
//   POST /tasks/<id>/dispatch       capacity-gated dispatch (MOS-3A; console
//                                   missions go through this, not /resume)
//   GET  /dispatcher                dispatcher capacity/queue status
//   GET  /resource-guard            host memory pressure state (gh-issue-101)
//   GET  /session-guard             Claude Desktop Remote session lifecycle
//                                   counts + planned reclamation (gh-issue-144,
//                                   read-only: never signals, never mutates)
//   POST /tasks/<id>/cancel         cooperative cancel (SIGTERM if running)
//   POST /events/n8n-error          n8n failure-handler sink (logged, notified)
//   POST /route                     MOS-v2 M-11: governed auto-routing —
//                                   {task_type, execution_profile} →
//                                   core/provider-router.js's own decision,
//                                   field-picked. Gated by MYTHOS_CORE_ENABLED
//                                   like /goals (the router writes durable
//                                   events through core/store on fallback and
//                                   no_provider). Never widens authority: an
//                                   execution-requiring profile/task_type
//                                   that the router can only satisfy with an
//                                   advisory agent answers no_provider rather
//                                   than downgrading.
//   POST /campaigns                 submit a goal (returns the LIVE campaign
//                                   for the project if one exists — a second
//                                   campaign is never created alongside it)
//   GET  /campaigns                 list campaign summaries
//   GET  /campaigns/<id>            state, missions, current tasks, worktrees
//   POST /campaigns/<id>/continue   single-flight continuation; refuses
//                                   WAITING_FOR_APPROVAL and BLOCKED
//   POST /campaigns/<id>/approvals/resolve
//                                   record a HUMAN decision on an
//                                   outstanding approval (MOS-v2 M-09).
//                                   The only supported way out of
//                                   WAITING_FOR_APPROVAL; requires an
//                                   explicit granted boolean and a
//                                   recorded decided_by identity.
//   GET  /campaigns/<id>/report     completed/blocked/approval-required view
//   GET  /events?since=&limit=      cursor event feed for the n8n bridge
//
// The task instruction arrives as DATA. Nothing in the payload can select
// the mock provider, enable a disabled profile, or point the executor at
// an unregistered project — executor.createTask enforces all of that.
// =====================================================

var fs = require('fs');
var http = require('http');
var crypto = require('crypto');
var path = require('path');

var executor = require('./executor');
var state = require('./lib/state');
var mcpInvoke = require('./lib/mcp-invoke');
var hostops = require('./lib/hostops');
var redact = require('../mythos-orchestrator/lib/redact');

var DEFAULT_PORT = parseInt(process.env.MYTHOS_EXECUTOR_PORT || '8130', 10);
var DEFAULT_BINDS = (process.env.MYTHOS_EXECUTOR_BIND || '127.0.0.1,172.18.0.1').split(',');
var TOKEN_FILE = process.env.MYTHOS_EXECUTOR_TOKEN_FILE ||
  path.join(process.env.HOME || '/home/ubuntu', '.config', 'mythos-ai-executor', 'executor.env');
var MAX_BODY = 256 * 1024;

function loadToken() {
  if (process.env.MYTHOS_EXECUTOR_TOKEN) return process.env.MYTHOS_EXECUTOR_TOKEN;
  try {
    var m = /^MYTHOS_EXECUTOR_TOKEN=(.+)$/m.exec(fs.readFileSync(TOKEN_FILE, 'utf8'));
    return m ? m[1].trim() : null;
  } catch (e) {
    return null;
  }
}

function timingSafeEqual(a, b) {
  var ha = crypto.createHash('sha256').update(String(a)).digest();
  var hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function authorized(req, token) {
  if (!token) return false; // no token provisioned → everything but /health refuses
  var header = req.headers['authorization'] || '';
  var m = /^Bearer\s+(.+)$/.exec(header);
  return !!m && timingSafeEqual(m[1].trim(), token);
}

function send(res, code, obj) {
  var body = JSON.stringify(obj, null, 2);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req) {
  return new Promise(function (resolve, reject) {
    var chunks = [];
    var size = 0;
    req.on('data', function (d) {
      size += d.length;
      if (size > MAX_BODY) { reject(new Error('BODY_TOO_LARGE')); req.destroy(); return; }
      chunks.push(d);
    });
    req.on('end', function () { resolve(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', reject);
  });
}

function handler(req, res, token) {
  var url = req.url.split('?')[0];
  var query = {};
  (req.url.split('?')[1] || '').split('&').forEach(function (kv) {
    var p = kv.split('=');
    if (p[0]) query[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || '');
  });

  if (req.method === 'GET' && url === '/health') {
    return executor.health().then(function (h) { send(res, h.ok ? 200 : 503, h); });
  }

  if (!authorized(req, token)) {
    return send(res, 401, { error: 'unauthorized' });
  }

  var m;
  if (req.method === 'POST' && url === '/tasks') {
    return readBody(req).then(function (body) {
      var payload = JSON.parse(body || '{}');
      var task = executor.createTask(payload);
      send(res, 201, { task_id: task.task_id, status: 'QUEUED', project: task.project, stage: task.stage });
    }).catch(function (err) {
      send(res, 400, { error: redact.redact(err.message) });
    });
  }

  if (req.method === 'GET' && url === '/tasks') {
    var list = executor.summaries();
    if (query.status) list = list.filter(function (s) { return s.status === query.status; });
    if (query.due === '1') {
      var now = Date.now();
      list = list.filter(function (s) {
        return s.status === 'WAITING_FOR_QUOTA' && s.quota_state &&
          s.quota_state.resume_after && Date.parse(s.quota_state.resume_after) <= now;
      });
    }
    return send(res, 200, { tasks: list });
  }

  if ((m = /^\/tasks\/([a-z0-9-]{8,64})$/.exec(url)) && req.method === 'GET') {
    var st = state.readStatus(m[1]);
    if (!st) return send(res, 404, { error: 'no such task' });
    return send(res, 200, {
      task: state.readJSON(m[1], 'task.json'),
      status: st,
      effective: state.effectiveStatus(st),
      checkpoint: state.readJSON(m[1], 'checkpoint.json')
    });
  }

  if ((m = /^\/tasks\/([a-z0-9-]{8,64})\/report$/.exec(url)) && req.method === 'GET') {
    var report = state.readJSON(m[1], 'report.json');
    if (!report) return send(res, 404, { error: 'no report yet' });
    return send(res, 200, { report: report, markdown: state.readText(m[1], 'report.md') });
  }

  if ((m = /^\/tasks\/([a-z0-9-]{8,64})\/resume$/.exec(url)) && req.method === 'POST') {
    var rst = state.readStatus(m[1]);
    if (!rst) return send(res, 404, { error: 'no such task' });
    if (['WAITING_FOR_QUOTA', 'WAITING_RETRY', 'QUEUED'].indexOf(rst.status) === -1 &&
        state.effectiveStatus(rst) !== 'INTERRUPTED') {
      return send(res, 409, { error: 'task is ' + rst.status + ', not resumable' });
    }
    // Fire-and-report-accepted: the run continues after this response.
    executor.runTask(m[1]).catch(function (err) {
      state.appendEvent(m[1], 'resume_error', { error: redact.redact(err.message) });
    });
    return send(res, 202, { task_id: m[1], accepted: true });
  }

  // MOS-3A: the capacity-gated dispatch the console's explicit start now
  // uses instead of the unconditional /resume above. /resume itself is
  // untouched — n8n's Quota Watch depends on it staying exactly as it is.
  if ((m = /^\/tasks\/([a-z0-9-]{8,64})\/dispatch$/.exec(url)) && req.method === 'POST') {
    return executor.dispatchTask(m[1]).then(function (result) {
      send(res, 202, result);
    }).catch(function (err) {
      var msg = String((err && err.message) || err);
      if (msg.indexOf('NO_SUCH_TASK') === 0) return send(res, 404, { error: 'no such task' });
      return send(res, 409, { error: redact.redact(msg) });
    });
  }

  if (req.method === 'GET' && url === '/dispatcher') {
    return send(res, 200, executor.dispatcherStatus());
  }

  // Read-only: level, the sample behind it, and whether admission is open.
  // Kept off /dispatcher because the console asserts that view's exact keys.
  if (req.method === 'GET' && url === '/resource-guard') {
    return send(res, 200, executor.resourceGuardStatus());
  }

  // Read-only: how many Claude Desktop Remote sessions are active / idle /
  // orphaned, how much memory they hold, and what the guard WOULD reclaim.
  // Observational only — this route never signals a process and never
  // advances the guard's state (executor.sessionGuardStatus -> snapshot()).
  if (req.method === 'GET' && url === '/session-guard') {
    return send(res, 200, executor.sessionGuardStatus());
  }

  if ((m = /^\/tasks\/([a-z0-9-]{8,64})\/cancel$/.exec(url)) && req.method === 'POST') {
    var cst = state.readStatus(m[1]);
    if (!cst) return send(res, 404, { error: 'no such task' });
    if (['COMPLETED', 'FAILED', 'CANCELLED'].indexOf(cst.status) !== -1) {
      return send(res, 409, { error: 'task already ' + cst.status });
    }
    if (cst.status === 'RUNNING' && cst.pid && state.processAlive(cst.pid)) {
      try { process.kill(cst.pid, 'SIGTERM'); } catch (e) { /* raced its exit */ }
    }
    state.transition(m[1], 'CANCELLED', { pid: null, ended_at: new Date().toISOString(), next_action: 'cancelled by operator' });
    return send(res, 200, { task_id: m[1], status: 'CANCELLED' });
  }

  // --- MOS-v2 M-11: governed auto-routing -----------------------------------
  // The ONLY thing this route decides is which agent core/provider-router.js
  // would pick for a task shape — capability match, availability probing,
  // quota state, cost/risk ranking, reputation tiebreak. Fallback (same
  // authority only) and refusal are the router's own rules, unmodified. This
  // handler adds exactly one thing the router does not know about: the
  // console's execution_profile, which can demand execution authority even
  // for a task_type the router alone would not (e.g. repo-write on a
  // 'research' task). When that demand cannot be met by the router's own
  // pick, the answer is no_provider — never a downgraded authority, never a
  // provider this executor cannot actually run (checked against the real
  // PROVIDERS map, so a registered-but-unimplemented or unconfigured
  // provider such as gemini can never be returned as routable).
  // MCP-ECOSYSTEM-1: governed MCP invocation. The executor is the only
  // execution engine; an agent asks it to call a tool and it decides —
  // estate registry → permission matrix → M-12 capability gate → declared
  // tool set → Vault reference — then calls, verifies, audits and returns
  // the content. The caller never sees a credential. The subject is the
  // executor itself; `requested_by` is recorded, not trusted. The body is
  // a closed set of fields: anything else is refused, like every other
  // write on this API.
  if (req.method === 'POST' && url === '/mcp/invoke') {
    var INVOKE_FIELDS = ['server', 'tool', 'arguments', 'task_id', 'approval_id', 'requested_by'];
    return readBody(req).then(function (body) {
      var payload;
      try { payload = JSON.parse(body || '{}'); } catch (e) { return send(res, 400, { error: 'INVALID_JSON' }); }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return send(res, 400, { error: 'INVALID_BODY' });
      var unexpected = Object.keys(payload).filter(function (k) { return INVOKE_FIELDS.indexOf(k) === -1; });
      if (unexpected.length) return send(res, 400, { error: 'UNEXPECTED_FIELD', fields: unexpected });
      return mcpInvoke.invoke(payload).then(function (out) {
        var status = out.http_status || (out.ok ? 200 : 500);
        delete out.http_status;
        send(res, status, out);
      });
    }).catch(function (err) {
      send(res, err.message === 'BODY_TOO_LARGE' ? 413 : 500, { error: String(err.message || 'error').slice(0, 200) });
    });
  }

  // The registry the executor consults, joined with the latest measured
  // snapshot when the registry check has written one. Metadata only.
  if (req.method === 'GET' && url === '/mcp/registry') {
    return send(res, 200, mcpInvoke.describeRegistry());
  }

  // HOSTOPS-1/HOSTOPS-2R: governed READ-ONLY host operation through the
  // installed root-owned boundary (docs/MYTHOS_HOSTOPS_INTERFACE.md). Same
  // shape as /mcp/invoke: the executor is the subject, the body is a closed
  // field set, and lib/hostops.js decides — allowlist -> class READ ->
  // argument validation -> Resource Guard admission -> a Unix socket call
  // to the root-owned mythos-hostops-daemon (SO_PEERCRED-verified, no sudo,
  // no shell) -> verified JSON -> task record. Bearer required like every
  // non-/health endpoint; profiles keep denying Bash(sudo:*), so this route
  // is the ONLY path from a task to the helper.
  if (req.method === 'POST' && url === '/hostops/run') {
    return readBody(req).then(function (body) {
      var payload;
      try { payload = JSON.parse(body || '{}'); } catch (e) { return send(res, 400, { error: 'INVALID_JSON' }); }
      return hostops.invoke(payload).then(function (out) {
        var status = out.http_status || (out.ok ? 200 : 500);
        delete out.http_status;
        send(res, status, out);
      });
    }).catch(function (err) {
      send(res, err.message === 'BODY_TOO_LARGE' ? 413 : 500, { error: String(err.message || 'error').slice(0, 200) });
    });
  }

  // What the hostops path can do, straight from the allowlist. Metadata only.
  if (req.method === 'GET' && url === '/hostops/registry') {
    return send(res, 200, hostops.describe());
  }

  if (req.method === 'POST' && url === '/route') {
    var routeCore;
    try {
      routeCore = require('./core/core-wiring');
    } catch (e) {
      return send(res, 500, { error: 'core unavailable: ' + redact.redact(e.message) });
    }
    if (!routeCore.coreEnabled()) {
      return send(res, 503, {
        error: 'core disabled',
        detail: 'MYTHOS_CORE_ENABLED is not true; the orchestration core is off by default'
      });
    }
    return readBody(req).then(function (body) {
      var payload = JSON.parse(body || '{}');
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return send(res, 400, { error: 'body must be a JSON object' });
      }
      var ROUTE_FIELDS = ['task_type', 'execution_profile'];
      var unexpected = Object.keys(payload).filter(function (k) { return ROUTE_FIELDS.indexOf(k) === -1; });
      if (unexpected.length) {
        return send(res, 400, { error: 'unexpected field: ' + String(unexpected[0]).slice(0, 40) });
      }

      var plannerMod = require('./core/planner');
      var taskType = payload.task_type;
      if (typeof taskType !== 'string' || plannerMod.TASK_TYPES.indexOf(taskType) === -1) {
        return send(res, 400, { error: 'task_type must be one of: ' + plannerMod.TASK_TYPES.join(', ') });
      }

      var ROUTE_PROFILES = ['repo-read', 'repo-test', 'repo-write'];
      var profile = payload.execution_profile;
      if (typeof profile !== 'string' || ROUTE_PROFILES.indexOf(profile) === -1) {
        return send(res, 400, { error: 'execution_profile must be one of: ' + ROUTE_PROFILES.join(', ') });
      }

      var router = require('./core/provider-router');
      var registry = require('./core/agent-registry');
      var defaults = plannerMod.TYPE_DEFAULTS[taskType] || plannerMod.TYPE_DEFAULTS.generic;
      var subject = {
        id: 'route-probe',
        project: 'mythos-prod',
        task_type: taskType,
        capabilities_required: defaults.capabilities
      };

      var result;
      try {
        result = router.route(subject, {});
      } catch (e) {
        return send(res, 500, { error: 'routing failed: ' + redact.redact(e.message) });
      }

      // repo-test and repo-write can both mutate the working tree (tests
      // may run setup/build steps); repo-read never needs execution
      // authority by itself. EXECUTION_TASK_TYPES is the router's own list
      // for task_type alone — the profile check here is strictly additive,
      // never a way to relax what the router already required.
      var requireAuthority = profile === 'repo-write' || profile === 'repo-test' ||
        router.needsExecutionAuthority(subject);

      function pickRoute(o) {
        var out = { action: o.action };
        if (o.agent !== undefined && o.agent !== null) out.agent = o.agent;
        if (o.provider !== undefined && o.provider !== null) out.provider = o.provider;
        if (o.authority !== undefined) out.authority = o.authority;
        if (o.reason !== undefined && o.reason !== null) out.reason = o.reason;
        if (o.resume_after !== undefined) out.resume_after = o.resume_after;
        return out;
      }

      if (result.action === 'route' || result.action === 'fallback') {
        var def = registry.getAgent(result.agent);
        var providerId = def ? def.provider : null;
        var providerImpl = providerId ? require('./executor').PROVIDERS[providerId] : null;
        if (!def || !providerImpl) {
          return send(res, 200, pickRoute({
            action: 'no_provider',
            reason: 'the routed agent\'s provider is not registered for execution in this executor'
          }));
        }
        if (requireAuthority && !def.execution_authority) {
          return send(res, 200, pickRoute({
            action: 'no_provider',
            reason: 'no candidate with execution authority is available for this profile/task_type'
          }));
        }
        return send(res, 200, pickRoute({
          action: result.action, agent: result.agent, provider: providerId,
          authority: def.execution_authority
        }));
      }

      // 'wait_for_quota' or 'no_provider': passed through field-picked,
      // exactly as the router decided — never silently retried or widened
      // to a provider the router itself refused.
      return send(res, 200, pickRoute(result));
    }).catch(function (err) {
      send(res, 400, { error: redact.redact(err.message) });
    });
  }

  // --- Orchestration Core goal surface (Core Wiring stage) -----------------
  // Gated by MYTHOS_CORE_ENABLED (default false). The core module is
  // lazy-required INSIDE these handlers, so with the flag off nothing
  // core-related is even loaded and the Phase 1 surface is unchanged.
  if (url === '/goals' || /^\/goals\//.test(url)) {
    var core;
    try {
      core = require('./core/core-wiring');
    } catch (e) {
      return send(res, 500, { error: 'core unavailable: ' + redact.redact(e.message) });
    }
    if (!core.coreEnabled()) {
      return send(res, 503, {
        error: 'core disabled',
        detail: 'MYTHOS_CORE_ENABLED is not true; the orchestration core is off by default'
      });
    }

    if (req.method === 'POST' && url === '/goals') {
      return readBody(req).then(function (body) {
        var payload = JSON.parse(body || '{}');
        var created = core.submitGoal(payload);
        send(res, 201, created);
      }).catch(function (err) {
        var code = err.code === 'GOAL_INVALID' || err.code === 'GOAL_REJECTED' ? 400 : 500;
        send(res, code, { error: redact.redact(err.message) });
      });
    }

    if (req.method === 'GET' && url === '/goals') {
      return send(res, 200, { goals: core.listGoals(25), mission_kinds: Object.keys(core.MISSION_KINDS) });
    }

    var gm;
    if ((gm = /^\/goals\/(g-[a-z0-9-]{8,40})$/.exec(url)) && req.method === 'GET') {
      var st = core.goalStatus(gm[1]);
      return st ? send(res, 200, st) : send(res, 404, { error: 'no such goal' });
    }

    if ((gm = /^\/goals\/(g-[a-z0-9-]{8,40})\/advance$/.exec(url)) && req.method === 'POST') {
      var status = core.goalStatus(gm[1]);
      if (!status) return send(res, 404, { error: 'no such goal' });
      if (!status.missions.length) return send(res, 409, { error: 'goal has no mission' });
      var missionId = status.missions[0].id;
      // Fire-and-accept: the mission continues after this response; its
      // state is durable, so the caller polls GET /goals/<id>.
      core.advanceMission(missionId).catch(function (err) {
        try {
          require('./core/store').appendEventLine({
            event_type: 'MISSION_FAILED', subject_id: missionId,
            detail: { advance_error: redact.redact(String(err && err.message)) }
          });
        } catch (e) { /* never let telemetry break the response */ }
      });
      return send(res, 202, { goal_id: gm[1], mission_id: missionId, accepted: true });
    }

    if ((gm = /^\/goals\/(g-[a-z0-9-]{8,40})\/cancel$/.exec(url)) && req.method === 'POST') {
      var cstatus = core.goalStatus(gm[1]);
      if (!cstatus) return send(res, 404, { error: 'no such goal' });
      if (!cstatus.missions.length) return send(res, 409, { error: 'goal has no mission' });
      try {
        return send(res, 200, core.cancelMission(cstatus.missions[0].id, 'cancelled via API'));
      } catch (err) {
        return send(res, 409, { error: redact.redact(err.message) });
      }
    }

    if ((gm = /^\/goals\/(g-[a-z0-9-]{8,40})\/report$/.exec(url)) && req.method === 'GET') {
      var rstatus = core.goalStatus(gm[1]);
      if (!rstatus || !rstatus.missions.length) return send(res, 404, { error: 'no such goal' });
      var rep = core.missionReport(rstatus.missions[0].id);
      return rep && rep.report ? send(res, 200, rep) : send(res, 404, { error: 'no report yet' });
    }

    return send(res, 404, { error: 'not found' });
  }

  // --- Campaign surface (n8n MVP bridge) -----------------------------------
  // The long-running half of the API: submit a goal, observe, continue.
  // Same gate as /goals — the core module is lazy-required inside, so with
  // MYTHOS_CORE_ENABLED off nothing here loads. Every decision lives in
  // core/campaign-service.js; these handlers only translate HTTP to it, so
  // n8n cannot become a second policy engine by calling them differently.
  if (url === '/campaigns' || /^\/campaigns\//.test(url)) {
    var svc, cw;
    try {
      svc = require('./core/campaign-service');
      cw = require('./core/core-wiring');
    } catch (e) {
      return send(res, 500, { error: 'core unavailable: ' + redact.redact(e.message) });
    }
    if (!cw.coreEnabled()) {
      return send(res, 503, { error: 'core disabled', detail: 'MYTHOS_CORE_ENABLED is not true' });
    }

    if (req.method === 'POST' && url === '/campaigns') {
      return readBody(req).then(function (body) {
        var payload = JSON.parse(body || '{}');
        // Only objective/project/requested_by are read. Provider, profile,
        // permission mode, repo path and capability are NOT accepted from
        // the caller — they are configuration and policy, not input.
        // MOS-v2 M-09: require_plan_approval is the ONE new field read
        // here, and it is read as a strict boolean identity — an absent,
        // null, string or truthy-but-not-true value is not a request for
        // it, so no existing caller's payload can acquire the behaviour by
        // accident. It can only ever make the campaign MORE restrictive
        // (parked for a human before anything runs), never less, which is
        // why it is safe to accept from an already-authenticated caller.
        // The console relay always sends true.
        //
        // MOS-v2 M-10: `decompose` is read the same way, by identity, and
        // selects only WHERE THE PROPOSED PLAN COMES FROM — a planner
        // model instead of the roadmap template. It selects no provider,
        // no profile, no model and no path, it is legal only together
        // with require_plan_approval (the service refuses it otherwise),
        // and the plan it produces is still schema-, policy- and
        // DAG-validated and still parked for a human before anything
        // runs. submitGoal answers a decomposing caller with a Promise,
        // so the response is awaited here; for every other caller
        // Promise.resolve passes the same object straight through.
        var out = svc.submitGoal({
          objective: payload.objective,
          project: payload.project,
          requested_by: payload.requested_by || 'n8n',
          require_plan_approval: payload.require_plan_approval === true,
          decompose: payload.decompose === true
        });
        return Promise.resolve(out).then(function (result) {
          send(res, result.created ? 201 : 200, result);
        });
      }).catch(function (err) {
        send(res, 400, { error: redact.redact(err.message) });
      });
    }

    if (req.method === 'GET' && url === '/campaigns') {
      var camp = require('./core/campaign');
      return send(res, 200, {
        campaigns: camp.listCampaigns().slice(0, 25).map(function (c) {
          return {
            campaign_id: c.campaign_id, project: c.project, state: c.state,
            objective: String(c.objective || '').slice(0, 160),
            completed: (c.completed_missions || []).length,
            updated_at: c.updated_at
          };
        })
      });
    }

    var cm2;
    if ((cm2 = /^\/campaigns\/(c-[a-z0-9-]{8,40})$/.exec(url)) && req.method === 'GET') {
      var d = svc.describe(cm2[1]);
      return d ? send(res, 200, d) : send(res, 404, { error: 'no such campaign' });
    }

    if ((cm2 = /^\/campaigns\/(c-[a-z0-9-]{8,40})\/continue$/.exec(url)) && req.method === 'POST') {
      return readBody(req).then(function (body) {
        var payload = {};
        try { payload = JSON.parse(body || '{}'); } catch (e) { payload = {}; }
        var out = svc.continueCampaign(cm2[1], {
          max_steps: payload.max_steps,
          requested_by: payload.requested_by || 'n8n'
        });
        // The promise is the in-process handle; it must never be serialised
        // into the response body.
        var promise = out.promise;
        delete out.promise;
        if (promise) {
          promise.catch(function () { /* recorded as an event by the service */ });
        }
        if (out.accepted) return send(res, 202, out);
        var code = out.code === 'NOT_FOUND' ? 404
          : out.code === 'ALREADY_RUNNING' ? 409
            : out.code === 'NEEDS_HUMAN' ? 409 : 409;
        send(res, code, out);
      }).catch(function (err) {
        send(res, 500, { error: redact.redact(err.message) });
      });
    }

    // MOS-v2 M-09: the way OUT of WAITING_FOR_APPROVAL.
    //
    // Before this route the gate was a one-way door: the loop could enter
    // WAITING_FOR_APPROVAL and continueCampaign correctly refused to leave
    // it, but the only supported exit was hand-editing persisted JSON on
    // the host — exactly the untracked state surgery the approval
    // mechanism exists to prevent. This does not weaken the gate: it calls
    // core/campaign.js's own resolveApproval, which demands an explicit
    // boolean decision AND a recorded decider, decides the durable
    // policy-engine approval entity first, writes the audit trail, and
    // treats DENY as the conservative direction. Nothing here decides
    // anything; it translates HTTP into that one function.
    if ((cm2 = /^\/campaigns\/(c-[a-z0-9-]{8,40})\/approvals\/resolve$/.exec(url)) && req.method === 'POST') {
      return readBody(req).then(function (body) {
        var payload = {};
        try { payload = JSON.parse(body || '{}'); } catch (e) { payload = {}; }
        var camp2 = require('./core/campaign');
        // Only the four decision fields are read, and the outstanding
        // approval is addressed by its own id and by nothing else.
        // resolveApproval also matches on capability_key and mission_id,
        // and this route deliberately does NOT expose either: a capability
        // key in a campaign payload is the one shape that could look like
        // a caller choosing what runs, and the n8n bridge's authority test
        // pins the whole campaign surface against reading one. An
        // approval_id names a decision that already exists; it selects no
        // work, no provider and no path.
        var out = camp2.resolveApproval(cm2[1], {
          approval_id: payload.approval_id,
          granted: payload.granted,
          decided_by: payload.decided_by,
          note: payload.note
        });
        send(res, 200, out);
      }).catch(function (err) {
        var msg = String((err && err.message) || err);
        if (/NO_SUCH_CAMPAIGN|INVALID_CAMPAIGN_ID/.test(msg)) {
          return send(res, 404, { error: 'no such campaign' });
        }
        if (/NO_MATCHING_APPROVAL|NO_SUCH_APPROVAL/.test(msg)) {
          return send(res, 404, { error: 'no matching approval on this campaign' });
        }
        if (/APPROVAL_NEEDS_DECIDER|APPROVAL_NEEDS_EXPLICIT_DECISION/.test(msg)) {
          return send(res, 400, { error: redact.redact(msg) });
        }
        send(res, 409, { error: redact.redact(msg) });
      });
    }

    if ((cm2 = /^\/campaigns\/(c-[a-z0-9-]{8,40})\/report$/.exec(url)) && req.method === 'GET') {
      var rep = svc.describe(cm2[1]);
      if (!rep) return send(res, 404, { error: 'no such campaign' });
      return send(res, 200, {
        campaign_id: rep.campaign_id, state: rep.state,
        needs_human: rep.needs_human, running: rep.running,
        completed_missions: rep.completed_missions,
        blocked_missions: rep.blocked_missions,
        approval_required: rep.approval_required,
        current_mission: rep.current_mission
      });
    }

    return send(res, 404, { error: 'not found' });
  }

  // Cursor-based event feed for the n8n bridge. Read-only.
  if (req.method === 'GET' && url === '/events') {
    var esvc;
    try {
      esvc = require('./core/campaign-service');
    } catch (e) {
      return send(res, 500, { error: 'core unavailable' });
    }
    // after_seq is the lossless cursor; since= is only for a first poll.
    return send(res, 200, esvc.eventsSince(query.since || null, query.limit, query.after_seq));
  }

  // Read-only budget inspection. No mutation route exists: limits change
  // only through a reviewed commit to config/budgets.json.
  if (req.method === 'GET' && /^\/budget(\/|$)/.test(url)) {
    var budget = require('./core/budget');
    var bm = /^\/budget\/([a-z0-9][a-z0-9-]{1,63})(\/history|\/reservations)?$/.exec(url);
    if (!bm) return send(res, 404, { error: 'usage: GET /budget/<project>[/history|/reservations]' });
    try {
      if (bm[2] === '/history') {
        return send(res, 200, { project: bm[1], entries: budget.history(bm[1], {}) });
      }
      if (bm[2] === '/reservations') {
        var all = budget.reservations(bm[1], {});
        var byState = {};
        all.forEach(function (r) { byState[r.lease_state] = (byState[r.lease_state] || 0) + 1; });
        return send(res, 200, { project: bm[1], summary: byState, reservations: all });
      }
      return send(res, 200, budget.status(bm[1], {}));
    } catch (e) {
      return send(res, 400, { error: redact.redact(e.message) });
    }
  }

  if (req.method === 'POST' && url === '/events/n8n-error') {
    return readBody(req).then(function (body) {
      var entry = { ts: new Date().toISOString(), source: 'n8n', detail: redact.redact(body.slice(0, 2000)) };
      fs.mkdirSync(path.join(state.root(), 'logs'), { recursive: true });
      fs.appendFileSync(path.join(state.root(), 'logs', 'n8n-errors.log'), JSON.stringify(entry) + '\n');
      send(res, 200, { logged: true });
    }).catch(function () { send(res, 400, { error: 'bad body' }); });
  }

  send(res, 404, { error: 'not found' });
}

function start(opts) {
  opts = opts || {};
  var token = loadToken();
  if (!token) {
    console.error('WARNING: no MYTHOS_EXECUTOR_TOKEN provisioned (' + TOKEN_FILE + '); all authenticated endpoints will refuse');
  }
  var port = opts.port || DEFAULT_PORT;
  var binds = opts.binds || DEFAULT_BINDS;
  var servers = [];
  binds.forEach(function (addr) {
    addr = addr.trim();
    if (!addr) return;
    var srv = http.createServer(function (req, res) {
      try {
        var out = handler(req, res, token);
        if (out && out.catch) out.catch(function (err) { send(res, 500, { error: redact.redact(err.message) }); });
      } catch (err) {
        send(res, 500, { error: redact.redact(err.message) });
      }
    });
    srv.on('error', function (err) {
      // The Docker bridge address may not exist on a dev machine — log and
      // keep the loopback listener alive rather than dying.
      console.error('listen failed on ' + addr + ': ' + err.code);
    });
    srv.listen(port, addr, function () {
      console.log(JSON.stringify({ ts: new Date().toISOString(), listening: addr + ':' + port }));
    });
    servers.push(srv);
  });
  return servers;
}

module.exports = { start: start, loadToken: loadToken, handler: handler, DEFAULT_PORT: DEFAULT_PORT };
