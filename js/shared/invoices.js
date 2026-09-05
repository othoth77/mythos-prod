// Invoices CRUD shared module (Stage 4M).
// Globals remain available for existing inline handlers and callers.


var stableLineCount = 0;


function renderList() {
  const el = document.getElementById('invoice-list');
  if (!el) return;
  const invoices = STORE.invoices().slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  if (!invoices.length) {
    el.innerHTML = '<div class="empty-state">Aucune facture.</div>';
    return;
  }
  el.innerHTML = '<div class="invoice-grid invoice-list-grid">' + invoices.map(inv => {
    const isSans = inv.type === 'sans_tva';
    const title = isSans ? 'Sans numerotation' : esc(inv.num || '-');
    const total = getInvoiceTotal(inv);
    const statusClass = inv.status === 'paid' ? 'paid' : 'pending';
    const statusText = inv.status === 'paid'
      ? `Pay&eacute;e avec ${esc(paymentModeLabel(inv.paymentMode))}`
      : 'Non pay&eacute;e';
    const previewAction = isSans ? '' : `previewInvoice('${inv.id}')`;
    const printButtons = isSans ? '' : `
      <button class="btn btn-gold btn-sm invoice-icon-btn invoice-print-btn" onclick="event.stopPropagation();previewInvoice('${inv.id}')" title="Imprimer" aria-label="Imprimer"><span aria-hidden="true">&#128424;</span></button>`;
    const paymentBadge = `<div class="invoice-payment-badge ${statusClass}">${statusText}</div>`;
    return `<div class="invoice-card invoice-list-card" onclick="${previewAction}">
      <div class="invoice-list-main">
        <div class="inv-num">${title}${isSans ? '<span class="invoice-type-badge">Sans TVA</span>' : ''}</div>
        <div class="inv-client">${esc(inv.clientName || 'Client non defini')}</div>
        <div class="inv-meta">${formatDate(inv.date)} · ${fmtMoney(total)}</div>
        ${paymentBadge}
      </div>
      <div class="inv-actions invoice-list-actions" onclick="event.stopPropagation()">
        ${printButtons}
        <button class="btn btn-outline btn-sm invoice-icon-btn" onclick="editInvoice('${inv.id}')" title="Modifier" aria-label="Modifier"><span aria-hidden="true">&#9998;</span></button>
        <button class="btn btn-danger btn-sm invoice-icon-btn" onclick="deleteInvoice('${inv.id}')" title="Supprimer" aria-label="Supprimer"><span aria-hidden="true">&times;</span></button>
      </div>
    </div>`;
  }).join('') + '</div>';
}

function nextInvoiceNum(year = new Date().getFullYear()) {
  const nums = STORE.invoices()
    .filter(inv => inv.type !== 'sans_tva' && String(inv.num || '').endsWith('/' + year))
    .map(inv => parseInt(String(inv.num || '').split('/')[0], 10))
    .filter(Number.isFinite);
  return String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, '0') + '/' + year;
}

function splitInvoiceNum(numValue) {
  const match = String(numValue || '').match(/^(\d+)\/(\d{4})$/);
  return match ? { seq: match[1], year: match[2] } : { seq: '', year: String(new Date().getFullYear()) };
}


function initNewForm() {
  const today = todayStr();
  const year = today.slice(0, 4);
  document.getElementById('edit-id').value = '';
  document.getElementById('form-page-title').innerHTML = 'Nouvelle <span>Facture</span>';
  document.getElementById('f-type').value = 'tva';
  document.getElementById('f-date').value = today;
  document.getElementById('f-status').value = 'pending';
  document.getElementById('f-payment-mode').value = 'virement';
  document.getElementById('f-num-year').value = year;
  document.getElementById('f-num-seq').value = nextInvoiceNum(year).split('/')[0];
  document.getElementById('f-timbre-amount').value = '1.000';
  fillClientSelect();
  ['f-client-name', 'f-client-addr', 'f-client-mf'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('lines-body').innerHTML = '';
  stableLineCount = 0;
  addLine('Transport de spectacle à ', 1, 0, 'Forfait');
  syncInvoiceNumberPreview();
  handleInvoiceTypeChange();
  updateInvoicePaymentModeVisibility();
  calcTotals();
}

function handleInvoiceTypeChange() {
  const type = document.getElementById('f-type')?.value || 'tva';
  const isSans = type === 'sans_tva';
  ['invoice-number-group', 'tva-row', 'timbre-row'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = isSans ? 'none' : '';
  });
  const label = document.getElementById('total-label');
  if (label) label.textContent = isSans ? 'Total' : 'Total TTC';
  calcTotals();
}

