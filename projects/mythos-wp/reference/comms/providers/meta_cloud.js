'use strict';
// =====================================================
// MYTHOS WP — Communication provider: WhatsApp Cloud API (Meta, official)
// projects/mythos-wp/reference/comms/providers/meta_cloud.js
//
// Satisfies comms/provider.js. Credentials are read at call time from 0600
// files named by environment variables and never logged, stored or returned:
//   MYTHOS_WP_META_ACCESS_TOKEN_FILE   system-user / permanent access token
//   MYTHOS_WP_META_APP_SECRET_FILE     app secret (X-Hub-Signature-256 HMAC)
//   MYTHOS_WP_META_VERIFY_TOKEN_FILE   webhook verify token (GET hub.verify_token)
//   MYTHOS_WP_META_GRAPH_BASE          default https://graph.facebook.com/v21.0 (http allowed for loopback tests)
// Instance = phone_number_id (Cloud API); WABA id lives in wp_wa_accounts.external_ref.
// Inbound: entry[].changes[].value.{messages|statuses} — ONE event per webhook body
// (the first message / status; Meta posts one per delivery in practice).
// HTTP via Node https/http only. Never throws on HTTP errors.
// =====================================================
var crypto = require('crypto');
var http = require('http');
var https = require('https');
var fs = require('fs');
var ID = 'meta_cloud';
var CHANNEL = 'whatsapp';
var INSTANCE_RE = /^[0-9]{5,32}$/;
var MSG_ID_RE = /^[A-Za-z0-9._=:-]{1,128}$/;
var MSISDN_RE = /^[0-9]{6,20}$/;
var WABA_RE = /^[0-9]{5,32}$/;
var TEMPLATE_NAME_RE = /^[a-z0-9_]{1,120}$/;
var MAX_TEXT = 8000;
var MAX_MEDIA_BYTES = 16 * 1024 * 1024;
var STRIP_KEYS = /^(access_token|token|secret|app_secret|authorization|apikey|api_key|url|sha256|mime_type_signature)$/i;
var MEDIA = { image: 'image', audio: 'audio', video: 'video', document: 'document', sticker: 'sticker' };
var STATUS_MAP = { sent: 'sent', delivered: 'delivered', read: 'read', failed: 'failed', deleted: 'failed', warning: 'queued' };
var TEMPLATE_STATUS = { APPROVED: 'approved', PENDING: 'pending', REJECTED: 'rejected', PAUSED: 'paused', DISABLED: 'rejected', IN_APPEAL: 'pending', PENDING_DELETION: 'rejected', DELETED: 'rejected', LIMIT_EXCEEDED: 'rejected' };

// ---- credentials (0600 files, read at call time) ----------------------------
// problems are lowercase codes (<label>_missing|_mode|_short|_unreadable): the env var NAMES are documented in the
// contract / README and never echoed by an endpoint (the providers endpoint is scanned for credential-looking words)
function readFile0600(envName, label, min) {
  var f = process.env[envName];
  if (!f) return { present: false, reason: label + '_missing' };
  try {
    var st = fs.statSync(f);
    if ((st.mode & 0o077) !== 0) return { present: false, reason: label + '_mode' };
    var v = fs.readFileSync(f, 'utf8').trim();
    return v.length >= (min || 8) ? { present: true, value: v } : { present: false, reason: label + '_short' };
  } catch (e) { return { present: false, reason: label + '_unreadable' }; }
}
function readApiKey() { return readFile0600('MYTHOS_WP_META_ACCESS_TOKEN_FILE', 'access_token_file', 16); }
function readAppSecret() { return readFile0600('MYTHOS_WP_META_APP_SECRET_FILE', 'app_secret_file', 8); }
function readVerifyToken() { return readFile0600('MYTHOS_WP_META_VERIFY_TOKEN_FILE', 'verify_token_file', 8); }
function baseUrl() { return String(process.env.MYTHOS_WP_META_GRAPH_BASE || 'https://graph.facebook.com/v21.0').replace(/\/+$/, ''); }
function timingSafeEqualStr(a, b) { var ab = Buffer.from(String(a), 'utf8'), bb = Buffer.from(String(b), 'utf8'); if (ab.length !== bb.length) return false; return crypto.timingSafeEqual(ab, bb); }

