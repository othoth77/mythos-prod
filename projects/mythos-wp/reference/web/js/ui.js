/* MYTHOS Control Center — DOM helpers, toasts, dialogs, badges, icons,
   formatting, tabs, switches, drawers, generic dialog forms, loaders. */
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
  inbox: '<path d="M3 13l2.5-8h13L21 13v6H3z"/><path d="M3 13h5l1.5 3h5L16 13h5"/>',
  contacts: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0"/><circle cx="17" cy="9" r="2.4"/><path d="M15.5 14.5A5 5 0 0 1 22 19"/>',
  project: '<path d="M3 7h6l2 2h10v10H3z"/>',
  whatsapp: '<path d="M4 20l1.3-3.8A8 8 0 1 1 8.4 19z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.5-2-1-1 1a4 4 0 0 1-2-2l1-1-1-2z"/>',
  ai: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M5 17l.8 2.2L8 20l-2.2.8L5 23l-.8-2.2L2 20l2.2-.8z"/>',
  automation: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  integration: '<path d="M9 3v4M15 3v4"/><path d="M6 7h12v5a6 6 0 0 1-12 0z"/><path d="M12 18v3"/>',
  health: '<path d="M3 12h4l2-5 3 10 3-7 1.5 2H21"/>',
  audit: '<path d="M9 3h6l1 3h3v15H5V6h3z"/><path d="M9 12h6M9 16h4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  part: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  handoff: '<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M17 8l4 4-4 4"/>',
  knowledge: '<path d="M4 4h12a2 2 0 0 1 2 2v14H6a2 2 0 0 1-2-2z"/><path d="M8 8h6M8 12h6"/>',
  system: '<circle cx="12" cy="12" r="3"/><path d="M4 12h4M16 12h4M12 4v4M12 16v4"/>',
  rule: '<path d="M4 6h16M4 12h16M4 18h10"/><path d="m17 16 2 2 3-3"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="M4 20h4l10-10-4-4L4 16z"/><path d="m13 7 4 4"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  columns: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16"/>',
  back: '<path d="m15 6-6 6 6 6"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M19 14v6H4V5h6"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5h10"/>',
  check: '<path d="m5 12 4 4L19 7"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  play: '<path d="M7 4l12 8-12 8z"/>',
  theme: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none"/>'
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
    dlg.appendChild(h('div', { class: 'dialog-body' }, h('h3', {}, title), body ? (typeof body === 'string' ? h('p', {}, body) : body) : null, h('div', { class: 'dialog-foot' }, cancel, ok)));
    dlg.addEventListener('cancel', () => resolve(false), { once: true });
    dlg.showModal();
    ok.focus();
  });
}

export const STATUS_TONE = {
  active: 'ok', updated: 'info', inactive: 'warn', delisted: 'danger', planned: 'mock', archived: 'mock', draft: 'warn', paused: 'warn', disabled: 'mock', enabled: 'ok',
  NEW: 'info', REQUIRES_HUMAN: 'danger', IN_PROGRESS: 'warn', RESOLVED: 'ok',
  in_stock: 'ok', on_order: 'warn', unavailable: 'danger', unknown: 'mock',
  ok: 'ok', warning: 'warn', error: 'danger', disconnected: 'danger', missing: 'danger', mismatch: 'warn', present: 'ok', not_required: 'mock',
  open: 'ok', pending: 'warn', waiting_customer: 'info', needs_human: 'danger', resolved: 'mock', closed: 'mock', pairing: 'warn',
  approved: 'ok', rejected: 'danger', skipped: 'warn',
  VERIFIED: 'ok', UNKNOWN: 'warn', verified: 'ok', low: 'warn', missing_oem: 'warn', complete: 'ok',
  owner: 'accent', admin: 'accent', manager: 'info', agent: 'info', viewer: 'mock', operator: 'info',
  create: 'ok', update: 'info', delete: 'danger', login: 'mock', logout: 'mock', login_failed: 'danger', simulate: 'accent', handoff: 'warn', sync: 'info', test: 'accent', run: 'info', check: 'info', execute: 'info', route: 'info', send: 'ok', status: 'info', setting: 'info', upsert: 'ok', import: 'info',
  ai: 'info', human: 'accent', auto: 'ok', suggest: 'info', off: 'mock', llm: 'accent', 'engine-173': 'info'
};
export function badge(value, tone) {
  if (value === null || value === undefined || value === '') return h('span', { class: 'badge mock' }, '—');
  return h('span', { class: 'badge ' + (tone || STATUS_TONE[value] || '') }, String(value).replace(/_/g, ' '));
}
export function handlerBadge(handler) { return handler === 'human' ? badge('Human', 'accent') : badge('AI', 'info'); }

