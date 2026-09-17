'use strict';
// =====================================================
// MYTHOS WP — Communication Core: shared-account routing & privacy guard
// (MYTHOS-COMMS-11, #228 — extended by MYTHOS WP V2: sticky / keyword / default)
//
//   WhatsApp account → ONE provider instance (one session) → provider → PRIVACY
//   GUARD → routing policy → logical inbox → project.
//
// The instance identifies the SESSION, never the service. For a `dedicated`
// instance (exactly one inbox, COMMS-1..9 behaviour) the inbox is the instance.
// For a `shared` instance the decision order is:
//   dedicated → sticky (a live conversation of the sender on one of the shared
//   inboxes) → identity rules allowlist / opt_in → keyword (entry token in the
//   text) → default → DROP.
// A PERSONAL number (wp_phone_numbers.is_personal, fallback: reserved account)
// is identity-only: sticky, keyword and default are ignored at decision time
// and keyword/default rules are refused at creation (412). No rule = DROP.
//
// resolve(pool, provider, instance, ev) → Promise<decision>
//   { routed: true,  inbox, rule, activated, mode }   — mode: dedicated|rule|sticky|keyword|default
//   { routed: false, reason, inboxes, identity_sha256 } — caller must NOT ledger
//                                                        any content (see receiver)
// Reasons (all fail closed): INBOX_UNKNOWN, ROUTING_AMBIGUOUS, OWNER_EXCLUDED,
//   IDENTITY_MISSING, UNROUTED, RULE_MALFORMED, RULE_EXPIRED, TOKEN_REQUIRED.
// Only a `routed` decision ever reaches core.ingest. dropAudit() keeps hashes only.
// simulate(pool, provider, instance, ev) = the same decision without any write.
// =====================================================
var crypto = require('crypto');
var core = require('./core');
var KINDS = { allowlist: true, opt_in: true, keyword: true, default: true };
var IDENTITY_KINDS = { phone: true, lid: true, bsuid: true, provider_user: true };
var ENTRY_KINDS = { entry: true, any: true };
var VALUE_RE = /^[A-Za-z0-9:_.@+-]{3,128}$/;
var ENTRY_RE = /^[a-z0-9#*_-]{2,64}$/;
var TOKEN_RE = /^[A-Za-z0-9-]{6,64}$/;
var LIVE_STATUSES = "('open','pending','waiting_customer','needs_human')";

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
  if (!rule || KINDS[rule.kind] !== true || rule.enabled !== true) return false;
  var v = String(rule.identity_value || '');
  if (rule.kind === 'keyword') return rule.identity_kind === 'entry' && ENTRY_RE.test(v);
  if (rule.kind === 'default') return rule.identity_kind === 'any' && v === '*';
  return IDENTITY_KINDS[rule.identity_kind] === true && VALUE_RE.test(v) && (rule.opt_in_code === null || rule.opt_in_code === undefined || TOKEN_RE.test(String(rule.opt_in_code)));
}
function byPriority(a, b) { return (a.priority - b.priority) || (Number(a.id) - Number(b.id)); }

