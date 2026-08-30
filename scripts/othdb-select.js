#!/usr/bin/env node
// =====================================================
// Mythos — conversation statement selector
// scripts/othdb-select.js
//
// Chooses which statements in one archived chat conversation are worth
// keeping as knowledge CANDIDATES. Deliberately lives OUTSIDE
// projects/oth-knowledge: every lib/ module there is offline and
// deterministic, and a model call would break that property. The
// importer (lib/importers/conversation.js) consumes what this returns,
// exactly as notebooklm.js consumes its own regex-parsed key points.
//
// The three guarantees are copied from the existing governed
// model-output pipeline, projects/mythos-ai-executor/core/decompose.js:
//
//   1. NO EXECUTION AUTHORITY AT THE SOURCE. The selector is reached
//      only through an agent whose execution_authority is false. An
//      agent claiming execution authority is REFUSED here, not merely
//      avoided.
//   2. NO AUTHORITY IN THE OUTPUT EITHER. The model may name statement,
//      role_source and message_position. It may NOT name confidence,
//      tags, entity_ids, asserted_by, source_class or any record field:
//      those are derived by the importer, so a generated selection
//      cannot widen its own trust or provenance. Anything outside the
//      accepted set is REFUSED, not dropped silently.
//   3. FAIL CLOSED, ALWAYS. No transport → SELECTOR_UNAVAILABLE. Junk,
//      oversized, over-long or multi-block output → SELECTOR_OUTPUT_INVALID.
//      An unaccepted field → SELECTOR_REFUSED. Secret-shaped content in
//      or out → SELECTOR_SECRET_REFUSED. There is no fallback path that
//      runs anything, and this module never persists and never executes.
// =====================================================
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const BASE = path.join(__dirname, '..');
const ingest = require(path.join(BASE, 'projects', 'oth-knowledge', 'lib', 'ingest.js'));
const AGENTS_PATH = path.join(BASE, 'projects', 'mythos-ai-executor', 'config', 'agents.json');

const SELECTOR_VERSION = 'othdb-select/1.0.0';
const MAX_INPUT_CHARS = 32000;
const MAX_OUTPUT_BYTES = 16 * 1024;
const MAX_STATEMENTS = 20;
const MAX_STATEMENT_CHARS = 2000;
const DEFAULT_TIMEOUT_MS = 120000;
const ROLES = ['user', 'assistant'];
const OUTPUT_FIELDS = ['statement', 'role_source', 'message_position'];

function fail(code, msg) { const e = new Error(code + ': ' + msg); e.code = code; return e; }

// ---------------------------------------------------------------- prompt

const INSTRUCTIONS = [
  'You are selecting durable knowledge statements from one chat conversation.',
  '',
  'Return exactly ONE fenced json block and nothing else:',
  '```json',
  '{"statements":[{"statement":"...","role_source":"user","message_position":0}]}',
  '```',
  '',
  'Rules:',
  '- Select only statements that are durable, self-contained, and verifiable in principle.',
  '- COPY the wording from the conversation. Never paraphrase into a new claim.',
  '- Never invent information that is not present in the conversation.',
  '- role_source is the role of the message the statement came from: user or assistant.',
  '- message_position is that message\'s position number as shown below.',
  '- Skip pleasantries, questions, speculation, and anything transient.',
  '- Returning {"statements":[]} is a correct and expected answer when nothing qualifies.',
  '- Never include credentials, tokens, keys or passwords.',
  '- Return at most ' + MAX_STATEMENTS + ' statements.',
  '- Do not add any field beyond statement, role_source and message_position.',
].join('\n');

// Renders one conversation, truncating at a MESSAGE boundary so a
// statement is never selected from a half-message. Truncation is
// reported, never silent.
function renderConversation(conversation) {
  const head = 'Conversation title: ' + (conversation.title || '(untitled)');
  const lines = [];
  let used = head.length;
  let truncated = false;
  for (const m of conversation.messages) {
    const block = '[' + m.position + '] ' + m.role + ': ' + String(m.content == null ? '' : m.content);
    if (used + block.length + 1 > MAX_INPUT_CHARS) { truncated = true; break; }
    lines.push(block);
    used += block.length + 1;
  }
  return { text: head + '\n' + lines.join('\n'), truncated, messages_rendered: lines.length };
}

