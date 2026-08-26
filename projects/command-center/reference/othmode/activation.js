'use strict';
// =====================================================
// OTHMODE — per-command activation detection
// projects/command-center/reference/othmode/activation.js
//
// THE activation rule, in one place:
//
//     "othmode" in the command  =  USE OTHMODE
//     no "othmode"              =  NORMAL CLAUDE
//
// OTHMODE itself is always available (installed, healthy, ready); there
// is no global ON/OFF state anywhere any more. Activation is a property
// of ONE command, decided by the presence of the standalone keyword —
// case-insensitively, deterministically, and never as a substring of
// another word.
//
// Tokenizer semantics (chosen over a regex word-boundary on purpose —
// \b would treat "othmode-test" as a match, and the owner specification
// says it must NOT be):
//   * the text is split on whitespace;
//   * surrounding punctuation that naturally wraps a word in prose is
//     stripped from each token: ,.;:!?"'`()[]{}«»“”‘’ and trailing/leading
//     dots — but NOT interior characters;
//   * a token activates only if what remains equals "othmode"
//     case-insensitively.
// So:  "othmode analyse"      → ACTIVATED
//      "OTHMODE test"         → ACTIVATED
//      "(othmode)" / "othmode," → ACTIVATED
//      "othmodel test"        → normal (different word)
//      "myothmode test"       → normal (different word)
//      "othmode-test"         → normal (hyphenated compound, per spec)
//
// SECURITY: the keyword selects the CONTROL CONTRACT for a command.
// It grants nothing: authentication, roles, owner gates, the secret
// gate and every other boundary are evaluated exactly as before,
// completely independent of this module.
// =====================================================

var KEYWORD = 'othmode';

// Punctuation stripped from token edges. Hyphen, underscore and digits
// are deliberately absent: they glue compounds ("othmode-test",
// "othmode_x", "othmode2") which are different words, not activations.
var EDGE_PUNCT = /^[\s,.;:!?"'`()\[\]{}«»“”‘’…]+|[\s,.;:!?"'`()\[\]{}«»“”‘’…]+$/g;

function isActivated(text) {
  if (typeof text !== 'string' || text === '') return false;
  var tokens = text.split(/\s+/);
  for (var i = 0; i < tokens.length; i++) {
    var token = tokens[i].replace(EDGE_PUNCT, '');
    if (token.toLowerCase() === KEYWORD) return true;
  }
  return false;
}

// Classification for OTHMODE-specific history/context: only an explicitly
// activated command is ever an "othmode" command. Everything else is a
// normal Claude command and must never be labeled otherwise.
function classify(text) {
  return isActivated(text) ? 'othmode' : 'normal';
}

// What the platform reports about itself now that there is no switch:
// permanently available, activated per command. Served by /api/othmode/mode
// (kept at its old path so nothing that watched availability breaks).
function availability() {
  return {
    status: 'READY',
    activation: 'per-command keyword',
    keyword: KEYWORD,
    hint_en: "OTHMODE is always available. Write 'othmode' in a Claude command to activate it for that command only.",
    hint_fr: 'OTHMODE est toujours disponible. Écrivez « othmode » dans une commande Claude pour l’activer pour cette commande.',
    hint_ar: 'OTHMODE متاحة دائماً. اكتب othmode داخل أمر Claude لتفعيلها لهذا الأمر فقط.'
  };
}

module.exports = { isActivated: isActivated, classify: classify, availability: availability, KEYWORD: KEYWORD };
