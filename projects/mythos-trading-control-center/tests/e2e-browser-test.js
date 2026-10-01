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

// ---------------------------------------------------------------------------
// PHASE 4 — Control Center
// ---------------------------------------------------------------------------

/** The id of the control a visible label points at. */
async function idFor(labelText) {
  var id = await page.eval('(function () { var ls = document.querySelectorAll("label"); for (var i = 0; i < ls.length; i++) {' +
    ' if (ls[i].textContent.trim() === ' + JSON.stringify(labelText) + ' && ls[i].getAttribute("for")) return ls[i].getAttribute("for"); } return null; })()');
  assert.ok(id, 'no labelled control "' + labelText + '"');
  return '#' + id;
}
async function modalOpen() { await page.waitFor('!!document.querySelector(".modal")', 8000, 'a dialog'); }
async function modalClosed() { await page.waitFor('!document.querySelector(".modal")', 15000, 'the dialog to close'); }
async function lastToast() { return page.eval('(function () { var t = document.querySelectorAll(".toast"); return t.length ? t[t.length - 1].textContent : ""; })()'); }
async function waitToast(re, what) {
  await page.waitFor('(function () { var t = document.querySelectorAll(".toast"); for (var i = 0; i < t.length; i++) { if (' + re + '.test(t[i].textContent)) return true; } return false; })()', 15000, what || 'a toast matching ' + re);
}
async function clearToasts() { await page.eval('(function () { var h = document.getElementById("toasts"); while (h.firstChild) h.removeChild(h.firstChild); })()'); }
async function apiAs(role) { return S.login(role); }
/** Waits until the Control Center is showing the configuration the server currently has. */
async function controlSettled() {
  var api = await S.login('viewer');
  var cfg = (await api.get('/api/config')).body.result;
  await page.waitFor('(function () { var b = document.getElementById("control-body"); return !!b && b.getAttribute("data-fingerprint") === ' +
    JSON.stringify(cfg.fingerprint) + ' && b.getAttribute("data-mode") === ' + JSON.stringify(cfg.mode) + '; })()', 15000, 'the control center to show the current configuration');
  await browser.sleep(120);
}

test('the Control Center shows every control the mission names, and no LIVE control', async function (t) {
  if (skipIfNoBrowser(t)) return;
  await open('/control');
  await page.waitFor('!!document.getElementById("control-body")', 15000, 'the control center');
  var body = await page.text('#control-body');
  for (var block of ['Mode', 'Trading', 'Risk', 'Jev', 'Recovery', 'Strategies', 'Assets', 'Sessions', 'Change history', 'Mode events']) {
    assert.ok(body.indexOf(block) !== -1, 'no "' + block + '" section');
  }
  for (var label of ['Maximum account risk per trade (%)', 'Maximum drawdown (%)', 'Daily loss limit (%)', 'Maximum consecutive losses',
    'Maximum position size (lots)', 'Score threshold', 'Minimum confidence', 'Maximum recovery level']) {
    await idFor(label);
  }
  assert.match(body, /BACKTEST[\s\S]*PAPER[\s\S]*DEMO/);
  assert.equal(await page.count('#control-body .switch input'), 15, '14 strategy switches and the recovery switch');
  assert.equal(await page.eval('document.querySelectorAll("#control-body table")[0] ? 1 : 0'), 1);
  // LIVE appears as a statement, never as something to press or pick.
  assert.match(body, /LIVE execution is not available in this build/);
  var liveControls = await page.eval('Array.prototype.filter.call(document.querySelectorAll("button, option, input, select, label, a"), ' +
    'function (n) { return /\\bLIVE\\b/.test(n.textContent || n.value || ""); }).length');
  assert.equal(liveControls, 0, 'a control mentions LIVE');
  assertNoPageErrors('/control');
});

test('a risk limit change is previewed, confirmed with a reason, applied and receipted', async function (t) {
  if (skipIfNoBrowser(t)) return;
  await controlSettled();
  var dd = await idFor('Maximum drawdown (%)');
  assert.equal(await page.eval('document.querySelector(' + JSON.stringify(dd) + ').value'), '20');
  await page.fill(dd, '15');
  await page.clickText('button', 'Save risk');
  await modalOpen();
  var dialog = await page.text('.modal');
  assert.match(dialog, /risk\.maxDrawdownPct/);
  assert.match(dialog, /20[\s\S]*15/);
  assert.ok(!/Type CONFIRM/.test(dialog), 'tightening must not ask for the typed confirmation');
  // No reason, no change.
  await page.clickText('.modal-foot button', 'Apply change');
  assert.match(await page.text('.modal'), /reason of at least 5 characters/);
  await page.fill('#confirm-reason', 'tighten the drawdown cap from the browser');
  await page.clickText('.modal-foot button', 'Apply change');
  await modalClosed();
  await waitToast('/Audit entry #\\d+/', 'the receipt');
  var api = await apiAs('viewer');
  var cfg = (await api.get('/api/config')).body.result;
  assert.equal(cfg.config.risk.maxDrawdownPct, 15);
  var audit = (await api.get('/api/audit?action=config.update&limit=1')).body.result.items[0];
  assert.equal(audit.reason, 'tighten the drawdown cap from the browser');
  assert.deepEqual(audit.oldValue, { 'risk.maxDrawdownPct': 20 });
  assert.deepEqual(audit.newValue, { 'risk.maxDrawdownPct': 15 });
  await page.waitFor('/tighten the drawdown cap from the browser/.test(document.getElementById("control-body").textContent)', 10000, 'the history row');
  assertNoPageErrors('a config change');
});

test('loosening a protection demands the typed confirmation', async function (t) {
  if (skipIfNoBrowser(t)) return;
  await clearToasts();
  await controlSettled();
  var dd = await idFor('Maximum drawdown (%)');
  await page.fill(dd, '25');
  await page.clickText('button', 'Save risk');
  await modalOpen();
  var dialog = await page.text('.modal');
  assert.match(dialog, /loosens 1 protection/);
  assert.match(dialog, /Type CONFIRM to confirm/);
  await page.fill('#confirm-reason', 'loosen the drawdown cap from the browser');
  await page.clickText('.modal-foot button', 'Apply change');
  assert.match(await page.text('.modal'), /Type CONFIRM exactly/);
  var api = await apiAs('viewer');
  assert.equal((await api.get('/api/config')).body.result.config.risk.maxDrawdownPct, 15, 'nothing applied without the typed word');
  await page.fill('#confirm-typed', 'CONFIRM');
  await page.clickText('.modal-foot button', 'Apply change');
  await modalClosed();
  await waitToast('/Audit entry #\\d+/');
  assert.equal((await api.get('/api/config')).body.result.config.risk.maxDrawdownPct, 25);
});

