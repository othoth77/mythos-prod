'use strict';
// =====================================================
// MYTHOS OS — Stage 2C automated tests
// Covers: Shell.sidebar, Shell.workspace, Shell.navigation,
//         Shell.widgets, plugin auto-registration,
//         lifecycle events, compatibility with production
//         and all 6 shared plugins.
// =====================================================

// ── location stub (no browser) ───────────────────────────────────────
var location = { hash: '#dashboard' };

// ── document stub (no DOM) ───────────────────────────────────────────
var document = {
  title: '',
  getElementById: function () { return null; }
};

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

// ── Platform factory ─────────────────────────────────────────────────
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

// ── Shell factory (mirrors shell.js exactly) ─────────────────────────
function makeShell() {
  var _sections    = {}, _sectionOrder = [];
  var _items       = {}, _itemOrder    = [];
  var _widgets     = {}, _widgetOrder  = [];
  var _title = '', _subtitle = '';

  function _copy(obj) {
    var c={},k=Object.keys(obj); for(var i=0;i<k.length;i++) c[k[i]]=obj[k[i]]; return c;
  }

  var navigation = {
    go: function(route) {
      if (typeof route !== 'string' || !route) return;
      if (typeof showView === 'function') { showView(route); }
      else { location.hash = '#' + route; }
      Events.emit('mythos:shell:navigate', { route: route });
    },
    current: function() {
      if (typeof location !== 'undefined' && location.hash) {
        var h = location.hash.replace(/^#/, '');
        return h || 'dashboard';
      }
      return 'dashboard';
    }
  };

  var workspace = {
    setTitle: function(title) {
      _title = (typeof title === 'string') ? title : '';
      if (typeof document !== 'undefined' && _title) document.title = _title + ' — Mythos';
      Events.emit('mythos:shell:title', { title: _title });
    },
    setSubtitle: function(text) {
      _subtitle = (typeof text === 'string') ? text : '';
      Events.emit('mythos:shell:subtitle', { subtitle: _subtitle });
    },
    clear: function() { Events.emit('mythos:shell:clear', {}); },
    getTitle:    function() { return _title; },
    getSubtitle: function() { return _subtitle; }
  };

  var sidebar = {
    registerSection: function(id, label, order) {
      if (typeof id !== 'string' || !id) return false;
      if (Object.prototype.hasOwnProperty.call(_sections, id)) return false;
      _sections[id] = { id:id, label:typeof label==='string'?label:id,
                        order:typeof order==='number'?order:99 };
      _sectionOrder.push(id);
      Events.emit('mythos:shell:section:registered', { id:id, label:_sections[id].label });
      return true;
    },
    registerItem: function(manifest) {
      if (!manifest||typeof manifest.id!=='string'||!manifest.id) return false;
      if (!manifest.route) return false;
      if (Object.prototype.hasOwnProperty.call(_items, manifest.id)) return false;
      _items[manifest.id] = {
        id:      manifest.id,
        section: typeof manifest.section==='string'?manifest.section:'général',
        route:   manifest.route,
        label:   typeof manifest.label==='string'?manifest.label:manifest.route,
        icon:    typeof manifest.icon==='string'?manifest.icon:'',
        order:   typeof manifest.order==='number'?manifest.order:99
      };
      _itemOrder.push(manifest.id);
      Events.emit('mythos:shell:item:registered',
        { id:manifest.id, route:manifest.route, section:_items[manifest.id].section });
      return true;
    },
    getSections: function() {
      return _sectionOrder.map(function(k){return _copy(_sections[k]);})
                          .sort(function(a,b){return a.order-b.order;});
    },
    getItems: function(section) {
      var list = _itemOrder.map(function(k){return _copy(_items[k]);});
      if (typeof section==='string') list=list.filter(function(i){return i.section===section;});
      return list.sort(function(a,b){return a.order-b.order;});
    },
    hasSection: function(id) { return Object.prototype.hasOwnProperty.call(_sections,id); },
    hasItem:    function(id) { return Object.prototype.hasOwnProperty.call(_items,id); }
  };

  var header = {
    getLogoEl:    function() { return null; },
    getSidebarEl: function() { return null; },
    getNavEl:     function() { return null; },
    getLogoutEl:  function() { return null; }
  };

  var widgets = {
    register: function(manifest) {
      if (!manifest||typeof manifest.id!=='string'||!manifest.id) return false;
      if (Object.prototype.hasOwnProperty.call(_widgets,manifest.id)) return false;
      _widgets[manifest.id] = {
        id:     manifest.id,
        label:  typeof manifest.label==='function'?manifest.id:
                typeof manifest.label==='string'?manifest.label:manifest.id,
        zone:   typeof manifest.zone==='string'?manifest.zone:'dashboard',
        render: typeof manifest.render==='function'?manifest.render:null,
        order:  typeof manifest.order==='number'?manifest.order:99
      };
      _widgetOrder.push(manifest.id);
      Events.emit('mythos:shell:widget:registered',
        { id:manifest.id, zone:_widgets[manifest.id].zone });
      return true;
    },
    getAll: function(zone) {
      var list = _widgetOrder.map(function(id){return _copy(_widgets[id]);});
      if (typeof zone==='string') list=list.filter(function(w){return w.zone===zone;});
      return list.sort(function(a,b){return a.order-b.order;});
    },
    hasWidget: function(id) { return Object.prototype.hasOwnProperty.call(_widgets,id); }
  };

  // Auto-register: binds to Events to pick up plugins as they are registered
  function _autoRegister(Platform) {
    Events.on('mythos:plugin:registered', function(payload) {
      if (!payload||!payload.id) return;
      var plugin = Platform.getPlugin(payload.id);
      if (!plugin||!plugin.menu) return;
      var sectionLabel = plugin.menu.section || plugin.label || plugin.id;
      var sectionId = sectionLabel.toLowerCase()
        .replace(/[àâä]/g,'a').replace(/[éèêë]/g,'e')
        .replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'');
      sidebar.registerSection(sectionId, sectionLabel, plugin.menu.order||99);
      if (Array.isArray(plugin.routes)) {
        plugin.routes.forEach(function(route, idx) {
          if (!route||!route.id) return;
          sidebar.registerItem({
            id:      plugin.id+':'+route.id,
            section: sectionId,
            route:   route.id,
            label:   route.label||route.id,
            icon:    route.icon||'',
            order:   (plugin.menu.order||0)*100+idx
          });
        });
      }
    });
    Events.on('mythos:ready', function() {
      Events.emit('mythos:shell:ready', {
        sections: sidebar.getSections().length,
        items:    sidebar.getItems().length,
        widgets:  widgets.getAll().length
      });
    });
  }

  return { sidebar:sidebar, header:header, workspace:workspace,
           navigation:navigation, widgets:widgets, _autoRegister:_autoRegister };
}

