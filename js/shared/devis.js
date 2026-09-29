// Devis CRUD, form, numbering, and preview shared module (Stage 4O).
// Globals remain available to existing inline handlers and callers.


// ── Sociétés émettrices disponibles pour les DEVIS (logo + en-tête + pied de page + cachet) ──
const KACEM_PRINT_LOGO_SRC = 'assets/logos/logo-kacem.png';
const DEVIS_SOCIETES = {
  mythos: {
    id: 'mythos',
    nom: 'Mythos Prod',
    logo: MYTHOS_PRINT_LOGO_SRC,
    addrLines: ['04 Rue Habib Thamer', 'Khelidia 2054', 'MF: 1367868NAM000'],
    footer: '<strong>Mythos Production</strong> • 04 Rue Habib Thamer, Khelidia 2054<br>Tél: 98.999.660 / 21.821.921 | Email: ste.mythosprod@gmail.com<br>RC Tunis B01185972014 | MF: 1367868NAM000 | RIB BIAT: 0800 6011 0510 0066 3124',
    stamp: {
      lines: ['Mythos Production', '04 Rue Habib Thamer, Khelidia 2054', 'MF: 1367868NAM000', 'Tel: 98.999.660 - 21.821.921', 'Email: ste.mythosprod@gmail.com'],
      color: '#1e40af'
    }
  },
  kacem: {
    id: 'kacem',
    nom: 'Kacem aluminium',
    logo: KACEM_PRINT_LOGO_SRC,
    addrLines: ['04 Km Route Matar', 'Sfax 3000', 'MF: 136787NAM000'],
    footer: '<strong>Kacem aluminium</strong> • 04 Km Route Matar Sfax 3000<br>Tél: 44.726.393 | Email: ste.Kacemaluminium@gmail.com<br>MF: 136787NAM000 | RIB BIAT: 0800 6011 0510 0068 3124',
    stamp: {
      lines: ['Kacem aluminium', '04 Km Route Matar, Sfax 3000', 'MF: 136787NAM000', 'Tel: 44.726.393', 'Email: ste.Kacemaluminium@gmail.com'],
      color: '#7a3b12'
    }
  }
};



function getStampSVGFor(societeId) {
  const soc = DEVIS_SOCIETES[societeId] || DEVIS_SOCIETES.mythos;
  const lines = soc.stamp.lines;
  const color = soc.stamp.color || '#1e40af';
  let svg = '<svg width="240" height="95" viewBox="0 0 240 95" xmlns="http://www.w3.org/2000/svg">';
  svg += `<rect x="2" y="4" width="236" height="87" fill="none" stroke="${color}" stroke-width="3"/>`;

  const fontSizes = [15, 12, 11, 11, 11];
  const yPositions = [22, 37, 50, 63, 76];
  const weights = ['bold', 'normal', 'normal', 'normal', 'normal'];

  lines.forEach((line, i) => {
    const fontWeight = weights[i] || 'normal';
    svg += `<text x="120" y="${yPositions[i]}" text-anchor="middle" font-size="${fontSizes[i]}" font-weight="${fontWeight}" fill="${color}" font-family="Arial">${line}</text>`;
  });
  svg += '</svg>';
  return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
}



function nextDevisNum(year = new Date().getFullYear()) {
  const nums = STORE.devis()
    .filter(dev => String(dev.num || '').includes('/' + year))
    .map(dev => {
      const str = String(dev.num || '');
      // Handle new format: "001/2026"
      if (/^\d+\/\d{4}$/.test(str)) {
        return parseInt(str.split('/')[0], 10);
      }
      // Handle legacy format: "DEV-2026/001"
      if (/^DEV-\d{4}\/\d+$/.test(str)) {
        return parseInt(str.split('/')[1], 10);
      }
      return NaN;
    })
    .filter(Number.isFinite);
  return String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, '0') + '/' + year;
}

function splitDevisNum(numValue) {
  const str = String(numValue || '');

  // Format 1: SEQ/YEAR (e.g., "001/2026")
  let match = str.match(/^(\d+)\/(\d{4})$/);
  if (match) return { seq: match[1], year: match[2] };

  // Format 2: DEV-YEAR/SEQ (e.g., "DEV-2026/001") - legacy format
  match = str.match(/^DEV-(\d{4})\/(\d+)$/);
  if (match) return { seq: match[2], year: match[1] };

  return { seq: '', year: String(new Date().getFullYear()) };
}


