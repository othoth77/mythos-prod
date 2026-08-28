// MYTHOS PROD — Espace de Rédaction Pro
// Architecture : Template (champs nommés) + Entrées (formulaires remplis)

// ══════════════════════════════════════════════════════════════════════
// STOCKAGE
// ══════════════════════════════════════════════════════════════════════

var _rdDB = {};

// ── Vider le cache mémoire (appelé après une sync serveur) ───────────
function _rdInvalidateCache() {
  _rdDB = {};
  _rdCurrentDoc = {};
}

// ── Documents par catégorie ──────────────────────────────────────────
// Chaque catégorie (das, autres) a une liste de documents.
// Chaque document possède son propre docId qui sert de clé de stockage
// pour son template, ses entrées et son image.

var _rdCurrentDoc = {}; // cat → docId actuellement ouvert

// ── Helpers lecture/écriture avec sync serveur ────────────────────────
function _rdRead(key, fallback) {
  if (typeof _storeGet === 'function') return _storeGet(key, JSON.stringify(fallback));
  try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); } catch(e) { return fallback; }
}
function _rdWrite(key, value) {
  if (typeof _storeSave === 'function') { _storeSave(key, value); return; }
  try { localStorage.setItem(key, JSON.stringify(value)); } catch(e) {}
}

function _rdGetDocs(cat) {
  var key = 'mp_rddocs_' + cat;
  if (!_rdDB[key]) {
    var saved = _rdRead(key, null);
    if (saved && Array.isArray(saved)) {
      _rdDB[key] = saved;
    } else {
      // Migration : anciennes clés par catégorie
      var oldTpl = localStorage.getItem('mp_rdtpl_' + cat);
      var oldEnt = localStorage.getItem('mp_rdent_' + cat);
      var docs = [];
      if (oldTpl || oldEnt) {
        var defId = 'rdd_' + cat + '_legacy';
        if (oldTpl) _rdWrite('mp_rdtpl_' + defId, JSON.parse(oldTpl));
        if (oldEnt) _rdWrite('mp_rdent_' + defId, JSON.parse(oldEnt));
        docs = [{ id: defId, name: 'Document principal', createdAt: new Date().toISOString() }];
      }
      _rdDB[key] = docs;
      _rdWrite(key, docs);
    }
  }
  return _rdDB[key];
}
function _rdSaveDocs(cat, docs) {
  _rdDB['mp_rddocs_' + cat] = docs;
  _rdWrite('mp_rddocs_' + cat, docs);
}

function _rdGetTemplate(cat) {
  if (!_rdDB[cat + '_tpl']) {
    var v = _rdRead('mp_rdtpl_' + cat, null);
    _rdDB[cat + '_tpl'] = v || { fields: [] };
  }
  return _rdDB[cat + '_tpl'];
}
function _rdSaveTemplate(cat) {
  _rdWrite('mp_rdtpl_' + cat, _rdDB[cat + '_tpl']);
}
function _rdGetEntries(cat) {
  if (!_rdDB[cat + '_entries']) {
    _rdDB[cat + '_entries'] = _rdRead('mp_rdent_' + cat, []);
  }
  return _rdDB[cat + '_entries'];
}
function _rdSaveEntries(cat) {
  _rdWrite('mp_rdent_' + cat, _rdDB[cat + '_entries']);
}

// Image du template — en mémoire seulement (re-upload nécessaire après rechargement de page)
var _rdImages = {};
var _rdImagesData = {};

function _rdFmt(dt) {
  var d = new Date(dt);
  var p = function(n){ return String(n).padStart(2,'0'); };
  return p(d.getDate())+'/'+p(d.getMonth()+1)+'/'+d.getFullYear()+' '+p(d.getHours())+':'+p(d.getMinutes());
}
function _rdEsc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ══════════════════════════════════════════════════════════════════════
// TOASTS (remplacent les alert/confirm intrusifs)
// ══════════════════════════════════════════════════════════════════════

function _rdToast(msg, type) {
  type = type || 'success';
  var accent = { success: '#22c55e', error: '#ef4444', info: '#06b6d4', warn: '#d4af37' }[type] || '#06b6d4';
  var t = document.createElement('div');
  t.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:99999;'
    + 'background:#1c1c1c;color:#e0e0e0;border-left:3px solid '+accent+';'
    + 'padding:11px 18px;border-radius:8px;font-size:13px;line-height:1.4;'
    + 'box-shadow:0 4px 24px rgba(0,0,0,0.7);max-width:320px;'
    + 'opacity:0;transform:translateY(8px);transition:opacity 0.22s,transform 0.22s;';
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(function(){ t.style.opacity = '1'; t.style.transform = 'translateY(0)'; });
  setTimeout(function(){
    t.style.opacity = '0'; t.style.transform = 'translateY(6px)';
    setTimeout(function(){ if (t.parentNode) t.remove(); }, 260);
  }, 2800);
}

// ══════════════════════════════════════════════════════════════════════
// SIDEBAR
// ══════════════════════════════════════════════════════════════════════

function toggleRedactionMenu() {
  var m = document.getElementById('redaction-submenu');
  var a = document.getElementById('redaction-arrow');
  if (!m) return;
  var open = m.style.display === 'block';
  m.style.display = open ? 'none' : 'block';
  if (a) a.style.transform = open ? '' : 'rotate(180deg)';
}

// ══════════════════════════════════════════════════════════════════════
// VUE PRINCIPALE — liste des documents de la catégorie
// ══════════════════════════════════════════════════════════════════════

function _rdRender(cat) {
  var ed = document.getElementById('redaction-editor-' + cat);
  if (!ed) return;
  // Si un document est déjà sélectionné, rester dessus
  if (_rdCurrentDoc[cat]) { _rdRenderDocView(cat, _rdCurrentDoc[cat]); return; }

  var docs = _rdGetDocs(cat);
  var catLabel = cat === 'das' ? 'Direction des arts scéniques' : 'Autres';

  var docsHtml;
  if (!docs.length) {
    docsHtml = '<div style="text-align:center;padding:50px 20px;color:#333;background:#0d0d0d;border:1px solid #1a1a1a;border-radius:12px;">'
      + '<div style="font-size:40px;opacity:0.3;">📂</div>'
      + '<div style="margin-top:10px;font-size:13px;">Aucun document — créez votre premier document</div>'
    + '</div>';
  } else {
    docsHtml = '<div style="display:flex;flex-direction:column;gap:8px;">'
      + docs.map(function(doc){
          var tpl     = _rdGetTemplate(doc.id);
          var entries = _rdGetEntries(doc.id);
          var nFields = tpl.fields ? tpl.fields.length : 0;
          var nEntries = entries.length;
          var style   = tpl.writingStyle || 'normal';
          var styleLabels = { fr: '✍ FR', ar: '✍ AR' };
          var sLabel  = styleLabels[style] || '';
          var hasImg  = !!(tpl.imageName);
          return '<div style="display:flex;align-items:center;gap:12px;padding:14px 16px;background:#0d0d0d;border:1px solid #1e1e1e;border-radius:10px;cursor:pointer;transition:all 0.15s;" '
            + 'onmouseover="this.style.borderColor=\'#06b6d4\';this.style.background=\'#0a1215\'" '
            + 'onmouseout="this.style.borderColor=\'#1e1e1e\';this.style.background=\'#0d0d0d\'" '
            + 'onclick="_rdOpenDocView(\''+cat+'\',\''+doc.id+'\')">'
            + '<div style="font-size:28px;flex-shrink:0;">'+(hasImg?'📄':'📋')+'</div>'
            + '<div style="flex:1;min-width:0;">'
              + '<div style="color:#e0e0e0;font-size:14px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+_rdEsc(doc.name)+'</div>'
              + '<div style="color:#555;font-size:11px;margin-top:3px;display:flex;gap:10px;flex-wrap:wrap;">'
                + (hasImg ? '<span style="color:#4ade80;">📄 '+_rdEsc(tpl.imageName)+'</span>' : '<span style="color:#555;">Pas de document chargé</span>')
                + '<span>'+nFields+' champ'+(nFields!==1?'s':'')+'</span>'
                + '<span>'+nEntries+' formulaire'+(nEntries!==1?'s':'')+'</span>'
                + (sLabel ? '<span style="color:#d4af37;">'+sLabel+'</span>' : '')
              + '</div>'
            + '</div>'
            + '<div style="display:flex;gap:6px;align-items:center;flex-shrink:0;">'
              + '<button class="btn btn-sm btn-outline" onclick="event.stopPropagation();_rdRenameDocModal(\''+cat+'\',\''+doc.id+'\',\''+_rdEsc(doc.name)+'\')" style="padding:4px 8px;" title="Renommer">✏</button>'
              + '<button class="btn btn-sm btn-danger" onclick="event.stopPropagation();_rdDeleteDoc(\''+cat+'\',\''+doc.id+'\')" style="padding:4px 8px;" title="Supprimer">×</button>'
              + '<span style="color:#555;font-size:18px;padding-left:4px;">›</span>'
            + '</div>'
          + '</div>';
        }).join('')
    + '</div>';
  }

  ed.innerHTML =
    '<div style="display:flex;gap:8px;align-items:center;margin-bottom:18px;">'
      + '<h3 style="margin:0;color:#06b6d4;font-size:15px;font-weight:700;">📂 '+_rdEsc(catLabel)+'</h3>'
      + '<button class="btn btn-gold" onclick="_rdCreateDocModal(\''+cat+'\')" style="margin-left:auto;">+ Nouveau document</button>'
    + '</div>'
    + docsHtml;
}

