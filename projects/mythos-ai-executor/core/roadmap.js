'use strict';
// =====================================================
// Mythos Orchestration Core — roadmap reader and next-mission selector
// projects/mythos-ai-executor/core/roadmap.js
//
// Reads the committed Master Vision as the authoritative roadmap and
// turns it into machine-selectable capabilities. Mythos does NOT blindly
// execute every item: it scores what is left and answers one question —
// "what is the next highest-value SAFE implementation?"
//
// The vision document is the source of truth for intent; the repository
// is the source of truth for what actually exists. When they disagree the
// selector says so rather than trusting the prose.
// =====================================================

var fs = require('fs');
var path = require('path');

var selfImprove = require('./self-improve');

var VISION_REL = 'docs/MYTHOS_AI_ORCHESTRATOR_MASTER_VISION.md';
var ROADMAP_STATE_REL = 'projects/mythos-ai-executor/config/roadmap-state.json';

var STATUSES = ['IMPLEMENTED', 'PARTIAL', 'DESIGNED', 'PLANNED', 'CONCEPTUAL'];

// Ranking inputs. Value: how much the capability unlocks. Risk: how much
// blast radius a wrong implementation has. Lower risk wins ties.
var STATUS_READINESS = {
  PARTIAL: 5,      // already begun — cheapest to finish
  DESIGNED: 4,     // a committed design exists
  PLANNED: 3,      // agreed, no design
  CONCEPTUAL: 1,   // idea only — needs a human design decision first
  IMPLEMENTED: 0   // nothing to do
};

// Capabilities whose implementation would touch the governance surface.
// They are never autonomously selectable; they can only be proposed for
// human approval.
var GOVERNANCE_CAPABILITIES = [
  /policy/i, /secret/i, /sandbox/i, /governance/i, /approval/i,
  /budget/i, /audit/i, /credential/i
];

function visionPath(repoPath) { return path.join(repoPath, VISION_REL); }

// Parses "### A. Goal Engine — CONCEPTUAL / FUTURE" style headings.
function parseVision(repoPath) {
  var file = visionPath(repoPath);
  if (!fs.existsSync(file)) throw new Error('VISION_NOT_FOUND: ' + VISION_REL);
  var text = fs.readFileSync(file, 'utf8');
  var lines = text.split('\n');
  var caps = [];
  lines.forEach(function (line, i) {
    var m = /^###\s+([A-Z]{1,2})\.\s+(.+?)\s+[—–-]\s+(.+)$/.exec(line.trim());
    if (!m) return;
    var statusText = m[3].toUpperCase();
    var status = null;
    // The first status word wins: "MVP scope IMPLEMENTED; routing PLANNED"
    // is PARTIAL, which the explicit check below catches first.
    if (/PARTIAL|PRECURSOR|MVP SCOPE IMPLEMENTED|TASK-LEVEL IMPLEMENTED|PRACTICE IMPLEMENTED/.test(statusText) ||
        (/IMPLEMENTED/.test(statusText) && /(PLANNED|DESIGNED)/.test(statusText))) {
      status = 'PARTIAL';
    } else {
      for (var s = 0; s < STATUSES.length; s++) {
        if (statusText.indexOf(STATUSES[s]) !== -1) { status = STATUSES[s]; break; }
      }
    }
    if (!status) status = 'PLANNED';
    // The vision names a delivery phase for most capabilities ("PLANNED
    // (Phase 2)"). Earlier phases are nearer-term value, which is a signal
    // the DOCUMENT provides rather than an implementer's preference.
    var phaseM = /PHASE\s*(\d+)/.exec(statusText);
    var phase = phaseM ? parseInt(phaseM[1], 10) : null;
    // Collect the paragraph under the heading as the description.
    var desc = [];
    for (var j = i + 1; j < lines.length && !/^###\s/.test(lines[j]) && desc.length < 6; j++) {
      if (lines[j].trim()) desc.push(lines[j].trim());
    }
    caps.push({
      key: m[1], title: m[2].trim(), status: status, status_text: m[3].trim(),
      phase: phase,
      description: desc.join(' ').slice(0, 800), line: i + 1
    });
  });
  if (!caps.length) throw new Error('VISION_UNPARSEABLE: no "### X. Name — STATUS" capability headings found');
  return caps;
}