export function fmtDate(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d)) return String(v);
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
export function relTime(v) {
  if (!v) return '—';
  const d = new Date(v); if (isNaN(d)) return String(v);
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  if (s < 7 * 86400) return Math.round(s / 86400) + ' d ago';
  return fmtDate(v);
}
export function fmtNum(v, scale) {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  return isNaN(n) ? String(v) : n.toLocaleString(undefined, { minimumFractionDigits: scale || 0, maximumFractionDigits: scale === undefined ? 2 : scale });
}
export function fmtMoney(v, cur) { return v === null || v === undefined ? '—' : fmtNum(v, 2) + ' ' + (cur || ''); }
export function hostOf(url) { if (!url) return '—'; try { return new URL(url).host; } catch (e) { return String(url); } }
export function skeletonRows(n) { return h('div', { class: 'skeleton-block', 'aria-busy': 'true' }, Array.from({ length: n || 6 }, () => h('div', { class: 'skeleton h-row' }))); }
export function empty(title, text, action) { return h('div', { class: 'empty' }, h('strong', {}, title), text ? h('span', {}, text) : null, action || null); }
export function errorBox(err, retry) {
  const notReady = err && err.status === 404 && (err.error === 'not_found' || !err.error);
  const msg = notReady ? 'This part of the backend is not available on this server yet (404). The page degrades until the endpoint is deployed.' : (err && (err.detail || err.message)) || 'Something went wrong.';
  return h('div', { class: 'notice ' + (notReady ? 'warn' : 'danger') }, h('strong', {}, notReady ? 'Not available yet. ' : 'Could not load. '), msg, err && err.requestId ? h('span', { class: 'dim' }, ' (request ' + err.requestId + ')') : null, retry ? h('div', { class: 'notice-actions' }, h('button', { class: 'btn btn-sm btn-secondary', type: 'button', onClick: retry }, 'Retry')) : null);
}
export function json(obj) { return h('pre', { class: 'json' }, obj === null || obj === undefined ? '—' : JSON.stringify(obj, null, 2)); }
export function kv(pairs) {
  const dl = h('dl', { class: 'kv' });
  pairs.forEach(([k, v, cls]) => { dl.appendChild(h('dt', {}, k)); dl.appendChild(h('dd', { class: cls || '' }, v === null || v === undefined || v === '' ? '—' : v)); });
  return dl;
}

/* View header: kicker + title + description + actions. */
export function pageHead(kicker, title, text, actions) {
  return h('div', { class: 'view-head' }, h('div', {}, kicker ? h('div', { class: 'view-kicker' }, kicker) : null, h('h2', {}, title), text ? h('p', {}, text) : null), actions && actions.length ? h('div', { class: 'view-actions' }, actions) : null);
}
export function cardHead(title, actions) { return h('div', { class: 'card-head' }, h('h3', {}, title), actions ? h('div', { class: 'view-actions' }, actions) : null); }

