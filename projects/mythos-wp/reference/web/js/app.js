/* MYTHOS WP — application bootstrap: session, meta, navigation, project
   switch, theme, routing to views. */
import { api } from './api.js';
import { h, clear, icon, toast, badge } from './ui.js';
import { parseHash, match } from './router.js';
import { commandMenu } from './command.js';
import { dirtyGuard } from './form.js';
import * as dashboard from './views/dashboard.js';
import * as resource from './views/resource.js';
import * as record from './views/record.js';
import * as part from './views/part.js';
import * as overlays from './views/overlays.js';
import * as autoreply from './views/autoreply.js';
import * as system from './views/system.js';
import * as inboxView from './views/inbox.js';
import * as contactsView from './views/contacts.js';

const PROJECT_KEY = 'mythos-wp:project';
const THEME_KEY = 'mythos-wp:theme';
export const state = { meta: null, project: null, recent: [] };

function applyTheme() {
  let t = null; try { t = localStorage.getItem(THEME_KEY); } catch (e) { /* preference */ }
  if (t) document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme');
}
function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme');
  const dark = cur ? cur === 'dark' : !window.matchMedia('(prefers-color-scheme: light)').matches;
  const next = dark ? 'light' : 'dark';
  try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* preference */ }
  applyTheme();
}
applyTheme();

// Navigation is derived from the registry: only resources with a backend
// appear as live entries; sections without one are marked planned.
export function navEntries() {
  const m = state.meta; if (!m) return [];
  const R = m.resources;
  const proj = state.project;
  const entries = [
    { group: 'Overview', label: 'Dashboard', icon: 'dashboard', route: '#/dashboard' },
    { group: 'Catalogue', label: R.products.label, icon: 'part', route: '#/r/products' },
    { group: 'Catalogue', label: 'References', icon: 'reference', route: '#/references' },
    { group: 'Catalogue', label: R.vehicle_models.label, icon: 'vehicle', route: '#/r/vehicle_models' },
    { group: 'Catalogue', label: R.motorizations.label, icon: 'engine', route: '#/r/motorizations' },
    { group: 'Catalogue', label: R.compatibility.label, icon: 'link', route: '#/r/compatibility' },
    { group: 'Catalogue', label: R.images.label, icon: 'image', route: '#/r/images' },
    { group: 'Commercial', label: 'Prices', icon: 'price', route: '#/pricing' },
    { group: 'Commercial', label: 'Stock', icon: 'stock', route: '#/stock' },
    { group: 'MYTHOS AUTO', label: 'Auto-Reply', icon: 'auto', route: '#/autoreply' },
    { group: 'MYTHOS AUTO', label: 'Handoff', icon: 'handoff', route: '#/r/handoffs', count: state.handoffOpen },
    { group: 'MYTHOS AUTO', label: 'Knowledge', icon: 'knowledge', route: '#/r/knowledge' },
    { group: 'WhatsApp', label: 'Inbox', icon: 'auto', route: '#/inbox', count: state.inboxUnread },
    { group: 'WhatsApp', label: 'Contacts', icon: 'project', route: '#/contacts' },
    { group: 'WhatsApp', label: R.inboxes.label, icon: 'system', route: '#/r/inboxes' },
    { group: 'Projects', label: 'Projects', icon: 'project', route: '#/r/projects' },
    { group: 'System', label: 'Audit log', icon: 'audit', route: '#/r/audit' },
    { group: 'System', label: 'System health', icon: 'system', route: '#/system' },
    { group: 'Settings', label: 'Business rules', icon: 'rule', route: '#/r/rules' }
  ];
  return entries.map((e) => Object.assign(e, { disabled: !proj && !/projects|system|audit/.test(e.route) }));
}

function renderNav(current) {
  const nav = document.getElementById('nav'); clear(nav);
  let group = null;
  navEntries().forEach((e) => {
    if (e.group !== group) { nav.appendChild(h('div', { class: 'rail-section' }, e.group)); group = e.group; }
    const active = current && (current === e.route || (e.route !== '#/dashboard' && current.startsWith(e.route + '/')) || (e.route === '#/r/products' && current.startsWith('#/part/')));
    const a = h('a', { href: e.planned ? '#/dashboard' : e.route, class: e.planned ? 'planned' : '', 'aria-current': active ? 'page' : undefined, 'aria-disabled': e.planned ? 'true' : undefined, title: e.planned ? 'Planned — no backend exposes conversation logs yet' : undefined, onClick: e.planned ? (ev) => { ev.preventDefault(); toast('Conversations: planned. No MYTHOS service exposes conversation logs yet; the handoff queue is the live surface.', 'warn', 5000); } : undefined },
      h('span', { class: 'glyph' }, icon(e.icon)), h('span', {}, e.label), e.planned ? h('span', { class: 'pill' }, 'planned') : null, e.count ? h('span', { class: 'count' }, String(e.count)) : null);
    nav.appendChild(a);
  });
  const foot = document.getElementById('rail-foot'); clear(foot);
  foot.append(h('div', { class: 'who' }, h('span', {}, state.meta.user.username, ' ', badge(state.meta.user.role)), h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: signOut }, 'Sign out')), h('span', {}, 'MYTHOS WP v' + state.meta.version));
}

