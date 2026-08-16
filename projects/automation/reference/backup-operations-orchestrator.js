'use strict';
// =====================================================
// Mythos Automation & Operations — Backup, Integrity Verification and
// Isolated Restore Testing (INF-BACKUP-AUTO-0)
// projects/automation/reference/backup-operations-orchestrator.js
//
// Contract: docs/AUTOMATION_ROADMAP.md §"INF-BACKUP-AUTO-0", ratified by owner
// decisions O-BACKUP-1 (scope — wrap the existing tooling, never parallel it),
// O-BACKUP-2 (automation levels and the permanent LEVEL_3 boundaries this
// stage does NOT receive), O-BACKUP-3 (the connector stays read-only),
// O-BACKUP-4 (evidence recording, no `aut_*` tables, no database writes), and
// O-BACKUP-5 (2026-08-16: backup_create and restore_test designated
// LEVEL_4_FULL_AUTOMATIC under the approved policy in
// projects/automation/config/inf-backup-auto-0-approval-policy.json; LEVEL_2
// external mutation permanently ruled out; permanent boundaries withheld).
//
// THIS MODULE OWNS NO BACKUP LOGIC.
// Manifest construction, checksums, staging, upload, remote verification,
// restore verification and retention all live in
// `projects/idauto/ops/offhost-backup.js` and are REQUIRED from here, never
// reimplemented. O-BACKUP-1 says so explicitly, and
// docs/OFF_HOST_BACKUP_GATE.md §0 says why: a second mechanism "would create
// two backup paths with one set of guarantees between them". Everything this
// file adds is a GATE in front of that tooling — never a replacement for it.
//
// WHAT THIS MODULE CANNOT DO, STRUCTURALLY:
// delete a backup · disable a backup · overwrite production data · restore
// over production · destroy backup history. These are permanent LEVEL_3
// boundaries (docs/AUTOMATION_APPROVAL_MATRIX.md §2 items 6-8) that O-BACKUP-2
// explicitly does NOT authorise. There is no parameter, flag, capability or
// argument that reaches them: they are refused by name, by operation shape,
// and again by the underlying tool's own `--destructive` refusal.
//
// This module never constructs a provider client, never performs a network
// call, never reads a credential value, and never executes a shell command.
// Clients and parsed documents are injected by the caller, exactly as every
// other module in this track requires.
// =====================================================

var crypto = require('crypto');
var offhost = require('../../idauto/ops/offhost-backup.js');

// -----------------------------------------------------------------------
// Levels (O-BACKUP-2, amended by O-BACKUP-5, ratified 2026-08-16).
// Declared as constants, never taken from a request — "No operation may
// self-authorise."
//
// O-BACKUP-5 resolved the LEVEL_2 external-mutation contradiction by
// designating the two MUTATING operations LEVEL_4_FULL_AUTOMATIC — the level
// the approval matrix (docs/AUTOMATION_APPROVAL_MATRIX.md §3) already listed
// them as eligible for — under an approved policy covering all four
// operations. The two read-only operations remain LEVEL_2_RECOMMEND, whose
// committed "no external mutation" definition they genuinely satisfy.
// -----------------------------------------------------------------------
var OPERATION_LEVELS = {
  backup_create: 'LEVEL_4_FULL_AUTOMATIC',
  backup_verify: 'LEVEL_2_RECOMMEND',
  restore_test: 'LEVEL_4_FULL_AUTOMATIC',
  retention_report: 'LEVEL_2_RECOMMEND'
};
var AUTHORISED_OPERATIONS = Object.keys(OPERATION_LEVELS);
var LEVEL_2 = 'LEVEL_2_RECOMMEND';
var LEVEL_3 = 'LEVEL_3_APPROVAL_REQUIRED';
var LEVEL_4 = 'LEVEL_4_FULL_AUTOMATIC';

// O-BACKUP-2: permanent boundaries this stage does NOT receive. Refused by
// name before anything else looks at the request.
var PROHIBITED_OPERATIONS = [
  'backup_delete', 'delete_backup', 'backup_disable', 'disable_backup',
  'production_restore', 'restore_over_production', 'production_overwrite',
  'overwrite_production', 'destroy_backup_history', 'backup_history_destroy',
  'retention_delete', 'prune', 'purge'
];

// O-BACKUP-3: the ONLY connector this stage may use, and the ONLY capabilities
// it may hold. This is an exact-set check, not a subset check — a capability
// outside this set is a broadening and is refused, whatever it is called.
var READ_CONNECTOR_ID = 'backup_storage_readonly';
var PERMITTED_CAPABILITIES = ['backup.list', 'backup.verify'];

// Client methods a read-only backup client may expose. Anything else is a
// scope escape, refused before any call is made.
var PERMITTED_CLIENT_METHODS = ['list', 'head', 'get'];
var MUTATION_METHOD_PATTERN = /^(put|post|write|upload|delete|del|remove|destroy|purge|prune|truncate|drop|set|create|update|patch|move|copy|rename)/i;

var PRODUCTION_TOKENS = ['production', 'prod', 'live', 'prd', 'primary'];

var SECRET_FIELD_PATTERN = /^(api[_-]?key|apikey|api[_-]?token|token|secret|password|passwd|private[_-]?key|credential|ssh[_-]?key|access[_-]?token|secret[_-]?access[_-]?key|access[_-]?key[_-]?id|authorization)$/i;

// Paths an isolated restore target may never resolve to or sit beneath.
// Mirrors — and deliberately widens — the underlying tool's own refusal list.
var FORBIDDEN_RESTORE_ROOTS = [
  '/', '/home', '/home/deploy', '/var/backups/mythos', '/var/lib', '/etc',
  '/home/deploy/deployments', '/home/deploy/deployments/idauto-media',
  '/home/deploy/projects'
];

// Known production data stores. Naming one as a restore target is a refusal.
var PRODUCTION_DATA_STORES = [
  'dar-hijama-production-mysql-1', 'idauto-postgres', 'coolify-db',
  'darhijama_prod', 'idauto', 'coolify'
];

// -----------------------------------------------------------------------
// THE LEVEL_2 NO-MUTATION RULE — now a PERMANENT ratified invariant.
//
// This constant began life as the fail-closed encoding of an open
// contradiction (O-BACKUP-2 assigned LEVEL_2 to two mutating operations,
// while the committed definition of LEVEL_2_RECOMMEND is "no external
// mutation"). O-BACKUP-5 (ratified 2026-08-16) resolved it the other way
// round: the mutating operations moved UP to LEVEL_4_FULL_AUTOMATIC, and the
// owner ruled verbatim that "No LEVEL_2 external mutation is permitted."
//
// So this stays false FOREVER: it is no longer a pending question but the
// committed taxonomy's own rule, ratified twice. External mutation is instead
// gated by assertMutationPermitted below — LEVEL_4 designation + the
// LEVEL_4 feature flag + the approved LEVEL_4 policy, all three.
// -----------------------------------------------------------------------
var LEVEL_2_MAY_MUTATE_EXTERNALLY = false;

