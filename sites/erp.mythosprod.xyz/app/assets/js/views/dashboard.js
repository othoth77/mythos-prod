/* Dashboard: the seven counters the API measures, plus revenue by month.
 * A value the server has not returned is shown as loading or as an error —
 * never as an invented number. */
import { api, describeError } from '../api.js';
import { h, clear, fmtMoney, fmtNum, fmtPct, errorBox, barChart, empty } from '../ui.js';

const TILES = [
  ['clients', 'Clients actifs', (v) => fmtNum(v, 0)],
  ['open_projects', 'Projets en cours', (v) => fmtNum(v, 0)],
  ['unpaid_invoices', 'Factures ouvertes', (v) => fmtNum(v, 0)],
  ['invoiced_ttc_ytd', 'Facturé TTC (année)', (v) => fmtMoney(v)],
  ['collected_ytd', 'Encaissé (année)', (v) => fmtMoney(v)],
  ['appointments_next_7d', 'RDV — 7 jours', (v) => fmtNum(v, 0)],
  ['items_below_reorder', 'Articles sous seuil', (v) => fmtNum(v, 0)]
];

// A ninth tile the server measures separately (prospects.win_rate): shown
// only once the API answers, same rule as every other tile — never a guess.
const PROSPECT_TILE = ['prospect_win_rate', 'Conversion prospects', (v) => v === null ? '—' : fmtPct(v)];

export function dashboardView(container) {
  const grid = h('div', { class: 'grid cols-4' });
  const tiles = {};
  for (const [key, label] of TILES.concat([PROSPECT_TILE])) {
    tiles[key] = h('span', { class: 'stat-value is-loading', text: '…' });
    grid.appendChild(h('article', { class: 'card stat', dataset: { stat: key } }, h('span', { class: 'stat-label', text: label }), tiles[key], h('span', { class: 'stat-sub', text: 'mesuré par l\'API' })));
  }
  const chartCard = h('article', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', { text: 'Chiffre d\'affaires par mois' }),
    h('div', { class: 'legend' }, h('span', {}, h('span', { class: 'swatch c1' }), 'HT'), h('span', {}, h('span', { class: 'swatch c2' }), 'TTC'))));
  const chartBody = h('div', { text: 'Chargement…' }); chartCard.appendChild(chartBody);
  const recvCard = h('article', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', { text: 'Créances ouvertes' })));
  const recvBody = h('div', { text: 'Chargement…' }); recvCard.appendChild(recvBody);
  container.append(grid, h('div', { class: 'grid cols-2 section' }, chartCard, recvCard));

  async function loadSummary() {
    try {
      const s = await api.get('/dashboard');
      for (const [key, , fmt] of TILES) { tiles[key].textContent = fmt(s[key]); tiles[key].classList.remove('is-loading'); }
    } catch (e) {
      for (const [key] of TILES) tiles[key].textContent = '—';
      grid.prepend(errorBox(describeError(e), () => { grid.querySelector('.errorbox').remove(); loadSummary(); }, e.body && e.body.error));
    }
  }
  async function loadRevenue() {
    try {
      const r = await api.get('/reports/revenue');
      // The API names the revenue series `months` (one row per month).
      const rows = (r.months || r.rows || []).slice().reverse();
      clear(chartBody);
      if (!rows.length) { chartBody.appendChild(empty('Aucune facture émise', 'Le graphique apparaît avec la première facture.')); return; }
      chartBody.appendChild(barChart(rows.map((x) => ({ label: x.month, a: x.ht, b: x.ttc })), { labelKey: 'label', keys: ['a', 'b'] }));
    } catch (e) { clear(chartBody).appendChild(errorBox(describeError(e), loadRevenue)); }
  }
  async function loadReceivables() {
    try {
      const r = await api.get('/reports/receivables');
      clear(recvBody);
      recvBody.appendChild(h('p', {}, 'Encours total : ', h('strong', { class: 'mono', text: fmtMoney(r.outstanding_total) })));
      if (!(r.rows || []).length) recvBody.appendChild(empty('Aucune créance', 'Toutes les factures émises sont réglées.'));
      else recvBody.appendChild(h('ul', {}, r.rows.slice(0, 8).map((x) => h('li', {}, h('a', { href: '#/finance/invoices/' + x.id, class: 'mono', text: x.number || x.id }), ' — ', fmtMoney(x.balance ?? x.outstanding ?? x.total_ttc)))));
    } catch (e) { clear(recvBody).appendChild(errorBox(describeError(e), loadReceivables)); }
  }
  async function loadProspectStats() {
    try {
      const r = await api.get('/reports/prospects');
      tiles.prospect_win_rate.textContent = r.decided > 0 ? fmtPct(r.win_rate) : '—';
      tiles.prospect_win_rate.classList.remove('is-loading');
    } catch (e) {
      // A tenant without prospects.read/reports.read simply does not see this
      // tile filled in; the rest of the dashboard must not fail for it.
      tiles.prospect_win_rate.textContent = '—';
      tiles.prospect_win_rate.classList.remove('is-loading');
    }
  }
  loadSummary(); loadRevenue(); loadReceivables(); loadProspectStats();
}
