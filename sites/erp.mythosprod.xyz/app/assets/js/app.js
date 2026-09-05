/* Mythos ERP — application bootstrap.
 *
 * Boot: restore the session (GET /session) → load the contract (GET /meta) →
 * build the rail from the tenant's enabled modules → route. No session: show
 * the login form and nothing else. Every view renders into #view; a 401 from
 * any call drops back to the login.
 */
import { api, describeError, onUnauthenticated } from './api.js';
import { session } from './session.js';
import { start as startRouter, go } from './router.js';
import { h, clear, toast, tabs, errorBox, empty } from './ui.js';
import { resourceView, RESOURCE_TITLES } from './views/resource.js';
import { invoicesView } from './views/invoices.js';
import { dashboardView } from './views/dashboard.js';
import { reportsView } from './views/reports.js';
import { settingsView, usersView, auditView } from './views/admin.js';
import { accountingView } from './views/accounting.js';
import { agendaView } from './views/agenda.js';

/* Module → what the view shows. A module with several resources gets tabs. */
const MODULES = {
  dashboard:  { title: 'Tableau de bord', kicker: 'Vue d\'ensemble', glyph: '▦', view: (el) => dashboardView(el) },
  clients:    { title: 'Clients', kicker: 'Répertoire', glyph: '●', resources: ['clients', 'contacts'] },
  prospects:  { title: 'Prospects', kicker: 'Commercial', glyph: '◎', resources: ['prospects'] },
  projects:   { title: 'Projets', kicker: 'Production', glyph: '▲', resources: ['projects', 'contracts'] },
  planning:   { title: 'Planning', kicker: 'Rendez-vous', glyph: '◔', resources: ['appointments'] },
  agenda:     { title: 'Agenda', kicker: 'Événements, tâches, rappels', glyph: '◉', view: (el, r) => agendaView(el, r) },
  production: { title: 'Production', kicker: 'Spectacles', glyph: '◆', resources: ['representations', 'collaborators'] },
  finance:    { title: 'Finance', kicker: 'Flux', glyph: '■', resources: ['invoices', 'quotes', 'purchases', 'expenses', 'bank_accounts'] },
  accounting: { title: 'Comptabilité', kicker: 'Grand livre', glyph: '⚖', view: (el, r) => accountingView(el, r) },
  documents:  { title: 'Documents', kicker: 'Pièces', glyph: '▬', resources: ['documents'] },
  reports:    { title: 'Rapports', kicker: 'Analyse', glyph: '◧', view: (el, r) => reportsView(el, r.resource) },
  inventory:  { title: 'Inventaire', kicker: 'Stock', glyph: '▤', resources: ['inventory_items', 'suppliers'] },
  settings:   { title: 'Paramètres', kicker: 'Entité', glyph: '⚙', resources: ['settings', 'natures', 'expense_categories'] },
  users:      { title: 'Utilisateurs', kicker: 'Accès', glyph: '☺', view: (el) => usersView(el) },
  audit:      { title: 'Audit', kicker: 'Journal', glyph: '≡', view: (el) => auditView(el) }
};
/* invoices is a module of its own for the API gate; the UI shows it under Finance. */
const RESOURCE_MODULE = { invoices: 'invoices', settings: 'settings' };

const $ = (id) => document.getElementById(id);
let enabledModules = [];

onUnauthenticated(() => { if (session.isAuthenticated()) { session.end(); toast('Session expirée.', 'warn'); showLogin(); } });

async function boot() {
  $('login-form').addEventListener('submit', onLogin);
  $('logout').addEventListener('click', onLogout);
  $('tenant-select').addEventListener('change', onTenantChange);
  document.addEventListener('erp:modules-changed', () => refreshModules().then(renderRail));
  // Always ask the server: the HttpOnly cookie may be valid even when this
  // tab holds no state yet (new tab). 401 → login form.
  try {
    const s = await api.quiet.get('/session');
    session.refresh(s);
    await enterApp();
  } catch (e) { session.end(); showLogin(); }
}

function showLogin() {
  $('app').hidden = true; $('login').hidden = false; clear($('view'));
  $('login-email').focus();
}

