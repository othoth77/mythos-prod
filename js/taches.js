// ══════════════════════════════════════════════════════════════════════
// MYTHOS PROD — Gestionnaire de Tâches
// ══════════════════════════════════════════════════════════════════════

// ── STOCKAGE ────────────────────────────────────────────────────────

function getTaches() {
  if (typeof _storeGet === 'function') return _storeGet('mp_taches', '[]');
  try { return JSON.parse(localStorage.getItem('mp_taches') || '[]'); } catch(e) { return []; }
}
function saveTaches(list) {
  if (typeof _storeSave === 'function') { _storeSave('mp_taches', list); return; }
  try { localStorage.setItem('mp_taches', JSON.stringify(list)); } catch(e) {}
}

function _tchFmt(dt) {
  if (!dt) return '';
  var d = new Date(dt);
  var p = function(n){ return String(n).padStart(2,'0'); };
  return p(d.getDate())+'/'+p(d.getMonth()+1)+'/'+d.getFullYear();
}
function _tchToday() {
  var d = new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function _tchIsInWeek(dateStr) {
  if (!dateStr) return false;
  var d = new Date(dateStr), now = new Date();
  var start = new Date(now); start.setDate(now.getDate() - now.getDay());
  var end   = new Date(start); end.setDate(start.getDate() + 6);
  return d >= start && d <= end;
}

// ── TYPES ────────────────────────────────────────────────────────────

var TCH_TYPES = {
  simple:     { label: 'Simple',     color: '#22c55e', bg: '#052e16', borderLeft: '#22c55e', icon: '○' },
  importante: { label: 'Importante', color: '#f59e0b', bg: '#2d1800', borderLeft: '#f59e0b', icon: '◎' },
  urgente:    { label: 'Urgente',    color: '#ef4444', bg: '#2d0606', borderLeft: '#ef4444', icon: '●' }
};
var TCH_ORDER = ['urgente','importante','simple'];

// ── TOAST ────────────────────────────────────────────────────────────

function _tchToast(msg, type) {
  type = type || 'success';
  var accent = { success:'#22c55e', error:'#ef4444', info:'#06b6d4', warn:'#d4af37' }[type] || '#06b6d4';
  var t = document.createElement('div');
  t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(8px);z-index:99999;'
    + 'background:#1c1c1c;color:#e0e0e0;border-left:3px solid '+accent+';padding:10px 18px;'
    + 'border-radius:8px;font-size:13px;box-shadow:0 4px 20px rgba(0,0,0,0.7);'
    + 'opacity:0;transition:opacity 0.2s,transform 0.2s;white-space:nowrap;';
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(function(){ t.style.opacity='1'; t.style.transform='translateX(-50%) translateY(0)'; });
  setTimeout(function(){ t.style.opacity='0'; setTimeout(function(){ t.remove(); }, 250); }, 2600);
}

// ── MODAL CRÉATION / ÉDITION ─────────────────────────────────────────

function tachesOpenModal(id) {
  var existing = document.getElementById('tch-modal');
  if (existing) existing.remove();

  var taches = getTaches();
  var tache  = id ? taches.find(function(t){ return t.id === id; }) : null;

  var m = document.createElement('div');
  m.id = 'tch-modal';
  m.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);'
    + 'z-index:20000;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;';

  var typeHtml = ['simple','importante','urgente'].map(function(k){
    var tp = TCH_TYPES[k];
    var sel = ((tache ? tache.type : 'simple') === k) ? 'checked' : '';
    return '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;padding:7px 14px;border-radius:6px;'
      + 'border:1px solid '+(sel?tp.color:'#2a2a2a')+';background:'+(sel?tp.bg:'transparent')+';'
      + 'transition:all 0.15s;" onclick="tachesTypeSelect(this,\''+k+'\')">'
      + '<input type="radio" name="tch-type" value="'+k+'" '+sel+' style="accent-color:'+tp.color+';width:14px;height:14px;">'
      + '<span style="color:'+tp.color+';font-size:13px;font-weight:700;">'+tp.icon+' '+tp.label+'</span>'
      + '</label>';
  }).join('');

  m.innerHTML =
    '<div style="background:#141414;width:100%;max-width:560px;border-radius:16px;border:1px solid #252525;'
      + 'display:flex;flex-direction:column;max-height:92vh;box-shadow:0 8px 40px rgba(0,0,0,0.8);">'
      + '<div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;'
        + 'background:#181818;border-bottom:1px solid #252525;border-radius:16px 16px 0 0;flex-shrink:0;">'
        + '<h3 style="color:#d4af37;margin:0;font-size:15px;font-weight:700;">📋 '+(tache?'Modifier la tâche':'Nouvelle tâche')+'</h3>'
        + '<div style="display:flex;align-items:center;gap:8px;">'
          + '<button onclick="document.getElementById(\'tch-modal\').remove();if(typeof showView===\'function\')showView(\'tache\');" '
            + 'style="background:#1a1a1a;border:1px solid #2a2a2a;color:#d4af37;font-size:12px;font-weight:600;cursor:pointer;border-radius:6px;padding:5px 11px;">📋 Mes Tâches</button>'
          + '<button onclick="document.getElementById(\'tch-modal\').remove()" '
            + 'style="background:none;border:none;color:#555;font-size:22px;cursor:pointer;line-height:1;padding:0 4px;">&times;</button>'
        + '</div>'
      + '</div>'
      + '<div style="flex:1;overflow-y:auto;padding:20px;display:flex;flex-direction:column;gap:16px;">'
        + '<div>'
          + '<label style="display:block;color:#666;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;">Type de tâche</label>'
          + '<div style="display:flex;gap:8px;flex-wrap:wrap;">'+typeHtml+'</div>'
        + '</div>'
        + '<div>'
          + '<label style="display:block;color:#666;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">À faire avant <span style="color:#444;font-weight:400;">(optionnel — si date, apparaît dans le Calendrier)</span></label>'
          + '<input type="date" id="tch-due" value="'+(tache&&tache.dueDate?tache.dueDate:'')+'" '
            + 'style="background:#0a0a0a;border:1px solid #2a2a2a;border-radius:6px;padding:8px 12px;color:#e0e0e0;'
            + 'font-size:14px;outline:none;width:100%;box-sizing:border-box;" '
            + 'onfocus="this.style.borderColor=\'#06b6d4\'" onblur="this.style.borderColor=\'#2a2a2a\'">'
        + '</div>'
        + '<div style="flex:1;display:flex;flex-direction:column;">'
          + '<label style="display:block;color:#666;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">Note</label>'
          + '<textarea id="tch-note" placeholder="Écris ta tâche ici… texte court ou long paragraphe." rows="8" '
            + 'style="background:#0a0a0a;border:1px solid #2a2a2a;border-radius:6px;padding:10px 12px;color:#e0e0e0;'
            + 'font-size:14px;line-height:1.6;outline:none;width:100%;box-sizing:border-box;resize:vertical;min-height:120px;font-family:inherit;" '
            + 'onfocus="this.style.borderColor=\'#06b6d4\'" onblur="this.style.borderColor=\'#2a2a2a\'">'+(tache?tache.note:'')+'</textarea>'
        + '</div>'
      + '</div>'
      + '<div style="display:flex;justify-content:flex-end;gap:8px;padding:14px 20px;border-top:1px solid #1a1a1a;flex-shrink:0;flex-wrap:wrap;">'
        + (tache ? '<button onclick="tachesDelete(\''+id+'\')" class="btn btn-danger" style="margin-right:auto;">🗑 Supprimer</button>' : '')
        + (tache ? '<button id="tch-pin-btn" onclick="tachesTogglePin(\''+id+'\')" '
            + 'style="background:'+(tache.pinned?'rgba(212,175,55,0.15)':'#1a1a1a')+';border:1px solid '+(tache.pinned?'#d4af37':'#2a2a2a')+';'
            + 'color:'+(tache.pinned?'#d4af37':'#555')+';font-size:12px;font-weight:600;cursor:pointer;border-radius:6px;padding:5px 12px;transition:all 0.2s;">'
            + (tache.pinned ? '📌 Épinglé' : '📌 Épingler') + '</button>' : '')
        + '<button onclick="document.getElementById(\'tch-modal\').remove()" class="btn btn-outline">Annuler</button>'
        + '<button onclick="tachesSave(\''+( tache ? id : '')+'\');" class="btn btn-gold">💾 Enregistrer</button>'
      + '</div>'
    + '</div>';

  document.body.appendChild(m);
  m.addEventListener('click', function(e){ if (e.target === m) m.remove(); });
  document.addEventListener('keydown', function esc(e){ if(e.key==='Escape'){ m.remove(); document.removeEventListener('keydown',esc); }});
  setTimeout(function(){ var n=document.getElementById('tch-note'); if(n) n.focus(); }, 80);
}

