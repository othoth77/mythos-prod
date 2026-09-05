/* Comptabilité: écritures (list / detail / new / post / reverse / void),
 * grand livre, balance, TVA, périodes (close), plan comptable and journaux
 * (generic resources). Everything shown comes from the API; totals are the
 * server's. */
import { api, qs, describeError } from '../api.js';
import { session } from '../session.js';
import { h, clear, table, pagination, skeletonRows, empty, errorBox, toast, modal, closeModal, confirmDialog,
  field, input, select, textarea, formValues, fmtDate, fmtNum, badge, tabs } from '../ui.js';
import { resourceView } from './resource.js';

const TABS = [
  { key: 'entries', label: 'Écritures' }, { key: 'ledger', label: 'Grand livre' }, { key: 'trial-balance', label: 'Balance' },
  { key: 'vat', label: 'TVA' }, { key: 'periods', label: 'Périodes' }, { key: 'accounts', label: 'Plan comptable' }, { key: 'journals', label: 'Journaux' }
];
const STATUS_TONE = { draft: '', posted: 'ok', reversed: 'warn', void: 'danger', open: 'ok', closed: '' };
const st = (s) => badge(s, STATUS_TONE[s]);

export function accountingView(container, route) {
  const active = TABS.some((t) => t.key === route.resource) ? route.resource : 'entries';
  container.appendChild(tabs(TABS, active, (k) => { window.location.hash = '#/accounting/' + k; }));
  const panel = h('div', { id: 'panel-' + active, role: 'tabpanel', 'aria-labelledby': 'tab-' + active });
  container.appendChild(panel);
  if (active === 'entries') return route.id ? entryDetail(panel, route.id) : entriesList(panel);
  if (active === 'ledger') return ledgerView(panel);
  if (active === 'trial-balance') return trialBalanceView(panel);
  if (active === 'vat') return vatView(panel);
  if (active === 'periods') return periodsView(panel);
  if (active === 'accounts') return resourceView('accounts', panel);
  if (active === 'journals') return resourceView('journals', panel);
}

async function loadRefs() {
  const [acc, jr] = await Promise.all([api.get('/accounts?limit=200&sort=code&dir=asc'), api.get('/journals?limit=50&sort=code&dir=asc')]);
  return { accounts: acc.rows.filter((a) => a.is_active !== false), journals: jr.rows.filter((j) => j.is_active !== false) };
}

/* ── Entries ──────────────────────────────────────────────────────────── */
function entriesList(root) {
  const state = { status: '', search: '', offset: 0, limit: 25 };
  const search = input({ type: 'search', placeholder: 'Référence, libellé…', 'aria-label': 'Rechercher' });
  let deb; search.addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(() => { state.search = search.value; state.offset = 0; load(); }, 250); });
  const sel = select([{ value: '', label: 'Tous les statuts' }, ...['draft', 'posted', 'reversed', 'void'].map((s) => ({ value: s, label: s }))], { 'aria-label': 'Statut' });
  sel.addEventListener('change', () => { state.status = sel.value; state.offset = 0; load(); });
  const count = h('span', { class: 'toolbar-count' });
  root.appendChild(h('div', { class: 'toolbar' }, field('Rechercher', search), field('Statut', sel),
    h('div', { class: 'actions' }, count, h('button', { type: 'button', class: 'btn btn-primary btn-sm', text: 'Nouvelle écriture', onClick: () => entryForm(null, load) }))));
  const body = h('div', {}); root.appendChild(body);
  async function load() {
    clear(body).appendChild(skeletonRows(6));
    try {
      const page = await api.get('/accounting/entries' + qs({ status: state.status, search: state.search, limit: state.limit, offset: state.offset }));
      clear(body);
      count.textContent = page.total + ' écriture' + (page.total > 1 ? 's' : '');
      if (!page.rows.length) { body.appendChild(empty('Aucune écriture', 'Les écritures automatiques apparaissent à l\'émission des factures et aux règlements.')); return; }
      body.appendChild(table([
        { key: 'entry_no', label: 'N°', num: true, render: (r) => h('a', { href: '#/accounting/entries/' + r.id, class: 'mono', text: String(r.entry_no) }) },
        { key: 'entry_date', label: 'Date', render: (r) => fmtDate(r.entry_date) },
        { key: 'journal_code', label: 'Journal' }, { key: 'period_code', label: 'Période' },
        { key: 'reference', label: 'Référence' }, { key: 'memo', label: 'Libellé' },
        { key: 'total', label: 'Montant', num: true, render: (r) => fmtNum(r.total) },
        { key: 'status', label: 'Statut', render: (r) => st(r.status) },
        { key: 'source_table', label: 'Origine', render: (r) => r.source_table ? badge(r.source_table, 'info') : '—' }
      ], page.rows, (r) => [h('a', { class: 'btn btn-ghost btn-sm', href: '#/accounting/entries/' + r.id, text: 'Ouvrir' })]));
      body.appendChild(pagination({ total: page.total, limit: page.limit, offset: page.offset, onPage: (o) => { state.offset = o; load(); } }));
    } catch (e) { clear(body).appendChild(errorBox(describeError(e), load, e.body && e.body.error)); }
  }
  load();
}