// ── Ouvrir un document spécifique ────────────────────────────────────

function _rdOpenDocView(cat, docId) {
  _rdCurrentDoc[cat] = docId;
  var ed = document.getElementById('redaction-editor-' + cat);
  if (!ed) return;
  _rdRenderDocView(cat, docId);
}

function _rdRenderDocView(cat, docId) {
  var ed = document.getElementById('redaction-editor-' + cat);
  if (!ed) return;
  _rdEnsureImage(docId);
  var docs    = _rdGetDocs(cat);
  var doc     = docs.find(function(d){ return d.id === docId; }) || { name: 'Document' };
  var tpl     = _rdGetTemplate(docId);
  var entries = _rdGetEntries(docId);
  var hasImg  = !!_rdImages[docId];
  var hasFields = tpl.fields && tpl.fields.length > 0;
  var style   = tpl.writingStyle || 'normal';
  var styleLabels = { normal: '', fr: '✍ FR', ar: '✍ AR' };
  var styleLabel = styleLabels[style] || '';

  // Bandeau image
  var imgWarn;
  if (hasImg && tpl.imageName) {
    var loadedDate = tpl.imageLoadedAt ? _rdFmt(tpl.imageLoadedAt) : '';
    imgWarn = '<div style="display:flex;align-items:center;gap:10px;background:#0a1a0a;border:1px solid #1a4a1a;border-radius:8px;padding:8px 14px;margin-bottom:14px;">'
      + '<span style="font-size:14px;">📄</span>'
      + '<span style="color:#4ade80;font-size:12px;flex:1;font-weight:600;">'+_rdEsc(tpl.imageName)+'</span>'
      + (loadedDate ? '<span style="color:#3a6a3a;font-size:11px;">Chargé le '+loadedDate+'</span>' : '')
      + '<button class="btn btn-sm btn-outline" onclick="_rdOpenParametrage(\''+docId+'\')" '
        + 'style="border-color:#1a4a1a;color:#4ade80;font-size:11px;padding:3px 8px;">↺ Changer</button>'
    + '</div>';
  } else if (!hasImg && hasFields) {
    imgWarn = '<div style="display:flex;align-items:center;gap:10px;background:#150f00;border:1px solid #6b5000;border-radius:8px;padding:10px 14px;margin-bottom:14px;">'
      + '<span style="font-size:16px;">⚠</span>'
      + '<span style="color:#d4af37;font-size:12px;flex:1;">Aucune image chargée — allez dans Paramétrage pour charger le document.</span>'
      + '<button class="btn btn-sm" onclick="_rdOpenParametrage(\''+docId+'\')" '
        + 'style="background:#d4af37;color:#000;border:none;font-size:11px;padding:4px 10px;border-radius:5px;cursor:pointer;">📄 Charger</button>'
    + '</div>';
  } else {
    imgWarn = '';
  }

  var topBar = '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:14px;">'
    // Bouton retour
    + '<button class="btn btn-outline" onclick="_rdBackToList(\''+cat+'\')" style="border-color:#555;color:#888;font-size:12px;padding:4px 10px;">← Retour</button>'
    + '<span style="color:#666;font-size:13px;font-weight:700;">'+_rdEsc(doc.name)+'</span>'
    + '<button class="btn btn-outline" onclick="_rdOpenParametrage(\''+docId+'\')" style="border-color:#06b6d4;color:#06b6d4;margin-left:auto;">'
      + '⚙ Paramétrage'
      + (hasFields ? ' <span style="background:#06b6d4;color:#000;border-radius:10px;padding:1px 7px;font-size:10px;font-weight:700;margin-left:4px;">'+tpl.fields.length+'</span>' : '')
      + (styleLabel ? ' <span style="background:#111;color:#d4af37;border:1px solid #3a3000;border-radius:10px;padding:1px 7px;font-size:10px;margin-left:2px;">'+styleLabel+'</span>' : '')
    + '</button>'
    + (hasFields
        ? '<button class="btn btn-gold" onclick="_rdOpenNewForm(\''+docId+'\')">+ Nouveau formulaire</button>'
        : '<span style="color:#444;font-size:12px;font-style:italic;">Configurez d\'abord le document dans Paramétrage</span>')
    + (entries.length > 0 ? '<span style="color:#444;font-size:11px;">'+entries.length+' formulaire'+(entries.length > 1 ? 's' : '')+'</span>' : '')
  + '</div>';

  var listHtml;
  if (entries.length === 0) {
    listHtml = '<div style="text-align:center;padding:50px 20px;color:#444;background:#0d0d0d;border:1px solid #1a1a1a;border-radius:12px;">'
      + '<div style="font-size:36px;opacity:0.4;">📄</div>'
      + '<div style="margin-top:10px;font-size:13px;">Aucun formulaire enregistré</div>'
      + (hasFields ? '<div style="margin-top:5px;font-size:11px;color:#333;">Cliquez sur <em>+ Nouveau formulaire</em> pour commencer</div>' : '')
    + '</div>';
  } else {
    listHtml = '<div style="background:#0d0d0d;border:1px solid #1e1e1e;border-radius:12px;overflow:hidden;">'
      + '<div style="display:grid;grid-template-columns:1fr 130px 150px;padding:8px 14px;background:#161616;border-bottom:1px solid #222;">'
        + '<span style="color:#444;font-size:10px;font-weight:700;text-transform:uppercase;">Formulaire</span>'
        + '<span style="color:#444;font-size:10px;font-weight:700;text-transform:uppercase;">Date</span>'
        + '<span style="color:#444;font-size:10px;font-weight:700;text-transform:uppercase;text-align:right;">Actions</span>'
      + '</div>'
      + entries.slice().reverse().map(function(en) {
          return '<div style="display:grid;grid-template-columns:1fr 130px 150px;align-items:center;padding:11px 14px;border-bottom:1px solid #141414;transition:background 0.15s;" '
            + 'onmouseover="this.style.background=\'#111\'" onmouseout="this.style.background=\'\'">'
            + '<div style="font-size:13px;font-weight:600;color:#ddd;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;" '
              + 'ondblclick="_rdEditEntry(\''+docId+'\',\''+en.id+'\')" title="Double-clic pour modifier">📄 '+_rdEsc(en.name)+'</div>'
            + '<div style="color:#555;font-size:11px;">'+_rdFmt(en.createdAt)+'</div>'
            + '<div style="display:flex;gap:4px;justify-content:flex-end;">'
              + '<button class="btn btn-sm btn-outline" onclick="_rdEditEntry(\''+docId+'\',\''+en.id+'\')" style="padding:3px 8px;" title="Modifier">✏</button>'
              + '<button class="btn btn-sm btn-outline" onclick="_rdDuplicateEntry(\''+docId+'\',\''+en.id+'\')" style="padding:3px 8px;" title="Dupliquer">⧉</button>'
              + '<button class="btn btn-sm btn-outline" onclick="_rdPrintEntry(\''+docId+'\',\''+en.id+'\')" style="padding:3px 8px;" title="Imprimer">🖨</button>'
              + '<button class="btn btn-sm btn-danger" onclick="_rdDeleteEntry(\''+docId+'\',\''+en.id+'\')" style="padding:3px 8px;" title="Supprimer">×</button>'
            + '</div>'
          + '</div>';
        }).join('')
    + '</div>';
  }

  ed.innerHTML = imgWarn + topBar + listHtml;
}

function _rdBackToList(cat) {
  _rdCurrentDoc[cat] = null;
  _rdRender(cat);
}

// ── Créer / Renommer / Supprimer un document ─────────────────────────

