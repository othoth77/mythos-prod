/* MYTHOS WP — WhatsApp contacts: list + record (identity, tags, notes, conversations). */
import { h, clear, badge, fmtDate, skeletonRows, errorBox, empty, toast } from '../ui.js';

export async function render(main, params, query, ctx) {
  const project = ctx.project();
  ctx.crumbs([{ label: 'Contacts' }]);
  if (!project) { main.appendChild(empty('Select a project')); return; }
  const base = '/api/projects/' + project + '/comms';
  main.appendChild(h('div', { class: 'view-head' }, h('div', {}, h('div', { class: 'view-kicker' }, 'WhatsApp'), h('h2', {}, 'Contacts'), h('p', {}, 'Customers known to this project through their WhatsApp number. Numbers are masked in the list.'))));
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Search name or number', 'aria-label': 'Search contacts' });
  main.appendChild(h('div', { class: 'toolbar' }, search));
  const box = h('div', { class: 'stack' }); main.appendChild(box);
  let t = null; search.oninput = () => { clearTimeout(t); t = setTimeout(load, 250); };
  async function load() {
    clear(box); box.appendChild(skeletonRows(6));
    let r; try { r = await ctx.api.get(base + '/contacts' + ctx.api.qs({ q: search.value.trim() })); } catch (err) { clear(box); box.appendChild(errorBox(err)); return; }
    clear(box);
    if (!r.items.length) { box.appendChild(empty('No contact yet.')); return; }
    const table = h('table', { class: 'table' }, h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Number'), h('th', {}, 'Language'), h('th', {}, 'Status'), h('th', {}, 'Conversations'), h('th', {}, 'Tags'), h('th', {}, 'Last seen'))));
    const tb = h('tbody'); table.appendChild(tb);
    r.items.forEach((k) => tb.appendChild(h('tr', { onClick: () => { location.hash = '#/contacts/' + k.id; } , style: 'cursor:pointer' }, h('td', {}, h('a', { href: '#/contacts/' + k.id }, k.display_name || '—')), h('td', {}, k.wa_masked), h('td', {}, k.language || '—'), h('td', {}, badge(k.status, k.status === 'active' ? 'ok' : 'warn')), h('td', {}, String(k.conversations)), h('td', {}, ...k.tags.map((x) => h('span', { class: 'chip' }, x))), h('td', {}, fmtDate(k.last_seen_at)))));
    box.appendChild(h('div', { class: 'table-wrap' }, table));
  }
  await load();
}

export async function renderOne(main, params, query, ctx) {
  const project = ctx.project();
  if (!project) { main.appendChild(empty('Select a project')); return; }
  const base = '/api/projects/' + project + '/comms';
  const id = parseInt(params.id, 10);
  ctx.crumbs([{ label: 'Contacts', route: '#/contacts' }, { label: '#' + id }]);
  const box = h('div', { class: 'stack' }, skeletonRows(6)); main.appendChild(box);
  let k, tags; try { [k, tags] = await Promise.all([ctx.api.get(base + '/contacts/' + id), ctx.api.get(base + '/tags')]); } catch (err) { clear(box); box.appendChild(errorBox(err)); return; }
  clear(box);
  main.insertBefore(h('div', { class: 'view-head' }, h('div', {}, h('div', { class: 'view-kicker' }, 'Contact'), h('h2', {}, k.display_name || k.wa_masked), h('p', {}, k.wa_masked + (k.lid ? ' · LID known' : '') + ' · first seen ' + fmtDate(k.first_seen_at) + ' · last seen ' + fmtDate(k.last_seen_at)))), box);
  const grid = h('div', { class: 'grid cols-2' }); box.appendChild(grid);
  const name = h('input', { class: 'input', value: k.display_name || '', 'aria-label': 'Name' });
  const lang = h('select', { class: 'input', 'aria-label': 'Language' }, h('option', { value: '' }, '—'), ...['fr', 'ar', 'en'].map((l) => h('option', { value: l, selected: k.language === l }, l)));
  const status = h('select', { class: 'input', 'aria-label': 'Status' }, ...['active', 'blocked'].map((s) => h('option', { value: s, selected: k.status === s }, s)));
  const notes = h('textarea', { class: 'textarea', rows: 4 }, k.notes || '');
  const editable = ctx.can('operator');
  [name, lang, status, notes].forEach((el) => { if (!editable) el.disabled = true; });
  grid.appendChild(h('div', { class: 'card' }, h('h3', {}, 'Identity'), h('div', { class: 'field' }, h('label', {}, 'Name'), name), h('div', { class: 'field' }, h('label', {}, 'Language'), lang), h('div', { class: 'field' }, h('label', {}, 'Status'), status), h('div', { class: 'field' }, h('label', {}, 'Notes (internal)'), notes),
    editable ? h('button', { class: 'btn btn-primary btn-sm', onClick: async () => { try { await ctx.api.patch(base + '/contacts/' + id, { display_name: name.value.trim() || null, language: lang.value || null, status: status.value, notes: notes.value }); toast('Contact saved', 'ok'); } catch (err) { toast(err.detail || 'save failed', 'danger'); } } }, 'Save') : null,
    h('div', { class: 'kv' }, h('div', {}, 'Source'), h('div', {}, k.source), h('div', {}, 'Memory'), h('div', {}, h('code', {}, JSON.stringify(k.memory || {}).slice(0, 300))))));
  const tagSel = h('select', { class: 'input', 'aria-label': 'Add tag' }, h('option', { value: '' }, 'add tag…'), ...tags.filter((tg) => !k.tags.some((x) => x.id === tg.id)).map((tg) => h('option', { value: String(tg.id) }, tg.name)));
  tagSel.onchange = async () => { if (!tagSel.value) return; try { await ctx.api.post(base + '/contacts/' + id + '/tags/' + tagSel.value, {}); renderAgain(); } catch (err) { toast(err.detail || 'tag failed', 'danger'); } };
  grid.appendChild(h('div', { class: 'card' }, h('h3', {}, 'Tags'), h('div', { class: 'chips' }, ...k.tags.map((tg) => h('button', { class: 'chip', disabled: !editable, onClick: async () => { try { await ctx.api.del(base + '/contacts/' + id + '/tags/' + tg.id); renderAgain(); } catch (err) { toast(err.detail || 'failed', 'danger'); } } }, tg.name + (editable ? ' ×' : '')))), editable ? tagSel : null,
    h('h3', {}, 'Conversations'), k.conversations.length ? h('ul', {}, ...k.conversations.map((c) => h('li', {}, h('a', { href: '#/inbox/' + c.id }, '#' + c.id + ' · ' + c.status.replace(/_/g, ' ') + ' · ' + fmtDate(c.last_message_at || c.created_at)), c.unread_count ? ' · ' + c.unread_count + ' unread' : ''))) : h('p', { class: 'dim' }, 'No conversation.')));
  function renderAgain() { clear(main); renderOne(main, params, query, ctx); }
}
