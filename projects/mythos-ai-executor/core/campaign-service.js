'use strict';
// =====================================================
// Mythos AI Executor — campaign service layer
// projects/mythos-ai-executor/core/campaign-service.js
//
// The surface the n8n MYTHOS bridge talks to. n8n is an AUTOMATION AND
// EVENT layer, never a second policy engine: every decision that matters
// — may this campaign continue, is an approval outstanding, is a mission
// blocked, which capability comes next, which provider and which tool
// grants a task gets — is made HERE and below, inside Mythos Core. n8n can
// only ask "continue" and read state. Nothing in a request payload can
// select a provider, an execution profile, a permission mode, a repo path
// or a capability, because none of those are read from the payload at all.
//
// Three rules this module exists to enforce:
//
//   1. NEVER a second campaign while one can still continue. submitGoal
//      returns the existing live campaign for the project instead of
//      creating a rival one; only an explicitly distinct project, or an
//      operator passing force_new against no live campaign, makes one.
//   2. NEVER bypass a persisted decision state. continueCampaign refuses
//      WAITING_FOR_APPROVAL and BLOCKED and reports why; it does not
//      "retry past" them. WAITING_FOR_QUOTA is resumable — that is the
//      documented recovery path, not a bypass.
//   3. NEVER two advances at once. A crash-safe lease (the same holder-id
//      and liveness logic the budget ledger uses) makes continuation
//      single-flight, so a retrying n8n trigger cannot start a parallel
//      campaign run over the same persisted state.
// =====================================================

var fs = require('fs');
var path = require('path');

var campaign = require('./campaign');
var runner = require('./campaign-runner');
var store = require('./store');
var budget = require('./budget');
var coreWiring = require('./core-wiring');
var decompose = require('./decompose');
var planner = require('./planner');
var domain = require('./domain');
var policyEngine = require('./policy-engine');

// States from which a continuation may legitimately proceed. Everything
// else is either terminal or a decision state someone must resolve.
var CONTINUABLE = ['PLANNING', 'READY', 'WAITING_FOR_QUOTA', 'PAUSED', 'REVIEWING', 'REPAIRING'];
// States that mean "a human owns this now". Never auto-continued.
var DECISION_STATES = ['WAITING_FOR_APPROVAL', 'BLOCKED'];
// A campaign in one of these can still take more work, so submitGoal must
// reuse it rather than opening a second one.
var LIVE_STATES = CONTINUABLE.concat(DECISION_STATES).concat(['RUNNING']);

var LOCK_STALE_MS = 45 * 60 * 1000;

// campaign.loadCampaign THROWS on a malformed id rather than returning null.
// This service is reached from HTTP, where a bad id is ordinary input, not an
// exceptional condition — an unhandled throw here would surface as a 500 and,
// worse, as an unhandled rejection inside a continuation. Absent or malformed
// both mean the same thing to a caller: no such campaign.
function safeLoad(campaignId) {
  try {
    return campaign.loadCampaign(campaignId);
  } catch (e) {
    return null;
  }
}

function lockPath(campaignId) {
  return path.join(campaign.campaignsRoot(), campaignId + '.run.lock');
}

// --- Single-flight continuation lease ---------------------------------------

function readLock(campaignId) {
  try {
    return JSON.parse(fs.readFileSync(lockPath(campaignId), 'utf8'));
  } catch (e) {
    return null;
  }
}

// A lock is only real if its holder is still alive. Reusing the ledger's
// holderStatus means a crashed or zombie ('Z') process cannot wedge a
// campaign forever, and an UNVERIFIABLE holder is treated as alive until
// it ages out — fail safe, never steal a live run.
function lockHolder(campaignId) {
  var lock = readLock(campaignId);
  if (!lock || !lock.holder_id) return null;
  var age = Date.now() - Date.parse(lock.acquired_at || 0);
  // holderStatus returns a STRING: 'alive' | 'dead' | 'unknown'. Treating it
  // as an object silently made every holder look alive, which would have
  // wedged a campaign permanently after any crash.
  var status;
  try {
    status = budget.holderStatus(lock.holder_id);
  } catch (e) {
    status = 'unknown';
  }
  if (status === 'dead') return null;      // crashed, zombie, or pid reused
  if (age > LOCK_STALE_MS) return null;    // an unverifiable holder ages out
  return lock;                             // 'alive' or 'unknown' → never stolen
}

