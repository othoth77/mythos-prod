#!/usr/bin/env node
// =====================================================
// Mythos — OTH.DB → OTH Knowledge candidate extraction bridge
// scripts/othdb-extract.js
//
// Reads archived chat conversations out of OTH Master's oth.db
// (READ-ONLY, always), asks scripts/othdb-select.js which statements are
// worth keeping, and hands the result to
// projects/oth-knowledge/lib/importers/conversation.js, which persists
// them as CLAIMS with evidence and provenance.
//
// Architectural pattern reused (not copied) from the unmerged
// scripts/memory-ingest.js @ de4ba75: idempotency by source marker
// checked BEFORE any work, per-item error isolation so one bad
// conversation never loses the batch, and a {ingested, skipped, errors}
// report with a non-zero exit when anything failed.
//
// This script NEVER writes to oth.db and NEVER creates a fact.
//
// Usage:
//   node scripts/othdb-extract.js --db <oth.db> --store <kb-root> [options]
//     --limit N            conversations per run   (default 5, max 1000)
//     --provider claude|deepseek|chatgpt           (repeatable filter)
//     --conversation ID    process one specific conversation id
//     --dry-run            select + validate, write nothing
//     --report FILE        write the JSON report here
// =====================================================
'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const BASE = path.join(__dirname, '..');
const OTHK = path.join(BASE, 'projects', 'oth-knowledge');
const storeLib = require(path.join(OTHK, 'lib', 'store.js'));
const provenanceLib = require(path.join(OTHK, 'lib', 'provenance.js'));
const conversationImporter = require(path.join(OTHK, 'lib', 'importers', 'conversation.js'));
const selector = require(path.join(__dirname, 'othdb-select.js'));

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 1000;
const SUPPORTED = conversationImporter.SUPPORTED_CLASSES;

function fail(msg) { console.error('ERROR: ' + msg); process.exit(2); }

function parseArgs(argv) {
  const out = { providers: [], limit: DEFAULT_LIMIT, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--db') out.db = argv[++i];
    else if (a === '--store') out.store = argv[++i];
    else if (a === '--limit') out.limit = parseInt(argv[++i], 10);
    else if (a === '--provider') out.providers.push(argv[++i]);
    else if (a === '--conversation') out.conversation = argv[++i];
    else if (a === '--report') out.report = argv[++i];
    else if (a === '--dry-run') out.dryRun = true;
    else fail('unknown argument: ' + a);
  }
  if (!out.db) fail('--db <oth.db> required');
  if (!out.store) fail('--store <kb-root> required');
  if (!Number.isInteger(out.limit) || out.limit < 1 || out.limit > MAX_LIMIT) fail('--limit must be 1..' + MAX_LIMIT);
  for (const p of out.providers) if (SUPPORTED.indexOf(p) === -1) fail('unsupported provider: ' + p);
  return out;
}

// oth.db is opened read-only and is never written by this tool.
function openArchive(dbPath) {
  if (!fs.existsSync(dbPath)) fail('database not found: ' + dbPath);
  return new DatabaseSync(dbPath, { readOnly: true });
}

function listConversations(db, args) {
  const where = [];
  const params = [];
  if (args.conversation) { where.push('c.source_id = ?'); params.push(args.conversation); }
  const provs = args.providers.length ? args.providers : SUPPORTED;
  where.push('c.source_provider IN (' + provs.map(() => '?').join(',') + ')');
  provs.forEach((p) => params.push(p));
  const sql =
    'SELECT c.id, c.source_id, c.source_provider, c.title, c.model, c.message_count, '
    + 'c.source_created_at, c.checksum FROM conversations c '
    + 'WHERE ' + where.join(' AND ')
    + ' ORDER BY c.source_created_at ASC, c.id ASC LIMIT ?';
  params.push(args.limit);
  return db.prepare(sql).all(...params);
}

function loadMessages(db, conversationRowId) {
  return db.prepare(
    'SELECT position, role, content, source_created_at FROM messages '
    + 'WHERE conversation_id = ? ORDER BY position ASC'
  ).all(conversationRowId);
}

