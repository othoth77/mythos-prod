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

function bullets(list, fallback) {
  list = (list || []).filter(function (s) { return String(s || '').trim(); });
  if (!list.length) return '- ' + fallback;
  return list.map(function (s) { return '- ' + String(s).replace(/\n+/g, ' ').trim(); }).join('\n');
}

function numbered(list, fallback) {
  list = (list || []).filter(function (s) { return String(s || '').trim(); });
  if (!list.length) return '1. ' + fallback;
  return list.map(function (s, i) { return (i + 1) + '. ' + String(s).replace(/\n+/g, ' ').trim(); }).join('\n');
}

// The Issue text the bridge's own parser reads (sections + trailer fields).
function renderIssue(task, exec, cfg) {
  var spec = task.spec;
  var lines = [
    '## Objective',
    String(spec.objective).trim(),
    '',
    '## Scope',
    bullets(spec.scope, 'as needed to meet the objective, inside this repository'),
    '',
    '## Constraints',
    bullets((spec.constraints || []).concat([
      'Supervised task: the MYTHOS supervisor verifies this report against the acceptance criteria below. Report exactly what you ran and observed; never claim a check you did not run.'
    ]), ''),
    '',
    '## Validation',
    numbered(spec.validation, 'State the evidence for every acceptance criterion in the report.'),
    '',
    '## Acceptance criteria',
    bullets(spec.acceptance_criteria, 'the objective is demonstrably met'),
    ''
  ];
  if (task.parent) {
    lines.push('Recovery for: #' + task.parent.issue_number + ' (supervisor task ' + task.parent.task_id + ')', '');
  }
  lines.push(
    'Action: ' + spec.action,
    'Priority: normal',
    'Timeout: ' + spec.timeout_seconds,
    'Model: ' + cfg.executor_model,
    '',
    supMarker({ task_id: task.task_id, execution_id: exec.execution_id, correlation_id: task.correlation_id })
  );
  var title = 'TASK: [supervised] ' + String(spec.title || spec.objective).replace(/\s+/g, ' ').trim();
  return { title: title.length > 120 ? title.slice(0, 119) + '…' : title, body: lines.join('\n') };
}

function create(gh, cfg) {
  var repo = cfg.repository;

  function comments(n) {
    return gh.listComments(repo, n).then(function (r) {
      if (!r.ok) return r;
      if (!Array.isArray(r.data)) return { ok: false, error: { code: 'GH_MALFORMED', detail: 'comments is not a list' } };
      return { ok: true, data: r.data };
    });
  }

  // Idempotent create: an Issue already carrying this execution_id is adopted,
  // so a response lost AFTER GitHub created the Issue never creates a second.
  function submitTask(task, exec) {
    if (exec.issue_number) return Promise.resolve({ ok: true, issue_number: exec.issue_number, adopted: true });
    return gh.recentTaskIssues(repo, cfg.task_label).then(function (found) {
      if (!found.ok) return found;
      var needle = 'execution_id=' + exec.execution_id + ' ';
      var hit = (found.data || []).filter(function (i) { return String(i.body || '').indexOf(needle) !== -1; })[0];
      if (hit) return { ok: true, issue_number: hit.number, url: hit.html_url, adopted: true };
      var issue = renderIssue(task, exec, cfg);
      return gh.createIssue(repo, issue.title, issue.body, [cfg.task_label, cfg.supervised_label]).then(function (r) {
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
    return comments(n).then(function (cm) {
      if (!cm.ok) return cm;
      if (cm.data.some(function (c) { return String(c.body || '').indexOf(mark) !== -1; })) return { ok: true, skipped: true };
      return gh.comment(repo, n, mark + '\n' + text).then(function (r) { return r.ok ? { ok: true, skipped: false } : r; });
    });
  }

  function closeIssue(n, reason) {
    return gh.getIssue(repo, n).then(function (iss) {
      if (iss.ok && iss.data && iss.data.state === 'closed') return { ok: true, already: true };
      return gh.close(repo, n, reason || 'completed');
    });
  }

  function label(n, labels) { return gh.addLabels(repo, n, labels); }

  return {
    submitTask: submitTask,
    rerunTask: rerunTask,
    getStatus: getStatus,
    getResult: getResult,
    cancelTask: cancelTask,
    postOnce: postOnce,
    closeIssue: closeIssue,
    label: label
  };
}

module.exports = {
  create: create,
  renderIssue: renderIssue,
  bridgeMarker: bridgeMarker,
  supMarker: supMarker,
  REPORT_STATUSES: REPORT_STATUSES
};
