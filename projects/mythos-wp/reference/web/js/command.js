/* MYTHOS Control Center — command menu (Ctrl/⌘ K): navigation, actions, global search. */
import { h, clear, toast } from './ui.js';
import { api } from './api.js';

const GROUPS = ['projects', 'conversations', 'contacts'];
export function commandMenu(ctx) {
  const dlg = document.getElementById('cmd');
  let items = [], selected = 0, timer = null;
  const input = h('input', { class: 'input', type: 'search', placeholder: 'Search projects, conversations, contacts — or type a command', 'aria-label': 'Command or search' });
  const list = h('div', { class: 'cmd-list', role: 'listbox' });
  const status = h('div', { class: 'cmd-status', 'aria-live': 'polite' });
  dlg.append(input, list, status);

  function navItems(q) {
    const ql = q.toLowerCase();
    return ctx.navEntries().filter((n) => !ql || n.label.toLowerCase().includes(ql)).slice(0, 8).map((n) => ({ group: 'Go to', title: n.label, sub: 'Navigation', route: n.route }));
  }
  function actionItems(q) {
    const acts = [
      { title: 'New project', sub: 'Projects', route: '#/projects/new', role: 'admin' },
      { title: 'Sync WhatsApp numbers', sub: 'WhatsApp', role: 'admin', run: async () => { try { const r = await api.post('/api/whatsapp/numbers/sync', {}); ctxToast('Synced: ' + (r.discovered || 0) + ' found, ' + (r.created || 0) + ' new, ' + (r.updated || 0) + ' updated.', 'ok'); location.hash = '#/whatsapp'; } catch (e) { ctxToast(e.detail || 'Sync failed.', 'danger'); } } },
      { title: 'Toggle theme', sub: 'Display', run: () => ctx.toggleTheme() },
      { title: 'Sign out', sub: 'Session', run: () => ctx.signOut() }
    ];
    const ql = q.toLowerCase();
    return acts.filter((a) => (!a.role || ctx.can(a.role)) && (!ql || a.title.toLowerCase().includes(ql))).map((a) => Object.assign({ group: 'Actions' }, a));
  }
  function ctxToast(msg, kind) { toast(msg, kind); }
  function render() {
    clear(list);
    if (!items.length) { list.appendChild(h('div', { class: 'cmd-empty' }, 'No results')); return; }
    let lastGroup = null;
    items.forEach((it, i) => {
      if (it.group !== lastGroup) { list.appendChild(h('div', { class: 'cmd-group' }, it.group)); lastGroup = it.group; }
      list.appendChild(h('button', { class: 'cmd-item', type: 'button', role: 'option', 'aria-selected': i === selected ? 'true' : 'false', onClick: () => run(it), onMouseenter: () => { selected = i; render(); } }, h('span', {}, it.title), h('small', {}, it.sub || '')));
    });
    const sel = list.querySelector('[aria-selected="true"]'); if (sel) sel.scrollIntoView({ block: 'nearest' });
  }
  async function update() {
    const q = input.value.trim();
    items = navItems(q).concat(actionItems(q));
    selected = 0; render(); status.textContent = '';
    if (q.length >= 2) {
      status.textContent = 'Searching…';
      try {
        const res = await api.get('/api/search' + api.qs({ project: ctx.project(), q }));
        if (input.value.trim() !== q) return;
        (res.groups || []).filter((g) => GROUPS.includes(g.key)).forEach((g) => (g.items || []).forEach((it) => items.push({ group: g.label || g.key, title: it.title, sub: it.sub, route: it.route })));
        status.textContent = items.length ? '' : 'Nothing found';
        render();
      } catch (e) { status.textContent = e && e.status === 404 ? 'Global search is not available on this server yet.' : 'Search unavailable.'; }
    }
  }
  function run(it) { close(); if (it.run) it.run(); else if (it.route) location.hash = it.route.replace(/^#/, ''); }
  function open() { input.value = ''; update(); dlg.showModal(); input.focus(); }
  function close() { if (dlg.open) dlg.close(); }
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(update, 160); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); selected = Math.min(items.length - 1, selected + 1); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); selected = Math.max(0, selected - 1); render(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (items[selected]) run(items[selected]); }
  });
  document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); if (dlg.open) close(); else open(); } });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
  return { open, close };
}
