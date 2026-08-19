// Mythos OS shared accounting overview and period workflow.

let comptaDashboardPeriod = 'all'; // 'all', 'year', 'month', 'week', 'day'

function filterByPeriod(items, dateField = 'date', period = comptaDashboardPeriod) {
  if (period === 'all') return items;
  const today = todayStr();
  const itemDate = (item) => String(item[dateField]);

  switch(period) {
    case 'day': return items.filter(i => itemDate(i) === today);
    case 'week': return items.filter(i => isDateInCurrentWeek(itemDate(i)));
    case 'month': return items.filter(i => itemDate(i).startsWith(today.slice(0, 7)));
    case 'year': return items.filter(i => itemDate(i).startsWith(today.slice(0, 4)));
    default: return items;
  }
}

function renderComptaViews() {
  const el = document.getElementById('compta-dashboard');
  if (!el) return;

  const invs = filterByPeriod(STORE.invoices());
  const purchases = filterByPeriod(STORE.purchases());
  const expenses = filterByPeriod(STORE.expenses());
  const bank = STORE.bankEntries();

  const sales = invs.reduce((s, i) => s + getInvoiceTotal(i), 0);
  const totalIncome = sales;
  const purchaseTotal = purchases.reduce((s, p) => s + num(p.amount), 0);
  const expenseTotal = expenses.reduce((s, e) => s + num(e.amount), 0);
  const lastBalance = bank.length ? num(bank.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)))[0].balance) : 0;
  const netResult = totalIncome - purchaseTotal - expenseTotal;

  const getPeriodLabel = (period) => {
    const labels = { all: 'Tout', year: 'Année', month: 'Mois', week: 'Semaine', day: 'Jour' };
    return labels[period] || period;
  };

  el.innerHTML = `
    <div style="margin-bottom:32px;">
      <div style="display:flex; gap:12px; flex-wrap:wrap; margin-bottom:20px;">
        ${['all', 'year', 'month', 'week', 'day'].map(p => `
          <button class="btn ${comptaDashboardPeriod === p ? 'btn-gold' : 'btn-outline'}" onclick="comptaDashboardPeriod='${p}'; renderComptaViews();" style="min-width:100px;">
            ${getPeriodLabel(p)}
          </button>
        `).join('')}
      </div>

      <h2 style="font-family:'Playfair Display',serif; color:var(--gold-light); font-size:20px; margin:0 0 16px; font-weight:800;">Résumé financier - ${getPeriodLabel(comptaDashboardPeriod)}</h2>

      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:16px; margin-bottom:32px;">
        <div style="background:linear-gradient(135deg, rgba(217,164,65,0.12), rgba(217,164,65,0.06)); border:1px solid rgba(217,164,65,0.2); border-radius:12px; padding:20px; text-align:center;">
          <div style="color:var(--muted); font-size:11px; text-transform:uppercase; font-weight:700; margin-bottom:8px;">Revenus Total</div>
          <div style="font-family:'Playfair Display',serif; font-size:32px; color:var(--gold-light); font-weight:800;">${fmtMoney(totalIncome)}</div>
          <div style="color:var(--muted); font-size:12px; margin-top:8px;">Factures: ${fmtMoney(sales)}</div>
        </div>

        <div style="background:linear-gradient(135deg, rgba(100,180,255,0.12), rgba(100,180,255,0.06)); border:1px solid rgba(100,180,255,0.2); border-radius:12px; padding:20px; text-align:center;">
          <div style="color:var(--muted); font-size:11px; text-transform:uppercase; font-weight:700; margin-bottom:8px;">Achats</div>
          <div style="font-family:'Playfair Display',serif; font-size:32px; color:#64b4ff; font-weight:800;">${fmtMoney(purchaseTotal)}</div>
          <div style="color:var(--muted); font-size:12px; margin-top:8px;">${purchases.length} facture${purchases.length !== 1 ? 's' : ''}</div>
        </div>

        <div style="background:linear-gradient(135deg, rgba(255,100,150,0.12), rgba(255,100,150,0.06)); border:1px solid rgba(255,100,150,0.2); border-radius:12px; padding:20px; text-align:center;">
          <div style="color:var(--muted); font-size:11px; text-transform:uppercase; font-weight:700; margin-bottom:8px;">Dépenses</div>
          <div style="font-family:'Playfair Display',serif; font-size:32px; color:#ff6496; font-weight:800;">${fmtMoney(expenseTotal)}</div>
          <div style="color:var(--muted); font-size:12px; margin-top:8px;">${expenses.length} dépense${expenses.length !== 1 ? 's' : ''}</div>
        </div>

        <div style="background:linear-gradient(135deg, rgba(${netResult >= 0 ? '76,201,100' : '201,100,76'},0.12), rgba(${netResult >= 0 ? '76,201,100' : '201,100,76'},0.06)); border:1px solid rgba(${netResult >= 0 ? '76,201,100' : '201,100,76'},0.2); border-radius:12px; padding:20px; text-align:center;">
          <div style="color:var(--muted); font-size:11px; text-transform:uppercase; font-weight:700; margin-bottom:8px;">Résultat Net</div>
          <div style="font-family:'Playfair Display',serif; font-size:32px; color:${netResult >= 0 ? '#4cc964' : '#ff6464'}; font-weight:800;">${netResult >= 0 ? '+' : ''}${fmtMoney(netResult)}</div>
          <div style="color:var(--muted); font-size:12px; margin-top:8px;">Revenus - Achats - Dépenses</div>
        </div>
      </div>

      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:16px; margin-bottom:32px;">
        <div style="background:linear-gradient(135deg, rgba(100,200,100,0.12), rgba(100,200,100,0.06)); border:1px solid rgba(100,200,100,0.2); border-radius:12px; padding:20px; text-align:center;">
          <div style="color:var(--muted); font-size:11px; text-transform:uppercase; font-weight:700; margin-bottom:8px;">Solde Bancaire</div>
          <div style="font-family:'Playfair Display',serif; font-size:28px; color:#64c864; font-weight:800;">${fmtMoney(lastBalance)}</div>
        </div>
      </div>
    </div>

    <div class="compta-link-grid" style="margin-bottom:32px;">
      <button class="compta-link-card" onclick="showView('compta-suppliers')"><div class="compta-link-head"><div class="compta-link-icon">F</div><div class="compta-link-arrow">></div></div><div class="compta-link-title">Liste des Fournisseurs</div><div class="compta-link-desc">Contacts, modes de paiement et categories.</div><div class="compta-link-meta">${STORE.suppliers().length} fournisseurs</div></button>
      <button class="compta-link-card blue" onclick="showView('compta-purchases')"><div class="compta-link-head"><div class="compta-link-icon">A</div><div class="compta-link-arrow">></div></div><div class="compta-link-title">Factures achats</div><div class="compta-link-desc">Achats et fournisseurs.</div><div class="compta-link-meta">${fmtMoney(purchases.reduce((s, p) => s + num(p.amount), 0))}</div></button>
      <button class="compta-link-card purple" onclick="showView('compta-expenses')"><div class="compta-link-head"><div class="compta-link-icon">D</div><div class="compta-link-arrow">></div></div><div class="compta-link-title">Depenses par periode</div><div class="compta-link-desc">Jour, semaine, mois et annee.</div><div class="compta-link-meta">${fmtMoney(expenses.reduce((s, e) => s + num(e.amount), 0))}</div></button>
      <button class="compta-link-card green" onclick="showView('compta-bank')"><div class="compta-link-head"><div class="compta-link-icon">B</div><div class="compta-link-arrow">></div></div><div class="compta-link-title">Extrait bancaire BIAT</div><div class="compta-link-desc">Mouvements et solde.</div><div class="compta-link-meta">${fmtMoney(lastBalance)}</div></button>
      <button class="compta-link-card gold" onclick="showView('compta-cash')"><div class="compta-link-head"><div class="compta-link-icon">C</div><div class="compta-link-arrow">></div></div><div class="compta-link-title">Gestion Caisse</div><div class="compta-link-desc">Entrées et sorties de caisse.</div><div class="compta-link-meta">${STORE.cashEntries ? STORE.cashEntries().length : 0} entrées</div></button>
      <button class="compta-link-card" onclick="showView('compta-reconciliation')" style="background:linear-gradient(135deg, rgba(217,164,65,0.15), rgba(217,164,65,0.08)); border:2px solid rgba(217,164,65,0.3);"><div class="compta-link-head"><div class="compta-link-icon" style="color:var(--gold-light); font-weight:800;">🔄</div><div class="compta-link-arrow">></div></div><div class="compta-link-title">Réconciliation Complète</div><div class="compta-link-desc">Tappabq shamilah - État financier.</div><div class="compta-link-meta">Banque + Caisse + Résultat</div></button>
    </div>

    <div class="compta-grid">
      <div class="compta-card"><div class="compta-title">Ventes</div><div class="compta-row"><span class="compta-label">Factures</span><span class="compta-value">${invs.length}</span></div><div class="compta-row"><span class="compta-label">Total TTC</span><span class="compta-value gold">${fmtMoney(sales)}</span></div></div>
      <div class="compta-card blue"><div class="compta-title">Achats</div><div class="compta-row"><span class="compta-label">Factures achats</span><span class="compta-value">${purchases.length}</span></div><div class="compta-row"><span class="compta-label">Total achats</span><span class="compta-value gold">${fmtMoney(purchaseTotal)}</span></div></div>
      <div class="compta-card purple"><div class="compta-title">Depenses</div><div class="compta-row"><span class="compta-label">Total</span><span class="compta-value gold">${fmtMoney(expenseTotal)}</span></div></div>
    </div>

    <div style="margin-top:32px; padding:24px; background:linear-gradient(135deg, rgba(217,164,65,0.05), rgba(217,164,65,0.02)); border:1px solid rgba(217,164,65,0.1); border-radius:12px;">
      <h3 style="font-family:'Playfair Display',serif; color:var(--gold-light); font-size:16px; margin:0 0 16px; font-weight:800;">📊 Connexions comptables</h3>
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(240px, 1fr)); gap:16px; font-size:13px; color:var(--muted);">
        <div>
          <div style="color:var(--gold); font-weight:700; margin-bottom:6px;">💰 Dépenses par période</div>
          <div style="line-height:1.6;">
            <div>→ Organisées par ${Object.keys(getExpenseCategories()).length} catégories</div>
            <div>→ ${STORE.expenses().length} entrées totales</div>
            <div>→ Filtrables par période</div>
          </div>
        </div>
        <div>
          <div style="color:var(--gold); font-weight:700; margin-bottom:6px;">📄 Factures achats</div>
          <div style="line-height:1.6;">
            <div>→ Liées à ${STORE.suppliers().length} fournisseurs</div>
            <div>→ ${purchases.length} factures</div>
            <div>→ Avec détail TVA</div>
          </div>
        </div>
        <div>
          <div style="color:var(--gold); font-weight:700; margin-bottom:6px;">🏦 Extrait BIAT</div>
          <div style="line-height:1.6;">
            <div>→ Solde actuel: ${fmtMoney(lastBalance)}</div>
            <div>→ ${bank.length} mouvements</div>
            <div>→ Connecté à la caisse</div>
          </div>
        </div>
        <div>
          <div style="color:var(--gold); font-weight:700; margin-bottom:6px;">🪙 Caisse</div>
          <div style="line-height:1.6;">
            <div>→ Retraits du compte BIAT</div>
            <div>→ Alimentation des dépenses</div>
            <div>→ Traçabilité complète</div>
          </div>
        </div>
      </div>
    </div>

    ${renderFinancialFlowDiagram()}`;
}
