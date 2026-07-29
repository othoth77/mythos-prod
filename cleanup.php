<?php
// ══════════════════════════════════════════════════════════════════════
// MYTHOS PROD — Nettoyage automatique du disque
// Peut être exécuté :
//   1. Via cron OVH (planifié automatiquement)
//   2. Via navigateur : cleanup.php?key=VOTRE_CLE_SECRETE
//   3. Via api.php?action=cleanup&key=VOTRE_CLE_SECRETE
// ══════════════════════════════════════════════════════════════════════

// ── Clé de sécurité (changez cette valeur) ────────────────────────────
define('CLEANUP_KEY', 'mythos2026clean');

// ── Paramètres de nettoyage ───────────────────────────────────────────
define('MAX_BACKUPS',       10);   // Nombre max de sauvegardes à garder
define('MAX_BACKUP_DAYS',    7);   // Supprimer les backups + vieux que 7 jours
define('MIN_BACKUPS_KEEP',   3);   // Toujours garder au moins 3 backups
define('MAX_DISK_MB',      100);   // Alerte si appdata dépasse 100 Mo

// ── Vérifier l'accès ─────────────────────────────────────────────────
$isCron = (php_sapi_name() === 'cli');  // Exécution via cron = pas de vérification
$isWeb  = !$isCron;

if ($isWeb) {
    $key = $_GET['key'] ?? $_POST['key'] ?? '';
    if ($key !== CLEANUP_KEY) {
        http_response_code(403);
        die(json_encode(['ok' => false, 'error' => 'Accès refusé']));
    }
    header('Content-Type: application/json; charset=utf-8');
}

// ── Chemins ───────────────────────────────────────────────────────────
$dataDir   = __DIR__ . '/appdata/';
$backupDir = __DIR__ . '/appdata/backups/';
$logFile   = __DIR__ . '/appdata/cleanup_log.txt';

$report = [
    'date'         => date('Y-m-d H:i:s'),
    'backups_deleted' => 0,
    'space_freed_kb'  => 0,
    'disk_used_mb'    => 0,
    'actions'         => [],
];

// ── Fonction utilitaire ───────────────────────────────────────────────
function dirSizeKb(string $dir): float {
    $size = 0;
    foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS)) as $f) {
        $size += $f->getSize();
    }
    return round($size / 1024, 1);
}

// ── 1. Nettoyer les backups ───────────────────────────────────────────
if (is_dir($backupDir)) {
    $files = glob($backupDir . '*.json') ?: [];
    sort($files); // du plus ancien au plus récent

    $now       = time();
    $maxAgeSec = MAX_BACKUP_DAYS * 86400;
    $toDelete  = [];

    // Règle A : trop de fichiers (garder les MAX_BACKUPS plus récents)
    if (count($files) > MAX_BACKUPS) {
        $excess = array_slice($files, 0, count($files) - MAX_BACKUPS);
        $toDelete = array_merge($toDelete, $excess);
    }

    // Règle B : trop vieux (mais toujours garder MIN_BACKUPS_KEEP)
    foreach ($files as $f) {
        if (in_array($f, $toDelete)) continue;
        $age = $now - filemtime($f);
        if ($age > $maxAgeSec && count($files) - count($toDelete) > MIN_BACKUPS_KEEP) {
            $toDelete[] = $f;
        }
    }

    // Supprimer
    $toDelete = array_unique($toDelete);
    foreach ($toDelete as $f) {
        $kb = round(filesize($f) / 1024, 1);
        $report['space_freed_kb'] += $kb;
        $report['backups_deleted']++;
        $report['actions'][] = 'Supprimé : ' . basename($f) . ' (' . $kb . ' Ko)';
        unlink($f);
    }

    if ($report['backups_deleted'] === 0) {
        $report['actions'][] = 'Backups OK — ' . count($files) . ' fichier(s), rien à supprimer';
    }
}

// ── 2. Mesurer l'espace disque utilisé ───────────────────────────────
if (is_dir($dataDir)) {
    $totalKb = dirSizeKb($dataDir);
    $report['disk_used_mb'] = round($totalKb / 1024, 2);
    if ($report['disk_used_mb'] > MAX_DISK_MB) {
        $report['actions'][] = '⚠ ALERTE : appdata utilise ' . $report['disk_used_mb'] . ' Mo (limite ' . MAX_DISK_MB . ' Mo)';
    } else {
        $report['actions'][] = '✓ Espace disque OK : ' . $report['disk_used_mb'] . ' Mo utilisés';
    }
}

// ── 3. Mettre à jour le log ───────────────────────────────────────────
$logLine = '[' . $report['date'] . '] Backups supprimés: ' . $report['backups_deleted']
    . ' | Libéré: ' . $report['space_freed_kb'] . ' Ko'
    . ' | Disque: ' . $report['disk_used_mb'] . ' Mo' . PHP_EOL;

// Garder seulement les 100 dernières lignes du log
if (file_exists($logFile)) {
    $lines = file($logFile);
    if (count($lines) > 100) {
        $lines = array_slice($lines, -100);
        file_put_contents($logFile, implode('', $lines));
    }
}
file_put_contents($logFile, $logLine, FILE_APPEND | LOCK_EX);

// ── Réponse ───────────────────────────────────────────────────────────
$report['ok']          = true;
$report['space_freed'] = round($report['space_freed_kb'] / 1024, 2) . ' Mo';

if ($isCron) {
    echo implode(PHP_EOL, $report['actions']) . PHP_EOL;
} else {
    echo json_encode($report, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
}