function _rdCreateDocModal(cat) {
  var m = document.createElement('div');
  m.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);z-index:20000;display:flex;align-items:center;justify-content:center;';
  m.innerHTML = '<div style="background:#141414;width:94%;max-width:420px;border-radius:14px;border:1px solid #252525;overflow:hidden;">'
    + '<div style="padding:16px 20px;background:#181818;border-bottom:1px solid #252525;display:flex;align-items:center;justify-content:space-between;">'
      + '<h3 style="color:#d4af37;margin:0;font-size:14px;">📂 Nouveau document</h3>'
      + '<button onclick="this.closest(\'div[style*=position\\:fixed]\').remove()" style="background:none;border:none;color:#555;font-size:22px;cursor:pointer;line-height:1;">&times;</button>'
    + '</div>'
    + '<div style="padding:20px;">'
      + '<label style="display:block;color:#666;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">Nom du document</label>'
      + '<input id="_rdNewDocName" type="text" placeholder="Ex: Certificat de réalisation, Lettre de mission…" '
        + 'style="width:100%;background:#0a0a0a;border:1px solid #2a2a2a;border-radius:6px;padding:9px 12px;color:#e0e0e0;font-size:14px;outline:none;box-sizing:border-box;" '
        + 'onfocus="this.style.borderColor=\'#06b6d4\'" onblur="this.style.borderColor=\'#2a2a2a\'">'
    + '</div>'
    + '<div style="display:flex;justify-content:flex-end;gap:8px;padding:12px 20px;border-top:1px solid #1a1a1a;">'
      + '<button onclick="this.closest(\'div[style*=position\\:fixed]\').remove()" class="btn btn-outline">Annuler</button>'
      + '<button onclick="_rdCreateDocConfirm(\''+cat+'\')" class="btn btn-gold">Créer</button>'
    + '</div>'
  + '</div>';
  document.body.appendChild(m);
  m.addEventListener('click', function(e){ if (e.target === m) m.remove(); });
  setTimeout(function(){ var n=document.getElementById('_rdNewDocName'); if(n){n.focus();n.addEventListener('keydown',function(e){if(e.key==='Enter')_rdCreateDocConfirm(cat);});} }, 80);
}

function _rdCreateDocConfirm(cat) {
  var inp  = document.getElementById('_rdNewDocName');
  var name = (inp ? inp.value : '').trim();
  if (!name) { _rdToast('Entrez un nom pour ce document.', 'error'); return; }
  var docs = _rdGetDocs(cat);
  var docId = 'rdd_' + Date.now();
  docs.push({ id: docId, name: name, createdAt: new Date().toISOString() });
  _rdSaveDocs(cat, docs);
  // Fermer modal
  var m = document.querySelector('div[style*="z-index:20000"]');
  if (m) m.remove();
  _rdToast('Document créé : ' + name, 'success');
  _rdOpenDocView(cat, docId);
}

function _rdRenameDocModal(cat, docId, currentName) {
  var m = document.createElement('div');
  m.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);z-index:20000;display:flex;align-items:center;justify-content:center;';
  m.innerHTML = '<div style="background:#141414;width:94%;max-width:420px;border-radius:14px;border:1px solid #252525;overflow:hidden;">'
    + '<div style="padding:16px 20px;background:#181818;border-bottom:1px solid #252525;">'
      + '<h3 style="color:#d4af37;margin:0;font-size:14px;">✏ Renommer le document</h3>'
    + '</div>'
    + '<div style="padding:20px;">'
      + '<input id="_rdRenameDocInput" type="text" value="'+currentName+'" '
        + 'style="width:100%;background:#0a0a0a;border:1px solid #2a2a2a;border-radius:6px;padding:9px 12px;color:#e0e0e0;font-size:14px;outline:none;box-sizing:border-box;" '
        + 'onfocus="this.style.borderColor=\'#06b6d4\'" onblur="this.style.borderColor=\'#2a2a2a\'">'
    + '</div>'
    + '<div style="display:flex;justify-content:flex-end;gap:8px;padding:12px 20px;border-top:1px solid #1a1a1a;">'
      + '<button onclick="this.closest(\'div[style*=position\\:fixed]\').remove()" class="btn btn-outline">Annuler</button>'
      + '<button onclick="_rdRenameDocConfirm(\''+cat+'\',\''+docId+'\')" class="btn btn-gold">Enregistrer</button>'
    + '</div>'
  + '</div>';
  document.body.appendChild(m);
  m.addEventListener('click', function(e){ if (e.target === m) m.remove(); });
  setTimeout(function(){ var n=document.getElementById('_rdRenameDocInput'); if(n){n.focus();n.select();n.addEventListener('keydown',function(e){if(e.key==='Enter')_rdRenameDocConfirm(cat,docId);});} }, 80);
}

function _rdRenameDocConfirm(cat, docId) {
  var inp  = document.getElementById('_rdRenameDocInput');
  var name = (inp ? inp.value : '').trim();
  if (!name) return;
  var docs = _rdGetDocs(cat);
  var doc  = docs.find(function(d){ return d.id === docId; });
  if (doc) doc.name = name;
  _rdSaveDocs(cat, docs);
  var m = document.querySelector('div[style*="z-index:20000"]');
  if (m) m.remove();
  _rdToast('Document renommé ✓', 'success');
  _rdRender(cat);
}

function _rdDeleteDoc(cat, docId) {
  var docs = _rdGetDocs(cat);
  var doc  = docs.find(function(d){ return d.id === docId; });
  if (!doc) return;
  if (!confirm('Supprimer le document "' + doc.name + '" et tous ses formulaires ?')) return;
  // Supprimer les données
  try { localStorage.removeItem('mp_rdtpl_' + docId); } catch(e) {}
  try { localStorage.removeItem('mp_rdent_' + docId); } catch(e) {}
  delete _rdDB[docId + '_tpl'];
  delete _rdDB[docId + '_entries'];
  if (_rdImages[docId] && String(_rdImages[docId]).startsWith('blob:')) URL.revokeObjectURL(_rdImages[docId]);
  delete _rdImages[docId];
  delete _rdImagesData[docId];
  _rdSaveDocs(cat, docs.filter(function(d){ return d.id !== docId; }));
  _rdToast('Document supprimé', 'warn');
  _rdRender(cat);
}

// ── _rdRender (doc view) alias pour les fonctions internes ───────────

function _rdRenderFromDocId(docId) {
  // Retrouver cat depuis docId pour rafraîchir la vue
  var cats = ['das', 'autres'];
  for (var i = 0; i < cats.length; i++) {
    var docs = _rdGetDocs(cats[i]);
    if (docs.find(function(d){ return d.id === docId; })) {
      _rdRenderDocView(cats[i], docId);
      return;
    }
  }
}


// ══════════════════════════════════════════════════════════════════════
// MODAL PARAMÉTRAGE
// ══════════════════════════════════════════════════════════════════════

function _rdOpenParametrage(cat) {
  var modal = document.getElementById('rd-param-modal');
  if (!modal) { _rdCreateParamModal(); modal = document.getElementById('rd-param-modal'); }
  modal.style.display = 'flex';
  modal.style.zIndex = '10000';
  _rdRenderParamCanvas(cat);
}

function _rdCreateParamModal() {
  var m = document.createElement('div');
  m.id = 'rd-param-modal';
  m.style.cssText = 'display:none;position:fixed;top:0;left:0;right:0;bottom:0;width:100%;height:100%;'
    + 'background:rgba(0,0,0,0.88);z-index:10000;overflow-y:auto;';
  m.innerHTML =
    '<div style="background:#141414;width:95%;max-width:1100px;margin:20px auto;border-radius:16px;'
      + 'border:1px solid #252525;display:flex;flex-direction:column;max-height:calc(100vh - 40px);">'
      // Header
      + '<div style="display:flex;align-items:center;justify-content:space-between;padding:14px 22px;background:#181818;border-bottom:1px solid #252525;border-radius:16px 16px 0 0;flex-shrink:0;">'
        + '<h3 style="color:#06b6d4;margin:0;font-size:15px;font-weight:700;">⚙ Paramétrage du document</h3>'
        + '<div style="display:flex;gap:8px;align-items:center;">'
          + '<button class="btn btn-sm btn-gold" id="rd-param-save-btn">✓ Enregistrer</button>'
          + '<button style="background:none;border:none;color:#555;font-size:22px;cursor:pointer;line-height:1;padding:0 4px;" '
            + 'onclick="document.getElementById(\'rd-param-modal\').style.display=\'none\'" title="Fermer (Echap)">&times;</button>'
        + '</div>'
      + '</div>'
      // Toolbar
      + '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:9px 22px;background:#0e0e0e;border-bottom:1px solid #1a1a1a;flex-shrink:0;">'
        + '<span style="color:#06b6d4;font-size:11px;font-weight:700;">🖱 Cliquez sur le document pour placer un champ</span>'
        + '<div style="margin-left:auto;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">'
          + '<input type="file" id="rd-param-file" accept="image/*,application/pdf" style="display:none;" onchange="_rdParamLoadImg(this)">'
          + '<button class="btn btn-sm btn-outline" onclick="document.getElementById(\'rd-param-file\').click()">📄 Charger image / PDF</button>'
          + '<button class="btn btn-sm btn-danger" onclick="_rdParamClearAll()" style="font-size:11px;" title="Supprimer tous les champs">🗑 Tout effacer</button>'
        + '</div>'
      + '</div>'
      // Canvas
      + '<div id="rd-param-canvas-zone" style="padding:16px 22px;flex:1;overflow-y:auto;min-height:200px;">'
        + '<div style="text-align:center;padding:60px;color:#333;">Chargez un document pour commencer</div>'
      + '</div>'
    + '</div>';
  document.body.appendChild(m);
}

