/* Generic resource view, driven by GET /api/v1/meta.
 *
 * List (search, filter, sort, paginate), create, edit, retire — for every
 * declarative resource the API exposes. Nothing here knows a table name: the
 * columns, fields, required set and filters come from the contract the server
 * publishes, so a new module in registry.js appears here without a UI change.
 */
import { api, qs, describeError } from '../api.js';
import { session } from '../session.js';
import { h, clear, table, pagination, skeletonRows, empty, errorBox, toast, modal, closeModal,
  confirmDialog, field, input, select, textarea, formValues, fmtDate, fmtNum, statusBadge, shortId } from '../ui.js';

const LABELS = {
  name: 'Nom', full_name: 'Nom complet', email: 'E-mail', phone: 'Téléphone', address: 'Adresse', city: 'Ville',
  postal_code: 'Code postal', notes: 'Notes', tax_id: 'Identifiant fiscal', legacy_id: 'Réf. historique',
  client_id: 'Client', project_id: 'Projet', supplier_id: 'Fournisseur', nature_id: 'Nature', category_id: 'Catégorie',
  role_label: 'Rôle', source: 'Source', reference: 'Référence', title: 'Titre', status: 'Statut', starts_on: 'Début',
  ends_on: 'Fin', starts_at: 'Début', ends_at: 'Fin', location: 'Lieu', venue: 'Salle', capacity: 'Capacité',
  signed_on: 'Signé le', amount_ttc: 'Montant TTC', number: 'Numéro', issued_on: 'Émis le', valid_until: 'Valide jusqu\'au',
  currency: 'Devise', purchased_on: 'Acheté le', amount_ht: 'Montant HT', vat_rate: 'TVA %', spent_on: 'Dépensé le',
  amount: 'Montant', description: 'Description', original_name: 'Fichier', mime_type: 'Type', byte_size: 'Taille',
  category: 'Catégorie', sku: 'SKU', label: 'Libellé', unit: 'Unité', min_quantity: 'Seuil de réappro.', kind: 'Type',
  iban: 'IBAN', created_at: 'Créé le', updated_at: 'Modifié le', user_id: 'Utilisateur', quote_id: 'Devis',
  sha256: 'SHA-256', storage_key: 'Clé de stockage', uploaded_by: 'Déposé par',
  contact_name: 'Contact', score: 'Score', expected_value: 'Valeur estimée', next_action_on: 'Prochaine action',
  converted_client_id: 'Client converti', converted_at: 'Converti le'
};
export const RESOURCE_TITLES = {
  clients: 'Clients', contacts: 'Contacts', suppliers: 'Fournisseurs', collaborators: 'Collaborateurs',
  projects: 'Projets', appointments: 'Rendez-vous', representations: 'Représentations', contracts: 'Contrats',
  quotes: 'Devis', purchases: 'Achats', expenses: 'Dépenses', documents: 'Documents', inventory_items: 'Articles',
  natures: 'Natures de projet', expense_categories: 'Catégories de dépense', bank_accounts: 'Comptes bancaires',
  prospects: 'Prospects'
};
const HIDDEN_COLUMNS = ['id', 'deleted_at', 'legacy_id', 'notes', 'updated_at', 'storage_key', 'sha256', 'uploaded_by', 'address', 'postal_code'];
const DATE_FIELDS = /(_on|_at)$/;
const NUM_FIELDS = /^(amount|amount_ht|amount_ttc|vat_rate|capacity|min_quantity|byte_size|score|expected_value)$/;
const LOOKUPS = { client_id: 'clients', project_id: 'projects', supplier_id: 'suppliers', nature_id: 'natures', category_id: 'expense_categories' };

export function label(k) { return LABELS[k] || k; }

function render(col, row) {
  const v = row[col];
  if (v === null || v === undefined) return '—';
  if (col === 'status') return statusBadge(v);
  if (DATE_FIELDS.test(col)) return fmtDate(v);
  if (NUM_FIELDS.test(col)) return fmtNum(v, /^(capacity|byte_size|score)$/.test(col) ? 0 : 3);
  if (/_id$/.test(col)) return h('span', { class: 'mono', title: v, text: shortId(v) });
  return String(v);
}

