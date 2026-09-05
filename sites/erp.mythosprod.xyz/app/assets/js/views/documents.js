/* Documents: list, upload, download, retire.
 *
 * Upload reads the file client-side with FileReader (never a filename or
 * extension sent to the server as anything but display text) and posts
 * {filename, mime_type, content_base64, category, client_id, project_id} —
 * the server re-derives everything that matters (storage name, verified MIME,
 * hash) itself; nothing here is trusted past the upload call.
 */
import { api, qs, describeError } from '../api.js';
import { session } from '../session.js';
import { h, clear, table, pagination, skeletonRows, empty, errorBox, toast, modal, closeModal,
  confirmDialog, field, input, select, fmtDate, fmtNum, badge } from '../ui.js';

const MAX_BYTES = 15 * 1024 * 1024;
const ACCEPT = '.pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.csv,.docx,.xlsx,.pptx';
const EXT_MIME = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  txt: 'text/plain', csv: 'text/csv',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
};

function fmtBytes(n) {
  if (n === null || n === undefined) return '—';
  const u = ['o', 'Ko', 'Mo', 'Go']; let v = Number(n), i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return v.toFixed(i ? 1 : 0) + ' ' + u[i];
}
function guessMime(file) {
  if (file.type && Object.values(EXT_MIME).includes(file.type)) return file.type;
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  return EXT_MIME[ext] || file.type || '';
}
function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error('read_failed'));
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.readAsDataURL(file);
  });
}

export function documentsView(container) {
  const state = { search: '', client_id: '', project_id: '', offset: 0, limit: 25 };
  const search = input({ type: 'search', placeholder: 'Nom, catégorie…', 'aria-label': 'Rechercher' });
  let deb; search.addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(() => { state.search = search.value; state.offset = 0; load(); }, 250); });
  const count = h('span', { class: 'toolbar-count' });
  container.appendChild(h('div', { class: 'toolbar' }, field('Rechercher', search),
    h('div', { class: 'actions' }, count, h('button', { type: 'button', class: 'btn btn-primary btn-sm', text: 'Téléverser', onClick: () => uploadForm(load) }))));
  const body = h('div', {}); container.appendChild(body);
  load();

  async function load() {
    clear(body).appendChild(skeletonRows(6));
    try {
      const page = await api.get('/documents' + qs({ search: state.search, limit: state.limit, offset: state.offset, sort: 'created_at', dir: 'desc' }));
      clear(body);
      count.textContent = page.total + ' document' + (page.total > 1 ? 's' : '');
      if (!page.rows.length) { body.appendChild(empty('Aucun document', state.search ? 'Aucun résultat pour cette recherche.' : 'Téléversez le premier document.')); return; }
      body.appendChild(table([
        { key: 'original_name', label: 'Nom' },
        { key: 'mime_type', label: 'Type', render: (r) => h('span', { class: 'mono', text: r.mime_type }) },
        { key: 'byte_size', label: 'Taille', num: true, render: (r) => fmtBytes(r.byte_size) },
        { key: 'category', label: 'Catégorie', render: (r) => r.category ? badge(r.category, 'info') : '—' },
        { key: 'created_at', label: 'Déposé le', render: (r) => fmtDate(r.created_at) }
      ], page.rows, (r) => [
        h('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Télécharger', onClick: () => downloadOne(r) }),
        h('button', { type: 'button', class: 'btn btn-danger btn-sm', text: 'Retirer', onClick: () => retire(r) })
      ]));
      body.appendChild(pagination({ total: page.total, limit: page.limit, offset: page.offset, onPage: (o) => { state.offset = o; load(); } }));
    } catch (e) { clear(body).appendChild(errorBox(describeError(e), load, e.body && e.body.error)); }
  }

  async function downloadOne(row) {
    try {
      const res = await fetch('/api/v1/documents/' + row.id + '/download', { credentials: 'same-origin' });
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw Object.assign(new Error('download_failed'), { status: res.status, body: b }); }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = h('a', { href: url, download: row.original_name || 'document' });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (e) { toast(e.status === 404 ? 'Document introuvable.' : e.status === 403 ? 'Accès refusé.' : 'Échec du téléchargement.', 'danger'); }
  }

  async function retire(row) {
    if (!(await confirmDialog({ title: 'Retirer « ' + row.original_name + ' » ?', danger: true, confirmLabel: 'Retirer',
      text: 'Le document est retiré (marqué supprimé) ; le fichier reste conservé, jamais effacé, pour audit.' }))) return;
    try { await api.del('/documents/' + row.id); toast('Retiré.', 'ok'); load(); }
    catch (e) { toast(describeError(e), 'danger'); }
  }

  async function uploadForm(done) {
    let lookups = { clients: [], projects: [] };
    try {
      const [cl, pr] = await Promise.all([api.get('/clients?limit=200'), api.get('/projects?limit=200')]);
      lookups = { clients: cl.rows, projects: pr.rows };
    } catch (e) { /* optional links: a fetch failure just means the selects stay empty */ }

    const fileInput = h('input', { type: 'file', name: 'file', accept: ACCEPT, required: true });
    const nameHint = h('p', { class: 'hint', text: 'PDF, image, texte/CSV ou document bureautique (docx/xlsx/pptx) — 15 Mo maximum.' });
    const category = input({ name: 'category', placeholder: 'Contrat, facture scannée…' });
    const clientSel = select([{ value: '', label: '—' }].concat(lookups.clients.map((c) => ({ value: c.id, label: c.name }))), { name: 'client_id' });
    const projectSel = select([{ value: '', label: '—' }].concat(lookups.projects.map((p) => ({ value: p.id, label: p.title }))), { name: 'project_id' });
    const err = h('p', { class: 'error', role: 'alert', hidden: true });
    const submit = h('button', { type: 'button', class: 'btn btn-primary', text: 'Téléverser' });

    submit.addEventListener('click', async () => {
      err.hidden = true;
      const file = fileInput.files && fileInput.files[0];
      if (!file) { err.textContent = 'Choisissez un fichier.'; err.hidden = false; return; }
      if (file.size > MAX_BYTES) { err.textContent = 'Le fichier dépasse 15 Mo.'; err.hidden = false; return; }
      const mime = guessMime(file);
      submit.disabled = true;
      try {
        const content_base64 = await readAsBase64(file);
        await api.post('/documents', { filename: file.name, mime_type: mime, content_base64, category: category.value || null,
          client_id: clientSel.value || null, project_id: projectSel.value || null });
        closeModal(); toast('Document téléversé.', 'ok'); done();
      } catch (e) { err.textContent = describeError(e); err.hidden = false; submit.disabled = false; }
    });

    modal({ title: 'Téléverser un document', body: h('div', { class: 'stack' },
      field('Fichier', fileInput), nameHint, field('Catégorie', category),
      h('div', { class: 'field-row' }, field('Client (facultatif)', clientSel), field('Projet (facultatif)', projectSel)), err),
      actions: [h('button', { type: 'button', class: 'btn btn-ghost', text: 'Annuler', onClick: closeModal }), submit] });
  }
}
