// MYTHOS PROD — CLIENTS v1
// Clients: CRUD and detail view.
// Provides: currentClientDetailId, renderClients, showClientDetail,
//           openClientModal, closeClientModal, saveClient, deleteClient
// Dependencies at call time: STORE.clients/invoices/saveClients (storage.js);
//   esc, money, formatDate (utils.js); showView (router.js);
//   previewInvoice, editInvoice, LOGGER (app.js)
// ══════════════════════════════════════════════════════════════════════

var currentClientDetailId = '';

function renderClients() {
  const el = document.getElementById('clients-list');
  const clients = STORE.clients();
  if (!clients.length) { el.innerHTML = '<div class="empty-state">Aucun client.</div>'; return; }
  el.innerHTML = '<table class="clients-list-table"><thead><tr><th>Nom/Contact</th><th>Contact</th><th>Téléphone</th><th>Adresse</th><th>MF</th><th>Actions</th></tr></thead><tbody>' + clients.map(c => `<tr style="cursor:pointer;" onclick="showClientDetail('${c.id}')"><td><strong>${esc(c.name || c.contact || 'Client')}</strong></td><td>${esc(c.contact || '')}</td><td>${esc(c.tel || '')}</td><td>${esc(c.addr || '')}</td><td>${esc(c.mf || '')}</td><td onclick="event.stopPropagation()"><button class="btn btn-outline btn-sm" onclick="openClientModal('${c.id}')" title="Modifier">✏️</button> <button class="btn btn-danger btn-sm" onclick="deleteClient('${c.id}')" title="Supprimer">✕</button></td></tr>`).join('') + '</tbody></table>';
}

function showClientDetail(clientId) {
  currentClientDetailId = clientId;
  const client = STORE.clients().find(c => c.id === clientId);
  if (!client) return;

  const invoices = STORE.invoices().filter(inv => inv.clientId === clientId || inv.clientName === client.name);

  document.getElementById('client-detail-name').textContent = client.name || client.contact || 'Client';

  const infoItems = [];
  if (client.contact) infoItems.push({ label: 'Contact', value: client.contact });
  if (client.tel) infoItems.push({ label: 'Téléphone', value: client.tel });
  if (client.addr) infoItems.push({ label: 'Adresse', value: client.addr });
  if (client.mf) infoItems.push({ label: 'Matricule Fiscal', value: client.mf });

  document.getElementById('client-detail-info-container').innerHTML = infoItems.map(item =>
    `<div class="client-detail-info-item">
      <label>${esc(item.label)}</label>
      <value>${esc(item.value)}</value>
    </div>`
  ).join('');

  // Calculate totals
  const totalAmount = invoices.reduce((sum, inv) => sum + (inv.ttc || 0), 0);
  const totalCount = invoices.length;

  document.getElementById('client-detail-stats').innerHTML = `
    <div class="client-stat-item">
      <div class="client-stat-label">Nombre de factures</div>
      <div class="client-stat-value">${totalCount}</div>
    </div>
    <div class="client-stat-item">
      <div class="client-stat-label">Montant total</div>
      <div class="client-stat-value">${money(totalAmount)}</div>
    </div>
  `;

  const invListEl = document.getElementById('client-detail-invoices');
  if (!invoices.length) {
    invListEl.innerHTML = '<div class="empty-state" style="grid-column:1/-1;">Aucune facture pour ce client.</div>';
  } else {
    invListEl.innerHTML = invoices.map(inv => {
      const ttc = inv.ttc || 0;
      return `<div class="invoice-card">
        <div>
          <div class="inv-num">${esc(inv.num || '---')}</div>
          <div class="inv-client">${esc(inv.clientName || 'Sans client')}</div>
          <div class="inv-meta">${inv.date ? formatDate(inv.date) : 'Date non définie'}</div>
        </div>
        <div class="inv-amount">
          <div class="inv-ttc">${money(ttc)}</div>
          <div class="inv-date" style="margin-top:8px;">
            <button class="btn btn-outline btn-sm" style="margin-right:4px;" onclick="previewInvoice('${inv.id}')">Aperçu</button>
            <button class="btn btn-outline btn-sm" onclick="editInvoice('${inv.id}')">Éditer</button>
          </div>
        </div>
      </div>`;
    }).join('');
  }

  showView('client-detail');
}

function openClientModal(id = '') {
  ['cm-id', 'cm-contact', 'cm-name', 'cm-addr', 'cm-mf', 'cm-tel'].forEach(field => document.getElementById(field).value = '');
  const c = STORE.clients().find(item => item.id === id);
  if (c) {
    document.getElementById('cm-id').value = c.id;
    document.getElementById('cm-contact').value = c.contact || '';
    document.getElementById('cm-name').value = c.name || '';
    document.getElementById('cm-addr').value = c.addr || '';
    document.getElementById('cm-mf').value = c.mf || '';
    document.getElementById('cm-tel').value = c.tel || '';
  }
  document.getElementById('client-modal').style.display = 'flex';
}

function closeClientModal() { document.getElementById('client-modal').style.display = 'none'; }

function saveClient() {
  const id = document.getElementById('cm-id').value || 'client_' + Date.now();
  const client = { id, contact: document.getElementById('cm-contact').value, name: document.getElementById('cm-name').value, addr: document.getElementById('cm-addr').value, mf: document.getElementById('cm-mf').value, tel: document.getElementById('cm-tel').value };
  let clients = STORE.clients();
  clients = clients.some(c => c.id === id) ? clients.map(c => c.id === id ? client : c) : clients.concat(client);
  STORE.saveClients(clients);
  if (typeof LOGGER !== 'undefined') LOGGER.log('SAVE_CLIENT', { name: client.name });
  closeClientModal();
  renderClients();
}

function deleteClient(id) {
  if (!confirm('Supprimer ce client ?')) return;
  STORE.saveClients(STORE.clients().filter(c => c.id !== id));
  if (typeof LOGGER !== 'undefined') LOGGER.log('DELETE_CLIENT', { id });
  renderClients();
}
