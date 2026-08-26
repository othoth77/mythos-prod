'use strict';
// =====================================================
// OTHMODE — API routes
// projects/command-center/reference/othmode/routes.js
//
// Mounted by api.js next to the MCC routes, under the same server, auth
// and secret gate. Route contract matches api.js ROUTES with one addition:
// `role: 'owner'` marks endpoints only the owner identity may call
// (none are currently routed — the mechanism stays for future owner
// surfaces; HIGH-risk review approval enforcement happens inside
// evolution.addStage with the caller's role).
//
// Read endpoints for the new surfaces require a valid token (`auth: true`):
// unlike the public command library, memory/evolution/history expose
// operational detail — see docs/othmode/OTHMODE_SECURITY.md §2.3.
// =====================================================

var path = require('path');
var secrets = require('../secrets.js');
var resolve = require('./resolve.js');
var registries = require('./registries.js');
var healthMod = require('./health.js');
var history = require('./history.js');
var memory = require('./memory.js');
var evolution = require('./evolution.js');
var store = require('./store.js');
var sessions = require('./sessions.js');
var activation = require('./activation.js');
var tasks = require('./tasks.js');

function sendJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(body));
}

function inputError(res, err) {
  if (err && (err.code === 'OTHMODE_EVOLUTION_INPUT' || err.code === 'OTHMODE_HEALTH_INPUT' || err.code === 'OTHMODE_TASK_INPUT')) {
    return sendJson(res, 400, { error: err.message });
  }
  if (err && err.code === 'OTHMODE_STORE_ABSENT') {
    return sendJson(res, 409, { error: err.message, provisioned: false });
  }
  if (err && err.code === 'OTHMODE_REVIEW_FORBIDDEN') {
    return sendJson(res, 403, { error: err.message });
  }
  throw err;
}

// The same secret gate as the command library, on every OTHMODE write
// surface: recovery notes, signal descriptions, evolution evidence and
// stage data must never carry a credential into the store.
function enforceNoSecrets(res, body) {
  var fields = {};
  ['description', 'rationale', 'note', 'trigger', 'title'].forEach(function (k) {
    if (body && typeof body[k] === 'string') fields[k] = body[k];
  });
  if (body && Array.isArray(body.evidence_texts)) fields.evidence = body.evidence_texts.join('\n');
  if (body && body.data) fields.data = JSON.stringify(body.data);
  // Task Reports carry structured sections: scan the WHOLE payload — a
  // credential must not enter the persistent record through any field.
  if (body && body.sections) fields.sections = JSON.stringify(body.sections);
  if (body && typeof body.command === 'string') fields.command = body.command;
  var report = secrets.scan(fields);
  if (report.blocked) {
    sendJson(res, 422, {
      error: 'refused: content matches a known credential format',
      findings: report.findings,
      guidance: 'Remove the credential and reference it by environment-variable name instead. If this value is real, treat it as leaked and rotate it.'
    });
    return false;
  }
  return true;
}

// The identity string from auth.js IS the role: 'owner' is the owner role;
// any other authenticated identity is an editor.
function roleOf(identity) {
  if (!identity) return null;
  return identity === 'owner' ? 'owner' : 'editor';
}

