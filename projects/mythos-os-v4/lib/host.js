'use strict';
// =====================================================
// MYTHOS OS v4 — which host is this?
// projects/mythos-os-v4/lib/host.js
//
// The execution layer is the same code on every machine; what differs is
// the executor it hands repository work to: on Haddad the haddad-agent
// provider (local Qwen), on the VPS the claude-code provider. Those facts
// live in DOTS policy as host profiles (`haddad.hosts.<name>`), and this
// file picks the one that applies:
//
//   1. MYTHOS_OS_HOST (or an explicit option) names a profile, or
//   2. the machine's hostname is listed in exactly one profile.
//
// Anything else resolves to NO profile. That is not an error for answers —
// a model can still answer — but repository work fails closed
// (HOST_UNKNOWN): v4 never guesses which executor it is standing next to.
// =====================================================

var os = require('os');
var path = require('path');

function expandHome(p) {
  if (typeof p !== 'string') return p;
  if (p === '~') return os.homedir();
  return p.indexOf('~/') === 0 ? path.join(os.homedir(), p.slice(2)) : p;
}

// resolve(policy, explicit) -> { name, profile, source } | { name: null, profile: null, reason }
function resolve(policy, explicit) {
  var hosts = policy.haddad.hosts;
  var asked = explicit || process.env.MYTHOS_OS_HOST || null;
  if (asked) {
    if (Object.prototype.hasOwnProperty.call(hosts, asked)) return { name: asked, profile: hosts[asked], source: 'explicit' };
    return { name: null, profile: null, reason: 'no host profile named "' + String(asked).slice(0, 40) + '"' };
  }
  var hostname = os.hostname();
  var matches = Object.keys(hosts).filter(function (name) { return hosts[name].hostnames.indexOf(hostname) !== -1; });
  if (matches.length === 1) return { name: matches[0], profile: hosts[matches[0]], source: 'hostname' };
  return {
    name: null, profile: null,
    reason: matches.length ? 'hostname "' + hostname + '" is listed in ' + matches.length + ' profiles' : 'hostname "' + hostname + '" matches no host profile (set MYTHOS_OS_HOST)'
  };
}

module.exports = { resolve: resolve, expandHome: expandHome };
