// MYTHOS PROD — DOCUMENTATION v1
// Gestion documentaire (dossiers, upload, aperçu, déplacement) — extrait de js/app.js lignes 1050-1617
// Dépendances globales : STORE (app.js), escapeHtml (utils.js)

var _docCurrentFolder = null; // null = vue dossiers, 'mythos'/'travail'/'partenariat' = intérieur dossier

var DOC_FOLDERS = {
  mythos:      { label: "Les documents d'Uthina Chess",  icon: '&#128196;', color: '#d4af37' },
  nouveau:     { label: 'Nouveau',                    icon: '&#127381;', color: '#fb923c' },
  archive:     { label: 'Archive',                    icon: '&#128451;', color: '#6b7280' }
};

function renderDocumentation() {
  if (_docCurrentFolder) {
    _renderDocFolder(_docCurrentFolder);
  } else {
    _renderDocHome();
  }
}

function switchDocTab(cat) { // rétrocompat
  openDocFolder(cat);
}

function openDocFolder(cat) {
  _docCurrentFolder = cat;
  _renderDocFolder(cat);
}

function _renderDocHome() {
  var container = document.getElementById('doc-main-container');
  if (!container) return;
  var allDocs = STORE.documents();
  var total   = allDocs.length;
  var counts  = {};
  Object.keys(DOC_FOLDERS).forEach(function(k){
    counts[k] = allDocs.filter(function(d){ return d.cat===k; }).length;
  });

  var html =
    '<div style="display:flex;align-items:center;gap:16px;background:linear-gradient(135deg,rgba(212,175,55,0.1),rgba(212,175,55,0.04));border:1px solid rgba(212,175,55,0.2);border-radius:14px;padding:20px 24px;margin-bottom:24px;">' +
      '<div style="font-size:40px;">&#128193;</div>' +
      '<div>' +
        '<div style="color:#d4af37;font-size:20px;font-weight:800;">Mes Documents</div>' +
        '<div style="color:#888;font-size:12px;margin-top:3px;">' + total + ' document' + (total!==1?'s':'') + ' au total &nbsp;&middot;&nbsp; ' + Object.keys(DOC_FOLDERS).length + ' dossiers</div>' +
      '</div>' +
      '<div style="margin-left:auto;">' +
        '<button class="btn btn-gold" onclick="openBulkUploadModal()" style="font-size:12px;">&#8679; Upload groupé</button>' +
      '</div>' +
    '</div>' +

    '<div style="display:flex;flex-direction:column;gap:2px;background:#0d0d0d;border:1px solid #222;border-radius:12px;overflow:hidden;">' +
      '<div style="display:grid;grid-template-columns:40px 1fr 80px 40px;align-items:center;padding:10px 16px;background:#181818;border-bottom:1px solid #252525;">' +
        '<span></span>' +
        '<span style="color:#555;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;">Dossier</span>' +
        '<span style="color:#555;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;text-align:center;">Docs</span>' +
        '<span></span>' +
      '</div>' +
    Object.entries(DOC_FOLDERS).map(function(entry){
      var k=entry[0], f=entry[1];
      var n = counts[k];
      var last = allDocs.filter(function(d){ return d.cat===k; }).slice(0,3);
      var thumbs = last.map(function(d){
        var isPdf = d.fileType==='pdf'||(d.photo&&d.photo.indexOf('application/pdf')!==-1);
        return isPdf
          ? '<span style="font-size:14px;">&#128196;</span>'
          : (d.photo ? '<img src="'+d.photo+'" style="width:22px;height:22px;border-radius:4px;object-fit:cover;border:1px solid #333;">' : '<span style="font-size:14px;">&#128196;</span>');
      }).join('');
      return '<div onclick="openDocFolder(\''+k+'\')" style="display:grid;grid-template-columns:40px 1fr 80px 40px;align-items:center;padding:14px 16px;border-bottom:1px solid #1a1a1a;cursor:pointer;transition:background 0.12s;" onmouseover="this.style.background=\'rgba(212,175,55,0.04)\'" onmouseout="this.style.background=\'\'">' +
        '<div style="width:32px;height:32px;border-radius:8px;background:rgba(255,255,255,0.04);display:flex;align-items:center;justify-content:center;font-size:18px;">'+f.icon+'</div>' +
        '<div>' +
          '<div style="color:#e0e0e0;font-weight:700;font-size:14px;">'+f.label+'</div>' +
          (last.length
            ? '<div style="display:flex;align-items:center;gap:4px;margin-top:4px;">'+thumbs+(n>3?'<span style="color:#555;font-size:10px;">+'+( n-3)+'</span>':'')+'</div>'
            : '<div style="color:#444;font-size:11px;margin-top:3px;">Vide</div>') +
        '</div>' +
        '<div style="text-align:center;"><span style="background:'+f.color+'22;color:'+f.color+';font-size:12px;font-weight:700;padding:3px 10px;border-radius:20px;">'+n+'</span></div>' +
        '<div style="text-align:right;color:#444;font-size:18px;">&rsaquo;</div>' +
      '</div>';
    }).join('') +
    '</div>';

  container.innerHTML = html;
}

