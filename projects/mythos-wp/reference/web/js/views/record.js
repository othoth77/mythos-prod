/* MYTHOS WP — record detail / create / edit for any registry resource. */
import { h, clear, icon, badge, fmtDate, toast, confirmDialog, kv, json, skeletonRows, errorBox, empty } from '../ui.js';
import { recordForm, dirtyGuard } from '../form.js';
import { cellValue } from '../table.js';
import { navigate } from '../router.js';

function projectQs(ctx, r) { const needs = r.scope === 'catalog' || (r.scope === 'wp' && !r.global); return ctx.api.qs({ project: needs ? ctx.project() : undefined }); }
function lookup(ctx) { return (resource, q, display, by) => ctx.api.get('/api/r/' + resource + '/lookup' + ctx.api.qs({ project: ctx.project(), q, display, by })); }
function title(r, row) { return r.titleField && row[r.titleField] ? String(row[r.titleField]) : (r.singular || 'Record') + ' #' + row[r.idColumn]; }

export async function render(main, params, query, ctx) {
  const r = ctx.resources()[params.resource];
  if (!r) { main.appendChild(empty('Unknown resource')); return; }
  if (r.key === 'products') {
    // parts have their own full view by uid; resolve id → uid
    const d = await ctx.api.get('/api/r/products/' + encodeURIComponent(params.id) + projectQs(ctx, r));
    navigate('#/part/' + encodeURIComponent(d.row.product_uid), true); return;
  }
  ctx.crumbs([{ label: r.label, href: '#/r/' + r.key }, { label: '#' + params.id }]);
  const box = h('div', {}, skeletonRows(6)); main.appendChild(box);
  let d;
  try { d = await ctx.api.get('/api/r/' + r.key + '/' + encodeURIComponent(params.id) + projectQs(ctx, r)); } catch (err) { clear(box); box.appendChild(errorBox(err)); return; }
  clear(box);
  const row = d.row;
  ctx.crumbs([{ label: r.label, href: '#/r/' + r.key }, { label: title(r, row) }]);
  ctx.remember({ label: r.singular + ': ' + title(r, row), route: '#/r/' + r.key + '/' + row[r.idColumn] });
  const canWrite = r.permissions.write && ctx.can(r.permissions.write);
  const canDelete = r.delete && r.permissions.delete && ctx.can(r.permissions.delete);
  box.appendChild(h('div', { class: 'view-head' },
    h('div', {}, h('div', { class: 'view-kicker' }, r.singular || r.label), h('h2', {}, title(r, row)), row.status ? h('p', {}, badge(row.status)) : null),
    h('div', { class: 'view-actions' },
      h('a', { class: 'btn btn-ghost', href: '#/r/' + r.key }, icon('back'), 'Back to list'),
      canWrite ? h('a', { class: 'btn btn-primary', href: '#/r/' + r.key + '/' + encodeURIComponent(row[r.idColumn]) + '/edit' }, icon('edit'), 'Edit') : null,
      canDelete ? h('button', { class: 'btn btn-danger', type: 'button', onClick: async () => {
        if (!await confirmDialog({ title: r.delete.label + ' this ' + (r.singular || 'record').toLowerCase() + '?', body: 'This action is audited.', confirmLabel: r.delete.label, danger: true })) return;
        try { await ctx.api.del('/api/r/' + r.key + '/' + encodeURIComponent(row[r.idColumn]) + projectQs(ctx, r)); toast('Done.', 'ok'); navigate('#/r/' + r.key); } catch (err) { toast(err.detail || 'Failed.', 'danger', 6000); }
      } }, icon('trash'), r.delete.label) : null)));
  // handoff quick status actions
  if (r.key === 'handoffs' && canWrite) {
    const next = { NEW: 'REQUIRES_HUMAN', REQUIRES_HUMAN: 'IN_PROGRESS', IN_PROGRESS: 'RESOLVED' }[row.status];
    box.appendChild(h('div', { class: 'notice accent' }, h('strong', {}, 'Handoff workflow. '), 'Status ', badge(row.status), next ? h('button', { class: 'btn btn-sm btn-secondary', type: 'button', style: undefined, onClick: async () => {
      const body = { status: next };
      if (next === 'IN_PROGRESS' && !row.assigned_to) body.assigned_to = ctx.state.meta.user.username;
      try { await ctx.api.patch('/api/r/handoffs/' + row.id + projectQs(ctx, r), body); toast('Handoff → ' + next, 'ok'); render(clear(main), params, query, ctx); } catch (err) { toast(err.detail || 'Failed.', 'danger'); }
    } }, ' → ' + next.replace(/_/g, ' ')) : ' (closed)'));
  }
  const sections = r.sections && Object.keys(r.sections).length ? r.sections : { main: 'Record' };
  const grid = h('div', { class: 'record-grid' });
  const left = h('div', { class: 'stack' });
  Object.keys(sections).forEach((s) => {
    const fields = r.fields.filter((f) => (f.section || Object.keys(sections)[0]) === s && !f.virtual || (f.virtual && s === Object.keys(sections)[0]));
    if (!fields.length) return;
    left.appendChild(h('div', { class: 'card' }, h('h3', {}, sections[s]), kv(fields.map((f) => {
      const v = row[f.name];
      if (f.type === 'json') return [f.label, v === null || v === undefined ? null : json(v)];
      if (f.type === 'url' && v) return [f.label, h('a', { href: v, target: '_blank', rel: 'noopener noreferrer' }, v, ' ', icon('external')), 'mono'];
      if (f.render === 'image' && v) return [f.label, h('img', { src: v, alt: row.image_alt || '', style: undefined, class: 'thumb', width: 120 })];
      const c = cellValue(f, row); return [f.label, c.node, c.cls];
    }))));
  });
  grid.appendChild(left);
  grid.appendChild(h('div', { class: 'stack' }, h('div', { class: 'card' }, h('h3', {}, 'Change history'), d.history && d.history.length ? h('div', { class: 'timeline' }, d.history.map((e) => h('div', { class: 'ev' }, h('span', { class: 'when' }, fmtDate(e.at)), h('span', { class: 'what' }, h('strong', {}, e.actor), ' ', badge(e.action), e.changed_fields && e.changed_fields.length ? h('code', {}, ' ' + e.changed_fields.join(', ')) : null, e.action === 'update' && e.previous ? h('details', {}, h('summary', {}, 'diff'), json({ previous: e.previous, next: e.next })) : null)))) : h('p', {}, 'No audited change for this record.'))));
  box.appendChild(grid);
}

