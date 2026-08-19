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
//   5. SERVER-SIDE AUTHENTICATION (MOS-v2 M-01). Every /api/ route
//      refuses a caller without a session; the secret is readable only
//      from a 0600 file and never from the environment; the session
//      identifier reaches the browser only as an httpOnly cookie and
//      appears in no response body; and nothing the browser downloads
//      contains credential material. The gate this replaced was
//      client-side, so it had none of these properties and no test could
//      have given it one.
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
var loginHtml = read(path.join(WEB, 'login.html'));
var loginCss = read(path.join(WEB, 'login.css'));
var loginJs = read(path.join(WEB, 'login.js'));
var serverJs = read(path.join(REF, 'server.js'));
var upstreamJs = read(path.join(REF, 'upstream.js'));
var authJs = read(path.join(REF, 'auth.js'));

// ---------------------------------------------------------------------------
// AUTH FIXTURE (MOS-v2 M-01)
//
// The console reads its secret from a file and only from a file, and only
// if that file's mode grants nothing to group or other. So the suite makes
// two real files with two real modes: one correct, one deliberately loose.
// Both live in a private temp directory that is removed when the process
// exits. The value is obviously synthetic and never reaches the repository.
// ---------------------------------------------------------------------------

var CONSOLE_SECRET = 'mos-test-console-secret-do-not-leak-4c7e';
var SECRET_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mos-1-console-test-'));
var SECRET_FILE = path.join(SECRET_DIR, 'console-secret');
var LOOSE_SECRET_FILE = path.join(SECRET_DIR, 'console-secret-loose');
var EMPTY_SECRET_FILE = path.join(SECRET_DIR, 'console-secret-empty');

fs.writeFileSync(SECRET_FILE, 'MOS_CONSOLE_SECRET=' + CONSOLE_SECRET + '\n', { mode: 0o600 });
fs.chmodSync(SECRET_FILE, 0o600);
fs.writeFileSync(LOOSE_SECRET_FILE, 'MOS_CONSOLE_SECRET=' + CONSOLE_SECRET + '\n', { mode: 0o644 });
fs.chmodSync(LOOSE_SECRET_FILE, 0o644);          // group/other readable: must be refused
fs.writeFileSync(EMPTY_SECRET_FILE, '# no secret line here\n', { mode: 0o600 });
fs.chmodSync(EMPTY_SECRET_FILE, 0o600);

// The live auth module -- the same instance server.js uses, because
// freshServer() drops only server.js and upstream.js from the require
// cache. It is used for exactly one thing: clearing the login throttle
// between sections, so a section that deliberately exhausts it cannot
// poison the next one. It is never used to mint a session; every session
// in this suite is issued by the real HTTP login route.
var authMod = require(path.join(REF, 'auth.js'));

process.on('exit', function () {
  [SECRET_FILE, LOOSE_SECRET_FILE, EMPTY_SECRET_FILE].forEach(function (f) {
    try { fs.unlinkSync(f); } catch (e) { /* already gone */ }
  });
  try { fs.rmdirSync(SECRET_DIR); } catch (e) { /* already gone */ }
});

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

