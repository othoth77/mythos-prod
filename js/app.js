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

// populateOmList → js/shared/mission-orders.js (renderOMList)

// editInvoice, deleteInvoice → js/shared/invoices.js
// ── DEVIS FUNCTIONS ──
// Devis CRUD, form, and preview moved to js/shared/devis.js.
// RDV CRUD and form workflow moved to js/shared/rdvs.js.
function removePersonRow(btn) {
  const row = btn.closest('tr');
  if (row) row.remove();
}

// addOmPerson → js/shared/mission-orders.js

// addLine, removeLine, getLines → js/shared/invoices.js
// (the legacy "Fonctionnalité en développement" stub was a dead duplicate:
//  invoices.js loads after app.js and owns the working implementation)

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

// applyOmMissionType -> js/shared/mission-orders.js (owns the real
// implementation; this empty stub was a dead duplicate shadowed at runtime)


// ── OM FUNCTIONS → js/shared/mission-orders.js ──
// editOm → js/shared/mission-orders.js
// deleteOm → js/shared/mission-orders.js
// cancelOM → js/shared/mission-orders.js

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
      document.querySelectorAll('.nav-btn').forEach(el => { el.classList.remove('active'); el.removeAttribute('aria-current'); });
      const target = document.getElementById('view-logs');
      if (target) target.classList.add('active');
      const nav = document.getElementById('nav-logs');
      if (nav) { nav.classList.add('active'); nav.setAttribute('aria-current', 'page'); }
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
// ── Documentation → js/shared/documentation.js
// _docCurrentFolder, DOC_FOLDERS, _bulkFiles, renderDocumentation, switchDocTab,
// openDocFolder, _renderDocHome, _renderDocFolder, renderDocList, _docTypeInfo,
// _docAbsoluteUrl, _docViewerUrl, _decodeDataUrlText, _openTextDocument,
// _openServerDocument, _renderStoredDocPreview, _docThumb, openDocModal,
// closeDocModal, previewDocPhoto, _cleanDocumentName, _fileInfo, saveDoc,
// _saveDocFallbackBase64, _saveDocRecord, deleteDoc, docPreviewPhoto, docPrint,
// docWhatsapp, docEmail, toggleMoveMenu, moveDoc, openBulkUploadModal,
// closeBulkUploadModal, previewBulkFiles, saveBulkDocs

// ── Camera Modal → js/shared/camera.js
// _cameraStream, _cameraFacing, _capturedDataUrl, _cameraContext,
// openCameraModal, _startCamera, switchCamera, capturePhoto, retakePhoto,
// cameraMobileCapture, saveCapturedPhoto, closeCameraModal

// ── Bande jaune verticale + effet lift nav-btn ────────────────────────
(function() {
  var style = document.createElement('style');
  style.textContent = [
    '.nav-btn{transition:background .15s,color .15s,box-shadow .22s cubic-bezier(.34,1.56,.64,1),transform .22s cubic-bezier(.34,1.56,.64,1)!important}',
    '.nav-btn:hover{box-shadow:inset -3px 0 0 rgba(217,164,65,.6)!important;transform:translateY(-1px)!important}',
    '.nav-btn.active{box-shadow:inset -3px 0 0 #D9A441!important;transform:translateY(-2px)!important}'
  ].join('');
  document.head.appendChild(style);
})();

// ── Scrollbar dorée pour la zone paramétrage ──────────────────────────
(function() {
  var s = document.createElement('style');
  s.textContent = [
    '#rd-param-canvas-zone::-webkit-scrollbar{width:6px}',
    '#rd-param-canvas-zone::-webkit-scrollbar-track{background:rgba(217,164,65,0.05);border-radius:3px}',
    '#rd-param-canvas-zone::-webkit-scrollbar-thumb{background:#D9A441;border-radius:3px}',
    '#rd-param-canvas-zone::-webkit-scrollbar-thumb:hover{background:#EBCE99}'
  ].join('');
  document.head.appendChild(s);
})();
// EOF-marker-resync
