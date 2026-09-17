/* MYTHOS Control Center — Settings: users (list, create/edit, password,
   project access), business rules link, session (whoami, sign out, theme). */
import { h, clear, badge, fmtDate, relTime, skeletonRows, errorBox, empty, toast, tabs, chip, kv, pageHead, cardHead, simpleTable, dialogForm, confirmDialog, qget, setQuery, roleNote } from '../ui.js';

const TABS = [{ key: 'users', label: 'Users' }, { key: 'rules', label: 'Business rules' }, { key: 'session', label: 'Session' }];
const ROLES = ['viewer', 'agent', 'manager', 'admin', 'owner'];

export async function render(main, params, query, ctx) {
  ctx.crumbs([{ label: 'Settings' }]);
  let tab = qget(query, 'tab', 'users'); if (!TABS.some((t) => t.key === tab)) tab = 'users';
  main.appendChild(pageHead('Administration', 'Settings', 'Accounts and roles, per-project business rules, and your own session.'));
  const bar = tabs(TABS, tab, (k) => { tab = k; setQuery('#/settings', { tab: k }); show(); });
  main.appendChild(bar.el);
  const body = h('div', { class: 'tab-body' }); main.appendChild(body);
  function show() {
    clear(body);
    if (tab === 'users') body.appendChild(usersPanel(ctx, {}));
    else if (tab === 'rules') body.appendChild(rulesPanel(ctx));
    else body.appendChild(sessionPanel(ctx));
  }
  show();
}

export function usersPanel(ctx, opts) {
  const root = h('div', { class: 'stack' });
  const admin = ctx.can('admin'), owner = ctx.can('owner');
  const project = opts.project || null;
  const r = ctx.resources().users;
  root.appendChild(h('div', { class: 'toolbar' }, h('p', { class: 'dim' }, project ? 'Members of this project (users with access).' : 'Panel accounts. owner/admin see every project; other roles only the projects granted here.'), h('div', { class: 'spacer' }), h('button', { class: 'btn btn-primary', type: 'button', disabled: !owner || undefined, title: owner ? '' : 'Requires the owner role', onClick: () => userDialog(null).then((ok) => { if (ok) load(); }) }, 'New user')));
  const box = h('div', {}); root.appendChild(box);
  async function load() {
    clear(box); box.appendChild(skeletonRows(3));
    if (!r) { clear(box); box.appendChild(h('div', { class: 'notice warn' }, h('strong', {}, 'Users resource not registered yet. '), 'The integrator adds a "users" entry to the registry; accounts from the users file still sign in.')); return; }
    let page; try { page = await ctx.api.get('/api/r/users' + ctx.api.qs({ limit: 200, sort: 'username', dir: 'asc' })); } catch (err) { clear(box); box.appendChild(errorBox(err, load)); return; }
    clear(box);
    let rows = page.rows || page.items || [];
    // explicit grants live in wp_user_projects: GET /api/users/:u/projects (best effort, per user)
    await Promise.all(rows.map((u) => ctx.api.get('/api/users/' + encodeURIComponent(u.username) + '/projects').then((g) => { u.projects = (g.projects || g.items || []).map((p) => typeof p === 'string' ? p : p.project_id); }, () => { u.projects = u.projects || []; })));
    if (project) rows = rows.filter((u) => u.all_projects || (u.projects || []).includes(project) || ['owner', 'admin'].includes(u.role));
    if (!rows.length) { box.appendChild(empty('No user', project ? 'Nobody has explicit access to this project.' : 'Create the first account.')); return; }
    box.appendChild(simpleTable([
      { label: 'User', cell: (u) => h('div', {}, h('strong', {}, u.username), u.display_name ? h('div', { class: 'dim small' }, u.display_name) : null) },
      { label: 'Role', cell: (u) => badge(u.role) },
      { label: 'Status', cell: (u) => badge(u.status || 'active') },
      { label: 'Projects', cell: (u) => u.all_projects || ['owner', 'admin'].includes(u.role) ? badge('all projects', 'accent') : h('span', { class: 'chips' }, (u.projects || []).length ? (u.projects || []).map((p) => chip(ctx.projectName(typeof p === 'string' ? p : p.project_id), 'project')) : h('span', { class: 'dim' }, 'none')) },
      { label: 'Last login', cell: (u) => relTime(u.last_login_at), cls: 'dim' },
      { label: '', stop: true, cell: (u) => h('div', { class: 'row-actions' },
        owner ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: () => userDialog(u).then((ok) => { if (ok) load(); }) }, 'Edit') : null,
        admin ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: () => passwordDialog(u) }, 'Password') : null,
        admin ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: () => accessDialog(u).then((ok) => { if (ok) load(); }) }, 'Projects') : null) }
    ], rows, { onRow: (u) => { location.hash = '#/r/users/' + encodeURIComponent(u.username); } }));
  }
  function userDialog(u) {
    return dialogForm({ title: u ? 'Edit ' + u.username : 'New user', fields: [
      { name: 'username', label: 'Username (a-z0-9._-)', required: true, mono: true, value: u ? u.username : '' },
      { name: 'display_name', label: 'Display name', value: u ? u.display_name || '' : '' },
      { name: 'role', label: 'Role', type: 'select', required: true, value: u ? u.role : 'agent', options: ROLES },
      { name: 'status', label: 'Status', type: 'select', required: true, value: u ? u.status || 'active' : 'active', options: ['active', 'disabled'] },
      { name: 'all_projects', label: 'Access to every project', type: 'checkbox', value: u ? !!u.all_projects : false },
      u ? null : { name: 'password', label: 'Initial password', type: 'password', required: true }
    ].filter(Boolean), onSubmit: async (v) => {
      const body = { display_name: v.display_name.trim() || null, role: v.role, status: v.status, all_projects: v.all_projects };
      if (u) { await ctx.api.patch('/api/r/users/' + encodeURIComponent(u.username), body); }
      else { body.username = v.username.trim(); body.password = v.password; await ctx.api.post('/api/r/users', body); }
      toast(u ? 'User saved' : 'User created', 'ok'); return true;
    } });
  }
  async function passwordDialog(u) {
    const out = await dialogForm({ title: 'Set password · ' + u.username, fields: [{ name: 'password', label: 'New password (12+ characters)', type: 'password', required: true }, { name: 'confirm', label: 'Confirm', type: 'password', required: true }], submitLabel: 'Set password', onSubmit: async (v) => { if (v.password !== v.confirm) throw new Error('Passwords differ.'); if (v.password.length < 12) throw new Error('Use at least 12 characters.'); await ctx.api.post('/api/users/' + encodeURIComponent(u.username) + '/password', { password: v.password }); return true; } });
    if (out) toast('Password set for ' + u.username, 'ok');
  }
  async function accessDialog(u) {
    const current = (u.projects || []).map((p) => typeof p === 'string' ? p : p.project_id);
    return dialogForm({ title: 'Project access · ' + u.username, intro: u.all_projects || ['owner', 'admin'].includes(u.role) ? 'This user already sees every project; explicit grants are informational.' : 'Only granted projects are visible to this user.', fields: [{ name: 'projects', label: 'Projects', type: 'multiselect', value: current, options: ctx.projects().map((p) => ({ value: p.id, label: p.display_name })) }], onSubmit: async (v) => {
      const add = v.projects.filter((p) => !current.includes(p)); const remove = current.filter((p) => !v.projects.includes(p));
      if (!add.length && !remove.length) return true;
      try { await ctx.api.patch('/api/users/' + encodeURIComponent(u.username) + '/projects', { add, remove }); }
      catch (err) { if (err.status === 404) throw new Error('Project access endpoint not available on this server yet.'); throw err; }
      toast('Access updated', 'ok'); return true;
    } });
  }
  load();
  if (!admin) root.appendChild(roleNote(ctx, 'admin', 'Managing users'));
  return root;
}