// ── All plugin manifests ─────────────────────────────────────────────
var PRODUCTION = {
  id:'production',label:'Production',version:'1.0.0',type:'business',
  menu:{section:'Production',order:10,icon:'production'},
  routes:[
    {id:'dashboard',label:'Tableau de bord',icon:'📊',render:null},
    {id:'list',label:'Factures',icon:'🧾',render:null},
    {id:'devis',label:'Devis',icon:'📋',render:null},
    {id:'contracts',label:'Contrats',icon:'📄',render:null},
    {id:'om-list',label:'Ordres de mission',icon:'🗂️',render:null},
    {id:'clients',label:'Clients',icon:'🏢',render:null},
    {id:'comptabilite',label:'Comptabilité',icon:'💳',render:null}
  ],
  storageKeys:['mp_invoices'],onBoot:function(){},onReady:function(){}
};
var DASHBOARD = {
  id:'dashboard',label:'Dashboard',version:'1.0.0',type:'shared',
  menu:{section:'Général',order:1,icon:'dashboard'},
  routes:[{id:'dashboard',label:'Tableau de bord',icon:'🏠',render:null}],
  storageKeys:[],onBoot:function(){},onReady:function(){}
};
var CALENDAR = {
  id:'calendar',label:'Calendrier',version:'1.0.0',type:'shared',
  menu:{section:'Général',order:2,icon:'calendar'},
  routes:[{id:'calendrier',label:'Calendrier',icon:'📅',render:null}],
  storageKeys:[],onBoot:function(){},onReady:function(){}
};
var TASKS = {
  id:'tasks',label:'Tâches',version:'1.0.0',type:'shared',
  menu:{section:'Général',order:3,icon:'tasks'},
  routes:[{id:'tache',label:'Mes Tâches',icon:'📋',render:null}],
  storageKeys:['mp_taches'],onBoot:function(){},onReady:function(){}
};
var PLANNING = {
  id:'planning',label:'Planning',version:'1.0.0',type:'shared',
  menu:{section:'Général',order:4,icon:'planning'},
  routes:[],
  storageKeys:['mp_rappels','mp_rappel_types'],onBoot:function(){},onReady:function(){}
};
var CONTACTS = {
  id:'contacts',label:'Contacts',version:'1.0.0',type:'shared',
  menu:{section:'Général',order:5,icon:'contacts'},
  routes:[
    {id:'gestion-contacts',label:'Répertoire',icon:'👥',render:null},
    {id:'contact-fiche',label:'Fiche contact',icon:'👤',render:null}
  ],
  storageKeys:['mp_repertoire_contacts','mp_repertoire_imports'],
  onBoot:function(){},onReady:function(){}
};
var NOTES = {
  id:'notes',label:'Rédaction',version:'1.0.0',type:'shared',
  menu:{section:'Général',order:6,icon:'notes'},
  routes:[
    {id:'redaction-das',label:'Rédaction DAS',icon:'📝',render:null},
    {id:'redaction-autres',label:'Rédaction Autres',icon:'📝',render:null}
  ],
  storageKeys:['mp_rddocs_das','mp_rddocs_autres'],
  onBoot:function(){},onReady:function(){}
};
var ALL_PLUGINS = [PRODUCTION,DASHBOARD,CALENDAR,TASKS,PLANNING,CONTACTS,NOTES];

