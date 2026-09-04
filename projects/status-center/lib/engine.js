// =====================================================
// MYTHOS STATUS CENTER — review engine
// projects/status-center/lib/engine.js
//
// A review is a full reconciliation: verifiable git facts + the curated
// evidence registry + the PR ledger + document reconciliation, compared
// against the previous immutable snapshot. Snapshots are append-only —
// the engine REFUSES to overwrite an existing review file (order §30).
//
// Security model (§35): read-only over allowlisted sources. No network.
// No credential use. Anything unverifiable is emitted as NOT_VERIFIED.
// =====================================================
'use strict';

const fs = require('fs');
const path = require('path');
const model = require('./model.js');
const gitfacts = require('./gitfacts.js');

const ENGINE_VERSION = '1.0.0';

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// ---------------------------------------------------------------------
// Evidence verification. Each evidence item gets evidence_status:
// VERIFIED (checked against the repository here and now),
// RECORDED  (curated evidence the engine cannot independently re-check
//            from this environment — e.g. an operator report, a live
//            HTTPS observation), or
// NOT_VERIFIED (a check was possible and FAILED).
// ---------------------------------------------------------------------
function verifyEvidence(repoRoot, evidence, prLedger) {
  const prNumbers = Object.create(null);
  (prLedger.prs || []).forEach(function (pr) { prNumbers[pr.number] = pr; });

  return evidence.map(function (ev) {
    const out = Object.assign({}, ev);
    if (ev.type === 'file' || ev.type === 'document') {
      out.evidence_status = fs.existsSync(path.join(repoRoot, ev.reference))
        ? 'VERIFIED' : 'NOT_VERIFIED';
      if (out.evidence_status === 'NOT_VERIFIED') {
        out.evidence_note = 'file not found at ' + ev.reference;
      }
    } else if (ev.type === 'commit') {
      out.evidence_status = gitfacts.commitExists(repoRoot, ev.reference)
        ? 'VERIFIED' : 'NOT_VERIFIED';
      if (out.evidence_status === 'NOT_VERIFIED') {
        out.evidence_note = 'commit not in local object database';
      }
    } else if (ev.type === 'pr') {
      const m = /^#?(\d+)$/.exec(String(ev.reference));
      const pr = m ? prNumbers[Number(m[1])] : null;
      out.evidence_status = pr ? 'VERIFIED' : 'NOT_VERIFIED';
      if (pr) out.evidence_note = pr.title + ' (' + pr.state + (pr.merged ? ', merged' : '') + ')';
      else out.evidence_note = 'PR not present in the recorded ledger';
    } else if (ev.type === 'test') {
      // A test evidence reference of the form "tests/<file>" is verified
      // to exist; recorded counts stay RECORDED unless re-run.
      if (/^tests\//.test(ev.reference)) {
        out.evidence_status = fs.existsSync(path.join(repoRoot, ev.reference.split(' ')[0]))
          ? 'VERIFIED' : 'NOT_VERIFIED';
      } else {
        out.evidence_status = 'RECORDED';
      }
    } else {
      // dns / vps / deployment / operator-report / external / repository /
      // issue / ci — not independently checkable from this environment.
      out.evidence_status = 'RECORDED';
    }
    return out;
  });
}

// ---------------------------------------------------------------------
// Track progress. A percentage is CALCULATED only from an explicit
// stage list (done/total). Anything else passes through the curated
// value with its declared basis, or NOT_CALCULABLE. Never invented.
// ---------------------------------------------------------------------
function computeTrackProgress(track) {
  const stages = track.stages || [];
  const out = Object.assign({}, track);
  if (stages.length > 0) {
    const done = stages.filter(function (s) {
      return s.status === 'DONE' || s.status === 'SUPERSEDED';
    }).length;
    out.progress = {
      done_stages: done,
      total_stages: stages.length,
      percent: Math.round((done / stages.length) * 100),
      basis: 'CALCULATED',
      explanation: done + ' of ' + stages.length + ' recorded stages DONE (superseded counted as closed)'
    };
  } else {
    out.progress = { percent: 'NOT_CALCULABLE', basis: 'NOT_AVAILABLE',
      explanation: 'no stage list recorded for this track' };
  }
  return out;
}

