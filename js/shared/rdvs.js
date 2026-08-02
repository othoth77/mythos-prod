// RDV CRUD and form workflow shared module (Stage 4N).
// Globals remain available for existing inline handlers and callers.


function rdvOpenForm() {
  // Initialize the list when opening form
  rdvRender();

  document.getElementById('rdv-date-picker').value = todayStr();
  document.getElementById('rdv-time-picker').value = '09:00';
  rdvShowExistingRdvs();
  document.getElementById('rdv-modal-step1').style.display = 'flex';
  document.getElementById('rdv-modal-step1').dataset.editId = '';
}

function rdvClose() {
  document.getElementById('rdv-modal-step1').style.display = 'none';
  document.getElementById('rdv-modal-step2').style.display = 'none';
}

function rdvShowExistingRdvs() {
  const date = document.getElementById('rdv-date-picker').value;
  const list = STORE.rdvs().filter(r => r.date === date).sort((a, b) => String(a.time).localeCompare(String(b.time)));

  const html = !list.length ?
    '<p style="color:#6b7280;font-size:14px;">✓ Pas de rendez-vous ce jour</p>' :
    '<div style="color:#d4af37;font-size:13px;margin-bottom:10px;">📋 Rendez-vous ce jour:</div>' +
    '<table style="width:100%;font-size:13px;"><tbody>' +
    list.map(r => `<tr style="border-bottom:1px solid #444;">
      <td style="padding:6px;">${r.time || '-'}</td>
      <td style="padding:6px;">${esc(r.client || '-')}</td>
      <td style="padding:6px;text-align:right;color:#d4af37;">${(r.fee || 0).toFixed(3)} TND</td>
    </tr>`).join('') +
    '</tbody></table>';

  document.getElementById('rdv-existing').innerHTML = html;
}

function rdvGoToStep2() {
  const date = document.getElementById('rdv-date-picker').value;

  if (!date) {
    alert('📅 Veuillez sélectionner une date');
    return;
  }

  try {
    // Save date and time for step 2
    document.getElementById('rdv-modal-step1').dataset.selectedDate = date;
    document.getElementById('rdv-modal-step1').dataset.selectedTime = document.getElementById('rdv-time-picker').value;

    // Load dropdowns and show step 2
    rdvLoadDropdowns();
    document.getElementById('rdv-modal-step1').style.display = 'none';
    document.getElementById('rdv-modal-step2').style.display = 'flex';
  } catch (e) {
    console.error('Error in rdvGoToStep2:', e);
    alert('Erreur: ' + e.message);
  }
}

function rdvBackToStep1() {
  document.getElementById('rdv-modal-step1').style.display = 'flex';
  document.getElementById('rdv-modal-step2').style.display = 'none';
}

function getAllInvoices() {
  const invoices = STORE.invoices() || [];

  // Filter out any items with CONT- prefix (contracts)
  return invoices.filter(inv => {
    const numero = String(inv.numero || inv.number || inv.ref || '').toUpperCase();
    return !numero.includes('CONT');
  });
}

function getAllDevis() {
  const devis = STORE.devis() || [];

  // Filter out any items with CONT- prefix (contracts)
  return devis.filter(dv => {
    const numero = String(dv.numero || dv.number || dv.ref || '').toUpperCase();
    return !numero.includes('CONT');
  });
}

function getAllContracts() {
  const contracts = STORE.contracts() || [];

  // Only return items with CONT- prefix
  return contracts.filter(ct => {
    const numero = String(ct.numero || ct.number || ct.ref || '').toUpperCase();
    return numero.includes('CONT');
  });
}

