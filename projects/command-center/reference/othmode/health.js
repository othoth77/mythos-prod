'use strict';
// =====================================================
// OTHMODE — Health aggregation + recovery records
// projects/command-center/reference/othmode/health.js
//
// AGGREGATES existing sources — the status-center monitor's
// live-status.json, per-site health.json, the provider/tool registries,
// and the OTHMODE store's own state. It NEVER probes the network itself
// (the monitor owns probing) and it NEVER executes recovery: recovery
// actions belong to Mythos OS / the operator. OTHMODE tracks the recovery
// process as records: DETECT → NOTIFY → SEARCH → COMPARE → SELECT →
// REPLACE → TEST → UPDATE STATUS.
//
// States: ACTIVE DEGRADED FAILED BLOCKED DEPRECATED REPLACEMENT_REQUIRED.
// Monitor states map: LIVE→ACTIVE, DEGRADED→DEGRADED, DOWN→FAILED,
// NOT_MONITORED→BLOCKED (visible, not silently green).
// =====================================================

var path = require('path');
var resolve = require('./resolve.js');
var store = require('./store.js');
var registries = require('./registries.js');

var STATES = ['ACTIVE', 'DEGRADED', 'FAILED', 'BLOCKED', 'DEPRECATED', 'REPLACEMENT_REQUIRED'];
var RECOVERY_STEPS = ['DETECT', 'NOTIFY', 'SEARCH', 'COMPARE', 'SELECT', 'REPLACE', 'TEST', 'UPDATE_STATUS'];

var MONITOR_STATE_MAP = { LIVE: 'ACTIVE', DEGRADED: 'DEGRADED', DOWN: 'FAILED', NOT_MONITORED: 'BLOCKED' };

function vErr(msg) { var e = new Error(msg); e.code = 'OTHMODE_HEALTH_INPUT'; return e; }

function monitorComponents() {
  var res = resolve.readJson(path.join(resolve.statusDataDir(), 'live-status.json'));
  if (!res.ok) {
    return { available: false, reason: 'monitor output ' + res.reason + ' (' + res.file + ')', components: [] };
  }
  var checks = Array.isArray(res.data.checks) ? res.data.checks : [];
  return {
    available: true,
    generated_at: res.data.generated_at || null,
    components: checks.map(function (c) {
      return {
        id: 'monitor:' + c.id,
        kind: 'integration',
        name: c.name || c.id,
        state: MONITOR_STATE_MAP[c.state] || 'BLOCKED',
        detail: c.error || null,
        latency_ms: c.latency_ms === undefined ? null : c.latency_ms
      };
    })
  };
}

function providerComponents() {
  var p = registries.providers();
  return p.providers.map(function (prov) {
    var state;
    if (!prov.enabled) state = 'DEPRECATED';
    else if (prov.credential_present === false) state = 'BLOCKED';
    else state = 'ACTIVE';
    return {
      id: 'provider:' + prov.id, kind: 'provider', name: prov.id, state: state,
      detail: prov.credential_present === false ? 'credential absent' : (prov.note || null),
      latency_ms: null
    };
  });
}

function toolComponents() {
  var t = registries.tools();
  return t.tools.map(function (tool) {
    return { id: 'tool:' + tool.id, kind: 'tool', name: tool.id, state: 'ACTIVE', detail: null, latency_ms: null };
  });
}

function othmodeComponents() {
  var provisioned = store.provisioned();
  return [{
    id: 'othmode:evolution-store', kind: 'evolution', name: 'Evolution store',
    state: provisioned ? 'ACTIVE' : 'BLOCKED',
    detail: provisioned ? store.root() : 'not provisioned (fail-closed; a normal, reportable state)',
    latency_ms: null
  }];
}

function overview() {
  var monitor = monitorComponents();
  var components = monitor.components
    .concat(providerComponents())
    .concat(toolComponents())
    .concat(othmodeComponents());
  var counts = {};
  STATES.forEach(function (s) { counts[s] = 0; });
  components.forEach(function (c) { counts[c.state] = (counts[c.state] || 0) + 1; });
  return {
    states: STATES,
    counts: counts,
    total: components.length,
    components: components,
    monitor: { available: monitor.available, reason: monitor.reason || null, generated_at: monitor.generated_at || null },
    recovery: listRecovery()
  };
}

// ---------------------------------------------------------------------------
// Recovery records — OTHMODE-owned process tracking (store stream
// 'recovery'). Each record appends one step for a component's incident;
// the fold shows where each open incident stands. Executing any step is
// out of scope by design.
// ---------------------------------------------------------------------------

function recordRecoveryStep(input, actor) {
  var component = String(input.component || '').trim();
  if (!component) throw vErr('component is required');
  var step = String(input.step || '').toUpperCase();
  if (RECOVERY_STEPS.indexOf(step) === -1) throw vErr('step must be one of: ' + RECOVERY_STEPS.join(', '));
  var state = input.state ? String(input.state).toUpperCase() : null;
  if (state && STATES.indexOf(state) === -1) throw vErr('state must be one of: ' + STATES.join(', '));
  return store.appendRecord('recovery', {
    type: 'recovery',
    component: component,
    incident: input.incident || component,
    step: step,
    state: state,
    note: input.note ? String(input.note).slice(0, 2000) : null,
    actor: String(actor || 'unknown')
  });
}

function listRecovery(cap) {
  var res = store.readStream('recovery', cap || 200);
  if (!res.provisioned) return { provisioned: false, reason: res.reason, incidents: [] };
  var byIncident = {};
  var order = [];
  res.rows.forEach(function (r) {
    if (r.type !== 'recovery') return;
    if (!byIncident[r.incident]) { byIncident[r.incident] = { incident: r.incident, component: r.component, steps: [], current_step: null, state: null, opened_at: r.ts }; order.push(r.incident); }
    var inc = byIncident[r.incident];
    inc.steps.push({ step: r.step, ts: r.ts, note: r.note, state: r.state, actor: r.actor });
    inc.current_step = r.step;
    if (r.state) inc.state = r.state;
    inc.closed = r.step === 'UPDATE_STATUS';
  });
  return { provisioned: true, incidents: order.map(function (k) { return byIncident[k]; }).reverse() };
}

module.exports = {
  STATES: STATES,
  RECOVERY_STEPS: RECOVERY_STEPS,
  overview: overview,
  recordRecoveryStep: recordRecoveryStep,
  listRecovery: listRecovery
};
