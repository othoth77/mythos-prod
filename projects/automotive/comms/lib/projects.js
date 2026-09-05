'use strict';
// =====================================================
// MYTHOS AUTO customer communication — multi-project configuration model
// projects/automotive/comms/lib/projects.js
//
// One communication layer, many commercial projects:
//
//   MYTHOS AUTO
//   ├── ssangyong.autos     first commercial target
//   ├── piece.autos         future
//   ├── casse.autos         future
//   └── …
//
// A project is the unit that owns catalogue, stock, prices, suppliers,
// agents and business rules. The communication layer knows a project only
// by (a) which CRM inboxes belong to it, (b) which WhatsApp provider sits
// behind those inboxes, and (c) which business handler receives its
// messages. Nothing here is hard-coded to ssangyong.autos: the example
// configuration lists it, the code does not know it exists.
//
// SECRETS NEVER LIVE IN THIS FILE. The configuration names *files* that hold
// tokens (`*_file`, 0600, outside Git) exactly like the bridge's
// notification `*_API_KEY_FILE` convention. A literal that looks like a token,
// or a key named like a credential without the `_file` suffix, is a
// validation problem that refuses the whole configuration.
//
// This module reads the configuration file and nothing else (no network).
// =====================================================

var fs = require('fs');
var os = require('os');
var path = require('path');

var envelope = require('./envelope');
var crmRegistry = require('./crm');
var fence = require('../../../mythos-ai-executor/bridge/notify/whatsapp');

var SCHEMA = 'mythos-auto-comms-config/1';
var HANDLERS = ['handoff'];
// Any configured key whose NAME looks like a credential must end in `_file`.
var CREDENTIAL_KEY_RE = /(token|key|password|passwd|secret|credential)$/i;
var FILE_KEY_RE = /_file$/;
var INBOX_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;

function expandHome(p) {
  if (typeof p !== 'string') return p;
  if (p === '~') return os.homedir();
  if (p.indexOf('~/') === 0) return path.join(os.homedir(), p.slice(2));
  return p;
}

function hostOf(baseUrl) {
  try { return new URL(String(baseUrl)).hostname; } catch (e) { return null; }
}

// Walks every object and reports a credential-looking key that carries a
// literal value instead of naming a file. Names only, never the value.
function credentialLiterals(node, trail, out) {
  if (Array.isArray(node)) { node.forEach(function (n, i) { credentialLiterals(n, trail + '[' + i + ']', out); }); return out; }
  if (!node || typeof node !== 'object') return out;
  Object.keys(node).forEach(function (k) {
    var v = node[k];
    var here = trail ? trail + '.' + k : k;
    if (CREDENTIAL_KEY_RE.test(k) && !FILE_KEY_RE.test(k) && typeof v === 'string' && v) out.push(here);
    if (FILE_KEY_RE.test(k) && typeof v === 'string' && /^[A-Za-z0-9+/=_-]{32,}$/.test(v) && v.indexOf('/') === -1) out.push(here + ' (value is not a path)');
    credentialLiterals(v, here, out);
  });
  return out;
}

function load(file) {
  var raw = fs.readFileSync(file, 'utf8');
  return JSON.parse(raw);
}