function rdvLoadDropdowns() {
  const clients = STORE.clients();
  const collabs = STORE.collabs();
  const natures = STORE.natures();
  const reps = STORE.representations();

  // Get all invoices from anywhere
  const invoices = getAllInvoices();
  const devis = getAllDevis();
  const contracts = getAllContracts();

  document.getElementById('rdv-client').innerHTML = '<option>-- Sélectionner --</option>' +
    clients.map(c => `<option value="${esc(c.name || c.contact)}">${esc(c.name || c.contact)}</option>`).join('');

  document.getElementById('rdv-collab').innerHTML = '<option>-- Sélectionner --</option>' +
    collabs.map(c => `<option value="${esc(c.nom)}">${esc(c.nom)}</option>`).join('');

  document.getElementById('rdv-nature').innerHTML = '<option>-- Sélectionner --</option>' +
    natures.map(n => `<option value="${esc(n.nom)}">${esc(n.nom)}</option>`).join('');

  document.getElementById('rdv-rep').innerHTML = '<option>-- Sélectionner --</option>' +
    reps.map(r => `<option value="${r.id}" data-fee="${r.fee || 0}">${esc(r.spectacle)}</option>`).join('');

  // Populate invoice dropdown
  document.getElementById('rdv-fee-invoice').innerHTML = '<option value="">-- Sélectionner une facture --</option>' +
    invoices.map((inv) => {
      const id = inv.id;
      const numero = inv.num || '-';
      const total = inv.ttc || 0;
      const display = `${esc(String(numero))} - ${parseFloat(total).toFixed(3)} TND`;
      return `<option value="${id}" data-amount="${total}">${display}</option>`;
    }).join('');

  // Populate devis dropdown
  document.getElementById('rdv-fee-devis').innerHTML = '<option value="">-- Sélectionner un devis --</option>' +
    devis.map((dv) => {
      const id = dv.id;
      const numero = dv.num || '-';
      const total = dv.totalTTC || 0;
      const display = `${esc(String(numero))} - ${parseFloat(total).toFixed(3)} TND`;
      return `<option value="${id}" data-amount="${total}">${display}</option>`;
    }).join('');

  // Populate contracts dropdown
  document.getElementById('rdv-fee-contract').innerHTML = '<option value="">-- Sélectionner un contrat --</option>' +
    contracts.map((ct) => {
      const id = ct.id;
      const numero = ct.ref || '-';
      const total = ct.amount || 0;
      const display = `${esc(String(numero))} - ${parseFloat(total).toFixed(3)} TND`;
      return `<option value="${id}" data-amount="${total}">${display}</option>`;
    }).join('');

  // Initialize fee type visibility
  rdvFeeTypeSelectChanged();
}

function rdvCalcFee() {
  const sel = document.getElementById('rdv-rep');
  const opt = sel.options[sel.selectedIndex];
  const fee = opt.dataset.fee || '0';
  // Auto-fill direct amount if direct fee type is selected
  const feeType = document.getElementById('rdv-fee-type-select')?.value || 'direct';
  if (feeType === 'direct') {
    const directInput = document.getElementById('rdv-fee-amount');
    if (directInput) directInput.value = parseFloat(fee).toFixed(3);
  }
}

function rdvFeeTypeSelectChanged() {
  const type = document.getElementById('rdv-fee-type-select').value;

  // Hide all sections
  document.getElementById('rdv-direct-section').style.display = 'none';
  document.getElementById('rdv-invoice-section').style.display = 'none';
  document.getElementById('rdv-devis-section').style.display = 'none';
  document.getElementById('rdv-contract-section').style.display = 'none';

  // Show selected section
  if (type === 'direct') {
    document.getElementById('rdv-direct-section').style.display = 'block';
  } else if (type === 'invoice') {
    document.getElementById('rdv-invoice-section').style.display = 'block';
  } else if (type === 'devis') {
    document.getElementById('rdv-devis-section').style.display = 'block';
  } else if (type === 'contract') {
    document.getElementById('rdv-contract-section').style.display = 'block';
  }
}

function rdvInvoiceChanged() {
  const invoiceId = document.getElementById('rdv-fee-invoice').value;
  if (invoiceId) {
    const invoices = getAllInvoices();
    const inv = invoices.find(i => i.id === invoiceId);
    if (inv && inv.ttc) {
      document.getElementById('rdv-fee-invoice-amount').value = parseFloat(inv.ttc).toFixed(3);
    }
  }
}

