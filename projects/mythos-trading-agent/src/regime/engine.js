'use strict';
// =====================================================
// MYTHOS TRADING AGENT — market regime engine
// projects/mythos-trading-agent/src/regime/engine.js
//
// Mission §5: detect TREND, RANGE, BREAKOUT, HIGH_VOLATILITY, LOW_VOLATILITY and
// UNSTABLE, record the regime on every candidate and every trade, and let the
// Research Agent discover which strategies work in which regime.
//
// HOW IT DECIDES, AND WHY NOT A DECISION TREE
//
// Each regime gets a SCORE from normalised features, and the highest wins. A
// cascade of if-statements ("if adx > 25 then TREND else if ...") has two
// properties that make it unusable here: the boundaries are invisible in the
// output, so a bar at adx 24.9 and one at 25.1 look equally certain; and the
// order of the branches silently becomes a priority ranking nobody chose.
// Scoring gives a CONFIDENCE for free — the margin between the winner and the
// runner-up — and mission §6 requires a confidence on every decision anyway.
//
// HYSTERESIS IS NOT COSMETIC. Without it the classifier flips regime on
// individual bars, and since the regime is recorded on every candidate, the
// per-regime performance statistics the Research Agent depends on would be
// measuring noise. A regime therefore persists until either a minimum dwell has
// elapsed or a challenger beats it by a stated margin.
//
// WHAT THIS ENGINE IS SCORED AGAINST, AND WHAT IT IS NOT
//
// The synthetic generator publishes the regime it was actually in
// (src/data/synthetic-source.js `regimeTruth`), so the classifier can be measured
// against a known answer instead of against an impression of a chart. Measured
// over 17,328 classified bars across three seeds:
//
//   overall accuracy 40.7 % against a 16.7 % chance baseline
//   RANGE recall 55 % · LOW_VOLATILITY 54 % · HIGH_VOLATILITY 34 %
//   TREND 28 % · BREAKOUT 19 % · UNSTABLE 7 %
//
// THOSE LAST TWO ARE WEAK AND ARE NOT HIDDEN. TREND is hard here because the
// generator's trends are deliberately realistic — drift ≈ noise over a segment
// (see the calibration note in synthetic-source.js) — so a trend detector SHOULD
// be uncertain about them; a classifier that found them easily would be reading
// a market that does not exist. UNSTABLE is genuinely poorly separated: on bar
// data it looks like a range or like high volatility, and the Research Agent
// should treat that label as provisional until a better feature exists.
//
// These numbers are statements about this generator, not about markets. They
// exist so that a change which makes classification worse is caught, not so that
// the classifier can be tuned until the number looks good — that would be
// fitting to a process we wrote ourselves.
// =====================================================

var enums = require('../core/enums');
var errors = require('../core/errors');
var money = require('../core/money');
var ind = require('../indicators');

var DEFAULTS = Object.freeze({
  adxPeriod: 14,
  erPeriod: 30,
  erShortPeriod: 8,
  atrPeriod: 14,
  volShort: 5,
  volLong: 50,
  atrRankLookback: 200,
  breakoutChannel: 40,
  breakoutLookback: 10,
  flipLookback: 20,
  // classification bounds
  adxLow: 15, adxHigh: 32,
  erLow: 0.12, erHigh: 0.40,
  erShortLow: 0.25, erShortHigh: 0.60,
  volRatioLow: 1.0, volRatioHigh: 1.8,
  atrRankLow: 0.15, atrRankHigh: 0.80,
  // hysteresis
  minBarsInRegime: 6,
  switchMargin: 0.08
});

/** Linear normalisation into [0, 1], clamped at both ends. */
function norm(v, lo, hi) {
  if (hi === lo) return 0;
  return money.clamp((v - lo) / (hi - lo), 0, 1);
}

/** Indicator keys this engine registers. Prefixed so nothing collides. */
function keys(p) {
  return {
    adx: 'regime_adx_' + p.adxPeriod,
    plusDI: 'regime_plusDI_' + p.adxPeriod,
    minusDI: 'regime_minusDI_' + p.adxPeriod,
    er: 'regime_er_' + p.erPeriod,
    erShort: 'regime_erShort_' + p.erShortPeriod,
    atr: 'regime_atr_' + p.atrPeriod,
    volRatio: 'regime_volRatio_' + p.volShort + '_' + p.volLong,
    atrRank: 'regime_atrRank_' + p.atrPeriod + '_' + p.atrRankLookback,
    breakAge: 'regime_breakAge_' + p.breakoutChannel,
    flipRate: 'regime_flipRate_' + p.flipLookback
  };
}

