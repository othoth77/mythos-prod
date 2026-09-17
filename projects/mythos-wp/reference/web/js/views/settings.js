/* MYTHOS Control Center — Settings with an in-page sub-navigation:
   General (account, language, appearance) · Users · Integrations (cards) ·
   Automations · System (health rows, audit, backup, AI runs). The panels
   are also reused by the project page (members, automations, integrations, audit). */
import { h, clear, badge, fmtDate, relTime, skeletonRows, errorBox, empty, toast, chip, kv, pageHead, cardHead, simpleTable, switchInput, dialogForm, drawer, confirmDialog, hostOf, json, qget, setQuery, roleNote, details, codeBlock } from '../ui.js';
import { dataTable, stateFromQuery, apiQuery } from '../table.js';
import { runsPanel } from './ai.js';
import { mcpPanel } from './whatsapp.js';

const SECTIONS = [{ key: 'general', label: 'General' }, { key: 'users', label: 'Users' }, { key: 'integrations', label: 'Integrations' }, { key: 'automations', label: 'Automations', role: 'admin' }, { key: 'system', label: 'System' }];
const ROLES = ['viewer', 'agent', 'manager', 'admin', 'owner'];

export async function render(main, params, query, ctx) {
  const list = SECTIONS.filter((s) => !s.role || ctx.can(s.role));
  let section = qget(query, 'section', 'general'); if (!list.some((s) => s.key === section)) section = 'general';
  ctx.crumbs([{ label: 'Settings' }, { label: list.find((s) => s.key === section).label }]);
  main.appendChild(pageHead(null, 'Settings'));
  const layout = h('div', { class: 'settings' }); main.appendChild(layout);
  const nav = h('nav', { class: 'subnav', 'aria-label': 'Settings sections' });
  const body = h('div', { class: 'settings-body' });
  layout.append(nav, body);
  function renderNav() { clear(nav); list.forEach((s) => nav.appendChild(h('a', { href: '#/settings?section=' + s.key, 'aria-current': s.key === section ? 'page' : undefined, onClick: (e) => { e.preventDefault(); section = s.key; setQuery('#/settings', { section: s.key }); ctx.crumbs([{ label: 'Settings' }, { label: s.label }]); renderNav(); show(); } }, s.label))); }
  function show() {
    clear(body);
    if (section === 'general') body.appendChild(generalPanel(ctx));
    else if (section === 'users') body.appendChild(usersPanel(ctx, {}));
    else if (section === 'integrations') body.appendChild(integrationsPanel(ctx, { cards: true }));
    else if (section === 'automations') body.appendChild(automationsPanel(ctx, { project: ctx.project() }));
    else body.appendChild(systemPanel(ctx, query));
  }
  renderNav(); show();
}

/* ── General ──────────────────────────────────────────────────────────── */
function generalPanel(ctx) {
  const u = ctx.state.meta.user;
  return h('div', { class: 'stack' },
    h('div', { class: 'card' }, cardHead('Account'), kv([['Username', u.username], ['Role', badge(ctx.role())], ['Projects', ctx.projects().length + ' accessible']]), h('div', { class: 'view-actions' }, h('button', { class: 'btn btn-secondary', type: 'button', onClick: async () => { if (await confirmDialog({ title: 'Sign out?', confirmLabel: 'Sign out' })) ctx.signOut(); } }, 'Sign out'))),
    h('div', { class: 'card' }, cardHead('Language'), kv([['Interface', 'English']])),
    h('div', { class: 'card' }, cardHead('Appearance'), h('div', { class: 'view-actions' }, h('button', { class: 'btn btn-secondary', type: 'button', onClick: () => ctx.toggleTheme() }, 'Toggle dark / light'))));
}

