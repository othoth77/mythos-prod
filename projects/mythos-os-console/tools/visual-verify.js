'use strict';
/* =====================================================
   MYTHOS OS — browser verification
   projects/mythos-os-console/tools/visual-verify.js

   D-010 (docs/MYTHOS_DESIGN_DECISIONS.md): layout is verified by driving
   a headless browser against the rendered page, not by inspecting
   source. Proven on SsangYong, applied again by MOS-1, and committed
   here so the next session can rerun it instead of rebuilding it.

   NOT part of `node tests/mos-1-console-test.js`. It needs a browser,
   which is not a project dependency and never will be — this repository
   has no build step and no browser-test runner. It exits 2 with a plain
   message when playwright is unavailable, so running it is always safe.

   It drives a STUB control plane. No executor, no database, no AI quota,
   no network. Nothing it does can reach production.

   Run:
     node projects/mythos-os-console/tools/visual-verify.js [--shots DIR]
   ===================================================== */

var http = require('http');
var path = require('path');

var REF = path.join(__dirname, '..', 'reference');
var SHOTS = (function () {
  var i = process.argv.indexOf('--shots');
  return i !== -1 ? process.argv[i + 1] : null;
}());

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
      'Install playwright + chromium in the environment and rerun.\n');
    process.exit(2);
  }
}

// --- the stub control plane -----------------------------------------
// Every value below is obviously synthetic and lives only in this file.
// It never reaches the repository, a database, or a running console.

var TOKEN = 'visual-verify-stub-token';
var registry = require(path.join(REF, 'web', 'modules.js'));

var STUB_TASKS = { tasks: [
  { task_id: 'm-abc12345', project: 'mythos-prod', stage: 'MOS-1 console shell', status: 'RUNNING', effective: 'RUNNING', provider: 'claude-code', next_action: 'rendering the command center', updated_at: '2026-08-18T08:40:00Z' },
  { task_id: 'm-def67890', project: 'mythos-prod', stage: 'MOS-2 memory read API', status: 'BLOCKED', effective: 'BLOCKED', provider: 'claude-code', next_action: 'owner decision required', updated_at: '2026-08-18T06:00:00Z' },
  { task_id: 'm-ghi11121', project: 'mythos-prod', stage: 'IDA-3F off-host backup', status: 'WAITING_FOR_QUOTA', effective: 'WAITING_FOR_QUOTA', provider: 'claude-code', next_action: 'resume after quota window', updated_at: '2026-08-18T07:30:00Z' },
  { task_id: 'm-jkl31415', project: 'mythos-prod', stage: 'SYA-SHOP-1 storefront', status: 'COMPLETED', effective: 'COMPLETED', provider: 'gemini-advisor', next_action: '', updated_at: '2026-08-17T09:00:00Z' },
  { task_id: 'm-mno92653', project: 'executor-selftest', stage: 'selftest', status: 'FAILED', effective: 'FAILED', provider: 'mock', next_action: 'baseline mismatch', updated_at: '2026-08-16T09:00:00Z' },
  { task_id: 'm-pqr58979', project: 'mythos-prod', stage: 'queued work', status: 'QUEUED', effective: 'QUEUED', provider: 'claude-code', next_action: 'awaiting dispatch', updated_at: '2026-08-16T08:00:00Z' },
  { task_id: 'm-stu32384', project: 'mythos-prod', stage: 'abandoned', status: 'CANCELLED', effective: 'CANCELLED', provider: 'mock', next_action: '', updated_at: '2026-08-15T08:00:00Z' }
]};

var STUB_EVENTS = { events: [] };
for (var i = 0; i < 24; i++) {
  STUB_EVENTS.events.push({
    type: ['mission_started', 'mission_completed', 'campaign_advanced', 'quota_parked', 'policy_denied'][i % 5],
    at: new Date(Date.parse('2026-08-18T08:00:00Z') - i * 600000).toISOString(),
    task_id: 'm-evt' + String(i).padStart(5, '0'),
    project: 'mythos-prod'
  });
}

