// MYTHOS PROD — ROUTER v1
// Navigation state and view switching.
// Provides: currentPage, navigateTo, showPage, showView, updateSidebarStats
// Render callbacks (updateDashboardStats, renderList, etc.) remain in app.js.
// ══════════════════════════════════════════════════════════════════════

// ── NAVIGATION ──
var currentPage = 'dashboard';

function navigateTo(page) {
  currentPage = page;
  showPage(page);
}

function showPage(page) {
  // Hide all views
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));

  // Show the right view
  let viewId = '';
  switch (page) {
    case 'dashboard':
      viewId = 'view-dashboard';
      break;
    case 'invoices':
      viewId = 'view-list';
      populateInvoiceList();
      break;
    case 'oms':
      viewId = 'view-om-list';
      if (typeof renderOMList === 'function') renderOMList();
      break;
    case 'clients':
      viewId = 'view-clients';
      break;
    case 'calendar':
      viewId = 'view-calendrier';
      break;
    default:
      viewId = 'view-dashboard';
  }

  const view = document.getElementById(viewId);
  if (view) view.classList.add('active');
}

function showView(viewName) {
  const view = document.getElementById('view-' + viewName) ? viewName : 'dashboard';
  document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
  const target = document.getElementById('view-' + view);
  if (target) target.classList.add('active');

  const navId = view.startsWith('compta-') ? 'nav-comptabilite' : 'nav-' + view;
  const nav = document.getElementById(navId);
  if (nav) nav.classList.add('active');

  if (view === 'dashboard') { updateDashboardStats(); loadDashboardInscriptionsCount(); }
  if (view === 'inscriptions') loadInscriptions();
  if (view === 'appel') renderAppels();
  if (view === 'conformite') renderListeConforme();
  if (view === 'parametres') { loadSettingsCallScript(); loadSettingsSheetUrl(); }
  if (view === 'list') renderList();
  if (view === 'new') initNewForm();
  if (view === 'devis') populateDevisList();
  if (view === 'devis-form') initDevisForm();
  if (view === 'contracts') renderContracts();
  if (view === 'contract-form') initContractForm();
  if (view === 'om-list') renderOMList();
  if (view === 'om-new') initOMForm();
  if (view === 'rendez-vous') rdvRender();
  if (view === 'representations') renderRepresentations();
  if (view === 'clients') renderClients();
  if (view === 'collaborateurs') renderCollaborateurs();
  if (view === 'natures') renderNatures();
  if (view === 'fournisseurs') renderFournisseurs();
  if (view === 'calendrier') renderCalendrier();
  if (view === 'comptabilite') renderComptaViews();
  if (view === 'compta-suppliers') renderSuppliersPage();
  if (view === 'compta-purchases') renderPurchasesPage();
  if (view === 'compta-expenses') renderExpensesPage();
  if (view === 'compta-bank') renderBankPage();
  if (view === 'compta-cash') renderCashPage();
  if (view === 'compta-categories') renderExpenseCategoryManager();
  if (view === 'compta-reconciliation') renderReconciliationPage();
  if (view === 'statistique') renderStatistique();
  if (view === 'representations') renderRepresentations();
  if (view === 'calculateur-spectacle') initSpectacleCalculator();
  if (view === 'sauvegarde') renderBackupDashboard();
  if (view === 'documentation') renderDocumentation();
  if (view === 'gestion-contacts') { _rcFilterBatchId = null; renderRepertoireContactsPage(); renderRepertoireImportsHistory(); _rcRenderDuplicatesBanner(); }
  if (view === 'contact-fiche') { renderContactFiche(); }
  if (view === 'redaction-das') { if (typeof _rdRender === 'function') _rdRender('das'); }
  if (view === 'redaction-autres') { if (typeof _rdRender === 'function') _rdRender('autres'); }
  updateSidebarStats();
  location.hash = view;
}

function updateSidebarStats() {
  // Statistiques supprimées du sidebar — voir page Statistique
}
