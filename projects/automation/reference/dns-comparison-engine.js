'use strict';
// =====================================================
// Mythos Automation & Operations — DNS Comparison, Safety Analysis and
// Plan Generation (INF-DNS-AUTO-1)
// projects/automation/reference/dns-comparison-engine.js
//
// Illustrative, in-memory reference implementation — same posture as
// projects/automation/reference/ovh-readonly-connector.js (INF-OVH-API-0)
// and cloudflare-readonly-connector.js (INF-CF-AUTO-0): no live credential,
// no network call, no deployment, no database write.
//
// Scope (docs/AUTOMATION_ROADMAP.md §"INF-DNS-AUTO-1"),
// LEVEL_1_READ_ONLY / LEVEL_2_RECOMMEND only:
//   - OVH vs public DNS vs Cloudflare comparison
//   - email safety analysis
//   - DNSSEC safety analysis
//   - migration and rollback plan generation
//
// "This is where the record-by-record comparison required by
//  docs/CLOUDFLARE_INF_CF2_ENTRY_CRITERIA.md criterion 8 becomes automatable
//  — THE COMPARISON ITSELF, NOT THE RESULTING MIGRATION."
//
// WHAT THIS MODULE MAY NEVER DO (structural, asserted by
// tests/inf-dns-auto-1-comparison-test.js):
//   - mutate anything anywhere (LEVEL_1/LEVEL_2 forbid external mutation)
//   - perform, schedule, approve or pre-authorise a migration
//   - report the INF-CF-2 entry gate as open (criteria requiring owner
//     action are permanently REQUIRES_OWNER_ACTION here)
//   - emit a plan step below LEVEL_3_APPROVAL_REQUIRED, or one that claims a
//     nameserver / DNSSEC-DS / record-deletion action is anything less than a
//     permanent approval boundary (docs/AUTOMATION_APPROVAL_MATRIX.md §2
//     items 1-3; "a GATE_CHECK step must reject a mismatch" — §4)
//   - emit a rollback step of a kind the deployment checklist prohibits
//     (TLS downgrade, unproxying an administrative hostname, Access removal,
//     unconditional port reopening — docs/CLOUDFLARE_DEPLOYMENT_CHECKLIST.md
//     INF-CF-5/INF-CF-6 rollback rules)
//   - read a credential, an environment variable, the filesystem or the
//     network — every input is passed in by the caller
//
// Introducing this stage does not unblock INF-CF-2 and does not satisfy any
// entry criterion that requires owner action, authoritative-provider
// evidence, or an origin-side fix.
// =====================================================

var sharedHelpers = require('./connector-readonly-helpers.js');

var AUTOMATION_LEVEL = 'LEVEL_3_APPROVAL_REQUIRED';
var SOURCES = ['ovh', 'public_dns', 'cloudflare'];
var SEVERITY = ['INFO', 'WARNING', 'HIGH', 'CRITICAL'];

// NS/SOA are deliberately NOT comparable across providers: the migration
// matrix already records NS with migration_action UNKNOWN because "recreation
// approach depends on the chosen Cloudflare onboarding method", and a
// Cloudflare zone legitimately carries different nameservers than OVH. Raising
// a discrepancy there would be a fabricated alarm, not a finding.
var NOT_COMPARABLE_TYPES = ['NS', 'SOA'];

// Mail-bearing record shapes. A record of one of these kinds must stay
// grey-cloud: the migration matrix's DNS_ONLY legend covers "mail, SPF/
// verification TXT records, and any non-HTTP record".
var MAIL_TYPES = ['MX'];

// docs/AUTOMATION_APPROVAL_MATRIX.md §2 — permanent LEVEL_3 boundaries
// reachable from a DNS migration plan (items 1, 2, 3).
var PERMANENT_BOUNDARY_STEP_KINDS = ['nameserver_change', 'dnssec_ds_change', 'record_delete'];
var PLAN_STEP_KINDS = PERMANENT_BOUNDARY_STEP_KINDS.concat(['record_recreate', 'proxy_mode_set']);

// Rollback shapes the deployment checklist explicitly forbids. These are
// refused at generation time so an unsafe rollback cannot even be proposed.
var PROHIBITED_ROLLBACK_KINDS = ['tls_downgrade', 'unproxy_administrative_hostname',
  'access_removal', 'port_reopen'];

// INF-CF-2 entry criteria this engine can never evaluate: each requires owner
// action, authoritative-provider evidence, or an origin-side fix
// (docs/CLOUDFLARE_INF_CF2_ENTRY_CRITERIA.md §"What This Document Does Not Do").
var OWNER_ACTION_CRITERIA = [1, 2, 4, 5, 6, 7, 10, 11, 12, 13, 14, 15];

