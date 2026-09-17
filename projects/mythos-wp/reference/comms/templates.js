'use strict';
// =====================================================
// MYTHOS WP V2 — message templates (builder A)
// projects/mythos-wp/reference/comms/templates.js
//
// wp_templates: local drafts for every provider (unofficial providers send the
// rendered text verbatim) and Meta-synced templates (provider meta_cloud,
// provider_template_id, status from the WABA). Placeholders: {{1}} positional
// and {{name}} named; render() leaves a missing placeholder in place and lists
// it in `missing`. Sync needs the meta_cloud provider configured (0600 token
// file) AND a WABA id (wp_wa_accounts.external_ref, provider meta_cloud) → 412
// META_CLOUD_NOT_CONFIGURED otherwise. Test sends go through outbound.send
// (client_ref 'tpl-<id>-<ts>'), i.e. the normal policy path.
// =====================================================
var outbound = require('./outbound');
var meta = require('./providers/meta_cloud');
var NAME_RE = /^[a-z0-9_]{1,120}$/;
var LANG_RE = /^[a-z]{2}(_[A-Z]{2})?$/;
var CATEGORIES = { MARKETING: true, UTILITY: true, AUTHENTICATION: true };
var STATUSES = { draft: true, pending: true, approved: true, rejected: true, paused: true };
var PLACEHOLDER_RE = /\{\{\s*([A-Za-z0-9_]{1,40})\s*\}\}/g;
var COLS = 't.id, t.project_id, t.phone_number_id, t.name, t.language, t.category, t.status, t.header, t.body, t.footer, t.variables, t.buttons, t.provider, t.provider_template_id, t.rejection_reason, t.last_synced_at, t.created_by, t.updated_by, t.created_at, t.updated_at';
function fail(code, status, detail) { var e = new Error(detail || code); e.code = code; e.status = status; return e; }

// render(template, variables) → { text, missing:[names], used:[names] }
function render(t, variables) {
  t = t || {}; var vars = variables === undefined || variables === null ? {} : variables;
  var lookup = function (name) {
    if (Array.isArray(vars)) { var i = parseInt(name, 10); return i >= 1 && i <= vars.length && vars[i - 1] !== undefined && vars[i - 1] !== null ? String(vars[i - 1]) : undefined; }
    if (typeof vars !== 'object') return undefined;
    var v = vars[name]; return v === undefined || v === null ? undefined : String(v);
  };
  var missing = {}, used = {};
  var sub = function (s) { if (typeof s !== 'string' || !s) return s || null; return s.replace(PLACEHOLDER_RE, function (m, name) { var v = lookup(name); if (v === undefined) { missing[name] = true; return '{{' + name + '}}'; } used[name] = true; return v; }); };
  var parts = [sub(t.header), sub(t.body), sub(t.footer)].filter(function (x) { return typeof x === 'string' && x.trim(); });
  return { text: parts.join('\n'), missing: Object.keys(missing), used: Object.keys(used) };
}
function placeholders(t) { var names = {}; [t.header, t.body, t.footer].forEach(function (s) { if (typeof s !== 'string') return; var m; PLACEHOLDER_RE.lastIndex = 0; while ((m = PLACEHOLDER_RE.exec(s)) !== null) names[m[1]] = true; }); return Object.keys(names); }

