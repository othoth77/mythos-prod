'use strict';
// =====================================================
// MYTHOS OS v4 — foundations: ledger, policy, Claude CLI, engines
// tests/mythos-os-v4-core-test.js
//
//   L  the decision ledger is append-only, hash-chained and tamper-evident,
//      and never stores a secret
//   P  the DOTS policy fails closed: a missing or wrong rule stops the load
//   C  lib/claude-cli.js spawns a REAL process (an executable stand-in),
//      with tools off and a clean environment; its deadline kills a hang;
//      quota, garbage and a missing binary are classified, never thrown
//   E  the engines: FABLE's identity is measured, not assumed; a non-JSON or
//      prose-wrapped answer is MALFORMED; OpenAI goes through the real
//      orchestrator provider (fake transport) and respects its off switch
//
// Offline and deterministic. Run with: node tests/mythos-os-v4-core-test.js
// =====================================================

var fs = require('fs');
var path = require('path');

var h = require('./support/mythos-os-v4-harness');
var dirs = h.setup('core');
var t = h.counter('mythos-os-v4 core tests');

var ledger = require(path.join(h.V4, 'lib', 'ledger'));
var policyLib = require(path.join(h.V4, 'lib', 'policy'));
var store = require(path.join(h.V4, 'lib', 'store'));
var claudeCli = require(path.join(h.V4, 'lib', 'claude-cli'));
var engines = require(path.join(h.V4, 'lib', 'engines'));

var claude = h.fakeClaude(dirs);

function section(name) { console.log('\n# ' + name); }

