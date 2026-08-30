// =====================================================
// OTH-K5 — read-only HTTP facade suite
// tests/othk-5-http-facade-test.js
//
// Covers projects/oth-knowledge/service/othk-http.js: authentication,
// the read-only guarantee, input bounds, fail-closed behaviour when the
// store is absent, and that every exposed route is a genuine
// knowledge-service read.
//
// Offline: a throwaway store, a loopback server on an ephemeral port, no
// credentials beyond a token this suite invents for itself.
//
// THE LOAD-BEARING TEST is "W": no HTTP verb and no route can write. The
// facade exists to let the network READ OTH Knowledge; ingestion and
// curation stay on othk-cli, and that must be true by construction rather
// than by convention.
// =====================================================
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const BASE = path.join(__dirname, '..');
const OTHK = path.join(BASE, 'projects', 'oth-knowledge');

const storeLib = require(path.join(OTHK, 'lib/store.js'));
const provenanceLib = require(path.join(OTHK, 'lib/provenance.js'));
const extract = require(path.join(OTHK, 'lib/extract.js'));
const facade = require(path.join(OTHK, 'service/othk-http.js'));

let passed = 0, failed = 0;
function ok(v, label) {
  if (v) { passed++; console.log('  PASS ' + label); }
  else { failed++; console.log('  FAIL ' + label); }
}
function tmpRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'othk5-')); }

const TOKEN = 'test-token-' + 'x'.repeat(24);
const CLASSES = provenanceLib.loadSourceClasses();
const CAP = '2026-08-30T00:00:00Z';

// A small real store so the routes have something truthful to return.
function seededStore() {
  const root = tmpRoot();
  const s = storeLib.openStore(root);
  const prov = {
    source_class: 'manual', source_collection: 'k5', source_reference: 'manual/k5/1',
    captured_at: CAP, observed_at: '2026-01-01T00:00:00Z',
  };
  const e = extract.addEntity(s, { entity_type: 'host', name: 'build-host' });
  const f = extract.addFact(s, CLASSES, {
    statement: 'the build host runs user-level systemd units',
    confidence: 'HIGH', prov, entity_ids: [e.id],
  });
  extract.addEvidence(s, { supports_id: f.id, evidence_ids: [e.id], note: 'k5 fixture' });
  return { root, factId: f.id, entityId: e.id };
}

function request(server, method, urlPath, token) {
  return new Promise((resolve) => {
    const addr = server.address();
    const headers = {};
    if (token) headers.Authorization = 'Bearer ' + token;
    const req = http.request(
      { host: '127.0.0.1', port: addr.port, method, path: urlPath, headers },
      (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(body); } catch (e) { /* non-JSON is a finding, not a crash */ }
          resolve({ status: res.statusCode, body, json });
        });
      }
    );
    req.on('error', () => resolve({ status: 0, body: '', json: null }));
    req.end();
  });
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