// decide(inboxes, rules, ev, o) — pure function, unit-testable
//   o = { reserved: [account_ref], now, personal: boolean, sticky: [{ conversation_id, inbox_id }] }
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
  var personal = o.personal === true;
  var byInbox = {}; shared.forEach(function (i) { byInbox[String(i.id)] = i; });
  var text = typeof ev.text === 'string' ? ev.text : '';
  // sticky: the sender already talks to one of the shared inboxes → same inbox (never on a personal number)
  if (!personal && Array.isArray(o.sticky)) {
    for (var s = 0; s < o.sticky.length; s++) {
      var st = byInbox[String(o.sticky[s].inbox_id)];
      if (st) return { routed: true, inbox: st, rule: null, activated: false, mode: 'sticky', conversation_id: o.sticky[s].conversation_id };
    }
  }
  var candidates = (rules || []).filter(function (r) {
    if (!r || r.enabled !== true) return false;                                     // disabled rules are simply absent (deny)
    if (r.kind === 'keyword' || r.kind === 'default') return false;                  // handled after the identity rules
    return ids.some(function (i) { return i.kind === r.identity_kind && i.value === r.identity_value; });
  }).sort(byPriority);
  var reason = 'UNROUTED';
  for (var k = 0; k < candidates.length; k++) {
    var r = candidates[k];
    if (!ruleIsSane(r)) { reason = 'RULE_MALFORMED'; continue; }                        // fail closed, keep looking only at sane rules
    var target = byInbox[String(r.inbox_id)];
    if (!target || target.project_id !== r.project_id) { reason = 'RULE_MALFORMED'; continue; } // never route across projects/instances
    if (r.kind === 'allowlist') return { routed: true, inbox: target, rule: r, activated: false, mode: 'rule' };
    // opt_in: pre-registered identity; window; optional token as a SECOND factor
    if (r.activated_at) return { routed: true, inbox: target, rule: r, activated: false, mode: 'rule' };
    if (r.expires_at && new Date(r.expires_at).getTime() < (o.now || nowMs())) { reason = 'RULE_EXPIRED'; continue; }
    if (r.opt_in_code && text.indexOf(r.opt_in_code) === -1) { reason = 'TOKEN_REQUIRED'; continue; }
    return { routed: true, inbox: target, rule: r, activated: true, mode: 'rule' };
  }
  if (personal) return { routed: false, reason: reason, inboxes: inboxes };            // identity-only: no keyword, no default
  // keyword: an entry token contained in the (lower-cased) text; lowest priority value wins
  var lower = text.toLowerCase();
  var keywords = (rules || []).filter(function (r) { return r && r.kind === 'keyword' && r.enabled === true; }).sort(byPriority);
  for (var w = 0; w < keywords.length; w++) {
    var kw = keywords[w];
    if (!ruleIsSane(kw)) { reason = 'RULE_MALFORMED'; continue; }
    var kt = byInbox[String(kw.inbox_id)];
    if (!kt || kt.project_id !== kw.project_id) { reason = 'RULE_MALFORMED'; continue; }
    if (lower.indexOf(kw.identity_value) !== -1) return { routed: true, inbox: kt, rule: kw, activated: false, mode: 'keyword' };
  }
  // default: at most one per instance (schema unique on (instance, 'any', '*'))
  var defaults = (rules || []).filter(function (r) { return r && r.kind === 'default' && r.enabled === true; }).sort(byPriority);
  for (var d = 0; d < defaults.length; d++) {
    var df = defaults[d];
    if (!ruleIsSane(df)) { reason = 'RULE_MALFORMED'; continue; }
    var dt = byInbox[String(df.inbox_id)];
    if (!dt || dt.project_id !== df.project_id) { reason = 'RULE_MALFORMED'; continue; }
    return { routed: true, inbox: dt, rule: df, activated: false, mode: 'default' };
  }
  return { routed: false, reason: reason, inboxes: inboxes };
}

