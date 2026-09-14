/* Contacts (Phase 11): the legacy "Répertoire" — Liste (generic registry
 * view), Importer (vCard / CSV → server-side preview → import batch),
 * Doublons (same phone or e-mail → merge into the first), Imports (batch
 * history: label, counts, retire a whole batch). The browser only READS the
 * file and sends its text; parsing, classification and every write happen
 * in the API, audited. */
import { api, describeError } from '../api.js';
import { h, clear, tabs, table, skeletonRows, empty, errorBox, toast, badge, field, input, fmtDate, confirmDialog, modal, closeModal } from '../ui.js';
import { resourceView } from './resource.js';

const TABS = [{ key: 'list', label: 'Liste' }, { key: 'import', label: 'Importer' }, { key: 'duplicates', label: 'Doublons' }, { key: 'imports', label: 'Imports' }];
const STATUS = { new: ['nouveau', 'ok'], duplicate_existing: ['déjà présent', 'warn'], duplicate_in_file: ['doublon dans le fichier', 'warn'], invalid: ['invalide', 'danger'] };
const WARN = { email_invalid: 'email invalide (ignoré)', name_missing: 'sans nom (téléphone/email utilisé)', no_identity: 'ni nom, ni téléphone, ni email' };
const SOURCE = { vcard: 'vCard', csv: 'CSV' };
const MATCHED = { phone: 'téléphone', email: 'email', 'email+phone': 'téléphone + email' };
const MAX_FILE_BYTES = 4 * 1024 * 1024;   // mirrors the API's 4 MiB text limit

export function contactsView(container, which) {
  const active = TABS.some((t) => t.key === which) ? which : 'list';
  container.appendChild(tabs(TABS, active, (k) => { window.location.hash = '#/clients/contacts/' + k; }));
  const panel = h('div', { id: 'panel-' + active, role: 'tabpanel', 'aria-labelledby': 'tab-' + active });
  container.appendChild(panel);
  if (active === 'import') return importView(panel);
  if (active === 'duplicates') return duplicatesView(panel);
  if (active === 'imports') return importsView(panel);
  return resourceView('contacts', panel);
}