/* ── Users ────────────────────────────────────────────────────────────── */
export function usersPanel(ctx, opts) {
  const root = h('div', { class: 'stack' });
  const admin = ctx.can('admin'), owner = ctx.can('owner');
  const project = opts.project || null;
  const r = ctx.resources().users;
  root.appendChild(h('div', { class: 'toolbar' }, h('p', { class: 'dim' }, project ? 'Members of this project.' : 'Owner and admin see every project; other roles only the projects granted here.'), h('div', { class: 'spacer' }), h('button', { class: 'btn btn-primary', type: 'button', disabled: !owner || undefined, title: owner ? '' : 'Requires the owner role', onClick: () => userDialog(null).then((ok) => { if (ok) load(); }) }, 'New user')));
  const box = h('div', {}); root.appendChild(box);
  async function load() {
    clear(box); box.appendChild(skeletonRows(3));
    if (!r) { clear(box); box.appendChild(h('div', { class: 'notice warn' }, h('strong', {}, 'User management is not available on this server yet.'))); return; }
    let page; try { page = await ctx.api.get('/api/r/users' + ctx.api.qs({ limit: 200, sort: 'username', dir: 'asc' })); } catch (err) { clear(box); box.appendChild(errorBox(err, load)); return; }
    clear(box);
    let rows = page.rows || page.items || [];
    await Promise.all(rows.map((u) => ctx.api.get('/api/users/' + encodeURIComponent(u.username) + '/projects').then((g) => { u.projects = (g.projects || g.items || []).map((p) => typeof p === 'string' ? p : p.project_id); }, () => { u.projects = u.projects || []; })));
    if (project) rows = rows.filter((u) => u.all_projects || (u.projects || []).includes(project) || ['owner', 'admin'].includes(u.role));
    if (!rows.length) { box.appendChild(empty('No user', project ? 'Nobody has explicit access to this project.' : 'Create the first account.')); return; }
    box.appendChild(simpleTable([
      { label: 'User', cell: (u) => h('div', {}, h('strong', {}, u.username), u.display_name ? h('div', { class: 'dim small' }, u.display_name) : null) },
      { label: 'Role', cell: (u) => badge(u.role) },
      { label: 'Status', cell: (u) => badge(u.status || 'active') },
      { label: 'Projects', cell: (u) => u.all_projects || ['owner', 'admin'].includes(u.role) ? badge('all projects', 'accent') : h('span', { class: 'chips' }, (u.projects || []).length ? (u.projects || []).map((p) => chip(ctx.projectName(typeof p === 'string' ? p : p.project_id), 'project')) : h('span', { class: 'dim' }, 'none')) },
      { label: 'Last login', cell: (u) => relTime(u.last_login_at), cls: 'dim' },
      { label: '', stop: true, cell: (u) => h('div', { class: 'row-actions' },
        owner ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: () => userDialog(u).then((ok) => { if (ok) load(); }) }, 'Edit') : null,
        admin ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: () => passwordDialog(u) }, 'Password') : null,
        admin ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: () => accessDialog(u).then((ok) => { if (ok) load(); }) }, 'Projects') : null) }
    ], rows, { noScroll: true, onRow: (u) => { location.hash = '#/r/users/' + encodeURIComponent(u.username); } }));
  }
  function userDialog(u) {
    return dialogForm({ title: u ? 'Edit ' + u.username : 'New user', fields: [
      { name: 'username', label: 'Username (a-z0-9._-)', required: true, mono: true, value: u ? u.username : '' },
      { name: 'display_name', label: 'Display name', value: u ? u.display_name || '' : '' },
      { name: 'role', label: 'Role', type: 'select', required: true, value: u ? u.role : 'agent', options: ROLES },
      { name: 'status', label: 'Status', type: 'select', required: true, value: u ? u.status || 'active' : 'active', options: ['active', 'disabled'] },
      { name: 'all_projects', label: 'Access to every project', type: 'checkbox', value: u ? !!u.all_projects : false },
      u ? null : { name: 'password', label: 'Initial password', type: 'password', required: true }
    ].filter(Boolean), onSubmit: async (v) => {
      const body = { display_name: v.display_name.trim() || null, role: v.role, status: v.status, all_projects: v.all_projects };
      if (u) { await ctx.api.patch('/api/r/users/' + encodeURIComponent(u.username), body); }
      else { body.username = v.username.trim(); body.password = v.password; await ctx.api.post('/api/r/users', body); }
      toast(u ? 'User saved' : 'User created', 'ok'); return true;
    } });
  }
  async function passwordDialog(u) {
    const out = await dialogForm({ title: 'Set password · ' + u.username, fields: [{ name: 'password', label: 'New password (12+ characters)', type: 'password', required: true }, { name: 'confirm', label: 'Confirm', type: 'password', required: true }], submitLabel: 'Set password', onSubmit: async (v) => { if (v.password !== v.confirm) throw new Error('Passwords differ.'); if (v.password.length < 12) throw new Error('Use at least 12 characters.'); await ctx.api.post('/api/users/' + encodeURIComponent(u.username) + '/password', { password: v.password }); return true; } });
    if (out) toast('Password set for ' + u.username, 'ok');
  }
  async function accessDialog(u) {
    const current = (u.projects || []).map((p) => typeof p === 'string' ? p : p.project_id);
    return dialogForm({ title: 'Project access · ' + u.username, intro: u.all_projects || ['owner', 'admin'].includes(u.role) ? 'This user already sees every project.' : 'Only granted projects are visible to this user.', fields: [{ name: 'projects', label: 'Projects', type: 'multiselect', value: current, options: ctx.projects().map((p) => ({ value: p.id, label: p.display_name })) }], onSubmit: async (v) => {
      const add = v.projects.filter((p) => !current.includes(p)); const remove = current.filter((p) => !v.projects.includes(p));
      if (!add.length && !remove.length) return true;
      try { await ctx.api.patch('/api/users/' + encodeURIComponent(u.username) + '/projects', { add, remove }); }
      catch (err) { if (err.status === 404) throw new Error('Project access is not available on this server yet.'); throw err; }
      toast('Access updated', 'ok'); return true;
    } });
  }
  load();
  if (!admin) root.appendChild(roleNote(ctx, 'admin', 'Managing users'));
  return root;
}

