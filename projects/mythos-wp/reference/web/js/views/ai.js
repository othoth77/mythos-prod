/* MYTHOS Control Center — AI: agents (cards, create/edit, bind, test), runs,
   knowledge link, tool registry, engine/LLM status. */
import { h, clear, badge, fmtDate, relTime, skeletonRows, errorBox, empty, toast, tabs, chip, kv, pageHead, cardHead, simpleTable, dialogForm, confirmDialog, qget, setQuery, roleNote, json } from '../ui.js';

const TABS = [{ key: 'agents', label: 'Agents' }, { key: 'runs', label: 'Runs' }, { key: 'knowledge', label: 'Knowledge' }, { key: 'tools', label: 'Tools' }];

export async function render(main, params, query, ctx) {
  ctx.crumbs([{ label: 'AI' }]);
  let tab = qget(query, 'tab', 'agents'); if (!TABS.some((t) => t.key === tab)) tab = 'agents';
  main.appendChild(pageHead('Assistants', 'AI', 'Agents answer customers with verified facts only (Kitchen, knowledge); anything unverified goes to a human. Modes: off, suggest (human sends), auto (policy-gated automatic replies).'));
  main.appendChild(statusCard(ctx));
  const bar = tabs(TABS, tab, (k) => { tab = k; setQuery('#/ai', { tab: k }); show(); });
  main.appendChild(bar.el);
  const body = h('div', { class: 'tab-body' }); main.appendChild(body);
  function show() {
    clear(body);
    if (tab === 'agents') body.appendChild(agentsPanel(ctx, { openNew: qget(query, 'new') === '1' }));
    else if (tab === 'runs') body.appendChild(runsPanel(ctx, { project: ctx.project() }));
    else if (tab === 'knowledge') body.appendChild(h('div', { class: 'card' }, cardHead('Knowledge base'), h('p', {}, 'Customer-facing knowledge entries an agent may quote verbatim when active and allowed for auto-reply. Managed per project through the generic resource view.'), h('div', { class: 'view-actions' }, h('a', { class: 'btn btn-primary', href: '#/r/knowledge' }, 'Open knowledge'), h('a', { class: 'btn btn-secondary', href: '#/r/knowledge/new' }, 'New entry'))));
    else if (tab === 'tools') body.appendChild(toolsPanel(ctx));
  }
  show();
}

function statusCard(ctx) {
  const card = h('div', { class: 'card status-strip' }, skeletonRows(1));
  ctx.api.get('/api/ai/status').then((s) => {
    clear(card);
    const llm = s.llm || {}, ag = s.agents || {};
    card.append(
      h('div', { class: 'status-item' }, h('span', { class: 'stat-label' }, 'Engine 173'), badge(s.engine_173 && s.engine_173.available ? 'available' : 'unavailable', s.engine_173 && s.engine_173.available ? 'ok' : 'danger')),
      h('div', { class: 'status-item' }, h('span', { class: 'stat-label' }, 'LLM pool'), badge(llm.configured ? 'configured' : 'not configured', llm.configured ? 'ok' : 'warn'), h('span', { class: 'dim' }, (llm.providers || []).map((p) => p.id + (p.credential_present ? ' ✓' : ' ✗')).join(' · '))),
      h('div', { class: 'status-item' }, h('span', { class: 'stat-label' }, 'Agents'), h('span', {}, (ag.active === undefined ? '—' : ag.active) + ' active · ' + (ag.auto === undefined ? '—' : ag.auto) + ' auto · ' + (ag.suggest === undefined ? '—' : ag.suggest) + ' suggest')),
      s.defaults ? h('div', { class: 'status-item' }, h('span', { class: 'stat-label' }, 'Defaults'), h('span', { class: 'dim mono' }, Object.keys(s.defaults).map((k) => k + '=' + s.defaults[k]).join(' '))) : null
    );
  }, (err) => { clear(card); card.appendChild(h('span', { class: 'dim' }, err.status === 404 ? 'AI status endpoint not available on this server yet.' : 'AI status unavailable: ' + (err.detail || err.message))); });
  return card;
}