// ---- contract: describe / capabilities ---------------------------------------
function capabilities() {
  return {
    channel: CHANNEL, official: true, text: true,
    media: { inbound: true, outbound: false, fetch: true, kinds: ['image', 'audio', 'video', 'document', 'sticker'] },
    templates: true, reactions: true, quotes: true, conversation_window_hours: 24,
    signed_webhooks: true, webhook_retries: true,
    delivery_states: ['sent', 'delivered', 'read', 'failed'],
    limitations: ['free-form text only inside the 24 h customer service window; outside it an approved template is required', 'one inbound event per webhook body is processed (first message/status of the batch)', 'media outbound not implemented (text + templates only)', 'templates need Meta approval before use']
  };
}
function describe() {
  var problems = [];
  var t = readApiKey(); if (!t.present) problems.push(t.reason);
  var s = readAppSecret(); if (!s.present) problems.push(s.reason);
  var v = readVerifyToken(); if (!v.present) problems.push(v.reason);
  var host = null; try { host = new URL(baseUrl()).host; } catch (e) { problems.push('graph_base_invalid'); }
  return { id: ID, channel: CHANNEL, official: true, configured: problems.length === 0, credential_present: t.present, graph_base_host: host, problems: problems, credential_files: ['access_token_file', 'app_secret_file', 'verify_token_file'] };
}
function configured() { return readApiKey().present && readAppSecret().present && readVerifyToken().present; }

// ---- redaction / hashing ---------------------------------------------------------
function redactDeep(v, depth) {
  depth = depth || 0;
  if (depth > 12) return null;
  if (Array.isArray(v)) return v.slice(0, 50).map(function (x) { return redactDeep(x, depth + 1); });
  if (v && typeof v === 'object') { var out = {}; Object.keys(v).forEach(function (k) { if (STRIP_KEYS.test(k)) return; out[k] = redactDeep(v[k], depth + 1); }); return out; }
  if (typeof v === 'string' && v.length > 4096) return v.slice(0, 4096) + '…';
  return v;
}
function payloadHash(rawBody) { return crypto.createHash('sha256').update(String(rawBody)).digest('hex'); }