/* ── Integrations ─────────────────────────────────────────────────────── */
const CARDS = [
  { title: 'Meta / WhatsApp', match: (i) => i.kind === 'whatsapp_provider' },
  { title: 'Kitchen Mythos Auto', match: (i) => i.kind === 'kitchen' },
  { title: 'n8n', match: (i) => i.kind === 'n8n' },
  { title: 'AI provider', match: (i) => i.kind === 'llm' },
  { title: 'Meta WhatsApp MCP', match: (i) => i.kind === 'mcp' && /whatsapp/.test(i.key), mcp: true }
];
export function integrationsPanel(ctx, opts) {
  const root = h('div', { class: 'stack' });
  const admin = ctx.can('admin');
  const project = opts.project || null;
  if (!opts.cards) root.appendChild(h('div', { class: 'toolbar' }, h('div', { class: 'spacer' }), h('button', { class: 'btn btn-primary btn-sm', type: 'button', disabled: !admin || undefined, onClick: () => editDialog(null).then((ok) => { if (ok) load(); }) }, 'New integration')));
  const box = h('div', {}); root.appendChild(box);
  async function load() {
    clear(box); box.appendChild(skeletonRows(4));
    let r; try { r = await ctx.api.get('/api/integrations'); } catch (err) { clear(box); box.appendChild(errorBox(err, load)); return; }
    clear(box);
    let items = r.items || [];
    if (project) items = items.filter((i) => !i.project_id || i.project_id === project);
    if (!opts.cards) { box.appendChild(items.length ? h('div', { class: 'grid cols-3' }, items.map(techCard)) : empty('No integration')); return; }
    const used = {};
    const grid = h('div', { class: 'grid cols-2' });
    CARDS.forEach((c) => {
      const rows = items.filter((i) => c.match(i)); rows.forEach((i) => { used[i.key] = true; });
      grid.appendChild(simpleCard(c, rows));
    });
    box.appendChild(grid);
    const rest = items.filter((i) => !used[i.key]);
    box.appendChild(details('Advanced', [h('div', { class: 'view-actions' }, h('button', { class: 'btn btn-secondary btn-sm', type: 'button', disabled: !admin || undefined, onClick: () => editDialog(null).then((ok) => { if (ok) load(); }) }, 'New integration')), rest.length ? h('div', { class: 'grid cols-3' }, rest.map(techCard)) : h('p', { class: 'dim' }, 'No other integration.')]));
  }
  function statusOf(i) { return i.status === 'disabled' ? badge('Off', 'mock') : i.health_state === 'ok' ? badge('Connected', 'ok') : i.health_state === 'error' || i.health_state === 'disconnected' ? badge('Not reachable', 'danger') : i.credentials_state === 'missing' ? badge('Not configured', 'warn') : badge(i.health_state || 'unknown'); }
  function simpleCard(c, rows) {
    const card = h('div', { class: 'card' }, cardHead(c.title));
    if (!rows.length) { card.appendChild(h('p', { class: 'dim' }, 'Not registered on this server.')); return card; }
    if (c.mcp) { card.appendChild(mcpPanel(ctx)); if (admin) card.appendChild(h('div', { class: 'view-actions' }, h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onClick: () => editDialog(rows[0]).then((ok) => { if (ok) load(); }) }, 'Configure'))); return card; }
    rows.forEach((i) => card.appendChild(h('div', { class: 'integ-row' }, h('div', {}, h('strong', {}, i.name), h('div', { class: 'dim small' }, hostOf(i.base_url) + (i.last_checked_at ? ' · checked ' + relTime(i.last_checked_at) : ''))), h('div', { class: 'view-actions' }, statusOf(i),
      h('button', { class: 'btn btn-ghost btn-sm', type: 'button', disabled: !admin || undefined, onClick: async (e) => { e.target.disabled = true; try { const t = await ctx.api.post('/api/integrations/' + encodeURIComponent(i.key) + '/test', {}); toast(i.name + ': ' + (t.status || '?'), t.status === 'ok' ? 'ok' : 'warn', 5000); load(); } catch (err) { toast(err.detail || 'Test failed.', 'danger'); e.target.disabled = !admin; } } }, 'Test'),
      admin ? h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onClick: () => editDialog(i).then((ok) => { if (ok) load(); }) }, 'Configure') : null))));
    return card;
  }
  function techCard(i) {
    return h('div', { class: 'card' + (i.status === 'disabled' ? ' muted' : '') },
      cardHead(i.name, [statusOf(i)]),
      h('div', { class: 'chips' }, chip(i.key, 'mono'), chip(i.kind, 'mono'), i.project_id ? chip(ctx.projectName(i.project_id), 'project') : null),
      kv([['Host', h('span', { class: 'mono' }, hostOf(i.base_url))], ['Credentials', h('span', {}, badge(i.credentials_state || 'unknown'), i.credential_env ? h('code', {}, ' ' + i.credential_env) : null)], ['Last check', relTime(i.last_checked_at)], ['Last error', i.last_error ? h('span', { class: 'danger-text' }, i.last_error) : null]]),
      h('div', { class: 'view-actions' },
        h('button', { class: 'btn btn-secondary btn-sm', type: 'button', disabled: !admin || undefined, onClick: async (e) => { e.target.disabled = true; try { const t = await ctx.api.post('/api/integrations/' + encodeURIComponent(i.key) + '/test', {}); toast(i.name + ': ' + (t.status || '?') + (t.detail ? ' · ' + (typeof t.detail === 'string' ? t.detail : JSON.stringify(t.detail)) : ''), t.status === 'ok' ? 'ok' : 'warn', 6000); load(); } catch (err) { toast(err.detail || 'Test failed.', 'danger'); e.target.disabled = !admin; } } }, 'Test'),
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: () => detailsDrawer(i) }, 'Details'),
        admin ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: () => editDialog(i).then((ok) => { if (ok) load(); }) }, 'Edit') : null));
  }
  function detailsDrawer(i) {
    const d = drawer({ title: i.name, wide: true });
    d.body.append(kv([['Key', h('code', {}, i.key)], ['Kind', i.kind], ['Status', badge(i.status)], ['Base URL', i.base_url ? h('code', {}, i.base_url) : null], ['Credential env (name only)', i.credential_env ? h('code', {}, i.credential_env) : 'none required'], ['Credentials', badge(i.credentials_state || 'unknown')], ['Health', badge(i.health_state || 'unknown')], ['Health detail', i.health_detail], ['Last OK', fmtDate(i.last_ok_at)], ['Last error', i.last_error], ['Last checked', fmtDate(i.last_checked_at)]]), h('h4', {}, 'Configuration (non-secret)'), json(i.config || {}),
      ctx.can('owner') ? h('div', { class: 'view-actions' }, h('button', { class: 'btn btn-danger btn-sm', type: 'button', onClick: async () => { if (!await confirmDialog({ title: 'Delete integration ' + i.key + '?', confirmLabel: 'Delete', danger: true })) return; try { await ctx.api.del('/api/integrations/' + encodeURIComponent(i.key)); toast('Deleted', 'ok'); d.close(); load(); } catch (err) { toast(err.detail || 'Delete failed.', 'danger'); } } }, 'Delete')) : null);
  }
  function editDialog(i) {
    return dialogForm({ title: i ? 'Configure ' + i.name : 'New integration', intro: 'Never paste a secret here: only the NAME of the environment variable (or file-path variable) that holds it.', wide: true, fields: [
      { name: 'key', label: 'Key (a-z0-9-)', required: true, mono: true, value: i ? i.key : '' },
      { name: 'kind', label: 'Kind', type: 'select', required: true, value: i ? i.kind : 'api', options: ['whatsapp_provider', 'kitchen', 'n8n', 'mcp', 'api', 'project_system', 'database', 'llm'] },
      { name: 'name', label: 'Name', required: true, value: i ? i.name : '' },
      { name: 'project_id', label: 'Project (empty = platform-wide)', type: 'select', value: i ? i.project_id || '' : (project || ''), placeholder: 'platform-wide', options: ctx.projects().map((p) => ({ value: p.id, label: p.display_name })) },
      { name: 'base_url', label: 'Base URL (loopback or https)', mono: true, value: i ? i.base_url || '' : '' },
      { name: 'credential_env', label: 'Credential env var NAME', mono: true, value: i ? i.credential_env || '' : '', help: 'e.g. MYTHOS_WP_EVOLUTION_API_KEY_FILE — the value is read by the server only.' },
      { name: 'status', label: 'Status', type: 'select', required: true, value: i ? i.status : 'enabled', options: ['enabled', 'disabled'] },
      { name: 'config', label: 'Config JSON (non-secret)', type: 'json', value: i ? i.config || {} : {} }
    ], onSubmit: async (v) => {
      const body = { key: v.key.trim(), kind: v.kind, name: v.name.trim(), project_id: v.project_id || null, base_url: v.base_url.trim() || null, credential_env: v.credential_env.trim() || null, status: v.status, config: v.config || {} };
      if (i) { delete body.key; await ctx.api.patch('/api/integrations/' + encodeURIComponent(i.key), body); } else await ctx.api.post('/api/integrations', body);
      toast('Integration saved', 'ok'); return true;
    } });
  }
  load();
  if (!admin) root.appendChild(roleNote(ctx, 'admin', 'Testing or configuring integrations'));
  return root;
}