// Every static problem, as a name that is safe to print. An empty array is
// the only "ready" answer; the router refuses a configuration with any
// problem at all rather than routing half of the projects.
function validate(cfg) {
  var p = [];
  if (!cfg || typeof cfg !== 'object') return ['CONFIG_NOT_OBJECT'];
  if (cfg.schema !== SCHEMA) p.push('CONFIG_SCHEMA');

  var crm = cfg.crm || {};
  if (!crm.adapter || !crmRegistry.ADAPTERS[crm.adapter]) p.push('CRM_ADAPTER_UNKNOWN');
  var host = hostOf(crm.base_url);
  if (!host) p.push('CRM_BASE_URL');
  else if (!fence.isPrivateHost(host) && crm.allow_public !== true) p.push('CRM_BASE_URL_NOT_PRIVATE');
  if (!crm.api_token_file || typeof crm.api_token_file !== 'string') p.push('CRM_API_TOKEN_FILE');
  if (!crm.webhook_token_file || typeof crm.webhook_token_file !== 'string') p.push('CRM_WEBHOOK_TOKEN_FILE');

  credentialLiterals(cfg, '', []).forEach(function (k) { p.push('CREDENTIAL_LITERAL:' + k); });

  var projects = Array.isArray(cfg.projects) ? cfg.projects : null;
  if (!projects || !projects.length) { p.push('PROJECTS_EMPTY'); return p; }
  var ids = {};
  var inboxes = {};
  projects.forEach(function (pr, i) {
    var tag = 'projects[' + i + ']';
    if (!pr || typeof pr !== 'object') { p.push(tag + ':NOT_OBJECT'); return; }
    if (!envelope.PROJECT_ID_RE.test(String(pr.id || ''))) p.push(tag + ':PROJECT_ID');
    else if (ids[pr.id]) p.push(tag + ':PROJECT_ID_DUPLICATE'); else ids[pr.id] = true;
    var pc = pr.crm || {};
    if (pc.account_id === undefined || pc.account_id === null || !INBOX_ID_RE.test(String(pc.account_id))) p.push(tag + ':CRM_ACCOUNT_ID');
    var ib = Array.isArray(pc.inbox_ids) ? pc.inbox_ids : [];
    if (!ib.length) p.push(tag + ':CRM_INBOX_IDS_EMPTY');
    ib.forEach(function (id) {
      var key = String(pc.account_id) + '/' + String(id);
      if (!INBOX_ID_RE.test(String(id))) p.push(tag + ':CRM_INBOX_ID');
      else if (inboxes[key]) p.push(tag + ':CRM_INBOX_SHARED:' + key); else inboxes[key] = pr.id;
    });
    var wa = pr.whatsapp || {};
    if (!envelope.PROVIDERS.hasOwnProperty(wa.provider)) p.push(tag + ':WHATSAPP_PROVIDER');
    else if (envelope.providerClass(wa.provider) === 'unofficial' && wa.unofficial_acknowledged !== true) p.push(tag + ':WHATSAPP_PROVIDER_UNOFFICIAL_NOT_ACKNOWLEDGED');
    var biz = pr.business || {};
    if (biz.handler !== undefined && HANDLERS.indexOf(biz.handler) === -1) p.push(tag + ':BUSINESS_HANDLER_UNKNOWN');
    if (biz.auto_reply !== undefined && typeof biz.auto_reply !== 'boolean') p.push(tag + ':BUSINESS_AUTO_REPLY_NOT_BOOLEAN');
    if (biz.catalog_api !== undefined) {
      var ch = hostOf(biz.catalog_api);
      if (!ch) p.push(tag + ':BUSINESS_CATALOG_API');
      else if (!fence.isPrivateHost(ch) && biz.catalog_api_allow_public !== true) p.push(tag + ':BUSINESS_CATALOG_API_NOT_PRIVATE');
    }
  });
  return p;
}

// (account_id, inbox_id) → project, or null. The pair is the CRM's own
// addressing, so a new project is one entry in the configuration and no
// code change.
function resolve(cfg, ref) {
  ref = ref || {};
  var projects = (cfg && Array.isArray(cfg.projects)) ? cfg.projects : [];
  var acc = ref.account_id === undefined || ref.account_id === null ? null : String(ref.account_id);
  var inbox = ref.inbox_id === undefined || ref.inbox_id === null ? null : String(ref.inbox_id);
  if (acc === null || inbox === null) return null;
  for (var i = 0; i < projects.length; i++) {
    var pr = projects[i];
    var pc = (pr && pr.crm) || {};
    if (String(pc.account_id) !== acc) continue;
    var ib = Array.isArray(pc.inbox_ids) ? pc.inbox_ids : [];
    for (var j = 0; j < ib.length; j++) if (String(ib[j]) === inbox) return pr;
  }
  return null;
}

// Effective per-project policy with the safe defaults spelled out: no
// handler → hand off to a human agent; no auto_reply → never send.
function policy(project) {
  var biz = (project && project.business) || {};
  return {
    handler: biz.handler || 'handoff',
    auto_reply: biz.auto_reply === true,
    catalog_api: biz.catalog_api || null
  };
}

// Never contains a value read from a `*_file` — only whether the path is
// set, for the same reason `notify-config` prints `credential_present`.
function describe(cfg) {
  cfg = cfg || {};
  var crm = cfg.crm || {};
  return {
    schema: cfg.schema || null,
    crm: {
      adapter: crm.adapter || null,
      base_url_host: hostOf(crm.base_url),
      base_url_private: hostOf(crm.base_url) ? fence.isPrivateHost(hostOf(crm.base_url)) : null,
      api_token_file_set: typeof crm.api_token_file === 'string' && !!crm.api_token_file,
      webhook_token_file_set: typeof crm.webhook_token_file === 'string' && !!crm.webhook_token_file
    },
    projects: (Array.isArray(cfg.projects) ? cfg.projects : []).map(function (pr) {
      pr = pr || {};
      var pol = policy(pr);
      return {
        id: pr.id || null,
        display_name: pr.display_name || null,
        languages: Array.isArray(pr.languages) ? pr.languages : [],
        crm_account_id: pr.crm ? String(pr.crm.account_id) : null,
        crm_inbox_ids: pr.crm && Array.isArray(pr.crm.inbox_ids) ? pr.crm.inbox_ids.map(String) : [],
        whatsapp_provider: pr.whatsapp ? pr.whatsapp.provider : null,
        whatsapp_provider_class: pr.whatsapp ? envelope.providerClass(pr.whatsapp.provider) : null,
        handler: pol.handler,
        auto_reply: pol.auto_reply,
        catalog_api_host: pol.catalog_api ? hostOf(pol.catalog_api) : null
      };
    }),
    problems: validate(cfg)
  };
}

module.exports = {
  SCHEMA: SCHEMA,
  HANDLERS: HANDLERS,
  expandHome: expandHome,
  load: load,
  validate: validate,
  resolve: resolve,
  policy: policy,
  describe: describe
};