// ---- inbound normalisation ------------------------------------------------------
function firstChange(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'BODY_NOT_OBJECT' };
  if (body.object !== 'whatsapp_business_account') return { error: 'EVENT_IGNORED:' + String(body.object || 'none').slice(0, 40) };
  var entry = Array.isArray(body.entry) ? body.entry[0] : null;
  var change = entry && Array.isArray(entry.changes) ? entry.changes[0] : null;
  if (!change || !change.value || typeof change.value !== 'object') return { error: 'DATA_NOT_OBJECT' };
  if (change.field && change.field !== 'messages') return { error: 'EVENT_IGNORED:' + String(change.field).slice(0, 40) };
  var value = change.value;
  var instance = value.metadata && typeof value.metadata.phone_number_id === 'string' ? value.metadata.phone_number_id : '';
  if (!INSTANCE_RE.test(instance)) return { error: 'INSTANCE_INVALID' };
  return { value: value, instance: instance };
}
function content(m) {
  var t = m.type;
  if (t === 'text' && m.text && typeof m.text.body === 'string') return { message_type: 'text', text: m.text.body, attachments: [] };
  if (MEDIA[t] && m[t] && typeof m[t] === 'object') {
    var med = m[t];
    return { message_type: MEDIA[t], text: typeof med.caption === 'string' ? med.caption : '', attachments: [{ kind: MEDIA[t], mime_type: typeof med.mime_type === 'string' ? med.mime_type.slice(0, 120) : null, size_bytes: null, file_name: typeof med.filename === 'string' ? med.filename.slice(0, 255) : null, sha256: typeof med.sha256 === 'string' && /^[A-Za-z0-9+/=]{20,}$/.test(med.sha256) ? (function () { try { var h = Buffer.from(med.sha256, 'base64').toString('hex'); return h.length === 64 ? h : null; } catch (e) { return null; } })() : null, media_id: typeof med.id === 'string' ? med.id.slice(0, 128) : null }] };
  }
  if (t === 'location') return { message_type: 'location', text: '', attachments: [] };
  if (t === 'contacts') return { message_type: 'contact', text: '', attachments: [] };
  if (t === 'reaction') return { message_type: 'reaction', text: m.reaction && typeof m.reaction.emoji === 'string' ? m.reaction.emoji : '', attachments: [] };
  if (t === 'button' && m.button) return { message_type: 'text', text: typeof m.button.text === 'string' ? m.button.text : '', attachments: [] };
  if (t === 'interactive' && m.interactive) { var i = m.interactive; var r = i.button_reply || i.list_reply || {}; return { message_type: 'text', text: typeof r.title === 'string' ? r.title : '', attachments: [] }; }
  return { message_type: 'other', text: '', attachments: [] };
}
// parseInbound(body) → { ok, reason?, kind: 'message'|'status', event, label }
function parseInbound(body) {
  var fc = firstChange(body);
  if (fc.error) return { ok: false, reason: fc.error, instance: fc.instance || null };
  var value = fc.value, instance = fc.instance;
  if (Array.isArray(value.statuses) && value.statuses.length) {
    var s = value.statuses[0] || {};
    var sid = typeof s.id === 'string' ? s.id : null;
    var st = STATUS_MAP[String(s.status || '').toLowerCase()] || null;
    if (!sid || !MSG_ID_RE.test(sid)) return { ok: false, reason: 'STATUS_MESSAGE_ID', instance: instance };
    if (!st) return { ok: false, reason: 'STATUS_UNKNOWN:' + String(s.status || '').slice(0, 20), instance: instance };
    return { ok: true, kind: 'status', label: 'statuses', event: { provider: ID, instance: instance, provider_message_id: sid, status: st, from_me: true, recipient: typeof s.recipient_id === 'string' ? s.recipient_id : null } };
  }
  if (!Array.isArray(value.messages) || !value.messages.length) return { ok: false, reason: 'EVENT_IGNORED:no_messages', instance: instance };
  var m = value.messages[0];
  if (!m || typeof m !== 'object') return { ok: false, reason: 'DATA_NOT_OBJECT', instance: instance };
  if (!MSG_ID_RE.test(String(m.id || ''))) return { ok: false, reason: 'MESSAGE_ID', instance: instance };
  var from = String(m.from || '');
  if (!MSISDN_RE.test(from)) return { ok: false, reason: 'REMOTE_JID_INVALID', instance: instance };
  var self = value.metadata && typeof value.metadata.display_phone_number === 'string' ? value.metadata.display_phone_number.replace(/[^0-9]/g, '') : null;
  if (self && self === from) return { ok: false, reason: 'SELF_CHAT_IGNORED', instance: instance };
  if (m.type === 'unsupported' || m.type === 'system') return { ok: false, reason: 'EVENT_IGNORED:' + m.type, instance: instance };
  var profile = Array.isArray(value.contacts) ? value.contacts.filter(function (c) { return c && c.wa_id === from; })[0] || value.contacts[0] : null;
  var name = profile && profile.profile && typeof profile.profile.name === 'string' ? profile.profile.name.slice(0, 120) : null;
  var c = content(m);
  var ts = Number(m.timestamp);
  var at = ts > 0 ? new Date(ts < 1e12 ? ts * 1000 : ts) : null;
  return {
    ok: true, kind: 'message', label: 'messages',
    event: {
      provider: ID, instance: instance,
      provider_message_id: String(m.id),
      contact: { wa_id: from, lid: null, display_name: name, identities: [{ kind: 'phone', value: from }] },
      chat_id: from,
      message_type: c.message_type,
      text: typeof c.text === 'string' ? c.text.slice(0, MAX_TEXT) : '',
      quoted_provider_message_id: m.context && typeof m.context.id === 'string' && MSG_ID_RE.test(m.context.id) ? m.context.id : null,
      provider_timestamp: at && !isNaN(at.getTime()) ? at.toISOString() : null,
      attachments: c.attachments,
      raw: redactDeep(m)
    }
  };
}

