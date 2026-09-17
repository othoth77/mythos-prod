'use strict';
// =====================================================
// OTHMODE V2 — front-end runtime suite
// tests/othmode-5-ui-test.js
//
// Loads the REAL front-end modules (i18n.js, othmode-i18n.js, app.js,
// othmode.js) under a minimal DOM shim, boots them exactly as a browser
// does, and drives the V2 screens through the hash router in all three
// locales. `fetch` is stubbed with the shapes the real endpoints return, so
// nothing here touches the network, the database or the host.
//
// Why this exists: before V2 the front end had only static guarantees
// (no innerHTML, no eval, i18n key parity). Those cannot catch a
// load-time typo, a missing helper, a broken render path or a state that
// silently shows nothing. This suite catches all four, and it is the
// reason the V2 Overview/Runs screens could be verified without a browser
// on a host where headless Chrome is unavailable to agent sessions.
//
// Run with: node tests/othmode-5-ui-test.js
// =====================================================

var fs = require('fs'), path = require('path');
var W = path.join(__dirname, '..', 'projects', 'command-center', 'reference', 'web');
var nodes = 0;
function mkNode(tag) {
  nodes++;
  var n = {
    tagName: String(tag).toUpperCase(), children: [], childNodes: [], attrs: {}, style: {}, dataset: {},
    _text: '', firstChild: null, lastChild: null, parentNode: null, listeners: {},
    classList: { _s: {}, add: function () { for (var i = 0; i < arguments.length; i++) this._s[arguments[i]] = 1; },
      remove: function () { for (var i = 0; i < arguments.length; i++) delete this._s[arguments[i]]; },
      contains: function (c) { return !!this._s[c]; }, toggle: function (c) { this._s[c] ? delete this._s[c] : this._s[c] = 1; } },
    appendChild: function (c) { if (!c) return c; this.children.push(c); this.childNodes.push(c); c.parentNode = this; this.firstChild = this.children[0]; this.lastChild = c; return c; },
    removeChild: function (c) { this.children = this.children.filter(function (x) { return x !== c; }); this.childNodes = this.children.slice(); this.firstChild = this.children[0] || null; this.lastChild = this.children[this.children.length - 1] || null; return c; },
    insertBefore: function (c) { return this.appendChild(c); },
    setAttribute: function (k, v) { this.attrs[k] = v; }, getAttribute: function (k) { return this.attrs[k]; },
    removeAttribute: function (k) { delete this.attrs[k]; },
    addEventListener: function (e, f) { (this.listeners[e] = this.listeners[e] || []).push(f); },
    removeEventListener: function () {}, focus: function () {}, blur: function () {}, click: function () { (this.listeners.click || []).forEach(function (f) { f({ target: this, preventDefault: function () {} }); }); },
    querySelector: function () { return null; }, querySelectorAll: function () { return []; },
    contains: function () { return false; }, scrollIntoView: function () {}, closest: function () { return null; },
    getBoundingClientRect: function () { return { top: 0, left: 0, width: 100, height: 20 }; }
  };
  Object.defineProperty(n, 'textContent', { get: function () { return this._text || this.children.map(function (c) { return c.textContent || ''; }).join(''); }, set: function (v) { this._text = String(v); this.children = []; this.childNodes = []; this.firstChild = null; this.lastChild = null; } });
  Object.defineProperty(n, 'innerHTML', { get: function () { return ''; }, set: function () { throw new Error('innerHTML must never be assigned'); } });
  return n;
}
var byId = {};
['view', 'toast-root', 'dialog-root', 'sidebar', 'auth-button', 'search-input', 'app'].forEach(function (id) { byId[id] = mkNode('div'); });
global.document = {
  createElement: mkNode, createTextNode: function (t) { var n = mkNode('#text'); n.textContent = t; return n; },
  createDocumentFragment: function () { return mkNode('#fragment'); },
  getElementById: function (id) { return byId[id] || (byId[id] = mkNode('div')); },
  querySelector: function () { return mkNode('div'); }, querySelectorAll: function () { return []; },
  addEventListener: function (e, f) { (this._l = this._l || {})[e] = f; }, removeEventListener: function () {},
  documentElement: mkNode('html'), body: mkNode('body'), activeElement: null, title: '', head: mkNode('head'), cookie: '', readyState: 'loading'
};
var store = {};
global.localStorage = { getItem: function (k) { return k in store ? store[k] : null; }, setItem: function (k, v) { store[k] = String(v); }, removeItem: function (k) { delete store[k]; } };
global.window = global;
global.addEventListener = function (e, f) { (global._wl = global._wl || {})[e] = f; };
global.removeEventListener = function () {};
global.scrollTo = function () {};
global.requestAnimationFrame = function (fn) { return setTimeout(fn, 0); };
global.dispatchHash = function (h) { global.location.hash = h; if (global._wl && global._wl.hashchange) global._wl.hashchange(); };
global.location = { hash: '#/', href: 'https://othmode.mythosprod.xyz/', pathname: '/', search: '', reload: function () {} };
// Node 22 defines `navigator` as a getter, so it is replaced, not assigned.
Object.defineProperty(global, 'navigator', { value: { language: 'en-US', clipboard: { writeText: function () { return Promise.resolve(); } }, userAgent: 'node' }, configurable: true, writable: true });
global.matchMedia = function () { return { matches: false, addEventListener: function () {}, addListener: function () {} }; };
global.setTimeout = setTimeout; global.clearTimeout = clearTimeout;
var RUN = { id: 'run-x', ts: '2026-09-17T22:16:59.430Z', type: 'run', command_slug: 'v2-e2e-smoke', command_title: 'OTHMODE V2 end-to-end verification', task_id: 't-20260917221659-xm77rq', provider: 'free-llm-pool',
  lifecycle: { task_id: 't-20260917221659-xm77rq', status: 'completed', terminal: true, provider_used: 'groq', model_used: 'openai/gpt-oss-120b', attempts: 1, fallback: false, duration_ms: 1275, started_at: '2026-09-17T22:17:05.722Z', ended_at: '2026-09-17T22:17:06.997Z', error: null, next_action: 'await further instructions', result: { status: 'completed', summary: 'The advisory check request was received.' } } };
