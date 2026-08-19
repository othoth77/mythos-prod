// Mythos OS shared bank entries CRUD and page workflow.

let comptaBankFilterType = 'all'; // 'all', 'retrait', 'alimentation'
let comptaBankFilterStatus = 'all'; // 'all', 'linked', 'unlinked'
let comptaBankFilterMinAmount = 0;
let comptaBankFilterMaxAmount = Infinity;
let comptaBankFilterReference = ''; // search by reference

function cleanupBankEntryTypes() {
  // Fix any bank entries that have dates in the type field
  const entries = STORE.bankEntries();
  let hasChanges = false;
  let fixCount = 0;

  entries.forEach(entry => {
    // Check if type is a date (multiple formats: YYYY-MM-DD, DD-MM-YYYY, YYYY/MM/DD, etc.)
    const typeStr = (entry.type || '').toString().trim();
    if (typeStr && (/^\d{1,4}[-\/]\d{1,2}[-\/]\d{1,4}$/.test(typeStr) || /^\d{4}-\d{2}-\d{2}$/.test(typeStr))) {
      console.warn(`Cleaning bad type: "${typeStr}" -> "Opération"`);
      entry.type = 'Opération';
      hasChanges = true;
      fixCount++;
    }
  });

  if (hasChanges) {
    STORE.saveBankEntries(entries);
    console.log(`✓ Bank entry types cleaned up - fixed ${fixCount} entries`);
    renderBankPage();
  } else {
    console.log('ℹ️ No bad bank entry types found');
  }
}

// Make cleanup available globally for manual use
window.fixBankTypes = function() {
  console.log('🔧 Running manual cleanup...');
  cleanupBankEntryTypes();
  console.log('✓ Cleanup complete! Page has been refreshed.');
};

function getBankTypeIcon(type) {
  // Fix bad types (dates) on the fly
  if (type && /^\d{1,4}[-\/]\d{1,2}[-\/]\d{1,4}$/.test(type.toString().trim())) {
    type = 'Opération';
  }

  const iconMap = {
    'Opérations monétiques': '💳',
    'Versements': '📥',
    'Commissions': '⚙️',
    'Prélèvements': '📤',
    'Virements': '🔄',
    'Retraits': '💰',
    'Dépôts': '🏦',
    'Intérêts': '📈'
  };
  return iconMap[type] || '📋';
}


