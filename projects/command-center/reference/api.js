'use strict';
// =====================================================
// MYTHOS AI COMMAND CENTER — HTTP API + web application
// projects/command-center/reference/api.js
// Stage: MCC-1 (V1 command library)
//
// WHAT THIS IS
// ------------
// The API-first backend (owner requirement §24) and the static-asset host
// for the command library served at ordre.mythosprod.xyz. It follows the
// repository's established read/write API convention — the same
// no-framework node `http` + `pg` shape as projects/idauto/reference/api.js
// (IDA-2C/2D) and projects/ssangyong-autos/reference/api.js (SYA-API-1).
// Nothing here is a new architectural pattern.
//
// WHAT THIS IS NOT — do not "fix" these by widening scope
// -------------------------------------------------------
//  * NOT a command execution engine. Owner requirement §14 is absolute:
//    "The application itself must NEVER automatically execute a stored
//    command." There is no child_process, no exec, no spawn, no eval, no
//    Function constructor, and no shell anywhere in this runtime. A stored
//    command is TEXT that gets displayed, searched, filled in and copied.
//    A test asserts this at source level so it cannot regress silently.
//
//  * NOT coupled to any other Mythos product. It owns the
//    `mythos_command_center` database exclusively; db.js pins search_path
//    to the `mcc` schema. No query here reads `idauto` or
//    `ssangyong_autos`, and no foreign key crosses a product boundary.
//
//  * NOT multi-user. Reads are public (§7 — copying must not require a
//    login); writes need a bearer token from auth.js. A real per-user
//    model waits for a real Mythos identity service, which still does not
//    exist in this codebase.
//
//  * NOT an AI surface yet. §25's recommendation/generation features are
//    architecture-ready (the search and statistics endpoints are the
//    interface an agent would use) but deliberately unimplemented — §25
//    says "NOT implemented unless authorized".
//
// RUN
// ---
//   env MCC_DB_HOST=... MCC_DB_PORT=... MCC_DB_USER=... \
//       MCC_DB_PASSWORD=... MCC_DB_NAME=... MCC_ADMIN_TOKENS='{"tok":"owner"}' \
//       node projects/command-center/reference/server.js
// =====================================================

var http = require('http');
var url = require('url');
var fs = require('fs');
var path = require('path');

var db = require('./db.js');
var auth = require('./auth.js');
var secrets = require('./secrets.js');
var variables = require('./variables.js');
var versioning = require('./versioning.js');

var DEFAULT_LIMIT = 50;
var MAX_LIMIT = 200;

// Request bodies here are command text written by one person, not uploads.
// 512 KB is far more than the longest realistic command and small enough
// that a malicious body cannot exhaust memory.
var MAX_BODY_BYTES = 512 * 1024;

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

function sendJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    // The library is edited live and read by one person; a cached list
    // would show a command the owner just edited as unchanged.
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(body));
}

function notFound(res) {
  sendJson(res, 404, { error: 'not found' });
}

function httpError(status, message, extra) {
  return Object.assign(new Error(message), { httpStatus: status, extra: extra || null });
}

function badRequest(message) { return httpError(400, message); }

function toInt(value) { return parseInt(value, 10); }

// ---------------------------------------------------------------------------
// Input parsing and validation — every value is checked before it reaches
// SQL, and every SQL value is a bound parameter, never interpolated.
// ---------------------------------------------------------------------------

function parsePositiveInt(raw, label) {
  if (/^\d+$/.test(String(raw)) === false) throw badRequest(label + ' must be a non-negative integer');
  var n = parseInt(raw, 10);
  if (!Number.isSafeInteger(n)) throw badRequest(label + ' is out of range');
  return n;
}

function parsePaging(q) {
  var limit = DEFAULT_LIMIT;
  var offset = 0;
  if (q.limit !== undefined) {
    limit = parsePositiveInt(q.limit, 'limit');
    if (limit < 1 || limit > MAX_LIMIT) throw badRequest('limit must be between 1 and ' + MAX_LIMIT);
  }
  if (q.offset !== undefined) offset = parsePositiveInt(q.offset, 'offset');
  return { limit: limit, offset: offset };
}

function readBody(req) {
  return new Promise(function (resolve, reject) {
    var chunks = [];
    var size = 0;
    var oversized = false;
    req.on('data', function (chunk) {
      // Once over the limit, keep consuming the stream but stop BUFFERING
      // it, so memory stays bounded while the client is still allowed to
      // finish sending. Destroying the socket here instead would kill the
      // connection before the 413 could be written, and the caller would
      // see a hang-up rather than a reason.
      if (oversized) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        oversized = true;
        chunks = [];
        reject(httpError(413, 'request body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', function () { reject(httpError(400, 'request stream error')); });
    req.on('end', function () {
      var raw = Buffer.concat(chunks).toString('utf8');
      if (raw.trim() === '') return resolve({});
      try {
        var parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return reject(badRequest('request body must be a JSON object'));
        }
        resolve(parsed);
      } catch (e) {
        reject(badRequest('request body is not valid JSON'));
      }
    });
  });
}

var DIFFICULTIES = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'];
var SAFETY_LEVELS = ['SAFE', 'READ_ONLY', 'WRITE', 'PRODUCTION', 'DESTRUCTIVE'];
var STATUSES = ['ACTIVE', 'ARCHIVED', 'DRAFT'];
var NOTE_SCOPES = ['GENERAL', 'COMMAND', 'CATEGORY', 'PROJECT', 'WORKFLOW'];

function requireEnum(value, allowed, label) {
  var normalized = String(value == null ? '' : value).toUpperCase();
  if (allowed.indexOf(normalized) === -1) {
    throw badRequest(label + ' must be one of: ' + allowed.join(', '));
  }
  return normalized;
}

function requireText(value, label, maxLength) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw badRequest(label + ' is required');
  }
  if (value.length > (maxLength || 100000)) {
    throw badRequest(label + ' exceeds the maximum length of ' + (maxLength || 100000));
  }
  return value;
}

function optionalText(value, label, maxLength) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw badRequest(label + ' must be a string');
  if (value.length > (maxLength || 100000)) {
    throw badRequest(label + ' exceeds the maximum length of ' + (maxLength || 100000));
  }
  return value;
}

// A slug is the stable public identifier for a command. Derived from the
// title when the caller does not supply one, and always uniquified against
// the table so a second "GitHub Verification" does not collide.
function slugify(text) {
  return String(text)
    // Strip combining marks so "Vérification" slugs as "verification".
    // Escaped rather than literal: a raw combining-mark range in source is
    // invisible and gets mangled by well-meaning editors.
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'command';
}

async function uniqueSlug(table, base, exec) {
  var run = exec || db.query;
  var candidate = base;
  var suffix = 2;
  // Bounded: a title colliding 200 times means something is wrong upstream,
  // and an unbounded loop here would be a hang, not a feature.
  while (suffix < 200) {
    var existing = await run('SELECT 1 FROM ' + table + ' WHERE slug = $1', [candidate]);
    if (existing.rows.length === 0) return candidate;
    candidate = base.slice(0, 76) + '-' + suffix;
    suffix++;
  }
  throw httpError(409, 'could not allocate a unique slug');
}

// `table` above is never caller-controlled — it is a literal passed by this
// module's own call sites. Asserted here so a future edit cannot make it so.
var SLUG_TABLES = ['mcc_commands', 'mcc_categories', 'mcc_projects', 'mcc_tags', 'mcc_templates', 'mcc_workflows'];

// The JavaScript twin of the `translate(...)` call that generates
// mcc_commands.search_text. The two MUST stay character-for-character
// identical: if they drift, a term folded one way is compared against text
// folded the other, and the search silently stops matching. The schema
// comment on search_text says the same thing from the other side.
var ACCENT_FROM = 'àáâãäåçèéêëìíîïñòóôõöùúûüýÿœæ';
var ACCENT_TO   = 'aaaaaaceeeeiiiinooooouuuuyyoa';

