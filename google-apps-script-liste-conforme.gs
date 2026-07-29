/**
 * Liste conforme — Uthina Chess
 * Reçoit les fiches "Candidat sérieux" depuis le site et les ajoute
 * (ou met à jour) dans la Google Sheet active.
 *
 * INSTALLATION :
 * 1. Va sur https://sheets.google.com → Feuille vierge → renomme-la
 *    "Liste conforme - Uthina Chess".
 * 2. Menu Extensions → Apps Script.
 * 3. Supprime tout le code par défaut, colle TOUT ce fichier à la place.
 * 4. Enregistre (icône disquette).
 * 5. Déployer → Nouveau déploiement → type "Application Web".
 *      - Exécuter en tant que : Moi
 *      - Qui a accès : Tout le monde
 * 6. Autoriser l'accès à ton compte Google quand demandé.
 * 7. Copie l'URL donnée (elle termine par /exec).
 * 8. Sur le site Uthina Chess → Paramètres → colle cette URL dans le champ
 *    "Google Sheet — Liste conforme" → Enregistrer l'URL.
 * 9. Clique "⚡ Tester" : une ligne "Test Connexion" doit apparaître
 *    dans ta Google Sheet.
 */

function doPost(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var data = JSON.parse(e.postData.contents);

  var headers = [
    'ID', 'Nom', 'Prénom', 'Téléphone', 'Ville', 'Âge', 'Niveau', 'Domaine', 'Note',
    'Date inscription', 'Heure inscription', 'Date appel', 'Heure appel', 'Statut'
  ];
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  }

  var rowData = [
    data.id || '',
    data.nom || '',
    data.prenom || '',
    data.tel || '',
    data.ville || '',
    data.age || '',
    data.niveau || '',
    data.domaine || '',
    data.note || '',
    data.dateInscription || data.date || '',
    data.heureInscription || '',
    data.dateAppel || '',
    data.heureAppel || '',
    data.statut || ''
  ];

  // Évite les doublons : si l'ID existe déjà, met à jour la ligne au lieu d'en créer une nouvelle.
  var lastRow = sheet.getLastRow();
  var idx = -1;
  if (lastRow > 1) {
    var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(data.id)) { idx = i; break; }
    }
  }
  if (idx !== -1) {
    sheet.getRange(idx + 2, 1, 1, rowData.length).setValues([rowData]);
  } else {
    sheet.appendRow(rowData);
  }

  return ContentService
    .createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}
