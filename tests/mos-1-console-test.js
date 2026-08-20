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

// Narrowed (C-006 reconciliation, AUTO-10): danger migrated to the corrected
// A-015 value (#F1706A -> rgb 241,112,106), so its 12% companion follows it.
ok(/--mythos-danger-dim:\s*rgba\(241,112,106,0\.12\)/.test(mythosCss),
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

// Usage rule — narrowed (C-006 reconciliation, AUTO-10). Historically --muted
// was the D-001 #6b6860, measured 3.03-3.47:1 (below AA), never used as text
// here, with #999 adopted for secondary text instead. Since MIG-3/AUTO-9
// corrected css/main.css's --muted to the A-015 value (#A8A498), the drift
// rule above requires mythos.css to carry the same corrected value — and the
// historical defect these assertions tracked is closed at the token level.
ok(/--mythos-muted:\s*#A8A498;/.test(mythosCss),
   '--muted carries the corrected A-015 value, verbatim with css/main.css (C-006)');
ok(!/color:\s*var\(--mythos-muted\)/.test(mythosCss) && !/color:\s*var\(--mythos-muted\)/.test(consoleCss),
   '--muted is still not used as a text colour here (composition stability; text uses --mythos-text-secondary)');
ok(/--mythos-text-secondary:\s*#999;/.test(mythosCss),
   'secondary text uses #999, recovered from index.html:125');
measured.filter(function (r) { return r.informational && /--muted as body text/.test(r.id); })
  .forEach(function (r) { ok(r.passes, 'recorded honestly: ' + r.id + ' now CLEARS AA at ' + r.ratio + ':1 (was 3.03-3.47:1 pre-A-015)'); });

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
// MOS-v2 M-09 adds the three goal-layer writes: submit a goal, decide an
// approval, continue a campaign. Eight is the whole write surface.
ok(/'\/api\/goals'/.test(writeRoutesBlock), 'the goal-create route is named explicitly in WRITE_ROUTES');
ok(/GOAL_APPROVE_ROUTE_RE/.test(writeRoutesBlock), 'the goal-approval route is named explicitly in WRITE_ROUTES');
ok(/GOAL_CONTINUE_ROUTE_RE/.test(writeRoutesBlock), 'the goal-continue route is named explicitly in WRITE_ROUTES');
eq((writeRoutesBlock.match(/\{ test:/g) || []).length, 8,
   'exactly eight write routes are registered -- login, logout, start, cancel, dispatch, goal create, goal approval and goal continue, nothing else');
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

var EXPECTED = ['Command Center', 'Goals', 'Missions', 'Campaigns', 'Agents', 'Memory', 'Roadmap',
                'Governance', 'Approvals', 'Providers', 'Budget', 'Secrets', 'Sandbox',
                'Audit', 'Settings'];

eq(registry.modules.length, EXPECTED.length, 'the registry holds exactly the fifteen named MYTHOS OS modules');
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
              created_at: '2026-08-18T08:00:00Z', working_directory: '/should/not/leak', secret_field: SECRET_TOKEN,
              skill_id: 'security-audit', skill_version: '1.0.0', mcp_capabilities: [] },
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
      eq(mods.json.data.modules.length, 15, 'the registry is served over the API too');

      eq(post.status, 405, 'POST is refused');
      eq(post.json.error, 'read_only', 'the refusal names the read-only property');
      eq(del.status, 405, 'DELETE is refused');

      // -----------------------------------------------------------------
      // MOS-3C: Dispatcher API coverage
      // -----------------------------------------------------------------
      eq(dispatcherStatus.status, 200, 'MOS-3C C1: GET /api/dispatcher returns 200');
      var dsKeys = Object.keys(dispatcherStatus.json.data || {}).sort();
      // MOS-v2 M-11 adds auto_routing -- the UI's only signal that the
      // auto-routing choice exists at all.
      var expectedKeys = ['max_parallel', 'queued', 'running', 'providers', 'profiles', 'models', 'auto_routing'].sort();
      ok(dsKeys.join(',') === expectedKeys.join(','),
         'MOS-3C C1 / M-05 / M-11: /api/dispatcher has exactly the keys running/max_parallel/queued/providers/profiles/models/auto_routing (got ' + dsKeys.join(',') + ')');
      ok(dispatcherStatus.json.data.auto_routing && dispatcherStatus.json.data.auto_routing.enabled === true,
         'M-11: auto_routing.enabled is true');
      ok(Array.isArray(dispatcherStatus.json.data.auto_routing.task_types) &&
         dispatcherStatus.json.data.auto_routing.task_types.length > 0,
         'M-11: auto_routing.task_types is a non-empty array');
      ok(Array.isArray(dispatcherStatus.json.data.providers), 'MOS-3C C1: providers is an array');
      eq(dispatcherStatus.json.data.providers.length, 2, 'MOS-3C C1: providers array has 2 entries');
      var providerNames = dispatcherStatus.json.data.providers.slice().sort();
      eq(providerNames[0], 'claude-code', 'MOS-3C C1: first provider is claude-code');
      eq(providerNames[1], 'openai-compat', 'MOS-3C C1: second provider is openai-compat');
      ok(dispatcherStatus.text.indexOf(SECRET_TOKEN) === -1, 'MOS-3C C1: /api/dispatcher does not leak SECRET_TOKEN');

      // -----------------------------------------------------------------
      // MOS-v2 M-04: /api/dispatcher's profiles field, MOS_ALLOW_REPO_WRITE unset
      // -----------------------------------------------------------------
      ok(Array.isArray(dispatcherStatus.json.data.profiles), 'M-04: profiles is an array');
      eq(dispatcherStatus.json.data.profiles.length, 3, 'M-04: profiles array has exactly 3 entries');
      var profileNames = dispatcherStatus.json.data.profiles.map(function (p) { return p.name; });
      eq(profileNames.join(','), 'repo-read,repo-test,repo-write', 'M-04: profiles are named in safest-first order');
      dispatcherStatus.json.data.profiles.forEach(function (p) {
        var wantAuthorized = p.name !== 'repo-write';
        eq(p.authorized, wantAuthorized, 'M-04: ' + p.name + '.authorized is ' + wantAuthorized + ' with MOS_ALLOW_REPO_WRITE unset');
      });

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
        req(port, '/api/missions/start', 'POST', { title: 'x', instruction: 'y', provider: 'claude-code', unexpected_field: 'z' }),
        req(port, '/api/missions/start', 'POST', { title: 'x', provider: 'claude-code' }),
        // Automatic title rule: a MISSING or EMPTY title is no longer a
        // refusal (it derives from the instruction — exercised sequentially
        // below, where upstream-call order is deterministic). The
        // provided-but-INVALID title shapes stay explicit refusals.
        req(port, '/api/missions/start', 'POST', { title: 42, instruction: 'y', provider: 'claude-code' }),
        req(port, '/api/missions/start', 'POST', { title: new Array(202).join('t'), instruction: 'y', provider: 'claude-code' }),
        req(port, '/api/missions/start', 'POST', {}),
        req(port, '/api/missions/start', 'GET'), // wrong method on the one write path
        req(port, '/api/missions/start', 'DELETE')
      ]).then(function (rr) {
        var okStart = rr[0], badMock = rr[1], badGemini = rr[2], badUnexpectedField = rr[3],
            noInstr = rr[4], numberTitle = rr[5], longTitle = rr[6], emptyBody = rr[7],
            wrongGet = rr[8], wrongDelete = rr[9];

        eq(okStart.status, 200, 'a valid start succeeds');
        eq(okStart.json.data.task_id, 'tk-stub-start-0001', 'the created task id is returned');
        eq(okStart.json.data.status, 'RUNNING', 'the explicit dispatch made it RUNNING, not just QUEUED');
        eq(okStart.json.data.provider, 'claude-code', 'the provider actually used is echoed back');

        [badMock, badGemini, badUnexpectedField, noInstr, numberTitle, longTitle, emptyBody].forEach(function (r, i) {
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
        eq(startCalls[0].body.execution_profile, 'repo-read', 'execution_profile defaults to the read-only ceiling when the caller sends none');
        eq(startCalls[0].body.requested_by, 'mos-console', 'requested_by identifies the console, distinct from the core owner');
        eq(startCalls[0].body.provider, 'claude-code', 'the caller-chosen provider is forwarded');
        eq(startCalls[0].body.instruction, 'Inspect the repository and report findings.', 'the caller-authored instruction is forwarded verbatim');
        ok(!Object.prototype.hasOwnProperty.call(startCalls[0].body, 'working_directory'),
           'working_directory is never sent by the console — the executor supplies its own default');
        eq(startCalls[1].url, '/tasks/tk-stub-start-0001/dispatch', 'the second call is the explicit dispatch on the id just created');
        stubPostBodies.length = 0;

        // -----------------------------------------------------------------
        // Automatic title rule: a mission started WITHOUT a title takes the
        // first meaningful line of the instruction as its title —
        // whitespace-normalised, capped at 200 chars, derived
        // deterministically (no model call) — and the instruction itself is
        // relayed byte-identical, never rewritten. Run sequentially so each
        // case's upstream create call can be asserted in isolation.
        // -----------------------------------------------------------------
        function startAndReadCreate(payload) {
          return req(port, '/api/missions/start', 'POST', payload).then(function (r) {
            var create = stubPostBodies.filter(function (c) { return c.url === '/tasks'; })[0];
            stubPostBodies.length = 0;
            return { response: r, create: create };
          });
        }
        var LONG_LINE = new Array(61).join('word '); // 300 chars once normalised
        return startAndReadCreate({
          instruction: 'Implement automatic title generation\nwhen the user does not specify one.',
          provider: 'claude-code'
        }).then(function (c1) {
          eq(c1.response.status, 200, 'auto-title: a titleless mission with a valid instruction is accepted');
          eq(c1.create.body.stage, 'Implement automatic title generation',
             'auto-title: the title is exactly the first instruction line');
          eq(c1.create.body.instruction,
             'Implement automatic title generation\nwhen the user does not specify one.',
             'auto-title: the original instruction is relayed unchanged — the derived title never replaces or mutates it');
          return startAndReadCreate({ title: '', instruction: 'Empty-string title\nsecond line', provider: 'claude-code' });
        }).then(function (c2) {
          eq(c2.response.status, 200, 'auto-title: an empty-string title is "not provided", not a refusal');
          eq(c2.create.body.stage, 'Empty-string title', 'auto-title: empty-string title derives from the instruction');
          return startAndReadCreate({ title: '   \t ', instruction: 'Whitespace-only title case', provider: 'claude-code' });
        }).then(function (c3) {
          eq(c3.response.status, 200, 'auto-title: a whitespace-only title is "not provided"');
          eq(c3.create.body.stage, 'Whitespace-only title case', 'auto-title: whitespace-only title derives from the instruction');
          return startAndReadCreate({ title: null, instruction: 'Null title case', provider: 'claude-code' });
        }).then(function (c4) {
          eq(c4.response.status, 200, 'auto-title: an explicit null title is "not provided"');
          eq(c4.create.body.stage, 'Null title case', 'auto-title: null title derives from the instruction');
          return startAndReadCreate({
            instruction: '\n \n\r\n  Fix   the \t knowledge   sync\t bug \nunaffected detail line',
            provider: 'claude-code'
          });
        }).then(function (c5) {
          eq(c5.response.status, 200, 'auto-title: leading blank lines are skipped');
          eq(c5.create.body.stage, 'Fix the knowledge sync bug',
             'auto-title: the first MEANINGFUL line is used, whitespace runs normalised to single spaces');
          return startAndReadCreate({ instruction: LONG_LINE + '\nrest', provider: 'claude-code' });
        }).then(function (c6) {
          eq(c6.response.status, 200, 'auto-title: an over-long first line is accepted');
          // The derivation caps at 200 chars and the relay's own
          // stage-trim then drops the trailing space the cap cut mid-word,
          // so the exact deterministic value is the double-trimmed slice.
          eq(c6.create.body.stage, LONG_LINE.replace(/\s+/g, ' ').trim().slice(0, 200).trim(),
             'auto-title: the derived title is capped at the same 200-char constraint an explicit title has');
          ok(c6.create.body.stage.length <= 200 && c6.create.body.stage.length >= 195,
             'auto-title: the cap holds at the 200-char storage constraint (got ' + c6.create.body.stage.length + ')');
          return startAndReadCreate({ title: 'Explicit title wins', instruction: 'Derived would differ', provider: 'claude-code' });
        }).then(function (c7) {
          eq(c7.response.status, 200, 'auto-title: an explicit title is still accepted');
          eq(c7.create.body.stage, 'Explicit title wins', 'auto-title: a provided title is used verbatim, never overridden by derivation');
          return req(port, '/api/missions/start', 'POST', { instruction: '   \n \t \n ', provider: 'claude-code' });
        }).then(function (blankInstr) {
          eq(blankInstr.status, 400, 'auto-title: a titleless mission with a whitespace-only instruction is refused on the INSTRUCTION check');
          ok(/instruction/.test(blankInstr.json.detail), 'auto-title: the refusal names the instruction, not the title');
          eq(stubPostBodies.length, 0, 'auto-title: the refused blank-instruction request never reached upstream');
          return Promise.resolve();
        }).then(function () {

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
          // M-12: skill_id/skill_version/mcp_capabilities are safe -- names
          // only -- and pass through the detail allowlist.
          eq(detail.json.data.task.skill_id, 'security-audit', 'M-12: detail relay surfaces skill_id');
          eq(detail.json.data.task.skill_version, '1.0.0', 'M-12: detail relay surfaces skill_version');
          ok(Array.isArray(detail.json.data.task.mcp_capabilities), 'M-12: detail relay surfaces mcp_capabilities as an array');

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
        }); // end of the sequential auto-title chain
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
// 4d. MOS-v2 M-04: GOVERNED EXECUTION PROFILES
//
// A dedicated stub and server, isolated from 4a's, so this section owns its
// own stubPostBodies/stubHits state cleanly and MOS_ALLOW_REPO_WRITE can be
// flipped mid-section without disturbing any other section's assumptions.
// ===========================================================================
.then(function () {
  return startStub().then(function (stub) {
    var stubPort = stub.address().port;
    delete process.env.MOS_ALLOW_REPO_WRITE;
    var server = freshServer({
      MOS_EXECUTOR_URL: 'http://127.0.0.1:' + stubPort,
      MOS_EXECUTOR_TOKEN: SECRET_TOKEN,
      MOS_EXECUTOR_TOKEN_FILE: null
    });
    return server.start({ port: 0, bind: '127.0.0.1' }).then(function (s) {
      var port = s.address().port;
      ACTIVE_COOKIE = null;
      return login(port, CONSOLE_SECRET).then(function (l) {
        eq(l.res.status, 200, 'M-04: sign-in for the profile-governance checks succeeds');
        ACTIVE_COOKIE = l.cookie;

        // --- valid profile, default, and every kind of invalid/unauthorized input ---
        return Promise.all([
          req(port, '/api/missions/start', 'POST', { title: 'x', instruction: 'y', provider: 'claude-code', execution_profile: 'repo-test' }),
          req(port, '/api/missions/start', 'POST', { title: 'x', instruction: 'y', provider: 'claude-code' }),
          req(port, '/api/missions/start', 'POST', { title: 'x', instruction: 'y', provider: 'claude-code', execution_profile: 'autonomous' }),
          req(port, '/api/missions/start', 'POST', { title: 'x', instruction: 'y', provider: 'claude-code', execution_profile: 'deploy' }),
          req(port, '/api/missions/start', 'POST', { title: 'x', instruction: 'y', provider: 'claude-code', execution_profile: 'ROOT' }),
          req(port, '/api/missions/start', 'POST', { title: 'x', instruction: 'y', provider: 'claude-code', execution_profile: '' }),
          req(port, '/api/missions/start', 'POST', { title: 'x', instruction: 'y', provider: 'claude-code', execution_profile: 5 }),
          req(port, '/api/missions/start', 'POST', { title: 'x', instruction: 'y', provider: 'claude-code', execution_profile: 'Repo-Write' }),
          req(port, '/api/missions/start', 'POST', { title: 'x', instruction: 'y', provider: 'claude-code', execution_profile: 'repo-write' }),
          req(port, '/api/missions/start', 'POST', { title: 'x', instruction: 'y', provider: 'claude-code', execution_profile: 'repo-test', rogue_field: 'z' })
        ]);
      }).then(function (rr) {
        var validRepoTest = rr[0], defaultProfile = rr[1], badAutonomous = rr[2], badDeploy = rr[3],
            badRoot = rr[4], badEmpty = rr[5], badNonString = rr[6], badCaseSensitive = rr[7],
            unauthorizedWrite = rr[8], tamperedExtra = rr[9];

        eq(validRepoTest.status, 200, 'M-04: execution_profile "repo-test" is accepted');
        eq(defaultProfile.status, 200, 'M-04: omitting execution_profile still succeeds (defaults to repo-read)');

        [badAutonomous, badDeploy, badRoot, badEmpty, badNonString, badCaseSensitive, tamperedExtra].forEach(function (r, i) {
          eq(r.status, 400, 'M-04: invalid execution_profile case ' + i + ' is rejected with 400');
          eq(r.json.error, 'bad_request', 'M-04: invalid execution_profile case ' + i + ' names bad_request');
        });
        ok(/execution_profile/.test(badAutonomous.json.detail), 'M-04: the 400 for an unrecognised profile names the allowed set');
        ok(!/execution_profile/.test(tamperedExtra.json.detail), 'M-04: an unknown field alongside a VALID profile is refused as an unexpected field, not miscategorised as a bad profile');

        eq(unauthorizedWrite.status, 403, 'M-04: repo-write is refused while MOS_ALLOW_REPO_WRITE is unset');
        eq(unauthorizedWrite.json.error, 'profile_not_authorized', 'M-04: the refusal names profile_not_authorized, not bad_request');
        ok(!/bad_request/.test(unauthorizedWrite.json.error), 'M-04: an unauthorized profile is never reported as a malformed request');

        // Exactly two upstream calls (create + dispatch) for EACH of the two
        // requests that actually succeeded (repo-test, then the default
        // repo-read) -- nothing at all for the eight rejected/unauthorized
        // requests above.
        var calls = stubPostBodies.filter(function (c) { return /^\/tasks(\/tk-stub-start-0001\/dispatch)?$/.test(c.url); });
        eq(calls.length, 4, 'M-04: exactly four upstream calls (create+dispatch, twice) for the two accepted requests -- nothing for the eight rejected/unauthorized ones');
        // Both valid requests fired concurrently (Promise.all), so their
        // create calls can interleave in either order -- identify them by
        // URL, not by array position, and check the SET of profiles created.
        var createdProfiles = stubPostBodies.filter(function (c) { return c.url === '/tasks'; })
          .map(function (c) { return c.body.execution_profile; }).sort();
        eq(createdProfiles.join(','), 'repo-read,repo-test',
           'M-04: the two accepted requests relayed repo-test (validated) and repo-read (default) verbatim to the executor payload');
        stubPostBodies.length = 0;

        // --- source-level: execution_profile is read from ONE place -----
        // Every read of payload.execution_profile must fall inside
        // handleStartMission -- the one function that validates it -- and
        // nowhere else in the file reads it from any other source.
        var serverCode = code(read(path.join(REF, 'server.js')));
        var fnStart = serverCode.indexOf('function handleStartMission');
        var fnEnd = serverCode.indexOf('function handleMissionDetail');
        ok(fnStart !== -1 && fnEnd !== -1 && fnEnd > fnStart, 'M-04: handleStartMission is located as a single contiguous function in server.js');
        var withinFn = serverCode.slice(fnStart, fnEnd);
        var outsideFn = serverCode.slice(0, fnStart) + serverCode.slice(fnEnd);
        var readsWithin = (withinFn.match(/payload\.execution_profile/g) || []).length;
        var readsOutside = (outsideFn.match(/payload\.execution_profile/g) || []).length;
        ok(readsWithin >= 1, 'M-04: handleStartMission reads payload.execution_profile');
        eq(readsOutside, 0, 'M-04: server.js never reads payload.execution_profile anywhere outside handleStartMission');
        var envReads = serverCode.match(/process\.env\.MOS_ALLOW_REPO_WRITE/g) || [];
        eq(envReads.length, 2, 'M-04: MOS_ALLOW_REPO_WRITE is read live, at request time, in exactly the two places that need it (the start-mission authorization check and the /api/dispatcher profiles field) -- never cached at module load');

        // --- authorize repo-write and prove the identical request now succeeds ---
        process.env.MOS_ALLOW_REPO_WRITE = 'true';
        return req(port, '/api/missions/start', 'POST',
          { title: 'x', instruction: 'y', provider: 'claude-code', execution_profile: 'repo-write' });
      }).then(function (authorizedWrite) {
        eq(authorizedWrite.status, 200, 'M-04: repo-write succeeds once MOS_ALLOW_REPO_WRITE=true');
        var writeCalls = stubPostBodies.filter(function (c) { return c.url === '/tasks'; });
        eq(writeCalls.length, 1, 'M-04: the now-authorized repo-write request reached the executor');
        eq(writeCalls[0].body.execution_profile, 'repo-write', 'M-04: repo-write is relayed once authorized');
        stubPostBodies.length = 0;

        return req(port, '/api/dispatcher', 'GET');
      }).then(function (dispatcherAuthorized) {
        var profiles = dispatcherAuthorized.json.data.profiles;
        var byName = {};
        profiles.forEach(function (p) { byName[p.name] = p.authorized; });
        eq(byName['repo-write'], true, 'M-04: /api/dispatcher reports repo-write authorized once MOS_ALLOW_REPO_WRITE=true');
        eq(byName['repo-read'], true, 'M-04: repo-read stays authorized regardless of the switch');
        eq(byName['repo-test'], true, 'M-04: repo-test stays authorized regardless of the switch');

        delete process.env.MOS_ALLOW_REPO_WRITE;
        return req(port, '/api/missions/start', 'POST', { title: 'x', instruction: 'y', provider: 'claude-code', execution_profile: 'repo-write' });
      }).then(function (revoked) {
        eq(revoked.status, 403, 'M-04: turning MOS_ALLOW_REPO_WRITE back off refuses repo-write again immediately, without a restart');
        ACTIVE_COOKIE = null;
        s.close();
        stub.close();
      });
    });
  });
})

// ===========================================================================
// 4e. MOS-v2 M-05: SERVER-CONTROLLED MODEL CATALOG
//
// A dedicated stub and server, isolated from 4a's and 4d's, so this
// section owns its own stubPostBodies/stubHits state cleanly.
// ===========================================================================
.then(function () {
  return startStub().then(function (stub) {
    var stubPort = stub.address().port;
    var server = freshServer({
      MOS_EXECUTOR_URL: 'http://127.0.0.1:' + stubPort,
      MOS_EXECUTOR_TOKEN: SECRET_TOKEN,
      MOS_EXECUTOR_TOKEN_FILE: null
    });
    return server.start({ port: 0, bind: '127.0.0.1' }).then(function (s) {
      var port = s.address().port;
      ACTIVE_COOKIE = null;
      return login(port, CONSOLE_SECRET).then(function (l) {
        eq(l.res.status, 200, 'M-05: sign-in for the model-catalog checks succeeds');
        ACTIVE_COOKIE = l.cookie;

        return Promise.all([
          // valid: enabled model matching its own provider
          req(port, '/api/missions/start', 'POST', { title: 'x', instruction: 'y', provider: 'claude-code', model: 'sonnet' }),
          req(port, '/api/missions/start', 'POST', { title: 'x', instruction: 'y', provider: 'openai-compat', model: 'gpt-4o-mini' }),
          // omitted model -- existing default behaviour preserved
          req(port, '/api/missions/start', 'POST', { title: 'x', instruction: 'y', provider: 'claude-code' }),
          // unknown model strings
          req(port, '/api/missions/start', 'POST', { title: 'x', instruction: 'y', provider: 'claude-code', model: 'gpt-5' }),
          req(port, '/api/missions/start', 'POST', { title: 'x', instruction: 'y', provider: 'claude-code', model: 'claude-x' }),
          req(port, '/api/missions/start', 'POST', { title: 'x', instruction: 'y', provider: 'claude-code', model: '' }),
          // cross-provider: a real, enabled model id under the WRONG provider
          req(port, '/api/missions/start', 'POST', { title: 'x', instruction: 'y', provider: 'claude-code', model: 'gpt-4o-mini' }),
          req(port, '/api/missions/start', 'POST', { title: 'x', instruction: 'y', provider: 'openai-compat', model: 'opus' }),
          // disabled: gemini model id under a real, enabled provider
          req(port, '/api/missions/start', 'POST', { title: 'x', instruction: 'y', provider: 'claude-code', model: 'gemini-2.5-pro' }),
          req(port, '/api/missions/start', 'POST', { title: 'x', instruction: 'y', provider: 'openai-compat', model: 'gemini-2.5-pro' }),
          // disabled provider itself is refused by the existing provider check --
          // pinned here so this stage never accidentally loosens it
          req(port, '/api/missions/start', 'POST', { title: 'x', instruction: 'y', provider: 'gemini', model: 'gemini-2.5-pro' }),
          // case tamper
          req(port, '/api/missions/start', 'POST', { title: 'x', instruction: 'y', provider: 'claude-code', model: 'Sonnet' }),
          req(port, '/api/missions/start', 'POST', { title: 'x', instruction: 'y', provider: 'claude-code', model: 'OPUS' }),
          // non-string model
          req(port, '/api/missions/start', 'POST', { title: 'x', instruction: 'y', provider: 'claude-code', model: 5 }),
          req(port, '/api/missions/start', 'POST', { title: 'x', instruction: 'y', provider: 'claude-code', model: { id: 'sonnet' } })
        ]);
      }).then(function (rr) {
        var validSonnet = rr[0], validGptMini = rr[1], omittedModel = rr[2],
            badGpt5 = rr[3], badClaudeX = rr[4], badEmpty = rr[5],
            crossA = rr[6], crossB = rr[7],
            disabledA = rr[8], disabledB = rr[9], disabledProvider = rr[10],
            caseA = rr[11], caseB = rr[12],
            nonStringNum = rr[13], nonStringObj = rr[14];

        eq(validSonnet.status, 200, 'M-05: claude-code + sonnet is accepted');
        eq(validGptMini.status, 200, 'M-05: openai-compat + gpt-4o-mini is accepted');
        eq(omittedModel.status, 200, 'M-05: omitting model still succeeds (existing default behaviour preserved)');

        [badGpt5, badClaudeX, badEmpty, crossA, crossB, disabledA, disabledB,
         caseA, caseB, nonStringNum, nonStringObj].forEach(function (r, i) {
          eq(r.status, 400, 'M-05: rejected model case ' + i + ' is refused with 400');
          eq(r.json.error, 'bad_request', 'M-05: rejected model case ' + i + ' names bad_request');
        });
        eq(disabledProvider.status, 400, 'M-05: provider "gemini" is refused before the model is ever consulted (pinning the existing provider check)');
        eq(disabledProvider.json.error, 'bad_request', 'M-05: the gemini-provider refusal is a bad_request, not a model-shaped error');
        ok(!/model must be/.test(disabledProvider.json.detail), 'M-05: the gemini-provider refusal is the PROVIDER error, not the model error -- provider is validated first');

        ok(/model must be one of/.test(crossA.json.detail), 'M-05: a cross-provider model names the allowed set for the provider actually chosen');
        ok(crossA.json.detail.indexOf('sonnet') !== -1, 'M-05: claude-code\'s 400 lists its own allowed ids');
        ok(crossA.json.detail.indexOf('gpt-4o-mini') === -1, 'M-05: claude-code\'s 400 does not list openai-compat\'s ids');
        ok(crossB.json.detail.indexOf('gpt-4o-mini') !== -1, 'M-05: openai-compat\'s 400 lists its own allowed ids');
        ok(crossB.json.detail.indexOf('opus') === -1, 'M-05: openai-compat\'s 400 does not list claude-code\'s ids');
        ok(!/gemini/.test(crossA.json.detail) && !/gemini/.test(crossB.json.detail),
           'M-05: the allowed-ids list in a 400 never names a disabled (gemini) entry');

        // Three accepted requests (validSonnet, validGptMini, omittedModel),
        // each create+dispatch -- six upstream calls total -- nothing at all
        // for the twelve rejected requests.
        var calls = stubPostBodies.filter(function (c) { return /^\/tasks(\/tk-stub-start-0001\/dispatch)?$/.test(c.url); });
        eq(calls.length, 6, 'M-05: exactly six upstream calls (create+dispatch, three times) for the three accepted requests (sonnet, gpt-4o-mini, and the omitted-model default) -- nothing for the twelve rejected ones');
        var createdModels = stubPostBodies.filter(function (c) { return c.url === '/tasks'; })
          .map(function (c) { return c.body.model; }).sort();
        eq(createdModels.join(','), 'gpt-4o-mini,,sonnet',
           'M-05: the two model-bearing requests relay their exact ids verbatim, and the omitted-model request relays null');
        stubPostBodies.length = 0;

        return req(port, '/api/missions/start', 'POST', { title: 'x', instruction: 'y', provider: 'claude-code' });
      }).then(function (defaulted) {
        eq(defaulted.status, 200, 'M-05: a second omitted-model request also succeeds');
        var createCall = stubPostBodies.filter(function (c) { return c.url === '/tasks'; })[0];
        eq(createCall.body.model, null, 'M-05: an omitted model relays null verbatim -- the provider\'s own default applies (openai-compat defaults to gpt-4o-mini per its own code, documented not enforced here)');
        stubPostBodies.length = 0;

        return req(port, '/api/dispatcher', 'GET');
      }).then(function (dispatcherR) {
        eq(dispatcherR.status, 200, 'M-05: GET /api/dispatcher succeeds');
        var models = dispatcherR.json.data.models;
        ok(Array.isArray(models), 'M-05: /api/dispatcher serves a `models` array');
        eq(models.length, 4, 'M-05: /api/dispatcher serves exactly the 4 enabled catalog entries');
        ok(!models.some(function (m) { return m.provider === 'gemini'; }),
           'M-05: /api/dispatcher never serves the disabled gemini entry');
        models.forEach(function (m) {
          ok(!Object.prototype.hasOwnProperty.call(m, 'enabled'),
             'M-05: a served model entry never leaks the `enabled` flag itself: ' + m.id);
          ['provider', 'id', 'label', 'capability', 'recommended_task_types'].forEach(function (f) {
            ok(Object.prototype.hasOwnProperty.call(m, f), 'M-05: served model entry ' + m.id + ' has field ' + f);
          });
        });
        var servedIds = models.map(function (m) { return m.provider + '/' + m.id; }).sort();
        eq(servedIds.join(','), 'claude-code/haiku,claude-code/opus,claude-code/sonnet,openai-compat/gpt-4o-mini',
           'M-05: /api/dispatcher serves exactly the expected 4 provider/id pairs');
        ok(dispatcherR.text.indexOf(SECRET_TOKEN) === -1, 'M-05: /api/dispatcher does not leak SECRET_TOKEN via the models field');

        // --- source-level pins ---------------------------------------
        // The old free-form length-check branch must be gone from
        // server.js -- it must no longer decide model validity by string
        // length, only by consulting the catalog.
        var serverCode = code(serverJs);
        ok(!/model\.length > 100/.test(serverCode),
           'M-05: server.js no longer contains the old free-form model length-check branch');
        ok(/modelCatalog\.isAllowed\(/.test(serverCode),
           'M-05: server.js validates model via modelCatalog.isAllowed(...)');

        // model-catalog.js is the only file in the console reference tree
        // that defines a model catalog of its own.
        var refFiles = fs.readdirSync(REF).filter(function (f) { return /\.js$/.test(f) && f !== 'model-catalog.js'; });
        refFiles.forEach(function (f) {
          var src = code(read(path.join(REF, f)));
          ok(!/var\s+CATALOG\s*=/.test(src), 'M-05: ' + f + ' does not define its own CATALOG -- model-catalog.js is the single source of truth');
        });

        var modelCatalogCode = code(read(path.join(REF, 'model-catalog.js')));
        ok(/function isAllowed/.test(modelCatalogCode), 'M-05: model-catalog.js exports isAllowed');
        ok(/function enabledModels/.test(modelCatalogCode), 'M-05: model-catalog.js exports enabledModels');
        ok(/enabled:\s*false/.test(modelCatalogCode), 'M-05: model-catalog.js contains at least one disabled entry (gemini)');

        // app.js: the old free-text model input must be gone; a select
        // populated from the dispatcher's `models` must be present.
        var appCode = code(appJs);
        ok(!/type:\s*'text',\s*id:\s*'mission-model'/.test(appCode),
           'M-05: app.js no longer builds mission-model as a free-text input');
        ok(/id:\s*'mission-model'/.test(appCode) && /el\('select'/.test(appCode.slice(appCode.indexOf("id: 'mission-model'") - 200, appCode.indexOf("id: 'mission-model'") + 50)),
           'M-05: mission-model is built as a <select>');
        ok(/dispatcher\.data\.models/.test(appCode), 'M-05: app.js reads the model list from the dispatcher response, not a hardcoded list');

        ACTIVE_COOKIE = null;
        s.close();
        stub.close();
      });
    });
  });
})

// ===========================================================================
// 4f. MOS-v2 M-06: MISSION CONTROL COMPLETION — priority on the start relay
//
// A dedicated stub and server, isolated from 4a's/4d's/4e's, so this
// section owns its own stubPostBodies/stubHits state cleanly.
// ===========================================================================
.then(function () {
  return startStub().then(function (stub) {
    var stubPort = stub.address().port;
    delete process.env.MOS_ALLOW_REPO_WRITE;
    var server = freshServer({
      MOS_EXECUTOR_URL: 'http://127.0.0.1:' + stubPort,
      MOS_EXECUTOR_TOKEN: SECRET_TOKEN,
      MOS_EXECUTOR_TOKEN_FILE: null
    });
    return server.start({ port: 0, bind: '127.0.0.1' }).then(function (s) {
      var port = s.address().port;
      ACTIVE_COOKIE = null;
      return login(port, CONSOLE_SECRET).then(function (l) {
        eq(l.res.status, 200, 'M-06: sign-in for the priority checks succeeds');
        ACTIVE_COOKIE = l.cookie;

        return Promise.all([
          req(port, '/api/missions/start', 'POST', { title: 'x', instruction: 'y', provider: 'claude-code', priority: 'high' }),
          req(port, '/api/missions/start', 'POST', { title: 'x', instruction: 'y', provider: 'claude-code' }),
          req(port, '/api/missions/start', 'POST', { title: 'x', instruction: 'y', provider: 'claude-code', priority: 'urgent' }),
          req(port, '/api/missions/start', 'POST', { title: 'x', instruction: 'y', provider: 'claude-code', priority: 'HIGH' }),
          req(port, '/api/missions/start', 'POST', { title: 'x', instruction: 'y', provider: 'claude-code', priority: 5 }),
          req(port, '/api/missions/start', 'POST', { title: 'x', instruction: 'y', provider: 'claude-code', priority: '' }),
          req(port, '/api/missions/start', 'POST', { title: 'x', instruction: 'y', provider: 'claude-code', priority: 'high', rogue_field: 'z' })
        ]);
      }).then(function (rr) {
        var validHigh = rr[0], defaultPriority = rr[1], badUrgent = rr[2], badCase = rr[3],
            badNonString = rr[4], badEmpty = rr[5], tamperedExtra = rr[6];

        eq(validHigh.status, 200, 'M-06: priority "high" is accepted');
        eq(defaultPriority.status, 200, 'M-06: omitting priority still succeeds (defaults to normal)');

        [badUrgent, badCase, badNonString, badEmpty, tamperedExtra].forEach(function (r, i) {
          eq(r.status, 400, 'M-06: invalid priority case ' + i + ' is rejected with 400');
          eq(r.json.error, 'bad_request', 'M-06: invalid priority case ' + i + ' names bad_request');
        });
        ok(/priority/.test(badUrgent.json.detail), 'M-06: the 400 for an unrecognised priority names the allowed set');
        ok(!/priority/.test(tamperedExtra.json.detail), 'M-06: an unknown field alongside a VALID priority is refused as an unexpected field, not miscategorised as a bad priority');

        // Exactly four upstream calls (create + dispatch, twice) for the
        // two accepted requests -- nothing at all for the five
        // rejected requests above.
        var calls = stubPostBodies.filter(function (c) { return /^\/tasks(\/tk-stub-start-0001\/dispatch)?$/.test(c.url); });
        eq(calls.length, 4, 'M-06: exactly four upstream calls (create+dispatch, twice) for the two accepted requests -- nothing for the five rejected ones');
        var createdPriorities = stubPostBodies.filter(function (c) { return c.url === '/tasks'; })
          .map(function (c) { return c.body.priority; }).sort();
        eq(createdPriorities.join(','), 'high,normal',
           'M-06: the two accepted requests relayed high (validated) and normal (default) verbatim to the executor payload');

        // --- full relay payload shape, pinned once -----------------------
        var createCall = stubPostBodies.filter(function (c) { return c.url === '/tasks'; })[0];
        eq(Object.keys(createCall.body).sort().join(','),
           ['project', 'stage', 'instruction', 'provider', 'model', 'priority', 'requested_by', 'execution_profile', 'expected_delivery'].sort().join(','),
           'M-06: the relay payload carries exactly the expected fixed+validated fields -- nothing more, nothing missing');
        stubPostBodies.length = 0;

        // --- source-level: priority is read from ONE place ---------------
        var serverCode = code(read(path.join(REF, 'server.js')));
        var fnStart = serverCode.indexOf('function handleStartMission');
        var fnEnd = serverCode.indexOf('function handleMissionDetail');
        var withinFn = serverCode.slice(fnStart, fnEnd);
        var outsideFn = serverCode.slice(0, fnStart) + serverCode.slice(fnEnd);
        var readsWithin = (withinFn.match(/payload\.priority/g) || []).length;
        var readsOutside = (outsideFn.match(/payload\.priority/g) || []).length;
        ok(readsWithin >= 1, 'M-06: handleStartMission reads payload.priority');
        eq(readsOutside, 0, 'M-06: server.js never reads payload.priority anywhere outside handleStartMission');

        // --- detail relay: all TASK_DETAIL fields pass through, unknown dropped ---
        return req(port, '/api/missions/abc12345');
      }).then(function (detail) {
        eq(detail.status, 200, 'M-06: detail relay for abc12345 succeeds');
        eq(detail.json.data.task.priority, 'normal', 'M-06: the console\'s /api/missions/<id> response passes priority through from upstream');
        eq(detail.json.data.task.execution_profile, 'repo-read', 'M-06: the console\'s /api/missions/<id> response passes execution_profile through from upstream');
        ok(!Object.prototype.hasOwnProperty.call(detail.json.data.task, 'working_directory'),
           'M-06: unknown upstream task fields are still dropped alongside the new pass-through fields');
        ok(!Object.prototype.hasOwnProperty.call(detail.json.data.task, 'secret_field'),
           'M-06: an unrecognised upstream field is still dropped, not passed through');

        // --- source pins: app.js has a priority select; no second dispatcher/queue ---
        var appCode = code(appJs);
        ok(/id:\s*'mission-priority'/.test(appCode) && /el\('select'/.test(appCode.slice(Math.max(0, appCode.indexOf("id: 'mission-priority'") - 200), appCode.indexOf("id: 'mission-priority'") + 50)),
           'M-06: app.js has a priority select (mission-priority)');
        ok(/'high'/.test(appCode) && /'normal'/.test(appCode) && /'low'/.test(appCode),
           'M-06: app.js\'s priority select offers high/normal/low');

        // server.js relays dispatch only to upstream '/tasks/'-prefixed
        // endpoints -- no second dispatcher/queue was introduced by this
        // stage.
        // MOS-v2 M-09 adds the goal layer, whose three writes relay to the
        // executor's EXISTING campaign endpoints (POST /campaigns,
        // /campaigns/<id>/approvals/resolve, /campaigns/<id>/continue).
        // MOS-v2 M-11 adds exactly one more: POST /route, the executor's
        // OWN governed-routing decision (core/provider-router.js) -- not a
        // second planner or dispatcher invented at this layer. So the
        // allowed set is three prefixes, not one -- and it is still a
        // closed set: a post to anything else fails here.
        var dispatchCalls = serverCode.match(/upstream\.post\(\s*'([^']*)'/g) || [];
        dispatchCalls.forEach(function (call) {
          ok(/upstream\.post\(\s*'\/(tasks|campaigns|route)/.test(call), 'M-06/M-11: every upstream.post(...) call in server.js targets a /tasks-, /campaigns- or /route-prefixed executor endpoint: ' + call);
        });

        ACTIVE_COOKIE = null;
        s.close();
        stub.close();
      });
    });
  });
})

// ===========================================================================
// 4g. MOS-v2 M-07: OPERATOR AUDITABILITY
//
// Before this stage the console could create, cancel and dispatch real
// executor missions and sign an operator in and out while leaving no
// record of any of it. The executor's own task events start at task
// creation, so a refused repo-write, a throttled sign-in, a mission
// rejected at validation and an unauthenticated write attempt were all
// invisible afterwards -- and those are precisely the events an incident
// review asks about.
//
// What is asserted here is BOTH halves of the contract:
//
//   · every state-changing action writes exactly one audit line, with a
//     truncated actor and a machine-readable outcome; and
//   · no audit line can EVER carry a password, a session identifier in
//     full, or instruction/title text -- enforced by an allowlist inside
//     audit.js, so it is a property of the module rather than a habit of
//     its callers. That half is tested against the module directly, not
//     only through the server, because a call site can be added tomorrow.
// ===========================================================================
.then(function () {
  var auditMod = require(path.join(REF, 'audit.js'));
  var auditCode = code(read(path.join(REF, 'audit.js')));

  // --- the allowlist, tested at the module ---------------------------
  var hostile = auditMod.line({
    action: 'mission.start', outcome: 'accepted', actor: 'f'.repeat(64), task_id: 'tk-audit-0001',
    detail: {
      profile: 'repo-write', provider: 'claude-code', model: 'opus', priority: 'high', status: 'RUNNING',
      // Everything below is what a careless future caller might hand it.
      instruction: 'SENSITIVE-INSTRUCTION-TEXT', title: 'SENSITIVE-TITLE',
      password: CONSOLE_SECRET, token: SECRET_TOKEN, session: 'f'.repeat(64), cookie: 'mos_session=' + 'f'.repeat(64)
    }
  });
  var hostileText = JSON.stringify(hostile);
  ok(hostileText.indexOf('SENSITIVE-INSTRUCTION-TEXT') === -1, 'M-07: audit.js drops instruction text handed to it in detail');
  ok(hostileText.indexOf('SENSITIVE-TITLE') === -1, 'M-07: audit.js drops title text handed to it in detail');
  ok(hostileText.indexOf(CONSOLE_SECRET) === -1, 'M-07: audit.js drops a password handed to it in detail');
  ok(hostileText.indexOf(SECRET_TOKEN) === -1, 'M-07: audit.js drops an executor token handed to it in detail');
  ok(hostileText.indexOf('f'.repeat(64)) === -1, 'M-07: no 64-character identifier survives anywhere in an audit line');
  eq(hostile.detail.profile, 'repo-write', 'M-07: an allowlisted detail field (profile) is kept');
  eq(hostile.detail.provider, 'claude-code', 'M-07: an allowlisted detail field (provider) is kept');
  eq(hostile.detail.model, 'opus', 'M-07: an allowlisted detail field (model) is kept');
  eq(hostile.detail.priority, 'high', 'M-07: an allowlisted detail field (priority) is kept');
  eq(hostile.detail.status, 'RUNNING', 'M-07: an allowlisted detail field (status) is kept');
  eq(Object.keys(hostile.detail).sort().join(','), 'model,priority,profile,provider,status',
     'M-07: the audit line carries exactly the allowlisted detail fields and nothing else');
  eq(hostile.actor, 'sess:' + 'f'.repeat(8), 'M-07: the actor is the first eight characters of the session identifier, prefixed');
  eq(hostile.task_id, 'tk-audit-0001', 'M-07: a well-formed task id is recorded');
  eq(hostile.log, 'mos.audit', 'M-07: every line names itself mos.audit');

  ['instruction', 'title', 'password', 'secret', 'token', 'session', 'cookie', 'stage'].forEach(function (f) {
    ok(auditMod.DETAIL_FIELDS.indexOf(f) === -1, 'M-07: "' + f + '" is not an allowlisted audit detail field');
  });

  // An actor that is not a well-formed identifier is never echoed --
  // including a value an attacker chose.
  [null, undefined, '', 'not-a-session', 'F'.repeat(64), 'a'.repeat(63), { id: 'x' }, 12345].forEach(function (bad, i) {
    eq(auditMod.line({ actor: bad }).actor, 'unauthenticated',
       'M-07: a malformed actor value (case ' + i + ') is recorded as unauthenticated, never echoed');
  });
  // A task id is re-checked against the route alphabet here, so nothing
  // can forge a second log line by choosing a URL.
  ['../../etc/passwd', 'tk-x\n{"log":"mos.audit"}', 'TK-UPPER-0001', 'short', 'tk-' + 'a'.repeat(80), 5, null].forEach(function (bad, i) {
    eq(auditMod.line({ task_id: bad }).task_id, null,
       'M-07: a task id outside the route alphabet (case ' + i + ') is recorded as null, never echoed');
  });
  eq(auditMod.line({ detail: { reason: 'r'.repeat(200) } }).detail.reason.length, 64,
     'M-07: a detail value is truncated to 64 characters');
  ok(JSON.stringify(auditMod.line({ action: 'x', outcome: 'y' })).indexOf('\n') === -1,
     'M-07: an audit line serialises to exactly one line');
  ok(!/process\.env|require\('fs'\)|readFileSync/.test(auditCode),
     'M-07: audit.js reads no environment variable and no file -- it cannot reach a credential to log one');
  ok(/process\.stdout\.write/.test(auditCode), 'M-07: audit.js writes to stdout, so the record lands in the journal');

  // --- the call sites, tested against a live console ------------------
  var lines = [];
  var realWrite = process.stdout.write;
  function capture() {
    process.stdout.write = function (chunk) {
      var text = String(chunk);
      if (text.indexOf('"log":"mos.audit"') !== -1) {
        text.split('\n').forEach(function (l) { if (l.trim()) lines.push(JSON.parse(l)); });
        return true;
      }
      return realWrite.apply(process.stdout, arguments);
    };
  }
  function release() { process.stdout.write = realWrite; }
  function actions() { return lines.map(function (l) { return l.action + ':' + l.outcome; }); }

  var auditStub = http.createServer(function (rq, rs) {
    var u = rq.url.split('?')[0];
    rq.on('data', function () { /* drained */ });
    rq.on('end', function () {
      if (u === '/health') {
        rs.writeHead(200, { 'Content-Type': 'application/json' });
        // A field the console has never heard of, carrying a credential.
        // The health relay must reduce this to its own shape rather than
        // pass an upstream body through verbatim.
        rs.end(JSON.stringify({ ok: true, time: '2026-08-19T00:00:00Z',
          checks: { store_writable: true, claude_cli: '1.0.0', n8n: { ok: true }, omniroute: { ok: false }, queue: { QUEUED: 2 } },
          rogue_field: SECRET_TOKEN }));
        return;
      }
      if (rq.method === 'POST' && u === '/tasks') {
        rs.writeHead(201, { 'Content-Type': 'application/json' });
        rs.end(JSON.stringify({ task_id: 'tk-audit-0001', status: 'QUEUED' }));
        return;
      }
      if (rq.method === 'POST' && /\/(dispatch|cancel)$/.test(u)) {
        rs.writeHead(200, { 'Content-Type': 'application/json' });
        rs.end(JSON.stringify({ task_id: 'tk-audit-0001', dispatched: true, running: 1, max_parallel: 5, status: 'CANCELLED' }));
        return;
      }
      rs.writeHead(200, { 'Content-Type': 'application/json' });
      rs.end(JSON.stringify({ tasks: [] }));
    });
  });

  return new Promise(function (resolve) { auditStub.listen(0, '127.0.0.1', resolve); }).then(function () {
    authMod.resetThrottle();
    delete process.env.MOS_ALLOW_REPO_WRITE;
    var server = freshServer({
      MOS_EXECUTOR_URL: 'http://127.0.0.1:' + auditStub.address().port,
      MOS_EXECUTOR_TOKEN: SECRET_TOKEN,
      MOS_EXECUTOR_TOKEN_FILE: null
    });
    return server.start({ port: 0, bind: '127.0.0.1' }).then(function (s) {
      var port = s.address().port;
      ACTIVE_COOKIE = null;
      var sessionId = null;
      var INSTRUCTION = 'AUDIT-PROBE-INSTRUCTION-TEXT-do-not-log-me';

      capture();
      // 1. Unauthenticated writes: the events nothing downstream can record.
      return req(port, '/api/missions/start', 'POST',
                 { title: 't', instruction: INSTRUCTION, provider: 'claude-code' }, { cookie: null })
      .then(function (r) {
        eq(r.status, 401, 'M-07: the unauthenticated start attempt is still refused');
        eq(lines.length, 1, 'M-07: an unauthenticated write attempt writes exactly one audit line');
        eq(lines[0].action, 'write.denied', 'M-07: the refused write is recorded as write.denied');
        eq(lines[0].outcome, 'unauthenticated', 'M-07: its outcome names the reason');
        eq(lines[0].actor, 'unauthenticated', 'M-07: a caller with no session is recorded as unauthenticated');
        eq(lines[0].detail.route, 'mission.start', 'M-07: the refused write names the route it aimed at');
        eq(lines[0].task_id, null, 'M-07: a start attempt carries no task id');
        return req(port, '/api/missions/tk-audit-0001/cancel', 'POST', {}, { cookie: null });
      }).then(function () {
        eq(lines.length, 2, 'M-07: the unauthenticated cancel attempt is recorded too');
        eq(lines[1].detail.route, 'mission.cancel', 'M-07: the refused cancel names its route');
        eq(lines[1].task_id, 'tk-audit-0001', 'M-07: the refused cancel records which task was targeted');
        lines.length = 0;
        // 2. Sign-in: failure, then success.
        return login(port, 'wrong-password');
      }).then(function () {
        eq(lines.length, 1, 'M-07: a failed sign-in writes exactly one audit line');
        eq(lines[0].action + ':' + lines[0].outcome, 'login:invalid_credentials', 'M-07: the failed sign-in is recorded as login:invalid_credentials');
        eq(lines[0].actor, 'unauthenticated', 'M-07: a failed sign-in has no actor');
        ok(JSON.stringify(lines[0]).indexOf('wrong-password') === -1, 'M-07: the submitted password never reaches the audit line');
        lines.length = 0;
        return login(port, CONSOLE_SECRET);
      }).then(function (l) {
        eq(l.res.status, 200, 'M-07: sign-in for the audit checks succeeds');
        ACTIVE_COOKIE = l.cookie;
        sessionId = l.cookie.split('=')[1];
        eq(lines.length, 1, 'M-07: a successful sign-in writes exactly one audit line');
        eq(lines[0].action + ':' + lines[0].outcome, 'login:success', 'M-07: the successful sign-in is recorded as login:success');
        eq(lines[0].actor, 'sess:' + sessionId.slice(0, 8), 'M-07: the actor is the truncated identifier of the session just issued');
        ok(JSON.stringify(lines[0]).indexOf(sessionId) === -1, 'M-07: the session identifier never appears in full in an audit line');
        ok(JSON.stringify(lines[0]).indexOf(CONSOLE_SECRET) === -1, 'M-07: the console secret never appears in an audit line');
        lines.length = 0;
        // 3. Reads change nothing and are not audited.
        return Promise.all([req(port, '/api/missions', 'GET'), req(port, '/api/modules', 'GET'), req(port, '/api/health', 'GET')]);
      }).then(function (reads) {
        eq(lines.length, 0, 'M-07: read routes write no audit line -- only state-changing actions are recorded');
        // The health relay reduces the upstream body to its own shape.
        var health = reads[2];
        ok(health.text.indexOf(SECRET_TOKEN) === -1, 'M-07: an unknown upstream health field carrying a credential never reaches the browser');
        ok(health.text.indexOf('rogue_field') === -1, 'M-07: an unknown upstream health field is dropped, not passed through');
        var hd = health.json.data.upstream.detail;
        eq(hd.checks.store_writable, true, 'M-07: the reduced health view keeps store_writable');
        eq(hd.checks.claude_cli, '1.0.0', 'M-07: the reduced health view keeps the CLI version');
        eq(hd.checks.n8n, true, 'M-07: the reduced health view reduces the n8n probe to a boolean');
        eq(hd.checks.omniroute, false, 'M-07: the reduced health view reduces the omniroute probe to a boolean');
        eq(hd.checks.queue.QUEUED, 2, 'M-07: the reduced health view keeps the queue histogram');
        eq(Object.keys(hd).sort().join(','), 'checks,ok,time', 'M-07: the reduced health view has exactly three top-level fields');
        // 4. A rejected mission: recorded, with a reason code and no input.
        return req(port, '/api/missions/start', 'POST', { title: 't', instruction: INSTRUCTION, provider: 'mock' });
      }).then(function (r) {
        eq(r.status, 400, 'M-07: the bad-provider mission is still refused');
        eq(lines.length, 1, 'M-07: a rejected mission writes exactly one audit line');
        eq(lines[0].action + ':' + lines[0].outcome, 'mission.start:rejected', 'M-07: the rejection is recorded as mission.start:rejected');
        eq(lines[0].detail.reason, 'provider', 'M-07: the rejection names WHICH check refused it');
        ok(JSON.stringify(lines[0]).indexOf('mock') === -1, 'M-07: the caller-supplied value that was refused is not echoed into the log');
        lines.length = 0;
        return req(port, '/api/missions/start', 'POST',
                   { title: 't', instruction: INSTRUCTION, provider: 'claude-code', rogue_field: SECRET_TOKEN });
      }).then(function (r) {
        eq(r.status, 400, 'M-07: the unexpected-field mission is still refused');
        eq(lines[0].detail.reason, 'unexpected_field', 'M-07: an unexpected field is recorded by reason code');
        ok(JSON.stringify(lines[0]).indexOf('rogue_field') === -1, 'M-07: the unexpected field NAME is not written into the log');
        ok(JSON.stringify(lines[0]).indexOf(SECRET_TOKEN) === -1, 'M-07: the unexpected field VALUE is not written into the log');
        lines.length = 0;
        // 5. The refusal that matters most: repo-write, unauthorized.
        return req(port, '/api/missions/start', 'POST',
                   { title: 't', instruction: INSTRUCTION, provider: 'claude-code', execution_profile: 'repo-write' });
      }).then(function (r) {
        eq(r.status, 403, 'M-07: repo-write is still refused while MOS_ALLOW_REPO_WRITE is unset');
        eq(lines.length, 1, 'M-07: the refused repo-write writes exactly one audit line');
        eq(lines[0].action + ':' + lines[0].outcome, 'mission.start:denied_profile', 'M-07: an unauthorized profile is recorded as denied_profile, distinctly from a malformed request');
        eq(lines[0].detail.profile, 'repo-write', 'M-07: the refused repo-write names the profile that was asked for');
        eq(lines[0].actor, 'sess:' + sessionId.slice(0, 8), 'M-07: the refused repo-write is attributed to the operator who asked');
        lines.length = 0;
        // 6. An accepted mission, including an authorized repo-write.
        process.env.MOS_ALLOW_REPO_WRITE = 'true';
        return req(port, '/api/missions/start', 'POST',
                   { title: 'AUDIT-PROBE-TITLE', instruction: INSTRUCTION, provider: 'claude-code',
                     model: 'opus', execution_profile: 'repo-write', priority: 'high' });
      }).then(function (r) {
        eq(r.status, 200, 'M-07: the authorized repo-write mission starts');
        eq(lines.length, 1, 'M-07: an accepted mission writes exactly one audit line');
        var a = lines[0];
        eq(a.action + ':' + a.outcome, 'mission.start:accepted', 'M-07: the accepted mission is recorded as mission.start:accepted');
        eq(a.task_id, 'tk-audit-0001', 'M-07: the accepted mission records the task id the executor issued');
        eq(a.detail.profile, 'repo-write', 'M-07: repo-write USE is recorded, not only its refusal');
        eq(a.detail.provider, 'claude-code', 'M-07: the accepted mission records the provider');
        eq(a.detail.model, 'opus', 'M-07: the accepted mission records the model');
        eq(a.detail.priority, 'high', 'M-07: the accepted mission records the priority');
        eq(a.detail.status, 'RUNNING', 'M-07: the accepted mission records the resulting status');
        ok(JSON.stringify(a).indexOf(INSTRUCTION) === -1, 'M-07: the mission instruction is never written to the audit log');
        ok(JSON.stringify(a).indexOf('AUDIT-PROBE-TITLE') === -1, 'M-07: the mission title is never written to the audit log');
        delete process.env.MOS_ALLOW_REPO_WRITE;
        lines.length = 0;
        // 7. Cancel and dispatch.
        return req(port, '/api/missions/tk-audit-0001/cancel', 'POST', {});
      }).then(function (r) {
        eq(r.status, 200, 'M-07: the cancel relay still answers 200');
        eq(lines[0].action + ':' + lines[0].outcome, 'mission.cancel:accepted', 'M-07: a cancel is recorded');
        eq(lines[0].task_id, 'tk-audit-0001', 'M-07: the cancel records which task it targeted');
        eq(lines[0].actor, 'sess:' + sessionId.slice(0, 8), 'M-07: the cancel is attributed to the operator who asked');
        lines.length = 0;
        return req(port, '/api/missions/tk-audit-0001/dispatch', 'POST', {});
      }).then(function (r) {
        eq(r.status, 200, 'M-07: the dispatch relay still answers 200');
        eq(lines[0].action + ':' + lines[0].outcome, 'mission.dispatch:accepted', 'M-07: a dispatch is recorded');
        eq(lines[0].task_id, 'tk-audit-0001', 'M-07: the dispatch records which task it targeted');
        lines.length = 0;
        // 8. Sign-out, by the same actor that signed in.
        return req(port, '/api/logout', 'POST', {});
      }).then(function (r) {
        eq(r.status, 200, 'M-07: sign-out still answers 200');
        eq(lines.length, 1, 'M-07: signing out writes exactly one audit line');
        eq(lines[0].action + ':' + lines[0].outcome, 'logout:success', 'M-07: the sign-out is recorded');
        eq(lines[0].actor, 'sess:' + sessionId.slice(0, 8), 'M-07: the sign-out is attributed to the session that ended');
        release();
        ACTIVE_COOKIE = null;
        s.close();
        auditStub.close();
      }).catch(function (e) { release(); throw e; });
    });
  });
})

// ===========================================================================
// 4h. MOS-v2 M-07: the audit surface cannot grow silently
// ===========================================================================
.then(function () {
  var serverCode = code(read(path.join(REF, 'server.js')));
  ok(/require\('\.\/audit'\)/.test(serverCode), 'M-07: server.js loads the audit module');
  var calls = serverCode.match(/audit\.record\(\{[\s\S]*?\}\);/g) || [];
  ok(calls.length >= 10, 'M-07: every state-changing path records an audit line (' + calls.length + ' call sites)');
  calls.forEach(function (call, i) {
    ok(!/payload\.instruction|payload\.title|instruction:|title:|password/.test(call),
       'M-07: audit call site ' + i + ' passes no instruction, title or password');
    ok(/action:/.test(call) && /outcome:/.test(call),
       'M-07: audit call site ' + i + ' names both an action and an outcome');
  });
  // The refusal of an unauthenticated write stays a single unconditional
  // line: the audit record is written BEFORE it, never inside it, so the
  // boundary cannot be made conditional on logging succeeding.
  ok(/if \(!writeMatch\.unauthenticated && !session\) return unauthenticated\(res, staleCookie\);/.test(serverCode),
     'M-07: auditing the refused write did not turn the boundary into a branch');
  // audit.js is server-side only, exactly like auth.js and upstream.js.
  ok(!fs.existsSync(path.join(WEB, 'audit.js')), 'M-07: audit.js is not in the served web directory');
  ok(serverCode.indexOf("'/audit.js'") === -1, 'M-07: audit.js has no STATIC entry');
})
// ===========================================================================
// 4i. MOS-v2 M-09: THE GOAL LAYER AND MANDATORY HUMAN APPROVAL
//
// GOAL → PROPOSED PLAN → MISSIONS → DEPENDENCIES → HUMAN APPROVAL →
// DISPATCH → RESULTS.
//
// The property under test is not "the console can create a goal". It is
// that a goal created here CANNOT run until a human says so, and that the
// human whose name goes on that decision is the one holding the session:
//
//   · require_plan_approval is written server-side on every submission and
//     is not a field the browser can set, omit or falsify;
//   · project and requested_by are likewise fixed here, never relayed from
//     the payload;
//   · decided_by is composed from the SESSION. A payload carrying one is
//     refused as an unexpected field -- an operator cannot approve as
//     somebody else, and a script cannot approve as an operator;
//   · every one of the three new writes is refused without a session, and
//     each writes exactly one audit line naming what happened;
//   · both new read relays are field-picked, so an upstream field the
//     console has never heard of -- here, one carrying a credential --
//     never reaches the browser.
// ===========================================================================
.then(function () {
  var GOAL_ID = 'c-goalstub-01ab';
  var APPROVAL_ID = 'ap-mgoal01-abc123';
  var PLAN_INSTRUCTION = 'GOAL-PLAN-INSTRUCTION-TEXT-do-not-relay';
  var OBJECTIVE = 'Finish the goal layer and prove the approval gate holds.';
  var goalPosts = [];   // { url, body } for every POST the goal stub received

  var goalStub = http.createServer(function (rq, rs) {
    var u = rq.url.split('?')[0];
    var chunks = [];
    rq.on('data', function (d) { chunks.push(d); });
    rq.on('end', function () {
      var raw = Buffer.concat(chunks).toString('utf8');
      var parsed = null;
      try { parsed = raw ? JSON.parse(raw) : null; } catch (e) { /* not JSON */ }
      if (rq.method === 'POST') goalPosts.push({ url: u, body: parsed });

      if (u === '/health') {
        rs.writeHead(200, { 'Content-Type': 'application/json' });
        rs.end(JSON.stringify({ ok: true }));
        return;
      }
      function json(code, body) {
        rs.writeHead(code, { 'Content-Type': 'application/json' });
        rs.end(JSON.stringify(body));
      }
      // Every stub body below carries at least one field the console has
      // never heard of, and it carries the executor token. If any relay
      // passes an upstream object through instead of picking fields, the
      // sweep at the end of this section finds the token in a response.
      if (rq.method === 'POST' && u === '/campaigns') {
        return json(201, {
          campaign_id: GOAL_ID, created: true, state: 'WAITING_FOR_APPROVAL',
          objective: OBJECTIVE, require_plan_approval: true, auto_denied: false,
          approval_id: APPROVAL_ID,
          proposed_plan: {
            available: true, reason: 'next roadmap capability', capability_key: 'K',
            title: 'Autonomous mission: K', objective: 'Implement K.', risk: 'low',
            acceptance_criteria: ['tests pass'],
            tasks: [
              { key: 'inspect', title: 'Inspect', task_type: 'inspection', depends_on: [],
                policy_classes: ['READ'], instruction: PLAN_INSTRUCTION },
              { key: 'implement', title: 'Implement', task_type: 'coding', depends_on: ['inspect'],
                policy_classes: ['READ', 'PROJECT_WRITE'], instruction: PLAN_INSTRUCTION }
            ]
          },
          secret_field: SECRET_TOKEN
        });
      }
      if (rq.method === 'GET' && u === '/campaigns') {
        return json(200, { campaigns: [{
          campaign_id: GOAL_ID, project: 'mythos-prod', state: 'WAITING_FOR_APPROVAL',
          objective: OBJECTIVE, completed: 0, updated_at: '2026-08-19T00:00:00Z',
          repo_path: '/should/not/leak', secret_field: SECRET_TOKEN
        }] });
      }
      if (rq.method === 'GET' && u === '/campaigns/' + GOAL_ID) {
        return json(200, {
          campaign_id: GOAL_ID, project: 'mythos-prod', objective: OBJECTIVE,
          state: 'WAITING_FOR_APPROVAL', running: false, continuable: false, needs_human: true,
          plan_approval_required: true, updated_at: '2026-08-19T00:00:00Z',
          proposed_plan: {
            available: true, reason: 'next roadmap capability', capability_key: 'K',
            title: 'Autonomous mission: K', objective: 'Implement K.', risk: 'low',
            acceptance_criteria: ['tests pass'],
            tasks: [{ key: 'inspect', title: 'Inspect', task_type: 'inspection', depends_on: [],
                      policy_classes: ['READ'], instruction: PLAN_INSTRUCTION }],
            secret_field: SECRET_TOKEN
          },
          approval_required: [{ approval_id: APPROVAL_ID, capability_key: null, mission_id: null,
                                reason: 'proposed plan requires human approval before dispatch',
                                objective: OBJECTIVE, requested_at: '2026-08-19T00:00:00Z',
                                secret_field: SECRET_TOKEN }],
          completed_missions: [{ capability_key: 'J', mission_id: 'm-1', commit: 'abc1234',
                                 tests: ['12 passed'], repair_cycles: 0, secret_field: SECRET_TOKEN }],
          blocked_missions: [{ capability_key: 'I', mission_id: 'm-0', reason: 'plan invalid',
                               secret_field: SECRET_TOKEN }],
          current_mission: { capability_key: 'K', mission_id: 'm-2',
                             tasks: [{ task_id: 'tk-1', plan_key: 'inspect', status: 'QUEUED',
                                       worktree: '/should/not/leak', agent: 'ag-1' }],
                             secret_field: SECRET_TOKEN },
          repo_path: '/should/not/leak', secret_field: SECRET_TOKEN
        });
      }
      if (rq.method === 'POST' && u === '/campaigns/' + GOAL_ID + '/approvals/resolve') {
        return json(200, { campaign_id: GOAL_ID, approval_id: APPROVAL_ID, granted: !!(parsed && parsed.granted),
                           decided_by: parsed && parsed.decided_by, capability_key: null,
                           remaining_approvals: 0, state: 'READY', secret_field: SECRET_TOKEN });
      }
      if (rq.method === 'POST' && u === '/campaigns/' + GOAL_ID + '/continue') {
        return json(202, { accepted: true, code: 'ACCEPTED', campaign_id: GOAL_ID,
                           from_state: 'READY', max_steps: 2, secret_field: SECRET_TOKEN });
      }
      json(404, { error: 'not found' });
    });
  });

  // --- source-level: the fixed fields are fixed HERE, not in the browser --
  var serverCode = code(read(path.join(REF, 'server.js')));
  var appCode2 = code(appJs);
  ok(/require_plan_approval: true/.test(serverCode),
     'M-09: the console relay hard-codes require_plan_approval: true');
  eq((serverCode.match(/require_plan_approval/g) || []).length, 1,
     'M-09: require_plan_approval appears exactly once in server.js -- it is written, never read from a payload');
  ok(!/payload\.require_plan_approval|payload\.project|payload\.requested_by|payload\.decided_by/.test(serverCode),
     'M-09: server.js never reads require_plan_approval, project, requested_by or decided_by from a request payload');
  ok(!/require_plan_approval|decided_by|requested_by/.test(appCode2),
     'M-09: the browser has no notion of the approval flag, the decider or the requester -- it cannot send any of them');
  ok(/'mos-console-operator:' \+ audit\.actor\(auth\.sessionIdFrom\(req\)\)/.test(serverCode),
     'M-09: decided_by is composed from the session, through the same truncation the audit log uses');
  var approvalFieldsBlock = (serverCode.match(/var GOAL_APPROVAL_FIELDS = \[[^\]]*\]/) || [''])[0];
  ok(approvalFieldsBlock.indexOf('decided_by') === -1,
     'M-09: decided_by is not an accepted field on the approval body, so a payload carrying one is refused rather than ignored');
  ok(/confirmAction/.test(appCode2) && /Confirm approve/.test(appCode2) && /Confirm deny/.test(appCode2),
     'M-09: approve and deny each require an explicit second, confirming click');

  return new Promise(function (resolve) { goalStub.listen(0, '127.0.0.1', resolve); }).then(function () {
    authMod.resetThrottle();
    var server = freshServer({
      MOS_EXECUTOR_URL: 'http://127.0.0.1:' + goalStub.address().port,
      MOS_EXECUTOR_TOKEN: SECRET_TOKEN,
      MOS_EXECUTOR_TOKEN_FILE: null
    });
    return server.start({ port: 0, bind: '127.0.0.1' }).then(function (s) {
      var port = s.address().port;
      ACTIVE_COOKIE = null;
      var sessionId = null;
      var bodies = [];

      // --- 1. unauthenticated: all three writes refused ------------------
      return Promise.all([
        req(port, '/api/goals', 'POST', { objective: OBJECTIVE }, { cookie: null }),
        req(port, '/api/goals/' + GOAL_ID + '/approvals', 'POST', { approval_id: APPROVAL_ID, granted: true }, { cookie: null }),
        req(port, '/api/goals/' + GOAL_ID + '/continue', 'POST', {}, { cookie: null }),
        req(port, '/api/goals', 'GET', undefined, { cookie: null }),
        req(port, '/api/goals/' + GOAL_ID, 'GET', undefined, { cookie: null })
      ]).then(function (anon) {
        ['goal create', 'goal approval', 'goal continue'].forEach(function (name, i) {
          eq(anon[i].status, 401, 'M-09: unauthenticated POST to the ' + name + ' route is 401');
          eq(anon[i].json.error, 'unauthenticated', 'M-09: the unauthenticated ' + name + ' refusal names the reason');
        });
        eq(anon[3].status, 401, 'M-09: unauthenticated GET /api/goals is 401');
        eq(anon[4].status, 401, 'M-09: unauthenticated GET /api/goals/<id> is 401');
        eq(goalPosts.length, 0, 'M-09: not one unauthenticated goal write reached the control plane');
        return login(port, CONSOLE_SECRET);
      }).then(function (l) {
        eq(l.res.status, 200, 'M-09: sign-in for the goal-layer checks succeeds');
        ACTIVE_COOKIE = l.cookie;
        sessionId = l.cookie.split('=')[1];

        // --- 2. the create relay: validation matrix ---------------------
        return Promise.all([
          req(port, '/api/goals', 'POST', { objective: OBJECTIVE }),
          req(port, '/api/goals', 'POST', { objective: OBJECTIVE, title: 'a title' }),
          req(port, '/api/goals', 'POST', {}),
          req(port, '/api/goals', 'POST', { objective: '' }),
          req(port, '/api/goals', 'POST', { objective: '   ' }),
          req(port, '/api/goals', 'POST', { objective: 42 }),
          req(port, '/api/goals', 'POST', { objective: 'x'.repeat(2001) }),
          req(port, '/api/goals', 'POST', { objective: OBJECTIVE, project: 'somebody-elses-project' }),
          req(port, '/api/goals', 'POST', { objective: OBJECTIVE, requested_by: 'not-the-console' }),
          req(port, '/api/goals', 'POST', { objective: OBJECTIVE, require_plan_approval: false }),
          req(port, '/api/goals', 'POST', { objective: OBJECTIVE, title: 7 })
        ]);
      }).then(function (r) {
        eq(r[0].status, 200, 'M-09: a well-formed goal is accepted');
        eq(r[1].status, 200, 'M-09: an optional title is accepted');
        [2, 3, 4, 5, 6, 10].forEach(function (i) {
          eq(r[i].status, 400, 'M-09: malformed goal case ' + i + ' is rejected with 400');
          eq(r[i].json.error, 'bad_request', 'M-09: malformed goal case ' + i + ' names bad_request');
        });
        // The three fields the console fixes server-side are not merely
        // ignored when a caller supplies them -- the request is refused.
        [[7, 'project'], [8, 'requested_by'], [9, 'require_plan_approval']].forEach(function (pair) {
          eq(r[pair[0]].status, 400, 'M-09: a payload carrying ' + pair[1] + ' is refused, not silently ignored');
          ok(/unexpected field/.test(r[pair[0]].json.detail),
             'M-09: the refusal for ' + pair[1] + ' names it as an unexpected field');
        });

        // --- 3. the relayed payload shape -----------------------------
        var creates = goalPosts.filter(function (c) { return c.url === '/campaigns'; });
        eq(creates.length, 2, 'M-09: exactly the two accepted goals reached the control plane -- nothing for the nine rejected ones');
        creates.forEach(function (c, i) {
          eq(Object.keys(c.body).sort().join(','), 'objective,project,requested_by,require_plan_approval',
             'M-09: relayed goal ' + i + ' carries exactly the fixed+validated fields');
          eq(c.body.require_plan_approval, true, 'M-09: relayed goal ' + i + ' always asks for mandatory plan approval');
          eq(c.body.project, 'mythos-prod', 'M-09: relayed goal ' + i + ' is fixed to the mythos-prod project');
          eq(c.body.requested_by, 'mos-console', 'M-09: relayed goal ' + i + ' identifies the console as the requester');
        });
        // The title the browser may send is deliberately not relayed: the
        // objective is the campaign's own text and a second free-text
        // field would be a second truth about the same goal.
        ok(!Object.prototype.hasOwnProperty.call(creates[1].body, 'title'),
           'M-09: the optional title is accepted from the browser and never relayed upstream');
        bodies.push(['POST /api/goals', r[0].text]);

        var created = r[0].json.data;
        eq(created.campaign_id, GOAL_ID, 'M-09: the create response names the campaign the executor made');
        eq(created.state, 'WAITING_FOR_APPROVAL', 'M-09: a goal created from the console lands WAITING_FOR_APPROVAL');
        eq(created.needs_approval, true, 'M-09: the response states that a human decision is required before anything runs');
        eq(created.approval_id, APPROVAL_ID, 'M-09: the response names the approval to answer');
        eq(created.proposed_plan.tasks.length, 2, 'M-09: the proposed plan reaches the browser with its tasks');
        eq(created.proposed_plan.tasks[1].depends_on.join(','), 'inspect',
           'M-09: a planned task carries its dependencies, so the DAG is what is being approved');
        ok(!Object.prototype.hasOwnProperty.call(created.proposed_plan.tasks[0], 'instruction'),
           'M-09: a planned task\'s agent instruction is dropped -- the plan is reviewed, not the prompt');
        ok(!Object.prototype.hasOwnProperty.call(created, 'secret_field'),
           'M-09: an unrecognised upstream field on the create response is dropped');
        ok(r[0].text.indexOf(PLAN_INSTRUCTION) === -1, 'M-09: no plan instruction text reaches the browser');

        // --- 4. the approval relay: the tamper test -------------------
        return Promise.all([
          req(port, '/api/goals/' + GOAL_ID + '/approvals', 'POST',
              { approval_id: APPROVAL_ID, granted: true, decided_by: 'somebody-else' }),
          req(port, '/api/goals/' + GOAL_ID + '/approvals', 'POST',
              { approval_id: APPROVAL_ID, granted: true, actor: 'root' }),
          req(port, '/api/goals/' + GOAL_ID + '/approvals', 'POST', { approval_id: APPROVAL_ID }),
          req(port, '/api/goals/' + GOAL_ID + '/approvals', 'POST', { approval_id: APPROVAL_ID, granted: 'true' }),
          req(port, '/api/goals/' + GOAL_ID + '/approvals', 'POST', { approval_id: APPROVAL_ID, granted: 1 }),
          req(port, '/api/goals/' + GOAL_ID + '/approvals', 'POST', { granted: true }),
          req(port, '/api/goals/' + GOAL_ID + '/approvals', 'POST', { approval_id: 'not-an-approval', granted: true }),
          req(port, '/api/goals/' + GOAL_ID + '/approvals', 'POST', { approval_id: '../../etc/passwd', granted: true }),
          req(port, '/api/goals/' + GOAL_ID + '/approvals', 'POST',
              { approval_id: APPROVAL_ID, granted: false, note: 'n'.repeat(501) }),
          req(port, '/api/goals/' + GOAL_ID + '/approvals', 'POST',
              { approval_id: APPROVAL_ID, granted: false, note: 'not this plan' })
        ]);
      }).then(function (r) {
        eq(r[0].status, 400, 'M-09: a payload carrying decided_by is REFUSED -- the decider is never taken from the browser');
        ok(/unexpected field/.test(r[0].json.detail), 'M-09: the decided_by refusal names it as an unexpected field');
        eq(r[1].status, 400, 'M-09: any other unexpected field on an approval body is refused too');
        [2, 3, 4, 5, 6, 7, 8].forEach(function (i) {
          eq(r[i].status, 400, 'M-09: malformed approval case ' + i + ' is rejected with 400');
        });
        // A decision is a boolean or it is nothing: 'true' and 1 are not
        // consents, because "I could not tell what they meant" must never
        // resolve to a grant.
        ok(/granted/.test(r[3].json.detail) && /granted/.test(r[4].json.detail),
           'M-09: a non-boolean granted value is refused by name, never coerced');
        eq(r[9].status, 200, 'M-09: a well-formed denial is accepted');

        var resolves = goalPosts.filter(function (c) { return /\/approvals\/resolve$/.test(c.url); });
        eq(resolves.length, 1, 'M-09: exactly the one accepted decision reached the control plane');
        eq(resolves[0].url, '/campaigns/' + GOAL_ID + '/approvals/resolve',
           'M-09: the decision is relayed to the executor\'s own approval-resolution route, not a second approval system');
        eq(Object.keys(resolves[0].body).sort().join(','), 'approval_id,decided_by,granted,note',
           'M-09: the relayed decision carries exactly the four decision fields');
        eq(resolves[0].body.granted, false, 'M-09: the operator\'s verdict is relayed verbatim');
        eq(resolves[0].body.decided_by, 'mos-console-operator:sess:' + sessionId.slice(0, 8),
           'M-09: decided_by is derived from the SESSION -- the operator holding it, truncated exactly as the audit log truncates it');
        ok(resolves[0].body.decided_by.indexOf('somebody-else') === -1,
           'M-09: the decided_by a browser tried to send appears nowhere in the relayed decision');
        ok(resolves[0].body.decided_by.indexOf(sessionId) === -1,
           'M-09: the session identifier never reaches the control plane in full');
        bodies.push(['POST /api/goals/<id>/approvals', r[9].text]);

        // --- 5. the continue relay ------------------------------------
        return Promise.all([
          req(port, '/api/goals/' + GOAL_ID + '/continue', 'POST', {}),
          req(port, '/api/goals/' + GOAL_ID, 'GET'),
          req(port, '/api/goals', 'GET')
        ]);
      }).then(function (r) {
        var cont = r[0], detail = r[1], list = r[2];
        eq(cont.status, 200, 'M-09: the continue relay answers 200');
        eq(cont.json.data.accepted, true, 'M-09: the continue relay reports what the executor answered');
        eq(cont.json.data.from_state, 'READY', 'M-09: the continue relay names the state the executor advanced from');
        var continues = goalPosts.filter(function (c) { return /\/continue$/.test(c.url); });
        eq(continues.length, 1, 'M-09: the continue call reached the executor once');
        eq(Object.keys(continues[0].body).sort().join(','), 'requested_by',
           'M-09: the continue relay sends only requested_by -- no max_steps, no capability, nothing the browser chose');
        eq(continues[0].body.requested_by, 'mos-console', 'M-09: the continuation identifies the console');

        // --- 6. the read relays are field-picked ----------------------
        eq(list.status, 200, 'M-09: GET /api/goals answers 200');
        var g0 = list.json.data.goals[0];
        eq(Object.keys(g0).sort().join(','), 'campaign_id,completed,objective,project,state,updated_at',
           'M-09: a goal summary carries exactly the allowlisted fields');
        ok(!Object.prototype.hasOwnProperty.call(g0, 'secret_field'),
           'M-09: an unrecognised upstream field on the goal list is dropped');
        ok(list.text.indexOf('/should/not/leak') === -1, 'M-09: the executor\'s repo path never reaches the browser through the goal list');

        eq(detail.status, 200, 'M-09: GET /api/goals/<id> answers 200');
        var g = detail.json.data.goal;
        eq(Object.keys(g).sort().join(','),
           ['campaign_id', 'project', 'objective', 'state', 'running', 'continuable', 'needs_human',
            'plan_approval_required', 'updated_at', 'proposed_plan', 'approval_required',
            'completed_missions', 'blocked_missions', 'current_mission'].sort().join(','),
           'M-09: the goal detail carries exactly the allowlisted top-level fields');
        eq(g.plan_approval_required, true, 'M-09: the detail states that this goal is gated on a human decision');
        eq(g.needs_human, true, 'M-09: the detail states that a human is being waited on');
        eq(g.approval_required.length, 1, 'M-09: the pending approval is surfaced for review');
        eq(g.approval_required[0].approval_id, APPROVAL_ID, 'M-09: the pending approval names the id to answer with');
        ok(/human approval/.test(g.approval_required[0].reason), 'M-09: the pending approval states WHY it is being asked');
        eq(Object.keys(g.approval_required[0]).sort().join(','),
           'approval_id,capability_key,mission_id,objective,reason,requested_at',
           'M-09: a pending approval carries exactly the allowlisted fields');
        eq(g.proposed_plan.tasks[0].key, 'inspect', 'M-09: the proposed plan reaches the detail view');
        ok(!Object.prototype.hasOwnProperty.call(g.proposed_plan, 'secret_field'),
           'M-09: an unrecognised field inside the proposed plan is dropped');
        ok(!Object.prototype.hasOwnProperty.call(g.proposed_plan.tasks[0], 'instruction'),
           'M-09: the plan tasks in the detail view carry no agent instruction either');
        ok(!Object.prototype.hasOwnProperty.call(g.completed_missions[0], 'secret_field'),
           'M-09: an unrecognised field on a completed mission is dropped');
        ok(!Object.prototype.hasOwnProperty.call(g.current_mission, 'secret_field'),
           'M-09: an unrecognised field on the current mission is dropped');
        eq(Object.keys(g.current_mission.tasks[0]).sort().join(','), 'plan_key,status,task_id',
           'M-09: a current-mission task carries exactly the allowlisted fields -- no worktree path, no agent id');
        ok(detail.text.indexOf('/should/not/leak') === -1, 'M-09: no worktree or repo path reaches the browser through the goal detail');
        bodies.push(['GET /api/goals', list.text]);
        bodies.push(['GET /api/goals/<id>', detail.text]);

        // --- 7. the route id regex ------------------------------------
        return Promise.all([
          req(port, '/api/goals/tk-abc12345', 'GET'),
          req(port, '/api/goals/c-UPPER-0001', 'GET'),
          req(port, '/api/goals/c-short', 'GET'),
          req(port, '/api/goals/../../etc/passwd', 'GET'),
          req(port, '/api/goals/c-goalstub-01ab/approvals/extra', 'POST', {}),
          req(port, '/api/goals/tk-abc12345/approvals', 'POST', { approval_id: APPROVAL_ID, granted: true }),
          req(port, '/api/goals/tk-abc12345/continue', 'POST', {})
        ]);
      }).then(function (r) {
        [0, 1, 2, 3].forEach(function (i) {
          eq(r[i].status, 404, 'M-09: a GET id outside the campaign alphabet (case ' + i + ') is a 404, never relayed');
        });
        [4, 5, 6].forEach(function (i) {
          eq(r[i].status, 405, 'M-09: a POST path outside the goal write routes (case ' + (i - 4) +
             ') is refused by the method guard before routing');
        });
        var strayed = goalPosts.filter(function (c) { return !/^\/campaigns/.test(c.url); });
        eq(strayed.length, 0, 'M-09: no goal request ever reached a control-plane path outside /campaigns');
        return req(port, '/api/logout', 'POST', {});
      }).then(function () {

        // --- 8. the audit lines ---------------------------------------
        var lines = [];
        var realWrite = process.stdout.write;
        process.stdout.write = function (chunk) {
          var text = String(chunk);
          if (text.indexOf('"log":"mos.audit"') !== -1) {
            text.split('\n').forEach(function (l) { if (l.trim()) lines.push(JSON.parse(l)); });
            return true;
          }
          return realWrite.apply(process.stdout, arguments);
        };
        function release() { process.stdout.write = realWrite; }

        authMod.resetThrottle();
        ACTIVE_COOKIE = null;
        return login(port, CONSOLE_SECRET).then(function (l) {
          ACTIVE_COOKIE = l.cookie;
          sessionId = l.cookie.split('=')[1];
          lines.length = 0;
          return req(port, '/api/goals', 'POST', { objective: OBJECTIVE });
        }).then(function () {
          eq(lines.length, 1, 'M-09: creating a goal writes exactly one audit line');
          eq(lines[0].action + ':' + lines[0].outcome, 'goal.create:accepted', 'M-09: the goal creation is recorded');
          eq(lines[0].task_id, GOAL_ID, 'M-09: the goal creation records the campaign the executor made');
          eq(lines[0].actor, 'sess:' + sessionId.slice(0, 8), 'M-09: the goal creation is attributed to the operator who asked');
          ok(JSON.stringify(lines[0]).indexOf(OBJECTIVE) === -1,
             'M-09: the goal objective is never written to the audit log');
          lines.length = 0;
          return req(port, '/api/goals/' + GOAL_ID + '/approvals', 'POST',
                     { approval_id: APPROVAL_ID, granted: true });
        }).then(function () {
          eq(lines.length, 1, 'M-09: a decision writes exactly one audit line');
          eq(lines[0].action + ':' + lines[0].outcome, 'goal.approve:accepted', 'M-09: the decision is recorded');
          eq(lines[0].detail.granted, true, 'M-09: the audit line records WHICH WAY the operator decided');
          eq(lines[0].detail.approval_id, APPROVAL_ID, 'M-09: the audit line records which approval was answered');
          eq(lines[0].actor, 'sess:' + sessionId.slice(0, 8), 'M-09: the decision is attributed to the operator who made it');
          ok(JSON.stringify(lines[0]).indexOf(sessionId) === -1,
             'M-09: the session identifier never appears in full in a decision audit line');
          lines.length = 0;
          return req(port, '/api/goals/' + GOAL_ID + '/approvals', 'POST',
                     { approval_id: APPROVAL_ID, granted: false, note: 'no' });
        }).then(function () {
          eq(lines[0].detail.granted, false, 'M-09: a DENIAL is recorded as explicitly as an approval');
          ok(JSON.stringify(lines[0]).indexOf('"note"') === -1, 'M-09: the operator\'s note is not written to the audit log');
          lines.length = 0;
          return req(port, '/api/goals/' + GOAL_ID + '/continue', 'POST', {});
        }).then(function () {
          eq(lines.length, 1, 'M-09: a continuation writes exactly one audit line');
          eq(lines[0].action + ':' + lines[0].outcome, 'goal.continue:accepted', 'M-09: the continuation is recorded');
          eq(lines[0].task_id, GOAL_ID, 'M-09: the continuation records which goal it advanced');
          lines.length = 0;
          return req(port, '/api/goals', 'POST', { objective: 42 });
        }).then(function () {
          eq(lines[0].action + ':' + lines[0].outcome, 'goal.create:rejected', 'M-09: a refused goal is recorded too');
          eq(lines[0].detail.reason, 'objective', 'M-09: the refusal names WHICH check refused it');
          lines.length = 0;
          return req(port, '/api/goals/' + GOAL_ID + '/continue', 'POST', {}, { cookie: null });
        }).then(function (r) {
          eq(r.status, 401, 'M-09: the unauthenticated continuation is still refused');
          eq(lines[0].action + ':' + lines[0].outcome, 'write.denied:unauthenticated',
             'M-09: an unauthenticated goal write is recorded as write.denied');
          eq(lines[0].detail.route, 'goal.continue', 'M-09: the refused goal write names the route it aimed at');
          eq(lines[0].task_id, GOAL_ID, 'M-09: the refused goal write records which goal was targeted');
          release();

          // --- 9. the sweep -------------------------------------------
          bodies.forEach(function (row) {
            ok(row[1].indexOf(SECRET_TOKEN) === -1, 'M-09: no executor token in the response for ' + row[0]);
            ok(row[1].indexOf(CONSOLE_SECRET) === -1, 'M-09: no console secret in the response for ' + row[0]);
          });
          ACTIVE_COOKIE = null;
          s.close();
          goalStub.close();
        }).catch(function (e) { release(); throw e; });
      });
    });
  });
})

// ===========================================================================
// 4j. MOS-v2 M-10: AI DECOMPOSITION IS AN OPT-IN, NOT A NEW AUTHORITY
//
// The console gains ONE field: a boolean asking that the proposed plan be
// written by a planner model instead of taken from the roadmap template.
// What is checked here is that it stays exactly that:
//
//   · a strict boolean — 'true', 1 and null are refused, not coerced;
//   · relayed ONLY when it is exactly true, so a goal submitted without it
//     produces the byte-identical upstream payload M-09 produced;
//   · it names no model, no provider, no profile and no permissions. The
//     browser cannot send any of those, and the console does not compose
//     them: which model plans, and under what authority, is the
//     executor's decision;
//   · the plan still comes back for THIS operator's approval, with the
//     planner's advisory suggestions relayed as review material and the
//     agent instruction still dropped;
//   · the audit line records WHETHER an AI wrote the plan, as a boolean
//     and nothing more.
// ===========================================================================
.then(function () {
  var GOAL_ID = 'c-decomp01-02cd';
  var APPROVAL_ID = 'ap-mdec001-abc123';
  var PLAN_INSTRUCTION = 'DECOMPOSED-PLAN-INSTRUCTION-do-not-relay';
  var OBJECTIVE = 'Survey the adapter and report what it covers.';
  var posts = [];

  // --- source-level pins ------------------------------------------------
  var serverCode = code(read(path.join(REF, 'server.js')));
  var appCode = code(appJs);
  var auditCode = code(read(path.join(REF, 'audit.js')));
  var createFields = (serverCode.match(/var GOAL_CREATE_FIELDS = \[[^\]]*\]/) || [''])[0];
  ok(/'decompose'/.test(createFields),
     'M-10: decompose is an accepted field on the goal-create body');
  ok(/if \(payload\.decompose === true\) relay\.decompose = true;/.test(serverCode),
     'M-10: the flag is relayed only when it is exactly true — never coerced, never defaulted on');
  var goalCreateBlock = serverCode.slice(serverCode.indexOf('function handleGoalCreate'),
                                         serverCode.indexOf('function handleGoalApproval'));
  ok(goalCreateBlock.length > 200 &&
     !/payload\.model|payload\.provider|payload\.execution_profile|payload\.planner/.test(goalCreateBlock),
     'M-10: the goal-create relay reads no model, provider, profile or planner selection from a payload');
  ok(/'decompose'/.test((auditCode.match(/var DETAIL_FIELDS = \[[\s\S]*?\]/) || [''])[0]),
     'M-10: decompose is an allowlisted audit detail field');
  ok(/AI decomposition \(planner model proposes the plan\)/.test(appCode),
     'M-10: the create-goal form offers the AI-decomposition checkbox, named for what it does');
  ok(/if \(decomposeBox\.checked\) body\.decompose = true;/.test(appCode),
     'M-10: the browser sends decompose only when the operator ticked it');
  ok(/planner_provider/.test(appCode) && /Planner suggested \(advisory\)/.test(appCode),
     'M-10: the plan view names the planner that proposed it and labels its suggestions as advisory');

  var AI_PLAN = {
    available: true, reason: 'proposed by the planner model and validated', capability_key: null,
    title: 'Survey and summarise', objective: OBJECTIVE, risk: null, acceptance_criteria: [],
    source: 'ai-decomposition', planner_provider: 'openai-compat', planner_model: 'gpt-4o-mini',
    tasks: [
      { key: 'scan-a', title: 'Scan', task_type: 'inspection', depends_on: [],
        policy_classes: ['READ'], recommended_model: 'gpt-4o-mini',
        execution_profile: 'repo-read', expected_result: 'A list of files.',
        instruction: PLAN_INSTRUCTION, secret_field: SECRET_TOKEN },
      { key: 'summarise', title: 'Summarise', task_type: 'reporting', depends_on: ['scan-a'],
        policy_classes: ['READ'], instruction: PLAN_INSTRUCTION }
    ],
    secret_field: SECRET_TOKEN
  };

  var stub = http.createServer(function (rq, rs) {
    var u = rq.url.split('?')[0];
    var chunks = [];
    rq.on('data', function (d) { chunks.push(d); });
    rq.on('end', function () {
      var raw = Buffer.concat(chunks).toString('utf8');
      var parsed = null;
      try { parsed = raw ? JSON.parse(raw) : null; } catch (e) { /* not JSON */ }
      if (rq.method === 'POST') posts.push({ url: u, body: parsed });
      function json(codeNum, body) {
        rs.writeHead(codeNum, { 'Content-Type': 'application/json' });
        rs.end(JSON.stringify(body));
      }
      if (u === '/health') return json(200, { ok: true });
      if (rq.method === 'POST' && u === '/campaigns') {
        return json(201, {
          campaign_id: GOAL_ID, created: true, state: 'WAITING_FOR_APPROVAL',
          objective: OBJECTIVE, require_plan_approval: true, auto_denied: false,
          approval_id: APPROVAL_ID, decompose: true, decompose_status: 'VALIDATED',
          proposed_plan: AI_PLAN, secret_field: SECRET_TOKEN
        });
      }
      if (rq.method === 'GET' && u === '/campaigns/' + GOAL_ID) {
        return json(200, {
          campaign_id: GOAL_ID, project: 'mythos-prod', objective: OBJECTIVE,
          state: 'WAITING_FOR_APPROVAL', running: false, continuable: false, needs_human: true,
          plan_approval_required: true, updated_at: '2026-08-19T00:00:00Z',
          proposed_plan: AI_PLAN, approval_required: [], completed_missions: [],
          blocked_missions: [], current_mission: null, secret_field: SECRET_TOKEN
        });
      }
      json(404, { error: 'not found' });
    });
  });

  return new Promise(function (resolve) { stub.listen(0, '127.0.0.1', resolve); }).then(function () {
    authMod.resetThrottle();
    var server = freshServer({
      MOS_EXECUTOR_URL: 'http://127.0.0.1:' + stub.address().port,
      MOS_EXECUTOR_TOKEN: SECRET_TOKEN,
      MOS_EXECUTOR_TOKEN_FILE: null
    });
    return server.start({ port: 0, bind: '127.0.0.1' }).then(function (s) {
      var port = s.address().port;
      ACTIVE_COOKIE = null;
      var sessionId = null;
      var texts = [];
      return login(port, CONSOLE_SECRET).then(function (l) {
        ACTIVE_COOKIE = l.cookie;
        sessionId = l.cookie.split('=')[1];
        return Promise.all([
          req(port, '/api/goals', 'POST', { objective: OBJECTIVE, decompose: true }),
          req(port, '/api/goals', 'POST', { objective: OBJECTIVE, decompose: false }),
          req(port, '/api/goals', 'POST', { objective: OBJECTIVE, decompose: 'true' }),
          req(port, '/api/goals', 'POST', { objective: OBJECTIVE, decompose: 1 }),
          req(port, '/api/goals', 'POST', { objective: OBJECTIVE, decompose: null }),
          req(port, '/api/goals', 'POST', { objective: OBJECTIVE, decompose: {} }),
          req(port, '/api/goals', 'POST', { objective: OBJECTIVE, planner_model: 'gpt-4o' })
        ]);
      }).then(function (r) {
        eq(r[0].status, 200, 'M-10: a goal asking for AI decomposition is accepted');
        eq(r[1].status, 200, 'M-10: a goal explicitly declining it is accepted');
        [2, 3, 4, 5].forEach(function (i) {
          eq(r[i].status, 400, 'M-10: a non-boolean decompose (case ' + i + ') is refused with 400');
          ok(/decompose/.test(r[i].json.detail),
             'M-10: the refusal for case ' + i + ' names decompose by name, never coerces it');
        });
        eq(r[6].status, 400, 'M-10: a payload trying to choose the planner model is refused');
        ok(/unexpected field/.test(r[6].json.detail),
           'M-10: choosing a planner model is refused as an unexpected field — the executor decides that');

        var creates = posts.filter(function (c) { return c.url === '/campaigns'; });
        eq(creates.length, 2, 'M-10: only the two accepted goals reached the control plane');
        eq(Object.keys(creates[0].body).sort().join(','),
           'decompose,objective,project,requested_by,require_plan_approval',
           'M-10: the relayed decomposing goal carries the flag alongside the fields M-09 already fixed');
        eq(creates[0].body.decompose, true, 'M-10: the flag is relayed as a true boolean');
        eq(creates[0].body.require_plan_approval, true,
           'M-10: an AI-decomposed goal STILL relays mandatory plan approval — the two are never traded off');
        eq(Object.keys(creates[1].body).sort().join(','),
           'objective,project,requested_by,require_plan_approval',
           'M-10: declining decomposition relays the byte-identical M-09 payload, with no flag at all');

        var created = r[0].json.data;
        eq(created.proposed_plan.source, 'ai-decomposition',
           'M-10: the browser is told the plan was written by a planner model');
        eq(created.proposed_plan.planner_provider, 'openai-compat',
           'M-10: the browser is told WHICH provider proposed it');
        eq(created.proposed_plan.planner_model, 'gpt-4o-mini',
           'M-10: the browser is told which model proposed it');
        eq(created.proposed_plan.tasks[0].recommended_model, 'gpt-4o-mini',
           'M-10: the planner\'s advisory model suggestion reaches the review view');
        eq(created.proposed_plan.tasks[0].execution_profile, 'repo-read',
           'M-10: the planner\'s advisory profile suggestion reaches the review view');
        eq(created.proposed_plan.tasks[0].expected_result, 'A list of files.',
           'M-10: the planner\'s expected result reaches the review view');
        ok(!Object.prototype.hasOwnProperty.call(created.proposed_plan.tasks[1], 'recommended_model'),
           'M-10: a task the planner made no suggestion for carries no empty suggestion');
        ok(!Object.prototype.hasOwnProperty.call(created.proposed_plan.tasks[0], 'instruction'),
           'M-10: the agent instruction is still dropped — the plan is reviewed, not the prompt');
        ok(!Object.prototype.hasOwnProperty.call(created.proposed_plan.tasks[0], 'secret_field'),
           'M-10: an unrecognised field on a decomposed plan task is dropped');
        ok(!Object.prototype.hasOwnProperty.call(created, 'decompose_status'),
           'M-10: an upstream field the console has never heard of does not become a console field');
        ok(r[0].text.indexOf(PLAN_INSTRUCTION) === -1,
           'M-10: no planner-written instruction text reaches the browser');
        texts.push(['POST /api/goals (decompose)', r[0].text]);
        return req(port, '/api/goals/' + GOAL_ID, 'GET');
      }).then(function (detail) {
        eq(detail.status, 200, 'M-10: the goal detail answers 200 for a decomposed plan');
        var g = detail.json.data.goal;
        eq(g.proposed_plan.planner_model, 'gpt-4o-mini',
           'M-10: the detail view relays the planner provenance too');
        eq(g.proposed_plan.tasks[0].execution_profile, 'repo-read',
           'M-10: the detail view relays the advisory suggestions too');
        ok(!Object.prototype.hasOwnProperty.call(g.proposed_plan.tasks[0], 'instruction'),
           'M-10: the detail view drops the instruction on a decomposed plan as well');
        texts.push(['GET /api/goals/<id> (decompose)', detail.text]);

        // --- the audit line ------------------------------------------
        var lines = [];
        var realWrite = process.stdout.write;
        process.stdout.write = function (chunk) {
          var text = String(chunk);
          if (text.indexOf('"log":"mos.audit"') !== -1) {
            text.split('\n').forEach(function (l) { if (l.trim()) lines.push(JSON.parse(l)); });
            return true;
          }
          return realWrite.apply(process.stdout, arguments);
        };
        function release() { process.stdout.write = realWrite; }
        return req(port, '/api/goals', 'POST', { objective: OBJECTIVE, decompose: true })
          .then(function () {
            eq(lines.length, 1, 'M-10: a decomposed goal writes exactly one audit line');
            eq(lines[0].detail.decompose, true,
               'M-10: the audit line records that a planner model wrote this plan');
            ok(JSON.stringify(lines[0]).indexOf(OBJECTIVE) === -1,
               'M-10: the objective is still never written to the audit log');
            lines.length = 0;
            return req(port, '/api/goals', 'POST', { objective: OBJECTIVE });
          }).then(function () {
            eq(lines[0].detail.decompose, false,
               'M-10: a goal that did not ask for decomposition records the boolean as false');
            lines.length = 0;
            return req(port, '/api/goals', 'POST', { objective: OBJECTIVE, decompose: 'yes' });
          }).then(function () {
            eq(lines[0].action + ':' + lines[0].outcome, 'goal.create:rejected',
               'M-10: a malformed decompose value is recorded as a refused write');
            eq(lines[0].detail.reason, 'decompose',
               'M-10: the refusal names WHICH check refused it');
            release();
            texts.forEach(function (rowText) {
              ok(rowText[1].indexOf(SECRET_TOKEN) === -1,
                 'M-10: no executor token in the response for ' + rowText[0]);
            });
            ACTIVE_COOKIE = null;
            s.close();
            stub.close();
          }).catch(function (e) { release(); throw e; });
      });
    });
  });
})

// ===========================================================================
// 4k. MOS-v2 M-11: GOVERNED AUTO-ROUTING
//
// provider: 'auto' never picks a provider itself -- it asks the executor's
// OWN core/provider-router.js (POST /route, same bearer channel as every
// other relay) and relays exactly what comes back. The properties under
// test:
//
//   · task_type is required with 'auto' and refused with an explicit
//     provider; model is refused alongside 'auto'; profile validation and
//     the MOS_ALLOW_REPO_WRITE gate run BEFORE any routing call is made;
//   · a router 'route'/'fallback' answer selects the model from
//     model-catalog.js's own recommended_task_types, never a caller value;
//   · 'wait_for_quota'/'no_provider' answers 409, and /tasks is never
//     called;
//   · a provider the router names but this console does not recognise is
//     an honest 502, and /tasks is never called;
//   · the relayed /tasks payload never carries the literal 'auto' anywhere;
//   · an explicit-provider request is byte-identical to the M-06 shape.
// ===========================================================================
.then(function () {
  var routePosts = [];   // { url, body } for every POST the route stub received

  var routeStub = http.createServer(function (rq, rs) {
    var u = rq.url.split('?')[0];
    var chunks = [];
    rq.on('data', function (d) { chunks.push(d); });
    rq.on('end', function () {
      var raw = Buffer.concat(chunks).toString('utf8');
      var parsed = null;
      try { parsed = raw ? JSON.parse(raw) : null; } catch (e) { /* not JSON */ }
      if (rq.method === 'POST') routePosts.push({ url: u, body: parsed });

      function json(code, body) {
        rs.writeHead(code, { 'Content-Type': 'application/json' });
        rs.end(JSON.stringify(body));
      }
      if (u === '/health') return json(200, { ok: true });

      if (rq.method === 'POST' && u === '/route') {
        var tt = parsed && parsed.task_type;
        if (tt === 'coding') return json(200, { action: 'route', agent: 'claude-code', provider: 'claude-code', authority: true });
        if (tt === 'research') return json(200, { action: 'route', agent: 'omniroute-advisory', provider: 'openai-compat', authority: false });
        if (tt === 'design') return json(200, { action: 'wait_for_quota', agent: 'claude-code', reason: 'quota exhausted', resume_after: '2026-08-20T00:00:00Z' });
        if (tt === 'validation') return json(200, { action: 'no_provider', reason: 'no available agent' });
        if (tt === 'reporting') return json(200, { action: 'route', agent: 'ghost-agent', provider: 'unknown-provider', authority: false });
        return json(200, { action: 'no_provider', reason: 'unrecognised fixture task_type' });
      }
      if (rq.method === 'POST' && u === '/tasks') {
        return json(201, { task_id: 'tk-route-stub-0001', status: 'QUEUED' });
      }
      if (rq.method === 'POST' && u === '/tasks/tk-route-stub-0001/dispatch') {
        return json(202, { task_id: 'tk-route-stub-0001', dispatched: true, running: 1, max_parallel: 5 });
      }
      json(404, { error: 'not found' });
    });
  });

  // --- source-level: 'auto' is a genuine server-side vocabulary member,
  // never a browser-invented string the console merely tolerates -------
  var serverCode = code(read(path.join(REF, 'server.js')));
  var appCode3 = code(appJs);
  ok(/CONSOLE_TASK_TYPES/.test(serverCode) && /provider === 'auto'/.test(serverCode),
     'M-11: server.js names an explicit task-type vocabulary and an explicit auto branch');
  ok(/upstream\.post\(\s*'\/route'/.test(serverCode),
     'M-11: the auto path calls the executor\'s own POST /route, not a second router');
  ok(/auto — router decides/.test(appCode3) || /auto — router decides/.test(appCode3),
     'M-11: the UI labels the auto option for what it is');

  return new Promise(function (resolve) { routeStub.listen(0, '127.0.0.1', resolve); }).then(function () {
    authMod.resetThrottle();
    var server = freshServer({
      MOS_EXECUTOR_URL: 'http://127.0.0.1:' + routeStub.address().port,
      MOS_EXECUTOR_TOKEN: SECRET_TOKEN,
      MOS_EXECUTOR_TOKEN_FILE: null,
      MOS_ALLOW_REPO_WRITE: null
    });
    delete process.env.MOS_ALLOW_REPO_WRITE;
    return server.start({ port: 0, bind: '127.0.0.1' }).then(function (s) {
      var port = s.address().port;
      ACTIVE_COOKIE = null;
      return login(port, CONSOLE_SECRET).then(function (l) {
        eq(l.res.status, 200, 'M-11: sign-in for the auto-routing checks succeeds');
        ACTIVE_COOKIE = l.cookie;

        // --- 1. auto + coding routes to claude-code with the catalog's
        // recommended model, and the relayed payload carries no 'auto' ---
        return req(port, '/api/missions/start', 'POST',
          { title: 'route me', instruction: 'implement the thing', provider: 'auto', task_type: 'coding' });
      }).then(function (r) {
        eq(r.status, 200, 'M-11: auto + coding is accepted');
        eq(r.json.data.provider, 'claude-code', 'M-11: the resolved provider is relayed to the browser');
        eq(r.json.data.model, 'sonnet', 'M-11: the resolved model is the catalog\'s recommended entry for coding');
        var relayed = routePosts.filter(function (p) { return p.url === '/tasks'; }).pop();
        eq(relayed.body.provider, 'claude-code', 'M-11: the /tasks relay carries the RESOLVED provider');
        eq(relayed.body.model, 'sonnet', 'M-11: the /tasks relay carries the RESOLVED model');
        ok(JSON.stringify(relayed.body).indexOf('auto') === -1,
           'M-11: the relayed /tasks payload contains no "auto" anywhere');

        // --- 2. auto + research routes to openai-compat / gpt-4o-mini ---
        return req(port, '/api/missions/start', 'POST',
          { title: 'survey', instruction: 'survey the adapter', provider: 'auto', task_type: 'research' });
      }).then(function (r) {
        eq(r.status, 200, 'M-11: auto + research is accepted');
        eq(r.json.data.provider, 'openai-compat', 'M-11: research resolves to the advisory provider');
        eq(r.json.data.model, 'gpt-4o-mini', 'M-11: research resolves to the catalog\'s advisory model');

        // --- 3. auto without task_type -> 400, no routing call ---------
        var before = routePosts.filter(function (p) { return p.url === '/route'; }).length;
        return req(port, '/api/missions/start', 'POST',
          { title: 't', instruction: 'i', provider: 'auto' }).then(function (rr) { return { rr: rr, before: before }; });
      }).then(function (o) {
        eq(o.rr.status, 400, 'M-11: auto without task_type is refused with 400');
        ok(/task_type/.test(o.rr.json.detail), 'M-11: the refusal names task_type');
        eq(routePosts.filter(function (p) { return p.url === '/route'; }).length, o.before,
           'M-11: no routing call was made for a request that never validated');

        // --- 4. auto + explicit model -> 400 ----------------------------
        return req(port, '/api/missions/start', 'POST',
          { title: 't', instruction: 'i', provider: 'auto', task_type: 'coding', model: 'sonnet' });
      }).then(function (r) {
        eq(r.status, 400, 'M-11: auto with an explicit model is refused with 400');
        ok(/model/.test(r.json.detail), 'M-11: the refusal names model');

        // --- 5. auto + invalid task_type -> 400 -------------------------
        return req(port, '/api/missions/start', 'POST',
          { title: 't', instruction: 'i', provider: 'auto', task_type: 'not-a-real-type' });
      }).then(function (r) {
        eq(r.status, 400, 'M-11: an invalid task_type is refused with 400');
        ok(/task_type/.test(r.json.detail), 'M-11: the refusal names task_type');

        // --- 6. auto + repo-write without MOS_ALLOW_REPO_WRITE -> 403,
        // BEFORE any routing call --------------------------------------
        var beforeRoute = routePosts.filter(function (p) { return p.url === '/route'; }).length;
        return req(port, '/api/missions/start', 'POST',
          { title: 't', instruction: 'i', provider: 'auto', task_type: 'coding', execution_profile: 'repo-write' })
          .then(function (rr) { return { rr: rr, beforeRoute: beforeRoute }; });
      }).then(function (o) {
        eq(o.rr.status, 403, 'M-11: auto + repo-write without MOS_ALLOW_REPO_WRITE is refused with 403');
        eq(routePosts.filter(function (p) { return p.url === '/route'; }).length, o.beforeRoute,
           'M-11: the profile gate refuses BEFORE any routing call is made');

        // --- 7. upstream /route answers no_provider -> 409, no /tasks --
        var beforeTasks = routePosts.filter(function (p) { return p.url === '/tasks'; }).length;
        return req(port, '/api/missions/start', 'POST',
          { title: 't', instruction: 'i', provider: 'auto', task_type: 'validation' })
          .then(function (rr) { return { rr: rr, beforeTasks: beforeTasks }; });
      }).then(function (o) {
        eq(o.rr.status, 409, 'M-11: a no_provider routing answer is relayed as 409');
        eq(o.rr.json.error, 'no_provider_available', 'M-11: the 409 names no_provider_available');
        eq(routePosts.filter(function (p) { return p.url === '/tasks'; }).length, o.beforeTasks,
           'M-11: no /tasks call is made when the router refuses');

        // --- 8. upstream /route answers wait_for_quota -> 409, no /tasks
        var beforeTasks2 = routePosts.filter(function (p) { return p.url === '/tasks'; }).length;
        return req(port, '/api/missions/start', 'POST',
          { title: 't', instruction: 'i', provider: 'auto', task_type: 'design' })
          .then(function (rr) { return { rr: rr, beforeTasks2: beforeTasks2 }; });
      }).then(function (o) {
        eq(o.rr.status, 409, 'M-11: a wait_for_quota routing answer is relayed as 409');
        eq(o.rr.json.error, 'wait_for_quota', 'M-11: the 409 names wait_for_quota');
        eq(routePosts.filter(function (p) { return p.url === '/tasks'; }).length, o.beforeTasks2,
           'M-11: no /tasks call is made while waiting on quota');

        // --- 9. upstream /route returns a provider this console does not
        // recognise -> 502, no /tasks call -------------------------------
        var beforeTasks3 = routePosts.filter(function (p) { return p.url === '/tasks'; }).length;
        return req(port, '/api/missions/start', 'POST',
          { title: 't', instruction: 'i', provider: 'auto', task_type: 'reporting' })
          .then(function (rr) { return { rr: rr, beforeTasks3: beforeTasks3 }; });
      }).then(function (o) {
        eq(o.rr.status, 502, 'M-11: a router-chosen provider this console does not recognise is an honest 502');
        eq(routePosts.filter(function (p) { return p.url === '/tasks'; }).length, o.beforeTasks3,
           'M-11: no /tasks call is made when the router names an unrecognised provider');

        // --- 10. explicit-provider requests: byte-identical to M-06 -----
        return req(port, '/api/missions/start', 'POST',
          { title: 'explicit', instruction: 'do it', provider: 'claude-code', model: 'sonnet' });
      }).then(function (r) {
        eq(r.status, 200, 'M-11: an explicit-provider request still succeeds unchanged');
        var relayed = routePosts.filter(function (p) { return p.url === '/tasks'; }).pop();
        eq(Object.keys(relayed.body).sort().join(','),
           'execution_profile,expected_delivery,instruction,model,priority,project,provider,requested_by,stage',
           'M-11: the explicit-provider /tasks relay is the byte-identical M-06 payload shape');
        eq(relayed.body.provider, 'claude-code', 'M-11: an explicit provider is relayed exactly as given');
        eq(relayed.body.model, 'sonnet', 'M-11: an explicit model is relayed exactly as given');

        s.close();
        routeStub.close();
        ACTIVE_COOKIE = null;
      });
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

// ===========================================================================
// M-12: RUNTIME SKILLS — console-layer coverage.
//
// A dedicated stub and server, isolated from every other section's state,
// exercising: (9) skill_id rejected as an unexpected field, (10) mcp_server
// rejected, (11) mcp_tool rejected, (12) mcp_endpoint rejected, plus the
// valid/invalid task_category path and its forwarding to the executor.
// ===========================================================================
.then(function () {
  return startStub().then(function (stub) {
    var stubPort = stub.address().port;
    var server = freshServer({
      MOS_EXECUTOR_URL: 'http://127.0.0.1:' + stubPort,
      MOS_EXECUTOR_TOKEN: SECRET_TOKEN,
      MOS_EXECUTOR_TOKEN_FILE: null
    });
    return server.start({ port: 0, bind: '127.0.0.1' }).then(function (s) {
      var port = s.address().port;
      ACTIVE_COOKIE = null;
      stubPostBodies.length = 0;
      return login(port, CONSOLE_SECRET).then(function (l) {
        eq(l.res.status, 200, 'M-12: sign-in for the runtime-skill checks succeeds');
        ACTIVE_COOKIE = l.cookie;

        return Promise.all([
          req(port, '/api/missions/start', 'POST', { title: 'x', instruction: 'y', provider: 'claude-code', skill_id: 'security-audit' }),
          req(port, '/api/missions/start', 'POST', { title: 'x', instruction: 'y', provider: 'claude-code', skill: 'security-audit' }),
          req(port, '/api/missions/start', 'POST', { title: 'x', instruction: 'y', provider: 'claude-code', mcp_server: 'github' }),
          req(port, '/api/missions/start', 'POST', { title: 'x', instruction: 'y', provider: 'claude-code', mcp_tool: 'github.list_pull_requests' }),
          req(port, '/api/missions/start', 'POST', { title: 'x', instruction: 'y', provider: 'claude-code', mcp_endpoint: 'https://api.github.com' }),
          req(port, '/api/missions/start', 'POST', { title: 'x', instruction: 'y', provider: 'claude-code', mcp: {} }),
          req(port, '/api/missions/start', 'POST', { title: 'x', instruction: 'y', provider: 'claude-code', task_category: 'security' }),
          req(port, '/api/missions/start', 'POST', { title: 'x', instruction: 'y', provider: 'claude-code', task_category: 'not-a-real-category' }),
          req(port, '/api/missions/start', 'POST', { title: 'x', instruction: 'y', provider: 'claude-code' })
        ]);
      }).then(function (rr) {
        var withSkillId = rr[0], withSkill = rr[1], withMcpServer = rr[2], withMcpTool = rr[3],
            withMcpEndpoint = rr[4], withMcp = rr[5], validCategory = rr[6], invalidCategory = rr[7], noCategory = rr[8];

        [['skill_id', withSkillId], ['skill', withSkill], ['mcp_server', withMcpServer],
         ['mcp_tool', withMcpTool], ['mcp_endpoint', withMcpEndpoint], ['mcp', withMcp]].forEach(function (pair) {
          eq(pair[1].status, 400, 'M-12(' + pair[0] + '): a payload carrying "' + pair[0] + '" is refused with 400');
          eq(pair[1].json.error, 'bad_request', 'M-12(' + pair[0] + '): the refusal names bad_request');
          ok(/unexpected field/.test(pair[1].json.detail), 'M-12(' + pair[0] + '): the refusal names it as an unexpected field, exactly like any other unrecognised key');
        });
        eq(validCategory.status, 200, 'M-12: a valid task_category ("security") is accepted');
        eq(invalidCategory.status, 400, 'M-12: an unrecognised task_category is refused with 400');
        ok(/task_category/.test(invalidCategory.json.detail), 'M-12: the refusal for an unrecognised task_category names the field and the allowed set');
        eq(noCategory.status, 200, 'M-12: task_category is optional -- omitting it still succeeds');

        var createCalls = stubPostBodies.filter(function (c) { return c.url === '/tasks'; });
        eq(createCalls.length, 2, 'M-12: exactly two create calls reached the executor (the valid-category and no-category requests)');
        eq(createCalls[0].body.task_category, 'security', 'M-12: task_category is relayed verbatim to the executor payload');
        ok(!Object.prototype.hasOwnProperty.call(createCalls[1].body, 'task_category'),
           'M-12: an absent task_category is never sent to the executor as null/undefined -- the field is simply not present');
        stubPostBodies.length = 0;

        ACTIVE_COOKIE = null;
        s.close();
        stub.close();
      });
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
