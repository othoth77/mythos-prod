// MYTHOS PROD — CONTRACTS v1
// Dependencies: STORE.contracts/saveContracts/clients/saveClients (app.js);
//   num, esc, fmtMoney, formatDate, todayStr (utils.js); showView, updateSidebarStats (router.js); browser DOM

function nextContractRef(year = new Date().getFullYear()) {
  const nums = STORE.contracts()
    .filter(contract => String(contract.ref || '').startsWith('CONT-' + year + '-'))
    .map(contract => parseInt(String(contract.ref || '').split('-').pop(), 10))
    .filter(Number.isFinite);
  return 'CONT-' + year + '-' + String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, '0');
}

function contractTotals(contract) {
  const amount = num(contract.amount);
  const rate = num(contract.retentionRate);
  const retention = amount * rate / 100;
  const vatAdvanceEnabled = !!contract.vatAdvanceEnabled;
  const vatAdvance = vatAdvanceEnabled ? num(contract.vatAdvanceAmount) : 0;
  const taxes = retention + vatAdvance;
  return { amount, rate, retention, vatAdvanceEnabled, vatAdvance, taxes, net: amount - taxes };
}

function contractStatusLabel(status) {
  return status === 'paid' ? 'Pay\u00e9' : 'Non pay\u00e9';
}

function fillContractClientSelect() {
  const sel = document.getElementById('contract-client-select');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">-- Nouveau client --</option>' + STORE.clients().map(c => `<option value="${esc(c.id)}">${esc(c.name || c.contact || 'Client')}</option>`).join('');
  sel.value = current;
}

function fillContractClientFromSelect() {
  const id = document.getElementById('contract-client-select')?.value || '';
  const client = STORE.clients().find(c => c.id === id);
  if (!client) return;
  document.getElementById('contract-client-name').value = client.name || client.contact || '';
}

function toggleContractVatAdvance() {
  const enabled = !!document.getElementById('contract-vat-advance-enabled')?.checked;
  const group = document.getElementById('contract-vat-advance-group');
  if (group) group.style.display = enabled ? '' : 'none';
  calcContractTotals();
}

function calcContractTotals() {
  const amount = num(document.getElementById('contract-amount')?.value);
  const rate = num(document.getElementById('contract-retention-rate')?.value);
  const vatAdvanceEnabled = !!document.getElementById('contract-vat-advance-enabled')?.checked;
  const vatAdvance = vatAdvanceEnabled ? num(document.getElementById('contract-vat-advance-amount')?.value) : 0;
  const retention = amount * rate / 100;
  const taxes = retention + vatAdvance;
  const net = amount - taxes;
  const retentionEl = document.getElementById('contract-retention-amount');
  const taxesEl = document.getElementById('contract-tax-total');
  const netEl = document.getElementById('contract-net-amount');
  if (retentionEl) retentionEl.value = fmtMoney(retention);
  if (taxesEl) taxesEl.value = fmtMoney(taxes);
  if (netEl) netEl.value = fmtMoney(net);
}

function renderContracts() {
  const el = document.getElementById('contracts-list');
  if (!el) return;
  const contracts = STORE.contracts().slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  if (!contracts.length) {
    el.innerHTML = '<div class="empty-state">Aucun contrat.</div>';
    return;
  }
  el.innerHTML = '<div class="invoice-grid">' + contracts.map(contract => {
    const totals = contractTotals(contract);
    const statusClass = contract.status === 'paid' ? 'paid' : 'pending';
    const vatAdvanceChip = totals.vatAdvanceEnabled ? `<div class="contract-money"><span>Avance TVA</span><strong>${fmtMoney(totals.vatAdvance)}</strong></div>` : '';
    return `<div class="invoice-card contract-card" onclick="editContract('${contract.id}')">
      <div class="contract-card-main">
        <div class="contract-card-top">
          <div>
            <div class="contract-ref">${esc(contract.ref || 'Contrat')}</div>
            <div class="contract-client">${esc(contract.clientName || 'Client non defini')}</div>
          </div>
          <div class="contract-status ${statusClass}">${contractStatusLabel(contract.status)} - Virement bancaire</div>
        </div>
        <div class="contract-card-meta">
          <span>${formatDate(contract.date)}</span>
          <span>Retenue ${totals.rate}%</span>
        </div>
        <div class="contract-money-grid">
          <div class="contract-money"><span>Montant convenu</span><strong>${fmtMoney(totals.amount)}</strong></div>
          <div class="contract-money"><span>Montant retenue</span><strong>${fmtMoney(totals.retention)}</strong></div>
          ${vatAdvanceChip}
          <div class="contract-money"><span>Somme d'impots</span><strong>${fmtMoney(totals.taxes)}</strong></div>
          <div class="contract-money net"><span>Net a recevoir</span><strong>${fmtMoney(totals.net)}</strong></div>
        </div>
        ${contract.details ? `<div class="contract-details">${esc(contract.details)}</div>` : ''}
        <div class="inv-meta">${formatDate(contract.date)} · Montant convenu ${fmtMoney(totals.amount)} · Retenue ${totals.rate}%</div>
        <div class="invoice-payment-badge ${contract.status === 'paid' ? 'paid' : 'pending'}">${contractStatusLabel(contract.status)} · Virement bancaire · Net ${fmtMoney(totals.net)}</div>
        ${contract.details ? `<div class="inv-meta" style="margin-top:8px;line-height:1.45;">${esc(contract.details)}</div>` : ''}
      </div>
      <div class="inv-actions contract-actions" onclick="event.stopPropagation()">
        <button class="btn btn-outline btn-sm contract-icon-btn" onclick="editContract('${contract.id}')" title="Modifier" aria-label="Modifier"><span aria-hidden="true">&#9998;</span></button>
        <button class="btn btn-danger btn-sm contract-icon-btn" onclick="deleteContract('${contract.id}')" title="Supprimer" aria-label="Supprimer"><span aria-hidden="true">&times;</span></button>
      </div>
    </div>`;
  }).join('') + '</div>';
}

