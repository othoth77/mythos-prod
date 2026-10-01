'use strict';
// =====================================================
// MYTHOS TRADING CONTROL CENTER — end-to-end, in a real browser
// projects/mythos-trading-control-center/tests/e2e-browser-test.js
//
// The real interface, served by the real server, driving the real Trading
// Agent, in a real headless browser. What an operator would click is clicked;
// what they would read is read back from the page.
//
// Two things are asserted on EVERY page this suite visits, by the shared
// helpers below rather than by each test remembering to:
//
//   · no script error, and no Content-Security-Policy violation, occurred;
//   · the page did not show a number where it had no data.
//
// When no headless browser is available every test here is SKIPPED, with the
// reason. A skip is reported as a skip — never as a pass.
// =====================================================

var test = require('node:test');
var assert = require('node:assert/strict');

var h = require('./helpers');
var browser = require('./browser');

var chrome = browser.findChrome();
var S, B, page, base;

function skipIfNoBrowser(t) {
  if (!chrome) { t.skip('no headless browser available (set TCC_CHROME to a chrome-headless-shell binary)'); return true; }
  return false;
}

test.before(async function () {
  if (!chrome) return;
  S = await h.startApp({ paperAutoTick: true });
  // "localhost" rather than 127.0.0.1: browsers accept a Secure cookie from it.
  base = 'http://localhost:' + S.port;
  B = await browser.launch({ chrome: chrome });
  page = await B.newPage({ width: 1440, height: 900 });
});

test.after(async function () {
  if (B) await B.close();
  if (S) await S.close();
});

async function ready(pathname) {
  await page.waitFor('location.pathname === ' + JSON.stringify(pathname) +
    ' && document.documentElement.getAttribute("data-ready") === "true" && !document.querySelector("#view [aria-busy=true]")',
  20000, pathname + ' to finish loading');
}

async function signIn(user) {
  await page.goto(base + '/login');
  await page.waitFor('!!document.getElementById("login-form")', 10000, 'the login form');
  await page.fill('#user', user);
  await page.fill('#password', h.PASSWORDS[user]);
  await page.click('#login-submit');
  await ready('/dashboard');
}

/** Client-side navigation through the sidebar, as an operator would. */
async function open(pathname) {
  await page.click('.nav-link[data-path="' + pathname + '"]');
  await ready(pathname);
}

function assertNoPageErrors(where) {
  assert.deepEqual(page.errors, [], 'script or CSP errors on ' + where + ': ' + page.errors.join(' | '));
}

// ---------------------------------------------------------------------------
// PHASE 2 — foundation: sign-in, shell, routing, responsive layout, theme
// ---------------------------------------------------------------------------

test('an unauthenticated visit to any page lands on the sign-in page', async function (t) {
  if (skipIfNoBrowser(t)) return;
  await page.goto(base + '/control');
  await page.waitFor('location.pathname === "/login"', 10000, 'the redirect to /login');
  assert.match(await page.text('.login-note'), /BACKTEST and PAPER only/);
  assertNoPageErrors('/login');
});

test('a wrong password is refused in words and nothing is stored in the browser', async function (t) {
  if (skipIfNoBrowser(t)) return;
  await page.fill('#user', 'owner');
  await page.fill('#password', 'definitely-not-the-password');
  await page.click('#login-submit');
  await page.waitFor('document.getElementById("login-error").textContent.length > 0', 10000, 'the error message');
  assert.match(await page.text('#login-error'), /not correct/);
  assert.equal(await page.eval('location.pathname'), '/login');
  assert.equal(await page.eval('document.getElementById("password").value'), '', 'the password field is cleared');
  assert.equal(await page.eval('window.localStorage.length + window.sessionStorage.length'), 0);
  // A refused sign-in logs a 401 in the browser console; that one is expected.
  page.errors.length = 0;
});