var _rdParamCat = null;

function _rdRenderParamCanvas(cat) {
  _rdParamCat = cat;
  _rdEnsureImage(cat); // restaurer depuis localStorage si besoin
  var zone = document.getElementById('rd-param-canvas-zone');
  if (!zone) return;
  var tpl = _rdGetTemplate(cat);
  var img = _rdImages[cat];

  // Sync style select
  var styleSel = document.getElementById('rd-param-style');
  if (styleSel) styleSel.value = tpl.writingStyle || 'normal';

  // Bouton save
  var saveBtn = document.getElementById('rd-param-save-btn');
  if (saveBtn) saveBtn.onclick = function(){ _rdParamSave(cat); };

  if (!img) {
    zone.innerHTML = '<div style="text-align:center;padding:60px 20px;color:#333;">'
      + '<div style="font-size:40px;opacity:0.3;">📄</div>'
      + '<div style="margin-top:12px;font-size:13px;">Chargez une image ou un PDF du document</div>'
      + '<div style="margin-top:6px;font-size:11px;color:#2a2a2a;">L\'image ne sera pas sauvegardée — rechargement nécessaire à chaque session</div>'
    + '</div>';
    return;
  }

  zone.innerHTML = '<div style="color:#06b6d4;font-size:11px;font-weight:700;text-align:center;margin-bottom:8px;">'
    + '🖱 Cliquez sur le document pour placer un champ'
    + '</div>';

  var canvas = document.createElement('div');
  canvas.id = 'rd-param-canvas';
  canvas.style.cssText = 'position:relative;width:100%;cursor:crosshair;display:block;user-select:none;';
  canvas.onclick = function(e) { _rdParamClick(e); };

  var imgEl = document.createElement('img');
  imgEl.src = img;
  imgEl.style.cssText = 'width:100%;display:block;max-width:100%;pointer-events:none;';
  imgEl.draggable = false;
  imgEl.onerror = function() {
    zone.innerHTML = '<div style="color:#ef4444;text-align:center;padding:40px;">'
      + '<div style="font-size:28px;">⚠</div>'
      + '<div style="margin-top:8px;font-size:13px;">Impossible d\'afficher l\'image</div>'
      + '<button class="btn btn-sm btn-outline" style="margin-top:12px;" onclick="document.getElementById(\'rd-param-file\').click()">↺ Recharger</button>'
    + '</div>';
  };
  canvas.appendChild(imgEl);
  zone.appendChild(canvas);

  var hint = document.createElement('div');
  hint.style.cssText = 'color:#2a2a2a;font-size:10px;text-align:center;margin-top:6px;';
  hint.textContent = 'Glissez les badges pour repositionner. Cliquez sur le label pour renommer.';
  zone.appendChild(hint);

  (tpl.fields || []).forEach(function(f) { _rdParamPlaceField(f); });
}

function _rdParamLoadImg(input) {
  var file = input.files && input.files[0];
  if (!file || !_rdParamCat) return;
  var cat = _rdParamCat;
  var zone = document.getElementById('rd-param-canvas-zone');
  if (zone) zone.innerHTML = '<div style="text-align:center;padding:60px;color:#d4af37;">⏳ Chargement…</div>';

  var tpl = _rdGetTemplate(cat);
  var isPdf = (file.type === 'application/pdf');
  tpl.imgType = isPdf ? 'pdf' : 'image';

  var reader = new FileReader();
  reader.onload = function(e) {
    var dataUrl = e.target.result;
    if (isPdf) {
      _rdPdfToImage(dataUrl, function(imgDataUrl) {
        tpl.imgType = 'image';
        _rdImages[cat] = imgDataUrl;
        _rdImagesData[cat] = imgDataUrl;
        _rdSaveImageToTpl(cat, imgDataUrl, file.name);
        _rdRenderParamCanvas(cat);
        _rdToast('Document chargé et enregistré ✓', 'success');
      });
    } else {
      _rdImages[cat] = dataUrl;
      _rdImagesData[cat] = dataUrl;
      _rdSaveImageToTpl(cat, dataUrl, file.name);
      _rdRenderParamCanvas(cat);
      _rdToast('Image chargée et enregistrée ✓', 'success');
    }
  };
  reader.readAsDataURL(file);
  input.value = '';
}

// Sauvegarde l'image dans le template (localStorage) — survit au rechargement
function _rdSaveImageToTpl(cat, dataUrl, fileName) {
  var tpl = _rdGetTemplate(cat);
  tpl.imageName     = fileName || 'document';
  tpl.imageLoadedAt = new Date().toISOString();
  tpl.imageData     = dataUrl;
  try {
    _rdSaveTemplate(cat);
  } catch(e) {
    // localStorage plein — on garde en mémoire seulement
    tpl.imageData = null;
    _rdToast('Image trop volumineuse pour être sauvegardée automatiquement.', 'warn');
  }
}

// Restaure l'image depuis localStorage si elle n'est pas en mémoire
function _rdEnsureImage(cat) {
  if (_rdImages[cat]) return;
  var tpl = _rdGetTemplate(cat);
  if (tpl.imageData) {
    _rdImages[cat]     = tpl.imageData;
    _rdImagesData[cat] = tpl.imageData;
  }
}

function _rdPdfToImage(pdfDataUrl, callback) {
  function doRender() {
    var pdfjsLib = window['pdfjs-dist/build/pdf'] || window.pdfjsLib;
    if (!pdfjsLib) { callback(pdfDataUrl); return; }
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    pdfjsLib.getDocument(pdfDataUrl).promise.then(function(pdf) {
      pdf.getPage(1).then(function(page) {
        var scale = 2.0;
        var vp = page.getViewport({ scale: scale });
        var cvs = document.createElement('canvas');
        cvs.width = vp.width; cvs.height = vp.height;
        page.render({ canvasContext: cvs.getContext('2d'), viewport: vp }).promise.then(function() {
          callback(cvs.toDataURL('image/png'));
        });
      });
    }).catch(function() { callback(pdfDataUrl); });
  }
  if (window.pdfjsLib || window['pdfjs-dist/build/pdf']) {
    doRender();
  } else {
    var s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    s.onload = doRender;
    s.onerror = function() { callback(pdfDataUrl); };
    document.head.appendChild(s);
  }
}

function _rdParamClick(event) {
  if (!_rdParamCat) return;
  if (event.target.tagName === 'BUTTON' || event.target.tagName === 'INPUT') return;
  if (event.target.closest && event.target.closest('.rd-param-field')) return;

  var canvas = document.getElementById('rd-param-canvas');
  if (!canvas) return;
  var rect = canvas.getBoundingClientRect();
  var x = (event.clientX - rect.left) / rect.width * 100;
  var y = (event.clientY - rect.top) / rect.height * 100;

  var tpl = _rdGetTemplate(_rdParamCat);
  var num = tpl.fields.length + 1;
  var fsEl = document.getElementById('rd-param-fs') || document.getElementById('rd-form-fs');
  var fs = fsEl ? (parseInt(fsEl.value) || 14) : 14;
  var tplColor = _rdGetTemplate(_rdParamCat);
  var color = (tplColor && tplColor.defaultColor) ? tplColor.defaultColor : '#000000';
  var field = { id: 'rdp_' + Date.now(), label: String(num), num: num, x: x, y: y, fontSize: fs, color: color };
  tpl.fields.push(field);
  _rdSaveTemplate(_rdParamCat);
  _rdParamPlaceField(field);
}

