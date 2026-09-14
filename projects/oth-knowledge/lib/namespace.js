// =====================================================
// OTH Knowledge — memory namespaces
// projects/oth-knowledge/lib/namespace.js
//
// A minimal, deterministic namespace model layered over the existing
// record envelope. A namespace is a single string on the record's
// optional top-level `namespace` field:
//
//   global                — cross-project knowledge (the default when absent)
//   personal              — the owner's personal memory/preferences
//   projects/<slug>       — one project's durable memory
//
// Namespaces DISTINGUISH memory; they do not DUPLICATE it. Shared
// knowledge stays ONE underlying record (normally in `global`) and is
// referenced from a project via relationship records — never copied.
// This module is pure string logic: no I/O, no truth mutation.
// =====================================================
'use strict';

const GLOBAL = 'global';
const PERSONAL = 'personal';
const PROJECT_PREFIX = 'projects/';

// project slug: lowercase, digit/hyphen, 1..64 chars, must start alnum.
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

function fail(code, msg) { const e = new Error(code + ': ' + msg); e.code = code; return e; }

// Is `ns` a syntactically valid namespace string?
function isValidNamespace(ns) {
  if (typeof ns !== 'string' || !ns) return false;
  if (ns === GLOBAL || ns === PERSONAL) return true;
  if (ns.indexOf(PROJECT_PREFIX) !== 0) return false;
  return SLUG_RE.test(ns.slice(PROJECT_PREFIX.length));
}

// Validate or throw (fail-closed, used on the write path).
function assertNamespace(ns) {
  if (!isValidNamespace(ns)) {
    throw fail('OTHK_NAMESPACE', 'invalid namespace: ' + JSON.stringify(String(ns).slice(0, 80)) +
      ' (expected "global", "personal", or "projects/<slug>")');
  }
  return ns;
}

// The effective namespace of a record: its explicit `namespace`, or
// `global` when unset. Legacy records (written before namespaces
// existed) therefore read as global — never lost, never guessed.
function namespaceOf(rec) {
  const ns = rec && rec.namespace;
  return isValidNamespace(ns) ? ns : GLOBAL;
}

function isProject(ns) { return typeof ns === 'string' && ns.indexOf(PROJECT_PREFIX) === 0; }
function projectSlug(ns) { return isProject(ns) ? ns.slice(PROJECT_PREFIX.length) : null; }
function projectNamespace(slug) { return PROJECT_PREFIX + assertSlug(slug); }

function assertSlug(slug) {
  if (!SLUG_RE.test(String(slug))) throw fail('OTHK_NAMESPACE', 'invalid project slug: ' + JSON.stringify(String(slug).slice(0, 80)));
  return slug;
}

// Does a record fall within a namespace query? A query for `global`
// matches only global; a project query matches only that project;
// `personal` matches only personal. Isolation is strict by default —
// there is no implicit cross-namespace read.
function inNamespace(rec, query) {
  if (!query) return true;
  return namespaceOf(rec) === query;
}

module.exports = {
  GLOBAL, PERSONAL, PROJECT_PREFIX,
  isValidNamespace, assertNamespace, namespaceOf,
  isProject, projectSlug, projectNamespace, assertSlug, inNamespace,
};
