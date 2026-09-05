/* MYTHOS WP — generic record editor driven by a resource definition.
   Client-side validation uses the SAME validate.js the server runs; the
   server remains the boundary and its field errors are shown in place.
   Unsaved changes are guarded (beforeunload + in-app navigation). */
import { h, clear, badge, fmtDate, toast } from './ui.js';
import { ApiError } from './api.js';

const V = window.MythosWPValidate;
export let dirtyGuard = { dirty: false, message: 'You have unsaved changes.' };
window.addEventListener('beforeunload', (e) => { if (dirtyGuard.dirty) { e.preventDefault(); e.returnValue = ''; } });

function control(f, value, ctx) {
  const id = 'f-' + f.name;
  const common = { id, name: f.name, 'aria-describedby': id + '-hint' };
  let el;
  switch (f.type) {
    case 'textarea': el = h('textarea', Object.assign({ class: 'textarea' }, common)); el.value = value === null || value === undefined ? '' : value; break;
    case 'json': el = h('textarea', Object.assign({ class: 'textarea mono', spellcheck: 'false' }, common)); el.value = value === null || value === undefined ? '' : (typeof value === 'string' ? value : JSON.stringify(value, null, 2)); break;
    case 'boolean': el = h('input', Object.assign({ type: 'checkbox' }, common)); el.checked = !!value; break;
    case 'enum': el = h('select', Object.assign({ class: 'select' }, common), f.required ? null : h('option', { value: '' }, '—'), (f.enum || []).map((o) => h('option', { value: o, selected: value === o || undefined }, String(o).replace(/_/g, ' ')))); break;
    case 'integer': case 'number': el = h('input', Object.assign({ class: 'input', type: 'number', step: f.type === 'integer' ? '1' : (f.scale ? String(Math.pow(10, -f.scale)) : 'any'), min: f.min, max: f.max, inputmode: 'decimal' }, common)); el.value = value === null || value === undefined ? '' : value; break;
    case 'timestamp': el = h('input', Object.assign({ class: 'input', type: 'datetime-local', step: '1' }, common)); el.value = value ? toLocalInput(value) : ''; break;
    case 'tags': el = h('input', Object.assign({ class: 'input', placeholder: 'comma, separated' }, common)); el.value = Array.isArray(value) ? value.join(', ') : (value === null || value === undefined ? '' : value); break;
    default: el = h('input', Object.assign({ class: 'input' + (/reference|uid|url|key/.test(f.name) ? ' mono' : ''), type: 'text', maxlength: f.maxLength }, common)); el.value = value === null || value === undefined ? '' : value;
  }
  if (f.ref && ctx && ctx.lookup) return refControl(f, el, ctx);
  return el;
}
function toLocalInput(iso) { const d = new Date(iso); if (isNaN(d)) return ''; const p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()); }
function fromLocalInput(v) { if (!v) return ''; const d = new Date(v); return isNaN(d) ? v : d.toISOString(); }

/* A reference field: the raw id/uid input plus a type-ahead lookup. */
function refControl(f, input, ctx) {
  const wrap = h('div', { class: 'ref-field relative' });
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Find ' + f.ref.resource.replace(/_/g, ' ') + '…', 'aria-label': 'Find ' + f.label });
  const results = h('div', { class: 'ref-results', hidden: true, role: 'listbox' });
  let t = null;
  search.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const q = search.value.trim();
      if (q.length < 2) { results.hidden = true; return; }
      try {
        const rows = await ctx.lookup(f.ref.resource, q, f.ref.display, f.ref.by);
        clear(results);
        if (!rows.length) results.appendChild(h('div', { class: 'cmd-empty' }, 'No match'));
        rows.forEach((row) => results.appendChild(h('button', { type: 'button', role: 'option', onClick: () => { input.value = row.id; input.dispatchEvent(new Event('input', { bubbles: true })); search.value = ''; results.hidden = true; } }, row.label, row.title ? h('small', {}, (row.brand ? row.brand + ' · ' : '') + row.title) : h('small', {}, '#' + row.id))));
        results.hidden = false;
      } catch (e) { results.hidden = true; }
    }, 240);
  });
  document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) results.hidden = true; });
  wrap.append(input, search, results);
  return wrap;
}

function readValue(f, el) {
  const c = el.querySelector ? (el.querySelector('#f-' + f.name) || el) : el;
  if (f.type === 'boolean') return c.checked;
  if (f.type === 'timestamp') return fromLocalInput(c.value);
  return c.value;
}