function tachesTypeSelect(label, val) {
  document.querySelectorAll('#tch-modal label[onclick]').forEach(function(l){
    var k  = l.querySelector('input[type=radio]').value;
    var tp = TCH_TYPES[k];
    var me = (k === val);
    l.style.borderColor = me ? tp.color : '#2a2a2a';
    l.style.background  = me ? tp.bg    : 'transparent';
  });
  var inp = document.querySelector('#tch-modal input[value="'+val+'"]');
  if (inp) inp.checked = true;
}

function tachesSave(id) {
  var note = (document.getElementById('tch-note').value || '').trim();
  if (!note) { _tchToast('Écris une note pour cette tâche.', 'error'); return; }
  var due    = document.getElementById('tch-due').value  || '';
  var typeEl = document.querySelector('#tch-modal input[name="tch-type"]:checked');
  var type   = typeEl ? typeEl.value : 'simple';

  var taches = getTaches();
  if (id) {
    var idx = taches.findIndex(function(t){ return t.id === id; });
    if (idx >= 0) {
      taches[idx].note      = note;
      taches[idx].dueDate   = due;
      taches[idx].type      = type;
      taches[idx].updatedAt = new Date().toISOString();
      // pinned est préservé — modifié uniquement via tachesTogglePin
    }
  } else {
    taches.push({ id:'tch_'+Date.now(), note:note, dueDate:due, type:type,
      done:false, doneAt:null, archived:false, pinned:false, createdAt:new Date().toISOString() });
  }
  saveTaches(taches);
  document.getElementById('tch-modal').remove();
  _tchToast(id ? 'Tâche modifiée ✓' : 'Tâche enregistrée ✓', 'success');
  _tchRefreshAll();
}

