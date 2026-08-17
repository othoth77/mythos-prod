'use strict';
// =====================================================
// MYTHOS — Command Center stage MCC-1 tests
// tests/mcc-1-command-center-test.js
//
// Like tests/ida-2c-readonly-api-test.js, this is NOT an offline suite: it
// makes real HTTP requests against a real PostgreSQL connection, because
// the point of MCC-1 is that the library works against a real database.
//
// ISOLATION — read this before running it anywhere.
// The suite TRUNCATES every table it uses. It therefore refuses to run
// unless the connected database name ends in `_test`. That guard is the
// reason this file can safely truncate at all: pointing it at
// `mythos_command_center` would erase the owner's library, so the check is
// a hard abort, not a warning.
//
// Run with:
//   env MCC_DB_HOST=127.0.0.1 MCC_DB_PORT=5432 \
//       MCC_DB_USER=mythos_command_center_owner MCC_DB_PASSWORD=... \
//       MCC_DB_NAME=mythos_command_center_test \
//       node tests/mcc-1-command-center-test.js
//
// The admin token is generated fresh by this file and injected into
// process.env BEFORE api.js/auth.js are required, so no external identity
// configuration is needed and no real token is ever used by a test.
// =====================================================

var http = require('http');
var path = require('path');
var fs = require('fs');
var crypto = require('crypto');

var BASE = path.join(__dirname, '..');
var APP = path.join(BASE, 'projects', 'command-center');

var pass = 0, fail = 0;
var failures = [];

function ok(condition, label) {
  if (condition) {
    pass++;
  } else {
    fail++;
    failures.push(label);
    console.log('  FAIL ' + label);
  }
}

function eq(actual, expected, label) {
  ok(actual === expected, label + ' (expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual) + ')');
}

var TOKEN = crypto.randomBytes(24).toString('hex');
process.env.MCC_ADMIN_TOKENS = JSON.stringify({ [TOKEN]: 'test-owner' });

var api = require(path.join(APP, 'reference', 'api.js'));
var db = require(path.join(APP, 'reference', 'db.js'));
var auth = require(path.join(APP, 'reference', 'auth.js'));
var secrets = require(path.join(APP, 'reference', 'secrets.js'));
var variables = require(path.join(APP, 'reference', 'variables.js'));
var versioning = require(path.join(APP, 'reference', 'versioning.js'));

var server;
var port;

// ── HTTP helper ─────────────────────────────────────────────────────────

