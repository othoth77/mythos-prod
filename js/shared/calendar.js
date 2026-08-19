// MYTHOS PROD — CALENDRIER v1
// Rendering and filter state for the calendar view.
// Provides: calFilterMode, openRdvModal, setCalFilter,
//           _calDateLabel, _calDateSeparator, renderCalendrier, _calRenderItem
// Depends on: STORE (storage.js), utils.js globals (normalizeRdv, todayStr, etc.),
//             rappels.js globals (getRappels, getNextRappelDate, etc.),
//             app.js globals (rdvOpenForm, rdvEdit, rdvDelete) — resolved at call time.
// ══════════════════════════════════════════════════════════════════════

var calFilterMode = 'upcoming';

// ══════════════════════════════════════════════════════
// CALENDRIER — fonctions manquantes
// ══════════════════════════════════════════════════════

function openRdvModal() {
  rdvOpenForm();
}

function setCalFilter(mode, btn) {
  calFilterMode = mode;
  document.querySelectorAll('.btn-group button').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderCalendrier();
}

// ── Helpers pour les séparateurs de date ─────────────────────────────
function _calDateLabel(dateStr, today) {
  if (!dateStr) return '';
  var tomorrow = (function(){ var d = new Date(today); d.setDate(d.getDate()+1); return d.toISOString().slice(0,10); })();
  var yesterday = (function(){ var d = new Date(today); d.setDate(d.getDate()-1); return d.toISOString().slice(0,10); })();
  var jours = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
  var mois  = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
  var d = new Date(dateStr);
  var label = jours[d.getDay()] + ' ' + d.getDate() + ' ' + mois[d.getMonth()] + ' ' + d.getFullYear();
  if (dateStr === today)     return '● AUJOURD\'HUI — ' + label;
  if (dateStr === tomorrow)  return 'Demain — ' + label;
  if (dateStr === yesterday) return 'Hier — ' + label;
  return label;
}
function _calDateSeparator(dateStr, today) {
  var isToday = dateStr === today;
  var isPast  = dateStr < today;
  var color   = isToday ? '#d4af37' : (isPast ? '#374151' : '#4b5563');
  var textColor = isToday ? '#d4af37' : (isPast ? '#555' : '#666');
  var bgColor = isToday ? 'rgba(212,175,55,0.06)' : 'transparent';
  return '<div style="display:flex;align-items:center;gap:12px;margin:22px 0 12px;padding:8px 0 8px ' + (isToday?'12px':'0') + ';'
    + (isToday ? 'border-left:3px solid #d4af37;border-radius:0 6px 6px 0;background:' + bgColor + ';' : '')
    + '">'
    + '<span style="color:' + textColor + ';font-size:' + (isToday?'13px':'12px') + ';font-weight:' + (isToday?'800':'600') + ';letter-spacing:0.05em;text-transform:uppercase;">'
    + _calDateLabel(dateStr, today) + '</span>'
    + '<div style="flex:1;height:1px;background:' + color + ';opacity:0.25;"></div>'
    + '</div>';
}