function openBankDetailModal(bankEntryId) {
  const entry = STORE.bankEntries().find(b => b.id === bankEntryId);
  if (!entry) return;

  const linked = entry.linkedId ? STORE.expenses().find(e => e.id === entry.linkedId) || STORE.invoices().find(i => i.id === entry.linkedId) || STORE.contracts().find(c => c.id === entry.linkedId) || STORE.suppliers().find(s => s.id === entry.linkedId) : null;
  const linkedText = entry.linkedId && entry.linkedType === 'expense' ? '✓ Dépense' : entry.linkedId && entry.linkedType === 'invoice' ? '✓ Facture' : entry.linkedId && entry.linkedType === 'supplier' ? '✓ Fournisseur' : '⚠️ Non lié';
  const linkedColor = entry.linkedId ? '#4cc964' : '#ff9800';
  const bankLinkedText = entry.linkedId && entry.linkedType === 'expense' ? '✓ Dépense' : entry.linkedId && entry.linkedType === 'invoice' ? '✓ Facture' : entry.linkedId && entry.linkedType === 'contract' ? '✓ Contrat' : entry.linkedId && entry.linkedType === 'supplier' ? '✓ Fournisseur' : '⚠️ Non lié';
  const linkedName = linked ? (
    entry.linkedType === 'invoice'
      ? `${linked.num || 'Sans numerotation'} - ${linked.clientName || linked.name || 'Client non defini'}`
      : entry.linkedType === 'contract'
        ? `${linked.ref || 'Contrat'} - ${linked.clientName || linked.name || 'Client non defini'}`
        : (linked.ref || linked.num || linked.label || linked.name || linked.clientName || 'N/A')
  ) : '';

  const modal = document.getElementById('bank-detail-modal');
  if (!modal) return;

  modal.innerHTML = `
    <div class="modal-overlay" onclick="closeBankDetailModal()" style="position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.7); display:flex; align-items:center; justify-content:center; z-index:1000;">
      <div onclick="event.stopPropagation()" style="background:#0e0e0e; border:2px solid #D9A441; border-radius:16px; padding:32px; max-width:600px; width:90%; max-height:80vh; overflow-y:auto;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:24px;">
          <h2 style="color:#D9A441; font-family: 'Archivo Expanded', sans-serif; font-size:24px; margin:0;">📋 Détails de la Transaction</h2>
          <button onclick="closeBankDetailModal()" style="background:none; border:none; color:#D9A441; font-size:24px; cursor:pointer;">✕</button>
        </div>

        <div style="background:#1a1a1a; padding:20px; border-radius:12px; margin-bottom:20px;">
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:16px;">
            <div>
              <div style="color:#999; font-size:11px; text-transform:uppercase; font-weight:700; margin-bottom:5px;">Date</div>
              <div style="color:#D9A441; font-size:14px;">${esc((entry.date || '').slice(5))}</div>
            </div>
            <div>
              <div style="color:#999; font-size:11px; text-transform:uppercase; font-weight:700; margin-bottom:5px;">Type</div>
              <div style="color:#D9A441; font-size:14px;"><span style="font-size:16px; margin-right:4px;">${getBankTypeIcon(entry.type)}</span>${esc(entry.type || '')}</div>
            </div>
            <div>
              <div style="color:#999; font-size:11px; text-transform:uppercase; font-weight:700; margin-bottom:5px;">Montant</div>
              <div style="color:#D9A441; font-size:14px; font-weight:700;">${fmtMoney(entry.amount)}</div>
            </div>
            <div>
              <div style="color:#999; font-size:11px; text-transform:uppercase; font-weight:700; margin-bottom:5px;">Direction</div>
              <div style="color:#D9A441; font-size:14px;">${entry.direction || 'N/A'}</div>
            </div>
            <div>
              <div style="color:#999; font-size:11px; text-transform:uppercase; font-weight:700; margin-bottom:5px;">Référence</div>
              <div style="color:#D9A441; font-size:14px; font-family:monospace;">${esc(entry.reference || entry.id || 'N/A')}</div>
            </div>
          </div>

          <div style="margin-top:16px; padding-top:16px; border-top:1px solid #333;">
            <div style="color:#999; font-size:11px; text-transform:uppercase; font-weight:700; margin-bottom:8px;">Libellé Complet</div>
            <div style="color:#ddd; font-size:13px; line-height:1.6; padding:12px; background:#0a0a0a; border-radius:8px; border-left:3px solid #D9A441;">
              ${esc(entry.label || '---')}
            </div>
          </div>

          <div style="margin-top:16px; padding-top:16px; border-top:1px solid #333;">
            <div style="color:#999; font-size:11px; text-transform:uppercase; font-weight:700; margin-bottom:8px;">Statut de Liaison</div>
            <div style="color:${linkedColor}; font-size:14px; font-weight:700;">${bankLinkedText}</div>
            ${linked ? `<div style="color:#999; font-size:12px; margin-top:8px;">Lié à: ${esc(linkedName)}</div>` : ''}
          </div>
        </div>

        <div style="display:flex; gap:12px; justify-content:flex-end;">
          <button class="btn btn-outline" onclick="closeBankDetailModal()" style="margin:0;">Fermer</button>
          <button class="btn btn-outline" onclick="closeBankDetailModal(); openBankLinkModal('${entry.id}')" style="margin:0;">Lier</button>
        </div>
      </div>
    </div>
  `;
  modal.style.display = 'flex';
}

function closeBankDetailModal() {
  const modal = document.getElementById('bank-detail-modal');
  if (modal) modal.style.display = 'none';
}

