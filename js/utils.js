// =====================================================
// MYTHOS PROD - Utility helpers
// Pure functions only: no DOM, no localStorage, no fetch.
// Loaded before app.js and all business modules.
// =====================================================

// ── String / HTML ──────────────────────────────────────────────────────

function escapeHtml(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return String(text || '').replace(/[&<>"']/g, m => map[m]);
}

// Convenient aliases used across modules
function escHtml(s) { return escapeHtml(s); }
function esc(text)  { return escapeHtml(text); }

function sanitizeInput(str, maxLen = 1000) {
  return String(str || '').trim().substring(0, maxLen);
}

function cleanPrintText(text) {
  let value = String(text || '');
  const replacements = [
    [/Ã©/g, 'é'], [/Ã¨/g, 'è'],
    [/Ãª/g, 'ê'], [/Ã /g, 'à'],
    [/Ã¢/g, 'â'], [/Ã´/g, 'ô'],
    [/Ã®/g, 'î'], [/Ã§/g, 'ç'],
    [/Ã‰/g, 'É'], [/Â°/g, '°'],
    [/Â·/g, '·'], [/â€™/g, '’'],
    [/â€œ/g, '“'], [/â€/g, '”']
  ];
  replacements.forEach(([p, r]) => { value = value.replace(p, r); });
  return value;
}

function cleanRestoredValue(value) {
  if (typeof value === 'string') return cleanPrintText(value);
  if (Array.isArray(value)) return value.map(cleanRestoredValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, cleanRestoredValue(v)]));
  }
  return value;
}

// ── Numbers / money ────────────────────────────────────────────────────

function num(value) { return Number(value || 0); }

function money(val) { return parseFloat(val || 0).toFixed(3); }

function fmtMoney(value) { return num(value).toFixed(3) + ' TND'; }

function paymentModeLabel(mode) {
  const labels = { virement: 'Virement bancaire', especes: 'Espèces', cheque: 'Chèque' };
  return labels[mode] || labels.virement;
}

function numberToFrenchWords(n) {
  const ones  = ['', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf'];
  const teens = ['dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf'];
  const tens  = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante', 'soixante-dix', 'quatre-vingt', 'quatre-vingt-dix'];

  function toWords(x) {
    if (x === 0) return 'zéro';
    let w = '';
    const billions  = Math.floor(x / 1000000000);
    const millions  = Math.floor((x % 1000000000) / 1000000);
    const thousands = Math.floor((x % 1000000) / 1000);
    const hundreds  = Math.floor((x % 1000) / 100);
    const remainder = Math.floor(x % 100);
    if (billions)  w += (billions  === 1 ? 'un' : ones[billions])  + ' milliard' + (billions  > 1 ? 's' : '') + ' ';
    if (millions)  w += (millions  === 1 ? 'un' : ones[millions])  + ' million'  + (millions  > 1 ? 's' : '') + ' ';
    if (thousands) w += (thousands === 1 ? 'mille' : ones[thousands] + ' mille') + ' ';
    if (hundreds)  w += ones[hundreds] + ' cent' + (hundreds > 1 ? 's ' : ' ');
    if (remainder > 0) {
      if (remainder < 10)       w += ones[remainder];
      else if (remainder < 20)  w += teens[remainder - 10];
      else { const t = Math.floor(remainder / 10), o = remainder % 10; w += tens[t] + (o ? '-' + ones[o] : ''); }
    }
    return w.trim();
  }

  const dinars  = Math.floor(n);
  const millimes = Math.round((n - dinars) * 1000);
  let result = toWords(dinars) + ' dinars tunisiens';
  if (millimes > 0) result += ' et ' + toWords(millimes) + ' millimes';
  return result;
}

// ── Date helpers ───────────────────────────────────────────────────────

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('fr-FR');
}

function formatDateLong(dateStr) {
  if (!dateStr) return '';
  const months = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
                  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const d = new Date(dateStr + 'T00:00:00');
  return d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
}

function dateInputValue(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().split('T')[0];
}