// ---- webhook authentication ---------------------------------------------------
// GET  (ctx.method === 'GET' or req.method): hub.mode=subscribe + hub.verify_token → { ok, challenge }
// POST: X-Hub-Signature-256 = 'sha256=' + HMAC-SHA256(app secret, raw body), constant-time compare
function verifyWebhook(req, ctx) {
  ctx = ctx || {};
  var method = ctx.method || (req && req.method) || 'POST';
  if (method === 'GET') {
    var q = ctx.query || {};
    var vt = readVerifyToken();
    if (!vt.present) return { ok: false, reason: 'VERIFY_TOKEN_NOT_CONFIGURED' };
    if (q['hub.mode'] !== 'subscribe') return { ok: false, reason: 'HUB_MODE' };
    if (typeof q['hub.verify_token'] !== 'string' || !timingSafeEqualStr(q['hub.verify_token'], vt.value)) return { ok: false, reason: 'VERIFY_TOKEN_MISMATCH' };
    if (typeof q['hub.challenge'] !== 'string' || !q['hub.challenge']) return { ok: false, reason: 'CHALLENGE_MISSING' };
    return { ok: true, reason: null, challenge: String(q['hub.challenge']).slice(0, 256) };
  }
  var secret = typeof ctx.secret === 'string' && ctx.secret ? ctx.secret : null;
  if (!secret) { var s = readAppSecret(); if (!s.present) return { ok: false, reason: 'APP_SECRET_NOT_CONFIGURED' }; secret = s.value; }
  var header = req && req.headers ? req.headers['x-hub-signature-256'] : undefined;
  if (typeof header !== 'string' || header.indexOf('sha256=') !== 0) return { ok: false, reason: 'SIGNATURE_MISSING' };
  if (typeof ctx.rawBody !== 'string' && !Buffer.isBuffer(ctx.rawBody)) return { ok: false, reason: 'RAW_BODY_MISSING' };
  var expected = crypto.createHmac('sha256', secret).update(ctx.rawBody).digest('hex');
  return timingSafeEqualStr(header.slice(7).toLowerCase(), expected) ? { ok: true, reason: null } : { ok: false, reason: 'SIGNATURE_MISMATCH' };
}

// ---- Graph API client (never throws; never puts the token in errors) ---------------
function scrub(s) { return String(s || '').replace(/[A-Za-z0-9._-]{20,}/g, '…').slice(0, 200); }
function graph(o) {
  o = o || {};
  var token = o.token; if (!token) { var k = readApiKey(); if (!k.present) return Promise.resolve({ ok: false, status: null, json: null, error: 'CONFIG: ' + k.reason }); token = k.value; }
  var u; try { u = new URL(baseUrl() + o.path); } catch (e) { return Promise.resolve({ ok: false, status: null, json: null, error: 'CONFIG: base url' }); }
  if (o.query) Object.keys(o.query).forEach(function (k) { if (o.query[k] !== undefined && o.query[k] !== null) u.searchParams.set(k, String(o.query[k])); });
  var payload = o.body ? JSON.stringify(o.body) : null;
  var mod = u.protocol === 'https:' ? https : http;
  var headers = { Authorization: 'Bearer ' + token, Accept: 'application/json' };
  if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(payload); }
  return new Promise(function (resolve) {
    var done = false; var finish = function (r) { if (!done) { done = true; resolve(r); } };
    var req = mod.request({ host: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname + u.search, method: o.method || 'GET', headers: headers, timeout: o.timeoutMs || 15000 }, function (res) {
      var b = ''; res.on('data', function (c) { if (b.length < 1048576) b += c; });
      res.on('end', function () {
        var j = null; try { j = JSON.parse(b); } catch (e) {}
        var ok = res.statusCode >= 200 && res.statusCode < 300;
        var msg = j && j.error ? ((j.error.code ? j.error.code + ' ' : '') + (j.error.message || j.error.type || '')) : b;
        finish({ ok: ok, status: res.statusCode, json: j, error: ok ? null : ('HTTP ' + res.statusCode + ': ' + scrub(msg)) });
      });
    });
    req.on('timeout', function () { req.destroy(new Error('timeout')); });
    req.on('error', function (e) { finish({ ok: false, status: null, json: null, error: 'TRANSPORT: ' + String(e && e.message || e).slice(0, 120) }); });
    req.end(payload);
  });
}

