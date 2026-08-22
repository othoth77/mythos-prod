'use strict';

// tests/hub-dashboard-test.js — validates the Mythos Hub Dashboard
// (sites/mythosprod.xyz): the freshness gate that stops a dead monitor from
// reading as a healthy ecosystem, the rollup precedence, the CSP posture the
// vhost depends on, and the probe registry that observes the Hub itself.
// Fully offline: no network, no DOM, no build step.

var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
var SITE = path.join(ROOT, 'sites', 'mythosprod.xyz');
var PROBES = path.join(ROOT, 'projects', 'status-center', 'monitor', 'probes.json');

var passed = 0;
var failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  PASS ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
}

var dash = require(path.join(SITE, 'assets', 'dashboard.js'));
var html = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');
var css = fs.readFileSync(path.join(SITE, 'assets', 'dashboard.css'), 'utf8');
var tokens = fs.readFileSync(path.join(SITE, 'assets', 'tokens.css'), 'utf8');
var health = JSON.parse(fs.readFileSync(path.join(SITE, 'health.json'), 'utf8'));
var probes = JSON.parse(fs.readFileSync(PROBES, 'utf8'));

// ---------------------------------------------------------------------------
console.log('§1 freshness gate — a stale snapshot is never a clean bill of health');

function isoAgo(minutes) {
  return new Date(Date.now() - minutes * 60000).toISOString();
}
function tierAt(minutes) {
  return dash.classifyFreshness(dash.ageMinutes(isoAgo(minutes))).tier;
}

check('threshold follows the monitor cadence (5 min timer -> 15 min fresh)',
  dash.FRESH_MINUTES === 15, 'FRESH_MINUTES=' + dash.FRESH_MINUTES);
check('a just-written snapshot is FRESH', tierAt(0) === 'FRESH');
check('one missed run is still FRESH', tierAt(6) === 'FRESH');
check('at the fresh boundary is FRESH', tierAt(15) === 'FRESH');
check('past the fresh boundary is STALE', tierAt(16) === 'STALE');
check('at the stale boundary is STALE', tierAt(60) === 'STALE');
check('past the stale boundary is EXPIRED', tierAt(61) === 'EXPIRED');
check('an hours-old snapshot is EXPIRED', tierAt(60 * 26) === 'EXPIRED');

var missing = dash.classifyFreshness(dash.ageMinutes(null));
check('a missing timestamp is EXPIRED, never fresh', missing.tier === 'EXPIRED');
check('a missing timestamp states why', /absent/.test(missing.reason || ''), missing.reason);

var future = dash.classifyFreshness(dash.ageMinutes(isoAgo(-120)));
check('clock skew (future timestamp) is EXPIRED, not impossibly fresh', future.tier === 'EXPIRED');

var stale = dash.classifyFreshness(dash.ageMinutes(isoAgo(30)));
check('STALE exposes a reason', !!stale.reason && stale.reason.length > 10, stale.reason);
check('the reason names the age', /30 min/.test(stale.reason || ''), stale.reason);

// ---------------------------------------------------------------------------
console.log('§2 rollup precedence — worst wins, unmonitored abstains');

var ALL_LIVE = [{ state: 'LIVE' }, { state: 'LIVE' }, { state: 'LIVE' }];

check('all live rolls up LIVE', dash.rollup(ALL_LIVE, 'FRESH').verdict === 'LIVE');
check('one DOWN beats LIVE and DEGRADED',
  dash.rollup([{ state: 'LIVE' }, { state: 'DEGRADED' }, { state: 'DOWN' }], 'FRESH').verdict === 'DOWN');
check('DEGRADED beats LIVE',
  dash.rollup([{ state: 'LIVE' }, { state: 'DEGRADED' }], 'FRESH').verdict === 'DEGRADED');

// NOT_MONITORED behaviour must be identical in every tier.
['FRESH', 'STALE', 'EXPIRED'].forEach(function (tier) {
  var r = dash.rollup([{ state: 'LIVE' }, { state: 'NOT_MONITORED' }], tier);
  check('NOT_MONITORED counted but excluded from the verdict (' + tier + ')',
    r.counts.NOT_MONITORED === 1 && r.counts.LIVE === 1);
});
check('all-unmonitored never claims health',
  dash.rollup([{ state: 'NOT_MONITORED' }, { state: 'NOT_MONITORED' }], 'FRESH').verdict === 'NOT_MONITORED');
check('an unrecognised state cannot produce LIVE',
  dash.rollup([{ state: 'WEIRD' }], 'FRESH').verdict !== 'LIVE');

// ---------------------------------------------------------------------------
console.log('§3 the gate actually binds to the rollup');

check('STALE data can never roll up to LIVE',
  dash.rollup(ALL_LIVE, 'STALE').verdict === 'DEGRADED');
check('EXPIRED data withholds the verdict entirely',
  dash.rollup(ALL_LIVE, 'EXPIRED').verdict === null);