test('a value the Trading Agent rejects is refused in words and nothing changes', async function (t) {
  if (skipIfNoBrowser(t)) return;
  await clearToasts();
  await controlSettled();
  var dd = await idFor('Maximum drawdown (%)');
  await page.fill(dd, '500');
  await page.clickText('button', 'Save risk');
  await waitToast('/maxDrawdownPct[\\s\\S]*<= 90/', 'the validation message');
  assert.equal(await page.exists('.modal'), false, 'an invalid change must not reach the confirmation step');
  var api = await apiAs('viewer');
  assert.equal((await api.get('/api/config')).body.result.config.risk.maxDrawdownPct, 25);
  page.errors.length = 0;       // the browser logs the 400; it is the expected one
});

test('trading is disabled with a reason and re-enabled only by typing ENABLE', async function (t) {
  if (skipIfNoBrowser(t)) return;
  await clearToasts();
  await open('/control');
  await controlSettled();
  await page.clickText('button', 'Disable trading');
  await modalOpen();
  await page.fill('#confirm-reason', 'disable trading from the browser');
  await page.clickText('.modal-foot button', 'Disable trading');
  await modalClosed();
  await page.waitFor('/Trading\\s*DISABLED/.test(document.getElementById("status").textContent)', 12000, 'DISABLED in the status bar');
  var api = await apiAs('viewer');
  assert.equal((await api.get('/api/config')).body.result.config.risk.emergencyStop, true);
  await controlSettled();
  await page.clickText('button', 'Enable trading');
  await modalOpen();
  await page.fill('#confirm-reason', 'enable trading from the browser');
  await page.clickText('.modal-foot button', 'Enable trading');
  assert.match(await page.text('.modal'), /Type ENABLE exactly/);
  assert.equal((await api.get('/api/status')).body.result.tradingEnabled, false);
  await page.fill('#confirm-typed', 'ENABLE');
  await page.clickText('.modal-foot button', 'Enable trading');
  await modalClosed();
  await page.waitFor('/Trading\\s*ENABLED/.test(document.getElementById("status").textContent)', 12000, 'ENABLED in the status bar');
  assertNoPageErrors('the trading switch');
});

test('strategies, assets and sessions are saved through the same audited path', async function (t) {
  if (skipIfNoBrowser(t)) return;
  await clearToasts();
  await open('/control');
  await controlSettled();
  var api = await apiAs('viewer');
  // strategies: switch off the last family
  await page.eval('(function () { var s = document.querySelectorAll("#control-body .switch input"); var last = s[s.length - 1]; last.click(); })()');
  await page.clickText('button', 'Save strategies');
  await modalOpen();
  await page.fill('#confirm-reason', 'disable one family from the browser');
  await page.clickText('.modal-foot button', 'Apply change');
  await modalClosed();
  await page.waitFor('true', 100);
  await h.waitFor(async function () { return (await api.get('/api/config')).body.result.strategies.filter(function (s) { return s.enabled; }).length === 13; }, 10000);
  // assets: drop USDCHF from the universe
  await clearToasts();
  await open('/control');
  await controlSettled();
  await page.eval('(function () { var ls = document.querySelectorAll("label.check"); for (var i = 0; i < ls.length; i++) { if (ls[i].textContent.trim() === "USDCHF") ls[i].querySelector("input").click(); } })()');
  await page.clickText('button', 'Save assets');
  await modalOpen();
  assert.match(await page.text('.modal'), /universe/);
  await page.fill('#confirm-reason', 'drop one asset from the browser');
  await page.clickText('.modal-foot button', 'Apply change');
  await modalClosed();
  await h.waitFor(async function () { return (await api.get('/api/config')).body.result.config.universe.indexOf('USDCHF') === -1; }, 10000);
  // sessions: a window for EURUSD
  await clearToasts();
  await open('/control');
  await controlSettled();
  await page.fill('select[aria-label="EURUSD session start (UTC)"]', '7');
  await page.fill('select[aria-label="EURUSD session end (UTC)"]', '16');
  await page.clickText('button', 'Save sessions');
  await modalOpen();
  await page.fill('#confirm-reason', 'set a session window from the browser');
  await page.clickText('.modal-foot button', 'Apply change');
  await modalClosed();
  await h.waitFor(async function () {
    var pa = (await api.get('/api/config')).body.result.config.schedule.perAsset;
    return pa.EURUSD && pa.EURUSD.startHourUtc === 7 && pa.EURUSD.endHourUtc === 16;
  }, 10000);
  var history = (await api.get('/api/config/history')).body.result;
  assert.ok(history.total >= 5);
  assert.equal((await api.get('/api/audit/verify')).body.result.ok, true);
  assertNoPageErrors('strategies, assets and sessions');
});

test('the owner approval dialog refuses an incomplete record and reaches PAPER with a complete one', async function (t) {
  if (skipIfNoBrowser(t)) return;
  await clearToasts();
  await open('/control');
  await controlSettled();
  await page.clickText('button', 'Approve PAPER');
  await modalOpen();
  var dialog = await page.text('.modal');
  assert.match(dialog, /I approve the Mythos Trading Agent transition BACKTEST -> PAPER/);
  assert.equal(await page.count('.modal fieldset textarea'), 10, 'ten gates, each with an evidence field');
  // An empty record is refused by the agent, in its own words.
  await page.fill('.modal .field input.input', 'I approve the Mythos Trading Agent transition BACKTEST -> PAPER');
  await page.clickText('.modal-foot button', 'Check record');
  await page.waitFor('/Would be refused/.test(document.querySelector(".modal").textContent)', 10000, 'the refusal');
  assert.match(await page.text('.modal'), /gates not satisfied/);
  assert.match(await page.text('.modal'), /ownerApproval/);
  // Complete it.
  await page.eval('(function () { var m = document.querySelector(".modal");' +
    'Array.prototype.forEach.call(m.querySelectorAll("fieldset input[type=checkbox]"), function (c) { if (!c.checked) c.click(); });' +
    'Array.prototype.forEach.call(m.querySelectorAll("fieldset textarea"), function (ta, i) {' +
    '  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(ta, "evidence " + i + ": see docs/VALIDATION_GATES.md"); ta.dispatchEvent(new Event("input", { bubbles: true })); });' +
    'var boxes = m.querySelectorAll("label.check input"); boxes[boxes.length - 1].click(); })()');
  await page.clickText('.modal-foot button', 'Check record');
  await page.waitFor('/Would be accepted/.test(document.querySelector(".modal").textContent)', 10000, 'the acceptance');
  var reasonId = await idFor('Reason — recorded in the audit log');
  await page.fill(reasonId, 'owner approves paper from the browser');
  await page.clickText('.modal-foot button', 'Approve PAPER');
  await modalClosed();
  await page.waitFor('/Mode\\s*PAPER/.test(document.getElementById("status").textContent)', 12000, 'PAPER in the status bar');
  var api = await apiAs('viewer');
  var ev = (await api.get('/api/config/mode')).body.result.events[0];
  assert.equal(ev.toMode, 'PAPER');
  assert.equal(ev.principalId, 'owner:owner');
  assert.equal(ev.gatesPassed.length, 10);
  // And back down, which needs no approval.
  await controlSettled();
  await page.clickText('button', 'Return to BACKTEST');
  await modalOpen();
  await page.fill('#confirm-reason', 'back to backtest from the browser');
  await page.clickText('.modal-foot button', 'Return to BACKTEST');
  await modalClosed();
  await page.waitFor('/Mode\\s*BACKTEST/.test(document.getElementById("status").textContent)', 12000, 'BACKTEST in the status bar');
  assertNoPageErrors('the approval dialog');
});

