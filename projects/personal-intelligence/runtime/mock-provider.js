// =====================================================
// Mythos Personal Intelligence — MPI-4 M4-1 Offline Mock Provider
// projects/personal-intelligence/runtime/mock-provider.js
//
// A deterministic, fully offline provider implementation satisfying the
// provider-adapter contract ({ name, complete }). It exists so the entire
// MPI-4 pipeline can be built and tested without any model, network,
// credential, or data egress.
//
// Properties, all structural:
//   - PURE: requires only crypto; no http/https/net/tls/dns, no child
//     processes, no filesystem, no database, no content store
//   - DETERMINISTIC: the response text is a pure function of the request
//     (canonical-JSON SHA-256 + package shape counts) — identical input,
//     identical output, forever
//   - NON-GENERATIVE: it never invents content; it reports what it was
//     given. Nothing it returns can be mistaken for model output.
//   - failure injection (failWith) exists solely for adapter failure tests
// =====================================================
'use strict';

const crypto = require('crypto');

function sha16(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
}

function createMockProvider(opts) {
  const o = opts || {};
  return {
    name: 'mock-offline',
    async complete(request) {
      if (o.failWith) throw new Error(o.failWith);
      if (o.malformed) return { nonsense: true };
      const pkg = request.contextPackage;
      const text = 'MOCK-OFFLINE' +
        ' intent=' + (pkg.intent === null ? 'none' : pkg.intent) +
        ' facts=' + pkg.requiredFacts.length +
        ' prefs=' + pkg.relevantPreferences.length +
        ' orgRules=' + pkg.organisationRules.length +
        ' domainInstr=' + pkg.domainInstructions.length +
        ' skills=' + pkg.selectedSkills.length +
        ' entities=' + pkg.entities.length +
        ' conflicts=' + request.conflicts.length +
        ' msgChars=' + request.userMessage.length +
        ' hash=' + sha16({ pkg: pkg, userMessage: request.userMessage, constraints: request.constraints });
      return { text: text, meta: { deterministic: true, offline: true } };
    }
  };
}

module.exports = { createMockProvider: createMockProvider };
