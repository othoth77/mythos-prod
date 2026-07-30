'use strict';
// =====================================================
// MYTHOS OS — Stage 2A automated tests
// Covers: production.plugin.js registration
//         plugin discovery, metadata, lifecycle,
//         duplicate protection, boot/ready verification
//
// Runs in Node.js 22+ with no browser globals.
// =====================================================

// ── Inline Events (identical logic to events.js) ──────────────────────
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

// ── Platform factory (identical logic to platform.js) ─────────────────
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

// ── Canonical production manifest (mirrors production.plugin.js) ───────
var PRODUCTION_MANIFEST = {
  id:          'production',
  label:       'Production',
  version:     '1.0.0',
  type:        'business',
  description: 'Gestion complète d\'une société de production événementielle : '
              + 'facturation, devis, contrats, ordres de mission, '
              + 'collaborateurs, comptabilité et répertoire client.',
  menu: {
    section: 'Production',
    order:   10,
    icon:    'production'
  },
  routes: [
    { id: 'dashboard',             label: 'Tableau de bord',      icon: '📊', render: null },
    { id: 'list',                  label: 'Factures',             icon: '🧾', render: null },
    { id: 'new',                   label: 'Nouvelle facture',     icon: '➕', render: null },
    { id: 'devis',                 label: 'Devis',                icon: '📋', render: null },
    { id: 'devis-form',            label: 'Nouveau devis',        icon: '➕', render: null },
    { id: 'contracts',             label: 'Contrats',             icon: '📄', render: null },
    { id: 'contract-form',         label: 'Nouveau contrat',      icon: '➕', render: null },
    { id: 'rendez-vous',           label: 'Rendez-vous',          icon: '📅', render: null },
    { id: 'representations',       label: 'Représentations',     icon: '🎭', render: null },
    { id: 'om-list',               label: 'Ordres de mission',    icon: '🗂️', render: null },
    { id: 'om-new',                label: 'Nouvel OM',            icon: '➕', render: null },
    { id: 'clients',               label: 'Clients',              icon: '🏢', render: null },
    { id: 'collaborateurs',        label: 'Collaborateurs',       icon: '👥', render: null },
    { id: 'natures',               label: 'Natures de prestation', icon: '🏷️', render: null },
    { id: 'fournisseurs',          label: 'Fournisseurs',         icon: '🚚', render: null },
    { id: 'comptabilite',          label: 'Comptabilité',         icon: '💳', render: null },
    { id: 'compta-bank',           label: 'Extrait bancaire',     icon: '🏦', render: null },
    { id: 'compta-cash',           label: 'Caisse',               icon: '💰', render: null },
    { id: 'compta-expenses',       label: 'Dépenses',             icon: '📉', render: null },
    { id: 'compta-purchases',      label: 'Factures achats',      icon: '🛒', render: null },
    { id: 'compta-suppliers',      label: 'Fournisseurs compta',  icon: '📦', render: null },
    { id: 'compta-categories',     label: 'Catégories dépenses',  icon: '🗂️', render: null },
    { id: 'compta-reconciliation', label: 'Réconciliation',       icon: '🔄', render: null },
    { id: 'statistique',           label: 'Statistiques',         icon: '📈', render: null },
    { id: 'calculateur-spectacle', label: 'Calculateur spectacle', icon: '🎪', render: null },
    { id: 'inscriptions',          label: 'Inscriptions',         icon: '📝', render: null },
    { id: 'appel',                 label: 'Suivi des appels',     icon: '📞', render: null },
    { id: 'conformite',            label: 'Liste conforme',       icon: '✅', render: null },
    { id: 'sauvegarde',            label: 'Sauvegarde',           icon: '💾', render: null },
    { id: 'parametres',            label: 'Paramètres',           icon: '⚙️', render: null }
  ],
  storageKeys: [
    'mp_invoices','mp_devis','mp_contracts',
    'mp_rdvs','mp_representations',
    'mp_oms',
    'mp_clients','mp_collabs','mp_natures',
    'mp_bank_entries','mp_cash_entries','mp_expenses',
    'mp_expense_categories','mp_suppliers','mp_purchases',
    'mp_vehicules','mp_documents',
    'mp_validated_inscriptions','mp_appels'
  ],
  onBoot:  function () {},
  onReady: function () {}
};

// ── Test harness ──────────────────────────────────────────────────────
var pass = 0, fail = 0, results = [];
function check(label, cond) {
  if (cond) { pass++; results.push({ok:true, label:label}); console.log('  PASS: '+label); }
  else       { fail++; results.push({ok:false,label:label}); console.error('  FAIL: '+label); }
}

// ═════════════════════════════════════════════════════════════════════
// [GROUP 1] Plugin registration
// ═════════════════════════════════════════════════════════════════════
console.log('\n── Registration ──────────────────────────────────────────');

var P = makePlatform();

// [1] Registration returns true
check('registerPlugin returns true for valid production manifest',
  P.registerPlugin(PRODUCTION_MANIFEST) === true);