test('a change made elsewhere does not discard what the operator is typing', async function (t) {
  if (skipIfNoBrowser(t)) return;
  await clearToasts();
  await open('/control');
  await controlSettled();
  var th = await idFor('Score threshold');
  await page.fill(th, '77');
  var other = await apiAs('owner');
  var res = await other.patch('/api/config', { changes: { risk: { maxDailyLossPct: 4 } }, reason: 'a second owner changes the config' });
  assert.equal(res.status, 200);
  await page.waitFor('/Changed elsewhere/.test(document.getElementById("view").textContent)', 12000, 'the changed-elsewhere notice');
  assert.equal(await page.eval('document.querySelector(' + JSON.stringify(th) + ').value'), '77', 'the unsaved edit must survive');
  // Saving the stale form is refused by the server, not silently merged.
  await page.clickText('button', 'Save jev');
  await modalOpen();
  await page.fill('#confirm-reason', 'save a stale form');
  await page.clickText('.modal-foot button', 'Apply change');
  await waitToast('/changed since it was loaded/', 'the stale refusal');
  page.errors.length = 0;       // the browser logs the 409; it is the expected one
  await page.eval('(function () { var m = document.querySelector(".modal"); if (m) { var b = m.querySelector(".modal-head button"); b.click(); } })()');
  await page.clickText('#view button', 'Reload');
  await controlSettled();
  assert.equal((await other.get('/api/config')).body.result.config.jev.scoreThreshold, 70, 'the stale edit was not applied');
});

test('a viewer sees the configuration but every control is disabled', async function (t) {
  if (skipIfNoBrowser(t)) return;
  await page.click('#sign-out');
  await page.waitFor('location.pathname === "/login"', 10000, 'sign-out');
  page.errors.length = 0;
  await signIn('viewer');
  await open('/control');
  await page.waitFor('!!document.getElementById("control-body")', 15000, 'the control center');
  var enabled = await page.eval('Array.prototype.filter.call(document.querySelectorAll("#control-body input, #control-body select, #control-body button"), ' +
    'function (n) { return !n.disabled; }).length');
  assert.equal(enabled, 0, 'a viewer has ' + enabled + ' enabled control(s)');
  assert.match(await page.text('#control-body'), /Requires the OWNER role/);
  assert.match(await page.text('#who'), /viewer\s*VIEWER/);
  await page.click('#sign-out');
  await page.waitFor('location.pathname === "/login"', 10000, 'sign-out');
  page.errors.length = 0;
  await signIn('owner');
});

// ---------------------------------------------------------------------------
// PHASE 5 — Paper / Demo control room
// ---------------------------------------------------------------------------

async function paperState() {
  var api = await S.login('viewer');
  return (await api.get('/api/paper')).body.result;
}

test('outside PAPER mode the control room explains why it cannot start, instead of offering Start', async function (t) {
  if (skipIfNoBrowser(t)) return;
  await clearToasts();
  await open('/paper');
  await page.waitFor('/The platform is in BACKTEST/.test(document.getElementById("paper-state").textContent)', 15000, 'the explanation');
  assert.match(await page.text('#paper-state'), /owner-approval record/);
  var startButtons = await page.eval('Array.prototype.filter.call(document.querySelectorAll("#view button"), function (b) { return /^Start/.test(b.textContent); }).length');
  assert.equal(startButtons, 0);
  assertNoPageErrors('/paper in BACKTEST');
});

test('a paper session is started, streams its events, pauses, resumes, stops and resets from the browser', async function (t) {
  if (skipIfNoBrowser(t)) return;
  var owner = await S.login('owner');
  var setup = await owner.patch('/api/config', {
    changes: { account: { initialCapital: 5000 }, jev: { scoreThreshold: 45, minConfidence: 0.15 }, universe: ['EURUSD', 'GBPUSD', 'XAUUSD'] },
    reason: 'browser paper test setup', confirm: 'CONFIRM'
  });
  assert.equal(setup.status, 200, JSON.stringify(setup.body));
  await h.enterPaper(owner, 'browser paper test');
  await page.waitFor('/Mode\\s*PAPER/.test(document.getElementById("status").textContent)', 12000, 'PAPER in the status bar');
  await page.waitFor('!!Array.prototype.filter.call(document.querySelectorAll("#view button"), function (b) { return /^Start/.test(b.textContent); }).length', 12000, 'the Start button');

  // START
  await page.clickText('#view button', 'Start');
  await modalOpen();
  assert.match(await page.text('.modal'), /No order is sent anywhere/);
  var bars = await idFor('Bars');
  await page.fill(bars, '2400');
  var speed = await idFor('Speed');
  await page.fill(speed, '100');
  await page.clickText('.modal-foot button', 'Start session');
  await modalClosed();
  await page.waitFor('/RUNNING/.test(document.querySelector(".page-actions").textContent)', 12000, 'the RUNNING state');
  var body = await page.text('#paper-state');
  assert.match(body, /PAPER/);
  assert.match(body, /no order is sent anywhere/i);
  for (var label of ['Balance', 'Equity', 'Net P&L', 'Drawdown', 'Trades', 'Open position', 'Candidates, Jev, Risk, Recovery', 'Latest trades']) {
    assert.ok(body.indexOf(label) !== -1, 'the control room has no "' + label + '"');
  }

  // the stream is live
  await page.waitFor('document.getElementById("paper-stream-status").textContent === "stream: connected"', 12000, 'the event stream');
  await page.waitFor('document.querySelectorAll("#paper-stream .stream-row").length > 20', 30000, 'events in the stream');
  await page.waitFor('(function () { var t = {}; Array.prototype.forEach.call(document.querySelectorAll("#paper-stream .stream-type"), function (n) { t[n.textContent] = 1; });' +
    ' return t.candidate && t.jev && t.risk && t.execution && t.result; })()', 60000, 'candidate, jev, risk, execution and result events');
  var seqs = await page.eval('Array.prototype.map.call(document.querySelectorAll("#paper-stream .stream-row"), function (r) { return Number(r.getAttribute("data-seq")); })');
  for (var i = 1; i < seqs.length; i++) assert.ok(seqs[i] < seqs[i - 1], 'the stream is newest-first with no duplicate: ' + seqs[i - 1] + ', ' + seqs[i]);

  // PAUSE holds the feed still
  await page.clickText('#view button', 'Pause');
  await page.waitFor('/PAUSED/.test(document.querySelector(".page-actions").textContent)', 12000, 'the PAUSED state');
  var t1 = (await paperState()).session.ticks;
  await browser.sleep(1200);
  var t2 = (await paperState()).session.ticks;
  assert.equal(t2, t1, 'a paused session must not advance');

  // RESUME
  await page.clickText('#view button', 'Resume');
  await page.waitFor('/RUNNING/.test(document.querySelector(".page-actions").textContent)', 12000, 'RUNNING again');
  await h.waitFor(async function () { return (await paperState()).session.ticks > t2; }, 15000, 200);

  // the page shows what the API reports
  await page.eval('void 0');
  var st = await paperState();
  await page.waitFor('document.getElementById("paper-state").textContent.indexOf(' + JSON.stringify(st.session.sessionId) + ') !== -1', 8000, 'the session id on the page');

  // STOP
  await page.clickText('#view button', 'Stop');
  await page.waitFor('/STOPPED/.test(document.querySelector(".page-actions").textContent)', 15000, 'the STOPPED state');
  var stopped = await paperState();
  assert.equal(stopped.state, 'STOPPED');
  assert.equal(stopped.session.stopReason, 'STOPPED_BY_OPERATOR');
  await page.waitFor('/Archived as a run/.test(document.getElementById("paper-state").textContent)', 10000, 'the archive note');
  await page.waitFor('(function () { var ks = document.querySelectorAll("#paper-state .kpi"); for (var i = 0; i < ks.length; i++) {' +
    ' if (ks[i].querySelector(".kpi-label").textContent === "Trades") return ks[i].querySelector(".kpi-value").textContent === ' + JSON.stringify(String(stopped.session.arms[0].trades)) + '; } return false; })()',
  10000, 'the trade count to match the API');

  // RESET needs the typed word
  await page.clickText('#view button', 'Reset');
  await modalOpen();
  assert.match(await page.text('.modal'), /nothing it recorded is deleted/);
  await page.clickText('.modal-foot button', 'Reset');
  assert.match(await page.text('.modal'), /Type RESET exactly/);
  assert.equal((await paperState()).state, 'STOPPED');
  await page.fill('#confirm-typed', 'RESET');
  await page.clickText('.modal-foot button', 'Reset');
  await modalClosed();
  await page.waitFor('/IDLE/.test(document.querySelector(".page-actions").textContent)', 12000, 'the IDLE state');
  var idle = await paperState();
  assert.equal(idle.state, 'IDLE');
  assert.equal(idle.lastArchived.sessionId, stopped.session.sessionId);
  assert.match(await page.text('#paper-state'), /was archived/);
  assertNoPageErrors('the paper control room');
});

