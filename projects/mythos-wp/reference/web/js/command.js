/* MYTHOS WP — command menu (Ctrl/⌘ K): navigation + global search. */
import { h, clear } from './ui.js';
import { api } from './api.js';

export function commandMenu(ctx) {
  const dlg = document.getElementById('cmd');
  let items = [], selected = 0, timer = null;
  const input = h('input', { class: 'input', type: 'search', placeholder: 'Type a command or search parts, vehicles, knowledge, handoffs…', 'aria-label': 'Command' });
  const list = h('div', { class: 'cmd-list', role: 'listbox' });
  dlg.append(input, list);

  function navItems(q) {
    const nav = ctx.navEntries().filter((n) => !n.planned);
    const ql = q.toLowerCase();
    return nav.filter((n) => !ql || n.label.toLowerCase().includes(ql)).slice(0, 8).map((n) => ({ group: 'Go to', title: n.label, sub: n.group, route: n.route }));
  }
  function actionItems(q) {
    const acts = [
      { title: 'New part', sub: 'Catalogue', route: '#/r/products/new' },
      { title: 'New knowledge entry', sub: 'Auto-Reply', route: '#/r/knowledge/new' },
      { title: 'New handoff (manual)', sub: 'Handoff', route: '#/r/handoffs/new' },
      { title: 'Simulate a customer message', sub: 'Auto-Reply', route: '#/autoreply' },
      { title: 'Toggle theme', sub: 'Display', run: () => ctx.toggleTheme() },
      { title: 'Sign out', sub: 'Session', run: () => ctx.signOut() }
    ];
    const ql = q.toLowerCase();
    return acts.filter((a) => !ql || a.title.toLowerCase().includes(ql)).map((a) => Object.assign({ group: 'Actions' }, a));
  }
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
    selected = 0; render();
    if (q.length >= 2 && ctx.project()) {
      try {
        const res = await api.get('/api/search' + api.qs({ project: ctx.project(), q }));
        if (input.value.trim() !== q) return;
        res.groups.forEach((g) => g.items.forEach((it) => items.push({ group: g.label, title: it.title, sub: it.sub, route: it.route })));
        render();
      } catch (e) { /* search is best-effort */ }
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
  document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); dlg.open ? close() : open(); } });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
  return { open, close };
}
