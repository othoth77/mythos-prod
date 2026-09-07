'use strict';
// =====================================================
// OTHMODE — Work intake (OTHMODE → GitHub Issue)
// projects/command-center/reference/othmode/work.js
//
// The missing edge of the MYTHOS V1 loop. OTHMODE Tasks are a persistent
// operational RECORD of what already ran; they are not a queue and they
// dispatch nothing. The work queue is GitHub Issues — so "give MYTHOS a
// task" means: open an Issue the bridge will pick up.
//
//   OTHMODE  →  GitHub Issue (label `task`)  →  bridge  →  executor
//
// NO SECOND TASK ABSTRACTION. This module writes an Issue and returns its
// number and URL. It does not track state, does not poll, and does not
// mirror the Issue anywhere: the Issue IS the record, GitHub is the
// source of truth, and the bridge already reports status back onto it.
//
// The body is written in the EXACT contract bridge/action-resolution.js
// parses (`Action:` / `Lane:` / `Priority:` as scalar fields, plus the
// section headings the Issues adapter reads). It is built by a pure
// function so the contract is testable without a network call.
//
// SECURITY
//   - repository is chosen from a server-side ALLOWLIST, never free-form:
//     an authenticated OTHMODE user must not be able to open an Issue in
//     an arbitrary repository under the account's token.
//   - `action` is one of the five closed actions; anything else refused.
//     The action decides the execution profile server-side, so accepting
//     an unknown one would hand a task an unmapped profile.
//   - the token is read from a file path given by the environment and is
//     NEVER logged, echoed, returned, or written into the Issue.
//   - the caller's payload is secret-scanned by the routes layer before
//     it reaches here, exactly like every other OTHMODE write.
// =====================================================

var fs = require('fs');
var https = require('https');

// Closed vocabularies, mirroring bridge/action-resolution.js. Kept here
// as a literal rather than imported: command-center must not depend on
// the executor tree, and a drift is caught by the test that compares them.
var ACTIONS = ['investigate', 'review', 'test', 'document', 'implement'];
var PRIORITIES = ['low', 'normal', 'high'];

var LANE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
var REPO_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;

var LIMITS = { title: 200, objective: 8000, context: 8000, acceptance: 4000, constraints: 4000 };

function vErr(msg) { var e = new Error(msg); e.code = 'OTHMODE_WORK_INPUT'; return e; }
function cErr(msg) { var e = new Error(msg); e.code = 'OTHMODE_WORK_CONFIG'; return e; }

// Server-side configuration. Absent or malformed → the intake is
// disabled and says so; it never falls back to a default repository.
function config(env) {
  var e = env || process.env;
  var repos = String(e.MYTHOS_WORK_REPOS || '')
    .split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  var bad = repos.filter(function (r) { return !REPO_RE.test(r); });
  return {
    enabled: repos.length > 0 && bad.length === 0 && !!e.MYTHOS_WORK_TOKEN_FILE,
    repos: repos,
    invalidRepos: bad,
    tokenFile: e.MYTHOS_WORK_TOKEN_FILE || null,
    label: e.MYTHOS_WORK_LABEL || 'task',
    apiHost: e.MYTHOS_WORK_API_HOST || 'api.github.com'
  };
}

function disabledReason(cfg) {
  if (cfg.invalidRepos.length) return 'MYTHOS_WORK_REPOS contains an invalid entry: ' + cfg.invalidRepos.join(', ');
  if (!cfg.repos.length) return 'MYTHOS_WORK_REPOS is not set — no repository is allowed';
  if (!cfg.tokenFile) return 'MYTHOS_WORK_TOKEN_FILE is not set';
  return 'work intake is disabled';
}

