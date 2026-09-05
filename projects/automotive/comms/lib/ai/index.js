'use strict';
// =====================================================
// MYTHOS AUTO auto-reply — reply generation (template first, AI opt-in)
// projects/automotive/comms/lib/ai/index.js
//
// Turns a classified customer message plus VERIFIED facts into one reply
// text. Two generators, selected per deployment (`auto_reply.ai.generator`):
//
//   template   deterministic, fr / ar / en, no network. The default and the
//              fallback of everything else.
//   advisory   the existing MYTHOS advisory boundary
//              (projects/mythos-ai-executor/providers/openai-compat.js →
//              OmniRoute → Claude). Same key file, same private base URL.
//              Off unless configured; the customer text is NOT sent to the
//              model unless `share_customer_text: true` — by default the
//              model only receives the intent, the entities the customer
//              wrote and the verified facts.
//
// Whatever generates the text, `factGuard` reads it last: a reply that
// states a price, a stock level, a delivery time, a compatibility or an
// order status the facts do not carry is REJECTED and the template answer
// is used instead. The AI can phrase; it cannot know.
//
// `generate(input) → Promise<{ text, generator, language, guard }>`
//   input = { intent, language, entities, facts, business, ai, customer_text }
// Never throws; a failed generator yields the template text.
// =====================================================

var path = require('path');

var MAX_REPLY = 900;
var ADVISORY_TIMEOUT_S = 20;

// Replies that need no business fact. `{name}` is the project's display
// name, `{vehicle}` what the customer wrote (model + year), `{parts}` the
// part words the customer used.
var TEMPLATES = {
  fr: {
    greeting: 'Bonjour et bienvenue chez {name}. Pour vous aider, indiquez-nous votre modèle de véhicule (ou VIN) et la pièce recherchée.',
    vehicle_identification: 'Merci, bien noté : {vehicle}. Quelle pièce recherchez-vous pour ce véhicule ?',
    ambiguous: 'Merci pour votre message. Pour vous répondre au mieux, précisez votre modèle de véhicule (ou VIN) et la pièce recherchée.',
    handoff_ack: 'Merci pour votre message. Un conseiller {name} vous répond dès que possible.',
    part_ack: 'Merci, bien noté : {parts}{for_vehicle}. Un conseiller {name} vérifie la disponibilité et le prix et vous répond dès que possible.'
  },
  ar: {
    greeting: 'مرحبا بيك في {name}. باش نعاونوك، ابعثلنا موديل الكرهبة (ولا VIN) والقطعة اللي تلوّج عليها.',
    vehicle_identification: 'شكرا، سجلنا: {vehicle}. شنية القطعة اللي تحب عليها للكرهبة هذي؟',
    ambiguous: 'شكرا على الرسالة. باش نجاوبوك، ابعثلنا موديل الكرهبة (ولا VIN) والقطعة اللي تلوّج عليها.',
    handoff_ack: 'شكرا على الرسالة. مسؤول {name} يجاوبك في أقرب وقت.',
    part_ack: 'شكرا، سجلنا: {parts}{for_vehicle}. مسؤول {name} يثبّت في التوفّر والسعر ويجاوبك في أقرب وقت.'
  },
  en: {
    greeting: 'Hello and welcome to {name}. To help you, please send your vehicle model (or VIN) and the part you are looking for.',
    vehicle_identification: 'Thank you, noted: {vehicle}. Which part do you need for this vehicle?',
    ambiguous: 'Thank you for your message. To answer you properly, please send your vehicle model (or VIN) and the part you are looking for.',
    handoff_ack: 'Thank you for your message. A {name} advisor will get back to you as soon as possible.',
    part_ack: 'Thank you, noted: {parts}{for_vehicle}. A {name} advisor is checking availability and price and will get back to you as soon as possible.'
  }
};
var FOR_VEHICLE = { fr: ' pour {vehicle}', ar: ' لـ {vehicle}', en: ' for {vehicle}' };

function lang(l) { return TEMPLATES[l] ? l : 'fr'; }

function vehicleEcho(entities) {
  entities = entities || {};
  var parts = [];
  if (entities.vehicle_model) parts.push(String(entities.vehicle_model));
  if (entities.vehicle_year) parts.push(String(entities.vehicle_year));
  if (!parts.length && entities.vin) parts.push('VIN ' + String(entities.vin));
  return parts.join(' ');
}

function fill(tpl, vars) {
  return tpl.replace(/\{(\w+)\}/g, function (_, k) { return vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : ''; }).replace(/\s+/g, ' ').replace(/\s+([,.])/g, '$1').trim();
}