function acquireLock(campaignId) {
  var held = lockHolder(campaignId);
  if (held) return { acquired: false, holder: held };
  try { fs.unlinkSync(lockPath(campaignId)); } catch (e) { /* nothing to clear */ }
  var lock = {
    campaign_id: campaignId,
    holder_id: budget.holderId(),
    acquired_at: new Date().toISOString()
  };
  try {
    var fd = fs.openSync(lockPath(campaignId), 'wx', 0o600);
    fs.writeSync(fd, JSON.stringify(lock));
    fs.closeSync(fd);
  } catch (e) {
    // Lost the race to another process between the check and the create.
    return { acquired: false, holder: readLock(campaignId) };
  }
  return { acquired: true, holder: lock };
}

function releaseLock(campaignId) {
  var lock = readLock(campaignId);
  if (lock && lock.holder_id && lock.holder_id !== budget.holderId()) return false;
  try { fs.unlinkSync(lockPath(campaignId)); } catch (e) { /* already gone */ }
  return true;
}

// --- Goal intake --------------------------------------------------------------

// --- Proposed-plan preview (MOS-v2 M-09) --------------------------------------

// Renders what the campaign WOULD do next, without doing any of it. The
// preview is built from the same two functions the loop itself uses —
// campaign.proposeNextMission (roadmap selection) and
// campaign.buildMissionSpec (the mission DAG) — so it is the real plan, not
// a second planner's guess about it. NOTHING is persisted as a mission,
// no goal entity is created, no task is queued: this is a read of the
// decision the loop is about to make.
//
// Every field is picked explicitly. Internal campaign state, instructions
// and runner-up selections are not part of a plan a human reviews.
var PREVIEW_TASK_FIELDS = ['key', 'title', 'task_type', 'depends_on', 'policy_classes'];

function planPreview(campaignId) {
  var preview = {
    available: false, reason: null, capability_key: null, title: null,
    objective: null, risk: null, acceptance_criteria: [], tasks: []
  };
  var proposed;
  try {
    proposed = campaign.proposeNextMission(campaignId);
  } catch (e) {
    // A planner that cannot answer is a reason to ASK, never a reason to
    // proceed: the campaign is parked either way, with the failure stated.
    preview.reason = 'the planner could not propose a mission: ' +
      String((e && e.message) || e).slice(0, 200);
    return preview;
  }
  if (!proposed || !proposed.proposal) {
    preview.reason = String((proposed && proposed.reason) ||
      'no capability is currently selectable').slice(0, 300);
    return preview;
  }
  var p = proposed.proposal;
  var spec;
  try {
    spec = campaign.buildMissionSpec(p, {});
  } catch (e) {
    preview.reason = 'the mission specification could not be built: ' +
      String((e && e.message) || e).slice(0, 200);
    return preview;
  }
  preview.available = true;
  preview.capability_key = p.capability_key || null;
  preview.title = String(spec.title || p.title || '').slice(0, 200);
  preview.objective = String(p.objective || '').slice(0, 400);
  preview.reason = String(p.reason || '').slice(0, 300);
  preview.risk = p.risk || null;
  preview.acceptance_criteria = [].concat(p.acceptance_criteria || []).slice(0, 10)
    .map(function (a) { return String(a).slice(0, 200); });
  preview.tasks = (spec.tasks || []).map(function (t) {
    var row = {};
    PREVIEW_TASK_FIELDS.forEach(function (f) {
      row[f] = f === 'depends_on' || f === 'policy_classes' ? [].concat(t[f] || []) : t[f];
    });
    return row;
  });
  return preview;
}

// --- AI-decomposed plan preview (MOS-v2 M-10) ---------------------------------

// Advisory metadata a decomposed plan carries per task. Present only when
// the planner offered it, so a template preview's tasks are byte-identical
// to what M-09 produced.
var ADVISORY_PREVIEW_FIELDS = ['recommended_model', 'execution_profile', 'expected_result', 'priority'];

