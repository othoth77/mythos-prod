'use strict';
/* =====================================================================
   MYTHOS PROD — local, isolated visual verification
   tools/visual-verify.js

   Built under AUTO-6 (docs/MYTHOS_DESIGN_DECISIONS.md §0.5) to close the
   capability gap IMPLEMENTATION_READINESS_AUDIT.md §2.5 named: no tooling
   in this repository could verify a real, live page against the design
   system. This closes it for the LOCAL, isolated case — it never touches
   `https://uthinachess.tn/...` and cannot be pointed at it (see the
   loopback-only guard below, enforced in code, not just documented).

   WHAT THIS DOES
   Copies a READ-ONLY snapshot of the app's static surface (index.html,
   css/, js/, assets/, manifest.json, api.php) into a fresh OS temp
   directory, serves it with `php -S 127.0.0.1:<port>` from that copy
   (never from this checkout — api.php auto-creates `appdata/` on first
   request, and this tool never lets that land inside a real checkout),
   seeds the browser session exactly the way `js/auth.js`'s
   `AUTH.createSession()` does (writes `{ts: Date.now()}` to
   `localStorage.mp_auth_session` — the same thing a real login does,
   done client-side, on an instance with zero real data), then screenshots
   a configurable list of views. Two runs (before/after a candidate CSS or
   token change) can be diffed.

   WHAT THIS NEVER DOES
   - Never serves this checkout's own `css/main.css`/`api.php` directly —
     always an isolated temp copy, deleted after the run unless --keep.
   - Never reads or writes this checkout's `appdata/` (it does not exist
     here — see .gitignore — and this tool does not create one here).
   - Refuses to launch against, or navigate to, any host that is not
     127.0.0.1 or localhost. This is a hard-coded check, not a convention.
   - Needs no real Google OAuth credentials — the app's own login gate is
     a client-side session flag; this tool sets that flag directly,
     exactly as a real login would, never touching `google_config.php`.

   Needs `playwright` + a chromium build. Not a project dependency (this
   repository has no build step by design — see README.md) and never
   will be. Exits 2 with a plain message if unavailable, so running it is
   always safe to attempt.

   Run:
     node tools/visual-verify.js --views dashboard,nav-tache,nav-inscriptions --out /tmp/shots --label before
     # ...apply a candidate change to a COPY, or pass --source to point
     # at a different tree entirely...
     node tools/visual-verify.js --views dashboard,nav-tache,nav-inscriptions --out /tmp/shots --label after
     node tools/visual-verify.js --diff /tmp/shots --a before --b after
   ===================================================================== */

var fs = require('fs');
var path = require('path');
var os = require('os');
var http = require('http');
var childProcess = require('child_process');

var REPO_ROOT = path.join(__dirname, '..');

function arg(name, def) {
  var i = process.argv.indexOf('--' + name);
  return i !== -1 ? process.argv[i + 1] : def;
}
function flag(name) {
  return process.argv.indexOf('--' + name) !== -1;
}

var chromium;
try {
  chromium = require('playwright').chromium;
} catch (e) {
  try {
    chromium = require('/opt/node22/lib/node_modules/playwright').chromium;
  } catch (e2) {
    process.stderr.write(
      'visual-verify: playwright is not installed, so browser verification cannot run here.\n' +
      'This is expected — a browser is deliberately not a dependency of this repository.\n' +
      'Install playwright + a chromium build in the environment and rerun.\n');
    process.exit(2);
  }
}

// ── Hard loopback-only guard — code, not a comment ─────────────────────
function assertLoopback(hostname) {
  if (hostname !== '127.0.0.1' && hostname !== 'localhost') {
    throw new Error(
      'visual-verify refuses to target "' + hostname + '". ' +
      'This tool only ever drives 127.0.0.1/localhost — it must never be ' +
      'pointed at production (uthinachess.tn or any other real host).');
  }
}

function findFreePort() {
  return new Promise(function (resolve, reject) {
    var srv = http.createServer();
    srv.listen(0, '127.0.0.1', function () {
      var p = srv.address().port;
      srv.close(function () { resolve(p); });
    });
    srv.on('error', reject);
  });
}

function cpDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (var entry of fs.readdirSync(src, { withFileTypes: true })) {
    var s = path.join(src, entry.name);
    var d = path.join(dst, entry.name);
    if (entry.name === 'appdata' || entry.name === 'documents' || entry.name === '.git') continue;
    if (entry.isDirectory()) cpDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function prepareIsolatedCopy(sourceRoot) {
  var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-vr-'));
  var files = ['index.html', 'manifest.json', 'api.php'];
  var dirs = ['css', 'js', 'assets'];
  for (var f of files) {
    var s = path.join(sourceRoot, f);
    if (fs.existsSync(s)) fs.copyFileSync(s, path.join(tmp, f));
  }
  for (var d of dirs) {
    var sd = path.join(sourceRoot, d);
    if (fs.existsSync(sd)) cpDir(sd, path.join(tmp, d));
  }
  return tmp;
}

function startPhpServer(root, port) {
  assertLoopback('127.0.0.1');
  var proc = childProcess.spawn('php', ['-S', '127.0.0.1:' + port, '-t', root], {
    stdio: 'ignore',
  });
  return proc;
}

function waitForServer(port, timeoutMs) {
  var deadline = Date.now() + timeoutMs;
  function attempt() {
    return new Promise(function (resolve, reject) {
      var req = http.get({ hostname: '127.0.0.1', port: port, path: '/index.html' }, function (res) {
        res.resume();
        resolve(true);
      });
      req.on('error', function () { resolve(false); });
      req.setTimeout(500, function () { req.destroy(); resolve(false); });
    });
  }
  return new Promise(function (resolve, reject) {
    (function poll() {
      attempt().then(function (ok) {
        if (ok) return resolve();
        if (Date.now() > deadline) return reject(new Error('server did not come up in time'));
        setTimeout(poll, 150);
      });
    })();
  });
}

var VIEW_NAV_IDS = {
  dashboard: null,
  'nav-tache': 'nav-tache',
  'nav-inscriptions': 'nav-inscriptions',
  'nav-appel': 'nav-appel',
  'nav-conformite': 'nav-conformite',
};

async function capture() {
  var sourceRoot = arg('source', REPO_ROOT);
  var outDir = arg('out', path.join(os.tmpdir(), 'mythos-vr-shots'));
  var label = arg('label', 'shot');
  var viewsArg = arg('views', 'dashboard');
  var keep = flag('keep');
  var views = viewsArg.split(',').map(function (v) { return v.trim(); });

  fs.mkdirSync(outDir, { recursive: true });

  var runRoot = prepareIsolatedCopy(sourceRoot);
  var port = await findFreePort();
  assertLoopback('127.0.0.1');
  var server = startPhpServer(runRoot, port);
  try {
    await waitForServer(port, 8000);

    var browser = await chromium.launch({ args: ['--no-sandbox'] });
    try {
      var page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      var url = 'http://127.0.0.1:' + port + '/index.html';
      var host = new URL(url).hostname;
      assertLoopback(host);

      await page.goto(url);
      // Mirrors js/auth.js AUTH.createSession() exactly — the same flag a
      // real login sets, written client-side, zero credentials involved.
      await page.evaluate(function () {
        localStorage.setItem('mp_auth_session', JSON.stringify({ ts: Date.now() }));
      });
      await page.reload();
      await page.waitForTimeout(1200);

      for (var v of views) {
        if (v !== 'dashboard') {
          var navId = VIEW_NAV_IDS[v] || v;
          var el = await page.$('#' + navId);
          if (el) {
            await el.click();
            await page.waitForTimeout(400);
          } else {
            process.stderr.write('visual-verify: view "' + v + '" has no #' + navId + ', skipping click\n');
          }
        }
        var shotPath = path.join(outDir, label + '-' + v + '.png');
        await page.screenshot({ path: shotPath, fullPage: true });
        process.stdout.write('wrote ' + shotPath + '\n');
      }
    } finally {
      await browser.close();
    }
  } finally {
    server.kill();
    if (!keep) fs.rmSync(runRoot, { recursive: true, force: true });
  }
}

async function diff() {
  var dir = arg('diff');
  var a = arg('a', 'before');
  var b = arg('b', 'after');
  var files = fs.readdirSync(dir).filter(function (f) { return f.indexOf(a + '-') === 0 && f.endsWith('.png'); });
  process.stdout.write('Pairs found: ' + files.length + '\n');
  process.stdout.write('This tool does not embed an image-diff library (no new dependency for a\n');
  process.stdout.write('one-off comparison) — compare "' + a + '-*.png" against "' + b + '-*.png" in ' + dir + '\n');
  process.stdout.write('with any image tool (e.g. Python Pillow: ImageChops.difference).\n');
}

if (flag('diff') || arg('diff', null)) {
  diff().catch(function (e) { process.stderr.write('FAIL: ' + e.message + '\n'); process.exit(1); });
} else {
  capture().catch(function (e) { process.stderr.write('FAIL: ' + e.message + '\n'); process.exit(1); });
}