// Adapter surface for the one mutating delegation path (offhost.push /
// offhost.verifyRemote). `put` is required by push and is NOT a broadening of
// the read-only connector: the write path belongs to the existing offhost
// tooling (O-BACKUP-3: "backup creation must use the existing authorised
// offhost-backup mechanism"), never to `backup_storage_readonly`, whose
// exact-set {backup.list, backup.verify} check is untouched. What the adapter
// may NEVER expose is any deletion or destruction capability — the permanent
// boundaries stay structurally out of reach even on the write path.
var PERMITTED_WRITE_ADAPTER_METHODS = ['put', 'head', 'get', 'describe'];
var DESTRUCTIVE_METHOD_PATTERN = /^(del|delete|remove|destroy|purge|prune|truncate|drop|erase|wipe|disable)/i;

function refuse(code, detail) {
  var e = new Error('BACKUP_ORCHESTRATOR: ' + code + (detail ? ' — ' + detail : ''));
  e.refused = true;
  e.code = code;
  return e;
}

function sha16(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
}

/**
 * Tokenised on every non-alphanumeric boundary rather than matched as a
 * substring, so `backup.delete.production`, `mythos-prod` and `db_production`
 * are all caught while `staging` and `scratch` are not. Reused from the
 * INF-DEPLOY-AUTO-0 precedent, where a substring check was proven to miss
 * dot-separated capability names.
 */
function looksProduction(value) {
  if (typeof value !== 'string') return false;
  return value.trim().toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
    .some(function (tok) { return PRODUCTION_TOKENS.indexOf(tok) !== -1; });
}

/**
 * Refuses any object carrying a secret-shaped key, at any depth. Applied to
 * every plan, envelope and evidence record before it leaves this module —
 * O-BACKUP-4: "Secrets and credential values must never be recorded."
 */
function assertNoSecrets(value, pathLabel, seen) {
  if (!value || typeof value !== 'object') return true;
  seen = seen || [];
  if (seen.indexOf(value) !== -1) return true;
  seen.push(value);
  Object.keys(value).forEach(function (k) {
    if (SECRET_FIELD_PATTERN.test(k)) {
      throw refuse('CREDENTIAL_VALUE_PRESENT', (pathLabel ? pathLabel + '.' : '') + k);
    }
    assertNoSecrets(value[k], (pathLabel ? pathLabel + '.' : '') + k, seen);
  });
  return true;
}

// -----------------------------------------------------------------------
// assertOperationAuthorised(request) -> { operation, level }
//
// O-BACKUP-2: "No operation may self-authorise." The level is looked up from
// the constant table above and NEVER read from the request; a request that
// tries to declare its own level is refused outright rather than ignored,
// because silently ignoring it would let a caller believe it had been honoured.
// -----------------------------------------------------------------------
function assertOperationAuthorised(request) {
  request = request || {};
  var op = request.operation;
  if (typeof op !== 'string' || !op.trim()) throw refuse('OPERATION_REQUIRED');
  var normalised = op.trim().toLowerCase();

  if (PROHIBITED_OPERATIONS.indexOf(normalised) !== -1) {
    throw refuse('PERMANENT_BOUNDARY_OPERATION_REFUSED',
      '"' + normalised + '" is a permanent LEVEL_3 boundary and is not authorised by this stage (O-BACKUP-2)');
  }
  // Shape check as well as name check: an unlisted destructive synonym must
  // not slip through merely because it was spelled differently.
  if (/(delete|destroy|disable|purge|prune|overwrite|truncate|drop|erase|wipe)/i.test(normalised)) {
    throw refuse('DESTRUCTIVE_OPERATION_REFUSED',
      '"' + normalised + '" is destructive in shape; this stage holds no destructive capability');
  }
  if (looksProduction(normalised)) {
    throw refuse('PRODUCTION_OPERATION_REFUSED', '"' + normalised + '" names a production target');
  }
  if (AUTHORISED_OPERATIONS.indexOf(normalised) === -1) {
    throw refuse('OPERATION_NOT_AUTHORISED',
      '"' + normalised + '" is not one of [' + AUTHORISED_OPERATIONS.join(', ') + ']');
  }
  // Self-authorisation attempts.
  ['automation_level', 'automationLevel', 'level', 'approved', 'is_approved',
    'authorised', 'authorized', 'self_approve'].forEach(function (k) {
    if (request[k] !== undefined) {
      throw refuse('SELF_AUTHORISATION_REFUSED',
        '"' + k + '" may not be declared by the request; the level is fixed per operation (O-BACKUP-2)');
    }
  });
  return { operation: normalised, level: OPERATION_LEVELS[normalised] };
}

// -----------------------------------------------------------------------
// assertNoDatabaseWrite(request)
//
// O-BACKUP-4 / DATABASE WRITES: production PostgreSQL writes are not
// authorised, and no `aut_*` table may be added. Any request asking this
// stage to persist state is refused AT THE BOUNDARY with the exact owner
// decision that would be required — it does not invent a schema.
// -----------------------------------------------------------------------
function assertNoDatabaseWrite(request) {
  request = request || {};
  ['persist', 'persistState', 'persist_state', 'writeDatabase', 'write_database',
    'database', 'db', 'table', 'aut_table', 'connection', 'connectionString',
    'connection_string', 'dsn'].forEach(function (k) {
    if (request[k] !== undefined) {
      throw refuse('DATABASE_WRITE_NOT_AUTHORISED',
        '"' + k + '" is refused: production database writes are not authorised by O-BACKUP-4, and persistent ' +
        'state requires a separate owner decision rather than an invented schema');
    }
  });
  return true;
}