function validate(body, partial) {
  body = body || {}; var out = {};
  if (!partial || body.name !== undefined) { if (!NAME_RE.test(String(body.name || ''))) throw fail('validation', 400, 'name: lowercase letters, digits, underscore (1–120)'); out.name = String(body.name); }
  if (!partial || body.language !== undefined) { var l = body.language === undefined ? 'fr' : String(body.language); if (!LANG_RE.test(l)) throw fail('validation', 400, 'language shape (fr, ar, en_US…)'); out.language = l.slice(0, 8); }
  if (!partial || body.category !== undefined) { var c = String(body.category === undefined ? 'UTILITY' : body.category).toUpperCase(); if (!CATEGORIES[c]) throw fail('validation', 400, 'category MARKETING|UTILITY|AUTHENTICATION'); out.category = c; }
  if (!partial || body.body !== undefined) { var b = String(body.body || ''); if (!b.trim() || b.length > 4000) throw fail('validation', 400, 'body 1–4000 characters'); out.body = b; }
  if (body.header !== undefined) { if (body.header !== null && String(body.header).length > 200) throw fail('validation', 400, 'header ≤ 200'); out.header = body.header ? String(body.header) : null; }
  if (body.footer !== undefined) { if (body.footer !== null && String(body.footer).length > 200) throw fail('validation', 400, 'footer ≤ 200'); out.footer = body.footer ? String(body.footer) : null; }
  if (body.status !== undefined) { if (!STATUSES[body.status]) throw fail('validation', 400, 'status draft|pending|approved|rejected|paused'); out.status = body.status; }
  if (body.variables !== undefined) { if (!Array.isArray(body.variables) || body.variables.length > 50 || !body.variables.every(function (v) { return v && typeof v === 'object' && /^[A-Za-z0-9_]{1,40}$/.test(String(v.name || '')); })) throw fail('validation', 400, 'variables: [{ name, example }]'); out.variables = body.variables.map(function (v) { return { name: String(v.name), example: v.example === undefined || v.example === null ? null : String(v.example).slice(0, 200) }; }); }
  if (body.buttons !== undefined) { if (!Array.isArray(body.buttons) || body.buttons.length > 10 || JSON.stringify(body.buttons).length > 4000) throw fail('validation', 400, 'buttons: small array'); out.buttons = body.buttons; }
  if (body.project_id !== undefined) out.project_id = body.project_id === null || body.project_id === '' || body.project_id === 'all' ? null : String(body.project_id);
  if (body.phone_number_id !== undefined) { var p = body.phone_number_id === null || body.phone_number_id === '' ? null : parseInt(body.phone_number_id, 10); if (body.phone_number_id !== null && body.phone_number_id !== '' && !p) throw fail('validation', 400, 'phone_number_id shape'); out.phone_number_id = p; }
  return out;
}
function withMeta(row) { row.placeholders = placeholders(row); return row; }
// list(pool, { project: id|'all'|undefined, accessible: [ids]|null }) — shared rows (project_id NULL) are always listed
function list(pool, o) {
  o = o || {}; var params = []; var where = [];
  if (o.project && o.project !== 'all') { params.push(String(o.project)); where.push('(t.project_id = $' + params.length + ' OR t.project_id IS NULL)'); }
  else if (Array.isArray(o.accessible)) { params.push(o.accessible.length ? o.accessible : ['-']); where.push('(t.project_id IS NULL OR t.project_id = ANY($' + params.length + '::text[]))'); }
  if (o.status && STATUSES[o.status]) { params.push(o.status); where.push('t.status = $' + params.length); }
  return pool.query('SELECT ' + COLS + ' FROM wp_templates t' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY t.project_id NULLS FIRST, t.name, t.language', params).then(function (r) { return r.rows.map(withMeta); });
}
function get(pool, id) {
  return pool.query('SELECT ' + COLS + ' FROM wp_templates t WHERE t.id = $1', [id]).then(function (r) { if (!r.rows[0]) throw fail('not_found', 404, 'no such template'); return withMeta(r.rows[0]); });
}
function create(pool, actor, body) {
  var v = validate(body, false);
  return pool.query('INSERT INTO wp_templates (project_id, phone_number_id, name, language, category, status, header, body, footer, variables, buttons, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) RETURNING id', [v.project_id || null, v.phone_number_id || null, v.name, v.language, v.category, v.status || 'draft', v.header || null, v.body, v.footer || null, JSON.stringify(v.variables || []), JSON.stringify(v.buttons || []), actor])
    .then(function (r) { return get(pool, r.rows[0].id); }, function (e) { if (/wp_templates_uidx/.test(e.message + (e.constraint || ''))) throw fail('conflict', 409, 'a template with this name and language exists in this scope'); if (/wp_templates_project_id_fkey/.test(e.message + (e.constraint || ''))) throw fail('not_found', 404, 'unknown project'); if (/wp_templates_phone_number_id_fkey/.test(e.message + (e.constraint || ''))) throw fail('validation', 400, 'no such number'); throw e; });
}
function update(pool, id, actor, patch) {
  var v = validate(patch, true); var sets = [], params = [id];
  Object.keys(v).forEach(function (k) { params.push(k === 'variables' || k === 'buttons' ? JSON.stringify(v[k]) : v[k]); sets.push(k + ' = $' + params.length); });
  if (!sets.length) throw fail('validation', 400, 'nothing to change');
  params.push(actor); sets.push('updated_by = $' + params.length); sets.push('updated_at = now()');
  return pool.query('UPDATE wp_templates SET ' + sets.join(', ') + ' WHERE id = $1 RETURNING id', params).then(function (r) { if (!r.rows[0]) throw fail('not_found', 404, 'no such template'); return get(pool, id); }, function (e) { if (/wp_templates_uidx/.test(e.message + (e.constraint || ''))) throw fail('conflict', 409, 'a template with this name and language exists in this scope'); throw e; });
}
function remove(pool, id) {
  return pool.query('DELETE FROM wp_templates WHERE id = $1 RETURNING id', [id]).then(function (r) { if (!r.rows[0]) throw fail('not_found', 404, 'no such template'); return { id: id, deleted: true }; });
}
// preview(pool, id, variables) → { text, missing, used }
function preview(pool, id, variables) { return get(pool, id).then(function (t) { return render(t, variables); }); }

// ---- Meta sync ------------------------------------------------------------------
// wabaFor(pool, template) → waba id from the template's number's account, else the first active meta_cloud account
function wabaFor(pool, t) {
  var byNumber = t && t.phone_number_id ? pool.query("SELECT a.external_ref FROM wp_phone_numbers p JOIN wp_wa_accounts a ON a.id = p.account_id WHERE p.id = $1 AND a.provider = 'meta_cloud' AND a.status = 'active'", [t.phone_number_id]) : Promise.resolve({ rows: [] });
  return byNumber.then(function (r) {
    if (r.rows[0] && r.rows[0].external_ref) return r.rows[0].external_ref;
    return pool.query("SELECT external_ref FROM wp_wa_accounts WHERE provider = 'meta_cloud' AND status = 'active' AND external_ref IS NOT NULL ORDER BY id LIMIT 1").then(function (x) { return x.rows[0] ? x.rows[0].external_ref : null; });
  });
}
function notConfigured(detail) { var e = fail('precondition', 412, detail || 'Meta Cloud API is not configured'); e.reason = 'META_CLOUD_NOT_CONFIGURED'; e.errors = { reason: 'META_CLOUD_NOT_CONFIGURED' }; return e; }
function requireMeta(pool, t) {
  var d = meta.describe();
  if (!meta.readApiKey().present) throw notConfigured('Meta Cloud API token unavailable: ' + d.problems.join('; '));
  return wabaFor(pool, t).then(function (waba) { if (!waba) throw notConfigured('no meta_cloud business account with a WABA id (wp_wa_accounts.external_ref)'); return waba; });
}
function applyRemote(pool, id, remote) {
  return pool.query("UPDATE wp_templates SET provider = 'meta_cloud', provider_template_id = COALESCE($2, provider_template_id), status = $3, rejection_reason = $4, last_synced_at = now(), updated_at = now() WHERE id = $1", [id, remote.provider_template_id || null, remote.status || 'pending', remote.rejection_reason || null]);
}
// sync(pool, id, actor) → { template, action: 'created'|'refreshed'|'not_found_remote', waba_masked }
function sync(pool, id, actor) {
  return get(pool, id).then(function (t) {
    return requireMeta(pool, t).then(function (waba) {
      var wabaMasked = '…' + String(waba).slice(-4);
      return meta.listTemplates(waba, { name: t.name }).then(function (r) {
        if (!r.ok) throw fail('upstream', 502, 'Meta template lookup failed: ' + r.error);
        var remote = r.items.filter(function (x) { return x.name === t.name && x.language === t.language; })[0] || null;
        if (remote) return applyRemote(pool, id, remote).then(function () { return get(pool, id); }).then(function (row) { return { template: row, action: 'refreshed', waba_masked: wabaMasked }; });
        var examples = Array.isArray(t.variables) ? t.variables.map(function (v) { return v.example || v.name; }) : [];
        return meta.createTemplate(waba, { name: t.name, language: t.language, category: t.category, header: t.header, body: t.body, footer: t.footer, buttons: t.buttons, examples: examples }).then(function (c) {
          if (!c.ok) throw fail('upstream', 502, 'Meta template creation refused: ' + c.error);
          return applyRemote(pool, id, { provider_template_id: c.id, status: c.template_status || 'pending', rejection_reason: null }).then(function () { return get(pool, id); }).then(function (row) { return { template: row, action: 'created', waba_masked: wabaMasked }; });
        });
      });
    });
  });
}
// syncAll(pool, actor) → { fetched, created, updated, waba_masked } — every remote template lands as a shared (project NULL) row
function syncAll(pool, actor) {
  return requireMeta(pool, null).then(function (waba) {
    return meta.listTemplates(waba, { limit: 250 }).then(function (r) {
      if (!r.ok) throw fail('upstream', 502, 'Meta template listing failed: ' + r.error);
      var created = 0, updated = 0, chain = Promise.resolve();
      r.items.forEach(function (x) {
        if (!x.name || !NAME_RE.test(x.name) || !x.language || !LANG_RE.test(x.language) || !x.body) return;
        chain = chain.then(function () {
          return pool.query("SELECT id FROM wp_templates WHERE name = $1 AND language = $2 AND (provider = 'meta_cloud' OR project_id IS NULL) ORDER BY project_id NULLS FIRST, id LIMIT 1", [x.name, x.language]).then(function (f) {
            if (f.rows[0]) { updated++; return pool.query("UPDATE wp_templates SET provider = 'meta_cloud', provider_template_id = $2, status = $3, rejection_reason = $4, header = $5, body = $6, footer = $7, buttons = $8, category = $9, last_synced_at = now(), updated_by = $10, updated_at = now() WHERE id = $1", [f.rows[0].id, x.provider_template_id, x.status, x.rejection_reason, x.header, x.body, x.footer, JSON.stringify(x.buttons || []), CATEGORIES[x.category] ? x.category : 'UTILITY', actor]); }
            created++;
            return pool.query("INSERT INTO wp_templates (project_id, name, language, category, status, header, body, footer, buttons, provider, provider_template_id, rejection_reason, last_synced_at, created_by, updated_by) VALUES (NULL,$1,$2,$3,$4,$5,$6,$7,$8,'meta_cloud',$9,$10, now(),$11,$11)", [x.name, x.language, CATEGORIES[x.category] ? x.category : 'UTILITY', x.status, x.header, x.body, x.footer, JSON.stringify(x.buttons || []), x.provider_template_id, x.rejection_reason, actor]);
          });
        });
      });
      return chain.then(function () { return { fetched: r.items.length, created: created, updated: updated, waba_masked: '…' + String(waba).slice(-4) }; });
    });
  });
}
// testSend(pool, projectId, id, actor, { conversation_id, variables }) → outbound.send result (+ rendered length)
function testSend(pool, projectId, id, actor, body) {
  body = body || {};
  var convId = parseInt(body.conversation_id, 10);
  if (!convId) throw fail('validation', 400, 'conversation_id required');
  return get(pool, id).then(function (t) {
    if (t.project_id && t.project_id !== projectId) throw fail('not_found', 404, 'template not available for this project');
    var out = render(t, body.variables);
    if (out.missing.length) { var e = fail('validation', 400, 'missing variables: ' + out.missing.join(', ')); e.errors = { missing: out.missing }; throw e; }
    return outbound.send(pool, projectId, convId, actor, { text: out.text, client_ref: 'tpl-' + t.id + '-' + Date.now() }).then(function (r) { r.template_id = t.id; r.length = out.text.length; return r; });
  });
}
module.exports = { render: render, placeholders: placeholders, list: list, get: get, create: create, update: update, remove: remove, preview: preview, sync: sync, syncAll: syncAll, testSend: testSend, wabaFor: wabaFor, NAME_RE: NAME_RE };
