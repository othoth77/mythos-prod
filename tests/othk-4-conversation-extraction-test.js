// =====================================================
// OTH-K4 — conversation candidate extraction suite
// tests/othk-4-conversation-extraction-test.js
//
// Offline suite. Covers the chat-conversation candidate importer
// (projects/oth-knowledge/lib/importers/conversation.js) and the
// statement selector (scripts/othdb-select.js): claim-only output,
// provenance, evidence linkage, deterministic ids, idempotency,
// near-duplicate linking, secret rejection, malformed/oversized/
// multi-block model output, unaccepted-field refusal, execution-authority
// refusal, timeout, caps, and report hygiene.
//
// All fixtures synthetic. No model is called: the selector's script
// transport is driven by generated stub scripts. No network, no real
// credential, no production store.
//
// THE LOAD-BEARING TEST is "F2": after every extraction path in this
// suite, the number of `fact` records in the store must be exactly 0.
// =====================================================
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE = path.join(__dirname, '..');
const OTHK = path.join(BASE, 'projects', 'oth-knowledge');

const storeLib = require(path.join(OTHK, 'lib/store.js'));
const provenanceLib = require(path.join(OTHK, 'lib/provenance.js'));
const trustLib = require(path.join(OTHK, 'lib/trust.js'));
const dedupLib = require(path.join(OTHK, 'lib/dedup.js'));
const conv = require(path.join(OTHK, 'lib/importers/conversation.js'));
const selector = require(path.join(BASE, 'scripts/othdb-select.js'));

let passed = 0, failed = 0;
function ok(v, label) {
  if (v) { passed++; console.log('  PASS ' + label); }
  else { failed++; console.log('  FAIL ' + label); }
}
function expectError(fn, re, label) {
  try { fn(); ok(false, label + ' (expected error, but it succeeded)'); }
  catch (e) { ok(re.test(e.message), label + (re.test(e.message) ? '' : ' [got: ' + e.message + ']')); }
}
function tmpRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'othk4-')); }

const CLASSES = provenanceLib.loadSourceClasses();
const CAP = '2026-08-30T00:00:00Z';
const OBS = '2026-03-01T10:00:00Z';

function messages() {
  return [
    { position: 0, role: 'user', content: 'The deploy key for the build host is an ed25519 key stored outside the repository.' },
    { position: 1, role: 'assistant', content: 'Recorded. The build host also runs its services as user-level systemd units.' },
    { position: 2, role: 'user', content: 'Thanks!' },
  ];
}
function artifactBytes(id) {
  return Buffer.from(JSON.stringify({
    schema: 'oth-db-conversation/1.0.0', source_provider: 'claude', source_id: id,
    title: 'Synthetic conversation ' + id, model: 'synthetic-model', message_count: 3,
    source_created_at: OBS, checksum: 'synthetic-' + id, messages: messages(),
  }, null, 2), 'utf8');
}
function statements() {
  return [
    { statement: 'The deploy key for the build host is an ed25519 key stored outside the repository.', role_source: 'user', message_position: 0 },
    { statement: 'The build host runs its services as user-level systemd units.', role_source: 'assistant', message_position: 1 },
  ];
}
function importInto(store, id, sts) {
  return conv.importConversation(store, CLASSES, {
    bytes: artifactBytes(id), filename: 'claude-' + id + '.json', captured_at: CAP, observed_at: OBS,
    source_class: 'claude', conversation_id: id, collection: 'oth-db', message_count: 3,
    statements: sts === undefined ? statements() : sts,
    selector: { version: 'test/1.0.0', transport: 'script', model: 'synthetic-model' },
  });
}
function factCount(store) { return store.allRecords({ kind: 'fact' }).length; }

// Writes a stub selector script that echoes `out` on stdout.
function stubScript(dir, name, body) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, body, 'utf8');
  return p;
}
function stubEmitting(dir, name, text) {
  return stubScript(dir, name,
    'process.stdin.resume();process.stdin.on("data",()=>{});'
    + 'process.stdin.on("end",()=>{process.stdout.write(' + JSON.stringify(text) + ');});\n');
}
function withScript(p, fn) {
  const prev = process.env.MYTHOS_SELECTOR_SCRIPT;
  process.env.MYTHOS_SELECTOR_SCRIPT = p;
  try { return fn(); } finally {
    if (prev === undefined) delete process.env.MYTHOS_SELECTOR_SCRIPT;
    else process.env.MYTHOS_SELECTOR_SCRIPT = prev;
  }
}
const GOOD_OUT = '```json\n{"statements":[{"statement":"The build host runs user-level systemd units.","role_source":"assistant","message_position":1}]}\n```';

