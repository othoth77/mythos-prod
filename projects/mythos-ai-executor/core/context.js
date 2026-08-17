'use strict';
// =====================================================
// Mythos Orchestration Core — context engine (Phase 2B)
// projects/mythos-ai-executor/core/context.js
//
// Given a task, retrieve ONLY the relevant context instead of dumping a
// whole repository or memory store into an agent prompt (vision §5 —
// both a cost rule and a correctness rule). Sources, each tagged with
// relevance / source / timestamp / confidence:
//
//   1. project memory      (core/memory.js lexical recall)
//   2. live repository state (branch / commit / dirty — facts, not files)
//   3. related prior tasks  (same project, lexical match on titles)
//   4. portfolio ledger      (projects/meta/current-context.json — the
//      "small file a future agent reads before scanning many documents",
//      DEVELOPMENT_ACCELERATION_ARCHITECTURE.md §3). Portfolio-wide, not
//      project-scoped: it surfaces cross-track blockers and the current
//      owner priority, not any one project's data.
//
// A hard character budget bounds the assembled context; items are
// admitted in relevance order and truncated, never silently dropped
// mid-item. Projects are isolated: no entry from another project can
// appear, whatever the query says.
// =====================================================

var fs = require('fs');
var path = require('path');
var memory = require('./memory');
var store = require('./store');
var gitlib = require('../../mythos-orchestrator/lib/git');

var DEFAULT_MAX_ITEMS = 12;
var DEFAULT_MAX_CHARS = 12000;
var ITEM_CONTENT_CAP = 2400;
var META_LEDGER_MAX_BLOCKERS = 3;

function repoStateItem(repoPath) {
  if (!repoPath || !gitlib.isRepo(repoPath)) return null;
  try {
    return {
      kind: 'repository_state',
      content: 'branch=' + gitlib.currentBranch(repoPath) +
        ' commit=' + gitlib.head(repoPath) +
        ' dirty=' + gitlib.isDirty(repoPath),
      relevance: 999,               // current repo facts are always in scope
      source: repoPath,
      timestamp: new Date().toISOString(),
      confidence: 1.0
    };
  } catch (e) {
    return null;
  }
}

function priorTaskItems(project, queryTerms, limit) {
  var related = store.list('task', function (t) {
    return t.project === project &&
      ['COMPLETED', 'FAILED'].indexOf(t.status) !== -1;
  }).map(function (t) {
    var titleTerms = memory.terms(t.title + ' ' + (t.instruction || '').slice(0, 400));
    var overlap = 0;
    queryTerms.forEach(function (q) { if (titleTerms.indexOf(q) !== -1) overlap += 1; });
    return { task: t, overlap: overlap };
  }).filter(function (x) { return x.overlap > 0; });
  related.sort(function (a, b) { return b.overlap - a.overlap; });
  return related.slice(0, limit).map(function (x) {
    return {
      kind: 'prior_task',
      content: '[' + x.task.status + '] ' + x.task.title +
        (x.task.result && x.task.result.summary ? ' — ' + String(x.task.result.summary).slice(0, 300) : ''),
      relevance: x.overlap,
      source: 'task:' + x.task.id,
      timestamp: x.task.updated_at,
      confidence: 0.9
    };
  });
}