// -----------------------------------------------------------------------
// assertIsolatedTarget(target) — the restore-test gate (O-BACKUP-1/2).
//
// TWO INDEPENDENT SOURCES MUST AGREE, exactly as INF-DEPLOY-AUTO-0's staging
// proof requires and for the same reason: a convenient string is not evidence.
//   (1) the DECLARED record — is_production:false AND is_isolated:true
//   (2) the RUNTIME-REPORTED isolation facts — no network, no published
//       ports, ephemeral storage
// Disagreement is a refusal, never a resolution.
//
// docs/OFF_HOST_BACKUP_GATE.md §5 fixes the isolation requirements this
// mirrors: no production connection, no production volume, --network none,
// no published port, removed afterwards.
// -----------------------------------------------------------------------
function assertIsolatedTarget(target) {
  if (!target || typeof target !== 'object') throw refuse('ISOLATED_TARGET_REQUIRED');
  assertNoSecrets(target, 'target');

  // ---- Source 1: the declaration ----
  if (target.is_production !== false) {
    throw refuse('TARGET_NOT_DECLARED_NON_PRODUCTION',
      'is_production must be exactly false; got ' + JSON.stringify(target.is_production));
  }
  if (target.is_isolated !== true) {
    throw refuse('TARGET_NOT_DECLARED_ISOLATED',
      'is_isolated must be exactly true; got ' + JSON.stringify(target.is_isolated));
  }
  if (typeof target.target_id !== 'string' || !target.target_id.trim()) {
    throw refuse('TARGET_IDENTITY_REQUIRED', 'an isolated target must be identifiable in the evidence record');
  }
  if (looksProduction(target.target_id)) {
    throw refuse('TARGET_NAMES_PRODUCTION', 'target_id "' + target.target_id + '"');
  }

  // ---- Source 2: the runtime-reported isolation facts ----
  var iso = target.isolation;
  if (!iso || typeof iso !== 'object') {
    throw refuse('ISOLATION_EVIDENCE_REQUIRED',
      'a declaration alone is not proof of isolation; runtime isolation facts are required');
  }
  if (iso.network !== 'none') {
    throw refuse('TARGET_NETWORK_NOT_ISOLATED',
      'network must be exactly "none" (OFF_HOST_BACKUP_GATE.md §5); got ' + JSON.stringify(iso.network));
  }
  if (!Array.isArray(iso.published_ports)) {
    throw refuse('PUBLISHED_PORTS_UNKNOWN', 'published_ports must be a declared array; unknown is not zero');
  }
  if (iso.published_ports.length !== 0) {
    throw refuse('TARGET_PUBLISHES_PORTS', iso.published_ports.length + ' published port(s); must be 0');
  }
  if (iso.ephemeral !== true) {
    throw refuse('TARGET_NOT_EPHEMERAL', 'ephemeral must be exactly true; a persistent target is not a scratch target');
  }
  if (['tmpfs', 'ephemeral', 'none'].indexOf(String(iso.volume_kind)) === -1) {
    throw refuse('TARGET_VOLUME_NOT_ISOLATED',
      'volume_kind must be tmpfs/ephemeral/none — never a named or bind volume; got ' + JSON.stringify(iso.volume_kind));
  }

  // ---- Cross-checks: neither source may name a production data store ----
  if (target.data_store !== undefined && PRODUCTION_DATA_STORES.indexOf(String(target.data_store)) !== -1) {
    throw refuse('PRODUCTION_DATA_STORE_REFUSED',
      '"' + target.data_store + '" is a production data store; a restore test may never target it');
  }
  Object.keys(iso).forEach(function (k) {
    if (looksProduction(String(iso[k]))) {
      throw refuse('ISOLATION_EVIDENCE_NAMES_PRODUCTION', 'isolation.' + k + ' = ' + JSON.stringify(iso[k]));
    }
  });

  // ---- Path safety ----
  var dest = target.restore_path;
  if (typeof dest !== 'string' || !dest.trim()) throw refuse('RESTORE_PATH_REQUIRED');
  if (dest.indexOf('\0') !== -1) throw refuse('RESTORE_PATH_INVALID', 'null byte');
  if (dest.charAt(0) !== '/') throw refuse('RESTORE_PATH_NOT_ABSOLUTE', dest);
  if (dest.split('/').indexOf('..') !== -1) throw refuse('RESTORE_PATH_TRAVERSAL', dest);
  var normalised = dest.replace(/\/+$/, '') || '/';
  FORBIDDEN_RESTORE_ROOTS.forEach(function (root) {
    if (normalised === root || normalised.indexOf(root === '/' ? '/' : root + '/') === 0) {
      // '/' would match everything; it is caught by the equality arm only.
      if (root === '/' && normalised !== '/') return;
      throw refuse('RESTORE_PATH_FORBIDDEN',
        '"' + dest + '" resolves to or beneath "' + root + '"; production data must never be overwritten by a restore test');
    }
  });
  if (looksProduction(normalised)) throw refuse('RESTORE_PATH_NAMES_PRODUCTION', dest);

  return {
    target_id: target.target_id,
    restore_path: normalised,
    isolation_proof: {
      declared_non_production: true,
      declared_isolated: true,
      network: iso.network,
      published_ports: 0,
      ephemeral: true,
      volume_kind: iso.volume_kind,
      sources_agree: true
    }
  };
}

// -----------------------------------------------------------------------
// assertReadOnlyConnector({ connector, catalogue, featureFlags, client })
//
// O-BACKUP-3: `backup_storage_readonly` stays exactly as it is. This is an
// EXACT-SET capability check — any capability outside {backup.list,
// backup.verify} is a broadening and is refused, and so is any other
// connector id. "No new connector permission may be invented."
// -----------------------------------------------------------------------
function assertReadOnlyConnector(input) {
  input = input || {};
  var connector = input.connector, catalogue = input.catalogue, flags = input.featureFlags || {};
  if (!connector || typeof connector !== 'object') throw refuse('CONNECTOR_REQUIRED');
  if (!Array.isArray(catalogue)) throw refuse('CONNECTOR_CATALOGUE_REQUIRED');
  if (connector.connector_id !== READ_CONNECTOR_ID) {
    throw refuse('CONNECTOR_NOT_AUTHORISED',
      'only ' + READ_CONNECTOR_ID + ' is authorised; got ' + String(connector.connector_id));
  }
  var declared = catalogue.filter(function (c) { return c.connector_id === READ_CONNECTOR_ID; })[0];
  if (!declared) throw refuse('CONNECTOR_NOT_IN_CATALOGUE', READ_CONNECTOR_ID);
  if (declared.permission !== 'READ_ONLY') {
    throw refuse('CONNECTOR_PERMISSION_BROADENED',
      'permission must remain READ_ONLY (O-BACKUP-3); got ' + String(declared.permission));
  }
  var caps = declared.capabilities || [];
  caps.forEach(function (c) {
    if (PERMITTED_CAPABILITIES.indexOf(c) === -1) {
      throw refuse('CONNECTOR_CAPABILITY_BROADENED',
        '"' + c + '" is outside the ratified set [' + PERMITTED_CAPABILITIES.join(', ') + ']; O-BACKUP-3 forbids broadening');
    }
  });
  if (declared.enabled !== true) throw refuse('CONNECTOR_DISABLED', READ_CONNECTOR_ID);
  // Level-aware run gate (O-BACKUP-5): an operation runs only while the
  // feature flag for ITS designated level is on. The read-only operations are
  // LEVEL_2 runs; the mutating operations are LEVEL_4 runs. When no level is
  // supplied the strict read-path default (LEVEL_2) applies.
  if (input.level === LEVEL_4) {
    if (flags.level_4_full_automatic_runs !== true) {
      throw refuse('LEVEL_4_RUNS_DISABLED', 'level_4_full_automatic_runs is not true');
    }
  } else if (flags.level_2_recommend_runs !== true) {
    throw refuse('LEVEL_2_RUNS_DISABLED', 'level_2_recommend_runs is not true');
  }
  // A LEVEL_3 flag must never be required, requested, or enabled by this stage.
  if (flags.level_3_approval_required_runs === true) {
    throw refuse('LEVEL_3_FLAG_NOT_PERMITTED',
      'this stage holds no LEVEL_3 capability and must not run with the global LEVEL_3 gate open');
  }
  if (typeof connector.secret_reference_id !== 'string' || !connector.secret_reference_id.trim()) {
    throw refuse('CREDENTIAL_REFERENCE_MISSING', READ_CONNECTOR_ID);
  }
  assertNoSecrets(connector, 'connector');

  var client = input.client;
  if (!client || typeof client !== 'object') throw refuse('CONNECTOR_CLIENT_REQUIRED');
  var methods = Object.keys(client).filter(function (k) { return typeof client[k] === 'function'; });
  methods.forEach(function (m) {
    if (MUTATION_METHOD_PATTERN.test(m)) {
      throw refuse('MUTATION_CAPABLE_CLIENT_REFUSED',
        'client exposes mutation-shaped method "' + m + '"; this stage is structurally read-only');
    }
    if (PERMITTED_CLIENT_METHODS.indexOf(m) === -1) {
      throw refuse('CONNECTOR_SCOPE_ESCAPE', 'client exposes undeclared method "' + m + '"');
    }
  });
  return { connector_id: READ_CONNECTOR_ID, capabilities: caps, methods: methods };
}