function _rdParamPlaceField(f) {
  var canvas = document.getElementById('rd-param-canvas');
  if (!canvas) return;
  var old = document.getElementById('rdpw_' + f.id);
  if (old) old.remove();

  var tpl = _rdGetTemplate(_rdParamCat || f._cat);
  var num = f.num || (tpl.fields.findIndex(function(x){ return x.id === f.id; }) + 1) || 1;

  var wrap = document.createElement('div');
  wrap.id = 'rdpw_' + f.id;
  wrap.className = 'rd-param-field';
  wrap.style.cssText = 'position:absolute;left:'+f.x.toFixed(3)+'%;top:'+f.y.toFixed(3)+'%;'
    + 'transform:translate(-50%,-50%);z-index:20;display:flex;flex-direction:column;align-items:center;gap:2px;';

  // Badge numéroté (draggable)
  var badge = document.createElement('div');
  badge.style.cssText = 'background:#06b6d4;color:#000;font-size:11px;font-weight:900;'
    + 'width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;'
    + 'border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.6);cursor:move;user-select:none;flex-shrink:0;';
  badge.textContent = num;
  badge.title = 'Glisser pour déplacer';

  // Label cliquable pour renommer
  var labelEl = document.createElement('div');
  labelEl.style.cssText = 'background:rgba(6,182,212,0.15);border:1px solid rgba(6,182,212,0.3);'
    + 'color:#06b6d4;font-size:9px;padding:1px 6px;border-radius:3px;white-space:nowrap;'
    + 'cursor:text;max-width:90px;overflow:hidden;text-overflow:ellipsis;transition:background 0.15s;';
  labelEl.textContent = f.label || ('Champ ' + num);
  labelEl.title = 'Cliquer pour renommer';
  labelEl.onclick = function(e) { e.stopPropagation(); _rdEditFieldLabel(f, labelEl); };
  labelEl.onmouseover = function() { labelEl.style.background = 'rgba(6,182,212,0.28)'; };
  labelEl.onmouseout  = function() { labelEl.style.background = 'rgba(6,182,212,0.15)'; };

  // Bouton supprimer
  var del = document.createElement('button');
  del.title = 'Supprimer ce champ';
  del.innerHTML = '&times;';
  del.style.cssText = 'background:rgba(239,68,68,0.8);color:#fff;border:none;border-radius:3px;'
    + 'width:18px;height:18px;font-size:13px;cursor:pointer;padding:0;line-height:1;flex-shrink:0;';
  del.onclick = function(e) {
    e.stopPropagation();
    var tpl2 = _rdGetTemplate(_rdParamCat);
    tpl2.fields = tpl2.fields.filter(function(x){ return x.id !== f.id; });
    tpl2.fields.forEach(function(x, i){ x.num = i + 1; });
    _rdSaveTemplate(_rdParamCat);
    _rdRenderParamCanvas(_rdParamCat);
  };

  var row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:2px;align-items:center;';
  row.appendChild(labelEl);
  row.appendChild(del);

  wrap.appendChild(badge);
  wrap.appendChild(row);
  canvas.appendChild(wrap);

  // Drag & drop
  var dragging = false, startX, startY, startLeft, startTop;

  function onDragStart(e) {
    e.stopPropagation();
    dragging = true;
    startX = e.clientX; startY = e.clientY;
    startLeft = f.x; startTop = f.y;
    wrap.style.transition = 'none';
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);
  }
  function onDragMove(e) {
    if (!dragging) return;
    var rect2 = canvas.getBoundingClientRect();
    var nx = Math.max(0, Math.min(100, startLeft + (e.clientX - startX) / rect2.width * 100));
    var ny = Math.max(0, Math.min(100, startTop  + (e.clientY - startY) / rect2.height * 100));
    wrap.style.left = nx.toFixed(3) + '%';
    wrap.style.top  = ny.toFixed(3) + '%';
  }
  function onDragEnd(e) {
    if (!dragging) return;
    dragging = false;
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup', onDragEnd);
    var rect2 = canvas.getBoundingClientRect();
    f.x = Math.max(0, Math.min(100, startLeft + (e.clientX - startX) / rect2.width * 100));
    f.y = Math.max(0, Math.min(100, startTop  + (e.clientY - startY) / rect2.height * 100));
    var tpl2 = _rdGetTemplate(_rdParamCat);
    var idx = tpl2.fields.findIndex(function(x){ return x.id === f.id; });
    if (idx >= 0) { tpl2.fields[idx].x = f.x; tpl2.fields[idx].y = f.y; }
    _rdSaveTemplate(_rdParamCat);
    wrap.style.left = f.x.toFixed(3) + '%';
    wrap.style.top  = f.y.toFixed(3) + '%';
  }
  badge.addEventListener('mousedown', onDragStart);
}

// Édition inline du label d'un champ
function _rdEditFieldLabel(f, labelEl) {
  var inp = document.createElement('input');
  inp.type = 'text';
  inp.value = f.label || '';
  inp.style.cssText = 'background:#0a0a0a;color:#06b6d4;border:1px solid #06b6d4;border-radius:3px;'
    + 'font-size:9px;padding:2px 5px;width:86px;outline:none;';
  labelEl.replaceWith(inp);
  inp.focus(); inp.select();

  function commit() {
    var newLabel = (inp.value || '').trim() || f.label || ('Champ ' + f.num);
    f.label = newLabel;
    var tpl = _rdGetTemplate(_rdParamCat);
    var idx = tpl.fields.findIndex(function(x){ return x.id === f.id; });
    if (idx >= 0) tpl.fields[idx].label = newLabel;
    _rdSaveTemplate(_rdParamCat);
    // Recréer le labelEl
    var newEl = document.createElement('div');
    newEl.style.cssText = 'background:rgba(6,182,212,0.15);border:1px solid rgba(6,182,212,0.3);'
      + 'color:#06b6d4;font-size:9px;padding:1px 6px;border-radius:3px;white-space:nowrap;'
      + 'cursor:text;max-width:90px;overflow:hidden;text-overflow:ellipsis;transition:background 0.15s;';
    newEl.textContent = newLabel;
    newEl.title = 'Cliquer pour renommer';
    newEl.onclick = function(e){ e.stopPropagation(); _rdEditFieldLabel(f, newEl); };
    newEl.onmouseover = function(){ newEl.style.background = 'rgba(6,182,212,0.28)'; };
    newEl.onmouseout  = function(){ newEl.style.background = 'rgba(6,182,212,0.15)'; };
    inp.replaceWith(newEl);
  }
  inp.onblur = commit;
  inp.onkeydown = function(e) {
    if (e.key === 'Enter')  { inp.blur(); }
    if (e.key === 'Escape') { inp.value = f.label || ''; inp.blur(); }
    e.stopPropagation();
  };
}

function _rdParamClearAll() {
  if (!_rdParamCat) return;
  if (!confirm('Supprimer tous les champs du paramétrage ?')) return;
  var tpl = _rdGetTemplate(_rdParamCat);
  tpl.fields = [];
  _rdSaveTemplate(_rdParamCat);
  _rdRenderParamCanvas(_rdParamCat);
  _rdToast('Champs supprimés', 'warn');
}

function _rdParamStyleChange() {
  if (!_rdParamCat) return;
  var sel = document.getElementById('rd-param-style');
  if (!sel) return;
  var tpl = _rdGetTemplate(_rdParamCat);
  tpl.writingStyle = sel.value;
  _rdSaveTemplate(_rdParamCat);
}

function _rdParamSave(cat) {
  var modal = document.getElementById('rd-param-modal');
  if (modal) modal.style.display = 'none';
  _rdRenderFromDocId(cat);
  var n = _rdGetTemplate(cat).fields.length;
  _rdToast('Paramétrage enregistré — ' + n + ' champ' + (n > 1 ? 's' : ''), 'success');
}

// ══════════════════════════════════════════════════════════════════════
// MODAL FORMULAIRE
// ══════════════════════════════════════════════════════════════════════

var _rdFormCat = null;
var _rdFormEntryId = null;

function _rdOpenNewForm(cat)         { _rdFormCat = cat; _rdFormEntryId = null;    _rdShowFormModal(cat, null); }
function _rdEditEntry(cat, entryId)  { _rdFormCat = cat; _rdFormEntryId = entryId; _rdShowFormModal(cat, entryId); }

