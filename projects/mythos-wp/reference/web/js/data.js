/* MYTHOS Control Center — shared loaders: WhatsApp numbers, AI agents and the
   per-project summary (numbers + agent) the dashboard and the project list
   share. Every call is best effort: a missing endpoint yields an empty list. */
import { api } from './api.js';

export function loadNumbers() { return api.get('/api/whatsapp/numbers').then((r) => r.items || [], () => []); }
export function loadAgents() { return api.get('/api/ai/agents').then((r) => r.items || [], () => []); }

/* Links of a project across the number list: [{ number, link }]. */
export function linksOf(numbers, projectId) {
  const out = [];
  numbers.forEach((n) => (n.projects || []).forEach((l) => { if (l.project_id === projectId) out.push({ number: n, link: l }); }));
  return out;
}
/* The agent bound at project level (lowest priority wins), or null. */
export function agentOf(agents, projectId) {
  const hits = [];
  agents.forEach((a) => (a.projects || []).forEach((l) => { if (l.project_id === projectId && l.enabled !== false) hits.push({ a, p: l.priority === undefined ? 100 : l.priority }); }));
  hits.sort((x, y) => x.p - y.p);
  return hits.length ? hits[0].a : null;
}

/* Per-project summary: { whatsapp: [{ phone_masked, status }], ai: { agent, mode } }.
   Prefers the dashboard's activity item (V2.1 fields); falls back to the number and agent lists. */
export function summarize(activityItem, numbers, agents, projectId) {
  const out = { whatsapp: [], ai: { agent: null, mode: 'off' } };
  if (activityItem && Array.isArray(activityItem.whatsapp)) out.whatsapp = activityItem.whatsapp;
  else out.whatsapp = linksOf(numbers, projectId).map((x) => ({ phone_masked: x.number.phone_masked, status: x.number.status }));
  if (activityItem && activityItem.ai && typeof activityItem.ai === 'object') out.ai = { agent: activityItem.ai.agent || null, mode: activityItem.ai.mode || 'off' };
  else { const a = agentOf(agents, projectId); out.ai = a ? { agent: a.name, mode: a.mode || 'off' } : { agent: null, mode: 'off' }; }
  return out;
}
export function aiWords(mode) { return { off: 'Off', suggest: 'Suggest', auto: 'Auto', inherit: 'Inherit' }[mode] || (mode ? String(mode) : 'Off'); }
