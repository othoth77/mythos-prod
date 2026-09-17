/* MYTHOS Control Center — WhatsApp: one table of numbers (connection,
   projects, receiving, AI, actions), Templates, and an admin-only Advanced
   tab (accounts, routing, receiver / providers, Meta MCP). The routing panel
   and the MCP card are reused by the project page and Settings. */
import { h, clear, badge, fmtDate, relTime, skeletonRows, errorBox, empty, toast, tabs, chip, kv, pageHead, cardHead, simpleTable, switchInput, dialogForm, drawer, confirmDialog, codeBlock, qget, setQuery, roleNote, details, fmtMasked, connBadge } from '../ui.js';

const TABS = [{ key: 'numbers', label: 'Numbers' }, { key: 'templates', label: 'Templates' }, { key: 'advanced', label: 'Advanced' }];

export async function render(main, params, query, ctx) {
  ctx.crumbs([{ label: 'WhatsApp' }]);
  const admin = ctx.can('admin');
  const tabList = TABS.filter((t) => t.key !== 'advanced' || admin);
  let tab = qget(query, 'tab', 'numbers'); if (!tabList.some((t) => t.key === tab)) tab = 'numbers';
  main.appendChild(pageHead(null, 'WhatsApp'));
  const bar = tabs(tabList, tab, (k) => { tab = k; setQuery('#/whatsapp', { tab: k }); show(); });
  main.appendChild(bar.el);
  const body = h('div', { class: 'tab-body' }); main.appendChild(body);
  function show() {
    clear(body);
    if (tab === 'numbers') body.appendChild(numbersPanel(ctx));
    else if (tab === 'templates') body.appendChild(templatesPanel(ctx, { project: ctx.project(), openNew: qget(query, 'new') === '1' }));
    else body.appendChild(advancedPanel(ctx));
  }
  show();
}