function tachesTogglePin(id) {
  var taches = getTaches();
  var t = taches.find(function(x){ return x.id === id; });
  if (!t) return;
  t.pinned = !t.pinned;
  t.updatedAt = new Date().toISOString();
  saveTaches(taches);

  // Mettre à jour le bouton dans le modal sans le fermer
  var btn = document.getElementById('tch-pin-btn');
  if (btn) {
    btn.textContent = t.pinned ? '📌 Épinglé' : '📌 Épingler';
    btn.style.background  = t.pinned ? 'rgba(212,175,55,0.15)' : '#1a1a1a';
    btn.style.borderColor = t.pinned ? '#d4af37' : '#2a2a2a';
    btn.style.color       = t.pinned ? '#d4af37' : '#555';
  }
  _tchToast(t.pinned ? '📌 Tâche épinglée' : 'Tâche désépinglée', t.pinned ? 'warn' : 'info');
  _tchRefreshAll();
}

function tachesMarkDone(id) {
  var taches = getTaches();
  var t = taches.find(function(x){ return x.id === id; });
  if (!t) return;
  t.done = true; t.doneAt = new Date().toISOString(); t.archived = true;
  saveTaches(taches);
  _tchToast('Tâche terminée ✓', 'success');
  _tchRefreshAll();
}

function tachesDelete(id) {
  if (!confirm('Supprimer cette tâche ?')) return;
  saveTaches(getTaches().filter(function(t){ return t.id !== id; }));
  var m = document.getElementById('tch-modal'); if (m) m.remove();
  _tchToast('Tâche supprimée', 'warn');
  _tchRefreshAll();
}

function tachesUnarchive(id) {
  var taches = getTaches();
  var t = taches.find(function(x){ return x.id === id; });
  if (!t) return;
  t.done = false; t.doneAt = null; t.archived = false;
  saveTaches(taches);
  _tchToast('Tâche remise en cours', 'info');
  _tchRefreshAll();
}

// ── MODAL ARCHIVE ────────────────────────────────────────────────────