// ── Test harness ──────────────────────────────────────────────────────
var pass=0, fail=0;
function check(label, cond) {
  if (cond) { pass++; console.log('  PASS: '+label); }
  else       { fail++; console.error('  FAIL: '+label); }
}

// ── Helper: build a full platform + shell with all plugins ────────────
function buildEnv() {
  var P = makePlatform();
  var S = makeShell();
  S._autoRegister(P);
  ALL_PLUGINS.forEach(function(m) { P.registerPlugin(m); });
  return { P:P, S:S };
}

// ═════════════════════════════════════════════════════════════════════
// [GROUP 1] Shell.sidebar — section registration
// ═════════════════════════════════════════════════════════════════════
console.log('\n── Sidebar: section registration ────────────────────────');

var S0 = makeShell();
check('registerSection returns true for valid id', S0.sidebar.registerSection('test-sec', 'Test', 1));
check('registerSection false for duplicate id',    !S0.sidebar.registerSection('test-sec', 'Test 2', 2));
check('registerSection false for empty id',        !S0.sidebar.registerSection('', 'Empty'));
check('hasSection true after registration',         S0.sidebar.hasSection('test-sec'));
check('hasSection false for unknown section',       !S0.sidebar.hasSection('nonexistent'));
var secs = S0.sidebar.getSections();
check('getSections returns array',   Array.isArray(secs));
check('getSections has test-sec',    secs.some(function(s){return s.id==='test-sec';}));
check('section label preserved',     secs[0].label === 'Test');
check('section order preserved',     secs[0].order === 1);

// Multiple sections sorted by order
S0.sidebar.registerSection('z-last', 'Z Last', 100);
S0.sidebar.registerSection('a-first', 'A First', 0);
var sorted = S0.sidebar.getSections();
check('getSections sorted by order', sorted[0].id === 'a-first' && sorted[sorted.length-1].id === 'z-last');

// Safe copy — mutating result doesn't affect registry
var copy = S0.sidebar.getSections()[0];
copy.label = 'MUTATED';
check('getSections returns safe copies', S0.sidebar.getSections()[0].label !== 'MUTATED');

// ═════════════════════════════════════════════════════════════════════
// [GROUP 2] Shell.sidebar — item registration
// ═════════════════════════════════════════════════════════════════════
console.log('\n── Sidebar: item registration ────────────────────────────');

