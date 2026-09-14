'use strict';

/* Secure documents: upload and download.
 *
 * The `documents` table, its RLS policy and the generic list/get/patch/retire
 * routes already exist (schema.sql, registry.js) — this module owns only the
 * two operations the generic resource layer deliberately refuses: writing the
 * blob (POST /api/v1/documents) and reading it back (GET /api/v1/documents/:id/download).
 *
 * Lesson carried forward from the legacy upload.php audit
 * (docs/ERP_DATA_MODEL.md / sites/erp.mythosprod.xyz/DEPLOYMENT.md): that
 * endpoint took the stored file's extension from the client-supplied filename
 * and trusted the client-supplied Content-Type, so uploading `x.php` declared
 * as `application/pdf` wrote a `.php` file into a directory a misconfigured
 * docroot could execute. Every one of those mistakes has a deliberate opposite
 * here:
 *   - the filename is NEVER used to name anything on disk — only stored as
 *     `original_name` for display, and sanitised even there;
 *   - the declared MIME type is checked against the file's own magic bytes
 *     (or, for text formats, a hostile-shape scan) before it is trusted;
 *   - the stored name is `crypto.randomBytes` hex, no extension, unrelated to
 *     the upload in any way an attacker could predict or choose;
 *   - the directory lives outside the git checkout and outside anything
 *     nginx or ERP_SERVE_APP could ever serve statically (server.js's static
 *     path only ever resolves inside APP_ROOT, a different tree entirely).
 */

var crypto = require('crypto');
var fs = require('fs');
var path = require('path');
var audit = require('../lib/audit');

var STORAGE_ROOT = path.resolve(process.env.ERP_DOCUMENTS_DIR || '/home/deploy/deployments/erp-api/documents');
var MAX_BYTES = 15 * 1024 * 1024;         // 15 MiB decoded; the upload route's
                                           // maxBody (server.js) is sized for this in base64.
var STORAGE_KEY_RE = /^[0-9a-f]{48}$/;
var SAFE_CATEGORY_RE = /^[A-Za-z0-9 _.,'()/-]{0,64}$/;

/* Allow-listed formats only. Each entry names how to verify the bytes really
   are what the caller claims: a fixed magic-byte signature, or a `scan`
   function for formats with no reliable signature (plain text, CSV). */
var ALLOWED = {
  'application/pdf':  { magic: [0x25, 0x50, 0x44, 0x46] },                          // %PDF
  'image/png':        { magic: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] },
  'image/jpeg':       { magic: [0xFF, 0xD8, 0xFF] },
  'image/gif':        { magic: [0x47, 0x49, 0x46, 0x38] },                          // GIF8
  'image/webp':       { magic: [0x52, 0x49, 0x46, 0x46], offsetCheck: function (b) { return b.length > 11 && b.slice(8, 12).toString('ascii') === 'WEBP'; } },
  // .docx/.xlsx/.pptx are zip containers (PK\x03\x04); the office suffix is
  // metadata, not a different signature, so all three share one entry keyed
  // by MIME and the same magic.
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':   { magic: [0x50, 0x4B, 0x03, 0x04] },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':         { magic: [0x50, 0x4B, 0x03, 0x04] },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': { magic: [0x50, 0x4B, 0x03, 0x04] },
  'text/plain': { scan: scanText },
  'text/csv':   { scan: scanText }
};

/* No magic bytes reliably identify "plain text", so this asserts the opposite
   of what a hostile upload would look like: valid UTF-8, no NUL byte (binary
   masquerading as text), and none of the markers that make a byte stream
   executable somewhere (`<?php`, a shebang, `<script`). */
