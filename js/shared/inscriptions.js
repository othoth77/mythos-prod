// MYTHOS PROD — INSCRIPTIONS v1
// Inscription/Appels workflow: Google Sheet integration, UCL numbering,
// validation, call-fiche modal, call-script settings, Google Sheet push.
// Dependencies: STORE.appels/validatedInscriptions/saveAppels/saveValidatedInscriptions (app.js);
//   _storeGet, _storeSave (storage.js); fetch, document, alert, confirm, _tchToast (browser/app)
// ── Inscriptions (lecture en direct du Google Sheet via Apps Script) ──
var INSCRIPTIONS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxwTJdycLxD_ooTnRp4VgS4kGP7CEX9HotUSTRk27r4OB5FNR1WK7Tf4lz8DKu64I0/exec";

function _escHtmlInsc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, function(c) {
    return ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c];
  });
}

function loadDashboardInscriptionsCount() {
  var el = document.getElementById('dashboard-inscriptions-count');
  if (!el) return;
  fetch(INSCRIPTIONS_SCRIPT_URL + '?_=' + Date.now())
    .then(function(r) { return r.json(); })
    .then(function(json) {
      var rows = (json && json.rows) || [];
      var validated = STORE.validatedInscriptions();
      var validatedSet = {};
      validated.forEach(function(num) { validatedSet[num] = true; });
      var visible = rows.filter(function(r, i) { return !validatedSet[_uclNum(i)]; });
      el.textContent = String(visible.length);
    })
    .catch(function() {});
}

function _uclNum(i) {
  return 'UCL' + String(i + 1).padStart(4, '0');
}

function _appUid() {
  return 'app_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
}

function loadInscriptions() {
  var tbody = document.getElementById('inscriptions-tbody');
  var countEl = document.getElementById('inscriptions-count');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" style="padding:48px;text-align:center;color:#666;font-size:15px;">Chargement&hellip;</td></tr>';

  fetch(INSCRIPTIONS_SCRIPT_URL + '?_=' + Date.now())
    .then(function(r) { return r.json(); })
    .then(function(json) {
      var allRows = (json && json.rows) || [];
      // numérotation UCL0001, UCL0002... basée sur l'ordre chronologique réel (avant filtrage/inversion)
      var numbered = allRows.map(function(r, i) { return { r: r, num: _uclNum(i) }; });

      var validated = STORE.validatedInscriptions();
      var validatedSet = {};
      validated.forEach(function(num) { validatedSet[num] = true; });

      // seules les inscriptions PAS encore validées restent affichées ici
      var visible = numbered.filter(function(entry) { return !validatedSet[entry.num]; });

      if (countEl) countEl.textContent = String(visible.length);

      if (!visible.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="padding:48px;text-align:center;color:#666;font-size:15px;">&#128679; Aucune inscription pour le moment.</td></tr>';
        return;
      }
      visible = visible.slice().reverse(); // la plus récente en premier à l'affichage
      tbody.innerHTML = visible.map(function(entry, i) {
        var r = entry.r;
        var bg = (i % 2 === 0) ? 'rgba(255,255,255,0.015)' : 'transparent';
        return '<tr data-num="' + _escHtmlInsc(entry.num) + '" data-date="' + _escHtmlInsc(r.date) + '" data-heure="' + _escHtmlInsc(r.heure) + '" data-nom="' + _escHtmlInsc(r.nom) + '" data-tel="' + _escHtmlInsc(r.tel) + '" style="border-bottom:1px solid rgba(255,255,255,0.06);background:' + bg + ';transition:background .15s;" onmouseover="this.style.background=\'rgba(201,168,76,0.08)\'" onmouseout="this.style.background=\'' + bg + '\'">' +
          '<td style="padding:16px 22px;color:#e4c472;font-family:\'Inter\',sans-serif;font-size:13px;font-weight:700;letter-spacing:0.03em;">' + entry.num + '</td>' +
          '<td style="padding:16px 22px;color:#ccc;font-family:\'Inter\',sans-serif;font-size:14px;">' + _escHtmlInsc(r.date) + '</td>' +
          '<td style="padding:16px 22px;color:#ccc;font-family:\'Inter\',sans-serif;font-size:14px;">' + _escHtmlInsc(r.heure) + '</td>' +
          '<td style="padding:16px 22px;color:#fff;font-family:\'Inter\',sans-serif;font-size:14px;font-weight:600;">' + _escHtmlInsc(r.nom) + '</td>' +
          '<td style="padding:16px 22px;color:#d4af37;font-family:\'Inter\',sans-serif;font-size:14px;font-weight:600;">' + _escHtmlInsc(r.tel) + '</td>' +
          '<td style="padding:16px 22px;text-align:center;">' +
            '<button onclick="validerInscriptionRow(this)" style="cursor:pointer;font:inherit;background:linear-gradient(135deg,#2fae57 0%,#3fc96b 100%);color:#0e0e0e;border:none;border-radius:8px;padding:8px 16px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;box-shadow:0 3px 10px rgba(63,201,107,0.3);">&#10003; Valider</button>' +
          '</td>' +
        '</tr>';
      }).join('');
    })
    .catch(function() {
      if (countEl) countEl.textContent = '0';
      tbody.innerHTML = '<tr><td colspan="6" style="padding:48px;text-align:center;color:#f0786f;font-size:14px;">Erreur de chargement. V&eacute;rifie que le script Google est bien red&eacute;ploy&eacute; (acc&egrave;s "Tout le monde").</td></tr>';
    });
}

