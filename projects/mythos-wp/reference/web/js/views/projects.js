/* MYTHOS Control Center — Projects: list and the project page with tabs
   (overview, numbers, agents, integrations, members, settings, catalogue
   (Kitchen, automotive only), audit). */
import { h, clear, badge, fmtDate, relTime, skeletonRows, errorBox, empty, toast, tabs, chip, kv, pageHead, cardHead, simpleTable, dialogForm, drawer, qget, setQuery, roleNote, json } from '../ui.js';
import { numbersPanel } from './whatsapp.js';
import { agentsPanel } from './ai.js';
import { integrationsPanel } from './integrations.js';
import { usersPanel } from './settings.js';
import { dataTable, apiQuery } from '../table.js';

export async function render(main, params, query, ctx) {
  ctx.crumbs([{ label: 'Projects' }]);
  main.appendChild(pageHead('Tenants', 'Projects', 'Every business the Control Center serves: its numbers, agents, integrations, members and (for automotive projects) the Kitchen catalogue it reads.', [ctx.can('admin') ? h('a', { class: 'btn btn-primary', href: '#/r/projects/new' }, 'New project') : null]));
  const box = h('div', {}, skeletonRows(3)); main.appendChild(box);
  let rows = ctx.projects().map((p) => Object.assign({}, p));
  try { const r = await ctx.api.get('/api/r/projects?limit=200&sort=id&dir=asc'); const by = {}; r.rows.forEach((x) => { by[x.id] = x; }); rows = rows.map((p) => Object.assign({}, by[p.id] || {}, p)); r.rows.forEach((x) => { if (!rows.some((p) => p.id === x.id)) rows.push(x); }); } catch (err) { /* meta rows suffice */ }
  clear(box);
  if (!rows.length) { box.appendChild(empty('No project', 'Create the first project.', ctx.can('admin') ? h('a', { class: 'btn btn-primary', href: '#/r/projects/new' }, 'New project') : null)); return; }
  box.appendChild(h('div', { class: 'grid cols-3' }, rows.map((p) => h('a', { class: 'card link project-card', href: '#/projects/' + encodeURIComponent(p.id) },
    cardHead(p.display_name, [badge(p.status)]),
    h('div', { class: 'chips' }, chip(p.kind || 'service'), p.domain ? chip(p.domain, 'mono') : null, chip(p.currency || 'TND')),
    h('p', {}, p.description || p.notes || 'No description.'),
    h('div', { class: 'dim small' }, 'id ' + p.id + (p.settings && p.settings.kitchen ? ' · kitchen ' + p.settings.kitchen : '') + ' · updated ' + relTime(p.updated_at))))));
}

const TABS = [{ key: 'overview', label: 'Overview' }, { key: 'numbers', label: 'Numbers' }, { key: 'agents', label: 'Agents' }, { key: 'integrations', label: 'Integrations' }, { key: 'members', label: 'Members' }, { key: 'settings', label: 'Settings' }, { key: 'catalogue', label: 'Catalogue' }, { key: 'audit', label: 'Audit' }];

