/* MYTHOS WP — dashboard: real counts only; unavailable sources show as such. */
import { h, clear, badge, fmtDate, skeletonRows, errorBox, empty } from '../ui.js';

function stat(label, value, sub, tone, href) {
  const na = value === null || value === undefined;
  const card = h(href ? 'a' : 'div', { class: 'card stat link ' + (na ? '' : tone || ''), href: href || undefined },
    h('span', { class: 'stat-label' }, label),
    h('span', { class: 'stat-value' + (na ? ' na' : '') }, na ? 'unavailable' : Number(value).toLocaleString()),
    sub ? h('span', { class: 'stat-sub' }, sub) : null);
  return card;
}

export async function render(main, params, query, ctx) {
  ctx.crumbs([{ label: 'Dashboard' }]);
  const p = ctx.projectRow();
  if (!p) { main.appendChild(empty('No project', 'Create a project in Projects to start managing data.', h('a', { class: 'btn btn-primary', href: '#/r/projects/new' }, 'New project'))); return; }
  main.appendChild(h('div', { class: 'view-head' }, h('div', {}, h('div', { class: 'view-kicker' }, p.domain || p.id), h('h2', {}, 'Dashboard'), h('p', {}, 'Operational state of ', p.display_name, '. Every figure is a live count; nothing is estimated.'))));
  const body = h('div', { class: 'stack' }, skeletonRows(4)); main.appendChild(body);
  let d;
  try { d = await ctx.api.get('/api/projects/' + p.id + '/dashboard'); } catch (err) { clear(body); body.appendChild(errorBox(err, () => render(clear(main), params, query, ctx))); return; }
  clear(body);
  const c = d.cards;
  if (d.catalogue.available === false) body.appendChild(h('div', { class: 'notice danger' }, h('strong', {}, 'Catalogue unavailable. '), 'Reason: ' + d.catalogue.reason + '. Catalogue-backed figures are shown as unavailable rather than zero.'));
  body.appendChild(h('div', { class: 'grid cols-4' },
    stat('Total records', c.total_records, 'catalogue parts', '', '#/r/products'),
    stat('Active parts', c.active_products, 'status active / updated', 'ok', '#/r/products?f.status=active'),
    stat('Missing verified price', c.missing_prices, 'active parts without a selling price', c.missing_prices > 0 ? 'warn' : 'ok', '#/pricing?f.missing_selling=true'),
    stat('Missing OEM reference', c.missing_references, 'no cross-reference recorded', c.missing_references > 0 ? 'warn' : 'ok', '#/references?f.missing_oem=true'),
    stat('Low stock', c.low_stock, 'quantity at or below minimum', c.low_stock > 0 ? 'danger' : 'ok', '#/stock?f.low=true'),
    stat('Stock untracked', c.stock_untracked, 'active parts without a stock record', c.stock_untracked > 0 ? 'warn' : 'ok', '#/stock'),
    stat('Modified (7 days)', c.recently_modified, 'catalogue parts updated', '', '#/r/products?sort=updated_at&dir=desc'),
    stat('Open handoffs', c.handoff_open, 'NEW · REQUIRES_HUMAN · IN_PROGRESS', c.handoff_open > 0 ? 'danger' : 'ok', '#/r/handoffs')
  ));
  const s = d.catalogue.available === false ? null : d.catalogue.structure;
  body.appendChild(h('div', { class: 'grid cols-3' },
    h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, 'Catalogue structure')), s ? h('dl', { class: 'kv' },
      h('dt', {}, 'Vehicle models'), h('dd', {}, String(s.models)), h('dt', {}, 'Motorizations'), h('dd', {}, String(s.motorizations)),
      h('dt', {}, 'Compatibility rows'), h('dd', {}, String(s.compatibility)), h('dt', {}, 'Images'), h('dd', {}, String(s.images)),
      h('dt', {}, 'Parts without fitment'), h('dd', {}, badge(String(s.without_compatibility), s.without_compatibility ? 'warn' : 'ok')),
      h('dt', {}, 'Parts without image'), h('dd', {}, badge(String(s.without_images), s.without_images ? 'warn' : 'ok'))) : h('p', {}, 'Unavailable.')),
    h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, 'MYTHOS AUTO data layer'), h('a', { class: 'btn btn-ghost btn-sm', href: '#/autoreply' }, 'Control centre')),
      h('dl', { class: 'kv' },
        h('dt', {}, 'Verified prices'), h('dd', {}, String(d.panel.commercial.priced_active === null ? '—' : d.panel.commercial.priced_active)),
        h('dt', {}, 'Stock tracked'), h('dd', {}, String(d.panel.stock.tracked)), h('dt', {}, 'In stock'), h('dd', {}, String(d.panel.stock.in_stock)),
        h('dt', {}, 'Knowledge allowed'), h('dd', {}, String(d.panel.knowledge.active_allowed) + ' / ' + d.panel.knowledge.total),
        h('dt', {}, 'Business rules'), h('dd', {}, String(d.panel.rules_enabled) + ' enabled')),
      h('p', {}, 'Price, stock, compatibility and references reach the auto-reply only when verified here; anything else is REQUIRES_HUMAN.')),
    h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, 'Handoff queue'), h('a', { class: 'btn btn-ghost btn-sm', href: '#/r/handoffs' }, 'Open')),
      h('div', { class: 'fact-list' }, ['NEW', 'REQUIRES_HUMAN', 'IN_PROGRESS', 'RESOLVED'].map((st) => h('a', { class: 'fact', href: '#/r/handoffs?f.status=' + st }, badge(st), h('strong', {}, String(d.panel.handoffs[st] || 0))))))
  ));
  body.appendChild(h('div', { class: 'grid cols-2' },
    h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, 'Recently modified parts')),
      s && d.catalogue.recent.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'data compact' }, h('tbody', {}, d.catalogue.recent.map((r) => h('tr', { onClick: () => { location.hash = '#/part/' + encodeURIComponent(r.product_uid); } }, h('td', { class: 'mono' }, r.canonical_reference), h('td', {}, r.product_title), h('td', {}, badge(r.status)), h('td', { class: 'mono dim' }, fmtDate(r.updated_at))))))) : h('p', {}, 'No catalogue data.')),
    h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, 'Recent activity'), h('a', { class: 'btn btn-ghost btn-sm', href: '#/r/audit' }, 'Audit log')),
      d.recent_audit.length ? h('div', { class: 'timeline' }, d.recent_audit.map((e) => h('div', { class: 'ev' }, h('span', { class: 'when' }, fmtDate(e.at)), h('span', { class: 'what' }, h('strong', {}, e.actor), ' ', badge(e.action), ' ', e.resource, e.record_id ? h('code', {}, ' #' + e.record_id) : null, e.changed_fields && e.changed_fields.length ? h('code', {}, ' ' + e.changed_fields.slice(0, 4).join(', ')) : null)))) : h('p', {}, 'No audited change yet.'))
  ));
  body.appendChild(h('p', { class: 'dim', style: undefined }, h('small', {}, 'Generated ' + fmtDate(d.generated_at))));
}