// -----------------------------------------------------------------------
// assertPolicy({ policy, operation, level })
//
// O-BACKUP-2: an approved policy must exist and cover the operation. It may
// never be a permanent boundary, may never allow self-approval, and may never
// be inferred — "No approval may be inferred from user text", so a prose or
// free-text field is refused rather than parsed.
// -----------------------------------------------------------------------
function assertPolicy(input) {
  input = input || {};
  var p = input.policy;
  if (!p || typeof p !== 'object') throw refuse('APPROVAL_POLICY_REQUIRED');
  assertNoSecrets(p, 'policy');
  if (typeof p.policy_key !== 'string' || !p.policy_key.trim()) throw refuse('POLICY_KEY_REQUIRED');
  if (p.enabled !== true) throw refuse('POLICY_DISABLED', String(p.policy_key));
  if (p.minimum_automation_level_covered !== input.level) {
    throw refuse('POLICY_LEVEL_MISMATCH',
      'policy covers ' + String(p.minimum_automation_level_covered) + ', operation is ' + String(input.level));
  }
  if (p.minimum_automation_level_covered === LEVEL_3) {
    throw refuse('LEVEL_3_POLICY_NOT_AUTHORISED', 'O-BACKUP-2 authorises no LEVEL_3 operation in this stage');
  }
  if (p.minimum_automation_level_covered === LEVEL_4) {
    // The committed definition of LEVEL_4 (automation.example.json
    // §automation_levels, AUTOMATION_ARCHITECTURE.md §2): "Must have
    // monitoring, audit, bounded retries and rollback or safe failure.
    // Requires a previously approved policy." These are structural
    // requirements of the policy record, not prose to be inferred.
    if (p.has_monitoring !== true) throw refuse('LEVEL_4_POLICY_INCOMPLETE', 'has_monitoring must be exactly true');
    if (p.has_audit !== true) throw refuse('LEVEL_4_POLICY_INCOMPLETE', 'has_audit must be exactly true');
    if (typeof p.bounded_retries !== 'number' || !isFinite(p.bounded_retries) || p.bounded_retries < 0) {
      throw refuse('LEVEL_4_POLICY_INCOMPLETE', 'bounded_retries must be a finite non-negative number');
    }
    if (p.rollback_or_safe_failure !== true) {
      throw refuse('LEVEL_4_POLICY_INCOMPLETE', 'rollback_or_safe_failure must be exactly true');
    }
    if (typeof p.approved_by_decision !== 'string' || !p.approved_by_decision.trim()) {
      throw refuse('LEVEL_4_POLICY_INCOMPLETE',
        'a LEVEL_4 policy must name the owner decision that previously approved it');
    }
  }
  if (p.is_permanent_boundary === true) {
    throw refuse('PERMANENT_BOUNDARY_POLICY_REFUSED',
      'a permanent-boundary policy can never authorise a backup operation in this stage');
  }
  if (p.allow_self_approval !== false) {
    throw refuse('SELF_APPROVAL_PERMITTED_BY_POLICY', String(p.policy_key));
  }
  if (Array.isArray(p.covers_operations) && p.covers_operations.indexOf(input.operation) === -1) {
    throw refuse('POLICY_DOES_NOT_COVER_OPERATION',
      '"' + input.operation + '" not in [' + p.covers_operations.join(', ') + ']');
  }
  // Approval may never be inferred from prose.
  ['approval_text', 'approval_note', 'user_said', 'freeform', 'rationale_grants'].forEach(function (k) {
    if (p[k] !== undefined) {
      throw refuse('APPROVAL_INFERENCE_REFUSED',
        '"' + k + '" is refused: no approval may be inferred from user text (O-BACKUP-2)');
    }
  });
  return { policy_key: p.policy_key, level: p.minimum_automation_level_covered };
}

