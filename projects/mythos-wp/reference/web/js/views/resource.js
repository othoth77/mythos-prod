/* MYTHOS WP — generic resource list view (any registry resource). */
import { h, icon, toast, confirmDialog, empty } from '../ui.js';
import { dataTable, stateFromQuery, queryFromState, apiQuery } from '../table.js';
import { navigate } from '../router.js';

export async function render(main, params, query, ctx) {
  const r = ctx.resources()[params.resource];
  if (!r) { main.appendChild(empty('Unknown resource')); return; }
  const project = ctx.projectId();
  const needsProject = r.scope === 'catalog' || (r.scope === 'wp' && !r.global && !r.projectOptional);
  ctx.crumbs([{ label: r.label }]);
  main.appendChild(h('div', { class: 'view-head' },
    h('div', {}, h('div', { class: 'view-kicker' }, groupLabel(ctx, r.group)), h('h2', {}, r.label), h('p', {}, describe(r))),
    h('div', { class: 'view-actions' }, r.permissions.write && ctx.can(r.permissions.write) ? h('a', { class: 'btn btn-primary', href: '#/r/' + r.key + '/new' }, icon('plus'), 'New ' + (r.singular || 'record').toLowerCase()) : null)));
  if (needsProject && !project) { main.appendChild(projectPicker(ctx, r)); return; }
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

export function rowRoute(r, row) { return '#/r/' + r.key + '/' + encodeURIComponent(row[r.idColumn]); }
function projectPicker(ctx, r) {
  return h('div', { class: 'card' }, h('h3', {}, 'Pick a project'), h('p', {}, (r.label || 'This resource') + ' belongs to one project. Choose which one to work on:'), h('div', { class: 'view-actions wrap' }, ctx.projects().map((p) => h('button', { class: 'btn btn-secondary', type: 'button', onClick: () => { ctx.setProject(p.id); location.hash = '#/r/' + r.key; window.dispatchEvent(new HashChangeEvent('hashchange')); } }, p.display_name))));
}
function groupLabel(ctx, g) { const grp = (ctx.state.meta.groups || []).find((x) => x.key === g); return grp ? grp.label : g; }
function describe(r) {
  return {
    knowledge: 'Customer-facing knowledge an agent may use verbatim, when active and explicitly allowed for auto-reply.',
    rules: 'Per-project business configuration as JSON values (opening hours, delivery zones, …). Owner only.',
    handoffs: 'Conversations handed between the AI and humans: NEW → REQUIRES_HUMAN → IN_PROGRESS → RESOLVED. Numbers are masked; no message text is stored.',
    audit: 'Who changed what and when. Read-only.',
    projects: 'Every business the Control Center serves.',
    users: 'Panel accounts, roles and project access.',
    tags: 'Labels for conversations and contacts.',
    inboxes: 'Legacy inbox registry: number ↔ project links with their switches. Prefer WhatsApp → Numbers.',
    inbox_members: 'Users restricted to specific inboxes (visibility scope).'
  }[r.key] || '';
}