function fail(message) {
  var e = new Error('DNS_COMPARISON_ENGINE: ' + message);
  e.refused = true;
  return e;
}

// -----------------------------------------------------------------------
// Normalisation. Comparison must not report a discrepancy caused purely by
// a trailing dot, letter case, or whitespace — those are formatting, not
// drift. Everything else is preserved verbatim.
// -----------------------------------------------------------------------
function normalizeName(name) {
  if (typeof name !== 'string') return '';
  return name.trim().toLowerCase().replace(/\.$/, '');
}

function normalizeValue(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim().toLowerCase().replace(/\s+/g, ' ').replace(/\.$/, '');
}

function normalizeRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw fail('a record must be an object');
  if (typeof record.name !== 'string' || !record.name.trim()) throw fail('record.name is required');
  if (typeof record.type !== 'string' || !record.type.trim()) throw fail('record.type is required');
  var name = normalizeName(record.name);
  var type = record.type.trim().toUpperCase();
  return {
    key: name + '|' + type,
    name: name,
    type: type,
    value: normalizeValue(record.value),
    absent: record.absent === true,
    proposedCloudflareMode: record.proposedCloudflareMode || null,
    migrationAction: record.migrationAction || null,
    requiresConfirmation: record.requiresConfirmation === true,
    observedAt: record.observedAt || null
  };
}

function indexRecords(records) {
  var byKey = {};
  (records || []).forEach(function (r) {
    var n = normalizeRecord(r);
    if (n.absent) return; // an explicitly-absent observation is not a value
    if (!byKey[n.key]) byKey[n.key] = { key: n.key, name: n.name, type: n.type, values: [], records: [] };
    byKey[n.key].values.push(n.value);
    byKey[n.key].records.push(n);
  });
  Object.keys(byKey).forEach(function (k) { byKey[k].values.sort(); });
  return byKey;
}

// -----------------------------------------------------------------------
// compareRecordSets({ ovh, public_dns, cloudflare }) -> comparison result
//
// A source that was not supplied at all is reported as SOURCE_ABSENT and is
// excluded from every per-record verdict — an unbuilt Cloudflare zone must
// never read as "every record is missing".
// -----------------------------------------------------------------------
function compareRecordSets(sets) {
  if (!sets || typeof sets !== 'object' || Array.isArray(sets)) throw fail('compareRecordSets requires a source map');
  var supplied = [], absent = [], indexed = {};
  SOURCES.forEach(function (s) {
    if (Array.isArray(sets[s])) { supplied.push(s); indexed[s] = indexRecords(sets[s]); }
    else absent.push(s);
  });
  if (supplied.length === 0) throw fail('compareRecordSets requires at least one source record array');

  var keys = {};
  supplied.forEach(function (s) { Object.keys(indexed[s]).forEach(function (k) { keys[k] = true; }); });

  var findings = Object.keys(keys).sort().map(function (key) {
    var present = supplied.filter(function (s) { return indexed[s][key]; });
    var missingIn = supplied.filter(function (s) { return !indexed[s][key]; });
    var sample = indexed[present[0]][key];
    var perSource = {};
    present.forEach(function (s) { perSource[s] = indexed[s][key].values.slice(); });

    if (NOT_COMPARABLE_TYPES.indexOf(sample.type) !== -1) {
      return { key: key, name: sample.name, type: sample.type, verdict: 'NOT_COMPARABLE',
        severity: 'INFO', presentIn: present, missingIn: [], values: perSource,
        reason: 'provider-assigned zone metadata; cross-provider difference is expected, not drift' };
    }
    if (missingIn.length && present.length) {
      return { key: key, name: sample.name, type: sample.type, verdict: 'MISSING_IN_SOURCE',
        severity: MAIL_TYPES.indexOf(sample.type) !== -1 ? 'CRITICAL' : 'HIGH',
        presentIn: present, missingIn: missingIn, values: perSource,
        reason: 'record observed in ' + present.join('+') + ' but absent from ' + missingIn.join('+') };
    }
    var first = JSON.stringify(perSource[present[0]]);
    var diverged = present.some(function (s) { return JSON.stringify(perSource[s]) !== first; });
    if (diverged) {
      return { key: key, name: sample.name, type: sample.type, verdict: 'VALUE_MISMATCH',
        severity: MAIL_TYPES.indexOf(sample.type) !== -1 ? 'CRITICAL' : 'HIGH',
        presentIn: present, missingIn: [], values: perSource,
        reason: 'the same record resolves to different values across sources' };
    }
    return { key: key, name: sample.name, type: sample.type, verdict: 'MATCH',
      severity: 'INFO', presentIn: present, missingIn: [], values: perSource, reason: null };
  });

  var discrepancies = findings.filter(function (f) {
    return f.verdict === 'MISSING_IN_SOURCE' || f.verdict === 'VALUE_MISMATCH';
  });
  return {
    sourcesCompared: supplied,
    sourcesAbsent: absent,
    comparable: supplied.length >= 2,
    findings: findings,
    discrepancies: discrepancies,
    counts: {
      total: findings.length,
      match: findings.filter(function (f) { return f.verdict === 'MATCH'; }).length,
      notComparable: findings.filter(function (f) { return f.verdict === 'NOT_COMPARABLE'; }).length,
      discrepancies: discrepancies.length
    }
  };
}