// ── Valider toutes les inscriptions visibles d'un coup ──────────────
// Envoie chaque ligne actuellement affichée dans "Membre à l'appel"
// et la marque comme validée, comme le fait "Valider" ligne par ligne.
function validerToutesInscriptions() {
  var tbody = document.getElementById('inscriptions-tbody');
  if (!tbody) return;
  var rows = Array.prototype.slice.call(tbody.querySelectorAll('tr[data-num]'));
  if (!rows.length) {
    alert('Aucune inscription à valider.');
    return;
  }
  if (!confirm('Valider les ' + rows.length + ' inscriptions affichées ? Elles seront envoyées dans "Membre à l\'appel".')) return;

  var validated = STORE.validatedInscriptions();
  var validatedSet = {};
  validated.forEach(function(num) { validatedSet[num] = true; });

  var appels = STORE.appels();

  rows.forEach(function(tr) {
    var num   = tr.getAttribute('data-num');
    var date  = tr.getAttribute('data-date');
    var heure = tr.getAttribute('data-heure');
    var nom   = tr.getAttribute('data-nom');
    var tel   = tr.getAttribute('data-tel');

    if (validatedSet[num]) return;
    validatedSet[num] = true;
    validated.push(num);

    appels.push({
      id: _appUid(),
      nom: nom,
      tel: tel,
      motif: 'Inscription validée (' + num + ')',
      date: date,
      dateInscription: date,
      heureInscription: heure || '',
      statut: 'À appeler',
      sourceNum: num,
      createdAt: new Date().toISOString()
    });
  });

  STORE.saveValidatedInscriptions(validated);
  STORE.saveAppels(appels);

  loadInscriptions();
  loadDashboardInscriptionsCount();
  renderAppels();
  alert('Toutes les inscriptions ont été validées.');
}

// ── Valider une inscription : l'enregistre dans "Membre à l'appel" et la retire de la liste ──
function validerInscriptionRow(btn) {
  var tr = btn.closest('tr');
  if (!tr) return;
  var num   = tr.getAttribute('data-num');
  var date  = tr.getAttribute('data-date');
  var heure = tr.getAttribute('data-heure');
  var nom   = tr.getAttribute('data-nom');
  var tel   = tr.getAttribute('data-tel');

  var validated = STORE.validatedInscriptions();
  if (validated.indexOf(num) === -1) {
    validated.push(num);
    STORE.saveValidatedInscriptions(validated);
  }

  var appels = STORE.appels();
  appels.push({
    id: _appUid(),
    nom: nom,
    tel: tel,
    motif: 'Inscription validée (' + num + ')',
    date: date,
    dateInscription: date,
    heureInscription: heure || '',
    statut: 'À appeler',
    sourceNum: num,
    createdAt: new Date().toISOString()
  });
  STORE.saveAppels(appels);

  loadInscriptions();
  renderAppels();
}