// objective → planner model → parse → spec → planner.planFromSpec.
//
// The planner model produces DATA. What makes it a plan is the SAME
// validation every other plan passes: planner.planFromSpec applies the
// SPEC_TASK_FIELDS whitelist, the task-type enum, the derived policy
// classes and the DAG check, and planner.validatePlan puts every derived
// policy class through the real policy engine. Nothing here is a second
// validation path — it is the existing one, called with a spec that
// happens to have been written by a model.
//
// The goal entity handed to planFromSpec is TRANSIENT: it is built with
// domain.createGoal and deliberately not store.create'd, exactly as
// planPreview persists nothing. A preview is a read of a decision, not
// the decision.
//
// Resolves { preview, spec, advisory, provider, model }. Rejects with a
// typed error (PLANNER_UNAVAILABLE, PLANNER_OUTPUT_INVALID,
// PLANNER_PLAN_REFUSED, PLANNER_PLAN_INVALID). It NEVER resolves to a
// template plan: a roadmap plan presented as the AI's plan would be a
// plan dispatched under the belief that a human had reviewed it.
function decomposedPreview(objective, project, opts) {
  opts = opts || {};
  var planner_provider = null;
  var planner_model = null;
  return decompose.decomposeObjective(objective, {
    project: project,
    model: opts.model,
    runner: opts.runner
  }).then(function (out) {
    planner_provider = out.provider;
    planner_model = out.model;
    var mapped = decompose.toPlanSpec(decompose.parsePlannerOutput(out.text));
    var goal = domain.createGoal({
      text: objective, project: project,
      requested_by: 'decompose-preview'
    });
    var plan = planner.planFromSpec(goal, mapped.spec);
    var engine = policyEngine.createEngine();
    var vetted = planner.validatePlan(plan, function (req) {
      return engine.checkPolicy({ action_class: req.action_class, project: project });
    });
    if (!plan.valid || !vetted.valid) {
      var errs = plan.errors.concat(vetted.errors);
      var err = new Error('PLANNER_PLAN_INVALID: ' + errs.slice(0, 4).join('; '));
      err.code = 'PLANNER_PLAN_INVALID';
      throw err;
    }
    var advisoryByKey = (mapped.advisory && mapped.advisory.tasks) || {};
    return {
      spec: mapped.spec,
      advisory: mapped.advisory,
      provider: planner_provider,
      model: planner_model,
      preview: {
        available: true,
        // Named so a reviewer can never mistake a generated plan for the
        // roadmap's own selection.
        reason: 'proposed by the planner model and validated against schema, policy and dependencies',
        capability_key: null,
        title: String(plan.title || '').slice(0, 200),
        objective: String(objective).slice(0, 400),
        risk: null,
        acceptance_criteria: [],
        source: 'ai-decomposition',
        planner_provider: planner_provider,
        planner_model: planner_model,
        // The VALIDATED plan is what is shown, not the planner's raw
        // answer: the policy classes below are the ones planner.js
        // derived from each task type, not anything a model wrote.
        tasks: plan.tasks.map(function (t) {
          var row = {};
          PREVIEW_TASK_FIELDS.forEach(function (f) {
            row[f] = f === 'depends_on' || f === 'policy_classes' ? [].concat(t[f] || []) : t[f];
          });
          var adv = advisoryByKey[t.key] || {};
          ADVISORY_PREVIEW_FIELDS.forEach(function (f) {
            if (adv[f] !== undefined) row[f] = adv[f];
          });
          return row;
        })
      }
    };
  });
}

