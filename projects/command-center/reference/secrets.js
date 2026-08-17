'use strict';
// =====================================================
// MYTHOS AI COMMAND CENTER — secret-pattern detection
// projects/command-center/reference/secrets.js
//
// Owner requirement §32 / AGENTS.md §14: an API key, password, token, SSH
// private key or credential must never be stored in command content or in
// a note. This module is the gate that enforces it, called by api.js
// before any write that carries user text.
//
// TWO SEVERITIES, deliberately:
//
//   HIGH   — a recognised credential FORMAT. These are near-zero
//            false-positive (a PEM private-key header is not a coincidence),
//            so the write is REFUSED outright. There is no "save anyway"
//            override: an override would make the rule advisory, and a
//            credential pasted once into a database is a credential to
//            rotate, not to un-save.
//
//   MEDIUM — a credential-shaped ASSIGNMENT (`password = ...`) whose value
//            is not obviously a placeholder. This is genuinely ambiguous —
//            a legitimate command in this library may well contain
//            `MCC_DB_PASSWORD=...` as documentation — so it is returned as
//            a WARNING and the write proceeds. The owner sees it in the UI.
//
// MASKING: a finding never carries the matched text back to the caller or
// into a log. If a real secret triggered a rule, echoing it in the API
// response or in journald would leak it to exactly the places this module
// exists to keep it out of. Callers get a rule name, a severity, a line
// number and a masked excerpt.
// =====================================================

// Values that look like secrets but are placeholders. Matched
// case-insensitively against the WHOLE captured value.
var PLACEHOLDER_VALUE = /^(?:\{\{[^}]*\}\}|<[^>]*>|\$\{?[A-Za-z_][A-Za-z0-9_]*\}?|\*+|x{3,}|\.{3,}|-+|redacted|changeme|change_me|your[-_ ]?\w*|placeholder|example|test|dummy|none|null|empty|todo|secret|password|token|api[-_]?key|value|s3cret)$/i;

// A value too short to be a real credential is not worth a false positive.
var MIN_SECRET_VALUE_LENGTH = 8;

var HIGH_CONFIDENCE_RULES = [
  {
    name: 'ssh_or_pem_private_key',
    label: 'SSH / PEM private key block',
    pattern: /-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----/
  },
  {
    name: 'aws_access_key_id',
    label: 'AWS access key ID',
    pattern: /\bAKIA[0-9A-Z]{16}\b/
  },
  {
    name: 'github_token',
    label: 'GitHub personal access / app token',
    pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/
  },
  {
    name: 'anthropic_api_key',
    label: 'Anthropic API key',
    pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/
  },
  {
    name: 'openai_api_key',
    label: 'OpenAI API key',
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9]{32,}/
  },
  {
    name: 'slack_token',
    label: 'Slack token',
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}/
  },
  {
    name: 'google_api_key',
    label: 'Google API key',
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/
  },
  {
    name: 'jwt',
    label: 'JSON Web Token',
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/
  },
  {
    name: 'connection_string_password',
    label: 'Connection string with an inline password',
    // postgres://user:secret@host — the password segment is the finding.
    // A `{{VAR}}`/`$VAR` placeholder password is excluded by the negative
    // class, so documenting a connection-string SHAPE stays allowed.
    pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:(?![{$<*])[^\s:/@]{6,}@/i
  }
];

// `key = value` / `key: value`, optionally quoted. The value is captured so
// it can be tested against PLACEHOLDER_VALUE before a finding is raised.
var ASSIGNMENT_RULE = {
  name: 'credential_assignment',
  label: 'Credential-shaped assignment with a concrete value',
  pattern: /\b(password|passwd|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|client[_-]?secret|credential|auth[_-]?token|bearer)\b\s*[:=]\s*(?:"([^"\n]*)"|'([^'\n]*)'|([^\s"',;]+))/gi
};

function maskExcerpt(line) {
  // Keep enough shape for the owner to find the line, never the value.
  var trimmed = String(line).trim();
  if (trimmed.length <= 24) return trimmed.slice(0, 8) + '…';
  return trimmed.slice(0, 16) + '…' + ' [' + (trimmed.length - 16) + ' more chars redacted]';
}

function scanField(fieldName, text, findings) {
  if (typeof text !== 'string' || text === '') return;
  var lines = text.split('\n');

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];

    for (var r = 0; r < HIGH_CONFIDENCE_RULES.length; r++) {
      var rule = HIGH_CONFIDENCE_RULES[r];
      if (rule.pattern.test(line)) {
        findings.push({
          severity: 'HIGH',
          rule: rule.name,
          label: rule.label,
          field: fieldName,
          line: i + 1,
          excerpt: maskExcerpt(line)
        });
      }
    }

    // `lastIndex` must be reset: the regex is global and reused per line.
    ASSIGNMENT_RULE.pattern.lastIndex = 0;
    var match;
    while ((match = ASSIGNMENT_RULE.pattern.exec(line)) !== null) {
      var value = match[2] !== undefined ? match[2]
                : match[3] !== undefined ? match[3]
                : match[4] !== undefined ? match[4]
                : '';
      if (value.length < MIN_SECRET_VALUE_LENGTH) continue;
      if (PLACEHOLDER_VALUE.test(value)) continue;
      findings.push({
        severity: 'MEDIUM',
        rule: ASSIGNMENT_RULE.name,
        label: ASSIGNMENT_RULE.label,
        field: fieldName,
        line: i + 1,
        excerpt: maskExcerpt(line)
      });
    }
  }
}

// fields: { body: '...', notes: '...' } — scans each, reports per field.
// Returns { blocked, findings, warnings } where `blocked` is true iff any
// HIGH finding was raised. Callers MUST refuse the write when blocked.
function scan(fields) {
  var findings = [];
  Object.keys(fields || {}).forEach(function (name) {
    scanField(name, fields[name], findings);
  });
  var high = findings.filter(function (f) { return f.severity === 'HIGH'; });
  return {
    blocked: high.length > 0,
    findings: high,
    warnings: findings.filter(function (f) { return f.severity === 'MEDIUM'; })
  };
}

module.exports = {
  scan: scan,
  MIN_SECRET_VALUE_LENGTH: MIN_SECRET_VALUE_LENGTH
};