// ── Affiche la liste "Membre à l'appel" ───────────────────────────────
function renderAppels() {
  var tbody = document.getElementById('appel-tbody');
  var countEl = document.getElementById('appel-count');
  if (!tbody) return;
  var appels = STORE.appels().slice().sort(function(a, b) {
    var na = a.sourceNum || '';
    var nb = b.sourceNum || '';
    if (na && nb) return na.localeCompare(nb, undefined, { numeric: true });
    if (na && !nb) return -1;
    if (!na && nb) return 1;
    return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
  });
  if (countEl) countEl.textContent = String(appels.length);
  if (!appels.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="padding:32px;text-align:center;color:#666;font-size:13px;">&#128222; Aucun appel pour le moment.</td></tr>';
    return;
  }
  var STATUT_DISPLAY = {
    'À appeler':             { bg: 'linear-gradient(135deg,#c9a84c 0%,#e4c472 100%)', color: '#0e0e0e', border: 'none', label: 'À appeler' },
    'Numéro injoignable':    { bg: '#241313', color: '#ff8c82', border: '1px solid rgba(192,57,43,0.4)', label: '📞⚠ Numéro injoignable' },
    'Numéro faux':           { bg: '#241313', color: '#ff8c82', border: '1px solid rgba(192,57,43,0.4)', label: '❌ Numéro faux' },
    'Candidat sérieux':      { bg: '#132418', color: '#7be698', border: '1px solid rgba(63,201,107,0.4)', label: '✅ Candidat sérieux' },
    'Candidat fantaisiste':  { bg: '#241f0f', color: '#e4c472', border: '1px solid rgba(201,168,76,0.4)', label: '🤔 Candidat fantaisiste' }
  };
  tbody.innerHTML = appels.map(function(a) {
    var statut = a.statut || 'À appeler';
    var style = STATUT_DISPLAY[statut] || STATUT_DISPLAY['À appeler'];
    return '<tr style="border-bottom:1px solid #1a1a1a;">' +
      '<td style="padding:12px 16px;color:#fff;font-size:13px;font-weight:600;">' + _escHtmlInsc(a.nom) + (a.prenom ? ' ' + _escHtmlInsc(a.prenom) : '') + '</td>' +
      '<td style="padding:12px 16px;color:#d4af37;font-size:13px;font-weight:600;">' + _escHtmlInsc(a.tel) + '</td>' +
      '<td style="padding:12px 16px;color:#ccc;font-size:13px;">' + _escHtmlInsc(a.motif) + '</td>' +
      '<td style="padding:12px 16px;color:#ccc;font-size:13px;">' + _escHtmlInsc(a.date) + '</td>' +
      '<td style="padding:12px 16px;font-size:13px;">' +
        '<button onclick="openAppelFicheModal(\'' + a.id + '\')" style="cursor:pointer;font:inherit;background:' + style.bg + ';color:' + style.color + ';border:' + style.border + ';border-radius:8px;padding:6px 12px;font-size:11px;font-weight:700;text-transform:uppercase;white-space:nowrap;">' + style.label + '</button>' +
      '</td>' +
    '</tr>';
  }).join('');
}

// ── Remise à zéro des 3 listes (Paramètres) ──────────────────────────
// - Liste d'inscription : marque toutes les lignes actuelles du Google Sheet
//   comme "validées" pour qu'elles disparaissent de l'app (les données restent
//   dans le Sheet, elles ne sont plus affichées ici).
// - Membre à l'appel + Liste conforme : vidées définitivement (Liste conforme
//   étant dérivée de "Membre à l'appel", la vider suffit aux deux).
function reinitialiserListes() {
  if (!confirm('Réinitialiser "Liste d\'inscription", "Membre à l\'appel" et "Liste conforme" ?\n\nLa liste d\'inscription s\'affichera à zéro (les données restent dans le Google Sheet). "Membre à l\'appel" et "Liste conforme" seront effacées définitivement.\n\nCette action est irréversible. Continuer ?')) return;

  fetch(INSCRIPTIONS_SCRIPT_URL + '?_=' + Date.now())
    .then(function(r) { return r.json(); })
    .then(function(json) {
      var rows = (json && json.rows) || [];
      var validated = STORE.validatedInscriptions();
      var validatedSet = {};
      validated.forEach(function(num) { validatedSet[num] = true; });
      rows.forEach(function(r, i) {
        var num = _uclNum(i);
        if (!validatedSet[num]) { validated.push(num); validatedSet[num] = true; }
      });
      STORE.saveValidatedInscriptions(validated);
    })
    .catch(function() {
      // Si le Sheet est injoignable, on continue quand même la remise à zéro locale.
    })
    .then(function() {
      STORE.saveAppels([]);
      loadInscriptions();
      loadDashboardInscriptionsCount();
      renderAppels();
      renderListeConforme();
      alert('Les 3 listes ont été réinitialisées.');
    });
}

