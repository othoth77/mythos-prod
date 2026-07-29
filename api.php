<?php
// ══════════════════════════════════════════════════════════════════════
// MYTHOS PROD — API v3 — Moteur de synchronisation professionnel
// Source de vérité unique : le serveur.
// Chaque collection est horodatée. Le plus récent gagne toujours.
// ══════════════════════════════════════════════════════════════════════

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

// ── Répertoires ───────────────────────────────────────────────────────
define('DATA_DIR',   __DIR__ . '/appdata/');
define('BACKUP_DIR', __DIR__ . '/appdata/backups/');
define('META_FILE',  __DIR__ . '/appdata/meta.json');

foreach ([DATA_DIR, BACKUP_DIR] as $dir) {
    if (!is_dir($dir)) mkdir($dir, 0755, true);
}

// ── Collections autorisées ────────────────────────────────────────────
const ALLOWED_KEYS = [
    'mp_invoices', 'mp_devis', 'mp_contracts', 'mp_clients',
    'mp_oms', 'mp_collabs', 'mp_natures', 'mp_rdvs',
    'mp_representations', 'mp_suppliers', 'mp_purchases',
    'mp_expenses', 'mp_expense_categories', 'mp_bank_entries',
    'mp_cash_entries', 'mp_rendez_vous', 'mp_documents',
    // Espace de rédaction — catégories fixes
    'mp_rddocs_das', 'mp_rddocs_autres',
    'mp_backup_versions', 'mp_restore_meta', 'mp_taches', 'mp_vehicules',
    'mp_rappels', 'mp_rappel_types',
    'mp_repertoire_contacts', 'mp_repertoire_imports',
    'mp_appels', 'mp_validated_inscriptions', 'mp_call_script', 'mp_sheet_webhook_url'
];

// ── Métadonnées (timestamps par collection) ───────────────────────────
function meta_load(): array {
    if (!file_exists(META_FILE)) return [];
    return json_decode(file_get_contents(META_FILE), true) ?: [];
}
function meta_save(array $meta): void {
    file_put_contents(META_FILE, json_encode($meta, JSON_UNESCAPED_UNICODE), LOCK_EX);
}
function meta_update(string $key, mixed $data, string $updatedAt = ''): void {
    $meta = meta_load();
    $meta[$key] = [
        'updatedAt' => $updatedAt ?: date('c'),
        'count'     => is_array($data) ? count($data) : ($data !== null ? 1 : 0),
    ];
    meta_save($meta);
}

// ── Validation clé (fixe + dynamiques mp_rdtpl_* / mp_rdent_*) ───────
function is_key_allowed(string $key): bool {
    if (in_array($key, ALLOWED_KEYS, true)) return true;
    // Clés dynamiques du module rédaction
    if (str_starts_with($key, 'mp_rdtpl_')) return true;
    if (str_starts_with($key, 'mp_rdent_')) return true;
    return false;
}

// ── Lecture fichier collection ────────────────────────────────────────
function data_read(string $key): mixed {
    $f = DATA_DIR . $key . '.json';
    if (!file_exists($f)) return null;
    return json_decode(file_get_contents($f), true);
}
function data_write(string $key, mixed $value, string $updatedAt = ''): bool {
    $ok = file_put_contents(DATA_DIR . $key . '.json', json_encode($value, JSON_UNESCAPED_UNICODE), LOCK_EX);
    if ($ok === false) return false; // écriture disque échouée (permissions, disque plein...)
    meta_update($key, $value, $updatedAt);
    return true;
}