function importView(root) {
  const state = { text: '', source: 'vcard', file_name: '', preview: null };
  const fileIn = input({ type: 'file', accept: '.vcf,.vcard,.csv,.txt,text/vcard,text/csv,text/plain', 'aria-label': 'Fichier', id: 'contacts-import-file' });
  const label = input({ name: 'label', placeholder: 'Ex. Export téléphone — septembre', maxlength: 120 });
  const skip = h('input', { type: 'checkbox', id: 'imp-skip', checked: true });
  const previewBtn = h('button', { type: 'button', class: 'btn btn-secondary', text: 'Analyser le fichier', disabled: true });
  const importBtn = h('button', { type: 'button', class: 'btn btn-primary', text: 'Importer', disabled: true, hidden: true });
  const out = h('div', { class: 'section' });
  root.append(h('article', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', { text: 'Importer des contacts' })),
    h('p', { text: 'Fichier vCard (.vcf — export « Contacts » du téléphone) ou CSV (export du répertoire, Google Contacts, tableur : colonnes Nom, Prénom, Téléphone 1/2, Email, Ville, Métier, Domaine, Note). Le fichier est analysé avant tout enregistrement : les doublons (même téléphone ou même email qu\'un contact existant, ou qu\'une ligne précédente) sont signalés et, par défaut, ignorés.' }),
    h('div', { class: 'field-row' }, field('Fichier', fileIn), field('Libellé de l\'import', label),
      h('div', { class: 'field' }, h('label', { class: 'toggle', for: 'imp-skip' }, skip, h('span', { text: 'Ignorer les doublons' })))),
    h('div', { class: 'actions' }, previewBtn, importBtn)), out);

  fileIn.addEventListener('change', () => {
    const f = fileIn.files && fileIn.files[0];
    state.preview = null; importBtn.hidden = true; clear(out);
    if (!f) { previewBtn.disabled = true; return; }
    if (f.size > MAX_FILE_BYTES) { previewBtn.disabled = true; toast('Fichier trop volumineux (maximum 4 Mo). Scindez l\'export.', 'danger'); return; }
    state.file_name = f.name;
    state.source = /\.(vcf|vcard)$/i.test(f.name) ? 'vcard' : 'csv';
    const rd = new FileReader();
    rd.onload = () => {
      state.text = String(rd.result || '');
      if (state.source === 'csv' && /BEGIN:VCARD/i.test(state.text)) state.source = 'vcard';
      // Excel's French "CSV (point-virgule)" is often cp1252, not UTF-8: the
      // accents would arrive as U+FFFD and be imported as such. Say so.
      if (state.text.indexOf('�') >= 0) toast('Encodage non UTF-8 détecté : les accents seraient perdus. Ré-enregistrez le fichier en UTF-8 avant d\'importer.', 'warn');
      previewBtn.disabled = false;
    };
    rd.onerror = () => toast('Lecture du fichier impossible.', 'danger');
    rd.readAsText(f);
  });
  previewBtn.addEventListener('click', async () => {
    previewBtn.disabled = true; importBtn.hidden = true;
    clear(out).appendChild(skeletonRows(4));
    try {
      const p = await api.post('/contacts/import/preview', { source: state.source, text: state.text, file_name: state.file_name });
      state.preview = p; renderPreview(p); syncImportBtn();
    } catch (e) { clear(out).appendChild(errorBox(describeError(e), null, e.body && (e.body.detail || e.body.error))); }
    finally { previewBtn.disabled = false; }
  });
  importBtn.addEventListener('click', async () => {
    importBtn.disabled = true;
    try {
      const r = await api.post('/contacts/import', { source: state.source, text: state.text, file_name: state.file_name, label: label.value || null, skip_duplicates: skip.checked });
      toast(r.imported + ' contact(s) importé(s), ' + r.skipped + ' ignoré(s).', 'ok');
      window.location.hash = '#/clients/contacts/imports';
    } catch (e) { toast(describeError(e), 'danger'); importBtn.disabled = false; }
  });
  skip.addEventListener('change', syncImportBtn);
  function syncImportBtn() {
    if (!state.preview) return;
    const s = state.preview.summary;
    const n = skip.checked ? s.new : s.new + s.duplicate_existing + s.duplicate_in_file;
    importBtn.textContent = 'Importer ' + n + ' contact(s)';
    importBtn.hidden = n === 0; importBtn.disabled = n === 0;
  }
  function renderPreview(p) {
    clear(out);
    const s = p.summary;
    out.appendChild(h('p', {}, badge(s.new + ' nouveau(x)', 'ok'), ' ', badge(s.duplicate_existing + ' déjà présent(s)', 'warn'), ' ',
      badge(s.duplicate_in_file + ' doublon(s) dans le fichier', 'warn'), ' ', badge(s.invalid + ' invalide(s)', 'danger'),
      p.delimiter ? h('span', { class: 'hint', text: ' — CSV, séparateur « ' + (p.delimiter === '\t' ? 'tabulation' : p.delimiter) + ' »' }) : null));
    if (p.unmapped && p.unmapped.length) out.appendChild(h('p', { class: 'hint', text: 'Colonnes ignorées : ' + p.unmapped.join(', ') }));
    out.appendChild(table([
      { key: 'index', label: '#', render: (x) => String(x.index + 1) },
      { key: 'status', label: 'État', render: (x) => badge((STATUS[x.status] || [x.status])[0], (STATUS[x.status] || [])[1]) },
      { key: 'full_name', label: 'Nom', render: (x) => x.full_name || '—' },
      { key: 'phone', label: 'Téléphone', render: (x) => [x.phone, x.phone2].filter(Boolean).join(' / ') || '—' },
      { key: 'email', label: 'Email', render: (x) => x.email || '—' },
      { key: 'city', label: 'Ville', render: (x) => x.city || '—' },
      { key: 'domain', label: 'Domaine / Métier', render: (x) => [x.domain, x.job_title].filter(Boolean).join(' — ') || '—' },
      { key: 'match', label: 'Détail', render: (x) => {
        const parts = [];
        if (x.match && x.match.id) parts.push('= ' + (x.match.full_name || x.match.id) + ' (' + (x.match.on === 'phone' ? 'téléphone' : 'email') + ')');
        if (x.match && x.match.index !== undefined) parts.push('= ligne ' + (x.match.index + 1) + ' (' + (x.match.on === 'phone' ? 'téléphone' : 'email') + ')');
        (x.warnings || []).forEach((w) => parts.push(WARN[w] || w));
        return parts.join(' ; ') || '';
      } }
    ], p.rows));
  }
}

function contactLine(c) {
  return [c.full_name, c.phone, c.email, c.city].filter(Boolean).join(' · ');
}

