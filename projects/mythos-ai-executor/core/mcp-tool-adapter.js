'use strict';
// =====================================================
// Mythos Orchestration Core — MCP tool adapter (Phase 2, capability L)
// projects/mythos-ai-executor/core/mcp-tool-adapter.js
//
// docs/MYTHOS_AI_ORCHESTRATOR_MASTER_VISION.md §8: MCP is PLANNED, and
// "Mythos does not currently depend on MCP." This module is the smallest
// coherent precursor — a read-only reshaping of the existing tool
// registry into the Model Context Protocol's tools/list and tools/call
// wire shapes (name/description/inputSchema, content-array results). It
// adds no dependency, no server, no transport: nothing here talks MCP
// over the wire, it only makes the registry expressible in that shape
// on demand.
//
// core/tool-registry.js is a protected/caged path (governance-verify.js
// PROTECTED_PATHS) — this adapter only calls its public exports
// (discoverTools/getTool/invoke) and never edits it.
// =====================================================

var tools = require('./tool-registry');

// Tool definitions carry no free-text description field (see
// config/tools.json). MCP's tools/list expects one, so this derives a
// short, deterministic sentence from metadata that already exists —
// no new authored content to keep in sync by hand.
function describeTool(def) {
  var caps = (def.capabilities || []).join(', ') || 'none';
  return def.name + ' (capabilities: ' + caps + '; policy: ' + def.policy_class +
    '; risk: ' + def.risk + ')';
}

// MCP inputSchema is a JSON Schema object, same family the registry
// already validates input_schema against (lib/schema.js) — so this is a
// direct passthrough, not a translation.
function toMcpSchema(inputSchema) {
  return inputSchema || { type: 'object', properties: {} };
}

// MCP tools/list response: one entry per DISCOVERABLE tool (mirrors
// discoverTools() — declarative-only and unavailable tools are still
// listed, exactly as the registry already exposes them).
function listMcpTools() {
  return tools.discoverTools().map(function (d) {
    var def = tools.getTool(d.name);
    return {
      name: d.name,
      description: describeTool(d),
      inputSchema: toMcpSchema(def && def.input_schema)
    };
  });
}

// MCP tools/call response shape: { content: [...], isError }. Grant
// checking and schema validation are unchanged — this only reshapes
// tools.invoke's { ok, result, error } into MCP's content-array
// convention, it does not loosen or bypass either check.
function callMcpTool(name, args, grants) {
  var outcome = tools.invoke(name, args, grants);
  if (!outcome.ok) {
    return { content: [{ type: 'text', text: outcome.error }], isError: true };
  }
  return {
    content: [{ type: 'text', text: JSON.stringify(outcome.result) }],
    isError: false
  };
}

module.exports = {
  listMcpTools: listMcpTools,
  callMcpTool: callMcpTool
};