// -----------------------------------------------------------------------
// analyseEmailSafety(records, opts) — MX / SPF / DKIM / DMARC state.
//
// Criterion 3 requires resolving every UNKNOWN/absent email finding, so an
// unverifiable DKIM is reported as unverified rather than quietly passed.
// -----------------------------------------------------------------------
function analyseEmailSafety(records, opts) {
  opts = opts || {};
  if (!Array.isArray(records)) throw fail('analyseEmailSafety requires a record array');
  var normalized = records.map(normalizeRecord);
  var findings = [];
  function add(code, severity, detail) { findings.push({ code: code, severity: severity, detail: detail }); }

  var mx = normalized.filter(function (r) { return r.type === 'MX' && !r.absent; });
  if (!mx.length) add('MX_ABSENT', 'CRITICAL', 'no MX record observed — inbound mail would not survive a migration that recreates only what is observed');
  else add('MX_PRESENT', 'INFO', mx.length + ' MX record(s) observed');

  var txt = normalized.filter(function (r) { return r.type === 'TXT' && !r.absent; });
  var spf = txt.filter(function (r) { return r.value.indexOf('v=spf1') === 0; });
  if (!spf.length) add('SPF_ABSENT', 'HIGH', 'no SPF record observed');
  else if (spf.length > 1) add('SPF_MULTIPLE', 'HIGH', spf.length + ' SPF records observed — more than one is invalid and breaks evaluation');
  else if (/~all\s*$/.test(spf[0].value)) add('SPF_SOFTFAIL', 'WARNING', 'SPF ends in ~all (softfail)');
  else if (/-all\s*$/.test(spf[0].value)) add('SPF_HARDFAIL', 'INFO', 'SPF ends in -all (hardfail)');
  else add('SPF_NO_TERMINAL_QUALIFIER', 'WARNING', 'SPF has no explicit -all/~all terminal qualifier');

  var dmarc = normalized.filter(function (r) { return r.name.indexOf('_dmarc.') === 0 && r.type === 'TXT' && !r.absent; });
  if (!dmarc.length) add('DMARC_ABSENT', 'WARNING', 'no DMARC policy published — recommended independently of migration');
  else if (/p=none/.test(dmarc[0].value)) add('DMARC_MONITOR_ONLY', 'WARNING', 'DMARC policy is p=none (monitoring only)');
  else add('DMARC_PRESENT', 'INFO', 'DMARC policy published');

  var selectors = Array.isArray(opts.dkimSelectors) ? opts.dkimSelectors : [];
  var dkim = normalized.filter(function (r) { return /\._domainkey\./.test(r.name) && !r.absent; });
  if (!selectors.length && !dkim.length) {
    add('DKIM_UNVERIFIED', 'WARNING', 'no DKIM selector supplied and none observed — state is UNKNOWN, not "absent"');
  } else if (selectors.length && !dkim.length) {
    add('DKIM_SELECTOR_MISSING', 'HIGH', 'selector(s) declared but no matching _domainkey record observed: ' + selectors.join(', '));
  } else {
    add('DKIM_PRESENT', 'INFO', dkim.length + ' DKIM record(s) observed');
  }

  // A mail-bearing record proposed for the orange cloud is a migration-safety
  // defect, not a preference: proxying breaks mail delivery outright.
  normalized.forEach(function (r) {
    var isMail = MAIL_TYPES.indexOf(r.type) !== -1 ||
      (r.type === 'TXT' && (r.value.indexOf('v=spf1') === 0 || r.name.indexOf('_dmarc.') === 0 || /\._domainkey\./.test(r.name)));
    if (isMail && r.proposedCloudflareMode === 'PROXIED') {
      add('MAIL_RECORD_PROXY_UNSAFE', 'CRITICAL', r.name + ' ' + r.type + ' is classified PROXIED but must remain DNS_ONLY');
    }
  });

  return { findings: findings, highestSeverity: highestSeverity(findings), safeToMigrate: !findings.some(function (f) { return f.severity === 'CRITICAL'; }) };
}

