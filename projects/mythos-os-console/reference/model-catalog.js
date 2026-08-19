'use strict';
/* =====================================================
   MYTHOS OS COMMAND CENTER — model catalog
   projects/mythos-os-console/reference/model-catalog.js

   MOS-v2 M-05: the server-controlled model catalog. Before this stage,
   handleStartMission accepted any free-form string (up to 100 characters)
   as `model` and relayed it verbatim to the executor, which in turn passed
   it straight to the provider (e.g. `claude --model <id>` in
   providers/claude-code.js). That meant an arbitrary string typed into the
   browser could reach a real subprocess invocation with no server-side
   opinion about whether it named a real, supported model at all.

   This file is the one place that enumerates what a model actually is,
   for this console. server.js consults it (isAllowed) to validate any
   caller-supplied model before it is ever relayed upstream, and exposes
   it (enabledModels) through GET /api/dispatcher so the browser can
   render a real, closed choice instead of a free-text field. No other
   file defines a catalog of its own -- this is the single source of
   truth, on both the validation path and the serving path.

   Adding a model here does not make it real -- the provider must
   actually support the id. Removing a model here does not delete the
   model anywhere -- it withdraws it from what this console permits and
   what it advertises. `enabled` is the only field the client is not
   handed; whether a model may be selected is decided here, once.
   ===================================================== */

// provider: the REAL_PROVIDERS entry (server.js) this model runs under.
// id: exactly what is forwarded as `model` to the executor -- must match
//   the identifier the provider itself expects (e.g. providers/claude-code.js
//   passes this straight to `claude --model <id>`; providers/openai-compat.js
//   forwards it to OmniRoute, defaulting to 'gpt-4o-mini' when null).
// capability: a short label for what the model is offered for -- shown in
//   the UI, never interpreted by the server.
// enabled: whether this entry is currently selectable/servable. A disabled
//   entry stays in CATALOG (so the mechanism and the intent are visible in
//   source) but is excluded from enabledModels() and therefore from both
//   /api/dispatcher's `models` field and isAllowed() -- it can never be
//   chosen from the browser and never reaches the executor while disabled.
var CATALOG = [
  { provider: 'claude-code', id: 'opus', label: 'Claude Opus',
    capability: 'architecture-security', enabled: true,
    recommended_task_types: ['architecture', 'security', 'review'] },
  { provider: 'claude-code', id: 'sonnet', label: 'Claude Sonnet',
    capability: 'implementation', enabled: true,
    recommended_task_types: ['implementation', 'integration', 'coding'] },
  { provider: 'claude-code', id: 'haiku', label: 'Claude Haiku',
    capability: 'tests-verification', enabled: true,
    recommended_task_types: ['testing', 'verification', 'reporting'] },
  { provider: 'openai-compat', id: 'gpt-4o-mini', label: 'OmniRoute gpt-4o-mini',
    capability: 'advisory', enabled: true,
    recommended_task_types: ['research', 'review', 'analysis'] },
  // Gemini has no credential configured anywhere in this repository (see
  // config/agents.json's own note) and must never be reachable from this
  // console. This single entry exists only to demonstrate the disabled-
  // state mechanism itself -- enabled: false keeps it out of
  // enabledModels(), out of /api/dispatcher's `models` field, and out of
  // isAllowed(), permanently, until a real credential exists AND this
  // flag is deliberately flipped. It must NEVER appear in API output
  // while disabled.
  { provider: 'gemini', id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro',
    capability: 'advisory', enabled: false,
    recommended_task_types: ['research', 'analysis'] }
];

function enabledModels() {
  return CATALOG.filter(function (m) { return m.enabled === true; });
}

// True iff an ENABLED catalog entry matches both provider and id exactly
// (case-sensitive, no coercion). A disabled entry -- even one whose
// provider/id matches exactly -- is never allowed.
function isAllowed(provider, modelId) {
  return enabledModels().some(function (m) { return m.provider === provider && m.id === modelId; });
}

module.exports = { CATALOG: CATALOG, enabledModels: enabledModels, isAllowed: isAllowed };