/* ── Automations ──────────────────────────────────────────────────────── */
const TRIGGERS = ['conversation.created', 'message.received', 'conversation.inactive', 'handoff.requested'];
const ACTIONS = ['assign_agent', 'assign_user', 'tag', 'set_status', 'handoff', 'ai_suggest', 'ai_reply', 'n8n_webhook', 'note'];
const ACTION_PARAM = { assign_agent: ['agent_id', 'agent id or "project_default"'], assign_user: ['username', 'username'], tag: ['name', 'tag name'], set_status: ['status', 'open | pending | waiting_customer | needs_human | resolved'], handoff: ['reason', 'reason code'], n8n_webhook: ['path', 'webhook path'], note: ['text', 'note text'] };

export function automationsPanel(ctx, opts) {
  const root = h('div', { class: 'stack' });
  const admin = ctx.can('admin');
  let project = opts.project || 'all';
  const picker = h('select', { class: 'select', 'aria-label': 'Project' }, h('option', { value: 'all' }, 'All projects'), ctx.projects().map((p) => h('option', { value: p.id, selected: p.id === project || undefined }, p.display_name)));
  picker.onchange = () => { project = picker.value; load(); };
  root.appendChild(h('div', { class: 'toolbar' }, opts.fixed ? null : picker, h('div', { class: 'spacer' }), h('button', { class: 'btn btn-primary btn-sm', type: 'button', disabled: !admin || undefined, onClick: () => editor(null) }, 'New automation')));
  const box = h('div', {}); root.appendChild(box);
  const recent = h('div', { class: 'card' }); root.appendChild(recent);
  async function load() {
    clear(box); box.appendChild(skeletonRows(4));
    let r; try { r = await ctx.api.get('/api/automations' + ctx.api.qs({ project })); } catch (err) { clear(box); box.appendChild(errorBox(err, load)); clear(recent); return; }
    clear(box);
    const items = r.items || [];
    if (!items.length) box.appendChild(empty('No automation', 'Defaults are seeded by the server.'));
    else box.appendChild(simpleTable([
      { label: 'On', cell: (a) => a.enabled !== undefined ? switchInput({ checked: a.enabled, disabled: !admin, small: true, onChange: async (v) => { await ctx.api.post('/api/automations/' + a.id + '/' + (v ? 'enable' : 'disable'), {}); toast(v ? 'Enabled' : 'Disabled', 'ok', 1800); } }) : null, stop: true },
      { label: 'Name', cell: (a) => h('strong', {}, a.name) },
      { label: 'Scope', cell: (a) => a.project_id ? chip(ctx.projectName(a.project_id), 'project') : badge('global', 'accent') },
      { label: 'Trigger', cell: (a) => h('code', {}, a.trigger) },
      { label: 'Conditions', cell: (a) => condText(a.conditions), cls: 'dim' },
      { label: 'Actions', cell: (a) => h('div', { class: 'chips' }, (a.actions || []).map((x) => chip(x.type + paramText(x), 'mono'))) },
      { label: '', stop: true, cell: (a) => h('div', { class: 'row-actions' }, h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: () => runsDrawer(a) }, 'Runs'), admin ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: () => editor(a) }, 'Edit') : null, admin ? h('button', { class: 'btn btn-ghost btn-sm danger', type: 'button', onClick: async () => { if (!await confirmDialog({ title: 'Delete "' + a.name + '"?', confirmLabel: 'Delete', danger: true })) return; try { await ctx.api.del('/api/automations/' + a.id); toast('Deleted', 'ok'); load(); } catch (err) { toast(err.detail || 'Delete failed.', 'danger'); } } }, 'Delete') : null) }
    ], items, { noScroll: true, onRow: runsDrawer }));
    loadRecent();
  }
  function condText(c) { c = c || {}; const parts = []; if (c.keywords && c.keywords.length) parts.push('keywords: ' + c.keywords.join(', ')); if (c.inactive_minutes) parts.push('inactive ≥ ' + c.inactive_minutes + ' min'); if (c.handler) parts.push('handler = ' + c.handler); if (c.status) parts.push('status = ' + c.status); if (c.inbox_id) parts.push('inbox #' + c.inbox_id); return parts.join(' · ') || 'always'; }
  function paramText(x) { const p = ACTION_PARAM[x.type]; if (!p) return ''; const v = x[p[0]] !== undefined ? x[p[0]] : (x.params && x.params[p[0]]); return v !== undefined && v !== null && v !== '' ? ' ' + v : ''; }
  async function loadRecent() {
    clear(recent); recent.appendChild(cardHead('Recent runs')); const b = h('div', {}, skeletonRows(2)); recent.appendChild(b);
    let r; try { r = await ctx.api.get('/api/automation-runs' + ctx.api.qs({ project, limit: 50 })); } catch (err) { clear(b); b.appendChild(errorBox(err)); return; }
    clear(b); const items = r.items || [];
    if (!items.length) { b.appendChild(h('p', { class: 'dim' }, 'No run yet.')); return; }
    b.appendChild(runsTable(items));
  }
  function runsTable(items) {
    return simpleTable([
      { label: 'When', cell: (x) => relTime(x.at), cls: 'dim' }, { label: 'Automation', cell: (x) => x.automation_name || (x.automation_id ? '#' + x.automation_id : '—') }, { label: 'Project', cell: (x) => x.project_id ? chip(ctx.projectName(x.project_id), 'project') : null }, { label: 'Trigger', cell: (x) => h('code', {}, x.trigger) }, { label: 'Result', cell: (x) => badge(x.result) }, { label: 'Conversation', cell: (x) => x.conversation_id ? h('a', { href: '#/inbox/' + x.conversation_id + (x.project_id ? '?project=' + encodeURIComponent(x.project_id) : '') }, '#' + x.conversation_id) : null }, { label: 'Detail', cell: (x) => x.detail ? h('span', { class: 'clamp' }, JSON.stringify(x.detail)) : null, cls: 'dim' }
    ], items, { compact: true, noScroll: true });
  }
  async function runsDrawer(a) {
    const d = drawer({ title: 'Runs · ' + a.name, wide: true });
    d.body.appendChild(kv([['Trigger', h('code', {}, a.trigger)], ['Conditions', json(a.conditions || {})], ['Actions', json(a.actions || [])]]));
    const b = h('div', {}, skeletonRows(3)); d.body.appendChild(b);
    try { const r = await ctx.api.get('/api/automations/' + a.id + '/runs'); clear(b); const items = r.items || []; b.appendChild(items.length ? runsTable(items) : h('p', { class: 'dim' }, 'No run yet.')); } catch (err) { clear(b); b.appendChild(errorBox(err)); }
  }
  function editor(a) {
    const d = drawer({ title: a ? 'Edit automation' : 'New automation', wide: true });
    const c = (a && a.conditions) || {};
    const name = h('input', { class: 'input', value: a ? a.name : '', 'aria-label': 'Name', required: true });
    const scope = h('select', { class: 'select', 'aria-label': 'Scope' }, h('option', { value: '' }, 'Global (every project)'), ctx.projects().map((p) => h('option', { value: p.id, selected: (a ? a.project_id === p.id : project === p.id) || undefined }, p.display_name)));
    const trig = h('select', { class: 'select', 'aria-label': 'Trigger' }, TRIGGERS.map((t) => h('option', { value: t, selected: (a ? a.trigger === t : t === 'message.received') || undefined }, t)));
    const kw = h('input', { class: 'input', value: (c.keywords || []).join(', '), placeholder: 'human, humain, agent', 'aria-label': 'Keywords' });
    const inactive = h('input', { class: 'input', type: 'number', min: 1, step: 1, value: c.inactive_minutes || '', 'aria-label': 'Inactive minutes' });
    const handler = h('select', { class: 'select', 'aria-label': 'Handler condition' }, h('option', { value: '' }, 'any handler'), ['ai', 'human'].map((x) => h('option', { value: x, selected: c.handler === x || undefined }, x)));
    const status = h('input', { class: 'input', value: c.status || '', placeholder: 'e.g. open', 'aria-label': 'Status condition' });
    const position = h('input', { class: 'input', type: 'number', step: 1, value: a && a.position !== undefined ? a.position : 100, 'aria-label': 'Position' });
    const enabled = h('input', { type: 'checkbox' }); enabled.checked = a ? a.enabled !== false : true;
    const actionsEl = h('div', { class: 'stack sm' });
    const rows = [];
    function addAction(x) {
      const type = h('select', { class: 'select', 'aria-label': 'Action type' }, ACTIONS.map((t) => h('option', { value: t, selected: (x && x.type === t) || undefined }, t)));
      const param = h('input', { class: 'input', 'aria-label': 'Parameter' });
      const extra = h('label', { class: 'check' }, h('input', { type: 'checkbox' }), 'include text');
      function refresh() { const p = ACTION_PARAM[type.value]; param.hidden = !p; param.placeholder = p ? p[1] : ''; extra.hidden = type.value !== 'n8n_webhook'; }
      type.onchange = refresh;
      if (x) { const p = ACTION_PARAM[x.type]; if (p) param.value = x[p[0]] !== undefined ? x[p[0]] : (x.params && x.params[p[0]]) || ''; if (x.include_text) extra.querySelector('input').checked = true; }
      refresh();
      const row = h('div', { class: 'action-row' }, type, param, extra, h('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'aria-label': 'Remove action', onClick: () => { actionsEl.removeChild(row); rows.splice(rows.indexOf(entry), 1); } }, '×'));
      const entry = { type, param, extra };
      rows.push(entry); actionsEl.appendChild(row);
    }
    ((a && a.actions) || []).forEach(addAction);
    if (!a) addAction({ type: 'ai_suggest' });
    const err = h('p', { class: 'error', hidden: true, role: 'alert' });
    const save = h('button', { class: 'btn btn-primary', type: 'button', onClick: async () => {
      err.hidden = true;
      if (!name.value.trim()) { err.textContent = 'Name is required.'; err.hidden = false; return; }
      const conditions = {};
      const kws = kw.value.split(',').map((s) => s.trim()).filter(Boolean); if (kws.length) conditions.keywords = kws;
      if (inactive.value) conditions.inactive_minutes = parseInt(inactive.value, 10);
      if (handler.value) conditions.handler = handler.value;
      if (status.value.trim()) conditions.status = status.value.trim();
      const actions = rows.map((r) => { const o = { type: r.type.value }; const p = ACTION_PARAM[o.type]; if (p && r.param.value.trim()) o[p[0]] = r.param.value.trim(); if (o.type === 'n8n_webhook' && r.extra.querySelector('input').checked) o.include_text = true; return o; });
      if (!actions.length) { err.textContent = 'At least one action.'; err.hidden = false; return; }
      const body = { name: name.value.trim(), project_id: scope.value || null, trigger: trig.value, conditions, actions, enabled: enabled.checked, position: parseInt(position.value, 10) || 100 };
      save.disabled = true;
      try { if (a) await ctx.api.patch('/api/automations/' + a.id, body); else await ctx.api.post('/api/automations', body); toast('Automation saved', 'ok'); d.close(); load(); }
      catch (e) { err.textContent = e.detail || e.message || 'Save failed.'; err.hidden = false; }
      finally { save.disabled = false; }
    } }, a ? 'Save changes' : 'Create automation');
    d.body.append(
      h('div', { class: 'field-row' }, field('Name', name), field('Scope', scope), field('Trigger', trig), field('Position (lower runs first)', position)),
      h('h4', {}, 'Conditions'), h('div', { class: 'field-row' }, field('Keywords (comma list, inbound text contains)', kw), field('Inactive minutes (conversation.inactive)', inactive), field('Handler', handler), field('Status', status)),
      h('h4', {}, 'Actions (in order)'), actionsEl, h('div', {}, h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onClick: () => addAction(null) }, '+ Add action')),
      h('label', { class: 'check' }, enabled, 'Enabled'), err, h('div', { class: 'dialog-foot' }, h('button', { class: 'btn btn-secondary', type: 'button', onClick: () => d.close() }, 'Cancel'), save));
  }
  function field(label, c) { return h('div', { class: 'field' }, h('label', {}, label), c); }
  load();
  if (opts.openNew && admin) editor(null);
  if (!admin) root.appendChild(roleNote(ctx, 'admin', 'Editing automations'));
  return root;
}