// -----------------------------------------------------------------------
// analyseDnssecSafety({ dnssecStatus, dsRecords, nameserverChangePlanned })
//
// Criterion 5 (state verified) and criterion 6 (DS sequencing reviewed for
// any DNSSEC-enabled domain) are the two things this can speak to.
// -----------------------------------------------------------------------
function analyseDnssecSafety(input) {
  input = input || {};
  var status = typeof input.dnssecStatus === 'string' ? input.dnssecStatus.trim().toUpperCase() : 'UNKNOWN';
  var findings = [];
  function add(code, severity, detail) { findings.push({ code: code, severity: severity, detail: detail }); }
  var dsSequencingRequired = false;

  if (status === 'ENABLED') {
    dsSequencingRequired = true;
    add('DNSSEC_ENABLED', 'HIGH', 'DNSSEC is enabled — criterion 6 DS sequencing applies before any nameserver cutover');
    if (input.nameserverChangePlanned === true) {
      add('DS_SEQUENCING_REQUIRED', 'HIGH', 'DS records must be removed at the registrar and the previous TTL allowed to elapse BEFORE nameservers change; DNSSEC is re-enabled and a new DS published only after the new provider serves the zone');
    }
    if (Array.isArray(input.dsRecords) && input.dsRecords.length === 0) {
      add('DS_ABSENT_WHILE_ENABLED', 'HIGH', 'DNSSEC reported enabled but no DS record was observed — state is inconsistent and must be resolved before migration');
    }
  } else if (status === 'DISABLED') {
    add('DNSSEC_DISABLED', 'INFO', 'DNSSEC is disabled — no DS sequencing applies');
  } else {
    add('DNSSEC_STATE_UNKNOWN', 'HIGH', 'DNSSEC state is UNKNOWN — criterion 5 cannot pass on an unknown state');
  }

  return {
    status: status,
    dsSequencingRequired: dsSequencingRequired,
    findings: findings,
    highestSeverity: highestSeverity(findings),
    safeToMigrate: !findings.some(function (f) { return f.severity === 'CRITICAL'; })
  };
}

function highestSeverity(findings) {
  var worst = 'INFO';
  (findings || []).forEach(function (f) {
    if (SEVERITY.indexOf(f.severity) > SEVERITY.indexOf(worst)) worst = f.severity;
  });
  return worst;
}

// -----------------------------------------------------------------------
// generateMigrationPlan(...) — LEVEL_2_RECOMMEND output.
//
// A PROPOSAL, never an authorisation. Every step declares the automation
// level its EXECUTION would require, which for a DNS migration is never
// below LEVEL_3_APPROVAL_REQUIRED: nameserver, DNSSEC-DS and record-deletion
// actions are permanent boundaries (approval matrix §2 items 1-3), and every
// remaining step is gated by INF-CF-2 criteria 9 and 11 (owner-approved
// classification, recorded migration approval).
// -----------------------------------------------------------------------
function planStep(seq, kind, description, target, blockedBy) {
  if (PLAN_STEP_KINDS.indexOf(kind) === -1) throw fail('unknown plan step kind: ' + kind);
  var permanent = PERMANENT_BOUNDARY_STEP_KINDS.indexOf(kind) !== -1;
  return {
    step_id: 'step-' + String(seq).padStart(3, '0'),
    sequence: seq,
    kind: kind,
    description: description,
    target: target,
    automation_level: AUTOMATION_LEVEL,
    requires_approval: true,
    is_permanent_boundary: permanent,
    allow_self_approval: false,
    blocked_by: blockedBy || [],
    status: (blockedBy && blockedBy.length) ? 'BLOCKED' : 'PROPOSED'
  };
}

