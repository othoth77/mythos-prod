// Mythos OS shared expenses CRUD, categories, reports, and page workflow.

let comptaExpenseFilter = 'month';

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

function setComptaExpenseFilter(value) { comptaExpenseFilter = value; renderExpensesPage(); }

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