function editDevis(id) {
  const devis_list = STORE.devis();
  const dev = devis_list.find(d => d.id === id);
  if (!dev) return;

  document.getElementById('dev-edit-id').value = id;
  document.getElementById('dev-date').value = dev.date || '';
  document.getElementById('dev-client-name').value = dev.clientName || '';
  document.getElementById('dev-client-addr').value = dev.clientAddr || '';
  document.getElementById('dev-client-mf').value = dev.clientMf || '';
  document.getElementById('dev-addStamp').checked = dev.addStamp || false;
  document.getElementById('dev-tva-percent').value = dev.tvaPercent || 7;
  document.getElementById('dev-timbre-amount').value = dev.timbreAmount || 0;
  document.getElementById('dev-societe').value = dev.societeId || 'mythos';
  document.getElementById('dev-logo-override').value = dev.logoOverride || '';
  const devLogoFile = document.getElementById('dev-logo-custom');
  if (devLogoFile) devLogoFile.value = '';
  updateDevisLogoPreview();

  // Charger les lignes de prestations
  const tbody = document.getElementById('dev-lines-body');
  if (tbody && dev.lines) {
    tbody.innerHTML = '';
    devisLineCount = 0;
    dev.lines.forEach(line => {
      addDevisLine(line.desc || '', line.qty || 1, line.pu || 0, line.unit || 'Forfait');
    });
  }

  // Charger le numéro et mettre à jour l'affichage
  const numParts = splitDevisNum(dev.num);
  document.getElementById('dev-num-year').value = numParts.year;
  document.getElementById('dev-num-seq').value = numParts.seq;
  document.getElementById('dev-num').value = dev.num || '';
  syncDevisNumberPreview();

  // Recalculer les totaux après avoir chargé tous les champs
  setTimeout(() => calcDevisTotals(), 100);

  showView('devis-form');
}

function deleteDevis(id) {
  if (!confirm('Êtes-vous sûr?')) return;
  const devis_list = STORE.devis().filter(d => d.id !== id);
  STORE.saveDevis(devis_list);
  if (typeof LOGGER !== 'undefined') LOGGER.log('DELETE_DEVIS', { id });
  populateDevisList();
}

function saveDevis() {
  const id = document.getElementById('dev-edit-id').value;

  // Récupérer les lignes de prestations
  const lines = [];
  const tbody = document.getElementById('dev-lines-body');
  if (tbody) {
    tbody.querySelectorAll('tr').forEach(row => {
      const desc = row.querySelector('.dev-line-desc')?.value || '';
      const qty = parseFloat(row.querySelector('.dev-line-qty')?.value || 0);
      const unit = row.querySelector('.dev-line-unit')?.value || 'Forfait';
      const pu = parseFloat(row.querySelector('.dev-line-pu')?.value || 0);
      const total = qty * pu;

      lines.push({ desc, qty, unit, pu, total });
    });
  }

  const devisObj = {
    id: id || Date.now().toString(),
    num: document.getElementById('dev-num').value,
    date: document.getElementById('dev-date').value || todayStr(),
    clientName: document.getElementById('dev-client-name').value,
    clientAddr: document.getElementById('dev-client-addr').value,
    clientMf: document.getElementById('dev-client-mf').value,
    totalHT: parseFloat(document.getElementById('dev-total-ht').value || 0),
    totalTTC: parseFloat(document.getElementById('dev-total-ttc').value || 0),
    tva: parseFloat(document.getElementById('dev-tva').value || 0),
    tvaPercent: parseFloat(document.getElementById('dev-tva-percent')?.value || 7),
    addStamp: document.getElementById('dev-addStamp')?.checked || false,
    timbreAmount: parseFloat(document.getElementById('dev-timbre-amount')?.value || 0),
    societeId: document.getElementById('dev-societe')?.value || 'mythos',
    logoOverride: document.getElementById('dev-logo-override')?.value || '',
    lines: lines
  };

  if (!devisObj.num) {
    alert('Veuillez entrer un numéro de devis');
    return;
  }
  if (!devisObj.clientName) {
    alert('Veuillez entrer un client');
    return;
  }

  let devis_list = STORE.devis();
  if (id) {
    const idx = devis_list.findIndex(d => d.id === id);
    if (idx !== -1) devis_list[idx] = devisObj;
  } else {
    devis_list.push(devisObj);
  }

  STORE.saveDevis(devis_list);
  if (typeof LOGGER !== 'undefined') LOGGER.log('SAVE_DEVIS', { num: devisObj.num, client: devisObj.clientName, action: id ? 'edit' : 'create' });
  document.getElementById('dev-edit-id').value = '';
  populateDevisList();
  showView('devis');
}