function foldAccents(text) {
  var lowered = String(text).toLowerCase();
  var out = '';
  for (var i = 0; i < lowered.length; i++) {
    var index = ACCENT_FROM.indexOf(lowered[i]);
    out += index === -1 ? lowered[i] : ACCENT_TO[index];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Secret gate — every write carrying free text passes through this.
// ---------------------------------------------------------------------------

function enforceNoSecrets(fields) {
  var report = secrets.scan(fields);
  if (report.blocked) {
    throw httpError(422, 'refused: content matches a known credential format', {
      findings: report.findings,
      guidance: 'Remove the credential and use a {{PLACEHOLDER}} or an environment-variable name instead. ' +
                'If this value is real, treat it as leaked and rotate it.'
    });
  }
  return report.warnings;
}

// ---------------------------------------------------------------------------
// Row shaping
// ---------------------------------------------------------------------------

function shapeCommand(row) {
  return {
    id: toInt(row.id),
    slug: row.slug,
    title: row.title,
    category: row.category_slug ? { slug: row.category_slug, name_en: row.category_name_en, name_fr: row.category_name_fr, name_ar: row.category_name_ar, color: row.category_color } : null,
    project: row.project_slug ? { slug: row.project_slug, name: row.project_name } : null,
    description: row.description,
    body: row.body,
    when_to_use: row.when_to_use,
    explanation: row.explanation,
    best_practices: row.best_practices,
    warnings: row.warnings,
    difficulty: row.difficulty,
    safety_level: row.safety_level,
    status: row.status,
    version: row.version,
    author: row.author,
    source: row.source,
    tags: row.tags || [],
    variables: variables.describe(row.body, row.variables),
    usage_count: toInt(row.usage_count),
    last_used_at: row.last_used_at,
    is_favorite: row.is_favorite === true,
    favorite_rank: row.favorite_rank === null || row.favorite_rank === undefined ? null : toInt(row.favorite_rank),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

// The one definition of how a command row is assembled, so list, detail,
// dashboard and export can never disagree about a command's shape.
var COMMAND_SELECT =
  'SELECT c.*, ' +
  '  cat.slug AS category_slug, cat.name_en AS category_name_en, cat.name_fr AS category_name_fr, ' +
  '  cat.name_ar AS category_name_ar, cat.color AS category_color, ' +
  '  p.slug AS project_slug, p.name AS project_name, ' +
  '  (f.command_id IS NOT NULL) AS is_favorite, f.rank AS favorite_rank, ' +
  '  COALESCE((SELECT array_agg(t.slug ORDER BY t.slug) FROM mcc_command_tags ct ' +
  '            JOIN mcc_tags t ON t.id = ct.tag_id WHERE ct.command_id = c.id), ARRAY[]::text[]) AS tags ' +
  'FROM mcc_commands c ' +
  'LEFT JOIN mcc_categories cat ON cat.id = c.category_id ' +
  'LEFT JOIN mcc_projects p ON p.id = c.project_id ' +
  'LEFT JOIN mcc_favorites f ON f.command_id = c.id ';

// ---------------------------------------------------------------------------
// GET /api/health
// ---------------------------------------------------------------------------

async function getHealth(res) {
  var result = await db.query(
    'SELECT current_database() AS database, current_schema() AS schema, ' +
    '(SELECT count(*) FROM mcc_commands) AS commands, ' +
    '(SELECT count(*) FROM mcc_categories) AS categories, ' +
    '(SELECT count(*) FROM mcc_notes) AS notes'
  );
  var row = result.rows[0];
  sendJson(res, 200, {
    status: 'ok',
    database: row.database,
    schema: row.schema,
    counts: {
      commands: toInt(row.commands),
      categories: toInt(row.categories),
      notes: toInt(row.notes)
    }
  });
}

// ---------------------------------------------------------------------------
// GET /api/commands — search + filter (§12)
//
// Free-text search runs against the generated tsvector when a query is
// present, and falls back to ILIKE for short/partial terms that
// to_tsquery cannot match (typing "git" should find "GitHub" before the
// word is finished). Both paths are parameterized.
// ---------------------------------------------------------------------------

async function getCommands(res, q) {
  var paging = parsePaging(q);
  var where = [];
  var params = [];

  function bind(value) {
    params.push(value);
    return '$' + params.length;
  }

  // Default view is ACTIVE only. Archived commands stay searchable, but a
  // caller has to ask for them (§31) — otherwise the library slowly fills
  // with retired commands nobody meant to see.
  if (q.status !== undefined && q.status !== '') {
    if (String(q.status).toUpperCase() === 'ALL') {
      // no status predicate
    } else {
      where.push('c.status = ' + bind(requireEnum(q.status, STATUSES, 'status')));
    }
  } else {
    where.push("c.status = 'ACTIVE'");
  }

  if (q.category) where.push('cat.slug = ' + bind(String(q.category)));
  if (q.project) where.push('p.slug = ' + bind(String(q.project)));
  if (q.difficulty) where.push('c.difficulty = ' + bind(requireEnum(q.difficulty, DIFFICULTIES, 'difficulty')));
  if (q.safety) where.push('c.safety_level = ' + bind(requireEnum(q.safety, SAFETY_LEVELS, 'safety')));
  if (q.favorite === 'true' || q.favorite === '1') where.push('f.command_id IS NOT NULL');

  if (q.tag) {
    var tags = Array.isArray(q.tag) ? q.tag : [q.tag];
    // AND semantics: every requested tag must be present. Narrowing is the
    // point of adding a second tag.
    tags.forEach(function (tag) {
      where.push('EXISTS (SELECT 1 FROM mcc_command_tags ct JOIN mcc_tags t ON t.id = ct.tag_id ' +
                 'WHERE ct.command_id = c.id AND t.slug = ' + bind(String(tag)) + ')');
    });
  }

  var searchTerm = typeof q.q === 'string' ? q.q.trim() : '';
  var rankExpression = '0';
  if (searchTerm !== '') {
    if (searchTerm.length > 200) throw badRequest('search query is too long');
    var termParam = bind(searchTerm);
    // The accent-folded form of the same term, matched against the
    // generated search_text column. This is what makes "deploiement" find
    // "Déploiement" — and, just as importantly, "Déploiement" find it too,
    // since both sides go through the same folding.
    var foldedParam = bind(foldAccents(searchTerm));
    // websearch_to_tsquery takes user text safely — quotes, OR, - are all
    // handled as search syntax, never as SQL.
    where.push(
      '(c.search_vector @@ websearch_to_tsquery(\'simple\', ' + termParam + ') ' +
      ' OR c.search_text ILIKE \'%\' || ' + foldedParam + ' || \'%\' ' +
      ' OR EXISTS (SELECT 1 FROM mcc_command_tags ct JOIN mcc_tags t ON t.id = ct.tag_id ' +
      '            WHERE ct.command_id = c.id AND t.slug ILIKE \'%\' || ' + foldedParam + ' || \'%\') ' +
      ' OR EXISTS (SELECT 1 FROM mcc_notes n WHERE n.command_id = c.id ' +
      '            AND (n.title ILIKE \'%\' || ' + termParam + ' || \'%\' OR n.content ILIKE \'%\' || ' + termParam + ' || \'%\')))'
    );
    rankExpression = 'ts_rank(c.search_vector, websearch_to_tsquery(\'simple\', ' + termParam + '))';
  }

  var SORTS = {
    relevance: rankExpression + ' DESC, c.usage_count DESC, c.title ASC',
    most_used: 'c.usage_count DESC, c.last_used_at DESC NULLS LAST, c.title ASC',
    recent_used: 'c.last_used_at DESC NULLS LAST, c.title ASC',
    recent_added: 'c.created_at DESC, c.title ASC',
    updated: 'c.updated_at DESC, c.title ASC',
    title: 'c.title ASC',
    favorite: 'f.rank ASC NULLS LAST, c.title ASC'
  };
  var sortKey = q.sort ? String(q.sort) : (searchTerm !== '' ? 'relevance' : 'most_used');
  // Whitelist lookup — the ORDER BY text can only ever be one of the
  // literals defined above, never anything a caller supplies.
  var orderBy = SORTS[sortKey];
  if (!orderBy) throw badRequest('sort must be one of: ' + Object.keys(SORTS).join(', '));

  var whereSql = where.length ? ' WHERE ' + where.join(' AND ') : '';

  var countResult = await db.query(
    'SELECT count(*) AS total FROM mcc_commands c ' +
    'LEFT JOIN mcc_categories cat ON cat.id = c.category_id ' +
    'LEFT JOIN mcc_projects p ON p.id = c.project_id ' +
    'LEFT JOIN mcc_favorites f ON f.command_id = c.id' + whereSql,
    params
  );

  var listResult = await db.query(
    COMMAND_SELECT + whereSql + ' ORDER BY ' + orderBy +
    ' LIMIT ' + bind(paging.limit) + ' OFFSET ' + bind(paging.offset),
    params
  );

  sendJson(res, 200, {
    total: toInt(countResult.rows[0].total),
    limit: paging.limit,
    offset: paging.offset,
    sort: sortKey,
    commands: listResult.rows.map(shapeCommand)
  });
}

// ---------------------------------------------------------------------------
// GET /api/commands/:idOrSlug — detail page payload (§6)
// ---------------------------------------------------------------------------

async function loadCommand(reference, exec) {
  var run = exec || db.query;
  // Digits alone are not enough to take the id path: a value too large for
  // a bigint would reach PostgreSQL and come back as a 22P02 driver error,
  // surfacing as a 500 where the honest answer is "no such command". Such a
  // value falls through to the slug lookup, which simply finds nothing.
  var isNumeric = /^\d+$/.test(String(reference)) && Number.isSafeInteger(Number(reference));
  var result = await run(
    COMMAND_SELECT + (isNumeric ? ' WHERE c.id = $1' : ' WHERE c.slug = $1'),
    [isNumeric ? parseInt(reference, 10) : String(reference)]
  );
  return result.rows.length ? result.rows[0] : null;
}

async function getCommand(res, reference) {
  var row = await loadCommand(reference);
  if (!row) return notFound(res);
  var command = shapeCommand(row);

  var related = await db.query(
    'SELECT r.relation_type, c.id, c.slug, c.title, c.safety_level, cat.slug AS category_slug ' +
    'FROM mcc_command_relations r ' +
    'JOIN mcc_commands c ON c.id = r.related_command_id ' +
    'LEFT JOIN mcc_categories cat ON cat.id = c.category_id ' +
    'WHERE r.command_id = $1 ORDER BY r.relation_type, c.title',
    [command.id]
  );

  var notes = await db.query(
    'SELECT id, title, content, tags, created_at, updated_at FROM mcc_notes ' +
    'WHERE command_id = $1 ORDER BY created_at DESC',
    [command.id]
  );

  var versions = await db.query(
    'SELECT id, version, change_note, created_at FROM mcc_command_versions ' +
    'WHERE command_id = $1 ORDER BY created_at DESC LIMIT 50',
    [command.id]
  );

  var usage = await db.query(
    'SELECT event_type, occurred_at FROM mcc_usage_events ' +
    'WHERE command_id = $1 ORDER BY occurred_at DESC LIMIT 20',
    [command.id]
  );

  var workflows = await db.query(
    'SELECT w.slug, w.title, wc.position FROM mcc_workflow_commands wc ' +
    'JOIN mcc_workflows w ON w.id = wc.workflow_id WHERE wc.command_id = $1 ORDER BY w.title',
    [command.id]
  );

  command.related = related.rows.map(function (r) {
    return {
      relation_type: r.relation_type,
      id: toInt(r.id),
      slug: r.slug,
      title: r.title,
      safety_level: r.safety_level,
      category_slug: r.category_slug
    };
  });
  command.notes = notes.rows.map(function (n) {
    return { id: toInt(n.id), title: n.title, content: n.content, tags: n.tags, created_at: n.created_at, updated_at: n.updated_at };
  });
  command.versions = versions.rows.map(function (v) {
    return { id: toInt(v.id), version: v.version, change_note: v.change_note, created_at: v.created_at };
  });
  command.usage_history = usage.rows;
  command.workflows = workflows.rows.map(function (w) {
    return { slug: w.slug, title: w.title, position: toInt(w.position) };
  });

  sendJson(res, 200, { command: command });
}

// ---------------------------------------------------------------------------
// Tag / relation helpers — used by create and update inside one transaction.
// ---------------------------------------------------------------------------

async function resolveTagIds(exec, tagSlugs) {
  var ids = [];
  for (var i = 0; i < tagSlugs.length; i++) {
    var slug = slugify(tagSlugs[i]);
    if (!slug) continue;
    // Tags are dynamic (§13): an unknown tag is created, not rejected.
    var existing = await exec('SELECT id FROM mcc_tags WHERE slug = $1', [slug]);
    if (existing.rows.length) {
      ids.push(toInt(existing.rows[0].id));
    } else {
      var created = await exec(
        'INSERT INTO mcc_tags (slug, label) VALUES ($1, $2) RETURNING id',
        [slug, String(tagSlugs[i]).trim()]
      );
      ids.push(toInt(created.rows[0].id));
    }
  }
  return ids;
}

async function setCommandTags(exec, commandId, tagSlugs) {
  var ids = await resolveTagIds(exec, tagSlugs);
  await exec('DELETE FROM mcc_command_tags WHERE command_id = $1', [commandId]);
  for (var i = 0; i < ids.length; i++) {
    await exec(
      'INSERT INTO mcc_command_tags (command_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [commandId, ids[i]]
    );
  }
}

async function setCommandRelations(exec, commandId, related) {
  await exec('DELETE FROM mcc_command_relations WHERE command_id = $1', [commandId]);
  for (var i = 0; i < related.length; i++) {
    var entry = related[i];
    var ref = typeof entry === 'string' ? { slug: entry, relation_type: 'RELATED' } : entry;
    if (!ref || typeof ref !== 'object') continue;
    var type = requireEnum(ref.relation_type || 'RELATED', ['RELATED', 'NEXT', 'PREVIOUS'], 'relation_type');
    var target = await exec('SELECT id FROM mcc_commands WHERE slug = $1 OR id::text = $1', [String(ref.slug || ref.id)]);
    if (!target.rows.length) continue;            // a dangling reference is dropped, not an error
    var targetId = toInt(target.rows[0].id);
    if (targetId === commandId) continue;         // the schema's CHECK forbids self-relation
    await exec(
      'INSERT INTO mcc_command_relations (command_id, related_command_id, relation_type) ' +
      'VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [commandId, targetId, type]
    );
  }
}

async function resolveCategoryId(exec, slug) {
  if (slug === undefined || slug === null || slug === '') return null;
  var found = await exec('SELECT id FROM mcc_categories WHERE slug = $1', [String(slug)]);
  if (!found.rows.length) throw badRequest('unknown category: ' + slug);
  return toInt(found.rows[0].id);
}

async function resolveProjectId(exec, slug) {
  if (slug === undefined || slug === null || slug === '') return null;
  var found = await exec('SELECT id FROM mcc_projects WHERE slug = $1', [String(slug)]);
  if (!found.rows.length) throw badRequest('unknown project: ' + slug);
  return toInt(found.rows[0].id);
}

// ---------------------------------------------------------------------------
// POST /api/commands — create (§11)
// ---------------------------------------------------------------------------

async function createCommand(res, body) {
  var title = requireText(body.title, 'title', 300);
  var commandBody = requireText(body.body, 'body');

  var warnings = enforceNoSecrets({ body: commandBody, explanation: body.explanation, notes: body.notes });

  var created = await db.transaction(async function (exec) {
    var slug = body.slug ? slugify(body.slug) : slugify(title);
    slug = await uniqueSlug('mcc_commands', slug, exec);

    var categoryId = await resolveCategoryId(exec, body.category);
    var projectId = await resolveProjectId(exec, body.project);

    var inserted = await exec(
      'INSERT INTO mcc_commands (slug, title, category_id, project_id, description, body, ' +
      '  when_to_use, explanation, best_practices, warnings, difficulty, safety_level, status, ' +
      '  version, author, source, variables) ' +
      'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id',
      [
        slug,
        title,
        categoryId,
        projectId,
        optionalText(body.description, 'description', 2000) || '',
        commandBody,
        optionalText(body.when_to_use, 'when_to_use') || '',
        optionalText(body.explanation, 'explanation') || '',
        optionalText(body.best_practices, 'best_practices') || '',
        optionalText(body.warnings, 'warnings') || '',
        body.difficulty ? requireEnum(body.difficulty, DIFFICULTIES, 'difficulty') : 'INTERMEDIATE',
        body.safety_level ? requireEnum(body.safety_level, SAFETY_LEVELS, 'safety_level') : 'SAFE',
        body.status ? requireEnum(body.status, STATUSES, 'status') : 'ACTIVE',
        optionalText(body.version, 'version', 20) || '1.0',
        optionalText(body.author, 'author', 200) || '',
        optionalText(body.source, 'source', 500) || '',
        JSON.stringify(Array.isArray(body.variables) ? body.variables : [])
      ]
    );
    var id = toInt(inserted.rows[0].id);

    if (Array.isArray(body.tags)) await setCommandTags(exec, id, body.tags);
    if (Array.isArray(body.related)) await setCommandRelations(exec, id, body.related);

    // The creation snapshot, so version history starts at the beginning
    // rather than at the first edit.
    var row = await exec('SELECT * FROM mcc_commands WHERE id = $1', [id]);
    await exec(
      'INSERT INTO mcc_command_versions (command_id, version, snapshot, change_note) VALUES ($1,$2,$3,$4)',
      [id, row.rows[0].version, JSON.stringify(versioning.snapshotOf(row.rows[0])), 'created']
    );

    if (typeof body.notes === 'string' && body.notes.trim() !== '') {
      await exec(
        'INSERT INTO mcc_notes (title, content, scope, command_id) VALUES ($1,$2,$3,$4)',
        ['Note', body.notes, 'COMMAND', id]
      );
    }
    return id;
  });

  var row = await loadCommand(String(created));
  sendJson(res, 201, { command: shapeCommand(row), secret_warnings: warnings });
}

// ---------------------------------------------------------------------------
// PATCH /api/commands/:id — update, with version preservation (§30)
// ---------------------------------------------------------------------------

async function updateCommand(res, reference, body) {
  var existing = await loadCommand(reference);
  if (!existing) return notFound(res);

  var warnings = enforceNoSecrets({
    body: body.body,
    explanation: body.explanation,
    best_practices: body.best_practices,
    warnings: body.warnings
  });

  await db.transaction(async function (exec) {
    var substantive = versioning.isSubstantiveChange(existing, body);

    // The PREVIOUS state is snapshotted before the row changes, so history
    // records what the command WAS, not what it became.
    if (substantive) {
      await exec(
        'INSERT INTO mcc_command_versions (command_id, version, snapshot, change_note) VALUES ($1,$2,$3,$4)',
        [existing.id, existing.version, JSON.stringify(versioning.snapshotOf(existing)),
         optionalText(body.change_note, 'change_note', 500) || 'edited']
      );
    }

    var sets = [];
    var params = [];
    function assign(column, value) {
      params.push(value);
      sets.push(column + ' = $' + params.length);
    }

    ['title', 'description', 'body', 'when_to_use', 'explanation', 'best_practices', 'warnings', 'author', 'source']
      .forEach(function (field) {
        var value = optionalText(body[field], field, field === 'title' ? 300 : undefined);
        if (value !== undefined) assign(field, value);
      });

    if (body.difficulty !== undefined) assign('difficulty', requireEnum(body.difficulty, DIFFICULTIES, 'difficulty'));
    if (body.safety_level !== undefined) assign('safety_level', requireEnum(body.safety_level, SAFETY_LEVELS, 'safety_level'));
    if (body.status !== undefined) assign('status', requireEnum(body.status, STATUSES, 'status'));
    if (body.variables !== undefined) assign('variables', JSON.stringify(Array.isArray(body.variables) ? body.variables : []));
    if (body.category !== undefined) assign('category_id', await resolveCategoryId(exec, body.category));
    if (body.project !== undefined) assign('project_id', await resolveProjectId(exec, body.project));

    // An explicit version always wins — the owner may be declaring a major
    // version, which is never inferred (see versioning.js).
    if (body.version !== undefined) {
      assign('version', optionalText(body.version, 'version', 20) || existing.version);
    } else if (substantive) {
      assign('version', versioning.nextVersion(existing.version));
    }

    assign('updated_at', new Date().toISOString());

    params.push(existing.id);
    await exec('UPDATE mcc_commands SET ' + sets.join(', ') + ' WHERE id = $' + params.length, params);

    if (Array.isArray(body.tags)) await setCommandTags(exec, toInt(existing.id), body.tags);
    if (Array.isArray(body.related)) await setCommandRelations(exec, toInt(existing.id), body.related);
  });

  var updated = await loadCommand(String(existing.id));
  sendJson(res, 200, { command: shapeCommand(updated), secret_warnings: warnings });
}

// ---------------------------------------------------------------------------
// POST /api/commands/:id/status — archive / restore / draft (§31)
//
// There is no DELETE route anywhere in this API, by design: owner
// requirement §11 says "Do not permanently delete commands by default" and
// §31 says historical commands must stay searchable. Archiving is a status
// change and is always reversible.
// ---------------------------------------------------------------------------

async function setCommandStatus(res, reference, body) {
  var existing = await loadCommand(reference);
  if (!existing) return notFound(res);
  var status = requireEnum(body.status, STATUSES, 'status');
  await db.query('UPDATE mcc_commands SET status = $1, updated_at = now() WHERE id = $2', [status, existing.id]);
  var updated = await loadCommand(String(existing.id));
  sendJson(res, 200, { command: shapeCommand(updated) });
}

// ---------------------------------------------------------------------------
// POST /api/commands/:id/duplicate (§11)
// ---------------------------------------------------------------------------

async function duplicateCommand(res, reference, body) {
  var existing = await loadCommand(reference);
  if (!existing) return notFound(res);

  var newId = await db.transaction(async function (exec) {
    var title = optionalText(body.title, 'title', 300) || (existing.title + ' (copy)');
    var slug = await uniqueSlug('mcc_commands', slugify(title), exec);
    var inserted = await exec(
      'INSERT INTO mcc_commands (slug, title, category_id, project_id, description, body, when_to_use, ' +
      '  explanation, best_practices, warnings, difficulty, safety_level, status, version, author, source, variables) ' +
      'SELECT $1, $2, category_id, project_id, description, body, when_to_use, explanation, best_practices, ' +
      '  warnings, difficulty, safety_level, \'DRAFT\', \'1.0\', author, source, variables ' +
      'FROM mcc_commands WHERE id = $3 RETURNING id',
      [slug, title, existing.id]
    );
    var id = toInt(inserted.rows[0].id);
    // A duplicate inherits the original's tags — losing them would make
    // "duplicate then adjust" more work than starting over.
    await exec(
      'INSERT INTO mcc_command_tags (command_id, tag_id) SELECT $1, tag_id FROM mcc_command_tags WHERE command_id = $2',
      [id, existing.id]
    );
    // Usage counters and version history deliberately do NOT carry over:
    // they belong to the original command's life, not the copy's.
    return id;
  });

  var row = await loadCommand(String(newId));
  sendJson(res, 201, { command: shapeCommand(row) });
}

// ---------------------------------------------------------------------------
// POST /api/commands/:id/usage — copy tracking (§7, §8)
// PUBLIC, deliberately — see auth.js for the reasoning.
// ---------------------------------------------------------------------------

async function recordUsage(res, reference, body) {
  var existing = await loadCommand(reference);
  if (!existing) return notFound(res);
  var eventType = body.event_type ? requireEnum(body.event_type, ['COPY', 'OPEN', 'USE', 'CUSTOMIZE'], 'event_type') : 'COPY';

  await db.transaction(async function (exec) {
    await exec('INSERT INTO mcc_usage_events (command_id, event_type) VALUES ($1, $2)', [existing.id, eventType]);
    // OPEN is logged for the usage history but does not count as a use:
    // browsing the library would otherwise inflate every leaderboard.
    if (eventType !== 'OPEN') {
      await exec('UPDATE mcc_commands SET usage_count = usage_count + 1, last_used_at = now() WHERE id = $1', [existing.id]);
    } else {
      await exec('UPDATE mcc_commands SET last_used_at = now() WHERE id = $1', [existing.id]);
    }
  });

  var updated = await db.query('SELECT usage_count, last_used_at FROM mcc_commands WHERE id = $1', [existing.id]);
  sendJson(res, 200, {
    usage_count: toInt(updated.rows[0].usage_count),
    last_used_at: updated.rows[0].last_used_at,
    event_type: eventType
  });
}

// ---------------------------------------------------------------------------
// POST /api/commands/:id/favorite (§9)
// ---------------------------------------------------------------------------

async function setFavorite(res, reference, body) {
  var existing = await loadCommand(reference);
  if (!existing) return notFound(res);
  var wanted = body.favorite !== false;

  if (wanted) {
    var rank = body.rank === undefined ? 1000 : parsePositiveInt(body.rank, 'rank');
    await db.query(
      'INSERT INTO mcc_favorites (command_id, rank) VALUES ($1, $2) ' +
      'ON CONFLICT (command_id) DO UPDATE SET rank = EXCLUDED.rank',
      [existing.id, rank]
    );
  } else {
    await db.query('DELETE FROM mcc_favorites WHERE command_id = $1', [existing.id]);
  }

  var updated = await loadCommand(String(existing.id));
  sendJson(res, 200, { command: shapeCommand(updated) });
}

// ---------------------------------------------------------------------------
// POST /api/commands/:id/render — fill placeholders (§15)
//
// Returns text. It does NOT store the result and it does NOT execute
// anything — this is variables.render(), which is string substitution.
// ---------------------------------------------------------------------------

async function renderCommand(res, reference, body) {
  var existing = await loadCommand(reference);
  if (!existing) return notFound(res);
  var values = body.values && typeof body.values === 'object' ? body.values : {};
  sendJson(res, 200, {
    slug: existing.slug,
    rendered: variables.render(existing.body, values),
    unresolved: variables.unresolved(existing.body, values),
    variables: variables.describe(existing.body, existing.variables)
  });
}

// ---------------------------------------------------------------------------
// GET /api/commands/:id/versions (§30)
// ---------------------------------------------------------------------------

async function getCommandVersions(res, reference) {
  var existing = await loadCommand(reference);
  if (!existing) return notFound(res);
  var result = await db.query(
    'SELECT id, version, snapshot, change_note, created_at FROM mcc_command_versions ' +
    'WHERE command_id = $1 ORDER BY created_at DESC',
    [existing.id]
  );
  sendJson(res, 200, {
    command: { id: toInt(existing.id), slug: existing.slug, title: existing.title, version: existing.version },
    versions: result.rows.map(function (v) {
      return { id: toInt(v.id), version: v.version, snapshot: v.snapshot, change_note: v.change_note, created_at: v.created_at };
    })
  });
}

// ---------------------------------------------------------------------------
// GET /api/dashboard — the home screen in one round trip (§4)
// ---------------------------------------------------------------------------

async function getDashboard(res) {
  async function commandList(orderBy, extraWhere, limit) {
    var result = await db.query(
      COMMAND_SELECT + " WHERE c.status = 'ACTIVE'" + (extraWhere ? ' AND ' + extraWhere : '') +
      ' ORDER BY ' + orderBy + ' LIMIT ' + limit
    );
    return result.rows.map(shapeCommand);
  }

  var mostUsed = await commandList('c.usage_count DESC, c.title ASC', 'c.usage_count > 0', 8);
  var favorites = await commandList('f.rank ASC NULLS LAST, c.title ASC', 'f.command_id IS NOT NULL', 8);
  var recentlyUsed = await commandList('c.last_used_at DESC', 'c.last_used_at IS NOT NULL', 8);
  var recentlyAdded = await commandList('c.created_at DESC', null, 8);

  // "Recommended" without an AI is an honest heuristic, not a pretend
  // model (§25 is explicit that AI recommendation is NOT implemented yet):
  // active commands the owner has never used, newest first. Those are the
  // ones most likely to be worth discovering.
  var recommended = await commandList('c.created_at DESC', 'c.usage_count = 0', 6);

  var categories = await db.query(
    'SELECT cat.slug, cat.name_en, cat.name_fr, cat.name_ar, cat.color, cat.sort_order, ' +
    "  count(c.id) FILTER (WHERE c.status = 'ACTIVE') AS command_count " +
    'FROM mcc_categories cat LEFT JOIN mcc_commands c ON c.category_id = cat.id ' +
    'GROUP BY cat.id ORDER BY cat.sort_order, cat.name_en'
  );

  sendJson(res, 200, {
    most_used: mostUsed,
    favorites: favorites,
    recently_used: recentlyUsed,
    recently_added: recentlyAdded,
    recommended: recommended,
    categories: categories.rows.map(function (c) {
      return {
        slug: c.slug, name_en: c.name_en, name_fr: c.name_fr, name_ar: c.name_ar,
        color: c.color, command_count: toInt(c.command_count)
      };
    })
  });
}

// ---------------------------------------------------------------------------
// GET /api/statistics (§20) — including the today/week/month leaderboards
// required by §8, computed from mcc_usage_events rather than the counter.
// ---------------------------------------------------------------------------

async function getStatistics(res) {
  var totals = await db.query(
    'SELECT ' +
    '  (SELECT count(*) FROM mcc_commands) AS total_commands, ' +
    "  (SELECT count(*) FROM mcc_commands WHERE status = 'ACTIVE') AS active_commands, " +
    "  (SELECT count(*) FROM mcc_commands WHERE status = 'ARCHIVED') AS archived_commands, " +
    "  (SELECT count(*) FROM mcc_commands WHERE status = 'DRAFT') AS draft_commands, " +
    '  (SELECT coalesce(sum(usage_count), 0) FROM mcc_commands) AS total_uses, ' +
    '  (SELECT count(*) FROM mcc_notes) AS total_notes, ' +
    '  (SELECT count(*) FROM mcc_favorites) AS total_favorites, ' +
    '  (SELECT count(*) FROM mcc_categories) AS total_categories, ' +
    '  (SELECT count(*) FROM mcc_tags) AS total_tags, ' +
    '  (SELECT count(*) FROM mcc_projects) AS total_projects, ' +
    "  (SELECT count(*) FROM mcc_commands WHERE created_at >= date_trunc('month', now())) AS added_this_month, " +
    "  (SELECT count(DISTINCT command_id) FROM mcc_usage_events WHERE occurred_at >= now() - interval '7 days') AS used_this_week"
  );

  async function leaderboard(interval) {
    var predicate = interval ? "WHERE e.occurred_at >= now() - interval '" + interval + "'" : '';
    var result = await db.query(
      'SELECT c.slug, c.title, count(e.id) AS uses FROM mcc_usage_events e ' +
      'JOIN mcc_commands c ON c.id = e.command_id ' + predicate + ' ' +
      "  " + (predicate ? 'AND' : 'WHERE') + " e.event_type <> 'OPEN' " +
      'GROUP BY c.id ORDER BY uses DESC, c.title ASC LIMIT 10'
    );
    return result.rows.map(function (r) { return { slug: r.slug, title: r.title, uses: toInt(r.uses) }; });
  }

  // The interval strings are literals defined here, never caller input.
  var mostUsedToday = await leaderboard('1 day');
  var mostUsedWeek = await leaderboard('7 days');
  var mostUsedMonth = await leaderboard('30 days');
  var mostUsedAllTime = await leaderboard(null);

  var byCategory = await db.query(
    'SELECT cat.slug, cat.name_en, count(c.id) AS commands, coalesce(sum(c.usage_count), 0) AS uses ' +
    'FROM mcc_categories cat LEFT JOIN mcc_commands c ON c.category_id = cat.id ' +
    'GROUP BY cat.id ORDER BY uses DESC, commands DESC LIMIT 10'
  );

  var row = totals.rows[0];
  sendJson(res, 200, {
    totals: {
      total_commands: toInt(row.total_commands),
      active_commands: toInt(row.active_commands),
      archived_commands: toInt(row.archived_commands),
      draft_commands: toInt(row.draft_commands),
      total_uses: toInt(row.total_uses),
      total_notes: toInt(row.total_notes),
      total_favorites: toInt(row.total_favorites),
      total_categories: toInt(row.total_categories),
      total_tags: toInt(row.total_tags),
      total_projects: toInt(row.total_projects),
      added_this_month: toInt(row.added_this_month),
      used_this_week: toInt(row.used_this_week)
    },
    most_used_today: mostUsedToday,
    most_used_week: mostUsedWeek,
    most_used_month: mostUsedMonth,
    most_used_all_time: mostUsedAllTime,
    most_used_command: mostUsedAllTime.length ? mostUsedAllTime[0] : null,
    by_category: byCategory.rows.map(function (r) {
      return { slug: r.slug, name_en: r.name_en, commands: toInt(r.commands), uses: toInt(r.uses) };
    }),
    most_used_category: byCategory.rows.length ? byCategory.rows[0].slug : null
  });
}

// ---------------------------------------------------------------------------
// Taxonomy: categories, tags, projects (§5, §13, §19) — all dynamic.
// ---------------------------------------------------------------------------

async function getCategories(res) {
  var result = await db.query(
    'SELECT cat.slug, cat.name_en, cat.name_fr, cat.name_ar, cat.description, cat.color, cat.sort_order, ' +
    "  count(c.id) FILTER (WHERE c.status = 'ACTIVE') AS command_count " +
    'FROM mcc_categories cat LEFT JOIN mcc_commands c ON c.category_id = cat.id ' +
    'GROUP BY cat.id ORDER BY cat.sort_order, cat.name_en'
  );
  sendJson(res, 200, {
    categories: result.rows.map(function (c) {
      return {
        slug: c.slug, name_en: c.name_en, name_fr: c.name_fr, name_ar: c.name_ar,
        description: c.description, color: c.color, sort_order: toInt(c.sort_order),
        command_count: toInt(c.command_count)
      };
    })
  });
}

async function createCategory(res, body) {
  var nameEn = requireText(body.name_en || body.name, 'name_en', 200);
  var slug = await uniqueSlug('mcc_categories', slugify(body.slug || nameEn));
  await db.query(
    'INSERT INTO mcc_categories (slug, name_en, name_fr, name_ar, description, color, sort_order) ' +
    'VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [
      slug, nameEn,
      optionalText(body.name_fr, 'name_fr', 200) || nameEn,
      optionalText(body.name_ar, 'name_ar', 200) || null,
      optionalText(body.description, 'description', 1000) || '',
      optionalText(body.color, 'color', 40) || 'slate',
      body.sort_order === undefined ? 1000 : parsePositiveInt(body.sort_order, 'sort_order')
    ]
  );
  sendJson(res, 201, { slug: slug });
}

async function getTags(res) {
  var result = await db.query(
    'SELECT t.slug, t.label, count(ct.command_id) AS command_count FROM mcc_tags t ' +
    'LEFT JOIN mcc_command_tags ct ON ct.tag_id = t.id GROUP BY t.id ORDER BY command_count DESC, t.slug'
  );
  sendJson(res, 200, {
    tags: result.rows.map(function (t) {
      return { slug: t.slug, label: t.label, command_count: toInt(t.command_count) };
    })
  });
}

async function createTag(res, body) {
  var label = requireText(body.label || body.slug, 'label', 100);
  var slug = slugify(body.slug || label);
  await db.query(
    'INSERT INTO mcc_tags (slug, label) VALUES ($1,$2) ON CONFLICT (slug) DO NOTHING',
    [slug, label]
  );
  sendJson(res, 201, { slug: slug });
}

async function getProjects(res) {
  var result = await db.query(
    'SELECT p.slug, p.name, p.description, p.sort_order, ' +
    "  count(c.id) FILTER (WHERE c.status = 'ACTIVE') AS command_count " +
    'FROM mcc_projects p LEFT JOIN mcc_commands c ON c.project_id = p.id ' +
    'GROUP BY p.id ORDER BY p.sort_order, p.name'
  );
  sendJson(res, 200, {
    projects: result.rows.map(function (p) {
      return { slug: p.slug, name: p.name, description: p.description, command_count: toInt(p.command_count) };
    })
  });
}

async function createProject(res, body) {
  var name = requireText(body.name, 'name', 200);
  var slug = await uniqueSlug('mcc_projects', slugify(body.slug || name));
  await db.query(
    'INSERT INTO mcc_projects (slug, name, description, sort_order) VALUES ($1,$2,$3,$4)',
    [slug, name, optionalText(body.description, 'description', 1000) || '',
     body.sort_order === undefined ? 1000 : parsePositiveInt(body.sort_order, 'sort_order')]
  );
  sendJson(res, 201, { slug: slug });
}

// ---------------------------------------------------------------------------
// Notes (§10)
// ---------------------------------------------------------------------------

async function getNotes(res, q) {
  var paging = parsePaging(q);
  var where = [];
  var params = [];
  function bind(v) { params.push(v); return '$' + params.length; }

  if (q.command) where.push('c.slug = ' + bind(String(q.command)));
  if (q.scope) where.push('n.scope = ' + bind(requireEnum(q.scope, NOTE_SCOPES, 'scope')));
  if (q.project) where.push('p.slug = ' + bind(String(q.project)));
  if (typeof q.q === 'string' && q.q.trim() !== '') {
    var term = bind(q.q.trim());
    where.push('(n.title ILIKE \'%\' || ' + term + ' || \'%\' OR n.content ILIKE \'%\' || ' + term + ' || \'%\')');
  }

  var whereSql = where.length ? ' WHERE ' + where.join(' AND ') : '';
  var result = await db.query(
    'SELECT n.id, n.title, n.content, n.scope, n.tags, n.created_at, n.updated_at, ' +
    '  c.slug AS command_slug, c.title AS command_title, cat.slug AS category_slug, p.slug AS project_slug ' +
    'FROM mcc_notes n ' +
    'LEFT JOIN mcc_commands c ON c.id = n.command_id ' +
    'LEFT JOIN mcc_categories cat ON cat.id = n.category_id ' +
    'LEFT JOIN mcc_projects p ON p.id = n.project_id' + whereSql +
    ' ORDER BY n.updated_at DESC LIMIT ' + bind(paging.limit) + ' OFFSET ' + bind(paging.offset),
    params
  );

  sendJson(res, 200, {
    notes: result.rows.map(function (n) {
      return {
        id: toInt(n.id), title: n.title, content: n.content, scope: n.scope, tags: n.tags,
        command_slug: n.command_slug, command_title: n.command_title,
        category_slug: n.category_slug, project_slug: n.project_slug,
        created_at: n.created_at, updated_at: n.updated_at
      };
    })
  });
}

async function createNote(res, body) {
  var title = requireText(body.title, 'title', 300);
  var content = optionalText(body.content, 'content') || '';
  enforceNoSecrets({ content: content });

  var scope = body.scope ? requireEnum(body.scope, NOTE_SCOPES, 'scope') : (body.command ? 'COMMAND' : 'GENERAL');

  var commandId = null;
  if (body.command) {
    var command = await loadCommand(String(body.command));
    if (!command) throw badRequest('unknown command: ' + body.command);
    commandId = toInt(command.id);
  }
  var categoryId = body.category ? await resolveCategoryId(db.query, body.category) : null;
  var projectId = body.project ? await resolveProjectId(db.query, body.project) : null;

  // The schema's CHECK enforces this too, but a 400 with a clear message
  // beats a raw constraint-violation 500 reaching the UI.
  if (scope === 'COMMAND' && commandId === null) throw badRequest('scope COMMAND requires a command');
  if (scope === 'CATEGORY' && categoryId === null) throw badRequest('scope CATEGORY requires a category');
  if (scope === 'PROJECT' && projectId === null) throw badRequest('scope PROJECT requires a project');

  var tags = Array.isArray(body.tags) ? body.tags.map(function (t) { return String(t); }).slice(0, 30) : [];

  var inserted = await db.query(
    'INSERT INTO mcc_notes (title, content, scope, command_id, category_id, project_id, tags) ' +
    'VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
    [title, content, scope, commandId, categoryId, projectId, tags]
  );
  sendJson(res, 201, { id: toInt(inserted.rows[0].id) });
}

async function updateNote(res, id, body) {
  var noteId = parsePositiveInt(id, 'id');
  var existing = await db.query('SELECT id FROM mcc_notes WHERE id = $1', [noteId]);
  if (!existing.rows.length) return notFound(res);

  enforceNoSecrets({ content: body.content });

  var sets = [];
  var params = [];
  function assign(column, value) { params.push(value); sets.push(column + ' = $' + params.length); }

  var title = optionalText(body.title, 'title', 300);
  if (title !== undefined) assign('title', title);
  var content = optionalText(body.content, 'content');
  if (content !== undefined) assign('content', content);
  if (Array.isArray(body.tags)) assign('tags', body.tags.map(function (t) { return String(t); }).slice(0, 30));
  if (sets.length === 0) throw badRequest('no updatable field supplied');
  assign('updated_at', new Date().toISOString());

  params.push(noteId);
  await db.query('UPDATE mcc_notes SET ' + sets.join(', ') + ' WHERE id = $' + params.length, params);
  sendJson(res, 200, { id: noteId });
}

// ---------------------------------------------------------------------------
// Workflows (§18) — read-only in V1. Displaying a chain is V1; "Start
// Workflow" stepping is V2. Neither ever executes a command.
// ---------------------------------------------------------------------------

async function getWorkflows(res) {
  var workflows = await db.query(
    'SELECT w.id, w.slug, w.title, w.description, p.slug AS project_slug FROM mcc_workflows w ' +
    'LEFT JOIN mcc_projects p ON p.id = w.project_id ORDER BY w.title'
  );
  var steps = await db.query(
    'SELECT wc.workflow_id, wc.position, wc.note, c.slug, c.title, c.safety_level ' +
    'FROM mcc_workflow_commands wc JOIN mcc_commands c ON c.id = wc.command_id ORDER BY wc.workflow_id, wc.position'
  );
  var byWorkflow = {};
  steps.rows.forEach(function (s) {
    var key = String(s.workflow_id);
    if (!byWorkflow[key]) byWorkflow[key] = [];
    byWorkflow[key].push({
      position: toInt(s.position), note: s.note, slug: s.slug, title: s.title, safety_level: s.safety_level
    });
  });
  sendJson(res, 200, {
    workflows: workflows.rows.map(function (w) {
      return {
        slug: w.slug, title: w.title, description: w.description,
        project_slug: w.project_slug, steps: byWorkflow[String(w.id)] || []
      };
    })
  });
}

// ---------------------------------------------------------------------------
// GET /api/export — JSON export (§22)
//
// "Never lock the data inside the UI." This returns the entire library,
// including archived commands and full version history, in a shape that
// the seed loader can read back.
// ---------------------------------------------------------------------------

async function getExport(res) {
  var commands = await db.query(COMMAND_SELECT + ' ORDER BY c.id');
  var relations = await db.query(
    'SELECT a.slug AS command, b.slug AS related, r.relation_type FROM mcc_command_relations r ' +
    'JOIN mcc_commands a ON a.id = r.command_id JOIN mcc_commands b ON b.id = r.related_command_id ORDER BY a.slug'
  );
  var categories = await db.query('SELECT slug, name_en, name_fr, name_ar, description, color, sort_order FROM mcc_categories ORDER BY sort_order, slug');
  var projects = await db.query('SELECT slug, name, description, sort_order FROM mcc_projects ORDER BY sort_order, slug');
  var tags = await db.query('SELECT slug, label FROM mcc_tags ORDER BY slug');
  var notes = await db.query(
    'SELECT n.title, n.content, n.scope, n.tags, n.created_at, c.slug AS command_slug ' +
    'FROM mcc_notes n LEFT JOIN mcc_commands c ON c.id = n.command_id ORDER BY n.id'
  );
  var workflows = await db.query(
    'SELECT w.slug, w.title, w.description, ' +
    '  coalesce((SELECT json_agg(json_build_object(\'position\', wc.position, \'command\', c.slug, \'note\', wc.note) ORDER BY wc.position) ' +
    '   FROM mcc_workflow_commands wc JOIN mcc_commands c ON c.id = wc.command_id WHERE wc.workflow_id = w.id), \'[]\'::json) AS steps ' +
    'FROM mcc_workflows w ORDER BY w.slug'
  );

  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    'Content-Disposition': 'attachment; filename="mythos-command-center-export.json"'
  });
  res.end(JSON.stringify({
    format: 'mythos-command-center/v1',
    exported_at: new Date().toISOString(),
    categories: categories.rows,
    projects: projects.rows,
    tags: tags.rows,
    commands: commands.rows.map(shapeCommand),
    relations: relations.rows,
    notes: notes.rows,
    workflows: workflows.rows
  }, null, 2));
}

// ---------------------------------------------------------------------------
// Static assets
// ---------------------------------------------------------------------------

var WEB_ASSETS = {
  '/': { file: 'index.html', contentType: 'text/html; charset=utf-8' },
  '/index.html': { file: 'index.html', contentType: 'text/html; charset=utf-8' },
  '/app.css': { file: 'app.css', contentType: 'text/css; charset=utf-8' },
  '/app.js': { file: 'app.js', contentType: 'application/javascript; charset=utf-8' },
  '/i18n.js': { file: 'i18n.js', contentType: 'application/javascript; charset=utf-8' }
};

// No inline script, no inline style, no external origin. The front end is
// three same-origin files, so the policy can be this tight — and a tight
// policy is what keeps a stored command's text from ever becoming script.
var WEB_CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
              "connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'";

function serveWebAsset(req, res, pathname) {
  var asset = WEB_ASSETS[pathname];
  if (!asset) return false;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8', 'Allow': 'GET, HEAD' });
    res.end(JSON.stringify({ error: 'method not allowed' }));
    return true;
  }
  fs.readFile(path.join(__dirname, 'web', asset.file), function (err, content) {
    if (err) return sendJson(res, 500, { error: 'application asset unavailable' });
    res.writeHead(200, {
      'Content-Type': asset.contentType,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
      'Content-Security-Policy': WEB_CSP
    });
    res.end(req.method === 'HEAD' ? undefined : content);
  });
  return true;
}