function readToken(cfg) {
  var raw;
  try { raw = fs.readFileSync(cfg.tokenFile, 'utf8'); }
  catch (e) { throw cErr('the work-intake token file is unreadable'); }
  // Accept either a bare token or KEY=value lines, same as the bridge.
  var text = String(raw).trim();
  var m = /^[A-Z0-9_]+=(.+)$/m.exec(text);
  var token = (m ? m[1] : text).trim().replace(/^["']|["']$/g, '');
  if (!token) throw cErr('the work-intake token file is empty');
  return token;
}

function str(value, label, max) {
  if (typeof value !== 'string' || value.trim() === '') throw vErr(label + ' is required');
  var v = value.trim();
  if (v.length > max) throw vErr(label + ' exceeds ' + max + ' characters');
  return v;
}
function optStr(value, label, max) {
  if (value === undefined || value === null || value === '') return null;
  return str(value, label, max);
}
function list(value, label, max) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw vErr(label + ' must be an array of strings');
  return value.map(function (x, i) { return str(x, label + '[' + i + ']', max); });
}

// Validates and normalises the request. Pure.
function normalize(input, cfg) {
  var i = input || {};
  var repo = str(i.repository, 'repository', 140);
  if (cfg.repos.indexOf(repo) === -1) {
    throw vErr('repository "' + repo + '" is not in the allowed list (' + cfg.repos.join(', ') + ')');
  }
  var action = String(i.action || '').trim().toLowerCase();
  if (ACTIONS.indexOf(action) === -1) {
    throw vErr('action must be one of: ' + ACTIONS.join(', '));
  }
  var priority = i.priority === undefined || i.priority === null || i.priority === ''
    ? 'normal' : String(i.priority).trim().toLowerCase();
  if (PRIORITIES.indexOf(priority) === -1) {
    throw vErr('priority must be one of: ' + PRIORITIES.join(', '));
  }
  var lane = optStr(i.lane, 'lane', 64);
  if (lane && !LANE_RE.test(lane)) throw vErr('lane "' + lane + '" is not a valid lane name');

  return {
    repository: repo,
    title: str(i.title, 'title', LIMITS.title),
    objective: str(i.objective, 'objective', LIMITS.objective),
    action: action,
    priority: priority,
    lane: lane,
    context: optStr(i.context, 'context', LIMITS.context),
    acceptance: list(i.acceptance, 'acceptance', LIMITS.acceptance),
    constraints: list(i.constraints, 'constraints', LIMITS.constraints)
  };
}

// Builds the Issue body in the exact contract the bridge parses. Pure —
// the contract is asserted by tests without touching the network.
function buildIssueBody(task, actor) {
  var out = [];
  out.push('<!-- Created from OTHMODE. GitHub is the source of truth for this work. -->');
  out.push('');
  out.push('## Objective');
  out.push('');
  out.push(task.objective);
  out.push('');
  // Scalar fields the bridge reads. `Action:` decides the execution
  // profile server-side; `Lane:` decides which implementer CLI runs it.
  out.push('## Task');
  out.push('');
  out.push('| Key | Value |');
  out.push('| --- | --- |');
  out.push('| Action | ' + task.action + ' |');
  out.push('| Priority | ' + task.priority + ' |');
  if (task.lane) out.push('| Lane | ' + task.lane + ' |');
  out.push('');
  if (task.context) {
    out.push('## Context');
    out.push('');
    out.push(task.context);
    out.push('');
  }
  if (task.acceptance.length) {
    out.push('## Acceptance criteria');
    out.push('');
    task.acceptance.forEach(function (a) { out.push('- ' + a); });
    out.push('');
  }
  if (task.constraints.length) {
    out.push('## Constraints');
    out.push('');
    task.constraints.forEach(function (c) { out.push('- ' + c); });
    out.push('');
  }
  out.push('---');
  out.push('');
  out.push('Requested from OTHMODE by `' + (actor || 'unknown') + '`. ' +
    'The MYTHOS bridge picks this up while the Issue is open and labelled ' +
    '`task`, and reports status back here.');
  return out.join('\n');
}

function request(cfg, token, method, pathname, payload) {
  return new Promise(function (resolve, reject) {
    var data = payload ? JSON.stringify(payload) : null;
    var req = https.request({
      host: cfg.apiHost,
      path: pathname,
      method: method,
      headers: {
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'mythos-othmode-work',
        'Content-Type': 'application/json',
        'Content-Length': data ? Buffer.byteLength(data) : 0
      }
    }, function (res) {
      var body = '';
      res.on('data', function (d) { body += d; });
      res.on('end', function () {
        var parsed = null;
        try { parsed = JSON.parse(body); } catch (e) { parsed = null; }
        resolve({ status: res.statusCode, body: parsed, raw: body });
      });
    });
    req.on('error', function (e) { reject(new Error('github request failed: ' + e.message)); });
    if (data) req.write(data);
    req.end();
  });
}

// Opens the Issue. Returns only what OTHMODE should show: the number, the
// URL and what was decided. Never returns the token or the raw response.
function createWork(input, actor, env) {
  var cfg = config(env);
  if (!cfg.enabled) return Promise.reject(cErr(disabledReason(cfg)));
  var task;
  try { task = normalize(input, cfg); }
  catch (e) { return Promise.reject(e); }

  var token;
  try { token = readToken(cfg); }
  catch (e) { return Promise.reject(e); }

  return request(cfg, token, 'POST', '/repos/' + task.repository + '/issues', {
    title: task.title,
    body: buildIssueBody(task, actor),
    labels: [cfg.label]
  }).then(function (res) {
    if (res.status === 401 || res.status === 403) {
      throw cErr('the work-intake token is not authorised to open an Issue on ' + task.repository);
    }
    if (res.status === 404) {
      throw cErr('repository ' + task.repository + ' is not reachable with the work-intake token');
    }
    if (res.status !== 201 || !res.body || !res.body.number) {
      var msg = (res.body && res.body.message) ? String(res.body.message) : ('HTTP ' + res.status);
      throw cErr('GitHub refused the Issue: ' + msg);
    }
    return {
      issue_number: res.body.number,
      issue_url: res.body.html_url,
      repository: task.repository,
      title: task.title,
      action: task.action,
      priority: task.priority,
      lane: task.lane,
      label: cfg.label,
      queued: true,
      note: 'The Issue is the work record. The bridge picks it up on its next tick ' +
        '(about a minute) and reports status back onto the Issue.'
    };
  });
}

module.exports = {
  ACTIONS: ACTIONS,
  PRIORITIES: PRIORITIES,
  LIMITS: LIMITS,
  config: config,
  disabledReason: disabledReason,
  normalize: normalize,
  buildIssueBody: buildIssueBody,
  createWork: createWork
};
