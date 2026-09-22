'use strict';
var pct = require('./pct');
var cases = [[1,2,50],[1,3,33],[2,3,67],[7,8,88],[0,5,0],[5,5,100],[0,0,0],[3,0,0]];
var failed = 0;
cases.forEach(function (c) {
  var got = pct(c[0], c[1]);
  if (got !== c[2]) { console.error('pct(' + c[0] + ',' + c[1] + ') returned ' + got + ', expected ' + c[2]); failed++; }
});
if (failed) { console.error(failed + ' case(s) failed'); process.exit(1); }
console.log('pct: all ' + cases.length + ' cases pass');
