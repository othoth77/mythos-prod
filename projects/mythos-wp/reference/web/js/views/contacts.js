/* MYTHOS Control Center — Contacts inside the Inbox: the cross-project list
   (left column) and the contact 360 (centre column): identity, projects,
   conversations, notes; timeline and counters under Advanced. */
import { h, clear, badge, handlerBadge, fmtDate, relTime, skeletonRows, errorBox, empty, toast, chip, kv, simpleTable, dialogForm, roleNote, details, fmtMasked } from '../ui.js';

export function contactKey(it) { return it.phone || it.phone_ref || it.wa_id || it.key || (it.phone_masked ? String(it.phone_masked).replace(/\D/g, '') : ''); }

/* Fills `listEl` with the contact rows for { q, project }. onOpen(key) opens the 360. */
export async function contactRows(ctx, listEl, f, onOpen, currentKey) {
  clear(listEl); listEl.appendChild(skeletonRows(6));
  let r;
  try { r = await ctx.api.get('/api/contacts' + ctx.api.qs({ q: f.q, project: f.project || 'all', limit: 200 })); }
  catch (err) {
    if (err.status !== 404) { clear(listEl); listEl.appendChild(errorBox(err, () => contactRows(ctx, listEl, f, onOpen, currentKey))); return; }
    r = { items: await legacyList(ctx, f) };
  }
  clear(listEl);
  const items = r.items || [];
  if (!items.length) { listEl.appendChild(empty('No contact', f.q ? 'Nothing matches the search.' : 'Contacts appear once customers write to a linked number.')); return; }
  items.forEach((k) => {
    const key = k.legacy_key || contactKey(k);
    listEl.appendChild(h('a', { href: '#/contacts/360/' + encodeURIComponent(key), class: 'conv' + (key === currentKey ? ' active' : ''), role: 'listitem', onClick: (e) => { e.preventDefault(); onOpen(key); } },
      h('div', { class: 'conv-head' }, h('strong', {}, k.display_name || fmtMasked(k.phone_masked)), h('span', { class: 'when' }, relTime(k.last_seen_at))),
      h('div', { class: 'conv-sub' }, h('span', { class: 'mono dim' }, fmtMasked(k.phone_masked)), (k.projects || []).length ? ' · ' : '', h('span', { class: 'dim' }, (k.projects || []).map((p) => ctx.projectName(p.project_id)).join(', '))),
      (k.tags || []).length ? h('div', { class: 'conv-meta' }, ...(k.tags || []).map((x) => chip(x, 'tag'))) : null));
  });
}

/* Until /api/contacts exists: per-project lists merged client-side. */
async function legacyList(ctx, f) {
  const ids = f.project ? [f.project] : ctx.projects().map((p) => p.id);
  const rows = [];
  await Promise.all(ids.map((pid) => ctx.api.get('/api/projects/' + pid + '/comms/contacts' + ctx.api.qs({ q: f.q })).then((r) => (r.items || []).forEach((k) => rows.push({ legacy_key: pid + ':' + k.id, display_name: k.display_name, phone_masked: k.wa_masked, projects: [{ project_id: pid }], last_seen_at: k.last_seen_at })), () => {})));
  return rows;
}

/* Renders the contact 360 into `box`. */
export async function contact360(ctx, box, key) {
  clear(box); box.appendChild(skeletonRows(6));
  const reload = () => contact360(ctx, box, key);
  const legacy = /^[a-z0-9-]+:\d+$/.test(key);
  let d = null;
  if (!legacy) {
    try { d = await ctx.api.get('/api/contacts/360/' + encodeURIComponent(key)); }
    catch (err) { clear(box); box.appendChild(errorBox(err, reload)); return; }
  } else {
    const [pid, id] = key.split(':');
    let k;
    try { k = await ctx.api.get('/api/projects/' + pid + '/comms/contacts/' + id); } catch (err) { clear(box); box.appendChild(errorBox(err)); return; }
    d = { phone_masked: k.wa_masked, display_name: k.display_name, persons: [Object.assign({ project_id: pid, contact_id: k.id }, k)], conversations: (k.conversations || []).map((c) => Object.assign({ project_id: pid }, c)), timeline: [], ai: null, human: null, legacy: true };
  }
  clear(box);
  const persons = d.persons || [];
  const name = d.display_name || (persons.find((p) => p.display_name) || {}).display_name || fmtMasked(d.phone_masked);
  box.appendChild(h('div', { class: 'pane-head' }, h('div', {}, h('h3', {}, name || '—'), h('div', { class: 'pane-badges' }, h('span', { class: 'mono dim' }, fmtMasked(d.phone_masked)), ...persons.map((p) => chip(ctx.projectName(p.project_id), 'project'))))));
  const cards = h('div', { class: 'stack sm' });
  if (!persons.length) cards.appendChild(empty('No project record'));
  persons.forEach((p) => cards.appendChild(personCard(ctx, p, reload)));
  box.appendChild(cards);
  const convs = d.conversations || [];
  box.appendChild(h('div', { class: 'card' }, h('h4', {}, 'Conversations'), convs.length ? simpleTable([
    { label: 'Project', cell: (c) => chip(ctx.projectName(c.project_id), 'project') },
    { label: 'Status', cell: (c) => badge(c.status) },
    { label: 'Handled by', cell: (c) => c.handler ? handlerBadge(c.handler) : null },
    { label: 'Last message', cell: (c) => relTime(c.last_message_at || c.created_at), cls: 'dim' }
  ], convs, { compact: true, noScroll: true, onRow: (c) => { location.hash = '#/inbox/' + c.id + '?project=' + encodeURIComponent(c.project_id); } }) : h('p', { class: 'dim' }, 'No conversation.')));
  box.appendChild(notesCard(ctx, persons));
  const aiC = d.ai || {}, huC = d.human || {};
  const tl = d.timeline || [];
  box.appendChild(details('Advanced', [
    kv([['AI runs', aiC.runs], ['AI suggestions', aiC.suggestions], ['Handoffs', aiC.handoffs], ['Human messages', huC.messages_out], ['Notes', huC.notes]].map(([k, v]) => [k, v === undefined || v === null ? null : String(v)])),
    h('h4', {}, 'Timeline'),
    tl.length ? h('div', { class: 'timeline' }, tl.map((e) => h('div', { class: 'ev' }, h('span', { class: 'when' }, fmtDate(e.at)), h('span', { class: 'what' }, badge(e.kind || 'event', e.kind && /handoff/.test(e.kind) ? 'warn' : e.kind && /ai/.test(e.kind) ? 'info' : ''), ' ', e.summary || '', e.project_id ? h('span', { class: 'dim' }, ' · ' + ctx.projectName(e.project_id)) : null)))) : h('p', { class: 'dim' }, d.legacy ? 'The cross-project timeline needs the 360 endpoint.' : 'No event yet.')
  ]));
}

