<?php
// projects/erp-backend/cli/create-user.php
// Create (or update the password/role of) a user. NO secret is passed on the
// command line or stored in source: the password comes from the ERP_NEW_PASSWORD
// environment variable, or is read from stdin if that is unset.
//
// Usage:
//   ERP_DB_DRIVER=sqlite ERP_DB_PATH=/path/erp.db \
//   ERP_NEW_PASSWORD='…' php cli/create-user.php <username> <role> ["Display Name"]
//   (role: admin | editor | viewer)
declare(strict_types=1);

$root = dirname(__DIR__);
require $root . '/src/bootstrap.php';
require $root . '/src/db.php';
require $root . '/src/auth.php';

$username = $argv[1] ?? '';
$role     = $argv[2] ?? '';
$display  = $argv[3] ?? $username;

if ($username === '' || !in_array($role, ['admin', 'editor', 'viewer'], true)) {
    fwrite(STDERR, "usage: create-user.php <username> <admin|editor|viewer> [display]\n");
    exit(2);
}

$password = getenv('ERP_NEW_PASSWORD');
if ($password === false || $password === '') {
    fwrite(STDOUT, "Password (input hidden not guaranteed on all shells): ");
    $password = trim((string)fgets(STDIN));
}
if (strlen($password) < 10) {
    fwrite(STDERR, "password must be at least 10 characters\n");
    exit(2);
}

migrate();
$pdo = db();
$pdo->beginTransaction();
try {
    $st = $pdo->prepare('SELECT id FROM users WHERE username = ?');
    $st->execute([$username]);
    $existing = $st->fetch();
    if ($existing) {
        $up = $pdo->prepare('UPDATE users SET password_hash = ?, display_name = ?, active = 1 WHERE id = ?');
        $up->execute([hash_password($password), $display, $existing['id']]);
        $userId = (int)$existing['id'];
    } else {
        $ins = $pdo->prepare('INSERT INTO users (username, password_hash, display_name, active, created_at) VALUES (?,?,?,1,?)');
        $ins->execute([$username, hash_password($password), $display, now_iso()]);
        $userId = (int)$pdo->lastInsertId();
    }
    // Assign exactly the requested role.
    $pdo->prepare('DELETE FROM user_roles WHERE user_id = ?')->execute([$userId]);
    $rid = $pdo->prepare('SELECT id FROM roles WHERE name = ?');
    $rid->execute([$role]);
    $roleId = (int)$rid->fetch()['id'];
    $pdo->prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?,?)')->execute([$userId, $roleId]);
    $pdo->commit();
} catch (Throwable $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    fwrite(STDERR, "failed: " . $e->getMessage() . "\n");
    exit(1);
}
fwrite(STDOUT, "user '{$username}' ready with role '{$role}'\n");