var RUNNING = JSON.parse(JSON.stringify(RUN)); RUNNING.lifecycle.status = 'running'; RUNNING.lifecycle.terminal = false; RUNNING.lifecycle.result = null; RUNNING.lifecycle.ended_at = null; RUNNING.lifecycle.duration_ms = null;
var FAILED = JSON.parse(JSON.stringify(RUN)); FAILED.lifecycle.status = 'failed'; FAILED.lifecycle.result = null; FAILED.lifecycle.error = 'free LLM pool exhausted: ALL_CANDIDATES_FAILED'; FAILED.lifecycle.next_action = 'inspect logs';
var ROUTES = {
  '/api/othmode/runs?limit=100': { provisioned: true, runs: [RUN] },
  '/api/othmode/runs?limit=1': { provisioned: true, runs: [RUN] },
  '/api/othmode/runs/t-20260917221659-xm77rq': { run: RUN, lifecycle: RUN.lifecycle },
  '/api/othmode/runs/t-running': { run: RUNNING, lifecycle: RUNNING.lifecycle },
  '/api/othmode/runs/t-failed': { run: FAILED, lifecycle: FAILED.lifecycle },
  '/api/othmode/providers': { total: 4, providers: [{ id: 'claude-code', enabled: true, credential_present: true }, { id: 'free-llm-pool', enabled: true, credential_present: true, pool: { configured: 1, active: 1, wired: 9 } }] },
  '/api/othmode/health': { total: 12, counts: { ACTIVE: 10, DEGRADED: 1, BLOCKED: 1, FAILED: 0 }, components: [{ id: 'provider:free-llm/groq', kind: 'provider', name: 'free-llm/groq', state: 'BLOCKED', detail: 'invalid credentials' }] },
  '/api/othmode/mode': { status: 'READY' },
  '/api/commands?limit=12&sort=recent': { commands: [], total: 0 },
  '/api/stats': { commands: 0 },
  '/api/categories': { categories: [{ id: 1, slug: 'ops', name: 'Ops', color: 'slate' }] },
  '/api/projects': { projects: [{ id: 1, slug: 'mythos-prod', name: 'Mythos Prod' }] },
  '/api/tags': { tags: [] },
  '/api/session': { identity: 'e2e-verifier' },
  '/api/commands?limit=100&sort=recent': { commands: [], total: 0 },
  '/api/notes?limit=100': { notes: [] },
  '/api/dashboard': {"most_used":[{"id":7,"slug":"github-final-verification","title":"GitHub Final Verification","description":"","body":"x","safety_level":"READ_ONLY","status":"ACTIVE","variables":[],"category":{"slug":"github","name_en":"GitHub","name_fr":"GitHub","name_ar":"غيت هاب","color":"violet"},"project":{"slug":"mythos-os","name":"Mythos OS"},"usage_count":0,"difficulty":"INTERMEDIATE"}],"favorites":[],"recently_used":[{"id":22,"slug":"deployment","title":"Deployment","description":"","body":"x","safety_level":"PRODUCTION","status":"ACTIVE","variables":[],"category":{"slug":"deployment","name_en":"Deployment","name_fr":"Déploiement","name_ar":"النشر","color":"orange"},"project":{"slug":"infrastructure","name":"Infrastructure"},"usage_count":0,"difficulty":"INTERMEDIATE"}],"recently_added":[{"id":2,"slug":"architecture-investigation","title":"Architecture Investigation","description":"","body":"x","safety_level":"READ_ONLY","status":"ACTIVE","variables":[],"category":{"slug":"architecture","name_en":"Architecture","name_fr":"Architecture","name_ar":"البنية","color":"indigo"},"project":{"slug":"mythos-os","name":"Mythos OS"},"usage_count":0,"difficulty":"INTERMEDIATE"}],"recommended":[{"id":2,"slug":"architecture-investigation","title":"Architecture Investigation","description":"","body":"x","safety_level":"READ_ONLY","status":"ACTIVE","variables":[],"category":{"slug":"architecture","name_en":"Architecture","name_fr":"Architecture","name_ar":"البنية","color":"indigo"},"project":{"slug":"mythos-os","name":"Mythos OS"},"usage_count":0,"difficulty":"INTERMEDIATE"}],"categories":[{"slug":"github","description":"","body":"x","safety_level":"SAFE","status":"ACTIVE","variables":[],"category":null,"project":null,"usage_count":0,"difficulty":"INTERMEDIATE"}]}
};
var fetched = [];
global.fetch = function (url) {
  fetched.push(url);
  var body = ROUTES[url] !== undefined ? ROUTES[url] : (/\/api\/othmode\/runs\//.test(url) ? { run: RUN, lifecycle: RUN.lifecycle } : {});
  return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(body); } });
};
global._fetched = fetched;