// template(kind, input) → string | null   (null when no template fits)
function template(kind, input) {
  input = input || {};
  var l = lang(input.language);
  var tpl = TEMPLATES[l][kind];
  if (!tpl) return null;
  var entities = input.entities || {};
  var veh = vehicleEcho(entities);
  var partsList = Array.isArray(entities.parts) ? entities.parts.slice(0, 4).join(', ') : '';
  if (kind === 'vehicle_identification' && !veh) return null;
  if (kind === 'part_ack' && !partsList) return null;
  var vars = {
    name: input.business && input.business.display_name ? input.business.display_name : 'MYTHOS AUTO',
    vehicle: veh,
    parts: partsList,
    for_vehicle: veh ? fill(FOR_VEHICLE[l], { vehicle: veh }) : ''
  };
  return fill(tpl, vars).slice(0, MAX_REPLY);
}

// ---------------------------------------------------------------- fact guard

// Claims a reply must not make without a fact behind it. Each pattern maps
// to the fact KIND that would justify it.
// Word boundaries are spelled out with Unicode classes: `\b` does not
// work next to accented or Arabic letters.
function claim(kind, fragments) {
  return { kind: kind, re: new RegExp('(?:^|[^\\p{L}\\p{N}])(?:' + fragments.join('|') + ')(?=$|[^\\p{L}\\p{N}])', 'iu') };
}
var CLAIMS = [
  claim('price', ['\\d{1,3}(?:[ .,]\\d{3})*(?:[.,]\\d{1,3})?\\s*(?:dt|tnd|dinars?|dinar|€|eur|euros?|\\$|usd|millimes?)', '(?:dt|tnd|€)\\s*\\d+', 'د\\.?ت', 'دينار', 'مليم']),
  claim('price', ['le prix est', 'prix\\s*:', 'coûte', 'coute', 'ça fait', 'ca fait', 'costs?', 'the price is', 'price\\s*:', '(?:السعر|الثمن)\\s*(?:هو|:)']),
  claim('stock', ['en stock', 'disponible imm[ée]diatement', 'nous avons en stock', 'we have (?:it )?in stock', 'in stock', 'available now', 'out of stock', 'rupture de stock', 'plus en stock', '[ée]puis[ée]', 'موجود(?:ة)? في المخزن', 'متوفر(?:ة)? حالا', 'مافماش في الستوك', 'مش متوفر']),
  claim('stock', ['livr(?:é|e|aison) (?:sous|en|dans) \\d+', 'delivery (?:in|within) \\d+', '\\d+\\s*(?:jours?|days?|heures?|hours?) (?:de livraison|delivery|ouvr)', 'توصيل في \\d+', 'في \\d+ (?:أيام|ايام|يوم)']),
  claim('vehicle', ['compatible avec', 'est compatible', 'convient (?:à|a|pour)', 's.adapte (?:à|a)', 'fits your', 'is compatible', 'compatible with', 'not compatible', 'pas compatible', 'incompatible', 'يمشي مع', 'تمشي مع', 'متوافق(?:ة)? مع', 'مش متوافق']),
  claim('order', ['votre commande (?:est|a été|sera)', 'commande (?:exp[ée]di[ée]e|livr[ée]e|confirm[ée]e)', 'your order (?:is|has|was|will)', 'order (?:shipped|delivered|confirmed)', 'طلبيتك (?:وصلت|تبعثت|خرجت|باش)'])
];

// factGuard(text, facts) → { ok, violations: [{ kind, claim }] }
//   `facts.available` lists the kinds the reply may talk about. A claim of
//   a kind that is not available is a violation.
function factGuard(text, facts) {
  var available = facts && Array.isArray(facts.available) ? facts.available : [];
  var violations = [];
  var t = String(text || '');
  CLAIMS.forEach(function (c) {
    if (available.indexOf(c.kind) !== -1) return;
    var m = c.re.exec(t);
    if (m) violations.push({ kind: c.kind, claim: m[0].slice(0, 40) });
  });
  return { ok: violations.length === 0, violations: violations };
}

// ------------------------------------------------------------ advisory (AI)

var SYSTEM_PROMPT = [
  'You write ONE short WhatsApp reply for an automotive spare-parts business.',
  'Rules, all mandatory:',
  '- Answer in the language given (fr = French, ar = Tunisian Arabic in Arabic script, en = English).',
  '- Use ONLY the facts listed under FACTS. If a fact is not listed, you do not know it.',
  '- NEVER state or imply a price, a stock level, an availability, a delivery time, a compatibility, a warranty or an order status that is not in FACTS. When the customer asks for one that is missing, say an advisor will confirm it.',
  '- NEVER invent part numbers, references, brands, promotions, opening hours, addresses or phone numbers.',
  '- Do not ask for payment details or any personal data beyond vehicle model, VIN and the part needed.',
  '- Maximum 3 sentences, plain text, no markdown, no emojis, no signature.',
  '- Output the reply text only.'
].join('\n');

