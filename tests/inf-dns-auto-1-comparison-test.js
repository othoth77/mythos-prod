'use strict';
// =====================================================
// MYTHOS — Stage INF-DNS-AUTO-1 DNS comparison / safety / plan tests
// tests/inf-dns-auto-1-comparison-test.js
//
// Deterministic and fully offline. No live credential, no network call, no
// database, no filesystem write. The only file read is the already-committed
// INF-CF-1 observation set, so the engine is exercised against the real
// portfolio data it exists to compare — not synthetic fixtures alone.
//
// Run with: node tests/inf-dns-auto-1-comparison-test.js
// =====================================================

var fs = require('fs');
var path = require('path');
var BASE = path.join(__dirname, '..');
var pass = 0, fail = 0;
function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }
function rejects(p, re, l) {
  return p.then(
    function () { fail++; console.log('  FAIL ' + l + ' (expected refusal, but it resolved)'); },
    function (e) {
      var hit = re.test(e.message);
      if (hit) { pass++; console.log('  PASS ' + l); }
      else { fail++; console.log('  FAIL ' + l + ' [got: ' + e.message + ']'); }
    }
  );
}
function throwsWith(fn, re, l) {
  try { fn(); fail++; console.log('  FAIL ' + l + ' (expected a throw)'); }
  catch (e) { if (re.test(e.message)) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l + ' [got: ' + e.message + ']'); } }
}

var ENGINE_PATH = path.join(BASE, 'projects', 'automation', 'reference', 'dns-comparison-engine.js');
var engine = require(ENGINE_PATH);
var INVENTORY = JSON.parse(fs.readFileSync(
  path.join(BASE, 'projects', 'infrastructure', 'cloudflare', 'domain-inventory.json'), 'utf8'));

function rec(over) {
  return Object.assign({ name: 'example.invalid', type: 'A', value: '203.0.113.1' }, over || {});
}
var ENABLED = { enabled: true, authorised_domains: ['example.invalid'] };

