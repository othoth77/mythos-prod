/* =====================================================
   MYTHOS WP — field validation, shared by server and browser
   projects/mythos-wp/reference/validate.js

   One validator for both sides: the server requires it (the boundary that
   counts) and the browser loads the same file from /js/validate.js so a
   form can show the same message before the round trip. Errors are NAMES
   (`required`, `too_long`, `not_a_number`, `not_in_enum`, `pattern`,
   `min`, `max`, `not_json`, `not_a_date`, `read_only`, `unknown_field`);
   the UI maps names to text. No I/O, no dependency, no globals besides the
   UMD export.

   validate(fields, payload, mode) → { ok, errors: { field: name }, value }
     fields  the resource's field list (resources.js)
     mode    'create' | 'update' — on update only the fields PRESENT in the
             payload are checked, so a partial update cannot fail on a
             required field it did not touch.
   `value` is the cleaned payload: trimmed strings, numbers as numbers,
   booleans as booleans, '' → null for optional fields, unknown or
   read-only fields dropped and REPORTED (so a client cannot slip a column
   in through a typo, and cannot overwrite a server-managed column).
   ===================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MythosWPValidate = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TYPES = ['text', 'textarea', 'integer', 'number', 'boolean', 'enum', 'json', 'timestamp', 'tags', 'url'];
  var URL_RE = /^https:\/\/[^\s]+$/;
  var ISO_RE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

  function isBlank(v) { return v === undefined || v === null || (typeof v === 'string' && v.trim() === ''); }

  function cleanOne(f, raw) {
    // → { value } | { error }
    if (isBlank(raw)) {
      if (f.required) return { error: 'required' };
      return { value: null };
    }
    switch (f.type) {
      case 'text':
      case 'textarea':
      case 'url': {
        if (typeof raw !== 'string') return { error: 'not_a_string' };
        var s = raw.trim();
        if (f.type === 'text' && /[\r\n]/.test(s)) return { error: 'multiline' };
        if (f.maxLength && s.length > f.maxLength) return { error: 'too_long' };
        if (f.pattern && !(new RegExp(f.pattern)).test(s)) return { error: 'pattern' };
        if (f.type === 'url' && !URL_RE.test(s)) return { error: 'not_https_url' };
        return { value: s };
      }
      case 'integer':
      case 'number': {
        var n = typeof raw === 'number' ? raw : (typeof raw === 'string' ? Number(raw.replace(',', '.')) : NaN);
        if (!isFinite(n)) return { error: 'not_a_number' };
        if (f.type === 'integer' && n !== Math.floor(n)) return { error: 'not_an_integer' };
        if (f.min !== undefined && n < f.min) return { error: 'min' };
        if (f.max !== undefined && n > f.max) return { error: 'max' };
        if (f.type === 'number' && f.scale !== undefined) n = Math.round(n * Math.pow(10, f.scale)) / Math.pow(10, f.scale);
        return { value: n };
      }
      case 'boolean': {
        if (typeof raw === 'boolean') return { value: raw };
        if (raw === 'true' || raw === '1' || raw === 1) return { value: true };
        if (raw === 'false' || raw === '0' || raw === 0) return { value: false };
        return { error: 'not_a_boolean' };
      }
      case 'enum': {
        var e = String(raw);
        if (!f.enum || f.enum.indexOf(e) === -1) return { error: 'not_in_enum' };
        return { value: e };
      }
      case 'json': {
        if (typeof raw === 'object') return { value: raw };
        if (typeof raw !== 'string') return { error: 'not_json' };
        try { return { value: JSON.parse(raw) }; } catch (err) { return { error: 'not_json' }; }
      }
      case 'tags': {
        var list = Array.isArray(raw) ? raw : String(raw).split(',');
        var tags = [];
        for (var i = 0; i < list.length; i++) {
          var t = String(list[i]).trim();
          if (!t) continue;
          if (t.length > 40 || !/^[\p{L}\p{N}_-]+$/u.test(t)) return { error: 'pattern' };
          if (tags.indexOf(t) === -1) tags.push(t);
        }
        if (tags.length > 20) return { error: 'too_many' };
        return { value: tags };
      }
      case 'timestamp': {
        if (raw instanceof Date) return { value: raw.toISOString() };
        var ts = String(raw).trim();
        if (!ISO_RE.test(ts) || isNaN(Date.parse(ts))) return { error: 'not_a_date' };
        return { value: new Date(ts).toISOString() };
      }
      default:
        return { error: 'unknown_type' };
    }
  }

  function validate(fields, payload, mode) {
    mode = mode === 'update' ? 'update' : 'create';
    var errors = {};
    var value = {};
    var byName = {};
    var ok = true;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false, errors: { _: 'not_an_object' }, value: {} };
    for (var i = 0; i < fields.length; i++) byName[fields[i].name] = fields[i];

    Object.keys(payload).forEach(function (k) {
      var f = byName[k];
      if (!f) { errors[k] = 'unknown_field'; ok = false; return; }
      if (f.readonly || f.virtual) { errors[k] = 'read_only'; ok = false; }
    });

    fields.forEach(function (f) {
      if (f.readonly || f.virtual) return;
      var present = Object.prototype.hasOwnProperty.call(payload, f.name);
      if (mode === 'update' && !present) return;
      var raw = present ? payload[f.name] : undefined;
      if (!present && f.defaultValue !== undefined) raw = (f.type === 'timestamp' && f.defaultValue === 'now') ? new Date().toISOString() : f.defaultValue;
      var r = cleanOne(f, raw);
      if (r.error) { errors[f.name] = r.error; ok = false; return; }
      if (r.value !== undefined && (present || r.value !== null)) value[f.name] = r.value;
    });

    return { ok: ok, errors: errors, value: value };
  }

  // A human sentence for an error name (en). The UI may localise further.
  var MESSAGES = {
    required: 'This field is required.',
    too_long: 'Too long.',
    multiline: 'Line breaks are not allowed here.',
    pattern: 'Invalid format.',
    not_https_url: 'Must be an https:// URL.',
    not_a_number: 'Must be a number.',
    not_an_integer: 'Must be a whole number.',
    min: 'Below the minimum.',
    max: 'Above the maximum.',
    not_a_boolean: 'Must be yes or no.',
    not_in_enum: 'Not an allowed value.',
    not_json: 'Must be valid JSON.',
    too_many: 'Too many entries.',
    not_a_date: 'Must be a date/time.',
    read_only: 'This field cannot be edited.',
    unknown_field: 'Unknown field.',
    not_a_string: 'Must be text.',
    not_an_object: 'Malformed request.',
    unknown_type: 'Unsupported field type.'
  };

  function message(name) { return MESSAGES[name] || name; }

  return { TYPES: TYPES, validate: validate, message: message, MESSAGES: MESSAGES };
}));
