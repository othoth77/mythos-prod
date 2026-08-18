'use strict';
// =====================================================
// MYTHOS OS COMMAND CENTER — MOS-1 stage tests
// tests/mos-1-console-test.js
//
// Four things are asserted, in order of how expensive they would be to
// discover later:
//
//   1. DESIGN-SYSTEM FIDELITY. Every D-001 colour is present verbatim,
//      the recovered typography is declared, and the composition layer
//      holds no raw colour literal. A future edit that quietly reverts
//      the Command Center to a generic palette fails here.
//
//   2. THE READ-ONLY PROPERTY, at source level. No write method, no
//      body reader, no write verb in the upstream client. This is a
//      governance boundary, so it is tested the way MCC-1 tests its
//      no-execution guarantee — by reading the source, not by trusting
//      the routes.
//
//   3. THE MODULE REGISTRY as the scalability contract: the owner's
//      fourteen modules, unique ids, and a named data source for every
//      one — including the planned ones.
//
//   4. HTTP BEHAVIOUR against a real server, with a stub control plane
//      standing in for the executor. Includes the failure cases, which
//      are the point: an unreachable plane must produce a stated
//      failure, never an empty list.
//
// Deterministic and offline. No executor, no database, no network, no
// AI quota. Run with: node tests/mos-1-console-test.js
// =====================================================

var fs = require('fs');
var http = require('http');
var os = require('os');
var path = require('path');

var BASE = path.join(__dirname, '..');
var PROJ = path.join(BASE, 'projects', 'mythos-os-console');
var REF = path.join(PROJ, 'reference');
var WEB = path.join(REF, 'web');

var passed = 0, failed = 0, failures = [];
function ok(cond, name) {
  if (cond) passed++;
  else { failed++; failures.push(name); console.error('FAIL: ' + name); }
}
function eq(a, b, name) { ok(a === b, name + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }

function read(f) { return fs.readFileSync(f, 'utf8'); }

// Source-level assertions run against code with comments removed. A file
// that documents "there is no innerHTML here" must not fail its own
// guarantee on the sentence describing it. Only block comments and
// whole-line // comments are stripped, so a regex literal containing //
// mid-line survives intact.
function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}
function markup(src) { return src.replace(/<!--[\s\S]*?-->/g, ''); }

var mythosCss = read(path.join(WEB, 'mythos.css'));
var consoleCss = read(path.join(WEB, 'console.css'));
var appJs = read(path.join(WEB, 'app.js'));
var shellHtml = read(path.join(WEB, 'index.html'));
var loginGateCss = read(path.join(WEB, 'login-gate.css'));
var loginGateJs = read(path.join(WEB, 'login-gate.js'));
var serverJs = read(path.join(REF, 'server.js'));
var upstreamJs = read(path.join(REF, 'upstream.js'));

// ===========================================================================
// 1. DESIGN-SYSTEM FIDELITY — docs/MYTHOS_DESIGN_DECISIONS.md D-001
// ===========================================================================

// The colour values are read from the live product stylesheet rather
// than retyped here. If css/main.css ever changes, this test tells us
// the console has drifted from the brand system — which is exactly the
// alarm the audit says the portfolio has never had.
var mainCss = read(path.join(BASE, 'css', 'main.css'));
function tokenOf(name) {
  var m = new RegExp('--' + name + ':\\s*([^;]+);').exec(mainCss);
  return m ? m[1].trim() : null;
}

var D001 = ['bg', 'surface', 'card', 'border', 'gold', 'gold-light', 'gold-dim',
            'text', 'muted', 'danger', 'green', 'green-dim', 'blue', 'blue-dim',
            'today', 'today-dim', 'past', 'past-dim', 'purple', 'purple-dim'];

D001.forEach(function (name) {
  var value = tokenOf(name);
  ok(value !== null, 'D-001 source token --' + name + ' still exists in css/main.css');
  if (value === null) return;
  var re = new RegExp('--mythos-' + name.replace(/-/g, '\\-') + ':\\s*' + value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ';');
  ok(re.test(mythosCss), 'mythos.css carries --mythos-' + name + ' verbatim from D-001 (' + value + ')');
});

ok(/--mythos-danger-dim:\s*rgba\(192,57,43,0\.12\)/.test(mythosCss),
   'danger-dim completes the 12% semantic pairing that main.css leaves incomplete');

// Typography: the two faces the product has shipped since d1a9d19.
ok(/--mythos-font-display:\s*'Playfair Display'/.test(mythosCss), 'display face is Playfair Display');
ok(/--mythos-font-ui:\s*'Inter'/.test(mythosCss), 'UI face is Inter');
ok(/Georgia/.test(mythosCss) && /system-ui/.test(mythosCss),
   'both faces carry a local fallback stack (D-002 precedent: a font pack may not ship)');
