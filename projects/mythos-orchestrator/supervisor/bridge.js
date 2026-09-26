'use strict';
// =====================================================
// MYTHOS supervisor — Bridge contract
// projects/mythos-orchestrator/supervisor/bridge.js
//
// The supervisor does NOT reimplement the bridge. It speaks to the EXISTING
// one through the channel it already serves: a GitHub Issue labelled `task`
// (docs/MYTHOS_GITHUB_ISSUES.md). The live bridge converts it into
// control/tasks/gh-issue-<n>.json, queues it for the executor (FABLE),
// comments its lifecycle on the Issue with `<!-- mythos-control … -->`
// markers, and writes control/reports/<id>.json on mythos/control.
//
//   submitTask(task, exec)   create the Issue (idempotent by execution_id marker)
//   rerunTask(task, exec)    request a new attempt of the same Issue (`rerun` label)
//   getStatus(exec)          SUBMITTED | QUEUED | CLAIMED | REPORTED | INVALID | LOST
//   getResult(exec)          the report JSON, strictly validated
//   cancelTask(exec)         close an unclaimed Issue; refuse a claimed one
//   postOnce(n, fields, txt) supervisor comment, never posted twice
//
// Every call returns { ok, ... } or { ok:false, error:{code,...} } — a lost,
// truncated or malformed answer is an explicit failure, never a success.
// =====================================================

var issuesParser = require('../../mythos-ai-executor/bridge/github-issues');
var advisor = require('../advisor');
var maskHashes = require('./brain').maskHashes;

var MARK_BRIDGE = /<!--\s*mythos-control\s+([^>]*?)\s*-->/;
var MARK_SUP_PREFIX = '<!-- mythos-supervisor ';
var REPORT_STATUSES = ['COMPLETED', 'FAILED', 'BLOCKED', 'CANCELLED'];

function parseFields(inner) {
  var out = {};
  String(inner || '').split(/\s+/).forEach(function (kv) {
    var i = kv.indexOf('=');
    if (i > 0) out[kv.slice(0, i)] = kv.slice(i + 1);
  });
  return out;
}

function bridgeMarker(body) {
  var m = MARK_BRIDGE.exec(String(body || ''));
  return m ? parseFields(m[1]) : null;
}

function supMarker(fields) {
  return MARK_SUP_PREFIX + Object.keys(fields).map(function (k) { return k + '=' + fields[k]; }).join(' ') + ' -->';
}

// ---------------------------------------------------------------------------
// Task integrity (review blocker 1)
//
// The Issue text is OpenAI output, and OpenAI reads untrusted report text. The
// bridge reads metadata (Action, Model, Timeout, Priority, Depends on, Max
// turns) from ANY line in ANY of its accepted forms, and section headings from
// any "#" line. So every text line is normalised first — hashes masked,
// leading "#" and bullet markers escaped, and any line the bridge's OWN field
// extractor recognises is defused — and then the rendered Issue is parsed by
// the REAL bridge parser and must match the supervisor-validated task field
// by field. Any mismatch refuses the Issue (TASK_INTEGRITY); nothing is sent.
// ---------------------------------------------------------------------------

// Caps at (or under) the bridge task schema's own limits, so a long item is
// trimmed HERE, consistently, instead of being rejected after creation:
// scope/validation items ≤300, constraints ≤1000 (bridge/README.md).
var OBJECTIVE_MAX = 6000;
var ITEM_MAX = { scope: 290, constraints: 900, validation: 290, acceptance: 290, title: 100 };

function isFieldLine(line) { return Object.keys(issuesParser.extractFields(String(line)) || {}).length > 0; }

// Would the bridge read this line as a SECTION boundary (a heading, or an
// inline form such as "Validation: …" / "**Scope:** …")? Asked of the real
// splitter: the line must stay plain objective text.
var PROBE = 'Plain placeholder objective line.';
function isStructuralLine(line) {
  var sec = issuesParser.splitSections('## Objective\n' + PROBE + '\n' + line);
  var others = Object.keys(sec).filter(function (k) { return k !== 'objective' && k !== '_preamble' && (sec[k] || []).length; });
  return others.length > 0 || !sec.objective || sec.objective.length !== 2 || sec.objective[1] !== String(line).trim();
}

