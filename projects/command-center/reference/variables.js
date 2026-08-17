'use strict';
// =====================================================
// MYTHOS AI COMMAND CENTER — command placeholders
// projects/command-center/reference/variables.js
//
// Owner requirement §15: a command may declare placeholders such as
// {{REPOSITORY}}, {{BRANCH}}, {{COMMIT_SHA}}; "Customize Command" fills
// them and produces the final text to copy.
//
// This is pure string substitution and nothing else. It does not evaluate
// expressions, does not support logic or loops, and never touches a shell.
// A template engine here would turn a command LIBRARY into a command
// EXECUTION surface, which §14 forbids outright — so the substitution is
// deliberately as dumb as it can be.
//
// Substitution is single-pass: a value that itself contains `{{X}}` is
// inserted literally and is NOT expanded again. That matters — recursive
// expansion would let one filled value inject another placeholder's
// content, which is the string-injection bug this design avoids by
// construction.
// =====================================================

// {{ NAME }} — letters, digits, underscore. Whitespace inside the braces is
// tolerated because commands get hand-edited in a textarea.
var PLACEHOLDER = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

// Returns the distinct placeholder names in `text`, in first-appearance
// order, each with its occurrence count.
function extract(text) {
  var seen = Object.create(null);
  var ordered = [];
  if (typeof text !== 'string') return ordered;

  PLACEHOLDER.lastIndex = 0;
  var match;
  while ((match = PLACEHOLDER.exec(text)) !== null) {
    var name = match[1];
    if (seen[name] === undefined) {
      seen[name] = ordered.length;
      ordered.push({ name: name, occurrences: 1 });
    } else {
      ordered[seen[name]].occurrences++;
    }
  }
  return ordered;
}

// Merges declared variable metadata (label/default, from
// mcc_commands.variables) with the placeholders actually present in the
// body. The body is authoritative for WHICH placeholders exist — a
// declaration for a placeholder no longer in the text is dropped, and a
// placeholder with no declaration still gets a form field.
function describe(text, declared) {
  var byName = Object.create(null);
  (Array.isArray(declared) ? declared : []).forEach(function (item) {
    if (item && typeof item.name === 'string') byName[item.name] = item;
  });

  return extract(text).map(function (found) {
    var meta = byName[found.name] || {};
    return {
      name: found.name,
      occurrences: found.occurrences,
      label: typeof meta.label === 'string' ? meta.label : found.name,
      default: typeof meta.default === 'string' ? meta.default : '',
      declared: byName[found.name] !== undefined
    };
  });
}

// Fills placeholders from `values`. A placeholder with no supplied value is
// left EXACTLY as written — never blanked. Blanking would silently produce
// a command that looks complete but is wrong, which is worse than one that
// visibly still needs filling in.
function render(text, values) {
  if (typeof text !== 'string') return '';
  var supplied = values && typeof values === 'object' ? values : {};

  return text.replace(PLACEHOLDER, function (whole, name) {
    if (!Object.prototype.hasOwnProperty.call(supplied, name)) return whole;
    var value = supplied[name];
    if (value === null || value === undefined) return whole;
    if (typeof value !== 'string' && typeof value !== 'number') return whole;
    var asText = String(value);
    return asText === '' ? whole : asText;
  });
}

// Placeholder names left unfilled after a render — what the UI warns about
// before the owner copies an incomplete command.
function unresolved(text, values) {
  var supplied = values && typeof values === 'object' ? values : {};
  return extract(text)
    .map(function (found) { return found.name; })
    .filter(function (name) {
      var value = supplied[name];
      return value === null || value === undefined || value === '';
    });
}

module.exports = {
  extract: extract,
  describe: describe,
  render: render,
  unresolved: unresolved,
  PLACEHOLDER_PATTERN: PLACEHOLDER
};
