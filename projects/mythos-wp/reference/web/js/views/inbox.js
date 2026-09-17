/* MYTHOS Control Center — Inbox: cross-project conversation list with views
   (All / Unread / AI / Human / Waiting / Closed / Needs attention), filters
   (project / number / agent / tag / search) and the conversation pane
   (timeline, reply, AI suggestions, handoff AI ⇄ human, notes, tags, contact).
   Live updates through each project's SSE feed. */
import { h, clear, badge, handlerBadge, fmtDate, relTime, skeletonRows, errorBox, empty, toast, tabs, chip, qget, setQuery, confirmDialog } from '../ui.js';

const STATUSES = ['open', 'pending', 'waiting_customer', 'needs_human', 'resolved', 'archived'];
const VIEWS = [
  { key: 'all', label: 'All', status: '' },
  { key: 'unread', label: 'Unread', status: 'live' },
  { key: 'ai', label: 'AI', status: 'live', handler: 'ai' },
  { key: 'human', label: 'Human', status: 'live', handler: 'human' },
  { key: 'waiting', label: 'Waiting', status: 'waiting_customer' },
  { key: 'closed', label: 'Closed', status: 'resolved' },
  { key: 'attention', label: 'Needs attention', status: 'live' }
];
let feeds = [];
function closeFeeds() { feeds.forEach((es) => { try { es.close(); } catch (e) { /* closed */ } }); feeds = []; }
function typeGlyph(t) { return { image: '🖼', audio: '🎤', video: '🎞', document: '📄', sticker: '🏷', location: '📍', contact: '👤', reaction: '💬' }[t] || ''; }
function when(ts) { if (!ts) return '—'; const d = new Date(ts); const now = new Date(); return (d.toDateString() === now.toDateString()) ? d.toTimeString().slice(0, 5) : fmtDate(ts); }
function splitId(raw, queryProject) { const m = /^([a-z0-9-]+):(\d+)$/.exec(raw || ''); if (m) return { project: m[1], id: parseInt(m[2], 10) }; return { project: queryProject || null, id: raw ? parseInt(raw, 10) : null }; }

