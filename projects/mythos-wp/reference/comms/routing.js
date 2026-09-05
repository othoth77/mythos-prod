'use strict';
// =====================================================
// MYTHOS WP — Communication Core: shared-account routing & privacy guard
// (MYTHOS-COMMS-11, #228)
//
//   WhatsApp account → ONE provider instance (one session) → provider → PRIVACY
//   GUARD → routing policy → logical inbox → project.
//
// The instance identifies the SESSION, never the service. For a `dedicated`
// instance (exactly one inbox, COMMS-1..9 behaviour) the inbox is the instance.
// For a `shared` instance the sender's identities are matched against
// explicit routing rules (wp_inbox_routes); no rule = DROP. There is no
// "default inbox" and no keyword-only path: an opt-in rule always names the
// identity in advance and may additionally require a token in the text.
//
// resolve(pool, provider, instance, ev) → Promise<decision>
//   { routed: true,  inbox, rule, activated }          — persist/dry-run as usual
//   { routed: false, reason, inboxes, identity_sha256 } — caller must NOT ledger
//                                                        any content (see receiver)
// Reasons (all fail closed): INBOX_UNKNOWN, ROUTING_AMBIGUOUS, OWNER_EXCLUDED,
//   IDENTITY_MISSING, UNROUTED, RULE_MALFORMED, RULE_EXPIRED, TOKEN_REQUIRED.
// Only a `routed` decision ever reaches core.ingest. dropAudit() keeps hashes only.
// =====================================================
var crypto = require('crypto');
var core = require('./core');
var KINDS = { allowlist: true, opt_in: true };
var IDENTITY_KINDS = { phone: true, lid: true, bsuid: true, provider_user: true };
var VALUE_RE = /^[A-Za-z0-9:_.@+-]{3,128}$/;
var TOKEN_RE = /^[A-Za-z0-9-]{6,64}$/;

function sha(s) { return crypto.createHash('sha256').update(String(s)).digest('hex'); }
function identitySha(instance, ids) { var first = ids && ids[0]; return first ? sha(first.kind + ':' + first.value + ':' + instance) : null; }

function fail(kind, status, message) { var e = new Error(message); e.kind = kind; e.status = status; return e; }
function nowMs() { return Date.now(); }

// inboxesOn(pool, provider, instance) → all inboxes hosted by the instance (0, 1 or n)
function inboxesOn(pool, provider, instance) {
  return pool.query('SELECT id, project_id, provider, instance, status, inbound_enabled, outbound_enabled, account_mode, account_ref, settings FROM wp_inboxes WHERE provider = $1 AND instance = $2 ORDER BY id', [provider, instance]).then(function (r) { return r.rows; });
}

// ruleIsSane(rule) — a malformed row (unexpected kind/identity shape) fails closed
function ruleIsSane(rule) {
  return rule && KINDS[rule.kind] === true && IDENTITY_KINDS[rule.identity_kind] === true && VALUE_RE.test(String(rule.identity_value || '')) && (rule.opt_in_code === null || rule.opt_in_code === undefined || TOKEN_RE.test(String(rule.opt_in_code))) && rule.enabled === true;
}