/* Tabs: items [{ key, label, count? }]. Returns { el, set(key, silent) }. */
export function tabs(items, active, onChange) {
  const el = h('div', { class: 'tabs', role: 'tablist' });
  const btns = {};
  items.forEach((t) => {
    btns[t.key] = h('button', { type: 'button', role: 'tab', 'aria-selected': t.key === active ? 'true' : 'false', onClick: () => set(t.key) }, t.label, t.count !== undefined && t.count !== null ? h('span', { class: 'tab-count' }, String(t.count)) : null);
    el.appendChild(btns[t.key]);
  });
  function set(key, silent) { Object.keys(btns).forEach((k) => btns[k].setAttribute('aria-selected', k === key ? 'true' : 'false')); if (!silent && onChange) onChange(key); }
  function count(key, n) { const b = btns[key]; if (!b) return; let c = b.querySelector('.tab-count'); if (!c) { c = h('span', { class: 'tab-count' }); b.appendChild(c); } c.textContent = String(n); }
  return { el, set, count };
}

/* Switch: a labelled checkbox rendered as a toggle. onChange(checked) may return a promise; the
   control is disabled while it runs and reverted on failure. */
export function switchInput({ checked, disabled, label, onChange, title, small }) {
  const input = h('input', { type: 'checkbox', role: 'switch', 'aria-checked': checked ? 'true' : 'false', disabled: disabled || undefined });
  input.checked = !!checked;
  const el = h('label', { class: 'switch' + (small ? ' sm' : '') + (disabled ? ' disabled' : ''), title: title || undefined }, input, h('span', { class: 'track', 'aria-hidden': 'true' }), label ? h('span', { class: 'switch-label' }, label) : null);
  input.addEventListener('change', async () => {
    input.setAttribute('aria-checked', input.checked ? 'true' : 'false');
    if (!onChange) return;
    input.disabled = true;
    try { await onChange(input.checked); } catch (e) { input.checked = !input.checked; input.setAttribute('aria-checked', input.checked ? 'true' : 'false'); toast(e && (e.detail || e.message) || 'Change failed.', 'danger', 5000); }
    finally { input.disabled = !!disabled; }
  });
  return el;
}

/* A field-driven dialog form. fields: [{ name, label, type: text|textarea|select|checkbox|number|json|multiselect|password, value, options: [{value,label}]|[string], required, help, placeholder, rows, mono, min, max, step, full }].
   Resolves with onSubmit's result, or null when cancelled. onSubmit throwing keeps the dialog open and shows the error. */