async function entryDetail(root, id) {
  root.appendChild(skeletonRows(4));
  let en;
  try { en = await api.get('/accounting/entries/' + id); }
  catch (e) { clear(root).appendChild(errorBox(describeError(e), () => entryDetail(clear(root), id), e.body && e.body.error)); return; }
  clear(root);
  const reload = () => entryDetail(clear(root), id);
  root.appendChild(h('div', { class: 'toolbar' },
    h('a', { class: 'btn btn-ghost btn-sm', href: '#/accounting/entries', text: '← Écritures' }),
    h('h3', { class: 'mono', text: 'Écriture n° ' + en.entry_no }), st(en.status),
    h('div', { class: 'actions' },
      en.status === 'draft' ? h('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Modifier', onClick: () => entryForm(en, reload) }) : null,
      en.status === 'draft' ? h('button', { type: 'button', class: 'btn btn-primary btn-sm', text: 'Comptabiliser', onClick: () => act('post') }) : null,
      en.status === 'draft' ? h('button', { type: 'button', class: 'btn btn-danger btn-sm', text: 'Annuler le brouillon', onClick: () => act('void') }) : null,
      en.status === 'posted' ? h('button', { type: 'button', class: 'btn btn-danger btn-sm', text: 'Extourner', onClick: () => act('reverse') }) : null)));
  const dl = h('dl', { class: 'kv' });
  [['Date', fmtDate(en.entry_date)], ['Journal', en.journal_code], ['Période', en.period_code], ['Référence', en.reference || '—'], ['Libellé', en.memo || '—'],
    ['Comptabilisée le', en.posted_at ? fmtDate(en.posted_at) : '—'], ['Origine', en.source_table ? en.source_table + ' ' + (en.source_id || '').slice(0, 8) : 'manuelle'],
    ['Extourne', en.reverses_id ? 'extourne de ' + en.reverses_id.slice(0, 8) : (en.reversed_by_id ? 'extournée par ' + en.reversed_by_id.slice(0, 8) : '—')]]
    .forEach(([k, v]) => dl.append(h('dt', { text: k }), h('dd', { text: v })));
  root.appendChild(h('article', { class: 'card' }, dl));
  root.appendChild(h('div', { class: 'section' }, h('h3', { text: 'Lignes' }), table([
    { key: 'account_code', label: 'Compte', render: (l) => h('span', { class: 'mono', text: l.account_code + ' ' + l.account_label }) },
    { key: 'label', label: 'Libellé' },
    { key: 'debit', label: 'Débit', num: true, render: (l) => Number(l.debit) ? fmtNum(l.debit) : '' },
    { key: 'credit', label: 'Crédit', num: true, render: (l) => Number(l.credit) ? fmtNum(l.credit) : '' },
    { key: 'vat_rate', label: 'TVA %', num: true, render: (l) => l.vat_rate === null ? '' : fmtNum(l.vat_rate, 2) }
  ], en.lines), h('p', { class: 'mono' }, 'Total débit ', fmtNum(en.totals.debit), ' — crédit ', fmtNum(en.totals.credit), ' — ', en.totals.balanced ? badge('équilibrée', 'ok') : badge('déséquilibrée', 'danger'))));
  async function act(kind) {
    const texts = { post: ['Comptabiliser l\'écriture ?', 'Une écriture comptabilisée devient immuable ; seule une extourne peut la corriger.', 'Comptabiliser', false],
      void: ['Annuler ce brouillon ?', 'Le brouillon est marqué annulé et conserve son numéro.', 'Annuler le brouillon', true],
      reverse: ['Extourner l\'écriture ?', 'Une écriture miroir (débit ⇄ crédit) est créée et comptabilisée ; l\'original passe au statut extourné.', 'Extourner', true] };
    const [title, text, confirmLabel, danger] = texts[kind];
    if (!(await confirmDialog({ title, text, confirmLabel, danger }))) return;
    try { await api.post('/accounting/entries/' + id + '/' + kind, {}); toast('Fait.', 'ok'); reload(); }
    catch (e) { toast(describeError(e), 'danger'); }
  }
}

