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
const PROVIDER_PATH = path.join(BASE, 'projects', 'mythos-ai-executor', 'providers', 'openai-compat.js');
const BUDGET_PATH = path.join(BASE, 'projects', 'mythos-ai-executor', 'core', 'budget.js');

const SELECTOR_VERSION = 'othdb-select/1.0.0';
const MAX_INPUT_CHARS = 32000;
const MAX_OUTPUT_BYTES = 16 * 1024;
const MAX_STATEMENTS = 20;
const MAX_STATEMENT_CHARS = 2000;
const DEFAULT_TIMEOUT_MS = 120000;
const ROLES = ['user', 'assistant'];
const OUTPUT_FIELDS = ['statement', 'role_source', 'message_position'];

// The advisory model. Same DeepSeek V4 Pro already reachable through the
// OmniRoute gateway (the `oth-coding` alias); named here rather than read
// from any other tool's configuration, so nothing else has to change and
// nothing else breaks if this default moves.
const DEFAULT_ADVISORY_MODEL = 'openrouter/deepseek/deepseek-v4-pro';
const DEFAULT_BUDGET_PROJECT = 'mythos-prod';
const SAFE_RESERVATION_ID = /^[A-Za-z0-9._:-]{1,120}$/;

// The selector's own framing, replacing the executor's report-shaped system
// prompt. Overriding it is why providers/openai-compat.js grew an optional
// systemPrompt: its default asks for a trailing mythos_report block, and this
// contract is "exactly ONE fenced json block". Two instructions, one reply.
const SELECTOR_SYSTEM_PROMPT =
  'You select durable knowledge statements from an archived conversation. '
  + 'You analyse only: you never execute, never persist and never assert. '
  + 'Answer with exactly one fenced json block and no other text.';

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

// Transport B — the advisory provider, through the EXISTING adapter
// projects/mythos-ai-executor/providers/openai-compat.js. No second HTTP
// client, no second credential path, no new provider: the adapter already
// owns the endpoint, the key file, the timeout and the response shape, and
// it is permanently executionAuthority:false.
//
// SPEND IS GOVERNED, ALWAYS, IN THIS ORDER:
//
//   reserve  →  AI call  →  settle        (the call completed and billed)
//   reserve  →  AI call  →  release       (the call never billed)
//
// There is no path that reaches the provider without a prior allow, and no
// path that leaves a reservation dangling. An unknown cost is NOT zero: the
// estimate must be stated explicitly or the request is refused before any
// network activity, matching core/budget.js's own rule.
function resolveProviderModule(opts) {
  if (opts && opts.provider) return opts.provider;          // injected in tests
  try { return require(PROVIDER_PATH); }
  catch (e) { throw fail('SELECTOR_UNAVAILABLE', 'advisory provider adapter unreadable'); }
}

function resolveBudgetModule(opts) {
  if (opts && opts.budget) return opts.budget;              // injected in tests
  try { return require(BUDGET_PATH); }
  catch (e) { throw fail('SELECTOR_BUDGET_UNAVAILABLE', 'budget module unreadable; spending fails closed'); }
}

// Reads the cost estimate the caller must state. Never defaults to zero.
function costEstimateOf(opts) {
  const raw = (opts && opts.costEstimateUsd !== undefined && opts.costEstimateUsd !== null)
    ? opts.costEstimateUsd : process.env.MYTHOS_SELECTOR_COST_ESTIMATE_USD;
  if (raw === undefined || raw === null || raw === '') {
    throw fail('SELECTOR_BUDGET_REFUSED',
      'a cost estimate is required before any advisory call; set opts.costEstimateUsd or '
      + 'MYTHOS_SELECTOR_COST_ESTIMATE_USD (an unknown cost is never treated as zero)');
  }
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!isFinite(n) || n < 0) throw fail('SELECTOR_BUDGET_REFUSED', 'cost estimate must be a finite non-negative number');
  return n;
}

