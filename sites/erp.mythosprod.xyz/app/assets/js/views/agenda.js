/* Agenda: events, tasks and reminders. Two tabs over the same resource —
 * Liste (the generic registry-driven table, search/filter/sort/paginate) and
 * Calendrier (a month grid built from the same /agenda_events data with a
 * date range). Nothing here invents a second data model: both views read
 * agenda_events through the declared contract in GET /meta. */
import { api, qs, describeError } from '../api.js';
import { session } from '../session.js';
import { h, clear, tabs, skeletonRows, empty, errorBox, toast, modal, closeModal, confirmDialog,
  field, input, select, fmtDate, badge, statusBadge } from '../ui.js';
import { resourceView } from './resource.js';

const TABS = [{ key: 'list', label: 'Liste' }, { key: 'calendar', label: 'Calendrier' }];
const KIND_LABEL = { event: 'Événement', task: 'Tâche', reminder: 'Rappel' };
const KIND_GLYPH = { event: '●', task: '☑', reminder: '◔' };
const PRIORITY_TONE = { high: 'danger', normal: '', low: 'info' };

export function agendaView(container, route) {
  const active = TABS.some((t) => t.key === route.resource) ? route.resource : 'list';
  container.appendChild(tabs(TABS, active, (k) => { window.location.hash = '#/agenda/' + k; }));
  const panel = h('div', { id: 'panel-' + active, role: 'tabpanel', 'aria-labelledby': 'tab-' + active });
  container.appendChild(panel);
  if (active === 'calendar') return calendarView(panel);
  return resourceView('agenda_events', panel);
}

function monthBounds(d) {
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return { start, end, from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}
function ymd(d) { return d.toISOString().slice(0, 10); }

function calendarView(root) {
  const meta = session.meta().resources.agenda_events;
  let cursor = new Date();
  const head = h('div', { class: 'toolbar' });
  const title = h('h3', {});
  head.append(
    h('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: '← Mois précédent', onClick: () => { cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() - 1, 1)); render(); } }),
    title,
    h('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Mois suivant →', onClick: () => { cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1)); render(); } }),
    h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn btn-primary btn-sm', text: 'Nouveau', onClick: () => itemForm(null, render) })));
  const grid = h('div', {});
  root.append(head, grid);
  render();

  async function render() {
    const { start, from, to } = monthBounds(cursor);
    title.textContent = start.toLocaleDateString('fr-TN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    clear(grid).appendChild(skeletonRows(6));
    try {
      const page = await api.get('/agenda_events' + qs({ from, to, limit: 200, sort: 'starts_at', dir: 'asc' }));
      clear(grid);
      if (!page.rows.length) { grid.appendChild(empty('Rien ce mois-ci', 'Aucun événement, tâche ou rappel dans cette période.')); return; }
      const byDay = {};
      page.rows.forEach((r) => { const k = String(r.starts_at).slice(0, 10); (byDay[k] = byDay[k] || []).push(r); });
      const firstDow = (start.getUTCDay() + 6) % 7; // Monday-first grid
      const daysInMonth = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
      const cal = h('div', { class: 'calendar-grid' });
      ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].forEach((d) => cal.appendChild(h('div', { class: 'calendar-dow', text: d })));
      for (let i = 0; i < firstDow; i++) cal.appendChild(h('div', { class: 'calendar-cell is-empty' }));
      for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = ymd(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), day)));
        const items = byDay[dateStr] || [];
        const isToday = dateStr === ymd(new Date());
        const itemButtons = items.slice(0, 4).map((r) => {
          const glyph = h('span', { class: 'glyph', 'aria-hidden': 'true', text: KIND_GLYPH[r.kind] });
          const label = h('span', { text: r.title });
          return h('button', { type: 'button', class: 'calendar-item status-' + r.status,
            title: r.title + ' — ' + KIND_LABEL[r.kind], onClick: () => itemDetail(r, render) }, glyph, label);
        });
        const cell = h('div', { class: 'calendar-cell' + (isToday ? ' is-today' : '') },
          h('span', { class: 'calendar-daynum', text: String(day) }),
          h('div', { class: 'calendar-items' }, itemButtons),
          items.length > 4 ? h('span', { class: 'calendar-more', text: '+' + (items.length - 4) }) : null);
        cal.appendChild(cell);
      }
      grid.appendChild(cal);
    } catch (e) { clear(grid).appendChild(errorBox(describeError(e), render, e.body && e.body.error)); }
  }
}

