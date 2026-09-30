'use strict';
// =====================================================
// MYTHOS TRADING AGENT — account state
// projects/mythos-trading-agent/src/account/account.js
//
// The account is the only thing that knows how much money there is, and the
// Risk Engine's limits are all expressed against it. Two choices are worth
// stating because they change what the limits mean:
//
//  1. DRAWDOWN IS MEASURED ON EQUITY, NOT ON BALANCE. Balance only moves when a
//     trade closes, so a balance-based drawdown limit cannot fire while a
//     losing position is still open — exactly the moment it is needed. Peak and
//     trough are therefore tracked on mark-to-market equity.
//
//  2. THE DAILY LOSS LIMIT IS KEYED ON THE UTC DAY OF THE TRADE'S EXIT, and it
//     accumulates realised net P&L. A position opened before midnight and
//     closed after it charges the new day. Any convention has an edge case;
//     this one is stated so a report can be read correctly.
//
// The account records but never decides. It has no authority to refuse a trade —
// that is the Risk Engine's job, and this object exists so the Risk Engine has
// something truthful to ask.
// =====================================================

var money = require('../core/money');
var clock = require('../core/clock');
var enums = require('../core/enums');
var errors = require('../core/errors');

/**
 * @param {object} spec
 * @param {number} spec.initialCapital
 * @param {object} [spec.logger]
 * @param {object} [spec.store] when given, equity samples and trades are recorded
 */
function create(spec) {
  var initial = spec.initialCapital;
  if (!(initial > 0)) throw errors.ConfigError('account initialCapital must be > 0, got ' + initial);
  var logger = spec.logger || require('../core/logger').nullLogger();
  var store = spec.store || null;

  var balance = money.money(initial);
  var equity = balance;
  var peakEquity = balance;
  var troughSincePeak = balance;
  var maxDrawdownMoney = 0;
  var maxDrawdownPct = 0;

  var dailyNet = Object.create(null);   // dayKey → realised net P&L that day
  var consecutiveLosses = 0;
  var maxConsecutiveLosses = 0;
  var consecutiveWins = 0;
  var wins = 0, losses = 0, breakevens = 0;
  var grossProfit = 0, grossLoss = 0, totalCosts = 0;
  var tradeCount = 0;
  var equitySamples = [];
  var lastTs = null;

  function recordEquity(ts, openPnl, openRisk) {
    equity = money.money(balance + (openPnl || 0));
    if (equity > peakEquity) {
      peakEquity = equity;
      troughSincePeak = equity;
    }
    if (equity < troughSincePeak) troughSincePeak = equity;
    var ddMoney = money.money(peakEquity - equity);
    var ddPct = money.fraction(ddMoney, peakEquity) * 100;
    if (ddMoney > maxDrawdownMoney) maxDrawdownMoney = ddMoney;
    if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct;
    lastTs = ts;
    var sample = {
      ts: ts,
      equity: equity,
      balance: balance,
      openRisk: money.money(openRisk || 0),
      drawdownPct: money.round(ddPct, 4)
    };
    equitySamples.push(sample);
    if (store) store.table('equity_curve').insert(sample);
    return sample;
  }

  var api = {
    initialCapital: money.money(initial),

    balance: function () { return balance; },
    equity: function () { return equity; },
    peakEquity: function () { return peakEquity; },

    /** Current drawdown from the equity peak, as a percentage. */
    drawdownPct: function () {
      return money.round(money.fraction(peakEquity - equity, peakEquity) * 100, 6);
    },
    drawdownMoney: function () { return money.money(peakEquity - equity); },
    maxDrawdownPct: function () { return money.round(maxDrawdownPct, 6); },
    maxDrawdownMoney: function () { return maxDrawdownMoney; },

    /**
     * Records mark-to-market equity. Called on every bar, including while a
     * position is open — that is what makes the drawdown limit able to fire
     * before a losing trade closes.
     */
    markToMarket: function (ts, openPnl, openRisk) {
      return recordEquity(ts, openPnl, openRisk);
    },

    /**
     * Applies a closed trade's NET result (after all costs).
     * @param {object} t { ts, netPnl, grossPnl, costsMoney, outcome }
     */
    applyTrade: function (t) {
      enums.assertEnum(enums.TradeOutcome, t.outcome, 'trade outcome');
      balance = money.money(balance + t.netPnl);
      tradeCount++;
      totalCosts = money.money(totalCosts + (t.costsMoney || 0));

      if (t.netPnl > 0) { grossProfit = money.money(grossProfit + t.netPnl); }
      else if (t.netPnl < 0) { grossLoss = money.money(grossLoss - t.netPnl); }

      if (t.outcome === enums.TradeOutcome.WIN) {
        wins++; consecutiveWins++; consecutiveLosses = 0;
      } else if (t.outcome === enums.TradeOutcome.LOSS) {
        losses++; consecutiveLosses++; consecutiveWins = 0;
        if (consecutiveLosses > maxConsecutiveLosses) maxConsecutiveLosses = consecutiveLosses;
      } else {
        breakevens++;
        // A breakeven breaks neither streak: it is not a loss, and treating it
        // as a win would let a run of scratches reset a genuine losing streak.
      }

      var key = clock.dayKey(t.ts);
      dailyNet[key] = money.money((dailyNet[key] || 0) + t.netPnl);

      recordEquity(t.ts, 0, 0);
      logger.info('account.trade.applied', {
        netPnl: t.netPnl, balance: balance, outcome: t.outcome,
        consecutiveLosses: consecutiveLosses, drawdownPct: api.drawdownPct()
      });
      return balance;
    },

    /** Realised net P&L for a UTC day; 0 when nothing closed that day. */
    dailyNet: function (ts) {
      return dailyNet[clock.dayKey(ts)] || 0;
    },
    /** Realised loss for the day as a positive number (0 when the day is up). */
    dailyLossMoney: function (ts) {
      var n = api.dailyNet(ts);
      return n < 0 ? money.money(-n) : 0;
    },
    dailyLossPct: function (ts) {
      return money.round(money.fraction(api.dailyLossMoney(ts), api.initialCapital) * 100, 6);
    },

    consecutiveLosses: function () { return consecutiveLosses; },
    maxConsecutiveLosses: function () { return maxConsecutiveLosses; },
    consecutiveWins: function () { return consecutiveWins; },
    tradeCount: function () { return tradeCount; },
    wins: function () { return wins; },
    losses: function () { return losses; },
    breakevens: function () { return breakevens; },
    equityCurve: function () { return equitySamples.slice(); },
    lastTs: function () { return lastTs; },

    /** Everything the Risk Engine and the reports need, in one object. */
    snapshot: function () {
      return {
        initialCapital: api.initialCapital,
        balance: balance,
        equity: equity,
        peakEquity: peakEquity,
        drawdownPct: api.drawdownPct(),
        maxDrawdownPct: api.maxDrawdownPct(),
        maxDrawdownMoney: maxDrawdownMoney,
        tradeCount: tradeCount,
        wins: wins,
        losses: losses,
        breakevens: breakevens,
        consecutiveLosses: consecutiveLosses,
        maxConsecutiveLosses: maxConsecutiveLosses,
        grossProfit: grossProfit,
        grossLoss: grossLoss,
        totalCosts: totalCosts,
        netProfit: money.money(balance - api.initialCapital),
        returnPct: money.round(money.fraction(balance - api.initialCapital, api.initialCapital) * 100, 6),
        lastTs: lastTs
      };
    }
  };

  // Seed the curve so an account that never trades still has a defined shape.
  return api;
}

module.exports = { create: create };
