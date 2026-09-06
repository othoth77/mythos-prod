/* Invoices: list, create with lines, edit header/lines while draft, record
 * payments, cancel. Totals are displayed as the API computes them — never
 * recomputed here to be trusted, only echoed. */
import { api, qs, describeError } from '../api.js';
import { session } from '../session.js';
import { h, clear, table, pagination, skeletonRows, empty, errorBox, toast, modal, closeModal, confirmDialog,
  field, input, select, textarea, formValues, fmtDate, fmtMoney, fmtNum, statusBadge, shortId } from '../ui.js';

export function invoicesView(container, id) {
  const root = h('div', { class: 'stack' }); container.appendChild(root);
  if (id) return detail(root, id);
  return list(root);
}

function list(root) {
  const state = { search: '', status: '', offset: 0, limit: 25 };
  const statuses = session.meta().statuses.invoice;
  const search = input({ type: 'search', placeholder: 'Numéro, notes…', 'aria-label': 'Rechercher' });
  let deb; search.addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(() => { state.search = search.value; state.offset = 0; load(); }, 250); });
  const st = select([{ value: '', label: 'Tous les statuts' }].concat(statuses.map((s) => ({ value: s, label: s }))), { 'aria-label': 'Statut' });
  st.addEventListener('change', () => { state.status = st.value; state.offset = 0; load(); });
  const count = h('span', { class: 'toolbar-count' });
  root.appendChild(h('div', { class: 'toolbar' }, field('Rechercher', search), field('Statut', st),
    h('div', { class: 'actions' }, count, h('button', { type: 'button', class: 'btn btn-primary btn-sm', text: 'Nouvelle facture', onClick: () => invoiceForm(null, load) }))));
  const body = h('div', {}); root.appendChild(body);

  async function load() {
    clear(body).appendChild(skeletonRows(6));
    try {
      const page = await api.get('/invoices' + qs({ search: state.search, status: state.status, limit: state.limit, offset: state.offset }));
      clear(body);
      count.textContent = page.total + ' facture' + (page.total > 1 ? 's' : '');
      if (!page.rows.length) { body.appendChild(empty('Aucune facture', 'Créez la première facture ou ajustez les filtres.')); return; }
      body.appendChild(table([
        { key: 'number', label: 'Numéro', render: (r) => h('a', { href: '#/finance/invoices/' + r.id, class: 'mono', text: r.number }) },
        { key: 'issued_on', label: 'Émise le', render: (r) => fmtDate(r.issued_on) },
        { key: 'due_on', label: 'Échéance', render: (r) => fmtDate(r.due_on) },
        { key: 'status', label: 'Statut', render: (r) => statusBadge(r.status) },
        { key: 'client_id', label: 'Client', render: (r) => h('span', { class: 'mono', text: shortId(r.client_id) }) },
        { key: 'currency', label: 'Devise' }
      ], page.rows, (r) => [h('a', { class: 'btn btn-ghost btn-sm', href: '#/finance/invoices/' + r.id, text: 'Ouvrir' })]));
      body.appendChild(pagination({ total: page.total, limit: page.limit, offset: page.offset, onPage: (o) => { state.offset = o; load(); } }));
    } catch (e) { clear(body).appendChild(errorBox(describeError(e), load, e.body && e.body.error)); }
  }
  load();
}

