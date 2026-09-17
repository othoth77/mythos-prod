/* MYTHOS Control Center — Audit: the generic audit resource table with
   actor / action / resource / project filters and a previous → next drawer. */
import { h, badge, fmtDate, kv, json, pageHead, drawer, empty } from '../ui.js';
import { dataTable, stateFromQuery, queryFromState, apiQuery } from '../table.js';

export async function render(main, params, query, ctx) {
  const r = ctx.resources().audit;
  ctx.crumbs([{ label: 'Audit' }]);
  main.appendChild(pageHead('System', 'Audit log', 'Who changed what and when, across every surface of the panel. Read-only; every mutation and every sign-in lands here.'));
  if (!r) { main.appendChild(empty('Audit resource not exposed by /api/meta')); return; }
  const state = stateFromQuery(query);
  let project = new URLSearchParams(query || '').get('project') || (ctx.isAll() ? '' : ctx.project());
  const projSel = h('select', { class: 'select', 'aria-label': 'Project filter' }, h('option', { value: '' }, 'Any project'), ctx.projects().map((p) => h('option', { value: p.id, selected: project === p.id || undefined }, p.display_name)));
  const actorIn = h('input', { class: 'input', placeholder: 'actor', 'aria-label': 'Actor filter', value: state.filters.actor || '' });
  const actionIn = h('input', { class: 'input', placeholder: 'action', 'aria-label': 'Action filter', value: state.filters.action || '' });
  const resIn = h('input', { class: 'input', placeholder: 'resource', 'aria-label': 'Resource filter', value: state.filters.resource || '' });
  let table;
  function apply() {
    const fl = Object.assign({}, table.state.filters);
    const set = (k, v) => { if (v) fl[k] = v; else delete fl[k]; };
    set('actor', actorIn.value.trim()); set('action', actionIn.value.trim()); set('resource', resIn.value.trim()); project = projSel.value;
    table.state.filters = fl; table.state.page = 1; pushState(table.state); table.reload();
  }
  [actorIn, actionIn, resIn].forEach((el) => { el.onkeydown = (e) => { if (e.key === 'Enter') apply(); }; });
  projSel.onchange = apply;
  main.appendChild(h('div', { class: 'toolbar audit-filters' }, actorIn, actionIn, resIn, projSel, h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onClick: apply }, 'Apply filters')));
  function pushState(st) { const qs = queryFromState(st); history.replaceState(null, '', '#/audit' + (qs || project ? '?' + qs + (project ? (qs ? '&' : '') + 'project=' + encodeURIComponent(project) : '') : '')); }
  table = dataTable({
    resource: r, state, prefKey: 'audit-v2',
    onState: pushState,
    fetchPage: (st) => ctx.api.get('/api/r/audit' + apiQuery(st, { project: project || undefined })),
    onRow: (row) => detail(row)
  });
  main.appendChild(table.el);
  function detail(e) {
    const d = drawer({ title: (e.action || 'event') + ' · ' + (e.resource || '') + (e.record_id ? ' #' + e.record_id : ''), wide: true });
    d.body.append(kv([['When', fmtDate(e.at)], ['Actor', h('span', {}, e.actor, ' ', badge(e.actor_role))], ['Action', badge(e.action)], ['Resource', e.resource], ['Record', e.record_id ? h('code', {}, e.record_id) : null], ['Project', e.project_id ? ctx.projectName(e.project_id) : null], ['Changed fields', (e.changed_fields || []).join(', ')], ['Request', e.request_id ? h('code', {}, e.request_id) : null], ['Client', e.client]]),
      h('div', { class: 'grid cols-2' }, h('div', {}, h('h4', {}, 'Previous'), json(e.previous)), h('div', {}, h('h4', {}, 'Next'), json(e.next))));
  }
}