// -----------------------------------------------------------------------
// assertMutationPermitted({ operation, featureFlags, policy })
//
// The LAST gate before any external mutation, per O-BACKUP-5. Every other
// gate runs first and independently, so nothing here can weaken them. Three
// things must all hold, each fail-closed:
//   1. the operation's DESIGNATED level is LEVEL_4_FULL_AUTOMATIC — a
//      LEVEL_2 operation may never mutate (permanent, ratified O-BACKUP-5);
//   2. the LEVEL_4 feature flag is on (and the LEVEL_3 gate is not open —
//      this stage holds no LEVEL_3 capability);
//   3. the previously approved LEVEL_4 policy covers this exact operation,
//      with the structural requirements the committed LEVEL_4 definition
//      demands (monitoring, audit, bounded retries, rollback/safe failure).
// A bare-string call (the pre-O-BACKUP-5 signature) still fails closed: it
// carries no flags and no policy, so gate 2 refuses it.
// -----------------------------------------------------------------------
function assertMutationPermitted(input) {
  if (typeof input === 'string') input = { operation: input };
  input = input || {};
  var op = input.operation;
  if (typeof op !== 'string' || AUTHORISED_OPERATIONS.indexOf(op) === -1) {
    throw refuse('OPERATION_NOT_AUTHORISED', 'mutation gate: "' + String(op) + '"');
  }
  var level = OPERATION_LEVELS[op];
  if (level === LEVEL_2 || LEVEL_2_MAY_MUTATE_EXTERNALLY !== false) {
    throw refuse('LEVEL_2_MUTATION_NOT_PERMITTED',
      'operation "' + op + '" is ' + level + ' and LEVEL_2 external mutation is permanently ruled out (O-BACKUP-5)');
  }
  if (level !== LEVEL_4) {
    throw refuse('MUTATION_LEVEL_NOT_AUTHORISED',
      'operation "' + op + '" is designated ' + level + ', which holds no mutation capability in this stage');
  }
  var flags = input.featureFlags || {};
  if (flags.level_3_approval_required_runs === true) {
    throw refuse('LEVEL_3_FLAG_NOT_PERMITTED',
      'this stage holds no LEVEL_3 capability and must not mutate while the global LEVEL_3 gate is open');
  }
  if (flags.level_4_full_automatic_runs !== true) {
    throw refuse('LEVEL_4_RUNS_DISABLED',
      'operation "' + op + '" is LEVEL_4 and level_4_full_automatic_runs is not true');
  }
  assertPolicy({ policy: input.policy, operation: op, level: LEVEL_4 });
  return true;
}

// -----------------------------------------------------------------------
// assertBackupWriteAdapter(adapter) — the write surface for the ONE
// mutating delegation (offhost.push → offhost.verifyRemote). Exact-set:
// {put, head, get} required, `describe` tolerated, anything else refused —
// and any deletion-shaped method refused by name FIRST, so the permanent
// boundaries (backup deletion, history destruction) remain structurally
// unreachable even on the write path. The raw S3 adapter (which exposes
// `del` for separately-authorised maintenance) is therefore refused here:
// a composition root must hand this stage a wrapper without it.
// -----------------------------------------------------------------------
function assertBackupWriteAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object') throw refuse('BACKUP_ADAPTER_REQUIRED');
  var methods = Object.keys(adapter).filter(function (k) { return typeof adapter[k] === 'function'; });
  methods.forEach(function (m) {
    if (DESTRUCTIVE_METHOD_PATTERN.test(m)) {
      throw refuse('DELETE_CAPABLE_ADAPTER_REFUSED',
        'adapter exposes deletion-shaped method "' + m + '"; the permanent boundaries stay out of reach on the write path');
    }
    if (PERMITTED_WRITE_ADAPTER_METHODS.indexOf(m) === -1) {
      throw refuse('ADAPTER_SCOPE_ESCAPE', 'adapter exposes undeclared method "' + m + '"');
    }
  });
  ['put', 'head', 'get'].forEach(function (m) {
    if (typeof adapter[m] !== 'function') {
      throw refuse('ADAPTER_METHOD_MISSING', '"' + m + '" is required by offhost-backup push/verifyRemote');
    }
  });
  return { methods: methods };
}

// Local write locations for staging must be sane and may never point into
// the repository or system configuration. (Restore paths have their own,
// stricter list — this guards the backup path's local staging only.)
function assertLocalStagePath(p, label) {
  if (typeof p !== 'string' || !p.trim()) throw refuse('STAGE_PATH_REQUIRED', label);
  if (p.indexOf('\0') !== -1) throw refuse('STAGE_PATH_INVALID', label + ': null byte');
  if (p.charAt(0) !== '/') throw refuse('STAGE_PATH_NOT_ABSOLUTE', label + ': ' + p);
  if (p.split('/').indexOf('..') !== -1) throw refuse('STAGE_PATH_TRAVERSAL', label + ': ' + p);
  var norm = p.replace(/\/+$/, '') || '/';
  ['/home/deploy/projects', '/etc', '/var/lib'].forEach(function (root) {
    if (norm === root || norm.indexOf(root + '/') === 0) {
      throw refuse('STAGE_PATH_FORBIDDEN', label + ' resolves under "' + root + '"');
    }
  });
  if (norm === '/') throw refuse('STAGE_PATH_FORBIDDEN', label + ' is the filesystem root');
  return norm;
}

// -----------------------------------------------------------------------
// buildBackupPlan(request) -> deterministic, secret-free plan.
//
// O-BACKUP-1: "A backup operation and a restore-test operation must have
// separate validation and verification paths." The plan therefore branches
// into two distinct step sets with two distinct verification kinds — they are
// never the same steps with a different label.
// -----------------------------------------------------------------------
function buildBackupPlan(request) {
  request = request || {};
  var authorised = assertOperationAuthorised(request);
  assertNoDatabaseWrite(request);

  var steps, verification, rollback;
  if (authorised.operation === 'backup_create') {
    steps = [
      { step_id: 'bkp-001', sequence: 1, kind: 'stage_local',
        description: 'Stage the backup set locally via offhost-backup.stage (manifest + checksums)',
        performs_external_mutation: false },
      { step_id: 'bkp-002', sequence: 2, kind: 'verify_local',
        description: 'offhost-backup.verifyLocal — C1 source checksums at rest',
        performs_external_mutation: false },
      { step_id: 'bkp-003', sequence: 3, kind: 'push_offhost',
        description: 'offhost-backup.push — upload objects, COMPLETE marker written last',
        performs_external_mutation: true }
    ];
    verification = {
      kind: 'BACKUP_INTEGRITY',
      method: 'offhost-backup.verifyRemote — re-HEAD every object against the manifest, then confirm the COMPLETE marker',
      note: 'ETag is never used as a checksum (OFF_HOST_BACKUP_GATE.md §2)'
    };
    rollback = {
      kind: 'abandon_incomplete_set',
      description: 'An incomplete set is never advertised as restorable: the COMPLETE marker is written last, ' +
        'so an aborted upload leaves an unusable prefix rather than a false backup.',
      deletes_anything: false,
      note: 'Cleanup of an abandoned prefix is a deletion and is NOT authorised by this stage (O-BACKUP-2)'
    };
  } else if (authorised.operation === 'restore_test') {
    steps = [
      { step_id: 'rst-001', sequence: 1, kind: 'prove_isolation',
        description: 'Two-source isolation proof of the restore target before anything is read',
        performs_external_mutation: false },
      { step_id: 'rst-002', sequence: 2, kind: 'verify_remote',
        description: 'offhost-backup.verifyRemote — the set must be complete and intact before restoring',
        performs_external_mutation: false },
      { step_id: 'rst-003', sequence: 3, kind: 'restore_into_isolated_target',
        description: 'offhost-backup.restoreVerify into the proven-isolated target only',
        performs_external_mutation: true }
    ];
    verification = {
      kind: 'RESTORE_STRUCTURAL',
      method: 'offhost-backup.verifyLocal on the restored tree — a restored target is validated structurally, ' +
        'never by byte-comparison against a dump (OFF_HOST_BACKUP_GATE.md §2: R is not byte-comparable)',
      note: 'distinct from BACKUP_INTEGRITY: separate validation and verification paths (O-BACKUP-1)'
    };
    rollback = {
      kind: 'discard_isolated_target',
      description: 'The isolated target is ephemeral (tmpfs/none) and is discarded wholesale. ' +
        'Nothing outside it was written, so there is nothing to undo.',
      deletes_anything: false,
      note: 'Discarding a scratch target is not backup deletion'
    };
  } else if (authorised.operation === 'backup_verify') {
    steps = [
      { step_id: 'vfy-001', sequence: 1, kind: 'verify_remote',
        description: 'offhost-backup.verifyRemote — completion marker then per-object checksum',
        performs_external_mutation: false }
    ];
    verification = { kind: 'BACKUP_INTEGRITY', method: 'offhost-backup.verifyRemote', note: 'read-only' };
    rollback = { kind: 'none', description: 'verification mutates nothing', deletes_anything: false };
  } else {
    steps = [
      { step_id: 'ret-001', sequence: 1, kind: 'retention_report',
        description: 'offhost-backup.retention — report only, deletes nothing',
        performs_external_mutation: false }
    ];
    verification = { kind: 'RETENTION_REPORT', method: 'offhost-backup.retention', note: 'report-only; deleted is always 0' };
    rollback = { kind: 'none', description: 'a report mutates nothing', deletes_anything: false };
  }

  var plan = {
    operation: authorised.operation,
    automation_level: authorised.level,
    authorises_execution: false,
    self_authorising: false,
    prohibited_operations: PROHIBITED_OPERATIONS.slice(),
    reuses_module: 'projects/idauto/ops/offhost-backup.js',
    creates_parallel_mechanism: false,
    steps: steps,
    verification: verification,
    rollback: rollback
  };
  assertNoSecrets(plan);
  return plan;
}