// ---------------------------------------------------------------------------
// Routing
//
// `auth: true` means the route requires a bearer token. Every route that
// changes the library carries it; reads and the usage counter do not.
// ---------------------------------------------------------------------------

var ROUTES = [
  { method: 'GET',   auth: false, pattern: /^\/api\/health$/,                       handler: function (req, res) { return getHealth(res); } },
  { method: 'GET',   auth: false, pattern: /^\/api\/commands$/,                     handler: function (req, res, m, q) { return getCommands(res, q); } },
  { method: 'POST',  auth: true,  pattern: /^\/api\/commands$/,                     handler: function (req, res, m, q, body) { return createCommand(res, body); } },
  { method: 'GET',   auth: false, pattern: /^\/api\/commands\/([^/]+)$/,            handler: function (req, res, m) { return getCommand(res, m[1]); } },
  { method: 'PATCH', auth: true,  pattern: /^\/api\/commands\/([^/]+)$/,            handler: function (req, res, m, q, body) { return updateCommand(res, m[1], body); } },
  { method: 'GET',   auth: false, pattern: /^\/api\/commands\/([^/]+)\/versions$/,  handler: function (req, res, m) { return getCommandVersions(res, m[1]); } },
  { method: 'POST',  auth: true,  pattern: /^\/api\/commands\/([^/]+)\/status$/,    handler: function (req, res, m, q, body) { return setCommandStatus(res, m[1], body); } },
  { method: 'POST',  auth: true,  pattern: /^\/api\/commands\/([^/]+)\/duplicate$/, handler: function (req, res, m, q, body) { return duplicateCommand(res, m[1], body); } },
  { method: 'POST',  auth: true,  pattern: /^\/api\/commands\/([^/]+)\/favorite$/,  handler: function (req, res, m, q, body) { return setFavorite(res, m[1], body); } },
  // Public on purpose — see auth.js. It can only move a counter.
  { method: 'POST',  auth: false, pattern: /^\/api\/commands\/([^/]+)\/usage$/,     handler: function (req, res, m, q, body) { return recordUsage(res, m[1], body); } },
  { method: 'POST',  auth: false, pattern: /^\/api\/commands\/([^/]+)\/render$/,    handler: function (req, res, m, q, body) { return renderCommand(res, m[1], body); } },
  { method: 'GET',   auth: false, pattern: /^\/api\/dashboard$/,                    handler: function (req, res) { return getDashboard(res); } },
  { method: 'GET',   auth: false, pattern: /^\/api\/statistics$/,                   handler: function (req, res) { return getStatistics(res); } },
  { method: 'GET',   auth: false, pattern: /^\/api\/categories$/,                   handler: function (req, res) { return getCategories(res); } },
  { method: 'POST',  auth: true,  pattern: /^\/api\/categories$/,                   handler: function (req, res, m, q, body) { return createCategory(res, body); } },
  { method: 'GET',   auth: false, pattern: /^\/api\/tags$/,                         handler: function (req, res) { return getTags(res); } },
  { method: 'POST',  auth: true,  pattern: /^\/api\/tags$/,                         handler: function (req, res, m, q, body) { return createTag(res, body); } },
  { method: 'GET',   auth: false, pattern: /^\/api\/projects$/,                     handler: function (req, res) { return getProjects(res); } },
  { method: 'POST',  auth: true,  pattern: /^\/api\/projects$/,                     handler: function (req, res, m, q, body) { return createProject(res, body); } },
  { method: 'GET',   auth: false, pattern: /^\/api\/notes$/,                        handler: function (req, res, m, q) { return getNotes(res, q); } },
  { method: 'POST',  auth: true,  pattern: /^\/api\/notes$/,                        handler: function (req, res, m, q, body) { return createNote(res, body); } },
  { method: 'PATCH', auth: true,  pattern: /^\/api\/notes\/(\d+)$/,                 handler: function (req, res, m, q, body) { return updateNote(res, m[1], body); } },
  { method: 'GET',   auth: false, pattern: /^\/api\/workflows$/,                    handler: function (req, res) { return getWorkflows(res); } },
  { method: 'GET',   auth: false, pattern: /^\/api\/export$/,                       handler: function (req, res) { return getExport(res); } },
  // Lets the UI show the owner whether the token it holds is still valid,
  // without a write attempt. Returns the identity, never the token.
  { method: 'GET',   auth: true,  pattern: /^\/api\/session$/,                      handler: function (req, res) {
      return sendJson(res, 200, { identity: auth.identityFromRequest(req) });
  } }
];