function inert(s) { return !isFieldLine(s) && !isStructuralLine(s); }

// One line, made inert: never a heading or section switch, never a list
// marker the parser would re-strip differently, never a metadata field.
// null = could not be made inert (the Issue is then refused).
function neutralize(line) {
  var s = maskHashes(String(line == null ? '' : line)).replace(/\s+$/, '');
  if (!s.trim()) return '';
  s = s.replace(/^(\s*)#/, '$1\\#');
  for (var i = 0; i < 4 && !inert(s); i++) {
    s = s.replace(/[:：]/, ' —').replace(/^(\s*)\*\*/, '$1');
    if (i >= 1) s = '› ' + s;
  }
  return inert(s) ? s : null;
}

function cleanItem(item, max) {
  var s = String(item == null ? '' : item).replace(/\s+/g, ' ').trim();
  s = s.replace(/^(?:[-*+•]|\d+[.)])\s+/, '').trim();
  s = s ? neutralize(s) : '';
  if (s && s.length > max) s = s.slice(0, max - 1) + '…';
  return s;
}

// The exact parts that are rendered — the renderer and the integrity check
// share them, so "what we meant" and "what we wrote" cannot drift apart.
function issueParts(task, cfg) {
  var spec = task.spec;
  var problems = [];
  function items(list, fallback, field) {
    var out = [];
    (list || []).forEach(function (x) {
      var c = cleanItem(x, ITEM_MAX[field]);
      if (c === null) problems.push(field + ' item could not be made inert');
      else if (c) out.push(c);
    });
    return out.length ? out : [fallback];
  }
  var objLines = String(spec.objective || '').slice(0, OBJECTIVE_MAX).split(/\r?\n/).map(function (l) {
    var n = neutralize(l);
    if (n === null) problems.push('objective line could not be made inert');
    return n === null ? '' : n;
  });
  var objective = objLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  var titleText = cleanItem(spec.title || spec.objective, ITEM_MAX.title) || 'supervised task';
  return {
    problems: problems,
    title: titleText,
    objective: objective,
    scope: items(spec.scope, 'as needed to meet the objective, inside this repository', 'scope'),
    constraints: items(spec.constraints, 'none beyond the supervisor constraint', 'constraints').concat([
      'Supervised task: the MYTHOS supervisor verifies this report against the acceptance criteria below. Report exactly what you ran and observed; never claim a check you did not run.'
    ]),
    validation: items(spec.validation, 'State the evidence for every acceptance criterion in the report.', 'validation'),
    acceptance: items(spec.acceptance_criteria, 'the objective is demonstrably met', 'acceptance'),
    action: spec.action,
    timeout: spec.timeout_seconds
  };
}

// opts.model: undefined → the executor model (FABLE); null → no Model line
// (a Qwen consult on Haddad, whose bridge only runs the local model).
function modelFor(cfg, opts) { return opts && Object.prototype.hasOwnProperty.call(opts, 'model') ? opts.model : cfg.executor_model; }

function renderFromParts(parts, task, exec, cfg, opts) {
  var model = modelFor(cfg, opts);
  var lines = [
    supMarker({ task_id: task.task_id, execution_id: exec.execution_id, correlation_id: task.correlation_id })
  ];
  if (task.parent) lines.push('Recovery for #' + task.parent.issue_number + ' (supervisor task ' + task.parent.task_id + ')');
  lines.push(
    '',
    '## Objective', parts.objective, '',
    '## Scope', parts.scope.map(function (x) { return '- ' + x; }).join('\n'), '',
    '## Constraints', parts.constraints.map(function (x) { return '- ' + x; }).join('\n'), '',
    '## Validation', parts.validation.map(function (x, i) { return (i + 1) + '. ' + x; }).join('\n'), '',
    '## Acceptance criteria', parts.acceptance.map(function (x) { return '- ' + x; }).join('\n'), '',
    'Action: ' + parts.action,
    'Priority: normal',
    'Timeout: ' + parts.timeout
  );
  if (model) lines.push('Model: ' + model);
  var title = (opts && opts.titlePrefix ? opts.titlePrefix : 'TASK: [supervised] ') + parts.title;
  return { title: title.length > 120 ? title.slice(0, 119) + '…' : title, body: lines.join('\n') };
}