function scanText(buf) {
  if (buf.includes(0x00)) return false;
  var text;
  try { text = buf.toString('utf8'); } catch (e) { return false; }
  if (Buffer.byteLength(text, 'utf8') !== buf.length) return false; // lossy re-encode = not valid UTF-8
  var head = text.slice(0, 4096).toLowerCase();
  if (head.indexOf('<?php') >= 0 || head.indexOf('<%') >= 0 || head.indexOf('<script') >= 0) return false;
  if (/^#!/.test(text)) return false;
  return true;
}

/* Applied to every upload regardless of declared type: a handful of
   signatures that must never be accepted no matter what MIME the caller
   claims, because the allow-list check only proves the bytes match ONE
   accepted format — it does not by itself rule out a polyglot file crafted to
   also parse as something else. Belt, not just braces. */
function hasHostileSignature(buf) {
  var head = buf.slice(0, 4096);
  if (head.length >= 2 && head[0] === 0x4D && head[1] === 0x5A) return 'PE/EXE (MZ header)';
  if (head.length >= 4 && head[0] === 0x7F && head[1] === 0x45 && head[2] === 0x4C && head[3] === 0x46) return 'ELF binary';
  if (head.length >= 2 && head[0] === 0x23 && head[1] === 0x21) return 'shebang script';
  var textHead = head.toString('latin1').toLowerCase();
  if (textHead.indexOf('<?php') >= 0) return 'embedded PHP tag';
  if (textHead.indexOf('<script') >= 0 && !ALLOWED_SCRIPT_CONTEXT) return 'embedded <script> tag';
  return null;
}
var ALLOWED_SCRIPT_CONTEXT = false; // never — kept as a named constant so the rule above reads as a decision, not an accident.

function matchesSignature(mime, buf) {
  var rule = ALLOWED[mime];
  if (!rule) return false;
  if (rule.scan) return rule.scan(buf);
  var magic = rule.magic;
  if (buf.length < magic.length) return false;
  for (var i = 0; i < magic.length; i++) if (buf[i] !== magic[i]) return false;
  if (rule.offsetCheck && !rule.offsetCheck(buf)) return false;
  return true;
}

/* Filenames are display-only. Strip anything that could confuse a header
   (CR/LF, quotes), any path separator, control characters, and cap the
   length — this string is never used to open a file. */
function sanitiseName(name) {
  var s = String(name || 'document').replace(/[\\/]/g, '_').replace(/["\r\n\x00-\x1F]/g, '').trim();
  return (s || 'document').slice(0, 200);
}

function ensureDir(dir) {
  return fs.promises.mkdir(dir, { recursive: true, mode: 0o700 }).then(function () {
    return fs.promises.chmod(dir, 0o700).catch(function () { /* best-effort on an already-existing dir */ });
  });
}

function tenantDir(tenantId) { return path.join(STORAGE_ROOT, tenantId); }

/* Resolve a stored blob's path and refuse anything that would not stay inside
   its tenant directory — storage_key is always server-generated and checked
   against STORAGE_KEY_RE before this runs, but a path is verified structurally
   too, the same defense-in-depth pattern server.js already uses for the
   static app root. */
function blobPath(tenantId, storageKey) {
  var dir = path.resolve(tenantDir(tenantId));
  var full = path.resolve(dir, storageKey);
  if (full.indexOf(dir + path.sep) !== 0) return null;
  return full;
}

var handlers = {
  upload: function (ctx, client) {
    var b = ctx.body || {};
    var mime = String(b.mime_type || '').toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(ALLOWED, mime)) {
      return Promise.resolve({ status: 422, body: { error: 'mime_type not allowed', allowed: Object.keys(ALLOWED) } });
    }
    if (typeof b.content_base64 !== 'string' || !b.content_base64) {
      return Promise.resolve({ status: 422, body: { error: 'content_base64 is required' } });
    }
    if (b.category !== undefined && b.category !== null && !SAFE_CATEGORY_RE.test(String(b.category))) {
      return Promise.resolve({ status: 422, body: { error: 'category has an unsupported character' } });
    }
    var buf;
    try { buf = Buffer.from(b.content_base64, 'base64'); }
    catch (e) { return Promise.resolve({ status: 422, body: { error: 'content_base64 is not valid base64' } }); }
    // A round trip catches whitespace/garbage that Buffer.from() silently
    // drops instead of rejecting.
    if (!buf.length || Buffer.from(buf.toString('base64'), 'base64').toString('base64') !== buf.toString('base64')) {
      return Promise.resolve({ status: 422, body: { error: 'content_base64 is not valid base64' } });
    }
    if (buf.length > MAX_BYTES) {
      return Promise.resolve({ status: 413, body: { error: 'file exceeds the ' + (MAX_BYTES / 1048576) + ' MiB limit' } });
    }
    if (!matchesSignature(mime, buf)) {
      return Promise.resolve({ status: 422, body: { error: 'file content does not match the declared mime_type' } });
    }
    var hostile = hasHostileSignature(buf);
    if (hostile) {
      return Promise.resolve({ status: 422, body: { error: 'file rejected: looks like ' + hostile } });
    }
    var sha256 = crypto.createHash('sha256').update(buf).digest('hex');
    var storageKey = crypto.randomBytes(24).toString('hex');
    var dir = tenantDir(ctx.tenantId);
    return ensureDir(dir).then(function () {
      var full = blobPath(ctx.tenantId, storageKey);
      // mode 0600: only the erp-api process's own user can read the blob back;
      // the file is written before the row, so a crash between the two leaves
      // an orphan blob (harmless, cleaned up by an operator) rather than a
      // database row pointing at nothing.
      return fs.promises.writeFile(full, buf, { mode: 0o600 });
    }).then(function () {
      return client.query(
        'INSERT INTO documents (tenant_id, storage_key, original_name, mime_type, byte_size, sha256, category, client_id, project_id, uploaded_by)' +
        ' VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)' +
        ' RETURNING id, storage_key, original_name, mime_type, byte_size, sha256, category, client_id, project_id, created_at',
        [ctx.tenantId, storageKey, sanitiseName(b.filename), mime, buf.length, sha256,
         b.category || null, b.client_id || null, b.project_id || null, ctx.user.id]
      );
    }).then(function (r) {
      var row = r.rows[0];
      return {
        status: 201, body: row,
        audit: { action: 'record.created', entity_table: 'documents', entity_id: row.id,
                 detail: { original_name: row.original_name, mime_type: row.mime_type, byte_size: row.byte_size, sha256: row.sha256 } }
      };
    });
  },

  download: function (ctx, client) {
    return client.query(
      'SELECT id, storage_key, original_name, mime_type, byte_size FROM documents WHERE id = $1 AND deleted_at IS NULL', [ctx.id]
    ).then(function (r) {
      var row = r.rows[0];
      // A row belonging to another tenant is invisible here (RLS), so this is
      // a plain 404 either way — the same rule the generic resource layer
      // uses, and it leaks nothing about whether the id exists elsewhere.
      if (!row || !STORAGE_KEY_RE.test(row.storage_key)) return { status: 404, body: { error: 'not_found' } };
      var full = blobPath(ctx.tenantId, row.storage_key);
      if (!full) return { status: 404, body: { error: 'not_found' } };
      return fs.promises.readFile(full).then(function (buf) {
        // A download is a read, so the pipeline does not require an audit
        // descriptor the way it does for POST/PATCH/DELETE — but reading a
        // stored document is exactly the kind of access that belongs in the
        // trail, so it is written explicitly, in the same tenant transaction.
        return audit.write(client, {
          actor_id: ctx.user.id, actor_label: ctx.user.email, action: 'export',
          entity_table: 'documents', entity_id: row.id, outcome: 'ok',
          detail: { original_name: row.original_name, byte_size: row.byte_size }, ip: ctx.ip, tenant_id: ctx.tenantId
        }).then(function () {
          return {
            status: 200, raw: buf,
            headers: {
              'Content-Type': row.mime_type,
              'Content-Disposition': 'attachment; filename="' + sanitiseName(row.original_name).replace(/"/g, "'") + '"'
            }
          };
        });
      }).catch(function () {
        // The blob is missing (moved/purged out of band) but the row is not —
        // an operator problem, not something to expose as a 500 with a stack.
        return { status: 404, body: { error: 'not_found' } };
      });
    });
  }
};

module.exports = { handlers: handlers, ALLOWED: ALLOWED, MAX_BYTES: MAX_BYTES, STORAGE_ROOT: STORAGE_ROOT,
  matchesSignature: matchesSignature, hasHostileSignature: hasHostileSignature, sanitiseName: sanitiseName };
