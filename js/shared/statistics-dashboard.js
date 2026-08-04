// Statistics dashboard extraction (Stage 4Y).
// Dependencies: STORE readers; normalizeRdv/getInvoiceTotal/getRdvAmount; num/fmtMoney/escapeHtml/_statKpi/_statMini.

function renderStatistique() {
  const el = document.getElementById('statistique-dashboard');
  if (!el) return;

  const invoices = STORE.invoices();
  const rdvs = STORE.rdvs().map(normalizeRdv);
  const clients = STORE.clients();
  const oms = STORE.oms();
  const representations = STORE.representations();
  const expenses = STORE.expenses();
  const bankEntries = STORE.bankEntries();
  const contracts = STORE.contracts ? STORE.contracts() : [];

  // ── Totaux globaux ──
  const invTotal = invoices.reduce((s, i) => s + getInvoiceTotal(i), 0);
  const invPaid = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + getInvoiceTotal(i), 0);
  const invUnpaid = invTotal - invPaid;
  const rdvTotal = rdvs.reduce((s, r) => s + getRdvAmount(r), 0);
  const repTotal = representations.reduce((s, r) => s + num(r.fee), 0);
  const expTotal = expenses.reduce((s, e) => s + num(e.amount), 0);
  const production = invTotal + rdvTotal;
  const pctPaid = invTotal > 0 ? Math.round((invPaid / invTotal) * 100) : 0;

  // ── Par mois (12 derniers mois) ──
  const monthsMap = {};
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    monthsMap[key] = { inv: 0, rdv: 0, exp: 0, label: d.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' }) };
  }
  invoices.forEach(inv => {
    const m = (inv.date || '').substring(0, 7);
    if (monthsMap[m]) monthsMap[m].inv += getInvoiceTotal(inv);
  });
  rdvs.forEach(rdv => {
    const m = (rdv.date || rdv.startDate || '').substring(0, 7);
    if (monthsMap[m]) monthsMap[m].rdv += getRdvAmount(rdv);
  });
  expenses.forEach(e => {
    const m = (e.date || '').substring(0, 7);
    if (monthsMap[m]) monthsMap[m].exp += num(e.amount);
  });
  const months = Object.values(monthsMap);

  // ── Top clients ──
  const clientTotals = {};
  invoices.forEach(inv => {
    const k = inv.clientName || 'Inconnu';
    clientTotals[k] = (clientTotals[k] || 0) + getInvoiceTotal(inv);
  });
  rdvs.forEach(rdv => {
    const k = rdv.clientName || 'Inconnu';
    clientTotals[k] = (clientTotals[k] || 0) + getRdvAmount(rdv);
  });
  const topClients = Object.entries(clientTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  const maxClient = topClients.length ? topClients[0][1] : 1;

  // ── Top mois ──
  const maxMonth = Math.max(...months.map(m => m.inv + m.rdv), 1);

  // ── Donut: Payé vs Impayé (SVG) ──
  function donut(paid, unpaid) {
    const total = paid + unpaid;
    if (total === 0) return '<circle cx="60" cy="60" r="45" fill="none" stroke="#333" stroke-width="14"/>';
    const paidPct = paid / total;
    const r = 45, cx = 60, cy = 60;
    const circumference = 2 * Math.PI * r;
    const paidDash = paidPct * circumference;
    const unpaidDash = circumference - paidDash;
    return '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="#2a2a2a" stroke-width="14"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="#22c55e" stroke-width="14" stroke-dasharray="' + paidDash.toFixed(1) + ' ' + unpaidDash.toFixed(1) + '" stroke-dashoffset="' + (circumference / 4).toFixed(1) + '" stroke-linecap="round"/>' +
      (unpaid > 0 ? '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="#ef4444" stroke-width="14" stroke-dasharray="' + unpaidDash.toFixed(1) + ' ' + paidDash.toFixed(1) + '" stroke-dashoffset="' + (circumference / 4 - paidDash).toFixed(1) + '" stroke-linecap="round"/>' : '');
  }

  // ── Bar chart: activité mensuelle ──
  function barChart() {
    const W = 560, H = 120, padL = 0, padR = 0, barW = Math.floor((W - padL - padR) / months.length) - 4;
    let bars = '';
    months.forEach((m, i) => {
      const total = m.inv + m.rdv;
      const barH = maxMonth > 0 ? Math.round((total / maxMonth) * (H - 24)) : 0;
      const x = padL + i * ((W - padL - padR) / months.length) + 2;
      const y = H - 20 - barH;
      bars += '<rect x="' + x.toFixed(1) + '" y="' + y + '" width="' + barW + '" height="' + barH + '" rx="3" fill="url(#barGrad)" opacity="0.85"/>';
      bars += '<text x="' + (x + barW / 2).toFixed(1) + '" y="' + (H - 4) + '" text-anchor="middle" font-size="9" fill="#666">' + m.label + '</text>';
      if (total > 0) bars += '<text x="' + (x + barW / 2).toFixed(1) + '" y="' + (y - 3) + '" text-anchor="middle" font-size="8" fill="#d4af37">' + (total >= 1000 ? (total / 1000).toFixed(1) + 'k' : Math.round(total)) + '</text>';
    });
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:' + H + 'px;">' +
      '<defs><linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#d4af37"/><stop offset="100%" stop-color="#92621a"/></linearGradient></defs>' +
      bars + '</svg>';
  }

  // ── Line chart: dépenses mensuelles ──
  function lineChart() {
    const W = 560, H = 80, n = months.length;
    const maxExp = Math.max(...months.map(m => m.exp), 1);
    const pts = months.map((m, i) => {
      const x = (i / (n - 1)) * W;
      const y = H - 10 - (m.exp / maxExp) * (H - 20);
      return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    const fill = months.map((m, i) => {
      const x = (i / (n - 1)) * W;
      const y = H - 10 - (m.exp / maxExp) * (H - 20);
      return x.toFixed(1) + ',' + y.toFixed(1);
    });
    const fillPath = 'M0,' + (H - 10) + ' L' + fill.join(' L') + ' L' + W + ',' + (H - 10) + ' Z';
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:' + H + 'px;">' +
      '<path d="' + fillPath + '" fill="rgba(239,68,68,0.08)"/>' +
      '<polyline points="' + pts + '" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
      months.map((m, i) => {
        const x = (i / (n - 1)) * W;
        const y = H - 10 - (m.exp / maxExp) * (H - 20);
        return '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="3" fill="#ef4444"/>';
      }).join('') +
      '</svg>';
  }

  // ── HTML complet ──
  el.innerHTML =

    // ── ROW 1: KPIs globaux ──
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-bottom:24px;">' +
      _statKpi('💰', 'Production totale', fmtMoney(production) + ' TND', '#d4af37') +
      _statKpi('✅', 'Factures payées', fmtMoney(invPaid) + ' TND', '#22c55e') +
      _statKpi('⚠️', 'Non payées', fmtMoney(invUnpaid) + ' TND', '#ef4444') +
      _statKpi('📅', 'Calendrier', fmtMoney(rdvTotal) + ' TND', '#60a5fa') +
      _statKpi('💸', 'Dépenses', fmtMoney(expTotal) + ' TND', '#fb923c') +
      _statKpi('🎭', 'Représentations', fmtMoney(repTotal) + ' TND', '#a78bfa') +
    '</div>' +

    // ── ROW 2: Donut + Bar chart ──
    '<div style="display:grid;grid-template-columns:200px 1fr;gap:20px;margin-bottom:24px;">' +

      // Donut
      '<div class="stat-section-card">' +
        '<div class="stat-section-title">Taux de recouvrement</div>' +
        '<div style="position:relative;width:120px;margin:12px auto;">' +
          '<svg viewBox="0 0 120 120" style="width:120px;height:120px;">' + donut(invPaid, invUnpaid) + '</svg>' +
          '<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;">' +
            '<div style="color:#d4af37;font-size:20px;font-weight:800;">' + pctPaid + '%</div>' +
            '<div style="color:#666;font-size:9px;">payé</div>' +
          '</div>' +
        '</div>' +
        '<div style="display:flex;gap:12px;justify-content:center;margin-top:8px;">' +
          '<span style="color:#22c55e;font-size:11px;">● Payé</span>' +
          '<span style="color:#ef4444;font-size:11px;">● Impayé</span>' +
        '</div>' +
        '<div style="margin-top:10px;text-align:center;">' +
          '<div style="color:#888;font-size:10px;">Solde net estimé</div>' +
          '<div style="color:#d4af37;font-weight:800;font-size:15px;">' + fmtMoney(invPaid - expTotal) + ' TND</div>' +
        '</div>' +
      '</div>' +

      // Bar chart
      '<div class="stat-section-card">' +
        '<div class="stat-section-title">Activité mensuelle — 12 derniers mois</div>' +
        '<div style="margin-top:10px;">' + barChart() + '</div>' +
        '<div style="display:flex;gap:16px;margin-top:8px;">' +
          '<span style="color:#d4af37;font-size:11px;">■ Factures + RDV</span>' +
        '</div>' +
      '</div>' +

    '</div>' +

    // ── ROW 3: Top clients + Line chart dépenses ──
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px;">' +

      // Top clients
      '<div class="stat-section-card">' +
        '<div class="stat-section-title">🏆 Top clients</div>' +
        (topClients.length === 0
          ? '<div class="db-empty">Aucune donnée</div>'
          : '<div style="margin-top:12px;">' +
            topClients.map(([ name, amt ], i) => {
              const pct = maxClient > 0 ? Math.round((amt / maxClient) * 100) : 0;
              const colors = ['#d4af37','#22c55e','#60a5fa','#a78bfa','#fb923c','#f472b6'];
              const color = colors[i % colors.length];
              return '<div style="margin-bottom:10px;">' +
                '<div style="display:flex;justify-content:space-between;margin-bottom:3px;">' +
                  '<span style="color:#ccc;font-size:12px;font-weight:600;max-width:60%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(name) + '</span>' +
                  '<span style="color:' + color + ';font-size:12px;font-weight:700;">' + fmtMoney(amt) + '</span>' +
                '</div>' +
                '<div style="background:#2a2a2a;border-radius:99px;height:5px;overflow:hidden;">' +
                  '<div style="background:' + color + ';height:100%;width:' + pct + '%;border-radius:99px;transition:width 0.5s;"></div>' +
                '</div>' +
              '</div>';
            }).join('') +
          '</div>') +
      '</div>' +

      // Dépenses line chart
      '<div class="stat-section-card">' +
        '<div class="stat-section-title">📉 Évolution des dépenses</div>' +
        '<div style="margin-top:10px;">' + lineChart() + '</div>' +
        '<div style="display:flex;justify-content:space-between;margin-top:10px;">' +
          '<div style="text-align:center;">' +
            '<div style="color:#888;font-size:10px;">Total dépenses</div>' +
            '<div style="color:#ef4444;font-weight:800;font-size:15px;">' + fmtMoney(expTotal) + ' TND</div>' +
          '</div>' +
          '<div style="text-align:center;">' +
            '<div style="color:#888;font-size:10px;">Nb dépenses</div>' +
            '<div style="color:#fb923c;font-weight:800;font-size:15px;">' + expenses.length + '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +

    '</div>' +

    // ── ROW 4: Récapitulatif général ──
    '<div class="stat-section-card">' +
      '<div class="stat-section-title">📋 Récapitulatif général</div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-top:14px;">' +
        _statMini('Factures', invoices.length, 'total') +
        _statMini('Clients', clients.length, 'actifs') +
        _statMini('Contrats', contracts.length, 'signés') +
        _statMini('Ordres mission', oms.length, 'émis') +
        _statMini('RDV Calendrier', rdvs.length, 'planifiés') +
        _statMini('Représentations', representations.length, 'enregistrées') +
      '</div>' +
    '</div>';
}

