/* MYTHOS WP — generic data table driven by a resource definition.
   Server-side pagination, search, sort and filters; the query state lives in
   the URL hash so a view is shareable and the back button works; column
   visibility is a per-browser preference (localStorage). */
import { h, clear, icon, badge, fmtDate, fmtNum, skeletonRows, empty, errorBox } from './ui.js';
import { api } from './api.js';

const PREF_KEY = 'mythos-wp:cols:';
function loadCols(key) { try { const v = localStorage.getItem(PREF_KEY + key); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
function saveCols(key, cols) { try { localStorage.setItem(PREF_KEY + key, JSON.stringify(cols)); } catch (e) { /* preference only */ } }

export function cellValue(field, row) {
  const v = row[field.name];
  if (v === null || v === undefined || v === '') return { node: h('span', { class: 'dim' }, '—'), cls: 'dim' };
  if (field.render === 'image') return { node: h('img', { class: 'thumb', src: v, alt: '', loading: 'lazy' }) };
  switch (field.type) {
    case 'boolean': return { node: badge(v ? 'yes' : 'no', v ? 'ok' : 'mock') };
    case 'enum': return { node: badge(v) };
    case 'timestamp': return { node: fmtDate(v), cls: 'mono dim' };
    case 'number': return { node: fmtNum(v, field.scale === undefined ? 2 : field.scale), cls: 'num' };
    case 'integer': return { node: fmtNum(v, 0), cls: 'num' };
    case 'json': return { node: h('span', { class: 'dim' }, typeof v === 'object' ? Object.keys(v).length + ' keys' : String(v)) };
    case 'tags': return { node: h('span', {}, (Array.isArray(v) ? v : []).map((t) => badge(t, 'mock'))) };
    default: {
      const s = String(v);
      if (field.name === 'status' || field.name === 'availability') return { node: badge(s) };
      return { node: s, cls: /reference|uid|_id$|key/.test(field.name) ? 'mono' : '' };
    }
  }
}

/* options: { resource, fetchPage(query) → {rows,total,page,limit,sort,dir}, columns?: [field], onRow(row),
              rowActions?(row) → [node], state: {page,q,sort,dir,filters}, onState(state), title, extraToolbar?: [node] } */
export function dataTable(opts) {
  const r = opts.resource;
  const allCols = (opts.columns || r.fields.filter((f) => f.listed));
  let visible = loadCols(opts.prefKey || r.key) || allCols.map((f) => f.name);
  const state = Object.assign({ page: 1, q: '', sort: r.defaultSort.field, dir: r.defaultSort.dir, filters: {} }, opts.state || {});
  const root = h('div', { class: 'table-view' });
  const toolbar = h('div', { class: 'toolbar' });
  const wrap = h('div', { class: 'table-wrap' });
  const foot = h('div', { class: 'table-foot' });
  root.append(toolbar, wrap, foot);
  let debounce = null;
  let lastRows = [];

  function set(patch) { Object.assign(state, patch); if (!('page' in patch)) state.page = 1; opts.onState && opts.onState(state); load(); }

  function buildToolbar() {
    clear(toolbar);
    const search = h('input', { class: 'input', type: 'search', placeholder: 'Search ' + (r.search || []).slice(0, 3).join(', ') + '…', value: state.q || '', 'aria-label': 'Search' });
    search.addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(() => set({ q: search.value.trim() }), 280); });
    toolbar.appendChild(h('div', { class: 'search' }, icon('search'), search));
    (r.filters || []).forEach((f) => {
      if (f.kind === 'flag') {
        const lab = h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: state.filters[f.name] === 'true' || undefined, onChange: (e) => { const fl = Object.assign({}, state.filters); if (e.target.checked) fl[f.name] = 'true'; else delete fl[f.name]; set({ filters: fl }); } }), f.label);
        toolbar.appendChild(lab); return;
      }
      if (f.enum) {
        const sel = h('select', { class: 'select', 'aria-label': f.label, onChange: (e) => { const fl = Object.assign({}, state.filters); if (e.target.value) fl[f.name] = e.target.value; else delete fl[f.name]; set({ filters: fl }); } }, h('option', { value: '' }, f.label + ': all'), f.enum.map((v) => h('option', { value: v, selected: state.filters[f.name] === v || undefined }, String(v).replace(/_/g, ' '))));
        toolbar.appendChild(sel);
      }
    });
    const active = Object.keys(state.filters).filter((k) => { const f = r.filters.find((x) => x.name === k); return f && !f.enum && f.kind !== 'flag'; });
    if (active.length) toolbar.appendChild(h('div', { class: 'chips' }, active.map((k) => h('span', { class: 'chip' }, k + ' = ' + state.filters[k], h('button', { type: 'button', 'aria-label': 'Remove filter', onClick: () => { const fl = Object.assign({}, state.filters); delete fl[k]; set({ filters: fl }); } }, '×')))));
    toolbar.appendChild(h('div', { class: 'spacer' }));
    (opts.extraToolbar || []).forEach((n) => toolbar.appendChild(n));
    // column chooser
    const colsWrap = h('div', { class: 'relative' });
    const menu = h('div', { class: 'cols-menu', hidden: true });
    allCols.forEach((f) => {
      const cb = h('input', { type: 'checkbox', checked: visible.includes(f.name) || undefined, onChange: (e) => { visible = e.target.checked ? allCols.filter((x) => visible.includes(x.name) || x.name === f.name).map((x) => x.name) : visible.filter((n) => n !== f.name); saveCols(opts.prefKey || r.key, visible); render(lastRows); } });
      menu.appendChild(h('label', {}, cb, f.label));
    });
    const btn = h('button', { class: 'btn btn-secondary btn-sm', type: 'button', 'aria-haspopup': 'true', onClick: () => { menu.hidden = !menu.hidden; } }, icon('columns'), 'Columns');
    document.addEventListener('click', (e) => { if (!colsWrap.contains(e.target)) menu.hidden = true; });
    colsWrap.append(btn, menu);
    toolbar.appendChild(colsWrap);
  }

  function render(rows) {
    lastRows = rows;
    clear(wrap);
    if (!rows.length) { wrap.appendChild(empty('No records', state.q || Object.keys(state.filters).length ? 'Nothing matches the current search or filters.' : 'This list is empty.', opts.emptyAction || null)); return; }
    const cols = allCols.filter((f) => visible.includes(f.name));
    const thead = h('thead', {}, h('tr', {}, cols.map((f) => {
      const sortable = f.sortable || f.name === r.defaultSort.field;
      const th = h('th', { class: (f.type === 'number' || f.type === 'integer' ? 'num ' : '') + (sortable ? 'sortable' : ''), scope: 'col', 'aria-sort': state.sort === f.name ? (state.dir === 'asc' ? 'ascending' : 'descending') : undefined, onClick: sortable ? () => set({ sort: f.name, dir: state.sort === f.name && state.dir === 'asc' ? 'desc' : 'asc', page: 1 }) : undefined }, f.label, state.sort === f.name ? h('span', { class: 'dir' }, state.dir === 'asc' ? '▲' : '▼') : null);
      return th;
    }), opts.rowActions ? h('th', { scope: 'col', class: 'actions' }, h('span', { class: 'sr-only' }, 'Actions')) : null));
    const tbody = h('tbody', {}, rows.map((row) => {
      const tr = h('tr', { tabindex: '0', onClick: () => opts.onRow && opts.onRow(row), onKeydown: (e) => { if (e.key === 'Enter') opts.onRow && opts.onRow(row); } }, cols.map((f) => { const c = cellValue(f, row); return h('td', { class: c.cls || '' }, c.node); }));
      if (opts.rowActions) tr.appendChild(h('td', { class: 'actions', onClick: (e) => e.stopPropagation() }, opts.rowActions(row)));
      return tr;
    }));
    wrap.appendChild(h('table', { class: 'data' }, thead, tbody));
  }

  function renderFoot(page) {
    clear(foot);
    const pages = Math.max(1, Math.ceil(page.total / page.limit));
    foot.append(
      h('span', {}, page.total.toLocaleString() + ' record' + (page.total === 1 ? '' : 's'), state.q ? ' matching "' + state.q + '"' : ''),
      h('div', { class: 'pager' },
        h('select', { class: 'select', 'aria-label': 'Rows per page', onChange: (e) => set({ limit: parseInt(e.target.value, 10), page: 1 }) }, [25, 50, 100].map((n) => h('option', { value: n, selected: (state.limit || 25) === n || undefined }, n + ' / page'))),
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', disabled: page.page <= 1 || undefined, onClick: () => set({ page: page.page - 1 }) }, '‹ Prev'),
        h('span', { class: 'page' }, page.page + ' / ' + pages),
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', disabled: page.page >= pages || undefined, onClick: () => set({ page: page.page + 1 }) }, 'Next ›'))
    );
  }

  async function load() {
    clear(wrap); wrap.appendChild(skeletonRows(8)); clear(foot);
    try {
      const page = await opts.fetchPage({ page: state.page, limit: state.limit || 25, sort: state.sort, dir: state.dir, q: state.q, filters: state.filters });
      render(page.rows); renderFoot(page);
    } catch (err) { clear(wrap); wrap.appendChild(errorBox(err, load)); }
  }

  buildToolbar();
  load();
  return { el: root, reload: load, state };
}

