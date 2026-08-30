// =====================================================
// OTH Knowledge — chat-conversation candidate importer
// projects/oth-knowledge/lib/importers/conversation.js
//
// Imports ONE archived chat conversation (Claude / DeepSeek / ChatGPT,
// as held in OTH Master's oth.db) together with statements that a
// SEPARATE selector already chose from it. Same contract as
// importers/notebooklm.js: this module is offline, deterministic and
// dependency-free — it NEVER calls a model. Selection happens before
// this module runs (scripts/othdb-select.js); here we only persist.
//
// Statements enter as CLAIMS asserted by '<provider>:user' or
// '<provider>:assistant' — NEVER as facts. A chat export is not a
// verified owner report even when the owner is the speaker, so the
// trust tier stays model-output for both roles (config/trust-model.json).
//
// Idempotency: a `derived` marker record per (derivation, document)
// records that this conversation was extracted. alreadyExtracted() lets
// the caller skip a conversation BEFORE paying for selection.
// =====================================================
'use strict';

const ingest = require('../ingest.js');
const extract = require('../extract.js');

const PARSER_VERSION = 'conversation/1.0.0';
const DERIVATION = 'conversation-extraction/v1';
const SUPPORTED_CLASSES = ['claude', 'deepseek', 'chatgpt'];
const ROLES = ['user', 'assistant'];
const MAX_STATEMENTS_PER_CONVERSATION = 20;
const MAX_STATEMENT_CHARS = 2000;
// Whitelist — anything else in a statement object is REFUSED, not dropped.
const STATEMENT_FIELDS = ['statement', 'role_source', 'message_position'];

function fail(code, msg) { const e = new Error(code + ': ' + msg); e.code = code; return e; }

function sourceRefFor(sourceClass, collection, conversationId) {
  return sourceClass + '/' + collection + '/' + conversationId;
}

// Cheap pre-check so a caller never re-selects an already-extracted
// conversation. Matches on the marker's derivation + source reference,
// which are both deterministic and independent of statement wording.
function alreadyExtracted(store, { source_class, source_collection, conversation_id }) {
  const ref = sourceRefFor(source_class, source_collection || 'oth-db', conversation_id);
  const hits = store.allRecords({
    kind: 'derived',
    where: (r) => r.derivation === DERIVATION
      && r.provenance && r.provenance.source_reference === ref,
  });
  return hits.length ? hits[0] : null;
}

// Validates the selector's output against the whitelist. Unknown fields
// are a refusal, never a silent drop: a statement carrying fields we do
// not understand is a statement we cannot claim to have validated.
function validateStatements(statements, messageCount) {
  if (!Array.isArray(statements)) throw fail('OTHK_CONV_INPUT', 'statements array required');
  if (statements.length > MAX_STATEMENTS_PER_CONVERSATION) {
    throw fail('OTHK_CONV_TOO_MANY', statements.length + ' statements exceeds the '
      + MAX_STATEMENTS_PER_CONVERSATION + '-statement per-conversation cap');
  }
  return statements.map((s, i) => {
    if (!s || typeof s !== 'object' || Array.isArray(s)) throw fail('OTHK_CONV_INPUT', 'statement ' + i + ' is not an object');
    for (const k of Object.keys(s)) {
      if (STATEMENT_FIELDS.indexOf(k) === -1) {
        throw fail('OTHK_CONV_REFUSED', 'statement ' + i + ' carries unaccepted field: ' + String(k).slice(0, 40));
      }
    }
    if (typeof s.statement !== 'string' || !s.statement.trim()) throw fail('OTHK_CONV_INPUT', 'statement ' + i + ' requires non-empty statement text');
    if (s.statement.length > MAX_STATEMENT_CHARS) throw fail('OTHK_CONV_TOO_LONG', 'statement ' + i + ' exceeds ' + MAX_STATEMENT_CHARS + ' chars');
    if (ROLES.indexOf(s.role_source) === -1) throw fail('OTHK_CONV_INPUT', 'statement ' + i + ' role_source must be one of: ' + ROLES.join('|'));
    if (!Number.isInteger(s.message_position) || s.message_position < 0) throw fail('OTHK_CONV_INPUT', 'statement ' + i + ' requires integer message_position >= 0');
    if (Number.isInteger(messageCount) && s.message_position >= messageCount) {
      throw fail('OTHK_CONV_INPUT', 'statement ' + i + ' message_position ' + s.message_position + ' is outside the conversation (' + messageCount + ' messages)');
    }
    return { statement: s.statement.trim(), role_source: s.role_source, message_position: s.message_position };
  });
}

