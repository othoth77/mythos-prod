/* Achats (supplier invoices): list, create, edit while draft, confirm, record
 * supplier payments, cancel. The backend module has existed since Phase 2
 * (api/modules/purchases.js); this view closes the gap that left the Finance
 * › Achats tab falling through to the generic resource view after purchases
 * was removed from registry.js. Totals are echoed as the API computes them
 * (HT + VAT + the supplier's fiscal stamp), never recomputed here. */
import { api, qs, describeError } from '../api.js';
import { h, clear, table, pagination, skeletonRows, empty, errorBox, toast, modal, closeModal, confirmDialog,
  field, input, select, textarea, formValues, fmtDate, fmtMoney, fmtNum, statusBadge, shortId } from '../ui.js';

const STATUSES = ['draft', 'confirmed', 'part_paid', 'paid', 'cancelled'];

export function purchasesView(container, id) {
  const root = h('div', { class: 'stack' }); container.appendChild(root);
  if (id) return detail(root, id);
  return list(root);
}

async function loadSuppliers() {
  try { return (await api.get('/suppliers?limit=200')).rows; } catch (e) { return []; }
}

function list(root) {
  const state = { search: '', status: '', offset: 0, limit: 25 };
  const search = input({ type: 'search', placeholder: 'Référence, notes…', 'aria-label': 'Rechercher' });
  let deb; search.addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(() => { state.search = search.value; state.offset = 0; load(); }, 250); });
  const st = select([{ value: '', label: 'Tous les statuts' }].concat(STATUSES.map((s) => ({ value: s, label: s }))), { 'aria-label': 'Statut' });
  st.addEventListener('change', () => { state.status = st.value; state.offset = 0; load(); });
  const count = h('span', { class: 'toolbar-count' });
  root.appendChild(h('div', { class: 'toolbar' }, field('Rechercher', search), field('Statut', st),
    h('div', { class: 'actions' }, count, h('button', { type: 'button', class: 'btn btn-primary btn-sm', text: 'Nouvel achat', onClick: () => purchaseForm(null, load) }))));
  const body = h('div', {}); root.appendChild(body);

  async function load() {
    clear(body).appendChild(skeletonRows(6));
    try {
      const page = await api.get('/purchases' + qs({ search: state.search, status: state.status, limit: state.limit, offset: state.offset }));
      clear(body);
      count.textContent = page.total + ' achat' + (page.total > 1 ? 's' : '');
      if (!page.rows.length) { body.appendChild(empty('Aucun achat', 'Enregistrez la première facture fournisseur ou ajustez les filtres.')); return; }
      body.appendChild(table([
        { key: 'reference', label: 'Référence', render: (r) => h('a', { href: '#/finance/purchases/' + r.id, class: 'mono', text: r.reference || shortId(r.id) }) },
        { key: 'purchased_on', label: 'Date', render: (r) => fmtDate(r.purchased_on) },
        { key: 'due_on', label: 'Échéance', render: (r) => fmtDate(r.due_on) },
        { key: 'status', label: 'Statut', render: (r) => statusBadge(r.status) },
        { key: 'supplier_id', label: 'Fournisseur', render: (r) => h('span', { class: 'mono', text: shortId(r.supplier_id) }) },
        { key: 'amount_ht', label: 'HT', num: true, render: (r) => fmtNum(r.amount_ht, 3) }
      ], page.rows, (r) => [h('a', { class: 'btn btn-ghost btn-sm', href: '#/finance/purchases/' + r.id, text: 'Ouvrir' })]));
      body.appendChild(pagination({ total: page.total, limit: page.limit, offset: page.offset, onPage: (o) => { state.offset = o; load(); } }));
    } catch (e) { clear(body).appendChild(errorBox(describeError(e), load, e.body && e.body.error)); }
  }
  load();
}