// ------------------------------------------------------------- transports

// Reads the registry the executor already uses and refuses anything that
// claims execution authority (guarantee 1).
function resolveAdvisoryAgent(agentId) {
  let agents;
  try { agents = require(AGENTS_PATH); }
  catch (e) { throw fail('SELECTOR_UNAVAILABLE', 'agent registry unreadable'); }
  const agent = agents[agentId];
  if (!agent) throw fail('SELECTOR_UNAVAILABLE', 'unknown agent: ' + String(agentId).slice(0, 40));
  if (agent.execution_authority !== false) {
    throw fail('SELECTOR_REFUSED', 'agent ' + agentId + ' claims execution authority; advisory-only agents may select');
  }
  if (agent.enabled === false) throw fail('SELECTOR_UNAVAILABLE', 'agent ' + agentId + ' is disabled');
  return agent;
}

// Transport A — an external command receives the prompt on stdin and
// returns the fenced block on stdout. Mirrors the executor's existing
// MYTHOS_MOCK_SCRIPT hook, so a model can be attached without changing
// this file. Used by the offline suite and by a dry run without a
// provider credential.
function runScriptTransport(prompt, timeoutMs) {
  const script = process.env.MYTHOS_SELECTOR_SCRIPT;
  if (!script) throw fail('SELECTOR_UNAVAILABLE', 'MYTHOS_SELECTOR_SCRIPT is not set');
  const r = spawnSync(process.execPath, [script], {
    input: prompt, encoding: 'utf8', timeout: timeoutMs, maxBuffer: MAX_OUTPUT_BYTES * 4,
  });
  if (r.error && r.error.code === 'ETIMEDOUT') throw fail('SELECTOR_TIMEOUT', 'selector script exceeded ' + timeoutMs + 'ms');
  if (r.error) throw fail('SELECTOR_UNAVAILABLE', 'selector script failed to run');
  if (r.status !== 0) throw fail('SELECTOR_UNAVAILABLE', 'selector script exited ' + r.status);
  return String(r.stdout || '');
}

// Transport B — the advisory provider. No credential exists on this host
// today, so this path fails closed rather than inventing a fallback.
function runProviderTransport(agentId) {
  resolveAdvisoryAgent(agentId);
  const keyFile = process.env.MYTHOS_ADVISORY_KEY_FILE;
  const baseUrl = process.env.MYTHOS_ADVISORY_BASE_URL;
  if (!keyFile || !baseUrl) {
    throw fail('SELECTOR_UNAVAILABLE',
      'advisory provider needs MYTHOS_ADVISORY_KEY_FILE and MYTHOS_ADVISORY_BASE_URL; neither is set (no fallback)');
  }
  throw fail('SELECTOR_UNAVAILABLE', 'advisory provider transport is not wired in this version; use MYTHOS_SELECTOR_SCRIPT');
}

// ----------------------------------------------------------------- parse

