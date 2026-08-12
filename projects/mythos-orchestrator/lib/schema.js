'use strict';
// =====================================================
// Mythos Orchestrator — minimal JSON Schema validator
// projects/mythos-orchestrator/lib/schema.js
//
// This repository has no package.json and no third-party dependencies
// (AGENTS.md §9 / DEVX-0 precedent), so a dependency-free validator is
// used instead of pulling in ajv. It implements only the draft-07 subset
// the two orchestrator contracts actually use:
//
//   type (including union types), required, properties,
//   additionalProperties:false, enum, const, pattern, minLength,
//   maxLength, minimum, maximum, items, minItems
//
// Anything not listed above is ignored rather than silently "passing" a
// keyword it does not understand: assertKnownKeywords() fails loudly if a
// schema ever starts using an unsupported keyword, so a future contract
// change cannot quietly weaken validation.
// =====================================================

var SUPPORTED = {
  $schema: 1, title: 1, description: 1,
  type: 1, required: 1, properties: 1, additionalProperties: 1,
  enum: 1, const: 1, pattern: 1, minLength: 1, maxLength: 1,
  minimum: 1, maximum: 1, items: 1, minItems: 1
};

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function typeMatches(value, expected) {
  var actual = typeOf(value);
  if (expected === 'number') return actual === 'number' || actual === 'integer';
  if (expected === 'integer') return actual === 'integer';
  return actual === expected;
}

// Fails loudly on an unsupported keyword rather than ignoring it.
function assertKnownKeywords(schema, where, errors) {
  Object.keys(schema).forEach(function (key) {
    if (!SUPPORTED[key]) {
      errors.push(where + ': unsupported schema keyword "' + key + '" — lib/schema.js would silently ignore it');
    }
  });
}

function validateNode(value, schema, where, errors) {
  if (!schema || typeof schema !== 'object') return;
  assertKnownKeywords(schema, where, errors);

  if (schema.type !== undefined) {
    var expected = Array.isArray(schema.type) ? schema.type : [schema.type];
    var matched = expected.some(function (t) { return typeMatches(value, t); });
    if (!matched) {
      errors.push(where + ': expected type ' + expected.join('|') + ', got ' + typeOf(value));
      return; // further keyword checks would be meaningless
    }
  }

  if (schema.enum !== undefined) {
    var inEnum = schema.enum.some(function (allowed) {
      return allowed === value || (allowed === null && value === null);
    });
    if (!inEnum) errors.push(where + ': value is not one of the permitted enum values');
  }

  if (schema.const !== undefined && value !== schema.const) {
    errors.push(where + ': value must equal ' + JSON.stringify(schema.const));
  }

  if (typeof value === 'string') {
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) {
      errors.push(where + ': string does not match required pattern');
    }
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(where + ': string shorter than minLength ' + schema.minLength);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push(where + ': string longer than maxLength ' + schema.maxLength);
    }
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(where + ': value below minimum ' + schema.minimum);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(where + ': value above maximum ' + schema.maximum);
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(where + ': array shorter than minItems ' + schema.minItems);
    }
    if (schema.items) {
      value.forEach(function (item, i) {
        validateNode(item, schema.items, where + '[' + i + ']', errors);
      });
    }
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    var props = schema.properties || {};
    (schema.required || []).forEach(function (key) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) {
        errors.push(where + ': missing required property "' + key + '"');
      }
    });
    Object.keys(value).forEach(function (key) {
      if (props[key]) {
        validateNode(value[key], props[key], where + '.' + key, errors);
      } else if (schema.additionalProperties === false) {
        errors.push(where + ': unexpected additional property "' + key + '"');
      }
    });
  }
}

// Returns { valid: boolean, errors: string[] }.
function validate(value, schema) {
  var errors = [];
  validateNode(value, schema, 'root', errors);
  return { valid: errors.length === 0, errors: errors };
}

module.exports = { validate: validate, typeOf: typeOf };
