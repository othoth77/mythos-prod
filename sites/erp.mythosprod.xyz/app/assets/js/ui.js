/* Mythos ERP — UI primitives.
 *
 * DOM construction without innerHTML for anything that carries data (text is
 * always a text node), so a client name containing markup renders as text.
 * Components: toast, modal/confirm, tabs, pagination, skeleton, empty, error,
 * chart, table, formatting. All classes come from assets/erp.css.
 */

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'text') el.textContent = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  append(el, children);
  return el;
}
export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return el;
}
export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
export function svg(tag, attrs, ...children) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v !== null && v !== undefined) el.setAttribute(k, String(v));
  for (const c of children.flat(Infinity)) if (c) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return el;
}

/* ── Formatting ───────────────────────────────────────────────────────── */
export function fmtDate(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d)) return String(v);
  return String(v).length <= 10 ? d.toLocaleDateString('fr-TN') : d.toLocaleString('fr-TN');
}
export function fmtNum(v, scale = 3) {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  return isNaN(n) ? String(v) : n.toLocaleString('fr-TN', { minimumFractionDigits: scale, maximumFractionDigits: scale });
}
export function fmtMoney(v, cur = 'TND') { return v === null || v === undefined ? '—' : fmtNum(v, 3) + ' ' + cur; }
export function shortId(v) { return v ? String(v).slice(0, 8) : '—'; }

/* ── Feedback ─────────────────────────────────────────────────────────── */
export function toast(message, kind = 'info', ms = 4200) {
  const root = document.getElementById('toasts');
  const t = h('div', { class: 'toast ' + kind, text: message });
  root.appendChild(t);
  setTimeout(() => t.remove(), ms);
  return t;
}
export function badge(text, tone) { return h('span', { class: 'badge' + (tone ? ' ' + tone : ''), text }); }
export function statusBadge(status) {
  const tone = { paid: 'ok', accepted: 'ok', active: 'ok', sent: 'info', part_paid: 'warn', draft: '', planned: '',
    cancelled: 'danger', refused: 'danger', expired: 'danger', closed: '', suspended: 'warn' }[status];
  return badge(status || '—', tone);
}
export function skeletonRows(n = 6) { return h('div', {}, Array.from({ length: n }, () => h('div', { class: 'skeleton h-row' }))); }
export function empty(title, text, action) {
  return h('div', { class: 'empty' }, h('strong', { text: title }), text ? h('span', { text }) : null, action || null);
}
export function errorBox(message, retry, detail) {
  return h('div', { class: 'errorbox', role: 'alert' },
    h('strong', { text: 'Erreur' }), h('span', { text: message }),
    detail ? h('code', { text: detail }) : null,
    retry ? h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onClick: retry, text: 'Réessayer' }) : null);
}

/* ── Modal ────────────────────────────────────────────────────────────── */
let openModal = null;
export function modal({ title, body, actions, wide }) {
  closeModal();
  const box = h('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'modal-title' },
    h('h2', { id: 'modal-title', text: title }), body, h('div', { class: 'modal-actions' }, actions || []));
  const back = h('div', { class: 'modal-backdrop', onClick: (e) => { if (e.target === back) closeModal(); } }, box);
  const onKey = (e) => { if (e.key === 'Escape') closeModal(); };
  document.addEventListener('keydown', onKey);
  document.getElementById('modal-root').appendChild(back);
  openModal = { back, onKey };
  const first = box.querySelector('input, select, textarea, button');
  if (first) first.focus();
  return { close: closeModal, box };
}
export function closeModal() {
  if (!openModal) return;
  document.removeEventListener('keydown', openModal.onKey);
  openModal.back.remove();
  openModal = null;
}
export function confirmDialog({ title, text, confirmLabel = 'Confirmer', danger = false }) {
  return new Promise((resolve) => {
    modal({
      title, body: h('p', { text }),
      actions: [
        h('button', { type: 'button', class: 'btn btn-ghost', text: 'Annuler', onClick: () => { closeModal(); resolve(false); } }),
        h('button', { type: 'button', class: 'btn ' + (danger ? 'btn-danger' : 'btn-primary'), text: confirmLabel,
          onClick: () => { closeModal(); resolve(true); } })
      ]
    });
  });
}

/* ── Tabs ─────────────────────────────────────────────────────────────── */
export function tabs(items, activeKey, onSelect) {
  const list = h('div', { class: 'tabs', role: 'tablist' });
  for (const it of items) {
    list.appendChild(h('button', {
      type: 'button', role: 'tab', id: 'tab-' + it.key, 'aria-selected': String(it.key === activeKey),
      'aria-controls': 'panel-' + it.key, text: it.label, onClick: () => onSelect(it.key)
    }));
  }
  return list;
}

