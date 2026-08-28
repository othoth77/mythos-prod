<?php
// projects/erp-backend/tests/unit-test.php — fast pure-logic checks (no server).
// Run: php tests/unit-test.php
declare(strict_types=1);
$root = dirname(__DIR__);
require $root . '/src/bootstrap.php';
require $root . '/src/auth.php';
require $root . '/src/rbac.php';
require $root . '/src/api.php';

$pass = 0; $fail = 0;
function ok($cond, $label) { global $pass, $fail; if ($cond) { $pass++; echo "  PASS $label\n"; } else { $fail++; echo "  FAIL $label\n"; } }

echo "1. Password hashing (argon2id) round-trips and rejects wrong input\n";
$h = hash_password('correct horse battery staple');
ok(str_starts_with($h, '$argon2id$'), 'hash is argon2id');
ok(password_verify('correct horse battery staple', $h), 'correct password verifies');
ok(!password_verify('wrong', $h), 'wrong password rejected');

echo "2. Collection key validation closes the traversal hole\n";
ok(key_valid('mp_invoices'), 'fixed key allowed');
ok(key_valid('mp_rdtpl_abc123'), 'valid dynamic prefix allowed');
ok(!key_valid('mp_rdtpl_../../etc/passwd'), 'traversal in prefix rejected');
ok(!key_valid('mp_rdtpl_a/b'), 'slash rejected');
ok(!key_valid('not_allowed'), 'unknown key rejected');
ok(!key_valid('MP_INVOICES'), 'uppercase rejected (strict class)');

echo "3. RBAC decisions are role-derived and closed\n";
$admin  = ['roles' => ['admin']];
$editor = ['roles' => ['editor']];
$viewer = ['roles' => ['viewer']];
$none   = ['roles' => []];
ok(can($admin, 'admin') && can($admin, 'write') && can($admin, 'upload') && can($admin, 'read'), 'admin can everything');
ok(can($editor, 'write') && can($editor, 'upload') && can($editor, 'read') && !can($editor, 'admin'), 'editor can write/upload/read, not admin');
ok(can($viewer, 'read') && !can($viewer, 'write') && !can($viewer, 'upload'), 'viewer read-only');
ok(!can($none, 'read') && !can(null, 'read'), 'no roles / null -> nothing');

echo "\nUNIT-TEST: $pass passed, $fail failed\n";
exit($fail ? 1 : 0);