// importConversation(store, classes, input)
//   input.bytes            Buffer — the preserved conversation JSON (the artifact)
//   input.filename         string
//   input.captured_at      ISO — when the conversation was read out of oth.db
//   input.source_class     'claude' | 'deepseek' | 'chatgpt'
//   input.conversation_id  provider conversation id (oth.db conversations.source_id)
//   input.statements       [{ statement, role_source, message_position }]
//   input.observed_at?     ISO — conversation truth time (source_created_at)
//   input.collection?      default 'oth-db'
//   input.message_count?   integer, for position bounds checking
//   input.selector?        { model, version } — recorded on the marker, never on claims
function importConversation(store, classes, input) {
  if (!input || !Buffer.isBuffer(input.bytes)) throw fail('OTHK_CONV_INPUT', 'bytes required');
  if (typeof input.captured_at !== 'string' || !input.captured_at) throw fail('OTHK_CONV_INPUT', 'captured_at required');
  if (SUPPORTED_CLASSES.indexOf(input.source_class) === -1) {
    throw fail('OTHK_CONV_INPUT', 'source_class must be one of: ' + SUPPORTED_CLASSES.join('|'));
  }
  if (typeof input.conversation_id !== 'string' || !input.conversation_id) throw fail('OTHK_CONV_INPUT', 'conversation_id required');

  const collection = input.collection || 'oth-db';
  const sourceRef = sourceRefFor(input.source_class, collection, input.conversation_id);

  // Validate BEFORE storing anything (fail-closed, same order as gemini.js).
  const statements = validateStatements(input.statements, input.message_count);

  const existing = alreadyExtracted(store, {
    source_class: input.source_class, source_collection: collection, conversation_id: input.conversation_id,
  });
  if (existing) {
    return {
      conversation_id: input.conversation_id, source_reference: sourceRef,
      skipped: true, reason: 'already extracted', marker: existing.id,
      claims: 0, evidence: 0, deduplicated: true,
    };
  }

  // Artifact → normalized document → chunks. This also runs the secret
  // gate on both the normalized text and the raw bytes, and refuses a
  // metadata-only source class, before anything is persisted.
  const res = ingest.ingestArtifact(store, classes, {
    bytes: input.bytes,
    filename: input.filename || (input.conversation_id + '.json'),
    source_class: input.source_class,
    source_collection: collection,
    source_reference: sourceRef,
    captured_at: input.captured_at,
    observed_at: input.observed_at,
    parser_version: PARSER_VERSION,
    importer: PARSER_VERSION,
    metadata: {
      assertion_class: 'OBSERVED',
      message_count: Number.isInteger(input.message_count) ? input.message_count : null,
    },
  });

  const report = {
    conversation_id: input.conversation_id, source_reference: sourceRef,
    artifact: res.artifact.id, document: res.document.id, chunks: res.chunks.length,
    deduplicated: res.deduplicated, skipped: false,
    claims: 0, evidence: 0, claim_ids: [],
  };

  for (const s of statements) {
    const assertedBy = input.source_class + ':' + s.role_source;
    // Model-assisted selection out of an export → CLAIM, never a fact.
    const claim = extract.addClaim(store, classes, {
      statement: s.statement,
      asserted_by: assertedBy,
      prov: {
        source_class: input.source_class,
        source_collection: collection,
        source_reference: sourceRef + '#msg-' + s.message_position,
        captured_at: input.captured_at,
        observed_at: input.observed_at,
        artifact_ref: res.artifact.content_ref,
      },
      tags: ['EXTRACTED', 'model-assisted', 'conversation-candidate'],
    });
    extract.addEvidence(store, {
      supports_id: claim.id,
      evidence_ids: [res.document.id],
      note: 'selected from ' + input.source_class + ' conversation ' + input.conversation_id
        + ' message #' + s.message_position + ' (' + s.role_source + ')',
    });
    report.claims++; report.evidence++; report.claim_ids.push(claim.id);
  }

  // The extraction receipt. Its id is deterministic on (derivation,
  // document), so re-running is a no-op rather than a duplicate.
  const marker = extract.addDerived(store, classes, {
    text: report.claims + ' candidate statement(s) selected from this conversation',
    derivation: DERIVATION,
    derived_from: [res.document.id],
    prov: {
      source_class: input.source_class,
      source_collection: collection,
      source_reference: sourceRef,
      captured_at: input.captured_at,
      observed_at: input.observed_at,
      artifact_ref: res.artifact.content_ref,
    },
    tags: ['EXTRACTED', 'extraction-marker'],
  });
  report.marker = marker.id;
  report.selector = input.selector || null;
  return report;
}

module.exports = {
  PARSER_VERSION, DERIVATION, SUPPORTED_CLASSES, ROLES,
  MAX_STATEMENTS_PER_CONVERSATION, MAX_STATEMENT_CHARS, STATEMENT_FIELDS,
  sourceRefFor, alreadyExtracted, validateStatements, importConversation,
};