/* ── Numbers ─────────────────────────────────────────────────────────────── */
function numbersPanel(ctx) {
  const root = h('div', { class: 'stack' });
  const admin = ctx.can('admin'), manager = ctx.can('manager');
  const syncBtn = h('button', { class: 'btn btn-secondary', type: 'button', disabled: !admin || undefined, title: admin ? 'Discover numbers and check their connection' : 'Requires the admin role', onClick: async () => {
    syncBtn.disabled = true;
    try { const r = await ctx.api.post('/api/whatsapp/numbers/sync', {}); toast('Synced: ' + (r.discovered || 0) + ' found · ' + (r.created || 0) + ' new · ' + (r.updated || 0) + ' updated', 'ok', 5000); load(); }
    catch (err) { toast(err.status === 404 ? 'Sync is not available yet.' : (err.detail || 'Sync failed.'), 'danger', 5000); }
    finally { syncBtn.disabled = !admin; }
  } }, 'Sync all');
  root.appendChild(h('div', { class: 'toolbar' }, h('div', { class: 'spacer' }), syncBtn));
  const box = h('div', {}); root.appendChild(box);
  const open = {};
  async function load() {
    clear(box); box.appendChild(skeletonRows(4));
    let r; try { r = await ctx.api.get('/api/whatsapp/numbers'); } catch (err) { clear(box); box.appendChild(errorBox(err, load)); return; }
    clear(box);
    const items = r.items || [];
    if (!items.length) { box.appendChild(empty('No number yet', admin ? 'Use "Sync all" to discover the connected numbers.' : 'No number is linked to your projects.')); return; }
    const tbody = h('tbody', {});
    items.forEach((n) => {
      const links = n.projects || [];
      const aiOn = links.some((l) => (l.ai_mode || 'inherit') !== 'off');
      const receiving = n.webhook_state === 'ok' && (n.projects || []).some((l) => l.inbound_enabled);
      const exp = h('tr', { class: 'expander', hidden: !open[n.id] }, h('td', { colspan: '7' }, linksBlock(n)));
      const toggle = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'aria-expanded': open[n.id] ? 'true' : 'false', onClick: () => { open[n.id] = !open[n.id]; exp.hidden = !open[n.id]; toggle.setAttribute('aria-expanded', open[n.id] ? 'true' : 'false'); } }, open[n.id] ? 'Less' : 'More');
      tbody.append(h('tr', {},
        h('td', {}, h('strong', { class: 'mono' }, fmtMasked(n.phone_masked)), h('div', { class: 'dim small' }, n.display_name || n.instance)),
        h('td', {}, connBadge(n)),
        h('td', {}, links.length ? h('span', { class: 'chips' }, links.map((l) => chip(ctx.projectName(l.project_id), 'project'))) : h('span', { class: 'dim' }, 'Not linked')),
        h('td', {}, badge(receiving ? 'Receiving' : 'Not receiving', receiving ? 'ok' : 'warn')),
        h('td', {}, links.length ? badge(aiOn ? 'Active' : 'Off', aiOn ? 'ok' : 'mock') : h('span', { class: 'dim' }, '—')),
        h('td', { class: 'dim' }, relTime(n.last_event_at)),
        h('td', { class: 'actions' }, h('div', { class: 'row-actions' },
          h('button', { class: 'btn btn-ghost btn-sm', type: 'button', disabled: !manager || undefined, onClick: async (e) => { e.target.disabled = true; try { const c = await ctx.api.post('/api/whatsapp/numbers/' + n.id + '/check', {}); toast('Checked: ' + ({ open: 'connected', pairing: 'connecting', closed: 'disconnected' }[c.status] || c.status || '') + (c.detail ? ' · ' + c.detail : ''), c.health_state === 'ok' ? 'ok' : 'warn', 5000); load(); } catch (err) { toast(err.detail || 'Check failed.', 'danger'); e.target.disabled = false; } } }, 'Check'),
          h('button', { class: 'btn btn-ghost btn-sm', type: 'button', disabled: !admin || undefined, onClick: () => linkDialog(ctx, n, null).then((ok) => { if (ok) load(); }) }, 'Link to project'),
          toggle))), exp);
    });
    box.appendChild(h('div', { class: 'table-wrap auto' }, h('table', { class: 'data numbers' }, h('thead', {}, h('tr', {}, ['Number', 'Status', 'Projects', 'Connection', 'AI', 'Last message', ''].map((l) => h('th', { scope: 'col' }, l)))), tbody)));
  }
  function linksBlock(n) {
    const links = n.projects || [];
    const wrap = h('div', { class: 'stack sm' });
    if (!links.length) wrap.appendChild(h('p', { class: 'dim' }, 'Not linked to any project: messages on this number are dropped.'));
    links.forEach((l) => {
      const pbase = '/api/projects/' + l.project_id + '/inboxes/' + l.inbox_id;
      const patch = (b) => ctx.api.patch(pbase, b).then(() => { Object.assign(l, b); toast('Saved', 'ok', 1800); });
      wrap.appendChild(h('div', { class: 'link-card' }, h('div', { class: 'card-head' }, h('strong', {}, ctx.projectName(l.project_id)), h('div', { class: 'view-actions' }, h('a', { class: 'btn btn-ghost btn-sm', href: '#/projects/' + encodeURIComponent(l.project_id) + '?tab=whatsapp' }, 'Project'),
        admin ? h('button', { class: 'btn btn-ghost btn-sm danger', type: 'button', onClick: async () => { if (!await confirmDialog({ title: 'Unlink ' + ctx.projectName(l.project_id) + '?', body: 'Refused while conversations exist on this number.', confirmLabel: 'Unlink', danger: true })) return; try { await ctx.api.del('/api/whatsapp/numbers/' + n.id + '/projects/' + l.inbox_id); toast('Unlinked', 'ok'); load(); } catch (err) { toast(err.status === 409 ? 'Refused: conversations exist on this number.' : (err.detail || 'Unlink failed.'), 'danger', 5000); } } }, 'Unlink') : null)),
        h('div', { class: 'switch-row' },
          switchInput({ checked: l.inbound_enabled, disabled: !admin, small: true, label: 'Receiving', onChange: (v) => patch({ inbound_enabled: v }) }),
          switchInput({ checked: l.outbound_enabled, disabled: !admin, small: true, label: 'Replies', onChange: (v) => patch({ outbound_enabled: v }) }),
          switchInput({ checked: (l.ai_mode || 'inherit') !== 'off', disabled: !admin, small: true, label: 'AI', onChange: (v) => patch({ ai_mode: v ? 'inherit' : 'off' }) }))));
    });
    if (admin) wrap.appendChild(h('div', { class: 'view-actions' }, h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: () => numberDialog(ctx, n).then((ok) => { if (ok) load(); }) }, 'Edit number'), n.health_detail ? h('span', { class: 'dim small' }, n.health_detail) : null));
    return wrap;
  }
  load();
  return root;
}

async function numberDialog(ctx, n) {
  const accounts = await ctx.api.get('/api/whatsapp/accounts').then((r) => r.items || [], () => []);
  return dialogForm({ title: n ? 'Edit number' : 'Add number', fields: [
    { name: 'provider', label: 'Provider', type: 'select', required: true, value: n ? n.provider : 'evolution', options: ['evolution', 'meta_cloud'] },
    { name: 'instance', label: 'Instance / phone_number_id', required: true, mono: true, value: n ? n.instance : '' },
    { name: 'display_name', label: 'Name', required: true, value: n ? n.display_name : '' },
    { name: 'phone_ref', label: 'Phone (digits)', mono: true, value: n && n.phone_ref ? n.phone_ref : '', help: 'Shown masked everywhere.' },
    { name: 'account_id', label: 'Account', type: 'select', value: n && n.account ? n.account.id : '', options: accounts.map((a) => ({ value: a.id, label: a.display_name })) },
    { name: 'is_personal', label: 'Personal / notification number', type: 'checkbox', value: n ? n.is_personal : false }
  ], onSubmit: async (v) => {
    const body = { provider: v.provider, instance: v.instance.trim(), display_name: v.display_name.trim(), phone_ref: v.phone_ref.trim() || null, account_id: v.account_id ? Number(v.account_id) : null, is_personal: v.is_personal };
    if (n) await ctx.api.patch('/api/whatsapp/numbers/' + n.id, body); else await ctx.api.post('/api/whatsapp/numbers', body);
    toast(n ? 'Number saved' : 'Number added', 'ok');
    return true;
  } });
}

