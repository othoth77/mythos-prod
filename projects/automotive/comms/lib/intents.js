'use strict';
// =====================================================
// MYTHOS AUTO auto-reply — message understanding (deterministic)
// projects/automotive/comms/lib/intents.js
//
// Sorts a customer message into one of the handling boundaries of Issue
// #173 §7 and pulls out what the customer SAID (vehicle model, year, part
// words, an order/VIN-looking reference). It reads the message and the
// project's recognition vocabulary; it reads no catalogue, no stock, no
// price and returns no business fact. Everything it extracts is an echo of
// the customer's own words, which is the only thing a reply may repeat
// without a verified data source behind it.
//
// Intents (closed set, each one a distinct reply/handoff rule downstream):
//   greeting                 hello / thanks / bye, nothing else asked
//   vehicle_identification   a vehicle is named, no part is asked for
//   part_inquiry             a part is named (with or without a vehicle)
//   price_availability       price / stock / delivery words dominate
//   order_status             an order, delivery tracking or payment status
//   human_request            the customer asks for a person / a call
//   unsupported              non-text content, or nothing usable
//   ambiguous                text we cannot place → ask for details
//
// Languages: French, Tunisian Arabic (Arabic script and Latin "arabizi"),
// English. Detection is script/keyword based and only picks the reply
// language; it never changes the intent rules.
//
// Pure: no I/O, no dependency.
// =====================================================

var INTENTS = ['greeting', 'vehicle_identification', 'part_inquiry', 'price_availability', 'order_status', 'human_request', 'unsupported', 'ambiguous'];

// Vocabulary. Each entry is a regular expression fragment over the
// lower-cased, accent-stripped message.
var WORDS = {
  greeting: ['bonjour', 'bonsoir', 'salut', 'salam', 'slm', 'aslema', 'ahla', 'hello', 'hi', 'hey', 'merci', 'chokran', 'shukran', 'thanks', 'thank you', 'au revoir', 'bye', 'bslema', 'sabah el khir', 'sbah el khir', 'ca va', 'cv', 'labes', 'مرحبا', 'سلام', 'السلام عليكم', 'عسلامة', 'أهلا', 'اهلا', 'شكرا', 'يعيشك', 'صباح الخير', 'مساء الخير'],
  human: ['conseiller', 'responsable', 'humain', 'quelqu.?un', 'agent', 'appelez', 'appeler', 'appel', 'telephone', 'tel', 'numero', 'parler a', 'parler avec', 'rappel', 'human', 'someone', 'call me', 'speak to', 'talk to', 'manager', 'kalemni', 'kalmni', 'n7eb nkalem', 'nkalem', 'chkoun', 'موظف', 'مسؤول', 'نحكي مع', 'كلمني', 'اتصل', 'شكون', 'حد'],
  order: ['commande', 'ma commande', 'colis', 'livre', 'livree', 'livraison de ma', 'suivi', 'tracking', 'expedie', 'expedition', 'facture', 'paiement', 'paye', 'rembours', 'order', 'my order', 'shipment', 'shipped', 'delivered', 'invoice', 'payment', 'refund', 'commanda', 'talabiya', 'talab', 'wsel', 'wslet', 'طلبية', 'طلبيتي', 'الطلبية', 'وصلت', 'وصل', 'فاتورة', 'خلاص', 'دفعت'],
  price: ['prix', 'combien', 'tarif', 'cout', 'coute', 'devis', 'promo', 'reduction', 'disponible', 'dispo', 'stock', 'en stock', 'delai', 'quand', 'livraison', 'price', 'cost', 'how much', 'quote', 'available', 'availability', 'in stock', 'delivery', 'lead time', 'b9adech', 'bkadech', 'b9addech', 'kadech', '9adech', 'chhal', 'ch7al', 'famma', 'mawjoud', 'mawjouda', 'dispo', 'سعر', 'ثمن', 'بقداش', 'قداش', 'شحال', 'متوفر', 'موجود', 'فما', 'توصيل', 'وقتاش'],
  part: ['piece', 'pieces', 'filtre', 'filter', 'huile', 'plaquette', 'frein', 'disque', 'amortisseur', 'courroie', 'bougie', 'batterie', 'phare', 'feu', 'pare.?choc', 'parechoc', 'retroviseur', 'radiateur', 'pompe', 'injecteur', 'turbo', 'embrayage', 'kit', 'joint', 'capteur', 'sonde', 'alternateur', 'demarreur', 'roulement', 'rotule', 'triangle', 'silent.?bloc', 'cardan', 'boite', 'moteur', 'culasse', 'piston', 'segment', 'vanne egr', 'egr', 'echappement', 'pot', 'catalyseur', 'thermostat', 'durite', 'vitre', 'porte', 'capot', 'aile', 'calandre', 'essuie', 'balai', 'clim', 'compresseur', 'condenseur', 'part', 'parts', 'spare', 'brake', 'brakes', 'pad', 'pads', 'disc', 'shock', 'belt', 'spark', 'battery', 'headlight', 'bumper', 'mirror', 'radiator', 'pump', 'injector', 'clutch', 'sensor', 'alternator', 'starter', 'bearing', 'gearbox', 'engine', 'exhaust', 'windshield', 'wiper', 'pièce', 'plaquettes', 'disques', 'bougies', 'phares', 'feux', 'pompe a eau', 'filtre a air', 'filtre a huile', 'filtre a gasoil', 'filtre gasoil', 'filtre habitacle', 'qat3a', '9at3a', 'qit3a', '9it3a', 'pisa', 'pyesa', 'قطعة', 'قطع', 'فلتر', 'فيلتر', 'زيت', 'فرام', 'فرامل', 'بلاكات', 'ديسك', 'بطارية', 'باطري', 'فار', 'مرايا', 'راديتور', 'بومبة', 'موتور', 'محرك', 'كوراي', 'بوجي', 'امبرياج', 'امورتيسور', 'كابوت', 'باربريز']
};