// decide(inboxes, rules, ev, o) — pure function, unit-testable
function decide(inboxes, rules, ev, o) {
  o = o || {};
  if (!inboxes || !inboxes.length) return { routed: false, reason: 'INBOX_UNKNOWN', inboxes: [] };
  var shared = inboxes.filter(function (i) { return i.account_mode === 'shared'; });
  var dedicated = inboxes.filter(function (i) { return i.account_mode !== 'shared'; });
  // COMMS-1..9 semantics: one dedicated inbox owns the instance
  if (!shared.length && dedicated.length === 1) return { routed: true, inbox: dedicated[0], rule: null, activated: false, mode: 'dedicated' };
  // any mixture (dedicated + others) is a misconfiguration → fail closed
  if (dedicated.length) return { routed: false, reason: 'ROUTING_AMBIGUOUS', inboxes: inboxes };
  var ids = core.identitiesOf(ev);
  if (!ids.length) return { routed: false, reason: 'IDENTITY_MISSING', inboxes: inboxes };
  // owner / reserved exclusion: the account itself can never be a customer of its own inbox
  var owners = {}; shared.forEach(function (i) { if (i.account_ref) owners[i.account_ref] = true; });
  (o.reserved || []).forEach(function (a) { owners[a] = true; });
  if (ids.some(function (i) { return i.kind === 'phone' && owners[i.value]; })) return { routed: false, reason: 'OWNER_EXCLUDED', inboxes: inboxes };
  var byInbox = {}; shared.forEach(function (i) { byInbox[String(i.id)] = i; });
  var text = typeof ev.text === 'string' ? ev.text : '';
  var candidates = (rules || []).filter(function (r) {
    if (!r || r.enabled !== true) return false;                                     // disabled rules are simply absent (deny)
    return ids.some(function (i) { return i.kind === r.identity_kind && i.value === r.identity_value; });
  }).sort(function (a, b) { return (a.priority - b.priority) || (Number(a.id) - Number(b.id)); });
  var reason = 'UNROUTED';
  for (var k = 0; k < candidates.length; k++) {
    var r = candidates[k];
    if (!ruleIsSane(r)) { reason = 'RULE_MALFORMED'; continue; }                        // fail closed, keep looking only at sane rules
    var target = byInbox[String(r.inbox_id)];
    if (!target || target.project_id !== r.project_id) { reason = 'RULE_MALFORMED'; continue; } // never route across projects/instances
    if (r.kind === 'allowlist') return { routed: true, inbox: target, rule: r, activated: false, mode: 'shared' };
    // opt_in: pre-registered identity; window; optional token as a SECOND factor
    if (r.activated_at) return { routed: true, inbox: target, rule: r, activated: false, mode: 'shared' };
    if (r.expires_at && new Date(r.expires_at).getTime() < (o.now || nowMs())) { reason = 'RULE_EXPIRED'; continue; }
    if (r.opt_in_code && text.indexOf(r.opt_in_code) === -1) { reason = 'TOKEN_REQUIRED'; continue; }
    return { routed: true, inbox: target, rule: r, activated: true, mode: 'shared' };
  }
  return { routed: false, reason: reason, inboxes: inboxes };
}

// resolve(pool, provider, instance, ev) → decision (DB-backed). Activates an opt_in rule on first routed inbound.
function resolve(pool, provider, instance, ev) {
  return inboxesOn(pool, provider, instance).then(function (inboxes) {
    if (!inboxes.length || !inboxes.some(function (i) { return i.account_mode === 'shared'; })) return { inboxes: inboxes, rules: [], reserved: [] };
    var ids = core.identitiesOf(ev);
    if (!ids.length) return { inboxes: inboxes, rules: [], reserved: [] };
    var params = [provider, instance]; var pairs = ids.map(function (i) { params.push(i.kind, i.value); return '($' + (params.length - 1) + ', $' + params.length + ')'; });
    return Promise.all([
      pool.query('SELECT * FROM wp_inbox_routes WHERE provider = $1 AND instance = $2 AND enabled = true AND (identity_kind, identity_value) IN (' + pairs.join(', ') + ') ORDER BY priority, id', params),
      pool.query('SELECT account_ref FROM wp_reserved_accounts')
    ]).then(function (x) { return { inboxes: inboxes, rules: x[0].rows, reserved: x[1].rows.map(function (r) { return r.account_ref; }) }; });
  }).then(function (ctx) {
    var d = decide(ctx.inboxes, ctx.rules, ev, { reserved: ctx.reserved });
    d.identity_sha256 = identitySha(instance, core.identitiesOf(ev));
    if (!d.routed || !d.activated) return d;
    return pool.query('UPDATE wp_inbox_routes SET activated_at = now() WHERE id = $1 AND activated_at IS NULL', [d.rule.id])
      .then(function () { return pool.query("INSERT INTO wp_audit_events (actor, action, resource, record_id, project_id, next) VALUES ('system:routing', 'update', 'inbox_routes', $1, $2, $3)", [String(d.rule.id), d.inbox.project_id, JSON.stringify({ activated: true, kind: 'opt_in', inbox_id: d.inbox.id, identity_sha256: d.identity_sha256 })]); })
      .then(function () { return d; });
  });
}

