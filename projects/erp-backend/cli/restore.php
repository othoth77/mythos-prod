<?php
// projects/erp-backend/cli/restore.php
// Restore a snapshot produced by backup.php: verifies every file against the
// manifest sha-256, then restores the DB (to ERP_DB_PATH) and uploads (to
// ERP_UPLOAD_DIR). Fails closed on any checksum mismatch — a backup that does
// not verify is never restored.
//
// Usage:
//   ERP_DB_DRIVER=sqlite ERP_DB_PATH=/path/erp.db ERP_UPLOAD_DIR=/path/uploads \
//   php cli/restore.php <set-dir>
declare(strict_types=1);
$root = dirname(__DIR__);
require $root . '/src/bootstrap.php';

$setDir = rtrim($argv[1] ?? '', '/');
if ($setDir === '' || !is_dir($setDir)) { fwrite(STDERR, "usage: restore.php <set-dir>\n"); exit(2); }
$manifest = json_decode((string)file_get_contents($setDir . '/manifest.json'), true);
if (!is_array($manifest) || empty($manifest['files'])) { fwrite(STDERR, "invalid manifest\n"); exit(1); }

// 1) Verify every file before touching any live path.
foreach ($manifest['files'] as $rel => $want) {
    $path = $setDir . '/' . $rel;
    if (!is_file($path) || !hash_equals($want, hash_file('sha256', $path))) {
        fwrite(STDERR, "checksum mismatch: $rel\n"); exit(1);
    }
}

// 2) Restore the DB.
if (($manifest['driver'] ?? 'sqlite') === 'sqlite') {
    $target = cfg('ERP_DB_PATH');
    if (!$target) { fwrite(STDERR, "ERP_DB_PATH not set\n"); exit(1); }
    if (!copy($setDir . '/erp.db', $target)) { fwrite(STDERR, "db restore failed\n"); exit(1); }
    @unlink($target . '-wal'); @unlink($target . '-shm');
}

// 3) Restore uploads.
$uploads = cfg('ERP_UPLOAD_DIR');
if ($uploads && is_dir($setDir . '/uploads')) {
    if (!is_dir($uploads)) mkdir($uploads, 0700, true);
    foreach (scandir($setDir . '/uploads') as $f) {
        if ($f === '.' || $f === '..') continue;
        copy($setDir . '/uploads/' . $f, $uploads . '/' . $f);
    }
}
fwrite(STDOUT, "restored from " . basename($setDir) . " (checksums verified)\n");
