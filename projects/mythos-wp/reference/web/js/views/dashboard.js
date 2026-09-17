/* MYTHOS Control Center — dashboard: today's five figures and one projects
   table. GET /api/dashboard?project=<id|all>; numbers and agents are the
   fallback when an activity item lacks the V2.1 whatsapp / ai fields. */
import { h, clear, badge, skeletonRows, errorBox, empty, pageHead, simpleTable, fmtMasked, connBadge } from '../ui.js';
import { loadNumbers, loadAgents, summarize, aiWords } from '../data.js';

function tile(label, value, href, tone) {
  const na = value === null || value === undefined;
  return h('a', { class: 'card stat link ' + (na ? '' : tone || ''), href },
    h('span', { class: 'stat-label' }, label),
    h('span', { class: 'stat-value' + (na ? ' na' : '') }, na ? 'n/a' : (typeof value === 'number' ? value.toLocaleString() : String(value))));
}

export async function render(main, params, query, ctx) {
  ctx.crumbs([{ label: 'Dashboard' }]);
  const project = ctx.project();
  const row = ctx.projectRow();
  const pq = project === 'all' ? '' : '&project=' + encodeURIComponent(project);
  main.appendChild(pageHead(null, 'Today', row ? row.display_name : 'Every project you can access'));
  const body = h('div', { class: 'stack' }, skeletonRows(3)); main.appendChild(body);
  const [dash, numbers, agents] = await Promise.all([ctx.api.get('/api/dashboard' + ctx.api.qs({ project })).then((d) => ({ ok: true, d }), (err) => ({ ok: false, err })), loadNumbers(), loadAgents()]);
  clear(body);
  if (!dash.ok) { body.appendChild(errorBox(dash.err, () => render(clear(main), params, query, ctx))); return; }
  const d = dash.d, w = d.whatsapp || {}, p = d.projects || {};
  const rows = (p.activity || []).length ? p.activity : ctx.projects().filter((x) => project === 'all' || x.id === project);
  const summaries = {}; rows.forEach((r) => { summaries[r.id] = summarize(r, numbers, agents, r.id); });
  // WhatsApp status: distinct numbers across the shown projects (all numbers when nothing is linked yet)
  const seen = {}; let total = 0, connected = 0;
  rows.forEach((r) => summaries[r.id].whatsapp.forEach((n) => { const k = n.phone_masked || JSON.stringify(n); if (seen[k]) return; seen[k] = true; total++; if (n.status === 'open') connected++; }));
  if (!total && project === 'all') { total = numbers.length; connected = numbers.filter((n) => n.status === 'open').length; }
  const waiting = w.waiting_human !== undefined ? w.waiting_human : w.needs_attention;
  body.appendChild(h('div', { class: 'grid cols-5' },
    tile('Unread messages', w.unread, '#/inbox?view=unread' + pq, w.unread > 0 ? 'warn' : ''),
    tile('Open conversations', w.conversations, '#/inbox' + pq),
    tile('Waiting for human', waiting, '#/inbox?view=human' + pq, waiting > 0 ? 'danger' : 'ok'),
    tile('Active projects', p.active, '#/projects'),
    tile('WhatsApp', connected + ' / ' + total, '#/whatsapp', total && connected === total ? 'ok' : total ? 'warn' : '')));
  body.appendChild(h('div', { class: 'card' }, h('h3', {}, 'Projects'),
    rows.length ? simpleTable([
      { label: 'Project', cell: (r) => h('a', { href: '#/projects/' + encodeURIComponent(r.id) }, r.display_name || r.id) },
      { label: 'Status', cell: (r) => badge(r.status) },
      { label: 'WhatsApp', cell: (r) => summaries[r.id].whatsapp.length ? h('div', { class: 'stack xs' }, summaries[r.id].whatsapp.map((n) => h('span', { class: 'num-line' }, h('span', { class: 'mono' }, fmtMasked(n.phone_masked)), ' ', connBadge(n.status)))) : h('span', { class: 'dim' }, 'No number') },
      { label: 'AI', cell: (r) => summaries[r.id].ai.agent ? h('span', {}, summaries[r.id].ai.agent, ' ', badge(aiWords(summaries[r.id].ai.mode), summaries[r.id].ai.mode === 'auto' ? 'ok' : summaries[r.id].ai.mode === 'suggest' ? 'info' : 'mock')) : h('span', { class: 'dim' }, 'No agent') }
    ], rows, { noScroll: true, onRow: (r) => { location.hash = '#/projects/' + encodeURIComponent(r.id); } }) : empty('No project yet', 'Create the first one.', ctx.can('admin') ? h('a', { class: 'btn btn-primary', href: '#/projects/new' }, 'New project') : null)));
}
