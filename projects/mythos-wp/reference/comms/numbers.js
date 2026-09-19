'use strict';
var hasSecretKey = require('../audit').hasSecretKey;
// =====================================================
// MYTHOS WP V2 — WhatsApp business accounts & phone numbers (builder A)
// projects/mythos-wp/reference/comms/numbers.js
//
// wp_wa_accounts (business accounts) + wp_phone_numbers (one row per provider
// instance / Cloud API phone_number_id). wp_inboxes is the PROJECT ↔ NUMBER link.
//   sync(pool, deps)   discovers Evolution instances (GET /instance/fetchInstances,
//                      key from the 0600 file named by MYTHOS_WP_EVOLUTION_API_KEY_FILE),
//                      upserts wp_phone_numbers and checks every instance webhook
//                      (GET /webhook/find/:instance). NEVER creates an instance,
//                      NEVER changes a webhook.
//   check(pool, id)    provider.health → status / health_state
//   link / unlink      project ↔ number (dedicated: single link; shared: routing.createSharedInbox)
// Masking: phone_masked = '***' + last 4 digits. phone_ref (full digits of the
// business number) is returned to admin+ only (route layer decides).
// =====================================================
var http = require('http');
var https = require('https');
var routing = require('./routing');
var registry = require('./provider');
var PROVIDERS = { evolution: true, meta_cloud: true };
var INSTANCE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
var PHONE_RE = /^[0-9]{6,32}$/;
var STATUS = { unknown: true, inactive: true, pairing: true, open: true, closed: true, error: true };
var CONNECTION_MAP = { open: 'open', close: 'closed', closed: 'closed', connecting: 'pairing', refused: 'error' };
// The ONLY states that count as "the provider told us what the session is doing". Anything else —
// unknown, unreachable, refused, a 5xx, a timeout — is a failed check, never a device status.
var REPORTED_STATE = { open: 'open', close: 'closed', closed: 'closed', connecting: 'pairing', pairing: 'pairing' };
var INBOX_STATUS = { open: 'open', closed: 'closed', pairing: 'pairing', error: 'error', inactive: 'inactive', unknown: 'inactive' };

// ---- the ONE connection model shown to an operator ---------------------------------------
// `status` is the DEVICE state last observed through the provider; `health_state` says whether the
// last CHECK reached the gateway at all. The two are never mixed: a check that could not reach the
// gateway leaves the device status alone and reports `error` — "we do not know", not "it is broken".
//
//   connected        the WhatsApp session is open
//   action_required  never paired (no digits yet), pairing, or never checked — a human must act
//   disconnected     it was paired and the session closed — re-pair from the phone
//   error            the last check could not reach the WhatsApp gateway (status is the last known one)
var CONNECTION_LABEL = { connected: 'Connected', action_required: 'Action required', disconnected: 'Disconnected', error: 'Error' };
function connectionOf(row) {
  var status = row && row.status ? String(row.status) : 'unknown';
  var health = row && row.health_state ? String(row.health_state) : 'unknown';
  var paired = !!(row && row.phone_ref);
  if (health === 'error') return { state: 'error', label: CONNECTION_LABEL.error, detail: 'The WhatsApp gateway did not answer the last check; the number was ' + (status === 'open' ? 'connected' : status) + ' before that.' };
  if (status === 'open') return { state: 'connected', label: CONNECTION_LABEL.connected, detail: 'The WhatsApp session is open.' };
  if (status === 'pairing') return { state: 'action_required', label: CONNECTION_LABEL.action_required, detail: 'Pairing in progress: scan the QR code from the phone.' };
  if (status === 'closed') return paired
    ? { state: 'disconnected', label: CONNECTION_LABEL.disconnected, detail: 'The session closed. Re-pair this number from the phone.' }
    : { state: 'action_required', label: CONNECTION_LABEL.action_required, detail: 'Not paired yet: scan the QR code from the phone to connect this number.' };
  return { state: 'action_required', label: CONNECTION_LABEL.action_required, detail: 'No successful check yet for this number.' };
}
// syncInboxStatus(pool, row) — every project link of a number follows the number's device status, so a
// link created (or left behind) during an outage can never keep a stale value that blocks replies.
function syncInboxStatus(pool, row) {
  if (!row || !row.status) return Promise.resolve(0);
  var target = INBOX_STATUS[row.status] || 'inactive';
  return pool.query('UPDATE wp_inboxes SET status = $2, updated_at = now() WHERE (phone_number_id = $1 OR (provider = $3 AND instance = $4)) AND status IS DISTINCT FROM $2', [row.id, target, row.provider, row.instance])
    .then(function (r) { return r.rowCount || 0; }, function () { return 0; });
}
var AI_MODES = { inherit: true, off: true, suggest: true, auto: true };
function fail(code, status, detail) { var e = new Error(detail || code); e.code = code; e.status = status; return e; }
function mask(n) { n = String(n || '').replace(/[^0-9]/g, ''); return n.length >= 4 ? '***' + n.slice(-4) : '***'; }
function jidDigits(jid) { if (typeof jid !== 'string') return null; var d = jid.split('@')[0].split(':')[0].replace(/[^0-9]/g, ''); return PHONE_RE.test(d) ? d : null; }
function clean(s, max) { return s === undefined || s === null || s === '' ? null : String(s).slice(0, max || 120); }