/* Agent cards; opts.project filters to agents bound to that project. */
export function agentsPanel(ctx, opts) {
  const project = opts.project || null;
  const admin = ctx.can('admin');
  const root = h('div', { class: 'stack' });
  root.appendChild(h('div', { class: 'toolbar' }, h('p', { class: 'dim' }, project ? 'Agents bound to this project.' : 'Every agent, its engine, mode, tools and project bindings.'), h('div', { class: 'spacer' }), h('button', { class: 'btn btn-primary', type: 'button', disabled: !admin || undefined, onClick: () => agentDialog(ctx, null).then((a) => { if (a) { load(); if (a.id) location.hash = '#/ai/agents/' + a.id; } }) }, 'New agent')));
  const box = h('div', {}); root.appendChild(box);
  let tools = [];
  async function load() {
    clear(box); box.appendChild(skeletonRows(3));
    const [r, t] = await Promise.all([ctx.api.get('/api/ai/agents').then((x) => ({ ok: true, items: x.items || [] }), (err) => ({ ok: false, err })), ctx.api.get('/api/ai/tools').then((x) => Array.isArray(x) ? x : (x.items || x.tools || []), () => [])]);
    tools = t; clear(box);
    if (!r.ok) { box.appendChild(errorBox(r.err, load)); return; }
    let items = r.items;
    if (project) items = items.filter((a) => (a.projects || []).some((l) => l.project_id === project));
    if (!items.length) { box.appendChild(empty('No agent', project ? 'Bind an agent to this project from the AI centre.' : 'Create the first agent: it answers with the project Kitchen and knowledge.')); return; }
    box.appendChild(h('div', { class: 'grid cols-3' }, items.map((a) => agentCard(ctx, a, load, project))));
  }
  load();
  root.reload = load;
  root.tools = () => tools;
  return root;
}

function agentCard(ctx, a, reload, project) {
  const st = a.stats || {};
  return h('div', { class: 'card agent-card' + (a.status !== 'active' ? ' muted' : '') },
    cardHead(a.name, [badge(a.mode, a.mode === 'auto' ? 'ok' : a.mode === 'suggest' ? 'info' : 'mock'), badge(a.status)]),
    h('p', {}, a.description || 'No description.'),
    h('div', { class: 'chips' }, chip(a.engine, 'mono'), a.model ? chip(a.model, 'mono') : null, chip('lang ' + a.language), chip('min conf ' + Math.round(Number(a.confidence_min || 0) * 100) + '%'), a.knowledge === false ? chip('no knowledge') : chip('knowledge')),
    h('div', { class: 'dim small' }, 'Tools: ' + ((a.tools || []).join(', ') || 'none')),
    h('div', { class: 'chips' }, (a.projects || []).length ? a.projects.map((l) => chip(ctx.projectName(l.project_id) + (l.inbox_id ? ' · inbox ' + l.inbox_id : '') + (l.enabled === false ? ' (off)' : ''), 'project')) : h('span', { class: 'dim' }, 'not bound to any project')),
    h('div', { class: 'dim small' }, 'Runs 24 h: ' + (st.runs_24h === undefined ? '—' : st.runs_24h) + ' · handoffs 24 h: ' + (st.handoffs_24h === undefined ? '—' : st.handoffs_24h)),
    h('div', { class: 'view-actions' }, h('a', { class: 'btn btn-secondary btn-sm', href: '#/ai/agents/' + a.id }, 'Open'), ctx.can('manager') ? h('a', { class: 'btn btn-ghost btn-sm', href: '#/ai/agents/' + a.id + '?test=1' }, 'Test') : null, ctx.can('admin') ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: () => bindDialog(ctx, a, project).then((ok) => { if (ok) reload(); }) }, 'Bind') : null));
}

