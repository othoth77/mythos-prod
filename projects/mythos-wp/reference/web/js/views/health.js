/* MYTHOS Control Center — Health center: grouped component checks (database,
   backend, receiver, WhatsApp numbers, integrations, AI, kitchens) + process card. */
import { h, clear, badge, fmtDate, relTime, skeletonRows, errorBox, empty, toast, kv, pageHead, cardHead, roleNote } from '../ui.js';

const GROUPS = [['Core', /^(database|backend|receiver)$/], ['WhatsApp', /^(whatsapp:|number:)/], ['Integrations', /^integration:/], ['Kitchens', /^kitchen:/], ['AI', /^ai/]];
function groupOf(c) { const g = GROUPS.find(([, re]) => re.test(c)); return g ? g[0] : 'Other'; }
const TONE = { ok: 'ok', warning: 'warn', error: 'danger', disconnected: 'danger' };

export async function render(main, params, query, ctx) {
  ctx.crumbs([{ label: 'Health' }]);
  const manager = ctx.can('manager');
  const runBtn = h('button', { class: 'btn btn-primary', type: 'button', disabled: !manager || undefined, title: manager ? 'Run every check now' : 'Requires the manager role', onClick: async () => {
    runBtn.disabled = true; runBtn.textContent = 'Running…';
    try { const d = await ctx.api.post('/api/health/run', {}); toast('Checks ran: ' + summaryText(d.summary), (d.summary && (d.summary.error || d.summary.disconnected)) ? 'warn' : 'ok', 5000); renderCenter(d); }
    catch (err) { toast(err.status === 404 ? 'Health run endpoint not available yet.' : (err.detail || 'Run failed.'), 'danger', 5000); }
    finally { runBtn.disabled = !manager; runBtn.textContent = 'Run checks now'; }
  } }, 'Run checks now');
  main.appendChild(pageHead('Operations', 'Health', 'Database, backend, receiver, every WhatsApp number, every enabled integration, the AI pool and each Kitchen. Secrets are never shown; only presence and reachability.', [runBtn]));
  const summary = h('div', { class: 'grid cols-4' }); main.appendChild(summary);
  const center = h('div', { class: 'stack' }, skeletonRows(4)); main.appendChild(center);
  const proc = h('div', { class: 'stack' }); main.appendChild(proc);
  if (!manager) main.appendChild(roleNote(ctx, 'manager', 'Running checks'));

  function summaryText(s) { s = s || {}; return (s.ok || 0) + ' ok · ' + (s.warning || 0) + ' warning · ' + (s.error || 0) + ' error · ' + (s.disconnected || 0) + ' disconnected'; }
  function renderCenter(d) {
    clear(summary); clear(center);
    const s = d.summary || {};
    [['OK', s.ok, 'ok'], ['Warning', s.warning, 'warn'], ['Error', s.error, 'danger'], ['Disconnected', s.disconnected, 'danger']].forEach(([l, v, t]) => summary.appendChild(h('div', { class: 'card stat ' + (v ? t : '') }, h('span', { class: 'stat-label' }, l), h('span', { class: 'stat-value' }, String(v === undefined ? '—' : v)))));
    const comps = d.components || [];
    if (!comps.length) { center.appendChild(empty('No check yet', manager ? 'Run the checks now.' : 'Checks run on the server schedule.')); return; }
    const by = {}; comps.forEach((c) => { (by[groupOf(c.component)] = by[groupOf(c.component)] || []).push(c); });
    Object.keys(by).forEach((g) => center.appendChild(h('div', { class: 'card' }, cardHead(g, [badge(by[g].length + ' component' + (by[g].length === 1 ? '' : 's'), 'mock')]), h('div', { class: 'health-grid' }, by[g].map((c) => h('div', { class: 'health-item ' + (c.status || '') },
      h('span', { class: 'status-dot ' + (TONE[c.status] || '') }), h('span', { class: 'health-name' }, c.component), badge((c.status || 'unknown').toUpperCase(), TONE[c.status] || 'mock'),
      h('span', { class: 'dim health-detail' }, detailText(c.detail)), h('span', { class: 'when', title: fmtDate(c.checked_at) }, relTime(c.checked_at) + (c.duration_ms !== undefined && c.duration_ms !== null ? ' · ' + c.duration_ms + ' ms' : ''))))))));
    center.appendChild(h('p', { class: 'dim' }, h('small', {}, 'Generated ' + fmtDate(d.generated_at))));
  }
  function detailText(d) { if (!d) return ''; if (typeof d === 'string') return d; return Object.keys(d).map((k) => k + ': ' + (typeof d[k] === 'object' ? JSON.stringify(d[k]) : d[k])).join(' · '); }
  try { renderCenter(await ctx.api.get('/api/health/center')); } catch (err) { clear(summary); clear(center); center.appendChild(errorBox(err, () => render(clear(main), params, query, ctx))); }

  // process card (existing /api/health)
  proc.appendChild(skeletonRows(2));
  try {
    const hlt = await ctx.api.get('/api/health');
    clear(proc);
    proc.appendChild(h('div', { class: 'grid cols-3' },
      h('div', { class: 'card' }, cardHead('Process'), kv([['Status', badge(hlt.ok ? 'ok' : 'degraded', hlt.ok ? 'ok' : 'danger')], ['Version', 'MYTHOS Control Center ' + hlt.version], ['Node', hlt.node], ['Uptime', hlt.uptime_s + ' s'], ['Memory (RSS)', hlt.rss_mb + ' MiB']])),
      h('div', { class: 'card' }, cardHead('Databases'), kv([['Panel database', badge(hlt.database && hlt.database.wp ? 'reachable' : 'unreachable', hlt.database && hlt.database.wp ? 'ok' : 'danger')]].concat(((hlt.database && hlt.database.catalogues) || []).map((c) => ['Catalogue · ' + c.id, c.catalog_configured ? badge(c.catalog_reachable ? 'reachable' : 'unreachable (' + (c.error || '?') + ')', c.catalog_reachable ? 'ok' : 'danger') : badge('kitchen-backed', 'mock')])))),
      h('div', { class: 'card' }, cardHead('Authentication'), kv([['Users', badge(hlt.auth && hlt.auth.users_provisioned ? 'provisioned' : 'not usable: ' + (hlt.auth && hlt.auth.users_reason), hlt.auth && hlt.auth.users_provisioned ? 'ok' : 'danger')], ['Accounts', String(hlt.auth && hlt.auth.users_count === undefined ? '—' : hlt.auth.users_count)], ['Session TTL', hlt.auth && hlt.auth.session_ttl_ms ? Math.round(hlt.auth.session_ttl_ms / 3600000) + ' h absolute' : '—'], ['Comms config', badge(hlt.comms_config || 'absent', hlt.comms_config === 'present' ? 'info' : 'mock')]]))));
  } catch (err) { clear(proc); proc.appendChild(errorBox(err)); }
}
