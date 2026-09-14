/* Caisse (Phase 8): the till's balance and book come from the ledger of the
 * cash system account (every receipt, supplier payment and cash expense
 * already posts there); this view adds the manual movements — bank ⇄ till,
 * other in/out against a chosen account — that are not documents. Nothing
 * is recomputed here; balances are the API's. */
import { api, qs, describeError } from '../api.js';
import { h, clear, table, pagination, skeletonRows, empty, errorBox, toast, modal, closeModal, confirmDialog,
  field, input, select, formValues, fmtDate, fmtMoney, fmtNum, badge } from '../ui.js';

const KIND_LABEL = { withdrawal: 'Retrait banque → caisse', deposit: 'Dépôt caisse → banque', other_in: 'Entrée (autre)', other_out: 'Sortie (autre)' };
const KIND_TONE = { withdrawal: 'ok', deposit: 'info', other_in: 'ok', other_out: 'warn' };

export function cashView(root) {
  const summary = h('div', {}); const bookWrap = h('div', {}); const movesWrap = h('div', {});
  root.append(summary, h('div', { class: 'section' }, h('h3', { text: 'Livre de caisse (grand livre du compte caisse)' }), bookWrap),
    h('div', { class: 'section' }, h('h3', { text: 'Mouvements manuels' }), movesWrap));
  let accounts = [];
  const from = input({ type: 'date', 'aria-label': 'Du' }), to = input({ type: 'date', 'aria-label': 'Au' });
  [from, to].forEach((el) => el.addEventListener('change', loadBook));
  let cashAccount = null;

  async function loadSummary() {
    clear(summary).appendChild(skeletonRows(2));
    try {
      const s = await api.get('/cash_entries/summary');
      clear(summary);
      cashAccount = s.account;
      const dl = h('dl', { class: 'kv' },
        h('dt', { text: 'Compte' }), h('dd', { text: s.account ? s.account.code + ' — ' + s.account.label : 'comptabilité non configurée' }),
        h('dt', { text: 'Solde de caisse' }), h('dd', { class: 'mono', text: fmtMoney(s.balance) }),
        h('dt', { text: "Aujourd'hui" }), h('dd', { text: 'entrées ' + fmtNum(s.today.in) + ' / sorties ' + fmtNum(s.today.out) }));
      summary.appendChild(h('div', { class: 'toolbar' }, h('article', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', { text: 'Caisse' })), dl),
        h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn btn-primary btn-sm', text: 'Nouveau mouvement', onClick: () => movementForm(accounts, () => { loadSummary(); loadBook(); loadMoves(); }) }))));
    } catch (e) { clear(summary).appendChild(errorBox(describeError(e), loadSummary, e.body && e.body.error)); }
  }

  async function loadBook() {
    clear(bookWrap).appendChild(h('div', { class: 'toolbar' }, field('Du', from), field('Au', to)));
    const body = h('div', {}); bookWrap.appendChild(body);
    if (!cashAccount) { body.appendChild(empty('Pas de compte caisse', 'Configurez la comptabilité (Paramètres › Comptabilité) pour tenir le livre de caisse.')); return; }
    body.appendChild(skeletonRows(4));
    try {
      // /cash_entries/book = the ledger of the cash account, finance-gated
      // (a finance_user has no accounting.read); the account is forced
      // server-side.
      const r = await api.get('/cash_entries/book' + qs({ from: from.value, to: to.value }));
      clear(body);
      body.appendChild(h('p', { class: 'mono', text: 'Solde d\'ouverture ' + fmtNum(r.opening_balance) + ' — solde de clôture ' + fmtNum(r.closing_balance) }));
      if (!r.rows.length) { body.appendChild(empty('Aucun mouvement', 'Aucune ligne comptabilisée sur la caisse pour ce filtre.')); return; }
      body.appendChild(table([
        { key: 'entry_date', label: 'Date', render: (x) => fmtDate(x.entry_date) },
        { key: 'entry_no', label: 'N°', num: true, render: (x) => h('a', { class: 'mono', href: '#/accounting/entries/' + x.entry_id, text: String(x.entry_no) }) },
        { key: 'label', label: 'Libellé', render: (x) => x.label || x.memo || '—' },
        { key: 'debit', label: 'Entrée', num: true, render: (x) => Number(x.debit) ? fmtNum(x.debit) : '' },
        { key: 'credit', label: 'Sortie', num: true, render: (x) => Number(x.credit) ? fmtNum(x.credit) : '' },
        { key: 'running_balance', label: 'Solde', num: true, render: (x) => fmtNum(x.running_balance) }
      ], r.rows));
    } catch (e) { clear(body).appendChild(errorBox(describeError(e), loadBook, e.body && e.body.error)); }
  }

  let moveOffset = 0;
  async function loadMoves(offset) {
    if (offset !== undefined) moveOffset = offset;
    clear(movesWrap).appendChild(skeletonRows(3));
    try {
      const page = await api.get('/cash_entries' + qs({ limit: 50, offset: moveOffset }));
      clear(movesWrap);
      if (!page.rows.length) { movesWrap.appendChild(empty('Aucun mouvement manuel', 'Retraits, dépôts et régularisations saisis ici ; les encaissements et dépenses en espèces viennent de leurs propres écrans.')); return; }
      movesWrap.appendChild(table([
        { key: 'entry_date', label: 'Date', render: (r) => fmtDate(r.entry_date) },
        { key: 'kind', label: 'Type', render: (r) => badge(KIND_LABEL[r.kind] || r.kind, KIND_TONE[r.kind]) },
        { key: 'label', label: 'Libellé' }, { key: 'reference', label: 'Référence', render: (r) => r.reference || '—' },
        { key: 'amount', label: 'Montant', num: true, render: (r) => fmtNum(r.amount, 3) }
      ], page.rows, (r) => [h('button', { type: 'button', class: 'btn btn-danger btn-sm', text: 'Retirer', onClick: async () => {
        if (!(await confirmDialog({ title: 'Retirer ce mouvement ?', danger: true, confirmLabel: 'Retirer', text: 'Son écriture comptable est extournée ; rien n\'est effacé, l\'opération est tracée.' }))) return;
        try { await api.del('/cash_entries/' + r.id); toast('Mouvement retiré.', 'ok'); loadSummary(); loadBook(); loadMoves(); }
        catch (e) { toast(describeError(e), 'danger'); }
      } })]));
      movesWrap.appendChild(pagination({ total: page.total, limit: page.limit, offset: page.offset, onPage: (o) => loadMoves(o) }));
    } catch (e) { clear(movesWrap).appendChild(errorBox(describeError(e), loadMoves, e.body && e.body.error)); }
  }

  (async () => {
    try { accounts = (await api.get('/cash_entries/counterparts')).rows; } catch (e) { accounts = []; }
    await loadSummary(); loadBook(); loadMoves();
  })();
}

function movementForm(accounts, done) {
  const kind = select(Object.keys(KIND_LABEL).map((k) => ({ value: k, label: KIND_LABEL[k] })), { name: 'kind' });
  const cp = select([{ value: '', label: '— compte de contrepartie —' }].concat(accounts.map((a) => ({ value: a.id, label: a.code + ' — ' + a.label }))), { name: 'counterpart_account_id' });
  const cpField = field('Contrepartie', cp, { hint: 'Requis pour une entrée/sortie « autre » ; ignoré pour un retrait ou un dépôt (compte banque).' });
  const syncCp = () => { const other = kind.value === 'other_in' || kind.value === 'other_out'; cp.disabled = !other; cpField.hidden = !other; };
  kind.addEventListener('change', syncCp); syncCp();
  const header = h('div', { class: 'field-row' },
    field('Type', kind),
    field('Date', input({ name: 'entry_date', type: 'date', value: new Date().toISOString().slice(0, 10), required: true })),
    field('Montant', input({ name: 'amount', type: 'number', step: '0.001', min: '0.001', required: true })),
    field('Libellé', input({ name: 'label', required: true })),
    field('Référence', input({ name: 'reference' })),
    cpField);
  const err = h('p', { class: 'error', role: 'alert', hidden: true });
  const submit = h('button', { type: 'button', class: 'btn btn-primary', text: 'Enregistrer' });
  submit.addEventListener('click', async () => {
    err.hidden = true;
    const v = formValues(header);
    const body = { kind: kind.value, entry_date: v.entry_date, amount: Number(v.amount), label: v.label, reference: v.reference || null };
    if (kind.value === 'other_in' || kind.value === 'other_out') body.counterpart_account_id = cp.value || null;
    if (!(body.amount > 0)) { err.textContent = 'Le montant doit être supérieur à zéro.'; err.hidden = false; return; }
    submit.disabled = true;
    try { const out = await api.post('/cash_entries', body); closeModal(); toast(out.accounting && out.accounting.entry_no ? 'Mouvement enregistré — écriture n° ' + out.accounting.entry_no : 'Mouvement enregistré.', 'ok'); done(); }
    catch (e) { err.textContent = describeError(e); err.hidden = false; submit.disabled = false; }
  });
  modal({ title: 'Nouveau mouvement de caisse', wide: true, body: h('div', { class: 'stack' }, header, err),
    actions: [h('button', { type: 'button', class: 'btn btn-ghost', text: 'Annuler', onClick: closeModal }), submit] });
}