/* recordForm({ resource, row, mode, onSubmit(payload), onCancel, lookup, hiddenFields }) */
export function recordForm(opts) {
  const r = opts.resource, row = opts.row || {}, mode = opts.mode || (opts.row ? 'update' : 'create');
  const editable = r.fields.filter((f) => !f.virtual && !(f.readonly && mode === 'create') && !(opts.hiddenFields || []).includes(f.name) && !(mode === 'create' && f.name === r.idColumn && (r.idType || 'integer') === 'integer'));
  const bySection = {};
  const sections = r.sections && Object.keys(r.sections).length ? r.sections : { main: r.singular || 'Record' };
  editable.forEach((f) => { const s = f.section && sections[f.section] ? f.section : Object.keys(sections)[0]; (bySection[s] = bySection[s] || []).push(f); });
  const form = h('form', { class: 'record-form', novalidate: true, autocomplete: 'off' });
  const controls = {};
  const errors = {};
  const initial = {};

  Object.keys(sections).forEach((s) => {
    if (!bySection[s]) return;
    const sec = h('section', { class: 'form-section' }, h('h4', {}, sections[s]));
    const grid = h('div', { class: 'field-row' });
    bySection[s].forEach((f) => {
      const ro = f.readonly || (mode === 'update' && f.createOnly);
      const wrapField = h('div', { class: 'field' });
      if (f.type === 'boolean' && !ro) {
        const c = control(f, row[f.name], opts);
        controls[f.name] = c;
        wrapField.appendChild(h('label', { class: 'check', for: 'f-' + f.name }, c, f.label));
      } else {
        wrapField.appendChild(h('label', { for: 'f-' + f.name }, f.label, f.required && !ro ? h('span', { class: 'req' }, ' *') : null));
        if (ro) {
          const v = row[f.name];
          wrapField.appendChild(h('div', { class: 'input mono', 'aria-readonly': 'true', style: undefined }, v === null || v === undefined || v === '' ? '—' : f.type === 'timestamp' ? fmtDate(v) : f.type === 'json' ? JSON.stringify(v) : String(v)));
        } else {
          const c = control(f, row[f.name], opts);
          controls[f.name] = c;
          wrapField.appendChild(c);
        }
      }
      if (f.help) wrapField.appendChild(h('span', { class: 'hint', id: 'f-' + f.name + '-hint' }, f.help));
      errors[f.name] = h('span', { class: 'error', hidden: true });
      wrapField.appendChild(errors[f.name]);
      if (f.type === 'textarea' || f.type === 'json') wrapField.style.gridColumn = '1 / -1';
      grid.appendChild(wrapField);
    });
    sec.appendChild(grid);
    form.appendChild(sec);
  });

  Object.keys(controls).forEach((k) => { initial[k] = JSON.stringify(readValue(r.fields.find((f) => f.name === k), controls[k])); });
  const dirtyNote = h('span', { class: 'dirty', hidden: true }, 'Unsaved changes');
  const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, mode === 'create' ? 'Create ' + (r.singular || 'record').toLowerCase() : 'Save changes');
  const cancel = h('button', { class: 'btn btn-secondary', type: 'button', onClick: () => opts.onCancel && opts.onCancel() }, 'Cancel');
  form.appendChild(h('div', { class: 'form-foot' }, dirtyNote, cancel, submit));

  function payload() {
    const out = {};
    Object.keys(controls).forEach((k) => {
      const f = r.fields.find((x) => x.name === k);
      const v = readValue(f, controls[k]);
      if (mode === 'update' && JSON.stringify(v) === initial[k]) return;
      out[k] = v;
    });
    return out;
  }
  function checkDirty() { const d = Object.keys(payload()).length > 0; dirtyGuard.dirty = d && mode === 'update' ? true : (mode === 'create' ? Object.values(payload()).some((v) => v !== '' && v !== false) : false); dirtyNote.hidden = !dirtyGuard.dirty; }
  form.addEventListener('input', checkDirty);
  form.addEventListener('change', checkDirty);

  function showErrors(errs) {
    Object.keys(errors).forEach((k) => { errors[k].hidden = true; const c = controls[k]; if (c) (c.querySelector ? (c.querySelector('#f-' + k) || c) : c).removeAttribute('aria-invalid'); });
    let first = null;
    Object.keys(errs || {}).forEach((k) => {
      if (!errors[k]) { toast(k + ': ' + V.message(errs[k]), 'danger'); return; }
      errors[k].textContent = V.message(errs[k]) + (errs[k] === 'before_collected' ? ' Last checked must not precede collected.' : errs[k] === 'before_year_from' ? ' Year to must not precede year from.' : '');
      errors[k].hidden = false;
      const c = controls[k]; const target = c && (c.querySelector ? (c.querySelector('#f-' + k) || c) : c); if (target) { target.setAttribute('aria-invalid', 'true'); if (!first) first = target; }
    });
    if (first) first.focus();
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const p = payload();
    if (mode === 'update' && !Object.keys(p).length) { toast('Nothing changed.', 'warn'); return; }
    const fieldsForValidation = r.fields.filter((f) => !f.readonly && !f.virtual && !(mode === 'update' && f.createOnly));
    const v = V.validate(fieldsForValidation, p, mode);
    if (!v.ok) { showErrors(v.errors); return; }
    submit.disabled = true;
    try {
      await opts.onSubmit(v.value);
      dirtyGuard.dirty = false;
    } catch (err) {
      if (err instanceof ApiError && err.errors) showErrors(err.errors);
      else if (err instanceof ApiError && err.error === 'conflict') toast('A record with the same unique value already exists' + (err.constraint ? ' (' + err.constraint + ')' : '') + '.', 'danger', 6000);
      else if (err instanceof ApiError && err.error === 'constraint') toast('Rejected by a data constraint' + (err.constraint ? ': ' + err.constraint : '') + '.', 'danger', 6000);
      else if (err instanceof ApiError && err.error === 'referenced') toast('The referenced record does not exist, or this record is still referenced.', 'danger', 6000);
      else if (err instanceof ApiError && err.status === 403) toast('Not allowed: ' + (err.detail || 'insufficient role'), 'danger');
      else toast(err.detail || err.message || 'Save failed.', 'danger');
    } finally { submit.disabled = false; }
  });

  return { el: form, focus: () => { const f = form.querySelector('input:not([type=checkbox]), select, textarea'); if (f) f.focus(); }, showErrors };
}

export function fieldBadge(f, v) { return f.type === 'enum' || f.name === 'status' ? badge(v) : v; }