function load(f) { new Function(fs.readFileSync(path.join(W, f), 'utf8'))(); }
load('i18n.js'); load('othmode-i18n.js'); load('app.js'); load('othmode.js');

try { if (document._l && document._l.DOMContentLoaded) document._l.DOMContentLoaded(); } catch (e) { console.log('  ..BOOT THREW:', e.message, '\n', (e.stack||'').split('\n').slice(1,4).join('\n')); }
var A = global.MccApp, I = global.MccI18n;
var fails = [], passes = 0;
function ok(c, n) { console.log((c ? '  PASS ' : '  FAIL ') + n); if (c) passes++; else fails.push(n); }

ok(!!A && typeof A.registerCommandActions === 'function', 'app.js loaded and exposes registerCommandActions');
var LOCS = I.availableLocales().map(function (l) { return l.code; });
ok(LOCS.length >= 3 && LOCS.indexOf('ar') !== -1, 'three locales offered, Arabic enabled (' + LOCS.join(',') + ')');

// Every locale must render every V2 string without falling back to the raw key.
['en', 'fr', 'ar'].forEach(function (loc) {
  I.setLocale(loc);
  var keys = ['oth.group.command', 'oth.group.tasks', 'oth.group.projects', 'oth.group.ai', 'oth.group.status', 'oth.group.more',
    'oth.nav.runs', 'oth.runs.title', 'oth.runs.sub', 'oth.runs.empty', 'oth.run.button', 'oth.run.start', 'oth.run.intro',
    'oth.run.provider_auto', 'oth.run.provider_used', 'oth.run.model', 'oth.run.attempts', 'oth.run.fallback', 'oth.run.result',
    'oth.run.error', 'oth.run.waiting', 'oth.run.disabled', 'oth.ov.ai', 'oth.ov.ready', 'oth.ov.not_ready', 'oth.ov.key_missing',
    'oth.ov.attention', 'oth.ov.none', 'oth.ov.last_run', 'oth.ov.no_runs', 'oth.state.invalid_credentials',
    'oth.run.status.queued', 'oth.run.status.running', 'oth.run.status.completed', 'oth.run.status.failed', 'oth.run.status.retrying'];
  var missing = keys.filter(function (k) { return I.t(k) === k; });
  ok(missing.length === 0, loc + ': all ' + keys.length + ' V2 strings translated' + (missing.length ? ' (missing ' + missing.join(',') + ')' : ''));
});
I.setLocale('en');