function _rdShowFormModal(cat, entryId) {
  var modal = document.getElementById('rd-form-modal');
  if (!modal) { _rdCreateFormModal(); modal = document.getElementById('rd-form-modal'); }

  var tpl     = _rdGetTemplate(cat);
  var entries = _rdGetEntries(cat);
  var entry   = entryId ? entries.find(function(e){ return e.id === entryId; }) : null;
  var values  = entry ? entry.values : {};
  var zooms   = entry ? (entry.zooms  || {}) : {};
  var colors  = entry ? (entry.colors || {}) : {};
  var styles  = entry ? (entry.styles || {}) : {};
  var style   = tpl.writingStyle || 'normal';
  var styleLabel = { fr: '✍ FR Manuscrit', ar: '✍ AR Manuscrit' }[style] || '';

  var body = document.getElementById('rd-form-body');
  if (!body) return;

  body.innerHTML =
    '<div style="margin-bottom:14px;">'
      + '<label style="display:block;color:#666;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:5px;">Nom du formulaire *</label>'
      + '<input type="text" id="rd-form-name" value="'+_rdEsc(entry ? entry.name : '')+'" placeholder="Ex: Dossier Ahmed…" '
        + 'style="width:100%;background:#0a0a0a;border:1px solid #2a2a2a;border-radius:6px;padding:9px 12px;color:#e0e0e0;font-size:14px;outline:none;box-sizing:border-box;" '
        + 'onfocus="this.style.borderColor=\'#06b6d4\'" onblur="this.style.borderColor=\'#2a2a2a\'">'
    + '</div>'
    // Taille + Style — déplacés ici depuis le paramétrage
    + '<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;background:#0e0e0e;border:1px solid #1a1a1a;border-radius:8px;padding:9px 14px;margin-bottom:12px;">'
      + '<span style="color:#555;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;">Mise en forme</span>'
      + '<div style="display:flex;align-items:center;gap:6px;margin-left:auto;">'
        + '<label style="color:#666;font-size:11px;">Taille</label>'
        + '<select id="rd-form-fs" style="background:#111;color:#e0e0e0;border:1px solid #2a2a2a;border-radius:4px;padding:3px 8px;font-size:12px;">'
        + [10,11,12,13,14,15,16,18,20,22,24].map(function(n){ var sel=((tpl.defaultFontSize||14)==n)?' selected':''; return '<option'+sel+'>'+n+'</option>'; }).join('')
        + '</select>'
        + '<label style="color:#666;font-size:11px;margin-left:4px;">Couleur</label>'
        + '<input type="color" id="rd-form-color" value="'+(tpl.defaultColor||'#000000')+'" title="Couleur du texte" '
          + 'style="width:28px;height:26px;border:1px solid #2a2a2a;border-radius:4px;cursor:pointer;background:none;padding:0;" '
          + 'oninput="_rdSyncFieldColors(this.value)">'
        + '<label style="color:#666;font-size:11px;margin-left:4px;">Style</label>'
        + '<select id="rd-form-style" style="background:#111;color:#e0e0e0;border:1px solid #2a2a2a;border-radius:4px;padding:3px 8px;font-size:12px;">'
        + '<option value="normal"'+(style==='normal'?' selected':'')+'>Normal</option>'
        + '<option value="fr"'+(style==='fr'?' selected':'')+'>✍ FR Manuscrit</option>'
        + '<option value="ar"'+(style==='ar'?' selected':'')+'>✍ AR Manuscrit</option>'
        + '</select>'
      + '</div>'
    + '</div>'
    + (styleLabel
        ? '<div style="background:#0d1a0d;border:1px solid #1a3a1a;border-radius:6px;padding:6px 12px;margin-bottom:10px;color:#4ade80;font-size:11px;">'+styleLabel+' — le texte sera rendu en écriture manuscrite</div>'
        : '')
    + '<div style="display:grid;grid-template-columns:110px 1fr 1.2fr 120px;gap:5px;padding:7px 10px;background:#0e0e0e;border-radius:6px;margin-bottom:6px;">'
      + '<span style="color:#06b6d4;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;">📌 Champ</span>'
      + '<span style="color:#888;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;">💬 Question <span style="font-weight:400;color:#444;font-style:italic;">(non imprimée)</span></span>'
      + '<span style="color:#d4af37;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;">✏ Valeur imprimée</span>'
      + '<span style="color:#a78bfa;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;text-align:center;">🎨 Mise en forme</span>'
    + '</div>'
    + '<div style="display:flex;flex-direction:column;gap:5px;">'
    + tpl.fields.map(function(f){
        var zVal    = zooms[f.id]  ? zooms[f.id]  : '';
        var cVal    = colors[f.id] ? colors[f.id] : '';
        var sVal    = styles[f.id] ? styles[f.id] : '';
        var defFs   = tpl.defaultFontSize || 14;
        var defCol  = tpl.defaultColor    || '#000000';
        var defSty  = tpl.writingStyle    || 'normal';
        // Couleur affichée = override si défini, sinon couleur générale (toujours visible)
        var shownColor = cVal || defCol;
        var hasOverride = zVal || cVal || sVal;
        var rowBorder   = hasOverride ? '1px solid #3a2a5a' : '1px solid #181818';
        return '<div style="display:grid;grid-template-columns:110px 1fr 1.2fr 120px;gap:5px;align-items:center;padding:8px 10px;'
          + 'background:#080808;border:'+rowBorder+';border-radius:6px;" data-defcol="'+defCol+'">'
          + '<div style="color:#06b6d4;font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="'+_rdEsc(f.label)+'">'+_rdEsc(f.label)+'</div>'
          + '<input type="text" class="rd-form-question" data-fid="'+f.id+'" value="'+_rdEsc(f.question||'')+'" placeholder="Question guide…" '
            + 'style="background:#0d0d0d;border:1px solid #1e1e1e;border-radius:4px;padding:6px 8px;color:#888;font-size:12px;font-style:italic;outline:none;width:100%;box-sizing:border-box;" '
            + 'onfocus="this.style.borderColor=\'#555\';this.style.color=\'#aaa\'" onblur="this.style.borderColor=\'#1e1e1e\';this.style.color=\'#888\'">'
          + '<input type="text" class="rd-form-field" data-fid="'+f.id+'" value="'+_rdEsc(values[f.id]||'')+'" placeholder="Écrire ici…" '
            + 'style="background:#111;border:1px solid #222;border-radius:4px;padding:6px 8px;color:#e0e0e0;font-size:13px;outline:none;width:100%;box-sizing:border-box;" '
            + 'onfocus="this.style.borderColor=\'#d4af37\'" onblur="this.style.borderColor=\'#222\'">'
          // Mise en forme par champ : taille, couleur, style
          + '<div style="display:flex;flex-direction:column;gap:3px;align-items:center;">'
            // Taille
            + '<div style="display:flex;align-items:center;gap:2px;">'
              + '<button type="button" onclick="var i=this.nextElementSibling;i.value=Math.max(8,(parseInt(i.value)||'+defFs+')-1);this.closest(\'div[data-defcol]\').style.border=\'1px solid #3a2a5a\';" '
                + 'style="background:#1a1a2e;color:#a78bfa;border:1px solid #2a2a4a;border-radius:3px;width:18px;height:20px;font-size:13px;cursor:pointer;padding:0;line-height:1;flex-shrink:0;">−</button>'
              + '<input type="number" class="rd-form-zoom" data-fid="'+f.id+'" value="'+zVal+'" placeholder="'+defFs+'" min="8" max="48" '
                + 'style="background:#0d0d1a;border:1px solid #2a2a4a;border-radius:3px;padding:2px 1px;color:#a78bfa;font-size:11px;outline:none;width:28px;text-align:center;box-sizing:border-box;" '
                + 'title="Vide = taille générale ('+defFs+'px)">'
              + '<button type="button" onclick="var i=this.previousElementSibling;i.value=Math.min(48,(parseInt(i.value)||'+defFs+')+1);this.closest(\'div[data-defcol]\').style.border=\'1px solid #3a2a5a\';" '
                + 'style="background:#1a1a2e;color:#a78bfa;border:1px solid #2a2a4a;border-radius:3px;width:18px;height:20px;font-size:13px;cursor:pointer;padding:0;line-height:1;flex-shrink:0;">+</button>'
            + '</div>'
            // Couleur (toujours pré-remplie avec la couleur générale)
            + '<div style="display:flex;align-items:center;gap:3px;">'
              + '<input type="color" class="rd-form-field-color" data-fid="'+f.id+'" data-override="'+(cVal?'1':'')+'" value="'+shownColor+'" '
                + 'style="width:28px;height:20px;border:1px solid #2a2a4a;border-radius:3px;cursor:pointer;background:none;padding:0;" '
                + 'title="Couleur de ce champ — pré-remplie avec la couleur générale" '
                + 'onchange="this.dataset.override=\'1\';this.closest(\'div[data-defcol]\').style.border=\'1px solid #3a2a5a\';">'
              // Style (Normal/FR/AR) par champ
              + '<select class="rd-form-field-style" data-fid="'+f.id+'" '
                + 'style="background:#0d0d1a;color:#a78bfa;border:1px solid #2a2a4a;border-radius:3px;font-size:10px;padding:2px 3px;width:42px;outline:none;cursor:pointer;" '
                + 'title="Style de ce champ (vide = style général)" '
                + 'onchange="this.closest(\'div[data-defcol]\').style.border=\'1px solid #3a2a5a\';">'
                + '<option value="" '+(sVal===''?'selected':'')+' style="color:#555;">↑ Gén</option>'
                + '<option value="normal"'+(sVal==='normal'?' selected':'')+'>N</option>'
                + '<option value="fr"'+(sVal==='fr'?' selected':'')+'>FR</option>'
                + '<option value="ar"'+(sVal==='ar'?' selected':'')+'>AR</option>'
              + '</select>'
            + '</div>'
            // Reset
            + '<button type="button" '
              + 'onclick="var row=this.closest(\'div[data-defcol]\');var dc=row.dataset.defcol;'
                + 'row.querySelector(\'.rd-form-zoom\').value=\'\';'
                + 'row.querySelector(\'.rd-form-field-color\').value=dc;row.querySelector(\'.rd-form-field-color\').dataset.override=\'\';'
                + 'row.querySelector(\'.rd-form-field-style\').value=\'\';'
                + 'row.style.border=\'1px solid #181818\';" '
              + 'style="background:#111;color:#444;border:1px solid #222;border-radius:3px;width:70px;height:16px;font-size:9px;cursor:pointer;padding:0;line-height:1;" '
              + 'title="Utiliser la mise en forme générale pour ce champ">↺ Général</button>'
          + '</div>'
        + '</div>';
      }).join('')
    + '</div>';

  modal.style.display = 'flex';
  modal.style.zIndex = '10001';

  var title = document.getElementById('rd-form-title');
  if (title) title.textContent = entryId ? '✏ Modifier' : '+ Nouveau formulaire';

  var saveBtn = document.getElementById('rd-form-save-btn');
  if (saveBtn) saveBtn.onclick = function(){ _rdSaveForm(cat, entryId); };

  var printBtn = document.getElementById('rd-form-print-btn');
  if (printBtn) {
    printBtn.style.display = entryId ? 'inline-flex' : 'none';
    printBtn.onclick = function(){ _rdPrintEntry(cat, entryId); };
  }

  var apercuBtn = document.getElementById('rd-form-apercu-btn');
  if (apercuBtn) apercuBtn.onclick = function(){ _rdApercu(cat); };

  setTimeout(function(){ var n = document.getElementById('rd-form-name'); if (n) n.focus(); }, 80);
}