// dropAudit(pool, rec) — the ONLY persistence allowed for a dropped event: hashes, decision, reason. No content, no ids.
function dropAudit(pool, rec) {
  return pool.query('INSERT INTO wp_routing_drops (provider, instance, decision, reason, identity_sha256, payload_sha256) VALUES ($1,$2,\'drop\',$3,$4,$5) RETURNING id', [rec.provider, String(rec.instance || '').slice(0, 64), String(rec.reason || 'UNROUTED').slice(0, 48), rec.identity_sha256 || null, rec.payload_sha256 || null]).then(function (r) { return r.rows[0].id; });
}

// ---- rule management (CLI / API). Always project-scoped: the inbox must belong to the project.
function addRule(pool, projectId, o, actor) {
  o = o || {};
  if (!KINDS[o.kind]) throw fail('validation', 400, 'kind must be allowlist|opt_in');
  if (!IDENTITY_KINDS[o.identity_kind]) throw fail('validation', 400, 'identity_kind must be phone|lid|bsuid|provider_user');
  if (!VALUE_RE.test(String(o.identity_value || ''))) throw fail('validation', 400, 'identity_value shape');
  if (o.opt_in_code && !TOKEN_RE.test(String(o.opt_in_code))) throw fail('validation', 400, 'opt_in_code shape');
  var inboxId = parseInt(o.inbox_id, 10); if (!inboxId) throw fail('validation', 400, 'inbox_id required');
  return pool.query('SELECT id, project_id, provider, instance, account_mode FROM wp_inboxes WHERE id = $1 AND project_id = $2', [inboxId, projectId]).then(function (r) {
    var ib = r.rows[0];
    if (!ib) throw fail('not_found', 404, 'inbox not found in this project');
    if (ib.account_mode !== 'shared') throw fail('precondition', 412, 'routing rules apply to shared-account inboxes only');
    var expires = o.kind === 'opt_in' ? (o.expires_at ? new Date(o.expires_at) : new Date(nowMs() + (parseInt(o.ttl_hours, 10) || 72) * 3600000)) : null;
    return pool.query('INSERT INTO wp_inbox_routes (project_id, inbox_id, provider, instance, kind, identity_kind, identity_value, priority, enabled, opt_in_code, expires_at, note, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,$9,$10,$11,$12) RETURNING id, kind, identity_kind, priority, enabled, expires_at, created_at',
      [projectId, ib.id, ib.provider, ib.instance, o.kind, o.identity_kind, String(o.identity_value), Math.min(10000, Math.max(0, parseInt(o.priority, 10) || 100)), o.opt_in_code || null, expires, o.note ? String(o.note).slice(0, 200) : null, actor || 'system'])
      .then(function (x) {
        var row = x.rows[0];
        return pool.query("INSERT INTO wp_audit_events (actor, action, resource, record_id, project_id, next) VALUES ($1, 'create', 'inbox_routes', $2, $3, $4)", [actor || 'system', String(row.id), projectId, JSON.stringify({ kind: o.kind, identity_kind: o.identity_kind, identity_sha256: sha(o.identity_kind + ':' + o.identity_value + ':' + ib.instance), inbox_id: ib.id, expires_at: expires })]).then(function () { return row; });
      }, function (e) {
        if (/wp_inbox_routes_owner_excluded/.test(e.message)) throw fail('precondition', 412, 'the account owner cannot be routed as a customer');
        if (/wp_inbox_routes_one_target/.test(e.message)) throw fail('conflict', 409, 'this identity already has a route on this instance');
        throw e;
      });
  });
}
function listRules(pool, projectId, o) {
  o = o || {};
  var params = [projectId]; var where = ['r.project_id = $1'];
  if (o.inbox_id) { params.push(parseInt(o.inbox_id, 10)); where.push('r.inbox_id = $' + params.length); }
  return pool.query('SELECT r.id, r.inbox_id, r.provider, r.instance, r.kind, r.identity_kind, right(r.identity_value, 4) AS identity_tail, r.priority, r.enabled, r.opt_in_code IS NOT NULL AS code_required, r.expires_at, r.activated_at, r.note, r.created_by, r.created_at FROM wp_inbox_routes r WHERE ' + where.join(' AND ') + ' ORDER BY r.priority, r.id', params).then(function (r) { return r.rows; });
}
function setRuleEnabled(pool, projectId, ruleId, enabled, actor) {
  var id = parseInt(ruleId, 10); if (!id) throw fail('validation', 400, 'rule id required');
  return pool.query('UPDATE wp_inbox_routes SET enabled = $3 WHERE id = $1 AND project_id = $2 RETURNING id, enabled', [id, projectId, enabled === true]).then(function (r) {
    if (!r.rows[0]) throw fail('not_found', 404, 'rule not found in this project');
    return pool.query("INSERT INTO wp_audit_events (actor, action, resource, record_id, project_id, next) VALUES ($1, 'update', 'inbox_routes', $2, $3, $4)", [actor || 'system', String(id), projectId, JSON.stringify({ enabled: enabled === true })]).then(function () { return r.rows[0]; });
  });
}
function listDrops(pool, o) {
  o = o || {};
  return pool.query('SELECT id, at, provider, instance, reason, identity_sha256 IS NOT NULL AS has_identity_hash FROM wp_routing_drops ORDER BY id DESC LIMIT $1', [Math.min(500, Math.max(1, parseInt(o.limit, 10) || 50))]).then(function (r) { return r.rows; });
}