test('the event stream resumes after the connection is cut, with nothing lost or repeated', async function (t) {
  if (skipIfNoBrowser(t)) return;
  var operator = await S.login('operator');
  var start = await operator.post('/api/paper/start', { data: { kind: 'FIXTURE', symbols: ['EURUSD'], bars: 2400 }, ticksPerSecond: 60 });
  assert.equal(start.status, 200, JSON.stringify(start.body));
  await page.waitFor('document.querySelectorAll("#paper-stream .stream-row").length > 5', 30000, 'events before the cut');
  // Cut every open stream on the server side; the browser must reconnect by itself.
  var paper = S.app.platform.paper;
  var before = paper.lastEventSeq();
  S.app.server.closeAllConnections();
  await h.waitFor(async function () { return paper.lastEventSeq() > before + 30; }, 30000, 200);
  await page.waitFor('document.getElementById("paper-stream-status").textContent === "stream: connected"', 20000, 'the stream to reconnect');
  var target = paper.lastEventSeq();
  await page.waitFor('Number(document.querySelector("#paper-stream .stream-row").getAttribute("data-seq")) >= ' + target, 20000, 'the stream to catch up');
  var seqs = await page.eval('Array.prototype.map.call(document.querySelectorAll("#paper-stream .stream-row"), function (r) { return Number(r.getAttribute("data-seq")); })');
  for (var i = 1; i < seqs.length; i++) {
    assert.equal(seqs[i], seqs[i - 1] - 1, 'a hole or duplicate across the reconnect between ' + seqs[i - 1] + ' and ' + seqs[i]);
  }
  await operator.post('/api/paper/stop');
  await (await S.login('owner')).post('/api/paper/reset', { confirm: 'RESET' });
  await page.waitFor('/IDLE/.test(document.querySelector(".page-actions").textContent)', 12000, 'IDLE after the reset');
  page.errors.length = 0;      // the cut connection is logged by the browser; it is the expected one
});

// ---------------------------------------------------------------------------
// PHASE 6 — Backtest Center
// ---------------------------------------------------------------------------

test('the Backtest Center offers every input the mission names and marks HISTORICAL unavailable', async function (t) {
  if (skipIfNoBrowser(t)) return;
  await clearToasts();
  await open('/backtest');
  await page.waitFor('!!document.getElementById("backtest-form")', 15000, 'the backtest form');
  var formText = await page.text('#backtest-form');
  for (var label of ['Data source', 'Timeframe', 'From (UTC)', 'To (UTC)', 'Assets', 'Strategies', 'Initial capital', 'Score threshold',
    'Minimum confidence', 'Risk per trade (%)', 'Maximum drawdown (%)', 'Daily loss (%)', 'Consecutive losses', 'Maximum position size (lots)',
    'Recovery', 'Maximum recovery level', 'Spread', 'Slippage', 'Commission', 'Swap']) {
    assert.ok(formText.indexOf(label) !== -1, 'the form has no "' + label + '" input');
  }
  assert.match(formText, /SYNTHETIC/);
  assert.equal(await page.count('#backtest-form fieldset .check input'), 4 + 14, 'four fixture assets and fourteen strategies');
  var hist = await page.eval('(function () { var o = document.querySelectorAll("#backtest-form select option"); for (var i = 0; i < o.length; i++) {' +
    ' if (/HISTORICAL/.test(o[i].textContent)) return { disabled: o[i].disabled, text: o[i].textContent }; } return null; })()');
  assert.ok(hist, 'HISTORICAL must be listed, not omitted');
  assert.equal(hist.disabled, true);
  assert.match(hist.text, /not available/);
  assert.match(formText, /no market-data access/);
  assertNoPageErrors('/backtest');
});

