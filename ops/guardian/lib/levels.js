'use strict';
// =====================================================
// MYTHOS Guardian V0 — level ladder and hysteresis
// ops/guardian/lib/levels.js
//
// One pure state machine, used by every domain. The overall HOST level is
// the maximum of the confirmed domain levels. GUARDIAN health is tracked
// separately (see engine.js): a stale input degrades Guardian, it does not
// invent a host level.
//
//   NORMAL < RECOVERY < WARNING < HIGH < CRITICAL < EMERGENCY
//
// Fixes carried over from the PR #283 review:
//   * Escalation commits the MINIMUM level supported by N consecutive
//     samples, so evidence alternating between two higher levels (e.g.
//     HIGH/CRITICAL at a threshold edge) still escalates instead of
//     starving forever on a reset pending counter.
//   * `immediate` evidence (an oom_kill delta, an upstream-confirmed
//     Resource Guard level, a down critical unit) commits on sample one and
//     is never masked by a higher unconfirmed level.
//   * `floor` is the partial form of that: a level ALREADY confirmed by an
//     upstream component commits at once, while any higher level Guardian
//     infers on its own still has to earn its samples. Without this, one
//     source of confirmed evidence would be delayed by another source's
//     unconfirmed suspicion.
//   * De-escalation moves ONE step per M samples and passes through
//     RECOVERY, so nothing jumps from EMERGENCY to NORMAL.
// =====================================================

var LEVELS = ['NORMAL', 'RECOVERY', 'WARNING', 'HIGH', 'CRITICAL', 'EMERGENCY'];
var DEFAULTS = { escalate_samples: 2, deescalate_samples: 3, recovery_samples: 3 };

function rank(level) { var i = LEVELS.indexOf(level); return i < 0 ? 0 : i; }
function isLevel(level) { return LEVELS.indexOf(level) >= 0; }
function max(a, b) { return rank(a) >= rank(b) ? a : b; }
function maxOf(list) { return (list || []).reduce(function (acc, l) { return max(acc, l || 'NORMAL'); }, 'NORMAL'); }
function below(level) {
  if (level === 'WARNING') return 'RECOVERY';
  if (level === 'RECOVERY') return 'NORMAL';
  var r = rank(level);
  return r <= 0 ? 'NORMAL' : LEVELS[r - 1];
}

function initial(nowIso) {
  return { level: 'NORMAL', since: nowIso || null, pending_level: null, pending_count: 0 };
}

function normalise(prev, nowIso) {
  var st = initial(nowIso);
  if (!prev || typeof prev !== 'object') return st;
  if (isLevel(prev.level)) st.level = prev.level;
  if (typeof prev.since === 'string') st.since = prev.since;
  if (isLevel(prev.pending_level)) st.pending_level = prev.pending_level;
  if (typeof prev.pending_count === 'number' && prev.pending_count >= 0) st.pending_count = prev.pending_count;
  return st;
}

// (previous domain state, raw level this tick) -> { state, transition }
function step(prev, raw, opts) {
  var o = { escalate_samples: DEFAULTS.escalate_samples, deescalate_samples: DEFAULTS.deescalate_samples, recovery_samples: DEFAULTS.recovery_samples };
  Object.keys(opts || {}).forEach(function (k) { if (opts[k] !== undefined) o[k] = opts[k]; });
  var nowIso = o.now || new Date().toISOString();
  var st = normalise(prev, nowIso);
  if (!isLevel(raw) || raw === 'RECOVERY') raw = 'NORMAL';

  var cur = st.level;
  var curForUp = cur === 'RECOVERY' ? 'NORMAL' : cur;
  var extra = [];

  function commit(to, reason) {
    var t = { at: nowIso, from: cur, to: to, reason: reason };
    st.level = to; st.since = nowIso; st.pending_level = null; st.pending_count = 0;
    return { state: st, transition: t, transitions: extra.concat([t]) };
  }

  // An upstream-confirmed floor commits immediately; Guardian's own higher
  // inference continues through the normal escalation path below.
  if (!o.immediate && isLevel(o.floor) && rank(o.floor) > rank(curForUp)) {
    extra.push({ at: nowIso, from: cur, to: o.floor, reason: 'confirmed-upstream' });
    st.level = o.floor; st.since = nowIso; st.pending_level = null; st.pending_count = 0;
    cur = o.floor; curForUp = o.floor;
  }

  if (rank(raw) > rank(curForUp)) {
    if (o.immediate) return commit(raw, 'immediate');
    // Track the MINIMUM level every consecutive escalating sample supports.
    if (st.pending_level && rank(st.pending_level) > rank(curForUp)) {
      st.pending_level = rank(raw) < rank(st.pending_level) ? raw : st.pending_level;
      st.pending_count += 1;
    } else {
      st.pending_level = raw; st.pending_count = 1;
    }
    if (st.pending_count >= o.escalate_samples) return commit(st.pending_level, 'escalation');
    return { state: st, transition: extra[0] || null, transitions: extra };
  }

  if (cur === 'NORMAL' || raw === cur) {
    st.pending_level = null; st.pending_count = 0;
    return { state: st, transition: extra[0] || null, transitions: extra };
  }

  var target = cur === 'RECOVERY' ? 'NORMAL' : max(raw === 'NORMAL' ? 'RECOVERY' : raw, below(cur));
  var needed = cur === 'RECOVERY' ? o.recovery_samples : o.deescalate_samples;
  if (st.pending_level === target) st.pending_count += 1;
  else { st.pending_level = target; st.pending_count = 1; }
  if (st.pending_count >= needed) return commit(target, cur === 'RECOVERY' ? 'recovered' : 'de-escalation');
  return { state: st, transition: extra[0] || null, transitions: extra };
}

module.exports = { LEVELS: LEVELS, DEFAULTS: DEFAULTS, rank: rank, isLevel: isLevel, max: max, maxOf: maxOf, below: below, initial: initial, step: step };
