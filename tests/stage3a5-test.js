// =====================================================
// MYTHOS OS — Stage 3A.5 automated tests
// tests/stage3a5-test.js
//
// Covers: MythosSearch, MythosCalendar, MythosWidgets,
// MythosNotifications, MythosDialogs, PluginServices
// integration, Tasks runtime update, regression.
//
// Run with: node tests/stage3a5-test.js
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

// ── Sandbox factory ──────────────────────────────────────────────────────
function makeSandbox(overrides) {
  var _bodyChildren = [];
  var _alertCalls   = [];
  var _confirmRet   = true;
  var _promptRet    = 'test-value';
  var _eventsBus    = {};

  var base = {
    document: {
      readyState: 'complete',
      createElement: function (tag) {
        var el = {
          _tag: tag, className: '', innerHTML: '', textContent: '',
          style: { cssText: '' }, _attrs: {}, onclick: null,
          setAttribute: function (k, v) { this._attrs[k] = v; },
          querySelector: function () { return null; }
        };
        return el;
      },
      getElementById:  function () { return null; },
      querySelector:   function () { return null; },
      querySelectorAll:function () { return []; },
      body: {
        _children: _bodyChildren,
        appendChild: function (el) { _bodyChildren.push(el); }
      }
    },
    window: {
      addEventListener: function () {},
      alert:   function (m) { _alertCalls.push({ type: 'alert',   msg: m }); },
      confirm: function ()  { return _confirmRet; },
      prompt:  function (m, d) { return _promptRet; }
    },
    location: { hash: '' },
    localStorage: (function () {
      var _s = {};
      return {
        getItem:    function (k) { return Object.prototype.hasOwnProperty.call(_s, k) ? _s[k] : null; },
        setItem:    function (k, v) { _s[k] = String(v); },
        removeItem: function (k) { delete _s[k]; }
      };
    })(),
    fetch: function () {
      return Promise.resolve({ ok: true, json: function () { return Promise.resolve({}); } });
    },
    // Task stubs
    getTaches: function () {
      return [
        { id: 't1', note: 'acheter du lait', dueDate: '2026-08-01', archived: false },
        { id: 't2', note: 'reunion client',  dueDate: '2026-08-10', archived: false },
        { id: 't3', note: 'archive task',    dueDate: '2026-07-01', archived: true  }
      ];
    },
    tachesOpenModal:          function () {},
    renderTachePage:          function () {},
    renderTachesDashboard:    function () {},
    renderTachesInCalendrier: function () {},
    renderCalendrier:         function () {},
    updateDashboardStats:     function () {},
    showView:                 function () {},
    // Helpers exposed to tests
    _alertCalls: _alertCalls,
    _setConfirm: function (v) { _confirmRet = v; },
    _setPrompt:  function (v) { _promptRet  = v; },
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
    requestAnimationFrame:function (fn) { setTimeout(fn, 0); }
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
(async function () {

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 1: MythosSearch — registration & validation
  // ══════════════════════════════════════════════════════════════════════
  section('1. MythosSearch — registration');
  {
    var sb = makeSandbox();
    load(sb, 'js/core/services/search.js');

    ok(typeof sb.MythosSearch === 'object',          'MythosSearch is defined');
    ok(typeof sb.MythosSearch.registerProvider === 'function', 'registerProvider is a function');
    ok(typeof sb.MythosSearch.search === 'function', 'search is a function');

    var r1 = sb.MythosSearch.registerProvider({
      id: 'test-prov', label: 'Test', order: 10,
      search: function (q) { return []; }
    });
    ok(r1 === true, 'registerProvider returns true on success');
    ok(sb.MythosSearch.hasProvider('test-prov'), 'hasProvider returns true after registration');

    // duplicate
    var r2 = sb.MythosSearch.registerProvider({
      id: 'test-prov', search: function (q) { return []; }
    });
    ok(r2 === false, 'duplicate registration returns false');
    ok(sb.MythosSearch.getProviders().length === 1, 'only 1 provider after duplicate attempt');

    // unregister
    var r3 = sb.MythosSearch.unregisterProvider('test-prov');
    ok(r3 === true, 'unregisterProvider returns true');
    ok(!sb.MythosSearch.hasProvider('test-prov'), 'hasProvider false after unregister');
    ok(sb.MythosSearch.getProviders().length === 0, 'getProviders empty after unregister');

    // invalid
    ok(sb.MythosSearch.registerProvider(null)   === false, 'registerProvider(null) returns false');
    ok(sb.MythosSearch.registerProvider({ id: 'x' }) === false, 'missing search fn returns false');
    ok(sb.MythosSearch.registerProvider({ search: function(){} }) === false, 'missing id returns false');

    // disabled provider
    sb.MythosSearch.registerProvider({
      id: 'disabled-prov', disabled: true,
      search: function () { return [{ title: 'should not appear' }]; }
    });
    var disabledProviders = sb.MythosSearch.getProviders();
    ok(disabledProviders[0].disabled === true, 'disabled flag preserved in getProviders');

    var disabledResults = await sb.MythosSearch.search('any');
    ok(disabledResults.length === 0, 'disabled provider returns no results');
  }

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 2: MythosSearch — sync and async providers, normalization, ordering
  // ══════════════════════════════════════════════════════════════════════
  section('2. MythosSearch — search results & normalization');
  {
    var sb = makeSandbox();
    load(sb, 'js/core/services/search.js');

    // Sync provider
    sb.MythosSearch.registerProvider({
      id: 'sync-a', order: 2,
      search: function (q) {
        return [{ title: 'Alpha ' + q, route: 'a', score: 5 }];
      }
    });

    // Sync provider (higher order — should come second)
    sb.MythosSearch.registerProvider({
      id: 'sync-b', order: 1,
      search: function (q) {
        return [{ title: 'Beta ' + q, route: 'b' }];
      }
    });

    // Async provider
    sb.MythosSearch.registerProvider({
      id: 'async-c', order: 3,
      search: function (q) {
        return Promise.resolve([{ title: 'Gamma ' + q, subtitle: 'sub' }]);
      }
    });

    // Error-throwing provider
    sb.MythosSearch.registerProvider({
      id: 'error-d', order: 4,
      search: function () { throw new Error('boom'); }
    });

    var results = await sb.MythosSearch.search('test');
    // sync-b (order 1) should be first, then sync-a (order 2), then async-c (3)
    // error-d returns nothing (error isolated)
    ok(results.length === 3, 'error-isolated: 3 results despite 1 throwing provider');

    // Ordering: results in order of provider order (beta first)
    ok(results[0].title === 'Beta test', 'sync-b (order 1) comes first');
    ok(results[1].title === 'Alpha test', 'sync-a (order 2) comes second');
    ok(results[2].title === 'Gamma test', 'async-c (order 3) comes third');

    // Normalized schema
    var r = results[0];
    ok(typeof r.id === 'string',         'normalized result has id');
    ok(r.providerId === 'sync-b',        'normalized result has providerId');
    ok(r.type === 'result',              'default type is "result"');
    ok(r.title === 'Beta test',          'title preserved');
    ok(r.subtitle === '',                'subtitle defaults to empty string');
    ok(r.route === 'b',                  'route preserved');
    ok(r.score === 0,                    'score defaults to 0');

    // score preserved
    ok(results[1].score === 5, 'explicit score preserved');

    // subtitle preserved
    ok(results[2].subtitle === 'sub', 'subtitle preserved from async result');

    // label→title fallback
    sb.MythosSearch.registerProvider({
      id: 'label-test', order: 99,
      search: function () { return [{ label: 'from-label' }]; }
    });
    var r2 = await sb.MythosSearch.search('x');
    var labelResult = r2.find(function (x) { return x.providerId === 'label-test'; });
    ok(labelResult && labelResult.title === 'from-label', 'label falls back to title');
  }

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 3: MythosCalendar — registration & getEvents
  // ══════════════════════════════════════════════════════════════════════
  section('3. MythosCalendar — registration & getEvents');
  {
    var sb = makeSandbox();
    load(sb, 'js/core/services/calendar.js');

    ok(typeof sb.MythosCalendar === 'object',             'MythosCalendar is defined');
    ok(typeof sb.MythosCalendar.registerProvider === 'function', 'registerProvider function');
    ok(typeof sb.MythosCalendar.getEvents === 'function', 'getEvents function');

    // Invalid range
    var errCaught = false;
    try { await sb.MythosCalendar.getEvents(null); } catch (e) { errCaught = true; }
    ok(errCaught, 'getEvents(null) rejects');

    var errCaught2 = false;
    try { await sb.MythosCalendar.getEvents({}); } catch (e) { errCaught2 = true; }
    ok(errCaught2, 'getEvents({}) rejects — no start or end');

    // Register sync provider
    sb.MythosCalendar.registerProvider({
      id: 'cal-sync', order: 1,
      getEvents: function (range) {
        return [
          { id: 'e1', title: 'Early',  date: '2026-08-05', type: 'meeting' },
          { id: 'e2', title: 'Later',  date: '2026-08-15' },
          { id: 'e3', title: 'OutRange', date: '2026-09-01' }
        ];
      }
    });

    // Register async provider
    sb.MythosCalendar.registerProvider({
      id: 'cal-async', order: 2,
      getEvents: function (range) {
        return Promise.resolve([
          { id: 'e4', title: 'Async Event', start: '2026-08-08' }
        ]);
      }
    });

    // Error provider
    sb.MythosCalendar.registerProvider({
      id: 'cal-err', order: 3,
      getEvents: function () { throw new Error('calendar boom'); }
    });

    var events = await sb.MythosCalendar.getEvents({ start: '2026-08-01', end: '2026-09-30' });

    ok(events.length === 4, 'error isolated: 4 events from 3 providers (1 throws)');

    // Chronological sort: e1 (08-05) < e4 (08-08) < e2 (08-15) < e3 (09-01)
    ok(events[0].id === 'e1', 'chronological sort: e1 first (2026-08-05)');
    ok(events[1].id === 'e4', 'chronological sort: e4 second (2026-08-08)');
    ok(events[2].id === 'e2', 'chronological sort: e2 third (2026-08-15)');
    ok(events[3].id === 'e3', 'chronological sort: e3 last (2026-09-01)');

    // Normalized schema
    var ev = events[0];
    ok(typeof ev.id === 'string',      'event has id');
    ok(ev.providerId === 'cal-sync',   'event has providerId');
    ok(ev.title === 'Early',           'title preserved');
    ok(ev.start === '2026-08-05',      'date mapped to start');
    ok(ev.allDay === true,             'allDay defaults to true');
    ok(ev.end === null,                'end defaults to null');

    // duplicate
    ok(sb.MythosCalendar.registerProvider({ id: 'cal-sync', getEvents: function(){return [];} }) === false,
       'duplicate calendar provider returns false');

    // unregister
    ok(sb.MythosCalendar.unregisterProvider('cal-async') === true, 'unregister returns true');
    ok(!sb.MythosCalendar.hasProvider('cal-async'), 'hasProvider false after unregister');
  }

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 4: MythosWidgets
  // ══════════════════════════════════════════════════════════════════════
  section('4. MythosWidgets — registration & render');
  {
    var sb = makeSandbox();
    // Simulate Shell with widgets registry
    var _shellWidgets = {};
    var _shellOrder   = [];
    sb.Shell = {
      widgets: {
        register:  function (c) { _shellWidgets[c.id] = c; _shellOrder.push(c.id); return true; },
        hasWidget: function (id) { return !!_shellWidgets[id]; },
        getAll:    function () { return _shellOrder.map(function(id){ return _shellWidgets[id]; }); }
      }
    };
    load(sb, 'js/core/services/widgets.js');

    ok(typeof sb.MythosWidgets === 'object',          'MythosWidgets is defined');
    ok(typeof sb.MythosWidgets.register === 'function','register function');
    ok(typeof sb.MythosWidgets.getAll === 'function', 'getAll function');
    ok(typeof sb.MythosWidgets.render === 'function', 'render function');

    var w1 = { id: 'w-tasks', label: 'Tasks', zone: 'dash-main', order: 1, render: function (ctx) { return 'tasks-html'; } };
    var w2 = { id: 'w-kpi',   label: 'KPI',   zone: 'dash-kpi',  order: 2 };
    var w3 = { id: 'w-chart', label: 'Chart', zone: 'dash-main', order: 3 };

    ok(sb.MythosWidgets.register(w1) === true, 'register w1 success');
    ok(sb.MythosWidgets.register(w2) === true, 'register w2 success');
    ok(sb.MythosWidgets.register(w3) === true, 'register w3 success');

    // Shell compatibility mirror
    ok(!!_shellWidgets['w-tasks'], 'w-tasks forwarded to Shell.widgets');
    ok(!!_shellWidgets['w-kpi'],   'w-kpi forwarded to Shell.widgets');

    // Duplicate protection
    ok(sb.MythosWidgets.register({ id: 'w-tasks', render: function(){} }) === false,
       'duplicate widget returns false');

    // has()
    ok(sb.MythosWidgets.has('w-tasks')   === true,  'has() true');
    ok(sb.MythosWidgets.has('w-missing') === false, 'has() false for missing');

    // getAll — no zone filter
    var all = sb.MythosWidgets.getAll();
    ok(all.length === 3, 'getAll returns all 3 widgets');
    ok(all[0].id === 'w-tasks', 'sorted by order: w-tasks first');

    // getAll — zone filter
    var dashMain = sb.MythosWidgets.getAll('dash-main');
    ok(dashMain.length === 2, 'zone filter: 2 widgets in dash-main');
    ok(dashMain.every(function(w){ return w.zone === 'dash-main'; }), 'all filtered have correct zone');

    // getAll returns metadata copies (no render fn)
    ok(typeof all[0].render === 'undefined', 'getAll does not expose render fn');

    // render()
    var html = sb.MythosWidgets.render('w-tasks');
    ok(html === 'tasks-html', 'render returns widget output');

    // render null for missing render fn
    ok(sb.MythosWidgets.render('w-kpi') === null, 'render null for widget without render fn');

    // render error isolation
    sb.MythosWidgets.register({ id: 'w-broken', render: function () { throw new Error('render boom'); } });
    ok(sb.MythosWidgets.render('w-broken') === null, 'render error isolated — returns null');

    // unregister
    ok(sb.MythosWidgets.unregister('w-kpi') === true, 'unregister returns true');
    ok(!sb.MythosWidgets.has('w-kpi'), 'has() false after unregister');
    ok(sb.MythosWidgets.getAll().length === 3, '3 widgets remain after unregister');
  }

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 5: MythosNotifications
  // ══════════════════════════════════════════════════════════════════════
  section('5. MythosNotifications — notify & history');
  {
    var sb = makeSandbox();
    load(sb, 'js/core/events.js');
    load(sb, 'js/core/services/notifications.js');

    ok(typeof sb.MythosNotifications === 'object', 'MythosNotifications is defined');

    // All 4 convenience types
    var n1 = sb.MythosNotifications.info('hello info');
    ok(n1 && n1.type === 'info',    'info() returns entry with type=info');
    ok(n1.message === 'hello info', 'info() message preserved');
    ok(typeof n1.id === 'string',   'notification has id');
    ok(typeof n1.timestamp === 'string', 'notification has timestamp');

    var n2 = sb.MythosNotifications.success('done');
    ok(n2 && n2.type === 'success', 'success() type');

    var n3 = sb.MythosNotifications.warning('careful');
    ok(n3 && n3.type === 'warning', 'warning() type');

    var n4 = sb.MythosNotifications.error('oops');
    ok(n4 && n4.type === 'error',   'error() type');

    // notify() with full config
    var n5 = sb.MythosNotifications.notify({
      type: 'info', message: 'direct', title: 'Title', source: 'test', duration: 1000
    });
    ok(n5 && n5.title === 'Title',     'title preserved in notify()');
    ok(n5.source === 'test',           'source preserved');
    ok(n5.duration === 1000,           'duration preserved');

    // History
    var hist = sb.MythosNotifications.getHistory();
    ok(hist.length === 5, 'history has 5 entries');
    ok(hist[0].message === 'direct', 'history newest-first: last notify is first');

    // History is a copy (mutation-safe)
    hist.push({ fake: true });
    ok(sb.MythosNotifications.getHistory().length === 5, 'getHistory returns safe copy');

    // clearHistory
    sb.MythosNotifications.clearHistory();
    ok(sb.MythosNotifications.getHistory().length === 0, 'clearHistory empties history');

    // Event emission
    var emitted = null;
    sb.Events.on('mythos:notification', function (e) { emitted = e; });
    sb.MythosNotifications.info('event test');
    ok(emitted !== null,                        'mythos:notification event emitted');
    ok(emitted.message === 'event test',        'event carries notification entry');

    // History limit (100)
    for (var i = 0; i < 105; i++) {
      sb.MythosNotifications.notify({ message: 'bulk-' + i });
    }
    ok(sb.MythosNotifications.getHistory().length === 100, 'history capped at 100');

    // null config safe
    ok(sb.MythosNotifications.notify(null) === null, 'notify(null) returns null safely');
  }

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 6: MythosDialogs
  // ══════════════════════════════════════════════════════════════════════
  section('6. MythosDialogs — Promise-based wrappers');
  {
    var sb = makeSandbox();
    load(sb, 'js/core/services/dialogs.js');

    ok(typeof sb.MythosDialogs === 'object',          'MythosDialogs is defined');
    ok(typeof sb.MythosDialogs.alert   === 'function','alert is a function');
    ok(typeof sb.MythosDialogs.confirm === 'function','confirm is a function');
    ok(typeof sb.MythosDialogs.prompt  === 'function','prompt is a function');

    // alert returns Promise<undefined>
    var alertResult = await sb.MythosDialogs.alert('hello');
    ok(alertResult === undefined, 'alert resolves with undefined');
    ok(sb._alertCalls.length === 1 && sb._alertCalls[0].msg === 'hello', 'alert calls window.alert');

    // confirm true
    sb._setConfirm(true);
    var confirmTrue = await sb.MythosDialogs.confirm('are you sure?');
    ok(confirmTrue === true, 'confirm resolves true when window.confirm returns true');

    // confirm false
    sb._setConfirm(false);
    var confirmFalse = await sb.MythosDialogs.confirm('are you sure?');
    ok(confirmFalse === false, 'confirm resolves false when window.confirm returns false');

    // prompt
    sb._setPrompt('user-input');
    var promptResult = await sb.MythosDialogs.prompt('enter value', 'default');
    ok(promptResult === 'user-input', 'prompt resolves with window.prompt return value');

    // No window — safe fallback
    var sbNoWindow = makeSandbox();
    delete sbNoWindow.window;
    load(sbNoWindow, 'js/core/services/dialogs.js');
    var r = await sbNoWindow.MythosDialogs.confirm('test');
    ok(r === false, 'confirm returns false when window is absent');
    var p = await sbNoWindow.MythosDialogs.prompt('test');
    ok(p === null, 'prompt returns null when window is absent');
  }

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 7: PluginServices integration
  // ══════════════════════════════════════════════════════════════════════
  section('7. PluginServices — automatic manifest bridge');
  {
    var sb = makeSandbox();
    load(sb, 'js/core/events.js');
    load(sb, 'js/core/platform.js');
    load(sb, 'js/core/shell.js');
    load(sb, 'js/core/services/search.js');
    load(sb, 'js/core/services/calendar.js');
    load(sb, 'js/core/services/widgets.js');
    load(sb, 'js/core/services/plugin-services.js');
    load(sb, 'js/core/plugin-sdk.js');

    // Register a plugin with search, calendar, and widgets via SDK
    vm.runInContext(`
      Plugin.create({
        id: 'test-plugin', label: 'Test Plugin',
        version: '1.0.0', type: 'business'
      })
      .defineMenu({ section: 'Test', order: 5 })
      .defineSearch({
        handler: function(query) {
          return [{ title: 'Result for ' + query, route: 'test-view' }];
        }
      })
      .defineCalendar({
        provider: function(range) {
          return [{ id: 'ev1', title: 'Test Event', date: '2026-08-20' }];
        }
      })
      .defineWidgets([
        { id: 'test-widget', label: 'Test Widget', zone: 'dashboard', order: 10,
          render: function() { return '<div>widget</div>'; } }
      ])
      .build();
    `, sb);

    // Search auto-wired
    ok(sb.MythosSearch.hasProvider('test-plugin'), 'plugin search wired to MythosSearch');
    var searchRes = await sb.MythosSearch.search('hello');
    ok(searchRes.length === 1,                        'search returns 1 result');
    ok(searchRes[0].title === 'Result for hello',     'search result correct');
    ok(searchRes[0].providerId === 'test-plugin',     'providerId correct');

    // Calendar auto-wired
    ok(sb.MythosCalendar.hasProvider('test-plugin'), 'plugin calendar wired to MythosCalendar');
    var calRes = await sb.MythosCalendar.getEvents({ start: '2026-01-01', end: '2026-12-31' });
    ok(calRes.length === 1,                'calendar returns 1 event');
    ok(calRes[0].title === 'Test Event',   'calendar event title correct');
    ok(calRes[0].start === '2026-08-20',   'date mapped to start');

    // Widgets auto-wired
    ok(sb.MythosWidgets.has('test-widget'),              'widget wired to MythosWidgets');
    ok(sb.Shell.widgets.hasWidget('test-widget'),        'widget also in Shell.widgets');

    // No duplicate registration on second build
    vm.runInContext(`
      Plugin.create({
        id: 'test-plugin2', label: 'Test 2',
        version: '1.0.0', type: 'business'
      })
      .defineSearch({ handler: function(q){ return []; } })
      .build();
    `, sb);
    ok(sb.MythosSearch.hasProvider('test-plugin2'), 'second plugin also wired');
    ok(sb.MythosSearch.getProviders().length === 2,  '2 search providers total');

    // Plugin without services remains unaffected
    vm.runInContext(`
      Plugin.create({
        id: 'plain-plugin', label: 'Plain',
        version: '1.0.0', type: 'core'
      }).build();
    `, sb);
    ok(sb.Platform.hasPlugin('plain-plugin'), 'plain plugin registered in Platform');
    ok(!sb.MythosSearch.hasProvider('plain-plugin'), 'no search provider for plain plugin');

    // Services absent — no crash
    var sbNoServices = makeSandbox();
    load(sbNoServices, 'js/core/events.js');
    load(sbNoServices, 'js/core/platform.js');
    load(sbNoServices, 'js/core/shell.js');
    load(sbNoServices, 'js/core/services/plugin-services.js');
    load(sbNoServices, 'js/core/plugin-sdk.js');
    var threw = false;
    try {
      vm.runInContext(`
        Plugin.create({ id: 'safe-test', label: 'Safe', version: '1.0.0', type: 'shared' })
          .defineSearch({ handler: function(q){ return []; } })
          .build();
      `, sbNoServices);
    } catch (e) { threw = true; }
    ok(!threw, 'no crash when MythosSearch is absent during plugin registration');
  }

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 8: Tasks runtime — services integration
  // ══════════════════════════════════════════════════════════════════════
  section('8. Tasks runtime — services integration');
  {
    var sb = makeSandbox();
    load(sb, 'js/core/events.js');
    load(sb, 'js/core/platform.js');
    load(sb, 'js/core/shell.js');
    load(sb, 'js/core/services/search.js');
    load(sb, 'js/core/services/calendar.js');
    load(sb, 'js/core/services/widgets.js');
    load(sb, 'js/core/services/plugin-services.js');
    load(sb, 'js/core/plugin-sdk.js');
    load(sb, 'js/plugins/tasks.runtime.js');

    // plugin-services auto-wires tasks on registration
    ok(sb.MythosSearch.hasProvider('tasks'),   'tasks search provider wired via plugin-services');
    ok(sb.MythosCalendar.hasProvider('tasks'), 'tasks calendar provider wired via plugin-services');

    // Search behavior unchanged
    var searchRes = await sb.MythosSearch.search('lait');
    ok(searchRes.length === 1, 'task search: 1 result for "lait"');
    ok(searchRes[0].title === 'acheter du lait' || searchRes[0].title.indexOf('lait') !== -1,
       'task search: result contains searched note');
    ok(searchRes[0].route === 'tache', 'task search result route is "tache"');

    // Search excludes archived
    var searchAll = await sb.MythosSearch.search('archive');
    ok(searchAll.length === 0, 'archived tasks excluded from search');

    // Calendar behavior unchanged
    var calRes = await sb.MythosCalendar.getEvents({ start: '2026-08-01', end: '2026-08-31' });
    ok(calRes.length === 2, 'calendar: 2 non-archived tasks in August range');
    ok(calRes.every(function(e){ return !e.data || !e.data.archived; }), 'archived excluded from calendar');
    ok(calRes[0].allDay === true, 'calendar event allDay=true');

    // Initialization still executes once
    ok(sb._TASKS_RT_STATE.initialized === false, 'not initialized before Platform.ready()');
    sb.Platform.boot();
    sb.Platform.ready();
    ok(sb._TASKS_RT_STATE.initialized === true, 'initialized after Platform.ready()');

    // Call ready again — idempotent
    sb.Platform.ready();
    ok(sb._TASKS_RT_STATE.initialized === true, 'still initialized on second Platform.ready()');

    // Without services — tasks still works
    var sbNoSvc = makeSandbox();
    load(sbNoSvc, 'js/core/events.js');
    load(sbNoSvc, 'js/core/platform.js');
    load(sbNoSvc, 'js/core/shell.js');
    load(sbNoSvc, 'js/core/plugin-sdk.js');
    load(sbNoSvc, 'js/plugins/tasks.runtime.js');
    var threwNoSvc = false;
    try {
      sbNoSvc.Platform.boot();
      sbNoSvc.Platform.ready();
    } catch (e) { threwNoSvc = true; }
    ok(!threwNoSvc, 'tasks runtime works without MythosSearch/Calendar');
    ok(sbNoSvc._TASKS_RT_STATE.initialized === true, 'tasks initialized even without services');
  }

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 9: index.html loading order
  // ══════════════════════════════════════════════════════════════════════
  section('9. index.html loading order');
  {
    var htmlRaw = fs.readFileSync(path.join(BASE, 'index.html'), 'utf8');

    var order = [
      'src="js/core/shell.js',
      'src="js/core/services/search.js',
      'src="js/core/services/calendar.js',
      'src="js/core/services/widgets.js',
      'src="js/core/services/notifications.js',
      'src="js/core/services/dialogs.js',
      'src="js/core/services/plugin-services.js',
      'src="js/core/plugin-sdk.js',
      'src="js/plugins/tasks.runtime.js',
      'src="js/taches.js'
    ];

    for (var i = 0; i < order.length; i++) {
      ok(htmlRaw.indexOf(order[i]) !== -1, order[i].split('/').pop().replace('"','') + ' present in index.html');
    }

    for (var j = 0; j < order.length - 1; j++) {
      ok(htmlRaw.indexOf(order[j]) < htmlRaw.indexOf(order[j+1]),
         order[j].split('/').pop().replace('"','') + ' loaded before ' + order[j+1].split('/').pop().replace('"',''));
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 10: Regression — Stage 1C / 2D / 3A tests
  // ══════════════════════════════════════════════════════════════════════
  section('10. Regression — prior test suites');
  {
    var suites = [
      'tests/stage1c-part1-test.js',
      'tests/stage2d-test.js',
      'tests/stage3a-test.js'
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
      } catch (e) {
        _fail++;
        _results.push('  FAIL regression: ' + suites[i] + ' — error: ' + e.message.slice(0, 80));
      }
    }
  }

  // ── Print results ─────────────────────────────────────────────────────
  _results.forEach(function (r) { console.log(r); });
  var total = _pass + _fail;
  console.log('\n' + (_fail === 0 ? '✓' : '✗') +
    ' ' + _pass + '/' + total + ' tests passed');
  if (_fail > 0) process.exit(1);

})().catch(function (e) {
  console.error('\n[TEST RUNNER ERROR]', e.message);
  console.error(e.stack);
  process.exit(1);
});
