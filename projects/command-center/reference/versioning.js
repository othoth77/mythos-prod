'use strict';
// =====================================================
// MYTHOS AI COMMAND CENTER — command version numbering
// projects/command-center/reference/versioning.js
//
// Owner requirement §30: "GitHub Final Verification v1.0 → when modified
// v1.1 → preserve previous versions."
//
// So versions are MAJOR.MINOR, minor-bumped on every substantive edit. The
// major is never bumped automatically — a major version is an editorial
// judgement ("this is a different command now"), and the owner sets it by
// typing it in the editor. Guessing it from a diff would be wrong more
// often than right.
//
// WHAT COUNTS AS SUBSTANTIVE is decided by the caller (api.js) and is
// deliberately narrow: the command text, its explanation, and the fields a
// reader acts on. Renaming a tag or moving a command between projects is
// library housekeeping, not a new version of the command — bumping on
// those would fill the history with noise and make the real edits harder
// to find.
// =====================================================

var VERSION = /^(\d+)\.(\d+)$/;

// Fields whose change makes a new version of the command itself.
var VERSIONED_FIELDS = [
  'title',
  'body',
  'description',
  'when_to_use',
  'explanation',
  'best_practices',
  'warnings',
  'safety_level'
];

function parse(version) {
  var match = VERSION.exec(String(version || '').trim());
  if (!match) return null;
  return { major: parseInt(match[1], 10), minor: parseInt(match[2], 10) };
}

function format(parsed) {
  return parsed.major + '.' + parsed.minor;
}

// '1.0' → '1.1'. An unparseable or missing version restarts at '1.0'
// rather than throwing: a malformed version must not make a command
// uneditable, and the owner can correct it in the editor.
function nextVersion(current) {
  var parsed = parse(current);
  if (!parsed) return '1.0';
  return format({ major: parsed.major, minor: parsed.minor + 1 });
}

// True when any versioned field differs between the stored row and the
// incoming update. `incoming` is a partial patch: a field it omits is
// unchanged by definition.
function isSubstantiveChange(existing, incoming) {
  return VERSIONED_FIELDS.some(function (field) {
    if (!Object.prototype.hasOwnProperty.call(incoming, field)) return false;
    if (incoming[field] === undefined) return false;
    return String(incoming[field]) !== String(existing[field] === null || existing[field] === undefined ? '' : existing[field]);
  });
}

// The snapshot written to mcc_command_versions BEFORE a row is overwritten.
// Captures the command's own content only — not its usage counters, which
// are not part of what the command IS and would make every copy look like
// an edit in the history.
function snapshotOf(row) {
  var snapshot = {};
  VERSIONED_FIELDS.concat(['difficulty', 'status', 'version', 'variables']).forEach(function (field) {
    snapshot[field] = row[field] === undefined ? null : row[field];
  });
  return snapshot;
}

module.exports = {
  parse: parse,
  nextVersion: nextVersion,
  isSubstantiveChange: isSubstantiveChange,
  snapshotOf: snapshotOf,
  VERSIONED_FIELDS: VERSIONED_FIELDS
};