function startStub() {
  return new Promise(function (resolve) {
    var s = http.createServer(function (req, res) {
      var u = req.url.split('?')[0];
      if (u === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: true })); }
      if ((req.headers.authorization || '') !== 'Bearer ' + TOKEN) { res.writeHead(401); return res.end('{}'); }
      var body =
        u === '/tasks' ? STUB_TASKS :
        u === '/campaigns' ? { campaigns: [
          { campaign_id: 'c-aaa11111', title: 'Phase 1 autonomous roadmap', state: 'RUNNING', missions_total: 12, missions_completed: 9, needs_human: false },
          { campaign_id: 'c-bbb22222', title: 'Design system extension', state: 'WAITING_FOR_APPROVAL', missions_total: 4, missions_completed: 4, needs_human: true }] } :
        u === '/events' ? STUB_EVENTS :
        /^\/budget\//.test(u) ? { project: u.split('/')[2], currency: 'USD', limit: 25, reserved: 2.5, spent: 11.4, remaining: 11.1, stale_reservations: 0 } :
        null;
      if (!body) { res.writeHead(404); return res.end('{}'); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    });
    s.listen(0, '127.0.0.1', function () { resolve(s); });
  });
}

// Desktop / tablet / mobile, plus the two widths the ladder in
// mythos.css actually breaks at, so a breakpoint cannot be verified only
// from one side of itself.
var VIEWPORTS = [
  { n: 'desktop-1440', w: 1440, h: 1000 },
  { n: 'laptop-1100',  w: 1100, h: 900 },
  { n: 'tablet-1024',  w: 1024, h: 1366 },
  { n: 'tablet-768',   w: 768,  h: 1024 },
  { n: 'mobile-390',   w: 390,  h: 844 },
  { n: 'mobile-320',   w: 320,  h: 700 }
];

var ROUTES = registry.modules.map(function (m) { return m.id; });

// D-001, read from the product stylesheet at run time rather than
// retyped, so brand drift is measured against the source of truth.
var fs = require('fs');
var mainCss = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'css', 'main.css'), 'utf8');
function d001(name) {
  var m = new RegExp('--' + name + ':\\s*([^;]+);').exec(mainCss);
  return m ? m[1].trim() : null;
}
function hexToRgb(h) {
  var m = /^#([0-9a-f]{6})$/i.exec(h.trim());
  if (!m) return null;
  return 'rgb(' + parseInt(m[1].slice(0, 2), 16) + ', ' + parseInt(m[1].slice(2, 4), 16) + ', ' + parseInt(m[1].slice(4, 6), 16) + ')';
}