export async function agentDialog(ctx, a) {
  const tools = await ctx.api.get('/api/ai/tools').then((x) => Array.isArray(x) ? x : (x.items || x.tools || []), () => []);
  return dialogForm({ title: a ? 'Edit agent · ' + a.name : 'New agent', wide: true, fields: [
    { name: 'name', label: 'Name', required: true, value: a ? a.name : '' },
    { name: 'slug', label: 'Slug (a-z0-9-)', required: true, mono: true, value: a ? a.slug : '' },
    { name: 'description', label: 'Description', type: 'textarea', rows: 2, value: a ? a.description || '' : '' },
    { name: 'status', label: 'Status', type: 'select', required: true, value: a ? a.status : 'active', options: ['active', 'paused', 'archived'] },
    { name: 'mode', label: 'Mode', type: 'select', required: true, value: a ? a.mode : 'suggest', options: [{ value: 'off', label: 'off — never runs' }, { value: 'suggest', label: 'suggest — proposes, a human sends' }, { value: 'auto', label: 'auto — sends when every gate passes' }] },
    { name: 'engine', label: 'Engine', type: 'select', required: true, value: a ? a.engine : 'engine-173', options: [{ value: 'engine-173', label: 'engine-173 — deterministic, no network' }, { value: 'llm', label: 'llm — free-LLM pool + tools, fact-guarded' }] },
    { name: 'model', label: 'Model (llm engine, optional)', mono: true, value: a ? a.model || '' : '', help: 'Empty = pool default.' },
    { name: 'language', label: 'Language', type: 'select', required: true, value: a ? a.language : 'fr', options: ['fr', 'ar', 'en'] },
    { name: 'confidence_min', label: 'Minimum confidence for auto replies', type: 'number', value: a ? Number(a.confidence_min) : 0.8, min: 0, max: 1, step: 0.05 },
    { name: 'knowledge', label: 'May use the project knowledge base', type: 'checkbox', value: a ? a.knowledge !== false : true },
    { name: 'tools', label: 'Tools (least privilege: only listed tools run)', type: 'multiselect', value: a ? a.tools || [] : [], options: tools.map((t) => ({ value: t.id, label: t.id + (t.requires ? ' (needs ' + t.requires + ')' : '') + ' — ' + (t.label || '') })) },
    { name: 'system_prompt', label: 'System prompt (llm engine)', type: 'textarea', rows: 6, value: a ? a.system_prompt || '' : '', help: 'Persona and instructions. Never a credential.' }
  ], onSubmit: async (v) => {
    const body = { name: v.name.trim(), slug: v.slug.trim(), description: v.description.trim() || null, status: v.status, mode: v.mode, engine: v.engine, model: v.model.trim() || null, language: v.language, confidence_min: v.confidence_min === null ? 0.8 : v.confidence_min, knowledge: v.knowledge, tools: v.tools, system_prompt: v.system_prompt || null };
    const out = a ? await ctx.api.patch('/api/ai/agents/' + a.id, body) : await ctx.api.post('/api/ai/agents', body);
    toast(a ? 'Agent saved' : 'Agent created', 'ok');
    return out && out.id ? out : (out && out.row ? out.row : { id: a ? a.id : null });
  } });
}

export async function bindDialog(ctx, a, presetProject) {
  const numbers = await ctx.api.get('/api/whatsapp/numbers').then((r) => r.items || [], () => []);
  const links = []; numbers.forEach((n) => (n.projects || []).forEach((l) => links.push({ value: l.inbox_id, label: ctx.projectName(l.project_id) + ' · ' + (l.display_name || n.display_name || n.instance), project: l.project_id })));
  return dialogForm({ title: 'Bind ' + a.name + ' to a project', intro: 'Without a number the agent serves every number of the project. Lower priority wins when several agents match.', fields: [
    { name: 'project_id', label: 'Project', type: 'select', required: true, value: presetProject || '', options: ctx.projects().map((p) => ({ value: p.id, label: p.display_name })) },
    { name: 'inbox_id', label: 'Number (optional)', type: 'select', value: '', placeholder: 'every number of the project', options: links },
    { name: 'priority', label: 'Priority', type: 'number', value: 100, min: 0, max: 10000, step: 1 }
  ], submitLabel: 'Bind', onSubmit: async (v) => { await ctx.api.post('/api/ai/agents/' + a.id + '/projects', { project_id: v.project_id, inbox_id: v.inbox_id ? Number(v.inbox_id) : undefined, priority: v.priority === null ? undefined : v.priority }); toast('Bound to ' + ctx.projectName(v.project_id), 'ok'); return true; } });
}

