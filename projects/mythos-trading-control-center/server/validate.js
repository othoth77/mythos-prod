'use strict';
// =====================================================
// MYTHOS TRADING CONTROL CENTER — request validation
// projects/mythos-trading-control-center/server/validate.js
//
// Every request body and query string is checked against a declared shape
// before any handler sees it. The same rule the Trading Agent's config schema
// follows applies here: UNKNOWN KEYS ARE ERRORS. A misspelt field that is
// silently ignored is how "I disabled recovery" becomes "I sent a field nobody
// read", and a field nobody declared is one nobody reviewed.
//
// check() returns every problem at once rather than the first, so an operator
// fixing a form fixes it in one pass.
// =====================================================

function describe(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function walk(spec, value, path, out) {
  if (value === undefined) {
    if (!spec.optional) out.push({ path: path || '<body>', message: 'is required' });
    return;
  }
  if (value === null) {
    if (!spec.nullable) out.push({ path: path || '<body>', message: 'must not be null' });
    return;
  }
  switch (spec.type) {
    case 'any':
      return;
    case 'boolean':
      if (typeof value !== 'boolean') out.push({ path: path, message: 'must be a boolean, got ' + describe(value) });
      return;
    case 'string':
      if (typeof value !== 'string') { out.push({ path: path, message: 'must be a string, got ' + describe(value) }); return; }
      if (spec.minLength !== undefined && value.length < spec.minLength) out.push({ path: path, message: 'must be at least ' + spec.minLength + ' characters' });
      if (spec.maxLength !== undefined && value.length > spec.maxLength) out.push({ path: path, message: 'must be at most ' + spec.maxLength + ' characters' });
      if (spec.pattern && !spec.pattern.test(value)) out.push({ path: path, message: 'has an invalid format' });
      if (spec.values && spec.values.indexOf(value) === -1) out.push({ path: path, message: 'must be one of [' + spec.values.join(', ') + ']' });
      return;
    case 'number':
    case 'integer':
      if (typeof value !== 'number' || !isFinite(value)) { out.push({ path: path, message: 'must be a finite number, got ' + describe(value) }); return; }
      if (spec.type === 'integer' && value !== Math.floor(value)) out.push({ path: path, message: 'must be an integer' });
      if (spec.min !== undefined && value < spec.min) out.push({ path: path, message: 'must be >= ' + spec.min });
      if (spec.max !== undefined && value > spec.max) out.push({ path: path, message: 'must be <= ' + spec.max });
      return;
    case 'array':
      if (!Array.isArray(value)) { out.push({ path: path, message: 'must be an array, got ' + describe(value) }); return; }
      if (spec.minItems !== undefined && value.length < spec.minItems) out.push({ path: path, message: 'needs at least ' + spec.minItems + ' item(s)' });
      if (spec.maxItems !== undefined && value.length > spec.maxItems) out.push({ path: path, message: 'allows at most ' + spec.maxItems + ' item(s)' });
      if (spec.unique) {
        var seen = {};
        value.forEach(function (v) {
          var k = typeof v + ':' + String(v);
          if (seen[k]) out.push({ path: path, message: 'contains a duplicate: ' + String(v).slice(0, 40) });
          seen[k] = true;
        });
      }
      for (var i = 0; i < value.length; i++) walk(spec.items, value[i], path + '[' + i + ']', out);
      return;
    case 'map':
      if (!isPlainObject(value)) { out.push({ path: path, message: 'must be an object, got ' + describe(value) }); return; }
      Object.keys(value).forEach(function (k) {
        if (spec.keyPattern && !spec.keyPattern.test(k)) out.push({ path: path + '.' + k.slice(0, 40), message: 'is not a valid key' });
        else walk(spec.values, value[k], path + '.' + k, out);
      });
      if (spec.maxKeys !== undefined && Object.keys(value).length > spec.maxKeys) out.push({ path: path, message: 'allows at most ' + spec.maxKeys + ' key(s)' });
      return;
    case 'object':
      if (!isPlainObject(value)) { out.push({ path: path || '<body>', message: 'must be an object, got ' + describe(value) }); return; }
      Object.keys(spec.fields).forEach(function (k) {
        walk(spec.fields[k], value[k], path ? path + '.' + k : k, out);
      });
      Object.keys(value).forEach(function (k) {
        if (!Object.prototype.hasOwnProperty.call(spec.fields, k)) {
          out.push({ path: path ? path + '.' + k.slice(0, 40) : k.slice(0, 40), message: 'is not a known field' });
        }
      });
      return;
    default:
      out.push({ path: path, message: 'internal: unknown validation type ' + spec.type });
  }
}

/** @returns {{ok: boolean, problems: Array<{path, message}>}} */
function check(spec, value) {
  var problems = [];
  walk(spec, value, '', problems);
  return { ok: problems.length === 0, problems: problems };
}

/**
 * Converts a parsed query string (all strings) into typed values according to
 * a flat spec, then validates. Query parameters repeated more than once are
 * refused rather than resolved, because which one wins differs between parsers.
 */
function query(spec, raw) {
  var typed = {};
  var problems = [];
  Object.keys(raw).forEach(function (k) {
    var v = raw[k];
    var field = spec.fields[k];
    if (Array.isArray(v)) { problems.push({ path: k.slice(0, 40), message: 'must not be repeated' }); return; }
    if (!field) { typed[k] = v; return; }   // reported as unknown by walk()
    if (field.type === 'integer' || field.type === 'number') {
      if (!/^-?\d+(\.\d+)?$/.test(v)) { problems.push({ path: k, message: 'must be a number' }); return; }
      typed[k] = Number(v);
    } else if (field.type === 'boolean') {
      if (v !== 'true' && v !== 'false') { problems.push({ path: k, message: 'must be true or false' }); return; }
      typed[k] = v === 'true';
    } else {
      typed[k] = v;
    }
  });
  if (problems.length) return { ok: false, problems: problems, value: null };
  var res = check(spec, typed);
  return { ok: res.ok, problems: res.problems, value: res.ok ? typed : null };
}

// --- spec builders -------------------------------------------------------

function str(opts) { return Object.assign({ type: 'string' }, opts || {}); }
function num(min, max, opts) { return Object.assign({ type: 'number', min: min, max: max }, opts || {}); }
function int(min, max, opts) { return Object.assign({ type: 'integer', min: min, max: max }, opts || {}); }
function bool(opts) { return Object.assign({ type: 'boolean' }, opts || {}); }
function arr(items, opts) { return Object.assign({ type: 'array', items: items }, opts || {}); }
function obj(fields, opts) { return Object.assign({ type: 'object', fields: fields }, opts || {}); }
function opt(spec) { return Object.assign({}, spec, { optional: true }); }

module.exports = {
  check: check,
  query: query,
  str: str, num: num, int: int, bool: bool, arr: arr, obj: obj, opt: opt,
  isPlainObject: isPlainObject
};
