'use strict';
// =====================================================
// MYTHOS Guardian — one read-only /proc scan per tick
// ops/guardian/lib/procs.js
//
// Shared by the memory (top consumers), session (agent count, orphans) and
// disk (in-use verification) domains so the host is scanned once.
// =====================================================

var path = require('path');

function parseStat(text) {
  if (typeof text !== 'string') return null;
  // comm may contain spaces and parentheses: split on the LAST ')'.
  var close = text.lastIndexOf(')');
  var open = text.indexOf('(');
  if (open < 0 || close < 0) return null;
  var rest = text.slice(close + 2).split(' ');
  return {
    comm: text.slice(open + 1, close),
    state: rest[0],
    ppid: parseInt(rest[1], 10),
    starttime_ticks: parseInt(rest[19], 10)
  };
}

function statusField(text, name) {
  if (typeof text !== 'string') return null;
  var m = new RegExp('^' + name + ':\\s+(\\S+)', 'm').exec(text);
  return m ? m[1] : null;
}

function scan(io, opts) {
  var root = io.procRoot;
  var names = io.readdir(root) || [];
  var uptime = parseFloat((io.readFile(path.join(root, 'uptime')) || '0').split(' ')[0]) || 0;
  var hz = (opts && opts.clk_tck) || 100;
  var out = [];
  for (var i = 0; i < names.length; i++) {
    if (!/^\d+$/.test(names[i])) continue;
    var dir = path.join(root, names[i]);
    var st = parseStat(io.readFile(path.join(dir, 'stat')));
    if (!st) continue;
    var status = io.readFile(path.join(dir, 'status'));
    var uid = parseInt(statusField(status, 'Uid'), 10);
    var rssKb = parseInt(statusField(status, 'VmRSS'), 10);
    var cmd = io.readFile(path.join(dir, 'cmdline'));
    out.push({
      pid: parseInt(names[i], 10),
      ppid: st.ppid,
      uid: isNaN(uid) ? null : uid,
      comm: st.comm,
      rss_mib: isNaN(rssKb) ? 0 : Math.round(rssKb / 1024),
      age_seconds: isNaN(st.starttime_ticks) ? null : Math.max(0, Math.round(uptime - st.starttime_ticks / hz)),
      cmdline: cmd ? cmd.replace(/\0+$/, '').split('\0').join(' ').slice(0, 300) : ''
    });
  }
  return out;
}

function topRss(procs, n) {
  return procs.slice().sort(function (a, b) { return b.rss_mib - a.rss_mib; }).slice(0, n || 5)
    .map(function (p) { return { pid: p.pid, comm: p.comm, uid: p.uid, rss_mib: p.rss_mib }; });
}

module.exports = { scan: scan, parseStat: parseStat, topRss: topRss };