// -----------------------------------------------------------------------
// GATE_CHECK — a plan may never claim to authorise its own execution, and
// every step's level must be consistent with the ratified table.
// -----------------------------------------------------------------------
function gateCheck(plan) {
  if (!plan || typeof plan !== 'object') throw refuse('PLAN_REQUIRED');
  if (plan.authorises_execution !== false) throw refuse('PLAN_CLAIMS_SELF_AUTHORISATION');
  if (plan.creates_parallel_mechanism !== false) throw refuse('PARALLEL_MECHANISM_REFUSED');
  if (plan.reuses_module !== 'projects/idauto/ops/offhost-backup.js') {
    throw refuse('REUSE_CONTRACT_VIOLATED', 'O-BACKUP-1 requires the existing tooling, not a replacement');
  }
  if (OPERATION_LEVELS[plan.operation] !== plan.automation_level) {
    throw refuse('PLAN_LEVEL_INCONSISTENT',
      plan.operation + ' is ' + OPERATION_LEVELS[plan.operation] + ', plan claims ' + plan.automation_level);
  }
  (plan.steps || []).forEach(function (s) {
    if (['stage_local', 'verify_local', 'push_offhost', 'prove_isolation', 'verify_remote',
      'restore_into_isolated_target', 'retention_report'].indexOf(s.kind) === -1) {
      throw refuse('UNRECOGNISED_STEP_KIND', String(s.kind));
    }
    if (typeof s.performs_external_mutation !== 'boolean') {
      throw refuse('STEP_MUTATION_FLAG_REQUIRED', String(s.step_id));
    }
  });
  if (plan.rollback && plan.rollback.deletes_anything !== false) {
    throw refuse('ROLLBACK_DELETES_REFUSED', 'no rollback in this stage may delete anything');
  }
  return { gate: 'GATE_CHECK', ok: true, entry_gate_open: false };
}

// -----------------------------------------------------------------------
// verifyBackupIntegrity — the BACKUP path's verification. Delegates entirely
// to the existing tooling; adds only the read-only connector gate in front.
// -----------------------------------------------------------------------
async function verifyBackupIntegrity(input) {
  input = input || {};
  var connector = assertReadOnlyConnector({
    connector: input.connector, catalogue: input.connectorCatalogue,
    featureFlags: input.featureFlags, client: input.client
  });
  if (typeof input.prefix !== 'string' || !input.prefix.trim()) throw refuse('BACKUP_PREFIX_REQUIRED');
  if (!offhost.safeRel(input.prefix.replace(/\/+$/, ''))) throw refuse('BACKUP_PREFIX_UNSAFE', input.prefix);
  var result = await offhost.verifyRemote(input.prefix, input.client);
  return {
    verification_kind: 'BACKUP_INTEGRITY',
    connector_id: connector.connector_id,
    ok: result.ok === true,
    problems: (result.problems || []).map(offhost.redact),
    object_count: result.manifest && Array.isArray(result.manifest.objects) ? result.manifest.objects.length : 0,
    mutations_performed: 0
  };
}

// -----------------------------------------------------------------------
// runIsolatedRestoreTest — the RESTORE path's verification. A deliberately
// separate function from verifyBackupIntegrity (O-BACKUP-1), with its own
// gate order: isolation is proven BEFORE the backup is even read.
// -----------------------------------------------------------------------
async function runIsolatedRestoreTest(input) {
  input = input || {};
  var target = assertIsolatedTarget(input.target);
  var connector = assertReadOnlyConnector({
    connector: input.connector, catalogue: input.connectorCatalogue,
    featureFlags: input.featureFlags, client: input.client,
    level: OPERATION_LEVELS.restore_test
  });
  if (typeof input.prefix !== 'string' || !input.prefix.trim()) throw refuse('BACKUP_PREFIX_REQUIRED');

  // A dry run stops at the same point the real path would mutate, and is
  // built through this same function so it can never describe a different
  // operation than would execute.
  if (input.dryRun === true) {
    var probe = await offhost.restoreVerify(input.prefix, target.restore_path, input.client, { dryRun: true });
    return {
      verification_kind: 'RESTORE_STRUCTURAL', mode: 'DRY_RUN', mutations_performed: 0,
      target_id: target.target_id, isolation_proof: target.isolation_proof,
      ok: probe.ok === true, problems: (probe.problems || []).map(offhost.redact)
    };
  }
  assertMutationPermitted({ operation: 'restore_test', featureFlags: input.featureFlags, policy: input.policy });
  var result = await offhost.restoreVerify(input.prefix, target.restore_path, input.client, {});
  return {
    verification_kind: 'RESTORE_STRUCTURAL', mode: 'APPLY',
    target_id: target.target_id, isolation_proof: target.isolation_proof,
    ok: result.ok === true, refused: result.refused === true,
    problems: (result.problems || []).map(offhost.redact),
    verified_objects: result.verified_objects || 0
  };
}