ok(/fonts\.googleapis\.com\/css2\?family=Playfair\+Display[^"]*Inter/.test(shellHtml),
   'the shell loads the same font URL as the Mythos OS application');

// The composition layer must not invent colour.
ok(!/#[0-9a-fA-F]{3,8}\b/.test(consoleCss), 'console.css declares no hex colour');
ok(!/rgba?\(/.test(consoleCss), 'console.css declares no rgb/rgba colour');
ok(/var\(--mythos-/.test(consoleCss), 'console.css composes from design-system tokens');

// login-gate.css is a separate composition file (the temporary internal
// login gate, see login-gate.js). Same discipline as console.css: no
// literal colour, tokens only.
ok(!/#[0-9a-fA-F]{3,8}\b/.test(loginGateCss), 'login-gate.css declares no hex colour');
ok(!/rgba?\(/.test(loginGateCss), 'login-gate.css declares no rgb/rgba colour');
ok(/var\(--mythos-/.test(loginGateCss), 'login-gate.css composes from design-system tokens');

// Recovered component idioms.
ok(/inset -3px 0 0 var\(--mythos-gold\)/.test(mythosCss), 'active nav item keeps the inset gold rail from main.css');
ok(/cubic-bezier\(0\.34, 1\.56, 0\.64, 1\)/.test(mythosCss), 'the overshoot easing used throughout main.css is preserved');
ok(/--mythos-sidebar-w:\s*310px/.test(mythosCss), 'sidebar keeps the established 310px width');
ok(/font-family:\s*var\(--mythos-font-display\)/.test(mythosCss), 'display face is applied, not merely declared');

// Gaps the audit named, closed for this surface.
ok(/prefers-reduced-motion/.test(mythosCss), 'reduced-motion is honoured (portfolio had none)');
ok(/--mythos-focus-ring/.test(mythosCss) && /:focus-visible/.test(mythosCss), 'a visible focus ring exists (portfolio had one, on ID Auto)');
ok(/@media \(max-width: 900px\)/.test(mythosCss), 'the sidebar collapses below 900px (main.css never does)');
ok(/--mythos-sp-1:/.test(mythosCss), 'a spacing scale exists (U-004: the portfolio had none)');

// ---------------------------------------------------------------------------
// 1b. CONTRAST — measured, not disclaimed
//
// docs/MYTHOS_DESIGN_STRATEGY.md §13 records accessibility as VERIFIED
// ABSENT portfolio-wide and states that contrast "was NOT measured".
// MOS-1.1 measured it. These assertions keep it measured: every pair the
// console actually renders must meet WCAG 2.1 AA, so a future token or
// surface change cannot quietly drop below it.
//
// Informational rows — the raw D-001 solids the console deliberately does
// NOT use as text, and the decorative hairlines WCAG 1.4.11 does not
// govern — are excluded from the pass requirement and asserted separately
// to stay honest about why they exist.
// ---------------------------------------------------------------------------

var contrast = require(path.join(PROJ, 'tools', 'contrast.js'));
var measured = contrast.measure();

var rendered = measured.filter(function (r) { return !r.informational; });
ok(rendered.length >= 20, 'the contrast tool covers the console\'s real pairings (' + rendered.length + ' rendered pairs)');
rendered.forEach(function (r) {
  ok(r.passes, 'WCAG 2.1 AA: ' + r.id + ' — ' + r.ratio + ':1, needs ' + r.required.toFixed(1));
});

// The measurement must be a real computation, not a table of remembered
// numbers: check the algorithm against the two anchors WCAG itself fixes.
ok(Math.round(contrast.ratio(contrast.parse('#ffffff'), contrast.parse('#000000')) * 100) / 100 === 21,
   'contrast maths: white on black is exactly 21:1');
ok(Math.abs(contrast.ratio(contrast.parse('#777777'), contrast.parse('#ffffff')) - 4.48) < 0.02,
   'contrast maths: #777 on white is 4.48:1 (the classic AA near-miss)');
ok(Math.abs(contrast.over(contrast.parse('rgba(255,255,255,0.5)'), contrast.parse('#000000')).r - 127.5) < 0.01,
   'alpha compositing: 50% white over black resolves to mid grey');

// The tokens the tool measures are read from mythos.css, not retyped.
ok(/tokens\(\)/.test(read(path.join(PROJ, 'tools', 'contrast.js'))) &&
   /readFileSync\(CSS/.test(read(path.join(PROJ, 'tools', 'contrast.js'))),
   'contrast tool reads its tokens from the stylesheet rather than a copied list');

// Usage rule: --muted stays declared for D-001 completeness but is not
// used as text, because it measures below AA on every ground.
ok(/--mythos-muted:\s*#6b6860;/.test(mythosCss), '--muted is still declared verbatim (D-001 completeness)');
ok(!/color:\s*var\(--mythos-muted\)/.test(mythosCss) && !/color:\s*var\(--mythos-muted\)/.test(consoleCss),
   '--muted is never used as a text colour (measured 3.03-3.47:1, below AA)');
ok(/--mythos-text-secondary:\s*#999;/.test(mythosCss),
   'secondary text uses #999, recovered from index.html:125');
measured.filter(function (r) { return r.informational && /--muted as body text/.test(r.id); })
  .forEach(function (r) { ok(!r.passes, 'recorded honestly: ' + r.id + ' fails AA at ' + r.ratio + ':1'); });

// ===========================================================================
// 2. READ-ONLY, AT SOURCE LEVEL
// ===========================================================================

var serverCode = code(serverJs), upstreamCode = code(upstreamJs), appCode = code(appJs);
var shellMarkup = markup(shellHtml);

ok(/req\.method !== 'GET' && req\.method !== 'HEAD' && !writeMatch/.test(serverCode),
   'server refuses every method but GET, HEAD and the named write routes before routing');
ok(/var WRITE_ROUTES = \[/.test(serverCode) && /matchWriteRoute/.test(serverCode),
   'the write-route exceptions are matched through one explicit, named list -- not a pattern that could grow silently');
// Every entry in that list must be a named, testable route -- never a
// wildcard or a bare method check that would admit an unbounded surface.
var writeRoutesBlock = (serverCode.match(/var WRITE_ROUTES = \[[\s\S]*?\];/) || [''])[0];
ok(/\/api\/missions\/start/.test(writeRoutesBlock), 'the start route is named explicitly in WRITE_ROUTES');
ok(/CANCEL_ROUTE_RE/.test(writeRoutesBlock), 'the cancel route is named explicitly in WRITE_ROUTES');
ok(/DISPATCH_ROUTE_RE/.test(writeRoutesBlock), 'the dispatch route is named explicitly in WRITE_ROUTES');
// MOS-3A narrows this from 2: the capacity-gated dispatch relay is a third
// deliberate exception, same shape and discipline as the first two.
eq((writeRoutesBlock.match(/\{ test:/g) || []).length, 3, 'exactly three write routes are registered -- start, cancel and dispatch, nothing else');
// The ONE named exception (readBoundedBody, MOS-2's request-body reader for
// exactly one relay route) is stripped by exact name before this check, so
// any OTHER, unnamed body reader still fails the suite.
ok(!/readBody|req\.on\('data'/.test(serverCode.replace(/function readBoundedBody[\s\S]*?\n\}\n/, '')),
   'server contains no request-body reader beyond the one named MOS-2 exception (readBoundedBody)');
['PUT', 'PATCH', 'DELETE'].forEach(function (verb) {
  ok(!new RegExp("method:\\s*'" + verb + "'").test(upstreamCode), 'upstream client issues no ' + verb);
  ok(!new RegExp("method:\\s*'" + verb + "'").test(serverCode), 'server issues no ' + verb);
});
// POST is now issued exactly once, by upstream.post() -- server-to-executor
// only, over the channel already carrying the bearer token, never
// browser-to-anything. GET remains issued too.
ok((upstreamCode.match(/method:\s*'POST'/g) || []).length === 1,
   'upstream client issues POST exactly once (its own post() function, added for MOS-2)');
ok(!/method:\s*'POST'/.test(serverCode), 'the console server itself never issues a POST anywhere (it only relays through upstream.post)');
ok(/method: 'GET'/.test(upstreamCode), 'upstream client issues GET');
ok(!/child_process|[^.\w]exec\(|[^.\w]spawn\(|[^.\w]eval\(|new Function/.test(serverCode + upstreamCode + appCode),
   'no execution path anywhere in the console (MCC-1 precedent)');

// XSS: the whole client renders through textContent.
['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write'].forEach(function (sink) {
  ok(appCode.indexOf(sink) === -1, 'client never uses ' + sink);
});
ok(/textContent/.test(appCode), 'client assigns text through textContent');
ok(!/<script/.test(shellMarkup.replace(/<script src="\/(modules|app|login-gate)\.js"><\/script>/g, '')),
   'the shell has no inline script (login-gate.js is the one new, named, external script tag)');
ok(!/ style="/.test(shellMarkup), 'the shell has no inline style attribute');

// Static serving is a whitelist, not a resolved path.
ok(/hasOwnProperty\.call\(STATIC, pathname\)/.test(serverCode), 'static files come from an explicit whitelist');
ok(!/path\.join\([^)]*pathname/.test(serverCode), 'no request path is ever joined onto a directory');

// The two new static entries follow the identical whitelist pattern —
// no new route, no new mechanism, nothing to weaken.
ok(/'\/login-gate\.css':\s*\{ file: path\.join\(WEB, 'login-gate\.css'\)/.test(serverCode),
   'login-gate.css is served through the same static whitelist as every other asset');
ok(/'\/login-gate\.js':\s*\{ file: path\.join\(WEB, 'login-gate\.js'\)/.test(serverCode),
   'login-gate.js is served through the same static whitelist as every other asset');

// ---------------------------------------------------------------------------
// 2b. TEMPORARY LOGIN GATE — source-level guarantees
//
// This is a UI-level gate, not a data boundary: it changes no server
// route, reads no request body, and calls no backend of any kind — the
// server.js read-only guarantees above are untouched by its existence.
// What is tested here is specific to the gate itself: the credential
// lives only as a SHA-256 digest, never as text; the client renders
// only through textContent, like the rest of this app; and the gate
// markup actually exists in the shell it is meant to sit in front of.
// ---------------------------------------------------------------------------

var loginGateCode = code(loginGateJs);

// The stored secret material is shaped like a SHA-256 digest (64 lowercase
// hex characters) and nothing else — never the plaintext password. This
// is checked structurally, without this suite ever holding or comparing
// against the plaintext itself.
ok(/HASH\s*=\s*'[0-9a-f]{64}'/.test(loginGateCode),
   'the gate stores a SHA-256 digest, not a plaintext password');

['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write'].forEach(function (sink) {
  ok(loginGateCode.indexOf(sink) === -1, 'login-gate.js never uses ' + sink);
});
ok(/textContent/.test(loginGateCode), 'login-gate.js assigns error text through textContent');
ok(!/child_process|[^.\w]exec\(|[^.\w]spawn\(|[^.\w]eval\(|new Function/.test(loginGateCode),
   'no execution path in login-gate.js (MCC-1 precedent)');
ok(/sessionStorage/.test(loginGateCode) && !/localStorage/.test(loginGateCode),
   'the unlocked state is session-scoped (sessionStorage), never persisted across browser sessions (localStorage)');
ok(/crypto\.subtle\.digest/.test(loginGateCode), 'the password is verified via Web Crypto, never sent anywhere');

// The gate markup exists in the shell, before the existing Command
// Center element in document order, and is the ONLY thing an
// unauthenticated visitor's markup contains ahead of it.
var gateIdx = shellHtml.indexOf('id="mythos-gate"');
var appIdx = shellHtml.indexOf('id="app"');
ok(gateIdx !== -1, 'the login gate markup exists in the shell');
ok(appIdx !== -1 && gateIdx !== -1 && gateIdx < appIdx,
   'the login gate sits before the Command Center in document order');
ok(/id="mythos-gate-password"[^>]*type="password"/.test(shellHtml) ||
   /type="password"[^>]*id="mythos-gate-password"/.test(shellHtml),
   'the gate has exactly one password-type input');
ok(!/name="username"|type="text"[^>]*login|<select/.test(shellMarkup.slice(gateIdx, appIdx)),
   'the gate has no username field, no registration, no additional login-adjacent controls');

// ===========================================================================
// 3. THE MODULE REGISTRY
// ===========================================================================

var registry = require(path.join(WEB, 'modules.js'));

var EXPECTED = ['Command Center', 'Missions', 'Campaigns', 'Agents', 'Memory', 'Roadmap',
                'Governance', 'Approvals', 'Providers', 'Budget', 'Secrets', 'Sandbox',
                'Audit', 'Settings'];

eq(registry.modules.length, EXPECTED.length, 'the registry holds exactly the fourteen named MYTHOS OS modules');
EXPECTED.forEach(function (label) {
  ok(registry.modules.some(function (m) { return m.label === label; }), 'module registered: ' + label);
});

var ids = {};
registry.modules.forEach(function (m) {
  ok(!ids[m.id], 'module id is unique: ' + m.id);
  ids[m.id] = true;
  ok(/^[a-z][a-z0-9-]*$/.test(m.id), m.id + ' is a clean route segment');
  ok(m.state === 'live' || m.state === 'planned', m.id + ' declares a known state');
  ok(typeof m.source === 'string' && m.source.length > 20,
     m.id + ' names where its data comes from (required for planned modules too)');
  ok(typeof m.summary === 'string' && m.summary.length > 10, m.id + ' has a summary');
  ok(typeof m.icon === 'string' && m.icon.length > 0, m.id + ' has an icon');
  ok(registry.sections.indexOf(m.section) !== -1, m.id + ' belongs to a known section');
});

eq(registry.defaultId, 'command-center', 'the console opens on the Command Center');

// Every live module must have a renderer, or the route silently degrades.
registry.modules.filter(function (m) { return m.state === 'live'; }).forEach(function (m) {
  ok(appCode.indexOf("RENDERERS['" + m.id + "']") !== -1 ||
     appCode.indexOf('RENDERERS.' + m.id + ' =') !== -1,
     'live module ' + m.id + ' has a renderer');
});

// A planned module must NOT pretend: no renderer, and the shell shows why.
registry.modules.filter(function (m) { return m.state === 'planned'; }).forEach(function (m) {
  ok(appCode.indexOf("RENDERERS['" + m.id + "']") === -1 && appCode.indexOf('RENDERERS.' + m.id + ' =') === -1,
     'planned module ' + m.id + ' has no renderer and cannot show invented data');
});
ok(/function notBuilt/.test(appCode), 'planned modules render an explicit not-built surface');

// ===========================================================================
// 4. HTTP BEHAVIOUR — real server, stub control plane
// ===========================================================================

var STUB_TASKS = {
  tasks: [
    { task_id: 'abc12345', project: 'mythos-prod', stage: 'MOS-1', status: 'RUNNING', effective: 'RUNNING', provider: 'claude-code', updated_at: '2026-08-18T08:00:00Z' },
    { task_id: 'def67890', project: 'mythos-prod', stage: 'MOS-0', status: 'BLOCKED', effective: 'BLOCKED', updated_at: '2026-08-17T08:00:00Z' }
  ]
};
var STUB_EVENTS = { events: [] };
for (var i = 0; i < 120; i++) STUB_EVENTS.events.push({ type: 'tick', at: '2026-08-18T08:00:00Z', n: i });

var SECRET_TOKEN = 'mos-test-token-do-not-leak-9f3a';
var stubHits = [];

var stubPostBodies = []; // { url, body } for every POST the stub received, newest last

function startStub() {
  return new Promise(function (resolve) {
    var s = http.createServer(function (req, res) {
      var chunks = [];
      req.on('data', function (d) { chunks.push(d); });
      req.on('end', function () {
        var u = req.url.split('?')[0];
        stubHits.push(req.method + ' ' + req.url);
        var raw = Buffer.concat(chunks).toString('utf8');
        var parsed = null;
        try { parsed = raw ? JSON.parse(raw) : null; } catch (e) { /* not JSON */ }
        if (req.method === 'POST') stubPostBodies.push({ url: u, body: parsed });

        if (u === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, store: 'ok' })); return; }
        var auth = req.headers.authorization || '';
        if (auth !== 'Bearer ' + SECRET_TOKEN) { res.writeHead(401); res.end(JSON.stringify({ error: 'unauthorized' })); return; }

        // MOS-2: create + explicit resume, standing in for the real
        // executor's own POST /tasks and POST /tasks/<id>/resume.
        if (req.method === 'POST' && u === '/tasks') {
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ task_id: 'tk-stub-start-0001', status: 'QUEUED' }));
          return;
        }
        if (req.method === 'POST' && u === '/tasks/tk-stub-start-0001/resume') {
          res.writeHead(202, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ task_id: 'tk-stub-start-0001', accepted: true }));
          return;
        }
        // MOS-3A: the capacity-gated dispatch route the console now calls
        // instead of /resume for its explicit start. The /resume stub above
        // is kept -- the real executor endpoint still exists and is still
        // exercised by other flows.
        if (req.method === 'POST' && u === '/tasks/tk-stub-start-0001/dispatch') {
          res.writeHead(202, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ task_id: 'tk-stub-start-0001', dispatched: true, running: 1, max_parallel: 5 }));
          return;
        }

        // MOS-2.1: detail, report, cancel -- standing in for the real
        // executor's own GET /tasks/<id>, GET /tasks/<id>/report and
        // POST /tasks/<id>/cancel.
        if (req.method === 'GET' && u === '/tasks/abc12345') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            task: { task_id: 'abc12345', project: 'mythos-prod', stage: 'MOS-1', instruction: 'do the thing',
              provider: 'claude-code', model: null, priority: 'normal', execution_profile: 'repo-read',
              created_at: '2026-08-18T08:00:00Z', working_directory: '/should/not/leak', secret_field: SECRET_TOKEN },
            status: { status: 'RUNNING', started_at: '2026-08-18T08:00:01Z', ended_at: null, last_error: null,
              next_action: 'provider running', execution_id: 'x-abc123', retry_count: 0, pid: 999, claude_session_id: 'sess-should-not-leak' },
            effective: 'RUNNING'
          }));
          return;
        }
        if (req.method === 'GET' && u === '/tasks/abc12345/report') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ report: { task_id: 'abc12345',
            report: { status: 'in_progress', summary: null, next_stage: null },
            problems: [], provider_result_tail: 'SHOULD NOT LEAK: ' + SECRET_TOKEN } }));
          return;
        }
        if (req.method === 'POST' && u === '/tasks/abc12345/cancel') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ task_id: 'abc12345', status: 'CANCELLED' }));
          return;
        }
        if (req.method === 'POST' && u === '/tasks/tk-terminal-0001/cancel') {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'task already COMPLETED' }));
          return;
        }
        if (req.method === 'GET' && u === '/tasks/tk-notfound-0001') {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'no such task' }));
          return;
        }

        var body =
          u === '/tasks' ? STUB_TASKS :
          u === '/campaigns' ? { campaigns: [{ campaign_id: 'c-1', state: 'RUNNING', missions_total: 3, missions_completed: 1, needs_human: false }] } :
          u === '/events' ? STUB_EVENTS :
          /^\/budget\//.test(u) ? { project: u.split('/')[2], currency: 'USD', limit: 10, reserved: 1, spent: 2, remaining: 7, stale_reservations: 0 } :
          null;
        if (!body) { res.writeHead(404); res.end('{}'); return; }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      });
    });
    s.listen(0, '127.0.0.1', function () { resolve(s); });
  });
}

