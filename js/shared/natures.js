// MYTHOS PROD — NATURES v1
// Natures de prestation: CRUD and rendering.
// Provides: renderNatures, showNatureDetail, openNatureModal, closeNatureModal,
//           saveNature, deleteNature
// Dependencies at call time: STORE.natures/representations/invoices/saveNatures (storage.js);
//   esc, money, formatDate (utils.js); showView (router.js)
// ══════════════════════════════════════════════════════════════════════

function renderNatures() {
  const el = document.getElementById('natures-list');
  const natures = STORE.natures();
  if (!natures.length) { el.innerHTML = '<div class="empty-state">Aucune nature.</div>'; return; }
  el.innerHTML = '<table class="natures-list-table"><thead><tr><th>Icône</th><th>Nom</th><th>Description</th><th style="width:180px;text-align:center;">Actions</th></tr></thead><tbody>' + natures.map(n => `<tr style="cursor:pointer;" onclick="showNatureDetail('${n.id}')"><td style="text-align:center;font-size:24px;">${esc(n.icon || '')}</td><td><strong>${esc(n.nom || 'Nature')}</strong></td><td style="color:var(--muted);">${esc(n.desc || '')}</td><td style="text-align:center;" onclick="event.stopPropagation();"><button class="btn btn-outline btn-sm" onclick="openNatureModal('${n.id}')" title="Modifier">✏️</button> <button class="btn btn-danger btn-sm" onclick="deleteNature('${n.id}')" title="Supprimer">✕</button></td></tr>`).join('') + '</tbody></table>';
}

function showNatureDetail(natureId) {
  const nature = STORE.natures().find(n => n.id === natureId);
  if (!nature) return;
  const reps = STORE.representations().filter(r => (r.natureLines || []).some(nl => nl.natureId === natureId));
  const invs = STORE.invoices().filter(i => (i.natureLinesInv || []).some(nl => nl.natureId === natureId));
  const el = document.getElementById('natures-list');
  el.innerHTML = `
    <div style="margin-bottom:24px;">
      <button class="btn btn-outline" onclick="renderNatures()" style="margin-bottom:16px;">← Retour à la liste</button>
      <div style="background:linear-gradient(135deg, rgba(201,168,76,0.12), rgba(201,168,76,0.06)); border:1px solid rgba(201,168,76,0.2); border-radius:16px; padding:32px 40px; margin-bottom:32px;">
        <div style="display:flex; align-items:center; gap:20px; margin-bottom:20px;">
          <div style="font-size:64px;">${esc(nature.icon || '🎭')}</div>
          <div>
            <h1 style="font-family:'Playfair Display',serif; font-size:42px; color:var(--gold-light); font-weight:800; margin:0;">${esc(nature.nom || 'Nature')}</h1>
            <p style="color:var(--muted); margin:8px 0 0 0; font-size:14px;">${esc(nature.desc || '-')}</p>
          </div>
        </div>
      </div>
    </div>

    ${reps.length > 0 ? `<h2 style="font-family:'Playfair Display',serif; color:var(--gold-light); font-size:20px; margin:32px 0 20px; border-bottom:2px solid rgba(201,168,76,0.3); padding-bottom:12px; font-weight:800;">Représentations liées (${reps.length})</h2>
    <table class="representations-list-table" style="margin-bottom:32px;"><thead><tr><th>Spectacle</th><th>Client</th><th>Directeur</th><th style="text-align:right;">Cachet</th><th style="width:150px;text-align:center;">Actions</th></tr></thead><tbody>` + reps.map(r => `<tr><td><strong>${esc(r.spectacle || 'Spectacle')}</strong></td><td>${esc(r.clientName || '')}</td><td>${esc(r.director || '')}</td><td style="text-align:right;color:var(--gold-light);font-weight:700;">${fmtMoney(r.fee)}</td><td style="text-align:center;"><button class="btn btn-outline btn-sm" onclick="openRepresentationModal('${r.id}')" title="Modifier">✏️</button> <button class="btn btn-danger btn-sm" onclick="deleteRepresentation('${r.id}')" title="Supprimer">✕</button></td></tr>`).join('') + '</tbody></table>' : '<div class="empty-state" style="margin:32px 0;">Aucune représentation pour cette nature.</div>'}

    ${invs.length > 0 ? `<h2 style="font-family:'Playfair Display',serif; color:var(--gold-light); font-size:20px; margin:32px 0 20px; border-bottom:2px solid rgba(201,168,76,0.3); padding-bottom:12px; font-weight:800;">Factures liées (${invs.length})</h2>
    <div class="invoice-grid">` + invs.map(inv => {
      const isSans = inv.type === 'sans_tva';
      const title = isSans ? 'Sans numerotation' : esc(inv.num || '-');
      return `<div class="invoice-card"><div><div class="inv-num">${title}${isSans ? '<span class="invoice-type-badge">Sans TVA</span>' : ''}</div><div class="inv-client">${esc(inv.clientName || 'Client non defini')}</div><div class="inv-meta">${formatDate(inv.date)} · ${fmtMoney(getInvoiceTotal(inv))}</div></div><div class="inv-actions"><button class="btn btn-outline btn-sm" onclick="editInvoice('${inv.id}')" title="Modifier">✏️</button> <button class="btn btn-danger btn-sm" onclick="deleteInvoice('${inv.id}')" title="Supprimer">✕</button></div></div>`;
    }).join('') + '</div>' : '<div class="empty-state" style="margin:32px 0;">Aucune facture pour cette nature.</div>'}
  `;
}

function openNatureModal(id = '') {
  document.getElementById('nature-edit-id').value = '';
  ['nature-nom', 'nature-desc', 'nature-icon'].forEach(field => document.getElementById(field).value = '');
  const n = STORE.natures().find(item => item.id === id);
  if (n) {
    document.getElementById('nature-edit-id').value = n.id;
    document.getElementById('nature-nom').value = n.nom || '';
    document.getElementById('nature-desc').value = n.desc || '';
    document.getElementById('nature-icon').value = n.icon || '';
  }
  document.getElementById('nature-modal').style.display = 'flex';
}
function closeNatureModal() { document.getElementById('nature-modal').style.display = 'none'; }
function saveNature() {
  const id = document.getElementById('nature-edit-id').value || 'nature_' + Date.now();
  const n = { id, nom: document.getElementById('nature-nom').value, desc: document.getElementById('nature-desc').value, icon: document.getElementById('nature-icon').value };
  let natures = STORE.natures();
  natures = natures.some(item => item.id === id) ? natures.map(item => item.id === id ? n : item) : natures.concat(n);
  STORE.saveNatures(natures);
  closeNatureModal();
  renderNatures();
}
function deleteNature(id) {
  if (!confirm('Supprimer cette nature ?')) return;
  STORE.saveNatures(STORE.natures().filter(n => n.id !== id));
  renderNatures();
}
