'use strict';
// =====================================================
// MYTHOS Guardian — level ladder and hysteresis
// ops/guardian/lib/levels.js
//
// One generic, pure state machine used by every Guardian domain (memory,
// disk, services, backup, sessions). The overall host level is the maximum
// of the confirmed domain levels, so each domain carries its own evidence.
//
//   NORMAL < RECOVERY < WARNING < HIGH < CRITICAL < EMERGENCY
//
// Escalation needs `escalate_samples` consecutive ticks arguing for a
// higher level — unless the caller marks the evidence `immediate` (an
// oom_kill delta, an already-confirmed resource-guard level, a down user
// manager). De-escalation moves ONE step per `deescalate_samples` ticks,
// and leaving WARNING passes through RECOVERY for `recovery_samples`
// ticks, so a level can neither oscillate every tick nor jump from
// EMERGENCY straight to NORMAL.
// =====================================================

var LEVELS = ['NORMAL', 'RECOVERY', 'WARNING', 'HIGH', 'CRITICAL', 'EMERGENCY'];

var STEP_DEFAULTS = { escalate_samples: 2, deescalate_samples: 3, recovery_samples: 3 };

function rank(level) {
  var i = LEVELS.indexOf(level);
  return i < 0 ? 0 : i;
}

function isLevel(level) {
  return LEVELS.indexOf(level) >= 0;
}

function max(a, b) {
  return rank(a) >= rank(b) ? a : b;
}

function maxOf(levels) {
  return (levels || []).reduce(function (acc, l) { return max(acc, l || 'NORMAL'); }, 'NORMAL');
}

// The level one step below `level` on the way down.
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

// Pure: (previous domain state, raw level from this tick's evidence) →
// { state, transition }. `raw` RECOVERY is treated as NORMAL evidence.
function step(prev, raw, opts) {
  var o = {};
  Object.keys(STEP_DEFAULTS).forEach(function (k) { o[k] = STEP_DEFAULTS[k]; });
  Object.keys(opts || {}).forEach(function (k) { if (opts[k] !== undefined) o[k] = opts[k]; });
  var nowIso = o.now || new Date().toISOString();
  var st = normalise(prev, nowIso);
  if (!isLevel(raw) || raw === 'RECOVERY') raw = 'NORMAL';

  var cur = st.level;
  // RECOVERY is a cooling-off band: for escalation it counts as NORMAL.
  var curForUp = cur === 'RECOVERY' ? 'NORMAL' : cur;

  function commit(to, reason) {
    var t = { at: nowIso, from: cur, to: to, reason: reason };
    st.level = to;
    st.since = nowIso;
    st.pending_level = null;
    st.pending_count = 0;
    return { state: st, transition: t };
  }

  if (rank(raw) > rank(curForUp)) {
    if (st.pending_level === raw) st.pending_count += 1;
    else { st.pending_level = raw; st.pending_count = 1; }
    if (o.immediate || st.pending_count >= o.escalate_samples) {
      return commit(raw, o.immediate ? 'immediate' : 'escalation');
    }
    return { state: st, transition: null };
  }

  if (cur === 'NORMAL' || raw === cur) {
    st.pending_level = null;
    st.pending_count = 0;
    return { state: st, transition: null };
  }

  // raw is below the current level: count toward ONE step down.
  var target = cur === 'RECOVERY' ? 'NORMAL' : max(raw === 'NORMAL' ? 'RECOVERY' : raw, below(cur));
  var needed = cur === 'RECOVERY' ? o.recovery_samples : o.deescalate_samples;
  if (st.pending_level === target) st.pending_count += 1;
  else { st.pending_level = target; st.pending_count = 1; }
  if (st.pending_count >= needed) return commit(target, cur === 'RECOVERY' ? 'recovered' : 'de-escalation');
  return { state: st, transition: null };
}

module.exports = {
  LEVELS: LEVELS,
  STEP_DEFAULTS: STEP_DEFAULTS,
  rank: rank,
  isLevel: isLevel,
  max: max,
  maxOf: maxOf,
  below: below,
  initial: initial,
  step: step
};
