// =====================================================
// MYTHOS OS — Plugin SDK Example (minimal / generic)
// examples/plugin-example.js
//
// Demonstrates the minimum viable plugin using the SDK.
// This file is for reference only — it is NOT loaded
// by the application.
//
// For a real plugin, copy this file to:
//   js/plugins/my-plugin.plugin.js
// and add a <script> tag to index.html after plugin-sdk.js.
// =====================================================

// Minimal shared plugin — one route, no storage
Plugin.create({
  id:      'hello',
  label:   'Hello',
  version: '1.0.0',
  type:    'shared'
})
.defineMenu({
  section: 'Général',
  order:   99,
  icon:    '👋'
})
.defineRoutes([
  { id: 'hello', label: 'Hello World', icon: '👋' }
])
.build();
