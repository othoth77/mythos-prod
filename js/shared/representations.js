// MYTHOS PROD — REPRESENTATIONS v1
// Dependencies: STORE.representations/saveRepresentations/clients/natures (app.js);
//   esc, fmtMoney, num, formatDate, formatDateLong, todayStr (utils.js); browser DOM
var stableRepNatureRows = 0;

function renderRepresentations() {
  const el = document.getElementById('representations-dashboard');
  let reps = STORE.representations();
  if (!reps.length) { el.innerHTML = '<div class="empty-state">Aucune representation.</div>'; return; }

  let html = '';

  html += '<div style="width:100%; overflow-x:auto; -webkit-overflow-scrolling:touch; border-radius:12px;">' +
    '<table class="representations-list-table" style="width:100%; table-layout:fixed; min-width:1000px;">' +
    '<thead><tr style="background:#1a1a1a;"><th style="width:18%;padding:6px 8px;">Spectacle</th><th style="width:15%;padding:6px 8px;">Client</th><th style="width:15%;padding:6px 8px;">Directeur</th><th style="width:22%;padding:6px 8px;">Natures</th><th style="width:12%;text-align:right;padding:6px 8px;">Cachet</th><th style="width:18%;text-align:center;padding:6px 8px;">Actions</th></tr></thead>' +
    '<tbody>' + reps.map(rep => {
      return `<tr style="cursor:pointer; border-bottom:1px solid #333; background:rgba(201,168,76,0.02);" onclick="showRepresentationDetail('${rep.id}')">
        <td style="padding:6px 8px;"><strong>${esc(rep.spectacle || 'Representation')}</strong></td>
        <td style="padding:6px 8px;">${esc(rep.clientName || '-')}</td>
        <td style="padding:6px 8px;">${esc(rep.director || '-')}</td>
        <td style="padding:6px 8px;color:var(--muted);font-size:12px;">${(rep.natureLines || []).map(n => esc(n.displayName || n.natureName || '')).join(', ') || '-'}</td>
        <td style="padding:6px 8px;text-align:right;color:var(--gold-light);font-weight:700;">${fmtMoney(rep.fee)}</td>
        <td style="padding:6px 8px;text-align:center;" onclick="event.stopPropagation();"><button class="btn btn-outline btn-sm" onclick="openRepresentationModal('${rep.id}')" title="Modifier">✏️</button> <button class="btn btn-danger btn-sm" onclick="deleteRepresentation('${rep.id}')" title="Supprimer">✕</button></td>
      </tr>`;
    }).join('') + '</tbody></table></div>';

  el.innerHTML = html;
}
function showRepresentationDetail(repId) {
  const rep = STORE.representations().find(r => r.id === repId);
  if (!rep) return;
  const el = document.getElementById('representations-dashboard');
  el.innerHTML = `
    <div style="margin-bottom:24px;">
      <button class="btn btn-outline" onclick="renderRepresentations()" style="margin-bottom:16px;">← Retour à la liste</button>
      <div style="background:linear-gradient(135deg, rgba(201,168,76,0.12), rgba(201,168,76,0.06)); border:1px solid rgba(201,168,76,0.2); border-radius:16px; padding:32px 40px; margin-bottom:32px;">
        <h1 style="font-family:'Playfair Display',serif; font-size:42px; color:var(--gold-light); font-weight:800; margin:0 0 16px 0;">${esc(rep.spectacle || 'Representation')}</h1>
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:20px; margin-top:20px;">
          <div><div style="color:var(--muted); font-size:11px; text-transform:uppercase; font-weight:700; margin-bottom:5px;">Client</div><div style="color:var(--text); font-size:14px;">${esc(rep.clientName || '-')}</div></div>
          <div><div style="color:var(--muted); font-size:11px; text-transform:uppercase; font-weight:700; margin-bottom:5px;">Directeur</div><div style="color:var(--text); font-size:14px;">${esc(rep.director || '-')}</div></div>
          <div><div style="color:var(--muted); font-size:11px; text-transform:uppercase; font-weight:700; margin-bottom:5px;">Cachet</div><div style="color:var(--gold-light); font-size:16px; font-weight:700;">${fmtMoney(rep.fee || 0)}</div></div>
        </div>
        <div style="margin-top:20px;"><div style="color:var(--muted); font-size:11px; text-transform:uppercase; font-weight:700; margin-bottom:8px;">Natures de travail</div><div style="color:var(--text); font-size:13px;">${(rep.natureLines || []).map(n => esc(n.displayName || n.natureName || '')).join(' • ') || '-'}</div></div>
      </div>
    </div>
  `;
}
function openRepresentationModal(id = '') {
  const rep = STORE.representations().find(r => r.id === id);
  document.getElementById('rep-edit-id').value = rep?.id || '';
  document.getElementById('rep-spectacle').value = rep?.spectacle || '';
  document.getElementById('rep-client-name').value = rep?.clientName || '';
  document.getElementById('rep-director').value = rep?.director || '';
  document.getElementById('rep-fee').value = rep?.fee || 0;
  fillRepresentationClients();
  document.getElementById('rep-client-id').value = rep?.clientId || '';
  document.getElementById('rep-nature-lines').innerHTML = '';
  stableRepNatureRows = 0;
  (rep?.natureLines || [{ natureId: '', natureName: '', displayName: '' }]).forEach(line => addRepresentationNatureLine(line));
  document.getElementById('representation-modal').style.display = 'flex';
}
function closeRepresentationModal() { document.getElementById('representation-modal').style.display = 'none'; }
function fillRepresentationClients() {
  const sel = document.getElementById('rep-client-id');
  sel.innerHTML = '<option value="">-- Selectionner client --</option>' + STORE.clients().map(c => `<option value="${esc(c.id)}">${esc(c.name || c.contact)}</option>`).join('');
}
function syncRepresentationClient() {
  const c = STORE.clients().find(client => client.id === document.getElementById('rep-client-id').value);
  if (c) document.getElementById('rep-client-name').value = c.name || c.contact || '';
}
function addRepresentationNatureLine(line = {}) {
  stableRepNatureRows += 1;
  const id = 'rep-nature-' + stableRepNatureRows;
  const wrap = document.createElement('div');
  wrap.id = id;
  wrap.style.cssText = 'display:grid;grid-template-columns:1fr 1fr auto;gap:8px;margin-bottom:8px;';
  wrap.innerHTML = `<select class="rep-nature-id">${STORE.natures().map(n => `<option value="${esc(n.id)}" ${line.natureId === n.id ? 'selected' : ''}>${esc(n.nom)}</option>`).join('')}</select><input class="rep-nature-display" type="text" value="${esc(line.displayName || line.natureName || '')}" placeholder="Nature affichee"><button class="btn btn-outline btn-sm" onclick="document.getElementById('${id}').remove()">x</button>`;
  document.getElementById('rep-nature-lines').appendChild(wrap);
}
function saveRepresentation() {
  const id = document.getElementById('rep-edit-id').value || 'rep_' + Date.now();
  const natureLines = Array.from(document.querySelectorAll('#rep-nature-lines > div')).map(row => {
    const nature = STORE.natures().find(n => n.id === row.querySelector('.rep-nature-id')?.value);
    return { natureId: nature?.id || '', natureName: nature?.nom || '', displayName: row.querySelector('.rep-nature-display')?.value || nature?.nom || '' };
  });
  const clientSel = document.getElementById('rep-client-id');
  const rep = { id, spectacle: document.getElementById('rep-spectacle').value,
    clientId: clientSel?.value || '',
    clientName: document.getElementById('rep-client-name')?.value || clientSel?.options[clientSel?.selectedIndex]?.text || '',
    director: document.getElementById('rep-director')?.value || '',
    date: '',
    fee: num(document.getElementById('rep-fee')?.value || 0),
    notes: '',
    natureLines
  };
  const reps = STORE.representations();
  const idx = reps.findIndex(r => r.id === id);
  if (idx >= 0) reps[idx] = rep; else reps.unshift(rep);
  STORE.saveRepresentations(reps);
  closeRepresentationModal();
  renderRepresentations();
}

