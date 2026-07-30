'use strict';
// =====================================================
// MYTHOS OS — Stage 2B automated tests
// Covers: 6 shared plugins + production plugin together
//         registration, type, uniqueness, metadata,
//         safe-copy, duplicate protection, lifecycle
// =====================================================

// ── Inline Events ─────────────────────────────────────────────────────
var Events = (function () {
  var _l = {};
  function on(n, h) {
    if (typeof n !== 'string' || !n || typeof h !== 'function') return function(){};
    if (!_l[n]) _l[n] = [];
    _l[n].push(h);
    return function() { off(n, h); };
  }
  function off(n, h) {
    if (!_l[n]) return;
    _l[n] = _l[n].filter(function(x) { return x !== h; });
    if (!_l[n].length) delete _l[n];
  }
  function once(n, h) {
    if (typeof h !== 'function') return function(){};
    function w(p) { off(n,w); h(p); }
    w._original = h;
    return on(n, w);
  }
  function emit(n, p) {
    if (typeof n !== 'string' || !n) return;
    (_l[n]||[]).slice().forEach(function(h) { try { h(p); } catch(e){} });
  }
  return { on:on, off:off, once:once, emit:emit };
})();

// ── Platform factory ──────────────────────────────────────────────────
function makePlatform() {
  var _plugins = {}, _order = [], _phase = 'init';
  var REQ = ['id','label','version','type'];
  var TYPES = {core:true,shared:true,business:true};
  function _val(m) {
    if (!m || typeof m !== 'object') return 'not an object';
    for (var i=0;i<REQ.length;i++) if (!m[REQ[i]] && m[REQ[i]]!==0) return 'missing '+REQ[i];
    if (typeof m.id!=='string'||!/^[a-z][a-z0-9-]*$/.test(m.id)) return 'bad id';
    if (!TYPES[m.type]) return 'bad type';
    if (typeof m.version!=='string') return 'bad version';
    return null;
  }
  function _copy(m) { var c={},k=Object.keys(m); for(var i=0;i<k.length;i++) c[k[i]]=m[k[i]]; return c; }
  function registerPlugin(m) {
    if (_val(m)) return false;
    if (_plugins[m.id]) return false;
    _plugins[m.id]=m; _order.push(m.id);
    Events.emit('mythos:plugin:registered',{id:m.id,label:m.label,type:m.type});
    return true;
  }
  function getPlugin(id)  { return _plugins[id]?_copy(_plugins[id]):null; }
  function getPlugins()   { return _order.map(function(id){return _copy(_plugins[id]);}); }
  function hasPlugin(id)  { return Object.prototype.hasOwnProperty.call(_plugins,id); }
  function boot() {
    if (_phase!=='init') return;
    _phase='booted';
    Events.emit('mythos:boot',{ts:new Date().toISOString()});
    _order.forEach(function(id) {
      var mf=_plugins[id];
      if (typeof mf.onBoot==='function') { try{mf.onBoot();}catch(e){} }
      Events.emit('mythos:plugin:booted',{id:id});
    });
  }
  function ready() {
    if (_phase==='ready') return;
    if (_phase==='init') boot();
    _phase='ready';
    _order.forEach(function(id) {
      var mf=_plugins[id];
      if (typeof mf.onReady==='function') { try{mf.onReady();}catch(e){} }
    });
    Events.emit('mythos:ready',{ts:new Date().toISOString(),plugins:_order.slice()});
  }
  function phase() { return _phase; }
  return { registerPlugin:registerPlugin, getPlugin:getPlugin, getPlugins:getPlugins,
           hasPlugin:hasPlugin, boot:boot, ready:ready, phase:phase };
}

// ── Canonical manifests ───────────────────────────────────────────────

