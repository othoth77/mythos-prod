/* Quotes: list, create with lines, edit while not yet decided, convert an
 * accepted quote into an invoice. Mirrors views/invoices.js's shape closely
 * on purpose — same primitives, same patterns, no payments (a quote is not
 * yet money) and one extra action a quote alone has. */
import { api, qs, describeError } from '../api.js';
import { session } from '../session.js';
import { h, clear, table, pagination, skeletonRows, empty, errorBox, toast, modal, closeModal, confirmDialog,
  field, input, select, textarea, formValues, fmtDate, fmtMoney, fmtNum, statusBadge, shortId } from '../ui.js';

export function quotesView(container, id) {
  const root = h('div', { class: 'stack' }); container.appendChild(root);
  if (id) return detail(root, id);
  return list(root);
}

function list(root) {
  const state = { search: '', status: '', offset: 0, limit: 25 };
  const statuses = session.meta().statuses.quote;
  const search = input({ type: 'search', placeholder: 'Numéro, notes…', 'aria-label': 'Rechercher' });
  let deb; search.addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(() => { state.search = search.value; state.offset = 0; load(); }, 250); });
  const st = select([{ value: '', label: 'Tous les statuts' }].concat(statuses.map((s) => ({ value: s, label: s }))), { 'aria-label': 'Statut' });
  st.addEventListener('change', () => { state.status = st.value; state.offset = 0; load(); });
  const count = h('span', { class: 'toolbar-count' });
  root.appendChild(h('div', { class: 'toolbar' }, field('Rechercher', search), field('Statut', st),
    h('div', { class: 'actions' }, count, h('button', { type: 'button', class: 'btn btn-primary btn-sm', text: 'Nouveau devis', onClick: () => quoteForm(null, load) }))));
  const body = h('div', {}); root.appendChild(body);

  async function load() {
    clear(body).appendChild(skeletonRows(6));
    try {
      const page = await api.get('/quotes' + qs({ search: state.search, status: state.status, limit: state.limit, offset: state.offset }));
      clear(body);
      count.textContent = page.total + ' devis';
      if (!page.rows.length) { body.appendChild(empty('Aucun devis', 'Créez le premier devis ou ajustez les filtres.')); return; }
      body.appendChild(table([
        { key: 'number', label: 'Numéro', render: (r) => h('a', { href: '#/finance/quotes/' + r.id, class: 'mono', text: r.number }) },
        { key: 'issued_on', label: 'Émis le', render: (r) => fmtDate(r.issued_on) },
        { key: 'valid_until', label: 'Valide jusqu\'au', render: (r) => fmtDate(r.valid_until) },
        { key: 'status', label: 'Statut', render: (r) => statusBadge(r.status) },
        { key: 'client_id', label: 'Client', render: (r) => h('span', { class: 'mono', text: shortId(r.client_id) }) },
        { key: 'currency', label: 'Devise' }
      ], page.rows, (r) => [h('a', { class: 'btn btn-ghost btn-sm', href: '#/finance/quotes/' + r.id, text: 'Ouvrir' })]));
      body.appendChild(pagination({ total: page.total, limit: page.limit, offset: page.offset, onPage: (o) => { state.offset = o; load(); } }));
    } catch (e) { clear(body).appendChild(errorBox(describeError(e), load, e.body && e.body.error)); }
  }
  load();
}

