'use strict';
// =====================================================
// Mythos AI Executor — Free LLM Resources: credential loading
// projects/mythos-ai-executor/free-llm/secrets.js
//
// Exactly the providers/gemini.js / providers/openai-compat.js
// discipline, generalised to N providers instead of one: one env file
// per provider under a dedicated subfolder (so two dozen free
// providers do not clutter ~/.config/mythos-ai-executor/ directly),
// mode-agnostic read, absence reported as null — never invented, never
// guessed, never a subscription mistaken for an API credential.
//
// This module NEVER reads a key from the free-llm-api-resources
// checkout or catalog.json (point 10) — only from a file the operator
// creates locally, outside Git.
// =====================================================

var fs = require('fs');
var path = require('path');
var os = require('os');

var KEY_DIR = process.env.MYTHOS_FREE_LLM_KEY_DIR ||
  path.join(process.env.HOME || os.homedir() || '/home/ubuntu', '.config', 'mythos-ai-executor', 'free-llm');

function envVarName(providerId) {
  return 'MYTHOS_FREE_LLM_' + String(providerId).toUpperCase().replace(/[^A-Z0-9]/g, '_') + '_API_KEY';
}

function keyFilePath(providerId) {
  return path.join(KEY_DIR, providerId + '.env');
}

// loadKey(providerId, opts) -> string | null.
function loadKey(providerId, opts) {
  opts = opts || {};
  var file = opts.keyFile || keyFilePath(providerId);
  try {
    var text = fs.readFileSync(file, 'utf8');
    var re = new RegExp('^' + envVarName(providerId) + '=(.+)$', 'm');
    var m = re.exec(text);
    return m ? m[1].trim() : null;
  } catch (e) {
    return null;
  }
}

function available(providerId, opts) { return loadKey(providerId, opts) !== null; }

module.exports = {
  KEY_DIR: KEY_DIR,
  envVarName: envVarName,
  keyFilePath: keyFilePath,
  loadKey: loadKey,
  available: available
};