async function onLogin(ev) {
  ev.preventDefault();
  const err = $('login-error'); err.hidden = true;
  const btn = $('login-submit'); btn.disabled = true;
  try {
    const r = await api.post('/auth/login', { email: $('login-email').value.trim(), password: $('login-password').value });
    $('login-password').value = '';
    session.start(r);
    await enterApp();
  } catch (e) { err.textContent = describeError(e); err.hidden = false; }
  finally { btn.disabled = false; }
}

async function onLogout() {
  try { await api.post('/auth/logout'); } catch (e) { /* the session may already be gone */ }
  session.end(); showLogin(); go('dashboard');
}

async function onTenantChange(ev) {
  const id = ev.target.value;
  try {
    await api.post('/session/tenant', { tenant_id: id });
    session.setActiveTenant(id);
    toast('Entité active : ' + (session.activeTenant() || {}).display_name, 'ok');
    await refreshModules(); renderRail(); route(current);
  } catch (e) { toast(describeError(e), 'danger'); ev.target.value = session.activeTenantId(); }
}

async function enterApp() {
  if (!session.meta()) session.setMeta(await api.get('/meta'));
  $('login').hidden = true; $('app').hidden = false;
  $('topbar-user').textContent = (session.user() || {}).display_name || (session.user() || {}).email || '';
  const sel = clear($('tenant-select'));
  for (const t of session.tenants()) sel.appendChild(h('option', { value: t.id, selected: t.id === session.activeTenantId() || null, text: t.display_name }));
  sel.hidden = session.tenants().length < 2;
  $('rail-tenant').textContent = (session.activeTenant() || {}).key || '';
  await refreshModules(); renderRail();
  startRouter(Object.keys(MODULES), route);
}

async function refreshModules() {
  try {
    const s = await api.get('/settings');
    enabledModules = (s.modules || []).filter((m) => m.enabled).map((m) => m.module_key);
  } catch (e) {
    // settings.read needs settings.read; a user without it still gets the rail
    // and each module answers 404 if disabled — the API is the gate, not the rail.
    enabledModules = Object.keys(MODULES);
  }
}

function renderRail() {
  const rail = clear($('rail-modules'));
  for (const [key, m] of Object.entries(MODULES)) {
    if (!enabledModules.includes(key)) continue;
    rail.appendChild(h('a', { href: '#/' + key, dataset: { module: key } }, h('span', { class: 'glyph', 'aria-hidden': 'true', text: m.glyph }), h('span', { text: m.title })));
  }
}

let current = null;
function route(r) {
  current = r;
  const m = MODULES[r.module] || MODULES.dashboard;
  document.querySelectorAll('.rail a[data-module]').forEach((a) => {
    if (a.dataset.module === r.module) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  $('topbar-title').textContent = m.title; $('route-live').textContent = m.title; document.title = m.title + ' — Mythos ERP';
  const view = clear($('view'));
  view.appendChild(h('div', { class: 'view-head' }, h('p', { class: 'view-kicker', text: m.kicker }), h('h2', { text: m.title })));
  if (!enabledModules.includes(r.module)) { view.appendChild(empty('Module non activé', 'Activez-le dans Paramètres › Modules.')); return; }
  const body = h('div', {}); view.appendChild(body);
  try {
    if (m.view) return m.view(body, r);
    const res = m.resources.includes(r.resource) ? r.resource : m.resources[0];
    if (m.resources.length > 1) {
      view.insertBefore(tabs(m.resources.map((k) => ({ key: k, label: k === 'settings' ? 'Entité' : (k === 'invoices' ? 'Factures' : RESOURCE_TITLES[k] || k) })), res,
        (k) => go(r.module + '/' + k)), body);
    }
    if (res === 'invoices') return invoicesView(body, r.id);
    if (res === 'settings') return settingsView(body);
    if (res === 'documents') {
      body.appendChild(h('div', { class: 'notice' }, h('strong', { text: 'Dépôt de fichiers non disponible. ' }),
        'Le pipeline de documents sécurisé est une phase ultérieure ; cette vue liste seulement les enregistrements existants.'));
    }
    resourceView(res, body);
  } catch (e) { body.appendChild(errorBox('Cette vue n\'a pas pu s\'afficher.', () => route(r), String(e && e.message))); }
}

boot();