export async function renderOne(main, params, query, ctx) {
  const id = params.id;
  ctx.crumbs([{ label: 'Projects', href: '#/projects' }, { label: id }]);
  const box = h('div', { class: 'stack' }, skeletonRows(4)); main.appendChild(box);
  let row;
  try { row = (await ctx.api.get('/api/r/projects/' + encodeURIComponent(id))).row; } catch (err) { clear(box); box.appendChild(errorBox(err)); return; }
  clear(box);
  ctx.crumbs([{ label: 'Projects', href: '#/projects' }, { label: row.display_name }]);
  const automotive = (row.kind || 'service') === 'automotive';
  const tabList = TABS.filter((t) => t.key !== 'catalogue' || automotive);
  let tab = qget(query, 'tab', 'overview'); if (!tabList.some((t) => t.key === tab)) tab = 'overview';
  main.insertBefore(pageHead(row.kind + (row.domain ? ' · ' + row.domain : ''), row.display_name, row.description || row.notes || '', [badge(row.status), h('a', { class: 'btn btn-ghost', href: '#/projects' }, 'All projects'), h('button', { class: 'btn btn-secondary', type: 'button', onClick: () => { ctx.setProject(row.id); location.hash = '#/inbox'; } }, 'Open inbox')]), box);
  const bar = tabs(tabList, tab, (k) => { tab = k; setQuery('#/projects/' + encodeURIComponent(id), { tab: k }); show(); });
  box.appendChild(bar.el);
  const body = h('div', { class: 'tab-body' }); box.appendChild(body);
  function show() {
    clear(body);
    if (tab === 'overview') body.appendChild(overview(ctx, row));
    else if (tab === 'numbers') body.appendChild(numbersPanel(ctx, { project: row.id }));
    else if (tab === 'agents') body.appendChild(agentsPanel(ctx, { project: row.id }));
    else if (tab === 'integrations') body.appendChild(integrationsPanel(ctx, { project: row.id }));
    else if (tab === 'members') body.appendChild(usersPanel(ctx, { project: row.id }));
    else if (tab === 'settings') body.appendChild(settingsTab(ctx, row, () => renderOne(clear(main), params, query, ctx)));
    else if (tab === 'catalogue') body.appendChild(catalogueTab(ctx, row));
    else if (tab === 'audit') body.appendChild(auditTab(ctx, row));
  }
  show();
}

function overview(ctx, row) {
  const root = h('div', { class: 'stack' });
  root.appendChild(h('div', { class: 'grid cols-2' },
    h('div', { class: 'card' }, cardHead('Project'), kv([['Id', h('code', {}, row.id)], ['Kind', badge(row.kind)], ['Status', badge(row.status)], ['Domain', row.domain], ['Currency', row.currency], ['Kitchen', row.settings && row.settings.kitchen ? h('code', {}, row.settings.kitchen) : (row.kind === 'automotive' ? badge('not set', 'warn') : '—')], ['Created', fmtDate(row.created_at)], ['Updated', fmtDate(row.updated_at)]])),
    h('div', { class: 'card' }, cardHead('Quick links'), h('div', { class: 'view-actions wrap' }, h('a', { class: 'btn btn-secondary btn-sm', href: '#/inbox?project=' + encodeURIComponent(row.id) }, 'Inbox'), h('a', { class: 'btn btn-secondary btn-sm', href: '#/contacts?project=' + encodeURIComponent(row.id) }, 'Contacts'), h('a', { class: 'btn btn-secondary btn-sm', href: '#/projects/' + encodeURIComponent(row.id) + '?tab=numbers' }, 'Numbers'), h('a', { class: 'btn btn-secondary btn-sm', href: '#/automations' }, 'Automations'), h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onClick: () => { ctx.setProject(row.id); location.hash = '#/r/knowledge'; } }, 'Knowledge'), h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onClick: () => { ctx.setProject(row.id); location.hash = '#/r/rules'; } }, 'Business rules')))));
  const stats = h('div', { class: 'stack' }, skeletonRows(2)); root.appendChild(stats);
  ctx.api.get('/api/dashboard' + ctx.api.qs({ project: row.id })).then((d) => {
    clear(stats);
    const w = d.whatsapp || {}, a = d.ai || {};
    const tile = (l, v, href) => h(href ? 'a' : 'div', { class: 'card stat link', href }, h('span', { class: 'stat-label' }, l), h('span', { class: 'stat-value' + (v === undefined || v === null ? ' na' : '') }, v === undefined || v === null ? 'n/a' : String(v)));
    const pq = '&project=' + encodeURIComponent(row.id);
    stats.appendChild(h('div', { class: 'grid cols-4' }, tile('Conversations', w.conversations, '#/inbox?view=all' + pq), tile('Unread', w.unread, '#/inbox?view=unread' + pq), tile('AI handled', w.ai, '#/inbox?view=ai' + pq), tile('Needs attention', w.needs_attention, '#/inbox?view=attention' + pq), tile('Active agents', a.active_agents, '#/projects/' + encodeURIComponent(row.id) + '?tab=agents'), tile('AI runs 24 h', a.handled_24h, '#/ai?tab=runs'), tile('Handoffs 24 h', a.handoffs_24h), tile('AI errors 24 h', a.errors_24h)));
    if ((d.alerts || []).length) stats.appendChild(h('div', { class: 'card' }, cardHead('Alerts'), h('div', { class: 'alert-list' }, d.alerts.map((x) => h('div', { class: 'alert ' + (x.level || 'warning') }, badge(x.level || 'warning'), h('strong', {}, x.component || ''), h('span', {}, x.message || ''), h('span', { class: 'when' }, relTime(x.at)))))));
  }, (err) => { clear(stats); stats.appendChild(errorBox(err)); });
  return root;
}

