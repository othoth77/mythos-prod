// =====================================================
// OTH-K9 — multilingual tokenization/search regression suite
// tests/othk-9-multilingual-search-test.js
//
// Regression for the MCP-PROMOTE-4 finding: lib/search.js's tokenizer was
// Latin-only (split(/[^a-z0-9]+/)), so any all-non-Latin-script document
// (confirmed with three real, promoted Arabic claims) produced zero tokens,
// buildIndex() dropped it from the index entirely, and it became permanently
// unsearchable regardless of query — independent of the store, the facade
// cache, or MCP.
//
// This suite is offline and uses only synthetic/temporary fixtures — never
// the real canonical store at /home/deploy/othk-store, never the real
// extraction run. §6 uses the exact statement text of the three real
// promoted claims as fixture content (not the real records themselves) so
// the scenario this suite protects against is the literal one that failed.
// =====================================================
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const BASE = path.join(__dirname, '..', 'projects', 'oth-knowledge');

const api = require(path.join(BASE, 'lib/api.js'));
const searchLib = require(path.join(BASE, 'lib/search.js'));

let passed = 0, failed = 0;
function ok(v, label) {
  if (v) { passed++; console.log('  PASS ' + label); }
  else { failed++; console.log('  FAIL ' + label); }
}
function tmpRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'othk-multi-search-')); }
const CAP = '2026-08-19T12:00:00Z';
const PROV = { source_class: 'manual', source_reference: 'othk-9/fixture', captured_at: CAP };

console.log('§1 tokenize() — direct unit checks');
{
  const t = searchLib.tokenize;

  // 1. Arabic
  ok(t('مشروع تربية النحل').indexOf('النحل') !== -1, 'Arabic: "مشروع تربية النحل" tokenizes "النحل"');

  // 2. Arabic phrase
  ok(t('يتم حصاد العسل عادة').indexOf('العسل') !== -1, 'Arabic: "يتم حصاد العسل عادة" tokenizes "العسل"');

  // 3. English (regression baseline)
  ok(t('Bee farming project').indexOf('farming') !== -1, 'English: "Bee farming project" tokenizes "farming"');

  // 4. French
  ok(t('production de miel').indexOf('miel') !== -1, 'French: "production de miel" tokenizes "miel"');

  // 5. French accents
  const frAccent = t('élevage des abeilles');
  ok(frAccent.indexOf('abeilles') !== -1, 'French accents: "élevage des abeilles" tokenizes "abeilles"');
  ok(frAccent.indexOf('elevage') !== -1, 'French accents: accented "élevage" folds to unaccented "elevage"');

  // 6. Mixed Arabic/English
  const mixed = t('مشروع Bee Farm');
  ok(mixed.indexOf('مشروع') !== -1, 'Mixed script: Arabic token preserved in "مشروع Bee Farm"');
  ok(mixed.indexOf('bee') !== -1 && mixed.indexOf('farm') !== -1, 'Mixed script: English tokens preserved in "مشروع Bee Farm"');

  // 7. numbers — existing numeric behaviour unchanged
  ok(JSON.stringify(t('51.68.226.211')) === JSON.stringify(['51', '68', '226', '211']),
    'Numbers: IP-shaped string tokenizes exactly as before the fix');
  ok(JSON.stringify(t('PostgreSQL backup/restore strategies (2026)')) ===
     JSON.stringify(['postgresql', 'backup', 'restore', 'strategies', '2026']),
    'Numbers: mixed alnum/punctuation string unchanged from pre-fix output');
  // Arabic-Indic digits: previously invisible to [a-z0-9], now a Unicode
  // decimal-number token (\p{Nd}) rather than silently dropped.
  ok(t('٠١٢٣٤٥٦٧٨٩').length === 1, 'Numbers: Arabic-Indic digit run is preserved as one token, not dropped');

  // 8. punctuation must not destroy adjacent words (Arabic AND Latin)
  // Note: "آخر" (with combining madda) NFKD-decomposes and the madda is
  // then stripped as a combining mark, same as French "é" -> "e" -- so the
  // folded form is "اخر", not "آخر". That is the tokenizer's Unicode-fold
  // behaviour working as designed (§1's diacritics case below verifies the
  // same fold), not a regression from adjacent punctuation.
  const arComma = t('شيء، آخر'); // Arabic comma (U+060C) between two words
  ok(arComma.indexOf('شيء') !== -1 && arComma.indexOf('اخر') !== -1,
    'Arabic punctuation (،) splits without destroying either adjacent word');
  const arQuestion = t('هل هذا صحيح؟ نعم.'); // Arabic question mark (U+061F)
  ok(arQuestion.indexOf('صحيح') !== -1 && arQuestion.indexOf('نعم') !== -1,
    'Arabic punctuation (؟) splits without destroying adjacent words');
  const latPunct = t('word, other. more!');
  ok(latPunct.indexOf('word') !== -1 && latPunct.indexOf('other') !== -1 && latPunct.indexOf('more') !== -1,
    'Latin punctuation splits without destroying adjacent words');

  // 9. diacritics — Arabic tashkeel must not block matching
  // "الْعَسَل" (al-ʿasal with full diacritics) vs "العسل" (bare) should
  // fold to the same searchable token once combining marks are stripped.
  const withDiacritics = t('الْعَسَل لذيذ');
  const bare = t('العسل لذيذ');
  ok(JSON.stringify(withDiacritics) === JSON.stringify(bare),
    'Arabic diacritics (tashkeel) fold to the same tokens as the undiacritized form');
  ok(withDiacritics.indexOf('العسل') !== -1, 'Diacritized Arabic text remains searchable in normalized form');

  // 10. empty / punctuation-only strings — no crash, no meaningless tokens
  ok(JSON.stringify(t('')) === '[]', 'Empty string tokenizes to an empty array, no crash');
  ok(JSON.stringify(t('   ')) === '[]', 'Whitespace-only string tokenizes to an empty array');
  ok(JSON.stringify(t('...!!!؟؟؟---')) === '[]', 'Punctuation-only (Latin + Arabic) string tokenizes to an empty array');
  // String(null)/"String(undefined)" coerce to the literal words "null"/
  // "undefined" (tokenize()'s own first step is String(text)) -- the
  // requirement is "does not crash", not "produces no tokens".
  let threwOnNullish = false;
  let nullTokens = [], undefinedTokens = [];
  try { nullTokens = t(null); undefinedTokens = t(undefined); } catch (e) { threwOnNullish = true; }
  ok(!threwOnNullish && Array.isArray(nullTokens) && Array.isArray(undefinedTokens),
    'null/undefined input does not throw and always returns an array');
}

