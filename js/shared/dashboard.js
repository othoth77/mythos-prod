// MYTHOS PROD — DASHBOARD v1
// Dashboard statistics rendering and operational summary.
// Provides: updateDashboardStats, updateDashboardOperational
// Dependencies at call time: STORE.* (storage.js); normalizeRdv, todayStr, fmtMoney,
//   escapeHtml, formatDate, getInvoiceTotal, num (utils.js); editInvoice, rdvEdit (app.js)
// ══════════════════════════════════════════════════════════════════════

// ── DASHBOARD STATISTICS ──
function updateDashboardStats() {
  const invoices = STORE.invoices();
  const clients = STORE.clients();
  const oms = STORE.oms();
  const contracts = STORE.contracts ? STORE.contracts() : [];
  const bankEntries = STORE.bankEntries ? STORE.bankEntries() : [];
  const rdvs = STORE.rdvs ? STORE.rdvs().map(normalizeRdv) : [];

  // ── Financials ──
  const totalTTC = invoices.reduce((sum, inv) => sum + getInvoiceTotal(inv), 0);
  const paidInvs = invoices.filter(inv => inv.status === 'paid');
  const unpaidInvs = invoices.filter(inv => inv.status !== 'paid');
  const paidTotal = paidInvs.reduce((sum, inv) => sum + getInvoiceTotal(inv), 0);
  const unpaidTotal = unpaidInvs.reduce((sum, inv) => sum + getInvoiceTotal(inv), 0);

  // ── Bank balance: last entry balance ──
  const sortedBank = bankEntries.slice().sort((a,b) => String(b.date||'').localeCompare(String(a.date||'')));
  const lastBankBalance = sortedBank.length ? parseFloat(sortedBank[0].balance || 0) : null;

  // ── Date header ──
  const dateEl = document.getElementById('dashboard-date-display');
  if (dateEl) {
    const now = new Date();
    const days   = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
    const months = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
    const dayName = days[now.getDay()];
    const dayNum  = now.getDate();
    const month   = months[now.getMonth()];
    const year    = now.getFullYear();
    dateEl.innerHTML =
      '<div style="display:flex;flex-direction:column;justify-content:center;">'
        + '<div style="color:#444;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:0.18em;margin-bottom:2px;">'+dayName+'</div>'
        + '<div style="display:flex;align-items:baseline;gap:10px;">'
          + '<span style="color:#e8e8e8;font-size:54px;font-weight:900;font-family:\'Playfair Display\',serif;line-height:1;">'+dayNum+'</span>'
          + '<div style="display:flex;flex-direction:column;">'
            + '<span style="color:#d4af37;font-size:18px;font-weight:700;line-height:1.1;">'+month+'</span>'
            + '<span style="color:#555;font-size:13px;font-weight:500;">'+year+'</span>'
          + '</div>'
        + '</div>'
      + '</div>';
  }

  // ── KPI Cards ──
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

  set('dashboard-invoices', invoices.length);
  set('dashboard-amount', fmtMoney(totalTTC) + ' TND');
  set('dashboard-paid-count', paidInvs.length);
  set('dashboard-paid-amount', fmtMoney(paidTotal) + ' TND');
  set('dashboard-unpaid-count', unpaidInvs.length);
  set('dashboard-unpaid-amount', fmtMoney(unpaidTotal) + ' TND');
  set('dashboard-clients', clients.length);
  set('dashboard-contracts-count', contracts.length + ' contrat' + (contracts.length !== 1 ? 's' : ''));
  set('dashboard-oms', oms.length);
  set('dashboard-rdv-count', rdvs.length + ' RDV');

  if (lastBankBalance !== null) {
    set('dashboard-bank-balance', fmtMoney(lastBankBalance));
  } else {
    set('dashboard-bank-balance', '—');
  }

  // ── Recovery bar ──
  const pct = totalTTC > 0 ? Math.round((paidTotal / totalTTC) * 100) : 0;
  set('dashboard-recovery-pct', pct + '%');
  set('dashboard-recovery-paid-label', 'Payé: ' + fmtMoney(paidTotal) + ' TND');
  set('dashboard-recovery-unpaid-label', 'Impayé: ' + fmtMoney(unpaidTotal) + ' TND');
  const bar = document.getElementById('dashboard-recovery-bar');
  if (bar) setTimeout(() => { bar.style.width = pct + '%'; }, 80);

  // ── Recent invoices (last 5) ──
  const recentEl = document.getElementById('dashboard-recent-invoices');
  if (recentEl) {
    const recent = invoices.slice().sort((a,b) => String(b.date||'').localeCompare(String(a.date||''))).slice(0,5);
    if (!recent.length) {
      recentEl.innerHTML = '<div class="db-empty">Aucune facture.</div>';
    } else {
      recentEl.innerHTML = recent.map(inv => {
        const total = getInvoiceTotal(inv);
        const isPaid = inv.status === 'paid';
        const badge = isPaid
          ? '<span class="db-badge-paid">Payée</span>'
          : '<span class="db-badge-unpaid">Impayée</span>';
        return '<div class="db-recent-row" onclick="editInvoice(\'' + inv.id + '\')">' +
          '<div>' +
          '<div class="db-recent-name">' + escapeHtml(inv.clientName || inv.num || 'Client') + '</div>' +
          '<div class="db-recent-date">' + formatDate(inv.date) + ' · ' + escapeHtml(inv.num || '—') + '</div>' +
          '</div>' +
          '<div style="display:flex; align-items:center; gap:8px; flex-shrink:0;">' +
          '<span class="db-recent-amount">' + fmtMoney(total) + '</span>' +
          badge +
          '</div>' +
          '</div>';
      }).join('');
    }
  }

  // ── Upcoming RDVs (next 5 from today) ──
  const rdvEl = document.getElementById('dashboard-upcoming-rdvs');
  if (rdvEl) {
    const today = todayStr();
    const upcoming = rdvs
      .filter(r => (r.date || r.startDate || '') >= today)
      .sort((a,b) => String(a.date||a.startDate||'').localeCompare(String(b.date||b.startDate||'')))
      .slice(0, 5);
    if (!upcoming.length) {
      rdvEl.innerHTML = '<div class="db-empty">Aucun rendez-vous à venir.</div>';
    } else {
      rdvEl.innerHTML = upcoming.map(rdv => {
        const dateStr  = rdv.date || rdv.startDate || '';
        const lieu     = rdv.lieu || rdv.place || rdv.location || rdv.natureName || rdv.label || rdv.title || 'RDV';
        const client   = rdv.client || rdv.clientName || '';
        const nature   = rdv.nature || '';
        const heure    = rdv.heure || '';
        const isToday  = dateStr === today;
        const isPast   = dateStr < today;
        const dotColor = isToday ? '#22c55e' : (isPast ? '#374151' : '#d4af37');
        const dateParts = dateStr ? dateStr.split('-') : [];
        const dayNum    = dateParts[2] || '';
        const mNames    = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];
        const monShort  = dateParts[1] ? (mNames[parseInt(dateParts[1],10)-1]||'') : '';
        return '<div class="db-recent-row" onclick="rdvEdit(\''+rdv.id+'\')" style="display:flex;align-items:center;gap:10px;padding:8px 14px;border-bottom:1px solid #151515;cursor:pointer;transition:background 0.12s;" onmouseover="this.style.background=\'#181818\'" onmouseout="this.style.background=\'\'">'
          + '<div style="text-align:center;min-width:38px;flex-shrink:0;">'
            + '<div style="color:'+dotColor+';font-size:20px;font-weight:900;font-family:\'Playfair Display\',serif;line-height:1;">'+dayNum+'</div>'
            + '<div style="color:'+dotColor+';font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;">'+monShort+'</div>'
          + '</div>'
          + '<div style="flex:1;min-width:0;">'
            + '<div style="color:#ddd;font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+escapeHtml(lieu)+'</div>'
            + '<div style="color:#666;font-size:11px;margin-top:1px;">'
              + (nature ? escapeHtml(nature) : '')
              + (heure ? ' · '+heure : '')
              + (client ? ' · '+escapeHtml(client) : '')
            + '</div>'
          + '</div>'
          + (isToday ? '<span style="background:#052e16;color:#22c55e;border-radius:4px;padding:2px 6px;font-size:9px;font-weight:700;flex-shrink:0;">Aujourd\'hui</span>' : '')
        + '</div>';
      }).join('');
    }
  }
  updateDashboardOperational();
}