// ── Réafficher toutes les inscriptions du Sheet (annule la remise à zéro) ──
// Retire le filtre "validées" afin que toutes les lignes du Google Sheet
// redeviennent visibles dans "Liste d'inscription".
function reafficherInscriptions() {
  if (!confirm('Réafficher toutes les inscriptions du Google Sheet dans "Liste d\'inscription" ?')) return;
  STORE.saveValidatedInscriptions([]);
  loadInscriptions();
  loadDashboardInscriptionsCount();
  alert('Toutes les inscriptions du Sheet sont de nouveau affichées.');
}

// ── Liste conforme — auto : Candidats sérieux issus de "Membre à l'appel" ──
function renderListeConforme() {
  var tbody = document.getElementById('conformite-tbody');
  var countEl = document.getElementById('conformite-count');
  if (!tbody) return;
  var conformes = STORE.appels().filter(function(a) {
    return a.statut === 'Candidat sérieux';
  }).sort(function(a, b) {
    return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
  });
  if (countEl) countEl.textContent = String(conformes.length);
  if (!conformes.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="padding:32px;text-align:center;color:#666;font-size:13px;">&#9989; Aucun candidat s&eacute;rieux pour le moment.</td></tr>';
    return;
  }
  tbody.innerHTML = conformes.map(function(a) {
    return '<tr style="border-bottom:1px solid #1a1a1a;">' +
      '<td style="padding:12px 16px;color:#fff;font-size:13px;font-weight:600;">' + _escHtmlInsc(a.nom) + (a.prenom ? ' ' + _escHtmlInsc(a.prenom) : '') + '</td>' +
      '<td style="padding:12px 16px;color:#d4af37;font-size:13px;font-weight:600;">' + _escHtmlInsc(a.tel) + '</td>' +
      '<td style="padding:12px 16px;color:#ccc;font-size:13px;">' + _escHtmlInsc(a.ville) + '</td>' +
      '<td style="padding:12px 16px;color:#ccc;font-size:13px;">' + _escHtmlInsc(a.niveau) + '</td>' +
      '<td style="padding:12px 16px;color:#ccc;font-size:13px;">' + _escHtmlInsc(a.domaine) + '</td>' +
      '<td style="padding:12px 16px;font-size:13px;">' +
        '<span style="background:#132418;color:#7be698;border:1px solid rgba(63,201,107,0.4);border-radius:8px;padding:6px 12px;font-size:11px;font-weight:700;text-transform:uppercase;white-space:nowrap;">&#9989; Candidat s&eacute;rieux</span>' +
      '</td>' +
    '</tr>';
  }).join('');
}

// ── Fiche d'appel (modal) ─────────────────────────────────────────────
// ── Script d'appel — éditable depuis Paramètres ───────────────────────
var _defaultCallScript =
  '« Bonjour, je vous appelle de la part du club Uthina Chess suite à votre inscription sur notre site. Avez-vous quelques minutes à m\'accorder ? »\n\n' +
  '« J\'aimerais vérifier quelques informations avec vous : votre ville de résidence, votre âge, votre niveau aux échecs (débutant, intermédiaire, avancé, classement Elo si vous en avez), ainsi que votre domaine d\'activité ou d\'études. »\n\n' +
  '« Souhaitez-vous également des informations sur nos prochains tournois et cours au club ? »\n\n' +
  '« Merci pour votre temps, à très bientôt au club ! »';