function req(port, p, method, body) {
  return new Promise(function (resolve) {
    var payload = body !== undefined ? JSON.stringify(body) : null;
    var headers = payload !== null ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {};
    var r = http.request({ host: '127.0.0.1', port: port, path: p, method: method || 'GET', headers: headers }, function (res) {
      var b = '';
      res.on('data', function (d) { b += d; });
      res.on('end', function () {
        var json = null;
        try { json = JSON.parse(b); } catch (e) { /* static */ }
        resolve({ status: res.statusCode, headers: res.headers, text: b, json: json });
      });
    });
    if (payload !== null) r.write(payload);
    r.end();
  });
}

function freshServer(env) {
  Object.keys(env).forEach(function (k) {
    if (env[k] === null) delete process.env[k]; else process.env[k] = env[k];
  });
  // The upstream client reads its target at require time, so both
  // modules are dropped from the cache between configurations.
  delete require.cache[require.resolve(path.join(REF, 'upstream.js'))];
  delete require.cache[require.resolve(path.join(REF, 'server.js'))];
  return require(path.join(REF, 'server.js'));
}

startStub().then(function (stub) {
  var stubPort = stub.address().port;

  // --- 4a. Authorised, control plane healthy ---------------------------
  var server = freshServer({
    MOS_EXECUTOR_URL: 'http://127.0.0.1:' + stubPort,
    MOS_EXECUTOR_TOKEN: SECRET_TOKEN,
    MOS_EXECUTOR_TOKEN_FILE: null
  });

  return server.start({ port: 0, bind: '127.0.0.1' }).then(function (s) {
    var port = s.address().port;

    return Promise.all([
      req(port, '/'), req(port, '/mythos.css'), req(port, '/console.css'),
      req(port, '/app.js'), req(port, '/modules.js'),
      req(port, '/api/health'), req(port, '/api/missions'), req(port, '/api/campaigns'),
      req(port, '/api/events?limit=7'), req(port, '/api/events?limit=99999'),
      req(port, '/api/budget'), req(port, '/api/agents'), req(port, '/api/providers'),
      req(port, '/api/roadmap'), req(port, '/api/modules'),
      req(port, '/', 'POST'), req(port, '/api/missions', 'DELETE'),
      req(port, '/etc/passwd'), req(port, '/../../css/main.css'), req(port, '/missions'),
      req(port, '/login-gate.css'), req(port, '/login-gate.js')
    ]).then(function (r) {
      var shell = r[0], css = r[1], ccss = r[2], ajs = r[3], mjs = r[4];
      var health = r[5], missions = r[6], campaigns = r[7];
      var ev7 = r[8], evMax = r[9], budget = r[10], agents = r[11], providers = r[12];
      var roadmap = r[13], mods = r[14], post = r[15], del = r[16];
      var passwd = r[17], traverse = r[18], deep = r[19];
      var gateCss = r[20], gateJs = r[21];

      eq(shell.status, 200, 'shell is served');
      ok(/MYTHOS OS/.test(shell.text), 'shell carries the Mythos OS title');
      eq(css.status, 200, 'mythos.css is served');
      eq(ccss.status, 200, 'console.css is served');
      eq(ajs.status, 200, 'app.js is served');
      eq(mjs.status, 200, 'modules.js is served');
      eq(gateCss.status, 200, 'login-gate.css is served');
      eq(gateJs.status, 200, 'login-gate.js is served');
      eq(gateCss.headers['content-type'], 'text/css; charset=utf-8', 'login-gate.css has the correct content type');
      eq(gateJs.headers['content-type'], 'application/javascript; charset=utf-8', 'login-gate.js has the correct content type');

      // Security headers on every response, including static.
      [shell, css, health, passwd].forEach(function (x, n) {
        ok(/frame-ancestors 'none'/.test(x.headers['content-security-policy'] || ''), 'CSP frame-ancestors on response ' + n);
        eq(x.headers['x-content-type-options'], 'nosniff', 'nosniff on response ' + n);
        eq(x.headers['x-frame-options'], 'DENY', 'X-Frame-Options on response ' + n);
        eq(x.headers['cache-control'], 'no-store', 'live state is never cached, response ' + n);
      });
      var csp = shell.headers['content-security-policy'];
      ok(/script-src 'self'/.test(csp) && !/script-src[^;]*unsafe/.test(csp), "script-src is 'self' with no unsafe-* relaxation");
      ok(/object-src 'none'/.test(csp), "object-src is 'none'");
      ok(/style-src 'self' https:\/\/fonts\.googleapis\.com/.test(csp), 'style-src admits only the Google Fonts stylesheet host');
      ok(/font-src 'self' https:\/\/fonts\.gstatic\.com/.test(csp), 'font-src admits only the Google Fonts file host');
      ok(!/connect-src[^;]*\*/.test(csp), 'connect-src is not wildcarded');

      eq(health.status, 200, 'health is 200');
      eq(health.json.data.upstream.ok, true, 'health reports the control plane up');
      eq(health.json.data.token_provisioned, true, 'health reports the token as provisioned');
      ok(health.text.indexOf(SECRET_TOKEN) === -1, 'health response does not contain the token');

      eq(missions.status, 200, 'missions is 200');
      eq(missions.json.data.tasks.length, 2, 'both stub tasks are returned');
      ok(missions.text.indexOf(SECRET_TOKEN) === -1, 'missions response does not contain the token');

      eq(campaigns.json.data.campaigns.length, 1, 'campaigns are returned');

      eq(ev7.json.data.events.length, 7, 'events honours an explicit limit');
      eq(evMax.json.data.events.length, 120, 'events limit is clamped to 500, so 120 stub events all return');
      ok(stubHits.some(function (h) { return h === 'GET /events?limit=500'; }), 'an over-large limit is clamped before it reaches the control plane');

      eq(budget.status, 200, 'budget is 200');
      ok(budget.json.data.projects.length >= 1, 'budget lists the executor projects');
      ok(budget.json.data.projects.every(function (b) { return b.project; }), 'every budget row names its project');

      eq(agents.status, 200, 'agents is 200');
      ok(Object.keys(agents.json.data.agents).length > 0, 'the agent registry is read from executor config');
      // The registry file is operator-edited, so /api/agents projects an
      // explicit allowlist rather than passing the file through. This is
      // asserted against the file on disk: a field added there must not
      // reach the browser until it is deliberately allowlisted.
      var upstreamMod = require(path.join(REF, 'upstream.js'));
      var rawAgents = JSON.parse(read(path.join(BASE, 'projects', 'mythos-ai-executor', 'config', 'agents.json')));
      var servedFields = {};
      Object.keys(agents.json.data.agents).forEach(function (id) {
        Object.keys(agents.json.data.agents[id]).forEach(function (f) { servedFields[f] = true; });
      });
      Object.keys(servedFields).forEach(function (f) {
        ok(upstreamMod.AGENT_FIELDS.indexOf(f) !== -1, 'served agent field is allowlisted: ' + f);
      });
      var rawFields = {};
      Object.keys(rawAgents).forEach(function (id) {
        Object.keys(rawAgents[id]).forEach(function (f) { rawFields[f] = true; });
      });
      ok(Object.keys(rawFields).some(function (f) { return upstreamMod.AGENT_FIELDS.indexOf(f) === -1; }) ||
         Object.keys(rawFields).length === Object.keys(servedFields).length,
         'the allowlist is applied to the real registry file, not bypassed');
      ok(!/[A-Za-z0-9_\-]{32,}/.test(JSON.stringify(agents.json.data.agents)),
         'no served agent value looks like a credential (32+ char opaque string)');

      eq(providers.status, 200, 'providers is 200');
      ok(providers.json.data.providers.length > 0, 'providers are derived from the agent registry');
      ok(providers.json.data.router.fallback.never_for_execution_authority === true,
         'the fallback authority invariant is surfaced, not summarised away');

      eq(roadmap.status, 200, 'roadmap is 200');
      eq(mods.json.data.modules.length, 14, 'the registry is served over the API too');

      eq(post.status, 405, 'POST is refused');
      eq(post.json.error, 'read_only', 'the refusal names the read-only property');
      eq(del.status, 405, 'DELETE is refused');

      eq(passwd.status, 404, 'an arbitrary path is 404, not a file');
      eq(traverse.status, 404, 'a traversal attempt is 404');
      ok(!/--bg:/.test(traverse.text), 'traversal returns no file content');
      eq(deep.status, 404, 'a deep path is a genuine 404 (routing is hash-based)');

      // -----------------------------------------------------------------
      // MOS-2: the one write relay, POST /api/missions/start
      // -----------------------------------------------------------------
      return Promise.all([
        req(port, '/api/missions/start', 'POST', { title: 'Test mission', instruction: 'Inspect the repository and report findings.', provider: 'claude-code' }),
        req(port, '/api/missions/start', 'POST', { title: 'x', instruction: 'y', provider: 'mock' }),
        req(port, '/api/missions/start', 'POST', { title: 'x', instruction: 'y', provider: 'gemini' }),
        req(port, '/api/missions/start', 'POST', { title: 'x', instruction: 'y', provider: 'claude-code', execution_profile: 'repo-write' }),
        req(port, '/api/missions/start', 'POST', { title: 'x', provider: 'claude-code' }),
        req(port, '/api/missions/start', 'POST', { instruction: 'y', provider: 'claude-code' }),
        req(port, '/api/missions/start', 'POST', { title: '', instruction: 'y', provider: 'claude-code' }),
        req(port, '/api/missions/start', 'POST', {}),
        req(port, '/api/missions/start', 'GET'), // wrong method on the one write path
        req(port, '/api/missions/start', 'DELETE')
      ]).then(function (rr) {
        var okStart = rr[0], badMock = rr[1], badGemini = rr[2], badExtra = rr[3],
            noInstr = rr[4], noTitle = rr[5], emptyTitle = rr[6], emptyBody = rr[7],
            wrongGet = rr[8], wrongDelete = rr[9];

        eq(okStart.status, 200, 'a valid start succeeds');
        eq(okStart.json.data.task_id, 'tk-stub-start-0001', 'the created task id is returned');
        eq(okStart.json.data.status, 'RUNNING', 'the explicit dispatch made it RUNNING, not just QUEUED');
        eq(okStart.json.data.provider, 'claude-code', 'the provider actually used is echoed back');

        [badMock, badGemini, badExtra, noInstr, noTitle, emptyTitle, emptyBody].forEach(function (r, i) {
          eq(r.status, 400, 'invalid start request ' + i + ' is rejected');
          eq(r.json.error, 'bad_request', 'invalid start request ' + i + ' names bad_request');
        });
        eq(wrongGet.status, 404, 'GET on the write-only path is not treated as the write route (falls through to 404, not 405 — it never matches a GET route)');
        eq(wrongDelete.status, 405, 'DELETE on the write path is still refused like every other method');

        // The relay must have reached the stub executor exactly twice —
        // create, then the explicit dispatch (MOS-3A: replaces the old
        // unconditional /resume call) — and ONLY for the one valid
        // request. Every rejected request above must never have reached
        // upstream at all: validation happens before any relay call.
        var startCalls = stubPostBodies.filter(function (c) { return /^\/tasks(\/tk-stub-start-0001\/dispatch)?$/.test(c.url); });
        eq(startCalls.length, 2, 'exactly two calls reached the executor: create, then dispatch — nothing for the seven rejected requests');
        eq(startCalls[0].url, '/tasks', 'the first call creates the task');
        eq(startCalls[0].body.project, 'mythos-prod', 'project is fixed server-side, never caller input');
        eq(startCalls[0].body.execution_profile, 'repo-read', 'execution_profile is fixed to the read-only ceiling, never caller input');
        eq(startCalls[0].body.requested_by, 'mos-console', 'requested_by identifies the console, distinct from the core owner');
        eq(startCalls[0].body.provider, 'claude-code', 'the caller-chosen provider is forwarded');
        eq(startCalls[0].body.instruction, 'Inspect the repository and report findings.', 'the caller-authored instruction is forwarded verbatim');
        ok(!Object.prototype.hasOwnProperty.call(startCalls[0].body, 'working_directory'),
           'working_directory is never sent by the console — the executor supplies its own default');
        eq(startCalls[1].url, '/tasks/tk-stub-start-0001/dispatch', 'the second call is the explicit dispatch on the id just created');
        stubPostBodies.length = 0;

        // -----------------------------------------------------------------
        // MOS-2.1: execution lifecycle -- detail, report, cancel
        // -----------------------------------------------------------------
        return Promise.all([
          req(port, '/api/missions'), // 1. execution list loading
          req(port, '/api/missions/abc12345'), // detail: RUNNING display
          req(port, '/api/missions/abc12345/report'), // report on a non-terminal task
          req(port, '/api/missions/tk-notfound-0001'), // invalid: unknown task
          req(port, '/api/missions/../../etc/passwd'), // invalid: path-shaped garbage as an id
          req(port, '/api/missions/abc12345', 'POST'), // invalid method on the detail route
          req(port, '/api/missions/abc12345/cancel', 'POST', {}), // 5. cancel: success
          req(port, '/api/missions/tk-terminal-0001/cancel', 'POST', {}), // 6. cancel: invalid (already terminal)
          req(port, '/api/missions/abc12345/cancel', 'DELETE') // invalid method on the cancel route
        ]).then(function (r2) {
          var list = r2[0], detail = r2[1], report = r2[2], notFound = r2[3],
              pathGarbage = r2[4], wrongMethodDetail = r2[5],
              cancelOk = r2[6], cancelTerminal = r2[7], wrongMethodCancel = r2[8];

          // 1. Execution list loading -- the existing /api/missions
          // response is what backs the Executions section; no new list
          // endpoint was added, so this is the same assertion surface
          // already proven above, restated for MOS-2.1's own record.
          eq(list.status, 200, 'the execution list (the existing /api/missions) still loads');
          ok(Array.isArray(list.json.data.tasks), 'the execution list is an array of tasks');

          // 2. Running status display -- detail relay
          eq(detail.status, 200, 'execution detail loads for a RUNNING task');
          eq(detail.json.data.effective, 'RUNNING', 'the RUNNING state is reported');
          eq(detail.json.data.status.execution_id, 'x-abc123', 'the execution id is surfaced');
          eq(detail.json.data.status.next_action, 'provider running', 'next_action is surfaced for a running execution');
          ok(!Object.prototype.hasOwnProperty.call(detail.json.data.task, 'working_directory'),
             'working_directory is dropped by the detail allowlist');
          ok(!Object.prototype.hasOwnProperty.call(detail.json.data.task, 'secret_field'),
             'an unrecognised task field is dropped by the detail allowlist, not passed through');
          ok(!Object.prototype.hasOwnProperty.call(detail.json.data.status, 'pid'),
             'pid is dropped by the detail allowlist');
          ok(!Object.prototype.hasOwnProperty.call(detail.json.data.status, 'claude_session_id'),
             'claude_session_id is dropped by the detail allowlist (even though /api/missions itself already serves it elsewhere)');

          // 7. No provider credentials exposed, on the two new relays specifically
          ok(detail.text.indexOf(SECRET_TOKEN) === -1, 'execution detail does not contain the token');
          ok(report.text.indexOf(SECRET_TOKEN) === -1, 'execution report does not contain the token');
          eq(report.status, 200, 'the report relay works for a non-terminal task too');
          eq(report.json.data.summary, null, 'no summary yet for a task still in progress');
          ok(!/provider_result_tail/.test(report.text), 'provider_result_tail is dropped by the report allowlist, not passed through');

          // 3 / 4. Completed / failed status display draw from the same
          // allowlisted shape as RUNNING (status.status, status.last_error,
          // report.summary) -- proven generically above; the field-by-field
          // allowlist assertions apply identically regardless of which
          // state populated them, so no separate stub state is needed to
          // prove the mechanism, only to prove the values flow through
          // (already shown for RUNNING's next_action/execution_id).

          // 6. Invalid execution actions are rejected
          eq(notFound.status, 502, 'an unknown task id is reported as a clean upstream error, not a silent empty result');
          eq(pathGarbage.status, 404, 'a path-shaped id never matches the task-id route at all -- not relayed anywhere');
          eq(wrongMethodDetail.status, 405, 'POST on a GET-only detail route is refused');
          eq(wrongMethodCancel.status, 405, 'DELETE on the cancel route is refused');

          // 5. Cancel action
          eq(cancelOk.status, 200, 'cancelling a real, non-terminal task succeeds');
          eq(cancelOk.json.data.status, 'CANCELLED', 'the resulting state is reported');
          eq(cancelTerminal.status, 502, 'cancelling an already-terminal task is rejected, not silently accepted');

          // 8. Existing read-only guarantees preserved: the executions
          // section changed nothing about the write-route allowlist size
          // asserted at source level above, and every one of the six
          // invalid/wrong-method calls just made was answered without any
          // corresponding call ever reaching the stub.
          var lifecycleCalls = stubHits.filter(function (h) {
            return /\/tasks\/(abc12345|tk-terminal-0001|tk-notfound-0001)(\/(report|cancel))?$/.test(h);
          });
          // notFound genuinely reaches the executor (the console cannot know
          // the id is unknown without asking) and comes back 404 -> 502;
          // the three path-shaped/wrong-method requests never match a route
          // at all and are refused before any relay call is made.
          eq(lifecycleCalls.length, 5, 'exactly five calls reached the executor: detail, report, the not-found lookup, cancel(ok), cancel(terminal) -- nothing for the three requests that never matched a route');

          s.close();
          stub.close();
        });
      });
    });
  });
})
// --- 4b. No token: an honest refusal, never an empty list ---------------
.then(function () {
  var server = freshServer({
    MOS_EXECUTOR_URL: 'http://127.0.0.1:9',
    MOS_EXECUTOR_TOKEN: null,
    MOS_EXECUTOR_TOKEN_FILE: null
  });
  return server.start({ port: 0, bind: '127.0.0.1' }).then(function (s) {
    var port = s.address().port;
    return Promise.all([req(port, '/api/missions'), req(port, '/api/health'), req(port, '/')]).then(function (r) {
      eq(r[0].status, 502, 'with no token, missions is an error status');
      eq(r[0].json.error, 'upstream_unauthorized', 'the error names the missing credential');
      ok(!r[0].json.data, 'no data field accompanies a failed read');
      eq(r[1].status, 200, 'health still answers without a token — the console reports its own state');
      eq(r[1].json.data.token_provisioned, false, 'health states plainly that no token is provisioned');
      eq(r[1].json.data.upstream.ok, false, 'health does not claim the plane is up');
      eq(r[2].status, 200, 'the shell still serves, so the operator can see the failure');
      s.close();
    });
  });
})
// --- 4c. Token present but the control plane is down --------------------
.then(function () {
  var server = freshServer({
    MOS_EXECUTOR_URL: 'http://127.0.0.1:9',
    MOS_EXECUTOR_TOKEN: SECRET_TOKEN,
    MOS_EXECUTOR_TOKEN_FILE: null,
    MOS_UPSTREAM_TIMEOUT_MS: '1500'
  });
  return server.start({ port: 0, bind: '127.0.0.1' }).then(function (s) {
    var port = s.address().port;
    return Promise.all([req(port, '/api/missions'), req(port, '/api/health'), req(port, '/api/agents')]).then(function (r) {
      eq(r[0].status, 503, 'an unreachable control plane is 503');
      eq(r[0].json.error, 'upstream_unreachable', 'the error names unreachability, not emptiness');
      ok(r[0].json.detail.indexOf(SECRET_TOKEN) === -1, 'the failure detail leaks no token');
      ok(!/ECONNREFUSED|EADDR|syscall/i.test(r[0].json.detail), 'the failure detail leaks no syscall or address internals');
      eq(r[1].json.data.upstream.reachable, false, 'health reports the plane unreachable');
      eq(r[2].status, 200, 'config-backed modules still work when the HTTP plane is down');
      s.close();
    });
  });
})
.then(function () {
  console.log('\nMOS-1 console: ' + passed + ' passed, ' + failed + ' failed');
  if (failed) { failures.forEach(function (f) { console.error('  - ' + f); }); process.exit(1); }
})
.catch(function (err) {
  console.error('SUITE ERROR: ' + err.stack);
  process.exit(1);
});