// ── Réponse JSON ──────────────────────────────────────────────────────
function respond(array $payload, int $code = 200): never {
    http_response_code($code);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

// ══════════════════════════════════════════════════════════════════════
// GET
// ══════════════════════════════════════════════════════════════════════
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $key    = $_GET['key']    ?? '';
    $action = $_GET['action'] ?? '';

    // ── Métadonnées seules (timestamps) ──────────────────────────────
    if ($action === 'meta') {
        respond(['ok' => true, 'meta' => meta_load()]);
    }

    // ── Nettoyage manuel via URL ──────────────────────────────────────
    if ($action === 'cleanup') {
        $key = $_GET['key'] ?? '';
        if ($key === 'mythos2026clean') {
            include_once __DIR__ . '/cleanup.php';
            exit;
        }
        respond(['ok' => false, 'error' => 'Clé invalide'], 403);
    }

    // ── Diagnostic : vérifie que le serveur peut bien écrire sur disque ──
    // À tester depuis n'importe quel appareil : /api.php?action=health
    if ($action === 'health') {
        $testFile = DATA_DIR . '_health_check.json';
        $writeOk  = @file_put_contents($testFile, json_encode(['ts' => date('c')])) !== false;
        if ($writeOk) @unlink($testFile);
        respond([
            'ok'         => true,
            'serverTime' => date('c'),
            'dataDirWritable' => $writeOk,
            'metaFileExists'  => file_exists(META_FILE),
            'taches_count'    => is_array(data_read('mp_taches')) ? count(data_read('mp_taches')) : 0,
        ]);
    }

    // ── Liste des sauvegardes automatiques ───────────────────────────
    if ($action === 'list_backups') {
        $files = glob(BACKUP_DIR . '*.json') ?: [];
        rsort($files);
        $backups = array_map(fn($f) => [
            'file' => basename($f),
            'size' => round(filesize($f) / 1024, 1),
            'ts'   => filemtime($f),
        ], array_slice($files, 0, 10));
        respond(['ok' => true, 'backups' => $backups]);
    }

    // ── Toutes les collections + métadonnées (chargement initial) ────
    if ($key === '__all__') {
        $result = [];
        // Collections fixes
        foreach (ALLOWED_KEYS as $k) {
            $result[$k] = data_read($k);
        }
        // Collections dynamiques rédaction (mp_rdtpl_* et mp_rdent_*)
        $dynFiles = glob(DATA_DIR . 'mp_rdtpl_*.json') ?: [];
        $dynFiles = array_merge($dynFiles, glob(DATA_DIR . 'mp_rdent_*.json') ?: []);
        foreach ($dynFiles as $f) {
            $k = basename($f, '.json');
            if (!isset($result[$k])) $result[$k] = data_read($k);
        }
        respond(['ok' => true, 'data' => $result, 'meta' => meta_load()]);
    }

    // ── Une collection ────────────────────────────────────────────────
    if (!is_key_allowed($key)) {
        respond(['ok' => false, 'error' => 'Clé non autorisée'], 403);
    }
    $meta = meta_load();
    respond([
        'ok'    => true,
        'value' => data_read($key),
        'meta'  => $meta[$key] ?? null,
    ]);
}

