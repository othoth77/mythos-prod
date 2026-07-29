<?php
// Sert (une seule fois) le résultat d'un import Google en attente, puis le
// supprime du serveur. Appelé par js/app.js juste après la redirection
// retour depuis google_callback.php.

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');

define('TMP_DIR', __DIR__ . '/appdata/google_imports/');

$token = $_GET['token'] ?? '';
$token = preg_replace('/[^a-f0-9]/', '', $token);
$file  = TMP_DIR . $token . '.json';

if (!$token || !file_exists($file)) {
    http_response_code(404);
    echo json_encode(['ok' => false, 'error' => 'Import introuvable ou déjà récupéré.']);
    exit;
}

$data = file_get_contents($file);
@unlink($file); // usage unique : on supprime dès qu'il est lu

echo $data;
