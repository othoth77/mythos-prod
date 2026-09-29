<?php
// ══════════════════════════════════════════════════════════════════════
// Mythos ERP secure backend — schema migration
// projects/erp-backend/src/db.php
// ══════════════════════════════════════════════════════════════════════

declare(strict_types=1);

// Apply schema.sql (idempotent — all statements are IF NOT EXISTS) and seed
// the three fixed roles. Safe to run repeatedly.
function migrate(): void {
    $pdo = db();
    $sql = file_get_contents(dirname(__DIR__) . '/schema.sql');
    if ($sql === false) { throw new RuntimeException('schema.sql not readable'); }
    $pdo->exec($sql);
    // Record the schema version (§16). Extend SCHEMA_VERSIONS as migrations
    // are added; each is applied idempotently and stamped once.
    $applied = [];
    foreach ($pdo->query('SELECT version FROM schema_migrations') as $r) $applied[$r['version']] = true;
    foreach (['001-initial'] as $v) {
        if (!isset($applied[$v])) {
            $pdo->prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?,?)')
                ->execute([$v, gmdate('Y-m-d\TH:i:s\Z')]);
        }
    }
    foreach (['admin', 'editor', 'viewer'] as $role) {
        $st = $pdo->prepare('INSERT OR IGNORE INTO roles (name) VALUES (?)');
        // INSERT OR IGNORE is SQLite; on MySQL use INSERT IGNORE.
        try { $st->execute([$role]); }
        catch (Throwable $e) {
            $pdo->prepare('INSERT IGNORE INTO roles (name) VALUES (?)')->execute([$role]);
        }
    }
}