function renderCalendrier() {
  var listEl = document.getElementById('cal-rdv-list');
  if (!listEl) return;

  var allRdvs = STORE.rdvs().map(normalizeRdv);
  var today   = todayStr();
  var rdvs    = allRdvs.slice();

  // ── Filtres mode ────────────────────────────────────────────────────
  if (calFilterMode === 'upcoming')    rdvs = rdvs.filter(function(r){ return r.date >= today; });
  else if (calFilterMode === 'today')  rdvs = rdvs.filter(function(r){ return r.date === today; });
  else if (calFilterMode === 'week')   rdvs = rdvs.filter(function(r){ return isDateInCurrentWeek(r.date); });
  else if (calFilterMode === 'month')  rdvs = rdvs.filter(function(r){ return r.date && r.date.slice(0,7) === today.slice(0,7); });
  else if (calFilterMode === 'past')   rdvs = rdvs.filter(function(r){ return r.date < today; });
  else if (calFilterMode === 'paid')   rdvs = rdvs.filter(function(r){ return isRdvPaid(r); });
  else if (calFilterMode === 'unpaid') rdvs = rdvs.filter(function(r){ return !isRdvPaid(r); });

  // ── Filtres texte/select ────────────────────────────────────────────
  var search     = (document.getElementById('cal-search')?.value || '').toLowerCase();
  var typeFilter = document.getElementById('cal-type-filter')?.value  || '';
  var collabFilt = document.getElementById('cal-collab-filter')?.value || '';
  var statusFilt = document.getElementById('cal-status-filter')?.value || '';

  if (search)     rdvs = rdvs.filter(function(r){ return [r.nature,r.client,r.lieu,r.notes].join(' ').toLowerCase().includes(search); });
  if (typeFilter) rdvs = rdvs.filter(function(r){ return r.nature === typeFilter; });
  if (collabFilt) rdvs = rdvs.filter(function(r){ return (r.collaborateur && r.collaborateur.nom || '') === collabFilt; });
  if (statusFilt) rdvs = rdvs.filter(function(r){ return (r.status || '') === statusFilt; });

  // ── Remplir dropdowns ───────────────────────────────────────────────
  var natures  = [...new Set(allRdvs.map(function(r){ return r.nature; }).filter(Boolean))].sort();
  var collabs  = [...new Set(allRdvs.map(function(r){ return r.collaborateur && r.collaborateur.nom || ''; }).filter(Boolean))].sort();
  var typeEl   = document.getElementById('cal-type-filter');
  if (typeEl && typeEl.options.length <= 1) natures.forEach(function(n){ typeEl.appendChild(new Option(n,n)); });
  var collabEl = document.getElementById('cal-collab-filter');
  if (collabEl && collabEl.options.length <= 1) collabs.forEach(function(c){ collabEl.appendChild(new Option(c,c)); });

  // ── Rappels ─────────────────────────────────────────────────────────
  var rappels = (typeof getRappels === 'function') ? getRappels() : [];
  var filteredRappels = rappels.map(function(rp) {
    var next = (typeof getNextRappelDate === 'function') ? getNextRappelDate(rp.dateDebut, rp.periode) : rp.dateDebut;
    return { _type: 'rappel', date: next || rp.dateDebut || '', rappel: rp };
  }).filter(function(item) { return !!item.date; });

  if (calFilterMode === 'upcoming')    filteredRappels = filteredRappels.filter(function(i){ return i.date >= today; });
  else if (calFilterMode === 'today')  filteredRappels = filteredRappels.filter(function(i){ return i.date === today; });
  else if (calFilterMode === 'week')   filteredRappels = filteredRappels.filter(function(i){ return isDateInCurrentWeek(i.date); });
  else if (calFilterMode === 'month')  filteredRappels = filteredRappels.filter(function(i){ return i.date && i.date.slice(0,7) === today.slice(0,7); });
  else if (calFilterMode === 'past')   filteredRappels = filteredRappels.filter(function(i){ return i.date < today; });
  else if (calFilterMode === 'paid' || calFilterMode === 'unpaid') filteredRappels = [];

  // ── Assembler tous les éléments ─────────────────────────────────────
  var allItems = rdvs.map(function(r){ return { _type: 'rdv', _isRappel: false, date: r.date, rdv: r }; })
    .concat(filteredRappels.map(function(i){ i._isRappel = true; return i; }));

  // ── Trier ───────────────────────────────────────────────────────────
  if (calFilterMode === 'past') {
    allItems.sort(function(a,b){ return String(b.date).localeCompare(String(a.date)); });
  } else {
    allItems.sort(function(a,b){ return String(a.date).localeCompare(String(b.date)); });
  }

  if (!allItems.length) {
    listEl.innerHTML = '<div style="text-align:center;padding:60px 20px;color:#333;">'
      + '<div style="font-size:40px;opacity:0.3;margin-bottom:12px;">📅</div>'
      + '<div style="font-size:14px;">Aucun élément pour ce filtre</div>'
      + '</div>';
    return;
  }

  // ── Grouper par date et rendre avec séparateurs ─────────────────────
  var html = '';
  var lastDate = null;

  allItems.forEach(function(item) {
    var itemDate = item.date || '';
    if (itemDate !== lastDate) {
      html += _calDateSeparator(itemDate, today);
      lastDate = itemDate;
    }
    // ── rendu de la carte ─────────────────────────────────────────────
    html += _calRenderItem(item, today);
  });

  listEl.innerHTML = html;
}