// ---- accounts ------------------------------------------------------------------
function listAccounts(pool) {
  return pool.query('SELECT a.id, a.provider, a.external_ref, a.display_name, a.business_name, a.status, a.meta, a.created_at, a.updated_at, (SELECT count(*)::int FROM wp_phone_numbers p WHERE p.account_id = a.id) AS numbers FROM wp_wa_accounts a ORDER BY a.display_name, a.id').then(function (r) { return r.rows; });
}
function createAccount(pool, body) {
  body = body || {};
  var provider = body.provider || 'evolution';
  if (!PROVIDERS[provider]) throw fail('validation', 400, 'provider evolution|meta_cloud');
  if (!body.display_name) throw fail('validation', 400, 'display_name required');
  if (body.external_ref !== undefined && body.external_ref !== null && !/^[A-Za-z0-9:._-]{1,64}$/.test(String(body.external_ref))) throw fail('validation', 400, 'external_ref shape');
  var meta = body.meta && typeof body.meta === 'object' && !Array.isArray(body.meta) ? body.meta : {};
  if (JSON.stringify(meta).length > 4000) throw fail('validation', 400, 'meta too large');
  if (hasSecretKey(meta)) throw fail('validation', 400, 'meta must not carry a credential');
  return pool.query('INSERT INTO wp_wa_accounts (provider, external_ref, display_name, business_name, status, meta) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [provider, clean(body.external_ref, 64), clean(body.display_name, 120), clean(body.business_name, 120), body.status === 'disabled' ? 'disabled' : 'active', JSON.stringify(meta)])
    .then(function (r) { return r.rows[0]; }, function (e) { if (/wp_wa_accounts_unique/.test(e.message + (e.constraint || ''))) throw fail('conflict', 409, 'an account with this external_ref exists'); throw e; });
}
function updateAccount(pool, id, patch) {
  patch = patch || {}; var sets = [], params = [id];
  if (patch.display_name !== undefined) { if (!patch.display_name) throw fail('validation', 400, 'display_name required'); params.push(clean(patch.display_name, 120)); sets.push('display_name = $' + params.length); }
  if (patch.business_name !== undefined) { params.push(clean(patch.business_name, 120)); sets.push('business_name = $' + params.length); }
  if (patch.external_ref !== undefined) { if (patch.external_ref !== null && !/^[A-Za-z0-9:._-]{1,64}$/.test(String(patch.external_ref))) throw fail('validation', 400, 'external_ref shape'); params.push(clean(patch.external_ref, 64)); sets.push('external_ref = $' + params.length); }
  if (patch.status !== undefined) { if (patch.status !== 'active' && patch.status !== 'disabled') throw fail('validation', 400, 'status active|disabled'); params.push(patch.status); sets.push('status = $' + params.length); }
  if (patch.meta !== undefined) { if (!patch.meta || typeof patch.meta !== 'object' || Array.isArray(patch.meta) || JSON.stringify(patch.meta).length > 4000 || hasSecretKey(patch.meta)) throw fail('validation', 400, 'meta must be a small object without credentials'); params.push(JSON.stringify(patch.meta)); sets.push('meta = $' + params.length); }
  if (!sets.length) throw fail('validation', 400, 'nothing to change');
  sets.push('updated_at = now()');
  return pool.query('UPDATE wp_wa_accounts SET ' + sets.join(', ') + ' WHERE id = $1 RETURNING *', params).then(function (r) { if (!r.rows[0]) throw fail('not_found', 404, 'no such account'); return r.rows[0]; }, function (e) { if (/wp_wa_accounts_unique/.test(e.message + (e.constraint || ''))) throw fail('conflict', 409, 'an account with this external_ref exists'); throw e; });
}
function deleteAccount(pool, id) {
  return pool.query('DELETE FROM wp_wa_accounts WHERE id = $1 RETURNING id', [id]).then(function (r) { if (!r.rows[0]) throw fail('not_found', 404, 'no such account'); return { id: r.rows[0].id, deleted: true }; });
}

// ---- numbers -----------------------------------------------------------------------
var NUMBER_COLS = 'p.id, p.account_id, p.provider, p.instance, p.phone_ref, p.display_name, p.status, p.is_personal, p.health_state, p.health_detail, p.last_health_at, p.webhook_state, p.webhook_detail, p.last_event_at, p.settings, p.created_at, p.updated_at';
function shape(row, admin) {
  var conn = connectionOf(row);
  var out = { connection: conn.state, connection_label: conn.label, connection_detail: conn.detail, id: row.id, provider: row.provider, instance: row.instance, phone_masked: mask(row.phone_ref), display_name: row.display_name, status: row.status, is_personal: row.is_personal === true, health_state: row.health_state, health_detail: row.health_detail, last_health_at: row.last_health_at, webhook_state: row.webhook_state, webhook_detail: row.webhook_detail, last_event_at: row.last_event_at, settings: row.settings || {}, created_at: row.created_at, updated_at: row.updated_at, account: row.account_id ? { id: row.account_id, display_name: row.account_name || null } : null, projects: row.projects || [] };
  if (admin) out.phone_ref = row.phone_ref;
  return out;
}
function listNumbers(pool, o) {
  o = o || {};
  return pool.query('SELECT ' + NUMBER_COLS + ', a.display_name AS account_name, ' +
    "COALESCE((SELECT json_agg(json_build_object('project_id', i.project_id, 'display_name', pr.display_name, 'inbox_display_name', i.display_name, 'inbox_id', i.id, 'account_mode', i.account_mode, 'inbound_enabled', i.inbound_enabled, 'outbound_enabled', i.outbound_enabled, 'ai_mode', i.ai_mode, 'status', i.status) ORDER BY i.id) FROM wp_inboxes i JOIN wp_projects pr ON pr.id = i.project_id WHERE i.phone_number_id = p.id OR (i.phone_number_id IS NULL AND i.provider = p.provider AND i.instance = p.instance)), '[]'::json) AS projects " +
    'FROM wp_phone_numbers p LEFT JOIN wp_wa_accounts a ON a.id = p.account_id ORDER BY p.display_name, p.id')
    .then(function (r) { return r.rows.map(function (x) { return shape(x, o.admin === true); }); });
}
function getNumber(pool, id, o) {
  o = o || {};
  return listNumbers(pool, o).then(function (rows) { var row = rows.filter(function (x) { return String(x.id) === String(id); })[0]; if (!row) throw fail('not_found', 404, 'no such number'); return row; });
}
function rawNumber(pool, id) {
  return pool.query('SELECT ' + NUMBER_COLS + ' FROM wp_phone_numbers p WHERE p.id = $1', [id]).then(function (r) { if (!r.rows[0]) throw fail('not_found', 404, 'no such number'); return r.rows[0]; });
}
function reservedSet(pool) { return pool.query('SELECT account_ref FROM wp_reserved_accounts').then(function (r) { var s = {}; r.rows.forEach(function (x) { s[x.account_ref] = true; }); return s; }); }
function createNumber(pool, body) {
  body = body || {};
  var provider = body.provider || 'evolution';
  if (!PROVIDERS[provider]) throw fail('validation', 400, 'provider evolution|meta_cloud');
  if (!INSTANCE_RE.test(String(body.instance || ''))) throw fail('validation', 400, 'instance shape');
  if (body.phone_ref !== undefined && body.phone_ref !== null && body.phone_ref !== '' && !PHONE_RE.test(String(body.phone_ref))) throw fail('validation', 400, 'phone_ref must be 6–32 digits');
  if (!body.display_name) throw fail('validation', 400, 'display_name required');
  var accountId = body.account_id === undefined || body.account_id === null || body.account_id === '' ? null : parseInt(body.account_id, 10);
  if (body.account_id !== undefined && body.account_id !== null && body.account_id !== '' && !accountId) throw fail('validation', 400, 'account_id shape');
  var settings = body.settings && typeof body.settings === 'object' && !Array.isArray(body.settings) ? body.settings : {};
  if (hasSecretKey(settings)) throw fail('validation', 400, 'settings must not carry a credential');
  return reservedSet(pool).then(function (reserved) {
    var phone = body.phone_ref ? String(body.phone_ref) : null;
    var personal = body.is_personal === true || (phone !== null && reserved[phone] === true);
    return pool.query('INSERT INTO wp_phone_numbers (account_id, provider, instance, phone_ref, display_name, is_personal, settings) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id', [accountId, provider, body.instance, phone, clean(body.display_name, 120), personal, JSON.stringify(settings)])
      .then(function (r) { return r.rows[0].id; }, function (e) { if (/wp_phone_numbers_unique/.test(e.message + (e.constraint || ''))) throw fail('conflict', 409, 'this instance is already registered'); if (/wp_phone_numbers_account_id_fkey/.test(e.message + (e.constraint || ''))) throw fail('validation', 400, 'no such account'); throw e; });
  });
}
function updateNumber(pool, id, patch) {
  patch = patch || {}; var sets = [], params = [id];
  if (patch.display_name !== undefined) { if (!patch.display_name) throw fail('validation', 400, 'display_name required'); params.push(clean(patch.display_name, 120)); sets.push('display_name = $' + params.length); }
  if (patch.phone_ref !== undefined) { if (patch.phone_ref !== null && patch.phone_ref !== '' && !PHONE_RE.test(String(patch.phone_ref))) throw fail('validation', 400, 'phone_ref must be 6–32 digits'); params.push(patch.phone_ref ? String(patch.phone_ref) : null); sets.push('phone_ref = $' + params.length); }
  if (patch.is_personal !== undefined) { if (typeof patch.is_personal !== 'boolean') throw fail('validation', 400, 'is_personal boolean'); params.push(patch.is_personal); sets.push('is_personal = $' + params.length); }
  if (patch.account_id !== undefined) { var a = patch.account_id === null || patch.account_id === '' ? null : parseInt(patch.account_id, 10); if (patch.account_id !== null && patch.account_id !== '' && !a) throw fail('validation', 400, 'account_id shape'); params.push(a); sets.push('account_id = $' + params.length); }
  if (patch.status !== undefined) { if (!STATUS[patch.status]) throw fail('validation', 400, 'status unknown|inactive|pairing|open|closed|error'); params.push(patch.status); sets.push('status = $' + params.length); }
  if (patch.settings !== undefined) { if (!patch.settings || typeof patch.settings !== 'object' || Array.isArray(patch.settings) || JSON.stringify(patch.settings).length > 8000 || hasSecretKey(patch.settings)) throw fail('validation', 400, 'settings must be a small object'); params.push(JSON.stringify(patch.settings)); sets.push('settings = $' + params.length); }
  if (!sets.length) throw fail('validation', 400, 'nothing to change');
  sets.push('updated_at = now()');
  return pool.query('UPDATE wp_phone_numbers SET ' + sets.join(', ') + ' WHERE id = $1 RETURNING id', params).then(function (r) { if (!r.rows[0]) throw fail('not_found', 404, 'no such number'); return r.rows[0].id; }, function (e) { if (/wp_phone_numbers_account_id_fkey/.test(e.message + (e.constraint || ''))) throw fail('validation', 400, 'no such account'); throw e; });
}
function inboxesOfNumber(pool, row) {
  return pool.query('SELECT id, project_id, account_mode, display_name FROM wp_inboxes WHERE phone_number_id = $1 OR (provider = $2 AND instance = $3) ORDER BY id', [row.id, row.provider, row.instance]).then(function (r) { return r.rows; });
}
function deleteNumber(pool, id) {
  return rawNumber(pool, id).then(function (row) {
    return inboxesOfNumber(pool, row).then(function (links) {
      if (links.length) throw fail('conflict', 409, 'the number is linked to ' + links.length + ' project inbox(es); unlink first');
      return pool.query('DELETE FROM wp_phone_numbers WHERE id = $1', [id]).then(function () { return { id: id, deleted: true }; });
    });
  });
}

// ---- Evolution discovery ----------------------------------------------------------
function getJson(base, path, headers, timeoutMs) {
  var u; try { u = new URL(String(base).replace(/\/+$/, '') + path); } catch (e) { return Promise.resolve({ ok: false, status: null, json: null, error: 'CONFIG: base url' }); }
  var mod = u.protocol === 'https:' ? https : http;
  return new Promise(function (resolve) {
    var done = false; var finish = function (r) { if (!done) { done = true; resolve(r); } };
    var req = mod.request({ host: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname + u.search, method: 'GET', headers: headers || {}, timeout: timeoutMs || 8000 }, function (res) {
      var b = ''; res.on('data', function (c) { if (b.length < 2097152) b += c; });
      res.on('end', function () { var j = null; try { j = JSON.parse(b); } catch (e) {} finish({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, json: j, error: res.statusCode < 300 ? null : 'HTTP ' + res.statusCode }); });
    });
    req.on('timeout', function () { req.destroy(new Error('timeout')); });
    req.on('error', function (e) { finish({ ok: false, status: null, json: null, error: 'TRANSPORT: ' + String(e && e.message || e).slice(0, 80) }); });
    req.end();
  });
}
// normalise one fetchInstances entry (Evolution v2: flat; v1: { instance: {...} })
function instanceOf(x) {
  if (!x || typeof x !== 'object') return null;
  var i = x.instance && typeof x.instance === 'object' ? x.instance : x;
  var name = i.name || i.instanceName || null;
  if (!INSTANCE_RE.test(String(name || ''))) return null;
  var conn = String(i.connectionStatus || i.status || i.state || '').toLowerCase();
  return { instance: String(name), status: CONNECTION_MAP[conn] || 'unknown', phone: jidDigits(i.ownerJid || i.owner || null), profile: typeof i.profileName === 'string' ? i.profileName.slice(0, 120) : null };
}
function receiverBase(deps) {
  var raw = (deps && deps.receiverUrl) || process.env.MYTHOS_WP_RECEIVER_URL || ('http://127.0.0.1:' + (process.env.MYTHOS_WP_PORT || '8170'));
  try { var u = new URL(raw); return { host: u.hostname, port: u.port || (u.protocol === 'https:' ? '443' : '80'), path: '/hooks/evolution' }; } catch (e) { return { host: '127.0.0.1', port: '8170', path: '/hooks/evolution' }; }
}
// webhookState(found, expected) → { state: ok|missing|mismatch|disabled, detail } — the URL query (token) is never kept
function webhookState(found, expected) {
  var w = found && typeof found === 'object' ? (found.webhook && typeof found.webhook === 'object' ? found.webhook : found) : null;
  var url = w && typeof w.url === 'string' ? w.url : null;
  if (!w || !url) return { state: 'missing', detail: 'no webhook configured on the instance' };
  if (w.enabled === false) return { state: 'disabled', detail: 'webhook disabled on the instance' };
  var u; try { u = new URL(url); } catch (e) { return { state: 'mismatch', detail: 'webhook url unparsable' }; }
  var port = u.port || (u.protocol === 'https:' ? '443' : '80');
  var where = u.hostname + ':' + port + u.pathname;
  if (u.hostname === expected.host && port === expected.port && u.pathname.replace(/\/+$/, '') === expected.path) return { state: 'ok', detail: 'webhook → ' + where };
  return { state: 'mismatch', detail: 'webhook → ' + where + ' (expected ' + expected.host + ':' + expected.port + expected.path + ')' };
}
// sync(pool, deps) → { discovered, created, updated, items }  deps: { receiverUrl?, timeoutMs? }
function sync(pool, deps) {
  deps = deps || {};
  var evo = registry.get('evolution') || require('./providers/evolution');
  var key = evo.readApiKey();
  if (!key.present) throw fail('precondition', 412, 'Evolution credential unavailable: ' + key.reason);
  var base = evo.baseUrl();
  var expected = receiverBase(deps);
  return getJson(base, '/instance/fetchInstances', { apikey: key.value }, deps.timeoutMs).then(function (r) {
    if (!r.ok) throw fail('upstream', 502, 'Evolution fetchInstances failed: ' + (r.error || 'unknown'));
    var list = Array.isArray(r.json) ? r.json : (r.json && Array.isArray(r.json.instances) ? r.json.instances : []);
    var found = list.map(instanceOf).filter(Boolean);
    return reservedSet(pool).then(function (reserved) {
      var created = 0, updated = 0, chain = Promise.resolve();
      found.forEach(function (f) {
        chain = chain.then(function () {
          return getJson(base, '/webhook/find/' + encodeURIComponent(f.instance), { apikey: key.value }, deps.timeoutMs).then(function (w) {
            var ws = w.status === 404 || !w.ok ? (w.status === null ? { state: 'unknown', detail: 'webhook lookup unreachable' } : { state: 'missing', detail: 'no webhook configured on the instance' }) : webhookState(w.json, expected);
            var personal = f.phone !== null && reserved[f.phone] === true;
            return pool.query("INSERT INTO wp_phone_numbers (provider, instance, phone_ref, display_name, status, is_personal, health_state, health_detail, last_health_at, webhook_state, webhook_detail) VALUES ('evolution', $1, $2, $3, $4, $5, $6, $7, now(), $8, $9) " +
              'ON CONFLICT (provider, instance) DO UPDATE SET phone_ref = COALESCE(EXCLUDED.phone_ref, wp_phone_numbers.phone_ref), status = EXCLUDED.status, is_personal = wp_phone_numbers.is_personal OR EXCLUDED.is_personal, health_state = EXCLUDED.health_state, health_detail = EXCLUDED.health_detail, last_health_at = now(), webhook_state = EXCLUDED.webhook_state, webhook_detail = EXCLUDED.webhook_detail, updated_at = now() RETURNING (xmax = 0) AS inserted, id, provider, instance, status',
              [f.instance, f.phone, f.profile || f.instance, f.status, personal, f.status === 'open' ? 'ok' : (f.status === 'pairing' ? 'warning' : 'disconnected'), 'connectionStatus ' + f.status, ws.state, String(ws.detail).slice(0, 200)])
              // the provider listed this state itself, so the project links follow it (same rule as check/connect)
              .then(function (x) { if (x.rows[0] && x.rows[0].inserted) created++; else updated++; return syncInboxStatus(pool, x.rows[0]); });
          });
        });
      });
      return chain.then(function () { return listNumbers(pool, { admin: deps.admin === true }); }).then(function (items) { return { discovered: found.length, created: created, updated: updated, items: items.filter(function (n) { return n.provider === 'evolution'; }) }; });
    });
  });
}
// check(pool, id) → provider.health for that instance → { status, health_state, detail }
function check(pool, id) {
  return rawNumber(pool, id).then(function (row) {
    var p = registry.get(row.provider);
    if (!p) throw fail('precondition', 412, 'provider not registered: ' + row.provider);
    return p.health({ instance: row.instance }).then(function (h) {
      var state = String(h.state || 'unknown');
      var known = REPORTED_STATE[state] || null;                                                  // a state the provider really reported
      var reachable = known !== null;
      // UNREACHABLE GATEWAY ≠ BROKEN NUMBER: keep the last known device status, report the check failure.
      var status = reachable ? known : row.status;
      var health = !reachable ? 'error' : status === 'open' ? 'ok' : status === 'pairing' ? 'warning' : status === 'closed' ? 'disconnected' : 'unknown';
      var detail = !reachable ? ('gateway unreachable: ' + String(h.reason || state)) : (h.reason ? String(h.reason) : 'state ' + state);
      return pool.query('UPDATE wp_phone_numbers SET status = $2, health_state = $3, health_detail = $4, last_health_at = now(), updated_at = now() WHERE id = $1 RETURNING id, provider, instance, status, health_state, phone_ref', [id, status, health, detail.slice(0, 200)])
        .then(function (r) { return syncInboxStatus(pool, r.rows[0]).then(function () { return r.rows[0]; }); })
        .then(function (fresh) { var conn = connectionOf(fresh); return { id: id, status: status, health_state: health, connection: conn.state, connection_label: conn.label, connection_detail: conn.detail, detail: detail.slice(0, 200) }; });
    });
  });
}

// connect(pool, id) → { state, qr? } — the pairing QR for a number that is NOT connected.
// Refused for a connected number (it would only risk the live session) and for providers that are not
// paired by QR (a Cloud API number is registered through Meta). The device status follows what the
// gateway reported (pairing / open) and the project links follow the number.
function connect(pool, id) {
  return rawNumber(pool, id).then(function (row) {
    if (row.status === 'open') throw fail('conflict', 409, 'this number is already connected');
    var p = registry.get(row.provider);
    if (!p || typeof p.connect !== 'function') throw fail('precondition', 412, 'this number is not paired with a QR code (' + row.provider + ')');
    return p.connect({ instance: row.instance }).then(function (r) {
      if (!r.ok) throw fail('unavailable', 503, 'the WhatsApp gateway did not return a QR code (' + String(r.reason || 'unknown').slice(0, 60) + ')');
      var status = r.state === 'open' ? 'open' : 'pairing';
      return pool.query('UPDATE wp_phone_numbers SET status = $2, health_state = $3, last_health_at = now(), updated_at = now() WHERE id = $1 RETURNING id, provider, instance, status', [id, status, status === 'open' ? 'ok' : 'warning'])
        .then(function (u) { return syncInboxStatus(pool, u.rows[0]); })
        .then(function () { return r.state === 'open' ? { state: 'open' } : { state: 'pairing', qr: r.qr, refresh_s: 15 }; });
    });
  });
}

// ---- project links (wp_inboxes) --------------------------------------------------------
// link(pool, id, { project_id, display_name?, account_mode, allow_personal_account? }, actor) → inbox row
function link(pool, id, body, actor) {
  body = body || {};
  var mode = body.account_mode || 'dedicated';
  if (mode !== 'dedicated' && mode !== 'shared') throw fail('validation', 400, 'account_mode dedicated|shared');
  if (!body.project_id) throw fail('validation', 400, 'project_id required');
  return rawNumber(pool, id).then(function (row) {
    return inboxesOfNumber(pool, row).then(function (links) {
      if (links.some(function (l) { return l.project_id === body.project_id; })) throw fail('conflict', 409, 'this project is already linked to the number');
      var name = clean(body.display_name, 120) || row.display_name;
      if (mode === 'dedicated') {
        if (links.length) throw fail('conflict', 409, 'a dedicated link requires a number with no other link (' + links.length + ' existing); use account_mode shared');
        return pool.query("INSERT INTO wp_inboxes (project_id, provider, instance, display_name, phone_masked, account_ref, account_mode, status, phone_number_id) VALUES ($1,$2,$3,$4,$5,$6,'dedicated',$7,$8) RETURNING id, project_id, provider, instance, display_name, account_mode, inbound_enabled, outbound_enabled, ai_mode, status, phone_number_id",
          [body.project_id, row.provider, row.instance, name, mask(row.phone_ref), row.phone_ref, INBOX_STATUS[row.status] || 'inactive', row.id])
          .then(function (r) { return r.rows[0]; }, function (e) { if (/wp_inboxes_(account_reserved|dedicated_uidx|not_bridge)/.test(e.message + (e.constraint || ''))) throw fail('precondition', 412, e.message); if (/wp_inboxes_project_id_fkey/.test(e.message + (e.constraint || ''))) throw fail('not_found', 404, 'unknown project'); throw e; });
      }
      if (!row.phone_ref) throw fail('precondition', 412, 'a shared link needs the number digits (phone_ref); sync or set it first');
      if (links.some(function (l) { return l.account_mode !== 'shared'; })) throw fail('conflict', 409, 'the number already has a dedicated link; unlink it before sharing');
      // a PERSONAL / reserved number needs the caller's explicit opt-in (never implied). Every shared inbox is written
      // through routing.createSharedInbox (audited, settings.allow_personal_account = true — the schema's sharing opt-in
      // that lets several inboxes carry one account_ref, see wp_inboxes_account_uidx).
      if (row.is_personal && body.allow_personal_account !== true) throw fail('precondition', 412, 'this number is personal: pass allow_personal_account:true to share it explicitly');
      return Promise.resolve().then(function () { return routing.createSharedInbox(pool, body.project_id, { provider: row.provider, instance: row.instance, account_ref: row.phone_ref, display_name: name, allow_personal_account: true }, actor); })
        .then(function (ib) { return pool.query('UPDATE wp_inboxes SET phone_number_id = $2, status = $3 WHERE id = $1 RETURNING id, project_id, provider, instance, display_name, account_mode, inbound_enabled, outbound_enabled, ai_mode, status, phone_number_id', [ib.id, row.id, INBOX_STATUS[row.status] || 'inactive']).then(function (r) { return r.rows[0]; }); },
          function (e) { if (/wp_inboxes_project_id_fkey/.test(e.message + (e.constraint || ''))) throw fail('not_found', 404, 'unknown project'); throw e; });
    });
  });
}
// unlink(pool, id, inboxId) → 409 when conversations exist (nothing is archived automatically)
function unlink(pool, id, inboxId) {
  return rawNumber(pool, id).then(function (row) {
    return pool.query('SELECT id, project_id FROM wp_inboxes WHERE id = $1 AND (phone_number_id = $2 OR (provider = $3 AND instance = $4))', [inboxId, row.id, row.provider, row.instance]).then(function (r) {
      var ib = r.rows[0];
      if (!ib) throw fail('not_found', 404, 'no such link on this number');
      return pool.query('SELECT count(*)::int AS n FROM wp_conversations WHERE inbox_id = $1', [ib.id]).then(function (c) {
        if (c.rows[0].n > 0) throw fail('conflict', 409, 'the inbox has ' + c.rows[0].n + ' conversation(s); it cannot be unlinked');
        return pool.query('DELETE FROM wp_inboxes WHERE id = $1', [ib.id]).then(function () { return { inbox_id: ib.id, project_id: ib.project_id, unlinked: true }; });
      });
    });
  });
}
// updateInbox(pool, projectId, inboxId, patch) → { inbound_enabled, outbound_enabled, ai_mode, display_name, settings }
function updateInbox(pool, projectId, inboxId, patch) {
  patch = patch || {}; var sets = [], params = [projectId, inboxId], changed = {};
  ['inbound_enabled', 'outbound_enabled'].forEach(function (k) { if (patch[k] !== undefined) { if (typeof patch[k] !== 'boolean') throw fail('validation', 400, k + ' boolean'); params.push(patch[k]); sets.push(k + ' = $' + params.length); changed[k] = patch[k]; } });
  if (patch.ai_mode !== undefined) { if (!AI_MODES[patch.ai_mode]) throw fail('validation', 400, 'ai_mode inherit|off|suggest|auto'); params.push(patch.ai_mode); sets.push('ai_mode = $' + params.length); changed.ai_mode = patch.ai_mode; }
  if (patch.display_name !== undefined) { if (!patch.display_name) throw fail('validation', 400, 'display_name required'); params.push(clean(patch.display_name, 120)); sets.push('display_name = $' + params.length); changed.display_name = clean(patch.display_name, 120); }
  if (patch.settings !== undefined) {
    if (!patch.settings || typeof patch.settings !== 'object' || Array.isArray(patch.settings) || JSON.stringify(patch.settings).length > 8000) throw fail('validation', 400, 'settings must be a small object');
    // allow_personal_account is a creation-time opt-in (routing.createSharedInbox); it is never toggled through a PATCH
    var s = Object.assign({}, patch.settings); delete s.allow_personal_account;
    params.push(JSON.stringify(s)); sets.push("settings = (settings - 'allow_personal_account') || $" + params.length + "::jsonb || CASE WHEN settings ? 'allow_personal_account' THEN jsonb_build_object('allow_personal_account', settings->'allow_personal_account') ELSE '{}'::jsonb END"); changed.settings = Object.keys(s);
  }
  if (!sets.length) throw fail('validation', 400, 'nothing to change');
  sets.push('updated_at = now()');
  return pool.query('UPDATE wp_inboxes SET ' + sets.join(', ') + ' WHERE project_id = $1 AND id = $2 RETURNING id, project_id, provider, instance, display_name, account_mode, inbound_enabled, outbound_enabled, ai_mode, status, settings, phone_number_id', params)
    .then(function (r) { if (!r.rows[0]) throw fail('not_found', 404, 'no such inbox in this project'); return { inbox: r.rows[0], changed: changed }; }, function (e) { if (/wp_inboxes_/.test(e.message + (e.constraint || ''))) throw fail('precondition', 412, e.message); throw e; });
}
module.exports = { connect: connect, mask: mask, rawNumber: rawNumber, inboxesOfNumber: inboxesOfNumber, connectionOf: connectionOf, syncInboxStatus: syncInboxStatus, INBOX_STATUS: INBOX_STATUS, listAccounts: listAccounts, createAccount: createAccount, updateAccount: updateAccount, deleteAccount: deleteAccount, listNumbers: listNumbers, getNumber: getNumber, createNumber: createNumber, updateNumber: updateNumber, deleteNumber: deleteNumber, sync: sync, check: check, link: link, unlink: unlink, updateInbox: updateInbox, webhookState: webhookState, instanceOf: instanceOf, receiverBase: receiverBase };
