// Purchase TVA calculator extraction (Stage 4W).
// Dependencies: num/fmtMoney (app.js); purchase form DOM.

function calculateFromTTC() {
  const ttcEl = document.getElementById('purchase-amount');
  const ttcTotalEl = document.getElementById('purchase-tva-total');

  if (!ttcEl) return;

  const ttc = num(ttcEl.value || 0);
  const timbre = 1;
  const montantAvecTva = ttc - timbre;

  // Afficher la TVA totale
  if (ttcTotalEl) {
    ttcTotalEl.value = fmtMoney(Math.max(0, montantAvecTva));
  }

  const rates = [19, 13, 7];

  rates.forEach(rate => {
    // Calcul inverse: HT = (TTC - Timbre) / (1 + TVA%)
    const factor = 1 + (rate / 100);
    const ht = montantAvecTva / factor;
    const tvaAmount = ht * (rate / 100);

    const htEl = document.getElementById(`purchase-tva${rate}-ht`);
    const tvaEl = document.getElementById(`purchase-tva${rate}-amount`);

    if (htEl) htEl.value = fmtMoney(Math.max(0, ht));
    if (tvaEl) tvaEl.value = fmtMoney(Math.max(0, tvaAmount));
  });

  // Par défaut, sélectionner 19%
  selectTVARate(19);
}

function selectTVARate(rate) {
  const tvaEl = document.getElementById('purchase-tva');
  if (tvaEl) tvaEl.value = rate;

  // Mettre en surbrillance le taux sélectionné
  [19, 13, 7].forEach(r => {
    const htFieldEl = document.getElementById(`purchase-tva${r}-ht`);
    const tvaFieldEl = document.getElementById(`purchase-tva${r}-amount`);

    if (htFieldEl) {
      if (r === rate) {
        htFieldEl.style.borderColor = '#D9A441';
        htFieldEl.style.backgroundColor = '#1a1a1a';
        if (tvaFieldEl) {
          tvaFieldEl.style.borderColor = '#D9A441';
          tvaFieldEl.style.backgroundColor = '#1a1a1a';
        }
      } else {
        htFieldEl.style.borderColor = '#333';
        htFieldEl.style.backgroundColor = '#0e0e0e';
        if (tvaFieldEl) {
          tvaFieldEl.style.borderColor = '#333';
          tvaFieldEl.style.backgroundColor = '#0e0e0e';
        }
      }
    }
  });
}

function updateTVATotal() {
  const tva19El = document.getElementById('purchase-tva19-amount');
  const tva13El = document.getElementById('purchase-tva13-amount');
  const tva7El = document.getElementById('purchase-tva7-amount');
  const totalEl = document.getElementById('purchase-tva-total');

  if (!totalEl) return;

  const tva19 = num(tva19El?.value || 0);
  const tva13 = num(tva13El?.value || 0);
  const tva7 = num(tva7El?.value || 0);

  const total = tva19 + tva13 + tva7;
  totalEl.value = fmtMoney(total);
}
