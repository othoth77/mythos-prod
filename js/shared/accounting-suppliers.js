// Accounting Suppliers page/detail/CRUD extraction (Stage 4V).
// Dependencies: STORE, esc/num/fmtMoney, shared modal helpers, accounting purchases/bank modules.

let supplierFilterCategory = 'all';
let supplierSearchQuery = '';

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

  let html = `<div style="padding:16px; background:linear-gradient(135deg, rgba(217,164,65,0.08), rgba(217,164,65,0.04)); border:1px solid rgba(217,164,65,0.15); border-radius:12px; margin-bottom:16px;">
    <div style="color:var(--gold); font-weight:700; margin-bottom:12px; font-size:13px;">🔍 RECHERCHER & FILTRER</div>
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(250px, 1fr)); gap:12px;">
      <div>
        <label style="color:var(--muted); font-size:11px; font-weight:700; margin-bottom:4px; display:block;">Rechercher par nom, contact ou adresse</label>
        <input type="text" id="supplier-search" placeholder="Tapez pour chercher..." value="${supplierSearchQuery}" oninput="setSupplierSearch(this.value)" style="width:100%; padding:8px; background:#1a1a1a; color:#D9A441; border:1px solid var(--control-border); border-radius:6px;">
      </div>

      <div>
        <label style="color:var(--muted); font-size:11px; font-weight:700; margin-bottom:4px; display:block;">Filtrer par catégorie</label>
        <select id="supplier-filter-category" onchange="setSupplierFilterCategory(this.value)" style="width:100%; padding:8px; background:#1a1a1a; color:#D9A441; border:1px solid var(--control-border); border-radius:6px;">
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
      <div style="background:linear-gradient(135deg, rgba(217,164,65,0.12), rgba(217,164,65,0.06)); border:1px solid rgba(217,164,65,0.2); border-radius:16px; padding:32px 40px; margin-bottom:32px;">
        <h1 style="font-family: 'Archivo Expanded', sans-serif; font-size:42px; color:var(--gold-light); font-weight:600; margin:0 0 16px 0;">${esc(supplier.name)}</h1>
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:20px; margin-top:20px;">
          <div><div style="color:var(--muted); font-size:11px; text-transform:uppercase; font-weight:700; margin-bottom:5px;">Contact</div><div style="color:var(--text); font-size:14px;">${esc(supplier.contact || '-')}</div></div>
          <div><div style="color:var(--muted); font-size:11px; text-transform:uppercase; font-weight:700; margin-bottom:5px;">Adresse</div><div style="color:var(--text); font-size:14px;">${esc(supplier.addr || '-')}</div></div>
          <div><div style="color:var(--muted); font-size:11px; text-transform:uppercase; font-weight:700; margin-bottom:5px;">Catégorie</div><div style="color:var(--text); font-size:14px;">${esc(supplier.category || '-')}</div></div>
          <div><div style="color:var(--muted); font-size:11px; text-transform:uppercase; font-weight:700; margin-bottom:5px;">Immatricule Fiscal</div><div style="color:var(--text); font-size:14px;">${esc(supplier.immatricule || '-')}</div></div>
        </div>
      </div>
    </div>

    <h2 style="font-family: 'Archivo Expanded', sans-serif; color:var(--gold-light); font-size:20px; margin:32px 0 20px; border-bottom:2px solid rgba(217,164,65,0.3); padding-bottom:12px; font-weight:600;">Extraits bancaires liés (${bankEntries.length})</h2>
    ${bankEntries.length === 0 ? '<div class="empty-state">Aucun extrait bancaire lié à ce fournisseur.</div>' : '<table class="suppliers-list-table" style="margin-top:16px;"><thead><tr><th>Date</th><th>Type</th><th>Libellé</th><th style="text-align:right;">Montant</th><th style="width:80px;text-align:center;">Actions</th></tr></thead><tbody>' + bankEntries.map(b => `<tr><td>${esc((b.date || '').slice(5))}</td><td>${esc(b.type || '-')}</td><td style="color:var(--muted);font-size:12px;">${esc(b.label || '')}</td><td style="text-align:right;color:${b.direction === 'Debit' ? '#ff6464' : '#4cc964'};font-weight:700;">${fmtMoney(b.amount)}</td><td style="text-align:center;"><button class="btn btn-outline btn-sm" onclick="openBankDetailModal('${b.id}')" title="Détails">👁️</button></td></tr>`).join('') + '</tbody></table>'}

    <div style="margin-top:32px; padding:20px; background:linear-gradient(135deg, rgba(217,164,65,0.08), rgba(217,164,65,0.04)); border:1px solid rgba(217,164,65,0.15); border-radius:12px; text-align:center;">
      <div style="color:var(--muted); font-size:12px; text-transform:uppercase; margin-bottom:8px;">Total des Extraits Bancaires</div>
      <div style="font-family: 'IBM Plex Mono', monospace; font-size:28px; color:var(--gold-light); font-weight:400;">${fmtMoney(totalBankAmount)}</div>
    </div>

    <h2 style="font-family: 'Archivo Expanded', sans-serif; color:var(--gold-light); font-size:20px; margin:32px 0 20px; border-bottom:2px solid rgba(217,164,65,0.3); padding-bottom:12px; font-weight:600;">Factures liées (${purchases.length})</h2>
    ${purchases.length === 0 ? '<div class="empty-state">Aucune facture pour ce fournisseur.</div>' : '<table class="suppliers-list-table" style="margin-top:16px;"><thead><tr><th>N°</th><th>Date</th><th>Notes</th><th style="text-align:right;">Montant</th><th style="width:150px;text-align:center;">Actions</th></tr></thead><tbody>' + purchases.map(p => `<tr><td><strong>${esc(p.num || '-')}</strong></td><td>${esc(p.date || '')}</td><td style="color:var(--muted);font-size:12px;">${esc(p.notes || '')}</td><td style="text-align:right;color:var(--gold-light);font-weight:700;">${fmtMoney(p.amount)}</td><td style="text-align:center;"><button class="btn btn-outline btn-sm" onclick="openPurchaseModal('${p.id}')" title="Modifier">✏️</button> <button class="btn btn-danger btn-sm" onclick="deletePurchase('${p.id}')" title="Supprimer">✕</button></td></tr>`).join('') + '</tbody></table>'}

    <div style="margin-top:32px; padding:20px; background:linear-gradient(135deg, rgba(217,164,65,0.08), rgba(217,164,65,0.04)); border:1px solid rgba(217,164,65,0.15); border-radius:12px; text-align:center;">
      <div style="color:var(--muted); font-size:12px; text-transform:uppercase; margin-bottom:8px;">Total des Factures</div>
      <div style="font-family: 'IBM Plex Mono', monospace; font-size:28px; color:var(--gold-light); font-weight:400;">${fmtMoney(totalAmount)}</div>
    </div>
  `;
}
function getSupplierCategoryStyle(category) {
  const styles = {
    'Mécanicien': { icon: '🔧', color: '#ff6496', bg: 'rgba(255,100,150,0.1)' },
    'Alimentation': { icon: '🍕', color: '#4cc964', bg: 'rgba(76,201,100,0.1)' },
    'Carburant': { icon: '⛽', color: '#ffa500', bg: 'rgba(255,165,0,0.1)' },
    'Télécommunications': { icon: '📱', color: '#64b4ff', bg: 'rgba(100,180,255,0.1)' },
    'Logistique': { icon: '🚚', color: '#D9A441', bg: 'rgba(217,164,65,0.1)' },
    'Électronique': { icon: '💻', color: '#9b59b6', bg: 'rgba(155,89,182,0.1)' },
    'Services': { icon: '💼', color: '#3498db', bg: 'rgba(52,152,219,0.1)' },
    'Décor': { icon: '🎨', color: '#e74c3c', bg: 'rgba(231,76,60,0.1)' },
    'Matériel': { icon: '🔧', color: '#95a5a6', bg: 'rgba(149,165,166,0.1)' }
  };
  return styles[category] || { icon: '📦', color: '#D9A441', bg: 'rgba(217,164,65,0.1)' };
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
