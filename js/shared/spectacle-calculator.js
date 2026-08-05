// MYTHOS PROD — SPECTACLE CALCULATOR v1
// Subvention calculator for spectacle pricing based on actor count and distance.
// Dependencies: document.getElementById, Option, parseInt, toLocaleString (browser globals only)
//
// ══════════════════════════════════════════════════════
// CALCULATEUR SPECTACLE
// ══════════════════════════════════════════════════════
function initSpectacleCalculator() {
  // Tableau des subventions : [nbActeurs][distance] = montant TND
  // Colonnes distance : 0-50km, 51-100km, 101-200km, 201-300km, 301-400km, 401+km
  var TABLE = [
    { label: '1 ou 2 acteurs',   vals: [1500, 2000, 2500, 3000, 3500, 4000] },
    { label: '3 ou 4 acteurs',   vals: [2000, 2500, 3000, 3500, 4000, 4500] },
    { label: '5 ou 6 acteurs',   vals: [2500, 3000, 3500, 4000, 4500, 5000] },
    { label: '7 ou 8 acteurs',   vals: [3000, 3500, 4000, 4500, 5000, 5500] },
    { label: '9 ou 10 acteurs',  vals: [3500, 4000, 4500, 5000, 5500, 6000] },
    { label: '11 à 15 acteurs',  vals: [4000, 4500, 5000, 5500, 6000, 6500] },
    { label: '16 à 20 acteurs',  vals: [5000, 5500, 6000, 6500, 7000, 7500] },
    { label: '21 acteurs et +',  vals: [6000, 6500, 7000, 7500, 8000, 8500] }
  ];
  var DISTANCES = [
    '00 à 50 km', '51 à 100 km', '101 à 200 km',
    '201 à 300 km', '301 à 400 km', '401 km et plus'
  ];

  var selActors   = document.getElementById('spectacle-actors');
  var selDistance = document.getElementById('spectacle-distance');
  var elAmount    = document.getElementById('spectacle-amount');
  var elNote      = document.getElementById('spectacle-selection-text');
  if (!selActors || !selDistance) return;

  // Remplir les selects si vides
  if (!selActors.options.length) {
    TABLE.forEach(function(row, i) {
      selActors.add(new Option(row.label, i));
    });
  }
  if (!selDistance.options.length) {
    DISTANCES.forEach(function(d, i) {
      selDistance.add(new Option(d, i));
    });
  }

  function calc() {
    var a = parseInt(selActors.value) || 0;
    var d = parseInt(selDistance.value) || 0;
    var montant = TABLE[a].vals[d];
    elAmount.textContent = montant.toLocaleString('fr-FR');
    elNote.textContent = '📋 ' + DISTANCES[d] + ', ' + TABLE[a].label + '.';
  }

  selActors.onchange   = calc;
  selDistance.onchange = calc;
  calc();
}