function duplicatesView(root) {
  const body = h('div', { class: 'stack' });
  root.appendChild(body);
  load();
  async function load() {
    clear(body).appendChild(skeletonRows(4));
    try {
      const r = await api.get('/contacts/duplicates');
      clear(body);
      if (!r.groups.length) { body.appendChild(empty('Aucun doublon', 'Aucun contact ne partage un téléphone ou un email avec un autre.')); return; }
      // No "merge everything" button on purpose: the key is the legacy one
      // (primary phone or e-mail), and a shared switchboard number makes
      // colleagues look like one person. Each group is read, then merged.
      body.appendChild(h('p', { class: 'toolbar-count', text: r.total + ' groupe(s) de doublons (même téléphone ou même email). Vérifiez qu\'il s\'agit bien de la même personne : un numéro de standard partagé forme aussi un groupe. La fusion garde le premier contact (le plus ancien), complète ses champs vides avec les autres et retire ceux-ci — société et rôle du contact conservé ne changent pas.' }));
      r.groups.forEach((g) => {
        body.appendChild(h('article', { class: 'card', dataset: { dup: g.key } },
          h('div', { class: 'card-head' }, h('h3', {}, badge(MATCHED[g.matched_on] || g.matched_on, 'warn'), ' ', h('span', { class: 'mono', text: g.key })),
            h('button', { type: 'button', class: 'btn btn-primary btn-sm', text: 'Fusionner (garder le premier)', onClick: () => mergeGroup(g) })),
          h('ol', {}, g.contacts.map((c, i) => h('li', {}, h('strong', { text: c.full_name }), ' — ', contactLine(c),
            c.domain || c.job_title ? ' (' + [c.domain, c.job_title].filter(Boolean).join(', ') + ')' : '',
            i === 0 ? h('span', {}, ' ', badge('conservé', 'ok')) : null)))));
      });
    } catch (e) { clear(body).appendChild(errorBox(describeError(e), load, e.body && e.body.error)); }
  }
  async function mergeGroup(g) {
    const names = g.contacts.map((c) => c.full_name).join(' / ');
    const ok = await confirmDialog({ title: 'Fusionner ' + g.contacts.length + ' contacts', text: names + ' — « ' + g.contacts[0].full_name + ' » est conservé ; les autres sont retirés après avoir complété ses champs vides (téléphone, email, adresse, métier, domaine, note). Société et rôle ne sont pas repris. Cette action est irréversible.', confirmLabel: 'Fusionner', danger: true });
    if (!ok) return;
    try { await api.post('/contacts/merge', { ids: g.contacts.map((c) => c.id) }); toast('Fusion effectuée.', 'ok'); load(); }
    catch (e) { toast(describeError(e), 'danger'); }
  }
}

function importsView(root) {
  const body = h('div', { class: 'stack' });
  root.append(h('div', { class: 'toolbar' }, h('div', { class: 'actions' }, h('a', { class: 'btn btn-primary btn-sm', href: '#/clients/contacts/import', text: 'Nouvel import' }))), body);
  load();
  async function load() {
    clear(body).appendChild(skeletonRows(4));
    try {
      const r = await api.get('/contacts/imports');
      clear(body);
      if (!r.rows.length) { body.appendChild(empty('Aucun import', 'L\'historique apparaît avec le premier fichier importé.')); return; }
      body.appendChild(table([
        { key: 'created_at', label: 'Date', render: (x) => fmtDate(x.created_at) },
        { key: 'source', label: 'Source', render: (x) => SOURCE[x.source] || x.source },
        { key: 'label', label: 'Libellé', render: (x) => x.label || (x.file_name ? h('span', { class: 'hint', text: x.file_name }) : '—') },
        { key: 'row_count', label: 'Lignes', num: true },
        { key: 'imported_count', label: 'Importés', num: true },
        { key: 'skipped_count', label: 'Ignorés', num: true },
        { key: 'live_count', label: 'Encore présents', num: true }
      ], r.rows, (x) => [
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Renommer', onClick: () => rename(x) }),
        h('button', { type: 'button', class: 'btn btn-danger btn-sm', text: 'Retirer l\'import', onClick: () => retire(x) })
      ]));
    } catch (e) { clear(body).appendChild(errorBox(describeError(e), load, e.body && e.body.error)); }
  }
  function rename(x) {
    const inp = input({ name: 'label', value: x.label || '', maxlength: 120, placeholder: x.file_name || '' });
    const err = h('p', { class: 'error', role: 'alert', hidden: true });
    const save = h('button', { type: 'button', class: 'btn btn-primary', text: 'Enregistrer' });
    save.addEventListener('click', async () => {
      err.hidden = true; save.disabled = true;
      try { await api.patch('/contacts/imports/' + x.id, { label: inp.value.trim() || null }); closeModal(); toast('Libellé enregistré.', 'ok'); load(); }
      catch (e) { err.textContent = describeError(e); err.hidden = false; save.disabled = false; }
    });
    modal({ title: 'Renommer l\'import', body: h('div', {}, field('Libellé', inp), err),
      actions: [h('button', { type: 'button', class: 'btn btn-ghost', text: 'Annuler', onClick: closeModal }), save] });
  }
  async function retire(x) {
    const ok = await confirmDialog({ title: 'Retirer cet import', text: 'Les ' + x.live_count + ' contact(s) encore présents issus de cet import seront retirés avec lui. Cette action est irréversible.', confirmLabel: 'Retirer', danger: true });
    if (!ok) return;
    try { const r = await api.del('/contacts/imports/' + x.id); toast(r.contacts_retired + ' contact(s) retiré(s).', 'ok'); load(); }
    catch (e) { toast(describeError(e), 'danger'); }
  }
}