function rdvDevisChanged() {
  const devisId = document.getElementById('rdv-fee-devis').value;
  if (devisId) {
    const allDevis = getAllDevis();
    const dv = allDevis.find(d => d.id === devisId);
    if (dv && dv.totalTTC) {
      document.getElementById('rdv-fee-devis-amount').value = parseFloat(dv.totalTTC).toFixed(3);
    }
  }
}

function rdvContractChanged() {
  const contractId = document.getElementById('rdv-fee-contract').value;
  if (contractId) {
    const allContracts = getAllContracts();
    const ct = allContracts.find(c => c.id === contractId);
    if (ct && ct.amount) {
      document.getElementById('rdv-fee-contract-amount').value = parseFloat(ct.amount).toFixed(3);
    }
  }
}

function rdvSave() {
  const date = document.getElementById('rdv-modal-step1').dataset.selectedDate;
  const time = document.getElementById('rdv-modal-step1').dataset.selectedTime;
  const feeType = document.getElementById('rdv-fee-type-select').value;

  let fee = 0;
  let feeData = {};

  // Extract fee based on selected type
  if (feeType === 'direct') {
    fee = parseFloat(document.getElementById('rdv-fee-amount').value || 0);
    feeData = { type: 'direct', value: fee };
  } else if (feeType === 'invoice') {
    const invoiceId = document.getElementById('rdv-fee-invoice').value;
    const amountInput = parseFloat(document.getElementById('rdv-fee-invoice-amount').value || 0);
    fee = amountInput > 0 ? amountInput : 0;
    feeData = { type: 'invoice', invoiceId, amount: fee };
  } else if (feeType === 'devis') {
    const devisId = document.getElementById('rdv-fee-devis').value;
    const amountInput = parseFloat(document.getElementById('rdv-fee-devis-amount').value || 0);
    fee = amountInput > 0 ? amountInput : 0;
    feeData = { type: 'devis', devisId, amount: fee };
  } else if (feeType === 'contract') {
    const contractId = document.getElementById('rdv-fee-contract').value;
    const amountInput = parseFloat(document.getElementById('rdv-fee-contract-amount').value || 0);
    fee = amountInput > 0 ? amountInput : 0;
    feeData = { type: 'contract', contractId, amount: fee };
  }

  const rdv = {
    id: document.getElementById('rdv-modal-step1').dataset.editId || 'rdv_' + Date.now(),
    date,
    time,
    client: document.getElementById('rdv-client').value,
    collab: document.getElementById('rdv-collab').value,
    rep: document.getElementById('rdv-rep').value,
    fee,
    feeData,
    nature: document.getElementById('rdv-nature').value,
    lieu: document.getElementById('rdv-lieu').value,
    notes: document.getElementById('rdv-notes').value,
    status: document.getElementById('rdv-status').value,
    updatedAt: new Date().toISOString()
  };

  let list = STORE.rdvs();
  if (document.getElementById('rdv-modal-step1').dataset.editId) {
    const idx = list.findIndex(r => r.id === rdv.id);
    if (idx >= 0) list[idx] = rdv;
  } else {
    list.push(rdv);
  }

  STORE.saveRdvs(list);
  rdvClose();

  // Force render after save
  setTimeout(() => rdvRender(), 100);
}

function rdvRender() {
  const list = STORE.rdvs().sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const html = !list.length ? '<div class="empty-state">Aucun rendez-vous</div>' :
    '<table class="clients-list-table" style="width:100%;"><thead><tr><th>Date</th><th>Heure</th><th>Client</th><th>Nature</th><th>Cachet</th><th>Statut</th><th></th></tr></thead><tbody>' +
    list.map(r => `<tr>
      <td>${r.date}</td>
      <td>${r.time || '-'}</td>
      <td>${esc(r.client || '-')}</td>
      <td>${esc(r.nature || '-')}</td>
      <td style="text-align:right;color:#d4af37;">${(r.fee || 0).toFixed(3)} TND</td>
      <td>${r.status || '-'}</td>
      <td style="text-align:center;">
        <button class="btn btn-sm btn-outline" onclick="rdvEdit('${r.id}')">✏️</button>
        <button class="btn btn-sm btn-danger" onclick="rdvDelete('${r.id}')">✕</button>
      </td>
    </tr>`).join('') +
    '</tbody></table>';
  document.getElementById('rdv-list').innerHTML = html;
}

