'use strict';
// =====================================================
// MYTHOS Guardian — the remediation action registry
// ops/guardian/lib/actions.js
//
// Every action Guardian can take is a static entry in ACTIONS. There is no
// way to add one at runtime: not from configuration, not from environment,
// not from the Status Center, not from anything Guardian reads. An action id
// that is not in this file does not exist.
//
// THE SHAPE OF AN ACTION
//   id              stable identifier, used in audit records and cooldowns
//   domain          which domain's level can trigger it
//   flag            the config flag that must be true; without it, never
//   min_level       the domain level at or above which it becomes a candidate
//   cooldown_s      minimum seconds between two runs of this action
//   max_per_day     hard ceiling on runs in a rolling 24 h
//   reversible      what undoing it costs, in plain words
//   protects        what it must prove it is NOT touching
//   precondition    (ctx) -> {ok, reason, evidence}   pure, no side effects
//   command         (ctx) -> argv                      what will run, exactly
//   verify          (io, ctx, before) -> {ok, detail}  did it do what it said
//
// WHAT IS DELIBERATELY ABSENT
//   * No deletion primitive. Guardian still has no unlink, rm or rmdir. Disk
//     remediation is done with allowlisted commands that remove only DERIVED
//     data (a package cache, a build cache), never files chosen by path.
//     Reclaiming ~/.vscode-server (1.4 GB here) would need a real delete
//     primitive, so it is NOT in V1 — that is a separate, reviewable change.
//   * No kill. Not by pid, not by name, not by RSS.
//   * No agent-session control. The executor's Resource Guard already defers
//     dispatch at CRITICAL and the session guard already owns admission;
//     Guardian publishes an advisory instead of growing a second one.
//   * No ERP, database, backup, credential or production-volume operation of
//     any kind, at any level, ever. See PROTECTED.
// =====================================================

var path = require('path');

// Anything matching PROTECTED is refused before an action is even considered.
// This is belt-and-braces: no action below targets any of it. It exists so
// that a future action cannot quietly acquire the ability.
var PROTECTED = {
  // Substrings. If a command's argv or an action's target contains one, refuse.
  needles: [
    'mythos-backups', 'backup-health', '.ssh', 'id_ed25519', 'id_rsa', '.env',
    'secrets', 'credential', 'postgres', 'mysql', 'mariadb', 'erp',
    '.git', 'mythos-prod', 'idauto', 'piece', 'ssangyong', 'dar-hijama'
  ],
  // Units no action may ever touch, whatever its class says.
  units: [
    'erp-api.service', 'idauto-api.service', 'mariadb.service', 'docker.service',
    'nginx.service', 'user@1001.service', 'mythos-ai-executor.service',
    'piece-autos.service', 'ssangyong-storefront.service', 'mythos-wp.service',
    'mythos-backup.timer', 'mythos-backup-db.timer', 'mythos-session-guard.timer'
  ],
  // Docker object classes no action may ever remove.
  docker: ['volume', 'container', 'image']
};

function protectedHit(text) {
  var t = String(text || '').toLowerCase();
  for (var i = 0; i < PROTECTED.needles.length; i++) {
    if (t.indexOf(PROTECTED.needles[i]) >= 0) return PROTECTED.needles[i];
  }
  return null;
}

function refusesProtected(argv) {
  var joined = (argv || []).join(' ');
  var hit = protectedHit(joined);
  if (hit) return 'argv mentions a protected resource: ' + hit;
  for (var i = 0; i < PROTECTED.units.length; i++) {
    if (joined.indexOf(PROTECTED.units[i]) >= 0) return 'targets a protected unit: ' + PROTECTED.units[i];
  }
  return null;
}

function ok(evidence) { return { ok: true, reason: null, evidence: evidence || null }; }
function no(reason, evidence) { return { ok: false, reason: reason, evidence: evidence || null }; }

// --- the registry -------------------------------------------------------