function getCallScript() {
  return _storeGet('mp_call_script', JSON.stringify(_defaultCallScript));
}
function saveCallScript(text) {
  _storeSave('mp_call_script', text);
}
function loadSettingsCallScript() {
  var el = document.getElementById('settings-call-script');
  if (el) el.value = getCallScript();
}
function saveCallScriptFromSettings() {
  var el = document.getElementById('settings-call-script');
  if (!el) return;
  saveCallScript(el.value);
  if (typeof _tchToast === 'function') _tchToast('Script enregistré ✓', 'success');
  else alert('Script enregistré.');
}
function resetCallScriptToDefault() {
  if (!confirm('Réinitialiser le script par défaut ?')) return;
  saveCallScript(_defaultCallScript);
  loadSettingsCallScript();
  if (typeof _tchToast === 'function') _tchToast('Script réinitialisé', 'info');
}

// ── Synchronisation Google Sheet — Liste conforme ─────────────────────
function getSheetWebhookUrl() {
  return _storeGet('mp_sheet_webhook_url', JSON.stringify(''));
}
function saveSheetWebhookUrl(url) {
  _storeSave('mp_sheet_webhook_url', url);
}
function loadSettingsSheetUrl() {
  var el = document.getElementById('settings-sheet-url');
  if (el) el.value = getSheetWebhookUrl();
}
function saveSheetUrlFromSettings() {
  var el = document.getElementById('settings-sheet-url');
  if (!el) return;
  saveSheetWebhookUrl(el.value.trim());
  if (typeof _tchToast === 'function') _tchToast('URL Google Sheet enregistrée ✓', 'success');
  else alert('URL enregistrée.');
}
function testSheetWebhookFromSettings() {
  var url = getSheetWebhookUrl();
  if (!url) { alert('Colle d\'abord ton URL Google Apps Script, puis Enregistrer.'); return; }
  pushToGoogleSheet({
    id: 'test-' + Date.now(),
    nom: 'Test', prenom: 'Connexion', tel: '00000000', ville: 'Test',
    age: '', niveau: '', domaine: '', note: 'Ceci est un test depuis Paramètres.',
    dateInscription: new Date().toLocaleDateString('fr-FR'),
    heureInscription: new Date().toLocaleTimeString('fr-FR'),
    dateAppel: new Date().toLocaleDateString('fr-FR'),
    heureAppel: new Date().toLocaleTimeString('fr-FR'),
    statut: 'Candidat sérieux'
  });
  alert('Requête de test envoyée. Vérifie ta Google Sheet (une ligne "Test Connexion" doit apparaître).');
}
// Envoie une fiche (Candidat sérieux) vers la Google Sheet configurée.
// mode:'no-cors' car Apps Script ne renvoie pas d'en-têtes CORS lisibles
// depuis un autre domaine — la requête part bien malgré l'absence de réponse lisible.
function pushToGoogleSheet(a) {
  var url = getSheetWebhookUrl();
  if (!url) return;
  try {
    fetch(url, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(a)
    }).catch(function() { /* silencieux : pas de réseau ou URL invalide */ });
  } catch (e) { /* ignore */ }
}

var MOIS_NOMS = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];

function _populateNaissanceSelects() {
  var jourSel = document.getElementById('appel-fiche-f-jour');
  var moisSel = document.getElementById('appel-fiche-f-mois');
  var anneeSel = document.getElementById('appel-fiche-f-annee');
  if (!jourSel || !moisSel || !anneeSel) return;
  if (jourSel.options.length > 1) return; // déjà rempli

  for (var j = 1; j <= 31; j++) {
    var optJ = document.createElement('option');
    optJ.value = String(j);
    optJ.textContent = String(j);
    jourSel.appendChild(optJ);
  }

  MOIS_NOMS.forEach(function(m) {
    var optM = document.createElement('option');
    optM.value = m;
    optM.textContent = m;
    moisSel.appendChild(optM);
  });

  var currentYear = new Date().getFullYear();
  for (var y = currentYear; y >= 1940; y--) {
    var optY = document.createElement('option');
    optY.value = String(y);
    optY.textContent = String(y);
    anneeSel.appendChild(optY);
  }
}