function _rdCreateFormModal() {
  var m = document.createElement('div');
  m.id = 'rd-form-modal';
  m.style.cssText = 'display:none;position:fixed;top:0;left:0;width:100%;height:100%;'
    + 'background:rgba(0,0,0,0.82);z-index:10001;align-items:center;justify-content:center;';
  m.innerHTML =
    '<div style="background:#141414;width:96%;max-width:780px;border-radius:14px;'
      + 'border:1px solid #222;overflow:hidden;max-height:90vh;display:flex;flex-direction:column;'
      + 'box-shadow:0 8px 40px rgba(0,0,0,0.8);">'
      + '<div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;'
        + 'background:#181818;border-bottom:1px solid #222;flex-shrink:0;">'
        + '<h3 id="rd-form-title" style="color:#d4af37;margin:0;font-size:14px;font-weight:700;"></h3>'
        + '<button style="background:none;border:none;color:#444;font-size:22px;cursor:pointer;line-height:1;padding:0 4px;" '
          + 'onclick="document.getElementById(\'rd-form-modal\').style.display=\'none\'" title="Fermer (Echap)">&times;</button>'
      + '</div>'
      + '<div id="rd-form-body" style="flex:1;overflow-y:auto;padding:18px;"></div>'
      + '<div style="display:flex;justify-content:flex-end;gap:6px;padding:12px 18px;border-top:1px solid #1a1a1a;flex-shrink:0;flex-wrap:wrap;">'
        + '<button id="rd-form-apercu-btn" class="btn btn-outline" style="border-color:#06b6d4;color:#06b6d4;font-size:12px;">&#128065; Aper&ccedil;u</button>'
        + '<button id="rd-form-print-btn" class="btn btn-outline" style="display:none;font-size:12px;">&#128424; Imprimer</button>'
        + '<button class="btn btn-outline" onclick="document.getElementById(\'rd-form-modal\').style.display=\'none\'" style="font-size:12px;">Annuler</button>'
        + '<button id="rd-form-save-btn" class="btn btn-gold" style="font-size:12px;">&#128190; Enregistrer</button>'
      + '</div>'
    + '</div>';
  document.body.appendChild(m);
}

function _rdSaveForm(cat, entryId) {
  var nameEl = document.getElementById('rd-form-name');
  var name = (nameEl ? nameEl.value : '').trim();
  if (!name) { _rdToast('Donnez un nom à ce formulaire.', 'error'); return; }
  var values = {};
  document.querySelectorAll('.rd-form-field').forEach(function(inp){
    values[inp.getAttribute('data-fid')] = inp.value || '';
  });
  // Sauvegarder Taille + Style + Questions dans le template
  var tplForQ = _rdGetTemplate(cat);
  var fsEl = document.getElementById('rd-form-fs');
  if (fsEl) tplForQ.defaultFontSize = parseInt(fsEl.value) || 14;
  var colorEl = document.getElementById('rd-form-color');
  if (colorEl) tplForQ.defaultColor = colorEl.value || '#000000';
  var styleEl = document.getElementById('rd-form-style');
  if (styleEl) tplForQ.writingStyle = styleEl.value;
  // Taille par champ (zoom)
  var zooms = {};
  document.querySelectorAll('.rd-form-zoom').forEach(function(inp){
    var v = parseInt(inp.value);
    if (v && v >= 8) zooms[inp.getAttribute('data-fid')] = v;
  });
  // Couleur par champ (seulement si l'utilisateur a modifié = data-override='1')
  var colors = {};
  document.querySelectorAll('.rd-form-field-color').forEach(function(inp){
    if (inp.dataset.override === '1') colors[inp.getAttribute('data-fid')] = inp.value;
  });
  // Style par champ
  var styles = {};
  document.querySelectorAll('.rd-form-field-style').forEach(function(sel){
    if (sel.value) styles[sel.getAttribute('data-fid')] = sel.value;
  });
  document.querySelectorAll('.rd-form-question').forEach(function(inp){
    var fid = inp.getAttribute('data-fid');
    var field = tplForQ.fields.find(function(f){ return f.id === fid; });
    if (field) field.question = inp.value || '';
  });
  _rdSaveTemplate(cat);
  var entries = _rdGetEntries(cat);
  if (entryId) {
    var idx = entries.findIndex(function(e){ return e.id === entryId; });
    if (idx >= 0) { entries[idx].name = name; entries[idx].values = values; entries[idx].zooms = zooms; entries[idx].colors = colors; entries[idx].styles = styles; entries[idx].updatedAt = new Date().toISOString(); }
  } else {
    entries.push({ id: 'rde_' + Date.now(), name: name, createdAt: new Date().toISOString(), values: values, zooms: zooms, colors: colors, styles: styles });
  }
  _rdSaveEntries(cat);
  document.getElementById('rd-form-modal').style.display = 'none';
  _rdRenderFromDocId(cat);
  _rdToast(entryId ? 'Formulaire modifié ✓' : 'Formulaire enregistré ✓', 'success');
}

function _rdDeleteEntry(cat, entryId) {
  if (!confirm('Supprimer ce formulaire ?')) return;
  _rdDB[cat + '_entries'] = _rdGetEntries(cat).filter(function(e){ return e.id !== entryId; });
  _rdSaveEntries(cat);
  _rdRenderFromDocId(cat);
  _rdToast('Formulaire supprimé', 'warn');
}

function _rdDuplicateEntry(cat, entryId) {
  var entries = _rdGetEntries(cat);
  var src = entries.find(function(e){ return e.id === entryId; });
  if (!src) return;
  entries.push({
    id: 'rde_' + Date.now(),
    name: src.name + ' (copie)',
    createdAt: new Date().toISOString(),
    values: JSON.parse(JSON.stringify(src.values || {})),
    zooms:  JSON.parse(JSON.stringify(src.zooms  || {})),
    colors: JSON.parse(JSON.stringify(src.colors || {})),
    styles: JSON.parse(JSON.stringify(src.styles || {}))
  });
  _rdSaveEntries(cat);
  _rdRenderFromDocId(cat);
  _rdToast('Formulaire dupliqué ✓', 'info');
}

// ══════════════════════════════════════════════════════════════════════
// APERÇU & IMPRESSION
// ══════════════════════════════════════════════════════════════════════

function _rdHash(x, y, seed) {
  var h = Math.sin(x * 127.1 + y * 311.7 + seed * 74.3) * 43758.5453;
  return h - Math.floor(h);
}

function _rdSyncFieldColors(newColor) {
  // Met à jour les pickers de ligne qui n'ont PAS d'override actif
  document.querySelectorAll('.rd-form-field-color').forEach(function(inp){
    if (!inp.dataset.override || inp.dataset.override !== '1') {
      inp.value = newColor;
    }
  });
}

