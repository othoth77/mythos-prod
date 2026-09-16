'use strict';
// =====================================================
// Free LLM Resources — parser tests
// tests/free-llm-parser-test.js
//
// Runs the parser against a committed fixture snapshot of the upstream
// free-llm-api-resources README (tests/fixtures/free-llm-api-resources-
// readme.md) — fully offline, no network. Covers: section splitting,
// HTML-table parsing, the two-bullet-run separation that keeps a
// provider's "requires phone verification" notes out of its model list,
// requirement/data-policy detection, and api_model_id confidence.
//
// Run with: node tests/free-llm-parser-test.js
// =====================================================

var fs = require('fs');
var path = require('path');

var parser = require(path.join(__dirname, '..', 'projects', 'mythos-ai-executor', 'free-llm', 'parser'));

var passed = 0, failed = 0, failures = [];
function ok(cond, name) {
  if (cond) passed++;
  else { failed++; failures.push(name); console.error('FAIL: ' + name); }
}

var README = fs.readFileSync(path.join(__dirname, 'fixtures', 'free-llm-api-resources-readme.md'), 'utf8');
var catalog = parser.parseCatalog(README);
function byId(list, id) { return list.find(function (p) { return p.id === id; }); }

// ---------------------------------------------------------------- 1. sections
ok(catalog.free.length === 13, 'free section: 13 providers parsed (' + catalog.free.length + ')');
ok(catalog.trial.length === 13, 'trial section: 13 providers parsed (' + catalog.trial.length + ')');
ok(catalog.free.every(function (p) { return p.category === 'free' && p.access_type === 'free_tier'; }),
  'every free-section entry is tagged category=free, access_type=free_tier');
ok(catalog.trial.every(function (p) { return p.category === 'trial' && p.access_type === 'trial'; }),
  'every trial-section entry is tagged category=trial, access_type=trial');

// ---------------------------------------------------------------- 2. bullet-list parsing
var openrouter = byId(catalog.free, 'openrouter');
ok(!!openrouter && openrouter.models.length === 25, 'openrouter: 25 models from its bullet list');
ok(openrouter.homepage === 'https://openrouter.ai', 'openrouter: homepage link captured');
ok(openrouter.models[0].api_model_id === 'google/gemma-3-12b-it:free' &&
  openrouter.models[0].api_model_id_confidence === 'link_derived',
  'openrouter: per-model API slug derived from its deep link');

// ---------------------------------------------------------------- 3. HTML <table> parsing
var groq = byId(catalog.free, 'groq');
ok(!!groq && groq.models.length === 16, 'groq: 16 models from its <table>');
var allam = groq.models.find(function (m) { return m.name === 'Allam 2 7B'; });
ok(!!allam && allam.limits_text === '7,000 requests/day; 6,000 tokens/minute',
  '<br> inside a table cell becomes "; " in limits_text');
ok(allam.api_model_id === null && allam.api_model_id_confidence === 'unconfirmed',
  'a display-style table name ("Allam 2 7B") is correctly UNCONFIRMED as an API slug');
var literalGroqModel = groq.models.find(function (m) { return m.name === 'openai/gpt-oss-120b'; });
ok(!!literalGroqModel && literalGroqModel.api_model_id === 'openai/gpt-oss-120b' &&
  literalGroqModel.api_model_id_confidence === 'literal_text',
  'a slug-shaped table name ("openai/gpt-oss-120b") is confidently used as-is');

// ---------------------------------------------------------------- 4. notes-bullets vs model-bullets separation
var mistral = byId(catalog.free, 'mistral-la-plateforme');
ok(!!mistral && mistral.models.length === 1 && mistral.models[0].name === 'Open and Proprietary Mistral models',
  'mistral (la plateforme): the notes bullets ("* requires phone verification...") are NOT mistaken for models');
