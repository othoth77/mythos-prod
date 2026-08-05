// MYTHOS PROD — CONTACTS v1
// Répertoire contacts: import téléphone/vCard/Google, CRUD, doublons, historique, annuaire.
// Dependencies: STORE.repertoireContacts/saveRepertoireContacts/repertoireImports/saveRepertoireImports (app.js);
//   esc (utils.js); _markDeleted, syncFromServer (sync.js); showView (router.js)
//

var _rcActiveTab = 'repertoire'; // hoisted from original line 1394 for clarity
// ══════════════════════════════════════════════════════════════════════
// CONTACT MANAGEMENT — répertoire de contacts (import téléphone + manuel)
// ══════════════════════════════════════════════════════════════════════

var _rcFilterBatchId = null; // null = tous les contacts ensemble ; sinon = un import précis

// Anti-rebond générique : évite de relancer un rendu coûteux à chaque frappe clavier
function _rcDebounce(fn, delay) {
  var t = null;
  return function() {
    var args = arguments, ctx = this;
    clearTimeout(t);
    t = setTimeout(function() { fn.apply(ctx, args); }, delay || 180);
  };
}

var _rcDebouncedRenderRepertoire = _rcDebounce(function() { renderRepertoireContactsPage(); }, 180);
var _rcDebouncedRenderAnnuaire   = _rcDebounce(function() { renderContactsDirectory(); }, 180);

// Appelée directement par les selects (tri/filtre) pour un retour instantané,
// et par le champ de recherche via une version anti-rebond (voir HTML : oninput).
function rcSearchInputChanged() {
  if (_rcActiveTab === 'annuaire') { _rcDebouncedRenderAnnuaire(); }
  else { _rcDebouncedRenderRepertoire(); }
}

function _rcInfo(msg, isError) {
  var el = document.getElementById('repertoire-contacts-info');
  if (!el) return;
  el.style.display = 'block';
  el.style.color = isError ? '#ef4444' : '#d4af37';
  el.style.borderColor = isError ? 'rgba(239,68,68,0.3)' : 'rgba(212,175,55,0.25)';
  el.style.background = isError ? 'rgba(239,68,68,0.08)' : 'rgba(212,175,55,0.08)';
  el.textContent = msg;
}

function _rcFormatDateTime(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  return d.toLocaleDateString('fr-FR') + ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

// Demande l'autorisation au téléphone (Contact Picker API — Chrome Android/Edge Android, HTTPS requis)
// et importe en UN SEUL CLIC tous les contacts choisis dans le tableau,
// en gardant une trace (date + heure) de cet import.
function importPhoneContacts() {
  if (!('contacts' in navigator) || !('ContactsManager' in window)) {
    _rcInfo('⚠️ L\'accès direct au répertoire du téléphone n\'est disponible que sur Chrome/Edge Android (HTTPS). Sur cet appareil/navigateur, ajoutez les contacts manuellement avec le bouton "+ Ajouter manuellement", ou importez-les via un export CSV de votre téléphone.', true);
    return;
  }

  var props = ['name', 'tel', 'email', 'address'];
  var opts  = { multiple: true };

  navigator.contacts.select(props, opts).then(function(selected) {
    if (!selected || !selected.length) return;

    var existing  = STORE.repertoireContacts();
    var nowIso    = new Date().toISOString();
    var batchId   = 'batch_' + Date.now();
    var added     = 0;
    var nextNum   = _rcMaxNumero(existing) + 1;

    selected.forEach(function(c) {
      var fullName = (c.name && c.name[0]) ? c.name[0] : '';
      var parts = fullName.trim().split(/\s+/);
      var prenom = parts.length > 1 ? parts.slice(0, -1).join(' ') : '';
      var nom    = parts.length > 1 ? parts[parts.length - 1] : fullName;

      var addr = (c.address && c.address[0]) || {};
      var adresseStr = [addr.addressLine, addr.dependentLocality].filter(Boolean).join(' ').trim();
      var ville = addr.city || '';
      var pays  = addr.country || '';

      var tel1 = _rcStripPhoneSpaces((c.tel && c.tel[0]) || '');
      var tel2 = _rcStripPhoneSpaces((c.tel && c.tel[1]) || '');
      var mail = (c.email && c.email[0]) || '';

      existing.push({
        id: 'rc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
        numero: String(nextNum).padStart(4, '0'),
        nom: nom || '', prenom: prenom || '',
        adresse: adresseStr, ville: ville, gouvernorat: '', pays: pays,
        tel1: tel1, tel2: tel2, email: mail,
        metier: '', domaine: '', note: '',
        importBatchId: batchId,
        updatedAt: nowIso
      });
      nextNum++;
      added++;
    });

    if (added > 0) {
      STORE.saveRepertoireContacts(existing);
      var imports = STORE.repertoireImports();
      imports.push({ id: batchId, date: nowIso, count: added, label: '', source: 'phone' });
      STORE.saveRepertoireImports(imports);
    }

    _rcFilterBatchId = null;
    renderRepertoireContactsPage();
    renderRepertoireImportsHistory();
    _rcRenderDuplicatesBanner();
    _rcInfo('✓ ' + added + ' contact(s) importé(s) le ' + _rcFormatDateTime(nowIso) + '. Complétez Gouvernorat / Métier / Domaine / Note si besoin.', false);
  }).catch(function(err) {
    // L'utilisateur a annulé ou a refusé l'autorisation
    if (err && err.name === 'SecurityError') {
      _rcInfo('⚠️ Autorisation refusée ou page non sécurisée (HTTPS requis). Réessayez et acceptez l\'accès aux contacts.', true);
    } else {
      _rcInfo('⚠️ Import annulé.', true);
    }
  });
}

// ---- Import 100% en ligne via Google Contacts (OAuth côté serveur) ----
// L'utilisateur clique sur "Se connecter avec Google" -> redirigé vers
// google_auth.php (sur le VPS) -> Google -> google_callback.php (sur le VPS,
// échange le code, appelle People API, récupère TOUS les contacts d'un coup)
// -> redirige vers index.html?googleImportToken=XXXX -> ce script récupère
// le résultat une seule fois via google_fetch_result.php et l'importe.

function startGoogleContactsImport() {
  window.location.href = 'google_auth.php';
}

function _checkGoogleImportToken() {
  var params = new URLSearchParams(window.location.search);
  var token = params.get('googleImportToken');
  if (!token) return;

  // Nettoie l'URL tout de suite pour éviter un double-import si on recharge
  params.delete('googleImportToken');
  var newUrl = window.location.pathname + (params.toString() ? '?' + params.toString() : '') + window.location.hash;
  window.history.replaceState({}, '', newUrl);

  fetch('google_fetch_result.php?token=' + encodeURIComponent(token))
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (!data || data.ok === false) {
        _rcInfo('⚠️ Import Google introuvable ou déjà utilisé. Réessayez "Se connecter avec Google".', true);
        return;
      }

      // Important : google_callback.php a déjà enregistré ces contacts
      // directement côté serveur (source de vérité unique) AVANT cette
      // redirection. On ne les ré-envoie donc plus nous-mêmes depuis le
      // navigateur — un import volumineux (1000+ contacts) ne dépend plus
      // du quota localStorage ni d'un envoi réseau qui pouvait être perdu
      // si la page était rechargée trop vite (d'où les imports affichant
      // "X importés" mais "0 contact(s)" constatés précédemment).
      // On se contente de resynchroniser l'affichage local depuis le serveur.
      var count = (data.batch && data.batch.count) || (data.contacts ? data.contacts.length : 0);
      syncFromServer(function() {
        _rcFilterBatchId = null;
        showView('gestion-contacts');
        renderRepertoireContactsPage();
        renderRepertoireImportsHistory();
        _rcRenderDuplicatesBanner();
        _rcInfo('✓ ' + count + ' contact(s) importé(s) automatiquement depuis Google.', false);
      });
    })
    .catch(function() {
      _rcInfo('⚠️ Erreur réseau pendant l\'import Google.', true);
    });
}