var PRODUCTION_MANIFEST = {
  id: 'production', label: 'Production', version: '1.0.0', type: 'business',
  menu: { section: 'Production', order: 10, icon: 'production' },
  routes: [
    { id: 'dashboard', label: 'Tableau de bord', icon: '📊', render: null },
    { id: 'list',      label: 'Factures',         icon: '🧾', render: null }
    // abbreviated — full list tested in Stage 2A
  ],
  storageKeys: ['mp_invoices', 'mp_devis', 'mp_contracts',
                'mp_rdvs', 'mp_representations', 'mp_oms',
                'mp_clients', 'mp_collabs', 'mp_natures',
                'mp_bank_entries', 'mp_cash_entries', 'mp_expenses',
                'mp_expense_categories', 'mp_suppliers', 'mp_purchases',
                'mp_vehicules', 'mp_documents',
                'mp_validated_inscriptions', 'mp_appels'],
  onBoot: function(){}, onReady: function(){}
};

var DASHBOARD_MANIFEST = {
  id: 'dashboard', label: 'Dashboard', version: '1.0.0', type: 'shared',
  description: 'Vue synthétique de l\'activité.',
  menu: { section: 'Général', order: 1, icon: 'dashboard' },
  routes: [{ id: 'dashboard', label: 'Tableau de bord', icon: '🏠', render: null }],
  storageKeys: [],
  onBoot: function(){}, onReady: function(){}
};

var CALENDAR_MANIFEST = {
  id: 'calendar', label: 'Calendrier', version: '1.0.0', type: 'shared',
  description: 'Vue calendrier mensuelle.',
  menu: { section: 'Général', order: 2, icon: 'calendar' },
  routes: [{ id: 'calendrier', label: 'Calendrier', icon: '📅', render: null }],
  storageKeys: [],
  onBoot: function(){}, onReady: function(){}
};

var TASKS_MANIFEST = {
  id: 'tasks', label: 'Tâches', version: '1.0.0', type: 'shared',
  description: 'Gestionnaire de tâches.',
  menu: { section: 'Général', order: 3, icon: 'tasks' },
  routes: [{ id: 'tache', label: 'Mes Tâches', icon: '📋', render: null }],
  storageKeys: ['mp_taches'],
  onBoot: function(){}, onReady: function(){}
};

var PLANNING_MANIFEST = {
  id: 'planning', label: 'Planning', version: '1.0.0', type: 'shared',
  description: 'Système de rappels récurrents.',
  menu: { section: 'Général', order: 4, icon: 'planning' },
  routes: [],
  storageKeys: ['mp_rappels', 'mp_rappel_types'],
  onBoot: function(){}, onReady: function(){}
};

var CONTACTS_MANIFEST = {
  id: 'contacts', label: 'Contacts', version: '1.0.0', type: 'shared',
  description: 'Répertoire de contacts.',
  menu: { section: 'Général', order: 5, icon: 'contacts' },
  routes: [
    { id: 'gestion-contacts', label: 'Répertoire',    icon: '👥', render: null },
    { id: 'contact-fiche',    label: 'Fiche contact', icon: '👤', render: null }
  ],
  storageKeys: ['mp_repertoire_contacts', 'mp_repertoire_imports'],
  onBoot: function(){}, onReady: function(){}
};

var NOTES_MANIFEST = {
  id: 'notes', label: 'Rédaction', version: '1.0.0', type: 'shared',
  description: 'Éditeur de documents à champs dynamiques.',
  menu: { section: 'Général', order: 6, icon: 'notes' },
  routes: [
    { id: 'redaction-das',    label: 'Rédaction DAS',    icon: '📝', render: null },
    { id: 'redaction-autres', label: 'Rédaction Autres', icon: '📝', render: null }
  ],
  storageKeys: ['mp_rddocs_das', 'mp_rddocs_autres'],
  onBoot: function(){}, onReady: function(){}
};

var ALL_SHARED = [DASHBOARD_MANIFEST, CALENDAR_MANIFEST, TASKS_MANIFEST,
                  PLANNING_MANIFEST,  CONTACTS_MANIFEST, NOTES_MANIFEST];
var EXPECTED_IDS = ['production','dashboard','calendar','tasks','planning','contacts','notes'];

// ── Test harness ──────────────────────────────────────────────────────
var pass = 0, fail = 0;
function check(label, cond) {
  if (cond) { pass++; console.log('  PASS: ' + label); }
  else       { fail++; console.error('  FAIL: ' + label); }
}

