<?php
// Reçoit le retour de Google après acceptation (?code=...), échange ce code
// contre un access token, récupère TOUS les contacts via People API (avec
// pagination), les transforme au format interne du site, les stocke dans un
// fichier temporaire à usage unique, puis redirige le navigateur vers
// index.html?googleImportToken=XXXX (lu et importé par js/app.js).

$config = require __DIR__ . '/google_config.php';

define('TMP_DIR', __DIR__ . '/appdata/google_imports/');
if (!is_dir(TMP_DIR)) mkdir(TMP_DIR, 0755, true);

// Purge des fichiers temporaires de plus d'1 heure (sécurité / propreté)
foreach (glob(TMP_DIR . '*.json') ?: [] as $f) {
    if (time() - filemtime($f) > 3600) @unlink($f);
}

function mythos_redirect_error(string $msg): never {
    header('Location: /index.html?googleImportError=' . rawurlencode($msg) . '#gestion-contacts');
    exit;
}

$code = $_GET['code'] ?? '';
if (!$code) {
    mythos_redirect_error('Autorisation Google refusée ou annulée.');
}

function curl_json(string $url, array $opts = []): ?array {
    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 20);
    foreach ($opts as $k => $v) curl_setopt($ch, $k, $v);
    $resp = curl_exec($ch);
    if ($resp === false) { curl_close($ch); return null; }
    curl_close($ch);
    return json_decode($resp, true);
}

// ── 1. Échange du code contre un access token ──────────────────────────
$tokenResp = curl_json('https://oauth2.googleapis.com/token', [
    CURLOPT_POST       => true,
    CURLOPT_POSTFIELDS => http_build_query([
        'code'          => $code,
        'client_id'     => $config['client_id'],
        'client_secret' => $config['client_secret'],
        'redirect_uri'  => $config['redirect_uri'],
        'grant_type'    => 'authorization_code',
    ]),
]);

if (empty($tokenResp['access_token'])) {
    mythos_redirect_error('Échec de connexion à Google (token).');
}
$accessToken = $tokenResp['access_token'];

// ── 2. Récupération de TOUS les contacts (pagination complète) ─────────
$allConnections = [];
$pageToken = '';
do {
    $url = 'https://people.googleapis.com/v1/people/me/connections?' . http_build_query(array_filter([
        'personFields' => 'names,phoneNumbers,emailAddresses,addresses',
        'pageSize'      => 1000,
        'pageToken'     => $pageToken,
    ]));
    $resp = curl_json($url, [
        CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $accessToken],
    ]);
    if ($resp === null) break;
    $allConnections = array_merge($allConnections, $resp['connections'] ?? []);
    $pageToken = $resp['nextPageToken'] ?? '';
} while ($pageToken);

// ── 3. Transformation au format interne (tableau Contact Management) ──
$contacts = [];
$nowIso  = date('c');
$batchId = 'batch_google_' . time();

foreach ($allConnections as $p) {
    $names  = $p['names'][0] ?? [];
    $family = $names['familyName'] ?? '';
    $given  = $names['givenName'] ?? '';
    $full   = $names['displayName'] ?? trim($given . ' ' . $family);

    if (!$full) continue; // ignore les entrées sans nom

    if (!$family && !$given) {
        $parts = preg_split('/\s+/', trim($full));
        if (count($parts) > 1) {
            $given  = implode(' ', array_slice($parts, 0, -1));
            $family = end($parts);
        } else {
            $family = $full;
        }
    }

    $tels   = $p['phoneNumbers']   ?? [];
    $emails = $p['emailAddresses'] ?? [];
    $addrs  = $p['addresses']      ?? [];

    $contacts[] = [
        'id'            => 'rc_g_' . bin2hex(random_bytes(6)),
        'nom'           => $family,
        'prenom'        => $given,
        'adresse'       => $addrs[0]['streetAddress'] ?? '',
        'ville'         => $addrs[0]['city']          ?? '',
        'gouvernorat'   => '',
        'pays'          => $addrs[0]['country']        ?? '',
        'tel1'          => $tels[0]['value']           ?? '',
        'tel2'          => $tels[1]['value']           ?? '',
        'email'         => $emails[0]['value']         ?? '',
        'metier'        => '',
        'domaine'       => '',
        'note'          => '',
        'importBatchId' => $batchId,
        'updatedAt'     => $nowIso,
    ];
}

$batch = [
    'id'     => $batchId,
    'date'   => $nowIso,
    'count'  => count($contacts),
    'label'  => '',
    'source' => 'google',
];

// ── 4. Enregistrement DIRECT côté serveur (source de vérité unique) ────
// Important : on écrit ici, côté serveur, AVANT de rediriger le navigateur.
// Les gros imports (1000+ contacts) ne dépendent donc plus d'un second
// aller-retour réseau côté client (chunked upload) qui pouvait être perdu
// si le quota localStorage était dépassé ou si la page était rechargée
// avant la fin de l'envoi — d'où des imports affichant "X importés" mais
// "0 contact(s)" après coup.
define('GC_DATA_DIR', __DIR__ . '/appdata/');
define('GC_META_FILE', GC_DATA_DIR . 'meta.json');
function gc_read(string $key): array {
    $f = GC_DATA_DIR . $key . '.json';
    if (!file_exists($f)) return [];
    $d = json_decode(file_get_contents($f), true);
    return is_array($d) ? $d : [];
}
function gc_write(string $key, array $value): void {
    file_put_contents(GC_DATA_DIR . $key . '.json', json_encode($value, JSON_UNESCAPED_UNICODE), LOCK_EX);
    $meta = file_exists(GC_META_FILE) ? (json_decode(file_get_contents(GC_META_FILE), true) ?: []) : [];
    $meta[$key] = ['updatedAt' => date('c'), 'count' => count($value)];
    file_put_contents(GC_META_FILE, json_encode($meta, JSON_UNESCAPED_UNICODE), LOCK_EX);
}

if (!is_dir(GC_DATA_DIR)) mkdir(GC_DATA_DIR, 0755, true);

$existingContacts = gc_read('mp_repertoire_contacts');
$existingContacts = array_merge($existingContacts, $contacts);
gc_write('mp_repertoire_contacts', $existingContacts);

$existingImports = gc_read('mp_repertoire_imports');
$existingImports[] = $batch;
gc_write('mp_repertoire_imports', $existingImports);

$payload = [
    'ok'      => true,
    'batch'   => $batch,
    'contacts' => $contacts,
];

// ── 5. Stockage temporaire à usage unique (pour rafraîchir l'affichage local) ──
$token = bin2hex(random_bytes(16));
file_put_contents(TMP_DIR . $token . '.json', json_encode($payload, JSON_UNESCAPED_UNICODE));

header('Location: /index.html?googleImportToken=' . $token . '#gestion-contacts');
exit;