var S1 = makeShell();
S1.sidebar.registerSection('gen', 'Général', 1);
check('registerItem returns true for valid manifest',
  S1.sidebar.registerItem({id:'gen:dash',section:'gen',route:'dashboard',label:'Dashboard',icon:'🏠',order:1}));
check('registerItem false for duplicate id',
  !S1.sidebar.registerItem({id:'gen:dash',section:'gen',route:'dashboard',label:'Dup',order:2}));
check('registerItem false for missing route',
  !S1.sidebar.registerItem({id:'gen:no-route',section:'gen',label:'No Route'}));
check('hasItem true after registration',  S1.sidebar.hasItem('gen:dash'));
check('hasItem false for unknown item',   !S1.sidebar.hasItem('nonexistent'));

var items = S1.sidebar.getItems();
check('getItems returns array',           Array.isArray(items));
check('getItems has gen:dash',            items.some(function(i){return i.id==='gen:dash';}));
check('item route preserved',             items[0].route === 'dashboard');
check('item icon preserved',              items[0].icon  === '🏠');

// Filter by section
S1.sidebar.registerSection('prod', 'Production', 2);
S1.sidebar.registerItem({id:'prod:list',section:'prod',route:'list',label:'Factures',order:1});
var prodItems = S1.sidebar.getItems('prod');
check('getItems filtered by section',     prodItems.length === 1 && prodItems[0].id === 'prod:list');
var genItems = S1.sidebar.getItems('gen');
check('getItems filtered excludes others', genItems.every(function(i){return i.section==='gen';}));

// ═════════════════════════════════════════════════════════════════════
// [GROUP 3] Shell.navigation
// ═════════════════════════════════════════════════════════════════════
console.log('\n── Navigation ────────────────────────────────────────────');

var S2 = makeShell();
var navEvents = [];
Events.on('mythos:shell:navigate', function(p){ navEvents.push(p.route); });

// current() reads location.hash
location.hash = '#factures';
check('current() reads location.hash', S2.navigation.current() === 'factures');

location.hash = '';
check('current() defaults to "dashboard" when hash empty', S2.navigation.current() === 'dashboard');

// go() sets location.hash when showView is not defined
var showView; // undefined
S2.navigation.go('om-list');
check('go() updates location.hash when showView absent',
  location.hash === '#om-list');

// go() emits navigate event
check('go() emits mythos:shell:navigate', navEvents.indexOf('om-list') !== -1);

// go() with showView present
var showViewCalled = null;
var showView = function(v) { showViewCalled = v; };  // eslint-disable-line no-redeclare
S2.navigation.go('devis');
check('go() calls showView() when defined', showViewCalled === 'devis');
showView = undefined;

// go() with invalid route is no-op
navEvents = [];
S2.navigation.go('');
check('go() is no-op for empty route', navEvents.length === 0);

// ═════════════════════════════════════════════════════════════════════
// [GROUP 4] Shell.workspace
// ═════════════════════════════════════════════════════════════════════
console.log('\n── Workspace ─────────────────────────────────────────────');

var S3 = makeShell();
var titleEvents=[], subtitleEvents=[], clearEvents=[];
Events.on('mythos:shell:title',    function(p){ titleEvents.push(p.title); });
Events.on('mythos:shell:subtitle', function(p){ subtitleEvents.push(p.subtitle); });
Events.on('mythos:shell:clear',    function()  { clearEvents.push(1); });

S3.workspace.setTitle('Factures');
check('setTitle stores title',           S3.workspace.getTitle() === 'Factures');
check('setTitle emits mythos:shell:title', titleEvents.indexOf('Factures') !== -1);
check('setTitle updates document.title', document.title === 'Factures — Mythos');

S3.workspace.setSubtitle('Liste des factures 2026');
check('setSubtitle stores subtitle',             S3.workspace.getSubtitle() === 'Liste des factures 2026');
check('setSubtitle emits mythos:shell:subtitle', subtitleEvents.length === 1);

S3.workspace.clear();
check('clear() emits mythos:shell:clear', clearEvents.length === 1);

// setTitle with non-string is safe
S3.workspace.setTitle(null);
check('setTitle(null) sets empty string', S3.workspace.getTitle() === '');

