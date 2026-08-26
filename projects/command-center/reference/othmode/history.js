'use strict';
// =====================================================
// OTHMODE — unified Command History read model
// projects/command-center/reference/othmode/history.js
//
// ONE timeline over THREE existing sources; no fourth event store:
//   library      — mcc_usage_events (this application's own database)
//   executor     — /home/ubuntu/mythos-ai-executor/tasks/*/status.json
//   orchestrator — /home/deploy/mythos-orchestrator/tasks/*/status.json
//
// The sources keep writing their own stores; this module only reads and
// merges. File sources fail SOFT: on a host without executor state the
// response says so instead of pretending the history is complete.
// Unified row: { source, command, timestamp, duration_ms, status, result,
//                evidence, next_action, project }
// =====================================================

var path = require('path');
var resolve = require('./resolve.js');

// db is injected (the api layer passes the real pool; tests pass a stub)
// so this module never creates its own database dependency.
async function libraryRows(db, limit) {
  try {
    var result = await db.query(
      'SELECT e.event_type, e.occurred_at, c.slug, c.title, p.slug AS project_slug ' +
      'FROM mcc_usage_events e JOIN mcc_commands c ON c.id = e.command_id ' +
      'LEFT JOIN mcc_projects p ON p.id = c.project_id ' +
      'ORDER BY e.occurred_at DESC LIMIT $1', [limit]
    );
    return {
      available: true,
      rows: result.rows.map(function (r) {
        return {
          source: 'library',
          command: r.title,
          command_ref: r.slug,
          timestamp: r.occurred_at instanceof Date ? r.occurred_at.toISOString() : r.occurred_at,
          duration_ms: null,
          status: r.event_type,            // COPY / OPEN / USE / CUSTOMIZE
          result: null,
          evidence: 'mcc_usage_events',
          next_action: null,
          project: r.project_slug || null
        };
      })
    };
  } catch (e) {
    return { available: false, reason: 'database unavailable', rows: [] };
  }
}

function taskRows(dir, source, limit) {
  var ids = resolve.listDirs(dir);
  if (!ids.length) {
    return { available: resolve.exists(dir), reason: resolve.exists(dir) ? null : 'runtime state absent on this host (' + dir + ')', rows: [] };
  }
  var rows = [];
  ids.forEach(function (id) {
    var status = resolve.readJson(path.join(dir, id, 'status.json'));
    if (!status.ok) return;
    var s = status.data;
    var started = s.started_at || s.created_at || null;
    var ended = s.ended_at || s.completed_at || s.updated_at || null;
    var duration = null;
    if (started && ended) {
      var d = Date.parse(ended) - Date.parse(started);
      if (!isNaN(d) && d >= 0) duration = d;
    }
    var task = resolve.readJson(path.join(dir, id, 'task.json'));
    rows.push({
      source: source,
      command: (task.ok && (task.data.title || task.data.summary || task.data.type)) || id,
      command_ref: id,
      timestamp: ended || started || null,
      duration_ms: duration,
      status: s.state || s.status || 'UNKNOWN',
      result: s.result_summary || s.reason || null,
      evidence: path.join(dir, id),
      next_action: s.next_action || (s.state === 'WAITING_FOR_QUOTA' ? 'auto-resume when the quota window reopens' : null),
      project: (task.ok && task.data.project) || null
    });
  });
  rows.sort(function (a, b) { return String(b.timestamp || '') < String(a.timestamp || '') ? -1 : 1; });
  return { available: true, reason: null, rows: rows.slice(0, limit) };
}

async function unified(db, options) {
  var opts = options || {};
  var limit = Math.min(Math.max(parseInt(opts.limit || 50, 10) || 50, 1), 200);
  var lib = await libraryRows(db, limit);
  var exec = taskRows(resolve.executorTasksDir(), 'executor', limit);
  var orch = taskRows(resolve.orchestratorTasksDir(), 'orchestrator', limit);

  var rows = lib.rows.concat(exec.rows).concat(orch.rows);

  if (opts.source) rows = rows.filter(function (r) { return r.source === opts.source; });
  if (opts.status) rows = rows.filter(function (r) { return String(r.status).toUpperCase() === String(opts.status).toUpperCase(); });
  if (opts.project) rows = rows.filter(function (r) { return r.project === opts.project; });
  if (opts.q) {
    var needle = String(opts.q).toLowerCase();
    rows = rows.filter(function (r) { return String(r.command).toLowerCase().indexOf(needle) !== -1; });
  }
  if (opts.since) rows = rows.filter(function (r) { return r.timestamp && r.timestamp >= opts.since; });

  rows.sort(function (a, b) { return String(b.timestamp || '') < String(a.timestamp || '') ? -1 : 1; });

  return {
    total: rows.length,
    limit: limit,
    rows: rows.slice(0, limit),
    sources: {
      library: lib.available ? 'loaded' : (lib.reason || 'unavailable'),
      executor: exec.available ? 'loaded' : (exec.reason || 'unavailable'),
      orchestrator: orch.available ? 'loaded' : (orch.reason || 'unavailable')
    }
  };
}

module.exports = { unified: unified, taskRows: taskRows };
