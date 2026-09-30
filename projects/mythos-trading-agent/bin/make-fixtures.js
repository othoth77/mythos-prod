#!/usr/bin/env node
'use strict';
// =====================================================
// MYTHOS TRADING AGENT — fixture generator
// projects/mythos-trading-agent/bin/make-fixtures.js
//
// Regenerates the committed fixtures under fixtures/ from the seeded synthetic
// generator. Run deliberately, never as part of a test: the point of a fixture
// is that it does NOT move when the generator is tuned.
//
//   node bin/make-fixtures.js            # regenerate with the standard spec
//   node bin/make-fixtures.js --check    # verify the committed files match
//
// --check is what CI (or a reviewer) uses to see whether a fixture was edited
// by hand: it re-reads every file and re-verifies its content hash.
// =====================================================

var path = require('path');
var fs = require('fs');

var instrument = require('../src/core/instrument');
var synthetic = require('../src/data/synthetic-source');
var fixtureSource = require('../src/data/fixture-source');

/**
 * The fixture set. Deliberately small — a few thousand bars per symbol is
 * enough to exercise every mechanism and keeps the repository reviewable.
 */
var SPEC = {
  seed: 'mythos-fixtures-v1',
  startIso: '2023-01-02T00:00:00Z',
  timeframe: 'M15',
  bars: 3000,
  symbols: ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD']
};

function build() {
  var catalog = instrument.defaultCatalog();
  return SPEC.symbols.map(function (sym) {
    var res = synthetic.generate({
      instrument: catalog.get(sym),
      timeframe: SPEC.timeframe,
      bars: SPEC.bars,
      seed: SPEC.seed + '::' + sym,
      startIso: SPEC.startIso
    });
    return {
      symbol: sym,
      timeframe: SPEC.timeframe,
      bars: res.bars,
      provenance: {
        generator: res.params.generator,
        seed: res.params.seed,
        startIso: res.params.startIso,
        annualVol: res.params.annualVol,
        note: 'SYNTHETIC. Mechanics only — no statement about edge or profitability can be derived from this data.',
        regimeSegments: res.segments
      }
    };
  });
}

function fileFor(sym, tf) {
  return path.join(fixtureSource.FIXTURE_DIR, sym.toLowerCase() + '-' + tf.toLowerCase() + '.json');
}

function main() {
  var check = process.argv.indexOf('--check') !== -1;
  var built = build();
  var failures = [];

  built.forEach(function (fx) {
    var file = fileFor(fx.symbol, fx.timeframe);
    var expected = fixtureSource.barsVersion(fx.bars);
    if (check) {
      if (!fs.existsSync(file)) {
        failures.push(path.basename(file) + ': missing');
        return;
      }
      var onDisk = fixtureSource.read(file); // also re-verifies its own hash
      if (onDisk.datasetVersion !== expected) {
        failures.push(path.basename(file) + ': content ' + onDisk.datasetVersion + ' does not match the generator spec ' + expected);
      } else {
        process.stdout.write('ok   ' + path.basename(file) + '  ' + onDisk.bars.length + ' bars  ' + onDisk.datasetVersion + '\n');
      }
    } else {
      var version = fixtureSource.write(file, fx);
      process.stdout.write('wrote ' + path.basename(file) + '  ' + fx.bars.length + ' bars  ' + version + '\n');
    }
  });

  if (failures.length) {
    process.stderr.write('\nFIXTURE CHECK FAILED:\n  - ' + failures.join('\n  - ') + '\n');
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = { SPEC: SPEC, build: build, fileFor: fileFor };
