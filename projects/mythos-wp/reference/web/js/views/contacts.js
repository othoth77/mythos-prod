/* MYTHOS Control Center — Contacts: cross-project 360 list and the 360 page
   (identity, per-project cards, conversations, timeline, AI/human counts, notes). */
import { h, clear, badge, handlerBadge, fmtDate, relTime, skeletonRows, errorBox, empty, toast, chip, kv, pageHead, cardHead, simpleTable, qget, setQuery, dialogForm, roleNote } from '../ui.js';

function contactKey(it) { return it.phone || it.phone_ref || it.wa_id || it.key || (it.phone_masked ? String(it.phone_masked).replace(/\D/g, '') : ''); }

export async function render(main, params, query, ctx) {
  ctx.crumbs([{ label: 'Contacts' }]);
  const f = { q: qget(query, 'q'), project: qget(query, 'project', ctx.isAll() ? '' : ctx.project()) };
  main.appendChild(pageHead('Customers', 'Contacts', 'One identity per phone number across every project you can access. Numbers are masked in lists; the 360 page joins projects, conversations, AI and human interactions.'));
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Search name or number', 'aria-label': 'Search contacts', value: f.q });
  const projSel = h('select', { class: 'select', 'aria-label': 'Project' }, h('option', { value: '' }, 'All projects'), ctx.projects().map((p) => h('option', { value: p.id, selected: p.id === f.project || undefined }, p.display_name)));
  main.appendChild(h('div', { class: 'toolbar' }, h('div', { class: 'search' }, search), projSel));
  const box = h('div', { class: 'stack' }); main.appendChild(box);
  let t = null; search.oninput = () => { clearTimeout(t); t = setTimeout(() => { f.q = search.value.trim(); sync(); load(); }, 250); };
  projSel.onchange = () => { f.project = projSel.value; sync(); load(); };
  function sync() { setQuery('#/contacts', f); }
  async function load() {
    clear(box); box.appendChild(skeletonRows(6));
    let r;
    try { r = await ctx.api.get('/api/contacts' + ctx.api.qs({ q: f.q, project: f.project || 'all', limit: 200 })); }
    catch (err) { clear(box); box.appendChild(errorBox(err, load)); if (err.status === 404) box.appendChild(await legacyList(ctx, f)); return; }
    clear(box);
    const items = r.items || [];
    if (!items.length) { box.appendChild(empty('No contact', f.q ? 'Nothing matches the search.' : 'Contacts appear once customers write to a linked number.')); return; }
    box.appendChild(simpleTable([
      { label: 'Contact', cell: (k) => h('a', { href: '#/contacts/360/' + encodeURIComponent(contactKey(k)) }, k.display_name || k.phone_masked || '—') },
      { label: 'Number', cell: (k) => h('span', { class: 'mono' }, k.phone_masked || '—') },
      { label: 'Projects', cell: (k) => h('span', { class: 'chips' }, (k.projects || []).map((p) => chip(ctx.projectName(p.project_id), 'project'))) },
      { label: 'Conversations', cell: (k) => String(k.conversations === undefined ? '—' : k.conversations), cls: 'num' },
      { label: 'Tags', cell: (k) => h('span', { class: 'chips' }, (k.tags || []).map((x) => chip(x, 'tag'))) },
      { label: 'Last seen', cell: (k) => relTime(k.last_seen_at), cls: 'dim' }
    ], items, { onRow: (k) => { location.hash = '#/contacts/360/' + encodeURIComponent(contactKey(k)); } }));
    box.appendChild(h('p', { class: 'dim' }, h('small', {}, items.length + ' contact' + (items.length === 1 ? '' : 's'))));
  }
  await load();
}

/* Until /api/contacts exists: per-project lists merged client-side (same masked identity). */
async function legacyList(ctx, f) {
  const ids = f.project ? [f.project] : ctx.projects().map((p) => p.id);
  const rows = [];
  await Promise.all(ids.map((pid) => ctx.api.get('/api/projects/' + pid + '/comms/contacts' + ctx.api.qs({ q: f.q })).then((r) => (r.items || []).forEach((k) => rows.push(Object.assign({ project_id: pid }, k))), () => {})));
  if (!rows.length) return empty('No contact', 'No per-project contact found either.');
  return h('div', {}, h('p', { class: 'dim' }, 'Showing per-project contacts (fallback).'), simpleTable([
    { label: 'Contact', cell: (k) => h('a', { href: '#/contacts/360/' + encodeURIComponent(k.project_id + ':' + k.id) }, k.display_name || k.wa_masked) },
    { label: 'Number', cell: (k) => h('span', { class: 'mono' }, k.wa_masked) },
    { label: 'Project', cell: (k) => chip(ctx.projectName(k.project_id), 'project') },
    { label: 'Status', cell: (k) => badge(k.status) },
    { label: 'Conversations', cell: (k) => String(k.conversations), cls: 'num' },
    { label: 'Last seen', cell: (k) => relTime(k.last_seen_at), cls: 'dim' }
  ], rows));
}