function openBankLinkModal(bankEntryId) {
  const modal = document.getElementById('bank-link-modal');
  if (!modal) { alert('❌ Erreur: Le modal de liaison est introuvable!'); return; }

  const entry = STORE.bankEntries().find(b => b.id === bankEntryId);
  if (!entry) { alert('❌ Erreur: Cette transaction n\'existe pas!'); return; }

  const expenses = STORE.expenses();
  const invoices = STORE.invoices();
  const contracts = STORE.contracts();
  const suppliers = STORE.suppliers();
  const isRetrait = entry.direction === 'Debit';

  // Vérifier s'il y a des données à lier
  if (expenses.length === 0 && invoices.length === 0 && contracts.length === 0 && suppliers.length === 0) {
    alert('⚠️ Aucune dépense, facture ou fournisseur à lier!\n\nCréez d\'abord:\n• Des dépenses (via "Dépenses par période")\n• Ou des factures (via "Factures")\n• Ou des fournisseurs (via "Fournisseurs")');
    return;
  }

  document.getElementById('bank-link-id').value = bankEntryId;

  const expenseSelect = document.getElementById('bank-link-expense');
  const invoiceSelect = document.getElementById('bank-link-invoice');
  const contractSelect = document.getElementById('bank-link-contract');
  const supplierSelect = document.getElementById('bank-link-supplier');
  const titleEl = document.getElementById('bank-link-title');
  const hintEl = document.getElementById('bank-link-hint');
  if (contractSelect) {
    const contractLabel = contractSelect.previousElementSibling;
    const contractHint = contractSelect.nextElementSibling;
    const nextSeparator = contractSelect.closest('div[style*="rgba(217,164,65"]')?.nextElementSibling;
    if (contractLabel) contractLabel.textContent = '✎ Lier a un Contrat (Alimentation de compte)';
    if (contractHint) contractHint.textContent = "Paiement recu dans le cadre d'un contrat";
    if (nextSeparator) nextSeparator.innerHTML = '&mdash; OU &mdash;';
  }

  // Déterminer le titre et l'indice selon le type de transaction
  if (titleEl) {
    titleEl.textContent = isRetrait ? '🔴 Lier à une Dépense (Retrait de compte)' : '🟢 Lier à une Facture (Alimentation de compte)';
  }
  if (hintEl) {
    hintEl.textContent = isRetrait ? 'Cette transaction représente un retrait de compte. Associez-la à une dépense.' : 'Cette transaction représente une alimentation de compte. Associez-la à une facture ou revenu.';
  }

  // Construire les options avec disabled si vides
  let expenseHTML = '<option value="">-- Aucune dépense --</option>';
  if (expenses.length > 0) {
    expenseHTML += expenses.map(e => `<option value="${e.id}" ${entry.linkedType === 'expense' && entry.linkedId === e.id ? 'selected' : ''}>${esc(e.label)} - ${fmtMoney(e.amount)}</option>`).join('');
  } else {
    expenseHTML += '<option value="" disabled style="color:var(--muted);">Aucune dépense créée</option>';
  }

  let invoiceHTML = '<option value="">-- Aucune facture --</option>';
  if (invoices.length > 0) {
    invoiceHTML += invoices.map(i => `<option value="${i.id}" ${entry.linkedType === 'invoice' && entry.linkedId === i.id ? 'selected' : ''}>${esc(i.num || 'Sans numerotation')} - ${esc(i.clientName || 'Client non defini')} - ${fmtMoney(getInvoiceTotal(i))}</option>`).join('');
  } else {
    invoiceHTML += '<option value="" disabled style="color:var(--muted);">Aucune facture créée</option>';
  }

  let contractHTML = '<option value="">-- Aucun contrat --</option>';
  if (contracts.length > 0) {
    contractHTML += contracts.map(c => {
      const totals = contractTotals(c);
      const ref = c.ref || 'Contrat';
      const client = c.clientName || 'Client non defini';
      return `<option value="${c.id}" ${entry.linkedType === 'contract' && entry.linkedId === c.id ? 'selected' : ''}>${esc(ref)} - ${esc(client)} - ${fmtMoney(totals.net)}</option>`;
    }).join('');
  } else {
    contractHTML += '<option value="" disabled style="color:var(--muted);">Aucun contrat crÃ©Ã©</option>';
  }

  contractHTML = contractHTML.replace(/Aucun contrat cr[^<]*/, 'Aucun contrat cree');

  let supplierHTML = '<option value="">-- Aucun fournisseur --</option>';
  if (suppliers.length > 0) {
    supplierHTML += suppliers.map(s => `<option value="${s.id}" ${entry.linkedSupplierId === s.id ? 'selected' : ''}>${esc(s.name)} ${s.contact ? '(' + esc(s.contact) + ')' : ''}</option>`).join('');
  } else {
    supplierHTML += '<option value="" disabled style="color:var(--muted);">Aucun fournisseur créé</option>';
  }

  expenseSelect.innerHTML = expenseHTML;
  invoiceSelect.innerHTML = invoiceHTML;
  if (contractSelect) contractSelect.innerHTML = contractHTML;
  supplierSelect.innerHTML = supplierHTML;

  modal.style.display = 'flex';
}

function closeBankLinkModal() {
  const modal = document.getElementById('bank-link-modal');
  if (modal) modal.style.display = 'none';
}

function saveBankLink() {
  const bankEntryId = document.getElementById('bank-link-id').value;
  const expenseId = document.getElementById('bank-link-expense').value;
  const invoiceId = document.getElementById('bank-link-invoice').value;
  const contractId = document.getElementById('bank-link-contract')?.value || '';
  const supplierId = document.getElementById('bank-link-supplier').value;

  const bankEntries = STORE.bankEntries();
  const entry = bankEntries.find(b => b.id === bankEntryId);

  if (!entry) return;

  // Vérifier la combinaison valide de liaisons
  const hasDirect = expenseId || invoiceId || contractId;
  const hasSupplier = supplierId;

  // On ne peut pas lier une dépense + facture en même temps
  if ([expenseId, invoiceId, contractId].filter(Boolean).length > 1) {
    alert('Veuillez choisir soit une dépense, soit une facture, soit un contrat!');
    return;
  }

  // On peut lier (dépense OU facture) ET un fournisseur en même temps
  if (!hasDirect && !hasSupplier) {
    entry.linkedType = null;
    entry.linkedId = null;
    entry.linkedSupplierId = null;
  } else {
    // Définir le type principal (dépense ou facture)
    if (expenseId) {
      entry.linkedType = 'expense';
      entry.linkedId = expenseId;
    } else if (invoiceId) {
      entry.linkedType = 'invoice';
      entry.linkedId = invoiceId;
    } else if (contractId) {
      entry.linkedType = 'contract';
      entry.linkedId = contractId;
    } else {
      entry.linkedType = null;
      entry.linkedId = null;
    }

    // Ajouter la liaison fournisseur (optionnelle, indépendante)
    entry.linkedSupplierId = supplierId || null;
  }

  STORE.saveBankEntries(bankEntries);
  closeBankLinkModal();
  renderBankPage();
}