// ---------------------------------------------------------------------
// Document reconciliation (§8): verify each classified document exists
// and surface conflicts. Classification itself is curated evidence.
// ---------------------------------------------------------------------
function reconcileDocuments(repoRoot, documents) {
  return documents.map(function (d) {
    const out = Object.assign({}, d);
    const p = path.join(repoRoot, d.path);
    out.exists = fs.existsSync(p);
    if (!out.exists) {
      out.classification = 'UNVERIFIED';
      out.note = (d.note ? d.note + ' — ' : '') + 'file missing at review time';
    }
    return out;
  });
}

// ---------------------------------------------------------------------
// Repository discovery (§32). Compares the recorded repository registry
// against an optional discovery snapshot (a list of {full_name, pushed_at,
// visibility} captured from GitHub when API access exists). Anything in
// the snapshot but not in the registry is a NEW_DISCOVERY requiring
// classification. Nothing is silently classified.
// ---------------------------------------------------------------------
function discoverRepositories(registryRepos, discoverySnapshot) {
  const known = Object.create(null);
  registryRepos.forEach(function (r) { known[r.full_name.toLowerCase()] = r; });

  const result = registryRepos.map(function (r) { return Object.assign({}, r); });
  const news = [];
  ((discoverySnapshot && discoverySnapshot.repos) || []).forEach(function (r) {
    const k = (r.full_name || '').toLowerCase();
    if (!k) return;
    if (!known[k]) {
      news.push({
        id: 'REPO-' + k.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toUpperCase(),
        full_name: r.full_name,
        classification: 'NEW_DISCOVERY',
        pushed_at: r.pushed_at || null,
        visibility: r.visibility || null,
        note: 'Discovered in the repository snapshot of ' +
          (discoverySnapshot.captured_at || 'unknown date') +
          ' but absent from the classified registry. Requires classification.'
      });
    } else {
      known[k].pushed_at = r.pushed_at || known[k].pushed_at || null;
    }
  });
  return { repositories: result.concat(news), new_discoveries: news };
}

// ---------------------------------------------------------------------
// Monorepo project discovery (gh-issue-140): discoverRepositories only
// ever compared GitHub account repositories — it cannot see a new
// directory added under this repository's own projects/. Every
// registry project MAY declare which projects/<name> directories it
// already accounts for (project.directories); any directory present on
// disk that no project claims is a discovery requiring classification,
// exactly like an unclassified GitHub repository. Read-only (fs only,
// no git, no network); a missing projects/ directory is reported, not
// thrown.
// ---------------------------------------------------------------------
function discoverMonorepoProjects(repoRoot, registryProjects) {
  const known = Object.create(null);
  (registryProjects || []).forEach(function (p) {
    (p.directories || []).forEach(function (d) { known[d] = true; });
  });

  const projectsDir = path.join(repoRoot, 'projects');
  let entries;
  try {
    entries = fs.readdirSync(projectsDir, { withFileTypes: true })
      .filter(function (e) { return e.isDirectory(); })
      .map(function (e) { return 'projects/' + e.name; })
      .sort();
  } catch (e) {
    return { checked: false, directories_checked: 0, new_discoveries: [],
      note: 'projects/ not readable from ' + repoRoot + ': ' + String(e.message || e) };
  }

  const news = entries.filter(function (d) { return !known[d]; }).map(function (d) {
    return {
      directory: d,
      note: 'Directory present under projects/ but not claimed by any registry project\'s ' +
        '"directories" list. Requires classification (existing project or a new one).'
    };
  });

  return { checked: true, directories_checked: entries.length, new_discoveries: news };
}