export async function render360(main, params, query, ctx) {
  const key = params.phone;
  ctx.crumbs([{ label: 'Contacts', href: '#/contacts' }, { label: 'Contact 360' }]);
  const box = h('div', { class: 'stack' }, skeletonRows(6)); main.appendChild(box);
  const legacy = /^[a-z0-9-]+:\d+$/.test(key);
  let d = null;
  if (!legacy) {
    try { d = await ctx.api.get('/api/contacts/360/' + encodeURIComponent(key)); }
    catch (err) { clear(box); box.appendChild(errorBox(err, () => render360(clear(main), params, query, ctx))); return; }
  } else {
    // <project>:<contact id> — the per-project record rendered in the 360 layout.
    const [pid, id] = key.split(':');
    let k;
    try { k = await ctx.api.get('/api/projects/' + pid + '/comms/contacts/' + id); } catch (err) { clear(box); box.appendChild(errorBox(err)); return; }
    d = { phone_masked: k.wa_masked, display_name: k.display_name, persons: [Object.assign({ project_id: pid, contact_id: k.id, notes: [] }, k)], conversations: (k.conversations || []).map((c) => Object.assign({ project_id: pid }, c)), timeline: [], ai: null, human: null, legacy: true };
  }
  clear(box);
  const persons = d.persons || [];
  const name = d.display_name || (persons.find((p) => p.display_name) || {}).display_name || d.phone_masked;
  main.insertBefore(pageHead('Contact 360', name || '—', (d.phone_masked || '') + (d.phone && ctx.can('admin') ? ' · ' + d.phone : '') + ' · ' + persons.length + ' project' + (persons.length === 1 ? '' : 's') + ' · ' + (d.conversations || []).length + ' conversation' + ((d.conversations || []).length === 1 ? '' : 's')), box);
  const aiC = d.ai || {}, huC = d.human || {};
  box.appendChild(h('div', { class: 'grid cols-4' },
    statCard('AI runs', aiC.runs), statCard('AI suggestions', aiC.suggestions), statCard('Handoffs', aiC.handoffs), statCard('Human messages', huC.messages_out), statCard('Notes', huC.notes)));
  // per-project cards
  const cards = h('div', { class: 'grid cols-2' }); box.appendChild(h('section', {}, h('h3', { class: 'section-title' }, 'Projects'), cards));
  if (!persons.length) cards.appendChild(empty('No project record'));
  persons.forEach((p) => cards.appendChild(personCard(ctx, p, () => render360(clear(main), params, query, ctx))));
  // conversations
  const convs = d.conversations || [];
  box.appendChild(h('div', { class: 'card' }, cardHead('Conversations'), convs.length ? simpleTable([
    { label: 'Conversation', cell: (c) => h('a', { href: '#/inbox/' + c.id + '?project=' + encodeURIComponent(c.project_id) }, '#' + c.id) },
    { label: 'Project', cell: (c) => chip(ctx.projectName(c.project_id), 'project') },
    { label: 'Status', cell: (c) => badge(c.status) },
    { label: 'Handler', cell: (c) => c.handler ? handlerBadge(c.handler) : null },
    { label: 'Agent', cell: (c) => c.agent_name || (c.agent_id ? '#' + c.agent_id : null) },
    { label: 'Unread', cell: (c) => c.unread_count ? String(c.unread_count) : '0', cls: 'num' },
    { label: 'Last message', cell: (c) => relTime(c.last_message_at || c.created_at), cls: 'dim' }
  ], convs, { compact: true, noScroll: true, onRow: (c) => { location.hash = '#/inbox/' + c.id + '?project=' + encodeURIComponent(c.project_id); } }) : h('p', { class: 'dim' }, 'No conversation.')));
  // timeline + notes
  const tl = d.timeline || [];
  box.appendChild(h('div', { class: 'grid cols-2' },
    h('div', { class: 'card' }, cardHead('Timeline'), tl.length ? h('div', { class: 'timeline' }, tl.map((e) => h('div', { class: 'ev' }, h('span', { class: 'when' }, fmtDate(e.at)), h('span', { class: 'what' }, badge(e.kind || 'event', e.kind && /handoff/.test(e.kind) ? 'warn' : e.kind && /ai/.test(e.kind) ? 'info' : ''), ' ', e.summary || '', e.project_id ? h('span', { class: 'dim' }, ' · ' + ctx.projectName(e.project_id)) : null)))) : h('p', { class: 'dim' }, d.legacy ? 'The cross-project timeline needs the 360 endpoint.' : 'No event yet.')),
    notesCard(ctx, persons, d)
  ));
}

function statCard(label, v) { return h('div', { class: 'card stat' }, h('span', { class: 'stat-label' }, label), h('span', { class: 'stat-value' + (v === undefined || v === null ? ' na' : '') }, v === undefined || v === null ? 'n/a' : String(v))); }

