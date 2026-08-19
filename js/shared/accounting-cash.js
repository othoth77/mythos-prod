// Mythos OS shared cash entries CRUD and page workflow.

let comptaCashFilterStatus = 'all'; // 'all', 'expense', 'income', 'bank'
let comptaCashFilterMinAmount = 0;
let comptaCashFilterMaxAmount = Infinity;

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

  let html = `<div style="padding:16px; background:linear-gradient(135deg, rgba(217,164,65,0.08), rgba(217,164,65,0.04)); border:1px solid rgba(217,164,65,0.15); border-radius:12px; margin-bottom:16px;">
    <div style="color:var(--gold); font-weight:700; margin-bottom:12px; font-size:13px;">🔍 FILTRER LA CAISSE</div>
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:12px;">
      <div>
        <label style="color:var(--muted); font-size:11px; font-weight:700; margin-bottom:4px; display:block;">Type de Liaison</label>
        <select id="cash-filter-status" onchange="setComptaCashFilterStatus(this.value)" style="width:100%; padding:6px; background:#1a1a1a; color:#D9A441; border:1px solid #333; border-radius:6px;">
          <option value="all">📊 Tous</option>
          <option value="expense" ${comptaCashFilterStatus === 'expense' ? 'selected' : ''}>🔴 Dépenses</option>
          <option value="income" ${comptaCashFilterStatus === 'income' ? 'selected' : ''}>🟢 Revenus</option>
          <option value="bank" ${comptaCashFilterStatus === 'bank' ? 'selected' : ''}>💳 Virements</option>
          <option value="unlinked" ${comptaCashFilterStatus === 'unlinked' ? 'selected' : ''}>⚠️ Non liés</option>
        </select>
      </div>

      <div>
        <label style="color:var(--muted); font-size:11px; font-weight:700; margin-bottom:4px; display:block;">Montant Min</label>
        <input type="number" id="cash-filter-min" value="${comptaCashFilterMinAmount === 0 ? '' : comptaCashFilterMinAmount}" placeholder="0" onchange="setComptaCashFilterAmount()" style="width:100%; padding:6px; background:#1a1a1a; color:#D9A441; border:1px solid #333; border-radius:6px;">
      </div>

      <div>
        <label style="color:var(--muted); font-size:11px; font-weight:700; margin-bottom:4px; display:block;">Montant Max</label>
        <input type="number" id="cash-filter-max" value="${comptaCashFilterMaxAmount === Infinity ? '' : comptaCashFilterMaxAmount}" placeholder="∞" onchange="setComptaCashFilterAmount()" style="width:100%; padding:6px; background:#1a1a1a; color:#D9A441; border:1px solid #333; border-radius:6px;">
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
      <tr style="border-left:4px solid ${linked.color}; border-bottom:1px solid rgba(217,164,65,0.08);">
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