function settingsTab(ctx, row, reload) {
  const admin = ctx.can('admin');
  const root = h('div', { class: 'card' }, cardHead('Project settings', [admin ? h('button', { class: 'btn btn-primary btn-sm', type: 'button', onClick: edit }, 'Edit') : null, h('a', { class: 'btn btn-ghost btn-sm', href: '#/r/projects/' + encodeURIComponent(row.id) + '/edit' }, 'Full record editor')]),
    kv([['Name', row.display_name], ['Domain', row.domain], ['Kind', badge(row.kind)], ['Status', badge(row.status)], ['Description', row.description], ['Currency', row.currency], ['Kitchen integration key', row.settings && row.settings.kitchen ? h('code', {}, row.settings.kitchen) : null], ['Other settings', row.settings && Object.keys(row.settings).filter((k) => k !== 'kitchen').length ? json(row.settings) : null]]), roleNote(ctx, 'admin', 'Editing the project'));
  async function edit() {
    const kitchens = await ctx.api.get('/api/integrations').then((r) => (r.items || []).filter((i) => i.kind === 'kitchen').map((i) => ({ value: i.key, label: i.name + ' (' + i.key + ')' })), () => []);
    const out = await dialogForm({ title: 'Edit ' + row.display_name, fields: [
      { name: 'display_name', label: 'Name', required: true, value: row.display_name },
      { name: 'domain', label: 'Domain', value: row.domain || '' },
      { name: 'kind', label: 'Kind', type: 'select', required: true, value: row.kind || 'service', options: ['automotive', 'service', 'internal', 'other'] },
      { name: 'status', label: 'Status', type: 'select', required: true, value: row.status, options: ['active', 'planned', 'archived'] },
      { name: 'currency', label: 'Currency (ISO 3)', required: true, mono: true, value: row.currency || 'TND', maxLength: 3 },
      { name: 'description', label: 'Description', type: 'textarea', rows: 3, value: row.description || '' },
      { name: 'kitchen', label: 'Kitchen (automotive: which Kitchen integration this project reads)', type: kitchens.length ? 'select' : 'text', value: row.settings && row.settings.kitchen || '', options: kitchens, placeholder: 'none', mono: true, help: 'Integration key, e.g. kitchen-mythos-auto.' }
    ], onSubmit: async (v) => {
      const settings = Object.assign({}, row.settings || {}); if (v.kitchen) settings.kitchen = v.kitchen; else delete settings.kitchen;
      await ctx.api.patch('/api/r/projects/' + encodeURIComponent(row.id), { display_name: v.display_name.trim(), domain: v.domain.trim() || null, kind: v.kind, status: v.status, description: v.description.trim() || null, currency: v.currency.trim().toUpperCase(), settings });
      toast('Project saved', 'ok'); ctx.refreshMeta(); return true;
    } });
    if (out) reload();
  }
  return root;
}

