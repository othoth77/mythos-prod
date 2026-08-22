/* mythosprod.xyz — Mythos Hub Dashboard, live status binding.
 *
 * Contract with the markup: the page is already correct and readable with
 * this file absent or failing. Every status surface ships a truthful
 * placeholder ("—", class `pill` with no state) and this script only ever
 * REPLACES a placeholder with something it actually measured. It never
 * invents a state, and a fetch failure degrades to "indisponible" rather
 * than to green — the Status Center's own rule (states are computed, never
 * curated; a probe that cannot run is never silently healthy).
 *
 * Data sources, both same-origin (CSP: connect-src 'self'):
 *   /api/status.json  — nginx alias onto the Status Center monitor output
 *                       (projects/status-center/monitor), the single source
 *                       of truth for service state. Not a second monitor.
 *   /health.json      — this site's own deploy stamp.
 *
 * No dependencies, no build step, no innerHTML with fetched data.
 */
(function () {
  'use strict';

  var STATE_CLASS = { LIVE: 'live', DEGRADED: 'degraded', DOWN: 'down' };
  var STATE_LABEL = {
    LIVE: 'En ligne',
    DEGRADED: 'Dégradé',
    DOWN: 'Hors ligne',
    NOT_MONITORED: 'Non supervisé'
  };

  function el(sel, root) { return (root || document).querySelector(sel); }
  function all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function setPill(node, state, textOverride) {
    if (!node) return;
    node.classList.remove('live', 'degraded', 'down', 'planned');
    var cls = STATE_CLASS[state];
    if (cls) node.classList.add(cls);
    node.textContent = textOverride || STATE_LABEL[state] || '—';
  }

  function setDot(node, state) {
    if (!node) return;
    node.classList.remove('live', 'degraded', 'down', 'unknown');
    node.classList.add(STATE_CLASS[state] || 'unknown');
  }

  /* Worst-wins rollup. NOT_MONITORED is not a failure and not a success:
     it is excluded from the verdict and reported separately, so an
     unmonitored surface can never make the header look green. */
  function rollup(checks) {
    var counts = { LIVE: 0, DEGRADED: 0, DOWN: 0, NOT_MONITORED: 0 };
    checks.forEach(function (c) {
      if (counts[c.state] === undefined) counts[c.state] = 0;
      counts[c.state]++;
    });
    var verdict = counts.DOWN ? 'DOWN' : (counts.DEGRADED ? 'DEGRADED' : (counts.LIVE ? 'LIVE' : 'NOT_MONITORED'));
    return { counts: counts, verdict: verdict };
  }

  function fmtWhen(iso) {
    if (!iso) return null;
    var d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    var mins = Math.round((Date.now() - d.getTime()) / 60000);
    if (mins < 1) return "à l'instant";
    if (mins < 60) return 'il y a ' + mins + ' min';
    var h = Math.round(mins / 60);
    if (h < 24) return 'il y a ' + h + ' h';
    return 'il y a ' + Math.round(h / 24) + ' j';
  }

  function degrade(reason) {
    all('[data-probe]').forEach(function (n) { setPill(n, null, 'Indisponible'); });
    var dot = el('#sys-dot');
    setDot(dot, null);
    var lbl = el('#sys-label');
    if (lbl) lbl.textContent = 'État indisponible';
    var note = el('#infra-note');
    if (note) note.textContent = 'Mesures non récupérées (' + reason + '). Le Status Center reste la source de vérité.';
  }

  function applyStatus(data) {
    var checks = (data && Array.isArray(data.checks)) ? data.checks : [];
    if (!checks.length) { degrade('aucune mesure publiée'); return; }

    var byId = {};
    checks.forEach(function (c) { byId[c.id] = c; });

    /* Per-card pills — only for cards naming a probe that actually exists. */
    all('[data-probe]').forEach(function (node) {
      var c = byId[node.getAttribute('data-probe')];
      if (c) setPill(node, c.state);
      else setPill(node, null, 'Non supervisé');
    });

    /* Header indicator */
    var r = rollup(checks);
    setDot(el('#sys-dot'), r.verdict);
    var lbl = el('#sys-label');
    if (lbl) {
      lbl.textContent = r.counts.LIVE + '/' + (checks.length - r.counts.NOT_MONITORED) + ' en ligne';
    }

    /* Infrastructure metrics */
    var svc = el('#m-services');
    if (svc) svc.textContent = r.counts.LIVE + ' / ' + (checks.length - r.counts.NOT_MONITORED);
    var svcSub = el('#m-services-sub');
    if (svcSub) {
      svcSub.textContent = r.counts.DOWN + ' hors ligne · ' + r.counts.DEGRADED +
        ' dégradé · ' + r.counts.NOT_MONITORED + ' non supervisé';
    }
    setDot(el('#m-services-dot'), r.verdict);

    var backup = byId['backup-system'];
    var bkNode = el('#m-backup');
    if (bkNode) bkNode.textContent = backup ? (STATE_LABEL[backup.state] || backup.state) : 'Non supervisé';
    setDot(el('#m-backup-dot'), backup ? backup.state : null);
    var bkSub = el('#m-backup-sub');
    if (bkSub && backup) {
      bkSub.textContent = backup.detail && backup.detail.last_success_at
        ? 'dernier succès ' + (fmtWhen(backup.detail.last_success_at) || backup.detail.last_success_at)
        : (backup.error ? String(backup.error) : 'sauvegarde hors-site planifiée');
    }

    /* Security surface: TLS is the part this page can honestly speak to —
       the monitor measures certificate lifetime on every HTTPS probe. */
    var certDays = checks
      .map(function (c) { return c.cert_days_remaining; })
      .filter(function (v) { return typeof v === 'number'; });
    var secNode = el('#m-security');
    if (secNode) {
      if (certDays.length) {
        var min = Math.min.apply(null, certDays);
        secNode.textContent = min + ' j';
        setDot(el('#m-security-dot'), min <= 7 ? 'DOWN' : (min <= 21 ? 'DEGRADED' : 'LIVE'));
        var secSub = el('#m-security-sub');
        if (secSub) secSub.textContent = 'certificat le plus proche de l\'expiration (' + certDays.length + ' mesurés)';
      } else {
        secNode.textContent = '—';
      }
    }

    var res = byId['vps-resources'];
    var hNode = el('#m-health');
    if (hNode) hNode.textContent = res ? (STATE_LABEL[res.state] || res.state) : '—';
    setDot(el('#m-health-dot'), res ? res.state : null);
    var hSub = el('#m-health-sub');
    if (hSub && res && res.detail) {
      var d = res.detail;
      var bits = [];
      if (typeof d.disk_used_pct === 'number') bits.push('disque ' + d.disk_used_pct + '%');
      if (typeof d.mem_used_pct === 'number') bits.push('mémoire ' + d.mem_used_pct + '%');
      if (typeof d.load_1m === 'number') bits.push('charge ' + d.load_1m);
      if (bits.length) hSub.textContent = bits.join(' · ');
    }

    var note = el('#infra-note');
    if (note && data.generated_at) {
      var when = fmtWhen(data.generated_at);
      note.textContent = 'Mesuré ' + (when || data.generated_at) + ' par le Status Center.';
    }
  }

  function applyHealth(h) {
    if (!h) return;
    var dep = el('#m-deploy');
    if (dep) {
      dep.textContent = h.repository_head ? String(h.repository_head).slice(0, 7) : '—';
    }
    var sub = el('#m-deploy-sub');
    if (sub) {
      var when = fmtWhen(h.deployed_at);
      sub.textContent = when ? ('déployé ' + when) : (h.deployed_at || 'horodatage absent');
    }
  }

  function load(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function start() {
    load('/api/status.json').then(applyStatus).catch(function (e) { degrade(e.message); });
    load('/health.json').then(applyHealth).catch(function () { /* deploy stamp is optional */ });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