// Submitting a goal does NOT mean "make a campaign". If this project already
// has one that can still continue, that campaign is the answer — the caller
// gets its id and continues it. This is what keeps a retrying webhook, a
// duplicated n8n execution or an impatient operator from forking the work.
//
// MOS-v2 M-09: `require_plan_approval` is an OPTIONAL boolean that only a
// server-side caller sets. When it is true and a NEW campaign is created,
// the campaign is parked in WAITING_FOR_APPROVAL with its proposed plan
// attached BEFORE any mission is started — the AI proposes, a human
// authorises, and only then does continueCampaign dispatch anything. The
// HTTP surface passes it only when the authenticated payload asks for it,
// and the console relay always asks. A caller that does not pass the flag
// (n8n, the autopilot) sees exactly the behaviour it saw before: no extra
// approval, no extra state, nothing to change on their side.
//
// MOS-v2 M-10: `decompose` is a second OPTIONAL boolean, read by identity
// for the same reason, and legal only together with require_plan_approval.
// When set, the proposed plan comes from the PLANNER MODEL
// (decomposeObjective → parsePlannerOutput → toPlanSpec →
// planner.planFromSpec) instead of the roadmap template, and the validated
// spec is stored with the campaign so a granted approval dispatches the
// plan the human actually read.
//
// RETURN SHAPE: the result object, as before — EXCEPT when decompose is
// true, where a Promise of the same object is returned instead, because a
// planner model is a network call. Callers that never pass decompose see
// byte-identical synchronous behaviour; the one caller that does wraps the
// result in Promise.resolve, which is correct for both.
function submitGoal(input) {
  coreWiring.assertEnabled();
  input = input || {};
  var project = typeof input.project === 'string' && input.project.trim()
    ? input.project.trim() : 'mythos-prod';

  // MOS-v2 M-10: AI decomposition without the approval gate is refused
  // outright. A plan a model wrote is exactly the plan that must not
  // dispatch unreviewed, so the two flags are not independent: asking for
  // one without the other is a mistake, and it is answered as one rather
  // than by quietly running an unreviewed generated plan.
  if (input.decompose === true && input.require_plan_approval !== true) {
    var de = new Error('DECOMPOSE_REQUIRES_APPROVAL: an AI-decomposed plan is only ever ' +
      'proposed for human approval, never dispatched unreviewed');
    de.code = 'DECOMPOSE_REQUIRES_APPROVAL';
    throw de;
  }

  var live = campaign.listCampaigns().filter(function (c) {
    return c.project === project && LIVE_STATES.indexOf(c.state) !== -1;
  });
  if (live.length) {
    var existing = {
      campaign_id: live[0].campaign_id,
      created: false,
      state: live[0].state,
      objective: live[0].objective,
      reason: 'an existing campaign for this project can still continue; ' +
        'a second campaign is never created while one is live'
    };
    // A decomposing caller is answered asynchronously in every case, so
    // one call shape does not depend on whether a campaign happened to
    // already exist.
    return input.decompose === true ? Promise.resolve(existing) : existing;
  }

  var created = campaign.createCampaign({
    objective: input.objective,
    project: project,
    requested_by: input.requested_by || 'n8n'
    // repo_path deliberately NOT taken from the payload: the repository is
    // configuration, not something a webhook caller chooses.
  });
  if (input.require_plan_approval !== true) {
    return {
      campaign_id: created.campaign_id,
      created: true,
      state: created.state,
      objective: created.objective
    };
  }

  // --- mandatory human approval of the proposed plan --------------------
  //
  // Built and attached BEFORE the park, so the approval a human is asked
  // to answer already carries the plan it is about.
  //
  // MOS-v2 M-10: WHERE the plan comes from is the only difference between
  // the two branches below. Everything after — attach, park, decide,
  // dispatch — is one path, so the AI-decomposed plan cannot acquire a
  // second approval mechanism or a second dispatcher by existing.
  if (input.decompose === true) {
    return decomposedPreview(created.objective, project, {
      runner: input.decompose_runner,
      model: input.planner_model
    }).then(function (out) {
      return parkProposedPlan(created, out.preview, {
        requested: true,
        status: 'VALIDATED',
        provider: out.provider,
        model: out.model,
        title: out.preview.title,
        // THE VALIDATED SPEC, stored durably with the campaign. A granted
        // approval dispatches THIS — never a re-generation, which would be
        // a different plan from the one the human read.
        spec: out.spec,
        advisory: out.advisory,
        generated_at: new Date().toISOString(),
        dispatched_at: null
      }, 'proposed plan requires human approval before dispatch');
    }, function (err) {
      // Decomposition failed. The campaign is still parked for a human,
      // with the typed reason visible and the FALLBACK QUESTION asked
      // rather than answered: substituting the roadmap template plan here
      // would dispatch a plan nobody reviewed under the belief it was the
      // AI's. campaign-runner refuses to select roadmap work for a
      // campaign whose decomposition did not produce a validated spec, so
      // even granting this approval cannot turn into a template dispatch.
      var code = (err && err.code) || 'PLANNER_FAILED';
      var detail = String((err && err.message) || err).slice(0, 300);
      return parkProposedPlan(created, {
        available: false,
        reason: 'AI decomposition failed (' + code + '): ' + detail,
        capability_key: null, title: null,
        objective: String(created.objective).slice(0, 400),
        risk: null, acceptance_criteria: [],
        source: 'ai-decomposition',
        planner_provider: null, planner_model: null,
        tasks: []
      }, {
        requested: true,
        status: 'FAILED',
        code: code,
        reason: detail,
        spec: null,
        advisory: null,
        generated_at: new Date().toISOString(),
        dispatched_at: null
      }, 'AI decomposition failed (' + code + '): ' + detail +
        ' — no plan was generated and NO template plan has been substituted. ' +
        'Decide whether to retry decomposition or to submit this goal again ' +
        'without it; approving here dispatches nothing.');
    });
  }

  return parkProposedPlan(created, planPreview(created.campaign_id), null,
    'proposed plan requires human approval before dispatch');
}