// isPersonal(pool, provider, instance, inboxes, reserved) — wp_phone_numbers.is_personal; fallback: reserved account ⇒ personal
function isPersonal(pool, provider, instance, inboxes, reserved) {
  return pool.query('SELECT is_personal FROM wp_phone_numbers WHERE provider = $1 AND instance = $2', [provider, instance]).then(function (r) {
    if (r.rows[0]) return r.rows[0].is_personal === true;
    return inboxes.some(function (i) { return i.account_ref && reserved.indexOf(i.account_ref) !== -1; });
  }, function () { return inboxes.some(function (i) { return i.account_ref && reserved.indexOf(i.account_ref) !== -1; }); });
}
// stickyFor(pool, inboxes, ids) → [{ conversation_id, inbox_id }] live conversations of the sender on the shared inboxes, most recent first
function stickyFor(pool, inboxes, ids) {
  var inboxIds = inboxes.filter(function (i) { return i.account_mode === 'shared'; }).map(function (i) { return i.id; });
  if (!inboxIds.length || !ids.length) return Promise.resolve([]);
  var params = [inboxIds]; var pairs = ids.map(function (i) { params.push(i.kind, i.value); return '($' + (params.length - 1) + ', $' + params.length + ')'; });
  var phones = ids.filter(function (i) { return i.kind === 'phone'; }).map(function (i) { return i.value; });
  params.push(phones.length ? phones : ['-']);
  return pool.query('SELECT c.id AS conversation_id, c.inbox_id FROM wp_conversations c JOIN wp_contacts k ON k.id = c.contact_id WHERE c.inbox_id = ANY($1::bigint[]) AND c.status IN ' + LIVE_STATUSES + ' AND (k.wa_id = ANY($' + params.length + '::text[]) OR EXISTS (SELECT 1 FROM wp_contact_identities ci WHERE ci.contact_id = k.id AND (ci.kind, ci.value) IN (' + pairs.join(', ') + '))) ORDER BY c.last_message_at DESC NULLS LAST, c.id DESC LIMIT 3', params)
    .then(function (r) { return r.rows; });
}
// context(pool, provider, instance, ev) → { inboxes, rules, reserved, personal, sticky }
function context(pool, provider, instance, ev) {
  return inboxesOn(pool, provider, instance).then(function (inboxes) {
    if (!inboxes.length || !inboxes.some(function (i) { return i.account_mode === 'shared'; })) return { inboxes: inboxes, rules: [], reserved: [], personal: false, sticky: [] };
    var ids = core.identitiesOf(ev);
    if (!ids.length) return { inboxes: inboxes, rules: [], reserved: [], personal: false, sticky: [] };
    var params = [provider, instance]; var pairs = ids.map(function (i) { params.push(i.kind, i.value); return '($' + (params.length - 1) + ', $' + params.length + ')'; });
    return Promise.all([
      pool.query("SELECT * FROM wp_inbox_routes WHERE provider = $1 AND instance = $2 AND enabled = true AND ((identity_kind, identity_value) IN (" + pairs.join(', ') + ") OR identity_kind IN ('entry', 'any')) ORDER BY priority, id", params),
      pool.query('SELECT account_ref FROM wp_reserved_accounts')
    ]).then(function (x) {
      var reserved = x[1].rows.map(function (r) { return r.account_ref; });
      return isPersonal(pool, provider, instance, inboxes, reserved).then(function (personal) {
        return (personal ? Promise.resolve([]) : stickyFor(pool, inboxes, ids)).then(function (sticky) { return { inboxes: inboxes, rules: x[0].rows, reserved: reserved, personal: personal, sticky: sticky }; });
      });
    });
  });
}

// resolve(pool, provider, instance, ev) → decision (DB-backed). Activates an opt_in rule on first routed inbound.
function resolve(pool, provider, instance, ev) {
  return context(pool, provider, instance, ev).then(function (ctx) {
    var d = decide(ctx.inboxes, ctx.rules, ev, { reserved: ctx.reserved, personal: ctx.personal, sticky: ctx.sticky });
    d.identity_sha256 = identitySha(instance, core.identitiesOf(ev));
    d.personal = ctx.personal;
    if (!d.routed || !d.activated) return d;
    return pool.query('UPDATE wp_inbox_routes SET activated_at = now() WHERE id = $1 AND activated_at IS NULL', [d.rule.id])
      .then(function () { return pool.query("INSERT INTO wp_audit_events (actor, action, resource, record_id, project_id, next) VALUES ('system:routing', 'update', 'inbox_routes', $1, $2, $3)", [String(d.rule.id), d.inbox.project_id, JSON.stringify({ activated: true, kind: 'opt_in', inbox_id: d.inbox.id, identity_sha256: d.identity_sha256 })]); })
      .then(function () { return d; });
  });
}
// simulate(pool, provider, instance, ev) → the same decision, no write, no ledger, no activation
function simulate(pool, provider, instance, ev) {
  return context(pool, provider, instance, ev).then(function (ctx) {
    var d = decide(ctx.inboxes, ctx.rules, ev, { reserved: ctx.reserved, personal: ctx.personal, sticky: ctx.sticky });
    return { routed: d.routed === true, mode: d.routed ? d.mode : null, reason: d.routed ? null : d.reason, project_id: d.routed ? d.inbox.project_id : null, inbox_id: d.routed ? d.inbox.id : null, rule_id: d.routed && d.rule ? d.rule.id : null, personal: ctx.personal, would_activate: d.activated === true };
  });
}

