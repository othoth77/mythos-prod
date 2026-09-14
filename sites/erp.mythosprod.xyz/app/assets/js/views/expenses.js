/* Dépenses (Phase 7): list, detail, create, edit (links/description only
 * once posted), retire. Amounts are what was paid; the HT/VAT split and the
 * ledger entry come from the API and are only echoed here. */
import { api, qs, describeError } from '../api.js';
import { h, clear, table, pagination, skeletonRows, empty, errorBox, toast, modal, closeModal, confirmDialog,
  field, input, select, textarea, formValues, fmtDate, fmtMoney, fmtNum, shortId } from '../ui.js';

export function expensesView(container, id) {
  const root = h('div', { class: 'stack' }); container.appendChild(root);
  if (id) return detail(root, id);
  return list(root);
}

async function loadRefs() {
  const get = async (p) => { try { return (await api.get(p)).rows; } catch (e) { return []; } };
  const [categories, suppliers, projects] = await Promise.all([get('/expense_categories?limit=200'), get('/suppliers?limit=200'), get('/projects?limit=200')]);
  return { categories, suppliers, projects };
}

function list(root) {
  const state = { search: '', category_id: '', offset: 0, limit: 25 };
  const toolbar = h('div', {}); const body = h('div', {});
  root.appendChild(toolbar); root.appendChild(body);
  let refs = { categories: [], suppliers: [], projects: [] };
  const catLabel = (id) => (refs.categories.find((c) => c.id === id) || {}).label || '—';

  async function load() {
    clear(body).appendChild(skeletonRows(6));
    try {
      const page = await api.get('/expenses' + qs({ search: state.search, category_id: state.category_id, limit: state.limit, offset: state.offset }));
      clear(body);
      const count = toolbar.querySelector('.toolbar-count');
      if (count) count.textContent = page.total + ' dépense' + (page.total > 1 ? 's' : '');
      if (!page.rows.length) { body.appendChild(empty('Aucune dépense', 'Enregistrez la première dépense ou ajustez les filtres.')); return; }
      body.appendChild(table([
        { key: 'spent_on', label: 'Date', render: (r) => fmtDate(r.spent_on) },
        { key: 'description', label: 'Libellé', render: (r) => h('a', { href: '#/finance/expenses/' + r.id, text: r.description }) },
        { key: 'category_id', label: 'Catégorie', render: (r) => catLabel(r.category_id) },
        { key: 'payment_method', label: 'Mode', render: (r) => r.payment_method || '—' },
        { key: 'amount', label: 'Montant', num: true, render: (r) => fmtNum(r.amount, 3) }
      ], page.rows, (r) => [h('a', { class: 'btn btn-ghost btn-sm', href: '#/finance/expenses/' + r.id, text: 'Ouvrir' })]));
      body.appendChild(pagination({ total: page.total, limit: page.limit, offset: page.offset, onPage: (o) => { state.offset = o; load(); } }));
    } catch (e) { clear(body).appendChild(errorBox(describeError(e), load, e.body && e.body.error)); }
  }

  async function init() {
    refs = await loadRefs();
    const cat = select([{ value: '', label: 'Toutes les catégories' }, ...refs.categories.map((c) => ({ value: c.id, label: c.label }))], { 'aria-label': 'Catégorie' });
    cat.addEventListener('change', () => { state.category_id = cat.value; state.offset = 0; load(); });
    const search = input({ type: 'search', placeholder: 'Libellé, mode…', 'aria-label': 'Rechercher' });
    let deb; search.addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(() => { state.search = search.value; state.offset = 0; load(); }, 250); });
    clear(toolbar).appendChild(h('div', { class: 'toolbar' }, field('Catégorie', cat), field('Rechercher', search),
      h('div', { class: 'actions' }, h('span', { class: 'toolbar-count' }),
        h('button', { type: 'button', class: 'btn btn-primary btn-sm', text: 'Nouvelle dépense', onClick: () => expenseForm(null, refs, load) }))));
    load();
  }
  init();
}