function _calRenderItem(item, today) {
    // ── CARTE RAPPEL ──────────────────────────────────────────────────
    if (item._isRappel) {
      var rp = item.rappel;
      var next = item.date;
      var isDue = next <= today;
      var isPastR = next < today;
      var isTodayR = next === today;
      var dateBgR    = isTodayR ? '#0d2a2a' : (isPastR ? '#1a1a2a' : '#0d2020');
      var dateColorR = isTodayR ? '#22d3ee' : (isPastR ? '#6b7280' : '#06b6d4');
      var cardR = (typeof calendarDateCard === 'function') ? calendarDateCard(next) : { day: next.slice(8,10), month: next.slice(5,7), jour: '' };
      return '<div data-cal-date="'+next+'" style="cursor:pointer;display:flex;align-items:stretch;background:#0a1a1e;border:1px solid '+(isTodayR?'#22d3ee':'#0e3340')+';border-left:4px solid '+(isDue?'#ef4444':'#06b6d4')+';border-radius:12px;margin-bottom:10px;overflow:hidden;transition:background 0.15s;" '
        + 'onclick="openRappelsListModal()" '
        + 'onmouseover="this.style.background=\'#0d2028\'" onmouseout="this.style.background=\'#0a1a1e\'">'
        + '<div style="background:'+dateBgR+';min-width:70px;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:14px 10px;border-right:1px solid #0e3340;flex-shrink:0;">'
          + '<div style="color:'+dateColorR+';font-size:28px;font-weight:400;line-height:1;font-family: \'IBM Plex Mono\', monospace;">'+cardR.day+'</div>'
          + '<div style="color:'+dateColorR+';font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;margin-top:2px;">'+cardR.month+'</div>'
          + '<div style="color:#06b6d4;font-size:10px;margin-top:4px;font-weight:600;">'+cardR.jour+'</div>'
        + '</div>'
        + '<div style="flex:1;padding:12px 14px;min-width:0;">'
          + '<div style="color:#a0f0fc;font-size:15px;font-weight:800;margin-bottom:4px;">&#128276; '+escapeHtml(rp.titre||'Rappel')+'</div>'
          + (rp.type ? '<div style="color:#06b6d4;font-size:12px;font-weight:600;margin-bottom:4px;">&#127991; '+escapeHtml(rp.type)+'</div>' : '')
          + '<div style="color:#4db8cc;font-size:11px;">'+(typeof periodeLabel==='function'?periodeLabel(rp.periode):rp.periode||'')+(rp.details?' &nbsp;·&nbsp; '+escapeHtml(rp.details.slice(0,60)):'')+'</div>'
        + '</div>'
        + '<div style="display:flex;flex-direction:column;align-items:flex-end;justify-content:center;padding:12px 14px;flex-shrink:0;">'
          + '<span style="font-size:10px;font-weight:700;padding:3px 10px;border-radius:20px;background:'+(isDue?'rgba(239,68,68,0.15)':'rgba(6,182,212,0.12)')+';color:'+(isDue?'#ef4444':'#06b6d4')+';">'+(isDue?'&#9888; DÛ':'&#128276; Rappel')+'</span>'
        + '</div>'
      + '</div>';
    }

    // ── CARTE RDV (original) ──────────────────────────────────────────
    var r = item.rdv;
    var card   = calendarDateCard(r.date);
    var paid   = isRdvPaid(r);
    var amt    = getRdvAmount(r);
    var isPast = r.date < today;
    var isToday = r.date === today;

    // Couleur badge date
    var dateBg    = isToday ? '#1a3a1a' : (isPast ? '#1a1a2a' : '#1a2a1a');
    var dateColor = isToday ? '#22c55e' : (isPast ? '#6b7280' : '#d4af37');
    var cardBorder = isToday ? '#22c55e' : (isPast ? '#2a2a2a' : '#2a3a2a');
    var cardBorderLeft = isToday ? '4px solid #22c55e' : (paid ? '4px solid #22c55e' : (isPast ? '4px solid #374151' : '4px solid #d4af37'));

    var lieu   = r.lieu || '';
    var collab = (r.collaborateur && r.collaborateur.nom) ? r.collaborateur.nom : '';
    var heure  = r.heure || '';

    return '<div data-cal-date="'+r.date+'" onclick="rdvEdit(\'' + r.id + '\')" style="cursor:pointer;display:flex;align-items:stretch;background:#111;border:1px solid ' + cardBorder + ';border-left:' + cardBorderLeft + ';border-radius:12px;margin-bottom:10px;overflow:hidden;transition:background 0.15s;" ' +
      'onmouseover="this.style.background=\'#1a1a1a\'" onmouseout="this.style.background=\'#111\'">' +

      // DATE BADGE — grand
      '<div style="background:' + dateBg + ';min-width:70px;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:14px 10px;border-right:1px solid ' + cardBorder + ';flex-shrink:0;">' +
        '<div style="color:' + dateColor + ';font-size:28px;font-weight:400;line-height:1;font-family: \'IBM Plex Mono\', monospace;">' + card.day + '</div>' +
        '<div style="color:' + dateColor + ';font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;margin-top:2px;">' + card.month + '</div>' +
        '<div style="color:' + (isToday ? '#22c55e' : '#666') + ';font-size:10px;margin-top:4px;font-weight:600;">' + card.jour + '</div>' +
      '</div>' +

      // CONTENU PRINCIPAL
      '<div style="flex:1;padding:12px 14px;min-width:0;">' +

        // LIEU — grand, principal
        (lieu
          ? '<div style="color:#e8e8e8;font-size:16px;font-weight:800;line-height:1.2;margin-bottom:5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">&#128205; ' + escapeHtml(lieu) + '</div>'
          : '<div style="color:#555;font-size:13px;font-style:italic;margin-bottom:5px;">Lieu non défini</div>') +

        // NATURE — moyen
        '<div style="color:#d4af37;font-size:13px;font-weight:600;margin-bottom:4px;">&#127917; ' + escapeHtml(r.nature || 'Rendez-vous') + (heure ? ' &nbsp;·&nbsp; &#128336; ' + heure : '') + '</div>' +

        // CLIENT + COLLAB — petit
        '<div style="display:flex;gap:10px;flex-wrap:wrap;">' +
          (r.client ? '<span style="color:#888;font-size:11px;">&#128100; ' + escapeHtml(r.client) + '</span>' : '') +
          (collab   ? '<span style="color:#888;font-size:11px;">&#129309; ' + escapeHtml(collab) + '</span>' : '') +
        '</div>' +

        // RAPPELS liés à ce RDV
        (function(){
          var rppls = getRappelsForRdv(r.id);
          if (!rppls.length) return '';
          var todayD = todayStr();
          return '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;">' +
            rppls.map(function(rp){
              var next = getNextRappelDate(rp.dateDebut, rp.periode);
              var isDue = next && next <= todayD;
              return '<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:' +
                (isDue ? 'rgba(239,68,68,0.15)' : 'rgba(245,158,11,0.12)') +
                ';color:' + (isDue ? '#ef4444' : '#f59e0b') + ';border:1px solid ' +
                (isDue ? 'rgba(239,68,68,0.3)' : 'rgba(245,158,11,0.25)') + ';">' +
                '&#128276; ' + escapeHtml(rp.titre) +
                (next ? ' · ' + formatDate(next) : '') +
                (isDue ? ' ⚠' : '') +
              '</span>';
            }).join('') +
          '</div>';
        })(r) +

      '</div>' +

      // DROITE — montant (si >0) + statut payé (si payé) + actions
      '<div style="display:flex;flex-direction:column;align-items:flex-end;justify-content:center;padding:12px 14px;flex-shrink:0;gap:6px;">' +
        (amt > 0 ? '<div style="color:' + (paid ? '#22c55e' : '#d4af37') + ';font-size:15px;font-weight:800;">' + fmtMoney(amt) + '</div>' : '') +
        (amt > 0 && paid ? '<div style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;background:rgba(34,197,94,0.12);color:#22c55e;">&#10003; Pay&eacute;</div>' : '') +
        '<div style="display:flex;gap:4px;" onclick="event.stopPropagation();">' +
          '<button class="btn btn-sm btn-outline" onclick="rdvEdit(\'' + r.id + '\')" title="Modifier" style="padding:5px 8px;">&#9998;</button>' +
          '<button class="btn btn-sm btn-danger"  onclick="rdvDelete(\'' + r.id + '\')" title="Supprimer" style="padding:5px 8px;">&times;</button>' +
        '</div>' +
      '</div>' +

    '</div>';
}