S3.workspace.setSubtitle(42);
check('setSubtitle(non-string) sets empty string', S3.workspace.getSubtitle() === '');

// ═════════════════════════════════════════════════════════════════════
// [GROUP 5] Shell.widgets
// ═════════════════════════════════════════════════════════════════════
console.log('\n── Widgets ───────────────────────────────────────────────');

var S4 = makeShell();
var renderCalled = false;
var widgetEvents = [];
Events.on('mythos:shell:widget:registered', function(p){ widgetEvents.push(p.id); });

check('register returns true for valid manifest',
  S4.widgets.register({id:'tasks-widget',label:'Tâches',zone:'dashboard',
                        render:function(){renderCalled=true;},order:1}));
check('register false for duplicate id',
  !S4.widgets.register({id:'tasks-widget',label:'Dup',zone:'dashboard',order:2}));
check('register false for missing id',
  !S4.widgets.register({label:'No ID',zone:'dashboard'}));
check('hasWidget true after register', S4.widgets.hasWidget('tasks-widget'));
check('hasWidget false for unknown',   !S4.widgets.hasWidget('nonexistent'));
check('register emits widget:registered event', widgetEvents.indexOf('tasks-widget') !== -1);

S4.widgets.register({id:'kpi-widget',   label:'KPI',   zone:'dashboard', order:2});
S4.widgets.register({id:'chart-widget', label:'Chart', zone:'reports',   order:1});

var all = S4.widgets.getAll();
check('getAll returns all widgets',        all.length === 3);
check('getAll sorted by order',            all[0].id === 'tasks-widget');
check('render function preserved',         typeof all[0].render === 'function');

var dashWidgets = S4.widgets.getAll('dashboard');
check('getAll filtered by zone',           dashWidgets.length === 2);
check('getAll zone filter excludes others',dashWidgets.every(function(w){return w.zone==='dashboard';}));

// Safe copy
var wCopy = S4.widgets.getAll()[0];
wCopy.label = 'MUTATED';
check('getAll returns safe copies', S4.widgets.getAll()[0].label !== 'MUTATED');

// ═════════════════════════════════════════════════════════════════════
// [GROUP 6] Plugin auto-registration (sidebar ← mythos:plugin:registered)
// ═════════════════════════════════════════════════════════════════════
console.log('\n── Plugin auto-registration ──────────────────────────────');

var env = buildEnv();
var P = env.P, S = env.S;

// All menus registered as sections
check('section "production" registered from plugin',  S.sidebar.hasSection('production'));
check('section "général" registered from shared plugins', S.sidebar.hasSection('g-n-ral') ||
  S.sidebar.hasSection('général') || S.sidebar.getSections().some(function(s){
    return s.label==='Général';
  }));

// Items for production plugin routes
check('item "production:dashboard" registered',  S.sidebar.hasItem('production:dashboard'));
check('item "production:list" registered',       S.sidebar.hasItem('production:list'));
check('item "production:clients" registered',    S.sidebar.hasItem('production:clients'));
check('item "production:comptabilite" registered', S.sidebar.hasItem('production:comptabilite'));

// Items for shared plugins
check('item "dashboard:dashboard" registered',   S.sidebar.hasItem('dashboard:dashboard'));
check('item "calendar:calendrier" registered',   S.sidebar.hasItem('calendar:calendrier'));
check('item "tasks:tache" registered',           S.sidebar.hasItem('tasks:tache'));
check('item "contacts:gestion-contacts" registered', S.sidebar.hasItem('contacts:gestion-contacts'));
check('item "contacts:contact-fiche" registered',    S.sidebar.hasItem('contacts:contact-fiche'));
check('item "notes:redaction-das" registered',   S.sidebar.hasItem('notes:redaction-das'));
check('item "notes:redaction-autres" registered',S.sidebar.hasItem('notes:redaction-autres'));

// Planning has no routes — no items registered for it
check('planning has no items (modal-only)',
  S.sidebar.getItems().filter(function(i){return i.id.startsWith('planning:');}).length === 0);

// Total items = sum of routes across all 7 plugins
// production(7)+dashboard(1)+calendar(1)+tasks(1)+planning(0)+contacts(2)+notes(2) = 14
var allItems = S.sidebar.getItems();
check('total registered items is 14', allItems.length === 14);