function rdvEdit(id) {
  var list = STORE.rdvs();
  var rdv = list.find(function(r){ return r.id === id; });
  if (!rdv) return;

  var client = rdv.client || rdv.clientName || '';
  var collab = rdv.collab || rdv.collabName || (rdv.collaborateur && rdv.collaborateur.nom) || '';
  var nature = rdv.nature || rdv.title || '';
  var lieu   = rdv.lieu   || rdv.place  || '';
  var heure  = rdv.time   || rdv.heure  || '';
  var notes  = rdv.notes  || '';
  var statut = rdv.status || '';

  document.getElementById('rdv-date-picker').value = rdv.date || '';
  document.getElementById('rdv-time-picker').value = heure;
  var step1 = document.getElementById('rdv-modal-step1');
  step1.dataset.selectedDate = rdv.date || '';
  step1.dataset.selectedTime = heure;
  step1.dataset.editId = id;

  rdvLoadDropdowns();

  document.getElementById('rdv-client').value = client;
  document.getElementById('rdv-collab').value = collab;
  var repEl = document.getElementById('rdv-rep');
  if (repEl) repEl.value = rdv.rep || '';
  document.getElementById('rdv-nature').value = nature;
  document.getElementById('rdv-lieu').value   = lieu;
  document.getElementById('rdv-notes').value  = notes;
  var statusEl = document.getElementById('rdv-status');
  if (statusEl) statusEl.value = statut || (statusEl.options[0] ? statusEl.options[0].value : '');

  var feeType = (rdv.feeData && rdv.feeData.type) || 'direct';
  var feeTypeEl = document.getElementById('rdv-fee-type-select');
  if (feeTypeEl) feeTypeEl.value = feeType;
  var fee = parseFloat(rdv.fee || 0);

  var amtEl = document.getElementById('rdv-fee-amount');
  if (amtEl) amtEl.value = fee.toFixed(3);

  if (feeType === 'invoice') {
    var el = document.getElementById('rdv-fee-invoice');
    if (el) el.value = (rdv.feeData && rdv.feeData.invoiceId) || '';
    var amtI = document.getElementById('rdv-fee-invoice-amount');
    if (amtI) amtI.value = parseFloat((rdv.feeData && rdv.feeData.amount) || fee).toFixed(3);
  } else if (feeType === 'devis') {
    var el2 = document.getElementById('rdv-fee-devis');
    if (el2) el2.value = (rdv.feeData && rdv.feeData.devisId) || '';
    var amtD = document.getElementById('rdv-fee-devis-amount');
    if (amtD) amtD.value = parseFloat((rdv.feeData && rdv.feeData.amount) || fee).toFixed(3);
  } else if (feeType === 'contract') {
    var el3 = document.getElementById('rdv-fee-contract');
    if (el3) el3.value = (rdv.feeData && rdv.feeData.contractId) || '';
    var amtC = document.getElementById('rdv-fee-contract-amount');
    if (amtC) amtC.value = parseFloat((rdv.feeData && rdv.feeData.amount) || fee).toFixed(3);
  }

  rdvFeeTypeSelectChanged();
  document.getElementById('rdv-modal-step2').style.display = 'flex';
}


function rdvDelete(id) {
  if (!confirm('Supprimer?')) return;
  const list = STORE.rdvs().filter(r => r.id !== id);
  STORE.saveRdvs(list);
  _markDeleted('mp_rdvs', id); // empêche la résurrection du RDV lors d'une synchro ultérieure
  rdvRender();
}