// What the bridge must read back, from a FIXED reference trailer only —
// never from model-authored text.
var referenceCache = {};
function reference(cfg, action, timeout, model) {
  var key = action + '|' + timeout + '|' + model;
  if (referenceCache[key]) return referenceCache[key];
  var body = ['## Objective', 'Reference task used only to derive expected bridge metadata.', '',
    'Action: ' + action, 'Priority: normal', 'Timeout: ' + timeout].concat(model ? ['Model: ' + model] : []).join('\n');
  var r = issuesParser.issueToTask(issuesParser.config(), { number: 1, title: 'TASK: reference', body: body, html_url: 'https://github.com/' + cfg.repository + '/issues/1', labels: [{ name: cfg.task_label }] }, 1);
  referenceCache[key] = r.task ? { action: r.task.requested_action, model: r.task.model, timeout: r.task.timeout_seconds, priority: r.task.priority, max_turns: r.task.max_turns === undefined ? null : r.task.max_turns } : null;
  return referenceCache[key];
}

function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

// Parse `issue` with the REAL bridge parser and compare with `parts`.
function checkIntegrity(issue, parts, cfg, opts) {
  var ref = reference(cfg, parts.action, parts.timeout, modelFor(cfg, opts));
  if (!ref) return ['REFERENCE_UNPARSEABLE: the fixed trailer did not parse'];
  // Parsed twice under two different sentinel Issue numbers: the parser drops
  // a self-dependency, so an injected "Depends on: #N" could hide behind the
  // number used for the check — it cannot equal both sentinels.
  function parseAs(n) {
    return issuesParser.issueToTask(issuesParser.config(), { number: n, title: issue.title, body: issue.body, html_url: 'https://github.com/' + cfg.repository + '/issues/' + n, labels: [{ name: cfg.task_label }] }, 1);
  }
  var r = parseAs(999999991);
  var r2 = parseAs(999999992);
  if (!r.task || !r2.task) return ['BRIDGE_REJECTS: ' + ((r.errors || []).concat(r2.errors || [])).join('; ').slice(0, 300)];
  var t = r.task;
  var m = [];
  if ((r2.task.depends_on || []).length) m.push('depends_on injected: ' + JSON.stringify(r2.task.depends_on));
  if (t.requested_action !== parts.action || t.requested_action !== ref.action) m.push('action ' + t.requested_action + ' != ' + parts.action);
  if (t.model !== ref.model) m.push('model ' + t.model + ' != ' + ref.model);
  if (t.timeout_seconds !== ref.timeout) m.push('timeout ' + t.timeout_seconds + ' != ' + ref.timeout);
  if (t.priority !== ref.priority) m.push('priority ' + t.priority + ' != ' + ref.priority);
  if ((t.max_turns === undefined ? null : t.max_turns) !== ref.max_turns) m.push('max_turns injected');
  if ((t.depends_on || []).length) m.push('depends_on injected: ' + JSON.stringify(t.depends_on));
  if (String(t.objective).trim() !== parts.objective) m.push('objective altered by the parser');
  if (!same(t.scope, parts.scope)) m.push('scope differs');
  if (!same(t.constraints, parts.constraints)) m.push('constraints differ');
  if (!same(t.validation_requirements, parts.validation.concat(parts.acceptance))) m.push('validation/acceptance differ');
  return m;
}