function _rdBuildOverlayWindow(title, tpl, values, imgUrl, autoprint, zooms, colors, styles) {
  zooms  = zooms  || {};
  colors = colors || {};
  styles = styles || {};
  var writingStyle = tpl.writingStyle || 'normal';
  var defaultFs = tpl.defaultFontSize || 14;
  var inkColors = ['#1B3F8B', '#17377A', '#2450A3'];
  // Police globale pour le fontLink (on charge les deux si certains champs diffèrent)
  var needsFR = (writingStyle === 'fr') || Object.values(styles).some(function(s){ return s === 'fr'; });
  var needsAR = (writingStyle === 'ar') || Object.values(styles).some(function(s){ return s === 'ar'; });

  var fieldsHtml = tpl.fields.map(function(f) {
    var val = _rdEsc(values[f.id] || '');
    if (!val) return '';

    var fs         = (zooms[f.id]  && zooms[f.id] >= 8) ? zooms[f.id]  : (defaultFs || f.fontSize || 14);
    var textColor  = colors[f.id]  ? colors[f.id]  : (tpl.defaultColor || f.color || '#000000');
    var fieldStyle = styles[f.id]  ? styles[f.id]  : writingStyle;
    var isManuscrit = (fieldStyle === 'fr' || fieldStyle === 'ar');

    if (!isManuscrit) {
      return '<div style="position:absolute;left:'+f.x.toFixed(3)+'%;top:'+f.y.toFixed(3)+'%;'
        + 'transform:translateY(-50%);font-size:'+fs+'px;color:'+textColor+';'
        + 'white-space:nowrap;font-family:Arial,sans-serif;z-index:20;line-height:1.4;">'+val+'</div>';
    }

    var r1 = _rdHash(f.x, f.y, 1);
    var r2 = _rdHash(f.x, f.y, 2);
    var r3 = _rdHash(f.x, f.y, 3);
    var r4 = _rdHash(f.x, f.y, 4);

    var inkColor = (textColor && textColor !== '#000000') ? textColor : inkColors[Math.floor(r1 * 3)];
    var rot      = (-0.5  + r2 * 1.2).toFixed(2);
    var opacity  = (0.88  + r3 * 0.07).toFixed(3);
    var baseOff  = (-1.2  + r4 * 2.4).toFixed(2);
    var blur     = fieldStyle === 'ar' ? '0.3px' : '0.25px';
    var font     = fieldStyle === 'ar'
      ? "'Aref Ruqaa', 'Traditional Arabic', serif"
      : "'Caveat', 'Segoe Script', cursive";
    var dir = fieldStyle === 'ar' ? 'rtl' : 'ltr';

    return '<div style="position:absolute;left:'+f.x.toFixed(3)+'%;top:'+f.y.toFixed(3)+'%;'
      + 'transform:translateY(calc(-50% + '+baseOff+'px)) rotate('+rot+'deg);'
      + 'font-size:'+fs+'px;color:'+inkColor+';white-space:nowrap;'
      + 'font-family:'+font+';z-index:20;line-height:1.4;'
      + 'opacity:'+opacity+';filter:blur('+blur+');'
      + 'direction:'+dir+';unicode-bidi:plaintext;letter-spacing:0.01em;'
      + '">'+val+'</div>';
  }).join('');

  var win = window.open('', '_blank', 'width=960,height=800');
  if (!win) { _rdToast('Autorisez les popups pour ce site.', 'error'); return; }

  var fontLink = '';
  if (needsAR || needsFR) fontLink += '<link rel="preconnect" href="https://fonts.googleapis.com">';
  if (needsAR) fontLink += '<link href="https://fonts.googleapis.com/css2?family=Aref+Ruqaa&display=swap" rel="stylesheet">';
  if (needsFR) fontLink += '<link href="https://fonts.googleapis.com/css2?family=Caveat:wght@400;500&display=swap" rel="stylesheet">';

  var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>'+_rdEsc(title)+'</title>'+fontLink;
  html += '<style>*{margin:0;padding:0;box-sizing:border-box;}';
  html += 'body{background:#444;display:flex;justify-content:center;padding:50px 20px 20px;}';
  html += '.controls{position:fixed;top:0;left:0;right:0;height:42px;background:#1a1a1a;display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:0 16px;z-index:100;}';
  html += '.bp{background:#d4af37;color:#000;border:none;padding:6px 16px;border-radius:5px;cursor:pointer;font-weight:700;font-size:13px;}';
  html += '.bc{background:#333;color:#ccc;border:none;padding:6px 14px;border-radius:5px;cursor:pointer;font-size:13px;}';
  html += '.page{position:relative;width:800px;background:#fff;box-shadow:0 4px 24px rgba(0,0,0,0.7);}';
  html += '.page img{width:100%;display:block;}';
  html += '@media print{.controls{display:none;}body{background:#fff;padding:0;}.page{width:100%;box-shadow:none;}@page{margin:0;size:A4 portrait;}body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}}';
  html += '</style></head><body>';
  html += '<div class="controls">';
  if (!autoprint) html += '<span style="color:#888;font-size:12px;margin-right:auto;">Aperçu — ' + _rdEsc(title) + '</span>';
  html += '<button class="bp" onclick="window.print()">&#128424; Imprimer</button>';
  html += '<button class="bc" onclick="window.close()">Fermer</button>';
  html += '</div>';
  html += '<div class="page" id="pg"><img id="docimg" alt="Document" style="width:100%;display:block;">' + fieldsHtml + '</div>';

  if (autoprint) {
    html += '<scr'+'ipt>function _doPrint(){'
      + 'if(document.fonts&&document.fonts.ready){'
        + 'document.fonts.ready.then(function(){setTimeout(function(){window.print();},300);});'
      + '}else{setTimeout(function(){window.print();},1200);}}'
      + '<'+'/scr'+'ipt>';
  }
  html += '<scr'+'ipt>document.getElementById("docimg").src=window._docUrl;'
    + (autoprint ? '_doPrint();' : '')
    + '<'+'/scr'+'ipt>';
  html += '</body></html>';

  win._docUrl = imgUrl;
  win.document.write(html);
  win.document.close();
  setTimeout(function(){
    try { win.document.getElementById('docimg').src = imgUrl; } catch(e) {}
  }, 150);
}

function _rdPrintEntry(cat, entryId) {
  var tpl   = _rdGetTemplate(cat);
  var entry = _rdGetEntries(cat).find(function(e){ return e.id === entryId; });
  if (!entry) return;
  var imgUrl = _rdImages[cat];
  if (!imgUrl) { _rdToast('Rechargez d\'abord l\'image dans Paramétrage.', 'warn'); return; }
  _rdBuildOverlayWindow(_rdEsc(entry.name), tpl, entry.values, imgUrl, true, entry.zooms || {}, entry.colors || {}, entry.styles || {});
}

function _rdApercu(cat) {
  var tpl    = _rdGetTemplate(cat);
  var imgUrl = _rdImages[cat];
  if (!imgUrl) { _rdToast('Rechargez d\'abord l\'image dans Paramétrage.', 'warn'); return; }
  var values = {};
  document.querySelectorAll('.rd-form-field').forEach(function(inp){
    values[inp.getAttribute('data-fid')] = inp.value || '';
  });
  var liveZooms = {};
  document.querySelectorAll('.rd-form-zoom').forEach(function(inp){
    var v = parseInt(inp.value);
    if (v && v >= 8) liveZooms[inp.getAttribute('data-fid')] = v;
  });
  var liveColors = {};
  document.querySelectorAll('.rd-form-field-color').forEach(function(inp){
    var v = inp.value;
    if (v) liveColors[inp.getAttribute('data-fid')] = v;
  });
  var liveStyles = {};
  document.querySelectorAll('.rd-form-field-style').forEach(function(sel){
    if (sel.value) liveStyles[sel.getAttribute('data-fid')] = sel.value;
  });
  _rdBuildOverlayWindow('Aperçu', tpl, values, imgUrl, false, liveZooms, liveColors, liveStyles);
}

function redactionPrint(cat) {}

function redactionClearFields(cat) {
  if (!confirm('Effacer tout le paramétrage et toutes les entrées ?')) return;
  _rdDB[cat + '_tpl']     = { fields: [], imageData: null, imageName: null, imageLoadedAt: null };
  _rdDB[cat + '_entries'] = [];
  _rdSaveTemplate(cat);
  _rdSaveEntries(cat);
  if (_rdImages[cat] && String(_rdImages[cat]).startsWith('blob:')) URL.revokeObjectURL(_rdImages[cat]);
  _rdImages[cat]     = null;
  _rdImagesData[cat] = null;
  _rdRenderFromDocId(cat);
  _rdToast('Paramétrage et entrées supprimés', 'warn');
}

// Echap ferme les modals
(function(){
  document.addEventListener('keydown', function(e) {
    if (e.key !== 'Escape') return;
    if (document.activeElement && document.activeElement.closest && document.activeElement.closest('.rd-param-field')) return;
    var pm = document.getElementById('rd-param-modal');
    if (pm && pm.style.display !== 'none') { pm.style.display = 'none'; return; }
    var fm = document.getElementById('rd-form-modal');
    if (fm && fm.style.display !== 'none') { fm.style.display = 'none'; }
  });
})();