// ---------------------------------------------------------------------
// Comparison (§25, §31): diff two review snapshots.
// ---------------------------------------------------------------------
function compareReviews(prev, curr) {
  const changes = {
    added: [], completed: [], unblocked: [], blocked: [],
    changed: [], regressed: [], superseded: [],
    new_blockers: [], removed_blockers: [], new_owner_actions: [],
    percent_changes: [], new_projects: []
  };
  if (!prev) {
    changes.note = 'No previous review exists — this is the baseline review.';
    return changes;
  }

  function indexBy(arr, key) {
    const m = Object.create(null);
    (arr || []).forEach(function (x) { m[x[key]] = x; });
    return m;
  }

  const DONE_LIKE = { DONE: true, SUPERSEDED: true };
  const prevProjects = indexBy(prev.projects, 'id');
  (curr.projects || []).forEach(function (p) {
    const old = prevProjects[p.id];
    if (!old) { changes.new_projects.push({ id: p.id, status: p.status }); changes.added.push({ id: p.id, what: 'project added', to: p.status }); return; }
    if (old.status !== p.status) {
      const entry = { id: p.id, from: old.status, to: p.status };
      if (DONE_LIKE[p.status] && !DONE_LIKE[old.status]) changes.completed.push(entry);
      else if (old.status === 'BLOCKED' && p.status !== 'BLOCKED') changes.unblocked.push(entry);
      else if (p.status === 'BLOCKED' && old.status !== 'BLOCKED') changes.blocked.push(entry);
      else if (p.status === 'SUPERSEDED') changes.superseded.push(entry);
      else if (DONE_LIKE[old.status] && !DONE_LIKE[p.status]) changes.regressed.push(entry);
      else changes.changed.push(entry);
    }
    (p.tracks || []).forEach(function () {}); // track-level handled below
  });

  const prevTracks = indexBy(prev.tracks, 'id');
  (curr.tracks || []).forEach(function (t) {
    const old = prevTracks[t.id];
    if (!old) { changes.added.push({ id: t.id, what: 'track added' }); return; }
    const op = old.progress && old.progress.percent;
    const np = t.progress && t.progress.percent;
    if (op !== np) {
      changes.percent_changes.push({ id: t.id, from: op, to: np });
      if (typeof op === 'number' && typeof np === 'number' && np < op) {
        changes.regressed.push({ id: t.id, from: op + '%', to: np + '%' });
      }
    }
    const oldStages = indexBy(old.stages, 'id');
    (t.stages || []).forEach(function (s) {
      const os = oldStages[s.id];
      if (!os) { changes.added.push({ id: t.id + '/' + s.id, what: 'stage added', to: s.status }); return; }
      if (os.status !== s.status) {
        const entry = { id: t.id + '/' + s.id, from: os.status, to: s.status };
        if (s.status === 'DONE') changes.completed.push(entry);
        else if (os.status === 'BLOCKED' && s.status !== 'BLOCKED') changes.unblocked.push(entry);
        else if (s.status === 'BLOCKED') changes.blocked.push(entry);
        else if (s.status === 'SUPERSEDED') changes.superseded.push(entry);
        else if (os.status === 'DONE') changes.regressed.push(entry);
        else changes.changed.push(entry);
      }
    });
  });

  const prevBlockers = indexBy(prev.blockers, 'id');
  const currBlockers = indexBy(curr.blockers, 'id');
  (curr.blockers || []).forEach(function (b) {
    if (!prevBlockers[b.id]) changes.new_blockers.push({ id: b.id, title: b.title });
  });
  (prev.blockers || []).forEach(function (b) {
    if (!currBlockers[b.id]) changes.removed_blockers.push({ id: b.id, title: b.title });
  });

  const prevActions = indexBy(prev.owner_actions, 'id');
  (curr.owner_actions || []).forEach(function (a) {
    if (!prevActions[a.id]) changes.new_owner_actions.push({ id: a.id, what: a.what });
  });

  return changes;
}