function generateMigrationPlan(input) {
  input = input || {};
  var domain = input.domain;
  if (typeof domain !== 'string' || !domain.trim()) throw fail('generateMigrationPlan requires a domain');
  var records = (input.records || []).map(normalizeRecord);
  var dnssec = input.dnssec || { dsSequencingRequired: false };
  var nameserverChangePlanned = input.nameserverChangePlanned === true;
  var steps = [];
  var seq = 0;

  // 1. DS removal FIRST when DNSSEC is enabled and nameservers will change
  //    (docs/CLOUDFLARE_DEPLOYMENT_CHECKLIST.md INF-CF-5/INF-CF-6: remove DS
  //    at the registrar before the authoritative provider changes).
  if (dnssec.dsSequencingRequired && nameserverChangePlanned) {
    steps.push(planStep(++seq, 'dnssec_ds_change',
      'Remove DS record(s) at the registrar and allow the previous TTL to elapse before any nameserver change',
      domain, ['INF_CF2_CRITERION_6']));
  }

  // 2. Record recreation / proxy classification, deterministic by record key.
  records.filter(function (r) { return !r.absent && NOT_COMPARABLE_TYPES.indexOf(r.type) === -1; })
    .sort(function (a, b) { return a.key.localeCompare(b.key); })
    .forEach(function (r) {
      var blocked = [];
      if (r.requiresConfirmation) blocked.push('INF_CF2_CRITERION_9');
      if (r.proposedCloudflareMode === 'NEEDS_CONFIRMATION') blocked.push('INF_CF2_CRITERION_9');
      if (r.migrationAction === 'REVIEW_BEFORE_RECREATE') blocked.push('REVIEW_BEFORE_RECREATE');
      steps.push(planStep(++seq, 'record_recreate',
        'Recreate ' + r.name + ' ' + r.type + ' in the target zone with the observed value',
        r.name + '|' + r.type, dedupe(blocked)));
      if (r.proposedCloudflareMode === 'PROXIED' || r.proposedCloudflareMode === 'DNS_ONLY') {
        steps.push(planStep(++seq, 'proxy_mode_set',
          'Set ' + r.name + ' ' + r.type + ' to ' + r.proposedCloudflareMode,
          r.name + '|' + r.type, r.proposedCloudflareMode === 'PROXIED' ? ['INF_CF2_CRITERION_13'] : []));
      }
    });

  // 3. Nameserver cutover — the permanent boundary the whole plan exists for.
  if (nameserverChangePlanned) {
    steps.push(planStep(++seq, 'nameserver_change',
      'Change authoritative nameservers at the registrar',
      domain, ['INF_CF2_CRITERION_11', 'INF_CF2_CRITERION_12']));
    if (dnssec.dsSequencingRequired) {
      steps.push(planStep(++seq, 'dnssec_ds_change',
        'Re-enable DNSSEC at the new provider and publish the new DS record only after the new provider serves the zone correctly',
        domain, ['INF_CF2_CRITERION_6']));
    }
  }

  var blockedCount = steps.filter(function (s) { return s.status === 'BLOCKED'; }).length;
  var summary = 'INF-DNS-AUTO-1 proposal for ' + domain + ': ' + steps.length + ' step(s), ' +
    blockedCount + ' blocked on INF-CF-2 entry criteria; execution is LEVEL_3 only and is NOT authorised by this plan.';
  return {
    domain: domain,
    automation_level: AUTOMATION_LEVEL,
    authorises_execution: false,
    steps: steps,
    blocked_step_count: blockedCount,
    simulated_impact_summary: summary.slice(0, 512)
  };
}

function dedupe(list) {
  var seen = {}, out = [];
  list.forEach(function (v) { if (!seen[v]) { seen[v] = true; out.push(v); } });
  return out;
}

// -----------------------------------------------------------------------
// generateRollbackPlan(plan, opts) — the inverse proposal.
//
// Every rollback step restores a value observed BEFORE migration; a rollback
// that cannot name what it restores to is not generated. Never automatic:
// the inverse of a permanent-boundary action is itself one.
// -----------------------------------------------------------------------
function generateRollbackPlan(plan, opts) {
  opts = opts || {};
  if (!plan || !Array.isArray(plan.steps)) throw fail('generateRollbackPlan requires a migration plan');
  var priorState = opts.priorState || {};
  var steps = plan.steps.slice().reverse().map(function (s, i) {
    var restoreTo = null;
    if (s.kind === 'nameserver_change') restoreTo = priorState.nameservers || null;
    else if (s.kind === 'dnssec_ds_change') restoreTo = priorState.dnssecStatus || null;
    else restoreTo = (priorState.records && priorState.records[s.target]) || null;
    return {
      step_id: 'rollback-' + String(i + 1).padStart(3, '0'),
      sequence: i + 1,
      inverse_of: s.step_id,
      kind: s.kind,
      description: 'Restore the pre-migration state of ' + s.target,
      target: s.target,
      restore_to: restoreTo,
      restorable: restoreTo !== null,
      automation_level: AUTOMATION_LEVEL,
      requires_approval: true,
      is_permanent_boundary: s.is_permanent_boundary,
      allow_self_approval: false
    };
  });
  assertRollbackSafe(steps);
  var unrestorable = steps.filter(function (s) { return !s.restorable; });
  return {
    domain: plan.domain,
    automation_level: AUTOMATION_LEVEL,
    is_automatic_eligible: false,
    steps: steps,
    unrestorable_step_count: unrestorable.length,
    rollback_policy_key: 'cloudflare_migration_manual_only'
  };
}