function deleteRepresentation(id) {
  if (confirm('Supprimer cette representation ?')) {
    STORE.saveRepresentations(STORE.representations().filter(r => r.id !== id));
    renderRepresentations();
  }
}

function printRepresentations() {
  const reps = STORE.representations();
  const today = formatDateLong(todayStr());
  const totalFee = reps.reduce((s, r) => s + num(r.fee), 0);
  const w = window.open('', '_blank');
  w.document.write('<html><head><title>Representations</title><style>body{font-family:Arial;padding:20px;}table{width:100%;border-collapse:collapse;}th{background:#c9a84c;color:#fff;padding:8px;text-align:left;}td{padding:8px;border-bottom:1px solid #ddd;}</style></head><body>');
  w.document.write('<h2>Mes Representations - ' + today + '</h2>');
  w.document.write('<table><thead><tr><th>Spectacle</th><th>Client</th><th>Date</th><th>Cachet</th></tr></thead><tbody>');
  reps.forEach(r => { w.document.write('<tr><td>' + esc(r.spectacle||'') + '</td><td>' + esc(r.clientName||'') + '</td><td>' + formatDate(r.date||'') + '</td><td>' + fmtMoney(r.fee) + '</td></tr>'); });
  w.document.write('</tbody></table><p>Total: ' + fmtMoney(totalFee) + ' TND</p></body></html>');
  w.document.close();
  setTimeout(() => w.print(), 300);
}