// -----------------------------------------------------------------------
// planRetention — O-BACKUP-1: "retention management only if explicitly
// covered by the approved policy". Report-only, and the underlying tool's
// `deleted: 0` invariant is asserted rather than trusted.
// -----------------------------------------------------------------------
function planRetention(input) {
  input = input || {};
  var policy = input.policy || {};
  if (policy.covers_retention !== true) {
    throw refuse('RETENTION_NOT_COVERED_BY_POLICY',
      'retention management is authorised only when the approved policy explicitly covers it (O-BACKUP-1)');
  }
  if (!Array.isArray(input.sets)) throw refuse('BACKUP_SETS_REQUIRED');
  // The retention function is injectable so this invariant is provable. It
  // defaults to the existing tooling (which is report-only by construction),
  // but the check below must not be a dead assertion that no test can reach:
  // it exists to catch the underlying tool ever gaining a deletion path.
  var retentionFn = typeof input.retentionFn === 'function' ? input.retentionFn : offhost.retention;
  var report = retentionFn(input.sets);
  if (!report || typeof report !== 'object') throw refuse('RETENTION_REPORT_INVALID');
  if (!Array.isArray(report.keep) || !Array.isArray(report.drop)) throw refuse('RETENTION_REPORT_INVALID');
  if (report.deleted !== 0) {
    throw refuse('RETENTION_DELETED_NONZERO',
      'the retention report claims ' + report.deleted + ' deletion(s); this stage holds no delete capability');
  }
  return {
    verification_kind: 'RETENTION_REPORT',
    policy: report.policy,
    keep_count: report.keep.length,
    drop_count: report.drop.length,
    deleted: 0,
    decision: 'REPORT_ONLY — dropping a set requires a separate LEVEL_3 authorisation this stage does not hold',
    mutations_performed: 0
  };
}

// -----------------------------------------------------------------------
// buildEvidenceRecord — the O-BACKUP-4 state model, in documentation form.
// Every field the decision enumerates, and nothing credential-shaped.
// -----------------------------------------------------------------------
function buildEvidenceRecord(input) {
  input = input || {};
  if (typeof input.runId !== 'string' || !input.runId.trim()) throw refuse('RUN_ID_REQUIRED');
  // Refuse a credential-bearing INPUT rather than silently dropping it. The
  // record below is built from named fields and would be safe either way, but
  // a caller handing this module a secret is a misuse that must surface, not
  // be quietly absorbed — the same stance assertNoDatabaseWrite takes.
  assertNoSecrets(input, 'evidence_input');
  var record = {
    schema: 'inf-backup-auto-0-evidence/1.0.0',
    storage: 'DOCUMENTATION_ONLY',
    persisted_to_database: false,
    run_id: input.runId,
    backup_reference: input.backupReference || null,
    source_scope: Array.isArray(input.sourceScope) ? input.sourceScope.slice() : [],
    creation_result: input.creationResult || 'NOT_ATTEMPTED',
    verification_result: input.verificationResult || 'NOT_ATTEMPTED',
    restore_test_result: input.restoreTestResult || 'NOT_ATTEMPTED',
    isolated_target_id: input.isolatedTargetId || null,
    timestamps: {
      started_at_utc: input.startedAt || null,
      completed_at_utc: input.completedAt || null
    },
    retention_decision: input.retentionDecision || 'NOT_APPLICABLE',
    failure_state: input.failureState || 'NONE',
    rollback_cleanup_result: input.rollbackResult || 'NOT_REQUIRED',
    mutations_performed: 0,
    evidence_id: 'evd-' + sha16([input.runId, input.backupReference || '', input.isolatedTargetId || ''])
  };
  // Belt and braces: redact any string that slipped through, then refuse any
  // secret-shaped key outright.
  Object.keys(record).forEach(function (k) {
    if (typeof record[k] === 'string') record[k] = offhost.redact(record[k]);
  });
  assertNoSecrets(record, 'evidence');
  return record;
}

// -----------------------------------------------------------------------
// preflight(request) — every gate, in order, with NO side effect.
// -----------------------------------------------------------------------
function preflight(request) {
  request = request || {};
  if (typeof request !== 'object' || Array.isArray(request)) throw refuse('REQUEST_REQUIRED');
  if (typeof request.runId !== 'string' || !request.runId.trim()) throw refuse('RUN_ID_REQUIRED');

  if (request.command !== undefined || request.script !== undefined || request.shell !== undefined) {
    throw refuse('ARBITRARY_COMMAND_REFUSED', 'this stage calls declared functions, it never runs a command');
  }
  if (request.env !== undefined || request.environmentVariables !== undefined) {
    throw refuse('ENVIRONMENT_SMUGGLING_REFUSED', 'this stage never injects environment variables');
  }
  if (request.destructive !== undefined || request.force !== undefined) {
    throw refuse('DESTRUCTIVE_FLAG_REFUSED', 'no destructive or force path exists in this stage');
  }

  var authorised = assertOperationAuthorised(request);
  assertNoDatabaseWrite(request);
  var plan = buildBackupPlan(request);
  gateCheck(plan);
  var policy = assertPolicy({ policy: request.policy, operation: authorised.operation, level: authorised.level });
  var connector = assertReadOnlyConnector({
    connector: request.connector, catalogue: request.connectorCatalogue,
    featureFlags: request.featureFlags, client: request.client, level: authorised.level
  });
  var target = authorised.operation === 'restore_test' ? assertIsolatedTarget(request.target) : null;

  var envelope = {
    run_id: request.runId,
    operation: authorised.operation,
    automation_level: authorised.level,
    connector_id: connector.connector_id,
    secret_reference_id: request.connector.secret_reference_id,
    policy_key: policy.policy_key,
    isolated_target_id: target ? target.target_id : null,
    isolation_proof: target ? target.isolation_proof : null,
    reuses_module: plan.reuses_module,
    performs_external_mutation: plan.steps.some(function (s) { return s.performs_external_mutation; }),
    idempotency_key: 'idem-' + sha16([request.runId, authorised.operation, request.prefix || '']),
    resource_lock_key: 'lock-' + sha16(['offhost_backup', authorised.operation]),
    audit_event_id: 'audit-' + sha16([request.runId, authorised.operation])
  };
  assertNoSecrets(envelope);
  return { plan: plan, envelope: envelope, policy: policy, connector: connector, target: target };
}