function personCard(ctx, p, reload) {
  const editable = ctx.can('agent');
  const tagsList = (p.tags || []).map((tg) => typeof tg === 'string' ? tg : tg.name);
  const card = h('div', { class: 'card' }, cardHead(ctx.projectName(p.project_id), [badge(p.status || 'active'), editable ? h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onClick: edit }, 'Edit') : null]),
    kv([['Name', p.display_name], ['Language', p.language], ['Tags', tagsList.length ? h('span', { class: 'chips' }, tagsList.map((x) => chip(x, 'tag'))) : null], ['First seen', fmtDate(p.first_seen_at)], ['Last seen', fmtDate(p.last_seen_at)], ['Source', p.source], ['Notes', p.notes && typeof p.notes === 'string' ? p.notes : null], ['Memory', p.memory && Object.keys(p.memory).length ? h('code', {}, JSON.stringify(p.memory).slice(0, 300)) : null]]),
    h('div', { class: 'view-actions' }, h('a', { class: 'btn btn-ghost btn-sm', href: '#/inbox?project=' + encodeURIComponent(p.project_id) + '&q=' + encodeURIComponent((p.display_name || '').slice(0, 40)) }, 'Inbox'), h('a', { class: 'btn btn-ghost btn-sm', href: '#/projects/' + encodeURIComponent(p.project_id) }, 'Project')));
  async function edit() {
    const out = await dialogForm({ title: 'Edit contact · ' + ctx.projectName(p.project_id), fields: [
      { name: 'display_name', label: 'Name', value: p.display_name || '' },
      { name: 'language', label: 'Language', type: 'select', value: p.language || '', options: [{ value: 'fr', label: 'fr' }, { value: 'ar', label: 'ar' }, { value: 'en', label: 'en' }] },
      { name: 'status', label: 'Status', type: 'select', value: p.status || 'active', required: true, options: ['active', 'blocked'] },
      { name: 'notes', label: 'Internal notes', type: 'textarea', value: typeof p.notes === 'string' ? p.notes : '' }
    ], onSubmit: async (v) => { await ctx.api.patch('/api/projects/' + p.project_id + '/comms/contacts/' + (p.contact_id || p.id), { display_name: v.display_name.trim() || null, language: v.language || null, status: v.status, notes: v.notes }); } });
    if (out) { toast('Contact saved', 'ok'); reload(); }
  }
  return card;
}

function notesCard(ctx, persons, d) {
  const card = h('div', { class: 'card' }, cardHead('Notes'));
  const list = h('div', { class: 'note-list' }); card.appendChild(list);
  const first = persons[0];
  async function load() {
    clear(list);
    if (!first) { list.appendChild(h('p', { class: 'dim' }, 'No project record to attach notes to.')); return; }
    const all = [];
    await Promise.all(persons.map((p) => ctx.api.get('/api/notes' + ctx.api.qs({ kind: 'contact', id: p.contact_id || p.id, project: p.project_id })).then((r) => (r.items || []).forEach((n) => all.push(Object.assign({ project_id: p.project_id }, n))), (err) => { if (err.status === 404) all.unavailable = true; })));
    if (all.unavailable && !all.length) { list.appendChild(h('p', { class: 'dim' }, 'Notes endpoint not available on this server yet.')); return; }
    if (!all.length) { list.appendChild(h('p', { class: 'dim' }, 'No note.')); return; }
    all.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    all.forEach((n) => list.appendChild(h('div', { class: 'note' }, h('div', { class: 'note-meta' }, h('strong', {}, n.author || '—'), ' · ', relTime(n.created_at), ' · ', ctx.projectName(n.project_id), ctx.can('manager') || n.author === ctx.state.meta.user.username ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'aria-label': 'Delete note', onClick: async () => { try { await ctx.api.del('/api/notes/' + n.id); toast('Note deleted', 'ok'); load(); } catch (err) { toast(err.detail || 'delete failed', 'danger'); } } }, '×') : null), h('div', { class: 'note-body' }, n.body))));
  }
  if (first && ctx.can('agent')) {
    const ta = h('textarea', { class: 'textarea', rows: 3, placeholder: 'Add a note about this contact (internal, never sent)', 'aria-label': 'New note' });
    const sel = h('select', { class: 'select', 'aria-label': 'Project of the note' }, persons.map((p) => h('option', { value: p.project_id }, ctx.projectName(p.project_id))));
    card.appendChild(h('div', { class: 'stack sm' }, ta, h('div', { class: 'view-actions' }, persons.length > 1 ? sel : null, h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onClick: async () => {
      const body = ta.value.trim(); if (!body) return;
      const p = persons.find((x) => x.project_id === sel.value) || first;
      try { await ctx.api.post('/api/notes', { kind: 'contact', id: String(p.contact_id || p.id), project_id: p.project_id, body }); ta.value = ''; toast('Note added', 'ok'); load(); } catch (err) { toast(err.status === 404 ? 'Notes endpoint not available yet.' : (err.detail || 'note failed'), 'danger'); }
    } }, 'Add note'))));
  } else card.appendChild(roleNote(ctx, 'agent', 'Adding notes'));
  load();
  return card;
}