function tachesOpenArchive() {
  var ex = document.getElementById('tch-archive-modal'); if (ex) ex.remove();
  var taches = getTaches().filter(function(t){ return t.archived; })
    .sort(function(a,b){ return (b.doneAt||'').localeCompare(a.doneAt||''); });

  var m = document.createElement('div');
  m.id = 'tch-archive-modal';
  m.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);'
    + 'z-index:20000;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;';

  var rows = taches.length === 0
    ? '<div style="text-align:center;padding:40px;color:#333;font-size:13px;">Aucune tâche archivée</div>'
    : taches.map(function(t){
        var tp = TCH_TYPES[t.type] || TCH_TYPES.simple;
        return '<div style="padding:12px 14px;border-bottom:1px solid #141414;display:flex;align-items:flex-start;gap:10px;">'
          + '<span style="background:'+tp.bg+';color:'+tp.color+';border-radius:4px;padding:2px 7px;font-size:10px;font-weight:700;white-space:nowrap;flex-shrink:0;">'+tp.icon+' '+tp.label+'</span>'
          + '<div style="flex:1;min-width:0;">'
            + '<div style="color:#666;font-size:12px;white-space:pre-wrap;word-break:break-word;">'+_tchEsc(t.note)+'</div>'
            + '<div style="color:#333;font-size:10px;margin-top:4px;">Terminé le '+_tchFmt(t.doneAt)+(t.dueDate?' · Échéance '+_tchFmt(t.dueDate):'')+'</div>'
          + '</div>'
          + '<button onclick="tachesUnarchive(\''+t.id+'\')" style="background:#1a1a1a;color:#888;border:1px solid #2a2a2a;border-radius:4px;padding:3px 8px;font-size:11px;cursor:pointer;flex-shrink:0;">↺</button>'
        + '</div>';
      }).join('');

  m.innerHTML = '<div style="background:#141414;width:100%;max-width:560px;border-radius:16px;border:1px solid #252525;'
    + 'max-height:90vh;display:flex;flex-direction:column;box-shadow:0 8px 40px rgba(0,0,0,0.8);">'
    + '<div style="display:flex;align-items:center;justify-content:space-between;padding:14px 20px;background:#181818;border-bottom:1px solid #252525;border-radius:16px 16px 0 0;flex-shrink:0;">'
      + '<h3 style="color:#888;margin:0;font-size:14px;font-weight:700;">🗂 Archive — Tâches terminées ('+taches.length+')</h3>'
      + '<button onclick="document.getElementById(\'tch-archive-modal\').remove()" style="background:none;border:none;color:#555;font-size:22px;cursor:pointer;line-height:1;">&times;</button>'
    + '</div>'
    + '<div style="flex:1;overflow-y:auto;">'+rows+'</div>'
    + '</div>';

  document.body.appendChild(m);
  m.addEventListener('click', function(e){ if (e.target === m) m.remove(); });
}

// ── CARTE TÂCHE POUR CALENDRIER ──────────────────────────────────────

function _tchCalCard(t) {
  var today   = _tchToday();
  var tp      = TCH_TYPES[t.type] || TCH_TYPES.simple;
  var overdue = t.dueDate && t.dueDate < today;
  var isToday = t.dueDate === today;
  var notePreview = t.note.length > 200 ? t.note.slice(0,197)+'…' : t.note;

  // Date badge — même format que les cartes RDV
  var day   = t.dueDate ? t.dueDate.slice(8,10) : '--';
  var month = t.dueDate ? _tchMonthShort(t.dueDate) : '';
  var jour  = t.dueDate ? _tchDayName(t.dueDate) : '';

  var dateBg    = isToday ? tp.bg : (overdue ? '#1a0808' : '#0d0d0d');
  var dateColor = tp.color;
  var cardBg    = t.archived ? '#0a0a0a' : '#0d0d0d';
  var opacity   = t.archived ? '0.6' : '1';

  return '<div data-cal-date="'+t.dueDate+'" data-tch-id="'+t.id+'" '
    + 'style="cursor:pointer;display:flex;align-items:stretch;background:'+cardBg+';border:1px solid '+(isToday?tp.color:'#1e1e1e')+';'
    + 'border-left:4px solid '+tp.borderLeft+';border-radius:12px;margin-bottom:10px;overflow:hidden;'
    + 'opacity:'+opacity+';transition:background 0.15s;" '
    + 'onclick="tachesOpenModal(\''+t.id+'\')" '
    + 'onmouseover="this.style.background=\'#181818\'" onmouseout="this.style.background=\''+cardBg+'\'">'
    // Date badge
    + '<div style="background:'+dateBg+';min-width:70px;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:14px 10px;border-right:1px solid #1e1e1e;flex-shrink:0;">'
      + '<div style="color:'+dateColor+';font-size:28px;font-weight:400;line-height:1;font-family: \'IBM Plex Mono\', monospace;">'+day+'</div>'
      + '<div style="color:'+dateColor+';font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;margin-top:2px;">'+month+'</div>'
      + '<div style="color:'+dateColor+';font-size:10px;margin-top:4px;font-weight:600;">'+jour+'</div>'
    + '</div>'
    // Contenu
    + '<div style="flex:1;padding:12px 14px;min-width:0;">'
      + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap;">'
        + '<span style="background:'+tp.bg+';color:'+tp.color+';border-radius:4px;padding:2px 8px;font-size:11px;font-weight:700;">'+tp.icon+' '+tp.label+'</span>'
        + (overdue ? '<span style="color:#ef4444;font-size:11px;font-weight:700;">⚠ En retard</span>' : '')
        + (isToday ? '<span style="color:'+tp.color+';font-size:11px;font-weight:700;">● Aujourd\'hui</span>' : '')
        + (t.archived ? '<span style="color:#22c55e;font-size:11px;">✓ Terminé le '+_tchFmt(t.doneAt)+'</span>' : '')
      + '</div>'
      + '<div style="color:#ccc;font-size:13px;line-height:1.5;white-space:pre-wrap;word-break:break-word;">'+_tchEsc(notePreview)+'</div>'
    + '</div>'
    // Actions
    + '<div style="display:flex;flex-direction:column;align-items:flex-end;justify-content:center;gap:8px;padding:12px 14px;flex-shrink:0;">'
      + (!t.archived ? '<button onclick="event.stopPropagation();tachesMarkDone(\''+t.id+'\')" title="Marquer terminée" '
          + 'style="width:30px;height:30px;border-radius:50%;border:2px solid '+tp.color+';background:transparent;'
          + 'color:'+tp.color+';font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;'
          + 'transition:all 0.2s;" onmouseover="this.style.background=\''+tp.bg+'\'" onmouseout="this.style.background=\'transparent\'">✓</button>'
        : '<button onclick="event.stopPropagation();tachesUnarchive(\''+t.id+'\')" title="Remettre en cours" '
          + 'style="background:#111;color:#888;border:1px solid #2a2a2a;border-radius:5px;padding:3px 8px;font-size:11px;cursor:pointer;">↺</button>')
    + '</div>'
  + '</div>';
}

