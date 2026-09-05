/* Reports: revenue by month (chart + table), receivables, expenses,
 * prospects funnel, inventory levels. Revenue and expenses take an optional
 * date range; every figure comes straight from the API — nothing here
 * recomputes a total the server already returned. */
import { api, qs, describeError } from '../api.js';
import { h, clear, table, skeletonRows, empty, errorBox, badge, field, input,
  barChart, fmtMoney, fmtNum, fmtPct, fmtDate, tabs } from '../ui.js';

const TABS = [
  { key: 'revenue', label: 'Chiffre d\'affaires' }, { key: 'receivables', label: 'Créances' },
  { key: 'expenses', label: 'Dépenses' }, { key: 'prospects', label: 'Prospects' },
  { key: 'inventory', label: 'Inventaire' }
];
const RANGED = ['revenue', 'expenses'];

export function reportsView(container, which) {
  const active = TABS.some((t) => t.key === which) ? which : 'revenue';
  container.appendChild(tabs(TABS, active, (k) => { window.location.hash = '#/reports/' + k; }));
  const state = { from: '', to: '' };
  let toolbar = null;
  if (RANGED.includes(active)) {
    const from = input({ type: 'date', 'aria-label': 'Du' });
    const to = input({ type: 'date', 'aria-label': 'Au' });
    from.addEventListener('change', () => { state.from = from.value; load(); });
    to.addEventListener('change', () => { state.to = to.value; load(); });
    toolbar = h('div', { class: 'toolbar' }, field('Du', from), field('Au', to));
    container.appendChild(toolbar);
  }
  const panel = h('div', { id: 'panel-' + active, role: 'tabpanel', 'aria-labelledby': 'tab-' + active });
  container.appendChild(panel);
  load();

  async function load() {
    clear(panel).appendChild(skeletonRows(5));
    try {
      const r = await api.get('/reports/' + active + (RANGED.includes(active) ? qs({ from: state.from, to: state.to }) : ''));
      clear(panel);
      if (active === 'revenue') return renderRevenue(panel, r);
      if (active === 'receivables') return renderReceivables(panel, r);
      if (active === 'expenses') return renderExpenses(panel, r);
      if (active === 'prospects') return renderProspects(panel, r);
      if (active === 'inventory') return renderInventory(panel, r);
    } catch (e) { clear(panel).appendChild(errorBox(describeError(e), load, e.body && e.body.error)); }
  }
}

function renderRevenue(panel, r) {
  const rows = r.months || [];
  if (!rows.length) { panel.appendChild(empty('Aucune donnée', 'Aucune facture non annulée sur cette période.')); return; }
  panel.appendChild(h('article', { class: 'card' }, barChart(rows.slice().reverse().map((x) => ({ label: x.month, a: x.ht, b: x.ttc })), { keys: ['a', 'b'] })));
  panel.appendChild(h('div', { class: 'section' }, table([
    { key: 'month', label: 'Mois' }, { key: 'ht', label: 'HT', num: true, render: (x) => fmtNum(x.ht) },
    { key: 'vat', label: 'TVA', num: true, render: (x) => fmtNum(x.vat) }, { key: 'ttc', label: 'TTC', num: true, render: (x) => fmtNum(x.ttc) }
  ], rows)));
}

function renderReceivables(panel, r) {
  const rows = r.rows || [];
  panel.appendChild(h('p', {}, 'Encours total : ', h('strong', { class: 'mono', text: fmtMoney(r.outstanding_total) })));
  if (!rows.length) { panel.appendChild(empty('Aucune créance')); return; }
  const cols = Object.keys(rows[0]).filter((k) => k !== 'id').map((k) => ({ key: k, label: k, num: /total|paid|balance|outstanding|amount/.test(k),
    render: (x) => /_on$/.test(k) ? fmtDate(x[k]) : (/total|paid|balance|outstanding|amount/.test(k) ? fmtNum(x[k]) : (x[k] ?? '—')) }));
  panel.appendChild(table(cols, rows, (x) => [h('a', { class: 'btn btn-ghost btn-sm', href: '#/finance/invoices/' + x.id, text: 'Ouvrir' })]));
}

function renderExpenses(panel, r) {
  const rows = r.rows || [];
  panel.appendChild(h('p', {}, 'Total sur la période : ', h('strong', { class: 'mono', text: fmtMoney(r.total) })));
  if (!rows.length) { panel.appendChild(empty('Aucune dépense sur cette période')); return; }
  panel.appendChild(table([
    { key: 'month', label: 'Mois' }, { key: 'category', label: 'Catégorie', render: (x) => x.category || '—' },
    { key: 'amount', label: 'Montant', num: true, render: (x) => fmtNum(x.amount) }
  ], rows));
}

function renderProspects(panel, r) {
  const order = ['new', 'contacted', 'qualified', 'proposal', 'won', 'lost'];
  const LABEL = { new: 'Nouveau', contacted: 'Contacté', qualified: 'Qualifié', proposal: 'Proposition', won: 'Gagné', lost: 'Perdu' };
  panel.appendChild(h('div', { class: 'grid cols-4' },
    h('article', { class: 'card stat' }, h('span', { class: 'stat-label', text: 'Prospects (total)' }), h('span', { class: 'stat-value', text: fmtNum(r.total, 0) })),
    h('article', { class: 'card stat' }, h('span', { class: 'stat-label', text: 'Taux de conversion' }), h('span', { class: 'stat-value', text: r.decided > 0 ? fmtPct(r.win_rate) : '—' }),
      h('span', { class: 'stat-sub', text: r.decided > 0 ? r.won + ' gagnés sur ' + r.decided + ' décidés' : 'aucun prospect décidé' })),
    h('article', { class: 'card stat' }, h('span', { class: 'stat-label', text: 'Délai moyen de conversion' }),
      h('span', { class: 'stat-value', text: r.avg_days_to_convert === null ? '—' : fmtNum(r.avg_days_to_convert, 1) + ' j' }))));
  if (!r.total) { panel.appendChild(h('div', { class: 'section' }, empty('Aucun prospect', 'Le tunnel apparaît dès le premier prospect créé.'))); return; }
  panel.appendChild(h('div', { class: 'section' }, table([
    { key: 'status', label: 'Statut' }, { key: 'n', label: 'Nombre', num: true }
  ], order.filter((k) => r.by_status[k]).map((k) => ({ status: LABEL[k], n: r.by_status[k] })))));
}

function renderInventory(panel, r) {
  const rows = r.rows || [];
  panel.appendChild(h('p', {}, badge(r.below_reorder_count + ' article(s) sous le seuil de réappro.', r.below_reorder_count > 0 ? 'warn' : 'ok')));
  if (!rows.length) { panel.appendChild(empty('Aucun article', 'Le rapport apparaît dès le premier article créé.')); return; }
  panel.appendChild(table([
    { key: 'sku', label: 'SKU', render: (x) => x.sku || '—' }, { key: 'label', label: 'Libellé' }, { key: 'unit', label: 'Unité', render: (x) => x.unit || '—' },
    { key: 'on_hand', label: 'En stock', num: true, render: (x) => fmtNum(x.on_hand) },
    { key: 'min_quantity', label: 'Seuil', num: true, render: (x) => fmtNum(x.min_quantity) },
    { key: 'below_reorder', label: 'État', render: (x) => badge(x.below_reorder ? 'sous seuil' : 'ok', x.below_reorder ? 'warn' : 'ok') }
  ], rows));
}
