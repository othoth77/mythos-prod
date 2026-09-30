'use strict';
// =====================================================
// MYTHOS TRADING AGENT — committed fixture data source
// projects/mythos-trading-agent/src/data/fixture-source.js
//
// The synthetic generator is reproducible from its seed, but only as long as
// the generator itself never changes. The moment REGIME_MODELS is tuned, every
// "reproducible" backtest silently describes different bars.
//
// Committed fixtures are the fix: a frozen, versioned dataset in the repository
// that regression tests and champion/challenger comparisons can be pinned to.
// A fixture's datasetVersion is a hash of its BARS, not of the parameters that
// produced them, so editing a bar by hand changes the version and any run that
// cited the old one is visibly no longer reproducible.
//
// Format (compact, so a few thousand bars stay a reviewable diff):
//   { schemaVersion, symbol, timeframe, datasetVersion, columns, bars: [[...]] }
// =====================================================

var fs = require('fs');
var path = require('path');

var errors = require('../core/errors');
var hashMod = require('../core/hash');
var enums = require('../core/enums');
var barMod = require('./bar');
var sourceMod = require('./source');

var COLUMNS = ['ts', 'open', 'high', 'low', 'close', 'volume'];
var FIXTURE_DIR = path.join(__dirname, '..', '..', 'fixtures');

/** Content hash of a bar array — the fixture's identity. */
function barsVersion(bars) {
  return 'fixture-' + hashMod.shortHash(bars.map(function (b) {
    return [b.ts, b.open, b.high, b.low, b.close, b.volume];
  }));
}

/** Serialises bars into the compact fixture document. */
function toDocument(spec) {
  enums.assertEnum(enums.Timeframe, spec.timeframe, 'timeframe');
  barMod.validateSeries(spec.bars, { timeframe: spec.timeframe });
  var rows = spec.bars.map(function (b) { return [b.ts, b.open, b.high, b.low, b.close, b.volume]; });
  return {
    schemaVersion: 1,
    symbol: spec.symbol,
    timeframe: spec.timeframe,
    datasetVersion: barsVersion(spec.bars),
    provenance: spec.provenance || null,
    columns: COLUMNS,
    barCount: rows.length,
    firstBarTs: rows[0][0],
    lastBarTs: rows[rows.length - 1][0],
    bars: rows
  };
}

/** Parses a fixture document, verifying its declared version against content. */
function fromDocument(doc, filePathForErrors) {
  var where = filePathForErrors ? ' (' + filePathForErrors + ')' : '';
  if (!doc || doc.schemaVersion !== 1) {
    throw errors.DataError('fixture' + where + ' has an unsupported schemaVersion ' + (doc && doc.schemaVersion));
  }
  if (!Array.isArray(doc.columns) || doc.columns.join(',') !== COLUMNS.join(',')) {
    throw errors.DataError('fixture' + where + ' must declare columns [' + COLUMNS.join(', ') + ']');
  }
  if (!Array.isArray(doc.bars) || doc.bars.length === 0) {
    throw errors.DataError('fixture' + where + ' contains no bars');
  }
  var bars = doc.bars.map(function (r, i) {
    if (!Array.isArray(r) || r.length !== COLUMNS.length) {
      throw errors.DataError('fixture' + where + ' row ' + i + ' must have ' + COLUMNS.length + ' columns');
    }
    return { ts: r[0], open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5] };
  });
  barMod.validateSeries(bars, { timeframe: doc.timeframe });

  var actual = barsVersion(bars);
  if (doc.datasetVersion !== actual) {
    throw errors.DataError(
      'fixture' + where + ' declares datasetVersion ' + doc.datasetVersion + ' but its bars hash to ' + actual +
      '. The file was edited without re-versioning; every run that cited the old version is no longer reproducible.',
      { declared: doc.datasetVersion, actual: actual }
    );
  }
  return { symbol: doc.symbol, timeframe: doc.timeframe, datasetVersion: actual, bars: bars, provenance: doc.provenance || null };
}