function calendarDateCard(dateStr) {
  const months = ['JAN', 'FEV', 'MAR', 'AVR', 'MAI', 'JUIN', 'JUIL', 'AOUT', 'SEP', 'OCT', 'NOV', 'DEC'];
  const d = new Date(String(dateStr || '') + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return { day: '--', month: '', jour: 'Jour ?' };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((d - today) / 86400000);
  const jour = diff === 0 ? 'Jour J' : diff > 0 ? 'J-' + diff : 'J+' + Math.abs(diff);
  return { day: String(d.getDate()).padStart(2, '0'), month: months[d.getMonth()], jour };
}

function isDateInCurrentWeek(dateStr) {
  const d = new Date(String(dateStr || '') + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  const start = new Date(now); start.setDate(now.getDate() - (now.getDay() + 6) % 7); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(start.getDate() + 6); end.setHours(23, 59, 59, 999);
  return d >= start && d <= end;
}

// ── Business data helpers ──────────────────────────────────────────────

function normalizeRdv(rdv) {
  return {
    id: rdv.id,
    date: rdv.date || '',
    heure: rdv.heure || '',
    nature: rdv.nature || rdv.title || 'Rendez-vous',
    client: rdv.client || rdv.clientName || '',
    lieu: rdv.lieu || rdv.place || '',
    notes: rdv.notes || '',
    status: rdv.status || '',
    collaborateur: rdv.collaborateur || { nom: rdv.collabName || '', role: rdv.collabRole || '', contact: '' },
    prestations: Array.isArray(rdv.prestations)
      ? rdv.prestations
      : [{ desc: rdv.nature || 'Prestation', montant: num(rdv.montant), statut: rdv.status === 'paid' ? 'paid' : 'unpaid' }]
  };
}

function getInvoiceTotal(inv) {
  if (inv.ttc !== undefined)      return num(inv.ttc);
  if (inv.totalTTC !== undefined) return num(inv.totalTTC);
  return num(inv.ht || inv.totalHT);
}

function getInvoiceHT(inv) {
  if (inv.ht !== undefined)      return num(inv.ht);
  if (inv.totalHT !== undefined) return num(inv.totalHT);
  return (inv.lines || []).reduce((sum, line) => sum + num(line.qty) * num(line.pu), 0);
}

function getRdvAmount(rdv) {
  if (rdv.montant !== undefined) return num(rdv.montant);
  return (rdv.prestations || []).reduce((sum, p) => sum + num(p.montant), 0);
}

function getRdvPaidAmount(rdv) {
  if (rdv.status === 'paid') return getRdvAmount(rdv);
  return (rdv.prestations || []).filter(p => p.statut === 'paid').reduce((sum, p) => sum + num(p.montant), 0);
}

function isRdvPaid(rdv) {
  if (rdv.status) return rdv.status === 'paid';
  const prestations = rdv.prestations || [];
  return prestations.length > 0 && prestations.every(p => p.statut === 'paid');
}

// ── Print / SVG helpers ────────────────────────────────────────────────

function getStampSVG() {
  const lines = [
    'Mythos Production',
    '04 Rue Habib Thamer, Khelidia 2054',
    'MF: 1367868NAM000',
    'Tel: 98.999.660 - 21.821.921',
    'Email: ste.mythosprod@gmail.com'
  ];
  const fontSizes = [15, 12, 11, 11, 11];
  const yPos      = [22, 37, 50, 63, 76];
  const weights   = ['bold', 'normal', 'normal', 'normal', 'normal'];
  let svg = '<svg width="240" height="95" viewBox="0 0 240 95" xmlns="http://www.w3.org/2000/svg">';
  svg += '<rect x="2" y="4" width="236" height="87" fill="none" stroke="#1e40af" stroke-width="3"/>';
  lines.forEach((line, i) => {
    svg += `<text x="120" y="${yPos[i]}" text-anchor="middle" font-size="${fontSizes[i]}" font-weight="${weights[i]}" fill="#1e40af" font-family="Arial">${line}</text>`;
  });
  svg += '</svg>';
  return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
}

function getSignatureSVG() {
  const svg = `<svg width="180" height="60" viewBox="0 0 180 60" xmlns="http://www.w3.org/2000/svg">
    <path d="M 10 45 Q 20 30 35 35 Q 45 40 50 50 Q 55 55 60 48 Q 65 40 75 42 Q 85 45 90 35 Q 95 25 105 30 Q 115 35 120 50 Q 125 60 135 45 Q 145 30 160 38"
          fill="none" stroke="#1e40af" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
  return 'data:image/svg+xml;base64,' + btoa(svg);
}

// ── UI HTML builders ───────────────────────────────────────────────────

function _statKpi(icon, label, value, color) {
  return '<div class="stat-section-card" style="text-align:center;padding:14px 10px;">' +
    '<div style="font-size:22px;margin-bottom:6px;">' + icon + '</div>' +
    '<div style="color:' + color + ';font-size:17px;font-weight:800;line-height:1.1;">' + value + '</div>' +
    '<div style="color:#888;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;margin-top:4px;">' + label + '</div>' +
    '</div>';
}

function _statMini(label, count, sub) {
  return '<div style="background:#111;border:1px solid #2a2a2a;border-radius:10px;padding:12px;text-align:center;">' +
    '<div style="color:#d4af37;font-size:22px;font-weight:800;">' + count + '</div>' +
    '<div style="color:#ccc;font-size:12px;font-weight:600;">' + label + '</div>' +
    '<div style="color:#555;font-size:10px;">' + sub + '</div>' +
    '</div>';
}