function _renderDocFolder(cat) {
  var container = document.getElementById('doc-main-container');
  if (!container) return;
  var f = DOC_FOLDERS[cat];
  var docs = STORE.documents().filter(function(d){ return d.cat===cat; });

  var listHtml = '';
  if (!docs.length) {
    listHtml = '<div class="empty-state" style="padding:40px 0;">Dossier vide — ajoutez votre premier document.</div>';
  } else {
    listHtml =
      '<div style="display:flex;flex-direction:column;gap:2px;background:#0d0d0d;border:1px solid #222;border-radius:12px;overflow:hidden;">' +
      '<div style="display:grid;grid-template-columns:54px 1fr 160px 100px 130px;align-items:center;padding:10px 16px;background:#181818;border-bottom:1px solid #252525;">' +
        '<span style="color:#555;font-size:10px;font-weight:700;text-transform:uppercase;">Aperçu</span>' +
        '<span style="color:#555;font-size:10px;font-weight:700;text-transform:uppercase;">Nom</span>' +
        '<span style="color:#555;font-size:10px;font-weight:700;text-transform:uppercase;">Note</span>' +
        '<span style="color:#555;font-size:10px;font-weight:700;text-transform:uppercase;text-align:center;">Date</span>' +
        '<span style="color:#555;font-size:10px;font-weight:700;text-transform:uppercase;text-align:right;">Actions</span>' +
      '</div>' +
      docs.map(function(d){
        var thumb = _docThumb(d);

        var moveDd = '<div style="position:relative;display:inline-block;" onclick="event.stopPropagation();">' +
          '<button class="btn btn-sm btn-outline" onclick="toggleMoveMenu(this,\''+d.id+'\')" title="Déplacer vers..." style="padding:4px 8px;color:#fb923c;border-color:#fb923c;">&#8646;</button>' +
          '<div class="doc-move-menu" id="move-menu-'+d.id+'" style="display:none;position:absolute;right:0;top:100%;margin-top:4px;background:#1a1a1a;border:1px solid #333;border-radius:10px;min-width:200px;z-index:999;box-shadow:0 8px 24px rgba(0,0,0,0.5);overflow:hidden;">' +
          '<div style="padding:8px 12px;color:#555;font-size:10px;font-weight:700;text-transform:uppercase;border-bottom:1px solid #252525;">Déplacer vers</div>' +
          Object.entries(DOC_FOLDERS).filter(function(e){ return e[0]!==cat; }).map(function(e){
            return '<div onclick="moveDoc(\'' + d.id + '\',\'' + e[0] + '\')" style="display:flex;align-items:center;gap:10px;padding:10px 14px;cursor:pointer;transition:background 0.1s;font-size:13px;color:#ddd;" onmouseover="this.style.background=\'rgba(251,146,60,0.08)\'" onmouseout="this.style.background=\'\'"><span style="font-size:16px;">'+e[1].icon+'</span>'+e[1].label+'</div>';
          }).join('') +
          '</div></div>';

        return '<div style="display:grid;grid-template-columns:54px 1fr 160px 100px 130px;align-items:center;padding:11px 16px;border-bottom:1px solid #161616;transition:background 0.1s;" onmouseover="this.style.background=\'rgba(255,255,255,0.02)\'" onmouseout="this.style.background=\'\'">' +
          '<div>'+thumb+'</div>' +
          '<div style="min-width:0;">' +
            '<div style="color:#e0e0e0;font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;" onclick="docPreviewPhoto(\''+d.id+'\')">'+escapeHtml(d.name)+'</div>' +
            '<div style="color:#444;font-size:10px;margin-top:1px;">'+_docTypeInfo(d).label+'</div>' +
          '</div>' +
          '<div style="color:#888;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-right:8px;">'+(d.note ? escapeHtml(d.note) : '<span style="color:#2a2a2a;font-style:italic;">—</span>')+'</div>' +
          '<div style="text-align:center;color:#555;font-size:11px;">'+(d.createdAt?d.createdAt.slice(0,10):'')+'</div>' +
          '<div style="display:flex;gap:3px;justify-content:flex-end;flex-wrap:wrap;" onclick="event.stopPropagation();">' +
            '<button class="btn btn-sm btn-outline" onclick="docPrint(\''+d.id+'\')" title="Imprimer" style="padding:4px 6px;">&#128424;</button>' +
            '<button class="btn btn-sm btn-outline" onclick="docWhatsapp(\''+d.id+'\')" title="WhatsApp" style="padding:4px 6px;color:#25d366;border-color:#25d366;">&#128241;</button>' +
            '<button class="btn btn-sm btn-outline" onclick="docEmail(\''+d.id+'\')" title="Email" style="padding:4px 6px;color:#60a5fa;border-color:#60a5fa;">&#9993;</button>' +
            moveDd +
            '<button class="btn btn-sm btn-outline" onclick="openDocModal(\''+d.cat+'\',\''+d.id+'\')" title="Modifier" style="padding:4px 6px;">&#9998;</button>' +
            '<button class="btn btn-sm btn-danger" onclick="deleteDoc(\''+d.id+'\')" title="Supprimer" style="padding:4px 6px;">&times;</button>' +
          '</div>' +
        '</div>';
      }).join('') +
      '</div>';
  }

  container.innerHTML =
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:20px;">' +
      '<button class="btn btn-outline btn-sm" onclick="_docCurrentFolder=null;renderDocumentation();">&#128193; Documentation</button>' +
      '<span style="color:#333;">&rsaquo;</span>' +
      '<span style="font-size:18px;">'+f.icon+'</span>' +
      '<span style="color:'+f.color+';font-weight:700;font-size:14px;">'+f.label+'</span>' +
      '<span style="color:#444;font-size:12px;margin-left:4px;">('+docs.length+' doc'+(docs.length!==1?'s':'')+')</span>' +
    '</div>' +
    '<div style="display:flex;gap:8px;justify-content:flex-end;margin-bottom:16px;">' +
      '<button class="btn btn-outline" onclick="openBulkUploadModal(\''+cat+'\')" style="font-size:12px;">&#8679; Upload groupé</button>' +
      '<button class="btn btn-gold" onclick="openDocModal(\''+cat+'\')">+ Ajouter un document</button>' +
    '</div>' +
    listHtml;
}

