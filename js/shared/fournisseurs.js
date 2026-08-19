// MYTHOS PROD — FOURNISSEURS v1
// Dependencies: STORE.suppliers/saveSuppliers (app.js); esc (utils.js); browser DOM
var fournisseurFilterCategory = 'all';
var fournisseurSearchQuery = '';

function renderFournisseurs() {
  const el = document.getElementById('fournisseurs-list');
  let fournisseurs = STORE.suppliers();
  if (!fournisseurs.length) { el.innerHTML = '<div class="empty-state">Aucun fournisseur.</div>'; return; }

  // Appliquer les filtres
  fournisseurs = fournisseurs.filter(f => {
    // Filtre catégorie
    if (fournisseurFilterCategory !== 'all' && f.category !== fournisseurFilterCategory) return false;

    // Filtre recherche
    if (fournisseurSearchQuery) {
      const query = fournisseurSearchQuery.toLowerCase();
      if (!f.name.toLowerCase().includes(query) &&
          !f.contact.toLowerCase().includes(query) &&
          !(f.addr && f.addr.toLowerCase().includes(query))) {
        return false;
      }
    }

    return true;
  }).sort((a, b) => a.name.localeCompare(b.name));

  // Obtenir les catégories uniques
  const allFournisseurs = STORE.suppliers();
  const categories = ['all', ...new Set(allFournisseurs.filter(f => f.category).map(f => f.category))];

  let html = `<div style="padding:16px; background:linear-gradient(135deg, rgba(217,164,65,0.08), rgba(217,164,65,0.04)); border:1px solid rgba(217,164,65,0.15); border-radius:12px; margin-bottom:16px;">
    <div style="color:var(--gold); font-weight:700; margin-bottom:12px; font-size:13px;">🔍 RECHERCHER & FILTRER</div>
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(250px, 1fr)); gap:12px;">
      <div>
        <label style="color:var(--muted); font-size:11px; font-weight:700; margin-bottom:4px; display:block;">Rechercher par nom, contact ou adresse</label>
        <input type="text" id="fournisseur-search" placeholder="Tapez pour chercher..." value="${fournisseurSearchQuery}" oninput="setFournisseurSearch(this.value)" style="width:100%; padding:8px; background:#1a1a1a; color:#D9A441; border:1px solid var(--control-border); border-radius:6px;">
      </div>

      <div>
        <label style="color:var(--muted); font-size:11px; font-weight:700; margin-bottom:4px; display:block;">Filtrer par catégorie</label>
        <select id="fournisseur-filter-category" onchange="setFournisseurFilterCategory(this.value)" style="width:100%; padding:8px; background:#1a1a1a; color:#D9A441; border:1px solid var(--control-border); border-radius:6px;">
          <option value="all">📊 Toutes les catégories</option>
          ${categories.filter(c => c !== 'all').map(cat => `<option value="${cat}" ${fournisseurFilterCategory === cat ? 'selected' : ''}>${getFournisseurCategoryIcon(cat)} ${cat}</option>`).join('')}
        </select>
      </div>

      <div style="display:flex; align-items:flex-end;">
        <button class="btn btn-outline btn-sm" onclick="resetFournisseurFilters()" style="width:100%;">🔄 Réinitialiser</button>
      </div>
    </div>
    <div style="color:var(--muted); font-size:12px; margin-top:8px;">📌 ${fournisseurs.length} fournisseur(s) affichée(s)</div>
  </div>`;

  html += '<div style="width:100%; overflow-x:auto; -webkit-overflow-scrolling:touch; border-radius:12px;"><table class="fournisseurs-list-table" style="width:100%; table-layout:fixed; min-width:1000px;"><thead><tr style="background:#1a1a1a;"><th style="width:18%;padding:6px 8px;">Nom</th><th style="width:15%;padding:6px 8px;">Contact</th><th style="width:20%;padding:6px 8px;">Adresse</th><th style="width:15%;padding:6px 8px;">Catégorie</th><th style="width:32%;text-align:center;padding:6px 8px;">Actions</th></tr></thead><tbody>' +
  fournisseurs.map(f => {
    const catStyle = getFournisseurCategoryStyle(f.category);
    return `<tr style="cursor:pointer; border-left:4px solid ${catStyle.color}; background:${catStyle.bg};">
      <td style="padding:6px 8px;word-break:break-word;"><strong>${esc(f.name || 'Fournisseur')}</strong></td>
      <td style="padding:6px 8px;word-break:break-word;">${esc(f.contact || '')}</td>
      <td style="color:var(--muted);font-size:12px;padding:6px 8px;word-break:break-word;">${esc(f.addr || '')}</td>
      <td style="padding:6px 8px;word-break:break-word;"><span style="font-size:16px;margin-right:6px;">${catStyle.icon}</span><strong>${esc(f.category || '')}</strong></td>
      <td style="text-align:center;padding:6px 8px;" onclick="event.stopPropagation();">
        <button class="btn btn-outline btn-sm" style="margin:0 2px;" onclick="openFournisseurModal('${f.id}')" title="Modifier">✏️</button>
        <button class="btn btn-danger btn-sm" style="margin:0 2px;" onclick="deleteFournisseur('${f.id}')" title="Supprimer">✕</button>
      </td>
    </tr>`;
  }).join('') + '</tbody></table></div>';

  el.innerHTML = html;
}