document.addEventListener('DOMContentLoaded', function() {
  setTimeout(_checkGoogleImportToken, 800);
});

// ---- Import "tout en un coup" via fichier .vcf (sans sélection manuelle) ----
// L'API Contact Picker du navigateur impose toujours une sélection manuelle de
// l'utilisateur (restriction de confidentialité imposée par le standard W3C, pas
// contournable en JS). Pour importer absolument tous les contacts d'un coup sans
// rien cocher, l'utilisateur exporte ses contacts du téléphone en un seul fichier
// .vcf (vCard) et on le parse ici en entier.

function triggerContactsFileImport() {
  var input = document.getElementById('rc-file-input');
  if (input) input.click();
}

function _vcUnescape(s) {
  return String(s || '').replace(/\\n/gi, ' ').replace(/\\,/g, ',').replace(/\\;/g, ';');
}

function _parseVCardFile(text) {
  var contacts = [];
  var blocks = String(text || '').split(/BEGIN:VCARD/i).slice(1);
  blocks.forEach(function(block) {
    var lines = block.split(/\r\n|\n|\r/);
    var c = { fn: '', n: '', tels: [], emails: [], adr: '' };
    lines.forEach(function(line) {
      line = line.trim();
      if (!line || /^END:VCARD/i.test(line)) return;
      var idx = line.indexOf(':');
      if (idx === -1) return;
      var keyPart = line.slice(0, idx);
      var value = line.slice(idx + 1);
      var key = keyPart.split(';')[0].toUpperCase();
      if (key === 'FN') c.fn = value;
      else if (key === 'N') c.n = value;
      else if (key === 'TEL') c.tels.push(value);
      else if (key === 'EMAIL') c.emails.push(value);
      else if (key === 'ADR') c.adr = value;
    });
    if (c.fn || c.n || c.tels.length || c.emails.length) contacts.push(c);
  });
  return contacts;
}

function handleContactsFileImport(event) {
  var file = event.target.files && event.target.files[0];
  if (!file) return;

  var reader = new FileReader();
  reader.onload = function(e) {
    var parsed = _parseVCardFile(e.target.result);
    if (!parsed.length) {
      _rcInfo('⚠️ Aucun contact trouvé dans ce fichier. Vérifiez que c\'est bien un export .vcf de votre téléphone (app Contacts → Exporter → vCard).', true);
      event.target.value = '';
      return;
    }

    var existing = STORE.repertoireContacts();
    var nowIso   = new Date().toISOString();
    var batchId  = 'batch_' + Date.now();
    var nextNum  = _rcMaxNumero(existing) + 1;
    var added    = 0;

    parsed.forEach(function(c) {
      var nom = '', prenom = '';
      if (c.n) {
        var np = c.n.split(';').map(_vcUnescape);
        nom = np[0] || ''; prenom = np[1] || '';
      } else if (c.fn) {
        var fullName = _vcUnescape(c.fn);
        var parts = fullName.trim().split(/\s+/);
        prenom = parts.length > 1 ? parts.slice(0, -1).join(' ') : '';
        nom = parts.length > 1 ? parts[parts.length - 1] : fullName;
      }

      var adresseStr = '', ville = '', pays = '';
      if (c.adr) {
        var ap = c.adr.split(';').map(_vcUnescape);
        adresseStr = ap[2] || '';
        ville      = ap[3] || '';
        pays       = ap[6] || '';
      }

      var tel1 = c.tels[0] ? _rcStripPhoneSpaces(_vcUnescape(c.tels[0])) : '';
      var tel2 = c.tels[1] ? _rcStripPhoneSpaces(_vcUnescape(c.tels[1])) : '';
      var mail = c.emails[0] ? _vcUnescape(c.emails[0]) : '';

      if (!nom && !prenom && !tel1 && !mail) return;

      existing.push({
        id: 'rc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
        numero: String(nextNum).padStart(4, '0'),
        nom: nom || '', prenom: prenom || '',
        adresse: adresseStr, ville: ville, gouvernorat: '', pays: pays,
        tel1: tel1, tel2: tel2, email: mail,
        metier: '', domaine: '', note: '',
        importBatchId: batchId,
        updatedAt: nowIso
      });
      nextNum++;
      added++;
    });

    if (added > 0) {
      STORE.saveRepertoireContacts(existing);
      var imports = STORE.repertoireImports();
      imports.push({ id: batchId, date: nowIso, count: added, label: '', source: 'file' });
      STORE.saveRepertoireImports(imports);
    }

    _rcFilterBatchId = null;
    renderRepertoireContactsPage();
    renderRepertoireImportsHistory();
    _rcRenderDuplicatesBanner();
    _rcInfo('✓ ' + added + ' contact(s) importé(s) en un seul coup depuis le fichier le ' + _rcFormatDateTime(nowIso) + '.', false);
    event.target.value = '';
  };
  reader.onerror = function() {
    _rcInfo('⚠️ Erreur de lecture du fichier.', true);
    event.target.value = '';
  };
  reader.readAsText(file);
}

// Affiche l'historique des imports (date + heure + nombre de contacts), cliquable
// pour filtrer le tableau sur un import précis. Le bouton "Voir tous les contacts
// ensemble" (dans le HTML) remet le filtre à null.
function renderRepertoireImportsHistory() {
  var el = document.getElementById('repertoire-imports-history');
  if (!el) return;

  var imports = STORE.repertoireImports().slice().sort(function(a, b) {
    return String(b.date || '').localeCompare(String(a.date || ''));
  });

  if (!imports.length) {
    el.innerHTML = '<div style="color:#666; font-size:12px; padding:6px 0;">Aucun import effectué pour l\'instant.</div>';
    return;
  }

  // Compte réel actuel par import (et non le compte figé au moment de l'import) :
  // après une fusion de doublons ou une suppression, des contacts disparaissent
  // de leur import d'origine — l'ancien compte figé devenait alors trompeur
  // (ex. "1681 contact(s)" affiché alors que la liste filtrée était vide).
  var allContacts = STORE.repertoireContacts();
  var liveCounts = {};
  allContacts.forEach(function(c) {
    if (c.importBatchId) liveCounts[c.importBatchId] = (liveCounts[c.importBatchId] || 0) + 1;
  });

  el.innerHTML = imports.map(function(imp) {
    var active = _rcFilterBatchId === imp.id;
    var icon = imp.source === 'file' ? '&#128193;' : '&#128241;';
    var liveCount = liveCounts[imp.id] || 0;
    var countLabel = liveCount + ' contact(s)' + (liveCount !== imp.count ? ' (sur ' + imp.count + ' import&eacute;s)' : '');
    return '<div style="display:flex; align-items:center; justify-content:space-between; gap:10px; padding:8px 12px; border-radius:6px; flex-wrap:wrap; background:' + (active ? 'rgba(212,175,55,0.12)' : '#161616') + '; border:1px solid ' + (active ? 'rgba(212,175,55,0.4)' : '#2a2a2a') + ';">'
      + '<span onclick="setRepertoireContactsFilter(\'' + imp.id + '\')" style="cursor:pointer; color:' + (active ? '#d4af37' : '#ccc') + '; font-size:12.5px; white-space:nowrap;">' + icon + ' Import du ' + esc(_rcFormatDateTime(imp.date)) + '</span>'
      + '<input type="text" value="' + esc(imp.label || '') + '" placeholder="Ajouter une note (ex: import du téléphone Oth)"'
      + ' onclick="event.stopPropagation()"'
      + ' onchange="updateRepertoireImportLabel(\'' + imp.id + '\', this.value)"'
      + ' style="flex:1; min-width:160px; padding:5px 9px; background:#0e0e0e; border:1px solid #2a2a2a; border-radius:6px; color:#e8e4dc; font-size:12px;">'
      + '<span onclick="setRepertoireContactsFilter(\'' + imp.id + '\')" style="cursor:pointer; color:' + (liveCount === 0 ? '#a33' : '#888') + '; font-size:11.5px; font-weight:700; white-space:nowrap;" title="' + (liveCount === 0 ? 'Tous les contacts de cet import ont été fusionnés ou supprimés' : '') + '">' + countLabel + '</span>'
      + '<button onclick="event.stopPropagation(); deleteRepertoireImport(\'' + imp.id + '\')" title="Supprimer cet import et ses contacts" style="background:none; border:1px solid #4a2a2a; color:#c66; border-radius:6px; padding:3px 8px; font-size:13px; cursor:pointer; line-height:1;">&times;</button>'
      + '</div>';
  }).join('');
}