function renderProjects() {
  const sel = document.getElementById('project-select'); clear(sel);
  state.meta.projects.forEach((p) => sel.appendChild(h('option', { value: p.id, selected: p.id === state.project || undefined }, p.display_name + (p.status !== 'active' ? ' (' + p.status + ')' : '') + (p.catalog_configured ? '' : ' — no catalogue'))));
  if (!state.meta.projects.length) sel.appendChild(h('option', { value: '' }, 'No project'));
  sel.onchange = () => { state.project = sel.value; try { localStorage.setItem(PROJECT_KEY, sel.value); } catch (e) { /* pref */ } route(); };
}

export function crumbs(items) {
  const c = document.getElementById('crumbs'); clear(c);
  const p = state.meta.projects.find((x) => x.id === state.project);
  const all = [{ label: p ? p.display_name : 'MYTHOS WP', href: '#/dashboard' }].concat(items || []);
  all.forEach((it, i) => {
    if (i) c.appendChild(h('span', { class: 'sep' }, '/'));
    c.appendChild(i === all.length - 1 ? h('span', { class: 'current' }, it.label) : h('a', { href: it.href || '#/dashboard' }, it.label));
  });
  document.title = (items && items.length ? items[items.length - 1].label + ' · ' : '') + 'MYTHOS WP';
}

async function signOut() { try { await api.post('/api/logout', {}); } catch (e) { /* fall through */ } window.location.replace('/login'); }

export const ctx = {
  state, api, navEntries, crumbs, toggleTheme, signOut,
  project: () => state.project,
  projectRow: () => state.meta.projects.find((x) => x.id === state.project) || null,
  resources: () => state.meta.resources,
  can: (role) => { const rank = { operator: 1, owner: 2 }; return (rank[state.meta.user.role] || 0) >= (rank[role] || 99); },
  refreshMeta: async () => { state.meta = await api.get('/api/meta'); renderProjects(); },
  remember: (entry) => { state.recent = [entry].concat(state.recent.filter((r) => r.route !== entry.route)).slice(0, 8); try { sessionStorage.setItem('mythos-wp:recent', JSON.stringify(state.recent)); } catch (e) { /* pref */ } }
};

const VIEWS = [
  ['/dashboard', dashboard.render],
  ['/references', overlays.renderReferences],
  ['/pricing', overlays.renderPricing],
  ['/stock', overlays.renderStock],
  ['/autoreply', autoreply.render],
  ['/system', system.render],
  ['/inbox', inboxView.render],
  ['/inbox/:id', inboxView.render],
  ['/contacts', contactsView.render],
  ['/contacts/:id', contactsView.renderOne],
  ['/part/:uid', part.render],
  ['/r/:resource', resource.render],
  ['/r/:resource/new', record.renderNew],
  ['/r/:resource/:id', record.render],
  ['/r/:resource/:id/edit', record.renderEdit]
];

let lastHash = null;
async function route() {
  if (dirtyGuard.dirty && lastHash !== null && location.hash !== lastHash) {
    if (!window.confirm('You have unsaved changes. Leave this page?')) { history.replaceState(null, '', lastHash); return; }
    dirtyGuard.dirty = false;
  }
  lastHash = location.hash;
  const { segs, query } = parseHash(location.hash || '#/dashboard');
  const main = document.getElementById('view');
  renderNav('#/' + segs.join('/'));
  for (const [pattern, fn] of VIEWS) {
    const params = match(pattern, segs);
    if (params) {
      clear(main);
      try { await fn(main, params, query, ctx); } catch (err) { clear(main); main.appendChild(h('div', { class: 'notice danger' }, h('strong', {}, 'This view failed to render. '), err && err.message ? err.message : String(err))); console.error(err); }
      main.focus({ preventScroll: true });
      return;
    }
  }
  location.hash = '#/dashboard';
}

async function boot() {
  try { state.meta = await api.get('/api/meta'); } catch (e) { return; }
  try { const saved = localStorage.getItem(PROJECT_KEY); if (saved && state.meta.projects.some((p) => p.id === saved)) state.project = saved; } catch (e) { /* pref */ }
  if (!state.project) { const first = state.meta.projects.find((p) => p.status === 'active') || state.meta.projects[0]; state.project = first ? first.id : null; }
  try { state.recent = JSON.parse(sessionStorage.getItem('mythos-wp:recent') || '[]'); } catch (e) { state.recent = []; }
  renderProjects();
  const cmd = commandMenu(ctx);
  document.getElementById('search-btn').addEventListener('click', cmd.open);
  document.getElementById('theme-btn').addEventListener('click', toggleTheme);
  window.addEventListener('hashchange', route);
  route();
}
boot();
