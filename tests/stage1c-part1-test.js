// =====================================================
// Stage 1C Part 1 — fetch() audit verification tests
// tests/stage1c-part1-test.js
//
// Verifies:
//   1. Core API layer (_apiGet/_apiPost) is present
//   2. fetch() inventory document exists and is complete
//   3. Protected function signatures are unchanged
//   4. No regression in Platform / Shell from prior stages
//
// Run with: node tests/stage1c-part1-test.js
// =====================================================
'use strict';

var fs   = require('fs');
var path = require('path');
var vm   = require('vm');

var BASE = path.resolve(__dirname, '..');
var _pass = 0, _fail = 0, _results = [];

function ok(cond, label) {
  if (cond) { _pass++; _results.push('  PASS ' + label); }
  else       { _fail++; _results.push('  FAIL ' + label); }
}
function section(title) { _results.push('\n' + title); }

// ── Shared sandbox context ────────────────────────────────────────────
var sandbox = vm.createContext({
  // browser stubs
  document:        { title: '', getElementById: function() { return null; } },
  location:        { hash: '#dashboard' },
  showView:        function(v) { return v; },
  AbortController: function() { this.signal = {}; this.abort = function(){}; },
  fetch:           function() {
    return Promise.resolve({
      ok: true,
      status: 200,
      json: function() { return Promise.resolve({}); }
    });
  },
  // Node globals needed by modules
  console:   console,
  global:    global,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  Promise:   Promise,
  JSON:      JSON,
  Date:      Date,
  Array:     Array,
  Object:    Object,
  encodeURIComponent: encodeURIComponent
});

function load(rel) {
  var src = fs.readFileSync(path.join(BASE, rel), 'utf8');
  vm.runInContext(src, sandbox);
}

// Load modules in dependency order
load('js/core/events.js');
load('js/core/storage.js');
load('js/core/api.js');
load('js/core/platform.js');
load('js/core/shell.js');
load('js/plugins/production.plugin.js');
load('js/plugins/dashboard.plugin.js');
load('js/plugins/tasks.plugin.js');
load('js/plugins/planning.plugin.js');
load('js/plugins/contacts.plugin.js');
load('js/plugins/notes.plugin.js');
load('js/plugins/calendar.plugin.js');

// Aliases for convenience
var Events   = sandbox.Events;
var Platform = sandbox.Platform;
var Shell    = sandbox.Shell;

// ── SECTION 1: Core API layer ─────────────────────────────────────────
section('1. Core API layer (_apiGet / _apiPost / _apiFetch)');

ok(typeof sandbox._apiGet       === 'function', '_apiGet is a function');
ok(typeof sandbox._apiPost      === 'function', '_apiPost is a function');
ok(typeof sandbox._apiFetch     === 'function', '_apiFetch is a function');
ok(typeof sandbox._apiTimeout   === 'function', '_apiTimeout is a function');
ok(typeof sandbox._apiParseJson === 'function', '_apiParseJson is a function');
ok(typeof sandbox._apiRetry     === 'function', '_apiRetry is a function');

var getP  = sandbox._apiGet({});
var postP = sandbox._apiPost({ test: 1 });
ok(getP  && typeof getP.then  === 'function', '_apiGet returns a Promise');
ok(postP && typeof postP.then === 'function', '_apiPost returns a Promise');

var t = sandbox._apiTimeout(100);
ok(t && typeof t.signal === 'object',   '_apiTimeout returns { signal, clear }');
ok(t && typeof t.clear  === 'function', '_apiTimeout.clear is a function');

// ── SECTION 2: Events / Platform / Shell ──────────────────────────────
section('2. Platform layer (Events / Platform / Shell)');

ok(Events   && typeof Events.on           === 'function', 'Events.on exists');
ok(Events   && typeof Events.emit         === 'function', 'Events.emit exists');
ok(Platform && typeof Platform.registerPlugin === 'function', 'Platform.registerPlugin exists');
ok(Platform && typeof Platform.getPlugin      === 'function', 'Platform.getPlugin exists');
ok(Shell    && typeof Shell.sidebar           === 'object',   'Shell.sidebar exists');
ok(Shell    && typeof Shell.navigation        === 'object',   'Shell.navigation exists');
ok(Shell    && typeof Shell.workspace         === 'object',   'Shell.workspace exists');
ok(Shell    && typeof Shell.widgets           === 'object',   'Shell.widgets exists');
ok(Shell    && typeof Shell.header            === 'object',   'Shell.header exists');

// ── SECTION 3: fetch() inventory document ─────────────────────────────
section('3. fetch() inventory document (docs/fetch-inventory.md)');

var invPath = path.join(BASE, 'docs', 'fetch-inventory.md');
ok(fs.existsSync(invPath), 'docs/fetch-inventory.md exists');

