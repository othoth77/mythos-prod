// Mission Orders shared module (Stage 4L).
// Globals remain available for existing inline handlers and callers.


// ── Sociétés (utilisées pour les Ordres de Mission multi-société) ──
const SOCIETES = {
  mythos: {
    id: 'mythos',
    nom: 'Mythos Production',
    logo: MYTHOS_PRINT_LOGO_SRC,
    footer: '<strong>Mythos Production</strong><br>04 Rue Habib Thamer, Khelidia 2054, Tunisie | Tel: 98.999.660 / 21.821.921 | Email: ste.mythosprod@gmail.com<br>RC Tunis B01185972014 | Matricule fiscal: 1367868NAM000'
  },
  sdt: {
    id: 'sdt',
    nom: 'Société de distribution tunisienne',
    logo: SDT_PRINT_LOGO_SRC,
    footer: '<strong>Société de distribution tunisienne</strong><br>Montplaisir Bab Bhar Espace Tunis étage 4 appartement 3 | Tel: 98.999.660 / 21.821.921 | Email: ste.distributiontunisienne@gmail.com<br>RC Tunis B01185972014 | Matricule fiscal: 1371317PAM000'
  }
};



const OM_MISSION_TEXTS = {
  aller_retour: 'Assurer le transport aller-retour du groupe, apr\u00e8s leur visite professionnelle, avec bagages et d\u00e9cors.',
  aller_simple: 'Assurer le transport du groupe jusqu\u2019\u00e0 leur lieu de visite professionnelle, avec bagages et d\u00e9cors.'
};

var stableOmPersonCount = 0;


function renderOMList() {
  const el = document.getElementById('om-list');
  if (!el) return;
  const oms = STORE.oms().slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  if (!oms.length) {
    el.innerHTML = '<div class="empty-state">Aucun ordre de mission.</div>';
    return;
  }
  el.innerHTML = oms.map(om => {
    const count = Array.isArray(om.persons) ? om.persons.length : 0;
    return `<div class="invoice-card om-card" onclick="editOM('${om.id}')">
      <div><div class="inv-num">${esc(cleanPrintText(om.depart || 'Tunis'))} &raquo; ${esc(cleanPrintText(om.arrivee || 'Tunis'))}</div><div class="om-date-time">${esc(om.date || '')} ${esc(om.heure || '')}</div></div>
      <div><div class="om-persons-count">Nombre de personnes : ${count}</div></div>
      <div class="inv-actions om-actions" onclick="event.stopPropagation()">
        <button class="btn btn-gold btn-sm" onclick="previewOM('${om.id}')" title="Imprimer" style="padding:6px 10px; font-size:16px;">🖨️</button>
        <button class="btn btn-danger btn-sm" onclick="deleteOM('${om.id}')" title="Supprimer">✕</button>
      </div>
    </div>`;
  }).join('');
}

// ── VÉHICULES (Ordres de Mission) ──
function ensureDefaultVehicules() {
  let vehicules = STORE.vehicules();
  if (vehicules.length === 0) {
    vehicules = [
      { id: 'veh_1', plaque: '230-8646', chauffeur: 'Othman Haddad', cin: '07119027', permis: '23/109141', societe: 'mythos' },
      { id: 'veh_2', plaque: '456-1234', chauffeur: 'Ahmed Ben Ali', cin: '08556789', permis: '', societe: 'mythos' }
    ];
    STORE.saveVehicules(vehicules);
  }
  // Ajoute le véhicule de la SDT s'il n'existe pas encore
  if (!vehicules.find(v => v.plaque === '175-5401')) {
    vehicules.push({ id: 'veh_' + Date.now(), plaque: '175-5401', chauffeur: '', cin: '', permis: '', societe: 'sdt' });
    STORE.saveVehicules(vehicules);
  }
  // Rétrocompatibilité : véhicules existants sans société -> Mythos
  let changed = false;
  vehicules.forEach(v => { if (!v.societe) { v.societe = 'mythos'; changed = true; } });
  if (changed) STORE.saveVehicules(vehicules);
  return vehicules;
}

