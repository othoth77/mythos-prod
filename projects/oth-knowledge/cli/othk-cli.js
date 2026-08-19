#!/usr/bin/env node
// =====================================================
// OTH Knowledge — operator CLI
// projects/oth-knowledge/cli/othk-cli.js
//
// Usage:
//   node othk-cli.js --store <root> ingest <file> --class <source-class> [--collection <c>] [--captured-at <iso>]
//   node othk-cli.js --store <root> import-takeout <extracted-dir> [--collection <c>] [--captured-at <iso>]
//   node othk-cli.js --store <root> import-gemini <export.json> [--collection <c>] [--captured-at <iso>]
//   node othk-cli.js --store <root> import-notebooklm <note.md> [--collection <c>] [--captured-at <iso>]
//   node othk-cli.js --store <root> import-contacts-metadata <contacts.csv> [--collection <c>] [--captured-at <iso>]
//   node othk-cli.js --store <root> seed <seed.json>
//   node othk-cli.js --store <root> search "<query>" [--mode exact|lexical|vector|hybrid] [--kind k] [--class c] [--tag t] [--after iso] [--before iso] [--limit n]
//   node othk-cli.js --store <root> export [--kind k] [--class c] [--history] [--out file]
//   node othk-cli.js --store <root> validate
//   node othk-cli.js --store <root> stats
//
// Exit codes: 0 ok · 1 failure · 2 usage.
// Output prints ids, hashes and scores — never full stored bodies —
// except search snippets (bounded) and explicit export.
// =====================================================
'use strict';

const fs = require('fs');
const path = require('path');
const api = require('../lib/api.js');
const seedLib = require('../lib/seed.js');

function usage(msg) {
  if (msg) console.error('usage error: ' + msg);
  console.error('usage: othk-cli.js --store <root> <ingest|seed|search|export|validate|stats> ...');
  process.exit(2);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) args[key] = true;
      else args[key] = argv[++i];
    } else args._.push(a);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.store || typeof args.store !== 'string') usage('--store <root> required');
  const cmd = args._[0];
  if (!cmd) usage('command required');
  const kb = api.open(args.store);

  if (cmd === 'ingest') {
    const file = args._[1];
    if (!file || typeof args.class !== 'string') usage('ingest <file> --class <source-class>');
    const bytes = fs.readFileSync(file);
    const res = kb.ingestArtifact({
      bytes,
      filename: path.basename(file),
      source_class: args.class,
      source_collection: typeof args.collection === 'string' ? args.collection : undefined,
      captured_at: typeof args['captured-at'] === 'string' ? args['captured-at'] : new Date().toISOString(),
      observed_at: typeof args['observed-at'] === 'string' ? args['observed-at'] : undefined,
    });
    console.log(JSON.stringify({
      artifact: res.artifact.id, content_ref: res.artifact.content_ref,
      document: res.document.id, chunks: res.chunks.length, deduplicated: res.deduplicated,
    }, null, 2));
  } else if (cmd === 'import-takeout' || cmd === 'import-gemini' || cmd === 'import-notebooklm' || cmd === 'import-contacts-metadata') {
    const target = args._[1];
    if (!target) usage(cmd + ' <path>');
    const capturedAt = typeof args['captured-at'] === 'string' ? args['captured-at'] : new Date().toISOString();
    const collection = typeof args.collection === 'string' ? args.collection : undefined;
    let report;
    if (cmd === 'import-takeout') {
      report = require('../lib/importers/takeout.js').importDirectory(kb.store, kb.classes, target, { captured_at: capturedAt, collection });
    } else {
      const bytes = fs.readFileSync(target);
      const input = { bytes, filename: path.basename(target), captured_at: capturedAt, collection };
      if (cmd === 'import-gemini') report = require('../lib/importers/gemini.js').importExport(kb.store, kb.classes, input);
      else if (cmd === 'import-notebooklm') report = require('../lib/importers/notebooklm.js').importNote(kb.store, kb.classes, input);
      else { const r = require('../lib/importers/contacts.js').importMetadata(kb.store, kb.classes, input); delete r.analysis; report = r; }
    }
    console.log(JSON.stringify(report, null, 2));
  } else if (cmd === 'seed') {
    const file = args._[1];
    if (!file) usage('seed <seed.json>');
    const created = seedLib.loadSeed(kb.store, kb.classes, file);
    console.log(JSON.stringify(created, null, 2));
  } else if (cmd === 'search') {
    const query = args._[1];
    if (!query) usage('search "<query>"');
    const filters = {};
    if (typeof args.kind === 'string') filters.kind = args.kind;
    if (typeof args.class === 'string') filters.source_class = args.class;
    if (typeof args.tag === 'string') filters.tag = args.tag;
    if (typeof args.after === 'string') filters.after = args.after;
    if (typeof args.before === 'string') filters.before = args.before;
    const hits = kb.search(query, {
      mode: typeof args.mode === 'string' ? args.mode : 'hybrid',
      filters,
      limit: args.limit ? Number(args.limit) : 10,
    });
    console.log(JSON.stringify(hits, null, 2));
  } else if (cmd === 'export') {
    const res = kb.exportRecords({
      kind: typeof args.kind === 'string' ? args.kind : undefined,
      source_class: typeof args.class === 'string' ? args.class : undefined,
      history: args.history === true,
    });
    if (typeof args.out === 'string') {
      fs.writeFileSync(args.out, res.jsonl);
      console.log(JSON.stringify({ written: args.out, count: res.count, objects: res.objects.length }, null, 2));
    } else {
      process.stdout.write(res.jsonl);
    }
  } else if (cmd === 'validate') {
    const res = kb.verify();
    console.log(JSON.stringify(res, null, 2));
    if (!res.ok) process.exit(1);
  } else if (cmd === 'stats') {
    console.log(JSON.stringify(kb.stats(), null, 2));
  } else {
    usage('unknown command ' + cmd);
  }
}

try { main(); } catch (e) {
  console.error(String(e && e.message || e));
  process.exit(1);
}
