// Mythos OS shared financial reports, reconciliation, and analytics workflow.

function generateMonthlyReport(year = null) {
  const today = todayStr();
  const selectedYear = year || today.slice(0, 4);

  const invs = STORE.invoices().filter(i => String(i.date || '').startsWith(selectedYear));
  const rdvs = STORE.rdvs().filter(r => String(r.date || '').startsWith(selectedYear)).map(normalizeRdv);
  const purchases = STORE.purchases().filter(p => String(p.date || '').startsWith(selectedYear));
  const expenses = STORE.expenses().filter(e => String(e.date || '').startsWith(selectedYear));

  const monthlyData = {};
  for (let m = 1; m <= 12; m++) {
    const month = String(m).padStart(2, '0');
    const monthStr = `${selectedYear}-${month}`;
    monthlyData[month] = {
      name: ['JAN', 'FEV', 'MAR', 'AVR', 'MAI', 'JUIN', 'JUIL', 'AOU', 'SEP', 'OCT', 'NOV', 'DEC'][m - 1],
      sales: invs.filter(i => String(i.date || '').startsWith(monthStr)).reduce((s, i) => s + getInvoiceTotal(i), 0),
      calendar: rdvs.filter(r => String(r.date || '').startsWith(monthStr)).reduce((s, r) => s + getRdvAmount(r), 0),
      purchases: purchases.filter(p => String(p.date || '').startsWith(monthStr)).reduce((s, p) => s + num(p.amount), 0),
      expenses: expenses.filter(e => String(e.date || '').startsWith(monthStr)).reduce((s, e) => s + num(e.amount), 0)
    };
  }

  const totalIncome = invs.reduce((s, i) => s + getInvoiceTotal(i), 0) + rdvs.reduce((s, r) => s + getRdvAmount(r), 0);
  const totalCosts = purchases.reduce((s, p) => s + num(p.amount), 0) + expenses.reduce((s, e) => s + num(e.amount), 0);
  const netProfit = totalIncome - totalCosts;

  return {
    year: selectedYear,
    monthly: monthlyData,
    totals: {
      income: totalIncome,
      purchases: purchases.reduce((s, p) => s + num(p.amount), 0),
      expenses: expenses.reduce((s, e) => s + num(e.amount), 0),
      netProfit
    },
    counts: {
      invoices: invs.length,
      rdvs: rdvs.length,
      purchases: purchases.length,
      expenses: expenses.length
    }
  };
}