// dropAudit(pool, rec) — the ONLY persistence allowed for a dropped event: hashes, decision, reason. No content, no ids.
function dropAudit(pool, rec) {
  return pool.query('INSERT INTO wp_routing_drops (provider, instance, decision, reason, identity_sha256, payload_sha256) VALUES ($1,$2,\'drop\',$3,$4,$5) RETURNING id', [rec.provider, String(rec.instance || '').slice(0, 64), String(rec.reason || 'UNROUTED').slice(0, 48), rec.identity_sha256 || null, rec.payload_sha256 || null]).then(function (r) { return r.rows[0].id; });
}

// numberIsPersonal(pool, inbox) — creation-time guard for keyword/default rules
function numberIsPersonal(pool, ib) {
  return Promise.all([
    pool.query('SELECT is_personal FROM wp_phone_numbers WHERE provider = $1 AND instance = $2', [ib.provider, ib.instance]),
    ib.account_ref ? pool.query('SELECT 1 FROM wp_reserved_accounts WHERE account_ref = $1', [ib.account_ref]) : Promise.resolve({ rows: [] })
  ]).then(function (x) { if (x[0].rows[0]) return x[0].rows[0].is_personal === true; return x[1].rows.length > 0; });
}

// ---- rule management (CLI / API). Always project-scoped: the inbox must belong to the project.
function addRule(pool, projectId, o, actor) {
  o = o || {};
  if (!KINDS[o.kind]) throw fail('validation', 400, 'kind must be allowlist|opt_in|keyword|default');
  var identityKind, identityValue;
  if (o.kind === 'keyword') {
    identityKind = 'entry'; identityValue = String(o.identity_value === undefined ? (o.entry || '') : o.identity_value).trim().toLowerCase();
    if (o.identity_kind && o.identity_kind !== 'entry') throw fail('validation', 400, 'a keyword rule uses identity_kind entry');
    if (!ENTRY_RE.test(identityValue)) throw fail('validation', 400, 'entry token: 2–64 chars, lowercase letters, digits, # * _ -');
  } else if (o.kind === 'default') {
    identityKind = 'any'; identityValue = '*';
    if (o.identity_kind && o.identity_kind !== 'any') throw fail('validation', 400, 'a default rule uses identity_kind any');
    if (o.identity_value !== undefined && o.identity_value !== null && o.identity_value !== '*') throw fail('validation', 400, 'a default rule has identity_value *');
  } else {
    if (!IDENTITY_KINDS[o.identity_kind]) throw fail('validation', 400, 'identity_kind must be phone|lid|bsuid|provider_user');
    if (!VALUE_RE.test(String(o.identity_value || ''))) throw fail('validation', 400, 'identity_value shape');
    if (o.opt_in_code && !TOKEN_RE.test(String(o.opt_in_code))) throw fail('validation', 400, 'opt_in_code shape');
    identityKind = o.identity_kind; identityValue = String(o.identity_value);
  }
  var inboxId = parseInt(o.inbox_id, 10); if (!inboxId) throw fail('validation', 400, 'inbox_id required');
  return pool.query('SELECT id, project_id, provider, instance, account_mode, account_ref FROM wp_inboxes WHERE id = $1 AND project_id = $2', [inboxId, projectId]).then(function (r) {
    var ib = r.rows[0];
    if (!ib) throw fail('not_found', 404, 'inbox not found in this project');
    if (ib.account_mode !== 'shared') throw fail('precondition', 412, 'routing rules apply to shared-account inboxes only');
    var guard = (o.kind === 'keyword' || o.kind === 'default') ? numberIsPersonal(pool, ib).then(function (personal) { if (personal) throw fail('precondition', 412, 'a personal number routes by identity only: keyword/default rules are refused'); }) : Promise.resolve();
    return guard.then(function () {
      var expires = o.kind === 'opt_in' ? (o.expires_at ? new Date(o.expires_at) : new Date(nowMs() + (parseInt(o.ttl_hours, 10) || 72) * 3600000)) : null;
      var code = o.kind === 'opt_in' && o.opt_in_code ? o.opt_in_code : null;
      return pool.query('INSERT INTO wp_inbox_routes (project_id, inbox_id, provider, instance, kind, identity_kind, identity_value, priority, enabled, opt_in_code, expires_at, note, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,$9,$10,$11,$12) RETURNING id, kind, identity_kind, priority, enabled, expires_at, created_at',
        [projectId, ib.id, ib.provider, ib.instance, o.kind, identityKind, identityValue, Math.min(10000, Math.max(0, parseInt(o.priority, 10) || 100)), code, expires, o.note ? String(o.note).slice(0, 200) : null, actor || 'system'])
        .then(function (x) {
          var row = x.rows[0];
          if (ENTRY_KINDS[identityKind]) row.entry = identityValue;
          var next = { kind: o.kind, identity_kind: identityKind, inbox_id: ib.id, expires_at: expires };
          if (ENTRY_KINDS[identityKind]) next.entry = identityValue; else next.identity_sha256 = sha(identityKind + ':' + identityValue + ':' + ib.instance);
          return pool.query("INSERT INTO wp_audit_events (actor, action, resource, record_id, project_id, next) VALUES ($1, 'create', 'inbox_routes', $2, $3, $4)", [actor || 'system', String(row.id), projectId, JSON.stringify(next)]).then(function () { return row; });
        }, function (e) {
          if (/wp_inbox_routes_owner_excluded/.test(e.message)) throw fail('precondition', 412, 'the account owner cannot be routed as a customer');
          if (/wp_inbox_routes_one_target/.test(e.message)) throw fail('conflict', 409, o.kind === 'default' ? 'this instance already has a default route' : o.kind === 'keyword' ? 'this keyword already routes on this instance' : 'this identity already has a route on this instance');
          throw e;
        });
    });
  });
}
function listRules(pool, projectId, o) {
  o = o || {};
  var params = [projectId]; var where = ['r.project_id = $1'];
  if (o.inbox_id) { params.push(parseInt(o.inbox_id, 10)); where.push('r.inbox_id = $' + params.length); }
  return pool.query("SELECT r.id, r.inbox_id, r.provider, r.instance, r.kind, r.identity_kind, right(r.identity_value, 4) AS identity_tail, CASE WHEN r.identity_kind IN ('entry', 'any') THEN r.identity_value END AS entry, r.priority, r.enabled, r.opt_in_code IS NOT NULL AS code_required, r.expires_at, r.activated_at, r.note, r.created_by, r.created_at FROM wp_inbox_routes r WHERE " + where.join(' AND ') + ' ORDER BY r.priority, r.id', params).then(function (r) { return r.rows; });
}
function setRuleEnabled(pool, projectId, ruleId, enabled, actor) {
  var id = parseInt(ruleId, 10); if (!id) throw fail('validation', 400, 'rule id required');
  return pool.query('UPDATE wp_inbox_routes SET enabled = $3 WHERE id = $1 AND project_id = $2 RETURNING id, enabled', [id, projectId, enabled === true]).then(function (r) {
    if (!r.rows[0]) throw fail('not_found', 404, 'rule not found in this project');
    return pool.query("INSERT INTO wp_audit_events (actor, action, resource, record_id, project_id, next) VALUES ($1, 'update', 'inbox_routes', $2, $3, $4)", [actor || 'system', String(id), projectId, JSON.stringify({ enabled: enabled === true })]).then(function () { return r.rows[0]; });
  });
}
// removeRule(pool, projectId, ruleId, actor) → { id, deleted: true } (project-scoped; audited, no identity value in the audit)
function removeRule(pool, projectId, ruleId, actor) {
  var id = parseInt(ruleId, 10); if (!id) throw fail('validation', 400, 'rule id required');
  return pool.query('DELETE FROM wp_inbox_routes WHERE id = $1 AND project_id = $2 RETURNING id, kind, identity_kind, inbox_id', [id, projectId]).then(function (r) {
    if (!r.rows[0]) throw fail('not_found', 404, 'rule not found in this project');
    var row = r.rows[0];
    return pool.query("INSERT INTO wp_audit_events (actor, action, resource, record_id, project_id, next) VALUES ($1, 'delete', 'inbox_routes', $2, $3, $4)", [actor || 'system', String(id), projectId, JSON.stringify({ deleted: true, kind: row.kind, identity_kind: row.identity_kind, inbox_id: row.inbox_id })]).then(function () { return { id: id, deleted: true }; });
  });
}
function listDrops(pool, o) {
  o = o || {};
  return pool.query('SELECT id, at, provider, instance, reason, identity_sha256 IS NOT NULL AS has_identity_hash FROM wp_routing_drops ORDER BY id DESC LIMIT $1', [Math.min(500, Math.max(1, parseInt(o.limit, 10) || 50))]).then(function (r) { return r.rows; });
}

