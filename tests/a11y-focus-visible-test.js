'use strict';
// =====================================================
// A11Y-FOCUS-VISIBLE — keyboard focus indicator for the live application
// tests/a11y-focus-visible-test.js
//
// Applies the owner-approved System Design (A-016 "focus is never removed",
// docs/design/RESPONSIVE_ACCESSIBILITY_MOTION.md) to css/main.css: every
// interactive control gets a visible, brand-gold keyboard focus ring via
// :focus-visible, closing a WCAG 2.4.7 (Focus Visible, Level AA) gap the
// live app had for buttons, nav items, links and cards (only inputs had
// any focus treatment, and many controls set `outline: none`).
//
// css/main.css's :root D-001 token block is a cross-product brand contract
// (mirrored and drift-tested by tests/mos-1-console-test.js). This test pins
// each token's CURRENT value as a drift guard: the brand values (gold, inks,
// text, danger) are unchanged; the four status hues (green/blue/today/purple)
// were intentionally adopted from the owner-approved COLOR_SYSTEM.md values
// (WCAG-verified), in lockstep with the console mirror.
//
// Run with: node tests/a11y-focus-visible-test.js
// =====================================================

var fs = require('fs');
var path = require('path');
var BASE = path.join(__dirname, '..');
var pass = 0, fail = 0;

function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }

var css = fs.readFileSync(path.join(BASE, 'css', 'main.css'), 'utf8');

console.log('\n1. A keyboard focus ring exists (WCAG 2.4.7 / A-016)');
ok(/:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--gold\)/.test(css),
   'a bare :focus-visible rule draws a 2px gold outline');
ok(/button:focus-visible/.test(css), 'buttons get a :focus-visible ring');
ok(/a:focus-visible/.test(css), 'links get a :focus-visible ring');
ok(/\.btn:focus-visible/.test(css) && /\.btn-gold:focus-visible/.test(css),
   'the recovered .btn family gets a :focus-visible ring');
ok(/input:focus-visible/.test(css) && /select:focus-visible/.test(css) && /textarea:focus-visible/.test(css),
   'form controls get a keyboard :focus-visible ring in addition to their existing :focus styling');
ok(/\[onclick\]:focus-visible/.test(css) && /\[role="button"\]:focus-visible/.test(css) && /\[tabindex\]:focus-visible/.test(css),
   'onclick / role=button / tabindex interactive elements get a ring');
ok(/\.entity-card:focus-visible/.test(css) && /\.invoice-card:focus-visible/.test(css),
   'clickable entity/invoice cards get a ring');

console.log('\n2. The focus ring is token-based (no off-brand colour introduced)');
// Every :focus-visible outline must use the --gold token, never a raw hex.
var fvBlock = (css.match(/:focus-visible\s*\{[^}]*\}/g) || []).join('\n') +
              (css.match(/[^\n]*:focus-visible[\s\S]*?\}/g) || []).join('\n');