async function linkDialog(ctx, n, presetProject) {
  return dialogForm({ title: 'Link ' + fmtMasked(n.phone_masked) + ' to a project', fields: [
    { name: 'project_id', label: 'Project', type: 'select', required: true, value: presetProject || '', options: ctx.projects().map((p) => ({ value: p.id, label: p.display_name })) },
    { name: 'account_mode', label: 'Use', type: 'select', required: true, value: (n.projects || []).length ? 'shared' : 'dedicated', options: [{ value: 'dedicated', label: 'This project only' }, { value: 'shared', label: 'Shared between projects (routing rules decide)' }] },
    { name: 'allow_personal_account', label: 'Allow a personal / already-used number (internal use only)', type: 'checkbox', value: false }
  ], submitLabel: 'Link', onSubmit: async (v) => {
    await ctx.api.post('/api/whatsapp/numbers/' + n.id + '/projects', { project_id: v.project_id, account_mode: v.account_mode, allow_personal_account: v.allow_personal_account || undefined });
    toast('Linked to ' + ctx.projectName(v.project_id), 'ok'); return true;
  } });
}

/* ── Advanced (admin) ────────────────────────────────────────────────────── */
function advancedPanel(ctx) {
  return h('div', { class: 'stack sm' },
    details('Accounts', accountsPanel(ctx)),
    details('Add a number manually', h('div', {}, h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onClick: () => numberDialog(ctx, null).then((ok) => { if (ok) toast('Reload the Numbers tab to see it.', 'ok'); }) }, 'Add number'))),
    details('Routing rules', routingPanel(ctx, { project: ctx.projectId() })),
    details('Receiver and providers', receiverPanel(ctx)),
    details('Meta WhatsApp MCP', mcpPanel(ctx)));
}

function accountsPanel(ctx) {
  const root = h('div', { class: 'stack' });
  const admin = ctx.can('admin');
  root.appendChild(h('div', { class: 'toolbar' }, h('p', { class: 'dim' }, 'WhatsApp Business accounts (Evolution hosts or Meta WABAs). No secret lives here.'), h('div', { class: 'spacer' }), h('button', { class: 'btn btn-primary btn-sm', type: 'button', disabled: !admin || undefined, onClick: () => accountDialog(null).then((ok) => { if (ok) load(); }) }, 'New account')));
  const box = h('div', {}); root.appendChild(box);
  async function load() {
    clear(box); box.appendChild(skeletonRows(3));
    let r; try { r = await ctx.api.get('/api/whatsapp/accounts'); } catch (err) { clear(box); box.appendChild(errorBox(err, load)); return; }
    clear(box);
    const items = r.items || [];
    if (!items.length) { box.appendChild(empty('No account', 'Sync numbers first, or create an account manually.')); return; }
    box.appendChild(simpleTable([
      { label: 'Account', cell: (a) => h('strong', {}, a.display_name) }, { label: 'Provider', cell: (a) => badge(a.provider, 'info') }, { label: 'External ref', cell: (a) => h('code', {}, a.external_ref || '—') }, { label: 'Business', cell: (a) => a.business_name }, { label: 'Status', cell: (a) => badge(a.status) }, { label: 'Numbers', cell: (a) => a.numbers === undefined ? null : String(a.numbers), cls: 'num' },
      { label: '', stop: true, cell: (a) => admin ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: () => accountDialog(a).then((ok) => { if (ok) load(); }) }, 'Edit') : null }
    ], items, { noScroll: true }));
  }
  function accountDialog(a) {
    return dialogForm({ title: a ? 'Edit account' : 'New account', fields: [
      { name: 'provider', label: 'Provider', type: 'select', required: true, value: a ? a.provider : 'evolution', options: ['evolution', 'meta_cloud'] },
      { name: 'display_name', label: 'Name', required: true, value: a ? a.display_name : '' },
      { name: 'business_name', label: 'Business name', value: a ? a.business_name || '' : '' },
      { name: 'external_ref', label: 'External reference (WABA id / evolution:<host>)', mono: true, value: a ? a.external_ref || '' : '', help: 'Not a secret. Meta template sync needs the WABA id here.' },
      { name: 'status', label: 'Status', type: 'select', required: true, value: a ? a.status : 'active', options: ['active', 'disabled'] }
    ], onSubmit: async (v) => { const body = { provider: v.provider, display_name: v.display_name.trim(), business_name: v.business_name.trim() || null, external_ref: v.external_ref.trim() || null, status: v.status }; if (a) await ctx.api.patch('/api/whatsapp/accounts/' + a.id, body); else await ctx.api.post('/api/whatsapp/accounts', body); toast('Account saved', 'ok'); return true; } });
  }
  load();
  return root;
}