/* ── System: health rows, audit, backup, AI runs ───────────────────────── */
function systemPanel(ctx, query) {
  const root = h('div', { class: 'stack' });
  root.appendChild(healthCard(ctx));
  root.appendChild(h('div', { class: 'card', id: 'audit' }, cardHead('Audit'), auditPanel(ctx, { query: qget(query, 'sub') === 'audit' ? query : '', prefKey: 'audit-v2' })));
  root.appendChild(h('div', { class: 'card' }, cardHead('Backup'),
    h('p', {}, 'The database (customer conversations included) is dumped with pg_dump from the idauto-postgres container into /var/backups/mythos-db. It is not part of the scheduled multi-database backup: the rollout script takes a dump before every migration, and the owner runs one by hand before any risky change.'),
    codeBlock('docker exec idauto-postgres pg_dump -U idauto -Fc mythos_wp > /var/backups/mythos-db/mythos_wp-$STAMP.dump\nsha256sum /var/backups/mythos-db/mythos_wp-$STAMP.dump > /var/backups/mythos-db/mythos_wp-$STAMP.dump.sha256', 'backup command'),
    kv([['Last known dump', h('code', {}, 'mythos_wp-v2-pre-20260917T123551Z.dump')], ['Restore', 'pg_restore --clean --if-exists into mythos_wp, unit stopped first (docs/DEPLOYMENT.md)'], ['Not in any dump', '.env, users.json, webhook.token — backed up separately by the owner']])));
  root.appendChild(runsPanel(ctx, { project: ctx.project() }));
  return root;
}

