// MYTHOS PROD - Systeme de Rappels

function getRappels() {
  try { return JSON.parse(localStorage.getItem('mp_rappels') || '[]'); } catch(e) { return []; }
}
function saveRappelsList(list) { localStorage.setItem('mp_rappels', JSON.stringify(list)); }

// ── Types de rappels ──────────────────────────────────────────────────
var DEFAULT_RAPPEL_TYPES = ['Fiscal','Administratif','Contrat','Relance client','Paie','Juridique','Autre'];
function getRappelTypes() {
  try {
    var stored = JSON.parse(localStorage.getItem('mp_rappel_types') || 'null');
    return stored || DEFAULT_RAPPEL_TYPES.slice();
  } catch(e) { return DEFAULT_RAPPEL_TYPES.slice(); }
}
function saveRappelTypes(list) { localStorage.setItem('mp_rappel_types', JSON.stringify(list)); }
function addRappelTypeIfNew(val) {
  val = (val || '').trim();
  if (!val) return;
  var list = getRappelTypes();
  if (list.indexOf(val) === -1) { list.push(val); saveRappelTypes(list); }
}

// Rafraîchir le <select> de types dans le modal
function _refreshRappelTypeSelect(currentVal) {
  var sel = document.getElementById('rappel-type-select');
  if (!sel) return;
  var types = getRappelTypes();
  sel.innerHTML = '<option value="">— Choisir un type —</option>'
    + types.map(function(t){
        return '<option value="'+escHtml(t)+'"'+(t===currentVal?' selected':'')+'>'+escHtml(t)+'</option>';
      }).join('');
}

function getNextRappelDate(dateDebut, periode) {
  if (periode === 'unique') return dateDebut || null;
  var today = new Date(); today.setHours(0,0,0,0);
  var d = new Date(dateDebut + 'T00:00:00');
  if (isNaN(d.getTime())) return null;
  while (d < today) {
    switch (periode) {
      case 'jour':    d.setDate(d.getDate() + 1); break;
      case 'semaine': d.setDate(d.getDate() + 7); break;
      case 'mois':    d.setMonth(d.getMonth() + 1); break;
      case '3mois':   d.setMonth(d.getMonth() + 3); break;
      case '6mois':   d.setMonth(d.getMonth() + 6); break;
      case 'annee':   d.setFullYear(d.getFullYear() + 1); break;
      default:        d.setMonth(d.getMonth() + 1);
    }
  }
  return d.toISOString().slice(0,10);
}

