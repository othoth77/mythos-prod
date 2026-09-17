/* MYTHOS Control Center — dashboard: WhatsApp / Projects / AI / Infrastructure
   tiles, alerts, per-project activity. GET /api/dashboard?project=<id|all>. */
import { h, clear, badge, fmtDate, relTime, skeletonRows, errorBox, empty, pageHead, cardHead, simpleTable } from '../ui.js';

function stat(label, value, sub, tone, href) {
  const na = value === null || value === undefined;
  return h(href ? 'a' : 'div', { class: 'card stat link ' + (na ? '' : tone || ''), href: href || undefined },
    h('span', { class: 'stat-label' }, label),
    h('span', { class: 'stat-value' + (na ? ' na' : '') }, na ? 'unavailable' : Number(value).toLocaleString()),
    sub ? h('span', { class: 'stat-sub' }, sub) : null);
}
function group(title, tiles, link) {
  return h('section', { class: 'dash-group' }, h('div', { class: 'dash-group-head' }, h('h3', {}, title), link ? h('a', { class: 'btn btn-ghost btn-sm', href: link.href }, link.label) : null), h('div', { class: 'grid cols-4' }, tiles));
}

export async function render(main, params, query, ctx) {
  ctx.crumbs([{ label: 'Dashboard' }]);
  const project = ctx.project();
  const row = ctx.projectRow();
  const pq = project === 'all' ? '' : '&project=' + encodeURIComponent(project);
  main.appendChild(pageHead(row ? (row.domain || row.id) : 'All projects', 'Dashboard', row ? 'Operational state of ' + row.display_name + '. Every figure is a live count; nothing is estimated.' : 'Operational state across every project you can access. Every figure is a live count; nothing is estimated.'));
  const body = h('div', { class: 'stack' }, skeletonRows(4)); main.appendChild(body);
  let d;
  try { d = await ctx.api.get('/api/dashboard' + ctx.api.qs({ project })); } catch (err) { clear(body); body.appendChild(errorBox(err, () => render(clear(main), params, query, ctx))); if (err.status === 404) body.appendChild(fallback(ctx)); return; }
  clear(body);
  const w = d.whatsapp || {}, p = d.projects || {}, a = d.ai || {};
  const alerts = d.alerts || [];
  if (alerts.length) body.appendChild(h('div', { class: 'card alerts' }, cardHead('Alerts', [badge(alerts.length + ' open', alerts.some((x) => x.level === 'error') ? 'danger' : 'warn')]),
    h('div', { class: 'alert-list' }, alerts.map((x) => h('div', { class: 'alert ' + (x.level || 'warning') }, badge(x.level || 'warning'), h('strong', {}, x.component || '—'), h('span', {}, x.message || ''), h('span', { class: 'when' }, relTime(x.at)))))));
  body.appendChild(group('WhatsApp', [
    stat('Conversations', w.conversations, 'live conversations', '', '#/inbox?view=all' + pq),
    stat('Unread', w.unread, 'messages awaiting a look', w.unread > 0 ? 'warn' : 'ok', '#/inbox?view=unread' + pq),
    stat('Handled by AI', w.ai, 'handler = AI', 'info', '#/inbox?view=ai' + pq),
    stat('Handled by humans', w.human, 'handler = human', '', '#/inbox?view=human' + pq),
    stat('Waiting on customer', w.waiting, 'status waiting_customer', '', '#/inbox?view=waiting' + pq),
    stat('Needs attention', w.needs_attention, 'needs_human · open handoffs', w.needs_attention > 0 ? 'danger' : 'ok', '#/inbox?view=attention' + pq)
  ], { label: 'Open inbox', href: '#/inbox' }));
  body.appendChild(group('Projects', [
    stat('Active projects', p.active, 'status active', 'ok', '#/projects'),
    stat('Total projects', p.total, 'all statuses', '', '#/projects')
  ], { label: 'All projects', href: '#/projects' }));
  body.appendChild(group('AI', [
    stat('Active agents', a.active_agents, 'agents in service', 'info', '#/ai?tab=agents'),
    stat('Handled (24 h)', a.handled_24h, 'AI runs', '', '#/ai?tab=runs'),
    stat('Handoffs (24 h)', a.handoffs_24h, 'AI → human', a.handoffs_24h > 0 ? 'warn' : '', '#/inbox?view=attention' + pq),
    stat('Errors (24 h)', a.errors_24h, 'failed runs', a.errors_24h > 0 ? 'danger' : 'ok', '#/ai?tab=runs')
  ], { label: 'AI centre', href: '#/ai' }));
  const infra = d.infrastructure || [];
  body.appendChild(h('div', { class: 'grid cols-2' },
    h('div', { class: 'card' }, cardHead('Infrastructure', [h('a', { class: 'btn btn-ghost btn-sm', href: '#/health' }, 'Health center')]),
      infra.length ? h('div', { class: 'health-grid compact' }, infra.map((c) => h('div', { class: 'health-item ' + (c.status || 'unknown') }, h('span', { class: 'status-dot ' + ({ ok: 'ok', warning: 'warn', error: 'danger', disconnected: 'danger' }[c.status] || '') }), h('span', { class: 'health-name' }, c.component), badge(c.status || 'unknown'), h('span', { class: 'dim' }, typeof c.detail === 'string' ? c.detail : (c.detail && (c.detail.reason || c.detail.detail)) || ''), h('span', { class: 'when' }, relTime(c.checked_at))))) : h('p', {}, 'No health check recorded yet.')),
    h('div', { class: 'card' }, cardHead('Activity per project (24 h)', [h('a', { class: 'btn btn-ghost btn-sm', href: '#/projects' }, 'Projects')]),
      (p.activity || []).length ? simpleTable([
        { label: 'Project', cell: (r) => h('a', { href: '#/projects/' + encodeURIComponent(r.id) }, r.display_name || r.id) },
        { label: 'Conversations', cell: (r) => String(r.conversations_24h === undefined ? '—' : r.conversations_24h), cls: 'num' },
        { label: '', cell: (r) => h('a', { class: 'btn btn-ghost btn-sm', href: '#/inbox?view=all&project=' + encodeURIComponent(r.id) }, 'Inbox'), stop: true }
      ], p.activity, { compact: true, noScroll: true }) : empty('No activity', 'No conversation in the last 24 hours.'))
  ));
  body.appendChild(h('p', { class: 'dim' }, h('small', {}, 'Generated ' + fmtDate(d.generated_at))));
}

/* Until /api/dashboard exists the page still offers the way in. */
function fallback(ctx) {
  return h('div', { class: 'grid cols-4' },
    stat('Inbox', null, 'open the inbox', '', '#/inbox'),
    stat('Projects', ctx.projects().length, 'known to this panel', '', '#/projects'),
    stat('Health', null, 'process health', '', '#/health'));
}