test('a backtest is configured, run and read in the browser, with its label and its figures', async function (t) {
  if (skipIfNoBrowser(t)) return;
  await page.fill(await idFor('Bars'), '1200');
  await page.fill(await idFor('Initial capital'), '5000');
  await page.fill(await idFor('Score threshold'), '45');
  await page.fill(await idFor('Minimum confidence'), '0.15');
  await page.fill(await idFor('Slippage'), 'fixed');
  await page.fill(await idFor('Run label'), 'browser-run');
  await page.clickText('#backtest-form button', 'Run backtest');
  await waitToast('/Run bt-\\d{14}-[0-9a-f]{6}/', 'the started toast');
  await page.waitFor('!!document.getElementById("backtest-detail") && /COMPLETED/.test(document.getElementById("backtest-detail").textContent)', 90000, 'the run to complete');
  var runId = await page.eval('new URLSearchParams(location.search).get("run")');
  assert.match(runId, /^bt-\d{14}-[0-9a-f]{6}$/);

  var api = await S.login('viewer');
  var d = (await api.get('/api/backtest/' + runId)).body.result;
  assert.equal(d.run.label, 'browser-run');
  assert.equal(d.result.config.account.initialCapital, 5000);
  assert.equal(d.result.config.jev.scoreThreshold, 45);
  assert.equal(d.result.config.cost.slippageModel, 'fixed');
  assert.equal(d.result.data.window.bars, 1200);

  var detail = await page.text('#backtest-detail');
  assert.ok(detail.indexOf(runId) !== -1);
  assert.match(detail, /SYNTHETIC/);
  assert.match(detail, /validate mechanics only/);
  assert.match(detail, d.result.metrics.netPnl > 0 ? /NOT evidence of edge or profitability/ : /No statement about edge or profitability/);
  for (var block of ['Net P&L', 'Return', 'Max drawdown', 'Win rate', 'Profit factor', 'Expectancy', 'Trades', 'Average win', 'Average loss',
    'Max losing streak', 'Recovery failures', 'Largest position', 'Costs', 'Equity', 'Drawdown', 'Trade distribution', 'Strategy contribution',
    'Jev bands', 'Regime distribution', 'Run identity', 'Commit', 'Configuration', 'Data source', 'Dataset version', 'Caveats']) {
    assert.ok(detail.indexOf(block) !== -1, 'the run detail has no "' + block + '"');
  }
  async function tileIn(label) {
    return page.eval('(function () { var ks = document.querySelectorAll("#backtest-detail .kpi"); for (var i = 0; i < ks.length; i++) {' +
      ' if (ks[i].querySelector(".kpi-label").textContent === ' + JSON.stringify(label) + ') return ks[i].querySelector(".kpi-value").textContent; } return null; })()');
  }
  assert.equal(await tileIn('Trades'), String(d.result.metrics.tradeCount));
  assert.equal(await tileIn('Max drawdown'), d.result.metrics.maxDrawdownPct.toFixed(2) + '%');
  assert.equal(await tileIn('Win rate'), (d.result.metrics.winRate * 100).toFixed(1) + '%');
  assert.equal(await tileIn('Max losing streak'), String(d.result.metrics.maxConsecutiveLosses));
  assert.equal(await page.count('#backtest-detail figure.chart svg'), 3, 'equity, drawdown and trade distribution are drawn');
  assert.ok(await page.count('#backtest-detail .bars .bar-row') >= 8, 'the bar lists are drawn');
  assert.match(detail, /YES — a second run produced the same store digest/);
  // the charts have a text description
  var aria = await page.eval('Array.prototype.map.call(document.querySelectorAll("#backtest-detail figure.chart svg"), function (s) { return s.getAttribute("aria-label"); })');
  aria.forEach(function (a) { assert.ok(a && a.length > 20, 'a chart has no text description'); });
  assertNoPageErrors('a backtest run');
});

test('a run opens from the list, and a request the agent rejects is refused in the form', async function (t) {
  if (skipIfNoBrowser(t)) return;
  var rows = await page.count('#view table tbody tr.is-clickable');
  assert.ok(rows >= 2, 'the list shows the earlier runs');
  await page.eval('document.querySelectorAll("#view table tbody tr.is-clickable")[' + (rows - 1) + '].click()');
  await page.waitFor('(function () { var q = new URLSearchParams(location.search).get("run"); var d = document.getElementById("backtest-detail"); return !!q && !!d && d.textContent.indexOf(q) !== -1; })()',
    20000, 'the selected run');
  // An out-of-range value: refused before any process starts.
  await page.fill(await idFor('Maximum drawdown (%)'), '0.6');
  await page.fill(await idFor('Daily loss (%)'), '40');
  await page.clickText('#backtest-form button', 'Run backtest');
  await page.waitFor('/Refused/.test(document.getElementById("backtest-form").textContent)', 12000, 'the refusal');
  assert.match(await page.text('#backtest-form'), /maxDailyLossPct/);
  var api = await S.login('viewer');
  assert.equal((await api.get('/api/backtest')).body.result.active, null, 'no run was started');
  page.errors.length = 0;       // the browser logs the 400; it is the expected one
});

// ---------------------------------------------------------------------------
// PHASE 7 — Trade and Candidate explorers
// ---------------------------------------------------------------------------

var explorerRun = null;

async function tableHeaders(scope) {
  return page.eval('Array.prototype.map.call(document.querySelectorAll(' + JSON.stringify(scope + ' thead th') + '), function (th) { return th.textContent; })');
}
async function rowCount(scope) { return page.count(scope + ' tbody tr'); }

test('the Trade Explorer shows every column the mission names, from a run with clamped sizes', async function (t) {
  if (skipIfNoBrowser(t)) return;
  var api = await S.login('owner');
  explorerRun = await h.runBacktest(api, { symbols: ['EURUSD', 'XAUUSD'], initialCapital: 5000, data: { kind: 'FIXTURE', bars: 1500 },
    jev: { scoreThreshold: 50, minConfidence: 0.2 }, recovery: { enabled: true, maxRecoveryLevel: 3 }, cost: { slippageModel: 'fixed', fixedSlippagePips: 0.3 } });
  assert.equal(explorerRun.status, 'COMPLETED', JSON.stringify(explorerRun.error));
  await page.goto(base + '/trades?run=' + explorerRun.runId);
  await ready('/trades');
  await page.waitFor('document.querySelectorAll("#trades-body tbody tr").length > 0', 15000, 'trade rows');
  assert.deepEqual(await tableHeaders('#trades-body'), ['Exit', 'Asset', 'Strategy', 'Dir', 'Entry', 'SL', 'TP', 'Requested', 'Approved',
    'Jev', 'Conf', 'Risk', 'Rec', 'Costs', 'Exit', 'P&L', 'R']);
  var trades = (await api.get('/api/trades?run=' + explorerRun.runId + '&limit=50')).body.result.data;
  assert.equal(await rowCount('#trades-body'), Math.min(50, trades.total));
  var view = await page.text('#view');
  assert.ok(view.indexOf(explorerRun.runId) !== -1, 'the page names its source run');
  assert.match(view, /SYNTHETIC/);
  // first row equals the API's first row
  var cells = await page.eval('Array.prototype.map.call(document.querySelector("#trades-body tbody tr").children, function (td) { return td.textContent; })');
  var first = trades.items[0];
  assert.equal(cells[1], first.symbol);
  assert.equal(cells[2], first.strategyId);
  assert.equal(cells[7], first.requestedLots.toFixed(2));
  assert.equal(cells[8], first.approvedLots.toFixed(2));
  assert.equal(cells[11], first.riskVerdict);
  assert.equal(cells[12], String(first.recoveryLevel));
  // a clamped trade is visibly requested > approved
  var clampedRows = await page.eval('Array.prototype.filter.call(document.querySelectorAll("#trades-body tbody tr"), function (tr) {' +
    ' return Number(tr.children[7].textContent) > Number(tr.children[8].textContent); }).length');
  var clampedApi = trades.items.filter(function (x) { return x.requestedLots > x.approvedLots; }).length;
  assert.equal(clampedRows, clampedApi);
  assert.ok(clampedApi > 0, 'this run should contain clamped trades');
  assertNoPageErrors('/trades');
});