async function detail(root, id) {
  root.appendChild(skeletonRows(4));
  let p;
  try { p = await api.get('/purchases/' + id); }
  catch (e) { clear(root).appendChild(errorBox(describeError(e), () => detail(clear(root), id), e.body && e.body.error)); return; }
  clear(root);
  const t = p.totals || {};
  const editable = p.status === 'draft' || p.status === 'confirmed' || p.status === 'part_paid';
  const reload = () => detail(clear(root), id);
  root.appendChild(h('div', { class: 'toolbar' },
    h('a', { class: 'btn btn-ghost btn-sm', href: '#/finance/purchases', text: '← Achats' }),
    h('h3', { class: 'mono', text: p.reference || shortId(p.id) }), statusBadge(p.status),
    h('div', { class: 'actions' },
      editable ? h('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Modifier', onClick: () => purchaseForm(p, reload) }) : null,
      p.status === 'draft' ? h('button', { type: 'button', class: 'btn btn-primary btn-sm', text: 'Confirmer', onClick: () => setStatus(p, 'confirmed', reload) }) : null,
      (p.status === 'confirmed' || p.status === 'part_paid' || p.status === 'draft') ? h('button', { type: 'button', class: 'btn btn-primary btn-sm', text: 'Enregistrer un règlement', onClick: () => paymentForm(p, reload) }) : null,
      p.status !== 'cancelled' && p.status !== 'paid' ? h('button', { type: 'button', class: 'btn btn-danger btn-sm', text: 'Annuler l\'achat', onClick: () => cancel(p, reload) }) : null)));
  const dl = h('dl', { class: 'kv' });
  [['Date', fmtDate(p.purchased_on)], ['Échéance', fmtDate(p.due_on)], ['Fournisseur', shortId(p.supplier_id)],
    ['TVA %', fmtNum(p.vat_rate, 2)], ['Notes', p.notes || '—']]
    .forEach(([k, v]) => dl.append(h('dt', { text: k }), h('dd', { text: v })));
  root.appendChild(h('div', { class: 'grid cols-2' },
    h('article', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', { text: 'En-tête' })), dl),
    h('article', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', { text: 'Totaux (calculés par le serveur)' })),
      h('dl', { class: 'kv' },
        h('dt', { text: 'Total HT' }), h('dd', { text: fmtMoney(t.total_ht) }),
        h('dt', { text: 'TVA' }), h('dd', { text: fmtMoney(t.total_vat) }),
        h('dt', { text: 'Timbre fiscal' }), h('dd', { text: fmtMoney(t.stamp_amount ?? p.stamp_amount ?? 0) }),
        h('dt', { text: 'Total TTC' }), h('dd', { text: fmtMoney(t.total_ttc) }),
        h('dt', { text: 'Réglé' }), h('dd', { text: fmtMoney(t.paid) }),
        h('dt', { text: 'Reste à payer' }), h('dd', { text: fmtMoney(t.balance) })))));
  root.appendChild(h('div', { class: 'section' }, h('h3', { text: 'Règlements' }),
    p.payments && p.payments.length ? table([
      { key: 'paid_on', label: 'Date', render: (r) => fmtDate(r.paid_on) },
      { key: 'amount', label: 'Montant', num: true, render: (r) => fmtMoney(r.amount) },
      { key: 'method', label: 'Mode' }, { key: 'reference', label: 'Référence' }
    ], p.payments) : empty('Aucun règlement', 'Les règlements enregistrés déterminent le statut payé / partiellement payé.')));
}