function lineRow(refs, l = {}) {
  return h('tr', {},
    h('td', {}, select(refs.accounts.map((a) => ({ value: a.id, label: a.code + ' — ' + a.label, selected: l.account_id === a.id })), { name: 'account_id' })),
    h('td', {}, input({ name: 'label', value: l.label || '' })),
    h('td', {}, input({ name: 'debit', type: 'number', step: '0.001', min: '0', value: l.debit ?? '' })),
    h('td', {}, input({ name: 'credit', type: 'number', step: '0.001', min: '0', value: l.credit ?? '' })),
    h('td', {}, input({ name: 'vat_rate', type: 'number', step: '0.01', min: '0', value: l.vat_rate ?? '' })),
    h('td', {}, h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: '✕', 'aria-label': 'Supprimer la ligne', onClick: (e) => e.target.closest('tr').remove() })));
}

async function entryForm(en, done) {
  let refs;
  try { refs = await loadRefs(); } catch (e) { toast(describeError(e), 'danger'); return; }
  if (!refs.journals.length || !refs.accounts.length) { toast('Plan comptable ou journaux absents : lancez la configuration (Paramètres).', 'warn'); return; }
  const header = h('div', { class: 'field-row' },
    field('Journal', select(refs.journals.map((j) => ({ value: j.id, label: j.code + ' — ' + j.label, selected: en && en.journal_id === j.id })), { name: 'journal_id' })),
    field('Date', input({ name: 'entry_date', type: 'date', value: en ? String(en.entry_date).slice(0, 10) : new Date().toISOString().slice(0, 10), required: true })),
    field('Référence', input({ name: 'reference', value: (en && en.reference) || '' })),
    field('Libellé', input({ name: 'memo', value: (en && en.memo) || '' })));
  const tbody = h('tbody', {}, ((en && en.lines && en.lines.length) ? en.lines : [{}, {}]).map((l) => lineRow(refs, l)));
  const totals = h('p', { class: 'mono', text: '' });
  const recompute = () => {
    let d = 0, c = 0; tbody.querySelectorAll('tr').forEach((tr) => { d += Number(tr.querySelector('[name=debit]').value) || 0; c += Number(tr.querySelector('[name=credit]').value) || 0; });
    totals.textContent = 'Débit ' + fmtNum(d) + ' — Crédit ' + fmtNum(c) + (Math.abs(d - c) < 0.0005 ? ' — équilibrée' : ' — écart ' + fmtNum(d - c));
  };
  tbody.addEventListener('input', recompute); recompute();
  const err = h('p', { class: 'error', role: 'alert', hidden: true });
  const submit = h('button', { type: 'button', class: 'btn btn-primary', text: en ? 'Enregistrer' : 'Créer le brouillon' });
  submit.addEventListener('click', async () => {
    err.hidden = true;
    const hv = formValues(header);
    const lines = [...tbody.querySelectorAll('tr')].map((tr) => { const v = {}; tr.querySelectorAll('[name]').forEach((el) => { v[el.name] = el.value; }); return { account_id: v.account_id, label: v.label || null, debit: Number(v.debit) || 0, credit: Number(v.credit) || 0, vat_rate: v.vat_rate === '' ? null : Number(v.vat_rate) }; });
    submit.disabled = true;
    try {
      const body = Object.assign({}, hv, { lines });
      const out = en ? await api.patch('/accounting/entries/' + en.id, body) : await api.post('/accounting/entries', body);
      closeModal(); toast(en ? 'Écriture enregistrée.' : 'Brouillon n° ' + out.entry_no + ' créé.', 'ok');
      if (!en) window.location.hash = '#/accounting/entries/' + out.id; else done();
    } catch (e) { err.textContent = describeError(e); err.hidden = false; submit.disabled = false; }
  });
  modal({ title: en ? 'Modifier l\'écriture n° ' + en.entry_no : 'Nouvelle écriture', wide: true,
    body: h('div', { class: 'stack' }, header, h('div', { class: 'table-wrap' }, h('table', { class: 'data lines' },
      h('thead', {}, h('tr', {}, ['Compte', 'Libellé', 'Débit', 'Crédit', 'TVA %', ''].map((t) => h('th', { scope: 'col', text: t })))), tbody)),
      h('div', { class: 'toolbar' }, h('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: '+ Ligne', onClick: () => { tbody.appendChild(lineRow(refs)); recompute(); } }), totals), err),
    actions: [h('button', { type: 'button', class: 'btn btn-ghost', text: 'Annuler', onClick: closeModal }), submit] });
}

/* ── Reports ──────────────────────────────────────────────────────────── */
function periodFilter(onChange) {
  const inp = input({ type: 'month', 'aria-label': 'Période' });
  inp.addEventListener('change', () => onChange(inp.value));
  return field('Période (mois)', inp, { hint: 'Vide = toutes les écritures comptabilisées.' });
}

function trialBalanceView(root) {
  const state = { period: '' };
  const body = h('div', {});
  root.append(h('div', { class: 'toolbar' }, periodFilter((v) => { state.period = v; load(); })), body);
  load();
  async function load() {
    clear(body).appendChild(skeletonRows(8));
    try {
      const r = await api.get('/accounting/trial-balance' + qs({ period: state.period }));
      clear(body);
      body.appendChild(h('p', { class: 'mono' }, 'Total débit ', fmtNum(r.totals.debit), ' — crédit ', fmtNum(r.totals.credit), ' — ', r.totals.balanced ? badge('équilibrée', 'ok') : badge('déséquilibrée', 'danger')));
      body.appendChild(table([
        { key: 'code', label: 'Compte', render: (x) => h('a', { class: 'mono', href: '#/accounting/ledger', dataset: { account: x.account_id }, text: x.code }) },
        { key: 'label', label: 'Intitulé' }, { key: 'type', label: 'Type' },
        { key: 'debit', label: 'Débit', num: true, render: (x) => fmtNum(x.debit) }, { key: 'credit', label: 'Crédit', num: true, render: (x) => fmtNum(x.credit) },
        { key: 'balance', label: 'Solde', num: true, render: (x) => fmtNum(x.balance) }
      ], r.rows));
    } catch (e) { clear(body).appendChild(errorBox(describeError(e), load, e.body && e.body.error)); }
  }
}

async function ledgerView(root) {
  let refs;
  try { refs = await loadRefs(); } catch (e) { root.appendChild(errorBox(describeError(e))); return; }
  const sel = select([{ value: '', label: '— choisir un compte —' }].concat(refs.accounts.map((a) => ({ value: a.id, label: a.code + ' — ' + a.label }))), { 'aria-label': 'Compte' });
  const from = input({ type: 'date', 'aria-label': 'Du' }), to = input({ type: 'date', 'aria-label': 'Au' });
  const body = h('div', {});
  [sel, from, to].forEach((el) => el.addEventListener('change', load));
  root.append(h('div', { class: 'toolbar' }, field('Compte', sel), field('Du', from), field('Au', to)), body);
  body.appendChild(empty('Choisissez un compte', 'Le grand livre affiche les lignes comptabilisées avec le solde progressif.'));
  async function load() {
    if (!sel.value) return;
    clear(body).appendChild(skeletonRows(6));
    try {
      const r = await api.get('/accounting/ledger' + qs({ account_id: sel.value, from: from.value, to: to.value }));
      clear(body);
      body.appendChild(h('p', { class: 'mono' }, r.account.code + ' ' + r.account.label + ' — solde d\'ouverture ' + fmtNum(r.opening_balance) + ' — solde de clôture ' + fmtNum(r.closing_balance)));
      if (!r.rows.length) { body.appendChild(empty('Aucun mouvement', 'Aucune ligne comptabilisée sur ce compte pour ce filtre.')); return; }
      body.appendChild(table([
        { key: 'entry_date', label: 'Date', render: (x) => fmtDate(x.entry_date) },
        { key: 'entry_no', label: 'N°', num: true, render: (x) => h('a', { class: 'mono', href: '#/accounting/entries/' + x.entry_id, text: String(x.entry_no) }) },
        { key: 'journal_code', label: 'Journal' }, { key: 'reference', label: 'Référence' }, { key: 'label', label: 'Libellé', render: (x) => x.label || x.memo || '—' },
        { key: 'debit', label: 'Débit', num: true, render: (x) => Number(x.debit) ? fmtNum(x.debit) : '' },
        { key: 'credit', label: 'Crédit', num: true, render: (x) => Number(x.credit) ? fmtNum(x.credit) : '' },
        { key: 'running_balance', label: 'Solde', num: true, render: (x) => fmtNum(x.running_balance) }
      ], r.rows));
    } catch (e) { clear(body).appendChild(errorBox(describeError(e), load, e.body && e.body.error)); }
  }
}

function vatView(root) {
  const state = { period: '' };
  const body = h('div', {});
  root.append(h('div', { class: 'toolbar' }, periodFilter((v) => { state.period = v; load(); })), body);
  load();
  async function load() {
    clear(body).appendChild(skeletonRows(4));
    try {
      const r = await api.get('/accounting/vat' + qs({ period: state.period }));
      clear(body);
      body.appendChild(h('div', { class: 'grid cols-3' },
        h('article', { class: 'card stat' }, h('span', { class: 'stat-label', text: 'TVA collectée' }), h('span', { class: 'stat-value', text: fmtNum(r.collected) })),
        h('article', { class: 'card stat' }, h('span', { class: 'stat-label', text: 'TVA déductible' }), h('span', { class: 'stat-value', text: fmtNum(r.deductible) })),
        h('article', { class: 'card stat' }, h('span', { class: 'stat-label', text: 'TVA nette due' }), h('span', { class: 'stat-value', text: fmtNum(r.net_due) }))));
      if (!r.by_rate.length) { body.appendChild(h('div', { class: 'section' }, empty('Aucune TVA comptabilisée'))); return; }
      body.appendChild(h('div', { class: 'section' }, table([
        { key: 'kind', label: 'Nature', render: (x) => x.kind === 'vat_collected' ? 'collectée' : 'déductible' },
        { key: 'vat_rate', label: 'Taux %', num: true, render: (x) => fmtNum(x.vat_rate, 2) },
        { key: 'amount', label: 'Montant', num: true, render: (x) => fmtNum(x.amount) }
      ], r.by_rate)));
    } catch (e) { clear(body).appendChild(errorBox(describeError(e), load, e.body && e.body.error)); }
  }
}

function periodsView(root) {
  const body = h('div', {}); root.appendChild(body); load();
  async function load() {
    clear(body).appendChild(skeletonRows(4));
    try {
      const r = await api.get('/accounting/periods');
      clear(body);
      if (!r.rows.length) { body.appendChild(empty('Aucune période', 'Les périodes mensuelles sont créées automatiquement à la première écriture.')); return; }
      body.appendChild(table([
        { key: 'code', label: 'Période', render: (p) => h('span', { class: 'mono', text: p.code }) },
        { key: 'starts_on', label: 'Du', render: (p) => fmtDate(p.starts_on) }, { key: 'ends_on', label: 'Au', render: (p) => fmtDate(p.ends_on) },
        { key: 'posted', label: 'Comptabilisées', num: true }, { key: 'drafts', label: 'Brouillons', num: true },
        { key: 'status', label: 'Statut', render: (p) => st(p.status) }, { key: 'closed_at', label: 'Clôturée le', render: (p) => fmtDate(p.closed_at) }
      ], r.rows, (p) => [p.status === 'open' ? h('button', { type: 'button', class: 'btn btn-danger btn-sm', text: 'Clôturer', onClick: () => close(p) }) : null]));
    } catch (e) { clear(body).appendChild(errorBox(describeError(e), load, e.body && e.body.error)); }
  }
  async function close(p) {
    if (!(await confirmDialog({ title: 'Clôturer la période ' + p.code + ' ?', danger: true, confirmLabel: 'Clôturer', text: 'Plus aucune écriture ne pourra y être comptabilisée. Les brouillons doivent être comptabilisés ou annulés avant.' }))) return;
    try { await api.post('/accounting/periods/' + p.id + '/close', {}); toast('Période clôturée.', 'ok'); load(); } catch (e) { toast(describeError(e), 'danger'); }
  }
}
