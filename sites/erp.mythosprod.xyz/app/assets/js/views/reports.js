/* Reports: revenue by month (chart + table), receivables, expenses. */
import { api, describeError } from '../api.js';
import { h, clear, table, skeletonRows, empty, errorBox, barChart, fmtMoney, fmtNum, fmtDate, tabs } from '../ui.js';

const TABS = [{ key: 'revenue', label: 'Chiffre d\'affaires' }, { key: 'receivables', label: 'Créances' }, { key: 'expenses', label: 'Dépenses' }];

export function reportsView(container, which) {
  const active = TABS.some((t) => t.key === which) ? which : 'revenue';
  container.appendChild(tabs(TABS, active, (k) => { window.location.hash = '#/reports/' + k; }));
  const panel = h('div', { id: 'panel-' + active, role: 'tabpanel', 'aria-labelledby': 'tab-' + active });
  container.appendChild(panel);
  load();

  async function load() {
    clear(panel).appendChild(skeletonRows(5));
    try {
      const r = await api.get('/reports/' + active);
      clear(panel);
      const rows = r.months || r.rows || [];   // revenue → months; receivables/expenses → rows
      if (active === 'revenue') {
        if (!rows.length) { panel.appendChild(empty('Aucune donnée', 'Aucune facture non annulée.')); return; }
        panel.appendChild(h('article', { class: 'card' }, barChart(rows.slice().reverse().map((x) => ({ label: x.month, a: x.ht, b: x.ttc })), { keys: ['a', 'b'] })));
        panel.appendChild(h('div', { class: 'section' }, table([
          { key: 'month', label: 'Mois' }, { key: 'ht', label: 'HT', num: true, render: (x) => fmtNum(x.ht) },
          { key: 'vat', label: 'TVA', num: true, render: (x) => fmtNum(x.vat) }, { key: 'ttc', label: 'TTC', num: true, render: (x) => fmtNum(x.ttc) }
        ], rows)));
      } else if (active === 'receivables') {
        panel.appendChild(h('p', {}, 'Encours total : ', h('strong', { class: 'mono', text: fmtMoney(r.outstanding_total) })));
        if (!rows.length) { panel.appendChild(empty('Aucune créance')); return; }
        const cols = Object.keys(rows[0]).filter((k) => k !== 'id').map((k) => ({ key: k, label: k, num: /total|paid|balance|outstanding|amount/.test(k),
          render: (x) => /_on$/.test(k) ? fmtDate(x[k]) : (/total|paid|balance|outstanding|amount/.test(k) ? fmtNum(x[k]) : (x[k] ?? '—')) }));
        panel.appendChild(table(cols, rows, (x) => [h('a', { class: 'btn btn-ghost btn-sm', href: '#/finance/invoices/' + x.id, text: 'Ouvrir' })]));
      } else {
        if (!rows.length) { panel.appendChild(empty('Aucune dépense')); return; }
        const cols = Object.keys(rows[0]).map((k) => ({ key: k, label: k, num: /amount|total/.test(k), render: (x) => /amount|total/.test(k) ? fmtNum(x[k]) : (x[k] ?? '—') }));
        panel.appendChild(table(cols, rows));
      }
    } catch (e) { clear(panel).appendChild(errorBox(describeError(e), load, e.body && e.body.error)); }
  }
}