// Outbound secret gate (review blocker 2): the same classifier the advisor
// uses for OpenAI prompts, run on the RAW text — before any masking — so a
// credential is REFUSED, never quietly transformed and posted. Kinds only.
function outboundSecretKinds(text) { return advisor.advisorSecretKinds(String(text || '')); }

function specText(spec) {
  return [spec.title, spec.objective].concat(spec.scope || [], spec.constraints || [], spec.validation || [], spec.acceptance_criteria || [])
    .map(function (x) { return String(x == null ? '' : x); }).join('\n');
}

// Render + integrity + secret gate. { ok, issue } or { ok:false, error }.
// `hooks.render` exists ONLY so tests can prove the round-trip check refuses
// a renderer that drifts from the validated parts; production never passes it.
function prepareIssue(task, exec, cfg, hooks, opts) {
  var rawKinds = outboundSecretKinds(specText(task.spec));
  if (rawKinds.length) return { ok: false, error: { code: 'OUTBOUND_SECRET', detail: 'task text matches ' + rawKinds.join(', ') + ' — refused before GitHub' } };
  var parts = issueParts(task, cfg);
  if (parts.problems.length) return { ok: false, error: { code: 'TASK_INTEGRITY', detail: parts.problems.join('; ') } };
  var issue = (hooks && hooks.render ? hooks.render : renderFromParts)(parts, task, exec, cfg, opts);
  var mismatch = checkIntegrity(issue, parts, cfg, opts);
  if (mismatch.length) return { ok: false, error: { code: 'TASK_INTEGRITY', detail: mismatch.join('; ').slice(0, 500) } };
  var kinds = outboundSecretKinds(issue.title + '\n' + issue.body);
  if (kinds.length) return { ok: false, error: { code: 'OUTBOUND_SECRET', detail: 'Issue text matches ' + kinds.join(', ') + ' — refused before GitHub' } };
  return { ok: true, issue: issue, parts: parts };
}

// Kept for callers/tests that only need the text.
function renderIssue(task, exec, cfg, opts) { return renderFromParts(issueParts(task, cfg), task, exec, cfg, opts); }

// The first ```json fenced block, else the first balanced {...} object.
function extractJson(text) {
  var t = String(text || '');
  var fence = /```(?:json)?\s*\n([\s\S]*?)\n```/i.exec(t);
  var candidates = [];
  if (fence) candidates.push(fence[1]);
  var start = t.indexOf('{');
  while (start !== -1 && candidates.length < 4) {
    var depth = 0, inStr = false, esc = false;
    for (var i = start; i < t.length; i++) {
      var ch = t[i];
      if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) { candidates.push(t.slice(start, i + 1)); break; } }
    }
    start = t.indexOf('{', start + 1);
    if (candidates.length && !fence) break;
  }
  for (var k = 0; k < candidates.length; k++) {
    try { var o = JSON.parse(candidates[k]); if (o && typeof o === 'object' && !Array.isArray(o)) return o; } catch (e) { /* next */ }
  }
  return null;
}

