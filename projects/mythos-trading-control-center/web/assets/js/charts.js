/* =============================================================================
   MYTHOS TRADING CONTROL CENTER — charts
   projects/mythos-trading-control-center/web/assets/js/charts.js

   Inline SVG, drawn from the numbers the API returned. Series colours come
   from the design system's data-visualisation tokens through CSS classes.

   WHAT A CHART HERE WILL NOT DO
     · It does not smooth. A line joins the recorded samples and nothing else,
       so a drawdown that happened is drawn at the depth it happened.
     · It does not draw from nothing. With fewer than two points it renders the
       NO DATA state — an empty axis looks like a flat result.
     · It does not hide its scale. The y axis is labelled from the data's own
       minimum and maximum; it is not forced to start at zero unless the caller
       asks, and the zero line is drawn whenever zero is in range.

   Every chart carries a text description (role="img" + aria-label) stating its
   range, so the information does not depend on seeing it.
   ============================================================================= */
(function () {
  'use strict';

  var TCC = window.TCC;
  var el = TCC.el;
  var svg = TCC.svg;

  var W = 640;

  function niceRange(min, max, includeZero) {
    if (includeZero) { if (min > 0) min = 0; if (max < 0) max = 0; }
    if (min === max) { var pad = Math.abs(min) > 0 ? Math.abs(min) * 0.05 : 1; return { min: min - pad, max: max + pad }; }
    var span = max - min;
    return { min: min - span * 0.06, max: max + span * 0.06 };
  }

  function legend(series) {
    return el('div', { class: 'chart-legend' }, series.map(function (s, i) {
      return el('span', null, [el('span', { class: 'swatch ' + (s.fill || 'f' + (i + 1)) }), s.name]);
    }));
  }

  /**
   * line({
   *   series: [{ name, points: [{ x, y }], cls: 's1', area: true }],
   *   height, yFormat(v), xFormat(x), includeZero, label
   * })
   */
  function line(o) {
    var series = (o.series || []).filter(function (s) { return s.points && s.points.length > 1; });
    if (!series.length) {
      return TCC.ui.state({ tag: 'NO DATA', compact: true, body: o.emptyText || 'Fewer than two samples are recorded; there is no curve to draw.' });
    }
    var H = o.height || 220;
    var m = { l: 58, r: 12, t: 10, b: 24 };
    var xs = [], ys = [];
    series.forEach(function (s) { s.points.forEach(function (p) { xs.push(p.x); ys.push(p.y); }); });
    var xMin = Math.min.apply(null, xs), xMax = Math.max.apply(null, xs);
    var yr = niceRange(Math.min.apply(null, ys), Math.max.apply(null, ys), o.includeZero);
    var iw = W - m.l - m.r, ih = H - m.t - m.b;
    function X(x) { return m.l + (xMax === xMin ? iw / 2 : ((x - xMin) / (xMax - xMin)) * iw); }
    function Y(y) { return m.t + ih - ((y - yr.min) / (yr.max - yr.min)) * ih; }
    var yFormat = o.yFormat || function (v) { return String(Math.round(v * 100) / 100); };
    var xFormat = o.xFormat || function (v) { return String(v); };

    var nodes = [];
    for (var i = 0; i <= 4; i++) {
      var v = yr.min + ((yr.max - yr.min) * i) / 4;
      var y = Y(v);
      nodes.push(svg('line', { class: 'grid-line', x1: m.l, x2: W - m.r, y1: y, y2: y }));
      nodes.push(svg('text', { x: m.l - 6, y: y + 3, 'text-anchor': 'end' }, [yFormat(v)]));
    }
    if (yr.min < 0 && yr.max > 0) nodes.push(svg('line', { class: 'zero-line', x1: m.l, x2: W - m.r, y1: Y(0), y2: Y(0) }));
    [xMin, (xMin + xMax) / 2, xMax].forEach(function (x, idx) {
      nodes.push(svg('text', { x: X(x), y: H - 6, 'text-anchor': idx === 0 ? 'start' : (idx === 2 ? 'end' : 'middle') }, [xFormat(x)]));
    });

    series.forEach(function (s, idx) {
      var cls = s.cls || 's' + (idx + 1);
      var d = s.points.map(function (p, k) { return (k ? 'L' : 'M') + X(p.x).toFixed(1) + ' ' + Y(p.y).toFixed(1); }).join(' ');
      if (s.area) {
        var base = Y(Math.max(yr.min, Math.min(yr.max, s.areaBase === undefined ? yr.min : s.areaBase)));
        var a = d + ' L' + X(s.points[s.points.length - 1].x).toFixed(1) + ' ' + base.toFixed(1) +
          ' L' + X(s.points[0].x).toFixed(1) + ' ' + base.toFixed(1) + ' Z';
        nodes.push(svg('path', { class: 'area ' + (s.fill || cls.replace('s', 'f')), d: a }));
      }
      nodes.push(svg('path', { class: 'line ' + cls, d: d }));
    });

    var first = series[0].points[0], last = series[0].points[series[0].points.length - 1];
    var desc = (o.label || 'Line chart') + '. ' + series[0].name + ' from ' + yFormat(first.y) + ' to ' + yFormat(last.y) +
      ', range ' + yFormat(Math.min.apply(null, ys)) + ' to ' + yFormat(Math.max.apply(null, ys)) + ', ' + series[0].points.length + ' samples.';
    return el('figure', { class: 'chart' }, [
      svg('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': desc, preserveAspectRatio: 'xMidYMid meet' }, nodes),
      series.length > 1 || o.legend ? legend(series.map(function (s, i) { return { name: s.name, fill: (s.cls || 's' + (i + 1)).replace('s', 'f') }; })) : null
    ]);
  }

  /**
   * bars({ items: [{ label, value }], height, yFormat, signed, label })
   * `signed` colours by sign (and zero stays on the baseline).
   */
  function bars(o) {
    var items = o.items || [];
    if (!items.length) {
      return TCC.ui.state({ tag: 'NO DATA', compact: true, body: o.emptyText || 'No values are recorded to chart.' });
    }
    var H = o.height || 200;
    var m = { l: 52, r: 8, t: 10, b: 30 };
    var vals = items.map(function (i) { return i.value; });
    var yr = niceRange(Math.min.apply(null, vals), Math.max.apply(null, vals), true);
    var iw = W - m.l - m.r, ih = H - m.t - m.b;
    var bw = iw / items.length;
    function Y(y) { return m.t + ih - ((y - yr.min) / (yr.max - yr.min)) * ih; }
    var yFormat = o.yFormat || function (v) { return String(Math.round(v * 100) / 100); };
    var nodes = [];
    for (var i = 0; i <= 3; i++) {
      var v = yr.min + ((yr.max - yr.min) * i) / 3;
      nodes.push(svg('line', { class: 'grid-line', x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v) }));
      nodes.push(svg('text', { x: m.l - 6, y: Y(v) + 3, 'text-anchor': 'end' }, [yFormat(v)]));
    }
    nodes.push(svg('line', { class: 'zero-line', x1: m.l, x2: W - m.r, y1: Y(0), y2: Y(0) }));
    var every = Math.max(1, Math.ceil(items.length / 8));
    items.forEach(function (it, idx) {
      var y0 = Y(0), y1 = Y(it.value);
      var cls = o.signed ? (it.value > 0 ? 'f-pos' : (it.value < 0 ? 'f-neg' : 'f-neutral')) : (it.cls || 'f2');
      var rect = svg('rect', {
        class: cls, x: (m.l + idx * bw + bw * 0.14).toFixed(1), width: Math.max(1, bw * 0.72).toFixed(1),
        y: Math.min(y0, y1).toFixed(1), height: Math.max(0.5, Math.abs(y1 - y0)).toFixed(1)
      }, [svg('title', {}, [it.label + ': ' + yFormat(it.value)])]);
      nodes.push(rect);
      if (idx % every === 0) {
        nodes.push(svg('text', { x: m.l + idx * bw + bw / 2, y: H - 10, 'text-anchor': 'middle' }, [String(it.label).slice(0, 12)]));
      }
    });
    var desc = (o.label || 'Bar chart') + '. ' + items.length + ' bars, from ' + yFormat(Math.min.apply(null, vals)) +
      ' to ' + yFormat(Math.max.apply(null, vals)) + '.';
    return el('figure', { class: 'chart' }, [
      svg('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': desc, preserveAspectRatio: 'xMidYMid meet' }, nodes),
      o.signed ? el('div', { class: 'chart-legend' }, [
        el('span', null, [el('span', { class: 'swatch f-pos' }), 'positive']),
        el('span', null, [el('span', { class: 'swatch f-neg' }), 'negative'])
      ]) : null
    ]);
  }

  TCC.charts = { line: line, bars: bars };
})();
