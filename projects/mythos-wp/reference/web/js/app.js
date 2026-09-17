/* MYTHOS Control Center — application bootstrap: session, meta, navigation,
   project switch ('all' | project id), role gating, theme, routing to views. */
import { api } from './api.js';
import { h, clear, icon, badge } from './ui.js';
import { parseHash, match } from './router.js';
import { commandMenu } from './command.js';
import { dirtyGuard } from './form.js';
import * as dashboard from './views/dashboard.js';
import * as inbox from './views/inbox.js';
import * as projects from './views/projects.js';
import * as whatsapp from './views/whatsapp.js';
import * as ai from './views/ai.js';
import * as settings from './views/settings.js';
import * as resource from './views/resource.js';
import * as record from './views/record.js';

const PROJECT_KEY = 'mythos-wp:project';
const THEME_KEY = 'mythos-wp:theme';
const RANK = { viewer: 1, agent: 2, manager: 3, admin: 4, owner: 5 };
export const state = { meta: null, project: 'all', recent: [], inboxUnread: 0 };

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

function userRole() { const r = state.meta && state.meta.user ? state.meta.user.role : ''; return r === 'operator' ? 'manager' : r; }
function can(role) { const need = role === 'operator' ? 'agent' : role; return (RANK[userRole()] || 0) >= (RANK[need] || 99); }

export function navEntries() {
  if (!state.meta) return [];
  return [
    { label: 'Dashboard', icon: 'dashboard', route: '#/dashboard' },
    { label: 'Inbox', icon: 'inbox', route: '#/inbox', count: state.inboxUnread },
    { label: 'Projects', icon: 'project', route: '#/projects' },
    { label: 'WhatsApp', icon: 'whatsapp', route: '#/whatsapp' },
    { label: 'Settings', icon: 'settings', route: '#/settings' }
  ];
}

function renderNav(current) {
  const nav = document.getElementById('nav'); clear(nav);
  navEntries().forEach((e) => {
    const active = current === e.route || current.startsWith(e.route + '/') || (e.route === '#/inbox' && current.startsWith('#/contacts')) || (e.route === '#/settings' && /^#\/r\//.test(current)) || (e.route === '#/projects' && current.startsWith('#/ai/'));
    nav.appendChild(h('a', { href: e.route, 'aria-current': active ? 'page' : undefined, onClick: () => { document.getElementById('rail').classList.remove('open'); } },
      h('span', { class: 'glyph' }, icon(e.icon)), h('span', { class: 'nav-label' }, e.label), e.count ? h('span', { class: 'count', 'aria-label': e.count + ' unread' }, String(e.count)) : null));
  });
  const foot = document.getElementById('rail-foot'); clear(foot);
  foot.append(h('div', { class: 'who' }, h('span', {}, state.meta.user.username, ' ', badge(userRole())), h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: signOut }, 'Sign out')));
}

function renderProjects() {
  const sel = document.getElementById('project-select'); clear(sel);
  sel.appendChild(h('option', { value: 'all', selected: state.project === 'all' || undefined }, 'All projects'));
  state.meta.projects.forEach((p) => sel.appendChild(h('option', { value: p.id, selected: p.id === state.project || undefined }, p.display_name + (p.status !== 'active' ? ' (' + p.status + ')' : ''))));
  sel.onchange = () => { state.project = sel.value || 'all'; try { localStorage.setItem(PROJECT_KEY, state.project); } catch (e) { /* pref */ } route(); };
}

export function crumbs(items) {
  const c = document.getElementById('crumbs'); clear(c);
  const p = state.meta.projects.find((x) => x.id === state.project);
  const all = [{ label: p ? p.display_name : 'All projects', href: '#/dashboard' }].concat(items || []);
  all.forEach((it, i) => {
    if (i) c.appendChild(h('span', { class: 'sep' }, '/'));
    c.appendChild(i === all.length - 1 ? h('span', { class: 'current' }, it.label) : h('a', { href: it.href || it.route || '#/dashboard' }, it.label));
  });
  document.title = (items && items.length ? items[items.length - 1].label + ' · ' : '') + 'MYTHOS Control Center';
}

async function signOut() { try { await api.post('/api/logout', {}); } catch (e) { /* fall through */ } window.location.replace('/login'); }