function createServer() {
  return http.createServer(function (req, res) {
    var parsed = url.parse(req.url, true);
    var pathname = parsed.pathname;

    if (serveWebAsset(req, res, pathname)) return;

    var matchedPath = ROUTES.filter(function (r) { return r.pattern.test(pathname); });
    if (matchedPath.length === 0) return notFound(res);

    var matchedMethod = matchedPath.filter(function (r) { return r.method === req.method; });
    if (matchedMethod.length === 0) {
      var allowed = matchedPath.map(function (r) { return r.method; }).join(', ');
      res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8', 'Allow': allowed });
      return res.end(JSON.stringify({ error: 'method not allowed' }));
    }

    var route = matchedMethod[0];
    var m = pathname.match(route.pattern);

    Promise.resolve().then(async function () {
      if (route.auth) {
        var identity = auth.identityFromRequest(req);
        if (!identity) {
          // 401 with no WWW-Authenticate challenge: a browser basic-auth
          // dialog would be misleading, the token is pasted in the UI.
          throw httpError(401, 'authentication required for this operation');
        }
      }
      var body = {};
      if (req.method === 'POST' || req.method === 'PATCH') body = await readBody(req);
      return route.handler(req, res, m, parsed.query, body);
    }).catch(function (err) {
      if (res.headersSent) return;
      if (err.httpStatus) {
        var payload = { error: err.message };
        if (err.extra) Object.assign(payload, err.extra);
        return sendJson(res, err.httpStatus, payload);
      }
      // The raw driver message can echo query fragments or connection
      // detail back to an unauthenticated caller, so it never leaves the
      // process. Operators read the real cause from journald.
      console.error('[mcc] unhandled error:', err && err.code ? err.code : 'unknown');
      sendJson(res, 500, { error: 'internal error' });
    });
  });
}

module.exports = {
  createServer: createServer,
  DEFAULT_LIMIT: DEFAULT_LIMIT,
  MAX_LIMIT: MAX_LIMIT,
  MAX_BODY_BYTES: MAX_BODY_BYTES,
  WEB_ASSETS: WEB_ASSETS,
  WEB_CSP: WEB_CSP,
  ROUTES: ROUTES,
  SLUG_TABLES: SLUG_TABLES,
  slugify: slugify
};