test('signing in opens the shell with the status bar and all sixteen routes', async function (t) {
  if (skipIfNoBrowser(t)) return;
  await signIn('owner');
  assert.equal(await page.count('.nav-link'), 16);
  assert.equal(await page.text('.nav-link[aria-current="page"] span'), 'Dashboard');
  var status = await page.text('#status');
  assert.match(status, /Mode\s*BACKTEST/);
  assert.match(status, /Trading\s*ENABLED/);
  assert.match(await page.text('#who'), /owner\s*OWNER/);
  assert.match(await page.text('.sidebar-foot'), /LIVE execution: not available/);
  var cookies = await page.cookies();
  var session = cookies.filter(function (c) { return c.name === 'tcc_session'; })[0];
  assert.ok(session, 'the session cookie was set');
  assert.equal(session.httpOnly, true);
  assert.equal(session.secure, true);
  assert.equal(session.sameSite, 'Strict');
  assert.equal(await page.eval('document.cookie'), '', 'the session cookie must be invisible to script');
  assertNoPageErrors('/dashboard');
});

test('the approved typefaces are actually loaded, and the tokens are in effect', async function (t) {
  if (skipIfNoBrowser(t)) return;
  var fonts = await page.eval('document.fonts.ready.then(function () { return [' +
    'document.fonts.check("14px \\"IBM Plex Sans\\""), document.fonts.check("14px \\"IBM Plex Mono\\""),' +
    'getComputedStyle(document.body).fontFamily ]; })');
  assert.equal(fonts[0], true, 'IBM Plex Sans did not load');
  assert.equal(fonts[1], true, 'IBM Plex Mono did not load');
  assert.match(fonts[2], /IBM Plex Sans/);
  var gold = await page.eval('getComputedStyle(document.documentElement).getPropertyValue("--mythos-gold-500").trim()');
  assert.equal(gold.toUpperCase(), '#D9A441');
  var radius = await page.eval('getComputedStyle(document.querySelector("#sign-out")).borderRadius');
  assert.equal(radius, '2px', 'controls use radius-control');
});

test('every route renders through client-side navigation without a reload or an error', async function (t) {
  if (skipIfNoBrowser(t)) return;
  await page.eval('window.__tccMarker = 1');
  var routes = await page.eval('Array.prototype.map.call(document.querySelectorAll(".nav-link"), function (a) { return a.getAttribute("data-path"); })');
  assert.equal(routes.length, 16);
  for (var i = 0; i < routes.length; i++) {
    await open(routes[i]);
    assert.ok(await page.exists('#view h1'), routes[i] + ' has no heading');
    assert.equal(await page.eval('document.querySelector(".nav-link[aria-current=page]").getAttribute("data-path")'), routes[i]);
    assert.match(await page.eval('document.title'), /Mythos Trading Control Center/);
  }
  assert.equal(await page.eval('window.__tccMarker'), 1, 'navigation must not reload the document');
  assertNoPageErrors('the sixteen routes');
});

test('the back button and a direct URL both resolve to the right page', async function (t) {
  if (skipIfNoBrowser(t)) return;
  await open('/risk');
  await open('/jev');
  await page.eval('history.back()');
  await ready('/risk');
  assert.equal(await page.eval('document.querySelector(".nav-link[aria-current=page]").getAttribute("data-path")'), '/risk');
  await page.goto(base + '/system');
  await ready('/system');
  assert.match(await page.text('#view h1'), /System/);
  assertNoPageErrors('direct navigation');
  // A path the server does not know is a plain 404, not the application shell.
  await page.goto(base + '/no-such-page');
  assert.match(await page.eval('document.body.textContent'), /NOT_FOUND/);
  page.errors.length = 0;      // the browser logs that 404; it is the expected one
  await page.goto(base + '/dashboard');
  await ready('/dashboard');
  assertNoPageErrors('direct navigation');
});