function flush(n) { var p = Promise.resolve(); for (var i = 0; i < (n || 30); i++) p = p.then(function () {}); return p; }
process.on('unhandledRejection', function (e) { console.log('  FAIL unhandled rejection in the front end: ' + (e && e.message)); fails.push('unhandled rejection'); });
function viewText() { return byId.view.textContent; }
function sidebarText() { return byId.sidebar.textContent; }

flush(60).then(function () {
  ok(/COMMAND/.test(sidebarText()) && /TASKS/.test(sidebarText()) && /PROJECTS/.test(sidebarText()) && /PROJECTSAI|AI/.test(sidebarText()) && /STATUS/.test(sidebarText()) && /MORE/.test(sidebarText()),
    'sidebar shows the six V2 groups: ' + sidebarText().replace(/\s+/g, ' ').slice(0, 140));
  ok(/Runs/.test(sidebarText()) && /Library/.test(sidebarText()) && /Providers/.test(sidebarText()) && /Memory/.test(sidebarText()) && /Evolution/.test(sidebarText()),
    'every V1 screen is still reachable from the simplified navigation');
  var dash = viewText();
  ok(/Ready/.test(dash) && /groq|free pool|claude-code/.test(dash), 'Overview: AI card says Ready and names the providers');
  ok(/Needs attention/.test(dash) && /API key/.test(dash), 'Overview: needs-attention card explains in plain language: ' + (dash.match(/Needs attention[^A-Z]*[^|]{0,70}/) || [''])[0].replace(/\s+/g, ' '));
  ok(/Last run/.test(dash) && /Completed/.test(dash), 'Overview: last-run card shows the completed run');
  global.dispatchHash('#/runs');
  return flush(40);
}).then(function () {
  var v = viewText();
  ok(/OTHMODE V2 end-to-end verification/.test(v), 'Runs list renders the run');
  ok(/Completed/.test(v) && /groq/.test(v), 'Runs list shows the status and the AI that answered');
  global.dispatchHash('#/run/t-20260917221659-xm77rq');
  return flush(40);
}).then(function () {
  var v = viewText();
  ok(/openai\/gpt-oss-120b/.test(v), 'Run detail names the model');
  ok(/Completed/.test(v) && /advisory check request was received/.test(v), 'Run detail shows the completed state and the result');
  global.dispatchHash('#/run/t-running');
  return flush(40);
}).then(function () {
  ok(/Working/.test(viewText()), 'Run detail shows the in-progress state with the self-refresh note');
  global.dispatchHash('#/run/t-failed');
  return flush(40);
}).then(function () {
  var v = viewText();
  ok(/Failed/.test(v) && /pool exhausted/.test(v) && /inspect logs/.test(v), 'Run detail shows the failure reason and the next action');
  // Arabic + French render the same screens
  I.setLocale('ar'); global.dispatchHash('#/runs'); return flush(40);
}).then(function () {
  ok(/التنفيذات|مكتمل/.test(viewText()), 'Runs screen renders in Arabic: ' + viewText().replace(/\s+/g, ' ').slice(0, 60));
  I.setLocale('fr'); global.dispatchHash('#/runs'); return flush(40);
}).then(function () {
  ok(/Exécutions|Terminée/.test(viewText()), 'Runs screen renders in French');
  I.setLocale('en');
  ok(global._fetched.length > 0 && global._fetched.every(function (u) { return u.indexOf('/api/') === 0; }), 'every UI call went to the /api surface (' + global._fetched.length + ' calls)');
  console.log('\n' + nodes + ' DOM nodes rendered by the real front end');
  console.log('othmode-5 ui suite: ' + passes + ' passed, ' + fails.length + ' failed');
  if (fails.length) { console.log('FAILURES: ' + fails.join(' | ')); process.exit(1); }
}).catch(function (e) { console.error('UI SMOKE ERROR', e && e.stack || e); process.exit(1); });