// Helper: build a fully registered platform with all 7 plugins
function buildFullPlatform() {
  var P = makePlatform();
  P.registerPlugin(PRODUCTION_MANIFEST);
  ALL_SHARED.forEach(function(m) { P.registerPlugin(m); });
  return P;
}

// ═════════════════════════════════════════════════════════════════════
// [GROUP 1] All shared plugins register
// ═════════════════════════════════════════════════════════════════════
console.log('\n── All shared plugins register ───────────────────────────');

var P = buildFullPlatform();

check('dashboard registers',  P.hasPlugin('dashboard'));
check('calendar registers',   P.hasPlugin('calendar'));
check('tasks registers',      P.hasPlugin('tasks'));
check('planning registers',   P.hasPlugin('planning'));
check('contacts registers',   P.hasPlugin('contacts'));
check('notes registers',      P.hasPlugin('notes'));
check('production still registers', P.hasPlugin('production'));

// ═════════════════════════════════════════════════════════════════════
// [GROUP 2] Plugin type correctness
// ═════════════════════════════════════════════════════════════════════
console.log('\n── Plugin type ───────────────────────────────────────────');

['dashboard','calendar','tasks','planning','contacts','notes'].forEach(function(id) {
  check(id + ' type is "shared"',
    P.getPlugin(id) && P.getPlugin(id).type === 'shared');
});
check('production type is "business"',
  P.getPlugin('production') && P.getPlugin('production').type === 'business');

// ═════════════════════════════════════════════════════════════════════
// [GROUP 3] Unique IDs — no duplicates across all plugins
// ═════════════════════════════════════════════════════════════════════
console.log('\n── Unique IDs ────────────────────────────────────────────');

var allPlugins = P.getPlugins();
var ids = allPlugins.map(function(p) { return p.id; });
var uniqueIds = ids.filter(function(id, i) { return ids.indexOf(id) === i; });
check('all registered IDs are unique', ids.length === uniqueIds.length);
check('total plugin count is 7', allPlugins.length === 7);

EXPECTED_IDS.forEach(function(id) {
  check('expected id "' + id + '" present in registry', ids.indexOf(id) !== -1);
});

// ═════════════════════════════════════════════════════════════════════
// [GROUP 4] Metadata correctness per plugin
// ═════════════════════════════════════════════════════════════════════
console.log('\n── Metadata: dashboard ──────────────────────────────────');
var dash = P.getPlugin('dashboard');
check('dashboard label is "Dashboard"',             dash.label   === 'Dashboard');
check('dashboard version is "1.0.0"',               dash.version === '1.0.0');
check('dashboard has route "dashboard"',
  Array.isArray(dash.routes) && dash.routes.some(function(r){ return r.id === 'dashboard'; }));
check('dashboard storageKeys is empty array',
  Array.isArray(dash.storageKeys) && dash.storageKeys.length === 0);
check('dashboard menu.section is "Général"',        dash.menu && dash.menu.section === 'Général');
check('dashboard menu.order is 1',                  dash.menu && dash.menu.order === 1);

console.log('\n── Metadata: calendar ───────────────────────────────────');
var cal = P.getPlugin('calendar');
check('calendar label is "Calendrier"',             cal.label    === 'Calendrier');
check('calendar has route "calendrier"',
  Array.isArray(cal.routes) && cal.routes.some(function(r){ return r.id === 'calendrier'; }));
check('calendar storageKeys is empty array',
  Array.isArray(cal.storageKeys) && cal.storageKeys.length === 0);
check('calendar menu.order is 2',                   cal.menu && cal.menu.order === 2);

console.log('\n── Metadata: tasks ──────────────────────────────────────');
var tasks = P.getPlugin('tasks');
check('tasks label is "Tâches"',                    tasks.label === 'Tâches');
check('tasks has route "tache"',
  Array.isArray(tasks.routes) && tasks.routes.some(function(r){ return r.id === 'tache'; }));
check('tasks storageKeys includes "mp_taches"',
  tasks.storageKeys && tasks.storageKeys.indexOf('mp_taches') !== -1);