const TONE = { ok: 'ok', warning: 'warn', error: 'danger', disconnected: 'danger' };
function healthCard(ctx) {
  const manager = ctx.can('manager');
  const card = h('div', { class: 'card' });
  const box = h('div', {}, skeletonRows(4));
  const runBtn = h('button', { class: 'btn btn-secondary btn-sm', type: 'button', disabled: !manager || undefined, title: manager ? 'Run every check now' : 'Requires the manager role', onClick: async () => {
    runBtn.disabled = true; runBtn.textContent = 'Running…';
    try { const d = await ctx.api.post('/api/health/run', {}); toast('Checks ran.', 'ok'); show(d); }
    catch (err) { toast(err.status === 404 ? 'Running checks is not available yet.' : (err.detail || 'Run failed.'), 'danger', 5000); }
    finally { runBtn.disabled = !manager; runBtn.textContent = 'Run checks'; }
  } }, 'Run checks');
  card.append(cardHead('Health', [runBtn]), box);
  function detailText(d) { if (!d) return ''; if (typeof d === 'string') return d; return d.reason || d.detail || Object.keys(d).map((k) => k + ': ' + (typeof d[k] === 'object' ? JSON.stringify(d[k]) : d[k])).join(' · '); }
  function show(d) {
    clear(box);
    const comps = d.components || [];
    if (!comps.length) { box.appendChild(empty('No check yet', manager ? 'Run the checks now.' : 'Checks run on the server schedule.')); return; }
    box.appendChild(simpleTable([
      { label: 'Component', cell: (c) => h('span', { class: 'mono' }, c.component) },
      { label: 'Status', cell: (c) => badge((c.status || 'unknown'), TONE[c.status] || 'mock') },
      { label: 'Detail', cell: (c) => h('span', { class: 'clamp', title: detailText(c.detail) }, detailText(c.detail)), cls: 'dim' },
      { label: 'Last check', cell: (c) => relTime(c.checked_at), cls: 'dim' }
    ], comps, { compact: true, noScroll: true }));
  }
  ctx.api.get('/api/health/center').then(show, (err) => { clear(box); box.appendChild(errorBox(err)); });
  return card;
}