// Surfaces `projects/meta/current-context.json` as low-relevance ambient
// context: the next owner priority and up to META_LEDGER_MAX_BLOCKERS known
// blockers. Fixed, query-independent relevance below repository_state and
// below most query-relevant memory hits — present when there is room in the
// budget, never crowding out task-specific context. Missing or malformed
// ledger files are not an error: this source is best-effort, same as
// repoStateItem.
function portfolioLedgerItems(repoPath) {
  if (!repoPath) return [];
  var ledgerPath = path.join(repoPath, 'projects', 'meta', 'current-context.json');
  var ledger;
  try {
    ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  } catch (e) {
    return [];
  }
  var timestamp = ledger.generated_at || new Date().toISOString();
  var items = [];
  if (ledger.next_owner_priority) {
    items.push({
      kind: 'meta:next_priority',
      content: 'Portfolio next owner priority: ' + ledger.next_owner_priority,
      relevance: 6,
      source: 'projects/meta/current-context.json',
      timestamp: timestamp,
      confidence: 0.7
    });
  }
  (Array.isArray(ledger.known_blockers) ? ledger.known_blockers : [])
    .slice(0, META_LEDGER_MAX_BLOCKERS)
    .forEach(function (blocker) {
      items.push({
        kind: 'meta:known_blocker',
        content: 'Portfolio known blocker: ' + String(blocker),
        relevance: 5,
        source: 'projects/meta/current-context.json',
        timestamp: timestamp,
        confidence: 0.7
      });
    });
  return items;
}

// Assembles the context set for one task/query. Pure retrieval — no LLM,
// no network, deterministic for a given store state.
function assembleContext(opts) {
  if (!opts || !opts.project) throw new Error('CONTEXT_REQUIRES_PROJECT');
  var query = String(opts.instruction || opts.query || '');
  var queryTerms = memory.terms(query);
  var maxItems = opts.max_items || DEFAULT_MAX_ITEMS;
  var maxChars = opts.max_chars || DEFAULT_MAX_CHARS;

  var items = [];

  var repo = repoStateItem(opts.repo_path);
  if (repo) items.push(repo);

  memory.recall(opts.project, query, { limit: maxItems }).forEach(function (hit) {
    items.push({
      kind: 'memory:' + hit.entry.category,
      content: hit.entry.title + ' — ' + hit.entry.content,
      relevance: hit.score,
      source: hit.entry.source || ('memory:' + hit.entry.id),
      timestamp: hit.entry.updated_at,
      confidence: hit.entry.confidence
    });
  });

  priorTaskItems(opts.project, queryTerms, 4).forEach(function (i) { items.push(i); });
  portfolioLedgerItems(opts.repo_path).forEach(function (i) { items.push(i); });

  // Relevance order, then admit under the budget.
  items.sort(function (a, b) { return b.relevance - a.relevance; });
  var admitted = [];
  var used = 0;
  for (var i = 0; i < items.length && admitted.length < maxItems; i++) {
    var item = items[i];
    var content = String(item.content);
    if (content.length > ITEM_CONTENT_CAP) {
      content = content.slice(0, ITEM_CONTENT_CAP) + ' …[truncated]';
    }
    if (used + content.length > maxChars) break;
    used += content.length;
    admitted.push(Object.assign({}, item, { content: content }));
  }

  return {
    project: opts.project,
    query_terms: queryTerms,
    items: admitted,
    total_chars: used,
    budget_chars: maxChars,
    assembled_at: new Date().toISOString()
  };
}

// Renders assembled context as a prompt-injectable markdown block.
function renderContext(ctx) {
  if (!ctx.items.length) return '(no relevant context found)';
  var lines = ['## Relevant context (assembled ' + ctx.assembled_at + ', ' +
    ctx.items.length + ' items, ' + ctx.total_chars + ' chars)'];
  ctx.items.forEach(function (item, i) {
    lines.push('');
    lines.push((i + 1) + '. **' + item.kind + '** (relevance ' +
      (Math.round(item.relevance * 10) / 10) + ', confidence ' + item.confidence +
      ', source ' + item.source + ', ' + item.timestamp + ')');
    lines.push('   ' + item.content.replace(/\n/g, '\n   '));
  });
  return lines.join('\n');
}

module.exports = {
  assembleContext: assembleContext,
  renderContext: renderContext,
  DEFAULT_MAX_CHARS: DEFAULT_MAX_CHARS,
  DEFAULT_MAX_ITEMS: DEFAULT_MAX_ITEMS
};
