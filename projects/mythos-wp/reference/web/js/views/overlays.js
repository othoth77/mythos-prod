/* MYTHOS WP — product-centric Prices / Stock / References views: the
   catalogue list merged with the verified overlay per part, editable inline. */
import { h, clear, icon, fmtMoney, toast, empty } from '../ui.js';
import { dataTable, stateFromQuery, queryFromState, apiQuery } from '../table.js';
import { recordForm, dirtyGuard } from '../form.js';
import { navigate } from '../router.js';

function head(main, kicker, title, text, actions) {
  main.appendChild(h('div', { class: 'view-head' }, h('div', {}, h('div', { class: 'view-kicker' }, kicker), h('h2', {}, title), h('p', {}, text)), h('div', { class: 'view-actions' }, actions || null)));
}
function fieldsOf(defs) { return defs.map((d) => Object.assign({ type: 'text', listed: true }, d)); }
function productsFilters(R, extra) { return R.products.filters.filter((f) => ['status', 'brand'].includes(f.name)).concat(extra || []); }

function mergedResource(R, key, fields, filters, defaultSort, search) {
  return { key, label: key, fields, filters, defaultSort, search, idColumn: 'id', permissions: R.products.permissions, delete: null, sections: {} };
}

export async function renderPricing(main, params, query, ctx) {
  const R = ctx.resources(), project = ctx.project();
  ctx.crumbs([{ label: 'Prices' }]);
  head(main, 'Commercial', 'Prices', 'Catalogue price (market observation) beside the VERIFIED selling price you set here. Only a verified price can ever be quoted to a customer.');
  if (!project) { main.appendChild(empty('Select a project')); return; }
  const cur = ctx.projectRow().currency;
  const res = mergedResource(R, 'pricing', fieldsOf([
    { name: 'canonical_reference', label: 'Reference', sortable: true }, { name: 'product_title', label: 'Part', sortable: true }, { name: 'product_brand', label: 'Brand', sortable: true },
    { name: 'catalogue_price', label: 'Catalogue price', type: 'number', scale: 2, sortable: false }, { name: 'purchase_price', label: 'Purchase', type: 'number', scale: 2 }, { name: 'selling_price', label: 'Selling (verified)', type: 'number', scale: 2 },
    { name: 'margin', label: 'Margin', type: 'number', scale: 2 }, { name: 'margin_pct', label: 'Margin %', type: 'number', scale: 1 }, { name: 'price_state', label: 'Auto-reply', type: 'enum', enum: ['verified', 'unknown'] }, { name: 'status', label: 'Status', type: 'enum', enum: R.products.fields.find((f) => f.name === 'status').enum, sortable: true }, { name: 'updated_at', label: 'Price updated', type: 'timestamp' }
  ]), productsFilters(R), { field: 'canonical_reference', dir: 'asc' }, ['reference', 'title', 'brand']);
  // The "missing selling price" flag is applied client-side on the merged page: the server filter set is the catalogue's.
  const state = stateFromQuery(query);
  const missingOnly = state.filters.missing_selling === 'true'; delete state.filters.missing_selling;
  let showMissing = missingOnly;
  const table = dataTable({ resource: res, state, prefKey: 'pricing',
    onState: (st) => history.replaceState(null, '', '#/pricing' + (queryFromState(st) ? '?' + queryFromState(st) : '')),
    fetchPage: async (st) => { const page = await ctx.api.get('/api/projects/' + project + '/pricing' + apiQuery(st)); if (showMissing) page.rows = page.rows.filter((r) => r.price_state === 'unknown'); return page; },
    onRow: (row) => navigate('#/part/' + encodeURIComponent(row.product_uid)),
    extraToolbar: [h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: showMissing || undefined, onChange: (e) => { showMissing = e.target.checked; table.reload(); } }), 'Only unknown price (this page)')],
    rowActions: (row) => [ctx.can('operator') ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: () => inlineOverlay(ctx, 'commercial', row, project, cur, table) }, icon('edit'), row.price_state === 'verified' ? 'Edit price' : 'Set price') : null]
  });
  main.appendChild(table.el);
}