export async function render(main, params, query, ctx) {
  closeFeeds();
  ctx.crumbs([{ label: 'Inbox' }]);
  const globalProject = ctx.project();
  const f = { view: qget(query, 'view', 'all'), project: qget(query, 'project', globalProject === 'all' ? '' : globalProject), number: qget(query, 'number'), agent: qget(query, 'agent'), tag: qget(query, 'tag'), q: qget(query, 'q') };
  if (!VIEWS.some((v) => v.key === f.view)) f.view = 'all';
  const cur = splitId(params.id, f.project);
  const state = { items: [], current: cur.id, currentProject: cur.project, conv: null, messages: [], tags: [], numbers: [], agents: [], counts: {} };
  const projectIds = () => f.project ? [f.project] : ctx.projects().map((p) => p.id);
  const base = (pid) => '/api/projects/' + pid + '/comms';
  const numberByInbox = {};
  const agentById = {};

  main.appendChild(h('div', { class: 'view-head' }, h('div', {}, h('div', { class: 'view-kicker' }, 'WhatsApp'), h('h2', {}, 'Inbox'), h('p', {}, 'Conversations across ' + (f.project ? ctx.projectName(f.project) : 'every project you can access') + '. Numbers are masked; the AI answers until a human takes over.'))));
  const tabBar = tabs(VIEWS.map((v) => ({ key: v.key, label: v.label })), f.view, (k) => { f.view = k; sync(); loadList(); });
  main.appendChild(tabBar.el);
  const layout = h('div', { class: 'inbox' }); main.appendChild(layout);
  const listCol = h('div', { class: 'inbox-list' }); const paneCol = h('div', { class: 'inbox-pane' }); layout.append(listCol, paneCol);

  // filters
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Search name, number, text', 'aria-label': 'Search conversations', value: f.q });
  const projSel = h('select', { class: 'select', 'aria-label': 'Project filter' }, h('option', { value: '' }, 'All projects'), ctx.projects().map((p) => h('option', { value: p.id, selected: p.id === f.project || undefined }, p.display_name)));
  const numSel = h('select', { class: 'select', 'aria-label': 'Number filter' }, h('option', { value: '' }, 'All numbers'));
  const agentSel = h('select', { class: 'select', 'aria-label': 'Agent filter' }, h('option', { value: '' }, 'Any agent'));
  const tagSel = h('select', { class: 'select', 'aria-label': 'Tag filter' }, h('option', { value: '' }, 'Any tag'));
  const refreshBtn = h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onClick: () => loadList() }, 'Refresh');
  listCol.appendChild(h('div', { class: 'inbox-filters' }, search, h('div', { class: 'inbox-filter-row' }, globalProject === 'all' ? projSel : null, numSel, agentSel, tagSel, refreshBtn)));
  const countsEl = h('div', { class: 'inbox-counts' }); listCol.appendChild(countsEl);
  const listEl = h('div', { class: 'conv-list', role: 'list' }); listCol.appendChild(listEl);
  let t = null; search.oninput = () => { clearTimeout(t); t = setTimeout(() => { f.q = search.value.trim(); sync(); loadList(); }, 250); };
  projSel.onchange = () => { f.project = projSel.value; f.number = ''; f.tag = ''; sync(); fillSelectors().then(loadList); openFeeds(); };
  numSel.onchange = () => { f.number = numSel.value; sync(); loadList(); };
  agentSel.onchange = () => { f.agent = agentSel.value; sync(); loadList(); };
  tagSel.onchange = () => { f.tag = tagSel.value; sync(); loadList(); };
  function sync() { setQuery('#/inbox' + (state.current ? '/' + state.current : ''), Object.assign({}, f, { view: f.view === 'all' ? '' : f.view, project: f.project || (state.current ? state.currentProject : '') })); }

  async function fillSelectors() {
    // numbers (inbox links) and agents are best-effort: the lists degrade to instance names / ids.
    const [nums, agents, tagLists] = await Promise.all([
      ctx.api.get('/api/whatsapp/numbers').then((r) => r.items || [], () => []),
      ctx.api.get('/api/ai/agents').then((r) => r.items || [], () => []),
      Promise.all(projectIds().map((pid) => ctx.api.get(base(pid) + '/tags').then((r) => Array.isArray(r) ? r : (r.items || []), () => [])))
    ]);
    state.numbers = nums; state.agents = agents;
    nums.forEach((n) => (n.projects || []).forEach((l) => { numberByInbox[l.inbox_id] = { number: n, link: l }; }));
    agents.forEach((a) => { agentById[a.id] = a; });
    clear(numSel); numSel.appendChild(h('option', { value: '' }, 'All numbers'));
    nums.forEach((n) => (n.projects || []).filter((l) => !f.project || l.project_id === f.project).forEach((l) => numSel.appendChild(h('option', { value: String(l.inbox_id), selected: String(l.inbox_id) === f.number || undefined }, (n.display_name || n.instance) + (f.project ? '' : ' · ' + ctx.projectName(l.project_id))))));
    clear(agentSel); agentSel.appendChild(h('option', { value: '' }, 'Any agent'));
    agents.forEach((a) => agentSel.appendChild(h('option', { value: String(a.id), selected: String(a.id) === f.agent || undefined }, a.name)));
    const names = {}; tagLists.flat().forEach((tg) => { names[tg.name] = true; });
    clear(tagSel); tagSel.appendChild(h('option', { value: '' }, 'Any tag'));
    Object.keys(names).sort().forEach((n) => tagSel.appendChild(h('option', { value: n, selected: n === f.tag || undefined }, n)));
  }

  function agentName(cv) { if (cv.agent_name) return cv.agent_name; const a = cv.agent_id ? agentById[cv.agent_id] : null; return a ? a.name : (cv.agent_id ? '#' + cv.agent_id : null); }
  function numberName(cv) { const n = numberByInbox[cv.inbox_id]; return n ? (n.link.display_name || n.number.display_name || n.number.instance) : (cv.inbox_display_name || cv.inbox_instance || '—'); }

  async function loadList() {
    clear(listEl); listEl.appendChild(skeletonRows(6));
    const v = VIEWS.find((x) => x.key === f.view);
    const qs = { status: v.status, q: f.q, inbox: f.number, tag: f.tag, agent: f.agent, handler: v.handler, limit: 100 };
    const results = await Promise.all(projectIds().map((pid) => ctx.api.get(base(pid) + '/conversations' + ctx.api.qs(qs)).then((r) => ({ pid, ok: true, r }), (err) => ({ pid, ok: false, err }))));
    const failed = results.filter((x) => !x.ok);
    let items = [];
    const counts = { total: 0, unread: 0, by_status: {} };
    results.filter((x) => x.ok).forEach((x) => {
      x.r.items.forEach((cv) => { cv.project_id = cv.project_id || x.pid; items.push(cv); });
      const c = x.r.counts || {}; counts.total += c.total || 0; counts.unread += c.unread || 0;
      Object.keys(c.by_status || {}).forEach((k) => { counts.by_status[k] = (counts.by_status[k] || 0) + c.by_status[k]; });
    });
    // client-side refinements when the API ignores a filter
    if (f.view === 'unread') items = items.filter((cv) => cv.unread_count > 0);
    if (v.handler) items = items.filter((cv) => (cv.handler || 'ai') === v.handler);
    if (f.view === 'attention') items = items.filter((cv) => cv.status === 'needs_human' || cv.handoff_open);
    if (f.agent) items = items.filter((cv) => String(cv.agent_id || '') === f.agent);
    items.sort((a, b) => String(b.last_message_at || '').localeCompare(String(a.last_message_at || '')));
    state.items = items; state.counts = counts; ctx.state.inboxUnread = counts.unread;
    tabBar.count('all', counts.total); tabBar.count('unread', counts.unread); tabBar.count('waiting', counts.by_status.waiting_customer || 0); tabBar.count('closed', counts.by_status.resolved || 0); tabBar.count('attention', counts.by_status.needs_human || 0);
    clear(countsEl);
    countsEl.appendChild(h('small', { class: 'dim' }, items.length + ' shown · ' + counts.total + ' total · ' + counts.unread + ' unread' + (failed.length ? ' · ' + failed.length + ' project' + (failed.length > 1 ? 's' : '') + ' unavailable' : '')));
    clear(listEl);
    if (failed.length && !results.some((x) => x.ok)) { listEl.appendChild(errorBox(failed[0].err, loadList)); return; }
    if (!items.length) { listEl.appendChild(empty('No conversation', f.q || f.view !== 'all' || f.number || f.tag ? 'Nothing matches this view or the filters.' : 'Messages appear here once a number is linked to a project and inbound is enabled.')); return; }
    items.forEach((cv) => {
      const id = cv.id;
      const row = h('a', { href: '#/inbox/' + id + '?project=' + encodeURIComponent(cv.project_id) + (f.view !== 'all' ? '&view=' + f.view : ''), class: 'conv' + (id === state.current && cv.project_id === state.currentProject ? ' active' : '') + (cv.unread_count ? ' unread' : ''), role: 'listitem', 'aria-current': id === state.current && cv.project_id === state.currentProject ? 'true' : undefined },
        h('div', { class: 'conv-head' }, h('strong', {}, cv.contact_name || cv.contact_masked), h('span', { class: 'when' }, when(cv.last_message_at))),
        h('div', { class: 'conv-sub' }, h('span', { class: 'mono dim' }, cv.contact_masked), ' · ', h('span', { class: 'dim' }, ctx.projectName(cv.project_id)), ' · ', h('span', { class: 'dim' }, numberName(cv))),
        h('div', { class: 'conv-body' }, h('span', { class: 'dim' }, (cv.last_direction === 'out' ? '↩ ' : '') + typeGlyph(cv.last_type) + ' ' + (cv.last_text || (cv.last_type ? cv.last_type : ''))), cv.unread_count ? h('span', { class: 'count' }, String(cv.unread_count)) : null),
        h('div', { class: 'conv-meta' }, badge(cv.status), handlerBadge(cv.handler || 'ai'), cv.handoff_open ? badge('NEEDS HUMAN', 'danger') : null, agentName(cv) ? chip('🤖 ' + agentName(cv), 'ai') : null, cv.assigned_to ? chip('👤 ' + cv.assigned_to) : null, cv.priority ? badge('P' + cv.priority, cv.priority >= 2 ? 'danger' : 'warn') : null, ...(cv.tags || []).map((tg) => chip(tg, 'tag')))
      );
      listEl.appendChild(row);
    });
  }

  async function loadConversation(pid, id) {
    state.current = id; state.currentProject = pid; clear(paneCol); paneCol.appendChild(skeletonRows(8));
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
    const conv = state.conv; const pid = conv.project_id; const b = base(pid); clear(paneCol);
    const canWork = ctx.can('agent');
    const handler = conv.handler || 'ai';
    const openHandoff = (conv.handoffs || []).some((x) => x.status !== 'RESOLVED');
    const contactKey = conv.contact_phone || conv.contact_wa_id || (pid + ':' + conv.contact_id);
    const head = h('div', { class: 'pane-head' },
      h('div', {}, h('h3', {}, conv.contact_name || conv.contact_masked), h('div', { class: 'pane-badges' }, h('span', { class: 'mono dim' }, conv.contact_masked), chip(ctx.projectName(pid), 'project'), chip(numberName(conv), 'number'), agentName(conv) ? chip('🤖 ' + agentName(conv), 'ai') : chip('no agent', ''), conv.assigned_to ? chip('👤 ' + conv.assigned_to) : null, h('a', { href: '#/contacts/360/' + encodeURIComponent(contactKey) }, 'Contact 360'))),
      h('div', { class: 'view-actions' }, badge(conv.status), handlerBadge(handler), openHandoff ? badge('NEEDS HUMAN', 'danger') : null,
        handler === 'ai'
          ? h('button', { class: 'btn btn-primary btn-sm', type: 'button', disabled: !canWork || undefined, title: canWork ? 'Take this conversation from the AI' : 'Requires the agent role', onClick: () => handoff('ai_to_human') }, 'Take over (AI → Human)')
          : h('button', { class: 'btn btn-secondary btn-sm', type: 'button', disabled: !canWork || undefined, title: canWork ? 'Return this conversation to the AI' : 'Requires the agent role', onClick: () => handoff('human_to_ai') }, 'Hand back to AI'))
    );
    paneCol.appendChild(head);
    async function handoff(direction) {
      const toHuman = direction === 'ai_to_human';
      const ok = await confirmDialog({ title: toHuman ? 'Take over this conversation?' : 'Hand this conversation back to the AI?', body: toHuman ? 'The AI stops answering; you become the handler and the conversation is marked needs_human until you resolve it.' : 'The agent resumes answering according to its mode. Open handoffs are resolved.', confirmLabel: toHuman ? 'Take over' : 'Hand back' });
      if (!ok) return;
      try { const r = await ctx.api.post(b + '/conversations/' + conv.id + '/handoff', { direction, reason: toHuman ? 'OPERATOR_TAKEOVER' : 'OPERATOR_HANDBACK' }); toast(toHuman ? 'You now handle this conversation.' : 'Handed back to the AI' + (r && r.handler ? ' (' + r.handler + ')' : '') + '.', 'ok'); loadConversation(pid, conv.id); loadList(); }
      catch (err) { toast(err.status === 404 ? 'Handoff endpoint not available on this server yet.' : (err.detail || 'Handoff failed.'), 'danger', 5000); }
    }
    const body = h('div', { class: 'pane-body' }); paneCol.appendChild(body);
    const tl = h('div', { class: 'msgs', role: 'log', 'aria-live': 'polite' }); body.appendChild(tl);
    if (!state.messages.length) tl.appendChild(empty('No message yet.'));
    state.messages.forEach((m) => {
      const cls = 'msg ' + (m.direction === 'in' ? 'in' : m.direction === 'out' ? 'out' : 'activity');
      const atts = (m.attachments || []).map((a) => h('div', { class: 'att' }, typeGlyph(a.kind) + ' ' + a.kind + (a.file_name ? ' · ' + a.file_name : '') + (a.mime_type ? ' · ' + a.mime_type : '') + (a.size_bytes ? ' · ' + Math.round(a.size_bytes / 1024) + ' KiB' : '') + ' · ' + a.status, a.transcript ? h('div', { class: 'transcript' }, '“' + a.transcript + '”') : null));
      tl.appendChild(h('div', { class: cls },
        h('div', { class: 'bubble' }, m.redacted_at ? h('em', { class: 'dim' }, 'content purged (retention)') : (m.text || (m.message_type !== 'text' ? typeGlyph(m.message_type) + ' ' + m.message_type : '')), ...atts),
        h('div', { class: 'meta' }, (m.direction === 'activity' ? 'note · ' + (m.sender_ref || '') : m.direction === 'out' ? (m.sender_kind === 'ai' ? 'AI' : m.sender_ref || 'agent') + ' · ' + ({ queued: '⏳ queued', sent: '✓ sent', delivered: '✓✓ delivered', read: '✓✓ read', failed: '✗ failed' }[m.status] || m.status) : 'customer') + ' · ' + when(m.provider_timestamp || m.created_at) + (m.error ? ' · ' + m.error : ''),
          m.direction === 'out' && m.status === 'failed' && canWork ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: async () => { try { await ctx.api.post(b + '/conversations/' + conv.id + '/messages/' + m.id + '/retry', {}); loadConversation(pid, conv.id); } catch (err) { toast(err.detail || 'retry failed', 'danger'); } } }, 'Retry') : null)
      ));
    });
    setTimeout(() => { tl.scrollTop = tl.scrollHeight; }, 0);
    const canSend = conv.outbound_enabled && conv.status !== 'archived' && canWork;
    const reply = h('textarea', { class: 'textarea', rows: 2, placeholder: canSend ? 'Reply to the customer…  (Ctrl+Enter sends)' : (conv.outbound_enabled ? 'The agent role is required to reply.' : 'Replies are not enabled for this number (Projects → numbers → outbound switch).'), disabled: !canSend || undefined, 'aria-label': 'Reply' });
    let clientRef = null;
    const sendBtn = h('button', { class: 'btn btn-primary', type: 'button', disabled: !canSend || undefined, onClick: () => doSend() }, 'Send');
    async function doSend() {
      const text = reply.value.trim(); if (!text) return;
      if (!clientRef) clientRef = 'ui-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
      sendBtn.disabled = true;
      try { const r = await ctx.api.post(b + '/conversations/' + conv.id + '/messages', { text, client_ref: clientRef }); clientRef = null; reply.value = ''; toast(r.status === 'sent' ? 'Sent' : 'Send failed: ' + (r.error || r.status), r.status === 'sent' ? 'ok' : 'danger', 4000); loadConversation(pid, conv.id); loadList(); }
      catch (err) { toast(err.detail || 'send failed', 'danger', 5000); sendBtn.disabled = false; }
    }
    reply.onkeydown = (ev) => { if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') { ev.preventDefault(); doSend(); } };
    if (handler === 'ai' && canSend) body.appendChild(h('div', { class: 'notice accent' }, h('strong', {}, 'The AI handles this conversation. '), 'Sending a reply yourself does not take it over; use "Take over" to become the handler.'));
    const aiBox = h('div', { class: 'ai-box' });
    async function loadSuggestions() {
      let list = []; try { list = await ctx.api.get(b + '/conversations/' + conv.id + '/suggestions'); } catch (err) { return; }
      clear(aiBox);
      const open = (Array.isArray(list) ? list : list.items || []).filter((s) => s.status === 'proposed');
      if (!open.length) return;
      open.slice(0, 1).forEach((s) => {
        const facts = s.facts_used || {};
        const edit = h('textarea', { class: 'textarea', rows: 3 }, s.text);
        const decideBtn = (label, cls, fn) => h('button', { class: 'btn ' + cls + ' btn-sm', type: 'button', onClick: fn }, label);
        aiBox.appendChild(h('div', { class: 'card ai-suggestion' },
          h('div', { class: 'card-head' }, h('h4', {}, 'AI suggestion'), h('span', {}, badge((s.intent || 'intent ?'), 'info'), ' ', badge('confidence ' + Math.round((Number(s.confidence) || 0) * 100) + '%', Number(s.confidence) >= 0.8 ? 'ok' : Number(s.confidence) >= 0.5 ? 'warn' : 'danger'))),
          h('p', { class: 'dim' }, 'Verified: ' + ((facts.verified || []).join(', ') || 'none') + ' · Missing: ' + ((facts.unknown || []).join(', ') || 'none') + '. Facts come only from the project Kitchen and knowledge; the human decides.'),
          edit,
          h('div', { class: 'view-actions' },
            decideBtn('Send', 'btn-primary', async () => { try { const d = await ctx.api.post(b + '/conversations/' + conv.id + '/suggestions/' + s.id + '/decide', edit.value.trim() !== s.text ? { action: 'edit', text: edit.value.trim() } : { action: 'accept' }); const r = await ctx.api.post(b + '/conversations/' + conv.id + '/messages', { text: d.send.text, client_ref: 'ai-' + s.id + '-' + Date.now().toString(36), ai_run_id: d.send.ai_run_id, suggestion_id: d.send.suggestion_id }); toast(r.status === 'sent' ? 'Sent' : 'Send failed: ' + (r.error || r.status), r.status === 'sent' ? 'ok' : 'danger', 4000); loadConversation(pid, conv.id); loadList(); } catch (err) { toast(err.detail || 'failed', 'danger', 5000); } }),
            decideBtn('Regenerate', 'btn-secondary', async () => { try { await ctx.api.post(b + '/conversations/' + conv.id + '/suggestions/' + s.id + '/decide', { action: 'reject' }); await ctx.api.post(b + '/conversations/' + conv.id + '/suggest', {}); loadSuggestions(); } catch (err) { toast(err.detail || 'failed', 'danger'); } }),
            decideBtn('Reject', 'btn-ghost', async () => { try { await ctx.api.post(b + '/conversations/' + conv.id + '/suggestions/' + s.id + '/decide', { action: 'reject' }); loadSuggestions(); } catch (err) { toast(err.detail || 'failed', 'danger'); } }))));
      });
    }
    const aiBtn = h('button', { class: 'btn btn-secondary', type: 'button', disabled: !canWork || undefined, onClick: async () => { aiBtn.disabled = true; try { const out = await ctx.api.post(b + '/conversations/' + conv.id + '/suggest', {}); if (out.decision === 'handoff') toast('The assistant cannot answer with verified facts: handed to a human (' + (out.intent || 'intent ?') + ').', 'warn', 5000); else if (out.decision === 'none') toast('No decision (' + (out.policy && out.policy.rejections ? out.policy.rejections.join(', ') : 'engine') + ')', 'warn'); loadSuggestions(); loadConversation(pid, conv.id); } catch (err) { toast(err.detail || 'suggestion failed', 'danger', 5000); } aiBtn.disabled = false; } }, 'AI suggestion');
    body.appendChild(aiBox);
    body.appendChild(h('div', { class: 'reply' }, reply, h('div', { class: 'view-actions' }, sendBtn, aiBtn)));
    loadSuggestions();
    // side panel
    const side = h('div', { class: 'pane-side' }); paneCol.appendChild(side);
    if (canWork) {
      const st = h('select', { class: 'select', 'aria-label': 'Status' }, ...STATUSES.map((s) => h('option', { value: s, selected: s === conv.status || undefined }, s.replace(/_/g, ' '))));
      const asg = h('input', { class: 'input', value: conv.assigned_to || '', placeholder: 'assign to (username)', 'aria-label': 'Assignee' });
      const pr = h('select', { class: 'select', 'aria-label': 'Priority' }, ...[0, 1, 2, 3].map((p) => h('option', { value: String(p), selected: p === conv.priority || undefined }, ['normal', 'low', 'high', 'urgent'][p])));
      const save = h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onClick: async () => { try { await ctx.api.patch(b + '/conversations/' + conv.id, { status: st.value, assigned_to: asg.value.trim() || null, priority: parseInt(pr.value, 10) }); toast('Conversation updated', 'ok'); loadConversation(pid, conv.id); loadList(); } catch (err) { toast(err.detail || 'update failed', 'danger'); } } }, 'Apply');
      side.appendChild(h('div', { class: 'card' }, h('h4', {}, 'Handling'), h('div', { class: 'field' }, h('label', {}, 'Status'), st), h('div', { class: 'field' }, h('label', {}, 'Human owner'), asg), h('div', { class: 'field' }, h('label', {}, 'Priority'), pr), save));
      const note = h('textarea', { class: 'textarea', rows: 3, placeholder: 'Internal note (never sent)', 'aria-label': 'Internal note' });
      side.appendChild(h('div', { class: 'card' }, h('h4', {}, 'Internal note'), note, h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onClick: async () => { if (!note.value.trim()) return; try { await ctx.api.post(b + '/conversations/' + conv.id + '/notes', { text: note.value.trim() }); note.value = ''; toast('Note added', 'ok'); loadConversation(pid, conv.id); } catch (err) { toast(err.detail || 'note failed', 'danger'); } } }, 'Add note')));
      const tagSelect = h('select', { class: 'select', 'aria-label': 'Add tag' }, h('option', { value: '' }, 'add tag…'), ...state.tags.filter((tg) => !conv.tags.some((x) => x.id === tg.id)).map((tg) => h('option', { value: String(tg.id) }, tg.name)));
      tagSelect.onchange = async () => { if (!tagSelect.value) return; try { await ctx.api.post(b + '/conversations/' + conv.id + '/tags/' + tagSelect.value, {}); loadConversation(pid, conv.id); loadList(); } catch (err) { toast(err.detail || 'tag failed', 'danger'); } };
      const newTag = h('input', { class: 'input', placeholder: 'new tag (a-z0-9_.-) ⏎', 'aria-label': 'New tag' });
      newTag.onkeydown = async (ev) => { if (ev.key !== 'Enter' || !newTag.value.trim()) return; ev.preventDefault(); try { const tg = await ctx.api.post(b + '/tags', { name: newTag.value.trim() }); await ctx.api.post(b + '/conversations/' + conv.id + '/tags/' + tg.id, {}); loadConversation(pid, conv.id); loadList(); } catch (err) { toast(err.detail || 'tag failed', 'danger'); } };
      side.appendChild(h('div', { class: 'card' }, h('h4', {}, 'Tags'), h('div', { class: 'chips' }, ...conv.tags.map((tg) => h('button', { class: 'chip', type: 'button', title: 'remove', onClick: async () => { try { await ctx.api.del(b + '/conversations/' + conv.id + '/tags/' + tg.id); loadConversation(pid, conv.id); loadList(); } catch (err) { toast(err.detail || 'failed', 'danger'); } } }, tg.name + ' ×'))), tagSelect, newTag));
    }
    side.appendChild(h('div', { class: 'card' }, h('h4', {}, 'Contact'), h('dl', { class: 'kv' }, h('dt', {}, 'Name'), h('dd', {}, conv.contact_name || '—'), h('dt', {}, 'Number'), h('dd', { class: 'mono' }, conv.contact_masked), h('dt', {}, 'Language'), h('dd', {}, conv.contact_language || conv.language || '—'), h('dt', {}, 'First seen'), h('dd', {}, fmtDate(conv.first_seen_at)), h('dt', {}, 'Last seen'), h('dd', {}, fmtDate(conv.last_seen_at)), h('dt', {}, 'Intent'), h('dd', {}, conv.last_intent || '—'), h('dt', {}, 'Routed by'), h('dd', {}, conv.routed_by || '—')), conv.contact_notes ? h('p', { class: 'dim' }, conv.contact_notes) : null, h('a', { class: 'btn btn-ghost btn-sm', href: '#/contacts/360/' + encodeURIComponent(contactKey) }, 'Open contact 360')));
    const hist = handoffHistory === null ? (conv.handoffs || []) : handoffHistory;
    side.appendChild(h('div', { class: 'card' }, h('h4', {}, 'Handoff history'), hist.length ? h('div', { class: 'timeline compact' }, hist.map((x) => h('div', { class: 'ev' }, h('span', { class: 'when' }, relTime(x.taken_at || x.created_at)), h('span', { class: 'what' }, badge(x.direction ? (x.direction === 'ai_to_human' ? 'AI → human' : 'human → AI') : (x.status || 'handoff'), x.direction === 'human_to_ai' ? 'info' : 'warn'), ' ', x.reason || '', x.taken_by ? h('span', { class: 'dim' }, ' · ' + x.taken_by) : null, x.status ? h('span', { class: 'dim' }, ' · ' + x.status) : null)))) : h('p', { class: 'dim' }, handoffHistory === null ? 'No handoff recorded.' : 'No handoff yet.')));
    side.appendChild(h('div', { class: 'card' }, h('h4', {}, 'Summary'), h('p', { class: 'dim' }, conv.summary || 'No summary yet.')));
  }

  function openFeeds() {
    closeFeeds();
    projectIds().slice(0, 12).forEach((pid) => {
      try {
        const es = new EventSource(base(pid) + '/events');
        const onEv = (ev) => { let d = null; try { d = JSON.parse(ev.data); } catch (e) { return; } loadList(); if (state.current && d.conversation_id === state.current && (d.project_id || pid) === state.currentProject) loadConversation(pid, state.current); };
        ['message.in', 'message.out', 'message.status', 'message.note', 'conversation.updated', 'conversation.read', 'inbox.status', 'ai.run', 'handoff'].forEach((n) => es.addEventListener(n, onEv));
        feeds.push(es);
      } catch (e) { /* no SSE: manual refresh */ }
    });
  }
  openFeeds();
  window.addEventListener('hashchange', closeFeeds, { once: true });

  await fillSelectors();
  await loadList();
  if (state.current && state.currentProject) await loadConversation(state.currentProject, state.current);
  else if (state.current) {
    // conversation id without a project: find it in the loaded list
    const hit = state.items.find((cv) => cv.id === state.current);
    if (hit) await loadConversation(hit.project_id, hit.id); else paneCol.appendChild(empty('Conversation not in this view', 'Pick the project in the filter or open it from the list.'));
  } else paneCol.appendChild(empty('Select a conversation.', 'Rows show contact, number, project, agent and the current handler (AI or human).'));
}