function advisoryPrompt(input) {
  var e = input.entities || {};
  var facts = input.facts || {};
  var lines = [
    'LANGUAGE: ' + lang(input.language),
    'BUSINESS: ' + (input.business && input.business.display_name ? input.business.display_name : 'MYTHOS AUTO'),
    'INTENT: ' + (input.intent || 'ambiguous'),
    'CUSTOMER WROTE (entities only):',
    '  vehicle_model: ' + (e.vehicle_model || 'unknown'),
    '  vehicle_year: ' + (e.vehicle_year || 'unknown'),
    '  vin: ' + (e.vin ? 'given' : 'none'),
    '  parts: ' + (Array.isArray(e.parts) && e.parts.length ? e.parts.join(', ') : 'none'),
    '  reference: ' + (e.reference || 'none')
  ];
  if (input.ai && input.ai.share_customer_text === true && typeof input.customer_text === 'string') {
    lines.push('CUSTOMER TEXT: ' + input.customer_text.slice(0, 1000).replace(/\s+/g, ' '));
  }
  lines.push('FACTS (verified; nothing else exists):');
  var data = facts.data || {};
  var any = false;
  (facts.available || []).forEach(function (k) {
    var v = data[k];
    if (v === undefined) return;
    any = true;
    lines.push('  ' + k + ': ' + JSON.stringify(v).slice(0, 600));
  });
  if (!any) lines.push('  (none)');
  if (facts.missing && facts.missing.length) lines.push('MISSING (an advisor will confirm): ' + facts.missing.join(', '));
  return lines.join('\n');
}

function loadAdvisory() {
  return require(path.join(__dirname, '..', '..', '..', '..', 'mythos-ai-executor', 'providers', 'openai-compat'));
}

function advisory(input, deps) {
  var ai = input.ai || {};
  if (!ai.base_url || !ai.key_file) return Promise.resolve({ ok: false, reason: 'AI_NOT_CONFIGURED' });
  var provider;
  try { provider = deps && deps.provider ? deps.provider : loadAdvisory(); } catch (e) { return Promise.resolve({ ok: false, reason: 'AI_PROVIDER_UNAVAILABLE' }); }
  var task = { model: ai.model || undefined, timeout_seconds: ai.timeout_seconds || ADVISORY_TIMEOUT_S };
  var call;
  try {
    call = Promise.resolve(provider.run(task, advisoryPrompt(input), null, null, { systemPrompt: SYSTEM_PROMPT, baseUrl: ai.base_url, keyFile: ai.key_file }));
  } catch (e) { call = Promise.reject(e); }
  return call.then(function (r) {
    if (!r || !r.parsed || r.parsed.is_error) return { ok: false, reason: 'AI_ERROR' };
    var text = String(r.parsed.result || '').replace(/^\s*["“]|["”]\s*$/g, '').trim();
    if (!text) return { ok: false, reason: 'AI_EMPTY' };
    return { ok: true, text: text.slice(0, MAX_REPLY) };
  }, function () { return { ok: false, reason: 'AI_ERROR' }; });
}

// ------------------------------------------------------------------ generate

// The template kind for an intent that gets a reply without facts.
function templateKind(input) {
  var e = input.entities || {};
  switch (input.intent) {
    case 'greeting': return 'greeting';
    case 'vehicle_identification': return vehicleEcho(e) ? 'vehicle_identification' : 'ambiguous';
    case 'part_inquiry':
    case 'price_availability': return Array.isArray(e.parts) && e.parts.length ? 'part_ack' : 'handoff_ack';
    case 'ambiguous': return 'ambiguous';
    default: return 'handoff_ack';
  }
}

function generate(input, deps) {
  input = input || {};
  var kind = input.kind || templateKind(input);
  var fallback = template(kind, input) || template('handoff_ack', input);
  var out = { text: fallback, generator: 'template', language: lang(input.language), guard: { ok: true, violations: [] } };
  var guardT = factGuard(fallback, input.facts);
  if (!guardT.ok) { out.guard = guardT; out.text = template('handoff_ack', input); }

  var wantAi = input.ai && input.ai.generator === 'advisory';
  if (!wantAi) return Promise.resolve(out);
  return advisory(input, deps).then(function (r) {
    if (!r.ok) { out.ai_reason = r.reason; return out; }
    var guard = factGuard(r.text, input.facts);
    if (!guard.ok) { out.ai_reason = 'AI_FACT_GUARD'; out.guard = guard; return out; }
    return { text: r.text, generator: 'advisory', language: out.language, guard: guard };
  });
}

module.exports = {
  MAX_REPLY: MAX_REPLY,
  TEMPLATES: TEMPLATES,
  SYSTEM_PROMPT: SYSTEM_PROMPT,
  template: template,
  templateKind: templateKind,
  factGuard: factGuard,
  advisoryPrompt: advisoryPrompt,
  advisory: advisory,
  generate: generate
};