// Attaches a proposed plan to a brand-new campaign and parks it for a
// human. Shared by the M-09 template path and the M-10 decomposition path
// so there is exactly one park, one approval entity and one response
// shape for "a plan is waiting for you".
//
// proposeNextMission writes the roadmap's approval CANDIDATES into
// approval_required when nothing is selectable; those are notes without
// an approval entity and would leave this brand-new campaign with
// unanswerable pending approvals, so they are cleared here. Nothing else
// can have written to this list — the campaign was created moments ago.
function parkProposedPlan(created, preview, decomposeRecord, reason) {
  var c = campaign.loadCampaign(created.campaign_id);
  c.approval_required = [];
  c.proposed_plan = preview;
  c.require_plan_approval = true;
  if (decomposeRecord) c.decompose = decomposeRecord;
  campaign.saveCampaign(c);

  // capability_key is deliberately NOT passed: this approval is about the
  // PLAN as a whole, not a verdict on one roadmap capability. Passing it
  // would make an unattended auto-denial write that capability off in the
  // roadmap because a console goal happened to be submitted while no human
  // was reachable. The plan itself is recorded in proposed_plan above.
  var parked = campaign.parkForApproval(created.campaign_id, {
    action_class: 'GOVERNANCE',
    objective: created.objective,
    reason: reason
  });
  var after = campaign.loadCampaign(created.campaign_id);
  if (decomposeRecord && after) {
    // WHICH approval authorises this spec. The runner dispatches a stored
    // spec only against a GRANTED decision on exactly this id, so an
    // unattended auto-denial — or any other outcome that is not a human
    // grant — leaves the plan undispatchable rather than merely unparked.
    after.decompose = Object.assign({}, after.decompose, {
      approval_id: (parked && parked.id) || null,
      auto_denied: !!(parked && parked.auto_denied)
    });
    campaign.saveCampaign(after);
  }
  var out = {
    campaign_id: created.campaign_id,
    created: true,
    state: after ? after.state : created.state,
    objective: created.objective,
    require_plan_approval: true,
    // Unattended mode still answers for itself, and it still only ever
    // DENIES (core/unattended.js). Reported, never hidden.
    auto_denied: !!(parked && parked.auto_denied),
    approval_id: (parked && parked.id) || null,
    proposed_plan: preview
  };
  if (decomposeRecord) {
    out.decompose = true;
    out.decompose_status = decomposeRecord.status;
    if (decomposeRecord.code) out.decompose_error = decomposeRecord.code;
  }
  return out;
}

// --- Status -------------------------------------------------------------------

// The stored preview, re-picked on the way out. A field added to the
// stored object for some later reason does not become an API field by
// default — same discipline as the console's own relays.
function previewView(preview) {
  if (!preview || typeof preview !== 'object') return null;
  var view = {
    available: preview.available === true,
    reason: preview.reason || null,
    capability_key: preview.capability_key || null,
    title: preview.title || null,
    objective: preview.objective || null,
    risk: preview.risk || null,
    acceptance_criteria: [].concat(preview.acceptance_criteria || []),
    tasks: [].concat(preview.tasks || []).map(function (t) {
      var row = {};
      PREVIEW_TASK_FIELDS.forEach(function (f) {
        row[f] = f === 'depends_on' || f === 'policy_classes' ? [].concat((t && t[f]) || []) : (t && t[f]) || null;
      });
      // MOS-v2 M-10: the planner's ADVISORY suggestions, relayed only when
      // the planner actually made them — a template plan's tasks keep the
      // exact shape M-09 served. Nothing reads these to select anything;
      // they are shown to the human who is about to decide.
      ADVISORY_PREVIEW_FIELDS.forEach(function (f) {
        if (t && t[f] !== undefined && t[f] !== null) row[f] = t[f];
      });
      return row;
    })
  };
  // Provenance: WHICH planner proposed this, when one did. Absent on a
  // template preview rather than present-and-null, so a reviewer never
  // sees an empty planner line on a plan no planner touched.
  if (preview.source) view.source = String(preview.source).slice(0, 40);
  if (preview.planner_provider) view.planner_provider = String(preview.planner_provider).slice(0, 60);
  if (preview.planner_model) view.planner_model = String(preview.planner_model).slice(0, 60);
  return view;
}