// createSharedInbox(pool, projectId, o, actor) — the explicit, audited way to declare a logical inbox on a shared
// account (the DB trigger enforces: account_ref present, reserved account only with opt-in, no dedicated neighbour).
// The personal-account permission is NEVER implied: the caller must pass o.allow_personal_account === true (CLI
// --allow-personal-account). Without it — including a value smuggled in through o.settings — nothing is written.
function createSharedInbox(pool, projectId, o, actor) {
  o = o || {};
  if (!/^[a-z0-9][a-z0-9_-]{1,62}$/.test(String(o.instance || ''))) throw fail('validation', 400, 'instance shape');
  if (!/^[0-9]{6,32}$/.test(String(o.account_ref || ''))) throw fail('validation', 400, 'account_ref (digits) required for a shared inbox');
  if (!o.display_name) throw fail('validation', 400, 'display_name required');
  if (o.allow_personal_account !== true) throw fail('precondition', 412, 'a shared-account inbox requires the explicit allow_personal_account opt-in (--allow-personal-account)');
  var settings = Object.assign({}, o.settings || {}, { allow_personal_account: true });
  return pool.query("INSERT INTO wp_inboxes (project_id, provider, instance, display_name, phone_masked, account_ref, account_mode, settings, status) VALUES ($1,$2,$3,$4,$5,$6,'shared',$7,'inactive') RETURNING id, project_id, provider, instance, account_mode, inbound_enabled, outbound_enabled, status",
    [projectId, o.provider || 'evolution', o.instance, String(o.display_name).slice(0, 120), '***' + String(o.account_ref).slice(-4), String(o.account_ref), JSON.stringify(settings)])
    .then(function (r) { return pool.query("INSERT INTO wp_audit_events (actor, action, resource, record_id, project_id, next) VALUES ($1, 'create', 'inboxes', $2, $3, $4)", [actor || 'system', String(r.rows[0].id), projectId, JSON.stringify({ account_mode: 'shared', instance: o.instance, account_ref_masked: '…' + String(o.account_ref).slice(-4), allow_personal_account: true })]).then(function () { return r.rows[0]; }); },
      function (e) { if (/wp_inboxes_(account_reserved|dedicated_uidx|shared_needs_account|not_bridge)/.test(e.message + (e.constraint || ''))) throw fail('precondition', 412, e.message); throw e; });
}

module.exports = { createSharedInbox: createSharedInbox, resolve: resolve, simulate: simulate, decide: decide, inboxesOn: inboxesOn, dropAudit: dropAudit, addRule: addRule, listRules: listRules, setRuleEnabled: setRuleEnabled, removeRule: removeRule, listDrops: listDrops, ruleIsSane: ruleIsSane, sha: sha, ENTRY_RE: ENTRY_RE, KINDS: KINDS };