// Operator-maintained overrides + the campaign's own progress record.
// Autonomous runs may append evidence here; they may not invent an
// IMPLEMENTED status without a commit to point at.
function readRoadmapState(repoPath) {
  var file = path.join(repoPath, ROADMAP_STATE_REL);
  if (!fs.existsSync(file)) return { capabilities: {} };
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return { capabilities: {}, __parseError: e.message };
  }
}

function writeRoadmapState(repoPath, state) {
  var file = path.join(repoPath, ROADMAP_STATE_REL);
  // The config directory may not exist yet in a fresh checkout or worktree;
  // recording progress must not fail for that reason.
  fs.mkdirSync(path.dirname(file), { recursive: true });
  state.updated_at = new Date().toISOString();
  fs.writeFileSync(file, JSON.stringify(state, null, 2) + '\n', 'utf8');
  return file;
}

function isGovernanceCapability(cap) {
  var hay = cap.title + ' ' + cap.description;
  return GOVERNANCE_CAPABILITIES.some(function (re) { return re.test(hay); });
}

// Merges vision + recorded state into the live roadmap view.
function roadmap(repoPath) {
  var caps = parseVision(repoPath);
  var state = readRoadmapState(repoPath);
  return caps.map(function (c) {
    var recorded = (state.capabilities || {})[c.key];
    return Object.assign({}, c, {
      recorded_status: recorded ? recorded.status : null,
      evidence: recorded ? recorded.evidence || null : null,
      effective_status: recorded && recorded.status ? recorded.status : c.status,
      governance: isGovernanceCapability(c)
    });
  });
}

// Scores the remaining work and returns candidates, best first. A
// candidate is only `selectable` when it is safe for autonomous work:
// not governance, not conceptual (needs a human design decision), and not
// already implemented.
function candidates(repoPath) {
  return roadmap(repoPath).map(function (c) {
    var readiness = STATUS_READINESS[c.effective_status] === undefined
      ? 1 : STATUS_READINESS[c.effective_status];
    var reasons = [];
    var selectable = true;
    if (c.effective_status === 'IMPLEMENTED') {
      selectable = false; reasons.push('already implemented');
    }
    if (c.governance) {
      selectable = false;
      reasons.push('touches the governance surface — human approval required, never self-authorised');
    }
    if (c.effective_status === 'CONCEPTUAL') {
      selectable = false;
      reasons.push('conceptual only — needs a human design decision before implementation');
    }
    // An owner who denied a capability's approval must not have the loop
    // hand them the same request every cycle. OWNER_DENIED is a persisted
    // human decision: it makes the capability unselectable until a human
    // records a different status, and it is deliberately NOT a claim that
    // the capability is implemented or impossible.
    if (c.effective_status === 'OWNER_DENIED') {
      selectable = false;
      reasons.push('the owner denied this capability\'s approval request — only a human may re-open it');
    }
    // AUTO_DENIED is the unattended policy's own refusal, kept DISTINCT from
    // OWNER_DENIED on purpose: one is a human verdict, the other is a machine
    // declining to act without one. Collapsing them would let the loop's own
    // denials masquerade as owner decisions in the roadmap.
    if (c.effective_status === 'AUTO_DENIED') {
      selectable = false;
      reasons.push('denied automatically by unattended policy — a human may re-open it');
    }
    // Score = readiness, minus a penalty for late delivery phases. An
    // unphased capability sits between: it is neither promised early nor
    // deferred late.
    var phasePenalty = c.phase === null || c.phase === undefined ? 0.5
      : Math.min(2, Math.max(0, (c.phase - 2) * 0.4));
    return Object.assign({}, c, {
      readiness: readiness, selectable: selectable,
      blocked_reasons: reasons,
      score: selectable ? Math.round((readiness - phasePenalty) * 100) / 100 : 0
    });
  }).sort(function (a, b) {
    if (b.score !== a.score) return b.score - a.score;
    return a.key.localeCompare(b.key);   // deterministic tie-break
  });
}

