/* Ordres de mission (Phase 4) — vehicle/driver dispatch sheets.
 *
 * No client/project/amount/approval link: legacy evidence proves none of
 * those exist for this document, so none are invented here. Module
 * 'production' — the same permission gate collaborators/representations
 * already share (production.read/production.write); there is no delete
 * permission in that module at all (see api/modules/mission-orders.js), so
 * this view has no retire action, matching what the API actually exposes.
 */
import { api, qs, describeError } from '../api.js';
import { session } from '../session.js';
import { h, clear, table, pagination, skeletonRows, empty, errorBox, toast, modal, closeModal,
  field, input, select, textarea, formValues, fmtDate, fmtNum } from '../ui.js';

const MISSION_TYPE_LABEL = { aller_retour: 'Aller-retour', aller_simple: 'Aller simple' };

export function missionOrdersView(root, route) {
  return route.id ? orderDetail(root, route.id) : ordersList(root);
}

async function loadDrivers() {
  const r = await api.get('/collaborators?limit=200');
  return r.rows;
}

function fmtDateTime(v) {
  if (!v) return '—';
  const d = new Date(v);
  return isNaN(d) ? '—' : d.toLocaleString('fr-TN', { dateStyle: 'medium', timeStyle: 'short' });
}

function ordersList(root) {
  const state = { driver_id: '', search: '', offset: 0, limit: 25 };
  const toolbar = h('div', {});
  const body = h('div', {});
  root.appendChild(toolbar); root.appendChild(body);
  let drivers = [];

  async function load() {
    clear(body).appendChild(skeletonRows(6));
    try {
      const page = await api.get('/mission_orders' + qs({ driver_id: state.driver_id, search: state.search, limit: state.limit, offset: state.offset }));
      clear(body);
      const count = toolbar.querySelector('.toolbar-count');
      if (count) count.textContent = page.total + ' ordre' + (page.total > 1 ? 's' : '');
      if (!page.rows.length) { body.appendChild(empty('Aucun ordre de mission', 'Créez un ordre de mission pour un déplacement de véhicule.')); return; }
      body.appendChild(table([
        { key: 'starts_at', label: 'Date', render: (r) => fmtDateTime(r.starts_at) },
        { key: 'driver_name', label: 'Chauffeur' },
        { key: 'vehicle_plate', label: 'Véhicule' },
        { key: 'trajet', label: 'Trajet', render: (r) => r.departure_location + ' → ' + r.arrival_location },
        { key: 'mission_type', label: 'Type', render: (r) => MISSION_TYPE_LABEL[r.mission_type] || r.mission_type }
      ], page.rows, (r) => [
        h('a', { class: 'btn btn-ghost btn-sm', href: '#/production/mission_orders/' + r.id, text: 'Détail' })
      ]));
      body.appendChild(pagination({ total: page.total, limit: page.limit, offset: page.offset, onPage: (o) => { state.offset = o; load(); } }));
    } catch (e) { clear(body).appendChild(errorBox(describeError(e), load, e.body && e.body.error)); }
  }

  async function init() {
    try { drivers = await loadDrivers(); } catch (e) { drivers = []; }
    const driverSel = select([{ value: '', label: 'Tous les chauffeurs' }, ...drivers.map((d) => ({ value: d.id, label: d.full_name }))], { 'aria-label': 'Chauffeur' });
    driverSel.addEventListener('change', () => { state.driver_id = driverSel.value; state.offset = 0; load(); });
    const search = input({ type: 'search', placeholder: 'Chauffeur, véhicule, trajet…', 'aria-label': 'Rechercher' });
    let deb; search.addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(() => { state.search = search.value; state.offset = 0; load(); }, 250); });
    const count = h('span', { class: 'toolbar-count' });
    clear(toolbar).appendChild(h('div', { class: 'toolbar' }, field('Chauffeur', driverSel), field('Rechercher', search),
      h('div', { class: 'actions' }, count,
        h('button', { type: 'button', class: 'btn btn-primary btn-sm', text: '+ Ordre de mission', onClick: () => orderForm(null, drivers, load) }))));
    load();
  }
  init();
}