async function detail(root, id) {
  root.appendChild(skeletonRows(4));
  let x, refs;
  try { [x, refs] = await Promise.all([api.get('/expenses/' + id), loadRefs()]); }
  catch (e) { clear(root).appendChild(errorBox(describeError(e), () => detail(clear(root), id), e.body && e.body.error)); return; }
  clear(root);
  const t = x.totals || {};
  const reload = () => detail(clear(root), id);
  const cat = refs.categories.find((c) => c.id === x.category_id);
  root.appendChild(h('div', { class: 'toolbar' },
    h('a', { class: 'btn btn-ghost btn-sm', href: '#/finance/expenses', text: '← Dépenses' }),
    h('h3', { text: x.description }),
    h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Modifier', onClick: () => expenseForm(x, refs, reload) }),
      h('button', { type: 'button', class: 'btn btn-danger btn-sm', text: 'Retirer', onClick: async () => {
        if (!(await confirmDialog({ title: 'Retirer cette dépense ?', danger: true, confirmLabel: 'Retirer', text: x.accounting ? 'Son écriture comptable est extournée ; rien n\'est effacé, l\'opération est tracée.' : 'Rien n\'est effacé ; l\'opération est tracée.' }))) return;
        try { await api.del('/expenses/' + x.id); toast('Dépense retirée.', 'ok'); window.location.hash = '#/finance/expenses'; }
        catch (e) { toast(describeError(e), 'danger'); }
      } }))));
  const dl = h('dl', { class: 'kv' });
  [['Date', fmtDate(x.spent_on)], ['Catégorie', cat ? cat.label : '—'], ['Mode de paiement', x.payment_method || '—'],
   ['Fournisseur', shortId(x.supplier_id)], ['Projet', shortId(x.project_id)],
   ['Écriture', x.accounting ? 'n° ' + x.accounting.entry_no + ' (' + x.accounting.status + ')' : 'non comptabilisée']]
   .forEach(([k, v]) => dl.append(h('dt', { text: k }), h('dd', { text: v })));
  root.appendChild(h('div', { class: 'grid cols-2' },
    h('article', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', { text: 'Dépense' })), dl),
    h('article', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', { text: 'Montants (calculés par le serveur)' })),
      h('dl', { class: 'kv' },
        h('dt', { text: 'Payé (TTC)' }), h('dd', { text: fmtMoney(t.amount) }),
        h('dt', { text: 'HT' }), h('dd', { text: fmtMoney(t.total_ht) }),
        h('dt', { text: 'TVA déductible (' + fmtNum(x.vat_rate, 2) + ' %)' }), h('dd', { text: fmtMoney(t.total_vat) })))));
  if (x.accounting) root.appendChild(h('p', { class: 'hint', text: 'Montant, date, TVA, mode et catégorie sont figés une fois comptabilisés : retirez la dépense et enregistrez-en une nouvelle pour les changer.' }));
}

function expenseForm(x, refs, done) {
  const isEdit = !!x;
  const posted = !!(x && x.accounting);
  const opt = (rows, cur, key = 'label') => [{ value: '', label: '—' }].concat(rows.map((r) => ({ value: r.id, label: r[key] || r.name || shortId(r.id), selected: cur === r.id })));
  const header = h('div', { class: 'field-row' },
    field('Libellé', input({ name: 'description', value: (x && x.description) || '', required: true })),
    field('Date', input({ name: 'spent_on', type: 'date', value: x && x.spent_on ? String(x.spent_on).slice(0, 10) : new Date().toISOString().slice(0, 10), disabled: posted || null })),
    field('Montant payé (TTC)', input({ name: 'amount', type: 'number', step: '0.001', min: '0.001', value: x ? x.amount : '', required: true, disabled: posted || null })),
    field('TVA %', input({ name: 'vat_rate', type: 'number', step: '0.01', min: '0', max: '100', value: x && x.vat_rate !== null && x.vat_rate !== undefined ? x.vat_rate : 0, disabled: posted || null }), { hint: '0 = pas de TVA. Le HT et la TVA déductible sont déduits du montant payé.' }),
    field('Mode de paiement', input({ name: 'payment_method', value: (x && x.payment_method) || '', placeholder: 'espèces, virement, chèque, carte…', disabled: posted || null }), { hint: 'espèces / caisse → journal de caisse ; sinon banque.' }),
    field('Catégorie', select(opt(refs.categories, x && x.category_id), { name: 'category_id', disabled: posted || null })),
    field('Fournisseur', select(opt(refs.suppliers, x && x.supplier_id, 'name'), { name: 'supplier_id' })),
    field('Projet', select(opt(refs.projects, x && x.project_id, 'title'), { name: 'project_id' })));
  const err = h('p', { class: 'error', role: 'alert', hidden: true });
  const submit = h('button', { type: 'button', class: 'btn btn-primary', text: isEdit ? 'Enregistrer' : 'Enregistrer la dépense' });
  submit.addEventListener('click', async () => {
    err.hidden = true;
    const v = formValues(header);
    const body = {};
    Object.keys(v).forEach((k) => { if (v[k] !== null && v[k] !== undefined) body[k] = v[k]; });
    // On edit, an emptied link must be sent as null so it is actually cleared
    // (formValues maps '' to null; the loop above would otherwise drop it).
    if (isEdit) ['supplier_id', 'project_id', 'category_id'].forEach((k) => { if (v[k] === null) body[k] = null; });
    if (posted) ['spent_on', 'amount', 'vat_rate', 'payment_method', 'category_id'].forEach((k) => delete body[k]);
    if (!isEdit && !(Number(body.amount) > 0)) { err.textContent = 'Le montant doit être supérieur à zéro.'; err.hidden = false; return; }
    submit.disabled = true;
    try {
      const out = isEdit ? await api.patch('/expenses/' + x.id, body) : await api.post('/expenses', body);
      closeModal(); toast(isEdit ? 'Dépense enregistrée.' : (out.accounting && out.accounting.entry_no ? 'Dépense enregistrée — écriture n° ' + out.accounting.entry_no : 'Dépense enregistrée.'), 'ok');
      if (!isEdit) window.location.hash = '#/finance/expenses/' + out.id; else done();
    } catch (e) { err.textContent = describeError(e); err.hidden = false; submit.disabled = false; }
  });
  modal({ title: isEdit ? 'Modifier la dépense' : 'Nouvelle dépense', wide: true,
    body: h('div', { class: 'stack' }, header, err),
    actions: [h('button', { type: 'button', class: 'btn btn-ghost', text: 'Annuler', onClick: closeModal }), submit] });
}