// ══════════════════════════════════════════════════════════════════════
// POST
// ══════════════════════════════════════════════════════════════════════
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $body = json_decode(file_get_contents('php://input'), true);
    if (!is_array($body)) {
        respond(['ok' => false, 'error' => 'Corps JSON invalide'], 400);
    }

    // ── Réception d'une collection envoyée en plusieurs morceaux ─────
    // (évite l'erreur 413 sur les grosses collections, ex. répertoire de contacts)
    if (isset($body['__chunk__'])) {
        $key = $body['key'] ?? '';
        if (!is_key_allowed($key)) {
            respond(['ok' => false, 'error' => 'Clé non autorisée'], 403);
        }
        $idx      = (int) ($body['chunkIndex']  ?? 0);
        $total    = (int) ($body['totalChunks'] ?? 1);
        $chunk    = $body['chunk'] ?? [];
        $clientTs = $body['updatedAt'] ?? date('c');
        $chunkDir = DATA_DIR . 'chunks_' . preg_replace('/[^a-zA-Z0-9_]/', '', $key) . '/';
        if (!is_dir($chunkDir)) mkdir($chunkDir, 0755, true);
        file_put_contents($chunkDir . $idx . '.json', json_encode($chunk, JSON_UNESCAPED_UNICODE), LOCK_EX);

        if ($idx + 1 >= $total) {
            $merged = [];
            for ($i = 0; $i < $total; $i++) {
                $partFile = $chunkDir . $i . '.json';
                $part = file_exists($partFile) ? (json_decode(file_get_contents($partFile), true) ?: []) : [];
                $merged = array_merge($merged, $part);
            }
            $ok = data_write($key, $merged, $clientTs);
            foreach (glob($chunkDir . '*.json') ?: [] as $f) { @unlink($f); }
            @rmdir($chunkDir);
            if (!$ok) {
                respond(['ok' => false, 'error' => 'Écriture disque échouée'], 500);
            }
            respond(['ok' => true, 'assembled' => true, 'count' => count($merged)]);
        }
        respond(['ok' => true, 'assembled' => false]);
    }

    // ── Sauvegarde automatique (snapshot complet horodaté) ───────────
    if (isset($body['__auto_backup__'])) {
        $label    = preg_replace('/[^a-zA-Z0-9_\-]/', '', $body['label'] ?? 'auto');
        $filename = BACKUP_DIR . date('Y-m-d_H-i-s') . '_' . substr($label, 0, 40) . '.json';
        file_put_contents($filename, json_encode([
            'exportedAt' => date('c'),
            'label'      => $body['label'] ?? 'auto',
            'data'       => $body['__auto_backup__'],
        ], JSON_UNESCAPED_UNICODE), LOCK_EX);
        // Garder les 10 dernières sauvegardes uniquement
        $all = glob(BACKUP_DIR . '*.json') ?: [];
        if (count($all) > 10) {
            sort($all);
            foreach (array_slice($all, 0, count($all) - 10) as $old) {
                unlink($old);
            }
        }
        respond(['ok' => true, 'file' => basename($filename)]);
    }

    // ── Restaurer une sauvegarde ──────────────────────────────────────
    if (isset($body['__restore_backup__'])) {
        $fname = basename((string) $body['__restore_backup__']);
        $fpath = BACKUP_DIR . $fname;
        if (!file_exists($fpath)) {
            respond(['ok' => false, 'error' => 'Fichier introuvable'], 404);
        }
        $backup = json_decode(file_get_contents($fpath), true);
        if (!isset($backup['data'])) {
            respond(['ok' => false, 'error' => 'Format de sauvegarde invalide'], 422);
        }
        $restored = 0;
        $now = date('c');
        foreach ($backup['data'] as $key => $value) {
            if (!is_key_allowed($key)) continue;
            data_write($key, $value, $now);
            $restored++;
        }
        respond(['ok' => true, 'restored' => $restored]);
    }

    // ── Synchronisation en masse depuis un appareil ───────────────────
    // Règle : pas de détection de conflit ici. L'appareil qui envoie a la priorité.
    // Les conflits inter-appareils sont résolus uniquement au démarrage (__all__).
    if (isset($body['__bulk__'])) {
        $clientTs = $body['updatedAt'] ?? date('c');
        $saved    = 0;
        $failed   = [];

        foreach ($body['__bulk__'] as $key => $value) {
            if (!is_key_allowed($key)) continue;
            if (data_write($key, $value, $clientTs)) { $saved++; } else { $failed[] = $key; }
        }
        if ($failed) {
            respond(['ok' => false, 'error' => 'Écriture disque échouée', 'saved' => $saved, 'failed' => $failed], 500);
        }
        respond(['ok' => true, 'saved' => $saved]);
    }

    // ── Sauvegarde d'une seule collection ─────────────────────────────
    // Règle : l'appareil qui écrit activement gagne toujours.
    // Pas de détection de conflit ici — le client qui écrit a la priorité absolue.
    // Les conflits inter-appareils sont résolus uniquement au démarrage (__all__).
    $key      = $body['key']       ?? '';
    $value    = $body['value']     ?? null;
    $clientTs = $body['updatedAt'] ?? date('c');

    if (!is_key_allowed($key)) {
        respond(['ok' => false, 'error' => 'Clé non autorisée'], 403);
    }

    if (!data_write($key, $value, $clientTs)) {
        respond(['ok' => false, 'error' => 'Écriture disque échouée (permissions ?)'], 500);
    }
    respond(['ok' => true]);
}

http_response_code(405);
respond(['ok' => false, 'error' => 'Méthode non autorisée']);