/* Query-string helpers for a resource list: state ↔ hash query. */
export function stateFromQuery(qs) {
  const u = new URLSearchParams(qs || '');
  const st = { page: parseInt(u.get('page') || '1', 10) || 1, q: u.get('q') || '', filters: {} };
  if (u.get('sort')) st.sort = u.get('sort');
  if (u.get('dir')) st.dir = u.get('dir');
  if (u.get('limit')) st.limit = parseInt(u.get('limit'), 10);
  u.forEach((v, k) => { if (k.startsWith('f.')) st.filters[k.slice(2)] = v; });
  return st;
}
export function queryFromState(st) {
  const u = new URLSearchParams();
  if (st.page > 1) u.set('page', st.page);
  if (st.q) u.set('q', st.q);
  if (st.sort) u.set('sort', st.sort);
  if (st.dir) u.set('dir', st.dir);
  if (st.limit && st.limit !== 25) u.set('limit', st.limit);
  Object.keys(st.filters || {}).forEach((k) => u.set('f.' + k, st.filters[k]));
  return u.toString();
}
export function apiQuery(st, extra) {
  const o = Object.assign({ page: st.page, limit: st.limit, sort: st.sort, dir: st.dir, q: st.q }, extra || {});
  Object.keys(st.filters || {}).forEach((k) => { o['f.' + k] = st.filters[k]; });
  return api.qs(o);
}
