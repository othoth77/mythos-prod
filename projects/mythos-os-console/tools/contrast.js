'use strict';
/* =====================================================
   MYTHOS OS — contrast measurement
   projects/mythos-os-console/tools/contrast.js

   docs/MYTHOS_DESIGN_STRATEGY.md §13 records accessibility as VERIFIED
   ABSENT across the whole portfolio, and states plainly that contrast
   "was NOT measured by this audit and no claim is made about it".
   MOS-1 repeated that disclaimer. This tool ends it: it measures.

   WCAG 2.1 relative luminance and contrast ratio, computed from the
   tokens as authored. Where a colour is translucent it is composited
   over its real backdrop first — a 12%-alpha `-dim` ground is not the
   ground the text actually sits on.

   Thresholds (WCAG 2.1):
     AA  normal text  4.5   ·  AA  large text (>=18.66px bold / 24px)  3.0
     AAA normal text  7.0   ·  non-text UI component / graphical       3.0

   The tool reports. It does not change a colour: D-001 is CONFIRMED and
   is not this stage's to revise. Where a pair fails, the finding is
   recorded and the fix is a USAGE change — which token is used where —
   never a palette change.

   Run: node projects/mythos-os-console/tools/contrast.js [--json]
   ===================================================== */

var fs = require('fs');
var path = require('path');

var CSS = path.join(__dirname, '..', 'reference', 'web', 'mythos.css');

// --- colour ---------------------------------------------------------

function parse(c) {
  c = String(c).trim();
  var m = /^#([0-9a-f]{3})$/i.exec(c);
  if (m) {
    return { r: parseInt(m[1][0] + m[1][0], 16), g: parseInt(m[1][1] + m[1][1], 16), b: parseInt(m[1][2] + m[1][2], 16), a: 1 };
  }
  m = /^#([0-9a-f]{6})$/i.exec(c);
  if (m) {
    return { r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16), b: parseInt(m[1].slice(4, 6), 16), a: 1 };
  }
  m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(c);
  if (m) {
    return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
  }
  throw new Error('cannot parse colour: ' + c);
}

// Source-over compositing. A translucent fill is meaningless without the
// thing behind it, and reporting a ratio against the fill alone would
// overstate every -dim surface in the system.
function over(fg, bg) {
  var a = fg.a + bg.a * (1 - fg.a);
  return {
    r: (fg.r * fg.a + bg.r * bg.a * (1 - fg.a)) / a,
    g: (fg.g * fg.a + bg.g * bg.a * (1 - fg.a)) / a,
    b: (fg.b * fg.a + bg.b * bg.a * (1 - fg.a)) / a,
    a: a
  };
}