function _tchMonthShort(dateStr) {
  var months = ['JAN','FÉV','MAR','AVR','MAI','JUN','JUL','AOÛ','SEP','OCT','NOV','DÉC'];
  return months[parseInt(dateStr.slice(5,7),10)-1] || '';
}
function _tchDayName(dateStr) {
  var days = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];
  return days[new Date(dateStr).getDay()] || '';
}

// ── INTÉGRATION CALENDRIER — tri par date ────────────────────────────

function renderTachesInCalendrier() {
  var listEl = document.getElementById('cal-rdv-list');
  if (!listEl) return;

  var today  = _tchToday();
  var mode   = (typeof calFilterMode !== 'undefined') ? calFilterMode : 'all';
  var taches = getTaches();

  // Sélectionner les tâches selon le filtre
  var filtered;
  if (mode === 'paid' || mode === 'unpaid') {
    filtered = []; // non applicable aux tâches
  } else if (mode === 'past') {
    filtered = taches.filter(function(t){ return t.archived && t.dueDate; });
  } else {
    // Seulement les tâches actives AVEC une date (sans date → pas dans la liste filtrée)
    filtered = taches.filter(function(t){ return !t.archived && !!t.dueDate; });
    if (mode === 'upcoming')   filtered = filtered.filter(function(t){ return t.dueDate >= today; });
    else if (mode === 'today') filtered = filtered.filter(function(t){ return t.dueDate === today; });
    else if (mode === 'week')  filtered = filtered.filter(function(t){ return _tchIsInWeek(t.dueDate); });
    else if (mode === 'month') filtered = filtered.filter(function(t){ return t.dueDate.slice(0,7) === today.slice(0,7); });
    // 'all' : toutes les actives avec date
  }

  if (!filtered.length) return; // rien à ajouter

  // Construire les cartes HTML
  var taskHtml = filtered.map(function(t){ return { date: t.dueDate || '9999', html: _tchCalCard(t) }; });

  // Récupérer les cartes existantes avec leur date (data-cal-date ajouté par app.js)
  var existingCards = Array.from(listEl.querySelectorAll('[data-cal-date]'));

  if (existingCards.length === 0) {
    // Liste vide ou empty-state : remplacer
    listEl.innerHTML = '';
    taskHtml.sort(function(a,b){ return a.date.localeCompare(b.date); });
    taskHtml.forEach(function(t){ listEl.insertAdjacentHTML('beforeend', t.html); });
    return;
  }

  // Insérer chaque tâche au bon endroit (tri par date)
  taskHtml.forEach(function(task) {
    var taskEl = document.createElement('div');
    taskEl.innerHTML = task.html;
    var card = taskEl.firstElementChild;

    var inserted = false;
    var allCards = Array.from(listEl.querySelectorAll('[data-cal-date]'));
    var isPast = (mode === 'past');

    for (var i = 0; i < allCards.length; i++) {
      var cardDate = allCards[i].getAttribute('data-cal-date') || '9999';
      if (isPast ? task.date > cardDate : task.date <= cardDate) {
        listEl.insertBefore(card, allCards[i]);
        inserted = true;
        break;
      }
    }
    if (!inserted) listEl.appendChild(card);
  });
}

