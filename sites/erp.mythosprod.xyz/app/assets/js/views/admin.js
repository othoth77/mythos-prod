/* Settings (tenant identity + module toggles), Users (members + role
 * assignment) and Audit (read-only journal with filters). */
import { api, qs, describeError } from '../api.js';
import { session } from '../session.js';
import { h, clear, table, skeletonRows, empty, errorBox, toast, modal, closeModal, field, input, select, formValues, fmtDate, badge, statusBadge, shortId } from '../ui.js';

export function settingsView(container) {
  const body = h('div', { class: 'stack' }); container.appendChild(body);
  load();
  async function load() {
    clear(body).appendChild(skeletonRows(4));
    try {
      const s = await api.get('/settings');
      clear(body);
      const t = s.tenant || {};
      const form = h('form', { class: 'field-row', novalidate: true },
        field('Nom affiché', input({ name: 'display_name', value: t.display_name || '', required: true })),
        field('Raison sociale', input({ name: 'legal_name', value: t.legal_name || '' })),
        field('Identifiant fiscal', input({ name: 'tax_identifier', value: t.tax_identifier || '' })),
        field('Devise', input({ name: 'currency', value: t.currency || 'TND', maxlength: 3 })),
        field('Locale', input({ name: 'locale', value: t.locale || 'fr-TN' })),
        field('Fuseau horaire', input({ name: 'timezone', value: t.timezone || 'Africa/Tunis' })),
        field('Préfixe de facture', input({ name: 'invoice_prefix', value: t.invoice_prefix || '' })),
        field('Modèle de numéro', input({ name: 'invoice_pattern', value: t.invoice_pattern || '{prefix}{year}-{seq:4}' }), { hint: 'Le compteur (' + (t.invoice_next_seq ?? '—') + ') n\'est pas modifiable ici.' }),
        field('Adresse', input({ name: 'address', value: t.address || '' })));
      const err = h('p', { class: 'error', role: 'alert', hidden: true });
      const save = h('button', { type: 'submit', class: 'btn btn-primary', text: 'Enregistrer' });
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault(); err.hidden = true; save.disabled = true;
        try { await api.patch('/settings', formValues(form)); toast('Paramètres enregistrés.', 'ok'); load(); }
        catch (e) { err.textContent = describeError(e); err.hidden = false; save.disabled = false; }
      });
      body.appendChild(h('article', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', { text: 'Identité de l\'entité' })), form, err, h('div', {}, save)));
      const mods = h('div', { class: 'grid cols-3' });
      for (const m of s.modules || []) {
        const cb = h('input', { type: 'checkbox', name: m.module_key, checked: m.enabled || null, id: 'mod-' + m.module_key });
        cb.addEventListener('change', async () => {
          try { await api.post('/settings/modules', { module_key: m.module_key, enabled: cb.checked }); toast('Module ' + m.module_key + (cb.checked ? ' activé' : ' désactivé'), 'ok'); document.dispatchEvent(new CustomEvent('erp:modules-changed')); }
          catch (e) { cb.checked = !cb.checked; toast(describeError(e), 'danger'); }
        });
        mods.appendChild(h('label', { class: 'toggle', for: 'mod-' + m.module_key }, cb, h('span', { text: m.module_key })));
      }
      body.appendChild(h('article', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', { text: 'Modules activés' })), mods));
    } catch (e) { clear(body).appendChild(errorBox(describeError(e), load, e.body && e.body.error)); }
  }
}