function renderDocList(cat) { _renderDocFolder(cat); } // rétrocompat

function _docTypeInfo(d) {
  var ft = d.fileType || '';
  var photo = d.photo || '';
  if (ft === 'image' || (ft === '' && photo && photo.startsWith('data:image'))) return { icon:'&#128247;', label:'Image', color:'#60a5fa', isImage:true };
  if (ft === 'pdf'   || photo.indexOf('application/pdf')  !== -1) return { icon:'&#128196;', label:'PDF',   color:'#d4af37', isImage:false };
  if (ft === 'word'  || photo.indexOf('msword')           !== -1 || photo.indexOf('wordprocessingml') !== -1) return { icon:'&#128221;', label:'Word',  color:'#60a5fa', isImage:false };
  if (ft === 'excel' || photo.indexOf('spreadsheet')      !== -1 || photo.indexOf('excel')            !== -1) return { icon:'&#128202;', label:'Excel', color:'#22c55e', isImage:false };
  if (ft === 'csv'   || photo.indexOf('text/csv')         !== -1) return { icon:'&#128202;', label:'CSV',   color:'#34d399', isImage:false };
  if (ft === 'text'  || photo.indexOf('text/plain')       !== -1) return { icon:'&#128196;', label:'Texte', color:'#94a3b8', isImage:false };
  if (photo && photo.startsWith('data:image')) return { icon:'&#128247;', label:'Image', color:'#60a5fa', isImage:true };
  return { icon:'&#128196;', label:'Fichier', color:'#888', isImage:false };
}