function periodeLabel(p) {
  var map = { unique:'Une seule fois', jour:'Chaque jour', semaine:'Chaque semaine',
    mois:'Chaque mois', '3mois':'Tous les 3 mois', '6mois':'Tous les 6 mois', annee:'Chaque annee' };
  return map[p] || p;
}
function todayStrR() { return new Date().toISOString().slice(0,10); }
function formatDateR(s) { var p=s?s.split('-'):[]; return p.length===3?p[2]+'/'+p[1]+'/'+p[0]:s||''; }
function escHtml(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function openRappelsModal(editId) {
  var ti=document.getElementById('rappel-titre'), dd=document.getElementById('rappel-date-debut'),
      pe=document.getElementById('rappel-periode'), de=document.getElementById('rappel-details'),
      sb=document.getElementById('rappel-save-btn');
  var typeInput=document.getElementById('rappel-type-input');
  if (editId) {
    var r=getRappels().find(function(x){return x.id===editId;});
    if (!r) return;
    if(ti) ti.value=r.titre||""; if(dd) dd.value=r.dateDebut||todayStrR();
    if(pe) pe.value=r.periode||"mois"; if(de) de.value=r.details||"";
    if(typeInput) typeInput.value=r.type||"";
    _refreshRappelTypeSelect(r.type||"");
    if(sb){sb.textContent="Modifier";sb.setAttribute("onclick","saveRappel(\""+editId+"\")"); }
  } else {
    if(ti) ti.value=""; if(dd) dd.value=todayStrR();
    if(pe) pe.value="mois"; if(de) de.value="";
    if(typeInput) typeInput.value="";
    _refreshRappelTypeSelect("");
    if(sb){sb.textContent="Enregistrer";sb.setAttribute("onclick","saveRappel()");}
  }
  var m=document.getElementById('rappels-modal'); if(m){m.style.display='flex';m.style.zIndex='10001';}
  if(ti) setTimeout(function(){ti.focus();},100);
}
function closeRappelsModal(){var m=document.getElementById('rappels-modal');if(m)m.style.display='none';}
function openRappelsListModal(){renderRappelsTable();var m=document.getElementById('rappels-list-modal');if(m)m.style.display='flex';}
function closeRappelsListModal(){var m=document.getElementById('rappels-list-modal');if(m)m.style.display='none';}

function saveRappel(editId) {
  var ti=document.getElementById('rappel-titre'),titre=ti?ti.value.trim():'';
  if(!titre){alert('Le titre est obligatoire.');return;}
  var dd=document.getElementById('rappel-date-debut'),dateDebut=dd?dd.value:'';
  if(!dateDebut){alert('La date est obligatoire.');return;}
  var pe=document.getElementById('rappel-periode'),periode=pe?pe.value:'mois';
  var de=document.getElementById('rappel-details'),details=de?de.value.trim():'';
  var typeInput=document.getElementById('rappel-type-input');
  var type=(typeInput?typeInput.value.trim():'');
  if(type) addRappelTypeIfNew(type);
  var list=getRappels();
  if(editId){
    var idx=list.findIndex(function(r){return r.id===editId;});
    if(idx>=0)list[idx]=Object.assign(list[idx],{titre:titre,dateDebut:dateDebut,periode:periode,details:details,type:type});
  }else{
    list.push({id:'rpl_'+Date.now(),titre:titre,dateDebut:dateDebut,periode:periode,details:details,type:type,createdAt:todayStrR()});
  }
  saveRappelsList(list);
  closeRappelsModal();updateRappelsBadge();renderRappelsTable();
  if(typeof renderCalendrier==='function')renderCalendrier();
}

function deleteRappel(id){
  if(!confirm('Supprimer ce rappel ?'))return;
  saveRappelsList(getRappels().filter(function(r){return r.id!==id;}));
  renderRappelsTable();updateRappelsBadge();
  if(typeof renderCalendrier==='function')renderCalendrier();
}

function renderRappelsTable(){
  var c=document.getElementById('rappels-table-container');if(!c)return;
  var list=getRappels(),today=todayStrR();
  if(!list.length){
    c.innerHTML='<div style="text-align:center;padding:40px;color:#555;font-size:14px;">&#128276;<br><br>Aucun rappel.<br><span style="font-size:12px;">Cliquez sur + Nouveau rappel pour commencer.</span></div>';
    return;
  }
  var h='<table style="width:100%;border-collapse:collapse;font-size:13px;"><thead><tr style="border-bottom:1px solid #2a2a2a;">'
    +'<th style="text-align:left;padding:10px 12px;color:#666;font-size:11px;">Titre</th>'
    +'<th style="text-align:left;padding:10px 12px;color:#666;font-size:11px;">Type</th>'
    +'<th style="text-align:left;padding:10px 12px;color:#666;font-size:11px;">Periode</th>'
    +'<th style="text-align:left;padding:10px 12px;color:#666;font-size:11px;">Date</th>'
    +'<th style="text-align:left;padding:10px 12px;color:#666;font-size:11px;">Details</th>'
    +'<th></th></tr></thead><tbody>';
  list.forEach(function(r){
    var next=getNextRappelDate(r.dateDebut,r.periode),isDue=next&&next<=today;
    var c1=isDue?'#ef4444':'#f59e0b',c2=isDue?'#ef4444':'#22c55e';
    h+='<tr style="border-bottom:1px solid #1a1a1a;">'
      +'<td style="padding:12px;color:#e0e0e0;font-weight:600;"><span style="color:'+c1+';margin-right:6px;">&#128276;</span>'+escHtml(r.titre)+'</td>'
      +'<td style="padding:12px;">'+(r.type?'<span style="background:rgba(212,175,55,0.12);color:#d4af37;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;">'+escHtml(r.type)+'</span>':'<span style="color:#333;">—</span>')+'</td>'
      +'<td style="padding:12px;color:#d4af37;">'+periodeLabel(r.periode)+'</td>'
      +'<td style="padding:12px;"><span style="color:'+c2+';font-weight:700;">'+(next?formatDateR(next):'-')+'</span>'
      +(isDue?' <span style="font-size:10px;background:rgba(239,68,68,0.15);padding:2px 6px;border-radius:8px;color:#ef4444;">DU</span>':'')+'</td>'
      +'<td style="padding:12px;color:#666;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:150px;">'+escHtml(r.details||'-')+'</td>'
      +'<td style="padding:12px;text-align:right;white-space:nowrap;">'
      +'<button class="btn btn-sm btn-outline" onclick="openRappelsModal(\''+r.id+'\')" style="padding:4px 8px;margin-right:4px;">&#9998;</button>'
      +'<button class="btn btn-sm btn-danger" onclick="deleteRappel(\''+r.id+'\')" style="padding:4px 8px;">&times;</button>'
      +'</td></tr>';
  });
  c.innerHTML=h+'</tbody></table>';
}

function updateRappelsBadge(){
  var btn=document.getElementById('btn-rappels');if(!btn)return;
  var today=todayStrR();
  var dus=getRappels().filter(function(r){var n=getNextRappelDate(r.dateDebut,r.periode);return n&&n<=today;}).length;
  if(dus>0){
    btn.innerHTML='&#128276; Rappels <span style="background:#ef4444;color:#fff;border-radius:50%;width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;margin-left:4px;">'+dus+'</span>';
    btn.style.borderColor='#ef4444';btn.style.color='#ef4444';
  }else{
    btn.innerHTML='&#128276; Rappels';
    btn.style.borderColor='#f59e0b';btn.style.color='#f59e0b';
  }
}
function getRappelsForRdv(rdvId){if(!rdvId)return[];return getRappels().filter(function(r){return r.rdvId===rdvId;});}

// Tout ce qui touche au DOM est dans DOMContentLoaded
document.addEventListener('DOMContentLoaded', function() {

  // Creer modal Nouveau Rappel
  if (!document.getElementById('rappels-modal')) {
    var m1=document.createElement('div');
    m1.id='rappels-modal'; m1.className='modal-overlay';
    m1.style.cssText='display:none;z-index:9999;position:fixed;';
    m1.innerHTML='<div class="modal" style="width:540px;max-width:98vw;">'
      +'<div class="modal-header"><h3>&#128276; Nouveau rappel</h3>'
      +'<button class="close-btn" onclick="closeRappelsModal()">&times;</button></div>'
      +'<div class="form-grid" style="padding:20px;gap:14px;">'
      +'<div class="form-group full"><label>Titre du rappel *</label>'
      +'<input type="text" id="rappel-titre" placeholder="Ex: Relancer client, Verifier contrat..."></div>'
      +'<div class="form-group"><label>Date de debut</label><input type="date" id="rappel-date-debut"></div>'
      +'<div class="form-group"><label>Periode</label><select id="rappel-periode">'
      +'<option value="unique">Une seule fois</option>'
      +'<option value="jour">Chaque jour</option>'
      +'<option value="semaine">Chaque semaine</option>'
      +'<option value="mois" selected>Chaque mois</option>'
      +'<option value="3mois">Tous les 3 mois</option>'
      +'<option value="6mois">Tous les 6 mois</option>'
      +'<option value="annee">Chaque annee</option>'
      +'</select></div>'
      +'<div class="form-group full" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:end;">'
      +'<div><label style="display:block;margin-bottom:6px;">Type</label>'
      +'<select id="rappel-type-select" style="width:100%;" onchange="(function(s){var inp=document.getElementById(\'rappel-type-input\');if(inp&&s.value)inp.value=s.value;})(this)">'
      +'<option value="">— Choisir un type —</option>'
      +'</select></div>'
      +'<div><label style="display:block;margin-bottom:6px;">Ou saisir</label>'
      +'<input type="text" id="rappel-type-input" placeholder="Ex: Fiscal, Contrat..." '
      +'oninput="(function(v){var sel=document.getElementById(\'rappel-type-select\');if(!sel)return;var found=false;for(var i=0;i<sel.options.length;i++){if(sel.options[i].value===v){sel.value=v;found=true;break;}}if(!found)sel.value=\'\';})(this.value)">'
      +'</div></div>'
      +'<div class="form-group full"><label>Details (optionnel)</label>'
      +'<textarea id="rappel-details" rows="3" placeholder="Description..."></textarea></div>'
      +'</div>'
      +'<div style="display:flex;justify-content:flex-end;gap:8px;padding:0 20px 20px;">'
      +'<button class="btn btn-outline" onclick="closeRappelsModal()">Annuler</button>'
      +'<button id="rappel-save-btn" class="btn btn-gold" onclick="saveRappel()">&#128190; Enregistrer</button>'
      +'</div></div>';
    document.body.appendChild(m1);
  }

  // Creer modal Liste Rappels
  if (!document.getElementById('rappels-list-modal')) {
    var m2=document.createElement('div');
    m2.id='rappels-list-modal'; m2.className='modal-overlay';
    m2.style.cssText='display:none;z-index:9999;position:fixed;';
    m2.innerHTML='<div class="modal" style="width:780px;max-width:98vw;max-height:90vh;display:flex;flex-direction:column;">'
      +'<div class="modal-header" style="flex-shrink:0;display:flex;align-items:center;justify-content:space-between;padding:16px 20px;">'
      +'<h3 style="margin:0;">&#128203; Rappels enregistres</h3>'
      +'<div style="display:flex;gap:8px;align-items:center;">'
      +'<button class="btn btn-gold" onclick="closeRappelsListModal();setTimeout(function(){openRappelsModal();},100);" style="font-size:12px;padding:6px 12px;">&#43; Nouveau rappel</button>'
      +'<button class="close-btn" onclick="closeRappelsListModal()">&times;</button>'
      +'</div></div>'
      +'<div style="flex:1;overflow-y:auto;padding:20px;"><div id="rappels-table-container"></div></div>'
      +'</div>';
    document.body.appendChild(m2);
  }

  // Creer modal Doc Viewer
  if (!document.getElementById('doc-viewer-modal')) {
    var dv=document.createElement('div');
    dv.id='doc-viewer-modal'; dv.className='modal-overlay';
    dv.style.cssText='display:none;z-index:9999;position:fixed;';
    dv.innerHTML='<div class="modal" style="width:820px;max-width:96vw;height:92vh;display:flex;flex-direction:column;padding:0;">'
      +'<div class="modal-header" style="flex-shrink:0;position:relative;"><span id="doc-viewer-title" style="position:absolute;left:50%;transform:translateX(-50%);color:#d4af37;font-weight:700;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:60%;"></span>'
      +'<button class="close-btn" onclick="closeDocViewer()">&times;</button></div>'
      +'<div id="doc-viewer-body" style="flex:1;overflow:auto;background:#0d0d0d;display:flex;align-items:center;justify-content:center;min-height:300px;padding:16px;"></div>'
      +'<div style="flex-shrink:0;padding:12px 20px;border-top:1px solid #222;display:flex;justify-content:flex-end;gap:8px;">'
      +'<a id="doc-viewer-download" href="#" download style="display:none;" class="btn btn-outline">&#11015; Telecharger</a>'
      +'<button class="btn btn-outline" onclick="closeDocViewer()">Fermer</button></div></div>';
    document.body.appendChild(dv);
  }


  // Ajouter dossier "Factures achats" a DOC_FOLDERS
  if (typeof DOC_FOLDERS !== 'undefined' && !DOC_FOLDERS['factures-achats']) {
    DOC_FOLDERS['factures-achats'] = { label: 'Factures achats', icon: '&#128203;', color: '#f59e0b' };
  }
  setTimeout(updateRappelsBadge, 1000);
});

function closeDocViewer(){
  var m=document.getElementById('doc-viewer-modal');if(m)m.style.display='none';
  var b=document.getElementById('doc-viewer-body');if(b)b.innerHTML='';
}

window.docPreviewPhoto=function(id){
  var docs=[];try{docs=JSON.parse(localStorage.getItem('mp_documents')||'[]');}catch(e){}
  var doc=docs.find(function(d){return d.id===id;});if(!doc)return;
  var modal=document.getElementById('doc-viewer-modal'),
      title=document.getElementById('doc-viewer-title'),
      body=document.getElementById('doc-viewer-body'),
      dlBtn=document.getElementById('doc-viewer-download');
  if(!modal||!body)return;
  title.textContent=doc.name||'Document';
  body.innerHTML='';body.style.padding='16px';
  var photo=doc.photo||'',ft=doc.fileType||'image';
  if(/\.(docx?|doc)$/i.test(photo))ft='word';
  else if(/\.xlsx?$/i.test(photo))ft='excel';
  else if(/\.pdf$/i.test(photo))ft='pdf';
  else if(/\.(jpg|jpeg|png|gif|webp)$/i.test(photo))ft='image';
  var isServer=photo.indexOf('/documents/')===0;
  var absUrl=isServer?(window.location.origin+photo):photo;
  if(photo){dlBtn.href=absUrl;dlBtn.download=doc.name||'doc';dlBtn.style.display='inline-flex';}
  else{dlBtn.style.display='none';}
  if(!photo){
    body.innerHTML='<div style="color:#555;">Aucun fichier.</div>';
  }else if(ft==='image'||photo.indexOf('data:image')===0){
    var img=new Image();
    img.style.cssText='max-width:100%;max-height:60vh;object-fit:contain;border-radius:6px;';
    img.onerror=function(){
      body.innerHTML='<div style="text-align:center;color:#888;padding:24px;">'
        +'<div style="font-size:48px;">&#128247;</div>'
        +'<div style="margin:12px 0;">Image inaccessible.</div>'
        +'<a href="'+absUrl+'" target="_blank" class="btn btn-gold">Ouvrir dans un onglet</a>'
        +'</div>';
    };
    img.src=photo;body.appendChild(img);
  }else if(ft==='pdf'||photo.indexOf('data:application/pdf')===0){
    body.style.padding='0';
    body.innerHTML='<iframe src="'+photo+'" style="width:100%;height:60vh;border:none;"></iframe>';
  }else{
    var icon=ft==='word'?'&#128221;':ft==='excel'?'&#128202;':'&#128196;';
    // Google Docs Viewer pour Word/Excel
    var gviewUrl='https://docs.google.com/viewer?url='+encodeURIComponent(absUrl)+'&embedded=true';
    var gviewOpen='https://docs.google.com/viewer?url='+encodeURIComponent(absUrl);
    var useGview=(ft==='word'||ft==='excel')&&isServer;
    if(useGview){
      body.style.padding='0';
      body.style.flexDirection='column';
      body.innerHTML=
        '<div style="background:#1e1e1e;padding:8px 14px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #333;flex-shrink:0;">'
        +'<span style="color:#aaa;font-size:12px;">&#128196; '+escHtml(doc.name)+'</span>'
        +'<a href="'+gviewOpen+'" target="_blank" style="background:#4285f4;color:#fff;padding:5px 12px;border-radius:5px;font-size:12px;font-weight:700;text-decoration:none;">&#128065; Ouvrir dans Google Docs</a>'
        +'</div>'
        +'<iframe src="'+gviewUrl+'" style="flex:1;width:100%;border:none;min-height:0;display:block;"></iframe>';
    }else{
      body.innerHTML='<div style="text-align:center;color:#888;padding:30px;">'
        +'<div style="font-size:52px;margin-bottom:12px;">'+icon+'</div>'
        +'<div style="color:#e0e0e0;font-size:15px;font-weight:600;margin-bottom:8px;">'+escHtml(doc.name)+'</div>'
        +'<div style="margin-bottom:24px;font-size:13px;">Apercu non disponible dans le navigateur.</div>'
        +'<a href="'+absUrl+'" target="_blank" class="btn btn-gold" style="margin-right:8px;">&#128065; Ouvrir</a>'
        +'<a href="'+absUrl+'" download="'+escHtml(doc.name||'doc')+'" class="btn btn-outline">&#11015; Telecharger</a>'
        +'</div>';
      dlBtn.style.display='none';
    }
  }
  modal.style.display='flex';
};

// ── Override _renderDocFolder ─────────────────────────────────────────
// - Ligne cliquable pour modifier (pas de bouton crayon)
// - Dropdown "Envoyer avec" (WhatsApp + Email)
// - Dropdown "Deplacer vers" fixe (z-index eleve)
window._renderDocFolder = function(cat) {
  var container = document.getElementById('doc-main-container');
  if (!container) return;
  var folders = (typeof DOC_FOLDERS !== 'undefined') ? DOC_FOLDERS : {};
  var f = folders[cat] || { icon:'📁', label:cat, color:'#d4af37' };
  var docs = [];
  try {
    var allDocs = JSON.parse(localStorage.getItem('mp_documents') || '[]');
    docs = allDocs.filter(function(d){ return d.cat === cat; });
  } catch(e) {}

  var listHtml = '';
  if (!docs.length) {
    listHtml = '<div style="padding:40px 0;text-align:center;color:#555;">Dossier vide — ajoutez votre premier document.</div>';
  } else {
    listHtml = '<div style="display:flex;flex-direction:column;gap:0;background:#0d0d0d;border:1px solid #222;border-radius:12px;overflow:visible;">'
      + '<div style="display:grid;grid-template-columns:54px 1fr 160px 100px 160px;align-items:center;padding:10px 16px;background:#181818;border-bottom:1px solid #252525;border-radius:12px 12px 0 0;">'
        + '<span style="color:#555;font-size:10px;font-weight:700;text-transform:uppercase;">Apercu</span>'
        + '<span style="color:#555;font-size:10px;font-weight:700;text-transform:uppercase;">Nom</span>'
        + '<span style="color:#555;font-size:10px;font-weight:700;text-transform:uppercase;">Note</span>'
        + '<span style="color:#555;font-size:10px;font-weight:700;text-transform:uppercase;text-align:center;">Date</span>'
        + '<span style="color:#555;font-size:10px;font-weight:700;text-transform:uppercase;text-align:right;">Actions</span>'
      + '</div>'
      + docs.map(function(d) {
          // Apercu : icone oeil cliquable
          var thumb = '<div onclick="docPreviewPhoto(\''+d.id+'\');" title="Apercu" '
            + 'style="width:42px;height:42px;border-radius:8px;background:#111;border:1px solid #2a2a2a;'
            + 'display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all 0.15s;color:#555;font-size:20px;" '
            + 'onmouseover="this.style.borderColor=\'#d4af37\';this.style.color=\'#d4af37\'" '
            + 'onmouseout="this.style.borderColor=\'#2a2a2a\';this.style.color=\'#555\'">'
            + '&#128065;</div>';

          var esc = (typeof escapeHtml === 'function') ? escapeHtml : escHtml;

          // Dropdown Deplacer
          var moveItems = Object.entries(folders).filter(function(e){ return e[0] !== cat; }).map(function(e){
            return '<div onclick="moveDoc(\''+d.id+'\',\''+e[0]+'\')" style="display:flex;align-items:center;gap:10px;padding:10px 14px;cursor:pointer;font-size:13px;color:#ddd;transition:background 0.1s;" onmouseover="this.style.background=\'rgba(251,146,60,0.08)\'" onmouseout="this.style.background=\'\'"><span style="font-size:16px;">'+(e[1].icon||'📁')+'</span>'+e[1].label+'</div>';
          }).join('');

          var moveDd = '<div style="position:relative;display:inline-block;" onclick="event.stopPropagation();">'
            + '<button class="btn btn-sm btn-outline" onclick="rDocToggleMenu(this,\'move-\'+\''+d.id+'\')" title="Deplacer vers..." style="padding:4px 7px;color:#fb923c;border-color:#fb923c;">&#8646;</button>'
            + '<div id="move-'+d.id+'" class="rdoc-menu" style="display:none;position:fixed;background:#1a1a1a;border:1px solid #333;border-radius:10px;min-width:200px;z-index:10000;box-shadow:0 8px 24px rgba(0,0,0,0.7);overflow:hidden;">'
              + '<div style="padding:8px 12px;color:#555;font-size:10px;font-weight:700;text-transform:uppercase;border-bottom:1px solid #252525;">Deplacer vers</div>'
              + moveItems
            + '</div></div>';

          // Dropdown Envoyer avec
          var sendDd = '<div style="position:relative;display:inline-block;" onclick="event.stopPropagation();">'
            + '<button class="btn btn-sm btn-outline" onclick="rDocToggleMenu(this,\'send-\'+\''+d.id+'\')" title="Envoyer avec..." style="padding:4px 7px;color:#60a5fa;border-color:#60a5fa;">&#128228;</button>'
            + '<div id="send-'+d.id+'" class="rdoc-menu" style="display:none;position:fixed;background:#1a1a1a;border:1px solid #333;border-radius:10px;min-width:180px;z-index:10000;box-shadow:0 8px 24px rgba(0,0,0,0.7);overflow:hidden;">'
              + '<div style="padding:8px 12px;color:#555;font-size:10px;font-weight:700;text-transform:uppercase;border-bottom:1px solid #252525;">Envoyer avec</div>'
              + '<div onclick="rDocSendWhatsApp(\''+d.id+'\')" style="display:flex;align-items:center;gap:10px;padding:10px 14px;cursor:pointer;font-size:13px;color:#25d366;transition:background 0.1s;" onmouseover="this.style.background=\'rgba(37,211,102,0.08)\'" onmouseout="this.style.background=\'\'"><span style="font-size:18px;">&#128241;</span>WhatsApp</div>'
              + '<div onclick="rDocSendEmail(\''+d.id+'\')" style="display:flex;align-items:center;gap:10px;padding:10px 14px;cursor:pointer;font-size:13px;color:#60a5fa;transition:background 0.1s;" onmouseover="this.style.background=\'rgba(96,165,250,0.08)\'" onmouseout="this.style.background=\'\'"><span style="font-size:18px;">&#9993;</span>Email</div>'
            + '</div></div>';

          return '<div onclick="if(typeof openDocModal===\'function\')openDocModal(\''+d.cat+'\',\''+d.id+'\')" style="display:grid;grid-template-columns:54px 1fr 160px 100px 160px;align-items:center;padding:11px 16px;border-bottom:1px solid #161616;transition:background 0.1s;cursor:pointer;" onmouseover="this.style.background=\'rgba(255,255,255,0.025)\'" onmouseout="this.style.background=\'\'">'
            + '<div onclick="event.stopPropagation();">'+thumb+'</div>'
            + '<div style="min-width:0;">'
              + '<div style="color:#e0e0e0;font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+esc(d.name||'')+'</div>'
              + '<div style="color:#555;font-size:10px;margin-top:2px;font-weight:700;letter-spacing:0.05em;">'+rDocFileFormat(d)+'</div>'
            + '</div>'
            + '<div style="color:#888;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-right:8px;">'+(d.note?esc(d.note):'<span style="color:#2a2a2a;font-style:italic;">—</span>')+'</div>'
            + '<div style="text-align:center;color:#555;font-size:11px;">'+(d.createdAt?d.createdAt.slice(0,10):'')+'</div>'
            + '<div style="display:flex;gap:3px;justify-content:flex-end;flex-wrap:wrap;" onclick="event.stopPropagation();">'
              + '<button class="btn btn-sm btn-outline" onclick="if(typeof docPrint===\'function\')docPrint(\''+d.id+'\')" title="Imprimer" style="padding:4px 6px;">&#128424;</button>'
              + sendDd
              + moveDd
              + '<button class="btn btn-sm btn-danger" onclick="if(typeof deleteDoc===\'function\')deleteDoc(\''+d.id+'\')" title="Supprimer" style="padding:4px 6px;">&times;</button>'
            + '</div>'
          + '</div>';
        }).join('')
      + '</div>';
  }

  container.innerHTML =
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:20px;">'
      + '<button class="btn btn-outline btn-sm" onclick="(typeof _docCurrentFolder!==\'undefined\')&&(_docCurrentFolder=null);renderDocumentation();">&#128193; Documentation</button>'
      + '<span style="color:#333;">&rsaquo;</span>'
      + '<span style="font-size:18px;">'+f.icon+'</span>'
      + '<span style="color:'+f.color+';font-weight:700;font-size:14px;">'+f.label+'</span>'
      + '<span style="color:#444;font-size:12px;margin-left:4px;">('+docs.length+' doc'+(docs.length!==1?'s':'')+')</span>'
    + '</div>'
    + '<div style="display:flex;gap:8px;justify-content:flex-end;margin-bottom:16px;">'
      + '<button class="btn btn-outline" onclick="if(typeof openBulkUploadModal===\'function\')openBulkUploadModal(\''+cat+'\')" style="font-size:12px;">&#8679; Upload groupe</button>'
      + '<button class="btn btn-gold" onclick="if(typeof openDocModal===\'function\')openDocModal(\''+cat+'\')">+ Ajouter un document</button>'
    + '</div>'
    + listHtml;
};

// Fermer les menus si click ailleurs
document.addEventListener('click', function() {
  document.querySelectorAll('.rdoc-menu').forEach(function(m){ m.style.display = 'none'; });
});

function rDocToggleMenu(btn, menuId) {
  var menus = document.querySelectorAll('.rdoc-menu');
  menus.forEach(function(m){ if(m.id !== menuId) m.style.display = 'none'; });
  var menu = document.getElementById(menuId);
  if (!menu) return;
  if (menu.style.display !== 'none') { menu.style.display = 'none'; return; }
  var rect = btn.getBoundingClientRect();
  // Afficher temporairement pour mesurer la hauteur
  menu.style.visibility = 'hidden';
  menu.style.display = 'block';
  var menuH = menu.offsetHeight;
  var menuW = menu.offsetWidth;
  menu.style.visibility = '';
  // Positionner : vers le haut si manque de place en bas
  var spaceBelow = window.innerHeight - rect.bottom;
  var top = spaceBelow >= menuH + 8
    ? (rect.bottom + 4)
    : (rect.top - menuH - 4);
  var left = Math.max(4, rect.right - menuW);
  menu.style.top  = Math.max(4, top) + 'px';
  menu.style.left = left + 'px';
}

function rDocSendWhatsApp(id) {
  var docs = []; try{ docs = JSON.parse(localStorage.getItem('mp_documents')||'[]'); }catch(e){}
  var doc = docs.find(function(d){ return d.id === id; });
  if (!doc) return;
  var photo = doc.photo || '';
  var absUrl = photo.indexOf('/documents/') === 0 ? (window.location.origin + photo) : '';
  if (!absUrl) { alert('Ce document n\'est pas heberge sur le serveur — telechargez-le d\'abord.'); return; }
  // Envoyer uniquement le lien du fichier (sans texte automatique)
  window.open('https://wa.me/?text=' + encodeURIComponent(absUrl), '_blank');
}

function rDocSendEmail(id) {
  var docs = []; try{ docs = JSON.parse(localStorage.getItem('mp_documents')||'[]'); }catch(e){}
  var doc = docs.find(function(d){ return d.id === id; });
  if (!doc) return;
  var photo = doc.photo || '';
  var absUrl = photo.indexOf('/documents/') === 0 ? (window.location.origin + photo) : '';
  var subject = encodeURIComponent((doc.name || 'Document') + ' — Mythos Prod');
  var body = encodeURIComponent('Veuillez trouver ci-joint le document : ' + (doc.name || '') + (absUrl ? '\n\nLien : ' + absUrl : ''));
  window.open('mailto:?subject=' + subject + '&body=' + body);
}

// Override docPrint — impression correcte selon le type de fichier
window.docPrint = function(id) {
  var docs = []; try { docs = JSON.parse(localStorage.getItem('mp_documents')||'[]'); } catch(e) {}
  var doc = docs.find(function(d){ return d.id === id; });
  if (!doc || !doc.photo) return;

  var photo = doc.photo;
  var ft = doc.fileType || 'image';
  if (/\.(docx?|doc)$/i.test(photo)) ft = 'word';
  else if (/\.xlsx?$/i.test(photo)) ft = 'excel';
  else if (/\.pdf$/i.test(photo)) ft = 'pdf';
  else if (/\.(jpg|jpeg|png|gif|webp)$/i.test(photo)) ft = 'image';

  var isServer = photo.indexOf('/documents/') === 0;
  var absUrl = isServer ? (window.location.origin + photo) : photo;

  if (ft === 'image' || photo.indexOf('data:image') === 0) {
    // Image : ouvrir et imprimer via fenetre
    var w = window.open('', '_blank');
    w.document.write(
      '<html><head><title>'+escHtml(doc.name)+'</title>'
      +'<style>body{margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#fff;}'
      +'img{max-width:100%;}</style>'
      +'<script>window.onload=function(){window.print();}<\/script></head>'
      +'<body><img src="'+photo+'"></body></html>'
    );
    w.document.close();
  } else if (ft === 'pdf' || photo.indexOf('data:application/pdf') === 0) {
    // PDF : iframe + print
    var w2 = window.open('', '_blank');
    w2.document.write(
      '<html><head><title>'+escHtml(doc.name)+'</title>'
      +'<script>window.onload=function(){window.print();}<\/script></head>'
      +'<body style="margin:0"><embed src="'+photo+'" type="application/pdf" width="100%" height="100%"></body></html>'
    );
    w2.document.close();
  } else if (isServer) {
    // Word / Excel : ouvrir Google Docs Viewer dans nouvel onglet (l'utilisateur imprime depuis Google)
    var gview = 'https://docs.google.com/viewer?url=' + encodeURIComponent(absUrl);
    window.open(gview, '_blank');
  } else {
    window.open(absUrl, '_blank');
  }
};

function rDocFileFormat(d) {
  var photo = d.photo || '';
  var ft = d.fileType || '';
  // Detecter depuis l'extension de l'URL
  var m = photo.match(/\.([a-zA-Z0-9]+)(?:[?#]|$)/);
  if (m) return m[1].toUpperCase();
  // Fallback sur fileType
  var map = { image:'IMAGE', pdf:'PDF', word:'WORD', excel:'EXCEL', csv:'CSV', text:'TXT', file:'FICHIER' };
  return map[ft] || ft.toUpperCase() || 'DOC';
}

// Override _renderDocHome — supprime les mini-images, affiche le nb de docs
window._renderDocHome = function() {
  var container = document.getElementById('doc-main-container');
  if (!container) return;
  var folders = (typeof DOC_FOLDERS !== 'undefined') ? DOC_FOLDERS : {};
  var allDocs = [];
  try { allDocs = JSON.parse(localStorage.getItem('mp_documents') || '[]'); } catch(e) {}
  var total = allDocs.length;
  var nbFolders = Object.keys(folders).length;

  var html =
    '<div style="display:flex;align-items:center;gap:16px;background:linear-gradient(135deg,rgba(212,175,55,0.1),rgba(212,175,55,0.04));border:1px solid rgba(212,175,55,0.2);border-radius:14px;padding:20px 24px;margin-bottom:24px;">'
    + '<div style="font-size:40px;">&#128193;</div>'
    + '<div>'
      + '<div style="color:#d4af37;font-size:20px;font-weight:800;">Mes Documents</div>'
      + '<div style="color:#888;font-size:12px;margin-top:3px;">'+total+' document'+(total!==1?'s':'')+' au total &nbsp;&middot;&nbsp; '+nbFolders+' dossiers</div>'
    + '</div>'
    + '<div style="margin-left:auto;">'
      + '<button class="btn btn-gold" onclick="if(typeof openBulkUploadModal===\'function\')openBulkUploadModal()" style="font-size:12px;">&#8679; Upload groupe</button>'
    + '</div>'
    + '</div>'

    + '<div style="display:flex;flex-direction:column;gap:0;background:#0d0d0d;border:1px solid #222;border-radius:12px;overflow:hidden;">'
    + '<div style="display:grid;grid-template-columns:48px 1fr 90px 36px;align-items:center;padding:10px 16px;background:#181818;border-bottom:1px solid #252525;">'
      + '<span></span>'
      + '<span style="color:#555;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;">Dossier</span>'
      + '<span style="color:#555;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;text-align:center;">Documents</span>'
      + '<span></span>'
    + '</div>';

  Object.entries(folders).forEach(function(entry) {
    var k = entry[0], f = entry[1];
    var n = allDocs.filter(function(d){ return d.cat === k; }).length;
    html += '<div onclick="openDocFolder(\''+k+'\')" '
      + 'style="display:grid;grid-template-columns:48px 1fr 90px 36px;align-items:center;padding:14px 16px;border-bottom:1px solid #1a1a1a;cursor:pointer;transition:background 0.12s;" '
      + 'onmouseover="this.style.background=\'rgba(212,175,55,0.04)\'" onmouseout="this.style.background=\'\'">'
      + '<div style="width:36px;height:36px;border-radius:10px;background:rgba(255,255,255,0.04);display:flex;align-items:center;justify-content:center;font-size:20px;">'+f.icon+'</div>'
      + '<div>'
        + '<div style="color:#e0e0e0;font-weight:700;font-size:14px;">'+f.label+'</div>'
        + '<div style="color:#444;font-size:11px;margin-top:2px;">'+(n===0?'Vide':''+n+' fichier'+(n>1?'s':''))+'</div>'
      + '</div>'
      + '<div style="text-align:center;">'
        + '<span style="background:'+f.color+'22;color:'+f.color+';font-size:13px;font-weight:800;padding:4px 12px;border-radius:20px;">'+n+'</span>'
      + '</div>'
      + '<div style="text-align:right;color:#444;font-size:20px;">&rsaquo;</div>'
    + '</div>';
  });

  html += '</div>';
  container.innerHTML = html;
};

// ── Gestionnaire de types de rappels (Paramètres) ─────────────────────
function openRappelTypesManager() {
  _renderRappelTypesList();
  var m = document.getElementById('rappel-types-modal');
  if (m) m.style.display = 'flex';
}

function _renderRappelTypesList() {
  var c = document.getElementById('rappel-types-list-container');
  if (!c) return;
  var types = getRappelTypes();
  if (!types.length) {
    c.innerHTML = '<div style="text-align:center;color:#555;padding:20px;">Aucun type enregistré.</div>';
    return;
  }
  c.innerHTML = '<div style="display:flex;flex-direction:column;gap:0;background:#0d0d0d;border:1px solid #222;border-radius:10px;overflow:hidden;">'
    + types.map(function(t, i) {
        return '<div style="display:flex;align-items:center;padding:10px 14px;border-bottom:1px solid #1a1a1a;gap:8px;">'
          + '<span style="background:rgba(212,175,55,0.12);color:#d4af37;padding:3px 10px;border-radius:10px;font-size:12px;font-weight:700;flex:1;">'+escHtml(t)+'</span>'
          + '<button class="btn btn-sm btn-outline" onclick="editRappelType('+i+')" style="padding:4px 8px;">&#9998;</button>'
          + '<button class="btn btn-sm btn-danger" onclick="deleteRappelType('+i+')" style="padding:4px 8px;">&times;</button>'
          + '</div>';
      }).join('')
    + '</div>';
}

function addRappelTypeFromManager() {
  var inp = document.getElementById('new-rappel-type-input');
  var val = inp ? inp.value.trim() : '';
  if (!val) return;
  addRappelTypeIfNew(val);
  if (inp) inp.value = '';
  _renderRappelTypesList();
}

function deleteRappelType(idx) {
  if (!confirm('Supprimer ce type ?')) return;
  var list = getRappelTypes();
  list.splice(idx, 1);
  saveRappelTypes(list);
  _renderRappelTypesList();
}

function editRappelType(idx) {
  var list = getRappelTypes();
  var newVal = prompt('Renommer le type :', list[idx] || '');
  if (newVal === null) return;
  newVal = newVal.trim();
  if (!newVal) return;
  list[idx] = newVal;
  saveRappelTypes(list);
  _renderRappelTypesList();
}