export function usersView(container) {
  const body = h('div', { class: 'stack' }); container.appendChild(body);
  const ROLES = ['super_admin', 'admin', 'manager', 'production_user', 'finance_user', 'read_only'];
  load();
  async function load() {
    clear(body).appendChild(skeletonRows(4));
    try {
      const r = await api.get('/users');
      clear(body);
      body.appendChild(h('p', { class: 'toolbar-count', text: (r.rows || []).length + ' membre(s) de ' + ((session.activeTenant() || {}).display_name || 'l\'entité') }));
      if (!(r.rows || []).length) { body.appendChild(empty('Aucun membre')); return; }
      body.appendChild(table([
        { key: 'display_name', label: 'Nom' }, { key: 'email', label: 'E-mail' },
        { key: 'roles', label: 'Rôles', render: (u) => h('span', {}, (u.roles || []).map((k) => badge(k))) },
        { key: 'status', label: 'Adhésion', render: (u) => statusBadge(u.status) },
        { key: 'is_active', label: 'Compte', render: (u) => badge(u.is_active ? 'actif' : 'inactif', u.is_active ? 'ok' : 'danger') },
        { key: 'last_login_at', label: 'Dernière connexion', render: (u) => fmtDate(u.last_login_at) }
      ], r.rows, (u) => [h('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Attribuer un rôle', onClick: () => assign(u) })]));
      body.appendChild(h('p', { class: 'hint', text: 'La création de comptes passe par l\'API authentifiée (users.manage) ; aucun compte n\'est créé depuis cette page.' }));
    } catch (e) { clear(body).appendChild(errorBox(describeError(e), load, e.body && e.body.error)); }
  }
  function assign(u) {
    const sel = select(ROLES.map((k) => ({ value: k, label: k })), { name: 'role_key' });
    const err = h('p', { class: 'error', role: 'alert', hidden: true });
    const ok = h('button', { type: 'button', class: 'btn btn-primary', text: 'Attribuer' });
    ok.addEventListener('click', async () => {
      ok.disabled = true;
      try { await api.post('/users/roles', { user_id: u.id, role_key: sel.value }); closeModal(); toast('Rôle attribué.', 'ok'); load(); }
      catch (e) { err.textContent = describeError(e); err.hidden = false; ok.disabled = false; }
    });
    modal({ title: 'Rôle — ' + u.display_name, body: h('div', {}, field('Rôle', sel), err),
      actions: [h('button', { type: 'button', class: 'btn btn-ghost', text: 'Annuler', onClick: closeModal }), ok] });
  }
}

export function auditView(container) {
  const state = { action: '', entity_table: '', limit: 100 };
  const body = h('div', {});
  const act = input({ type: 'search', placeholder: 'ex. login.success', 'aria-label': 'Action' });
  const ent = input({ type: 'search', placeholder: 'ex. clients', 'aria-label': 'Table' });
  let deb; const onf = () => { clearTimeout(deb); deb = setTimeout(() => { state.action = act.value.trim(); state.entity_table = ent.value.trim(); load(); }, 300); };
  act.addEventListener('input', onf); ent.addEventListener('input', onf);
  container.append(h('div', { class: 'toolbar' }, field('Action', act), field('Table', ent)), body);
  load();
  async function load() {
    clear(body).appendChild(skeletonRows(8));
    try {
      const r = await api.get('/audit' + qs(state));
      clear(body);
      if (!(r.rows || []).length) { body.appendChild(empty('Aucune entrée', 'Le journal est en ajout seul ; rien ne peut y être modifié.')); return; }
      body.appendChild(table([
        { key: 'occurred_at', label: 'Horodatage', render: (x) => fmtDate(x.occurred_at) },
        { key: 'actor_label', label: 'Acteur' },
        { key: 'action', label: 'Action', render: (x) => badge(x.action, x.outcome === 'denied' ? 'danger' : x.action.endsWith('.created') ? 'ok' : '') },
        { key: 'entity_table', label: 'Table' },
        { key: 'entity_id', label: 'Entité', render: (x) => h('span', { class: 'mono', title: x.entity_id || '', text: shortId(x.entity_id) }) },
        { key: 'outcome', label: 'Résultat', render: (x) => badge(x.outcome, x.outcome === 'ok' ? 'ok' : 'danger') },
        { key: 'detail', label: 'Détail', render: (x) => h('code', { class: 'mono', text: JSON.stringify(x.detail || {}).slice(0, 80) }) }
      ], r.rows));
    } catch (e) { clear(body).appendChild(errorBox(describeError(e), load, e.body && e.body.error)); }
  }
}
