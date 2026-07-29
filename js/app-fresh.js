// =====================================================
// MYTHOS PROD - Application Fresh (Minimal Working Version)
// =====================================================

const MYTHOS_LOGO_SRC = 'assets/logos/logomythos.png';
const MYTHOS_PRINT_LOGO_SRC = 'assets/logos/logo.png';

// ── STORAGE LAYER ──
const STORE = {
  invoices: () => JSON.parse(localStorage.getItem('mp_invoices') || '[]'),
  saveInvoices: d => localStorage.setItem('mp_invoices', JSON.stringify(d)),
  clients: () => JSON.parse(localStorage.getItem('mp_clients') || '[]'),
  saveClients: d => localStorage.setItem('mp_clients', JSON.stringify(d)),
  oms: () => JSON.parse(localStorage.getItem('mp_oms') || '[]'),
  saveOms: d => localStorage.setItem('mp_oms', JSON.stringify(d)),
  collabs: () => JSON.parse(localStorage.getItem('mp_collabs') || '[]'),
  saveCollabs: d => localStorage.setItem('mp_collabs', JSON.stringify(d)),
  natures: () => JSON.parse(localStorage.getItem('mp_natures') || '[]'),
  saveNatures: d => localStorage.setItem('mp_natures', JSON.stringify(d)),
};

// ── UTILITY FUNCTIONS ──
function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' +
         String(d.getMonth() + 1).padStart(2, '0') + '-' +
         String(d.getDate()).padStart(2, '0');
}

function money(val) {
  return parseFloat(val || 0).toFixed(3);
}

