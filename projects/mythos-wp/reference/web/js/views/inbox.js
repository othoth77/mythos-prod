/* MYTHOS WP — WhatsApp Inbox: conversation list + conversation pane (timeline,
   contact panel, notes, tags, status / assignment). Talks only to the MYTHOS
   backend; live updates through the project's SSE feed with manual refresh. */
import { h, clear, badge, fmtDate, skeletonRows, errorBox, empty, toast } from '../ui.js';

const STATUSES = ['open', 'pending', 'waiting_customer', 'needs_human', 'resolved', 'archived'];
const TONE = { open: 'ok', pending: 'warn', waiting_customer: 'info', needs_human: 'danger', resolved: 'mock', archived: 'mock' };
let es = null;
function closeFeed() { if (es) { try { es.close(); } catch (e) { /* closed */ } es = null; } }
function typeGlyph(t) { return { image: '🖼', audio: '🎤', video: '🎞', document: '📄', sticker: '🏷', location: '📍', contact: '👤', reaction: '💬' }[t] || ''; }
function when(ts) { if (!ts) return '—'; const d = new Date(ts); const now = new Date(); return (d.toDateString() === now.toDateString()) ? d.toTimeString().slice(0, 5) : fmtDate(ts); }

export async function render(main, params, query, ctx) {
  const project = ctx.project();
  closeFeed();
  ctx.crumbs([{ label: 'WhatsApp Inbox' }]);
  if (!project) { main.appendChild(empty('Select a project')); return; }
  const base = '/api/projects/' + project + '/comms';
  const filters = { status: 'live', q: '', assigned: '', tag: '' };
  const state = { items: [], counts: null, current: params.id ? parseInt(params.id, 10) : null, conv: null, messages: [], tags: [] };

  main.appendChild(h('div', { class: 'view-head' }, h('div', {}, h('div', { class: 'view-kicker' }, 'WhatsApp'), h('h2', {}, 'Inbox'), h('p', {}, 'Customer conversations of this project. Numbers are masked in lists; nothing here reaches the provider directly.'))));
  const layout = h('div', { class: 'inbox' }); main.appendChild(layout);
  const listCol = h('div', { class: 'inbox-list' }); const paneCol = h('div', { class: 'inbox-pane' }); layout.appendChild(listCol); layout.appendChild(paneCol);

  const search = h('input', { class: 'input', type: 'search', placeholder: 'Search name, number, summary', 'aria-label': 'Search conversations' });
  const statusSel = h('select', { class: 'input', 'aria-label': 'Status filter' }, h('option', { value: 'live' }, 'Live'), ...STATUSES.map((s) => h('option', { value: s }, s.replace(/_/g, ' '))), h('option', { value: '' }, 'All'));
  const assignedSel = h('select', { class: 'input', 'aria-label': 'Assignment filter' }, h('option', { value: '' }, 'Anyone'), h('option', { value: 'me' }, 'Mine'), h('option', { value: 'none' }, 'Unassigned'));
  const refreshBtn = h('button', { class: 'btn btn-secondary btn-sm', onClick: () => loadList() }, 'Refresh');
  const countsEl = h('div', { class: 'inbox-counts' });
  listCol.appendChild(h('div', { class: 'toolbar' }, search, statusSel, assignedSel, refreshBtn));
  listCol.appendChild(countsEl);
  const listEl = h('div', { class: 'conv-list', role: 'list' }); listCol.appendChild(listEl);
  let t = null; search.oninput = () => { clearTimeout(t); t = setTimeout(() => { filters.q = search.value.trim(); loadList(); }, 250); };
  statusSel.onchange = () => { filters.status = statusSel.value; loadList(); };
  assignedSel.onchange = () => { filters.assigned = assignedSel.value; loadList(); };

  async function loadList() {
    clear(listEl); listEl.appendChild(skeletonRows(6));
    let r;
    try { r = await ctx.api.get(base + '/conversations' + ctx.api.qs(filters)); } catch (err) { clear(listEl); listEl.appendChild(errorBox(err)); return; }
    state.items = r.items; state.counts = r.counts; ctx.state.inboxUnread = r.counts.unread || 0;
    clear(countsEl);
    const c = r.counts;
    countsEl.appendChild(h('small', { class: 'dim' }, c.total + ' conversation' + (c.total === 1 ? '' : 's') + ' · ' + c.unread + ' unread' + Object.keys(c.by_status).map((k) => ' · ' + k.replace(/_/g, ' ') + ' ' + c.by_status[k]).join('')));
    clear(listEl);
    if (!r.items.length) { listEl.appendChild(empty(filters.q || filters.status !== 'live' ? 'No conversation matches.' : 'No conversation yet. Messages appear here once the customer inbox is paired and persisting.')); return; }
    r.items.forEach((cv) => {
      const row = h('a', { href: '#/inbox/' + cv.id, class: 'conv' + (cv.id === state.current ? ' active' : '') + (cv.unread_count ? ' unread' : ''), role: 'listitem' },
        h('div', { class: 'conv-head' }, h('strong', {}, cv.contact_name || cv.contact_masked), h('span', { class: 'when' }, when(cv.last_message_at))),
        h('div', { class: 'conv-body' }, h('span', { class: 'dim' }, (cv.last_direction === 'out' ? '↩ ' : '') + typeGlyph(cv.last_type) + ' ' + (cv.last_text || (cv.last_type ? cv.last_type : ''))), cv.unread_count ? h('span', { class: 'count' }, String(cv.unread_count)) : null),
        h('div', { class: 'conv-meta' }, badge(cv.status, TONE[cv.status]), cv.handoff_open ? badge('NEEDS HUMAN', 'danger') : null, cv.priority ? badge('P' + cv.priority, cv.priority >= 2 ? 'danger' : 'warn') : null, cv.assigned_to ? h('span', { class: 'chip' }, cv.assigned_to) : null, ...cv.tags.map((tg) => h('span', { class: 'chip' }, tg)))
      );
      listEl.appendChild(row);
    });
  }

  async function loadConversation(id) {
    state.current = id; clear(paneCol); paneCol.appendChild(skeletonRows(8));
    let conv, msgs, tags;
    try { [conv, msgs, tags] = await Promise.all([ctx.api.get(base + '/conversations/' + id), ctx.api.get(base + '/conversations/' + id + '/messages'), ctx.api.get(base + '/tags')]); } catch (err) { clear(paneCol); paneCol.appendChild(errorBox(err)); return; }
    state.conv = conv; state.messages = msgs.items; state.tags = tags;
    if (conv.unread_count > 0 && ctx.can('operator')) { ctx.api.post(base + '/conversations/' + id + '/read', {}).then(() => { conv.unread_count = 0; loadList(); }).catch(() => {}); }
    renderPane();
  }
  function renderPane() {
    const conv = state.conv; clear(paneCol);
    const head = h('div', { class: 'pane-head' },
      h('div', {}, h('h3', {}, conv.contact_name || conv.contact_masked), h('small', { class: 'dim' }, conv.contact_masked + ' · inbox ' + conv.inbox_instance + ' · ' + conv.contact_conversations + ' conversation' + (conv.contact_conversations === 1 ? '' : 's') + ' · ', h('a', { href: '#/contacts/' + conv.contact_id }, 'contact'))),
      h('div', { class: 'view-actions' }, badge(conv.status, TONE[conv.status]), conv.handoffs.some((x) => x.status !== 'RESOLVED') ? badge('NEEDS HUMAN', 'danger') : null)
    );
    paneCol.appendChild(head);
    const body = h('div', { class: 'pane-body' }); paneCol.appendChild(body);
    const tl = h('div', { class: 'msgs', role: 'log', 'aria-live': 'polite' }); body.appendChild(tl);
    if (!state.messages.length) tl.appendChild(empty('No message yet.'));
    state.messages.forEach((m) => {
      const cls = 'msg ' + (m.direction === 'in' ? 'in' : m.direction === 'out' ? 'out' : 'activity');
      const atts = (m.attachments || []).map((a) => h('div', { class: 'att' }, typeGlyph(a.kind) + ' ' + a.kind + (a.file_name ? ' · ' + a.file_name : '') + (a.mime_type ? ' · ' + a.mime_type : '') + (a.size_bytes ? ' · ' + Math.round(a.size_bytes / 1024) + ' KiB' : '') + ' · ' + a.status, a.transcript ? h('div', { class: 'transcript' }, '“' + a.transcript + '”') : null));
      tl.appendChild(h('div', { class: cls },
        h('div', { class: 'bubble' }, m.redacted_at ? h('em', { class: 'dim' }, 'content purged (retention)') : (m.text || (m.message_type !== 'text' ? typeGlyph(m.message_type) + ' ' + m.message_type : '')), ...atts),
        h('div', { class: 'meta' }, (m.direction === 'activity' ? 'note · ' + (m.sender_ref || '') : m.direction === 'out' ? (m.sender_kind === 'ai' ? 'AI' : m.sender_ref || 'agent') + ' · ' + m.status : 'customer') + ' · ' + when(m.provider_timestamp || m.created_at) + (m.error ? ' · ' + m.error : ''))
      ));
    });
    setTimeout(() => { tl.scrollTop = tl.scrollHeight; }, 0);
    // reply box (COMMS-5 enables sending)
    const reply = h('textarea', { class: 'textarea', rows: 2, placeholder: conv.outbound_enabled ? 'Reply…' : 'Replies are not enabled for this inbox yet (MYTHOS-COMMS-5).', disabled: !conv.outbound_enabled, 'aria-label': 'Reply' });
    body.appendChild(h('div', { class: 'reply' }, reply, h('div', { class: 'view-actions' }, h('button', { class: 'btn btn-primary', disabled: true, title: 'Sending arrives with MYTHOS-COMMS-5' }, 'Send'), h('button', { class: 'btn btn-secondary', disabled: true, title: 'AI suggestions arrive with MYTHOS-COMMS-7/8' }, 'AI suggestion'))));
    // side panel
    const side = h('div', { class: 'pane-side' }); paneCol.appendChild(side);
    if (ctx.can('operator')) {
      const st = h('select', { class: 'input', 'aria-label': 'Status' }, ...STATUSES.map((s) => h('option', { value: s, selected: s === conv.status }, s.replace(/_/g, ' '))));
      const asg = h('input', { class: 'input', value: conv.assigned_to || '', placeholder: 'assign to (username)', 'aria-label': 'Assignee' });
      const pr = h('select', { class: 'input', 'aria-label': 'Priority' }, ...[0, 1, 2, 3].map((p) => h('option', { value: String(p), selected: p === conv.priority }, ['normal', 'low', 'high', 'urgent'][p])));
      const save = h('button', { class: 'btn btn-secondary btn-sm', onClick: async () => { try { await ctx.api.patch(base + '/conversations/' + conv.id, { status: st.value, assigned_to: asg.value.trim() || null, priority: parseInt(pr.value, 10) }); toast('Conversation updated', 'ok'); loadConversation(conv.id); loadList(); } catch (err) { toast(err.detail || 'update failed', 'danger'); } } }, 'Apply');
      side.appendChild(h('div', { class: 'card' }, h('h4', {}, 'Handling'), h('div', { class: 'field' }, h('label', {}, 'Status'), st), h('div', { class: 'field' }, h('label', {}, 'Assignee'), asg), h('div', { class: 'field' }, h('label', {}, 'Priority'), pr), save));
      const note = h('textarea', { class: 'textarea', rows: 3, placeholder: 'Internal note (never sent)' });
      side.appendChild(h('div', { class: 'card' }, h('h4', {}, 'Internal note'), note, h('button', { class: 'btn btn-secondary btn-sm', onClick: async () => { if (!note.value.trim()) return; try { await ctx.api.post(base + '/conversations/' + conv.id + '/notes', { text: note.value.trim() }); note.value = ''; loadConversation(conv.id); } catch (err) { toast(err.detail || 'note failed', 'danger'); } } }, 'Add note')));
      const tagSel = h('select', { class: 'input', 'aria-label': 'Add tag' }, h('option', { value: '' }, 'add tag…'), ...state.tags.filter((tg) => !conv.tags.some((x) => x.id === tg.id)).map((tg) => h('option', { value: String(tg.id) }, tg.name)));
      tagSel.onchange = async () => { if (!tagSel.value) return; try { await ctx.api.post(base + '/conversations/' + conv.id + '/tags/' + tagSel.value, {}); loadConversation(conv.id); loadList(); } catch (err) { toast(err.detail || 'tag failed', 'danger'); } };
      const newTag = h('input', { class: 'input', placeholder: 'new tag (a-z0-9_.-)', 'aria-label': 'New tag' });
      newTag.onkeydown = async (ev) => { if (ev.key !== 'Enter' || !newTag.value.trim()) return; try { const tg = await ctx.api.post(base + '/tags', { name: newTag.value.trim() }); await ctx.api.post(base + '/conversations/' + conv.id + '/tags/' + tg.id, {}); loadConversation(conv.id); loadList(); } catch (err) { toast(err.detail || 'tag failed', 'danger'); } };
      side.appendChild(h('div', { class: 'card' }, h('h4', {}, 'Tags'), h('div', { class: 'chips' }, ...conv.tags.map((tg) => h('button', { class: 'chip', title: 'remove', onClick: async () => { try { await ctx.api.del(base + '/conversations/' + conv.id + '/tags/' + tg.id); loadConversation(conv.id); loadList(); } catch (err) { toast(err.detail || 'failed', 'danger'); } } }, tg.name + ' ×'))), tagSel, newTag));
    }
    side.appendChild(h('div', { class: 'card' }, h('h4', {}, 'Contact'), h('div', { class: 'kv' }, h('div', {}, 'Name'), h('div', {}, conv.contact_name || '—'), h('div', {}, 'Number'), h('div', {}, conv.contact_masked), h('div', {}, 'Language'), h('div', {}, conv.contact_language || conv.language || '—'), h('div', {}, 'First seen'), h('div', {}, fmtDate(conv.first_seen_at)), h('div', {}, 'Last seen'), h('div', {}, fmtDate(conv.last_seen_at)), h('div', {}, 'Intent'), h('div', {}, conv.last_intent || '—')), conv.contact_notes ? h('p', { class: 'dim' }, conv.contact_notes) : null, h('a', { class: 'btn btn-ghost btn-sm', href: '#/contacts/' + conv.contact_id }, 'Open contact')));
    if (conv.handoffs.length) side.appendChild(h('div', { class: 'card' }, h('h4', {}, 'Handoffs'), ...conv.handoffs.map((x) => h('div', {}, badge(x.status), ' ', x.reason, ' · ', h('a', { href: '#/r/handoffs/' + x.id }, '#' + x.id)))));
    side.appendChild(h('div', { class: 'card' }, h('h4', {}, 'Summary'), h('p', { class: 'dim' }, conv.summary || 'No summary yet.')));
  }

  // live feed
  try {
    es = new EventSource(base + '/events');
    const onEv = (ev) => { let d = null; try { d = JSON.parse(ev.data); } catch (e) { return; } if (d.type === 'message.in' || d.type === 'conversation.updated' || d.type === 'message.note' || d.type === 'message.out') { loadList(); if (state.current && d.conversation_id === state.current) loadConversation(state.current); } };
    ['message.in', 'message.out', 'message.note', 'conversation.updated', 'conversation.read', 'inbox.status'].forEach((n) => es.addEventListener(n, onEv));
  } catch (e) { /* no SSE: manual refresh */ }
  window.addEventListener('hashchange', closeFeed, { once: true });

  await loadList();
  if (state.current) await loadConversation(state.current);
  else paneCol.appendChild(empty('Select a conversation.'));
}