// ---------------------------------------------------------------------
// Review ID allocation: REVIEW-YYYY-MM-DD-NNN, NNN increments within a
// day based on the immutable files already present.
// ---------------------------------------------------------------------
function allocateReviewId(reviewsRoot, dateStr) {
  const year = dateStr.slice(0, 4);
  const dir = path.join(reviewsRoot, year);
  let n = 0;
  if (fs.existsSync(dir)) {
    fs.readdirSync(dir).forEach(function (f) {
      const m = new RegExp('^' + dateStr + '-review-(\\d{3})\\.json$').exec(f);
      if (m) n = Math.max(n, Number(m[1]));
    });
  }
  const nnn = String(n + 1).padStart(3, '0');
  return { id: 'REVIEW-' + dateStr + '-' + nnn, file: path.join(dir, dateStr + '-review-' + nnn + '.json') };
}

function findLatestReview(reviewsRoot) {
  if (!fs.existsSync(reviewsRoot)) return null;
  let best = null;
  fs.readdirSync(reviewsRoot).sort().forEach(function (year) {
    const dir = path.join(reviewsRoot, year);
    if (!fs.statSync(dir).isDirectory()) return;
    fs.readdirSync(dir).sort().forEach(function (f) {
      if (/^\d{4}-\d{2}-\d{2}-review-\d{3}\.json$/.test(f)) {
        best = path.join(dir, f);
      }
    });
  });
  return best;
}

// ---------------------------------------------------------------------
// runReview: the full reconciliation.
// opts: { repoRoot, dataDir (curated inputs), siteDir (output site),
//         now (Date, injectable for tests) }
// ---------------------------------------------------------------------
function runReview(opts) {
  const repoRoot = opts.repoRoot;
  const dataDir = opts.dataDir;
  const siteDir = opts.siteDir;
  const now = opts.now || new Date();
  const nowIso = now.toISOString();
  const dateStr = nowIso.slice(0, 10);

  // 1. Load and validate the curated registry — fail closed.
  const registry = readJson(path.join(dataDir, 'registry.json'));
  const errors = model.validateRegistry(registry);
  if (errors.length) {
    throw new Error('STC_REGISTRY_INVALID:\n' + errors.join('\n'));
  }
  const prLedger = fs.existsSync(path.join(dataDir, 'pr-ledger.json'))
    ? readJson(path.join(dataDir, 'pr-ledger.json'))
    : { captured_at: null, prs: [] };
  const repoSnapshot = fs.existsSync(path.join(dataDir, 'repo-snapshot.json'))
    ? readJson(path.join(dataDir, 'repo-snapshot.json'))
    : null;

  // 2. Verifiable git facts.
  const git = gitfacts.collect(repoRoot);

  // 3. Evidence verification.
  const evidence = verifyEvidence(repoRoot, registry.evidence, prLedger);

  // 4. Track progress (calculated, never invented).
  const tracks = registry.tracks.map(computeTrackProgress);

  // 5. Document reconciliation.
  const documents = reconcileDocuments(repoRoot, registry.documents);

  // 6. Repository discovery.
  const disco = discoverRepositories(registry.repositories, repoSnapshot);

  // 6b. Monorepo project discovery (this repository's own projects/).
  const monorepoDisco = discoverMonorepoProjects(repoRoot, registry.projects);

  // 7. Previous review for comparison.
  const reviewsRoot = path.join(siteDir, 'reviews');
  const prevFile = findLatestReview(reviewsRoot);
  const prev = prevFile ? readJson(prevFile) : null;

  // 8. Assemble the snapshot.
  const alloc = allocateReviewId(reviewsRoot, dateStr);
  const snapshot = {
    review_id: alloc.id,
    timestamp: nowIso,
    engine_version: ENGINE_VERSION,
    audited_sources: {
      repository: git.remote_url || 'NOT_VERIFIED',
      registry: 'projects/status-center/data/registry.json',
      pr_ledger_captured_at: prLedger.captured_at,
      repo_snapshot_captured_at: repoSnapshot ? repoSnapshot.captured_at : null,
      documents_checked: documents.length,
      evidence_checked: evidence.length
    },
    git: git,
    projects: registry.projects,
    tracks: tracks,
    milestones: registry.milestones,
    blockers: registry.blockers,
    owner_actions: registry.owner_actions,
    next_actions: registry.next_actions,
    do_not_reopen: registry.do_not_reopen,
    documents: documents,
    repositories: disco.repositories,
    new_discoveries: disco.new_discoveries,
    monorepo_discovery: monorepoDisco,
    evidence: evidence,
    prs: prLedger.prs,
    source_hierarchy: registry.source_hierarchy || [],
    previous_review: prev ? prev.review_id : null
  };
  snapshot.changes = compareReviews(prev, snapshot);

  return { snapshot: snapshot, file: alloc.file, prev: prev };
}