function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return String(text || '').replace(/[&<>"']/g, m => map[m]);
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('fr-FR');
}

// ── ROUTING / NAVIGATION ──
let currentPage = 'dashboard';

function navigateTo(page) {
  currentPage = page;
  renderPage(page);
  updateSidebar();
}

function updateSidebar() {
  document.querySelectorAll('.sidebar-item').forEach(item => {
    item.classList.remove('active');
  });
  const activeItem = document.querySelector(`[data-page="${currentPage}"]`);
  if (activeItem) activeItem.classList.add('active');
}

// ── PAGE RENDERING ──
function renderPage(page) {
  const mainContent = document.getElementById('main-content');
  if (!mainContent) return;

  switch (page) {
    case 'dashboard':
      renderDashboard();
      break;
    case 'invoices':
      renderInvoices();
      break;
    case 'clients':
      renderClients();
      break;
    case 'oms':
      renderOms();
      break;
    case 'calendar':
      renderCalendar();
      break;
    default:
      renderDashboard();
  }
}

// ── DASHBOARD ──
function renderDashboard() {
  const mainContent = document.getElementById('main-content');
  if (!mainContent) return;

  const invoices = STORE.invoices();
  const clients = STORE.clients();

  const totalInvoices = invoices.length;
  const totalAmount = invoices.reduce((sum, inv) => sum + (parseFloat(inv.totalHT) || 0), 0);

  mainContent.innerHTML = `
    <div class="page-header">
      <h1>Tableau de bord</h1>
    </div>
    <div class="dashboard-grid">
      <div class="dashboard-card">
        <h3>Factures</h3>
        <p class="stat">${totalInvoices}</p>
      </div>
      <div class="dashboard-card">
        <h3>Montant total</h3>
        <p class="stat">${money(totalAmount)} DT</p>
      </div>
      <div class="dashboard-card">
        <h3>Clients</h3>
        <p class="stat">${clients.length}</p>
      </div>
    </div>
  `;
}

// ── INVOICES ──
function renderInvoices() {
  const mainContent = document.getElementById('main-content');
  if (!mainContent) return;

  const invoices = STORE.invoices();

  let html = `
    <div class="page-header">
      <h1>Factures</h1>
      <button class="btn btn-primary" onclick="showAddInvoiceForm()">+ Nouvelle facture</button>
    </div>
    <table class="data-table">
      <thead>
        <tr>
          <th>Numéro</th>
          <th>Client</th>
          <th>Date</th>
          <th>Montant HT</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
  `;

  invoices.forEach(inv => {
    html += `
      <tr>
        <td>${escapeHtml(inv.num)}</td>
        <td>${escapeHtml(inv.clientName || '-')}</td>
        <td>${formatDate(inv.date)}</td>
        <td>${money(inv.totalHT)} DT</td>
        <td>
          <button class="btn btn-sm btn-info" onclick="editInvoice('${inv.id}')">Éditer</button>
          <button class="btn btn-sm btn-danger" onclick="deleteInvoice('${inv.id}')">Supprimer</button>
        </td>
      </tr>
    `;
  });

  html += `
      </tbody>
    </table>
  `;

  mainContent.innerHTML = html;
}

function showAddInvoiceForm() {
  alert('Fonctionnalité en développement');
}

function editInvoice(id) {
  alert('Édition facture: ' + id);
}

function deleteInvoice(id) {
  if (confirm('Supprimer cette facture?')) {
    const invoices = STORE.invoices().filter(inv => inv.id !== id);
    STORE.saveInvoices(invoices);
    renderInvoices();
  }
}

// ── CLIENTS ──
function renderClients() {
  const mainContent = document.getElementById('main-content');
  if (!mainContent) return;

  const clients = STORE.clients();

  let html = `
    <div class="page-header">
      <h1>Clients</h1>
      <button class="btn btn-primary" onclick="showAddClientForm()">+ Nouveau client</button>
    </div>
    <table class="data-table">
      <thead>
        <tr>
          <th>Nom</th>
          <th>Contact</th>
          <th>Email</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
  `;

  clients.forEach(client => {
    html += `
      <tr>
        <td>${escapeHtml(client.name || '-')}</td>
        <td>${escapeHtml(client.contact || '-')}</td>
        <td>${escapeHtml(client.email || '-')}</td>
        <td>
          <button class="btn btn-sm btn-info" onclick="editClient('${client.id}')">Éditer</button>
          <button class="btn btn-sm btn-danger" onclick="deleteClient('${client.id}')">Supprimer</button>
        </td>
      </tr>
    `;
  });

  html += `
      </tbody>
    </table>
  `;

  mainContent.innerHTML = html;
}

function showAddClientForm() {
  alert('Fonctionnalité en développement');
}

function editClient(id) {
  alert('Édition client: ' + id);
}

function deleteClient(id) {
  if (confirm('Supprimer ce client?')) {
    const clients = STORE.clients().filter(c => c.id !== id);
    STORE.saveClients(clients);
    renderClients();
  }
}

// ── OMS (ORDRES DE MISSION) ──
function renderOms() {
  const mainContent = document.getElementById('main-content');
  if (!mainContent) return;

  const oms = STORE.oms();

  let html = `
    <div class="page-header">
      <h1>Ordres de mission</h1>
      <button class="btn btn-primary" onclick="showAddOmForm()">+ Nouvel OM</button>
    </div>
    <table class="data-table">
      <thead>
        <tr>
          <th>Numéro</th>
          <th>Date</th>
          <th>Nature</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
  `;

  oms.forEach(om => {
    html += `
      <tr>
        <td>${escapeHtml(om.num || '-')}</td>
        <td>${formatDate(om.date || '')}</td>
        <td>${escapeHtml(om.natureName || '-')}</td>
        <td>
          <button class="btn btn-sm btn-info" onclick="editOm('${om.id}')">Éditer</button>
          <button class="btn btn-sm btn-danger" onclick="deleteOm('${om.id}')">Supprimer</button>
        </td>
      </tr>
    `;
  });

  html += `
      </tbody>
    </table>
  `;

  mainContent.innerHTML = html;
}

function showAddOmForm() {
  alert('Fonctionnalité en développement');
}

function editOm(id) {
  alert('Édition OM: ' + id);
}

function deleteOm(id) {
  if (confirm('Supprimer cet OM?')) {
    const oms = STORE.oms().filter(o => o.id !== id);
    STORE.saveOms(oms);
    renderOms();
  }
}

// ── CALENDAR ──
function renderCalendar() {
  const mainContent = document.getElementById('main-content');
  if (!mainContent) return;

  mainContent.innerHTML = `
    <div class="page-header">
      <h1>Calendrier</h1>
    </div>
    <p>Calendrier - Fonctionnalité en développement</p>
  `;
}

// ── SIDEBAR NAVIGATION ──
function setupSidebarEvents() {
  document.querySelectorAll('.sidebar-item').forEach(item => {
    item.addEventListener('click', function(e) {
      e.preventDefault();
      const page = this.getAttribute('data-page');
      if (page) navigateTo(page);
    });
  });
}

// ── INITIALIZATION ──
function initApp() {
  console.log('🚀 Mythos Prod - App initialized');
  setupSidebarEvents();
  navigateTo('dashboard');
}

// ── DOM READY ──
document.addEventListener('DOMContentLoaded', function() {
  initApp();
});