// Supprime un import de l'historique ET tous les contacts qui en restent
// (avec tombstone pour empêcher leur résurrection lors d'une synchro ultérieure).
function deleteRepertoireImport(batchId) {
  var imports  = STORE.repertoireImports();
  var imp      = imports.find(function(i) { return i.id === batchId; });
  if (!imp) return;
  var contacts = STORE.repertoireContacts();
  var toRemove = contacts.filter(function(c) { return c.importBatchId === batchId; });
  var label    = imp.label ? ('« ' + imp.label + ' »') : ('du ' + _rcFormatDateTime(imp.date));
  if (!confirm('Supprimer l\'import ' + label + ' ainsi que ' + toRemove.length + ' contact(s) associé(s) ? Cette action est irréversible.')) return;

  var kept = contacts.filter(function(c) { return c.importBatchId !== batchId; });
  STORE.saveRepertoireContacts(kept);
  toRemove.forEach(function(c) { _markDeleted('mp_repertoire_contacts', c.id); });

  STORE.saveRepertoireImports(imports.filter(function(i) { return i.id !== batchId; }));
  _markDeleted('mp_repertoire_imports', batchId); // empêche la résurrection de l'import lors d'une synchro ultérieure

  if (_rcFilterBatchId === batchId) _rcFilterBatchId = null;
  renderRepertoireContactsPage();
  renderRepertoireImportsHistory();
  if (typeof _rcRenderDuplicatesBanner === 'function') _rcRenderDuplicatesBanner();
  _rcInfo('✓ Import supprimé (' + toRemove.length + ' contact(s) retiré(s)).', false);
}

function updateRepertoireImportLabel(batchId, label) {
  var imports = STORE.repertoireImports();
  var imp = imports.find(function(i) { return i.id === batchId; });
  if (!imp) return;
  imp.label = label;
  STORE.saveRepertoireImports(imports);
}

