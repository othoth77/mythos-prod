/* MYTHOS Control Center — Inbox: LEFT conversations or contacts (search, one
   project filter, status pills), CENTRE the chat (timeline, reply, AI
   suggestion, take over / hand back) or a contact 360, RIGHT the customer
   panel (name, phone, project, tags, assignee, AI/Human, notes) with the
   technical detail under Advanced. Live updates through each project's SSE feed. */
import { h, clear, badge, handlerBadge, fmtDate, relTime, skeletonRows, errorBox, empty, toast, tabs, chip, kv, qget, setQuery, confirmDialog, details, fmtMasked } from '../ui.js';
import { contactRows, contact360 } from './contacts.js';

const STATUSES = ['open', 'pending', 'waiting_customer', 'needs_human', 'resolved', 'archived'];
const VIEWS = [
  { key: 'all', label: 'All', status: '' },
  { key: 'unread', label: 'Unread', status: 'live' },
  { key: 'human', label: 'Human', status: 'live' },
  { key: 'waiting', label: 'Waiting', status: 'waiting_customer' },
  { key: 'closed', label: 'Closed', status: 'resolved' }
];
let feeds = [];
function closeFeeds() { feeds.forEach((es) => { try { es.close(); } catch (e) { /* closed */ } }); feeds = []; }
function typeGlyph(t) { return { image: '🖼', audio: '🎤', video: '🎞', document: '📄', sticker: '🏷', location: '📍', contact: '👤', reaction: '💬' }[t] || ''; }
function when(ts) { if (!ts) return '—'; const d = new Date(ts); const now = new Date(); return (d.toDateString() === now.toDateString()) ? d.toTimeString().slice(0, 5) : fmtDate(ts); }
function splitId(raw, queryProject) { const m = /^([a-z0-9-]+):(\d+)$/.exec(raw || ''); if (m) return { project: m[1], id: parseInt(m[2], 10) }; return { project: queryProject || null, id: raw ? parseInt(raw, 10) : null }; }
function needsHuman(cv) { return cv.handler === 'human' || cv.status === 'needs_human' || !!cv.handoff_open; }