async function detail(root, id) {
  root.appendChild(skeletonRows(4));
  let inv;
  try { inv = await api.get('/invoices/' + id); }
  catch (e) { clear(root).appendChild(errorBox(describeError(e), () => detail(clear(root), id), e.body && e.body.error)); return; }
  clear(root);
  const t = inv.totals || {};
  const editable = inv.status === 'draft';
  root.appendChild(h('p', { class: 'print-only', text: (session.activeTenant() || {}).display_name || '' }));
  root.appendChild(h('div', { class: 'toolbar' },
    h('a', { class: 'btn btn-ghost btn-sm', href: '#/finance/invoices', text: '← Factures' }),
    h('h3', { class: 'mono', text: inv.number }), statusBadge(inv.status),
    h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Imprimer', onClick: () => window.print() }),
      editable ? h('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Modifier', onClick: () => invoiceForm(inv, () => detail(clear(root), id)) }) : null,
      editable ? h('button', { type: 'button', class: 'btn btn-primary btn-sm', text: 'Marquer envoyée', onClick: () => setStatus(inv, 'sent', () => detail(clear(root), id)) }) : null,
      (inv.status === 'sent' || inv.status === 'part_paid') ? h('button', { type: 'button', class: 'btn btn-primary btn-sm', text: 'Enregistrer un paiement', onClick: () => paymentForm(inv, () => detail(clear(root), id)) }) : null,
      inv.status !== 'cancelled' && inv.status !== 'paid' ? h('button', { type: 'button', class: 'btn btn-danger btn-sm', text: 'Annuler la facture', onClick: () => cancel(inv, () => detail(clear(root), id)) }) : null)));
  const dl = h('dl', { class: 'kv' });
  [['Émise le', fmtDate(inv.issued_on)], ['Échéance', fmtDate(inv.due_on)], ['Client', shortId(inv.client_id)], ['Projet', shortId(inv.project_id)],
    ['Devise', inv.currency || 'TND'], ['Mode de paiement', inv.payment_mode || '—'], ['Notes', inv.notes || '—']]
    .forEach(([k, v]) => dl.append(h('dt', { text: k }), h('dd', { text: v })));
  root.appendChild(h('div', { class: 'grid cols-2' },
    h('article', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', { text: 'En-tête' })), dl),
    h('article', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', { text: 'Totaux (calculés par le serveur)' })),
      h('dl', { class: 'kv' },
        h('dt', { text: 'Total HT' }), h('dd', { text: fmtMoney(t.total_ht, inv.currency) }),
        h('dt', { text: 'TVA' }), h('dd', { text: fmtMoney(t.total_vat, inv.currency) }),
        h('dt', { text: 'Total TTC' }), h('dd', { text: fmtMoney(t.total_ttc, inv.currency) }),
        h('dt', { text: 'Payé' }), h('dd', { text: fmtMoney(t.paid, inv.currency) }),
        h('dt', { text: 'Reste dû' }), h('dd', { text: fmtMoney(t.balance ?? (t.total_ttc !== undefined && t.paid !== undefined ? Number(t.total_ttc) - Number(t.paid) : null), inv.currency) })))));
  root.appendChild(h('div', { class: 'section' }, h('h3', { text: 'Lignes' }),
    inv.lines && inv.lines.length ? table([
      { key: 'position', label: '#', num: true }, { key: 'description', label: 'Description' }, { key: 'unit', label: 'Unité' },
      { key: 'quantity', label: 'Qté', num: true, render: (r) => fmtNum(r.quantity, 3) },
      { key: 'unit_price', label: 'PU HT', num: true, render: (r) => fmtNum(r.unit_price, 3) },
      { key: 'vat_rate', label: 'TVA %', num: true, render: (r) => fmtNum(r.vat_rate, 2) },
      { key: 'line_ht', label: 'Ligne HT', num: true, render: (r) => fmtNum(r.line_ht, 3) }
    ], inv.lines) : empty('Aucune ligne', 'Une facture sans ligne ne peut pas être émise.')));
  root.appendChild(h('div', { class: 'section' }, h('h3', { text: 'Paiements' }),
    inv.payments && inv.payments.length ? table([
      { key: 'paid_on', label: 'Date', render: (r) => fmtDate(r.paid_on) },
      { key: 'amount', label: 'Montant', num: true, render: (r) => fmtMoney(r.amount, inv.currency) },
      { key: 'method', label: 'Mode' }, { key: 'reference', label: 'Référence' }
    ], inv.payments) : empty('Aucun paiement', 'Les paiements enregistrés déterminent le statut payé / partiellement payé.')));
}

function lineRow(l = {}) {
  return h('tr', {},
    h('td', {}, input({ name: 'description', value: l.description || '', placeholder: 'Description', required: true })),
    h('td', {}, input({ name: 'unit', value: l.unit || '', placeholder: 'u' })),
    h('td', {}, input({ name: 'quantity', type: 'number', step: 'any', min: '0.001', value: l.quantity ?? 1 })),
    h('td', {}, input({ name: 'unit_price', type: 'number', step: 'any', min: '0', value: l.unit_price ?? 0 })),
    h('td', {}, input({ name: 'vat_rate', type: 'number', step: 'any', min: '0', value: l.vat_rate ?? 19 })),
    h('td', {}, h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: '✕', 'aria-label': 'Supprimer la ligne', onClick: (e) => e.target.closest('tr').remove() })));
}