async function purchaseForm(p, done) {
  const isEdit = !!p;
  const suppliers = await loadSuppliers();
  const header = h('div', { class: 'field-row' },
    field('Fournisseur', select([{ value: '', label: '—' }].concat(suppliers.map((s) => ({ value: s.id, label: s.name, selected: p && p.supplier_id === s.id }))), { name: 'supplier_id', required: true })),
    field('Référence fournisseur', input({ name: 'reference', value: (p && p.reference) || '' })),
    field('Date', input({ name: 'purchased_on', type: 'date', value: p && p.purchased_on ? String(p.purchased_on).slice(0, 10) : new Date().toISOString().slice(0, 10) })),
    field('Échéance', input({ name: 'due_on', type: 'date', value: p && p.due_on ? String(p.due_on).slice(0, 10) : '' })),
    field('Montant HT', input({ name: 'amount_ht', type: 'number', step: '0.001', min: '0', value: p ? p.amount_ht : '', required: true })),
    field('TVA %', input({ name: 'vat_rate', type: 'number', step: '0.01', min: '0', max: '100', value: p && p.vat_rate !== null && p.vat_rate !== undefined ? p.vat_rate : 19 })),
    field('Timbre fiscal', input({ name: 'stamp_amount', type: 'number', step: '0.001', min: '0', value: p && p.stamp_amount !== undefined && p.stamp_amount !== null ? p.stamp_amount : '', placeholder: 'selon Paramètres' }),
      { hint: isEdit ? 'Vide = inchangé. 0 si la facture fournisseur n\'en porte pas.' : 'Vide = valeur par défaut de l\'entité. 0 si la facture fournisseur n\'en porte pas.' }));
  const notes = field('Notes', textarea({ name: 'notes', text: (p && p.notes) || '' }));
  const err = h('p', { class: 'error', role: 'alert', hidden: true });
  const submit = h('button', { type: 'button', class: 'btn btn-primary', text: isEdit ? 'Enregistrer' : 'Créer l\'achat' });
  submit.addEventListener('click', async () => {
    err.hidden = true;
    const body = Object.assign({}, formValues(header), formValues(notes));
    if (!body.supplier_id) { err.textContent = 'Le fournisseur est obligatoire.'; err.hidden = false; return; }
    Object.keys(body).forEach((k) => { if (body[k] === null || body[k] === '') delete body[k]; });
    if (body.due_on === undefined && isEdit && p.due_on) body.due_on = null;
    submit.disabled = true;
    try {
      const out = isEdit ? await api.patch('/purchases/' + p.id, body) : await api.post('/purchases', body);
      closeModal(); toast(isEdit ? 'Achat enregistré.' : 'Achat créé.', 'ok');
      if (!isEdit) window.location.hash = '#/finance/purchases/' + out.id; else done();
    } catch (e) { err.textContent = describeError(e); err.hidden = false; submit.disabled = false; }
  });
  modal({ title: isEdit ? 'Modifier l\'achat' : 'Nouvel achat (facture fournisseur)', wide: true,
    body: h('div', { class: 'stack' }, header, notes, err),
    actions: [h('button', { type: 'button', class: 'btn btn-ghost', text: 'Annuler', onClick: closeModal }), submit] });
}

async function setStatus(p, status, done) {
  try { await api.patch('/purchases/' + p.id, { status }); toast('Statut : ' + status, 'ok'); done(); }
  catch (e) { toast(describeError(e), 'danger'); }
}
async function cancel(p, done) {
  const ok = await confirmDialog({ title: 'Annuler cet achat ?', danger: true, confirmLabel: 'Annuler l\'achat',
    text: 'L\'achat passe au statut annulé ; son écriture comptable, si elle existe, est extournée. Les règlements déjà enregistrés restent.' });
  if (!ok) return;
  try { await api.del('/purchases/' + p.id); toast('Achat annulé.', 'ok'); done(); } catch (e) { toast(describeError(e), 'danger'); }
}
function paymentForm(p, done) {
  const form = h('div', { class: 'field-row' },
    field('Date', input({ name: 'paid_on', type: 'date', value: new Date().toISOString().slice(0, 10), required: true })),
    field('Montant', input({ name: 'amount', type: 'number', step: 'any', min: '0.001', required: true })),
    field('Mode', input({ name: 'method', placeholder: 'virement, espèces, chèque…' })),
    field('Référence', input({ name: 'reference' })));
  const err = h('p', { class: 'error', role: 'alert', hidden: true });
  const submit = h('button', { type: 'button', class: 'btn btn-primary', text: 'Enregistrer' });
  submit.addEventListener('click', async () => {
    const v = formValues(form);
    if (!(Number(v.amount) > 0)) { err.textContent = 'Le montant doit être supérieur à zéro.'; err.hidden = false; return; }
    submit.disabled = true;
    try { const out = await api.post('/purchases/' + p.id + '/payments', v); closeModal(); toast('Règlement enregistré — statut ' + out.purchase_status, 'ok'); done(); }
    catch (e) { err.textContent = describeError(e); err.hidden = false; submit.disabled = false; }
  });
  modal({ title: 'Règlement — ' + (p.reference || shortId(p.id)), body: h('div', {}, form, err),
    actions: [h('button', { type: 'button', class: 'btn btn-ghost', text: 'Annuler', onClick: closeModal }), submit] });
}