ok(/var\(--gold\)/.test(fvBlock), 'focus rings compose from the --gold design token');
ok(!/#[0-9a-fA-F]{3,8}\b/.test(fvBlock), 'no raw hex colour is introduced by the focus layer');

console.log('\n3. Overflow-hidden sidebar handled (nav ring not clipped)');
ok(/\.nav-btn:focus-visible\s*\{[^}]*outline-offset:\s*-3px/.test(css),
   'the nav ring is drawn inside the control so the overflow:hidden sidebar cannot clip it');

console.log('\n4. Keyboard-only: pointer users keep the quiet surfaces');
ok(css.indexOf(':focus-visible') >= 0 && css.indexOf(':focus-visible {') >= 0,
   'the layer keys off :focus-visible (pointer focus stays unchanged), not :focus');

console.log('\n5. Reduced-motion preference still honoured (A-018, unchanged)');
ok(/@media \(prefers-reduced-motion: reduce\)/.test(css), 'prefers-reduced-motion block is preserved');

console.log('\n6. Drift guard: :root D-001 tokens hold their current values');
var rootBlock = (css.match(/:root\s*\{[\s\S]*?\}/) || [''])[0];
function tok(name) {
  var m = new RegExp('--' + name + ':\\s*([^;]+);').exec(rootBlock);
  return m ? m[1].trim() : null;
}
var EXPECTED = {
  'bg': '#0e0e0e', 'surface': '#161616', 'card': '#1d1d1d', 'border': '#2a2a2a',
  'gold': '#D9A441', 'gold-light': '#EBCE99', 'gold-dim': 'rgba(217,164,65,0.12)',
  'text': '#e8e4dc', 'muted': '#A8A498', 'danger': '#F1706A',
  'green': '#4ADE80', 'green-dim': 'rgba(74,222,128,0.12)',
  'blue': '#7DC4EA', 'blue-dim': 'rgba(125,196,234,0.12)',
  'today': '#F0A342', 'today-dim': 'rgba(240,163,66,0.12)',
  'past': '#7A776C', 'past-dim': 'rgba(122,119,108,0.12)',
  'purple': '#B98BD0', 'purple-dim': 'rgba(185,139,208,0.12)'
};
Object.keys(EXPECTED).forEach(function (name) {
  ok(tok(name) === EXPECTED[name],
     'D-001 --' + name + ' still ' + EXPECTED[name] + ' (got: ' + tok(name) + ')');
});

console.log('\n7. Bypass Blocks — skip-to-content link (WCAG 2.4.1)');
var html = fs.readFileSync(path.join(BASE, 'index.html'), 'utf8');
ok(/<a class="skip-link" href="#main-content">/.test(html), 'a skip-to-content link exists in the app shell');
ok(/id="main-content"/.test(html) && /<main[^>]*id="main-content"[^>]*tabindex="-1"/.test(html),
   'the <main> landmark carries id="main-content" and is focusable as the skip target');
ok(/\.skip-link\s*\{[\s\S]*?position:\s*absolute/.test(css) && /\.skip-link:focus\s*\{[\s\S]*?top:\s*8px/.test(css),
   'the skip link is visually hidden until it receives keyboard focus');
ok(/id="sidebar-nav"[^>]*aria-label=/.test(html), 'the sidebar nav landmark has an accessible name');

console.log('\n8. Design-token completeness — --danger-dim (D-001 pairing)');
ok(/--danger-dim:\s*rgba\(241,112,106,0\.12\)/.test(rootBlock),
   '--danger-dim completes the universal solid+12% pairing (matches the console mirror)');

console.log('\n8b. Active navigation exposes aria-current (SR "you are here")');
var routerSrc = fs.readFileSync(path.join(BASE, 'js', 'core', 'router.js'), 'utf8');
var appSrc = fs.readFileSync(path.join(BASE, 'js', 'app.js'), 'utf8');
ok(/setAttribute\('aria-current', 'page'\)/.test(routerSrc) && /removeAttribute\('aria-current'\)/.test(routerSrc),
   'core router.js sets aria-current="page" on the active nav and clears it from the rest');
ok(/setAttribute\('aria-current', 'page'\)/.test(appSrc) && /removeAttribute\('aria-current'\)/.test(appSrc),
   'the app.js logs nav path keeps aria-current consistent');

console.log('\n8c. Non-text content — every <img> has an alt attribute (WCAG 1.1.1)');
var imgFiles = ['index.html', 'js/rappels.js', 'js/redaction.js', 'js/shared/camera.js',
  'js/shared/documentation.js', 'js/shared/devis.js', 'js/shared/invoices.js',
  'js/shared/mission-orders.js'];
var imgOffenders = [];
imgFiles.forEach(function (rel) {
  var src = fs.readFileSync(path.join(BASE, rel), 'utf8');
  (src.match(/<img\b[^>]*>/g) || []).forEach(function (tag) {
    if (!/\balt\s*=/.test(tag)) imgOffenders.push(rel + ': ' + tag.slice(0, 50));
  });
});
ok(imgOffenders.length === 0, 'no <img> without alt across the shell and generators (' +
   (imgOffenders.length ? imgOffenders.join(' | ') : 'all covered') + ')');

console.log('\n8d. Keyboard: Escape closes the top modal (WCAG 2.1.1)');
ok(/function closeTopModalOnEscape/.test(appSrc) && /addEventListener\('keydown', closeTopModalOnEscape\)/.test(appSrc),
   'an Escape-key handler closes the top-most open modal, registered globally');

console.log('\n9. Stylesheet integrity');
ok(css.split('{').length === css.split('}').length, 'main.css braces are balanced');

console.log('\nA11Y-FOCUS-VISIBLE: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
