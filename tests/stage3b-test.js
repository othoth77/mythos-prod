// =====================================================
// MYTHOS OS — Stage 3B automated tests
// tests/stage3b-test.js
//
// Covers: contacts.runtime.js — plugin registration,
// onBoot storage validation, onReady MythosSearch wiring,
// search handler, navigation, backward compatibility,
// and regressions.
//
// Run with: node tests/stage3b-test.js
// =====================================================
'use strict';

var fs   = require('fs');
var path = require('path');
var vm   = require('vm');
var cp   = require('child_process');

var BASE  = path.resolve(__dirname, '..');
var _pass = 0, _fail = 0, _results = [];

function ok(cond, label) {
  if (cond) { _pass++; _results.push('  PASS ' + label); }
  else       { _fail++; _results.push('  FAIL ' + label); }
}
function section(title) { _results.push('\n' + title); }

// ── Sample contacts ─────────────────────────────────────────────────────
var SAMPLE_CONTACTS = [
  { id:'c1', nom:'Ben Ali', prenom:'Mohamed', tel1:'+21620000001', tel2:'', email:'ben.ali@acme.tn', metier:'Avocat', domaine:'Juridique', note:'client fidele', tags:['VIP','Tunis'], importBatchId:null },
  { id:'c2', nom:'Trabelsi', prenom:'Fatma', tel1:'+21620000002', tel2:'', email:'fatma@medecin.tn', metier:'Medecin', domaine:'Sante', note:'', tags:['Sfax'], importBatchId:'batch1' },
  { id:'c3', nom:'Dupont', prenom:'Jean', tel1:'0033612345678', tel2:'', email:'jean.dupont@france.fr', metier:'Ingenieur', domaine:'', note:'contact france', tags:[], importBatchId:'batch1' },
  { id:'c4', nom:'', prenom:'', tel1:'+21699999999', tel2:'', email:'', metier:'', domaine:'', note:'', tags:[], importBatchId:null }
];

// ── Sandbox factory ──────────────────────────────────────────────────────
function makeSandbox(overrides) {
  var _lsStore = {};
  var _showViewLog = [];
  var base = {
    document: {
      readyState: 'complete',
      createElement: function(tag) {
        return {
          _tag: tag, className: '', innerHTML: '', textContent: '',
          style: { cssText: '' }, _attrs: {}, onclick: null,
          setAttribute: function(k, v) { this._attrs[k] = v; },
          querySelector: function() { return null; }
        };
      },
      getElementById:   function() { return null; },
      querySelector:    function() { return null; },
      querySelectorAll: function() { return []; },
      body: { appendChild: function() {} }
    },
    window: {
      addEventListener: function() {},
      alert:   function() {},
      confirm: function() { return true; },
      prompt:  function(m, d) { return d || null; }
    },
    location: { hash: '' },
    localStorage: {
      _store: _lsStore,
      getItem:    function(k) { return Object.prototype.hasOwnProperty.call(_lsStore, k) ? _lsStore[k] : null; },
      setItem:    function(k, v) { _lsStore[k] = String(v); },
      removeItem: function(k) { delete _lsStore[k]; }
    },
    fetch: function() {
      return Promise.resolve({ ok: true, json: function() { return Promise.resolve({}); } });
    },
    STORE: {
      _contacts: SAMPLE_CONTACTS.map(function(c) { return Object.assign({}, c); }),
      _imports:  [{ id:'batch1' }],
      repertoireContacts:     function() { return this._contacts; },
      saveRepertoireContacts: function(d) { this._contacts = d; },
      repertoireImports:      function() { return this._imports; },
      saveRepertoireImports:  function(d) { this._imports = d; }
    },
    showView:    function(v) { _showViewLog.push(v); },
    _showViewLog: _showViewLog,
    // task stubs needed when loading tasks.runtime.js
    getTaches:                 function() { return []; },
    tachesOpenModal:           function() {},
    renderTachePage:           function() {},
    renderTachesDashboard:     function() {},
    renderTachesInCalendrier:  function() {},
    renderCalendrier:          function() {},
    updateDashboardStats:      function() {},
    // Node globals
    console:              console,
    Promise:              Promise,
    JSON:                 JSON,
    Date:                 Date,
    Array:                Array,
    Object:               Object,
    String:               String,
    Math:                 Math,
    Error:                Error,
    setTimeout:           setTimeout,
    clearTimeout:         clearTimeout,
    requestAnimationFrame: function(fn) { setTimeout(fn, 0); }
  };
  Object.assign(base, overrides || {});
  return vm.createContext(base);
}