var ACTIONS = {

  // ---------------------------------------------------------------- disk
  ACTION_CLEAR_NPM_CACHE: {
    id: 'ACTION_CLEAR_NPM_CACHE',
    title: 'clear the npm package cache',
    domain: 'disk',
    flag: 'allow_disk_remediation',
    min_level: 'HIGH',
    cooldown_s: 6 * 3600,
    max_per_day: 2,
    reversible: 'fully — npm re-downloads what it needs on the next install',
    protects: ['no repository, no node_modules, no lockfile, no credential'],
    description:
      'Removes ~/.npm/_cacache, which is a cache of downloaded tarballs and nothing else. ' +
      'It is derived data: every entry can be fetched again from the registry.',
    precondition: function (ctx) {
      if (!ctx.disk || typeof ctx.disk.used_pct !== 'number') return no('disk usage unknown');
      if (ctx.npm_cache_mib === null || ctx.npm_cache_mib === undefined) return no('npm cache size unknown');
      if (ctx.npm_cache_mib < 64) return no('npm cache is only ' + ctx.npm_cache_mib + ' MiB — not worth an action');
      return ok({ npm_cache_mib: ctx.npm_cache_mib, disk_used_pct: ctx.disk.used_pct });
    },
    command: function () { return ['npm', 'cache', 'clean', '--force']; },
    verify: function (io, ctx, before) {
      var after = ctx.measure.npmCacheMib();
      return {
        ok: after === null || before.npm_cache_mib === null || after < before.npm_cache_mib,
        detail: 'npm cache ' + before.npm_cache_mib + ' MiB -> ' + after + ' MiB'
      };
    }
  },

  ACTION_PRUNE_DOCKER_BUILD_CACHE: {
    id: 'ACTION_PRUNE_DOCKER_BUILD_CACHE',
    title: 'prune Docker build cache older than the retention window',
    domain: 'disk',
    flag: 'allow_disk_remediation',
    min_level: 'HIGH',
    cooldown_s: 12 * 3600,
    max_per_day: 1,
    reversible: 'not directly — the next build rebuilds the discarded layers, costing time only',
    protects: ['no image, no container, no volume, no named build target'],
    description:
      'Runs `docker builder prune` with an age filter. Build cache is derived data: it is ' +
      'the intermediate layers of past builds and holds no image, container or volume. ' +
      'This is NOT `docker system prune -a` and NOT any form of volume prune — those are ' +
      'refused by the command allowlist and by PROTECTED.',
    precondition: function (ctx) {
      if (!ctx.docker || !ctx.docker.build_cache_reclaimable_gb) return no('Docker build cache size unknown');
      if (ctx.docker.build_cache_reclaimable_gb < 1) {
        return no('only ' + ctx.docker.build_cache_reclaimable_gb + ' GB reclaimable — not worth an action');
      }
      return ok({ reclaimable_gb: ctx.docker.build_cache_reclaimable_gb });
    },
    command: function (ctx) {
      var hours = (ctx.policy && ctx.policy.docker_build_cache_keep_hours) || 168;
      return ['docker', 'builder', 'prune', '--force', '--filter', 'until=' + hours + 'h'];
    },
    verify: function (io, ctx, before) {
      var after = ctx.measure.dockerBuildCacheGb();
      return {
        ok: after === null || before.reclaimable_gb === null || after <= before.reclaimable_gb,
        detail: 'build cache reclaimable ' + before.reclaimable_gb + ' GB -> ' + after + ' GB'
      };
    }
  },

  // ------------------------------------------------------------- sessions
  ACTION_PUBLISH_ADMISSION_ADVISORY: {
    id: 'ACTION_PUBLISH_ADMISSION_ADVISORY',
    title: 'publish the recommended agent admission ceiling',
    domain: 'sessions',
    flag: 'allow_agent_throttling',
    min_level: 'WARNING',
    cooldown_s: 60,
    max_per_day: 1440,
    reversible: 'fully — it is one small file, and it is advisory',
    protects: ['kills nothing, signals nothing, starts nothing, stops nothing'],
    description:
      'Writes {level, max_concurrent_agents, updated_at} to the pressure directory. It is a ' +
      'PUBLICATION, in the same shape and the same place as the Resource Guard publication ' +
      'from #286, and it is advisory: nothing is forced to obey it. Guardian does not ' +
      'reduce concurrency itself, because the executor already defers dispatch at CRITICAL ' +
      'and the session guard already owns admission. This gives them a number to read ' +
      'instead of Guardian growing a second admission controller.',
    precondition: function (ctx) {
      if (!ctx.sessions) return no('session state unknown');
      if (typeof ctx.recommended_ceiling !== 'number') return no('no ceiling computed for this level');
      return ok({ level: ctx.memory_level, ceiling: ctx.recommended_ceiling, sessions: ctx.sessions.remote_sessions });
    },
    // Not a command: a publication. remediate.js routes `publish` actions to
    // io.publishAdvisory(), which writes ONE named file in ONE named
    // directory and nothing else.
    publish: function (ctx) {
      return {
        file: 'admission.json',
        body: {
          level: ctx.memory_level,
          max_concurrent_agents: ctx.recommended_ceiling,
          observed_agents: ctx.sessions.remote_sessions,
          advisory: true,
          updated_at: new Date(ctx.nowMs).toISOString()
        }
      };
    },
    verify: function (io, ctx) {
      var got = io.readJson(path.join(ctx.policy.publish_dir, 'admission.json'));
      return {
        ok: !!(got && got.max_concurrent_agents === ctx.recommended_ceiling),
        detail: got ? 'published ceiling ' + got.max_concurrent_agents : 'publication not readable back'
      };
    }
  },

  // ------------------------------------------------------------- services
  ACTION_RESTART_APPROVED_SERVICE: {
    id: 'ACTION_RESTART_APPROVED_SERVICE',
    title: 'restart a support service that is down',
    domain: 'services',
    flag: 'allow_service_restart',
    min_level: 'WARNING',
    cooldown_s: 30 * 60,
    max_per_day: 4,
    reversible: 'a restart is not undoable; the unit is support-class and holds no state',
    protects: ['never a critical or production unit, never a database, never a timer, never a container'],
    description:
      'Restarts ONE deploy user unit, chosen only from services.restartable in the ' +
      'configuration, which may list support-class units and nothing else. A unit in ' +
      'PROTECTED is refused even if configuration lists it. A restart loop cannot be ' +
      'created: the unit must be inactive or failed (never merely restarting), the action ' +
      'has a 30-minute cooldown and at most 4 runs a day, and after max_attempts the ' +
      'service is marked DEGRADED and left alone for a human.',
    precondition: function (ctx) {
      var t = ctx.target;
      if (!t) return no('no candidate unit');
      if (t.class !== 'support') return no(t.id + ' is ' + t.class + '-class; only support units are restartable');
      if (PROTECTED.units.indexOf(t.unit) >= 0) return no(t.unit + ' is protected and is never restarted');
      if (t.manager !== 'deploy') return no(t.unit + ' is a system unit; Guardian is unprivileged and does not touch it');
      if (t.status === 'LOOP') return no(t.id + ' is already restarting in a loop — restarting again would hide the fault');
      if (t.status !== 'FAILED' && t.status !== 'INACTIVE') return no(t.id + ' is ' + t.status + ', not down');
      if (t.attempts >= ctx.policy.max_attempts) {
        return no(t.id + ' has had ' + t.attempts + ' restarts already; it is DEGRADED and needs a human');
      }
      return ok({ unit: t.unit, status: t.status, attempts: t.attempts });
    },
    command: function (ctx) { return ['systemctl', '--user', 'restart', ctx.target.unit]; },
    verify: function (io, ctx) {
      var r = io.spawn(['systemctl', '--user', 'is-active', ctx.target.unit], { timeout_ms: 10000 });
      var state = String(r.stdout || '').trim();
      return { ok: state === 'active' || state === 'activating', detail: ctx.target.unit + ' is ' + (state || 'unknown') };
    }
  }
};

function list() { return Object.keys(ACTIONS).map(function (k) { return ACTIONS[k]; }); }
function get(id) { return Object.prototype.hasOwnProperty.call(ACTIONS, id) ? ACTIONS[id] : null; }

module.exports = {
  ACTIONS: ACTIONS, PROTECTED: PROTECTED,
  list: list, get: get,
  protectedHit: protectedHit, refusesProtected: refusesProtected
};