function channel(v) {
  var c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function luminance(c) {
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

function ratio(a, b) {
  var la = luminance(a), lb = luminance(b);
  var hi = Math.max(la, lb), lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

// --- tokens, read from the stylesheet, never retyped -----------------

function tokens() {
  var css = fs.readFileSync(CSS, 'utf8');
  var out = {};
  var re = /--(mythos-[a-z0-9-]+):\s*([^;]+);/g;
  var m;
  while ((m = re.exec(css)) !== null) {
    var v = m[2].trim();
    if (/^(#|rgba?\()/.test(v)) out[m[1]] = v;
  }
  return out;
}

var T = tokens();
function c(name) { return parse(T[name] !== undefined ? T[name] : name); }

// --- the pairs the console actually renders --------------------------
//
// Every entry is a real pairing in mythos.css or console.css, named by
// where it appears. A matrix of every token against every other token
// would be longer and less honest: it would report ratios for pairs the
// interface never puts together.

var GROUND = c('mythos-bg');

function on(bg /* array of layers, innermost last */) {
  return bg.reduce(function (acc, layer) { return over(layer, acc); }, GROUND);
}

var PAIRS = [
  // --- body and structural text ---
  { id: 'body text on page ground',            fg: c('mythos-text'),        bg: on([]),                                  size: 'normal', role: 'text' },
  { id: 'body text on sidebar',                fg: c('mythos-text'),        bg: on([c('mythos-surface')]),               size: 'normal', role: 'text' },
  { id: 'body text on card',                   fg: c('mythos-text'),        bg: on([c('mythos-card')]),                  size: 'normal', role: 'text' },
  { id: 'row title on card gradient (dark stop)', fg: c('mythos-text'),     bg: on([parse('rgba(20,20,20,0.6)')]),       size: 'normal', role: 'text' },
  { id: 'row title on card gradient (light stop)', fg: c('mythos-text'),    bg: on([parse('rgba(30,30,30,0.8)')]),       size: 'normal', role: 'text' },

  // --- secondary text: labels, metadata, nav items, timestamps ---
  { id: 'secondary text on page ground',       fg: c('mythos-text-secondary'), bg: on([]),                               size: 'normal', role: 'text' },
  { id: 'secondary text on sidebar (nav item)', fg: c('mythos-text-secondary'), bg: on([c('mythos-surface')]),           size: 'normal', role: 'text' },
  { id: 'secondary text on card',              fg: c('mythos-text-secondary'), bg: on([c('mythos-card')]),               size: 'normal', role: 'text' },
  { id: 'secondary text on card gradient (light stop)', fg: c('mythos-text-secondary'), bg: on([parse('rgba(30,30,30,0.8)')]), size: 'normal', role: 'text' },
  { id: 'KPI label on #1a1a1a',                fg: c('mythos-text-secondary'), bg: on([parse('#1a1a1a')]),               size: 'normal', role: 'text' },

  // --- gold ---
  { id: 'gold-light title accent on ground',   fg: c('mythos-gold-light'),  bg: on([]),                                  size: 'large',  role: 'text' },
  { id: 'gold-light on card',                  fg: c('mythos-gold-light'),  bg: on([c('mythos-card')]),                  size: 'normal', role: 'text' },
  { id: 'gold active nav item on gold-dim',    fg: c('mythos-gold'),        bg: on([c('mythos-surface'), c('mythos-gold-dim')]), size: 'normal', role: 'text' },
  { id: 'gold-light KPI value on #1a1a1a',     fg: c('mythos-gold-light'),  bg: on([parse('#1a1a1a')]),                  size: 'large',  role: 'text' },
  { id: 'dark text on gold gradient button',   fg: c('mythos-bg'),          bg: on([c('mythos-gold')]),                  size: 'normal', role: 'text' },
  { id: 'table header gold-light on card',     fg: c('mythos-gold-light'),  bg: on([c('mythos-card')]),                  size: 'normal', role: 'text' },

  // --- status pills: text on its own -dim ground, on both grounds a
  //     badge can land on (a row uses the card gradient, a KPI does not)
  { id: 'badge is-attention (gold-light on gold-dim)', fg: c('mythos-gold-light'),  bg: on([c('mythos-card'), c('mythos-gold-dim')]),   size: 'normal', role: 'text' },
  { id: 'badge is-running (blue on blue-dim)',         fg: c('mythos-blue'),        bg: on([c('mythos-card'), c('mythos-blue-dim')]),   size: 'normal', role: 'text' },
  { id: 'badge is-ok (#8ff0b5 on green-dim)',          fg: parse('#8ff0b5'),        bg: on([c('mythos-card'), c('mythos-green-dim')]),  size: 'normal', role: 'text' },
  { id: 'badge is-error (danger-text on danger-dim)',  fg: c('mythos-danger-text'), bg: on([c('mythos-card'), c('mythos-danger-dim')]), size: 'normal', role: 'text' },
  { id: 'badge is-waiting (today on today-dim)',       fg: c('mythos-today'),       bg: on([c('mythos-card'), c('mythos-today-dim')]),  size: 'normal', role: 'text' },
  { id: 'badge is-planned (purple-text on purple-dim)', fg: c('mythos-purple-text'), bg: on([c('mythos-card'), c('mythos-purple-dim')]), size: 'normal', role: 'text' },
  { id: 'badge is-inert (secondary on white 3.5%)',    fg: c('mythos-text-secondary'), bg: on([c('mythos-card'), parse('rgba(255,255,255,0.035)')]), size: 'normal', role: 'text' },

  // --- non-text UI: focus and state indicators (WCAG 1.4.11, 3.0) ---
  { id: 'focus ring gold on ground',           fg: c('mythos-gold'),        bg: on([]),                                  size: 'normal', role: 'ui' },
  { id: 'active nav rail gold on sidebar',     fg: c('mythos-gold'),        bg: on([c('mythos-surface')]),               size: 'normal', role: 'ui' },
  { id: 'gold section rule on ground',         fg: c('mythos-gold'),        bg: on([c('mythos-card')]),                  size: 'normal', role: 'ui' },

  // --- INFORMATIONAL ---------------------------------------------------
  // Not rendered by the console. Recorded because they are the reason the
  // readable variants above exist, and because a report that omits them
  // invites someone to reach for the raw solid later.
  { id: 'D-001 --muted as body text on card',  fg: c('mythos-muted'),       bg: on([c('mythos-card')]),                  size: 'normal', role: 'text', informational: true },
  { id: 'D-001 --muted as body text on ground', fg: c('mythos-muted'),      bg: on([]),                                  size: 'normal', role: 'text', informational: true },
  { id: 'D-001 raw --danger as text on ground', fg: c('mythos-danger'),     bg: on([]),                                  size: 'normal', role: 'text', informational: true },
  { id: 'D-001 raw --purple as text on purple-dim', fg: c('mythos-purple'), bg: on([c('mythos-card'), c('mythos-purple-dim')]), size: 'normal', role: 'text', informational: true },

  // Decorative separators. WCAG 1.4.11 applies to boundaries REQUIRED to
  // identify or operate a control. These are neither: the console has no
  // form control of any kind, and a card is identified by its content and
  // its ground, not by its hairline. Measured and reported rather than
  // waved away, and NOT counted as failures — the interactive affordances
  // that 1.4.11 does govern (focus ring, active rail) are above.
  { id: 'D-001 neutral border on card',        fg: c('mythos-border'),      bg: on([c('mythos-card')]),                  size: 'normal', role: 'ui', informational: true },
  { id: 'D-001 neutral border on ground',      fg: c('mythos-border'),      bg: on([]),                                  size: 'normal', role: 'ui', informational: true },
  { id: 'D-001 gold hairline on card',         fg: over(c('mythos-gold-line'), c('mythos-card')), bg: on([c('mythos-card')]), size: 'normal', role: 'ui', informational: true }
];

function threshold(p) {
  if (p.role === 'ui') return 3.0;
  return p.size === 'large' ? 3.0 : 4.5;
}

function measure() {
  return PAIRS.map(function (p) {
    var r = ratio(p.fg, p.bg);
    var need = threshold(p);
    return {
      id: p.id,
      ratio: Math.round(r * 100) / 100,
      required: need,
      role: p.role,
      size: p.size,
      informational: !!p.informational,
      passes: r >= need,
      aaa: p.role === 'text' && r >= (p.size === 'large' ? 4.5 : 7.0)
    };
  });
}

module.exports = { measure: measure, ratio: ratio, parse: parse, over: over, luminance: luminance, PAIRS: PAIRS, threshold: threshold };

if (require.main === module) {
  var rows = measure();
  if (process.argv.indexOf('--json') !== -1) {
    process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
  } else {
    var w = rows.reduce(function (a, r) { return Math.max(a, r.id.length); }, 0);
    rows.forEach(function (r) {
      process.stdout.write(
        (r.informational ? '  ---- ' : r.passes ? '  PASS ' : '  FAIL ') +
        r.id.padEnd(w) + '  ' +
        String(r.ratio).padStart(6) + ':1  (needs ' + r.required.toFixed(1) + ', ' +
        (r.role === 'ui' ? 'UI component' : r.size + ' text') + ')' +
        (r.aaa ? '  AAA' : '') + '\n'
      );
    });
    var rendered = rows.filter(function (r) { return !r.informational; });
    var info = rows.filter(function (r) { return r.informational; });
    var fails = rendered.filter(function (r) { return !r.passes; });
    process.stdout.write('\n' + (rendered.length - fails.length) + ' of ' + rendered.length +
      ' rendered pairs meet WCAG 2.1 AA (' + info.length + ' informational rows excluded from the count).\n');
    if (fails.length) {
      process.stdout.write('\nFAILING:\n');
      fails.forEach(function (f) { process.stdout.write('  - ' + f.id + ' — ' + f.ratio + ':1, needs ' + f.required.toFixed(1) + '\n'); });
      process.exitCode = 1;
    }
  }
}