// Load a file into sandbox
function load(ctx, rel) {
  var src = fs.readFileSync(path.join(BASE, rel), 'utf8');
  vm.runInContext(src, ctx);
}

// ── Run all tests (async IIFE) ───────────────────────────────────────────
(async function() {

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 1: Audit & structure
  // ══════════════════════════════════════════════════════════════════════
  section('1. Audit & structure');
  {
    var htmlRaw = fs.readFileSync(path.join(BASE, 'index.html'), 'utf8');

    // contacts.runtime.js present, contacts.plugin.js removed from index.html
    ok(htmlRaw.indexOf('contacts.runtime.js') !== -1,
       'contacts.runtime.js present in index.html');
    ok(htmlRaw.indexOf('contacts.plugin.js') === -1,
       'contacts.plugin.js removed from index.html');

    // file exists on disk
    var rtPath = path.join(BASE, 'js/plugins/contacts.runtime.js');
    ok(fs.existsSync(rtPath), 'contacts.runtime.js exists on disk');

    // loading order: plugin-sdk < contacts.runtime < app.js < taches.js
    var posSDK     = htmlRaw.indexOf('src="js/core/plugin-sdk.js');
    var posRuntime = htmlRaw.indexOf('src="js/plugins/contacts.runtime.js');
    var posApp     = htmlRaw.indexOf('src="js/app.js');
    var posTaches  = htmlRaw.indexOf('src="js/taches.js');
    ok(posSDK !== -1 && posRuntime !== -1 && posSDK < posRuntime,
       'plugin-sdk loaded before contacts.runtime');
    ok(posRuntime !== -1 && posApp !== -1 && posRuntime < posApp,
       'contacts.runtime loaded before app.js');
    ok(posApp !== -1 && posTaches !== -1 && posApp < posTaches,
       'app.js loaded before taches.js');

    // file contains key identifiers
    var rtSrc = fs.readFileSync(rtPath, 'utf8');
    ok(rtSrc.indexOf('_CONTACTS_RT_STATE') !== -1,         'file contains _CONTACTS_RT_STATE');
    ok(rtSrc.indexOf('mp_repertoire_contacts') !== -1,     'file contains storage key mp_repertoire_contacts');
    ok(rtSrc.indexOf('mp_repertoire_imports') !== -1,      'file contains storage key mp_repertoire_imports');
    ok(rtSrc.indexOf('gestion-contacts') !== -1,           'file contains route id gestion-contacts');
    ok(rtSrc.indexOf('contact-fiche') !== -1,              'file contains route id contact-fiche');
  }

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 2: Plugin registration
  // ══════════════════════════════════════════════════════════════════════
  section('2. Plugin registration');
  {
    var sb = makeSandbox();
    load(sb, 'js/core/events.js');
    load(sb, 'js/core/platform.js');
    load(sb, 'js/core/shell.js');
    load(sb, 'js/core/services/search.js');
    load(sb, 'js/core/services/calendar.js');
    load(sb, 'js/core/services/widgets.js');
    load(sb, 'js/core/services/notifications.js');
    load(sb, 'js/core/services/dialogs.js');
    load(sb, 'js/core/services/plugin-services.js');
    load(sb, 'js/core/plugin-sdk.js');
    load(sb, 'js/plugins/contacts.runtime.js');

    ok(sb.Platform.hasPlugin('contacts'), 'Platform.hasPlugin(contacts)');

    var m = sb.Platform.getPlugin('contacts');
    ok(m && m.id === 'contacts',      'manifest id = contacts');
    ok(m && m.label === 'Contacts',   'manifest label = Contacts');
    ok(m && m.version === '1.0.0',    'manifest version = 1.0.0');
    ok(m && m.type === 'shared',      'manifest type = shared');
    ok(m && m.menu && m.menu.section === 'Général', 'menu.section = Général');
    ok(m && m.menu && m.menu.order === 5,           'menu.order = 5');

    ok(Array.isArray(m.routes) && m.routes.length === 2,
       '2 routes defined');
    ok(m.routes[0].id === 'gestion-contacts', 'route[0] id = gestion-contacts');
    ok(m.routes[1].id === 'contact-fiche',    'route[1] id = contact-fiche');

    ok(Array.isArray(m.storageKeys) &&
       m.storageKeys.indexOf('mp_repertoire_contacts') !== -1,
       'storageKeys contains mp_repertoire_contacts');
    ok(Array.isArray(m.storageKeys) &&
       m.storageKeys.indexOf('mp_repertoire_imports') !== -1,
       'storageKeys contains mp_repertoire_imports');

    ok(typeof m.onBoot === 'function',  'onBoot is a function');
    ok(typeof m.onReady === 'function', 'onReady is a function');

    ok(m.search && typeof m.search.handler === 'function',
       'search.handler is a function');
  }

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 3: onBoot storage validation
  // ══════════════════════════════════════════════════════════════════════
  section('3. onBoot storage validation');
  {
    // Helper: load runtime into a minimal sandbox with pre-set localStorage
    function bootSandbox(lsPreset) {
      var sb = makeSandbox();
      // Pre-populate localStorage
      for (var k in lsPreset) {
        if (Object.prototype.hasOwnProperty.call(lsPreset, k)) {
          sb.localStorage.setItem(k, lsPreset[k]);
        }
      }
      load(sb, 'js/core/events.js');
      load(sb, 'js/core/platform.js');
      load(sb, 'js/core/shell.js');
      load(sb, 'js/core/services/search.js');
      load(sb, 'js/core/services/calendar.js');
      load(sb, 'js/core/services/widgets.js');
      load(sb, 'js/core/services/notifications.js');
      load(sb, 'js/core/services/dialogs.js');
      load(sb, 'js/core/services/plugin-services.js');
      load(sb, 'js/core/plugin-sdk.js');
      load(sb, 'js/plugins/contacts.runtime.js');
      // Manually trigger onBoot (Platform.boot() calls it)
      sb.Platform.boot();
      return sb;
    }

    // valid non-empty array → preserved
    var sb1 = bootSandbox({ 'mp_repertoire_contacts': JSON.stringify([{id:'x'}]) });
    var after1 = sb1.localStorage.getItem('mp_repertoire_contacts');
    ok(after1 === JSON.stringify([{id:'x'}]),
       'valid non-empty array preserved after onBoot');

    // null (never set) → stays null (key not created)
    var sb2 = bootSandbox({});
    var after2 = sb2.localStorage.getItem('mp_repertoire_contacts');
    ok(after2 === null,
       'never-set key remains null after onBoot');

    // malformed JSON → reset to []
    var sb3 = bootSandbox({ 'mp_repertoire_contacts': 'NOT_JSON{{' });
    var after3 = sb3.localStorage.getItem('mp_repertoire_contacts');
    ok(after3 === '[]',
       'malformed JSON reset to [] after onBoot');

    // non-array JSON (object) → reset to []
    var sb4 = bootSandbox({ 'mp_repertoire_contacts': '{"key":"val"}' });
    var after4 = sb4.localStorage.getItem('mp_repertoire_contacts');
    ok(after4 === '[]',
       'non-array JSON (object) reset to [] after onBoot');

    // valid empty array [] → preserved
    var sb5 = bootSandbox({ 'mp_repertoire_contacts': '[]' });
    var after5 = sb5.localStorage.getItem('mp_repertoire_contacts');
    ok(after5 === '[]',
       'valid empty array preserved (not touched) after onBoot');

    // imports key: malformed → reset to []
    var sb6 = bootSandbox({ 'mp_repertoire_imports': 'BAD_JSON' });
    var after6 = sb6.localStorage.getItem('mp_repertoire_imports');
    ok(after6 === '[]',
       'malformed imports key reset to [] after onBoot');

    // imports key: null → stays null
    var sb7 = bootSandbox({});
    var after7 = sb7.localStorage.getItem('mp_repertoire_imports');
    ok(after7 === null,
       'never-set imports key remains null after onBoot');
  }

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 4: onReady & idempotency
  // ══════════════════════════════════════════════════════════════════════
  section('4. onReady & idempotency');
  {
    var sb = makeSandbox();
    load(sb, 'js/core/events.js');
    load(sb, 'js/core/platform.js');
    load(sb, 'js/core/shell.js');
    load(sb, 'js/core/services/search.js');
    load(sb, 'js/core/services/calendar.js');
    load(sb, 'js/core/services/widgets.js');
    load(sb, 'js/core/services/notifications.js');
    load(sb, 'js/core/services/dialogs.js');
    load(sb, 'js/core/services/plugin-services.js');
    load(sb, 'js/core/plugin-sdk.js');
    load(sb, 'js/plugins/contacts.runtime.js');

    ok(sb._CONTACTS_RT_STATE.initialized === false,
       'not initialized before Platform.ready()');

    sb.Platform.boot();
    sb.Platform.ready();

    ok(sb._CONTACTS_RT_STATE.initialized === true,
       'initialized after Platform.ready()');
    ok(sb.MythosSearch.hasProvider('contacts'),
       'MythosSearch has contacts provider after ready()');

    // Second call — idempotent, no duplicate provider
    sb.Platform.ready();
    ok(sb._CONTACTS_RT_STATE.initialized === true,
       'still initialized on second Platform.ready()');

    var providers = sb.MythosSearch.getProviders();
    var contactsProviders = providers.filter(function(p) { return p.id === 'contacts'; });
    ok(contactsProviders.length === 1,
       'no duplicate provider on second ready()');

    // window.load fallback
    var sbFallback = makeSandbox();
    var _loadListeners = [];
    sbFallback.window.addEventListener = function(ev, fn) {
      if (ev === 'load') _loadListeners.push(fn);
    };
    load(sbFallback, 'js/core/events.js');
    load(sbFallback, 'js/core/platform.js');
    load(sbFallback, 'js/core/shell.js');
    load(sbFallback, 'js/core/services/search.js');
    load(sbFallback, 'js/core/services/calendar.js');
    load(sbFallback, 'js/core/services/widgets.js');
    load(sbFallback, 'js/core/services/notifications.js');
    load(sbFallback, 'js/core/services/dialogs.js');
    load(sbFallback, 'js/core/services/plugin-services.js');
    load(sbFallback, 'js/core/plugin-sdk.js');
    load(sbFallback, 'js/plugins/contacts.runtime.js');

    ok(sbFallback._CONTACTS_RT_STATE.initialized === false,
       'fallback: not initialized before window.load fires');
    // Simulate window.load event (without Platform.ready())
    _loadListeners.forEach(function(fn) { fn(); });
    ok(sbFallback._CONTACTS_RT_STATE.initialized === true,
       'initialized via window.load fallback');
  }

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 5: Search provider
  // ══════════════════════════════════════════════════════════════════════
  section('5. Search provider');
  {
    var sb = makeSandbox();
    load(sb, 'js/core/events.js');
    load(sb, 'js/core/platform.js');
    load(sb, 'js/core/shell.js');
    load(sb, 'js/core/services/search.js');
    load(sb, 'js/core/services/calendar.js');
    load(sb, 'js/core/services/widgets.js');
    load(sb, 'js/core/services/notifications.js');
    load(sb, 'js/core/services/dialogs.js');
    load(sb, 'js/core/services/plugin-services.js');
    load(sb, 'js/core/plugin-sdk.js');
    load(sb, 'js/plugins/contacts.runtime.js');
    sb.Platform.boot();
    sb.Platform.ready();

    // search by nom
    var r1 = await sb.MythosSearch.search('ben ali');
    ok(r1.length === 1, 'search by nom "ben ali" → 1 result');

    // search by prenom
    var r2 = await sb.MythosSearch.search('fatma');
    ok(r2.length === 1 && r2[0].data.id === 'c2', 'search by prenom "fatma" → c2');

    // search by tel1
    var r3 = await sb.MythosSearch.search('+21620000001');
    ok(r3.length === 1 && r3[0].data.id === 'c1', 'search by tel1 "+21620000001" → c1');

    // search by email (partial)
    var r4 = await sb.MythosSearch.search('medecin.tn');
    ok(r4.length === 1 && r4[0].data.id === 'c2', 'search by email partial "medecin.tn" → c2');

    // search by metier
    var r5 = await sb.MythosSearch.search('avocat');
    ok(r5.length === 1 && r5[0].data.id === 'c1', 'search by metier "avocat" → c1');

    // search by note
    var r6 = await sb.MythosSearch.search('fidele');
    ok(r6.length === 1 && r6[0].data.id === 'c1', 'search by note "fidele" → c1');

    // empty query → []
    var r7 = await sb.MythosSearch.search('');
    ok(r7.length === 0, 'empty query → []');

    // no match → []
    var r8 = await sb.MythosSearch.search('zzznomatch999');
    ok(r8.length === 0, 'no match → []');

    // normalized result schema: id prefixed 'contact-', title, subtitle, data
    var rNorm = await sb.MythosSearch.search('ben ali');
    ok(rNorm.length === 1, 'normalized: got 1 result for ben ali');
    var res = rNorm[0];
    ok(typeof res.id === 'string' && res.id.indexOf('contact-') === 0,
       'id prefixed "contact-"');
    ok(typeof res.title === 'string', 'result has title');
    ok(typeof res.subtitle === 'string', 'result has subtitle');
    ok(res.data && res.data.id === 'c1', 'result has data with original contact');
    ok(res.route === 'gestion-contacts', 'result route = gestion-contacts');
    ok(res.type === 'contact', 'result type = contact');

    // title includes prenom+nom
    ok(res.title.indexOf('Mohamed') !== -1 && res.title.indexOf('Ben Ali') !== -1,
       'title includes prenom+nom');

    // c4 (no name) title fallback to phone or 'Contact'
    var r9 = await sb.MythosSearch.search('+21699999999');
    ok(r9.length === 1, 'c4 found by tel1');
    var c4title = r9[0].title;
    ok(c4title === '+21699999999' || c4title === 'Contact',
       'c4 title fallback to phone or "Contact" (got: ' + c4title + ')');

    // malformed contacts (null, undefined in array) silently skipped
    var sbBad = makeSandbox({
      STORE: {
        _contacts: [null, undefined, {id:'x', nom:'Test', prenom:'', tel1:'0600', tel2:'', email:'', metier:'', domaine:'', note:'', tags:[], importBatchId:null}],
        repertoireContacts: function() { return this._contacts; }
      }
    });
    load(sbBad, 'js/core/events.js');
    load(sbBad, 'js/core/platform.js');
    load(sbBad, 'js/core/shell.js');
    load(sbBad, 'js/core/services/search.js');
    load(sbBad, 'js/core/services/calendar.js');
    load(sbBad, 'js/core/services/widgets.js');
    load(sbBad, 'js/core/services/notifications.js');
    load(sbBad, 'js/core/services/dialogs.js');
    load(sbBad, 'js/core/services/plugin-services.js');
    load(sbBad, 'js/core/plugin-sdk.js');
    load(sbBad, 'js/plugins/contacts.runtime.js');
    sbBad.Platform.boot();
    sbBad.Platform.ready();
    var threw = false;
    var rBad;
    try { rBad = await sbBad.MythosSearch.search('test'); } catch(e) { threw = true; }
    ok(!threw, 'malformed contacts (null, undefined) silently skipped — no throw');
    ok(rBad && rBad.length === 1, 'only valid contact returned when array has nulls');

    // only 1 contacts provider in MythosSearch
    var allProviders = sb.MythosSearch.getProviders();
    var cProviders = allProviders.filter(function(p) { return p.id === 'contacts'; });
    ok(cProviders.length === 1, 'only 1 contacts provider in MythosSearch');
  }

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 6: Navigation
  // ══════════════════════════════════════════════════════════════════════
  section('6. Navigation');
  {
    var sb = makeSandbox();
    load(sb, 'js/core/events.js');
    load(sb, 'js/core/platform.js');
    load(sb, 'js/core/shell.js');
    load(sb, 'js/core/services/search.js');
    load(sb, 'js/core/services/calendar.js');
    load(sb, 'js/core/services/widgets.js');
    load(sb, 'js/core/services/notifications.js');
    load(sb, 'js/core/services/dialogs.js');
    load(sb, 'js/core/services/plugin-services.js');
    load(sb, 'js/core/plugin-sdk.js');
    load(sb, 'js/plugins/contacts.runtime.js');

    ok(typeof sb.showView === 'function',
       'showView still available as global');

    var threw1 = false;
    try { sb.showView('gestion-contacts'); } catch(e) { threw1 = true; }
    ok(!threw1, 'showView("gestion-contacts") callable without crash');

    var threw2 = false;
    try { sb.showView('contact-fiche'); } catch(e) { threw2 = true; }
    ok(!threw2, 'showView("contact-fiche") callable without crash');

    ok(sb.Shell && typeof sb.Shell.navigation === 'object',
       'Shell.navigation accessible');

    var m = sb.Platform.getPlugin('contacts');
    ok(Array.isArray(m.routes) && m.routes[0].id === 'gestion-contacts',
       'manifest routes[0] unchanged (gestion-contacts)');
    ok(Array.isArray(m.routes) && m.routes[1].id === 'contact-fiche',
       'manifest routes[1] unchanged (contact-fiche)');
  }

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 7: Backward compatibility
  // ══════════════════════════════════════════════════════════════════════
  section('7. Backward compatibility');
  {
    // Platform.boot()/ready() safe without contacts.runtime
    {
      var sb = makeSandbox();
      load(sb, 'js/core/events.js');
      load(sb, 'js/core/platform.js');
      load(sb, 'js/core/shell.js');
      load(sb, 'js/core/plugin-sdk.js');
      var threw = false;
      try { sb.Platform.boot(); sb.Platform.ready(); } catch(e) { threw = true; }
      ok(!threw, 'Platform.boot()/ready() safe without contacts.runtime');
    }

    // no crash when MythosSearch absent
    {
      var sb = makeSandbox({ MythosSearch: undefined });
      load(sb, 'js/core/events.js');
      load(sb, 'js/core/platform.js');
      load(sb, 'js/core/shell.js');
      load(sb, 'js/core/plugin-sdk.js');
      var threw = false;
      try {
        load(sb, 'js/plugins/contacts.runtime.js');
        sb.Platform.boot();
        sb.Platform.ready();
      } catch(e) { threw = true; }
      ok(!threw, 'no crash when MythosSearch absent');

      // still initializes without MythosSearch
      ok(sb._CONTACTS_RT_STATE.initialized === true,
         'still initializes without MythosSearch');
    }

    // contacts.runtime loads without Shell
    {
      var sbNoShell = makeSandbox();
      load(sbNoShell, 'js/core/events.js');
      load(sbNoShell, 'js/core/platform.js');
      // NO shell.js
      load(sbNoShell, 'js/core/services/search.js');
      load(sbNoShell, 'js/core/plugin-sdk.js');
      var threw = false;
      try { load(sbNoShell, 'js/plugins/contacts.runtime.js'); } catch(e) { threw = true; }
      ok(!threw, 'contacts.runtime loads without Shell');
    }

    // contacts.runtime loads without Platform
    {
      var sbNoPlatform = makeSandbox();
      load(sbNoPlatform, 'js/core/events.js');
      // NO platform.js
      load(sbNoPlatform, 'js/core/services/search.js');
      // Need a minimal Plugin stub
      sbNoPlatform.Plugin = {
        create: function(manifest) {
          var builder = {
            _m: manifest,
            defineMenu: function() { return this; },
            defineRoutes: function() { return this; },
            defineStorage: function() { return this; },
            defineSearch: function() { return this; },
            build: function() { return this; }
          };
          return builder;
        }
      };
      var threw = false;
      try { load(sbNoPlatform, 'js/plugins/contacts.runtime.js'); } catch(e) { threw = true; }
      ok(!threw, 'contacts.runtime loads without Platform (Plugin stub only)');
    }

    // onBoot recovers from malformed localStorage without crashing
    {
      var sbMalformed = makeSandbox();
      sbMalformed.localStorage.setItem('mp_repertoire_contacts', 'BADJSON{{{');
      sbMalformed.localStorage.setItem('mp_repertoire_imports', 'null');
      load(sbMalformed, 'js/core/events.js');
      load(sbMalformed, 'js/core/platform.js');
      load(sbMalformed, 'js/core/shell.js');
      load(sbMalformed, 'js/core/services/search.js');
      load(sbMalformed, 'js/core/plugin-sdk.js');
      var threw = false;
      try { load(sbMalformed, 'js/plugins/contacts.runtime.js'); sbMalformed.Platform.boot(); } catch(e) { threw = true; }
      ok(!threw, 'onBoot recovers from malformed localStorage without crashing');

      var contactsAfter = sbMalformed.localStorage.getItem('mp_repertoire_contacts');
      ok(contactsAfter === '[]', 'contacts reset to [] after malformed JSON in onBoot');

      // null JSON is valid JSON but null is not an array → reset to []
      var importsAfter = sbMalformed.localStorage.getItem('mp_repertoire_imports');
      ok(importsAfter === '[]', 'imports reset to [] after "null" (non-array) in onBoot');
    }

    // search on empty contacts returns []
    {
      var sbEmpty = makeSandbox({
        STORE: {
          _contacts: [],
          repertoireContacts: function() { return this._contacts; }
        }
      });
      load(sbEmpty, 'js/core/events.js');
      load(sbEmpty, 'js/core/platform.js');
      load(sbEmpty, 'js/core/shell.js');
      load(sbEmpty, 'js/core/services/search.js');
      load(sbEmpty, 'js/core/services/calendar.js');
      load(sbEmpty, 'js/core/services/widgets.js');
      load(sbEmpty, 'js/core/services/notifications.js');
      load(sbEmpty, 'js/core/services/dialogs.js');
      load(sbEmpty, 'js/core/services/plugin-services.js');
      load(sbEmpty, 'js/core/plugin-sdk.js');
      load(sbEmpty, 'js/plugins/contacts.runtime.js');
      sbEmpty.Platform.boot();
      sbEmpty.Platform.ready();
      var rEmpty = await sbEmpty.MythosSearch.search('test');
      ok(rEmpty.length === 0, 'search on empty contacts returns []');
    }

    // existing valid data not overwritten by onBoot
    {
      var sbValid = makeSandbox();
      var validData = JSON.stringify([{id:'existing', nom:'Existing'}]);
      sbValid.localStorage.setItem('mp_repertoire_contacts', validData);
      load(sbValid, 'js/core/events.js');
      load(sbValid, 'js/core/platform.js');
      load(sbValid, 'js/core/shell.js');
      load(sbValid, 'js/core/services/search.js');
      load(sbValid, 'js/core/plugin-sdk.js');
      load(sbValid, 'js/plugins/contacts.runtime.js');
      sbValid.Platform.boot();
      ok(sbValid.localStorage.getItem('mp_repertoire_contacts') === validData,
         'existing valid data not overwritten by onBoot');
    }

    // tasks plugin unaffected when contacts disabled
    {
      var sbTasks = makeSandbox();
      load(sbTasks, 'js/core/events.js');
      load(sbTasks, 'js/core/platform.js');
      load(sbTasks, 'js/core/shell.js');
      load(sbTasks, 'js/core/services/search.js');
      load(sbTasks, 'js/core/services/calendar.js');
      load(sbTasks, 'js/core/services/widgets.js');
      load(sbTasks, 'js/core/services/notifications.js');
      load(sbTasks, 'js/core/services/dialogs.js');
      load(sbTasks, 'js/core/services/plugin-services.js');
      load(sbTasks, 'js/core/plugin-sdk.js');
      load(sbTasks, 'js/plugins/tasks.runtime.js');
      // intentionally NOT loading contacts.runtime.js
      var threw = false;
      try { sbTasks.Platform.boot(); sbTasks.Platform.ready(); } catch(e) { threw = true; }
      ok(!threw, 'tasks plugin unaffected when contacts disabled');
      ok(sbTasks.Platform.hasPlugin('tasks'), 'tasks still registered without contacts');
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 8: Regression
  // ══════════════════════════════════════════════════════════════════════
  section('8. Regression — prior test suites');
  {
    var suites = [
      'tests/stage3a5-test.js',
      'tests/stage3a-test.js',
      'tests/stage2d-test.js',
      'tests/stage1c-part1-test.js'
    ];

    for (var i = 0; i < suites.length; i++) {
      var suitePath = path.join(BASE, suites[i]);
      if (!fs.existsSync(suitePath)) {
        _results.push('  SKIP (not found): ' + suites[i]);
        continue;
      }
      try {
        var result = cp.execSync('node ' + suitePath, { timeout: 30000 });
        var out    = result.toString();
        var match  = out.match(/(\d+)\/(\d+) tests passed/);
        if (match && match[1] === match[2]) {
          _pass++;
          _results.push('  PASS regression: ' + suites[i] + ' (' + match[1] + '/' + match[2] + ')');
        } else {
          _fail++;
          _results.push('  FAIL regression: ' + suites[i] + ' — ' + (match ? match[0] : 'unknown result'));
        }
      } catch(e) {
        _fail++;
        _results.push('  FAIL regression: ' + suites[i] + ' — error: ' + e.message.slice(0, 120));
      }
    }
  }

  // ── Print results ─────────────────────────────────────────────────────
  _results.forEach(function(r) { console.log(r); });
  var total = _pass + _fail;
  console.log(
    '\n' + (_fail === 0 ? '✓' : '✗') + ' ' + _pass + '/' + total + ' tests passed'
  );
  if (_fail > 0) process.exit(1);

})().catch(function(err) {
  console.error('Unhandled error in test suite:', err);
  process.exit(1);
});
