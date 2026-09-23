/* =====================================================
   MYTHOS HADDAD — AI node surface
   sites/status.mythosprod.xyz/assets/haddad.js
   =====================================================

   One file serves both surfaces:
     MythosHaddad.mountCard(el)     the summary card on the Status Center
     MythosHaddad.mountConsole()    the live console at /haddad/

   Data source: data/haddad-node.json, written by the ingest receiver
   (projects/status-center/haddad/) from signed telemetry each node pushes.
   There is NO browser-to-node request: the page only ever reads one
   same-origin JSON file, which is why no node is ever exposed.

   HONESTY RULES, enforced here and not merely intended:
     - The stored `state` is NEVER trusted on its own. If the file is older
       than the published thresholds, this page recomputes the state from
       `last_seen` itself, so a receiver that died cannot keep a node green.
     - A value the node could not measure is null and renders as N/A.
       Nothing is defaulted to 0, and nothing is invented.
     - No innerHTML, no eval, no external request. Hostile strings from a
       node stay data: every value reaches the DOM as a text node.
   ===================================================== */
(function (global) {
  'use strict';

  var DATA_URL = 'data/haddad-node.json';
  var POLL_MS = 5000;
  var SPARK_POINTS = 120;

  // Mirrors projects/status-center/haddad/lib/node-state.js. The receiver
  // publishes its own thresholds inside the document and those win; these
  // are only the fallback for a document written by an older receiver.
  var FALLBACK_THRESHOLDS = { heartbeat_s: 10, degraded_after_s: 30, offline_after_s: 45 };

  var STATE_PILL = {
    ONLINE: 's-done', BUSY: 's-progress', WAITING: 's-ready',
    DEGRADED: 's-owner', OFFLINE: 's-blocked', UNKNOWN: 's-notverified'
  };
  var WORKER_PILL = {
    RUNNING: 's-done', READY: 's-done', BUSY: 's-progress',
    DEGRADED: 's-owner', STOPPED: 's-blocked', UNKNOWN: 's-notverified'
  };
  var SEV_PILL = {
    INFO: 's-neutral', SUCCESS: 's-done', WARNING: 's-owner',
    ERROR: 's-blocked', CRITICAL: 's-blocked'
  };

  // ── DOM helpers (no innerHTML anywhere in this file) ──────────────
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') node.appendChild(document.createTextNode(String(attrs[k])));
      else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, String(attrs[k]));
    });
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }
  function txt(s) { return document.createTextNode(String(s)); }
  function byId(id) { return document.getElementById(id); }
  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }

  // ── formatting: null is N/A, always ──────────────────────────────
  function na() { return el('span', { class: 'na', text: 'N/A' }); }
  function val(v, suffix) {
    if (v === null || v === undefined || v === '') return na();
    return txt(String(v) + (suffix || ''));
  }
  function num(v, digits, suffix) {
    if (typeof v !== 'number' || !isFinite(v)) return na();
    return txt(v.toFixed(digits === undefined ? 0 : digits) + (suffix || ''));
  }
  function duration(s) {
    if (typeof s !== 'number' || !isFinite(s) || s < 0) return null;
    var d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
    if (d) return d + 'd ' + h + 'h';
    if (h) return h + 'h ' + m + 'm';
    if (m) return m + 'm ' + Math.floor(s % 60) + 's';
    return Math.floor(s) + 's';
  }
  function ago(iso, now) {
    if (!iso) return null;
    var t = Date.parse(iso);
    if (!isFinite(t)) return null;
    var s = Math.max(0, Math.round((now - t) / 1000));
    return duration(s) + ' ago';
  }
  function shortTime(iso) {
    if (!iso) return '—';
    var t = Date.parse(iso);
    if (!isFinite(t)) return String(iso);
    var d = new Date(t);
    function p(x) { return (x < 10 ? '0' : '') + x; }
    return p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds());
  }

  // ── the honesty layer ────────────────────────────────────────────
  // Recompute the node's state from its own last_seen, using the
  // thresholds the receiver published. The stored state is used only when
  // this check agrees the beat is fresh — so a frozen file decays to
  // OFFLINE in the browser exactly as it would at the receiver.
  function liveState(node, doc, now) {
    var th = (doc && doc.thresholds) || FALLBACK_THRESHOLDS;
    var seen = node && node.received_at ? Date.parse(node.received_at) : NaN;
    if (!isFinite(seen)) {
      return { state: 'UNKNOWN', reason: 'this node has never reported', age_s: null, overridden: false };
    }
    var age = Math.max(0, Math.round((now - seen) / 1000));
    if (age >= th.offline_after_s) {
      return {
        state: 'OFFLINE', age_s: age, overridden: node.state !== 'OFFLINE',
        reason: 'no heartbeat for ' + duration(age) + ' (threshold ' + th.offline_after_s + 's)'
      };
    }
    if (age >= th.degraded_after_s && node.state !== 'OFFLINE' && node.state !== 'DEGRADED') {
      return {
        state: 'DEGRADED', age_s: age, overridden: true,
        reason: 'heartbeat late: ' + duration(age) + ' since the last beat (threshold ' + th.degraded_after_s + 's)'
      };
    }
    return { state: node.state || 'UNKNOWN', reason: node.state_reason || '', age_s: age, overridden: false };
  }

  function statePill(state) {
    return el('span', { class: 'pill ' + (STATE_PILL[state] || 's-notverified'), text: state });
  }

  // ── shared fetch ─────────────────────────────────────────────────
  function load(base) {
    return fetch((base || '') + DATA_URL, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) return null;
      return r.json();
    }).catch(function () { return null; });
  }

  function absent(message) {
    return el('p', { class: 'section-note', text: message });
  }

  // =================================================================
  // A. Summary card — rendered on the Status Center front page
  // =================================================================
  function renderCard(host, doc, now, base) {
    clear(host);
    if (!doc || !Array.isArray(doc.nodes) || !doc.nodes.length) {
      host.appendChild(absent(
        'No AI node has reported yet (data/haddad-node.json is absent or empty). ' +
        'A node becomes visible only once its public key is registered on this host — ' +
        'see projects/status-center/haddad/README.md. Absence is reported, never painted green.'));
      return;
    }

    var docAge = Math.round((now - Date.parse(doc.generated_at)) / 1000);
    if (isFinite(docAge) && docAge > 120) {
      host.appendChild(el('p', { class: 'section-note' }, [
        txt('Receiver snapshot is ' + duration(docAge) + ' old — the ingest service may be down. '),
        el('strong', { text: 'Every node below is shown at its recomputed state, not its stored one.' })
      ]));
    }

    var list = el('ul', { class: 'cards' });
    doc.nodes.forEach(function (n) {
      var s = liveState(n, doc, now);
      var rt = n.runtime || {};
      var gpu = n.gpu || {};
      var task = n.current_task;

      var rows = [];
      function row(label, value) {
        rows.push(el('div', { class: 'kv' }, [
          el('span', { class: 'k', text: label }),
          el('span', { class: 'v' }, [value])
        ]));
      }
      row('GPU', val(gpu.model));
      row('Model', val(rt.model));
      row('VRAM', rt.vram_model_mib && gpu.vram_total_mib
        ? txt((rt.vram_model_mib / 1024).toFixed(2) + ' / ' + (gpu.vram_total_mib / 1024).toFixed(2) + ' GB')
        : (gpu.vram_total_mib ? txt('— / ' + (gpu.vram_total_mib / 1024).toFixed(2) + ' GB') : na()));
      row('Current task', task ? txt(task.task_id) : el('span', { class: 'na', text: 'none' }));
      row('Task state', task ? val(task.effective || task.status) : na());
      row('Last heartbeat', s.age_s === null ? na() : txt(duration(s.age_s) + ' ago'));
      row('Uptime', val(duration((n.node_info || {}).uptime_s)));

      list.appendChild(el('li', { class: 'card node-card' }, [
        el('div', { class: 'node-head' }, [
          el('div', null, [
            el('h3', { text: n.display_name || n.node }),
            el('p', { class: 'node-sub', text: n.subtitle || 'AI COMPUTE NODE' })
          ]),
          statePill(s.state)
        ]),
        el('p', { class: 'node-reason', text: s.reason || '' }),
        el('div', { class: 'kv-grid' }, rows),
        el('p', null, [
          el('a', { class: 'node-open', href: (base || '') + 'haddad/', text: 'OPEN LIVE CONSOLE \u2192' })
        ])
      ]));
    });
    host.appendChild(list);
  }

  function mountCard(host, base) {
    if (!host) return Promise.resolve();
    function tick() {
      return load(base).then(function (doc) {
        renderCard(host, doc, Date.now(), base);
      });
    }
    var first = tick();
    // The card refreshes on the same beat as the console so the front page
    // is never quietly staler than the page it links to.
    setInterval(tick, POLL_MS);
    return first;
  }

  // =================================================================
  // B. Live console — the /haddad/ page
  // =================================================================
  function kvTable(pairs) {
    var grid = el('div', { class: 'kv-grid' });
    pairs.forEach(function (p) {
      if (!p) return;
      grid.appendChild(el('div', { class: 'kv' }, [
        el('span', { class: 'k', text: p[0] }),
        el('span', { class: 'v' }, [p[1]])
      ]));
    });
    return grid;
  }

  // A meter is drawn ONLY when both numerator and denominator are real.
  function meter(used, total, unit, digits) {
    if (typeof used !== 'number' || typeof total !== 'number' || !isFinite(used) || !isFinite(total) || total <= 0) {
      return na();
    }
    var pct = Math.max(0, Math.min(100, used / total * 100));
    var d = digits === undefined ? 1 : digits;
    return el('span', { class: 'meter-wrap' }, [
      el('span', { class: 'meter' }, [
        el('span', { class: 'meter-fill' + (pct >= 90 ? ' hot' : pct >= 75 ? ' warm' : ''), style: 'width:' + pct.toFixed(1) + '%' })
      ]),
      el('span', { class: 'meter-text', text: used.toFixed(d) + ' / ' + total.toFixed(d) + ' ' + unit + ' (' + Math.round(pct) + '%)' })
    ]);
  }

  // Sparkline over what THIS BROWSER has actually observed since the page
  // opened. It is labelled as such: the receiver keeps a durable history
  // on disk, but charting that is deferred (see README, Known limitations)
  // and no point here is ever interpolated or back-filled.
  function sparkline(points, max) {
    if (!points.length) return na();
    var w = 120, h = 24;
    var top = max || Math.max.apply(null, points) || 1;
    var step = points.length > 1 ? w / (points.length - 1) : w;
    var d = points.map(function (p, i) {
      var x = (i * step).toFixed(1);
      var y = (h - Math.max(0, Math.min(1, p / top)) * h).toFixed(1);
      return (i ? 'L' : 'M') + x + ',' + y;
    }).join(' ');
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    svg.setAttribute('class', 'spark');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', points.length + ' observed samples, latest ' + points[points.length - 1]);
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.5');
    svg.appendChild(path);
    return svg;
  }

  var history = { load: [], mem: [], seen: null };

  function recordHistory(node) {
    if (!node || node.received_at === history.seen) return;
    history.seen = node.received_at;
    var r = node.resources || {};
    if (typeof r.load1 === 'number') history.load.push(r.load1);
    if (typeof r.mem_used_mib === 'number') history.mem.push(r.mem_used_mib);
    if (history.load.length > SPARK_POINTS) history.load.shift();
    if (history.mem.length > SPARK_POINTS) history.mem.shift();
  }

  function section(id, kicker, title, note) {
    var s = el('section', { class: 'panel', id: id }, [
      el('p', { class: 'section-kicker', text: kicker }),
      el('h2', { text: title })
    ]);
    if (note) s.appendChild(el('p', { class: 'section-note', text: note }));
    var body = el('div', { class: 'panel-body' });
    s.appendChild(body);
    s.bodyEl = body;
    return s;
  }

  function renderConsole(doc, now) {
    var host = byId('haddad-body');
    if (!host) return;
    clear(host);

    if (!doc || !Array.isArray(doc.nodes) || !doc.nodes.length) {
      host.appendChild(absent(
        'No AI node has reported yet. data/haddad-node.json is absent or lists no node. ' +
        'This page shows only what a node has actually sent — it has no fallback data and ' +
        'no way to reach a node directly.'));
      return;
    }

    // One node today. The document is a fleet, so this loop is what makes
    // haddad-02 a registration rather than a rewrite — no scheduler, no
    // routing, no fleet control is implemented.
    doc.nodes.forEach(function (n) {
      var s = liveState(n, doc, now);
      recordHistory(n);
      var info = n.node_info || {};
      var rt = n.runtime || {};
      var gpu = n.gpu || {};
      var res = n.resources || {};
      var task = n.current_task;
      var health = n.health || {};

      // ── overview ────────────────────────────────────────────────
      var ov = section('node-overview', 'Node', (n.display_name || n.node) + ' — ' + (n.subtitle || 'AI COMPUTE NODE'), null);
      ov.bodyEl.appendChild(el('div', { class: 'node-hero' }, [
        statePill(s.state),
        el('span', { class: 'node-reason', text: s.reason || '' })
      ]));
      if (s.overridden) {
        ov.bodyEl.appendChild(el('p', { class: 'section-note warn', text:
          'This state was recomputed in your browser from the last heartbeat. The stored value was "' +
          n.state + '", written when the beat arrived; it is not current and is not shown as if it were.' }));
      }
      ov.bodyEl.appendChild(kvTable([
        ['Heartbeat', s.age_s === null ? na() : txt(duration(s.age_s) + ' ago (beat every ' + ((doc.thresholds || FALLBACK_THRESHOLDS).heartbeat_s) + 's)')],
        ['Host', val(info.hostname)],
        ['OS', val(info.os)],
        ['Kernel', val(info.kernel)],
        ['Uptime', val(duration(info.uptime_s))],
        ['Booted', val(info.boot_at)],
        ['Last health check', health.generated_at ? txt(health.generated_at + ' (' + (ago(health.generated_at, now) || '') + ')') : na()],
        ['Health result', health.status
          ? el('span', null, [
              el('span', { class: 'pill ' + (health.status === 'PASS' ? 's-done' : health.status === 'FAIL' ? 's-blocked' : 's-owner'), text: health.status }),
              txt(' ' + health.counts.PASS + ' pass / ' + health.counts.WARN + ' warn / ' + health.counts.FAIL + ' fail')
            ])
          : na()],
        ['Failing checks', (health.failing && health.failing.length) ? txt(health.failing.join(', ')) : el('span', { class: 'ok-none', text: 'none' })],
        ['Warning checks', (health.warning && health.warning.length) ? txt(health.warning.join(', ')) : el('span', { class: 'ok-none', text: 'none' })],
        ['Checkout', (n.repo && n.repo.head) ? txt(n.repo.head + (n.repo.branch ? ' (' + n.repo.branch + ')' : '') + (n.repo.dirty ? ' — DIRTY' : '')) : na()],
        ['Agent', val(n.agent_version)],
        ['Telemetry seq', val(n.seq)]
      ]));
      host.appendChild(ov);

      // ── workers ─────────────────────────────────────────────────
      var wk = section('node-workers', 'Workers', 'Workers',
        'Each row is a real unit state or a real probe result. A component the node cannot observe reports UNKNOWN — never a guess.');
      var wl = el('ul', { class: 'worker-list' });
      (n.workers || []).forEach(function (w) {
        wl.appendChild(el('li', { class: 'worker' }, [
          el('span', { class: 'pill ' + (WORKER_PILL[w.state] || 's-notverified'), text: w.state }),
          el('span', { class: 'worker-name', text: w.name || w.id }),
          el('span', { class: 'worker-detail', text: w.detail || '' })
        ]));
      });
      wk.bodyEl.appendChild((n.workers || []).length ? wl : absent('The node reported no worker states.'));
      host.appendChild(wk);

      // ── current task ────────────────────────────────────────────
      var ct = section('node-task', 'Current task', 'Current task',
        'The executor\'s own task record. States are the executor\'s existing vocabulary — ' +
        'QUEUED, RUNNING, WAITING_FOR_QUOTA, WAITING_RETRY, COMPLETED, FAILED, BLOCKED, CANCELLED, ' +
        'plus INTERRUPTED when a RUNNING task\'s process is gone. Nothing here is a second state machine.');
      if (!task) {
        ct.bodyEl.appendChild(absent('No task record on the node.'));
      } else {
        ct.bodyEl.appendChild(kvTable([
          ['Task ID', txt(task.task_id)],
          ['GitHub issue', task.issue ? el('a', { href: 'https://github.com/othoth77/mythos-prod/issues/' + task.issue, rel: 'noreferrer noopener', text: '#' + task.issue }) : na()],
          ['Project', val(task.project)],
          ['Action', val(task.action)],
          ['Profile', val(task.profile)],
          // V2.1's role, with the reason beside it. Role and reason are shown
          // together on one row because either alone invites the wrong read:
          // a bare role looks like a label someone typed, and a bare reason
          // says nothing about what ran. Absent on any task recorded before
          // roles existed, and N/A is the honest answer there.
          ['Role', task.role
            ? el('span', {}, [txt(task.role), task.role_reason
              ? el('span', { class: 'na', text: '  ' + task.role_reason }) : null])
            : na()],
          ['Provider', val(task.provider)],
          ['Model', val(task.model)],
          ['Attempt', val(task.attempt)],
          ['Status', el('span', { class: 'pill ' + (task.effective === 'RUNNING' ? 's-progress' : task.effective === 'COMPLETED' ? 's-done' : task.effective === 'FAILED' ? 's-blocked' : 's-ready'), text: task.effective || task.status || 'UNKNOWN' })],
          ['Started', val(task.started_at)],
          ['Elapsed', val(duration(task.elapsed_s))],
          ['Validation', val(task.validation)],
          ['Review', val(task.review)]
        ]));
      }
      // Task summary — real counts only, in the executor's own vocabulary.
      var counts = n.task_counts || {};
      var keys = Object.keys(counts).sort();
      if (keys.length) {
        var chips = el('div', { class: 'chips' });
        keys.forEach(function (k) {
          chips.appendChild(el('span', { class: 'chip' }, [
            el('strong', { text: String(counts[k]) }),
            txt(' ' + k.replace(/_/g, ' '))
          ]));
        });
        ct.bodyEl.appendChild(el('p', { class: 'section-note', text: 'All tasks in the node\'s executor store:' }));
        ct.bodyEl.appendChild(chips);
      }
      host.appendChild(ct);

      // ── GPU ─────────────────────────────────────────────────────
      var g = section('node-gpu', 'Hardware', 'GPU', null);
      g.bodyEl.appendChild(kvTable([
        ['GPU', val(gpu.model)],
        ['Driver', val(gpu.driver)],
        ['VRAM total', gpu.vram_total_mib ? txt((gpu.vram_total_mib / 1024).toFixed(2) + ' GB') : na()],
        ['VRAM used (driver)', gpu.vram_used_mib ? txt((gpu.vram_used_mib / 1024).toFixed(2) + ' GB') : na()],
        ['VRAM, model weights', (rt.vram_model_mib && gpu.vram_total_mib)
          ? meter(rt.vram_model_mib / 1024, gpu.vram_total_mib / 1024, 'GB', 2)
          : (rt.vram_model_mib ? txt((rt.vram_model_mib / 1024).toFixed(2) + ' GB') : na())],
        // A DIFFERENT quantity from the line above: the runtime's own upfront
        // estimate of total device use, made before allocation. Labelled as an
        // estimate so it is never read as a measurement.
        ['VRAM, projected total (estimate)', (rt.vram_projected_mib && gpu.vram_total_mib)
          ? meter(rt.vram_projected_mib / 1024, gpu.vram_total_mib / 1024, 'GB', 2)
          : (rt.vram_projected_mib ? txt((rt.vram_projected_mib / 1024).toFixed(2) + ' GB') : na())],
        ['GPU layers', (rt.gpu_layers !== null && rt.gpu_layers_total !== null && rt.gpu_layers !== undefined)
          ? txt(rt.gpu_layers + ' / ' + rt.gpu_layers_total) : na()],
        ['Utilisation', num(gpu.utilization_pct, 0, ' %')],
        ['Temperature', num(gpu.temperature_c, 0, ' °C')],
        ['Power', num(gpu.power_w, 0, ' W')],
        ['Process', val(gpu.process)]
      ]));
      if (rt.vram_source) {
        g.bodyEl.appendChild(el('p', { class: 'section-note', text:
          'Two different figures, kept apart on purpose. "Model weights" is what the runtime ' +
          'reports it actually placed on the card. "Projected total" is the runtime\'s own ' +
          'estimate of model + KV cache + compute buffers, made before allocation — an estimate, ' +
          'not a measurement. Source for both: ' + rt.vram_source + '.' }));
      }
      if (gpu.unavailable_reason) {
        g.bodyEl.appendChild(el('p', { class: 'section-note warn', text: 'Metrics shown as N/A above: ' + gpu.unavailable_reason }));
      }
      host.appendChild(g);

      // ── AI runtime ──────────────────────────────────────────────
      var r = section('node-runtime', 'AI runtime', 'AI runtime',
        'The local inference server. No API key, endpoint credential or model path secret is ever carried in telemetry.');
      r.bodyEl.appendChild(kvTable([
        ['Status', el('span', { class: 'pill ' + (WORKER_PILL[rt.state] || 's-notverified'), text: rt.state || 'UNKNOWN' })],
        ['Endpoint', val(rt.endpoint)],
        ['Model', val(rt.model)],
        ['Context', val(rt.context, ' tokens')],
        ['Slots', (rt.slots_idle !== null && rt.slots_total !== null && rt.slots_idle !== undefined)
          ? txt(rt.slots_idle + ' idle / ' + rt.slots_total + ' total') : na()],
        ['Processing', val(rt.slots_processing)],
        ['GPU layers', (rt.gpu_layers !== null && rt.gpu_layers !== undefined) ? txt(rt.gpu_layers + ' / ' + rt.gpu_layers_total) : na()],
        ['VRAM, model weights', rt.vram_model_mib ? txt((rt.vram_model_mib / 1024).toFixed(2) + ' GB') : na()],
        ['VRAM, projected total', rt.vram_projected_mib ? txt((rt.vram_projected_mib / 1024).toFixed(2) + ' GB (estimate)') : na()],
        ['Inference speed', num(rt.tokens_per_s, 1, ' tok/s')],
        ['Last ready', val(rt.last_ready)],
        ['Last restart', val(rt.last_restart)]
      ]));
      host.appendChild(r);

      // ── resources ───────────────────────────────────────────────
      var rs = section('node-resources', 'Host', 'System resources', null);
      rs.bodyEl.appendChild(kvTable([
        ['RAM', meter(res.mem_used_mib / 1024, res.mem_total_mib / 1024, 'GB', 2)],
        ['Swap', meter(res.swap_used_mib / 1024, res.swap_total_mib / 1024, 'GB', 2)],
        ['Disk', meter(res.disk_used_gb, res.disk_total_gb, 'GB', 1)],
        ['Load', (typeof res.load1 === 'number')
          ? txt(res.load1.toFixed(2) + ' / ' + (res.load5 || 0).toFixed(2) + ' / ' + (res.load15 || 0).toFixed(2) + ' on ' + (res.cpus || '?') + ' CPUs')
          : na()],
        ['Processes', val(res.process_count)],
        ['PSI cpu (avg10)', num(res.psi_cpu_avg10, 2, ' %')],
        ['PSI memory (avg10)', num(res.psi_mem_avg10, 2, ' %')],
        ['PSI io (avg10)', num(res.psi_io_avg10, 2, ' %')],
        ['Load, this session', sparkline(history.load)],
        ['RAM, this session', sparkline(history.mem, res.mem_total_mib)]
      ]));
      rs.bodyEl.appendChild(el('p', { class: 'section-note', text:
        'The two sparklines cover only what this browser has observed since the page opened (' +
        history.load.length + ' sample' + (history.load.length === 1 ? '' : 's') + '). ' +
        'The receiver keeps a durable per-beat history on disk; charting it is not built yet and nothing here is back-filled.' }));
      host.appendChild(rs);

      // ── alerts ──────────────────────────────────────────────────
      var alerts = [];
      if (s.state === 'OFFLINE') alerts.push(['CRITICAL', 'Node offline — ' + s.reason]);
      if (health.counts && health.counts.FAIL > 0) alerts.push(['ERROR', 'Health failing: ' + (health.failing || []).join(', ')]);
      if (rt.state === 'STOPPED') alerts.push(['ERROR', 'AI runtime unavailable — the node reports the unit is not active']);
      if (rt.state === 'DEGRADED') alerts.push(['WARNING', 'AI runtime active but not answering on its endpoint']);
      (n.workers || []).forEach(function (w) {
        if (w.state === 'STOPPED') alerts.push(['ERROR', 'Worker stopped: ' + (w.name || w.id) + ' — ' + (w.detail || '')]);
      });
      if (typeof res.mem_used_mib === 'number' && typeof res.mem_total_mib === 'number' && res.mem_total_mib > 0 &&
          res.mem_used_mib / res.mem_total_mib >= 0.9) alerts.push(['WARNING', 'RAM pressure: ' + Math.round(res.mem_used_mib / res.mem_total_mib * 100) + '% used']);
      if (typeof res.disk_used_pct === 'number' && res.disk_used_pct >= 90) alerts.push(['WARNING', 'Disk above 90%: ' + res.disk_used_pct + '% used']);
      if (typeof res.swap_used_mib === 'number' && typeof res.swap_total_mib === 'number' && res.swap_total_mib > 0 &&
          res.swap_used_mib / res.swap_total_mib >= 0.5) alerts.push(['WARNING', 'Swap above 50%']);

      var al = section('node-alerts', 'Alerts', 'Alerts',
        'Derived from the values above, in this page only. No message is sent anywhere — notifications are not part of this stage.');
      if (!alerts.length) {
        al.bodyEl.appendChild(el('p', { class: 'ok-none', text: 'No alert condition in the current telemetry.' }));
      } else {
        var aul = el('ul', { class: 'plain' });
        alerts.forEach(function (a) {
          aul.appendChild(el('li', null, [
            el('span', { class: 'pill ' + (SEV_PILL[a[0]] || 's-owner'), text: a[0] }),
            txt(' ' + a[1])
          ]));
        });
        al.bodyEl.appendChild(aul);
      }
      host.appendChild(al);

      // ── incidents ───────────────────────────────────────────────
      var inc = section('node-incidents', 'Incidents', 'Incidents',
        'Built only from real executor events. RESOLVED appears only when a later real event shows the task moved on — it is never assumed.');
      if (!(n.incidents || []).length) {
        inc.bodyEl.appendChild(el('p', { class: 'ok-none', text: 'No incident in the events the node reported.' }));
      } else {
        var il = el('ul', { class: 'plain' });
        n.incidents.forEach(function (i) {
          il.appendChild(el('li', null, [
            el('span', { class: 'pill ' + (i.state === 'RESOLVED' ? 's-done' : SEV_PILL[i.severity] || 's-owner'), text: i.state }),
            el('strong', { text: ' ' + i.kind + ' ' }),
            el('span', { class: 'basis', text: i.at + (i.task_id ? ' · ' + i.task_id : '') }),
            el('div', { class: 'live-detail', text: i.detail || '' })
          ]));
        });
        inc.bodyEl.appendChild(il);
      }
      host.appendChild(inc);

      // ── live activity / event stream ────────────────────────────
      var ev = section('node-events', 'Live activity', 'Event stream',
        'The node\'s real executor event log, newest last. Every line was written by the executor itself — nothing on this page is generated for display.');
      var events = (n.events || []).slice(-100);
      if (!events.length) {
        ev.bodyEl.appendChild(absent('The node reported no events.'));
      } else {
        var table = el('table', { class: 'matrix events' }, [
          el('thead', null, [el('tr', null, ['Time', 'Severity', 'Source', 'Event', 'Task', 'Detail'].map(function (h) {
            return el('th', { text: h });
          }))]),
          el('tbody', null, events.slice().reverse().map(function (e) {
            return el('tr', null, [
              el('td', { class: 'mono', title: e.ts, text: shortTime(e.ts) }),
              el('td', null, [el('span', { class: 'pill ' + (SEV_PILL[e.severity] || 's-neutral'), text: e.severity })]),
              el('td', { text: e.source || '' }),
              el('td', { class: 'mono', text: e.event }),
              el('td', { class: 'mono', text: e.task_id || '—' }),
              el('td', { class: 'live-detail', text: e.detail || '—' })
            ]);
          }))
        ]);
        ev.bodyEl.appendChild(el('div', { class: 'table-wrap' }, [table]));
      }
      host.appendChild(ev);
    });

    var meta = byId('haddad-meta');
    if (meta) {
      clear(meta);
      meta.appendChild(el('span', null, [txt('Receiver snapshot '), el('strong', { text: doc.generated_at })]));
      meta.appendChild(el('span', null, [txt('Host '), el('strong', { text: doc.host || '—' })]));
      meta.appendChild(el('span', null, [txt('Ingest '), el('strong', { text: doc.ingest_version || '—' })]));
      meta.appendChild(el('span', null, [txt('Nodes '), el('strong', { text: String(doc.nodes.length) })]));
    }
  }

  // The console lives at /haddad/, one level below the docroot, so its
  // data path is relative to the parent — the card on the front page uses
  // the default empty base.
  function mountConsole(base) {
    var root = base === undefined ? '../' : base;
    function tick() {
      return load(root).then(function (doc) {
        try { renderConsole(doc, Date.now()); }
        catch (e) {
          var host = byId('haddad-body');
          if (host) { clear(host); host.appendChild(absent('The console could not render this snapshot: ' + e.message)); }
        }
      });
    }
    tick();
    setInterval(tick, POLL_MS);
  }

  global.MythosHaddad = {
    mountCard: mountCard,
    mountConsole: mountConsole,
    // exported for the offline suite
    liveState: liveState,
    duration: duration,
    POLL_MS: POLL_MS,
    FALLBACK_THRESHOLDS: FALLBACK_THRESHOLDS
  };
})(window);