(async function run() {
  // ------------------------------------------------------------ construction
  console.log('\nA. construction refuses to serve without its inputs');
  {
    let threw = null;
    try { facade.createServer({ storeRoot: null, token: TOKEN }); } catch (e) { threw = e; }
    ok(threw && /OTHK_STORE_ROOT/.test(threw.message), 'A1: refuses to start without a store root');

    threw = null;
    try { facade.createServer({ storeRoot: tmpRoot(), token: null }); } catch (e) { threw = e; }
    ok(threw && /OTHK_HTTP_TOKEN/.test(threw.message), 'A2: refuses to start without a token');
  }

  const seeded = seededStore();
  const server = await listen(facade.createServer({ storeRoot: seeded.root, token: TOKEN }));

  // -------------------------------------------------------------------- auth
  console.log('\nB. authentication');
  {
    const noTok = await request(server, 'GET', '/stats', null);
    ok(noTok.status === 401, 'B1: no token → 401');

    const badTok = await request(server, 'GET', '/stats', 'wrong-token-' + 'y'.repeat(20));
    ok(badTok.status === 401, 'B2: wrong token → 401');

    const shortTok = await request(server, 'GET', '/stats', 'short');
    ok(shortTok.status === 401, 'B3: a token of a different length → 401 (no length oracle)');

    const good = await request(server, 'GET', '/stats', TOKEN);
    ok(good.status === 200, 'B4: correct token → 200');

    const health = await request(server, 'GET', '/health', null);
    ok(health.status === 200, 'B5: /health is open, so a probe needs no credential');
    ok(health.json && health.json.read_only === true, 'B6: /health declares the facade read-only');
    ok(health.json && health.json.store_available === true, 'B7: /health reports the store opened');
    ok(!health.body.includes(TOKEN), 'B8: /health never echoes the token');
  }

  // --------------------------------------------------- THE READ-ONLY RULE
  console.log('\nW. THE LOAD-BEARING TEST — the facade cannot write');
  {
    for (const verb of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const r = await request(server, verb, '/records/' + seeded.factId, TOKEN);
      ok(r.status === 405, 'W1: ' + verb + ' refused with 405 before any handler runs');
    }
    const ingest = await request(server, 'POST', '/ingest', TOKEN);
    ok(ingest.status === 405, 'W2: POST /ingest is refused as a method, not routed');

    // The store must be byte-identical after every request this suite made.
    const before = storeLib.openStore(seeded.root).stats();
    await request(server, 'GET', '/search?q=build', TOKEN);
    await request(server, 'GET', '/audit', TOKEN);
    const after = storeLib.openStore(seeded.root).stats();
    ok(before.records === after.records, 'W3: reading changes no records');
    ok(JSON.stringify(before.byKind) === JSON.stringify(after.byKind), 'W4: reading changes no record kinds');

    const surface = Object.keys(facade);
    ok(surface.indexOf('ingest') === -1 && surface.indexOf('write') === -1,
      'W5: the module exports no ingest/write helper');
  }

  // ------------------------------------------------------------------ reads
  console.log('\nC. read routes return real knowledge-service results');
  {
    const stats = await request(server, 'GET', '/stats', TOKEN);
    ok(stats.json && stats.json.records > 0, 'C1: /stats reports the store');

    const search = await request(server, 'GET', '/search?q=systemd', TOKEN);
    ok(search.status === 200 && Array.isArray(search.json.hits), 'C2: /search returns hits');
    ok(search.json.options.limit === 20, 'C3: /search applies the default limit');

    const rec = await request(server, 'GET', '/records/' + seeded.factId, TOKEN);
    ok(rec.status === 200 && rec.json.record && rec.json.record.id === seeded.factId, 'C4: /records/:id retrieves');

    const prov = await request(server, 'GET', '/records/' + seeded.factId + '/provenance', TOKEN);
    ok(prov.status === 200 && prov.json, 'C5: /records/:id/provenance resolves');

    const ev = await request(server, 'GET', '/records/' + seeded.factId + '/evidence', TOKEN);
    ok(ev.status === 200, 'C6: /records/:id/evidence resolves');

    const hist = await request(server, 'GET', '/records/' + seeded.factId + '/history', TOKEN);
    ok(hist.status === 200, 'C7: /records/:id/history resolves');

    const trust = await request(server, 'GET', '/records/' + seeded.factId + '/trust?asOf=' + CAP, TOKEN);
    ok(trust.status === 200, 'C8: /records/:id/trust resolves with an explicit asOf');

    const ent = await request(server, 'GET', '/entities?name=build-host', TOKEN);
    ok(ent.status === 200, 'C9: /entities resolves');

    const contra = await request(server, 'GET', '/contradictions', TOKEN);
    ok(contra.status === 200, 'C10: /contradictions resolves');

    const cur = await request(server, 'GET', '/current-state?asOf=' + CAP, TOKEN);
    ok(cur.status === 200, 'C11: /current-state resolves with an explicit asOf');

    const audit = await request(server, 'GET', '/audit', TOKEN);
    ok(audit.status === 200, 'C12: /audit resolves');
  }

  // ------------------------------------------------------------------ bounds
  console.log('\nD. input bounds and refusals');
  {
    const noQ = await request(server, 'GET', '/search', TOKEN);
    ok(noQ.status === 400, 'D1: /search without q → 400');

    const longQ = await request(server, 'GET', '/search?q=' + 'x'.repeat(600), TOKEN);
    ok(longQ.status === 400, 'D2: oversized query refused');

    const badMode = await request(server, 'GET', '/search?q=a&mode=telepathy', TOKEN);
    ok(badMode.status === 400, 'D3: unknown search mode refused');

    const badKind = await request(server, 'GET', '/search?q=a&kind=rumour', TOKEN);
    ok(badKind.status === 400, 'D4: unknown record kind refused');

    const capped = await request(server, 'GET', '/search?q=a&limit=9999', TOKEN);
    ok(capped.json.options.limit === facade.MAX_LIMIT, 'D5: limit is capped, not honoured blindly');

    const noAsOf = await request(server, 'GET', '/current-state', TOKEN);
    ok(noAsOf.status === 400, 'D6: /current-state without asOf refused — time is never implicit');

    const noAsOf2 = await request(server, 'GET', '/records/' + seeded.factId + '/trust', TOKEN);
    ok(noAsOf2.status === 400, 'D7: /trust without asOf refused');

    const nope = await request(server, 'GET', '/does-not-exist', TOKEN);
    ok(nope.status === 404, 'D8: unknown route → 404');
  }

  await new Promise((r) => server.close(r));

  // ------------------------------------------------------- absent store
  console.log('\nE. fail-closed when the store is absent');
  {
    const missing = path.join(os.tmpdir(), 'othk5-absent-' + Date.now());
    const s2 = await listen(facade.createServer({ storeRoot: missing, token: TOKEN }));

    const health = await request(s2, 'GET', '/health', null);
    ok(health.status === 200, 'E1: /health still answers when the store is absent');
    ok(health.json.store_available === false, 'E2: /health reports the store as unavailable');
    ok(health.json.status === 'degraded', 'E3: /health says degraded, not ok');
    ok(typeof health.json.reason === 'string' && health.json.reason.length > 0, 'E4: /health gives a reason');

    const stats = await request(s2, 'GET', '/stats', TOKEN);
    ok(stats.status === 503, 'E5: a read against an absent store → 503, never an invented answer');
    ok(!fs.existsSync(missing), 'E6: the facade did NOT create the missing store');

    await new Promise((r) => s2.close(r));
  }

  console.log('');
  console.log('othk-5: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
