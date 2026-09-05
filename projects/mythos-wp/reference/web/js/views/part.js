/* MYTHOS WP — the Part editor / full record: identity, product, compatibility,
   commercial (verified price), stock, media, Auto-Reply facts, audit. */
import { h, clear, icon, badge, fmtDate, fmtMoney, fmtNum, toast, confirmDialog, kv, json, skeletonRows, errorBox } from '../ui.js';
import { recordForm, dirtyGuard } from '../form.js';
import { navigate } from '../router.js';

export async function render(main, params, query, ctx) {
  const uid = params.uid, project = ctx.project();
  ctx.crumbs([{ label: 'Products / Parts', href: '#/r/products' }, { label: uid }]);
  const box = h('div', {}, skeletonRows(8)); main.appendChild(box);
  let d;
  try { d = await ctx.api.get('/api/projects/' + project + '/parts/' + encodeURIComponent(uid)); } catch (err) { clear(box); box.appendChild(errorBox(err)); return; }
  clear(box);
  const p = d.product, cur = ctx.projectRow() ? ctx.projectRow().currency : 'TND';
  ctx.crumbs([{ label: 'Products / Parts', href: '#/r/products' }, { label: p.canonical_reference + ' — ' + p.product_title }]);
  ctx.remember({ label: 'Part ' + p.canonical_reference, route: '#/part/' + encodeURIComponent(uid) });
  const canWrite = ctx.can('operator'), canDelete = ctx.can('owner');
  const qs = ctx.api.qs({ project });
  const reload = () => render(clear(main), params, query, ctx);

  box.appendChild(h('div', { class: 'view-head' },
    h('div', {}, h('div', { class: 'view-kicker' }, p.product_brand + ' · ' + p.product_uid), h('h2', {}, p.canonical_reference, ' ', h('span', { class: 'dim' }, '— ' + p.product_title)), h('p', {}, badge(p.status), ' ', badge(p.availability), p.oem_reference ? h('span', { class: 'mono' }, '  OEM ' + p.oem_reference) : h('span', { class: 'dim' }, '  no OEM reference'))),
    h('div', { class: 'view-actions' },
      h('a', { class: 'btn btn-ghost', href: '#/r/products' }, icon('back'), 'All parts'),
      canWrite ? h('a', { class: 'btn btn-primary', href: '#/r/products/' + p.id + '/edit' }, icon('edit'), 'Edit part') : null,
      canDelete && p.status !== 'delisted' ? h('button', { class: 'btn btn-danger', type: 'button', onClick: async () => {
        if (!await confirmDialog({ title: 'Delist this part?', body: 'The part stays in the catalogue with status "delisted" and leaves every list of active parts. Audited.', confirmLabel: 'Delist', danger: true })) return;
        try { await ctx.api.del('/api/r/products/' + p.id + qs); toast('Part delisted.', 'ok'); reload(); } catch (err) { toast(err.detail || 'Failed.', 'danger'); }
      } }, icon('trash'), 'Delist') : null)));

  // Auto-Reply facts banner
  const f = d.auto_reply_facts;
  box.appendChild(h('div', { class: 'card', style: undefined }, h('div', { class: 'card-head' }, h('h3', {}, 'What the auto-reply may say about this part'), h('a', { class: 'btn btn-ghost btn-sm', href: '#/autoreply' }, 'Control centre')),
    h('div', { class: 'gate-list' }, Object.keys(f).map((k) => h('span', { class: 'fact' }, k.replace(/_/g, ' '), badge(f[k])))),
    h('p', {}, 'VERIFIED facts come from this panel\'s data layers. UNKNOWN facts make a customer question REQUIRES_HUMAN — never a guess.')));

  const grid = h('div', { class: 'record-grid' });
  const left = h('div', { class: 'stack' }), right = h('div', { class: 'stack' });
  grid.append(left, right); box.appendChild(grid);

  // Identity / product / catalogue commercial
  left.appendChild(h('div', { class: 'card' }, h('h3', {}, 'Identity'), kv([['Internal ID', String(p.id), 'mono'], ['SKU / UID', p.product_uid, 'mono'], ['Reference', p.canonical_reference, 'mono'], ['OEM reference', p.oem_reference, 'mono'], ['Pair reference', p.pair_reference, 'mono'], ['Source', p.source], ['Source URL', p.product_url ? h('a', { href: p.product_url, target: '_blank', rel: 'noopener noreferrer' }, p.product_url) : null, 'mono']])));
  left.appendChild(h('div', { class: 'card' }, h('h3', {}, 'Product'), kv([['Brand', p.product_brand], ['Title', p.product_title], ['Description / criteria', p.criteria_text], ['Technical specs', p.technical_specs ? json(p.technical_specs) : null], ['Catalogue price', fmtMoney(p.price_tnd, p.currency), 'mono'], ['Catalogue availability', badge(p.availability)], ['Delivery note', p.delivery_note]])));

  // Compatibility
  left.appendChild(h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, 'Compatibility (' + d.compatibility.length + ')'), canWrite ? h('a', { class: 'btn btn-secondary btn-sm', href: '#/r/compatibility/new?product_id=' + p.id }, icon('plus'), 'Add fitment') : null),
    d.compatibility.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'data compact' }, h('thead', {}, h('tr', {}, h('th', {}, 'Model'), h('th', {}, 'Generation'), h('th', {}, 'Motorization'), h('th', {}, 'Years'), h('th', { class: 'actions' }, ''))), h('tbody', {}, d.compatibility.map((c) => h('tr', { onClick: () => navigate('#/r/compatibility/' + c.id) }, h('td', {}, c.model_name || '#' + c.vehicle_model_id), h('td', { class: 'mono' }, c.generation_code || '—'), h('td', {}, c.motorisation), h('td', { class: 'mono' }, (c.year_from || '?') + ' – ' + (c.year_to || 'now')), h('td', { class: 'actions' }, h('a', { class: 'btn btn-ghost btn-sm', href: '#/r/compatibility/' + c.id + '/edit', onClick: (e) => e.stopPropagation() }, icon('edit')))))))) : h('div', { class: 'empty' }, h('strong', {}, 'No fitment recorded'), 'Compatibility questions about this part are handed to a human.')));

  // Media
  left.appendChild(h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, 'Media (' + d.images.length + ')'), canWrite ? h('a', { class: 'btn btn-secondary btn-sm', href: '#/r/images/new?product_id=' + p.id }, icon('plus'), 'Add image') : null),
    d.images.length ? h('div', { class: 'gallery' }, d.images.map((im) => h('a', { href: '#/r/images/' + im.id, title: im.image_alt || im.image_filename || '' }, h('img', { src: im.image_url, alt: im.image_alt || '', loading: 'lazy' })))) : h('div', { class: 'empty' }, h('strong', {}, 'No image'))));

  // Commercial overlay (verified selling price)
  right.appendChild(overlayCard(ctx, 'commercial', 'Commercial (verified)', d.commercial, uid, project, canWrite, reload, cur, (row) => kv([['Selling price', row ? fmtMoney(row.selling_price, row.currency) : null, 'mono'], ['Purchase price', row ? fmtMoney(row.purchase_price, row.currency) : null, 'mono'], ['Margin', row && row.selling_price !== null && row.purchase_price !== null ? fmtMoney(Number(row.selling_price) - Number(row.purchase_price), row.currency) + ' (' + fmtNum((Number(row.selling_price) - Number(row.purchase_price)) / Number(row.selling_price) * 100, 1) + ' %)' : null, 'mono'], ['Note', row ? row.price_note : null], ['Updated', row ? fmtDate(row.updated_at) + (row.updated_by ? ' by ' + row.updated_by : '') : null, 'mono']]), 'No verified price. Price questions are REQUIRES_HUMAN.'));
  right.appendChild(overlayCard(ctx, 'stock', 'Stock (verified)', d.stock, uid, project, canWrite, reload, cur, (row) => kv([['Availability', row ? badge(row.availability) : null], ['Quantity', row ? fmtNum(row.quantity, 0) : null, 'mono'], ['Minimum', row ? fmtNum(row.min_quantity, 0) : null, 'mono'], ['Location', row ? row.location : null], ['Lead time', row && row.lead_time_days !== null ? row.lead_time_days + ' days' : null], ['Note', row ? row.note : null], ['Updated', row ? fmtDate(row.updated_at) + (row.updated_by ? ' by ' + row.updated_by : '') : null, 'mono']]), 'No stock record. Availability questions are REQUIRES_HUMAN.'));

  // Knowledge + handoffs + audit
  right.appendChild(h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, 'Auto-Reply knowledge (' + d.knowledge.length + ')'), canWrite ? h('a', { class: 'btn btn-secondary btn-sm', href: '#/r/knowledge/new?product_uid=' + encodeURIComponent(uid) + '&kind=product_fact' }, icon('plus'), 'Add') : null),
    d.knowledge.length ? h('div', { class: 'fact-list' }, d.knowledge.map((k) => h('a', { class: 'fact', href: '#/r/knowledge/' + k.id }, h('span', {}, k.title, ' ', h('small', { class: 'dim' }, k.kind + ' · ' + k.language)), h('span', {}, badge(k.status), ' ', badge(k.allowed_for_auto_reply ? 'allowed' : 'not allowed', k.allowed_for_auto_reply ? 'ok' : 'mock'))))) : h('p', {}, 'No customer-facing knowledge for this part.')));
  if (d.open_handoffs.length) right.appendChild(h('div', { class: 'card' }, h('h3', {}, 'Open handoffs about this part'), h('div', { class: 'fact-list' }, d.open_handoffs.map((x) => h('a', { class: 'fact', href: '#/r/handoffs/' + x.id }, '#' + x.id + ' ' + x.reason + (x.intent ? ' · ' + x.intent : ''), badge(x.status))))));
  right.appendChild(h('div', { class: 'card' }, h('h3', {}, 'Audit'), kv([['Collected', fmtDate(p.collected_at), 'mono'], ['Last checked', fmtDate(p.last_checked_at), 'mono'], ['Created', fmtDate(p.created_at), 'mono'], ['Updated', fmtDate(p.updated_at), 'mono']]),
    d.history.length ? h('div', { class: 'timeline' }, d.history.map((e) => h('div', { class: 'ev' }, h('span', { class: 'when' }, fmtDate(e.at)), h('span', { class: 'what' }, h('strong', {}, e.actor), ' ', badge(e.action), e.changed_fields && e.changed_fields.length ? h('code', {}, ' ' + e.changed_fields.join(', ')) : null, e.previous ? h('details', {}, h('summary', {}, 'diff'), json({ previous: e.previous, next: e.next })) : null)))) : h('p', {}, 'No panel change recorded for this part yet (imported by the catalogue migration).')));
}