/* Unread total across accessible projects (best effort, feeds the rail count). */
async function refreshUnread() {
  const ids = state.project === 'all' ? state.meta.projects.map((p) => p.id) : [state.project];
  const parts = await Promise.all(ids.map((id) => api.get('/api/projects/' + id + '/comms/conversations?status=live&limit=1').then((r) => r.counts && r.counts.unread || 0, () => 0)));
  const total = parts.reduce((a, b) => a + b, 0);
  if (total !== state.inboxUnread) { state.inboxUnread = total; renderNav('#/' + parseHash(location.hash || '#/dashboard').segs.join('/')); }
}

export const ctx = {
  state, api, navEntries, crumbs, toggleTheme, signOut, can, refreshUnread,
  project: () => state.project,
  projectId: () => state.project === 'all' ? null : state.project,
  isAll: () => state.project === 'all',
  projects: () => state.meta.projects,
  projectRow: (id) => state.meta.projects.find((x) => x.id === (id || state.project)) || null,
  projectName: (id) => { const p = state.meta.projects.find((x) => x.id === id); return p ? p.display_name : (id || '—'); },
  setProject: (id) => { state.project = id || 'all'; try { localStorage.setItem(PROJECT_KEY, state.project); } catch (e) { /* pref */ } renderProjects(); },
  role: userRole,
  resources: () => state.meta.resources,
  refreshMeta: async () => { state.meta = await api.get('/api/meta'); renderProjects(); },
  remember: (entry) => { state.recent = [entry].concat(state.recent.filter((r) => r.route !== entry.route)).slice(0, 8); try { sessionStorage.setItem('mythos-wp:recent', JSON.stringify(state.recent)); } catch (e) { /* pref */ } }
};

/* Old hashes keep working: they land where the feature now lives. */
const GENERIC = ['knowledge', 'rules', 'handoffs', 'users', 'tags'];
function redirectFor(segs, query) {
  const p = '/' + segs.join('/');
  const pid = ctx.projectId();
  if (p === '/ai') return pid ? '#/projects/' + encodeURIComponent(pid) + '?tab=ai' : '#/projects';
  if (p === '/automations') return '#/settings?section=automations';
  if (p === '/integrations') return '#/settings?section=integrations';
  if (p === '/health' || p === '/system') return '#/settings?section=system';
  if (p === '/audit' || p === '/r/audit') return '#/settings?section=system&sub=audit' + (query ? '&' + query : '');
  if (p === '/r/projects/new') return '#/projects/new';
  if (p === '/r/projects') return '#/projects';
  if (/^\/r\/projects\/[^/]+/.test(p)) return '#/projects/' + segs[2];
  if (p === '/r/inboxes' || /^\/r\/inboxes\//.test(p)) return '#/whatsapp';
  if (segs[0] === 'r' && segs[1] && !GENERIC.includes(segs[1])) return '#/dashboard';
  return null;
}

const VIEWS = [
  ['/dashboard', dashboard.render],
  ['/inbox', inbox.render],
  ['/inbox/:id', inbox.render],
  ['/contacts', inbox.render],
  ['/contacts/360/:contact', inbox.render],
  ['/projects', projects.render],
  ['/projects/new', projects.renderForm],
  ['/projects/:id', projects.renderOne],
  ['/projects/:id/edit', projects.renderForm],
  ['/whatsapp', whatsapp.render],
  ['/ai/agents/:id', ai.renderAgent],
  ['/settings', settings.render],
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
  const to = redirectFor(segs, query);
  if (to) { history.replaceState(null, '', to); lastHash = to; return route(); }
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
  try { const saved = localStorage.getItem(PROJECT_KEY); if (saved === 'all' || (saved && state.meta.projects.some((p) => p.id === saved))) state.project = saved; } catch (e) { /* pref */ }
  if (!state.project) state.project = 'all';
  try { state.recent = JSON.parse(sessionStorage.getItem('mythos-wp:recent') || '[]'); } catch (e) { state.recent = []; }
  renderProjects();
  const cmd = commandMenu(ctx);
  document.getElementById('search-btn').addEventListener('click', cmd.open);
  const themeBtn = document.getElementById('theme-btn'); clear(themeBtn); themeBtn.appendChild(icon('theme')); themeBtn.addEventListener('click', toggleTheme);
  const toggle = document.getElementById('rail-toggle');
  toggle.addEventListener('click', () => { const rail = document.getElementById('rail'); const open = rail.classList.toggle('open'); toggle.setAttribute('aria-expanded', open ? 'true' : 'false'); });
  window.addEventListener('hashchange', route);
  route();
  refreshUnread();
  setInterval(refreshUnread, 60000);
}
boot();