test('a trade opens its detail, and filters narrow the list to what the API has', async function (t) {
  if (skipIfNoBrowser(t)) return;
  var api = await S.login('viewer');
  await page.click('#trades-body tbody tr');
  await modalOpen();
  var dialog = await page.text('.modal');
  for (var label of ['Requested size', 'Approved size', 'Executed size', 'Risk verdict', 'Jev', 'Recovery level', 'Costs', 'Net P&L', 'Stop loss', 'Take profit', 'R']) {
    assert.ok(dialog.indexOf(label) !== -1, 'the trade detail has no "' + label + '"');
  }
  await page.clickText('.modal-foot button', 'Close');
  await modalClosed();
  await page.fill(await idFor('Asset'), 'XAUUSD');
  var expected = (await api.get('/api/trades?run=' + explorerRun.runId + '&symbol=XAUUSD&limit=50')).body.result.data;
  await page.waitFor('(function () { var r = document.querySelectorAll("#trades-body tbody tr"); if (!r.length) return ' + (expected.total === 0) + ';' +
    ' return Array.prototype.every.call(r, function (tr) { return tr.children[1].textContent === "XAUUSD"; }) && r.length === ' + Math.min(50, expected.total) + '; })()',
  15000, 'the filtered rows');
  assert.match(await page.eval('location.search'), /symbol=XAUUSD/, 'the filter is in the URL, so the view can be shared and reloaded');
  await page.fill(await idFor('Outcome'), 'LOSS');
  var losses = (await api.get('/api/trades?run=' + explorerRun.runId + '&symbol=XAUUSD&outcome=LOSS&limit=50')).body.result.data;
  await page.waitFor('document.querySelector("#trades-body .pager").textContent.indexOf("of ' + losses.total + '") !== -1', 15000, 'the loss filter');
  assertNoPageErrors('trade filters');
});

test('the Candidate Explorer shows rejected candidates with the recorded reason codes', async function (t) {
  if (skipIfNoBrowser(t)) return;
  var api = await S.login('viewer');
  await page.goto(base + '/candidates?run=' + explorerRun.runId + '&decision=NO_TRADE');
  await ready('/candidates');
  await page.waitFor('document.querySelectorAll("#candidates-body tbody tr").length > 0', 15000, 'candidate rows');
  assert.deepEqual(await tableHeaders('#candidates-body'), ['Bar', 'Asset', 'Strategy', 'Signal', 'Dir', 'Regime', 'Jev (score / conf)',
    'Risk (req → appr)', 'Decision', 'Reason codes (recorded)']);
  var data = (await api.get('/api/candidates?run=' + explorerRun.runId + '&decision=NO_TRADE&limit=50')).body.result.data;
  var rows = await page.eval('Array.prototype.map.call(document.querySelectorAll("#candidates-body tbody tr"), function (tr) {' +
    ' return { decision: tr.children[8].textContent, reasons: Array.prototype.map.call(tr.children[9].querySelectorAll(".chip"), function (c) { return c.textContent; }) }; })');
  assert.equal(rows.length, Math.min(50, data.total));
  rows.forEach(function (r, i) {
    assert.match(r.decision, /NO TRADE/);
    assert.match(r.decision, new RegExp('at ' + data.items[i].stage));
    assert.deepEqual(r.reasons, data.items[i].reasonCodes, 'row ' + i + ' shows reasons the store does not have');
    assert.ok(r.reasons.length > 0, 'a rejected candidate must show its recorded reason');
  });
  var summary = await page.text('#view');
  assert.match(summary, new RegExp(data.total + ' candidates'));
  assert.match(summary, new RegExp(data.rejected + ' rejected'));
  assertNoPageErrors('/candidates');
});

// ---------------------------------------------------------------------------
// PHASE 8 — Decision Explorer
// ---------------------------------------------------------------------------

var CHAIN = ['MARKET', 'REGIME', 'STRATEGY', 'CANDIDATE', 'JEV', 'COST', 'RISK_ENGINE', 'RECOVERY', 'EXECUTION', 'RESULT', 'ANALYSIS'];

async function chainOnPage() {
  return page.eval('Array.prototype.map.call(document.querySelectorAll("#chain .chain-stage"), function (n) {' +
    ' return { stage: n.getAttribute("data-stage"), status: n.getAttribute("data-status"), text: n.textContent }; })');
}

test('a candidate row opens the complete eleven-stage chain, in order, with stored values', async function (t) {
  if (skipIfNoBrowser(t)) return;
  var api = await S.login('viewer');
  var trade = (await api.get('/api/trades?run=' + explorerRun.runId + '&limit=1')).body.result.data.items[0];
  await page.goto(base + '/candidates?run=' + explorerRun.runId + '&decision=ENTER');
  await ready('/candidates');
  await page.waitFor('document.querySelectorAll("#candidates-body tbody tr").length > 0', 15000, 'candidate rows');
  await page.click('#candidates-body tbody tr');
  await page.waitFor('location.pathname === "/decisions" && !!document.getElementById("chain")', 15000, 'the chain');
  var candidateId = await page.eval('new URLSearchParams(location.search).get("candidate")');
  var expected = (await api.get('/api/decisions/' + encodeURIComponent(candidateId) + '?run=' + explorerRun.runId)).body.result.chain;
  var shown = await chainOnPage();
  assert.deepEqual(shown.map(function (s) { return s.stage; }), CHAIN);
  assert.deepEqual(shown.map(function (s) { return s.status; }), expected.stages.map(function (s) { return s.status; }));
  var by = {};
  shown.forEach(function (s) { by[s.stage] = s.text; });
  var rec = {};
  expected.stages.forEach(function (s) { rec[s.stage] = s.record; });
  assert.ok(by.RISK_ENGINE.indexOf(rec.RISK_ENGINE.requestedLots.toFixed(2) + ' lots') !== -1, 'the requested size is shown');
  assert.ok(by.RISK_ENGINE.indexOf(rec.RISK_ENGINE.approvedLots.toFixed(2) + ' lots') !== -1, 'the approved size is shown');
  assert.ok(by.RISK_ENGINE.indexOf(rec.RISK_ENGINE.verdict) !== -1);
  assert.ok(by.JEV.indexOf('ALLOW') !== -1 && by.JEV.indexOf('stored as ENTER') !== -1, 'Jev shows the label and the stored value');
  assert.ok(by.JEV.indexOf(String(rec.JEV.threshold)) !== -1);
  assert.ok(by.CANDIDATE.indexOf(String(rec.CANDIDATE.entry)) !== -1);
  assert.ok(by.MARKET.indexOf(rec.MARKET.datasetVersion) !== -1);
  assert.ok(by.COST.indexOf('The agent applies the cost filter before the Jev gate') !== -1);
  // every recorded stage offers its raw stored row
  assert.equal(await page.count('#chain .chain-stage.is-recorded details'), expected.integrity.recorded);
  var header = await page.text('#chain');
  assert.match(header, new RegExp(expected.integrity.recorded + ' of 11 stages recorded'));
  void trade;
  assertNoPageErrors('a decision chain');
});

