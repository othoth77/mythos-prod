'use strict';
/* =====================================================
   MYTHOS OS — module registry
   projects/mythos-os-console/reference/web/modules.js

   The registry is the scalability contract. The shell — sidebar,
   routing, page chrome, empty states — is driven entirely by this
   array. Adding a MYTHOS OS module means adding one entry here and one
   render function in app.js. It never means touching the shell, the
   navigation, the router, or mythos.css.

   Fields
     id       route segment; the URL is #/<id>
     label    sidebar and page title
     icon     one glyph, matching the .nav-btn .ico idiom in main.css
     section  sidebar grouping, rendered as a .mythos-nav-section
     state    'live'    the module reads real data and is built
              'planned' registered, deliberately not built
     source   where the module's data comes from, or would come from.
              Required for BOTH states: a planned module must name its
              future source, so the registry doubles as the honest
              answer to "what would it take to build this?"
     summary  one line, shown on the module's own surface

   Order within a section is the order shown.
   ===================================================== */

(function (root) {
  var MODULES = [
    {
      id: 'command-center',
      label: 'Command Center',
      icon: '◈',
      section: 'Overview',
      state: 'live',
      source: 'mythos-ai-executor /health, /tasks, /campaigns, /events',
      summary: 'Live state of the Mythos control plane in one screen.'
    },
    {
      id: 'goals',
      label: 'Goals',
      icon: '◎',
      section: 'Execution',
      state: 'live',
      source: 'mythos-ai-executor GET /campaigns, GET /campaigns/:id, POST /campaigns, POST /campaigns/:id/approvals/resolve',
      summary: 'Goal → proposed plan → human approval → dispatch. Nothing runs until the owner approves it.'
    },
    {
      id: 'missions',
      label: 'Missions',
      icon: '▶',
      section: 'Execution',
      state: 'live',
      source: 'mythos-ai-executor GET /tasks',
      summary: 'Every executor task, its state, provider and next action.'
    },
    {
      id: 'campaigns',
      label: 'Campaigns',
      icon: '☷',
      section: 'Execution',
      state: 'live',
      source: 'mythos-ai-executor GET /campaigns',
      summary: 'Multi-mission campaigns and where each one has reached.'
    },
    {
      id: 'agents',
      label: 'Agents',
      icon: '⚙',
      section: 'Execution',
      state: 'live',
      source: 'projects/mythos-ai-executor/config/agents.json',
      summary: 'The registered agents, their capabilities and execution authority.'
    },
    {
      id: 'providers',
      label: 'Providers',
      icon: '⇄',
      section: 'Execution',
      state: 'live',
      source: 'projects/mythos-ai-executor/config/router.json + agents.json',
      summary: 'Provider routing and the fallback policy that governs it.'
    },
    {
      id: 'budget',
      label: 'Budget',
      icon: '◴',
      section: 'Execution',
      state: 'live',
      source: 'mythos-ai-executor GET /budget/:project',
      summary: 'Per-project budget ledger, reservations and spend.'
    },
    {
      id: 'roadmap',
      label: 'Roadmap',
      icon: '⚑',
      section: 'Knowledge',
      state: 'live',
      source: 'projects/mythos-ai-executor/config/roadmap-state.json',
      summary: 'Capability status as the executor itself records it.'
    },
    {
      id: 'memory',
      label: 'Memory',
      icon: '◉',
      section: 'Knowledge',
      state: 'planned',
      source: 'projects/personal-intelligence — MPI runtime; no read API is exposed to this host yet',
      summary: 'Provider-independent project memory: decisions, constraints, lessons.'
    },
    {
      id: 'audit',
      label: 'Audit',
      icon: '≣',
      section: 'Governance',
      state: 'live',
      source: 'mythos-ai-executor GET /events',
      summary: 'The append-only event trail, newest first.'
    },
    {
      id: 'governance',
      label: 'Governance',
      icon: '⚖',
      section: 'Governance',
      state: 'planned',
      source: 'projects/mythos-ai-executor/service/governance-verify.js + config/policy.json — CLI only today, no read endpoint',
      summary: 'Execution levels, policy rules and the invariants that enforce them.'
    },
    {
      id: 'approvals',
      label: 'Approvals',
      icon: '✓',
      section: 'Governance',
      state: 'planned',
      source: 'projects/mythos-ai-executor/service/mythos-governance-approve.js — an owner-operated CLI, deliberately not a web surface',
      summary: 'Pending LEVEL_3 decisions awaiting the owner.'
    },
    {
      id: 'secrets',
      label: 'Secrets',
      icon: '⚿',
      section: 'Platform',
      state: 'planned',
      source: 'aut_secret_references (metadata only) — projects/automation/database/control-plane-schema.sql, not deployed',
      summary: 'Secret references and rotation state. Metadata only, never a value.'
    },
    {
      id: 'sandbox',
      label: 'Sandbox',
      icon: '▦',
      section: 'Platform',
      state: 'planned',
      source: 'projects/mythos-ai-executor/core/worktrees.js — worktree lifecycle is not currently reported over HTTP',
      summary: 'Isolated worktrees a mission is allowed to touch.'
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: '✲',
      section: 'Platform',
      state: 'planned',
      source: 'This console holds no configuration. Settings would edit executor config, which is a write surface and out of scope by design.',
      summary: 'Console and control-plane configuration.'
    }
  ];

  var SECTIONS = [];
  MODULES.forEach(function (m) {
    if (SECTIONS.indexOf(m.section) === -1) SECTIONS.push(m.section);
  });

  function byId(id) {
    for (var i = 0; i < MODULES.length; i++) {
      if (MODULES[i].id === id) return MODULES[i];
    }
    return null;
  }

  var registry = {
    modules: MODULES,
    sections: SECTIONS,
    byId: byId,
    defaultId: MODULES[0].id
  };

  if (typeof module === 'object' && module.exports) module.exports = registry;
  else root.MythosModules = registry;
}(typeof window !== 'undefined' ? window : this));