function populateDevisList() {
  const container = document.getElementById('devis-container');
  if (!container) return;

  const devis_list = STORE.devis().slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  if (!devis_list.length) {
    container.innerHTML = '<div class="empty-state">Aucun devis.</div>';
    return;
  }

  const html = '<table class="clients-list-table" style="width:100%;"><thead><tr><th>Numéro</th><th>Client</th><th>Date</th><th>Total HT</th><th>TVA (%)</th><th>Total TTC</th><th>Actions</th></tr></thead><tbody>' +
    devis_list.map(dev => `
      <tr style="cursor:pointer;" onclick="editDevis('${dev.id}')">
        <td><strong>${escapeHtml(dev.num || '-')}</strong></td>
        <td>${escapeHtml(dev.clientName || '-')}</td>
        <td>${dev.date || '-'}</td>
        <td style="text-align:right;">${fmtMoney(dev.totalHT || 0)}</td>
        <td style="text-align:center;">${(dev.tvaPercent || 7).toFixed(1)}</td>
        <td style="text-align:right;font-weight:bold;color:#d4af37;">${fmtMoney(dev.totalTTC || 0)}</td>
        <td onclick="event.stopPropagation()">
          <button class="btn btn-outline btn-sm" onclick="printDevis('${dev.id}')" title="Imprimer / PDF">🖨️</button>
          <button class="btn btn-outline btn-sm" onclick="editDevis('${dev.id}')" title="Modifier">✏️</button>
          <button class="btn btn-danger btn-sm" onclick="deleteDevis('${dev.id}')" title="Supprimer">✕</button>
        </td>
      </tr>
    `).join('') +
    '</tbody></table>';

  container.innerHTML = html;
}

function cancelDevisForm() {
  document.getElementById('dev-edit-id').value = '';
  document.getElementById('dev-num').value = '';
  document.getElementById('dev-num-year').value = '';
  document.getElementById('dev-num-seq').value = '';
  document.getElementById('dev-date').value = todayStr();
  document.getElementById('dev-client-select').value = '';
  document.getElementById('dev-client-name').value = '';
  document.getElementById('dev-client-addr').value = '';
  document.getElementById('dev-client-mf').value = '';
  document.getElementById('dev-addStamp').checked = false;
  document.getElementById('dev-tva-percent').value = 7;
  document.getElementById('dev-timbre-amount').value = 1.000;
  document.getElementById('dev-total-ht').value = '0';
  document.getElementById('dev-total-ttc').value = '0';
  document.getElementById('dev-tva').value = '0';
  document.getElementById('dev-societe').value = 'mythos';
  document.getElementById('dev-logo-override').value = '';
  const devLogoFileCancel = document.getElementById('dev-logo-custom');
  if (devLogoFileCancel) devLogoFileCancel.value = '';
  updateDevisLogoPreview();

  const tbody = document.getElementById('dev-lines-body');
  if (tbody) tbody.innerHTML = '';

  showView('devis');
}

// ── Émetteur / logo du devis ──
function updateDevisLogoPreview() {
  const img = document.getElementById('dev-logo-preview');
  if (!img) return;
  const sel = document.getElementById('dev-societe');
  const override = document.getElementById('dev-logo-override')?.value;
  const soc = DEVIS_SOCIETES[sel?.value] || DEVIS_SOCIETES.mythos;
  img.src = override || soc.logo;
}

function onDevisSocieteChange() {
  // Changer de société réinitialise le logo personnalisé pour repartir du logo par défaut de la société
  document.getElementById('dev-logo-override').value = '';
  const fileInput = document.getElementById('dev-logo-custom');
  if (fileInput) fileInput.value = '';
  updateDevisLogoPreview();
}

function onDevisLogoFileChange(evt) {
  const file = evt?.target?.files && evt.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    document.getElementById('dev-logo-override').value = e.target.result;
    updateDevisLogoPreview();
  };
  reader.readAsDataURL(file);
}

function resetDevisLogo() {
  document.getElementById('dev-logo-override').value = '';
  const fileInput = document.getElementById('dev-logo-custom');
  if (fileInput) fileInput.value = '';
  updateDevisLogoPreview();
}

