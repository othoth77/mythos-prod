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

function renderEntityPage(targetId, items, renderTitle, editFn, deleteFn) {
  const el = document.getElementById(targetId);
  if (!el) return;
  if (!items.length) { el.innerHTML = '<div class="empty-state">Aucune donnee.</div>'; return; }
  el.innerHTML = '<div class="item-grid">' + items.map(item => `<div class="item-card compta-detail-row"><div><div class="item-name">${renderTitle(item)}</div></div><div class="item-actions"><button class="btn btn-outline btn-sm" onclick="${editFn.name}('${item.id}')" title="Modifier">✏️</button><button class="btn btn-danger btn-sm" onclick="${deleteFn.name}('${item.id}')" title="Supprimer">✕</button></div></div>`).join('') + '</div>';
}
// Purchase TVA calculator moved to js/shared/accounting-tva.js.

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