test('a rejected candidate\'s chain stops where the pipeline stopped and invents nothing after it', async function (t) {
  if (skipIfNoBrowser(t)) return;
  var api = await S.login('viewer');
  var rejected = (await api.get('/api/candidates?run=' + explorerRun.runId + '&decision=NO_TRADE&stage=JEV&limit=1')).body.result.data.items[0];
  assert.ok(rejected, 'the run has a candidate rejected by Jev');
  await page.goto(base + '/decisions?candidate=' + encodeURIComponent(rejected.candidateId) + '&run=' + explorerRun.runId);
  await page.waitFor('!!document.getElementById("chain")', 15000, 'the chain');
  var shown = await chainOnPage();
  var by = {};
  shown.forEach(function (s) { by[s.stage] = s; });
  assert.equal(by.JEV.status, 'RECORDED');
  assert.ok(by.JEV.text.indexOf('BLOCK') !== -1 && by.JEV.text.indexOf('stored as REJECT') !== -1);
  ['RISK_ENGINE', 'RECOVERY', 'EXECUTION', 'RESULT', 'ANALYSIS'].forEach(function (s) {
    assert.equal(by[s].status, 'NOT_REACHED', s);
    assert.match(by[s].text, /the pipeline stopped at JEV/);
    assert.ok(!/\d+\.\d\d lots/.test(by[s].text), s + ' shows a size although it was never reached');
  });
  var head = await page.text('#chain');
  assert.match(head, /NO TRADE/);
  assert.match(head, /stopped at JEV/);
  rejected.reasonCodes.forEach(function (code) { assert.ok(head.indexOf(code) !== -1, 'the recorded reason ' + code + ' is not shown'); });
  assert.equal(await page.count('#chain .chain-stage.is-not-reached details'), 0, 'a stage that was not reached has no record to open');
  assertNoPageErrors('a rejected chain');
});

test('the decision list is the stored verdicts, and an unknown candidate is an error, not an empty chain', async function (t) {
  if (skipIfNoBrowser(t)) return;
  var api = await S.login('viewer');
  await page.goto(base + '/decisions?run=' + explorerRun.runId);
  await ready('/decisions');
  await page.waitFor('document.querySelectorAll("#decisions-body tbody tr").length > 0', 15000, 'decision rows');
  var data = (await api.get('/api/decisions?run=' + explorerRun.runId + '&limit=50')).body.result.data;
  assert.equal(await rowCount('#decisions-body'), Math.min(50, data.total));
  var summary = await page.text('#view');
  assert.match(summary, new RegExp(data.total + ' decisions'));
  assert.match(summary, /Chain order: Market → Regime → Strategy → Candidate → Jev → Cost → Risk Engine → Recovery → Execution → Result → Analysis/);
  await page.goto(base + '/decisions?candidate=cand-does-not-exist&run=' + explorerRun.runId);
  await page.waitFor('/could not be loaded|not found/i.test(document.getElementById("view").textContent)', 15000, 'the not-found state');
  assert.equal(await page.exists('#chain'), false);
  page.errors.length = 0;       // the browser logs the 404; it is the expected one
});

// ---------------------------------------------------------------------------
// PHASE 9 — Strategies, Jev, Risk, Recovery
// ---------------------------------------------------------------------------

async function openEngine(pathname, bodyId) {
  await page.goto(base + pathname + '?run=' + explorerRun.runId);
  await ready(pathname);
  await page.waitFor('!!document.getElementById(' + JSON.stringify(bodyId) + ') && document.getElementById(' + JSON.stringify(bodyId) + ').textContent.indexOf(' +
    JSON.stringify(explorerRun.runId) + ') !== -1', 15000, pathname + ' to show its source run');
  return page.text('#view');
}

test('the Strategies page shows all fourteen families with sample sizes beside the statistics', async function (t) {
  if (skipIfNoBrowser(t)) return;
  var api = await S.login('viewer');
  var text = await openEngine('/strategies', 'strategies-body');
  assert.match(text, /cannot express a position size/);
  var data = (await api.get('/api/strategies?run=' + explorerRun.runId)).body.result;
  var rows = await page.eval('Array.prototype.map.call(document.querySelectorAll("#strategies-body table")[0].querySelectorAll("tbody tr"), function (tr) {' +
    ' return Array.prototype.map.call(tr.children, function (td) { return td.textContent; }); })');
  assert.equal(rows.length, 14);
  rows.forEach(function (cells, i) {
    var s = data.strategies[i];
    assert.ok(cells[0].indexOf(s.strategyId) === 0, cells[0]);
    assert.equal(cells[2], String(s.candidates).replace(/\B(?=(\d{3})+(?!\d))/g, ','));
    assert.ok(cells[5].indexOf('n=' + s.trades.sampleSize) === 0, 'the sample size is shown: ' + cells[5]);
    if (s.trades.sampleSize > 0) assert.match(cells[5], s.trades.sufficient ? /sufficient/ : /INSUFFICIENT DATA/);
    if (s.trades.sampleSize === 0) assert.equal(cells[6], 'n/a', 'a strategy with no trades shows no win rate');
  });
  assert.ok(data.strategies.some(function (s) { return s.trades.sampleSize > 0 && !s.trades.sufficient; }), 'this run has thin samples to mark');
  assertNoPageErrors('/strategies');
});