/**
 * Refuses any rollback step of a kind the deployment checklist prohibits —
 * a rollback must never "work around" a broken origin by weakening posture.
 */
function assertRollbackSafe(steps) {
  var offending = (steps || []).filter(function (s) {
    return PROHIBITED_ROLLBACK_KINDS.indexOf(s.kind) !== -1;
  });
  if (offending.length) {
    throw fail('prohibited rollback step kind(s): ' + offending.map(function (s) { return s.kind; }).join(', ') +
      ' — restricted, time-bounded, individually reversible steps only');
  }
  return true;
}

// -----------------------------------------------------------------------
// gateCheck(plan) — the GATE_CHECK lifecycle step
// (docs/AUTOMATION_ARCHITECTURE.md §3; approval matrix §4: "No workflow
// definition may claim an automation level inconsistent with this matrix. A
// GATE_CHECK step must reject a mismatch.")
// -----------------------------------------------------------------------
function gateCheck(plan) {
  var violations = [];
  if (!plan || !Array.isArray(plan.steps)) {
    return { ok: false, violations: [{ code: 'PLAN_MALFORMED', detail: 'a plan with a steps array is required' }] };
  }
  if (plan.authorises_execution !== false) {
    violations.push({ code: 'PLAN_CLAIMS_AUTHORISATION', detail: 'a LEVEL_2_RECOMMEND plan may never authorise its own execution' });
  }
  plan.steps.forEach(function (s) {
    if (PLAN_STEP_KINDS.indexOf(s.kind) === -1) {
      violations.push({ code: 'UNKNOWN_STEP_KIND', step_id: s.step_id, detail: String(s.kind) });
      return; // an unrecognised kind is refused outright, never level-checked
    }
    if (s.automation_level !== AUTOMATION_LEVEL) {
      violations.push({ code: 'AUTOMATION_LEVEL_MISMATCH', step_id: s.step_id,
        detail: s.kind + ' declares ' + s.automation_level + '; DNS migration steps are ' + AUTOMATION_LEVEL });
    }
    if (s.requires_approval !== true) {
      violations.push({ code: 'APPROVAL_NOT_REQUIRED', step_id: s.step_id, detail: s.kind });
    }
    if (s.allow_self_approval !== false) {
      violations.push({ code: 'SELF_APPROVAL_PERMITTED', step_id: s.step_id, detail: s.kind });
    }
    if (PERMANENT_BOUNDARY_STEP_KINDS.indexOf(s.kind) !== -1 && s.is_permanent_boundary !== true) {
      violations.push({ code: 'PERMANENT_BOUNDARY_NOT_DECLARED', step_id: s.step_id,
        detail: s.kind + ' is a permanent LEVEL_3 boundary (approval matrix §2)' });
    }
  });
  return { ok: violations.length === 0, violations: violations };
}

