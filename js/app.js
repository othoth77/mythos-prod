// =====================================================
// MYTHOS PROD - Main Application
// =====================================================

const MYTHOS_LOGO_SRC = 'assets/logos/logomythos.png';
const MYTHOS_PRINT_LOGO_SRC = 'assets/logos/logo-uthina-chess.png';
const SDT_PRINT_LOGO_SRC = 'assets/logos/logo-sdt.png';
// Mission-order company definitions moved to js/shared/mission-orders.js.
// Devis issuer definitions moved to js/shared/devis.js.
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
// Devis stamp generation moved to js/shared/devis.js.

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
// Devis CRUD, form, and preview moved to js/shared/devis.js.
// RDV CRUD and form workflow moved to js/shared/rdvs.js.
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
// OM_MISSION_TEXTS and stableOmPersonCount moved to js/shared/mission-orders.js.

// stableLineCount moved to js/shared/invoices.js.
let stableRdvPrestRows = 0;
// stableRepNatureRows → js/shared/representations.js
// calFilterMode → js/shared/calendar.js
// Accounting overview moved to js/shared/accounting-overview.js.
// Financial reports moved to js/shared/accounting-reports.js.
// Purchases workflow moved to js/shared/accounting-purchases.js.
// Expenses workflow moved to js/shared/accounting-expenses.js.
// Bank filters and workflow moved to js/shared/accounting-bank.js.
// Cash filters and workflow moved to js/shared/accounting-cash.js.
// Accounting Suppliers workflow moved to js/shared/accounting-suppliers.js.
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

// ── Inscriptions / Appels workflow → js/shared/inscriptions.js ───────────────
// INSCRIPTIONS_SCRIPT_URL, _escHtmlInsc, loadDashboardInscriptionsCount,
// _uclNum, _appUid, loadInscriptions, validerToutesInscriptions,
// validerInscriptionRow, renderAppels, reinitialiserListes,
// reafficherInscriptions, renderListeConforme,
// getCallScript, saveCallScript, loadSettingsCallScript, saveCallScriptFromSettings,
// resetCallScriptToDefault, getSheetWebhookUrl, saveSheetWebhookUrl,
// loadSettingsSheetUrl, saveSheetUrlFromSettings, testSheetWebhookFromSettings,
// pushToGoogleSheet, MOIS_NOMS, _populateNaissanceSelects,
// openAppelFicheModal, closeAppelFicheModal, setAppelResult, saveAppelFiche

// ── Routing → js/core/router.js ────────────────────────────────────
// showView, updateSidebarStats, currentPage, navigateTo, showPage

// ── Répertoire Contacts → js/shared/contacts.js ───────────────────────
// _rcFilterBatchId, _rcActiveTab, RC_HISTORY_TYPES, RC_OUTCOMES, RC_NOTE_TEMPLATES,
// currentContactFicheId, _rcDebounce, _rcDebouncedRenderRepertoire,
// _rcDebouncedRenderAnnuaire, rcSearchInputChanged, _rcInfo, _rcFormatDateTime,
// importPhoneContacts, startGoogleContactsImport, _checkGoogleImportToken,
// triggerContactsFileImport, _vcUnescape, _parseVCardFile, handleContactsFileImport,
// renderRepertoireImportsHistory, deleteRepertoireImport, updateRepertoireImportLabel,
// setRepertoireContactsFilter, _rcMaxNumero, addRepertoireContactRow,
// updateRepertoireContactField, _rcStripPhoneSpaces, deleteRepertoireContact,
// _rcBackfillNumeros, _rcDetectDuplicateGroups, _rcRenderDuplicatesBanner,
// _rcMergeGroupInList, mergeDuplicateGroup, mergeAllDuplicateGroups,
// renderRepertoireContactsPage, setContactsTab, _rcInitials, _rcCleanPhone,
// _rcWhatsappNumber, logContactHistory, setLastCallOutcome, _rcAfterContactsMutation,
// _rcLastHistoryEntry, _rcLastCallEntry, _rcContactStatus, _rcFollowUpBucket,
// _rcFollowUpBadge, _rcGetFilteredSortedContacts, _rcGetFilteredSortedContactsForTable,
// _rcResetTableFilters, _rcPopulateDynamicFilters, _rcComputeStats, _rcRenderStats,
// renderContactsDirectory, exportContactsDirectoryCSV, openContactFiche,
// renderContactFiche, _rcToggleOutcomeSelect, _rcFillHistoryNote,
// _rcRenderHistoryTimeline, addManualContactHistory, updateRepertoireContactTags
// Invoice list and numbering moved to js/shared/invoices.js.

// Devis numbering moved to js/shared/devis.js.
// Invoice form and CRUD moved to js/shared/invoices.js.

// Contracts CRUD moved to js/shared/contracts.js
// Invoice preview and print rendering moved to js/shared/invoices.js.

// Mission Orders CRUD moved to js/shared/mission-orders.js.

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

// ── Accounting Suppliers → js/shared/accounting-suppliers.js ──────────────

// renderEntityPage removed in Stage 4Z — confirmed no callers in HTML, JS, or PHP.
// Purchase TVA calculator moved to js/shared/accounting-tva.js.

// Generic modal entity helpers moved to js/shared/modal-entity-helpers.js.
// Statistics dashboard moved to js/shared/statistics-dashboard.js.
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
// ── Backup/Export/Restore → js/shared/backup.js
// _getAllData, exportBackup, importBackup, createBackupVersion,
// exportVersionHistory, pushAllToServer, renderBackupDashboard,
// runDiskCleanup, _restoreVersion, _deleteVersion, _restoreServerBackup

// ── Spectacle Calculator → js/shared/spectacle-calculator.js
// initSpectacleCalculator
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
