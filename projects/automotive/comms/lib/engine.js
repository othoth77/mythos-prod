'use strict';
// =====================================================
// MYTHOS AUTO auto-reply — the engine (one inbound → one governed outcome)
// projects/automotive/comms/lib/engine.js
//
//   CUSTOMER → EXISTING PROVIDER (Evolution webhook)
//     → authorize → parse (adapter)          own / group / status refused
//     → ledger: own-outbound echo?           ECHO_OF_OWN_OUTBOUND
//     → ledger: claim event_id (O_EXCL)      DUPLICATE_INBOUND
//     → router: project → handler → decision (lib/router.js)
//     → policy: every send gate (lib/policy.js)
//     → [live only] adapter.sendReply through router.deliver()
//     → ledger: SENT | SEND_FAILED | SUPPRESSED
//
// `process()` never throws; it returns one record that is safe to log and
// to put in a task report: names, hashes, the masked recipient, the
// proposed text (the exact message a live run would send) — never the
// customer's text, never a token.
//
// Modes:
//   dry-run (default)   everything runs, nothing leaves; `proposed` is the
//                       exact message and `policy.rejections` the exact
//                       gates a live run would hit (MODE_DRY_RUN included).
//   live                only when the config says `auto_reply.mode: "live"`
//                       AND the project says `business.auto_reply: true`
//                       AND every other gate passes. `forceDryRun` (CLI)
//                       wins over both.
// =====================================================

var fs = require('fs');

var envelope = require('./envelope');
var projects = require('./projects');
var router = require('./router');
var crmRegistry = require('./crm');
var policy = require('./policy');
var ledgerLib = require('./ledger');
var redact = require('../../../mythos-orchestrator/lib/redact');

// A `*_file` credential: read at use, checked for a private mode, never
// returned in any record — only `present` / the error name is.
function loadSecret(file) {
  if (!file) return { present: false, error: 'NOT_CONFIGURED', value: null };
  try {
    var full = projects.expandHome(file);
    var st = fs.statSync(full);
    if ((st.mode & 0o077) !== 0) return { present: false, error: 'FILE_MODE_NOT_0600', value: null };
    var v = fs.readFileSync(full, 'utf8').trim();
    if (!v) return { present: false, error: 'FILE_EMPTY', value: null };
    return { present: true, error: null, value: v };
  } catch (e) {
    return { present: false, error: 'FILE_UNREADABLE', value: null };
  }
}

function conversationKey(env) {
  var c = env.crm || {};
  return [env.project_id || '', c.adapter || '', c.account_id || '', c.inbox_id || '', c.conversation_id || ''].join('\0');
}