// ── PAGE DÉDIÉE #tache ───────────────────────────────────────────────

function renderTachePage() {
  var el = document.getElementById('tache-page-content');
  if (!el) return;

  var today    = _tchToday();
  var taches   = getTaches();
  var active   = taches.filter(function(t){ return !t.archived; });
  var archived = taches.filter(function(t){ return t.archived; });

  // Tri actives : épinglées en 1er, puis urgente > importante > simple, puis par date
  active.sort(function(a,b){
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    var oa = TCH_ORDER.indexOf(a.type), ob = TCH_ORDER.indexOf(b.type);
    if (oa !== ob) return oa - ob;
    if (!a.dueDate && !b.dueDate) return 0;
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate.localeCompare(b.dueDate);
  });

  var counts = { urgente:0, importante:0, simple:0 };
  active.forEach(function(t){ if (counts[t.type] !== undefined) counts[t.type]++; });

  // Stats
  var statsHtml = '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px;">'
    + Object.keys(TCH_TYPES).map(function(k){
        var tp = TCH_TYPES[k]; var n = counts[k] || 0;
        return '<div style="background:'+tp.bg+';border:1px solid '+tp.color+'44;border-radius:10px;padding:12px 18px;min-width:100px;text-align:center;">'
          + '<div style="color:'+tp.color+';font-size:24px;font-weight:900;">'+n+'</div>'
          + '<div style="color:'+tp.color+'aa;font-size:11px;font-weight:700;margin-top:2px;">'+tp.icon+' '+tp.label+(n>1?'s':'')+'</div>'
        + '</div>';
      }).join('')
    + '<div style="background:#111;border:1px solid #2a2a2a;border-radius:10px;padding:12px 18px;min-width:100px;text-align:center;">'
      + '<div style="color:#888;font-size:24px;font-weight:900;">'+archived.length+'</div>'
      + '<div style="color:#555;font-size:11px;font-weight:700;margin-top:2px;">🗂 Terminées</div>'
    + '</div>'
  + '</div>';

  // Tâches actives — tableau
  var activeHtml;
  if (!active.length) {
    activeHtml = '<div style="text-align:center;padding:50px 20px;color:#333;background:#0d0d0d;border:1px solid #1a1a1a;border-radius:12px;margin-bottom:20px;">'
      + '<div style="font-size:36px;opacity:0.3;">📋</div>'
      + '<div style="margin-top:10px;font-size:13px;">Aucune tâche en cours</div>'
    + '</div>';
  } else {
    activeHtml = '<div style="background:#0d0d0d;border:1px solid #1e1e1e;border-radius:12px;overflow:hidden;margin-bottom:20px;">'
      + '<div style="padding:10px 14px;background:#161616;border-bottom:1px solid #1e1e1e;display:flex;align-items:center;justify-content:space-between;">'
        + '<span style="color:#d4af37;font-size:12px;font-weight:700;">📋 Tâches en cours — '+active.length+'</span>'
      + '</div>'
      + active.map(function(t){
          var tp = TCH_TYPES[t.type] || TCH_TYPES.simple;
          var overdue = t.dueDate && t.dueDate < today;
          var pinBorder = t.pinned ? 'border-left:3px solid #d4af37;' : '';
          return '<div style="display:flex;align-items:flex-start;gap:10px;padding:14px;border-bottom:1px solid #141414;'
            + pinBorder
            + 'background:'+(t.pinned?'rgba(212,175,55,0.04)':(overdue?'#1a0808':''))+';transition:background 0.15s;" '
            + 'onmouseover="this.style.background=\''+(overdue?'#220808':'#161616')+'\';" onmouseout="this.style.background=\''+(t.pinned?'rgba(212,175,55,0.04)':(overdue?'#1a0808':''))+'\'">'
            + '<div style="flex-shrink:0;padding-top:2px;">'
              + '<button onclick="tachesMarkDone(\''+t.id+'\')" title="Marquer terminée" '
                + 'style="width:24px;height:24px;border-radius:50%;border:2px solid '+tp.color+';background:transparent;'
                + 'color:'+tp.color+';font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all 0.2s;" '
                + 'onmouseover="this.style.background=\''+tp.bg+'\'" onmouseout="this.style.background=\'transparent\'">✓</button>'
            + '</div>'
            + '<div style="flex:1;min-width:0;">'
              + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap;">'
                + (t.pinned ? '<span style="color:#d4af37;font-size:13px;" title="Épinglée">📌</span>' : '')
                + '<span style="background:'+tp.bg+';color:'+tp.color+';border-radius:4px;padding:2px 8px;font-size:10px;font-weight:700;">'+tp.icon+' '+tp.label+'</span>'
                + (t.dueDate ? '<span style="color:'+(overdue?'#ef4444':'#666')+';font-size:11px;">'+(overdue?'⚠ En retard · ':'')+_tchFmt(t.dueDate)+'</span>' : '<span style="color:#333;font-size:11px;font-style:italic;">Pas de date</span>')
              + '</div>'
              + '<div style="color:#ccc;font-size:13px;line-height:1.6;white-space:pre-wrap;word-break:break-word;">'+_tchEsc(t.note)+'</div>'
            + '</div>'
            + '<button onclick="tachesOpenModal(\''+t.id+'\')" title="Modifier" '
              + 'style="background:none;border:none;color:#444;font-size:16px;cursor:pointer;padding:0;flex-shrink:0;margin-top:2px;">✏</button>'
          + '</div>';
        }).join('')
    + '</div>';
  }

  // Archive
  var archHtml = '';
  if (archived.length) {
    archived.sort(function(a,b){ return (b.doneAt||'').localeCompare(a.doneAt||''); });
    archHtml = '<div style="background:#0d0d0d;border:1px solid #1e1e1e;border-radius:12px;overflow:hidden;">'
      + '<div style="padding:10px 14px;background:#161616;border-bottom:1px solid #1e1e1e;">'
        + '<span style="color:#555;font-size:12px;font-weight:700;">🗂 Archive — '+archived.length+' terminée'+(archived.length>1?'s':'')+'</span>'
      + '</div>'
      + archived.map(function(t){
          var tp = TCH_TYPES[t.type] || TCH_TYPES.simple;
          return '<div style="display:flex;align-items:flex-start;gap:10px;padding:12px 14px;border-bottom:1px solid #141414;opacity:0.65;">'
            + '<span style="color:#22c55e;font-size:16px;flex-shrink:0;margin-top:2px;">✓</span>'
            + '<div style="flex:1;min-width:0;">'
              + '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">'
                + '<span style="background:'+tp.bg+';color:'+tp.color+';border-radius:4px;padding:1px 6px;font-size:10px;font-weight:700;">'+tp.icon+' '+tp.label+'</span>'
                + '<span style="color:#333;font-size:10px;">Terminé le '+_tchFmt(t.doneAt)+'</span>'
              + '</div>'
              + '<div style="color:#888;font-size:12px;line-height:1.5;white-space:pre-wrap;word-break:break-word;">'+_tchEsc(t.note.slice(0,120)+(t.note.length>120?'…':''))+'</div>'
            + '</div>'
            + '<button onclick="tachesUnarchive(\''+t.id+'\')" title="Remettre en cours" '
              + 'style="background:#111;color:#555;border:1px solid #222;border-radius:4px;padding:3px 8px;font-size:11px;cursor:pointer;flex-shrink:0;">↺</button>'
          + '</div>';
        }).join('')
    + '</div>';
  }

  el.innerHTML = statsHtml + activeHtml + archHtml;
}