export function auditPanel(ctx, opts) {
  const r = ctx.resources().audit;
  if (!r) return empty('Audit is not available on this server.');
  const root = h('div', { class: 'stack sm' });
  const state = stateFromQuery(opts.query || '');
  let project = opts.project || new URLSearchParams(opts.query || '').get('project') || (ctx.isAll() ? '' : ctx.project());
  const projSel = h('select', { class: 'select', 'aria-label': 'Project filter' }, h('option', { value: '' }, 'Any project'), ctx.projects().map((p) => h('option', { value: p.id, selected: project === p.id || undefined }, p.display_name)));
  const actorIn = h('input', { class: 'input', placeholder: 'who', 'aria-label': 'Actor filter', value: state.filters.actor || '' });
  const actionIn = h('input', { class: 'input', placeholder: 'action', 'aria-label': 'Action filter', value: state.filters.action || '' });
  const resIn = h('input', { class: 'input', placeholder: 'what', 'aria-label': 'Resource filter', value: state.filters.resource || '' });
  let table;
  function apply() {
    const fl = Object.assign({}, table.state.filters);
    const set = (k, v) => { if (v) fl[k] = v; else delete fl[k]; };
    set('actor', actorIn.value.trim()); set('action', actionIn.value.trim()); set('resource', resIn.value.trim()); if (!opts.project) project = projSel.value;
    table.state.filters = fl; table.state.page = 1; table.reload();
  }
  [actorIn, actionIn, resIn].forEach((el) => { el.onkeydown = (e) => { if (e.key === 'Enter') apply(); }; });
  projSel.onchange = apply;
  root.appendChild(h('div', { class: 'toolbar audit-filters' }, actorIn, actionIn, resIn, opts.project ? null : projSel, h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onClick: apply }, 'Filter')));
  table = dataTable({ resource: r, state, prefKey: opts.prefKey || 'audit-v2', fetchPage: (st) => ctx.api.get('/api/r/audit' + apiQuery(st, { project: project || undefined })), onRow: (e) => {
    const d = drawer({ title: (e.action || 'event') + ' · ' + (e.resource || '') + (e.record_id ? ' #' + e.record_id : ''), wide: true });
    d.body.append(kv([['When', fmtDate(e.at)], ['Actor', h('span', {}, e.actor, ' ', badge(e.actor_role))], ['Action', badge(e.action)], ['Resource', e.resource], ['Record', e.record_id ? h('code', {}, e.record_id) : null], ['Project', e.project_id ? ctx.projectName(e.project_id) : null], ['Changed fields', (e.changed_fields || []).join(', ')], ['Request', e.request_id ? h('code', {}, e.request_id) : null]]),
      h('div', { class: 'grid cols-2' }, h('div', {}, h('h4', {}, 'Previous'), json(e.previous)), h('div', {}, h('h4', {}, 'Next'), json(e.next))));
  } });
  root.appendChild(table.el);
  return root;
}
