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
//   POST /tasks/<id>/cancel         cooperative cancel (SIGTERM if running)
//   POST /events/n8n-error          n8n failure-handler sink (logged, notified)
//   POST /campaigns                 submit a goal (returns the LIVE campaign
//                                   for the project if one exists — a second
//                                   campaign is never created alongside it)
//   GET  /campaigns                 list campaign summaries
//   GET  /campaigns/<id>            state, missions, current tasks, worktrees
//   POST /campaigns/<id>/continue   single-flight continuation; refuses
//                                   WAITING_FOR_APPROVAL and BLOCKED
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
        var out = svc.submitGoal({
          objective: payload.objective,
          project: payload.project,
          requested_by: payload.requested_by || 'n8n'
        });
        send(res, out.created ? 201 : 200, out);
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