/** Writes a fixture file. Used by bin/make-fixtures.js, never at runtime. */
function write(filePath, spec) {
  var doc = toDocument(spec);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  // One bar per line: a data diff should be readable in a pull request.
  var head = JSON.stringify({
    schemaVersion: doc.schemaVersion, symbol: doc.symbol, timeframe: doc.timeframe,
    datasetVersion: doc.datasetVersion, provenance: doc.provenance, columns: doc.columns,
    barCount: doc.barCount, firstBarTs: doc.firstBarTs, lastBarTs: doc.lastBarTs
  }, null, 2);
  var body = doc.bars.map(function (r) { return '    ' + JSON.stringify(r); }).join(',\n');
  var text = head.slice(0, head.length - 2) + ',\n  "bars": [\n' + body + '\n  ]\n}\n';
  fs.writeFileSync(filePath, text);
  return doc.datasetVersion;
}

/** Reads one fixture file. */
function read(filePath) {
  var raw;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    throw errors.DataError('cannot read fixture ' + filePath + ': ' + e.message);
  }
  return fromDocument(raw, filePath);
}

/**
 * A data source over every `*.json` fixture in a directory.
 * @param {object} [opts]
 * @param {string} [opts.dir] defaults to projects/mythos-trading-agent/fixtures
 */
function createSource(opts) {
  var o = opts || {};
  var dir = o.dir || FIXTURE_DIR;
  if (!fs.existsSync(dir)) {
    throw errors.DataError('fixture directory ' + dir + ' does not exist');
  }
  var files = fs.readdirSync(dir).filter(function (f) { return /\.json$/.test(f); }).sort();
  if (files.length === 0) {
    throw errors.DataError('no fixtures in ' + dir + '; generate them with bin/make-fixtures.js');
  }

  var data = Object.create(null);
  var versions = [];
  files.forEach(function (f) {
    var fx = read(path.join(dir, f));
    if (!data[fx.symbol]) data[fx.symbol] = Object.create(null);
    if (data[fx.symbol][fx.timeframe]) {
      throw errors.DataError('two fixtures claim ' + fx.symbol + ' ' + fx.timeframe + ' in ' + dir);
    }
    data[fx.symbol][fx.timeframe] = fx;
    versions.push(fx.symbol + ':' + fx.timeframe + ':' + fx.datasetVersion);
  });

  // The source's version covers the whole set, so adding or changing any one
  // fixture changes what every run that used this source cites.
  var datasetVersion = 'fixtures-' + hashMod.shortHash(versions.sort());

  return sourceMod.assertSource({
    kind: 'fixture',
    datasetVersion: datasetVersion,
    symbols: function () { return Object.keys(data).sort(); },
    timeframes: function (symbol) { return data[symbol] ? Object.keys(data[symbol]).sort() : []; },
    load: function (symbol, timeframe, range) {
      var bySymbol = data[symbol];
      if (!bySymbol) {
        throw errors.DataError('no fixture for ' + symbol + ' (have: ' + Object.keys(data).join(', ') + ')');
      }
      var fx = bySymbol[timeframe];
      if (!fx) {
        throw errors.DataError('no ' + timeframe + ' fixture for ' + symbol +
          ' (have: ' + Object.keys(bySymbol).join(', ') + ')');
      }
      if (!range || (range.fromTs === undefined && range.toTs === undefined)) return fx.bars;
      return barMod.slice(fx.bars, range.fromTs, range.toTs);
    },
    describe: function () {
      return {
        kind: 'fixture', dir: dir, datasetVersion: datasetVersion,
        fixtures: versions.slice(),
        warning: 'Fixtures in this repository were produced by the synthetic generator. They are frozen and versioned, but they are still synthetic — see docs/COMPLIANCE_AND_RISK.md §3.4.'
      };
    },
    provenance: function (symbol, timeframe) {
      return data[symbol] && data[symbol][timeframe] ? data[symbol][timeframe].provenance : null;
    }
  });
}

module.exports = {
  COLUMNS: COLUMNS,
  FIXTURE_DIR: FIXTURE_DIR,
  barsVersion: barsVersion,
  toDocument: toDocument,
  fromDocument: fromDocument,
  read: read,
  write: write,
  createSource: createSource
};
