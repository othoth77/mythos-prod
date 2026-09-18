// ══════════════════════════════════════════════════════════════════════
// Mythos ERP — frontend↔backend end-to-end test (§19/§20)
// projects/erp-backend/tests/e2e/run-e2e.js
//
// Drives the REAL frontend client (js/core/secure-client.js) against the REAL
// backend (projects/erp-backend) in a headless browser, same-origin via the
// test dev-router. Runs the full authenticated scenario: login → read →
// create → update → upload → RBAC UX → logout → post-logout rejection →
// viewer denied → editor allowed → reload persistence.
//
// Requires Playwright + a chromium. Resolve order:
//   PLAYWRIGHT_PATH env → require('playwright'). Base URL from BASE env.
// The wrapper (run-e2e.sh) boots the backend and sets these.
// ══════════════════════════════════════════════════════════════════════

'use strict';
const BASE = process.env.BASE || 'http://127.0.0.1:8792';
const EXE = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
let chromium;
try { chromium = require(process.env.PLAYWRIGHT_PATH || 'playwright').chromium; }
catch (e) { console.error('SKIP: playwright not available (' + e.message + ')'); process.exit(3); }

let pass = 0, fail = 0;
function ok(cond, label) { if (cond) { pass++; console.log('  PASS ' + label); } else { fail++; console.log('  FAIL ' + label); } }

(async () => {
  const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const page = await b.newPage();
  const consoleErrors = [];
  const ignore = t => /favicon\.ico|Failed to load resource/.test(t);
  page.on('console', m => { if (m.type() === 'error' && !ignore(m.text())) consoleErrors.push(m.text().slice(0, 200)); });
  page.on('pageerror', e => { if (!ignore(e.message)) consoleErrors.push('PAGEERROR ' + e.message.slice(0, 200)); });

  await page.goto(BASE + '/harness.html', { waitUntil: 'domcontentloaded' });
  ok(await page.evaluate(() => typeof window.MythosSecure === 'object'), 'secure client loaded in browser');

  // Helper to run a MythosSecure call in-page, returning {ok, val|status|error}.
  const call = (fn) => page.evaluate(async (src) => {
    try { const val = await (new Function('MS', 'return (' + src + ')(MS)'))(window.MythosSecure); return { ok: true, val }; }
    catch (e) { return { ok: false, status: e.status || null, error: String(e.message || e) }; }
  }, fn.toString());

  console.log('\nSCENARIO');
  // 2. login admin
  let r = await call(MS => MS.login('admin', 'adminPass123!'));
  ok(r.ok && r.val && r.val.roles.includes('admin'), '2. admin login → admin role');

  // 4-5. read empty collection
  r = await call(MS => MS.getCollection('mp_invoices'));
  ok(r.ok && r.val.version === 0, '5. read mp_invoices → version 0 (empty)');

  // 6. create
  r = await call(MS => MS.putCollection('mp_invoices', [{ id: 'inv_1', ht: 100, ttc: 111 }]));
  ok(r.ok && r.val.version === 1, '6. write → version 1');
  r = await call(MS => MS.getCollection('mp_invoices'));
  ok(r.ok && r.val.data.length === 1 && r.val.data[0].ttc === 111, '   read back persisted record');

  // 7. update
  r = await call(MS => MS.putCollection('mp_invoices', [{ id: 'inv_1', ht: 200, ttc: 222 }, { id: 'inv_2', ht: 50, ttc: 55 }]));
  ok(r.ok && r.val.version === 2, '7. update → version 2');

  // 8. upload a real PNG built in-page
  r = await page.evaluate(async () => {
    const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII='), c => c.charCodeAt(0));
    const file = new File([bytes], 'photo.png', { type: 'image/png' });
    try { const val = await window.MythosSecure.upload(file, 'test'); return { ok: true, val }; }
    catch (e) { return { ok: false, error: String(e.message || e), status: e.status || null }; }
  });
  ok(r.ok && r.val.ok && r.val.mime === 'image/png', '8. upload real PNG → stored (image/png)');

  // RBAC UX: admin can write → button enabled
  await page.evaluate(() => window.MythosSecure.applyRbac(document));
  ok(await page.evaluate(() => !document.getElementById('write-btn').disabled), '   RBAC UX: admin write button enabled');

  // 10-12. logout then denied
  r = await call(MS => MS.logout());
  ok(r.ok, '10. logout');
  r = await call(MS => MS.getCollection('mp_invoices'));
  ok(!r.ok && r.status === 401, '12. authenticated read after logout → 401');

  // 13-15. viewer denied write
  r = await call(MS => MS.login('viewer', 'viewerPass123!'));
  ok(r.ok && r.val.roles.includes('viewer'), '13. viewer login');
  r = await call(MS => MS.getCollection('mp_invoices'));
  ok(r.ok && r.val.data.length === 2, '   viewer can read (server data)');
  r = await call(MS => MS.putCollection('mp_invoices', []));
  ok(!r.ok && r.status === 403, '15. viewer write → 403 (server-authoritative)');
  await page.evaluate(() => window.MythosSecure.applyRbac(document));
  ok(await page.evaluate(() => document.getElementById('write-btn').disabled === true), '   RBAC UX: viewer write button disabled');

  // 16-18. editor allowed
  await call(MS => MS.logout());
  r = await call(MS => MS.login('editor', 'editorPass123!'));
  ok(r.ok && r.val.roles.includes('editor'), '16. editor login');
  r = await call(MS => MS.putCollection('mp_invoices', [{ id: 'inv_9', ht: 10, ttc: 11 }]));
  ok(r.ok && r.val.version === 3, '17. editor write → version 3 (allowed)');

  // 19-20. reload → session cookie persists, data remains
  await page.reload({ waitUntil: 'domcontentloaded' });
  r = await call(MS => MS.me());
  ok(r.ok && r.val.roles.includes('editor'), '19. reload → session restored via cookie');
  r = await call(MS => MS.getCollection('mp_invoices'));
  ok(r.ok && r.val.data.length === 1 && r.val.data[0].id === 'inv_9', '20. data persists across reload');

  ok(consoleErrors.length === 0, 'no uncaught JS errors (' + (consoleErrors[0] || 'clean') + ')');

  await b.close();
  console.log('\nERP-E2E: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('E2E crashed:', e); process.exit(1); });