function describe(campaignId) {
  var c = safeLoad(campaignId);
  if (!c) return null;
  var st = runner.campaignStatus(campaignId);
  var lock = lockHolder(campaignId);
  var cm = st.current_mission;
  var tasks = [];
  if (cm && cm.mission_id) {
    try {
      var m = store.load('mission', cm.mission_id);
      tasks = (m.task_ids || []).map(function (id) {
        var t = store.load('task', id);
        return {
          task_id: t.id,
          plan_key: t.metadata && t.metadata.plan_key,
          status: t.status,
          worktree: (t.metadata && t.metadata.worktree_dir) || null,
          agent: t.agent_id || null
        };
      });
    } catch (e) { /* mission record unreadable — status still answers */ }
  }
  return {
    campaign_id: campaignId,
    project: c.project,
    objective: c.objective,
    state: st.state,
    running: !!lock,
    // Must mirror what continueCampaign() ACTUALLY accepts, including
    // RUNNING. A campaign sits in RUNNING between ticks with its mission
    // started but its DAG not yet advanced — that is the normal unattended
    // state, and it is exactly when the autopilot needs to call again.
    // Advertising `false` there made the autopilot idle forever and stalled
    // unattended operation after the first mission start. This widens no
    // authority: continueCampaign already accepted RUNNING, and the refusals
    // for WAITING_FOR_APPROVAL and BLOCKED are untouched.
    continuable: (CONTINUABLE.indexOf(st.state) !== -1 || st.state === 'RUNNING') && !lock,
    needs_human: DECISION_STATES.indexOf(st.state) !== -1,
    completed_missions: (st.completed_missions || []).map(function (x) {
      return {
        capability_key: x.capability_key, mission_id: x.mission_id,
        commit: x.commit || null, tests: x.tests || null,
        repair_cycles: x.repair_cycles
      };
    }),
    blocked_missions: st.blocked_missions || [],
    approval_required: st.approval_required || [],
    // MOS-v2 M-09: the plan a human is being asked to authorise —
    // capability, objective and the mission's tasks WITH their
    // dependencies, so the decision is made on the real DAG rather than on
    // a one-line summary of it. Field-picked from the stored preview; the
    // per-task instruction text and the campaign's internal state are not
    // part of it.
    plan_approval_required: c.require_plan_approval === true,
    proposed_plan: previewView(c.proposed_plan),
    current_mission: cm ? {
      capability_key: cm.capability_key, mission_id: cm.mission_id, tasks: tasks
    } : null,
    updated_at: c.updated_at
  };
}

// --- Continuation ---------------------------------------------------------------