function renderFinancialFlowDiagram() {
  const invs = STORE.invoices();
  const rdvs = STORE.rdvs().map(normalizeRdv);
  const purchases = STORE.purchases();
  const expenses = STORE.expenses();
  const bank = STORE.bankEntries();

  const sales = invs.reduce((s, i) => s + getInvoiceTotal(i), 0);
  const cal = rdvs.reduce((s, r) => s + getRdvAmount(r), 0);
  const totalIncome = sales + cal;
  const purchaseTotal = purchases.reduce((s, p) => s + num(p.amount), 0);
  const expenseTotal = expenses.reduce((s, e) => s + num(e.amount), 0);
  const lastBalance = bank.length ? num(bank.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)))[0].balance) : 0;
  const netResult = totalIncome - purchaseTotal - expenseTotal;

  return `
    <div style="margin-top:32px; padding:24px; background:linear-gradient(135deg, #1a2633, #0f1923); border:2px solid rgba(201,168,76,0.2); border-radius:12px;">
      <h3 style="font-family:'Playfair Display',serif; color:var(--gold-light); font-size:18px; margin:0 0 24px; font-weight:800;">💳 Flux de trésorerie</h3>
      <div style="display:flex; flex-direction:column; gap:16px;">
        <div style="display:flex; align-items:center; gap:12px;">
          <div style="flex:0 0 auto; width:60px; height:60px; background:linear-gradient(135deg, rgba(76,201,100,0.2), rgba(76,201,100,0.1)); border:2px solid #4cc964; border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:24px;">💰</div>
          <div style="flex:1;">
            <div style="color:var(--gold); font-weight:700; margin-bottom:4px;">Revenus entrants</div>
            <div style="display:flex; gap:12px;">
              <div style="flex:1; padding:8px; background:rgba(201,168,76,0.1); border-radius:6px; font-size:12px;">
                <div style="color:var(--muted);">Factures</div>
                <div style="color:#4cc964; font-weight:700;">${fmtMoney(sales)}</div>
              </div>
              <div style="flex:1; padding:8px; background:rgba(201,168,76,0.1); border-radius:6px; font-size:12px;">
                <div style="color:var(--muted);">Calendrier</div>
                <div style="color:#4cc964; font-weight:700;">${fmtMoney(cal)}</div>
              </div>
              <div style="flex:1; padding:8px; background:rgba(76,201,100,0.15); border-radius:6px; border:1px solid #4cc964; font-size:12px;">
                <div style="color:var(--muted);">Total</div>
                <div style="color:#4cc964; font-weight:700;">${fmtMoney(totalIncome)}</div>
              </div>
            </div>
          </div>
        </div>
        <div style="display:flex; align-items:stretch; gap:12px; margin-left:72px;">
          <div style="flex:1; padding:12px; background:linear-gradient(135deg, rgba(100,180,255,0.2), rgba(100,180,255,0.1)); border:2px solid rgba(100,180,255,0.3); border-radius:8px; font-size:12px;">
            <div style="color:#64b4ff; font-weight:700; margin-bottom:4px;">📄 Achats</div>
            <div style="color:var(--muted); font-size:11px; margin-bottom:4px;">${purchases.length} factures</div>
            <div style="color:#64b4ff; font-weight:700;">${fmtMoney(purchaseTotal)}</div>
          </div>
          <div style="flex:1; padding:12px; background:linear-gradient(135deg, rgba(255,100,150,0.2), rgba(255,100,150,0.1)); border:2px solid rgba(255,100,150,0.3); border-radius:8px; font-size:12px;">
            <div style="color:#ff6496; font-weight:700; margin-bottom:4px;">💳 Dépenses</div>
            <div style="color:var(--muted); font-size:11px; margin-bottom:4px;">${expenses.length} entrées</div>
            <div style="color:#ff6496; font-weight:700;">${fmtMoney(expenseTotal)}</div>
          </div>
          <div style="flex:1; padding:12px; background:linear-gradient(135deg, rgba(${netResult >= 0 ? '76,201,100' : '201,100,76'},0.2), rgba(${netResult >= 0 ? '76,201,100' : '201,100,76'},0.1)); border:2px solid ${netResult >= 0 ? '#4cc964' : '#ff6464'}; border-radius:8px; font-size:12px;">
            <div style="color:${netResult >= 0 ? '#4cc964' : '#ff6464'}; font-weight:700; margin-bottom:4px;">✓ Résultat</div>
            <div style="color:var(--muted); font-size:11px; margin-bottom:4px;">Revenu Net</div>
            <div style="color:${netResult >= 0 ? '#4cc964' : '#ff6464'}; font-weight:700;">${netResult >= 0 ? '+' : ''}${fmtMoney(netResult)}</div>
          </div>
        </div>
        <div style="padding:16px; background:linear-gradient(135deg, rgba(100,200,100,0.2), rgba(100,200,100,0.1)); border:2px solid rgba(100,200,100,0.3); border-radius:8px;">
          <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px;">
            <div>
              <div style="color:var(--gold); font-weight:700; margin-bottom:4px;">🏦 Solde bancaire BIAT</div>
              <div style="color:var(--muted);">Trésorerie actuelle</div>
            </div>
            <div style="text-align:right;">
              <div style="color:#64c864; font-family:'Playfair Display',serif; font-size:20px; font-weight:800;">${fmtMoney(lastBalance)}</div>
              <div style="color:var(--muted); font-size:10px;">${bank.length} mouvements</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderReconciliationPage() {
  const invs = STORE.invoices();
  const rdvs = STORE.rdvs().map(normalizeRdv);
  const expenses = STORE.expenses();
  const purchases = STORE.purchases();
  const bankEntries = STORE.bankEntries();
  const cashEntries = STORE.cashEntries ? STORE.cashEntries() : [];

  // Calculs
  const totalIncome = invs.reduce((s, i) => s + getInvoiceTotal(i), 0) + rdvs.reduce((s, r) => s + getRdvAmount(r), 0);
  const totalExpenses = expenses.reduce((s, e) => s + num(e.amount), 0);
  const totalPurchases = purchases.reduce((s, p) => s + num(p.amount), 0);
  const bankBalance = bankEntries.length ? num(bankEntries.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)))[0].balance) : 0;
  const cashTotal = cashEntries.reduce((s, c) => s + num(c.amount), 0);
  const totalCosts = totalExpenses + totalPurchases;
  const netProfit = totalIncome - totalCosts;

  // Liens
  const linkedExpenses = expenses.filter(e => bankEntries.some(b => b.linkedId === e.id && b.linkedType === 'expense') ||
                                                 cashEntries.some(c => c.linkedId === e.id && c.linkedType === 'expense')).length;
  const linkedInvoices = invs.filter(i => bankEntries.some(b => b.linkedId === i.id && b.linkedType === 'invoice') ||
                                           cashEntries.some(c => c.linkedId === i.id && c.linkedType === 'income')).length;

  return `
    <div style="padding:20px;">
      <h2 style="font-family:'Playfair Display',serif; color:var(--gold-light); font-size:20px; margin:0 0 24px; border-bottom:2px solid rgba(201,168,76,0.3); padding-bottom:12px; font-weight:800;">🔄 Réconciliation Comptable Complète</h2>

      <!-- Vue d'ensemble -->
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:16px; margin-bottom:32px;">
        <div style="padding:20px; background:linear-gradient(135deg, rgba(76,201,100,0.12), rgba(76,201,100,0.06)); border:2px solid rgba(76,201,100,0.2); border-radius:12px;">
          <div style="color:var(--muted); font-size:11px; text-transform:uppercase; font-weight:700; margin-bottom:8px;">💰 Revenus Total</div>
          <div style="font-family:'Playfair Display',serif; font-size:28px; color:#4cc964; font-weight:800;">${fmtMoney(totalIncome)}</div>
          <div style="color:var(--muted); font-size:12px; margin-top:8px;">${invs.length + rdvs.length} documents</div>
        </div>

        <div style="padding:20px; background:linear-gradient(135deg, rgba(255,100,150,0.12), rgba(255,100,150,0.06)); border:2px solid rgba(255,100,150,0.2); border-radius:12px;">
          <div style="color:var(--muted); font-size:11px; text-transform:uppercase; font-weight:700; margin-bottom:8px;">💳 Dépenses Total</div>
          <div style="font-family:'Playfair Display',serif; font-size:28px; color:#ff6496; font-weight:800;">${fmtMoney(totalCosts)}</div>
          <div style="color:var(--muted); font-size:12px; margin-top:8px;">${expenses.length + purchases.length} documents</div>
        </div>

        <div style="padding:20px; background:linear-gradient(135deg, rgba(${netProfit >= 0 ? '76,201,100' : '201,100,76'},0.12), rgba(${netProfit >= 0 ? '76,201,100' : '201,100,76'},0.06)); border:2px solid rgba(${netProfit >= 0 ? '76,201,100' : '201,100,76'},0.2); border-radius:12px;">
          <div style="color:var(--muted); font-size:11px; text-transform:uppercase; font-weight:700; margin-bottom:8px;">📊 Résultat Net</div>
          <div style="font-family:'Playfair Display',serif; font-size:28px; color:${netProfit >= 0 ? '#4cc964' : '#ff6464'}; font-weight:800;">${netProfit >= 0 ? '+' : ''}${fmtMoney(netProfit)}</div>
          <div style="color:var(--muted); font-size:12px; margin-top:8px;">Revenus - Dépenses</div>
        </div>

        <div style="padding:20px; background:linear-gradient(135deg, rgba(100,180,255,0.12), rgba(100,180,255,0.06)); border:2px solid rgba(100,180,255,0.2); border-radius:12px;">
          <div style="color:var(--muted); font-size:11px; text-transform:uppercase; font-weight:700; margin-bottom:8px;">🏦 Solde Bancaire</div>
          <div style="font-family:'Playfair Display',serif; font-size:28px; color:#64b4ff; font-weight:800;">${fmtMoney(bankBalance)}</div>
          <div style="color:var(--muted); font-size:12px; margin-top:8px;">${bankEntries.length} mouvements</div>
        </div>

        <div style="padding:20px; background:linear-gradient(135deg, rgba(201,168,76,0.12), rgba(201,168,76,0.06)); border:2px solid rgba(201,168,76,0.2); border-radius:12px;">
          <div style="color:var(--muted); font-size:11px; text-transform:uppercase; font-weight:700; margin-bottom:8px;">💵 Caisse</div>
          <div style="font-family:'Playfair Display',serif; font-size:28px; color:var(--gold-light); font-weight:800;">${fmtMoney(cashTotal)}</div>
          <div style="color:var(--muted); font-size:12px; margin-top:8px;">${cashEntries.length} entrées</div>
        </div>
      </div>

      <!-- État des liens -->
      <div style="padding:20px; background:linear-gradient(135deg, rgba(201,168,76,0.08), rgba(201,168,76,0.04)); border:2px solid rgba(201,168,76,0.15); border-radius:12px; margin-bottom:32px;">
        <h3 style="color:var(--gold-light); font-size:14px; margin:0 0 16px; font-weight:700;">📎 État des Liaisons</h3>
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:16px; font-size:12px;">
          <div style="padding:12px; background:rgba(0,0,0,0.3); border-radius:6px;">
            <div style="color:var(--gold); font-weight:700; margin-bottom:4px;">Revenus liés</div>
            <div style="color:#4cc964; font-size:16px; font-weight:800;">${linkedInvoices}/${invs.length + rdvs.length}</div>
            <div style="color:var(--muted); font-size:10px; margin-top:4px;">Au Banque ou Caisse</div>
          </div>
          <div style="padding:12px; background:rgba(0,0,0,0.3); border-radius:6px;">
            <div style="color:var(--gold); font-weight:700; margin-bottom:4px;">Dépenses liées</div>
            <div style="color:#ff6496; font-size:16px; font-weight:800;">${linkedExpenses}/${expenses.length}</div>
            <div style="color:var(--muted); font-size:10px; margin-top:4px;">Au Banque ou Caisse</div>
          </div>
          <div style="padding:12px; background:rgba(0,0,0,0.3); border-radius:6px;">
            <div style="color:var(--gold); font-weight:700; margin-bottom:4px;">Taux de lien</div>
            <div style="color:${((linkedInvoices + linkedExpenses) / (invs.length + rdvs.length + expenses.length) * 100) >= 80 ? '#4cc964' : '#ffa500'}; font-size:16px; font-weight:800;">
              ${((linkedInvoices + linkedExpenses) / (invs.length + rdvs.length + expenses.length) * 100).toFixed(1)}%
            </div>
            <div style="color:var(--muted); font-size:10px; margin-top:4px;">Documents liés</div>
          </div>
        </div>
      </div>

      <!-- Vérifications -->
      <div style="padding:20px; background:linear-gradient(135deg, rgba(201,168,76,0.08), rgba(201,168,76,0.04)); border:2px solid rgba(201,168,76,0.15); border-radius:12px;">
        <h3 style="color:var(--gold-light); font-size:14px; margin:0 0 16px; font-weight:700;">✓ Vérifications</h3>
        <div style="display:flex; flex-direction:column; gap:12px; font-size:12px;">
          <div style="padding:12px; background:rgba(0,0,0,0.3); border-radius:6px; border-left:4px solid ${bankBalance > 0 ? '#4cc964' : '#ffa500'};">
            <div style="color:${bankBalance > 0 ? '#4cc964' : '#ffa500'}; font-weight:700;">
              ${bankBalance > 0 ? '✓' : '⚠️'} Solde Bancaire: ${bankBalance > 0 ? 'Positif' : 'Attention'}
            </div>
            <div style="color:var(--muted); margin-top:4px;">Montant: ${fmtMoney(bankBalance)}</div>
          </div>

          <div style="padding:12px; background:rgba(0,0,0,0.3); border-radius:6px; border-left:4px solid ${cashTotal > 0 ? '#4cc964' : '#ffa500'};">
            <div style="color:${cashTotal > 0 ? '#4cc964' : '#ffa500'}; font-weight:700;">
              ${cashTotal > 0 ? '✓' : '⚠️'} Caisse: ${cashTotal > 0 ? 'Positive' : 'Vide/Attention'}
            </div>
            <div style="color:var(--muted); margin-top:4px;">Montant: ${fmtMoney(cashTotal)}</div>
          </div>

          <div style="padding:12px; background:rgba(0,0,0,0.3); border-radius:6px; border-left:4px solid ${netProfit > 0 ? '#4cc964' : '#ff6464'};">
            <div style="color:${netProfit > 0 ? '#4cc964' : '#ff6464'}; font-weight:700;">
              ${netProfit > 0 ? '✓' : '❌'} Résultat: ${netProfit > 0 ? 'Bénéficiaire' : 'Déficitaire'}
            </div>
            <div style="color:var(--muted); margin-top:4px;">Montant: ${netProfit >= 0 ? '+' : ''}${fmtMoney(netProfit)}</div>
          </div>

          <div style="padding:12px; background:rgba(0,0,0,0.3); border-radius:6px; border-left:4px solid #64b4ff;">
            <div style="color:#64b4ff; font-weight:700;">
              💼 Liquidité Totale (Banque + Caisse)
            </div>
            <div style="color:var(--muted); margin-top:4px;">Montant: ${fmtMoney(bankBalance + cashTotal)}</div>
          </div>
        </div>
      </div>
    </div>
  `;
  const el = document.getElementById('compta-reconciliation-page');
  if (el) {
    const html = `
      <div style="padding:20px;">
        <h2 style="font-family:'Playfair Display',serif; color:var(--gold-light); font-size:20px; margin:0 0 24px; border-bottom:2px solid rgba(201,168,76,0.3); padding-bottom:12px; font-weight:800;">🔄 Réconciliation Comptable Complète</h2>

        <!-- Vue d'ensemble -->
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:16px; margin-bottom:32px;">
          <div style="padding:20px; background:linear-gradient(135deg, rgba(76,201,100,0.12), rgba(76,201,100,0.06)); border:2px solid rgba(76,201,100,0.2); border-radius:12px;">
            <div style="color:var(--muted); font-size:11px; text-transform:uppercase; font-weight:700; margin-bottom:8px;">💰 Revenus Total</div>
            <div style="font-family:'Playfair Display',serif; font-size:28px; color:#4cc964; font-weight:800;">${fmtMoney(totalIncome)}</div>
            <div style="color:var(--muted); font-size:12px; margin-top:8px;">${invs.length + rdvs.length} documents</div>
          </div>

          <div style="padding:20px; background:linear-gradient(135deg, rgba(255,100,150,0.12), rgba(255,100,150,0.06)); border:2px solid rgba(255,100,150,0.2); border-radius:12px;">
            <div style="color:var(--muted); font-size:11px; text-transform:uppercase; font-weight:700; margin-bottom:8px;">💳 Dépenses Total</div>
            <div style="font-family:'Playfair Display',serif; font-size:28px; color:#ff6496; font-weight:800;">${fmtMoney(totalCosts)}</div>
            <div style="color:var(--muted); font-size:12px; margin-top:8px;">${expenses.length + purchases.length} documents</div>
          </div>

          <div style="padding:20px; background:linear-gradient(135deg, rgba(${netProfit >= 0 ? '76,201,100' : '201,100,76'},0.12), rgba(${netProfit >= 0 ? '76,201,100' : '201,100,76'},0.06)); border:2px solid rgba(${netProfit >= 0 ? '76,201,100' : '201,100,76'},0.2); border-radius:12px;">
            <div style="color:var(--muted); font-size:11px; text-transform:uppercase; font-weight:700; margin-bottom:8px;">📊 Résultat Net</div>
            <div style="font-family:'Playfair Display',serif; font-size:28px; color:${netProfit >= 0 ? '#4cc964' : '#ff6464'}; font-weight:800;">${netProfit >= 0 ? '+' : ''}${fmtMoney(netProfit)}</div>
            <div style="color:var(--muted); font-size:12px; margin-top:8px;">Revenus - Dépenses</div>
          </div>

          <div style="padding:20px; background:linear-gradient(135deg, rgba(100,180,255,0.12), rgba(100,180,255,0.06)); border:2px solid rgba(100,180,255,0.2); border-radius:12px;">
            <div style="color:var(--muted); font-size:11px; text-transform:uppercase; font-weight:700; margin-bottom:8px;">🏦 Solde Bancaire</div>
            <div style="font-family:'Playfair Display',serif; font-size:28px; color:#64b4ff; font-weight:800;">${fmtMoney(bankBalance)}</div>
            <div style="color:var(--muted); font-size:12px; margin-top:8px;">${bankEntries.length} mouvements</div>
          </div>

          <div style="padding:20px; background:linear-gradient(135deg, rgba(201,168,76,0.12), rgba(201,168,76,0.06)); border:2px solid rgba(201,168,76,0.2); border-radius:12px;">
            <div style="color:var(--muted); font-size:11px; text-transform:uppercase; font-weight:700; margin-bottom:8px;">💵 Caisse</div>
            <div style="font-family:'Playfair Display',serif; font-size:28px; color:var(--gold-light); font-weight:800;">${fmtMoney(cashTotal)}</div>
            <div style="color:var(--muted); font-size:12px; margin-top:8px;">${cashEntries.length} entrées</div>
          </div>
        </div>

        <!-- État des liens -->
        <div style="padding:20px; background:linear-gradient(135deg, rgba(201,168,76,0.08), rgba(201,168,76,0.04)); border:2px solid rgba(201,168,76,0.15); border-radius:12px; margin-bottom:32px;">
          <h3 style="color:var(--gold-light); font-size:14px; margin:0 0 16px; font-weight:700;">📎 État des Liaisons</h3>
          <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:16px; font-size:12px;">
            <div style="padding:12px; background:rgba(0,0,0,0.3); border-radius:6px;">
              <div style="color:var(--gold); font-weight:700; margin-bottom:4px;">Revenus liés</div>
              <div style="color:#4cc964; font-size:16px; font-weight:800;">${linkedInvoices}/${invs.length + rdvs.length}</div>
              <div style="color:var(--muted); font-size:10px; margin-top:4px;">Au Banque ou Caisse</div>
            </div>
            <div style="padding:12px; background:rgba(0,0,0,0.3); border-radius:6px;">
              <div style="color:var(--gold); font-weight:700; margin-bottom:4px;">Dépenses liées</div>
              <div style="color:#ff6496; font-size:16px; font-weight:800;">${linkedExpenses}/${expenses.length}</div>
              <div style="color:var(--muted); font-size:10px; margin-top:4px;">Au Banque ou Caisse</div>
            </div>
            <div style="padding:12px; background:rgba(0,0,0,0.3); border-radius:6px;">
              <div style="color:var(--gold); font-weight:700; margin-bottom:4px;">Taux de lien</div>
              <div style="color:${((linkedInvoices + linkedExpenses) / (invs.length + rdvs.length + expenses.length) * 100) >= 80 ? '#4cc964' : '#ffa500'}; font-size:16px; font-weight:800;">
                ${((linkedInvoices + linkedExpenses) / (invs.length + rdvs.length + expenses.length) * 100).toFixed(1)}%
              </div>
              <div style="color:var(--muted); font-size:10px; margin-top:4px;">Documents liés</div>
            </div>
          </div>
        </div>

        <!-- Vérifications -->
        <div style="padding:20px; background:linear-gradient(135deg, rgba(201,168,76,0.08), rgba(201,168,76,0.04)); border:2px solid rgba(201,168,76,0.15); border-radius:12px;">
          <h3 style="color:var(--gold-light); font-size:14px; margin:0 0 16px; font-weight:700;">✓ Vérifications</h3>
          <div style="display:flex; flex-direction:column; gap:12px; font-size:12px;">
            <div style="padding:12px; background:rgba(0,0,0,0.3); border-radius:6px; border-left:4px solid ${bankBalance > 0 ? '#4cc964' : '#ffa500'};">
              <div style="color:${bankBalance > 0 ? '#4cc964' : '#ffa500'}; font-weight:700;">
                ${bankBalance > 0 ? '✓' : '⚠️'} Solde Bancaire: ${bankBalance > 0 ? 'Positif' : 'Attention'}
              </div>
              <div style="color:var(--muted); margin-top:4px;">Montant: ${fmtMoney(bankBalance)}</div>
            </div>

            <div style="padding:12px; background:rgba(0,0,0,0.3); border-radius:6px; border-left:4px solid ${cashTotal > 0 ? '#4cc964' : '#ffa500'};">
              <div style="color:${cashTotal > 0 ? '#4cc964' : '#ffa500'}; font-weight:700;">
                ${cashTotal > 0 ? '✓' : '⚠️'} Caisse: ${cashTotal > 0 ? 'Positive' : 'Vide/Attention'}
              </div>
              <div style="color:var(--muted); margin-top:4px;">Montant: ${fmtMoney(cashTotal)}</div>
            </div>

            <div style="padding:12px; background:rgba(0,0,0,0.3); border-radius:6px; border-left:4px solid ${netProfit > 0 ? '#4cc964' : '#ff6464'};">
              <div style="color:${netProfit > 0 ? '#4cc964' : '#ff6464'}; font-weight:700;">
                ${netProfit > 0 ? '✓' : '❌'} Résultat: ${netProfit > 0 ? 'Bénéficiaire' : 'Déficitaire'}
              </div>
              <div style="color:var(--muted); margin-top:4px;">Montant: ${netProfit >= 0 ? '+' : ''}${fmtMoney(netProfit)}</div>
            </div>

            <div style="padding:12px; background:rgba(0,0,0,0.3); border-radius:6px; border-left:4px solid #64b4ff;">
              <div style="color:#64b4ff; font-weight:700;">
                💼 Liquidité Totale (Banque + Caisse)
              </div>
              <div style="color:var(--muted); margin-top:4px;">Montant: ${fmtMoney(bankBalance + cashTotal)}</div>
            </div>
          </div>
        </div>
      </div>
    `;
    el.innerHTML = html;
  }
}

function renderFinancialAnalyticsDashboard() {
  const report = generateMonthlyReport();
  const today = todayStr();
  const currentYear = today.slice(0, 4);

  return `
    <div style="margin-top:32px;">
      <h2 style="font-family:'Playfair Display',serif; color:var(--gold-light); font-size:20px; margin:0 0 20px; border-bottom:2px solid rgba(201,168,76,0.3); padding-bottom:12px; font-weight:800;">📈 Analyse financière annuelle ${report.year}</h2>

      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(240px, 1fr)); gap:16px; margin-bottom:32px;">
        <div style="padding:20px; background:linear-gradient(135deg, rgba(76,201,100,0.12), rgba(76,201,100,0.06)); border:1px solid rgba(76,201,100,0.2); border-radius:12px;">
          <div style="color:var(--muted); font-size:11px; text-transform:uppercase; font-weight:700; margin-bottom:8px;">Chiffre d'affaires</div>
          <div style="font-family:'Playfair Display',serif; font-size:28px; color:#4cc964; font-weight:800;">${fmtMoney(report.totals.income)}</div>
          <div style="color:var(--muted); font-size:12px; margin-top:8px;">${report.counts.invoices + report.counts.rdvs} documents</div>
        </div>

        <div style="padding:20px; background:linear-gradient(135deg, rgba(100,180,255,0.12), rgba(100,180,255,0.06)); border:1px solid rgba(100,180,255,0.2); border-radius:12px;">
          <div style="color:var(--muted); font-size:11px; text-transform:uppercase; font-weight:700; margin-bottom:8px;">Coûts (achats)</div>
          <div style="font-family:'Playfair Display',serif; font-size:28px; color:#64b4ff; font-weight:800;">${fmtMoney(report.totals.purchases)}</div>
          <div style="color:var(--muted); font-size:12px; margin-top:8px;">${report.counts.purchases} factures</div>
        </div>

        <div style="padding:20px; background:linear-gradient(135deg, rgba(255,100,150,0.12), rgba(255,100,150,0.06)); border:1px solid rgba(255,100,150,0.2); border-radius:12px;">
          <div style="color:var(--muted); font-size:11px; text-transform:uppercase; font-weight:700; margin-bottom:8px;">Dépenses</div>
          <div style="font-family:'Playfair Display',serif; font-size:28px; color:#ff6496; font-weight:800;">${fmtMoney(report.totals.expenses)}</div>
          <div style="color:var(--muted); font-size:12px; margin-top:8px;">${report.counts.expenses} entrées</div>
        </div>

        <div style="padding:20px; background:linear-gradient(135deg, rgba(${report.totals.netProfit >= 0 ? '76,201,100' : '201,100,76'},0.12), rgba(${report.totals.netProfit >= 0 ? '76,201,100' : '201,100,76'},0.06)); border:1px solid rgba(${report.totals.netProfit >= 0 ? '76,201,100' : '201,100,76'},0.2); border-radius:12px;">
          <div style="color:var(--muted); font-size:11px; text-transform:uppercase; font-weight:700; margin-bottom:8px;">Résultat net</div>
          <div style="font-family:'Playfair Display',serif; font-size:28px; color:${report.totals.netProfit >= 0 ? '#4cc964' : '#ff6464'}; font-weight:800;">${report.totals.netProfit >= 0 ? '+' : ''}${fmtMoney(report.totals.netProfit)}</div>
          <div style="color:var(--muted); font-size:12px; margin-top:8px;">Revenus - Coûts - Dépenses</div>
        </div>
      </div>

      <div style="padding:20px; background:linear-gradient(135deg, rgba(201,168,76,0.08), rgba(201,168,76,0.04)); border:1px solid rgba(201,168,76,0.15); border-radius:12px;">
        <h3 style="color:var(--gold-light); font-size:14px; margin:0 0 16px; font-weight:700;">📊 Synthèse mensuelle</h3>
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:12px; font-size:12px;">
          ${Object.keys(report.monthly).map(m => {
            const data = report.monthly[m];
            const monthTotal = data.sales + data.calendar;
            const bar = monthTotal > 0 ? (monthTotal / report.totals.income * 100) : 0;
            return `
              <div style="padding:10px; background:rgba(0,0,0,0.3); border-radius:6px;">
                <div style="color:var(--gold); font-weight:700; margin-bottom:4px;">${data.name}</div>
                <div style="background:rgba(201,168,76,0.1); height:4px; border-radius:2px; margin-bottom:4px; overflow:hidden;">
                  <div style="background:var(--gold); height:100%; width:${bar}%;"></div>
                </div>
                <div style="color:var(--muted); margin-bottom:2px;">💰 ${fmtMoney(monthTotal)}</div>
                <div style="color:var(--muted); font-size:10px;">Coûts: ${fmtMoney(data.purchases + data.expenses)}</div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    </div>
  `;
}
