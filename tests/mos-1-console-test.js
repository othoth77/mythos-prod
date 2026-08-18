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

// ===========================================================================
// 2. READ-ONLY, AT SOURCE LEVEL
// ===========================================================================

var serverCode = code(serverJs), upstreamCode = code(upstreamJs), appCode = code(appJs);
var shellMarkup = markup(shellHtml);

ok(/req\.method !== 'GET' && req\.method !== 'HEAD'/.test(serverCode),
   'server refuses every method but GET and HEAD before routing');
ok(!/readBody|req\.on\('data'/.test(serverCode), 'server contains no request-body reader at all');
['POST', 'PUT', 'PATCH', 'DELETE'].forEach(function (verb) {
  ok(!new RegExp("method:\\s*'" + verb + "'").test(upstreamCode), 'upstream client issues no ' + verb);
  ok(!new RegExp("method:\\s*'" + verb + "'").test(serverCode), 'server issues no ' + verb);
});
ok(/method: 'GET'/.test(upstreamCode), 'upstream client issues GET');
ok(!/child_process|[^.\w]exec\(|[^.\w]spawn\(|[^.\w]eval\(|new Function/.test(serverCode + upstreamCode + appCode),
   'no execution path anywhere in the console (MCC-1 precedent)');

// XSS: the whole client renders through textContent.
['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write'].forEach(function (sink) {
  ok(appCode.indexOf(sink) === -1, 'client never uses ' + sink);
});
ok(/textContent/.test(appCode), 'client assigns text through textContent');
ok(!/<script/.test(shellMarkup.replace(/<script src="\/(modules|app)\.js"><\/script>/g, '')),
   'the shell has no inline script');
ok(!/ style="/.test(shellMarkup), 'the shell has no inline style attribute');

// Static serving is a whitelist, not a resolved path.
ok(/hasOwnProperty\.call\(STATIC, pathname\)/.test(serverCode), 'static files come from an explicit whitelist');
ok(!/path\.join\([^)]*pathname/.test(serverCode), 'no request path is ever joined onto a directory');

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

function startStub() {
  return new Promise(function (resolve) {
    var s = http.createServer(function (req, res) {
      stubHits.push(req.method + ' ' + req.url);
      var u = req.url.split('?')[0];
      if (u === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, store: 'ok' })); return; }
      var auth = req.headers.authorization || '';
      if (auth !== 'Bearer ' + SECRET_TOKEN) { res.writeHead(401); res.end(JSON.stringify({ error: 'unauthorized' })); return; }
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
    s.listen(0, '127.0.0.1', function () { resolve(s); });
  });
}

function req(port, p, method) {
  return new Promise(function (resolve) {
    http.request({ host: '127.0.0.1', port: port, path: p, method: method || 'GET' }, function (res) {
      var b = '';
      res.on('data', function (d) { b += d; });
      res.on('end', function () {
        var json = null;
        try { json = JSON.parse(b); } catch (e) { /* static */ }
        resolve({ status: res.statusCode, headers: res.headers, text: b, json: json });
      });
    }).end();
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
      req(port, '/etc/passwd'), req(port, '/../../css/main.css'), req(port, '/missions')
    ]).then(function (r) {
      var shell = r[0], css = r[1], ccss = r[2], ajs = r[3], mjs = r[4];
      var health = r[5], missions = r[6], campaigns = r[7];
      var ev7 = r[8], evMax = r[9], budget = r[10], agents = r[11], providers = r[12];
      var roadmap = r[13], mods = r[14], post = r[15], del = r[16];
      var passwd = r[17], traverse = r[18], deep = r[19];

      eq(shell.status, 200, 'shell is served');
      ok(/MYTHOS OS/.test(shell.text), 'shell carries the Mythos OS title');
      eq(css.status, 200, 'mythos.css is served');
      eq(ccss.status, 200, 'console.css is served');
      eq(ajs.status, 200, 'app.js is served');
      eq(mjs.status, 200, 'modules.js is served');

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

      s.close();
      stub.close();
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