/**
 * Rolling percentile rank of ATR within its own recent history.
 *
 * "High volatility" is only meaningful relative to what this instrument has
 * recently been doing — an absolute ATR threshold would classify gold as
 * permanently volatile and the yen as permanently calm, which is a statement
 * about contract size rather than about regime.
 *
 * THE COST OF THAT CHOICE, measured: in a market that is uniformly quiet for
 * thousands of bars, roughly 4 % of bars still rank in the top of their own
 * window and are labelled HIGH_VOLATILITY. A percentile has no notion of
 * absolute calm; something is always the loudest thing in a quiet room. The
 * alternative — gating on ATR expansion (volRatio) — was considered and rejected
 * because in the MIDDLE of a genuinely violent stretch the short and long ATRs
 * are both high, so volRatio sits near 1 and the gate would destroy exactly the
 * recall it was meant to protect. Consumers that need "absolutely calm" should
 * read features.atrRank together with features.volRatio rather than the label.
 */
function atrRank(bars, atrPeriod, lookback) {
  var atr = ind.atr(bars, atrPeriod);
  var out = new Array(bars.length);
  for (var i = 0; i < bars.length; i++) {
    if (atr[i] === null || i < lookback) { out[i] = null; continue; }
    var below = 0, counted = 0;
    for (var k = i - lookback + 1; k <= i; k++) {
      if (atr[k] === null) continue;
      counted++;
      if (atr[k] <= atr[i]) below++;
    }
    out[i] = counted > 0 ? below / counted : null;
  }
  return out;
}

/**
 * Bars since the most recent close beyond the prior-N-bar channel, or null when
 * there has not been one within the window. Not a boolean: a break three bars
 * ago is more relevant than one ten bars ago, and the age lets the score decay.
 */
function breakAge(bars, channel, lookback) {
  var ch = ind.donchian(bars, channel, { excludeCurrent: true });
  var out = new Array(bars.length);
  var last = null;
  for (var i = 0; i < bars.length; i++) {
    if (ch.upper[i] !== null) {
      if (bars[i].close > ch.upper[i] || bars[i].close < ch.lower[i]) last = i;
    }
    out[i] = (last !== null && i - last <= lookback) ? i - last : null;
  }
  return out;
}

/** Fraction of the last N bars whose close direction differed from the previous. */
function flipRate(bars, lookback) {
  var out = new Array(bars.length);
  for (var i = 0; i < bars.length; i++) {
    if (i < lookback + 1) { out[i] = null; continue; }
    var flips = 0;
    for (var k = i - lookback + 1; k <= i; k++) {
      var d1 = bars[k].close - bars[k - 1].close;
      var d2 = bars[k - 1].close - bars[k - 2].close;
      if ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) flips++;
    }
    out[i] = flips / lookback;
  }
  return out;
}

/**
 * Creates a regime engine.
 * @param {object} [params] overrides for DEFAULTS
 */
