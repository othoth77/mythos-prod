// MYTHOS PROD — COLLABORATEURS v1
// Dependencies: STORE.collabs/saveCollabs/oms (storage.js); esc, formatDate (utils.js); showView (router.js); previewOM, editOM (app.js)

var currentCollabDetailId = '';

function renderCollaborateurs() {
  const el = document.getElementById('collaborateurs-list');
  const collabs = STORE.collabs();
  if (!collabs.length) { el.innerHTML = '<div class="empty-state">Aucun collaborateur.</div>'; return; }
  el.innerHTML = '<table class="clients-list-table"><thead><tr><th>Nom</th><th>Rôle</th><th>Contact</th><th>Notes</th><th>Actions</th></tr></thead><tbody>' + collabs.map(c => `<tr style="cursor:pointer;" onclick="showCollabDetail('${c.id}')"><td><strong>${esc(c.nom || 'Collaborateur')}</strong></td><td>${esc(c.role || '')}</td><td>${esc(c.contact || '')}</td><td>${esc(c.notes || '')}</td><td onclick="event.stopPropagation()"><button class="btn btn-outline btn-sm" onclick="openCollabModal('${c.id}')" title="Modifier">✏️</button> <button class="btn btn-danger btn-sm" onclick="deleteCollab('${c.id}')" title="Supprimer">✕</button></td></tr>`).join('') + '</tbody></table>';
}

function showCollabDetail(collabId) {
  currentCollabDetailId = collabId;
  const collab = STORE.collabs().find(c => c.id === collabId);
  if (!collab) return;

  const oms = STORE.oms().filter(om => om.chauffeur === collab.nom);

  document.getElementById('collab-detail-name').textContent = collab.nom || 'Collaborateur';

  const infoItems = [];
  if (collab.role) infoItems.push({ label: 'Rôle', value: collab.role });
  if (collab.contact) infoItems.push({ label: 'Contact', value: collab.contact });
  if (collab.notes) infoItems.push({ label: 'Notes', value: collab.notes });

  document.getElementById('collab-detail-info-container').innerHTML = infoItems.map(item =>
    `<div class="client-detail-info-item">
      <label>${esc(item.label)}</label>
      <value>${esc(item.value)}</value>
    </div>`
  ).join('');

  // Calculate totals
  const totalOms = oms.length;
  const totalDistance = oms.reduce((sum, om) => sum + (om.distance || 0), 0);

  document.getElementById('collab-detail-stats').innerHTML = `
    <div class="client-stat-item">
      <div class="client-stat-label">Ordres de Mission</div>
      <div class="client-stat-value">${totalOms}</div>
    </div>
    <div class="client-stat-item">
      <div class="client-stat-label">Km total</div>
      <div class="client-stat-value">${totalDistance.toFixed(0)} km</div>
    </div>
  `;

  const omsListEl = document.getElementById('collab-detail-oms');
  if (!oms.length) {
    omsListEl.innerHTML = '<div class="empty-state" style="grid-column:1/-1;">Aucun ordre de mission pour ce collaborateur.</div>';
  } else {
    omsListEl.innerHTML = oms.map(om => {
      return `<div class="invoice-card">
        <div>
          <div class="inv-num">${esc(om.id || '---')}</div>
          <div class="inv-client">${esc(om.depart || 'Lieu de départ')} → ${esc(om.arrivee || 'Lieu d\'arrivée')}</div>
          <div class="inv-meta">${om.date ? formatDate(om.date) : 'Date non définie'}</div>
        </div>
        <div class="inv-amount">
          <div class="inv-ttc">${om.distance ? om.distance.toFixed(1) + ' km' : '---'}</div>
          <div class="inv-date" style="margin-top:8px;">
            <button class="btn btn-outline btn-sm" style="margin-right:4px;" onclick="previewOM('${om.id}')">Aperçu</button>
            <button class="btn btn-outline btn-sm" onclick="editOM('${om.id}')">Éditer</button>
          </div>
        </div>
      </div>`;
    }).join('');
  }

  showView('collab-detail');
}

function openCollabModal(id = '') {
  document.getElementById('collab-edit-id').value = '';
  ['collab-nom', 'collab-role', 'collab-contact', 'collab-notes'].forEach(field => document.getElementById(field).value = '');
  const c = STORE.collabs().find(item => item.id === id);
  if (c) {
    document.getElementById('collab-edit-id').value = c.id;
    document.getElementById('collab-nom').value = c.nom || '';
    document.getElementById('collab-role').value = c.role || '';
    document.getElementById('collab-contact').value = c.contact || '';
    document.getElementById('collab-notes').value = c.notes || '';
  }
  document.getElementById('collab-modal').style.display = 'flex';
}
function closeCollabModal() { document.getElementById('collab-modal').style.display = 'none'; }
function saveCollab() {
  const id = document.getElementById('collab-edit-id').value || 'collab_' + Date.now();
  const c = { id, nom: document.getElementById('collab-nom').value, role: document.getElementById('collab-role').value, contact: document.getElementById('collab-contact').value, notes: document.getElementById('collab-notes').value };
  let collabs = STORE.collabs();
  collabs = collabs.some(item => item.id === id) ? collabs.map(item => item.id === id ? c : item) : collabs.concat(c);
  STORE.saveCollabs(collabs);
  closeCollabModal();
  renderCollaborateurs();
}
function deleteCollab(id) {
  if (!confirm('Supprimer ce collaborateur ?')) return;
  STORE.saveCollabs(STORE.collabs().filter(c => c.id !== id));
  renderCollaborateurs();
}
