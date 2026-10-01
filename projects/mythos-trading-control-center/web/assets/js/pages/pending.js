/* =============================================================================
   MYTHOS TRADING CONTROL CENTER — routes not built yet
   projects/mythos-trading-control-center/web/assets/js/pages/pending.js

   A route that is registered but not yet built is SHOWN and MARKED, never
   hidden: the shell's job is to make the shape of the system legible, and a
   hidden route is an undocumented one. Each entry names the phase that
   delivers it. A phase removes its line here when it adds its page file, and
   this file is deleted when the list is empty.
   ============================================================================= */
(function () {
  'use strict';

  var TCC = window.TCC;
  var ui = TCC.ui;

  var PENDING = [
    ['/paper', 'Paper / Demo', 5],
    ['/backtest', 'Backtest', 6],
    ['/trades', 'Trades', 7],
    ['/candidates', 'Candidates', 7],
    ['/decisions', 'Decisions', 8],
    ['/strategies', 'Strategies', 9],
    ['/jev', 'Jev', 9],
    ['/risk', 'Risk', 9],
    ['/recovery', 'Recovery', 9],
    ['/analysis', 'Analysis', 10],
    ['/research', 'Research', 11],
    ['/testing', 'Testing', 12],
    ['/activity', 'Activity', 13],
    ['/system', 'System', 13]
  ];

  PENDING.forEach(function (p) {
    TCC.page(p[0], {
      title: p[1],
      pending: p[2],
      render: function (ctx) {
        ctx.root.appendChild(ui.pageHead(p[1]));
        ctx.root.appendChild(ui.state({
          tag: 'NOT BUILT YET',
          title: p[1] + ' is delivered in phase ' + p[2],
          body: 'The API behind this view exists and is tested; the interface for it has not been built yet.'
        }));
      }
    });
  });
})();