function handleInvoiceYearChange() {
  const year = document.getElementById('f-num-year').value || new Date().getFullYear();
  document.getElementById('f-num-seq').value = nextInvoiceNum(year).split('/')[0];
  syncInvoiceNumberPreview();
}

function handleInvoiceDateChange() {
  const date = document.getElementById('f-date').value;
  if (date) {
    document.getElementById('f-num-year').value = date.slice(0, 4);
    handleInvoiceYearChange();
  }
}

function syncInvoiceNumberPreview() {
  const year = document.getElementById('f-num-year').value;
  const seq = String(document.getElementById('f-num-seq').value || '').padStart(3, '0').slice(-3);
  const finalNum = year && seq ? `${seq}/${year}` : '';
  document.getElementById('f-num').value = finalNum;
  document.getElementById('f-num-preview').textContent = finalNum || '---';
}

function fillClientSelect() {
  const sel = document.getElementById('f-client-select');
  if (!sel) return;
  sel.innerHTML = '<option value="">-- Nouveau client --</option>' + STORE.clients().map(c => `<option value="${esc(c.id)}">${esc(c.name || c.contact || 'Client')}</option>`).join('');
}

function fillClientFromSelect() {
  const id = document.getElementById('f-client-select').value;
  const c = STORE.clients().find(client => client.id === id);
  if (!c) return;
  document.getElementById('f-client-name').value = c.name || c.contact || '';
  document.getElementById('f-client-addr').value = c.addr || '';
  document.getElementById('f-client-mf').value = c.mf || '';
}

function addLine(desc = '', qty = 1, pu = 0, unit = 'Forfait') {
  stableLineCount += 1;
  const tr = document.createElement('tr');
  tr.id = 'line-' + stableLineCount;
  tr.innerHTML = `
    <td><input type="text" value="${esc(desc)}" placeholder="Transport de spectacle à " oninput="calcTotals()"></td>
    <td><input type="number" value="${qty}" min="0" step="0.5" oninput="calcTotals()"></td>
    <td><select onchange="calcTotals()"><option ${unit === 'Forfait' ? 'selected' : ''}>Forfait</option><option ${unit === 'Jour(s)' ? 'selected' : ''}>Jour(s)</option><option ${unit === 'Km' ? 'selected' : ''}>Km</option></select></td>
    <td><input type="number" value="${pu}" min="0" step="0.001" oninput="calcTotals()"></td>
    <td class="line-total">0.000</td>
    <td><button class="btn-remove" onclick="removeLine('${tr.id}')">x</button></td>`;
  document.getElementById('lines-body').appendChild(tr);
  calcTotals();
}

function removeLine(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
  calcTotals();
}

function getLines() {
  return Array.from(document.querySelectorAll('#lines-body tr')).map(tr => {
    const inputs = tr.querySelectorAll('input');
    const select = tr.querySelector('select');
    return {
      desc: inputs[0]?.value || '',
      qty: num(inputs[1]?.value),
      unit: select?.value || 'Forfait',
      pu: num(inputs[2]?.value)
    };
  }).filter(line => line.desc || line.qty || line.pu);
}

