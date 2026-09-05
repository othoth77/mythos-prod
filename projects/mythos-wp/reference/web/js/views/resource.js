/* MYTHOS WP — generic resource list view (any registry resource). */
import { h, icon, toast, confirmDialog, empty } from '../ui.js';
import { dataTable, stateFromQuery, queryFromState, apiQuery } from '../table.js';
import { navigate } from '../router.js';

export async function render(main, params, query, ctx) {
  const r = ctx.resources()[params.resource];
  if (!r) { main.appendChild(empty('Unknown resource')); return; }
  const project = ctx.project();
  const needsProject = r.scope === 'catalog' || (r.scope === 'wp' && !r.global && !r.projectOptional);
  ctx.crumbs([{ label: r.label }]);
  main.appendChild(h('div', { class: 'view-head' },
    h('div', {}, h('div', { class: 'view-kicker' }, groupLabel(ctx, r.group)), h('h2', {}, r.label), h('p', {}, describe(r))),
    h('div', { class: 'view-actions' }, r.permissions.write && ctx.can(r.permissions.write) ? h('a', { class: 'btn btn-primary', href: '#/r/' + r.key + '/new' }, icon('plus'), 'New ' + (r.singular || 'record').toLowerCase()) : null)));
  if (needsProject && !project) { main.appendChild(empty('Select a project', 'This resource belongs to a project.')); return; }
  const state = stateFromQuery(query);
  const canDelete = r.delete && r.permissions.delete && ctx.can(r.permissions.delete);
  const table = dataTable({
    resource: r, state,
    onState: (st) => history.replaceState(null, '', '#/r/' + r.key + (queryFromState(st) ? '?' + queryFromState(st) : '')),
    fetchPage: (st) => ctx.api.get('/api/r/' + r.key + apiQuery(st, { project: needsProject || r.projectOptional ? project : undefined })),
    onRow: (row) => navigate(rowRoute(r, row)),
    emptyAction: r.permissions.write && ctx.can(r.permissions.write) ? h('a', { class: 'btn btn-secondary', href: '#/r/' + r.key + '/new' }, 'Create the first ' + (r.singular || 'record').toLowerCase()) : null,
    rowActions: (row) => [
      h('a', { class: 'btn btn-ghost btn-sm', href: rowRoute(r, row), 'aria-label': 'Open' }, 'Open'),
      r.permissions.write && ctx.can(r.permissions.write) ? h('a', { class: 'btn btn-ghost btn-sm', href: '#/r/' + r.key + '/' + encodeURIComponent(row[r.idColumn]) + '/edit', 'aria-label': 'Edit' }, icon('edit')) : null,
      canDelete ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'aria-label': r.delete.label, onClick: async () => {
        const ok = await confirmDialog({ title: r.delete.label + ' ' + (r.singular || 'record').toLowerCase() + ' #' + row[r.idColumn] + '?', body: r.delete.kind === 'soft' ? 'The record is kept and marked "' + 'delisted' + '". This is audited.' : 'This permanently removes the record. This is audited.', confirmLabel: r.delete.label, danger: true });
        if (!ok) return;
        try { await ctx.api.del('/api/r/' + r.key + '/' + encodeURIComponent(row[r.idColumn]) + ctx.api.qs({ project: needsProject ? project : undefined })); toast((r.singular || 'Record') + ' ' + (r.delete.kind === 'soft' ? 'delisted' : 'deleted') + '.', 'ok'); table.reload(); }
        catch (err) { toast(err.detail || 'Delete failed.', 'danger', 6000); }
      } }, icon('trash')) : null
    ]
  });
  main.appendChild(table.el);
}

export function rowRoute(r, row) {
  if (r.key === 'products' && row.product_uid) return '#/part/' + encodeURIComponent(row.product_uid);
  return '#/r/' + r.key + '/' + encodeURIComponent(row[r.idColumn]);
}
function groupLabel(ctx, g) { const grp = (ctx.state.meta.groups || []).find((x) => x.key === g); return grp ? grp.label : g; }
function describe(r) {
  return {
    products: 'Every part of the catalogue: identity, references, brand, catalogue price and status. Open a part for its fitments, images, verified price and stock.',
    vehicle_models: 'Vehicle models the catalogue knows; compatibility and motorizations hang off them.',
    motorizations: 'Engine variants per vehicle model, with year ranges.',
    compatibility: 'Which part fits which vehicle model and motorization. The only source the auto-reply may use for a compatibility claim.',
    images: 'Product images (https URLs) by part and position.',
    commercial: 'Verified commercial layer per part. Only a selling price recorded here can ever be quoted automatically.',
    stock: 'Verified stock layer per part. "unknown" is never quoted.',
    knowledge: 'Customer-facing knowledge the auto-reply may use verbatim, when active and explicitly allowed.',
    rules: 'Per-project business configuration as JSON values (opening hours, delivery zones, …). Owner only.',
    handoffs: 'Conversations the auto-reply handed to a human: NEW → REQUIRES_HUMAN → IN_PROGRESS → RESOLVED. Numbers are masked; no message text is stored.',
    audit: 'Who changed what and when. Read-only.',
    projects: 'MYTHOS AUTO projects and the catalogue connection each one uses.'
  }[r.key] || '';
}