function syncDevisNumberPreview() {
  const year = document.getElementById('dev-num-year').value;
  const seq = document.getElementById('dev-num-seq').value;
  const preview = document.getElementById('dev-num-preview');

  // Display format: DEV-YEAR/SEQ (e.g., "DEV-2026/12")
  if (preview) {
    preview.textContent = year && seq ? `DEV-${year}/${seq}` : '---';
  }

  // Internal storage format: SEQ/YEAR (e.g., "012/2026") for proper parsing with splitDevisNum()
  document.getElementById('dev-num').value = year && seq ? `${String(seq).padStart(3, '0')}/${year}` : '';
}

function initDevisForm() {
  fillDevisClientSelect();
  devisLineCount = 0;

  const editId = document.getElementById('dev-edit-id').value;
  if (editId) {
    // Mode édition - le formulaire est déjà rempli par editDevis()
    document.getElementById('devis-form-title').innerHTML = 'Modifier <span>Devis</span>';
  } else {
    // Mode création - initialiser un nouveau devis
    document.getElementById('devis-form-title').innerHTML = 'Nouveau <span>Devis</span>';
    const today = todayStr();
    const year = today.slice(0, 4);
    document.getElementById('dev-edit-id').value = '';
    document.getElementById('dev-num-year').value = year;
    document.getElementById('dev-num-seq').value = nextDevisNum(year).split('/')[0];
    document.getElementById('dev-date').value = today;
    document.getElementById('dev-client-select').value = '';
    document.getElementById('dev-client-name').value = '';
    document.getElementById('dev-client-addr').value = '';
    document.getElementById('dev-client-mf').value = '';
    document.getElementById('dev-addStamp').checked = false;
    document.getElementById('dev-tva-percent').value = 7;
    document.getElementById('dev-timbre-amount').value = 1.000;
    document.getElementById('dev-societe').value = 'mythos';
    document.getElementById('dev-logo-override').value = '';
    const devLogoFileNew = document.getElementById('dev-logo-custom');
    if (devLogoFileNew) devLogoFileNew.value = '';
    updateDevisLogoPreview();

    const tbody = document.getElementById('dev-lines-body');
    if (tbody) tbody.innerHTML = '';
    addDevisLine('Prestation', 1, 0, 'Forfait');

    syncDevisNumberPreview();
    calcDevisTotals();
  }
}

function fillDevisClientSelect() {
  const sel = document.getElementById('dev-client-select');
  if (!sel) return;
  sel.innerHTML = '<option value="">-- Nouveau client --</option>' + STORE.clients().map(c => `<option value="${esc(c.id)}">${esc(c.name || c.contact || 'Client')}</option>`).join('');
}

function syncDevisClientFromSelect() {
  const id = document.getElementById('dev-client-select').value;
  const c = STORE.clients().find(client => client.id === id);
  if (!c) return;
  document.getElementById('dev-client-name').value = c.name || c.contact || '';
  document.getElementById('dev-client-addr').value = c.addr || '';
  document.getElementById('dev-client-mf').value = c.mf || '';
}

var devisLineCount = 0;

function addDevisLine(desc = '', qty = 1, pu = 0, unit = 'Forfait') {
  devisLineCount += 1;
  const tbody = document.getElementById('dev-lines-body');
  if (!tbody) return;

  const tr = document.createElement('tr');
  tr.id = 'dev-line-' + devisLineCount;
  tr.innerHTML = `
    <td><input type="text" value="${escapeHtml(desc)}" placeholder="Transport de spectacle à " class="dev-line-desc" oninput="calcDevisTotals()" style="width:100%;padding:6px;border:1px solid #444;border-radius:4px;background:#2d2d2d;color:#fff;"></td>
    <td style="text-align:center;"><input type="number" value="${qty}" min="0" step="0.5" class="dev-line-qty" oninput="calcDevisTotals()" style="width:100%;padding:6px;border:1px solid #444;border-radius:4px;background:#2d2d2d;color:#fff;text-align:center;"></td>
    <td><select class="dev-line-unit" onchange="calcDevisTotals()" style="width:100%;padding:6px;border:1px solid #444;border-radius:4px;background:#2d2d2d;color:#fff;">
      <option ${unit === 'Forfait' ? 'selected' : ''}>Forfait</option>
      <option ${unit === 'Jour(s)' ? 'selected' : ''}>Jour(s)</option>
      <option ${unit === 'Km' ? 'selected' : ''}>Km</option>
      <option ${unit === 'Heure(s)' ? 'selected' : ''}>Heure(s)</option>
    </select></td>
    <td style="text-align:right;"><input type="number" value="${pu}" min="0" step="0.001" class="dev-line-pu" oninput="calcDevisTotals()" style="width:100%;padding:6px;border:1px solid #444;border-radius:4px;background:#2d2d2d;color:#fff;text-align:right;"></td>
    <td class="dev-line-total" style="text-align:right;padding:8px;font-weight:bold;color:#d4af37;">0.000</td>
    <td style="text-align:center;"><button class="btn btn-danger btn-sm" type="button" onclick="removeDevisLine('dev-line-${devisLineCount}')">✕</button></td>
  `;
  tbody.appendChild(tr);
  calcDevisTotals();
}

