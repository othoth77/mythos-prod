'use strict';
// =====================================================
// Mythos Orchestration Core — agent reputation (Phase 2, §27 — lightweight)
// projects/mythos-ai-executor/core/reputation.js
//
// Historical outcome tracking by agent × capability. Deliberately
// minimal: a durable counter store and a rate query. Reputation NEVER
// flips provider priority from a single result — stats expose n, and
// the router only consults rates once MIN_EVIDENCE outcomes exist.
// =====================================================

var fs = require('fs');
var path = require('path');

var store = require('./store');

var MIN_EVIDENCE = 5;

function file() { return path.join(store.root(), 'reputation.json'); }

function loadAll() {
  try {
    return JSON.parse(fs.readFileSync(file(), 'utf8'));
  } catch (e) {
    return {};
  }
}

function saveAll(data) {
  fs.mkdirSync(store.root(), { recursive: true, mode: 0o700 });
  var tmp = file() + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, file());
}

function recordOutcome(agentName, capability, success) {
  var data = loadAll();
  var agent = data[agentName] = data[agentName] || {};
  var cap = agent[capability] = agent[capability] || { n: 0, successes: 0 };
  cap.n += 1;
  if (success) cap.successes += 1;
  cap.updated_at = new Date().toISOString();
  saveAll(data);
  return cap;
}

// Returns { n, successes, rate, sufficient } — rate is null (unknown, not
// invented) until MIN_EVIDENCE outcomes exist.
function stats(agentName, capability) {
  var data = loadAll();
  var cap = (data[agentName] || {})[capability] || { n: 0, successes: 0 };
  var sufficient = cap.n >= MIN_EVIDENCE;
  return {
    n: cap.n,
    successes: cap.successes,
    rate: sufficient ? cap.successes / cap.n : null,
    sufficient: sufficient
  };
}

module.exports = {
  MIN_EVIDENCE: MIN_EVIDENCE,
  recordOutcome: recordOutcome,
  stats: stats
};
