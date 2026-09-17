/* MYTHOS Control Center — Automations: trigger → conditions → actions rules
   per project (or global), enable/disable, runs drawer, recent runs. */
import { h, clear, badge, relTime, skeletonRows, errorBox, empty, toast, chip, kv, pageHead, cardHead, simpleTable, switchInput, drawer, confirmDialog, qget, roleNote, json } from '../ui.js';

const TRIGGERS = ['conversation.created', 'message.received', 'conversation.inactive', 'handoff.requested'];
const ACTIONS = ['assign_agent', 'assign_user', 'tag', 'set_status', 'handoff', 'ai_suggest', 'ai_reply', 'n8n_webhook', 'note'];
const ACTION_PARAM = { assign_agent: ['agent_id', 'agent id or "project_default"'], assign_user: ['username', 'username'], tag: ['name', 'tag name'], set_status: ['status', 'open | pending | waiting_customer | needs_human | resolved'], handoff: ['reason', 'reason code'], n8n_webhook: ['path', 'webhook path'], note: ['text', 'note text'] };

export async function render(main, params, query, ctx) {
  ctx.crumbs([{ label: 'Automations' }]);
  main.appendChild(pageHead('Rules', 'Automations', 'When a trigger fires and the conditions match, the actions run in order. Global rules apply to every project; project rules only to theirs.'));
  main.appendChild(automationsPanel(ctx, { project: ctx.project(), openNew: qget(query, 'new') === '1' }));
}

