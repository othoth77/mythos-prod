'use strict';
// =====================================================
// Mythos Orchestrator — secret redaction
// projects/mythos-orchestrator/lib/redact.js
// =====================================================

var PATTERNS = [
  { name: 'github-token', re: /\b(gh[pousr]_[A-Za-z0-9]{16,})\b/g },
  { name: 'github-pat', re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  { name: 'openai-key', re: /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}\b/g },
  { name: 'anthropic-key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { name: 'aws-access-key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: 'slack-token', re: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g },
  { name: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { name: 'private-key-block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { name: 'ntfy-topic', re: /https?:\/\/ntfy\.[A-Za-z0-9.-]+\/[A-Za-z0-9_-]+/g },
  { name: 'db-url', re: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s:@/]+:[^\s@]+@[^\s]+/g },
  { name: 'url-basic-auth', re: /\bhttps?:\/\/[^\s:@/]+:[^\s@]+@[^\s]+/g },

  // Explicit assignments. The value is captured through the end of the
  // current clause so human status prose such as "Secrets: safe/redacted"
  // can be recognised as a non-secret placeholder without weakening the
  // credential patterns above.
  { name: 'assigned-secret', re: /\b([A-Za-z0-9_]*(?:PASSWORD|PASSWD|SECRET|TOKEN|API_?KEY|PRIVATE_?KEY|ACCESS_?KEY|CREDENTIAL)[A-Za-z0-9_]*)\s*[:=]\s*(?:"[^"\n]*"|'[^'\n]*'|[^\n,;)}\]]+)/gi }
];

var SAFE_ASSIGNMENT_VALUES = /^(?:configured|fixed|not\s+required|none|safe(?:\/redacted)?|redacted|n\/a|na|ok|true|false|yes|no|enabled|disabled|pending|unknown|not\s+configured|not\s+set|unset)$/i;
var MASK = '[REDACTED]';

function isSafeAssignmentValue(value) {
  if (typeof value !== 'string') return false;
  var v = value.trim().replace(/^["']|["']$/g, '').trim();
  return SAFE_ASSIGNMENT_VALUES.test(v);
}

function redact(text) {
  if (typeof text !== 'string' || !text) return text;
  var out = text;
  PATTERNS.forEach(function (p) {
    if (p.name === 'assigned-secret') {
      out = out.replace(p.re, function (match, key) {
        var assignment = match.slice(key.length).replace(/^\s*[:=]\s*/, '');
        if (isSafeAssignmentValue(assignment)) return match;
        return key + '=' + MASK;
      });
    } else {
      out = out.replace(p.re, MASK);
    }
  });
  return out;
}

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

function findSecretKinds(text) {
  if (typeof text !== 'string' || !text) return [];
  var kinds = [];
  PATTERNS.forEach(function (p) {
    var re = new RegExp(p.re.source, p.re.flags.replace('g', ''));
    if (p.name === 'assigned-secret') {
      var match;
      while ((match = re.exec(text)) !== null) {
        var assignment = match[0].slice(match[1].length).replace(/^\s*[:=]\s*/, '');
        if (!isSafeAssignmentValue(assignment)) {
          kinds.push(p.name);
          break;
        }
      }
    } else if (re.test(text)) {
      kinds.push(p.name);
    }
  });
  return kinds;
}

module.exports = { redact: redact, redactValue: redactValue, findSecretKinds: findSecretKinds, MASK: MASK };
