/* MYTHOS Control Center — Integrations: Evolution, Kitchen, n8n, Meta Cloud,
   Meta MCP, MYTHOS MCP, free-LLM pool, database. Secrets are referenced by
   env var NAME only; the API never returns a value and this view never asks. */
import { h, clear, badge, fmtDate, relTime, skeletonRows, errorBox, empty, toast, chip, kv, pageHead, cardHead, dialogForm, drawer, confirmDialog, hostOf, json, roleNote } from '../ui.js';

export async function render(main, params, query, ctx) {
  ctx.crumbs([{ label: 'Integrations' }]);
  main.appendChild(pageHead('Connections', 'Integrations', 'External systems this panel talks to. Credentials live in environment variables or 0600 files named here — never stored, never displayed.'));
  main.appendChild(integrationsPanel(ctx, { project: ctx.projectId() }));
}

export function integrationsPanel(ctx, opts) {
  const root = h('div', { class: 'stack' });
  const admin = ctx.can('admin');
  const project = opts.project || null;
  root.appendChild(h('div', { class: 'toolbar' }, h('p', { class: 'dim' }, project ? 'Integrations of this project plus platform-wide ones.' : 'Platform-wide and project integrations.'), h('div', { class: 'spacer' }), h('button', { class: 'btn btn-primary', type: 'button', disabled: !admin || undefined, onClick: () => editDialog(null).then((ok) => { if (ok) load(); }) }, 'New integration')));
  const box = h('div', {}); root.appendChild(box);
  async function load() {
    clear(box); box.appendChild(skeletonRows(4));
    let r; try { r = await ctx.api.get('/api/integrations'); } catch (err) { clear(box); box.appendChild(errorBox(err, load)); return; }
    clear(box);
    let items = r.items || [];
    if (project) items = items.filter((i) => !i.project_id || i.project_id === project);
    if (!items.length) { box.appendChild(empty('No integration', 'Defaults are seeded at server start.')); return; }
    box.appendChild(h('div', { class: 'grid cols-3' }, items.map(card)));
  }
  function card(i) {
    return h('div', { class: 'card integration-card' + (i.status === 'disabled' ? ' muted' : '') },
      cardHead(i.name, [badge(i.kind, 'info'), badge(i.status)]),
      h('div', { class: 'chips' }, chip(i.key, 'mono'), i.project_id ? chip(ctx.projectName(i.project_id), 'project') : chip('platform-wide')),
      kv([['Health', h('span', { class: 'health-cell' }, badge(i.health_state || 'unknown'), i.health_detail ? h('span', { class: 'dim clamp', title: i.health_detail }, ' ' + i.health_detail) : null)], ['Credentials', h('span', {}, badge(i.credentials_state || 'unknown'), i.credential_env ? h('code', {}, ' ' + i.credential_env) : null)], ['Host', h('span', { class: 'mono' }, hostOf(i.base_url))], ['Last OK', relTime(i.last_ok_at)], ['Last error', i.last_error ? h('span', { class: 'danger-text' }, i.last_error) : null], ['Checked', relTime(i.last_checked_at)]]),
      h('div', { class: 'view-actions' },
        h('button', { class: 'btn btn-secondary btn-sm', type: 'button', disabled: !admin || undefined, onClick: async (e) => { e.target.disabled = true; try { const t = await ctx.api.post('/api/integrations/' + encodeURIComponent(i.key) + '/test', {}); toast(i.name + ': ' + (t.status || '?') + (t.detail ? ' · ' + (typeof t.detail === 'string' ? t.detail : JSON.stringify(t.detail)) : ''), t.status === 'ok' ? 'ok' : 'warn', 6000); load(); } catch (err) { toast(err.detail || 'Test failed.', 'danger'); e.target.disabled = !admin; } } }, 'Test'),
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: () => details(i) }, 'Details'),
        admin ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: () => editDialog(i).then((ok) => { if (ok) load(); }) }, 'Edit') : null));
  }
  function details(i) {
    const d = drawer({ title: i.name, wide: true });
    d.body.append(kv([['Key', h('code', {}, i.key)], ['Kind', i.kind], ['Status', badge(i.status)], ['Base URL', i.base_url ? h('code', {}, i.base_url) : null], ['Credential env (name only)', i.credential_env ? h('code', {}, i.credential_env) : 'none required'], ['Credentials state', badge(i.credentials_state || 'unknown')], ['Health', badge(i.health_state || 'unknown')], ['Health detail', i.health_detail], ['Last OK', fmtDate(i.last_ok_at)], ['Last error', i.last_error], ['Last checked', fmtDate(i.last_checked_at)], ['Created', fmtDate(i.created_at)]]), h('h4', {}, 'Configuration (non-secret)'), json(i.config || {}),
      ctx.can('owner') ? h('div', { class: 'view-actions' }, h('button', { class: 'btn btn-danger btn-sm', type: 'button', onClick: async () => { if (!await confirmDialog({ title: 'Delete integration ' + i.key + '?', confirmLabel: 'Delete', danger: true })) return; try { await ctx.api.del('/api/integrations/' + encodeURIComponent(i.key)); toast('Deleted', 'ok'); d.close(); load(); } catch (err) { toast(err.detail || 'Delete failed.', 'danger'); } } }, 'Delete')) : null);
  }
  function editDialog(i) {
    return dialogForm({ title: i ? 'Edit ' + i.name : 'New integration', intro: 'Never paste a secret here: only the NAME of the environment variable (or file-path variable) that holds it.', wide: true, fields: [
      { name: 'key', label: 'Key (a-z0-9-)', required: true, mono: true, value: i ? i.key : '' },
      { name: 'kind', label: 'Kind', type: 'select', required: true, value: i ? i.kind : 'api', options: ['whatsapp_provider', 'kitchen', 'n8n', 'mcp', 'api', 'project_system', 'database', 'llm'] },
      { name: 'name', label: 'Name', required: true, value: i ? i.name : '' },
      { name: 'project_id', label: 'Project (empty = platform-wide)', type: 'select', value: i ? i.project_id || '' : (project || ''), placeholder: 'platform-wide', options: ctx.projects().map((p) => ({ value: p.id, label: p.display_name })) },
      { name: 'base_url', label: 'Base URL (loopback or https)', mono: true, value: i ? i.base_url || '' : '' },
      { name: 'credential_env', label: 'Credential env var NAME', mono: true, value: i ? i.credential_env || '' : '', help: 'e.g. MYTHOS_WP_EVOLUTION_API_KEY_FILE — the value is read by the server only.' },
      { name: 'status', label: 'Status', type: 'select', required: true, value: i ? i.status : 'enabled', options: ['enabled', 'disabled'] },
      { name: 'config', label: 'Config JSON (non-secret)', type: 'json', value: i ? i.config || {} : {} }
    ], onSubmit: async (v) => {
      const body = { key: v.key.trim(), kind: v.kind, name: v.name.trim(), project_id: v.project_id || null, base_url: v.base_url.trim() || null, credential_env: v.credential_env.trim() || null, status: v.status, config: v.config || {} };
      if (i) { delete body.key; await ctx.api.patch('/api/integrations/' + encodeURIComponent(i.key), body); } else await ctx.api.post('/api/integrations', body);
      toast('Integration saved', 'ok'); return true;
    } });
  }
  load();
  if (!admin) root.appendChild(roleNote(ctx, 'admin', 'Testing or editing integrations'));
  return root;
}
