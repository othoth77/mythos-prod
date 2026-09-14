/* Transactions bancaires & rapprochement (Phase 3).
 *
 * A bank transaction is an external statement line. Matching it to a payment
 * never posts, reverses, or otherwise touches accounting — the journal entry
 * for that payment already exists (created when the payment was recorded).
 * This view only ever calls /bank_entries endpoints, never /accounting/* or
 * anything that could create a journal entry — that omission mirrors the
 * server-side module (modules/bank.js) deliberately.
 */
import { api, qs, describeError } from '../api.js';
import { h, clear, table, pagination, skeletonRows, empty, errorBox, toast, modal, closeModal,
  confirmDialog, field, input, select, formValues, fmtDate, fmtNum, badge } from '../ui.js';

const STATUS_TONE = { unmatched: 'warn', matched: 'ok', ignored: '' };
const STATUS_LABEL = { unmatched: 'À rapprocher', matched: 'Rapproché', ignored: 'Ignoré' };
const st = (s) => badge(STATUS_LABEL[s] || s, STATUS_TONE[s]);

export function bankTransactionsView(root) {
  return transactionsList(root);
}

async function loadAccounts() {
  const r = await api.get('/bank_accounts?limit=200');
  return r.rows;
}

function transactionsList(root) {
  const state = { account_id: '', status: '', search: '', offset: 0, limit: 25 };
  const toolbar = h('div', {});
  const body = h('div', {});
  root.appendChild(toolbar); root.appendChild(body);
  let accounts = [];

  async function load() {
    clear(body).appendChild(skeletonRows(6));
    try {
      const page = await api.get('/bank_entries' + qs({ account_id: state.account_id, status: state.status, search: state.search, limit: state.limit, offset: state.offset }));
      clear(body);
      const count = toolbar.querySelector('.toolbar-count');
      if (count) count.textContent = page.total + ' transaction' + (page.total > 1 ? 's' : '');
      if (!page.rows.length) { body.appendChild(empty('Aucune transaction', 'Ajoutez une ligne de relevé bancaire pour commencer le rapprochement.')); return; }
      const accountLabel = (id) => (accounts.find((a) => a.id === id) || {}).label || '—';
      body.appendChild(table([
        { key: 'entry_date', label: 'Date', render: (r) => fmtDate(r.entry_date) },
        { key: 'account_id', label: 'Compte', render: (r) => accountLabel(r.account_id) },
        { key: 'label', label: 'Libellé' },
        { key: 'amount', label: 'Montant', num: true, render: (r) => fmtNum(r.amount) },
        { key: 'status', label: 'Statut', render: (r) => st(r.status) }
      ], page.rows, (r) => rowActions(r, load)));
      body.appendChild(pagination({ total: page.total, limit: page.limit, offset: page.offset, onPage: (o) => { state.offset = o; load(); } }));
    } catch (e) { clear(body).appendChild(errorBox(describeError(e), load, e.body && e.body.error)); }
  }

  async function init() {
    try { accounts = await loadAccounts(); } catch (e) { accounts = []; }
    const accSel = select([{ value: '', label: 'Tous les comptes' }, ...accounts.map((a) => ({ value: a.id, label: a.label }))], { 'aria-label': 'Compte' });
    accSel.addEventListener('change', () => { state.account_id = accSel.value; state.offset = 0; load(); });
    const statusSel = select([{ value: '', label: 'Tous les statuts' },
      { value: 'unmatched', label: 'À rapprocher' }, { value: 'matched', label: 'Rapproché' }, { value: 'ignored', label: 'Ignoré' }], { 'aria-label': 'Statut' });
    statusSel.addEventListener('change', () => { state.status = statusSel.value; state.offset = 0; load(); });
    const search = input({ type: 'search', placeholder: 'Libellé…', 'aria-label': 'Rechercher' });
    let deb; search.addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(() => { state.search = search.value; state.offset = 0; load(); }, 250); });
    const count = h('span', { class: 'toolbar-count' });
    clear(toolbar).appendChild(h('div', { class: 'toolbar' }, field('Compte', accSel), field('Statut', statusSel), field('Rechercher', search),
      h('div', { class: 'actions' }, count,
        accounts.length ? h('button', { type: 'button', class: 'btn btn-primary btn-sm', text: '+ Transaction', onClick: () => transactionForm(accounts, load) })
          : h('span', { class: 'hint', text: 'Créez un compte bancaire avant d\'ajouter des transactions.' }))));
    load();
  }
  init();
}