function catalogueTab(ctx, row) {
  const root = h('div', { class: 'stack' });
  const base = '/api/projects/' + encodeURIComponent(row.id) + '/kitchen';
  root.appendChild(h('div', { class: 'notice accent' }, h('strong', {}, 'Kitchen Mythos Auto (read-only, external). '), 'Products, vehicles and quotes come from the project\'s Kitchen service; this panel never writes to it.'));
  const desc = h('div', { class: 'card' }, cardHead('Kitchen'), skeletonRows(2)); root.appendChild(desc);
  ctx.api.get(base + '/describe').then((d) => {
    clear(desc); desc.appendChild(cardHead('Kitchen', [badge(d.configured === false ? 'not configured' : (d.ok === false ? (d.kind || 'unreachable') : 'reachable'), d.configured === false ? 'warn' : d.ok === false ? 'danger' : 'ok')]));
    if (d.configured === false) desc.appendChild(h('p', {}, 'No Kitchen integration is set on this project (Settings → Kitchen).'));
    else desc.appendChild(kv([['Contract', d.contract || d.version || '—'], ['Base host', d.base_url_host || d.host || '—'], ['Health', d.health ? json(d.health) : (d.ok === false ? d.kind : 'ok')], ['Capabilities', d.capabilities ? h('div', { class: 'chips' }, Object.keys(d.capabilities).map((k) => chip(k + (d.capabilities[k] ? ' ✓' : ' ✗')))) : null]]));
  }, (err) => { clear(desc); desc.appendChild(errorBox(err)); });
  // product search
  const q = h('input', { class: 'input', type: 'search', placeholder: 'Search products (reference, title, brand)…', 'aria-label': 'Search products' });
  const list = h('div', {}); root.appendChild(h('div', { class: 'card' }, cardHead('Products'), h('div', { class: 'toolbar' }, h('div', { class: 'search' }, q)), list));
  let t = null; q.oninput = () => { clearTimeout(t); t = setTimeout(load, 300); };
  async function load() {
    clear(list); list.appendChild(skeletonRows(4));
    let r; try { r = await ctx.api.get(base + '/products' + ctx.api.qs({ q: q.value.trim(), limit: 50 })); } catch (err) { clear(list); list.appendChild(errorBox(err, load)); return; }
    clear(list);
    const items = r.items || r.products || r.rows || [];
    if (!items.length) { list.appendChild(empty('No product', q.value ? 'Nothing matches.' : 'Type to search the Kitchen catalogue.')); return; }
    list.appendChild(simpleTable([
      { label: 'Reference', cell: (p) => h('code', {}, p.reference || p.canonical_reference || p.ref || '—') },
      { label: 'Title', cell: (p) => p.title || p.product_title || p.name },
      { label: 'Brand', cell: (p) => p.brand || p.product_brand },
      { label: 'Category', cell: (p) => p.category },
      { label: 'Price', cell: (p) => p.price !== undefined && p.price !== null ? String(p.price) + ' ' + (p.currency || row.currency || '') : null, cls: 'num' },
      { label: 'Availability', cell: (p) => p.availability ? badge(p.availability) : null }
    ], items, { onRow: (p) => detail(p.uid || p.product_uid || p.id) }));
    list.appendChild(h('p', { class: 'dim' }, h('small', {}, items.length + ' shown' + (r.total !== undefined ? ' of ' + r.total : ''))));
  }
  async function detail(uid) {
    const d = drawer({ title: 'Product ' + uid, wide: true });
    d.body.appendChild(skeletonRows(4));
    try { const p = await ctx.api.get(base + '/products/' + encodeURIComponent(uid)); clear(d.body); const item = p.item || p.product || p; d.body.append(h('p', { class: 'dim' }, 'Read-only view of the Kitchen record.'), json(item)); }
    catch (err) { clear(d.body); d.body.appendChild(errorBox(err)); }
  }
  load();
  return root;
}

function auditTab(ctx, row) {
  const r = ctx.resources().audit;
  if (!r) return empty('Audit resource unavailable');
  const table = dataTable({ resource: r, prefKey: 'audit-project', state: { filters: {} }, fetchPage: (st) => ctx.api.get('/api/r/audit' + apiQuery(st, { project: row.id })), onRow: (e) => { const d = drawer({ title: (e.action || '') + ' · ' + (e.resource || ''), wide: true }); d.body.append(kv([['When', fmtDate(e.at)], ['Actor', e.actor], ['Record', e.record_id], ['Changed', (e.changed_fields || []).join(', ')]]), h('div', { class: 'grid cols-2' }, h('div', {}, h('h4', {}, 'Previous'), json(e.previous)), h('div', {}, h('h4', {}, 'Next'), json(e.next)))); } });
  return table.el;
}