// -----------------------------------------------------------------------
// evaluateEntryCriteria(...) — reports on the two criteria this engine can
// actually observe (8 and 9) and permanently reports every owner-action
// criterion as REQUIRES_OWNER_ACTION. The gate can therefore never be
// computed as open by software.
// -----------------------------------------------------------------------
function evaluateEntryCriteria(input) {
  input = input || {};
  var comparison = input.comparison || {};
  var records = (input.records || []).map(normalizeRecord);
  var accepted = Array.isArray(input.acceptedDiscrepancies) ? input.acceptedDiscrepancies : [];
  var unresolved = (comparison.discrepancies || []).filter(function (d) { return accepted.indexOf(d.key) === -1; });

  var criteria = [];
  if (comparison.comparable !== true) {
    criteria.push({ criterion: 8, status: 'NOT_SATISFIED',
      detail: 'record-by-record comparison needs at least two sources; compared: ' + (comparison.sourcesCompared || []).join(',') });
  } else if (unresolved.length) {
    criteria.push({ criterion: 8, status: 'NOT_SATISFIED', detail: unresolved.length + ' unresolved discrepancy/ies' });
  } else {
    criteria.push({ criterion: 8, status: 'SATISFIED', detail: 'comparison complete across ' + comparison.sourcesCompared.join('+') + '; every discrepancy resolved or explicitly accepted' });
  }

  var needsConfirmation = records.filter(function (r) {
    return r.proposedCloudflareMode === 'NEEDS_CONFIRMATION' || r.requiresConfirmation;
  });
  criteria.push(needsConfirmation.length
    ? { criterion: 9, status: 'NOT_SATISFIED', detail: needsConfirmation.length + ' record(s) still require confirmation' }
    : { criterion: 9, status: 'SATISFIED', detail: 'no record remains NEEDS_CONFIRMATION' });

  criteria.push({ criterion: 3, status: input.email && input.email.safeToMigrate === false ? 'NOT_SATISFIED' : 'REQUIRES_OWNER_ACTION',
    detail: 'email configuration must be confirmed against the authoritative export by the owner; analysis alone cannot close it' });

  OWNER_ACTION_CRITERIA.forEach(function (n) {
    criteria.push({ criterion: n, status: 'REQUIRES_OWNER_ACTION',
      detail: 'requires owner action, authoritative-provider evidence, or an origin-side fix — not computable here' });
  });
  criteria.sort(function (a, b) { return a.criterion - b.criterion; });

  return {
    criteria: criteria,
    // Structurally always false: OWNER_ACTION_CRITERIA is non-empty, so no
    // input can make this engine report the INF-CF-2 gate as open.
    entry_gate_open: false,
    unresolved_discrepancies: unresolved.length,
    note: 'INF-DNS-AUTO-1 automates comparison and analysis only. It does not perform, schedule, or pre-authorise migration, and does not unblock INF-CF-2.'
  };
}

// -----------------------------------------------------------------------
// publicDnsRecordsFromInventory(inventoryDoc, domain)
//
// Adapter for the committed INF-CF-1 observation set
// (projects/infrastructure/cloudflare/domain-inventory.json). Takes the
// PARSED document — this module never touches the filesystem.
// -----------------------------------------------------------------------
function publicDnsRecordsFromInventory(inventoryDoc, domain) {
  if (!inventoryDoc || !Array.isArray(inventoryDoc.domains)) throw fail('an INF-CF-1 inventory document with a domains array is required');
  var entry = inventoryDoc.domains.filter(function (d) { return normalizeName(d.domain) === normalizeName(domain); })[0];
  if (!entry) throw fail('domain not present in the inventory: ' + domain);
  var records = (entry.records || []).map(function (r) {
    var summary = String(r.value_summary === undefined || r.value_summary === null ? '' : r.value_summary);
    var absent = /^\(none present\)$/i.test(summary.trim()) || /^absent\b/i.test(summary.trim());
    return {
      name: r.name,
      type: r.type,
      value: summary,
      absent: absent,
      proposedCloudflareMode: r.proposed_cloudflare_mode || null,
      migrationAction: r.migration_action || null,
      requiresConfirmation: r.requires_confirmation === true,
      observedAt: r.observed_at_utc || null
    };
  });
  return {
    domain: entry.domain,
    records: records,
    nameservers: entry.nameservers || [],
    dnssecStatus: entry.dnssec_status || 'UNKNOWN'
  };
}