export async function renderStock(main, params, query, ctx) {
  const R = ctx.resources(), project = ctx.project();
  ctx.crumbs([{ label: 'Stock' }]);
  head(main, 'Commercial', 'Stock', 'Verified stock per part. A part without a record, or with availability "unknown", is never quoted as available or unavailable.');
  if (!project) { main.appendChild(empty('Select a project')); return; }
  const res = mergedResource(R, 'stockview', fieldsOf([
    { name: 'canonical_reference', label: 'Reference', sortable: true }, { name: 'product_title', label: 'Part', sortable: true }, { name: 'product_brand', label: 'Brand', sortable: true },
    { name: 'catalogue_availability', label: 'Catalogue availability', type: 'enum', enum: ['En Stock', 'Sur Commande', 'Indisponible'] },
    { name: 'availability', label: 'Verified availability', type: 'enum', enum: ['in_stock', 'on_order', 'unavailable', 'unknown'] }, { name: 'quantity', label: 'Qty', type: 'integer' }, { name: 'min_quantity', label: 'Min', type: 'integer' }, { name: 'location', label: 'Location' }, { name: 'lead_time_days', label: 'Lead (days)', type: 'integer' },
    { name: 'stock_state', label: 'State', type: 'enum', enum: ['verified', 'low', 'unknown'] }, { name: 'status', label: 'Status', type: 'enum', enum: R.products.fields.find((f) => f.name === 'status').enum, sortable: true }, { name: 'updated_at', label: 'Stock updated', type: 'timestamp' }
  ]), productsFilters(R), { field: 'canonical_reference', dir: 'asc' }, ['reference', 'title', 'brand']);
  const state = stateFromQuery(query);
  let only = state.filters.low === 'true' ? 'low' : ''; delete state.filters.low;
  const table = dataTable({ resource: res, state, prefKey: 'stock',
    onState: (st) => history.replaceState(null, '', '#/stock' + (queryFromState(st) ? '?' + queryFromState(st) : '')),
    fetchPage: async (st) => { const page = await ctx.api.get('/api/projects/' + project + '/stock' + apiQuery(st)); if (only) page.rows = page.rows.filter((r) => r.stock_state === only); return page; },
    onRow: (row) => navigate('#/part/' + encodeURIComponent(row.product_uid)),
    extraToolbar: [h('select', { class: 'select', 'aria-label': 'State filter (this page)', onChange: (e) => { only = e.target.value; table.reload(); } }, h('option', { value: '' }, 'State: all (this page)'), h('option', { value: 'low', selected: only === 'low' || undefined }, 'Low stock'), h('option', { value: 'unknown' }, 'Unknown'), h('option', { value: 'verified' }, 'Verified'))],
    rowActions: (row) => [ctx.can('operator') ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: () => inlineOverlay(ctx, 'stock', row, project, null, table) }, icon('edit'), row.stock_state === 'unknown' ? 'Set stock' : 'Edit stock') : null]
  });
  main.appendChild(table.el);
}

export async function renderReferences(main, params, query, ctx) {
  const R = ctx.resources(), project = ctx.project();
  ctx.crumbs([{ label: 'References' }]);
  head(main, 'Catalogue', 'References', 'Manufacturer, OEM and pair references per part, with the parts still missing an OEM cross-reference. References are catalogue facts: edit them on the part.');
  if (!project) { main.appendChild(empty('Select a project')); return; }
  const res = mergedResource(R, 'references', fieldsOf([
    { name: 'canonical_reference', label: 'Reference', sortable: true }, { name: 'oem_reference', label: 'OEM reference' }, { name: 'pair_reference', label: 'Pair' }, { name: 'oe_from_specs', label: 'OE (from specs)' },
    { name: 'product_brand', label: 'Brand', sortable: true }, { name: 'product_title', label: 'Part', sortable: true }, { name: 'reference_state', label: 'State', type: 'enum', enum: ['complete', 'missing_oem'] }, { name: 'status', label: 'Status', type: 'enum', enum: R.products.fields.find((f) => f.name === 'status').enum, sortable: true }
  ]), productsFilters(R, [R.products.filters.find((f) => f.name === 'missing_oem')]), { field: 'canonical_reference', dir: 'asc' }, ['reference', 'OEM', 'title']);
  const table = dataTable({ resource: res, state: stateFromQuery(query), prefKey: 'references',
    onState: (st) => history.replaceState(null, '', '#/references' + (queryFromState(st) ? '?' + queryFromState(st) : '')),
    fetchPage: (st) => ctx.api.get('/api/projects/' + project + '/references' + apiQuery(st)),
    onRow: (row) => navigate('#/part/' + encodeURIComponent(row.product_uid)),
    rowActions: (row) => [ctx.can('operator') ? h('a', { class: 'btn btn-ghost btn-sm', href: '#/r/products/' + row.id + '/edit' }, icon('edit'), 'Edit') : null]
  });
  main.appendChild(table.el);
}

/* Inline overlay editor in the confirm dialog (small, focused). */
function inlineOverlay(ctx, key, row, project, cur, table) {
  const r = ctx.resources()[key];
  const dlg = document.getElementById('dialog'); clear(dlg);
  const existing = key === 'commercial' ? (row.price_state === 'verified' || row.purchase_price !== null ? { purchase_price: row.purchase_price, selling_price: row.selling_price, currency: row.selling_currency || cur } : null) : (row.stock_state !== 'unknown' || row.quantity !== null ? { quantity: row.quantity, min_quantity: row.min_quantity, availability: row.availability, location: row.location, lead_time_days: row.lead_time_days } : null);
  const form = recordForm({ resource: r, row: existing || (key === 'commercial' ? { currency: cur } : {}), mode: existing ? 'update' : 'create', hiddenFields: ['product_uid', 'id', 'created_at', 'updated_at', 'updated_by', 'price_note', 'note'],
    onSubmit: async (payload) => { const o = await ctx.api.put('/api/projects/' + project + '/overlay/' + key + '/' + encodeURIComponent(row.product_uid), payload); toast((key === 'commercial' ? 'Price' : 'Stock') + ' ' + (o.created ? 'set' : 'updated') + ' for ' + row.canonical_reference, o.audited ? 'ok' : 'warn'); dirtyGuard.dirty = false; dlg.close(); table.reload(); },
    onCancel: () => { dirtyGuard.dirty = false; dlg.close(); } });
  dlg.appendChild(h('div', { class: 'dialog-body' }, h('h3', {}, (key === 'commercial' ? 'Verified price — ' : 'Verified stock — ') + row.canonical_reference), h('p', {}, row.product_title, key === 'commercial' ? ' · catalogue ' + fmtMoney(row.catalogue_price, row.currency) : ' · catalogue: ' + row.catalogue_availability), form.el));
  dlg.showModal(); form.focus();
}
