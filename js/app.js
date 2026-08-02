// =====================================================
// MYTHOS PROD - Main Application
// =====================================================

const MYTHOS_LOGO_SRC = 'assets/logos/logomythos.png';
const MYTHOS_PRINT_LOGO_SRC = 'assets/logos/logo-uthina-chess.png';
const SDT_PRINT_LOGO_SRC = 'assets/logos/logo-sdt.png';

// ── Sociétés (utilisées pour les Ordres de Mission multi-société) ──
const SOCIETES = {
  mythos: {
    id: 'mythos',
    nom: 'Mythos Production',
    logo: MYTHOS_PRINT_LOGO_SRC,
    footer: '<strong>Mythos Production</strong><br>04 Rue Habib Thamer, Khelidia 2054, Tunisie | Tel: 98.999.660 / 21.821.921 | Email: ste.mythosprod@gmail.com<br>RC Tunis B01185972014 | Matricule fiscal: 1367868NAM000'
  },
  sdt: {
    id: 'sdt',
    nom: 'Société de distribution tunisienne',
    logo: SDT_PRINT_LOGO_SRC,
    footer: '<strong>Société de distribution tunisienne</strong><br>Montplaisir Bab Bhar Espace Tunis étage 4 appartement 3 | Tel: 98.999.660 / 21.821.921 | Email: ste.distributiontunisienne@gmail.com<br>RC Tunis B01185972014 | Matricule fiscal: 1371317PAM000'
  }
};

// ── Sociétés émettrices disponibles pour les DEVIS (logo + en-tête + pied de page + cachet) ──
const KACEM_PRINT_LOGO_SRC = 'assets/logos/logo-kacem.png';
const DEVIS_SOCIETES = {
  mythos: {
    id: 'mythos',
    nom: 'Mythos Prod',
    logo: MYTHOS_PRINT_LOGO_SRC,
    addrLines: ['04 Rue Habib Thamer', 'Khelidia 2054', 'MF: 1367868NAM000'],
    footer: '<strong>Mythos Production</strong> • 04 Rue Habib Thamer, Khelidia 2054<br>Tél: 98.999.660 / 21.821.921 | Email: ste.mythosprod@gmail.com<br>RC Tunis B01185972014 | MF: 1367868NAM000 | RIB BIAT: 0800 6011 0510 0066 3124',
    stamp: {
      lines: ['Mythos Production', '04 Rue Habib Thamer, Khelidia 2054', 'MF: 1367868NAM000', 'Tel: 98.999.660 - 21.821.921', 'Email: ste.mythosprod@gmail.com'],
      color: '#1e40af'
    }
  },
  kacem: {
    id: 'kacem',
    nom: 'Kacem aluminium',
    logo: KACEM_PRINT_LOGO_SRC,
    addrLines: ['04 Km Route Matar', 'Sfax 3000', 'MF: 136787NAM000'],
    footer: '<strong>Kacem aluminium</strong> • 04 Km Route Matar Sfax 3000<br>Tél: 44.726.393 | Email: ste.Kacemaluminium@gmail.com<br>MF: 136787NAM000 | RIB BIAT: 0800 6011 0510 0068 3124',
    stamp: {
      lines: ['Kacem aluminium', '04 Km Route Matar, Sfax 3000', 'MF: 136787NAM000', 'Tel: 44.726.393', 'Email: ste.Kacemaluminium@gmail.com'],
      color: '#7a3b12'
    }
  }
};


// ── Pending write pipeline → js/core/storage.js ─────────────────────
// _localMeta, _metaUpdate, _pendingKeys (+helpers), _buildPendingBulk,
// _flushPending, _flushPendingBeacon, _pullFromServerNow,
// _autoBackupTimer, _triggerAutoBackup, _pushCollection, _storeSave
// ── Sync engine → js/core/sync.js ─────────────────────────────────────
// _mergeCollections, tombstone helpers (_tombKey, _getDeletedIds,
// _markDeleted, _filterTombstoned), _showSyncIndicator, syncFromServer

const STORE = {
  invoices:          () => _storeGet('mp_invoices', '[]'),
  saveInvoices:      d  => _storeSave('mp_invoices', d),
  devis:             () => _storeGet('mp_devis', '[]'),
  saveDevis:         d  => _storeSave('mp_devis', d),
  contracts:         () => _storeGet('mp_contracts', '[]'),
  saveContracts:     d  => _storeSave('mp_contracts', d),
  clients:           () => _storeGet('mp_clients', '[]'),
  saveClients:       d  => _storeSave('mp_clients', d),
  oms:               () => _storeGet('mp_oms', '[]'),
  saveOms:           d  => _storeSave('mp_oms', d),
  collabs:           () => _storeGet('mp_collabs', '[]'),
  saveCollabs:       d  => _storeSave('mp_collabs', d),
  natures:           () => _storeGet('mp_natures', '[]'),
  saveNatures:       d  => _storeSave('mp_natures', d),
  bankEntries:       () => _storeGet('mp_bank_entries', '[]'),
  saveBankEntries:   d  => _storeSave('mp_bank_entries', d),
  cashEntries:       () => _storeGet('mp_cash_entries', '[]'),
  saveCashEntries:   d  => _storeSave('mp_cash_entries', d),
  suppliers:         () => _storeGet('mp_suppliers', '[]'),
  saveSuppliers:     d  => _storeSave('mp_suppliers', d),
  purchases:         () => _storeGet('mp_purchases', '[]'),
  savePurchases:     d  => _storeSave('mp_purchases', d),
  expenses:          () => _storeGet('mp_expenses', '[]'),
  saveExpenses:      d  => _storeSave('mp_expenses', d),
  expenseCategories: () => _storeGet('mp_expense_categories', '[]'),
  saveExpenseCategories: d => _storeSave('mp_expense_categories', d),
  rendezVous:        () => _storeGet('mp_rendez_vous', '[]'),
  saveRendezVous:    d  => _storeSave('mp_rendez_vous', d),
  rdvs:              () => _storeGet('mp_rdvs', '[]'),
  saveRdvs:          d  => _storeSave('mp_rdvs', d),
  representations:   () => _storeGet('mp_representations', '[]'),
  saveRepresentations: d => _storeSave('mp_representations', d),
  documents:         () => _storeGet('mp_documents', '[]'),
  saveDocuments:     d  => _storeSave('mp_documents', d),
  vehicules:         () => _storeGet('mp_vehicules', '[]'),
  saveVehicules:     d  => _storeSave('mp_vehicules', d),
  repertoireContacts:      () => _storeGet('mp_repertoire_contacts', '[]'),
  saveRepertoireContacts:  d  => _storeSave('mp_repertoire_contacts', d),
  repertoireImports:       () => _storeGet('mp_repertoire_imports', '[]'),
  saveRepertoireImports:   d  => _storeSave('mp_repertoire_imports', d),
  appels:            () => _storeGet('mp_appels', '[]'),
  saveAppels:        d  => _storeSave('mp_appels', d),
  validatedInscriptions:     () => _storeGet('mp_validated_inscriptions', '[]'),
  saveValidatedInscriptions: d  => _storeSave('mp_validated_inscriptions', d),
};

// ── Chargement initial depuis le serveur ─────────────────────────────
// Au démarrage : charger les données du serveur dans localStorage
// (utile sur un nouvel appareil / après vidage du cache)
// syncFromServer est défini dans js/core/sync.js — cette ancienne version est supprimée.

const RESTORE_20260516_FLAG = 'mp_restored_from_1778961756472_v2';
const RESTORE_20260516_BACKUP = 'mp_before_restore_1778961756472';
const RESTORE_KEY_MAP = {
  invoices: 'mp_invoices',
  devis: 'mp_devis',
  contracts: 'mp_contracts',
  clients: 'mp_clients',
  oms: 'mp_oms',
  rdvs: 'mp_rdvs',
  collabs: 'mp_collabs',
  natures: 'mp_natures',
  representations: 'mp_representations',
  suppliers: 'mp_suppliers',
  purchases: 'mp_purchases',
  expenses: 'mp_expenses',
  expenseCategories: 'mp_expense_categories',
  bankEntries: 'mp_bank_entries',
  cashEntries: 'mp_cash_entries',
  documents: 'mp_documents',
  taches: 'mp_taches',
  vehicules: 'mp_vehicules'
};

function restoreBackup20260516Once() {
  const backup = window.MYTHOS_RESTORE_1778961756472;
  if (!backup || localStorage.getItem(RESTORE_20260516_FLAG)) return;

  const current = {};
  Object.values(RESTORE_KEY_MAP).forEach(key => {
    current[key] = localStorage.getItem(key);
  });
  if (!localStorage.getItem(RESTORE_20260516_BACKUP)) {
    localStorage.setItem(RESTORE_20260516_BACKUP, JSON.stringify({
      createdAt: new Date().toISOString(),
      source: 'before mythos-prod-ver_1778961756472 restore',
      data: current
    }));
  }

  Object.entries(RESTORE_KEY_MAP).forEach(([dataKey, storageKey]) => {
    if (Array.isArray(backup[dataKey])) {
      localStorage.setItem(storageKey, JSON.stringify(backup[dataKey]));
    }
  });
  localStorage.setItem('mp_restore_meta', JSON.stringify({
    restoredAt: new Date().toISOString(),
    exportedAt: backup.exportedAt || '',
    version: backup.version || '',
    source: 'mythos-prod-ver_1778961756472.json'
  }));
  localStorage.setItem(RESTORE_20260516_FLAG, '1');
}

// ── UTILITY FUNCTIONS ──
// [utils.js] todayStr

// [utils.js] money

// [utils.js] escapeHtml

// [utils.js] formatDate

// [utils.js] formatDateLong

// [utils.js] getStampSVG

// Cachet (tampon) généré dynamiquement selon la société émettrice du devis
function getStampSVGFor(societeId) {
  const soc = DEVIS_SOCIETES[societeId] || DEVIS_SOCIETES.mythos;
  const lines = soc.stamp.lines;
  const color = soc.stamp.color || '#1e40af';
  let svg = '<svg width="240" height="95" viewBox="0 0 240 95" xmlns="http://www.w3.org/2000/svg">';
  svg += `<rect x="2" y="4" width="236" height="87" fill="none" stroke="${color}" stroke-width="3"/>`;

  const fontSizes = [15, 12, 11, 11, 11];
  const yPositions = [22, 37, 50, 63, 76];
  const weights = ['bold', 'normal', 'normal', 'normal', 'normal'];

  lines.forEach((line, i) => {
    const fontWeight = weights[i] || 'normal';
    svg += `<text x="120" y="${yPositions[i]}" text-anchor="middle" font-size="${fontSizes[i]}" font-weight="${fontWeight}" fill="${color}" font-family="Arial">${line}</text>`;
  });
  svg += '</svg>';
  return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
}

// [utils.js] getSignatureSVG

// ── Dashboard rendering → js/shared/dashboard.js ──────────────────────────
// updateDashboardStats, updateDashboardOperational

// ── Routing → js/core/router.js ────────────────────────────────────
// currentPage, navigateTo, showPage

// ── INVOICE LIST POPULATION ──
function populateInvoiceList() {
  const invoices = STORE.invoices();
  const container = document.getElementById('invoice-list');
  if (!container) return;

  if (invoices.length === 0) {
    container.innerHTML = '<p style="padding:20px; text-align:center; color:#999;">Aucune facture enregistrée</p>';
    return;
  }

  let html = '<table class="data-table" style="width:100%;"><thead><tr><th>Numéro</th><th>Date</th><th>Client</th><th>Montant HT</th><th>Actions</th></tr></thead><tbody>';

  invoices.forEach(inv => {
    html += `<tr style="cursor:pointer;" onclick="editInvoice('${inv.id}')">
      <td>${escapeHtml(inv.num || '-')}</td>
      <td>${formatDate(inv.date)}</td>
      <td>${escapeHtml(inv.clientName || '-')}</td>
      <td>${money(inv.totalHT || 0)} TND</td>
      <td onclick="event.stopPropagation();">
        <button class="btn btn-outline btn-sm" onclick="editInvoice('${inv.id}')" title="Modifier">✏️</button>
        <button class="btn btn-danger btn-sm" onclick="deleteInvoice('${inv.id}')" title="Supprimer">✕</button>
      </td>
    </tr>`;
  });

  html += '</tbody></table>';
  container.innerHTML = html;
}

// ── OM LIST POPULATION ──
function populateOmList() {
  const oms = STORE.oms();
  const container = document.getElementById('om-list');
  if (!container) return;

  if (oms.length === 0) {
    container.innerHTML = '<p style="padding:20px; text-align:center; color:#999;">Aucun ordre de mission enregistré</p>';
    return;
  }

  let html = '<table class="data-table" style="width:100%;"><thead><tr><th>Départ</th><th>Arrivée</th><th>Date</th><th>Heure</th><th>Personnes</th><th>Actions</th></tr></thead><tbody>';

  oms.forEach(om => {
    const countPersonnes = (om.personnes || []).length;
    html += `<tr style="cursor:pointer;" onclick="editOm('${om.id}')">
      <td>${escapeHtml(om.depart || '-')}</td>
      <td>${escapeHtml(om.arrivee || '-')}</td>
      <td>${formatDate(om.date)}</td>
      <td>${om.heure || '-'}</td>
      <td>${countPersonnes} ${countPersonnes === 1 ? 'personne' : 'personnes'}</td>
      <td onclick="event.stopPropagation();">
        <button class="btn btn-outline btn-sm" onclick="editOm('${om.id}')" title="Modifier">✏️</button>
        <button class="btn btn-danger btn-sm" onclick="deleteOm('${om.id}')" title="Supprimer">✕</button>
      </td>
    </tr>`;
  });

  html += '</tbody></table>';
  container.innerHTML = html;
}

// ── INVOICE FUNCTIONS ──
function editInvoice(id) {
  const invoices = STORE.invoices();
  const inv = invoices.find(i => i.id === id);
  if (!inv) return;

  document.getElementById('edit-id').value = id;
  document.getElementById('f-type').value = inv.type || 'tva';
  document.getElementById('f-date').value = inv.date || '';
  document.getElementById('f-client-name').value = inv.clientName || '';
  document.getElementById('f-client-addr').value = inv.clientAddr || '';
  document.getElementById('f-client-mf').value = inv.clientMf || '';
  document.getElementById('f-addStamp').checked = inv.addStamp !== false;

  navigateTo('new');
}

function deleteInvoice(id) {
  if (!confirm('Êtes-vous sûr?')) return;
  const invoices = STORE.invoices().filter(i => i.id !== id);
  STORE.saveInvoices(invoices);
  populateInvoiceList();
}

// ── DEVIS FUNCTIONS ──
function editDevis(id) {
  const devis_list = STORE.devis();
  const dev = devis_list.find(d => d.id === id);
  if (!dev) return;

  document.getElementById('dev-edit-id').value = id;
  document.getElementById('dev-date').value = dev.date || '';
  document.getElementById('dev-client-name').value = dev.clientName || '';
  document.getElementById('dev-client-addr').value = dev.clientAddr || '';
  document.getElementById('dev-client-mf').value = dev.clientMf || '';
  document.getElementById('dev-addStamp').checked = dev.addStamp || false;
  document.getElementById('dev-tva-percent').value = dev.tvaPercent || 7;
  document.getElementById('dev-timbre-amount').value = dev.timbreAmount || 0;
  document.getElementById('dev-societe').value = dev.societeId || 'mythos';
  document.getElementById('dev-logo-override').value = dev.logoOverride || '';
  const devLogoFile = document.getElementById('dev-logo-custom');
  if (devLogoFile) devLogoFile.value = '';
  updateDevisLogoPreview();

  // Charger les lignes de prestations
  const tbody = document.getElementById('dev-lines-body');
  if (tbody && dev.lines) {
    tbody.innerHTML = '';
    devisLineCount = 0;
    dev.lines.forEach(line => {
      addDevisLine(line.desc || '', line.qty || 1, line.pu || 0, line.unit || 'Forfait');
    });
  }

  // Charger le numéro et mettre à jour l'affichage
  const numParts = splitDevisNum(dev.num);
  document.getElementById('dev-num-year').value = numParts.year;
  document.getElementById('dev-num-seq').value = numParts.seq;
  document.getElementById('dev-num').value = dev.num || '';
  syncDevisNumberPreview();

  // Recalculer les totaux après avoir chargé tous les champs
  setTimeout(() => calcDevisTotals(), 100);

  showView('devis-form');
}

function deleteDevis(id) {
  if (!confirm('Êtes-vous sûr?')) return;
  const devis_list = STORE.devis().filter(d => d.id !== id);
  STORE.saveDevis(devis_list);
  if (typeof LOGGER !== 'undefined') LOGGER.log('DELETE_DEVIS', { id });
  populateDevisList();
}

function saveDevis() {
  const id = document.getElementById('dev-edit-id').value;

  // Récupérer les lignes de prestations
  const lines = [];
  const tbody = document.getElementById('dev-lines-body');
  if (tbody) {
    tbody.querySelectorAll('tr').forEach(row => {
      const desc = row.querySelector('.dev-line-desc')?.value || '';
      const qty = parseFloat(row.querySelector('.dev-line-qty')?.value || 0);
      const unit = row.querySelector('.dev-line-unit')?.value || 'Forfait';
      const pu = parseFloat(row.querySelector('.dev-line-pu')?.value || 0);
      const total = qty * pu;

      lines.push({ desc, qty, unit, pu, total });
    });
  }

  const devisObj = {
    id: id || Date.now().toString(),
    num: document.getElementById('dev-num').value,
    date: document.getElementById('dev-date').value || todayStr(),
    clientName: document.getElementById('dev-client-name').value,
    clientAddr: document.getElementById('dev-client-addr').value,
    clientMf: document.getElementById('dev-client-mf').value,
    totalHT: parseFloat(document.getElementById('dev-total-ht').value || 0),
    totalTTC: parseFloat(document.getElementById('dev-total-ttc').value || 0),
    tva: parseFloat(document.getElementById('dev-tva').value || 0),
    tvaPercent: parseFloat(document.getElementById('dev-tva-percent')?.value || 7),
    addStamp: document.getElementById('dev-addStamp')?.checked || false,
    timbreAmount: parseFloat(document.getElementById('dev-timbre-amount')?.value || 0),
    societeId: document.getElementById('dev-societe')?.value || 'mythos',
    logoOverride: document.getElementById('dev-logo-override')?.value || '',
    lines: lines
  };

  if (!devisObj.num) {
    alert('Veuillez entrer un numéro de devis');
    return;
  }
  if (!devisObj.clientName) {
    alert('Veuillez entrer un client');
    return;
  }

  let devis_list = STORE.devis();
  if (id) {
    const idx = devis_list.findIndex(d => d.id === id);
    if (idx !== -1) devis_list[idx] = devisObj;
  } else {
    devis_list.push(devisObj);
  }

  STORE.saveDevis(devis_list);
  if (typeof LOGGER !== 'undefined') LOGGER.log('SAVE_DEVIS', { num: devisObj.num, client: devisObj.clientName, action: id ? 'edit' : 'create' });
  document.getElementById('dev-edit-id').value = '';
  populateDevisList();
  showView('devis');
}

function populateDevisList() {
  const container = document.getElementById('devis-container');
  if (!container) return;

  const devis_list = STORE.devis().slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  if (!devis_list.length) {
    container.innerHTML = '<div class="empty-state">Aucun devis.</div>';
    return;
  }

  const html = '<table class="clients-list-table" style="width:100%;"><thead><tr><th>Numéro</th><th>Client</th><th>Date</th><th>Total HT</th><th>TVA (%)</th><th>Total TTC</th><th>Actions</th></tr></thead><tbody>' +
    devis_list.map(dev => `
      <tr style="cursor:pointer;" onclick="editDevis('${dev.id}')">
        <td><strong>${escapeHtml(dev.num || '-')}</strong></td>
        <td>${escapeHtml(dev.clientName || '-')}</td>
        <td>${dev.date || '-'}</td>
        <td style="text-align:right;">${fmtMoney(dev.totalHT || 0)}</td>
        <td style="text-align:center;">${(dev.tvaPercent || 7).toFixed(1)}</td>
        <td style="text-align:right;font-weight:bold;color:#d4af37;">${fmtMoney(dev.totalTTC || 0)}</td>
        <td onclick="event.stopPropagation()">
          <button class="btn btn-outline btn-sm" onclick="printDevis('${dev.id}')" title="Imprimer / PDF">🖨️</button>
          <button class="btn btn-outline btn-sm" onclick="editDevis('${dev.id}')" title="Modifier">✏️</button>
          <button class="btn btn-danger btn-sm" onclick="deleteDevis('${dev.id}')" title="Supprimer">✕</button>
        </td>
      </tr>
    `).join('') +
    '</tbody></table>';

  container.innerHTML = html;
}

function cancelDevisForm() {
  document.getElementById('dev-edit-id').value = '';
  document.getElementById('dev-num').value = '';
  document.getElementById('dev-num-year').value = '';
  document.getElementById('dev-num-seq').value = '';
  document.getElementById('dev-date').value = todayStr();
  document.getElementById('dev-client-select').value = '';
  document.getElementById('dev-client-name').value = '';
  document.getElementById('dev-client-addr').value = '';
  document.getElementById('dev-client-mf').value = '';
  document.getElementById('dev-addStamp').checked = false;
  document.getElementById('dev-tva-percent').value = 7;
  document.getElementById('dev-timbre-amount').value = 1.000;
  document.getElementById('dev-total-ht').value = '0';
  document.getElementById('dev-total-ttc').value = '0';
  document.getElementById('dev-tva').value = '0';
  document.getElementById('dev-societe').value = 'mythos';
  document.getElementById('dev-logo-override').value = '';
  const devLogoFileCancel = document.getElementById('dev-logo-custom');
  if (devLogoFileCancel) devLogoFileCancel.value = '';
  updateDevisLogoPreview();

  const tbody = document.getElementById('dev-lines-body');
  if (tbody) tbody.innerHTML = '';

  showView('devis');
}

// ── Émetteur / logo du devis ──
function updateDevisLogoPreview() {
  const img = document.getElementById('dev-logo-preview');
  if (!img) return;
  const sel = document.getElementById('dev-societe');
  const override = document.getElementById('dev-logo-override')?.value;
  const soc = DEVIS_SOCIETES[sel?.value] || DEVIS_SOCIETES.mythos;
  img.src = override || soc.logo;
}

function onDevisSocieteChange() {
  // Changer de société réinitialise le logo personnalisé pour repartir du logo par défaut de la société
  document.getElementById('dev-logo-override').value = '';
  const fileInput = document.getElementById('dev-logo-custom');
  if (fileInput) fileInput.value = '';
  updateDevisLogoPreview();
}

function onDevisLogoFileChange(evt) {
  const file = evt?.target?.files && evt.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    document.getElementById('dev-logo-override').value = e.target.result;
    updateDevisLogoPreview();
  };
  reader.readAsDataURL(file);
}

function resetDevisLogo() {
  document.getElementById('dev-logo-override').value = '';
  const fileInput = document.getElementById('dev-logo-custom');
  if (fileInput) fileInput.value = '';
  updateDevisLogoPreview();
}

function syncDevisNumberPreview() {
  const year = document.getElementById('dev-num-year').value;
  const seq = document.getElementById('dev-num-seq').value;
  const preview = document.getElementById('dev-num-preview');

  // Display format: DEV-YEAR/SEQ (e.g., "DEV-2026/12")
  if (preview) {
    preview.textContent = year && seq ? `DEV-${year}/${seq}` : '---';
  }

  // Internal storage format: SEQ/YEAR (e.g., "012/2026") for proper parsing with splitDevisNum()
  document.getElementById('dev-num').value = year && seq ? `${String(seq).padStart(3, '0')}/${year}` : '';
}

function initDevisForm() {
  fillDevisClientSelect();
  devisLineCount = 0;

  const editId = document.getElementById('dev-edit-id').value;
  if (editId) {
    // Mode édition - le formulaire est déjà rempli par editDevis()
    document.getElementById('devis-form-title').innerHTML = 'Modifier <span>Devis</span>';
  } else {
    // Mode création - initialiser un nouveau devis
    document.getElementById('devis-form-title').innerHTML = 'Nouveau <span>Devis</span>';
    const today = todayStr();
    const year = today.slice(0, 4);
    document.getElementById('dev-edit-id').value = '';
    document.getElementById('dev-num-year').value = year;
    document.getElementById('dev-num-seq').value = nextDevisNum(year).split('/')[0];
    document.getElementById('dev-date').value = today;
    document.getElementById('dev-client-select').value = '';
    document.getElementById('dev-client-name').value = '';
    document.getElementById('dev-client-addr').value = '';
    document.getElementById('dev-client-mf').value = '';
    document.getElementById('dev-addStamp').checked = false;
    document.getElementById('dev-tva-percent').value = 7;
    document.getElementById('dev-timbre-amount').value = 1.000;
    document.getElementById('dev-societe').value = 'mythos';
    document.getElementById('dev-logo-override').value = '';
    const devLogoFileNew = document.getElementById('dev-logo-custom');
    if (devLogoFileNew) devLogoFileNew.value = '';
    updateDevisLogoPreview();

    const tbody = document.getElementById('dev-lines-body');
    if (tbody) tbody.innerHTML = '';
    addDevisLine('Prestation', 1, 0, 'Forfait');

    syncDevisNumberPreview();
    calcDevisTotals();
  }
}

function fillDevisClientSelect() {
  const sel = document.getElementById('dev-client-select');
  if (!sel) return;
  sel.innerHTML = '<option value="">-- Nouveau client --</option>' + STORE.clients().map(c => `<option value="${esc(c.id)}">${esc(c.name || c.contact || 'Client')}</option>`).join('');
}

function syncDevisClientFromSelect() {
  const id = document.getElementById('dev-client-select').value;
  const c = STORE.clients().find(client => client.id === id);
  if (!c) return;
  document.getElementById('dev-client-name').value = c.name || c.contact || '';
  document.getElementById('dev-client-addr').value = c.addr || '';
  document.getElementById('dev-client-mf').value = c.mf || '';
}

let devisLineCount = 0;

function addDevisLine(desc = '', qty = 1, pu = 0, unit = 'Forfait') {
  devisLineCount += 1;
  const tbody = document.getElementById('dev-lines-body');
  if (!tbody) return;

  const tr = document.createElement('tr');
  tr.id = 'dev-line-' + devisLineCount;
  tr.innerHTML = `
    <td><input type="text" value="${escapeHtml(desc)}" placeholder="Transport de spectacle à " class="dev-line-desc" oninput="calcDevisTotals()" style="width:100%;padding:6px;border:1px solid #444;border-radius:4px;background:#2d2d2d;color:#fff;"></td>
    <td style="text-align:center;"><input type="number" value="${qty}" min="0" step="0.5" class="dev-line-qty" oninput="calcDevisTotals()" style="width:100%;padding:6px;border:1px solid #444;border-radius:4px;background:#2d2d2d;color:#fff;text-align:center;"></td>
    <td><select class="dev-line-unit" onchange="calcDevisTotals()" style="width:100%;padding:6px;border:1px solid #444;border-radius:4px;background:#2d2d2d;color:#fff;">
      <option ${unit === 'Forfait' ? 'selected' : ''}>Forfait</option>
      <option ${unit === 'Jour(s)' ? 'selected' : ''}>Jour(s)</option>
      <option ${unit === 'Km' ? 'selected' : ''}>Km</option>
      <option ${unit === 'Heure(s)' ? 'selected' : ''}>Heure(s)</option>
    </select></td>
    <td style="text-align:right;"><input type="number" value="${pu}" min="0" step="0.001" class="dev-line-pu" oninput="calcDevisTotals()" style="width:100%;padding:6px;border:1px solid #444;border-radius:4px;background:#2d2d2d;color:#fff;text-align:right;"></td>
    <td class="dev-line-total" style="text-align:right;padding:8px;font-weight:bold;color:#d4af37;">0.000</td>
    <td style="text-align:center;"><button class="btn btn-danger btn-sm" type="button" onclick="removeDevisLine('dev-line-${devisLineCount}')">✕</button></td>
  `;
  tbody.appendChild(tr);
  calcDevisTotals();
}

function removeDevisLine(lineId) {
  const line = document.getElementById(lineId);
  if (line) {
    line.remove();
    calcDevisTotals();
  }
}

function calcDevisTotals() {
  const tbody = document.getElementById('dev-lines-body');
  if (!tbody) return;

  let totalHT = 0;
  const rows = tbody.querySelectorAll('tr');

  rows.forEach(row => {
    const qtyInput = row.querySelector('.dev-line-qty');
    const puInput = row.querySelector('.dev-line-pu');
    const totalCell = row.querySelector('.dev-line-total');

    const qty = parseFloat(qtyInput?.value || 0);
    const pu = parseFloat(puInput?.value || 0);
    const lineTotal = qty * pu;

    if (totalCell) {
      totalCell.textContent = lineTotal.toFixed(3);
    }

    totalHT += lineTotal;
  });

  // TVA variable selon le champ d'entrée
  const tvaPercent = parseFloat(document.getElementById('dev-tva-percent')?.value || 7);
  const tva = totalHT * (tvaPercent / 100);

  // Timbre fiscal : montant modifiable (séparé du cachet)
  const timbre = parseFloat(document.getElementById('dev-timbre-amount')?.value || 0);
  const totalTTC = totalHT + tva + timbre;

  document.getElementById('dev-total-ht').value = totalHT.toFixed(3);
  document.getElementById('dev-total-ttc').value = totalTTC.toFixed(3);
  document.getElementById('dev-tva').value = tva.toFixed(3);

  document.getElementById('dev-t-ht').textContent = fmtMoney(totalHT);
  document.getElementById('dev-t-tva').textContent = fmtMoney(tva);
  document.getElementById('dev-t-timbre').textContent = fmtMoney(timbre);
  document.getElementById('dev-t-ttc').textContent = fmtMoney(totalTTC);
}

function buildDevisHTML(dev) {
  const soc = DEVIS_SOCIETES[dev.societeId] || DEVIS_SOCIETES.mythos;
  const logoSrc = dev.logoOverride || soc.logo;
  const rows = (dev.lines || []).map(line => `<tr style="height:32px;background:#fff;"><td style="padding:10px 8px;border:1px solid #000;">${esc(line.desc)}</td><td style="text-align:center;padding:10px 8px;border:1px solid #000;">${line.qty}</td><td style="text-align:center;padding:10px 8px;border:1px solid #000;">${esc(line.unit || '')}</td><td style="text-align:right;padding:10px 8px;border:1px solid #000;">${fmtMoney(line.pu)}</td><td style="text-align:right;padding:10px 8px;border:1px solid #000;">${fmtMoney(num(line.qty) * num(line.pu))}</td></tr>`).join('');
  const totalHT = (dev.lines || []).reduce((sum, line) => sum + (num(line.qty) * num(line.pu)), 0);
  const tvaPercent = dev.tvaPercent || 7;
  const tvaAmt = totalHT * (tvaPercent / 100);
  const timbre = dev.timbreAmount || 0;
  const totalTTC = totalHT + tvaAmt + timbre;

  return `<div style="background:#fff;color:#000;width:794px;min-height:1123px;padding:16mm 18mm;box-sizing:border-box;font-family:Arial,sans-serif;font-size:14px;line-height:1.4;display:flex;flex-direction:column;">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;border-bottom:1px solid #000;padding-bottom:16px;margin-bottom:20px;">
      <img src="${logoSrc}" style="width:160px;max-height:80px;object-fit:contain;">
      <div style="text-align:right;">
        <div style="font-size:32px;font-weight:900;color:#000;letter-spacing:1px;">DEVIS</div>
        <div style="font-size:11px;margin-top:6px;color:#333;"><b>N°:</b> ${esc(dev.num)} &nbsp; <b>Date:</b> ${formatDate(dev.date)}</div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:28px;font-size:12px;">
      <div>
        <div style="font-weight:900;color:#000;margin-bottom:8px;font-size:11px;">Émetteur:</div>
        <div style="border:1px solid #000;padding:12px 14px;height:100px;display:flex;flex-direction:column;justify-content:flex-start;">
          <div style="font-weight:900;color:#000;margin-bottom:6px;">${esc(soc.nom)}</div>
          <div style="line-height:1.5;color:#000;">${soc.addrLines.map(esc).join('<br>')}</div>
        </div>
      </div>
      <div>
        <div style="font-weight:900;color:#000;margin-bottom:8px;font-size:11px;">Devis à:</div>
        <div style="border:1px solid #000;padding:12px 14px;height:100px;display:flex;flex-direction:column;justify-content:flex-start;">
          <div style="line-height:1.5;color:#000;"><b>${esc(dev.clientName)}</b><br>${esc(dev.clientAddr)}<br>${esc(dev.clientMf)}</div>
        </div>
      </div>
    </div>
    <div style="font-size:11px;font-weight:900;color:#000;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;">Détail des prestations</div>
    <table style="width:100%;border-collapse:collapse;margin-top:0;margin-bottom:20px;font-size:14px;"><thead><tr style="background:#fff;color:#000;font-weight:900;"><th style="padding:10px;text-align:left;border:1px solid #000;">Description</th><th style="padding:10px;text-align:center;border:1px solid #000;width:60px;">Qté</th><th style="padding:10px;text-align:center;border:1px solid #000;width:70px;">Unité</th><th style="padding:10px;text-align:right;border:1px solid #000;width:100px;">Prix unit.</th><th style="padding:10px;text-align:right;border:1px solid #000;width:100px;">Total HT</th></tr></thead><tbody>${rows}</tbody></table>
    <div style="width:380px;margin-left:auto;margin-bottom:20px;font-size:12px;border:1px solid #000;padding:14px 16px;">
      <div style="display:flex;justify-content:space-between;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid #000;">
        <span style="color:#000;">Total HT</span>
        <b style="color:#000;font-size:13px;">${fmtMoney(totalHT)}</b>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid #000;">
        <span style="color:#000;">TVA ${tvaPercent}%</span>
        <b style="color:#000;font-size:13px;">${fmtMoney(tvaAmt)}</b>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:10px;padding-bottom:10px;">
        <span style="color:#000;">Timbre fiscal</span>
        <b style="color:#000;font-size:13px;">${fmtMoney(timbre)}</b>
      </div>
      <div style="display:flex;justify-content:space-between;border-top:2px solid #000;padding-top:10px;font-size:15px;font-weight:900;">
        <span style="color:#000;">TOTAL TTC</span>
        <b style="color:#000;font-size:16px;">${fmtMoney(totalTTC)}</b>
      </div>
    </div>
    <div style="margin-bottom:20px;padding:12px 14px;border:1px solid #000;font-size:11px;">
      <span style="font-weight:900;color:#000;">Arrêtée la présente devis à la somme de :</span><br>
      <span style="color:#000;margin-top:6px;display:block;font-style:italic;">${numberToFrenchWords(totalTTC)}</span>
    </div>
    <div style="margin-bottom:20px;display:grid;grid-template-columns:1fr;gap:16px;font-size:11px;">
      <div style="text-align:right;display:flex;flex-direction:column;align-items:flex-end;gap:10px;margin-right:80px;">
        <div style="font-weight:900;color:#000;margin-bottom:8px;">Signature et Cachet</div>
        ${dev.addStamp ? `<img src="${getStampSVGFor(dev.societeId)}" style="height:90px;width:auto;transform:rotate(-3deg);opacity:0.85;filter:drop-shadow(1px 1px 2px rgba(30,64,175,0.3)) blur(0.3px);">` : ''}
      </div>
    </div>
    <div style="margin-top:auto;padding-top:14px;border-top:1px solid #000;font-size:9px;line-height:1.6;text-align:center;color:#000;">
      ${soc.footer}
    </div>
  </div>`;
}

function printDevis(devisId) {
  const devis = STORE.devis().find(d => d.id === devisId);
  if (!devis) return;

  document.getElementById('devis-preview').innerHTML = buildDevisHTML(devis);
  document.getElementById('devis-preview-modal').style.display = 'flex';
}

function closeDevisPreview() {
  document.getElementById('devis-preview-modal').style.display = 'none';
}

// ════════════════════════════════════════════════════════════
// RENDEZ-VOUS - TWO STEP WIZARD
// ════════════════════════════════════════════════════════════

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

function removePersonRow(btn) {
  const row = btn.closest('tr');
  if (row) row.remove();
}

function addOmPerson() {
  const personnesBody = document.getElementById('om-persons-body');
  if (!personnesBody) return;

  const rowCount = personnesBody.querySelectorAll('tr').length + 1;
  const row = `<tr>
    <td style="text-align:center;">${rowCount}</td>
    <td><input type="text" placeholder="Nom et prénom" data-person-nom style="width:100%;padding:4px;border:1px solid #ddd;border-radius:4px;"></td>
    <td style="text-align:center;"><input type="checkbox" data-person-sig></td>
    <td><button class="btn btn-sm btn-outline" type="button" onclick="removePersonRow(this)">-</button></td>
  </tr>`;
  personnesBody.insertAdjacentHTML('beforeend', row);
}

function addLine() {
  alert('Fonctionnalité en développement');
}

function setOmDateQuick(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const dateStr = d.getFullYear() + '-' +
                  String(d.getMonth() + 1).padStart(2, '0') + '-' +
                  String(d.getDate()).padStart(2, '0');
  document.getElementById('om-date').value = dateStr;
}

function setOmTimeQuick(time) {
  const heureInput = document.getElementById('om-heure');
  if (time === 'now') {
    const now = new Date();
    heureInput.value = String(now.getHours()).padStart(2, '0') + ':' +
                       String(now.getMinutes()).padStart(2, '0');
  } else {
    heureInput.value = time;
  }
}

function applyOmMissionType() {}


// ── OM FUNCTIONS ──
function editOm(id) {
  const oms = STORE.oms();
  const om = oms.find(o => o.id === id);
  if (!om) return;

  document.getElementById('om-edit-id').value = id;
  document.getElementById('om-plaque').value = om.plaque || '';
  document.getElementById('om-chauffeur').value = om.chauffeur || '';
  document.getElementById('om-cin').value = om.cin || '';
  document.getElementById('om-date').value = om.date || '';
  document.getElementById('om-heure').value = om.heure || '';
  document.getElementById('om-depart').value = om.depart || '';
  document.getElementById('om-arrivee').value = om.arrivee || '';

  // Load persons/passengers if edit mode
  if (om.personnes && Array.isArray(om.personnes)) {
    const personnesBody = document.getElementById('om-persons-body');
    if (personnesBody) {
      personnesBody.innerHTML = '';
      om.personnes.forEach((p, idx) => {
        const row = `<tr>
          <td style="text-align:center;">${idx + 1}</td>
          <td><input type="text" value="${escapeHtml(p.nom || '')}" data-person-nom style="width:100%;padding:4px;border:1px solid #ddd;border-radius:4px;"></td>
          <td style="text-align:center;"><input type="checkbox" data-person-sig ${p.signature ? 'checked' : ''}></td>
          <td><button class="btn btn-sm btn-outline" type="button" onclick="removePersonRow(this)">-</button></td>
        </tr>`;
        personnesBody.insertAdjacentHTML('beforeend', row);
      });
    }
  }

  navigateTo('oms');
}

function deleteOm(id) {
  if (!confirm('Êtes-vous sûr?')) return;
  const oms = STORE.oms().filter(o => o.id !== id);
  STORE.saveOms(oms);
  populateOmList();
}

function cancelOM() {
  document.getElementById('om-edit-id').value = '';
  document.getElementById('om-plaque').value = '230-8646';
  document.getElementById('om-chauffeur').value = 'Othman Haddad';
  document.getElementById('om-cin').value = '07119027';
  document.getElementById('om-date').value = todayStr();
  document.getElementById('om-heure').value = '';
  document.getElementById('om-depart').value = '';
  document.getElementById('om-arrivee').value = '';

  // Clear persons table
  const personnesBody = document.getElementById('om-persons-body');
  if (personnesBody) personnesBody.innerHTML = '';

  navigateTo('oms');
}

// ── COMPATIBILITY WRAPPERS ──

// ── DEMO DATA INITIALIZATION ──
function initializeDemoData() {
  // Demo invoices
  if (STORE.invoices().length === 0) {
    STORE.saveInvoices([
      {
        id: 'inv-1',
        num: 'FAC-2026/001',
        type: 'tva',
        date: '2026-05-15',
        clientName: 'Le Theatre Unifié',
        clientAddr: 'Tunis',
        clientMf: '1234567ABC000',
        totalHT: 3500,
        totalTTC: 3745
      },
      {
        id: 'inv-2',
        num: 'FAC-2026/002',
        type: 'sans_tva',
        date: '2026-05-10',
        clientName: 'Anarca Productions',
        clientAddr: 'Ben Arous',
        clientMf: '9876543XYZ000',
        totalHT: 2800,
        totalTTC: 2800
      }
    ]);
  }

  // Demo OMs
  if (STORE.oms().length === 0) {
    STORE.saveOms([
      {
        id: 'om-1',
        num: 'OM-001',
        date: '2026-05-20',
        heure: '09:00',
        plaque: '230-8646',
        chauffeur: 'Othman Haddad',
        cin: '07119027',
        depart: 'Tunis',
        arrivee: 'Sousse',
        destination: 'Sousse',
        personnes: [
          { nom: 'Ali Ben Taieb', signature: false },
          { nom: 'Fatima Zahra Saidi', signature: false }
        ]
      },
      {
        id: 'om-2',
        num: 'OM-002',
        date: '2026-05-18',
        heure: '14:30',
        plaque: '456-1234',
        chauffeur: 'Ahmed Ben Ali',
        cin: '08556789',
        depart: 'Ben Arous',
        arrivee: 'Sfax',
        destination: 'Sfax',
        personnes: [
          { nom: 'Sami Karimi', signature: false },
          { nom: 'Nadia Ghedira', signature: false },
          { nom: 'Rashid Al-Mansouri', signature: false }
        ]
      }
    ]);
  }

  // Demo clients
  if (STORE.clients().length === 0) {
    STORE.saveClients([
      {
        id: 'cli-1',
        name: 'Le Theatre Unifié',
        contact: '+216 71 000 111',
        email: 'contact@theatre.tn',
        mf: '1234567ABC000'
      },
      {
        id: 'cli-2',
        name: 'Anarca Productions',
        contact: '+216 22 888 555',
        email: 'info@anarca.tn',
        mf: '9876543XYZ000'
      }
    ]);
  }

  // Demo suppliers
  if (STORE.suppliers().length === 0) {
    STORE.saveSuppliers([
      {
        id: 'sup-1',
        name: 'STEG - Société Tunisienne de l\'Électricité et du Gaz',
        contact: '+216 71 962 000',
        addr: 'Tunis, Centre-Ville',
        category: 'Électricité',
        notes: 'Fournisseur principal d\'électricité'
      },
      {
        id: 'sup-2',
        name: 'SONEDE - Société Nationale d\'Exploitation et de Distribution de l\'Eau',
        contact: '+216 71 330 000',
        addr: 'Tunis',
        category: 'Eau',
        notes: 'Fournisseur d\'eau potable'
      },
      {
        id: 'sup-3',
        name: 'Office National de Télécommande',
        contact: '+216 20 999 999',
        addr: 'Ben Arous',
        category: 'Télécommunications',
        notes: 'Service téléphonique et Internet'
      },
      {
        id: 'sup-4',
        name: 'Imprimerie Moderne',
        contact: '+216 71 555 123',
        addr: 'La Marsa',
        category: 'Imprimerie',
        notes: 'Services d\'impression et reprographie'
      },
      {
        id: 'sup-5',
        name: 'ProLogistique Tunisie',
        contact: '+216 25 333 444',
        addr: 'Sfax',
        category: 'Logistique & Transport',
        notes: 'Transport et livraison de marchandises'
      },
      {
        id: 'sup-6',
        name: 'Bureau & Fournitures Office',
        contact: '+216 71 666 777',
        addr: 'Tunis Centre',
        category: 'Fournitures',
        notes: 'Fournitures de bureau et d\'administration'
      },
      {
        id: 'sup-7',
        name: 'Agence de Nettoyage Étoile',
        contact: '+216 22 111 222',
        addr: 'Ariana',
        category: 'Nettoyage & Maintenance',
        notes: 'Services de nettoyage et maintenance'
      },
      {
        id: 'sup-8',
        name: 'Cabinet Comptable & Conseil',
        contact: '+216 71 888 999',
        addr: 'Tunis',
        category: 'Conseil',
        notes: 'Services comptables et de conseil'
      },
      {
        id: 'sup-9',
        name: 'Assurances Générale',
        contact: '+216 71 444 555',
        addr: 'Tunis',
        category: 'Assurance',
        notes: 'Polices d\'assurance et couvertures'
      },
      {
        id: 'sup-10',
        name: 'Agence Événementielle Pro',
        contact: '+216 25 888 666',
        addr: 'Sousse',
        category: 'Événements',
        notes: 'Organisation d\'événements et catering'
      }
    ]);
  }

  // Demo natures de travail
  if (STORE.natures().length === 0) {
    STORE.saveNatures([
      {
        id: 'nat-1',
        nom: 'Technique de lumière',
        desc: 'Gestion de l\'éclairage et des effets de lumière',
        icon: '💡'
      },
      {
        id: 'nat-2',
        nom: 'Mise en scène',
        desc: 'Direction artistique et mise en scène',
        icon: '🎭'
      },
      {
        id: 'nat-3',
        nom: 'Son et audio',
        desc: 'Gestion du son et de l\'audio',
        icon: '🔊'
      },
      {
        id: 'nat-4',
        nom: 'Décor et accessoires',
        desc: 'Conception et installation du décor',
        icon: '🎨'
      },
      {
        id: 'nat-5',
        nom: 'Costumes',
        desc: 'Costumes et habillage des acteurs',
        icon: '👔'
      }
    ]);
  }

  // Demo representations
  if (STORE.representations().length === 0) {
    STORE.saveRepresentations([
      {
        id: 'rep-1',
        spectacle: 'Technique de lumière',
        clientId: 'cli-1',
        clientName: 'Le Theatre Unifié',
        director: 'Ahmed Ben Salah',
        fee: 5000,
        natureLines: [
          { natureId: 'nat-1', natureName: 'Technique de lumière', displayName: 'Technique de lumière' }
        ]
      },
      {
        id: 'rep-2',
        spectacle: 'Transfer aéroport',
        clientId: 'cli-2',
        clientName: 'Anarca Productions',
        director: 'Fatima Ghedira',
        fee: 3000,
        natureLines: [
          { natureId: 'nat-2', natureName: 'Mise en scène', displayName: 'Mise en scène' }
        ]
      },
      {
        id: 'rep-3',
        spectacle: 'Concert symphonique',
        clientId: 'cli-1',
        clientName: 'Le Theatre Unifié',
        director: 'Sami Karimi',
        fee: 7500,
        natureLines: [
          { natureId: 'nat-3', natureName: 'Son et audio', displayName: 'Son et audio' }
        ]
      }
    ]);
  }

  // Demo collaborateurs
  if (STORE.collabs().length === 0) {
    STORE.saveCollabs([
      {
        id: 'col-1',
        nom: 'Othman Haddad',
        role: 'Responsable Production',
        contact: '+216 71 000 001',
        email: 'othman@mythos.tn'
      },
      {
        id: 'col-2',
        nom: 'Ahmed Ben Salah',
        role: 'Directeur Technique',
        contact: '+216 71 000 002',
        email: 'ahmed@mythos.tn'
      },
      {
        id: 'col-3',
        nom: 'Fatima Ghedira',
        role: 'Assistante Production',
        contact: '+216 71 000 003',
        email: 'fatima@mythos.tn'
      }
    ]);
  }
}

// ── INITIALIZATION ──
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

function initApp() {
  console.log('🚀 Mythos Prod - App initialized');

  restoreBackup20260516Once();
  cleanupBankEntryTypes();

  // Initialize demo data if empty
  initializeDemoData();

  // Set default date
  const dateInput = document.getElementById('f-date');
  if (dateInput) dateInput.value = todayStr();

  // Initialize invoice type handler
  handleInvoiceTypeChange();

  // Load initial page
  navigateTo('dashboard');
}

// ── DOM READY ──
// Legacy initializer kept for reference only. The stable initializer below owns startup.

// =====================================================
// Stable app layer - restores the complete screen logic
// =====================================================

STORE.backupVersions = function() { return _storeGet('mp_backup_versions', '[]'); };
STORE.saveBackupVersions = function(d) { return _storeSave('mp_backup_versions', d); };

const RESTORE_20260516_FORCE_FLAG = 'mp_restored_from_1778961756472_v4';
const OM_MISSION_TEXTS = {
  aller_retour: 'Assurer le transport aller-retour du groupe, apr\u00e8s leur visite professionnelle, avec bagages et d\u00e9cors.',
  aller_simple: 'Assurer le transport du groupe jusqu\u2019\u00e0 leur lieu de visite professionnelle, avec bagages et d\u00e9cors.'
};

let stableLineCount = 0;
let stableOmPersonCount = 0;
let stableRdvPrestRows = 0;
// stableRepNatureRows → js/shared/representations.js
// calFilterMode → js/shared/calendar.js
let comptaExpenseFilter = 'month';
let comptaBankFilterType = 'all'; // 'all', 'retrait', 'alimentation'
let comptaBankFilterStatus = 'all'; // 'all', 'linked', 'unlinked'
let comptaBankFilterMinAmount = 0;
let comptaBankFilterMaxAmount = Infinity;
let comptaBankFilterReference = ''; // search by reference
let comptaCashFilterStatus = 'all'; // 'all', 'expense', 'income', 'bank'
let comptaCashFilterMinAmount = 0;
let comptaCashFilterMaxAmount = Infinity;
let supplierFilterCategory = 'all';
let supplierSearchQuery = '';
// fournisseurFilterCategory, fournisseurSearchQuery → js/shared/fournisseurs.js

// [utils.js] esc

// [utils.js] num

// [utils.js] fmtMoney

// [utils.js] paymentModeLabel

function updateInvoicePaymentModeVisibility() {
  const status = document.getElementById('f-status')?.value || 'pending';
  const group = document.getElementById('invoice-payment-mode-group');
  if (group) group.style.display = status === 'paid' ? 'flex' : 'none';
}

// [utils.js] getInvoiceTotal

// [utils.js] getInvoiceHT

// [utils.js] getRdvAmount

// [utils.js] getRdvPaidAmount

// [utils.js] isRdvPaid

// [utils.js] dateInputValue

// [utils.js] calendarDateCard

// [utils.js] isDateInCurrentWeek

// [utils.js] normalizeRdv

// [utils.js] cleanRestoredValue

function forceRestoreBackup20260516() {
  const backup = window.MYTHOS_RESTORE_1778961756472;
  if (!backup || localStorage.getItem(RESTORE_20260516_FORCE_FLAG)) return;
  const hasExistingData = ['mp_invoices', 'mp_clients', 'mp_oms', 'mp_rdvs'].some(key => {
    try {
      const value = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(value) && value.length > 0;
    } catch {
      return false;
    }
  });
  if (hasExistingData) {
    localStorage.setItem(RESTORE_20260516_FORCE_FLAG, 'kept-existing-data');
    return;
  }
  Object.entries(RESTORE_KEY_MAP).forEach(([dataKey, storageKey]) => {
    if (Array.isArray(backup[dataKey])) {
      localStorage.setItem(storageKey, JSON.stringify(cleanRestoredValue(backup[dataKey])));
    }
  });
  localStorage.setItem('mp_restore_meta', JSON.stringify({
    restoredAt: new Date().toISOString(),
    exportedAt: backup.exportedAt || '',
    version: backup.version || '',
    source: 'mythos-prod-ver_1778961756472.json'
  }));
  localStorage.setItem(RESTORE_20260516_FORCE_FLAG, '1');
}

// ── Inscriptions (lecture en direct du Google Sheet via Apps Script) ──
var INSCRIPTIONS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxwTJdycLxD_ooTnRp4VgS4kGP7CEX9HotUSTRk27r4OB5FNR1WK7Tf4lz8DKu64I0/exec";

function _escHtmlInsc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, function(c) {
    return ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c];
  });
}

function loadDashboardInscriptionsCount() {
  var el = document.getElementById('dashboard-inscriptions-count');
  if (!el) return;
  fetch(INSCRIPTIONS_SCRIPT_URL + '?_=' + Date.now())
    .then(function(r) { return r.json(); })
    .then(function(json) {
      var rows = (json && json.rows) || [];
      var validated = STORE.validatedInscriptions();
      var validatedSet = {};
      validated.forEach(function(num) { validatedSet[num] = true; });
      var visible = rows.filter(function(r, i) { return !validatedSet[_uclNum(i)]; });
      el.textContent = String(visible.length);
    })
    .catch(function() {});
}

function _uclNum(i) {
  return 'UCL' + String(i + 1).padStart(4, '0');
}

function _appUid() {
  return 'app_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
}

function loadInscriptions() {
  var tbody = document.getElementById('inscriptions-tbody');
  var countEl = document.getElementById('inscriptions-count');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" style="padding:48px;text-align:center;color:#666;font-size:15px;">Chargement&hellip;</td></tr>';

  fetch(INSCRIPTIONS_SCRIPT_URL + '?_=' + Date.now())
    .then(function(r) { return r.json(); })
    .then(function(json) {
      var allRows = (json && json.rows) || [];
      // numérotation UCL0001, UCL0002... basée sur l'ordre chronologique réel (avant filtrage/inversion)
      var numbered = allRows.map(function(r, i) { return { r: r, num: _uclNum(i) }; });

      var validated = STORE.validatedInscriptions();
      var validatedSet = {};
      validated.forEach(function(num) { validatedSet[num] = true; });

      // seules les inscriptions PAS encore validées restent affichées ici
      var visible = numbered.filter(function(entry) { return !validatedSet[entry.num]; });

      if (countEl) countEl.textContent = String(visible.length);

      if (!visible.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="padding:48px;text-align:center;color:#666;font-size:15px;">&#128679; Aucune inscription pour le moment.</td></tr>';
        return;
      }
      visible = visible.slice().reverse(); // la plus récente en premier à l'affichage
      tbody.innerHTML = visible.map(function(entry, i) {
        var r = entry.r;
        var bg = (i % 2 === 0) ? 'rgba(255,255,255,0.015)' : 'transparent';
        return '<tr data-num="' + _escHtmlInsc(entry.num) + '" data-date="' + _escHtmlInsc(r.date) + '" data-heure="' + _escHtmlInsc(r.heure) + '" data-nom="' + _escHtmlInsc(r.nom) + '" data-tel="' + _escHtmlInsc(r.tel) + '" style="border-bottom:1px solid rgba(255,255,255,0.06);background:' + bg + ';transition:background .15s;" onmouseover="this.style.background=\'rgba(201,168,76,0.08)\'" onmouseout="this.style.background=\'' + bg + '\'">' +
          '<td style="padding:16px 22px;color:#e4c472;font-family:\'Inter\',sans-serif;font-size:13px;font-weight:700;letter-spacing:0.03em;">' + entry.num + '</td>' +
          '<td style="padding:16px 22px;color:#ccc;font-family:\'Inter\',sans-serif;font-size:14px;">' + _escHtmlInsc(r.date) + '</td>' +
          '<td style="padding:16px 22px;color:#ccc;font-family:\'Inter\',sans-serif;font-size:14px;">' + _escHtmlInsc(r.heure) + '</td>' +
          '<td style="padding:16px 22px;color:#fff;font-family:\'Inter\',sans-serif;font-size:14px;font-weight:600;">' + _escHtmlInsc(r.nom) + '</td>' +
          '<td style="padding:16px 22px;color:#d4af37;font-family:\'Inter\',sans-serif;font-size:14px;font-weight:600;">' + _escHtmlInsc(r.tel) + '</td>' +
          '<td style="padding:16px 22px;text-align:center;">' +
            '<button onclick="validerInscriptionRow(this)" style="cursor:pointer;font:inherit;background:linear-gradient(135deg,#2fae57 0%,#3fc96b 100%);color:#0e0e0e;border:none;border-radius:8px;padding:8px 16px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;box-shadow:0 3px 10px rgba(63,201,107,0.3);">&#10003; Valider</button>' +
          '</td>' +
        '</tr>';
      }).join('');
    })
    .catch(function() {
      if (countEl) countEl.textContent = '0';
      tbody.innerHTML = '<tr><td colspan="6" style="padding:48px;text-align:center;color:#f0786f;font-size:14px;">Erreur de chargement. V&eacute;rifie que le script Google est bien red&eacute;ploy&eacute; (acc&egrave;s "Tout le monde").</td></tr>';
    });
}

// ── Valider toutes les inscriptions visibles d'un coup ──────────────
// Envoie chaque ligne actuellement affichée dans "Membre à l'appel"
// et la marque comme validée, comme le fait "Valider" ligne par ligne.
function validerToutesInscriptions() {
  var tbody = document.getElementById('inscriptions-tbody');
  if (!tbody) return;
  var rows = Array.prototype.slice.call(tbody.querySelectorAll('tr[data-num]'));
  if (!rows.length) {
    alert('Aucune inscription à valider.');
    return;
  }
  if (!confirm('Valider les ' + rows.length + ' inscriptions affichées ? Elles seront envoyées dans "Membre à l\'appel".')) return;

  var validated = STORE.validatedInscriptions();
  var validatedSet = {};
  validated.forEach(function(num) { validatedSet[num] = true; });

  var appels = STORE.appels();

  rows.forEach(function(tr) {
    var num   = tr.getAttribute('data-num');
    var date  = tr.getAttribute('data-date');
    var heure = tr.getAttribute('data-heure');
    var nom   = tr.getAttribute('data-nom');
    var tel   = tr.getAttribute('data-tel');

    if (validatedSet[num]) return;
    validatedSet[num] = true;
    validated.push(num);

    appels.push({
      id: _appUid(),
      nom: nom,
      tel: tel,
      motif: 'Inscription validée (' + num + ')',
      date: date,
      dateInscription: date,
      heureInscription: heure || '',
      statut: 'À appeler',
      sourceNum: num,
      createdAt: new Date().toISOString()
    });
  });

  STORE.saveValidatedInscriptions(validated);
  STORE.saveAppels(appels);

  loadInscriptions();
  loadDashboardInscriptionsCount();
  renderAppels();
  alert('Toutes les inscriptions ont été validées.');
}

// ── Valider une inscription : l'enregistre dans "Membre à l'appel" et la retire de la liste ──
function validerInscriptionRow(btn) {
  var tr = btn.closest('tr');
  if (!tr) return;
  var num   = tr.getAttribute('data-num');
  var date  = tr.getAttribute('data-date');
  var heure = tr.getAttribute('data-heure');
  var nom   = tr.getAttribute('data-nom');
  var tel   = tr.getAttribute('data-tel');

  var validated = STORE.validatedInscriptions();
  if (validated.indexOf(num) === -1) {
    validated.push(num);
    STORE.saveValidatedInscriptions(validated);
  }

  var appels = STORE.appels();
  appels.push({
    id: _appUid(),
    nom: nom,
    tel: tel,
    motif: 'Inscription validée (' + num + ')',
    date: date,
    dateInscription: date,
    heureInscription: heure || '',
    statut: 'À appeler',
    sourceNum: num,
    createdAt: new Date().toISOString()
  });
  STORE.saveAppels(appels);

  loadInscriptions();
  renderAppels();
}

// ── Affiche la liste "Membre à l'appel" ───────────────────────────────
function renderAppels() {
  var tbody = document.getElementById('appel-tbody');
  var countEl = document.getElementById('appel-count');
  if (!tbody) return;
  var appels = STORE.appels().slice().sort(function(a, b) {
    var na = a.sourceNum || '';
    var nb = b.sourceNum || '';
    if (na && nb) return na.localeCompare(nb, undefined, { numeric: true });
    if (na && !nb) return -1;
    if (!na && nb) return 1;
    return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
  });
  if (countEl) countEl.textContent = String(appels.length);
  if (!appels.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="padding:32px;text-align:center;color:#666;font-size:13px;">&#128222; Aucun appel pour le moment.</td></tr>';
    return;
  }
  var STATUT_DISPLAY = {
    'À appeler':             { bg: 'linear-gradient(135deg,#c9a84c 0%,#e4c472 100%)', color: '#0e0e0e', border: 'none', label: 'À appeler' },
    'Numéro injoignable':    { bg: '#241313', color: '#ff8c82', border: '1px solid rgba(192,57,43,0.4)', label: '📞⚠ Numéro injoignable' },
    'Numéro faux':           { bg: '#241313', color: '#ff8c82', border: '1px solid rgba(192,57,43,0.4)', label: '❌ Numéro faux' },
    'Candidat sérieux':      { bg: '#132418', color: '#7be698', border: '1px solid rgba(63,201,107,0.4)', label: '✅ Candidat sérieux' },
    'Candidat fantaisiste':  { bg: '#241f0f', color: '#e4c472', border: '1px solid rgba(201,168,76,0.4)', label: '🤔 Candidat fantaisiste' }
  };
  tbody.innerHTML = appels.map(function(a) {
    var statut = a.statut || 'À appeler';
    var style = STATUT_DISPLAY[statut] || STATUT_DISPLAY['À appeler'];
    return '<tr style="border-bottom:1px solid #1a1a1a;">' +
      '<td style="padding:12px 16px;color:#fff;font-size:13px;font-weight:600;">' + _escHtmlInsc(a.nom) + (a.prenom ? ' ' + _escHtmlInsc(a.prenom) : '') + '</td>' +
      '<td style="padding:12px 16px;color:#d4af37;font-size:13px;font-weight:600;">' + _escHtmlInsc(a.tel) + '</td>' +
      '<td style="padding:12px 16px;color:#ccc;font-size:13px;">' + _escHtmlInsc(a.motif) + '</td>' +
      '<td style="padding:12px 16px;color:#ccc;font-size:13px;">' + _escHtmlInsc(a.date) + '</td>' +
      '<td style="padding:12px 16px;font-size:13px;">' +
        '<button onclick="openAppelFicheModal(\'' + a.id + '\')" style="cursor:pointer;font:inherit;background:' + style.bg + ';color:' + style.color + ';border:' + style.border + ';border-radius:8px;padding:6px 12px;font-size:11px;font-weight:700;text-transform:uppercase;white-space:nowrap;">' + style.label + '</button>' +
      '</td>' +
    '</tr>';
  }).join('');
}

// ── Remise à zéro des 3 listes (Paramètres) ──────────────────────────
// - Liste d'inscription : marque toutes les lignes actuelles du Google Sheet
//   comme "validées" pour qu'elles disparaissent de l'app (les données restent
//   dans le Sheet, elles ne sont plus affichées ici).
// - Membre à l'appel + Liste conforme : vidées définitivement (Liste conforme
//   étant dérivée de "Membre à l'appel", la vider suffit aux deux).
function reinitialiserListes() {
  if (!confirm('Réinitialiser "Liste d\'inscription", "Membre à l\'appel" et "Liste conforme" ?\n\nLa liste d\'inscription s\'affichera à zéro (les données restent dans le Google Sheet). "Membre à l\'appel" et "Liste conforme" seront effacées définitivement.\n\nCette action est irréversible. Continuer ?')) return;

  fetch(INSCRIPTIONS_SCRIPT_URL + '?_=' + Date.now())
    .then(function(r) { return r.json(); })
    .then(function(json) {
      var rows = (json && json.rows) || [];
      var validated = STORE.validatedInscriptions();
      var validatedSet = {};
      validated.forEach(function(num) { validatedSet[num] = true; });
      rows.forEach(function(r, i) {
        var num = _uclNum(i);
        if (!validatedSet[num]) { validated.push(num); validatedSet[num] = true; }
      });
      STORE.saveValidatedInscriptions(validated);
    })
    .catch(function() {
      // Si le Sheet est injoignable, on continue quand même la remise à zéro locale.
    })
    .then(function() {
      STORE.saveAppels([]);
      loadInscriptions();
      loadDashboardInscriptionsCount();
      renderAppels();
      renderListeConforme();
      alert('Les 3 listes ont été réinitialisées.');
    });
}

// ── Réafficher toutes les inscriptions du Sheet (annule la remise à zéro) ──
// Retire le filtre "validées" afin que toutes les lignes du Google Sheet
// redeviennent visibles dans "Liste d'inscription".
function reafficherInscriptions() {
  if (!confirm('Réafficher toutes les inscriptions du Google Sheet dans "Liste d\'inscription" ?')) return;
  STORE.saveValidatedInscriptions([]);
  loadInscriptions();
  loadDashboardInscriptionsCount();
  alert('Toutes les inscriptions du Sheet sont de nouveau affichées.');
}

// ── Liste conforme — auto : Candidats sérieux issus de "Membre à l'appel" ──
function renderListeConforme() {
  var tbody = document.getElementById('conformite-tbody');
  var countEl = document.getElementById('conformite-count');
  if (!tbody) return;
  var conformes = STORE.appels().filter(function(a) {
    return a.statut === 'Candidat sérieux';
  }).sort(function(a, b) {
    return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
  });
  if (countEl) countEl.textContent = String(conformes.length);
  if (!conformes.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="padding:32px;text-align:center;color:#666;font-size:13px;">&#9989; Aucun candidat s&eacute;rieux pour le moment.</td></tr>';
    return;
  }
  tbody.innerHTML = conformes.map(function(a) {
    return '<tr style="border-bottom:1px solid #1a1a1a;">' +
      '<td style="padding:12px 16px;color:#fff;font-size:13px;font-weight:600;">' + _escHtmlInsc(a.nom) + (a.prenom ? ' ' + _escHtmlInsc(a.prenom) : '') + '</td>' +
      '<td style="padding:12px 16px;color:#d4af37;font-size:13px;font-weight:600;">' + _escHtmlInsc(a.tel) + '</td>' +
      '<td style="padding:12px 16px;color:#ccc;font-size:13px;">' + _escHtmlInsc(a.ville) + '</td>' +
      '<td style="padding:12px 16px;color:#ccc;font-size:13px;">' + _escHtmlInsc(a.niveau) + '</td>' +
      '<td style="padding:12px 16px;color:#ccc;font-size:13px;">' + _escHtmlInsc(a.domaine) + '</td>' +
      '<td style="padding:12px 16px;font-size:13px;">' +
        '<span style="background:#132418;color:#7be698;border:1px solid rgba(63,201,107,0.4);border-radius:8px;padding:6px 12px;font-size:11px;font-weight:700;text-transform:uppercase;white-space:nowrap;">&#9989; Candidat s&eacute;rieux</span>' +
      '</td>' +
    '</tr>';
  }).join('');
}

// ── Fiche d'appel (modal) ─────────────────────────────────────────────
// ── Script d'appel — éditable depuis Paramètres ───────────────────────
var _defaultCallScript =
  '« Bonjour, je vous appelle de la part du club Uthina Chess suite à votre inscription sur notre site. Avez-vous quelques minutes à m\'accorder ? »\n\n' +
  '« J\'aimerais vérifier quelques informations avec vous : votre ville de résidence, votre âge, votre niveau aux échecs (débutant, intermédiaire, avancé, classement Elo si vous en avez), ainsi que votre domaine d\'activité ou d\'études. »\n\n' +
  '« Souhaitez-vous également des informations sur nos prochains tournois et cours au club ? »\n\n' +
  '« Merci pour votre temps, à très bientôt au club ! »';

function getCallScript() {
  return _storeGet('mp_call_script', JSON.stringify(_defaultCallScript));
}
function saveCallScript(text) {
  _storeSave('mp_call_script', text);
}
function loadSettingsCallScript() {
  var el = document.getElementById('settings-call-script');
  if (el) el.value = getCallScript();
}
function saveCallScriptFromSettings() {
  var el = document.getElementById('settings-call-script');
  if (!el) return;
  saveCallScript(el.value);
  if (typeof _tchToast === 'function') _tchToast('Script enregistré ✓', 'success');
  else alert('Script enregistré.');
}
function resetCallScriptToDefault() {
  if (!confirm('Réinitialiser le script par défaut ?')) return;
  saveCallScript(_defaultCallScript);
  loadSettingsCallScript();
  if (typeof _tchToast === 'function') _tchToast('Script réinitialisé', 'info');
}

// ── Synchronisation Google Sheet — Liste conforme ─────────────────────
function getSheetWebhookUrl() {
  return _storeGet('mp_sheet_webhook_url', JSON.stringify(''));
}
function saveSheetWebhookUrl(url) {
  _storeSave('mp_sheet_webhook_url', url);
}
function loadSettingsSheetUrl() {
  var el = document.getElementById('settings-sheet-url');
  if (el) el.value = getSheetWebhookUrl();
}
function saveSheetUrlFromSettings() {
  var el = document.getElementById('settings-sheet-url');
  if (!el) return;
  saveSheetWebhookUrl(el.value.trim());
  if (typeof _tchToast === 'function') _tchToast('URL Google Sheet enregistrée ✓', 'success');
  else alert('URL enregistrée.');
}
function testSheetWebhookFromSettings() {
  var url = getSheetWebhookUrl();
  if (!url) { alert('Colle d\'abord ton URL Google Apps Script, puis Enregistrer.'); return; }
  pushToGoogleSheet({
    id: 'test-' + Date.now(),
    nom: 'Test', prenom: 'Connexion', tel: '00000000', ville: 'Test',
    age: '', niveau: '', domaine: '', note: 'Ceci est un test depuis Paramètres.',
    dateInscription: new Date().toLocaleDateString('fr-FR'),
    heureInscription: new Date().toLocaleTimeString('fr-FR'),
    dateAppel: new Date().toLocaleDateString('fr-FR'),
    heureAppel: new Date().toLocaleTimeString('fr-FR'),
    statut: 'Candidat sérieux'
  });
  alert('Requête de test envoyée. Vérifie ta Google Sheet (une ligne "Test Connexion" doit apparaître).');
}
// Envoie une fiche (Candidat sérieux) vers la Google Sheet configurée.
// mode:'no-cors' car Apps Script ne renvoie pas d'en-têtes CORS lisibles
// depuis un autre domaine — la requête part bien malgré l'absence de réponse lisible.
function pushToGoogleSheet(a) {
  var url = getSheetWebhookUrl();
  if (!url) return;
  try {
    fetch(url, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(a)
    }).catch(function() { /* silencieux : pas de réseau ou URL invalide */ });
  } catch (e) { /* ignore */ }
}

var MOIS_NOMS = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];

function _populateNaissanceSelects() {
  var jourSel = document.getElementById('appel-fiche-f-jour');
  var moisSel = document.getElementById('appel-fiche-f-mois');
  var anneeSel = document.getElementById('appel-fiche-f-annee');
  if (!jourSel || !moisSel || !anneeSel) return;
  if (jourSel.options.length > 1) return; // déjà rempli

  for (var j = 1; j <= 31; j++) {
    var optJ = document.createElement('option');
    optJ.value = String(j);
    optJ.textContent = String(j);
    jourSel.appendChild(optJ);
  }

  MOIS_NOMS.forEach(function(m) {
    var optM = document.createElement('option');
    optM.value = m;
    optM.textContent = m;
    moisSel.appendChild(optM);
  });

  var currentYear = new Date().getFullYear();
  for (var y = currentYear; y >= 1940; y--) {
    var optY = document.createElement('option');
    optY.value = String(y);
    optY.textContent = String(y);
    anneeSel.appendChild(optY);
  }
}

function openAppelFicheModal(id) {
  var appels = STORE.appels();
  var a = appels.find(function(x) { return x.id === id; });
  if (!a) return;
  var scriptEl = document.getElementById('appel-fiche-script');
  if (scriptEl) scriptEl.textContent = getCallScript();
  _populateNaissanceSelects();
  document.getElementById('appel-fiche-id').value = id;
  document.getElementById('appel-fiche-nom').textContent = (a.nom || '') + (a.prenom ? ' ' + a.prenom : '');
  document.getElementById('appel-fiche-f-nom').value = a.nom || '';
  document.getElementById('appel-fiche-f-prenom').value = a.prenom || '';
  document.getElementById('appel-fiche-f-ville').value = a.ville || '';
  document.getElementById('appel-fiche-f-jour').value = a.njour || '';
  document.getElementById('appel-fiche-f-mois').value = a.nmois || '';
  document.getElementById('appel-fiche-f-annee').value = a.nannee || '';
  document.getElementById('appel-fiche-f-niveau').value = a.niveau || '';
  document.getElementById('appel-fiche-f-domaine').value = a.domaine || '';
  document.getElementById('appel-fiche-f-note').value = a.note || '';
  document.getElementById('appel-fiche-result').value = (a.statut && a.statut !== 'À appeler') ? a.statut : '';

  document.querySelectorAll('.appel-result-btn').forEach(function(btn) {
    var active = btn.getAttribute('data-result') === document.getElementById('appel-fiche-result').value;
    btn.style.outline = active ? '2px solid #fff' : 'none';
    btn.style.opacity = (!document.getElementById('appel-fiche-result').value || active) ? '1' : '0.55';
  });

  document.getElementById('appel-fiche-modal').style.display = 'flex';
}

function closeAppelFicheModal() {
  document.getElementById('appel-fiche-modal').style.display = 'none';
}

function setAppelResult(btn) {
  var val = btn.getAttribute('data-result');
  var current = document.getElementById('appel-fiche-result').value;
  var next = (current === val) ? '' : val; // re-clique pour désélectionner
  document.getElementById('appel-fiche-result').value = next;
  document.querySelectorAll('.appel-result-btn').forEach(function(b) {
    var active = b.getAttribute('data-result') === next;
    b.style.outline = active ? '2px solid #fff' : 'none';
    b.style.opacity = (!next || active) ? '1' : '0.55';
  });
}

function saveAppelFiche() {
  var id = document.getElementById('appel-fiche-id').value;
  var appels = STORE.appels();
  var a = appels.find(function(x) { return x.id === id; });
  if (!a) return;

  a.nom     = document.getElementById('appel-fiche-f-nom').value.trim();
  a.prenom  = document.getElementById('appel-fiche-f-prenom').value.trim();
  a.ville   = document.getElementById('appel-fiche-f-ville').value.trim();
  a.njour   = document.getElementById('appel-fiche-f-jour').value;
  a.nmois   = document.getElementById('appel-fiche-f-mois').value;
  a.nannee  = document.getElementById('appel-fiche-f-annee').value;
  if (a.njour && a.nmois && a.nannee) {
    a.dateNaissance = a.njour + ' ' + a.nmois + ' ' + a.nannee;
    var moisIdx = MOIS_NOMS.indexOf(a.nmois);
    var bDate = new Date(parseInt(a.nannee, 10), moisIdx, parseInt(a.njour, 10));
    var today = new Date();
    var ageCalc = today.getFullYear() - bDate.getFullYear();
    var mDiff = today.getMonth() - bDate.getMonth();
    if (mDiff < 0 || (mDiff === 0 && today.getDate() < bDate.getDate())) ageCalc--;
    a.age = String(ageCalc);
  } else {
    a.dateNaissance = '';
    a.age = '';
  }
  a.niveau  = document.getElementById('appel-fiche-f-niveau').value.trim();
  a.domaine = document.getElementById('appel-fiche-f-domaine').value.trim();
  a.note    = document.getElementById('appel-fiche-f-note').value.trim();

  var result = document.getElementById('appel-fiche-result').value;
  a.statut = result || 'À appeler';

  if (result && !a.dateAppel) {
    var now = new Date();
    a.dateAppel  = now.toLocaleDateString('fr-FR');
    a.heureAppel = now.toLocaleTimeString('fr-FR');
  }

  STORE.saveAppels(appels);
  closeAppelFicheModal();
  renderAppels();
  renderListeConforme();

  if (a.statut === 'Candidat sérieux') pushToGoogleSheet(a);
}

// ── Routing → js/core/router.js ────────────────────────────────────
// showView, updateSidebarStats, currentPage, navigateTo, showPage

// ══════════════════════════════════════════════════════════════════════
// CONTACT MANAGEMENT — répertoire de contacts (import téléphone + manuel)
// ══════════════════════════════════════════════════════════════════════

var _rcFilterBatchId = null; // null = tous les contacts ensemble ; sinon = un import précis

// Anti-rebond générique : évite de relancer un rendu coûteux à chaque frappe clavier
function _rcDebounce(fn, delay) {
  var t = null;
  return function() {
    var args = arguments, ctx = this;
    clearTimeout(t);
    t = setTimeout(function() { fn.apply(ctx, args); }, delay || 180);
  };
}

var _rcDebouncedRenderRepertoire = _rcDebounce(function() { renderRepertoireContactsPage(); }, 180);
var _rcDebouncedRenderAnnuaire   = _rcDebounce(function() { renderContactsDirectory(); }, 180);

// Appelée directement par les selects (tri/filtre) pour un retour instantané,
// et par le champ de recherche via une version anti-rebond (voir HTML : oninput).
function rcSearchInputChanged() {
  if (_rcActiveTab === 'annuaire') { _rcDebouncedRenderAnnuaire(); }
  else { _rcDebouncedRenderRepertoire(); }
}

function _rcInfo(msg, isError) {
  var el = document.getElementById('repertoire-contacts-info');
  if (!el) return;
  el.style.display = 'block';
  el.style.color = isError ? '#ef4444' : '#d4af37';
  el.style.borderColor = isError ? 'rgba(239,68,68,0.3)' : 'rgba(212,175,55,0.25)';
  el.style.background = isError ? 'rgba(239,68,68,0.08)' : 'rgba(212,175,55,0.08)';
  el.textContent = msg;
}

function _rcFormatDateTime(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  return d.toLocaleDateString('fr-FR') + ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

// Demande l'autorisation au téléphone (Contact Picker API — Chrome Android/Edge Android, HTTPS requis)
// et importe en UN SEUL CLIC tous les contacts choisis dans le tableau,
// en gardant une trace (date + heure) de cet import.
function importPhoneContacts() {
  if (!('contacts' in navigator) || !('ContactsManager' in window)) {
    _rcInfo('⚠️ L\'accès direct au répertoire du téléphone n\'est disponible que sur Chrome/Edge Android (HTTPS). Sur cet appareil/navigateur, ajoutez les contacts manuellement avec le bouton "+ Ajouter manuellement", ou importez-les via un export CSV de votre téléphone.', true);
    return;
  }

  var props = ['name', 'tel', 'email', 'address'];
  var opts  = { multiple: true };

  navigator.contacts.select(props, opts).then(function(selected) {
    if (!selected || !selected.length) return;

    var existing  = STORE.repertoireContacts();
    var nowIso    = new Date().toISOString();
    var batchId   = 'batch_' + Date.now();
    var added     = 0;
    var nextNum   = _rcMaxNumero(existing) + 1;

    selected.forEach(function(c) {
      var fullName = (c.name && c.name[0]) ? c.name[0] : '';
      var parts = fullName.trim().split(/\s+/);
      var prenom = parts.length > 1 ? parts.slice(0, -1).join(' ') : '';
      var nom    = parts.length > 1 ? parts[parts.length - 1] : fullName;

      var addr = (c.address && c.address[0]) || {};
      var adresseStr = [addr.addressLine, addr.dependentLocality].filter(Boolean).join(' ').trim();
      var ville = addr.city || '';
      var pays  = addr.country || '';

      var tel1 = _rcStripPhoneSpaces((c.tel && c.tel[0]) || '');
      var tel2 = _rcStripPhoneSpaces((c.tel && c.tel[1]) || '');
      var mail = (c.email && c.email[0]) || '';

      existing.push({
        id: 'rc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
        numero: String(nextNum).padStart(4, '0'),
        nom: nom || '', prenom: prenom || '',
        adresse: adresseStr, ville: ville, gouvernorat: '', pays: pays,
        tel1: tel1, tel2: tel2, email: mail,
        metier: '', domaine: '', note: '',
        importBatchId: batchId,
        updatedAt: nowIso
      });
      nextNum++;
      added++;
    });

    if (added > 0) {
      STORE.saveRepertoireContacts(existing);
      var imports = STORE.repertoireImports();
      imports.push({ id: batchId, date: nowIso, count: added, label: '', source: 'phone' });
      STORE.saveRepertoireImports(imports);
    }

    _rcFilterBatchId = null;
    renderRepertoireContactsPage();
    renderRepertoireImportsHistory();
    _rcRenderDuplicatesBanner();
    _rcInfo('✓ ' + added + ' contact(s) importé(s) le ' + _rcFormatDateTime(nowIso) + '. Complétez Gouvernorat / Métier / Domaine / Note si besoin.', false);
  }).catch(function(err) {
    // L'utilisateur a annulé ou a refusé l'autorisation
    if (err && err.name === 'SecurityError') {
      _rcInfo('⚠️ Autorisation refusée ou page non sécurisée (HTTPS requis). Réessayez et acceptez l\'accès aux contacts.', true);
    } else {
      _rcInfo('⚠️ Import annulé.', true);
    }
  });
}

// ---- Import 100% en ligne via Google Contacts (OAuth côté serveur) ----
// L'utilisateur clique sur "Se connecter avec Google" -> redirigé vers
// google_auth.php (sur le VPS) -> Google -> google_callback.php (sur le VPS,
// échange le code, appelle People API, récupère TOUS les contacts d'un coup)
// -> redirige vers index.html?googleImportToken=XXXX -> ce script récupère
// le résultat une seule fois via google_fetch_result.php et l'importe.

function startGoogleContactsImport() {
  window.location.href = 'google_auth.php';
}

function _checkGoogleImportToken() {
  var params = new URLSearchParams(window.location.search);
  var token = params.get('googleImportToken');
  if (!token) return;

  // Nettoie l'URL tout de suite pour éviter un double-import si on recharge
  params.delete('googleImportToken');
  var newUrl = window.location.pathname + (params.toString() ? '?' + params.toString() : '') + window.location.hash;
  window.history.replaceState({}, '', newUrl);

  fetch('google_fetch_result.php?token=' + encodeURIComponent(token))
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (!data || data.ok === false) {
        _rcInfo('⚠️ Import Google introuvable ou déjà utilisé. Réessayez "Se connecter avec Google".', true);
        return;
      }

      // Important : google_callback.php a déjà enregistré ces contacts
      // directement côté serveur (source de vérité unique) AVANT cette
      // redirection. On ne les ré-envoie donc plus nous-mêmes depuis le
      // navigateur — un import volumineux (1000+ contacts) ne dépend plus
      // du quota localStorage ni d'un envoi réseau qui pouvait être perdu
      // si la page était rechargée trop vite (d'où les imports affichant
      // "X importés" mais "0 contact(s)" constatés précédemment).
      // On se contente de resynchroniser l'affichage local depuis le serveur.
      var count = (data.batch && data.batch.count) || (data.contacts ? data.contacts.length : 0);
      syncFromServer(function() {
        _rcFilterBatchId = null;
        showView('gestion-contacts');
        renderRepertoireContactsPage();
        renderRepertoireImportsHistory();
        _rcRenderDuplicatesBanner();
        _rcInfo('✓ ' + count + ' contact(s) importé(s) automatiquement depuis Google.', false);
      });
    })
    .catch(function() {
      _rcInfo('⚠️ Erreur réseau pendant l\'import Google.', true);
    });
}

document.addEventListener('DOMContentLoaded', function() {
  setTimeout(_checkGoogleImportToken, 800);
});

// ---- Import "tout en un coup" via fichier .vcf (sans sélection manuelle) ----
// L'API Contact Picker du navigateur impose toujours une sélection manuelle de
// l'utilisateur (restriction de confidentialité imposée par le standard W3C, pas
// contournable en JS). Pour importer absolument tous les contacts d'un coup sans
// rien cocher, l'utilisateur exporte ses contacts du téléphone en un seul fichier
// .vcf (vCard) et on le parse ici en entier.

function triggerContactsFileImport() {
  var input = document.getElementById('rc-file-input');
  if (input) input.click();
}

function _vcUnescape(s) {
  return String(s || '').replace(/\\n/gi, ' ').replace(/\\,/g, ',').replace(/\\;/g, ';');
}

function _parseVCardFile(text) {
  var contacts = [];
  var blocks = String(text || '').split(/BEGIN:VCARD/i).slice(1);
  blocks.forEach(function(block) {
    var lines = block.split(/\r\n|\n|\r/);
    var c = { fn: '', n: '', tels: [], emails: [], adr: '' };
    lines.forEach(function(line) {
      line = line.trim();
      if (!line || /^END:VCARD/i.test(line)) return;
      var idx = line.indexOf(':');
      if (idx === -1) return;
      var keyPart = line.slice(0, idx);
      var value = line.slice(idx + 1);
      var key = keyPart.split(';')[0].toUpperCase();
      if (key === 'FN') c.fn = value;
      else if (key === 'N') c.n = value;
      else if (key === 'TEL') c.tels.push(value);
      else if (key === 'EMAIL') c.emails.push(value);
      else if (key === 'ADR') c.adr = value;
    });
    if (c.fn || c.n || c.tels.length || c.emails.length) contacts.push(c);
  });
  return contacts;
}

function handleContactsFileImport(event) {
  var file = event.target.files && event.target.files[0];
  if (!file) return;

  var reader = new FileReader();
  reader.onload = function(e) {
    var parsed = _parseVCardFile(e.target.result);
    if (!parsed.length) {
      _rcInfo('⚠️ Aucun contact trouvé dans ce fichier. Vérifiez que c\'est bien un export .vcf de votre téléphone (app Contacts → Exporter → vCard).', true);
      event.target.value = '';
      return;
    }

    var existing = STORE.repertoireContacts();
    var nowIso   = new Date().toISOString();
    var batchId  = 'batch_' + Date.now();
    var nextNum  = _rcMaxNumero(existing) + 1;
    var added    = 0;

    parsed.forEach(function(c) {
      var nom = '', prenom = '';
      if (c.n) {
        var np = c.n.split(';').map(_vcUnescape);
        nom = np[0] || ''; prenom = np[1] || '';
      } else if (c.fn) {
        var fullName = _vcUnescape(c.fn);
        var parts = fullName.trim().split(/\s+/);
        prenom = parts.length > 1 ? parts.slice(0, -1).join(' ') : '';
        nom = parts.length > 1 ? parts[parts.length - 1] : fullName;
      }

      var adresseStr = '', ville = '', pays = '';
      if (c.adr) {
        var ap = c.adr.split(';').map(_vcUnescape);
        adresseStr = ap[2] || '';
        ville      = ap[3] || '';
        pays       = ap[6] || '';
      }

      var tel1 = c.tels[0] ? _rcStripPhoneSpaces(_vcUnescape(c.tels[0])) : '';
      var tel2 = c.tels[1] ? _rcStripPhoneSpaces(_vcUnescape(c.tels[1])) : '';
      var mail = c.emails[0] ? _vcUnescape(c.emails[0]) : '';

      if (!nom && !prenom && !tel1 && !mail) return;

      existing.push({
        id: 'rc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
        numero: String(nextNum).padStart(4, '0'),
        nom: nom || '', prenom: prenom || '',
        adresse: adresseStr, ville: ville, gouvernorat: '', pays: pays,
        tel1: tel1, tel2: tel2, email: mail,
        metier: '', domaine: '', note: '',
        importBatchId: batchId,
        updatedAt: nowIso
      });
      nextNum++;
      added++;
    });

    if (added > 0) {
      STORE.saveRepertoireContacts(existing);
      var imports = STORE.repertoireImports();
      imports.push({ id: batchId, date: nowIso, count: added, label: '', source: 'file' });
      STORE.saveRepertoireImports(imports);
    }

    _rcFilterBatchId = null;
    renderRepertoireContactsPage();
    renderRepertoireImportsHistory();
    _rcRenderDuplicatesBanner();
    _rcInfo('✓ ' + added + ' contact(s) importé(s) en un seul coup depuis le fichier le ' + _rcFormatDateTime(nowIso) + '.', false);
    event.target.value = '';
  };
  reader.onerror = function() {
    _rcInfo('⚠️ Erreur de lecture du fichier.', true);
    event.target.value = '';
  };
  reader.readAsText(file);
}

// Affiche l'historique des imports (date + heure + nombre de contacts), cliquable
// pour filtrer le tableau sur un import précis. Le bouton "Voir tous les contacts
// ensemble" (dans le HTML) remet le filtre à null.
function renderRepertoireImportsHistory() {
  var el = document.getElementById('repertoire-imports-history');
  if (!el) return;

  var imports = STORE.repertoireImports().slice().sort(function(a, b) {
    return String(b.date || '').localeCompare(String(a.date || ''));
  });

  if (!imports.length) {
    el.innerHTML = '<div style="color:#666; font-size:12px; padding:6px 0;">Aucun import effectué pour l\'instant.</div>';
    return;
  }

  // Compte réel actuel par import (et non le compte figé au moment de l'import) :
  // après une fusion de doublons ou une suppression, des contacts disparaissent
  // de leur import d'origine — l'ancien compte figé devenait alors trompeur
  // (ex. "1681 contact(s)" affiché alors que la liste filtrée était vide).
  var allContacts = STORE.repertoireContacts();
  var liveCounts = {};
  allContacts.forEach(function(c) {
    if (c.importBatchId) liveCounts[c.importBatchId] = (liveCounts[c.importBatchId] || 0) + 1;
  });

  el.innerHTML = imports.map(function(imp) {
    var active = _rcFilterBatchId === imp.id;
    var icon = imp.source === 'file' ? '&#128193;' : '&#128241;';
    var liveCount = liveCounts[imp.id] || 0;
    var countLabel = liveCount + ' contact(s)' + (liveCount !== imp.count ? ' (sur ' + imp.count + ' import&eacute;s)' : '');
    return '<div style="display:flex; align-items:center; justify-content:space-between; gap:10px; padding:8px 12px; border-radius:6px; flex-wrap:wrap; background:' + (active ? 'rgba(212,175,55,0.12)' : '#161616') + '; border:1px solid ' + (active ? 'rgba(212,175,55,0.4)' : '#2a2a2a') + ';">'
      + '<span onclick="setRepertoireContactsFilter(\'' + imp.id + '\')" style="cursor:pointer; color:' + (active ? '#d4af37' : '#ccc') + '; font-size:12.5px; white-space:nowrap;">' + icon + ' Import du ' + esc(_rcFormatDateTime(imp.date)) + '</span>'
      + '<input type="text" value="' + esc(imp.label || '') + '" placeholder="Ajouter une note (ex: import du téléphone Oth)"'
      + ' onclick="event.stopPropagation()"'
      + ' onchange="updateRepertoireImportLabel(\'' + imp.id + '\', this.value)"'
      + ' style="flex:1; min-width:160px; padding:5px 9px; background:#0e0e0e; border:1px solid #2a2a2a; border-radius:6px; color:#e8e4dc; font-size:12px;">'
      + '<span onclick="setRepertoireContactsFilter(\'' + imp.id + '\')" style="cursor:pointer; color:' + (liveCount === 0 ? '#a33' : '#888') + '; font-size:11.5px; font-weight:700; white-space:nowrap;" title="' + (liveCount === 0 ? 'Tous les contacts de cet import ont été fusionnés ou supprimés' : '') + '">' + countLabel + '</span>'
      + '<button onclick="event.stopPropagation(); deleteRepertoireImport(\'' + imp.id + '\')" title="Supprimer cet import et ses contacts" style="background:none; border:1px solid #4a2a2a; color:#c66; border-radius:6px; padding:3px 8px; font-size:13px; cursor:pointer; line-height:1;">&times;</button>'
      + '</div>';
  }).join('');
}

// Supprime un import de l'historique ET tous les contacts qui en restent
// (avec tombstone pour empêcher leur résurrection lors d'une synchro ultérieure).
function deleteRepertoireImport(batchId) {
  var imports  = STORE.repertoireImports();
  var imp      = imports.find(function(i) { return i.id === batchId; });
  if (!imp) return;
  var contacts = STORE.repertoireContacts();
  var toRemove = contacts.filter(function(c) { return c.importBatchId === batchId; });
  var label    = imp.label ? ('« ' + imp.label + ' »') : ('du ' + _rcFormatDateTime(imp.date));
  if (!confirm('Supprimer l\'import ' + label + ' ainsi que ' + toRemove.length + ' contact(s) associé(s) ? Cette action est irréversible.')) return;

  var kept = contacts.filter(function(c) { return c.importBatchId !== batchId; });
  STORE.saveRepertoireContacts(kept);
  toRemove.forEach(function(c) { _markDeleted('mp_repertoire_contacts', c.id); });

  STORE.saveRepertoireImports(imports.filter(function(i) { return i.id !== batchId; }));
  _markDeleted('mp_repertoire_imports', batchId); // empêche la résurrection de l'import lors d'une synchro ultérieure

  if (_rcFilterBatchId === batchId) _rcFilterBatchId = null;
  renderRepertoireContactsPage();
  renderRepertoireImportsHistory();
  if (typeof _rcRenderDuplicatesBanner === 'function') _rcRenderDuplicatesBanner();
  _rcInfo('✓ Import supprimé (' + toRemove.length + ' contact(s) retiré(s)).', false);
}

function updateRepertoireImportLabel(batchId, label) {
  var imports = STORE.repertoireImports();
  var imp = imports.find(function(i) { return i.id === batchId; });
  if (!imp) return;
  imp.label = label;
  STORE.saveRepertoireImports(imports);
}

// Bascule le tableau entre "un import précis" (batchId) et "tous les contacts ensemble" (null)
function setRepertoireContactsFilter(batchId) {
  _rcFilterBatchId = batchId;
  renderRepertoireContactsPage();
  renderRepertoireImportsHistory();
  // Fait défiler jusqu'au tableau : sur petit écran (mobile), la liste filtrée
  // se trouve plus bas que l'historique d'imports et passait inaperçue.
  setTimeout(function() {
    var wrap = document.querySelector('#rc-panel-repertoire .rc-table-wrap') || document.getElementById('repertoire-contacts-tbody');
    if (wrap && wrap.scrollIntoView) wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 30);
}

// Numéro interne séquentiel (0001, 0002, ...) basé sur le plus grand numéro existant
function _rcMaxNumero(list) {
  var max = 0;
  (list || []).forEach(function(c) {
    var n = parseInt(c.numero, 10);
    if (!isNaN(n) && n > max) max = n;
  });
  return max;
}

function addRepertoireContactRow() {
  var list = STORE.repertoireContacts();
  var numero = String(_rcMaxNumero(list) + 1).padStart(4, '0');
  list.push({
    id: 'rc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    numero: numero,
    nom: '', prenom: '', adresse: '', ville: '', gouvernorat: '', pays: '',
    tel1: '', tel2: '', email: '', metier: '', domaine: '', note: '',
    importBatchId: null,
    tags: [], responsable: '', nextFollowUp: '', historique: [],
    updatedAt: new Date().toISOString()
  });
  STORE.saveRepertoireContacts(list);
  _rcFilterBatchId = null;
  renderRepertoireContactsPage();
  renderRepertoireImportsHistory();
}

function updateRepertoireContactField(id, field, value) {
  var list = STORE.repertoireContacts();
  var item = list.find(function(c) { return c.id === id; });
  if (!item) return;
  if (field === 'tel1' || field === 'tel2') value = _rcStripPhoneSpaces(value);
  item[field] = value;
  item.updatedAt = new Date().toISOString();
  STORE.saveRepertoireContacts(list);
}

// Supprime tous les espaces dans un numéro de téléphone (Tél 1 / Tél 2), sans toucher au reste.
function _rcStripPhoneSpaces(s) {
  return String(s || '').replace(/\s+/g, '');
}

function deleteRepertoireContact(id) {
  if (!confirm('Supprimer ce contact ?')) return;
  STORE.saveRepertoireContacts(STORE.repertoireContacts().filter(function(c) { return c.id !== id; }));
  _markDeleted('mp_repertoire_contacts', id); // empêche la résurrection du contact lors d'une synchro ultérieure
  renderRepertoireContactsPage();
  renderRepertoireImportsHistory();
}

// Attribue un numéro aux contacts existants qui n'en ont pas encore (anciens contacts
// créés avant l'ajout de la numérotation interne).
function _rcBackfillNumeros() {
  var list = STORE.repertoireContacts();
  var nextNum = _rcMaxNumero(list) + 1;
  var changed = false;
  list.forEach(function(c) {
    if (!c.numero) {
      c.numero = String(nextNum).padStart(4, '0');
      nextNum++;
      changed = true;
    }
  });
  if (changed) STORE.saveRepertoireContacts(list);
}

// ── Détection et fusion des doublons (téléphone ou email identiques) ──────
function _rcDetectDuplicateGroups() {
  var all = STORE.repertoireContacts();
  var byPhone = {}, byEmail = {};
  all.forEach(function(c) {
    var p = _rcCleanPhone(c.tel1);
    if (p) { (byPhone[p] = byPhone[p] || []).push(c); }
    var e = String(c.email || '').trim().toLowerCase();
    if (e) { (byEmail[e] = byEmail[e] || []).push(c); }
  });
  var groupsMap = {}; // id -> Set of ids in its group, via union of phone/email groups
  var groups = [];
  var seen = {};
  [byPhone, byEmail].forEach(function(map) {
    Object.keys(map).forEach(function(k) {
      var g = map[k];
      if (g.length < 2) return;
      var ids = g.map(function(c) { return c.id; }).sort();
      var key = ids.join(',');
      if (seen[key]) return;
      seen[key] = true;
      groups.push(g);
    });
  });
  return groups;
}

function _rcRenderDuplicatesBanner() {
  var el = document.getElementById('repertoire-duplicates-banner');
  if (!el) return;
  var groups = _rcDetectDuplicateGroups();
  if (!groups.length) { el.style.display = 'none'; el.innerHTML = ''; return; }

  el.style.display = '';
  el.innerHTML = '<div class="rc-dup-banner">'
    + '<div class="rc-dup-banner-title" style="display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap;">'
    + '<span>⚠️ ' + groups.length + ' groupe(s) de doublons potentiels d&eacute;tect&eacute;s (m&ecirc;me t&eacute;l&eacute;phone ou email).</span>'
    + (groups.length > 1 ? '<button class="btn btn-outline btn-sm" onclick="mergeAllDuplicateGroups()">Fusionner tous</button>' : '')
    + '</div>'
    + groups.map(function(g, gi) {
        return '<div class="rc-dup-group">'
          + g.map(function(c) {
              var name = ((c.prenom || '') + ' ' + (c.nom || '')).trim() || 'Sans nom';
              return '<span class="rc-dup-item">' + esc(name) + ' (' + esc(c.tel1 || c.email || '') + ')</span>';
            }).join(' &nbsp;/&nbsp; ')
          + ' <button class="btn btn-outline btn-sm" onclick="mergeDuplicateGroup(' + JSON.stringify(g.map(function(c){return c.id;})).replace(/"/g, '&quot;') + ')">Fusionner</button>'
          + '</div>';
      }).join('')
    + '</div>';
}

// Fusionne un groupe de doublons en un seul contact (logique pure, sans confirm()/render —
// utilisée à la fois par mergeDuplicateGroup et mergeAllDuplicateGroups). Conserve le premier
// comme contact canonique, complète ses champs vides avec ceux des autres, fusionne
// historique/tags, et renvoie la liste mise à jour (sans la sauvegarder).
function _rcMergeGroupInList(list, ids) {
  var group = ids.map(function(id) { return list.find(function(c) { return c.id === id; }); }).filter(Boolean);
  if (group.length < 2) return { list: list, merged: 0 };

  var primary = group[0];
  var others = group.slice(1);
  var simpleFields = ['nom','prenom','adresse','ville','gouvernorat','pays','tel1','tel2','email','metier','domaine','note','responsable','nextFollowUp'];

  others.forEach(function(o) {
    simpleFields.forEach(function(f) {
      if (!primary[f] && o[f]) primary[f] = o[f];
    });
    var tagsA = Array.isArray(primary.tags) ? primary.tags : [];
    var tagsB = Array.isArray(o.tags) ? o.tags : [];
    primary.tags = tagsA.concat(tagsB.filter(function(t) { return tagsA.indexOf(t) === -1; }));

    var histA = Array.isArray(primary.historique) ? primary.historique : [];
    var histB = Array.isArray(o.historique) ? o.historique : [];
    var histIds = histA.map(function(h) { return h.id; });
    histB.forEach(function(h) { if (histIds.indexOf(h.id) === -1) histA.push(h); });
    histA.sort(function(a, b) { return new Date(b.date) - new Date(a.date); });
    primary.historique = histA;
  });

  primary.updatedAt = new Date().toISOString();

  var otherIds = others.map(function(o) { return o.id; });
  var newList = list.filter(function(c) { return otherIds.indexOf(c.id) === -1; });
  return { list: newList, merged: group.length, removedIds: otherIds };
}

function mergeDuplicateGroup(ids) {
  if (!Array.isArray(ids) || ids.length < 2) return;
  if (!confirm('Fusionner ces ' + ids.length + ' contacts en un seul ? Cette action est irr&eacute;versible.')) return;

  var result = _rcMergeGroupInList(STORE.repertoireContacts(), ids);
  if (result.merged < 2) return;
  STORE.saveRepertoireContacts(result.list);
  (result.removedIds || []).forEach(function(rid) { _markDeleted('mp_repertoire_contacts', rid); });

  renderRepertoireContactsPage();
  _rcRenderDuplicatesBanner();
  if (_rcActiveTab === 'annuaire') renderContactsDirectory();
  _rcInfo('✓ Fusion effectu&eacute;e : ' + result.merged + ' contacts regroup&eacute;s en 1.', false);
}

// Fusionne en une seule fois tous les groupes de doublons détectés (un seul confirm()).
function mergeAllDuplicateGroups() {
  var groups = _rcDetectDuplicateGroups();
  if (!groups.length) return;

  var totalContacts = groups.reduce(function(n, g) { return n + g.length; }, 0);
  if (!confirm('Fusionner les ' + groups.length + ' groupes de doublons (' + totalContacts + ' contacts au total) ? Cette action est irr&eacute;versible.')) return;

  var list = STORE.repertoireContacts();
  var groupsCount = 0;
  var allRemovedIds = [];
  groups.forEach(function(g) {
    var ids = g.map(function(c) { return c.id; });
    var result = _rcMergeGroupInList(list, ids);
    if (result.merged >= 2) {
      list = result.list;
      groupsCount++;
      allRemovedIds = allRemovedIds.concat(result.removedIds || []);
    }
  });
  STORE.saveRepertoireContacts(list);
  allRemovedIds.forEach(function(rid) { _markDeleted('mp_repertoire_contacts', rid); });

  renderRepertoireContactsPage();
  _rcRenderDuplicatesBanner();
  if (_rcActiveTab === 'annuaire') renderContactsDirectory();
  _rcInfo('✓ Fusion globale effectu&eacute;e : ' + groupsCount + ' groupe(s) fusionn&eacute;(s).', false);
}

function renderRepertoireContactsPage() {
  var tbody = document.getElementById('repertoire-contacts-tbody');
  if (!tbody) return;

  _rcBackfillNumeros();

  var all = STORE.repertoireContacts();
  _rcPopulateDynamicFilters(all, 'rc-table-tag-filter', 'rc-table-responsable-filter');

  var list = _rcGetFilteredSortedContactsForTable();

  var activeFiltersCount = ['rc-table-filter-select', 'rc-table-tag-filter', 'rc-table-responsable-filter']
    .filter(function(id) { var el = document.getElementById(id); return el && el.value && el.value !== 'all'; }).length;

  var countEl = document.getElementById('repertoire-contacts-count');
  if (countEl) {
    var total = all.length;
    var scopeLabel = _rcFilterBatchId ? 'pour cet import' : 'tous ensemble';
    countEl.innerHTML = '<span class="cc-count-pill">' + list.length + ' affich&eacute;(s) ' + scopeLabel + '</span>'
      + '<span class="cc-count-pill">' + total + ' au total</span>'
      + (activeFiltersCount ? '<span class="cc-count-pill cc-count-today">' + activeFiltersCount + ' filtre(s) actif(s)</span>' : '');
  }

  var tabCountEl = document.getElementById('rc-tab-count-repertoire');
  if (tabCountEl) tabCountEl.textContent = all.length;

  if (_rcActiveTab === 'annuaire') renderContactsDirectory();

  var btnAll = document.getElementById('btn-rc-show-all');
  if (btnAll) {
    btnAll.style.borderColor = _rcFilterBatchId ? '#d4af37' : '';
    btnAll.style.color = _rcFilterBatchId ? '#d4af37' : '';
  }

  if (!list.length) {
    tbody.innerHTML = all.length
      ? '<tr><td colspan="14" style="padding:24px; text-align:center; color:#666;">Aucun contact ne correspond &agrave; ces filtres. <span style="color:#d4af37; cursor:pointer; text-decoration:underline;" onclick="_rcResetTableFilters()">R&eacute;initialiser les filtres</span></td></tr>'
      : '<tr><td colspan="14" style="padding:24px; text-align:center; color:#666;">Aucun contact. Importez depuis le t&eacute;l&eacute;phone ou ajoutez-en un manuellement.</td></tr>';
    return;
  }

  function cell(c, field, placeholder) {
    var isPhone = (field === 'tel1' || field === 'tel2');
    return '<td><input type="text" value="' + esc(c[field] || '') + '" placeholder="' + esc(placeholder || '') + '"'
      + ' onchange="updateRepertoireContactField(\'' + c.id + '\',\'' + field + '\',this.value);' + (isPhone ? ' this.value=this.value.replace(/\\s+/g,\'\');' : '') + '"'
      + '></td>';
  }

  tbody.innerHTML = list.map(function(c) {
    return '<tr>'
      + '<td onclick="openContactFiche(\'' + c.id + '\')" title="Voir la fiche">' + esc(c.numero || '----') + '</td>'
      + cell(c, 'nom', 'Nom')
      + cell(c, 'prenom', 'Prénom')
      + cell(c, 'adresse', 'Adresse')
      + cell(c, 'ville', 'Ville')
      + cell(c, 'gouvernorat', 'Gouvernorat')
      + cell(c, 'pays', 'Pays')
      + cell(c, 'tel1', 'Tél 1')
      + cell(c, 'tel2', 'Tél 2')
      + cell(c, 'email', 'Email')
      + cell(c, 'metier', 'Métier')
      + cell(c, 'domaine', 'Domaine')
      + cell(c, 'note', 'Note')
      + '<td class="rc-table-actions">'
      + '<button class="btn btn-outline btn-sm" onclick="openContactFiche(\'' + c.id + '\')" title="Voir la fiche" style="margin-right:4px;">Fiche</button>'
      + '<button class="btn btn-danger btn-sm" onclick="deleteRepertoireContact(\'' + c.id + '\')" title="Supprimer">&times;</button>'
      + '</td>'
      + '</tr>';
  }).join('');
}

// ---- Carnet d'adresses : bascule Répertoire (gestion) / Annuaire (appel rapide) ----
var _rcActiveTab = 'repertoire';

function setContactsTab(tab) {
  _rcActiveTab = tab;
  var panelRep = document.getElementById('rc-panel-repertoire');
  var panelAnn = document.getElementById('rc-panel-annuaire');
  var btnRep = document.getElementById('rc-tab-btn-repertoire');
  var btnAnn = document.getElementById('rc-tab-btn-annuaire');
  if (panelRep) panelRep.style.display = (tab === 'repertoire') ? '' : 'none';
  if (panelAnn) panelAnn.style.display = (tab === 'annuaire') ? '' : 'none';
  if (btnRep) btnRep.classList.toggle('active', tab === 'repertoire');
  if (btnAnn) btnAnn.classList.toggle('active', tab === 'annuaire');
  if (tab === 'annuaire') renderContactsDirectory();
}

function _rcInitials(c) {
  var n = ((c.prenom || '').trim().charAt(0) + (c.nom || '').trim().charAt(0)).trim();
  return (n || '?').toUpperCase();
}

function _rcCleanPhone(s) {
  return String(s || '').replace(/[^\d+]/g, '');
}

function _rcWhatsappNumber(s) {
  return String(s || '').replace(/[^\d]/g, '');
}

// ── Historique des interactions par contact ──────────────────────────
// Chaque contact porte un tableau c.historique = [{id, type, date, note, outcome}]
// type ∈ 'call' | 'whatsapp' | 'email' | 'note'. Le plus récent est en tête.
// outcome (uniquement utile pour type='call') ∈ 'interested' | 'refused' | 'no_answer' | 'callback'.
var RC_HISTORY_TYPES = {
  call:     { icon: '📞', label: 'Appel' },
  whatsapp: { icon: '💬', label: 'WhatsApp' },
  email:    { icon: '✉️', label: 'Email' },
  note:     { icon: '📝', label: 'Note' }
};

var RC_OUTCOMES = {
  interested: { icon: '👍', label: 'Int&eacute;ress&eacute;', cls: 'cc-outcome-good' },
  refused:    { icon: '👎', label: 'Refus',          cls: 'cc-outcome-bad'  },
  no_answer:  { icon: '🔇', label: 'Pas de r&eacute;ponse', cls: 'cc-outcome-neutral' },
  callback:   { icon: '🔁', label: 'À rappeler',      cls: 'cc-outcome-neutral' }
};

// Modèles de note rapide, utilisés dans le formulaire d'ajout manuel à l'historique
var RC_NOTE_TEMPLATES = [
  "غير مهتم حالياً",
  "طلب إعادة الاتصال الأسبوع القادم",
  "لم يرد",
  "مهتم - يحتاج عرض سعر"
];

function logContactHistory(contactId, type, note, outcome) {
  var list = STORE.repertoireContacts();
  var c = list.find(function(x) { return x.id === contactId; });
  if (!c) return;
  if (!Array.isArray(c.historique)) c.historique = [];
  c.historique.unshift({
    id: 'h_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    type: type,
    date: new Date().toISOString(),
    note: note || '',
    outcome: outcome || ''
  });
  STORE.saveRepertoireContacts(list);
  _rcAfterContactsMutation(contactId);
}

// Définit (ou corrige) le résultat de la dernière interaction "appel" enregistrée —
// utile pour noter le résultat juste après avoir raccroché, sans créer une nouvelle ligne.
function setLastCallOutcome(contactId, outcome) {
  var list = STORE.repertoireContacts();
  var c = list.find(function(x) { return x.id === contactId; });
  if (!c || !Array.isArray(c.historique)) return;
  var lastCall = c.historique.find(function(h) { return h.type === 'call'; });
  if (!lastCall) return;
  lastCall.outcome = outcome;
  STORE.saveRepertoireContacts(list);
  _rcAfterContactsMutation(contactId);
}

function _rcAfterContactsMutation(contactId) {
  if (_rcActiveTab === 'annuaire') renderContactsDirectory();
  if (typeof currentContactFicheId !== 'undefined' && currentContactFicheId === contactId) renderContactFiche();
}

function _rcLastHistoryEntry(c) {
  return (Array.isArray(c.historique) && c.historique.length) ? c.historique[0] : null;
}

function _rcLastCallEntry(c) {
  return (Array.isArray(c.historique) ? c.historique : []).find(function(h) { return h.type === 'call'; }) || null;
}

// Statut d'appel façon centre d'appel : aujourd'hui / cette semaine / ancien / jamais
function _rcContactStatus(c) {
  var last = _rcLastHistoryEntry(c);
  if (!last) return { cls: 'cc-status-never', label: 'Jamais contact&eacute;', bucket: 'never' };
  var diffDays = (Date.now() - new Date(last.date).getTime()) / 86400000;
  if (diffDays < 1)  return { cls: 'cc-status-today', label: "Aujourd'hui", bucket: 'today' };
  if (diffDays < 7)  return { cls: 'cc-status-week',  label: 'Cette semaine', bucket: 'week' };
  return { cls: 'cc-status-old', label: _rcFormatDateTime(last.date), bucket: 'old' };
}

// Suivi (follow-up) : retourne 'overdue' / 'today' / null selon contact.nextFollowUp (date YYYY-MM-DD)
function _rcFollowUpBucket(c) {
  if (!c.nextFollowUp) return null;
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var fu = new Date(c.nextFollowUp + 'T00:00:00');
  if (isNaN(fu.getTime())) return null;
  if (fu.getTime() < today.getTime()) return 'overdue';
  if (fu.getTime() === today.getTime()) return 'today';
  return null;
}

function _rcFollowUpBadge(c) {
  var b = _rcFollowUpBucket(c);
  if (b === 'overdue') return '<span class="cc-followup-badge cc-followup-overdue" title="Suivi en retard">&#9201; Retard</span>';
  if (b === 'today')   return '<span class="cc-followup-badge cc-followup-today" title="Suivi pr&eacute;vu aujourd\'hui">&#128197; Aujourd\'hui</span>';
  return '';
}

// Construit la liste filtrée/triée commune à l'affichage et à l'export
function _rcGetFilteredSortedContacts() {
  var query = (document.getElementById('repertoire-contacts-search') || {}).value || '';
  query = query.toLowerCase().trim();
  var fields = ['nom','prenom','adresse','ville','gouvernorat','pays','tel1','tel2','email','metier','domaine','note','responsable'];
  var sortMode    = (document.getElementById('rc-sort-select')        || {}).value || 'nom';
  var filterMode  = (document.getElementById('rc-filter-select')      || {}).value || 'all';
  var tagFilter   = (document.getElementById('rc-tag-filter')         || {}).value || '';
  var respFilter  = (document.getElementById('rc-responsable-filter') || {}).value || '';

  var list = STORE.repertoireContacts().slice();

  if (query) {
    list = list.filter(function(c) {
      return fields.some(function(f) { return String(c[f] || '').toLowerCase().includes(query); })
        || (Array.isArray(c.tags) && c.tags.some(function(t) { return String(t).toLowerCase().includes(query); }));
    });
  }

  if (filterMode === 'followup_due') {
    list = list.filter(function(c) { return !!_rcFollowUpBucket(c); });
  } else if (filterMode !== 'all') {
    list = list.filter(function(c) { return _rcContactStatus(c).bucket === filterMode; });
  }

  if (tagFilter) {
    list = list.filter(function(c) { return Array.isArray(c.tags) && c.tags.indexOf(tagFilter) !== -1; });
  }

  if (respFilter) {
    list = list.filter(function(c) { return (c.responsable || '') === respFilter; });
  }

  list.sort(function(a, b) {
    if (sortMode === 'ville') return String(a.ville || '').localeCompare(String(b.ville || ''));
    if (sortMode === 'recent' || sortMode === 'oldest') {
      var la = _rcLastHistoryEntry(a), lb = _rcLastHistoryEntry(b);
      var ta = la ? new Date(la.date).getTime() : 0;
      var tb = lb ? new Date(lb.date).getTime() : 0;
      return sortMode === 'recent' ? (tb - ta) : (ta - tb);
    }
    return String(a.nom || '').localeCompare(String(b.nom || ''));
  });

  return list;
}

// Filtre/tri avancé pour le tableau du Répertoire ("tous les contacts ensemble") —
// même esprit que _rcGetFilteredSortedContacts (Annuaire), mais avec ses propres
// contrôles (IDs distincts) et en tenant compte en plus du filtre "import" actif
// (_rcFilterBatchId) et du tri par numéro interne.
function _rcGetFilteredSortedContactsForTable() {
  var query = (document.getElementById('repertoire-contacts-search') || {}).value || '';
  query = query.toLowerCase().trim();
  var fields = ['nom','prenom','adresse','ville','gouvernorat','pays','tel1','tel2','email','metier','domaine','note','responsable'];
  var sortMode   = (document.getElementById('rc-table-sort-select')        || {}).value || 'nom';
  var filterMode = (document.getElementById('rc-table-filter-select')      || {}).value || 'all';
  var tagFilter  = (document.getElementById('rc-table-tag-filter')         || {}).value || '';
  var respFilter = (document.getElementById('rc-table-responsable-filter') || {}).value || '';

  var list = STORE.repertoireContacts().slice();

  if (_rcFilterBatchId) {
    list = list.filter(function(c) { return c.importBatchId === _rcFilterBatchId; });
  }

  if (query) {
    list = list.filter(function(c) {
      return fields.some(function(f) { return String(c[f] || '').toLowerCase().includes(query); })
        || (Array.isArray(c.tags) && c.tags.some(function(t) { return String(t).toLowerCase().includes(query); }));
    });
  }

  if (filterMode === 'followup_due') {
    list = list.filter(function(c) { return !!_rcFollowUpBucket(c); });
  } else if (filterMode !== 'all') {
    list = list.filter(function(c) { return _rcContactStatus(c).bucket === filterMode; });
  }

  if (tagFilter) {
    list = list.filter(function(c) { return Array.isArray(c.tags) && c.tags.indexOf(tagFilter) !== -1; });
  }

  if (respFilter) {
    list = list.filter(function(c) { return (c.responsable || '') === respFilter; });
  }

  list.sort(function(a, b) {
    if (sortMode === 'numero_asc' || sortMode === 'numero_desc') {
      var na = parseInt(a.numero, 10) || 0, nb = parseInt(b.numero, 10) || 0;
      return sortMode === 'numero_asc' ? (na - nb) : (nb - na);
    }
    if (sortMode === 'ville') return String(a.ville || '').localeCompare(String(b.ville || ''));
    if (sortMode === 'recent' || sortMode === 'oldest') {
      var la = _rcLastHistoryEntry(a), lb = _rcLastHistoryEntry(b);
      var ta = la ? new Date(la.date).getTime() : 0;
      var tb = lb ? new Date(lb.date).getTime() : 0;
      return sortMode === 'recent' ? (tb - ta) : (ta - tb);
    }
    return String(a.nom || '').localeCompare(String(b.nom || ''));
  });

  return list;
}

// Réinitialise les filtres/tri avancés du tableau Répertoire (mais pas la recherche ni l'import actif)
function _rcResetTableFilters() {
  ['rc-table-sort-select', 'rc-table-filter-select', 'rc-table-tag-filter', 'rc-table-responsable-filter'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.value = (id === 'rc-table-sort-select') ? 'nom' : (id === 'rc-table-filter-select' ? 'all' : '');
  });
  renderRepertoireContactsPage();
}

// Remplit dynamiquement les filtres "tags" et "responsable" à partir des valeurs existantes,
// en conservant la sélection courante si elle est toujours valide. Générique : accepte les ID
// des deux <select> concernés, pour pouvoir être réutilisé sur plusieurs onglets (Annuaire, Répertoire).
function _rcPopulateDynamicFilters(all, tagSelId, respSelId) {
  var tagSel  = document.getElementById(tagSelId  || 'rc-tag-filter');
  var respSel = document.getElementById(respSelId || 'rc-responsable-filter');

  if (tagSel) {
    var tags = [];
    all.forEach(function(c) { (c.tags || []).forEach(function(t) { if (t && tags.indexOf(t) === -1) tags.push(t); }); });
    tags.sort(function(a, b) { return a.localeCompare(b); });
    var curTag = tagSel.value;
    tagSel.innerHTML = '<option value="">Tous les tags</option>' + tags.map(function(t) {
      return '<option value="' + esc(t) + '">' + esc(t) + '</option>';
    }).join('');
    if (tags.indexOf(curTag) !== -1) tagSel.value = curTag;
  }

  if (respSel) {
    var resps = [];
    all.forEach(function(c) { if (c.responsable && resps.indexOf(c.responsable) === -1) resps.push(c.responsable); });
    resps.sort(function(a, b) { return a.localeCompare(b); });
    var curResp = respSel.value;
    respSel.innerHTML = '<option value="">Tous les responsables</option>' + resps.map(function(r) {
      return '<option value="' + esc(r) + '">' + esc(r) + '</option>';
    }).join('');
    if (resps.indexOf(curResp) !== -1) respSel.value = curResp;
  }
}

// Calcule les statistiques globales (toujours sur l'ensemble des contacts, pas seulement filtrés)
function _rcComputeStats(all) {
  var callsToday = 0, callsWeek = 0, withOutcome = 0, interested = 0;
  var metierCount = {}, villeCount = {};
  all.forEach(function(c) {
    if (c.metier) metierCount[c.metier] = (metierCount[c.metier] || 0) + 1;
    if (c.ville)  villeCount[c.ville]   = (villeCount[c.ville]   || 0) + 1;
    (c.historique || []).forEach(function(h) {
      if (h.type === 'call') {
        var diffDays = (Date.now() - new Date(h.date).getTime()) / 86400000;
        if (diffDays < 1) callsToday++;
        if (diffDays < 7) callsWeek++;
        if (h.outcome) {
          withOutcome++;
          if (h.outcome === 'interested') interested++;
        }
      }
    });
  });
  function topOf(counts) {
    var best = null, bestN = 0;
    Object.keys(counts).forEach(function(k) { if (counts[k] > bestN) { best = k; bestN = counts[k]; } });
    return best;
  }
  return {
    callsToday: callsToday,
    callsWeek: callsWeek,
    responseRate: withOutcome ? Math.round((interested / withOutcome) * 100) : null,
    topMetier: topOf(metierCount),
    topVille: topOf(villeCount)
  };
}

function _rcRenderStats(all) {
  var el = document.getElementById('rc-annuaire-stats');
  if (!el) return;
  var s = _rcComputeStats(all);
  el.innerHTML = ''
    + '<span class="cc-stat-pill">&#128222; ' + s.callsToday + ' appel(s) aujourd\'hui</span>'
    + '<span class="cc-stat-pill">&#128197; ' + s.callsWeek + ' appel(s) cette semaine</span>'
    + '<span class="cc-stat-pill">&#127919; Taux de r&eacute;ponse : ' + (s.responseRate === null ? '—' : s.responseRate + '%') + '</span>'
    + (s.topMetier ? '<span class="cc-stat-pill">&#128188; M&eacute;tier top : ' + esc(s.topMetier) + '</span>' : '')
    + (s.topVille  ? '<span class="cc-stat-pill">&#128205; Ville top : ' + esc(s.topVille) + '</span>'   : '');
}

// Annuaire d'appel : liste compacte façon centre d'appel — recherche, tri, filtre, statut d'appel
function renderContactsDirectory() {
  var grid = document.getElementById('contacts-directory-grid');
  if (!grid) return;

  var all = STORE.repertoireContacts();

  _rcPopulateDynamicFilters(all);
  _rcRenderStats(all);

  var countToday = 0, countNever = 0;
  all.forEach(function(c) {
    var st = _rcContactStatus(c);
    if (st.bucket === 'today') countToday++;
    if (st.bucket === 'never') countNever++;
  });
  var countsEl = document.getElementById('rc-annuaire-counts');
  if (countsEl) {
    countsEl.innerHTML = ''
      + '<span class="cc-count-pill">' + all.length + ' contact' + (all.length === 1 ? '' : 's') + '</span>'
      + '<span class="cc-count-pill cc-count-today">' + countToday + ' aujourd\'hui</span>'
      + '<span class="cc-count-pill cc-count-never">' + countNever + ' jamais contact&eacute;s</span>';
  }

  var list = _rcGetFilteredSortedContacts();

  if (!list.length) {
    grid.innerHTML = '<div class="contacts-directory-empty">Aucun contact ne correspond. Importez depuis le t&eacute;l&eacute;phone, ajoutez-en un manuellement, ou changez le filtre.</div>';
    return;
  }

  grid.innerHTML = list.map(function(c) {
    var name = ((c.prenom || '') + ' ' + (c.nom || '')).trim() || 'Sans nom';
    var sub = [c.metier, c.ville].filter(Boolean).join(' · ') || (c.tel1 || c.email || '—');
    var tel1 = _rcCleanPhone(c.tel1);
    var wa = _rcWhatsappNumber(c.tel1);
    var status = _rcContactStatus(c);

    var tags = Array.isArray(c.tags) ? c.tags : [];
    var tagsHtml = tags.slice(0, 2).map(function(t) { return '<span class="cc-tag-pill">' + esc(t) + '</span>'; }).join('')
      + (tags.length > 2 ? '<span class="cc-tag-pill cc-tag-more">+' + (tags.length - 2) + '</span>' : '');

    var callBtn = tel1
      ? '<a class="cc-call" href="tel:' + esc(tel1) + '" onclick="logContactHistory(\'' + c.id + '\',\'call\')" title="Appeler">&#128222;</a>'
      : '<span class="cc-call cc-disabled">&#128222;</span>';
    var waBtn = wa
      ? '<a class="cc-whatsapp" href="https://wa.me/' + esc(wa) + '" target="_blank" rel="noopener" onclick="logContactHistory(\'' + c.id + '\',\'whatsapp\')" title="WhatsApp">&#128172;</a>'
      : '<span class="cc-whatsapp cc-disabled">&#128172;</span>';
    var mailBtn = c.email
      ? '<a class="cc-email" href="mailto:' + esc(c.email) + '" onclick="logContactHistory(\'' + c.id + '\',\'email\')" title="Email">&#9993;</a>'
      : '<span class="cc-email cc-disabled">&#9993;</span>';
    var ficheBtn = '<button class="cc-fiche" onclick="openContactFiche(\'' + c.id + '\')" title="Fiche compl&egrave;te">&#128209;</button>';

    return '<div class="cc-row">'
      + '<span class="cc-status-dot ' + status.cls + '" title="' + esc(status.label) + '"></span>'
      + '<div class="cc-row-avatar">' + esc(_rcInitials(c)) + '</div>'
      + '<div class="cc-row-info" onclick="openContactFiche(\'' + c.id + '\')">'
      + '<div class="cc-row-name">' + esc(name) + (tagsHtml ? ' ' + tagsHtml : '') + '</div>'
      + '<div class="cc-row-sub">' + esc(sub) + '</div>'
      + '</div>'
      + '<div class="cc-row-status">' + status.label + ' ' + _rcFollowUpBadge(c) + '</div>'
      + '<div class="cc-row-actions">' + callBtn + waBtn + mailBtn + ficheBtn + '</div>'
      + '</div>';
  }).join('');
}

// Export CSV (compatible Excel) de la liste actuellement filtrée/triée dans l'Annuaire
function exportContactsDirectoryCSV() {
  var list = _rcGetFilteredSortedContacts();
  if (!list.length) { alert('Aucun contact à exporter avec ces filtres.'); return; }

  var headers = ['Nom','Prénom','Téléphone 1','Téléphone 2','Email','Ville','Métier','Domaine','Responsable','Tags','Dernier contact','Statut','Note'];
  function csvCell(v) {
    var s = String(v == null ? '' : v).replace(/"/g, '""');
    return '"' + s + '"';
  }
  var rows = list.map(function(c) {
    var last = _rcLastHistoryEntry(c);
    var status = _rcContactStatus(c);
    return [
      c.nom || '', c.prenom || '', c.tel1 || '', c.tel2 || '', c.email || '',
      c.ville || '', c.metier || '', c.domaine || '', c.responsable || '',
      (Array.isArray(c.tags) ? c.tags.join(', ') : ''),
      last ? _rcFormatDateTime(last.date) : '',
      status.label.replace(/&eacute;/g, 'é').replace(/&agrave;/g, 'à'),
      c.note || ''
    ].map(csvCell).join(',');
  });

  var csv = '﻿' + headers.map(csvCell).join(',') + '\r\n' + rows.join('\r\n');
  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'annuaire_contacts_' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
}

// ---- Fiche contact (vue détail avec toutes les informations) ----
var currentContactFicheId = null;

function openContactFiche(id) {
  currentContactFicheId = id;
  showView('contact-fiche');
}

function renderContactFiche() {
  var list = STORE.repertoireContacts();
  var c = list.find(function(x) { return x.id === currentContactFicheId; });
  var headerEl = document.getElementById('contact-fiche-header');
  var bodyEl   = document.getElementById('contact-fiche-body');
  if (!bodyEl || !headerEl) return;

  if (!c) {
    headerEl.innerHTML = '';
    bodyEl.innerHTML = '<div style="color:#666;">Contact introuvable.</div>';
    return;
  }

  var originText, originIcon;
  if (c.importBatchId) {
    var imports = STORE.repertoireImports();
    var imp = imports.find(function(i) { return i.id === c.importBatchId; });
    if (imp) {
      originIcon = imp.source === 'file' ? '📁' : '📱';
      originText = (imp.source === 'file' ? 'Fichier .vcf' : 'Téléphone') + ' — ' + _rcFormatDateTime(imp.date) + (imp.label ? ' — ' + imp.label : '');
    } else {
      originIcon = '📁';
      originText = 'Import (historique supprimé)';
    }
  } else {
    originIcon = '✍️';
    originText = 'Ajouté manuellement';
  }

  var name = ((c.prenom || '') + ' ' + (c.nom || '')).trim() || 'Sans nom';
  var tel1 = _rcCleanPhone(c.tel1);
  var wa = _rcWhatsappNumber(c.tel1);

  var actionsHtml = ''
    + (tel1
        ? '<a class="cf-call" href="tel:' + esc(tel1) + '" onclick="logContactHistory(\'' + c.id + '\',\'call\')" title="Appeler">&#128222; Appeler</a>'
        : '<span class="cf-call cc-disabled">&#128222; Appeler</span>')
    + (wa
        ? '<a class="cf-whatsapp" href="https://wa.me/' + esc(wa) + '" target="_blank" rel="noopener" onclick="logContactHistory(\'' + c.id + '\',\'whatsapp\')" title="WhatsApp">&#128172; WhatsApp</a>'
        : '<span class="cf-whatsapp cc-disabled">&#128172; WhatsApp</span>')
    + (c.email
        ? '<a class="cf-email" href="mailto:' + esc(c.email) + '" onclick="logContactHistory(\'' + c.id + '\',\'email\')" title="Email">&#9993; Email</a>'
        : '<span class="cf-email cc-disabled">&#9993; Email</span>')
    + '<button class="cf-delete" onclick="deleteRepertoireContact(\'' + c.id + '\'); showView(\'gestion-contacts\');" title="Supprimer">&times; Supprimer</button>';

  headerEl.innerHTML = ''
    + '<div class="contact-fiche-avatar">' + esc(_rcInitials(c)) + '</div>'
    + '<div class="contact-fiche-id">'
    + '<div class="contact-fiche-name">' + esc(name) + '</div>'
    + '<div class="contact-fiche-meta">'
    + '<span class="contact-fiche-badge">N&deg; ' + esc(c.numero || '----') + '</span>'
    + (c.metier ? '<span class="contact-fiche-badge">' + esc(c.metier) + '</span>' : '')
    + '<span class="contact-fiche-badge origin">' + originIcon + ' ' + esc(originText) + '</span>'
    + '</div>'
    + '</div>'
    + '<div class="contact-fiche-actions">' + actionsHtml + '</div>';

  function field(f, label, type) {
    var isPhone = (f === 'tel1' || f === 'tel2');
    return '<div class="contact-fiche-field">'
      + '<label>' + esc(label) + '</label>'
      + '<input type="' + (type || 'text') + '" value="' + esc(c[f] || '') + '"'
      + ' onchange="updateRepertoireContactField(\'' + c.id + '\',\'' + f + '\',' + (isPhone ? 'this.value.replace(/\\s+/g,\'\')' : 'this.value') + '); renderContactFiche();"'
      + '>'
      + '</div>';
  }

  var tagsValue = (Array.isArray(c.tags) ? c.tags : []).join(', ');
  var tagsFieldHtml = '<div class="contact-fiche-field">'
    + '<label>Tags (s&eacute;par&eacute;s par une virgule)</label>'
    + '<input type="text" value="' + esc(tagsValue) + '" placeholder="ex: VIP, urgent"'
    + ' onchange="updateRepertoireContactTags(\'' + c.id + '\', this.value); renderContactFiche();"'
    + '>'
    + '</div>';

  // Puce de résultat de la dernière interaction "appel" enregistrée, modifiable en un clic
  var lastCall = _rcLastCallEntry(c);
  var outcomeChipsHtml = '';
  if (lastCall) {
    outcomeChipsHtml = '<div class="cf-outcome-row">'
      + '<span class="cf-outcome-label">R&eacute;sultat du dernier appel (' + esc(_rcFormatDateTime(lastCall.date)) + ') :</span>'
      + Object.keys(RC_OUTCOMES).map(function(k) {
          var o = RC_OUTCOMES[k];
          var active = lastCall.outcome === k ? ' active' : '';
          return '<button class="cf-outcome-chip ' + o.cls + active + '" onclick="setLastCallOutcome(\'' + c.id + '\',\'' + k + '\')">' + o.icon + ' ' + o.label + '</button>';
        }).join('')
      + '</div>';
  }

  bodyEl.innerHTML = ''
    + '<div>'
    + '<div class="contact-fiche-section-title">Coordonn&eacute;es</div>'
    + '<div class="contact-fiche-grid">'
    + field('tel1', 'T&eacute;l&eacute;phone 1') + field('tel2', 'T&eacute;l&eacute;phone 2') + field('email', 'Email')
    + field('adresse', 'Adresse') + field('ville', 'Ville') + field('gouvernorat', 'Gouvernorat') + field('pays', 'Pays')
    + '</div>'
    + '</div>'
    + '<div>'
    + '<div class="contact-fiche-section-title">Professionnel</div>'
    + '<div class="contact-fiche-grid">'
    + field('nom', 'Nom') + field('prenom', 'Pr&eacute;nom') + field('metier', 'M&eacute;tier') + field('domaine', 'Domaine')
    + field('responsable', 'Responsable') + field('nextFollowUp', 'Prochain suivi', 'date')
    + '</div>'
    + '</div>'
    + '<div>'
    + '<div class="contact-fiche-section-title">Tags &amp; Note</div>'
    + '<div class="contact-fiche-grid">' + tagsFieldHtml + field('note', 'Note') + '</div>'
    + '</div>'
    + '<div>'
    + '<div class="contact-fiche-section-title">Historique des interactions</div>'
    + outcomeChipsHtml
    + '<div class="cf-note-templates">'
    + RC_NOTE_TEMPLATES.map(function(t) {
        return '<button class="cf-note-template" onclick="_rcFillHistoryNote(' + JSON.stringify(t).replace(/"/g, '&quot;') + ')">' + esc(t) + '</button>';
      }).join('')
    + '</div>'
    + '<div class="cf-history-add">'
    + '<select id="cf-history-type" onchange="_rcToggleOutcomeSelect()">'
    + '<option value="note">&#128221; Note</option>'
    + '<option value="call">&#128222; Appel</option>'
    + '<option value="whatsapp">&#128172; WhatsApp</option>'
    + '<option value="email">&#9993; Email</option>'
    + '</select>'
    + '<select id="cf-history-outcome" style="display:none;">'
    + '<option value="">R&eacute;sultat (optionnel)</option>'
    + Object.keys(RC_OUTCOMES).map(function(k) { return '<option value="' + k + '">' + RC_OUTCOMES[k].icon + ' ' + RC_OUTCOMES[k].label + '</option>'; }).join('')
    + '</select>'
    + '<input type="text" id="cf-history-note" placeholder="D&eacute;tail de l\'interaction (optionnel)..." onkeydown="if(event.key===\'Enter\'){addManualContactHistory(\'' + c.id + '\');}">'
    + '<button class="btn btn-outline btn-sm" onclick="addManualContactHistory(\'' + c.id + '\')">+ Ajouter &agrave; l\'historique</button>'
    + '</div>'
    + '<div class="cf-history-timeline">' + _rcRenderHistoryTimeline(c) + '</div>'
    + '</div>';
}

function _rcToggleOutcomeSelect() {
  var typeEl = document.getElementById('cf-history-type');
  var outcomeEl = document.getElementById('cf-history-outcome');
  if (!typeEl || !outcomeEl) return;
  outcomeEl.style.display = (typeEl.value === 'call') ? '' : 'none';
}

function _rcFillHistoryNote(text) {
  var noteEl = document.getElementById('cf-history-note');
  if (!noteEl) return;
  noteEl.value = text;
  noteEl.focus();
  noteEl.setSelectionRange(noteEl.value.length, noteEl.value.length);
}

function _rcRenderHistoryTimeline(c) {
  var entries = Array.isArray(c.historique) ? c.historique : [];
  if (!entries.length) {
    return '<div class="cf-history-empty">Aucune interaction enregistr&eacute;e pour le moment.</div>';
  }
  return entries.map(function(h) {
    var meta = RC_HISTORY_TYPES[h.type] || RC_HISTORY_TYPES.note;
    var outcomeBadge = (h.outcome && RC_OUTCOMES[h.outcome])
      ? '<span class="cf-history-outcome ' + RC_OUTCOMES[h.outcome].cls + '">' + RC_OUTCOMES[h.outcome].icon + ' ' + RC_OUTCOMES[h.outcome].label + '</span>'
      : '';
    return '<div class="cf-history-entry">'
      + '<span class="cf-history-icon">' + meta.icon + '</span>'
      + '<div class="cf-history-content">'
      + '<div class="cf-history-top"><span class="cf-history-type">' + esc(meta.label) + outcomeBadge + '</span><span class="cf-history-date">' + esc(_rcFormatDateTime(h.date)) + '</span></div>'
      + (h.note ? '<div class="cf-history-note">' + esc(h.note) + '</div>' : '')
      + '</div>'
      + '</div>';
  }).join('');
}

function addManualContactHistory(contactId) {
  var typeEl = document.getElementById('cf-history-type');
  var noteEl = document.getElementById('cf-history-note');
  var outcomeEl = document.getElementById('cf-history-outcome');
  var type = typeEl ? typeEl.value : 'note';
  var note = noteEl ? noteEl.value.trim() : '';
  var outcome = (outcomeEl && type === 'call') ? outcomeEl.value : '';
  logContactHistory(contactId, type, note, outcome);
}

// Met à jour le tableau de tags d'un contact à partir d'une chaîne "tag1, tag2, ..."
function updateRepertoireContactTags(id, rawValue) {
  var list = STORE.repertoireContacts();
  var item = list.find(function(c) { return c.id === id; });
  if (!item) return;
  item.tags = String(rawValue || '').split(',').map(function(t) { return t.trim(); }).filter(Boolean);
  item.updatedAt = new Date().toISOString();
  STORE.saveRepertoireContacts(list);
}

function renderList() {
  const el = document.getElementById('invoice-list');
  if (!el) return;
  const invoices = STORE.invoices().slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  if (!invoices.length) {
    el.innerHTML = '<div class="empty-state">Aucune facture.</div>';
    return;
  }
  el.innerHTML = '<div class="invoice-grid invoice-list-grid">' + invoices.map(inv => {
    const isSans = inv.type === 'sans_tva';
    const title = isSans ? 'Sans numerotation' : esc(inv.num || '-');
    const total = getInvoiceTotal(inv);
    const statusClass = inv.status === 'paid' ? 'paid' : 'pending';
    const statusText = inv.status === 'paid'
      ? `Pay&eacute;e avec ${esc(paymentModeLabel(inv.paymentMode))}`
      : 'Non pay&eacute;e';
    const previewAction = isSans ? '' : `previewInvoice('${inv.id}')`;
    const printButtons = isSans ? '' : `
      <button class="btn btn-gold btn-sm invoice-icon-btn invoice-print-btn" onclick="event.stopPropagation();previewInvoice('${inv.id}')" title="Imprimer" aria-label="Imprimer"><span aria-hidden="true">&#128424;</span></button>`;
    const paymentBadge = `<div class="invoice-payment-badge ${statusClass}">${statusText}</div>`;
    return `<div class="invoice-card invoice-list-card" onclick="${previewAction}">
      <div class="invoice-list-main">
        <div class="inv-num">${title}${isSans ? '<span class="invoice-type-badge">Sans TVA</span>' : ''}</div>
        <div class="inv-client">${esc(inv.clientName || 'Client non defini')}</div>
        <div class="inv-meta">${formatDate(inv.date)} · ${fmtMoney(total)}</div>
        ${paymentBadge}
      </div>
      <div class="inv-actions invoice-list-actions" onclick="event.stopPropagation()">
        ${printButtons}
        <button class="btn btn-outline btn-sm invoice-icon-btn" onclick="editInvoice('${inv.id}')" title="Modifier" aria-label="Modifier"><span aria-hidden="true">&#9998;</span></button>
        <button class="btn btn-danger btn-sm invoice-icon-btn" onclick="deleteInvoice('${inv.id}')" title="Supprimer" aria-label="Supprimer"><span aria-hidden="true">&times;</span></button>
      </div>
    </div>`;
  }).join('') + '</div>';
}

function nextInvoiceNum(year = new Date().getFullYear()) {
  const nums = STORE.invoices()
    .filter(inv => inv.type !== 'sans_tva' && String(inv.num || '').endsWith('/' + year))
    .map(inv => parseInt(String(inv.num || '').split('/')[0], 10))
    .filter(Number.isFinite);
  return String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, '0') + '/' + year;
}

function splitInvoiceNum(numValue) {
  const match = String(numValue || '').match(/^(\d+)\/(\d{4})$/);
  return match ? { seq: match[1], year: match[2] } : { seq: '', year: String(new Date().getFullYear()) };
}

function nextDevisNum(year = new Date().getFullYear()) {
  const nums = STORE.devis()
    .filter(dev => String(dev.num || '').includes('/' + year))
    .map(dev => {
      const str = String(dev.num || '');
      // Handle new format: "001/2026"
      if (/^\d+\/\d{4}$/.test(str)) {
        return parseInt(str.split('/')[0], 10);
      }
      // Handle legacy format: "DEV-2026/001"
      if (/^DEV-\d{4}\/\d+$/.test(str)) {
        return parseInt(str.split('/')[1], 10);
      }
      return NaN;
    })
    .filter(Number.isFinite);
  return String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, '0') + '/' + year;
}

function splitDevisNum(numValue) {
  const str = String(numValue || '');

  // Format 1: SEQ/YEAR (e.g., "001/2026")
  let match = str.match(/^(\d+)\/(\d{4})$/);
  if (match) return { seq: match[1], year: match[2] };

  // Format 2: DEV-YEAR/SEQ (e.g., "DEV-2026/001") - legacy format
  match = str.match(/^DEV-(\d{4})\/(\d+)$/);
  if (match) return { seq: match[2], year: match[1] };

  return { seq: '', year: String(new Date().getFullYear()) };
}

function initNewForm() {
  const today = todayStr();
  const year = today.slice(0, 4);
  document.getElementById('edit-id').value = '';
  document.getElementById('form-page-title').innerHTML = 'Nouvelle <span>Facture</span>';
  document.getElementById('f-type').value = 'tva';
  document.getElementById('f-date').value = today;
  document.getElementById('f-status').value = 'pending';
  document.getElementById('f-payment-mode').value = 'virement';
  document.getElementById('f-num-year').value = year;
  document.getElementById('f-num-seq').value = nextInvoiceNum(year).split('/')[0];
  document.getElementById('f-timbre-amount').value = '1.000';
  fillClientSelect();
  ['f-client-name', 'f-client-addr', 'f-client-mf'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('lines-body').innerHTML = '';
  stableLineCount = 0;
  addLine('Transport de spectacle à ', 1, 0, 'Forfait');
  syncInvoiceNumberPreview();
  handleInvoiceTypeChange();
  updateInvoicePaymentModeVisibility();
  calcTotals();
}

function handleInvoiceTypeChange() {
  const type = document.getElementById('f-type')?.value || 'tva';
  const isSans = type === 'sans_tva';
  ['invoice-number-group', 'tva-row', 'timbre-row'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = isSans ? 'none' : '';
  });
  const label = document.getElementById('total-label');
  if (label) label.textContent = isSans ? 'Total' : 'Total TTC';
  calcTotals();
}

function handleInvoiceYearChange() {
  const year = document.getElementById('f-num-year').value || new Date().getFullYear();
  document.getElementById('f-num-seq').value = nextInvoiceNum(year).split('/')[0];
  syncInvoiceNumberPreview();
}

function handleInvoiceDateChange() {
  const date = document.getElementById('f-date').value;
  if (date) {
    document.getElementById('f-num-year').value = date.slice(0, 4);
    handleInvoiceYearChange();
  }
}

function syncInvoiceNumberPreview() {
  const year = document.getElementById('f-num-year').value;
  const seq = String(document.getElementById('f-num-seq').value || '').padStart(3, '0').slice(-3);
  const finalNum = year && seq ? `${seq}/${year}` : '';
  document.getElementById('f-num').value = finalNum;
  document.getElementById('f-num-preview').textContent = finalNum || '---';
}

function fillClientSelect() {
  const sel = document.getElementById('f-client-select');
  if (!sel) return;
  sel.innerHTML = '<option value="">-- Nouveau client --</option>' + STORE.clients().map(c => `<option value="${esc(c.id)}">${esc(c.name || c.contact || 'Client')}</option>`).join('');
}

function fillClientFromSelect() {
  const id = document.getElementById('f-client-select').value;
  const c = STORE.clients().find(client => client.id === id);
  if (!c) return;
  document.getElementById('f-client-name').value = c.name || c.contact || '';
  document.getElementById('f-client-addr').value = c.addr || '';
  document.getElementById('f-client-mf').value = c.mf || '';
}

function addLine(desc = '', qty = 1, pu = 0, unit = 'Forfait') {
  stableLineCount += 1;
  const tr = document.createElement('tr');
  tr.id = 'line-' + stableLineCount;
  tr.innerHTML = `
    <td><input type="text" value="${esc(desc)}" placeholder="Transport de spectacle à " oninput="calcTotals()"></td>
    <td><input type="number" value="${qty}" min="0" step="0.5" oninput="calcTotals()"></td>
    <td><select onchange="calcTotals()"><option ${unit === 'Forfait' ? 'selected' : ''}>Forfait</option><option ${unit === 'Jour(s)' ? 'selected' : ''}>Jour(s)</option><option ${unit === 'Km' ? 'selected' : ''}>Km</option></select></td>
    <td><input type="number" value="${pu}" min="0" step="0.001" oninput="calcTotals()"></td>
    <td class="line-total">0.000</td>
    <td><button class="btn-remove" onclick="removeLine('${tr.id}')">x</button></td>`;
  document.getElementById('lines-body').appendChild(tr);
  calcTotals();
}

function removeLine(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
  calcTotals();
}

function getLines() {
  return Array.from(document.querySelectorAll('#lines-body tr')).map(tr => {
    const inputs = tr.querySelectorAll('input');
    const select = tr.querySelector('select');
    return {
      desc: inputs[0]?.value || '',
      qty: num(inputs[1]?.value),
      unit: select?.value || 'Forfait',
      pu: num(inputs[2]?.value)
    };
  }).filter(line => line.desc || line.qty || line.pu);
}

function calcTotals() {
  const lines = getLines();
  Array.from(document.querySelectorAll('#lines-body tr')).forEach(tr => {
    const inputs = tr.querySelectorAll('input');
    const total = num(inputs[1]?.value) * num(inputs[2]?.value);
    const cell = tr.querySelector('.line-total');
    if (cell) cell.textContent = total.toFixed(3);
  });
  const ht = lines.reduce((sum, line) => sum + line.qty * line.pu, 0);
  const isSans = document.getElementById('f-type')?.value === 'sans_tva';
  const tvaRate = isSans ? 0 : num(document.getElementById('f-tva')?.value);
  const tvaAmt = ht * tvaRate / 100;
  const timbre = isSans ? 0 : num(document.getElementById('f-timbre-amount')?.value || 1);
  document.getElementById('t-ht').textContent = fmtMoney(ht);
  document.getElementById('t-tva').textContent = fmtMoney(tvaAmt);
  document.getElementById('t-timbre').textContent = fmtMoney(timbre);
  document.getElementById('t-ttc').textContent = fmtMoney(ht + tvaAmt + timbre);
}

function saveInvoice() {
  const type = document.getElementById('f-type').value;
  const editId = document.getElementById('edit-id').value;
  const clientName = document.getElementById('f-client-name').value.trim();
  const clientAddr = document.getElementById('f-client-addr').value;
  const clientMf = document.getElementById('f-client-mf').value;
  const date = document.getElementById('f-date').value;
  const status = document.getElementById('f-status')?.value || 'pending';
  const paymentMode = document.getElementById('f-payment-mode')?.value || 'virement';
  if (!clientName || !date) { alert('Client et date obligatoires'); return; }
  const lines = getLines();
  if (!lines.length) { alert('Ajoutez au moins une prestation'); return; }
  const ht = lines.reduce((sum, line) => sum + line.qty * line.pu, 0);
  const isSans = type === 'sans_tva';
  const tva = isSans ? 0 : num(document.getElementById('f-tva').value);
  const tvaAmt = ht * tva / 100;
  const timbre = isSans ? 0 : num(document.getElementById('f-timbre-amount')?.value || 1);
  const invoice = {
    id: editId || 'inv_' + Date.now(),
    type,
    num: isSans ? '' : document.getElementById('f-num').value,
    date,
    clientName,
    clientAddr,
    clientMf,
    lines,
    tva,
    tvaAmt,
    timbre,
    ht,
    ttc: ht + tvaAmt + timbre,
    status,
    paymentMode: status === 'paid' ? paymentMode : ''
  };
  let invoices = STORE.invoices();
  const old = invoices.find(inv => inv.id === editId);
  if (old?.status && !document.getElementById('f-status')) invoice.status = old.status;
  if (old?.paymentMode && !document.getElementById('f-payment-mode')) invoice.paymentMode = old.paymentMode;
  invoices = editId ? invoices.map(inv => inv.id === editId ? invoice : inv) : invoices.concat(invoice);
  STORE.saveInvoices(invoices);
  if (typeof LOGGER !== 'undefined') LOGGER.log('SAVE_INVOICE', { num: invoice.num, client: invoice.clientName, action: editId ? 'edit' : 'create' });

  // ✅ Auto-add client if not already in list
  let clients = STORE.clients();
  const existingClient = clients.find(c => c.name === clientName);
  if (!existingClient) {
    const newClient = {
      id: 'client_' + Date.now(),
      name: clientName,
      contact: '',
      addr: clientAddr || '',
      mf: clientMf || '',
      tel: ''
    };
    clients.push(newClient);
    STORE.saveClients(clients);
  }

  showView('list');
}

function editInvoice(id) {
  const inv = STORE.invoices().find(item => item.id === id);
  if (!inv) return;
  showView('new');
  document.getElementById('edit-id').value = inv.id;
  document.getElementById('form-page-title').innerHTML = 'Modifier <span>Facture</span>';
  document.getElementById('f-type').value = inv.type || 'tva';
  const parts = splitInvoiceNum(inv.num);
  document.getElementById('f-num-year').value = parts.year;
  document.getElementById('f-num-seq').value = parts.seq;
  document.getElementById('f-date').value = inv.date || todayStr();
  document.getElementById('f-client-name').value = inv.clientName || '';
  document.getElementById('f-client-addr').value = inv.clientAddr || '';
  document.getElementById('f-client-mf').value = inv.clientMf || '';
  document.getElementById('f-tva').value = inv.tva || 0;
  document.getElementById('f-timbre-amount').value = inv.timbre || 1;
  document.getElementById('f-status').value = inv.status || 'pending';
  document.getElementById('f-payment-mode').value = inv.paymentMode || 'virement';
  document.getElementById('lines-body').innerHTML = '';
  stableLineCount = 0;
  (inv.lines || []).forEach(line => addLine(line.desc, line.qty, line.pu, line.unit));
  if (!(inv.lines || []).length) addLine();
  syncInvoiceNumberPreview();
  handleInvoiceTypeChange();
  updateInvoicePaymentModeVisibility();
}

function deleteInvoice(id) {
  if (!confirm('Supprimer cette facture ?')) return;
  STORE.saveInvoices(STORE.invoices().filter(inv => inv.id !== id));
  if (typeof LOGGER !== 'undefined') LOGGER.log('DELETE_INVOICE', { id });
  renderList();
  updateSidebarStats();
}

// [js/shared/contracts.js] Contracts CRUD — nextContractRef, contractTotals, contractStatusLabel,
//   fillContractClientSelect, fillContractClientFromSelect, toggleContractVatAdvance,
//   calcContractTotals, renderContracts, initContractForm, saveContract, editContract,
//   deleteContract, cancelContractForm

function cancelForm() {
  showView('list');
}

function previewInvoice(id) {
  const inv = STORE.invoices().find(item => item.id === id);
  if (!inv || inv.type === 'sans_tva') return;
  // Use current checkbox values from form, not saved values
  inv.addStamp = document.getElementById('f-addStamp')?.checked || false;
  document.getElementById('invoice-preview').innerHTML = buildInvoiceHTML(inv);
  document.getElementById('preview-modal').style.display = 'flex';
}

function closePreview() {
  document.getElementById('preview-modal').style.display = 'none';
}

// [utils.js] numberToFrenchWords

function buildInvoiceHTML(inv) {
  const rows = (inv.lines || []).map(line => `<tr style="height:32px;background:#fff;"><td style="padding:10px 8px;border:1px solid #000;">${esc(line.desc)}</td><td style="text-align:center;padding:10px 8px;border:1px solid #000;">${line.qty}</td><td style="text-align:center;padding:10px 8px;border:1px solid #000;">${esc(line.unit || '')}</td><td style="text-align:right;padding:10px 8px;border:1px solid #000;">${fmtMoney(line.pu)}</td><td style="text-align:right;padding:10px 8px;border:1px solid #000;">${fmtMoney(num(line.qty) * num(line.pu))}</td></tr>`).join('');
  return `<div style="background:#fff;color:#000;width:794px;min-height:1123px;padding:16mm 18mm;box-sizing:border-box;font-family:Arial,sans-serif;font-size:14px;line-height:1.4;display:flex;flex-direction:column;">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;border-bottom:1px solid #000;padding-bottom:16px;margin-bottom:20px;">
      <img src="${MYTHOS_PRINT_LOGO_SRC}" style="width:160px;max-height:80px;object-fit:contain;">
      <div style="text-align:right;">
        <div style="font-size:32px;font-weight:900;color:#000;letter-spacing:1px;">FACTURE</div>
        <div style="font-size:11px;margin-top:6px;color:#333;"><b>N°:</b> ${esc(inv.num)} &nbsp; <b>Date:</b> ${formatDate(inv.date)}</div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:28px;font-size:12px;">
      <div>
        <div style="font-weight:900;color:#000;margin-bottom:8px;font-size:11px;">Émetteur:</div>
        <div style="border:1px solid #000;padding:12px 14px;height:100px;display:flex;flex-direction:column;justify-content:flex-start;">
          <div style="font-weight:900;color:#000;margin-bottom:6px;">Mythos Prod</div>
          <div style="line-height:1.5;color:#000;">04 Rue Habib Thamer<br>Khelidia 2054<br>MF: 1367868NAM000</div>
        </div>
      </div>
      <div>
        <div style="font-weight:900;color:#000;margin-bottom:8px;font-size:11px;">Facturé à:</div>
        <div style="border:1px solid #000;padding:12px 14px;height:100px;display:flex;flex-direction:column;justify-content:flex-start;">
          <div style="line-height:1.5;color:#000;"><b>${esc(inv.clientName)}</b><br>${esc(inv.clientAddr)}<br>${esc(inv.clientMf)}</div>
        </div>
      </div>
    </div>
    <div style="font-size:11px;font-weight:900;color:#000;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;">Détail des prestations</div>
    <table style="width:100%;border-collapse:collapse;margin-top:0;margin-bottom:20px;font-size:14px;"><thead><tr style="background:#fff;color:#000;font-weight:900;"><th style="padding:10px;text-align:left;border:1px solid #000;">Description</th><th style="padding:10px;text-align:center;border:1px solid #000;width:60px;">Qté</th><th style="padding:10px;text-align:center;border:1px solid #000;width:70px;">Unité</th><th style="padding:10px;text-align:right;border:1px solid #000;width:100px;">Prix unit.</th><th style="padding:10px;text-align:right;border:1px solid #000;width:100px;">Total HT</th></tr></thead><tbody>${rows}</tbody></table>
    <div style="width:380px;margin-left:auto;margin-bottom:20px;font-size:12px;border:1px solid #000;padding:14px 16px;">
      <div style="display:flex;justify-content:space-between;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid #000;">
        <span style="color:#000;">Total HT</span>
        <b style="color:#000;font-size:13px;">${fmtMoney(getInvoiceHT(inv))}</b>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid #000;">
        <span style="color:#000;">TVA ${inv.tva || 0}%</span>
        <b style="color:#000;font-size:13px;">${fmtMoney(inv.tvaAmt)}</b>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:10px;padding-bottom:10px;">
        <span style="color:#000;">Timbre fiscal</span>
        <b style="color:#000;font-size:13px;">${fmtMoney(inv.timbre)}</b>
      </div>
      <div style="display:flex;justify-content:space-between;border-top:2px solid #000;padding-top:10px;font-size:15px;font-weight:900;">
        <span style="color:#000;">TOTAL TTC</span>
        <b style="color:#000;font-size:16px;">${fmtMoney(getInvoiceTotal(inv))}</b>
      </div>
    </div>
    <div style="margin-bottom:20px;padding:12px 14px;border:1px solid #000;font-size:11px;">
      <span style="font-weight:900;color:#000;">Arrêtée la présente facture à la somme de :</span><br>
      <span style="color:#000;margin-top:6px;display:block;font-style:italic;">${numberToFrenchWords(getInvoiceTotal(inv))}</span>
    </div>
    <div style="margin-bottom:20px;display:grid;grid-template-columns:1fr;gap:16px;font-size:11px;">
      <div style="text-align:right;display:flex;flex-direction:column;align-items:flex-end;gap:10px;margin-right:80px;">
        <div style="font-weight:900;color:#000;margin-bottom:8px;">Signature et Cachet</div>
        ${inv.addStamp ? `<img src="${getStampSVG()}" style="height:90px;width:auto;transform:rotate(-3deg);opacity:0.85;filter:drop-shadow(1px 1px 2px rgba(30,64,175,0.3)) blur(0.3px);">` : ''}
      </div>
    </div>
    <div style="margin-top:auto;padding-top:14px;border-top:1px solid #000;font-size:9px;line-height:1.6;text-align:center;color:#000;">
      <strong>Mythos Production</strong> • 04 Rue Habib Thamer, Khelidia 2054<br>
      Tél: 98.999.660 / 21.821.921 | Email: ste.mythosprod@gmail.com<br>
      RC Tunis B01185972014 | MF: 1367868NAM000 | RIB BIAT: 0800 6011 0510 0066 3124
    </div>
  </div>`;
}

function renderOMList() {
  const el = document.getElementById('om-list');
  if (!el) return;
  const oms = STORE.oms().slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  if (!oms.length) {
    el.innerHTML = '<div class="empty-state">Aucun ordre de mission.</div>';
    return;
  }
  el.innerHTML = oms.map(om => {
    const count = Array.isArray(om.persons) ? om.persons.length : 0;
    return `<div class="invoice-card om-card" onclick="editOM('${om.id}')">
      <div><div class="inv-num">${esc(cleanPrintText(om.depart || 'Tunis'))} &raquo; ${esc(cleanPrintText(om.arrivee || 'Tunis'))}</div><div class="om-date-time">${esc(om.date || '')} ${esc(om.heure || '')}</div></div>
      <div><div class="om-persons-count">Nombre de personnes : ${count}</div></div>
      <div class="inv-actions om-actions" onclick="event.stopPropagation()">
        <button class="btn btn-gold btn-sm" onclick="previewOM('${om.id}')" title="Imprimer" style="padding:6px 10px; font-size:16px;">🖨️</button>
        <button class="btn btn-danger btn-sm" onclick="deleteOM('${om.id}')" title="Supprimer">✕</button>
      </div>
    </div>`;
  }).join('');
}

// ── VÉHICULES (Ordres de Mission) ──
function ensureDefaultVehicules() {
  let vehicules = STORE.vehicules();
  if (vehicules.length === 0) {
    vehicules = [
      { id: 'veh_1', plaque: '230-8646', chauffeur: 'Othman Haddad', cin: '07119027', permis: '23/109141', societe: 'mythos' },
      { id: 'veh_2', plaque: '456-1234', chauffeur: 'Ahmed Ben Ali', cin: '08556789', permis: '', societe: 'mythos' }
    ];
    STORE.saveVehicules(vehicules);
  }
  // Ajoute le véhicule de la SDT s'il n'existe pas encore
  if (!vehicules.find(v => v.plaque === '175-5401')) {
    vehicules.push({ id: 'veh_' + Date.now(), plaque: '175-5401', chauffeur: '', cin: '', permis: '', societe: 'sdt' });
    STORE.saveVehicules(vehicules);
  }
  // Rétrocompatibilité : véhicules existants sans société -> Mythos
  let changed = false;
  vehicules.forEach(v => { if (!v.societe) { v.societe = 'mythos'; changed = true; } });
  if (changed) STORE.saveVehicules(vehicules);
  return vehicules;
}

function renderOmVehiculeOptions(selectedPlaque) {
  const sel = document.getElementById('om-plaque');
  if (!sel) return;
  const vehicules = ensureDefaultVehicules();
  // Garde l'ancien véhicule courant même s'il n'est pas (encore) dans la liste
  let options = vehicules.slice();
  if (selectedPlaque && !options.find(v => v.plaque === selectedPlaque)) {
    options = options.concat([{ id: 'tmp', plaque: selectedPlaque, chauffeur: '', cin: '', permis: '' }]);
  }
  sel.innerHTML = options.map(v => {
    const soc = SOCIETES[v.societe] || SOCIETES.mythos;
    return `<option value="${esc(v.plaque)}" ${v.plaque === selectedPlaque ? 'selected' : ''}>${esc(v.plaque)}${v.chauffeur ? ' — ' + esc(v.chauffeur) : ''} (${esc(soc.nom)})</option>`;
  }).join('');
  if (!selectedPlaque && options.length) sel.value = options[0].plaque;
  updateOmLogoPreview();
}

function updateOmLogoPreview() {
  const sel = document.getElementById('om-plaque');
  const img = document.getElementById('om-logo-preview');
  const label = document.getElementById('om-societe-preview');
  if (!sel || !img) return;
  const plaque = sel.value;
  const v = ensureDefaultVehicules().find(item => item.plaque === plaque);
  const soc = SOCIETES[v?.societe] || SOCIETES.mythos;
  img.src = soc.logo;
  if (label) label.textContent = soc.nom;
}

function onOmVehiculeChange() {
  const plaque = document.getElementById('om-plaque').value;
  const v = ensureDefaultVehicules().find(item => item.plaque === plaque);
  updateOmLogoPreview();
  if (!v) return;
  if (v.chauffeur) document.getElementById('om-chauffeur').value = v.chauffeur;
  if (v.cin) document.getElementById('om-cin').value = v.cin;
  if (v.permis) document.getElementById('om-permis').value = v.permis;
}

function addOmVehicule() {
  const plaque = prompt('Numéro d\'immatriculation du nouveau véhicule :');
  if (!plaque || !plaque.trim()) return;
  const chauffeur = prompt('Nom du chauffeur (optionnel) :') || '';
  const societeInput = (prompt('Société : tapez "1" pour Mythos Production ou "2" pour Société de distribution tunisienne', '1') || '1').trim();
  const societe = societeInput === '2' ? 'sdt' : 'mythos';
  const vehicules = ensureDefaultVehicules();
  if (vehicules.find(v => v.plaque === plaque.trim())) {
    alert('Ce véhicule existe déjà.');
    renderOmVehiculeOptions(plaque.trim());
    return;
  }
  vehicules.push({ id: 'veh_' + Date.now(), plaque: plaque.trim(), chauffeur: chauffeur.trim(), cin: '', permis: '', societe });
  STORE.saveVehicules(vehicules);
  renderOmVehiculeOptions(plaque.trim());
  onOmVehiculeChange();
}

function initOMForm() {
  document.getElementById('om-edit-id').value = '';
  document.getElementById('om-form-title').innerHTML = 'Nouvel <span>Ordre de Mission</span>';
  renderOmVehiculeOptions('230-8646');
  document.getElementById('om-chauffeur').value = 'Othman Haddad';
  document.getElementById('om-cin').value = '07119027';
  document.getElementById('om-permis').value = '23/109141';
  document.getElementById('om-date').value = todayStr();
  document.getElementById('om-heure').value = '13:30';
  document.getElementById('om-depart').value = 'Tunis';
  document.getElementById('om-arrivee').value = 'Tunis';
  document.getElementById('om-mission-type').value = 'aller_retour';
  document.getElementById('om-addStamp').checked = true;
  applyOmMissionType();
  document.getElementById('om-persons-body').innerHTML = '';
  stableOmPersonCount = 0;
  for (let i = 0; i < 11; i += 1) addOmPerson('');
}

function setOmDateQuick(offset) {
  document.getElementById('om-date').value = dateInputValue(offset);
}

function setOmTimeQuick(value) {
  if (value === 'now') {
    const d = new Date();
    value = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  document.getElementById('om-heure').value = value;
}

function applyOmMissionType() {
  const type = document.getElementById('om-mission-type')?.value || 'aller_retour';
  document.getElementById('om-mission').value = OM_MISSION_TEXTS[type];
}

function addOmPerson(name = '') {
  stableOmPersonCount += 1;
  const tr = document.createElement('tr');
  tr.id = 'omp-' + stableOmPersonCount;
  tr.innerHTML = `<td style="text-align:center;">${stableOmPersonCount}</td><td><input type="text" value="${esc(name)}" placeholder="Nom et prenom"></td><td style="text-align:center;"><div style="border-bottom:1px solid #888;height:28px;"></div></td><td><button class="btn-remove" onclick="document.getElementById('${tr.id}').remove()">x</button></td>`;
  document.getElementById('om-persons-body').appendChild(tr);
}

function getOMPersons() {
  return Array.from(document.querySelectorAll('#om-persons-body tr')).map(tr => ({ nom: tr.querySelector('input')?.value || '' }));
}

function saveOM() {
  const editId = document.getElementById('om-edit-id').value;
  const chauffeur = document.getElementById('om-chauffeur').value.trim();
  const om = {
    id: editId || 'om_' + Date.now(),
    plaque: document.getElementById('om-plaque').value.trim(),
    chauffeur,
    cin: document.getElementById('om-cin').value,
    permis: document.getElementById('om-permis').value,
    date: document.getElementById('om-date').value,
    heure: document.getElementById('om-heure').value,
    dateArrivee: document.getElementById('om-date-arrivee').value,
    heureArrivee: document.getElementById('om-heure-arrivee').value,
    depart: document.getElementById('om-depart').value,
    arrivee: document.getElementById('om-arrivee').value,
    missionType: document.getElementById('om-mission-type').value,
    mission: document.getElementById('om-mission').value,
    addStamp: document.getElementById('om-addStamp')?.checked || false,
    persons: getOMPersons()
  };
  if (!om.plaque || !om.chauffeur) { alert('Vehicule et chauffeur obligatoires'); return; }
  let oms = STORE.oms();
  oms = editId ? oms.map(item => item.id === editId ? om : item) : oms.concat(om);
  STORE.saveOms(oms);

  // ✅ Auto-add collaborator if not already in list
  let collabs = STORE.collabs();
  const existingCollab = collabs.find(c => c.nom === chauffeur);
  if (!existingCollab) {
    const newCollab = {
      id: 'collab_' + Date.now(),
      nom: chauffeur,
      role: 'Chauffeur',
      contact: '',
      notes: ''
    };
    collabs.push(newCollab);
    STORE.saveCollabs(collabs);
  }

  // ✅ Auto-add véhicule si pas déjà dans la liste (garde aussi les anciens)
  let vehicules = ensureDefaultVehicules();
  const existingVeh = vehicules.find(v => v.plaque === om.plaque);
  if (!existingVeh) {
    vehicules.push({ id: 'veh_' + Date.now(), plaque: om.plaque, chauffeur: om.chauffeur, cin: om.cin, permis: om.permis });
    STORE.saveVehicules(vehicules);
  } else if (om.chauffeur && existingVeh.chauffeur !== om.chauffeur) {
    existingVeh.chauffeur = om.chauffeur;
    existingVeh.cin = om.cin;
    existingVeh.permis = om.permis;
    STORE.saveVehicules(vehicules);
  }

  showView('om-list');
}

function editOM(id) {
  const om = STORE.oms().find(item => item.id === id);
  if (!om) return;
  showView('om-new');
  document.getElementById('om-edit-id').value = om.id;
  document.getElementById('om-form-title').innerHTML = 'Modifier <span>Ordre de Mission</span>';
  renderOmVehiculeOptions(om.plaque || '');
  document.getElementById('om-chauffeur').value = om.chauffeur || '';
  document.getElementById('om-cin').value = om.cin || '';
  document.getElementById('om-permis').value = om.permis || '';
  document.getElementById('om-date').value = om.date || '';
  document.getElementById('om-heure').value = om.heure || '';
  document.getElementById('om-date-arrivee').value = om.dateArrivee || '';
  document.getElementById('om-heure-arrivee').value = om.heureArrivee || '';
  document.getElementById('om-depart').value = om.depart || '';
  document.getElementById('om-arrivee').value = om.arrivee || '';
  document.getElementById('om-mission-type').value = om.missionType || (String(om.mission || '').includes('aller-retour') ? 'aller_retour' : 'aller_simple');
  document.getElementById('om-mission').value = om.mission || OM_MISSION_TEXTS.aller_retour;
  document.getElementById('om-addStamp').checked = om.addStamp !== false;
  document.getElementById('om-persons-body').innerHTML = '';
  stableOmPersonCount = 0;
  const persons = Array.isArray(om.persons) && om.persons.length ? om.persons : Array(11).fill({ nom: '' });
  persons.forEach(p => addOmPerson(p.nom || ''));
}

function deleteOM(id) {
  if (!confirm('Supprimer cet ordre de mission ?')) return;
  STORE.saveOms(STORE.oms().filter(om => om.id !== id));
  renderOMList();
  updateSidebarStats();
}

function cancelOM() {
  showView('om-list');
}

function previewOM(id) {
  const om = STORE.oms().find(item => item.id === id);
  if (!om) return;
  // Use current checkbox values from form, not saved values
  om.addStamp = document.getElementById('om-addStamp')?.checked || false;
  document.getElementById('om-preview').innerHTML = buildOMHTML(om);
  document.getElementById('om-preview-modal').style.display = 'flex';
}

function closeOMPreview() {
  document.getElementById('om-preview-modal').style.display = 'none';
}

// [utils.js] cleanPrintText

function buildOMHTML(om) {
  const persons = Array.isArray(om.persons) && om.persons.length ? om.persons : Array(11).fill({ nom: '' });
  const rows = persons.map((p, i) => `<tr><td class="num-cell">${i + 1}</td><td>${esc(cleanPrintText(p.nom || ''))}</td><td></td></tr>`).join('');
  const vehicule = ensureDefaultVehicules().find(v => v.plaque === om.plaque);
  const societe = SOCIETES[vehicule?.societe] || SOCIETES.mythos;
  return `<div style="background:#fff;color:#000;width:794px;min-height:1123px;padding:7mm 6mm;box-sizing:border-box;font-family:Arial,sans-serif;font-size:14px;display:flex;flex-direction:column;">
    <div style="display:flex;justify-content:flex-start;align-items:flex-end;border-bottom:2px solid #000;padding-bottom:10px;margin-bottom:10px;">
      <img src="${societe.logo}" style="width:140px;max-height:80px;object-fit:contain;">
    </div>
    <h1 style="margin:0 0 20px;text-align:center;color:#000;font-size:34px;font-weight:900;letter-spacing:1px;">ORDRE DE MISSION</h1>
    <div class="om-info">
      <div><span>N immatriculation vehicule</span><b>:</b><strong>${esc(cleanPrintText(om.plaque))}</strong></div>
      <div><span>Chauffeur</span><b>:</b><strong>${esc(cleanPrintText(om.chauffeur))}</strong></div>
      <div><span>Numero de carte identite</span><b>:</b><strong>${esc(cleanPrintText(om.cin))}</strong></div>
      <div><span>Numero de permis de conduire</span><b>:</b><strong>${esc(cleanPrintText(om.permis))}</strong></div>
      <div><span>Date de commencement de la mission</span><b>:</b><strong>${formatDateLong(om.date)}${om.heure ? ' à ' + om.heure : ''}</strong></div>
      ${om.dateArrivee ? `<div><span>Date de fin de mission</span><b>:</b><strong>${formatDateLong(om.dateArrivee)}${om.heureArrivee ? ' à ' + om.heureArrivee : ''}</strong></div>` : ''}
      <div><span>Lieu de depart</span><b>:</b><strong>${esc(cleanPrintText(om.depart))}</strong></div>
      <div><span>Lieu d'arrivee</span><b>:</b><strong>${esc(cleanPrintText(om.arrivee))}</strong></div>
    </div>
    <div class="om-mission"><b>Mission :</b> ${esc(cleanPrintText(om.mission))}</div>
    <table class="om-persons"><thead><tr><th></th><th>Nom et prenom</th><th>Signature</th></tr></thead><tbody>${rows}</tbody></table>
    <style>
      .om-info{width:95%;margin:0 auto 5px;font-size:14px;font-weight:700}
      .om-info div{display:grid;grid-template-columns:320px 18px 1fr;padding:3px 0}
      .om-info span{font-weight:700}
      .om-info strong{font-weight:800}
      .om-mission{width:95%;margin:5px auto 10px;font-size:13px;font-weight:700;line-height:1.55}
      .om-persons{width:88%;border-collapse:collapse;margin:0 auto}
      .om-persons th,.om-persons td{border:1px solid #000;padding:7px 8px;height:22px}
      .om-persons th{text-align:center;font-weight:800}
      .om-persons .num-cell{width:44px;text-align:center;font-weight:700}
    </style>
    <div style="margin-bottom:10px;margin-top:15px;display:grid;grid-template-columns:1fr;gap:16px;font-size:11px;">
      <div style="text-align:right;display:flex;flex-direction:column;align-items:flex-end;gap:10px;margin-right:80px;">
        <div style="font-weight:900;color:#000;margin-bottom:8px;">Signature et Cachet</div>
        ${om.addStamp ? `<img src="${getStampSVG()}" style="height:90px;width:auto;transform:rotate(-3deg);opacity:0.85;filter:drop-shadow(1px 1px 2px rgba(30,64,175,0.3)) blur(0.3px);">` : ''}
      </div>
    </div>
    <div style="margin-top:auto;padding-top:12px;border-top:2px solid #000;font-size:10px;line-height:1.5;text-align:center;color:#000;">
      ${societe.footer}
    </div>
  </div>`;
}

function printModal(previewId) {
  const content = document.getElementById(previewId)?.innerHTML || '';
  const w = window.open('', '_blank');
  w.document.write(`<!doctype html><html><head><meta charset="UTF-8"><title>Impression</title><style>@page{size:A4;margin:0}body{margin:0;background:#fff;}</style></head><body>${content}</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}

// ── Clients CRUD → js/shared/clients.js ────────────────────────────────────
// currentClientDetailId, renderClients, showClientDetail, openClientModal,
// closeClientModal, saveClient, deleteClient

// ── Collaborateurs CRUD → js/shared/collaborateurs.js ─────────────────────
// currentCollabDetailId, renderCollaborateurs, showCollabDetail, openCollabModal,
// closeCollabModal, saveCollab, deleteCollab

// ── Natures CRUD → js/shared/natures.js ────────────────────────────────────
// renderNatures, showNatureDetail, openNatureModal, closeNatureModal, saveNature, deleteNature

// ── Fournisseurs CRUD → js/shared/fournisseurs.js ─────────────────────────
// fournisseurFilterCategory, fournisseurSearchQuery,
// renderFournisseurs, getFournisseurCategoryStyle, getFournisseurCategoryIcon,
// setFournisseurSearch, setFournisseurFilterCategory, resetFournisseurFilters,
// openFournisseurModal, closeFournisseurModal, saveFournisseur, deleteFournisseur

// CALENDRIER/RDV FUNCTIONS REMOVED - 2026-05-27

// ── NEW RENDEZ-VOUS MANAGEMENT ──
let comptaDashboardPeriod = 'all'; // 'all', 'year', 'month', 'week', 'day'

function filterByPeriod(items, dateField = 'date', period = comptaDashboardPeriod) {
  if (period === 'all') return items;
  const today = todayStr();
  const itemDate = (item) => String(item[dateField]);

  switch(period) {
    case 'day': return items.filter(i => itemDate(i) === today);
    case 'week': return items.filter(i => isDateInCurrentWeek(itemDate(i)));
    case 'month': return items.filter(i => itemDate(i).startsWith(today.slice(0, 7)));
    case 'year': return items.filter(i => itemDate(i).startsWith(today.slice(0, 4)));
    default: return items;
  }
}

function renderComptaViews() {
  const el = document.getElementById('compta-dashboard');
  if (!el) return;

  const invs = filterByPeriod(STORE.invoices());
  const purchases = filterByPeriod(STORE.purchases());
  const expenses = filterByPeriod(STORE.expenses());
  const bank = STORE.bankEntries();

  const sales = invs.reduce((s, i) => s + getInvoiceTotal(i), 0);
  const totalIncome = sales;
  const purchaseTotal = purchases.reduce((s, p) => s + num(p.amount), 0);
  const expenseTotal = expenses.reduce((s, e) => s + num(e.amount), 0);
  const lastBalance = bank.length ? num(bank.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)))[0].balance) : 0;
  const netResult = totalIncome - purchaseTotal - expenseTotal;

  const getPeriodLabel = (period) => {
    const labels = { all: 'Tout', year: 'Année', month: 'Mois', week: 'Semaine', day: 'Jour' };
    return labels[period] || period;
  };

  el.innerHTML = `
    <div style="margin-bottom:32px;">
      <div style="display:flex; gap:12px; flex-wrap:wrap; margin-bottom:20px;">
        ${['all', 'year', 'month', 'week', 'day'].map(p => `
          <button class="btn ${comptaDashboardPeriod === p ? 'btn-gold' : 'btn-outline'}" onclick="comptaDashboardPeriod='${p}'; renderComptaViews();" style="min-width:100px;">
            ${getPeriodLabel(p)}
          </button>
        `).join('')}
      </div>

      <h2 style="font-family:'Playfair Display',serif; color:var(--gold-light); font-size:20px; margin:0 0 16px; font-weight:800;">Résumé financier - ${getPeriodLabel(comptaDashboardPeriod)}</h2>

      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:16px; margin-bottom:32px;">
        <div style="background:linear-gradient(135deg, rgba(201,168,76,0.12), rgba(201,168,76,0.06)); border:1px solid rgba(201,168,76,0.2); border-radius:12px; padding:20px; text-align:center;">
          <div style="color:var(--muted); font-size:11px; text-transform:uppercase; font-weight:700; margin-bottom:8px;">Revenus Total</div>
          <div style="font-family:'Playfair Display',serif; font-size:32px; color:var(--gold-light); font-weight:800;">${fmtMoney(totalIncome)}</div>
          <div style="color:var(--muted); font-size:12px; margin-top:8px;">Factures: ${fmtMoney(sales)}</div>
        </div>

        <div style="background:linear-gradient(135deg, rgba(100,180,255,0.12), rgba(100,180,255,0.06)); border:1px solid rgba(100,180,255,0.2); border-radius:12px; padding:20px; text-align:center;">
          <div style="color:var(--muted); font-size:11px; text-transform:uppercase; font-weight:700; margin-bottom:8px;">Achats</div>
          <div style="font-family:'Playfair Display',serif; font-size:32px; color:#64b4ff; font-weight:800;">${fmtMoney(purchaseTotal)}</div>
          <div style="color:var(--muted); font-size:12px; margin-top:8px;">${purchases.length} facture${purchases.length !== 1 ? 's' : ''}</div>
        </div>

        <div style="background:linear-gradient(135deg, rgba(255,100,150,0.12), rgba(255,100,150,0.06)); border:1px solid rgba(255,100,150,0.2); border-radius:12px; padding:20px; text-align:center;">
          <div style="color:var(--muted); font-size:11px; text-transform:uppercase; font-weight:700; margin-bottom:8px;">Dépenses</div>
          <div style="font-family:'Playfair Display',serif; font-size:32px; color:#ff6496; font-weight:800;">${fmtMoney(expenseTotal)}</div>
          <div style="color:var(--muted); font-size:12px; margin-top:8px;">${expenses.length} dépense${expenses.length !== 1 ? 's' : ''}</div>
        </div>

        <div style="background:linear-gradient(135deg, rgba(${netResult >= 0 ? '76,201,100' : '201,100,76'},0.12), rgba(${netResult >= 0 ? '76,201,100' : '201,100,76'},0.06)); border:1px solid rgba(${netResult >= 0 ? '76,201,100' : '201,100,76'},0.2); border-radius:12px; padding:20px; text-align:center;">
          <div style="color:var(--muted); font-size:11px; text-transform:uppercase; font-weight:700; margin-bottom:8px;">Résultat Net</div>
          <div style="font-family:'Playfair Display',serif; font-size:32px; color:${netResult >= 0 ? '#4cc964' : '#ff6464'}; font-weight:800;">${netResult >= 0 ? '+' : ''}${fmtMoney(netResult)}</div>
          <div style="color:var(--muted); font-size:12px; margin-top:8px;">Revenus - Achats - Dépenses</div>
        </div>
      </div>

      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:16px; margin-bottom:32px;">
        <div style="background:linear-gradient(135deg, rgba(100,200,100,0.12), rgba(100,200,100,0.06)); border:1px solid rgba(100,200,100,0.2); border-radius:12px; padding:20px; text-align:center;">
          <div style="color:var(--muted); font-size:11px; text-transform:uppercase; font-weight:700; margin-bottom:8px;">Solde Bancaire</div>
          <div style="font-family:'Playfair Display',serif; font-size:28px; color:#64c864; font-weight:800;">${fmtMoney(lastBalance)}</div>
        </div>
      </div>
    </div>

    <div class="compta-link-grid" style="margin-bottom:32px;">
      <button class="compta-link-card" onclick="showView('compta-suppliers')"><div class="compta-link-head"><div class="compta-link-icon">F</div><div class="compta-link-arrow">></div></div><div class="compta-link-title">Liste des Fournisseurs</div><div class="compta-link-desc">Contacts, modes de paiement et categories.</div><div class="compta-link-meta">${STORE.suppliers().length} fournisseurs</div></button>
      <button class="compta-link-card blue" onclick="showView('compta-purchases')"><div class="compta-link-head"><div class="compta-link-icon">A</div><div class="compta-link-arrow">></div></div><div class="compta-link-title">Factures achats</div><div class="compta-link-desc">Achats et fournisseurs.</div><div class="compta-link-meta">${fmtMoney(purchases.reduce((s, p) => s + num(p.amount), 0))}</div></button>
      <button class="compta-link-card purple" onclick="showView('compta-expenses')"><div class="compta-link-head"><div class="compta-link-icon">D</div><div class="compta-link-arrow">></div></div><div class="compta-link-title">Depenses par periode</div><div class="compta-link-desc">Jour, semaine, mois et annee.</div><div class="compta-link-meta">${fmtMoney(expenses.reduce((s, e) => s + num(e.amount), 0))}</div></button>
      <button class="compta-link-card green" onclick="showView('compta-bank')"><div class="compta-link-head"><div class="compta-link-icon">B</div><div class="compta-link-arrow">></div></div><div class="compta-link-title">Extrait bancaire BIAT</div><div class="compta-link-desc">Mouvements et solde.</div><div class="compta-link-meta">${fmtMoney(lastBalance)}</div></button>
      <button class="compta-link-card gold" onclick="showView('compta-cash')"><div class="compta-link-head"><div class="compta-link-icon">C</div><div class="compta-link-arrow">></div></div><div class="compta-link-title">Gestion Caisse</div><div class="compta-link-desc">Entrées et sorties de caisse.</div><div class="compta-link-meta">${STORE.cashEntries ? STORE.cashEntries().length : 0} entrées</div></button>
      <button class="compta-link-card" onclick="showView('compta-reconciliation')" style="background:linear-gradient(135deg, rgba(201,168,76,0.15), rgba(201,168,76,0.08)); border:2px solid rgba(201,168,76,0.3);"><div class="compta-link-head"><div class="compta-link-icon" style="color:var(--gold-light); font-weight:800;">🔄</div><div class="compta-link-arrow">></div></div><div class="compta-link-title">Réconciliation Complète</div><div class="compta-link-desc">Tappabq shamilah - État financier.</div><div class="compta-link-meta">Banque + Caisse + Résultat</div></button>
    </div>

    <div class="compta-grid">
      <div class="compta-card"><div class="compta-title">Ventes</div><div class="compta-row"><span class="compta-label">Factures</span><span class="compta-value">${invs.length}</span></div><div class="compta-row"><span class="compta-label">Total TTC</span><span class="compta-value gold">${fmtMoney(sales)}</span></div></div>
      <div class="compta-card blue"><div class="compta-title">Achats</div><div class="compta-row"><span class="compta-label">Factures achats</span><span class="compta-value">${purchases.length}</span></div><div class="compta-row"><span class="compta-label">Total achats</span><span class="compta-value gold">${fmtMoney(purchaseTotal)}</span></div></div>
      <div class="compta-card purple"><div class="compta-title">Depenses</div><div class="compta-row"><span class="compta-label">Total</span><span class="compta-value gold">${fmtMoney(expenseTotal)}</span></div></div>
    </div>

    <div style="margin-top:32px; padding:24px; background:linear-gradient(135deg, rgba(201,168,76,0.05), rgba(201,168,76,0.02)); border:1px solid rgba(201,168,76,0.1); border-radius:12px;">
      <h3 style="font-family:'Playfair Display',serif; color:var(--gold-light); font-size:16px; margin:0 0 16px; font-weight:800;">📊 Connexions comptables</h3>
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(240px, 1fr)); gap:16px; font-size:13px; color:var(--muted);">
        <div>
          <div style="color:var(--gold); font-weight:700; margin-bottom:6px;">💰 Dépenses par période</div>
          <div style="line-height:1.6;">
            <div>→ Organisées par ${Object.keys(getExpenseCategories()).length} catégories</div>
            <div>→ ${STORE.expenses().length} entrées totales</div>
            <div>→ Filtrables par période</div>
          </div>
        </div>
        <div>
          <div style="color:var(--gold); font-weight:700; margin-bottom:6px;">📄 Factures achats</div>
          <div style="line-height:1.6;">
            <div>→ Liées à ${STORE.suppliers().length} fournisseurs</div>
            <div>→ ${purchases.length} factures</div>
            <div>→ Avec détail TVA</div>
          </div>
        </div>
        <div>
          <div style="color:var(--gold); font-weight:700; margin-bottom:6px;">🏦 Extrait BIAT</div>
          <div style="line-height:1.6;">
            <div>→ Solde actuel: ${fmtMoney(lastBalance)}</div>
            <div>→ ${bank.length} mouvements</div>
            <div>→ Connecté à la caisse</div>
          </div>
        </div>
        <div>
          <div style="color:var(--gold); font-weight:700; margin-bottom:6px;">🪙 Caisse</div>
          <div style="line-height:1.6;">
            <div>→ Retraits du compte BIAT</div>
            <div>→ Alimentation des dépenses</div>
            <div>→ Traçabilité complète</div>
          </div>
        </div>
      </div>
    </div>

    ${renderFinancialFlowDiagram()}`;
}

function renderSuppliersPage() {
  const el = document.getElementById('compta-suppliers-page');
  let suppliers = STORE.suppliers();
  if (!suppliers.length) { el.innerHTML = '<div class="empty-state">Aucun fournisseur.</div>'; return; }

  // Appliquer les filtres
  suppliers = suppliers.filter(s => {
    // Filtre catégorie
    if (supplierFilterCategory !== 'all' && s.category !== supplierFilterCategory) return false;

    // Filtre recherche
    if (supplierSearchQuery) {
      const query = supplierSearchQuery.toLowerCase();
      if (!s.name.toLowerCase().includes(query) &&
          !s.contact.toLowerCase().includes(query) &&
          !(s.addr && s.addr.toLowerCase().includes(query))) {
        return false;
      }
    }

    return true;
  }).sort((a, b) => a.name.localeCompare(b.name));

  // Obtenir les catégories uniques
  const allSuppliers = STORE.suppliers();
  const categories = ['all', ...new Set(allSuppliers.filter(s => s.category).map(s => s.category))];

  let html = `<div style="padding:16px; background:linear-gradient(135deg, rgba(201,168,76,0.08), rgba(201,168,76,0.04)); border:1px solid rgba(201,168,76,0.15); border-radius:12px; margin-bottom:16px;">
    <div style="color:var(--gold); font-weight:700; margin-bottom:12px; font-size:13px;">🔍 RECHERCHER & FILTRER</div>
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(250px, 1fr)); gap:12px;">
      <div>
        <label style="color:var(--muted); font-size:11px; font-weight:700; margin-bottom:4px; display:block;">Rechercher par nom, contact ou adresse</label>
        <input type="text" id="supplier-search" placeholder="Tapez pour chercher..." value="${supplierSearchQuery}" oninput="setSupplierSearch(this.value)" style="width:100%; padding:8px; background:#1a1a1a; color:#c9a84c; border:1px solid #333; border-radius:6px;">
      </div>

      <div>
        <label style="color:var(--muted); font-size:11px; font-weight:700; margin-bottom:4px; display:block;">Filtrer par catégorie</label>
        <select id="supplier-filter-category" onchange="setSupplierFilterCategory(this.value)" style="width:100%; padding:8px; background:#1a1a1a; color:#c9a84c; border:1px solid #333; border-radius:6px;">
          <option value="all">📊 Toutes les catégories</option>
          ${categories.filter(c => c !== 'all').map(cat => `<option value="${cat}" ${supplierFilterCategory === cat ? 'selected' : ''}>${getSupplierCategoryStyle(cat).icon} ${cat}</option>`).join('')}
        </select>
      </div>

      <div style="display:flex; align-items:flex-end;">
        <button class="btn btn-outline btn-sm" onclick="resetSupplierFilters()" style="width:100%;">🔄 Réinitialiser</button>
      </div>
    </div>
    <div style="color:var(--muted); font-size:12px; margin-top:8px;">📌 ${suppliers.length} fournisseur(s) affichée(s)</div>
  </div>`;

  html += '<div style="width:100%; overflow-x:auto; -webkit-overflow-scrolling:touch; border-radius:12px;"><table class="suppliers-list-table" style="width:100%; table-layout:fixed; min-width:900px;"><thead><tr style="background:#1a1a1a;"><th style="width:20%;padding:6px 8px;">Nom</th><th style="width:15%;padding:6px 8px;">Contact</th><th style="width:25%;padding:6px 8px;">Adresse</th><th style="width:15%;padding:6px 8px;">Catégorie</th><th style="width:25%;text-align:center;padding:6px 8px;">Actions</th></tr></thead><tbody>' +
  suppliers.map(s => {
    const catStyle = getSupplierCategoryStyle(s.category);
    return `<tr style="cursor:pointer; border-left:4px solid ${catStyle.color}; background:${catStyle.bg};" onclick="showSupplierDetail('${s.id}')">
      <td style="padding:6px 8px;word-break:break-word;"><strong>${esc(s.name || 'Fournisseur')}</strong></td>
      <td style="padding:6px 8px;word-break:break-word;">${esc(s.contact || '')}</td>
      <td style="color:var(--muted);font-size:12px;padding:6px 8px;word-break:break-word;">${esc(s.addr || '')}</td>
      <td style="padding:6px 8px;word-break:break-word;"><span style="font-size:16px;margin-right:6px;">${catStyle.icon}</span><strong>${esc(s.category || '')}</strong></td>
      <td style="text-align:center;padding:6px 8px;" onclick="event.stopPropagation();">
        <button class="btn btn-outline btn-sm" style="margin:0 2px;" onclick="openSupplierModal('${s.id}')" title="Modifier">✏️</button>
        <button class="btn btn-danger btn-sm" style="margin:0 2px;" onclick="deleteSupplier('${s.id}')" title="Supprimer">✕</button>
      </td>
    </tr>`;
  }).join('') + '</tbody></table></div>';

  el.innerHTML = html;
}

function showSupplierDetail(supplierId) {
  const supplier = STORE.suppliers().find(s => s.id === supplierId);
  if (!supplier) return;
  const purchases = STORE.purchases().filter(p => p.supplierName === supplier.name);
  const bankEntries = STORE.bankEntries().filter(b => b.linkedId === supplierId && b.linkedType === 'supplier');
  const totalAmount = purchases.reduce((sum, p) => sum + num(p.amount), 0);
  const totalBankAmount = bankEntries.reduce((sum, b) => sum + num(b.amount), 0);

  const el = document.getElementById('compta-suppliers-page');
  el.innerHTML = `
    <div style="margin-bottom:24px;">
      <button class="btn btn-outline" onclick="renderSuppliersPage()" style="margin-bottom:16px;">← Retour à la liste</button>
      <div style="background:linear-gradient(135deg, rgba(201,168,76,0.12), rgba(201,168,76,0.06)); border:1px solid rgba(201,168,76,0.2); border-radius:16px; padding:32px 40px; margin-bottom:32px;">
        <h1 style="font-family:'Playfair Display',serif; font-size:42px; color:var(--gold-light); font-weight:800; margin:0 0 16px 0;">${esc(supplier.name)}</h1>
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:20px; margin-top:20px;">
          <div><div style="color:var(--muted); font-size:11px; text-transform:uppercase; font-weight:700; margin-bottom:5px;">Contact</div><div style="color:var(--text); font-size:14px;">${esc(supplier.contact || '-')}</div></div>
          <div><div style="color:var(--muted); font-size:11px; text-transform:uppercase; font-weight:700; margin-bottom:5px;">Adresse</div><div style="color:var(--text); font-size:14px;">${esc(supplier.addr || '-')}</div></div>
          <div><div style="color:var(--muted); font-size:11px; text-transform:uppercase; font-weight:700; margin-bottom:5px;">Catégorie</div><div style="color:var(--text); font-size:14px;">${esc(supplier.category || '-')}</div></div>
          <div><div style="color:var(--muted); font-size:11px; text-transform:uppercase; font-weight:700; margin-bottom:5px;">Immatricule Fiscal</div><div style="color:var(--text); font-size:14px;">${esc(supplier.immatricule || '-')}</div></div>
        </div>
      </div>
    </div>

    <h2 style="font-family:'Playfair Display',serif; color:var(--gold-light); font-size:20px; margin:32px 0 20px; border-bottom:2px solid rgba(201,168,76,0.3); padding-bottom:12px; font-weight:800;">Extraits bancaires liés (${bankEntries.length})</h2>
    ${bankEntries.length === 0 ? '<div class="empty-state">Aucun extrait bancaire lié à ce fournisseur.</div>' : '<table class="suppliers-list-table" style="margin-top:16px;"><thead><tr><th>Date</th><th>Type</th><th>Libellé</th><th style="text-align:right;">Montant</th><th style="width:80px;text-align:center;">Actions</th></tr></thead><tbody>' + bankEntries.map(b => `<tr><td>${esc((b.date || '').slice(5))}</td><td>${esc(b.type || '-')}</td><td style="color:var(--muted);font-size:12px;">${esc(b.label || '')}</td><td style="text-align:right;color:${b.direction === 'Debit' ? '#ff6464' : '#4cc964'};font-weight:700;">${fmtMoney(b.amount)}</td><td style="text-align:center;"><button class="btn btn-outline btn-sm" onclick="openBankDetailModal('${b.id}')" title="Détails">👁️</button></td></tr>`).join('') + '</tbody></table>'}

    <div style="margin-top:32px; padding:20px; background:linear-gradient(135deg, rgba(201,168,76,0.08), rgba(201,168,76,0.04)); border:1px solid rgba(201,168,76,0.15); border-radius:12px; text-align:center;">
      <div style="color:var(--muted); font-size:12px; text-transform:uppercase; margin-bottom:8px;">Total des Extraits Bancaires</div>
      <div style="font-family:'Playfair Display',serif; font-size:28px; color:var(--gold-light); font-weight:800;">${fmtMoney(totalBankAmount)}</div>
    </div>

    <h2 style="font-family:'Playfair Display',serif; color:var(--gold-light); font-size:20px; margin:32px 0 20px; border-bottom:2px solid rgba(201,168,76,0.3); padding-bottom:12px; font-weight:800;">Factures liées (${purchases.length})</h2>
    ${purchases.length === 0 ? '<div class="empty-state">Aucune facture pour ce fournisseur.</div>' : '<table class="suppliers-list-table" style="margin-top:16px;"><thead><tr><th>N°</th><th>Date</th><th>Notes</th><th style="text-align:right;">Montant</th><th style="width:150px;text-align:center;">Actions</th></tr></thead><tbody>' + purchases.map(p => `<tr><td><strong>${esc(p.num || '-')}</strong></td><td>${esc(p.date || '')}</td><td style="color:var(--muted);font-size:12px;">${esc(p.notes || '')}</td><td style="text-align:right;color:var(--gold-light);font-weight:700;">${fmtMoney(p.amount)}</td><td style="text-align:center;"><button class="btn btn-outline btn-sm" onclick="openPurchaseModal('${p.id}')" title="Modifier">✏️</button> <button class="btn btn-danger btn-sm" onclick="deletePurchase('${p.id}')" title="Supprimer">✕</button></td></tr>`).join('') + '</tbody></table>'}

    <div style="margin-top:32px; padding:20px; background:linear-gradient(135deg, rgba(201,168,76,0.08), rgba(201,168,76,0.04)); border:1px solid rgba(201,168,76,0.15); border-radius:12px; text-align:center;">
      <div style="color:var(--muted); font-size:12px; text-transform:uppercase; margin-bottom:8px;">Total des Factures</div>
      <div style="font-family:'Playfair Display',serif; font-size:28px; color:var(--gold-light); font-weight:800;">${fmtMoney(totalAmount)}</div>
    </div>
  `;
}
function getPurchaseSelectedIds() {
  const checkboxes = document.querySelectorAll('input[name="purchase-select"]:checked');
  return Array.from(checkboxes).map(cb => cb.value);
}

function togglePurchaseSelectAll(checked) {
  document.querySelectorAll('input[name="purchase-select"]').forEach(cb => cb.checked = checked);
}

function deletePurchaseSelected() {
  const ids = getPurchaseSelectedIds();
  if (ids.length === 0) { alert('Aucune ligne selectionnée'); return; }
  if (!confirm(`Supprimer ${ids.length} facture(s) ?`)) return;
  const remaining = STORE.purchases().filter(p => !ids.includes(p.id));
  STORE.savePurchases(remaining);
  renderPurchasesPage();
  renderComptaViews();
}

function getSupplierCategoryStyle(category) {
  const styles = {
    'Mécanicien': { icon: '🔧', color: '#ff6496', bg: 'rgba(255,100,150,0.1)' },
    'Alimentation': { icon: '🍕', color: '#4cc964', bg: 'rgba(76,201,100,0.1)' },
    'Carburant': { icon: '⛽', color: '#ffa500', bg: 'rgba(255,165,0,0.1)' },
    'Télécommunications': { icon: '📱', color: '#64b4ff', bg: 'rgba(100,180,255,0.1)' },
    'Logistique': { icon: '🚚', color: '#c9a84c', bg: 'rgba(201,168,76,0.1)' },
    'Électronique': { icon: '💻', color: '#9b59b6', bg: 'rgba(155,89,182,0.1)' },
    'Services': { icon: '💼', color: '#3498db', bg: 'rgba(52,152,219,0.1)' },
    'Décor': { icon: '🎨', color: '#e74c3c', bg: 'rgba(231,76,60,0.1)' },
    'Matériel': { icon: '🔧', color: '#95a5a6', bg: 'rgba(149,165,166,0.1)' }
  };
  return styles[category] || { icon: '📦', color: '#c9a84c', bg: 'rgba(201,168,76,0.1)' };
}

function getCategoryIcon(category) {
  const iconMap = {
    'Décor': '🎨',
    'Matériel': '🔧',
    'Carburant': '⛽',
    'Hôtel': '🏨',
    'Transport': '🚚',
    'Alimentation': '🍽️',
    'Autre': '📦'
  };
  return iconMap[category] || '📋';
}

function renderPurchasesPage() {
  const el = document.getElementById('compta-purchases-page');
  if (!el) return;
  const items = STORE.purchases();

  let html = '';
  if (items.length > 0) {
    html += '<div style="margin-bottom:12px;"><button class="btn btn-danger btn-sm" onclick="deletePurchaseSelected()" title="Supprimer les éléments sélectionnés">✕ Supprimer</button></div>';
  }

  if (!items.length) { el.innerHTML = '<div class="empty-state">Aucune donnee.</div>'; return; }

  html += '<div style="width:100%; overflow-x:auto; -webkit-overflow-scrolling:touch; border-radius:12px;">' +
    '<table class="stat-table" style="width:100%; table-layout:fixed; min-width:1000px;">' +
    '<thead><tr style="background:linear-gradient(145deg,#1a1a1a,#0e0e0e);border:1px solid #c9a84c;border-bottom:2px solid #c9a84c;"><th style="width:3%;text-align:center;color:#c9a84c;font-weight:700;padding:6px 8px;"><input type="checkbox" onchange="togglePurchaseSelectAll(this.checked)"></th><th style="width:10%;color:#c9a84c;font-weight:700;padding:6px 8px;">N°</th><th style="width:10%;color:#c9a84c;font-weight:700;padding:6px 8px;">Date</th><th style="width:20%;color:#c9a84c;font-weight:700;padding:6px 8px;">Fournisseur</th><th style="width:18%;color:#c9a84c;font-weight:700;padding:6px 8px;">Notes</th><th style="width:15%;color:#c9a84c;font-weight:700;padding:6px 8px;">Mode de paiement</th><th style="width:12%;color:#c9a84c;font-weight:700;padding:6px 8px;text-align:right;">TVA Total</th><th style="width:12%;color:#c9a84c;font-weight:700;padding:6px 8px;text-align:right;">Montant</th></tr></thead>' +
    '<tbody>' + items.map(p => {
      const tvaTotalAmount = (num(p.tva19Amount || 0) + num(p.tva13Amount || 0) + num(p.tva7Amount || 0));
      return `<tr class="compta-detail-row" style="display:table-row;cursor:pointer;" onclick="openPurchaseModal('${p.id}')">` +
        `<td style="text-align:center;padding:6px 8px;" onclick="event.stopPropagation();"><input type="checkbox" name="purchase-select" value="${p.id}"></td>` +
        `<td style="padding:6px 8px;word-break:break-word;">${esc(p.num || '')}</td>` +
        `<td style="padding:6px 8px;word-break:break-word;">${esc(p.date || '')}</td>` +
        `<td style="padding:6px 8px;word-break:break-word;"><span style="font-size:18px;margin-right:4px;">${getCategoryIcon(p.category)}</span>${esc(p.supplierName || '')}</td>` +
        `<td style="color:#999;font-size:12px;padding:6px 8px;word-break:break-word;">${esc(p.notes || '')}</td>` +
        `<td style="color:#999;font-size:12px;padding:6px 8px;word-break:break-word;">${esc(p.payment || '')}</td>` +
        `<td style="text-align:right;color:#c9a84c;font-weight:600;padding:6px 8px;word-break:break-word;">${fmtMoney(tvaTotalAmount)}</td>` +
        `<td style="text-align:right;font-weight:600;padding:6px 8px;word-break:break-word;">${fmtMoney(p.amount)}</td>` +
      `</tr>`;
    }).join('') + '</tbody></table></div>';

  el.innerHTML = html;
}
function renderExpensesByPaymentType(items) {
  const paymentBreakdown = {};
  const paymentIcons = {
    'BIAT': '🏦',
    'Virement': '💳',
    'Espèces': '💵',
    'Chèque': '📋',
    'Carte': '💳'
  };

  items.forEach(e => {
    const payment = e.payment || 'Non spécifié';
    if (!paymentBreakdown[payment]) {
      paymentBreakdown[payment] = { total: 0, count: 0, items: [] };
    }
    paymentBreakdown[payment].total += num(e.amount);
    paymentBreakdown[payment].count += 1;
    paymentBreakdown[payment].items.push(e);
  });

  const sortedPayments = Object.entries(paymentBreakdown)
    .sort((a, b) => num(b[1].total) - num(a[1].total));

  const totalAmount = sortedPayments.reduce((sum, [_, data]) => sum + data.total, 0);

  return `
    <div style="margin-top:32px;">
      <h3 style="font-family:'Playfair Display',serif; color:var(--gold-light); font-size:18px; margin:0 0 20px; font-weight:800;">💳 Dépenses par type de paiement</h3>
      <table class="expenses-list-table">
        <thead>
          <tr>
            <th style="width:20%;">Mode de paiement</th>
            <th style="text-align:center;">Nombre</th>
            <th style="text-align:right;">Montant</th>
            <th style="text-align:right;">% du total</th>
            <th style="width:200px;">Visualisation</th>
          </tr>
        </thead>
        <tbody>
          ${sortedPayments.map(([payment, data]) => {
            const percentage = totalAmount > 0 ? (data.total / totalAmount * 100).toFixed(1) : 0;
            const icon = paymentIcons[payment] || '💰';
            return `
              <tr>
                <td><span style="font-size:18px; margin-right:8px;">${icon}</span><strong>${esc(payment)}</strong></td>
                <td style="text-align:center; color:var(--muted);">${data.count}</td>
                <td style="text-align:right; color:var(--gold-light); font-weight:700;">${fmtMoney(data.total)}</td>
                <td style="text-align:right; color:var(--muted);">${percentage}%</td>
                <td>
                  <div style="background:linear-gradient(90deg, var(--gold) 0%, transparent ${percentage}%); height:24px; border-radius:4px; display:flex; align-items:center; padding:0 8px; color:var(--text); font-size:12px; font-weight:700;">
                    ${percentage > 10 ? percentage + '%' : ''}
                  </div>
                </td>
              </tr>
            `;
          }).join('')}
          <tr style="border-top:2px solid rgba(201,168,76,0.3); font-weight:700; background:linear-gradient(135deg, rgba(201,168,76,0.08), rgba(201,168,76,0.04));">
            <td><strong>TOTAL</strong></td>
            <td style="text-align:center;">${items.length}</td>
            <td style="text-align:right; color:var(--gold-light);">${fmtMoney(totalAmount)}</td>
            <td style="text-align:right;">100%</td>
            <td></td>
          </tr>
        </tbody>
      </table>
    </div>
  `;
}

function renderExpensesPage() {
  const el = document.getElementById('compta-expenses-page');
  let items = STORE.expenses();
  const today = todayStr();
  if (comptaExpenseFilter === 'day') items = items.filter(e => e.date === today);
  if (comptaExpenseFilter === 'week') items = items.filter(e => isDateInCurrentWeek(e.date));
  if (comptaExpenseFilter === 'month') items = items.filter(e => String(e.date).startsWith(today.slice(0, 7)));
  if (comptaExpenseFilter === 'year') items = items.filter(e => String(e.date).startsWith(today.slice(0, 4)));
  if (comptaExpenseFilter === 'previous') items = items.filter(e => String(e.date).slice(0, 4) < today.slice(0, 4));

  let html = '';

  if (!items.length) {
    html = '<div class="empty-state">Aucune dépense.</div>';
  } else {
    html = '<div style="margin-bottom:24px; width:100%; overflow-x:auto; -webkit-overflow-scrolling:touch; border-radius:12px;"><table class="expenses-list-table" style="width:100%; table-layout:fixed; min-width:1100px;"><thead><tr style="background:#1a1a1a;"><th style="width:10%;padding:6px 8px;">Date</th><th style="width:20%;padding:6px 8px;">Libellé</th><th style="width:15%;padding:6px 8px;">Catégorie</th><th style="width:15%;padding:6px 8px;">Mode de paiement</th><th style="width:15%;text-align:right;padding:6px 8px;">Montant</th><th style="width:25%;text-align:center;padding:6px 8px;">Actions</th></tr></thead><tbody>' +
      items.map(e => `<tr><td style="padding:6px 8px;word-break:break-word;">${esc(e.date || '')}</td><td style="padding:6px 8px;word-break:break-word;"><strong>${esc(e.label || 'Dépense')}</strong></td><td style="padding:6px 8px;word-break:break-word;">${esc(e.category || '')}</td><td style="padding:6px 8px;word-break:break-word;">${esc(e.payment || '')}</td><td style="text-align:right;color:var(--gold-light);font-weight:700;padding:6px 8px;word-break:break-word;">${fmtMoney(e.amount)}</td><td style="text-align:center;padding:6px 8px;"><button class="btn btn-outline btn-sm" style="margin:0 2px;" onclick="openExpenseModal('${e.id}')" title="Modifier">✏️</button> <button class="btn btn-danger btn-sm" style="margin:0 2px;" onclick="deleteExpense('${e.id}')" title="Supprimer">✕</button></td></tr>`).join('') +
      '</tbody></table></div>' +
      renderExpensesByPaymentType(items) +
      renderExpenseReportByCategory();
  }

  el.innerHTML = html;
}
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
      <div onclick="event.stopPropagation()" style="background:#0e0e0e; border:2px solid #c9a84c; border-radius:16px; padding:32px; max-width:600px; width:90%; max-height:80vh; overflow-y:auto;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:24px;">
          <h2 style="color:#c9a84c; font-family:'Playfair Display',serif; font-size:24px; margin:0;">📋 Détails de la Transaction</h2>
          <button onclick="closeBankDetailModal()" style="background:none; border:none; color:#c9a84c; font-size:24px; cursor:pointer;">✕</button>
        </div>

        <div style="background:#1a1a1a; padding:20px; border-radius:12px; margin-bottom:20px;">
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:16px;">
            <div>
              <div style="color:#999; font-size:11px; text-transform:uppercase; font-weight:700; margin-bottom:5px;">Date</div>
              <div style="color:#c9a84c; font-size:14px;">${esc((entry.date || '').slice(5))}</div>
            </div>
            <div>
              <div style="color:#999; font-size:11px; text-transform:uppercase; font-weight:700; margin-bottom:5px;">Type</div>
              <div style="color:#c9a84c; font-size:14px;"><span style="font-size:16px; margin-right:4px;">${getBankTypeIcon(entry.type)}</span>${esc(entry.type || '')}</div>
            </div>
            <div>
              <div style="color:#999; font-size:11px; text-transform:uppercase; font-weight:700; margin-bottom:5px;">Montant</div>
              <div style="color:#c9a84c; font-size:14px; font-weight:700;">${fmtMoney(entry.amount)}</div>
            </div>
            <div>
              <div style="color:#999; font-size:11px; text-transform:uppercase; font-weight:700; margin-bottom:5px;">Direction</div>
              <div style="color:#c9a84c; font-size:14px;">${entry.direction || 'N/A'}</div>
            </div>
            <div>
              <div style="color:#999; font-size:11px; text-transform:uppercase; font-weight:700; margin-bottom:5px;">Référence</div>
              <div style="color:#c9a84c; font-size:14px; font-family:monospace;">${esc(entry.reference || entry.id || 'N/A')}</div>
            </div>
          </div>

          <div style="margin-top:16px; padding-top:16px; border-top:1px solid #333;">
            <div style="color:#999; font-size:11px; text-transform:uppercase; font-weight:700; margin-bottom:8px;">Libellé Complet</div>
            <div style="color:#ddd; font-size:13px; line-height:1.6; padding:12px; background:#0a0a0a; border-radius:8px; border-left:3px solid #c9a84c;">
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
    const nextSeparator = contractSelect.closest('div[style*="rgba(201,168,76"]')?.nextElementSibling;
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

function renderCashPage() {
  const el = document.getElementById('compta-cash-page');
  if (!el) return;

  let cashEntries = STORE.cashEntries ? STORE.cashEntries() : [];
  const expenses = STORE.expenses();
  const invoices = STORE.invoices();

  if (!cashEntries.length) {
    el.innerHTML = '<div class="empty-state">Aucune entrée caisse.</div>';
    return;
  }

  // Appliquer les filtres
  cashEntries = cashEntries.filter(c => {
    // Filtre statut (type de liaison)
    if (comptaCashFilterStatus === 'expense' && c.linkedType !== 'expense') return false;
    if (comptaCashFilterStatus === 'income' && c.linkedType !== 'income') return false;
    if (comptaCashFilterStatus === 'bank' && c.linkedType !== 'bank') return false;
    if (comptaCashFilterStatus === 'unlinked' && c.linkedId) return false;

    // Filtre montant
    const amount = Math.abs(num(c.amount));
    if (amount < comptaCashFilterMinAmount || amount > comptaCashFilterMaxAmount) return false;

    return true;
  });

  const getLinkedInfo = (entry) => {
    if (!entry.linkedId) return { text: 'Non lié', color: '#ff6464', icon: '⚠️' };

    if (entry.linkedType === 'expense') {
      const exp = expenses.find(e => e.id === entry.linkedId);
      return { text: `🔴 Dépense: ${exp?.label || '?'}`, color: '#ff6464', icon: '💸' };
    }
    if (entry.linkedType === 'income') {
      const inv = invoices.find(i => i.id === entry.linkedId);
      return { text: `🟢 Revenu: ${inv?.num || '?'}`, color: '#4cc964', icon: '💰' };
    }
    if (entry.linkedType === 'bank') {
      const bank = STORE.bankEntries && STORE.bankEntries().find(b => b.id === entry.linkedId);
      return { text: `💳 Virement: ${bank?.type || '?'} ${bank?.date || ''}`, color: '#64b4ff', icon: '🏦' };
    }
    return { text: 'Lien invalide', color: '#ffa500', icon: '❓' };
  };

  let html = `<div style="padding:16px; background:linear-gradient(135deg, rgba(201,168,76,0.08), rgba(201,168,76,0.04)); border:1px solid rgba(201,168,76,0.15); border-radius:12px; margin-bottom:16px;">
    <div style="color:var(--gold); font-weight:700; margin-bottom:12px; font-size:13px;">🔍 FILTRER LA CAISSE</div>
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:12px;">
      <div>
        <label style="color:var(--muted); font-size:11px; font-weight:700; margin-bottom:4px; display:block;">Type de Liaison</label>
        <select id="cash-filter-status" onchange="setComptaCashFilterStatus(this.value)" style="width:100%; padding:6px; background:#1a1a1a; color:#c9a84c; border:1px solid #333; border-radius:6px;">
          <option value="all">📊 Tous</option>
          <option value="expense" ${comptaCashFilterStatus === 'expense' ? 'selected' : ''}>🔴 Dépenses</option>
          <option value="income" ${comptaCashFilterStatus === 'income' ? 'selected' : ''}>🟢 Revenus</option>
          <option value="bank" ${comptaCashFilterStatus === 'bank' ? 'selected' : ''}>💳 Virements</option>
          <option value="unlinked" ${comptaCashFilterStatus === 'unlinked' ? 'selected' : ''}>⚠️ Non liés</option>
        </select>
      </div>

      <div>
        <label style="color:var(--muted); font-size:11px; font-weight:700; margin-bottom:4px; display:block;">Montant Min</label>
        <input type="number" id="cash-filter-min" value="${comptaCashFilterMinAmount === 0 ? '' : comptaCashFilterMinAmount}" placeholder="0" onchange="setComptaCashFilterAmount()" style="width:100%; padding:6px; background:#1a1a1a; color:#c9a84c; border:1px solid #333; border-radius:6px;">
      </div>

      <div>
        <label style="color:var(--muted); font-size:11px; font-weight:700; margin-bottom:4px; display:block;">Montant Max</label>
        <input type="number" id="cash-filter-max" value="${comptaCashFilterMaxAmount === Infinity ? '' : comptaCashFilterMaxAmount}" placeholder="∞" onchange="setComptaCashFilterAmount()" style="width:100%; padding:6px; background:#1a1a1a; color:#c9a84c; border:1px solid #333; border-radius:6px;">
      </div>

      <div style="display:flex; align-items:flex-end;">
        <button class="btn btn-outline btn-sm" onclick="resetComptaCashFilters()" style="width:100%;">🔄 Réinitialiser</button>
      </div>
    </div>
    <div style="color:var(--muted); font-size:12px; margin-top:8px;">📌 ${cashEntries.length} entrée(s) affichée(s)</div>
  </div>`;

  html += '<table class="expenses-list-table" style="width:100%; border-collapse:collapse;"><thead><tr>' +
    '<th style="width:14%; padding:16px 12px;">Date</th>' +
    '<th style="width:24%; padding:16px 12px;">Description</th>' +
    '<th style="width:14%; text-align:right; padding:16px 12px;">Montant</th>' +
    '<th style="width:18%; padding:16px 12px;">Lié à</th>' +
    '<th style="width:30%; text-align:center; padding:16px 12px;">Actions</th>' +
    '</tr></thead><tbody>';

  cashEntries.forEach(entry => {
    const linked = getLinkedInfo(entry);
    const actions = entry.linkedId ?
      `<span style="background:${linked.color}22; color:${linked.color}; padding:4px 8px; border-radius:4px; font-size:11px; font-weight:700;">✓ Lié</span> ` +
      `<button class="btn btn-outline btn-sm" onclick="openCashLinkModal('${entry.id}')">Changer</button> ` +
      `<button class="btn btn-danger btn-sm" onclick="unlinkCashEntry('${entry.id}')">Délier</button>` :
      `<span style="background:#ff646422; color:#ff6464; padding:4px 8px; border-radius:4px; font-size:11px; font-weight:700;">⚠️ Non lié</span> ` +
      `<button class="btn btn-gold btn-sm" onclick="openCashLinkModal('${entry.id}')">Lier</button>`;

    html += `
      <tr style="border-left:4px solid ${linked.color}; border-bottom:1px solid rgba(201,168,76,0.08);">
        <td style="padding:12px;"><strong>${esc(entry.date || '')}</strong></td>
        <td style="padding:12px;">${esc(entry.description || '')}</td>
        <td style="padding:12px; text-align:right; color:var(--gold-light); font-weight:700;">+${fmtMoney(entry.amount)}</td>
        <td style="padding:12px;"><div style="color:${linked.color}; font-size:12px;"><span style="font-size:14px;">${linked.icon}</span> ${linked.text}</div></td>
        <td style="padding:12px; text-align:center; white-space:nowrap;">${actions}</td>
      </tr>`;
  });

  html += '</tbody></table>';
  el.innerHTML = html;
}

function openCashLinkModal(cashEntryId) {
  const modal = document.getElementById('cash-link-modal');
  if (!modal) { alert('❌ Erreur: Le modal de liaison caisse est introuvable!'); return; }

  const cashEntries = STORE.cashEntries ? STORE.cashEntries() : [];
  const entry = cashEntries.find(c => c.id === cashEntryId);
  if (!entry) { alert('❌ Erreur: Cette entrée caisse n\'existe pas!'); return; }

  const expenses = STORE.expenses();
  const invoices = STORE.invoices();
  const bankEntries = STORE.bankEntries ? STORE.bankEntries() : [];

  // Vérifier s'il y a des données à lier
  if (expenses.length === 0 && invoices.length === 0 && bankEntries.length === 0) {
    alert('⚠️ Aucune dépense, revenu ou compte bancaire à lier!\n\nCréez d\'abord:\n• Des dépenses\n• Des factures\n• Ou des transactions bancaires');
    return;
  }

  document.getElementById('cash-link-id').value = cashEntryId;

  const expenseSelect = document.getElementById('cash-link-expense');
  const incomeSelect = document.getElementById('cash-link-income');
  const bankSelect = document.getElementById('cash-link-bank');
  const titleEl = document.getElementById('cash-link-title');
  const hintEl = document.getElementById('cash-link-hint');

  // Mettre à jour le titre et l'indice
  if (titleEl) {
    titleEl.textContent = '💰 Lier cette entrée de caisse';
  }
  if (hintEl) {
    hintEl.textContent = 'Associez cette entrée de caisse à une dépense, un revenu, ou un virement bancaire.';
  }

  // Construire les options avec disabled si vides
  let expenseHTML = '<option value="">-- Aucune dépense --</option>';
  if (expenses.length > 0) {
    expenseHTML += expenses.map(e => `<option value="${e.id}" ${entry.linkedType === 'expense' && entry.linkedId === e.id ? 'selected' : ''}>${esc(e.label)} - ${fmtMoney(e.amount)}</option>`).join('');
  } else {
    expenseHTML += '<option value="" disabled style="color:var(--muted);">Aucune dépense créée</option>';
  }

  let incomeHTML = '<option value="">-- Aucun revenu --</option>';
  if (invoices.length > 0) {
    incomeHTML += invoices.map(i => `<option value="${i.id}" ${entry.linkedType === 'income' && entry.linkedId === i.id ? 'selected' : ''}>${esc(i.num)} - ${fmtMoney(getInvoiceTotal(i))}</option>`).join('');
  } else {
    incomeHTML += '<option value="" disabled style="color:var(--muted);">Aucune facture créée</option>';
  }

  let bankHTML = '<option value="">-- Aucune transaction --</option>';
  if (bankEntries.length > 0) {
    const unlinkedBanks = bankEntries.filter(b => !b.linkedId);
    if (unlinkedBanks.length > 0) {
      bankHTML += unlinkedBanks.map(b => `<option value="${b.id}" ${entry.linkedType === 'bank' && entry.linkedId === b.id ? 'selected' : ''}>${esc(b.type)} ${esc(b.date)} - ${fmtMoney(b.amount)}</option>`).join('');
    } else {
      bankHTML += '<option value="" disabled style="color:var(--muted);">Aucune transaction bancaire non liée</option>';
    }
  } else {
    bankHTML += '<option value="" disabled style="color:var(--muted);">Aucune transaction bancaire</option>';
  }

  expenseSelect.innerHTML = expenseHTML;
  incomeSelect.innerHTML = incomeHTML;
  if (bankSelect) bankSelect.innerHTML = bankHTML;

  modal.style.display = 'flex';
}

function closeCashLinkModal() {
  const modal = document.getElementById('cash-link-modal');
  if (modal) modal.style.display = 'none';
}

function saveCashLink() {
  const cashEntryId = document.getElementById('cash-link-id').value;
  const expenseId = document.getElementById('cash-link-expense').value;
  const incomeId = document.getElementById('cash-link-income').value;
  const bankId = document.getElementById('cash-link-bank')?.value;

  const cashEntries = STORE.cashEntries ? STORE.cashEntries() : [];
  const entry = cashEntries.find(c => c.id === cashEntryId);

  if (!entry) return;

  const selectedCount = (expenseId ? 1 : 0) + (incomeId ? 1 : 0) + (bankId ? 1 : 0);
  if (selectedCount > 1) {
    alert('Veuillez choisir UN SEUL option:\n• Une dépense OU\n• Un revenu OU\n• Une transaction bancaire');
    return;
  }

  if (expenseId) {
    entry.linkedType = 'expense';
    entry.linkedId = expenseId;
  } else if (incomeId) {
    entry.linkedType = 'income';
    entry.linkedId = incomeId;
  } else if (bankId) {
    entry.linkedType = 'bank';
    entry.linkedId = bankId;
  } else {
    entry.linkedType = null;
    entry.linkedId = null;
  }

  if (STORE.saveCashEntries) {
    STORE.saveCashEntries(cashEntries);
  }
  closeCashLinkModal();
  renderCashPage();
}

function unlinkCashEntry(cashEntryId) {
  if (!confirm('Délier cette entrée?')) return;

  const cashEntries = STORE.cashEntries ? STORE.cashEntries() : [];
  const entry = cashEntries.find(c => c.id === cashEntryId);

  if (entry) {
    entry.linkedType = null;
    entry.linkedId = null;
    if (STORE.saveCashEntries) {
      STORE.saveCashEntries(cashEntries);
    }
    renderCashPage();
  }
}

function getDefaultExpenseCategories() {
  return [
    { id: 'transport', name: 'Transport', icon: '🚚', color: '#64b4ff', subcategories: ['Carburant', 'Parking', 'Autoroute', 'Entretien'] },
    { id: 'decor', name: 'Décor', icon: '🎨', color: '#ff6b9d', subcategories: ['Matériaux', 'Peinture', 'Location', 'Installation'] },
    { id: 'materiel', name: 'Matériel', icon: '🔧', color: '#4ecdc4', subcategories: ['Outils', 'Équipement', 'Réparation', 'Location'] },
    { id: 'hotel', name: 'Hôtel & Logement', icon: '🏨', color: '#95e1d3', subcategories: ['Hébergement', 'Repas', 'Parking', 'Minibar'] },
    { id: 'alimentation', name: 'Alimentation', icon: '🍽️', color: '#f38181', subcategories: ['Repas équipe', 'Snacks', 'Boissons', 'Catering'] },
    { id: 'communication', name: 'Communication', icon: '📞', color: '#aa96da', subcategories: ['Téléphone', 'Internet', 'Postage', 'Frais bancaires'] },
    { id: 'fournitures', name: 'Fournitures', icon: '📦', color: '#fcbad3', subcategories: ['Bureau', 'Imprimerie', 'Emballage', 'Papeterie'] },
    { id: 'autre', name: 'Autre', icon: '📋', color: '#a8dadc', subcategories: ['Divers', 'Imprévus', 'Autres frais'] }
  ];
}

function getExpenseCategories() {
  const stored = STORE.expenseCategories();
  return stored.length > 0 ? stored : getDefaultExpenseCategories();
}

function renderExpenseCategoryManager() {
  const el = document.getElementById('compta-categories-page');
  if (!el) return;

  const categories = getExpenseCategories();

  el.innerHTML = `
    <div style="margin-bottom:32px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
        <h2 style="font-family:'Playfair Display',serif; color:var(--gold-light); font-size:20px; margin:0; font-weight:800;">Catégories de dépenses</h2>
        <button class="btn btn-gold" onclick="openCategoryModal()">+ Nouvelle catégorie</button>
      </div>

      <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(260px, 1fr)); gap:16px;">
        ${categories.map(cat => `
          <div style="background:linear-gradient(135deg, rgba(${parseInt(cat.color.slice(1,3), 16)},${parseInt(cat.color.slice(3,5), 16)},${parseInt(cat.color.slice(5,7), 16)},0.1), rgba(${parseInt(cat.color.slice(1,3), 16)},${parseInt(cat.color.slice(3,5), 16)},${parseInt(cat.color.slice(5,7), 16)},0.05)); border:2px solid ${cat.color}44; border-radius:12px; padding:20px; transition:all 0.3s ease;" onmouseover="this.style.borderColor='${cat.color}88'; this.style.boxShadow='0 4px 16px rgba(${parseInt(cat.color.slice(1,3), 16)},${parseInt(cat.color.slice(3,5), 16)},${parseInt(cat.color.slice(5,7), 16)},0.2)'" onmouseout="this.style.borderColor='${cat.color}44'; this.style.boxShadow='none'">
            <div style="font-size:40px; margin-bottom:12px;">${cat.icon}</div>
            <div style="font-family:'Playfair Display',serif; font-size:18px; color:${cat.color}; font-weight:800; margin-bottom:12px;">${cat.name}</div>
            <div style="display:flex; flex-wrap:wrap; gap:6px; margin-bottom:16px;">
              ${cat.subcategories.map(sub => `<span style="background:rgba(201,168,76,0.1); color:var(--muted); padding:4px 8px; border-radius:4px; font-size:11px;">${sub}</span>`).join('')}
            </div>
            <div style="display:flex; gap:8px; padding-top:12px; border-top:1px solid rgba(201,168,76,0.2);">
              <button class="btn btn-outline btn-sm" style="flex:1;" onclick="editCategory('${cat.id}')" title="Modifier">✏️</button>
              <button class="btn btn-danger btn-sm" style="flex:1;" onclick="deleteCategory('${cat.id}')" title="Supprimer">✕</button>
            </div>
          </div>
        `).join('')}
      </div>

      <div style="margin-top:32px; padding:20px; background:linear-gradient(135deg, rgba(201,168,76,0.08), rgba(201,168,76,0.04)); border:1px solid rgba(201,168,76,0.15); border-radius:12px;">
        <div style="color:var(--muted); font-size:12px; margin-bottom:8px;">ℹ️ Conseil</div>
        <div style="color:var(--muted); font-size:12px; line-height:1.6;">Les catégories sont utilisées pour organiser vos dépenses. Vous pouvez créer des catégories personnalisées adaptées à votre activité. Les sous-catégories permettent une organisation plus granulaire.</div>
      </div>
    </div>
  `;
}

function openCategoryModal(categoryId = null) {
  const modal = document.getElementById('category-modal');
  if (!modal) return;

  const categories = getExpenseCategories();
  const category = categoryId ? categories.find(c => c.id === categoryId) : null;

  document.getElementById('category-edit-id').value = categoryId || '';
  document.getElementById('category-name').value = category?.name || '';
  document.getElementById('category-icon').value = category?.icon || '📋';
  document.getElementById('category-color').value = category?.color || '#c9a84c';

  const subInput = document.getElementById('category-subcategories');
  subInput.value = category ? category.subcategories.join('\n') : '';

  document.getElementById('category-modal-title').textContent = categoryId ? 'Modifier catégorie' : 'Nouvelle catégorie';
  modal.style.display = 'flex';
}

function closeCategoryModal() {
  const modal = document.getElementById('category-modal');
  if (modal) modal.style.display = 'none';
}

function saveCategory() {
  const categories = getExpenseCategories();
  const categoryId = document.getElementById('category-edit-id').value;
  const name = document.getElementById('category-name').value.trim();
  const icon = document.getElementById('category-icon').value.trim();
  const color = document.getElementById('category-color').value;
  const subcategoriesText = document.getElementById('category-subcategories').value.trim();
  const subcategories = subcategoriesText.split('\n').map(s => s.trim()).filter(s => s);

  if (!name) { alert('Le nom est requis'); return; }
  if (subcategories.length === 0) { alert('Au moins une sous-catégorie est requise'); return; }

  if (categoryId) {
    const idx = categories.findIndex(c => c.id === categoryId);
    if (idx >= 0) {
      categories[idx] = { id: categoryId, name, icon, color, subcategories };
    }
  } else {
    const newId = 'cat_' + Date.now();
    categories.push({ id: newId, name, icon, color, subcategories });
  }

  STORE.saveExpenseCategories(categories);
  closeCategoryModal();
  renderExpenseCategoryManager();
}

function editCategory(categoryId) {
  openCategoryModal(categoryId);
}

function deleteCategory(categoryId) {
  const categories = getExpenseCategories();
  const category = categories.find(c => c.id === categoryId);
  if (!category) return;

  if (!confirm(`Supprimer la catégorie "${category.name}" ?`)) return;

  const remaining = categories.filter(c => c.id !== categoryId);
  STORE.saveExpenseCategories(remaining);
  renderExpenseCategoryManager();
}

function initializeExpenseCategories() {
  const categories = getExpenseCategories();
  const categorySelect = document.getElementById('expense-category');
  if (!categorySelect) return;

  categorySelect.innerHTML = '<option value="">-- Sélectionner une catégorie --</option>' +
    categories.map(cat => `<option value="${cat.name}" data-id="${cat.id}" data-icon="${cat.icon}">${cat.icon} ${cat.name}</option>`).join('');
}

function updateExpenseSubcategories() {
  const categorySelect = document.getElementById('expense-category');
  const subcategorySelect = document.getElementById('expense-subcategory');
  if (!categorySelect || !subcategorySelect) return;

  const categoryName = categorySelect.value;
  if (!categoryName) {
    subcategorySelect.innerHTML = '<option value="">-- Sous-catégorie --</option>';
    return;
  }

  const categories = getExpenseCategories();
  const category = categories.find(c => c.name === categoryName);

  if (category && category.subcategories) {
    subcategorySelect.innerHTML = '<option value="">-- Sélectionner sous-catégorie --</option>' +
      category.subcategories.map(sub => `<option value="${sub}">${sub}</option>`).join('');
  } else {
    subcategorySelect.innerHTML = '<option value="">-- Sous-catégorie --</option>';
  }
}

function renderExpenseReportByCategory() {
  const expenses = STORE.expenses();
  const categories = getExpenseCategories();

  // Group expenses by category
  const categoryBreakdown = {};
  categories.forEach(cat => {
    categoryBreakdown[cat.name] = { icon: cat.icon, color: cat.color, total: 0, count: 0, items: [] };
  });

  expenses.forEach(exp => {
    const category = exp.category || 'Autre';
    if (!categoryBreakdown[category]) {
      categoryBreakdown[category] = { icon: '📋', color: '#a8dadc', total: 0, count: 0, items: [] };
    }
    categoryBreakdown[category].total += num(exp.amount);
    categoryBreakdown[category].count += 1;
    categoryBreakdown[category].items.push(exp);
  });

  const sortedCategories = Object.entries(categoryBreakdown)
    .sort((a, b) => num(b[1].total) - num(a[1].total));

  const totalAmount = sortedCategories.reduce((sum, [_, data]) => sum + data.total, 0);

  return `
    <div style="margin-top:32px;">
      <h3 style="font-family:'Playfair Display',serif; color:var(--gold-light); font-size:18px; margin:0 0 20px; font-weight:800;">Dépenses par catégorie</h3>
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr)); gap:16px;">
        ${sortedCategories.map(([catName, catData]) => {
          const percentage = totalAmount > 0 ? (catData.total / totalAmount * 100).toFixed(1) : 0;
          return `
            <div style="background:linear-gradient(135deg, rgba(${parseInt(catData.color.slice(1,3), 16)},${parseInt(catData.color.slice(3,5), 16)},${parseInt(catData.color.slice(5,7), 16)},0.1), rgba(${parseInt(catData.color.slice(1,3), 16)},${parseInt(catData.color.slice(3,5), 16)},${parseInt(catData.color.slice(5,7), 16)},0.05)); border:1px solid ${catData.color}44; border-radius:12px; padding:20px;">
              <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
                <div style="font-size:32px;">${catData.icon}</div>
                <div style="text-align:right;">
                  <div style="color:var(--text); font-size:12px; font-weight:700;">${catData.count} dépense${catData.count !== 1 ? 's' : ''}</div>
                </div>
              </div>
              <div style="color:${catData.color}; font-family:'Playfair Display',serif; font-size:20px; font-weight:800; margin-bottom:12px;">${catName}</div>
              <div style="background:linear-gradient(90deg, ${catData.color} 0%, transparent ${percentage}%); height:6px; border-radius:3px; margin-bottom:12px;"></div>
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <div style="color:var(--muted); font-size:12px;">${percentage}% du total</div>
                <div style="color:${catData.color}; font-weight:700; font-size:14px;">${fmtMoney(catData.total)}</div>
              </div>
            </div>
          `;
        }).join('')}
      </div>

      <div style="margin-top:24px; padding:20px; background:linear-gradient(135deg, rgba(201,168,76,0.08), rgba(201,168,76,0.04)); border:1px solid rgba(201,168,76,0.15); border-radius:12px;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div>
            <div style="color:var(--muted); font-size:12px; text-transform:uppercase; margin-bottom:4px;">Total des dépenses</div>
            <div style="font-family:'Playfair Display',serif; font-size:28px; color:var(--gold-light); font-weight:800;">${fmtMoney(totalAmount)}</div>
          </div>
          <div style="text-align:right;">
            <div style="color:var(--muted); font-size:12px; margin-bottom:4px;">${expenses.length} dépense${expenses.length !== 1 ? 's' : ''}</div>
            <div style="color:var(--muted); font-size:14px;">${Object.keys(categoryBreakdown).filter(k => categoryBreakdown[k].count > 0).length} catégories</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function generateMonthlyReport(year = null) {
  const today = todayStr();
  const selectedYear = year || today.slice(0, 4);

  const invs = STORE.invoices().filter(i => String(i.date || '').startsWith(selectedYear));
  const rdvs = STORE.rdvs().filter(r => String(r.date || '').startsWith(selectedYear)).map(normalizeRdv);
  const purchases = STORE.purchases().filter(p => String(p.date || '').startsWith(selectedYear));
  const expenses = STORE.expenses().filter(e => String(e.date || '').startsWith(selectedYear));

  const monthlyData = {};
  for (let m = 1; m <= 12; m++) {
    const month = String(m).padStart(2, '0');
    const monthStr = `${selectedYear}-${month}`;
    monthlyData[month] = {
      name: ['JAN', 'FEV', 'MAR', 'AVR', 'MAI', 'JUIN', 'JUIL', 'AOU', 'SEP', 'OCT', 'NOV', 'DEC'][m - 1],
      sales: invs.filter(i => String(i.date || '').startsWith(monthStr)).reduce((s, i) => s + getInvoiceTotal(i), 0),
      calendar: rdvs.filter(r => String(r.date || '').startsWith(monthStr)).reduce((s, r) => s + getRdvAmount(r), 0),
      purchases: purchases.filter(p => String(p.date || '').startsWith(monthStr)).reduce((s, p) => s + num(p.amount), 0),
      expenses: expenses.filter(e => String(e.date || '').startsWith(monthStr)).reduce((s, e) => s + num(e.amount), 0)
    };
  }

  const totalIncome = invs.reduce((s, i) => s + getInvoiceTotal(i), 0) + rdvs.reduce((s, r) => s + getRdvAmount(r), 0);
  const totalCosts = purchases.reduce((s, p) => s + num(p.amount), 0) + expenses.reduce((s, e) => s + num(e.amount), 0);
  const netProfit = totalIncome - totalCosts;

  return {
    year: selectedYear,
    monthly: monthlyData,
    totals: {
      income: totalIncome,
      purchases: purchases.reduce((s, p) => s + num(p.amount), 0),
      expenses: expenses.reduce((s, e) => s + num(e.amount), 0),
      netProfit
    },
    counts: {
      invoices: invs.length,
      rdvs: rdvs.length,
      purchases: purchases.length,
      expenses: expenses.length
    }
  };
}

function renderFinancialFlowDiagram() {
  const invs = STORE.invoices();
  const rdvs = STORE.rdvs().map(normalizeRdv);
  const purchases = STORE.purchases();
  const expenses = STORE.expenses();
  const bank = STORE.bankEntries();

  const sales = invs.reduce((s, i) => s + getInvoiceTotal(i), 0);
  const cal = rdvs.reduce((s, r) => s + getRdvAmount(r), 0);
  const totalIncome = sales + cal;
  const purchaseTotal = purchases.reduce((s, p) => s + num(p.amount), 0);
  const expenseTotal = expenses.reduce((s, e) => s + num(e.amount), 0);
  const lastBalance = bank.length ? num(bank.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)))[0].balance) : 0;
  const netResult = totalIncome - purchaseTotal - expenseTotal;

  return `
    <div style="margin-top:32px; padding:24px; background:linear-gradient(135deg, #1a2633, #0f1923); border:2px solid rgba(201,168,76,0.2); border-radius:12px;">
      <h3 style="font-family:'Playfair Display',serif; color:var(--gold-light); font-size:18px; margin:0 0 24px; font-weight:800;">💳 Flux de trésorerie</h3>
      <div style="display:flex; flex-direction:column; gap:16px;">
        <div style="display:flex; align-items:center; gap:12px;">
          <div style="flex:0 0 auto; width:60px; height:60px; background:linear-gradient(135deg, rgba(76,201,100,0.2), rgba(76,201,100,0.1)); border:2px solid #4cc964; border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:24px;">💰</div>
          <div style="flex:1;">
            <div style="color:var(--gold); font-weight:700; margin-bottom:4px;">Revenus entrants</div>
            <div style="display:flex; gap:12px;">
              <div style="flex:1; padding:8px; background:rgba(201,168,76,0.1); border-radius:6px; font-size:12px;">
                <div style="color:var(--muted);">Factures</div>
                <div style="color:#4cc964; font-weight:700;">${fmtMoney(sales)}</div>
              </div>
              <div style="flex:1; padding:8px; background:rgba(201,168,76,0.1); border-radius:6px; font-size:12px;">
                <div style="color:var(--muted);">Calendrier</div>
                <div style="color:#4cc964; font-weight:700;">${fmtMoney(cal)}</div>
              </div>
              <div style="flex:1; padding:8px; background:rgba(76,201,100,0.15); border-radius:6px; border:1px solid #4cc964; font-size:12px;">
                <div style="color:var(--muted);">Total</div>
                <div style="color:#4cc964; font-weight:700;">${fmtMoney(totalIncome)}</div>
              </div>
            </div>
          </div>
        </div>
        <div style="display:flex; align-items:stretch; gap:12px; margin-left:72px;">
          <div style="flex:1; padding:12px; background:linear-gradient(135deg, rgba(100,180,255,0.2), rgba(100,180,255,0.1)); border:2px solid rgba(100,180,255,0.3); border-radius:8px; font-size:12px;">
            <div style="color:#64b4ff; font-weight:700; margin-bottom:4px;">📄 Achats</div>
            <div style="color:var(--muted); font-size:11px; margin-bottom:4px;">${purchases.length} factures</div>
            <div style="color:#64b4ff; font-weight:700;">${fmtMoney(purchaseTotal)}</div>
          </div>
          <div style="flex:1; padding:12px; background:linear-gradient(135deg, rgba(255,100,150,0.2), rgba(255,100,150,0.1)); border:2px solid rgba(255,100,150,0.3); border-radius:8px; font-size:12px;">
            <div style="color:#ff6496; font-weight:700; margin-bottom:4px;">💳 Dépenses</div>
            <div style="color:var(--muted); font-size:11px; margin-bottom:4px;">${expenses.length} entrées</div>
            <div style="color:#ff6496; font-weight:700;">${fmtMoney(expenseTotal)}</div>
          </div>
          <div style="flex:1; padding:12px; background:linear-gradient(135deg, rgba(${netResult >= 0 ? '76,201,100' : '201,100,76'},0.2), rgba(${netResult >= 0 ? '76,201,100' : '201,100,76'},0.1)); border:2px solid ${netResult >= 0 ? '#4cc964' : '#ff6464'}; border-radius:8px; font-size:12px;">
            <div style="color:${netResult >= 0 ? '#4cc964' : '#ff6464'}; font-weight:700; margin-bottom:4px;">✓ Résultat</div>
            <div style="color:var(--muted); font-size:11px; margin-bottom:4px;">Revenu Net</div>
            <div style="color:${netResult >= 0 ? '#4cc964' : '#ff6464'}; font-weight:700;">${netResult >= 0 ? '+' : ''}${fmtMoney(netResult)}</div>
          </div>
        </div>
        <div style="padding:16px; background:linear-gradient(135deg, rgba(100,200,100,0.2), rgba(100,200,100,0.1)); border:2px solid rgba(100,200,100,0.3); border-radius:8px;">
          <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px;">
            <div>
              <div style="color:var(--gold); font-weight:700; margin-bottom:4px;">🏦 Solde bancaire BIAT</div>
              <div style="color:var(--muted);">Trésorerie actuelle</div>
            </div>
            <div style="text-align:right;">
              <div style="color:#64c864; font-family:'Playfair Display',serif; font-size:20px; font-weight:800;">${fmtMoney(lastBalance)}</div>
              <div style="color:var(--muted); font-size:10px;">${bank.length} mouvements</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderReconciliationPage() {
  const invs = STORE.invoices();
  const rdvs = STORE.rdvs().map(normalizeRdv);
  const expenses = STORE.expenses();
  const purchases = STORE.purchases();
  const bankEntries = STORE.bankEntries();
  const cashEntries = STORE.cashEntries ? STORE.cashEntries() : [];

  // Calculs
  const totalIncome = invs.reduce((s, i) => s + getInvoiceTotal(i), 0) + rdvs.reduce((s, r) => s + getRdvAmount(r), 0);
  const totalExpenses = expenses.reduce((s, e) => s + num(e.amount), 0);
  const totalPurchases = purchases.reduce((s, p) => s + num(p.amount), 0);
  const bankBalance = bankEntries.length ? num(bankEntries.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)))[0].balance) : 0;
  const cashTotal = cashEntries.reduce((s, c) => s + num(c.amount), 0);
  const totalCosts = totalExpenses + totalPurchases;
  const netProfit = totalIncome - totalCosts;

  // Liens
  const linkedExpenses = expenses.filter(e => bankEntries.some(b => b.linkedId === e.id && b.linkedType === 'expense') ||
                                                 cashEntries.some(c => c.linkedId === e.id && c.linkedType === 'expense')).length;
  const linkedInvoices = invs.filter(i => bankEntries.some(b => b.linkedId === i.id && b.linkedType === 'invoice') ||
                                           cashEntries.some(c => c.linkedId === i.id && c.linkedType === 'income')).length;

  return `
    <div style="padding:20px;">
      <h2 style="font-family:'Playfair Display',serif; color:var(--gold-light); font-size:20px; margin:0 0 24px; border-bottom:2px solid rgba(201,168,76,0.3); padding-bottom:12px; font-weight:800;">🔄 Réconciliation Comptable Complète</h2>

      <!-- Vue d'ensemble -->
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:16px; margin-bottom:32px;">
        <div style="padding:20px; background:linear-gradient(135deg, rgba(76,201,100,0.12), rgba(76,201,100,0.06)); border:2px solid rgba(76,201,100,0.2); border-radius:12px;">
          <div style="color:var(--muted); font-size:11px; text-transform:uppercase; font-weight:700; margin-bottom:8px;">💰 Revenus Total</div>
          <div style="font-family:'Playfair Display',serif; font-size:28px; color:#4cc964; font-weight:800;">${fmtMoney(totalIncome)}</div>
          <div style="color:var(--muted); font-size:12px; margin-top:8px;">${invs.length + rdvs.length} documents</div>
        </div>

        <div style="padding:20px; background:linear-gradient(135deg, rgba(255,100,150,0.12), rgba(255,100,150,0.06)); border:2px solid rgba(255,100,150,0.2); border-radius:12px;">
          <div style="color:var(--muted); font-size:11px; text-transform:uppercase; font-weight:700; margin-bottom:8px;">💳 Dépenses Total</div>
          <div style="font-family:'Playfair Display',serif; font-size:28px; color:#ff6496; font-weight:800;">${fmtMoney(totalCosts)}</div>
          <div style="color:var(--muted); font-size:12px; margin-top:8px;">${expenses.length + purchases.length} documents</div>
        </div>

        <div style="padding:20px; background:linear-gradient(135deg, rgba(${netProfit >= 0 ? '76,201,100' : '201,100,76'},0.12), rgba(${netProfit >= 0 ? '76,201,100' : '201,100,76'},0.06)); border:2px solid rgba(${netProfit >= 0 ? '76,201,100' : '201,100,76'},0.2); border-radius:12px;">
          <div style="color:var(--muted); font-size:11px; text-transform:uppercase; font-weight:700; margin-bottom:8px;">📊 Résultat Net</div>
          <div style="font-family:'Playfair Display',serif; font-size:28px; color:${netProfit >= 0 ? '#4cc964' : '#ff6464'}; font-weight:800;">${netProfit >= 0 ? '+' : ''}${fmtMoney(netProfit)}</div>
          <div style="color:var(--muted); font-size:12px; margin-top:8px;">Revenus - Dépenses</div>
        </div>

        <div style="padding:20px; background:linear-gradient(135deg, rgba(100,180,255,0.12), rgba(100,180,255,0.06)); border:2px solid rgba(100,180,255,0.2); border-radius:12px;">
          <div style="color:var(--muted); font-size:11px; text-transform:uppercase; font-weight:700; margin-bottom:8px;">🏦 Solde Bancaire</div>
          <div style="font-family:'Playfair Display',serif; font-size:28px; color:#64b4ff; font-weight:800;">${fmtMoney(bankBalance)}</div>
          <div style="color:var(--muted); font-size:12px; margin-top:8px;">${bankEntries.length} mouvements</div>
        </div>

        <div style="padding:20px; background:linear-gradient(135deg, rgba(201,168,76,0.12), rgba(201,168,76,0.06)); border:2px solid rgba(201,168,76,0.2); border-radius:12px;">
          <div style="color:var(--muted); font-size:11px; text-transform:uppercase; font-weight:700; margin-bottom:8px;">💵 Caisse</div>
          <div style="font-family:'Playfair Display',serif; font-size:28px; color:var(--gold-light); font-weight:800;">${fmtMoney(cashTotal)}</div>
          <div style="color:var(--muted); font-size:12px; margin-top:8px;">${cashEntries.length} entrées</div>
        </div>
      </div>

      <!-- État des liens -->
      <div style="padding:20px; background:linear-gradient(135deg, rgba(201,168,76,0.08), rgba(201,168,76,0.04)); border:2px solid rgba(201,168,76,0.15); border-radius:12px; margin-bottom:32px;">
        <h3 style="color:var(--gold-light); font-size:14px; margin:0 0 16px; font-weight:700;">📎 État des Liaisons</h3>
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:16px; font-size:12px;">
          <div style="padding:12px; background:rgba(0,0,0,0.3); border-radius:6px;">
            <div style="color:var(--gold); font-weight:700; margin-bottom:4px;">Revenus liés</div>
            <div style="color:#4cc964; font-size:16px; font-weight:800;">${linkedInvoices}/${invs.length + rdvs.length}</div>
            <div style="color:var(--muted); font-size:10px; margin-top:4px;">Au Banque ou Caisse</div>
          </div>
          <div style="padding:12px; background:rgba(0,0,0,0.3); border-radius:6px;">
            <div style="color:var(--gold); font-weight:700; margin-bottom:4px;">Dépenses liées</div>
            <div style="color:#ff6496; font-size:16px; font-weight:800;">${linkedExpenses}/${expenses.length}</div>
            <div style="color:var(--muted); font-size:10px; margin-top:4px;">Au Banque ou Caisse</div>
          </div>
          <div style="padding:12px; background:rgba(0,0,0,0.3); border-radius:6px;">
            <div style="color:var(--gold); font-weight:700; margin-bottom:4px;">Taux de lien</div>
            <div style="color:${((linkedInvoices + linkedExpenses) / (invs.length + rdvs.length + expenses.length) * 100) >= 80 ? '#4cc964' : '#ffa500'}; font-size:16px; font-weight:800;">
              ${((linkedInvoices + linkedExpenses) / (invs.length + rdvs.length + expenses.length) * 100).toFixed(1)}%
            </div>
            <div style="color:var(--muted); font-size:10px; margin-top:4px;">Documents liés</div>
          </div>
        </div>
      </div>

      <!-- Vérifications -->
      <div style="padding:20px; background:linear-gradient(135deg, rgba(201,168,76,0.08), rgba(201,168,76,0.04)); border:2px solid rgba(201,168,76,0.15); border-radius:12px;">
        <h3 style="color:var(--gold-light); font-size:14px; margin:0 0 16px; font-weight:700;">✓ Vérifications</h3>
        <div style="display:flex; flex-direction:column; gap:12px; font-size:12px;">
          <div style="padding:12px; background:rgba(0,0,0,0.3); border-radius:6px; border-left:4px solid ${bankBalance > 0 ? '#4cc964' : '#ffa500'};">
            <div style="color:${bankBalance > 0 ? '#4cc964' : '#ffa500'}; font-weight:700;">
              ${bankBalance > 0 ? '✓' : '⚠️'} Solde Bancaire: ${bankBalance > 0 ? 'Positif' : 'Attention'}
            </div>
            <div style="color:var(--muted); margin-top:4px;">Montant: ${fmtMoney(bankBalance)}</div>
          </div>

          <div style="padding:12px; background:rgba(0,0,0,0.3); border-radius:6px; border-left:4px solid ${cashTotal > 0 ? '#4cc964' : '#ffa500'};">
            <div style="color:${cashTotal > 0 ? '#4cc964' : '#ffa500'}; font-weight:700;">
              ${cashTotal > 0 ? '✓' : '⚠️'} Caisse: ${cashTotal > 0 ? 'Positive' : 'Vide/Attention'}
            </div>
            <div style="color:var(--muted); margin-top:4px;">Montant: ${fmtMoney(cashTotal)}</div>
          </div>

          <div style="padding:12px; background:rgba(0,0,0,0.3); border-radius:6px; border-left:4px solid ${netProfit > 0 ? '#4cc964' : '#ff6464'};">
            <div style="color:${netProfit > 0 ? '#4cc964' : '#ff6464'}; font-weight:700;">
              ${netProfit > 0 ? '✓' : '❌'} Résultat: ${netProfit > 0 ? 'Bénéficiaire' : 'Déficitaire'}
            </div>
            <div style="color:var(--muted); margin-top:4px;">Montant: ${netProfit >= 0 ? '+' : ''}${fmtMoney(netProfit)}</div>
          </div>

          <div style="padding:12px; background:rgba(0,0,0,0.3); border-radius:6px; border-left:4px solid #64b4ff;">
            <div style="color:#64b4ff; font-weight:700;">
              💼 Liquidité Totale (Banque + Caisse)
            </div>
            <div style="color:var(--muted); margin-top:4px;">Montant: ${fmtMoney(bankBalance + cashTotal)}</div>
          </div>
        </div>
      </div>
    </div>
  `;
  const el = document.getElementById('compta-reconciliation-page');
  if (el) {
    const html = `
      <div style="padding:20px;">
        <h2 style="font-family:'Playfair Display',serif; color:var(--gold-light); font-size:20px; margin:0 0 24px; border-bottom:2px solid rgba(201,168,76,0.3); padding-bottom:12px; font-weight:800;">🔄 Réconciliation Comptable Complète</h2>

        <!-- Vue d'ensemble -->
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:16px; margin-bottom:32px;">
          <div style="padding:20px; background:linear-gradient(135deg, rgba(76,201,100,0.12), rgba(76,201,100,0.06)); border:2px solid rgba(76,201,100,0.2); border-radius:12px;">
            <div style="color:var(--muted); font-size:11px; text-transform:uppercase; font-weight:700; margin-bottom:8px;">💰 Revenus Total</div>
            <div style="font-family:'Playfair Display',serif; font-size:28px; color:#4cc964; font-weight:800;">${fmtMoney(totalIncome)}</div>
            <div style="color:var(--muted); font-size:12px; margin-top:8px;">${invs.length + rdvs.length} documents</div>
          </div>

          <div style="padding:20px; background:linear-gradient(135deg, rgba(255,100,150,0.12), rgba(255,100,150,0.06)); border:2px solid rgba(255,100,150,0.2); border-radius:12px;">
            <div style="color:var(--muted); font-size:11px; text-transform:uppercase; font-weight:700; margin-bottom:8px;">💳 Dépenses Total</div>
            <div style="font-family:'Playfair Display',serif; font-size:28px; color:#ff6496; font-weight:800;">${fmtMoney(totalCosts)}</div>
            <div style="color:var(--muted); font-size:12px; margin-top:8px;">${expenses.length + purchases.length} documents</div>
          </div>

          <div style="padding:20px; background:linear-gradient(135deg, rgba(${netProfit >= 0 ? '76,201,100' : '201,100,76'},0.12), rgba(${netProfit >= 0 ? '76,201,100' : '201,100,76'},0.06)); border:2px solid rgba(${netProfit >= 0 ? '76,201,100' : '201,100,76'},0.2); border-radius:12px;">
            <div style="color:var(--muted); font-size:11px; text-transform:uppercase; font-weight:700; margin-bottom:8px;">📊 Résultat Net</div>
            <div style="font-family:'Playfair Display',serif; font-size:28px; color:${netProfit >= 0 ? '#4cc964' : '#ff6464'}; font-weight:800;">${netProfit >= 0 ? '+' : ''}${fmtMoney(netProfit)}</div>
            <div style="color:var(--muted); font-size:12px; margin-top:8px;">Revenus - Dépenses</div>
          </div>

          <div style="padding:20px; background:linear-gradient(135deg, rgba(100,180,255,0.12), rgba(100,180,255,0.06)); border:2px solid rgba(100,180,255,0.2); border-radius:12px;">
            <div style="color:var(--muted); font-size:11px; text-transform:uppercase; font-weight:700; margin-bottom:8px;">🏦 Solde Bancaire</div>
            <div style="font-family:'Playfair Display',serif; font-size:28px; color:#64b4ff; font-weight:800;">${fmtMoney(bankBalance)}</div>
            <div style="color:var(--muted); font-size:12px; margin-top:8px;">${bankEntries.length} mouvements</div>
          </div>

          <div style="padding:20px; background:linear-gradient(135deg, rgba(201,168,76,0.12), rgba(201,168,76,0.06)); border:2px solid rgba(201,168,76,0.2); border-radius:12px;">
            <div style="color:var(--muted); font-size:11px; text-transform:uppercase; font-weight:700; margin-bottom:8px;">💵 Caisse</div>
            <div style="font-family:'Playfair Display',serif; font-size:28px; color:var(--gold-light); font-weight:800;">${fmtMoney(cashTotal)}</div>
            <div style="color:var(--muted); font-size:12px; margin-top:8px;">${cashEntries.length} entrées</div>
          </div>
        </div>

        <!-- État des liens -->
        <div style="padding:20px; background:linear-gradient(135deg, rgba(201,168,76,0.08), rgba(201,168,76,0.04)); border:2px solid rgba(201,168,76,0.15); border-radius:12px; margin-bottom:32px;">
          <h3 style="color:var(--gold-light); font-size:14px; margin:0 0 16px; font-weight:700;">📎 État des Liaisons</h3>
          <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:16px; font-size:12px;">
            <div style="padding:12px; background:rgba(0,0,0,0.3); border-radius:6px;">
              <div style="color:var(--gold); font-weight:700; margin-bottom:4px;">Revenus liés</div>
              <div style="color:#4cc964; font-size:16px; font-weight:800;">${linkedInvoices}/${invs.length + rdvs.length}</div>
              <div style="color:var(--muted); font-size:10px; margin-top:4px;">Au Banque ou Caisse</div>
            </div>
            <div style="padding:12px; background:rgba(0,0,0,0.3); border-radius:6px;">
              <div style="color:var(--gold); font-weight:700; margin-bottom:4px;">Dépenses liées</div>
              <div style="color:#ff6496; font-size:16px; font-weight:800;">${linkedExpenses}/${expenses.length}</div>
              <div style="color:var(--muted); font-size:10px; margin-top:4px;">Au Banque ou Caisse</div>
            </div>
            <div style="padding:12px; background:rgba(0,0,0,0.3); border-radius:6px;">
              <div style="color:var(--gold); font-weight:700; margin-bottom:4px;">Taux de lien</div>
              <div style="color:${((linkedInvoices + linkedExpenses) / (invs.length + rdvs.length + expenses.length) * 100) >= 80 ? '#4cc964' : '#ffa500'}; font-size:16px; font-weight:800;">
                ${((linkedInvoices + linkedExpenses) / (invs.length + rdvs.length + expenses.length) * 100).toFixed(1)}%
              </div>
              <div style="color:var(--muted); font-size:10px; margin-top:4px;">Documents liés</div>
            </div>
          </div>
        </div>

        <!-- Vérifications -->
        <div style="padding:20px; background:linear-gradient(135deg, rgba(201,168,76,0.08), rgba(201,168,76,0.04)); border:2px solid rgba(201,168,76,0.15); border-radius:12px;">
          <h3 style="color:var(--gold-light); font-size:14px; margin:0 0 16px; font-weight:700;">✓ Vérifications</h3>
          <div style="display:flex; flex-direction:column; gap:12px; font-size:12px;">
            <div style="padding:12px; background:rgba(0,0,0,0.3); border-radius:6px; border-left:4px solid ${bankBalance > 0 ? '#4cc964' : '#ffa500'};">
              <div style="color:${bankBalance > 0 ? '#4cc964' : '#ffa500'}; font-weight:700;">
                ${bankBalance > 0 ? '✓' : '⚠️'} Solde Bancaire: ${bankBalance > 0 ? 'Positif' : 'Attention'}
              </div>
              <div style="color:var(--muted); margin-top:4px;">Montant: ${fmtMoney(bankBalance)}</div>
            </div>

            <div style="padding:12px; background:rgba(0,0,0,0.3); border-radius:6px; border-left:4px solid ${cashTotal > 0 ? '#4cc964' : '#ffa500'};">
              <div style="color:${cashTotal > 0 ? '#4cc964' : '#ffa500'}; font-weight:700;">
                ${cashTotal > 0 ? '✓' : '⚠️'} Caisse: ${cashTotal > 0 ? 'Positive' : 'Vide/Attention'}
              </div>
              <div style="color:var(--muted); margin-top:4px;">Montant: ${fmtMoney(cashTotal)}</div>
            </div>

            <div style="padding:12px; background:rgba(0,0,0,0.3); border-radius:6px; border-left:4px solid ${netProfit > 0 ? '#4cc964' : '#ff6464'};">
              <div style="color:${netProfit > 0 ? '#4cc964' : '#ff6464'}; font-weight:700;">
                ${netProfit > 0 ? '✓' : '❌'} Résultat: ${netProfit > 0 ? 'Bénéficiaire' : 'Déficitaire'}
              </div>
              <div style="color:var(--muted); margin-top:4px;">Montant: ${netProfit >= 0 ? '+' : ''}${fmtMoney(netProfit)}</div>
            </div>

            <div style="padding:12px; background:rgba(0,0,0,0.3); border-radius:6px; border-left:4px solid #64b4ff;">
              <div style="color:#64b4ff; font-weight:700;">
                💼 Liquidité Totale (Banque + Caisse)
              </div>
              <div style="color:var(--muted); margin-top:4px;">Montant: ${fmtMoney(bankBalance + cashTotal)}</div>
            </div>
          </div>
        </div>
      </div>
    `;
    el.innerHTML = html;
  }
}

function renderFinancialAnalyticsDashboard() {
  const report = generateMonthlyReport();
  const today = todayStr();
  const currentYear = today.slice(0, 4);

  return `
    <div style="margin-top:32px;">
      <h2 style="font-family:'Playfair Display',serif; color:var(--gold-light); font-size:20px; margin:0 0 20px; border-bottom:2px solid rgba(201,168,76,0.3); padding-bottom:12px; font-weight:800;">📈 Analyse financière annuelle ${report.year}</h2>

      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(240px, 1fr)); gap:16px; margin-bottom:32px;">
        <div style="padding:20px; background:linear-gradient(135deg, rgba(76,201,100,0.12), rgba(76,201,100,0.06)); border:1px solid rgba(76,201,100,0.2); border-radius:12px;">
          <div style="color:var(--muted); font-size:11px; text-transform:uppercase; font-weight:700; margin-bottom:8px;">Chiffre d'affaires</div>
          <div style="font-family:'Playfair Display',serif; font-size:28px; color:#4cc964; font-weight:800;">${fmtMoney(report.totals.income)}</div>
          <div style="color:var(--muted); font-size:12px; margin-top:8px;">${report.counts.invoices + report.counts.rdvs} documents</div>
        </div>

        <div style="padding:20px; background:linear-gradient(135deg, rgba(100,180,255,0.12), rgba(100,180,255,0.06)); border:1px solid rgba(100,180,255,0.2); border-radius:12px;">
          <div style="color:var(--muted); font-size:11px; text-transform:uppercase; font-weight:700; margin-bottom:8px;">Coûts (achats)</div>
          <div style="font-family:'Playfair Display',serif; font-size:28px; color:#64b4ff; font-weight:800;">${fmtMoney(report.totals.purchases)}</div>
          <div style="color:var(--muted); font-size:12px; margin-top:8px;">${report.counts.purchases} factures</div>
        </div>

        <div style="padding:20px; background:linear-gradient(135deg, rgba(255,100,150,0.12), rgba(255,100,150,0.06)); border:1px solid rgba(255,100,150,0.2); border-radius:12px;">
          <div style="color:var(--muted); font-size:11px; text-transform:uppercase; font-weight:700; margin-bottom:8px;">Dépenses</div>
          <div style="font-family:'Playfair Display',serif; font-size:28px; color:#ff6496; font-weight:800;">${fmtMoney(report.totals.expenses)}</div>
          <div style="color:var(--muted); font-size:12px; margin-top:8px;">${report.counts.expenses} entrées</div>
        </div>

        <div style="padding:20px; background:linear-gradient(135deg, rgba(${report.totals.netProfit >= 0 ? '76,201,100' : '201,100,76'},0.12), rgba(${report.totals.netProfit >= 0 ? '76,201,100' : '201,100,76'},0.06)); border:1px solid rgba(${report.totals.netProfit >= 0 ? '76,201,100' : '201,100,76'},0.2); border-radius:12px;">
          <div style="color:var(--muted); font-size:11px; text-transform:uppercase; font-weight:700; margin-bottom:8px;">Résultat net</div>
          <div style="font-family:'Playfair Display',serif; font-size:28px; color:${report.totals.netProfit >= 0 ? '#4cc964' : '#ff6464'}; font-weight:800;">${report.totals.netProfit >= 0 ? '+' : ''}${fmtMoney(report.totals.netProfit)}</div>
          <div style="color:var(--muted); font-size:12px; margin-top:8px;">Revenus - Coûts - Dépenses</div>
        </div>
      </div>

      <div style="padding:20px; background:linear-gradient(135deg, rgba(201,168,76,0.08), rgba(201,168,76,0.04)); border:1px solid rgba(201,168,76,0.15); border-radius:12px;">
        <h3 style="color:var(--gold-light); font-size:14px; margin:0 0 16px; font-weight:700;">📊 Synthèse mensuelle</h3>
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:12px; font-size:12px;">
          ${Object.keys(report.monthly).map(m => {
            const data = report.monthly[m];
            const monthTotal = data.sales + data.calendar;
            const bar = monthTotal > 0 ? (monthTotal / report.totals.income * 100) : 0;
            return `
              <div style="padding:10px; background:rgba(0,0,0,0.3); border-radius:6px;">
                <div style="color:var(--gold); font-weight:700; margin-bottom:4px;">${data.name}</div>
                <div style="background:rgba(201,168,76,0.1); height:4px; border-radius:2px; margin-bottom:4px; overflow:hidden;">
                  <div style="background:var(--gold); height:100%; width:${bar}%;"></div>
                </div>
                <div style="color:var(--muted); margin-bottom:2px;">💰 ${fmtMoney(monthTotal)}</div>
                <div style="color:var(--muted); font-size:10px;">Coûts: ${fmtMoney(data.purchases + data.expenses)}</div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    </div>
  `;
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
  html += `<div style="padding:16px; background:linear-gradient(135deg, rgba(201,168,76,0.08), rgba(201,168,76,0.04)); border:1px solid rgba(201,168,76,0.15); border-radius:12px; margin-bottom:16px;">
    <div style="color:var(--gold); font-weight:700; margin-bottom:12px; font-size:13px;">🔍 FILTRER LES TRANSACTIONS</div>
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:12px;">
      <div>
        <label style="color:var(--muted); font-size:11px; font-weight:700; margin-bottom:4px; display:block;">Type</label>
        <select id="bank-filter-type" onchange="setComptaBankFilterType(this.value)" style="width:100%; padding:6px; background:#1a1a1a; color:#c9a84c; border:1px solid #333; border-radius:6px;">
          <option value="all">📋 Tous</option>
          <option value="retrait" ${comptaBankFilterType === 'retrait' ? 'selected' : ''}>🔴 Retraits</option>
          <option value="alimentation" ${comptaBankFilterType === 'alimentation' ? 'selected' : ''}>🟢 Alimentations</option>
        </select>
      </div>

      <div>
        <label style="color:var(--muted); font-size:11px; font-weight:700; margin-bottom:4px; display:block;">Statut</label>
        <select id="bank-filter-status" onchange="setComptaBankFilterStatus(this.value)" style="width:100%; padding:6px; background:#1a1a1a; color:#c9a84c; border:1px solid #333; border-radius:6px;">
          <option value="all">📊 Tous</option>
          <option value="linked" ${comptaBankFilterStatus === 'linked' ? 'selected' : ''}>✓ Liés</option>
          <option value="unlinked" ${comptaBankFilterStatus === 'unlinked' ? 'selected' : ''}>⚠️ Non liés</option>
        </select>
      </div>

      <div>
        <label style="color:var(--muted); font-size:11px; font-weight:700; margin-bottom:4px; display:block;">Montant Min</label>
        <input type="number" id="bank-filter-min" value="${comptaBankFilterMinAmount === 0 ? '' : comptaBankFilterMinAmount}" placeholder="0" onchange="setComptaBankFilterAmount()" style="width:100%; padding:6px; background:#1a1a1a; color:#c9a84c; border:1px solid #333; border-radius:6px;">
      </div>

      <div>
        <label style="color:var(--muted); font-size:11px; font-weight:700; margin-bottom:4px; display:block;">Montant Max</label>
        <input type="number" id="bank-filter-max" value="${comptaBankFilterMaxAmount === Infinity ? '' : comptaBankFilterMaxAmount}" placeholder="∞" onchange="setComptaBankFilterAmount()" style="width:100%; padding:6px; background:#1a1a1a; color:#c9a84c; border:1px solid #333; border-radius:6px;">
      </div>

      <div>
        <label style="color:var(--muted); font-size:11px; font-weight:700; margin-bottom:4px; display:block;">Recherche globale</label>
        <input type="text" id="bank-filter-reference" value="${esc(comptaBankFilterReference)}" placeholder="Ref, Libellé, Type, Montant..." onchange="setComptaBankFilterReference(this.value)" style="width:100%; padding:6px; background:#1a1a1a; color:#c9a84c; border:1px solid #333; border-radius:6px;">
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
function renderEntityPage(targetId, items, renderTitle, editFn, deleteFn) {
  const el = document.getElementById(targetId);
  if (!el) return;
  if (!items.length) { el.innerHTML = '<div class="empty-state">Aucune donnee.</div>'; return; }
  el.innerHTML = '<div class="item-grid">' + items.map(item => `<div class="item-card compta-detail-row"><div><div class="item-name">${renderTitle(item)}</div></div><div class="item-actions"><button class="btn btn-outline btn-sm" onclick="${editFn.name}('${item.id}')" title="Modifier">✏️</button><button class="btn btn-danger btn-sm" onclick="${deleteFn.name}('${item.id}')" title="Supprimer">✕</button></div></div>`).join('') + '</div>';
}
function setComptaExpenseFilter(value) { comptaExpenseFilter = value; renderExpensesPage(); }

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

function setComptaCashFilterStatus(value) { comptaCashFilterStatus = value; renderCashPage(); }
function setComptaCashFilterAmount() {
  const minEl = document.getElementById('cash-filter-min');
  const maxEl = document.getElementById('cash-filter-max');
  comptaCashFilterMinAmount = minEl?.value ? num(minEl.value) : 0;
  comptaCashFilterMaxAmount = maxEl?.value ? num(maxEl.value) : Infinity;
  renderCashPage();
}
function resetComptaCashFilters() {
  comptaCashFilterStatus = 'all';
  comptaCashFilterMinAmount = 0;
  comptaCashFilterMaxAmount = Infinity;
  const statusEl = document.getElementById('cash-filter-status');
  const minEl = document.getElementById('cash-filter-min');
  const maxEl = document.getElementById('cash-filter-max');
  if (statusEl) statusEl.value = 'all';
  if (minEl) minEl.value = '';
  if (maxEl) maxEl.value = '';
  renderCashPage();
}

function setSupplierSearch(value) { supplierSearchQuery = value; renderSuppliersPage(); }
function setSupplierFilterCategory(value) { supplierFilterCategory = value; renderSuppliersPage(); }
function resetSupplierFilters() {
  supplierSearchQuery = '';
  supplierFilterCategory = 'all';
  const searchEl = document.getElementById('supplier-search');
  const categoryEl = document.getElementById('supplier-filter-category');
  if (searchEl) searchEl.value = '';
  if (categoryEl) categoryEl.value = 'all';
  renderSuppliersPage();
}

function openSupplierModal(id = '') { fillModalFields('supplier', STORE.suppliers().find(x => x.id === id), ['name','contact','addr','mf','rib','category']); document.getElementById('supplier-modal').style.display = 'flex'; }
function closeSupplierModal() { document.getElementById('supplier-modal').style.display = 'none'; }
function saveSupplier() { saveModalEntity('supplier', STORE.suppliers, STORE.saveSuppliers, ['name','contact','addr','mf','rib','category'], renderSuppliersPage, closeSupplierModal); fillPurchaseSuppliers(); }
function deleteSupplier(id) { if (confirm('Supprimer ce fournisseur ?')) { STORE.saveSuppliers(STORE.suppliers().filter(x => x.id !== id)); renderSuppliersPage(); } }
function calculateFromTTC() {
  const ttcEl = document.getElementById('purchase-amount');
  const ttcTotalEl = document.getElementById('purchase-tva-total');

  if (!ttcEl) return;

  const ttc = num(ttcEl.value || 0);
  const timbre = 1;
  const montantAvecTva = ttc - timbre;

  // Afficher la TVA totale
  if (ttcTotalEl) {
    ttcTotalEl.value = fmtMoney(Math.max(0, montantAvecTva));
  }

  const rates = [19, 13, 7];

  rates.forEach(rate => {
    // Calcul inverse: HT = (TTC - Timbre) / (1 + TVA%)
    const factor = 1 + (rate / 100);
    const ht = montantAvecTva / factor;
    const tvaAmount = ht * (rate / 100);

    const htEl = document.getElementById(`purchase-tva${rate}-ht`);
    const tvaEl = document.getElementById(`purchase-tva${rate}-amount`);

    if (htEl) htEl.value = fmtMoney(Math.max(0, ht));
    if (tvaEl) tvaEl.value = fmtMoney(Math.max(0, tvaAmount));
  });

  // Par défaut, sélectionner 19%
  selectTVARate(19);
}

function selectTVARate(rate) {
  const tvaEl = document.getElementById('purchase-tva');
  if (tvaEl) tvaEl.value = rate;

  // Mettre en surbrillance le taux sélectionné
  [19, 13, 7].forEach(r => {
    const htFieldEl = document.getElementById(`purchase-tva${r}-ht`);
    const tvaFieldEl = document.getElementById(`purchase-tva${r}-amount`);

    if (htFieldEl) {
      if (r === rate) {
        htFieldEl.style.borderColor = '#c9a84c';
        htFieldEl.style.backgroundColor = '#1a1a1a';
        if (tvaFieldEl) {
          tvaFieldEl.style.borderColor = '#c9a84c';
          tvaFieldEl.style.backgroundColor = '#1a1a1a';
        }
      } else {
        htFieldEl.style.borderColor = '#333';
        htFieldEl.style.backgroundColor = '#0e0e0e';
        if (tvaFieldEl) {
          tvaFieldEl.style.borderColor = '#333';
          tvaFieldEl.style.backgroundColor = '#0e0e0e';
        }
      }
    }
  });
}

function updateTVATotal() {
  const tva19El = document.getElementById('purchase-tva19-amount');
  const tva13El = document.getElementById('purchase-tva13-amount');
  const tva7El = document.getElementById('purchase-tva7-amount');
  const totalEl = document.getElementById('purchase-tva-total');

  if (!totalEl) return;

  const tva19 = num(tva19El?.value || 0);
  const tva13 = num(tva13El?.value || 0);
  const tva7 = num(tva7El?.value || 0);

  const total = tva19 + tva13 + tva7;
  totalEl.value = fmtMoney(total);
}

function getNextPurchaseNum() {
  const purchases = STORE.purchases();
  if (!purchases.length) return 'ACH-001';
  const nums = purchases.map(p => p.num).filter(n => n && n.startsWith('ACH-'));
  const lastNum = Math.max(...nums.map(n => parseInt(n.slice(4)) || 0));
  return 'ACH-' + String(lastNum + 1).padStart(3, '0');
}

function openPurchaseModal(id = '') {
  fillPurchaseSuppliers();
  const item = STORE.purchases().find(x => x.id === id);
  fillModalFields('purchase', item, ['num','date','supplier-id','supplier-name','payment','status','category','amount','tva','notes']);
  if (!id) {
    document.getElementById('purchase-num').value = getNextPurchaseNum();
    document.getElementById('purchase-tva').value = '19';
  }
  document.getElementById('purchase-date').value ||= todayStr();
  document.getElementById('purchase-modal').style.display = 'flex';
  setTimeout(() => { calculateFromTTC(); }, 100);
}
function closePurchaseModal() { document.getElementById('purchase-modal').style.display = 'none'; }
function savePurchase() {
  saveModalEntity('purchase', STORE.purchases, STORE.savePurchases, ['num','date','supplier-id','supplier-name','payment','status','category','amount','tva','tva19Amount','tva13Amount','tva7Amount','notes','addStamp','addSignature'], renderPurchasesPage, closePurchaseModal);
  renderComptaViews();
}
function deletePurchase(id) { if (confirm('Supprimer cette facture achat ?')) { STORE.savePurchases(STORE.purchases().filter(x => x.id !== id)); renderPurchasesPage(); } }
function openExpenseModal(id = '') {
  fillModalFields('expense', STORE.expenses().find(x => x.id === id), ['date','label','category','subcategory','payment','amount','notes']);
  document.getElementById('expense-date').value ||= todayStr();
  initializeExpenseCategories();
  if (id) {
    const expense = STORE.expenses().find(x => x.id === id);
    if (expense && expense.category) {
      document.getElementById('expense-category').value = expense.category;
      updateExpenseSubcategories();
    }
  }
  document.getElementById('expense-modal').style.display = 'flex';
}
function closeExpenseModal() { document.getElementById('expense-modal').style.display = 'none'; }
function saveExpense() { saveModalEntity('expense', STORE.expenses, STORE.saveExpenses, ['date','label','category','payment','amount','notes'], renderExpensesPage, closeExpenseModal); renderComptaViews(); }
function deleteExpense(id) { if (confirm('Supprimer cette depense ?')) { STORE.saveExpenses(STORE.expenses().filter(x => x.id !== id)); renderExpensesPage(); } }
function openBankModal(id = '') {
  fillModalFields('bank', STORE.bankEntries().find(x => x.id === id), ['date','type','label','amount','balance']);
  document.getElementById('bank-date').value ||= todayStr();
  document.getElementById('bank-modal').style.display = 'flex';
}
function closeBankModal() { document.getElementById('bank-modal').style.display = 'none'; }
function saveBankEntry() { saveModalEntity('bank', STORE.bankEntries, STORE.saveBankEntries, ['date','type','label','amount','balance'], renderBankPage, closeBankModal); renderComptaViews(); }
function deleteBankEntry(id) { if (confirm('Supprimer cette ligne bancaire ?')) { STORE.saveBankEntries(STORE.bankEntries().filter(x => x.id !== id)); renderBankPage(); } }

// Cash (Caisse) functions
function getCashSelectedIds() {
  const checkboxes = document.querySelectorAll('input[name="cash-select"]:checked');
  return Array.from(checkboxes).map(cb => cb.value);
}

function toggleCashSelectAll(checked) {
  document.querySelectorAll('input[name="cash-select"]').forEach(cb => cb.checked = checked);
}

function deleteCashSelected() {
  const ids = getCashSelectedIds();
  if (ids.length === 0) { alert('Aucune ligne selectionnée'); return; }
  if (!confirm(`Supprimer ${ids.length} ligne(s) ?`)) return;
  const remaining = STORE.cashEntries().filter(c => !ids.includes(c.id));
  STORE.saveCashEntries(remaining);
  renderCashPage();
}

function openCashModal(id = '') {
  fillCashLinkedBank();
  fillModalFields('cash', STORE.cashEntries().find(x => x.id === id), ['date','amount','description','linked-bank']);
  document.getElementById('cash-date').value ||= todayStr();
  document.getElementById('cash-modal').style.display = 'flex';
}

function closeCashModal() {
  document.getElementById('cash-modal').style.display = 'none';
}

function saveCashEntry() {
  saveModalEntity('cash', STORE.cashEntries, STORE.saveCashEntries, ['date','amount','description','linked-bank'], renderCashPage, closeCashModal);
  renderComptaViews();
}

function deleteCashEntry(id) {
  if (confirm('Supprimer cette ligne caisse ?')) {
    STORE.saveCashEntries(STORE.cashEntries().filter(x => x.id !== id));
    renderCashPage();
  }
}

function fillCashLinkedBank() {
  const sel = document.getElementById('cash-linked-bank');
  if (!sel) return;
  const current = sel.value;
  const bankWithdrawals = STORE.bankEntries().filter(b => b.type === 'Retraits');
  sel.innerHTML = '<option value="">-- Sélectionner un retrait --</option>' + bankWithdrawals.map(b => `<option value="${esc(b.id)}">${esc(b.date)} - ${fmtMoney(b.amount)}</option>`).join('');
  sel.value = current;
}


function fillModalFields(prefix, item, fields) {
  document.getElementById(prefix + '-edit-id').value = item?.id || '';
  const keyMap = { 'supplier-id': 'supplierId', 'supplier-name': 'supplierName', 'linked-bank': 'linkedBank' };
  fields.forEach(field => {
    const el = document.getElementById(prefix + '-' + field);
    const key = keyMap[field] || field.replace('-', '');
    if (el) {
      if (el.type === 'checkbox') {
        el.checked = item ? (item[key] ?? item[field] ?? false) : false;
      } else {
        el.value = item ? (item[key] ?? item[field] ?? '') : '';
      }
    }
  });
}
function saveModalEntity(prefix, getFn, saveFn, fields, renderFn, closeFn) {
  const id = document.getElementById(prefix + '-edit-id').value || prefix + '_' + Date.now();
  const item = { id };
  const keyMap = { 'supplier-id': 'supplierId', 'supplier-name': 'supplierName', 'linked-bank': 'linkedBank' };
  fields.forEach(field => {
    const el = document.getElementById(prefix + '-' + field);
    const key = keyMap[field] || field.replace('-', '');
    if (el?.type === 'checkbox') {
      item[key] = el.checked;
    } else {
      item[key] = el?.type === 'number' ? num(el.value) : (el?.value || '');
    }
  });
  let items = getFn();
  items = items.some(x => x.id === id) ? items.map(x => x.id === id ? item : x) : items.concat(item);
  saveFn(items);
  closeFn();
  renderFn();
}
function fillPurchaseSuppliers() {
  const sel = document.getElementById('purchase-supplier-id');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">-- Selectionner fournisseur --</option>' + STORE.suppliers().map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
  sel.value = current;
}
function syncPurchaseSupplier() {
  const supplier = STORE.suppliers().find(s => s.id === document.getElementById('purchase-supplier-id').value);
  if (supplier) {
    document.getElementById('purchase-supplier-name').value = supplier.name || '';
    document.getElementById('purchase-payment').value = supplier.payment || 'BIAT';
  }
}
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
      <tr style="border-bottom:1px solid rgba(201,168,76,0.1);">
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
                     style="width:100%; padding:10px 12px; background:#1a1a1a; border:1px solid rgba(201,168,76,0.3); border-radius:6px; color:var(--text); font-size:13px;">
            </div>

            <!-- Tableau -->
            <table style="width:100%; border-collapse:collapse; margin-bottom:24px;">
              <thead>
                <tr style="background:rgba(201,168,76,0.08); border-bottom:2px solid rgba(201,168,76,0.2);">
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

          <div style="padding:16px 24px; background:rgba(0,0,0,0.2); border-top:1px solid rgba(201,168,76,0.1); display:flex; justify-content:flex-end; gap:12px;">
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

function renderStatistique() {
  const el = document.getElementById('statistique-dashboard');
  if (!el) return;

  const invoices = STORE.invoices();
  const rdvs = STORE.rdvs().map(normalizeRdv);
  const clients = STORE.clients();
  const oms = STORE.oms();
  const representations = STORE.representations();
  const expenses = STORE.expenses();
  const bankEntries = STORE.bankEntries();
  const contracts = STORE.contracts ? STORE.contracts() : [];

  // ── Totaux globaux ──
  const invTotal = invoices.reduce((s, i) => s + getInvoiceTotal(i), 0);
  const invPaid = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + getInvoiceTotal(i), 0);
  const invUnpaid = invTotal - invPaid;
  const rdvTotal = rdvs.reduce((s, r) => s + getRdvAmount(r), 0);
  const repTotal = representations.reduce((s, r) => s + num(r.fee), 0);
  const expTotal = expenses.reduce((s, e) => s + num(e.amount), 0);
  const production = invTotal + rdvTotal;
  const pctPaid = invTotal > 0 ? Math.round((invPaid / invTotal) * 100) : 0;

  // ── Par mois (12 derniers mois) ──
  const monthsMap = {};
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    monthsMap[key] = { inv: 0, rdv: 0, exp: 0, label: d.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' }) };
  }
  invoices.forEach(inv => {
    const m = (inv.date || '').substring(0, 7);
    if (monthsMap[m]) monthsMap[m].inv += getInvoiceTotal(inv);
  });
  rdvs.forEach(rdv => {
    const m = (rdv.date || rdv.startDate || '').substring(0, 7);
    if (monthsMap[m]) monthsMap[m].rdv += getRdvAmount(rdv);
  });
  expenses.forEach(e => {
    const m = (e.date || '').substring(0, 7);
    if (monthsMap[m]) monthsMap[m].exp += num(e.amount);
  });
  const months = Object.values(monthsMap);

  // ── Top clients ──
  const clientTotals = {};
  invoices.forEach(inv => {
    const k = inv.clientName || 'Inconnu';
    clientTotals[k] = (clientTotals[k] || 0) + getInvoiceTotal(inv);
  });
  rdvs.forEach(rdv => {
    const k = rdv.clientName || 'Inconnu';
    clientTotals[k] = (clientTotals[k] || 0) + getRdvAmount(rdv);
  });
  const topClients = Object.entries(clientTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  const maxClient = topClients.length ? topClients[0][1] : 1;

  // ── Top mois ──
  const maxMonth = Math.max(...months.map(m => m.inv + m.rdv), 1);

  // ── Donut: Payé vs Impayé (SVG) ──
  function donut(paid, unpaid) {
    const total = paid + unpaid;
    if (total === 0) return '<circle cx="60" cy="60" r="45" fill="none" stroke="#333" stroke-width="14"/>';
    const paidPct = paid / total;
    const r = 45, cx = 60, cy = 60;
    const circumference = 2 * Math.PI * r;
    const paidDash = paidPct * circumference;
    const unpaidDash = circumference - paidDash;
    return '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="#2a2a2a" stroke-width="14"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="#22c55e" stroke-width="14" stroke-dasharray="' + paidDash.toFixed(1) + ' ' + unpaidDash.toFixed(1) + '" stroke-dashoffset="' + (circumference / 4).toFixed(1) + '" stroke-linecap="round"/>' +
      (unpaid > 0 ? '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="#ef4444" stroke-width="14" stroke-dasharray="' + unpaidDash.toFixed(1) + ' ' + paidDash.toFixed(1) + '" stroke-dashoffset="' + (circumference / 4 - paidDash).toFixed(1) + '" stroke-linecap="round"/>' : '');
  }

  // ── Bar chart: activité mensuelle ──
  function barChart() {
    const W = 560, H = 120, padL = 0, padR = 0, barW = Math.floor((W - padL - padR) / months.length) - 4;
    let bars = '';
    months.forEach((m, i) => {
      const total = m.inv + m.rdv;
      const barH = maxMonth > 0 ? Math.round((total / maxMonth) * (H - 24)) : 0;
      const x = padL + i * ((W - padL - padR) / months.length) + 2;
      const y = H - 20 - barH;
      bars += '<rect x="' + x.toFixed(1) + '" y="' + y + '" width="' + barW + '" height="' + barH + '" rx="3" fill="url(#barGrad)" opacity="0.85"/>';
      bars += '<text x="' + (x + barW / 2).toFixed(1) + '" y="' + (H - 4) + '" text-anchor="middle" font-size="9" fill="#666">' + m.label + '</text>';
      if (total > 0) bars += '<text x="' + (x + barW / 2).toFixed(1) + '" y="' + (y - 3) + '" text-anchor="middle" font-size="8" fill="#d4af37">' + (total >= 1000 ? (total / 1000).toFixed(1) + 'k' : Math.round(total)) + '</text>';
    });
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:' + H + 'px;">' +
      '<defs><linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#d4af37"/><stop offset="100%" stop-color="#92621a"/></linearGradient></defs>' +
      bars + '</svg>';
  }

  // ── Line chart: dépenses mensuelles ──
  function lineChart() {
    const W = 560, H = 80, n = months.length;
    const maxExp = Math.max(...months.map(m => m.exp), 1);
    const pts = months.map((m, i) => {
      const x = (i / (n - 1)) * W;
      const y = H - 10 - (m.exp / maxExp) * (H - 20);
      return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    const fill = months.map((m, i) => {
      const x = (i / (n - 1)) * W;
      const y = H - 10 - (m.exp / maxExp) * (H - 20);
      return x.toFixed(1) + ',' + y.toFixed(1);
    });
    const fillPath = 'M0,' + (H - 10) + ' L' + fill.join(' L') + ' L' + W + ',' + (H - 10) + ' Z';
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:' + H + 'px;">' +
      '<path d="' + fillPath + '" fill="rgba(239,68,68,0.08)"/>' +
      '<polyline points="' + pts + '" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
      months.map((m, i) => {
        const x = (i / (n - 1)) * W;
        const y = H - 10 - (m.exp / maxExp) * (H - 20);
        return '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="3" fill="#ef4444"/>';
      }).join('') +
      '</svg>';
  }

  // ── HTML complet ──
  el.innerHTML =

    // ── ROW 1: KPIs globaux ──
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-bottom:24px;">' +
      _statKpi('💰', 'Production totale', fmtMoney(production) + ' TND', '#d4af37') +
      _statKpi('✅', 'Factures payées', fmtMoney(invPaid) + ' TND', '#22c55e') +
      _statKpi('⚠️', 'Non payées', fmtMoney(invUnpaid) + ' TND', '#ef4444') +
      _statKpi('📅', 'Calendrier', fmtMoney(rdvTotal) + ' TND', '#60a5fa') +
      _statKpi('💸', 'Dépenses', fmtMoney(expTotal) + ' TND', '#fb923c') +
      _statKpi('🎭', 'Représentations', fmtMoney(repTotal) + ' TND', '#a78bfa') +
    '</div>' +

    // ── ROW 2: Donut + Bar chart ──
    '<div style="display:grid;grid-template-columns:200px 1fr;gap:20px;margin-bottom:24px;">' +

      // Donut
      '<div class="stat-section-card">' +
        '<div class="stat-section-title">Taux de recouvrement</div>' +
        '<div style="position:relative;width:120px;margin:12px auto;">' +
          '<svg viewBox="0 0 120 120" style="width:120px;height:120px;">' + donut(invPaid, invUnpaid) + '</svg>' +
          '<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;">' +
            '<div style="color:#d4af37;font-size:20px;font-weight:800;">' + pctPaid + '%</div>' +
            '<div style="color:#666;font-size:9px;">payé</div>' +
          '</div>' +
        '</div>' +
        '<div style="display:flex;gap:12px;justify-content:center;margin-top:8px;">' +
          '<span style="color:#22c55e;font-size:11px;">● Payé</span>' +
          '<span style="color:#ef4444;font-size:11px;">● Impayé</span>' +
        '</div>' +
        '<div style="margin-top:10px;text-align:center;">' +
          '<div style="color:#888;font-size:10px;">Solde net estimé</div>' +
          '<div style="color:#d4af37;font-weight:800;font-size:15px;">' + fmtMoney(invPaid - expTotal) + ' TND</div>' +
        '</div>' +
      '</div>' +

      // Bar chart
      '<div class="stat-section-card">' +
        '<div class="stat-section-title">Activité mensuelle — 12 derniers mois</div>' +
        '<div style="margin-top:10px;">' + barChart() + '</div>' +
        '<div style="display:flex;gap:16px;margin-top:8px;">' +
          '<span style="color:#d4af37;font-size:11px;">■ Factures + RDV</span>' +
        '</div>' +
      '</div>' +

    '</div>' +

    // ── ROW 3: Top clients + Line chart dépenses ──
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px;">' +

      // Top clients
      '<div class="stat-section-card">' +
        '<div class="stat-section-title">🏆 Top clients</div>' +
        (topClients.length === 0
          ? '<div class="db-empty">Aucune donnée</div>'
          : '<div style="margin-top:12px;">' +
            topClients.map(([ name, amt ], i) => {
              const pct = maxClient > 0 ? Math.round((amt / maxClient) * 100) : 0;
              const colors = ['#d4af37','#22c55e','#60a5fa','#a78bfa','#fb923c','#f472b6'];
              const color = colors[i % colors.length];
              return '<div style="margin-bottom:10px;">' +
                '<div style="display:flex;justify-content:space-between;margin-bottom:3px;">' +
                  '<span style="color:#ccc;font-size:12px;font-weight:600;max-width:60%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(name) + '</span>' +
                  '<span style="color:' + color + ';font-size:12px;font-weight:700;">' + fmtMoney(amt) + '</span>' +
                '</div>' +
                '<div style="background:#2a2a2a;border-radius:99px;height:5px;overflow:hidden;">' +
                  '<div style="background:' + color + ';height:100%;width:' + pct + '%;border-radius:99px;transition:width 0.5s;"></div>' +
                '</div>' +
              '</div>';
            }).join('') +
          '</div>') +
      '</div>' +

      // Dépenses line chart
      '<div class="stat-section-card">' +
        '<div class="stat-section-title">📉 Évolution des dépenses</div>' +
        '<div style="margin-top:10px;">' + lineChart() + '</div>' +
        '<div style="display:flex;justify-content:space-between;margin-top:10px;">' +
          '<div style="text-align:center;">' +
            '<div style="color:#888;font-size:10px;">Total dépenses</div>' +
            '<div style="color:#ef4444;font-weight:800;font-size:15px;">' + fmtMoney(expTotal) + ' TND</div>' +
          '</div>' +
          '<div style="text-align:center;">' +
            '<div style="color:#888;font-size:10px;">Nb dépenses</div>' +
            '<div style="color:#fb923c;font-weight:800;font-size:15px;">' + expenses.length + '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +

    '</div>' +

    // ── ROW 4: Récapitulatif général ──
    '<div class="stat-section-card">' +
      '<div class="stat-section-title">📋 Récapitulatif général</div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-top:14px;">' +
        _statMini('Factures', invoices.length, 'total') +
        _statMini('Clients', clients.length, 'actifs') +
        _statMini('Contrats', contracts.length, 'signés') +
        _statMini('Ordres mission', oms.length, 'émis') +
        _statMini('RDV Calendrier', rdvs.length, 'planifiés') +
        _statMini('Représentations', representations.length, 'enregistrées') +
      '</div>' +
    '</div>';
}

// [utils.js] _statKpi

// [utils.js] _statMini

// ── Representations CRUD → js/shared/representations.js ───────────────────
// stableRepNatureRows,
// renderRepresentations, showRepresentationDetail, openRepresentationModal,
// closeRepresentationModal, fillRepresentationClients, syncRepresentationClient,
// addRepresentationNatureLine, saveRepresentation, deleteRepresentation,
// printRepresentations

function closeModalFromOutsideClick(event) {
  if (event.target.classList.contains('modal-overlay')) {
    event.target.style.display = 'none';
  }
}

// ── SANITIZE INPUT ──
// [utils.js] sanitizeInput

// ── AUTO BACKUP JOURNALIER ──
function checkDailyBackup() {
  try {
    const lastBackup = localStorage.getItem('mp_last_auto_backup');
    const today = todayStr();
    if (lastBackup === today) return;
    if (typeof currentBackupPayload !== 'function') return;
    const data = currentBackupPayload();
    localStorage.setItem('mp_auto_backup_' + today, JSON.stringify(data));
    localStorage.setItem('mp_last_auto_backup', today);
    // Garder seulement les 7 derniers
    const backupKeys = Object.keys(localStorage)
      .filter(k => k.startsWith('mp_auto_backup_'))
      .sort().reverse();
    backupKeys.slice(7).forEach(k => localStorage.removeItem(k));
    if (typeof LOGGER !== 'undefined') LOGGER.log('AUTO_BACKUP', { date: today });
  } catch(e) {}
}

// ── RENDER LOGS PAGE ──
function renderLogs() {
  const el = document.getElementById('logs-dashboard');
  if (!el) return;
  if (typeof LOGGER === 'undefined') { el.innerHTML = '<div class="db-empty">Logger non disponible.</div>'; return; }

  const logs = LOGGER.getLogs().slice(0, 50);
  const actionLabels = {
    LOGIN: '🔑 Connexion', LOGIN_FAILED: '⚠️ Tentative échouée', LOGOUT: '🚪 Déconnexion',
    AUTO_BACKUP: '💾 Backup auto', SAVE_INVOICE: '📄 Facture sauvegardée',
    DELETE_INVOICE: '🗑 Facture supprimée', SAVE_CLIENT: '🏢 Client sauvegardé',
    DELETE_CLIENT: '🗑 Client supprimé', SAVE_DEVIS: '📋 Devis sauvegardé',
    EXPORT_BACKUP: '⬇️ Export backup'
  };

  el.innerHTML =
    '<div style="display:flex;gap:10px;margin-bottom:18px;">' +
      '<button class="btn btn-outline btn-sm" onclick="LOGGER.exportLogs()">⬇️ Exporter logs</button>' +
      '<button class="btn btn-danger btn-sm" onclick="if(confirm(\'Effacer tous les logs?\')){{LOGGER.clearLogs();renderLogs();}}">🗑 Effacer</button>' +
    '</div>' +
    (logs.length === 0
      ? '<div class="db-empty">Aucune activité enregistrée.</div>'
      : '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:12px;">' +
        '<thead><tr style="background:#1a1a1a;">' +
          '<th style="padding:10px 12px;text-align:left;color:#d4af37;border-bottom:1px solid #2a2a2a;">Date/Heure</th>' +
          '<th style="padding:10px 12px;text-align:left;color:#d4af37;border-bottom:1px solid #2a2a2a;">Action</th>' +
          '<th style="padding:10px 12px;text-align:left;color:#d4af37;border-bottom:1px solid #2a2a2a;">Détails</th>' +
        '</tr></thead><tbody>' +
        logs.map(log => {
          const d = new Date(log.timestamp);
          const dt = d.toLocaleDateString('fr-FR') + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
          const label = actionLabels[log.action] || log.action;
          const details = log.details && Object.keys(log.details).length
            ? Object.entries(log.details).map(([k, v]) => k + ': ' + v).join(', ')
            : '—';
          return '<tr style="border-bottom:1px solid #1e1e1e;">' +
            '<td style="padding:9px 12px;color:#888;white-space:nowrap;">' + escapeHtml(dt) + '</td>' +
            '<td style="padding:9px 12px;color:#ddd;font-weight:600;">' + label + '</td>' +
            '<td style="padding:9px 12px;color:#666;">' + escapeHtml(details) + '</td>' +
          '</tr>';
        }).join('') +
        '</tbody></table></div>');
}


// Alias — HTML calls renderLogsView(), function is named renderLogs()
function renderLogsView() { renderLogs(); }

function bootstrapStableApp() {
  restoreBackup20260516Once();
  cleanupBankEntryTypes();
  checkDailyBackup();

  // Auth check
  if (typeof AUTH !== 'undefined') {
    const authenticated = AUTH.init();
    if (!authenticated) return;
  }

  // Charger depuis le serveur, puis démarrer l'app
  syncFromServer(function() {
    initializeDemoData();
    if (typeof Platform !== 'undefined' && typeof Platform.boot === 'function') {
      try { Platform.boot(); } catch(e) {}
      try { Platform.ready(); } catch(e) {}
    }
    const initial = location.hash ? location.hash.replace('#', '') : 'dashboard';
    showView(initial);
    initNavScrollHint();
  });
}

// ── SIDEBAR MOBILE ──
function toggleSidebar() {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) return;
  setSidebarOpen(!sidebar.classList.contains('open'));
}
function setSidebarOpen(isOpen) {
  document.querySelector('.sidebar')?.classList.toggle('open', isOpen);
  document.getElementById('sidebar-overlay')?.classList.toggle('open', isOpen);
  document.getElementById('hamburger-btn')?.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  document.body.classList.toggle('sidebar-open', isOpen);
  document.body.style.overflow = isOpen && window.innerWidth <= 900 ? 'hidden' : '';
}
function openSidebar() {
  setSidebarOpen(true);
}
function closeSidebar() {
  setSidebarOpen(false);
}

function handleGlobalLogout() {
  if (typeof AUTH !== 'undefined' && AUTH && typeof AUTH.logout === 'function') {
    AUTH.logout();
    return;
  }
  try { sessionStorage.removeItem('mp_auth_session'); } catch (e) {}
  location.reload();
}

// Fermer la sidebar après navigation sur mobile
const _origShowView = showView;
// Override showView to close sidebar on mobile
(function() {
  const orig = window.showView;
  window.showView = function(viewName) {
    if (window.innerWidth <= 900) closeSidebar();
    return orig(viewName);
  };
})();

function initNavScrollHint() {
  const nav  = document.getElementById('sidebar-nav');
  const hint = document.getElementById('nav-scroll-hint');
  if (!nav || !hint) return;
  function updateHint() {
    const needsMore = nav.scrollTop + nav.clientHeight < nav.scrollHeight - 4;
    hint.classList.toggle('has-more', needsMore);
  }
  nav.addEventListener('scroll', updateHint, { passive: true });
  // Re-check after fonts/images load
  window.addEventListener('load', updateHint);
  updateHint();
}

// ── showView: ajouter logs ──
const _origShowViewForLogs = showView;
(function() {
  const _orig = showView;
  window.showView = function(viewName) {
    if (viewName === 'logs') {
      document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
      document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
      const target = document.getElementById('view-logs');
      if (target) target.classList.add('active');
      const nav = document.getElementById('nav-logs');
      if (nav) nav.classList.add('active');
      renderLogs();
      updateSidebarStats();
      location.hash = 'logs';
      return;
    }
    _orig(viewName);
  };
})();

document.addEventListener('DOMContentLoaded', bootstrapStableApp);
document.addEventListener('click', closeModalFromOutsideClick);

// ── Gestion rotation / arrière-plan / retour cache mobile ────────────
// Sur iOS/Android, pageshow se déclenche aussi quand la page revient
// du cache (bfcache) sans rechargement — on vérifie juste la session.
window.addEventListener('pageshow', function(e) {
  if (e.persisted) {
    // Page restaurée depuis le cache — pas de rechargement, juste vérifier session
    if (typeof AUTH !== 'undefined' && !AUTH.isSessionValid()) {
      AUTH.showLoginScreen();
    }
  }
});

// Rotation d'écran — empêcher tout rechargement intempestif
window.addEventListener('orientationchange', function() {
  if (typeof AUTH !== 'undefined' && AUTH.isSessionValid()) {
    AUTH.createSession();
  }
});

// ── Sync automatique en arrière-plan ─────────────────────────────────
// Toutes les 2 minutes : sync silencieux depuis le serveur.
// Garantit que PC et téléphone convergent même sans action manuelle.
var _bgSyncInterval = null;
function _startBackgroundSync() {
  if (_bgSyncInterval) clearInterval(_bgSyncInterval);
  _bgSyncInterval = setInterval(function() {
    if (typeof AUTH === 'undefined' || !AUTH.isSessionValid()) return;
    if (navigator.onLine === false) return;
    syncFromServer(function() {
      // Re-rendre les widgets qui dépendent des données
      try { if (typeof updateDashboardStats === 'function') updateDashboardStats(); } catch(e) {}
      try { if (typeof renderTachesDashboard === 'function') renderTachesDashboard(); } catch(e) {}
      try { if (typeof renderTachePage === 'function') renderTachePage(); } catch(e) {}
    }, true); // silent=true → pas d'indicateur visible
  }, 60 * 1000); // toutes les 60 secondes
}

// Démarrer la sync auto quand l'app est prête
document.addEventListener('DOMContentLoaded', function() {
  setTimeout(_startBackgroundSync, 10000); // 10s après le démarrage
});

// ── Calendar rendering → js/shared/calendar.js ─────────────────────
// renderCalendrier, setCalFilter, _calDateLabel, _calDateSeparator,
// _calRenderItem, openRdvModal
// ══════════════════════════════════════════════════════
// SAUVEGARDE — fonctions manquantes
// ══════════════════════════════════════════════════════

function _getAllData() {
  const data = { exportedAt: new Date().toISOString(), version: '1.0', appName: 'Mythos Prod' };
  Object.entries(RESTORE_KEY_MAP).forEach(([key, storageKey]) => {
    try { data[key] = JSON.parse(localStorage.getItem(storageKey) || '[]'); } catch { data[key] = []; }
  });
  return data;
}

function exportBackup() {
  const data = _getAllData();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'mythos-backup-' + todayStr() + '.json';
  a.click();
  URL.revokeObjectURL(url);
  if (typeof LOGGER !== 'undefined') LOGGER.log('EXPORT_BACKUP', { date: todayStr() });
}

function importBackup(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      // Restaurer chaque clé reconnue
      let restored = 0;
      Object.entries(RESTORE_KEY_MAP).forEach(([key, storageKey]) => {
        if (Array.isArray(data[key])) {
          localStorage.setItem(storageKey, JSON.stringify(data[key]));
          restored++;
        }
      });
      if (restored === 0) { alert('Fichier invalide : aucune donnée reconnue.'); return; }
      // Sauvegarder la méta
      localStorage.setItem('mp_restore_meta', JSON.stringify({ restoredAt: new Date().toISOString(), source: file.name }));
      alert('Sauvegarde importée avec succès (' + restored + ' collection(s)).');
      renderBackupDashboard();
    } catch (err) {
      alert('Erreur de lecture : ' + err.message);
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}



function createBackupVersion() {
  var label = prompt('Nom de la version (ex: avant-mise-a-jour) :');
  if (!label) return;
  var versions = JSON.parse(localStorage.getItem('mp_backup_versions') || '[]');
  versions.unshift({ id: 'ver_' + Date.now(), label: label, createdAt: new Date().toISOString(), data: _getAllData() });
  if (versions.length > 20) versions.length = 20;
  localStorage.setItem('mp_backup_versions', JSON.stringify(versions));
  alert('Version "' + label + '" cree.');
  renderBackupDashboard();
}

function exportVersionHistory() {
  var versions = JSON.parse(localStorage.getItem('mp_backup_versions') || '[]');
  if (!versions.length) { alert('Aucune version sauvegardee.'); return; }
  var blob = new Blob([JSON.stringify(versions, null, 2)], { type: 'application/json' });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href     = url;
  a.download = 'mythos-versions-' + new Date().toISOString().slice(0,10) + '.json';
  a.click();
  URL.revokeObjectURL(url);
}

function pushAllToServer() {
  var btn = document.getElementById('btn-push-server');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Envoi en cours...'; }

  var bulk = {};
  Object.values(RESTORE_KEY_MAP).forEach(function(key) {
    try { bulk[key] = JSON.parse(localStorage.getItem(key) || 'null'); } catch(e) {}
  });

  fetch('api.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ __bulk__: bulk })
  })
  .then(function(r) { return r.json(); })
  .then(function(res) {
    if (btn) { btn.disabled = false; btn.textContent = '☁️ Synchroniser vers le serveur'; }
    if (res.ok) {
      alert('✅ ' + (res.saved || 0) + ' collection(s) synchronisées avec le serveur.\nVos données sont maintenant accessibles depuis tous vos appareils.');
    } else {
      alert('❌ Erreur : ' + (res.error || 'inconnue'));
    }
  })
  .catch(function(err) {
    if (btn) { btn.disabled = false; btn.textContent = '☁️ Synchroniser vers le serveur'; }
    alert('❌ Impossible de contacter le serveur.\nVérifiez que api.php est bien uploadé et que le dossier appdata/ existe.');
  });
}

function renderBackupDashboard() {
  var el = document.getElementById('backup-dashboard');
  if (!el) return;
  var versions = JSON.parse(localStorage.getItem('mp_backup_versions') || '[]');
  var totalSize = 0;
  Object.values(RESTORE_KEY_MAP).forEach(function(key) { totalSize += (localStorage.getItem(key) || '').length; });
  var sizeKb = (totalSize / 1024).toFixed(1);
  var counts = {};
  Object.entries(RESTORE_KEY_MAP).forEach(function(e) {
    try { counts[e[0]] = JSON.parse(localStorage.getItem(e[1]) || '[]').length; } catch(ex) { counts[e[0]] = 0; }
  });
  var html = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin-bottom:28px;">' +
    '<div class="stat-section-card" style="text-align:center;"><div style="font-size:28px;">&#128190;</div>' +
    '<div style="color:#d4af37;font-size:20px;font-weight:800;">' + sizeKb + ' Ko</div>' +
    '<div style="color:#888;font-size:11px;">Taille donnees</div></div>' +
    '<div class="stat-section-card" style="text-align:center;"><div style="font-size:28px;">&#128230;</div>' +
    '<div style="color:#d4af37;font-size:20px;font-weight:800;">' + versions.length + '</div>' +
    '<div style="color:#888;font-size:11px;">Versions manuelles</div></div>' +
    '<div class="stat-section-card" style="text-align:center;"><div style="font-size:28px;">&#9729;</div>' +
    '<div style="color:#22c55e;font-size:14px;font-weight:700;margin-top:4px;">Auto</div>' +
    '<div style="color:#888;font-size:11px;">Sauvegarde serveur active</div></div>' +
    '</div>' +
    '<div class="stat-section-card" style="margin-bottom:20px;">' +
    '<div class="stat-section-title">Donnees actuelles</div>' +
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-top:12px;">' +
    Object.entries(counts).map(function(e) {
      return '<div style="background:#111;border:1px solid #2a2a2a;border-radius:8px;padding:10px;text-align:center;">' +
        '<div style="color:#d4af37;font-size:18px;font-weight:800;">' + e[1] + '</div>' +
        '<div style="color:#888;font-size:10px;">' + e[0] + '</div></div>';
    }).join('') + '</div></div>';
  if (versions.length) {
    html += '<div class="stat-section-card" style="margin-bottom:20px;"><div class="stat-section-title">Versions manuelles</div>' +
      '<div style="margin-top:12px;">' +
      versions.map(function(v) {
        return '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid #2a2a2a;">' +
          '<div><div style="color:#ccc;font-weight:600;">' + escapeHtml(v.label) + '</div>' +
          '<div style="color:#555;font-size:11px;">' + (v.createdAt || '').slice(0,16).replace('T',' ') + '</div></div>' +
          '<div style="display:flex;gap:8px;">' +
          '<button class="btn btn-sm btn-outline" onclick="_restoreVersion(\'' + v.id + '\')">Restaurer</button>' +
          '</div></div>';
      }).join('') + '</div></div>';
  }
  // ── Bloc nettoyage disque ─────────────────────────────────────────
  html += '<div class="stat-section-card" style="margin-bottom:20px;">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">' +
      '<div class="stat-section-title" style="margin:0;">🗑 Gestion du disque serveur</div>' +
      '<button id="btn-disk-cleanup" onclick="runDiskCleanup()" class="btn btn-outline" ' +
        'style="font-size:12px;border-color:#ef4444;color:#ef4444;padding:5px 14px;">🧹 Nettoyer maintenant</button>' +
    '</div>' +
    '<div id="disk-cleanup-status" style="color:#555;font-size:12px;">Appuyez sur "Nettoyer" pour supprimer les vieux backups et libérer de l\'espace.</div>' +
    '<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">' +
      '<div style="background:#111;border:1px solid #1e1e1e;border-radius:8px;padding:8px 14px;font-size:11px;">' +
        '<span style="color:#555;">Règle :</span> <span style="color:#888;">Max 10 backups · Supprimer si &gt; 7 jours</span></div>' +
      '<div style="background:#111;border:1px solid #1e1e1e;border-radius:8px;padding:8px 14px;font-size:11px;">' +
        '<span style="color:#555;">Cron OVH :</span> <span style="color:#888;">automatique chaque jour</span></div>' +
    '</div>' +
  '</div>';

  // ── Backups automatiques serveur ──────────────────────────────────
  html += '<div class="stat-section-card" id="server-backups-section">' +
    '<div class="stat-section-title">☁ Sauvegardes automatiques serveur</div>' +
    '<div id="server-backups-list" style="margin-top:12px;"><div style="color:#444;font-size:12px;text-align:center;padding:16px;">Chargement...</div></div>' +
    '</div>';

  el.innerHTML = html;

  // ── Charger la liste des backups serveur ──────────────────────────
  fetch('api.php?action=list_backups')
    .then(function(r) { return r.json(); })
    .then(function(res) {
      var listEl = document.getElementById('server-backups-list');
      if (!listEl) return;
      if (!res.ok || !res.backups || !res.backups.length) {
        listEl.innerHTML = '<div style="color:#444;font-size:12px;text-align:center;padding:16px;">Aucune sauvegarde encore — elle apparaîtra après votre prochaine action.</div>';
        return;
      }
      listEl.innerHTML = res.backups.map(function(b) {
        var d = new Date(b.ts * 1000);
        var dateStr = d.toLocaleDateString('fr-FR') + ' ' + d.toLocaleTimeString('fr-FR', {hour:'2-digit',minute:'2-digit'});
        var label = b.file.replace(/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_/, '').replace('.json','').replace('auto_','');
        return '<div style="display:flex;align-items:center;justify-content:space-between;padding:9px 0;border-bottom:1px solid #1a1a1a;">' +
          '<div>' +
            '<div style="color:#ccc;font-size:12px;">● ' + dateStr + '</div>' +
            '<div style="color:#444;font-size:10px;">' + b.size + ' Ko · ' + escapeHtml(label) + '</div>' +
          '</div>' +
          '<button class="btn btn-sm btn-outline" onclick="_restoreServerBackup(\'' + b.file + '\')" style="font-size:11px;padding:3px 10px;">Restaurer</button>' +
        '</div>';
      }).join('');
    })
    .catch(function() {
      var listEl = document.getElementById('server-backups-list');
      if (listEl) listEl.innerHTML = '<div style="color:#555;font-size:12px;padding:10px;">Impossible de charger les sauvegardes serveur.</div>';
    });
}

// ── Nettoyage disque depuis l'interface ───────────────────────────────
function runDiskCleanup() {
  var btn = document.getElementById('btn-disk-cleanup');
  var status = document.getElementById('disk-cleanup-status');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Nettoyage…'; }
  if (status) status.style.color = '#888';

  fetch('api.php?action=cleanup&key=mythos2026clean')
    .then(function(r) { return r.json(); })
    .then(function(res) {
      if (btn) { btn.disabled = false; btn.textContent = '🧹 Nettoyer maintenant'; }
      if (!res.ok) {
        if (status) { status.textContent = '❌ Erreur : ' + (res.error || 'inconnue'); status.style.color = '#ef4444'; }
        return;
      }
      var freed = res.space_freed || '0 Mo';
      var deleted = res.backups_deleted || 0;
      var disk = res.disk_used_mb || 0;
      var msg = deleted > 0
        ? '✓ ' + deleted + ' backup(s) supprimé(s) · ' + freed + ' libérés · Disque : ' + disk + ' Mo'
        : '✓ Disque propre · ' + disk + ' Mo utilisés · Rien à supprimer';
      if (status) { status.textContent = msg; status.style.color = '#22c55e'; }
      // Recharger la liste des backups
      setTimeout(function() { renderBackupDashboard(); }, 800);
    })
    .catch(function() {
      if (btn) { btn.disabled = false; btn.textContent = '🧹 Nettoyer maintenant'; }
      if (status) { status.textContent = '❌ Impossible de contacter le serveur.'; status.style.color = '#ef4444'; }
    });
}

function _restoreVersion(id) {
  var versions = JSON.parse(localStorage.getItem('mp_backup_versions') || '[]');
  var ver = versions.find(function(v) { return v.id === id; });
  if (!ver) return;
  if (!confirm('Restaurer "' + ver.label + '" ?')) return;
  Object.entries(RESTORE_KEY_MAP).forEach(function(e) {
    if (ver.data && Array.isArray(ver.data[e[0]])) localStorage.setItem(e[1], JSON.stringify(ver.data[e[0]]));
  });
  alert('Version "' + ver.label + '" restauree.');
  renderBackupDashboard();
}

function _deleteVersion(id) {
  if (!confirm('Supprimer cette version ?')) return;
  var vs = JSON.parse(localStorage.getItem('mp_backup_versions') || '[]').filter(function(v) { return v.id !== id; });
  localStorage.setItem('mp_backup_versions', JSON.stringify(vs));
  renderBackupDashboard();
}

function _restoreServerBackup(filename) {
  if (!confirm('Restaurer la sauvegarde "' + filename + '" ?\nToutes les données actuelles seront remplacées.')) return;
  fetch('api.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ __restore_backup__: filename })
  })
  .then(function(r) { return r.json(); })
  .then(function(res) {
    if (!res.ok) { alert('Erreur : ' + (res.error || 'inconnue')); return; }
    // Recharger les données du serveur dans localStorage
    return fetch('api.php?key=__all__').then(function(r2) { return r2.json(); }).then(function(res2) {
      if (res2.ok && res2.data) {
        Object.entries(res2.data).forEach(function(e) {
          if (e[1] !== null) localStorage.setItem(e[0], JSON.stringify(e[1]));
        });
      }
      alert('✅ Sauvegarde restaurée (' + (res.restored || 0) + ' collections). La page va se recharger.');
      location.reload();
    });
  })
  .catch(function() { alert('Impossible de contacter le serveur.'); });
}

// ══════════════════════════════════════════════════════
// CALCULATEUR SPECTACLE
// ══════════════════════════════════════════════════════
function initSpectacleCalculator() {
  // Tableau des subventions : [nbActeurs][distance] = montant TND
  // Colonnes distance : 0-50km, 51-100km, 101-200km, 201-300km, 301-400km, 401+km
  var TABLE = [
    { label: '1 ou 2 acteurs',   vals: [1500, 2000, 2500, 3000, 3500, 4000] },
    { label: '3 ou 4 acteurs',   vals: [2000, 2500, 3000, 3500, 4000, 4500] },
    { label: '5 ou 6 acteurs',   vals: [2500, 3000, 3500, 4000, 4500, 5000] },
    { label: '7 ou 8 acteurs',   vals: [3000, 3500, 4000, 4500, 5000, 5500] },
    { label: '9 ou 10 acteurs',  vals: [3500, 4000, 4500, 5000, 5500, 6000] },
    { label: '11 à 15 acteurs',  vals: [4000, 4500, 5000, 5500, 6000, 6500] },
    { label: '16 à 20 acteurs',  vals: [5000, 5500, 6000, 6500, 7000, 7500] },
    { label: '21 acteurs et +',  vals: [6000, 6500, 7000, 7500, 8000, 8500] }
  ];
  var DISTANCES = [
    '00 à 50 km', '51 à 100 km', '101 à 200 km',
    '201 à 300 km', '301 à 400 km', '401 km et plus'
  ];

  var selActors   = document.getElementById('spectacle-actors');
  var selDistance = document.getElementById('spectacle-distance');
  var elAmount    = document.getElementById('spectacle-amount');
  var elNote      = document.getElementById('spectacle-selection-text');
  if (!selActors || !selDistance) return;

  // Remplir les selects si vides
  if (!selActors.options.length) {
    TABLE.forEach(function(row, i) {
      selActors.add(new Option(row.label, i));
    });
  }
  if (!selDistance.options.length) {
    DISTANCES.forEach(function(d, i) {
      selDistance.add(new Option(d, i));
    });
  }

  function calc() {
    var a = parseInt(selActors.value) || 0;
    var d = parseInt(selDistance.value) || 0;
    var montant = TABLE[a].vals[d];
    elAmount.textContent = montant.toLocaleString('fr-FR');
    elNote.textContent = '📋 ' + DISTANCES[d] + ', ' + TABLE[a].label + '.';
  }

  selActors.onchange   = calc;
  selDistance.onchange = calc;
  calc();
}

// ══════════════════════════════════════════════════════
// DOCUMENTATION
// ══════════════════════════════════════════════════════

var _docCurrentFolder = null; // null = vue dossiers, 'mythos'/'travail'/'partenariat' = intérieur dossier

var DOC_FOLDERS = {
  mythos:      { label: "Les documents d'Uthina Chess",  icon: '&#128196;', color: '#d4af37' },
  nouveau:     { label: 'Nouveau',                    icon: '&#127381;', color: '#fb923c' },
  archive:     { label: 'Archive',                    icon: '&#128451;', color: '#6b7280' }
};

function renderDocumentation() {
  if (_docCurrentFolder) {
    _renderDocFolder(_docCurrentFolder);
  } else {
    _renderDocHome();
  }
}

function switchDocTab(cat) { // rétrocompat
  openDocFolder(cat);
}

function openDocFolder(cat) {
  _docCurrentFolder = cat;
  _renderDocFolder(cat);
}

function _renderDocHome() {
  var container = document.getElementById('doc-main-container');
  if (!container) return;
  var allDocs = STORE.documents();
  var total   = allDocs.length;
  var counts  = {};
  Object.keys(DOC_FOLDERS).forEach(function(k){
    counts[k] = allDocs.filter(function(d){ return d.cat===k; }).length;
  });

  var html =
    '<div style="display:flex;align-items:center;gap:16px;background:linear-gradient(135deg,rgba(212,175,55,0.1),rgba(212,175,55,0.04));border:1px solid rgba(212,175,55,0.2);border-radius:14px;padding:20px 24px;margin-bottom:24px;">' +
      '<div style="font-size:40px;">&#128193;</div>' +
      '<div>' +
        '<div style="color:#d4af37;font-size:20px;font-weight:800;">Mes Documents</div>' +
        '<div style="color:#888;font-size:12px;margin-top:3px;">' + total + ' document' + (total!==1?'s':'') + ' au total &nbsp;&middot;&nbsp; ' + Object.keys(DOC_FOLDERS).length + ' dossiers</div>' +
      '</div>' +
      '<div style="margin-left:auto;">' +
        '<button class="btn btn-gold" onclick="openBulkUploadModal()" style="font-size:12px;">&#8679; Upload groupé</button>' +
      '</div>' +
    '</div>' +

    '<div style="display:flex;flex-direction:column;gap:2px;background:#0d0d0d;border:1px solid #222;border-radius:12px;overflow:hidden;">' +
      '<div style="display:grid;grid-template-columns:40px 1fr 80px 40px;align-items:center;padding:10px 16px;background:#181818;border-bottom:1px solid #252525;">' +
        '<span></span>' +
        '<span style="color:#555;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;">Dossier</span>' +
        '<span style="color:#555;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;text-align:center;">Docs</span>' +
        '<span></span>' +
      '</div>' +
    Object.entries(DOC_FOLDERS).map(function(entry){
      var k=entry[0], f=entry[1];
      var n = counts[k];
      var last = allDocs.filter(function(d){ return d.cat===k; }).slice(0,3);
      var thumbs = last.map(function(d){
        var isPdf = d.fileType==='pdf'||(d.photo&&d.photo.indexOf('application/pdf')!==-1);
        return isPdf
          ? '<span style="font-size:14px;">&#128196;</span>'
          : (d.photo ? '<img src="'+d.photo+'" style="width:22px;height:22px;border-radius:4px;object-fit:cover;border:1px solid #333;">' : '<span style="font-size:14px;">&#128196;</span>');
      }).join('');
      return '<div onclick="openDocFolder(\''+k+'\')" style="display:grid;grid-template-columns:40px 1fr 80px 40px;align-items:center;padding:14px 16px;border-bottom:1px solid #1a1a1a;cursor:pointer;transition:background 0.12s;" onmouseover="this.style.background=\'rgba(212,175,55,0.04)\'" onmouseout="this.style.background=\'\'">' +
        '<div style="width:32px;height:32px;border-radius:8px;background:rgba(255,255,255,0.04);display:flex;align-items:center;justify-content:center;font-size:18px;">'+f.icon+'</div>' +
        '<div>' +
          '<div style="color:#e0e0e0;font-weight:700;font-size:14px;">'+f.label+'</div>' +
          (last.length
            ? '<div style="display:flex;align-items:center;gap:4px;margin-top:4px;">'+thumbs+(n>3?'<span style="color:#555;font-size:10px;">+'+( n-3)+'</span>':'')+'</div>'
            : '<div style="color:#444;font-size:11px;margin-top:3px;">Vide</div>') +
        '</div>' +
        '<div style="text-align:center;"><span style="background:'+f.color+'22;color:'+f.color+';font-size:12px;font-weight:700;padding:3px 10px;border-radius:20px;">'+n+'</span></div>' +
        '<div style="text-align:right;color:#444;font-size:18px;">&rsaquo;</div>' +
      '</div>';
    }).join('') +
    '</div>';

  container.innerHTML = html;
}



function _renderDocFolder(cat) {
  var container = document.getElementById('doc-main-container');
  if (!container) return;
  var f = DOC_FOLDERS[cat];
  var docs = STORE.documents().filter(function(d){ return d.cat===cat; });

  var listHtml = '';
  if (!docs.length) {
    listHtml = '<div class="empty-state" style="padding:40px 0;">Dossier vide — ajoutez votre premier document.</div>';
  } else {
    listHtml =
      '<div style="display:flex;flex-direction:column;gap:2px;background:#0d0d0d;border:1px solid #222;border-radius:12px;overflow:hidden;">' +
      '<div style="display:grid;grid-template-columns:54px 1fr 160px 100px 130px;align-items:center;padding:10px 16px;background:#181818;border-bottom:1px solid #252525;">' +
        '<span style="color:#555;font-size:10px;font-weight:700;text-transform:uppercase;">Aperçu</span>' +
        '<span style="color:#555;font-size:10px;font-weight:700;text-transform:uppercase;">Nom</span>' +
        '<span style="color:#555;font-size:10px;font-weight:700;text-transform:uppercase;">Note</span>' +
        '<span style="color:#555;font-size:10px;font-weight:700;text-transform:uppercase;text-align:center;">Date</span>' +
        '<span style="color:#555;font-size:10px;font-weight:700;text-transform:uppercase;text-align:right;">Actions</span>' +
      '</div>' +
      docs.map(function(d){
        var thumb = _docThumb(d);

        // Bouton déplacer — dropdown
        var moveDd = '<div style="position:relative;display:inline-block;" onclick="event.stopPropagation();">' +
          '<button class="btn btn-sm btn-outline" onclick="toggleMoveMenu(this,\''+d.id+'\')" title="Déplacer vers..." style="padding:4px 8px;color:#fb923c;border-color:#fb923c;">&#8646;</button>' +
          '<div class="doc-move-menu" id="move-menu-'+d.id+'" style="display:none;position:absolute;right:0;top:100%;margin-top:4px;background:#1a1a1a;border:1px solid #333;border-radius:10px;min-width:200px;z-index:999;box-shadow:0 8px 24px rgba(0,0,0,0.5);overflow:hidden;">' +
          '<div style="padding:8px 12px;color:#555;font-size:10px;font-weight:700;text-transform:uppercase;border-bottom:1px solid #252525;">Déplacer vers</div>' +
          Object.entries(DOC_FOLDERS).filter(function(e){ return e[0]!==cat; }).map(function(e){
            return '<div onclick="moveDoc(\'' + d.id + '\',\'' + e[0] + '\')" style="display:flex;align-items:center;gap:10px;padding:10px 14px;cursor:pointer;transition:background 0.1s;font-size:13px;color:#ddd;" onmouseover="this.style.background=\'rgba(251,146,60,0.08)\'" onmouseout="this.style.background=\'\'"><span style="font-size:16px;">'+e[1].icon+'</span>'+e[1].label+'</div>';
          }).join('') +
          '</div></div>';


        return '<div style="display:grid;grid-template-columns:54px 1fr 160px 100px 130px;align-items:center;padding:11px 16px;border-bottom:1px solid #161616;transition:background 0.1s;" onmouseover="this.style.background=\'rgba(255,255,255,0.02)\'" onmouseout="this.style.background=\'\'">' +
          '<div>'+thumb+'</div>' +
          '<div style="min-width:0;">' +
            '<div style="color:#e0e0e0;font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;" onclick="docPreviewPhoto(\''+d.id+'\')">'+escapeHtml(d.name)+'</div>' +
            '<div style="color:#444;font-size:10px;margin-top:1px;">'+_docTypeInfo(d).label+'</div>' +
          '</div>' +
          '<div style="color:#888;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-right:8px;">'+(d.note ? escapeHtml(d.note) : '<span style="color:#2a2a2a;font-style:italic;">—</span>')+'</div>' +
          '<div style="text-align:center;color:#555;font-size:11px;">'+(d.createdAt?d.createdAt.slice(0,10):'')+'</div>' +
          '<div style="display:flex;gap:3px;justify-content:flex-end;flex-wrap:wrap;" onclick="event.stopPropagation();">' +
            '<button class="btn btn-sm btn-outline" onclick="docPrint(\''+d.id+'\')" title="Imprimer" style="padding:4px 6px;">&#128424;</button>' +
            '<button class="btn btn-sm btn-outline" onclick="docWhatsapp(\''+d.id+'\')" title="WhatsApp" style="padding:4px 6px;color:#25d366;border-color:#25d366;">&#128241;</button>' +
            '<button class="btn btn-sm btn-outline" onclick="docEmail(\''+d.id+'\')" title="Email" style="padding:4px 6px;color:#60a5fa;border-color:#60a5fa;">&#9993;</button>' +
            moveDd +
            '<button class="btn btn-sm btn-outline" onclick="openDocModal(\''+d.cat+'\',\''+d.id+'\')" title="Modifier" style="padding:4px 6px;">&#9998;</button>' +
            '<button class="btn btn-sm btn-danger" onclick="deleteDoc(\''+d.id+'\')" title="Supprimer" style="padding:4px 6px;">&times;</button>' +
          '</div>' +
        '</div>';
      }).join('') +
      '</div>';
  }

  container.innerHTML =
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:20px;">' +
      '<button class="btn btn-outline btn-sm" onclick="_docCurrentFolder=null;renderDocumentation();">&#128193; Documentation</button>' +
      '<span style="color:#333;">&rsaquo;</span>' +
      '<span style="font-size:18px;">'+f.icon+'</span>' +
      '<span style="color:'+f.color+';font-weight:700;font-size:14px;">'+f.label+'</span>' +
      '<span style="color:#444;font-size:12px;margin-left:4px;">('+docs.length+' doc'+(docs.length!==1?'s':'')+')</span>' +
    '</div>' +
    '<div style="display:flex;gap:8px;justify-content:flex-end;margin-bottom:16px;">' +
      '<button class="btn btn-outline" onclick="openBulkUploadModal(\''+cat+'\')" style="font-size:12px;">&#8679; Upload groupé</button>' +
      '<button class="btn btn-gold" onclick="openDocModal(\''+cat+'\')">+ Ajouter un document</button>' +
    '</div>' +
    listHtml;
}



function renderDocList(cat) { _renderDocFolder(cat); } // rétrocompat

function _docTypeInfo(d) {
  var ft = d.fileType || '';
  var photo = d.photo || '';
  if (ft === 'image' || (ft === '' && photo && photo.startsWith('data:image'))) return { icon:'&#128247;', label:'Image', color:'#60a5fa', isImage:true };
  if (ft === 'pdf'   || photo.indexOf('application/pdf')  !== -1) return { icon:'&#128196;', label:'PDF',   color:'#d4af37', isImage:false };
  if (ft === 'word'  || photo.indexOf('msword')           !== -1 || photo.indexOf('wordprocessingml') !== -1) return { icon:'&#128221;', label:'Word',  color:'#60a5fa', isImage:false };
  if (ft === 'excel' || photo.indexOf('spreadsheet')      !== -1 || photo.indexOf('excel')            !== -1) return { icon:'&#128202;', label:'Excel', color:'#22c55e', isImage:false };
  if (ft === 'csv'   || photo.indexOf('text/csv')         !== -1) return { icon:'&#128202;', label:'CSV',   color:'#34d399', isImage:false };
  if (ft === 'text'  || photo.indexOf('text/plain')       !== -1) return { icon:'&#128196;', label:'Texte', color:'#94a3b8', isImage:false };
  if (photo && photo.startsWith('data:image')) return { icon:'&#128247;', label:'Image', color:'#60a5fa', isImage:true };
  return { icon:'&#128196;', label:'Fichier', color:'#888', isImage:false };
}

function _docAbsoluteUrl(url) {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  if (url.indexOf('/') === 0) return window.location.origin + url;
  return window.location.origin + '/' + url.replace(/^\/+/, '');
}

function _docViewerUrl(doc) {
  if (!doc || !doc.photo || doc.photo.indexOf('/documents/') !== 0) return '';
  var absoluteUrl = _docAbsoluteUrl(doc.photo);
  if (doc.fileType === 'word' || doc.fileType === 'excel') {
    return 'https://view.officeapps.live.com/op/view.aspx?src=' + encodeURIComponent(absoluteUrl);
  }
  return absoluteUrl;
}

function _decodeDataUrlText(dataUrl) {
  try {
    var base64 = (String(dataUrl || '').split(',')[1] || '');
    var binary = atob(base64);
    var bytes = Uint8Array.from(binary, function(ch) { return ch.charCodeAt(0); });
    return new TextDecoder('utf-8').decode(bytes);
  } catch (e) {
    return '';
  }
}

function _openTextDocument(doc) {
  var targetUrl = _docViewerUrl(doc);
  if (!targetUrl) return window.open(doc.photo, '_blank');
  fetch(targetUrl)
    .then(function(r) { return r.text(); })
    .then(function(text) {
      var w = window.open('', '_blank');
      if (!w) return;
      w.document.write('<html><head><title>' + escapeHtml(doc.name || 'Document') + '</title></head><body style="margin:0;background:#0f0f0f;color:#f5f5f5;font-family:Arial,sans-serif;"><pre style="margin:0;padding:24px;white-space:pre-wrap;word-break:break-word;">' + escapeHtml(text) + '</pre></body></html>');
      w.document.close();
    })
    .catch(function() {
      window.open(targetUrl, '_blank');
    });
}

function _openServerDocument(doc) {
  var targetUrl = _docViewerUrl(doc);
  if (!targetUrl) {
    window.open(doc.photo, '_blank');
    return;
  }
  if (doc.fileType === 'csv' || doc.fileType === 'text') {
    _openTextDocument(doc);
    return;
  }
  window.open(targetUrl, '_blank');
}

function _renderStoredDocPreview(doc) {
  var ti = _docTypeInfo(doc);
  if (ti.isImage) {
    return '<img src="' + doc.photo + '" style="max-width:100%;max-height:180px;border-radius:8px;border:1px solid #333;">';
  }
  return '<div style="display:flex;align-items:center;gap:10px;padding:10px;background:#1a1a1a;border:1px solid ' + ti.color + '66;border-radius:8px;"><span style="font-size:30px;">' + ti.icon + '</span><div style="color:' + ti.color + ';font-weight:700;">' + ti.label + ' existant</div></div>';
}

function _docThumb(d) {
  if (!d.photo) {
    return '<div style="width:42px;height:42px;border-radius:8px;border:1px dashed #333;display:flex;align-items:center;justify-content:center;color:#444;font-size:20px;cursor:default;">&#128196;</div>';
  }
  var ti = _docTypeInfo(d);
  if (ti.isImage) {
    return '<img src="' + d.photo + '" onclick="docPreviewPhoto(\'' + d.id + '\')" style="width:42px;height:42px;border-radius:8px;object-fit:cover;border:1px solid #333;cursor:pointer;" title="Voir">';
  }
  return '<div onclick="docPreviewPhoto(\'' + d.id + '\')" title="Ouvrir" style="width:42px;height:42px;border-radius:8px;background:#1a1a1a;border:1px solid ' + ti.color + '44;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;gap:1px;">' +
    '<span style="font-size:18px;">' + ti.icon + '</span>' +
    '<span style="color:' + ti.color + ';font-size:7px;font-weight:700;">' + ti.label + '</span>' +
  '</div>';
}


function openDocModal(cat, id) {
  var titles = { mythos: "Les documents d'Uthina Chess", nouveau: 'Nouveau', archive: 'Archive' };
  document.getElementById('doc-modal-title').textContent = (id ? 'Modifier — ' : 'Nouveau — ') + (titles[cat] || 'Document');
  document.getElementById('doc-edit-id').value  = id  || '';
  document.getElementById('doc-edit-cat').value = cat || '';
  document.getElementById('doc-name').value = '';
  document.getElementById('doc-note').value = '';
  document.getElementById('doc-photo-preview').innerHTML = '';
  document.getElementById('doc-photo-preview').dataset.photoData = '';
  document.getElementById('doc-photo-input').value = '';
  var ftEl = document.getElementById('doc-file-type');
  if (ftEl) ftEl.value = '';
  if (id) {
    var doc = STORE.documents().find(function(d){ return d.id === id; });
    if (doc) {
      document.getElementById('doc-name').value = doc.name;
      document.getElementById('doc-note').value = doc.note || '';
      var prev = document.getElementById('doc-photo-preview');
      if (doc.photo) {
        prev.innerHTML = _renderStoredDocPreview(doc);
        prev.dataset.photoData = doc.photo;
      }
    }
  }
  document.getElementById('doc-modal').style.display = 'flex';
}

function closeDocModal() {
  document.getElementById('doc-modal').style.display = 'none';
  // Nettoyer la photo caméra si elle n'a pas été enregistrée
  var prevEl = document.getElementById('doc-photo-preview');
  if (prevEl) { prevEl.dataset.photoData = ''; prevEl.dataset.photoType = ''; }
}

function previewDocPhoto(input) {
  var file = input.files[0];
  if (!file) return;
  // Auto-remplir le nom si vide
  var nameEl = document.getElementById('doc-name');
  if (nameEl && !nameEl.value.trim()) {
    nameEl.value = _cleanDocumentName(file.name);
  }
  var fi = _fileInfo(file);
  var preview = document.getElementById('doc-photo-preview');
  preview.dataset.pendingFile = '1';
  var hiddenType = document.getElementById('doc-file-type');
  if (!hiddenType) {
    hiddenType = document.createElement('input');
    hiddenType.type = 'hidden'; hiddenType.id = 'doc-file-type';
    document.getElementById('doc-photo-input').parentNode.appendChild(hiddenType);
  }
  hiddenType.value = fi.type;
  if (fi.type === 'image') {
    var reader = new FileReader();
    reader.onload = function(e) {
      preview.innerHTML = '<img src="' + e.target.result + '" style="max-width:100%;max-height:160px;border-radius:8px;border:1px solid #333;margin-top:4px;">';
      preview.dataset.photoData = e.target.result;
    };
    reader.readAsDataURL(file);
  } else {
    // PDF, Word, Excel, CSV, etc.
    var reader2 = new FileReader();
    reader2.onload = function(e) { preview.dataset.photoData = e.target.result; };
    reader2.readAsDataURL(file);
    preview.innerHTML = '<div style="display:flex;align-items:center;gap:12px;margin-top:8px;padding:12px;background:#1a1a1a;border:1px solid ' + fi.color + '44;border-radius:8px;">' +
      '<span style="font-size:32px;">' + fi.icon + '</span>' +
      '<div><div style="color:' + fi.color + ';font-weight:700;">' + fi.label + ' prêt</div>' +
      '<div style="color:#888;font-size:11px;">' + escapeHtml(file.name) + '</div></div></div>';
  }
}

// Helper — type de fichier
function _cleanDocumentName(fileName) {
  return String(fileName || '')
    .replace(/\.(pdf|doc|docx|xls|xlsx|csv|txt|jpg|jpeg|png|gif|webp)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function _fileInfo(file) {
  var name = file.name.toLowerCase();
  var mime = file.type;
  if (mime === 'application/pdf' || name.endsWith('.pdf'))
    return { type:'pdf',   icon:'&#128196;', label:'PDF',   color:'#d4af37' };
  if (mime.startsWith('image/'))
    return { type:'image', icon:'&#128247;', label:'Image', color:'#60a5fa' };
  if (name.endsWith('.doc') || name.endsWith('.docx') || mime.includes('word'))
    return { type:'word',  icon:'&#128221;', label:'Word',  color:'#60a5fa' };
  if (name.endsWith('.xlsx') || name.endsWith('.xls') || mime.includes('spreadsheet') || mime.includes('excel'))
    return { type:'excel', icon:'&#128202;', label:'Excel', color:'#22c55e' };
  if (name.endsWith('.csv'))
    return { type:'csv',   icon:'&#128202;', label:'CSV',   color:'#34d399' };
  if (name.endsWith('.txt') || mime === 'text/plain')
    return { type:'text',  icon:'&#128196;', label:'Texte', color:'#94a3b8' };
  return { type:'file', icon:'&#128196;', label:'Fichier', color:'#888' };
}

function saveDoc() {
  var name = (document.getElementById('doc-name').value || '').trim();
  if (!name) { alert('Entrez un nom pour le document.'); return; }
  var cat  = document.getElementById('doc-edit-cat').value;
  var id   = document.getElementById('doc-edit-id').value || 'doc_' + Date.now();
  var fileInput = document.getElementById('doc-photo-input');
  var file = fileInput && fileInput.files[0];
  var btn = document.querySelector('#doc-modal .btn-gold');

  if (file) {
    if (btn) { btn.disabled = true; btn.textContent = 'Enregistrement...'; }
    var fd = new FormData();
    fd.append('file', file); fd.append('cat', cat); fd.append('doc_id', id);
    var done = false;
    fetch('/upload.php', { method: 'POST', body: fd })
      .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function(res) {
        done = true;
        if (btn) { btn.disabled = false; btn.textContent = 'Enregistrer'; }
        if (res.ok) { _saveDocRecord(id, cat, name, res.url, res.fileType); }
        else { _saveDocFallbackBase64(id, cat, name, file, btn); }
      })
      .catch(function() { if (!done) _saveDocFallbackBase64(id, cat, name, file, btn); });
  } else {
    // Vérifier si une photo a été prise avec la caméra
    var prevEl = document.getElementById('doc-photo-preview');
    var cameraData = prevEl && prevEl.dataset.photoData;
    if (cameraData) {
      _saveDocRecord(id, cat, name, cameraData, 'image');
    } else {
      var ex = STORE.documents().find(function(d){ return d.id === id; });
      _saveDocRecord(id, cat, name, ex ? ex.photo : '', ex ? (ex.fileType||'image') : 'image');
    }
  }
}

function _saveDocFallbackBase64(id, cat, name, file, btn) {
  var fallbackType = _fileInfo(file).type;
  var reader = new FileReader();
  reader.onload = function(e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Enregistrer'; }
    _saveDocRecord(id, cat, name, e.target.result, fallbackType, '');
  };
  reader.onerror = function() { if (btn) { btn.disabled = false; btn.textContent = 'Enregistrer'; } };
  reader.readAsDataURL(file);
}

function _saveDocRecord(id, cat, name, photoUrl, fileType, note) {
  var noteVal = note !== undefined ? note : (document.getElementById('doc-note') ? document.getElementById('doc-note').value : '');
  var docs = STORE.documents();
  var idx  = docs.findIndex(function(d){ return d.id === id; });
  var doc  = { id:id, cat:cat, name:name, photo:photoUrl, fileType:fileType||'image', note:noteVal, createdAt:new Date().toISOString() };
  if (idx >= 0) docs[idx] = doc; else docs.unshift(doc);
  STORE.saveDocuments(docs);
  closeDocModal();
  renderDocList(cat);
}

function deleteDoc(id) {
  if (!confirm('Supprimer ce document ?')) return;
  var doc = STORE.documents().find(function(d){ return d.id === id; });
  if (doc && doc.photo && doc.photo.indexOf('/documents/') === 0) {
    fetch('/upload.php', { method: 'DELETE', body: 'url=' + encodeURIComponent(doc.photo) });
  }
  STORE.saveDocuments(STORE.documents().filter(function(d){ return d.id !== id; }));
  renderDocList(_docCurrentFolder || 'mythos');
}

function docPreviewPhoto(id) {
  var doc = STORE.documents().find(function(d){ return d.id === id; });
  if (!doc || !doc.photo) return;
  if (doc.photo.indexOf('/documents/') === 0) { _openServerDocument(doc); return; }
  var w = window.open('', '_blank');
  if (doc.fileType === 'pdf') {
    w.document.write('<html><body style="margin:0;height:100vh;"><embed src="' + doc.photo + '" type="application/pdf" width="100%" height="100%"></body></html>');
  } else if (doc.fileType === 'csv' || doc.fileType === 'text') {
    w.document.write('<html><body style="margin:0;background:#0f0f0f;color:#f5f5f5;font-family:Arial,sans-serif;"><pre style="margin:0;padding:24px;white-space:pre-wrap;word-break:break-word;">' + escapeHtml(_decodeDataUrlText(doc.photo)) + '</pre></body></html>');
  } else if (doc.fileType === 'word' || doc.fileType === 'excel' || doc.fileType === 'file') {
    // Ouvrir via Google Docs Viewer pour les fichiers base64 non hébergés
    var googleViewerUrl = 'https://docs.google.com/gview?embedded=true&url=' + encodeURIComponent(window.location.origin + doc.photo);
    w.location = googleViewerUrl;
  } else {
    w.document.write('<html><body style="margin:0;background:#000;display:flex;align-items:center;justify-content:center;min-height:100vh;"><img src="' + doc.photo + '" style="max-width:100%;max-height:100vh;object-fit:contain;"></body></html>');
  }
  w.document.close();
}

function docPrint(id) {
  var doc = STORE.documents().find(function(d){ return d.id === id; });
  if (!doc) return;
  if (doc.photo && doc.photo.indexOf('/documents/') === 0) { _openServerDocument(doc); return; }
  var w = window.open('', '_blank');
  if (doc.fileType === 'pdf') {
    w.document.write('<html><body style="margin:0;height:100vh;"><embed src="' + doc.photo + '" type="application/pdf" width="100%" height="100%"></body></html>');
    setTimeout(function(){ w.print(); }, 800);
  } else if (doc.fileType === 'csv' || doc.fileType === 'text') {
    w.document.write('<html><body style="margin:20px;font-family:Arial;white-space:pre-wrap;word-break:break-word;">' + escapeHtml(_decodeDataUrlText(doc.photo)) + '</body></html>');
    w.document.close();
    setTimeout(function(){ w.print(); }, 400);
  } else {
    w.document.write('<html><body style="margin:20px;font-family:Arial;"><h2>' + escapeHtml(doc.name) + '</h2>' + (doc.photo ? '<img src="' + doc.photo + '" style="max-width:100%">' : '') + '</body></html>');
    w.document.close();
    setTimeout(function(){ w.print(); }, 400);
  }
}

function docWhatsapp(id) {
  var doc = STORE.documents().find(function(d){ return d.id === id; });
  if (!doc) return;
  window.open('https://wa.me/?text=' + encodeURIComponent('Document : ' + doc.name + ' — Mythos Prod'), '_blank');
}

function docEmail(id) {
  var doc = STORE.documents().find(function(d){return d.id===id;});
  if (!doc) return;
  window.open('mailto:?subject=' + encodeURIComponent(doc.name + ' — Mythos Prod') + '&body=' + encodeURIComponent('Document : ' + doc.name), '_blank');
}

// ── Déplacer un document vers un autre dossier ──────────────────────
function toggleMoveMenu(btn, id) {
  // Fermer tous les autres menus ouverts
  document.querySelectorAll('.doc-move-menu').forEach(function(m) {
    if (m.id !== 'move-menu-' + id) m.style.display = 'none';
  });
  var menu = document.getElementById('move-menu-' + id);
  if (menu) menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
}

// Fermer le menu si click ailleurs
document.addEventListener('click', function() {
  document.querySelectorAll('.doc-move-menu').forEach(function(m){ m.style.display = 'none'; });
});

function moveDoc(id, newCat) {
  var f = DOC_FOLDERS[newCat];
  var docs = STORE.documents();
  var idx  = docs.findIndex(function(d){ return d.id === id; });
  if (idx < 0) return;
  docs[idx].cat = newCat;
  STORE.saveDocuments(docs);
  // Fermer le menu
  var menu = document.getElementById('move-menu-' + id);
  if (menu) menu.style.display = 'none';
  renderDocList(_docCurrentFolder || newCat);
}

// ── Upload groupé ───────────────────────────────────────────────────
var _bulkFiles = [];

function openBulkUploadModal(defaultCat) {
  _bulkFiles = [];
  document.getElementById('bulk-files-input').value = '';
  document.getElementById('bulk-preview-list').innerHTML = '';
  // Par défaut : dossier "Nouveau"
  document.getElementById('bulk-target-folder').value = defaultCat || 'nouveau';
  document.getElementById('bulk-upload-modal').style.display = 'flex';
}

function closeBulkUploadModal() {
  document.getElementById('bulk-upload-modal').style.display = 'none';
}

function previewBulkFiles(input) {
  _bulkFiles = Array.from(input.files);
  var container = document.getElementById('bulk-preview-list');
  if (!_bulkFiles.length) { container.innerHTML = ''; return; }

  container.innerHTML = '<div style="display:flex;flex-direction:column;gap:8px;margin-top:8px;">' +
    _bulkFiles.map(function(f, i) {
      var isPdf = f.type === 'application/pdf';
      var fi2 = _fileInfo(f);
      return '<div style="display:flex;align-items:center;gap:10px;background:#111;border:1px solid #222;border-radius:8px;padding:8px 12px;">' +
        '<span style="font-size:20px;">' + fi2.icon + '</span>' +
        '<div style="flex:1;">' +
          '<input type="text" id="bulk-name-' + i + '" value="' + escapeHtml(_cleanDocumentName(f.name)) + '" style="width:100%;background:#1a1a1a;border:1px solid #333;border-radius:6px;padding:5px 8px;color:#ddd;font-size:12px;" placeholder="Nom du document">' +
        '</div>' +
        '<span style="color:#555;font-size:11px;flex-shrink:0;">' + (f.size/1024).toFixed(0) + ' Ko</span>' +
      '</div>';
    }).join('') + '</div>';
}

function saveBulkDocs() {
  if (!_bulkFiles.length) { alert('Selectionnez au moins un fichier.'); return; }
  var cat = document.getElementById('bulk-target-folder').value;
  var btn = document.getElementById('bulk-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Enregistrement...'; }
  var total = _bulkFiles.length;
  var done  = 0;
  function finish() {
    done++;
    if (done >= total) {
      if (btn) { btn.disabled = false; btn.textContent = 'Enregistrer tout'; }
      closeBulkUploadModal();
      _docCurrentFolder = cat;
      renderDocList(cat);
    }
  }
  _bulkFiles.forEach(function(file, i) {
    var nameEl = document.getElementById('bulk-name-' + i);
    var name   = (nameEl && nameEl.value.trim()) || file.name;
    var id     = 'doc_' + Date.now() + '_' + i;
    var fi3    = _fileInfo(file);
    var fd = new FormData();
    fd.append('file', file); fd.append('cat', cat); fd.append('doc_id', id);
    fetch('/upload.php', { method: 'POST', body: fd })
      .then(function(r){ return r.json(); })
      .then(function(res){
        if (res.ok) { _saveDocRecord(id, cat, name, res.url, fi3.type, ''); }
        else { var reader = new FileReader(); reader.onload = function(e){ _saveDocRecord(id, cat, name, e.target.result, fi3.type, ''); finish(); }; reader.readAsDataURL(file); return; }
        finish();
      })
      .catch(function(){
        var reader = new FileReader();
        reader.onload = function(e){ _saveDocRecord(id, cat, name, e.target.result, fi3.type, ''); finish(); };
        reader.readAsDataURL(file);
      });
  });
}

// ══════════════════════════════════════════════════════
// CAMÉRA — Prise de photo directe
// ══════════════════════════════════════════════════════
var _cameraStream = null;
var _cameraFacing = 'environment'; // arrière par défaut
var _capturedDataUrl = null;

var _cameraContext = null; // 'doc-form' ou null (dashboard)
function openCameraModal(context) {
  _cameraContext = context || null;
  _capturedDataUrl = null;
  document.getElementById('camera-preview-result').style.display = 'none';
  document.getElementById('camera-capture-btn').style.display = 'inline-flex';
  document.getElementById('camera-save-btn').style.display = 'none';
  document.getElementById('camera-retake-btn').style.display = 'none';
  document.getElementById('camera-status').textContent = '';
  document.getElementById('camera-modal').style.display = 'flex';

  // Essayer d'ouvrir la caméra via getUserMedia
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    _startCamera();
  } else {
    // Fallback mobile — input capture
    document.getElementById('camera-video').style.display = 'none';
    document.getElementById('camera-capture-btn').style.display = 'none';
    document.getElementById('camera-switch-btn').style.display = 'none';
    document.getElementById('camera-status').textContent = 'Appuyez sur le bouton pour ouvrir la caméra';
    var mobileBtn = document.createElement('button');
    mobileBtn.className = 'btn btn-gold';
    mobileBtn.textContent = '📷 Ouvrir la caméra';
    mobileBtn.onclick = function(){ document.getElementById('camera-mobile-input').click(); };
    document.getElementById('camera-status').appendChild(mobileBtn);
  }
}

function _startCamera() {
  if (_cameraStream) {
    _cameraStream.getTracks().forEach(function(t){ t.stop(); });
  }
  var constraints = { video: { facingMode: _cameraFacing, width: { ideal: 1280 }, height: { ideal: 720 } } };
  navigator.mediaDevices.getUserMedia(constraints)
    .then(function(stream) {
      _cameraStream = stream;
      var video = document.getElementById('camera-video');
      video.style.display = 'block';
      video.srcObject = stream;
      // Afficher bouton retourner si mobile (plusieurs caméras)
      if (navigator.mediaDevices.enumerateDevices) {
        navigator.mediaDevices.enumerateDevices().then(function(devices){
          var cams = devices.filter(function(d){ return d.kind === 'videoinput'; });
          document.getElementById('camera-switch-btn').style.display = cams.length > 1 ? 'inline-flex' : 'none';
        });
      }
      document.getElementById('camera-status').textContent = '';
    })
    .catch(function(err) {
      // getUserMedia échoué → fallback input file
      document.getElementById('camera-video').style.display = 'none';
      document.getElementById('camera-capture-btn').style.display = 'none';
      document.getElementById('camera-status').textContent = 'Caméra non disponible. ';
      var btn = document.createElement('button');
      btn.className = 'btn btn-gold';
      btn.textContent = '📷 Choisir une photo';
      btn.onclick = function(){ document.getElementById('camera-mobile-input').click(); };
      document.getElementById('camera-status').parentNode.appendChild(btn);
    });
}

function switchCamera() {
  _cameraFacing = _cameraFacing === 'environment' ? 'user' : 'environment';
  _startCamera();
}

function capturePhoto() {
  var video  = document.getElementById('camera-video');
  var canvas = document.getElementById('camera-canvas');
  canvas.width  = video.videoWidth  || 640;
  canvas.height = video.videoHeight || 480;
  var ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  _capturedDataUrl = canvas.toDataURL('image/jpeg', 0.9);

  // Afficher le résultat
  document.getElementById('camera-result-img').src = _capturedDataUrl;
  document.getElementById('camera-preview-result').style.display = 'block';
  document.getElementById('camera-video').style.display = 'none';
  document.getElementById('camera-capture-btn').style.display = 'none';
  document.getElementById('camera-save-btn').style.display = 'inline-flex';
  document.getElementById('camera-retake-btn').style.display = 'inline-flex';
  document.getElementById('camera-switch-btn').style.display = 'none';
}

function retakePhoto() {
  _capturedDataUrl = null;
  document.getElementById('camera-preview-result').style.display = 'none';
  document.getElementById('camera-video').style.display = 'block';
  document.getElementById('camera-capture-btn').style.display = 'inline-flex';
  document.getElementById('camera-save-btn').style.display = 'none';
  document.getElementById('camera-retake-btn').style.display = 'none';
}

function cameraMobileCapture(input) {
  var file = input.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(e) {
    _capturedDataUrl = e.target.result;
    document.getElementById('camera-result-img').src = _capturedDataUrl;
    document.getElementById('camera-preview-result').style.display = 'block';
    document.getElementById('camera-save-btn').style.display = 'inline-flex';
    document.getElementById('camera-retake-btn').style.display = 'inline-flex';
  };
  reader.readAsDataURL(file);
}

function saveCapturedPhoto() {
  if (!_capturedDataUrl) return;

  // ── Contexte doc-form : injecter la photo dans le formulaire doc ──
  if (_cameraContext === 'doc-form') {
    var prev = document.getElementById('doc-photo-preview');
    if (prev) {
      prev.innerHTML = '<img src="'+_capturedDataUrl+'" style="max-width:100%;max-height:180px;border-radius:8px;border:1px solid #333;margin-top:4px;">';
      prev.dataset.photoData = _capturedDataUrl;
      prev.dataset.photoType = 'image';
    }
    closeCameraModal();
    // Remettre le z-index du doc-modal au premier plan
    var docModal = document.getElementById('doc-modal');
    if (docModal) { docModal.style.zIndex = '10000'; docModal.style.display = 'flex'; }
    return;
  }

  // ── Contexte dashboard (comportement original) ────────────────────
  var now = new Date();
  var pad = function(n){ return String(n).padStart(2,'0'); };
  var name = 'Photo ' + now.getFullYear() + '-' + pad(now.getMonth()+1) + '-' + pad(now.getDate()) +
             ' ' + pad(now.getHours()) + 'h' + pad(now.getMinutes()) + 'm' + pad(now.getSeconds()) + 's';

  var id = 'doc_photo_' + Date.now();
  var btn = document.getElementById('camera-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Enregistrement...'; }

  // Essai upload serveur
  fetch('/upload.php', {
    method: 'POST',
    body: (function(){
      var fd = new FormData();
      // Convertir dataUrl en Blob
      var arr = _capturedDataUrl.split(',');
      var mime = arr[0].match(/:(.*?);/)[1];
      var bstr = atob(arr[1]);
      var u8arr = new Uint8Array(bstr.length);
      for (var i=0; i<bstr.length; i++) u8arr[i] = bstr.charCodeAt(i);
      var blob = new Blob([u8arr], { type: mime });
      fd.append('file', blob, id + '.jpg');
      fd.append('cat', 'nouveau');
      fd.append('doc_id', id);
      return fd;
    })()
  })
  .then(function(r){ return r.json(); })
  .then(function(res){
    var url = res.ok ? res.url : _capturedDataUrl;
    _saveDocRecord(id, 'nouveau', name, url, 'image', '');
    closeCameraModal();
    if (typeof renderDocumentation === 'function') {
      _docCurrentFolder = 'nouveau';
      renderDocList('nouveau');
      showView('documentation');
    }
  })
  .catch(function(){
    _saveDocRecord(id, 'nouveau', name, _capturedDataUrl, 'image', '');
    closeCameraModal();
    if (typeof renderDocumentation === 'function') {
      _docCurrentFolder = 'nouveau';
      renderDocList('nouveau');
      showView('documentation');
    }
  });
}

function closeCameraModal() {
  if (_cameraStream) {
    _cameraStream.getTracks().forEach(function(t){ t.stop(); });
    _cameraStream = null;
  }
  var video = document.getElementById('camera-video');
  if (video) video.srcObject = null;
  document.getElementById('camera-modal').style.display = 'none';
}

// ── Bande jaune verticale + effet lift nav-btn ────────────────────────
(function() {
  var style = document.createElement('style');
  style.textContent = [
    '.nav-btn{transition:background .15s,color .15s,box-shadow .22s cubic-bezier(.34,1.56,.64,1),transform .22s cubic-bezier(.34,1.56,.64,1)!important}',
    '.nav-btn:hover{box-shadow:inset -3px 0 0 rgba(201,168,76,.6)!important;transform:translateY(-1px)!important}',
    '.nav-btn.active{box-shadow:inset -3px 0 0 #c9a84c!important;transform:translateY(-2px)!important}'
  ].join('');
  document.head.appendChild(style);
})();

// ── Scrollbar dorée pour la zone paramétrage ──────────────────────────
(function() {
  var s = document.createElement('style');
  s.textContent = [
    '#rd-param-canvas-zone::-webkit-scrollbar{width:6px}',
    '#rd-param-canvas-zone::-webkit-scrollbar-track{background:rgba(201,168,76,0.05);border-radius:3px}',
    '#rd-param-canvas-zone::-webkit-scrollbar-thumb{background:#c9a84c;border-radius:3px}',
    '#rd-param-canvas-zone::-webkit-scrollbar-thumb:hover{background:#e4c472}'
  ].join('');
  document.head.appendChild(s);
})();
// EOF-marker-resync