function personCard(ctx, p, reload) {
  const editable = ctx.can('agent');
  const tagsList = (p.tags || []).map((tg) => typeof tg === 'string' ? tg : tg.name);
  const card = h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h4', {}, ctx.projectName(p.project_id)), h('div', { class: 'view-actions' }, badge(p.status || 'active'), editable ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: edit }, 'Edit') : null)),
    kv([['Name', p.display_name], ['Language', p.language], ['Tags', tagsList.length ? h('span', { class: 'chips' }, tagsList.map((x) => chip(x, 'tag'))) : null], ['Last seen', fmtDate(p.last_seen_at)], ['Notes', p.notes && typeof p.notes === 'string' ? p.notes : null]]));
  async function edit() {
    const out = await dialogForm({ title: 'Edit contact · ' + ctx.projectName(p.project_id), fields: [
      { name: 'display_name', label: 'Name', value: p.display_name || '' },
      { name: 'language', label: 'Language', type: 'select', value: p.language || '', options: [{ value: 'fr', label: 'Français' }, { value: 'ar', label: 'العربية' }, { value: 'en', label: 'English' }] },
      { name: 'status', label: 'Status', type: 'select', value: p.status || 'active', required: true, options: ['active', 'blocked'] },
      { name: 'notes', label: 'Internal notes', type: 'textarea', value: typeof p.notes === 'string' ? p.notes : '' }
    ], onSubmit: async (v) => { await ctx.api.patch('/api/projects/' + p.project_id + '/comms/contacts/' + (p.contact_id || p.id), { display_name: v.display_name.trim() || null, language: v.language || null, status: v.status, notes: v.notes }); } });
    if (out) { toast('Contact saved', 'ok'); reload(); }
  }
  return card;
}

function notesCard(ctx, persons) {
  const card = h('div', { class: 'card' }, h('h4', {}, 'Notes'));
  const list = h('div', { class: 'note-list' }); card.appendChild(list);
  const first = persons[0];
  async function load() {
    clear(list);
    if (!first) { list.appendChild(h('p', { class: 'dim' }, 'No project record to attach notes to.')); return; }
    const all = [];
    let unavailable = false;
    await Promise.all(persons.map((p) => ctx.api.get('/api/notes' + ctx.api.qs({ kind: 'contact', id: p.contact_id || p.id, project: p.project_id })).then((r) => (r.items || []).forEach((n) => all.push(Object.assign({ project_id: p.project_id }, n))), (err) => { if (err.status === 404) unavailable = true; })));
    if (unavailable && !all.length) { list.appendChild(h('p', { class: 'dim' }, 'Notes are not available on this server yet.')); return; }
    if (!all.length) { list.appendChild(h('p', { class: 'dim' }, 'No note.')); return; }
    all.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    all.forEach((n) => list.appendChild(h('div', { class: 'note' }, h('div', { class: 'note-meta' }, h('strong', {}, n.author || '—'), ' · ', relTime(n.created_at), ' · ', ctx.projectName(n.project_id), ctx.can('manager') || n.author === ctx.state.meta.user.username ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'aria-label': 'Delete note', onClick: async () => { try { await ctx.api.del('/api/notes/' + n.id); toast('Note deleted', 'ok'); load(); } catch (err) { toast(err.detail || 'Delete failed.', 'danger'); } } }, '×') : null), h('div', { class: 'note-body' }, n.body))));
  }
  if (first && ctx.can('agent')) {
    const ta = h('textarea', { class: 'textarea', rows: 2, placeholder: 'Internal note (never sent)', 'aria-label': 'New note' });
    const sel = h('select', { class: 'select', 'aria-label': 'Project of the note' }, persons.map((p) => h('option', { value: p.project_id }, ctx.projectName(p.project_id))));
    card.appendChild(h('div', { class: 'stack xs' }, ta, h('div', { class: 'view-actions' }, persons.length > 1 ? sel : null, h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onClick: async () => {
      const body = ta.value.trim(); if (!body) return;
      const p = persons.find((x) => x.project_id === sel.value) || first;
      try { await ctx.api.post('/api/notes', { kind: 'contact', id: String(p.contact_id || p.id), project_id: p.project_id, body }); ta.value = ''; toast('Note added', 'ok'); load(); } catch (err) { toast(err.status === 404 ? 'Notes are not available yet.' : (err.detail || 'Note failed.'), 'danger'); }
    } }, 'Add note'))));
  } else card.appendChild(roleNote(ctx, 'agent', 'Adding notes'));
  load();
  return card;
}