async function runProviderTransport(prompt, opts) {
  opts = opts || {};
  const agentId = opts.agent || 'omniroute-advisory';
  const agent = resolveAdvisoryAgent(agentId);          // guarantee 1, unchanged
  const providerMod = resolveProviderModule(opts);
  const budget = resolveBudgetModule(opts);

  const reservationId = opts.reservationId;
  if (!reservationId || !SAFE_RESERVATION_ID.test(String(reservationId))) {
    throw fail('SELECTOR_BUDGET_REFUSED',
      'a stable reservation_id is required so a retry cannot be billed twice');
  }
  const project = opts.budgetProject || process.env.MYTHOS_SELECTOR_BUDGET_PROJECT || DEFAULT_BUDGET_PROJECT;
  const amount = costEstimateOf(opts);
  const model = opts.model || process.env.MYTHOS_SELECTOR_MODEL || DEFAULT_ADVISORY_MODEL;

  // ---- reserve. Nothing has touched the network yet. -------------------
  const decision = budget.reserve({
    project, reservation_id: reservationId, amount, cost_basis: 'estimated',
    provider: agent.provider || 'openai-compat', agent: agentId,
  });
  if (!decision || decision.decision !== 'allow') {
    throw fail('SELECTOR_BUDGET_DENIED',
      'budget refused this selection for project "' + project + '": '
      + String((decision && decision.reason) || 'no decision').slice(0, 200));
  }

  // ---- the AI call ------------------------------------------------------
  let outcome;
  try {
    outcome = await providerMod.run(
      { model, timeout_seconds: Math.ceil((opts.timeoutMs || DEFAULT_TIMEOUT_MS) / 1000) },
      prompt, null, null,
      { keyFile: opts.keyFile, baseUrl: opts.baseUrl, systemPrompt: SELECTOR_SYSTEM_PROMPT }
    );
  } catch (e) {
    // The adapter resolves rather than rejects, so this is a defect, not a
    // billed call. Return the hold.
    budget.release({ project, reservation_id: reservationId, reason: 'advisory call threw before completing' });
    throw fail('SELECTOR_UNAVAILABLE', 'advisory provider failed: ' + String(e.message || 'unknown').slice(0, 160));
  }

  if (!outcome || outcome.exit_code !== 0 || (outcome.parsed && outcome.parsed.is_error)) {
    // No successful completion ⇒ nothing was billed ⇒ the hold is returned.
    budget.release({ project, reservation_id: reservationId, reason: 'advisory call did not complete successfully' });
    const detail = String((outcome && outcome.stderr) || (outcome && outcome.parsed && outcome.parsed.result) || 'no response').slice(0, 200);
    throw fail('SELECTOR_UNAVAILABLE', agent.provider + ' did not complete: ' + detail);
  }

  // A status below 400 is NOT proof that a completion happened. On
  // 2026-08-31 the gateway answered without error while its egress leg was
  // refusing connections: no tokens were consumed, yet a settle on
  // exit_code alone recorded a spend that never occurred. Settling needs
  // POSITIVE evidence — reported token usage, or actual returned text.
  // Anything else is released, so a phantom call costs nothing and the
  // ledger keeps telling the truth.
  const text = String((outcome.parsed && outcome.parsed.result) || '');
  const usage = outcome.usage || null;
  const usageTokens = usage
    ? Number(usage.total_tokens || usage.completion_tokens || usage.prompt_tokens || 0)
    : 0;
  const completed = usageTokens > 0 || text.trim().length > 0;

  if (!completed) {
    budget.release({
      project, reservation_id: reservationId,
      reason: 'no evidence of a completion: the provider reported neither token usage nor any text',
    });
    throw fail('SELECTOR_NO_COMPLETION',
      agent.provider + ' answered without a completion — no token usage and no text. '
      + 'Nothing was billed and the reservation was released.');
  }

  // ---- settle. A completion is evidenced, so the spend is real even if the
  // text turns out to be unusable — the money left before we could judge it.
  const settled = budget.settle({
    project, reservation_id: reservationId, actual_amount: amount, cost_basis: 'estimated',
  });

  return {
    text,
    spend: {
      project, reservation_id: reservationId, currency: 'USD',
      estimated_amount: amount, settled: !!(settled && settled.ok),
      usage, usage_tokens: usageTokens,
    },
    model,
    duration_ms: outcome.duration_ms || null,
  };
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
// Shared by both entry points, so a gate can never apply to one and not the
// other. Returns the prompt, or throws before anything reaches a transport.
function prepareSelection(conversation, opts) {
  if (!conversation || !Array.isArray(conversation.messages)) throw fail('SELECTOR_INPUT', 'conversation.messages required');
  const rendered = renderConversation(conversation);

  // Secret gate BEFORE the call — reject, never redact. Same detector the
  // ingestion gate uses, so the pre-check and the gate cannot disagree.
  const inHits = ingest.detectSecretShapes(rendered.text);
  if (inHits.length) throw fail('SELECTOR_SECRET_REFUSED', 'conversation matches secret shapes: ' + inHits.join(', '));

  return { rendered, prompt: INSTRUCTIONS + '\n\n---\n\n' + rendered.text };
}

function finishSelection(raw, rendered, opts, transport, extra) {
  // Secret gate on the way out too.
  const outHits = ingest.detectSecretShapes(raw);
  if (outHits.length) throw fail('SELECTOR_SECRET_REFUSED', 'selector output matches secret shapes: ' + outHits.join(', '));

  const statements = parseSelectorOutput(raw);
  const result = {
    statements,
    truncated: rendered.truncated,
    messages_rendered: rendered.messages_rendered,
    selector: {
      version: SELECTOR_VERSION,
      transport,
      model: (extra && extra.model) || opts.model || process.env.MYTHOS_SELECTOR_MODEL || null,
      agent: transport === 'provider' ? (opts.agent || 'omniroute-advisory') : null,
    },
  };
  if (extra && extra.spend) result.spend = extra.spend;
  return result;
}

function transportOf(opts) {
  return opts.transport || (process.env.MYTHOS_SELECTOR_SCRIPT ? 'script' : 'provider');
}

// SYNCHRONOUS entry point — the script transport only.
//
// It deliberately does NOT reach the advisory provider. An HTTP call cannot
// be made synchronously, and returning a Promise here would silently turn a
// throwing contract into a resolving one: a caller doing `try { select() }`
// would stop seeing refusals. So the provider is refused here, by name, and
// selectStatementsAsync() is the governed path. This keeps the fail-closed
// answer identical on every host, whether or not a credential happens to be
// readable by the current account.
function selectStatements(conversation, opts) {
  opts = opts || {};
  const transport = transportOf(opts);
  const { rendered, prompt } = prepareSelection(conversation, opts);

  if (transport !== 'script') {
    throw fail('SELECTOR_UNAVAILABLE',
      'the advisory provider is asynchronous and budget-governed; call selectStatementsAsync() '
      + '(this synchronous path serves MYTHOS_SELECTOR_SCRIPT only, and never spends)');
  }
  const raw = runScriptTransport(prompt, opts.timeoutMs || DEFAULT_TIMEOUT_MS);
  return finishSelection(raw, rendered, opts, transport, null);
}

// ASYNCHRONOUS entry point — the governed advisory path, and the only code
// in this repository that can cause an extraction to spend money. Every gate
// of the synchronous path applies unchanged; budget wraps the call itself.
async function selectStatementsAsync(conversation, opts) {
  opts = opts || {};
  const transport = transportOf(opts);
  const { rendered, prompt } = prepareSelection(conversation, opts);

  if (transport === 'script') {
    const raw = runScriptTransport(prompt, opts.timeoutMs || DEFAULT_TIMEOUT_MS);
    return finishSelection(raw, rendered, opts, transport, null);
  }
  const out = await runProviderTransport(prompt, opts);
  return finishSelection(out.text, rendered, opts, transport, { spend: out.spend, model: out.model });
}

module.exports = {
  SELECTOR_VERSION, MAX_INPUT_CHARS, MAX_OUTPUT_BYTES, MAX_STATEMENTS,
  MAX_STATEMENT_CHARS, DEFAULT_TIMEOUT_MS, OUTPUT_FIELDS, INSTRUCTIONS,
  DEFAULT_ADVISORY_MODEL, DEFAULT_BUDGET_PROJECT, SELECTOR_SYSTEM_PROMPT,
  renderConversation, resolveAdvisoryAgent, parseSelectorOutput,
  selectStatements, selectStatementsAsync,
};