// db is injected at mount time by api.js so history can read
// mcc_usage_events through the same pool as everything else.
function buildRoutes(db, auth) {

  function identityRole(req) { return roleOf(auth.identityFromRequest(req)); }

  return [

    // ── Token-free sign-in: one-time login link → HttpOnly session ───────
    // GET /auth/<code>. The code was minted by the operator CLI and is
    // burned on first use. On success the browser gets an HttpOnly;
    // Secure; SameSite=Strict cookie and a redirect to the app — no
    // secret ever reaches page JavaScript, storage, or the URL bar after
    // the redirect. On failure: plain 403, no hints, no logging of codes.
    { method: 'GET', auth: false, pattern: /^\/auth\/([A-Za-z0-9_-]{20,120})$/, handler: function (req, res, m) {
      var exchanged = sessions.exchangeCode(m[1]);
      if (!exchanged) {
        return sendJson(res, 403, { error: 'invalid or expired login link — mint a new one with: othmode-cli.js login-link' });
      }
      res.writeHead(302, {
        'Location': '/',
        'Cache-Control': 'no-store',
        'Set-Cookie': 'oth_session=' + exchanged.sessionId +
          '; Path=/; Max-Age=' + Math.floor(sessions.SESSION_TTL_MS / 1000) +
          '; HttpOnly; Secure; SameSite=Strict'
      });
      return res.end();
    } },

    // Sign out: burns the server-side session and clears the cookie.
    { method: 'POST', auth: true, pattern: /^\/api\/othmode\/logout$/, handler: function (req, res) {
      var sessionId = auth.sessionIdFromRequest(req);
      if (sessionId) sessions.revokeSession(sessionId);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Set-Cookie': 'oth_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict'
      });
      return res.end(JSON.stringify({ signed_out: true }));
    } },

    // ── Registries (read models; no new writers) ─────────────────────────
    { method: 'GET', auth: false, pattern: /^\/api\/othmode\/skills$/, handler: function (req, res) {
      return sendJson(res, 200, registries.skills());
    } },
    { method: 'GET', auth: false, pattern: /^\/api\/othmode\/skills\/([^/]+)$/, handler: function (req, res, m) {
      var detail = registries.skillDetail(decodeURIComponent(m[1]));
      return detail ? sendJson(res, 200, { skill: detail }) : sendJson(res, 404, { error: 'not found' });
    } },
    { method: 'GET', auth: false, pattern: /^\/api\/othmode\/tools$/, handler: function (req, res) {
      return sendJson(res, 200, registries.tools());
    } },
    { method: 'GET', auth: false, pattern: /^\/api\/othmode\/providers$/, handler: function (req, res) {
      return sendJson(res, 200, registries.providers());
    } },
    { method: 'GET', auth: false, pattern: /^\/api\/othmode\/projects$/, handler: function (req, res) {
      return sendJson(res, 200, registries.projects());
    } },

    // ── Health + recovery ────────────────────────────────────────────────
    { method: 'GET', auth: false, pattern: /^\/api\/othmode\/health$/, handler: function (req, res) {
      return sendJson(res, 200, healthMod.overview());
    } },
    { method: 'POST', auth: true, pattern: /^\/api\/othmode\/health\/recovery$/, handler: function (req, res, m, q, body) {
      if (!enforceNoSecrets(res, body)) return;
      try {
        var rec = healthMod.recordRecoveryStep(body, auth.identityFromRequest(req));
        return sendJson(res, 201, { record: rec });
      } catch (e) { return inputError(res, e); }
    } },

    // ── Status — read-only view over the Status Center (execution truth
    //    lives THERE; OTHMODE never writes it) ────────────────────────────
    { method: 'GET', auth: false, pattern: /^\/api\/othmode\/status$/, handler: function (req, res) {
      var current = resolve.readJson(path.join(resolve.statusDataDir(), 'current.json'));
      return sendJson(res, 200, {
        authority: 'Status Center (status.mythosprod.xyz) — execution truth lives there; this is a read-only view.',
        available: current.ok,
        reason: current.ok ? null : current.reason + ' on this host',
        current: current.ok ? {
          review_id: current.data.review_id || null,
          timestamp: current.data.timestamp || null,
          head: current.data.git && current.data.git.head ? current.data.git.head : null,
          branch: current.data.git && current.data.git.branch ? current.data.git.branch : null
        } : null,
        link: 'https://status.mythosprod.xyz/'
      });
    } },

    // ── Unified command history ──────────────────────────────────────────
    { method: 'GET', auth: true, pattern: /^\/api\/othmode\/history$/, handler: async function (req, res, m, q) {
      return sendJson(res, 200, await history.unified(db, q));
    } },

    // ── OTHMODE Task Reports (persistent operational record) ─────────────
    // Every othmode-activated command is a task: created RUNNING, finished
    // in one terminal status. Full detail lives HERE; Claude replies with a
    // short receipt only. Writes are authenticated and secret-gated like
    // every other OTHMODE write; the writer itself refuses normal Claude
    // commands (no standalone keyword → no task, ever).
    { method: 'GET', auth: true, pattern: /^\/api\/othmode\/tasks$/, handler: function (req, res, m, q) {
      return sendJson(res, 200, tasks.listTasks(q));
    } },
    { method: 'GET', auth: true, pattern: /^\/api\/othmode\/tasks\/([^/]+)$/, handler: function (req, res, m) {
      var task = tasks.getTask(decodeURIComponent(m[1]));
      return task ? sendJson(res, 200, { task: task }) : sendJson(res, 404, { error: 'not found' });
    } },
    { method: 'POST', auth: true, pattern: /^\/api\/othmode\/tasks$/, handler: function (req, res, m, q, body) {
      if (!enforceNoSecrets(res, body)) return;
      try { return sendJson(res, 201, { task: tasks.createTask(body || {}, auth.identityFromRequest(req)) }); }
      catch (e) { return inputError(res, e); }
    } },
    { method: 'POST', auth: true, pattern: /^\/api\/othmode\/tasks\/([^/]+)\/update$/, handler: function (req, res, m, q, body) {
      if (!enforceNoSecrets(res, body)) return;
      try { return sendJson(res, 201, { task: tasks.updateTask(decodeURIComponent(m[1]), body || {}, auth.identityFromRequest(req)) }); }
      catch (e) { return inputError(res, e); }
    } },

    // ── Memory (read-first; ingestion stays on the operator CLI) ─────────
    { method: 'GET', auth: true, pattern: /^\/api\/othmode\/memory\/status$/, handler: function (req, res) {
      return sendJson(res, 200, memory.status());
    } },
    { method: 'GET', auth: true, pattern: /^\/api\/othmode\/memory\/search$/, handler: function (req, res, m, q) {
      return sendJson(res, 200, memory.search(q.q, q.limit));
    } },
    { method: 'GET', auth: true, pattern: /^\/api\/othmode\/memory\/provenance\/([^/]+)$/, handler: function (req, res, m) {
      return sendJson(res, 200, memory.provenance(decodeURIComponent(m[1])));
    } },

    // ── Evolution ────────────────────────────────────────────────────────
    { method: 'GET', auth: true, pattern: /^\/api\/othmode\/evolution\/events$/, handler: function (req, res) {
      return sendJson(res, 200, evolution.listEvents());
    } },
    { method: 'POST', auth: true, pattern: /^\/api\/othmode\/evolution\/events$/, handler: function (req, res, m, q, body) {
      if (!enforceNoSecrets(res, body)) return;
      try { return sendJson(res, 201, { event: evolution.createEvent(body, auth.identityFromRequest(req)) }); }
      catch (e) { return inputError(res, e); }
    } },
    { method: 'POST', auth: true, pattern: /^\/api\/othmode\/evolution\/events\/([^/]+)\/stages$/, handler: function (req, res, m, q, body) {
      if (!enforceNoSecrets(res, body)) return;
      try {
        var stage = evolution.addStage(decodeURIComponent(m[1]), body, auth.identityFromRequest(req), identityRole(req));
        return sendJson(res, 201, { stage: stage });
      } catch (e) { return inputError(res, e); }
    } },
    { method: 'GET', auth: true, pattern: /^\/api\/othmode\/evolution\/signals$/, handler: function (req, res) {
      return sendJson(res, 200, evolution.listSignals());
    } },
    { method: 'POST', auth: true, pattern: /^\/api\/othmode\/evolution\/signals$/, handler: function (req, res, m, q, body) {
      if (!enforceNoSecrets(res, body)) return;
      try { return sendJson(res, 201, { signal: evolution.recordSignal(body, auth.identityFromRequest(req)) }); }
      catch (e) { return inputError(res, e); }
    } },
    { method: 'POST', auth: true, pattern: /^\/api\/othmode\/evolution\/signals\/([^/]+)\/disposition$/, handler: function (req, res, m, q, body) {
      if (!enforceNoSecrets(res, body)) return;
      try {
        var rec = evolution.setDisposition(decodeURIComponent(m[1]), body.disposition, body.rationale, auth.identityFromRequest(req));
        return sendJson(res, 201, { disposition: rec });
      } catch (e) { return inputError(res, e); }
    } },
    { method: 'POST', auth: true, pattern: /^\/api\/othmode\/evolution\/selector$/, handler: function (req, res, m, q, body) {
      // A proposal, never an approval — pure function, records nothing.
      return sendJson(res, 200, evolution.selectorPropose(body || {}));
    } },
    { method: 'GET', auth: true, pattern: /^\/api\/othmode\/evolution\/genes$/, handler: function (req, res) {
      return sendJson(res, 200, { genes: evolution.listGenes() });
    } },
    { method: 'GET', auth: true, pattern: /^\/api\/othmode\/evolution\/genes\/([^/]+)$/, handler: function (req, res, m) {
      var g = evolution.geneDetail(decodeURIComponent(m[1]));
      return g ? sendJson(res, 200, g) : sendJson(res, 404, { error: 'not found' });
    } },
    { method: 'GET', auth: true, pattern: /^\/api\/othmode\/evolution\/capsules$/, handler: function (req, res) {
      return sendJson(res, 200, { capsules: evolution.listCapsules() });
    } },
    { method: 'GET', auth: true, pattern: /^\/api\/othmode\/evolution\/rollback$/, handler: function (req, res) {
      return sendJson(res, 200, evolution.rollbackView());
    } },

    // ── Open Source Registry (Search First evidence; Git-curated file) ───
    { method: 'GET', auth: false, pattern: /^\/api\/othmode\/oss-registry$/, handler: function (req, res) {
      var reg = resolve.cachedJson(resolve.repoPath('projects', 'command-center', 'data', 'open-source-registry.json'));
      return sendJson(res, 200, reg.ok ? reg.data : { error: 'registry ' + reg.reason, records: [] });
    } },

    // ── OTHMODE availability + per-command activation ────────────────────
    // There is NO global switch any more. OTHMODE is always available;
    // a command activates it by containing the standalone keyword
    // "othmode" (activation.js is the single source of that rule). The
    // old /api/othmode/mode path is kept as a read-only availability
    // report so nothing that watched it breaks; its POST is gone — there
    // is deliberately no state to write.
    { method: 'GET', auth: false, pattern: /^\/api\/othmode\/mode$/, handler: function (req, res) {
      return sendJson(res, 200, activation.availability());
    } },
    // Deterministic activation check for tooling and tests. Stores
    // nothing, grants nothing: the keyword selects a control contract,
    // never a permission. AUTHENTICATED on purpose — the MCC security
    // invariant allows exactly two unauthenticated POST routes (usage,
    // render) and this must not become a third; credential-free checks
    // use the CLI (`othmode-cli.js activation`) instead.
    { method: 'POST', auth: true, pattern: /^\/api\/othmode\/activation$/, handler: function (req, res, m, q, body) {
      var text = body && typeof body.text === 'string' ? body.text : '';
      return sendJson(res, 200, {
        activated: activation.isActivated(text),
        classification: activation.classify(text),
        keyword: activation.KEYWORD
      });
    } }
  ];
}

module.exports = { buildRoutes: buildRoutes, roleOf: roleOf };
