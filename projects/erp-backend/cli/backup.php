<?php
// projects/erp-backend/cli/backup.php
// Consistent snapshot of the ERP backend, as the DB-specific CAPTURE PRIMITIVE
// that the existing off-host pipeline (ops/backup/, offhost-backup.js) carries —
// NOT a competing off-host system (that is forbidden; this only produces inputs).
//
// SQLite is snapshotted with `VACUUM INTO`, which is atomic and consistent even
// under WAL (no torn reads). Uploaded documents are copied. A manifest with
// sha-256 checksums makes the set verifiable and restore-testable.
//
// Usage:
//   ERP_DB_DRIVER=sqlite ERP_DB_PATH=/path/erp.db ERP_UPLOAD_DIR=/path/uploads \
//   php cli/backup.php <output-dir>
declare(strict_types=1);
$root = dirname(__DIR__);
require $root . '/src/bootstrap.php';

$outDir = $argv[1] ?? '';
if ($outDir === '') { fwrite(STDERR, "usage: backup.php <output-dir>\n"); exit(2); }
if (!is_dir($outDir) && !mkdir($outDir, 0700, true)) { fwrite(STDERR, "cannot create output dir\n"); exit(1); }
$stamp = gmdate('Ymd\THis\Z');
$setDir = rtrim($outDir, '/') . '/erp-backup-' . $stamp;
if (!mkdir($setDir, 0700, true)) { fwrite(STDERR, "cannot create set dir\n"); exit(1); }

$driver = cfg('ERP_DB_DRIVER', 'sqlite');
$manifest = ['created_at' => now_iso(), 'driver' => $driver, 'files' => []];

if ($driver === 'sqlite') {
    $dbSnap = $setDir . '/erp.db';
    // VACUUM INTO = consistent hot copy (WAL-safe).
    $q = db()->quote($dbSnap);
    db()->exec('VACUUM INTO ' . $q);
    $manifest['files']['erp.db'] = hash_file('sha256', $dbSnap);
} else {
    // For MySQL/MariaDB the existing pipeline's in-container dump step applies
    // (same pattern as PostgreSQL in ops/backup/mythos-backup-capture.sh).
    fwrite(STDERR, "note: for mysql, capture the dump via the ops/backup pipeline\n");
}

// Copy uploaded documents (if any).
$uploads = cfg('ERP_UPLOAD_DIR');
if ($uploads && is_dir($uploads)) {
    $dst = $setDir . '/uploads';
    mkdir($dst, 0700, true);
    foreach (scandir($uploads) as $f) {
        if ($f === '.' || $f === '..') continue;
        $src = $uploads . '/' . $f;
        if (is_file($src)) {
            copy($src, $dst . '/' . $f);
            $manifest['files']['uploads/' . $f] = hash_file('sha256', $src);
        }
    }
}

file_put_contents($setDir . '/manifest.json', json_encode($manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
fwrite(STDOUT, $setDir . "\n");