// Bascule le tableau entre "un import précis" (batchId) et "tous les contacts ensemble" (null)
function setRepertoireContactsFilter(batchId) {
  _rcFilterBatchId = batchId;
  renderRepertoireContactsPage();
  renderRepertoireImportsHistory();
  // Fait défiler jusqu'au tableau : sur petit écran (mobile), la liste filtrée
  // se trouve plus bas que l'historique d'imports et passait inaperçue.
  setTimeout(function() {
    var wrap = document.querySelector('#rc-panel-repertoire .rc-table-wrap') || document.getElementById('repertoire-contacts-tbody');
    if (wrap && wrap.scrollIntoView) wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 30);
}

// Numéro interne séquentiel (0001, 0002, ...) basé sur le plus grand numéro existant
function _rcMaxNumero(list) {
  var max = 0;
  (list || []).forEach(function(c) {
    var n = parseInt(c.numero, 10);
    if (!isNaN(n) && n > max) max = n;
  });
  return max;
}

function addRepertoireContactRow() {
  var list = STORE.repertoireContacts();
  var numero = String(_rcMaxNumero(list) + 1).padStart(4, '0');
  list.push({
    id: 'rc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    numero: numero,
    nom: '', prenom: '', adresse: '', ville: '', gouvernorat: '', pays: '',
    tel1: '', tel2: '', email: '', metier: '', domaine: '', note: '',
    importBatchId: null,
    tags: [], responsable: '', nextFollowUp: '', historique: [],
    updatedAt: new Date().toISOString()
  });
  STORE.saveRepertoireContacts(list);
  _rcFilterBatchId = null;
  renderRepertoireContactsPage();
  renderRepertoireImportsHistory();
}

function updateRepertoireContactField(id, field, value) {
  var list = STORE.repertoireContacts();
  var item = list.find(function(c) { return c.id === id; });
  if (!item) return;
  if (field === 'tel1' || field === 'tel2') value = _rcStripPhoneSpaces(value);
  item[field] = value;
  item.updatedAt = new Date().toISOString();
  STORE.saveRepertoireContacts(list);
}

// Supprime tous les espaces dans un numéro de téléphone (Tél 1 / Tél 2), sans toucher au reste.
function _rcStripPhoneSpaces(s) {
  return String(s || '').replace(/\s+/g, '');
}

function deleteRepertoireContact(id) {
  if (!confirm('Supprimer ce contact ?')) return;
  STORE.saveRepertoireContacts(STORE.repertoireContacts().filter(function(c) { return c.id !== id; }));
  _markDeleted('mp_repertoire_contacts', id); // empêche la résurrection du contact lors d'une synchro ultérieure
  renderRepertoireContactsPage();
  renderRepertoireImportsHistory();
}

// Attribue un numéro aux contacts existants qui n'en ont pas encore (anciens contacts
// créés avant l'ajout de la numérotation interne).
function _rcBackfillNumeros() {
  var list = STORE.repertoireContacts();
  var nextNum = _rcMaxNumero(list) + 1;
  var changed = false;
  list.forEach(function(c) {
    if (!c.numero) {
      c.numero = String(nextNum).padStart(4, '0');
      nextNum++;
      changed = true;
    }
  });
  if (changed) STORE.saveRepertoireContacts(list);
}

// ── Détection et fusion des doublons (téléphone ou email identiques) ──────
function _rcDetectDuplicateGroups() {
  var all = STORE.repertoireContacts();
  var byPhone = {}, byEmail = {};
  all.forEach(function(c) {
    var p = _rcCleanPhone(c.tel1);
    if (p) { (byPhone[p] = byPhone[p] || []).push(c); }
    var e = String(c.email || '').trim().toLowerCase();
    if (e) { (byEmail[e] = byEmail[e] || []).push(c); }
  });
  var groupsMap = {}; // id -> Set of ids in its group, via union of phone/email groups
  var groups = [];
  var seen = {};
  [byPhone, byEmail].forEach(function(map) {
    Object.keys(map).forEach(function(k) {
      var g = map[k];
      if (g.length < 2) return;
      var ids = g.map(function(c) { return c.id; }).sort();
      var key = ids.join(',');
      if (seen[key]) return;
      seen[key] = true;
      groups.push(g);
    });
  });
  return groups;
}

function _rcRenderDuplicatesBanner() {
  var el = document.getElementById('repertoire-duplicates-banner');
  if (!el) return;
  var groups = _rcDetectDuplicateGroups();
  if (!groups.length) { el.style.display = 'none'; el.innerHTML = ''; return; }

  el.style.display = '';
  el.innerHTML = '<div class="rc-dup-banner">'
    + '<div class="rc-dup-banner-title" style="display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap;">'
    + '<span>⚠️ ' + groups.length + ' groupe(s) de doublons potentiels d&eacute;tect&eacute;s (m&ecirc;me t&eacute;l&eacute;phone ou email).</span>'
    + (groups.length > 1 ? '<button class="btn btn-outline btn-sm" onclick="mergeAllDuplicateGroups()">Fusionner tous</button>' : '')
    + '</div>'
    + groups.map(function(g, gi) {
        return '<div class="rc-dup-group">'
          + g.map(function(c) {
              var name = ((c.prenom || '') + ' ' + (c.nom || '')).trim() || 'Sans nom';
              return '<span class="rc-dup-item">' + esc(name) + ' (' + esc(c.tel1 || c.email || '') + ')</span>';
            }).join(' &nbsp;/&nbsp; ')
          + ' <button class="btn btn-outline btn-sm" onclick="mergeDuplicateGroup(' + JSON.stringify(g.map(function(c){return c.id;})).replace(/"/g, '&quot;') + ')">Fusionner</button>'
          + '</div>';
      }).join('')
    + '</div>';
}

// Fusionne un groupe de doublons en un seul contact (logique pure, sans confirm()/render —
// utilisée à la fois par mergeDuplicateGroup et mergeAllDuplicateGroups). Conserve le premier
// comme contact canonique, complète ses champs vides avec ceux des autres, fusionne
// historique/tags, et renvoie la liste mise à jour (sans la sauvegarder).
function _rcMergeGroupInList(list, ids) {
  var group = ids.map(function(id) { return list.find(function(c) { return c.id === id; }); }).filter(Boolean);
  if (group.length < 2) return { list: list, merged: 0 };

  var primary = group[0];
  var others = group.slice(1);
  var simpleFields = ['nom','prenom','adresse','ville','gouvernorat','pays','tel1','tel2','email','metier','domaine','note','responsable','nextFollowUp'];

  others.forEach(function(o) {
    simpleFields.forEach(function(f) {
      if (!primary[f] && o[f]) primary[f] = o[f];
    });
    var tagsA = Array.isArray(primary.tags) ? primary.tags : [];
    var tagsB = Array.isArray(o.tags) ? o.tags : [];
    primary.tags = tagsA.concat(tagsB.filter(function(t) { return tagsA.indexOf(t) === -1; }));

    var histA = Array.isArray(primary.historique) ? primary.historique : [];
    var histB = Array.isArray(o.historique) ? o.historique : [];
    var histIds = histA.map(function(h) { return h.id; });
    histB.forEach(function(h) { if (histIds.indexOf(h.id) === -1) histA.push(h); });
    histA.sort(function(a, b) { return new Date(b.date) - new Date(a.date); });
    primary.historique = histA;
  });

  primary.updatedAt = new Date().toISOString();

  var otherIds = others.map(function(o) { return o.id; });
  var newList = list.filter(function(c) { return otherIds.indexOf(c.id) === -1; });
  return { list: newList, merged: group.length, removedIds: otherIds };
}

function mergeDuplicateGroup(ids) {
  if (!Array.isArray(ids) || ids.length < 2) return;
  if (!confirm('Fusionner ces ' + ids.length + ' contacts en un seul ? Cette action est irr&eacute;versible.')) return;

  var result = _rcMergeGroupInList(STORE.repertoireContacts(), ids);
  if (result.merged < 2) return;
  STORE.saveRepertoireContacts(result.list);
  (result.removedIds || []).forEach(function(rid) { _markDeleted('mp_repertoire_contacts', rid); });

  renderRepertoireContactsPage();
  _rcRenderDuplicatesBanner();
  if (_rcActiveTab === 'annuaire') renderContactsDirectory();
  _rcInfo('✓ Fusion effectu&eacute;e : ' + result.merged + ' contacts regroup&eacute;s en 1.', false);
}

// Fusionne en une seule fois tous les groupes de doublons détectés (un seul confirm()).
function mergeAllDuplicateGroups() {
  var groups = _rcDetectDuplicateGroups();
  if (!groups.length) return;

  var totalContacts = groups.reduce(function(n, g) { return n + g.length; }, 0);
  if (!confirm('Fusionner les ' + groups.length + ' groupes de doublons (' + totalContacts + ' contacts au total) ? Cette action est irr&eacute;versible.')) return;

  var list = STORE.repertoireContacts();
  var groupsCount = 0;
  var allRemovedIds = [];
  groups.forEach(function(g) {
    var ids = g.map(function(c) { return c.id; });
    var result = _rcMergeGroupInList(list, ids);
    if (result.merged >= 2) {
      list = result.list;
      groupsCount++;
      allRemovedIds = allRemovedIds.concat(result.removedIds || []);
    }
  });
  STORE.saveRepertoireContacts(list);
  allRemovedIds.forEach(function(rid) { _markDeleted('mp_repertoire_contacts', rid); });

  renderRepertoireContactsPage();
  _rcRenderDuplicatesBanner();
  if (_rcActiveTab === 'annuaire') renderContactsDirectory();
  _rcInfo('✓ Fusion globale effectu&eacute;e : ' + groupsCount + ' groupe(s) fusionn&eacute;(s).', false);
}

function renderRepertoireContactsPage() {
  var tbody = document.getElementById('repertoire-contacts-tbody');
  if (!tbody) return;

  _rcBackfillNumeros();

  var all = STORE.repertoireContacts();
  _rcPopulateDynamicFilters(all, 'rc-table-tag-filter', 'rc-table-responsable-filter');

  var list = _rcGetFilteredSortedContactsForTable();

  var activeFiltersCount = ['rc-table-filter-select', 'rc-table-tag-filter', 'rc-table-responsable-filter']
    .filter(function(id) { var el = document.getElementById(id); return el && el.value && el.value !== 'all'; }).length;

  var countEl = document.getElementById('repertoire-contacts-count');
  if (countEl) {
    var total = all.length;
    var scopeLabel = _rcFilterBatchId ? 'pour cet import' : 'tous ensemble';
    countEl.innerHTML = '<span class="cc-count-pill">' + list.length + ' affich&eacute;(s) ' + scopeLabel + '</span>'
      + '<span class="cc-count-pill">' + total + ' au total</span>'
      + (activeFiltersCount ? '<span class="cc-count-pill cc-count-today">' + activeFiltersCount + ' filtre(s) actif(s)</span>' : '');
  }

  var tabCountEl = document.getElementById('rc-tab-count-repertoire');
  if (tabCountEl) tabCountEl.textContent = all.length;

  if (_rcActiveTab === 'annuaire') renderContactsDirectory();

  var btnAll = document.getElementById('btn-rc-show-all');
  if (btnAll) {
    btnAll.style.borderColor = _rcFilterBatchId ? '#d4af37' : '';
    btnAll.style.color = _rcFilterBatchId ? '#d4af37' : '';
  }

  if (!list.length) {
    tbody.innerHTML = all.length
      ? '<tr><td colspan="14" style="padding:24px; text-align:center; color:#666;">Aucun contact ne correspond &agrave; ces filtres. <span style="color:#d4af37; cursor:pointer; text-decoration:underline;" onclick="_rcResetTableFilters()">R&eacute;initialiser les filtres</span></td></tr>'
      : '<tr><td colspan="14" style="padding:24px; text-align:center; color:#666;">Aucun contact. Importez depuis le t&eacute;l&eacute;phone ou ajoutez-en un manuellement.</td></tr>';
    return;
  }

  function cell(c, field, placeholder) {
    var isPhone = (field === 'tel1' || field === 'tel2');
    return '<td><input type="text" value="' + esc(c[field] || '') + '" placeholder="' + esc(placeholder || '') + '"'
      + ' onchange="updateRepertoireContactField(\'' + c.id + '\',\'' + field + '\',this.value);' + (isPhone ? ' this.value=this.value.replace(/\\s+/g,\'\');' : '') + '"'
      + '></td>';
  }

  tbody.innerHTML = list.map(function(c) {
    return '<tr>'
      + '<td onclick="openContactFiche(\'' + c.id + '\')" title="Voir la fiche">' + esc(c.numero || '----') + '</td>'
      + cell(c, 'nom', 'Nom')
      + cell(c, 'prenom', 'Prénom')
      + cell(c, 'adresse', 'Adresse')
      + cell(c, 'ville', 'Ville')
      + cell(c, 'gouvernorat', 'Gouvernorat')
      + cell(c, 'pays', 'Pays')
      + cell(c, 'tel1', 'Tél 1')
      + cell(c, 'tel2', 'Tél 2')
      + cell(c, 'email', 'Email')
      + cell(c, 'metier', 'Métier')
      + cell(c, 'domaine', 'Domaine')
      + cell(c, 'note', 'Note')
      + '<td class="rc-table-actions">'
      + '<button class="btn btn-outline btn-sm" onclick="openContactFiche(\'' + c.id + '\')" title="Voir la fiche" style="margin-right:4px;">Fiche</button>'
      + '<button class="btn btn-danger btn-sm" onclick="deleteRepertoireContact(\'' + c.id + '\')" title="Supprimer">&times;</button>'
      + '</td>'
      + '</tr>';
  }).join('');
}

// ---- Carnet d'adresses : bascule Répertoire (gestion) / Annuaire (appel rapide) ----

function setContactsTab(tab) {
  _rcActiveTab = tab;
  var panelRep = document.getElementById('rc-panel-repertoire');
  var panelAnn = document.getElementById('rc-panel-annuaire');
  var btnRep = document.getElementById('rc-tab-btn-repertoire');
  var btnAnn = document.getElementById('rc-tab-btn-annuaire');
  if (panelRep) panelRep.style.display = (tab === 'repertoire') ? '' : 'none';
  if (panelAnn) panelAnn.style.display = (tab === 'annuaire') ? '' : 'none';
  if (btnRep) btnRep.classList.toggle('active', tab === 'repertoire');
  if (btnAnn) btnAnn.classList.toggle('active', tab === 'annuaire');
  if (tab === 'annuaire') renderContactsDirectory();
}

function _rcInitials(c) {
  var n = ((c.prenom || '').trim().charAt(0) + (c.nom || '').trim().charAt(0)).trim();
  return (n || '?').toUpperCase();
}

function _rcCleanPhone(s) {
  return String(s || '').replace(/[^\d+]/g, '');
}

function _rcWhatsappNumber(s) {
  return String(s || '').replace(/[^\d]/g, '');
}

// ── Historique des interactions par contact ──────────────────────────
// Chaque contact porte un tableau c.historique = [{id, type, date, note, outcome}]
// type ∈ 'call' | 'whatsapp' | 'email' | 'note'. Le plus récent est en tête.
// outcome (uniquement utile pour type='call') ∈ 'interested' | 'refused' | 'no_answer' | 'callback'.
var RC_HISTORY_TYPES = {
  call:     { icon: '📞', label: 'Appel' },
  whatsapp: { icon: '💬', label: 'WhatsApp' },
  email:    { icon: '✉️', label: 'Email' },
  note:     { icon: '📝', label: 'Note' }
};

var RC_OUTCOMES = {
  interested: { icon: '👍', label: 'Int&eacute;ress&eacute;', cls: 'cc-outcome-good' },
  refused:    { icon: '👎', label: 'Refus',          cls: 'cc-outcome-bad'  },
  no_answer:  { icon: '🔇', label: 'Pas de r&eacute;ponse', cls: 'cc-outcome-neutral' },
  callback:   { icon: '🔁', label: 'À rappeler',      cls: 'cc-outcome-neutral' }
};

// Modèles de note rapide, utilisés dans le formulaire d'ajout manuel à l'historique
var RC_NOTE_TEMPLATES = [
  "غير مهتم حالياً",
  "طلب إعادة الاتصال الأسبوع القادم",
  "لم يرد",
  "مهتم - يحتاج عرض سعر"
];

function logContactHistory(contactId, type, note, outcome) {
  var list = STORE.repertoireContacts();
  var c = list.find(function(x) { return x.id === contactId; });
  if (!c) return;
  if (!Array.isArray(c.historique)) c.historique = [];
  c.historique.unshift({
    id: 'h_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    type: type,
    date: new Date().toISOString(),
    note: note || '',
    outcome: outcome || ''
  });
  STORE.saveRepertoireContacts(list);
  _rcAfterContactsMutation(contactId);
}

// Définit (ou corrige) le résultat de la dernière interaction "appel" enregistrée —
// utile pour noter le résultat juste après avoir raccroché, sans créer une nouvelle ligne.
function setLastCallOutcome(contactId, outcome) {
  var list = STORE.repertoireContacts();
  var c = list.find(function(x) { return x.id === contactId; });
  if (!c || !Array.isArray(c.historique)) return;
  var lastCall = c.historique.find(function(h) { return h.type === 'call'; });
  if (!lastCall) return;
  lastCall.outcome = outcome;
  STORE.saveRepertoireContacts(list);
  _rcAfterContactsMutation(contactId);
}

function _rcAfterContactsMutation(contactId) {
  if (_rcActiveTab === 'annuaire') renderContactsDirectory();
  if (typeof currentContactFicheId !== 'undefined' && currentContactFicheId === contactId) renderContactFiche();
}

function _rcLastHistoryEntry(c) {
  return (Array.isArray(c.historique) && c.historique.length) ? c.historique[0] : null;
}

function _rcLastCallEntry(c) {
  return (Array.isArray(c.historique) ? c.historique : []).find(function(h) { return h.type === 'call'; }) || null;
}

// Statut d'appel façon centre d'appel : aujourd'hui / cette semaine / ancien / jamais
function _rcContactStatus(c) {
  var last = _rcLastHistoryEntry(c);
  if (!last) return { cls: 'cc-status-never', label: 'Jamais contact&eacute;', bucket: 'never' };
  var diffDays = (Date.now() - new Date(last.date).getTime()) / 86400000;
  if (diffDays < 1)  return { cls: 'cc-status-today', label: "Aujourd'hui", bucket: 'today' };
  if (diffDays < 7)  return { cls: 'cc-status-week',  label: 'Cette semaine', bucket: 'week' };
  return { cls: 'cc-status-old', label: _rcFormatDateTime(last.date), bucket: 'old' };
}

// Suivi (follow-up) : retourne 'overdue' / 'today' / null selon contact.nextFollowUp (date YYYY-MM-DD)
function _rcFollowUpBucket(c) {
  if (!c.nextFollowUp) return null;
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var fu = new Date(c.nextFollowUp + 'T00:00:00');
  if (isNaN(fu.getTime())) return null;
  if (fu.getTime() < today.getTime()) return 'overdue';
  if (fu.getTime() === today.getTime()) return 'today';
  return null;
}

function _rcFollowUpBadge(c) {
  var b = _rcFollowUpBucket(c);
  if (b === 'overdue') return '<span class="cc-followup-badge cc-followup-overdue" title="Suivi en retard">&#9201; Retard</span>';
  if (b === 'today')   return '<span class="cc-followup-badge cc-followup-today" title="Suivi pr&eacute;vu aujourd\'hui">&#128197; Aujourd\'hui</span>';
  return '';
}

// Construit la liste filtrée/triée commune à l'affichage et à l'export
function _rcGetFilteredSortedContacts() {
  var query = (document.getElementById('repertoire-contacts-search') || {}).value || '';
  query = query.toLowerCase().trim();
  var fields = ['nom','prenom','adresse','ville','gouvernorat','pays','tel1','tel2','email','metier','domaine','note','responsable'];
  var sortMode    = (document.getElementById('rc-sort-select')        || {}).value || 'nom';
  var filterMode  = (document.getElementById('rc-filter-select')      || {}).value || 'all';
  var tagFilter   = (document.getElementById('rc-tag-filter')         || {}).value || '';
  var respFilter  = (document.getElementById('rc-responsable-filter') || {}).value || '';

  var list = STORE.repertoireContacts().slice();

  if (query) {
    list = list.filter(function(c) {
      return fields.some(function(f) { return String(c[f] || '').toLowerCase().includes(query); })
        || (Array.isArray(c.tags) && c.tags.some(function(t) { return String(t).toLowerCase().includes(query); }));
    });
  }

  if (filterMode === 'followup_due') {
    list = list.filter(function(c) { return !!_rcFollowUpBucket(c); });
  } else if (filterMode !== 'all') {
    list = list.filter(function(c) { return _rcContactStatus(c).bucket === filterMode; });
  }

  if (tagFilter) {
    list = list.filter(function(c) { return Array.isArray(c.tags) && c.tags.indexOf(tagFilter) !== -1; });
  }

  if (respFilter) {
    list = list.filter(function(c) { return (c.responsable || '') === respFilter; });
  }

  list.sort(function(a, b) {
    if (sortMode === 'ville') return String(a.ville || '').localeCompare(String(b.ville || ''));
    if (sortMode === 'recent' || sortMode === 'oldest') {
      var la = _rcLastHistoryEntry(a), lb = _rcLastHistoryEntry(b);
      var ta = la ? new Date(la.date).getTime() : 0;
      var tb = lb ? new Date(lb.date).getTime() : 0;
      return sortMode === 'recent' ? (tb - ta) : (ta - tb);
    }
    return String(a.nom || '').localeCompare(String(b.nom || ''));
  });

  return list;
}

// Filtre/tri avancé pour le tableau du Répertoire ("tous les contacts ensemble") —
// même esprit que _rcGetFilteredSortedContacts (Annuaire), mais avec ses propres
// contrôles (IDs distincts) et en tenant compte en plus du filtre "import" actif
// (_rcFilterBatchId) et du tri par numéro interne.
function _rcGetFilteredSortedContactsForTable() {
  var query = (document.getElementById('repertoire-contacts-search') || {}).value || '';
  query = query.toLowerCase().trim();
  var fields = ['nom','prenom','adresse','ville','gouvernorat','pays','tel1','tel2','email','metier','domaine','note','responsable'];
  var sortMode   = (document.getElementById('rc-table-sort-select')        || {}).value || 'nom';
  var filterMode = (document.getElementById('rc-table-filter-select')      || {}).value || 'all';
  var tagFilter  = (document.getElementById('rc-table-tag-filter')         || {}).value || '';
  var respFilter = (document.getElementById('rc-table-responsable-filter') || {}).value || '';

  var list = STORE.repertoireContacts().slice();

  if (_rcFilterBatchId) {
    list = list.filter(function(c) { return c.importBatchId === _rcFilterBatchId; });
  }

  if (query) {
    list = list.filter(function(c) {
      return fields.some(function(f) { return String(c[f] || '').toLowerCase().includes(query); })
        || (Array.isArray(c.tags) && c.tags.some(function(t) { return String(t).toLowerCase().includes(query); }));
    });
  }

  if (filterMode === 'followup_due') {
    list = list.filter(function(c) { return !!_rcFollowUpBucket(c); });
  } else if (filterMode !== 'all') {
    list = list.filter(function(c) { return _rcContactStatus(c).bucket === filterMode; });
  }

  if (tagFilter) {
    list = list.filter(function(c) { return Array.isArray(c.tags) && c.tags.indexOf(tagFilter) !== -1; });
  }

  if (respFilter) {
    list = list.filter(function(c) { return (c.responsable || '') === respFilter; });
  }

  list.sort(function(a, b) {
    if (sortMode === 'numero_asc' || sortMode === 'numero_desc') {
      var na = parseInt(a.numero, 10) || 0, nb = parseInt(b.numero, 10) || 0;
      return sortMode === 'numero_asc' ? (na - nb) : (nb - na);
    }
    if (sortMode === 'ville') return String(a.ville || '').localeCompare(String(b.ville || ''));
    if (sortMode === 'recent' || sortMode === 'oldest') {
      var la = _rcLastHistoryEntry(a), lb = _rcLastHistoryEntry(b);
      var ta = la ? new Date(la.date).getTime() : 0;
      var tb = lb ? new Date(lb.date).getTime() : 0;
      return sortMode === 'recent' ? (tb - ta) : (ta - tb);
    }
    return String(a.nom || '').localeCompare(String(b.nom || ''));
  });

  return list;
}

// Réinitialise les filtres/tri avancés du tableau Répertoire (mais pas la recherche ni l'import actif)
function _rcResetTableFilters() {
  ['rc-table-sort-select', 'rc-table-filter-select', 'rc-table-tag-filter', 'rc-table-responsable-filter'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.value = (id === 'rc-table-sort-select') ? 'nom' : (id === 'rc-table-filter-select' ? 'all' : '');
  });
  renderRepertoireContactsPage();
}

// Remplit dynamiquement les filtres "tags" et "responsable" à partir des valeurs existantes,
// en conservant la sélection courante si elle est toujours valide. Générique : accepte les ID
// des deux <select> concernés, pour pouvoir être réutilisé sur plusieurs onglets (Annuaire, Répertoire).
function _rcPopulateDynamicFilters(all, tagSelId, respSelId) {
  var tagSel  = document.getElementById(tagSelId  || 'rc-tag-filter');
  var respSel = document.getElementById(respSelId || 'rc-responsable-filter');

  if (tagSel) {
    var tags = [];
    all.forEach(function(c) { (c.tags || []).forEach(function(t) { if (t && tags.indexOf(t) === -1) tags.push(t); }); });
    tags.sort(function(a, b) { return a.localeCompare(b); });
    var curTag = tagSel.value;
    tagSel.innerHTML = '<option value="">Tous les tags</option>' + tags.map(function(t) {
      return '<option value="' + esc(t) + '">' + esc(t) + '</option>';
    }).join('');
    if (tags.indexOf(curTag) !== -1) tagSel.value = curTag;
  }

  if (respSel) {
    var resps = [];
    all.forEach(function(c) { if (c.responsable && resps.indexOf(c.responsable) === -1) resps.push(c.responsable); });
    resps.sort(function(a, b) { return a.localeCompare(b); });
    var curResp = respSel.value;
    respSel.innerHTML = '<option value="">Tous les responsables</option>' + resps.map(function(r) {
      return '<option value="' + esc(r) + '">' + esc(r) + '</option>';
    }).join('');
    if (resps.indexOf(curResp) !== -1) respSel.value = curResp;
  }
}

// Calcule les statistiques globales (toujours sur l'ensemble des contacts, pas seulement filtrés)
function _rcComputeStats(all) {
  var callsToday = 0, callsWeek = 0, withOutcome = 0, interested = 0;
  var metierCount = {}, villeCount = {};
  all.forEach(function(c) {
    if (c.metier) metierCount[c.metier] = (metierCount[c.metier] || 0) + 1;
    if (c.ville)  villeCount[c.ville]   = (villeCount[c.ville]   || 0) + 1;
    (c.historique || []).forEach(function(h) {
      if (h.type === 'call') {
        var diffDays = (Date.now() - new Date(h.date).getTime()) / 86400000;
        if (diffDays < 1) callsToday++;
        if (diffDays < 7) callsWeek++;
        if (h.outcome) {
          withOutcome++;
          if (h.outcome === 'interested') interested++;
        }
      }
    });
  });
  function topOf(counts) {
    var best = null, bestN = 0;
    Object.keys(counts).forEach(function(k) { if (counts[k] > bestN) { best = k; bestN = counts[k]; } });
    return best;
  }
  return {
    callsToday: callsToday,
    callsWeek: callsWeek,
    responseRate: withOutcome ? Math.round((interested / withOutcome) * 100) : null,
    topMetier: topOf(metierCount),
    topVille: topOf(villeCount)
  };
}

function _rcRenderStats(all) {
  var el = document.getElementById('rc-annuaire-stats');
  if (!el) return;
  var s = _rcComputeStats(all);
  el.innerHTML = ''
    + '<span class="cc-stat-pill">&#128222; ' + s.callsToday + ' appel(s) aujourd\'hui</span>'
    + '<span class="cc-stat-pill">&#128197; ' + s.callsWeek + ' appel(s) cette semaine</span>'
    + '<span class="cc-stat-pill">&#127919; Taux de r&eacute;ponse : ' + (s.responseRate === null ? '—' : s.responseRate + '%') + '</span>'
    + (s.topMetier ? '<span class="cc-stat-pill">&#128188; M&eacute;tier top : ' + esc(s.topMetier) + '</span>' : '')
    + (s.topVille  ? '<span class="cc-stat-pill">&#128205; Ville top : ' + esc(s.topVille) + '</span>'   : '');
}

// Annuaire d'appel : liste compacte façon centre d'appel — recherche, tri, filtre, statut d'appel
function renderContactsDirectory() {
  var grid = document.getElementById('contacts-directory-grid');
  if (!grid) return;

  var all = STORE.repertoireContacts();

  _rcPopulateDynamicFilters(all);
  _rcRenderStats(all);

  var countToday = 0, countNever = 0;
  all.forEach(function(c) {
    var st = _rcContactStatus(c);
    if (st.bucket === 'today') countToday++;
    if (st.bucket === 'never') countNever++;
  });
  var countsEl = document.getElementById('rc-annuaire-counts');
  if (countsEl) {
    countsEl.innerHTML = ''
      + '<span class="cc-count-pill">' + all.length + ' contact' + (all.length === 1 ? '' : 's') + '</span>'
      + '<span class="cc-count-pill cc-count-today">' + countToday + ' aujourd\'hui</span>'
      + '<span class="cc-count-pill cc-count-never">' + countNever + ' jamais contact&eacute;s</span>';
  }

  var list = _rcGetFilteredSortedContacts();

  if (!list.length) {
    grid.innerHTML = '<div class="contacts-directory-empty">Aucun contact ne correspond. Importez depuis le t&eacute;l&eacute;phone, ajoutez-en un manuellement, ou changez le filtre.</div>';
    return;
  }

  grid.innerHTML = list.map(function(c) {
    var name = ((c.prenom || '') + ' ' + (c.nom || '')).trim() || 'Sans nom';
    var sub = [c.metier, c.ville].filter(Boolean).join(' · ') || (c.tel1 || c.email || '—');
    var tel1 = _rcCleanPhone(c.tel1);
    var wa = _rcWhatsappNumber(c.tel1);
    var status = _rcContactStatus(c);

    var tags = Array.isArray(c.tags) ? c.tags : [];
    var tagsHtml = tags.slice(0, 2).map(function(t) { return '<span class="cc-tag-pill">' + esc(t) + '</span>'; }).join('')
      + (tags.length > 2 ? '<span class="cc-tag-pill cc-tag-more">+' + (tags.length - 2) + '</span>' : '');

    var callBtn = tel1
      ? '<a class="cc-call" href="tel:' + esc(tel1) + '" onclick="logContactHistory(\'' + c.id + '\',\'call\')" title="Appeler">&#128222;</a>'
      : '<span class="cc-call cc-disabled">&#128222;</span>';
    var waBtn = wa
      ? '<a class="cc-whatsapp" href="https://wa.me/' + esc(wa) + '" target="_blank" rel="noopener" onclick="logContactHistory(\'' + c.id + '\',\'whatsapp\')" title="WhatsApp">&#128172;</a>'
      : '<span class="cc-whatsapp cc-disabled">&#128172;</span>';
    var mailBtn = c.email
      ? '<a class="cc-email" href="mailto:' + esc(c.email) + '" onclick="logContactHistory(\'' + c.id + '\',\'email\')" title="Email">&#9993;</a>'
      : '<span class="cc-email cc-disabled">&#9993;</span>';
    var ficheBtn = '<button class="cc-fiche" onclick="openContactFiche(\'' + c.id + '\')" title="Fiche compl&egrave;te">&#128209;</button>';

    return '<div class="cc-row">'
      + '<span class="cc-status-dot ' + status.cls + '" title="' + esc(status.label) + '"></span>'
      + '<div class="cc-row-avatar">' + esc(_rcInitials(c)) + '</div>'
      + '<div class="cc-row-info" onclick="openContactFiche(\'' + c.id + '\')">'
      + '<div class="cc-row-name">' + esc(name) + (tagsHtml ? ' ' + tagsHtml : '') + '</div>'
      + '<div class="cc-row-sub">' + esc(sub) + '</div>'
      + '</div>'
      + '<div class="cc-row-status">' + status.label + ' ' + _rcFollowUpBadge(c) + '</div>'
      + '<div class="cc-row-actions">' + callBtn + waBtn + mailBtn + ficheBtn + '</div>'
      + '</div>';
  }).join('');
}

// Export CSV (compatible Excel) de la liste actuellement filtrée/triée dans l'Annuaire
function exportContactsDirectoryCSV() {
  var list = _rcGetFilteredSortedContacts();
  if (!list.length) { alert('Aucun contact à exporter avec ces filtres.'); return; }

  var headers = ['Nom','Prénom','Téléphone 1','Téléphone 2','Email','Ville','Métier','Domaine','Responsable','Tags','Dernier contact','Statut','Note'];
  function csvCell(v) {
    var s = String(v == null ? '' : v).replace(/"/g, '""');
    return '"' + s + '"';
  }
  var rows = list.map(function(c) {
    var last = _rcLastHistoryEntry(c);
    var status = _rcContactStatus(c);
    return [
      c.nom || '', c.prenom || '', c.tel1 || '', c.tel2 || '', c.email || '',
      c.ville || '', c.metier || '', c.domaine || '', c.responsable || '',
      (Array.isArray(c.tags) ? c.tags.join(', ') : ''),
      last ? _rcFormatDateTime(last.date) : '',
      status.label.replace(/&eacute;/g, 'é').replace(/&agrave;/g, 'à'),
      c.note || ''
    ].map(csvCell).join(',');
  });

  var csv = '﻿' + headers.map(csvCell).join(',') + '\r\n' + rows.join('\r\n');
  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'annuaire_contacts_' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
}

// ---- Fiche contact (vue détail avec toutes les informations) ----
var currentContactFicheId = null;

function openContactFiche(id) {
  currentContactFicheId = id;
  showView('contact-fiche');
}

function renderContactFiche() {
  var list = STORE.repertoireContacts();
  var c = list.find(function(x) { return x.id === currentContactFicheId; });
  var headerEl = document.getElementById('contact-fiche-header');
  var bodyEl   = document.getElementById('contact-fiche-body');
  if (!bodyEl || !headerEl) return;

  if (!c) {
    headerEl.innerHTML = '';
    bodyEl.innerHTML = '<div style="color:#666;">Contact introuvable.</div>';
    return;
  }

  var originText, originIcon;
  if (c.importBatchId) {
    var imports = STORE.repertoireImports();
    var imp = imports.find(function(i) { return i.id === c.importBatchId; });
    if (imp) {
      originIcon = imp.source === 'file' ? '📁' : '📱';
      originText = (imp.source === 'file' ? 'Fichier .vcf' : 'Téléphone') + ' — ' + _rcFormatDateTime(imp.date) + (imp.label ? ' — ' + imp.label : '');
    } else {
      originIcon = '📁';
      originText = 'Import (historique supprimé)';
    }
  } else {
    originIcon = '✍️';
    originText = 'Ajouté manuellement';
  }

  var name = ((c.prenom || '') + ' ' + (c.nom || '')).trim() || 'Sans nom';
  var tel1 = _rcCleanPhone(c.tel1);
  var wa = _rcWhatsappNumber(c.tel1);

  var actionsHtml = ''
    + (tel1
        ? '<a class="cf-call" href="tel:' + esc(tel1) + '" onclick="logContactHistory(\'' + c.id + '\',\'call\')" title="Appeler">&#128222; Appeler</a>'
        : '<span class="cf-call cc-disabled">&#128222; Appeler</span>')
    + (wa
        ? '<a class="cf-whatsapp" href="https://wa.me/' + esc(wa) + '" target="_blank" rel="noopener" onclick="logContactHistory(\'' + c.id + '\',\'whatsapp\')" title="WhatsApp">&#128172; WhatsApp</a>'
        : '<span class="cf-whatsapp cc-disabled">&#128172; WhatsApp</span>')
    + (c.email
        ? '<a class="cf-email" href="mailto:' + esc(c.email) + '" onclick="logContactHistory(\'' + c.id + '\',\'email\')" title="Email">&#9993; Email</a>'
        : '<span class="cf-email cc-disabled">&#9993; Email</span>')
    + '<button class="cf-delete" onclick="deleteRepertoireContact(\'' + c.id + '\'); showView(\'gestion-contacts\');" title="Supprimer">&times; Supprimer</button>';

  headerEl.innerHTML = ''
    + '<div class="contact-fiche-avatar">' + esc(_rcInitials(c)) + '</div>'
    + '<div class="contact-fiche-id">'
    + '<div class="contact-fiche-name">' + esc(name) + '</div>'
    + '<div class="contact-fiche-meta">'
    + '<span class="contact-fiche-badge">N&deg; ' + esc(c.numero || '----') + '</span>'
    + (c.metier ? '<span class="contact-fiche-badge">' + esc(c.metier) + '</span>' : '')
    + '<span class="contact-fiche-badge origin">' + originIcon + ' ' + esc(originText) + '</span>'
    + '</div>'
    + '</div>'
    + '<div class="contact-fiche-actions">' + actionsHtml + '</div>';

  function field(f, label, type) {
    var isPhone = (f === 'tel1' || f === 'tel2');
    return '<div class="contact-fiche-field">'
      + '<label>' + esc(label) + '</label>'
      + '<input type="' + (type || 'text') + '" value="' + esc(c[f] || '') + '"'
      + ' onchange="updateRepertoireContactField(\'' + c.id + '\',\'' + f + '\',' + (isPhone ? 'this.value.replace(/\\s+/g,\'\')' : 'this.value') + '); renderContactFiche();"'
      + '>'
      + '</div>';
  }

  var tagsValue = (Array.isArray(c.tags) ? c.tags : []).join(', ');
  var tagsFieldHtml = '<div class="contact-fiche-field">'
    + '<label>Tags (s&eacute;par&eacute;s par une virgule)</label>'
    + '<input type="text" value="' + esc(tagsValue) + '" placeholder="ex: VIP, urgent"'
    + ' onchange="updateRepertoireContactTags(\'' + c.id + '\', this.value); renderContactFiche();"'
    + '>'
    + '</div>';

  // Puce de résultat de la dernière interaction "appel" enregistrée, modifiable en un clic
  var lastCall = _rcLastCallEntry(c);
  var outcomeChipsHtml = '';
  if (lastCall) {
    outcomeChipsHtml = '<div class="cf-outcome-row">'
      + '<span class="cf-outcome-label">R&eacute;sultat du dernier appel (' + esc(_rcFormatDateTime(lastCall.date)) + ') :</span>'
      + Object.keys(RC_OUTCOMES).map(function(k) {
          var o = RC_OUTCOMES[k];
          var active = lastCall.outcome === k ? ' active' : '';
          return '<button class="cf-outcome-chip ' + o.cls + active + '" onclick="setLastCallOutcome(\'' + c.id + '\',\'' + k + '\')">' + o.icon + ' ' + o.label + '</button>';
        }).join('')
      + '</div>';
  }

  bodyEl.innerHTML = ''
    + '<div>'
    + '<div class="contact-fiche-section-title">Coordonn&eacute;es</div>'
    + '<div class="contact-fiche-grid">'
    + field('tel1', 'T&eacute;l&eacute;phone 1') + field('tel2', 'T&eacute;l&eacute;phone 2') + field('email', 'Email')
    + field('adresse', 'Adresse') + field('ville', 'Ville') + field('gouvernorat', 'Gouvernorat') + field('pays', 'Pays')
    + '</div>'
    + '</div>'
    + '<div>'
    + '<div class="contact-fiche-section-title">Professionnel</div>'
    + '<div class="contact-fiche-grid">'
    + field('nom', 'Nom') + field('prenom', 'Pr&eacute;nom') + field('metier', 'M&eacute;tier') + field('domaine', 'Domaine')
    + field('responsable', 'Responsable') + field('nextFollowUp', 'Prochain suivi', 'date')
    + '</div>'
    + '</div>'
    + '<div>'
    + '<div class="contact-fiche-section-title">Tags &amp; Note</div>'
    + '<div class="contact-fiche-grid">' + tagsFieldHtml + field('note', 'Note') + '</div>'
    + '</div>'
    + '<div>'
    + '<div class="contact-fiche-section-title">Historique des interactions</div>'
    + outcomeChipsHtml
    + '<div class="cf-note-templates">'
    + RC_NOTE_TEMPLATES.map(function(t) {
        return '<button class="cf-note-template" onclick="_rcFillHistoryNote(' + JSON.stringify(t).replace(/"/g, '&quot;') + ')">' + esc(t) + '</button>';
      }).join('')
    + '</div>'
    + '<div class="cf-history-add">'
    + '<select id="cf-history-type" onchange="_rcToggleOutcomeSelect()">'
    + '<option value="note">&#128221; Note</option>'
    + '<option value="call">&#128222; Appel</option>'
    + '<option value="whatsapp">&#128172; WhatsApp</option>'
    + '<option value="email">&#9993; Email</option>'
    + '</select>'
    + '<select id="cf-history-outcome" style="display:none;">'
    + '<option value="">R&eacute;sultat (optionnel)</option>'
    + Object.keys(RC_OUTCOMES).map(function(k) { return '<option value="' + k + '">' + RC_OUTCOMES[k].icon + ' ' + RC_OUTCOMES[k].label + '</option>'; }).join('')
    + '</select>'
    + '<input type="text" id="cf-history-note" placeholder="D&eacute;tail de l\'interaction (optionnel)..." onkeydown="if(event.key===\'Enter\'){addManualContactHistory(\'' + c.id + '\');}">'
    + '<button class="btn btn-outline btn-sm" onclick="addManualContactHistory(\'' + c.id + '\')">+ Ajouter &agrave; l\'historique</button>'
    + '</div>'
    + '<div class="cf-history-timeline">' + _rcRenderHistoryTimeline(c) + '</div>'
    + '</div>';
}

function _rcToggleOutcomeSelect() {
  var typeEl = document.getElementById('cf-history-type');
  var outcomeEl = document.getElementById('cf-history-outcome');
  if (!typeEl || !outcomeEl) return;
  outcomeEl.style.display = (typeEl.value === 'call') ? '' : 'none';
}

function _rcFillHistoryNote(text) {
  var noteEl = document.getElementById('cf-history-note');
  if (!noteEl) return;
  noteEl.value = text;
  noteEl.focus();
  noteEl.setSelectionRange(noteEl.value.length, noteEl.value.length);
}

function _rcRenderHistoryTimeline(c) {
  var entries = Array.isArray(c.historique) ? c.historique : [];
  if (!entries.length) {
    return '<div class="cf-history-empty">Aucune interaction enregistr&eacute;e pour le moment.</div>';
  }
  return entries.map(function(h) {
    var meta = RC_HISTORY_TYPES[h.type] || RC_HISTORY_TYPES.note;
    var outcomeBadge = (h.outcome && RC_OUTCOMES[h.outcome])
      ? '<span class="cf-history-outcome ' + RC_OUTCOMES[h.outcome].cls + '">' + RC_OUTCOMES[h.outcome].icon + ' ' + RC_OUTCOMES[h.outcome].label + '</span>'
      : '';
    return '<div class="cf-history-entry">'
      + '<span class="cf-history-icon">' + meta.icon + '</span>'
      + '<div class="cf-history-content">'
      + '<div class="cf-history-top"><span class="cf-history-type">' + esc(meta.label) + outcomeBadge + '</span><span class="cf-history-date">' + esc(_rcFormatDateTime(h.date)) + '</span></div>'
      + (h.note ? '<div class="cf-history-note">' + esc(h.note) + '</div>' : '')
      + '</div>'
      + '</div>';
  }).join('');
}

function addManualContactHistory(contactId) {
  var typeEl = document.getElementById('cf-history-type');
  var noteEl = document.getElementById('cf-history-note');
  var outcomeEl = document.getElementById('cf-history-outcome');
  var type = typeEl ? typeEl.value : 'note';
  var note = noteEl ? noteEl.value.trim() : '';
  var outcome = (outcomeEl && type === 'call') ? outcomeEl.value : '';
  logContactHistory(contactId, type, note, outcome);
}

// Met à jour le tableau de tags d'un contact à partir d'une chaîne "tag1, tag2, ..."
function updateRepertoireContactTags(id, rawValue) {
  var list = STORE.repertoireContacts();
  var item = list.find(function(c) { return c.id === id; });
  if (!item) return;
  item.tags = String(rawValue || '').split(',').map(function(t) { return t.trim(); }).filter(Boolean);
  item.updatedAt = new Date().toISOString();
  STORE.saveRepertoireContacts(list);
}