function renderOmVehiculeOptions(selectedPlaque) {
  const sel = document.getElementById('om-plaque');
  if (!sel) return;
  const vehicules = ensureDefaultVehicules();
  // Garde l'ancien véhicule courant même s'il n'est pas (encore) dans la liste
  let options = vehicules.slice();
  if (selectedPlaque && !options.find(v => v.plaque === selectedPlaque)) {
    options = options.concat([{ id: 'tmp', plaque: selectedPlaque, chauffeur: '', cin: '', permis: '' }]);
  }
  sel.innerHTML = options.map(v => {
    const soc = SOCIETES[v.societe] || SOCIETES.mythos;
    return `<option value="${esc(v.plaque)}" ${v.plaque === selectedPlaque ? 'selected' : ''}>${esc(v.plaque)}${v.chauffeur ? ' — ' + esc(v.chauffeur) : ''} (${esc(soc.nom)})</option>`;
  }).join('');
  if (!selectedPlaque && options.length) sel.value = options[0].plaque;
  updateOmLogoPreview();
}

function updateOmLogoPreview() {
  const sel = document.getElementById('om-plaque');
  const img = document.getElementById('om-logo-preview');
  const label = document.getElementById('om-societe-preview');
  if (!sel || !img) return;
  const plaque = sel.value;
  const v = ensureDefaultVehicules().find(item => item.plaque === plaque);
  const soc = SOCIETES[v?.societe] || SOCIETES.mythos;
  img.src = soc.logo;
  if (label) label.textContent = soc.nom;
}

function onOmVehiculeChange() {
  const plaque = document.getElementById('om-plaque').value;
  const v = ensureDefaultVehicules().find(item => item.plaque === plaque);
  updateOmLogoPreview();
  if (!v) return;
  if (v.chauffeur) document.getElementById('om-chauffeur').value = v.chauffeur;
  if (v.cin) document.getElementById('om-cin').value = v.cin;
  if (v.permis) document.getElementById('om-permis').value = v.permis;
}

function addOmVehicule() {
  const plaque = prompt('Numéro d\'immatriculation du nouveau véhicule :');
  if (!plaque || !plaque.trim()) return;
  const chauffeur = prompt('Nom du chauffeur (optionnel) :') || '';
  const societeInput = (prompt('Société : tapez "1" pour Mythos Production ou "2" pour Société de distribution tunisienne', '1') || '1').trim();
  const societe = societeInput === '2' ? 'sdt' : 'mythos';
  const vehicules = ensureDefaultVehicules();
  if (vehicules.find(v => v.plaque === plaque.trim())) {
    alert('Ce véhicule existe déjà.');
    renderOmVehiculeOptions(plaque.trim());
    return;
  }
  vehicules.push({ id: 'veh_' + Date.now(), plaque: plaque.trim(), chauffeur: chauffeur.trim(), cin: '', permis: '', societe });
  STORE.saveVehicules(vehicules);
  renderOmVehiculeOptions(plaque.trim());
  onOmVehiculeChange();
}

function initOMForm() {
  document.getElementById('om-edit-id').value = '';
  document.getElementById('om-form-title').innerHTML = 'Nouvel <span>Ordre de Mission</span>';
  renderOmVehiculeOptions('230-8646');
  document.getElementById('om-chauffeur').value = 'Othman Haddad';
  document.getElementById('om-cin').value = '07119027';
  document.getElementById('om-permis').value = '23/109141';
  document.getElementById('om-date').value = todayStr();
  document.getElementById('om-heure').value = '13:30';
  document.getElementById('om-depart').value = 'Tunis';
  document.getElementById('om-arrivee').value = 'Tunis';
  document.getElementById('om-mission-type').value = 'aller_retour';
  document.getElementById('om-addStamp').checked = true;
  applyOmMissionType();
  document.getElementById('om-persons-body').innerHTML = '';
  stableOmPersonCount = 0;
  for (let i = 0; i < 11; i += 1) addOmPerson('');
}

function setOmDateQuick(offset) {
  document.getElementById('om-date').value = dateInputValue(offset);
}