function itemDetail(row, done) {
  const dl = h('dl', { class: 'kv' });
  [['Type', KIND_LABEL[row.kind]], ['Titre', row.title], ['Début', fmtDate(row.starts_at)], ['Fin', row.ends_at ? fmtDate(row.ends_at) : '—'],
    ['Lieu', row.location || '—'], ['Statut', row.status], ['Priorité', row.priority], ['Description', row.description || '—']]
    .forEach(([k, v]) => dl.append(h('dt', { text: k }), h('dd', { text: v })));
  modal({ title: row.title, body: dl, actions: [
    h('button', { type: 'button', class: 'btn btn-secondary', text: 'Modifier', onClick: () => { closeModal(); itemForm(row, done); } }),
    h('button', { type: 'button', class: 'btn btn-ghost', text: 'Fermer', onClick: closeModal })
  ] });
}

async function itemForm(row, done) {
  const meta = session.meta().resources.agenda_events;
  const isEdit = !!row;
  const kindSel = select(meta.enums.kind.map((k) => ({ value: k, label: KIND_LABEL[k] || k, selected: row && row.kind === k })), { name: 'kind' });
  const statusSel = select(meta.enums.status.map((s) => ({ value: s, label: s, selected: (row ? row.status : 'scheduled') === s })), { name: 'status' });
  const prioSel = select(meta.enums.priority.map((p) => ({ value: p, label: p, selected: (row ? row.priority : 'normal') === p })), { name: 'priority' });
  const form = h('div', { class: 'field-row' },
    field('Type', kindSel), field('Statut', statusSel), field('Priorité', prioSel),
    field('Titre', input({ name: 'title', value: (row && row.title) || '', required: true })),
    field('Début', input({ name: 'starts_at', type: 'datetime-local', value: row ? String(row.starts_at).slice(0, 16) : new Date().toISOString().slice(0, 16), required: true })),
    field('Fin', input({ name: 'ends_at', type: 'datetime-local', value: row && row.ends_at ? String(row.ends_at).slice(0, 16) : '' })),
    field('Lieu', input({ name: 'location', value: (row && row.location) || '' })));
  const desc = field('Description', input({ name: 'description', value: (row && row.description) || '' }));
  const err = h('p', { class: 'error', role: 'alert', hidden: true });
  const submit = h('button', { type: 'button', class: 'btn btn-primary', text: isEdit ? 'Enregistrer' : 'Créer' });
  submit.addEventListener('click', async () => {
    err.hidden = true;
    const body = {};
    form.querySelectorAll('[name]').forEach((el) => { body[el.name] = el.value || null; });
    desc.querySelectorAll('[name]').forEach((el) => { body[el.name] = el.value || null; });
    submit.disabled = true;
    try {
      if (isEdit) await api.patch('/agenda_events/' + row.id, body); else await api.post('/agenda_events', body);
      closeModal(); toast(isEdit ? 'Enregistré.' : 'Créé.', 'ok'); done();
    } catch (e) { err.textContent = describeError(e); err.hidden = false; submit.disabled = false; }
  });
  modal({ title: isEdit ? 'Modifier — ' + row.title : 'Nouvel élément d\'agenda', wide: true,
    body: h('div', {}, form, desc, err),
    actions: [h('button', { type: 'button', class: 'btn btn-ghost', text: 'Annuler', onClick: closeModal }), submit] });
}