async function invoiceForm(inv, done) {
  const isEdit = !!inv;
  let clients = [];
  try { clients = (await api.get('/clients?limit=200')).rows; } catch (e) { clients = []; }
  const header = h('div', { class: 'field-row' },
    field('Client', select([{ value: '', label: '—' }].concat(clients.map((c) => ({ value: c.id, label: c.name, selected: inv && inv.client_id === c.id }))), { name: 'client_id' })),
    field('Émise le', input({ name: 'issued_on', type: 'date', value: inv && inv.issued_on ? String(inv.issued_on).slice(0, 10) : new Date().toISOString().slice(0, 10), required: true })),
    field('Échéance', input({ name: 'due_on', type: 'date', value: inv && inv.due_on ? String(inv.due_on).slice(0, 10) : '' })),
    field('Devise', input({ name: 'currency', value: (inv && inv.currency) || 'TND', maxlength: 3 })),
    field('Mode de paiement', input({ name: 'payment_mode', value: (inv && inv.payment_mode) || '' })));
  const notes = field('Notes', textarea({ name: 'notes', text: (inv && inv.notes) || '' }));
  const tbody = h('tbody', {}, ((inv && inv.lines && inv.lines.length) ? inv.lines : [{}]).map(lineRow));
  const linesTable = h('div', { class: 'table-wrap' }, h('table', { class: 'data lines' },
    h('thead', {}, h('tr', {}, ['Description', 'Unité', 'Qté', 'PU HT', 'TVA %', ''].map((t) => h('th', { scope: 'col', text: t })))), tbody));
  const err = h('p', { class: 'error', role: 'alert', hidden: true });
  const submit = h('button', { type: 'button', class: 'btn btn-primary', text: isEdit ? 'Enregistrer' : 'Créer la facture' });
  submit.addEventListener('click', async () => {
    err.hidden = true;
    const hv = formValues(header); const nv = formValues(notes);
    const lines = [...tbody.querySelectorAll('tr')].map((tr) => {
      const v = {}; tr.querySelectorAll('[name]').forEach((el) => { v[el.name] = el.value; });
      return { description: v.description, unit: v.unit || null, quantity: Number(v.quantity), unit_price: Number(v.unit_price), vat_rate: Number(v.vat_rate) };
    });
    if (!lines.length || lines.some((l) => !l.description)) { err.textContent = 'Chaque ligne doit avoir une description.'; err.hidden = false; return; }
    submit.disabled = true;
    try {
      const body = Object.assign({}, hv, nv, { lines });
      Object.keys(body).forEach((k) => { if (body[k] === null) delete body[k]; });
      const out = isEdit ? await api.patch('/invoices/' + inv.id, body) : await api.post('/invoices', body);
      closeModal(); toast(isEdit ? 'Facture enregistrée.' : 'Facture ' + out.number + ' créée.', 'ok');
      if (!isEdit) window.location.hash = '#/finance/invoices/' + out.id; else done();
    } catch (e) { err.textContent = describeError(e); err.hidden = false; submit.disabled = false; }
  });
  modal({ title: isEdit ? 'Modifier la facture ' + inv.number : 'Nouvelle facture', wide: true,
    body: h('div', { class: 'stack' }, header, notes, h('div', {}, h('h3', { text: 'Lignes' }), linesTable,
      h('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: '+ Ligne', onClick: () => tbody.appendChild(lineRow()) })), err),
    actions: [h('button', { type: 'button', class: 'btn btn-ghost', text: 'Annuler', onClick: closeModal }), submit] });
}

async function setStatus(inv, status, done) {
  try { await api.patch('/invoices/' + inv.id, { status }); toast('Statut : ' + status, 'ok'); done(); }
  catch (e) { toast(describeError(e), 'danger'); }
}
async function cancel(inv, done) {
  const ok = await confirmDialog({ title: 'Annuler la facture ' + inv.number + ' ?', danger: true, confirmLabel: 'Annuler la facture',
    text: 'La facture passe au statut annulé. Rien n\'est effacé ; l\'opération est tracée.' });
  if (!ok) return;
  try { await api.del('/invoices/' + inv.id); toast('Facture annulée.', 'ok'); done(); } catch (e) { toast(describeError(e), 'danger'); }
}
function paymentForm(inv, done) {
  const form = h('div', { class: 'field-row' },
    field('Date', input({ name: 'paid_on', type: 'date', value: new Date().toISOString().slice(0, 10), required: true })),
    field('Montant', input({ name: 'amount', type: 'number', step: 'any', min: '0.001', required: true })),
    field('Mode', input({ name: 'method', placeholder: 'virement, espèces…' })),
    field('Référence', input({ name: 'reference' })));
  const err = h('p', { class: 'error', role: 'alert', hidden: true });
  const submit = h('button', { type: 'button', class: 'btn btn-primary', text: 'Enregistrer' });
  submit.addEventListener('click', async () => {
    const v = formValues(form);
    if (!(Number(v.amount) > 0)) { err.textContent = 'Le montant doit être supérieur à zéro.'; err.hidden = false; return; }
    submit.disabled = true;
    try { const out = await api.post('/invoices/' + inv.id + '/payments', v); closeModal(); toast('Paiement enregistré — statut ' + out.invoice_status, 'ok'); done(); }
    catch (e) { err.textContent = describeError(e); err.hidden = false; submit.disabled = false; }
  });
  modal({ title: 'Paiement — ' + inv.number, body: h('div', {}, form, err),
    actions: [h('button', { type: 'button', class: 'btn btn-ghost', text: 'Annuler', onClick: closeModal }), submit] });
}