export async function renderAgent(main, params, query, ctx) {
  const id = params.id;
  ctx.crumbs([{ label: 'AI', href: '#/ai' }, { label: 'Agent #' + id }]);
  const box = h('div', { class: 'stack' }, skeletonRows(6)); main.appendChild(box);
  let a; try { a = await ctx.api.get('/api/ai/agents/' + id); } catch (err) { clear(box); box.appendChild(errorBox(err)); return; }
  a = a.row || a;
  clear(box);
  ctx.crumbs([{ label: 'AI', href: '#/ai' }, { label: a.name }]);
  const admin = ctx.can('admin');
  main.insertBefore(pageHead('Agent · ' + a.slug, a.name, a.description || '', [
    h('a', { class: 'btn btn-ghost', href: '#/ai' }, 'Back'),
    admin ? h('button', { class: 'btn btn-primary', type: 'button', onClick: () => agentDialog(ctx, a).then((ok) => { if (ok) renderAgent(clear(main), params, query, ctx); }) }, 'Edit') : null,
    admin ? h('button', { class: 'btn btn-secondary', type: 'button', onClick: () => bindDialog(ctx, a).then((ok) => { if (ok) renderAgent(clear(main), params, query, ctx); }) }, 'Bind to project') : null,
    ctx.can('owner') ? h('button', { class: 'btn btn-danger', type: 'button', onClick: async () => { if (!await confirmDialog({ title: 'Delete ' + a.name + '?', body: 'Refused while conversations reference it — archive it instead.', confirmLabel: 'Delete', danger: true })) return; try { await ctx.api.del('/api/ai/agents/' + a.id); toast('Agent deleted', 'ok'); location.hash = '#/ai'; } catch (err) { toast(err.detail || 'Delete failed.', 'danger', 5000); } } }, 'Delete') : null
  ]), box);
  const st = a.stats || {};
  box.appendChild(h('div', { class: 'grid cols-3' },
    h('div', { class: 'card' }, cardHead('Configuration'), kv([['Status', badge(a.status)], ['Mode', badge(a.mode, a.mode === 'auto' ? 'ok' : a.mode === 'suggest' ? 'info' : 'mock')], ['Engine', badge(a.engine)], ['Model', a.model ? h('code', {}, a.model) : 'pool default'], ['Language', a.language], ['Min confidence', Math.round(Number(a.confidence_min || 0) * 100) + '%'], ['Knowledge', badge(a.knowledge === false ? 'no' : 'yes', a.knowledge === false ? 'mock' : 'ok')], ['Tools', (a.tools || []).length ? h('div', { class: 'chips' }, a.tools.map((t) => chip(t, 'mono'))) : 'none'], ['Runs 24 h', String(st.runs_24h === undefined ? '—' : st.runs_24h)], ['Handoffs 24 h', String(st.handoffs_24h === undefined ? '—' : st.handoffs_24h)], ['Updated', fmtDate(a.updated_at)]])),
    h('div', { class: 'card' }, cardHead('Project bindings'), (a.projects || []).length ? h('div', { class: 'stack sm' }, a.projects.map((l) => h('div', { class: 'fact' }, h('span', {}, chip(ctx.projectName(l.project_id), 'project'), ' ', l.inbox_id ? 'inbox #' + l.inbox_id : 'every number', ' · priority ' + (l.priority === undefined ? '—' : l.priority), ' ', l.enabled === false ? badge('disabled', 'mock') : null), admin ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: async () => { try { await ctx.api.del('/api/ai/agents/' + a.id + '/projects/' + (l.id || l.link_id)); toast('Unbound', 'ok'); renderAgent(clear(main), params, query, ctx); } catch (err) { toast(err.detail || 'Unbind failed.', 'danger'); } } }, 'Unbind') : null))) : h('p', { class: 'dim' }, 'Not bound to any project: it never runs.')),
    h('div', { class: 'card' }, cardHead('System prompt'), a.system_prompt ? h('pre', { class: 'json' }, a.system_prompt) : h('p', { class: 'dim' }, a.engine === 'llm' ? 'No system prompt: the pool default persona applies.' : 'engine-173 is deterministic; it uses no prompt.'))
  ));
  box.appendChild(testPanel(ctx, a, qget(query, 'test') === '1'));
  box.appendChild(runsPanel(ctx, { agent: a.id, project: ctx.project(), title: 'Recent runs of this agent' }));
}