console.log('§2 English ASCII regression — byte-identical to the pre-fix tokenizer');
{
  // The exact pre-fix implementation, kept here only as a comparison
  // oracle for this test — NOT reintroduced into lib/search.js.
  function oldTokenize(text) {
    return String(text).toLowerCase().normalize('NFKD')
      .replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter((t) => t.length > 1);
  }
  const cases = [
    '51.68.226.211',
    'certbot dry run before certificate operation',
    'co-op self-hosted deploy',
    "l'élevage des abeilles est difficile",
    'VERIFIED FACT: the deployment account on the VPS is deploy',
    'PostgreSQL backup/restore strategies (2026)',
    'a1b2c3 test_underscore mixed-CASE',
  ];
  let allSame = true;
  for (const c of cases) {
    const same = JSON.stringify(oldTokenize(c)) === JSON.stringify(searchLib.tokenize(c));
    if (!same) { allSame = false; console.log('    MISMATCH on', JSON.stringify(c)); }
  }
  ok(allSame, 'every ASCII/English fixture tokenizes identically before and after the fix');
}

console.log('§3 end-to-end lexical/hybrid search — synthetic multilingual corpus (temp store, NOT the real canonical store)');
{
  const kb = api.open(tmpRoot());
  ok(tmpFixture(kb), 'temp store opened and fixtures inserted');

  function tmpFixture(kb) {
    kb.addFact({ statement: 'Bee farming project is profitable and environmentally useful.', confidence: 'HIGH', prov: PROV });
    kb.addFact({ statement: 'La production de miel augmente chaque année en Tunisie.', confidence: 'HIGH', prov: PROV });
    kb.addFact({ statement: "L'élevage des abeilles nécessite de la patience.", confidence: 'MEDIUM', prov: PROV });
    kb.addClaim({ statement: 'مشروع تربية النحل يُعتبر من المشاريع المربحة والمفيدة بيئياً.', asserted_by: 'test:fixture', prov: PROV });
    kb.addClaim({ statement: 'يتم حصاد العسل عادة في نهاية موسم التزهير.', asserted_by: 'test:fixture', prov: PROV });
    kb.addClaim({ statement: 'قد تحتاج إلى تغذية النحل في فترات نقص الرحيق.', asserted_by: 'test:fixture', prov: PROV });
    kb.addObservation({ statement: 'مشروع Bee Farm launched near Sfax this year.', observed_at: CAP, prov: PROV });
    return true;
  }

  const arHit1 = kb.search('النحل', { mode: 'lexical', filters: { kind: 'claim' }, limit: 10 });
  ok(arHit1.length >= 1, 'lexical search "النحل" (kind=claim) returns at least one hit');

  const arHit2 = kb.search('العسل', { mode: 'lexical', filters: { kind: 'claim' }, limit: 10 });
  ok(arHit2.length >= 1, 'lexical search "العسل" (kind=claim) returns at least one hit');

  const enHit = kb.search('farming', { mode: 'lexical', filters: { kind: 'fact' }, limit: 10 });
  ok(enHit.length >= 1 && /farming/i.test(enHit[0].text), 'lexical search "farming" (kind=fact) still returns the English fact');

  const frHit = kb.search('miel', { mode: 'lexical', filters: { kind: 'fact' }, limit: 10 });
  ok(frHit.length >= 1 && /miel/i.test(frHit[0].text), 'lexical search "miel" (kind=fact) returns the French fact');

  const frAccentHit = kb.search('abeilles', { mode: 'lexical', filters: { kind: 'fact' }, limit: 10 });
  ok(frAccentHit.length >= 1, 'lexical search "abeilles" matches the accented "élevage des abeilles" fact');

  const mixedArHit = kb.search('مشروع', { mode: 'lexical', filters: { kind: 'observation' }, limit: 10 });
  ok(mixedArHit.length >= 1, 'mixed-script observation found by its Arabic term "مشروع"');
  const mixedEnHit = kb.search('sfax', { mode: 'lexical', filters: { kind: 'observation' }, limit: 10 });
  ok(mixedEnHit.length >= 1, 'mixed-script observation found by its English term "Sfax"');

  // Hybrid mode (what MCP's knowledge_search actually uses by default)
  // must also surface the Arabic claims, not just lexical mode.
  const hybridAr = kb.search('العسل', { mode: 'hybrid', filters: { kind: 'claim' }, limit: 10 });
  ok(hybridAr.length >= 1, 'hybrid search (the mode MCP defaults to) also finds the Arabic claim');

  const allClaims = kb.search('النحل العسل تغذية', { mode: 'lexical', filters: { kind: 'claim' }, limit: 10 });
  ok(allClaims.length === 3, 'a broad Arabic query over all three claim terms returns all 3 claims (' + allClaims.length + ' found)');

  ok(kb.verify().ok, 'multilingual fixture store validates clean');
}

