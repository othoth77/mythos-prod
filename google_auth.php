<?php
// Démarre le flux OAuth Google : redirige l'utilisateur vers l'écran de
// consentement Google. Après acceptation, Google redirige vers
// google_callback.php avec un "code".

$config = require __DIR__ . '/google_config.php';

if (str_contains($config['client_id'], 'REMPLACER_PAR')) {
    http_response_code(500);
    echo 'Configuration Google manquante. Renseignez google_config.php avec votre Client ID / Client Secret (voir les instructions en haut de ce fichier).';
    exit;
}

$params = [
    'client_id'     => $config['client_id'],
    'redirect_uri'  => $config['redirect_uri'],
    'response_type' => 'code',
    'scope'         => 'https://www.googleapis.com/auth/contacts.readonly',
    'access_type'   => 'online',
    'prompt'        => 'consent select_account',
];

header('Location: https://accounts.google.com/o/oauth2/v2/auth?' . http_build_query($params));
exit;