// Exactly one fenced json block. Zero or several is invalid — a reply we
// cannot unambiguously read is a reply we cannot claim to have validated.
function parseSelectorOutput(text) {
  if (typeof text !== 'string' || !text.trim()) throw fail('SELECTOR_OUTPUT_INVALID', 'empty selector output');
  if (Buffer.byteLength(text, 'utf8') > MAX_OUTPUT_BYTES) {
    throw fail('SELECTOR_OUTPUT_INVALID', 'selector output exceeds ' + MAX_OUTPUT_BYTES + ' bytes');
  }
  const blocks = [];
  const re = /```json\s*([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(text)) !== null) blocks.push(m[1]);
  if (blocks.length !== 1) throw fail('SELECTOR_OUTPUT_INVALID', 'expected exactly one fenced json block, found ' + blocks.length);
  let obj;
  try { obj = JSON.parse(blocks[0]); }
  catch (e) { throw fail('SELECTOR_OUTPUT_INVALID', 'fenced block is not valid JSON'); }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw fail('SELECTOR_OUTPUT_INVALID', 'selector output must be an object');
  for (const k of Object.keys(obj)) {
    if (k !== 'statements') throw fail('SELECTOR_REFUSED', 'selector output carries unaccepted top-level field: ' + String(k).slice(0, 40));
  }
  if (!Array.isArray(obj.statements)) throw fail('SELECTOR_OUTPUT_INVALID', 'statements must be an array');
  if (obj.statements.length > MAX_STATEMENTS) {
    throw fail('SELECTOR_OUTPUT_INVALID', obj.statements.length + ' statements exceeds the ' + MAX_STATEMENTS + ' cap');
  }
  return obj.statements.map((s, i) => {
    if (!s || typeof s !== 'object' || Array.isArray(s)) throw fail('SELECTOR_OUTPUT_INVALID', 'statement ' + i + ' is not an object');
    for (const k of Object.keys(s)) {
      if (OUTPUT_FIELDS.indexOf(k) === -1) {
        throw fail('SELECTOR_REFUSED', 'statement ' + i + ' carries unaccepted field: ' + String(k).slice(0, 40));
      }
    }
    if (typeof s.statement !== 'string' || !s.statement.trim()) throw fail('SELECTOR_OUTPUT_INVALID', 'statement ' + i + ' has no text');
    if (s.statement.length > MAX_STATEMENT_CHARS) throw fail('SELECTOR_OUTPUT_INVALID', 'statement ' + i + ' exceeds ' + MAX_STATEMENT_CHARS + ' chars');
    if (ROLES.indexOf(s.role_source) === -1) throw fail('SELECTOR_OUTPUT_INVALID', 'statement ' + i + ' role_source invalid');
    if (!Number.isInteger(s.message_position) || s.message_position < 0) throw fail('SELECTOR_OUTPUT_INVALID', 'statement ' + i + ' message_position invalid');
    return { statement: s.statement.trim(), role_source: s.role_source, message_position: s.message_position };
  });
}

// ------------------------------------------------------------------ main

// selectStatements(conversation, opts) -> { statements, truncated, messages_rendered, selector }
//   conversation: { title, messages: [{ position, role, content }] }
// Throws typed SELECTOR_* errors. Never persists, never executes.
function selectStatements(conversation, opts) {
  opts = opts || {};
  if (!conversation || !Array.isArray(conversation.messages)) throw fail('SELECTOR_INPUT', 'conversation.messages required');

  const rendered = renderConversation(conversation);

  // Secret gate BEFORE the call — reject, never redact. Same detector the
  // ingestion gate uses, so the pre-check and the gate cannot disagree.
  const inHits = ingest.detectSecretShapes(rendered.text);
  if (inHits.length) throw fail('SELECTOR_SECRET_REFUSED', 'conversation matches secret shapes: ' + inHits.join(', '));

  const transport = opts.transport || (process.env.MYTHOS_SELECTOR_SCRIPT ? 'script' : 'provider');
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  const prompt = INSTRUCTIONS + '\n\n---\n\n' + rendered.text;

  let raw;
  if (transport === 'script') raw = runScriptTransport(prompt, timeoutMs);
  else raw = runProviderTransport(opts.agent || 'omniroute-advisory');

  // Secret gate on the way out too.
  const outHits = ingest.detectSecretShapes(raw);
  if (outHits.length) throw fail('SELECTOR_SECRET_REFUSED', 'selector output matches secret shapes: ' + outHits.join(', '));

  const statements = parseSelectorOutput(raw);
  return {
    statements,
    truncated: rendered.truncated,
    messages_rendered: rendered.messages_rendered,
    selector: {
      version: SELECTOR_VERSION,
      transport,
      model: opts.model || process.env.MYTHOS_SELECTOR_MODEL || null,
      agent: transport === 'provider' ? (opts.agent || 'omniroute-advisory') : null,
    },
  };
}

module.exports = {
  SELECTOR_VERSION, MAX_INPUT_CHARS, MAX_OUTPUT_BYTES, MAX_STATEMENTS,
  MAX_STATEMENT_CHARS, DEFAULT_TIMEOUT_MS, OUTPUT_FIELDS, INSTRUCTIONS,
  renderConversation, resolveAdvisoryAgent, parseSelectorOutput, selectStatements,
};