function unlinkBankEntry(bankEntryId) {
  if (!confirm('Délier cette transaction?')) return;

  const bankEntries = STORE.bankEntries();
  const entry = bankEntries.find(b => b.id === bankEntryId);

  if (entry) {
    entry.linkedType = null;
    entry.linkedId = null;
    entry.linkedSupplierId = null;
    STORE.saveBankEntries(bankEntries);
    renderBankPage();
  }
}

function getBankSelectedIds() {
  const checkboxes = document.querySelectorAll('input[name="bank-select"]:checked');
  return Array.from(checkboxes).map(cb => cb.value);
}

function toggleBankSelectAll(checked) {
  document.querySelectorAll('input[name="bank-select"]').forEach(cb => cb.checked = checked);
}

function deleteBankSelected() {
  const ids = getBankSelectedIds();
  if (ids.length === 0) { alert('Aucune ligne selectionnée'); return; }
  if (!confirm(`Supprimer ${ids.length} ligne(s) ?`)) return;
  const remaining = STORE.bankEntries().filter(b => !ids.includes(b.id));
  STORE.saveBankEntries(remaining);
  renderBankPage();
}

function renderBankPage() {
  const el = document.getElementById('compta-bank-page');
  if (!el) return;
  let items = STORE.bankEntries();

  // Fix any bad types inline (dates in type field)
  items.forEach(item => {
    if (item.type && /^\d{1,4}[-\/]\d{1,2}[-\/]\d{1,4}$/.test(item.type.toString().trim())) {
      item.type = 'Opération';
    }
  });

  // Save the fixed items back to storage
  if (items.some(b => b.type === 'Opération' && /^\d/.test(b.type))) {
    STORE.saveBankEntries(items);
  }

  if (!items.length) { el.innerHTML = '<div class="empty-state">Aucune donnee.</div>'; return; }

  // Appliquer les filtres
  items = items.filter(b => {
    // Filtre type (retrait/alimentation)
    if (comptaBankFilterType === 'retrait' && b.direction !== 'Debit') return false;
    if (comptaBankFilterType === 'alimentation' && b.direction !== 'Credit') return false;

    // Filtre statut (lié/non lié)
    if (comptaBankFilterStatus === 'linked' && !b.linkedId) return false;
    if (comptaBankFilterStatus === 'unlinked' && b.linkedId) return false;

    // Filtre montant
    const amount = Math.abs(num(b.amount));
    if (amount < comptaBankFilterMinAmount || amount > comptaBankFilterMaxAmount) return false;

    // Filtre référence - Cherche dans tous les champs
    if (comptaBankFilterReference) {
      const searchTerm = comptaBankFilterReference.toLowerCase();
      const reference = (b.reference || b.id || '').toLowerCase();
      const label = (b.label || '').toLowerCase();
      const type = (b.type || '').toLowerCase();
      const amount = b.amount.toString();

      if (!reference.includes(searchTerm) &&
          !label.includes(searchTerm) &&
          !type.includes(searchTerm) &&
          !amount.includes(searchTerm)) {
        return false;
      }
    }

    return true;
  });

  let html = '';

  // Barre de filtrage
  html += `<div style="padding:16px; background:linear-gradient(135deg, rgba(217,164,65,0.08), rgba(217,164,65,0.04)); border:1px solid rgba(217,164,65,0.15); border-radius:12px; margin-bottom:16px;">
    <div style="color:var(--gold); font-weight:700; margin-bottom:12px; font-size:13px;">🔍 FILTRER LES TRANSACTIONS</div>
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:12px;">
      <div>
        <label style="color:var(--muted); font-size:11px; font-weight:700; margin-bottom:4px; display:block;">Type</label>
        <select id="bank-filter-type" onchange="setComptaBankFilterType(this.value)" style="width:100%; padding:6px; background:#1a1a1a; color:#D9A441; border:1px solid #333; border-radius:6px;">
          <option value="all">📋 Tous</option>
          <option value="retrait" ${comptaBankFilterType === 'retrait' ? 'selected' : ''}>🔴 Retraits</option>
          <option value="alimentation" ${comptaBankFilterType === 'alimentation' ? 'selected' : ''}>🟢 Alimentations</option>
        </select>
      </div>

      <div>
        <label style="color:var(--muted); font-size:11px; font-weight:700; margin-bottom:4px; display:block;">Statut</label>
        <select id="bank-filter-status" onchange="setComptaBankFilterStatus(this.value)" style="width:100%; padding:6px; background:#1a1a1a; color:#D9A441; border:1px solid #333; border-radius:6px;">
          <option value="all">📊 Tous</option>
          <option value="linked" ${comptaBankFilterStatus === 'linked' ? 'selected' : ''}>✓ Liés</option>
          <option value="unlinked" ${comptaBankFilterStatus === 'unlinked' ? 'selected' : ''}>⚠️ Non liés</option>
        </select>
      </div>

      <div>
        <label style="color:var(--muted); font-size:11px; font-weight:700; margin-bottom:4px; display:block;">Montant Min</label>
        <input type="number" id="bank-filter-min" value="${comptaBankFilterMinAmount === 0 ? '' : comptaBankFilterMinAmount}" placeholder="0" onchange="setComptaBankFilterAmount()" style="width:100%; padding:6px; background:#1a1a1a; color:#D9A441; border:1px solid #333; border-radius:6px;">
      </div>

      <div>
        <label style="color:var(--muted); font-size:11px; font-weight:700; margin-bottom:4px; display:block;">Montant Max</label>
        <input type="number" id="bank-filter-max" value="${comptaBankFilterMaxAmount === Infinity ? '' : comptaBankFilterMaxAmount}" placeholder="∞" onchange="setComptaBankFilterAmount()" style="width:100%; padding:6px; background:#1a1a1a; color:#D9A441; border:1px solid #333; border-radius:6px;">
      </div>

      <div>
        <label style="color:var(--muted); font-size:11px; font-weight:700; margin-bottom:4px; display:block;">Recherche globale</label>
        <input type="text" id="bank-filter-reference" value="${esc(comptaBankFilterReference)}" placeholder="Ref, Libellé, Type, Montant..." onchange="setComptaBankFilterReference(this.value)" style="width:100%; padding:6px; background:#1a1a1a; color:#D9A441; border:1px solid #333; border-radius:6px;">
      </div>

      <div style="display:flex; align-items:flex-end;">
        <button class="btn btn-outline btn-sm" onclick="resetComptaBankFilters()" style="width:100%;">🔄 Réinitialiser</button>
      </div>
    </div>
    <div style="color:var(--muted); font-size:12px; margin-top:8px;">📌 ${items.length} transaction(s) affichée(s)</div>
  </div>`;

  if (STORE.bankEntries().length > 0) {
    html += '<div style="margin-bottom:12px;"><button class="btn btn-danger btn-sm" onclick="deleteBankSelected()" title="Supprimer les éléments sélectionnés">✕ Supprimer</button></div>';
  }

  html += '<div style="width:100%; overflow-x:auto; -webkit-overflow-scrolling:touch; border-radius:12px;">' +
    '<table class="expenses-list-table" style="width:100%; table-layout:fixed; min-width:1200px;">' +
    '<thead><tr style="background:#1a1a1a;"><th style="width:3%;text-align:center;padding:6px 8px;"><input type="checkbox" onchange="toggleBankSelectAll(this.checked)" style="cursor:pointer;"></th><th style="width:23%;text-align:center;padding:6px 8px;">Statut & Actions</th><th style="width:5%;padding:6px 8px;">Date</th><th style="width:16%;padding:6px 8px;">Type</th><th style="width:9%;text-align:right;padding:6px 8px;">Montant</th><th style="width:44%;padding:6px 8px;">Lié à</th></tr></thead>' +
    '<tbody>' + items.map(b => {
      // Déterminer le statut de liaison détaillé
      let linked = '⚠️ Non lié';
      let linkedStyle = 'color:#ff9800;';

      if (b.linkedId || b.linkedSupplierId) {
        linkedStyle = 'color:#4cc964;';
        let parts = [];

        if (b.linkedId && b.linkedType === 'expense') {
          parts.push('Dépense');
        } else if (b.linkedId && b.linkedType === 'invoice') {
          parts.push('Facture');
        } else if (b.linkedId && b.linkedType === 'contract') {
          parts.push('Contrat');
        }

        if (b.linkedSupplierId) {
          parts.push('Fournisseur');
        }

        linked = parts.length > 0 ? `✓ ${parts.join(' + ')}` : '✓ Lié';
      }

      const actions = (b.linkedId || b.linkedSupplierId) ?
        `<span style="${linkedStyle}font-weight:700;">${linked}</span> <button class="btn btn-outline btn-xs" onclick="openBankLinkModal('${b.id}')" style="margin:0 2px;">Changer</button> <button class="btn btn-outline btn-xs" onclick="unlinkBankEntry('${b.id}')">Délier</button>` :
        `<span style="${linkedStyle}font-weight:700;">${linked}</span> <button class="btn btn-outline btn-xs" onclick="openBankLinkModal('${b.id}')">Lier</button>`;

      let linkedText = '---';
      let linkedParts = [];

      // Liaison principale (dépense ou facture)
      if (b.linkedId) {
        let linkedItem;
        let type;

        if (b.linkedType === 'expense') {
          linkedItem = STORE.expenses().find(e => e.id === b.linkedId);
          type = 'Dépense';
        } else if (b.linkedType === 'invoice') {
          linkedItem = STORE.invoices().find(i => i.id === b.linkedId);
          type = 'Facture';
        } else if (b.linkedType === 'contract') {
          linkedItem = STORE.contracts().find(c => c.id === b.linkedId);
          type = 'Contrat';
        }

        if (linkedItem) {
          const category = linkedItem.category || '';
          let label = linkedItem.label || linkedItem.description || '';
          if (b.linkedType === 'invoice') {
            label = `${linkedItem.num || 'Sans numerotation'} - ${linkedItem.clientName || linkedItem.name || 'Client non defini'}`;
          } else if (b.linkedType === 'contract') {
            label = `${linkedItem.ref || 'Contrat'} - ${linkedItem.clientName || linkedItem.name || 'Client non defini'}`;
          }
          linkedParts.push(`${type}${category ? ' - ' + esc(category) : ''}${label ? ' : ' + esc(label) : ''}`);
        }
      }

      // Liaison fournisseur (optionnelle, peut être avec la précédente)
      if (b.linkedSupplierId) {
        const supplier = STORE.suppliers().find(s => s.id === b.linkedSupplierId);
        if (supplier) {
          const name = supplier.name || supplier.nom || '';
          linkedParts.push(`👥 ${esc(name)}`);
        }
      }

      if (linkedParts.length > 0) {
        linkedText = linkedParts.join(' + ');
      }

      const isRetrait = b.direction === 'Debit';
      const rowBgColor = isRetrait ? 'rgba(255,100,100,0.05)' : 'rgba(76,201,100,0.05)';
      const borderColor = isRetrait ? '#ff6464' : '#4cc964';

      return `<tr class="compta-detail-row ${b.direction === 'Debit' ? 'bank-entry-debit' : 'bank-entry-credit'}" style="border-bottom:1px solid #333; border-left:4px solid ${borderColor}; background:${rowBgColor}; cursor:pointer;" onclick="openBankDetailModal('${b.id}')">` +
        `<td style="text-align:center;padding:6px 8px;" onclick="event.stopPropagation();"><input type="checkbox" name="bank-select" value="${b.id}"></td>` +
        `<td style="text-align:center;padding:6px 8px;white-space:nowrap;font-size:12px;" onclick="event.stopPropagation();">${actions}</td>` +
        `<td style="padding:6px 8px;white-space:nowrap;">${esc((b.date || '').slice(5))}</td>` +
        `<td style="padding:6px 8px;"><span style="font-size:16px;margin-right:4px;">${getBankTypeIcon(b.type)}</span>${esc(b.type || '')}</td>` +
        `<td style="text-align:right;padding:6px 8px;white-space:nowrap;color:${borderColor};font-weight:600;">${fmtMoney(b.amount)}</td>` +
        `<td style="padding:6px 8px;font-size:12px;color:#999;">${linkedText}</td>` +
      `</tr>`;
    }).join('') + '</tbody></table></div>';

  el.innerHTML = html;
}