function removeDevisLine(lineId) {
  const line = document.getElementById(lineId);
  if (line) {
    line.remove();
    calcDevisTotals();
  }
}

function calcDevisTotals() {
  const tbody = document.getElementById('dev-lines-body');
  if (!tbody) return;

  let totalHT = 0;
  const rows = tbody.querySelectorAll('tr');

  rows.forEach(row => {
    const qtyInput = row.querySelector('.dev-line-qty');
    const puInput = row.querySelector('.dev-line-pu');
    const totalCell = row.querySelector('.dev-line-total');

    const qty = parseFloat(qtyInput?.value || 0);
    const pu = parseFloat(puInput?.value || 0);
    const lineTotal = qty * pu;

    if (totalCell) {
      totalCell.textContent = lineTotal.toFixed(3);
    }

    totalHT += lineTotal;
  });

  // TVA variable selon le champ d'entrée
  const tvaPercent = parseFloat(document.getElementById('dev-tva-percent')?.value || 7);
  // Timbre fiscal : montant modifiable (séparé du cachet)
  const timbre = parseFloat(document.getElementById('dev-timbre-amount')?.value || 0);
  const _t = MythosFinance.vatTotals(totalHT, tvaPercent, timbre);
  const tva = _t.tvaAmt;
  const totalTTC = _t.ttc;

  document.getElementById('dev-total-ht').value = totalHT.toFixed(3);
  document.getElementById('dev-total-ttc').value = totalTTC.toFixed(3);
  document.getElementById('dev-tva').value = tva.toFixed(3);

  document.getElementById('dev-t-ht').textContent = fmtMoney(totalHT);
  document.getElementById('dev-t-tva').textContent = fmtMoney(tva);
  document.getElementById('dev-t-timbre').textContent = fmtMoney(timbre);
  document.getElementById('dev-t-ttc').textContent = fmtMoney(totalTTC);
}