function overlayCard(ctx, key, title, row, uid, project, canWrite, reload, cur, describe, emptyText) {
  const r = ctx.resources()[key];
  const card = h('div', { class: 'card' });
  const head = h('div', { class: 'card-head' }, h('h3', {}, title), canWrite ? h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onClick: edit }, icon('edit'), row ? 'Edit' : 'Set') : null);
  const body = h('div', {}, row ? describe(row) : h('div', { class: 'empty' }, h('strong', {}, emptyText.split('.')[0]), emptyText.split('.').slice(1).join('.')));
  card.append(head, body);
  function edit() {
    clear(body);
    const form = recordForm({ resource: r, row: row || { product_uid: uid, currency: cur }, mode: row ? 'update' : 'create', hiddenFields: ['product_uid', 'id', 'created_at', 'updated_at', 'updated_by'],
      onSubmit: async (payload) => { const o = await ctx.api.put('/api/projects/' + project + '/overlay/' + key + '/' + encodeURIComponent(uid), payload); toast(title + ' ' + (o.created ? 'set' : 'updated') + '.', o.audited ? 'ok' : 'warn'); dirtyGuard.dirty = false; reload(); },
      onCancel: () => { dirtyGuard.dirty = false; reload(); } });
    body.appendChild(form.el); form.focus();
  }
  return card;
}