(function main() {
  var problems = [];
  var checks = 0;
  function check(cond, label) { checks++; if (!cond) problems.push(label); }

  var stub, server, browser;

  startStub().then(function (s) {
    stub = s;
    process.env.MOS_EXECUTOR_URL = 'http://127.0.0.1:' + s.address().port;
    process.env.MOS_EXECUTOR_TOKEN = TOKEN;
    delete require.cache[require.resolve(path.join(REF, 'upstream.js'))];
    delete require.cache[require.resolve(path.join(REF, 'server.js'))];
    return require(path.join(REF, 'server.js')).start({ port: 0, bind: '127.0.0.1' });
  }).then(function (s) {
    server = s;
    var base = 'http://127.0.0.1:' + s.address().port;
    return chromium.launch().then(function (b) {
      browser = b;
      return VIEWPORTS.reduce(function (chain, vp) {
        return chain.then(function () { return runViewport(b, base, vp, check); });
      }, Promise.resolve()).then(function () { return runDeepChecks(b, base, check); });
    });
  }).then(function () {
    browser.close(); server.close(); stub.close();
    process.stdout.write('\n' + checks + ' checks across ' + VIEWPORTS.length + ' viewports x ' + ROUTES.length + ' routes\n');
    if (problems.length) {
      process.stdout.write('\nDEFECTS (' + problems.length + '):\n');
      problems.forEach(function (p) { process.stdout.write('  - ' + p + '\n'); });
      process.exit(1);
    }
    process.stdout.write('VISUAL VERIFICATION CLEAN — no defects\n');
    process.exit(0);
  }).catch(function (err) {
    process.stderr.write('visual-verify failed: ' + err.stack + '\n');
    try { browser && browser.close(); server && server.close(); stub && stub.close(); } catch (e) { /* shutting down */ }
    process.exit(1);
  });

  function runViewport(browser, base, vp, check) {
    return browser.newContext({ viewport: { width: vp.w, height: vp.h } }).then(function (ctx) {
      return ctx.newPage().then(function (page) {
        var cspViolations = [];
        // The sandbox may have no outbound network, so the Google Fonts
        // request can fail by design. That exercises the fallback stack
        // and is not a defect. Everything else is.
        var EXPECTED = /fonts\.(googleapis|gstatic)\.com|Failed to load resource/;
        page.on('console', function (m) {
          if (m.type() !== 'error') return;
          var t = m.text();
          if (/Content Security Policy/i.test(t)) cspViolations.push(t);
          else if (!EXPECTED.test(t)) check(false, vp.n + ' console error: ' + t);
        });
        page.on('pageerror', function (e) { check(false, vp.n + ' page error: ' + e.message); });
        page.on('requestfailed', function (r) {
          if (!/fonts\.(googleapis|gstatic)/.test(r.url())) check(false, vp.n + ' request failed: ' + r.url());
        });

        return ROUTES.reduce(function (chain, route) {
          return chain.then(function () {
            return page.goto(base + '/#/' + route, { waitUntil: 'networkidle' })
              .then(function () { return page.waitForTimeout(300); })
              .then(function () {
                return page.evaluate(function () {
                  var v = document.getElementById('view');
                  return {
                    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
                    text: v.innerText.trim().length,
                    inlineStyles: document.querySelectorAll('[style]').length,
                    title: document.title,
                    activeNav: document.querySelectorAll('.mythos-nav-btn.active').length,
                    badges: document.querySelectorAll('.mythos-badge').length
                  };
                });
              })
              .then(function (r) {
                // The defect class D-010 caught on SsangYong.
                check(r.overflow <= 1, vp.n + '/' + route + ': horizontal overflow ' + r.overflow + 'px');
                // A route that renders almost nothing is a broken route.
                check(r.text >= 60, vp.n + '/' + route + ': view rendered ' + r.text + ' chars');
                // REGRESSION GUARD (defect 2 of MOS-1): a style attribute
                // anywhere trips the console's own style-src CSP.
                check(r.inlineStyles === 0, vp.n + '/' + route + ': ' + r.inlineStyles + ' inline style attribute(s) — violates own CSP');
                check(/^MYTHOS OS — /.test(r.title), vp.n + '/' + route + ': document title is "' + r.title + '"');
                check(r.activeNav === 1, vp.n + '/' + route + ': ' + r.activeNav + ' active nav items (expected exactly 1)');
                if (SHOTS && vp.n === 'desktop-1440') {
                  return page.screenshot({ path: path.join(SHOTS, vp.n + '-' + route + '.png'), fullPage: true });
                }
              });
          });
        }, Promise.resolve())
        .then(function () {
          check(cspViolations.length === 0, vp.n + ': ' + cspViolations.length + ' CSP violation(s): ' + cspViolations.slice(0, 1).join(''));
        })
        // REGRESSION GUARD (defect 1 of MOS-1): below 900px the sidebar
        // must be off-canvas AND the toggle must actually open it.
        .then(function () {
          return page.goto(base + '/#/command-center', { waitUntil: 'networkidle' }).then(function () {
            return page.evaluate(function () {
              var sb = document.getElementById('sidebar');
              var tg = document.getElementById('nav-toggle');
              return {
                left: sb.getBoundingClientRect().left,
                toggleVisible: getComputedStyle(tg).display !== 'none',
                expanded: tg.getAttribute('aria-expanded')
              };
            });
          }).then(function (before) {
            var isNarrow = vp.w <= 900;
            check(before.toggleVisible === isNarrow,
              vp.n + ': nav toggle ' + (before.toggleVisible ? 'visible' : 'hidden') + ' (expected ' + (isNarrow ? 'visible' : 'hidden') + ')');
            if (!isNarrow) {
              check(before.left >= 0, vp.n + ': sidebar should be docked above 900px');
              return;
            }
            check(before.left < 0, vp.n + ': sidebar should be off-canvas below 900px');
            check(before.expanded === 'false', vp.n + ': toggle should start aria-expanded=false');
            return page.click('#nav-toggle').then(function () { return page.waitForTimeout(400); })
              .then(function () {
                return page.evaluate(function () {
                  var sb = document.getElementById('sidebar');
                  return {
                    left: sb.getBoundingClientRect().left,
                    expanded: document.getElementById('nav-toggle').getAttribute('aria-expanded'),
                    scrim: getComputedStyle(document.getElementById('scrim')).display
                  };
                });
              })
              .then(function (after) {
                check(after.left >= 0, vp.n + ': nav toggle did not open the drawer');
                check(after.expanded === 'true', vp.n + ': aria-expanded not updated on open');
                check(after.scrim !== 'none', vp.n + ': scrim not shown with the drawer open');
                if (SHOTS) return page.screenshot({ path: path.join(SHOTS, vp.n + '-drawer.png') });
              })
              .then(function () {
                return page.keyboard.press('Escape').then(function () { return page.waitForTimeout(350); })
                  .then(function () {
                    return page.evaluate(function () { return document.getElementById('sidebar').getBoundingClientRect().left; });
                  })
                  .then(function (left) { check(left < 0, vp.n + ': Escape did not close the drawer'); });
              });
          });
        })
        .then(function () { return ctx.close(); });
      });
    });
  }

  // Checks that need only one viewport, done once at desktop width.
  function runDeepChecks(browser, base, check) {
    return browser.newContext({ viewport: { width: 1440, height: 1000 } }).then(function (ctx) {
      return ctx.newPage().then(function (page) {
        return page.goto(base + '/#/command-center', { waitUntil: 'networkidle' })
          .then(function () { return page.waitForTimeout(400); })
          // --- BRAND FIDELITY: computed values vs css/main.css ---
          .then(function () {
            return page.evaluate(function () {
              var cs = getComputedStyle(document.body);
              var titleSpan = document.querySelector('.mythos-page-title span');
              var active = document.querySelector('.mythos-nav-btn.active');
              return {
                bg: cs.backgroundColor,
                color: cs.color,
                bodyFont: cs.fontFamily,
                titleColor: titleSpan && getComputedStyle(titleSpan).color,
                titleFont: titleSpan && getComputedStyle(titleSpan.parentElement).fontFamily,
                activeColor: active && getComputedStyle(active).color,
                sidebarBg: getComputedStyle(document.getElementById('sidebar')).backgroundColor,
                sidebarW: getComputedStyle(document.getElementById('sidebar')).width
              };
            });
          })
          .then(function (p) {
            check(p.bg === hexToRgb(d001('bg')), 'brand drift: body background ' + p.bg + ' != D-001 --bg ' + d001('bg'));
            check(p.color === hexToRgb(d001('text')), 'brand drift: body text ' + p.color + ' != D-001 --text ' + d001('text'));
            check(p.titleColor === hexToRgb(d001('gold-light')), 'brand drift: title accent ' + p.titleColor + ' != D-001 --gold-light');
            check(p.activeColor === hexToRgb(d001('gold')), 'brand drift: active nav ' + p.activeColor + ' != D-001 --gold');
            check(p.sidebarBg === hexToRgb(d001('surface')), 'brand drift: sidebar ' + p.sidebarBg + ' != D-001 --surface');
            check(p.sidebarW === '310px', 'brand drift: sidebar width ' + p.sidebarW + ' != 310px');
            check(/Playfair Display/.test(p.titleFont || ''), 'brand drift: page title is not Playfair Display');
            check(/Inter/.test(p.bodyFont || ''), 'brand drift: body is not Inter');
          })
          // --- REGRESSION GUARD (defect 3 of MOS-1): the connection
          //     strip timestamp reads `at` from the response ENVELOPE,
          //     not from `data`. A wrong field renders an em dash.
          .then(function () {
            return page.evaluate(function () {
              var strip = document.getElementById('link-state');
              return { text: strip.innerText.trim(), badges: strip.querySelectorAll('.mythos-badge').length };
            });
          })
          .then(function (s) {
            check(/read \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}Z/.test(s.text),
              'connection strip timestamp not rendered from the envelope: "' + s.text + '"');
            check(!/read —/.test(s.text), 'connection strip timestamp rendered as an em dash (wrong envelope field)');
            check(s.badges === 1, 'connection strip should carry exactly one state badge');
          })
          // --- event feed timestamps ---
          .then(function () {
            return page.evaluate(function () {
              var ats = Array.prototype.slice.call(document.querySelectorAll('.console-event .at')).map(function (e) { return e.textContent.trim(); });
              return { count: ats.length, bad: ats.filter(function (t) { return !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}Z$/.test(t); }) };
            });
          })
          .then(function (e) {
            check(e.count > 0, 'event feed rendered no events');
            check(e.bad.length === 0, 'event feed has ' + e.bad.length + ' malformed timestamps: ' + e.bad.slice(0, 2).join(', '));
          })
          // --- NO SECRET IN THE DELIVERED PAGE ---
          .then(function () {
            return page.evaluate(function () { return document.documentElement.outerHTML; });
          })
          .then(function (html) {
            check(html.indexOf(TOKEN) === -1, 'the control-plane token appears in the rendered DOM');
            check(!/Bearer\s+\S/.test(html), 'a bearer credential appears in the rendered DOM');
            check(!/MOS_EXECUTOR_TOKEN|MYTHOS_EXECUTOR_TOKEN/.test(html), 'a credential variable name appears in the rendered DOM');
          })
          // --- LIVE CONTRAST SAMPLE: the computed colours actually
          //     painted, not just the authored tokens.
          .then(function () {
            return page.evaluate(function () {
              // Computed backgrounds are frequently translucent — the
              // active nav item sits on rgba(201,168,76,0.12). Reading
              // that as opaque gold reports 1:1 against gold text, which
              // is a measurement bug, not a defect. Every translucent
              // layer is therefore composited down to the first opaque
              // ancestor before the ratio is taken.
              function parse(c) {
                var m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(c || '');
                if (!m) return null;
                return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
              }
              function over(fg, bg) {
                var a = fg.a + bg.a * (1 - fg.a);
                return {
                  r: (fg.r * fg.a + bg.r * bg.a * (1 - fg.a)) / a,
                  g: (fg.g * fg.a + bg.g * bg.a * (1 - fg.a)) / a,
                  b: (fg.b * fg.a + bg.b * bg.a * (1 - fg.a)) / a,
                  a: a
                };
              }
              function lum(c) {
                var ch = [c.r, c.g, c.b].map(function (v) {
                  var x = v / 255;
                  return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
                });
                return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
              }
              // Collect every translucent layer from the element upward,
              // then paint them back down onto the first opaque one.
              function effectiveBackground(el) {
                var layers = [];
                var n = el;
                while (n && n !== document.documentElement) {
                  var c = parse(getComputedStyle(n).backgroundColor);
                  if (c && c.a > 0) {
                    if (c.a >= 1) { layers.push(c); break; }
                    layers.push(c);
                  }
                  n = n.parentElement;
                }
                var base = parse(getComputedStyle(document.body).backgroundColor) || { r: 0, g: 0, b: 0, a: 1 };
                if (!layers.length || layers[layers.length - 1].a < 1) layers.push(base);
                // innermost is layers[0]; composite from the back forward
                var acc = layers[layers.length - 1];
                for (var i = layers.length - 2; i >= 0; i--) acc = over(layers[i], acc);
                return acc;
              }
              var out = [];
              ['.mythos-row-sub', '.mythos-kpi-label', '.mythos-nav-btn.active', '.mythos-nav-btn:not(.active)',
               '.mythos-label', '.console-event .at', '.mythos-badge', '.mythos-page-title span'].forEach(function (sel) {
                var el = document.querySelector(sel);
                if (!el) return;
                var fgc = parse(getComputedStyle(el).color);
                if (!fgc) return;
                var bgc = effectiveBackground(el);
                var fg = lum(fgc.a >= 1 ? fgc : over(fgc, bgc));
                var bg = lum(bgc);
                var hi = Math.max(fg, bg), lo = Math.min(fg, bg);
                out.push({ sel: sel, ratio: Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100 });
              });
              return out;
            });
          })
          .then(function (samples) {
            check(samples.length >= 7, 'live contrast sampled only ' + samples.length + ' elements');
            samples.forEach(function (s) {
              check(s.ratio >= 4.5, 'live contrast below AA: ' + s.sel + ' at ' + s.ratio + ':1');
            });
            process.stdout.write('live contrast (computed in-browser): ' +
              samples.map(function (s) { return s.sel + ' ' + s.ratio + ':1'; }).join(' · ') + '\n');
          })
          // --- PLANNED MODULES MUST NOT SHOW DATA ---
          .then(function () {
            var planned = registry.modules.filter(function (m) { return m.state === 'planned'; });
            return planned.reduce(function (chain, m) {
              return chain.then(function () {
                return page.goto(base + '/#/' + m.id, { waitUntil: 'networkidle' })
                  .then(function () { return page.waitForTimeout(200); })
                  .then(function () {
                    return page.evaluate(function () {
                      var v = document.getElementById('view');
                      return {
                        text: v.innerText,
                        notBuilt: /Not built/i.test(v.innerText),
                        badges: v.querySelectorAll('.mythos-badge').length,
                        kpis: v.querySelectorAll('.mythos-kpi').length,
                        rows: v.querySelectorAll('.mythos-row').length
                      };
                    });
                  })
                  .then(function (r) {
                    check(r.notBuilt, m.id + ': planned module does not say it is not built');
                    check(r.badges === 0 && r.kpis === 0 && r.rows === 0,
                      m.id + ': planned module renders data surfaces (' + r.badges + ' badges, ' + r.kpis + ' KPIs, ' + r.rows + ' rows)');
                    check(r.text.indexOf(m.source.slice(0, 24)) !== -1, m.id + ': planned module does not name its data source');
                  });
              });
            }, Promise.resolve());
          })
          // --- UNREACHABLE PLANE MUST NOT LOOK EMPTY ---
          .then(function () {
            return page.route('**/api/missions', function (r) {
              r.fulfill({ status: 503, contentType: 'application/json',
                body: JSON.stringify({ ok: false, error: 'upstream_unreachable', detail: 'Control plane is not answering.' }) });
            }).then(function () {
              return page.goto(base + '/#/missions', { waitUntil: 'networkidle' });
            }).then(function () { return page.waitForTimeout(300); })
              .then(function () { return page.evaluate(function () { return document.getElementById('view').innerText; }); })
              .then(function (text) {
                check(/unreachable/i.test(text), 'an unreachable plane does not say so');
                check(/state is unknown/i.test(text), 'an unreachable plane does not distinguish itself from an empty result');
                check(!/No missions/i.test(text), 'an unreachable plane renders as "No missions" — the exact confusion the rule forbids');
              });
          })
          .then(function () { return ctx.close(); });
      });
    });
  }
}());