var YEAR_RE = /\b(19[89][0-9]|20[0-4][0-9])\b/;
var VIN_RE = /\b[A-HJ-NPR-Z0-9]{17}\b/i;
var REFERENCE_RE = /\b(?:ref|réf|reference|référence|oem|n°|no|#)\s*[:.]?\s*([A-Z0-9][A-Z0-9-]{4,24})\b/i;
var ARABIC_RE = /[\u0600-\u06FF]/;
var MAX_ECHO = 60;

// Lower-case + strip accents, keep Arabic letters as they are.
function fold(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Arabic entries also match with the definite article (ال) attached.
function compile(list) {
  var alts = list.map(function (w) {
    var frag = /[.?]/.test(w) ? w : escapeRe(w);
    return ARABIC_RE.test(w) ? '(?:ال)?' + frag : frag;
  });
  return new RegExp('(?:^|[^a-z0-9\\u0600-\\u06FF])(?:' + alts.join('|') + ')(?=$|[^a-z0-9\\u0600-\\u06FF])', 'i');
}

var RE = {};
Object.keys(WORDS).forEach(function (k) { RE[k] = compile(WORDS[k]); });

function count(re, text) {
  var g = new RegExp(re.source, 'gi');
  var n = 0;
  while (g.exec(text)) { n++; if (n > 50) break; }
  return n;
}

// Reply language: Arabic script → ar when the project speaks it; English
// when the text is plainly English and the project offers it; else the
// project's first language, else French.
function language(text, languages) {
  languages = Array.isArray(languages) ? languages.map(function (l) { return String(l).toLowerCase().slice(0, 2); }) : [];
  var has = function (l) { return languages.indexOf(l) !== -1; };
  if (ARABIC_RE.test(text) && (has('ar') || !languages.length)) return 'ar';
  var folded = fold(text);
  if (/\b(hello|hi|hey|please|thanks|thank you|price|part|available|order|need|how much)\b/.test(folded) && has('en') && !/\b(bonjour|bonsoir|prix|piece|pieces|merci|svp|commande)\b/.test(folded)) return 'en';
  if (has('fr')) return 'fr';
  return languages.length ? languages[0] : 'fr';
}

// Vehicle model from the project's recognition vocabulary — a name the
// customer wrote, matched case-insensitively, never guessed.
function vehicle(text, models) {
  var folded = fold(text);
  var out = { model: null, year: null, vin: null };
  (Array.isArray(models) ? models : []).forEach(function (m) {
    if (out.model) return;
    var fm = fold(m);
    if (fm && new RegExp('(?:^|[^a-z0-9])' + escapeRe(fm) + '(?=$|[^a-z0-9])').test(folded)) out.model = String(m).slice(0, MAX_ECHO);
  });
  var y = YEAR_RE.exec(folded);
  if (y) out.year = y[1];
  var v = VIN_RE.exec(String(text));
  if (v) out.vin = v[0].toUpperCase();
  return out;
}

// The part words the customer used, as written (folded), for the echo.
function partWords(text) {
  var folded = fold(text);
  var g = new RegExp(RE.part.source, 'gi');
  var found = [];
  var m;
  while ((m = g.exec(folded)) && found.length < 4) {
    var w = m[0].replace(/^[^a-z0-9\u0600-\u06FF]+/, '').trim();
    if (w && found.indexOf(w) === -1) found.push(w.slice(0, MAX_ECHO));
  }
  return found;
}

// classify(text, o) → { intent, language, entities, signals }
//   o = { content_type, attachments, vehicle_models, languages }
function classify(text, o) {
  o = o || {};
  var ct = o.content_type || 'text';
  var raw = typeof text === 'string' ? text : '';
  var folded = fold(raw);
  var lang = language(raw, o.languages);
  var veh = vehicle(raw, o.vehicle_models);
  var parts = partWords(raw);
  var ref = REFERENCE_RE.exec(raw);
  var entities = { vehicle_model: veh.model, vehicle_year: veh.year, vin: veh.vin, parts: parts, reference: ref ? ref[1].toUpperCase().slice(0, 24) : null };
  var signals = {
    greeting: count(RE.greeting, folded),
    human: count(RE.human, folded),
    order: count(RE.order, folded),
    price: count(RE.price, folded),
    part: parts.length,
    vehicle: veh.model ? 1 : 0,
    words: folded ? folded.split(' ').length : 0
  };
  var result = function (intent) { return { intent: intent, language: lang, entities: entities, signals: signals }; };

  if (ct !== 'text' && !folded) return result('unsupported');
  if (!folded) return result('unsupported');
  if (signals.human) return result('human_request');
  if (signals.order && !signals.part) return result('order_status');
  if (signals.part && signals.price) return result('price_availability');
  if (signals.part) return result('part_inquiry');
  if (signals.price && (signals.vehicle || entities.reference)) return result('price_availability');
  if (signals.vehicle) return result('vehicle_identification');
  if (signals.greeting && signals.words <= 6) return result('greeting');
  if (signals.price) return result('price_availability');
  if (signals.greeting) return result('greeting');
  return result('ambiguous');
}

module.exports = {
  INTENTS: INTENTS,
  fold: fold,
  language: language,
  vehicle: vehicle,
  partWords: partWords,
  classify: classify
};