async function orderDetail(root, id) {
  root.appendChild(skeletonRows(4));
  let mo;
  try { mo = await api.get('/mission_orders/' + id); }
  catch (e) { clear(root).appendChild(errorBox(describeError(e), () => orderDetail(clear(root), id), e.body && e.body.error)); return; }
  clear(root);
  const reload = () => orderDetail(clear(root), id);
  root.appendChild(h('div', { class: 'toolbar' },
    h('a', { class: 'btn btn-ghost btn-sm', href: '#/production/mission_orders', text: '← Ordres de mission' }),
    h('h3', { text: 'Ordre de mission — ' + mo.vehicle_plate }),
    h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Modifier', onClick: () => orderFormEdit(mo, reload) }),
      h('button', { type: 'button', class: 'btn btn-primary btn-sm', text: 'Imprimer', onClick: () => printOrder(mo) }))));
  const dl = h('dl', { class: 'kv' });
  [['Chauffeur', mo.driver_name], ['CIN', mo.driver_cin || '—'], ['Permis', mo.driver_license || '—'],
   ['Véhicule', mo.vehicle_plate], ['Type', MISSION_TYPE_LABEL[mo.mission_type] || mo.mission_type],
   ['Départ', mo.departure_location + ' — ' + fmtDateTime(mo.starts_at)],
   ['Arrivée', mo.arrival_location + (mo.ends_at ? ' — ' + fmtDateTime(mo.ends_at) : '')],
   ['Mission', mo.mission], ['Notes', mo.notes || '—']]
   .forEach(([k, v]) => dl.append(h('dt', { text: k }), h('dd', { text: v })));
  root.appendChild(h('article', { class: 'card' }, dl));
  if ((mo.passengers || []).length) {
    root.appendChild(h('div', { class: 'section' }, h('h3', { text: 'Passagers' }),
      table([{ key: 'name', label: 'Nom' }], mo.passengers, () => [])));
  }
}

async function orderFormEdit(mo, done) {
  let drivers;
  try { drivers = await loadDrivers(); } catch (e) { drivers = []; }
  orderForm(mo, drivers, done);
}

function passengerRow(p = {}) {
  return h('tr', {},
    h('td', {}, input({ name: 'passenger', value: p.name || '' })),
    h('td', {}, h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: '✕', 'aria-label': 'Retirer', onClick: (e) => e.target.closest('tr').remove() })));
}