/* ── Routing (project Advanced, WhatsApp Advanced) ───────────────────────── */
export function routingPanel(ctx, opts) {
  const root = h('div', { class: 'stack' });
  let project = opts.project || null;
  const admin = ctx.can('admin'), manager = ctx.can('manager');
  const picker = h('select', { class: 'select', 'aria-label': 'Project' }, h('option', { value: '' }, 'Choose a project…'), ctx.projects().map((p) => h('option', { value: p.id, selected: p.id === project || undefined }, p.display_name)));
  picker.onchange = () => { project = picker.value || null; load(); };
  if (!opts.fixed) root.appendChild(h('div', { class: 'toolbar' }, h('p', { class: 'dim' }, 'Routing decides which project answers a message on a shared number: dedicated → sticky → allowlist / opt-in → keyword → default → drop.'), h('div', { class: 'spacer' }), picker));
  const box = h('div', { class: 'stack' }); root.appendChild(box);
  let numbers = [];
  async function load() {
    clear(box);
    if (!project) { box.appendChild(empty('Pick a project', 'Routing rules belong to a project.')); return; }
    box.appendChild(skeletonRows(4));
    const [rules, nums] = await Promise.all([ctx.api.get('/api/projects/' + project + '/comms/routes').then((r) => ({ ok: true, items: r.items || [] }), (err) => ({ ok: false, err })), ctx.api.get('/api/whatsapp/numbers').then((r) => r.items || [], () => [])]);
    numbers = nums;
    clear(box);
    if (!rules.ok) { box.appendChild(errorBox(rules.err, load)); return; }
    const links = []; nums.forEach((n) => (n.projects || []).forEach((l) => { if (l.project_id === project) links.push({ number: n, link: l }); }));
    const inboxName = (id) => { const x = links.find((l) => l.link.inbox_id === id); return x ? fmtMasked(x.number.phone_masked) : (id ? '#' + id : '—'); };
    const table = rules.items.length ? simpleTable([
      { label: 'Priority', cell: (r) => String(r.priority), cls: 'num' },
      { label: 'Kind', cell: (r) => badge(r.kind, r.kind === 'default' ? 'mock' : r.kind === 'keyword' ? 'info' : 'accent') },
      { label: 'Match', cell: (r) => r.kind === 'keyword' ? h('code', {}, r.entry) : r.kind === 'default' ? h('span', { class: 'dim' }, 'any sender') : h('span', { class: 'mono' }, r.identity_kind + ' …' + (r.identity_tail || '')) },
      { label: 'Number', cell: (r) => r.inbox_id ? inboxName(r.inbox_id) : (r.instance || '—') },
      { label: 'Opt-in', cell: (r) => r.kind === 'opt_in' ? h('span', {}, r.code_required ? badge('code', 'info') : null, r.activated_at ? ' active ' + relTime(r.activated_at) : ' pending', r.expires_at ? h('span', { class: 'dim' }, ' · until ' + fmtDate(r.expires_at)) : null) : null },
      { label: 'Note', cell: (r) => r.note, cls: 'dim' },
      { label: 'Enabled', stop: true, cell: (r) => switchInput({ checked: r.enabled, disabled: !admin, small: true, onChange: async (v) => { await ctx.api.post('/api/projects/' + project + '/comms/routes/' + r.id + '/' + (v ? 'enable' : 'disable'), {}); toast(v ? 'Rule enabled' : 'Rule disabled', 'ok', 1800); } }) },
      { label: '', stop: true, cell: (r) => admin ? h('button', { class: 'btn btn-ghost btn-sm danger', type: 'button', onClick: async () => { if (!await confirmDialog({ title: 'Delete rule #' + r.id + '?', confirmLabel: 'Delete', danger: true })) return; try { await ctx.api.del('/api/projects/' + project + '/comms/routes/' + r.id); toast('Rule deleted', 'ok'); load(); } catch (err) { toast(err.status === 404 ? 'Delete is not available yet.' : (err.detail || 'Delete failed.'), 'danger'); } } }, 'Delete') : null }
    ], rules.items, { noScroll: true }) : empty('No routing rule', 'A dedicated number needs none. Shared numbers need allowlist / opt-in / keyword / default rules.');
    box.appendChild(h('div', { class: 'card' }, cardHead('Rules · ' + ctx.projectName(project), [admin ? h('button', { class: 'btn btn-primary btn-sm', type: 'button', onClick: () => ruleDialog(links).then((ok) => { if (ok) load(); }) }, 'Add rule') : null]), table, roleNote(ctx, 'admin', 'Editing rules')));
    box.appendChild(simulateCard(links));
    if (admin) box.appendChild(dropsCard());
  }
  function ruleDialog(links) {
    return dialogForm({ title: 'Add routing rule · ' + ctx.projectName(project), fields: [
      { name: 'kind', label: 'Kind', type: 'select', required: true, value: 'allowlist', options: [{ value: 'allowlist', label: 'allowlist — a known sender identity' }, { value: 'opt_in', label: 'opt-in — sender activates with a code' }, { value: 'keyword', label: 'keyword — first message contains a token' }, { value: 'default', label: 'default — everything else on this number' }], help: 'keyword and default are refused on personal numbers.' },
      { name: 'inbox_id', label: 'Number', type: 'select', value: links.length === 1 ? links[0].link.inbox_id : '', options: links.map((l) => ({ value: l.link.inbox_id, label: fmtMasked(l.number.phone_masked) + ' · ' + (l.number.display_name || l.number.instance) })) },
      { name: 'identity_kind', label: 'Identity kind', type: 'select', value: 'phone', options: ['phone', 'lid', 'bsuid', 'provider_user', 'entry', 'any'], help: 'keyword uses entry; default uses any.' },
      { name: 'identity_value', label: 'Identity value / keyword', mono: true, value: '', help: 'Phone digits, LID, or the lowercase keyword token. "*" for default.' },
      { name: 'priority', label: 'Priority (lower wins)', type: 'number', value: 100, min: 0, max: 10000, step: 1 },
      { name: 'opt_in_code', label: 'Opt-in code (opt_in only)', mono: true, value: '' },
      { name: 'ttl_hours', label: 'TTL hours (opt_in only)', type: 'number', value: null, min: 1, max: 8760, step: 1 },
      { name: 'note', label: 'Note', value: '' }
    ], submitLabel: 'Add rule', onSubmit: async (v) => {
      const body = { kind: v.kind, inbox_id: v.inbox_id ? Number(v.inbox_id) : undefined, identity_kind: v.kind === 'keyword' ? 'entry' : v.kind === 'default' ? 'any' : v.identity_kind, identity_value: v.kind === 'default' ? '*' : v.identity_value.trim(), priority: v.priority === null ? undefined : v.priority, note: v.note.trim() || undefined };
      if (v.kind === 'opt_in') { if (v.opt_in_code.trim()) body.opt_in_code = v.opt_in_code.trim(); if (v.ttl_hours) body.ttl_hours = v.ttl_hours; }
      await ctx.api.post('/api/projects/' + project + '/comms/routes', body); toast('Rule added', 'ok'); return true;
    } });
  }
  function simulateCard(links) {
    const prov = h('select', { class: 'select', 'aria-label': 'Provider' }, ['evolution', 'meta_cloud'].map((p) => h('option', { value: p }, p)));
    const inst = h('select', { class: 'select', 'aria-label': 'Instance' }, numbers.length ? numbers.map((n) => h('option', { value: n.instance, selected: links.some((l) => l.number.id === n.id) || undefined }, (n.display_name || n.instance) + ' · ' + n.instance)) : h('option', { value: '' }, 'no number known'));
    const instFree = h('input', { class: 'input mono', placeholder: 'instance', 'aria-label': 'Instance (free text)' });
    const from = h('input', { class: 'input mono', placeholder: 'sender digits, e.g. 216…', 'aria-label': 'Sender digits' });
    const text = h('input', { class: 'input', placeholder: 'first message text (keywords)', 'aria-label': 'Message text' });
    const out = h('div', {});
    const run = h('button', { class: 'btn btn-secondary', type: 'button', disabled: !manager || undefined, onClick: async () => {
      run.disabled = true; clear(out); out.appendChild(skeletonRows(2));
      try {
        const r = await ctx.api.post('/api/whatsapp/routing/simulate', { provider: prov.value, instance: inst.value || instFree.value.trim(), from: from.value.replace(/\D/g, ''), text: text.value });
        clear(out);
        out.appendChild(h('div', { class: 'sim-result ' + (r.routed ? 'ok' : 'drop') }, kv([['Decision', badge(r.routed ? 'ROUTED' : 'DROPPED', r.routed ? 'ok' : 'danger')], ['Mode', r.mode ? badge(r.mode, 'info') : '—'], ['Reason', h('code', {}, r.reason || '—')], ['Project', r.project_id ? ctx.projectName(r.project_id) : '—'], ['Inbox', r.inbox_id ? String(r.inbox_id) : '—'], ['Rule', r.rule_id ? '#' + r.rule_id : '—']])));
      } catch (err) { clear(out); out.appendChild(errorBox(err)); }
      finally { run.disabled = !manager; }
    } }, 'Simulate (dry-run, no write)');
    return h('div', { class: 'card' }, cardHead('Simulate routing', [badge('never writes', 'ok')]),
      h('div', { class: 'field-row' }, h('div', { class: 'field' }, h('label', {}, 'Provider'), prov), h('div', { class: 'field' }, h('label', {}, 'Instance'), numbers.length ? inst : instFree), h('div', { class: 'field' }, h('label', {}, 'From (digits)'), from), h('div', { class: 'field' }, h('label', {}, 'Text'), text)),
      h('div', {}, run), roleNote(ctx, 'manager', 'Simulation'), out);
  }
  function dropsCard() {
    const card = h('div', { class: 'card' }, cardHead('Recent routing drops', [badge('hashes only', 'mock')]));
    const box2 = h('div', {}, skeletonRows(2)); card.appendChild(box2);
    ctx.api.get('/api/whatsapp/routing-drops?limit=50').catch((err) => { if (err.status === 404) return ctx.api.get('/api/comms/routing-drops?limit=50'); throw err; }).then((r) => {
      clear(box2); const items = r.items || [];
      if (!items.length) { box2.appendChild(h('p', { class: 'dim' }, 'No drop recorded.')); return; }
      box2.appendChild(simpleTable([{ label: 'When', cell: (d) => fmtDate(d.at), cls: 'dim' }, { label: 'Provider', cell: (d) => d.provider }, { label: 'Instance', cell: (d) => h('code', {}, d.instance) }, { label: 'Reason', cell: (d) => badge(d.reason, 'warn') }, { label: 'Identity', cell: (d) => d.has_identity_hash ? 'hashed' : '—', cls: 'dim' }], items, { compact: true, noScroll: true }));
    }, (err) => { clear(box2); box2.appendChild(errorBox(err)); });
    return card;
  }
  load();
  return root;
}

