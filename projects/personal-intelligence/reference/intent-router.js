// =====================================================
// Mythos Personal Intelligence — Intent Router Reference
// projects/personal-intelligence/reference/intent-router.js
//
// Illustrative, dependency-free stub for the multilingual intent
// normalisation and domain-routing concerns described in
// docs/MYTHOS_CHATBOT_ARCHITECTURE.md §5-§6 and docs/SKILLS_SUPERPOSER.md.
//
// This is NOT a natural-language-understanding implementation. It is a
// pattern-based reference sufficient to exercise the routing CONTRACT
// (detect language family, resolve active domain from available/permitted
// domains, refuse to fabricate unknown facts) in tests. Real intent
// understanding is delegated to a model call in any actual implementation
// (MPI-3/MPI-4) — this module never claims to replace that.
//
// STATUS: reference only. Exercised by tests/mpi-0-personal-intelligence-test.js.
// =====================================================
'use strict';

var ARABIC_RANGE = /[؀-ۿ]/;
// A short, illustrative set of Tunisian-Arabic-in-Latin-script markers —
// not exhaustive, not a claim of complete dialect coverage.
var TUNISIAN_LATIN_MARKERS = /\b(barcha|chnowa|kifech|9adem|3andi|eli|besh)\b/i;

function detectLanguageFamily(text) {
  if (typeof text !== 'string' || !text.trim()) return 'unknown';
  var hasArabicScript = ARABIC_RANGE.test(text);
  var hasLatin = /[a-zA-Z]/.test(text);
  if (hasArabicScript && hasLatin) return 'ar-fr-mixed';
  if (hasArabicScript) return 'ar'; // covers both MSA and Tunisian Arabic written in Arabic script
  if (TUNISIAN_LATIN_MARKERS.test(text)) return 'ar-TN'; // Tunisian Arabic in Latin script (Arabizi)
  if (/[àâçéèêëîïôûùüÿœæ]/i.test(text)) return 'fr';
  return 'en';
}

// -----------------------------------------------------------------------
// resolveActiveDomain(availableDomainIds, hintedDomainId)
//
// Given the domains a user is actually permitted/configured for
// (pi_user_domain_access), safely resolve which one the current request
// belongs to. Never invents a domain the user does not have access to.
// -----------------------------------------------------------------------
function resolveActiveDomain(availableDomainIds, hintedDomainId) {
  var available = availableDomainIds || [];
  if (available.length === 0) return { domainId: null, reason: 'NO_AVAILABLE_DOMAIN' };
  if (hintedDomainId) {
    // A hint was explicitly supplied — either honour it within the user's
    // authorised domains, or refuse. Never silently substitute a different
    // domain than what was asked for, even if only one is available.
    if (available.indexOf(hintedDomainId) !== -1) {
      return { domainId: hintedDomainId, reason: 'HINT_MATCHED' };
    }
    return { domainId: null, reason: 'HINTED_DOMAIN_NOT_AUTHORIZED' };
  }
  if (available.length === 1) {
    return { domainId: available[0], reason: 'ONLY_AVAILABLE_DOMAIN' };
  }
  return { domainId: null, reason: 'AMBIGUOUS_MULTIPLE_DOMAINS_REQUIRE_DISAMBIGUATION' };
}

// -----------------------------------------------------------------------
// Illustrative keyword hints — NOT the routing mechanism itself. Per
// docs/MYTHOS_CHATBOT_ARCHITECTURE.md §5, routing from keyword matching
// alone is explicitly insufficient in a real implementation; this map only
// supports the reference tests' domain-routing fixtures.
// -----------------------------------------------------------------------
var DOMAIN_KEYWORD_HINTS = {
  education: ['devoir', 'homework', 'lesson', 'fard', 'فرض', 'تلميذ'],
  automotive_workshop: ['devis', 'estimate', 'vehicle', 'car', 'سيارة', 'كوراندو']
};

function hintDomainFromKeywords(text) {
  if (typeof text !== 'string') return null;
  var lower = text.toLowerCase();
  var domains = Object.keys(DOMAIN_KEYWORD_HINTS);
  for (var i = 0; i < domains.length; i++) {
    var domainId = domains[i];
    var keywords = DOMAIN_KEYWORD_HINTS[domainId];
    for (var j = 0; j < keywords.length; j++) {
      if (lower.indexOf(keywords[j].toLowerCase()) !== -1) return domainId;
    }
  }
  return null;
}

// -----------------------------------------------------------------------
// normalizeIntent({ text, availableDomainIds })
//   -> { languageFamily, hintedDomainId, activeDomain, fabricated: false }
//
// Never fabricates unknown facts with false confidence
// (docs/MYTHOS_CHATBOT_ARCHITECTURE.md §6) — if the domain cannot be safely
// resolved, activeDomain.domainId is null with an explicit reason, never a
// guessed value.
// -----------------------------------------------------------------------
function normalizeIntent(input) {
  var languageFamily = detectLanguageFamily(input.text);
  var hintedDomainId = hintDomainFromKeywords(input.text);
  var activeDomain = resolveActiveDomain(input.availableDomainIds, hintedDomainId);
  return {
    languageFamily: languageFamily,
    hintedDomainId: hintedDomainId,
    activeDomain: activeDomain,
    fabricated: false
  };
}

module.exports = {
  detectLanguageFamily: detectLanguageFamily,
  resolveActiveDomain: resolveActiveDomain,
  hintDomainFromKeywords: hintDomainFromKeywords,
  normalizeIntent: normalizeIntent
};