function _docAbsoluteUrl(url) {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  if (url.indexOf('/') === 0) return window.location.origin + url;
  return window.location.origin + '/' + url.replace(/^\/+/, '');
}

function _docViewerUrl(doc) {
  if (!doc || !doc.photo || doc.photo.indexOf('/documents/') !== 0) return '';
  var absoluteUrl = _docAbsoluteUrl(doc.photo);
  if (doc.fileType === 'word' || doc.fileType === 'excel') {
    return 'https://view.officeapps.live.com/op/view.aspx?src=' + encodeURIComponent(absoluteUrl);
  }
  return absoluteUrl;
}

function _decodeDataUrlText(dataUrl) {
  try {
    var base64 = (String(dataUrl || '').split(',')[1] || '');
    var binary = atob(base64);
    var bytes = Uint8Array.from(binary, function(ch) { return ch.charCodeAt(0); });
    return new TextDecoder('utf-8').decode(bytes);
  } catch (e) {
    return '';
  }
}

function _openTextDocument(doc) {
  var targetUrl = _docViewerUrl(doc);
  if (!targetUrl) return window.open(doc.photo, '_blank');
  fetch(targetUrl)
    .then(function(r) { return r.text(); })
    .then(function(text) {
      var w = window.open('', '_blank');
      if (!w) return;
      w.document.write('<html><head><title>' + escapeHtml(doc.name || 'Document') + '</title></head><body style="margin:0;background:#0f0f0f;color:#f5f5f5;font-family:Arial,sans-serif;"><pre style="margin:0;padding:24px;white-space:pre-wrap;word-break:break-word;">' + escapeHtml(text) + '</pre></body></html>');
      w.document.close();
    })
    .catch(function() {
      window.open(targetUrl, '_blank');
    });
}

function _openServerDocument(doc) {
  var targetUrl = _docViewerUrl(doc);
  if (!targetUrl) {
    window.open(doc.photo, '_blank');
    return;
  }
  if (doc.fileType === 'csv' || doc.fileType === 'text') {
    _openTextDocument(doc);
    return;
  }
  window.open(targetUrl, '_blank');
}

function _renderStoredDocPreview(doc) {
  var ti = _docTypeInfo(doc);
  if (ti.isImage) {
    return '<img src="' + doc.photo + '" style="max-width:100%;max-height:180px;border-radius:8px;border:1px solid #333;">';
  }
  return '<div style="display:flex;align-items:center;gap:10px;padding:10px;background:#1a1a1a;border:1px solid ' + ti.color + '66;border-radius:8px;"><span style="font-size:30px;">' + ti.icon + '</span><div style="color:' + ti.color + ';font-weight:700;">' + ti.label + ' existant</div></div>';
}

