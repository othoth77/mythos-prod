'use strict';
// =====================================================
// Mythos Orchestrator — secret redaction
// projects/mythos-orchestrator/lib/redact.js
//
// Applied to everything the orchestrator persists or prints: task logs,
// provider stdout/stderr, status files and CLI output. AGENTS.md §14
// forbids exposing secrets in tool output, fixtures or logs, and the
// ntfy topic is treated as a capability secret (possessing the topic is
// sufficient to publish to it), so it is redacted alongside credentials.
//
// This is defence in depth, not a licence to log sensitive material: the
// orchestrator never writes environment dumps or credential files in the
// first place.
// =====================================================

var PATTERNS = [
  // Provider and platform tokens
  { name: 'github-token', re: /\b(gh[pousr]_[A-Za-z0-9]{16,})\b/g },
  { name: 'github-pat', re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  { name: 'openai-key', re: /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}\b/g },
  { name: 'anthropic-key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { name: 'aws-access-key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: 'slack-token', re: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g },
  { name: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { name: 'private-key-block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },

  // Capability URLs — the path itself is the credential
  { name: 'ntfy-topic', re: /https?:\/\/ntfy\.[A-Za-z0-9.-]+\/[A-Za-z0-9_-]+/g },

  // Connection strings carrying inline credentials
  { name: 'db-url', re: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s:@/]+:[^\s@]+@[^\s]+/g },
  { name: 'url-basic-auth', re: /\bhttps?:\/\/[^\s:@/]+:[^\s@]+@[^\s]+/g },

  // Explicit assignments — key=value / key: value
  { name: 'assigned-secret', re: /\b([A-Za-z0-9_]*(?:PASSWORD|PASSWD|SECRET|TOKEN|API_?KEY|PRIVATE_?KEY|ACCESS_?KEY|CREDENTIAL)[A-Za-z0-9_]*)\s*[:=]\s*(?:"[^"\n]*"|'[^'\n]*'|[^\s,;)}\]]+)/gi }
];

var MASK = '[REDACTED]';

// Redacts every known secret shape in a string. Non-strings pass through
// unchanged so callers can use this defensively.
function redact(text) {
  if (typeof text !== 'string' || !text) return text;
  var out = text;
  PATTERNS.forEach(function (p) {
    if (p.name === 'assigned-secret') {
      out = out.replace(p.re, function (_match, key) { return key + '=' + MASK; });
    } else {
      out = out.replace(p.re, MASK);
    }
  });
  return out;
}

// Deep-redacts an arbitrary JSON-serialisable value, including object keys'
// values. Used before writing result/status files.
function redactValue(value) {
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === 'object') {
    var out = {};
    Object.keys(value).forEach(function (k) { out[k] = redactValue(value[k]); });
    return out;
  }
  return value;
}

// Reports which patterns match, without ever returning the matched text.
// Used by the task validator to refuse a task that carries a secret.
function findSecretKinds(text) {
  if (typeof text !== 'string' || !text) return [];
  var kinds = [];
  PATTERNS.forEach(function (p) {
    p.re.lastIndex = 0;
    if (new RegExp(p.re.source, p.re.flags.replace('g', '')).test(text)) kinds.push(p.name);
  });
  return kinds;
}

module.exports = {
  redact: redact,
  redactValue: redactValue,
  findSecretKinds: findSecretKinds,
  MASK: MASK
};