/* ── Templates ───────────────────────────────────────────────────────────── */
function templatesPanel(ctx, opts) {
  const root = h('div', { class: 'stack' });
  const manager = ctx.can('manager'), admin = ctx.can('admin');
  let project = opts.project || 'all';
  const picker = h('select', { class: 'select', 'aria-label': 'Project' }, h('option', { value: 'all' }, 'All projects'), ctx.projects().map((p) => h('option', { value: p.id, selected: p.id === project || undefined }, p.display_name)));
  picker.onchange = () => { project = picker.value; load(); };
  const syncAll = h('button', { class: 'btn btn-secondary', type: 'button', disabled: !admin || undefined, onClick: async () => { syncAll.disabled = true; try { await ctx.api.post('/api/templates/sync-all', {}); toast('Synced with Meta.', 'ok', 4000); load(); } catch (err) { toast(syncReason(err), err.status === 412 ? 'warn' : 'danger', 6000); } finally { syncAll.disabled = !admin; } } }, 'Sync with Meta');
  root.appendChild(h('div', { class: 'toolbar' }, picker, h('div', { class: 'spacer' }), syncAll, h('button', { class: 'btn btn-primary', type: 'button', disabled: !manager || undefined, onClick: () => templateDialog(null).then((ok) => { if (ok) load(); }) }, 'New template')));
  const box = h('div', {}); root.appendChild(box);
  function syncReason(err) { return err.status === 412 ? 'Meta is not configured (access token file + WABA id on the account).' : err.status === 404 ? 'Template sync is not available yet.' : (err.detail || 'Sync failed.'); }
  async function load() {
    clear(box); box.appendChild(skeletonRows(4));
    let r; try { r = await ctx.api.get('/api/templates' + ctx.api.qs({ project })); } catch (err) { clear(box); box.appendChild(errorBox(err, load)); return; }
    clear(box);
    const items = r.items || [];
    if (!items.length) { box.appendChild(empty('No template', 'Create a template to reuse a message with {{name}} or {{1}} placeholders.')); return; }
    box.appendChild(simpleTable([
      { label: 'Name', cell: (t) => h('div', {}, h('strong', { class: 'mono' }, t.name), h('div', { class: 'dim' }, t.language + ' · ' + t.category)) },
      { label: 'Project', cell: (t) => t.project_id ? chip(ctx.projectName(t.project_id), 'project') : h('span', { class: 'dim' }, 'shared') },
      { label: 'Status', cell: (t) => badge(t.status) },
      { label: 'Text', cell: (t) => h('span', { class: 'clamp' }, t.body) },
      { label: '', stop: true, cell: (t) => h('div', { class: 'row-actions' }, h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: () => previewDrawer(t) }, 'Preview'), manager ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: () => templateDialog(t).then((ok) => { if (ok) load(); }) }, 'Edit') : null) }
    ], items, { noScroll: true, onRow: previewDrawer }));
  }
  function templateDialog(t) {
    return dialogForm({ title: t ? 'Edit template' : 'New template', wide: true, fields: [
      { name: 'name', label: 'Name (a-z0-9_)', required: true, mono: true, value: t ? t.name : '' },
      { name: 'project_id', label: 'Project', type: 'select', value: t ? t.project_id || '' : (project === 'all' ? '' : project), placeholder: 'shared (every project)', options: ctx.projects().map((p) => ({ value: p.id, label: p.display_name })) },
      { name: 'language', label: 'Language', type: 'select', required: true, value: t ? t.language : 'fr', options: ['fr', 'ar', 'en'] },
      { name: 'category', label: 'Category', type: 'select', required: true, value: t ? t.category : 'UTILITY', options: ['UTILITY', 'MARKETING', 'AUTHENTICATION'] },
      { name: 'status', label: 'Status', type: 'select', required: true, value: t ? t.status : 'draft', options: ['draft', 'pending', 'approved', 'rejected', 'paused'] },
      { name: 'header', label: 'Header', value: t ? t.header || '' : '' },
      { name: 'body', label: 'Text', type: 'textarea', required: true, rows: 5, value: t ? t.body : '', help: 'Placeholders: {{1}}, {{2}} or {{name}}.' },
      { name: 'footer', label: 'Footer', value: t ? t.footer || '' : '' },
      { name: 'variables', label: 'Variables (JSON [{ name, example }])', type: 'json', value: t ? t.variables || [] : [] }
    ], onSubmit: async (v) => {
      const body = { name: v.name.trim(), project_id: v.project_id || null, language: v.language, category: v.category, status: v.status, header: v.header.trim() || null, body: v.body, footer: v.footer.trim() || null, variables: v.variables || [] };
      if (t) await ctx.api.patch('/api/templates/' + t.id, body); else await ctx.api.post('/api/templates', body);
      toast('Template saved', 'ok'); return true;
    } });
  }
  function previewDrawer(t) {
    const d = drawer({ title: t.name + ' · ' + t.language, wide: true });
    const vars = (t.variables || []).map((v) => v.name || v);
    const found = (t.body.match(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g) || []).map((m) => m.replace(/[{}\s]/g, ''));
    const names = Array.from(new Set(vars.concat(found)));
    const inputs = {};
    const form = h('div', { class: 'field-row' }, names.map((n) => { inputs[n] = h('input', { class: 'input', 'aria-label': n, placeholder: (t.variables || []).find((v) => v.name === n) ? ((t.variables || []).find((v) => v.name === n).example || '') : '' }); return h('div', { class: 'field' }, h('label', {}, '{{' + n + '}}'), inputs[n]); }));
    const out = h('div', { class: 'proposed' }, t.body);
    const missing = h('p', { class: 'dim' });
    const previewBtn = h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onClick: async () => {
      const variables = {}; names.forEach((n) => { if (inputs[n].value !== '') variables[n] = inputs[n].value; });
      try { const r = await ctx.api.post('/api/templates/' + t.id + '/preview', { variables }); out.textContent = r.text; missing.textContent = r.missing && r.missing.length ? 'Missing: ' + r.missing.join(', ') : ''; }
      catch (err) { toast(err.status === 404 ? 'Preview is not available yet — showing the raw text.' : (err.detail || 'Preview failed.'), 'warn'); }
    } }, 'Preview');
    const syncBtn = h('button', { class: 'btn btn-secondary btn-sm', type: 'button', disabled: !admin || undefined, onClick: async () => { try { const r = await ctx.api.post('/api/templates/' + t.id + '/sync', {}); toast('Synced: ' + (r.status || 'ok'), 'ok'); d.close(); load(); } catch (err) { toast(syncReason(err), err.status === 412 ? 'warn' : 'danger', 6000); } } }, 'Sync with Meta');
    const testBtn = h('button', { class: 'btn btn-primary btn-sm', type: 'button', disabled: !manager || undefined, onClick: () => testSend(t) }, 'Test send…');
    d.body.append(kv([['Project', t.project_id ? ctx.projectName(t.project_id) : 'shared'], ['Category', t.category], ['Status', badge(t.status)], ['Provider', t.provider || 'local'], ['Rejection', t.rejection_reason], ['Last synced', fmtDate(t.last_synced_at)]]),
      t.header ? h('p', { class: 'dim' }, 'Header: ' + t.header) : null, names.length ? form : h('p', { class: 'dim' }, 'No variable.'), h('div', { class: 'view-actions' }, previewBtn), out, missing, t.footer ? h('p', { class: 'dim' }, 'Footer: ' + t.footer) : null,
      h('div', { class: 'view-actions' }, syncBtn, testBtn), roleNote(ctx, 'manager', 'Test send'));
  }
  async function testSend(t) {
    const out = await dialogForm({ title: 'Test send · ' + t.name, intro: 'Sends the rendered template into an EXISTING conversation. This reaches a real customer.', fields: [
      { name: 'conversation_id', label: 'Conversation id', type: 'number', required: true, step: 1, min: 1 },
      { name: 'variables', label: 'Variables (JSON object)', type: 'json', value: {} }
    ], submitLabel: 'Send test', danger: true, onSubmit: async (v) => { const r = await ctx.api.post('/api/templates/' + t.id + '/test', { conversation_id: v.conversation_id, variables: v.variables || {} }); return r; } });
    if (out) toast('Test sent: ' + (out.status || 'queued'), 'ok', 5000);
  }
  load();
  if (opts.openNew && manager) templateDialog(null).then((ok) => { if (ok) load(); });
  return root;
}

