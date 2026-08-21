'use strict';

// tests/stc-ar-arabic-layer-test.js — STC-AR: the simple-Arabic
// explanation layer of the Status Center surface.
//
// The Arabic layer is a SECONDARY explanation rendered under the primary
// English. This suite asserts that it exists, that it covers the live
// (STC-2) monitoring states as well as the review record, that it renders
// RTL, that it never replaces the English, and that it never carries or
// translates machine values (identifiers, domains, hashes, numbers).
// Fully offline: static assertions over the deployed site sources.

var fs = require('fs');
var path = require('path');
var cp = require('child_process');

var ROOT = path.resolve(__dirname, '..');
var SITE = path.join(ROOT, 'sites', 'status.mythosprod.xyz');
var APP_JS = path.join(SITE, 'assets', 'app.js');
var APP_CSS = path.join(SITE, 'assets', 'app.css');
var INDEX = path.join(SITE, 'index.html');

var passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  PASS ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
}

var appJs = fs.readFileSync(APP_JS, 'utf8');
var appCss = fs.readFileSync(APP_CSS, 'utf8');
var index = fs.readFileSync(INDEX, 'utf8');

var ARABIC = /[؀-ۿ]/;
// Every AR.* lookup must be resolved inside the Arabic dictionary only —
// the UI has unrelated maps (pill classes) with the same state keys.
var arBlock = appJs.slice(appJs.indexOf('var AR = {'), appJs.indexOf('function arEl('));

console.log('§1 sources stay valid and self-contained');
var chk = cp.spawnSync('node', ['--check', APP_JS], { encoding: 'utf8' });
check('app.js node --check clean', chk.status === 0, chk.stderr);
check('Arabic layer adds no external dependency',
  !/<script[^>]+src="http/.test(index) && !/import\s+.*from\s+['"]http/.test(appJs));
check('Arabic never injected as markup (innerHTML-free)', !/\.innerHTML\s*=/.test(appJs));

console.log('§2 RTL rendering');
check('.simple-ar declares direction rtl', /\.simple-ar\s*\{[^}]*direction:\s*rtl/.test(appCss));
check('.simple-ar isolates bidi', /\.simple-ar\s*\{[^}]*unicode-bidi:\s*isolate/.test(appCss));
check('.simple-ar right-aligned', /\.simple-ar\s*\{[^}]*text-align:\s*right/.test(appCss));
check('.simple-ar uses the Arabic face token',
  /\.simple-ar\s*\{[^}]*var\(--mythos-font-text-arabic\)/.test(appCss));
check('Arabic web font is actually shipped',
  fs.existsSync(path.join(SITE, 'assets', 'fonts', 'ibm-plex-sans-arabic-400-arabic.woff2')));
var arNodes = appJs.match(/class: 'simple-ar', lang: 'ar', dir: 'rtl'/g) || [];
check('dynamic Arabic nodes carry lang + dir', arNodes.length >= 1);
var staticAr = index.match(/class="simple-ar[^"]*" lang="ar" dir="rtl"/g) || [];
check('static Arabic paragraphs carry lang + dir', staticAr.length >= 5,
  'found ' + staticAr.length);

console.log('§3 page-level explanation of the surface');
check('an Arabic explanation section exists', /id="about-ar"/.test(index));
var about = (index.split('id="about-ar"')[1] || '').split('</section>')[0];
check('explains what the Status Center is', /مركز حالة Mythos/.test(about));
check('explains that status comes from evidence and checks',
  /أدلة/.test(about) && /فحوصات/.test(about));
check('explains where the last-verified time is shown', /آخر تحقّق/.test(about));
check('explains that a stale snapshot is not a live verification',
  /ليست تحققاً حياً/.test(about));
['LIVE', 'DEGRADED', 'DOWN', 'NOT MONITORED'].forEach(function (st) {
  check('page explanation covers ' + st, about.indexOf(st) >= 0);
});
check('technical terms kept in English inside the Arabic text',
  /dir="ltr">LIVE</.test(about));

console.log('§4 live (STC-2) states are explained in Arabic');
check('AR.live block exists', /live:\s*\{/.test(appJs));
['LIVE', 'DEGRADED', 'DOWN', 'NOT_MONITORED'].forEach(function (st) {
  var m = new RegExp('\\n\\s*' + st + ": '([^']+)'").exec(arBlock);
  check('AR.live.' + st + ' is Arabic prose', !!m && ARABIC.test(m[1]), m && m[1]);
  check('AR.live.' + st + ' keeps the English state token',
    !!m && m[1].indexOf(st.replace('_', ' ')) >= 0);
});
check('stale snapshot warned in Arabic', /stale:\s*'[^']*ليست تحققاً حياً/.test(appJs));
check('absent monitor data explained in Arabic (not painted green)',
  /absent:\s*'[^']*لا توجد بيانات مراقبة حية/.test(appJs));
check('renderLive attaches the Arabic intro', /arPut\(body, arEl\(AR\.live\.intro\)\)/.test(appJs));
check('renderLive attaches the stale Arabic warning',
  /if \(stale\) arPut\(body, arEl\(AR\.live\.stale\)\)/.test(appJs));
check('renderLive attaches the absent-data Arabic note',
  /arPut\(body, arEl\(AR\.live\.absent\)\)/.test(appJs));
check('renderLive attaches the Arabic state legend',
  /AR\.live\[st\]/.test(appJs) && /live-legend/.test(appCss));

console.log('§5 review-record states remain covered');
['DONE', 'READY', 'BLOCKED', 'OWNER_ACTION', 'NOT_VERIFIED', 'VERIFIED'].forEach(function (st) {
  var m = new RegExp('\\n\\s*' + st + ": '([^']+)'").exec(arBlock);
  check('AR.states.' + st + ' present and Arabic', !!m && ARABIC.test(m[1]));
});
check('unknown keys render no Arabic instead of crashing',
  /function arPut\(parent, node\) \{ if \(node\) parent\.appendChild\(node\); \}/.test(appJs));
check('arEl returns null for a missing translation',
  /function arEl\(text\) \{\s*\n\s*if \(!text\) return null;/.test(appJs));

console.log('§6 English is preserved, machine values are not translated');
check('English live section note intact',
  /Real probe results written by the STC-2 monitor/.test(index));
check('English state legend still rendered from the data model',
  /Source hierarchy — when sources disagree/.test(index) ||
  /Source hierarchy/.test(appJs));
check('English navigation preserved',
  /href="#overview">Overview</.test(index) && /href="#blockers">Blockers</.test(index));
check('AR keys are English identifiers (lookup keys, not translations)',
  /'PROJECT-STATUS-CENTER':/.test(arBlock) && /'BLOCKER-VPS-EXECUTION':/.test(arBlock));
check('no commit hash is translated into Arabic', !/[0-9a-f]{7,40}['"]\s*:/.test(arBlock));
check('Arabic layer carries no URL of its own',
  !/https?:\/\//.test(arBlock.replace(/mythosprod\.xyz|ssangyong\.autos/g, '')));
check('numbers in track explanations are reused, never recomputed',
  /var m = \/\^\(\\d\+\) of \(\\d\+\) recorded stages DONE\//.test(appJs) &&
  /'اكتملت ' \+ m\[1\] \+ ' من أصل ' \+ m\[2\]/.test(appJs));

console.log('\nstc-ar: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