function testPanel(ctx, a, focus) {
  const manager = ctx.can('manager');
  const projects = (a.projects || []).map((l) => l.project_id);
  const ps = h('select', { class: 'select', 'aria-label': 'Project' }, ctx.projects().map((p) => h('option', { value: p.id, selected: (projects[0] === p.id) || (ctx.projectId() === p.id && !projects.length) || undefined }, p.display_name)));
  const text = h('textarea', { class: 'textarea', rows: 3, placeholder: 'e.g.  Bonjour, prix et disponibilité du filtre à huile pour Korando 2015 ?', 'aria-label': 'Customer message to test' });
  const out = h('div', {});
  const run = h('button', { class: 'btn btn-primary', type: 'button', disabled: !manager || undefined, onClick: async () => {
    const t = text.value.trim(); if (!t) return;
    run.disabled = true; clear(out); out.appendChild(skeletonRows(3));
    try {
      const r = await ctx.api.post('/api/ai/agents/' + a.id + '/test', { project_id: ps.value, text: t });
      clear(out);
      const facts = r.facts || {};
      out.appendChild(h('div', { class: 'grid cols-3' },
        kv([['Decision', badge(r.decision || '—', r.decision === 'reply' || r.decision === 'suggest' ? 'ok' : r.decision === 'handoff' ? 'danger' : 'warn')], ['Intent', r.intent ? badge(r.intent, 'accent') : '—'], ['Confidence', r.confidence === undefined ? '—' : Math.round(Number(r.confidence) * 100) + '%'], ['Engine', r.engine || a.engine], ['Model', r.model || '—']]),
        h('div', {}, h('h4', { class: 'view-kicker' }, 'Facts'), Array.isArray(facts) ? json(facts) : h('div', { class: 'fact-list' }, ['required', 'verified', 'unknown'].filter((k) => facts[k]).map((k) => h('div', { class: 'fact' }, k, h('span', {}, (facts[k] || []).join(', ') || '—'))))),
        h('div', {}, h('h4', { class: 'view-kicker' }, 'Tools used'), (r.tools_used || []).length ? h('div', { class: 'chips' }, r.tools_used.map((x) => chip((typeof x === 'string' ? x : x.tool) + (x.ok === false ? ' ✗' : '') + (x.ms ? ' ' + x.ms + ' ms' : ''), 'mono'))) : h('p', { class: 'dim' }, 'none'))));
      out.appendChild(h('h4', { class: 'view-kicker' }, 'Proposed message'));
      out.appendChild(r.text ? h('div', { class: 'proposed' }, r.text) : empty('No automatic reply', 'A human answers this one.'));
    } catch (err) { clear(out); out.appendChild(errorBox(err)); }
    finally { run.disabled = !manager; }
  } }, 'Test (dry-run, nothing is sent)');
  const card = h('div', { class: 'card sim-out' }, cardHead('Test agent', [badge('never sends', 'ok')]), h('p', {}, 'Runs the agent on a synthetic message with the chosen project\'s tools, dry-run forced: no conversation, no send. Shows the decision, intent, confidence, facts and tools.'), h('div', { class: 'field' }, h('label', {}, 'Project context'), ps), text, h('div', {}, run), roleNote(ctx, 'manager', 'Testing'), out);
  if (focus) setTimeout(() => text.focus(), 50);
  return card;
}

