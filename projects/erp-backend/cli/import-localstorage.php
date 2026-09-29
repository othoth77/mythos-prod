<?php
// projects/erp-backend/cli/import-localstorage.php
// Migration tool (§7): import an existing localStorage / backup.js export into
// the server database, without discarding anything. The export is a JSON object
// of { "<collection key>": <data>, ... } — exactly what the app's backup
// produces. Each collection is written transactionally at version 1 (or bumped
// if it already exists). Unknown/invalid keys are skipped and reported, never
// written (same key rules as the live API).
//
// Usage:
//   ERP_DB_DRIVER=sqlite ERP_DB_PATH=/path/erp.db \
//   php cli/import-localstorage.php <export.json> [importer-username]
declare(strict_types=1);

$root = dirname(__DIR__);
require $root . '/src/bootstrap.php';
require $root . '/src/db.php';
require $root . '/src/api.php';   // for key_valid()

$file = $argv[1] ?? '';
$importer = $argv[2] ?? 'migration';
if ($file === '' || !is_file($file)) { fwrite(STDERR, "usage: import-localstorage.php <export.json> [username]\n"); exit(2); }

$raw = file_get_contents($file);
$data = json_decode((string)$raw, true);
if (!is_array($data)) { fwrite(STDERR, "export is not a JSON object\n"); exit(2); }

migrate();
$pdo = db();

// Resolve the importer user id if it exists (for updated_by / audit), else null.
$importerId = null;
$st = $pdo->prepare('SELECT id FROM users WHERE username = ?');
$st->execute([$importer]);
if ($row = $st->fetch()) $importerId = (int)$row['id'];

$written = 0; $skipped = [];
foreach ($data as $key => $value) {
    $key = (string)$key;
    if (!key_valid($key)) { $skipped[] = $key; continue; }
    $encoded = json_encode($value, JSON_UNESCAPED_UNICODE);
    if ($encoded === false) { $skipped[] = $key . ' (not serialisable)'; continue; }
    $pdo->beginTransaction();
    try {
        $sel = $pdo->prepare('SELECT version FROM collections WHERE key = ?');
        $sel->execute([$key]);
        $cur = $sel->fetch();
        $v = $cur ? (int)$cur['version'] + 1 : 1;
        if ($cur) {
            $pdo->prepare('UPDATE collections SET data=?, version=?, updated_at=?, updated_by=? WHERE key=?')
                ->execute([$encoded, $v, now_iso(), $importerId, $key]);
        } else {
            $pdo->prepare('INSERT INTO collections (key, data, version, updated_at, updated_by) VALUES (?,?,?,?,?)')
                ->execute([$key, $encoded, $v, now_iso(), $importerId]);
        }
        $pdo->prepare('INSERT INTO audit_log (ts, actor_user_id, actor_username, action, resource, resource_id, meta, ip) VALUES (?,?,?,?,?,?,?,?)')
            ->execute([now_iso(), $importerId, $importer, 'import', $key, null, json_encode(['version' => $v, 'bytes' => strlen($encoded)]), 'cli']);
        $pdo->commit();
        $written++;
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        $skipped[] = $key . ' (' . $e->getMessage() . ')';
    }
}
fwrite(STDOUT, "imported $written collection(s)\n");
if ($skipped) fwrite(STDOUT, "skipped: " . implode(', ', $skipped) . "\n");