/* ── Receiver / providers ────────────────────────────────────────────────── */
function receiverPanel(ctx) {
  const root = h('div', { class: 'stack' }, skeletonRows(4));
  Promise.all([ctx.api.get('/api/comms/receiver').catch((e) => ({ error: e })), ctx.api.get('/api/comms/providers').catch((e) => ({ error: e }))]).then(([rc, pv]) => {
    clear(root);
    if (rc.error) root.appendChild(errorBox(rc.error));
    else {
      const r = rc.receiver;
      root.appendChild(h('div', { class: 'card' }, cardHead('Receiver'), kv([['Route', h('code', {}, r.route)], ['Enabled', badge(r.enabled ? 'on' : 'off (404)', r.enabled ? 'ok' : 'mock')], ['Webhook token', badge(r.token_present ? 'present' : 'missing: ' + (r.token_problem || '?'), r.token_present ? 'ok' : 'danger')], ['Max body', Math.round(r.max_body_bytes / 1024) + ' KiB'], ['Providers', (r.providers || []).join(', ')], ['Inboxes', (rc.inboxes || []).length ? h('div', { class: 'chips' }, rc.inboxes.map((i) => chip(i.instance + ' · ' + i.status + (i.inbound_enabled ? ' · persisting' : ' · dry-run'), i.inbound_enabled ? 'ok' : ''))) : badge('none', 'mock')]])));
    }
    if (pv.error) root.appendChild(errorBox(pv.error));
    else {
      const provs = pv.providers || [];
      const capRows = [['channel', (c) => c.channel], ['official', (c) => badge(c.official ? 'yes' : 'no', c.official ? 'ok' : 'warn')], ['text', (c) => yn(c.text)], ['media inbound', (c) => yn(c.media && c.media.inbound)], ['media outbound', (c) => yn(c.media && c.media.outbound)], ['templates', (c) => yn(c.templates)], ['reactions', (c) => yn(c.reactions)], ['quotes', (c) => yn(c.quotes)], ['conversation window', (c) => c.conversation_window_hours === null ? 'none' : c.conversation_window_hours + ' h'], ['signed webhooks', (c) => yn(c.signed_webhooks)], ['delivery states', (c) => (c.delivery_states || []).join(' → ')]];
      root.appendChild(h('div', { class: 'card' }, cardHead('Provider capabilities'), h('div', { class: 'table-wrap auto' }, h('table', { class: 'data compact' }, h('thead', {}, h('tr', {}, h('th', {}, 'Capability'), provs.map((p) => h('th', {}, p.id)))), h('tbody', {}, capRows.map(([label, fn]) => h('tr', {}, h('td', { class: 'dim' }, label), provs.map((p) => h('td', {}, fn(p.capabilities || {}))))))))));
      provs.forEach((p) => root.appendChild(h('div', { class: 'card' }, cardHead(p.id, [badge(p.describe && p.describe.credential_present ? 'credential present' : 'credential missing', p.describe && p.describe.credential_present ? 'ok' : 'danger')]), kv([['Host', p.describe && p.describe.base_url_host], ['Problems', p.describe && p.describe.problems && p.describe.problems.length ? p.describe.problems.join(', ') : 'none'], ['Limitations', h('ul', { class: 'plain' }, (p.capabilities && p.capabilities.limitations || []).map((l) => h('li', {}, l)))]]))));
    }
  });
  function yn(v) { return badge(v ? 'yes' : 'no', v ? 'ok' : 'mock'); }
  return root;
}