function toLocalInputValue(v) {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d)) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function orderForm(mo, drivers, done) {
  const header = h('div', { class: 'field-row' },
    field('Chauffeur (fiche existante)', select([{ value: '', label: '—' }, ...drivers.map((d) => ({ value: d.id, label: d.full_name, selected: mo && mo.driver_id === d.id }))], { name: 'driver_id' })),
    field('Nom du chauffeur', input({ name: 'driver_name', value: (mo && mo.driver_name) || '', required: true })),
    field('CIN', input({ name: 'driver_cin', value: (mo && mo.driver_cin) || '' })),
    field('Permis de conduire', input({ name: 'driver_license', value: (mo && mo.driver_license) || '' })),
    field('Véhicule (immatriculation)', input({ name: 'vehicle_plate', value: (mo && mo.vehicle_plate) || '', required: true })),
    field('Type de mission', select([{ value: 'aller_retour', label: 'Aller-retour', selected: !mo || mo.mission_type === 'aller_retour' }, { value: 'aller_simple', label: 'Aller simple', selected: mo && mo.mission_type === 'aller_simple' }], { name: 'mission_type' })),
    field('Départ (lieu)', input({ name: 'departure_location', value: (mo && mo.departure_location) || '', required: true })),
    field('Arrivée (lieu)', input({ name: 'arrival_location', value: (mo && mo.arrival_location) || '', required: true })),
    field('Départ (date/heure)', input({ name: 'starts_at', type: 'datetime-local', value: mo ? toLocalInputValue(mo.starts_at) : '', required: true })),
    field('Retour (date/heure)', input({ name: 'ends_at', type: 'datetime-local', value: mo ? toLocalInputValue(mo.ends_at) : '' })));
  const missionField = field('Mission', textarea({ name: 'mission', rows: 3, text: (mo && mo.mission) || '' }));
  const notesField = field('Notes', textarea({ name: 'notes', rows: 2, text: (mo && mo.notes) || '' }));
  const stampField = field('', h('label', {}, input({ name: 'add_stamp', type: 'checkbox', checked: mo ? !!mo.add_stamp : false }), ' Ajouter le cachet de l\'entité'));
  const tbody = h('tbody', {}, ((mo && mo.passengers && mo.passengers.length) ? mo.passengers : []).map((p) => passengerRow(p)));
  const err = h('p', { class: 'error', role: 'alert', hidden: true });
  const submit = h('button', { type: 'button', class: 'btn btn-primary', text: mo ? 'Enregistrer' : 'Créer' });
  submit.addEventListener('click', async () => {
    err.hidden = true; submit.disabled = true;
    const hv = formValues(header);
    const passengers = [...tbody.querySelectorAll('tr')].map((tr) => ({ name: tr.querySelector('[name=passenger]').value })).filter((p) => p.name.trim());
    const body = Object.assign({}, hv, {
      driver_id: hv.driver_id || null,
      mission: missionField.querySelector('[name=mission]').value,
      notes: notesField.querySelector('[name=notes]').value || null,
      add_stamp: stampField.querySelector('[name=add_stamp]').checked,
      starts_at: hv.starts_at ? new Date(hv.starts_at).toISOString() : null,
      ends_at: hv.ends_at ? new Date(hv.ends_at).toISOString() : null,
      passengers
    });
    try {
      const out = mo ? await api.patch('/mission_orders/' + mo.id, body) : await api.post('/mission_orders', body);
      closeModal(); toast(mo ? 'Ordre de mission enregistré.' : 'Ordre de mission créé.', 'ok');
      if (!mo) window.location.hash = '#/production/mission_orders/' + out.id; else done();
    } catch (e) { err.textContent = describeError(e); err.hidden = false; submit.disabled = false; }
  });
  modal({ title: mo ? 'Modifier l\'ordre de mission' : 'Nouvel ordre de mission', wide: true,
    body: h('div', { class: 'stack' }, header, missionField, notesField, stampField,
      h('div', { class: 'section' }, h('h3', { text: 'Passagers' }),
        h('div', { class: 'table-wrap' }, h('table', { class: 'data lines' },
          h('thead', {}, h('tr', {}, ['Nom', ''].map((t) => h('th', { scope: 'col', text: t })))), tbody)),
        h('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: '+ Passager', onClick: () => tbody.appendChild(passengerRow()) })),
      err),
    actions: [h('button', { type: 'button', class: 'btn btn-ghost', text: 'Annuler', onClick: closeModal }), submit] });
}

/* Printing mirrors the legacy approach — a browser print of a generated
   document — rather than introducing a server-side PDF engine the current
   ERP has never needed for anything else (documents.js only stores/serves
   uploaded blobs). Tenant identity comes from the already-loaded session,
   not a settings.read call, so printing works for any role that can see
   the order at all. */
function printOrder(mo) {
  const tenant = session.activeTenant();
  const win = window.open('', '_blank');
  if (!win) { toast('Autorisez les fenêtres pop-up pour imprimer.', 'warn'); return; }
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const passengersRows = (mo.passengers || []).map((p) => '<tr><td>' + esc(p.name) + '</td><td class="sig"></td></tr>').join('');
  win.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Ordre de mission — ' + esc(mo.vehicle_plate) + '</title>' +
    '<style>body{font-family:sans-serif;padding:2rem;color:#111}h1{font-size:1.3rem}table{width:100%;border-collapse:collapse;margin-top:1rem}' +
    'td,th{border:1px solid #ccc;padding:.4rem .6rem;text-align:left}.sig{width:40%}dl{display:grid;grid-template-columns:auto 1fr;gap:.25rem 1rem}' +
    'dt{font-weight:600}' + (mo.add_stamp ? '.stamp{position:fixed;bottom:2rem;right:2rem;border:2px solid #333;border-radius:50%;width:110px;height:110px;display:flex;align-items:center;justify-content:center;text-align:center;font-size:.7rem;opacity:.7}' : '') +
    '</style></head><body>' +
    '<h1>' + esc(tenant ? tenant.display_name : 'Ordre de mission') + '</h1>' +
    '<h2>Ordre de mission</h2>' +
    '<dl>' +
    '<dt>Chauffeur</dt><dd>' + esc(mo.driver_name) + '</dd>' +
    '<dt>CIN</dt><dd>' + esc(mo.driver_cin || '—') + '</dd>' +
    '<dt>Permis</dt><dd>' + esc(mo.driver_license || '—') + '</dd>' +
    '<dt>Véhicule</dt><dd>' + esc(mo.vehicle_plate) + '</dd>' +
    '<dt>Type</dt><dd>' + esc(MISSION_TYPE_LABEL[mo.mission_type] || mo.mission_type) + '</dd>' +
    '<dt>Départ</dt><dd>' + esc(mo.departure_location) + ' — ' + esc(fmtDateTime(mo.starts_at)) + '</dd>' +
    '<dt>Arrivée</dt><dd>' + esc(mo.arrival_location) + (mo.ends_at ? ' — ' + esc(fmtDateTime(mo.ends_at)) : '') + '</dd>' +
    '<dt>Mission</dt><dd>' + esc(mo.mission) + '</dd>' +
    '</dl>' +
    (passengersRows ? '<h2>Passagers</h2><table><thead><tr><th>Nom</th><th>Signature</th></tr></thead><tbody>' + passengersRows + '</tbody></table>' : '') +
    (mo.add_stamp ? '<div class="stamp">Cachet</div>' : '') +
    '</body></html>');
  win.document.close();
  win.focus();
  win.print();
}