// ---- outbound ---------------------------------------------------------------------
// sendText({ instance, apiKey?, to, text, timeoutMs }) → { ok, status, provider_message_id, error }
function sendText(o) {
  o = o || {};
  if (!INSTANCE_RE.test(String(o.instance || ''))) return Promise.resolve({ ok: false, status: null, provider_message_id: null, error: 'CONFIG: instance (phone_number_id)' });
  if (!MSISDN_RE.test(String(o.to || ''))) return Promise.resolve({ ok: false, status: null, provider_message_id: null, error: 'CONFIG: recipient' });
  if (typeof o.text !== 'string' || !o.text.trim() || o.text.length > 4096) return Promise.resolve({ ok: false, status: null, provider_message_id: null, error: 'CONFIG: text' });
  return graph({ method: 'POST', path: '/' + encodeURIComponent(o.instance) + '/messages', token: o.apiKey, timeoutMs: o.timeoutMs, body: { messaging_product: 'whatsapp', recipient_type: 'individual', to: o.to, type: 'text', text: { preview_url: false, body: o.text } } })
    .then(function (r) { var id = r.json && Array.isArray(r.json.messages) && r.json.messages[0] && typeof r.json.messages[0].id === 'string' ? r.json.messages[0].id.slice(0, 128) : null; return { ok: r.ok, status: r.status, provider_message_id: id, error: r.error }; });
}
// sendTemplate({ instance, to, name, language, components }) → same shape
function sendTemplate(o) {
  o = o || {};
  if (!INSTANCE_RE.test(String(o.instance || ''))) return Promise.resolve({ ok: false, status: null, provider_message_id: null, error: 'CONFIG: instance (phone_number_id)' });
  if (!MSISDN_RE.test(String(o.to || ''))) return Promise.resolve({ ok: false, status: null, provider_message_id: null, error: 'CONFIG: recipient' });
  if (!TEMPLATE_NAME_RE.test(String(o.name || ''))) return Promise.resolve({ ok: false, status: null, provider_message_id: null, error: 'CONFIG: template name' });
  var tpl = { name: o.name, language: { code: String(o.language || 'fr') } };
  if (Array.isArray(o.components) && o.components.length) tpl.components = o.components;
  return graph({ method: 'POST', path: '/' + encodeURIComponent(o.instance) + '/messages', token: o.apiKey, timeoutMs: o.timeoutMs, body: { messaging_product: 'whatsapp', recipient_type: 'individual', to: o.to, type: 'template', template: tpl } })
    .then(function (r) { var id = r.json && Array.isArray(r.json.messages) && r.json.messages[0] && typeof r.json.messages[0].id === 'string' ? r.json.messages[0].id.slice(0, 128) : null; return { ok: r.ok, status: r.status, provider_message_id: id, error: r.error }; });
}