Promise.resolve().then(function () {
  section('L — ledger');
  var a = ledger.append({ actor: 'dots', type: 'T1', goal_id: 'g1', trace_id: 't1', detail: { n: 1 } });
  var b = ledger.append({ actor: 'jev', type: 'T2', goal_id: 'g1', trace_id: 't1', detail: { n: 2 } });
  ledger.append({ actor: 'haddad', type: 'T3', goal_id: 'g2', detail: { n: 3 } });
  t.ok(a.seq === 1 && b.seq === 2 && b.prev === a.hash && a.prev === ledger.GENESIS, 'records are sequenced and each carries the hash of the one before');
  t.eq(ledger.verify(), { ok: true, records: 3, problems: [] }, 'an untouched ledger verifies');
  t.eq(ledger.query({ goal_id: 'g1' }).map(function (r) { return r.type; }), ['T1', 'T2'], 'query filters by goal, oldest first');

  // A credential-shaped value never reaches the file.
  var secretish = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
  ledger.append({ actor: 'dots', type: 'T4', detail: { note: 'token ' + secretish, nested: { k: 'password=' + 'hunter2hunter2' } } });
  var raw = fs.readFileSync(ledger.ledgerFile(), 'utf8');
  t.ok(raw.indexOf(secretish) === -1 && raw.indexOf('hunter2hunter2') === -1, 'a secret in a detail is redacted before it is written');
  t.ok(ledger.verify().ok, 'the redacted record still verifies (the hash covers what was stored)');

  var threw = false;
  try { ledger.append({ type: 'NO_ACTOR' }); } catch (e) { threw = /LEDGER_INVALID_ENTRY/.test(e.message); }
  t.ok(threw, 'an entry with no actor is refused');

  // Tampering: edit, removal, reorder.
  var good = raw;
  var lines = good.split('\n').filter(Boolean);
  fs.writeFileSync(ledger.ledgerFile(), good.replace('"n":2', '"n":999'));
  t.ok(!ledger.verify().ok && /hash mismatch/.test(ledger.verify().problems.join(' ')), 'an edited record is detected');
  fs.writeFileSync(ledger.ledgerFile(), [lines[0], lines[2], lines[3]].join('\n') + '\n');
  t.ok(!ledger.verify().ok, 'a removed record is detected');
  fs.writeFileSync(ledger.ledgerFile(), lines.slice(0, 3).join('\n') + '\n');
  t.ok(!ledger.verify().ok && /head does not match/.test(ledger.verify().problems.join(' ')), 'a truncated tail is detected through the head');
  // A careful forger rewrites a record AND recomputes its hash, so the record
  // is self-consistent. Only the link from the NEXT record gives it away.
  var crypto = require('crypto');
  var forged = JSON.parse(lines[1]);
  forged.detail = { n: 999 };
  var forgedBody = { seq: forged.seq, at: forged.at, trace_id: forged.trace_id, goal_id: forged.goal_id, actor: forged.actor, type: forged.type, detail: forged.detail };
  forged.hash = crypto.createHash('sha256').update(forged.prev + '\n' + JSON.stringify(forgedBody)).digest('hex');
  fs.writeFileSync(ledger.ledgerFile(), [lines[0], JSON.stringify(forged), lines[2], lines[3]].join('\n') + '\n');
  var forgery = ledger.verify();
  t.ok(!forgery.ok && /line 3: chain broken/.test(forgery.problems.join(' ')) && !/hash mismatch/.test(forgery.problems.join(' ')),
    'a record rewritten WITH a recomputed hash is still detected: the next record no longer links to it');
  fs.writeFileSync(ledger.ledgerFile(), good);
  t.ok(ledger.verify().ok, 'restoring the file restores the chain');
  t.ok((fs.statSync(ledger.ledgerFile()).mode & 0o077) === 0, 'the ledger file is private (0600)');

  section('P — policy');
  var shipped = policyLib.load();
  t.ok(shipped.authority.general_manager === 'dots' && shipped.authority.executive_primary === 'fable' && shipped.authority.executive_failover === 'openai', 'the shipped policy states the chain of authority');
  t.eq(shipped.models.tier_order, ['free', 'local', 'paid'], 'the shipped tier order is free → local → paid');
  function refused(mutate, expect, name) {
    var p = h.policy();
    mutate(p);
    var msg = '';
    try { policyLib.load({ policy: p }); } catch (e) { msg = e.message; }
    t.ok(/^POLICY_INVALID/.test(msg) && expect.test(msg), name);
  }
  refused(function (p) { p.authority.general_manager = 'openai'; }, /general_manager/, 'OpenAI cannot be made general manager by configuration');
  refused(function (p) { delete p.loop.max_cycles; }, /loop\.max_cycles/, 'a missing loop bound is refused, not defaulted');
  refused(function (p) { p.loop.max_total_steps = 0; }, /max_total_steps/, 'a zero step budget is refused');
  refused(function (p) { p.models.tier_order = ['paid', 'free']; }, /tier_order/, 'a tier order that does not name all three tiers is refused');
  refused(function (p) { p.haddad.direct_actions = ['investigate', 'implement']; }, /write action/, 'a write action on the direct (no-worktree) path is refused');
  refused(function (p) { p.executive.direct_actions = ['implement']; }, /last resort never writes/, 'the deterministic last resort can never be given a write action');
  refused(function (p) { p.executive.fable_model = 'gpt-x'; }, /fable_model/, 'the executive model must be a fable model');
  refused(function (p) { p.plan.forbidden_terms = []; }, /forbidden_terms/, 'an empty forbidden-operations list is refused');
  var badPath = '';
  try { policyLib.load({ path: path.join(dirs.root, 'nope.json') }); } catch (e) { badPath = e.message; }
  t.ok(/^POLICY_INVALID: cannot read/.test(badPath), 'an unreadable policy file stops the load');

  section('store');
  var id = store.newId('goal');
  t.ok(store.isValidId(id) && !store.isValidId('../../etc/passwd') && !store.isValidId('goal-1'), 'ids are generated in one shape and anything else is invalid');
  var order = [];
  store.withLock(path.join(dirs.osHome, 'x.lock'), function () { order.push('in'); });
  t.ok(order.length === 1 && !fs.existsSync(path.join(dirs.osHome, 'x.lock')), 'a lock is released after its critical section');

  section('C — Claude CLI');
  t.ok(claudeCli.available(claude.bin) === true && claudeCli.available(path.join(dirs.bin, 'missing')) === false, 'available() reports the binary, present or not');
  var args = claudeCli.buildArgs({ model: 'claude-fable-5-1', system: 'S' });
  t.ok(args.indexOf('--tools') !== -1 && args[args.indexOf('--tools') + 1] === '' && args.indexOf('--model') !== -1 && args.indexOf('--strict-mcp-config') !== -1 && args.indexOf('--no-session-persistence') !== -1,
    'argv: tools off, model always passed, no MCP, no session');

  claude.script({ by_model: { 'claude-fable-5-1': [{ result: '{"a":1}' }] } });
  process.env.SHOULD_NOT_LEAK = 'x';
  return claudeCli.run({ model: 'claude-fable-5-1', system: 'sys', prompt: 'hello', timeoutMs: 15000 }, { bin: claude.bin });
}).then(function (out) {
  t.ok(out.ok === true && out.text === '{"a":1}' && out.models_measured.join() === 'claude-fable-5-1', 'a real spawned call returns the text and the MEASURED model');
  var call = claude.calls()[0];
  t.ok(call.stdin === 'hello' && call.model === 'claude-fable-5-1', 'the prompt travels on stdin, the model in argv');
  t.ok(call.env_keys.indexOf('SHOULD_NOT_LEAK') === -1 && call.env_keys.indexOf('HOME') !== -1, 'the child gets an allow-listed environment only');
  t.ok(call.cwd.indexOf(dirs.osHome) === 0 && call.cwd.indexOf(h.BASE) !== 0, 'the child runs in a neutral directory, not the repository');

  claude.script({ default: { hang: true } });
  var started = Date.now();
  return claudeCli.run({ model: 'm', prompt: 'x', timeoutMs: 1200 }, { bin: claude.bin }).then(function (hung) {
    t.ok(hung.ok === false && hung.error.code === 'TIMEOUT' && hung.timed_out === true && Date.now() - started < 6000, 'a hanging call is ended by the hard deadline');
  });
}).then(function () {
  claude.script({ default: { error: "You've hit your usage limit · resets 9:20pm (UTC)" } });
  return claudeCli.run({ model: 'm', prompt: 'x', timeoutMs: 15000 }, { bin: claude.bin });
}).then(function (q) {
  t.ok(q.ok === false && q.error.code === 'QUOTA' && typeof q.resume_at === 'number', 'a usage limit is QUOTA with a parsed reset time, not a generic failure');
  claude.script({ default: { error: 'API Error: 529 overloaded' } });
  return claudeCli.run({ model: 'm', prompt: 'x', timeoutMs: 15000 }, { bin: claude.bin });
}).then(function (tr) {
  t.ok(tr.ok === false && tr.error.code === 'TRANSIENT', 'an overload is TRANSIENT');
  claude.script({ default: { raw: 'Segmentation fault', exit: 0 } });
  return claudeCli.run({ model: 'm', prompt: 'x', timeoutMs: 15000 }, { bin: claude.bin });
}).then(function (g) {
  t.ok(g.ok === false && g.error.code === 'MALFORMED_CLI_OUTPUT', 'garbage on stdout is MALFORMED_CLI_OUTPUT');
  return claudeCli.run({ model: 'm', prompt: 'x', timeoutMs: 5000 }, { bin: path.join(dirs.bin, 'missing-claude') });
}).then(function (m) {
  t.ok(m.ok === false && m.error.code === 'UNAVAILABLE', 'a missing binary is UNAVAILABLE, never a thrown error');
  return claudeCli.run({ prompt: 'x' }, { bin: claude.bin });
}).then(function (nm) {
  t.ok(nm.ok === false && nm.error.code === 'MISCONFIGURED', 'a call with no model is refused (the CLI default never runs)');

  section('E — engines');
  t.eq(engines.extractObject('{"a":1}'), { a: 1 }, 'a bare object is accepted');
  t.eq(engines.extractObject('```json\n{"a":1}\n```'), { a: 1 }, 'one fenced object is accepted');
  t.ok(engines.extractObject('Sure! {"a":1}') === null && engines.extractObject('[1]') === null && engines.extractObject('{"a":1} {"b":2}') === null && engines.extractObject('') === null,
    'prose, an array, two objects or nothing are refused');

  var fable = engines.createFable({ bin: claude.bin, model: 'claude-fable-5-1' });
  t.ok(fable.available().ok, 'FABLE reports available when its CLI exists');
  claude.script({ by_model: { 'claude-fable-5-1': [
    { result: '{"pong":"pong"}' },
    { result: '{"pong":"pong"}', served_by: ['claude-sonnet-5'] },
    { result: 'I think the answer is pong.' }
  ] } });
  var req = { system: 's', input: 'ping', schema: { type: 'object' }, timeoutMs: 15000 };
  return fable.call(req).then(function (ok) {
    t.ok(ok.ok && ok.value.pong === 'pong' && ok.model_measured === 'claude-fable-5-1', 'FABLE answers with a parsed object and its measured identity');
    return fable.call(req);
  }).then(function (id) {
    t.ok(!id.ok && id.error.code === 'IDENTITY_MISMATCH', 'an answer served by another model under FABLE\'s name is IDENTITY_MISMATCH');
    return fable.call(req);
  }).then(function (mal) {
    t.ok(!mal.ok && mal.error.code === 'MALFORMED', 'FABLE answering prose instead of JSON is MALFORMED');
  });
}).then(function () {
  // OpenAI through the REAL provider (buildRequest / run / parseResponse); only the socket is replaced.
  var keyFile = path.join(dirs.root, 'openai.env');
  fs.writeFileSync(keyFile, 'OPENAI_API_KEY=fixture-openai-key\n', { mode: 0o600 });
  var cfg = { enabled: true, base_url: 'https://api.openai.invalid/v1', roles: { supervise_plan: { model: 'gpt-fixture', reasoning: 'low', max_output_tokens: 500 } } };
  var seen = [];
  function transport(reply) {
    return function (spec) { seen.push(spec); return Promise.resolve(typeof reply === 'function' ? reply(spec) : reply); };
  }
  function body(obj) {
    return { status: 200, body: JSON.stringify({ status: 'completed', model: 'gpt-fixture-2026', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(obj) }] }], usage: {} }) };
  }
  var schema = { type: 'object', additionalProperties: false, required: ['pong'], properties: { pong: { type: 'string' } } };
  var req = { system: 'sys', input: 'ping', schema: schema, role: 'supervise_plan', timeoutMs: 5000 };

  var up = engines.createOpenAI({ config: cfg, keyFile: keyFile, transport: transport(body({ pong: 'pong' })) });
  t.ok(up.available().ok, 'OpenAI is available with the switch on and a key file');
  return up.call(req).then(function (ok) {
    t.ok(ok.ok && ok.value.pong === 'pong' && ok.model_measured === 'gpt-fixture-2026', 'OpenAI answers through the real provider with the model it reported');
    var sent = seen[0];
    t.ok(sent.url === 'https://api.openai.invalid/v1/responses' && sent.body.model === 'gpt-fixture' && sent.body.store === false && sent.body.text.format.strict === true,
      'the request is the Responses API with a strict schema and store:false');
    t.ok(JSON.stringify(sent.body).indexOf('fixture-openai-key') === -1 && sent.headers.Authorization === 'Bearer fixture-openai-key', 'the key is in one header and nowhere in the body');
    t.ok(JSON.stringify(ok).indexOf('fixture-openai-key') === -1, 'the key never appears in the result');

    t.ok(!engines.createOpenAI({ config: Object.assign({}, cfg, { enabled: false }), keyFile: keyFile }).available().ok, 'the config switch turns OpenAI off');
    t.ok(!engines.createOpenAI({ config: cfg, keyFile: path.join(dirs.root, 'none.env') }).available().ok, 'no key file means unavailable, never an invented key');
    return engines.createOpenAI({ config: Object.assign({}, cfg, { enabled: false }), keyFile: keyFile, transport: transport(body({ pong: 'pong' })) }).call(req);
  }).then(function (off) {
    t.ok(!off.ok && off.error.code === 'UNAVAILABLE' && seen.length === 1, 'a disabled OpenAI is never called');
    var cases = [
      [{ status: 429, body: '{"error":{"type":"rate_limit"}}' }, 'QUOTA', 'HTTP 429 is QUOTA'],
      [{ status: 401, body: '{"error":{"type":"auth"}}' }, 'BLOCKED', 'HTTP 401 is BLOCKED'],
      [{ status: 503, body: '{}' }, 'TRANSIENT', 'HTTP 503 is TRANSIENT'],
      [{ status: 200, body: 'not json' }, 'MALFORMED', 'a non-JSON body is MALFORMED'],
      [{ status: 200, body: JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'prose' }] }] }) }, 'MALFORMED', 'prose instead of the schema is MALFORMED'],
      [{ status: 200, body: JSON.stringify({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }) }, 'MALFORMED', 'a truncated answer is MALFORMED, never a partial plan']
    ];
    return cases.reduce(function (p, c) {
      return p.then(function () {
        return engines.createOpenAI({ config: cfg, keyFile: keyFile, transport: transport(c[0]) }).call(req).then(function (out) {
          t.ok(!out.ok && out.error.code === c[1], 'OpenAI: ' + c[2]);
        });
      });
    }, Promise.resolve()).then(function () {
      var err = new Error('deadline'); err.code = 'ETIMEDOUT';
      return engines.createOpenAI({ config: cfg, keyFile: keyFile, transport: function () { return Promise.reject(err); } }).call(req);
    }).then(function (to) {
      t.ok(!to.ok && to.error.code === 'TIMEOUT', 'OpenAI: a transport deadline is TIMEOUT');
      return engines.createOpenAI({ config: cfg, keyFile: keyFile, transport: transport(body({ pong: 'pong' })) }).call(Object.assign({}, req, { role: 'nope' }));
    }).then(function (role) {
      t.ok(!role.ok && role.error.code === 'MISCONFIGURED', 'OpenAI: an unknown role is refused before any request');
    });
  });
}).then(function () { t.finish(dirs); }, t.crash(dirs));