function toolsPanel(ctx) {
  const box = h('div', {}, skeletonRows(3));
  ctx.api.get('/api/ai/tools').then((r) => {
    const items = Array.isArray(r) ? r : (r.items || r.tools || []);
    clear(box);
    if (!items.length) { box.appendChild(empty('No tool registered')); return; }
    box.appendChild(h('div', { class: 'card' }, cardHead('Tool registry', [badge('read-only tools', 'ok')]), h('p', {}, 'An agent may only run the tools listed on it. No write tool exists.'), simpleTable([{ label: 'Tool', cell: (t) => h('code', {}, t.id) }, { label: 'Label', cell: (t) => t.label }, { label: 'Scope', cell: (t) => badge(t.scope, 'info') }, { label: 'Requires', cell: (t) => t.requires ? badge(t.requires, 'warn') : null }, { label: 'Description', cell: (t) => t.description, cls: 'dim' }], items, { noScroll: true })));
  }, (err) => { clear(box); box.appendChild(errorBox(err)); });
  return box;
}

export function runsPanel(ctx, opts) {
  const root = h('div', { class: 'card' });
  let project = opts.project || 'all';
  const picker = h('select', { class: 'select', 'aria-label': 'Project' }, h('option', { value: 'all' }, 'All projects'), ctx.projects().map((p) => h('option', { value: p.id, selected: p.id === project || undefined }, p.display_name)));
  picker.onchange = () => { project = picker.value; load(); };
  root.appendChild(cardHead(opts.title || 'AI runs', [picker]));
  const box = h('div', {}); root.appendChild(box);
  async function load() {
    clear(box); box.appendChild(skeletonRows(4));
    let r; try { r = await ctx.api.get('/api/ai/runs' + ctx.api.qs({ project, agent: opts.agent, limit: 100 })); } catch (err) { clear(box); box.appendChild(errorBox(err, load)); return; }
    clear(box);
    const items = r.items || [];
    if (!items.length) { box.appendChild(empty('No run yet')); return; }
    box.appendChild(simpleTable([
      { label: 'When', cell: (x) => relTime(x.created_at || x.at), cls: 'dim' },
      { label: 'Project', cell: (x) => x.project_id ? chip(ctx.projectName(x.project_id), 'project') : null },
      { label: 'Agent', cell: (x) => x.agent_name || (x.agent_id ? '#' + x.agent_id : null) },
      { label: 'Kind', cell: (x) => badge(x.kind, 'info') },
      { label: 'Decision', cell: (x) => x.decision ? badge(x.decision, x.decision === 'handoff' ? 'danger' : x.decision === 'suggest' || x.decision === 'reply' ? 'ok' : 'warn') : null },
      { label: 'Intent', cell: (x) => x.intent },
      { label: 'Confidence', cell: (x) => x.confidence === null || x.confidence === undefined ? null : Math.round(Number(x.confidence) * 100) + '%', cls: 'num' },
      { label: 'Model', cell: (x) => x.model ? h('code', {}, x.model) : null },
      { label: 'Tools', cell: (x) => (x.tools_used || []).length ? (x.tools_used || []).map((t) => typeof t === 'string' ? t : t.tool).join(', ') : null, cls: 'dim' },
      { label: 'Conversation', cell: (x) => x.conversation_id ? h('a', { href: '#/inbox/' + x.conversation_id + (x.project_id ? '?project=' + encodeURIComponent(x.project_id) : '') }, '#' + x.conversation_id) : null },
      { label: 'ms', cell: (x) => x.latency_ms === undefined ? null : String(x.latency_ms), cls: 'num' },
      { label: 'Error', cell: (x) => x.error, cls: 'dim' }
    ], items, { compact: true }));
  }
  load();
  return root;
}