function _docThumb(d) {
  if (!d.photo) {
    return '<div style="width:42px;height:42px;border-radius:8px;border:1px dashed #333;display:flex;align-items:center;justify-content:center;color:#444;font-size:20px;cursor:default;">&#128196;</div>';
  }
  var ti = _docTypeInfo(d);
  if (ti.isImage) {
    return '<img src="' + d.photo + '" onclick="docPreviewPhoto(\'' + d.id + '\')" style="width:42px;height:42px;border-radius:8px;object-fit:cover;border:1px solid #333;cursor:pointer;" title="Voir">';
  }
  return '<div onclick="docPreviewPhoto(\'' + d.id + '\')" title="Ouvrir" style="width:42px;height:42px;border-radius:8px;background:#1a1a1a;border:1px solid ' + ti.color + '44;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;gap:1px;">' +
    '<span style="font-size:18px;">' + ti.icon + '</span>' +
    '<span style="color:' + ti.color + ';font-size:7px;font-weight:700;">' + ti.label + '</span>' +
  '</div>';
}

function openDocModal(cat, id) {
  var titles = { mythos: "Les documents d'Uthina Chess", nouveau: 'Nouveau', archive: 'Archive' };
  document.getElementById('doc-modal-title').textContent = (id ? 'Modifier — ' : 'Nouveau — ') + (titles[cat] || 'Document');
  document.getElementById('doc-edit-id').value  = id  || '';
  document.getElementById('doc-edit-cat').value = cat || '';
  document.getElementById('doc-name').value = '';
  document.getElementById('doc-note').value = '';
  document.getElementById('doc-photo-preview').innerHTML = '';
  document.getElementById('doc-photo-preview').dataset.photoData = '';
  document.getElementById('doc-photo-input').value = '';
  var ftEl = document.getElementById('doc-file-type');
  if (ftEl) ftEl.value = '';
  if (id) {
    var doc = STORE.documents().find(function(d){ return d.id === id; });
    if (doc) {
      document.getElementById('doc-name').value = doc.name;
      document.getElementById('doc-note').value = doc.note || '';
      var prev = document.getElementById('doc-photo-preview');
      if (doc.photo) {
        prev.innerHTML = _renderStoredDocPreview(doc);
        prev.dataset.photoData = doc.photo;
      }
    }
  }
  document.getElementById('doc-modal').style.display = 'flex';
}

function closeDocModal() {
  document.getElementById('doc-modal').style.display = 'none';
  var prevEl = document.getElementById('doc-photo-preview');
  if (prevEl) { prevEl.dataset.photoData = ''; prevEl.dataset.photoType = ''; }
}

function previewDocPhoto(input) {
  var file = input.files[0];
  if (!file) return;
  var nameEl = document.getElementById('doc-name');
  if (nameEl && !nameEl.value.trim()) {
    nameEl.value = _cleanDocumentName(file.name);
  }
  var fi = _fileInfo(file);
  var preview = document.getElementById('doc-photo-preview');
  preview.dataset.pendingFile = '1';
  var hiddenType = document.getElementById('doc-file-type');
  if (!hiddenType) {
    hiddenType = document.createElement('input');
    hiddenType.type = 'hidden'; hiddenType.id = 'doc-file-type';
    document.getElementById('doc-photo-input').parentNode.appendChild(hiddenType);
  }
  hiddenType.value = fi.type;
  if (fi.type === 'image') {
    var reader = new FileReader();
    reader.onload = function(e) {
      preview.innerHTML = '<img src="' + e.target.result + '" style="max-width:100%;max-height:160px;border-radius:8px;border:1px solid #333;margin-top:4px;">';
      preview.dataset.photoData = e.target.result;
    };
    reader.readAsDataURL(file);
  } else {
    var reader2 = new FileReader();
    reader2.onload = function(e) { preview.dataset.photoData = e.target.result; };
    reader2.readAsDataURL(file);
    preview.innerHTML = '<div style="display:flex;align-items:center;gap:12px;margin-top:8px;padding:12px;background:#1a1a1a;border:1px solid ' + fi.color + '44;border-radius:8px;">' +
      '<span style="font-size:32px;">' + fi.icon + '</span>' +
      '<div><div style="color:' + fi.color + ';font-weight:700;">' + fi.label + ' prêt</div>' +
      '<div style="color:#888;font-size:11px;">' + escapeHtml(file.name) + '</div></div></div>';
  }
}

