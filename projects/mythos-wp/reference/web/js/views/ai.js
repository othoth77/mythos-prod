/* MYTHOS Control Center — AI agents: the agent cards + create / edit / bind
   (reached from a project's Advanced tab), the agent page and the runs
   table (Settings → System, project Advanced). */
import { h, clear, badge, fmtDate, relTime, skeletonRows, errorBox, empty, toast, chip, kv, pageHead, cardHead, simpleTable, dialogForm, confirmDialog, details } from '../ui.js';

/* Agent cards; opts.project filters to agents bound to that project. */
export function agentsPanel(ctx, opts) {
  const project = opts.project || null;
  const admin = ctx.can('admin');
  const root = h('div', { class: 'stack' });
  root.appendChild(h('div', { class: 'toolbar' }, h('p', { class: 'dim' }, project ? 'Agents bound to this project.' : 'Every agent.'), h('div', { class: 'spacer' }), h('button', { class: 'btn btn-primary btn-sm', type: 'button', disabled: !admin || undefined, onClick: () => agentDialog(ctx, null).then((a) => { if (a) { load(); if (a.id) location.hash = '#/ai/agents/' + a.id; } }) }, 'New agent')));
  const box = h('div', {}); root.appendChild(box);
  async function load() {
    clear(box); box.appendChild(skeletonRows(3));
    let r; try { r = await ctx.api.get('/api/ai/agents'); } catch (err) { clear(box); box.appendChild(errorBox(err, load)); return; }
    clear(box);
    let items = r.items || [];
    if (project) items = items.filter((a) => (a.projects || []).some((l) => l.project_id === project));
    if (!items.length) { box.appendChild(empty('No agent', project ? 'Create an agent or bind an existing one.' : 'Create the first agent.')); return; }
    box.appendChild(h('div', { class: 'grid cols-3' }, items.map((a) => agentCard(ctx, a, load, project))));
  }
  load();
  return root;
}

function agentCard(ctx, a, reload, project) {
  return h('div', { class: 'card agent-card' + (a.status !== 'active' ? ' muted' : '') },
    cardHead(a.name, [badge(a.mode, a.mode === 'auto' ? 'ok' : a.mode === 'suggest' ? 'info' : 'mock'), badge(a.status)]),
    h('p', {}, a.description || 'No description.'),
    h('div', { class: 'chips' }, (a.projects || []).length ? a.projects.map((l) => chip(ctx.projectName(l.project_id) + (l.enabled === false ? ' (off)' : ''), 'project')) : h('span', { class: 'dim' }, 'not bound to any project')),
    h('div', { class: 'view-actions' }, h('a', { class: 'btn btn-secondary btn-sm', href: '#/ai/agents/' + a.id }, 'Open'), ctx.can('admin') ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: () => bindDialog(ctx, a, project).then((ok) => { if (ok) reload(); }) }, 'Bind') : null));
}

