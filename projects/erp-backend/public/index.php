<?php
// ══════════════════════════════════════════════════════════════════════
// Mythos ERP secure backend — front controller / router
// projects/erp-backend/public/index.php
//
// The ONLY file in the web root. Every request is routed here (nginx
// try_files … /index.php, or `php -S host:port public/index.php` in dev).
// Business source lives in ../src and is never web-served.
// ══════════════════════════════════════════════════════════════════════

declare(strict_types=1);

$root = dirname(__DIR__);
require $root . '/src/bootstrap.php';
require $root . '/src/db.php';
require $root . '/src/auth.php';
require $root . '/src/rbac.php';
require $root . '/src/audit.php';
require $root . '/src/api.php';
require $root . '/src/uploads.php';

send_security_headers();

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method === 'OPTIONS') { http_response_code(204); exit; }

// Route path, with an optional base prefix (e.g. when mounted under /erp-api).
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?? '/';
$base = rtrim((string)cfg('ERP_BASE_PATH', ''), '/');
if ($base !== '' && str_starts_with($path, $base)) $path = substr($path, strlen($base));
$path = '/' . ltrim($path, '/');

function body_json(): array {
    $raw = file_get_contents('php://input');
    if ($raw === '' || $raw === false) return [];
    $j = json_decode($raw, true);
    return is_array($j) ? $j : [];
}

// ── Public routes ─────────────────────────────────────────────────────
if ($path === '/health' && $method === 'GET') {
    respond(['ok' => true, 'service' => 'erp-backend', 'time' => now_iso()]);
}

if ($path === '/auth/login' && $method === 'POST') {
    $b = body_json();
    $res = login((string)($b['username'] ?? ''), (string)($b['password'] ?? ''));
    if (!$res) fail('invalid credentials', 401);   // uniform message, no enumeration
    [$sid, $user, $csrf] = $res;
    audit($user, 'login', 'session', null, []);
    respond(['ok' => true, 'user' => [
        'username' => $user['username'], 'display_name' => $user['display_name'],
        'roles' => user_roles((int)$user['id']),
    ], 'csrf' => $csrf]);
}

if ($path === '/auth/logout' && $method === 'POST') {
    $user = current_user();
    logout();
    if ($user) audit($user, 'logout', 'session', null, []);
    respond(['ok' => true]);
}

if ($path === '/auth/me' && $method === 'GET') {
    $user = current_user();
    if (!$user) fail('authentication required', 401);
    respond(['ok' => true, 'user' => [
        'username' => $user['username'], 'display_name' => $user['display_name'],
        'roles' => $user['roles'],
    ], 'csrf' => $user['csrf']]);
}

// ── Authenticated routes ──────────────────────────────────────────────
if ($path === '/api/collections') {
    $user = require_auth();
    if ($method === 'GET') {
        if (($_GET['action'] ?? '') === 'meta') collection_meta($user);
        collection_get($user, (string)($_GET['key'] ?? ''));
    }
    if ($method === 'POST') collection_write($user, body_json());
    fail('method not allowed', 405);
}

if ($path === '/api/upload' && $method === 'POST') {
    $user = require_auth();
    upload_document($user);
}

fail('not found', 404);