check('a stale FAILURE is still reported (staleness never hides a fault)',
  dash.rollup([{ state: 'LIVE' }, { state: 'DOWN' }], 'STALE').verdict === 'DOWN');
check('a stale DEGRADED stays DEGRADED',
  dash.rollup([{ state: 'DEGRADED' }], 'STALE').verdict === 'DEGRADED');
check('fresh data is unaffected by the gate',
  dash.rollup(ALL_LIVE, 'FRESH').verdict === 'LIVE');
check('tier is reported back for the caller',
  dash.rollup(ALL_LIVE, 'STALE').tier === 'STALE');

// ---------------------------------------------------------------------------
console.log('§4 CSP posture the vhost depends on');

// Comments are stripped first: the markup deliberately *documents* what it
// avoids ("not a <form>", "no on* handlers"), and prose about a hazard must
// not read as the hazard itself.
var markup = html.replace(/<!--[\s\S]*?-->/g, '');

check('no inline event handlers', !/\son[a-z]+\s*=/i.test(markup));
check('no inline <script> executing code',
  (markup.match(/<script(?![^>]*type="application\/ld\+json")[^>]*>/g) || [])
    .every(function (t) { return /src=/.test(t); }));
check('scripts are same-origin relative', !/<script[^>]+src="https?:/.test(markup));
check('no external stylesheet origins', !/<link[^>]+stylesheet[^>]*href="https?:/.test(markup));
check('no <form> that could post anywhere', !/<form[\s>]/.test(markup));
check('the AI control is disabled in markup', /id="ai-input"[^>]*\sdisabled/.test(markup));

// ---------------------------------------------------------------------------
console.log('§5 build validation — every token and class resolves');

var usedTokens = (css.match(/var\(--mythos-[a-z0-9-]+/g) || [])
  .map(function (s) { return s.replace('var(', ''); });
var defined = {};
(tokens.match(/--mythos-[a-z0-9-]+/g) || []).forEach(function (t) { defined[t] = true; });
var unresolved = usedTokens.filter(function (t) { return !defined[t]; });
check('every design token used by the dashboard is defined', unresolved.length === 0, unresolved.join(', '));

var classes = {};
(html.match(/class="[^"]+"/g) || []).forEach(function (m) {
  m.slice(7, -1).split(/\s+/).forEach(function (c) { if (c) classes[c] = true; });
});
var unstyled = Object.keys(classes).filter(function (c) { return css.indexOf('.' + c) < 0; });
check('every class used in the markup is styled', unstyled.length === 0, unstyled.join(', '));

// Anchors must resolve, or the nav silently goes nowhere.
var anchors = (html.match(/href="#([a-z-]+)"/g) || []).map(function (m) { return m.slice(7, -1); });
var deadAnchors = anchors.filter(function (a) { return html.indexOf('id="' + a + '"') < 0; });
check('every in-page anchor resolves to an id', deadAnchors.length === 0, deadAnchors.join(', '));

// ---------------------------------------------------------------------------
console.log('§6 health endpoint contract');

check('health.json declares the application', health.application === 'mythos-hub');
check('repository_head is null in the repository (stamped at deploy)', health.repository_head === null);
check('deployed_at is null in the repository (stamped at deploy)', health.deployed_at === null);
check('the null-stamping rule is documented in the file itself', /stamped/.test(health.note || ''));

// ---------------------------------------------------------------------------
console.log('§7 the Hub is observed by the Status Center');

function probe(id) {
  return probes.probes.filter(function (p) { return p.id === id; })[0];
}
var apex = probe('hub-apex');
var hp = probe('hub-dashboard-health');
var sp = probe('hub-status-endpoint');

check('hub-apex still exists', !!apex);
check('hub-apex was NOT relaxed — still expects exactly 200',
  !!apex && apex.expect_status.length === 1 && apex.expect_status[0] === 200);
check('hub-apex no longer claims the apex is unserved',
  !!apex && !/not served|BLOCKER-HUB-DNS\./.test(apex.note || ''));

check('the dashboard health endpoint is probed', !!hp && hp.enabled === true);
check('health probe asserts a body, not just a status code',
  !!hp && typeof hp.expect_body_substring === 'string' && hp.expect_body_substring.length > 0);

check('the status feed the dashboard reads is probed', !!sp && sp.enabled === true);
check('status-feed probe targets the same-origin alias',
  !!sp && sp.url === 'https://mythosprod.xyz/api/status.json');
check('status-feed probe asserts the payload shape',
  !!sp && sp.expect_body_substring === '"checks"');
check('status-feed probe explains why it exists',
  !!sp && /outside the Hub's webroot|invisible/.test(sp.note || ''));

var enabledIds = probes.probes.filter(function (p) { return p.enabled; }).map(function (p) { return p.id; });
check('all three Hub probes are enabled together',
  ['hub-apex', 'hub-dashboard-health', 'hub-status-endpoint']
    .every(function (id) { return enabledIds.indexOf(id) >= 0; }));

console.log('\nhub-dashboard: ' + passed + ' passed, ' + failed + ' failed');
process.exitCode = failed ? 1 : 0;