// createSharedInbox(pool, projectId, o, actor) — the explicit, audited way to declare a logical inbox on a shared
// account (the DB trigger enforces: account_ref present, reserved account only with opt-in, no dedicated neighbour).
function createSharedInbox(pool, projectId, o, actor) {
  o = o || {};
  if (!/^[a-z0-9][a-z0-9_-]{1,62}$/.test(String(o.instance || ''))) throw fail('validation', 400, 'instance shape');
  if (!/^[0-9]{6,32}$/.test(String(o.account_ref || ''))) throw fail('validation', 400, 'account_ref (digits) required for a shared inbox');
  if (!o.display_name) throw fail('validation', 400, 'display_name required');
  return pool.query("INSERT INTO wp_inboxes (project_id, provider, instance, display_name, phone_masked, account_ref, account_mode, settings, status) VALUES ($1,$2,$3,$4,$5,$6,'shared',$7,'inactive') RETURNING id, project_id, provider, instance, account_mode, inbound_enabled, outbound_enabled, status",
    [projectId, o.provider || 'evolution', o.instance, String(o.display_name).slice(0, 120), '***' + String(o.account_ref).slice(-4), String(o.account_ref), JSON.stringify(Object.assign({}, o.settings || {}, { allow_personal_account: true }))])
    .then(function (r) { return pool.query("INSERT INTO wp_audit_events (actor, action, resource, record_id, project_id, next) VALUES ($1, 'create', 'inboxes', $2, $3, $4)", [actor || 'system', String(r.rows[0].id), projectId, JSON.stringify({ account_mode: 'shared', instance: o.instance, account_ref_masked: '…' + String(o.account_ref).slice(-4) })]).then(function () { return r.rows[0]; }); },
      function (e) { if (/wp_inboxes_(account_reserved|dedicated_uidx|shared_needs_account|not_bridge)/.test(e.message + (e.constraint || ''))) throw fail('precondition', 412, e.message); throw e; });
}

module.exports = { createSharedInbox: createSharedInbox, resolve: resolve, decide: decide, inboxesOn: inboxesOn, dropAudit: dropAudit, addRule: addRule, listRules: listRules, setRuleEnabled: setRuleEnabled, listDrops: listDrops, ruleIsSane: ruleIsSane, sha: sha };