test('the Jev page shows score, confidence, ALLOW / BLOCK and the four score bands', async function (t) {
  if (skipIfNoBrowser(t)) return;
  var api = await S.login('viewer');
  var text = await openEngine('/jev', 'jev-body');
  assert.match(text, /carries no size and cannot overrule the Risk Engine/);
  assert.match(text, /Stored decisions are ENTER and REJECT; they are shown here as ALLOW and BLOCK/);
  var d = (await api.get('/api/jev?run=' + explorerRun.runId)).body.result.data;
  var bands = await page.eval('Array.prototype.map.call(document.querySelectorAll("#jev-body table")[0].querySelectorAll("tbody tr"), function (tr) {' +
    ' return Array.prototype.map.call(tr.children, function (td) { return td.textContent; }); })');
  assert.deepEqual(bands.map(function (b) { return b[0]; }), ['70–79', '80–89', '90–94', '95–100', 'below 70']);
  bands.forEach(function (cells, i) {
    assert.equal(Number(cells[1].replace(/,/g, '')), d.bands[i].considered);
    assert.equal(Number(cells[2].replace(/,/g, '')), d.bands[i].allowed);
    assert.equal(Number(cells[3].replace(/,/g, '')), d.bands[i].blocked);
    assert.ok(cells[4].indexOf('n=' + d.bands[i].trades.sampleSize) === 0);
  });
  assert.match(text, /INSUFFICIENT DATA/, 'thin bands are marked as such');
  var verdictHeads = await page.eval('Array.prototype.map.call(document.querySelectorAll("#jev-body table")[1].querySelectorAll("thead th"), function (th) { return th.textContent; })');
  assert.deepEqual(verdictHeads, ['Bar', 'Asset', 'Strategy', 'Score', 'Confidence', 'Band', 'Verdict', 'Reason codes']);
  var verdicts = await page.eval('Array.prototype.map.call(document.querySelectorAll("#jev-body table")[1].querySelectorAll("tbody tr"), function (tr) { return tr.children[6].textContent; })');
  verdicts.forEach(function (v) { assert.ok(v === 'ALLOW' || v === 'BLOCK', v); });
  assertNoPageErrors('/jev');
});

test('the Risk page shows limits, verdicts, clamps as clamps, and blocks — with the Risk Engine named as final', async function (t) {
  if (skipIfNoBrowser(t)) return;
  var api = await S.login('viewer');
  var text = await openEngine('/risk', 'risk-body');
  assert.match(text, /The Risk Engine is the final authority/);
  assert.match(text, /nothing in this console sets a size/);
  for (var block of ['Risk per trade', 'Max drawdown', 'Daily loss', 'Consecutive losses', 'Max position', 'Limits as last observed',
    'Exposure', 'Clamps', 'Blocks', 'Risk events', 'Risk budget', 'Drawdown headroom', 'Daily loss headroom', 'Position size']) {
    assert.ok(text.indexOf(block) !== -1, 'the risk page has no "' + block + '"');
  }
  var d = (await api.get('/api/risk?run=' + explorerRun.runId)).body.result.data;
  async function tile(label) {
    return page.eval('(function () { var ks = document.querySelectorAll("#risk-body .kpi"); for (var i = 0; i < ks.length; i++) {' +
      ' if (ks[i].querySelector(".kpi-label").textContent === ' + JSON.stringify(label) + ') return ks[i].querySelector(".kpi-value").textContent; } return null; })()');
  }
  assert.equal(Number((await tile('CLAMP')).replace(/,/g, '')), d.byVerdict.CLAMP);
  assert.equal(Number((await tile('BLOCK')).replace(/,/g, '')), d.byVerdict.BLOCK);
  assert.equal(Number((await tile('ALLOW')).replace(/,/g, '')), d.byVerdict.ALLOW);
  // every row of the Clamps table has requested > approved
  var clamps = await page.eval('(function () { var cards = document.querySelectorAll("#risk-body section.card"); for (var i = 0; i < cards.length; i++) {' +
    ' var h = cards[i].querySelector("h2"); if (h && h.textContent === "Clamps") return Array.prototype.map.call(cards[i].querySelectorAll("tbody tr"), function (tr) {' +
    ' return [Number(tr.children[3].textContent), Number(tr.children[4].textContent)]; }); } return null; })()');
  assert.ok(clamps && clamps.length > 0, 'this run has clamps to show');
  clamps.forEach(function (c) { assert.ok(c[0] > c[1], 'a clamp row with requested ' + c[0] + ' and approved ' + c[1]); });
  assertNoPageErrors('/risk');
});

test('the Recovery page shows the state per asset with requested and approved size, and the ladder against the cap', async function (t) {
  if (skipIfNoBrowser(t)) return;
  var api = await S.login('viewer');
  var text = await openEngine('/recovery', 'recovery-body');
  assert.match(text, /only REQUESTS a size/);
  assert.match(text, /remains authoritative/);
  assert.match(text, /clamped to/, 'rungs above the position cap are shown as clamped');
  var d = (await api.get('/api/recovery?run=' + explorerRun.runId)).body.result.data;
  var heads = await page.eval('Array.prototype.map.call(document.querySelectorAll("#recovery-body table")[0].querySelectorAll("thead th"), function (th) { return th.textContent; })');
  assert.deepEqual(heads, ['Asset', 'Level', 'Cumulative loss', 'Requested size', 'Approved size', 'Risk verdict', 'Last transition', 'Max level', 'Reset', 'Abandoned']);
  var rows = await page.eval('Array.prototype.map.call(document.querySelectorAll("#recovery-body table")[0].querySelectorAll("tbody tr"), function (tr) {' +
    ' return Array.prototype.map.call(tr.children, function (td) { return td.textContent; }); })');
  assert.equal(rows.length, d.perAsset.length);
  assert.deepEqual(rows.map(function (r) { return r[0]; }), ['EURUSD', 'XAUUSD'], 'the assets are the run\'s own, not the platform\'s current universe');
  rows.forEach(function (cells, i) {
    var a = d.perAsset[i];
    if (!a.recorded) return;
    assert.equal(cells[1], String(a.level));
    assert.equal(cells[3], a.requestedLots.toFixed(2));
    assert.equal(cells[4], a.approvedLots.toFixed(2));
    assert.equal(cells[7], String(a.maxLevel));
    assert.equal(Number(cells[8].replace(/,/g, '')), a.resets);
  });
  assert.match(text, new RegExp(d.transitions + ' recorded'));
  assertNoPageErrors('/recovery');
});

test('the engine pages say NO DATA with a reason when there is no source', async function (t) {
  if (skipIfNoBrowser(t)) return;
  var A = await h.startApp();
  var b2 = 'http://localhost:' + A.port;
  await page.goto(b2 + '/login');
  await page.waitFor('!!document.getElementById("login-form")', 10000, 'the login form');
  await page.fill('#user', 'viewer');
  await page.fill('#password', h.PASSWORDS.viewer);
  await page.click('#login-submit');
  await page.waitFor('location.pathname === "/dashboard" && document.documentElement.getAttribute("data-ready") === "true"', 15000, 'the second server');
  for (var pathname of ['/jev', '/risk', '/recovery', '/strategies', '/trades', '/candidates', '/decisions']) {
    await page.goto(b2 + pathname);
    await page.waitFor('/NO DATA/.test(document.getElementById("view").textContent)', 15000, 'NO DATA on ' + pathname);
    var text = await page.text('#view');
    assert.match(text, /no backtest has completed/, pathname);
    assert.equal(await page.count('#view table tbody tr.is-clickable'), 0, pathname + ' shows rows with no source');
  }
  // What is configured is still shown on the engine pages — it is real.
  await page.goto(b2 + '/risk');
  await page.waitFor('/Risk per trade/.test(document.getElementById("view").textContent)', 15000, 'configured limits');
  assertNoPageErrors('the pages with no source');
  await A.close();
  await signIn('owner');
});