// ── DASHBOARD OPÉRATIONNEL ──────────────────────────────────────────
function updateDashboardOperational() {
  const today = todayStr();
  const thisMonth = today.slice(0, 7);
  const invoices = STORE.invoices();
  const rdvs = STORE.rdvs().map(normalizeRdv);
  const oms = STORE.oms();
  const contracts = STORE.contracts();
  const expenses = STORE.expenses();
  const cashEntries = STORE.cashEntries();
  const bankEntries = STORE.bankEntries();
  const representations = STORE.representations();
  const documents = STORE.documents();

  function row(label, val, color, view) {
    var onclick = view ? 'onclick="showView(\'' + view + '\')"' : '';
    return '<div class="db-op-row" ' + onclick + '>' +
      '<span class="db-op-label">' + label + '</span>' +
      '<span class="db-op-val" style="color:' + color + ';">' + val + '</span>' +
    '</div>';
  }
  function badge(label, txt, cls, view) {
    var onclick = view ? 'onclick="showView(\'' + view + '\')"' : '';
    return '<div class="db-op-row" ' + onclick + '>' +
      '<span class="db-op-label">' + label + '</span>' +
      '<span class="db-op-badge ' + cls + '">' + txt + '</span>' +
    '</div>';
  }
  function alert_(icon, msg, color, view) {
    var onclick = view ? 'onclick="showView(\'' + view + '\')"' : '';
    return '<div class="db-op-alert" style="background:' + color + '22;color:' + color + ';" ' + onclick + '>' +
      '<span>' + icon + '</span><span>' + msg + '</span>' +
    '</div>';
  }

  // ── AUJOURD'HUI ────────────────────────────────────────
  var todayRdvs = rdvs.filter(function(r){ return r.date === today; });
  var todayOms  = oms.filter(function(o){ return o.dateDepart === today || o.dateRetour === today; });
  var todayInvs = invoices.filter(function(i){ return i.status !== 'paid'; });
  var html = '';
  if (todayRdvs.length) {
    todayRdvs.slice(0, 3).forEach(function(r) {
      html += row('&#128197; ' + escapeHtml(r.nature || 'RDV') + (r.heure ? ' — ' + r.heure : ''), escapeHtml(r.client || ''), '#60a5fa', 'rendez-vous');
    });
  } else {
    html += '<div class="db-op-empty">Aucun rendez-vous aujourd\'hui</div>';
  }
  if (todayOms.length) {
    todayOms.slice(0, 2).forEach(function(o) {
      html += row('&#128663; ' + escapeHtml(o.destination || 'Mission'), o.dateDepart === today ? 'Départ' : 'Retour', '#fb923c', 'om-list');
    });
  }
  if (todayInvs.length) {
    html += badge('&#128196; ' + todayInvs.length + ' facture(s) à encaisser', todayInvs.length + ' en attente', 'orange', 'list');
  }
  { const _el = document.getElementById('db-today-content'); if (_el) _el.innerHTML = html || '<div class="db-op-empty">Journée calme &#128578;</div>'; }

  // ── À FAIRE ────────────────────────────────────────────
  var alerts = [];
  var unpaid = invoices.filter(function(i){ return i.status !== 'paid'; });
  if (unpaid.length) alerts.push(alert_('&#128196;', unpaid.length + ' facture(s) non payée(s)', '#ef4444', 'list'));

  var contractsNoPay = contracts.filter(function(c){ return c.status !== 'paid'; });
  if (contractsNoPay.length) alerts.push(alert_('&#9998;', contractsNoPay.length + ' contrat(s) sans paiement', '#fb923c', 'contracts'));

  var rdvUnconfirmed = rdvs.filter(function(r){ return r.date >= today && (!r.status || r.status === 'planned'); });
  if (rdvUnconfirmed.length) alerts.push(alert_('&#128197;', rdvUnconfirmed.length + ' RDV non confirmé(s)', '#f59e0b', 'rendez-vous'));

  if (!documents.length) alerts.push(alert_('&#128193;', 'Aucun document archivé', '#888', 'documentation'));

  // Vérifier dernière sauvegarde
  var lastSync = localStorage.getItem('mp_last_sync');
  if (!lastSync) {
    alerts.push(alert_('&#9729;', 'Pas de sauvegarde serveur', '#60a5fa', 'sauvegarde'));
  } else {
    var daysSince = Math.floor((Date.now() - new Date(lastSync)) / 86400000);
    if (daysSince > 3) alerts.push(alert_('&#9729;', 'Dernière sync il y a ' + daysSince + ' jours', '#60a5fa', 'sauvegarde'));
  }

  { const _el = document.getElementById('db-todo-content'); if (_el) _el.innerHTML = alerts.length
    ? alerts.join('')
    : '<div class="db-op-empty" style="color:#22c55e;">&#10004; Tout est en ordre !</div>'; }

  // ── ARGENT ─────────────────────────────────────────────
  var monthInvs = invoices.filter(function(i){ return (i.date || '').slice(0,7) === thisMonth && i.status === 'paid'; });
  var encaisse = monthInvs.reduce(function(s, i){ return s + getInvoiceTotal(i); }, 0);
  var impaye   = unpaid.reduce(function(s, i){ return s + getInvoiceTotal(i); }, 0);
  var depMois  = expenses.filter(function(e){ return (e.date||'').slice(0,7) === thisMonth; }).reduce(function(s,e){ return s+num(e.amount||e.montant||0); }, 0);

  // Caisse
  var cashSorted = cashEntries.slice().sort(function(a,b){ return String(b.date||'').localeCompare(String(a.date||'')); });
  var soldeCaisse = cashSorted.length ? num(cashSorted[0].balance || cashSorted[0].solde || 0) : 0;

  // Banque
  var bankSorted = bankEntries.slice().sort(function(a,b){ return String(b.date||'').localeCompare(String(a.date||'')); });
  var soldeBanque = bankSorted.length ? num(bankSorted[0].balance || 0) : 0;

  var benefice = encaisse - depMois;

  var moneyHtml =
    row('&#9989; Encaissé ce mois', fmtMoney(encaisse), '#22c55e', 'list') +
    row('&#9888; Non payé', fmtMoney(impaye), '#ef4444', 'list') +
    row('&#128176; Dépenses du mois', fmtMoney(depMois), '#fb923c', 'comptabilite') +
    row('&#128181; Solde caisse', fmtMoney(soldeCaisse), '#d4af37', 'compta-cash') +
    row('&#127981; Solde BIAT', fmtMoney(soldeBanque), '#a78bfa', 'compta-bank') +
    row('&#128200; Bénéfice estimé', fmtMoney(benefice), benefice >= 0 ? '#22c55e' : '#ef4444', '');

  { const _el = document.getElementById('db-money-content'); if (_el) _el.innerHTML = moneyHtml; }

  // ── PRODUCTION ─────────────────────────────────────────
  var reps = representations;
  var totalCachetsRep = reps.reduce(function(s,r){ return s+num(r.fee||0); }, 0);
  var collabs = STORE.collabs();
  var cachetsCollabs = collabs.reduce(function(s,c){ return s+num(c.fee||c.cachet||0); }, 0);

  // Spectacles actifs = contrats signés ce mois ou en cours
  var spectaclesActifs = contracts.filter(function(c){
    return c.status === 'active' || c.status === 'signed' || (!c.status && c.dateDebut && c.dateDebut >= thisMonth);
  });

  var revenusParSpec = reps.length > 0 ? totalCachetsRep / reps.length : 0;

  var prodHtml =
    row('&#10022; Représentations', reps.length + ' total', '#a78bfa', 'representations') +
    row('&#127942; Spectacles actifs', spectaclesActifs.length + ' en cours', '#60a5fa', 'contracts') +
    row('&#129309; Cachets collaborateurs', fmtMoney(cachetsCollabs), '#d4af37', 'collaborateurs') +
    row('&#128200; Revenus / représentation', fmtMoney(revenusParSpec), '#22c55e', '') +
    row('&#127917; Total productions', fmtMoney(totalCachetsRep), '#d4af37', 'representations');

  { const _el = document.getElementById('db-production-content'); if (_el) _el.innerHTML = prodHtml; }
}