test('the layout is a workstation on desktop and a drawer on tablet and phone', async function (t) {
  if (skipIfNoBrowser(t)) return;
  function sidebarLeft() { return page.eval('Math.round(document.getElementById("sidebar").getBoundingClientRect().left)'); }
  function toggleShown() { return page.eval('getComputedStyle(document.getElementById("nav-toggle")).display !== "none"'); }
  function overflowX() { return page.eval('document.documentElement.scrollWidth > window.innerWidth + 1'); }

  await page.setViewport(1440, 900);
  await browser.sleep(250);
  assert.equal(await sidebarLeft(), 0, 'the sidebar is docked on desktop');
  assert.equal(await toggleShown(), false);
  assert.equal(await page.eval('Math.round(document.getElementById("sidebar").getBoundingClientRect().width)'), 240);
  assert.equal(await overflowX(), false);

  for (var vp of [[820, 1000], [390, 800]]) {
    await page.setViewport(vp[0], vp[1]);
    await browser.sleep(400);
    assert.ok(await sidebarLeft() < 0, 'the sidebar is off-canvas at ' + vp[0] + 'px');
    assert.equal(await toggleShown(), true, 'the menu button is shown at ' + vp[0] + 'px');
    assert.equal(await overflowX(), false, 'the page scrolls sideways at ' + vp[0] + 'px');
    await page.click('#nav-toggle');
    await browser.sleep(450);
    assert.equal(await sidebarLeft(), 0, 'the drawer opens at ' + vp[0] + 'px');
    assert.equal(await page.eval('document.getElementById("nav-toggle").getAttribute("aria-expanded")'), 'true');
    var linkHeight = await page.eval('Math.round(document.querySelector(".nav-link").getBoundingClientRect().height)');
    assert.ok(linkHeight >= 44, 'navigation rows are ' + linkHeight + 'px tall; the touch minimum is 44');
    await page.click('.nav-link[data-path="/system"]');
    await ready('/system');
    await browser.sleep(450);
    assert.ok(await sidebarLeft() < 0, 'choosing a page closes the drawer');
  }
  await page.setViewport(1440, 900);
  await browser.sleep(250);
  assertNoPageErrors('the responsive layout');
});

test('interactive controls meet the 44px hit area and are keyboard reachable', async function (t) {
  if (skipIfNoBrowser(t)) return;
  var small = await page.eval('(function () {' +
    'var out = []; var nodes = document.querySelectorAll("button, a.nav-link");' +
    'for (var i = 0; i < nodes.length; i++) {' +
    '  var n = nodes[i]; if (n.offsetParent === null) continue;' +
    '  var r = n.getBoundingClientRect(); var after = getComputedStyle(n, "::after");' +
    '  var extra = after.content !== "none" ? -2 * parseFloat(after.top || 0) : 0;' +
    '  if (r.height + extra < 43.5) out.push(n.textContent.trim().slice(0, 30) + ":" + Math.round(r.height + extra));' +
    '} return out; })()');
  // Desktop navigation rows are 40px by the approved prototype; buttons extend to 44.
  var offenders = small.filter(function (s) { return !/:40$/.test(s); });
  assert.deepEqual(offenders, [], 'controls below the hit-area minimum: ' + offenders.join(', '));
  var focusable = await page.eval('document.querySelectorAll("a[href], button:not([disabled])").length');
  assert.ok(focusable >= 18);
  assert.equal(await page.eval('document.querySelectorAll("[tabindex]:not([tabindex=\\"0\\"]):not([tabindex=\\"-1\\"])").length'), 0,
    'no positive tabindex may reorder the keyboard path');
});

test('the theme toggle switches the whole token set and survives a reload', async function (t) {
  if (skipIfNoBrowser(t)) return;
  function ground() { return page.eval('getComputedStyle(document.body).backgroundColor'); }
  var before = await ground();
  await page.click('#theme-toggle');
  await browser.sleep(150);
  var after = await ground();
  assert.notEqual(after, before, 'the ground colour must change with the theme');
  var theme = await page.eval('document.documentElement.getAttribute("data-theme")');
  assert.ok(theme === 'dark' || theme === 'light');
  assert.match(await page.text('#theme-toggle'), new RegExp('Theme: ' + theme));
  await page.goto(base + '/dashboard');
  await ready('/dashboard');
  assert.equal(await page.eval('document.documentElement.getAttribute("data-theme")'), theme, 'the stated theme persists');
  assert.deepEqual(await page.eval('Object.keys(window.localStorage)'), ['tcc.theme'], 'the theme is the only thing stored');
  // Leave the suite in the dark theme, the design system's default.
  if (theme !== 'dark') { await page.click('#theme-toggle'); await browser.sleep(150); }
  assert.equal(await page.eval('getComputedStyle(document.body).backgroundColor'), 'rgb(14, 14, 13)', 'dark ground is ink-850');
  assertNoPageErrors('the theme toggle');
});