// The preserved artifact: the conversation exactly as archived, so the
// document/chunks and every claim's artifact_ref trace back to real bytes.
function conversationArtifact(row, messages) {
  return Buffer.from(JSON.stringify({
    schema: 'oth-db-conversation/1.0.0',
    source_provider: row.source_provider,
    source_id: row.source_id,
    title: row.title,
    model: row.model,
    message_count: row.message_count,
    source_created_at: row.source_created_at,
    checksum: row.checksum,
    messages: messages.map((m) => ({
      position: m.position, role: m.role, content: m.content, source_created_at: m.source_created_at,
    })),
  }, null, 2), 'utf8');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  const db = openArchive(args.db);
  const store = storeLib.openStore(args.store);
  const classes = provenanceLib.loadSourceClasses();

  const rows = listConversations(db, args);
  const report = {
    schema_version: '1.0.0',
    tool: 'othdb-extract/1.0.0',
    selector_version: selector.SELECTOR_VERSION,
    importer_version: conversationImporter.PARSER_VERSION,
    started_at: startedAt,
    dry_run: args.dryRun,
    source_db: path.basename(args.db),
    store_root: args.store,
    limit: args.limit,
    conversations: [],
    totals: {
      conversations_considered: rows.length,
      conversations_extracted: 0, conversations_skipped: 0,
      conversations_refused: 0, conversations_failed: 0,
      messages_processed: 0, messages_rendered: 0, messages_not_rendered: 0,
      statements_selected: 0, claims_created: 0, evidence_created: 0,
      facts_created: 0,
      truncated_conversations: 0, secret_refusals: 0,
      malformed_outputs: 0, input_chars: 0,
    },
    errors: [],
  };

  for (const row of rows) {
    const entry = {
      conversation_id: row.source_id, provider: row.source_provider,
      message_count: row.message_count, source_created_at: row.source_created_at,
      status: null,
    };
    try {
      // Idempotency FIRST — never pay for selection on a conversation we
      // have already extracted (memory-ingest.js @ de4ba75 pattern).
      const marker = conversationImporter.alreadyExtracted(store, {
        source_class: row.source_provider, source_collection: 'oth-db', conversation_id: row.source_id,
      });
      if (marker) {
        entry.status = 'skipped'; entry.reason = 'already extracted'; entry.marker = marker.id;
        report.totals.conversations_skipped++;
        report.conversations.push(entry);
        continue;
      }

      const messages = loadMessages(db, row.id);
      report.totals.messages_processed += messages.length;

      const sel = selector.selectStatements(
        { title: row.title, messages },
        { model: process.env.MYTHOS_SELECTOR_MODEL || null }
      );
      entry.messages_rendered = sel.messages_rendered;
      entry.truncated = sel.truncated;
      entry.statements_selected = sel.statements.length;
      entry.selector = sel.selector;
      report.totals.messages_rendered += sel.messages_rendered;
      report.totals.messages_not_rendered += (messages.length - sel.messages_rendered);
      report.totals.statements_selected += sel.statements.length;
      if (sel.truncated) report.totals.truncated_conversations++;

      const bytes = conversationArtifact(row, messages);
      report.totals.input_chars += bytes.length;

      if (args.dryRun) {
        // Validate exactly as the importer would, then stop. Nothing written.
        conversationImporter.validateStatements(sel.statements, messages.length);
        entry.status = 'dry-run-ok';
        entry.statements = sel.statements.map((s) => ({
          role_source: s.role_source, message_position: s.message_position,
          statement_chars: s.statement.length,
          asserted_by: row.source_provider + ':' + s.role_source,
        }));
        report.conversations.push(entry);
        continue;
      }

      const res = conversationImporter.importConversation(store, classes, {
        bytes,
        filename: row.source_provider + '-' + row.source_id + '.json',
        captured_at: startedAt,
        observed_at: row.source_created_at || undefined,
        source_class: row.source_provider,
        conversation_id: row.source_id,
        collection: 'oth-db',
        message_count: messages.length,
        statements: sel.statements,
        selector: sel.selector,
      });
      entry.status = 'extracted';
      entry.artifact = res.artifact; entry.document = res.document; entry.chunks = res.chunks;
      entry.claims = res.claims; entry.evidence = res.evidence; entry.marker = res.marker;
      entry.claim_ids = res.claim_ids;
      report.totals.conversations_extracted++;
      report.totals.claims_created += res.claims;
      report.totals.evidence_created += res.evidence;
      report.conversations.push(entry);
    } catch (e) {
      const code = e.code || 'UNKNOWN';
      entry.status = String(code).indexOf('REFUSED') !== -1 ? 'refused' : 'failed';
      entry.error_code = code;
      // Message only — never conversation content.
      entry.error = String(e.message || '').slice(0, 300);
      if (code === 'SELECTOR_SECRET_REFUSED') report.totals.secret_refusals++;
      if (code === 'SELECTOR_OUTPUT_INVALID') report.totals.malformed_outputs++;
      if (entry.status === 'refused') report.totals.conversations_refused++;
      else report.totals.conversations_failed++;
      report.errors.push({ conversation_id: row.source_id, code, message: entry.error });
      report.conversations.push(entry);
    }
  }

  db.close();

  // The load-bearing assertion, computed from the store itself.
  const factCount = store.allRecords({ kind: 'fact' }).length;
  report.totals.facts_created = 0;
  report.store_fact_records_total = factCount;
  report.finished_at = new Date().toISOString();
  report.duration_ms = Date.now() - t0;
  report.estimated_input_tokens = Math.round(report.totals.input_chars / 4);

  const out = JSON.stringify(report, null, 2);
  if (args.report) fs.writeFileSync(args.report, out + '\n', 'utf8');
  console.log(out);
  process.exit(report.errors.length ? 1 : 0);
}

if (require.main === module) main();
module.exports = { parseArgs, listConversations, conversationArtifact };