function dryRun(request) {
  return new Promise(function (resolve, reject) {
    var prepared;
    try { prepared = preflight(request); } catch (e) { return reject(e); }
    resolve({
      mode: 'DRY_RUN', mutations_performed: 0, backups_created: 0, restores_performed: 0,
      lifecycle_completed: ['DISCOVER', 'SNAPSHOT', 'ANALYSE', 'PLAN', 'DRY_RUN', 'GATE_CHECK'],
      terminated_before: 'APPLY',
      plan: prepared.plan, envelope: prepared.envelope, target: prepared.target
    });
  });
}

/**
 * executeBackupOperation — the guarded execution path. Every gate in
 * `preflight` runs first; a mutating operation then meets the fail-closed
 * LEVEL_2 ambiguity guard, and a read-only operation proceeds through the
 * existing tooling.
 */
async function executeBackupOperation(request) {
  var prepared = preflight(request);
  var op = prepared.plan.operation;

  if (op === 'backup_verify') {
    return {
      mode: 'APPLY', operation: op, mutations_performed: 0,
      result: await verifyBackupIntegrity(request), envelope: prepared.envelope
    };
  }
  if (op === 'retention_report') {
    return {
      mode: 'APPLY', operation: op, mutations_performed: 0,
      result: planRetention({ policy: request.policy, sets: request.sets }), envelope: prepared.envelope
    };
  }
  if (op === 'restore_test') {
    return {
      mode: 'APPLY', operation: op,
      result: await runIsolatedRestoreTest(request), envelope: prepared.envelope
    };
  }
  // backup_create — the one operation that writes off-host, LEVEL_4 per
  // O-BACKUP-5, wired 2026-08-16 once that decision existed. DELEGATION
  // ONLY (O-BACKUP-1): staging, local verification, upload and remote
  // verification are all the existing offhost tooling's — this arm adds the
  // mutation gate, the write-adapter boundary and path sanity, nothing else.
  assertMutationPermitted({ operation: op, featureFlags: request.featureFlags, policy: request.policy });
  assertBackupWriteAdapter(request.backupAdapter);
  var adapter = request.backupAdapter;
  if (typeof request.prefix !== 'string' || !request.prefix.trim()) throw refuse('BACKUP_PREFIX_REQUIRED');
  if (!offhost.safeRel(request.prefix.replace(/\/+$/, ''))) throw refuse('BACKUP_PREFIX_UNSAFE', request.prefix);

  var stageDir, local;
  if (request.stageOptions !== undefined) {
    // Stage fresh through offhost.stage (plan step bkp-001). The destination
    // is a local write and is path-guarded; offhost.stage itself refuses an
    // existing destination and builds manifest + checksums.
    var so = request.stageOptions || {};
    stageDir = assertLocalStagePath(so.dest, 'stageOptions.dest');
    local = offhost.stage({
      dbDir: so.dbDir, mediaDir: so.mediaDir, dest: stageDir,
      databaseCapturedAt: so.databaseCapturedAt, mediaCapturedAt: so.mediaCapturedAt,
      host: so.host
    });
  } else {
    // Consume a directory the operator already staged with the same tooling.
    stageDir = assertLocalStagePath(request.stageDir, 'stageDir');
    local = offhost.verifyLocal(stageDir);
  }
  if (!local || local.ok !== true) {
    return {
      mode: 'APPLY', operation: op, ok: false, phase: 'verify_local',
      problems: ((local && local.problems) || ['stage unavailable']).map(offhost.redact),
      mutations_performed: 0, envelope: prepared.envelope
    };
  }

  var pushed = await offhost.push(stageDir, adapter, { prefix: request.prefix });
  if (pushed.ok !== true) {
    // A failed or partial push is reported honestly and never retried here
    // (bounded retries are the runbook's §4M decision, not this gate's), and
    // never "cleaned up" — deletion is a permanent boundary this stage lacks.
    return {
      mode: 'APPLY', operation: op, ok: false, phase: 'push_offhost',
      partial: pushed.partial === true,
      problems: (pushed.problems || []).map(offhost.redact),
      envelope: prepared.envelope
    };
  }

  var remote = await offhost.verifyRemote(request.prefix, adapter);
  return {
    mode: 'APPLY', operation: op,
    result: {
      verification_kind: 'BACKUP_INTEGRITY',
      ok: remote.ok === true,
      prefix: pushed.prefix,
      uploaded_objects: pushed.uploaded,
      object_count: remote.manifest && Array.isArray(remote.manifest.objects) ? remote.manifest.objects.length : 0,
      problems: (remote.problems || []).map(offhost.redact)
    },
    // objects + manifest.json + COMPLETE marker — reported, never estimated.
    mutations_performed: pushed.uploaded + 2,
    envelope: prepared.envelope
  };
}

module.exports = {
  OPERATION_LEVELS: OPERATION_LEVELS,
  AUTHORISED_OPERATIONS: AUTHORISED_OPERATIONS,
  PROHIBITED_OPERATIONS: PROHIBITED_OPERATIONS,
  READ_CONNECTOR_ID: READ_CONNECTOR_ID,
  PERMITTED_CAPABILITIES: PERMITTED_CAPABILITIES,
  PRODUCTION_DATA_STORES: PRODUCTION_DATA_STORES,
  FORBIDDEN_RESTORE_ROOTS: FORBIDDEN_RESTORE_ROOTS,
  LEVEL_2_MAY_MUTATE_EXTERNALLY: LEVEL_2_MAY_MUTATE_EXTERNALLY,
  PERMITTED_WRITE_ADAPTER_METHODS: PERMITTED_WRITE_ADAPTER_METHODS,
  assertBackupWriteAdapter: assertBackupWriteAdapter,
  assertLocalStagePath: assertLocalStagePath,
  looksProduction: looksProduction,
  assertNoSecrets: assertNoSecrets,
  assertOperationAuthorised: assertOperationAuthorised,
  assertNoDatabaseWrite: assertNoDatabaseWrite,
  assertIsolatedTarget: assertIsolatedTarget,
  assertReadOnlyConnector: assertReadOnlyConnector,
  assertPolicy: assertPolicy,
  assertMutationPermitted: assertMutationPermitted,
  buildBackupPlan: buildBackupPlan,
  gateCheck: gateCheck,
  verifyBackupIntegrity: verifyBackupIntegrity,
  runIsolatedRestoreTest: runIsolatedRestoreTest,
  planRetention: planRetention,
  buildEvidenceRecord: buildEvidenceRecord,
  preflight: preflight,
  dryRun: dryRun,
  executeBackupOperation: executeBackupOperation
};