function create(gh, cfg) {
  var repo = cfg.repository;

  // Bridge markers (claimed/report — and a Qwen consult's ANSWER, which only
  // exists as a comment) count only when posted by the identity the bridges
  // post as: anyone else able to comment cannot forge a report or a diagnosis.
  var authors = Array.isArray(cfg.bridge_comment_authors) ? cfg.bridge_comment_authors : [];
  function comments(n) {
    return gh.listComments(repo, n).then(function (r) {
      if (!r.ok) return r;
      if (!Array.isArray(r.data)) return { ok: false, error: { code: 'GH_MALFORMED', detail: 'comments is not a list' } };
      if (!authors.length) return { ok: false, error: { code: 'CONFIG_INVALID', detail: 'bridge_comment_authors is empty' } };
      return { ok: true, data: r.data.filter(function (c) { return c && c.user && authors.indexOf(c.user.login) !== -1; }) };
    });
  }

  // Idempotent create: an Issue already carrying this execution_id is adopted,
  // so a response lost AFTER GitHub created the Issue never creates a second.
  // opts (consults): { label, labels, model:null, titlePrefix }.
  function submitTask(task, exec, opts) {
    if (exec.issue_number) return Promise.resolve({ ok: true, issue_number: exec.issue_number, adopted: true });
    var prep = prepareIssue(task, exec, cfg, null, opts);
    if (!prep.ok) return Promise.resolve(prep); // TASK_INTEGRITY / OUTBOUND_SECRET: nothing reaches GitHub
    return gh.recentTaskIssues(repo, (opts && opts.label) || cfg.task_label).then(function (found) {
      if (!found.ok) return found;
      var needle = 'execution_id=' + exec.execution_id + ' ';
      var hit = (found.data || []).filter(function (i) { return String(i.body || '').indexOf(needle) !== -1; })[0];
      if (hit) return { ok: true, issue_number: hit.number, url: hit.html_url, adopted: true };
      var issue = prep.issue;
      return gh.createIssue(repo, issue.title, issue.body, (opts && opts.labels) || [cfg.task_label, cfg.supervised_label]).then(function (r) {
        if (!r.ok) return r;
        if (!r.data || typeof r.data.number !== 'number') return { ok: false, error: { code: 'GH_MALFORMED', detail: 'created issue has no number' } };
        return { ok: true, issue_number: r.data.number, url: r.data.html_url, adopted: false };
      });
    });
  }

  function rerunTask(task, exec) {
    return gh.addLabels(repo, exec.issue_number, [cfg.rerun_label]).then(function (r) {
      return r.ok ? { ok: true } : r;
    });
  }

  // Normalised view of one attempt. `exec.bridge_task_id` may still be null
  // for a rerun whose attempt the bridge has not created yet: the newest
  // `created` marker above `exec.min_attempt` is adopted.
  function getStatus(exec) {
    return gh.getIssue(repo, exec.issue_number).then(function (iss) {
      if (!iss.ok) {
        if (iss.error.code === 'GH_NOT_FOUND') return { ok: true, phase: 'LOST', detail: 'issue not found' };
        return iss;
      }
      return comments(exec.issue_number).then(function (cm) {
        if (!cm.ok) return cm;
        var marks = cm.data.map(function (c) {
          var m = bridgeMarker(c.body);
          return m ? Object.assign({ _at: c.created_at, _id: c.id }, m) : null;
        }).filter(Boolean);
        var bt = exec.bridge_task_id;
        if (!bt) {
          var re = new RegExp('^gh-issue-' + exec.issue_number + '(?:-r(\\d+))?$');
          marks.filter(function (m) { return m.event === 'created' && re.test(m.task_id || ''); }).forEach(function (m) {
            var a = re.exec(m.task_id)[1];
            var attempt = a ? parseInt(a, 10) : 1;
            if (attempt >= (exec.min_attempt || 1) && (!bt || attempt > bt.attempt)) bt = { id: m.task_id, attempt: attempt };
          });
          bt = bt ? bt.id : null;
        }
        var mine = marks.filter(function (m) { return bt && m.task_id === bt; });
        var report = mine.filter(function (m) { return m.event === 'report'; }).pop();
        var claimed = mine.filter(function (m) { return m.event === 'claimed'; }).pop();
        var created = mine.filter(function (m) { return m.event === 'created'; }).pop();
        var rejected = marks.filter(function (m) { return m.event === 'rejected'; }).pop();
        var deferred = marks.filter(function (m) { return m.event === 'rerun_deferred'; }).pop();
        var phase = report ? 'REPORTED' : claimed ? 'CLAIMED' : created ? 'QUEUED'
          : (rejected && !bt) ? 'INVALID' : 'SUBMITTED';
        return {
          ok: true,
          phase: phase,
          bridge_task_id: bt,
          report_marker_status: report ? report.status || null : null,
          issue_state: iss.data && iss.data.state,
          issue_labels: ((iss.data && iss.data.labels) || []).map(function (l) { return l.name; }),
          deferred: !!deferred,
          events: mine.map(function (m) { return { event: m.event, status: m.status || null, at: m._at }; })
        };
      });
    });
  }

  function getResult(exec) {
    if (!exec.bridge_task_id) return Promise.resolve({ ok: false, error: { code: 'NO_BRIDGE_TASK' } });
    return gh.controlFile(repo, cfg.control_branch, 'control/reports/' + exec.bridge_task_id + '.json').then(function (r) {
      if (!r.ok) {
        if (r.error.code === 'GH_NOT_FOUND') return { ok: false, error: { code: 'REPORT_NOT_YET', detail: 'the relay has not pushed the report yet' } };
        return r;
      }
      var report;
      try { report = JSON.parse(String(r.data || '')); } catch (e) {
        return { ok: false, error: { code: 'REPORT_UNPARSEABLE', detail: 'report is not complete JSON (' + String(r.data || '').length + ' bytes)' } };
      }
      if (!report || typeof report !== 'object' || report.task_id !== exec.bridge_task_id ||
          REPORT_STATUSES.indexOf(report.status) === -1) {
        return { ok: false, error: { code: 'REPORT_INVALID', detail: 'report task_id/status do not match the attempt' } };
      }
      return { ok: true, report: report };
    });
  }

  function cancelTask(exec, reason) {
    return getStatus(exec).then(function (st) {
      if (!st.ok) return st;
      if (st.phase === 'CLAIMED' || st.phase === 'REPORTED') {
        return { ok: true, cancelled: false, reason: 'attempt already ' + st.phase + '; a claimed attempt is owned by the bridge and runs to its report' };
      }
      return postOnce(exec.issue_number, { event: 'cancelled', execution_id: exec.execution_id }, 'Cancelled by the MYTHOS supervisor: ' + reason)
        .then(function () { return gh.close(repo, exec.issue_number, 'not_planned'); })
        .then(function (r) { return r.ok ? { ok: true, cancelled: true } : r; });
    });
  }

  // A supervisor comment, posted at most once per marker.
  function postOnce(n, fields, text) {
    var mark = supMarker(fields);
    var kinds = outboundSecretKinds(text);
    var body = maskHashes(String(text || ''));
    if (kinds.length) return Promise.resolve({ ok: false, error: { code: 'OUTBOUND_SECRET', detail: 'comment matches ' + kinds.join(', ') + ' — refused before GitHub' } });
    return comments(n).then(function (cm) {
      if (!cm.ok) return cm;
      if (cm.data.some(function (c) { return String(c.body || '').indexOf(mark) !== -1; })) return { ok: true, skipped: true };
      return gh.comment(repo, n, mark + '\n' + body).then(function (r) { return r.ok ? { ok: true, skipped: false } : r; });
    });
  }

  function closeIssue(n, reason) {
    return gh.getIssue(repo, n).then(function (iss) {
      if (iss.ok && iss.data && iss.data.state === 'closed') return { ok: true, already: true };
      return gh.close(repo, n, reason || 'completed');
    });
  }

  function label(n, labels) { return gh.addLabels(repo, n, labels); }

  // A consult (Qwen on Haddad) answers in its report comment: the structured
  // answer is the JSON object in that comment. Returns
  // { ok, phase: PENDING|ANSWERED|FAILED|LOST, status, answer }.
  function readConsult(exec) {
    return gh.getIssue(repo, exec.issue_number).then(function (iss) {
      if (!iss.ok) return iss.error.code === 'GH_NOT_FOUND' ? { ok: true, phase: 'LOST' } : iss;
      return comments(exec.issue_number).then(function (cm) {
        if (!cm.ok) return cm;
        var want = 'gh-issue-' + exec.issue_number;
        var rep = cm.data.filter(function (c) { var m = bridgeMarker(c.body); return m && m.event === 'report' && m.task_id === want; }).pop();
        var rejected = cm.data.some(function (c) { var m = bridgeMarker(c.body); return m && m.event === 'rejected'; });
        if (!rep) return { ok: true, phase: rejected ? 'FAILED' : 'PENDING', status: rejected ? 'REJECTED' : null };
        var status = bridgeMarker(rep.body).status || null;
        if (status !== 'COMPLETED') return { ok: true, phase: 'FAILED', status: status };
        return { ok: true, phase: 'ANSWERED', status: status, answer: extractJson(rep.body) };
      });
    });
  }

  // Review blocker 3: a write task is accepted only when GitHub itself shows
  // its commits on the expected task branch of the expected repository. The
  // report's own claims (git_verified, on_origin) are necessary, not
  // sufficient. Returns { ok, pending, problems, verified[] }: pending = not
  // pushed YET (the relay delivers every few minutes); problems = refused.
  function verifyDelivery(delivery, bridgeTaskId) {
    var expected = 'mythos/gh/' + bridgeTaskId;
    var problems = [];
    var d = delivery || {};
    var commits = d.commits || [];
    if (!commits.length) problems.push('the report lists no commit');
    if (d.git_verified !== true) problems.push('the bridge did not verify the commits in git (git_verified is not true)');
    if (d.delivery_branch && d.delivery_branch !== expected) problems.push('delivery branch ' + d.delivery_branch + ' is not ' + expected);
    commits.forEach(function (c) {
      if (!/^[0-9a-f]{40}$/.test(String(c.sha || ''))) problems.push('commit id is not a full SHA: ' + String(c.sha).slice(0, 50));
      if (c.branch && c.branch !== expected) problems.push('commit ' + String(c.sha).slice(0, 12) + ' is on ' + c.branch + ', not ' + expected);
    });
    if (problems.length) return Promise.resolve({ ok: false, pending: false, problems: problems });
    return gh.getBranch(repo, expected).then(function (br) {
      if (!br.ok) {
        if (br.error.code === 'GH_NOT_FOUND') return { ok: false, pending: true, problems: ['branch ' + expected + ' is not on GitHub yet'] };
        return { ok: false, pending: true, problems: ['branch lookup failed: ' + br.error.code] };
      }
      return commits.reduce(function (p, c) {
        return p.then(function (acc) {
          return gh.compare(repo, c.sha, expected).then(function (cmp) {
            if (!cmp.ok) {
              acc.pending = true;
              acc.problems.push('commit ' + c.sha.slice(0, 12) + ' is not on GitHub yet (' + cmp.error.code + ')');
            } else if (['identical', 'ahead'].indexOf(cmp.data && cmp.data.status) === -1) {
              acc.problems.push('commit ' + c.sha.slice(0, 12) + ' is not contained in ' + expected + ' (' + (cmp.data && cmp.data.status) + ')');
            } else {
              acc.verified.push(c.sha);
            }
            return acc;
          });
        });
      }, Promise.resolve({ pending: false, problems: [], verified: [] })).then(function (acc) {
        var refused = acc.problems.filter(function (x) { return !/not on GitHub yet/.test(x); });
        if (refused.length) return { ok: false, pending: false, problems: acc.problems, verified: acc.verified };
        if (acc.pending) return { ok: false, pending: true, problems: acc.problems, verified: acc.verified };
        return { ok: true, pending: false, problems: [], verified: acc.verified, branch: expected, head: br.data && br.data.commit ? br.data.commit.sha : null };
      });
    });
  }

  return {
    submitTask: submitTask,
    rerunTask: rerunTask,
    getStatus: getStatus,
    getResult: getResult,
    cancelTask: cancelTask,
    postOnce: postOnce,
    closeIssue: closeIssue,
    label: label,
    verifyDelivery: verifyDelivery,
    readConsult: readConsult
  };
}

module.exports = {
  create: create,
  renderIssue: renderIssue,
  extractJson: extractJson,
  prepareIssue: prepareIssue,
  checkIntegrity: checkIntegrity,
  issueParts: issueParts,
  neutralize: neutralize,
  outboundSecretKinds: outboundSecretKinds,
  bridgeMarker: bridgeMarker,
  supMarker: supMarker,
  REPORT_STATUSES: REPORT_STATUSES
};