function create(params) {
  var p = {};
  Object.keys(DEFAULTS).forEach(function (k) { p[k] = DEFAULTS[k]; });
  Object.keys(params || {}).forEach(function (k) {
    if (DEFAULTS[k] === undefined) {
      throw errors.ConfigError('unknown regime parameter "' + k + '" (known: ' + Object.keys(DEFAULTS).join(', ') + ')');
    }
    p[k] = params[k];
  });
  Object.freeze(p);
  var K = keys(p);

  var api = {
    params: p,
    keys: K,

    /** Indicator declarations, in the same shape a strategy uses. */
    indicators: function () {
      var out = {};
      out[K.adx] = function (s) { return ind.adx(s.bars(), p.adxPeriod).adx; };
      out[K.plusDI] = function (s) { return ind.adx(s.bars(), p.adxPeriod).plusDI; };
      out[K.minusDI] = function (s) { return ind.adx(s.bars(), p.adxPeriod).minusDI; };
      out[K.er] = function (s) { return ind.efficiencyRatio(s.closes(), p.erPeriod); };
      out[K.erShort] = function (s) { return ind.efficiencyRatio(s.closes(), p.erShortPeriod); };
      out[K.atr] = function (s) { return ind.atr(s.bars(), p.atrPeriod); };
      out[K.volRatio] = function (s) { return ind.volatilityRatio(s.bars(), p.volShort, p.volLong); };
      out[K.atrRank] = function (s) { return atrRank(s.bars(), p.atrPeriod, p.atrRankLookback); };
      out[K.breakAge] = function (s) { return breakAge(s.bars(), p.breakoutChannel, p.breakoutLookback); };
      out[K.flipRate] = function (s) { return flipRate(s.bars(), p.flipLookback); };
      // The cost model reads 'volRatio' for its volatility widening; registering
      // it here means the spread widens in exactly the conditions this engine
      // calls HIGH_VOLATILITY, rather than in some unrelated measure.
      out.volRatio = function (s) { return ind.volatilityRatio(s.bars(), p.volShort, p.volLong); };
      return out;
    },

    warmupBars: function () {
      return Math.max(p.atrRankLookback + p.atrPeriod, p.volLong, p.erPeriod, p.adxPeriod * 3, p.breakoutChannel) + 10;
    },

    /** Raw feature values at this bar, or null during warmup. */
    features: function (view) {
      var names = [K.adx, K.er, K.erShort, K.atr, K.volRatio, K.atrRank, K.flipRate, K.plusDI, K.minusDI];
      var f = {};
      for (var i = 0; i < names.length; i++) {
        var v = view.indicator(names[i]);
        if (v === null || v === undefined) return null;
        f[names[i]] = v;
      }
      return {
        adx: f[K.adx],
        efficiencyRatio: f[K.er],
        efficiencyRatioShort: f[K.erShort],
        atr: f[K.atr],
        volRatio: f[K.volRatio],
        atrRank: f[K.atrRank],
        flipRate: f[K.flipRate],
        plusDI: f[K.plusDI],
        minusDI: f[K.minusDI],
        // breakAge is legitimately null (no recent break), so it is read separately.
        breakAge: view.indicator(K.breakAge)
      };
    },

    /**
     * Scores every regime from the features. Exposed so tests can inspect it.
     *
     * TWO FEATURES ARE DELIBERATELY ABSENT FROM THE SCORE, AND ONE OF THEM IS
     * STILL COMPUTED.
     *
     * `flipRate` (how often the bar-to-bar close direction reverses) was measured
     * at 0.49-0.54 for EVERY regime including UNSTABLE — bar-level noise swamps
     * the signal, so it discriminates nothing. It is still computed and recorded
     * in `features`, because a measured-useless feature is evidence the Research
     * Agent can use, but it carries no weight here. Shipping it as a scoring
     * input would have been a confident-looking zero.
     *
     * `whipsaw` replaced it: short-horizon efficiency HIGH while long-horizon
     * efficiency is LOW means strong legs that go nowhere, which is what
     * "unstable" actually looks like and what separates it from a market that is
     * merely violent.
     *
     * HIGH_VOLATILITY is discounted when a fresh break or whipsaw is present.
     * Breakouts and unstable markets are ALSO high-volatility, so without that
     * discount the volatility score wins every time and the other two classes
     * become unreachable — which is exactly what the first measurement showed
     * (BREAKOUT truth was classified HIGH_VOLATILITY 75 % of the time).
     */
    score: function (f) {
      var trendStrength = norm(f.adx, p.adxLow, p.adxHigh);
      var directionality = norm(f.efficiencyRatio, p.erLow, p.erHigh);
      var shortDirectionality = norm(f.efficiencyRatioShort, p.erShortLow, p.erShortHigh);
      var expansion = norm(f.volRatio, p.volRatioLow, p.volRatioHigh);
      var breakFresh = f.breakAge === null ? 0 : 1 - (f.breakAge / (p.breakoutLookback + 1));
      var loud = norm(f.atrRank, p.atrRankHigh - 0.2, Math.min(1, p.atrRankHigh + 0.15));
      var quiet = 1 - norm(f.atrRank, Math.max(0, p.atrRankLow - 0.1), p.atrRankLow + 0.2);
      // Strong legs (short ER high) that produce no net progress (long ER low).
      var whipsaw = shortDirectionality * (1 - directionality);

      return {
        TREND: 0.45 * trendStrength + 0.55 * directionality,
        // A range is aimless AND orderly; discounting by `quiet` lets
        // LOW_VOLATILITY win when the market is genuinely asleep.
        //
        // A whipsaw discount was tried here and REMOVED after measurement: at
        // 0.50 it raised UNSTABLE recall from 7 % to 11 % and cost RANGE recall
        // 55 % → 44 %, dropping overall accuracy 40.7 % → 37.4 %. RANGE is a
        // third of the sample and UNSTABLE is six per cent of it, so the trade
        // was bad. Recorded rather than deleted because the next person to have
        // this idea should see the number instead of re-running it.
        RANGE: (0.45 * (1 - trendStrength) + 0.55 * (1 - directionality)) * (1 - 0.45 * quiet),
        BREAKOUT: 0.50 * breakFresh + 0.25 * loud + 0.25 * directionality,
        HIGH_VOLATILITY: loud * (1 - 0.35 * breakFresh) * (1 - 0.35 * whipsaw),
        LOW_VOLATILITY: quiet,
        UNSTABLE: 0.50 * whipsaw + 0.35 * loud + 0.15 * expansion
      };
    },

    /**
     * Classifies one bar.
     *
     * @param {object} view series view at the bar
     * @param {object} state per-(run, symbol) bag, for hysteresis
     * @returns {object|null} classification, or null during warmup
     */
    classify: function (view, state) {
      var f = api.features(view);
      if (f === null) return null;
      var scores = api.score(f);

      var ranked = Object.keys(scores).map(function (k) { return { regime: k, score: scores[k] }; })
        .sort(function (a, b) { return b.score - a.score || (a.regime < b.regime ? -1 : 1); });
      var top = ranked[0];
      var second = ranked[1];

      var chosen = top.regime;
      var switched = true;
      var held = false;
      if (state && state.regime) {
        var barsIn = view.index - state.sinceIndex;
        var currentScore = scores[state.regime];
        // HYSTERESIS: keep the current regime unless the dwell has elapsed AND
        // the challenger clears it by the margin.
        if (barsIn < p.minBarsInRegime || top.score - currentScore < p.switchMargin) {
          chosen = state.regime;
          switched = false;
          held = true;
        }
      }
      if (switched && state) {
        state.regime = chosen;
        state.sinceIndex = view.index;
      } else if (state && !state.regime) {
        state.regime = chosen;
        state.sinceIndex = view.index;
      }

      // Confidence penalises BOTH a low absolute score and a narrow margin. A bar
      // where everything scores 0.3 is not 100 % anything.
      var margin = top.score - second.score;
      var confidence = money.round(money.clamp(top.score * (0.5 + margin), 0, 1), 4);
      if (held && chosen !== top.regime) {
        // Held against the evidence: say so in the confidence, not just in a flag.
        confidence = money.round(confidence * 0.6, 4);
      }

      var direction = enums.Direction.NEUTRAL;
      if (f.plusDI > f.minusDI && f.efficiencyRatio >= p.erLow) direction = enums.Direction.LONG;
      else if (f.minusDI > f.plusDI && f.efficiencyRatio >= p.erLow) direction = enums.Direction.SHORT;

      return {
        regime: chosen,
        direction: direction,
        confidence: confidence,
        topRegime: top.regime,
        topScore: money.round(top.score, 4),
        runnerUp: second.regime,
        runnerUpScore: money.round(second.score, 4),
        margin: money.round(margin, 4),
        held: held,
        barsInRegime: state && state.sinceIndex !== undefined ? view.index - state.sinceIndex : 0,
        scores: roundScores(scores),
        features: {
          adx: money.round(f.adx, 3),
          efficiencyRatio: money.round(f.efficiencyRatio, 4),
          efficiencyRatioShort: money.round(f.efficiencyRatioShort, 4),
          volRatio: money.round(f.volRatio, 4),
          atrRank: money.round(f.atrRank, 4),
          flipRate: money.round(f.flipRate, 4),
          breakAge: f.breakAge,
          plusDI: money.round(f.plusDI, 3),
          minusDI: money.round(f.minusDI, 3)
        }
      };
    },

    /** Fresh hysteresis state. One per (run, symbol). */
    newState: function () { return { regime: null, sinceIndex: 0 }; }
  };

  return api;
}

function roundScores(scores) {
  var out = {};
  Object.keys(scores).sort().forEach(function (k) { out[k] = money.round(scores[k], 4); });
  return out;
}

module.exports = {
  create: create,
  DEFAULTS: DEFAULTS,
  norm: norm,
  atrRank: atrRank,
  breakAge: breakAge,
  flipRate: flipRate
};