function rowActions(r, reload) {
  if (r.status === 'unmatched') {
    return [
      h('button', { type: 'button', class: 'btn btn-primary btn-sm', text: 'Rapprocher', onClick: () => matchModal(r, reload) }),
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Ignorer', onClick: async () => {
        if (!(await confirmDialog({ title: 'Ignorer cette transaction ?', text: 'Elle restera visible, filtrable, mais ne sera pas rapprochée d\'un paiement.', confirmLabel: 'Ignorer' }))) return;
        try { await api.post('/bank_entries/' + r.id + '/ignore', {}); toast('Transaction ignorée.', 'ok'); reload(); }
        catch (e) { toast(describeError(e), 'danger'); }
      } })
    ];
  }
  return [
    h('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Dissocier', onClick: async () => {
      const text = r.status === 'matched'
        ? 'Le paiement rapproché n\'est pas modifié : seule la correspondance est retirée, aucune écriture comptable n\'est touchée.'
        : 'La transaction redevient à rapprocher.';
      if (!(await confirmDialog({ title: 'Dissocier cette transaction ?', text, confirmLabel: 'Dissocier' }))) return;
      try { await api.post('/bank_entries/' + r.id + '/unmatch', {}); toast('Transaction dissociée.', 'ok'); reload(); }
      catch (e) { toast(describeError(e), 'danger'); }
    } })
  ];
}

async function matchModal(entry, reload) {
  let candidates;
  try { candidates = (await api.get('/bank_entries/' + entry.id + '/candidates')).rows; }
  catch (e) { toast(describeError(e), 'danger'); return; }
  const list = candidates.length
    ? h('div', { class: 'table-wrap' }, table([
        { key: 'paid_on', label: 'Date', render: (p) => fmtDate(p.paid_on) },
        { key: 'amount', label: 'Montant', num: true, render: (p) => fmtNum(p.amount) },
        { key: 'method', label: 'Méthode', render: (p) => p.method || '—' },
        { key: 'reference', label: 'Référence', render: (p) => p.reference || '—' },
        { key: 'origin', label: 'Origine', render: (p) => (p.invoice_id ? 'Facture client' : p.purchase_id ? 'Achat fournisseur' : '—') }
      ], candidates, (p) => [h('button', {
        type: 'button', class: 'btn btn-primary btn-sm', text: 'Rapprocher',
        onClick: async () => {
          try { await api.post('/bank_entries/' + entry.id + '/match', { payment_id: p.id }); closeModal(); toast('Transaction rapprochée.', 'ok'); reload(); }
          catch (e) { toast(describeError(e), 'danger'); }
        }
      })]))
    : h('p', {}, 'Aucun paiement candidat pour ce montant et cette date. Le rapprochement ne crée ni ne modifie jamais une écriture comptable : il relie cette ligne de relevé à un paiement déjà enregistré.');
  modal({ title: 'Rapprocher — ' + entry.label, wide: true,
    body: h('div', { class: 'stack' },
      h('dl', { class: 'kv' }, h('dt', { text: 'Date' }), h('dd', { text: fmtDate(entry.entry_date) }), h('dt', { text: 'Montant' }), h('dd', { text: fmtNum(entry.amount) })),
      h('h3', { text: 'Candidats de rapprochement' }), list),
    actions: [h('button', { type: 'button', class: 'btn btn-ghost', text: 'Fermer', onClick: closeModal })] });
}

async function transactionForm(accounts, done) {
  const form = h('div', { class: 'field-row' },
    field('Compte', select(accounts.map((a) => ({ value: a.id, label: a.label })), { name: 'account_id', required: true })),
    field('Date', input({ name: 'entry_date', type: 'date', value: new Date().toISOString().slice(0, 10), required: true })),
    field('Libellé', input({ name: 'label', required: true })),
    field('Montant', input({ name: 'amount', type: 'number', step: '0.001', required: true }), { hint: 'Signé : positif = crédit (entrée), négatif = débit (sortie).' }),
    field('Réf. externe', input({ name: 'legacy_id' })));
  const err = h('p', { class: 'error', role: 'alert', hidden: true });
  const submit = h('button', { type: 'button', class: 'btn btn-primary', text: 'Créer' });
  submit.addEventListener('click', async () => {
    err.hidden = true; submit.disabled = true;
    const v = formValues(form);
    try {
      await api.post('/bank_entries', { account_id: v.account_id, entry_date: v.entry_date, label: v.label, amount: Number(v.amount), legacy_id: v.legacy_id || null });
      closeModal(); toast('Transaction ajoutée.', 'ok'); done();
    } catch (e) { err.textContent = describeError(e); err.hidden = false; submit.disabled = false; }
  });
  modal({ title: 'Nouvelle transaction bancaire', wide: true,
    body: h('div', { class: 'stack' }, form, err),
    actions: [h('button', { type: 'button', class: 'btn btn-ghost', text: 'Annuler', onClick: closeModal }), submit] });
}