/* ── Meta WhatsApp Business MCP (also the Settings → Integrations card) ──── */
export function mcpPanel(ctx) {
  const box = h('div', { class: 'stack sm' }, skeletonRows(3));
  async function load() {
    let m; try { m = await ctx.api.get('/api/whatsapp/mcp'); } catch (err) { clear(box); box.appendChild(errorBox(err, load)); return; }
    clear(box);
    const d = m.mcp || m.describe || m;
    const integ = m.integration || null;
    const reach = d.reachable;
    const reachable = reach === undefined || reach === null ? null : (typeof reach === 'object' ? reach.reachable : !!reach);
    box.append(
      kv([['Status', h('span', {}, badge(integ ? integ.status : (d.status || 'beta')), ' ', reachable === null ? badge('not probed', 'mock') : badge(reachable ? 'reachable' : 'unreachable', reachable ? 'ok' : 'danger'))], ['Last check', integ && integ.last_checked_at ? relTime(integ.last_checked_at) : '—']]),
      h('h4', {}, 'Connect'), h('p', { class: 'dim' }, d.owner_step || 'The owner signs in with Facebook Login for Business from the AI tool; the panel never holds the token.'),
      codeBlock(d.claude_code_command || 'claude mcp add --transport http whatsapp_business_tools https://mcp.facebook.com/whatsapp_business_tools', 'command'),
      h('div', { class: 'view-actions' }, h('button', { class: 'btn btn-secondary btn-sm', type: 'button', disabled: !ctx.can('admin') || undefined, onClick: async (e) => { e.target.disabled = true; try { const r = await ctx.api.post('/api/whatsapp/mcp/probe', {}); toast('Probe: ' + (r.reachable ? 'reachable' : 'unreachable') + (r.status ? ' (HTTP ' + r.status + ')' : ''), r.reachable ? 'ok' : 'warn', 5000); load(); } catch (err) { toast(err.detail || 'Probe failed.', 'danger'); e.target.disabled = false; } } }, 'Probe'), h('a', { class: 'btn btn-ghost btn-sm', href: d.docs || 'https://developers.facebook.com/documentation/mcp/whatsapp-business-tools-mcp', target: '_blank', rel: 'noopener noreferrer' }, 'Meta docs')),
      details('Advanced', [kv([['Endpoint', h('code', {}, d.endpoint || '—')], ['Transport', d.transport], ['Auth', d.auth], ['Scopes', h('div', { class: 'chips' }, (d.scopes || []).map((s) => chip(s)))]]), h('h4', {}, 'Tools (' + (d.tools || []).length + ')'), (d.tools || []).length ? h('div', { class: 'chips' }, d.tools.map((t) => chip(typeof t === 'string' ? t : t.name, 'mono'))) : h('p', { class: 'dim' }, 'Tool list unavailable.')]));
  }
  load();
  return box;
}