check('tasks storageKeys count is 1',               tasks.storageKeys.length === 1);
check('tasks menu.order is 3',                      tasks.menu && tasks.menu.order === 3);

console.log('\n── Metadata: planning ───────────────────────────────────');
var plan = P.getPlugin('planning');
check('planning label is "Planning"',               plan.label === 'Planning');
check('planning routes is empty array (modal-only)',
  Array.isArray(plan.routes) && plan.routes.length === 0);
check('planning storageKeys includes "mp_rappels"',
  plan.storageKeys && plan.storageKeys.indexOf('mp_rappels') !== -1);
check('planning storageKeys includes "mp_rappel_types"',
  plan.storageKeys && plan.storageKeys.indexOf('mp_rappel_types') !== -1);
check('planning storageKeys count is 2',            plan.storageKeys.length === 2);
check('planning menu.order is 4',                   plan.menu && plan.menu.order === 4);

console.log('\n── Metadata: contacts ───────────────────────────────────');
var contacts = P.getPlugin('contacts');
check('contacts label is "Contacts"',               contacts.label === 'Contacts');
check('contacts has route "gestion-contacts"',
  contacts.routes && contacts.routes.some(function(r){ return r.id === 'gestion-contacts'; }));
check('contacts has route "contact-fiche"',
  contacts.routes && contacts.routes.some(function(r){ return r.id === 'contact-fiche'; }));
check('contacts routes count is 2',                 contacts.routes.length === 2);
check('contacts storageKeys includes "mp_repertoire_contacts"',
  contacts.storageKeys && contacts.storageKeys.indexOf('mp_repertoire_contacts') !== -1);
check('contacts storageKeys includes "mp_repertoire_imports"',
  contacts.storageKeys && contacts.storageKeys.indexOf('mp_repertoire_imports') !== -1);
check('contacts storageKeys count is 2',            contacts.storageKeys.length === 2);
check('contacts menu.order is 5',                   contacts.menu && contacts.menu.order === 5);

console.log('\n── Metadata: notes ──────────────────────────────────────');
var notes = P.getPlugin('notes');
check('notes label is "Rédaction"',                 notes.label === 'Rédaction');
check('notes has route "redaction-das"',
  notes.routes && notes.routes.some(function(r){ return r.id === 'redaction-das'; }));
check('notes has route "redaction-autres"',
  notes.routes && notes.routes.some(function(r){ return r.id === 'redaction-autres'; }));
check('notes routes count is 2',                    notes.routes.length === 2);
check('notes storageKeys includes "mp_rddocs_das"',
  notes.storageKeys && notes.storageKeys.indexOf('mp_rddocs_das') !== -1);
check('notes storageKeys includes "mp_rddocs_autres"',
  notes.storageKeys && notes.storageKeys.indexOf('mp_rddocs_autres') !== -1);
check('notes storageKeys count is 2',               notes.storageKeys.length === 2);
check('notes menu.order is 6',                      notes.menu && notes.menu.order === 6);

// ═════════════════════════════════════════════════════════════════════
// [GROUP 5] Safe-copy behaviour
// ═════════════════════════════════════════════════════════════════════
console.log('\n── Safe copy ─────────────────────────────────────────────');

var copy1 = P.getPlugin('tasks');
var copy2 = P.getPlugin('tasks');
copy1.id = 'mutated';
check('mutating returned copy does not affect tasks in registry',
  P.getPlugin('tasks').id === 'tasks');
check('successive getPlugin calls return distinct objects', copy1 !== copy2);

// ═════════════════════════════════════════════════════════════════════
// [GROUP 6] Duplicate protection for all plugins
// ═════════════════════════════════════════════════════════════════════
console.log('\n── Duplicate protection ──────────────────────────────────');

var P2 = makePlatform();
ALL_SHARED.forEach(function(m) { P2.registerPlugin(m); });

ALL_SHARED.forEach(function(m) {
  var dup = { id: m.id, label: 'Dup', version: '9.0.0', type: 'shared',
              onBoot: function(){}, onReady: function(){} };
  check('duplicate "' + m.id + '" rejected', P2.registerPlugin(dup) === false);
  check('registry unchanged after dup "' + m.id + '"',
    P2.getPlugin(m.id) && P2.getPlugin(m.id).version === '1.0.0');
});