// process(o) → Promise<record>
//   o = { cfg, body, query, headers, expectedToken, apiToken, ledger,
//         business_data, ai, forceDryRun, now, handlers, timeoutMs }
function handle(o) {
  o = o || {};
  var cfg = o.cfg || {};
  var eng = projects.engine(cfg);
  if (o.forceDryRun) eng = Object.assign({}, eng, { mode: 'dry-run' });
  var ledger = o.ledger || ledgerLib.open(eng.state_dir ? { dir: projects.expandHome(eng.state_dir) } : { memory: true });
  var now = o.now || Date.now();
  var record = {
    schema: 'mythos-auto-reply-outcome/1',
    mode: eng.mode,
    outcome: null, reason: null, stage: null,
    event_id: null, project_id: null,
    envelope: null, decision: null,
    policy: null, proposed: null,
    sent: false, send: null,
    ledger_state: null
  };
  var done = function (outcome, reason, stage) {
    record.outcome = outcome; record.reason = reason; record.stage = stage;
    return redact.redactValue(record);
  };

  var adapter = crmRegistry.get(cfg.crm && cfg.crm.adapter);
  if (!adapter) return Promise.resolve(done('REJECTED', 'CRM_ADAPTER_UNKNOWN', 'adapter'));
  var auth = adapter.authorizeWebhook({ query: o.query, headers: o.headers, expectedToken: o.expectedToken });
  if (!auth.ok) return Promise.resolve(done('UNAUTHORIZED', auth.reason, 'authorize'));
  var parsed = adapter.parseWebhook(o.body);
  if (!parsed.accepted) return Promise.resolve(done('IGNORED', parsed.reason, 'parse'));

  var env = parsed.envelope;
  record.event_id = env.event_id;
  record.envelope = envelope.summary(env);

  // Loop safety: a message whose provider id we produced is our own echo,
  // whatever the provider says about `fromMe`.
  if (ledger.isOwnOutbound(env.crm.adapter, env.crm.message_id)) return Promise.resolve(done('IGNORED', 'ECHO_OF_OWN_OUTBOUND', 'ledger'));

  // Idempotency: one record per inbound, claimed before any work. A retry
  // of the same webhook — during or after the first run — stops here.
  var claim = ledger.claim(env.event_id, { adapter: env.crm.adapter, inbox_id: env.crm.inbox_id, message_id: env.crm.message_id, mode: eng.mode });
  if (!claim.ok) {
    record.ledger_state = claim.existing ? claim.existing.state : null;
    return Promise.resolve(done('IGNORED', claim.reason, 'ledger'));
  }
  record.ledger_state = 'RECEIVED';

  return router.route(env, cfg, { handlers: o.handlers, business_data: o.business_data, ai: o.ai || eng.ai, engine: eng, handlerTimeoutMs: o.handlerTimeoutMs }).then(function (r) {
    record.project_id = r.project_id;
    record.decision = r.decision;
    if (r.outcome !== 'ROUTED') {
      record.ledger_state = ledger.update(env.event_id, { state: 'SUPPRESSED', outcome: r.outcome, reason: r.reason }).state;
      return done(r.outcome, r.reason, 'route');
    }
    var project = projects.resolve(cfg, { account_id: env.crm.account_id, inbox_id: env.crm.inbox_id });
    var pol = projects.policy(project);
    var breaker = ledger.provider();
    var convKey = conversationKey(r.envelope);
    var ev = policy.evaluate({
      routed: r,
      engine: eng,
      policy: pol,
      provider: { configured: !!(cfg.crm && cfg.crm.base_url), credential_present: typeof o.apiToken === 'string' && o.apiToken.length > 0, breaker: breaker },
      replies_last_hour: ledger.countReplies(convKey, ledgerLib.HOUR_MS, now),
      now: now
    });
    record.policy = { allowed: ev.allowed, rejections: ev.rejections, mode: ev.mode };
    record.proposed = ev.proposed;
    ledger.update(env.event_id, { state: 'DECIDED', project_id: r.project_id, action: r.decision.action, decision_reason: r.decision.reason, intent: r.decision.intent || null, rejections: ev.rejections });

    if (!ev.allowed) {
      record.ledger_state = ledger.update(env.event_id, { state: 'SUPPRESSED' }).state;
      return done('DECIDED', ev.rejections[0], 'policy');
    }

    // Live send. SENDING is written before the request so a crash between
    // the two leaves a record that is never retried automatically.
    record.ledger_state = ledger.update(env.event_id, { state: 'SENDING', sending_at: new Date(now).toISOString() }).state;
    return router.deliver({ cfg: cfg, routed: r, apiToken: o.apiToken, timeoutMs: o.timeoutMs }).then(function (res) {
      record.send = { ok: res.ok, status: res.status, crm_message_id: res.crm_message_id, error: res.error };
      if (res.ok) {
        ledger.recordOutbound(env.crm.adapter, res.crm_message_id, env.event_id);
        ledger.recordReply(convKey, now);
        ledger.recordProviderSuccess();
        record.ledger_state = ledger.update(env.event_id, { state: 'SENT', crm_message_id: res.crm_message_id, sent_at: new Date().toISOString() }).state;
        record.sent = true;
        return done('SENT', null, 'deliver');
      }
      var b = ledger.recordProviderFailure(res.error, eng.provider_failure_threshold, eng.provider_cooldown_ms, now);
      record.ledger_state = ledger.update(env.event_id, { state: 'SEND_FAILED', error: String(res.error || '').slice(0, 120) }).state;
      record.provider_breaker = { failures: b.failures, open: b.open_until > now };
      return done('SEND_FAILED', 'PROVIDER_ERROR', 'deliver');
    });
  }).catch(function (e) {
    try { ledger.update(env.event_id, { state: 'SUPPRESSED', error: 'ENGINE_ERROR' }); } catch (_) { /* keep the outcome */ }
    record.ledger_state = 'SUPPRESSED';
    return done('FAILED', 'ENGINE_ERROR:' + (e && e.message && /^[A-Z_]{3,40}$/.test(e.message) ? e.message : 'INTERNAL'), 'engine');
  });
}

// Readiness of the configured path without touching the provider: what an
// operator (or the receiver at start-up) checks before turning `live` on.
function readiness(cfg) {
  var eng = projects.engine(cfg);
  var problems = projects.validate(cfg);
  var web = loadSecret(cfg.crm && cfg.crm.webhook_token_file);
  var api = loadSecret(cfg.crm && cfg.crm.api_token_file);
  var aiKey = eng.ai.generator === 'advisory' ? loadSecret(eng.ai.key_file) : null;
  var live = (cfg.projects || []).filter(function (p) { return p && p.business && p.business.auto_reply === true; }).map(function (p) { return p.id; });
  return {
    config_problems: problems,
    mode: eng.mode,
    state_dir_set: !!eng.state_dir,
    webhook_token: web.present ? 'present' : web.error,
    api_token: api.present ? 'present' : api.error,
    ai: { generator: eng.ai.generator, key: aiKey ? (aiKey.present ? 'present' : aiKey.error) : 'not needed' },
    projects_auto_reply_on: live,
    can_send: problems.length === 0 && eng.mode === 'live' && api.present && live.length > 0 && !!eng.state_dir
  };
}

module.exports = { loadSecret: loadSecret, conversationKey: conversationKey, process: handle, readiness: readiness };