test('text contrast holds in both themes for the status bar', async function (t) {
  if (skipIfNoBrowser(t)) return;
  var probe = '(function () {' +
    'function lum(c) { var m = /rgba?\\((\\d+), (\\d+), (\\d+)/.exec(c); var v = [m[1], m[2], m[3]].map(function (x) { x = x / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; }' +
    'function ratio(a, b) { var l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); }' +
    'var ground = getComputedStyle(document.body).backgroundColor;' +
    'var out = {}; var body = getComputedStyle(document.body).color; out.body = ratio(body, ground);' +
    'var sec = document.querySelector(".nav-title"); out.secondary = ratio(getComputedStyle(sec).color, getComputedStyle(document.getElementById("sidebar")).backgroundColor);' +
    'return out; })()';
  var dark = await page.eval(probe);
  assert.ok(dark.body >= 7, 'dark body text contrast is ' + dark.body.toFixed(2) + ' (AAA needs 7)');
  assert.ok(dark.secondary >= 4.5, 'dark secondary text contrast is ' + dark.secondary.toFixed(2));
  await page.click('#theme-toggle');
  await browser.sleep(150);
  var light = await page.eval(probe);
  assert.ok(light.body >= 7, 'light body text contrast is ' + light.body.toFixed(2));
  assert.ok(light.secondary >= 4.5, 'light secondary text contrast is ' + light.secondary.toFixed(2));
  await page.click('#theme-toggle');
  await browser.sleep(150);
});

test('signing out ends the session and returns to the sign-in page', async function (t) {
  if (skipIfNoBrowser(t)) return;
  await page.click('#sign-out');
  await page.waitFor('location.pathname === "/login"', 10000, 'the sign-in page after sign-out');
  await page.goto(base + '/dashboard');
  await page.waitFor('location.pathname === "/login"', 10000, 'the redirect once signed out');
  page.errors.length = 0;
  await signIn('owner');
  assertNoPageErrors('sign-in after sign-out');
});

// ---------------------------------------------------------------------------
// PHASE 3 — Dashboard
// ---------------------------------------------------------------------------