// ═════════════════════════════════════════════════════════════════════
// [GROUP 7] Platform.boot() lifecycle with all plugins
// ═════════════════════════════════════════════════════════════════════
console.log('\n── Boot lifecycle ────────────────────────────────────────');

var bootedIds = [];
var PB = makePlatform();
Events.on('mythos:plugin:booted', function(p) { bootedIds.push(p.id); });

var bootCounts = {};
[PRODUCTION_MANIFEST].concat(ALL_SHARED).forEach(function(m) {
  var id = m.id;
  bootCounts[id] = 0;
  var manifest = { id: id, label: m.label, version: m.version, type: m.type,
    menu: m.menu, routes: m.routes || [], storageKeys: m.storageKeys || [],
    onBoot: function() { bootCounts[id]++; }, onReady: function(){} };
  PB.registerPlugin(manifest);
});

PB.boot();

check('phase is "booted" after boot()', PB.phase() === 'booted');
EXPECTED_IDS.forEach(function(id) {
  check('onBoot called for "' + id + '"', bootCounts[id] === 1);
});
check('mythos:plugin:booted fired for all 7 plugins', bootedIds.length >= 7);

// ═════════════════════════════════════════════════════════════════════
// [GROUP 8] Platform.ready() lifecycle with all plugins
// ═════════════════════════════════════════════════════════════════════
console.log('\n── Ready lifecycle ───────────────────────────────────────');

var readyCounts = {};
var readyPluginList = null;
var PR = makePlatform();
Events.once('mythos:ready', function(p) { readyPluginList = p.plugins; });

[PRODUCTION_MANIFEST].concat(ALL_SHARED).forEach(function(m) {
  var id = m.id;
  readyCounts[id] = 0;
  var manifest = { id: id, label: m.label, version: m.version, type: m.type,
    menu: m.menu, routes: m.routes || [], storageKeys: m.storageKeys || [],
    onBoot: function(){}, onReady: function() { readyCounts[id]++; } };
  PR.registerPlugin(manifest);
});

PR.ready();

check('phase is "ready" after ready()',   PR.phase() === 'ready');
EXPECTED_IDS.forEach(function(id) {
  check('onReady called for "' + id + '"', readyCounts[id] === 1);
});
check('mythos:ready event includes all 7 plugin ids',
  Array.isArray(readyPluginList) && readyPluginList.length === 7);
EXPECTED_IDS.forEach(function(id) {
  check('mythos:ready plugins includes "' + id + '"',
    readyPluginList && readyPluginList.indexOf(id) !== -1);
});

// ═════════════════════════════════════════════════════════════════════
// [GROUP 9] getPlugins() ordering and production plugin coexistence
// ═════════════════════════════════════════════════════════════════════
console.log('\n── Plugin ordering and coexistence ──────────────────────');

var PO = makePlatform();
PO.registerPlugin(PRODUCTION_MANIFEST);
ALL_SHARED.forEach(function(m) { PO.registerPlugin(m); });

var ordered = PO.getPlugins();
check('getPlugins returns 7 entries', ordered.length === 7);
check('first registered is production', ordered[0].id === 'production');
check('second registered is dashboard', ordered[1].id === 'dashboard');
check('last registered is notes',       ordered[6].id === 'notes');

var sharedOnly = ordered.filter(function(p) { return p.type === 'shared'; });
var bizOnly    = ordered.filter(function(p) { return p.type === 'business'; });
check('6 shared plugins registered',   sharedOnly.length === 6);
check('1 business plugin registered',  bizOnly.length    === 1);

// ═════════════════════════════════════════════════════════════════════
// Summary
// ═════════════════════════════════════════════════════════════════════
console.log('\n══════════════════════════════════════════════════════════');
console.log(' MYTHOS OS Stage 2B tests — ' + pass + ' passed, ' + fail + ' failed');
console.log('══════════════════════════════════════════════════════════');
if (fail > 0) process.exit(1);