// ═════════════════════════════════════════════════════════════════════
// [GROUP 7] Shell.sidebar section–item coherence
// ═════════════════════════════════════════════════════════════════════
console.log('\n── Section–item coherence ────────────────────────────────');

var sections = S.sidebar.getSections();
check('sections registered',    sections.length >= 2);

// All items' sections reference a registered section
var sectionIds = sections.map(function(s){ return s.id; });
var itemsAll   = S.sidebar.getItems();
var orphans = itemsAll.filter(function(i){ return sectionIds.indexOf(i.section) === -1; });
check('no orphan items (all sections exist)', orphans.length === 0);

// Each item in 'production' section has route matching a production route
var prodSection = sections.find(function(s){ return s.label === 'Production'; });
if (prodSection) {
  var prodItems = S.sidebar.getItems(prodSection.id);
  check('production section items are non-empty', prodItems.length > 0);
  check('production items have route strings',
    prodItems.every(function(i){ return typeof i.route === 'string' && i.route.length > 0; }));
}

// ═════════════════════════════════════════════════════════════════════
// [GROUP 8] mythos:shell:ready fires after Platform.ready()
// ═════════════════════════════════════════════════════════════════════
console.log('\n── Shell ready event ─────────────────────────────────────');

var env2 = buildEnv();
var shellReadyPayload = null;
Events.once('mythos:shell:ready', function(p){ shellReadyPayload = p; });
env2.P.ready();

check('mythos:shell:ready emitted after Platform.ready()', shellReadyPayload !== null);
check('shell:ready payload has sections count',  shellReadyPayload && typeof shellReadyPayload.sections === 'number');
check('shell:ready payload has items count',     shellReadyPayload && typeof shellReadyPayload.items    === 'number');
check('shell:ready payload has widgets count',   shellReadyPayload && typeof shellReadyPayload.widgets  === 'number');
check('shell:ready sections >= 2',  shellReadyPayload && shellReadyPayload.sections >= 2);
check('shell:ready items >= 14',    shellReadyPayload && shellReadyPayload.items    >= 14);

// ═════════════════════════════════════════════════════════════════════
// [GROUP 9] Compatibility — Platform plugins unaffected by Shell
// ═════════════════════════════════════════════════════════════════════
console.log('\n── Platform compatibility ────────────────────────────────');

var env3 = buildEnv();
// Shell auto-register should not affect plugin registry state
check('all 7 plugins still registered after Shell init', env3.P.getPlugins().length === 7);
check('production plugin type unchanged', env3.P.getPlugin('production').type === 'business');
check('tasks storageKeys still intact',
  env3.P.getPlugin('tasks').storageKeys.indexOf('mp_taches') !== -1);
// Shell does not add new plugins to Platform
check('Shell does not add itself to Platform as a plugin',
  !env3.P.hasPlugin('shell'));
// Boot/ready still work after Shell init
env3.P.boot();
check('Platform.boot() works after Shell init', env3.P.phase() === 'booted');
env3.P.ready();
check('Platform.ready() works after Shell init', env3.P.phase() === 'ready');

// ═════════════════════════════════════════════════════════════════════
// [GROUP 10] Shell.header accessors (DOM stub = null)
// ═════════════════════════════════════════════════════════════════════
console.log('\n── Header accessors ──────────────────────────────────────');

var Sh = makeShell();
check('getLogoEl returns null (no DOM in tests)',    Sh.header.getLogoEl()    === null);
check('getSidebarEl returns null (no DOM in tests)', Sh.header.getSidebarEl() === null);
check('getNavEl returns null (no DOM in tests)',     Sh.header.getNavEl()     === null);
check('getLogoutEl returns null (no DOM in tests)',  Sh.header.getLogoutEl()  === null);

// ═════════════════════════════════════════════════════════════════════
// Summary
// ═════════════════════════════════════════════════════════════════════
console.log('\n══════════════════════════════════════════════════════════');
console.log(' MYTHOS OS Stage 2C tests — ' + pass + ' passed, ' + fail + ' failed');
console.log('══════════════════════════════════════════════════════════');
if (fail > 0) process.exit(1);