function rulesPanel(ctx) {
  const root = h('div', { class: 'grid cols-3' });
  ctx.projects().forEach((p) => root.appendChild(h('div', { class: 'card' }, cardHead(p.display_name, [badge(p.status)]), h('p', {}, 'Per-project business configuration as JSON values (opening hours, delivery zones…). Owner-only writes.'), h('div', { class: 'view-actions' }, h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onClick: () => { ctx.setProject(p.id); location.hash = '#/r/rules'; } }, 'Open rules'), h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: () => { ctx.setProject(p.id); location.hash = '#/r/rules/new'; } }, 'New rule')))));
  if (!ctx.projects().length) root.appendChild(empty('No project'));
  return root;
}

function sessionPanel(ctx) {
  const u = ctx.state.meta.user;
  const box = h('div', { class: 'grid cols-2' });
  const card = h('div', { class: 'card' }, cardHead('Who am I'), kv([['Username', u.username], ['Role', badge(ctx.role())], ['Projects', ctx.projects().length + ' accessible'], ['Panel version', ctx.state.meta.version]]), h('div', { class: 'view-actions' }, h('button', { class: 'btn btn-secondary', type: 'button', onClick: () => ctx.toggleTheme() }, 'Toggle theme'), h('button', { class: 'btn btn-danger', type: 'button', onClick: async () => { if (await confirmDialog({ title: 'Sign out?', confirmLabel: 'Sign out' })) ctx.signOut(); } }, 'Sign out')));
  box.appendChild(card);
  const sess = h('div', { class: 'card' }, cardHead('Session'), skeletonRows(2));
  ctx.api.get('/api/session').then((s) => { clear(sess); sess.append(cardHead('Session'), kv([['Expires', fmtDate(s.expires_at)], ['Absolute TTL', '8 hours from sign-in'], ['Every change', 'audited under your username']])); }, (err) => { clear(sess); sess.append(cardHead('Session'), errorBox(err)); });
  box.appendChild(sess);
  return box;
}