ok(mistral.requirements.indexOf('phone_verification') !== -1 && mistral.requirements.indexOf('data_training_opt_in') !== -1,
  'mistral (la plateforme): both requirement flags detected from its notes bullets');
ok(mistral.data_policy_note === 'Free tier (Experiment plan) requires opting into data training',
  'mistral (la plateforme): data policy note captured verbatim');
ok(mistral.models[0].api_model_id === null && mistral.models[0].api_model_id_confidence === 'unconfirmed',
  'mistral (la plateforme): a DOCUMENTATION deep link ("…/getting-started/models/models_overview/") is never mistaken for a model slug');

var codestral = byId(catalog.free, 'mistral-codestral');
ok(!!codestral && codestral.models.length === 1 && codestral.models[0].name === 'Codestral',
  'mistral (codestral): 3 notes bullets stay separate from the single "- Codestral" model bullet');
ok(codestral.requirements.indexOf('phone_verification') !== -1, 'mistral (codestral): phone requirement detected');

// ---------------------------------------------------------------- 5. labelled fields
ok(openrouter.limits_url === 'https://openrouter.ai/docs/api/reference/limits',
  'openrouter: **Limits:** link URL captured separately from its text');
var googleAi = byId(catalog.free, 'google-ai-studio');
ok(!!googleAi && /outside of the UK\/CH\/EEA\/EU/.test(googleAi.data_policy_note),
  'google ai studio: data-training policy sentence captured even with no **Limits:** label at all');
ok(googleAi.models.length === 12, 'google ai studio: 12 models parsed from its <table>');

var nlpCloud = byId(catalog.trial, 'nlp-cloud');
ok(!!nlpCloud && nlpCloud.credits_text === '$15' && nlpCloud.requirements.indexOf('phone_verification') !== -1,
  'nlp cloud (trial): an explicit **Requirements:** label is honoured');

// ---------------------------------------------------------------- 6. every entry always claims "signup"
ok(catalog.free.concat(catalog.trial).every(function (p) { return p.requirements.indexOf('signup') !== -1; }),
  'every provider carries the baseline "signup" requirement');

// ---------------------------------------------------------------- 7. no stray HTML tag lines leak into notes
var cloudflare = byId(catalog.free, 'cloudflare-workers-ai');
ok(!!cloudflare && cloudflare.models.length === 54 && cloudflare.data_policy_note === null,
  'cloudflare workers ai: the stray trailing </tbody></table> line in the source is ignored, not treated as a data-policy note');

// ---------------------------------------------------------------- 8. slugify / modality helpers
ok(parser.slugify('Mistral (La Plateforme)') === 'mistral-la-plateforme', 'slugify: punctuation and spaces collapse to hyphens');
ok(parser.guessModality('Whisper Large v3') === 'speech-to-text', 'guessModality: whisper -> speech-to-text');
ok(parser.guessModality('canopylabs/orpheus-arabic-saudi') === 'text-to-speech', 'guessModality: orpheus -> text-to-speech (not chat)');
ok(parser.guessModality('meta-llama/llama-prompt-guard-2-22m') === 'moderation', 'guessModality: prompt-guard -> moderation');
ok(parser.guessModality('Llama 3.3 70B Instruct') === 'chat', 'guessModality: default is chat');

var derived = parser.deriveApiModelId('Gemma 3 12B Instruct', 'https://openrouter.ai/google/gemma-3-12b-it:free');
ok(derived.api_model_id === 'google/gemma-3-12b-it:free' && derived.api_model_id_confidence === 'link_derived',
  'deriveApiModelId: a deep-link URL path is used over the display name');
var derivedNone = parser.deriveApiModelId('Llama 3.3 70B', null);
ok(derivedNone.api_model_id === null && derivedNone.api_model_id_confidence === 'unconfirmed',
  'deriveApiModelId: a spaced display name with no link is never invented into a slug');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failures.length) { console.log('Failures:\n  ' + failures.join('\n  ')); process.exit(1); }
process.exit(0);