function buildDevisHTML(dev) {
  const soc = DEVIS_SOCIETES[dev.societeId] || DEVIS_SOCIETES.mythos;
  const logoSrc = dev.logoOverride || soc.logo;
  const rows = (dev.lines || []).map(line => `<tr style="height:32px;background:#fff;"><td style="padding:10px 8px;border:1px solid #000;">${esc(line.desc)}</td><td style="text-align:center;padding:10px 8px;border:1px solid #000;">${line.qty}</td><td style="text-align:center;padding:10px 8px;border:1px solid #000;">${esc(line.unit || '')}</td><td style="text-align:right;padding:10px 8px;border:1px solid #000;">${fmtMoney(line.pu)}</td><td style="text-align:right;padding:10px 8px;border:1px solid #000;">${fmtMoney(num(line.qty) * num(line.pu))}</td></tr>`).join('');
  const totalHT = (dev.lines || []).reduce((sum, line) => sum + (num(line.qty) * num(line.pu)), 0);
  const tvaPercent = dev.tvaPercent || 7;
  const tvaAmt = totalHT * (tvaPercent / 100);
  const timbre = dev.timbreAmount || 0;
  const totalTTC = totalHT + tvaAmt + timbre;

  return `<div style="background:#fff;color:#000;width:794px;min-height:1123px;padding:16mm 18mm;box-sizing:border-box;font-family:Arial,sans-serif;font-size:14px;line-height:1.4;display:flex;flex-direction:column;">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;border-bottom:1px solid #000;padding-bottom:16px;margin-bottom:20px;">
      <img alt="Logo de la société" src="${logoSrc}" style="width:160px;max-height:80px;object-fit:contain;">
      <div style="text-align:right;">
        <div style="font-size:32px;font-weight:900;color:#000;letter-spacing:1px;">DEVIS</div>
        <div style="font-size:11px;margin-top:6px;color:#333;"><b>N°:</b> ${esc(dev.num)} &nbsp; <b>Date:</b> ${formatDate(dev.date)}</div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:28px;font-size:12px;">
      <div>
        <div style="font-weight:900;color:#000;margin-bottom:8px;font-size:11px;">Émetteur:</div>
        <div style="border:1px solid #000;padding:12px 14px;height:100px;display:flex;flex-direction:column;justify-content:flex-start;">
          <div style="font-weight:900;color:#000;margin-bottom:6px;">${esc(soc.nom)}</div>
          <div style="line-height:1.5;color:#000;">${soc.addrLines.map(esc).join('<br>')}</div>
        </div>
      </div>
      <div>
        <div style="font-weight:900;color:#000;margin-bottom:8px;font-size:11px;">Devis à:</div>
        <div style="border:1px solid #000;padding:12px 14px;height:100px;display:flex;flex-direction:column;justify-content:flex-start;">
          <div style="line-height:1.5;color:#000;"><b>${esc(dev.clientName)}</b><br>${esc(dev.clientAddr)}<br>${esc(dev.clientMf)}</div>
        </div>
      </div>
    </div>
    <div style="font-size:11px;font-weight:900;color:#000;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;">Détail des prestations</div>
    <table style="width:100%;border-collapse:collapse;margin-top:0;margin-bottom:20px;font-size:14px;"><thead><tr style="background:#fff;color:#000;font-weight:900;"><th style="padding:10px;text-align:left;border:1px solid #000;">Description</th><th style="padding:10px;text-align:center;border:1px solid #000;width:60px;">Qté</th><th style="padding:10px;text-align:center;border:1px solid #000;width:70px;">Unité</th><th style="padding:10px;text-align:right;border:1px solid #000;width:100px;">Prix unit.</th><th style="padding:10px;text-align:right;border:1px solid #000;width:100px;">Total HT</th></tr></thead><tbody>${rows}</tbody></table>
    <div style="width:380px;margin-left:auto;margin-bottom:20px;font-size:12px;border:1px solid #000;padding:14px 16px;">
      <div style="display:flex;justify-content:space-between;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid #000;">
        <span style="color:#000;">Total HT</span>
        <b style="color:#000;font-size:13px;">${fmtMoney(totalHT)}</b>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid #000;">
        <span style="color:#000;">TVA ${tvaPercent}%</span>
        <b style="color:#000;font-size:13px;">${fmtMoney(tvaAmt)}</b>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:10px;padding-bottom:10px;">
        <span style="color:#000;">Timbre fiscal</span>
        <b style="color:#000;font-size:13px;">${fmtMoney(timbre)}</b>
      </div>
      <div style="display:flex;justify-content:space-between;border-top:2px solid #000;padding-top:10px;font-size:15px;font-weight:900;">
        <span style="color:#000;">TOTAL TTC</span>
        <b style="color:#000;font-size:16px;">${fmtMoney(totalTTC)}</b>
      </div>
    </div>
    <div style="margin-bottom:20px;padding:12px 14px;border:1px solid #000;font-size:11px;">
      <span style="font-weight:900;color:#000;">Arrêtée la présente devis à la somme de :</span><br>
      <span style="color:#000;margin-top:6px;display:block;font-style:italic;">${numberToFrenchWords(totalTTC)}</span>
    </div>
    <div style="margin-bottom:20px;display:grid;grid-template-columns:1fr;gap:16px;font-size:11px;">
      <div style="text-align:right;display:flex;flex-direction:column;align-items:flex-end;gap:10px;margin-right:80px;">
        <div style="font-weight:900;color:#000;margin-bottom:8px;">Signature et Cachet</div>
        ${dev.addStamp ? `<img alt="" src="${getStampSVGFor(dev.societeId)}" style="height:90px;width:auto;transform:rotate(-3deg);opacity:0.85;filter:drop-shadow(1px 1px 2px rgba(30,64,175,0.3)) blur(0.3px);">` : ''}
      </div>
    </div>
    <div style="margin-top:auto;padding-top:14px;border-top:1px solid #000;font-size:9px;line-height:1.6;text-align:center;color:#000;">
      ${soc.footer}
    </div>
  </div>`;
}

function printDevis(devisId) {
  const devis = STORE.devis().find(d => d.id === devisId);
  if (!devis) return;

  document.getElementById('devis-preview').innerHTML = buildDevisHTML(devis);
  document.getElementById('devis-preview-modal').style.display = 'flex';
}

function closeDevisPreview() {
  document.getElementById('devis-preview-modal').style.display = 'none';
}