export async function renderNew(main, params, query, ctx) {
  const r = ctx.resources()[params.resource];
  if (!r || !r.permissions.write) { main.appendChild(empty('Not available')); return; }
  if (!ctx.can(r.permissions.write)) { main.appendChild(empty('Not allowed', 'Creating ' + r.label.toLowerCase() + ' requires the ' + r.permissions.write + ' role.')); return; }
  ctx.crumbs([{ label: r.label, href: '#/r/' + r.key }, { label: 'New' }]);
  main.appendChild(h('div', { class: 'view-head' }, h('div', {}, h('div', { class: 'view-kicker' }, r.label), h('h2', {}, 'New ' + (r.singular || 'record').toLowerCase()))));
  const prefill = {}; new URLSearchParams(query).forEach((v, k) => { prefill[k] = v; });
  const form = recordForm({ resource: r, row: prefill, mode: 'create', lookup: lookup(ctx),
    onSubmit: async (payload) => { const o = await ctx.api.post('/api/r/' + r.key + projectQs(ctx, r), payload); toast((r.singular || 'Record') + ' created' + (o.audited ? '' : ' (audit write failed)'), o.audited ? 'ok' : 'warn'); dirtyGuard.dirty = false; navigate(r.key === 'products' ? '#/part/' + encodeURIComponent(o.row.product_uid) : '#/r/' + r.key + '/' + encodeURIComponent(o.row[r.idColumn])); if (r.key === 'projects') ctx.refreshMeta(); },
    onCancel: () => navigate('#/r/' + r.key) });
  main.appendChild(h('div', { class: 'card' }, form.el)); form.focus();
}

export async function renderEdit(main, params, query, ctx) {
  const r = ctx.resources()[params.resource];
  if (!r || !r.permissions.write) { main.appendChild(empty('Not available')); return; }
  if (!ctx.can(r.permissions.write)) { main.appendChild(empty('Not allowed', 'Editing requires the ' + r.permissions.write + ' role.')); return; }
  const box = h('div', {}, skeletonRows(6)); main.appendChild(box);
  let d;
  try { d = await ctx.api.get('/api/r/' + r.key + '/' + encodeURIComponent(params.id) + projectQs(ctx, r)); } catch (err) { clear(box); box.appendChild(errorBox(err)); return; }
  clear(box);
  const row = d.row;
  const back = r.key === 'products' ? '#/part/' + encodeURIComponent(row.product_uid) : '#/r/' + r.key + '/' + encodeURIComponent(row[r.idColumn]);
  ctx.crumbs([{ label: r.label, href: '#/r/' + r.key }, { label: title(r, row), href: back }, { label: 'Edit' }]);
  box.appendChild(h('div', { class: 'view-head' }, h('div', {}, h('div', { class: 'view-kicker' }, r.singular || r.label), h('h2', {}, 'Edit: ', title(r, row)))));
  const form = recordForm({ resource: r, row, mode: 'update', lookup: lookup(ctx),
    onSubmit: async (payload) => { const o = await ctx.api.patch('/api/r/' + r.key + '/' + encodeURIComponent(row[r.idColumn]) + projectQs(ctx, r), payload); toast('Saved: ' + (o.changed || []).join(', '), o.audited ? 'ok' : 'warn'); dirtyGuard.dirty = false; navigate(back); if (r.key === 'projects') ctx.refreshMeta(); },
    onCancel: () => navigate(back) });
  box.appendChild(h('div', { class: 'card' }, form.el)); form.focus();
}