function setComptaBankFilterType(value) { comptaBankFilterType = value; renderBankPage(); }
function setComptaBankFilterStatus(value) { comptaBankFilterStatus = value; renderBankPage(); }
function setComptaBankFilterAmount() {
  const minEl = document.getElementById('bank-filter-min');
  const maxEl = document.getElementById('bank-filter-max');
  comptaBankFilterMinAmount = minEl?.value ? num(minEl.value) : 0;
  comptaBankFilterMaxAmount = maxEl?.value ? num(maxEl.value) : Infinity;
  renderBankPage();
}
function setComptaBankFilterReference(value) {
  comptaBankFilterReference = value;
  renderBankPage();
}
function resetComptaBankFilters() {
  comptaBankFilterType = 'all';
  comptaBankFilterStatus = 'all';
  comptaBankFilterReference = '';
  comptaBankFilterMinAmount = 0;
  comptaBankFilterMaxAmount = Infinity;
  const typeEl = document.getElementById('bank-filter-type');
  const statusEl = document.getElementById('bank-filter-status');
  const minEl = document.getElementById('bank-filter-min');
  const maxEl = document.getElementById('bank-filter-max');
  if (typeEl) typeEl.value = 'all';
  if (statusEl) statusEl.value = 'all';
  if (minEl) minEl.value = '';
  if (maxEl) maxEl.value = '';
  renderBankPage();
}