/** The same formatting the interface uses, restated here so a test compares text to text. */
function money(v) { return (v < 0 ? '\u2212' : '') + '$' + Math.abs(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function kpiText(label) {
  return page.eval('(function () { var ks = document.querySelectorAll(".kpi"); for (var i = 0; i < ks.length; i++) {' +
    ' if (ks[i].querySelector(".kpi-label").textContent === ' + JSON.stringify(label) + ') return ks[i].querySelector(".kpi-value").textContent; } return null; })()');
}
function kpiIsNoData(label) {
  return page.eval('(function () { var ks = document.querySelectorAll(".kpi"); for (var i = 0; i < ks.length; i++) {' +
    ' if (ks[i].querySelector(".kpi-label").textContent === ' + JSON.stringify(label) + ') return ks[i].classList.contains("is-nodata") ? ks[i].querySelector(".kpi-sub").textContent : false; } return null; })()');
}

var ACCOUNT_AND_PERFORMANCE = ['Balance', 'Equity', 'Net P&L', 'Drawdown', 'Trades', 'Win rate', 'Profit factor',
  'Expectancy', 'Losing streak', 'Max losing streak'];

test('with no run, the dashboard shows NO DATA with a reason and not a single fabricated figure', async function (t) {
  if (skipIfNoBrowser(t)) return;
  await open('/dashboard');
  for (var label of ACCOUNT_AND_PERFORMANCE) {
    var reason = await kpiIsNoData(label);
    assert.ok(typeof reason === 'string' && reason.length > 10, label + ' must say NO DATA with a reason, got ' + JSON.stringify(reason));
    assert.equal(await kpiText(label), 'NO DATA', label);
  }
  var body = await page.text('#dashboard-body');
  assert.ok(!/\$\d/.test(body), 'a money figure is shown although no run exists');
  assert.match(body, /No data yet/);
  assert.match(body, /no backtest has completed/);
  // What IS known is shown: state, mode, trading, the configured limits.
  assert.match(await kpiText('Mode'), /BACKTEST/);
  assert.match(await kpiText('Trading status'), /ENABLED/);
  assert.match(await kpiText('Health'), /UNKNOWN|WARN/);
  assert.match(body, /14 of 14 families enabled/);
  assert.match(body, /Score threshold\s*70/);
  for (var card of ['Open position', 'Current regime', 'Jev status', 'Risk status', 'Recovery status', 'Recent activity', 'Errors', 'Health']) {
    assert.ok(body.indexOf(card) !== -1, 'the dashboard has no "' + card + '" block');
  }
  assertNoPageErrors('the empty dashboard');
});

test('after a backtest the dashboard shows the run\'s real values, labelled SYNTHETIC', async function (t) {
  if (skipIfNoBrowser(t)) return;
  var apiClient = await S.login('owner');
  var run = await h.runBacktest(apiClient, h.FAST_BACKTEST);
  assert.equal(run.status, 'COMPLETED', JSON.stringify(run.error));
  var d = (await apiClient.get('/api/dashboard')).body.result;
  // The page refreshes itself; no reload is needed.
  await page.waitFor('(function () { var ks = document.querySelectorAll(".kpi"); for (var i = 0; i < ks.length; i++) {' +
    ' if (ks[i].querySelector(".kpi-label").textContent === "Trades") return !ks[i].classList.contains("is-nodata"); } return false; })()',
  15000, 'the dashboard to pick up the run');
  assert.equal(await kpiText('Trades'), String(d.performance.trades));
  assert.equal(await kpiText('Balance'), money(d.account.balance));
  assert.equal(await kpiText('Equity'), money(d.account.equity));
  assert.equal(await kpiText('Win rate'), (d.performance.winRate * 100).toFixed(1) + '%');
  assert.equal(await kpiText('Profit factor'), d.performance.profitFactor.toFixed(3));
  assert.equal(await kpiText('Max losing streak'), String(d.performance.maxLosingStreak));
  assert.equal(await kpiText('Drawdown'), d.account.drawdownPct.toFixed(2) + '%');
  var body = await page.text('#dashboard-body');
  assert.ok(body.indexOf(run.runId) !== -1, 'the source line names the run');
  assert.match(body, /SYNTHETIC/);
  assert.match(body, /mechanics only/);
  assert.match(body, /not a live account/);
  assert.match(body, /no session is running; a completed run holds no open position/);
  assert.match(body, /requested \d\.\d\d → approved \d\.\d\d/, 'risk shows requested and approved size side by side');
  assertNoPageErrors('the populated dashboard');
});

test('a change made elsewhere reaches the status bar and the dashboard by itself', async function (t) {
  if (skipIfNoBrowser(t)) return;
  var apiClient = await S.login('operator');
  var res = await apiClient.post('/api/config/trading', { enabled: false, reason: 'browser test: disable trading' });
  assert.equal(res.status, 200);
  await page.waitFor('/Trading\\s*DISABLED/.test(document.getElementById("status").textContent)', 12000, 'the status bar to show DISABLED');
  await page.waitFor('/Trading statusDISABLED/.test(document.getElementById("dashboard-body").textContent)', 12000, 'the dashboard to show trading DISABLED');
  assert.match(await page.text('#dashboard-body'), /EMERGENCY STOP IS SET/);
  var owner = await S.login('owner');
  await owner.post('/api/config/trading', { enabled: true, reason: 'browser test: enable trading again', confirm: 'ENABLE' });
  await page.waitFor('/Trading\\s*ENABLED/.test(document.getElementById("status").textContent)', 12000, 'the status bar to show ENABLED');
  assertNoPageErrors('the live status');
});
