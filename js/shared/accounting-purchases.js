// Mythos OS shared purchases CRUD, supplier synchronization, and page workflow.

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