function calcTotals() {
  const lines = getLines();
  Array.from(document.querySelectorAll('#lines-body tr')).forEach(tr => {
    const inputs = tr.querySelectorAll('input');
    const total = num(inputs[1]?.value) * num(inputs[2]?.value);
    const cell = tr.querySelector('.line-total');
    if (cell) cell.textContent = total.toFixed(3);
  });
  const ht = lines.reduce((sum, line) => sum + line.qty * line.pu, 0);
  const isSans = document.getElementById('f-type')?.value === 'sans_tva';
  const tvaRate = isSans ? 0 : num(document.getElementById('f-tva')?.value);
  const timbre = isSans ? 0 : num(document.getElementById('f-timbre-amount')?.value || 1);
  const t = MythosFinance.vatTotals(ht, tvaRate, timbre);
  document.getElementById('t-ht').textContent = fmtMoney(t.ht);
  document.getElementById('t-tva').textContent = fmtMoney(t.tvaAmt);
  document.getElementById('t-timbre').textContent = fmtMoney(t.timbre);
  document.getElementById('t-ttc').textContent = fmtMoney(t.ttc);
}

function saveInvoice() {
  const type = document.getElementById('f-type').value;
  const editId = document.getElementById('edit-id').value;
  const clientName = document.getElementById('f-client-name').value.trim();
  const clientAddr = document.getElementById('f-client-addr').value;
  const clientMf = document.getElementById('f-client-mf').value;
  const date = document.getElementById('f-date').value;
  const status = document.getElementById('f-status')?.value || 'pending';
  const paymentMode = document.getElementById('f-payment-mode')?.value || 'virement';
  if (!clientName || !date) { alert('Client et date obligatoires'); return; }
  const lines = getLines();
  if (!lines.length) { alert('Ajoutez au moins une prestation'); return; }
  const ht = lines.reduce((sum, line) => sum + line.qty * line.pu, 0);
  const isSans = type === 'sans_tva';
  const tva = isSans ? 0 : num(document.getElementById('f-tva').value);
  const timbre = isSans ? 0 : num(document.getElementById('f-timbre-amount')?.value || 1);
  const _t = MythosFinance.vatTotals(ht, tva, timbre);
  const tvaAmt = _t.tvaAmt;
  const invoice = {
    id: editId || 'inv_' + Date.now(),
    type,
    num: isSans ? '' : document.getElementById('f-num').value,
    date,
    clientName,
    clientAddr,
    clientMf,
    lines,
    tva,
    tvaAmt,
    timbre,
    ht,
    ttc: _t.ttc,
    status,
    paymentMode: status === 'paid' ? paymentMode : ''
  };
  let invoices = STORE.invoices();
  const old = invoices.find(inv => inv.id === editId);
  if (old?.status && !document.getElementById('f-status')) invoice.status = old.status;
  if (old?.paymentMode && !document.getElementById('f-payment-mode')) invoice.paymentMode = old.paymentMode;
  invoices = editId ? invoices.map(inv => inv.id === editId ? invoice : inv) : invoices.concat(invoice);
  STORE.saveInvoices(invoices);
  if (typeof LOGGER !== 'undefined') LOGGER.log('SAVE_INVOICE', { num: invoice.num, client: invoice.clientName, action: editId ? 'edit' : 'create' });

  // ✅ Auto-add client if not already in list
  let clients = STORE.clients();
  const existingClient = clients.find(c => c.name === clientName);
  if (!existingClient) {
    const newClient = {
      id: 'client_' + Date.now(),
      name: clientName,
      contact: '',
      addr: clientAddr || '',
      mf: clientMf || '',
      tel: ''
    };
    clients.push(newClient);
    STORE.saveClients(clients);
  }

  showView('list');
}