// ── WIDGET DASHBOARD ─────────────────────────────────────────────────

function renderTachesDashboard() {
  var zone = document.getElementById('dash-taches-zone');
  if (!zone) return;

  var today  = _tchToday();
  var active = getTaches().filter(function(t){ return !t.archived; });
  active.sort(function(a,b){
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    var oa = TCH_ORDER.indexOf(a.type), ob = TCH_ORDER.indexOf(b.type);
    if (oa !== ob) return oa - ob;
    return (a.dueDate||'9999').localeCompare(b.dueDate||'9999');
  });

  var urgentCount  = active.filter(function(t){ return t.type === 'urgente'; }).length;
  var pinnedCount  = active.filter(function(t){ return t.pinned; }).length;

  if (!active.length) {
    zone.innerHTML = '<div style="background:#0d0d0d;border:1px solid #1a1a1a;border-radius:12px;padding:16px 18px;margin-bottom:20px;">'
      + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">'
        + '<span style="color:#d4af37;font-size:13px;font-weight:700;">📋 Mes Tâches</span>'
        + '<button onclick="tachesOpenModal()" style="background:#d4af37;color:#000;border:none;border-radius:5px;padding:3px 10px;font-size:11px;font-weight:700;cursor:pointer;">+ Nouvelle</button>'
      + '</div>'
      + '<div style="color:#333;font-size:12px;text-align:center;padding:12px 0;">Aucune tâche en cours</div>'
    + '</div>';
    return;
  }

  var rows = active.slice(0,6).map(function(t){
    var tp = TCH_TYPES[t.type] || TCH_TYPES.simple;
    var overdue = t.dueDate && t.dueDate < today;
    var noteShort = t.note.length > 90 ? t.note.slice(0,87)+'…' : t.note;
    return '<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #141414;cursor:pointer;'
      + (t.pinned ? 'border-left:2px solid #d4af37;padding-left:8px;' : '') + '" onclick="tachesOpenModal(\''+t.id+'\')">'
      + '<span style="color:'+tp.color+';font-size:13px;flex-shrink:0;">'+(t.pinned?'📌':tp.icon)+'</span>'
      + '<div style="flex:1;min-width:0;">'
        + '<div style="color:#ddd;font-size:12px;line-height:1.4;white-space:pre-wrap;word-break:break-word;">'+_tchEsc(noteShort)+'</div>'
        + (t.dueDate ? '<div style="font-size:10px;color:'+(overdue?'#ef4444':'#555')+';margin-top:1px;">'+(overdue?'⚠ ':'')+_tchFmt(t.dueDate)+'</div>' : '')
      + '</div>'
      + '<button onclick="event.stopPropagation();tachesMarkDone(\''+t.id+'\')" title="Marquer terminée" '
        + 'style="width:22px;height:22px;border-radius:50%;border:2px solid '+tp.color+';background:transparent;'
        + 'color:'+tp.color+';font-size:12px;cursor:pointer;display:flex;align-items:center;justify-content:center;'
        + 'flex-shrink:0;transition:background 0.15s;" '
        + 'onmouseover="this.style.background=\''+tp.bg+'\'" onmouseout="this.style.background=\'transparent\'">✓</button>'
    + '</div>';
  }).join('');

  var more = active.length > 6 ? '<div style="color:#444;font-size:11px;text-align:center;padding:6px 0;cursor:pointer;" onclick="showView(\'tache\')">+' + (active.length-6) + ' autres — voir tout</div>' : '';

  zone.innerHTML = '<div style="background:#0d0d0d;border:1px solid '+(urgentCount?'#3a0606':'#1a1a1a')+';border-radius:12px;padding:14px 16px;margin-bottom:20px;">'
    + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">'
      + '<span style="color:#d4af37;font-size:13px;font-weight:700;cursor:pointer;" onclick="showView(\'tache\')">📋 Mes Tâches'
        + (urgentCount?' <span style="background:#3a0606;color:#ef4444;border-radius:10px;padding:1px 7px;font-size:10px;font-weight:700;margin-left:4px;">'+urgentCount+' urgente'+(urgentCount>1?'s':'')+'</span>':'')
        + ' <span style="background:#111;color:#555;border-radius:10px;padding:1px 7px;font-size:10px;margin-left:2px;">'+active.length+'</span>'
      + '</span>'
      + '<button onclick="tachesOpenModal()" style="background:#d4af37;color:#000;border:none;border-radius:5px;padding:3px 10px;font-size:11px;font-weight:700;cursor:pointer;">+ Nouvelle</button>'
    + '</div>'
    + rows + more
  + '</div>';
}

// ── UTILITAIRES ──────────────────────────────────────────────────────

function _tchEsc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function _tchRefreshAll() {
  if (typeof renderCalendrier === 'function') renderCalendrier();
  renderTachesDashboard();
  renderTachePage();
}

// ── SYNC MANUEL (bouton "Actualiser") ────────────────────────────────
// Force une synchronisation immédiate avec le serveur, pour récupérer
// sans attendre les tâches ajoutées depuis un autre appareil (téléphone).
function tachesManualSync() {
  var btn = document.getElementById('btn-tache-sync');
  if (btn) { btn.disabled = true; btn.innerHTML = '&#8987; Synchronisation…'; }
  if (typeof syncFromServer !== 'function') {
    if (btn) { btn.disabled = false; btn.innerHTML = '&#128260; Actualiser'; }
    return;
  }
  syncFromServer(function() {
    _tchRefreshAll();
    if (typeof updateDashboardStats === 'function') {
      try { updateDashboardStats(); } catch(e) {}
    }
    if (btn) { btn.disabled = false; btn.innerHTML = '&#128260; Actualiser'; }
    if (typeof _tchToast === 'function') _tchToast('Tâches à jour ✓', 'success');
  }, false);
}