export function dialogForm({ title, intro, fields, submitLabel, danger, wide, onSubmit }) {
  return new Promise((resolve) => {
    const dlg = document.getElementById('dialog');
    clear(dlg);
    dlg.classList.toggle('wide', !!wide);
    const controls = {};
    const errs = h('p', { class: 'error', role: 'alert', hidden: true });
    const form = h('form', { class: 'dialog-form', novalidate: true, autocomplete: 'off' });
    const grid = h('div', { class: 'field-row' });
    fields.forEach((f) => {
      const id = 'd-' + f.name;
      let c;
      const opts = (f.options || []).map((o) => typeof o === 'string' ? { value: o, label: o.replace(/_/g, ' ') } : o);
      switch (f.type) {
        case 'textarea': c = h('textarea', { id, class: 'textarea' + (f.mono ? ' mono' : ''), rows: f.rows || 4, placeholder: f.placeholder }); c.value = f.value === undefined || f.value === null ? '' : f.value; break;
        case 'json': c = h('textarea', { id, class: 'textarea mono', rows: f.rows || 5, spellcheck: 'false', placeholder: f.placeholder || '{}' }); c.value = f.value === undefined || f.value === null ? '' : (typeof f.value === 'string' ? f.value : JSON.stringify(f.value, null, 2)); break;
        case 'select': c = h('select', { id, class: 'select' }, f.required ? null : h('option', { value: '' }, f.placeholder || '—'), opts.map((o) => h('option', { value: o.value, selected: String(o.value) === String(f.value) || undefined }, o.label))); break;
        case 'multiselect': c = h('select', { id, class: 'select multi', multiple: true, size: Math.min(8, Math.max(3, opts.length)) }, opts.map((o) => h('option', { value: o.value, selected: Array.isArray(f.value) && f.value.includes(o.value) || undefined }, o.label))); break;
        case 'checkbox': c = h('input', { id, type: 'checkbox' }); c.checked = !!f.value; break;
        case 'number': c = h('input', { id, class: 'input', type: 'number', min: f.min, max: f.max, step: f.step || 'any', placeholder: f.placeholder }); c.value = f.value === undefined || f.value === null ? '' : f.value; break;
        case 'password': c = h('input', { id, class: 'input', type: 'password', autocomplete: 'new-password', placeholder: f.placeholder }); break;
        default: c = h('input', { id, class: 'input' + (f.mono ? ' mono' : ''), type: 'text', placeholder: f.placeholder, maxlength: f.maxLength }); c.value = f.value === undefined || f.value === null ? '' : f.value;
      }
      controls[f.name] = c;
      const wrap = h('div', { class: 'field' + (f.full || f.type === 'textarea' || f.type === 'json' || f.type === 'multiselect' ? ' full' : '') });
      if (f.type === 'checkbox') wrap.appendChild(h('label', { class: 'check', for: id }, c, f.label));
      else { wrap.appendChild(h('label', { for: id }, f.label, f.required ? h('span', { class: 'req' }, ' *') : null)); wrap.appendChild(c); }
      if (f.help) wrap.appendChild(h('span', { class: 'hint' }, f.help));
      grid.appendChild(wrap);
    });
    const submit = h('button', { class: 'btn ' + (danger ? 'btn-danger' : 'btn-primary'), type: 'submit' }, submitLabel || 'Save');
    const cancel = h('button', { class: 'btn btn-secondary', type: 'button', onClick: () => { dlg.close(); resolve(null); } }, 'Cancel');
    form.append(grid, errs, h('div', { class: 'dialog-foot' }, cancel, submit));
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); errs.hidden = true;
      const values = {};
      for (const f of fields) {
        const c = controls[f.name];
        let v;
        if (f.type === 'checkbox') v = c.checked;
        else if (f.type === 'multiselect') v = Array.from(c.selectedOptions).map((o) => o.value);
        else if (f.type === 'number') v = c.value === '' ? null : Number(c.value);
        else if (f.type === 'json') { const raw = c.value.trim(); if (!raw) v = f.required ? undefined : null; else { try { v = JSON.parse(raw); } catch (err) { errs.textContent = f.label + ': invalid JSON.'; errs.hidden = false; c.focus(); return; } } }
        else v = c.value;
        if (f.required && (v === '' || v === null || v === undefined || (Array.isArray(v) && !v.length))) { errs.textContent = f.label + ' is required.'; errs.hidden = false; c.focus(); return; }
        values[f.name] = v;
      }
      submit.disabled = true;
      try { const out = await onSubmit(values); dlg.close(); resolve(out === undefined ? values : out); }
      catch (err) { errs.textContent = err && (err.detail || err.message) || 'Failed.'; if (err && err.errors) errs.textContent += ' ' + Object.keys(err.errors).map((k) => k + ': ' + err.errors[k]).join(', '); errs.hidden = false; }
      finally { submit.disabled = false; }
    });
    dlg.appendChild(h('div', { class: 'dialog-body' }, h('h3', {}, title), intro ? (typeof intro === 'string' ? h('p', {}, intro) : intro) : null, form));
    dlg.addEventListener('cancel', () => resolve(null), { once: true });
    dlg.showModal();
    const first = form.querySelector('input:not([type=checkbox]), select, textarea'); if (first) first.focus();
  });
}

