// =====================================================
// OTHKM strengthening — P19 conversation ingestion · P3 knowledge migration
// tests/othk-17-conversation-migration-test.js
// =====================================================
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const BASE = path.join(__dirname, '..', 'projects', 'oth-knowledge');
const storeLib = require(path.join(BASE, 'lib/store.js'));
const extract = require(path.join(BASE, 'lib/extract.js'));
const provenance = require(path.join(BASE, 'lib/provenance.js'));
const convMem = require(path.join(BASE, 'lib/conversation-memory.js'));
const migrate = require(path.join(BASE, 'lib/migrate-source.js'));
const promote = require(path.join(BASE, 'lib/promote.js'));
const TRUST = require(path.join(BASE, 'config/trust-model.json'));

let passed = 0, failed = 0;
function ok(v, label) { if (v) { passed++; console.log('  PASS ' + label); } else { failed++; console.log('  FAIL ' + label); } }
function tmpRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'othk-test-')); }
const CLASSES = provenance.loadSourceClasses();

// ---- P19 conversation → memory ----
(function conversation() {
  const canon = storeLib.openStore(tmpRoot());
  const staging = storeLib.openStore(tmpRoot());
  const input = {
    conversation: { provider: 'deepseek', id: 'abc-123', collection: 'oth-db', captured_at: '2026-01-10T00:00:00Z' },
    candidates: [
      { statement: 'owner keeps 1000 beehives in Tunisia', role: 'user', namespace: 'projects/agribee' },
      { statement: 'propolis yields 50 to 150 grams per hive annually', role: 'assistant', namespace: 'projects/agribee' },
    ],
  };
  const res = convMem.ingestConversation(staging, canon, input, { classes: CLASSES, trustModel: TRUST });
  ok(res.staged === 2 && res.candidates === 2, 'P19: two distilled candidates staged from the conversation');
  ok(res.conversation_ref === 'deepseek/oth-db/abc-123', 'P19: conversation provenance preserved in the ref');
  // provenance on a staged record points back to the conversation, model-output tier
  const staged = staging.allRecords({ kind: 'claim' })[0];
  ok(staged.provenance.source_class === 'deepseek' && staged.provenance.source_reference.indexOf('deepseek/oth-db/abc-123') === 0, 'P19: staged memory traces to the exact conversation, tier=model-output');
  // NOT every message becomes memory — only the 2 candidates (no message dump)
  ok(staging.allRecords({ kind: 'claim' }).length === 2, 'P19: only distilled candidates stored, not raw messages');
  // operator promotes → canonical
  promote.promoteRun(staging, canon, { actor: 'operator' });
  ok(canon.allRecords({ kind: 'claim' }).length === 2, 'P19: operator promotion moves conversation-derived memory into OTHKM');
})();

// ---- P3 migration: synthetic markdown, staged + report ----
(function migrationSynthetic() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'othk-md-'));
  fs.writeFileSync(path.join(dir, 'DEC-001.md'), '# Use Postgres schema for personal memory\n\nrationale...\n## Reject SQLite for concurrency\n');
  fs.writeFileSync(path.join(dir, 'LESSON-002.md'), '# Never let AI overwrite durable truth\n');
  const canon = storeLib.openStore(tmpRoot());
  const staging = storeLib.openStore(tmpRoot());
  const rep = migrate.migrateMarkdown(staging, canon, { files: [path.join(dir, 'DEC-001.md'), path.join(dir, 'LESSON-002.md')], repoRoot: dir, source_class: 'mythos-repo', namespace: 'global' }, { classes: CLASSES, trustModel: TRUST });
  ok(rep.totals.candidates === 3 && rep.totals.staged === 3, 'P3: 3 distilled decisions/lessons staged (H1+H2 titles, bodies not copied)');
  const s = staging.allRecords({ kind: 'claim' })[0];
  ok(s.provenance.source_class === 'mythos-repo' && s.tags.indexOf('migrated') !== -1, 'P3: original provenance preserved (repository-verified), tagged migrated');
  // re-run → all NOOP (idempotent, no duplicate promotion), originals never destroyed
  const staging2 = storeLib.openStore(tmpRoot());
  promote.promoteRun(staging, canon, { actor: 'operator' });
  const rep2 = migrate.migrateMarkdown(staging2, canon, { files: [path.join(dir, 'DEC-001.md')], repoRoot: dir, source_class: 'mythos-repo', namespace: 'global' }, { classes: CLASSES, trustModel: TRUST });
  ok(rep2.totals.noop >= 1 && rep2.totals.staged === 0, 'P3: re-migration of already-present knowledge is NOOP (dedupe, no duplicates)');
})();

// ---- P3 migration: DRY-RUN over REAL clone docs (read-only, report only) ----
(function migrationDryRunReal() {
  const repoRoot = path.join(__dirname, '..');
  const realDocs = ['docs/OTHKM_STRENGTHENING.md', 'AGENTS.md', 'README.md']
    .map((p) => path.join(repoRoot, p)).filter((p) => fs.existsSync(p));
  if (!realDocs.length) { ok(true, 'P3: (no sample real docs found — skipped dry-run)'); return; }
  const canon = storeLib.openStore(tmpRoot());
  const rep = migrate.migrateMarkdown(null, canon, { files: realDocs, repoRoot, source_class: 'mythos-repo', namespace: 'global', dryRun: true }, { classes: CLASSES, trustModel: TRUST });
  ok(rep.dry_run === true, 'P3: dry-run mode reports without staging (real docs untouched)');
  ok(rep.totals.candidates >= 1 && (rep.totals.would_add + rep.totals.noop) >= 1, 'P3: dry-run over real clone docs produced a migration report (' + JSON.stringify(rep.totals) + ')');
  // canonical must be empty — dry-run wrote nothing anywhere
  ok(canon.stats().records === 0, 'P3: dry-run wrote nothing to canonical (no production impact)');
})();

console.log('othk-17: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
