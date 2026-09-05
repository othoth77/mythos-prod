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
// The same module is the intake gate: the GitHub Issues adapter, the
// control bridge and the task runner call findSecretKinds() and refuse any
// task that carries a secret shape. Three functions, one classifier:
//
//   findSecretKinds(text)  → which kinds match (never the matched text)
//   redact(text)           → the same matches masked
//   redactValue(value)     → redact() applied deep
//
// Invariants (covered by tests/redact-governance-false-positive-test.js):
//   findSecretKinds(redact(x)) is empty; redact(redact(x)) === redact(x);
//   a placeholder that findSecretKinds accepts is left untouched by redact().
//
// KEY=VALUE assignments ("assigned-secret") are the one pattern where the
// value decides. A value is credential material UNLESS it is written as an
// EXPLICIT, structurally recognisable placeholder — see PLACEHOLDER_VALUE.
// There is deliberately NO vocabulary of "safe words" (configured, none,
// fixed, safe/redacted…): any list of words that pass is a list of passwords
// that pass. Documentation and examples state their non-secret values as
// placeholders (`API_KEY=<EXAMPLE_VALUE>`, `TOKEN=${TOKEN}`, `PASSWORD=[REDACTED]`).
// =====================================================

// Value grammar of an assignment. Order matters: the explicit forms are
// tried before the bare token so `<EXAMPLE VALUE>` and `[REDACTED]` are
// captured whole. The bare token stops at whitespace and clause
// delimiters — real credentials never contain either.
var ASSIGNED_VALUE_SRC = [
  '"[^"\\n]*"',                // "quoted"
  "'[^'\\n]*'",                // 'quoted'
  '<[^<>\\n]{1,120}>',         // <PLACEHOLDER>
  '\\$\\{[^}\\n]{1,80}\\}',    // ${VARIABLE}
  '\\{\\{[^}\\n]{1,80}\\}\\}', // {{ template }}
  '\\[[^\\[\\]\\n]{1,60}\\]',  // [REDACTED] / [MASKED]
  '[^\\s,;)}\\]]+'             // bare token (credential shape)
].join('|');

var ASSIGNED_KEY_SRC = '\\b([A-Za-z0-9_]*(?:PASSWORD|PASSWD|SECRET|TOKEN|API_?KEY|PRIVATE_?KEY|ACCESS_?KEY|CREDENTIAL)[A-Za-z0-9_]*)';

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

  // Explicit assignments — key=value / key: value. The value is classified
  // by isPlaceholderValue(); everything that is not an explicit placeholder
  // is treated as credential material.
  { name: 'assigned-secret', re: new RegExp(ASSIGNED_KEY_SRC + '\\s*[:=]\\s*(?:' + ASSIGNED_VALUE_SRC + ')', 'gi') }
];

var MASK = '[REDACTED]';

// Explicit placeholder forms. Each is a SYNTAX that no credential ever has,
// not a word that a credential could happen to be:
//   <…>          documentation placeholder      API_KEY=<EXAMPLE_VALUE>, TOKEN=<your token>
//   ${…} / $NAME variable reference             PASSWORD=${DB_PASSWORD}
//   {{…}}        template reference             TOKEN={{ vault.token }}
//   %NAME%       Windows-style reference        API_KEY=%API_KEY%
//   [NAME]       mask label (our own MASK)      PASSWORD=[REDACTED]
//   ***, xxxx, …  visual masks
//   (empty)      nothing assigned
// A placeholder body is a label: it must not itself carry a digit-bearing
// run that could be pasted credential material (`<AbCdEf0123456789XyZw>`
// is not a placeholder). The provider patterns above run independently, so
// `API_KEY=<sk-ant-…>` is still an anthropic-key hit.
var PLACEHOLDER_FORMS = [
  /^<[^<>]{1,120}>$/,
  /^\$\{[^}]{1,80}\}$/,
  /^\$[A-Za-z_][A-Za-z0-9_]{0,63}$/,
  /^\{\{[^}]{1,80}\}\}$/,
  /^%[A-Za-z_][A-Za-z0-9_]{0,63}%$/,
  /^\[[A-Za-z][A-Za-z0-9_ .:-]{0,58}\]$/,
  /^(?:\*{3,}|x{4,}|X{4,}|•{3,}|…|\.{3,})$/
];
var CREDENTIAL_RUN = /[A-Za-z0-9_-]{16,}/;
function hasCredentialRun(body) {
  var m = CREDENTIAL_RUN.exec(body);
  while (m) {
    if (/[0-9]/.test(m[0]) && /[A-Za-z]/.test(m[0])) return true;
    body = body.slice(m.index + m[0].length);
    m = CREDENTIAL_RUN.exec(body);
  }
  return false;
}

function isPlaceholderValue(value) {
  if (typeof value !== 'string') return false;
  var v = value.trim();
  if ((v[0] === '"' && v[v.length - 1] === '"') || (v[0] === "'" && v[v.length - 1] === "'")) v = v.slice(1, -1).trim();
  if (v === '') return true;
  for (var i = 0; i < PLACEHOLDER_FORMS.length; i++) {
    if (PLACEHOLDER_FORMS[i].test(v)) return !hasCredentialRun(v.slice(1, -1));
  }
  return false;
}

// Splits an assigned-secret match into { key, value } without ever
// returning more than the match itself.
function splitAssignment(match, key) {
  return { key: key, value: match.slice(key.length).replace(/^\s*[:=]\s*/, '') };
}

// Redacts every known secret shape in a string. Non-strings pass through
// unchanged so callers can use this defensively.
function redact(text) {
  if (typeof text !== 'string' || !text) return text;
  var out = text;
  PATTERNS.forEach(function (p) {
    if (p.name === 'assigned-secret') {
      out = out.replace(p.re, function (match, key) {
        if (isPlaceholderValue(splitAssignment(match, key).value)) return match;
        return key + '=' + MASK;
      });
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

// Reports every match as { kind, key, line } — the KEY of an assignment
// (never its value) and the 1-based line, so an author can find a false
// positive without the scanner ever echoing what it matched. Used by the
// task validator and the Issues intake.
function findSecretMatches(text) {
  if (typeof text !== 'string' || !text) return [];
  var found = [];
  PATTERNS.forEach(function (p) {
    var re = new RegExp(p.re.source, p.re.flags.indexOf('g') === -1 ? p.re.flags + 'g' : p.re.flags);
    var match;
    while ((match = re.exec(text)) !== null) {
      if (match[0].length === 0) { re.lastIndex++; continue; }
      if (p.name === 'assigned-secret') {
        var a = splitAssignment(match[0], match[1]);
        if (isPlaceholderValue(a.value)) continue;
        found.push({ kind: p.name, key: a.key, line: lineOf(text, match.index) });
      } else {
        found.push({ kind: p.name, key: null, line: lineOf(text, match.index) });
      }
    }
  });
  return found;
}

function lineOf(text, index) {
  var n = 1;
  for (var i = 0; i < index; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

// Reports which patterns match, without ever returning the matched text.
// Used by the task validator to refuse a task that carries a secret.
function findSecretKinds(text) {
  var kinds = [];
  findSecretMatches(text).forEach(function (m) { if (kinds.indexOf(m.kind) === -1) kinds.push(m.kind); });
  return kinds;
}

module.exports = {
  redact: redact,
  redactValue: redactValue,
  findSecretKinds: findSecretKinds,
  findSecretMatches: findSecretMatches,
  isPlaceholderValue: isPlaceholderValue,
  MASK: MASK
};