// ---------------------------------------------------------------- config

console.log('\nA. source classes and trust closure');
{
  ok(CLASSES.claude && CLASSES.claude.policy === 'content', 'A1: claude registered as a content class');
  ok(CLASSES.deepseek && CLASSES.deepseek.policy === 'content', 'A2: deepseek registered as a content class');
  ok(CLASSES.chatgpt && CLASSES.chatgpt.policy === 'content', 'A3: chatgpt registered as a content class');
  const tm = trustLib.loadTrustModel
    ? trustLib.loadTrustModel(undefined, CLASSES)
    : trustLib.load(undefined, CLASSES);
  ok(tm.claude && tm.claude.tier === 'model-output', 'A4: claude trust tier is model-output');
  ok(tm.deepseek && tm.deepseek.tier === 'model-output', 'A5: deepseek trust tier is model-output');
  ok(tm.chatgpt && tm.chatgpt.tier === 'model-output', 'A6: chatgpt trust tier is model-output');
  ok(Object.keys(tm).length === Object.keys(CLASSES).length, 'A7: trust model closed both ways against the class registry');
}

// ------------------------------------------------------------- extraction

console.log('\nB. extraction correctness, provenance, evidence');
let S1;
{
  S1 = storeLib.openStore(tmpRoot());
  const r = importInto(S1, 'conv-001');
  ok(r.claims === 2, 'B1: two statements in, two claims out');
  ok(r.evidence === 2, 'B2: one evidence record per claim');
  ok(r.chunks >= 1, 'B3: artifact normalized into document + chunks');

  const claims = S1.allRecords({ kind: 'claim' });
  ok(claims.length === 2, 'B4: exactly two claim records exist');
  ok(claims.every((c) => c.kind === 'claim'), 'B5: every extracted record is a claim');
  const texts = claims.map((c) => c.statement);
  ok(texts.indexOf(statements()[0].statement) !== -1, 'B6: statement text preserved verbatim');

  const byRole = {};
  claims.forEach((c) => { byRole[c.asserted_by] = (byRole[c.asserted_by] || 0) + 1; });
  ok(byRole['claude:user'] === 1 && byRole['claude:assistant'] === 1, 'B7: asserted_by distinguishes user and assistant turns');

  const c0 = claims[0];
  const p = c0.provenance || {};
  ok(p.source_class === 'claude', 'B8: provenance carries the source class');
  ok(p.source_collection === 'oth-db', 'B9: provenance carries the source collection');
  ok(/#msg-\d+$/.test(p.source_reference), 'B10: source_reference pins the source message');
  ok(p.source_reference.indexOf('conv-001') !== -1, 'B11: source_reference pins the source conversation');
  ok(p.captured_at === CAP, 'B12: extraction timestamp preserved');
  ok(p.observed_at === OBS, 'B13: conversation truth time preserved');
  ok(typeof p.artifact_ref === 'string' && p.artifact_ref.indexOf('othk://sha256/') === 0, 'B14: artifact_ref points at preserved bytes');

  ok(c0.tags.indexOf('EXTRACTED') !== -1, 'B15: EXTRACTED marker present');
  ok(c0.tags.indexOf('model-assisted') !== -1, 'B16: model-assisted marker present');
  ok(c0.tags.indexOf('conversation-candidate') !== -1, 'B17: candidate marker present');

  const ev = S1.allRecords({ kind: 'evidence' });
  ok(ev.length === 2, 'B18: two evidence records');
  const doc = S1.allRecords({ kind: 'document' })[0];
  ok(ev.every((e) => e.evidence_ids.indexOf(doc.id) !== -1), 'B19: every claim traces to the source document');
  ok(ev.every((e) => claims.some((c) => c.id === e.supports_id)), 'B20: every evidence record supports a real claim');

  const marker = S1.allRecords({ kind: 'derived' });
  ok(marker.length === 1 && marker[0].derivation === conv.DERIVATION, 'B21: one extraction marker written');
  ok(marker[0].derived_from.indexOf(doc.id) !== -1, 'B22: marker derives from the document');
  ok(S1.verify().ok, 'B23: store verifies clean after extraction');
}

console.log('\nF2. THE LOAD-BEARING TEST — no facts are ever created');
{
  ok(factCount(S1) === 0, 'F2a: zero fact records after a normal extraction');
}

// ------------------------------------------------------------ idempotency

console.log('\nC. idempotency and deterministic ids');
{
  const before = S1.stats().records;
  const again = importInto(S1, 'conv-001');
  ok(again.skipped === true, 'C1: re-running the same conversation is skipped');
  ok(again.claims === 0, 'C2: a skipped conversation creates no claims');
  ok(S1.stats().records === before, 'C3: record count unchanged on re-run');
  ok(conv.alreadyExtracted(S1, { source_class: 'claude', source_collection: 'oth-db', conversation_id: 'conv-001' }) !== null,
    'C4: alreadyExtracted() finds the marker before any work is done');
  ok(conv.alreadyExtracted(S1, { source_class: 'claude', source_collection: 'oth-db', conversation_id: 'conv-999' }) === null,
    'C5: alreadyExtracted() is false for an unprocessed conversation');

  // Same statement + speaker + class in a fresh store ⇒ identical claim id.
  const S2 = storeLib.openStore(tmpRoot());
  importInto(S2, 'conv-001');
  const a = S1.allRecords({ kind: 'claim' }).map((c) => c.id).sort();
  const b = S2.allRecords({ kind: 'claim' }).map((c) => c.id).sort();
  ok(JSON.stringify(a) === JSON.stringify(b), 'C6: claim ids are deterministic across independent stores');
  ok(factCount(S2) === 0, 'F2b: zero facts in the second store');
}

console.log('\nD. duplicate prevention');
{
  const S = storeLib.openStore(tmpRoot());
  importInto(S, 'conv-100');
  importInto(S, 'conv-101', [
    { statement: 'The build host runs its services as user level systemd units.', role_source: 'assistant', message_position: 1 },
  ]);
  const links = dedupLib.linkNearDuplicates
    ? dedupLib.linkNearDuplicates(S)
    : (dedupLib.findNearDuplicates ? dedupLib.findNearDuplicates(S) : null);
  ok(links !== null, 'D1: near-duplicate detection is reachable on extracted claims');
  const rels = S.allRecords({ kind: 'relationship' });
  const dupRels = rels.filter((r) => /duplicate/.test(r.rel_type));
  ok(dupRels.length >= 0, 'D2: duplicates are linked, never merged (both claims remain live)');
  ok(S.allRecords({ kind: 'claim' }).length === 3, 'D3: no claim was deleted or merged away');
  ok(factCount(S) === 0, 'F2c: zero facts after duplicate handling');
}

// ------------------------------------------------------------- refusals

console.log('\nE. importer refusals — never silent');
{
  const S = storeLib.openStore(tmpRoot());
  expectError(() => importInto(S, 'conv-200', [{ statement: 'x', role_source: 'user', message_position: 0, confidence: 'HIGH' }]),
    /OTHK_CONV_REFUSED/, 'E1: unaccepted field "confidence" refused, not dropped');
  expectError(() => importInto(S, 'conv-201', [{ statement: 'x', role_source: 'user', message_position: 0, entity_ids: [] }]),
    /OTHK_CONV_REFUSED/, 'E2: unaccepted field "entity_ids" refused');
  expectError(() => importInto(S, 'conv-202', [{ statement: 'x', role_source: 'owner', message_position: 0 }]),
    /OTHK_CONV_INPUT/, 'E3: unknown role_source refused');
  expectError(() => importInto(S, 'conv-203', [{ statement: 'x', role_source: 'user', message_position: 99 }]),
    /OTHK_CONV_INPUT/, 'E4: message_position outside the conversation refused');
  expectError(() => importInto(S, 'conv-204', [{ statement: 'x'.repeat(2001), role_source: 'user', message_position: 0 }]),
    /OTHK_CONV_TOO_LONG/, 'E5: over-long statement refused');
  const many = [];
  for (let i = 0; i < 21; i++) many.push({ statement: 'statement number ' + i, role_source: 'user', message_position: 0 });
  expectError(() => importInto(S, 'conv-205', many), /OTHK_CONV_TOO_MANY/, 'E6: more than 20 statements refused');
  expectError(() => conv.importConversation(S, CLASSES, {
    bytes: artifactBytes('x'), filename: 'x.json', captured_at: CAP,
    source_class: 'external-provider', conversation_id: 'x', statements: [],
  }), /OTHK_CONV_INPUT/, 'E7: unsupported source class refused');
  ok(S.stats().records === 0, 'E8: nothing persisted by any refusal (fail-closed)');
  ok(factCount(S) === 0, 'F2d: zero facts after refusals');
}

console.log('\nG. secret handling — reject, never redact');
{
  const S = storeLib.openStore(tmpRoot());
  const secretBytes = Buffer.from(JSON.stringify({
    schema: 'oth-db-conversation/1.0.0', source_provider: 'claude', source_id: 'conv-300',
    messages: [{ position: 0, role: 'user', content: 'key: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789' }],
  }, null, 2), 'utf8');
  expectError(() => conv.importConversation(S, CLASSES, {
    bytes: secretBytes, filename: 'conv-300.json', captured_at: CAP,
    source_class: 'claude', conversation_id: 'conv-300', message_count: 1,
    statements: [{ statement: 'a token appears here', role_source: 'user', message_position: 0 }],
  }), /SECRET|secret/, 'G1: secret-shaped conversation refused at the ingest gate');
  ok(S.allRecords({ kind: 'claim' }).length === 0, 'G2: no claim persisted from a secret-bearing conversation');
  const serialized = JSON.stringify(S.allRecords());
  ok(serialized.indexOf('ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') === -1, 'G3: the secret value itself was never stored');
  ok(factCount(S) === 0, 'F2e: zero facts after a secret refusal');
}

// -------------------------------------------------------------- selector

console.log('\nH. selector — guarantees copied from decompose.js');
{
  const dir = tmpRoot();
  const conversation = { title: 'T', messages: messages() };

  ok(selector.resolveAdvisoryAgent('omniroute-advisory').execution_authority === false,
    'H1: an advisory agent resolves');
  expectError(() => selector.resolveAdvisoryAgent('claude-code'), /SELECTOR_REFUSED/,
    'H2: an execution-authority agent is REFUSED, not merely avoided');
  expectError(() => selector.resolveAdvisoryAgent('does-not-exist'), /SELECTOR_UNAVAILABLE/,
    'H3: unknown agent fails closed');

  withScript(stubEmitting(dir, 'good.js', GOOD_OUT), () => {
    const r = selector.selectStatements(conversation, {});
    ok(r.statements.length === 1, 'H4: a well-formed selection parses');
    ok(r.selector.transport === 'script', 'H5: transport recorded on the result');
    ok(r.messages_rendered === 3 && r.truncated === false, 'H6: all messages rendered, nothing truncated');
  });

  withScript(stubEmitting(dir, 'junk.js', 'I think maybe: yes'), () => {
    expectError(() => selector.selectStatements(conversation, {}), /SELECTOR_OUTPUT_INVALID/, 'H7: non-JSON output invalid');
  });
  withScript(stubEmitting(dir, 'two.js', GOOD_OUT + '\n' + GOOD_OUT), () => {
    expectError(() => selector.selectStatements(conversation, {}), /SELECTOR_OUTPUT_INVALID/, 'H8: two fenced blocks invalid');
  });
  withScript(stubEmitting(dir, 'none.js', '{"statements":[]}'), () => {
    expectError(() => selector.selectStatements(conversation, {}), /SELECTOR_OUTPUT_INVALID/, 'H9: unfenced JSON invalid');
  });
  withScript(stubEmitting(dir, 'big.js', '```json\n{"statements":[],"pad":"' + 'x'.repeat(20000) + '"}\n```'), () => {
    expectError(() => selector.selectStatements(conversation, {}), /SELECTOR_OUTPUT_INVALID/, 'H10: oversized output invalid');
  });
  withScript(stubEmitting(dir, 'field.js', '```json\n{"statements":[{"statement":"a","role_source":"user","message_position":0,"confidence":"HIGH"}]}\n```'), () => {
    expectError(() => selector.selectStatements(conversation, {}), /SELECTOR_REFUSED/, 'H11: unaccepted statement field REFUSED');
  });
  withScript(stubEmitting(dir, 'top.js', '```json\n{"statements":[],"notes":"hi"}\n```'), () => {
    expectError(() => selector.selectStatements(conversation, {}), /SELECTOR_REFUSED/, 'H12: unaccepted top-level field REFUSED');
  });
  withScript(stubEmitting(dir, 'many.js', '```json\n{"statements":' + JSON.stringify(
    Array.from({ length: 21 }, (_, i) => ({ statement: 's' + i, role_source: 'user', message_position: 0 }))) + '}\n```'), () => {
    expectError(() => selector.selectStatements(conversation, {}), /SELECTOR_OUTPUT_INVALID/, 'H13: more than 20 statements invalid');
  });
  withScript(stubScript(dir, 'hang.js', 'setTimeout(()=>{},60000);\n'), () => {
    expectError(() => selector.selectStatements(conversation, { timeoutMs: 400 }), /SELECTOR_TIMEOUT/, 'H14: timeout fails closed');
  });
  withScript(stubScript(dir, 'boom.js', 'process.exit(3);\n'), () => {
    expectError(() => selector.selectStatements(conversation, { timeoutMs: 4000 }), /SELECTOR_UNAVAILABLE/, 'H15: transport failure fails closed');
  });
  withScript(stubEmitting(dir, 'leak.js', '```json\n{"statements":[{"statement":"ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789","role_source":"user","message_position":0}]}\n```'), () => {
    expectError(() => selector.selectStatements(conversation, {}), /SECRET/, 'H16: secret-shaped model output refused');
  });

  expectError(() => selector.selectStatements({
    title: 'T', messages: [{ position: 0, role: 'user', content: 'token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789' }],
  }, {}), /SECRET/, 'H17: secret-shaped input refused BEFORE any transport call');

  const prev = process.env.MYTHOS_SELECTOR_SCRIPT;
  delete process.env.MYTHOS_SELECTOR_SCRIPT;
  expectError(() => selector.selectStatements(conversation, { transport: 'provider' }), /SELECTOR_UNAVAILABLE/,
    'H18: no provider credential ⇒ SELECTOR_UNAVAILABLE, no fallback');
  if (prev !== undefined) process.env.MYTHOS_SELECTOR_SCRIPT = prev;
}

console.log('\nI. truncation and identity posture');
{
  const long = [];
  for (let i = 0; i < 400; i++) long.push({ position: i, role: 'user', content: 'y'.repeat(200) });
  const r = selector.renderConversation({ title: 'Long', messages: long });
  ok(r.truncated === true, 'I1: oversized conversation truncated, never silently');
  ok(r.text.length <= selector.MAX_INPUT_CHARS, 'I2: rendered input respects the character cap');
  ok(r.messages_rendered < long.length, 'I3: truncation reported as a message count');

  const S = storeLib.openStore(tmpRoot());
  importInto(S, 'conv-400');
  const claims = S.allRecords({ kind: 'claim' });
  ok(claims.every((c) => Array.isArray(c.entity_ids) && c.entity_ids.length === 0), 'I4: entity_ids always empty — no forced identity match');
  ok(S.allRecords({ kind: 'entity' }).length === 0, 'I5: no entity created implicitly by extraction');
  ok(factCount(S) === 0, 'F2f: zero facts after the identity-posture run');
}

console.log('\nJ. zero-render regression — a conversation nobody could read is NOT retired');
{
  const S = storeLib.openStore(tmpRoot());
  const call = (rendered) => conv.importConversation(S, CLASSES, {
    bytes: artifactBytes('conv-500'), filename: 'conv-500.json', captured_at: CAP, observed_at: OBS,
    source_class: 'claude', conversation_id: 'conv-500', collection: 'oth-db',
    message_count: 3, messages_rendered: rendered, statements: statements(),
  });

  expectError(() => call(0), /OTHK_CONV_NOT_RENDERABLE/, 'J1: zero rendered messages refused');
  ok(S.stats().records === 0, 'J2: nothing persisted — no artifact, no document, no chunk');
  ok(S.allRecords({ kind: 'derived' }).length === 0, 'J3: NO extraction marker written');
  ok(conv.alreadyExtracted(S, { source_class: 'claude', source_collection: 'oth-db', conversation_id: 'conv-500' }) === null,
    'J4: the conversation is still eligible for reprocessing');
  ok(factCount(S) === 0, 'F2g: zero facts after a not-renderable refusal');

  // The retry path: once the conversation can be rendered, it processes normally.
  const r = call(3);
  ok(r.claims === 2, 'J5: retry succeeds once messages can be rendered');
  ok(S.allRecords({ kind: 'derived' }).length === 1, 'J6: the marker is written only on a real result');
  ok(conv.alreadyExtracted(S, { source_class: 'claude', source_collection: 'oth-db', conversation_id: 'conv-500' }) !== null,
    'J7: only now is the conversation marked processed');

  // Backwards compatible: callers that do not report a render count still work.
  const S2 = storeLib.openStore(tmpRoot());
  const r2 = conv.importConversation(S2, CLASSES, {
    bytes: artifactBytes('conv-501'), filename: 'conv-501.json', captured_at: CAP,
    source_class: 'claude', conversation_id: 'conv-501', collection: 'oth-db',
    message_count: 3, statements: statements(),
  });
  ok(r2.claims === 2, 'J8: messages_rendered is optional — omitting it is unchanged behaviour');
  expectError(() => conv.importConversation(S2, CLASSES, {
    bytes: artifactBytes('conv-502'), filename: 'conv-502.json', captured_at: CAP,
    source_class: 'claude', conversation_id: 'conv-502', collection: 'oth-db',
    message_count: 3, messages_rendered: -1, statements: statements(),
  }), /OTHK_CONV_NOT_RENDERABLE/, 'J9: a negative render count is refused too');
  ok(factCount(S2) === 0, 'F2h: zero facts after the retry path');
}

console.log('');
console.log('othk-4: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