// ---- templates (WABA level) ------------------------------------------------------
function normalizeTemplate(t) {
  t = t || {};
  var comps = Array.isArray(t.components) ? t.components : [];
  var pick = function (type) { return comps.filter(function (c) { return c && String(c.type).toUpperCase() === type; })[0] || null; };
  var header = pick('HEADER'), body = pick('BODY'), footer = pick('FOOTER'), buttons = pick('BUTTONS');
  return { provider_template_id: t.id ? String(t.id) : null, name: t.name || null, language: t.language || null, category: t.category || null, status: TEMPLATE_STATUS[String(t.status || '').toUpperCase()] || 'pending', provider_status: t.status || null, header: header && typeof header.text === 'string' ? header.text : null, body: body && typeof body.text === 'string' ? body.text : null, footer: footer && typeof footer.text === 'string' ? footer.text : null, buttons: buttons && Array.isArray(buttons.buttons) ? buttons.buttons : [], rejection_reason: t.rejected_reason && t.rejected_reason !== 'NONE' ? String(t.rejected_reason).slice(0, 400) : null };
}
// listTemplates(wabaId, { name?, limit? }) → { ok, items:[normalised], error }
function listTemplates(wabaId, o) {
  o = o || {};
  if (!WABA_RE.test(String(wabaId || ''))) return Promise.resolve({ ok: false, items: [], error: 'CONFIG: waba id' });
  var query = { fields: 'id,name,language,category,status,components,rejected_reason', limit: Math.min(250, Math.max(1, parseInt(o.limit, 10) || 100)) };
  if (o.name) query.name = String(o.name);
  return graph({ method: 'GET', path: '/' + encodeURIComponent(wabaId) + '/message_templates', query: query, token: o.apiKey, timeoutMs: o.timeoutMs })
    .then(function (r) { return { ok: r.ok, status: r.status, items: r.ok && r.json && Array.isArray(r.json.data) ? r.json.data.map(normalizeTemplate) : [], error: r.error }; });
}
// createTemplate(wabaId, { name, language, category, header, body, footer, buttons, examples }) → { ok, id, status, error }
function createTemplate(wabaId, t, o) {
  o = o || {}; t = t || {};
  if (!WABA_RE.test(String(wabaId || ''))) return Promise.resolve({ ok: false, error: 'CONFIG: waba id' });
  if (!TEMPLATE_NAME_RE.test(String(t.name || ''))) return Promise.resolve({ ok: false, error: 'CONFIG: template name' });
  if (typeof t.body !== 'string' || !t.body.trim()) return Promise.resolve({ ok: false, error: 'CONFIG: body' });
  var components = [];
  if (t.header) components.push({ type: 'HEADER', format: 'TEXT', text: String(t.header).slice(0, 60) });
  var body = { type: 'BODY', text: String(t.body).slice(0, 1024) };
  if (Array.isArray(t.examples) && t.examples.length) body.example = { body_text: [t.examples.map(String)] };
  components.push(body);
  if (t.footer) components.push({ type: 'FOOTER', text: String(t.footer).slice(0, 60) });
  if (Array.isArray(t.buttons) && t.buttons.length) components.push({ type: 'BUTTONS', buttons: t.buttons.slice(0, 10) });
  return graph({ method: 'POST', path: '/' + encodeURIComponent(wabaId) + '/message_templates', token: o.apiKey, timeoutMs: o.timeoutMs, body: { name: t.name, language: String(t.language || 'fr'), category: String(t.category || 'UTILITY').toUpperCase(), components: components } })
    .then(function (r) { return { ok: r.ok, status: r.status, id: r.json && r.json.id ? String(r.json.id) : null, template_status: r.json && r.json.status ? (TEMPLATE_STATUS[String(r.json.status).toUpperCase()] || 'pending') : 'pending', error: r.error }; });
}
// deleteTemplate(wabaId, name, hsmId?) → { ok, error }
function deleteTemplate(wabaId, name, o) {
  o = o || {};
  if (!WABA_RE.test(String(wabaId || ''))) return Promise.resolve({ ok: false, error: 'CONFIG: waba id' });
  if (!TEMPLATE_NAME_RE.test(String(name || ''))) return Promise.resolve({ ok: false, error: 'CONFIG: template name' });
  var query = { name: name }; if (o.hsm_id) query.hsm_id = String(o.hsm_id);
  return graph({ method: 'DELETE', path: '/' + encodeURIComponent(wabaId) + '/message_templates', query: query, token: o.apiKey, timeoutMs: o.timeoutMs }).then(function (r) { return { ok: r.ok, status: r.status, error: r.error }; });
}