// [2] Plugin is discovered after registration
check('plugin discovered: hasPlugin("production") is true',
  P.hasPlugin('production'));

// [3] Unknown plugin is not discovered
check('unknown plugin: hasPlugin("crm") is false',
  !P.hasPlugin('crm'));

// ═════════════════════════════════════════════════════════════════════
// [GROUP 2] Plugin metadata
// ═════════════════════════════════════════════════════════════════════
console.log('\n── Metadata ──────────────────────────────────────────────');

var plugin = P.getPlugin('production');

check('getPlugin returns non-null object',        plugin !== null);
check('id is "production"',                       plugin.id      === 'production');
check('label is "Production"',                    plugin.label   === 'Production');
check('version is "1.0.0"',                       plugin.version === '1.0.0');
check('type is "business"',                       plugin.type    === 'business');
check('description is a non-empty string',
  typeof plugin.description === 'string' && plugin.description.length > 0);

// Menu metadata
check('menu.section is "Production"',  plugin.menu && plugin.menu.section === 'Production');
check('menu.order is 10',              plugin.menu && plugin.menu.order   === 10);
check('menu.icon is "production"',     plugin.menu && plugin.menu.icon    === 'production');

// Routes
check('routes is a non-empty array',
  Array.isArray(plugin.routes) && plugin.routes.length > 0);
check('routes has a "dashboard" entry',
  plugin.routes.some(function(r) { return r.id === 'dashboard'; }));
check('routes has a "list" (factures) entry',
  plugin.routes.some(function(r) { return r.id === 'list'; }));
check('routes has a "om-list" entry',
  plugin.routes.some(function(r) { return r.id === 'om-list'; }));
check('routes has a "comptabilite" entry',
  plugin.routes.some(function(r) { return r.id === 'comptabilite'; }));
check('every route has an id and label',
  plugin.routes.every(function(r) { return r.id && r.label; }));
check('routes count is 30',           plugin.routes.length === 30);

// Storage keys
check('storageKeys is a non-empty array',
  Array.isArray(plugin.storageKeys) && plugin.storageKeys.length > 0);
check('storageKeys includes mp_invoices',
  plugin.storageKeys.indexOf('mp_invoices') !== -1);
check('storageKeys includes mp_oms',
  plugin.storageKeys.indexOf('mp_oms') !== -1);
check('storageKeys includes mp_bank_entries',
  plugin.storageKeys.indexOf('mp_bank_entries') !== -1);
check('storageKeys count is 19',      plugin.storageKeys.length === 19);

// Hooks are functions
check('onBoot is a function',  typeof plugin.onBoot  === 'function');
check('onReady is a function', typeof plugin.onReady === 'function');

// ═════════════════════════════════════════════════════════════════════
// [GROUP 3] getPlugin returns a safe copy
// ═════════════════════════════════════════════════════════════════════
console.log('\n── Safe copy ─────────────────────────────────────────────');

var copy1 = P.getPlugin('production');
var copy2 = P.getPlugin('production');

// Mutating a copy does not affect the registry
copy1.id = 'mutated';
check('mutating copy.id does not affect registry',
  P.getPlugin('production').id === 'production');

// Two calls return distinct objects
check('successive getPlugin calls return distinct objects', copy1 !== copy2);

// ═════════════════════════════════════════════════════════════════════
// [GROUP 4] Duplicate ID protection
// ═════════════════════════════════════════════════════════════════════
console.log('\n── Duplicate protection ──────────────────────────────────');

// Attempt to register the same id again
var dup = {
  id: 'production', label: 'Production 2', version: '2.0.0', type: 'business',
  onBoot: function(){}, onReady: function(){}
};
check('duplicate id rejected (returns false)',
  P.registerPlugin(dup) === false);

// Registry still has the original
var afterDup = P.getPlugin('production');
check('registry unchanged after duplicate rejection',
  afterDup && afterDup.version === '1.0.0');

// getPlugins still contains exactly one production entry
var allPlugins = P.getPlugins();
var productionEntries = allPlugins.filter(function(p) { return p.id === 'production'; });
check('getPlugins has exactly one "production" entry', productionEntries.length === 1);

// ═════════════════════════════════════════════════════════════════════
// [GROUP 5] Boot lifecycle
// ═════════════════════════════════════════════════════════════════════
console.log('\n── Boot lifecycle ────────────────────────────────────────');

// [A] onBoot called during Platform.boot()
var PBoot = makePlatform();
var bootCalled = false;
PBoot.registerPlugin({
  id: 'production', label: 'Production', version: '1.0.0', type: 'business',
  storageKeys: [], routes: [],
  onBoot:  function() { bootCalled = true; },
  onReady: function() {}
});
check('phase is "init" before boot()',  PBoot.phase() === 'init');
PBoot.boot();
check('onBoot hook called during boot()',  bootCalled);
check('phase is "booted" after boot()',    PBoot.phase() === 'booted');