// Fire-and-accept: the campaign keeps running after the HTTP response, because
// its state is durable and the caller polls. The promise is returned too, so
// tests can await it without the service needing a second code path.
function continueCampaign(campaignId, opts) {
  coreWiring.assertEnabled();
  opts = opts || {};
  var c = safeLoad(campaignId);
  if (!c) return { accepted: false, reason: 'no such campaign', code: 'NOT_FOUND' };

  var st = runner.campaignStatus(campaignId);

  if (DECISION_STATES.indexOf(st.state) !== -1) {
    var why = st.state === 'WAITING_FOR_APPROVAL'
      ? (st.approval_required || []).map(function (a) { return a.reason; }).join('; ')
      : (st.blocked_missions || []).map(function (b) { return b.reason; }).join('; ');
    return {
      accepted: false, code: 'NEEDS_HUMAN', state: st.state,
      reason: 'campaign is ' + st.state + ' and will not be auto-continued: ' +
        (why || 'no reason recorded')
    };
  }
  if (st.state === 'COMPLETED') {
    return { accepted: false, code: 'COMPLETED', state: st.state, reason: 'campaign is complete' };
  }
  if (CONTINUABLE.indexOf(st.state) === -1 && st.state !== 'RUNNING') {
    return { accepted: false, code: 'NOT_CONTINUABLE', state: st.state,
      reason: 'state ' + st.state + ' is not a continuable state' };
  }

  var lease = acquireLock(campaignId);
  if (!lease.acquired) {
    return {
      accepted: false, code: 'ALREADY_RUNNING', state: st.state,
      reason: 'a continuation is already in flight for this campaign',
      holder_since: lease.holder && lease.holder.acquired_at
    };
  }

  store.appendEventLine({
    event_type: 'CAMPAIGN_CONTINUE_REQUESTED', subject_id: campaignId,
    project: c.project,
    detail: { requested_by: opts.requested_by || 'api', from_state: st.state }
  });

  var runOpts = {
    // max_steps is the ONLY knob a caller may turn, and it is clamped. It
    // cannot widen authority — it only bounds how much work one call does.
    max_steps: Math.max(1, Math.min(parseInt(opts.max_steps, 10) || 2, 20)),
    max_parallel: 2
  };
  if (typeof opts.review_fn === 'function') runOpts.review_fn = opts.review_fn;
  if (typeof opts.agent_runner === 'function') runOpts.agent_runner = opts.agent_runner;
  if (opts.repo_path) runOpts.repo_path = opts.repo_path;

  var promise = Promise.resolve()
    .then(function () { return runner.runCampaign(campaignId, runOpts); })
    .then(function (res) {
      releaseLock(campaignId);
      return res;
    })
    .catch(function (err) {
      releaseLock(campaignId);
      store.appendEventLine({
        event_type: 'CAMPAIGN_CONTINUE_FAILED', subject_id: campaignId,
        project: c.project, detail: { error: String(err && err.message).slice(0, 300) }
      });
      throw err;
    });

  return {
    accepted: true, code: 'ACCEPTED', campaign_id: campaignId,
    from_state: st.state, max_steps: runOpts.max_steps, promise: promise
  };
}

// --- Event feed -----------------------------------------------------------------

// A cursor-based pull feed. n8n keeps a cursor and asks for what came after
// — no push, no socket, no state held in n8n.
//
// The cursor is a SEQUENCE NUMBER, not a timestamp. A timestamp cursor loses
// events: store.readEvents filters on created_at > since, so any event
// written in the same millisecond as the cursor is skipped and, because the
// next poll carries a cursor at or past that millisecond, is never delivered
// at all. Timestamps here have millisecond resolution and a campaign emits
// bursts well inside one — so this was silent, permanent event loss on a feed
// whose whole job is to notice WAITING_FOR_QUOTA and approval gates.
//
// events.log is append-only, so a line's index is a perfect monotonic cursor.
// `since` remains available for a first poll and deliberately uses `<` rather
// than `<=`: at the boundary millisecond it may re-deliver an event the caller
// already saw. Duplicates are harmless to an idempotent automation layer;
// losses are not.
function eventsSince(sinceIso, limit, afterSeq) {
  var all = store.readEvents(null, null);
  var start = 0;
  var seq = parseInt(afterSeq, 10);
  if (!isNaN(seq)) {
    start = Math.max(0, seq + 1);
  } else if (sinceIso) {
    while (start < all.length && all[start].created_at < sinceIso) start++;
  }
  var cap = Math.max(1, Math.min(parseInt(limit, 10) || 100, 500));
  var page = all.slice(start, start + cap);
  var lastSeq = start + page.length - 1;
  return {
    count: page.length,
    // Feed this back as after_seq on the next poll for exact, lossless paging.
    cursor_seq: page.length ? lastSeq : (isNaN(seq) ? all.length - 1 : seq),
    cursor: page.length ? page[page.length - 1].created_at : (sinceIso || null),
    more: all.length > start + page.length,
    events: page.map(function (e, i) {
      return {
        seq: start + i,
        event_type: e.event_type, subject_id: e.subject_id,
        project: e.project, created_at: e.created_at, detail: e.detail
      };
    })
  };
}

module.exports = {
  CONTINUABLE: CONTINUABLE,
  DECISION_STATES: DECISION_STATES,
  LIVE_STATES: LIVE_STATES,
  submitGoal: submitGoal,
  planPreview: planPreview,
  decomposedPreview: decomposedPreview,
  PREVIEW_TASK_FIELDS: PREVIEW_TASK_FIELDS,
  ADVISORY_PREVIEW_FIELDS: ADVISORY_PREVIEW_FIELDS,
  describe: describe,
  continueCampaign: continueCampaign,
  eventsSince: eventsSince,
  lockHolder: lockHolder,
  acquireLock: acquireLock,
  releaseLock: releaseLock
};