(async function main() {

console.log('\n1. NORMALISATION — formatting is not drift');
(function () {
  var a = engine.normalizeRecord(rec({ name: 'WWW.Example.Invalid.', type: 'a', value: ' 203.0.113.1 ' }));
  var b = engine.normalizeRecord(rec({ name: 'www.example.invalid', type: 'A', value: '203.0.113.1' }));
  ok(a.key === b.key && a.value === b.value,
    '1 trailing dot, letter case and surrounding whitespace normalise away — they never become a false discrepancy');
  var c = engine.compareRecordSets({
    ovh: [rec({ name: 'example.invalid.', value: 'HOST.Example.Invalid.' })],
    public_dns: [rec({ name: 'example.invalid', value: 'host.example.invalid' })]
  });
  ok(c.counts.discrepancies === 0 && c.findings[0].verdict === 'MATCH',
    '2 two identically-meaning records from different providers compare as MATCH');
  throwsWith(function () { engine.normalizeRecord({ type: 'A' }); }, /record\.name is required/,
    '3 a record without a name is refused, not defaulted');
  throwsWith(function () { engine.normalizeRecord(null); }, /a record must be an object/,
    '4 a malformed record is refused');
})();

console.log('\n2. COMPARISON — real drift is found, expected difference is not invented');
(function () {
  var cmp = engine.compareRecordSets({
    ovh: [rec({ value: '203.0.113.1' }), rec({ name: 'mail.example.invalid', type: 'MX', value: '10 mx1.example.invalid' })],
    public_dns: [rec({ value: '198.51.100.9' })]
  });
  var a = cmp.findings.filter(function (f) { return f.type === 'A'; })[0];
  var mx = cmp.findings.filter(function (f) { return f.type === 'MX'; })[0];
  ok(a.verdict === 'VALUE_MISMATCH' && a.severity === 'HIGH',
    '5 the same record resolving differently across sources is a VALUE_MISMATCH');
  ok(mx.verdict === 'MISSING_IN_SOURCE' && mx.missingIn[0] === 'public_dns' && mx.severity === 'CRITICAL',
    '6 a mail record present in one source and absent from another is CRITICAL, not a routine gap');
  ok(cmp.counts.discrepancies === 2 && cmp.discrepancies.length === 2,
    '7 discrepancies are counted, never silently folded into the match total');

  var nsOnly = engine.compareRecordSets({
    ovh: [rec({ type: 'NS', value: 'ns1.tn.ovh.net' }), rec({ type: 'SOA', value: 'dns1.tn.ovh.net serial 1' })],
    cloudflare: [rec({ type: 'NS', value: 'kate.ns.cloudflare.com' }), rec({ type: 'SOA', value: 'kate.ns.cloudflare.com serial 2' })]
  });
  ok(nsOnly.counts.discrepancies === 0 && nsOnly.counts.notComparable === 2,
    '8 NS/SOA differing between providers is NOT_COMPARABLE — a migration in progress is not drift, and a fabricated alarm is not a finding');

  var oneSource = engine.compareRecordSets({ public_dns: [rec()] });
  ok(oneSource.comparable === false && oneSource.sourcesAbsent.indexOf('cloudflare') !== -1 &&
     oneSource.counts.discrepancies === 0,
    '9 an unsupplied source is SOURCE_ABSENT — an unbuilt Cloudflare zone never reads as "every record is missing"');
  throwsWith(function () { engine.compareRecordSets({}); }, /at least one source/,
    '10 comparing nothing is refused rather than reported as clean');
})();

console.log('\n3. EMAIL SAFETY — criterion 3 findings');
(function () {
  var healthy = engine.analyseEmailSafety([
    rec({ name: 'example.invalid', type: 'MX', value: '1 mx1.mail.ovh.net' }),
    rec({ name: 'example.invalid', type: 'TXT', value: 'v=spf1 include:mx.ovh.com -all' }),
    rec({ name: '_dmarc.example.invalid', type: 'TXT', value: 'v=DMARC1; p=quarantine' }),
    rec({ name: 'sel1._domainkey.example.invalid', type: 'TXT', value: 'v=DKIM1; k=rsa; p=AAAA' })
  ], { dkimSelectors: ['sel1'] });
  var codes = healthy.findings.map(function (f) { return f.code; });
  ok(codes.indexOf('MX_PRESENT') !== -1 && codes.indexOf('SPF_HARDFAIL') !== -1 &&
     codes.indexOf('DMARC_PRESENT') !== -1 && codes.indexOf('DKIM_PRESENT') !== -1,
    '11 a fully-configured mail domain produces only INFO findings for all four mechanisms');
  ok(healthy.highestSeverity === 'INFO' && healthy.safeToMigrate === true,
    '12 highest severity is honest for a healthy domain');

  var broken = engine.analyseEmailSafety([
    rec({ name: 'example.invalid', type: 'TXT', value: 'v=spf1 include:a -all' }),
    rec({ name: 'example.invalid', type: 'TXT', value: 'v=spf1 include:b ~all' })
  ]);
  var bcodes = broken.findings.map(function (f) { return f.code; });
  ok(bcodes.indexOf('MX_ABSENT') !== -1 && broken.highestSeverity === 'CRITICAL' && broken.safeToMigrate === false,
    '13 a domain with no MX is CRITICAL — recreating only what is observed would silently break inbound mail');
  ok(bcodes.indexOf('SPF_MULTIPLE') !== -1,
    '14 two SPF records are flagged — more than one is invalid and breaks evaluation');
  ok(bcodes.indexOf('DMARC_ABSENT') !== -1 && bcodes.indexOf('DKIM_UNVERIFIED') !== -1,
    '15 absent DMARC and unverifiable DKIM are reported as findings, not passed over');

  var unverifiable = engine.analyseEmailSafety([rec({ type: 'MX', value: '1 mx1' })]);
  ok(unverifiable.findings.filter(function (f) { return f.code === 'DKIM_UNVERIFIED'; })[0].detail.indexOf('UNKNOWN') !== -1,
    '16 DKIM with no selector is reported as UNKNOWN, never as "absent" — the two are different claims');

  var proxied = engine.analyseEmailSafety([
    rec({ name: 'example.invalid', type: 'MX', value: '1 mx1', proposedCloudflareMode: 'PROXIED' }),
    rec({ name: 'example.invalid', type: 'TXT', value: 'v=spf1 -all', proposedCloudflareMode: 'PROXIED' })
  ]);
  ok(proxied.findings.filter(function (f) { return f.code === 'MAIL_RECORD_PROXY_UNSAFE'; }).length === 2 &&
     proxied.safeToMigrate === false,
    '17 a mail or SPF record classified PROXIED is CRITICAL — mail records must stay DNS_ONLY');
  var declaredSelector = engine.analyseEmailSafety([rec({ type: 'MX', value: '1 mx1' })], { dkimSelectors: ['sel1'] });
  ok(declaredSelector.findings.some(function (f) { return f.code === 'DKIM_SELECTOR_MISSING' && f.severity === 'HIGH'; }),
    '18 a declared selector with no matching record is HIGH — the claim and the evidence disagree');
})();

console.log('\n4. DNSSEC SAFETY — criteria 5 and 6');
(function () {
  var unknown = engine.analyseDnssecSafety({ dnssecStatus: 'UNKNOWN' });
  ok(unknown.findings[0].code === 'DNSSEC_STATE_UNKNOWN' && unknown.highestSeverity === 'HIGH',
    '19 an UNKNOWN DNSSEC state is HIGH — criterion 5 cannot pass on an unknown');
  var missing = engine.analyseDnssecSafety({});
  ok(missing.status === 'UNKNOWN',
    '20 an unsupplied DNSSEC state defaults to UNKNOWN, never to DISABLED');
  var disabled = engine.analyseDnssecSafety({ dnssecStatus: 'DISABLED' });
  ok(disabled.dsSequencingRequired === false && disabled.highestSeverity === 'INFO',
    '21 DNSSEC disabled requires no DS sequencing');
  var enabled = engine.analyseDnssecSafety({ dnssecStatus: 'ENABLED', nameserverChangePlanned: true });
  var ecodes = enabled.findings.map(function (f) { return f.code; });
  ok(enabled.dsSequencingRequired === true && ecodes.indexOf('DS_SEQUENCING_REQUIRED') !== -1,
    '22 DNSSEC enabled + a planned nameserver change demands DS sequencing (criterion 6)');
  var inconsistent = engine.analyseDnssecSafety({ dnssecStatus: 'ENABLED', dsRecords: [] });
  ok(inconsistent.findings.some(function (f) { return f.code === 'DS_ABSENT_WHILE_ENABLED'; }),
    '23 DNSSEC reported enabled with no DS observed is an inconsistency that must be resolved first');
})();

console.log('\n5. MIGRATION PLAN — a proposal, ordered for safety, never an authorisation');
(function () {
  var plan = engine.generateMigrationPlan({
    domain: 'example.invalid',
    records: [
      rec({ name: 'example.invalid', type: 'A', proposedCloudflareMode: 'PROXIED', migrationAction: 'PROXY_AFTER_VALIDATION' }),
      rec({ name: 'example.invalid', type: 'MX', value: '1 mx1', proposedCloudflareMode: 'DNS_ONLY', migrationAction: 'RECREATE_EXACTLY' })
    ],
    dnssec: { dsSequencingRequired: true },
    nameserverChangePlanned: true
  });
  ok(plan.authorises_execution === false,
    '24 the plan states outright that it authorises nothing');
  ok(plan.steps[0].kind === 'dnssec_ds_change' &&
     plan.steps[plan.steps.length - 1].kind === 'dnssec_ds_change' &&
     plan.steps.filter(function (s) { return s.kind === 'nameserver_change'; })[0].sequence <
       plan.steps[plan.steps.length - 1].sequence,
    '25 DS removal is sequenced BEFORE the nameserver cutover and DS re-publication AFTER it — the checklist order, not alphabetical');
  ok(plan.steps.every(function (s) { return s.automation_level === 'LEVEL_3_APPROVAL_REQUIRED' && s.requires_approval === true && s.allow_self_approval === false; }),
    '26 every step is LEVEL_3, approval-required, and never self-approvable');
  ok(plan.steps.filter(function (s) { return engine.PERMANENT_BOUNDARY_STEP_KINDS.indexOf(s.kind) !== -1; })
      .every(function (s) { return s.is_permanent_boundary === true; }),
    '27 nameserver and DNSSEC-DS steps declare themselves permanent boundaries (approval matrix §2 items 1-2)');
  ok(plan.simulated_impact_summary.length <= 512 && /NOT authorised/.test(plan.simulated_impact_summary),
    '28 the impact summary fits aut_execution_plans.simulated_impact_summary and states the non-authorisation');

  var blocked = engine.generateMigrationPlan({
    domain: 'example.invalid',
    records: [rec({ proposedCloudflareMode: 'NEEDS_CONFIRMATION', requiresConfirmation: true, migrationAction: 'REVIEW_BEFORE_RECREATE' })],
    dnssec: { dsSequencingRequired: false }
  });
  ok(blocked.steps[0].status === 'BLOCKED' &&
     blocked.steps[0].blocked_by.indexOf('INF_CF2_CRITERION_9') !== -1 &&
     blocked.steps[0].blocked_by.length === 2 &&
     blocked.blocked_step_count === 1,
    '29 an unconfirmed record produces a BLOCKED step naming its gate, deduplicated, never a silently-proposed one');
  var d1 = engine.generateMigrationPlan({ domain: 'example.invalid', records: [rec({ name: 'b.example.invalid' }), rec({ name: 'a.example.invalid' })], dnssec: {} });
  var d2 = engine.generateMigrationPlan({ domain: 'example.invalid', records: [rec({ name: 'a.example.invalid' }), rec({ name: 'b.example.invalid' })], dnssec: {} });
  ok(JSON.stringify(d1.steps) === JSON.stringify(d2.steps),
    '30 plan generation is deterministic — input order cannot change the proposal');
  throwsWith(function () { engine.generateMigrationPlan({ records: [] }); }, /requires a domain/,
    '31 a plan without a domain is refused');
})();

console.log('\n6. GATE_CHECK — rejects any level inconsistent with the approval matrix');
(function () {
  var plan = engine.generateMigrationPlan({ domain: 'example.invalid', records: [rec()], dnssec: {}, nameserverChangePlanned: true });
  ok(engine.gateCheck(plan).ok === true,
    '32 a plan this engine generated passes its own gate');

  function mutate(fn) {
    var p = JSON.parse(JSON.stringify(plan));
    fn(p);
    return engine.gateCheck(p);
  }
  var lowered = mutate(function (p) {
    p.steps.filter(function (s) { return s.kind === 'nameserver_change'; })[0].automation_level = 'LEVEL_4_FULL_AUTOMATIC';
  });
  ok(lowered.ok === false && lowered.violations.some(function (v) { return v.code === 'AUTOMATION_LEVEL_MISMATCH'; }),
    '33 a nameserver step forged to LEVEL_4 is REJECTED — the matrix mismatch is caught, not trusted');
  var selfApprove = mutate(function (p) { p.steps[0].allow_self_approval = true; });
  ok(selfApprove.ok === false && selfApprove.violations.some(function (v) { return v.code === 'SELF_APPROVAL_PERMITTED'; }),
    '34 a step permitting self-approval is rejected');
  var noApproval = mutate(function (p) { p.steps[0].requires_approval = false; });
  ok(noApproval.ok === false && noApproval.violations.some(function (v) { return v.code === 'APPROVAL_NOT_REQUIRED'; }),
    '35 a step that drops the approval requirement is rejected');
  var notBoundary = mutate(function (p) {
    p.steps.filter(function (s) { return s.kind === 'nameserver_change'; })[0].is_permanent_boundary = false;
  });
  ok(notBoundary.ok === false && notBoundary.violations.some(function (v) { return v.code === 'PERMANENT_BOUNDARY_NOT_DECLARED'; }),
    '36 a nameserver step denying it is a permanent boundary is rejected');
  var claims = mutate(function (p) { p.authorises_execution = true; });
  ok(claims.ok === false && claims.violations.some(function (v) { return v.code === 'PLAN_CLAIMS_AUTHORISATION'; }),
    '37 a plan claiming to authorise its own execution is rejected');
  var unknownKind = mutate(function (p) { p.steps[0].kind = 'delete_everything'; });
  ok(unknownKind.ok === false && unknownKind.violations.some(function (v) { return v.code === 'UNKNOWN_STEP_KIND'; }),
    '38 an unrecognised step kind fails closed rather than being level-checked and waved through');
  ok(engine.gateCheck(null).ok === false && engine.gateCheck({}).ok === false,
    '39 a malformed plan never passes the gate');
  var multi = mutate(function (p) {
    p.authorises_execution = true;
    p.steps[0].allow_self_approval = true;
    p.steps[0].requires_approval = false;
  });
  ok(multi.violations.length === 3,
    '40 the gate reports every violation it found, not just the first — an operator sees the whole picture');
})();

console.log('\n7. ROLLBACK PLAN — inverse, restorable, never automatic');
(function () {
  var plan = engine.generateMigrationPlan({ domain: 'example.invalid', records: [rec()], dnssec: { dsSequencingRequired: true }, nameserverChangePlanned: true });
  var rb = engine.generateRollbackPlan(plan, {
    priorState: { nameservers: ['ns1.tn.ovh.net'], dnssecStatus: 'ENABLED', records: { 'example.invalid|A': '203.0.113.1' } }
  });
  ok(rb.is_automatic_eligible === false,
    '41 rollback is never automatically eligible — the inverse of a permanent boundary is itself one');
  ok(rb.steps[0].inverse_of === plan.steps[plan.steps.length - 1].step_id,
    '42 rollback runs in reverse order of the forward plan');
  ok(rb.steps.every(function (s) { return s.requires_approval === true && s.allow_self_approval === false; }),
    '43 every rollback step is approval-gated too');
  ok(rb.steps.filter(function (s) { return s.kind === 'nameserver_change'; })[0].restore_to[0] === 'ns1.tn.ovh.net',
    '44 a rollback step names the concrete pre-migration value it restores to');
  var noPrior = engine.generateRollbackPlan(plan, {});
  ok(noPrior.unrestorable_step_count === noPrior.steps.length && noPrior.steps.every(function (s) { return s.restorable === false; }),
    '45 with no prior state captured, steps are honestly marked unrestorable instead of pretending to be a rollback');
  throwsWith(function () {
    engine.assertRollbackSafe([{ kind: 'tls_downgrade' }]);
  }, /prohibited rollback step kind/, '46 a TLS-downgrade rollback is refused — a broken origin is fixed, never worked around by weakening TLS');
  throwsWith(function () {
    engine.assertRollbackSafe([{ kind: 'unproxy_administrative_hostname' }, { kind: 'port_reopen' }]);
  }, /unproxy_administrative_hostname, port_reopen/, '47 unproxying an administrative hostname and unconditional port reopening are both refused');
  throwsWith(function () { engine.generateRollbackPlan({}); }, /requires a migration plan/,
    '48 a rollback cannot be generated without a forward plan');
})();

console.log('\n8. INF-CF-2 ENTRY CRITERIA — reported, never closed by software');
(function () {
  var clean = engine.compareRecordSets({ ovh: [rec()], public_dns: [rec()] });
  var e = engine.evaluateEntryCriteria({ comparison: clean, records: [rec()] });
  var c8 = e.criteria.filter(function (c) { return c.criterion === 8; })[0];
  var c9 = e.criteria.filter(function (c) { return c.criterion === 9; })[0];
  ok(c8.status === 'SATISFIED', '49 criterion 8 is SATISFIED only when a real two-source comparison found no unresolved discrepancy');
  ok(c9.status === 'SATISFIED', '50 criterion 9 is SATISFIED when no record remains NEEDS_CONFIRMATION');
  ok(e.entry_gate_open === false,
    '51 the INF-CF-2 gate is reported CLOSED even when every computable criterion passes — software cannot open it');
  // The criteria the entry-criteria document states cannot be closed without
  // owner action: registrar access (2), owner approval (11), maintenance
  // window (12), origin/certificate plan (13). Named explicitly so emptying
  // the list cannot make this assertion vacuously true.
  var mustBeOwnerAction = [2, 11, 12, 13];
  ok(mustBeOwnerAction.every(function (n) {
    return engine.OWNER_ACTION_CRITERIA.indexOf(n) !== -1;
  }), '52a registrar access, owner approval, maintenance window and origin plan are all declared owner-action criteria');
  ok(mustBeOwnerAction.every(function (n) {
    var c = e.criteria.filter(function (x) { return x.criterion === n; })[0];
    return c && c.status === 'REQUIRES_OWNER_ACTION';
  }) && e.criteria.filter(function (c) { return c.status === 'REQUIRES_OWNER_ACTION'; }).length >= mustBeOwnerAction.length,
    '52b each of them is reported REQUIRES_OWNER_ACTION — never computed as satisfied, whatever the input');

  var dirty = engine.compareRecordSets({ ovh: [rec({ value: '203.0.113.1' })], public_dns: [rec({ value: '198.51.100.9' })] });
  var e2 = engine.evaluateEntryCriteria({ comparison: dirty, records: [rec({ requiresConfirmation: true })] });
  ok(e2.criteria.filter(function (c) { return c.criterion === 8; })[0].status === 'NOT_SATISFIED' &&
     e2.unresolved_discrepancies === 1,
    '53 an unresolved discrepancy keeps criterion 8 NOT_SATISFIED');
  ok(e2.criteria.filter(function (c) { return c.criterion === 9; })[0].status === 'NOT_SATISFIED',
    '54 a record still requiring confirmation keeps criterion 9 NOT_SATISFIED');
  var accepted = engine.evaluateEntryCriteria({ comparison: dirty, records: [rec()], acceptedDiscrepancies: ['example.invalid|A'] });
  ok(accepted.criteria.filter(function (c) { return c.criterion === 8; })[0].status === 'SATISFIED' &&
     accepted.unresolved_discrepancies === 0,
    '55 a discrepancy closes only by EXPLICIT acceptance, exactly as criterion 8 words it');
  var single = engine.evaluateEntryCriteria({ comparison: engine.compareRecordSets({ ovh: [rec()] }), records: [rec()] });
  ok(single.criteria.filter(function (c) { return c.criterion === 8; })[0].status === 'NOT_SATISFIED',
    '56 one source is not a record-by-record comparison — criterion 8 stays open');
})();

console.log('\n9. REAL INF-CF-1 DATA — the engine runs against the committed portfolio observations');
(function () {
  ok(INVENTORY.stage === 'INF-CF-1' && INVENTORY.domains.length === 8,
    '57 the committed INF-CF-1 inventory is present and carries all eight portfolio domains');
  var agribee = engine.publicDnsRecordsFromInventory(INVENTORY, 'agribee.tn');
  ok(agribee.records.length > 0 && agribee.dnssecStatus === 'DISABLED',
    '58 the inventory adapter maps a real domain into engine record shape, carrying its DNSSEC state');
  var dmarcRow = agribee.records.filter(function (r) { return r.name.indexOf('_dmarc.') === 0; })[0];
  ok(dmarcRow && dmarcRow.absent === true,
    '59 an "absent (NXDOMAIN)" observation is carried as absent, not as a record whose value is the string "absent"');
  var email = engine.analyseEmailSafety(agribee.records);
  var codes = email.findings.map(function (f) { return f.code; });
  ok(codes.indexOf('MX_PRESENT') !== -1 && codes.indexOf('SPF_HARDFAIL') !== -1 && codes.indexOf('DMARC_ABSENT') !== -1,
    '60 real agribee.tn data reproduces the INF-CF-1 recorded state: MX present, SPF hardfail, DMARC absent');
  var ssangyong = engine.publicDnsRecordsFromInventory(INVENTORY, 'ssangyong.autos');
  var dnssec = engine.analyseDnssecSafety({ dnssecStatus: ssangyong.dnssecStatus, nameserverChangePlanned: true });
  ok(ssangyong.dnssecStatus === 'ENABLED' && dnssec.dsSequencingRequired === true,
    '61 ssangyong.autos is DNSSEC-enabled in the real inventory, so DS sequencing is demanded (criterion 6, as the entry-criteria doc states)');
  var distinctKeys = {};
  agribee.records.filter(function (r) { return !r.absent; })
    .forEach(function (r) { distinctKeys[r.name.toLowerCase().replace(/\.$/, '') + '|' + r.type.toUpperCase()] = true; });
  var cmp = engine.compareRecordSets({ public_dns: agribee.records, ovh: agribee.records });
  ok(cmp.counts.discrepancies === 0 && cmp.counts.total === Object.keys(distinctKeys).length &&
     cmp.counts.notComparable === 2,
    '62 a real record set compared with itself yields zero discrepancies, one finding per distinct record key, and its NS/SOA pair as NOT_COMPARABLE');
  throwsWith(function () { engine.publicDnsRecordsFromInventory(INVENTORY, 'not-in-portfolio.invalid'); },
    /domain not present in the inventory/, '63 a domain outside the inventory is refused, never fabricated');
  throwsWith(function () { engine.publicDnsRecordsFromInventory({}, 'agribee.tn'); },
    /inventory document with a domains array/, '64 a malformed inventory document is refused');
})();

console.log('\n10. RUN ORCHESTRATION — fail-closed, read-only, terminates before APPLY');
await rejects(engine.runAnalysis({ domain: 'example.invalid' }, { authorised_domains: ['example.invalid'] }),
  /not explicitly enabled/, '65 refuses to run unless explicitly enabled — mirrors both existing connectors');
await rejects(engine.runAnalysis({ domain: 'example.invalid' }, { enabled: true }),
  /no authorised_domains configured/, '66 refuses without an authorised-domain list');
await rejects(engine.runAnalysis({ domain: 'other.invalid', sources: { ovh: [rec()] } }, ENABLED),
  /is not in authorised_domains/, '67 refuses a domain outside the authorised list — scope is never widened by input');
await rejects(engine.runAnalysis({ domain: 'example.invalid', sources: { ovh: [rec()] },
    clients: { cloudflare: { listZones: function () {}, updateRecord: function () {} } } }, ENABLED),
  /read-only violation.*updateRecord/, '68 an injected client exposing a mutation-shaped method is refused, using the shared connector guard');
await rejects(engine.runAnalysis(null, ENABLED), /analysis input object is required/,
  '69 malformed input is refused');
await rejects(engine.runAnalysis({ domain: 'example.invalid', sources: {} }, ENABLED),
  /at least one source/, '70 an analysis with no source data is refused rather than reported as clean');

await (async function () {
  var out = await engine.runAnalysis({
    domain: 'example.invalid',
    sources: {
      ovh: [rec({ type: 'MX', value: '1 mx1', proposedCloudflareMode: 'DNS_ONLY', migrationAction: 'RECREATE_EXACTLY' }),
            rec({ proposedCloudflareMode: 'PROXIED' })],
      public_dns: [rec({ type: 'MX', value: '1 mx1' }), rec({ proposedCloudflareMode: 'PROXIED' })]
    },
    dnssecStatus: 'ENABLED',
    nameserverChangePlanned: true,
    priorState: { nameservers: ['ns1.tn.ovh.net'], dnssecStatus: 'ENABLED' },
    clients: { cloudflare: { listZones: function () { return Promise.resolve([]); } } }
  }, ENABLED);
  ok(out.mutations_performed === 0,
    '71 a completed analysis reports zero mutations — LEVEL_1/LEVEL_2 perform none, by construction');
  ok(out.terminated_before === 'APPROVAL' &&
     out.lifecycle_completed.join(',') === 'DISCOVER,SNAPSHOT,ANALYSE,PLAN,DRY_RUN,GATE_CHECK',
     '72 the run walks the standard lifecycle and terminates before APPROVAL/APPLY — it does not skip the steps that precede it');
  ok(out.gate_check.ok === true && out.plan.authorises_execution === false && out.entry_criteria.entry_gate_open === false,
    '73 a successful run still authorises nothing and still reports the INF-CF-2 gate closed');
  ok(out.comparison.counts.discrepancies === 0 && out.dnssec.dsSequencingRequired === true &&
     out.rollback_plan.is_automatic_eligible === false,
    '74 comparison, DNSSEC analysis and rollback plan all travel in one result');
  var again = await engine.runAnalysis({
    domain: 'example.invalid',
    sources: { ovh: [rec()], public_dns: [rec()] }, dnssecStatus: 'DISABLED'
  }, ENABLED);
  var once = await engine.runAnalysis({
    domain: 'example.invalid',
    sources: { ovh: [rec()], public_dns: [rec()] }, dnssecStatus: 'DISABLED'
  }, ENABLED);
  ok(JSON.stringify(again) === JSON.stringify(once),
    '75 identical input produces a byte-identical analysis — deterministic, no clock or randomness in the verdict');
})();

console.log('\n11. SCHEMA SHAPE AND STRUCTURAL BOUNDARIES');
(function () {
  var r = engine.buildExecutionPlanRecord({
    planId: 'plan-1', automationVersionId: 'ver-1', planReference: 'mem://dns-auto-1/plan/example.invalid',
    simulatedImpactSummary: 'x'.repeat(600), generatedAt: '2026-08-15T00:00:00Z'
  });
  ok(r.plan_id === 'plan-1' && r.run_id === null && r.rollback_plan_reference === null,
    '76 the execution-plan record matches aut_execution_plans column shape');
  ok(r.simulated_impact_summary.length === 512,
    '77 the impact summary is truncated to the column width instead of overflowing it');
  ok(JSON.stringify(r).indexOf('x'.repeat(513)) === -1,
    '78 the full plan artifact is referenced, never embedded — same discipline as aut_snapshots');
  throwsWith(function () { engine.buildExecutionPlanRecord({ planId: 'p' }); },
    /missing required field: automationVersionId/, '79 an incomplete plan record is refused field by field');

  var src = fs.readFileSync(ENGINE_PATH, 'utf8');
  var body = src.replace(/\/\/[^\n]*\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '');
  ok(!/require\((?!'\.\/connector-readonly-helpers)/.test(body),
    '80 the engine requires nothing but the shared read-only connector helper — no fs, no http, no database, no provider SDK');
  ok(!/process\.env|apiToken|apiKey\s*[:=]|password\s*[:=]|secret\s*[:=]/i.test(body),
    '81 no environment read and no credential-shaped field exists in the engine');
  ok(!/fetch\(|XMLHttpRequest|WebSocket|https?:\/\/[a-z]/i.test(body),
    '82 the engine performs no network call and embeds no provider endpoint');
  ok(!/\b(INSERT INTO|UPDATE [a-z_]+ SET|DELETE FROM|writeFile|mkdir)\b/i.test(body),
    '83 the engine performs no database write and no filesystem write');
  ok(engine.PERMANENT_BOUNDARY_STEP_KINDS.join(',') === 'nameserver_change,dnssec_ds_change,record_delete',
    '84 the permanent-boundary set is exactly approval-matrix §2 items 1-3, no more and no less');
})();

console.log('\nStage INF-DNS-AUTO-1 DNS comparison: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);

})().catch(function (e) {
  console.error('SUITE ABORTED: ' + (e && e.stack || e));
  process.exit(1);
});