function initContractForm() {
  const today = todayStr();
  const year = today.slice(0, 4);
  document.getElementById('contract-edit-id').value = '';
  document.getElementById('contract-form-title').innerHTML = 'Nouveau <span>Contrat</span>';
  document.getElementById('contract-date').value = today;
  document.getElementById('contract-ref').value = nextContractRef(year);
  document.getElementById('contract-client-name').value = '';
  document.getElementById('contract-details').value = '';
  document.getElementById('contract-amount').value = 0;
  document.getElementById('contract-retention-rate').value = 0;
  document.getElementById('contract-vat-advance-enabled').checked = false;
  document.getElementById('contract-vat-advance-amount').value = 0;
  document.getElementById('contract-status').value = 'pending';
  document.getElementById('contract-payment-mode').value = 'Virement bancaire';
  fillContractClientSelect();
  document.getElementById('contract-client-select').value = '';
  toggleContractVatAdvance();
}

function saveContract() {
  const editId = document.getElementById('contract-edit-id').value;
  const clientName = document.getElementById('contract-client-name').value.trim();
  const date = document.getElementById('contract-date').value;
  if (!clientName || !date) {
    alert('Client et date obligatoires');
    return;
  }
  const contract = {
    id: editId || 'contract_' + Date.now(),
    ref: document.getElementById('contract-ref').value.trim() || nextContractRef(String(date).slice(0, 4)),
    date,
    clientId: document.getElementById('contract-client-select').value,
    clientName,
    details: document.getElementById('contract-details').value,
    amount: num(document.getElementById('contract-amount').value),
    retentionRate: num(document.getElementById('contract-retention-rate').value),
    vatAdvanceEnabled: !!document.getElementById('contract-vat-advance-enabled')?.checked,
    vatAdvanceAmount: num(document.getElementById('contract-vat-advance-amount')?.value),
    status: document.getElementById('contract-status').value,
    paymentMode: 'Virement bancaire'
  };
  let contracts = STORE.contracts();
  contracts = contracts.some(item => item.id === contract.id) ? contracts.map(item => item.id === contract.id ? contract : item) : contracts.concat(contract);
  STORE.saveContracts(contracts);

  const clients = STORE.clients();
  if (!clients.some(client => client.name === clientName || client.contact === clientName)) {
    STORE.saveClients(clients.concat({ id: 'client_' + Date.now(), name: clientName, contact: '', addr: '', mf: '', tel: '' }));
  }

  showView('contracts');
}

function editContract(id) {
  const contract = STORE.contracts().find(item => item.id === id);
  if (!contract) return;
  showView('contract-form');
  document.getElementById('contract-edit-id').value = contract.id;
  document.getElementById('contract-form-title').innerHTML = 'Modifier <span>Contrat</span>';
  fillContractClientSelect();
  document.getElementById('contract-date').value = contract.date || todayStr();
  document.getElementById('contract-ref').value = contract.ref || '';
  document.getElementById('contract-client-select').value = contract.clientId || '';
  document.getElementById('contract-client-name').value = contract.clientName || '';
  document.getElementById('contract-details').value = contract.details || '';
  document.getElementById('contract-amount').value = contract.amount || 0;
  document.getElementById('contract-retention-rate').value = contract.retentionRate || 0;
  document.getElementById('contract-vat-advance-enabled').checked = !!contract.vatAdvanceEnabled;
  document.getElementById('contract-vat-advance-amount').value = contract.vatAdvanceAmount || 0;
  document.getElementById('contract-status').value = contract.status || 'pending';
  document.getElementById('contract-payment-mode').value = 'Virement bancaire';
  toggleContractVatAdvance();
}

function deleteContract(id) {
  if (!confirm('Supprimer ce contrat ?')) return;
  STORE.saveContracts(STORE.contracts().filter(contract => contract.id !== id));
  renderContracts();
  updateSidebarStats();
}

function cancelContractForm() {
  showView('contracts');
}