function openBankModal(id = '') {
  fillModalFields('bank', STORE.bankEntries().find(x => x.id === id), ['date','type','label','amount','balance']);
  document.getElementById('bank-date').value ||= todayStr();
  document.getElementById('bank-modal').style.display = 'flex';
}
function closeBankModal() { document.getElementById('bank-modal').style.display = 'none'; }
function saveBankEntry() { saveModalEntity('bank', STORE.bankEntries, STORE.saveBankEntries, ['date','type','label','amount','balance'], renderBankPage, closeBankModal); renderComptaViews(); }
function deleteBankEntry(id) { if (confirm('Supprimer cette ligne bancaire ?')) { STORE.saveBankEntries(STORE.bankEntries().filter(x => x.id !== id)); renderBankPage(); } }

// Cash (Caisse) functions

function importBankFile(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const csv = e.target.result;
      const lines = csv.split('\n').filter(l => l.trim());
      if (lines.length < 2) { alert('Fichier vide'); return; }

      const header = lines[0].split(',').map(c => c.trim().toLowerCase());
      const dataLines = lines.slice(1);

      // Détecter les colonnes flexiblement - avec positions par défaut pour BIAT
      const findCol = (names, defaultPos = -1) => {
        const idx = header.findIndex(h => names.some(n => h.includes(n.toLowerCase())));
        return idx >= 0 ? idx : defaultPos;
      };

      // Pour BIAT: cols[5]=Montant, cols[6]=Débit/Crédit, cols[7]=Date, cols[8]=Type, cols[14]=Description
      const dateCol = findCol(['date', 'jour', 'date opération'], 7);
      const amountCol = findCol(['montant', 'amount', 'sum', 'total'], 5);
      const directionCol = findCol(['débit/crédit', 'direction', 'type de mouvement', 'sens'], 6);
      const typeCol = findCol(['type opération', 'type', 'libellé type'], 8);
      const labelCol = findCol(['description', 'libellé', 'label', 'libellé opération'], 14);

      const entries = dataLines.map((line, idx) => {
        const cols = line.split(',').map(c => c.trim());

        const date = dateCol >= 0 ? cols[dateCol] : '';
        const amount = amountCol >= 0 ? parseFloat(cols[amountCol]) : 0;
        const direction = directionCol >= 0 ? cols[directionCol] : 'Debit';
        let type = typeCol >= 0 ? cols[typeCol] : 'Opération';
        const label = labelCol >= 0 ? cols[labelCol] : 'Opération bancaire';

        if (!date || !amount || isNaN(amount)) return null;

        // Valider que le type n'est pas une date (format YYYY-MM-DD ou DD-MM-YYYY)
        if (type && /^\d{1,4}[-\/]\d{1,2}[-\/]\d{1,4}$/.test(type.trim())) {
          type = 'Opération';
        }

        return {
          id: 'bank-' + Date.now() + '-' + idx,
          date: date,
          type: type || 'Opération',
          label: label || 'Opération bancaire',
          amount: Math.abs(amount),
          balance: 0,
          direction: (direction.toUpperCase().includes('DEBIT') || direction.toUpperCase().includes('RETRAIT')) ? 'Debit' : 'Credit'
        };
      }).filter(e => e);

      if (entries.length === 0) {
        alert('❌ Aucune entrée valide trouvée.\n\nVérifie que le CSV contient:\n- Date\n- Montant\n- Direction (Débit/Crédit)');
        return;
      }

      // Éviter les doublons
      const existing = STORE.bankEntries();
      const importedEntries = [];
      const duplicateEntries = [];

      entries.forEach(entry => {
        const isDuplicate = existing.some(e =>
          e.date === entry.date &&
          Math.abs(e.amount - entry.amount) < 0.01 &&
          e.label === entry.label
        );
        if (isDuplicate) {
          duplicateEntries.push(entry);
        } else {
          importedEntries.push(entry);
        }
      });

      // Si aucune nouvelle entrée mais des doublons détectés - forcer l'ajout des entrées
      if (importedEntries.length === 0 && duplicateEntries.length > 0) {
        console.warn('Tous les entrées sont détectées comme doublons. Ajout forcé...');
        // Ajouter avec vérification moins stricte - par montant et date uniquement
        duplicateEntries.forEach(entry => {
          const isDuplicate = existing.some(e =>
            e.date === entry.date &&
            Math.abs(e.amount - entry.amount) < 0.01
          );
          if (!isDuplicate) {
            importedEntries.push(entry);
          }
        });
        // Mettre à jour les doublons
        duplicateEntries.splice(0, duplicateEntries.length, ...duplicateEntries.filter(entry => {
          return existing.some(e =>
            e.date === entry.date &&
            Math.abs(e.amount - entry.amount) < 0.01
          );
        }));
      }

      if (importedEntries.length > 0) {
        STORE.saveBankEntries([...existing, ...importedEntries]);
        renderBankPage();
        renderComptaViews();
      }

      // Afficher le modal des résultats d'import
      displayImportResults(importedEntries, duplicateEntries);
      event.target.value = '';
    } catch (err) {
      alert('❌ Erreur lors de l\'import: ' + err.message);
      console.error(err);
    }
  };
  reader.readAsText(file);
}