/* ── Pagination ───────────────────────────────────────────────────────── */
export function pagination({ total, limit, offset, onPage }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  const current = Math.floor(offset / limit) + 1;
  const nav = h('nav', { class: 'pagination', 'aria-label': 'Pagination' },
    h('span', { text: total === 0 ? 'Aucun enregistrement' : `${offset + 1}–${Math.min(offset + limit, total)} sur ${total}` }),
    h('div', { class: 'pages' },
      h('button', { type: 'button', class: 'btn btn-secondary btn-sm', disabled: current <= 1 || null, text: 'Précédent',
        onClick: () => onPage(Math.max(0, offset - limit)) }),
      h('span', { class: 'mono', text: `${current} / ${pages}` }),
      h('button', { type: 'button', class: 'btn btn-secondary btn-sm', disabled: current >= pages || null, text: 'Suivant',
        onClick: () => onPage(offset + limit) })));
  return nav;
}

/* ── Table ────────────────────────────────────────────────────────────── */
export function table(columns, rows, rowActions) {
  const thead = h('thead', {}, h('tr', {}, columns.map((c) => h('th', { scope: 'col', class: c.num ? 'num' : null, text: c.label })),
    rowActions ? h('th', { scope: 'col', class: 'num', text: 'Actions' }) : null));
  const tbody = h('tbody', {}, rows.map((r) => h('tr', {},
    columns.map((c) => h('td', { class: c.num ? 'num' : null }, c.render ? c.render(r) : (r[c.key] ?? '—'))),
    rowActions ? h('td', {}, h('div', { class: 'row-actions' }, rowActions(r))) : null)));
  return h('div', { class: 'table-wrap' }, h('table', { class: 'data' }, thead, tbody));
}

/* ── Chart: vertical bars (one or two series), tokens for colour ──────── */
export function barChart(series, { width = 720, height = 220, labelKey = 'label', keys = ['a', 'b'] } = {}) {
  const max = Math.max(1, ...series.flatMap((s) => keys.map((k) => Number(s[k]) || 0)));
  const pad = { l: 8, r: 8, t: 16, b: 28 };
  const w = width - pad.l - pad.r, hgt = height - pad.t - pad.b;
  const group = w / Math.max(1, series.length);
  const bw = Math.max(4, (group * 0.72) / keys.length);
  const el = svg('svg', { class: 'chart', viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': 'Graphique en barres' });
  el.appendChild(svg('line', { class: 'axis', x1: pad.l, x2: width - pad.r, y1: pad.t + hgt, y2: pad.t + hgt }));
  series.forEach((s, i) => {
    keys.forEach((k, j) => {
      const v = Number(s[k]) || 0;
      const bh = Math.round((v / max) * hgt);
      const x = pad.l + i * group + (group - bw * keys.length) / 2 + j * bw;
      el.appendChild(svg('rect', { class: 'bar' + (j ? ' alt' : ''), x, y: pad.t + hgt - bh, width: bw - 1, height: bh },
        svg('title', {}, `${s[labelKey]} — ${k}: ${fmtNum(v, 3)}`)));
    });
    el.appendChild(svg('text', { class: 'label', x: pad.l + i * group + group / 2, y: height - 8, 'text-anchor': 'middle' }, String(s[labelKey])));
  });
  return el;
}

/* ── Forms ────────────────────────────────────────────────────────────── */
export function field(label, input, { hint, error, id } = {}) {
  if (id) input.id = id;
  return h('div', { class: 'field' }, h('label', { for: input.id || null, text: label }), input,
    hint ? h('span', { class: 'hint', text: hint }) : null, error ? h('span', { class: 'error', text: error }) : null);
}
export function input(attrs) { return h('input', Object.assign({ class: 'input' }, attrs)); }
export function select(options, attrs) {
  const s = h('select', Object.assign({ class: 'select' }, attrs));
  for (const o of options) s.appendChild(h('option', { value: o.value, selected: o.selected || null, text: o.label }));
  return s;
}
export function textarea(attrs) { return h('textarea', Object.assign({ class: 'textarea' }, attrs)); }
export function formValues(form) {
  const out = {};
  for (const el of form.querySelectorAll('[name]')) {
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else out[el.name] = el.value === '' ? null : el.value;
  }
  return out;
}