function setOmTimeQuick(value) {
  if (value === 'now') {
    const d = new Date();
    value = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  document.getElementById('om-heure').value = value;
}

function applyOmMissionType() {
  const type = document.getElementById('om-mission-type')?.value || 'aller_retour';
  document.getElementById('om-mission').value = OM_MISSION_TEXTS[type];
}

function addOmPerson(name = '') {
  stableOmPersonCount += 1;
  const tr = document.createElement('tr');
  tr.id = 'omp-' + stableOmPersonCount;
  tr.innerHTML = `<td style="text-align:center;">${stableOmPersonCount}</td><td><input type="text" value="${esc(name)}" placeholder="Nom et prenom"></td><td style="text-align:center;"><div style="border-bottom:1px solid #888;height:28px;"></div></td><td><button class="btn-remove" onclick="document.getElementById('${tr.id}').remove()">x</button></td>`;
  document.getElementById('om-persons-body').appendChild(tr);
}

function getOMPersons() {
  return Array.from(document.querySelectorAll('#om-persons-body tr')).map(tr => ({ nom: tr.querySelector('input')?.value || '' }));
}

function saveOM() {
  const editId = document.getElementById('om-edit-id').value;
  const chauffeur = document.getElementById('om-chauffeur').value.trim();
  const om = {
    id: editId || 'om_' + Date.now(),
    plaque: document.getElementById('om-plaque').value.trim(),
    chauffeur,
    cin: document.getElementById('om-cin').value,
    permis: document.getElementById('om-permis').value,
    date: document.getElementById('om-date').value,
    heure: document.getElementById('om-heure').value,
    dateArrivee: document.getElementById('om-date-arrivee').value,
    heureArrivee: document.getElementById('om-heure-arrivee').value,
    depart: document.getElementById('om-depart').value,
    arrivee: document.getElementById('om-arrivee').value,
    missionType: document.getElementById('om-mission-type').value,
    mission: document.getElementById('om-mission').value,
    addStamp: document.getElementById('om-addStamp')?.checked || false,
    persons: getOMPersons()
  };
  if (!om.plaque || !om.chauffeur) { alert('Vehicule et chauffeur obligatoires'); return; }
  let oms = STORE.oms();
  oms = editId ? oms.map(item => item.id === editId ? om : item) : oms.concat(om);
  STORE.saveOms(oms);

  // ✅ Auto-add collaborator if not already in list
  let collabs = STORE.collabs();
  const existingCollab = collabs.find(c => c.nom === chauffeur);
  if (!existingCollab) {
    const newCollab = {
      id: 'collab_' + Date.now(),
      nom: chauffeur,
      role: 'Chauffeur',
      contact: '',
      notes: ''
    };
    collabs.push(newCollab);
    STORE.saveCollabs(collabs);
  }

  // ✅ Auto-add véhicule si pas déjà dans la liste (garde aussi les anciens)
  let vehicules = ensureDefaultVehicules();
  const existingVeh = vehicules.find(v => v.plaque === om.plaque);
  if (!existingVeh) {
    vehicules.push({ id: 'veh_' + Date.now(), plaque: om.plaque, chauffeur: om.chauffeur, cin: om.cin, permis: om.permis });
    STORE.saveVehicules(vehicules);
  } else if (om.chauffeur && existingVeh.chauffeur !== om.chauffeur) {
    existingVeh.chauffeur = om.chauffeur;
    existingVeh.cin = om.cin;
    existingVeh.permis = om.permis;
    STORE.saveVehicules(vehicules);
  }

  showView('om-list');
}

function editOM(id) {
  const om = STORE.oms().find(item => item.id === id);
  if (!om) return;
  showView('om-new');
  document.getElementById('om-edit-id').value = om.id;
  document.getElementById('om-form-title').innerHTML = 'Modifier <span>Ordre de Mission</span>';
  renderOmVehiculeOptions(om.plaque || '');
  document.getElementById('om-chauffeur').value = om.chauffeur || '';
  document.getElementById('om-cin').value = om.cin || '';
  document.getElementById('om-permis').value = om.permis || '';
  document.getElementById('om-date').value = om.date || '';
  document.getElementById('om-heure').value = om.heure || '';
  document.getElementById('om-date-arrivee').value = om.dateArrivee || '';
  document.getElementById('om-heure-arrivee').value = om.heureArrivee || '';
  document.getElementById('om-depart').value = om.depart || '';
  document.getElementById('om-arrivee').value = om.arrivee || '';
  document.getElementById('om-mission-type').value = om.missionType || (String(om.mission || '').includes('aller-retour') ? 'aller_retour' : 'aller_simple');
  document.getElementById('om-mission').value = om.mission || OM_MISSION_TEXTS.aller_retour;
  document.getElementById('om-addStamp').checked = om.addStamp !== false;
  document.getElementById('om-persons-body').innerHTML = '';
  stableOmPersonCount = 0;
  const persons = Array.isArray(om.persons) && om.persons.length ? om.persons : Array(11).fill({ nom: '' });
  persons.forEach(p => addOmPerson(p.nom || ''));
}

function deleteOM(id) {
  if (!confirm('Supprimer cet ordre de mission ?')) return;
  STORE.saveOms(STORE.oms().filter(om => om.id !== id));
  renderOMList();
  updateSidebarStats();
}

function cancelOM() {
  showView('om-list');
}

function previewOM(id) {
  const om = STORE.oms().find(item => item.id === id);
  if (!om) return;
  // Use current checkbox values from form, not saved values
  om.addStamp = document.getElementById('om-addStamp')?.checked || false;
  document.getElementById('om-preview').innerHTML = buildOMHTML(om);
  document.getElementById('om-preview-modal').style.display = 'flex';
}

function closeOMPreview() {
  document.getElementById('om-preview-modal').style.display = 'none';
}

// [utils.js] cleanPrintText

function buildOMHTML(om) {
  const persons = Array.isArray(om.persons) && om.persons.length ? om.persons : Array(11).fill({ nom: '' });
  const rows = persons.map((p, i) => `<tr><td class="num-cell">${i + 1}</td><td>${esc(cleanPrintText(p.nom || ''))}</td><td></td></tr>`).join('');
  const vehicule = ensureDefaultVehicules().find(v => v.plaque === om.plaque);
  const societe = SOCIETES[vehicule?.societe] || SOCIETES.mythos;
  return `<div style="background:#fff;color:#000;width:794px;min-height:1123px;padding:7mm 6mm;box-sizing:border-box;font-family:Arial,sans-serif;font-size:14px;display:flex;flex-direction:column;">
    <div style="display:flex;justify-content:flex-start;align-items:flex-end;border-bottom:2px solid #000;padding-bottom:10px;margin-bottom:10px;">
      <img alt="Logo de la société" src="${societe.logo}" style="width:140px;max-height:80px;object-fit:contain;">
    </div>
    <h1 style="margin:0 0 20px;text-align:center;color:#000;font-size:34px;font-weight:900;letter-spacing:1px;">ORDRE DE MISSION</h1>
    <div class="om-info">
      <div><span>N immatriculation vehicule</span><b>:</b><strong>${esc(cleanPrintText(om.plaque))}</strong></div>
      <div><span>Chauffeur</span><b>:</b><strong>${esc(cleanPrintText(om.chauffeur))}</strong></div>
      <div><span>Numero de carte identite</span><b>:</b><strong>${esc(cleanPrintText(om.cin))}</strong></div>
      <div><span>Numero de permis de conduire</span><b>:</b><strong>${esc(cleanPrintText(om.permis))}</strong></div>
      <div><span>Date de commencement de la mission</span><b>:</b><strong>${formatDateLong(om.date)}${om.heure ? ' à ' + om.heure : ''}</strong></div>
      ${om.dateArrivee ? `<div><span>Date de fin de mission</span><b>:</b><strong>${formatDateLong(om.dateArrivee)}${om.heureArrivee ? ' à ' + om.heureArrivee : ''}</strong></div>` : ''}
      <div><span>Lieu de depart</span><b>:</b><strong>${esc(cleanPrintText(om.depart))}</strong></div>
      <div><span>Lieu d'arrivee</span><b>:</b><strong>${esc(cleanPrintText(om.arrivee))}</strong></div>
    </div>
    <div class="om-mission"><b>Mission :</b> ${esc(cleanPrintText(om.mission))}</div>
    <table class="om-persons"><thead><tr><th></th><th>Nom et prenom</th><th>Signature</th></tr></thead><tbody>${rows}</tbody></table>
    <style>
      .om-info{width:95%;margin:0 auto 5px;font-size:14px;font-weight:700}
      .om-info div{display:grid;grid-template-columns:320px 18px 1fr;padding:3px 0}
      .om-info span{font-weight:700}
      .om-info strong{font-weight:800}
      .om-mission{width:95%;margin:5px auto 10px;font-size:13px;font-weight:700;line-height:1.55}
      .om-persons{width:88%;border-collapse:collapse;margin:0 auto}
      .om-persons th,.om-persons td{border:1px solid #000;padding:7px 8px;height:22px}
      .om-persons th{text-align:center;font-weight:800}
      .om-persons .num-cell{width:44px;text-align:center;font-weight:700}
    </style>
    <div style="margin-bottom:10px;margin-top:15px;display:grid;grid-template-columns:1fr;gap:16px;font-size:11px;">
      <div style="text-align:right;display:flex;flex-direction:column;align-items:flex-end;gap:10px;margin-right:80px;">
        <div style="font-weight:900;color:#000;margin-bottom:8px;">Signature et Cachet</div>
        ${om.addStamp ? `<img alt="" src="${getStampSVG()}" style="height:90px;width:auto;transform:rotate(-3deg);opacity:0.85;filter:drop-shadow(1px 1px 2px rgba(30,64,175,0.3)) blur(0.3px);">` : ''}
      </div>
    </div>
    <div style="margin-top:auto;padding-top:12px;border-top:2px solid #000;font-size:10px;line-height:1.5;text-align:center;color:#000;">
      ${societe.footer}
    </div>
  </div>`;
}