function editInvoice(id) {
  const inv = STORE.invoices().find(item => item.id === id);
  if (!inv) return;
  showView('new');
  document.getElementById('edit-id').value = inv.id;
  document.getElementById('form-page-title').innerHTML = 'Modifier <span>Facture</span>';
  document.getElementById('f-type').value = inv.type || 'tva';
  const parts = splitInvoiceNum(inv.num);
  document.getElementById('f-num-year').value = parts.year;
  document.getElementById('f-num-seq').value = parts.seq;
  document.getElementById('f-date').value = inv.date || todayStr();
  document.getElementById('f-client-name').value = inv.clientName || '';
  document.getElementById('f-client-addr').value = inv.clientAddr || '';
  document.getElementById('f-client-mf').value = inv.clientMf || '';
  document.getElementById('f-tva').value = inv.tva || 0;
  document.getElementById('f-timbre-amount').value = inv.timbre || 1;
  document.getElementById('f-status').value = inv.status || 'pending';
  document.getElementById('f-payment-mode').value = inv.paymentMode || 'virement';
  document.getElementById('lines-body').innerHTML = '';
  stableLineCount = 0;
  (inv.lines || []).forEach(line => addLine(line.desc, line.qty, line.pu, line.unit));
  if (!(inv.lines || []).length) addLine();
  syncInvoiceNumberPreview();
  handleInvoiceTypeChange();
  updateInvoicePaymentModeVisibility();
}

function deleteInvoice(id) {
  if (!confirm('Supprimer cette facture ?')) return;
  STORE.saveInvoices(STORE.invoices().filter(inv => inv.id !== id));
  if (typeof LOGGER !== 'undefined') LOGGER.log('DELETE_INVOICE', { id });
  renderList();
  updateSidebarStats();
}



function cancelForm() {
  showView('list');
}

function previewInvoice(id) {
  const inv = STORE.invoices().find(item => item.id === id);
  if (!inv || inv.type === 'sans_tva') return;
  // Use current checkbox values from form, not saved values
  inv.addStamp = document.getElementById('f-addStamp')?.checked || false;
  document.getElementById('invoice-preview').innerHTML = buildInvoiceHTML(inv);
  document.getElementById('preview-modal').style.display = 'flex';
}

function closePreview() {
  document.getElementById('preview-modal').style.display = 'none';
}

// [utils.js] numberToFrenchWords