function openAppelFicheModal(id) {
  var appels = STORE.appels();
  var a = appels.find(function(x) { return x.id === id; });
  if (!a) return;
  var scriptEl = document.getElementById('appel-fiche-script');
  if (scriptEl) scriptEl.textContent = getCallScript();
  _populateNaissanceSelects();
  document.getElementById('appel-fiche-id').value = id;
  document.getElementById('appel-fiche-nom').textContent = (a.nom || '') + (a.prenom ? ' ' + a.prenom : '');
  document.getElementById('appel-fiche-f-nom').value = a.nom || '';
  document.getElementById('appel-fiche-f-prenom').value = a.prenom || '';
  document.getElementById('appel-fiche-f-ville').value = a.ville || '';
  document.getElementById('appel-fiche-f-jour').value = a.njour || '';
  document.getElementById('appel-fiche-f-mois').value = a.nmois || '';
  document.getElementById('appel-fiche-f-annee').value = a.nannee || '';
  document.getElementById('appel-fiche-f-niveau').value = a.niveau || '';
  document.getElementById('appel-fiche-f-domaine').value = a.domaine || '';
  document.getElementById('appel-fiche-f-note').value = a.note || '';
  document.getElementById('appel-fiche-result').value = (a.statut && a.statut !== 'À appeler') ? a.statut : '';

  document.querySelectorAll('.appel-result-btn').forEach(function(btn) {
    var active = btn.getAttribute('data-result') === document.getElementById('appel-fiche-result').value;
    btn.style.outline = active ? '2px solid #fff' : 'none';
    btn.style.opacity = (!document.getElementById('appel-fiche-result').value || active) ? '1' : '0.55';
  });

  document.getElementById('appel-fiche-modal').style.display = 'flex';
}

function closeAppelFicheModal() {
  document.getElementById('appel-fiche-modal').style.display = 'none';
}

function setAppelResult(btn) {
  var val = btn.getAttribute('data-result');
  var current = document.getElementById('appel-fiche-result').value;
  var next = (current === val) ? '' : val; // re-clique pour désélectionner
  document.getElementById('appel-fiche-result').value = next;
  document.querySelectorAll('.appel-result-btn').forEach(function(b) {
    var active = b.getAttribute('data-result') === next;
    b.style.outline = active ? '2px solid #fff' : 'none';
    b.style.opacity = (!next || active) ? '1' : '0.55';
  });
}

function saveAppelFiche() {
  var id = document.getElementById('appel-fiche-id').value;
  var appels = STORE.appels();
  var a = appels.find(function(x) { return x.id === id; });
  if (!a) return;

  a.nom     = document.getElementById('appel-fiche-f-nom').value.trim();
  a.prenom  = document.getElementById('appel-fiche-f-prenom').value.trim();
  a.ville   = document.getElementById('appel-fiche-f-ville').value.trim();
  a.njour   = document.getElementById('appel-fiche-f-jour').value;
  a.nmois   = document.getElementById('appel-fiche-f-mois').value;
  a.nannee  = document.getElementById('appel-fiche-f-annee').value;
  if (a.njour && a.nmois && a.nannee) {
    a.dateNaissance = a.njour + ' ' + a.nmois + ' ' + a.nannee;
    var moisIdx = MOIS_NOMS.indexOf(a.nmois);
    var bDate = new Date(parseInt(a.nannee, 10), moisIdx, parseInt(a.njour, 10));
    var today = new Date();
    var ageCalc = today.getFullYear() - bDate.getFullYear();
    var mDiff = today.getMonth() - bDate.getMonth();
    if (mDiff < 0 || (mDiff === 0 && today.getDate() < bDate.getDate())) ageCalc--;
    a.age = String(ageCalc);
  } else {
    a.dateNaissance = '';
    a.age = '';
  }
  a.niveau  = document.getElementById('appel-fiche-f-niveau').value.trim();
  a.domaine = document.getElementById('appel-fiche-f-domaine').value.trim();
  a.note    = document.getElementById('appel-fiche-f-note').value.trim();

  var result = document.getElementById('appel-fiche-result').value;
  a.statut = result || 'À appeler';

  if (result && !a.dateAppel) {
    var now = new Date();
    a.dateAppel  = now.toLocaleDateString('fr-FR');
    a.heureAppel = now.toLocaleTimeString('fr-FR');
  }

  STORE.saveAppels(appels);
  closeAppelFicheModal();
  renderAppels();
  renderListeConforme();

  if (a.statut === 'Candidat sérieux') pushToGoogleSheet(a);
}