function displayImportResults(imported, duplicates) {
  const modal = document.getElementById('import-results-modal');

  // État global du filtre pour cette modale
  let currentFilterMode = 'imported'; // 'imported' ou 'duplicates'
  let currentSearchTerm = '';

  const renderResults = () => {
    const data = currentFilterMode === 'imported' ? imported : duplicates;
    const filtered = data.filter(entry => {
      const search = currentSearchTerm.toLowerCase();
      return entry.date.toLowerCase().includes(search) ||
             entry.label.toLowerCase().includes(search) ||
             entry.type.toLowerCase().includes(search) ||
             entry.amount.toString().includes(search);
    });

    const rows = filtered.map(entry => `
      <tr style="border-bottom:1px solid rgba(217,164,65,0.1);">
        <td style="padding:12px 8px; color:var(--text); font-size:13px;">${esc(entry.date)}</td>
        <td style="padding:12px 8px; color:var(--text); font-size:13px;">${esc(entry.label)}</td>
        <td style="padding:12px 8px; color:var(--text); font-size:13px;">${esc(entry.type)}</td>
        <td style="padding:12px 8px; text-align:right; font-weight:700; color:${entry.direction === 'Debit' ? '#ff6464' : '#4cc964'}; font-size:13px;">
          ${entry.direction === 'Debit' ? '🔴' : '🟢'} ${fmtMoney(entry.amount)}
        </td>
      </tr>
    `).join('');

    const importedStyle = currentFilterMode === 'imported'
      ? 'linear-gradient(135deg, rgba(76,201,100,0.2), rgba(76,201,100,0.1)); border:2px solid rgba(76,201,100,0.5);'
      : 'linear-gradient(135deg, rgba(76,201,100,0.12), rgba(76,201,100,0.06)); border:2px solid rgba(76,201,100,0.3);';

    const duplicatesStyle = currentFilterMode === 'duplicates'
      ? 'linear-gradient(135deg, rgba(255,100,100,0.2), rgba(255,100,100,0.1)); border:2px solid rgba(255,100,100,0.5);'
      : 'linear-gradient(135deg, rgba(255,100,100,0.12), rgba(255,100,100,0.06)); border:2px solid rgba(255,100,100,0.3);';

    modal.innerHTML = `
      <div class="modal-overlay" style="display:flex;">
        <div class="modal" style="width:900px; max-height:80vh; overflow-y:auto;">
          <div class="modal-header">
            <span class="modal-title">📊 Résultats de l'import CSV</span>
            <button class="close-btn" onclick="closeImportResults()">&times;</button>
          </div>

          <div style="padding:24px;">
            <!-- Statistiques - Cartes cliquables -->
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:24px;">
              <div style="background:${importedStyle}; border-radius:12px; padding:16px; cursor:pointer;" onclick="switchImportFilter('imported')">
                <div style="font-size:32px; margin-bottom:8px;">✅</div>
                <div style="color:#4cc964; font-weight:700; font-size:16px; margin-bottom:4px;">${imported.length} importée(s)</div>
                <div style="color:var(--muted); font-size:12px;">Entrées ajoutées</div>
              </div>

              <div style="background:${duplicatesStyle}; border-radius:12px; padding:16px; cursor:pointer;" onclick="switchImportFilter('duplicates')">
                <div style="font-size:32px; margin-bottom:8px;">⏭️</div>
                <div style="color:#ff6464; font-weight:700; font-size:16px; margin-bottom:4px;">${duplicates.length} ignoré(s)</div>
                <div style="color:var(--muted); font-size:12px;">Entrées en doublon</div>
              </div>
            </div>

            <!-- Recherche -->
            <div style="margin-bottom:20px;">
              <input type="text"
                     placeholder="🔍 Chercher par date, libellé, type ou montant..."
                     value="${currentSearchTerm}"
                     onkeyup="updateImportSearch(this.value)"
                     style="width:100%; padding:10px 12px; background:#1a1a1a; border:1px solid rgba(217,164,65,0.3); border-radius:6px; color:var(--text); font-size:13px;">
            </div>

            <!-- Tableau -->
            <table style="width:100%; border-collapse:collapse; margin-bottom:24px;">
              <thead>
                <tr style="background:rgba(217,164,65,0.08); border-bottom:2px solid rgba(217,164,65,0.2);">
                  <th style="padding:12px 8px; text-align:left; color:var(--gold); font-weight:700; font-size:12px;">📅 Date</th>
                  <th style="padding:12px 8px; text-align:left; color:var(--gold); font-weight:700; font-size:12px;">📝 Libellé</th>
                  <th style="padding:12px 8px; text-align:left; color:var(--gold); font-weight:700; font-size:12px;">🏷️ Type</th>
                  <th style="padding:12px 8px; text-align:right; color:var(--gold); font-weight:700; font-size:12px;">💰 Montant</th>
                </tr>
              </thead>
              <tbody>
                ${rows.length > 0 ? rows : `<tr><td colspan="4" style="padding:32px; text-align:center; color:var(--muted);">Aucune entrée à afficher</td></tr>`}
              </tbody>
            </table>
          </div>

          <div style="padding:16px 24px; background:rgba(0,0,0,0.2); border-top:1px solid rgba(217,164,65,0.1); display:flex; justify-content:flex-end; gap:12px;">
            <button class="btn btn-outline" onclick="closeImportResults()">Fermer</button>
          </div>
        </div>
      </div>
    `;
  };

  // Rendre initialement
  renderResults();

  // Afficher le modal
  modal.style.display = 'block';

  // Fonctions globales pour gérer l'interaction
  window.switchImportFilter = (mode) => {
    currentFilterMode = mode;
    renderResults();
  };

  window.updateImportSearch = (term) => {
    currentSearchTerm = term;
    renderResults();
  };
}

function closeImportResults() {
  document.getElementById('import-results-modal').style.display = 'none';
}