// Persist a review: immutable snapshot + current.json + index + health.
function persistReview(result, siteDir) {
  const snapshot = result.snapshot;
  if (fs.existsSync(result.file)) {
    throw new Error('STC_REVIEW_IMMUTABLE: refusing to overwrite ' + result.file);
  }
  fs.mkdirSync(path.dirname(result.file), { recursive: true });
  fs.writeFileSync(result.file, JSON.stringify(snapshot, null, 2) + '\n', { flag: 'wx' });

  const dataDir = path.join(siteDir, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'current.json'),
    JSON.stringify(snapshot, null, 2) + '\n');

  // Rebuild the review index from the files on disk (never trust memory).
  const reviewsRoot = path.join(siteDir, 'reviews');
  const index = [];
  fs.readdirSync(reviewsRoot).sort().forEach(function (year) {
    const dir = path.join(reviewsRoot, year);
    if (!fs.statSync(dir).isDirectory()) return;
    fs.readdirSync(dir).sort().forEach(function (f) {
      if (!/^\d{4}-\d{2}-\d{2}-review-\d{3}\.json$/.test(f)) return;
      const s = readJson(path.join(dir, f));
      index.push({
        review_id: s.review_id,
        timestamp: s.timestamp,
        file: 'reviews/' + year + '/' + f,
        head: s.git && s.git.origin_main,
        blockers: (s.blockers || []).filter(function (b) { return b.status === 'BLOCKED' || b.status === 'OWNER_ACTION'; }).length
      });
    });
  });
  fs.writeFileSync(path.join(dataDir, 'reviews-index.json'),
    JSON.stringify({ reviews: index }, null, 2) + '\n');

  // Health body — explicit allowlist, no secrets (order §34; pattern MOS-v2 M-07).
  const health = {
    application: 'mythos-status-center',
    version: ENGINE_VERSION,
    status: 'ok',
    review_id: snapshot.review_id,
    review_timestamp: snapshot.timestamp,
    data_timestamp: snapshot.timestamp,
    repository_head: (snapshot.git && snapshot.git.origin_main) || 'NOT_VERIFIED',
    last_review: snapshot.review_id
  };
  fs.writeFileSync(path.join(siteDir, 'health.json'),
    JSON.stringify(health, null, 2) + '\n');

  return { file: result.file, index_size: index.length };
}

module.exports = {
  ENGINE_VERSION: ENGINE_VERSION,
  verifyEvidence: verifyEvidence,
  computeTrackProgress: computeTrackProgress,
  reconcileDocuments: reconcileDocuments,
  discoverRepositories: discoverRepositories,
  discoverMonorepoProjects: discoverMonorepoProjects,
  compareReviews: compareReviews,
  allocateReviewId: allocateReviewId,
  findLatestReview: findLatestReview,
  runReview: runReview,
  persistReview: persistReview
};