// The selector: the next highest-value SAFE capability, or an explicit
// explanation of why nothing is selectable.
function selectNext(repoPath, opts) {
  opts = opts || {};
  var all = candidates(repoPath);
  var exclude = opts.exclude || [];
  var pick = all.filter(function (c) {
    return c.selectable && exclude.indexOf(c.key) === -1;
  })[0];
  if (!pick) {
    var governanceBlocked = all.filter(function (c) { return c.governance && c.effective_status !== 'IMPLEMENTED'; });
    return {
      selected: null,
      reason: 'no autonomously selectable capability remains' +
        (governanceBlocked.length ? ' (' + governanceBlocked.length +
          ' remaining capabilities require human approval)' : ''),
      approval_candidates: governanceBlocked.map(function (c) { return c.key + '. ' + c.title; }),
      considered: all.length
    };
  }
  return {
    selected: pick,
    reason: 'highest-value safe capability: ' + pick.key + '. ' + pick.title +
      ' (' + pick.effective_status + ', readiness ' + pick.readiness + ')',
    runners_up: all.filter(function (c) { return c.selectable && c.key !== pick.key; })
      .slice(0, 3).map(function (c) { return c.key + '. ' + c.title; }),
    considered: all.length
  };
}

// Records progress with EVIDENCE. A status may never be advanced to
// IMPLEMENTED without a commit to point at — the roadmap cannot be
// marked done by assertion.
function recordProgress(repoPath, key, status, evidence) {
  if (STATUSES.indexOf(status) === -1 &&
      ['IN_PROGRESS', 'VALIDATED', 'OWNER_DENIED', 'AUTO_DENIED'].indexOf(status) === -1) {
    throw new Error('ROADMAP_UNKNOWN_STATUS: ' + String(status).slice(0, 40));
  }
  if (['IMPLEMENTED', 'VALIDATED'].indexOf(status) !== -1) {
    if (!evidence || !evidence.commit || !evidence.tests) {
      throw new Error('ROADMAP_EVIDENCE_REQUIRED: marking ' + key + ' ' + status +
        ' needs { commit, tests } — the roadmap is never marked done by assertion');
    }
  }
  var state = readRoadmapState(repoPath);
  state.capabilities = state.capabilities || {};
  state.capabilities[key] = {
    status: status,
    evidence: evidence || null,
    recorded_at: new Date().toISOString()
  };
  writeRoadmapState(repoPath, state);
  return state.capabilities[key];
}

// Builds the mission spec for a selected capability. Scope paths are
// checked against the governance surface before anything is proposed.
function missionSpecFor(capability, opts) {
  opts = opts || {};
  var scope = opts.scope_paths || [];
  var violations = scope.filter(selfImprove.isProtectedPath);
  if (violations.length) {
    throw new Error('ROADMAP_GOVERNANCE_SCOPE: refusing a mission scoped at the governance surface: ' +
      violations.join(', '));
  }
  var objective = 'Implement the next roadmap capability: ' + capability.key + '. ' +
    capability.title + ' (' + capability.effective_status + '). ' +
    (capability.description || '').slice(0, 400);
  return {
    capability_key: capability.key,
    objective: objective,
    risk: capability.governance ? 'high' : (capability.effective_status === 'PARTIAL' ? 'low' : 'medium'),
    budget_estimate_usd: 0,   // development work spends no money; agents run on subscription quota
    acceptance_criteria: [
      'the change exists in an isolated worktree on its own branch',
      'targeted tests pass and are named in the report',
      'an independent reviewer approved the result',
      'the real diff touches no governance-protected path',
      'a commit exists and is verified against Git',
      'the roadmap entry is updated with commit + test evidence'
    ]
  };
}

module.exports = {
  VISION_REL: VISION_REL,
  ROADMAP_STATE_REL: ROADMAP_STATE_REL,
  STATUSES: STATUSES,
  parseVision: parseVision,
  roadmap: roadmap,
  candidates: candidates,
  selectNext: selectNext,
  recordProgress: recordProgress,
  readRoadmapState: readRoadmapState,
  writeRoadmapState: writeRoadmapState,
  isGovernanceCapability: isGovernanceCapability,
  missionSpecFor: missionSpecFor
};