export async function agentDialog(ctx, a) {
  const tools = await ctx.api.get('/api/ai/tools').then((x) => Array.isArray(x) ? x : (x.items || x.tools || []), () => []);
  return dialogForm({ title: a ? 'Edit agent · ' + a.name : 'New agent', wide: true, fields: [
    { name: 'name', label: 'Name', required: true, value: a ? a.name : '' },
    { name: 'slug', label: 'Slug (a-z0-9-)', required: true, mono: true, value: a ? a.slug : '' },
    { name: 'description', label: 'Description', type: 'textarea', rows: 2, value: a ? a.description || '' : '' },
    { name: 'status', label: 'Status', type: 'select', required: true, value: a ? a.status : 'active', options: ['active', 'paused', 'archived'] },
    { name: 'mode', label: 'Mode', type: 'select', required: true, value: a ? a.mode : 'suggest', options: [{ value: 'off', label: 'Off — never runs' }, { value: 'suggest', label: 'Suggest — proposes, a human sends' }, { value: 'auto', label: 'Auto — sends when sure' }] },
    { name: 'engine', label: 'Engine', type: 'select', required: true, value: a ? a.engine : 'engine-173', options: [{ value: 'engine-173', label: 'Deterministic (no network)' }, { value: 'llm', label: 'Language model (fact-guarded)' }] },
    { name: 'model', label: 'Model (language model engine, optional)', mono: true, value: a ? a.model || '' : '', help: 'Empty = provider default.' },
    { name: 'language', label: 'Language', type: 'select', required: true, value: a ? a.language : 'fr', options: ['fr', 'ar', 'en'] },
    { name: 'confidence_min', label: 'Minimum confidence for automatic replies', type: 'number', value: a ? Number(a.confidence_min) : 0.8, min: 0, max: 1, step: 0.05 },
    { name: 'knowledge', label: 'May use the project knowledge base', type: 'checkbox', value: a ? a.knowledge !== false : true },
    { name: 'tools', label: 'Tools (only listed tools run)', type: 'multiselect', value: a ? a.tools || [] : [], options: tools.map((t) => ({ value: t.id, label: t.id + (t.requires ? ' (needs ' + t.requires + ')' : '') + ' — ' + (t.label || '') })) },
    { name: 'system_prompt', label: 'Instructions (language model engine)', type: 'textarea', rows: 6, value: a ? a.system_prompt || '' : '', help: 'Persona and instructions. Never a credential.' }
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
  return dialogForm({ title: 'Bind ' + a.name + ' to a project', intro: 'Without a number the agent serves every number of the project.', fields: [
    { name: 'project_id', label: 'Project', type: 'select', required: true, value: presetProject || '', options: ctx.projects().map((p) => ({ value: p.id, label: p.display_name })) },
    { name: 'inbox_id', label: 'Number (optional)', type: 'select', value: '', placeholder: 'every number of the project', options: links },
    { name: 'priority', label: 'Priority (lower wins)', type: 'number', value: 100, min: 0, max: 10000, step: 1 }
  ], submitLabel: 'Bind', onSubmit: async (v) => { await ctx.api.post('/api/ai/agents/' + a.id + '/projects', { project_id: v.project_id, inbox_id: v.inbox_id ? Number(v.inbox_id) : undefined, priority: v.priority === null ? undefined : v.priority }); toast('Bound to ' + ctx.projectName(v.project_id), 'ok'); return true; } });
}

export async function renderAgent(main, params, query, ctx) {
  const id = params.id;
  ctx.crumbs([{ label: 'Projects', href: '#/projects' }, { label: 'Agent #' + id }]);
  const box = h('div', { class: 'stack' }, skeletonRows(6)); main.appendChild(box);
  let a; try { a = await ctx.api.get('/api/ai/agents/' + id); } catch (err) { clear(box); box.appendChild(errorBox(err)); return; }
  a = a.row || a;
  clear(box);
  ctx.crumbs([{ label: 'Projects', href: '#/projects' }, { label: a.name }]);
  const admin = ctx.can('admin');
  const reload = () => renderAgent(clear(main), params, query, ctx);
  main.insertBefore(pageHead(null, a.name, a.description || '', [
    admin ? h('button', { class: 'btn btn-primary', type: 'button', onClick: () => agentDialog(ctx, a).then((ok) => { if (ok) reload(); }) }, 'Edit') : null,
    admin ? h('button', { class: 'btn btn-secondary', type: 'button', onClick: () => bindDialog(ctx, a).then((ok) => { if (ok) reload(); }) }, 'Bind to project') : null,
    ctx.can('owner') ? h('button', { class: 'btn btn-danger', type: 'button', onClick: async () => { if (!await confirmDialog({ title: 'Delete ' + a.name + '?', body: 'Refused while conversations reference it — archive it instead.', confirmLabel: 'Delete', danger: true })) return; try { await ctx.api.del('/api/ai/agents/' + a.id); toast('Agent deleted', 'ok'); location.hash = '#/projects'; } catch (err) { toast(err.detail || 'Delete failed.', 'danger', 5000); } } }, 'Delete') : null
  ]), box);
  box.appendChild(h('div', { class: 'grid cols-2' },
    h('div', { class: 'card' }, cardHead('Agent'), kv([['Status', badge(a.status)], ['Mode', badge(a.mode, a.mode === 'auto' ? 'ok' : a.mode === 'suggest' ? 'info' : 'mock')], ['Language', a.language], ['Updated', fmtDate(a.updated_at)]])),
    h('div', { class: 'card' }, cardHead('Projects'), (a.projects || []).length ? h('div', { class: 'stack xs' }, a.projects.map((l) => h('div', { class: 'fact' }, h('span', {}, chip(ctx.projectName(l.project_id), 'project'), ' ', l.inbox_id ? 'one number' : 'every number', ' ', l.enabled === false ? badge('disabled', 'mock') : null), admin ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: async () => { try { await ctx.api.del('/api/ai/agents/' + a.id + '/projects/' + (l.id || l.link_id)); toast('Unbound', 'ok'); reload(); } catch (err) { toast(err.detail || 'Unbind failed.', 'danger'); } } }, 'Unbind') : null))) : h('p', { class: 'dim' }, 'Not bound to any project: it never runs.'))));
  box.appendChild(details('Advanced', [
    kv([['Slug', h('code', {}, a.slug)], ['Engine', a.engine], ['Model', a.model ? h('code', {}, a.model) : 'default'], ['Min confidence', Math.round(Number(a.confidence_min || 0) * 100) + '%'], ['Knowledge', badge(a.knowledge === false ? 'no' : 'yes', a.knowledge === false ? 'mock' : 'ok')], ['Tools', (a.tools || []).length ? h('div', { class: 'chips' }, a.tools.map((t) => chip(t, 'mono'))) : 'none']]),
    h('h4', {}, 'Instructions'), a.system_prompt ? h('pre', { class: 'json' }, a.system_prompt) : h('p', { class: 'dim' }, 'No instructions set.'),
    runsPanel(ctx, { agent: a.id, project: ctx.project(), title: 'Recent runs' })
  ]));
}

export function runsPanel(ctx, opts) {
  const root = h('div', { class: 'card' });
  let project = opts.project || 'all';
  const picker = h('select', { class: 'select', 'aria-label': 'Project' }, h('option', { value: 'all' }, 'All projects'), ctx.projects().map((p) => h('option', { value: p.id, selected: p.id === project || undefined }, p.display_name)));
  picker.onchange = () => { project = picker.value; load(); };
  root.appendChild(cardHead(opts.title || 'AI runs', opts.fixed ? null : [picker]));
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
      { label: 'Decision', cell: (x) => x.decision ? badge(x.decision === 'handoff' ? 'Hand to human' : x.decision, x.decision === 'handoff' ? 'danger' : x.decision === 'suggest' || x.decision === 'reply' ? 'ok' : 'warn') : null },
      { label: 'Intent', cell: (x) => x.intent ? String(x.intent).replace(/_/g, ' ') : null },
      { label: 'Confidence', cell: (x) => x.confidence === null || x.confidence === undefined ? null : Math.round(Number(x.confidence) * 100) + '%', cls: 'num' },
      { label: 'Conversation', cell: (x) => x.conversation_id ? h('a', { href: '#/inbox/' + x.conversation_id + (x.project_id ? '?project=' + encodeURIComponent(x.project_id) : '') }, '#' + x.conversation_id) : null },
      { label: 'Error', cell: (x) => x.error, cls: 'dim' }
    ], items, { compact: true }));
  }
  load();
  return root;
}
