'use strict';
// =====================================================
// MYTHOS TRADING AGENT — time handling
// projects/mythos-trading-agent/src/core/clock.js
//
// All platform time is UTC epoch milliseconds. There is no local time anywhere:
// a backtest that depends on the host's timezone is not reproducible, and a
// session filter ("London open") that silently shifts with the VPS's TZ setting
// would change which trades a strategy takes.
//
// Session boundaries are therefore declared in UTC hours on the instrument's
// schedule, with DST explicitly acknowledged as an approximation in
// docs/COMPLIANCE_AND_RISK.md rather than silently ignored.
// =====================================================

var enums = require('./enums');

var MINUTE = 60 * 1000;
var HOUR = 60 * MINUTE;
var DAY = 24 * HOUR;

/** Parses an ISO-8601 UTC timestamp into epoch ms. Throws on anything else. */
function parse(iso) {
  if (typeof iso === 'number' && isFinite(iso)) return iso;
  if (typeof iso !== 'string') throw new TypeError('clock.parse() expects an ISO string or epoch ms, got ' + JSON.stringify(iso));
  var t = Date.parse(iso);
  if (!isFinite(t)) throw new TypeError('clock.parse(): unparseable timestamp ' + JSON.stringify(iso));
  return t;
}

/** Epoch ms → ISO-8601 UTC with milliseconds. */
function iso(ms) {
  return new Date(ms).toISOString();
}

/** Minutes in a standard timeframe label. */
function timeframeMinutes(tf) {
  enums.assertEnum(enums.Timeframe, tf, 'timeframe');
  return enums.TIMEFRAME_MINUTES[tf];
}

/** Floors a timestamp to the open of its bar for the given timeframe. */
function floorToTimeframe(ms, tf) {
  var step = timeframeMinutes(tf) * MINUTE;
  return Math.floor(ms / step) * step;
}

/** Adds n bars of the given timeframe. */
function addBars(ms, tf, n) {
  return ms + timeframeMinutes(tf) * MINUTE * n;
}

function addMinutes(ms, n) { return ms + n * MINUTE; }
function addHours(ms, n) { return ms + n * HOUR; }
function addDays(ms, n) { return ms + n * DAY; }

/** UTC day of week, 0 = Sunday … 6 = Saturday. */
function weekday(ms) {
  return new Date(ms).getUTCDay();
}

/** UTC hour, 0-23. */
function hour(ms) {
  return new Date(ms).getUTCHours();
}

/** UTC minute of day, 0-1439. */
function minuteOfDay(ms) {
  var d = new Date(ms);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** 'YYYY-MM-DD' in UTC — the daily bucket key for daily loss limits. */
function dayKey(ms) {
  return iso(ms).slice(0, 10);
}

/** 'YYYY-WW' ISO-ish week key, used by weekly aggregation in analytics. */
function weekKey(ms) {
  var d = new Date(ms);
  var target = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  // Shift to the Thursday of the same ISO week, then count weeks from Jan 4th.
  var dow = (new Date(target).getUTCDay() + 6) % 7; // Monday = 0
  var thursday = target + (3 - dow) * DAY;
  var year = new Date(thursday).getUTCFullYear();
  var jan4 = Date.UTC(year, 0, 4);
  var jan4dow = (new Date(jan4).getUTCDay() + 6) % 7;
  var week1Monday = jan4 - jan4dow * DAY;
  var wk = Math.floor((thursday - week1Monday) / (7 * DAY)) + 1;
  return year + '-W' + (wk < 10 ? '0' + wk : String(wk));
}

/**
 * True when the FX market is closed at `ms`: from Friday 21:00 UTC to Sunday
 * 21:00 UTC. Deliberately conservative — a wider closed window drops a few
 * legitimate bars rather than pretending an untradable weekend price is
 * tradable, which is the bias direction a backtest can afford.
 */
function isForexWeekend(ms) {
  var dow = weekday(ms);
  var h = hour(ms);
  if (dow === 6) return true;                 // Saturday
  if (dow === 5 && h >= 21) return true;      // Friday evening
  if (dow === 0 && h < 21) return true;       // Sunday before the open
  return false;
}

/** Inclusive-start, exclusive-end UTC hour window test, wrapping midnight. */
function inHourWindow(ms, startHour, endHour) {
  var h = hour(ms);
  if (startHour === endHour) return true; // 24h window
  if (startHour < endHour) return h >= startHour && h < endHour;
  return h >= startHour || h < endHour;   // wraps midnight (e.g. 22 → 6)
}

module.exports = {
  MINUTE: MINUTE,
  HOUR: HOUR,
  DAY: DAY,
  parse: parse,
  iso: iso,
  timeframeMinutes: timeframeMinutes,
  floorToTimeframe: floorToTimeframe,
  addBars: addBars,
  addMinutes: addMinutes,
  addHours: addHours,
  addDays: addDays,
  weekday: weekday,
  hour: hour,
  minuteOfDay: minuteOfDay,
  dayKey: dayKey,
  weekKey: weekKey,
  isForexWeekend: isForexWeekend,
  inHourWindow: inHourWindow
};