export async function render(main, params, query, ctx) {
  closeFeeds();
  const contactsRoute = /^#\/contacts/.test(location.hash);
  let mode = contactsRoute || qget(query, 'mode') === 'contacts' ? 'contacts' : 'conversations';
  ctx.crumbs([{ label: 'Inbox' }].concat(mode === 'contacts' ? [{ label: 'Contacts' }] : []));
  const globalProject = ctx.project();
  const f = { view: qget(query, 'view', 'all'), project: qget(query, 'project', globalProject === 'all' ? '' : globalProject), q: qget(query, 'q') };
  if (!VIEWS.some((v) => v.key === f.view)) f.view = 'all';
  const cur = splitId(params.id, f.project);
  const state = { items: [], current: cur.id, currentProject: cur.project, contact: params.contact || qget(query, 'contact') || null, conv: null, messages: [], tags: [], counts: {} };
  const projectIds = () => f.project ? [f.project] : ctx.projects().map((p) => p.id);
  const base = (pid) => '/api/projects/' + pid + '/comms';

  const layout = h('div', { class: 'inbox' + (mode === 'contacts' ? ' contacts-mode' : '') }); main.appendChild(layout);
  const listCol = h('div', { class: 'inbox-list' }); const paneCol = h('div', { class: 'inbox-pane' }); const sideCol = h('div', { class: 'inbox-side' });
  layout.append(listCol, paneCol, sideCol);

  // left column: mode toggle, search, project, pills
  const modeBar = tabs([{ key: 'conversations', label: 'Conversations' }, { key: 'contacts', label: 'Contacts' }], mode, (k) => { mode = k; layout.classList.toggle('contacts-mode', mode === 'contacts'); state.contact = null; pills.el.hidden = mode === 'contacts'; sync(); clear(paneCol); clear(sideCol); if (mode === 'contacts') { loadContacts(); paneCol.appendChild(empty('Select a contact.')); } else { loadList(); paneCol.appendChild(empty('Select a conversation.')); } });
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Search name, number, text', 'aria-label': 'Search', value: f.q });
  const projSel = h('select', { class: 'select', 'aria-label': 'Project' }, h('option', { value: '' }, 'All projects'), ctx.projects().map((p) => h('option', { value: p.id, selected: p.id === f.project || undefined }, p.display_name)));
  const pills = tabs(VIEWS.map((v) => ({ key: v.key, label: v.label })), f.view, (k) => { f.view = k; sync(); loadList(); });
  pills.el.classList.add('pills'); pills.el.hidden = mode === 'contacts';
  listCol.append(modeBar.el, h('div', { class: 'inbox-filters' }, search, globalProject === 'all' ? projSel : null), pills.el);
  const listEl = h('div', { class: 'conv-list', role: 'list' }); listCol.appendChild(listEl);
  let t = null; search.oninput = () => { clearTimeout(t); t = setTimeout(() => { f.q = search.value.trim(); sync(); mode === 'contacts' ? loadContacts() : loadList(); }, 250); };
  projSel.onchange = () => { f.project = projSel.value; sync(); if (mode === 'contacts') loadContacts(); else { loadList(); openFeeds(); } };
  function sync() {
    if (mode === 'contacts') { setQuery(state.contact ? '#/contacts/360/' + encodeURIComponent(state.contact) : '#/contacts', { q: f.q, project: f.project }); return; }
    setQuery('#/inbox' + (state.current ? '/' + state.current : ''), { view: f.view === 'all' ? '' : f.view, q: f.q, project: f.project || (state.current ? state.currentProject : '') });
  }

  async function loadContacts() { await contactRows(ctx, listEl, f, openContact, state.contact); }
  function openContact(key) { state.contact = key; sync(); clear(sideCol); contact360(ctx, paneCol, key); listEl.querySelectorAll('.conv').forEach((a) => a.classList.toggle('active', decodeURIComponent(a.getAttribute('href').split('/').pop()) === key)); }

  async function loadList() {
    clear(listEl); listEl.appendChild(skeletonRows(6));
    const v = VIEWS.find((x) => x.key === f.view);
    const qs = { status: v.status, q: f.q, limit: 100 };
    const results = await Promise.all(projectIds().map((pid) => ctx.api.get(base(pid) + '/conversations' + ctx.api.qs(qs)).then((r) => ({ pid, ok: true, r }), (err) => ({ pid, ok: false, err }))));
    const failed = results.filter((x) => !x.ok);
    let items = [];
    const counts = { total: 0, unread: 0, by_status: {} };
    results.filter((x) => x.ok).forEach((x) => {
      x.r.items.forEach((cv) => { cv.project_id = cv.project_id || x.pid; items.push(cv); });
      const c = x.r.counts || {}; counts.total += c.total || 0; counts.unread += c.unread || 0;
      Object.keys(c.by_status || {}).forEach((k) => { counts.by_status[k] = (counts.by_status[k] || 0) + c.by_status[k]; });
    });
    if (f.view === 'unread') items = items.filter((cv) => cv.unread_count > 0);
    if (f.view === 'human') items = items.filter(needsHuman);
    items.sort((a, b) => String(b.last_message_at || '').localeCompare(String(a.last_message_at || '')));
    state.items = items; state.counts = counts; ctx.state.inboxUnread = counts.unread;
    pills.count('unread', counts.unread);
    clear(listEl);
    if (failed.length && !results.some((x) => x.ok)) { listEl.appendChild(errorBox(failed[0].err, loadList)); return; }
    if (!items.length) { listEl.appendChild(empty('No conversation', f.q || f.view !== 'all' ? 'Nothing matches.' : 'Messages appear here once a number is linked to a project.')); return; }
    items.forEach((cv) => {
      const id = cv.id;
      const active = id === state.current && cv.project_id === state.currentProject;
      listEl.appendChild(h('a', { href: '#/inbox/' + id + '?project=' + encodeURIComponent(cv.project_id) + (f.view !== 'all' ? '&view=' + f.view : ''), class: 'conv' + (active ? ' active' : '') + (cv.unread_count ? ' unread' : ''), role: 'listitem', 'aria-current': active ? 'true' : undefined },
        h('div', { class: 'conv-head' }, h('strong', {}, cv.contact_name || fmtMasked(cv.contact_masked)), h('span', { class: 'when' }, when(cv.last_message_at))),
        h('div', { class: 'conv-sub' }, h('span', { class: 'dim' }, ctx.projectName(cv.project_id))),
        h('div', { class: 'conv-body' }, h('span', { class: 'dim' }, (cv.last_direction === 'out' ? '↩ ' : '') + typeGlyph(cv.last_type) + ' ' + (cv.last_text || (cv.last_type ? cv.last_type : ''))), cv.unread_count ? h('span', { class: 'count' }, String(cv.unread_count)) : null),
        h('div', { class: 'conv-meta' }, badge(cv.status), handlerBadge(cv.handler || 'ai'), cv.handoff_open ? badge('Needs human', 'danger') : null, cv.assigned_to ? chip('👤 ' + cv.assigned_to) : null, ...(cv.tags || []).map((tg) => chip(tg, 'tag')))));
    });
    if (failed.length) listEl.appendChild(h('p', { class: 'dim small' }, failed.length + ' project' + (failed.length > 1 ? 's' : '') + ' unavailable'));
  }

  async function loadConversation(pid, id) {
    state.current = id; state.currentProject = pid; clear(paneCol); paneCol.appendChild(skeletonRows(8)); clear(sideCol);
    const b = base(pid);
    let conv, msgs, tagList;
    try { [conv, msgs, tagList] = await Promise.all([ctx.api.get(b + '/conversations/' + id), ctx.api.get(b + '/conversations/' + id + '/messages'), ctx.api.get(b + '/tags').catch(() => [])]); } catch (err) { clear(paneCol); paneCol.appendChild(errorBox(err)); return; }
    conv.project_id = conv.project_id || pid;
    state.conv = conv; state.messages = msgs.items; state.tags = Array.isArray(tagList) ? tagList : (tagList.items || []);
    const handoffs = await ctx.api.get(b + '/conversations/' + id + '/handoffs').then((r) => Array.isArray(r) ? r : (r.items || r.history || []), () => null);
    if (conv.unread_count > 0 && ctx.can('agent')) { ctx.api.post(b + '/conversations/' + id + '/read', {}).then(() => { conv.unread_count = 0; loadList(); ctx.refreshUnread(); }).catch(() => {}); }
    renderPane(handoffs);
  }

  function renderPane(handoffHistory) {
    const conv = state.conv; const pid = conv.project_id; const b = base(pid); clear(paneCol); clear(sideCol);
    const canWork = ctx.can('agent');
    const handler = conv.handler || 'ai';
    const openHandoff = (conv.handoffs || []).some((x) => x.status !== 'RESOLVED');
    const contactKey = conv.contact_phone || conv.contact_wa_id || (pid + ':' + conv.contact_id);
    const reload = () => { loadConversation(pid, conv.id); loadList(); };
    const takeOver = () => h('button', { class: 'btn btn-primary btn-sm', type: 'button', disabled: !canWork || handler === 'human' || undefined, title: canWork ? 'Take this conversation from the AI' : 'Requires the agent role', onClick: () => handoff('ai_to_human') }, 'Take over');
    const handBack = () => h('button', { class: 'btn btn-secondary btn-sm', type: 'button', disabled: !canWork || handler === 'ai' || undefined, title: canWork ? 'Return this conversation to the AI' : 'Requires the agent role', onClick: () => handoff('human_to_ai') }, 'Hand back to AI');
    paneCol.appendChild(h('div', { class: 'pane-head' },
      h('div', {}, h('h3', {}, conv.contact_name || fmtMasked(conv.contact_masked)), h('div', { class: 'pane-badges' }, badge(conv.status), handlerBadge(handler), openHandoff ? badge('Needs human', 'danger') : null)),
      h('div', { class: 'view-actions' }, handler === 'ai' ? takeOver() : handBack())));
    async function handoff(direction) {
      const toHuman = direction === 'ai_to_human';
      const ok = await confirmDialog({ title: toHuman ? 'Take over this conversation?' : 'Hand this conversation back to the AI?', body: toHuman ? 'The AI stops answering; you become the handler.' : 'The AI resumes answering according to its mode.', confirmLabel: toHuman ? 'Take over' : 'Hand back' });
      if (!ok) return;
      try { await ctx.api.post(b + '/conversations/' + conv.id + '/handoff', { direction, reason: toHuman ? 'OPERATOR_TAKEOVER' : 'OPERATOR_HANDBACK' }); toast(toHuman ? 'You now handle this conversation.' : 'Handed back to the AI.', 'ok'); reload(); }
      catch (err) { toast(err.status === 404 ? 'Handoff is not available on this server yet.' : (err.detail || 'Handoff failed.'), 'danger', 5000); }
    }
    const body = h('div', { class: 'pane-body' }); paneCol.appendChild(body);
    const tl = h('div', { class: 'msgs', role: 'log', 'aria-live': 'polite' }); body.appendChild(tl);
    if (!state.messages.length) tl.appendChild(empty('No message yet.'));
    state.messages.forEach((m) => {
      const cls = 'msg ' + (m.direction === 'in' ? 'in' : m.direction === 'out' ? 'out' : 'activity');
      const atts = (m.attachments || []).map((a) => h('div', { class: 'att' }, typeGlyph(a.kind) + ' ' + a.kind + (a.file_name ? ' · ' + a.file_name : '') + ' · ' + a.status, a.transcript ? h('div', { class: 'transcript' }, '“' + a.transcript + '”') : null));
      tl.appendChild(h('div', { class: cls },
        h('div', { class: 'bubble' }, m.redacted_at ? h('em', { class: 'dim' }, 'content purged (retention)') : (m.text || (m.message_type !== 'text' ? typeGlyph(m.message_type) + ' ' + m.message_type : '')), ...atts),
        h('div', { class: 'meta' }, (m.direction === 'activity' ? 'note · ' + (m.sender_ref || '') : m.direction === 'out' ? (m.sender_kind === 'ai' ? 'AI' : m.sender_ref || 'agent') + ' · ' + ({ queued: '⏳ queued', sent: '✓ sent', delivered: '✓✓ delivered', read: '✓✓ read', failed: '✗ failed' }[m.status] || m.status) : 'customer') + ' · ' + when(m.provider_timestamp || m.created_at) + (m.error ? ' · ' + m.error : ''),
          m.direction === 'out' && m.status === 'failed' && canWork ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: async () => { try { await ctx.api.post(b + '/conversations/' + conv.id + '/messages/' + m.id + '/retry', {}); loadConversation(pid, conv.id); } catch (err) { toast(err.detail || 'Retry failed.', 'danger'); } } }, 'Retry') : null)));
    });
    setTimeout(() => { tl.scrollTop = tl.scrollHeight; }, 0);
    const canSend = conv.outbound_enabled && conv.status !== 'archived' && canWork;
    const reply = h('textarea', { class: 'textarea', rows: 2, placeholder: canSend ? 'Reply to the customer…  (Ctrl+Enter sends)' : (conv.outbound_enabled ? 'The agent role is required to reply.' : 'Replies are switched off for this number (Project → WhatsApp).'), disabled: !canSend || undefined, 'aria-label': 'Reply' });
    let clientRef = null;
    const sendBtn = h('button', { class: 'btn btn-primary', type: 'button', disabled: !canSend || undefined, onClick: () => doSend() }, 'Send');
    async function doSend() {
      const text = reply.value.trim(); if (!text) return;
      if (!clientRef) clientRef = 'ui-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
      sendBtn.disabled = true;
      try { const r = await ctx.api.post(b + '/conversations/' + conv.id + '/messages', { text, client_ref: clientRef }); clientRef = null; reply.value = ''; toast(r.status === 'sent' ? 'Sent' : 'Send failed: ' + (r.error || r.status), r.status === 'sent' ? 'ok' : 'danger', 4000); reload(); }
      catch (err) { toast(err.detail || 'Send failed.', 'danger', 5000); sendBtn.disabled = false; }
    }
    reply.onkeydown = (ev) => { if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') { ev.preventDefault(); doSend(); } };
    const aiBox = h('div', { class: 'ai-box' });
    async function loadSuggestions() {
      let list = []; try { list = await ctx.api.get(b + '/conversations/' + conv.id + '/suggestions'); } catch (err) { return; }
      clear(aiBox);
      const open = (Array.isArray(list) ? list : list.items || []).filter((s) => s.status === 'proposed');
      if (!open.length) return;
      open.slice(0, 1).forEach((s) => {
        const edit = h('textarea', { class: 'textarea', rows: 3 }, s.text);
        const decideBtn = (label, cls, fn) => h('button', { class: 'btn ' + cls + ' btn-sm', type: 'button', onClick: fn }, label);
        aiBox.appendChild(h('div', { class: 'card ai-suggestion' },
          h('div', { class: 'card-head' }, h('h4', {}, 'AI suggestion'), h('span', {}, s.intent ? badge(s.intent, 'info') : null, ' ', badge(Math.round((Number(s.confidence) || 0) * 100) + '% sure', Number(s.confidence) >= 0.8 ? 'ok' : Number(s.confidence) >= 0.5 ? 'warn' : 'danger'))),
          edit,
          h('div', { class: 'view-actions' },
            decideBtn('Send', 'btn-primary', async () => { try { const d = await ctx.api.post(b + '/conversations/' + conv.id + '/suggestions/' + s.id + '/decide', edit.value.trim() !== s.text ? { action: 'edit', text: edit.value.trim() } : { action: 'accept' }); const r = await ctx.api.post(b + '/conversations/' + conv.id + '/messages', { text: d.send.text, client_ref: 'ai-' + s.id + '-' + Date.now().toString(36), ai_run_id: d.send.ai_run_id, suggestion_id: d.send.suggestion_id }); toast(r.status === 'sent' ? 'Sent' : 'Send failed: ' + (r.error || r.status), r.status === 'sent' ? 'ok' : 'danger', 4000); reload(); } catch (err) { toast(err.detail || 'Failed.', 'danger', 5000); } }),
            decideBtn('Regenerate', 'btn-secondary', async () => { try { await ctx.api.post(b + '/conversations/' + conv.id + '/suggestions/' + s.id + '/decide', { action: 'reject' }); await ctx.api.post(b + '/conversations/' + conv.id + '/suggest', {}); loadSuggestions(); } catch (err) { toast(err.detail || 'Failed.', 'danger'); } }),
            decideBtn('Reject', 'btn-ghost', async () => { try { await ctx.api.post(b + '/conversations/' + conv.id + '/suggestions/' + s.id + '/decide', { action: 'reject' }); loadSuggestions(); } catch (err) { toast(err.detail || 'Failed.', 'danger'); } }))));
      });
    }
    const aiBtn = h('button', { class: 'btn btn-secondary', type: 'button', disabled: !canWork || undefined, onClick: async () => { aiBtn.disabled = true; try { const out = await ctx.api.post(b + '/conversations/' + conv.id + '/suggest', {}); if (out.decision === 'handoff') toast('The AI cannot answer this one: handed to a human.', 'warn', 5000); else if (out.decision === 'none') toast('No suggestion this time.', 'warn'); loadSuggestions(); loadConversation(pid, conv.id); } catch (err) { toast(err.detail || 'Suggestion failed.', 'danger', 5000); } aiBtn.disabled = false; } }, 'AI suggestion');
    body.appendChild(aiBox);
    body.appendChild(h('div', { class: 'reply' }, reply, h('div', { class: 'view-actions' }, sendBtn, aiBtn)));
    loadSuggestions();

    // right column: the customer
    const tagSelect = h('select', { class: 'select', 'aria-label': 'Add tag' }, h('option', { value: '' }, 'Add tag…'), ...state.tags.filter((tg) => !(conv.tags || []).some((x) => x.id === tg.id)).map((tg) => h('option', { value: String(tg.id) }, tg.name)));
    tagSelect.onchange = async () => { if (!tagSelect.value) return; try { await ctx.api.post(b + '/conversations/' + conv.id + '/tags/' + tagSelect.value, {}); reload(); } catch (err) { toast(err.detail || 'Tag failed.', 'danger'); } };
    const newTag = h('input', { class: 'input', placeholder: 'New tag ⏎', 'aria-label': 'New tag' });
    newTag.onkeydown = async (ev) => { if (ev.key !== 'Enter' || !newTag.value.trim()) return; ev.preventDefault(); try { const tg = await ctx.api.post(b + '/tags', { name: newTag.value.trim() }); await ctx.api.post(b + '/conversations/' + conv.id + '/tags/' + tg.id, {}); reload(); } catch (err) { toast(err.detail || 'Tag failed.', 'danger'); } };
    const asg = h('input', { class: 'input', value: conv.assigned_to || '', placeholder: 'username', 'aria-label': 'Assigned to', disabled: !canWork || undefined });
    asg.onchange = async () => { try { await ctx.api.patch(b + '/conversations/' + conv.id, { assigned_to: asg.value.trim() || null }); toast('Assignee saved', 'ok', 1800); loadList(); } catch (err) { toast(err.detail || 'Update failed.', 'danger'); } };
    const note = h('textarea', { class: 'textarea', rows: 2, placeholder: 'Internal note (never sent)', 'aria-label': 'Internal note', disabled: !canWork || undefined });
    const notes = state.messages.filter((m) => m.direction === 'activity').slice(-3).reverse();
    sideCol.appendChild(h('div', { class: 'card customer' },
      h('h4', {}, 'Customer'),
      kv([['Name', conv.contact_name], ['Phone', h('span', { class: 'mono' }, fmtMasked(conv.contact_masked))], ['Project', chip(ctx.projectName(pid), 'project')]]),
      h('div', { class: 'field' }, h('label', {}, 'Tags'), h('div', { class: 'chips' }, ...(conv.tags || []).map((tg) => canWork ? h('button', { class: 'chip', type: 'button', title: 'Remove', onClick: async () => { try { await ctx.api.del(b + '/conversations/' + conv.id + '/tags/' + tg.id); reload(); } catch (err) { toast(err.detail || 'Failed.', 'danger'); } } }, tg.name + ' ×') : chip(tg.name, 'tag'))), canWork ? h('div', { class: 'tag-add' }, tagSelect, newTag) : null),
      h('div', { class: 'field' }, h('label', {}, 'Assigned to'), asg),
      h('div', { class: 'field' }, h('label', {}, 'Handled by'), h('div', { class: 'view-actions' }, handlerBadge(handler), takeOver(), handBack())),
      h('div', { class: 'field' }, h('label', {}, 'Notes'), canWork ? h('div', { class: 'stack xs' }, note, h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onClick: async () => { if (!note.value.trim()) return; try { await ctx.api.post(b + '/conversations/' + conv.id + '/notes', { text: note.value.trim() }); note.value = ''; toast('Note added', 'ok'); loadConversation(pid, conv.id); } catch (err) { toast(err.detail || 'Note failed.', 'danger'); } } }, 'Add note')) : null,
        notes.length ? h('div', { class: 'note-list' }, notes.map((m) => h('div', { class: 'note' }, h('div', { class: 'note-meta' }, h('strong', {}, m.sender_ref || '—'), ' · ', relTime(m.created_at)), h('div', { class: 'note-body' }, m.text || '')))) : h('p', { class: 'dim small' }, 'No note yet.')),
      h('a', { class: 'btn btn-ghost btn-sm', href: '#/contacts/360/' + encodeURIComponent(contactKey) }, 'Open contact')));
    const st = h('select', { class: 'select', 'aria-label': 'Status', disabled: !canWork || undefined }, ...STATUSES.map((s) => h('option', { value: s, selected: s === conv.status || undefined }, s.replace(/_/g, ' '))));
    const pr = h('select', { class: 'select', 'aria-label': 'Priority', disabled: !canWork || undefined }, ...[0, 1, 2, 3].map((p) => h('option', { value: String(p), selected: p === conv.priority || undefined }, ['normal', 'low', 'high', 'urgent'][p])));
    const apply = h('button', { class: 'btn btn-secondary btn-sm', type: 'button', disabled: !canWork || undefined, onClick: async () => { try { await ctx.api.patch(b + '/conversations/' + conv.id, { status: st.value, priority: parseInt(pr.value, 10) }); toast('Conversation updated', 'ok'); reload(); } catch (err) { toast(err.detail || 'Update failed.', 'danger'); } } }, 'Apply');
    const hist = handoffHistory === null ? (conv.handoffs || []) : handoffHistory;
    sideCol.appendChild(details('Advanced', [
      h('div', { class: 'field' }, h('label', {}, 'Status'), st), h('div', { class: 'field' }, h('label', {}, 'Priority'), pr), h('div', {}, apply),
      kv([['Number', conv.inbox_display_name || conv.inbox_instance], ['Routed by', conv.routed_by], ['Language', conv.contact_language || conv.language], ['Last intent', conv.last_intent], ['First seen', fmtDate(conv.first_seen_at)], ['Last seen', fmtDate(conv.last_seen_at)], ['Summary', conv.summary], ['Conversation id', h('code', {}, '#' + conv.id)]]),
      h('h4', {}, 'Handoff history'),
      hist.length ? h('div', { class: 'timeline compact' }, hist.map((x) => h('div', { class: 'ev' }, h('span', { class: 'when' }, relTime(x.taken_at || x.created_at)), h('span', { class: 'what' }, badge(x.direction ? (x.direction === 'ai_to_human' ? 'AI → human' : 'human → AI') : (x.status || 'handoff'), x.direction === 'human_to_ai' ? 'info' : 'warn'), ' ', x.reason || '', x.taken_by ? h('span', { class: 'dim' }, ' · ' + x.taken_by) : null, x.id ? h('span', { class: 'dim' }, ' · #' + x.id) : null)))) : h('p', { class: 'dim' }, 'No handoff yet.')
    ]));
  }

  function openFeeds() {
    closeFeeds();
    projectIds().slice(0, 12).forEach((pid) => {
      try {
        const es = new EventSource(base(pid) + '/events');
        const onEv = (ev) => { let d = null; try { d = JSON.parse(ev.data); } catch (e) { return; } if (mode !== 'conversations') return; loadList(); if (state.current && d.conversation_id === state.current && (d.project_id || pid) === state.currentProject) loadConversation(pid, state.current); };
        ['message.in', 'message.out', 'message.status', 'message.note', 'conversation.updated', 'conversation.read', 'inbox.status', 'ai.run', 'handoff'].forEach((n) => es.addEventListener(n, onEv));
        feeds.push(es);
      } catch (e) { /* no SSE: manual refresh */ }
    });
  }
  openFeeds();
  window.addEventListener('hashchange', closeFeeds, { once: true });

  if (mode === 'contacts') {
    await loadContacts();
    if (state.contact) openContact(state.contact); else paneCol.appendChild(empty('Select a contact.'));
    return;
  }
  await loadList();
  if (state.current && state.currentProject) await loadConversation(state.currentProject, state.current);
  else if (state.current) {
    const hit = state.items.find((cv) => cv.id === state.current);
    if (hit) await loadConversation(hit.project_id, hit.id); else paneCol.appendChild(empty('Conversation not in this view', 'Pick the project in the filter or open it from the list.'));
  } else paneCol.appendChild(empty('Select a conversation.'));
}