export function resourceView(name, container, opts = {}) {
  const meta = session.meta().resources[name];
  if (!meta) { container.appendChild(errorBox('Ressource inconnue : ' + name)); return; }
  const state = { search: '', filters: {}, sort: meta.defaultSort, dir: 'desc', offset: 0, limit: 25 };
  const columns = meta.columns.filter((c) => !HIDDEN_COLUMNS.includes(c));
  const statuses = statusesFor(name);

  const root = h('div', { class: 'stack' });
  container.appendChild(root);

  const toolbar = h('div', { class: 'toolbar' });
  const search = input({ type: 'search', placeholder: 'Rechercher…', 'aria-label': 'Rechercher', autocomplete: 'off' });
  let debounce;
  search.addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(() => { state.search = search.value; state.offset = 0; load(); }, 250); });
  if (meta.searchable.length) toolbar.appendChild(field('Rechercher (' + meta.searchable.map(label).join(', ') + ')', search));
  if (meta.filters.includes('status') && statuses) {
    const sel = select([{ value: '', label: 'Tous les statuts' }].concat(statuses.map((s) => ({ value: s, label: s }))), { 'aria-label': 'Statut' });
    sel.addEventListener('change', () => { state.filters.status = sel.value; state.offset = 0; load(); });
    toolbar.appendChild(field('Statut', sel));
  }
  const count = h('span', { class: 'toolbar-count' });
  const actions = h('div', { class: 'actions' }, count);
  if (meta.createable) actions.appendChild(h('button', { type: 'button', class: 'btn btn-primary btn-sm', text: 'Nouveau', onClick: () => openForm(null) }));
  toolbar.appendChild(actions);
  root.appendChild(toolbar);

  const body = h('div', {});
  root.appendChild(body);

  async function load() {
    clear(body).appendChild(skeletonRows(6));
    try {
      const page = await api.get('/' + name + qs({ search: state.search, sort: state.sort, dir: state.dir, limit: state.limit, offset: state.offset, ...state.filters }));
      clear(body);
      count.textContent = page.total + ' enregistrement' + (page.total > 1 ? 's' : '');
      if (!page.rows.length) {
        body.appendChild(empty('Aucun enregistrement', state.search || state.filters.status ? 'Aucun résultat pour ces critères.' : 'Rien n\'a encore été saisi dans ' + (RESOURCE_TITLES[name] || name) + '.'));
        return;
      }
      body.appendChild(table(columns.map((c) => ({ key: c, label: label(c), num: NUM_FIELDS.test(c), render: (r) => render(c, r) })), page.rows,
        (r) => [
          h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Détail', onClick: () => openDetail(r) }),
          h('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Modifier', onClick: () => openForm(r) }),
          name === 'prospects' && !r.converted_client_id
            ? h('button', { type: 'button', class: 'btn btn-primary btn-sm', text: 'Convertir en client', onClick: () => convertProspect(r) })
            : null,
          name === 'prospects' && r.converted_client_id
            ? h('a', { class: 'btn btn-ghost btn-sm', href: '#/clients', title: r.converted_client_id, text: 'Client ✓' })
            : null,
          h('button', { type: 'button', class: 'btn btn-danger btn-sm', text: 'Retirer', onClick: () => retire(r) })
        ]));
      body.appendChild(pagination({ total: page.total, limit: page.limit, offset: page.offset, onPage: (o) => { state.offset = o; load(); } }));
    } catch (e) {
      clear(body).appendChild(errorBox(describeError(e), load, e.body && e.body.error));
    }
  }

  function openDetail(row) {
    const dl = h('dl', { class: 'kv' });
    for (const c of meta.columns) if (c !== 'deleted_at') dl.append(h('dt', { text: label(c) }), h('dd', {}, render(c, row)));
    modal({ title: (RESOURCE_TITLES[name] || name) + ' · ' + (row[meta.label] || shortId(row.id)), body: dl,
      actions: [h('button', { type: 'button', class: 'btn btn-secondary', text: 'Fermer', onClick: closeModal })] });
  }

  async function openForm(row) {
    const isEdit = !!row;
    const form = h('form', { class: 'field-row', novalidate: true });
    const lookups = {};
    for (const f of meta.fields) {
      if (LOOKUPS[f]) {
        try { lookups[f] = (await api.get('/' + LOOKUPS[f] + '?limit=200')).rows; } catch (e) { lookups[f] = []; }
      }
    }
    for (const f of meta.fields) {
      const cur = row ? row[f] : null;
      let ctrl;
      if (f === 'status' && statuses) {
        ctrl = select(statuses.map((s) => ({ value: s, label: s, selected: cur === s })), { name: f });
      } else if (LOOKUPS[f]) {
        const lk = session.meta().resources[LOOKUPS[f]];
        ctrl = select([{ value: '', label: '—' }].concat(lookups[f].map((r) => ({ value: r.id, label: r[lk.label] || shortId(r.id), selected: cur === r.id }))), { name: f });
      } else if (f === 'notes' || f === 'description' || f === 'address') {
        ctrl = textarea({ name: f, text: cur || '' });
      } else if (DATE_FIELDS.test(f)) {
        ctrl = input({ name: f, type: /_at$/.test(f) ? 'datetime-local' : 'date', value: cur ? String(cur).slice(0, /_at$/.test(f) ? 16 : 10) : '' });
      } else if (NUM_FIELDS.test(f)) {
        ctrl = input({ name: f, type: 'number', step: 'any', value: cur ?? '' });
      } else {
        ctrl = input({ name: f, type: f === 'email' ? 'email' : 'text', value: cur ?? '' });
      }
      if (meta.required.includes(f)) ctrl.required = true;
      form.appendChild(field(label(f) + (meta.required.includes(f) ? ' *' : ''), ctrl, { id: 'f-' + name + '-' + f }));
    }
    const err = h('p', { class: 'error', role: 'alert', hidden: true });
    const submit = h('button', { type: 'submit', class: 'btn btn-primary', text: isEdit ? 'Enregistrer' : 'Créer' });
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      err.hidden = true;
      const values = formValues(form);
      for (const f of meta.required) if (!values[f]) { err.textContent = label(f) + ' est obligatoire.'; err.hidden = false; return; }
      submit.disabled = true;
      try {
        if (isEdit) await api.patch('/' + name + '/' + row.id, values); else await api.post('/' + name, values);
        closeModal(); toast(isEdit ? 'Enregistré.' : 'Créé.', 'ok'); load();
      } catch (e) { err.textContent = describeError(e); err.hidden = false; submit.disabled = false; }
    });
    modal({ title: (isEdit ? 'Modifier — ' : 'Nouveau — ') + (RESOURCE_TITLES[name] || name), wide: true,
      body: h('div', {}, form, err),
      actions: [h('button', { type: 'button', class: 'btn btn-ghost', text: 'Annuler', onClick: closeModal }), submit] });
    submit.addEventListener('click', () => form.requestSubmit());
  }

  /* Prospect → client: one server action, audited on both tables. */
  async function convertProspect(row) {
    const ok = await confirmDialog({ title: 'Convertir « ' + row.name + ' » en client ?', confirmLabel: 'Convertir',
      text: 'Un client est créé à partir du prospect (nom, contact, e-mail, téléphone, ville, notes) ; le prospect passe au statut « won » et reste consultable.' });
    if (!ok) return;
    try { const out = await api.post('/prospects/' + row.id + '/convert', {}); toast('Client créé : ' + (out.client && out.client.name || ''), 'ok'); load(); }
    catch (e) { toast(describeError(e), 'danger'); }
  }

  async function retire(row) {
    const ok = await confirmDialog({ title: 'Retirer cet enregistrement ?', danger: true, confirmLabel: 'Retirer',
      text: 'L\'enregistrement est retiré (marqué supprimé, jamais effacé) et tracé dans le journal d\'audit.' });
    if (!ok) return;
    try { await api.del('/' + name + '/' + row.id); toast('Retiré.', 'ok'); load(); }
    catch (e) { toast(describeError(e), 'danger'); }
  }

  load();
  return { reload: load };
}

function statusesFor(name) {
  const st = session.meta().statuses;
  if (name === 'quotes') return st.quote;
  if (name === 'projects') return st.project;
  if (name === 'contracts') return ['draft', 'signed', 'cancelled'];
  if (name === 'prospects') return st.prospect;
  return null;
}