console.log('§4 the exact real-claim scenario — same statement text as the three promoted claims');
{
  // Uses the REAL statement text (public record content, already committed
  // to docs/AI_HANDOVER.md in MCP-PROMOTE-3/4) as fixture content in a
  // throwaway store. This never touches /home/deploy/othk-store and never
  // modifies the real promoted records.
  const kb = api.open(tmpRoot());
  const REAL_STATEMENTS = [
    'مشروع تربية النحل يُعتبر من المشاريع المربحة والمفيدة بيئياً، حيث يساهم في زيادة إنتاج العسل ومنتجات النحل الأخرى، كما يساعد في تلقيح النباتات وزيادة الإنتاج الزراعي.',
    'يتم حصاد العسل عادة في نهاية موسم التزهير.',
    'قد تحتاج إلى تغذية النحل في فترات نقص الرحيق (مثل فصل الشتاء).',
  ];
  for (const statement of REAL_STATEMENTS) {
    kb.addClaim({ statement, asserted_by: 'deepseek:assistant', prov: PROV });
  }
  const byBee = kb.search('النحل', { mode: 'hybrid', filters: { kind: 'claim' }, limit: 10 });
  ok(byBee.length >= 1, 'the real claim-1 wording is retrievable by "النحل"');
  const byHoney = kb.search('العسل', { mode: 'hybrid', filters: { kind: 'claim' }, limit: 10 });
  ok(byHoney.length >= 1, 'the real claim-2 wording is retrievable by "العسل"');
  const byFeeding = kb.search('تغذية', { mode: 'hybrid', filters: { kind: 'claim' }, limit: 10 });
  ok(byFeeding.length >= 1, 'the real claim-3 wording is retrievable by "تغذية"');
  const all = kb.search('النحل العسل تغذية', { mode: 'lexical', filters: { kind: 'claim' }, limit: 10 });
  ok(all.length === 3, 'MCP-knowledge_search-style query (kind=claim) returns all 3 real claim texts (' + all.length + '/3)');
}

console.log('');
console.log('othk-9: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