function buildInvoiceHTML(inv) {
  const rows = (inv.lines || []).map(line => `<tr style="height:32px;background:#fff;"><td style="padding:10px 8px;border:1px solid #000;">${esc(line.desc)}</td><td style="text-align:center;padding:10px 8px;border:1px solid #000;">${line.qty}</td><td style="text-align:center;padding:10px 8px;border:1px solid #000;">${esc(line.unit || '')}</td><td style="text-align:right;padding:10px 8px;border:1px solid #000;">${fmtMoney(line.pu)}</td><td style="text-align:right;padding:10px 8px;border:1px solid #000;">${fmtMoney(num(line.qty) * num(line.pu))}</td></tr>`).join('');
  return `<div style="background:#fff;color:#000;width:794px;min-height:1123px;padding:16mm 18mm;box-sizing:border-box;font-family:Arial,sans-serif;font-size:14px;line-height:1.4;display:flex;flex-direction:column;">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;border-bottom:1px solid #000;padding-bottom:16px;margin-bottom:20px;">
      <img alt="Logo de la société" src="${MYTHOS_PRINT_LOGO_SRC}" style="width:160px;max-height:80px;object-fit:contain;">
      <div style="text-align:right;">
        <div style="font-size:32px;font-weight:900;color:#000;letter-spacing:1px;">FACTURE</div>
        <div style="font-size:11px;margin-top:6px;color:#333;"><b>N°:</b> ${esc(inv.num)} &nbsp; <b>Date:</b> ${formatDate(inv.date)}</div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:28px;font-size:12px;">
      <div>
        <div style="font-weight:900;color:#000;margin-bottom:8px;font-size:11px;">Émetteur:</div>
        <div style="border:1px solid #000;padding:12px 14px;height:100px;display:flex;flex-direction:column;justify-content:flex-start;">
          <div style="font-weight:900;color:#000;margin-bottom:6px;">Mythos Prod</div>
          <div style="line-height:1.5;color:#000;">04 Rue Habib Thamer<br>Khelidia 2054<br>MF: 1367868NAM000</div>
        </div>
      </div>
      <div>
        <div style="font-weight:900;color:#000;margin-bottom:8px;font-size:11px;">Facturé à:</div>
        <div style="border:1px solid #000;padding:12px 14px;height:100px;display:flex;flex-direction:column;justify-content:flex-start;">
          <div style="line-height:1.5;color:#000;"><b>${esc(inv.clientName)}</b><br>${esc(inv.clientAddr)}<br>${esc(inv.clientMf)}</div>
        </div>
      </div>
    </div>
    <div style="font-size:11px;font-weight:900;color:#000;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;">Détail des prestations</div>
    <table style="width:100%;border-collapse:collapse;margin-top:0;margin-bottom:20px;font-size:14px;"><thead><tr style="background:#fff;color:#000;font-weight:900;"><th style="padding:10px;text-align:left;border:1px solid #000;">Description</th><th style="padding:10px;text-align:center;border:1px solid #000;width:60px;">Qté</th><th style="padding:10px;text-align:center;border:1px solid #000;width:70px;">Unité</th><th style="padding:10px;text-align:right;border:1px solid #000;width:100px;">Prix unit.</th><th style="padding:10px;text-align:right;border:1px solid #000;width:100px;">Total HT</th></tr></thead><tbody>${rows}</tbody></table>
    <div style="width:380px;margin-left:auto;margin-bottom:20px;font-size:12px;border:1px solid #000;padding:14px 16px;">
      <div style="display:flex;justify-content:space-between;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid #000;">
        <span style="color:#000;">Total HT</span>
        <b style="color:#000;font-size:13px;">${fmtMoney(getInvoiceHT(inv))}</b>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid #000;">
        <span style="color:#000;">TVA ${inv.tva || 0}%</span>
        <b style="color:#000;font-size:13px;">${fmtMoney(inv.tvaAmt)}</b>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:10px;padding-bottom:10px;">
        <span style="color:#000;">Timbre fiscal</span>
        <b style="color:#000;font-size:13px;">${fmtMoney(inv.timbre)}</b>
      </div>
      <div style="display:flex;justify-content:space-between;border-top:2px solid #000;padding-top:10px;font-size:15px;font-weight:900;">
        <span style="color:#000;">TOTAL TTC</span>
        <b style="color:#000;font-size:16px;">${fmtMoney(getInvoiceTotal(inv))}</b>
      </div>
    </div>
    <div style="margin-bottom:20px;padding:12px 14px;border:1px solid #000;font-size:11px;">
      <span style="font-weight:900;color:#000;">Arrêtée la présente facture à la somme de :</span><br>
      <span style="color:#000;margin-top:6px;display:block;font-style:italic;">${numberToFrenchWords(getInvoiceTotal(inv))}</span>
    </div>
    <div style="margin-bottom:20px;display:grid;grid-template-columns:1fr;gap:16px;font-size:11px;">
      <div style="text-align:right;display:flex;flex-direction:column;align-items:flex-end;gap:10px;margin-right:80px;">
        <div style="font-weight:900;color:#000;margin-bottom:8px;">Signature et Cachet</div>
        ${inv.addStamp ? `<img alt="" src="${getStampSVG()}" style="height:90px;width:auto;transform:rotate(-3deg);opacity:0.85;filter:drop-shadow(1px 1px 2px rgba(30,64,175,0.3)) blur(0.3px);">` : ''}
      </div>
    </div>
    <div style="margin-top:auto;padding-top:14px;border-top:1px solid #000;font-size:9px;line-height:1.6;text-align:center;color:#000;">
      <strong>Mythos Production</strong> • 04 Rue Habib Thamer, Khelidia 2054<br>
      Tél: 98.999.660 / 21.821.921 | Email: ste.mythosprod@gmail.com<br>
      RC Tunis B01185972014 | MF: 1367868NAM000 | RIB BIAT: 0800 6011 0510 0066 3124
    </div>
  </div>`;
}
// Mission Orders CRUD moved to js/shared/mission-orders.js.