export function automationsPanel(ctx, opts) {
  const root = h('div', { class: 'stack' });
  const admin = ctx.can('admin');
  let project = opts.project || 'all';
  const picker = h('select', { class: 'select', 'aria-label': 'Project' }, h('option', { value: 'all' }, 'All projects'), ctx.projects().map((p) => h('option', { value: p.id, selected: p.id === project || undefined }, p.display_name)));
  picker.onchange = () => { project = picker.value; load(); };
  root.appendChild(h('div', { class: 'toolbar' }, opts.fixed ? null : picker, h('div', { class: 'spacer' }), h('button', { class: 'btn btn-primary', type: 'button', disabled: !admin || undefined, onClick: () => editor(null) }, 'New automation')));
  const box = h('div', {}); root.appendChild(box);
  const recent = h('div', { class: 'card' }); root.appendChild(recent);
  async function load() {
    clear(box); box.appendChild(skeletonRows(4));
    let r; try { r = await ctx.api.get('/api/automations' + ctx.api.qs({ project })); } catch (err) { clear(box); box.appendChild(errorBox(err, load)); clear(recent); return; }
    clear(box);
    const items = r.items || [];
    if (!items.length) box.appendChild(empty('No automation', 'Defaults (route to the project agent, "customer asks for a human", answer with the project agent) are seeded by the server.'));
    else box.appendChild(simpleTable([
      { label: 'On', cell: (a) => a.enabled !== undefined ? switchInput({ checked: a.enabled, disabled: !admin, small: true, onChange: async (v) => { await ctx.api.post('/api/automations/' + a.id + '/' + (v ? 'enable' : 'disable'), {}); toast(v ? 'Enabled' : 'Disabled', 'ok', 1800); } }) : null, stop: true },
      { label: 'Name', cell: (a) => h('div', {}, h('strong', {}, a.name), h('div', { class: 'dim small' }, 'position ' + (a.position === undefined ? '—' : a.position))) },
      { label: 'Scope', cell: (a) => a.project_id ? chip(ctx.projectName(a.project_id), 'project') : badge('global', 'accent') },
      { label: 'Trigger', cell: (a) => h('code', {}, a.trigger) },
      { label: 'Conditions', cell: (a) => condText(a.conditions), cls: 'dim' },
      { label: 'Actions', cell: (a) => h('div', { class: 'chips' }, (a.actions || []).map((x) => chip(x.type + paramText(x), 'mono'))) },
      { label: '', stop: true, cell: (a) => h('div', { class: 'row-actions' }, h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: () => runsDrawer(a) }, 'Runs'), admin ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: () => editor(a) }, 'Edit') : null, admin ? h('button', { class: 'btn btn-ghost btn-sm danger', type: 'button', onClick: async () => { if (!await confirmDialog({ title: 'Delete "' + a.name + '"?', confirmLabel: 'Delete', danger: true })) return; try { await ctx.api.del('/api/automations/' + a.id); toast('Deleted', 'ok'); load(); } catch (err) { toast(err.detail || 'Delete failed.', 'danger'); } } }, 'Delete') : null) }
    ], items, { onRow: runsDrawer }));
    loadRecent();
  }
  function condText(c) { c = c || {}; const parts = []; if (c.keywords && c.keywords.length) parts.push('keywords: ' + c.keywords.join(', ')); if (c.inactive_minutes) parts.push('inactive ≥ ' + c.inactive_minutes + ' min'); if (c.handler) parts.push('handler = ' + c.handler); if (c.status) parts.push('status = ' + c.status); if (c.inbox_id) parts.push('inbox #' + c.inbox_id); return parts.join(' · ') || 'always'; }
  function paramText(x) { const p = ACTION_PARAM[x.type]; if (!p) return ''; const v = x[p[0]] !== undefined ? x[p[0]] : (x.params && x.params[p[0]]); return v !== undefined && v !== null && v !== '' ? ' ' + v : ''; }
  async function loadRecent() {
    clear(recent); recent.appendChild(cardHead('Recent runs')); const b = h('div', {}, skeletonRows(2)); recent.appendChild(b);
    let r; try { r = await ctx.api.get('/api/automation-runs' + ctx.api.qs({ project, limit: 50 })); } catch (err) { clear(b); b.appendChild(errorBox(err)); return; }
    clear(b); const items = r.items || [];
    if (!items.length) { b.appendChild(h('p', { class: 'dim' }, 'No run yet.')); return; }
    b.appendChild(runsTable(items));
  }
  function runsTable(items) {
    return simpleTable([
      { label: 'When', cell: (x) => relTime(x.at), cls: 'dim' }, { label: 'Automation', cell: (x) => x.automation_name || (x.automation_id ? '#' + x.automation_id : '—') }, { label: 'Project', cell: (x) => x.project_id ? chip(ctx.projectName(x.project_id), 'project') : null }, { label: 'Trigger', cell: (x) => h('code', {}, x.trigger) }, { label: 'Result', cell: (x) => badge(x.result) }, { label: 'Conversation', cell: (x) => x.conversation_id ? h('a', { href: '#/inbox/' + x.conversation_id + (x.project_id ? '?project=' + encodeURIComponent(x.project_id) : '') }, '#' + x.conversation_id) : null }, { label: 'Detail', cell: (x) => x.detail ? h('span', { class: 'clamp' }, JSON.stringify(x.detail)) : null, cls: 'dim' }
    ], items, { compact: true });
  }
  async function runsDrawer(a) {
    const d = drawer({ title: 'Runs · ' + a.name, wide: true });
    d.body.appendChild(kv([['Trigger', h('code', {}, a.trigger)], ['Conditions', json(a.conditions || {})], ['Actions', json(a.actions || [])]]));
    const b = h('div', {}, skeletonRows(3)); d.body.appendChild(b);
    try { const r = await ctx.api.get('/api/automations/' + a.id + '/runs'); clear(b); const items = r.items || []; b.appendChild(items.length ? runsTable(items) : h('p', { class: 'dim' }, 'No run yet.')); } catch (err) { clear(b); b.appendChild(errorBox(err)); }
  }
  /* editor: name, trigger, conditions (keywords, inactive_minutes, handler), actions list editor, project scope */
  function editor(a) {
    const d = drawer({ title: a ? 'Edit automation' : 'New automation', wide: true });
    const c = (a && a.conditions) || {};
    const name = h('input', { class: 'input', value: a ? a.name : '', 'aria-label': 'Name', required: true });
    const scope = h('select', { class: 'select', 'aria-label': 'Scope' }, h('option', { value: '' }, 'Global (every project)'), ctx.projects().map((p) => h('option', { value: p.id, selected: (a ? a.project_id === p.id : project === p.id) || undefined }, p.display_name)));
    const trig = h('select', { class: 'select', 'aria-label': 'Trigger' }, TRIGGERS.map((t) => h('option', { value: t, selected: (a ? a.trigger === t : t === 'message.received') || undefined }, t)));
    const kw = h('input', { class: 'input', value: (c.keywords || []).join(', '), placeholder: 'human, humain, agent', 'aria-label': 'Keywords' });
    const inactive = h('input', { class: 'input', type: 'number', min: 1, step: 1, value: c.inactive_minutes || '', 'aria-label': 'Inactive minutes' });
    const handler = h('select', { class: 'select', 'aria-label': 'Handler condition' }, h('option', { value: '' }, 'any handler'), ['ai', 'human'].map((x) => h('option', { value: x, selected: c.handler === x || undefined }, x)));
    const status = h('input', { class: 'input', value: c.status || '', placeholder: 'e.g. open', 'aria-label': 'Status condition' });
    const position = h('input', { class: 'input', type: 'number', step: 1, value: a && a.position !== undefined ? a.position : 100, 'aria-label': 'Position' });
    const enabled = h('input', { type: 'checkbox' }); enabled.checked = a ? a.enabled !== false : true;
    const actionsEl = h('div', { class: 'stack sm' });
    const rows = [];
    function addAction(x) {
      const type = h('select', { class: 'select', 'aria-label': 'Action type' }, ACTIONS.map((t) => h('option', { value: t, selected: (x && x.type === t) || undefined }, t)));
      const param = h('input', { class: 'input', 'aria-label': 'Parameter' });
      const extra = h('label', { class: 'check' }, h('input', { type: 'checkbox' }), 'include text');
      function refresh() { const p = ACTION_PARAM[type.value]; param.hidden = !p; param.placeholder = p ? p[1] : ''; extra.hidden = type.value !== 'n8n_webhook'; }
      type.onchange = refresh;
      if (x) { const p = ACTION_PARAM[x.type]; if (p) param.value = x[p[0]] !== undefined ? x[p[0]] : (x.params && x.params[p[0]]) || ''; if (x.include_text) extra.querySelector('input').checked = true; }
      refresh();
      const row = h('div', { class: 'action-row' }, type, param, extra, h('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'aria-label': 'Remove action', onClick: () => { actionsEl.removeChild(row); rows.splice(rows.indexOf(entry), 1); } }, '×'));
      const entry = { type, param, extra };
      rows.push(entry); actionsEl.appendChild(row);
    }
    ((a && a.actions) || []).forEach(addAction);
    if (!a) addAction({ type: 'ai_suggest' });
    const err = h('p', { class: 'error', hidden: true, role: 'alert' });
    const save = h('button', { class: 'btn btn-primary', type: 'button', onClick: async () => {
      err.hidden = true;
      if (!name.value.trim()) { err.textContent = 'Name is required.'; err.hidden = false; return; }
      const conditions = {};
      const kws = kw.value.split(',').map((s) => s.trim()).filter(Boolean); if (kws.length) conditions.keywords = kws;
      if (inactive.value) conditions.inactive_minutes = parseInt(inactive.value, 10);
      if (handler.value) conditions.handler = handler.value;
      if (status.value.trim()) conditions.status = status.value.trim();
      const actions = rows.map((r) => { const o = { type: r.type.value }; const p = ACTION_PARAM[o.type]; if (p && r.param.value.trim()) o[p[0]] = r.param.value.trim(); if (o.type === 'n8n_webhook' && r.extra.querySelector('input').checked) o.include_text = true; return o; });
      if (!actions.length) { err.textContent = 'At least one action.'; err.hidden = false; return; }
      const body = { name: name.value.trim(), project_id: scope.value || null, trigger: trig.value, conditions, actions, enabled: enabled.checked, position: parseInt(position.value, 10) || 100 };
      save.disabled = true;
      try { if (a) await ctx.api.patch('/api/automations/' + a.id, body); else await ctx.api.post('/api/automations', body); toast('Automation saved', 'ok'); d.close(); load(); }
      catch (e) { err.textContent = e.detail || e.message || 'Save failed.'; err.hidden = false; }
      finally { save.disabled = false; }
    } }, a ? 'Save changes' : 'Create automation');
    d.body.append(
      h('div', { class: 'field-row' }, field('Name', name), field('Scope', scope), field('Trigger', trig), field('Position (lower runs first)', position)),
      h('h4', {}, 'Conditions'), h('div', { class: 'field-row' }, field('Keywords (comma list, inbound text contains)', kw), field('Inactive minutes (conversation.inactive)', inactive), field('Handler', handler), field('Status', status)),
      h('h4', {}, 'Actions (in order)'), actionsEl, h('div', {}, h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onClick: () => addAction(null) }, '+ Add action')),
      h('label', { class: 'check' }, enabled, 'Enabled'), err, h('div', { class: 'dialog-foot' }, h('button', { class: 'btn btn-secondary', type: 'button', onClick: () => d.close() }, 'Cancel'), save));
  }
  function field(label, c) { return h('div', { class: 'field' }, h('label', {}, label), c); }
  load();
  if (opts.openNew && admin) editor(null);
  if (!admin) root.appendChild(roleNote(ctx, 'admin', 'Editing automations'));
  return root;
}