var inv = fs.existsSync(invPath) ? fs.readFileSync(invPath, 'utf8') : '';
ok(inv.indexOf('SYNC ENGINE')          !== -1, 'Category: SYNC ENGINE documented');
ok(inv.indexOf('AUTO-BACKUP')          !== -1, 'Category: AUTO-BACKUP documented');
ok(inv.indexOf('BACKUP / RESTORE')     !== -1, 'Category: BACKUP/RESTORE documented');
ok(inv.indexOf('FILE UPLOAD')          !== -1, 'Category: FILE UPLOAD documented');
ok(inv.indexOf('GOOGLE SHEETS')        !== -1, 'Category: GOOGLE SHEETS documented');
ok(inv.indexOf('GOOGLE OAUTH')         !== -1, 'Category: GOOGLE OAUTH documented');
ok(inv.indexOf('AUTH LOGOUT')          !== -1, 'Category: AUTH LOGOUT documented');
ok(inv.indexOf('Zero calls qualify')   !== -1, 'Zero-migration verdict documented');
ok(inv.indexOf('_flushPending')        !== -1, '_flushPending appears in inventory');
ok(inv.indexOf('syncFromServer')       !== -1, 'syncFromServer appears in inventory');
ok(inv.indexOf('_triggerAutoBackup')   !== -1, '_triggerAutoBackup appears in inventory');
ok(inv.indexOf('keepalive')            !== -1, 'keepalive constraint documented');
ok(inv.indexOf('upload.php')           !== -1, 'upload.php calls documented');
ok(inv.indexOf('23')                   !== -1, 'Total count (23 calls) documented');

// Confirm taches/rappels/redaction section
ok(inv.indexOf('taches.js')            !== -1, 'taches.js zero-fetch result documented');
ok(inv.indexOf('rappels.js')           !== -1, 'rappels.js zero-fetch result documented');
ok(inv.indexOf('redaction.js')         !== -1, 'redaction.js zero-fetch result documented');

// ── SECTION 4: refactoring-plan.md updated ────────────────────────────
section('4. refactoring-plan.md updated');

var planPath = path.join(BASE, 'docs', 'refactoring-plan.md');
ok(fs.existsSync(planPath), 'docs/refactoring-plan.md exists');

var plan = fs.existsSync(planPath) ? fs.readFileSync(planPath, 'utf8') : '';
ok(plan.indexOf('Stage 1C')              !== -1, 'Stage 1C section in refactoring-plan.md');
ok(plan.indexOf('fetch-inventory.md')    !== -1, 'Inventory link in refactoring-plan.md');
ok(plan.indexOf('zero calls migrated')   !== -1, 'Zero-migration note in refactoring-plan.md');

// ── SECTION 5: Plugin regression (Stage 2A-2C) ────────────────────────
section('5. Plugin regression (Stage 2A-2C)');

ok(Platform.getPlugin('production') !== null, 'production plugin still registered');
ok(Platform.getPlugin('dashboard')  !== null, 'dashboard plugin still registered');
ok(Platform.getPlugin('tasks')      !== null, 'tasks plugin still registered');
ok(Platform.getPlugin('planning')   !== null, 'planning plugin still registered');
ok(Platform.getPlugin('contacts')   !== null, 'contacts plugin still registered');
ok(Platform.getPlugin('notes')      !== null, 'notes plugin still registered');
ok(Platform.getPlugin('calendar')   !== null, 'calendar plugin still registered');

var prod = Platform.getPlugin('production');
ok(prod && prod.routes && prod.routes.length === 30,
   'production plugin retains 30 routes');
ok(prod && prod.storageKeys && prod.storageKeys.length === 19,
   'production plugin retains 19 storageKeys');

var planning = Platform.getPlugin('planning');
ok(planning && Array.isArray(planning.routes) && planning.routes.length === 0,
   'planning plugin still has 0 routes (modal-only)');

// Shell sidebar auto-populated from plugin auto-registration
var sections = Shell.sidebar.getSections();
ok(sections.length >= 1, 'Shell sidebar has at least 1 section');
var items = Shell.sidebar.getItems();
ok(items.length >= 30, 'Shell sidebar has at least 30 items (production routes)');

// Shell navigation adapter
ok(typeof Shell.navigation.go      === 'function', 'Shell.navigation.go exists');
ok(typeof Shell.navigation.current === 'function', 'Shell.navigation.current exists');
ok(Shell.navigation.current() === 'dashboard',
   'Shell.navigation.current() returns "dashboard" for hash "#dashboard"');

// Shell workspace
Shell.workspace.setTitle('Test');
ok(Shell.workspace.getTitle() === 'Test', 'Shell.workspace.setTitle/getTitle round-trip');
Shell.workspace.setSubtitle('Sub');
ok(Shell.workspace.getSubtitle() === 'Sub', 'Shell.workspace.setSubtitle/getSubtitle round-trip');

// ── Results ───────────────────────────────────────────────────────────
_results.forEach(function(r) { console.log(r); });
console.log('\n' + (_fail === 0 ? '✓' : '✗') +
  ' ' + _pass + '/' + (_pass + _fail) + ' tests passed');
if (_fail > 0) { process.exit(1); }