/* Right-hand drawer. Returns { body, close, setTitle }. */
export function drawer({ title, body, wide }) {
  const dlg = document.getElementById('drawer');
  clear(dlg);
  dlg.classList.toggle('wide', !!wide);
  const heading = h('h3', {}, title);
  const content = h('div', { class: 'drawer-body' }, body || null);
  const closeBtn = h('button', { class: 'btn btn-ghost btn-icon', type: 'button', 'aria-label': 'Close', onClick: () => dlg.close() }, icon('close'));
  dlg.append(h('div', { class: 'drawer-head' }, heading, closeBtn), content);
  const onClick = (e) => { if (e.target === dlg) dlg.close(); };
  dlg.addEventListener('click', onClick);
  dlg.addEventListener('close', () => dlg.removeEventListener('click', onClick), { once: true });
  if (!dlg.open) dlg.showModal();
  return { body: content, close: () => dlg.close(), setTitle: (t) => { heading.textContent = t; } };
}

/* Copyable code block. */
export function codeBlock(text, label) {
  const pre = h('pre', { class: 'code' }, text);
  const btn = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'aria-label': 'Copy ' + (label || 'to clipboard'), onClick: async () => {
    try { await navigator.clipboard.writeText(text); toast('Copied.', 'ok', 1800); } catch (e) { toast('Clipboard unavailable — select the text and copy it.', 'warn'); }
  } }, icon('copy'), 'Copy');
  return h('div', { class: 'code-wrap' }, pre, btn);
}

/* Load data into a box: skeleton → render(data) | errorBox with retry. */
export async function loadInto(box, fetcher, render, rows) {
  clear(box); box.appendChild(skeletonRows(rows || 5));
  let data;
  try { data = await fetcher(); } catch (err) { clear(box); box.appendChild(errorBox(err, () => loadInto(box, fetcher, render, rows))); return null; }
  clear(box);
  try { render(data); } catch (err) { clear(box); box.appendChild(h('div', { class: 'notice danger' }, h('strong', {}, 'Render failed. '), err && err.message ? err.message : String(err))); console.error(err); }
  return data;
}

/* Simple table from columns [{ label, cell(row) → node|string, cls? }] and rows; onRow optional. */
export function simpleTable(columns, rows, opts) {
  const o = opts || {};
  const table = h('table', { class: 'data' + (o.compact ? ' compact' : '') },
    h('thead', {}, h('tr', {}, columns.map((c) => h('th', { scope: 'col', class: c.cls || '' }, c.label)))),
    h('tbody', {}, rows.map((row) => h('tr', { tabindex: o.onRow ? '0' : undefined, class: o.rowClass ? o.rowClass(row) : '', onClick: o.onRow ? () => o.onRow(row) : undefined, onKeydown: o.onRow ? (e) => { if (e.key === 'Enter') o.onRow(row); } : undefined },
      columns.map((c) => { const v = c.cell(row); return h('td', { class: (c.cls || '') + (c.stop ? ' actions' : ''), onClick: c.stop ? (e) => e.stopPropagation() : undefined }, v === null || v === undefined || v === '' ? h('span', { class: 'dim' }, '—') : v); })))));
  return h('div', { class: 'table-wrap' + (o.noScroll ? ' auto' : '') }, table);
}

export function chip(text, cls) { return h('span', { class: 'chip ' + (cls || '') }, text); }
export function dot(state) { return h('span', { class: 'status-dot ' + (STATUS_TONE[state] || ''), title: state || '' }); }
export function qget(query, key, dflt) { const u = new URLSearchParams(query || ''); return u.has(key) ? u.get(key) : (dflt === undefined ? '' : dflt); }
export function setQuery(base, obj) { const u = new URLSearchParams(); Object.keys(obj).forEach((k) => { if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') u.set(k, obj[k]); }); const s = u.toString(); history.replaceState(null, '', base + (s ? '?' + s : '')); }
export function maskPhone(v) { if (!v) return '—'; const s = String(v); return s.startsWith('***') ? s : '***' + s.replace(/\D/g, '').slice(-4); }
export function roleNote(ctx, role, what) { return ctx.can(role) ? null : h('p', { class: 'dim role-note' }, (what || 'This action') + ' requires the ' + role + ' role.'); }