function request(method, requestPath, body, token) {
  return new Promise(function (resolve, reject) {
    var payload = body === undefined ? null : JSON.stringify(body);
    var headers = {};
    if (payload !== null) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    if (token) headers['Authorization'] = 'Bearer ' + token;

    var req = http.request({ host: '127.0.0.1', port: port, path: requestPath, method: method, headers: headers },
      function (res) {
        var chunks = '';
        res.on('data', function (chunk) { chunks += chunk; });
        res.on('end', function () {
          var parsed = null;
          try { parsed = JSON.parse(chunks); } catch (e) { parsed = chunks; }
          resolve({ status: res.statusCode, headers: res.headers, body: parsed });
        });
      });
    req.on('error', reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
}

function authed(method, requestPath, body) {
  return request(method, requestPath, body, TOKEN);
}

// ── Fixtures ────────────────────────────────────────────────────────────

async function resetDatabase() {
  var identity = await db.query('SELECT current_database() AS name');
  var name = identity.rows[0].name;
  if (!/_test$/.test(name)) {
    throw new Error(
      'REFUSING TO RUN: connected to "' + name + '", which is not a _test database. ' +
      'This suite truncates every table it touches.'
    );
  }
  await db.query(
    'TRUNCATE mcc_usage_events, mcc_favorites, mcc_command_versions, mcc_command_relations, ' +
    'mcc_command_tags, mcc_workflow_commands, mcc_notes, mcc_workflows, mcc_templates, ' +
    'mcc_commands, mcc_tags, mcc_projects, mcc_categories RESTART IDENTITY CASCADE'
  );
  await db.query(
    "INSERT INTO mcc_categories (slug, name_en, name_fr, name_ar, sort_order) VALUES " +
    "('github', 'GitHub', 'GitHub', 'غيت هاب', 10), ('testing', 'Testing', 'Tests', NULL, 20)"
  );
  await db.query("INSERT INTO mcc_projects (slug, name) VALUES ('mythos-os', 'Mythos OS'), ('mythos-ai', 'Mythos AI')");
}

// ── Suites ──────────────────────────────────────────────────────────────

async function testPureModules() {
  console.log('\n[1] Pure modules — variables, versioning, secrets');

  // variables.extract / render / unresolved
  var body = 'git push {{REMOTE}} {{BRANCH}} # then check {{BRANCH}}';
  var found = variables.extract(body);
  eq(found.length, 2, 'extract finds two distinct placeholders');
  eq(found[0].name, 'REMOTE', 'extract preserves first-appearance order');
  eq(found[1].occurrences, 2, 'extract counts repeated occurrences');

  eq(variables.render(body, { REMOTE: 'origin', BRANCH: 'main' }),
     'git push origin main # then check main', 'render substitutes every occurrence');
  eq(variables.render(body, { REMOTE: 'origin' }),
     'git push origin {{BRANCH}} # then check {{BRANCH}}', 'render leaves unfilled placeholders intact');
  eq(variables.render(body, { REMOTE: '' }).indexOf('{{REMOTE}}') !== -1, true,
     'render treats an empty value as unfilled rather than blanking it');
  eq(variables.unresolved(body, { REMOTE: 'origin' }).join(','), 'BRANCH', 'unresolved lists only missing names');

  // Single-pass substitution: an injected placeholder is NOT re-expanded.
  eq(variables.render('{{A}}', { A: '{{B}}', B: 'nope' }), '{{B}}',
     'render is single-pass — a filled value is not expanded again');

  eq(variables.render('{{ SPACED }}', { SPACED: 'x' }), 'x', 'render tolerates whitespace inside braces');
  eq(variables.extract('docker ps --format {{.Names}}').length, 0,
     'a Go-template token like {{.Names}} is not treated as a placeholder');

  var described = variables.describe('{{REPOSITORY}}', [{ name: 'REPOSITORY', label: 'Repo', default: 'othoth77/mythos-prod' }]);
  eq(described[0].label, 'Repo', 'describe merges declared label');
  eq(described[0].default, 'othoth77/mythos-prod', 'describe merges declared default');
  eq(variables.describe('{{X}}', [{ name: 'GONE' }]).length, 1, 'describe drops declarations absent from the body');

  // versioning
  eq(versioning.nextVersion('1.0'), '1.1', 'nextVersion bumps the minor');
  eq(versioning.nextVersion('2.9'), '2.10', 'nextVersion does not roll the minor into the major');
  eq(versioning.nextVersion('garbage'), '1.0', 'nextVersion recovers from an unparseable version');
  eq(versioning.isSubstantiveChange({ body: 'a', title: 'T' }, { body: 'b' }), true,
     'a body change is substantive');
  eq(versioning.isSubstantiveChange({ body: 'a', title: 'T' }, { body: 'a' }), false,
     'an identical body is not a change');
  eq(versioning.isSubstantiveChange({ body: 'a' }, { project: 'other' }), false,
     'moving a command between projects is not a new version');

  // secrets — HIGH confidence must block
  var pem = secrets.scan({ body: '-----BEGIN OPENSSH PRIVATE KEY-----\nabc' });
  eq(pem.blocked, true, 'a PEM private key header is blocked');
  eq(pem.findings[0].rule, 'ssh_or_pem_private_key', 'the PEM rule is named in the finding');
  ok(pem.findings[0].excerpt.indexOf('abc') === -1, 'the finding excerpt does not carry the key material');

  eq(secrets.scan({ body: 'AKIAIOSFODNN7EXAMPLE' }).blocked, true, 'an AWS access key ID is blocked');
  eq(secrets.scan({ body: 'ghp_' + 'a'.repeat(36) }).blocked, true, 'a GitHub token is blocked');
  eq(secrets.scan({ body: 'sk-ant-api03-' + 'x'.repeat(40) }).blocked, true, 'an Anthropic key is blocked');
  eq(secrets.scan({ body: 'postgres://user:realpassword123@host/db' }).blocked, true,
     'a connection string with an inline password is blocked');

  // ...and must NOT block the legitimate content this library is full of
  eq(secrets.scan({ body: 'postgres://user:{{DB_PASSWORD}}@host/db' }).blocked, false,
     'a connection string with a placeholder password is allowed');
  eq(secrets.scan({ body: 'export MCC_DB_PASSWORD=$MCC_DB_PASSWORD' }).blocked, false,
     'an environment-variable reference is not a secret');
  eq(secrets.scan({ body: 'password = <your-password-here>' }).warnings.length, 0,
     'an angle-bracket placeholder raises no warning');
  eq(secrets.scan({ body: 'password = changeme' }).warnings.length, 0,
     'a well-known placeholder value raises no warning');
  eq(secrets.scan({ body: 'token = abc' }).warnings.length, 0,
     'a value below the minimum length raises no warning');

  var ambiguous = secrets.scan({ body: 'api_key = 8f3d9a7c2b1e4f60' });
  eq(ambiguous.blocked, false, 'an ambiguous assignment does not block the save');
  eq(ambiguous.warnings.length, 1, 'an ambiguous assignment produces a warning');
  eq(ambiguous.warnings[0].field, 'body', 'the warning names the field it came from');

  // auth
  eq(auth.resolveIdentity(TOKEN), 'test-owner', 'a configured token resolves to its identity');
  eq(auth.resolveIdentity('wrong-token'), null, 'an unknown token resolves to null');
  eq(auth.resolveIdentity(''), null, 'an empty token resolves to null');
  eq(auth.tokenFromRequest({ headers: { authorization: 'Bearer abc' } }), 'abc', 'bearer token is parsed');
  eq(auth.tokenFromRequest({ headers: {} }), null, 'a missing Authorization header yields null');
  eq(auth.tokenFromRequest({ headers: { authorization: 'Basic abc' } }), null, 'Basic auth is not accepted');
}

async function testSourceLevelGuarantees() {
  console.log('\n[2] Source-level guarantees — the library never executes anything');

  var runtimeFiles = [
    'reference/api.js', 'reference/db.js', 'reference/auth.js', 'reference/secrets.js',
    'reference/variables.js', 'reference/versioning.js', 'reference/server.js',
    'reference/web/app.js', 'reference/web/i18n.js'
  ];

  var forbidden = [
    { pattern: /require\(\s*['"]child_process['"]\s*\)/, label: 'child_process' },
    { pattern: /\bexecSync\s*\(/, label: 'execSync' },
    { pattern: /\bspawnSync\s*\(/, label: 'spawnSync' },
    { pattern: /\beval\s*\(/, label: 'eval' },
    { pattern: /new\s+Function\s*\(/, label: 'new Function' }
  ];

  runtimeFiles.forEach(function (relative) {
    var source = fs.readFileSync(path.join(APP, relative), 'utf8');
    forbidden.forEach(function (rule) {
      ok(rule.pattern.test(source) === false, relative + ' contains no ' + rule.label);
    });
  });

  // The front end must never assign untrusted text as markup. The check is
  // on ASSIGNMENT, not on the identifier appearing anywhere — the file's own
  // header comment explains why innerHTML is avoided, and a test that
  // failed on the explanation would be testing prose, not behaviour.
  var frontend = fs.readFileSync(path.join(APP, 'reference', 'web', 'app.js'), 'utf8');
  ok(/\.innerHTML\s*=/.test(frontend) === false, 'the front end never assigns innerHTML');
  ok(/\.outerHTML\s*=/.test(frontend) === false, 'the front end never assigns outerHTML');
  ok(/insertAdjacentHTML/.test(frontend) === false, 'the front end never uses insertAdjacentHTML');
  ok(/document\.write/.test(frontend) === false, 'the front end never uses document.write');

  // There must be no DELETE route for a command (§11, §31).
  ok(api.ROUTES.every(function (route) {
    return !(route.method === 'DELETE' && /commands/.test(String(route.pattern)));
  }), 'no DELETE route exists for commands — archiving is the only removal');

  // Every mutating route except the public usage/render pair requires auth.
  var unauthenticatedWrites = api.ROUTES.filter(function (route) {
    return (route.method === 'POST' || route.method === 'PATCH') && !route.auth;
  }).map(function (route) { return route.method + ' ' + String(route.pattern); });
  eq(unauthenticatedWrites.length, 2,
     'exactly two unauthenticated POST routes exist (usage and render): ' + unauthenticatedWrites.join(' | '));
  ok(unauthenticatedWrites.every(function (entry) { return /usage|render/.test(entry); }),
     'the unauthenticated POST routes are only usage and render');

  ok(/frame-ancestors 'none'/.test(api.WEB_CSP), 'the CSP forbids framing');
  ok(/script-src 'self'/.test(api.WEB_CSP), 'the CSP restricts scripts to same origin');
  ok(api.WEB_CSP.indexOf('unsafe-inline') === -1, 'the CSP does not allow unsafe-inline');
}

async function testHealthAndTaxonomy() {
  console.log('\n[3] Health, categories, projects, tags');

  var health = await request('GET', '/api/health');
  eq(health.status, 200, 'health returns 200');
  eq(health.body.status, 'ok', 'health reports ok');
  eq(health.body.schema, 'mcc', 'health confirms the mcc schema is pinned');
  ok(/_test$/.test(health.body.database), 'health confirms the test database is in use');

  var categories = await request('GET', '/api/categories');
  eq(categories.status, 200, 'categories returns 200');
  eq(categories.body.categories.length, 2, 'both seeded categories are listed');
  eq(categories.body.categories[0].slug, 'github', 'categories are ordered by sort_order');
  eq(categories.body.categories[0].name_ar, 'غيت هاب', 'the Arabic category name round-trips intact');

  var created = await authed('POST', '/api/categories', { name_en: 'Deployment', name_fr: 'Déploiement' });
  eq(created.status, 201, 'an authenticated caller can add a category');
  eq(created.body.slug, 'deployment', 'the new category slug is derived from the name');

  var accented = await authed('POST', '/api/categories', { name_en: 'Sécurité Renforcée' });
  eq(accented.body.slug, 'securite-renforcee', 'accents are stripped when slugifying');

  var rejected = await request('POST', '/api/categories', { name_en: 'Nope' });
  eq(rejected.status, 401, 'an unauthenticated caller cannot add a category');

  var projects = await request('GET', '/api/projects');
  eq(projects.body.projects.length, 2, 'both seeded projects are listed');
}

async function testCommandLifecycle() {
  console.log('\n[4] Command creation, reading, editing and versioning');

  var create = await authed('POST', '/api/commands', {
    title: 'GitHub Final Verification',
    category: 'github',
    project: 'mythos-os',
    description: 'Verify that the commit and files actually exist on GitHub.',
    body: 'git fetch origin\ngit rev-parse origin/{{BRANCH}}\n# repository {{REPOSITORY}}',
    when_to_use: 'After every important delivery.',
    explanation: 'Push and delivered are different statements.',
    safety_level: 'READ_ONLY',
    difficulty: 'BEGINNER',
    tags: ['github', 'verification', 'read-only'],
    variables: [{ name: 'BRANCH', label: 'Branch', default: 'main' }]
  });

  eq(create.status, 201, 'a command is created');
  var command = create.body.command;
  eq(command.slug, 'github-final-verification', 'the slug is derived from the title');
  eq(command.version, '1.0', 'a new command starts at v1.0');
  eq(command.status, 'ACTIVE', 'a new command defaults to ACTIVE');
  eq(command.usage_count, 0, 'a new command has no uses');
  eq(command.tags.join(','), 'github,read-only,verification', 'tags are stored and returned sorted');
  eq(command.variables.length, 2, 'both placeholders in the body are discovered');
  eq(command.variables[0].name, 'BRANCH', 'the first placeholder is BRANCH');
  eq(command.variables[0].default, 'main', 'the declared default reaches the client');
  eq(command.variables[1].declared, false, 'an undeclared placeholder is still surfaced');

  var unauthenticated = await request('POST', '/api/commands', { title: 'X', body: 'Y' });
  eq(unauthenticated.status, 401, 'creating a command without a token is refused');

  var missingTitle = await authed('POST', '/api/commands', { body: 'no title' });
  eq(missingTitle.status, 400, 'a command without a title is rejected');
  var missingBody = await authed('POST', '/api/commands', { title: 'no body' });
  eq(missingBody.status, 400, 'a command without a body is rejected');

  var badCategory = await authed('POST', '/api/commands', { title: 'T', body: 'B', category: 'does-not-exist' });
  eq(badCategory.status, 400, 'an unknown category is rejected');

  // Slug collision
  var duplicateTitle = await authed('POST', '/api/commands', {
    title: 'GitHub Final Verification', body: 'other body'
  });
  eq(duplicateTitle.status, 201, 'a colliding title still creates a command');
  eq(duplicateTitle.body.command.slug, 'github-final-verification-2', 'the colliding slug is uniquified');

  // Detail by slug and by id
  var bySlug = await request('GET', '/api/commands/github-final-verification');
  eq(bySlug.status, 200, 'a command is readable by slug without a token');
  eq(bySlug.body.command.title, 'GitHub Final Verification', 'the detail payload carries the title');
  eq(bySlug.body.command.versions.length, 1, 'the creation snapshot is recorded in version history');
  eq(bySlug.body.command.versions[0].change_note, 'created', 'the first version is labelled created');

  var byId = await request('GET', '/api/commands/' + command.id);
  eq(byId.body.command.slug, 'github-final-verification', 'a command is readable by numeric id');

  var missing = await request('GET', '/api/commands/no-such-command');
  eq(missing.status, 404, 'an unknown command returns 404');

  // Substantive edit bumps the version and preserves the previous one
  var edit = await authed('PATCH', '/api/commands/github-final-verification', {
    body: 'git fetch origin\ngit rev-parse HEAD\ngit rev-parse origin/{{BRANCH}}',
    change_note: 'added local HEAD comparison'
  });
  eq(edit.status, 200, 'an authenticated edit succeeds');
  eq(edit.body.command.version, '1.1', 'a substantive edit bumps the minor version');

  var versions = await request('GET', '/api/commands/github-final-verification/versions');
  eq(versions.body.versions.length, 2, 'the previous version was preserved');
  eq(versions.body.versions[0].version, '1.0', 'the snapshot records the version it WAS, not the new one');
  eq(versions.body.versions[0].change_note, 'added local HEAD comparison', 'the change note is stored');
  ok(versions.body.versions[0].snapshot.body.indexOf('rev-parse HEAD') === -1,
     'the snapshot holds the pre-edit body');

  // A non-substantive edit does not bump
  var housekeeping = await authed('PATCH', '/api/commands/github-final-verification', { project: 'mythos-ai' });
  eq(housekeeping.body.command.version, '1.1', 'moving a command between projects does not bump the version');
  eq(housekeeping.body.command.project.slug, 'mythos-ai', 'the project actually moved');

  // An explicit version always wins
  var manual = await authed('PATCH', '/api/commands/github-final-verification', { version: '2.0', body: 'rewritten' });
  eq(manual.body.command.version, '2.0', 'an explicitly supplied version overrides the automatic bump');

  var unauthorizedEdit = await request('PATCH', '/api/commands/github-final-verification', { title: 'Hijacked' });
  eq(unauthorizedEdit.status, 401, 'editing without a token is refused');

  var stillOriginal = await request('GET', '/api/commands/github-final-verification');
  eq(stillOriginal.body.command.title, 'GitHub Final Verification', 'the refused edit changed nothing');
}

async function testSecretGateOverHttp() {
  console.log('\n[5] Secret gate at the API boundary');

  var blocked = await authed('POST', '/api/commands', {
    title: 'Leaky command',
    body: 'ssh -i key\n-----BEGIN RSA PRIVATE KEY-----\nMIIEow'
  });
  eq(blocked.status, 422, 'a command carrying a private key is refused');
  ok(Array.isArray(blocked.body.findings), 'the refusal names its findings');
  eq(blocked.body.findings[0].rule, 'ssh_or_pem_private_key', 'the finding identifies the rule');
  ok(JSON.stringify(blocked.body).indexOf('MIIEow') === -1, 'the refusal never echoes the key material');

  var absent = await request('GET', '/api/commands/leaky-command');
  eq(absent.status, 404, 'the refused command was not stored at all');

  var warned = await authed('POST', '/api/commands', {
    title: 'Ambiguous command',
    body: 'curl -H "api_key = 9f8e7d6c5b4a3210"'
  });
  eq(warned.status, 201, 'an ambiguous credential shape still saves');
  eq(warned.body.secret_warnings.length, 1, 'the ambiguous shape is returned as a warning');

  var blockedNote = await authed('POST', '/api/notes', {
    title: 'Leaky note',
    content: 'token: ghp_' + 'b'.repeat(36)
  });
  eq(blockedNote.status, 422, 'a note carrying a GitHub token is refused');
}

async function testSearchAndFilters() {
  console.log('\n[6] Search and filtering');

  await authed('POST', '/api/commands', {
    title: 'Run Targeted Tests', category: 'testing', project: 'mythos-os',
    description: 'Validate a change with the cheapest reliable sequence.',
    body: 'node tests/{{TEST_FILE}}',
    explanation: 'Targeted first, full suite only when justified.',
    safety_level: 'SAFE', difficulty: 'INTERMEDIATE', tags: ['verification']
  });
  await authed('POST', '/api/commands', {
    title: 'Force Push Recovery', category: 'github',
    description: 'Recover a branch after history was rewritten.',
    body: 'git reflog',
    safety_level: 'DESTRUCTIVE', difficulty: 'ADVANCED', tags: ['github', 'dangerous'],
    status: 'ARCHIVED'
  });

  var all = await request('GET', '/api/commands');
  ok(all.body.total >= 3, 'the default listing returns the active commands');
  ok(all.body.commands.every(function (c) { return c.status === 'ACTIVE'; }),
     'the default listing excludes archived commands');

  var archived = await request('GET', '/api/commands?status=ARCHIVED');
  eq(archived.body.total, 1, 'archived commands are findable through the status filter');
  eq(archived.body.commands[0].slug, 'force-push-recovery', 'the archived command is the expected one');

  var everything = await request('GET', '/api/commands?status=ALL');
  ok(everything.body.total > all.body.total, 'status=ALL returns more than the active-only default');

  var byTitle = await request('GET', '/api/commands?q=verification');
  ok(byTitle.body.total >= 1, 'search matches a title');

  var byBody = await request('GET', '/api/commands?q=reflog&status=ALL');
  eq(byBody.body.total, 1, 'search matches the command body');

  var byExplanation = await request('GET', '/api/commands?q=cheapest');
  eq(byExplanation.body.total, 1, 'search matches the explanation');

  var partial = await request('GET', '/api/commands?q=targ');
  ok(partial.body.total >= 1, 'a partial word matches through the ILIKE fallback');

  // Accent-insensitive search, both directions. The library is bilingual,
  // so an accented stored word must be findable from an unaccented query
  // and vice versa — otherwise half the French content is unreachable.
  await authed('POST', '/api/commands', {
    title: 'Déploiement Sécurisé', category: 'github',
    description: 'Procédure de déploiement en production.',
    body: 'systemctl --user restart {{SERVICE}}',
    explanation: 'Vérifier la configuration avant de recharger nginx.',
    safety_level: 'PRODUCTION'
  });

  var unaccentedQuery = await request('GET', '/api/commands?q=' + encodeURIComponent('deploiement'));
  eq(unaccentedQuery.body.total, 1, 'an unaccented query finds accented content');

  var accentedQuery = await request('GET', '/api/commands?q=' + encodeURIComponent('Déploiement'));
  eq(accentedQuery.body.total, 1, 'an accented query finds the same content');

  var mixedCase = await request('GET', '/api/commands?q=' + encodeURIComponent('SÉCURISÉ'));
  eq(mixedCase.body.total, 1, 'search is case-insensitive across accents');

  var accentInExplanation = await request('GET', '/api/commands?q=' + encodeURIComponent('verifier'));
  eq(accentInExplanation.body.total, 1, 'accent folding reaches the explanation field too');

  var byTag = await request('GET', '/api/commands?tag=verification');
  ok(byTag.body.total >= 1, 'filtering by tag works');

  var byTwoTags = await request('GET', '/api/commands?tag=github&tag=dangerous&status=ALL');
  eq(byTwoTags.body.total, 1, 'two tags narrow the result rather than widening it');

  var byCategory = await request('GET', '/api/commands?category=testing');
  eq(byCategory.body.total, 1, 'filtering by category works');

  var bySafety = await request('GET', '/api/commands?safety=DESTRUCTIVE&status=ALL');
  eq(bySafety.body.total, 1, 'filtering by safety level works');

  var byDifficulty = await request('GET', '/api/commands?difficulty=ADVANCED&status=ALL');
  eq(byDifficulty.body.total, 1, 'filtering by difficulty works');

  var nonsense = await request('GET', '/api/commands?q=zzzznotarealterm');
  eq(nonsense.body.total, 0, 'a term matching nothing returns nothing');

  // A search term shaped like SQL must be treated as literal text.
  var injection = await request('GET', '/api/commands?q=' + encodeURIComponent("'; DROP TABLE mcc_commands; --"));
  eq(injection.status, 200, 'a SQL-shaped search term is handled as text');
  eq(injection.body.total, 0, 'the SQL-shaped term matches nothing');
  var survived = await request('GET', '/api/commands');
  ok(survived.body.total >= 3, 'the commands table survived the injection-shaped search');

  // Bad input
  eq((await request('GET', '/api/commands?limit=0')).status, 400, 'limit below 1 is rejected');
  eq((await request('GET', '/api/commands?limit=999')).status, 400, 'limit above the maximum is rejected');
  eq((await request('GET', '/api/commands?limit=-5')).status, 400, 'a negative limit is rejected');
  eq((await request('GET', '/api/commands?sort=drop_table')).status, 400, 'an unknown sort key is rejected');
  eq((await request('GET', '/api/commands?difficulty=WIZARD')).status, 400, 'an unknown difficulty is rejected');

  // Paging
  var firstPage = await request('GET', '/api/commands?limit=1&offset=0&sort=title');
  var secondPage = await request('GET', '/api/commands?limit=1&offset=1&sort=title');
  eq(firstPage.body.commands.length, 1, 'a page respects its limit');
  ok(firstPage.body.commands[0].slug !== secondPage.body.commands[0].slug,
     'consecutive pages do not overlap');
}

async function testUsageTracking() {
  console.log('\n[7] Copy tracking and usage counters');

  var before = await request('GET', '/api/commands/run-targeted-tests');
  eq(before.body.command.usage_count, 0, 'the command starts unused');
  eq(before.body.command.last_used_at, null, 'the command has no last-used timestamp');

  // Public on purpose: copying must not require a token (§7).
  var copy = await request('POST', '/api/commands/run-targeted-tests/usage', { event_type: 'COPY' });
  eq(copy.status, 200, 'a copy is recorded without any token');
  eq(copy.body.usage_count, 1, 'the counter increments on copy');
  ok(copy.body.last_used_at !== null, 'the last-used timestamp is set');

  await request('POST', '/api/commands/run-targeted-tests/usage', { event_type: 'COPY' });
  var twice = await request('GET', '/api/commands/run-targeted-tests');
  // The GET itself records an OPEN, which must not inflate the count.
  eq(twice.body.command.usage_count, 2, 'two copies count as two uses');

  var open = await request('POST', '/api/commands/run-targeted-tests/usage', { event_type: 'OPEN' });
  eq(open.body.usage_count, 2, 'an OPEN event does not increment the use counter');

  var history = await request('GET', '/api/commands/run-targeted-tests');
  ok(history.body.command.usage_history.length >= 3, 'every event appears in the usage history');

  var badEvent = await request('POST', '/api/commands/run-targeted-tests/usage', { event_type: 'EXECUTE' });
  eq(badEvent.status, 400, 'an unknown event type is rejected — there is no EXECUTE event');

  var unknownCommand = await request('POST', '/api/commands/nope/usage', {});
  eq(unknownCommand.status, 404, 'recording usage for an unknown command returns 404');

  var mostUsed = await request('GET', '/api/commands?sort=most_used');
  eq(mostUsed.body.commands[0].slug, 'run-targeted-tests', 'the most-used sort puts the copied command first');
}

async function testFavorites() {
  console.log('\n[8] Favorites');

  var on = await authed('POST', '/api/commands/run-targeted-tests/favorite', { favorite: true });
  eq(on.status, 200, 'a command can be favorited');
  eq(on.body.command.is_favorite, true, 'the command reports itself as a favorite');

  var listed = await request('GET', '/api/commands?favorite=true');
  eq(listed.body.total, 1, 'the favorites filter returns exactly the favorited command');

  var ranked = await authed('POST', '/api/commands/github-final-verification/favorite', { favorite: true, rank: 1 });
  eq(ranked.body.command.favorite_rank, 1, 'a custom rank is stored');

  var ordered = await request('GET', '/api/commands?favorite=true&sort=favorite');
  eq(ordered.body.commands[0].slug, 'github-final-verification', 'favorites sort by their custom rank');

  var off = await authed('POST', '/api/commands/run-targeted-tests/favorite', { favorite: false });
  eq(off.body.command.is_favorite, false, 'a favorite can be removed');
  eq((await request('GET', '/api/commands?favorite=true')).body.total, 1, 'the removed favorite is gone from the list');

  eq((await request('POST', '/api/commands/run-targeted-tests/favorite', { favorite: true })).status, 401,
     'favoriting without a token is refused');
}

async function testArchiveAndDuplicate() {
  console.log('\n[9] Archive, restore and duplicate');

  var archive = await authed('POST', '/api/commands/run-targeted-tests/status', { status: 'ARCHIVED' });
  eq(archive.status, 200, 'a command can be archived');
  eq(archive.body.command.status, 'ARCHIVED', 'the status changed to ARCHIVED');

  var stillThere = await request('GET', '/api/commands/run-targeted-tests');
  eq(stillThere.status, 200, 'an archived command is still readable — nothing was deleted');

  var searchable = await request('GET', '/api/commands?status=ARCHIVED&q=targeted');
  ok(searchable.body.total >= 1, 'an archived command remains searchable through the Archived filter');

  var restore = await authed('POST', '/api/commands/run-targeted-tests/status', { status: 'ACTIVE' });
  eq(restore.body.command.status, 'ACTIVE', 'an archived command can be restored');

  var badStatus = await authed('POST', '/api/commands/run-targeted-tests/status', { status: 'DELETED' });
  eq(badStatus.status, 400, 'there is no DELETED status');

  var deleteAttempt = await authed('DELETE', '/api/commands/run-targeted-tests');
  eq(deleteAttempt.status, 405, 'DELETE on a command is not allowed');
  ok(String(deleteAttempt.headers.allow || '').indexOf('GET') !== -1, 'the 405 advertises the allowed methods');

  var duplicate = await authed('POST', '/api/commands/run-targeted-tests/duplicate', {});
  eq(duplicate.status, 201, 'a command can be duplicated');
  eq(duplicate.body.command.status, 'DRAFT', 'a duplicate starts as a DRAFT');
  eq(duplicate.body.command.version, '1.0', 'a duplicate restarts version numbering');
  eq(duplicate.body.command.usage_count, 0, 'a duplicate does not inherit usage counts');
  ok(duplicate.body.command.slug !== 'run-targeted-tests', 'the duplicate has its own slug');
  eq(duplicate.body.command.tags.join(','), 'verification', 'the duplicate inherits the original tags');

  var original = await request('GET', '/api/commands/run-targeted-tests');
  ok(original.body.command.usage_count > 0, 'the original keeps its usage count after duplication');
}

async function testVariableRendering() {
  console.log('\n[10] Variable substitution over HTTP');

  var render = await request('POST', '/api/commands/github-final-verification/render', {
    values: { BRANCH: 'main' }
  });
  eq(render.status, 200, 'render returns 200');
  ok(render.body.rendered.indexOf('{{BRANCH}}') === -1, 'the supplied placeholder was substituted');

  var partial = await request('POST', '/api/commands/run-targeted-tests/render', { values: {} });
  eq(partial.body.unresolved.join(','), 'TEST_FILE', 'unfilled placeholders are reported');
  ok(partial.body.rendered.indexOf('{{TEST_FILE}}') !== -1, 'unfilled placeholders remain in the output');

  var filled = await request('POST', '/api/commands/run-targeted-tests/render', {
    values: { TEST_FILE: 'mcc-1-command-center-test.js' }
  });
  eq(filled.body.rendered, 'node tests/mcc-1-command-center-test.js', 'the filled command is exactly right');
  eq(filled.body.unresolved.length, 0, 'nothing is left unresolved');

  // Rendering must not store anything.
  var unchanged = await request('GET', '/api/commands/run-targeted-tests');
  ok(unchanged.body.command.body.indexOf('{{TEST_FILE}}') !== -1, 'rendering did not modify the stored command');
}

async function testNotes() {
  console.log('\n[11] Notes');

  var general = await authed('POST', '/api/notes', {
    title: 'Use this after MAOL stage commits',
    content: 'MAOL stages land as several commits. Verify each.',
    tags: ['maol']
  });
  eq(general.status, 201, 'a general note is created');

  var onCommand = await authed('POST', '/api/notes', {
    title: 'Check repository identity first',
    content: 'othoth77/mythos-os is a stale copy, not a mirror.',
    command: 'github-final-verification'
  });
  eq(onCommand.status, 201, 'a note attached to a command is created');

  var detail = await request('GET', '/api/commands/github-final-verification');
  eq(detail.body.command.notes.length, 1, 'the note appears on the command detail page');
  eq(detail.body.command.notes[0].title, 'Check repository identity first', 'the right note is attached');

  var all = await request('GET', '/api/notes');
  eq(all.body.notes.length, 2, 'both notes are listed');

  var scoped = await request('GET', '/api/notes?scope=COMMAND');
  eq(scoped.body.notes.length, 1, 'notes can be filtered by scope');

  var byCommand = await request('GET', '/api/notes?command=github-final-verification');
  eq(byCommand.body.notes.length, 1, 'notes can be filtered by command');

  var searched = await request('GET', '/api/notes?q=stale');
  eq(searched.body.notes.length, 1, 'note content is searchable');

  // A note's text feeds the command search too.
  var viaNote = await request('GET', '/api/commands?q=mirror');
  eq(viaNote.body.total, 1, 'a command is findable through the text of its note');

  var update = await authed('PATCH', '/api/notes/' + onCommand.body.id, { content: 'Updated guidance.' });
  eq(update.status, 200, 'a note can be edited');

  var badScope = await authed('POST', '/api/notes', { title: 'Orphan', scope: 'COMMAND' });
  eq(badScope.status, 400, 'a COMMAND-scoped note without a command is rejected');

  var unauthenticated = await request('POST', '/api/notes', { title: 'Sneaky' });
  eq(unauthenticated.status, 401, 'creating a note without a token is refused');
}

async function testRelationsAndWorkflows() {
  console.log('\n[12] Related commands and workflows');

  await authed('PATCH', '/api/commands/github-final-verification', {
    related: [
      { slug: 'run-targeted-tests', relation_type: 'PREVIOUS' },
      { slug: 'force-push-recovery', relation_type: 'RELATED' }
    ]
  });

  var detail = await request('GET', '/api/commands/github-final-verification');
  eq(detail.body.command.related.length, 2, 'both relations are stored');
  var previous = detail.body.command.related.filter(function (r) { return r.relation_type === 'PREVIOUS'; });
  eq(previous.length, 1, 'the PREVIOUS relation is preserved with its type');
  eq(previous[0].slug, 'run-targeted-tests', 'the PREVIOUS relation points at the right command');

  // A dangling reference is dropped rather than raising an error.
  await authed('PATCH', '/api/commands/github-final-verification', {
    related: [{ slug: 'does-not-exist', relation_type: 'NEXT' }, { slug: 'run-targeted-tests' }]
  });
  var afterDangling = await request('GET', '/api/commands/github-final-verification');
  eq(afterDangling.body.command.related.length, 1, 'a dangling relation is dropped, the valid one kept');

  // Self-relation is refused by the schema and filtered before it gets there.
  await authed('PATCH', '/api/commands/github-final-verification', {
    related: [{ slug: 'github-final-verification' }]
  });
  var afterSelf = await request('GET', '/api/commands/github-final-verification');
  eq(afterSelf.body.command.related.length, 0, 'a command cannot relate to itself');

  var workflows = await request('GET', '/api/workflows');
  eq(workflows.status, 200, 'the workflows endpoint responds');
  ok(Array.isArray(workflows.body.workflows), 'workflows are returned as a list');
}

async function testStatisticsAndDashboard() {
  console.log('\n[13] Dashboard and statistics');

  var dashboard = await request('GET', '/api/dashboard');
  eq(dashboard.status, 200, 'the dashboard responds');
  ['most_used', 'favorites', 'recently_used', 'recently_added', 'recommended', 'categories'].forEach(function (key) {
    ok(Array.isArray(dashboard.body[key]), 'the dashboard includes ' + key);
  });
  ok(dashboard.body.recommended.every(function (c) { return c.usage_count === 0; }),
     'recommended contains only commands that have never been used');

  var stats = await request('GET', '/api/statistics');
  eq(stats.status, 200, 'statistics respond');
  ok(stats.body.totals.total_commands > 0, 'total commands is counted');
  eq(stats.body.totals.active_commands + stats.body.totals.archived_commands + stats.body.totals.draft_commands,
     stats.body.totals.total_commands, 'the status counts sum to the total');
  ok(stats.body.totals.total_uses > 0, 'total uses is counted');
  ok(stats.body.totals.added_this_month > 0, 'commands added this month are counted');
  ['most_used_today', 'most_used_week', 'most_used_month', 'most_used_all_time'].forEach(function (key) {
    ok(Array.isArray(stats.body[key]), 'statistics include the ' + key + ' leaderboard');
  });
  ok(stats.body.most_used_all_time.length > 0, 'the all-time leaderboard is populated');
  eq(stats.body.most_used_command.slug, stats.body.most_used_all_time[0].slug,
     'the headline most-used command agrees with the leaderboard');
  ok(stats.body.most_used_all_time.every(function (row) { return row.uses > 0; }),
     'the leaderboard excludes OPEN-only commands');
}

async function testExport() {
  console.log('\n[14] Export');

  var exported = await request('GET', '/api/export');
  eq(exported.status, 200, 'export responds');
  eq(exported.body.format, 'mythos-command-center/v1', 'the export declares its format');
  ok(Array.isArray(exported.body.commands), 'the export carries commands');
  ok(Array.isArray(exported.body.categories), 'the export carries categories');
  ok(Array.isArray(exported.body.notes), 'the export carries notes');
  ok(Array.isArray(exported.body.relations), 'the export carries relations');
  ok(exported.body.commands.some(function (c) { return c.status === 'ARCHIVED'; }),
     'the export includes archived commands — nothing is locked in the UI');
  ok(String(exported.headers['content-disposition'] || '').indexOf('attachment') !== -1,
     'the export is served as a download');
}

async function testTransportAndErrors() {
  console.log('\n[15] Transport, headers and error handling');

  var page = await request('GET', '/');
  eq(page.status, 200, 'the application page is served at the root');
  ok(String(page.headers['content-security-policy'] || '').indexOf("script-src 'self'") !== -1,
     'the page carries the strict CSP');
  eq(page.headers['x-content-type-options'], 'nosniff', 'the page sets nosniff');
  eq(page.headers['x-frame-options'], 'DENY', 'the page refuses framing');

  var css = await request('GET', '/app.css');
  eq(css.status, 200, 'the stylesheet is served');
  var script = await request('GET', '/app.js');
  eq(script.status, 200, 'the front-end script is served');

  var unknownPath = await request('GET', '/api/nope');
  eq(unknownPath.status, 404, 'an unknown API path returns 404');

  var wrongMethod = await request('PATCH', '/api/health');
  eq(wrongMethod.status, 405, 'a wrong method returns 405');
  ok(String(wrongMethod.headers.allow || '').indexOf('GET') !== -1, 'the 405 names the allowed method');

  var session = await authed('GET', '/api/session');
  eq(session.status, 200, 'a valid token can check its session');
  eq(session.body.identity, 'test-owner', 'the session returns the identity');
  ok(JSON.stringify(session.body).indexOf(TOKEN) === -1, 'the session response never echoes the token');

  eq((await request('GET', '/api/session')).status, 401, 'no token means no session');
  eq((await request('GET', '/api/session', undefined, 'wrong')).status, 401, 'a wrong token is refused');

  // Malformed JSON body
  var malformed = await new Promise(function (resolve, reject) {
    var req = http.request({
      host: '127.0.0.1', port: port, path: '/api/commands', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOKEN }
    }, function (res) {
      var data = '';
      res.on('data', function (c) { data += c; });
      res.on('end', function () { resolve({ status: res.statusCode, body: data }); });
    });
    req.on('error', reject);
    req.end('{not json');
  });
  eq(malformed.status, 400, 'a malformed JSON body returns 400');

  // Oversized body
  var oversized = await authed('POST', '/api/commands', {
    title: 'Huge', body: 'x'.repeat(api.MAX_BODY_BYTES + 1024)
  });
  ok(oversized.status === 413 || oversized.status === 400,
     'an oversized body is rejected (got ' + oversized.status + ')');

  // An id too large for a bigint must be a clean 404, not a driver error
  // leaking out as a 500.
  var badId = await request('GET', '/api/commands/9999999999999999999999');
  eq(badId.status, 404, 'an out-of-range numeric id returns 404, not a driver error');
  ok(String(badId.body.error).toLowerCase().indexOf('select') === -1, 'an error message never leaks SQL');
  ok(String(badId.body.error).toLowerCase().indexOf('password') === -1,
     'an error message never leaks connection detail');
  ok(String(badId.body.error).indexOf('22P02') === -1, 'an error message never leaks a PostgreSQL error code');
}

async function testSeedLibraryIntegrity() {
  console.log('\n[16] Seed library integrity (static file check)');

  var library = JSON.parse(fs.readFileSync(path.join(APP, 'seed', 'library.json'), 'utf8'));

  var categorySlugs = {};
  library.categories.forEach(function (c) { categorySlugs[c.slug] = true; });
  var projectSlugs = {};
  library.projects.forEach(function (p) { projectSlugs[p.slug] = true; });
  var commandSlugs = {};
  library.commands.forEach(function (c) { commandSlugs[c.slug] = true; });

  ok(library.commands.length >= 18, 'the seed carries at least the 18 commands required by §29 (' + library.commands.length + ')');

  library.commands.forEach(function (command) {
    ok(!!command.slug && !!command.title && !!command.body, 'seed command has slug, title and body: ' + command.slug);
    ok(categorySlugs[command.category] === true, 'seed command "' + command.slug + '" has a known category');
    ok(!command.project || projectSlugs[command.project] === true, 'seed command "' + command.slug + '" has a known project');
    ok(['SAFE', 'READ_ONLY', 'WRITE', 'PRODUCTION', 'DESTRUCTIVE'].indexOf(command.safety_level) !== -1,
       'seed command "' + command.slug + '" has a valid safety level');
    ok(!!command.source, 'seed command "' + command.slug + '" cites its source document');
    ok(secrets.scan({ body: command.body, explanation: command.explanation }).blocked === false,
       'seed command "' + command.slug + '" carries no credential');
  });

  library.relations.forEach(function (relation) {
    ok(commandSlugs[relation.command] === true && commandSlugs[relation.related] === true,
       'seed relation resolves: ' + relation.command + ' -> ' + relation.related);
  });

  library.workflows.forEach(function (workflow) {
    workflow.steps.forEach(function (step) {
      ok(commandSlugs[step.command] === true,
         'seed workflow "' + workflow.slug + '" step ' + step.position + ' resolves');
    });
  });

  // The commands §29 names explicitly must all be present.
  var required = [
    'preflight', 'architecture-investigation', 'implementation', 'targeted-testing', 'audit',
    'github-commit-and-delivery', 'github-final-verification', 'ai-handover-update',
    'concurrent-work-protection', 'blocker-handling', 'global-architecture-review', 'v1-design',
    'n8n-ai-integration', 'self-improvement-loop', 'architectural-decisions', 'repository-migration',
    'final-stage-gate', 'short-universal-command'
  ];
  required.forEach(function (slug) {
    ok(commandSlugs[slug] === true, 'the seed includes the required command "' + slug + '"');
  });
}

// ── Runner ──────────────────────────────────────────────────────────────

async function run() {
  console.log('MYTHOS AI COMMAND CENTER — MCC-1 test suite');

  var missing = db.REQUIRED_ENV.filter(function (name) { return !process.env[name]; });
  if (missing.length) {
    console.error('Missing required environment variable(s): ' + missing.join(', '));
    process.exit(2);
  }

  await resetDatabase();

  server = api.createServer();
  await new Promise(function (resolve) {
    server.listen(0, '127.0.0.1', function () {
      port = server.address().port;
      resolve();
    });
  });

  try {
    await testPureModules();
    await testSourceLevelGuarantees();
    await testHealthAndTaxonomy();
    await testCommandLifecycle();
    await testSecretGateOverHttp();
    await testSearchAndFilters();
    await testUsageTracking();
    await testFavorites();
    await testArchiveAndDuplicate();
    await testVariableRendering();
    await testNotes();
    await testRelationsAndWorkflows();
    await testStatisticsAndDashboard();
    await testExport();
    await testTransportAndErrors();
    await testSeedLibraryIntegrity();
  } finally {
    await new Promise(function (resolve) { server.close(resolve); });
    await db.closePool();
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (fail > 0) {
    console.log('\nFailures:');
    failures.forEach(function (label) { console.log('  - ' + label); });
  }
  process.exit(fail > 0 ? 1 : 0);
}

run().catch(function (err) {
  console.error('\nSUITE ERROR: ' + err.message);
  console.error(err.stack);
  process.exit(2);
});
