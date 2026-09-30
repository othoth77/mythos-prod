'use strict';
// =====================================================
// MYTHOS Browser MCP — outbound URL policy (the browser's outbound gate)
// projects/mythos-browser-mcp/lib/url-policy.js
//
// Decides whether a navigation target may be fetched at all, BEFORE any
// backend sees it. Fail-closed: only http(s), no embedded credentials, no
// loopback / private / link-local / CGNAT / multicast literals, no host
// names that only mean something inside a network. An allow-list
// (MYTHOS_BROWSER_ALLOWED_HOSTS, comma-separated, "example.com" exact or
// ".example.com" suffix) narrows it further when set; a deny-list
// (MYTHOS_BROWSER_DENIED_HOSTS) always wins. DNS rebinding to a private
// address after this check is the engine's job: Obscura refuses private
// fetches by default and --allow-private-network is never passed.
// =====================================================
var { URL } = require('url');
var net = require('net');

var MAX_URL_LENGTH = 2048;
var LOCAL_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa', '.lan', '.corp', '.intranet'];
var LOCAL_NAMES = ['localhost', 'ip6-localhost', 'ip6-loopback', 'metadata.google.internal'];

function ipv4Private(ip) {
  var p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some(function (n) { return !(n >= 0 && n <= 255); })) return true; // unparsable = refuse
  var a = p[0], b = p[1];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;            // CGNAT (Tailscale lives here)
  if (a === 169 && b === 254) return true;                        // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0 && p[2] === 0) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;                                      // multicast + reserved + broadcast
  return false;
}

function ipv6Private(ip) {
  var s = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (s === '::' || s === '::1') return true;
  var mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (mapped) return ipv4Private(mapped[1]);
  var hexMapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(s);   // the URL parser writes ::ffff:7f00:1
  if (hexMapped) { var h = parseInt(hexMapped[1], 16), l = parseInt(hexMapped[2], 16); return ipv4Private([h >> 8, h & 255, l >> 8, l & 255].join('.')); }
  if (/^fe[89ab]/.test(s)) return true;                            // link-local
  if (/^f[cd]/.test(s)) return true;                               // unique local
  if (/^ff/.test(s)) return true;                                  // multicast
  if (/^64:ff9b:/.test(s)) return true;                            // NAT64 well-known
  if (/^2001:db8:/.test(s)) return true;                           // documentation
  return false;
}

function parseList(v) {
  return String(v || '').split(',').map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);
}

function hostMatches(host, rule) {
  if (rule.charAt(0) === '.') return host === rule.slice(1) || host.slice(-rule.length) === rule;
  return host === rule;
}

// check(url, env) -> { ok: true, url: normalised } | { ok: false, code, reason }
function check(input, env) {
  env = env || process.env;
  if (typeof input !== 'string' || !input.trim()) return { ok: false, code: 'URL_EMPTY', reason: 'url must be a non-empty string' };
  if (input.length > MAX_URL_LENGTH) return { ok: false, code: 'URL_TOO_LONG', reason: 'url exceeds ' + MAX_URL_LENGTH + ' characters' };
  if (/[\u0000-\u001f\u007f]/.test(input)) return { ok: false, code: 'URL_CONTROL_CHARS', reason: 'url carries control characters' };
  var u;
  try { u = new URL(input.trim()); } catch (e) { return { ok: false, code: 'URL_INVALID', reason: 'url does not parse' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, code: 'URL_SCHEME', reason: 'only http and https are allowed' };
  if (u.username || u.password) return { ok: false, code: 'URL_CREDENTIALS', reason: 'urls with embedded credentials are refused' };
  var host = u.hostname.toLowerCase();
  if (!host) return { ok: false, code: 'URL_NO_HOST', reason: 'url has no host' };
  if (LOCAL_NAMES.indexOf(host) !== -1) return { ok: false, code: 'URL_LOCAL_HOST', reason: 'local host names are refused' };
  for (var i = 0; i < LOCAL_SUFFIXES.length; i++) if (host.slice(-LOCAL_SUFFIXES[i].length) === LOCAL_SUFFIXES[i]) return { ok: false, code: 'URL_LOCAL_HOST', reason: 'internal-only host suffix ' + LOCAL_SUFFIXES[i] + ' is refused' };
  var bare = host.replace(/^\[|\]$/g, '');
  var v = net.isIP(bare);
  if (v === 4 && ipv4Private(bare)) return { ok: false, code: 'URL_PRIVATE_ADDRESS', reason: 'private, loopback, link-local or reserved IPv4 literal is refused' };
  if (v === 6 && ipv6Private(bare)) return { ok: false, code: 'URL_PRIVATE_ADDRESS', reason: 'private, loopback, link-local or reserved IPv6 literal is refused' };
  if (host.indexOf('.') === -1 && v === 0) return { ok: false, code: 'URL_SINGLE_LABEL', reason: 'single-label host names are refused' };
  var denied = parseList(env.MYTHOS_BROWSER_DENIED_HOSTS);
  for (var d = 0; d < denied.length; d++) if (hostMatches(host, denied[d])) return { ok: false, code: 'URL_DENIED_HOST', reason: 'host is on the deny-list' };
  var allowed = parseList(env.MYTHOS_BROWSER_ALLOWED_HOSTS);
  if (allowed.length && !allowed.some(function (r) { return hostMatches(host, r); })) return { ok: false, code: 'URL_NOT_ALLOWED', reason: 'host is not on the allow-list' };
  return { ok: true, url: u.toString(), host: host };
}

module.exports = { check: check, MAX_URL_LENGTH: MAX_URL_LENGTH, _ipv4Private: ipv4Private, _ipv6Private: ipv6Private };
