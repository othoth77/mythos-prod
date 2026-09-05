/* MYTHOS WP — system health. */
import { h, clear, badge, fmtDate, kv, skeletonRows, errorBox } from '../ui.js';

export async function render(main, params, query, ctx) {
  ctx.crumbs([{ label: 'System health' }]);
  main.appendChild(h('div', { class: 'view-head' }, h('div', {}, h('div', { class: 'view-kicker' }, 'System'), h('h2', {}, 'System health'), h('p', {}, 'The panel process, its database, every project\'s catalogue connection and the authentication store. Secrets are never shown; only presence and reachability.'))));
  const box = h('div', { class: 'stack' }, skeletonRows(4)); main.appendChild(box);
  let hlt;
  try { hlt = await ctx.api.get('/api/health'); } catch (err) { clear(box); box.appendChild(errorBox(err)); return; }
  clear(box);
  box.appendChild(h('div', { class: 'grid cols-3' },
    h('div', { class: 'card' }, h('h3', {}, 'Process'), kv([['Status', badge(hlt.ok ? 'ok' : 'degraded', hlt.ok ? 'ok' : 'danger')], ['Version', 'MYTHOS WP ' + hlt.version], ['Node', hlt.node], ['Uptime', hlt.uptime_s + ' s'], ['Memory (RSS)', hlt.rss_mb + ' MiB']])),
    h('div', { class: 'card' }, h('h3', {}, 'Databases'), kv([['Panel database', badge(hlt.database.wp ? 'reachable' : 'unreachable', hlt.database.wp ? 'ok' : 'danger')]].concat(hlt.database.catalogues.map((c) => ['Catalogue · ' + c.id, c.catalog_configured ? badge(c.catalog_reachable ? 'reachable' : 'unreachable (' + (c.error || '?') + ')', c.catalog_reachable ? 'ok' : 'danger') : badge('not configured', 'warn')])))),
    h('div', { class: 'card' }, h('h3', {}, 'Authentication'), kv([['Users file', badge(hlt.auth.users_provisioned ? 'provisioned' : 'not usable: ' + hlt.auth.users_reason, hlt.auth.users_provisioned ? 'ok' : 'danger')], ['Accounts', String(hlt.auth.users_count === undefined ? '—' : hlt.auth.users_count)], ['Session TTL', Math.round(hlt.auth.session_ttl_ms / 3600000) + ' h absolute'], ['Comms config', badge(hlt.comms_config, hlt.comms_config === 'present' ? 'info' : 'mock')]]))
  ));
  box.appendChild(h('div', { class: 'card' }, h('h3', {}, 'Integrations'), kv([['WhatsApp gateway', 'Existing Evolution gateway on loopback; probed on the Auto-Reply page. Not duplicated, not modified.'], ['Auto-Reply engine', 'projects/automotive/comms (Issue #173), consumed through its business-data port and receiver --integration hook.'], ['Catalogue source of truth', 'The project database (ssangyong_autos for ssangyong.autos); the panel writes to it directly and audits every change.'], ['Conversations log', badge('planned', 'mock')]])));
  box.appendChild(h('p', {}, h('small', { class: 'dim' }, 'Checked ' + fmtDate(new Date().toISOString()))));
}