// -----------------------------------------------------------------------
// runAnalysis(input, config) — top-level entry point.
//
// Mirrors both existing connectors: refuses unless explicitly enabled,
// refuses outside the authorised domain list, and refuses any injected
// client exposing a mutation-shaped method. Rejects rather than throws, so
// every failure path reaches the caller's .catch().
// -----------------------------------------------------------------------
function runAnalysis(input, config) {
  return new Promise(function (resolve, reject) {
    if (!config || config.enabled !== true) {
      return reject(fail('refusing to run — analysis is not explicitly enabled (config.enabled !== true)'));
    }
    if (!Array.isArray(config.authorised_domains) || config.authorised_domains.length === 0) {
      return reject(fail('refusing to run — no authorised_domains configured'));
    }
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return reject(fail('an analysis input object is required'));
    }
    var domain = normalizeName(input.domain);
    if (!domain) return reject(fail('an analysis input domain is required'));
    if (config.authorised_domains.map(normalizeName).indexOf(domain) === -1) {
      return reject(fail('refusing to run — ' + domain + ' is not in authorised_domains'));
    }
    // Any provider client handed in is held to the same structural read-only
    // rule as the connectors themselves.
    try {
      (input.clients ? Object.keys(input.clients) : []).forEach(function (name) {
        sharedHelpers.assertReadOnlyClient(input.clients[name], { errorPrefix: 'DNS_COMPARISON_ENGINE[' + name + ']' });
      });
    } catch (e) { return reject(e); }

    var result;
    try {
      var comparison = compareRecordSets(input.sources || {});
      // The authoritative side is preferred for safety analysis; public DNS
      // is the documented fallback the INF-CF-1 observations provide.
      var analysed = (input.sources && (input.sources.ovh || input.sources.public_dns || input.sources.cloudflare)) || [];
      var email = analyseEmailSafety(analysed, { dkimSelectors: input.dkimSelectors });
      var dnssec = analyseDnssecSafety({
        dnssecStatus: input.dnssecStatus,
        dsRecords: input.dsRecords,
        nameserverChangePlanned: input.nameserverChangePlanned === true
      });
      var plan = generateMigrationPlan({
        domain: domain,
        records: analysed,
        dnssec: dnssec,
        nameserverChangePlanned: input.nameserverChangePlanned === true
      });
      var gate = gateCheck(plan);
      if (!gate.ok) {
        return reject(fail('GATE_CHECK refused the generated plan: ' +
          gate.violations.map(function (v) { return v.code; }).join(', ')));
      }
      var rollback = generateRollbackPlan(plan, { priorState: input.priorState });
      var entry = evaluateEntryCriteria({
        comparison: comparison, records: analysed, email: email,
        acceptedDiscrepancies: input.acceptedDiscrepancies
      });
      result = {
        domain: domain,
        automation_level: AUTOMATION_LEVEL,
        lifecycle_completed: ['DISCOVER', 'SNAPSHOT', 'ANALYSE', 'PLAN', 'DRY_RUN', 'GATE_CHECK'],
        // LEVEL_1/LEVEL_2 runs terminate before APPLY — they do not skip the
        // steps before it (docs/AUTOMATION_ARCHITECTURE.md §3).
        terminated_before: 'APPROVAL',
        mutations_performed: 0,
        comparison: comparison,
        email: email,
        dnssec: dnssec,
        plan: plan,
        rollback_plan: rollback,
        gate_check: gate,
        entry_criteria: entry
      };
    } catch (e) { return reject(e); }
    resolve(result);
  });
}

/**
 * Builds an aut_execution_plans-shaped record. Like the connectors' snapshot
 * records, the plan artifact itself is referenced, never embedded.
 */
function buildExecutionPlanRecord(input) {
  var required = ['planId', 'automationVersionId', 'planReference', 'generatedAt'];
  required.forEach(function (f) {
    if (!input || input[f] === undefined || input[f] === null) throw fail('buildExecutionPlanRecord missing required field: ' + f);
  });
  return {
    plan_id: input.planId,
    run_id: input.runId || null,
    automation_version_id: input.automationVersionId,
    plan_reference: input.planReference,
    simulated_impact_summary: (input.simulatedImpactSummary || '').slice(0, 512),
    rollback_plan_reference: input.rollbackPlanReference || null,
    generated_at: input.generatedAt
  };
}

module.exports = {
  AUTOMATION_LEVEL: AUTOMATION_LEVEL,
  SOURCES: SOURCES,
  SEVERITY: SEVERITY,
  NOT_COMPARABLE_TYPES: NOT_COMPARABLE_TYPES,
  PERMANENT_BOUNDARY_STEP_KINDS: PERMANENT_BOUNDARY_STEP_KINDS,
  PLAN_STEP_KINDS: PLAN_STEP_KINDS,
  PROHIBITED_ROLLBACK_KINDS: PROHIBITED_ROLLBACK_KINDS,
  OWNER_ACTION_CRITERIA: OWNER_ACTION_CRITERIA,
  normalizeRecord: normalizeRecord,
  compareRecordSets: compareRecordSets,
  analyseEmailSafety: analyseEmailSafety,
  analyseDnssecSafety: analyseDnssecSafety,
  generateMigrationPlan: generateMigrationPlan,
  generateRollbackPlan: generateRollbackPlan,
  assertRollbackSafe: assertRollbackSafe,
  gateCheck: gateCheck,
  evaluateEntryCriteria: evaluateEntryCriteria,
  publicDnsRecordsFromInventory: publicDnsRecordsFromInventory,
  buildExecutionPlanRecord: buildExecutionPlanRecord,
  runAnalysis: runAnalysis
};