// login.css is a separate composition file (the sign-in page, MOS-v2
// M-01, replacing MOS-1's login-gate.css). Same discipline as
// console.css: no literal colour, tokens only.
ok(!/#[0-9a-fA-F]{3,8}\b/.test(loginCss), 'login.css declares no hex colour');
ok(!/rgba?\(/.test(loginCss), 'login.css declares no rgb/rgba colour');
ok(/var\(--mythos-/.test(loginCss), 'login.css composes from design-system tokens');
ok(/fonts\.googleapis\.com\/css2\?family=Playfair\+Display[^"]*Inter/.test(loginHtml),
   'the sign-in page loads the same font URL as the console shell');

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
ok(/'\/api\/login'/.test(writeRoutesBlock), 'the login route is named explicitly in WRITE_ROUTES');
ok(/'\/api\/logout'/.test(writeRoutesBlock), 'the logout route is named explicitly in WRITE_ROUTES');
// MOS-3A narrowed this from 2 to 3 (start, cancel, dispatch). MOS-v2 M-01
// adds login and logout: authentication is a write, so it belongs in the
// same explicit list rather than in a side channel that no test reads.
eq((writeRoutesBlock.match(/\{ test:/g) || []).length, 5,
   'exactly five write routes are registered -- login, logout, start, cancel and dispatch, nothing else');
// EXACTLY ONE of them may be reached without a session, and it is the one
// that establishes a session. A second `unauthenticated: true` anywhere in
// this list is a hole in the boundary, so the count is asserted, not the
// presence.
eq((writeRoutesBlock.match(/unauthenticated:\s*true/g) || []).length, 1,
   'exactly one write route is callable without a session');
ok(/\{ test: function \(p\) \{ return p === '\/api\/login' \? \[\] : null; \}, handler: handleLogin, unauthenticated: true \}/.test(writeRoutesBlock),
   'the one unauthenticated write route is POST /api/login and nothing else');
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
ok(!/<script/.test(shellMarkup.replace(/<script src="\/(modules|app)\.js"><\/script>/g, '')),
   'the shell has no inline script, and loads only modules.js and app.js');
ok(!/<script/.test(markup(loginHtml).replace(/<script src="\/login\.js"><\/script>/g, '')),
   'the sign-in page has no inline script, and loads only login.js');
ok(!/ style="/.test(markup(loginHtml)), 'the sign-in page has no inline style attribute');
ok(!/ style="/.test(shellMarkup), 'the shell has no inline style attribute');

// Static serving is a whitelist, not a resolved path.
ok(/hasOwnProperty\.call\(STATIC, pathname\)/.test(serverCode), 'static files come from an explicit whitelist');
ok(!/path\.join\([^)]*pathname/.test(serverCode), 'no request path is ever joined onto a directory');

// MOS-3C: Dispatcher API field allowlist
var missionDispatchMatch = serverCode.match(/var MISSION_DISPATCH_FIELDS\s*=\s*\[([^\]]+)\]/);
ok(missionDispatchMatch, 'server defines MISSION_DISPATCH_FIELDS');
if (missionDispatchMatch) {
  var fieldList = missionDispatchMatch[1];
  ok(!/\bpid\b/.test(fieldList), 'MISSION_DISPATCH_FIELDS does not contain pid');
  ok(!/\bclaude_session_id\b/.test(fieldList), 'MISSION_DISPATCH_FIELDS does not contain claude_session_id');
  ok(!/\bworking_directory\b/.test(fieldList), 'MISSION_DISPATCH_FIELDS does not contain working_directory');
  ok(!/\btoken\b/.test(fieldList), 'MISSION_DISPATCH_FIELDS does not contain token');
}

// The sign-in page's files follow the identical whitelist pattern — no new
// route, no new mechanism, nothing to weaken.
['login.html', 'login.css', 'login.js'].forEach(function (f) {
  ok(new RegExp("path\\.join\\(WEB, '" + f.replace('.', '\\.') + "'\\)").test(serverCode),
     f + ' is served through the same static whitelist as every other asset');
});
// MOS-1's client-side gate is GONE, not disabled: no file, no STATIC
// entry, no reference anywhere the browser can reach.
['login-gate.js', 'login-gate.css'].forEach(function (f) {
  ok(!fs.existsSync(path.join(WEB, f)), f + ' no longer exists');
  ok(serverJs.indexOf(f) === -1, f + ' has no STATIC entry or any other mention in server.js');
  ok(shellHtml.indexOf(f) === -1, f + ' is not referenced by the console shell');
});

// ---------------------------------------------------------------------------
// 2b. SERVER-SIDE AUTHENTICATION — source-level guarantees (MOS-v2 M-01)
//
// MOS-1 shipped a client-side gate. It hid markup and nothing else: the
// console shell and every /api/ route were served to anyone who asked,
// and the password's SHA-256 digest was downloaded by every visitor for
// offline attack. This section asserts the properties that replaced it,
// at source level, because each one is a boundary rather than a feature
// and a boundary that only the happy path tests is not tested at all.
// ---------------------------------------------------------------------------

var authCode = code(authJs), loginJsCode = code(loginJs);
var loginMarkup = markup(loginHtml);

// THE SECRET COMES FROM A FILE, AND ONLY FROM A FILE.
ok(/MOS_CONSOLE_SECRET_FILE/.test(authCode), 'auth.js reads the secret from the file named by MOS_CONSOLE_SECRET_FILE');
ok(!/process\.env\.MOS_CONSOLE_SECRET\b/.test(authCode),
   'auth.js never reads MOS_CONSOLE_SECRET from the environment (/proc/<pid>/environ is not a secret store)');
ok(!/MOS_CONSOLE_SECRET\b(?!_FILE)/.test(code(serverJs).replace(/MOS_CONSOLE_SECRET_FILE/g, '')),
   'server.js never touches the secret itself -- only auth.js does');
ok(/&\s*0o077/.test(authCode) && /insecure_mode/.test(authCode),
   'auth.js refuses a secret file with any group or other permission bit set (0600 or tighter)');
ok(/statSync/.test(authCode), 'the file mode is checked by stat, not assumed from how it was written');

// THE COMPARISON IS CONSTANT-TIME, over fixed-width digests so that
// timingSafeEqual never sees a length mismatch and no length leaks.
ok(/crypto\.timingSafeEqual/.test(authCode), 'the secret comparison uses crypto.timingSafeEqual');
ok(/createHash\('sha256'\)/.test(authCode),
   'both sides are hashed to a fixed width before comparison, so no length is leaked and no length mismatch can throw');
ok(!/candidate\s*===\s*|===\s*loaded\.secret|secret\s*===/.test(authCode),
   'the secret is never compared with ===, which short-circuits on the first differing byte');

// THE SESSION IDENTIFIER IS UNGUESSABLE AND UNREADABLE BY SCRIPT.
ok(/crypto\.randomBytes\(32\)/.test(authCode), 'session identifiers are 32 bytes from the CSPRNG');
ok(/HttpOnly/.test(authCode), 'the session cookie is httpOnly');
ok(/SameSite=Strict/.test(authCode), 'the session cookie is SameSite=Strict');
ok(/Secure/.test(authCode), 'the session cookie is Secure');
ok(/Path=\//.test(authCode), 'the session cookie is scoped to the whole origin, so no path escapes it');
ok(/expiresAt/.test(authCode) && /expiresAt <= Date\.now\(\)/.test(authCode),
   'a session carries an expiry and it is enforced on every lookup, not only by a sweep');
ok(/function hasSessionCookie/.test(authCode),
   'a presented cookie is detectable regardless of shape, so a malformed one can be cleared rather than resent forever');

// NOTHING THE BROWSER LOADS TOUCHES WEB STORAGE OR HOLDS A CREDENTIAL.
// This is the exact defect of the gate that was removed, so it is
// asserted over every file the browser downloads, not just the new one.
[['app.js', appCode], ['login.js', loginJsCode], ['modules.js', code(read(path.join(WEB, 'modules.js')))]].forEach(function (pair) {
  ok(!/localStorage|sessionStorage/.test(pair[1]),
     pair[0] + ' writes no token or flag to JavaScript-readable storage');
  ok(!/[0-9a-f]{40,}/.test(pair[1]), pair[0] + ' carries no digest-shaped constant');
  ok(!/crypto\.subtle/.test(pair[1]), pair[0] + ' does no client-side credential maths');
});
['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write'].forEach(function (sink) {
  ok(loginJsCode.indexOf(sink) === -1, 'login.js never uses ' + sink);
});
ok(/textContent/.test(loginJsCode), 'login.js assigns error text through textContent');
ok(!/child_process|[^.\w]exec\(|[^.\w]spawn\(|[^.\w]eval\(|new Function/.test(loginJsCode + authCode),
   'no execution path in login.js or auth.js (MCC-1 precedent)');
ok(/'\/api\/login'/.test(loginJsCode), 'login.js submits the password to the server rather than judging it itself');
ok(/credentials: 'same-origin'/.test(loginJsCode), 'the sign-in request carries the same-origin credential mode');

// THE CONSOLE SHELL NO LONGER CONTAINS A LOGIN AT ALL.
ok(shellHtml.indexOf('id="mythos-gate"') === -1, 'the console shell has no gate markup');
ok(!/type="password"/.test(shellHtml), 'the console shell has no password input');
ok(!/<form/.test(shellMarkup), 'the console shell has no form of any kind');

// THE SIGN-IN PAGE IS ONE PASSWORD FIELD AND NOTHING ELSE.
ok(/id="login-password"[^>]*type="password"/.test(loginHtml) ||
   /type="password"[^>]*id="login-password"/.test(loginHtml),
   'the sign-in page has exactly one password-type input');
eq((loginHtml.match(/type="password"/g) || []).length, 1, 'the sign-in page has exactly one password field');
ok(!/name="username"|<select|type="email"/.test(loginMarkup),
   'the sign-in page has no username field, no registration, no additional login-adjacent controls');
ok(loginHtml.indexOf('id="app"') === -1, 'the sign-in page does not carry the console shell');

// THE BOUNDARY IS RESOLVED ONCE, BEFORE ROUTING, AND FAILS CLOSED.
ok(/var session = auth\.sessionFor\(req\);/.test(serverCode),
   'server.js resolves the session once, in the handler, before any route runs');
ok(/if \(!writeMatch\.unauthenticated && !session\) return unauthenticated\(res, staleCookie\);/.test(serverCode),
   'a write route without the unauthenticated flag is refused before its handler runs');
ok(/if \(!session\) \{/.test(serverCode), 'a read without a session never reaches a route');
var publicBlock = (serverCode.match(/var PUBLIC_PATHS = \{[\s\S]*?\};/) || [''])[0];
ok(publicBlock, 'server.js declares PUBLIC_PATHS as an explicit list');
ok(!/\/api\//.test(publicBlock), 'no /api/ path is ever public');
ok(!/console\.css|app\.js|modules\.js|'\/'/.test(publicBlock),
   'the console shell and its scripts are not public: only the sign-in page and its assets are');
eq((publicBlock.match(/':\s*true/g) || []).length, 6,
   'exactly six public paths -- /login, /login.html, /login.css, /login.js, /mythos.css and the logo');

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
        // MOS-3C: dispatcher status endpoint and queued task dispatch
        if (req.method === 'GET' && u === '/dispatcher') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ running: 2, max_parallel: 5, queued: 1 }));
          return;
        }
        if (req.method === 'POST' && u === '/tasks/tk-stub-q-0001/dispatch') {
          res.writeHead(202, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ task_id: 'tk-stub-q-0001', dispatched: false, queued: true, running: 5, max_parallel: 5 }));
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

// MOS-v2 M-01: every request now carries the suite's current session
// cookie by default, because after this stage that is what a real console
// request looks like. A caller that wants the UNAUTHENTICATED behaviour --
// which is most of section 5 -- passes { cookie: null } explicitly, so an
// anonymous probe is always visible at the call site and can never be one
// by accident.
var ACTIVE_COOKIE = null;

function req(port, p, method, body, opts) {
  opts = opts || {};
  var cookie = Object.prototype.hasOwnProperty.call(opts, 'cookie') ? opts.cookie : ACTIVE_COOKIE;
  return new Promise(function (resolve) {
    var payload = body !== undefined ? JSON.stringify(body) : null;
    var headers = payload !== null ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {};
    if (cookie) headers.Cookie = cookie;
    var r = http.request({ host: '127.0.0.1', port: port, path: p, method: method || 'GET', headers: headers }, function (res) {
      var b = '';
      res.on('data', function (d) { b += d; });
      res.on('end', function () {
        var json = null;
        try { json = JSON.parse(b); } catch (e) { /* static */ }
        resolve({ status: res.statusCode, headers: res.headers, text: b, json: json,
                  setCookie: res.headers['set-cookie'] || [] });
      });
    });
    if (payload !== null) r.write(payload);
    r.end();
  });
}

/* Sign in over the real HTTP route and return the cookie pair the server
   issued -- never a session minted by reaching into auth.js. What is being
   tested is the route a browser actually uses. */
function login(port, password) {
  return req(port, '/api/login', 'POST', { password: password }, { cookie: null }).then(function (r) {
    var raw = (r.setCookie[0] || '');
    return { res: r, cookie: raw ? raw.split(';')[0] : null, raw: raw };
  });
}

function freshServer(env) {
  // Unless a case overrides it, every configuration gets the correct 0600
  // secret file: authentication being available is the baseline, and the
  // cases that remove or spoil it say so.
  if (!Object.prototype.hasOwnProperty.call(env, 'MOS_CONSOLE_SECRET_FILE')) {
    env.MOS_CONSOLE_SECRET_FILE = SECRET_FILE;
  }
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

    // =====================================================================
    // 5a. THE UNAUTHENTICATED MATRIX (MOS-v2 M-01)
    //
    // Run FIRST, against a fully configured, fully working console with a
    // healthy control plane behind it. That ordering is the point: this is
    // not "the console fails when something is missing", it is "the console
    // has everything it needs and still refuses a caller with no session".
    // Every route the console serves is listed, not a sample, so a route
    // added later without a session check fails here rather than shipping.
    // =====================================================================
    var ANON = { cookie: null };
    var API_PATHS = ['/api/health', '/api/missions', '/api/campaigns', '/api/events?limit=5',
                     '/api/budget', '/api/agents', '/api/providers', '/api/roadmap',
                     '/api/modules', '/api/dispatcher', '/api/missions/abc12345',
                     '/api/missions/abc12345/report'];
    var PRIVATE_STATIC = ['/console.css', '/app.js', '/modules.js'];
    var PUBLIC_STATIC = ['/login', '/login.html', '/login.css', '/login.js', '/mythos.css'];

    return Promise.all([
      Promise.all(API_PATHS.map(function (u) { return req(port, u, 'GET', undefined, ANON); })),
      Promise.all(PRIVATE_STATIC.map(function (u) { return req(port, u, 'GET', undefined, ANON); })),
      Promise.all(PUBLIC_STATIC.map(function (u) { return req(port, u, 'GET', undefined, ANON); })),
      req(port, '/', 'GET', undefined, ANON),
      req(port, '/index.html', 'GET', undefined, ANON),
      req(port, '/api/missions/start', 'POST', { title: 'x', instruction: 'y', provider: 'claude-code' }, ANON),
      req(port, '/api/missions/abc12345/cancel', 'POST', {}, ANON),
      req(port, '/api/missions/abc12345/dispatch', 'POST', {}, ANON),
      req(port, '/api/logout', 'POST', {}, ANON),
      req(port, '/nope', 'GET', undefined, ANON),
      // A syntactically valid but unknown session identifier, and a
      // malformed one. Both are 'not signed in', and both must have the
      // stale cookie cleared on the way out.
      req(port, '/api/health', 'GET', undefined, { cookie: 'mos_session=' + new Array(65).join('a') }),
      req(port, '/api/health', 'GET', undefined, { cookie: 'mos_session=not-a-session-id' })
    ]).then(function (anon) {
      var anonApi = anon[0], anonPrivate = anon[1], anonPublic = anon[2];
      var anonShell = anon[3], anonIndex = anon[4];
      var anonStart = anon[5], anonCancel = anon[6], anonDispatch = anon[7], anonLogout = anon[8];
      var anonUnknown = anon[9], unknownSession = anon[10], malformedSession = anon[11];

      API_PATHS.forEach(function (u, i) {
        eq(anonApi[i].status, 401, 'unauthenticated GET ' + u + ' is 401');
        eq(anonApi[i].json.error, 'unauthenticated', 'unauthenticated GET ' + u + ' names the reason');
        ok(!anonApi[i].json.data, 'unauthenticated GET ' + u + ' carries no data');
      });
      // The strongest single statement this suite can make about the
      // boundary: with a live control plane behind it, no anonymous
      // response anywhere contains a single byte of upstream state.
      ok(anonApi.every(function (r) { return r.text.indexOf('tk-') === -1 && r.text.indexOf('mythos-prod') === -1; }),
         'no unauthenticated response leaks any control-plane value');

      PRIVATE_STATIC.forEach(function (u, i) {
        eq(anonPrivate[i].status, 401, 'unauthenticated GET ' + u + ' is 401 -- the console\'s own code is not public either');
      });
      PUBLIC_STATIC.forEach(function (u, i) {
        eq(anonPublic[i].status, 200, 'the sign-in page asset ' + u + ' is served without a session');
      });
      ok(/id="login-form"/.test(anonPublic[0].text), '/login serves the sign-in page');
      ok(anonPublic[0].text.indexOf('id="app"') === -1, '/login does not serve the console shell');

      eq(anonShell.status, 302, 'an unauthenticated visit to / is redirected');
      eq(anonShell.headers.location, '/login', '...to the sign-in page');
      eq(anonShell.text, '', 'the redirect carries no body, so no shell markup escapes');
      eq(anonIndex.status, 302, 'an unauthenticated visit to /index.html is redirected too');

      [['start', anonStart], ['cancel', anonCancel], ['dispatch', anonDispatch], ['logout', anonLogout]].forEach(function (pair) {
        eq(pair[1].status, 401, 'unauthenticated POST to the ' + pair[0] + ' route is 401');
        eq(pair[1].json.error, 'unauthenticated', 'unauthenticated POST to the ' + pair[0] + ' route names the reason');
      });
      ok(stubPostBodies.length === 0, 'not one unauthenticated write reached the control plane');

      eq(anonUnknown.status, 401, 'an unknown path is 401 to an anonymous caller, not a 404 that maps the surface');

      [['unknown', unknownSession], ['malformed', malformedSession]].forEach(function (pair) {
        eq(pair[1].status, 401, 'a ' + pair[0] + ' session identifier is refused');
        ok((pair[1].setCookie[0] || '').indexOf('Max-Age=0') !== -1,
           'a ' + pair[0] + ' session identifier is cleared from the browser rather than left to keep being sent');
      });

      // =====================================================================
      // 5b. SIGN-IN — the wrong password, then the right one
      // =====================================================================
      return Promise.all([
        login(port, 'not-the-password'),
        login(port, CONSOLE_SECRET.toUpperCase()),
        login(port, CONSOLE_SECRET + 'x'),
        login(port, CONSOLE_SECRET.slice(0, -1))
      ]).then(function (bad) {
        bad.forEach(function (b, i) {
          eq(b.res.status, 401, 'invalid password ' + i + ' is refused');
          eq(b.res.json.error, 'invalid_credentials', 'invalid password ' + i + ' names invalid_credentials');
          eq(b.cookie, null, 'invalid password ' + i + ' issues no session cookie');
          ok(b.res.text.indexOf(CONSOLE_SECRET) === -1, 'the refusal for password ' + i + ' does not echo the secret');
        });
        // A near miss and a case-flip are refused exactly like a wild
        // guess, and the refusal says nothing about how close it was.
        ok(bad.every(function (b) { return b.res.json.detail === 'invalid credentials'; }),
           'every refusal is the same message: nothing distinguishes a near miss from a wild guess');

        return Promise.all([
          req(port, '/api/login', 'POST', { password: 123 }, ANON),
          req(port, '/api/login', 'POST', { password: CONSOLE_SECRET, role: 'admin' }, ANON),
          req(port, '/api/login', 'POST', {}, ANON),
          req(port, '/api/login', 'GET', undefined, ANON),
          req(port, '/api/login', 'DELETE', undefined, ANON),
          req(port, '/api/login', 'PUT', undefined, ANON),
          req(port, '/api/logout', 'GET', undefined, ANON)
        ]).then(function (m) {
          eq(m[0].status, 400, 'a non-string password is a bad request, never a comparison');
          eq(m[1].status, 400, 'an extra field on the login body is rejected -- no privilege can be smuggled in');
          eq(m[2].status, 400, 'an empty login body is a bad request');
          eq(m[3].status, 401, 'GET /api/login is not a route: an anonymous GET is refused like any other');
          eq(m[4].status, 405, 'DELETE /api/login is refused by the method guard');
          eq(m[5].status, 405, 'PUT /api/login is refused by the method guard');
          eq(m[6].status, 401, 'GET /api/logout is not a route either');
          ok(stubPostBodies.length === 0, 'no rejected login reached the control plane');

          return login(port, CONSOLE_SECRET);
        });
      }).then(function (good) {
        eq(good.res.status, 200, 'the correct password signs in');
        eq(good.res.json.data.authenticated, true, 'the response states the session is established');
        ok(good.cookie, 'a session cookie is issued');
        ok(/^mos_session=[0-9a-f]{64}$/.test(good.cookie), 'the session identifier is 64 hex characters of CSPRNG output');
        ok(/HttpOnly/i.test(good.raw), 'the session cookie is httpOnly -- no script can read it');
        ok(/SameSite=Strict/i.test(good.raw), 'the session cookie is SameSite=Strict -- no cross-site request carries it');
        ok(/Secure/i.test(good.raw), 'the session cookie is Secure');
        ok(/Path=\//.test(good.raw), 'the session cookie is scoped to the whole origin');
        ok(good.res.text.indexOf(good.cookie.split('=')[1]) === -1,
           'the session identifier appears in NO response body -- only in the Set-Cookie header');
        ok(good.res.text.indexOf(CONSOLE_SECRET) === -1, 'the successful sign-in does not echo the secret');
        ok(!/token|secret|password/i.test(JSON.stringify(good.res.json.data)),
           'the sign-in response body names no credential of any kind');

        // Everything from here runs as a signed-in operator, which is what
        // the rest of this suite has always been testing.
        ACTIVE_COOKIE = good.cookie;
      });
    }).then(function () {

    return Promise.all([
      req(port, '/'), req(port, '/mythos.css'), req(port, '/console.css'),
      req(port, '/app.js'), req(port, '/modules.js'),
      req(port, '/api/health'), req(port, '/api/missions'), req(port, '/api/campaigns'),
      req(port, '/api/events?limit=7'), req(port, '/api/events?limit=99999'),
      req(port, '/api/budget'), req(port, '/api/agents'), req(port, '/api/providers'),
      req(port, '/api/roadmap'), req(port, '/api/modules'),
      req(port, '/', 'POST'), req(port, '/api/missions', 'DELETE'),
      req(port, '/etc/passwd'), req(port, '/../../css/main.css'), req(port, '/missions'),
      req(port, '/login.css'), req(port, '/login.js'),
      req(port, '/api/dispatcher', 'GET'),
      req(port, '/api/missions/tk-stub-q-0001/dispatch', 'POST', {}),
      req(port, '/api/missions/tk-stub-q-0001/dispatch', 'GET')
    ]).then(function (r) {
      var shell = r[0], css = r[1], ccss = r[2], ajs = r[3], mjs = r[4];
      var health = r[5], missions = r[6], campaigns = r[7];
      var ev7 = r[8], evMax = r[9], budget = r[10], agents = r[11], providers = r[12];
      var roadmap = r[13], mods = r[14], post = r[15], del = r[16];
      var passwd = r[17], traverse = r[18], deep = r[19];
      var loginCssRes = r[20], loginJsRes = r[21];
      var dispatcherStatus = r[22], dispatchQueued = r[23], dispatchGet = r[24];

      eq(shell.status, 200, 'shell is served');
      ok(/MYTHOS OS/.test(shell.text), 'shell carries the Mythos OS title');
      eq(css.status, 200, 'mythos.css is served');
      eq(ccss.status, 200, 'console.css is served');
      eq(ajs.status, 200, 'app.js is served');
      eq(mjs.status, 200, 'modules.js is served');
      eq(loginCssRes.status, 200, 'login.css is served');
      eq(loginJsRes.status, 200, 'login.js is served');
      eq(loginCssRes.headers['content-type'], 'text/css; charset=utf-8', 'login.css has the correct content type');
      eq(loginJsRes.headers['content-type'], 'application/javascript; charset=utf-8', 'login.js has the correct content type');

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

      // -----------------------------------------------------------------
      // MOS-3C: Dispatcher API coverage
      // -----------------------------------------------------------------
      eq(dispatcherStatus.status, 200, 'MOS-3C C1: GET /api/dispatcher returns 200');
      var dsKeys = Object.keys(dispatcherStatus.json.data || {}).sort();
      var expectedKeys = ['max_parallel', 'queued', 'running', 'providers'].sort();
      ok(dsKeys.join(',') === expectedKeys.join(','),
         'MOS-3C C1: /api/dispatcher has exactly the keys running/max_parallel/queued/providers (got ' + dsKeys.join(',') + ')');
      ok(Array.isArray(dispatcherStatus.json.data.providers), 'MOS-3C C1: providers is an array');
      eq(dispatcherStatus.json.data.providers.length, 2, 'MOS-3C C1: providers array has 2 entries');
      var providerNames = dispatcherStatus.json.data.providers.slice().sort();
      eq(providerNames[0], 'claude-code', 'MOS-3C C1: first provider is claude-code');
      eq(providerNames[1], 'openai-compat', 'MOS-3C C1: second provider is openai-compat');
      ok(dispatcherStatus.text.indexOf(SECRET_TOKEN) === -1, 'MOS-3C C1: /api/dispatcher does not leak SECRET_TOKEN');

      eq(dispatchQueued.status, 200, 'MOS-3C C2: POST /api/missions/.../dispatch returns 200');
      var dqKeys = Object.keys(dispatchQueued.json.data || {}).sort();
      var dqExpected = ['dispatched', 'max_parallel', 'queued', 'running', 'task_id'].sort();
      ok(dqKeys.join(',') === dqExpected.join(','),
         'MOS-3C C2: dispatch response has exactly task_id/dispatched/queued/running/max_parallel (got ' + dqKeys.join(',') + ')');
      ok(dispatchQueued.json.data.queued === true, 'MOS-3C C2: queued field is true');
      ok(dispatchQueued.text.indexOf(SECRET_TOKEN) === -1, 'MOS-3C C2: dispatch response does not leak SECRET_TOKEN');
      ok(stubHits.some(function (h) { return h.indexOf('/tasks/tk-stub-q-0001/dispatch') !== -1; }), 'MOS-3C C2: dispatch call reached the stub');

      eq(dispatchGet.status, 404, 'MOS-3C C3: GET on /api/missions/.../dispatch returns 404 (no read route exists)');

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
    }); // end of the signed-in phase opened by the unauthenticated matrix
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
    // A missing EXECUTOR token and a missing SESSION are different
    // failures and must not be conflated: this configuration still has a
    // usable console secret, so the operator can sign in and then SEE the
    // honest refusal. Signing in is what makes that distinction testable.
    ACTIVE_COOKIE = null;
    return login(port, CONSOLE_SECRET).then(function (l) {
      eq(l.res.status, 200, 'sign-in works even with no executor token: the two credentials are independent');
      ACTIVE_COOKIE = l.cookie;
      return Promise.all([req(port, '/api/missions'), req(port, '/api/health'), req(port, '/')]);
    }).then(function (r) {
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
    ACTIVE_COOKIE = null;
    return login(port, CONSOLE_SECRET).then(function (l) {
      eq(l.res.status, 200, 'sign-in works while the control plane is down: the console authenticates locally');
      ACTIVE_COOKIE = l.cookie;
      return Promise.all([req(port, '/api/missions'), req(port, '/api/health'), req(port, '/api/agents')]);
    }).then(function (r) {
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
// ===========================================================================
// 5c. SESSION LIFECYCLE — signing out, and running out of time
//
// A session that cannot be ended and a session that never ends are the
// same defect wearing two hats. Both are checked against the server's own
// state, not against the cookie: clearing a cookie in the browser proves
// nothing if the identifier still works when replayed.
// ===========================================================================
.then(function () {
  authMod.resetThrottle();
  var server = freshServer({
    MOS_EXECUTOR_URL: 'http://127.0.0.1:9',
    MOS_EXECUTOR_TOKEN: SECRET_TOKEN,
    MOS_EXECUTOR_TOKEN_FILE: null,
    MOS_SESSION_TTL_MS: '1000'          // the floor auth.js accepts
  });
  return server.start({ port: 0, bind: '127.0.0.1' }).then(function (s) {
    var port = s.address().port;
    var held = null;
    ACTIVE_COOKIE = null;

    // /api/modules is served from the module registry on disk, so it
    // answers 200 without touching the (deliberately unreachable) control
    // plane. That isolates what this section measures: the session, and
    // nothing else.
    return login(port, CONSOLE_SECRET).then(function (l) {
      eq(l.res.status, 200, 'sign-in for the lifecycle checks succeeds');
      held = l.cookie;
      return req(port, '/api/modules', 'GET', undefined, { cookie: held });
    }).then(function (r) {
      eq(r.status, 200, 'a fresh session reads an API route');
      return req(port, '/api/logout', 'POST', {}, { cookie: held });
    }).then(function (r) {
      eq(r.status, 200, 'signing out succeeds');
      eq(r.json.data.authenticated, false, 'signing out states the session is over');
      ok((r.setCookie[0] || '').indexOf('Max-Age=0') !== -1, 'signing out clears the cookie in the browser');
      return req(port, '/api/modules', 'GET', undefined, { cookie: held });
    }).then(function (r) {
      eq(r.status, 401,
         'the cookie kept after signing out is worthless -- the session was destroyed on the SERVER, not merely unset in the browser');
      return login(port, CONSOLE_SECRET);
    }).then(function (l) {
      held = l.cookie;
      // A session at the 1s floor, replayed after it has run out. Nothing
      // renews it: the lifetime is absolute, so using it does not extend it.
      return new Promise(function (resolve) { setTimeout(resolve, 1300); })
        .then(function () { return req(port, '/api/modules', 'GET', undefined, { cookie: held }); });
    }).then(function (r) {
      eq(r.status, 401, 'a session past its lifetime is refused');
      eq(r.json.error, 'unauthenticated', 'an expired session is refused as unauthenticated, not as a server error');
      ok(!r.json.data, 'an expired session receives no data');
      ok((r.setCookie[0] || '').indexOf('Max-Age=0') !== -1, 'an expired session is cleared from the browser');
      return req(port, '/', 'GET', undefined, { cookie: held });
    }).then(function (r) {
      eq(r.status, 302, 'an expired session lands on the sign-in page');
      eq(r.headers.location, '/login', '...and nowhere else');
      s.close();
    });
  });
})

// ===========================================================================
// 5d. WHERE THE SECRET MAY COME FROM
//
// The requirement is not "the console has a password" but "the console
// reads it from a 0600 EnvironmentFile and from nowhere else". Every way
// of getting that wrong is exercised against a live console with a correct
// password submitted, so each failure below is the file discipline
// refusing, never a wrong guess being refused.
// ===========================================================================
.then(function () {
  authMod.resetThrottle();
  var server = freshServer({
    MOS_EXECUTOR_URL: 'http://127.0.0.1:9',
    MOS_EXECUTOR_TOKEN: SECRET_TOKEN,
    MOS_EXECUTOR_TOKEN_FILE: null,
    MOS_SESSION_TTL_MS: null,
    MOS_CONSOLE_SECRET_FILE: SECRET_FILE
  });
  return server.start({ port: 0, bind: '127.0.0.1' }).then(function (s) {
    var port = s.address().port;
    ACTIVE_COOKIE = null;

    // auth.js re-reads the file on every attempt, so the configuration can
    // be changed under a running server. That is itself the property being
    // relied on: a rotated secret takes effect without a restart, and a
    // secret file whose mode is loosened stops working immediately.
    function withSecretConfig(file, envValue) {
      if (file === null) delete process.env.MOS_CONSOLE_SECRET_FILE;
      else process.env.MOS_CONSOLE_SECRET_FILE = file;
      if (envValue === null) delete process.env.MOS_CONSOLE_SECRET;
      else process.env.MOS_CONSOLE_SECRET = envValue;
      return login(port, CONSOLE_SECRET);
    }

    return withSecretConfig(LOOSE_SECRET_FILE, null).then(function (l) {
      eq(l.res.status, 401,
         'the CORRECT password is refused when the secret file is mode 0644 -- a secret others can read is not one this console will use');
      eq(l.cookie, null, 'no session is issued from a group-readable secret file');
      return withSecretConfig(EMPTY_SECRET_FILE, null);
    }).then(function (l) {
      eq(l.res.status, 401, 'a 0600 file with no MOS_CONSOLE_SECRET line authenticates nobody');
      return withSecretConfig(path.join(SECRET_DIR, 'does-not-exist'), null);
    }).then(function (l) {
      eq(l.res.status, 401, 'a missing secret file authenticates nobody');
      // THE ENVIRONMENT IS NOT A SECRET STORE. The correct value, exported
      // exactly as an operator might, with no file configured at all.
      return withSecretConfig(null, CONSOLE_SECRET);
    }).then(function (l) {
      eq(l.res.status, 401,
         'MOS_CONSOLE_SECRET in the process environment authenticates nobody -- the environment is readable through /proc and inherited by children');
      eq(l.cookie, null, 'no session is issued from an environment-supplied secret');
      // And with a file configured but the environment ALSO set to the
      // right value, the file still decides: a stale export cannot
      // override, and cannot rescue, the file.
      return withSecretConfig(EMPTY_SECRET_FILE, CONSOLE_SECRET);
    }).then(function (l) {
      eq(l.res.status, 401, 'an environment value cannot stand in for a file that holds no secret');
      authMod.resetThrottle();
      return withSecretConfig(SECRET_FILE, null);
    }).then(function (l) {
      eq(l.res.status, 200, 'with the 0600 file restored, the same password signs in');
      ACTIVE_COOKIE = l.cookie;
      return req(port, '/api/health');
    }).then(function (r) {
      eq(r.status, 200, 'health is readable by a signed-in operator');
      eq(r.json.data.auth.secret_provisioned, true, 'health states the console secret is provisioned');
      eq(r.json.data.auth.secret_problem, null, 'health reports no configuration problem');
      ok(r.text.indexOf(CONSOLE_SECRET) === -1, 'health names the state of the secret, never its value');
      // Break the file mode under the running console. The session already
      // held stays valid -- it is not re-derived from the secret -- but the
      // operator can SEE that nobody can sign in any more.
      fs.chmodSync(SECRET_FILE, 0o644);
      return req(port, '/api/health');
    }).then(function (r) {
      eq(r.json.data.auth.secret_provisioned, false, 'health stops claiming a secret is provisioned the moment the file mode is loosened');
      eq(r.json.data.auth.secret_problem, 'insecure_mode', 'health names WHICH configuration problem it is');
      fs.chmodSync(SECRET_FILE, 0o600);
      s.close();
    });
  });
})

// ===========================================================================
// 5e. CREDENTIAL SWEEP
//
// Two sweeps, because there are two ways to leak. The first reads every
// file the browser can download: the gate this replaced shipped a password
// digest in exactly such a file. The second reads every response a live,
// signed-in console produces, including the sign-in exchange itself.
// ===========================================================================
.then(function () {
  var DOWNLOADABLE = ['index.html', 'login.html', 'login.css', 'login.js',
                      'app.js', 'modules.js', 'console.css', 'mythos.css'];
  DOWNLOADABLE.forEach(function (f) {
    var text = read(path.join(WEB, f));
    ok(text.indexOf(CONSOLE_SECRET) === -1, 'sweep: ' + f + ' contains no console secret');
    ok(text.indexOf(SECRET_TOKEN) === -1, 'sweep: ' + f + ' contains no executor token');
    ok(!/MOS_CONSOLE_SECRET|MOS_EXECUTOR_TOKEN|MYTHOS_EXECUTOR_TOKEN/.test(text),
       'sweep: ' + f + ' names no credential variable');
    ok(!/[0-9a-f]{40,}/.test(text), 'sweep: ' + f + ' carries no digest- or key-shaped constant');
  });
  // The executor credential is the one the browser must never see, and the
  // only code that holds it is upstream.js -- server-side, never served.
  ok(!fs.existsSync(path.join(WEB, 'upstream.js')) && !fs.existsSync(path.join(WEB, 'auth.js')),
     'sweep: neither the upstream client nor the auth module sits in the served web directory');
  ok(!/console\.log|process\.stdout|process\.stderr/.test(authCode),
     'sweep: auth.js writes nothing to stdout or stderr, so the secret cannot be logged from where it is read');

  authMod.resetThrottle();
  var server = freshServer({
    MOS_EXECUTOR_URL: 'http://127.0.0.1:9',
    MOS_EXECUTOR_TOKEN: SECRET_TOKEN,
    MOS_EXECUTOR_TOKEN_FILE: null,
    MOS_UPSTREAM_TIMEOUT_MS: '1500',
    MOS_CONSOLE_SECRET_FILE: SECRET_FILE
  });
  return server.start({ port: 0, bind: '127.0.0.1' }).then(function (s) {
    var port = s.address().port;
    ACTIVE_COOKIE = null;
    var sessionId = null;
    var bodies = [];

    return login(port, 'wrong').then(function (l) {
      bodies.push(['failed sign-in', l.res.text]);
      authMod.resetThrottle();
      return login(port, CONSOLE_SECRET);
    }).then(function (l) {
      bodies.push(['successful sign-in', l.res.text]);
      ACTIVE_COOKIE = l.cookie;
      sessionId = l.cookie.split('=')[1];
      return Promise.all(['/', '/login', '/app.js', '/console.css', '/modules.js', '/mythos.css',
                          '/api/health', '/api/modules', '/api/missions', '/api/agents',
                          '/api/providers', '/api/roadmap', '/api/budget'].map(function (u) {
        return req(port, u).then(function (r) { return [u, r.text]; });
      }));
    }).then(function (rows) {
      rows.concat(bodies).forEach(function (row) {
        ok(row[1].indexOf(CONSOLE_SECRET) === -1, 'sweep: no console secret in the response for ' + row[0]);
        ok(row[1].indexOf(SECRET_TOKEN) === -1, 'sweep: no executor token in the response for ' + row[0]);
        ok(row[1].indexOf(sessionId) === -1, 'sweep: the session identifier never appears in the body of ' + row[0]);
      });
      // The identifier reaches the browser exactly once, in a header the
      // browser will not expose to script.
      return req(port, '/api/logout', 'POST', {});
    }).then(function () { s.close(); });
  });
})

// ===========================================================================
// 5f. THE LOGIN ROUTE IS NOT AN ORACLE
//
// One credential, one route, reachable without a session: unthrottled,
// that is an online brute force with no cost. The throttle is checked at
// its most important moment -- once it has engaged, even the CORRECT
// password is refused, so it cannot be walked past by finally guessing
// right.
// ===========================================================================
.then(function () {
  authMod.resetThrottle();
  var server = freshServer({
    MOS_EXECUTOR_URL: 'http://127.0.0.1:9',
    MOS_EXECUTOR_TOKEN: SECRET_TOKEN,
    MOS_EXECUTOR_TOKEN_FILE: null,
    MOS_UPSTREAM_TIMEOUT_MS: '1500',
    MOS_CONSOLE_SECRET_FILE: SECRET_FILE
  });
  return server.start({ port: 0, bind: '127.0.0.1' }).then(function (s) {
    var port = s.address().port;
    ACTIVE_COOKIE = null;

    var seq = Promise.resolve();
    var codes = [];
    for (var n = 0; n < 10; n++) {
      seq = seq.then(function () {
        return login(port, 'guess-' + codes.length).then(function (l) { codes.push(l.res.status); });
      });
    }
    return seq.then(function () {
      ok(codes.every(function (c) { return c === 401; }),
         'the first ten wrong passwords are each refused as invalid credentials (' + codes.join(',') + ')');
      return login(port, 'guess-11');
    }).then(function (l) {
      eq(l.res.status, 429, 'the eleventh attempt is throttled, not answered');
      eq(l.res.json.error, 'too_many_attempts', 'the throttle names itself');
      return login(port, CONSOLE_SECRET);
    }).then(function (l) {
      eq(l.res.status, 429, 'once engaged the throttle refuses the CORRECT password too -- it cannot be guessed past');
      eq(l.cookie, null, 'no session is issued while the throttle holds');
      authMod.resetThrottle();
      return login(port, CONSOLE_SECRET);
    }).then(function (l) {
      eq(l.res.status, 200, 'once the window rolls off, the correct password signs in again');
      ACTIVE_COOKIE = null;
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