// ---- health / media ---------------------------------------------------------------
// health({ instance }) → { ok, state: open|error|unreachable|unknown, reason?, detail? }
function health(o) {
  o = o || {};
  if (!INSTANCE_RE.test(String(o.instance || ''))) return Promise.resolve({ ok: false, state: 'unknown', reason: 'CONFIG: instance' });
  if (!readApiKey().present) return Promise.resolve({ ok: false, state: 'unknown', reason: 'CONFIG: ' + readApiKey().reason });
  return graph({ method: 'GET', path: '/' + encodeURIComponent(o.instance), query: { fields: 'display_phone_number,verified_name,quality_rating' }, timeoutMs: o.timeoutMs || 8000 }).then(function (r) {
    if (r.ok && r.json) return { ok: true, state: 'open', detail: { verified_name: r.json.verified_name || null, quality_rating: r.json.quality_rating || null, display_phone_number_masked: r.json.display_phone_number ? '***' + String(r.json.display_phone_number).replace(/[^0-9]/g, '').slice(-4) : null } };
    if (r.status === null) return { ok: false, state: 'unreachable', reason: r.error };
    return { ok: false, state: 'error', reason: r.error };
  });
}
// fetchMedia({ media_id }) → { ok, mime_type, size_bytes, bytes } (GET /{media_id} → url → bytes with the bearer token)
function fetchMedia(o) {
  o = o || {};
  if (!/^[0-9]{3,64}$/.test(String(o.media_id || ''))) return Promise.resolve({ ok: false, reason: 'MEDIA_ID' });
  var key = readApiKey(); if (!key.present) return Promise.resolve({ ok: false, reason: 'CONFIG: ' + key.reason });
  return graph({ method: 'GET', path: '/' + encodeURIComponent(o.media_id) }).then(function (r) {
    if (!r.ok || !r.json || typeof r.json.url !== 'string') return { ok: false, reason: r.error || 'MEDIA_URL_MISSING' };
    var size = Number(r.json.file_size) || 0;
    if (size > MAX_MEDIA_BYTES) return { ok: false, reason: 'MEDIA_TOO_LARGE' };
    var u; try { u = new URL(r.json.url); } catch (e) { return { ok: false, reason: 'MEDIA_URL_INVALID' }; }
    if (u.protocol !== 'https:' && !/^(127\.|localhost$)/.test(u.hostname)) return { ok: false, reason: 'MEDIA_URL_SCHEME' };
    var mod = u.protocol === 'https:' ? https : http;
    return new Promise(function (resolve) {
      var done = false; var finish = function (x) { if (!done) { done = true; resolve(x); } };
      var req = mod.request({ host: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname + u.search, method: 'GET', headers: { Authorization: 'Bearer ' + key.value }, timeout: o.timeoutMs || 20000 }, function (res) {
        var chunks = [], n = 0;
        res.on('data', function (c) { n += c.length; if (n > MAX_MEDIA_BYTES) { req.destroy(new Error('too large')); return; } chunks.push(c); });
        res.on('end', function () { if (res.statusCode !== 200) return finish({ ok: false, reason: 'HTTP ' + res.statusCode }); finish({ ok: true, mime_type: r.json.mime_type || res.headers['content-type'] || null, size_bytes: n, sha256: crypto.createHash('sha256').update(Buffer.concat(chunks)).digest('hex'), bytes: Buffer.concat(chunks) }); });
      });
      req.on('timeout', function () { req.destroy(new Error('timeout')); });
      req.on('error', function (e) { finish({ ok: false, reason: 'TRANSPORT: ' + String(e && e.message || e).slice(0, 80) }); });
      req.end();
    });
  });
}

module.exports = { id: ID, ID: ID, channel: CHANNEL, describe: describe, capabilities: capabilities, configured: configured, parseInbound: parseInbound, verifyWebhook: verifyWebhook, sendText: sendText, sendTemplate: sendTemplate, listTemplates: listTemplates, createTemplate: createTemplate, deleteTemplate: deleteTemplate, health: health, fetchMedia: fetchMedia, payloadHash: payloadHash, redactDeep: redactDeep, readApiKey: readApiKey, baseUrl: baseUrl, graph: graph, normalizeTemplate: normalizeTemplate, TEMPLATE_STATUS: TEMPLATE_STATUS, STRIP_KEYS: STRIP_KEYS };
