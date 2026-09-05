/* MYTHOS WP — Auto-Reply control centre: mode, provider, receiver, business
   data, last event / error, safety policy, configuration, simulation. */
import { h, clear, badge, fmtDate, json, kv, skeletonRows, errorBox, empty } from '../ui.js';

function dot(v) { return h('span', { class: 'status-dot ' + (v === true ? 'ok' : v === false ? 'danger' : v === null ? 'warn' : '') }); }

export async function render(main, params, query, ctx) {
  const project = ctx.project();
  ctx.crumbs([{ label: 'Auto-Reply' }]);
  main.appendChild(h('div', { class: 'view-head' }, h('div', {}, h('div', { class: 'view-kicker' }, 'MYTHOS AUTO'), h('h2', {}, 'Auto-Reply control centre'), h('p', {}, 'The engine of Issue #173 on the existing Evolution gateway. Everything ships OFF; only the owner\'s configuration file outside Git can turn a project live. This panel connects the business data and never sends.'))));
  if (!project) { main.appendChild(empty('Select a project')); return; }
  const box = h('div', { class: 'stack' }, skeletonRows(6)); main.appendChild(box);
  let s;
  try { s = await ctx.api.get('/api/projects/' + project + '/autoreply/status'); } catch (err) { clear(box); box.appendChild(errorBox(err)); return; }
  clear(box);
  const modeCls = s.mode === 'ACTIVE' ? 'active' : s.mode === 'DRY-RUN' ? 'dry' : 'off';
  box.appendChild(h('div', { class: 'mode-banner ' + modeCls }, h('span', { class: 'mode' }, s.mode), h('span', {}, s.mode === 'OFF' ? (s.config.present ? 'Configuration present; this project is not switched on.' : 'No comms configuration is set (MYTHOS_WP_COMMS_CONFIG). Nothing can be sent.') : s.mode === 'DRY-RUN' ? 'The engine decides and records; nothing leaves.' : 'Live: replies with verified facts can be sent.'), h('span', { class: 'spacer', style: undefined }), badge('default OFF', 'mock')));

  box.appendChild(h('div', { class: 'grid cols-4' },
    card('Provider', [dot(s.provider.reachable), ' ', s.provider.kind + ' ' + (s.provider.version || ''), h('br'), h('small', { class: 'dim' }, s.provider.url_host + ' · ' + (s.provider.reachable ? 'reachable ' + s.provider.ms + ' ms' : s.provider.reason || 'unreachable'))]),
    card('Receiver', [dot(s.receiver.reachable), ' ', s.receiver.reachable === null ? 'not configured' : s.receiver.reachable ? 'listening' : 'down', h('br'), h('small', { class: 'dim' }, s.receiver.url_host || 'loopback receiver not running (owner step)')]),
    card('Business data', [dot(s.business_data.catalogue.reachable), ' ', s.business_data.connected.join(', '), h('br'), h('small', { class: 'dim' }, 'not connected: ' + s.business_data.not_connected.join(', '))]),
    card('This project', [s.project.configured === false ? [dot(null), ' not in comms config'] : [dot(s.project.auto_reply), ' handler ', h('code', {}, s.project.handler), ' · auto_reply ', badge(String(s.project.auto_reply), s.project.auto_reply ? 'warn' : 'mock')], h('br'), h('small', { class: 'dim' }, s.project.inboxes && s.project.inboxes.length ? 'instances: ' + s.project.inboxes.join(', ') : 'no customer instance')])
  ));

  box.appendChild(h('div', { class: 'grid cols-3' },
    h('div', { class: 'card' }, h('h3', {}, 'Verified facts available'), kv([['Active catalogue parts', String(s.business_data.catalogue.active_products === null ? 'unavailable' : s.business_data.catalogue.active_products)], ['Verified prices', h('a', { href: '#/pricing' }, String(s.business_data.verified_prices))], ['Verified stock records', h('a', { href: '#/stock' }, String(s.business_data.verified_stock))], ['Knowledge allowed', h('a', { href: '#/r/knowledge' }, String(s.business_data.knowledge_allowed))]]), h('p', {}, 'What each intent needs: ', Object.keys(s.business_data.required_by_intent).filter((k) => s.business_data.required_by_intent[k].length).map((k) => h('span', {}, h('code', {}, k), ' → ' + s.business_data.required_by_intent[k].join('+') + '  ')))),
    h('div', { class: 'card' }, h('h3', {}, 'Last processed event'), s.ledger.available ? (s.ledger.last_event ? kv([['Event', s.ledger.last_event.event_id, 'mono'], ['State', badge(s.ledger.last_event.state)], ['Intent', s.ledger.last_event.intent], ['Action', s.ledger.last_event.action], ['Reason', s.ledger.last_event.decision_reason, 'mono'], ['Gates', (s.ledger.last_event.rejections || []).join(', '), 'mono'], ['At', fmtDate(s.ledger.last_event.at), 'mono']]) : h('p', {}, 'Ledger present, no event yet.')) : h('p', {}, 'No ledger: ' + s.ledger.reason + '.'), s.ledger.available ? h('p', {}, 'Events: ' + s.ledger.events_total + ' · ' + Object.keys(s.ledger.states || {}).map((k) => k + ' ' + s.ledger.states[k]).join(' · ')) : null),
    h('div', { class: 'card' }, h('h3', {}, 'Last error'), s.ledger.available && s.ledger.last_error ? kv([['Event', s.ledger.last_error.event_id, 'mono'], ['State', badge(s.ledger.last_error.state)], ['Error', s.ledger.last_error.error, 'mono'], ['At', fmtDate(s.ledger.last_error.at), 'mono']]) : h('p', {}, 'None recorded.'), s.ledger.available && s.ledger.provider_breaker ? h('p', {}, 'Provider breaker: ', badge(s.ledger.provider_breaker.open ? 'open' : 'closed', s.ledger.provider_breaker.open ? 'danger' : 'ok'), ' failures ' + s.ledger.provider_breaker.failures) : null)
  ));

  box.appendChild(h('div', { class: 'grid cols-2' },
    h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, 'Human handoff queue'), h('a', { class: 'btn btn-secondary btn-sm', href: '#/r/handoffs?f.status=REQUIRES_HUMAN' }, 'Open queue')), h('p', {}, 'Every conversation the engine cannot answer with verified facts lands in the handoff queue (when the receiver runs with the MYTHOS WP integration). Manual entries can be added there too.')),
    h('div', { class: 'card' }, h('h3', {}, 'Configuration (read-only here)'), kv([['Config file', s.config.present ? s.config.file : 'absent (MYTHOS_WP_COMMS_CONFIG not set)'], ['Problems', s.config.problems.length ? badge(String(s.config.problems.length), 'danger') : badge('none', 'ok')], ['Engine mode', s.config.engine_mode || '—'], ['Handoff ack', s.config.send_handoff_ack === null ? '—' : String(s.config.send_handoff_ack)], ['Replies / conversation / hour', s.config.max_replies_per_hour === null ? '—' : String(s.config.max_replies_per_hour)], ['Generator', s.config.generator || '—'], ['Readiness', s.readiness ? (s.readiness.can_send ? badge('can send', 'danger') : badge('cannot send', 'ok')) : '—'], ['Tokens', s.readiness ? 'webhook ' + s.readiness.webhook_token + ' · api ' + s.readiness.api_token : '—']]), h('p', {}, 'Turning a project live is an owner action performed in the configuration file outside Git (README §Turning a reply on). No switch exists in this panel by design.'))
  ));

  box.appendChild(h('div', { class: 'card' }, h('h3', {}, 'Safety policy'), h('p', {}, 'Never invented: ', s.safety.never_invented.map((x) => badge(x, 'danger')), ' — when missing, the outcome is ', badge(s.safety.unknown_outcome, 'warn'), '.'), h('div', { class: 'gate-list' }, s.safety.gates.map((g) => badge(g, 'mock')))));

  // Simulation
  const sim = h('div', { class: 'card sim-out' });
  const input = h('textarea', { class: 'textarea', placeholder: 'e.g.  Bonjour, prix et disponibilité du filtre à huile pour Korando 2015 ?', 'aria-label': 'Customer message to simulate', rows: 3 });
  const out = h('div', {});
  const run = h('button', { class: 'btn btn-primary', type: 'button', onClick: async () => {
    const text = input.value.trim(); if (!text) return; run.disabled = true; clear(out); out.appendChild(skeletonRows(3));
    try {
      const r = await ctx.api.post('/api/projects/' + project + '/autoreply/simulate', { text });
      clear(out);
      out.appendChild(h('div', { class: 'grid cols-3' },
        kv([['Outcome', badge(r.outcome, r.outcome === 'DECIDED' ? 'info' : 'warn')], ['Intent', r.intent ? badge(r.intent, 'accent') : '—'], ['Language', r.language], ['Decision', r.action ? badge(r.action, r.action === 'reply' ? 'ok' : 'danger') : '—'], ['Reason', r.decision_reason || r.reason, 'mono'], ['Requires human', badge(r.requires_human ? 'yes' : 'no', r.requires_human ? 'danger' : 'ok')]]),
        h('div', {}, h('h4', { class: 'view-kicker' }, 'Facts'), h('div', { class: 'fact-list' }, (r.facts.required.length ? r.facts.required : ['(none needed)']).map((k) => h('span', { class: 'fact' }, k, r.facts.verified.includes(k) ? badge('VERIFIED') : r.facts.unknown.includes(k) ? badge('UNKNOWN') : badge('n/a', 'mock')))), r.entities ? json(r.entities) : null),
        h('div', {}, h('h4', { class: 'view-kicker' }, 'Policy gates a live run would hit'), h('div', { class: 'gate-list' }, (r.policy && r.policy.rejections || []).map((g) => badge(g, g === 'MODE_DRY_RUN' || g === 'AUTO_REPLY_DISABLED' ? 'mock' : 'warn'))), h('p', {}, badge(r.sent ? 'SENT' : 'nothing sent', 'ok'), ' source: ' + r.source))));
      out.appendChild(h('h4', { class: 'view-kicker' }, 'Proposed message'));
      out.appendChild(r.proposed_text ? h('div', { class: 'proposed' }, r.proposed_text) : h('div', { class: 'empty' }, h('strong', {}, 'No automatic reply'), 'A human answers this one.'));
    } catch (err) { clear(out); out.appendChild(errorBox(err)); }
    finally { run.disabled = false; }
  } }, 'Simulate (dry-run, nothing is sent)');
  sim.append(h('div', { class: 'card-head' }, h('h3', {}, 'Test / simulation'), badge('never sends', 'ok')), h('p', {}, 'Runs the whole engine on a synthetic inbound with this panel\'s business-data ports connected, dry-run forced, in-memory ledger. Shows the exact decision, which facts were verified or unknown, every policy gate and the text a live run would send.'), input, h('div', {}, run), out);
  box.appendChild(sim);
}
function card(title, body) { return h('div', { class: 'card' }, h('span', { class: 'stat-label' }, title), h('div', {}, body)); }