function getFournisseurCategoryStyle(category) {
  const styles = {
    'Électronique': { icon: '💻', color: '#9b59b6', bg: 'rgba(155,89,182,0.1)' },
    'Matériel': { icon: '🔧', color: '#95a5a6', bg: 'rgba(149,165,166,0.1)' },
    'Décor': { icon: '🎨', color: '#e74c3c', bg: 'rgba(231,76,60,0.1)' },
    'Logistique': { icon: '🚚', color: '#D9A441', bg: 'rgba(217,164,65,0.1)' },
    'Services': { icon: '💼', color: '#3498db', bg: 'rgba(52,152,219,0.1)' },
    'Banque': { icon: '🏦', color: '#2ecc71', bg: 'rgba(46,204,113,0.1)' },
    'Hôtel': { icon: '🏨', color: '#e67e22', bg: 'rgba(230,126,34,0.1)' },
    'Télécommunications': { icon: '📱', color: '#64b4ff', bg: 'rgba(100,180,255,0.1)' },
    'Gasoil': { icon: '⛽', color: '#f1c40f', bg: 'rgba(241,196,15,0.1)' },
    'Finance': { icon: '💰', color: '#e74c3c', bg: 'rgba(231,76,60,0.1)' },
    'Mecanicien': { icon: '🔩', color: '#7f8c8d', bg: 'rgba(127,140,141,0.1)' },
    'Alimentaires': { icon: '🍎', color: '#3498db', bg: 'rgba(52,152,219,0.1)' }
  };
  return styles[category] || { icon: '📦', color: '#D9A441', bg: 'rgba(217,164,65,0.1)' };
}

function getFournisseurCategoryIcon(category) {
  const styles = getFournisseurCategoryStyle(category);
  return styles.icon;
}

function setFournisseurSearch(value) {
  fournisseurSearchQuery = value;
  renderFournisseurs();
}

function setFournisseurFilterCategory(value) {
  fournisseurFilterCategory = value;
  renderFournisseurs();
}

function resetFournisseurFilters() {
  fournisseurSearchQuery = '';
  fournisseurFilterCategory = 'all';
  document.getElementById('fournisseur-search').value = '';
  document.getElementById('fournisseur-filter-category').value = 'all';
  renderFournisseurs();
}

function openFournisseurModal(id = '') {
  const modal = document.getElementById('fournisseur-modal');
  if (!modal) {
    console.error('❌ ERROR: fournisseur-modal not found!');
    alert('❌ خطأ: النافذة غير موجودة. جرب تحديث الصفحة.');
    return;
  }

  document.getElementById('fournisseur-edit-id').value = '';
  ['fournisseur-nom', 'fournisseur-contact', 'fournisseur-immatricule', 'fournisseur-adresse', 'fournisseur-specialite', 'fournisseur-notes'].forEach(field => {
    const el = document.getElementById(field);
    if (el) el.value = '';
  });

  const f = STORE.suppliers().find(item => item.id === id);
  if (f) {
    document.getElementById('fournisseur-edit-id').value = f.id;
    document.getElementById('fournisseur-nom').value = f.name || '';
    document.getElementById('fournisseur-contact').value = f.contact || '';
    document.getElementById('fournisseur-immatricule').value = f.immatricule || '';
    document.getElementById('fournisseur-adresse').value = f.addr || '';
    document.getElementById('fournisseur-specialite').value = f.category || '';
    document.getElementById('fournisseur-notes').value = f.notes || '';
  }

  modal.style.display = 'flex';
}

function closeFournisseurModal() {
  document.getElementById('fournisseur-modal').style.display = 'none';
}

function saveFournisseur() {
  const id = document.getElementById('fournisseur-edit-id').value || 'fournisseur_' + Date.now();
  const f = {
    id,
    name: document.getElementById('fournisseur-nom').value.trim(),
    contact: document.getElementById('fournisseur-contact').value.trim(),
    immatricule: document.getElementById('fournisseur-immatricule').value.trim(),
    addr: document.getElementById('fournisseur-adresse').value.trim(),
    category: document.getElementById('fournisseur-specialite').value.trim(),
    notes: document.getElementById('fournisseur-notes').value.trim()
  };

  if (!f.name) { alert('Le nom du fournisseur est requis'); return; }

  let fournisseurs = STORE.suppliers();
  fournisseurs = fournisseurs.some(item => item.id === id) ? fournisseurs.map(item => item.id === id ? f : item) : fournisseurs.concat(f);
  STORE.saveSuppliers(fournisseurs);
  closeFournisseurModal();
  renderFournisseurs();
}

function deleteFournisseur(id) {
  if (!confirm('Supprimer ce fournisseur ?')) return;
  STORE.saveSuppliers(STORE.suppliers().filter(f => f.id !== id));
  renderFournisseurs();
}
