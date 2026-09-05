/* MYTHOS WP — DOM helpers, toasts, dialogs, badges, icons, formatting. */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) Object.keys(attrs).forEach((k) => {
    const v = attrs[k];
    if (v === undefined || v === null || v === false) return;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'html') el.innerHTML = v; // only ever called with our own markup (icons)
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  });
  append(el, children);
  return el;
}
export function append(el, children) {
  children.flat(Infinity).forEach((c) => { if (c === null || c === undefined || c === false) return; el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c); });
  return el;
}
export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

const ICONS = {
  dashboard: '<path d="M3 3h8v8H3zM13 3h8v5h-8zM13 10h8v11h-8zM3 13h8v8H3z"/>',
  part: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
  reference: '<path d="M4 6h16M4 12h10M4 18h7"/><circle cx="18" cy="17" r="3"/>',
  vehicle: '<path d="M3 13l2-5h14l2 5v5H3z"/><circle cx="7.5" cy="16.5" r="1.5"/><circle cx="16.5" cy="16.5" r="1.5"/>',
  engine: '<rect x="4" y="8" width="16" height="10" rx="2"/><path d="M8 8V5h8v3M2 12h2M20 12h2"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
  price: '<path d="M12 2v20M17 6.5c0-2-2.2-3.5-5-3.5s-5 1.5-5 3.5 2 3 5 3.5 5 1.5 5 3.5-2.2 3.5-5 3.5-5-1.5-5-3.5"/>',
  stock: '<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>',
  auto: '<path d="M4 4h16v11H8l-4 4z"/><path d="M8 9h8M8 12h5"/>',
  handoff: '<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M17 8l4 4-4 4"/>',
  knowledge: '<path d="M4 4h12a2 2 0 0 1 2 2v14H6a2 2 0 0 1-2-2z"/><path d="M8 8h6M8 12h6"/>',
  project: '<path d="M3 7h6l2 2h10v10H3z"/>',
  audit: '<path d="M9 3h6l1 3h3v15H5V6h3z"/><path d="M9 12h6M9 16h4"/>',
  system: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  rule: '<path d="M4 6h16M4 12h16M4 18h10"/><path d="m17 16 2 2 3-3"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="M4 20h4l10-10-4-4L4 16z"/><path d="m13 7 4 4"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  columns: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16"/>',
  back: '<path d="m15 6-6 6 6 6"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M19 14v6H4V5h6"/>'
};
export function icon(name) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.7'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true');
  s.innerHTML = ICONS[name] || ICONS.part;
  return s;
}

export function toast(message, kind, ms) {
  const box = document.getElementById('toasts');
  const t = h('div', { class: 'toast ' + (kind || ''), role: 'status' }, message);
  box.appendChild(t);
  setTimeout(() => { t.remove(); }, ms || 3800);
  return t;
}

export function confirmDialog({ title, body, confirmLabel, danger }) {
  return new Promise((resolve) => {
    const dlg = document.getElementById('dialog');
    clear(dlg);
    const ok = h('button', { class: 'btn ' + (danger ? 'btn-danger' : 'btn-primary'), type: 'button', onClick: () => { dlg.close(); resolve(true); } }, confirmLabel || 'Confirm');
    const cancel = h('button', { class: 'btn btn-secondary', type: 'button', onClick: () => { dlg.close(); resolve(false); } }, 'Cancel');
    dlg.appendChild(h('div', { class: 'dialog-body' }, h('h3', {}, title), body ? h('p', {}, body) : null, h('div', { class: 'dialog-foot' }, cancel, ok)));
    dlg.addEventListener('cancel', () => resolve(false), { once: true });
    dlg.showModal();
    ok.focus();
  });
}

export const STATUS_TONE = {
  active: 'ok', updated: 'info', inactive: 'warn', delisted: 'danger', planned: 'mock', archived: 'mock', draft: 'warn',
  NEW: 'info', REQUIRES_HUMAN: 'danger', IN_PROGRESS: 'warn', RESOLVED: 'ok',
  in_stock: 'ok', on_order: 'warn', unavailable: 'danger', unknown: 'mock',
  'En Stock': 'ok', 'Sur Commande': 'warn', 'Indisponible': 'danger',
  VERIFIED: 'ok', UNKNOWN: 'warn', verified: 'ok', low: 'warn', missing_oem: 'warn', complete: 'ok',
  owner: 'accent', operator: 'info', create: 'ok', update: 'info', delete: 'danger', login: 'mock', logout: 'mock', login_failed: 'danger', simulate: 'accent'
};
export function badge(value, tone) {
  if (value === null || value === undefined || value === '') return h('span', { class: 'badge mock' }, '—');
  return h('span', { class: 'badge ' + (tone || STATUS_TONE[value] || '') }, String(value).replace(/_/g, ' '));
}

export function fmtDate(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d)) return String(v);
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
export function fmtNum(v, scale) {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  return isNaN(n) ? String(v) : n.toLocaleString(undefined, { minimumFractionDigits: scale || 0, maximumFractionDigits: scale === undefined ? 2 : scale });
}
export function fmtMoney(v, cur) { return v === null || v === undefined ? '—' : fmtNum(v, 2) + ' ' + (cur || ''); }
export function skeletonRows(n) { return h('div', {}, Array.from({ length: n || 6 }, () => h('div', { class: 'skeleton h-row' }))); }
export function empty(title, text, action) { return h('div', { class: 'empty' }, h('strong', {}, title), text ? h('span', {}, text) : null, action || null); }
export function errorBox(err, retry) {
  const msg = err && (err.detail || err.message) || 'Something went wrong.';
  return h('div', { class: 'notice danger' }, h('strong', {}, 'Could not load. '), msg, err && err.requestId ? h('span', { class: 'dim' }, ' (request ' + err.requestId + ')') : null, retry ? h('div', {}, h('button', { class: 'btn btn-sm btn-secondary', type: 'button', onClick: retry }, 'Retry')) : null);
}
export function json(obj) { return h('pre', { class: 'json' }, obj === null || obj === undefined ? '—' : JSON.stringify(obj, null, 2)); }
export function kv(pairs) {
  const dl = h('dl', { class: 'kv' });
  pairs.forEach(([k, v, cls]) => { dl.appendChild(h('dt', {}, k)); dl.appendChild(h('dd', { class: cls || '' }, v === null || v === undefined || v === '' ? '—' : v)); });
  return dl;
}