// [B] mythos:boot event emitted
var PEv = makePlatform();
var bootEventFired = false;
Events.once('mythos:boot', function() { bootEventFired = true; });
PEv.registerPlugin({
  id: 'production', label: 'Production', version: '1.0.0', type: 'business',
  storageKeys: [], routes: [], onBoot: function(){}, onReady: function(){}
});
PEv.boot();
check('mythos:boot event emitted by boot()', bootEventFired);

// [C] mythos:plugin:booted event emitted for production
var PEv2 = makePlatform();
var bootedEventId = null;
Events.once('mythos:plugin:booted', function(p) { bootedEventId = p.id; });
PEv2.registerPlugin({
  id: 'production', label: 'Production', version: '1.0.0', type: 'business',
  storageKeys: [], routes: [], onBoot: function(){}, onReady: function(){}
});
PEv2.boot();
check('mythos:plugin:booted emitted with id "production"',
  bootedEventId === 'production');

// [D] boot is idempotent
var bootCount = 0;
var PIdem = makePlatform();
PIdem.registerPlugin({
  id: 'production', label: 'Production', version: '1.0.0', type: 'business',
  storageKeys: [], routes: [],
  onBoot:  function() { bootCount++; },
  onReady: function() {}
});
PIdem.boot();
PIdem.boot(); // second call — must be no-op
check('boot is idempotent: onBoot called exactly once', bootCount === 1);

// ═════════════════════════════════════════════════════════════════════
// [GROUP 6] Ready lifecycle
// ═════════════════════════════════════════════════════════════════════
console.log('\n── Ready lifecycle ───────────────────────────────────────');

// [A] onReady called during Platform.ready()
var PReady = makePlatform();
var readyCalled = false;
PReady.registerPlugin({
  id: 'production', label: 'Production', version: '1.0.0', type: 'business',
  storageKeys: [], routes: [],
  onBoot:  function() {},
  onReady: function() { readyCalled = true; }
});
PReady.ready();
check('onReady hook called during ready()', readyCalled);
check('phase is "ready" after ready()',     PReady.phase() === 'ready');

// [B] mythos:ready event carries plugin list
var PEv3 = makePlatform();
var readyPlugins = null;
Events.once('mythos:ready', function(p) { readyPlugins = p.plugins; });
PEv3.registerPlugin({
  id: 'production', label: 'Production', version: '1.0.0', type: 'business',
  storageKeys: [], routes: [], onBoot: function(){}, onReady: function(){}
});
PEv3.ready();
check('mythos:ready event includes "production" in plugins array',
  Array.isArray(readyPlugins) && readyPlugins.indexOf('production') !== -1);

// [C] ready is idempotent
var readyCount = 0;
var PRIdem = makePlatform();
PRIdem.registerPlugin({
  id: 'production', label: 'Production', version: '1.0.0', type: 'business',
  storageKeys: [], routes: [],
  onBoot:  function() {},
  onReady: function() { readyCount++; }
});
PRIdem.ready();
PRIdem.ready();
check('ready is idempotent: onReady called exactly once', readyCount === 1);

// ═════════════════════════════════════════════════════════════════════
// [GROUP 7] Lifecycle event ordering with production plugin
// ═════════════════════════════════════════════════════════════════════
console.log('\n── Full lifecycle order ──────────────────────────────────');

var PFull = makePlatform();
var evOrder = [];
Events.on('mythos:plugin:registered', function(p) { evOrder.push('registered:'+p.id); });
Events.on('mythos:boot',              function()   { evOrder.push('boot'); });
Events.on('mythos:plugin:booted',     function(p)  { evOrder.push('booted:'+p.id); });
Events.on('mythos:ready',             function()   { evOrder.push('ready'); });

PFull.registerPlugin({
  id: 'production', label: 'Production', version: '1.0.0', type: 'business',
  storageKeys: [], routes: [], onBoot: function(){}, onReady: function(){}
});
PFull.boot();
PFull.ready();

var expected = ['registered:production','boot','booted:production','ready'];
check('full lifecycle order is correct',
  JSON.stringify(evOrder) === JSON.stringify(expected));

// Clean up global event listeners added during tests
Events.off('mythos:plugin:registered', function(){});
Events.off('mythos:boot',              function(){});
Events.off('mythos:plugin:booted',     function(){});
Events.off('mythos:ready',             function(){});

// ═════════════════════════════════════════════════════════════════════
// Summary
// ═════════════════════════════════════════════════════════════════════
console.log('\n══════════════════════════════════════════════════════════');
console.log(' MYTHOS OS Stage 2A tests — ' + pass + ' passed, ' + fail + ' failed');
console.log('══════════════════════════════════════════════════════════');
if (fail > 0) {
  results.filter(function(r) { return !r.ok; })
         .forEach(function(r) { console.error('  FAIL: ' + r.label); });
  process.exit(1);
}