async function detail(root, id) {
  root.appendChild(skeletonRows(4));
  let q;
  try { q = await api.get('/quotes/' + id); }
  catch (e) { clear(root).appendChild(errorBox(describeError(e), () => detail(clear(root), id), e.body && e.body.error)); return; }
  clear(root);
  const t = q.totals || {};
  const editable = q.status === 'draft' || q.status === 'sent';
  root.appendChild(h('p', { class: 'print-only', text: (session.activeTenant() || {}).display_name || '' }));
  root.appendChild(h('div', { class: 'toolbar' },
    h('a', { class: 'btn btn-ghost btn-sm', href: '#/finance/quotes', text: '← Devis' }),
    h('h3', { class: 'mono', text: q.number }), statusBadge(q.status),
    h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Imprimer', onClick: () => window.print() }),
      editable ? h('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Modifier', onClick: () => quoteForm(q, () => detail(clear(root), id)) }) : null,
      q.status === 'draft' ? h('button', { type: 'button', class: 'btn btn-primary btn-sm', text: 'Marquer envoyé', onClick: () => setStatus(q, 'sent', () => detail(clear(root), id)) }) : null,
      (q.status === 'draft' || q.status === 'sent') ? h('button', { type: 'button', class: 'btn btn-primary btn-sm', text: 'Marquer accepté', onClick: () => setStatus(q, 'accepted', () => detail(clear(root), id)) }) : null,
      (q.status === 'draft' || q.status === 'sent') ? h('button', { type: 'button', class: 'btn btn-danger btn-sm', text: 'Marquer refusé', onClick: () => setStatus(q, 'refused', () => detail(clear(root), id)) }) : null,
      q.status === 'accepted' ? h('button', { type: 'button', class: 'btn btn-primary btn-sm', text: 'Convertir en facture', onClick: () => convert(q) }) : null)));
  const dl = h('dl', { class: 'kv' });
  [['Émis le', fmtDate(q.issued_on)], ['Valide jusqu\'au', fmtDate(q.valid_until)], ['Client', shortId(q.client_id)], ['Projet', shortId(q.project_id)],
    ['Devise', q.currency || 'TND'], ['Notes', q.notes || '—']]
    .forEach(([k, v]) => dl.append(h('dt', { text: k }), h('dd', { text: v })));
  root.appendChild(h('div', { class: 'grid cols-2' },
    h('article', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', { text: 'En-tête' })), dl),
    h('article', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', { text: 'Totaux (calculés par le serveur)' })),
      h('dl', { class: 'kv' },
        h('dt', { text: 'Total HT' }), h('dd', { text: fmtMoney(t.total_ht, q.currency) }),
        h('dt', { text: 'TVA' }), h('dd', { text: fmtMoney(t.total_vat, q.currency) }),
        h('dt', { text: 'Total TTC' }), h('dd', { text: fmtMoney(t.total_ttc, q.currency) })))));
  root.appendChild(h('div', { class: 'section' }, h('h3', { text: 'Lignes' }),
    q.lines && q.lines.length ? table([
      { key: 'position', label: '#', num: true }, { key: 'description', label: 'Description' }, { key: 'unit', label: 'Unité' },
      { key: 'quantity', label: 'Qté', num: true, render: (r) => fmtNum(r.quantity, 3) },
      { key: 'unit_price', label: 'PU HT', num: true, render: (r) => fmtNum(r.unit_price, 3) },
      { key: 'vat_rate', label: 'TVA %', num: true, render: (r) => fmtNum(r.vat_rate, 2) },
      { key: 'line_ht', label: 'Ligne HT', num: true, render: (r) => fmtNum(r.line_ht, 3) }
    ], q.lines) : empty('Aucune ligne', 'Un devis sans ligne ne peut pas être converti en facture.')));

  async function convert(row) {
    const ok = await confirmDialog({ title: 'Convertir « ' + row.number + ' » en facture ?', confirmLabel: 'Convertir',
      text: 'Une facture brouillon est créée avec les mêmes lignes ; le devis reste consultable tel quel.' });
    if (!ok) return;
    try {
      const out = await api.post('/quotes/' + row.id + '/convert', {});
      toast('Facture ' + out.invoice_number + ' créée.', 'ok');
      window.location.hash = '#/finance/invoices/' + out.invoice_id;
    } catch (e) { toast(describeError(e), 'danger'); }
  }
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

async function quoteForm(q, done) {
  const isEdit = !!q;
  let clients = [];
  try { clients = (await api.get('/clients?limit=200')).rows; } catch (e) { clients = []; }
  const header = h('div', { class: 'field-row' },
    field('Client', select([{ value: '', label: '—' }].concat(clients.map((c) => ({ value: c.id, label: c.name, selected: q && q.client_id === c.id }))), { name: 'client_id' })),
    field('Émis le', input({ name: 'issued_on', type: 'date', value: q && q.issued_on ? String(q.issued_on).slice(0, 10) : new Date().toISOString().slice(0, 10), required: true })),
    field('Valide jusqu\'au', input({ name: 'valid_until', type: 'date', value: q && q.valid_until ? String(q.valid_until).slice(0, 10) : '' })),
    field('Devise', input({ name: 'currency', value: (q && q.currency) || 'TND', maxlength: 3 })));
  const notes = field('Notes', textarea({ name: 'notes', text: (q && q.notes) || '' }));
  const tbody = h('tbody', {}, ((q && q.lines && q.lines.length) ? q.lines : [{}]).map(lineRow));
  const linesTable = h('div', { class: 'table-wrap' }, h('table', { class: 'data lines' },
    h('thead', {}, h('tr', {}, ['Description', 'Unité', 'Qté', 'PU HT', 'TVA %', ''].map((t) => h('th', { scope: 'col', text: t })))), tbody));
  const err = h('p', { class: 'error', role: 'alert', hidden: true });
  const submit = h('button', { type: 'button', class: 'btn btn-primary', text: isEdit ? 'Enregistrer' : 'Créer le devis' });
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
      const out = isEdit ? await api.patch('/quotes/' + q.id, body) : await api.post('/quotes', body);
      closeModal(); toast(isEdit ? 'Devis enregistré.' : 'Devis ' + out.number + ' créé.', 'ok');
      if (!isEdit) window.location.hash = '#/finance/quotes/' + out.id; else done();
    } catch (e) { err.textContent = describeError(e); err.hidden = false; submit.disabled = false; }
  });
  modal({ title: isEdit ? 'Modifier le devis ' + q.number : 'Nouveau devis', wide: true,
    body: h('div', { class: 'stack' }, header, notes, h('div', {}, h('h3', { text: 'Lignes' }), linesTable,
      h('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: '+ Ligne', onClick: () => tbody.appendChild(lineRow()) })), err),
    actions: [h('button', { type: 'button', class: 'btn btn-ghost', text: 'Annuler', onClick: closeModal }), submit] });
}

async function setStatus(q, status, done) {
  try { await api.patch('/quotes/' + q.id, { status }); toast('Statut : ' + status, 'ok'); done(); }
  catch (e) { toast(describeError(e), 'danger'); }
}