function _cleanDocumentName(fileName) {
  return String(fileName || '')
    .replace(/\.(pdf|doc|docx|xls|xlsx|csv|txt|jpg|jpeg|png|gif|webp)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function _fileInfo(file) {
  var name = file.name.toLowerCase();
  var mime = file.type;
  if (mime === 'application/pdf' || name.endsWith('.pdf'))
    return { type:'pdf',   icon:'&#128196;', label:'PDF',   color:'#d4af37' };
  if (mime.startsWith('image/'))
    return { type:'image', icon:'&#128247;', label:'Image', color:'#60a5fa' };
  if (name.endsWith('.doc') || name.endsWith('.docx') || mime.includes('word'))
    return { type:'word',  icon:'&#128221;', label:'Word',  color:'#60a5fa' };
  if (name.endsWith('.xlsx') || name.endsWith('.xls') || mime.includes('spreadsheet') || mime.includes('excel'))
    return { type:'excel', icon:'&#128202;', label:'Excel', color:'#22c55e' };
  if (name.endsWith('.csv'))
    return { type:'csv',   icon:'&#128202;', label:'CSV',   color:'#34d399' };
  if (name.endsWith('.txt') || mime === 'text/plain')
    return { type:'text',  icon:'&#128196;', label:'Texte', color:'#94a3b8' };
  return { type:'file', icon:'&#128196;', label:'Fichier', color:'#888' };
}

function saveDoc() {
  var name = (document.getElementById('doc-name').value || '').trim();
  if (!name) { alert('Entrez un nom pour le document.'); return; }
  var cat  = document.getElementById('doc-edit-cat').value;
  var id   = document.getElementById('doc-edit-id').value || 'doc_' + Date.now();
  var fileInput = document.getElementById('doc-photo-input');
  var file = fileInput && fileInput.files[0];
  var btn = document.querySelector('#doc-modal .btn-gold');

  if (file) {
    if (btn) { btn.disabled = true; btn.textContent = 'Enregistrement...'; }
    var fd = new FormData();
    fd.append('file', file); fd.append('cat', cat); fd.append('doc_id', id);
    var done = false;
    fetch('/upload.php', { method: 'POST', body: fd })
      .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function(res) {
        done = true;
        if (btn) { btn.disabled = false; btn.textContent = 'Enregistrer'; }
        if (res.ok) { _saveDocRecord(id, cat, name, res.url, res.fileType); }
        else { _saveDocFallbackBase64(id, cat, name, file, btn); }
      })
      .catch(function() { if (!done) _saveDocFallbackBase64(id, cat, name, file, btn); });
  } else {
    var prevEl = document.getElementById('doc-photo-preview');
    var cameraData = prevEl && prevEl.dataset.photoData;
    if (cameraData) {
      _saveDocRecord(id, cat, name, cameraData, 'image');
    } else {
      var ex = STORE.documents().find(function(d){ return d.id === id; });
      _saveDocRecord(id, cat, name, ex ? ex.photo : '', ex ? (ex.fileType||'image') : 'image');
    }
  }
}

function _saveDocFallbackBase64(id, cat, name, file, btn) {
  var fallbackType = _fileInfo(file).type;
  var reader = new FileReader();
  reader.onload = function(e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Enregistrer'; }
    _saveDocRecord(id, cat, name, e.target.result, fallbackType, '');
  };
  reader.onerror = function() { if (btn) { btn.disabled = false; btn.textContent = 'Enregistrer'; } };
  reader.readAsDataURL(file);
}

function _saveDocRecord(id, cat, name, photoUrl, fileType, note) {
  var noteVal = note !== undefined ? note : (document.getElementById('doc-note') ? document.getElementById('doc-note').value : '');
  var docs = STORE.documents();
  var idx  = docs.findIndex(function(d){ return d.id === id; });
  var doc  = { id:id, cat:cat, name:name, photo:photoUrl, fileType:fileType||'image', note:noteVal, createdAt:new Date().toISOString() };
  if (idx >= 0) docs[idx] = doc; else docs.unshift(doc);
  STORE.saveDocuments(docs);
  closeDocModal();
  renderDocList(cat);
}

function deleteDoc(id) {
  if (!confirm('Supprimer ce document ?')) return;
  var doc = STORE.documents().find(function(d){ return d.id === id; });
  if (doc && doc.photo && doc.photo.indexOf('/documents/') === 0) {
    fetch('/upload.php', { method: 'DELETE', body: 'url=' + encodeURIComponent(doc.photo) });
  }
  STORE.saveDocuments(STORE.documents().filter(function(d){ return d.id !== id; }));
  renderDocList(_docCurrentFolder || 'mythos');
}

function docPreviewPhoto(id) {
  var doc = STORE.documents().find(function(d){ return d.id === id; });
  if (!doc || !doc.photo) return;
  if (doc.photo.indexOf('/documents/') === 0) { _openServerDocument(doc); return; }
  var w = window.open('', '_blank');
  if (doc.fileType === 'pdf') {
    w.document.write('<html><body style="margin:0;height:100vh;"><embed src="' + doc.photo + '" type="application/pdf" width="100%" height="100%"></body></html>');
  } else if (doc.fileType === 'csv' || doc.fileType === 'text') {
    w.document.write('<html><body style="margin:0;background:#0f0f0f;color:#f5f5f5;font-family:Arial,sans-serif;"><pre style="margin:0;padding:24px;white-space:pre-wrap;word-break:break-word;">' + escapeHtml(_decodeDataUrlText(doc.photo)) + '</pre></body></html>');
  } else if (doc.fileType === 'word' || doc.fileType === 'excel' || doc.fileType === 'file') {
    var googleViewerUrl = 'https://docs.google.com/gview?embedded=true&url=' + encodeURIComponent(window.location.origin + doc.photo);
    w.location = googleViewerUrl;
  } else {
    w.document.write('<html><body style="margin:0;background:#000;display:flex;align-items:center;justify-content:center;min-height:100vh;"><img src="' + doc.photo + '" style="max-width:100%;max-height:100vh;object-fit:contain;"></body></html>');
  }
  w.document.close();
}

function docPrint(id) {
  var doc = STORE.documents().find(function(d){ return d.id === id; });
  if (!doc) return;
  if (doc.photo && doc.photo.indexOf('/documents/') === 0) { _openServerDocument(doc); return; }
  var w = window.open('', '_blank');
  if (doc.fileType === 'pdf') {
    w.document.write('<html><body style="margin:0;height:100vh;"><embed src="' + doc.photo + '" type="application/pdf" width="100%" height="100%"></body></html>');
    setTimeout(function(){ w.print(); }, 800);
  } else if (doc.fileType === 'csv' || doc.fileType === 'text') {
    w.document.write('<html><body style="margin:20px;font-family:Arial;white-space:pre-wrap;word-break:break-word;">' + escapeHtml(_decodeDataUrlText(doc.photo)) + '</body></html>');
    w.document.close();
    setTimeout(function(){ w.print(); }, 400);
  } else {
    w.document.write('<html><body style="margin:20px;font-family:Arial;"><h2>' + escapeHtml(doc.name) + '</h2>' + (doc.photo ? '<img src="' + doc.photo + '" style="max-width:100%">' : '') + '</body></html>');
    w.document.close();
    setTimeout(function(){ w.print(); }, 400);
  }
}

function docWhatsapp(id) {
  var doc = STORE.documents().find(function(d){ return d.id === id; });
  if (!doc) return;
  window.open('https://wa.me/?text=' + encodeURIComponent('Document : ' + doc.name + ' — Mythos Prod'), '_blank');
}

function docEmail(id) {
  var doc = STORE.documents().find(function(d){return d.id===id;});
  if (!doc) return;
  window.open('mailto:?subject=' + encodeURIComponent(doc.name + ' — Mythos Prod') + '&body=' + encodeURIComponent('Document : ' + doc.name), '_blank');
}

function toggleMoveMenu(btn, id) {
  document.querySelectorAll('.doc-move-menu').forEach(function(m) {
    if (m.id !== 'move-menu-' + id) m.style.display = 'none';
  });
  var menu = document.getElementById('move-menu-' + id);
  if (menu) menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
}

document.addEventListener('click', function() {
  document.querySelectorAll('.doc-move-menu').forEach(function(m){ m.style.display = 'none'; });
});

function moveDoc(id, newCat) {
  var docs = STORE.documents();
  var idx  = docs.findIndex(function(d){ return d.id === id; });
  if (idx < 0) return;
  docs[idx].cat = newCat;
  STORE.saveDocuments(docs);
  var menu = document.getElementById('move-menu-' + id);
  if (menu) menu.style.display = 'none';
  renderDocList(_docCurrentFolder || newCat);
}

// ── Upload groupé ───────────────────────────────────────────────────
var _bulkFiles = [];

function openBulkUploadModal(defaultCat) {
  _bulkFiles = [];
  document.getElementById('bulk-files-input').value = '';
  document.getElementById('bulk-preview-list').innerHTML = '';
  document.getElementById('bulk-target-folder').value = defaultCat || 'nouveau';
  document.getElementById('bulk-upload-modal').style.display = 'flex';
}

function closeBulkUploadModal() {
  document.getElementById('bulk-upload-modal').style.display = 'none';
}

function previewBulkFiles(input) {
  _bulkFiles = Array.from(input.files);
  var container = document.getElementById('bulk-preview-list');
  if (!_bulkFiles.length) { container.innerHTML = ''; return; }

  container.innerHTML = '<div style="display:flex;flex-direction:column;gap:8px;margin-top:8px;">' +
    _bulkFiles.map(function(f, i) {
      var fi2 = _fileInfo(f);
      return '<div style="display:flex;align-items:center;gap:10px;background:#111;border:1px solid #222;border-radius:8px;padding:8px 12px;">' +
        '<span style="font-size:20px;">' + fi2.icon + '</span>' +
        '<div style="flex:1;">' +
          '<input type="text" id="bulk-name-' + i + '" value="' + escapeHtml(_cleanDocumentName(f.name)) + '" style="width:100%;background:#1a1a1a;border:1px solid var(--control-border);border-radius:6px;padding:5px 8px;color:#ddd;font-size:12px;" placeholder="Nom du document">' +
        '</div>' +
        '<span style="color:#555;font-size:11px;flex-shrink:0;">' + (f.size/1024).toFixed(0) + ' Ko</span>' +
      '</div>';
    }).join('') + '</div>';
}

function saveBulkDocs() {
  if (!_bulkFiles.length) { alert('Selectionnez au moins un fichier.'); return; }
  var cat = document.getElementById('bulk-target-folder').value;
  var btn = document.getElementById('bulk-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Enregistrement...'; }
  var total = _bulkFiles.length;
  var done  = 0;
  function finish() {
    done++;
    if (done >= total) {
      if (btn) { btn.disabled = false; btn.textContent = 'Enregistrer tout'; }
      closeBulkUploadModal();
      _docCurrentFolder = cat;
      renderDocList(cat);
    }
  }
  _bulkFiles.forEach(function(file, i) {
    var nameEl = document.getElementById('bulk-name-' + i);
    var name   = (nameEl && nameEl.value.trim()) || file.name;
    var id     = 'doc_' + Date.now() + '_' + i;
    var fi3    = _fileInfo(file);
    var fd = new FormData();
    fd.append('file', file); fd.append('cat', cat); fd.append('doc_id', id);
    fetch('/upload.php', { method: 'POST', body: fd })
      .then(function(r){ return r.json(); })
      .then(function(res){
        if (res.ok) { _saveDocRecord(id, cat, name, res.url, fi3.type, ''); }
        else { var reader = new FileReader(); reader.onload = function(e){ _saveDocRecord(id, cat, name, e.target.result, fi3.type, ''); finish(); }; reader.readAsDataURL(file); return; }
        finish();
      })
      .catch(function(){
        var reader = new FileReader();
        reader.onload = function(e){ _saveDocRecord(id, cat, name, e.target.result, fi3.type, ''); finish(); };
        reader.readAsDataURL(file);
      });
  });
}
